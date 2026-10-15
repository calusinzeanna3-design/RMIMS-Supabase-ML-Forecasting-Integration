-- ============================================================================
-- RMIMS: COMPREHENSIVE ADMIN SUPABASE SCHEMA MIGRATION
-- ============================================================================
-- Description:
-- Direct Supabase backend architecture designed to back and align 1-to-1 with
-- the RMIMS Main Administration Portal modules:
-- 1. `branch_stores` & `branch_store_personnel` (Branch Stores Management)
-- 2. `system_maintenance_alerts` (Real-Time Diagnostics & Maintenance Alerts)
-- 3. `admin_activity_logs` (Audit Trails & Enterprise System Event Logging)
-- 4. `admin_system_settings` (Global Branch Policies & System Configurations)
-- 5. Helper Functions, Performance Indexes, Updated-At Triggers, and RLS Policies.
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. HELPER FUNCTIONS & SHARED TRIGGERS
-- ============================================================================

-- Automatic timestamp updater trigger function
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Security Definer to verify if current authenticated caller is an Administrator
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.user_profiles 
        WHERE id = auth.uid() 
          AND (LOWER(role) = 'admin' OR LOWER(COALESCE(operational_role, '')) = 'admin')
    );
$$;

-- ============================================================================
-- 2. BRANCH STORES (RMIMS Admin Branch Stores Module)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.branch_stores (
    id TEXT PRIMARY KEY, -- e.g. 'tiaong', 'lucena', or UUID
    branch_key TEXT NOT NULL UNIQUE,
    branch_name TEXT NOT NULL,
    branch_location TEXT NOT NULL,
    address TEXT,
    operating_status TEXT NOT NULL DEFAULT 'active' CHECK (operating_status IN ('active', 'inactive', 'maintenance')),
    contact_number TEXT,
    contact_email TEXT,
    daily_production_target NUMERIC(12,2) DEFAULT 0,
    storage_capacity_pct NUMERIC(5,2) DEFAULT 0 CHECK (storage_capacity_pct >= 0 AND storage_capacity_pct <= 100),
    active_alerts_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexing for fast search and status queries
CREATE INDEX IF NOT EXISTS idx_branch_stores_key ON public.branch_stores (branch_key);
CREATE INDEX IF NOT EXISTS idx_branch_stores_status ON public.branch_stores (operating_status);
CREATE INDEX IF NOT EXISTS idx_branch_stores_name ON public.branch_stores (branch_name);

-- Trigger for branch_stores updated_at
DROP TRIGGER IF EXISTS trg_branch_stores_updated_at ON public.branch_stores;
CREATE TRIGGER trg_branch_stores_updated_at
    BEFORE UPDATE ON public.branch_stores
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ============================================================================
-- 3. BRANCH STORE PERSONNEL (Managers & Staff Assigned to Branch Stores)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.branch_store_personnel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id TEXT NOT NULL REFERENCES public.branch_stores(id) ON DELETE CASCADE,
    user_profile_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Manager', 'Staff', 'Admin')),
    email TEXT,
    phone TEXT,
    shift TEXT DEFAULT 'Day Shift',
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'On Leave', 'Inactive')),
    avatar TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branch_personnel_branch ON public.branch_store_personnel (branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_personnel_role ON public.branch_store_personnel (role);
CREATE INDEX IF NOT EXISTS idx_branch_personnel_status ON public.branch_store_personnel (status);

DROP TRIGGER IF EXISTS trg_branch_personnel_updated_at ON public.branch_store_personnel;
CREATE TRIGGER trg_branch_personnel_updated_at
    BEFORE UPDATE ON public.branch_store_personnel
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ============================================================================
-- 4. SYSTEM MAINTENANCE ALERTS (RMIMS Admin System Alerts Module)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.system_maintenance_alerts (
    id TEXT PRIMARY KEY, -- e.g. 'ALT-SYS-001' or UUID
    type TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('inventory', 'forecast', 'network', 'system', 'security')),
    severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('critical', 'warning', 'info', 'high', 'medium', 'low')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'monitoring', 'resolved', 'acknowledged')),
    branch_store_id TEXT REFERENCES public.branch_stores(id) ON DELETE SET NULL,
    branch_location TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    occurrence INTEGER NOT NULL DEFAULT 1,
    first_detected TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_detected TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    details TEXT NOT NULL,
    suggested_action TEXT,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sys_alerts_status ON public.system_maintenance_alerts (status);
CREATE INDEX IF NOT EXISTS idx_sys_alerts_category ON public.system_maintenance_alerts (category);
CREATE INDEX IF NOT EXISTS idx_sys_alerts_severity ON public.system_maintenance_alerts (severity);
CREATE INDEX IF NOT EXISTS idx_sys_alerts_branch ON public.system_maintenance_alerts (branch_store_id);

