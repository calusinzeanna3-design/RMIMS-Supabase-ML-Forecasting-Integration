-- ============================================================================
-- RMIMS FRESH SETUP — 12  REPORTS: one view per Reports tab
-- ============================================================================
-- Read-only views over the module tables (nothing is stored twice, nothing is invented). They follow the same
-- security as the tables (security_invoker): a Manager / Staff sees only their company, the Admin sees all.
--
--   Reports tab                 View
--   Manager Summary             v_report_manager_summary
--   Restock Recommendations     v_report_restock_inputs      (recorded usage the forecast is computed from)
--   Inventory Records           v_report_inventory_records
--   Material Receiving          v_report_material_receiving
--   Material Disbursement       v_report_material_disbursement
--   Material Activity           v_report_material_activity
--   Consumption Analysis        v_report_consumption_analysis
--   AI Forecasting              v_report_restock_inputs + v_finished_product_material_usage (file 07)
-- The forecast figures themselves come from the trained model in the app (same numbers on every page);
-- these views hold the recorded data it uses.
-- ============================================================================

DROP VIEW IF EXISTS public.v_report_manager_summary, public.v_report_restock_inputs, public.v_report_consumption_analysis,
                     public.v_report_material_activity, public.v_report_material_disbursement, public.v_report_material_receiving,
                     public.v_report_inventory_records CASCADE;

-- INVENTORY RECORDS ---------------------------------------------------------------------------------------
CREATE VIEW public.v_report_inventory_records WITH (security_invoker = true) AS
SELECT m.company_id,
       c.name                AS company_name,
       m.item_code,
       m.name                AS raw_material,
       m.unit_of_measure     AS unit,
       m.current_stock,
       m.minimum_threshold,
       m.reorder_quantity,
       m.lead_time_days,
       CASE WHEN m.current_stock <= 0 THEN 'Out of Stock'
            WHEN coalesce(m.minimum_threshold, 0) > 0 AND m.current_stock <= m.minimum_threshold / 2 THEN 'Critical'
            WHEN coalesce(m.minimum_threshold, 0) > 0 AND m.current_stock <= m.minimum_threshold THEN 'Low'
            ELSE 'Good' END   AS status,
       m.first_date,
       m.latest_date
  FROM public.raw_materials m
  JOIN public.companies c ON c.id = m.company_id;

-- MATERIAL RECEIVING --------------------------------------------------------------------------------------
CREATE VIEW public.v_report_material_receiving WITH (security_invoker = true) AS
SELECT r.company_id,
       r.receipt_date,
       to_char(r.created_at AT TIME ZONE 'Asia/Manila', 'HH24:MI')                      AS receipt_time,
       r.reference_no,
       m.item_code,
       m.name                                                                           AS raw_material,
       coalesce(r.finished_product_name, '—')                                           AS finished_product,
       r.received_quantity,
       r.unit,
       nullif(btrim(regexp_replace(coalesce(r.supplier_name, ''), '\s*\[Ref:[^\]]*\]', '', 'g')), '') AS supplier,
       coalesce(p.full_name, p.username, '—')                                           AS received_by,
       r.created_at
  FROM public.stock_receipts r
  JOIN public.raw_materials m ON m.id = r.material_id
  LEFT JOIN public.user_profiles p ON p.id = r.received_by;

-- MATERIAL DISBURSEMENT -----------------------------------------------------------------------------------
CREATE VIEW public.v_report_material_disbursement WITH (security_invoker = true) AS
SELECT d.company_id,
       d.usage_date,
       to_char(d.created_at AT TIME ZONE 'Asia/Manila', 'HH24:MI')                      AS usage_time,
       d.reference_no,
       m.item_code,
       m.name                                                                           AS raw_material,
       coalesce(d.finished_product_name, '—')                                           AS finished_product,
       d.consumed_quantity                                                              AS disbursed_quantity,
       d.unit,
       coalesce(nullif(btrim(regexp_replace(coalesce(d.activity_type, ''), '\s*\[Ref:[^\]]*\]', '', 'g')), ''), '—') AS activity_type,
       coalesce(p.full_name, p.username, '—')                                           AS recorded_by,
       d.created_at
  FROM public.material_disbursements d
  JOIN public.raw_materials m ON m.id = d.material_id
  LEFT JOIN public.user_profiles p ON p.id = d.recorded_by;

-- MATERIAL ACTIVITY (both ledgers, newest first) -------------------------------------------------------------
CREATE VIEW public.v_report_material_activity WITH (security_invoker = true) AS
SELECT company_id, receipt_date AS activity_date, receipt_time AS activity_time, reference_no, 'Received' AS activity,
       item_code, raw_material, finished_product, received_quantity AS net_quantity, unit, received_by AS recorded_by, created_at
  FROM public.v_report_material_receiving
UNION ALL
SELECT company_id, usage_date, usage_time, reference_no, 'Disbursed',
       item_code, raw_material, finished_product, -disbursed_quantity, unit, recorded_by, created_at
  FROM public.v_report_material_disbursement;

