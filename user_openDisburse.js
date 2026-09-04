function openDisburseModal(preselectedMatId = null, preselectedProduct = null, allowedMaterialIds = null) {
    const overlay = document.getElementById("maDisburseModalOverlay");
    const form = document.getElementById("maDisburseForm");
    const titleEl = document.getElementById("maDisburseModalTitle");
    const subtitleEl = document.getElementById("maDisburseModalSubtitle");

    const pkgWrap = document.getElementById("maDisbursePackageWrap");
    const singleWrap = document.getElementById("maDisburseSingleWrap");
    const pkgName = document.getElementById("maDisbursePackageName");
    const pkgCountInput = document.getElementById("maDisbursePackageCountInput");
    const dateInput = document.getElementById("maDisburseDateInput");
    const notesInput = document.getElementById("maDisburseNotesInput");
    const submitBtn = document.getElementById("maDisburseSaveBtn");

    if (!overlay) return;

    clearModalErrors("maDisburse");
    if (form) form.reset();

    const todayStr = new Date().toISOString().slice(0, 10);
    if (dateInput) dateInput.value = todayStr;
    if (notesInput) notesInput.value = "";
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Save Disbursement";
    }

    if (preselectedProduct) {
        currentDisburseMode = "package";
        currentDisburseProduct = preselectedProduct;

        if (pkgWrap) pkgWrap.style.display = "block";
        if (singleWrap) singleWrap.style.display = "none";

        if (titleEl) titleEl.textContent = `Disburse Package — ${preselectedProduct.name}`;
        if (subtitleEl) subtitleEl.textContent = `Deduct all bundled recipe ingredients for ${preselectedProduct.name}`;
        if (pkgName) pkgName.textContent = preselectedProduct.name;
        if (pkgCountInput) pkgCountInput.value = "1";

        renderDisbursePackageTable();
    } else {
        currentDisburseMode = "single";
        currentDisburseProduct = null;

        if (pkgWrap) pkgWrap.style.display = "none";
        if (singleWrap) singleWrap.style.display = "block";

        if (titleEl) titleEl.textContent = "Disburse Raw Material";
        if (subtitleEl) subtitleEl.textContent = "Record outbound inventory deduction for production or usage";

        const matSelect = document.getElementById("maDisburseMaterialSelect");
        const displayWrap = document.getElementById("maDisburseMaterialDisplayWrap");
        const matAvatar = document.getElementById("maDisburseMatAvatar");
        const matNameEl = document.getElementById("maDisburseMatNameDisplay");
        const matCodeEl = document.getElementById("maDisburseMatCodeDisplay");
        const matStockEl = document.getElementById("maDisburseMatStockDisplay");
        const prodInput = document.getElementById("maDisburseProductSelect");

        if (preselectedMatId) {
            const mat = state.materials.find(m => String(m.id) === String(preselectedMatId));
            if (matSelect) {
                matSelect.style.display = "none";
                matSelect.value = preselectedMatId;
            }
            if (displayWrap) displayWrap.style.display = "block";
            if (matAvatar) matAvatar.textContent = (mat?.name || "RM").slice(0, 2).toUpperCase();
            if (matNameEl) matNameEl.textContent = mat?.name || "Raw Material";
            if (matCodeEl) matCodeEl.textContent = mat?.item_code || "RM—";
            if (matStockEl) matStockEl.textContent = `${formatQty(mat?.current_stock || 0, mat?.unit_of_measure || "kg")}`;

            const unitDisplay = document.getElementById("maDisburseUnitDisplay");
            if (unitDisplay && mat) unitDisplay.value = mat.unit_of_measure || "kg";

            if (prodInput) {
                const linkedProds = state.finishedProducts.filter(p => p.materialIds && p.materialIds.map(String).includes(String(preselectedMatId)));
                prodInput.value = linkedProds.length > 0 ? linkedProds.map(p => p.name).join(", ") : "General Usage";
            }
        } else {
            if (matSelect) {
                matSelect.style.display = "block";
                matSelect.value = "";
            }
            if (displayWrap) displayWrap.style.display = "none";
            if (prodInput) prodInput.value = "General Usage";
        }

        updateDisburseStockPreview();
    }

    overlay.classList.add("open", "active");
}