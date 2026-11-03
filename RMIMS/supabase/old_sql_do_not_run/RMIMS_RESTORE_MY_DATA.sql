-- ============================================================================
-- RMIMS — BRING BACK MY DATA  (finished products, receipts, disbursements, raw materials, staff requests)
-- Run ONCE in Supabase > SQL Editor. SAFE: it never deletes anything and never changes quantities.
-- Why data "disappears": the company security rule only shows rows whose company_id matches your company.
-- Rows saved before companies existed have an EMPTY company_id, so they are still in the database but hidden.
-- This file gives those rows back to the company of the person who entered them.
-- Run RMIMS_RBAC_MULTI_COMPANY_SETUP.sql and RMIMS_COMPANY_ASSIGNMENT_SAFE.sql first if you have not.
-- ============================================================================
BEGIN;

-- 1. Receipts and disbursements follow their raw material
UPDATE public.stock_receipts r SET company_id = m.company_id
  FROM public.raw_materials m
 WHERE r.material_id = m.id AND r.company_id IS NULL AND m.company_id IS NOT NULL;
UPDATE public.material_disbursements d SET company_id = m.company_id
  FROM public.raw_materials m
 WHERE d.material_id = m.id AND d.company_id IS NULL AND m.company_id IS NOT NULL;

-- 2. Finished products / staff requests / ledger records are stored as shared records: they follow the user who wrote them
UPDATE public.activity_audit_logs l SET company_id = p.company_id
  FROM public.user_profiles p
 WHERE l.user_id = p.id AND l.company_id IS NULL AND p.company_id IS NOT NULL
   AND NOT (p.role = 'admin' OR lower(coalesce(p.operational_role, '')) IN ('admin', 'super_admin'));

-- 3. Records whose writer cannot be matched: if only ONE company has users, they belong to it
DO $$
DECLARE only_company text; n int;
BEGIN
  SELECT count(DISTINCT company_id) INTO n FROM public.user_profiles
   WHERE company_id IS NOT NULL AND NOT (role = 'admin' OR lower(coalesce(operational_role,'')) IN ('admin','super_admin'));
  IF n = 1 THEN
    SELECT DISTINCT company_id INTO only_company FROM public.user_profiles
     WHERE company_id IS NOT NULL AND NOT (role = 'admin' OR lower(coalesce(operational_role,'')) IN ('admin','super_admin'));
    UPDATE public.activity_audit_logs SET company_id = only_company
     WHERE company_id IS NULL
       AND (action IN ('UPSERT_FINISHED_PRODUCT','DELETE_STAFF_TRANSACTION','STAFF_TX_STATE')
            OR entity_type IN ('finished_products','staff_transactions','raw_materials','stock_receipts','material_disbursements'));
    UPDATE public.raw_materials SET company_id = only_company WHERE company_id IS NULL;
    UPDATE public.stock_receipts SET company_id = only_company WHERE company_id IS NULL;
    UPDATE public.material_disbursements SET company_id = only_company WHERE company_id IS NULL;
  END IF;
END $$;

-- 4. Let managers AND staff read the shared records of their company (finished products included)
DROP POLICY IF EXISTS audit_company_sync_read ON public.activity_audit_logs;
CREATE POLICY audit_company_sync_read ON public.activity_audit_logs FOR SELECT TO authenticated
    USING (
        company_id = public.get_current_user_company_id()
        AND public.is_active_user()
        AND (entity_type IN ('staff_transactions', 'raw_materials', 'stock_receipts', 'material_disbursements', 'finished_products')
             OR action IN ('UPSERT_FINISHED_PRODUCT', 'DELETE_STAFF_TRANSACTION', 'STAFF_TX_STATE'))
    );

COMMIT;

-- 5. OPTIONAL — disbursements that the earlier clean-up moved to a backup table (only if you WANT them back).
--    Remove the leading "--" from the next 4 lines to restore them:
-- INSERT INTO public.material_disbursements
--   SELECT (jsonb_populate_record(NULL::public.material_disbursements, to_jsonb(b) - 'removed_at')).*
--     FROM public._backup_removed_disbursements b
--  WHERE NOT EXISTS (SELECT 1 FROM public.material_disbursements x WHERE x.id = b.id);

-- 6. CHECK — everything should now be greater than 0 and "still_hidden" should be 0
SELECT 'raw_materials' AS what, count(*) AS total, count(*) FILTER (WHERE company_id IS NULL) AS still_hidden FROM public.raw_materials
UNION ALL SELECT 'stock_receipts', count(*), count(*) FILTER (WHERE company_id IS NULL) FROM public.stock_receipts
UNION ALL SELECT 'material_disbursements', count(*), count(*) FILTER (WHERE company_id IS NULL) FROM public.material_disbursements
UNION ALL SELECT 'finished_product_records', count(*), count(*) FILTER (WHERE company_id IS NULL) FROM public.activity_audit_logs WHERE action = 'UPSERT_FINISHED_PRODUCT'
UNION ALL SELECT 'staff_requests', count(*), count(*) FILTER (WHERE company_id IS NULL) FROM public.activity_audit_logs WHERE entity_type = 'staff_transactions';
