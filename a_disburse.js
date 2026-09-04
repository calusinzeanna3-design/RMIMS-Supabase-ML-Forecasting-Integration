async function handleSaveDisburse() {
    clearModalErrors("maDisburse");

    const dateInput = document.getElementById("maDisburseDateInput");
    const notesInput = document.getElementById("maDisburseNotesInput");
    const date = dateInput ? dateInput.value : "";
    const notes = notesInput ? notesInput.value.trim() : "";

    if (!date) {
        setFieldError("maDisburseDateError", "Disbursement date is required.");
        return;
    }

    if (currentDisburseMode === "package") {
        if (!currentDisburseProduct) return;
        const countInput = document.getElementById("maDisbursePackageCountInput");
        const pkgCount = Math.max(1, parseInt(countInput?.value) || 1);

        const matItems = (currentDisburseProduct.materialIds || [])
            .map(id => state.materials.find(m => String(m.id) === String(id)))
            .filter(Boolean);

        if (matItems.length === 0) {
            toast("No raw materials found in this product bundle to disburse.", "error");
            return;
        }

        // Validate stock sufficiency for all materials
        for (const mat of matItems) {
            const minStock = Number(mat.minimum_threshold) || 0;
            const baseUsage = Math.max(1, Math.round((minStock > 0 ? minStock : 10) * 0.5));
            const qtyToDeduct = baseUsage * pkgCount;
            const curStock = Number(mat.current_stock) || 0;
            if (qtyToDeduct > curStock) {
                toast(`Insufficient stock for ${mat.name}. Requires ${formatQty(qtyToDeduct, mat.unit_of_measure)}, available: ${formatQty(curStock, mat.unit_of_measure)}.`, "error");
                return;
            }
        }

        const nowIso = new Date().toISOString();
        const newDisbursements = [];
        const stockUpdates = [];

        // 1. Instant Optimistic Local Update
        matItems.forEach(mat => {
            const minStock = Number(mat.minimum_threshold) || 0;
            const baseUsage = Math.max(1, Math.round((minStock > 0 ? minStock : 10) * 0.5));
            const qtyToDeduct = baseUsage * pkgCount;
            const newStock = Math.max(0, (Number(mat.current_stock) || 0) - qtyToDeduct);

            mat.current_stock = newStock;

            const dsbObj = {
                id: `dsb-pkg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                material_id: mat.id,
                usage_date: date,
                consumed_quantity: qtyToDeduct,
                unit: mat.unit_of_measure || "kg",
                activity_type: currentDisburseProduct.name,
                finished_product_name: currentDisburseProduct.name,
                created_at: nowIso
            };
            newDisbursements.push(dsbObj);
            stockUpdates.push({ id: mat.id, stock: newStock });
        });

        state.disbursements = [...newDisbursements, ...state.disbursements];
        newDisbursements.forEach(d => saveCustomDisbursement(d));
        invalidateForecastCache();
        buildUnifiedActivities();
        renderCard1();
        renderCard2History();

        // 2. Immediate feedback & Close Modal
        toast(`Disbursed ${pkgCount} package(s) for ${currentDisburseProduct.name} (${matItems.length} ingredients deducted)`, "success");
        closeDisburseModal();

        // 3. Local sync broadcast
        try {
            localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "disburse_package", product: currentDisburseProduct.name, pkgCount }));
            localStorage.setItem("rmims_inventory_updated", Date.now().toString());
        } catch {}

        if (window.RMIMS_NOTIFICATIONS?.addNotification) {
            window.RMIMS_NOTIFICATIONS.addNotification({
                id: `notif-disb-pkg-${Date.now()}`,
                category: 'disbursement',
                priority: 'info',
                title: 'Package Disbursed',
                message: `${currentDisburseProduct.name} package disbursed (${pkgCount} batch, ${matItems.length} materials consumed).`,
                actor: `Source: Material Activity (${getUserDisplayName()})`,
                roleScope: 'all',
                timestamp: nowIso
            });
        }

        // 4. Background Database Batch Persistence (High-speed bulk insert & parallel stock updates)
        (async () => {
            try {
                const insertPayload = newDisbursements.map(d => ({
                    material_id: d.material_id,
                    usage_date: d.usage_date,
                    consumed_quantity: d.consumed_quantity,
                    unit: d.unit,
                    activity_type: d.activity_type,
                    finished_product_name: d.finished_product_name,
                    created_at: d.created_at
                }));
                await supabase.from("material_disbursements").insert(insertPayload);

                await Promise.allSettled(stockUpdates.map(u => 
                    supabase.from("raw_materials").update({
                        current_stock: u.stock,
                        updated_at: new Date().toISOString()
                    }).eq("id", u.id)
                ));
            } catch (err) {
                console.warn("Background persistence notice:", err);
            }
        })();

        return;
    }

    // SINGLE MATERIAL MODE
    const matSelect = document.getElementById("maDisburseMaterialSelect");
    const qtyInput = document.getElementById("maDisburseQuantityInput");
    const prodInput = document.getElementById("maDisburseProductSelect");
    const matId = matSelect ? matSelect.value : "";
    const qty = Number(qtyInput ? qtyInput.value : 0);
    const productContext = prodInput ? (prodInput.value.trim() || "General Usage") : "General Usage";

    const mat = state.materials.find(m => String(m.id) === String(matId));

    let hasError = false;
    if (!matId || !mat) {
        setFieldError("maDisburseMaterialError", "Please select a raw material.");
        hasError = true;
    }
    if (!qty || isNaN(qty) || qty <= 0) {
        setFieldError("maDisburseQuantityError", "Quantity must be greater than 0.");
        hasError = true;
    }
    if (mat && qty > Number(mat.current_stock)) {
        setFieldError("maDisburseQuantityError", `Insufficient stock. Available: ${formatQty(mat.current_stock, mat.unit_of_measure)}.`);
        hasError = true;
    }

    if (hasError) return;

    const nowIso = new Date().toISOString();
    const newStock = Math.max(0, (Number(mat.current_stock) || 0) - qty);

    // 1. Optimistic Local Update
    mat.current_stock = newStock;
    const newDsb = {
        id: `dsb-sng-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        material_id: mat.id,
        usage_date: date,
        consumed_quantity: qty,
        unit: mat.unit_of_measure || "kg",
        activity_type: productContext,
        finished_product_name: productContext,
        created_at: nowIso
    };
    state.disbursements = [newDsb, ...state.disbursements];
    saveCustomDisbursement(newDsb);
    invalidateForecastCache();
    buildUnifiedActivities();
    renderCard1();
    renderCard2History();

    // 2. Immediate feedback & Close Modal
    toast(`Disbursed ${formatQty(qty, mat.unit_of_measure)} for ${productContext}`, "success");
    closeDisburseModal();

    // 3. Local sync
    try {
        localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "disburse", materialId: matId, qty, context: productContext }));
        localStorage.setItem("rmims_inventory_updated", Date.now().toString());
    } catch {}

    if (window.RMIMS_NOTIFICATIONS?.addNotification) {
        window.RMIMS_NOTIFICATIONS.addNotification({
            id: `notif-disb-mat-${Date.now()}`,
            category: 'disbursement',
            priority: 'info',
            title: 'Material Disbursed',
            message: `${mat.name} disbursed: ${qty} ${mat.unit_of_measure || "kg"} (for ${productContext}).`,
            actor: `Source: Material Activity (${getUserDisplayName()})`,
            roleScope: 'all',
            timestamp: nowIso
        });
    }

    // 4. Background Database Persistence
    (async () => {
        try {
            await supabase.from("material_disbursements").insert([{
                material_id: mat.id,
                usage_date: date,
                consumed_quantity: qty,
                unit: mat.unit_of_measure || "kg",
                activity_type: productContext,
                finished_product_name: productContext,
                created_at: nowIso
            }]);

            await supabase.from("raw_materials").update({
                current_stock: newStock,
                updated_at: new Date().toISOString()
            }).eq("id", mat.id);
        } catch (err) {
            console.warn("Background persistence notice:", err);
        }
    })();
}