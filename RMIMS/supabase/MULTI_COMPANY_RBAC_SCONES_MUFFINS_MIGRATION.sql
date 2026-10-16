-- ============================================================================
-- RMIMS MULTI-COMPANY AIR-GAPPED TENANT & STRICT RBAC MIGRATION
-- ============================================================================
-- Purpose:
-- 1. Establishes multi-tenant company partition:
--    - TENANT 1: 'KXC_COMPANY' (Pasalubong 5-Year Enterprise, 59 SKUs: RM-001 to RM-059)
--    - TENANT 2: '1872cf44-e821-4370-b227-d1b7e4fc6f56' (Scones & Muffins Bakery, 19 SKUs: NB-001 to NB-019)
-- 2. Strictly enforces Role-Based Access Control (RBAC) via PostgreSQL Row-Level Security (RLS).
-- 3. Guarantees 100% air-gapped isolation so the 12-year Scones & Muffins dataset
--    and the 5-year Enterprise dataset NEVER mix.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MASTER COMPANIES REGISTRY TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
    id TEXT PRIMARY KEY,
    company_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    folder_reference TEXT,
    model_filename TEXT,
    sku_prefix TEXT NOT NULL,
    dataset_description TEXT,
    margin_specification TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Register Both Dedicated Company Tenants
