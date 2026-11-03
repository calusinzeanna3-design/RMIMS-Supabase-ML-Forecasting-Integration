-- ============================================================================
-- RMIMS — REMOVE DISBURSEMENTS NOBODY ENTERED   (SAFE: preview -> backup -> delete)
-- Older versions created a "disbursement" for every stock decrease found in an imported file
-- (product name "Imported Operational Usage"). This removes only those rows from the database.
-- Stock figures in raw_materials are NOT changed (they are stored as their own numbers).
-- ============================================================================

-- 1. PREVIEW — every disbursement in the database, newest first. Check this list first.
SELECT d.id, d.usage_date, m.item_code, m.name AS material, d.consumed_quantity, d.unit,
       d.activity_type, d.finished_product_name, d.created_at,
       (d.finished_product_name ILIKE '%imported operational usage%') AS invented_by_import
  FROM public.material_disbursements d
  LEFT JOIN public.raw_materials m ON m.id = d.material_id
 ORDER BY d.created_at DESC;

-- 2. BACKUP + DELETE only the invented ones (one transaction; nothing else is touched)
BEGIN;
CREATE TABLE IF NOT EXISTS public._backup_removed_disbursements AS
  SELECT now() AS removed_at, d.* FROM public.material_disbursements d WHERE false;
INSERT INTO public._backup_removed_disbursements
  SELECT now(), d.* FROM public.material_disbursements d
   WHERE d.finished_product_name ILIKE '%imported operational usage%';
DELETE FROM public.material_disbursements
 WHERE finished_product_name ILIKE '%imported operational usage%';
COMMIT;

-- 3. If the preview in step 1 still shows rows YOU never entered (for example test rows), remove them by id:
--    DELETE FROM public.material_disbursements WHERE id IN ('paste-id-1','paste-id-2');

-- 4. Result: what is left (only real disbursements)
SELECT count(*) AS disbursements_left FROM public.material_disbursements;
