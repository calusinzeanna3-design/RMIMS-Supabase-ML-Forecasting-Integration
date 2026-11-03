-- ============================================================================
-- RMIMS FRESH SETUP — 09  ADMIN: branch stores, personnel, system settings, backups
-- ============================================================================
-- All start EMPTY: the Admin registers branch stores and changes settings in the Admin pages.
-- (Settings the Admin has not changed use the system's built-in behaviour.)
-- ============================================================================

CREATE TABLE public.branch_stores (
    id                      TEXT PRIMARY KEY,
    company_id              TEXT REFERENCES public.companies(id),
    branch_key              TEXT NOT NULL UNIQUE,
    branch_name             TEXT NOT NULL,
    branch_location         TEXT NOT NULL DEFAULT '—',
    address                 TEXT,
    operating_status        TEXT NOT NULL DEFAULT 'active' CHECK (operating_status IN ('active', 'inactive', 'maintenance')),
    contact_number          TEXT,
    contact_email           TEXT,
    daily_output_target     NUMERIC(12,2),
    storage_capacity_pct    NUMERIC(5,2) CHECK (storage_capacity_pct IS NULL OR (storage_capacity_pct >= 0 AND storage_capacity_pct <= 100)),
    active_alerts_count     INTEGER NOT NULL DEFAULT 0,
    metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_branch_stores_touch BEFORE UPDATE ON public.branch_stores
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.branch_store_personnel (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id       TEXT NOT NULL REFERENCES public.branch_stores(id) ON DELETE CASCADE,
    user_profile_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('Manager', 'Staff', 'Admin')),
    email           TEXT,
    phone           TEXT,
    shift           TEXT,
    status          TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'On Leave', 'Inactive')),
    avatar          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_branch_personnel_branch ON public.branch_store_personnel (branch_id);
CREATE TRIGGER trg_branch_personnel_touch BEFORE UPDATE ON public.branch_store_personnel
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.admin_system_settings (
    setting_key   TEXT PRIMARY KEY,
    setting_value JSONB NOT NULL,
    description   TEXT,
    category      TEXT,
    updated_by    TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.backup_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_name     TEXT NOT NULL,
    storage_path    TEXT NOT NULL DEFAULT '',
    created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    company_id      TEXT REFERENCES public.companies(id),
    file_size_bytes BIGINT,
    status          TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'failed')),
    categories      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    record_counts   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION public.backup_history_stamp() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.created_by := auth.uid();
        NEW.company_id := CASE WHEN public.is_admin_user() THEN NULL ELSE public.get_current_user_company_id() END;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_backup_history_stamp BEFORE INSERT ON public.backup_history
FOR EACH ROW EXECUTE FUNCTION public.backup_history_stamp();

-- RLS
ALTER TABLE public.branch_stores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_store_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_system_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_history         ENABLE ROW LEVEL SECURITY;

CREATE POLICY branches_read ON public.branch_stores FOR SELECT TO authenticated
    USING (public.is_admin_user() OR company_id IS NULL OR company_id = public.get_current_user_company_id());
CREATE POLICY branches_admin_write ON public.branch_stores FOR ALL TO authenticated
    USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

CREATE POLICY personnel_read ON public.branch_store_personnel FOR SELECT TO authenticated
    USING (public.is_admin_user() OR EXISTS (SELECT 1 FROM public.branch_stores b
                                              WHERE b.id = branch_id AND (b.company_id IS NULL OR b.company_id = public.get_current_user_company_id())));
CREATE POLICY personnel_admin_write ON public.branch_store_personnel FOR ALL TO authenticated
    USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

CREATE POLICY settings_read ON public.admin_system_settings FOR SELECT TO authenticated
    USING (public.is_active_user());
CREATE POLICY settings_admin_write ON public.admin_system_settings FOR ALL TO authenticated
    USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

CREATE POLICY backups_read ON public.backup_history FOR SELECT TO authenticated
    USING (public.is_admin_user() OR (company_id IS NOT NULL AND company_id = public.get_current_user_company_id() AND public.is_manager_user()));
