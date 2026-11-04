-- ============================================================================
-- RMIMS FRESH SETUP — 10  FACTORY RESET (Admin)  +  reset signal for every device
-- ============================================================================
--   admin_factory_reset('RESET')   Admin -> Settings -> Factory Reset. Permanently deletes ALL data in Supabase
--                                  (every company) and every Manager / Staff login. Keeps only the Admin login.
--   reset_system_data(scopes)      Manager / Admin: clears chosen parts (raw_materials, stock_receipts,
--                                  material_disbursements, finished_products) - Manager: own company only.
--   system_state.reset_epoch       raised by every reset; every open device sees it (live) and wipes its own
--                                  saved copies, so nothing old comes back from a browser.
-- ============================================================================

CREATE TABLE public.system_state (
    id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    reset_epoch TIMESTAMPTZ NOT NULL DEFAULT now(),
    reset_by    UUID,
    reset_scope TEXT NOT NULL DEFAULT 'setup',
    company_id  TEXT
);
INSERT INTO public.system_state (id, reset_epoch, reset_scope) VALUES (1, now(), 'setup');

ALTER TABLE public.system_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_state_read ON public.system_state FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.system_state FROM anon;
GRANT SELECT ON public.system_state TO authenticated;
GRANT ALL ON public.system_state TO service_role;

-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_factory_reset(p_confirm TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_users INT;
BEGIN
    IF NOT public.is_admin_user() THEN
        RAISE EXCEPTION 'RMIMS_DENIED: only the Admin can factory-reset the system.' USING ERRCODE = '42501';
    END IF;
    IF p_confirm IS DISTINCT FROM 'RESET' THEN
        RAISE EXCEPTION 'RMIMS_INVALID: type RESET to confirm.' USING ERRCODE = '22023';
    END IF;

    -- operational data (every company)
    DELETE FROM public.material_disbursements;
    DELETE FROM public.stock_receipts;
    DELETE FROM public.finished_products;
    DELETE FROM public.raw_materials;
    DELETE FROM public.activity_audit_logs;
    DELETE FROM public.admin_activity_logs;
    DELETE FROM public.system_notifications;
    DELETE FROM public.system_maintenance_alerts;
    DELETE FROM public.branch_store_personnel;
    DELETE FROM public.branch_stores;
    DELETE FROM public.admin_system_settings;
    DELETE FROM public.backup_history;
    DELETE FROM public.auth_login_attempts;
    DELETE FROM public.auth_rate_limits;

    -- every login except the Admin(s); their profiles go with them
    DELETE FROM auth.users u
     WHERE NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = u.id AND p.operational_role = 'admin');
    GET DIAGNOSTICS v_users = ROW_COUNT;

    UPDATE public.system_state SET reset_epoch = now(), reset_by = auth.uid(), reset_scope = 'factory', company_id = NULL WHERE id = 1;
    RETURN jsonb_build_object('success', true, 'accounts_removed', v_users, 'reset_epoch', now());
END;
$$;

-- ---------------------------------------------------------------------------
CREATE FUNCTION public.reset_system_data(scopes TEXT[]) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_admin   BOOLEAN := public.is_admin_user();
    v_company TEXT := public.get_current_user_company_id();
    s TEXT;
BEGIN
    IF NOT (v_admin OR public.is_manager_user()) THEN
        RAISE EXCEPTION 'RMIMS_DENIED: only the Manager or the Admin can reset data.' USING ERRCODE = '42501';
    END IF;
    FOREACH s IN ARRAY coalesce(scopes, ARRAY[]::TEXT[]) LOOP
        IF s NOT IN ('raw_materials', 'stock_receipts', 'material_disbursements', 'finished_products') THEN
            RAISE EXCEPTION 'RMIMS_INVALID: unknown reset scope %.', s USING ERRCODE = '22023';
        END IF;
    END LOOP;

    IF 'material_disbursements' = ANY (scopes) OR 'raw_materials' = ANY (scopes) THEN
        DELETE FROM public.material_disbursements WHERE v_admin OR company_id = v_company;
    END IF;
    IF 'stock_receipts' = ANY (scopes) OR 'raw_materials' = ANY (scopes) THEN
        DELETE FROM public.stock_receipts WHERE v_admin OR company_id = v_company;
    END IF;
    IF 'finished_products' = ANY (scopes) THEN
        DELETE FROM public.finished_products WHERE v_admin OR company_id = v_company;
        DELETE FROM public.activity_audit_logs
         WHERE action IN ('UPSERT_FINISHED_PRODUCT', 'DELETE_FINISHED_PRODUCT') AND (v_admin OR company_id = v_company);
    END IF;
    IF 'raw_materials' = ANY (scopes) THEN
        DELETE FROM public.raw_materials WHERE v_admin OR company_id = v_company;
    END IF;

    UPDATE public.system_state
       SET reset_epoch = now(), reset_by = auth.uid(), reset_scope = array_to_string(scopes, ','),
           company_id = CASE WHEN v_admin THEN NULL ELSE v_company END
     WHERE id = 1;
    RETURN jsonb_build_object('success', true, 'scopes', scopes);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_factory_reset(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_system_data(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_factory_reset(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_system_data(TEXT[]) TO authenticated;
