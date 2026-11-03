-- ============================================================================
-- RMIMS FRESH SETUP — 05  RECEIVE: stock receipts (deliveries in)
-- ============================================================================
-- Starts EMPTY. Each row is one delivery entered by the Manager (or a Staff submission the Manager approved).
--   record_stock_receipt_v2  adds the delivery AND raises the material's stock in one step (Manager only)
--   reference_no             the system reference (e.g. 2026SMM-R0001), read from the "[Ref: …]" tag
--   finished_product_name    the finished product this delivery is for (linked automatically in file 07)
-- ============================================================================

CREATE TABLE public.stock_receipts (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id                 TEXT NOT NULL REFERENCES public.companies(id),
    receipt_date               DATE NOT NULL,
    material_id                UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
    received_quantity          NUMERIC NOT NULL CHECK (received_quantity > 0),
    unit                       TEXT NOT NULL,
    supplier_name              TEXT,
    reference_no               TEXT,
    finished_product_name      TEXT,
    finished_product_auto      BOOLEAN NOT NULL DEFAULT false,
    finished_product_split_of  UUID,
    finished_product_split_no  INT,
    finished_product_total_qty NUMERIC,
    received_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_receipts_company_date ON public.stock_receipts (company_id, receipt_date DESC);
CREATE INDEX idx_receipts_material     ON public.stock_receipts (material_id, receipt_date);
CREATE INDEX idx_receipts_reference    ON public.stock_receipts (reference_no);

-- company = the material's company; recorder = the signed-in user; reference read from the tag
CREATE FUNCTION public.stock_receipts_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    SELECT company_id INTO NEW.company_id FROM public.raw_materials WHERE id = NEW.material_id;
    IF NEW.company_id IS NULL THEN
        RAISE EXCEPTION 'RMIMS_INVALID: raw material not found.' USING ERRCODE = '23503';
    END IF;
    -- the recorder is the signed-in user (rows the database itself writes - shared rows of a record split
    -- between finished products, restored backups - keep their original recorder)
    IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND coalesce(current_setting('rmims.fp_sync', true), '') <> 'on' THEN
        NEW.received_by := auth.uid();
    END IF;
    NEW.reference_no := coalesce(substring(coalesce(NEW.supplier_name, '') from '\[Ref:\s*([^\]]+?)\s*\]'), NEW.reference_no);
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_stock_receipts_guard
BEFORE INSERT OR UPDATE ON public.stock_receipts
FOR EACH ROW EXECUTE FUNCTION public.stock_receipts_guard();

-- ---------------------------------------------------------------------------
-- RECORD A DELIVERY (stock + ledger + log in one transaction)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.record_stock_receipt_v2(
    p_material_id   UUID,
    p_receipt_date  DATE,
    p_quantity      NUMERIC,
    p_unit          TEXT,
    p_supplier_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_company TEXT;
    v_stock   NUMERIC;
    v_id      UUID;
BEGIN
    IF NOT public.is_manager_user() THEN
        RAISE EXCEPTION 'RMIMS_DENIED: only the Store Manager records deliveries.' USING ERRCODE = '42501';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'RMIMS_INVALID: received quantity must be greater than 0.' USING ERRCODE = '23514';
    END IF;
    IF p_receipt_date IS NULL OR p_receipt_date > CURRENT_DATE + 1 THEN
        RAISE EXCEPTION 'RMIMS_INVALID: receipt date is missing or in the future.' USING ERRCODE = '23514';
    END IF;
    SELECT company_id, current_stock INTO v_company, v_stock FROM public.raw_materials WHERE id = p_material_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'RMIMS_INVALID: raw material not found.' USING ERRCODE = '23503'; END IF;
    IF v_company IS DISTINCT FROM public.get_current_user_company_id() THEN
        RAISE EXCEPTION 'RMIMS_DENIED: this material belongs to another company.' USING ERRCODE = '42501';
    END IF;

    v_stock := v_stock + p_quantity;
    UPDATE public.raw_materials SET current_stock = v_stock, last_updated = now(), latest_date = now() WHERE id = p_material_id;

    INSERT INTO public.stock_receipts (company_id, receipt_date, material_id, received_quantity, unit, supplier_name)
    VALUES (v_company, p_receipt_date, p_material_id, p_quantity, p_unit, p_supplier_name)
    RETURNING id INTO v_id;

    INSERT INTO public.activity_audit_logs (company_id, action, entity_type, entity_id, details)
    VALUES (v_company, 'STOCK_RECEIPT', 'stock_receipts', p_material_id::text,
            jsonb_build_object('receipt_id', v_id, 'quantity', p_quantity, 'unit', p_unit, 'new_stock', v_stock,
                               'ref', substring(coalesce(p_supplier_name, '') from '\[Ref:\s*([^\]]+?)\s*\]')));

    RETURN jsonb_build_object('success', true, 'receipt_id', v_id, 'new_stock', v_stock);
END;
$$;

-- the finished product a delivery is for (the record is found by its system reference)
CREATE FUNCTION public.set_stock_receipt_finished_product(p_ref TEXT, p_finished_product_name TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n INT;
BEGIN
    IF NOT public.is_manager_user() THEN RETURN jsonb_build_object('success', false, 'code', 'NOT_MANAGER'); END IF;
    UPDATE public.stock_receipts
       SET finished_product_name = nullif(btrim(coalesce(p_finished_product_name, '')), '')
     WHERE reference_no = btrim(p_ref) AND company_id = public.get_current_user_company_id();
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN jsonb_build_object('success', n > 0, 'updated', n);
END;
$$;

ALTER TABLE public.stock_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY receipts_read ON public.stock_receipts FOR SELECT TO authenticated
    USING (public.is_admin_user() OR company_id = public.get_current_user_company_id());
CREATE POLICY receipts_manager_insert ON public.stock_receipts FOR INSERT TO authenticated
    WITH CHECK (public.is_manager_user() AND company_id = public.get_current_user_company_id());
CREATE POLICY receipts_manager_update ON public.stock_receipts FOR UPDATE TO authenticated
    USING (public.is_manager_user() AND company_id = public.get_current_user_company_id())
    WITH CHECK (public.is_manager_user() AND company_id = public.get_current_user_company_id());
CREATE POLICY receipts_manager_delete ON public.stock_receipts FOR DELETE TO authenticated
    USING (public.is_manager_user() AND company_id = public.get_current_user_company_id());

REVOKE ALL ON public.stock_receipts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_receipts TO authenticated;
GRANT ALL ON public.stock_receipts TO service_role;
REVOKE ALL ON FUNCTION public.record_stock_receipt_v2(UUID, DATE, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_stock_receipt_finished_product(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_receipt_v2(UUID, DATE, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_stock_receipt_finished_product(TEXT, TEXT) TO authenticated;
