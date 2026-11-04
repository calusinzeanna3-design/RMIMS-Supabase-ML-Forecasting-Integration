-- =============================================================================
-- RMIMS SUPABASE CLEAN-START SCRIPT
-- Permanently Purge All Legacy Mock Data, Coconut Raw Materials, and Test Records
-- Safe for Production: Leaves authentic active materials and user profiles intact.
-- =============================================================================

BEGIN;

-- 1. Permanently delete all coconut raw materials from raw_materials table
DELETE FROM public.raw_materials
WHERE item_code IN ('NB-015', 'RM-033', 'RM-034')
   OR name ILIKE '%coconut%'
   OR description ILIKE '%coconut%';

-- 2. Permanently delete all mock / test / coconut stock receipts
DELETE FROM public.stock_receipts
WHERE supplier_name ILIKE '%coconut%'
   OR unit ILIKE '%coconut%'
   OR notes ILIKE '%coconut%'
   OR received_by ILIKE '%mock%'
   OR supplier_name ILIKE '%mock%'
   OR id::text IN ('st-001', 'st-002', 'st-003', 'st-004', 'st-005', 'tx-staff-001', 'tx-staff-002')
   OR material_id IN (
       SELECT id FROM public.raw_materials 
       WHERE item_code IN ('NB-015', 'RM-033', 'RM-034') OR name ILIKE '%coconut%'
   );

-- 3. Permanently delete all mock / test / coconut material disbursements
DELETE FROM public.material_disbursements
WHERE finished_product_name ILIKE '%coconut%'
   OR activity_type ILIKE '%coconut%'
   OR unit ILIKE '%coconut%'
   OR notes ILIKE '%coconut%'
   OR recorded_by ILIKE '%mock%'
   OR id::text IN ('st-001', 'st-002', 'st-003', 'st-004', 'st-005', 'tx-staff-001', 'tx-staff-002')
   OR material_id IN (
       SELECT id FROM public.raw_materials 
       WHERE item_code IN ('NB-015', 'RM-033', 'RM-034') OR name ILIKE '%coconut%'
   );

-- 4. Permanently delete coconut and test mock audit logs
DELETE FROM public.activity_audit_logs
WHERE action ILIKE '%coconut%'
   OR entity_id IN ('NB-015', 'RM-033', 'RM-034', 'st-001', 'st-002', 'st-003')
   OR (details::text ILIKE '%coconut%');

-- 5. Enable Supabase Realtime replication on all synchronized tables
-- (Guarantees instant two-way live exchange between Staff and Manager)
ALTER PUBLICATION supabase_realtime ADD TABLE public.raw_materials;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_receipts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.material_disbursements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_audit_logs;

COMMIT;

-- Verification output: Check remaining active catalog items
SELECT id, item_code, name, unit_of_measure, current_stock, minimum_threshold 
FROM public.raw_materials 
ORDER BY name ASC;
