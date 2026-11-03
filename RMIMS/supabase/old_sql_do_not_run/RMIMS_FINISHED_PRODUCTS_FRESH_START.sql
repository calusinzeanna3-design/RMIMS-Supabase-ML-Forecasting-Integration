-- ============================================================================
-- RMIMS — FINISHED PRODUCTS: FRESH START + AUTO-SYNC  (run in the Supabase SQL editor; safe to re-run)
-- ============================================================================
-- Deploy the new app version FIRST, then run this whole file once.
--
--   1. Old finished products are removed (only the FIRST time this file runs — finished products the Manager
--      has entered since are never removed by a re-run).
--   2. public.finished_products is the one list of finished products: Manager saves = row inserted/updated,
--      Manager deletes = row removed.
--   3. AUTO-SYNC: every Disburse and Receive record (Manager and Staff, old and new) is linked to the finished
--      product it belongs to, using the Manager's own formulations (the raw materials in each product):
--        - one product uses the material -> that product
--        - several products use it       -> one row per product (quantity shared by each recipe amount;
--                                           the total never changes)
--        - no product uses it yet        -> filled in as soon as the Manager adds one that does
--      Records with an old name ("—", "Nutribun", "A, B", a deleted product) are re-linked the same way.
--      It keeps running by itself whenever a finished product or a record is saved.
--   4. The Manager's finished products are saved in Supabase (save_finished_product), so they load on every
--      device and every new deployment; v_finished_product_material_usage shows, per raw material, each finished
--      product that uses it, its limit per unit and the totals recorded for it.
--   5. Stock (raw_materials.current_stock) is never changed.
--
-- Every row changed is copied first to public._backup_fp_records, so nothing is lost.
-- ============================================================================

-- ============================================================================
-- STEP 1 — PREVIEW (read-only)
-- ============================================================================
SELECT 'disbursement records'                                   AS what, count(*) AS rows FROM public.material_disbursements
UNION ALL
SELECT 'disbursements with a blank / "—" finished product', count(*) FROM public.material_disbursements
 WHERE btrim(coalesce(finished_product_name, '')) IN ('', '—', '-')
UNION ALL
SELECT 'disbursements with a merged name ("A, B")', count(*) FROM public.material_disbursements WHERE finished_product_name LIKE '%,%'
UNION ALL
SELECT 'receipt records', count(*) FROM public.stock_receipts;


-- ============================================================================
-- STEP 2 — run everything below once
-- ============================================================================

