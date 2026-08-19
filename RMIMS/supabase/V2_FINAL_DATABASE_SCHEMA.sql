-- ============================================================================
-- RMIMS V2 — FINAL DATABASE SCHEMA DEFINITION
-- ============================================================================
-- Source of Truth: Phase 3 Manual Record Template Analysis
-- Scope: Raw Material Inventory Management, Inflow/Outflow Movement Ledgers,
--        Historical Consumption Analytics, AI Time-Series Data Support,
--        Decision Support Foundation, Role-Based Access Security.
--
-- EXCLUDED: Remarks (replaced by derived Decision Support), Category,
--           Unit Price, Cost, Amount, Financials, Production Automation,
--           Manufacturing Execution, Machine Scheduling, BOM/Recipe Tables,
--           Automatic Replenishment, Automatic Purchasing.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 2. USER PROFILES & ACCESS CONTROL TABLE (SYSTEM METADATA)
-- ----------------------------------------------------------------------------
-- Resolves the profiles vs users architectural discrepancy by providing a 
-- normalized profile entity linked directly to Supabase auth.users.
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    onboarding_status TEXT DEFAULT 'pending' CHECK (onboarding_status IN ('pending', 'completed', 'skipped')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. RAW MATERIALS MASTER TABLE
-- ----------------------------------------------------------------------------
-- Master catalog for raw material specifications and current recorded stock balance.
-- Reorder decision-support fields (threshold, reorder qty, lead time) are optional (NULL).
-- Category and generic remarks are completely removed.
CREATE TABLE IF NOT EXISTS public.raw_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    unit_of_measure TEXT NOT NULL,
    minimum_threshold NUMERIC DEFAULT NULL CHECK (minimum_threshold IS NULL OR minimum_threshold >= 0),
    reorder_quantity NUMERIC DEFAULT NULL CHECK (reorder_quantity IS NULL OR reorder_quantity > 0),
    lead_time_days INTEGER DEFAULT NULL CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    current_stock NUMERIC NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Normalized unique index on material name to prevent accidental duplicate entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_materials_unique_name 
ON public.raw_materials (lower(trim(name)));

-- ----------------------------------------------------------------------------
-- 4. INFLOW LEDGER: STOCK RECEIPTS
-- ----------------------------------------------------------------------------
-- Records factual incoming raw material deliveries received from suppliers.
CREATE TABLE IF NOT EXISTS public.stock_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_date DATE NOT NULL,
    material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
    received_quantity NUMERIC NOT NULL CHECK (received_quantity > 0),
    unit TEXT NOT NULL,
    supplier_name TEXT DEFAULT NULL,
    received_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 5. OUTFLOW LEDGER: MATERIAL DISBURSEMENTS / CONSUMPTION
-- ----------------------------------------------------------------------------
-- Records factual raw materials issued/consumed for operations.
-- activity_type has NO production default; finished_product_name is CONTEXTUAL ONLY.
CREATE TABLE IF NOT EXISTS public.material_disbursements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usage_date DATE NOT NULL,
    material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
    consumed_quantity NUMERIC NOT NULL CHECK (consumed_quantity > 0),
    unit TEXT NOT NULL,
    activity_type TEXT DEFAULT NULL,
    finished_product_name TEXT DEFAULT NULL,
    recorded_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 6. SYSTEM & ACTIVITY AUDIT LOG (SYSTEM METADATA)
-- ----------------------------------------------------------------------------
-- Records administrative changes and data events for compliance and traceability.
CREATE TABLE IF NOT EXISTS public.activity_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 7. PERFORMANCE & ANALYTICS INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stock_receipts_material_date 
ON public.stock_receipts (material_id, receipt_date);

CREATE INDEX IF NOT EXISTS idx_stock_receipts_date 
ON public.stock_receipts (receipt_date);

CREATE INDEX IF NOT EXISTS idx_material_disbursements_material_date 
ON public.material_disbursements (material_id, usage_date);

CREATE INDEX IF NOT EXISTS idx_material_disbursements_date 
ON public.material_disbursements (usage_date);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at 
ON public.activity_audit_logs (created_at DESC);

-- ----------------------------------------------------------------------------
-- 8. SECURITY HELPER FUNCTIONS (Phase 1 Security Principle Preservation)
-- ----------------------------------------------------------------------------

-- Check if current authenticated user is active
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.user_profiles 
        WHERE id = auth.uid() 
          AND status = 'active'
    );
