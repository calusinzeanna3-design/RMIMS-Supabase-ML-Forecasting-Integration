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

-- ---------------------------------------------------------------------------
-- CHECK (read-only): what Supabase holds for finished products
-- ---------------------------------------------------------------------------
SELECT company_id,
       count(*) FILTER (WHERE deleted_at IS NULL)     AS active_finished_products,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted_by_manager,
       string_agg(name, ', ' ORDER BY name) FILTER (WHERE deleted_at IS NULL) AS products
  FROM public.finished_products
 GROUP BY company_id;

SELECT action, count(*) AS audit_rows
  FROM public.activity_audit_logs
 WHERE action IN ('UPSERT_FINISHED_PRODUCT', 'DELETE_FINISHED_PRODUCT')
 GROUP BY action;