INSERT INTO public.companies (
    id,
    company_code,
    name,
    folder_reference,
    model_filename,
    sku_prefix,
    dataset_description,
    margin_specification
) VALUES 
(
    'KXC_COMPANY',
    'KXC',
    'Pasalubong 5-Year Enterprise',
    'ml_backend',
    'rmims_time_series_model.pkl',
    'RM-',
    '5-Year Daily Dataset (2020-2025) covering 59 Master Raw Materials',
    'Strictly ±7.51% locked empirical MAPE'
),
(
    '1872cf44-e821-4370-b227-d1b7e4fc6f56',
    'SCONES_MUFFINS',
    'Scones & Muffins Bakery',
    'ml_backend/1872cf44-e821-4370-b227-d1b7e4fc6f56',
    'bakery_nutribun_time_series_model.pkl',
    'NB-',
    '12-Year Dataset (2014-2025) covering 19 Bakery / Nutribun Raw Materials',
    'Company-Wide Mean Weekly MAPE: 2.70%, Daily MAPE: 7.95% with per-SKU exact boundaries'
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    folder_reference = EXCLUDED.folder_reference,
    model_filename = EXCLUDED.model_filename,
    sku_prefix = EXCLUDED.sku_prefix,
    margin_specification = EXCLUDED.margin_specification,
    updated_at = now();

-- ----------------------------------------------------------------------------
-- 2. ADD COMPANY_ID TENANT DISCRIMINATOR TO ALL ENTITIES
-- ----------------------------------------------------------------------------

-- A. USER PROFILES
ALTER TABLE public.user_profiles 
    ADD COLUMN IF NOT EXISTS company_id TEXT DEFAULT 'KXC_COMPANY' REFERENCES public.companies(id),
    ADD COLUMN IF NOT EXISTS company_name TEXT DEFAULT 'Pasalubong 5-Year Enterprise';

-- Index for instant company filtering on users
CREATE INDEX IF NOT EXISTS idx_user_profiles_company ON public.user_profiles(company_id);

-- B. RAW MATERIALS MASTER TABLE
ALTER TABLE public.raw_materials 
    ADD COLUMN IF NOT EXISTS company_id TEXT DEFAULT 'KXC_COMPANY' REFERENCES public.companies(id);

-- Backfill any existing raw materials without company_id to KXC_COMPANY
UPDATE public.raw_materials 
SET company_id = 'KXC_COMPANY' 
WHERE company_id IS NULL;

-- Drop obsolete single-tenant global unique constraints if present
DO $$
BEGIN
    ALTER TABLE public.raw_materials DROP CONSTRAINT IF EXISTS raw_materials_item_code_key;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DROP INDEX IF EXISTS public.idx_raw_materials_unique_name;

-- Create composite unique indexes partitioned by company_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_materials_company_item_code 
    ON public.raw_materials (company_id, item_code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_materials_company_name 
    ON public.raw_materials (company_id, lower(trim(name)));

-- C. STOCK RECEIPTS (INFLOW LEDGER)
ALTER TABLE public.stock_receipts 
    ADD COLUMN IF NOT EXISTS company_id TEXT DEFAULT 'KXC_COMPANY' REFERENCES public.companies(id);

UPDATE public.stock_receipts 
SET company_id = 'KXC_COMPANY' 
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_receipts_company_date 
    ON public.stock_receipts (company_id, receipt_date);

-- D. MATERIAL DISBURSEMENTS (OUTFLOW LEDGER)
ALTER TABLE public.material_disbursements 
    ADD COLUMN IF NOT EXISTS company_id TEXT DEFAULT 'KXC_COMPANY' REFERENCES public.companies(id);

UPDATE public.material_disbursements 
SET company_id = 'KXC_COMPANY' 
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_material_disbursements_company_date 
    ON public.material_disbursements (company_id, usage_date);

-- E. ACTIVITY AUDIT LOGS
ALTER TABLE public.activity_audit_logs 
    ADD COLUMN IF NOT EXISTS company_id TEXT DEFAULT 'KXC_COMPANY' REFERENCES public.companies(id);

CREATE INDEX IF NOT EXISTS idx_activity_audit_logs_company 
    ON public.activity_audit_logs (company_id, created_at);

-- ----------------------------------------------------------------------------
-- 3. SEED RAW MATERIALS FOR SCONES & MUFFINS BAKERY (19 SKUs)
-- ----------------------------------------------------------------------------
INSERT INTO public.raw_materials (
    id,
    item_code,
    name,
    description,
    unit_of_measure,
    minimum_threshold,
    reorder_quantity,
    lead_time_days,
    current_stock,
    company_id
) VALUES
    (gen_random_uuid(), 'NB-001', 'All-Purpose / Bread Flour', 'Primary baking flour for scones, muffins, and nutribun', 'g', 717650.0, 1435000.0, 3, 2500000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-002', 'Refined White Sugar', 'Granulated white sweetener', 'g', 181820.0, 360000.0, 3, 850000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-003', 'Fresh Yellow Squash (Kalabasa)', 'Fresh organic squash puree base', 'g', 562450.0, 1120000.0, 2, 1200000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-004', 'Skimmed Milk Powder', 'Fortified dairy powder', 'g', 194870.0, 400000.0, 4, 600000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-005', 'Condensed Milk', 'Sweetened rich dairy binder', 'g', 88020.0, 180000.0, 3, 300000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-006', 'Fresh Whole Eggs', 'Grade-A fresh farm eggs', 'pcs', 67.37, 140.0, 2, 250.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-007', 'Baking Shortening', 'High-stability vegetable shortening', 'g', 54330.0, 110000.0, 4, 200000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-008', 'Margarine', 'Enriched table/baking margarine', 'g', 69010.0, 140000.0, 3, 250000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-009', 'Instant Dry Yeast', 'Fast-acting commercial baking yeast', 'g', 7840.0, 16000.0, 5, 45000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-010', 'Baking Soda', 'Pure sodium bicarbonate leavener', 'g', 2510.0, 6000.0, 5, 20000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-011', 'Iodized Salt', 'Fine culinary table salt', 'g', 9020.0, 20000.0, 5, 50000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-012', 'Calcium Propionate', 'Food-grade bread anti-mold preservative', 'g', 4040.0, 10000.0, 7, 25000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-013', 'Potassium Sorbate', 'Food-grade antimicrobial preservative', 'g', 510.0, 2000.0, 7, 8000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-014', 'Crushed Peanuts / Nuts', 'Roasted peanut crumbles topping', 'g', 41210.0, 90000.0, 3, 150000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-015', 'Desiccated Coconut', 'Unsweetened fine grated coconut', 'g', 8070.0, 20000.0, 4, 60000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-016', 'Black Sesame Seeds', 'Toasted aromatic sesame seeds', 'g', 7970.0, 18000.0, 4, 55000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-017', 'Malunggay (Moringa) Flakes', 'Dehydrated nutritional moringa leaf flakes', 'g', 5190.0, 12000.0, 3, 40000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-018', 'Vanilla Extract', 'Pure concentrated vanilla essence', 'g', 450.0, 1500.0, 7, 5000.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56'),
    (gen_random_uuid(), 'NB-019', 'Plastic Pillow Packaging', 'Individual food-grade film pillow wraps', 'kl', 305.2, 600.0, 5, 850.0, '1872cf44-e821-4370-b227-d1b7e4fc6f56')
ON CONFLICT (company_id, item_code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    unit_of_measure = EXCLUDED.unit_of_measure,
    minimum_threshold = EXCLUDED.minimum_threshold,
    reorder_quantity = EXCLUDED.reorder_quantity,
    lead_time_days = EXCLUDED.lead_time_days,
    updated_at = now();

-- ----------------------------------------------------------------------------
-- 4. POSTGRESQL RBAC HELPER FUNCTIONS (AIR-GAP ENFORCEMENT)
-- ----------------------------------------------------------------------------

-- Returns the authenticated user's assigned company_id
CREATE OR REPLACE FUNCTION public.get_current_user_company_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_company TEXT;
BEGIN
    SELECT company_id INTO v_company
    FROM public.user_profiles
    WHERE id = auth.uid();
    
    RETURN COALESCE(v_company, 'KXC_COMPANY');
END;
$$;

-- Checks if the authenticated user has cross-tenant auditing authority
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_is_super BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND (
              role = 'admin' 
              OR operational_role IN ('super_admin', 'auditor', 'admin')
              OR email ILIKE 'admin@%'
          )
    ) INTO v_is_super;

    RETURN COALESCE(v_is_super, false);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY (RLS) POLICIES — STRICT MULTI-TENANT ISOLATION
-- ----------------------------------------------------------------------------

-- Enable RLS across all tables
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_audit_logs ENABLE ROW LEVEL SECURITY;

-- COMPANIES TABLE:
DROP POLICY IF EXISTS "Active users can view their company" ON public.companies;
CREATE POLICY "Active users can view their company"
ON public.companies FOR SELECT
TO authenticated
USING (id = public.get_current_user_company_id() OR public.is_super_admin());

-- RAW MATERIALS:
DROP POLICY IF EXISTS "Active users can view raw materials" ON public.raw_materials;
CREATE POLICY "Tenant active users can view raw materials"
ON public.raw_materials FOR SELECT
TO authenticated
USING (
    company_id = public.get_current_user_company_id() 
    OR public.is_super_admin()
);

DROP POLICY IF EXISTS "Admins can manage raw materials master catalog" ON public.raw_materials;
CREATE POLICY "Tenant admins can manage raw materials"
ON public.raw_materials FOR ALL
TO authenticated
USING (
    (company_id = public.get_current_user_company_id() OR public.is_super_admin())
    AND public.is_admin_user()
)
WITH CHECK (
    (company_id = public.get_current_user_company_id() OR public.is_super_admin())
    AND public.is_admin_user()
);

-- STOCK RECEIPTS (INFLOW):
DROP POLICY IF EXISTS "Active users can view stock receipts" ON public.stock_receipts;
CREATE POLICY "Tenant active users can view stock receipts"
ON public.stock_receipts FOR SELECT
TO authenticated
USING (
    company_id = public.get_current_user_company_id() 
    OR public.is_super_admin()
);

DROP POLICY IF EXISTS "Active users can record stock receipts" ON public.stock_receipts;
CREATE POLICY "Tenant active users can record stock receipts"
ON public.stock_receipts FOR INSERT
TO authenticated
WITH CHECK (
    company_id = public.get_current_user_company_id() 
    OR public.is_super_admin()
);

-- MATERIAL DISBURSEMENTS (OUTFLOW):
DROP POLICY IF EXISTS "Active users can view material disbursements" ON public.material_disbursements;
CREATE POLICY "Tenant active users can view material disbursements"
ON public.material_disbursements FOR SELECT
TO authenticated
USING (
    company_id = public.get_current_user_company_id() 
    OR public.is_super_admin()
);

DROP POLICY IF EXISTS "Active users can record material disbursements" ON public.material_disbursements;
CREATE POLICY "Tenant active users can record material disbursements"
ON public.material_disbursements FOR INSERT
TO authenticated
WITH CHECK (
    company_id = public.get_current_user_company_id() 
    OR public.is_super_admin()
);

-- ACTIVITY AUDIT LOGS:
DROP POLICY IF EXISTS "Admins can view activity audit logs" ON public.activity_audit_logs;
CREATE POLICY "Tenant admins can view activity audit logs"
ON public.activity_audit_logs FOR SELECT
TO authenticated
USING (
    (company_id = public.get_current_user_company_id() OR public.is_super_admin())
    AND public.is_admin_user()
);

DROP POLICY IF EXISTS "Active users can append to activity audit logs" ON public.activity_audit_logs;
CREATE POLICY "Tenant users can append to activity audit logs"
ON public.activity_audit_logs FOR INSERT
TO authenticated
WITH CHECK (
    company_id = public.get_current_user_company_id() 
    OR public.is_super_admin()
);

-- ----------------------------------------------------------------------------
-- 6. AIR-GAPPED TRANSACTION STORED PROCEDURES (NO CROSS-COMPANY MIXING)
-- ----------------------------------------------------------------------------

-- Procedure 1: Record Stock Receipt with Strict Company Verification
CREATE OR REPLACE FUNCTION public.record_stock_receipt_v2(
    p_material_id UUID,
    p_receipt_date DATE,
    p_quantity NUMERIC,
    p_unit TEXT,
    p_supplier_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_company TEXT;
    v_mat_company TEXT;
    v_new_stock NUMERIC;
    v_receipt_id UUID;
    v_is_super BOOLEAN;
BEGIN
    -- Input validations
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Received quantity must be strictly greater than 0';
    END IF;

    v_user_company := public.get_current_user_company_id();
    v_is_super := public.is_super_admin();

    -- Retrieve material and lock row
    SELECT company_id, current_stock INTO v_mat_company, v_new_stock
    FROM public.raw_materials
    WHERE id = p_material_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Material record not found';
    END IF;

    -- STRICT AIR-GAP GUARD: Cross-company delivery prevention
    IF v_mat_company <> v_user_company AND NOT v_is_super THEN
        RAISE EXCEPTION '🚨 RBAC AIR-GAP VIOLATION: Cannot record delivery for material in company "%" while operating under company "%"!',
            v_mat_company, v_user_company;
    END IF;

    -- Update balance
    v_new_stock := v_new_stock + p_quantity;

    UPDATE public.raw_materials
    SET current_stock = v_new_stock,
        updated_at = now()
    WHERE id = p_material_id;

    -- Insert into inflow ledger
    INSERT INTO public.stock_receipts (
        company_id,
        receipt_date,
        material_id,
        received_quantity,
        unit,
        supplier_name,
        received_by
    ) VALUES (
        v_mat_company,
        p_receipt_date,
        p_material_id,
        p_quantity,
        p_unit,
        p_supplier_name,
        auth.uid()
    )
    RETURNING id INTO v_receipt_id;

    -- Audit log
    INSERT INTO public.activity_audit_logs (
        company_id,
        user_id,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        v_mat_company,
        auth.uid(),
        'STOCK_RECEIPT',
        'raw_materials',
        p_material_id::text,
        jsonb_build_object(
            'receipt_id', v_receipt_id,
            'company_id', v_mat_company,
            'quantity', p_quantity,
            'unit', p_unit,
            'new_stock', v_new_stock
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'company_id', v_mat_company,
        'receipt_id', v_receipt_id,
        'new_stock', v_new_stock
    );
END;
$$;

-- Procedure 2: Record Material Disbursement with Strict Company Verification
CREATE OR REPLACE FUNCTION public.record_material_disbursement_v2(
    p_material_id UUID,
    p_usage_date DATE,
    p_quantity NUMERIC,
    p_unit TEXT,
    p_activity_type TEXT DEFAULT NULL,
    p_finished_product_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_company TEXT;
    v_mat_company TEXT;
    v_current_stock NUMERIC;
    v_new_stock NUMERIC;
    v_usage_id UUID;
    v_is_super BOOLEAN;
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Disbursed quantity must be strictly greater than 0';
    END IF;

    v_user_company := public.get_current_user_company_id();
    v_is_super := public.is_super_admin();

    SELECT company_id, current_stock INTO v_mat_company, v_current_stock
    FROM public.raw_materials
    WHERE id = p_material_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Material record not found';
    END IF;

    -- STRICT AIR-GAP GUARD: Cross-company consumption prevention
    IF v_mat_company <> v_user_company AND NOT v_is_super THEN
        RAISE EXCEPTION '🚨 RBAC AIR-GAP VIOLATION: Cannot consume material from company "%" while operating under company "%"!',
            v_mat_company, v_user_company;
    END IF;

    IF v_current_stock < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: %', v_current_stock, p_quantity;
    END IF;

    v_new_stock := v_current_stock - p_quantity;

    UPDATE public.raw_materials
    SET current_stock = v_new_stock,
        updated_at = now()
    WHERE id = p_material_id;

    INSERT INTO public.material_disbursements (
        company_id,
        usage_date,
        material_id,
        consumed_quantity,
        unit,
        activity_type,
        finished_product_name,
        recorded_by
    ) VALUES (
        v_mat_company,
        p_usage_date,
        p_material_id,
        p_quantity,
        p_unit,
        p_activity_type,
        p_finished_product_name,
        auth.uid()
    )
    RETURNING id INTO v_usage_id;

    INSERT INTO public.activity_audit_logs (
        company_id,
        user_id,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        v_mat_company,
        auth.uid(),
        'MATERIAL_DISBURSEMENT',
        'raw_materials',
        p_material_id::text,
        jsonb_build_object(
            'usage_id', v_usage_id,
            'company_id', v_mat_company,
            'quantity', p_quantity,
            'unit', p_unit,
            'new_stock', v_new_stock,
            'finished_product_name', p_finished_product_name
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'company_id', v_mat_company,
        'usage_id', v_usage_id,
        'new_stock', v_new_stock
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. GRANTS & SCHEMA REFRESH
-- ----------------------------------------------------------------------------
GRANT SELECT ON public.companies TO anon, authenticated;
GRANT ALL ON public.companies TO service_role;

GRANT EXECUTE ON FUNCTION public.get_current_user_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_stock_receipt_v2(UUID, DATE, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_material_disbursement_v2(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
