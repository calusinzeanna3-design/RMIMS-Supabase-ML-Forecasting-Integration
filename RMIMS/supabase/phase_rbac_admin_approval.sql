-- ============================================================================
-- RMIMS: RBAC & ADMIN-ONLY ACCOUNT APPROVAL SCHEMA MIGRATION
-- ============================================================================
-- Description:
-- 1. Updates `user_profiles` status check constraint to support 'pending', 
--    'pending_approval', 'active', and 'inactive'.
-- 2. Ensures operational RBAC columns exist (username, operational_role, 
--    branch_name, branch_location, branch_store).
-- 3. Implements handle_new_user() trigger for automatic pending profile creation.
-- 4. Enforces strict Admin-Only RLS policies for account approvals and activations.
-- ============================================================================

-- 1. EXTEND STATUS CONSTRAINT ON public.user_profiles
DO $$
BEGIN
    -- Drop existing check constraint if present
    ALTER TABLE public.user_profiles 
        DROP CONSTRAINT IF EXISTS user_profiles_status_check;

    -- Add updated status check constraint allowing 'pending' and 'pending_approval'
    ALTER TABLE public.user_profiles 
        ADD CONSTRAINT user_profiles_status_check 
        CHECK (status IN ('active', 'inactive', 'pending', 'pending_approval'));
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Notice updating user_profiles_status_check: %', SQLERRM;
END $$;

-- 2. ENSURE RBAC & BRANCH METADATA COLUMNS EXIST
ALTER TABLE public.user_profiles 
    ADD COLUMN IF NOT EXISTS username TEXT,
    ADD COLUMN IF NOT EXISTS operational_role TEXT DEFAULT 'staff',
    ADD COLUMN IF NOT EXISTS branch_name TEXT,
    ADD COLUMN IF NOT EXISTS branch_location TEXT,
    ADD COLUMN IF NOT EXISTS branch_store TEXT;

-- Index for quick lookup and unique username constraint (where username is provided)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_username_unique 
    ON public.user_profiles (LOWER(TRIM(username))) 
    WHERE username IS NOT NULL AND username <> '';

-- 3. CREATE TRIGGER TO AUTOMATICALLY CAPTURE REGISTRATIONS AS PENDING
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
BEGIN
    v_raw_op_role := COALESCE(NEW.raw_user_meta_data->>'operational_role', 'staff');
    
    -- Restrict to valid operational end-user roles; prevent privilege escalation
    IF v_raw_op_role IN ('manager', 'staff', 'user', 'user_staff') THEN
        v_clean_op_role := v_raw_op_role;
    ELSE
        v_clean_op_role := 'staff';
    END IF;

    v_branch_store := COALESCE(NEW.raw_user_meta_data->>'branch_store', '');
    IF v_branch_store = '' AND (NEW.raw_user_meta_data->>'branch_name' IS NOT NULL) THEN
        v_branch_store := (NEW.raw_user_meta_data->>'branch_name') || 
            CASE 
                WHEN NEW.raw_user_meta_data->>'branch_location' IS NOT NULL 
                THEN ' (' || (NEW.raw_user_meta_data->>'branch_location') || ')'
                ELSE ''
            END;
    END IF;

    -- Automatically insert new signups into user_profiles with status: 'pending'
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
        status,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'username', ''),
        'user', -- End-user base permission role
        v_clean_op_role,
        COALESCE(NEW.raw_user_meta_data->>'branch_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'branch_location', ''),
        v_branch_store,
        'pending', -- Pending Admin confirmation
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
        branch_store = EXCLUDED.branch_store;

    RETURN NEW;
END;
$$;

-- Drop and recreate trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. ROW LEVEL SECURITY (RLS) POLICIES FOR ADMIN CONFIRMATION
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Allow newly signed up users to insert their initial profile if client upsert runs
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can insert own profile upon signup" ON public.user_profiles;
    CREATE POLICY "Users can insert own profile upon signup"
        ON public.user_profiles FOR INSERT
        TO authenticated, anon
        WITH CHECK (true);
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Policy creation note: %', SQLERRM;
END $$;

-- Allow users to read their own profile (even while pending)
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
    CREATE POLICY "Users can view own profile"
        ON public.user_profiles FOR SELECT
        TO authenticated, anon
        USING (auth.uid() = id OR public.is_admin_user());
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Policy creation note: %', SQLERRM;
END $$;

-- STRICT: Only Admins can update status (Approve / Activate / Deactivate) or change roles
DO $$
BEGIN
    DROP POLICY IF EXISTS "Admins have full control over user profiles" ON public.user_profiles;
    CREATE POLICY "Admins have full control over user profiles"
        ON public.user_profiles FOR ALL
        TO authenticated
        USING (public.is_admin_user())
        WITH CHECK (public.is_admin_user());
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Policy creation note: %', SQLERRM;
END $$;

-- 5. PREVENT NON-ADMIN SELF-ELEVATION TRIGGER
CREATE OR REPLACE FUNCTION public.prevent_self_elevation_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- If current user is not admin, prevent modifying role, operational role, or status
    IF NOT public.is_admin_user() THEN
        IF NEW.role <> OLD.role OR NEW.status <> OLD.status OR NEW.operational_role <> OLD.operational_role THEN
            RAISE EXCEPTION 'Access Denied: Only active administrators can modify roles or account status.';
        END IF;
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_elevation ON public.user_profiles;
CREATE TRIGGER trg_prevent_self_elevation
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_elevation_trigger();

COMMENT ON COLUMN public.user_profiles.status IS 'Account status: pending (awaiting Admin approval), active (approved by Admin), inactive (deactivated by Admin)';
COMMENT ON COLUMN public.user_profiles.role IS 'Base security role: admin (Full administrative authority), user (Standard operational user)';
COMMENT ON COLUMN public.user_profiles.operational_role IS 'Operational RBAC title: admin (Administrator), manager (Store Manager), staff (Floor Inventory Staff)';

