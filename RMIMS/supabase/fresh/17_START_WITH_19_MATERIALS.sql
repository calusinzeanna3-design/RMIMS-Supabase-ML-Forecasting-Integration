-- ============================================================================
-- RMIMS — 17  START WITH THE 19 RAW MATERIALS (no built-in data)
-- ============================================================================
-- Registers the 19 Scones & Muffins raw materials as the company's STARTING list:
--   code, name, category and unit ONLY.
--   current stock = 0, minimum stock = empty, no receipts, no disbursements, no forecasts.
-- Every number is then entered by the end users (Receive, Disburse, Edit, Import), and any OTHER raw material
-- is added by the Manager with "+ Add Material" (it gets the next code: NB-020, NB-021, ...).
--
-- Safe to run more than once: a material that already exists (same code OR same name) is left exactly as it is,
-- so nothing the users entered is ever overwritten. Run it again after a factory reset to start over with the 19.
-- Run AFTER 01-16.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rmims_start_materials(p_company TEXT DEFAULT '1872cf44-e821-4370-b227-d1b7e4fc6f56')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_added INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company) THEN
        RETURN 0;
    END IF;
    INSERT INTO public.raw_materials (company_id, item_code, name, category, unit_of_measure, current_stock, minimum_threshold)
    SELECT p_company, v.code, v.name, v.category, v.unit, 0, NULL
      FROM (VALUES
            ('NB-001', 'All-Purpose / Bread Flour',       'Grains & Flours',             'g'),
            ('NB-002', 'Refined White Sugar',             'Sweeteners',                  'g'),
            ('NB-003', 'Fresh Yellow Squash (Kalabasa)',  'Produce / Agricultural',      'g'),
            ('NB-004', 'Skimmed Milk Powder',             'Dairy',                       'g'),
            ('NB-005', 'Condensed Milk',                  'Dairy',                       'g'),
            ('NB-006', 'Fresh Whole Eggs',                'Dairy & Eggs',                'pcs'),
            ('NB-007', 'Baking Shortening',               'Fats & Oils',                 'g'),
            ('NB-008', 'Margarine',                       'Fats & Oils',                 'g'),
            ('NB-009', 'Instant Dry Yeast',               'Baking Supplies',             'g'),
            ('NB-010', 'Baking Soda',                     'Baking Supplies',             'g'),
            ('NB-011', 'Iodized Salt',                    'Seasonings / Salts',          'g'),
            ('NB-012', 'Calcium Propionate',              'Preservatives',               'g'),
            ('NB-013', 'Potassium Sorbate',               'Preservatives',               'g'),
            ('NB-014', 'Crushed Peanuts / Nuts',          'Nuts & Seeds',                'g'),
            ('NB-015', 'Desiccated Coconut',              'Dry Goods',                   'g'),
            ('NB-016', 'Black Sesame Seeds',              'Nuts & Seeds',                'g'),
            ('NB-017', 'Malunggay (Moringa) Flakes',      'Produce / Agricultural',      'g'),
            ('NB-018', 'Vanilla Extract',                 'Flavorings & Extracts',       'g'),
            ('NB-019', 'Plastic Pillow Packaging',        'Packaging Supplies',          'pcs')
           ) AS v(code, name, category, unit)
     WHERE NOT EXISTS (SELECT 1 FROM public.raw_materials r
                        WHERE r.company_id = p_company
                          AND (upper(btrim(r.item_code)) = v.code OR lower(btrim(r.name)) = lower(v.name)));
    GET DIAGNOSTICS v_added = ROW_COUNT;
    RETURN v_added;
END;
$$;
REVOKE ALL ON FUNCTION public.rmims_start_materials(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rmims_start_materials(TEXT) TO service_role;

-- Register them now
SELECT public.rmims_start_materials('1872cf44-e821-4370-b227-d1b7e4fc6f56') AS materials_added;

-- Check: the starting list (stock 0 / minimum empty until the users enter them; added materials show too)
SELECT item_code, name, category, unit_of_measure, current_stock, minimum_threshold
  FROM public.raw_materials
 WHERE company_id = '1872cf44-e821-4370-b227-d1b7e4fc6f56'
 ORDER BY item_code;
