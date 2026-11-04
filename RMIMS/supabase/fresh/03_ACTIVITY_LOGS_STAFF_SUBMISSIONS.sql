-- ============================================================================
-- RMIMS FRESH SETUP — 03  ACTIVITY LOGS + STAFF SUBMISSIONS
-- ============================================================================
--   activity_audit_logs  append-only log of every operation. Staff submissions (receive / disburse waiting
--                        for the Manager) and the Manager's approve / return / reject decisions are rows here,
--                        so Manager and Staff see the same submission on every device.
--   admin_activity_logs  the Admin's Activity Logs module (sign-ins, account events, admin actions).
-- Who wrote a row and which company it belongs to are stamped by the database, never by the browser.
-- ============================================================================

CREATE TABLE public.activity_audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  TEXT REFERENCES public.companies(id),
    user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   TEXT,
    details     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_company_time ON public.activity_audit_logs (company_id, created_at DESC);
CREATE INDEX idx_audit_action       ON public.activity_audit_logs (action);
CREATE INDEX idx_audit_entity       ON public.activity_audit_logs (entity_type, entity_id);

CREATE FUNCTION public.audit_log_stamp() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.user_id := auth.uid();
        IF NOT public.is_admin_user() THEN
            NEW.company_id := public.get_current_user_company_id();
        END IF;
    END IF;
    NEW.created_at := coalesce(NEW.created_at, now());
    IF NEW.created_at > now() + interval '5 minutes' THEN NEW.created_at := now(); END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_audit_log_stamp
BEFORE INSERT ON public.activity_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.audit_log_stamp();

ALTER TABLE public.activity_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_admin_read ON public.activity_audit_logs FOR SELECT TO authenticated
    USING (public.is_admin_user());
CREATE POLICY audit_company_read ON public.activity_audit_logs FOR SELECT TO authenticated
    USING (company_id IS NOT NULL AND company_id = public.get_current_user_company_id());
CREATE POLICY audit_insert ON public.activity_audit_logs FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_user() OR (company_id IS NOT NULL AND company_id = public.get_current_user_company_id()));
-- append-only: no UPDATE / DELETE for anyone through the API

REVOKE ALL ON public.activity_audit_logs FROM anon;
GRANT SELECT, INSERT ON public.activity_audit_logs TO authenticated;
GRANT ALL ON public.activity_audit_logs TO service_role;

-- ---------------------------------------------------------------------------
CREATE TABLE public.admin_activity_logs (
    id              TEXT PRIMARY KEY DEFAULT ('act-' || replace(gen_random_uuid()::text, '-', '')),
    company_id      TEXT REFERENCES public.companies(id),
    user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_name       TEXT NOT NULL DEFAULT '—',
    role            TEXT NOT NULL DEFAULT '—',
    branch_location TEXT NOT NULL DEFAULT '—',
    branch_name     TEXT NOT NULL DEFAULT '—',
    action          TEXT NOT NULL,
    module          TEXT NOT NULL DEFAULT 'General',
    details         TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'warning', 'failed')),
    ip_address      TEXT,
    "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_activity_time ON public.admin_activity_logs ("timestamp" DESC);

CREATE FUNCTION public.admin_activity_stamp() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.user_id := auth.uid();
        IF NOT public.is_admin_user() THEN NEW.company_id := public.get_current_user_company_id(); END IF;
    END IF;
    IF NEW."timestamp" IS NULL OR NEW."timestamp" > now() + interval '5 minutes' THEN NEW."timestamp" := now(); END IF;
    NEW.status := lower(btrim(coalesce(NEW.status, 'success')));
    IF NEW.status NOT IN ('success', 'warning', 'failed') THEN NEW.status := 'success'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_admin_activity_stamp
BEFORE INSERT ON public.admin_activity_logs
FOR EACH ROW EXECUTE FUNCTION public.admin_activity_stamp();

ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_activity_read ON public.admin_activity_logs FOR SELECT TO authenticated
    USING (public.is_admin_user());
CREATE POLICY admin_activity_insert ON public.admin_activity_logs FOR INSERT TO authenticated
    WITH CHECK (public.is_active_user());

REVOKE ALL ON public.admin_activity_logs FROM anon;
GRANT SELECT, INSERT ON public.admin_activity_logs TO authenticated;
GRANT ALL ON public.admin_activity_logs TO service_role;