-- 2-A. Finished products table (structure only — starts empty, nothing copied in)
CREATE TABLE IF NOT EXISTS public.finished_products (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id     TEXT NOT NULL,
    name           TEXT NOT NULL,
    name_key       TEXT NOT NULL,
    material_names JSONB NOT NULL DEFAULT '[]'::jsonb,
    recipe_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    category       TEXT,
    batch_units    NUMERIC,
    created_by     UUID DEFAULT auth.uid(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_finished_products_company_name ON public.finished_products (company_id, name_key);

CREATE OR REPLACE FUNCTION public.finished_products_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
        NEW.company_id := public.get_current_user_company_id();
    END IF;
    IF NEW.company_id IS NULL THEN
        NEW.company_id := public.get_current_user_company_id();
    END IF;
    NEW.name := btrim(NEW.name);
    NEW.name_key := lower(btrim(NEW.name));
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finished_products_stamp ON public.finished_products;
CREATE TRIGGER trg_finished_products_stamp
BEFORE INSERT OR UPDATE ON public.finished_products
FOR EACH ROW EXECUTE FUNCTION public.finished_products_stamp();

ALTER TABLE public.finished_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finished_products_read ON public.finished_products;
CREATE POLICY finished_products_read ON public.finished_products FOR SELECT TO authenticated
    USING ((company_id = public.get_current_user_company_id() AND public.is_active_user()) OR public.is_super_admin());

DROP POLICY IF EXISTS finished_products_manager_insert ON public.finished_products;
CREATE POLICY finished_products_manager_insert ON public.finished_products FOR INSERT TO authenticated
    WITH CHECK (public.is_manager_user() OR public.is_super_admin());

DROP POLICY IF EXISTS finished_products_manager_update ON public.finished_products;
CREATE POLICY finished_products_manager_update ON public.finished_products FOR UPDATE TO authenticated
    USING ((company_id = public.get_current_user_company_id() AND public.is_manager_user()) OR public.is_super_admin())
    WITH CHECK ((company_id = public.get_current_user_company_id() AND public.is_manager_user()) OR public.is_super_admin());

DROP POLICY IF EXISTS finished_products_manager_delete ON public.finished_products;
CREATE POLICY finished_products_manager_delete ON public.finished_products FOR DELETE TO authenticated
    USING ((company_id = public.get_current_user_company_id() AND public.is_manager_user()) OR public.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.finished_products TO authenticated;
REVOKE ALL ON public.finished_products FROM anon;

-- Manager deletes a finished product: the row AND its saved copies in the audit log are removed (own company only)
CREATE OR REPLACE FUNCTION public.delete_finished_product(p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_company TEXT := public.get_current_user_company_id();
    v_key     TEXT := lower(btrim(coalesce(p_name, '')));
    v_rows    INT;
    v_logs    INT;
BEGIN
    IF NOT (public.is_manager_user() OR public.is_super_admin()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only the Manager can delete a finished product.');
    END IF;
    IF v_key = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'No finished product name given.');
    END IF;
    DELETE FROM public.finished_products
     WHERE name_key = v_key AND (company_id = v_company OR public.is_super_admin());
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    DELETE FROM public.activity_audit_logs
     WHERE action IN ('UPSERT_FINISHED_PRODUCT', 'DELETE_FINISHED_PRODUCT')
       AND lower(btrim(details->>'name')) = v_key
       AND (company_id = v_company OR public.is_super_admin());
    GET DIAGNOSTICS v_logs = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'removed_rows', v_rows, 'removed_copies', v_logs);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_finished_product(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_finished_product(TEXT) TO authenticated;

-- Receive records the finished product too (one per receipt)
ALTER TABLE public.stock_receipts ADD COLUMN IF NOT EXISTS finished_product_name TEXT DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.set_stock_receipt_finished_product(p_ref TEXT, p_finished_product_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rows INT;
BEGIN
    IF NOT (public.is_manager_user() OR public.is_super_admin()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only the Manager records receipts.');
    END IF;
    IF coalesce(btrim(p_ref), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'No reference given.');
    END IF;
    UPDATE public.stock_receipts
       SET finished_product_name = NULLIF(btrim(coalesce(p_finished_product_name, '')), '')
     WHERE position('[Ref: ' || btrim(p_ref) || ']' IN coalesce(supplier_name, '')) > 0
       AND (to_jsonb(stock_receipts)->>'company_id' IS NULL
            OR to_jsonb(stock_receipts)->>'company_id' = public.get_current_user_company_id()
            OR public.is_super_admin());
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('success', v_rows > 0, 'updated', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.set_stock_receipt_finished_product(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_stock_receipt_finished_product(TEXT, TEXT) TO authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'finished_products') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.finished_products;
    END IF;
END $$;

-- Manager AND Staff of the same company can read what the Manager saves
DROP POLICY IF EXISTS audit_company_sync_read ON public.activity_audit_logs;
CREATE POLICY audit_company_sync_read ON public.activity_audit_logs FOR SELECT TO authenticated
    USING (
        company_id = public.get_current_user_company_id()
        AND public.is_active_user()
        AND entity_type IN ('staff_transactions', 'raw_materials', 'stock_receipts', 'material_disbursements', 'finished_products')
    );



-- 2-B. Backups (nothing is lost)
CREATE TABLE IF NOT EXISTS public._backup_fp_records (
    table_name   TEXT        NOT NULL,
    row_data     JSONB       NOT NULL,
    fix_action   TEXT        NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public._rmims_fp_fresh_start (done_at TIMESTAMPTZ NOT NULL DEFAULT now());


-- 2-C. Remove the old finished products (first run only) and bring back records removed by the earlier script
DO $$
DECLARE
    v_done BOOLEAN := EXISTS (SELECT 1 FROM public._rmims_fp_fresh_start);
BEGIN
    -- the earlier version of this file already cleared the old products -> do not clear the new ones
    IF NOT v_done AND to_regclass('public._backup_fp_audit_logs') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public._backup_fp_audit_logs)' INTO v_done;
    END IF;

    IF NOT v_done THEN
        INSERT INTO public._backup_fp_records (table_name, row_data, fix_action)
            SELECT 'finished_products', to_jsonb(f), 'old product removed' FROM public.finished_products f;
        DELETE FROM public.finished_products;

        INSERT INTO public._backup_fp_records (table_name, row_data, fix_action)
            SELECT 'activity_audit_logs', to_jsonb(a), 'old product copy removed' FROM public.activity_audit_logs a
             WHERE a.action IN ('UPSERT_FINISHED_PRODUCT', 'DELETE_FINISHED_PRODUCT');
        DELETE FROM public.activity_audit_logs
         WHERE action IN ('UPSERT_FINISHED_PRODUCT', 'DELETE_FINISHED_PRODUCT');
    END IF;
    INSERT INTO public._rmims_fp_fresh_start DEFAULT VALUES;

    -- records the earlier version removed come back (their stock was never reversed), to be linked below
    IF to_regclass('public._backup_fp_disbursements') IS NOT NULL THEN
        EXECUTE $q$
            INSERT INTO public.material_disbursements
            SELECT (jsonb_populate_record(NULL::public.material_disbursements,
                    to_jsonb(b) - 'backed_up_at' - 'fix_action' || jsonb_build_object('finished_product_name', NULL, 'finished_product_auto', false))).*
              FROM public._backup_fp_disbursements b
             WHERE b.fix_action = 'removed'
               AND NOT EXISTS (SELECT 1 FROM public.material_disbursements d WHERE d.id = b.id)
        $q$;
        EXECUTE $q$ UPDATE public._backup_fp_disbursements SET fix_action = 'removed (restored)' WHERE fix_action = 'removed' $q$;
    END IF;

    -- back up every record whose old name the auto-sync will replace
    INSERT INTO public._backup_fp_records (table_name, row_data, fix_action)
        SELECT 'material_disbursements', to_jsonb(d), 'old name relinked' FROM public.material_disbursements d
         WHERE d.finished_product_name IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.finished_products f
                            WHERE f.deleted_at IS NULL AND f.company_id = to_jsonb(d)->>'company_id'
                              AND f.name_key = lower(btrim(d.finished_product_name)));
END $$;

-- ============================================================================
-- STEP 2 — D. AUTO-SYNC: every record gets the finished product it belongs to (from the Manager's own input)
-- ============================================================================
-- Records (Disburse and Receive, Manager and Staff, old and new) are linked to the finished products the Manager
-- saved in My Inventory, using the raw materials in each formulation:
--   * the record already names one of the current finished products -> kept exactly as recorded
--   * blank / "—" / old or merged name ("A, B") / a product that was deleted -> linked automatically:
--       - one current product uses the material  -> that product
--       - several products use it                -> one row per product, the quantity shared by each product's
--                                                   recipe amount (equal shares if an amount is missing);
--                                                   the total quantity never changes
--       - no product uses the material yet       -> left empty until the Manager adds one that does
-- It runs by itself: whenever the Manager saves, edits or deletes a finished product, and whenever a record is
-- saved without one. raw_materials.current_stock is never touched.

ALTER TABLE public.material_disbursements ADD COLUMN IF NOT EXISTS finished_product_auto      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.material_disbursements ADD COLUMN IF NOT EXISTS finished_product_split_of  UUID;
ALTER TABLE public.material_disbursements ADD COLUMN IF NOT EXISTS finished_product_split_no  INT;
ALTER TABLE public.material_disbursements ADD COLUMN IF NOT EXISTS finished_product_total_qty NUMERIC;
ALTER TABLE public.stock_receipts         ADD COLUMN IF NOT EXISTS finished_product_auto      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.stock_receipts         ADD COLUMN IF NOT EXISTS finished_product_split_of  UUID;
ALTER TABLE public.stock_receipts         ADD COLUMN IF NOT EXISTS finished_product_split_no  INT;
ALTER TABLE public.stock_receipts         ADD COLUMN IF NOT EXISTS finished_product_total_qty NUMERIC;

CREATE OR REPLACE FUNCTION public.rmims_fp_num(p TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    RETURN NULLIF(regexp_replace(coalesce(p, ''), '[^0-9.]', '', 'g'), '')::numeric;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.rmims_fp_sync_disb(p_company TEXT DEFAULT NULL, p_row UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    p          public.material_disbursements;
    sib        public.material_disbursements;
    v_company  TEXT;
    v_mat      TEXT;
    v_names    TEXT[];
    v_needs    NUMERIC[];
    v_total    NUMERIC;
    v_sum_need NUMERIC;
    v_shares   NUMERIC[];
    v_given    NUMERIC;
    v_n        INT;
    v_i        INT;
    v_ref      TEXT;
    v_tag      TEXT;
    v_changed  INT := 0;
BEGIN
    PERFORM set_config('rmims.fp_sync', 'on', true);
    FOR p IN
        SELECT t.* FROM public.material_disbursements t
         WHERE t.finished_product_split_of IS NULL
           AND (p_row IS NULL OR t.id = p_row)
           AND (p_company IS NULL OR to_jsonb(t)->>'company_id' = p_company)
           AND (t.finished_product_auto
                OR NOT EXISTS (SELECT 1 FROM public.finished_products f
                                WHERE f.deleted_at IS NULL
                                  AND f.company_id = to_jsonb(t)->>'company_id'
                                  AND f.name_key = lower(btrim(coalesce(t.finished_product_name, '')))))
         FOR UPDATE
    LOOP
        v_company := to_jsonb(p)->>'company_id';
        SELECT rm.name INTO v_mat FROM public.raw_materials rm WHERE rm.id = p.material_id;

        -- the company's current finished products that use this raw material (the Manager's own formulations)
        SELECT array_agg(f.name ORDER BY f.name), array_agg(coalesce(n.need, 0) ORDER BY f.name)
          INTO v_names, v_needs
          FROM public.finished_products f
          LEFT JOIN LATERAL (
                SELECT public.rmims_fp_num(e.value->>'needPerUnit') AS need
                  FROM jsonb_each(CASE WHEN jsonb_typeof(f.recipe_details) = 'object' THEN f.recipe_details ELSE '{}'::jsonb END) e
                 WHERE lower(btrim(e.key)) = lower(btrim(coalesce(v_mat, '')))
                 LIMIT 1) n ON true
         WHERE f.deleted_at IS NULL
           AND f.company_id = v_company
           AND (EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.material_names) = 'array' THEN f.material_names ELSE '[]'::jsonb END) mn
                         WHERE lower(btrim(mn)) = lower(btrim(coalesce(v_mat, ''))))
                OR n.need IS NOT NULL);

        -- total quantity of this record (a record split earlier is put back together first)
        v_total := CASE WHEN p.finished_product_auto THEN coalesce(p.finished_product_total_qty, p.consumed_quantity) ELSE p.consumed_quantity END;
        v_n := coalesce(array_length(v_names, 1), 0);

        -- shares: by each product's recipe amount for this material; equal when a recipe amount is missing
        v_shares := ARRAY[]::NUMERIC[];
        IF v_n > 1 THEN
            SELECT sum(x) INTO v_sum_need FROM unnest(v_needs) x;
            IF EXISTS (SELECT 1 FROM unnest(v_needs) x WHERE x IS NULL OR x <= 0) THEN v_sum_need := 0; END IF;
            v_given := 0;
            FOR v_i IN 1 .. v_n LOOP
                IF v_i < v_n THEN
                    v_shares := v_shares || round(v_total * CASE WHEN v_sum_need > 0 THEN v_needs[v_i] / v_sum_need ELSE 1.0 / v_n END, 3);
                    v_given := v_given + v_shares[v_i];
                ELSE
                    v_shares := v_shares || round(v_total - v_given, 3);
                END IF;
            END LOOP;
            IF EXISTS (SELECT 1 FROM unnest(v_shares) x WHERE x <= 0) THEN
                v_names := v_names[1:1]; v_n := 1;     -- too small to share: one product keeps it
            END IF;
        END IF;

        IF v_n = 0 THEN
            -- no current product uses this material: put a split record back together, no stale name
            DELETE FROM public.material_disbursements WHERE finished_product_split_of = p.id;
            UPDATE public.material_disbursements
               SET finished_product_name = NULL, consumed_quantity = v_total,
                   finished_product_auto = true, finished_product_total_qty = v_total
             WHERE id = p.id
               AND (finished_product_name IS NOT NULL OR consumed_quantity <> v_total OR NOT finished_product_auto OR finished_product_total_qty IS DISTINCT FROM v_total);
        ELSE
            IF v_n = 1 THEN v_shares := ARRAY[v_total]; END IF;
            UPDATE public.material_disbursements
               SET finished_product_name = v_names[1], consumed_quantity = v_shares[1],
                   finished_product_auto = true, finished_product_total_qty = v_total
             WHERE id = p.id
               AND (finished_product_name IS DISTINCT FROM v_names[1] OR consumed_quantity <> v_shares[1] OR NOT finished_product_auto OR finished_product_total_qty IS DISTINCT FROM v_total);

            v_ref := substring(coalesce(p.activity_type, '') from '\[Ref:\s*([^\]]+?)\s*\]');
            FOR v_i IN 2 .. v_n LOOP
                v_tag := CASE WHEN v_ref IS NOT NULL
                              THEN regexp_replace(p.activity_type, '\[Ref:[^\]]*\]', '[Ref: ' || v_ref || '-' || v_i || ']')
                              ELSE btrim(coalesce(p.activity_type, '') || ' [Ref: ' || left(p.id::text, 8) || '-' || v_i || ']') END;
                SELECT * INTO sib FROM public.material_disbursements WHERE finished_product_split_of = p.id AND finished_product_split_no = v_i LIMIT 1;
                IF FOUND THEN
                    UPDATE public.material_disbursements
                       SET finished_product_name = v_names[v_i], consumed_quantity = v_shares[v_i], activity_type = v_tag
                     WHERE id = sib.id
                       AND (finished_product_name IS DISTINCT FROM v_names[v_i] OR consumed_quantity <> v_shares[v_i] OR activity_type IS DISTINCT FROM v_tag);
                ELSE
                    INSERT INTO public.material_disbursements
                    SELECT (jsonb_populate_record(NULL::public.material_disbursements,
                            to_jsonb(p) || jsonb_build_object(
                                'id', gen_random_uuid(),
                                'consumed_quantity', v_shares[v_i],
                                'finished_product_name', v_names[v_i],
                                'activity_type', v_tag,
                                'finished_product_auto', true,
                                'finished_product_split_of', p.id,
                                'finished_product_split_no', v_i,
                                'finished_product_total_qty', NULL))).*;
                END IF;
            END LOOP;
            DELETE FROM public.material_disbursements WHERE finished_product_split_of = p.id AND finished_product_split_no > v_n;
        END IF;
        v_changed := v_changed + 1;
    END LOOP;
    RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.rmims_fp_sync_rec(p_company TEXT DEFAULT NULL, p_row UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    p          public.stock_receipts;
    sib        public.stock_receipts;
    v_company  TEXT;
    v_mat      TEXT;
    v_names    TEXT[];
    v_needs    NUMERIC[];
    v_total    NUMERIC;
    v_sum_need NUMERIC;
    v_shares   NUMERIC[];
    v_given    NUMERIC;
    v_n        INT;
    v_i        INT;
    v_ref      TEXT;
    v_tag      TEXT;
    v_changed  INT := 0;
BEGIN
    PERFORM set_config('rmims.fp_sync', 'on', true);
    FOR p IN
        SELECT t.* FROM public.stock_receipts t
         WHERE t.finished_product_split_of IS NULL
           AND (p_row IS NULL OR t.id = p_row)
           AND (p_company IS NULL OR to_jsonb(t)->>'company_id' = p_company)
           AND (t.finished_product_auto
                OR NOT EXISTS (SELECT 1 FROM public.finished_products f
                                WHERE f.deleted_at IS NULL
                                  AND f.company_id = to_jsonb(t)->>'company_id'
                                  AND f.name_key = lower(btrim(coalesce(t.finished_product_name, '')))))
         FOR UPDATE
    LOOP
        v_company := to_jsonb(p)->>'company_id';
        SELECT rm.name INTO v_mat FROM public.raw_materials rm WHERE rm.id = p.material_id;

        -- the company's current finished products that use this raw material (the Manager's own formulations)
        SELECT array_agg(f.name ORDER BY f.name), array_agg(coalesce(n.need, 0) ORDER BY f.name)
          INTO v_names, v_needs
          FROM public.finished_products f
          LEFT JOIN LATERAL (
                SELECT public.rmims_fp_num(e.value->>'needPerUnit') AS need
                  FROM jsonb_each(CASE WHEN jsonb_typeof(f.recipe_details) = 'object' THEN f.recipe_details ELSE '{}'::jsonb END) e
                 WHERE lower(btrim(e.key)) = lower(btrim(coalesce(v_mat, '')))
                 LIMIT 1) n ON true
         WHERE f.deleted_at IS NULL
           AND f.company_id = v_company
           AND (EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.material_names) = 'array' THEN f.material_names ELSE '[]'::jsonb END) mn
                         WHERE lower(btrim(mn)) = lower(btrim(coalesce(v_mat, ''))))
                OR n.need IS NOT NULL);

        -- total quantity of this record (a record split earlier is put back together first)
        v_total := CASE WHEN p.finished_product_auto THEN coalesce(p.finished_product_total_qty, p.received_quantity) ELSE p.received_quantity END;
        v_n := coalesce(array_length(v_names, 1), 0);

        -- shares: by each product's recipe amount for this material; equal when a recipe amount is missing
        v_shares := ARRAY[]::NUMERIC[];
        IF v_n > 1 THEN
            SELECT sum(x) INTO v_sum_need FROM unnest(v_needs) x;
            IF EXISTS (SELECT 1 FROM unnest(v_needs) x WHERE x IS NULL OR x <= 0) THEN v_sum_need := 0; END IF;
            v_given := 0;
            FOR v_i IN 1 .. v_n LOOP
                IF v_i < v_n THEN
                    v_shares := v_shares || round(v_total * CASE WHEN v_sum_need > 0 THEN v_needs[v_i] / v_sum_need ELSE 1.0 / v_n END, 3);
                    v_given := v_given + v_shares[v_i];
                ELSE
                    v_shares := v_shares || round(v_total - v_given, 3);
                END IF;
            END LOOP;
            IF EXISTS (SELECT 1 FROM unnest(v_shares) x WHERE x <= 0) THEN
                v_names := v_names[1:1]; v_n := 1;     -- too small to share: one product keeps it
            END IF;
        END IF;

        IF v_n = 0 THEN
            -- no current product uses this material: put a split record back together, no stale name
            DELETE FROM public.stock_receipts WHERE finished_product_split_of = p.id;
            UPDATE public.stock_receipts
               SET finished_product_name = NULL, received_quantity = v_total,
                   finished_product_auto = true, finished_product_total_qty = v_total
             WHERE id = p.id
               AND (finished_product_name IS NOT NULL OR received_quantity <> v_total OR NOT finished_product_auto OR finished_product_total_qty IS DISTINCT FROM v_total);
        ELSE
            IF v_n = 1 THEN v_shares := ARRAY[v_total]; END IF;
            UPDATE public.stock_receipts
               SET finished_product_name = v_names[1], received_quantity = v_shares[1],
                   finished_product_auto = true, finished_product_total_qty = v_total
             WHERE id = p.id
               AND (finished_product_name IS DISTINCT FROM v_names[1] OR received_quantity <> v_shares[1] OR NOT finished_product_auto OR finished_product_total_qty IS DISTINCT FROM v_total);

            v_ref := substring(coalesce(p.supplier_name, '') from '\[Ref:\s*([^\]]+?)\s*\]');
            FOR v_i IN 2 .. v_n LOOP
                v_tag := CASE WHEN v_ref IS NOT NULL
                              THEN regexp_replace(p.supplier_name, '\[Ref:[^\]]*\]', '[Ref: ' || v_ref || '-' || v_i || ']')
                              ELSE btrim(coalesce(p.supplier_name, '') || ' [Ref: ' || left(p.id::text, 8) || '-' || v_i || ']') END;
                SELECT * INTO sib FROM public.stock_receipts WHERE finished_product_split_of = p.id AND finished_product_split_no = v_i LIMIT 1;
                IF FOUND THEN
                    UPDATE public.stock_receipts
                       SET finished_product_name = v_names[v_i], received_quantity = v_shares[v_i], supplier_name = v_tag
                     WHERE id = sib.id
                       AND (finished_product_name IS DISTINCT FROM v_names[v_i] OR received_quantity <> v_shares[v_i] OR supplier_name IS DISTINCT FROM v_tag);
                ELSE
                    INSERT INTO public.stock_receipts
                    SELECT (jsonb_populate_record(NULL::public.stock_receipts,
                            to_jsonb(p) || jsonb_build_object(
                                'id', gen_random_uuid(),
                                'received_quantity', v_shares[v_i],
                                'finished_product_name', v_names[v_i],
                                'supplier_name', v_tag,
                                'finished_product_auto', true,
                                'finished_product_split_of', p.id,
                                'finished_product_split_no', v_i,
                                'finished_product_total_qty', NULL))).*;
                END IF;
            END LOOP;
            DELETE FROM public.stock_receipts WHERE finished_product_split_of = p.id AND finished_product_split_no > v_n;
        END IF;
        v_changed := v_changed + 1;
    END LOOP;
    RETURN v_changed;
END;
$$;

-- Sync one company (or every company when called from this editor)
CREATE OR REPLACE FUNCTION public.rmims_sync_finished_products(p_company TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_d INT; v_r INT;
BEGIN
    v_d := public.rmims_fp_sync_disb(p_company, NULL);
    v_r := public.rmims_fp_sync_rec(p_company, NULL);
    RETURN jsonb_build_object('success', true, 'disbursements_checked', v_d, 'receipts_checked', v_r);
END;
$$;
REVOKE ALL ON FUNCTION public.rmims_sync_finished_products(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rmims_sync_finished_products(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.rmims_fp_sync_disb(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rmims_fp_sync_rec(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- Manager saves / edits / deletes a finished product -> that company's records follow
CREATE OR REPLACE FUNCTION public.trg_rmims_fp_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.rmims_sync_finished_products(coalesce(NEW.company_id, OLD.company_id));
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_finished_products_sync_records ON public.finished_products;
CREATE TRIGGER trg_finished_products_sync_records
AFTER INSERT OR UPDATE OR DELETE ON public.finished_products
FOR EACH ROW EXECUTE FUNCTION public.trg_rmims_fp_changed();

-- A record saved without a current finished product -> linked right away
CREATE OR REPLACE FUNCTION public.trg_rmims_record_fp_disb()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.finished_product_split_of IS NULL THEN
        PERFORM public.rmims_fp_sync_disb(NULL, NEW.id);
    END IF;
    RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.trg_rmims_record_fp_rec()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.finished_product_split_of IS NULL THEN
        PERFORM public.rmims_fp_sync_rec(NULL, NEW.id);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_material_disbursements_fp_link ON public.material_disbursements;
CREATE TRIGGER trg_material_disbursements_fp_link
AFTER INSERT ON public.material_disbursements
FOR EACH ROW EXECUTE FUNCTION public.trg_rmims_record_fp_disb();
DROP TRIGGER IF EXISTS trg_stock_receipts_fp_link ON public.stock_receipts;
CREATE TRIGGER trg_stock_receipts_fp_link
AFTER INSERT ON public.stock_receipts
FOR EACH ROW EXECUTE FUNCTION public.trg_rmims_record_fp_rec();

-- A user who edits a record's quantity or finished product takes it over (the auto-link no longer changes it)
CREATE OR REPLACE FUNCTION public.trg_rmims_record_user_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    o JSONB := to_jsonb(OLD);
    n JSONB := to_jsonb(NEW);
    q TEXT := CASE WHEN TG_TABLE_NAME = 'stock_receipts' THEN 'received_quantity' ELSE 'consumed_quantity' END;
BEGIN
    IF coalesce(current_setting('rmims.fp_sync', true), '') <> 'on'
       AND ((o->>q) IS DISTINCT FROM (n->>q) OR (o->>'finished_product_name') IS DISTINCT FROM (n->>'finished_product_name')) THEN
        NEW.finished_product_auto := false;
        NEW.finished_product_total_qty := NULL;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_material_disbursements_fp_user_edit ON public.material_disbursements;
CREATE TRIGGER trg_material_disbursements_fp_user_edit
BEFORE UPDATE ON public.material_disbursements
FOR EACH ROW EXECUTE FUNCTION public.trg_rmims_record_user_edit();
DROP TRIGGER IF EXISTS trg_stock_receipts_fp_user_edit ON public.stock_receipts;
CREATE TRIGGER trg_stock_receipts_fp_user_edit
BEFORE UPDATE ON public.stock_receipts
FOR EACH ROW EXECUTE FUNCTION public.trg_rmims_record_user_edit();

-- Live: split rows reach every open page
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'material_disbursements') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.material_disbursements;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'stock_receipts') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_receipts;
        END IF;
    END IF;
END $$;

-- Link every existing record now (records stay empty only until the Manager adds the finished products)
SELECT public.rmims_sync_finished_products(NULL);

-- ============================================================================
-- STEP 2 — E. SAVING THE MANAGER'S INPUT (kept in Supabase, loads on every device / new deployment)
-- ============================================================================
-- The system saves each finished product through this function: one row per company + product name, edited in
-- place, so a formulation (its raw materials and the limit per unit of each) never disappears or duplicates.
CREATE OR REPLACE FUNCTION public.save_finished_product(
    p_name           TEXT,
    p_material_names JSONB   DEFAULT '[]'::jsonb,
    p_recipe_details JSONB   DEFAULT '{}'::jsonb,
    p_category       TEXT    DEFAULT NULL,
    p_batch_units    NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_company TEXT := public.get_current_user_company_id();
    v_name    TEXT := btrim(coalesce(p_name, ''));
    v_id      UUID;
BEGIN
    IF NOT (public.is_manager_user() OR public.is_super_admin()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only the Manager can save a finished product.');
    END IF;
    IF v_name = '' OR v_company IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Finished product name or company missing.');
    END IF;
    INSERT INTO public.finished_products (company_id, name, name_key, material_names, recipe_details, category, batch_units, deleted_at)
    VALUES (v_company, v_name, lower(v_name),
            CASE WHEN jsonb_typeof(p_material_names) = 'array' THEN p_material_names ELSE '[]'::jsonb END,
            CASE WHEN jsonb_typeof(p_recipe_details) = 'object' THEN p_recipe_details ELSE '{}'::jsonb END,
            p_category, p_batch_units, NULL)
    ON CONFLICT (company_id, name_key) DO UPDATE
       SET name = EXCLUDED.name,
           material_names = EXCLUDED.material_names,
           recipe_details = EXCLUDED.recipe_details,
           category = EXCLUDED.category,
           batch_units = EXCLUDED.batch_units,
           deleted_at = NULL
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.save_finished_product(TEXT, JSONB, JSONB, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_finished_product(TEXT, JSONB, JSONB, TEXT, NUMERIC) TO authenticated;

-- Per raw material: every finished product that uses it, its limit per unit, and the total recorded for it
CREATE OR REPLACE VIEW public.v_finished_product_material_usage
WITH (security_invoker = true) AS
SELECT f.company_id,
       f.name                                              AS finished_product,
       rm.item_code,
       rm.name                                             AS raw_material,
       public.rmims_fp_num(e.value->>'needPerUnit')        AS limit_per_unit,
       to_jsonb(rm)->>'unit_of_measure'                    AS unit,
       coalesce((SELECT sum(d.consumed_quantity) FROM public.material_disbursements d
                  WHERE d.material_id = rm.id AND lower(btrim(coalesce(d.finished_product_name, ''))) = f.name_key), 0) AS total_disbursed,
       coalesce((SELECT sum(r.received_quantity) FROM public.stock_receipts r
                  WHERE r.material_id = rm.id AND lower(btrim(coalesce(r.finished_product_name, ''))) = f.name_key), 0)  AS total_received
  FROM public.finished_products f
  JOIN public.raw_materials rm
    ON to_jsonb(rm)->>'company_id' IS NOT DISTINCT FROM f.company_id
   AND (EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.material_names) = 'array' THEN f.material_names ELSE '[]'::jsonb END) mn
                 WHERE lower(btrim(mn)) = lower(btrim(rm.name)))
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(f.recipe_details) = 'object' THEN f.recipe_details ELSE '{}'::jsonb END) k
                    WHERE lower(btrim(k)) = lower(btrim(rm.name))))
  LEFT JOIN LATERAL (SELECT e.* FROM jsonb_each(CASE WHEN jsonb_typeof(f.recipe_details) = 'object' THEN f.recipe_details ELSE '{}'::jsonb END) e
                      WHERE lower(btrim(e.key)) = lower(btrim(rm.name)) LIMIT 1) e ON true
 WHERE f.deleted_at IS NULL;
GRANT SELECT ON public.v_finished_product_material_usage TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- CHECK (read-only)
-- ============================================================================
SELECT company_id, count(*) AS finished_products, string_agg(name, ', ' ORDER BY name) AS products
  FROM public.finished_products WHERE deleted_at IS NULL GROUP BY company_id;

-- every record and the finished product it is linked to (empty only where no product uses that material yet)
SELECT d.usage_date, rm.item_code, rm.name AS raw_material, d.finished_product_name, d.consumed_quantity, d.unit,
       CASE WHEN d.finished_product_split_of IS NOT NULL THEN 'shared row' WHEN d.finished_product_auto THEN 'auto-linked' ELSE 'as recorded' END AS link
  FROM public.material_disbursements d JOIN public.raw_materials rm ON rm.id = d.material_id
 ORDER BY d.usage_date DESC, rm.item_code;

-- per raw material: finished products, limit per unit and totals
SELECT * FROM public.v_finished_product_material_usage ORDER BY item_code, finished_product;

-- manually re-run the link at any time
-- SELECT public.rmims_sync_finished_products(NULL);
