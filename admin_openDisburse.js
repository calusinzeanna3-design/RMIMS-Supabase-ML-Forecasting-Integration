function openDisburseModal(preselectedMatId = null, preselectedProduct = null, allowedMaterialIds = null) {
    const overlay = document.getElementById("maDisburseModalOverlay");
    const form = document.getElementById("maDisburseForm");
    const titleEl = document.getElementById("maDisburseModalTitle");
    const subtitleEl = document.getElementById("maDisburseModalSubtitle");

    const pkgWrap = document.getElementById("maDisbursePackageWrap");
    const singleWrap = document.getElementById("maDisburseSingleWrap");

    const matSelect = document.getElementById("maDisburseMaterialSelect");
    const matDisplayWrap = document.getElementById("maDisburseMaterialDisplayWrap");
    const matAvatar = document.getElementById("maDisburseMatAvatar");
    const matNameDisplay = document.getElementById("maDisburseMatNameDisplay");
    const matCodeDisplay = document.getElementById("maDisburseMatCodeDisplay");
    const matStockDisplay = document.getElementById("maDisburseMatStockDisplay");

    const qtyInput = document.getElementById("maDisburseQuantityInput");
    const unitInput = document.getElementById("maDisburseUnitDisplay");
    const prodInput = document.getElementById("maDisburseProductSelect");
    const dateInput = document.getElementById("maDisburseDateInput");

    if (!overlay) return;

    if (form) form.reset();
    clearModalErrors("maDisburse");

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
        currentDisburseMode = "package";
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
        currentDisburseProduct = prod;

        if (pkgWrap) pkgWrap.style.display = "block";
        if (singleWrap) singleWrap.style.display = "none";

        if (titleEl) titleEl.textContent = `Disburse Package — ${prod.name}`;
        if (subtitleEl) subtitleEl.textContent = `Deduct batch ingredients for ${prod.name}`;

        const pkgTitle = document.getElementById("maDisbursePackageTitle");
        const pkgAvatar = document.getElementById("maDisbursePackageAvatar");
        const pkgCountInput = document.getElementById("maDisbursePackageCountInput");

        if (pkgTitle) pkgTitle.textContent = prod.name;
        if (pkgAvatar) pkgAvatar.textContent = initials(prod.name);
        if (pkgCountInput) pkgCountInput.value = "1";

        renderDisbursePackageTable(1);
    } else {
        // SINGLE MATERIAL MODE (Material Overview Table action)
        currentDisburseMode = "single";
        currentDisburseProduct = null;

        if (pkgWrap) pkgWrap.style.display = "none";
        if (singleWrap) singleWrap.style.display = "block";

        if (titleEl) titleEl.textContent = "Record Material Disbursement";
        if (subtitleEl) subtitleEl.textContent = "Record individual raw material usage";

        if (qtyInput) {
            qtyInput.value = "1";
            qtyInput.oninput = updateDisburseLivePreview;
        }

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
                    prodInput.value = linked.length > 0 ? linked[0].name : "General Usage";
                }
                updateDisburseLivePreview();
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
                    if (matAvatar) matAvatar.textContent = initials(mat.name);
                    if (matNameDisplay) matNameDisplay.textContent = mat.name;
                    if (matCodeDisplay) matCodeDisplay.textContent = mat.item_code || "RM—";
                    if (matStockDisplay) matStockDisplay.textContent = formatQty(mat.current_stock, mat.unit_of_measure);
                }
                if (unitInput) unitInput.value = mat.unit_of_measure || "kg";
                if (prodInput) {
                    const linked = state.finishedProducts.filter(p => p.materialIds && p.materialIds.includes(mat.id));
                    prodInput.value = linked.length > 0 ? linked[0].name : "General Usage";
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
                        prodInput.value = linked.length > 0 ? linked[0].name : "General Usage";
                    }
                }
            }
            if (matDisplayWrap) matDisplayWrap.style.display = "none";
        }

        updateDisburseLivePreview();
    }

    overlay.classList.add("open", "active");
}