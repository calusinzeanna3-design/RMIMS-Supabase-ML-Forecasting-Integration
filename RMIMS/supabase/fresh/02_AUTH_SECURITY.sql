-- ============================================================================
-- RMIMS FRESH SETUP — 02  AUTHENTICATION SECURITY (used by the auth-gate Edge Function)
-- ============================================================================
-- Every invalid case has its OWN check function. They run only on the server: the auth-gate Edge Function
-- calls them with the service key; the browser can neither call nor read them.
--
--   auth_check_rate_limit      too many attempts from one device / for one account   -> TOO_MANY_REQUESTS
--   auth_resolve_identifier    blank, bad e-mail format, e-mail / username not found -> EMPTY_IDENTIFIER,
--                              INVALID_EMAIL_FORMAT, EMAIL_NOT_REGISTERED, USERNAME_NOT_FOUND
--   auth_check_lockout         account locked after repeated wrong passwords         -> ACCOUNT_LOCKED
--   auth_check_account_status  pending approval, rejected, inactive, suspended, no company
--   auth_record_failed_login   wrong password (+ warning on the last attempts, lock at the limit)
--   auth_record_successful_login
--   auth_check_signup          blank fields, bad e-mail, e-mail already registered / pending, username
--                              taken / too short / invalid, full name invalid, company not registered,
--                              role not allowed
--   auth_check_reset_email     password-reset e-mail not registered / not approved / locked
-- Admin account functions (signed-in Admin only): approve, reject, set status, unlock, delete account.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- TABLES (server-only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.auth_login_attempts (
    email          TEXT PRIMARY KEY,
    failed_count   INT         NOT NULL DEFAULT 0,
    last_failed_at TIMESTAMPTZ,
    locked_at      TIMESTAMPTZ,
    locked_until   TIMESTAMPTZ,            -- temporary lock (Admin accounts), NULL = until the Admin unlocks
    last_ip        TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.auth_rate_limits (
    bucket       TEXT PRIMARY KEY,         -- e.g. 'ip:1.2.3.4:login' or 'email:x@y:login'
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    hits         INT         NOT NULL DEFAULT 0
);

ALTER TABLE public.auth_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits    ENABLE ROW LEVEL SECURITY;
-- no policies: only the service role (Edge Function) and the Admin functions below touch them
REVOKE ALL ON public.auth_login_attempts, public.auth_rate_limits FROM anon, authenticated;
GRANT ALL ON public.auth_login_attempts, public.auth_rate_limits TO service_role;

-- ---------------------------------------------------------------------------
-- SETTINGS used by the checks (the Admin can change them in Settings; table created in file 09)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.auth_setting_int(p_key TEXT, p_default INT) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE v TEXT;
BEGIN
    IF to_regclass('public.admin_system_settings') IS NULL THEN RETURN p_default; END IF;
    EXECUTE 'SELECT setting_value::text FROM public.admin_system_settings WHERE setting_key = $1' INTO v USING p_key;
    RETURN coalesce(nullif(regexp_replace(coalesce(v, ''), '[^0-9]', '', 'g'), '')::int, p_default);
EXCEPTION WHEN others THEN RETURN p_default;
END;
$$;

-- writes a security event to the admin activity log / alerts (tables from files 07 and 08)
CREATE FUNCTION public.auth_log_event(p_email TEXT, p_action TEXT, p_status TEXT, p_details TEXT, p_ip TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.user_profiles;
BEGIN
    SELECT * INTO p FROM public.user_profiles WHERE email = lower(btrim(p_email));
    IF to_regclass('public.admin_activity_logs') IS NOT NULL THEN
        EXECUTE 'INSERT INTO public.admin_activity_logs (user_id, user_name, role, branch_location, branch_name, action, module, details, status, ip_address, company_id)
                 VALUES ($1, $2, $3, $4, $5, $6, ''Authentication'', $7, $8, $9, $10)'
        USING p.id, coalesce(p.full_name, p.username, lower(btrim(p_email))),
              CASE p.operational_role WHEN 'admin' THEN 'Admin' WHEN 'manager' THEN 'Manager' WHEN 'staff' THEN 'Staff' ELSE 'Unknown' END,
              coalesce(p.branch_location, CASE WHEN p.operational_role = 'admin' THEN 'Headquarters' ELSE '—' END),
              coalesce(p.branch_name, p.company_name, CASE WHEN p.operational_role = 'admin' THEN 'Main Administration' ELSE '—' END),
              p_action, p_details, p_status, p_ip, p.company_id;
    END IF;
EXCEPTION WHEN others THEN NULL;   -- logging never blocks a sign-in
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. RATE LIMIT
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.auth_check_rate_limit(p_bucket TEXT, p_max INT, p_window_seconds INT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.auth_rate_limits;
BEGIN
    INSERT INTO public.auth_rate_limits (bucket, window_start, hits) VALUES (p_bucket, now(), 0)
    ON CONFLICT (bucket) DO NOTHING;
    SELECT * INTO r FROM public.auth_rate_limits WHERE bucket = p_bucket FOR UPDATE;
    IF r.window_start < now() - make_interval(secs => p_window_seconds) THEN
        UPDATE public.auth_rate_limits SET window_start = now(), hits = 1 WHERE bucket = p_bucket;
        RETURN 'OK';
    END IF;
    IF r.hits >= p_max THEN RETURN 'TOO_MANY_REQUESTS'; END IF;
    UPDATE public.auth_rate_limits SET hits = hits + 1 WHERE bucket = p_bucket;
    RETURN 'OK';
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. IDENTIFIER (e-mail or username)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.auth_resolve_identifier(p_identifier TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE
    v TEXT := lower(btrim(coalesce(p_identifier, '')));
    v_email TEXT;
BEGIN
    IF v = '' THEN RETURN jsonb_build_object('code', 'EMPTY_IDENTIFIER'); END IF;
    IF position('@' IN v) > 0 THEN
        IF v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('code', 'INVALID_EMAIL_FORMAT'); END IF;
        SELECT email INTO v_email FROM public.user_profiles WHERE email = v;
        IF v_email IS NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v) THEN
            RETURN jsonb_build_object('code', 'EMAIL_NOT_REGISTERED');
        END IF;
        RETURN jsonb_build_object('code', 'OK', 'email', v);
    END IF;
    SELECT email INTO v_email FROM public.user_profiles WHERE lower(username) = v LIMIT 1;
    IF v_email IS NULL THEN RETURN jsonb_build_object('code', 'USERNAME_NOT_FOUND'); END IF;
    RETURN jsonb_build_object('code', 'OK', 'email', v_email);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. LOCKOUT
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.auth_check_lockout(p_email TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.auth_login_attempts;
BEGIN
    SELECT * INTO a FROM public.auth_login_attempts WHERE email = lower(btrim(p_email));
    IF a.locked_at IS NULL THEN RETURN jsonb_build_object('code', 'OK'); END IF;
    IF a.locked_until IS NOT NULL AND a.locked_until <= now() THEN
        UPDATE public.auth_login_attempts SET failed_count = 0, locked_at = NULL, locked_until = NULL, updated_at = now()
         WHERE email = a.email;
        RETURN jsonb_build_object('code', 'OK');
    END IF;
    RETURN jsonb_build_object('code', 'ACCOUNT_LOCKED', 'locked_until', a.locked_until);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. ACCOUNT STATUS
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.auth_check_account_status(p_email TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE p public.user_profiles;
BEGIN
    SELECT * INTO p FROM public.user_profiles WHERE email = lower(btrim(p_email));
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NO_PROFILE'); END IF;
    IF p.status = 'pending'   THEN RETURN jsonb_build_object('code', 'PENDING_APPROVAL'); END IF;
    IF p.status = 'rejected'  THEN RETURN jsonb_build_object('code', 'REJECTED'); END IF;
    IF p.status = 'locked'    THEN RETURN jsonb_build_object('code', 'ACCOUNT_LOCKED'); END IF;
    IF p.status = 'suspended' THEN RETURN jsonb_build_object('code', 'SUSPENDED'); END IF;
    IF p.status = 'inactive'  THEN RETURN jsonb_build_object('code', 'INACTIVE'); END IF;
    IF p.operational_role <> 'admin' AND p.company_id IS NULL THEN RETURN jsonb_build_object('code', 'NO_COMPANY'); END IF;
    RETURN jsonb_build_object('code', 'OK', 'role', p.operational_role);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. WRONG PASSWORD / SUCCESS
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.auth_record_failed_login(p_email TEXT, p_ip TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_email TEXT := lower(btrim(p_email));
    v_max   INT  := greatest(3, public.auth_setting_int('account_lockout_consecutive_failed_logins', 5));
    v_count INT;
    v_admin BOOLEAN;
BEGIN
    SELECT (operational_role = 'admin') INTO v_admin FROM public.user_profiles WHERE email = v_email;
    INSERT INTO public.auth_login_attempts (email, failed_count, last_failed_at, last_ip, updated_at)
    VALUES (v_email, 1, now(), p_ip, now())
    ON CONFLICT (email) DO UPDATE SET failed_count = public.auth_login_attempts.failed_count + 1,
                                      last_failed_at = now(), last_ip = p_ip, updated_at = now()
    RETURNING failed_count INTO v_count;

    IF v_count >= v_max THEN
        -- the Admin is locked for 15 minutes (so the system is never left without its Admin);
        -- Managers and Staff stay locked until the Admin unlocks them
        UPDATE public.auth_login_attempts
           SET locked_at = now(), locked_until = CASE WHEN coalesce(v_admin, false) THEN now() + interval '15 minutes' END
         WHERE email = v_email;
        IF NOT coalesce(v_admin, false) THEN
            UPDATE public.user_profiles SET status = 'locked' WHERE email = v_email AND status = 'active';
        END IF;
        PERFORM public.auth_log_event(v_email, 'Account Locked', 'failed',
                format('Account locked after %s failed sign-in attempts.', v_count), p_ip);
        IF to_regclass('public.system_maintenance_alerts') IS NOT NULL THEN
            EXECUTE 'INSERT INTO public.system_maintenance_alerts (type, category, severity, status, branch_location, branch_name, details, suggested_action, company_id)
                     SELECT ''Account Lockout'', ''security'', ''critical'', ''active'',
                            coalesce(p.branch_location, ''—''), coalesce(p.branch_name, p.company_name, ''—''),
                            format(''%s was locked after %s failed sign-in attempts.'', $1, $2),
                            ''Verify the user, then unlock the account in User Management.'', p.company_id
                       FROM (SELECT $1 AS e) x LEFT JOIN public.user_profiles p ON p.email = x.e'
            USING v_email, v_count;
        END IF;
        RETURN jsonb_build_object('code', 'ACCOUNT_LOCKED', 'attempts', v_count, 'max', v_max,
                                  'temporary', coalesce(v_admin, false));
    END IF;

    PERFORM public.auth_log_event(v_email, 'Failed Login', 'warning',
            format('Wrong password (attempt %s of %s).', v_count, v_max), p_ip);
    RETURN jsonb_build_object('code', 'WRONG_PASSWORD', 'attempts', v_count, 'max', v_max,
                              'remaining', v_max - v_count, 'warning', (v_max - v_count) <= 2);
END;
$$;

CREATE FUNCTION public.auth_record_successful_login(p_email TEXT, p_ip TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    DELETE FROM public.auth_login_attempts WHERE email = lower(btrim(p_email));
    PERFORM public.auth_log_event(p_email, 'Login', 'success', 'Signed in.', p_ip);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. SIGN-UP CHECKS (one code per problem)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.auth_check_signup(p_email TEXT, p_username TEXT, p_full_name TEXT, p_company TEXT,
                                         p_role TEXT, p_branch_location TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE
    v_email TEXT := lower(btrim(coalesce(p_email, '')));
    v_user  TEXT := btrim(coalesce(p_username, ''));
    v_name  TEXT := btrim(coalesce(p_full_name, ''));
    v_role  TEXT := lower(btrim(coalesce(p_role, '')));
    v_company TEXT;
    v_status TEXT;
BEGIN
    IF v_email = '' OR v_user = '' OR v_name = '' OR btrim(coalesce(p_company, '')) = '' OR v_role = '' THEN
        RETURN jsonb_build_object('code', 'MISSING_FIELDS');
    END IF;
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('code', 'INVALID_EMAIL_FORMAT'); END IF;
    IF length(v_name) < 2 OR v_name !~ '[[:alpha:]]' THEN RETURN jsonb_build_object('code', 'FULL_NAME_INVALID'); END IF;
    IF length(v_user) < 3 THEN RETURN jsonb_build_object('code', 'USERNAME_TOO_SHORT'); END IF;
    IF v_user !~ '^[A-Za-z0-9._-]+$' THEN RETURN jsonb_build_object('code', 'USERNAME_INVALID'); END IF;

    SELECT status INTO v_status FROM public.user_profiles WHERE email = v_email;
    IF v_status = 'pending' THEN RETURN jsonb_build_object('code', 'EMAIL_PENDING_APPROVAL'); END IF;
    IF v_status IS NOT NULL OR EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
        RETURN jsonb_build_object('code', 'EMAIL_ALREADY_REGISTERED');
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE lower(username) = lower(v_user)) THEN
        RETURN jsonb_build_object('code', 'USERNAME_TAKEN');
    END IF;

    v_company := public.resolve_company(p_company);
    IF v_company IS NULL THEN RETURN jsonb_build_object('code', 'COMPANY_NOT_FOUND'); END IF;
    IF v_role NOT IN ('manager', 'staff') THEN RETURN jsonb_build_object('code', 'ROLE_INVALID'); END IF;

    RETURN jsonb_build_object('code', 'OK', 'email', v_email, 'company_id', v_company,
                              'company_name', (SELECT name FROM public.companies WHERE id = v_company));
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. PASSWORD-RESET E-MAIL CHECK
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.auth_check_reset_email(p_email TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE v_email TEXT := lower(btrim(coalesce(p_email, ''))); p public.user_profiles;
BEGIN
    IF v_email = '' THEN RETURN jsonb_build_object('code', 'EMPTY_IDENTIFIER'); END IF;
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('code', 'INVALID_EMAIL_FORMAT'); END IF;
    SELECT * INTO p FROM public.user_profiles WHERE email = v_email;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'EMAIL_NOT_REGISTERED'); END IF;
    IF p.status = 'pending'  THEN RETURN jsonb_build_object('code', 'PENDING_APPROVAL'); END IF;
    IF p.status = 'rejected' THEN RETURN jsonb_build_object('code', 'REJECTED'); END IF;
    IF p.status = 'locked'   THEN RETURN jsonb_build_object('code', 'ACCOUNT_LOCKED'); END IF;
    IF p.status IN ('inactive', 'suspended') THEN RETURN jsonb_build_object('code', upper(p.status)); END IF;
    RETURN jsonb_build_object('code', 'OK');
END;
$$;

-- the sign-up form's company suggestions (names only, nothing else is exposed)
CREATE FUNCTION public.registration_company_names() RETURNS SETOF TEXT
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
    SELECT name FROM public.companies ORDER BY name;
$$;

-- ---------------------------------------------------------------------------
-- ADMIN ACCOUNT ACTIONS (signed-in Admin only)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_find_user(p_identifier TEXT) RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
    SELECT id FROM public.user_profiles
     WHERE id::text = btrim(coalesce(p_identifier, ''))
        OR email = lower(btrim(coalesce(p_identifier, '')))
        OR lower(username) = lower(btrim(coalesce(p_identifier, '')))
     LIMIT 1;
$$;

CREATE FUNCTION public.admin_approve_user(p_identifier TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id UUID := public.admin_find_user(p_identifier); n INT;
BEGIN
    IF NOT public.is_admin_user() THEN RETURN jsonb_build_object('success', false, 'code', 'NOT_ADMIN'); END IF;
    IF v_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'USER_NOT_FOUND'); END IF;
    UPDATE public.user_profiles SET status = 'active', approved_at = now(), approved_by = auth.uid()
     WHERE id = v_id AND (company_id IS NOT NULL OR operational_role = 'admin');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN RETURN jsonb_build_object('success', false, 'code', 'NO_COMPANY'); END IF;
    DELETE FROM public.auth_login_attempts WHERE email = (SELECT email FROM public.user_profiles WHERE id = v_id);
    RETURN jsonb_build_object('success', true, 'updated_count', n);
END;
$$;

CREATE FUNCTION public.admin_reject_user(p_identifier TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id UUID := public.admin_find_user(p_identifier);
BEGIN
    IF NOT public.is_admin_user() THEN RETURN jsonb_build_object('success', false, 'code', 'NOT_ADMIN'); END IF;
    IF v_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF v_id = auth.uid() THEN RETURN jsonb_build_object('success', false, 'code', 'CANNOT_CHANGE_SELF'); END IF;
    UPDATE public.user_profiles SET status = 'rejected' WHERE id = v_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE FUNCTION public.admin_set_user_status(p_identifier TEXT, p_status TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id UUID := public.admin_find_user(p_identifier); v_status TEXT := lower(btrim(coalesce(p_status, '')));
BEGIN
    IF NOT public.is_admin_user() THEN RETURN jsonb_build_object('success', false, 'code', 'NOT_ADMIN'); END IF;
    IF v_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF v_id = auth.uid() THEN RETURN jsonb_build_object('success', false, 'code', 'CANNOT_CHANGE_SELF'); END IF;
    IF v_status NOT IN ('active', 'inactive', 'suspended', 'locked', 'rejected', 'pending') THEN
        RETURN jsonb_build_object('success', false, 'code', 'STATUS_INVALID');
    END IF;
    UPDATE public.user_profiles SET status = v_status WHERE id = v_id;
    IF v_status = 'active' THEN
        DELETE FROM public.auth_login_attempts WHERE email = (SELECT email FROM public.user_profiles WHERE id = v_id);
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE FUNCTION public.admin_unlock_user(p_identifier TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    RETURN public.admin_set_user_status(p_identifier, 'active');
END;
$$;

-- deletes the login itself (Supabase Auth) and its profile
CREATE FUNCTION public.admin_delete_user(p_identifier TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id UUID := public.admin_find_user(p_identifier);
BEGIN
    IF NOT public.is_admin_user() THEN RETURN jsonb_build_object('success', false, 'code', 'NOT_ADMIN'); END IF;
    IF v_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF v_id = auth.uid() OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id AND operational_role = 'admin') THEN
        RETURN jsonb_build_object('success', false, 'code', 'CANNOT_DELETE_ADMIN');
    END IF;
    DELETE FROM public.auth_login_attempts WHERE email = (SELECT email FROM public.user_profiles WHERE id = v_id);
    DELETE FROM auth.users WHERE id = v_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- a Manager / Staff member deletes their own login (the Admin cannot delete itself)
CREATE FUNCTION public.delete_own_account() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'RMIMS_DENIED: not signed in.' USING ERRCODE = '42501'; END IF;
    IF public.is_admin_user() THEN RAISE EXCEPTION 'RMIMS_DENIED: the Admin account cannot delete itself.' USING ERRCODE = '42501'; END IF;
    DELETE FROM auth.users WHERE id = auth.uid();
    RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- WHO MAY CALL WHAT
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
    -- server-only checks: the Edge Function (service role) only
    FOREACH f IN ARRAY ARRAY[
        'auth_setting_int(text,integer)', 'auth_log_event(text,text,text,text,text)',
        'auth_check_rate_limit(text,integer,integer)', 'auth_resolve_identifier(text)', 'auth_check_lockout(text)',
        'auth_check_account_status(text)', 'auth_record_failed_login(text,text)', 'auth_record_successful_login(text,text)',
        'auth_check_signup(text,text,text,text,text,text)', 'auth_check_reset_email(text)', 'admin_find_user(text)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END LOOP;
    -- signed-in users (each function checks the Admin role itself)
    FOREACH f IN ARRAY ARRAY[
        'admin_approve_user(text)', 'admin_reject_user(text)', 'admin_set_user_status(text,text)',
        'admin_unlock_user(text)', 'admin_delete_user(text)', 'delete_own_account()']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
    END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.registration_company_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_company_names() TO anon, authenticated, service_role;
