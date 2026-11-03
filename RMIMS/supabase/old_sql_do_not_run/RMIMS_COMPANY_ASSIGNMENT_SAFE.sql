-- ============================================================================
-- RMIMS — ASSIGN COMPANIES (run AFTER RMIMS_RBAC_MULTI_COMPANY_SETUP.sql)
-- SAFE: runs as ONE transaction (any error = nothing changes), keeps a backup of
-- what it touches, deletes no user data, and ends with a check you can read.
-- Edit ONLY the two e-mail lists in section 3.
-- ============================================================================
BEGIN;

-- 0. Stop immediately if the setup file has not been run yet
DO $$
BEGIN
    IF to_regclass('public.companies') IS NULL OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'raw_materials' AND column_name = 'company_id') THEN
        RAISE EXCEPTION 'Run RMIMS_RBAC_MULTI_COMPANY_SETUP.sql first.';
    END IF;
END $$;

-- 1. Backup (only created once; later runs never overwrite it)
CREATE TABLE IF NOT EXISTS public._backup_company_assignment AS
SELECT now() AS backed_up_at, 'user_profiles'::text AS tbl, id::text AS row_id, company_id, company_name
  FROM public.user_profiles
UNION ALL
SELECT now(), 'raw_materials', id::text, company_id, NULL FROM public.raw_materials;

-- 2. Companies (the ids your app already uses)
INSERT INTO public.companies (id, company_code, name, sku_prefix) VALUES
  ('1872cf44-e821-4370-b227-d1b7e4fc6f56', 'SCONES_MUFFINS', 'Scones & Muffins Bakery', 'NB-'),
  ('a72a7971-6ec7-4edc-ae72-89d702199ed9', 'KXC',            'KXC 5-Year Enterprise',   'RM-')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sku_prefix = EXCLUDED.sku_prefix, updated_at = now();

-- Materials: owner decided by the item-code prefix; ledgers follow their material
UPDATE public.raw_materials SET company_id = '1872cf44-e821-4370-b227-d1b7e4fc6f56' WHERE item_code ILIKE 'NB-%';
UPDATE public.raw_materials SET company_id = 'a72a7971-6ec7-4edc-ae72-89d702199ed9' WHERE item_code ILIKE 'RM-%';
UPDATE public.stock_receipts r SET company_id = m.company_id
  FROM public.raw_materials m WHERE r.material_id = m.id AND r.company_id IS DISTINCT FROM m.company_id;
UPDATE public.material_disbursements d SET company_id = m.company_id
  FROM public.raw_materials m WHERE d.material_id = m.id AND d.company_id IS DISTINCT FROM m.company_id;

-- 3. USERS — put the e-mails of your bakery manager(s) and staff here (admins are skipped automatically)
UPDATE public.user_profiles
   SET company_id = '1872cf44-e821-4370-b227-d1b7e4fc6f56'
 WHERE lower(email) IN ('zeannapatty@gmail.com', 'sconesandmuffins@gmail.com')
   AND NOT (role = 'admin' OR lower(coalesce(operational_role, '')) IN ('admin', 'super_admin'));

-- (add a KXC user the same way:  ... SET company_id = 'a72a7971-6ec7-4edc-ae72-89d702199ed9' WHERE lower(email) IN ('someone@kxc'); )

-- 4. Remove the old placeholder company ONLY if nothing uses it any more
DELETE FROM public.companies c WHERE c.id = 'KXC_COMPANY'
   AND NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE company_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.raw_materials WHERE company_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.stock_receipts WHERE company_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.material_disbursements WHERE company_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.activity_audit_logs WHERE company_id = c.id);

COMMIT;

-- 5. CHECK (read these two tables)
SELECT email, role, operational_role, status, company_id, company_name FROM public.user_profiles ORDER BY email;
SELECT left(item_code, 3) AS prefix, company_id, count(*) AS materials FROM public.raw_materials GROUP BY 1, 2 ORDER BY 1;

-- UNDO (only if needed):
--   UPDATE public.user_profiles u SET company_id = b.company_id, company_name = b.company_name
--     FROM public._backup_company_assignment b WHERE b.tbl = 'user_profiles' AND b.row_id = u.id::text;
--   UPDATE public.raw_materials m SET company_id = b.company_id
--     FROM public._backup_company_assignment b WHERE b.tbl = 'raw_materials' AND b.row_id = m.id::text;
