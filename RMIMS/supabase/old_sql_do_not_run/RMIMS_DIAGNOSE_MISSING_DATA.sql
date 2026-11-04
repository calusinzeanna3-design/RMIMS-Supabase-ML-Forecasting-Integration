-- ============================================================================
-- RMIMS: where did my Receive / Disburse / Finished Product data go?
-- READ-ONLY. Run in Supabase > SQL Editor and send me the results of each block.
-- Nothing here changes or deletes anything.
-- ============================================================================

-- 1) Is the data still in the database? (rows per company)
SELECT 'stock_receipts' AS tbl, company_id, count(*) AS rows FROM public.stock_receipts GROUP BY company_id
UNION ALL
SELECT 'material_disbursements', company_id, count(*) FROM public.material_disbursements GROUP BY company_id
UNION ALL
SELECT 'raw_materials', company_id, count(*) FROM public.raw_materials GROUP BY company_id
UNION ALL
SELECT 'finished_product_logs', company_id, count(*) FROM public.activity_audit_logs WHERE action = 'UPSERT_FINISHED_PRODUCT' GROUP BY company_id
ORDER BY 1, 2;

-- 2) Which company does each account belong to, and is it ACTIVE?
--    (Row Level Security only shows a manager the rows whose company_id equals THEIR company_id AND status = 'active'.)
SELECT email, role, operational_role, status, company_id, company_name, branch_name
FROM public.user_profiles
ORDER BY company_id NULLS FIRST, role;

-- 3) Rows that nobody can see because they have NO company (NULL) - these are the usual cause of "my data disappeared"
SELECT 'stock_receipts' AS tbl, count(*) AS rows_without_company FROM public.stock_receipts WHERE company_id IS NULL
UNION ALL SELECT 'material_disbursements', count(*) FROM public.material_disbursements WHERE company_id IS NULL
UNION ALL SELECT 'raw_materials', count(*) FROM public.raw_materials WHERE company_id IS NULL;

-- 4) Disbursements removed by RMIMS_REMOVE_INVENTED_DISBURSEMENTS.sql are kept here (if that script was run)
SELECT to_regclass('public._backup_removed_disbursements') AS backup_table;
-- SELECT count(*) FROM public._backup_removed_disbursements;
