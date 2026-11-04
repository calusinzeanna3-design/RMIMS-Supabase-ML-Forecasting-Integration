-- ============================================================================
-- RMIMS — FINISHED PRODUCTS: ONE PRODUCT PER RECORD + SUPABASE TABLE   (run in the Supabase SQL editor)
-- ============================================================================
-- Run in this order:
--   STEP 1  (read-only)  preview the disbursement rows this script changes
--   STEP 2               everything else (table, access rule, clean-up) — run the rest of the file once
--
-- What it does
--   A. Finished products get their own table (public.finished_products), copied from what is already saved.
--      Saving / editing / deleting a formulation in My Inventory now writes here, so the deployed site and every
--      Manager / Staff device load the same list.
--   B. The company read rule lets Manager AND Staff read the saved formulations.
--   C. Clean-up of material_disbursements.finished_product_name (the rows in your v_finished_product_support view):
--        * the 4 rows you selected are REMOVED:  "—" (NB-001 and NB-004, 2026-11-02), "Nutribun" (NB-001, 2026-11-02)
--          and "NUTRIBUNNETS (FILLING), ..." (NB-004, 2026-10-01)
--        * the first entry ("NUTRICOOKIES, NUTRIBUNNETS ...", NB-001, 2026-10-01) is SPLIT into one row per finished
--          product (its quantity shared by each product's own recipe amount for that material; equal shares only if
--          the recipe amount was never entered). The total quantity stays exactly the same.
--        * any other "—" placeholder is cleared to empty (the row itself is kept)
--      Every changed or removed row is copied first to public._backup_finished_product_fix (nothing is lost).
--      raw_materials.current_stock is NOT changed (see the optional block at the end).
-- ============================================================================

-- ============================================================================
-- STEP 1 — PREVIEW (read-only). Check these are the rows you mean before running the rest.
-- ============================================================================
SELECT d.id, d.usage_date, rm.item_code, rm.name AS material, d.consumed_quantity, d.unit,
       d.finished_product_name, d.activity_type, d.created_at,
       CASE
         WHEN d.usage_date = DATE '2026-11-02' AND rm.item_code IN ('NB-001', 'NB-004') AND btrim(coalesce(d.finished_product_name, '')) IN ('—', '-') THEN 'REMOVE'
         WHEN d.usage_date = DATE '2026-11-02' AND rm.item_code = 'NB-001' AND btrim(d.finished_product_name) = 'Nutribun' THEN 'REMOVE'
         WHEN d.usage_date = DATE '2026-10-01' AND rm.item_code = 'NB-004' AND d.finished_product_name ILIKE 'NUTRIBUNNETS (FILLING),%' THEN 'REMOVE'
         WHEN d.finished_product_name LIKE '%,%' THEN 'SPLIT INTO ONE ROW PER PRODUCT'
         WHEN btrim(coalesce(d.finished_product_name, '')) IN ('—', '-') THEN 'CLEAR PLACEHOLDER'
       END AS action
  FROM public.material_disbursements d
  JOIN public.raw_materials rm ON rm.id = d.material_id
 WHERE btrim(coalesce(d.finished_product_name, '')) IN ('—', '-')
    OR d.finished_product_name LIKE '%,%'
    OR (d.usage_date = DATE '2026-11-02' AND rm.item_code = 'NB-001' AND btrim(d.finished_product_name) = 'Nutribun')
 ORDER BY d.usage_date, rm.item_code;

-- ============================================================================
-- STEP 2 — A. FINISHED PRODUCTS TABLE
-- ============================================================================
-- ============================================================================
-- RMIMS — FINISHED PRODUCTS: their own table (run once in the Supabase SQL editor; safe to re-run)
-- ============================================================================
-- Until now finished-product formulations were only stored as rows of activity_audit_logs. This gives them a
-- proper table so they are always kept, readable by every Manager and Staff device of the same company, and easy
-- to check. NOTHING existing is deleted: every formulation already in activity_audit_logs is copied in.
--
--   * One row per company + product name (company stamped by the database, never by the browser)
--   * Removed ONLY when a Manager deletes it (soft delete: deleted_at is set; the row stays)
--   * Read: active users of the same company. Write: that company's Manager (or the Admin).
-- ============================================================================

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

