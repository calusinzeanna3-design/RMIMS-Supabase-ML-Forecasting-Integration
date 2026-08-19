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
