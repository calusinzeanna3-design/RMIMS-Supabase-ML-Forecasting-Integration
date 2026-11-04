-- ============================================================================
-- RMIMS — 15  FIX: finished products not saving / disappearing after refresh
-- ============================================================================
-- Safe to run more than once (only CREATE OR REPLACE, no data is deleted). Run AFTER 01-14.
--
-- 1. save_finished_product now says exactly WHY it refuses (not signed in / account not active /
--    not a Manager / no company), and the app shows that message to the Manager.
-- 2. Linking the existing receipt / disbursement records to the new product runs after the save and can
--    never cancel it: if linking hits a problem the product is still saved (a WARNING is logged instead).
-- 3. The last SELECT lists every Manager account and whether the database accepts it as a Manager.
--    Every row should say OK. If not, fix that account in Table Editor -> user_profiles.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_rmims_fp_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    BEGIN
        PERFORM public.rmims_sync_finished_products(coalesce(NEW.company_id, OLD.company_id));
    EXCEPTION WHEN others THEN
        RAISE WARNING 'RMIMS: finished product saved, record linking skipped: %', SQLERRM;
    END;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_finished_product(
    p_name           TEXT,
    p_material_names JSONB   DEFAULT '[]'::jsonb,
    p_recipe_details JSONB   DEFAULT '{}'::jsonb,
    p_category       TEXT    DEFAULT NULL,
    p_batch_units    NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid     UUID := auth.uid();
    v_prof    public.user_profiles;
    v_company TEXT;
    v_name    TEXT := btrim(coalesce(p_name, ''));
    v_id      UUID;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not signed in to the database (session expired). Sign out and sign in again.');
    END IF;
    SELECT * INTO v_prof FROM public.user_profiles WHERE id = v_uid;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'This login has no row in user_profiles.');
    END IF;
    IF v_prof.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This account is "' || v_prof.status || '", not active. The Admin must approve it.');
    END IF;
    IF NOT (public.is_manager_user() OR public.is_super_admin()) THEN
        RETURN jsonb_build_object('success', false, 'error',
            'Only the Manager can save a finished product. This account''s operational_role is "' || coalesce(v_prof.operational_role, '') ||
            '"' || CASE WHEN v_prof.company_id IS NULL THEN ' and it has no company_id' ELSE '' END || '.');
    END IF;
    v_company := public.get_current_user_company_id();
    IF v_company IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This account has no company_id in user_profiles.');
    END IF;
    IF v_name = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Finished product name is missing.');
    END IF;

    INSERT INTO public.finished_products (company_id, name, name_key, material_names, recipe_details, category, batch_units, deleted_at)
    VALUES (v_company, v_name, lower(v_name),
            CASE WHEN jsonb_typeof(p_material_names) = 'array' THEN p_material_names ELSE '[]'::jsonb END,
            CASE WHEN jsonb_typeof(p_recipe_details) = 'object' THEN p_recipe_details ELSE '{}'::jsonb END,
            p_category, p_batch_units, NULL)
    ON CONFLICT (company_id, name_key) DO UPDATE
       SET name = EXCLUDED.name,
           material_names = EXCLUDED.material_names,
           recipe_details = EXCLUDED.recipe_details,
           category = EXCLUDED.category,
           batch_units = EXCLUDED.batch_units,
           deleted_at = NULL
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.save_finished_product(TEXT, JSONB, JSONB, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_finished_product(TEXT, JSONB, JSONB, TEXT, NUMERIC) TO authenticated;

-- Check: every Manager account should say OK
SELECT email, operational_role, status, company_id,
       CASE
           WHEN status <> 'active'             THEN 'NOT OK: status must be active'
           WHEN operational_role <> 'manager'  THEN 'NOT OK: operational_role must be manager'
           WHEN company_id IS NULL             THEN 'NOT OK: company_id is empty'
           ELSE 'OK'
       END AS can_save_finished_products
  FROM public.user_profiles
 WHERE operational_role = 'manager' OR role <> 'admin'
 ORDER BY can_save_finished_products DESC, email;
