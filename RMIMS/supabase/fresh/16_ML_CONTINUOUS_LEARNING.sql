-- ============================================================================
-- RMIMS — 16  ML CONTINUOUS SELF-LEARNING (Forecast model)
-- ============================================================================
-- Safe to run more than once (IF NOT EXISTS / CREATE OR REPLACE). Run AFTER 01-15. Deletes no records.
--
-- What it adds:
--   ml_model_profiles      one row per company + raw material: the model the system forecasts with.
--                          * the 12-year TRAINED columns (the 19 Scones & Muffins materials, kept exactly as trained)
--                          * the CONTINUOUS LEARNING columns: live usage recorded by users, appended after the
--                            12-year history (training ended 2025-07-02), its learned weekday / month pattern,
--                            yearly growth, 7-day / 30-day / yearly trends, margin of error, next 7 / 30-day requirement
--                          * new raw materials get a row too (model_source = 'self-learned')
--   v_ml_usage_feed        the live usage feed: daily consumption per material from every disbursement, numbered
--                          as days after the end of the 12-year history (what the model keeps learning from)
--   v_ml_usage_weekly      the same feed per 7-day week          (trend basis: weeks)
--   v_ml_usage_monthly     the same feed per month               (trend basis: months / year)
--   save_ml_profile()      the app stores the model it re-learned (every device then uses the same model)
--   rmims_ml_feed_material()  refreshes a material's live columns from the feed; runs by itself after every
--                          disbursement is added, edited or deleted, so the learning never stops
-- ============================================================================

