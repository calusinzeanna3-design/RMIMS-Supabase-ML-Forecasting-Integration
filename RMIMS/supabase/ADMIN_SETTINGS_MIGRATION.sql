-- RMIMS ADMIN SETTINGS MIGRATION
-- Run this file in the Supabase SQL Editor AFTER the existing:
--   1) schema.sql
--   2) user-management-schema.sql
--   3) material-activity-schema.sql
--
-- This migration adds:
--   • Admin Settings audit/security support
--   • Backup History + private backup storage + atomic restore
--   • Data Reset RPC
--
-- It does NOT delete or reset your existing data by itself.
-- The reset/restore functions only execute later when an Admin
-- explicitly calls them from the RMIMS Settings page.
--
-- IMPORTANT: Run the whole file in one execution.



-- ============================================================
-- BEGIN settings-schema.sql
-- ============================================================

-- ============================================================
-- RMIMS — Admin Settings support
-- ============================================================
-- ADDITIVE MIGRATION. Run this AFTER schema.sql and
-- user-management-schema.sql. Does NOT modify or drop any
-- existing table, column, policy, or trigger.
--
-- This migration covers the ACCOUNT / SECURITY / DANGER ZONE
-- part of Admin Settings:
--   1. public.system_activity_log — admin-only audit trail,
--      reused by later Settings sections (Backup, Restore,
--      Reset) as those are built.
--   2. A BEFORE DELETE guard on public.users mirroring
--      trg_prevent_last_admin_removal (which only covers
--      UPDATE) so the last active Admin also cannot be
--      *deleted*, whether directly or via the cascade below.
--   3. public.delete_own_account() — a SECURITY DEFINER RPC
--      that lets the signed-in Admin delete their OWN
--      auth.users row (and, via schema.sql's
--      "on delete cascade", their public.users row) without
--      a service-role key ever touching the client. This is
--      the only supported path for "Delete My Account" —
--      RMIMS has no backend, and the anon key cannot delete
--      auth.users rows directly.
-- ============================================================

