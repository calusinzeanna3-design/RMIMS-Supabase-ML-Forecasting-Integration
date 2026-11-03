-- ============================================================================
-- RMIMS — PUT THE REFERENCE NUMBER BACK ON OLDER STOCK RECEIPTS  (optional, run once)
-- Run in Supabase > SQL Editor. SAFE: it only appends " [Ref: 2026SMM-R0004]" to supplier_name of receipts
-- that are missing it. It never deletes rows and never changes quantities or stock.
--
-- Why: receipts saved through the stored procedure were stored WITHOUT their reference number, so other
-- devices showed them with a random id and could not delete them. The app now saves the tag and can also
-- recover it on the fly, but this makes the fix permanent in the database.
-- A receipt is only updated when exactly one audit-log entry (same company, same quantity, within 10 minutes)
-- matches it, and that entry matches no other receipt.
-- ============================================================================
BEGIN;

WITH untagged AS (
  SELECT r.id, r.company_id, r.received_quantity, r.created_at
    FROM public.stock_receipts r
   WHERE coalesce(r.supplier_name, '') NOT ILIKE '%[Ref:%'
),
logs AS (
  SELECT l.id AS log_id, l.company_id, l.created_at,
         coalesce(l.details->>'ref', l.entity_id) AS ref,
         nullif(l.details->>'quantity', '')::numeric AS qty
    FROM public.activity_audit_logs l
   WHERE l.action = 'STOCK_RECEIPT'
     AND coalesce(l.details->>'ref', l.entity_id, '') ~ '^[0-9]{4}[A-Za-z]+-R[0-9]+$'
),
pairs AS (
  SELECT u.id AS receipt_id, g.ref, g.log_id
    FROM untagged u
    JOIN logs g
      ON g.qty = u.received_quantity
     AND (g.company_id IS NOT DISTINCT FROM u.company_id)
     AND abs(extract(epoch FROM (g.created_at - u.created_at))) < 600
),
unique_pairs AS (
  SELECT p.receipt_id, p.ref
    FROM pairs p
   WHERE (SELECT count(*) FROM pairs x WHERE x.receipt_id = p.receipt_id) = 1
     AND (SELECT count(*) FROM pairs y WHERE y.log_id = p.log_id) = 1
)
UPDATE public.stock_receipts r
   SET supplier_name = trim(coalesce(r.supplier_name, 'Inward Delivery')) || ' [Ref: ' || up.ref || ']'
  FROM unique_pairs up
 WHERE r.id = up.receipt_id;

COMMIT;

-- CHECK: receipts still without a reference tag (these could not be matched safely; the app still shows them)
SELECT count(*) AS receipts_without_reference
  FROM public.stock_receipts
 WHERE coalesce(supplier_name, '') NOT ILIKE '%[Ref:%';
