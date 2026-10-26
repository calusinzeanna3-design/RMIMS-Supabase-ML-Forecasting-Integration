-- ==============================================================================
-- RMIMS SYSTEM RESET SCRIPT: ZERO STOCKS & PERMANENT TRANSACTION DATA PURGE
-- ==============================================================================
-- Instructions:
-- Run this script in your Supabase SQL Editor to permanently purge all test records,
-- mock transactions, staff submissions, and reset all raw materials inventory stock to 0.
-- ==============================================================================

BEGIN;

-- 1. Reset all Raw Material current stocks to 0 while preserving material names and codes for forecasting
UPDATE public.raw_materials
SET current_stock = 0.0
WHERE TRUE;

-- 2. Permanently delete all inward stock deliveries / receipts
DELETE FROM public.stock_receipts
WHERE TRUE;

-- 3. Permanently delete all outward material disbursements / usage logs
DELETE FROM public.material_disbursements
WHERE TRUE;

-- 4. Permanently delete all activity audit logs
DELETE FROM public.activity_audit_logs
WHERE TRUE;

-- 5. If branch/personnel audit tables exist, clear test logs
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_activity_logs') THEN
        DELETE FROM public.admin_activity_logs WHERE TRUE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_maintenance_alerts') THEN
        DELETE FROM public.system_maintenance_alerts WHERE TRUE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'staff_transactions') THEN
        DELETE FROM public.staff_transactions WHERE TRUE;
    END IF;
END $$;

COMMIT;

-- Verification
SELECT 'raw_materials_count' AS metric, count(*) AS val FROM public.raw_materials
UNION ALL
SELECT 'raw_materials_with_non_zero_stock', count(*) FROM public.raw_materials WHERE current_stock > 0
UNION ALL
SELECT 'stock_receipts_count', count(*) FROM public.stock_receipts
UNION ALL
SELECT 'material_disbursements_count', count(*) FROM public.material_disbursements;
