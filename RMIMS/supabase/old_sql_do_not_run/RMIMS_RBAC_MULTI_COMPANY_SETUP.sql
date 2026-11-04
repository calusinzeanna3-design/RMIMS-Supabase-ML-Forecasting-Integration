-- ============================================================================
-- RMIMS — MULTI-COMPANY RBAC + LIVE MANAGER → STAFF SYNC   (run ONCE, safe to re-run)
-- ============================================================================
-- This single file REPLACES MULTI_COMPANY_RBAC_SCONES_MUFFINS_MIGRATION.sql and
-- LIVE_MANAGER_STAFF_SYNC.sql. You do not need to run either of those first.
--
-- SECURITY MODEL (enforced by the database, not just by the screens)
--   COMPANIES   Each company is an air-gapped tenant. Every row of data carries company_id.
--   ADMIN       Platform admin (role = 'admin'): sees and manages every company.
--   MANAGER     Reads + writes ONLY their own company's materials, receipts, disbursements.
--   STAFF       Reads ONLY their own company's data. Can submit transactions for approval
--               (stored as audit rows) but can never change inventory, stock or material settings.
--   FAIL-CLOSED A user with no company sees nothing. company_id is stamped by triggers from the
--               signed-in session / the material row, so a client can never write into another
--               company, and users cannot change their own company, role or status.
--
-- Fixed vs. the old migration
--   * is_super_admin() no longer trusts any email starting with "admin@" (anyone could sign up as that).
--   * Users could edit their own company_id; now blocked.
--   * Any active user could read every company's profiles; now scoped to own company.
--   * Staff could call the stock-moving procedures and insert ledger rows directly; now manager/admin only.
--   * No company, id, SKU prefix or email is hard-coded: everything is rules + your own data.
--   * Seeds no placeholder data of any kind.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. SCHEMA COLUMNS THE APP READS/WRITES (older databases lack some; adding them is harmless if they exist)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.raw_materials') IS NOT NULL THEN
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS item_code TEXT;
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS description TEXT;
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS unit_of_measure TEXT;
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS minimum_threshold NUMERIC;
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS reorder_quantity NUMERIC;
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS current_stock NUMERIC NOT NULL DEFAULT 0;
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS date_added DATE DEFAULT CURRENT_DATE;
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS first_date DATE DEFAULT CURRENT_DATE;
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ DEFAULT now();
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS latest_date TIMESTAMPTZ DEFAULT now();
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
        ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
    END IF;
    IF to_regclass('public.user_profiles') IS NOT NULL THEN
        ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
        ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS operational_role TEXT;
        ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS branch_name TEXT;
        ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS branch_location TEXT;
        ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
        ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. COMPANIES REGISTRY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
    id TEXT PRIMARY KEY,
    company_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    folder_reference TEXT,
    model_filename TEXT,
    sku_prefix TEXT,
    dataset_description TEXT,
    margin_specification TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS company_name TEXT;

-- The platform ADMIN is the main administrator of the whole system. It belongs to NO company,
-- so any company label an admin carried from older setups is removed.
UPDATE public.user_profiles
   SET company_id = NULL, company_name = NULL
 WHERE (role = 'admin' OR lower(coalesce(operational_role, '')) IN ('admin', 'super_admin'))
   AND (company_id IS NOT NULL OR company_name IS NOT NULL);

-- No company is hard-coded here. Companies already present in your data are registered automatically;
-- add more with: SELECT public.admin_register_company('<id>', '<name>', '<optional sku prefix>');
INSERT INTO public.companies (id, company_code, name)
SELECT DISTINCT btrim(u.company_id), btrim(u.company_id), COALESCE(NULLIF(btrim(u.company_name), ''), btrim(u.company_id))
  FROM public.user_profiles u
 WHERE u.company_id IS NOT NULL AND btrim(u.company_id) <> ''
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. HELPERS
-- ----------------------------------------------------------------------------
-- Company ids are opaque values: only trimmed, never mapped to anything specific.
CREATE OR REPLACE FUNCTION public.normalize_company_id(p TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(btrim(p), '');
$$;

-- Which company owns an SKU: looked up from the registered companies' sku_prefix (NULL when unknown).
CREATE OR REPLACE FUNCTION public.company_from_item_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT c.id FROM public.companies c
     WHERE NULLIF(btrim(c.sku_prefix), '') IS NOT NULL
       AND upper(coalesce(p_code, '')) LIKE upper(btrim(c.sku_prefix)) || '%'
     ORDER BY length(c.sku_prefix) DESC LIMIT 1;
$$;

-- The one company, if exactly one is registered (used only to backfill rows that have no owner yet).
CREATE OR REPLACE FUNCTION public.sole_company_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN count(*) = 1 THEN min(id) END FROM public.companies;
$$;

-- Profile columns needed by the helpers (company_id is added here if the old migration was never run)
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.user_profiles ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.user_profiles ALTER COLUMN company_name DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND status = 'active');
$$;

