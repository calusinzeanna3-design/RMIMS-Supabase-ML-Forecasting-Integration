-- ============================================================================
-- RMIMS FRESH SETUP — 13  IMPORT: raw materials from a file (My Inventory -> Import)
-- ============================================================================
-- Same columns as the system's import template:
--     Date, Raw Material Name, Current Stock, Unit, Minimum Stock      (+ optional Item Code)
-- Every row is a stock count on that date. For each raw material:
--   * the material is created (new item code with the company prefix, e.g. NB-020) or, if the name / code
--     already exists in the company, updated - never duplicated
--   * the first count and every later INCREASE are saved as deliveries (Receive), dated with the row's date
--   * a lower count is NOT turned into a disbursement (nobody recorded one, so none is invented)
--   * current stock = the latest count (a file older than the material's latest count does not change it)
-- Importing the same file twice does nothing the second time (each row has its own import reference).
--
-- Two ways to use it:
--   A. From the system (signed-in Manager):  SELECT public.import_raw_materials('[{...}, ...]'::jsonb);
--   B. In Supabase: Table Editor -> raw_materials_import -> Insert -> Import data from CSV (the template file),
--      then in the SQL Editor:  SELECT public.import_raw_materials_from_staging('Scones & Muffins Bakery');
-- ============================================================================

-- staging table for a CSV upload in the Table Editor (column names = the template headers)
DROP TABLE IF EXISTS public.raw_materials_import CASCADE;
CREATE TABLE public.raw_materials_import (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "Date"              TEXT,
    "Raw Material Name" TEXT,
    "Current Stock"     TEXT,
    "Unit"              TEXT,
    "Minimum Stock"     TEXT,
    "Item Code"         TEXT
);
ALTER TABLE public.raw_materials_import ENABLE ROW LEVEL SECURITY;   -- no policies: SQL Editor / service only
REVOKE ALL ON public.raw_materials_import FROM anon, authenticated;
GRANT ALL ON public.raw_materials_import TO service_role;

-- ---------------------------------------------------------------------------
-- the import itself (shared by A and B)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rmims_import_rows(TEXT, JSONB, UUID);
CREATE FUNCTION public.rmims_import_rows(p_company TEXT, p_rows JSONB, p_user UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_prefix   TEXT;
    v_errors   JSONB := '[]'::jsonb;
    v_created  INT := 0;
    v_updated  INT := 0;
    v_receipts INT := 0;
    v_skipped  INT := 0;
    r          RECORD;
    g          RECORD;
    v_mat      public.raw_materials;
    v_code     TEXT;
    v_prev     NUMERIC;
    v_delta    NUMERIC;
    v_ref      TEXT;
    v_n        INT;
BEGIN
    IF p_company IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company) THEN
        RAISE EXCEPTION 'RMIMS_INVALID: company not found.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
        RAISE EXCEPTION 'RMIMS_INVALID: the file has no rows.' USING ERRCODE = '22023';
    END IF;
    SELECT upper(btrim(coalesce(sku_prefix, ''))) INTO v_prefix FROM public.companies WHERE id = p_company;

    -- 1. read + validate every row (accepts the template headers or snake_case keys)
    CREATE TEMP TABLE _imp (
        row_no INT, row_date DATE, name TEXT, stock NUMERIC, unit TEXT, min_stock NUMERIC, item_code TEXT
    ) ON COMMIT DROP;

    FOR r IN SELECT e.value AS j, e.ordinality::int AS n FROM jsonb_array_elements(p_rows) WITH ORDINALITY e LOOP
        DECLARE
            d   TEXT := btrim(coalesce(r.j->>'Date', r.j->>'date', ''));
            nm  TEXT := btrim(coalesce(r.j->>'Raw Material Name', r.j->>'raw_material_name', r.j->>'name', ''));
            st  TEXT := btrim(coalesce(r.j->>'Current Stock', r.j->>'current_stock', ''));
            un  TEXT := btrim(coalesce(r.j->>'Unit', r.j->>'unit', ''));
            mn  TEXT := btrim(coalesce(r.j->>'Minimum Stock', r.j->>'minimum_stock', ''));
            cd  TEXT := upper(btrim(coalesce(r.j->>'Item Code', r.j->>'item_code', '')));
            v_date DATE; v_stock NUMERIC; v_min NUMERIC;
        BEGIN
            IF nm = '' AND d = '' AND st = '' THEN CONTINUE; END IF;   -- blank line
            IF nm = '' THEN v_errors := v_errors || jsonb_build_object('row', r.n, 'error', 'Raw Material Name is missing'); CONTINUE; END IF;
            IF un = '' THEN v_errors := v_errors || jsonb_build_object('row', r.n, 'error', format('Unit is missing for %s', nm)); CONTINUE; END IF;
            BEGIN v_date := d::date; EXCEPTION WHEN others THEN v_date := NULL; END;
            IF v_date IS NULL OR v_date > CURRENT_DATE + 1 THEN
                v_errors := v_errors || jsonb_build_object('row', r.n, 'error', format('Date "%s" is not a valid date (use YYYY-MM-DD)', d)); CONTINUE;
            END IF;
            v_stock := public.rmims_fp_num(st);
            IF st = '' OR v_stock IS NULL OR st ~ '^\s*-' THEN
                v_errors := v_errors || jsonb_build_object('row', r.n, 'error', format('Current Stock "%s" must be a number 0 or more', st)); CONTINUE;
            END IF;
            v_min := CASE WHEN mn = '' THEN NULL ELSE public.rmims_fp_num(mn) END;
            IF mn <> '' AND (v_min IS NULL OR mn ~ '^\s*-') THEN
                v_errors := v_errors || jsonb_build_object('row', r.n, 'error', format('Minimum Stock "%s" must be a number 0 or more', mn)); CONTINUE;
            END IF;
            IF cd <> '' AND v_prefix <> '' AND cd NOT LIKE v_prefix || '%' THEN
                v_errors := v_errors || jsonb_build_object('row', r.n, 'error', format('Item Code %s must start with %s', cd, v_prefix)); CONTINUE;
            END IF;
            INSERT INTO _imp VALUES (r.n, v_date, nm, v_stock, un, v_min, nullif(cd, ''));
        END;
    END LOOP;

    -- 2. one material at a time, its counts in date order
    FOR g IN SELECT lower(name) AS key, min(row_no) AS first_row FROM _imp GROUP BY lower(name) ORDER BY min(row_no) LOOP
        -- existing material: same code, or same name in this company
        SELECT m.* INTO v_mat FROM public.raw_materials m
         WHERE m.company_id = p_company
           AND (lower(btrim(m.name)) = g.key
                OR upper(m.item_code) = (SELECT max(item_code) FROM _imp WHERE lower(name) = g.key))
         LIMIT 1;

        IF v_mat.id IS NULL THEN
            v_code := (SELECT max(item_code) FROM _imp WHERE lower(name) = g.key);
            IF v_code IS NULL THEN
                SELECT v_prefix || lpad((coalesce(max(nullif(regexp_replace(substr(upper(item_code), length(v_prefix) + 1), '[^0-9]', '', 'g'), '')::int), 0) + 1)::text, 3, '0')
                  INTO v_code FROM public.raw_materials WHERE company_id = p_company AND upper(item_code) LIKE v_prefix || '%';
            END IF;
            INSERT INTO public.raw_materials (company_id, item_code, name, unit_of_measure, current_stock, minimum_threshold,
                                              description, first_date, date_added, last_updated, latest_date, created_by)
            SELECT p_company, v_code, i.name, i.unit, 0, i.min_stock, 'Imported from file', i.row_date, i.row_date, now(), i.row_date::timestamptz, p_user
              FROM _imp i WHERE lower(i.name) = g.key ORDER BY i.row_date, i.row_no LIMIT 1
            RETURNING * INTO v_mat;
            v_created := v_created + 1;
        ELSE
            v_updated := v_updated + 1;
        END IF;

        -- 3. deliveries from the counts (first count + increases); same import reference = already imported
        v_prev := NULL; v_n := 0;
        FOR r IN SELECT * FROM _imp WHERE lower(name) = g.key ORDER BY row_date, row_no LOOP
            v_n := v_n + 1;
            v_delta := CASE WHEN v_prev IS NULL THEN r.stock ELSE r.stock - v_prev END;
            v_prev := r.stock;
            IF v_delta > 0 THEN
                v_ref := format('IMP-%s-%s-%s', v_mat.item_code, to_char(r.row_date, 'YYYYMMDD'), v_n);
                IF EXISTS (SELECT 1 FROM public.stock_receipts WHERE company_id = p_company AND reference_no = v_ref) THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    PERFORM set_config('rmims.fp_sync', 'on', true);   -- keeps the importer as the recorder
                    INSERT INTO public.stock_receipts (company_id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by)
                    VALUES (p_company, r.row_date, v_mat.id, v_delta, r.unit, format('Imported from file [Ref: %s]', v_ref), p_user);
                    v_receipts := v_receipts + 1;
                END IF;
            END IF;
        END LOOP;

        -- 4. the latest count is the stock now (an older file never overwrites a newer count)
        UPDATE public.raw_materials m
           SET current_stock     = CASE WHEN last.row_date >= m.latest_date::date THEN last.stock ELSE m.current_stock END,
               minimum_threshold = CASE WHEN last.row_date >= m.latest_date::date THEN coalesce(last.min_stock, m.minimum_threshold) ELSE m.minimum_threshold END,
               unit_of_measure   = last.unit,
               first_date        = least(coalesce(m.first_date, first.row_date), first.row_date),
               date_added        = least(coalesce(m.date_added, first.row_date), first.row_date),
               latest_date       = greatest(m.latest_date, last.row_date::timestamptz),
               last_updated      = now()
          FROM (SELECT * FROM _imp WHERE lower(name) = g.key ORDER BY row_date DESC, row_no DESC LIMIT 1) last,
               (SELECT * FROM _imp WHERE lower(name) = g.key ORDER BY row_date, row_no LIMIT 1) first
         WHERE m.id = v_mat.id;
        v_mat := NULL;
    END LOOP;

    PERFORM set_config('rmims.fp_sync', 'off', true);
    INSERT INTO public.activity_audit_logs (company_id, user_id, action, entity_type, entity_id, details)
    VALUES (p_company, p_user, 'IMPORT_RAW_MATERIALS', 'raw_materials', NULL,
            jsonb_build_object('created', v_created, 'updated', v_updated, 'deliveries', v_receipts,
                               'already_imported', v_skipped, 'rejected_rows', jsonb_array_length(v_errors)));

    RETURN jsonb_build_object('success', true, 'materials_created', v_created, 'materials_updated', v_updated,
                              'deliveries_created', v_receipts, 'rows_already_imported', v_skipped,
                              'rejected_rows', v_errors);
END;
$$;

-- A. from the system: the signed-in Manager imports into their own company
DROP FUNCTION IF EXISTS public.import_raw_materials(JSONB);
CREATE FUNCTION public.import_raw_materials(p_rows JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT public.is_manager_user() THEN
        RAISE EXCEPTION 'RMIMS_DENIED: only the Store Manager can import raw materials.' USING ERRCODE = '42501';
    END IF;
    RETURN public.rmims_import_rows(public.get_current_user_company_id(), p_rows, auth.uid());
END;
$$;

-- B. in Supabase: import what was uploaded to raw_materials_import, then empty it
DROP FUNCTION IF EXISTS public.import_raw_materials_from_staging(TEXT);
CREATE FUNCTION public.import_raw_materials_from_staging(p_company TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows JSONB; v_res JSONB;
BEGIN
    SELECT coalesce(jsonb_agg(to_jsonb(s) - 'id' ORDER BY s.id), '[]'::jsonb) INTO v_rows FROM public.raw_materials_import s;
    v_res := public.rmims_import_rows(public.resolve_company(p_company), v_rows, NULL);
    DELETE FROM public.raw_materials_import;
    RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.rmims_import_rows(TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.import_raw_materials_from_staging(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.import_raw_materials(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_raw_materials(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rmims_import_rows(TEXT, JSONB, UUID), public.import_raw_materials_from_staging(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
