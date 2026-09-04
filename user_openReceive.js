function openReceiveModal(preselectedMatId = null, preselectedProduct = null, allowedMaterialIds = null) {
    const overlay = document.getElementById("maReceiveModalOverlay");
    const form = document.getElementById("maReceiveForm");
    const titleEl = document.getElementById("maReceiveModalTitle");
    const subtitleEl = document.getElementById("maReceiveModalSubtitle");

    const pkgWrap = document.getElementById("maReceivePackageWrap");
    const singleWrap = document.getElementById("maReceiveSingleWrap");

    const matSelect = document.getElementById("maReceiveMaterialSelect");
    const matDisplayWrap = document.getElementById("maReceiveMaterialDisplayWrap");
    const matAvatar = document.getElementById("maReceiveMatAvatar");
    const matNameDisplay = document.getElementById("maReceiveMatNameDisplay");
    const matCodeDisplay = document.getElementById("maReceiveMatCodeDisplay");
    const matStockDisplay = document.getElementById("maReceiveMatStockDisplay");

    const qtyInput = document.getElementById("maReceiveQuantityInput");
    const unitInput = document.getElementById("maReceiveUnitDisplay");
    const supplierInput = document.getElementById("maReceiveSupplierInput");
    const prodInput = document.getElementById("maReceiveProductContextInput");
    const dateInput = document.getElementById("maReceiveDateInput");

    if (!overlay) return;

    if (form) form.reset();
    clearModalErrors("maReceive");

    const todayStr = new Date().toISOString().slice(0, 10);
    if (dateInput) {
        if (dateInput._flatpickr) {
            dateInput._flatpickr.setDate(todayStr, true);
        } else {
            dateInput.value = todayStr;
        }
    }

    if (preselectedProduct) {
        // PACKAGE MODE (Finished Product Card action)
        currentReceiveMode = "package";
        let prod = state.finishedProducts.find(p => p.name.toLowerCase() === preselectedProduct.toLowerCase() || String(p.id) === String(preselectedProduct));
        if (!prod) {
            prod = {
                id: "fp_" + preselectedProduct.toLowerCase().replace(/[^a-z0-9]/g, "_"),
                name: preselectedProduct,
                materialIds: allowedMaterialIds || []
            };
        } else if (allowedMaterialIds && allowedMaterialIds.length > 0 && (!prod.materialIds || prod.materialIds.length === 0)) {
            prod.materialIds = allowedMaterialIds;
        }
        currentReceiveProduct = prod;

        if (pkgWrap) pkgWrap.style.display = "block";
        if (singleWrap) singleWrap.style.display = "none";

        if (titleEl) titleEl.textContent = `Receive Package — ${prod.name}`;
        if (subtitleEl) subtitleEl.textContent = `Replenish all bundled raw materials for ${prod.name}`;

        const pkgTitle = document.getElementById("maReceivePackageTitle");
        const pkgAvatar = document.getElementById("maReceivePackageAvatar");
        const pkgCountInput = document.getElementById("maReceivePackageCountInput");

        if (pkgTitle) pkgTitle.textContent = prod.name;
        if (pkgAvatar) pkgAvatar.textContent = getInitials(prod.name);
        if (pkgCountInput) pkgCountInput.value = "1";

        renderReceivePackageTable(1);
    } else {
        // SINGLE MATERIAL MODE (Material Overview Table action)
        currentReceiveMode = "single";
        currentReceiveProduct = null;

        if (pkgWrap) pkgWrap.style.display = "none";
        if (singleWrap) singleWrap.style.display = "block";

        if (titleEl) titleEl.textContent = "Record Stock Receipt";
        if (subtitleEl) subtitleEl.textContent = "Record individual raw material inflow";

        if (qtyInput) qtyInput.value = "1";

        const availableMats = (allowedMaterialIds && allowedMaterialIds.length > 0)
            ? state.materials.filter(m => allowedMaterialIds.includes(m.id))
            : state.materials;

        if (matSelect) {
            matSelect.innerHTML = `<option value="">Select Raw Material...</option>` + availableMats.map(m => `
                <option value="${escapeHtml(m.id)}" data-unit="${escapeHtml(m.unit_of_measure || "kg")}" data-stock="${m.current_stock}">
                    ${escapeHtml(m.name)} (${escapeHtml(m.item_code || "RM—")}) — Available: ${formatQty(m.current_stock, m.unit_of_measure)}
                </option>
            `).join("");

            matSelect.onchange = () => {
                const activeId = matSelect.value;
                const opt = matSelect.selectedOptions[0];
                const unit = opt ? opt.getAttribute("data-unit") : "kg";
                if (unitInput) unitInput.value = unit || "kg";
                if (prodInput) {
                    const linked = state.finishedProducts.filter(p => p.materialIds && p.materialIds.includes(activeId));
                    prodInput.value = linked.length > 0 ? linked.map(p => p.name).join(", ") : "Unassigned / General Stock";
                }
                updateReceiveLivePreview();
            };
        }

        let activeMatId = preselectedMatId;
        if (preselectedMatId) {
            const mat = state.materials.find(m => m.id === preselectedMatId);
            if (mat) {
                if (matSelect) {
                    matSelect.value = mat.id;
                    matSelect.style.display = "none";
                }
                if (matDisplayWrap) {
                    matDisplayWrap.style.display = "block";
                    if (matAvatar) matAvatar.textContent = getInitials(mat.name);
                    if (matNameDisplay) matNameDisplay.textContent = mat.name;
                    if (matCodeDisplay) matCodeDisplay.textContent = mat.item_code || "RM—";
                    if (matStockDisplay) matStockDisplay.textContent = formatQty(mat.current_stock, mat.unit_of_measure);
                }
                if (unitInput) unitInput.value = mat.unit_of_measure || "kg";
                if (prodInput) {
                    const linked = state.finishedProducts.filter(p => p.materialIds && p.materialIds.includes(mat.id));
                    prodInput.value = linked.length > 0 ? linked.map(p => p.name).join(", ") : "Unassigned / General Stock";
                }
            }
        } else {
            if (matSelect) {
                matSelect.style.display = "block";
                if (availableMats.length > 0) {
                    matSelect.value = availableMats[0].id;
                    activeMatId = availableMats[0].id;
                    if (unitInput) unitInput.value = availableMats[0].unit_of_measure || "kg";
                    if (prodInput) {
                        const linked = state.finishedProducts.filter(p => p.materialIds && p.materialIds.includes(availableMats[0].id));
                        prodInput.value = linked.length > 0 ? linked.map(p => p.name).join(", ") : "Unassigned / General Stock";
                    }
                }
            }
            if (matDisplayWrap) matDisplayWrap.style.display = "none";
        }

        updateReceiveLivePreview();
    }

    overlay.classList.add("open", "active");
}