$$;

-- Check if current authenticated user is an active admin
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.user_profiles 
        WHERE id = auth.uid() 
          AND role = 'admin' 
          AND status = 'active'
    );
$$;

-- Prevent non-admin self-elevation trigger
CREATE OR REPLACE FUNCTION public.prevent_self_elevation_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- If current user is not admin, prevent modifying role or status
    IF NOT public.is_admin_user() THEN
        IF NEW.role <> OLD.role OR NEW.status <> OLD.status THEN
            RAISE EXCEPTION 'Access Denied: Only active administrators can modify roles or account status.';
        END IF;
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_elevation ON public.user_profiles;
CREATE TRIGGER trg_prevent_self_elevation
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_elevation_trigger();

-- Auto-sync updated_at on raw_materials
CREATE OR REPLACE FUNCTION public.sync_raw_materials_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_raw_materials_updated_at ON public.raw_materials;
CREATE TRIGGER trg_sync_raw_materials_updated_at
BEFORE UPDATE ON public.raw_materials
FOR EACH ROW
EXECUTE FUNCTION public.sync_raw_materials_updated_at();

-- ----------------------------------------------------------------------------
-- 9. CONTROLLED STOCK TRANSACTION STORED PROCEDURES
-- ----------------------------------------------------------------------------
-- Ensures current recorded stock is modified ONLY through recorded inventory movements.

-- Recorded Inbound Delivery Receipt
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_stock NUMERIC;
    v_receipt_id UUID;
BEGIN
    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access Denied: Account is not active or unauthorized.';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Invalid Quantity: Received quantity must be greater than zero.';
    END IF;

    -- Lock material row and increment recorded stock balance
    UPDATE public.raw_materials
    SET current_stock = current_stock + p_quantity,
        updated_at = now()
    WHERE id = p_material_id
    RETURNING current_stock INTO v_new_stock;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Raw material not found.';
    END IF;

    -- Insert into Inflow Ledger
    INSERT INTO public.stock_receipts (
        receipt_date,
        material_id,
        received_quantity,
        unit,
        supplier_name,
        received_by
    ) VALUES (
        p_receipt_date,
        p_material_id,
        p_quantity,
        p_unit,
        p_supplier_name,
        auth.uid()
    )
    RETURNING id INTO v_receipt_id;

    -- Audit log entry (System metadata)
    INSERT INTO public.activity_audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        auth.uid(),
        'STOCK_RECEIPT',
        'raw_materials',
        p_material_id::text,
        jsonb_build_object(
            'receipt_id', v_receipt_id,
            'quantity', p_quantity,
            'unit', p_unit,
            'new_stock', v_new_stock
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'receipt_id', v_receipt_id,
        'new_stock', v_new_stock
    );
END;
$$;

-- Recorded Outbound Material Disbursement
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_stock NUMERIC;
    v_new_stock NUMERIC;
    v_usage_id UUID;
