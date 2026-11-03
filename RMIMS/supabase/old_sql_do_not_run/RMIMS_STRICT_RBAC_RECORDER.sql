-- ============================================================================
-- RMIMS — STRICT RBAC: ONLY STORE OPERATIONS RECORD RAW-MATERIAL MOVEMENTS
-- ============================================================================
-- Run once in the Supabase SQL editor (safe to re-run).
--
-- Administrators manage the SYSTEM (accounts, branches, alerts). They do not operate raw materials,
-- so a stock receipt or disbursement may never be recorded under an admin account.
-- Store staff submit, the Store Manager approves / records; "Recorded By" always names one of them.
--
-- Rows inserted from the SQL editor / seed scripts (no signed-in user, auth.uid() IS NULL) are allowed,
-- so imports and resets keep working.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.block_admin_raw_material_recording()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NOT NULL
       AND public.is_super_admin()
       AND NOT public.is_manager_user() THEN
        RAISE EXCEPTION 'RBAC: Administrator accounts cannot record raw-material movements. Ask the branch Store Manager or Staff to record it.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_admin_stock_receipts ON public.stock_receipts;
CREATE TRIGGER trg_block_admin_stock_receipts
BEFORE INSERT ON public.stock_receipts
FOR EACH ROW EXECUTE FUNCTION public.block_admin_raw_material_recording();

DROP TRIGGER IF EXISTS trg_block_admin_material_disbursements ON public.material_disbursements;
CREATE TRIGGER trg_block_admin_material_disbursements
BEFORE INSERT ON public.material_disbursements
FOR EACH ROW EXECUTE FUNCTION public.block_admin_raw_material_recording();

NOTIFY pgrst, 'reload schema';
