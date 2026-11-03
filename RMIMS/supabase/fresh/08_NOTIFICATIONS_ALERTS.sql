-- ============================================================================
-- RMIMS FRESH SETUP — 08  NOTIFICATIONS + SYSTEM ALERTS
-- ============================================================================
--   system_notifications       the bell: one company's Manager <-> Staff, and Admin <-> everyone.
--                              Sender, role and company are stamped by the database (cannot be faked).
--   system_maintenance_alerts  the Admin's System Alerts (e.g. account locked after wrong passwords).
-- Both start EMPTY; rows are created by what users do.
-- ============================================================================

CREATE TABLE public.system_notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      TEXT REFERENCES public.companies(id),   -- NULL = Admin message to every company
    company_name    TEXT,
    branch_location TEXT,
    sender_id       UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
    sender_name     TEXT,
    sender_role     TEXT NOT NULL DEFAULT 'staff' CHECK (sender_role IN ('admin', 'manager', 'staff')),
    target_roles    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    title           TEXT NOT NULL,
    message         TEXT,
    category        TEXT,
    priority        TEXT,
    badge           TEXT,
    target_url      TEXT,
    reference       TEXT,
    source_key      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_company_time ON public.system_notifications (company_id, created_at DESC);
CREATE UNIQUE INDEX uq_notifications_sender_source ON public.system_notifications (sender_id, source_key);

CREATE FUNCTION public.system_notifications_stamp() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_allowed TEXT[];
BEGIN
    NEW.sender_id := auth.uid();
    IF public.is_admin_user() THEN
        NEW.sender_role := 'admin';
        v_allowed := ARRAY['manager', 'staff'];
    ELSIF public.is_manager_user() THEN
        NEW.sender_role := 'manager';
        NEW.company_id := public.get_current_user_company_id();
        v_allowed := ARRAY['staff', 'admin'];
    ELSE
        NEW.sender_role := 'staff';
        NEW.company_id := public.get_current_user_company_id();
        v_allowed := ARRAY['manager', 'admin'];
    END IF;
    SELECT coalesce(array_agg(DISTINCT t), ARRAY[]::TEXT[]) INTO NEW.target_roles
      FROM unnest(coalesce(NEW.target_roles, ARRAY[]::TEXT[])) t WHERE t = ANY (v_allowed);
    IF array_length(NEW.target_roles, 1) IS NULL THEN NEW.target_roles := v_allowed; END IF;
    IF NEW.company_id IS NOT NULL THEN
        SELECT name INTO NEW.company_name FROM public.companies WHERE id = NEW.company_id;
    END IF;
    NEW.created_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_system_notifications_stamp
BEFORE INSERT ON public.system_notifications
FOR EACH ROW EXECUTE FUNCTION public.system_notifications_stamp();

ALTER TABLE public.system_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_read ON public.system_notifications FOR SELECT TO authenticated
    USING (
        sender_id = auth.uid()
        OR (public.is_admin_user() AND 'admin' = ANY (target_roles))
        OR (NOT public.is_admin_user()
            AND (company_id IS NULL OR company_id = public.get_current_user_company_id())
            AND public.is_active_user()
            AND ((public.is_manager_user() AND 'manager' = ANY (target_roles))
              OR (public.is_staff_user()   AND 'staff'   = ANY (target_roles))))
    );
CREATE POLICY notifications_insert ON public.system_notifications FOR INSERT TO authenticated
    WITH CHECK (public.is_active_user());

REVOKE ALL ON public.system_notifications FROM anon;
GRANT SELECT, INSERT ON public.system_notifications TO authenticated;
GRANT ALL ON public.system_notifications TO service_role;

-- ---------------------------------------------------------------------------
CREATE TABLE public.system_maintenance_alerts (
    id               TEXT PRIMARY KEY DEFAULT ('ALT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
    company_id       TEXT REFERENCES public.companies(id),
    type             TEXT NOT NULL,
    category         TEXT NOT NULL DEFAULT 'system' CHECK (category IN ('inventory', 'forecast', 'network', 'system', 'security')),
    severity         TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('critical', 'warning', 'info', 'high', 'medium', 'low')),
    status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'monitoring', 'resolved', 'acknowledged')),
    branch_store_id  TEXT,
    branch_location  TEXT NOT NULL DEFAULT '—',
    branch_name      TEXT NOT NULL DEFAULT '—',
    occurrence       INTEGER NOT NULL DEFAULT 1,
    first_detected   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_detected    TIMESTAMPTZ NOT NULL DEFAULT now(),
    details          TEXT NOT NULL DEFAULT '',
    suggested_action TEXT,
    resolved_at      TIMESTAMPTZ,
    resolved_by      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alerts_status ON public.system_maintenance_alerts (status, last_detected DESC);
CREATE TRIGGER trg_alerts_touch BEFORE UPDATE ON public.system_maintenance_alerts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- values from any page are normalised (e.g. "Security" -> security) so an alert is never rejected
CREATE FUNCTION public.alerts_normalize() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.category := lower(btrim(coalesce(NEW.category, '')));
    IF NEW.category NOT IN ('inventory', 'forecast', 'network', 'system', 'security') THEN
        NEW.category := CASE WHEN NEW.category ~ 'secur|login|auth|lock|account' THEN 'security'
                             WHEN NEW.category ~ 'stock|inventor|material' THEN 'inventory'
                             WHEN NEW.category ~ 'forecast|predict' THEN 'forecast'
                             WHEN NEW.category ~ 'network|sync|branch' THEN 'network' ELSE 'system' END;
    END IF;
    NEW.severity := lower(btrim(coalesce(NEW.severity, 'warning')));
    IF NEW.severity NOT IN ('critical', 'warning', 'info', 'high', 'medium', 'low') THEN NEW.severity := 'warning'; END IF;
    NEW.status := lower(btrim(coalesce(NEW.status, 'active')));
    IF NEW.status NOT IN ('active', 'monitoring', 'resolved', 'acknowledged') THEN NEW.status := 'active'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_alerts_normalize BEFORE INSERT OR UPDATE ON public.system_maintenance_alerts
FOR EACH ROW EXECUTE FUNCTION public.alerts_normalize();

ALTER TABLE public.system_maintenance_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY alerts_admin_all ON public.system_maintenance_alerts FOR ALL TO authenticated
    USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());
CREATE POLICY alerts_company_read ON public.system_maintenance_alerts FOR SELECT TO authenticated
    USING (company_id IS NOT NULL AND company_id = public.get_current_user_company_id() AND public.is_manager_user());
CREATE POLICY alerts_user_insert ON public.system_maintenance_alerts FOR INSERT TO authenticated
    WITH CHECK (public.is_active_user());

REVOKE ALL ON public.system_maintenance_alerts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_maintenance_alerts TO authenticated;
GRANT ALL ON public.system_maintenance_alerts TO service_role;
