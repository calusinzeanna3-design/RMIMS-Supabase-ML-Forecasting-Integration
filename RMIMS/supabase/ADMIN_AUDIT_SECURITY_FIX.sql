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

COMMIT;
