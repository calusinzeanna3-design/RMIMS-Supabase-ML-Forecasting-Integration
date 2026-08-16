-- ============================================================
-- RMIMS — Admin Settings: Backup & Data Management
-- ============================================================
-- ADDITIVE MIGRATION. Run this AFTER schema.sql,
-- user-management-schema.sql, material-activity-schema.sql, and
-- settings-schema.sql. Does NOT modify or drop any existing
-- table, column, policy, or trigger.
--
-- ARCHITECTURE NOTE: RMIMS has no backend server, so "Backup &
-- Data Management" is built entirely on the client + Supabase:
--   - The backup FILE (a .zip of per-table JSON) is assembled
--     client-side (js/backup-restore.js) from the tables the
--     Admin selected.
--   - It is uploaded to a private Supabase Storage bucket so it
--     stays downloadable later from Backup History — this is
--     what section 24 of the spec ("Backup History ... Action:
--     Download") requires, and a browser-only download link
--     cannot satisfy that once the tab is closed.
--   - public.backup_history stores metadata ONLY (name, size,
--     who, when, which categories, row counts) — never the file
--     itself.
--   - Restore is NOT done by the client deleting/inserting rows
--     table-by-table (that cannot be made atomic from the
--     browser — a failure partway through would leave the
--     database in a partial state, which the spec explicitly
--     forbids). Instead the client uploads the parsed backup
--     payload to restore_backup() below, a single SECURITY
--     DEFINER function. Postgres functions execute as one
--     transaction: any error anywhere inside it rolls back
--     everything it already did.
-- ============================================================

-- ------------------------------------------------------------
-- 1. STORAGE BUCKET FOR BACKUP FILES
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('rmims-backups', 'rmims-backups', false)
on conflict (id) do nothing;

-- Admin-only access to this bucket. Storage RLS lives on
-- storage.objects; bucket_id scopes it to just this bucket.
drop policy if exists "rmims_backups_select_admin" on storage.objects;
create policy "rmims_backups_select_admin"
    on storage.objects for select
    using (bucket_id = 'rmims-backups' and public.is_active_admin());

drop policy if exists "rmims_backups_insert_admin" on storage.objects;
create policy "rmims_backups_insert_admin"
    on storage.objects for insert
    with check (bucket_id = 'rmims-backups' and public.is_active_admin());

-- Admins may remove old backup files (e.g. to reclaim storage).
-- Removing a FILE does not remove its backup_history row — the
-- row is the audit record of "a backup was made"; only its
-- Download action stops working. See restore's verify step,
-- which already rejects a missing/unreadable file cleanly.
drop policy if exists "rmims_backups_delete_admin" on storage.objects;
create policy "rmims_backups_delete_admin"
    on storage.objects for delete
    using (bucket_id = 'rmims-backups' and public.is_active_admin());

-- ------------------------------------------------------------
-- 2. BACKUP HISTORY (metadata only — never the file contents)
-- ------------------------------------------------------------
create table if not exists public.backup_history (
    id                uuid primary key default gen_random_uuid(),
    backup_name       text not null,
    storage_path      text not null,             -- object key inside rmims-backups
    created_by        uuid references public.users(id) on delete set null,
    created_by_name   text not null,
    file_size_bytes   bigint,
    status            text not null default 'complete' check (status in ('complete','failed')),
    categories        jsonb not null default '[]'::jsonb,   -- which data categories were included
    record_counts     jsonb not null default '{}'::jsonb,   -- per-table row counts at backup time
    created_at        timestamptz not null default now()
);

comment on table public.backup_history is 'Metadata for backups created from Settings -> Backup & Data Management. The backup file itself lives in the rmims-backups storage bucket at storage_path.';

create index if not exists idx_backup_history_created_at on public.backup_history (created_at desc);

alter table public.backup_history enable row level security;

drop policy if exists "backup_history_select_admin" on public.backup_history;
create policy "backup_history_select_admin"
    on public.backup_history for select
    using (public.is_active_admin());

drop policy if exists "backup_history_insert_admin" on public.backup_history;
create policy "backup_history_insert_admin"
    on public.backup_history for insert
    with check (created_by = auth.uid() and public.is_active_admin());

-- No update/delete policy: a backup_history row is an append-only
-- record, same rationale as system_activity_log. A failed backup
-- still inserts a row with status = 'failed' so history stays
-- truthful (spec section 22: never fake a backup entry).

-- ------------------------------------------------------------
-- 3. ATOMIC RESTORE
-- ------------------------------------------------------------
-- Scope: restores OPERATIONAL data only — materials, finished
-- products + their material requirements, stock receipts, usage
-- public.users or public.system_activity_log: account/access
-- data and the audit trail are "separately protected" per spec
-- section 38, the same principle already applied to Data Reset.
--
-- `payload` only needs to contain the keys the Admin chose to
-- restore (Create Backup's categories) — omitted keys are left
-- untouched. Delete/insert order respects foreign keys: children
-- before parents on delete, parents before children on insert.
create or replace function public.restore_backup(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    counts jsonb := '{}'::jsonb;
    n int;
begin
    if not public.is_active_admin() then
        raise exception 'Only an active Admin may restore a backup.';
    end if;

    -- ---- delete (children -> parents), only for included keys ----
    if payload ? 'product_material_requirements' then
        delete from public.product_material_requirements;
    end if;
    if payload ? 'usage_records' then
        delete from public.usage_records;
    end if;
    if payload ? 'stock_receipts' then
        delete from public.stock_receipts;
    end if;
    end if;
    if payload ? 'finished_products' then
        delete from public.finished_products;
    end if;
    if payload ? 'materials' then
        delete from public.materials;
    end if;

    -- ---- insert (parents -> children), only for included keys ----
    if payload ? 'materials' then
        insert into public.materials
            (id, material_name, category, unit, quantity, minimum_threshold, supplier, storage_location, notes, status, created_at, updated_at)
        select id, material_name, category, unit, quantity, minimum_threshold, supplier, storage_location, notes, status, created_at, updated_at
        from jsonb_to_recordset(payload->'materials') as x(
            id text, material_name text, category text, unit text, quantity numeric,
            minimum_threshold numeric, supplier text, storage_location text, notes text,
            status text, created_at timestamptz, updated_at timestamptz
        );
        get diagnostics n = row_count;
        counts := counts || jsonb_build_object('materials', n);
    end if;

    if payload ? 'finished_products' then
        insert into public.finished_products
            (id, product_name, category, image_url, status, created_at, updated_at)
        select id, product_name, category, image_url, status, created_at, updated_at
        from jsonb_to_recordset(payload->'finished_products') as x(
            id text, product_name text, category text, image_url text,
            status text, created_at timestamptz, updated_at timestamptz
        );
        get diagnostics n = row_count;
        counts := counts || jsonb_build_object('finished_products', n);
    end if;

    if payload ? 'product_material_requirements' then
        insert into public.product_material_requirements
            (id, product_id, material_id, required_quantity, unit, created_at, updated_at)
        select id, product_id, material_id, required_quantity, unit, created_at, updated_at
        from jsonb_to_recordset(payload->'product_material_requirements') as x(
            id text, product_id text, material_id text, required_quantity numeric,
            unit text, created_at timestamptz, updated_at timestamptz
        );
        get diagnostics n = row_count;
        counts := counts || jsonb_build_object('product_material_requirements', n);
    end if;

    if payload ? 'stock_receipts' then
        insert into public.stock_receipts
            (id, material_id, material_name, received_quantity, unit, received_date, notes, created_at, created_by)
        select id, material_id, material_name, received_quantity, unit, received_date, notes, created_at, created_by
        from jsonb_to_recordset(payload->'stock_receipts') as x(
            id text, material_id text, material_name text, received_quantity numeric,
            unit text, received_date date, notes text, created_at timestamptz, created_by uuid
        );
        get diagnostics n = row_count;
        counts := counts || jsonb_build_object('stock_receipts', n);
    end if;

    if payload ? 'usage_records' then
        insert into public.usage_records
            (id, material_id, material_name, used_quantity, unit, usage_date, remarks, created_at, product_id, product_name, created_by)
        select id, material_id, material_name, used_quantity, unit, usage_date, remarks, created_at, product_id, product_name, created_by
        from jsonb_to_recordset(payload->'usage_records') as x(
            id text, material_id text, material_name text, used_quantity numeric, unit text,
            usage_date date, remarks text, created_at timestamptz, product_id text,
            product_name text, created_by uuid
        );
        get diagnostics n = row_count;
        counts := counts || jsonb_build_object('usage_records', n);
    end if;

            (id, material_name, current_stock, predicted_demand, reorder_quantity, reorder_date, confidence, created_at)
        select id, material_name, current_stock, predicted_demand, reorder_quantity, reorder_date, confidence, created_at
            id text, material_name text, current_stock numeric, predicted_demand numeric,
            reorder_quantity numeric, reorder_date text, confidence numeric,
            created_at timestamptz
        );
        get diagnostics n = row_count;
    end if;

    insert into public.system_activity_log (admin_id, admin_name, admin_email, action, details)
    select auth.uid(), u.full_name, u.email, 'Restored a backup', jsonb_build_object('categories', jsonb_object_keys_array(payload), 'record_counts', counts)
    from public.users u where u.id = auth.uid();

    return counts;
end;
$$;

-- Small helper: jsonb top-level keys as a jsonb array, used only
-- for the audit log entry above.
create or replace function public.jsonb_object_keys_array(payload jsonb)
returns jsonb
language sql
immutable
as $$
    select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(payload) as k;
$$;

revoke all on function public.restore_backup(jsonb) from public;
grant execute on function public.restore_backup(jsonb) to authenticated;

comment on function public.restore_backup(jsonb) is 'Atomically replaces the operational tables named in