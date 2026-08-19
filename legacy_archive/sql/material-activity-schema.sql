-- ============================================================
-- RMIMS — Material Activity + Finished Product Setup
-- ============================================================
-- ADDITIVE MIGRATION. Run this AFTER schema.sql.
--
-- Does NOT modify or drop any existing table, column, policy,
-- or trigger. Only:
--   (a) creates 2 new small tables (finished_products,
--       product_material_requirements), and
--       ADDING nullable columns (existing rows/queries unaffected).
--
-- Scope reminder (per approved thesis scope):
--   "Finished Product Setup" is a small supporting feature that
--   lives inside Inventory Management. It is NOT a Product
--   Management module. Its only job is to answer:
--   "What raw materials does this finished product need, and
--    how much?" — so Material Activity can look it up.
--
--   Material Activity is the new feature that records:
--   Receive (raw-material level) and Used (tied to a finished
--   product), reusing the EXISTING stock_receipts and
--   usage_records tables rather than creating new ones.
-- ============================================================


-- ------------------------------------------------------------
-- 1. FINISHED PRODUCTS  (Finished Product Setup — inside Inventory Management)
-- ------------------------------------------------------------
-- The selectable item IS the finished product (Pandesal, Cookies,
-- Cake, ...). Category is metadata used only to filter/search —
-- it is never a selectable hierarchy level.
create table if not exists public.finished_products (
    id              text primary key default gen_random_uuid()::text,
    product_name    text not null,
    category        text,
    unit            text,
    description     text,
    image_url       text,
    status          text not null default 'Active' check (status in ('Active','Inactive')),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

comment on table public.finished_products is
    'Minimal finished-product registry inside Inventory Management. Stores product name, optional category/unit/description, and optional compressed image data. Not a product/sales/costing module.';

-- Prevent duplicate product names (case-insensitive)
create unique index if not exists idx_finished_products_name_unique
    on public.finished_products (lower(product_name));

create index if not exists idx_finished_products_category on public.finished_products (category);
create index if not exists idx_finished_products_status on public.finished_products (status);


-- Existing installations: add the new display fields without removing data.
alter table public.finished_products
    add column if not exists unit text,
    add column if not exists description text;



-- ------------------------------------------------------------
-- 2. FINISHED PRODUCT — RAW MATERIAL REQUIREMENTS
-- ------------------------------------------------------------
-- Links a finished product to EXISTING materials rows. Never
-- creates a new/duplicate material record. The "Needed" quantity
-- lives here; it does NOT change when Receive/Used activity
-- happens — only when Admin edits this configuration.
create table if not exists public.product_material_requirements (
    id                  text primary key default gen_random_uuid()::text,
    product_id          text not null references public.finished_products(id) on delete cascade,
    material_id         text not null references public.materials(id) on delete cascade,
    required_quantity   numeric not null check (required_quantity > 0),
    unit                text,   -- denormalized snapshot of materials.unit at assignment time, for display stability
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

comment on table public.product_material_requirements is
    'One row = "Product X needs Y kg of Material Z". The material stock itself is owned entirely by public.materials — this table never stores or duplicates stock quantity.';

-- A material can only be assigned once per product (no duplicate rows for the same pair)
create unique index if not exists idx_pmr_product_material_unique
    on public.product_material_requirements (product_id, material_id);

create index if not exists idx_pmr_product_id on public.product_material_requirements (product_id);
create index if not exists idx_pmr_material_id on public.product_material_requirements (material_id);


-- ------------------------------------------------------------
-- 3. EXTEND usage_records — link "Used" activity to a finished product
-- ------------------------------------------------------------
-- usage_records already models exactly what "Used/Consumed" needs
-- (material, quantity, unit, date, remarks). We only add the
-- finished-product link and who recorded it. Existing rows get
-- NULL in these new columns and remain fully valid (e.g. legacy
-- consumption entries recorded before this module existed).
alter table public.usage_records
    add column if not exists product_id     text references public.finished_products(id) on delete set null,
    add column if not exists product_name   text,   -- denormalized snapshot for history, survives product edits/archival
    add column if not exists created_by     uuid references public.users(id) on delete set null;

comment on column public.usage_records.product_id is
    'Finished product this usage was recorded against. Required for NEW Material Activity "Used" entries; NULL for legacy/general consumption rows.';
comment on column public.usage_records.created_by is
    'Who recorded this activity (Activity History "Recorded By" column).';

create index if not exists idx_usage_records_product_id on public.usage_records (product_id);


-- ------------------------------------------------------------
-- 4. EXTEND stock_receipts — track who recorded a Receive
-- ------------------------------------------------------------
-- Receiving is raw-material-level only (no product selection
-- required, per spec) — so no product_id is added here.
alter table public.stock_receipts
    add column if not exists created_by uuid references public.users(id) on delete set null;

comment on column public.stock_receipts.created_by is
    'Who recorded this receipt (Activity History "Recorded By" column).';





-- ------------------------------------------------------------
-- 6. STOCK CAN NEVER GO NEGATIVE (defense in depth)
-- ------------------------------------------------------------
-- App-level validation already blocks over-using stock; this
-- constraint guarantees it at the database level too. Safe to
-- add since materials.quantity has always been managed as a
-- non-negative running total by the existing app.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'materials_quantity_non_negative'
    ) then
        alter table public.materials
            add constraint materials_quantity_non_negative check (quantity >= 0);
    end if;
end $$;


-- ------------------------------------------------------------
-- 7. CONVENIENCE VIEW — total required per material across products
-- ------------------------------------------------------------
-- Powers Admin Material Overview's "Total Required" column and
-- the auto-computed Status, without duplicating stock data.
create or replace view public.v_material_total_required as
select
    m.id                                    as material_id,
    m.material_name,
    m.unit,
    m.quantity                              as current_stock,
    m.minimum_threshold,
    m.status                                as legacy_status,
    coalesce(sum(pmr.required_quantity), 0) as total_required
from public.materials m
left join public.product_material_requirements pmr
    on pmr.material_id = m.id
group by m.id, m.material_name, m.unit, m.quantity, m.minimum_threshold, m.status;

comment on view public.v_material_total_required is
    'One row per material: current stock + sum of Needed across every finished product that uses it. Used by Material Activity (both Product Activity and Material Overview modes).';


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.finished_products               enable row level security;
alter table public.product_material_requirements    enable row level security;

-- ---- finished_products ----
-- Everyone signed in (admin + user) can READ — the User side
-- needs to list/select finished products.
drop policy if exists "finished_products_select_authenticated" on public.finished_products;
create policy "finished_products_select_authenticated"
    on public.finished_products for select
    using (auth.role() = 'authenticated');

-- Only admins can create/edit/archive finished products —
-- Finished Product Setup is an Admin-only feature inside
-- Inventory Management.
drop policy if exists "finished_products_write_admin_only" on public.finished_products;
create policy "finished_products_write_admin_only"
    on public.finished_products for insert
    with check (public.is_active_admin());

drop policy if exists "finished_products_update_admin_only" on public.finished_products;
create policy "finished_products_update_admin_only"
    on public.finished_products for update
    using (public.is_active_admin());

drop policy if exists "finished_products_delete_admin_only" on public.finished_products;
create policy "finished_products_delete_admin_only"
    on public.finished_products for delete
    using (public.is_active_admin());

-- ---- product_material_requirements ----
-- Same pattern: everyone can read (User side needs to know which
-- materials belong to the selected product); only admins configure it.
drop policy if exists "pmr_select_authenticated" on public.product_material_requirements;
create policy "pmr_select_authenticated"
    on public.product_material_requirements for select
    using (auth.role() = 'authenticated');

drop policy if exists "pmr_insert_admin_only" on public.product_material_requirements;
create policy "pmr_insert_admin_only"
    on public.product_material_requirements for insert
    with check (public.is_active_admin());

drop policy if exists "pmr_update_admin_only" on public.product_material_requirements;
create policy "pmr_update_admin_only"
    on public.product_material_requirements for update
    using (public.is_active_admin());

drop policy if exists "pmr_delete_admin_only" on public.product_material_requirements;
create policy "pmr_delete_admin_only"
    on public.product_material_requirements for delete
    using (public.is_active_admin());

-- their EXISTING policies from schema.sql untouched — both Admin
-- and User already have full authenticated read/write access there,
-- which is exactly what Receive/Used recording needs.


-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table public.finished_products;
alter publication supabase_realtime add table public.product_material_requirements;
-- realtime publication from schema.sql.


-- ============================================================
-- updated_at auto-touch (reuses existing touch_updated_at() function)
-- ============================================================
drop trigger if exists trg_finished_products_touch_updated_at on public.finished_products;
create trigger trg_finished_products_touch_updated_at
    before update on public.finished_products
    for each row execute function public.touch_updated_at();

drop trigger if exists trg_pmr_touch_updated_at on public.product_material_requirements;
create trigger trg_pmr_touch_updated_at
    before update on public.product_material_requirements
    for each row execute function public.touch_updated_at();