-- Platform admin only. (No email-pattern shortcut.)
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND status = 'active'
          AND (role = 'admin' OR lower(coalesce(operational_role, '')) IN ('admin', 'super_admin'))
    );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT public.is_admin_user();
$$;

CREATE OR REPLACE FUNCTION public.is_manager_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND status = 'active'
          AND lower(coalesce(operational_role, '')) IN ('manager', 'store_manager', 'store manager')
    );
$$;

-- FAIL-CLOSED: returns NULL when the user has no company (NULL never equals a company_id, so no rows match).
CREATE OR REPLACE FUNCTION public.get_current_user_company_id()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT public.normalize_company_id(company_id) FROM public.user_profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_user_company_id() TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. COMPANY COLUMNS ON EVERY TABLE + BACKFILL OF EXISTING DATA
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['raw_materials', 'stock_receipts', 'material_disbursements', 'activity_audit_logs']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id TEXT', t);
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id DROP DEFAULT', t);
    END LOOP;
END $$;

-- Profiles: normalise ids, drop ids that are not a registered company
UPDATE public.user_profiles SET company_id = public.normalize_company_id(company_id)
 WHERE company_id IS DISTINCT FROM public.normalize_company_id(company_id);
UPDATE public.user_profiles SET company_id = NULL
 WHERE company_id IS NOT NULL AND company_id NOT IN (SELECT id FROM public.companies);

-- Operational accounts with no company: only auto-assigned when exactly one company exists.
-- Otherwise they stay company-less (see nothing) until an admin assigns them -> fail-closed, never guessed.
UPDATE public.user_profiles
   SET company_id = public.sole_company_id()
 WHERE company_id IS NULL
   AND lower(coalesce(operational_role, '')) IN ('manager', 'staff', 'user')
   AND role <> 'admin';

UPDATE public.user_profiles p SET company_name = c.name
  FROM public.companies c
 WHERE c.id = p.company_id AND p.company_name IS DISTINCT FROM c.name;

-- Materials: by the registered SKU prefix, else the sole company; otherwise left unowned (admin-only) rather than guessed
UPDATE public.raw_materials
   SET company_id = COALESCE(public.company_from_item_code(item_code), public.sole_company_id())
 WHERE company_id IS NULL OR company_id NOT IN (SELECT id FROM public.companies);

-- Ledgers: always the company of the material they belong to
UPDATE public.stock_receipts r SET company_id = m.company_id
  FROM public.raw_materials m WHERE r.material_id = m.id AND r.company_id IS DISTINCT FROM m.company_id;
UPDATE public.material_disbursements d SET company_id = m.company_id
  FROM public.raw_materials m WHERE d.material_id = m.id AND d.company_id IS DISTINCT FROM m.company_id;

-- Audit rows: the company of the user who wrote them (admin rows stay company-less = admin-only)
UPDATE public.activity_audit_logs l SET company_id = public.normalize_company_id(p.company_id)
  FROM public.user_profiles p
 WHERE l.user_id = p.id AND (l.company_id IS NULL OR l.company_id NOT IN (SELECT id FROM public.companies));
UPDATE public.activity_audit_logs SET company_id = NULL
 WHERE company_id IS NOT NULL AND company_id NOT IN (SELECT id FROM public.companies);

-- Foreign keys (idempotent)
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['user_profiles', 'raw_materials', 'stock_receipts', 'material_disbursements', 'activity_audit_logs']
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            WHERE c.conrelid = format('public.%I', t)::regclass
              AND c.contype = 'f'
              AND c.confrelid = 'public.companies'::regclass
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES public.companies(id)', t, 'fk_' || t || '_company');
        END IF;
    END LOOP;
END $$;

