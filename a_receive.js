async function handleSaveReceive() {
    clearModalErrors("maReceive");

    const dateInput = document.getElementById("maReceiveDateInput");
    const supplierInput = document.getElementById("maReceiveSupplierInput");
    const date = dateInput ? dateInput.value : "";
    const supplier = supplierInput ? supplierInput.value.trim() : "";

    if (!date) {
        setFieldError("maReceiveDateError", "Receipt date is required.");
        return;
    }

    if (currentReceiveMode === "package") {
        if (!currentReceiveProduct) return;
        const countInput = document.getElementById("maReceivePackageCountInput");
        const pkgCount = Math.max(1, parseInt(countInput?.value) || 1);

        const matItems = (currentReceiveProduct.materialIds || [])
            .map(id => state.materials.find(m => String(m.id) === String(id)))
            .filter(Boolean);

        if (matItems.length === 0) {
            toast("No raw materials found in this product bundle to receive.", "error");
            return;
        }

        const supplierName = supplier || `${currentReceiveProduct.name} Package Batch`;
        const nowIso = new Date().toISOString();
        const newReceipts = [];
        const stockUpdates = [];

        // 1. Instant Optimistic Local Update
        matItems.forEach(mat => {
            const minStock = Number(mat.minimum_threshold) || 0;
            const baseQty = minStock > 0 ? minStock : 10;
            const qtyToAdd = baseQty * pkgCount;
            const newStock = (Number(mat.current_stock) || 0) + qtyToAdd;

            mat.current_stock = newStock;

            const recObj = {
                id: `rec-pkg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                material_id: mat.id,
                receipt_date: date,
                received_quantity: qtyToAdd,
                unit: mat.unit_of_measure || "kg",
                supplier_name: supplierName,
                created_at: nowIso
            };
            newReceipts.push(recObj);
            stockUpdates.push({ id: mat.id, stock: newStock });
        });

        state.stockReceipts = [...newReceipts, ...state.stockReceipts];
        newReceipts.forEach(r => saveCustomReceipt(r));
        invalidateForecastCache();
        buildUnifiedActivities();
        renderCard1();
        renderCard2History();

        // 2. Immediate feedback & Close Modal (<50ms response)
        toast(`Received ${pkgCount} package(s) of ${currentReceiveProduct.name} (${matItems.length} ingredients restocked ahead of minimum stock)`, "success");
        closeReceiveModal();

        // 3. Local sync broadcast
        try {
            localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "receive_package", product: currentReceiveProduct.name, pkgCount }));
            localStorage.setItem("rmims_inventory_updated", Date.now().toString());
        } catch {}

        if (window.RMIMS_NOTIFICATIONS?.addNotification) {
            window.RMIMS_NOTIFICATIONS.addNotification({
                id: `notif-rcv-pkg-${Date.now()}`,
                category: 'receiving',
                priority: 'success',
                title: 'Package Received',
                message: `${currentReceiveProduct.name} package received (${pkgCount} batch, ${matItems.length} materials replenished).`,
                actor: `Source: Material Activity (${getUserDisplayName()})`,
                roleScope: 'all',
                timestamp: nowIso
            });
        }

        // 4. Background Database Batch Persistence (High-speed bulk insert & parallel stock updates)
        (async () => {
            try {
                const insertPayload = newReceipts.map(r => ({
                    material_id: r.material_id,
                    receipt_date: r.receipt_date,
                    received_quantity: r.received_quantity,
                    unit: r.unit,
                    supplier_name: r.supplier_name,
                    created_at: r.created_at
                }));
                await supabase.from("stock_receipts").insert(insertPayload);

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
    const matSelect = document.getElementById("maReceiveMaterialSelect");
    const qtyInput = document.getElementById("maReceiveQuantityInput");
    const matId = matSelect ? matSelect.value : "";
    const qty = Number(qtyInput ? qtyInput.value : 0);

    let hasError = false;
    if (!matId) {
        setFieldError("maReceiveMaterialError", "Please select a raw material.");
        hasError = true;
    }
    if (!qty || isNaN(qty) || qty <= 0) {
        setFieldError("maReceiveQuantityError", "Quantity must be greater than 0.");
        hasError = true;
    }

    if (hasError) return;

    const mat = state.materials.find(m => String(m.id) === String(matId));
    if (!mat) return;

    const supplierName = supplier || "Direct Inward Delivery";
    const nowIso = new Date().toISOString();
    const newStock = (Number(mat.current_stock) || 0) + qty;

    // 1. Optimistic Local Update
    mat.current_stock = newStock;
    const newRec = {
        id: `rec-sng-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        material_id: mat.id,
        receipt_date: date,
        received_quantity: qty,
        unit: mat.unit_of_measure || "kg",
        supplier_name: supplierName,
        created_at: nowIso
    };
    state.stockReceipts = [newRec, ...state.stockReceipts];
    saveCustomReceipt(newRec);
    invalidateForecastCache();
    buildUnifiedActivities();
    renderCard1();
    renderCard2History();

    // 2. Immediate feedback & Close Modal
    toast(`Received ${formatQty(qty, mat.unit_of_measure)} of ${mat.name}`, "success");
    closeReceiveModal();

    // 3. Local sync
    try {
        localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "receive", materialId: matId, qty }));
        localStorage.setItem("rmims_inventory_updated", Date.now().toString());
    } catch {}

    if (window.RMIMS_NOTIFICATIONS?.addNotification) {
        window.RMIMS_NOTIFICATIONS.addNotification({
            id: `notif-rcv-mat-${Date.now()}`,
            category: 'receiving',
            priority: 'success',
            title: 'Material Received',
            message: `${mat.name} received: ${qty} ${mat.unit_of_measure || "kg"}.`,
            actor: `Source: Material Activity (${getUserDisplayName()})`,
            roleScope: 'all',
            timestamp: nowIso
        });
    }

    // 4. Background Database Persistence
    (async () => {
        try {
            await supabase.from("stock_receipts").insert([{
                material_id: mat.id,
                receipt_date: date,
                received_quantity: qty,
                unit: mat.unit_of_measure || "kg",
                supplier_name: supplierName,
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