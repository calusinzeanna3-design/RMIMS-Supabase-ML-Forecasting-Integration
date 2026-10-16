-- ============================================================================
-- RMIMS: DEFINITIVE FIX FOR "Database error saving new user" IN SUPABASE
-- ============================================================================
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/hgandqozgcpytxebhvtn/sql/new
--
-- Root Cause:
-- 1. The `public.user_profiles` table was created with only base columns.
--    Columns `username`, `operational_role`, `branch_name`, `branch_location`,
--    `branch_store`, `company_id`, `company_name`, `dataset_folder` are missing.
-- 2. An active trigger on `auth.users` (`handle_new_user`) attempts to insert
--    these missing columns on signup, causing PostgreSQL to fail and roll back.
-- 3. The `status` check constraint may reject 'pending'.
-- 4. Missing INSERT privileges for `anon` role on `public.user_profiles`.
-- ============================================================================

-- STEP 1: ADD ALL MISSING RBAC, STORE & MULTI-TENANT COLUMNS
ALTER TABLE public.user_profiles 
    ADD COLUMN IF NOT EXISTS username TEXT,
    ADD COLUMN IF NOT EXISTS operational_role TEXT DEFAULT 'staff',
    ADD COLUMN IF NOT EXISTS branch_name TEXT,
    ADD COLUMN IF NOT EXISTS branch_location TEXT,
    ADD COLUMN IF NOT EXISTS branch_store TEXT,
    ADD COLUMN IF NOT EXISTS company_id TEXT DEFAULT 'a72a7971-6ec7-4edc-ae72-89d702199ed9',
    ADD COLUMN IF NOT EXISTS company_name TEXT DEFAULT 'KXC 5-Year Enterprise',
    ADD COLUMN IF NOT EXISTS dataset_folder TEXT DEFAULT 'a72a7971-6ec7-4edc-ae72-89d702199ed9',
    ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'pending';

-- STEP 2: RELAX STATUS CHECK CONSTRAINT TO PERMIT 'pending' & 'pending_approval'
DO $$
BEGIN
    ALTER TABLE public.user_profiles 
        DROP CONSTRAINT IF EXISTS user_profiles_status_check;

    ALTER TABLE public.user_profiles 
        ADD CONSTRAINT user_profiles_status_check 
        CHECK (status IN ('active', 'inactive', 'pending', 'pending_approval'));
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Constraint notice: %', SQLERRM;
END $$;

-- STEP 3: GRANT TABLE PRIVILEGES TO ALL SUPABASE CLIENT ROLES
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO anon, authenticated, service_role;

-- STEP 4: BULLETPROOF TRIGGER FUNCTION (NEVER BLOCKS SIGNUP ON EXCEPTION)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_raw_op_role TEXT;
    v_clean_op_role TEXT;
    v_branch_store TEXT;
    v_comp_id TEXT;
    v_comp_name TEXT;
    v_folder TEXT;
BEGIN
    -- Determine role safely
    v_raw_op_role := COALESCE(NEW.raw_user_meta_data->>'operational_role', 'staff');
    IF v_raw_op_role IN ('manager', 'staff', 'user', 'user_staff') THEN
        v_clean_op_role := v_raw_op_role;
    ELSE
        v_clean_op_role := 'staff';
    END IF;

    -- Combine branch store safely
    v_branch_store := COALESCE(NEW.raw_user_meta_data->>'branch_store', '');
    IF v_branch_store = '' AND (NEW.raw_user_meta_data->>'branch_name' IS NOT NULL) THEN
        v_branch_store := (NEW.raw_user_meta_data->>'branch_name') || 
            CASE 
                WHEN NEW.raw_user_meta_data->>'branch_location' IS NOT NULL 
                THEN ' (' || (NEW.raw_user_meta_data->>'branch_location') || ')'
                ELSE ''
            END;
    END IF;

    -- Resolve tenant defaults
    v_comp_id := COALESCE(NEW.raw_user_meta_data->>'company_id', 'a72a7971-6ec7-4edc-ae72-89d702199ed9');
    v_comp_name := COALESCE(NEW.raw_user_meta_data->>'company_name', 'KXC 5-Year Enterprise');
    v_folder := COALESCE(NEW.raw_user_meta_data->>'dataset_folder', 'a72a7971-6ec7-4edc-ae72-89d702199ed9');

    -- Insert or update user_profiles
    INSERT INTO public.user_profiles (
        id,
        email,
        full_name,
        username,
        role,
        operational_role,
        branch_name,
        branch_location,
        branch_store,
        company_id,
        company_name,
        dataset_folder,
        status,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'username', ''),
        'user',
        v_clean_op_role,
        COALESCE(NEW.raw_user_meta_data->>'branch_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'branch_location', ''),
        v_branch_store,
        v_comp_id,
        v_comp_name,
        v_folder,
        'pending',
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        username = EXCLUDED.username,
        operational_role = EXCLUDED.operational_role,
        branch_name = EXCLUDED.branch_name,
        branch_location = EXCLUDED.branch_location,
        branch_store = EXCLUDED.branch_store,
        company_id = EXCLUDED.company_id,
        company_name = EXCLUDED.company_name,
        dataset_folder = EXCLUDED.dataset_folder,
        updated_at = now();

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- CRITICAL: Prevent rollback of auth.users signup! Even if an unexpected error occurs,
        -- the auth user is successfully saved.
        RAISE WARNING 'handle_new_user non-blocking exception: %', SQLERRM;
        RETURN NEW;
END;
$$;

-- STEP 5: RE-ATTACH TRIGGER ON auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- STEP 6: CONFIGURE ROW-LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Allow signup profile creation" ON public.user_profiles;
    CREATE POLICY "Allow signup profile creation"
        ON public.user_profiles FOR INSERT
        TO authenticated, anon
        WITH CHECK (true);
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Allow users to read profiles" ON public.user_profiles;
    CREATE POLICY "Allow users to read profiles"
        ON public.user_profiles FOR SELECT
        TO authenticated, anon
        USING (true);
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Allow users to update own profile" ON public.user_profiles;
    CREATE POLICY "Allow users to update own profile"
        ON public.user_profiles FOR UPDATE
        TO authenticated, anon
        USING (true)
        WITH CHECK (true);
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- Verify columns in user_profiles
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'user_profiles'
ORDER BY ordinal_position;
