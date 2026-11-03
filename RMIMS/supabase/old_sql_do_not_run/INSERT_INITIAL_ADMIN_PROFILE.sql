-- ============================================================================
-- RMIMS: ACTIVATE & PROVISION MASTER ADMIN ACCOUNT (Zeanna)
-- ============================================================================
-- Copy and run this in the Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/hgandqozgcpytxebhvtn/sql
-- ============================================================================

DO $$
BEGIN
    -- 1. Update existing row in public.user_profiles to active
    UPDATE public.user_profiles
    SET status = 'active',
        role = 'admin',
        full_name = 'Zeanna'
    WHERE email = 'calusinzeanna3@gmail.com';

    -- 2. If no record was updated, insert the master admin profile
    IF NOT FOUND THEN
        INSERT INTO public.user_profiles (id, email, full_name, username, role, status)
        VALUES (
            (SELECT id FROM auth.users WHERE email = 'calusinzeanna3@gmail.com' LIMIT 1),
            'calusinzeanna3@gmail.com',
            'Zeanna',
            'Zeanna',
            'admin',
            'active'
        )
        ON CONFLICT (id) DO UPDATE SET
            status = 'active',
            role = 'admin',
            full_name = 'Zeanna';
    END IF;

    -- 3. If operational_role column exists, set it to admin
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'user_profiles' 
          AND column_name = 'operational_role'
    ) THEN
        EXECUTE 'UPDATE public.user_profiles SET operational_role = ''admin'' WHERE email = ''calusinzeanna3@gmail.com''';
    END IF;
END $$;

-- 4. Update auth.users metadata to ensure instant active status
UPDATE auth.users
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"status": "active", "role": "admin", "operational_role": "admin", "full_name": "Zeanna"}'::jsonb
WHERE email = 'calusinzeanna3@gmail.com';