BEGIN
    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access Denied: Account is not active or unauthorized.';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Invalid Quantity: Consumed quantity must be greater than zero.';
    END IF;

    -- Lock row and check recorded stock availability
    SELECT current_stock INTO v_current_stock
    FROM public.raw_materials
    WHERE id = p_material_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Raw material not found.';
    END IF;

    IF v_current_stock < p_quantity THEN
        RAISE EXCEPTION 'Insufficient Stock: Recorded stock balance is %, requested %.', v_current_stock, p_quantity;
    END IF;

    -- Decrement recorded stock balance
    UPDATE public.raw_materials
    SET current_stock = current_stock - p_quantity,
        updated_at = now()
    WHERE id = p_material_id
    RETURNING current_stock INTO v_new_stock;

    -- Insert into Outflow Ledger
    INSERT INTO public.material_disbursements (
        usage_date,
        material_id,
        consumed_quantity,
        unit,
        activity_type,
        finished_product_name,
        recorded_by
    ) VALUES (
        p_usage_date,
        p_material_id,
        p_quantity,
        p_unit,
        p_activity_type,
        p_finished_product_name,
        auth.uid()
    )
    RETURNING id INTO v_usage_id;

    -- Audit log entry (System metadata)
    INSERT INTO public.activity_audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        auth.uid(),
        'MATERIAL_DISBURSEMENT',
        'raw_materials',
        p_material_id::text,
        jsonb_build_object(
            'usage_id', v_usage_id,
            'quantity', p_quantity,
            'unit', p_unit,
            'new_stock', v_new_stock,
            'activity_type', p_activity_type,
            'finished_product_name', p_finished_product_name
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'usage_id', v_usage_id,
        'new_stock', v_new_stock
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_audit_logs ENABLE ROW LEVEL SECURITY;

-- User Profiles Policies
CREATE POLICY "Active users can view user profiles"
ON public.user_profiles FOR SELECT
TO authenticated
USING (public.is_active_user());

CREATE POLICY "Users can update own name"
ON public.user_profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins have full control over user profiles"
ON public.user_profiles FOR ALL
TO authenticated
USING (public.is_admin_user())
WITH CHECK (public.is_admin_user());

-- Raw Materials Policies
CREATE POLICY "Active users can view raw materials"
ON public.raw_materials FOR SELECT
TO authenticated
USING (public.is_active_user());

CREATE POLICY "Admins can manage raw materials master catalog"
ON public.raw_materials FOR ALL
TO authenticated
USING (public.is_admin_user())
WITH CHECK (public.is_admin_user());

-- Stock Receipts (Inflow) Policies
CREATE POLICY "Active users can view stock receipts"
ON public.stock_receipts FOR SELECT
TO authenticated
USING (public.is_active_user());

CREATE POLICY "Active users can record stock receipts"
ON public.stock_receipts FOR INSERT
TO authenticated
WITH CHECK (public.is_active_user());

CREATE POLICY "Admins can manage stock receipts"
ON public.stock_receipts FOR ALL
TO authenticated
USING (public.is_admin_user())
WITH CHECK (public.is_admin_user());

-- Material Disbursements (Outflow) Policies
CREATE POLICY "Active users can view material disbursements"
ON public.material_disbursements FOR SELECT
TO authenticated
USING (public.is_active_user());

CREATE POLICY "Active users can record material disbursements"
ON public.material_disbursements FOR INSERT
TO authenticated
WITH CHECK (public.is_active_user());

CREATE POLICY "Admins can manage material disbursements"
ON public.material_disbursements FOR ALL
TO authenticated
USING (public.is_admin_user())
WITH CHECK (public.is_admin_user());

-- Activity Audit Logs Policies
CREATE POLICY "Admins can view activity audit logs"
ON public.activity_audit_logs FOR SELECT
TO authenticated
USING (public.is_admin_user());

CREATE POLICY "Active users can append to activity audit logs"
ON public.activity_audit_logs FOR INSERT
TO authenticated
WITH CHECK (public.is_active_user());

-- ----------------------------------------------------------------------------
-- 11. POSTGREST SCHEMA VISIBILITY & LEAST-PRIVILEGE ROLE PERMISSIONS
-- ----------------------------------------------------------------------------
-- Enforces strict least-privilege access across Supabase roles while enabling
-- PostgREST schema cache discovery. Row-Level Security (RLS) policies in Section 10
-- remain the primary and inviolable access boundary.

-- Schema Usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 1. Unauthenticated Role (`anon`)
-- Required solely for PostgREST schema introspection. Zero mutation privileges.
-- RLS policies ensure unauthenticated requests are blocked from accessing protected rows.
GRANT SELECT ON public.user_profiles TO anon;
GRANT SELECT ON public.raw_materials TO anon;
GRANT SELECT ON public.stock_receipts TO anon;
GRANT SELECT ON public.material_disbursements TO anon;
GRANT SELECT ON public.activity_audit_logs TO anon;

-- 2. Authenticated Application Users (`authenticated`)
-- Privileges mapped strictly to authorized RMIMS business functions under RLS control.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_materials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_receipts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_disbursements TO authenticated;
GRANT SELECT, INSERT ON public.activity_audit_logs TO authenticated; -- Audit logs are append-only; NO UPDATE/DELETE

-- Grant execution of approved stored procedures and security definers
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_stock_receipt_v2(UUID, DATE, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_material_disbursement_v2(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- Grant sequence access where applicable
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 3. Administrative Service Role (`service_role`)
-- Full administrative management for backend operational workers and migrations.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';