GRANT SELECT, INSERT, UPDATE ON public.finished_products TO authenticated;
REVOKE DELETE ON public.finished_products FROM authenticated;
REVOKE ALL ON public.finished_products FROM anon;

-- ---------------------------------------------------------------------------
-- Copy every formulation already saved in activity_audit_logs (latest version per company + name).
-- A product whose latest record is a user DELETE is copied as deleted.
-- ---------------------------------------------------------------------------
INSERT INTO public.finished_products (company_id, name, name_key, material_names, recipe_details, category, created_by, created_at, updated_at, deleted_at)
SELECT company_id,
       btrim(details->>'name'),
       lower(btrim(details->>'name')),
       COALESCE(details->'materialNames', '[]'::jsonb),
       COALESCE(details->'recipeDetails', '{}'::jsonb),
       details->>'category',
       user_id,
       created_at,
       created_at,
       CASE WHEN action = 'DELETE_FINISHED_PRODUCT' THEN created_at END
  FROM (
        SELECT DISTINCT ON (company_id, lower(btrim(details->>'name')))
               company_id, action, details, user_id, created_at
          FROM public.activity_audit_logs
         WHERE action IN ('UPSERT_FINISHED_PRODUCT', 'DELETE_FINISHED_PRODUCT')
           AND company_id IS NOT NULL
           AND coalesce(btrim(details->>'name'), '') <> ''
         ORDER BY company_id, lower(btrim(details->>'name')), created_at DESC
       ) latest
ON CONFLICT (company_id, name_key) DO NOTHING;

-- Live updates to every open Manager / Staff page
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'finished_products') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.finished_products;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- STEP 2 — B. Manager AND Staff may read saved formulations (same company, active accounts only)
-- ============================================================================
DROP POLICY IF EXISTS audit_company_sync_read ON public.activity_audit_logs;
CREATE POLICY audit_company_sync_read ON public.activity_audit_logs FOR SELECT TO authenticated
    USING (
        company_id = public.get_current_user_company_id()
        AND public.is_active_user()
        AND entity_type IN ('staff_transactions', 'raw_materials', 'stock_receipts', 'material_disbursements', 'finished_products')
    );

-- ============================================================================
-- STEP 2 — C. ONE FINISHED PRODUCT PER DISBURSEMENT ROW
-- ============================================================================
CREATE TABLE IF NOT EXISTS public._backup_finished_product_fix AS
    SELECT d.*, now() AS backed_up_at, ''::text AS fix_action
      FROM public.material_disbursements d WHERE false;

DO $$
DECLARE
    r          RECORD;
    names      TEXT[];
    needs      NUMERIC[];
    total_need NUMERIC;
    share      NUMERIC;
    given      NUMERIC;
    i          INT;
    ref_tag    TEXT;
    new_row    public.material_disbursements;
