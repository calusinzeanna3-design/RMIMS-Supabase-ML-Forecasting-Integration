-- ============================================================
-- RMIMS — SECURITY HARDENING MIGRATION
-- ============================================================
-- Fixes Critical Vulnerabilities:
--   1. Vertical Privilege Escalation (Self-Promotion via RLS)
--   2. Direct Admin Account Creation during Self-Registration
--
-- Instructions:
--   Run this entire file once in the Supabase SQL Editor.
--   It is safe and idempotent (can be re-run without errors).
-- ============================================================

-- Ensure the is_active_admin helper function exists and is current
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
          AND role = 'admin'
          AND status = 'active'
    );
$$;

-- ------------------------------------------------------------
-- 1. TRIGGER: Enforce Safe Self-Registration on INSERT
-- ------------------------------------------------------------
-- Blocks any caller from directly inserting an active or admin
-- account via PostgREST / client API unless they are an active admin.
CREATE OR REPLACE FUNCTION public.protect_user_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- For requests originating from an authenticated client (PostgREST API):
    -- Non-admin callers can only insert with role='user' and status='inactive'.
    IF auth.uid() IS NOT NULL AND NOT public.is_active_admin() THEN
        IF NEW.role <> 'user' OR NEW.status <> 'inactive' THEN
            RAISE EXCEPTION 'Access Denied: Self-registered accounts must have role "user" and status "inactive".';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_insert ON public.users;
CREATE TRIGGER trg_protect_user_insert
    BEFORE INSERT ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.protect_user_insert();

COMMENT ON FUNCTION public.protect_user_insert IS 'Guards public.users INSERT against unauthorized admin or active status creation.';

-- ------------------------------------------------------------
-- 2. TRIGGER: Prevent Self-Promotion on UPDATE
-- ------------------------------------------------------------
-- Blocks any non-admin from modifying 'role' or 'status' on an
-- existing user row, closing the RLS self-promotion exploit.
CREATE OR REPLACE FUNCTION public.protect_user_roles_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Check if either 'role' or 'status' is being changed
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status) THEN
        -- If the update is from an authenticated API caller who is NOT an active admin, reject
        IF auth.uid() IS NOT NULL AND NOT public.is_active_admin() THEN
            RAISE EXCEPTION 'Access Denied: Only active administrators can modify account role or status.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_roles_update ON public.users;
CREATE TRIGGER trg_protect_user_roles_update
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.protect_user_roles_update();

COMMENT ON FUNCTION public.protect_user_roles_update IS 'Guards public.users UPDATE: only active admins may change role or status.';

-- ------------------------------------------------------------
-- 3. HARDENED ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------

-- A. Lock down INSERT: Self-service registration must be inactive 'user'
DROP POLICY IF EXISTS "users_insert_own" ON public.users;
CREATE POLICY "users_insert_own"
    ON public.users FOR INSERT
    WITH CHECK (
        id = auth.uid()
        AND (
            public.is_active_admin()
            OR (role = 'user' AND status = 'inactive')
        )
    );

-- B. Lock down UPDATE: Admins can update any account; users can only update their own non-admin profile
DROP POLICY IF EXISTS "users_update_own_or_admin" ON public.users;
CREATE POLICY "users_update_own_or_admin"
    ON public.users FOR UPDATE
    USING (id = auth.uid() OR public.is_active_admin())
    WITH CHECK (
        public.is_active_admin()
        OR (id = auth.uid() AND role = 'user')
    );

-- Log completion confirmation
DO $$
BEGIN
    RAISE NOTICE 'RMIMS Security Hardening Migration applied successfully.';
END;
$$;
