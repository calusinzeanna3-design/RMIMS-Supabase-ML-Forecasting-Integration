-- ============================================================================
-- RMIMS FRESH SETUP — 00  WIPE EVERYTHING (keeps only the Admin login)
-- ============================================================================
-- Run the files in order: 00, 01, 02 ... 11.  Each file is one module of the system.
--
-- THIS FILE PERMANENTLY DELETES:
--   * every RMIMS table and all its rows (materials, receipts, disbursements, finished products,
--     staff submissions, activity logs, notifications, alerts, branch stores, settings, backups history)
--   * every RMIMS database function, trigger, policy and view (old, broken or duplicated versions included)
--   * every login except the Admin (Manager and Staff accounts are removed from Supabase Auth)
-- It KEEPS: the Admin login (its e-mail and password), Supabase itself, and files in Storage.
--
-- Admin accounts kept = every account whose profile in user_profiles is an Admin.
-- (Only if that check finds none: type your Admin e-mail inside v_admin_emails below and run again.)
-- ============================================================================

DO $$
DECLARE
    -- leave empty: Admins are found by their profile role. Only if the file stops with
    -- "No Admin account found", type your Admin e-mail here, e.g. ARRAY['you@example.com']
    v_admin_emails TEXT[] := ARRAY[]::TEXT[];
    r RECORD;
BEGIN
    -- 1. Remember the Admin login(s) before anything is dropped
    DROP TABLE IF EXISTS public._rmims_admin_keep;
    CREATE TABLE public._rmims_admin_keep (id UUID PRIMARY KEY, email TEXT NOT NULL, full_name TEXT);

    INSERT INTO public._rmims_admin_keep (id, email, full_name)
    SELECT u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
      FROM auth.users u
     WHERE lower(u.email) = ANY (SELECT lower(e) FROM unnest(v_admin_emails) e)
    ON CONFLICT (id) DO NOTHING;

    IF to_regclass('public.user_profiles') IS NOT NULL THEN
        EXECUTE $q$
            INSERT INTO public._rmims_admin_keep (id, email, full_name)
            SELECT p.id, p.email, nullif(p.full_name, '')
              FROM public.user_profiles p
              JOIN auth.users u ON u.id = p.id
             WHERE lower(coalesce(p.role, '')) IN ('admin', 'main_admin')
                OR lower(coalesce(p.operational_role, '')) IN ('admin', 'super_admin')
            ON CONFLICT (id) DO NOTHING
        $q$;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public._rmims_admin_keep) THEN
        RAISE EXCEPTION 'No Admin account found to keep. No profile has the Admin role. Type your Admin e-mail in v_admin_emails at the top of this file (it must already exist in Authentication > Users), then run again.';
    END IF;

    -- 2. Drop every RMIMS table (CASCADE also removes their policies, triggers, views and realtime entries)
    FOR r IN
        SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
           AND c.relname <> '_rmims_admin_keep'
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
         ORDER BY c.relkind DESC   -- views first
    LOOP
        IF to_regclass('public.' || quote_ident(r.relname)) IS NULL THEN CONTINUE; END IF;  -- already dropped by CASCADE
        EXECUTE format('DROP %s IF EXISTS public.%I CASCADE',
                       CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
                       r.relname);
    END LOOP;

    -- 3. Drop every RMIMS function in public (extension functions are left alone).
    --    CASCADE also removes triggers that used them, including the old trigger on auth.users.
    FOR r IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
    END LOOP;

    -- 4. Remove every login except the Admin(s)
    DELETE FROM auth.users WHERE id NOT IN (SELECT id FROM public._rmims_admin_keep);
END $$;

-- What is left (should list only your Admin login)
SELECT id, email FROM auth.users ORDER BY email;