DROP TRIGGER IF EXISTS trg_system_alerts_updated_at ON public.system_maintenance_alerts;
CREATE TRIGGER trg_system_alerts_updated_at
    BEFORE UPDATE ON public.system_maintenance_alerts
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ============================================================================
-- 5. ADMIN ACTIVITY LOGS (RMIMS Admin Activity Audit Trail Module)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
    id TEXT PRIMARY KEY DEFAULT ('act-' || replace(gen_random_uuid()::text, '-', '')),
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    user_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Staff',
    branch_location TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'warning', 'failed')),
    ip_address TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON public.admin_activity_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON public.admin_activity_logs (action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_module ON public.admin_activity_logs (module);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON public.admin_activity_logs (user_name);

-- ============================================================================
-- 6. ADMIN SYSTEM SETTINGS (Global Policies & Configurations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admin_system_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value JSONB NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'general',
    updated_by TEXT DEFAULT 'Admin',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default empty/standard administration configurations
INSERT INTO public.admin_system_settings (setting_key, setting_value, description, category)
VALUES
    ('branch_heartbeat_interval_minutes', '15'::jsonb, 'Interval for synchronizing branch inventory & telemetry', 'telemetry'),
    ('safety_stock_threshold_pct', '15'::jsonb, 'Raw material remaining stock threshold that triggers a safety warning', 'inventory'),
    ('require_admin_approval_for_accounts', 'true'::jsonb, 'Require main administrator approval for newly registered accounts', 'security'),
    ('account_lockout_consecutive_failed_logins', '5'::jsonb, 'Automatic account lockout after consecutive failed authentication attempts', 'security')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS across all Admin tables
ALTER TABLE public.branch_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_store_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_maintenance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_system_settings ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Policies for: branch_stores
-- ----------------------------------------------------------------------------
-- Any authenticated user can read branch stores (needed for managers & staff to know their branch)
DROP POLICY IF EXISTS "Authenticated users can read branch stores" ON public.branch_stores;
CREATE POLICY "Authenticated users can read branch stores"
    ON public.branch_stores FOR SELECT
    TO authenticated
    USING (true);

-- Only Administrators can insert, update, or delete branch stores
DROP POLICY IF EXISTS "Admin full control on branch stores" ON public.branch_stores;
CREATE POLICY "Admin full control on branch stores"
    ON public.branch_stores FOR ALL
    TO authenticated
    USING (public.is_admin_user())
    WITH CHECK (public.is_admin_user());

-- ----------------------------------------------------------------------------
-- Policies for: branch_store_personnel
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view branch personnel" ON public.branch_store_personnel;
CREATE POLICY "Authenticated users can view branch personnel"
    ON public.branch_store_personnel FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Admin full control on branch personnel" ON public.branch_store_personnel;
CREATE POLICY "Admin full control on branch personnel"
    ON public.branch_store_personnel FOR ALL
    TO authenticated
    USING (public.is_admin_user())
    WITH CHECK (public.is_admin_user());

-- ----------------------------------------------------------------------------
-- Policies for: system_maintenance_alerts
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read active system alerts" ON public.system_maintenance_alerts;
CREATE POLICY "Authenticated users can read active system alerts"
    ON public.system_maintenance_alerts FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Admin full control on system maintenance alerts" ON public.system_maintenance_alerts;
CREATE POLICY "Admin full control on system maintenance alerts"
    ON public.system_maintenance_alerts FOR ALL
    TO authenticated
    USING (public.is_admin_user())
    WITH CHECK (public.is_admin_user());

-- ----------------------------------------------------------------------------
-- Policies for: admin_activity_logs
-- ----------------------------------------------------------------------------
-- Any authenticated user can log operational actions (e.g. stock receipt, disbursement)
DROP POLICY IF EXISTS "Authenticated users can append activity logs" ON public.admin_activity_logs;
CREATE POLICY "Authenticated users can append activity logs"
    ON public.admin_activity_logs FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Only Admin can view and audit all system activity logs
DROP POLICY IF EXISTS "Admin can read all activity logs" ON public.admin_activity_logs;
CREATE POLICY "Admin can read all activity logs"
    ON public.admin_activity_logs FOR SELECT
    TO authenticated
    USING (public.is_admin_user());

-- ----------------------------------------------------------------------------
-- Policies for: admin_system_settings
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read system settings" ON public.admin_system_settings;
CREATE POLICY "Authenticated users can read system settings"
    ON public.admin_system_settings FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Admin can update system settings" ON public.admin_system_settings;
CREATE POLICY "Admin can update system settings"
    ON public.admin_system_settings FOR ALL
    TO authenticated
    USING (public.is_admin_user())
    WITH CHECK (public.is_admin_user());

-- ============================================================================
-- 8. REALTIME REPLICATION (Supabase Realtime Publications)
-- ============================================================================
DO $$
BEGIN
    -- Add tables to realtime publication if supabase_realtime publication exists
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.branch_stores;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.branch_store_personnel;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.system_maintenance_alerts;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_activity_logs;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_system_settings;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Notice adding tables to supabase_realtime: %', SQLERRM;
END $$;
