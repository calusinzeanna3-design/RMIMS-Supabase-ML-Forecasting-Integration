-- ============================================================================
-- RMIMS FRESH SETUP — 04  MY INVENTORY: raw materials
-- ============================================================================
-- Starts EMPTY. Materials, stock, minimum stock, reorder and lead time are entered by the Manager.
--   Manager  adds / edits / deletes the materials of their own company
--   Staff    reads their company's materials (cannot change them)
--   Admin    reads every company (does not record stock)
-- Stock only moves through Receive / Disburse (files 05 and 06) or the Manager's own edit.
-- ============================================================================

CREATE TABLE public.raw_materials (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        TEXT NOT NULL REFERENCES public.companies(id),
    item_code         TEXT NOT NULL,
    name              TEXT NOT NULL,
    description       TEXT,
    category          TEXT,
    unit_of_measure   TEXT NOT NULL,
    current_stock     NUMERIC NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    minimum_threshold NUMERIC CHECK (minimum_threshold IS NULL OR minimum_threshold >= 0),
    reorder_quantity  NUMERIC CHECK (reorder_quantity IS NULL OR reorder_quantity > 0),
    lead_time_days    INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    date_added        DATE DEFAULT CURRENT_DATE,
    first_date        DATE DEFAULT CURRENT_DATE,
    last_updated      TIMESTAMPTZ NOT NULL DEFAULT now(),
    latest_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID DEFAULT auth.uid(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one code and one name per company (no duplicates)
CREATE UNIQUE INDEX uq_raw_materials_company_code ON public.raw_materials (company_id, upper(btrim(item_code)));
CREATE UNIQUE INDEX uq_raw_materials_company_name ON public.raw_materials (company_id, lower(btrim(name)));

-- company always from the signed-in Manager; code must use the company's SKU prefix; clean values
CREATE FUNCTION public.raw_materials_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prefix TEXT;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
        IF TG_OP = 'INSERT' THEN
            NEW.company_id := public.get_current_user_company_id();
            NEW.created_by := auth.uid();
        ELSE
            NEW.company_id := OLD.company_id;   -- a material never moves to another company
        END IF;
    END IF;
    IF NEW.company_id IS NULL THEN
        RAISE EXCEPTION 'RMIMS_DENIED: your account has no company.' USING ERRCODE = '42501';
    END IF;
    NEW.item_code := upper(btrim(NEW.item_code));
    NEW.name := btrim(NEW.name);
    IF NEW.item_code = '' OR NEW.name = '' THEN
        RAISE EXCEPTION 'RMIMS_INVALID: item code and material name are required.' USING ERRCODE = '23514';
    END IF;
    SELECT upper(btrim(sku_prefix)) INTO v_prefix FROM public.companies WHERE id = NEW.company_id;
    IF coalesce(v_prefix, '') <> '' AND NEW.item_code NOT LIKE v_prefix || '%' THEN
        RAISE EXCEPTION 'RMIMS_INVALID: item code % must start with %.', NEW.item_code, v_prefix USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_raw_materials_guard
BEFORE INSERT OR UPDATE ON public.raw_materials
FOR EACH ROW EXECUTE FUNCTION public.raw_materials_guard();

ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY materials_read ON public.raw_materials FOR SELECT TO authenticated
    USING (public.is_admin_user() OR company_id = public.get_current_user_company_id());
CREATE POLICY materials_manager_insert ON public.raw_materials FOR INSERT TO authenticated
    WITH CHECK (public.is_manager_user() AND company_id = public.get_current_user_company_id());
CREATE POLICY materials_manager_update ON public.raw_materials FOR UPDATE TO authenticated
    USING (public.is_manager_user() AND company_id = public.get_current_user_company_id())
    WITH CHECK (public.is_manager_user() AND company_id = public.get_current_user_company_id());
CREATE POLICY materials_manager_delete ON public.raw_materials FOR DELETE TO authenticated
    USING (public.is_manager_user() AND company_id = public.get_current_user_company_id());

REVOKE ALL ON public.raw_materials FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_materials TO authenticated;
GRANT ALL ON public.raw_materials TO service_role;
