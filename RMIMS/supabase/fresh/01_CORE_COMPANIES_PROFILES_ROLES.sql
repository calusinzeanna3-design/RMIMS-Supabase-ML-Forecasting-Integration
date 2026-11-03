-- ============================================================================
-- RMIMS FRESH SETUP — 01  CORE: companies, user profiles, roles (RBAC helpers)
-- ============================================================================
-- Roles
--   ADMIN    main administrator of the whole system (no company). Approves accounts. Never records stock.
--   MANAGER  runs ONE company: materials, receive, disburse, finished products, approves staff submissions.
--   STAFF    reads ONE company's data and submits receive/disburse for the Manager's approval.
-- Companies are the two the system is built for (the app and the sign-up form use exactly these).
-- No other data is created: every material, record and account comes from the users.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- COMPANIES (registry the sign-up form validates against)
-- ---------------------------------------------------------------------------
CREATE TABLE public.companies (
    id           TEXT PRIMARY KEY,
    company_code TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL UNIQUE,
    sku_prefix   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.companies (id, company_code, name, sku_prefix) VALUES
    ('1872cf44-e821-4370-b227-d1b7e4fc6f56', 'SCONES_MUFFINS', 'Scones & Muffins Bakery', 'NB-'),
    ('a72a7971-6ec7-4edc-ae72-89d702199ed9', 'KXC',            'KXC 5-Year Enterprise',   'RM-');

-- ---------------------------------------------------------------------------
-- USER PROFILES (one per Supabase Auth login)
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_profiles (
    id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email             TEXT NOT NULL UNIQUE,      -- stored lower-case (trigger below)
    full_name         TEXT,
    username          TEXT,
    role              TEXT NOT NULL DEFAULT 'user'  CHECK (role IN ('admin', 'user')),
    operational_role  TEXT NOT NULL DEFAULT 'staff' CHECK (operational_role IN ('admin', 'manager', 'staff')),
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'active', 'inactive', 'suspended', 'locked', 'rejected')),
    company_id        TEXT REFERENCES public.companies(id),
    company_name      TEXT,
    dataset_folder    TEXT,
    branch_name       TEXT,
    branch_location   TEXT,
    branch_store      TEXT,
    avatar_url        TEXT,
    onboarding_status TEXT NOT NULL DEFAULT 'pending' CHECK (onboarding_status IN ('pending', 'completed', 'skipped')),
    approved_at       TIMESTAMPTZ,
    approved_by       UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_user_profiles_username ON public.user_profiles (lower(username)) WHERE coalesce(username, '') <> '';
CREATE INDEX idx_user_profiles_company        ON public.user_profiles (company_id);
CREATE INDEX idx_user_profiles_status         ON public.user_profiles (status);

-- ---------------------------------------------------------------------------
-- ROLE HELPERS (used by every policy in every module)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.is_active_user() RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND status = 'active');
$$;

CREATE FUNCTION public.is_admin_user() RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_profiles
                    WHERE id = auth.uid() AND status = 'active' AND (role = 'admin' OR operational_role = 'admin'));
$$;

CREATE FUNCTION public.is_super_admin() RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
    SELECT public.is_admin_user();
$$;

CREATE FUNCTION public.is_manager_user() RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_profiles
                    WHERE id = auth.uid() AND status = 'active' AND operational_role = 'manager' AND company_id IS NOT NULL);
$$;

CREATE FUNCTION public.is_staff_user() RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_profiles
                    WHERE id = auth.uid() AND status = 'active' AND operational_role = 'staff' AND company_id IS NOT NULL);
$$;

-- NULL when the user has no company -> matches no rows (fail-closed)
CREATE FUNCTION public.get_current_user_company_id() RETURNS TEXT
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
    SELECT company_id FROM public.user_profiles WHERE id = auth.uid() AND status = 'active';
$$;

-- Company id from an id or a company name typed in the sign-up form (only the registered companies)
CREATE FUNCTION public.resolve_company(p TEXT) RETURNS TEXT
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
    SELECT c.id FROM public.companies c
     WHERE c.id = btrim(coalesce(p, ''))
        OR lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]+', '', 'g'))
     LIMIT 1;
$$;

