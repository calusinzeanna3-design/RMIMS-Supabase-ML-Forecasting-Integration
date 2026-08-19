-- ============================================================
-- RMIMS USER MATERIAL ACTIVITY — REQUIRED DATABASE FUNCTION
-- Run AFTER schema.sql and material-activity-schema.sql
-- This migration is additive and does not delete existing data.
-- ============================================================

create or replace function public.adjust_material_stock(
    p_material_id text,
    p_delta numeric
)
returns table (
    id text,
    quantity numeric,
    status text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_current numeric;
    v_threshold numeric;
    v_active boolean;
    v_new numeric;
    v_status text;
begin
    select m.quantity, m.minimum_threshold, coalesce(m.is_active, true)
      into v_current, v_threshold, v_active
      from public.materials m
     where m.id = p_material_id
     for update;

    if not found then
        raise exception 'material_not_found';
    end if;

    if v_active is false then
        raise exception 'material_inactive';
    end if;

    if p_delta is null or not isfinite(p_delta) then
        raise exception 'invalid_delta';
    end if;

    v_new := v_current + p_delta;

    if v_new < 0 then
        raise exception 'insufficient_stock:%', v_current;
    end if;

    if v_new <= v_threshold / 2 then
        v_status := 'Critical';
    elsif v_new <= v_threshold then
        v_status := 'Low';
    else
        v_status := 'Available';
    end if;

    update public.materials
       set quantity = v_new,
           status = v_status,
           updated_at = now()
     where id = p_material_id;

    return query
    select p_material_id, v_new, v_status;
end;
$$;

grant execute on function public.adjust_material_stock(text, numeric) to authenticated;

-- Ensure the user-facing activity history can record the authenticated user.
alter table public.usage_records
    add column if not exists created_by uuid references public.users(id) on delete set null;

alter table public.stock_receipts
    add column if not exists created_by uuid references public.users(id) on delete set null;

-- Finished-product linkage used by the integrated User Material Activity page.
alter table public.usage_records
    add column if not exists product_id text references public.finished_products(id) on delete set null;

alter table public.usage_records
    add column if not exists product_name text;

create index if not exists idx_usage_records_product_id
    on public.usage_records(product_id);

-- Backward-compatible display name for the existing User Activity UI.
-- created_by remains the canonical foreign-key identity.
alter table public.usage_records
    add column if not exists recorded_by text;

alter table public.stock_receipts
    add column if not exists recorded_by text;