BEGIN
    -- C1. the 4 selected rows: back up, then remove
    FOR r IN
        SELECT d.* FROM public.material_disbursements d
          JOIN public.raw_materials rm ON rm.id = d.material_id
         WHERE (d.usage_date = DATE '2026-11-02' AND rm.item_code IN ('NB-001', 'NB-004') AND btrim(coalesce(d.finished_product_name, '')) IN ('—', '-'))
            OR (d.usage_date = DATE '2026-11-02' AND rm.item_code = 'NB-001' AND btrim(d.finished_product_name) = 'Nutribun')
            OR (d.usage_date = DATE '2026-10-01' AND rm.item_code = 'NB-004' AND d.finished_product_name ILIKE 'NUTRIBUNNETS (FILLING),%')
    LOOP
        INSERT INTO public._backup_finished_product_fix
            SELECT d.*, now(), 'removed' FROM public.material_disbursements d WHERE d.id = r.id;
        DELETE FROM public.material_disbursements WHERE id = r.id;
    END LOOP;

    -- C2. rows naming several products ("A, B"): one row per product, same total quantity
    FOR r IN
        SELECT d.*, rm.name AS mat_name FROM public.material_disbursements d
          JOIN public.raw_materials rm ON rm.id = d.material_id
         WHERE d.finished_product_name LIKE '%,%'
    LOOP
        INSERT INTO public._backup_finished_product_fix
            SELECT d.*, now(), 'split' FROM public.material_disbursements d WHERE d.id = r.id;

        SELECT array_agg(btrim(x)) INTO names
          FROM unnest(string_to_array(r.finished_product_name, ',')) AS x
         WHERE btrim(x) <> '';

        -- each product's own recipe amount for this material (from the saved formulation)
        needs := ARRAY[]::NUMERIC[];
        FOR i IN 1 .. array_length(names, 1) LOOP
            needs := needs || COALESCE((
                SELECT NULLIF(regexp_replace(COALESCE(fp.recipe_details -> r.mat_name ->> 'needPerUnit', ''), '[^0-9.]', '', 'g'), '')::NUMERIC
                  FROM public.finished_products fp
                 WHERE fp.company_id = r.company_id AND fp.name_key = lower(names[i]) AND fp.deleted_at IS NULL
                 LIMIT 1), 0);
        END LOOP;
        SELECT sum(x) INTO total_need FROM unnest(needs) x;
        IF total_need IS NULL OR total_need <= 0 OR 0 = ANY(needs) THEN
            needs := array_fill(1::NUMERIC, ARRAY[array_length(names, 1)]);   -- recipe amount missing: equal shares
            total_need := array_length(names, 1);
        END IF;

        given := 0;
        ref_tag := substring(coalesce(r.activity_type, '') from '\[Ref:\s*([^\]]+)\]');
        FOR i IN 1 .. array_length(names, 1) LOOP
            IF i < array_length(names, 1) THEN
                share := round(r.consumed_quantity * needs[i] / total_need, 4);
            ELSE
                share := r.consumed_quantity - given;          -- the last share takes the rounding remainder
            END IF;
            given := given + share;
            IF i = 1 THEN
                -- the original row keeps its id / reference and becomes the first product's row
                UPDATE public.material_disbursements
                   SET finished_product_name = names[1], consumed_quantity = share
                 WHERE id = r.id;
            ELSE
                new_row := jsonb_populate_record(NULL::public.material_disbursements,
                    to_jsonb((SELECT d FROM public.material_disbursements d WHERE d.id = r.id))
                    || jsonb_build_object(
                         'id', gen_random_uuid(),
                         'finished_product_name', names[i],
                         'consumed_quantity', share,
                         'activity_type', CASE WHEN ref_tag IS NULL THEN r.activity_type
                                               ELSE replace(r.activity_type, '[Ref: ' || ref_tag || ']', '[Ref: ' || ref_tag || '-' || i || ']') END));
                INSERT INTO public.material_disbursements SELECT new_row.*;
            END IF;
        END LOOP;
    END LOOP;

    -- C3. any other placeholder "—": clear the label only (row kept)
    INSERT INTO public._backup_finished_product_fix
        SELECT d.*, now(), 'placeholder cleared' FROM public.material_disbursements d
         WHERE btrim(coalesce(d.finished_product_name, '')) IN ('—', '-');
    UPDATE public.material_disbursements SET finished_product_name = NULL
     WHERE btrim(coalesce(finished_product_name, '')) IN ('—', '-');
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- CHECK (read-only)
-- ============================================================================
-- Finished products saved in Supabase, per company
SELECT company_id,
       count(*) FILTER (WHERE deleted_at IS NULL)     AS active_finished_products,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted_by_manager,
       string_agg(name, ', ' ORDER BY name) FILTER (WHERE deleted_at IS NULL) AS products
  FROM public.finished_products
 GROUP BY company_id;

-- What was changed (and can be restored from)
SELECT fix_action, usage_date, finished_product_name, consumed_quantity, unit, backed_up_at
  FROM public._backup_finished_product_fix ORDER BY backed_up_at DESC, usage_date;

-- ============================================================================
-- OPTIONAL — only if the REMOVED rows were real usage that never happened (test entries):
-- give their quantity back to the stock. Leave this commented out if they were duplicates of a real disbursement.
-- ============================================================================
-- UPDATE public.raw_materials rm
--    SET current_stock = rm.current_stock + b.qty, updated_at = now()
--   FROM (SELECT material_id, sum(consumed_quantity) AS qty
--           FROM public._backup_finished_product_fix WHERE fix_action = 'removed' GROUP BY material_id) b
--  WHERE rm.id = b.material_id;
