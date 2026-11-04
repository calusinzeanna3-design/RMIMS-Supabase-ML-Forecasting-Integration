-- ============================================================================
-- RMIMS FRESH SETUP — 11  LIVE UPDATES (Realtime) + FINAL CHECK
-- ============================================================================
-- Every module's table is published to Realtime, so a change on one device appears on every other open
-- page (Realtime still applies the security rules above: each user only receives rows they may read).
-- ============================================================================

DO $$
DECLARE t TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
    FOREACH t IN ARRAY ARRAY['user_profiles', 'raw_materials', 'stock_receipts', 'material_disbursements', 'finished_products',
                             'activity_audit_logs', 'admin_activity_logs', 'system_notifications', 'system_maintenance_alerts',
                             'branch_stores', 'branch_store_personnel', 'admin_system_settings', 'system_state']
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- FINAL CHECK (read-only) - every line should say OK
-- ---------------------------------------------------------------------------
SELECT 'tables created' AS check_name,
       CASE WHEN count(*) = 17 THEN 'OK' ELSE 'MISSING ' || (17 - count(*))::text END AS result
  FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
       'companies', 'user_profiles', 'auth_login_attempts', 'auth_rate_limits', 'activity_audit_logs', 'admin_activity_logs',
       'raw_materials', 'stock_receipts', 'material_disbursements', 'finished_products', 'system_notifications',
       'system_maintenance_alerts', 'branch_stores', 'branch_store_personnel', 'admin_system_settings', 'backup_history',
       'system_state')
UNION ALL
SELECT 'row level security on every table',
       CASE WHEN bool_and(c.relrowsecurity) THEN 'OK' ELSE 'OFF on ' || string_agg(c.relname, ', ') FILTER (WHERE NOT c.relrowsecurity) END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
UNION ALL
SELECT 'signed-out visitors blocked',
       CASE WHEN NOT has_table_privilege('anon', 'public.raw_materials', 'SELECT')
             AND NOT has_table_privilege('anon', 'public.user_profiles', 'SELECT') THEN 'OK' ELSE 'OPEN' END
UNION ALL
SELECT 'browser cannot call the sign-in checks',
       CASE WHEN NOT has_function_privilege('anon', 'public.auth_resolve_identifier(text)', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.auth_check_signup(text,text,text,text,text,text)', 'EXECUTE')
            THEN 'OK' ELSE 'EXPOSED' END
UNION ALL
SELECT 'no operational data (fresh)',
       CASE WHEN (SELECT count(*) FROM public.raw_materials) + (SELECT count(*) FROM public.stock_receipts)
               + (SELECT count(*) FROM public.material_disbursements) + (SELECT count(*) FROM public.finished_products) = 0
            THEN 'OK' ELSE 'HAS DATA' END
UNION ALL
SELECT 'admin login kept', CASE WHEN EXISTS (SELECT 1 FROM public.user_profiles WHERE operational_role = 'admin' AND status = 'active')
                                THEN 'OK' ELSE 'NO ADMIN' END
UNION ALL
SELECT 'other logins removed', CASE WHEN NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE operational_role <> 'admin')
                                    THEN 'OK' ELSE 'STILL HAS ACCOUNTS' END;
