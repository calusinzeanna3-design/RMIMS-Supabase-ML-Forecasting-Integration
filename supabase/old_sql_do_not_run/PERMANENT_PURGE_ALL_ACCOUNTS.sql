-- ============================================================================
-- RMIMS: PERMANENT PURGE OF ALL USER ACCOUNTS (SUPABASE AUTH & PUBLIC SCHEMA)
-- ============================================================================
-- Purpose:
-- Permanently and irreversibly removes ALL user accounts from:
--   1. `auth.users` (Supabase Auth credentials, logins, sessions, and identities)
--   2. `public.user_profiles` (Profile attributes, roles, statuses)
--   3. `public.branch_store_personnel` (Assigned branch managers & staff)
--   4. `public.company_memberships` (Multi-tenant company memberships)
--
-- Instructions:
-- 1. Open your Supabase Project Dashboard (https://supabase.com/dashboard)
-- 2. Select project: hgandqozgcpytxebhvtn
-- 3. Navigate to "SQL Editor" in the left sidebar
-- 4. Click "New query", paste this entire script, and click "Run"
-- ============================================================================

-- Step 1: Temporarily disable replication triggers to allow smooth cascade
SET session_replication_role = 'replica';

-- Step 2: Clear public user-related tables
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'branch_store_personnel') THEN
        EXECUTE 'TRUNCATE TABLE public.branch_store_personnel CASCADE';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles') THEN
        EXECUTE 'TRUNCATE TABLE public.user_profiles CASCADE';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'company_memberships') THEN
        EXECUTE 'TRUNCATE TABLE public.company_memberships CASCADE';
    END IF;
END $$;

-- Step 3: Permanently purge all accounts from Supabase Auth
-- Cascades automatically to auth.identities, auth.sessions, auth.refresh_tokens, auth.mfa_factors
TRUNCATE TABLE auth.users CASCADE;

-- Step 4: Re-enable replication triggers
SET session_replication_role = 'origin';

-- Step 5: Create a reusable Security Definer function to allow programmatic purging in the future
CREATE OR REPLACE FUNCTION public.permanently_purge_all_accounts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    purged_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO purged_count FROM auth.users;

    -- Clean public personnel
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'branch_store_personnel') THEN
        DELETE FROM public.branch_store_personnel;
    END IF;

    -- Clean user profiles
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles') THEN
        DELETE FROM public.user_profiles;
    END IF;

    -- Clean company memberships
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'company_memberships') THEN
        DELETE FROM public.company_memberships;
    END IF;

    -- Delete all auth users
    DELETE FROM auth.users;

    RETURN jsonb_build_object(
        'success', true,
        'purged_users', purged_count,
        'message', 'All user accounts and authentication credentials permanently purged from Supabase.'
    );
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.permanently_purge_all_accounts() TO anon, authenticated, service_role;

-- Verification query
SELECT COUNT(*) AS remaining_auth_users FROM auth.users;