CREATE POLICY backups_insert ON public.backup_history FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_user() OR public.is_manager_user());

REVOKE ALL ON public.branch_stores, public.branch_store_personnel, public.admin_system_settings, public.backup_history FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_stores, public.branch_store_personnel, public.admin_system_settings TO authenticated;
GRANT SELECT, INSERT ON public.backup_history TO authenticated;
GRANT ALL ON public.branch_stores, public.branch_store_personnel, public.admin_system_settings, public.backup_history TO service_role;

-- ---------------------------------------------------------------------------
-- BACKUP FILES (private Storage bucket) + RESTORE
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('rmims-backups', 'rmims-backups', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS rmims_backups_own_folder_read   ON storage.objects;
DROP POLICY IF EXISTS rmims_backups_own_folder_insert ON storage.objects;
CREATE POLICY rmims_backups_own_folder_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'rmims-backups' AND (public.is_admin_user() OR (storage.foldername(name))[1] = auth.uid()::text));
CREATE POLICY rmims_backups_own_folder_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'rmims-backups' AND (public.is_admin_user() OR public.is_manager_user())
                AND (storage.foldername(name))[1] = auth.uid()::text);

-- backup rows from older versions may miss newer columns: fill them with the column defaults
CREATE FUNCTION public.rmims_rows_with_defaults(p_rows JSONB, p_defaults JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(jsonb_agg(p_defaults || e), '[]'::jsonb)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows ELSE '[]'::jsonb END) e;
$$;

-- Restore a backup the Manager / Admin made (rows are put back for the caller's own company only).
-- payload = { "raw_materials": [...], "stock_receipts": [...], "material_disbursements": [...] }
CREATE FUNCTION public.restore_backup(payload JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_company TEXT := public.get_current_user_company_id();
    v_admin BOOLEAN := public.is_admin_user();
    n_m INT := 0; n_r INT := 0; n_d INT := 0;
BEGIN
    IF NOT (v_admin OR public.is_manager_user()) THEN
        RAISE EXCEPTION 'RMIMS_DENIED: only the Manager or the Admin can restore a backup.' USING ERRCODE = '42501';
    END IF;
    PERFORM set_config('rmims.fp_sync', 'on', true);
    INSERT INTO public.raw_materials
    SELECT * FROM jsonb_populate_recordset(NULL::public.raw_materials, public.rmims_rows_with_defaults(payload->'raw_materials',
                jsonb_build_object('current_stock', 0, 'last_updated', now(), 'latest_date', now(), 'created_at', now(), 'updated_at', now()))) x
     WHERE v_admin OR x.company_id = v_company
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n_m = ROW_COUNT;
    PERFORM set_config('rmims.fp_sync', 'on', true);
    INSERT INTO public.stock_receipts
    SELECT * FROM jsonb_populate_recordset(NULL::public.stock_receipts, public.rmims_rows_with_defaults(payload->'stock_receipts',
                jsonb_build_object('finished_product_auto', false, 'created_at', now()))) x
     WHERE (v_admin OR x.company_id = v_company) AND EXISTS (SELECT 1 FROM public.raw_materials m WHERE m.id = x.material_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n_r = ROW_COUNT;
    PERFORM set_config('rmims.fp_sync', 'on', true);
    INSERT INTO public.material_disbursements
    SELECT * FROM jsonb_populate_recordset(NULL::public.material_disbursements, public.rmims_rows_with_defaults(payload->'material_disbursements',
                jsonb_build_object('finished_product_auto', false, 'created_at', now()))) x
     WHERE (v_admin OR x.company_id = v_company) AND EXISTS (SELECT 1 FROM public.raw_materials m WHERE m.id = x.material_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n_d = ROW_COUNT;
    PERFORM set_config('rmims.fp_sync', 'off', true);
    RETURN jsonb_build_object('success', true, 'raw_materials', n_m, 'stock_receipts', n_r, 'material_disbursements', n_d);
END;
$$;
REVOKE ALL ON FUNCTION public.restore_backup(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_backup(JSONB) TO authenticated;
