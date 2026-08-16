-- ============================================================
-- RMIMS — Supabase PostgreSQL Schema
-- ============================================================
-- Scope: Raw Materials Inventory Management with Consumption
-- Analytics ONLY. No cost/price fields, no supplier table
-- (supplier is a plain text field on materials), no 
-- integration. This defines the core RMIMS tables used by the application
-- in the existing RMIMS codebase:
--   users, materials, usageRecords, stockReceipts
-- ============================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. USERS
-- ------------------------------------------------------------
-- In Supabase, the user profile is linked to the authenticated account
-- uid. In Supabase, auth.users already has a uuid primary key, so
-- this profile table uses the SAME id (1:1, id = auth.uid()).
create table if not exists public.users (
    id          uuid primary key references auth.users(id) on delete cascade,
    full_name   text not null,
    email       text not null,
    role        text not null default 'user' check (role in ('admin','user')),
    status      text not null default 'inactive' check (status in ('active','inactive')),
    created_at  timestamptz not null default now()
);

comment on table public.users is 'Profile row per authenticated account. Role gates admin vs user pages; status gates login (must be active).';

-- NOTE ON PRIMARY KEYS: materials / usage_records / stock_receipts /
-- operational data use TEXT primary keys (not uuid) so that the ORIGINAL
-- Existing material IDs can be preserved when needed —
-- no foreign-key remapping needed between materials and its
-- usage_records/stock_receipts. New rows created after the migration
-- get a fresh random UUID string via the default below (matching
-- what generated IDs provide in the application).

-- ------------------------------------------------------------
-- 2. MATERIALS
-- ------------------------------------------------------------
create table if not exists public.materials (
    id                  text primary key default gen_random_uuid()::text,
    material_name       text not null,
    category            text not null,
    unit                text not null,
    quantity            numeric not null default 0,
    minimum_threshold   numeric not null default 0,
    supplier            text,                 -- supplier_name only, plain text (no suppliers table)
    storage_location    text,
    notes               text,
    status              text not null default 'Available' check (status in ('Available','Low','Critical')),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

comment on column public.materials.supplier is 'Supplier name only — free text. No dedicated supplier table by design.';
comment on column public.materials.status is 'Legacy status persisted for Dashboard/Analytics (Available/Low/Critical). Not the same as the UI-only Out-of-Stock display state, which is derived client-side from quantity.';

create index if not exists idx_materials_created_at on public.materials (created_at desc);
create index if not exists idx_materials_status on public.materials (status);
create index if not exists idx_materials_name on public.materials (lower(material_name));

-- ------------------------------------------------------------
-- 3. USAGE RECORDS / CONSUMPTION  (mirrors "usageRecords/{id}")
-- ------------------------------------------------------------
create table if not exists public.usage_records (
    id              text primary key default gen_random_uuid()::text,
    material_id     text references public.materials(id) on delete set null,
    material_name   text not null,
    used_quantity   numeric not null,
    unit            text,
    usage_date      date,
    remarks         text,
    created_at      timestamptz not null default now()
);

create index if not exists idx_usage_records_material_id on public.usage_records (material_id);
create index if not exists idx_usage_records_created_at on public.usage_records (created_at desc);

-- ------------------------------------------------------------
-- 4. STOCK RECEIPTS  (mirrors "stockReceipts/{id}")
-- ------------------------------------------------------------
create table if not exists public.stock_receipts (
    id                  text primary key default gen_random_uuid()::text,
    material_id         text references public.materials(id) on delete set null,
    material_name       text not null,
    received_quantity   numeric not null,
    unit                text,
    received_date       date,
    notes               text,
    created_at          timestamptz not null default now()
);

create index if not exists idx_stock_receipts_material_id on public.stock_receipts (material_id);
create index if not exists idx_stock_receipts_created_at on public.stock_receipts (created_at desc);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Access is controlled through Supabase Row Level Security policies
-- (open/default access). We take the opportunity to add sane
-- baseline RLS: any authenticated + active account can read/write
-- operational data (materials, usage, receipts) since
-- both admin and regular-user pages need this in the current app.
-- The users table is locked down: a user can only read/insert their
-- own row; only admins can update role/status for other accounts.
-- ============================================================

alter table public.users           enable row level security;
alter table public.materials       enable row level security;
alter table public.usage_records   enable row level security;
alter table public.stock_receipts  enable row level security;

-- Helper: is the current auth user an active admin?
create or replace function public.is_active_admin()
returns boolean
language sql
security definer
stable
as $$
    select exists (
        select 1 from public.users
        where id = auth.uid()
          and role = 'admin'
          and status = 'active'
    );
$$;

-- ---- users ----
drop policy if exists "users_select_own_or_admin" on public.users;
create policy "users_select_own_or_admin"
    on public.users for select
    using (id = auth.uid() or public.is_active_admin());

-- Lock down INSERT: Non-admin callers can only insert with role='user' and status='inactive'
drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own"
    on public.users for insert
    with check (
        id = auth.uid()
        and (
            public.is_active_admin()
            or (role = 'user' and status = 'inactive')
        )
    );

-- Lock down UPDATE: Admins can update any account; users can only update their own non-admin profile
drop policy if exists "users_update_own_or_admin" on public.users;
create policy "users_update_own_or_admin"
    on public.users for update
    using (id = auth.uid() or public.is_active_admin())
    with check (
        public.is_active_admin()
        or (id = auth.uid() and role = 'user')
    );

-- Trigger: Guard against direct admin / active creation on self-registration
create or replace function public.protect_user_insert()
returns trigger
language plpgsql
security definer
as $$
begin
    if auth.uid() is not null and not public.is_active_admin() then
        if new.role <> 'user' or new.status <> 'inactive' then
            raise exception 'Access Denied: Self-registered accounts must have role "user" and status "inactive".';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_protect_user_insert on public.users;
create trigger trg_protect_user_insert
    before insert on public.users
    for each row execute function public.protect_user_insert();

-- Trigger: Guard against unauthorized role or status tampering on existing accounts
create or replace function public.protect_user_roles_update()
returns trigger
language plpgsql
security definer
as $$
begin
    if (new.role is distinct from old.role or new.status is distinct from old.status) then
        if auth.uid() is not null and not public.is_active_admin() then
            raise exception 'Access Denied: Only active administrators can modify account role or status.';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_protect_user_roles_update on public.users;
create trigger trg_protect_user_roles_update
    before update on public.users
    for each row execute function public.protect_user_roles_update();

-- ---- materials / usage_records / stock_receipts / operational data ----
-- Any signed-in, active account (admin or user) may read and write.
-- Tighten later (e.g. restrict delete to admins) once roles are final.
drop policy if exists "materials_all_authenticated" on public.materials;
create policy "materials_all_authenticated"
    on public.materials for all
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

drop policy if exists "usage_records_all_authenticated" on public.usage_records;
create policy "usage_records_all_authenticated"
    on public.usage_records for all
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

drop policy if exists "stock_receipts_all_authenticated" on public.stock_receipts;
create policy "stock_receipts_all_authenticated"
    on public.stock_receipts for all
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');


-- ============================================================
-- REALTIME (dashboard.js uses live onSnapshot listeners)
-- ============================================================
alter publication supabase_realtime add table public.materials;
alter publication supabase_realtime add table public.usage_records;
alter publication supabase_realtime add table public.stock_receipts;

-- ============================================================
-- updated_at auto-touch for materials
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_materials_touch_updated_at on public.materials;
create trigger trg_materials_touch_updated_at
    before update on public.materials
    for each row execute function public.touch_updated_at();