-- CONSUMPTION ANALYSIS (recorded usage per raw material) -----------------------------------------------------
CREATE VIEW public.v_report_consumption_analysis WITH (security_invoker = true) AS
SELECT m.company_id,
       m.item_code,
       m.name                                                                                   AS raw_material,
       m.unit_of_measure                                                                        AS unit,
       m.current_stock,
       coalesce(sum(d.consumed_quantity), 0)                                                    AS total_disbursed,
       coalesce(sum(d.consumed_quantity) FILTER (WHERE d.usage_date > CURRENT_DATE - 7), 0)     AS disbursed_last_7_days,
       coalesce(sum(d.consumed_quantity) FILTER (WHERE d.usage_date > CURRENT_DATE - 30), 0)    AS disbursed_last_30_days,
       count(DISTINCT d.usage_date)                                                             AS days_with_usage,
       round(coalesce(sum(d.consumed_quantity) FILTER (WHERE d.usage_date > CURRENT_DATE - 30), 0) / 30.0, 2) AS avg_daily_last_30_days,
       min(d.usage_date)                                                                        AS first_usage,
       max(d.usage_date)                                                                        AS latest_usage
  FROM public.raw_materials m
  LEFT JOIN public.material_disbursements d ON d.material_id = m.id
 GROUP BY m.company_id, m.item_code, m.name, m.unit_of_measure, m.current_stock;

-- RESTOCK + AI FORECASTING INPUTS (recorded usage the forecast is computed from) -----------------------------
CREATE VIEW public.v_report_restock_inputs WITH (security_invoker = true) AS
SELECT ca.company_id,
       ca.item_code,
       ca.raw_material,
       ca.unit,
       ca.current_stock,
       ir.minimum_threshold,
       ir.status                                                     AS stock_status,
       ca.disbursed_last_7_days,
       ca.disbursed_last_30_days,
       ca.days_with_usage                                            AS recorded_usage_days,
       CASE WHEN ca.days_with_usage = 0 THEN 'No recorded usage yet' ELSE 'Has recorded usage' END AS forecast_basis,
       coalesce((SELECT string_agg(f.finished_product || ' (' || coalesce(f.limit_per_unit::text, '—') || ' ' || coalesce(f.unit, '') || '/unit)', ', '
                                   ORDER BY f.finished_product)
                   FROM public.v_finished_product_material_usage f
                  WHERE f.company_id = ca.company_id AND f.item_code = ca.item_code), '—') AS finished_products
  FROM public.v_report_consumption_analysis ca
  JOIN public.v_report_inventory_records ir ON ir.company_id = ca.company_id AND ir.item_code = ca.item_code;

-- MANAGER SUMMARY (one row per company) ----------------------------------------------------------------------
CREATE VIEW public.v_report_manager_summary WITH (security_invoker = true) AS
SELECT c.id                                                                           AS company_id,
       c.name                                                                         AS company_name,
       (SELECT count(*) FROM public.v_report_inventory_records i WHERE i.company_id = c.id)                              AS total_materials,
       (SELECT count(*) FROM public.v_report_inventory_records i WHERE i.company_id = c.id AND i.status = 'Good')        AS good_stock,
       (SELECT count(*) FROM public.v_report_inventory_records i WHERE i.company_id = c.id AND i.status IN ('Low', 'Critical')) AS low_or_critical,
       (SELECT count(*) FROM public.v_report_inventory_records i WHERE i.company_id = c.id AND i.status = 'Out of Stock') AS out_of_stock,
       (SELECT count(*) FROM public.stock_receipts r WHERE r.company_id = c.id)                                          AS deliveries_received,
       (SELECT count(*) FROM public.material_disbursements d WHERE d.company_id = c.id)                                  AS disbursements_recorded,
       (SELECT count(*) FROM public.finished_products f WHERE f.company_id = c.id AND f.deleted_at IS NULL)              AS finished_products
  FROM public.companies c;

GRANT SELECT ON public.v_report_inventory_records, public.v_report_material_receiving, public.v_report_material_disbursement,
                public.v_report_material_activity, public.v_report_consumption_analysis, public.v_report_restock_inputs,
                public.v_report_manager_summary TO authenticated, service_role;
REVOKE ALL ON public.v_report_inventory_records, public.v_report_material_receiving, public.v_report_material_disbursement,
              public.v_report_material_activity, public.v_report_consumption_analysis, public.v_report_restock_inputs,
              public.v_report_manager_summary FROM anon;

NOTIFY pgrst, 'reload schema';

-- CHECK: every report view answers (empty until users record data)
SELECT 'v_report_manager_summary' AS report, count(*) AS rows FROM public.v_report_manager_summary
UNION ALL SELECT 'v_report_inventory_records', count(*) FROM public.v_report_inventory_records
UNION ALL SELECT 'v_report_material_receiving', count(*) FROM public.v_report_material_receiving
UNION ALL SELECT 'v_report_material_disbursement', count(*) FROM public.v_report_material_disbursement
UNION ALL SELECT 'v_report_material_activity', count(*) FROM public.v_report_material_activity
UNION ALL SELECT 'v_report_consumption_analysis', count(*) FROM public.v_report_consumption_analysis
UNION ALL SELECT 'v_report_restock_inputs', count(*) FROM public.v_report_restock_inputs;
