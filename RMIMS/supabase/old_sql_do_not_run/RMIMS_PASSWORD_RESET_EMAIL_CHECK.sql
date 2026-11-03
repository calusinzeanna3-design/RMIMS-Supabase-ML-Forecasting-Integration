-- ============================================================================
-- RMIMS: password reset is allowed ONLY for accounts the Main Admin approved.
-- Run ONCE in Supabase > SQL Editor (safe to re-run; replaces the earlier version).
-- Returns 'active' (approved by admin), 'pending' (waiting for approval) or 'none'.
-- ============================================================================
DROP FUNCTION IF EXISTS public.rmims_email_registered(text);

CREATE OR REPLACE FUNCTION public.rmims_email_registered(p_email text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT CASE
                    WHEN lower(coalesce(status, '')) IN ('active', 'approved') THEN 'active'
                    WHEN lower(coalesce(status, '')) IN ('pending', 'pending_approval') THEN 'pending'
                    ELSE 'none'
                END
         FROM public.user_profiles
         WHERE lower(email) = lower(btrim(p_email))
         ORDER BY (lower(coalesce(status, '')) IN ('active', 'approved')) DESC
         LIMIT 1),
        'none');
$$;

REVOKE ALL ON FUNCTION public.rmims_email_registered(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rmims_email_registered(text) TO anon, authenticated;
