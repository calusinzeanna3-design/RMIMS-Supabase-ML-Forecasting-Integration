-- ============================================================
-- RMIMS ADMIN AUDIT & SECURITY FIX MIGRATION
-- ============================================================
BEGIN;

-- 1. Helper: is the current auth user an active account?
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
          AND status = 'active'
    );
$$;

-- 2. Guardrail: Non-admin users cannot escalate their own role or status
CREATE OR REPLACE FUNCTION public.prevent_user_self_elevation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.is_active_admin() THEN
        IF NEW.role <> OLD.role OR NEW.status <> OLD.status THEN
            RAISE EXCEPTION 'Unauthorized: Non-admins cannot modify account role or status.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_user_self_elevation ON public.users;
CREATE TRIGGER trg_prevent_user_self_elevation
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.prevent_user_self_elevation();

-- 3. Database-level non-negative check constraints on materials
ALTER TABLE public.materials
    DROP CONSTRAINT IF EXISTS check_materials_quantity_non_negative,
    ADD CONSTRAINT check_materials_quantity_non_negative CHECK (quantity >= 0);

ALTER TABLE public.materials
    DROP CONSTRAINT IF EXISTS check_materials_threshold_non_negative,
    ADD CONSTRAINT check_materials_threshold_non_negative CHECK (minimum_threshold >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_name_unique ON public.materials (lower(trim(material_name)));

-- 4. Operational Table RLS Policies (Restricted to ACTIVE users)
DROP POLICY IF EXISTS "materials_all_authenticated" ON public.materials;
CREATE POLICY "materials_all_authenticated"
    ON public.materials FOR ALL
    USING (public.is_active_user())
    WITH CHECK (public.is_active_user());

DROP POLICY IF EXISTS "usage_records_all_authenticated" ON public.usage_records;
CREATE POLICY "usage_records_all_authenticated"
    ON public.usage_records FOR ALL
    USING (public.is_active_user())
    WITH CHECK (public.is_active_user());

DROP POLICY IF EXISTS "stock_receipts_all_authenticated" ON public.stock_receipts;
CREATE POLICY "stock_receipts_all_authenticated"
    ON public.stock_receipts FOR ALL
    USING (public.is_active_user())
    WITH CHECK (public.is_active_user());

-- 5. ATOMIC INVENTORY TRANSACTIONS

-- Atomic Stock Receive
CREATE OR REPLACE FUNCTION public.record_stock_receipt_atomic(
    p_material_id text,
    p_quantity numeric,
    p_received_date date DEFAULT current_date,
    p_notes text DEFAULT null,
    p_recorded_by text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mat public.materials%rowtype;
    v_new_qty numeric;
    v_status text;
    v_receipt_id text;
BEGIN
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero.';
    END IF;

    SELECT * INTO v_mat
      FROM public.materials
     WHERE id = p_material_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Material not found.';
    END IF;

    v_new_qty := v_mat.quantity + p_quantity;

    IF v_new_qty <= v_mat.minimum_threshold / 2 THEN
        v_status := 'Critical';
    ELSIF v_new_qty <= v_mat.minimum_threshold THEN
        v_status := 'Low';
    ELSE
        v_status := 'Available';
    END IF;

    UPDATE public.materials
       SET quantity = v_new_qty,
           status = v_status,
           updated_at = now()
     WHERE id = p_material_id;

    v_receipt_id := gen_random_uuid()::text;
    INSERT INTO public.stock_receipts (
        id, material_id, material_name, received_quantity, unit, received_date, notes, created_by
    ) VALUES (
        v_receipt_id, v_mat.id, v_mat.material_name, p_quantity, v_mat.unit, coalesce(p_received_date, current_date), p_notes, auth.uid()
    );

    RETURN jsonb_build_object(
        'success', true,
        'material_id', v_mat.id,
        'new_quantity', v_new_qty,
        'status', v_status,
        'receipt_id', v_receipt_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_stock_receipt_atomic TO authenticated;

-- Atomic Stock Usage
CREATE OR REPLACE FUNCTION public.record_stock_usage_atomic(
    p_material_id text,
    p_quantity numeric,
    p_usage_date date DEFAULT current_date,
    p_product_id text DEFAULT null,
    p_product_name text DEFAULT null,
    p_remarks text DEFAULT null,
    p_recorded_by text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mat public.materials%rowtype;
    v_new_qty numeric;
    v_status text;
    v_usage_id text;
BEGIN
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Usage quantity must be greater than zero.';
    END IF;

    SELECT * INTO v_mat
      FROM public.materials
     WHERE id = p_material_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Material not found.';
    END IF;

    IF v_mat.quantity < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: %', v_mat.quantity, p_quantity;
    END IF;

    v_new_qty := v_mat.quantity - p_quantity;

    IF v_new_qty <= v_mat.minimum_threshold / 2 THEN
        v_status := 'Critical';
    ELSIF v_new_qty <= v_mat.minimum_threshold THEN
        v_status := 'Low';
    ELSE
        v_status := 'Available';
    END IF;

    UPDATE public.materials
       SET quantity = v_new_qty,
           status = v_status,
           updated_at = now()
     WHERE id = p_material_id;

    v_usage_id := gen_random_uuid()::text;
    INSERT INTO public.usage_records (
        id, material_id, material_name, used_quantity, unit, usage_date, remarks, product_id, product_name, created_by
    ) VALUES (
        v_usage_id, v_mat.id, v_mat.material_name, p_quantity, v_mat.unit, coalesce(p_usage_date, current_date), p_remarks, p_product_id, p_product_name, auth.uid()
    );

    RETURN jsonb_build_object(
        'success', true,
        'material_id', v_mat.id,
        'new_quantity', v_new_qty,
        'status', v_status,
        'usage_id', v_usage_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_stock_usage_atomic TO authenticated;

-- 6. SYSTEM ACTIVITY LOG & ATOMIC DATA RESET
CREATE TABLE IF NOT EXISTS public.system_activity_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    admin_name  text,
    admin_email text,
    action      text NOT NULL,
    details     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_activity_log_created_at ON public.system_activity_log (created_at DESC);
ALTER TABLE public.system_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_activity_log_select_admin" ON public.system_activity_log;
CREATE POLICY "system_activity_log_select_admin"
    ON public.system_activity_log FOR SELECT
    USING (public.is_active_admin());

DROP POLICY IF EXISTS "system_activity_log_insert_admin" ON public.system_activity_log;
CREATE POLICY "system_activity_log_insert_admin"
    ON public.system_activity_log FOR INSERT
    WITH CHECK (public.is_active_admin());

CREATE OR REPLACE FUNCTION public.reset_system_data(scopes text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    counts jsonb := '{}'::jsonb;
    n      int;
BEGIN
    IF NOT public.is_active_admin() THEN
        RAISE EXCEPTION 'Only an active Admin may reset system data.';
    END IF;

    IF scopes IS NULL OR array_length(scopes, 1) IS NULL THEN
        RAISE EXCEPTION 'No reset scope specified.';
    END IF;

    IF 'users' = ANY(scopes) OR 'system_activity_log' = ANY(scopes) OR 'backup_history' = ANY(scopes) THEN
        RAISE EXCEPTION 'User accounts, the audit log, and backup history cannot be reset from here.';
    END IF;

    IF 'materials' = ANY(scopes) OR 'finished_products' = ANY(scopes) THEN
        SELECT count(*) INTO n FROM public.product_material_requirements;
        counts := counts || jsonb_build_object('product_material_requirements', n);
        DELETE FROM public.product_material_requirements;
    END IF;

    IF 'stock_receipts' = ANY(scopes) THEN
        SELECT count(*) INTO n FROM public.stock_receipts;
        counts := counts || jsonb_build_object('stock_receipts', n);
        DELETE FROM public.stock_receipts;
    END IF;

    IF 'usage_records' = ANY(scopes) THEN
        SELECT count(*) INTO n FROM public.usage_records;
        counts := counts || jsonb_build_object('usage_records', n);
        DELETE FROM public.usage_records;
    END IF;

    IF 'finished_products' = ANY(scopes) THEN
        SELECT count(*) INTO n FROM public.finished_products;
        counts := counts || jsonb_build_object('finished_products', n);
        DELETE FROM public.finished_products;
    END IF;

    IF 'materials' = ANY(scopes) THEN
        SELECT count(*) INTO n FROM public.materials;
        counts := counts || jsonb_build_object('materials', n);
        DELETE FROM public.materials;
    END IF;

    INSERT INTO public.system_activity_log (admin_id, admin_name, admin_email, action, details)
    SELECT auth.uid(), coalesce(u.full_name, 'Administrator'), u.email, 'Reset system data', jsonb_build_object('scopes', to_jsonb(scopes), 'record_counts', counts)
    FROM public.users u WHERE u.id = auth.uid();

    RETURN counts;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_system_data(text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.reset_system_data(text[]) TO authenticated;

COMMIT;
