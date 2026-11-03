-- ============================================================================
-- RMIMS — LET STAFF SEE THE MANAGER'S FINISHED PRODUCTS   (run once; safe to re-run)
-- Finished-product formulations are stored as shared records. The company security rule did not list
-- them, so staff could not read them and saw "No custom finished product formulations are linked".
-- Still company-only and active-users-only. Nothing is deleted or changed.
-- ============================================================================
DROP POLICY IF EXISTS audit_company_sync_read ON public.activity_audit_logs;
CREATE POLICY audit_company_sync_read ON public.activity_audit_logs FOR SELECT TO authenticated
    USING (
        company_id = public.get_current_user_company_id()
        AND public.is_active_user()
        AND entity_type IN ('staff_transactions', 'raw_materials', 'stock_receipts', 'material_disbursements', 'finished_products')
    );

-- CHECK: how many finished-product formulations exist (should be > 0 if the manager created some)
SELECT count(*) AS finished_product_records,
       count(DISTINCT lower(details->>'name')) AS distinct_products
  FROM public.activity_audit_logs
 WHERE action = 'UPSERT_FINISHED_PRODUCT';
