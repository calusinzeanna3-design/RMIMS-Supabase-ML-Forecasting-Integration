-- ============================================================================
-- RMIMS FRESH SETUP — 06  DISBURSE: material disbursements (usage out)
-- ============================================================================
-- Starts EMPTY. Each row is one usage entered by the Manager (or a Staff submission the Manager approved).
--   record_material_disbursement_v2  records the usage AND lowers the stock in one step (Manager only);
--                                    refuses when the stock is not enough
--   reference_no                     the system reference (e.g. 2026SMM-D0001), read from the "[Ref: …]" tag
--   finished_product_name            the finished product it was used for (one per row; file 07)
-- This table is what Analytics, Forecast and Reports compute consumption from.
-- ============================================================================

CREATE TABLE public.material_disbursements (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id                 TEXT NOT NULL REFERENCES public.companies(id),
    usage_date                 DATE NOT NULL,
    material_id                UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
    consumed_quantity          NUMERIC NOT NULL CHECK (consumed_quantity > 0),
    unit                       TEXT NOT NULL,
    activity_type              TEXT,
    reference_no               TEXT,
    finished_product_name      TEXT,
    finished_product_auto      BOOLEAN NOT NULL DEFAULT false,
    finished_product_split_of  UUID,
    finished_product_split_no  INT,
    finished_product_total_qty NUMERIC,
    recorded_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_disbursements_company_date ON public.material_disbursements (company_id, usage_date DESC);
CREATE INDEX idx_disbursements_material     ON public.material_disbursements (material_id, usage_date);
CREATE INDEX idx_disbursements_reference    ON public.material_disbursements (reference_no);

CREATE FUNCTION public.material_disbursements_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    SELECT company_id INTO NEW.company_id FROM public.raw_materials WHERE id = NEW.material_id;
    IF NEW.company_id IS NULL THEN
        RAISE EXCEPTION 'RMIMS_INVALID: raw material not found.' USING ERRCODE = '23503';
    END IF;
    -- the recorder is the signed-in user (rows the database itself writes - shared rows of a record split
    -- between finished products, restored backups - keep their original recorder)
    IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND coalesce(current_setting('rmims.fp_sync', true), '') <> 'on' THEN
        NEW.recorded_by := auth.uid();
    END IF;
    NEW.reference_no := coalesce(substring(coalesce(NEW.activity_type, '') from '\[Ref:\s*([^\]]+?)\s*\]'), NEW.reference_no);
    NEW.finished_product_name := nullif(btrim(coalesce(NEW.finished_product_name, '')), '');
    IF NEW.finished_product_name IN ('—', '-') THEN NEW.finished_product_name := NULL; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_material_disbursements_guard
BEFORE INSERT OR UPDATE ON public.material_disbursements
FOR EACH ROW EXECUTE FUNCTION public.material_disbursements_guard();

-- ---------------------------------------------------------------------------
-- RECORD A USAGE (stock + ledger + log in one transaction)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.record_material_disbursement_v2(
    p_material_id           UUID,
    p_usage_date            DATE,
    p_quantity              NUMERIC,
    p_unit                  TEXT,
    p_activity_type         TEXT DEFAULT NULL,
    p_finished_product_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_company TEXT;
    v_stock   NUMERIC;
    v_id      UUID;
BEGIN
    IF NOT public.is_manager_user() THEN
        RAISE EXCEPTION 'RMIMS_DENIED: only the Store Manager records disbursements.' USING ERRCODE = '42501';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'RMIMS_INVALID: disbursed quantity must be greater than 0.' USING ERRCODE = '23514';
    END IF;
    IF p_usage_date IS NULL OR p_usage_date > CURRENT_DATE + 1 THEN
        RAISE EXCEPTION 'RMIMS_INVALID: usage date is missing or in the future.' USING ERRCODE = '23514';
    END IF;
    SELECT company_id, current_stock INTO v_company, v_stock FROM public.raw_materials WHERE id = p_material_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'RMIMS_INVALID: raw material not found.' USING ERRCODE = '23503'; END IF;
    IF v_company IS DISTINCT FROM public.get_current_user_company_id() THEN
        RAISE EXCEPTION 'RMIMS_DENIED: this material belongs to another company.' USING ERRCODE = '42501';
    END IF;
    IF v_stock < p_quantity THEN
        RAISE EXCEPTION 'RMIMS_INSUFFICIENT_STOCK: available %, requested %.', v_stock, p_quantity USING ERRCODE = '23514';
    END IF;

    v_stock := v_stock - p_quantity;
    UPDATE public.raw_materials SET current_stock = v_stock, last_updated = now(), latest_date = now() WHERE id = p_material_id;

    INSERT INTO public.material_disbursements (company_id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name)
    VALUES (v_company, p_usage_date, p_material_id, p_quantity, p_unit, p_activity_type, p_finished_product_name)
    RETURNING id INTO v_id;

    INSERT INTO public.activity_audit_logs (company_id, action, entity_type, entity_id, details)
    VALUES (v_company, 'MATERIAL_DISBURSEMENT', 'material_disbursements', p_material_id::text,
            jsonb_build_object('usage_id', v_id, 'quantity', p_quantity, 'unit', p_unit, 'new_stock', v_stock,
                               'finished_product_name', p_finished_product_name,
                               'ref', substring(coalesce(p_activity_type, '') from '\[Ref:\s*([^\]]+?)\s*\]')));

    RETURN jsonb_build_object('success', true, 'usage_id', v_id, 'new_stock', v_stock);
END;
$$;

ALTER TABLE public.material_disbursements ENABLE ROW LEVEL SECURITY;
CREATE POLICY disbursements_read ON public.material_disbursements FOR SELECT TO authenticated
    USING (public.is_admin_user() OR company_id = public.get_current_user_company_id());
CREATE POLICY disbursements_manager_insert ON public.material_disbursements FOR INSERT TO authenticated
    WITH CHECK (public.is_manager_user() AND company_id = public.get_current_user_company_id());
CREATE POLICY disbursements_manager_update ON public.material_disbursements FOR UPDATE TO authenticated
    USING (public.is_manager_user() AND company_id = public.get_current_user_company_id())
    WITH CHECK (public.is_manager_user() AND company_id = public.get_current_user_company_id());
CREATE POLICY disbursements_manager_delete ON public.material_disbursements FOR DELETE TO authenticated
    USING (public.is_manager_user() AND company_id = public.get_current_user_company_id());

REVOKE ALL ON public.material_disbursements FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_disbursements TO authenticated;
GRANT ALL ON public.material_disbursements TO service_role;
REVOKE ALL ON FUNCTION public.record_material_disbursement_v2(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_material_disbursement_v2(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
