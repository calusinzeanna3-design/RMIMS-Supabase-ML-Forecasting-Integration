-- ============================================================================
-- RMIMS — SHARED NOTIFICATION FEED (Admin ⇄ Manager ⇄ Staff, per company)
-- ============================================================================
-- Run once in the Supabase SQL editor (safe to re-run). Requires RMIMS_FULL_SETUP_RUN_ONCE.sql
-- (is_active_user, is_super_admin, is_manager_user, get_current_user_company_id).
--
-- Who receives what:
--   Admin   <- system updates of the Managers and Staff of EVERY company
--   Manager <- updates of the Staff of its own company + system messages from the Admin
--   Staff   <- updates of the Manager of its own company + system messages from the Admin
--
-- The database decides the sender, role and company (never the browser), and RLS only returns a row to a
-- reader whose role is in target_roles and whose company matches (Admin messages with company_id NULL reach
-- every company).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.system_notifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    TEXT,                       -- NULL = all companies (Admin system message)
    company_name  TEXT,
    branch_location TEXT,
    sender_id     UUID DEFAULT auth.uid(),
    sender_name   TEXT,
    sender_role   TEXT NOT NULL DEFAULT 'staff' CHECK (sender_role IN ('admin', 'manager', 'staff')),
    target_roles  TEXT[] NOT NULL,
    title         TEXT NOT NULL,
    message       TEXT,
    category      TEXT,
    priority      TEXT,
    badge         TEXT,
    target_url    TEXT,
    reference     TEXT,
    source_key    TEXT,                       -- the sender's own notification id (de-duplication)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_notifications_company_time ON public.system_notifications (company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_notifications_sender_source ON public.system_notifications (sender_id, source_key);

-- Stamp sender / role / company from the signed-in profile and keep targets inside the allowed directions.
CREATE OR REPLACE FUNCTION public.system_notifications_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_allowed TEXT[];
BEGIN
    NEW.sender_id := auth.uid();

    IF public.is_super_admin() THEN
        NEW.sender_role := 'admin';
        v_allowed := ARRAY['manager', 'staff'];
        -- Admin may address one company or all (NULL)
    ELSIF public.is_manager_user() THEN
        NEW.sender_role := 'manager';
        NEW.company_id := public.get_current_user_company_id();
        v_allowed := ARRAY['staff', 'admin'];
    ELSE
        NEW.sender_role := 'staff';
        NEW.company_id := public.get_current_user_company_id();
        v_allowed := ARRAY['manager', 'admin'];
    END IF;

    SELECT COALESCE(array_agg(DISTINCT t), ARRAY[]::TEXT[])
      INTO NEW.target_roles
      FROM unnest(NEW.target_roles) AS t
     WHERE t = ANY (v_allowed);

    IF array_length(NEW.target_roles, 1) IS NULL THEN
        NEW.target_roles := v_allowed;
    END IF;

    NEW.created_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_system_notifications_stamp ON public.system_notifications;
CREATE TRIGGER trg_system_notifications_stamp
BEFORE INSERT ON public.system_notifications
FOR EACH ROW EXECUTE FUNCTION public.system_notifications_stamp();

ALTER TABLE public.system_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_notifications_read ON public.system_notifications;
CREATE POLICY system_notifications_read ON public.system_notifications FOR SELECT TO authenticated
    USING (
        sender_id = auth.uid()
        OR (public.is_super_admin() AND 'admin' = ANY (target_roles))
        OR (
            public.is_active_user()
            AND NOT public.is_super_admin()
            AND (company_id IS NULL OR company_id = public.get_current_user_company_id())
            AND (
                (public.is_manager_user() AND 'manager' = ANY (target_roles))
                OR (NOT public.is_manager_user() AND 'staff' = ANY (target_roles))
            )
        )
    );

DROP POLICY IF EXISTS system_notifications_insert ON public.system_notifications;
CREATE POLICY system_notifications_insert ON public.system_notifications FOR INSERT TO authenticated
    WITH CHECK (public.is_active_user() OR public.is_super_admin());

GRANT SELECT, INSERT ON public.system_notifications TO authenticated;
REVOKE UPDATE, DELETE ON public.system_notifications FROM authenticated;
REVOKE ALL ON public.system_notifications FROM anon;

-- Live delivery (Supabase Realtime)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'system_notifications'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.system_notifications;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