-- Per-company uniqueness (two companies may each have their own "Sugar" / own SKU numbering)
ALTER TABLE public.raw_materials DROP CONSTRAINT IF EXISTS raw_materials_item_code_key;
DROP INDEX IF EXISTS public.idx_raw_materials_unique_name;
-- The item code is the identity the ML model forecasts by, so it is unique across the whole system;
-- the NAME may repeat between companies (each company has its own "Sugar"), but not inside one company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_materials_item_code_unique ON public.raw_materials (upper(btrim(item_code)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_materials_company_item_code ON public.raw_materials (company_id, item_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_materials_company_name ON public.raw_materials (company_id, lower(trim(name)));
CREATE INDEX IF NOT EXISTS idx_user_profiles_company ON public.user_profiles (company_id);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_company_date ON public.stock_receipts (company_id, receipt_date);
CREATE INDEX IF NOT EXISTS idx_material_disbursements_company_date ON public.material_disbursements (company_id, usage_date);
CREATE INDEX IF NOT EXISTS idx_activity_audit_logs_company ON public.activity_audit_logs (company_id, created_at);

-- ----------------------------------------------------------------------------
-- 4. TRIGGERS — company_id can never be chosen by the client
-- ----------------------------------------------------------------------------

-- 4a. Profiles: users cannot change their own role / status / company; company is validated.
CREATE OR REPLACE FUNCTION public.prevent_self_elevation_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
        IF NEW.role IS DISTINCT FROM OLD.role
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.operational_role IS DISTINCT FROM OLD.operational_role
           OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
            RAISE EXCEPTION 'Access Denied: Only administrators can modify roles, company or account status.';
        END IF;
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_elevation ON public.user_profiles;
CREATE TRIGGER trg_prevent_self_elevation
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_self_elevation_trigger();

CREATE OR REPLACE FUNCTION public.profile_company_normalize()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Platform admin: main administrator of the whole system, never tied to (or named after) a company.
    IF NEW.role = 'admin' OR lower(coalesce(NEW.operational_role, '')) IN ('admin', 'super_admin') THEN
        NEW.company_id := NULL;
        NEW.company_name := NULL;
        RETURN NEW;
    END IF;
    NEW.company_id := public.normalize_company_id(NEW.company_id);
    IF NEW.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.companies WHERE id = NEW.company_id) THEN
        NEW.company_id := NULL;
    END IF;
    IF NEW.company_id IS NOT NULL THEN
        SELECT name INTO NEW.company_name FROM public.companies WHERE id = NEW.company_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_company_normalize ON public.user_profiles;
CREATE TRIGGER trg_profiles_company_normalize
BEFORE INSERT OR UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.profile_company_normalize();

-- 4b. Materials: company comes from the signed-in user; it can never be moved to another company.
CREATE OR REPLACE FUNCTION public.raw_materials_company_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
        IF TG_OP = 'INSERT' THEN
            NEW.company_id := public.get_current_user_company_id();
        ELSE
            NEW.company_id := OLD.company_id;
        END IF;
    ELSIF NEW.company_id IS NULL THEN
        NEW.company_id := COALESCE(public.company_from_item_code(NEW.item_code), public.sole_company_id());
    END IF;
    -- A company that registered an SKU prefix may only create codes with that prefix (keeps ML codes tied to their company).
    IF NEW.company_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.companies c
         WHERE c.id = NEW.company_id AND NULLIF(btrim(c.sku_prefix), '') IS NOT NULL
           AND upper(coalesce(NEW.item_code, '')) NOT LIKE upper(btrim(c.sku_prefix)) || '%'
    ) THEN
        RAISE EXCEPTION 'Item code % does not use this company''s SKU prefix.', NEW.item_code;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_raw_materials_company ON public.raw_materials;
CREATE TRIGGER trg_raw_materials_company
BEFORE INSERT OR UPDATE ON public.raw_materials
FOR EACH ROW EXECUTE FUNCTION public.raw_materials_company_guard();

-- 4c. Ledgers: ALWAYS the company of the material (receipts / disbursements can never mix companies).
CREATE OR REPLACE FUNCTION public.ledger_company_from_material()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_company TEXT;
BEGIN
    SELECT company_id INTO v_company FROM public.raw_materials WHERE id = NEW.material_id;
    IF v_company IS NOT NULL THEN
        NEW.company_id := v_company;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_receipts_company ON public.stock_receipts;
CREATE TRIGGER trg_stock_receipts_company
BEFORE INSERT OR UPDATE ON public.stock_receipts
FOR EACH ROW EXECUTE FUNCTION public.ledger_company_from_material();

DROP TRIGGER IF EXISTS trg_material_disbursements_company ON public.material_disbursements;
CREATE TRIGGER trg_material_disbursements_company
BEFORE INSERT OR UPDATE ON public.material_disbursements
FOR EACH ROW EXECUTE FUNCTION public.ledger_company_from_material();

-- 4d. Audit log: company + author come from the session (cannot be spoofed); append-only.
CREATE OR REPLACE FUNCTION public.audit_log_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.user_id := auth.uid();
        IF NOT public.is_super_admin() THEN
            NEW.company_id := public.get_current_user_company_id();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activity_audit_logs_company ON public.activity_audit_logs;
CREATE TRIGGER trg_activity_audit_logs_company
BEFORE INSERT ON public.activity_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.audit_log_stamp();

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY — drop every old policy, then create the complete set
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname, tablename FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename IN ('companies', 'user_profiles', 'raw_materials', 'stock_receipts', 'material_disbursements', 'activity_audit_logs')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_audit_logs ENABLE ROW LEVEL SECURITY;

-- COMPANIES
CREATE POLICY companies_read ON public.companies FOR SELECT TO authenticated
    USING (id = public.get_current_user_company_id() OR public.is_super_admin());
CREATE POLICY companies_admin_all ON public.companies FOR ALL TO authenticated
    USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- USER PROFILES: own row, or same company, or admin
CREATE POLICY profiles_read ON public.user_profiles FOR SELECT TO authenticated
    USING (
        id = auth.uid()
        OR public.is_super_admin()
        OR (public.is_active_user() AND company_id = public.get_current_user_company_id())
    );
CREATE POLICY profiles_update_own ON public.user_profiles FOR UPDATE TO authenticated
    USING (id = auth.uid()) WITH CHECK (id = auth.uid());   -- role/status/company guarded by trigger
CREATE POLICY profiles_admin_all ON public.user_profiles FOR ALL TO authenticated
    USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- RAW MATERIALS: every ACTIVE user in the company reads (pending / inactive accounts see nothing); only the company's manager (or admin) writes
CREATE POLICY materials_read ON public.raw_materials FOR SELECT TO authenticated
    USING ((company_id = public.get_current_user_company_id() AND public.is_active_user()) OR public.is_super_admin());
CREATE POLICY materials_manager_write ON public.raw_materials FOR ALL TO authenticated
    USING ((company_id = public.get_current_user_company_id() AND public.is_manager_user()) OR public.is_super_admin())
    WITH CHECK ((company_id = public.get_current_user_company_id() AND public.is_manager_user()) OR public.is_super_admin());

-- STOCK RECEIPTS (inflow ledger)
CREATE POLICY receipts_read ON public.stock_receipts FOR SELECT TO authenticated
    USING ((company_id = public.get_current_user_company_id() AND public.is_active_user()) OR public.is_super_admin());
CREATE POLICY receipts_manager_write ON public.stock_receipts FOR ALL TO authenticated
    USING ((company_id = public.get_current_user_company_id() AND public.is_manager_user()) OR public.is_super_admin())
    WITH CHECK ((company_id = public.get_current_user_company_id() AND public.is_manager_user()) OR public.is_super_admin());

-- MATERIAL DISBURSEMENTS (outflow ledger)
CREATE POLICY disbursements_read ON public.material_disbursements FOR SELECT TO authenticated
    USING ((company_id = public.get_current_user_company_id() AND public.is_active_user()) OR public.is_super_admin());
CREATE POLICY disbursements_manager_write ON public.material_disbursements FOR ALL TO authenticated
    USING ((company_id = public.get_current_user_company_id() AND public.is_manager_user()) OR public.is_super_admin())
    WITH CHECK ((company_id = public.get_current_user_company_id() AND public.is_manager_user()) OR public.is_super_admin());

-- AUDIT LOG (append-only). Admin reads all; company users read only their company's shared sync rows.
CREATE POLICY audit_admin_read ON public.activity_audit_logs FOR SELECT TO authenticated
    USING (public.is_super_admin());
CREATE POLICY audit_company_sync_read ON public.activity_audit_logs FOR SELECT TO authenticated
    USING (
        company_id = public.get_current_user_company_id()
        AND public.is_active_user()
        AND entity_type IN ('staff_transactions', 'raw_materials', 'stock_receipts', 'material_disbursements', 'finished_products')
    );
CREATE POLICY audit_insert ON public.activity_audit_logs FOR INSERT TO authenticated
    WITH CHECK (public.is_active_user() AND (company_id = public.get_current_user_company_id() OR public.is_super_admin()));

-- ----------------------------------------------------------------------------
-- 6. STOCK-MOVING PROCEDURES — manager / admin only, hard company air-gap
-- ----------------------------------------------------------------------------
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
    v_user_company TEXT;
    v_mat_company TEXT;
    v_new_stock NUMERIC;
    v_receipt_id UUID;
    v_is_super BOOLEAN;
BEGIN
    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access Denied: Account is not active or unauthorized.';
    END IF;
    v_is_super := public.is_super_admin();
    IF NOT (v_is_super OR public.is_manager_user()) THEN
        RAISE EXCEPTION 'Access Denied: Only the Store Manager can record stock movements.';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Received quantity must be strictly greater than 0';
    END IF;

    v_user_company := public.get_current_user_company_id();

    SELECT company_id, current_stock INTO v_mat_company, v_new_stock
      FROM public.raw_materials WHERE id = p_material_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Material record not found';
    END IF;

    IF NOT v_is_super AND (v_user_company IS NULL OR v_mat_company IS DISTINCT FROM v_user_company) THEN
        RAISE EXCEPTION 'RBAC AIR-GAP VIOLATION: cannot record a delivery for a material of company "%" while operating under company "%".',
            v_mat_company, v_user_company;
    END IF;

    v_new_stock := v_new_stock + p_quantity;
    UPDATE public.raw_materials SET current_stock = v_new_stock, updated_at = now() WHERE id = p_material_id;

    INSERT INTO public.stock_receipts (company_id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by)
    VALUES (v_mat_company, p_receipt_date, p_material_id, p_quantity, p_unit, p_supplier_name, auth.uid())
    RETURNING id INTO v_receipt_id;

    INSERT INTO public.activity_audit_logs (company_id, user_id, action, entity_type, entity_id, details)
    VALUES (v_mat_company, auth.uid(), 'STOCK_RECEIPT', 'raw_materials', p_material_id::text,
            jsonb_build_object('receipt_id', v_receipt_id, 'company_id', v_mat_company, 'quantity', p_quantity, 'unit', p_unit, 'new_stock', v_new_stock));

    RETURN jsonb_build_object('success', true, 'company_id', v_mat_company, 'receipt_id', v_receipt_id, 'new_stock', v_new_stock);
END;
$$;

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
    v_user_company TEXT;
    v_mat_company TEXT;
    v_current_stock NUMERIC;
    v_new_stock NUMERIC;
    v_usage_id UUID;
    v_is_super BOOLEAN;
BEGIN
    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access Denied: Account is not active or unauthorized.';
    END IF;
    v_is_super := public.is_super_admin();
    IF NOT (v_is_super OR public.is_manager_user()) THEN
        RAISE EXCEPTION 'Access Denied: Only the Store Manager can record stock movements.';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Disbursed quantity must be strictly greater than 0';
    END IF;

    v_user_company := public.get_current_user_company_id();

    SELECT company_id, current_stock INTO v_mat_company, v_current_stock
      FROM public.raw_materials WHERE id = p_material_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Material record not found';
    END IF;

    IF NOT v_is_super AND (v_user_company IS NULL OR v_mat_company IS DISTINCT FROM v_user_company) THEN
        RAISE EXCEPTION 'RBAC AIR-GAP VIOLATION: cannot consume a material of company "%" while operating under company "%".',
            v_mat_company, v_user_company;
    END IF;

    IF v_current_stock < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: %', v_current_stock, p_quantity;
    END IF;

    v_new_stock := v_current_stock - p_quantity;
    UPDATE public.raw_materials SET current_stock = v_new_stock, updated_at = now() WHERE id = p_material_id;

    INSERT INTO public.material_disbursements (company_id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by)
    VALUES (v_mat_company, p_usage_date, p_material_id, p_quantity, p_unit, p_activity_type, p_finished_product_name, auth.uid())
    RETURNING id INTO v_usage_id;

    INSERT INTO public.activity_audit_logs (company_id, user_id, action, entity_type, entity_id, details)
    VALUES (v_mat_company, auth.uid(), 'MATERIAL_DISBURSEMENT', 'raw_materials', p_material_id::text,
            jsonb_build_object('usage_id', v_usage_id, 'company_id', v_mat_company, 'quantity', p_quantity, 'unit', p_unit,
                               'new_stock', v_new_stock, 'finished_product_name', p_finished_product_name));

    RETURN jsonb_build_object('success', true, 'company_id', v_mat_company, 'usage_id', v_usage_id, 'new_stock', v_new_stock);
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_receipt_v2(UUID, DATE, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_material_disbursement_v2(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_receipt_v2(UUID, DATE, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_material_disbursement_v2(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. GRANTS (RLS above is the real boundary) + append-only audit log
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_materials, public.stock_receipts, public.material_disbursements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT ON public.activity_audit_logs TO authenticated;
REVOKE UPDATE, DELETE ON public.activity_audit_logs FROM authenticated;
REVOKE ALL ON public.companies, public.raw_materials, public.stock_receipts, public.material_disbursements,
              public.activity_audit_logs, public.user_profiles FROM anon;

-- ----------------------------------------------------------------------------
-- 8. REALTIME (staff screens update the moment the manager saves; Realtime honours the RLS above)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH t IN ARRAY ARRAY['raw_materials', 'stock_receipts', 'material_disbursements', 'activity_audit_logs']
        LOOP
            BEGIN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END;
        END LOOP;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- ADMIN HELPERS (callable only by an active admin; nothing here is data)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_register_company(p_id TEXT, p_name TEXT, p_sku_prefix TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- auth.uid() is NULL when run from the Supabase SQL editor (database owner); API users must be an active admin.
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE EXCEPTION 'Access Denied: administrators only.'; END IF;
    INSERT INTO public.companies (id, company_code, name, sku_prefix)
    VALUES (btrim(p_id), btrim(p_id), p_name, NULLIF(btrim(p_sku_prefix), ''))
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sku_prefix = EXCLUDED.sku_prefix, updated_at = now();

    -- Claim materials that have no owner yet and carry this company's SKU prefix (ledgers follow their material).
    IF NULLIF(btrim(p_sku_prefix), '') IS NOT NULL THEN
        UPDATE public.raw_materials SET company_id = btrim(p_id)
         WHERE company_id IS NULL AND upper(item_code) LIKE upper(btrim(p_sku_prefix)) || '%';
    ELSIF (SELECT count(*) FROM public.companies) = 1 THEN
        UPDATE public.raw_materials SET company_id = btrim(p_id) WHERE company_id IS NULL;
    END IF;
    UPDATE public.stock_receipts r SET company_id = m.company_id
      FROM public.raw_materials m WHERE r.material_id = m.id AND r.company_id IS DISTINCT FROM m.company_id;
    UPDATE public.material_disbursements d SET company_id = m.company_id
      FROM public.raw_materials m WHERE d.material_id = m.id AND d.company_id IS DISTINCT FROM m.company_id;
    RETURN btrim(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_user_company(p_email TEXT, p_company_id TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n INT;
BEGIN
    -- auth.uid() is NULL when run from the Supabase SQL editor (database owner); API users must be an active admin.
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE EXCEPTION 'Access Denied: administrators only.'; END IF;
    -- Admin accounts are system-wide and are never assigned to a company (the profile trigger enforces this too).
    UPDATE public.user_profiles SET company_id = btrim(p_company_id)
     WHERE lower(email) = lower(btrim(p_email))
       AND NOT (role = 'admin' OR lower(coalesce(operational_role, '')) IN ('admin', 'super_admin'));
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_register_company(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_assign_user_company(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_company(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_user_company(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- RESULT: who belongs to which company. Rows with an empty company_id see nothing until an admin assigns one:
--   SELECT public.admin_register_company('my_company_id', 'My Company Name', 'SKU-PREFIX-');
--   SELECT public.admin_assign_user_company('someone@example.com', 'my_company_id');
SELECT email, role, operational_role, status, company_id, company_name
  FROM public.user_profiles
 ORDER BY company_id NULLS FIRST, operational_role, email;