-- TRUE when the request comes from the server (the Edge Function's service key), never from a browser
CREATE FUNCTION public.request_is_service_role() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role';
$$;

CREATE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- PROFILE GUARDS
-- ---------------------------------------------------------------------------
-- Company + company name are always consistent; admins never belong to a company.
CREATE FUNCTION public.profile_normalize() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    NEW.email := lower(btrim(NEW.email));
    NEW.username := nullif(btrim(coalesce(NEW.username, '')), '');
    IF NEW.role = 'admin' OR NEW.operational_role = 'admin' THEN
        NEW.role := 'admin';
        NEW.operational_role := 'admin';
        NEW.company_id := NULL;
        NEW.company_name := NULL;
        NEW.dataset_folder := NULL;
    ELSE
        NEW.role := 'user';
        NEW.company_id := public.resolve_company(coalesce(NEW.company_id, NEW.company_name));
        SELECT name INTO NEW.company_name FROM public.companies WHERE id = NEW.company_id;
        NEW.dataset_folder := NEW.company_id;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_profiles_normalize
BEFORE INSERT OR UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.profile_normalize();

-- Nobody but the Admin can change role, status or company (no self-approval, no self-promotion).
CREATE FUNCTION public.profile_block_self_elevation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() AND NOT public.request_is_service_role() THEN
        IF NEW.role IS DISTINCT FROM OLD.role
           OR NEW.operational_role IS DISTINCT FROM OLD.operational_role
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.company_id IS DISTINCT FROM OLD.company_id
           OR NEW.email IS DISTINCT FROM OLD.email
           OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
            RAISE EXCEPTION 'RMIMS_DENIED: only the Admin can change role, status, company or e-mail.' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_profiles_block_self_elevation
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.profile_block_self_elevation();

-- Every new login gets a PENDING profile (Manager / Staff only) from what the user typed at sign-up.
CREATE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    m JSONB := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
    v_role TEXT := lower(coalesce(m->>'operational_role', 'staff'));
BEGIN
    IF v_role NOT IN ('manager', 'staff') THEN v_role := 'staff'; END IF;
    INSERT INTO public.user_profiles (id, email, full_name, username, role, operational_role, status,
                                      company_id, company_name, branch_name, branch_location, branch_store)
    VALUES (NEW.id, NEW.email, nullif(btrim(m->>'full_name'), ''), nullif(btrim(m->>'username'), ''), 'user', v_role, 'pending',
            coalesce(m->>'company_id', m->>'company_name'), m->>'company_name',
            nullif(btrim(m->>'branch_name'), ''), nullif(btrim(m->>'branch_location'), ''), nullif(btrim(m->>'branch_store'), ''))
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RESTORE THE ADMIN PROFILE(S) kept by file 00
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public._rmims_admin_keep') IS NOT NULL THEN
        EXECUTE $q$
            INSERT INTO public.user_profiles (id, email, full_name, username, role, operational_role, status, approved_at)
            SELECT k.id, k.email, k.full_name, split_part(k.email, '@', 1), 'admin', 'admin', 'active', now()
              FROM public._rmims_admin_keep k
             WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = k.id)
            ON CONFLICT (id) DO UPDATE SET role = 'admin', operational_role = 'admin', status = 'active'
        $q$;
        DROP TABLE public._rmims_admin_keep;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_read ON public.companies FOR SELECT TO authenticated
    USING (public.is_admin_user() OR id = public.get_current_user_company_id());
CREATE POLICY companies_admin_write ON public.companies FOR ALL TO authenticated
    USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

-- own profile always; same-company profiles for active users; everything for the Admin
CREATE POLICY profiles_read ON public.user_profiles FOR SELECT TO authenticated
    USING (id = auth.uid() OR public.is_admin_user()
           OR (company_id IS NOT NULL AND company_id = public.get_current_user_company_id()));
-- own name / avatar / branch details (role, status, company guarded by the trigger above)
CREATE POLICY profiles_update_own ON public.user_profiles FOR UPDATE TO authenticated
    USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY profiles_admin_all ON public.user_profiles FOR ALL TO authenticated
    USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());
-- profiles are created only by the sign-up trigger (no client inserts)

REVOKE ALL ON public.companies, public.user_profiles FROM anon;
GRANT SELECT ON public.companies TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT ALL ON public.companies, public.user_profiles TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user(), public.is_admin_user(), public.is_super_admin(),
                          public.is_manager_user(), public.is_staff_user(), public.get_current_user_company_id()
    TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_company(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_company(TEXT) TO authenticated, service_role;

SELECT email, role, operational_role, status FROM public.user_profiles;
