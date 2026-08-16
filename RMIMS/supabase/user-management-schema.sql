-- ============================================================
-- RMIMS — Admin User Management support
-- ============================================================
-- ADDITIVE MIGRATION. Run this AFTER schema.sql (and after
-- material-activity-schema.sql, if applied — order between the
-- two does not matter, neither touches the other's objects).
--
-- Does NOT modify or drop any existing table, column, policy, or
-- trigger. Only ADDS nullable/defaulted columns to public.users
-- so existing rows and queries are unaffected, plus a trigger
-- reusing the touch_updated_at() function already created in
-- schema.sql.
--
-- Why these columns exist:
--   updated_at              — lets the Admin UI detect "this
--                              account was changed by someone
--                              else" (optimistic concurrency —
--                              see spec: two Admins editing the
--                              same account at once).
--   last_activity_at        — touched by auth-service.js on
--                              successful login; powers the
--                              "Last Activity" column.
--   deletion_request_status — 'none' | 'pending' | 'rejected' |
--                              'cancelled'. Intentionally NOT the
--                              same field as `status`
--                              (active/inactive), which already
--                              gates login — "Deletion Requested"
--                              is a request state layered on top
--                              of, not a replacement for, account
--                              status.
--   deletion_requested_at / deletion_reviewed_at /
--   deletion_reviewed_by    — audit trail for the review.
-- ============================================================

alter table public.users
    add column if not exists updated_at              timestamptz not null default now(),
    add column if not exists last_activity_at         timestamptz,
    add column if not exists deletion_request_status   text not null default 'none'
        check (deletion_request_status in ('none','pending','rejected','cancelled')),
    add column if not exists deletion_requested_at     timestamptz,
    add column if not exists deletion_reviewed_at      timestamptz,
    add column if not exists deletion_reviewed_by      uuid references public.users(id) on delete set null;

comment on column public.users.deletion_request_status is
    'Account-deletion request lifecycle, independent of `status` (active/inactive). Set to ''pending'' when the user requests deletion from their own account settings; Admin User Management reviews it.';

create index if not exists idx_users_role_status on public.users (role, status);
create index if not exists idx_users_deletion_request_status on public.users (deletion_request_status);

drop trigger if exists trg_users_touch_updated_at on public.users;
create trigger trg_users_touch_updated_at
    before update on public.users
    for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Guardrail: never allow the last ACTIVE ADMIN to be removed.
-- Enforced here (not only in the UI) so the rule holds even if a
-- future integration bypasses the front end.
-- ------------------------------------------------------------
create or replace function public.prevent_last_admin_removal()
returns trigger
language plpgsql
as $$
declare
    remaining_admins int;
begin
    -- Only relevant when an existing admin's protected access is being
    -- reduced: role changed away from 'admin', or status changed away
    -- from 'active'.
    if old.role = 'admin' and old.status = 'active'
       and (new.role <> 'admin' or new.status <> 'active') then

        select count(*) into remaining_admins
        from public.users
        where role = 'admin' and status = 'active' and id <> old.id;

        if remaining_admins = 0 then
            raise exception 'At least one active Admin account must remain.';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_prevent_last_admin_removal on public.users;
create trigger trg_prevent_last_admin_removal
    before update on public.users
    for each row execute function public.prevent_last_admin_removal();

-- Existing RLS policies from schema.sql already cover everything
-- this page needs:
--   users_select_own_or_admin — Admin can read every account.
--   users_update_own_or_admin — Admin can update any account
--                                (role / status / deletion_* columns).
-- No policy changes required.