-- 1. MODEL TABLE ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_model_profiles (
    company_id   TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    item_code    TEXT NOT NULL,
    model_source TEXT NOT NULL DEFAULT 'self-learned',
    PRIMARY KEY (company_id, item_code)
);
-- 12-year trained columns (kept as trained)
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS trained_end_date      DATE;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS trained_history_days  INTEGER;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS trained_growth        NUMERIC;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS trained_dow           JSONB;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS trained_month         JSONB;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS trained_mape          NUMERIC;
-- continuous learning columns (live usage appended after the 12-year history / a new material's own history)
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS material_name         TEXT;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS unit                  TEXT;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS live_days             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS live_total_qty        NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS live_first_date       DATE;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS live_last_date        DATE;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS live_weight_pct       NUMERIC;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS learned_level         NUMERIC;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS learned_growth        NUMERIC;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS learned_dow           JSONB;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS learned_month         JSONB;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS learned_mape          NUMERIC;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS backtest_days         INTEGER;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS trend_7d_pct          NUMERIC;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS trend_30d_pct         NUMERIC;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS yearly_trend_pct      NUMERIC;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS next_7d_requirement   NUMERIC;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS next_30d_requirement  NUMERIC;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS learned_at            TIMESTAMPTZ;
ALTER TABLE public.ml_model_profiles ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ml_model_profiles_source_chk') THEN
        ALTER TABLE public.ml_model_profiles ADD CONSTRAINT ml_model_profiles_source_chk
            CHECK (model_source IN ('trained-12y', 'self-learned'));
    END IF;
END $$;

ALTER TABLE public.ml_model_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ml_profiles_read ON public.ml_model_profiles;
CREATE POLICY ml_profiles_read ON public.ml_model_profiles FOR SELECT TO authenticated
    USING (public.is_admin_user() OR (company_id = public.get_current_user_company_id() AND public.is_active_user()));
GRANT SELECT ON public.ml_model_profiles TO authenticated;
GRANT ALL ON public.ml_model_profiles TO service_role;
REVOKE ALL ON public.ml_model_profiles FROM anon;

-- 2. THE 12-YEAR TRAINED MODEL (19 Scones & Muffins materials) - stored as trained, never overwritten -----------
INSERT INTO public.ml_model_profiles (company_id, item_code, model_source, trained_end_date, trained_history_days,
                                      trained_growth, trained_dow, trained_month, trained_mape)
SELECT '1872cf44-e821-4370-b227-d1b7e4fc6f56', v.code, 'trained-12y', DATE '2025-07-02', 4383, v.growth, v.dow, v.month, v.mape
  FROM (VALUES
        ('NB-001', 1.0745, '[0.0819, 1.0385, 1.0391, 1.0192, 1.0289, 1.3917, 1.4007]'::jsonb, '[0.9382, 0.9323, 0.9345, 0.9462, 0.5768, 0.5532, 1.1367, 1.1107, 1.0906, 1.14, 1.112, 1.5288]'::jsonb, 6.93),
        ('NB-002', 1.0777, '[0.0822, 1.0327, 1.0267, 1.028, 1.0407, 1.396, 1.3938]'::jsonb, '[0.9244, 0.919, 0.9271, 0.941, 0.5829, 0.5539, 1.1495, 1.1146, 1.0863, 1.1532, 1.1075, 1.5407]'::jsonb, 6.98),
        ('NB-003', 1.0764, '[0.0826, 1.0326, 1.0294, 1.0246, 1.0341, 1.4002, 1.3964]'::jsonb, '[0.9244, 0.9195, 0.9222, 0.9391, 0.5732, 0.5631, 1.1447, 1.1179, 1.0965, 1.1546, 1.1044, 1.5402]'::jsonb, 7.59),
        ('NB-004', 1.0779, '[0.0821, 1.0363, 1.0182, 1.0337, 1.0447, 1.3937, 1.3912]'::jsonb, '[0.9261, 0.9283, 0.9259, 0.9554, 0.5821, 0.5573, 1.1429, 1.1086, 1.0776, 1.1286, 1.0915, 1.5755]'::jsonb, 7.99),
        ('NB-005', 1.0792, '[0.0816, 1.0277, 1.0315, 1.0384, 1.0366, 1.3973, 1.3869]'::jsonb, '[0.9208, 0.9286, 0.9352, 0.9404, 0.5744, 0.5629, 1.159, 1.1122, 1.0705, 1.1382, 1.1062, 1.5515]'::jsonb, 8.09),
        ('NB-006', 1.077, '[0.0828, 1.03, 1.0289, 1.024, 1.0414, 1.4078, 1.3852]'::jsonb, '[0.933, 0.9206, 0.9417, 0.964, 0.5745, 0.5602, 1.1293, 1.1093, 1.0718, 1.1456, 1.1037, 1.5461]'::jsonb, 8.01),
        ('NB-007', 1.0766, '[0.0818, 1.0323, 1.0223, 1.0267, 1.0393, 1.4046, 1.3931]'::jsonb, '[0.933, 0.9249, 0.9275, 0.9363, 0.5767, 0.5587, 1.1571, 1.1159, 1.0937, 1.1297, 1.1167, 1.5298]'::jsonb, 6.95),
        ('NB-008', 1.0756, '[0.0809, 1.042, 1.03, 1.0326, 1.0356, 1.4017, 1.3771]'::jsonb, '[0.9357, 0.9263, 0.9289, 0.9415, 0.5739, 0.5611, 1.1558, 1.0977, 1.0729, 1.1463, 1.1054, 1.5546]'::jsonb, 8.64),
        ('NB-009', 1.0768, '[0.0829, 1.0398, 1.0254, 1.0287, 1.033, 1.4008, 1.3895]'::jsonb, '[0.9465, 0.9177, 0.9435, 0.9408, 0.5875, 0.564, 1.1475, 1.1103, 1.0766, 1.1402, 1.088, 1.5373]'::jsonb, 7.39),
        ('NB-010', 1.0768, '[0.0862, 1.0336, 1.0355, 1.0297, 1.0211, 1.4031, 1.3909]'::jsonb, '[0.9303, 0.9184, 0.9315, 0.9645, 0.5802, 0.5574, 1.136, 1.1048, 1.0861, 1.1467, 1.1006, 1.5436]'::jsonb, 12.6),
        ('NB-011', 1.0773, '[0.0825, 1.0339, 1.0344, 1.0283, 1.0385, 1.3941, 1.3883]'::jsonb, '[0.9406, 0.9365, 0.922, 0.9318, 0.5775, 0.5608, 1.1418, 1.1098, 1.087, 1.1612, 1.0963, 1.5347]'::jsonb, 8.99),
        ('NB-012', 1.0769, '[0.0769, 1.0382, 1.0331, 1.0398, 1.0355, 1.3885, 1.3879]'::jsonb, '[0.933, 0.9199, 0.9362, 0.9459, 0.5774, 0.5579, 1.1407, 1.1128, 1.0917, 1.1494, 1.0969, 1.5381]'::jsonb, 13.18),
        ('NB-013', 1.0737, '[0.1728, 1.0137, 1.0128, 1.0248, 1.0306, 1.3809, 1.3643]'::jsonb, '[0.9273, 0.9234, 0.9327, 0.9384, 0.6072, 0.5789, 1.1268, 1.119, 1.0728, 1.1449, 1.111, 1.5177]'::jsonb, 11.16),
        ('NB-014', 1.0746, '[0.0818, 1.0267, 1.032, 1.0273, 1.035, 1.3998, 1.3973]'::jsonb, '[0.9194, 0.9281, 0.9236, 0.9398, 0.5806, 0.562, 1.153, 1.1269, 1.0849, 1.1469, 1.095, 1.5399]'::jsonb, 7.68),
        ('NB-015', 1.0756, '[0.0819, 1.0355, 1.0464, 1.0196, 1.0357, 1.3925, 1.3884]'::jsonb, '[0.9375, 0.9064, 0.9272, 0.9451, 0.5899, 0.5638, 1.1293, 1.1083, 1.0896, 1.1545, 1.1041, 1.5441]'::jsonb, 7.42),
        ('NB-016', 1.0742, '[0.0821, 1.0409, 1.0295, 1.0213, 1.0341, 1.4056, 1.3865]'::jsonb, '[0.9288, 0.9159, 0.9364, 0.9416, 0.5839, 0.5618, 1.1343, 1.1258, 1.0782, 1.1446, 1.1096, 1.5391]'::jsonb, 7.34),
        ('NB-017', 1.076, '[0.081, 1.0268, 1.0242, 1.0253, 1.0438, 1.4037, 1.3952]'::jsonb, '[0.9237, 0.9367, 0.9214, 0.9474, 0.5812, 0.5497, 1.1583, 1.1054, 1.0832, 1.1618, 1.0983, 1.5329]'::jsonb, 8.08),
        ('NB-018', 1.0749, '[0.2142, 1.0173, 1.0362, 1.0038, 1.0167, 1.3577, 1.3541]'::jsonb, '[0.9234, 0.9249, 0.954, 0.9338, 0.6023, 0.5822, 1.1553, 1.1071, 1.0699, 1.1476, 1.0781, 1.5213]'::jsonb, 12.07),
        ('NB-019', 1.0752, '[0.0825, 1.0381, 1.0274, 1.0305, 1.0264, 1.3897, 1.4055]'::jsonb, '[0.9189, 0.9058, 0.9328, 0.9441, 0.5835, 0.5512, 1.1445, 1.1067, 1.0925, 1.1498, 1.1076, 1.5625]'::jsonb, 6.94)
       ) AS v(code, growth, dow, month, mape)
 WHERE EXISTS (SELECT 1 FROM public.companies WHERE id = '1872cf44-e821-4370-b227-d1b7e4fc6f56')
ON CONFLICT (company_id, item_code) DO UPDATE
   SET model_source = 'trained-12y',
       trained_end_date = EXCLUDED.trained_end_date, trained_history_days = EXCLUDED.trained_history_days,
       trained_growth = EXCLUDED.trained_growth, trained_dow = EXCLUDED.trained_dow,
       trained_month = EXCLUDED.trained_month, trained_mape = EXCLUDED.trained_mape;

-- 3. LIVE USAGE FEED (what the model keeps learning from) ---------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ml_usage_feed
WITH (security_invoker = true) AS
SELECT d.company_id,
       rm.item_code,
       rm.name                                   AS material_name,
       rm.unit_of_measure                        AS unit,
       d.usage_date,
       sum(d.consumed_quantity)                  AS consumed_qty,
       count(*)                                  AS records,
       (d.usage_date - DATE '2025-07-02')        AS days_after_12y_history,
       extract(isodow FROM d.usage_date)::int    AS iso_weekday,
       extract(month FROM d.usage_date)::int     AS month_no,
       extract(year FROM d.usage_date)::int      AS year_no
  FROM public.material_disbursements d
  JOIN public.raw_materials rm ON rm.id = d.material_id
 GROUP BY d.company_id, rm.item_code, rm.name, rm.unit_of_measure, d.usage_date;
GRANT SELECT ON public.v_ml_usage_feed TO authenticated;

CREATE OR REPLACE VIEW public.v_ml_usage_weekly
WITH (security_invoker = true) AS
SELECT company_id, item_code, material_name, unit,
       date_trunc('week', usage_date)::date AS week_start,
       sum(consumed_qty)                    AS consumed_qty,
       count(*)                             AS days_recorded
  FROM public.v_ml_usage_feed
 GROUP BY company_id, item_code, material_name, unit, date_trunc('week', usage_date);
GRANT SELECT ON public.v_ml_usage_weekly TO authenticated;

CREATE OR REPLACE VIEW public.v_ml_usage_monthly
WITH (security_invoker = true) AS
SELECT company_id, item_code, material_name, unit,
       date_trunc('month', usage_date)::date AS month_start,
       sum(consumed_qty)                     AS consumed_qty,
       count(*)                              AS days_recorded
  FROM public.v_ml_usage_feed
 GROUP BY company_id, item_code, material_name, unit, date_trunc('month', usage_date);
GRANT SELECT ON public.v_ml_usage_monthly TO authenticated;

-- 4. LIVE COLUMNS REFRESH: runs after every disbursement change (continuous learning in the database) ------------
CREATE OR REPLACE FUNCTION public.rmims_ml_feed_material(p_company TEXT, p_material UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code TEXT; v_name TEXT; v_unit TEXT;
    v_days INT; v_total NUMERIC; v_first DATE; v_last DATE;
    v_l7 NUMERIC; v_p7 NUMERIC; v_l30 NUMERIC; v_p30 NUMERIC; v_ly NUMERIC; v_py NUMERIC;
    v_trained BOOLEAN;
BEGIN
    SELECT item_code, name, unit_of_measure INTO v_code, v_name, v_unit FROM public.raw_materials WHERE id = p_material;
    IF v_code IS NULL OR p_company IS NULL THEN RETURN; END IF;

    SELECT count(*), coalesce(sum(consumed_qty), 0), min(usage_date), max(usage_date)
      INTO v_days, v_total, v_first, v_last
      FROM public.v_ml_usage_feed WHERE company_id = p_company AND item_code = v_code AND consumed_qty > 0;

    -- trends measured back from the last recorded day (both windows complete)
    SELECT coalesce(sum(consumed_qty) FILTER (WHERE usage_date >  v_last - 7),  0),
           coalesce(sum(consumed_qty) FILTER (WHERE usage_date <= v_last - 7  AND usage_date > v_last - 14), 0),
           coalesce(sum(consumed_qty) FILTER (WHERE usage_date >  v_last - 30), 0),
           coalesce(sum(consumed_qty) FILTER (WHERE usage_date <= v_last - 30 AND usage_date > v_last - 60), 0),
           coalesce(sum(consumed_qty) FILTER (WHERE usage_date >  v_last - 365), 0),
           coalesce(sum(consumed_qty) FILTER (WHERE usage_date <= v_last - 365 AND usage_date > v_last - 730), 0)
      INTO v_l7, v_p7, v_l30, v_p30, v_ly, v_py
      FROM public.v_ml_usage_feed WHERE company_id = p_company AND item_code = v_code;

    v_trained := EXISTS (SELECT 1 FROM public.ml_model_profiles
                          WHERE company_id = p_company AND item_code = v_code AND model_source = 'trained-12y');

    INSERT INTO public.ml_model_profiles AS m (company_id, item_code, model_source, material_name, unit,
                live_days, live_total_qty, live_first_date, live_last_date, live_weight_pct,
                trend_7d_pct, trend_30d_pct, yearly_trend_pct, updated_at)
    VALUES (p_company, v_code, CASE WHEN v_trained THEN 'trained-12y' ELSE 'self-learned' END, v_name, v_unit,
            v_days, v_total, v_first, v_last,
            -- live data weight: trained = live days appended to the 12-year history; new material = its own data
            CASE WHEN v_trained THEN round(100.0 * v_days / (4383 + v_days), 2) ELSE CASE WHEN v_days > 0 THEN 100 ELSE 0 END END,
            CASE WHEN v_p7  > 0 THEN round((v_l7  / v_p7  - 1) * 100, 1) END,
            CASE WHEN v_p30 > 0 THEN round((v_l30 / v_p30 - 1) * 100, 1) END,
            CASE WHEN v_py  > 0 THEN round((v_ly  / v_py  - 1) * 100, 1) END,
            now())
    ON CONFLICT (company_id, item_code) DO UPDATE
       SET material_name = EXCLUDED.material_name, unit = EXCLUDED.unit,
           live_days = EXCLUDED.live_days, live_total_qty = EXCLUDED.live_total_qty,
           live_first_date = EXCLUDED.live_first_date, live_last_date = EXCLUDED.live_last_date,
           live_weight_pct = EXCLUDED.live_weight_pct,
           trend_7d_pct = EXCLUDED.trend_7d_pct, trend_30d_pct = EXCLUDED.trend_30d_pct,
           yearly_trend_pct = EXCLUDED.yearly_trend_pct, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.rmims_ml_feed_material(TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_rmims_ml_feed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- the learning feed must never block recording a disbursement
    BEGIN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM public.rmims_ml_feed_material(NEW.company_id, NEW.material_id); END IF;
        IF TG_OP IN ('UPDATE', 'DELETE') AND (TG_OP = 'DELETE' OR OLD.material_id IS DISTINCT FROM NEW.material_id) THEN
            PERFORM public.rmims_ml_feed_material(OLD.company_id, OLD.material_id);
        END IF;
    EXCEPTION WHEN others THEN
        RAISE WARNING 'RMIMS ML feed skipped: %', SQLERRM;
    END;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_material_disbursements_ml_feed ON public.material_disbursements;
CREATE TRIGGER trg_material_disbursements_ml_feed
AFTER INSERT OR UPDATE OR DELETE ON public.material_disbursements
FOR EACH ROW EXECUTE FUNCTION public.trg_rmims_ml_feed();

-- 5. THE APP SAVES THE MODEL IT RE-LEARNED (weekday / month pattern, growth, margin, next requirement) ----------
CREATE OR REPLACE FUNCTION public.save_ml_profile(p_item_code TEXT, p_profile JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_company TEXT := public.get_current_user_company_id();
    v_code    TEXT := upper(btrim(coalesce(p_item_code, '')));
BEGIN
    IF v_company IS NULL OR NOT public.is_active_user() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not an active account with a company.');
    END IF;
    IF v_code = '' OR p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Material code or model missing.');
    END IF;
    INSERT INTO public.ml_model_profiles AS m (company_id, item_code, model_source,
                learned_level, learned_growth, learned_dow, learned_month, learned_mape, backtest_days,
                live_days, live_first_date, live_last_date, live_weight_pct,
                trend_7d_pct, trend_30d_pct, yearly_trend_pct, next_7d_requirement, next_30d_requirement,
                learned_at, updated_at)
    VALUES (v_company, v_code, 'self-learned',
            (p_profile->>'level')::numeric, (p_profile->>'growth')::numeric, p_profile->'dow', p_profile->'month',
            (p_profile->>'mape')::numeric, (p_profile->>'backtestDays')::int,
            coalesce((p_profile->>'evidenceDays')::int, 0), (p_profile->>'firstDate')::date, (p_profile->>'lastDate')::date,
            (p_profile->>'liveWeightPct')::numeric,
            (p_profile->>'trend7Pct')::numeric, (p_profile->>'trend30Pct')::numeric, (p_profile->>'yearlyTrendPct')::numeric,
            (p_profile->>'next7')::numeric, (p_profile->>'next30')::numeric,
            now(), now())
    ON CONFLICT (company_id, item_code) DO UPDATE
       SET learned_level = EXCLUDED.learned_level, learned_growth = EXCLUDED.learned_growth,
           learned_dow = EXCLUDED.learned_dow, learned_month = EXCLUDED.learned_month,
           learned_mape = EXCLUDED.learned_mape, backtest_days = EXCLUDED.backtest_days,
           live_days = greatest(m.live_days, EXCLUDED.live_days),
           live_first_date = coalesce(m.live_first_date, EXCLUDED.live_first_date),
           live_last_date = greatest(m.live_last_date, EXCLUDED.live_last_date),
           live_weight_pct = EXCLUDED.live_weight_pct,
           trend_7d_pct = EXCLUDED.trend_7d_pct, trend_30d_pct = EXCLUDED.trend_30d_pct,
           yearly_trend_pct = EXCLUDED.yearly_trend_pct,
           next_7d_requirement = coalesce(EXCLUDED.next_7d_requirement, m.next_7d_requirement),
           next_30d_requirement = coalesce(EXCLUDED.next_30d_requirement, m.next_30d_requirement),
           learned_at = now(), updated_at = now();
           -- model_source and the trained columns are never changed here (the 12-year model stays as trained)
    RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.save_ml_profile(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_ml_profile(TEXT, JSONB) TO authenticated;

-- 6. Learn from everything already recorded, now ----------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT DISTINCT company_id, material_id FROM public.material_disbursements LOOP
        PERFORM public.rmims_ml_feed_material(r.company_id, r.material_id);
    END LOOP;
END $$;

-- Live updates for every open page
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                        AND schemaname = 'public' AND tablename = 'ml_model_profiles') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.ml_model_profiles;
    END IF;
END $$;

-- Check: one row per material; the 19 say trained-12y, new materials self-learned
SELECT item_code, material_name, model_source, live_days, live_weight_pct, trend_7d_pct, trend_30d_pct, yearly_trend_pct
  FROM public.ml_model_profiles
 ORDER BY company_id, item_code;