-- ------------------------------------------------------------
-- 1. SYSTEM ACTIVITY LOG (audit trail)
-- ------------------------------------------------------------
-- Denormalized admin_name / admin_email so an entry stays
-- readable even after the acting Admin's account is later
-- deleted (admin_id -> null, per "historical record
-- protection" — see spec section 11 / 50).
create table if not exists public.system_activity_log (
    id           uuid primary key default gen_random_uuid(),
    admin_id     uuid references public.users(id) on delete set null,
    admin_name   text not null,
    admin_email  text not null,
    action       text not null,
    details      jsonb,
    created_at   timestamptz not null default now()
);

comment on table public.system_activity_log is 'Administrative audit trail (System Activity). Distinct from material_activity / usage_records — records WHO did WHAT to the system, not inventory movement.';

create index if not exists idx_system_activity_log_created_at on public.system_activity_log (created_at desc);
create index if not exists idx_system_activity_log_admin_id on public.system_activity_log (admin_id);

alter table public.system_activity_log enable row level security;

-- Only active admins may read the audit log.
drop policy if exists "system_activity_log_select_admin" on public.system_activity_log;
create policy "system_activity_log_select_admin"
    on public.system_activity_log for select
    using (public.is_active_admin());

-- An active admin may log their OWN actions directly (used for
-- routine actions taken from the client, e.g. password changes).
-- Actions tied to account deletion are logged from inside
-- delete_own_account() below, which runs as SECURITY DEFINER and
-- bypasses RLS entirely, so no policy is needed for that path.
drop policy if exists "system_activity_log_insert_admin" on public.system_activity_log;
create policy "system_activity_log_insert_admin"
    on public.system_activity_log for insert
    with check (admin_id = auth.uid() and public.is_active_admin());

-- No update/delete policy is defined: audit entries are
-- append-only and cannot be modified or removed by any client,
-- admin included (spec section 49).

-- ------------------------------------------------------------
-- 2. LAST-ACTIVE-ADMIN PROTECTION ON DELETE
-- ------------------------------------------------------------
-- trg_prevent_last_admin_removal (user-management-schema.sql)
-- only fires BEFORE UPDATE. Account deletion is a DELETE (or a
-- cascade from auth.users), so it needs its own guard. This
-- fires for cascade deletes too, which is exactly what protects
-- delete_own_account() below.
create or replace function public.prevent_last_admin_deletion()
returns trigger
language plpgsql
as $$
declare
    remaining_admins int;
begin
    if old.role = 'admin' and old.status = 'active' then
        select count(*) into remaining_admins
        from public.users
        where role = 'admin' and status = 'active' and id <> old.id;

        if remaining_admins = 0 then
            raise exception 'At least one active Admin account must remain.';
        end if;
    end if;

    return old;
end;
$$;

drop trigger if exists trg_prevent_last_admin_deletion on public.users;
create trigger trg_prevent_last_admin_deletion
    before delete on public.users
    for each row execute function public.prevent_last_admin_deletion();

-- ------------------------------------------------------------
-- 3. SELF-SERVICE ACCOUNT DELETION (RPC)
-- ------------------------------------------------------------
-- SECURITY DEFINER: must be created/owned by a role with
-- privileges on auth.users (the default `postgres` role used by
-- the Supabase SQL Editor already has this — no extra setup
-- needed when this file is run there).
--
-- The last-active-admin check happens twice on purpose: once
-- here (for a fast, friendly error message) and again in
-- trg_prevent_last_admin_deletion (the real, non-bypassable
-- enforcement — see the file header of
-- user-management-schema.sql for why UI/RPC-level checks alone
-- are never trusted as the sole guard).
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    uid            uuid := auth.uid();
    caller_name    text;
    caller_email   text;
    caller_role    text;
    caller_status  text;
    remaining_admins int;
begin
    if uid is null then
        raise exception 'Not authenticated.';
    end if;

    select full_name, email, role, status
      into caller_name, caller_email, caller_role, caller_status
      from public.users
     where id = uid;

    if not found then
        raise exception 'Account record not found.';
    end if;

    if caller_role = 'admin' and caller_status = 'active' then
        select count(*) into remaining_admins
          from public.users
         where role = 'admin' and status = 'active' and id <> uid;

        if remaining_admins = 0 then
            raise exception 'At least one active Admin account must remain.';
        end if;
    end if;

    insert into public.system_activity_log (admin_id, admin_name, admin_email, action, details)
    values (uid, caller_name, caller_email, 'Admin deleted their own account', jsonb_build_object('self_service', true));

    -- Cascades to public.users via "on delete cascade" (schema.sql).
    -- trg_prevent_last_admin_deletion fires on that cascade as the
    -- final, authoritative guard.
    delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is 'Lets the signed-in user permanently delete their OWN account (auth + profile row). Blocked if they are the last active Admin. This is the only path Settings -> Danger Zone -> Delete My Account uses; there is no service-role key on the client.';


-- ============================================================
-- END settings-schema.sql
-- ============================================================


-- ============================================================
-- BEGIN backup-schema.sql
-- ============================================================

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

-- ============================================================
-- END backup-schema.sql
-- ============================================================


-- ============================================================
-- BEGIN reset-schema.sql
-- ============================================================

-- ============================================================
-- RMIMS — Admin Settings: Data Reset
-- ============================================================
-- ADDITIVE MIGRATION. Run this AFTER schema.sql,
-- user-management-schema.sql, material-activity-schema.sql,
-- settings-schema.sql, and backup-schema.sql. Does NOT modify or
-- drop any existing table, column, policy, or trigger.
--
-- Same atomicity reasoning as restore_backup() in
-- backup-schema.sql: a reset is destructive and must never be
-- allowed to half-complete. reset_system_data() runs every
-- delete for the requested scope inside one Postgres function,
-- which Postgres executes as a single transaction — any error
-- rolls back everything the function already deleted.
--
-- public.users and public.system_activity_log are NEVER
-- touched by this function, under any scope. That protection is
-- enforced in code below (an explicit check), not just left to
-- the caller's judgment.
-- ============================================================

create or replace function public.reset_system_data(scopes text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    counts jsonb := '{}'::jsonb;
    n      int;
begin
    if not public.is_active_admin() then
        raise exception 'Only an active Admin may reset system data.';
    end if;

    if scopes is null or array_length(scopes, 1) is null then
        raise exception 'No reset scope specified.';
    end if;

    if 'users' = any(scopes) or 'system_activity_log' = any(scopes) or 'backup_history' = any(scopes) then
        raise exception 'User accounts, the audit log, and backup history cannot be reset from here.';
    end if;

    -- ---- children first (product_material_requirements cascades
    -- automatically when materials/finished_products are deleted
    -- below, but it's cleared explicitly first so its count is
    -- captured and reported even when only one of its two parent
    -- scopes was selected) ----
    if 'materials' = any(scopes) or 'finished_products' = any(scopes) then
        select count(*) into n from public.product_material_requirements;
        counts := counts || jsonb_build_object('product_material_requirements', n);
        delete from public.product_material_requirements;
    end if;

    if 'stock_receipts' = any(scopes) then
        select count(*) into n from public.stock_receipts;
        counts := counts || jsonb_build_object('stock_receipts', n);
        delete from public.stock_receipts;
    end if;

    if 'usage_records' = any(scopes) then
        select count(*) into n from public.usage_records;
        counts := counts || jsonb_build_object('usage_records', n);
        delete from public.usage_records;
    end if;

    end if;

    if 'finished_products' = any(scopes) then
        select count(*) into n from public.finished_products;
        counts := counts || jsonb_build_object('finished_products', n);
        delete from public.finished_products;
    end if;

    if 'materials' = any(scopes) then
        select count(*) into n from public.materials;
        counts := counts || jsonb_build_object('materials', n);
        delete from public.materials;
    end if;

    insert into public.system_activity_log (admin_id, admin_name, admin_email, action, details)
    select auth.uid(), u.full_name, u.email, 'Reset system data', jsonb_build_object('scopes', to_jsonb(scopes), 'record_counts', counts)
    from public.users u where u.id = auth.uid();

    return counts;
end;
$$;

revoke all on function public.reset_system_data(text[]) from public;
grant execute on function public.reset_system_data(text[]) to authenticated;

comment on function public.reset_system_data(text[]) is 'Atomically deletes ONLY the operational tables named in scopes (materials, finished_products, product_material_requirements, stock_receipts, usage_records). Always refuses users, system_activity_log, and backup_history regardless of what is passed in. Every successful call is logged to system_activity_log with its scope and per-table row counts. Admin-only.';


-- ============================================================
-- END reset-schema.sql
-- ============================================================
