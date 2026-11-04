-- ============================================================================
-- RMIMS FRESH SETUP — 14  STAFF REPORTS: one row per staff submission, one row per staff member
-- ============================================================================
-- A company can have many Staff. Every row carries the staff member AND their company, and the rows are
-- filtered by who is looking, so nothing crosses companies or staff members:
--   Staff    sees only their OWN submissions / their own summary
--   Manager  sees every staff member of THEIR company (never another company)
--   Admin    sees every company, each row labelled with its company
-- Built only from what the users did (staff submissions + the Manager's decisions); nothing invented.
--
--   v_report_staff_submissions   every receive / disburse a staff member submitted, its latest status
--   v_report_staff_summary       per staff member: totals by status, first / latest submission
-- ============================================================================

DROP VIEW IF EXISTS public.v_report_staff_summary, public.v_report_staff_submissions CASCADE;

CREATE VIEW public.v_report_staff_submissions WITH (security_invoker = true) AS
WITH events AS (
    SELECT a.company_id, a.entity_id AS reference_no, a.action, a.details, a.user_id, a.created_at
      FROM public.activity_audit_logs a
     WHERE a.entity_type = 'staff_transactions'
       AND a.action IN ('STAFF_TX_STATE', 'APPROVE_TRANSACTION', 'REJECT_TRANSACTION', 'RETURN_FOR_CORRECTION', 'DELETE_STAFF_TRANSACTION')
       AND coalesce(a.entity_id, '') <> ''
),
submitted AS (   -- the first record of a reference = the staff member who submitted it
    SELECT DISTINCT ON (company_id, reference_no) company_id, reference_no, user_id AS staff_user_id, created_at AS submitted_at
      FROM events WHERE action = 'STAFF_TX_STATE'
     ORDER BY company_id, reference_no, created_at
),
snapshot AS (    -- the latest full copy of the submission (material, quantity, ...)
    SELECT DISTINCT ON (company_id, reference_no) company_id, reference_no, details, created_at
      FROM events WHERE action = 'STAFF_TX_STATE'
     ORDER BY company_id, reference_no, created_at DESC
),
latest AS (      -- the latest thing that happened to it (decision or new snapshot)
    SELECT DISTINCT ON (company_id, reference_no) company_id, reference_no, action, details, user_id, created_at
      FROM events
     ORDER BY company_id, reference_no, created_at DESC
)
SELECT s.company_id,
       c.name                                                                        AS company_name,
       s.staff_user_id,
       coalesce(p.full_name, p.username, sn.details->>'staff', '—')                  AS staff_name,
       coalesce(p.email, sn.details->>'staffEmail')                                  AS staff_email,
       s.reference_no,
       CASE WHEN lower(coalesce(sn.details->>'activity', sn.details->>'type', '')) LIKE 'rec%' THEN 'Receive'
            WHEN lower(coalesce(sn.details->>'activity', sn.details->>'type', '')) LIKE 'dis%' THEN 'Disburse'
            ELSE coalesce(sn.details->>'activity', '—') END                          AS activity,
       coalesce(sn.details->>'material', sn.details->>'materialName', '—')           AS raw_material,
       public.rmims_fp_num(sn.details->>'quantity')                                  AS quantity,
       nullif(sn.details->>'unit', '')                                               AS unit,
       coalesce(nullif(sn.details->>'usedFor', ''), '—')                             AS finished_product,
       nullif(sn.details->>'supplier', '')                                           AS supplier,
       nullif(sn.details->>'date', '')                                               AS record_date,
       s.submitted_at,
       CASE l.action
            WHEN 'APPROVE_TRANSACTION'      THEN 'Approved'
            WHEN 'REJECT_TRANSACTION'       THEN 'Rejected'
            WHEN 'RETURN_FOR_CORRECTION'    THEN 'Returned for correction'
            WHEN 'DELETE_STAFF_TRANSACTION' THEN 'Deleted'
            ELSE coalesce(nullif(sn.details->>'status', ''), 'Pending') END            AS status,
       CASE WHEN l.action <> 'STAFF_TX_STATE' THEN l.created_at END                 AS decided_at,
       CASE WHEN l.action <> 'STAFF_TX_STATE' THEN coalesce(dp.full_name, dp.username) END AS decided_by
  FROM submitted s
  JOIN snapshot sn ON sn.company_id IS NOT DISTINCT FROM s.company_id AND sn.reference_no = s.reference_no
  JOIN latest   l  ON l.company_id  IS NOT DISTINCT FROM s.company_id AND l.reference_no  = s.reference_no
  LEFT JOIN public.companies     c  ON c.id  = s.company_id
  LEFT JOIN public.user_profiles p  ON p.id  = s.staff_user_id
  LEFT JOIN public.user_profiles dp ON dp.id = l.user_id
 WHERE public.is_admin_user()
    OR (s.company_id = public.get_current_user_company_id()
        AND (public.is_manager_user() OR s.staff_user_id = auth.uid()));

CREATE VIEW public.v_report_staff_summary WITH (security_invoker = true) AS
SELECT company_id,
       company_name,
       staff_user_id,
       staff_name,
       staff_email,
       count(*)                                                        AS submissions,
       count(*) FILTER (WHERE status = 'Pending' OR status ILIKE 'resubmitted%' OR status ILIKE 'updated%') AS pending,
       count(*) FILTER (WHERE status = 'Approved')                     AS approved,
       count(*) FILTER (WHERE status = 'Rejected')                     AS rejected,
       count(*) FILTER (WHERE status = 'Returned for correction')      AS returned_for_correction,
       count(*) FILTER (WHERE activity = 'Receive')                    AS receive_submissions,
       count(*) FILTER (WHERE activity = 'Disburse')                   AS disburse_submissions,
       min(submitted_at)                                               AS first_submission,
       max(submitted_at)                                               AS latest_submission
  FROM public.v_report_staff_submissions
 WHERE status <> 'Deleted'
 GROUP BY company_id, company_name, staff_user_id, staff_name, staff_email;

REVOKE ALL ON public.v_report_staff_submissions, public.v_report_staff_summary FROM anon;
GRANT SELECT ON public.v_report_staff_submissions, public.v_report_staff_summary TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
