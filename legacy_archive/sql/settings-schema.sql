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
