function renderDisbursePackageTable(pkgCount = 1) {
    const tbody = document.getElementById("maDisbursePackageTableBody");
    if (!tbody || !currentDisburseProduct) return;

    const matItems = (currentDisburseProduct.materialIds || [])
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
        // Usage per batch formula:
        const baseUsage = Math.max(1, Math.round((minStock > 0 ? minStock : 10) * 0.5));
        const qtyToDeduct = baseUsage * pkgCount;
        const remaining = Math.max(0, curStock - qtyToDeduct);
        const isExceeded = qtyToDeduct > curStock;

        return `
            <tr class="${isExceeded ? 'pkg-row-exceeded' : ''}">
                <td><strong>${escapeHtml(mat.name)}</strong></td>
                <td><span class="mat-id-badge">${escapeHtml(mat.item_code || "RM—")}</span></td>
                <td><strong>${formatQty(curStock, unit)}</strong></td>
                <td><span style="color: var(--rm-ink-dim); font-weight: 500;">${formatQty(minStock, unit)}</span></td>
                <td><strong style="color: #ea580c; font-weight: 800;">−${formatQty(qtyToDeduct, unit)}</strong></td>
                <td>
                    ${isExceeded 
                        ? `<span style="color: #dc2626; font-weight: 800;">⚠️ Short (${formatQty(curStock, unit)})</span>` 
                        : `<strong style="color: #d97706;">${formatQty(remaining, unit)}</strong>`
                    }
                </td>
            </tr>
        `;
    }).join("");
}