-- ============================================================================
-- RMIMS — Company names for the Create Account form (ghost-text completion)
-- ============================================================================
-- Run once in the Supabase SQL editor (safe to re-run).
--
-- The sign-up page is not signed in yet, so it cannot read public.companies (RLS). This function returns ONLY
-- the names of the two companies that accept registrations, and nothing else from the table.
-- The page validates typed names against this list; anything else is refused with
-- "This company doesn't exist in the system. Please coordinate with the system admin / operator."
-- If this function is not deployed, the page falls back to the same two names.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registration_company_names()
RETURNS SETOF TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT DISTINCT allowed.name
      FROM (VALUES ('Scones & Muffins Bakery'), ('KXC 5-Year Enterprise')) AS allowed(name)
     WHERE EXISTS (
            SELECT 1 FROM public.companies c
             WHERE lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '', 'g'))
                 = lower(regexp_replace(allowed.name, '[^a-zA-Z0-9]+', '', 'g'))
           )
        OR NOT EXISTS (SELECT 1 FROM public.companies)
     ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.registration_company_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_company_names() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
