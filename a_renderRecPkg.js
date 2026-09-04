function renderReceivePackageTable(pkgCount = 1) {
    const tbody = document.getElementById("maReceivePackageTableBody");
    if (!tbody || !currentReceiveProduct) return;

    const matItems = (currentReceiveProduct.materialIds || [])
        .map(id => state.materials.find(m => String(m.id) === String(id)))
        .filter(Boolean);

    if (matItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--rm-ink-dim);">No raw materials mapped to this finished product package.</td></tr>`;
        return;
    }

    tbody.innerHTML = matItems.map(mat => {
        const curStock = Number(mat.current_stock) || 0;
        const minStock = Number(mat.minimum_threshold) || 0;
        const unit = mat.unit_of_measure || "kg";
        // Calculate quantity to add ahead of minimum threshold:
        const baseQty = minStock > 0 ? minStock : 10;
        const qtyToAdd = baseQty * pkgCount;
        const projected = curStock + qtyToAdd;

        return `
            <tr>
                <td><strong>${escapeHtml(mat.name)}</strong></td>
                <td><span class="mat-id-badge">${escapeHtml(mat.item_code || "RM—")}</span></td>
                <td>${formatQty(curStock, unit)}</td>
                <td><span style="color: var(--rm-ink-dim); font-weight: 500;">${formatQty(minStock, unit)}</span></td>
                <td><strong style="color: #16a34a; font-weight: 800;">+${formatQty(qtyToAdd, unit)}</strong></td>
                <td><strong style="color: #059669; font-weight: 800;">${formatQty(projected, unit)}</strong></td>
            </tr>
        `;
    }).join("");
}