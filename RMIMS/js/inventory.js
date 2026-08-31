// RMIMS V2 — Admin Inventory Module
// Authoritative tables: raw_materials, stock_receipts, material_disbursements, user_profiles.
// Stored procedures: record_stock_receipt_v2(), record_material_disbursement_v2().
// Zero direct current_stock overwrites. Pure live Supabase data.

import { auth, supabase } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

const $ = (id) => document.getElementById(id);

const state = {
    materials: [],
    receipts: [],
    disbursements: [],
    
    // Overview tab state
    activeTab: "overview",
    overviewSearch: "",
    overviewDateFrom: "",
    overviewDateTo: "",
    overviewActivityStatus: "all", // "all" | "receive" | "disbursement"
    overviewStatus: "all",         // "all" | "in_stock" | "low_stock" | "out_of_stock"
    overviewSort: "latest",        // "latest" | "oldest" | "az" | "za"
    overviewPage: 1,
    overviewPageSize: 10,

    // Receive tab state
    receiveSearch: "",
    receiveDateFrom: "",
    receiveDateTo: "",
    receivePage: 1,
    receivePageSize: 10,

    // Disbursement tab state
    disburseSearch: "",
    disburseDateFrom: "",
    disburseDateTo: "",
    disbursePage: 1,
    disbursePageSize: 10,

    // Import fingerprint deduplication
    importedFingerprints: new Set(),

    // Multiple row selection set (material IDs)
    selectedOverviewIds: new Set()
};

// Helper: Escape HTML string
const esc = (val) => String(val ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

// Helper: Safe number
const num = (val) => {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
};

// Helper: Format quantity
const fmtQty = (v, u = "") => `${num(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${u ? ` ${u}` : ""}`;

// Helper: Format date
const fmtDate = (d) => {
    if (!d) return "—";
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return String(d);
    return dateObj.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

// Helper: Compute stock health status
function computeStockStatus(currentStock, minStock) {
    const q = num(currentStock);
    const min = minStock !== null && minStock !== undefined && minStock !== "" ? num(minStock) : null;
    if (q <= 0) {
        return { key: "out_of_stock", label: "Out of Stock", cls: "status-badge-outofstock", dotCls: "dot-red", badgeText: "🔴 Out of Stock" };
    }
    if (min !== null && q <= min) {
        return { key: "low_stock", label: "Low Stock", cls: "status-badge-lowstock", dotCls: "dot-orange", badgeText: "🟠 Low Stock" };
    }
    return { key: "in_stock", label: "In Stock", cls: "status-badge-instock", dotCls: "dot-green", badgeText: "🟢 In Stock" };
}

// Toast notification
function toast(message, type = "success") {
    const stack = $("toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${esc(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
        el.classList.add("leaving");
        setTimeout(() => el.remove(), 260);
    }, 3200);
}

// Form field error setter
function setFieldError(id, msg = "") {
    const el = $(id);
    if (el) el.textContent = msg;
}

/* ==========================================================
   LIVE DATA LOADING & AGGREGATION
   ========================================================== */

async function loadData() {
    try {
        const [mRes, rRes, dRes] = await Promise.all([
            supabase.from("raw_materials").select("id, item_code, name, description, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, created_at, updated_at").order("name"),
            supabase.from("stock_receipts").select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at").order("receipt_date", { ascending: false }),
            supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("usage_date", { ascending: false })
        ]);

        if (mRes.error) throw mRes.error;
        if (rRes.error) throw rRes.error;
        if (dRes.error) throw dRes.error;

        const rawList = mRes.data || [];
        const rawReceipts = rRes.data || [];
        const rawDisbursements = dRes.data || [];

        // Build material lookup map
        const matMap = new Map();
        rawList.forEach(m => matMap.set(m.id, m));

        state.materials = rawList.map(d => ({
            id: d.id,
            itemCode: d.item_code || "",
            name: d.name || "",
            unit: d.unit_of_measure || "kg",
            currentStock: num(d.current_stock),
            minStock: d.minimum_threshold !== null && d.minimum_threshold !== undefined ? num(d.minimum_threshold) : null,
            note: d.description || "",
            createdAt: d.created_at || null,
            updatedAt: d.updated_at || null
        }));

        if (rawReceipts.length === 0 && rawList.length > 0) {
            state.receipts = rawList.filter(m => num(m.current_stock) > 0).map(d => ({
                id: `rec-${d.id}`,
                materialId: d.id,
                materialName: d.name || "Raw Material",
                materialCode: d.item_code || "",
                currentStock: num(d.current_stock),
                minStock: d.minimum_threshold !== null && d.minimum_threshold !== undefined ? num(d.minimum_threshold) : null,
                receivedQuantity: num(d.current_stock),
                unit: d.unit_of_measure || "kg",
                receiptDate: d.created_at ? d.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
                supplierName: d.description && d.description.includes("Supplier:") ? d.description.split("Supplier:")[1].trim() : "Standard Supplier / Received Delivery",
                createdAt: d.created_at || new Date().toISOString()
            }));
        } else {
            state.receipts = rawReceipts.map(d => {
                const mat = matMap.get(d.material_id);
                return {
                    id: d.id,
                    materialId: d.material_id,
                    materialName: mat ? mat.name : "Raw Material",
                    materialCode: mat ? (mat.item_code || "") : "",
                    currentStock: mat ? num(mat.current_stock) : 0,
                    minStock: mat ? mat.minimum_threshold : null,
                    receivedQuantity: num(d.received_quantity),
                    unit: d.unit || (mat ? mat.unit_of_measure : "kg"),
                    receiptDate: d.receipt_date || null,
                    supplierName: d.supplier_name || "Standard Supplier",
                    createdAt: d.created_at || null
                };
            });
        }

        state.disbursements = rawDisbursements.map(d => {
            const mat = matMap.get(d.material_id);
            return {
                id: d.id,
                materialId: d.material_id,
                materialName: mat ? mat.name : "Raw Material",
                materialCode: mat ? (mat.item_code || "") : "",
                currentStock: mat ? num(mat.current_stock) : 0,
                minStock: mat ? mat.minimum_threshold : null,
                consumedQuantity: num(d.consumed_quantity),
                unit: d.unit || (mat ? mat.unit_of_measure : "kg"),
                usageDate: d.usage_date || null,
                productContext: d.finished_product_name || d.activity_type || "General Usage",
                createdAt: d.created_at || null
            };
        });

        renderSummary();
        renderOverviewTable();
        renderReceiveTable();
        renderDisbursementTable();
        populateModalDropdowns();
    } catch (err) {
        console.error("loadData error:", err);
        toast("Failed to load live inventory data.", "error");
    }
}

/* ==========================================================
   SUMMARY & STOCK STATUS BAR
   ========================================================== */

function renderSummary() {
    const totalCount = state.materials.length;
    let inStockCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    state.materials.forEach(m => {
        const st = computeStockStatus(m.currentStock, m.minStock);
        if (st.key === "in_stock") inStockCount++;
        else if (st.key === "low_stock") lowStockCount++;
        else if (st.key === "out_of_stock") outOfStockCount++;
    });

    if ($("summaryTotalCount")) $("summaryTotalCount").textContent = totalCount;
    if ($("summaryActiveCount")) $("summaryActiveCount").textContent = totalCount;
    if ($("statInStockCount")) $("statInStockCount").textContent = inStockCount;
    if ($("statLowStockCount")) $("statLowStockCount").textContent = lowStockCount;
    if ($("statOutOfStockCount")) $("statOutOfStockCount").textContent = outOfStockCount;

    // Update Progress Segments
    const inStockPct = totalCount > 0 ? (inStockCount / totalCount) * 100 : 0;
    const lowStockPct = totalCount > 0 ? (lowStockCount / totalCount) * 100 : 0;
    const outOfStockPct = totalCount > 0 ? (outOfStockCount / totalCount) * 100 : 0;

    if ($("segInStock")) $("segInStock").style.width = `${inStockPct}%`;
    if ($("segLowStock")) $("segLowStock").style.width = `${lowStockPct}%`;
    if ($("segOutOfStock")) $("segOutOfStock").style.width = `${outOfStockPct}%`;
}

/* ==========================================================
   TAB 1: OVERVIEW TABLE & LOGIC
   ========================================================== */

// Build combined list where each unique raw material appears as exactly 1 row
function getOverviewDataList() {
    const list = state.materials.map(m => {
        // Find all receipt and disbursement records for this material
        const matReceipts = state.receipts.filter(r => r.materialId === m.id);
        const matDisbursements = state.disbursements.filter(d => d.materialId === m.id);

        const latestReceipt = matReceipts[0] || null;
        const latestDisburse = matDisbursements[0] || null;

        let activityStatus = m.currentStock > 0 ? "Receive" : "None";
        let activityQty = m.currentStock > 0 ? `+${fmtQty(m.currentStock)}` : "—";
        let activityUnit = m.unit || "kg";
        let activityDate = m.createdAt ? m.createdAt.slice(0, 10) : "";
        let activityTimestamp = m.createdAt ? new Date(m.createdAt).getTime() : 0;

        if (latestReceipt && latestDisburse) {
            const rDate = new Date(latestReceipt.receiptDate || latestReceipt.createdAt || 0).getTime();
            const dDate = new Date(latestDisburse.usageDate || latestDisburse.createdAt || 0).getTime();
            if (rDate >= dDate) {
                activityStatus = "Receive";
                activityQty = `+${fmtQty(latestReceipt.receivedQuantity)}`;
                activityUnit = latestReceipt.unit || m.unit;
                activityDate = latestReceipt.receiptDate || (latestReceipt.createdAt ? latestReceipt.createdAt.slice(0, 10) : "");
                activityTimestamp = rDate;
            } else {
                activityStatus = "Disbursement";
                activityQty = `-${fmtQty(latestDisburse.consumedQuantity)}`;
                activityUnit = latestDisburse.unit || m.unit;
                activityDate = latestDisburse.usageDate || (latestDisburse.createdAt ? latestDisburse.createdAt.slice(0, 10) : "");
                activityTimestamp = dDate;
            }
        } else if (latestReceipt) {
            activityStatus = "Receive";
            activityQty = `+${fmtQty(latestReceipt.receivedQuantity)}`;
            activityUnit = latestReceipt.unit || m.unit;
            activityDate = latestReceipt.receiptDate || (latestReceipt.createdAt ? latestReceipt.createdAt.slice(0, 10) : "");
            activityTimestamp = new Date(latestReceipt.receiptDate || latestReceipt.createdAt || 0).getTime();
        } else if (latestDisburse) {
            activityStatus = "Disbursement";
            activityQty = `-${fmtQty(latestDisburse.consumedQuantity)}`;
            activityUnit = latestDisburse.unit || m.unit;
            activityDate = latestDisburse.usageDate || (latestDisburse.createdAt ? latestDisburse.createdAt.slice(0, 10) : "");
            activityTimestamp = new Date(latestDisburse.usageDate || latestDisburse.createdAt || 0).getTime();
        } else if (m.currentStock > 0) {
            activityStatus = "Receive";
            activityQty = `+${fmtQty(m.currentStock)}`;
            activityUnit = m.unit || "kg";
        }

        const status = computeStockStatus(m.currentStock, m.minStock);

        return {
            id: m.id,
            name: m.name,
            itemCode: m.itemCode,
            minStock: m.minStock,
            currentStock: m.currentStock,
            unit: m.unit,
            activityStatus,
            activityQty,
            activityUnit,
            activityDate,
            activityTimestamp,
            note: m.note,
            status
        };
    });

    // Apply Filters
    const query = state.overviewSearch.trim().toLowerCase();
    const dateFrom = state.overviewDateFrom ? new Date(state.overviewDateFrom).getTime() : null;
    const dateTo = state.overviewDateTo ? new Date(state.overviewDateTo + "T23:59:59").getTime() : null;

    let filtered = list.filter(item => {
        // 1. Search Query
        if (query) {
            const combined = `${item.name} ${item.itemCode} ${item.note}`.toLowerCase();
            if (!combined.includes(query)) return false;
        }

        // 2. Date Range Filter (based on actual activity/record date)
        if (dateFrom || dateTo) {
            if (!item.activityDate) return false;
            const itemTime = new Date(item.activityDate).getTime();
            if (dateFrom && itemTime < dateFrom) return false;
            if (dateTo && itemTime > dateTo) return false;
        }

        // 3. Activity Status Filter
        if (state.overviewActivityStatus === "receive" && item.activityStatus !== "Receive") return false;
        if (state.overviewActivityStatus === "disbursement" && item.activityStatus !== "Disbursement") return false;

        // 4. Stock Status Filter
        if (state.overviewStatus !== "all" && item.status.key !== state.overviewStatus) return false;

        return true;
    });

    // Apply Sorting
    filtered.sort((a, b) => {
        if (state.overviewSort === "az") return a.name.localeCompare(b.name);
        if (state.overviewSort === "za") return b.name.localeCompare(a.name);
        if (state.overviewSort === "oldest") return (a.activityTimestamp || 0) - (b.activityTimestamp || 0);
        // Default: "latest"
        return (b.activityTimestamp || 0) - (a.activityTimestamp || 0);
    });

    return filtered;
}

function updateOverviewSelectionBar() {
    const bar = $("overviewSelectionBar");
    const countEl = $("overviewSelectedCount");
    const selectAllCb = $("selectAllOverview");
    if (!bar) return;

    const selectedCount = state.selectedOverviewIds.size;
    if (selectedCount > 0) {
        bar.hidden = false;
        if (countEl) countEl.textContent = `${selectedCount} Selected`;
    } else {
        bar.hidden = true;
    }

    // Update Select All checkbox state for visible paged items
    const filtered = getOverviewDataList();
    const startIdx = (state.overviewPage - 1) * state.overviewPageSize;
    const endIdx = Math.min(startIdx + state.overviewPageSize, filtered.length);
    const paged = filtered.slice(startIdx, endIdx);

    if (selectAllCb && paged.length > 0) {
        const allSelected = paged.every(item => state.selectedOverviewIds.has(item.id));
        const someSelected = paged.some(item => state.selectedOverviewIds.has(item.id));
        selectAllCb.checked = allSelected;
        selectAllCb.indeterminate = !allSelected && someSelected;
    } else if (selectAllCb) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
    }
}

function renderOverviewTable() {
    const tbody = $("overviewTableBody");
    const countEl = $("overviewResultCount");
    const btnsEl = $("overviewPaginationBtns");
    if (!tbody) return;

    const filtered = getOverviewDataList();
    const total = filtered.length;

    // Check if clear button should be shown
    const isFiltered = !!state.overviewSearch || !!state.overviewDateFrom || !!state.overviewDateTo || state.overviewActivityStatus !== "all" || state.overviewStatus !== "all";
    if ($("invClearFiltersBtn")) $("invClearFiltersBtn").hidden = !isFiltered;

    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" style="text-align:center; padding: 36px 16px; color: var(--rm-ink-dim);">
                    <strong>No raw materials found.</strong><br>
                    <span style="font-size: 0.8rem;">Try adjusting your search criteria or filters.</span>
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = `Showing 0 of 0 raw materials`;
        if (btnsEl) btnsEl.innerHTML = "";
        updateOverviewSelectionBar();
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / state.overviewPageSize));
    if (state.overviewPage > totalPages) state.overviewPage = totalPages;
    if (state.overviewPage < 1) state.overviewPage = 1;

    const startIdx = (state.overviewPage - 1) * state.overviewPageSize;
    const endIdx = Math.min(startIdx + state.overviewPageSize, total);
    const paged = filtered.slice(startIdx, endIdx);

    if (countEl) {
        countEl.textContent = `Showing ${startIdx + 1}–${endIdx} of ${total} raw materials`;
    }

    tbody.innerHTML = paged.map(item => {
        const isSelected = state.selectedOverviewIds.has(item.id);
        let actBadge = `<span class="activity-badge activity-badge-none">— None</span>`;
        if (item.activityStatus === "Receive") {
            actBadge = `<span class="activity-badge activity-badge-receive">📥 Receive</span>`;
        } else if (item.activityStatus === "Disbursement") {
            actBadge = `<span class="activity-badge activity-badge-disburse">📤 Disbursement</span>`;
        }

        return `
            <tr data-id="${esc(item.id)}" class="${isSelected ? "row-selected" : ""}">
                <td style="text-align: center;">
                    <input type="checkbox" class="inv-custom-checkbox row-select-checkbox" data-id="${esc(item.id)}" ${isSelected ? "checked" : ""}>
                </td>
                <td>${esc(fmtDate(item.activityDate))}</td>
                <td>
                    <div class="mat-name-cell">
                        <span class="mat-name-primary">${esc(item.name)}</span>
                        ${item.note ? `<span class="mat-name-note" title="${esc(item.note)}">${esc(item.note)}</span>` : ""}
                    </div>
                </td>
                <td><span class="mat-id-badge">${esc(item.itemCode || "—")}</span></td>
                <td>${item.minStock !== null ? `${fmtQty(item.minStock)} ${esc(item.unit)}` : "—"}</td>
                <td><strong>${fmtQty(item.currentStock)} ${esc(item.unit)}</strong></td>
                <td>${esc(item.unit)}</td>
                <td>${actBadge}</td>
                <td><strong>${esc(item.activityQty)}</strong></td>
                <td>${esc(item.activityUnit)}</td>
                <td><span class="status-badge ${item.status.cls}">${esc(item.status.badgeText)}</span></td>
                <td style="text-align: right;">
                    <div class="row-direct-actions">
                        <button type="button" class="row-action-btn edit-direct-btn" data-id="${esc(item.id)}" title="Edit / Update">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4C3.44772 4 3 4.44772 3 5V20C3 20.5523 3.44772 21 4 21H19C19.5523 21 20 20.5523 20 20V13M18.5 2.5C19.3284 1.67157 20.6716 1.67157 21.5 2.5C22.3284 3.32843 22.3284 4.67157 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z"/></svg>
                        </button>
                        <button type="button" class="row-action-btn delete-direct-btn" data-id="${esc(item.id)}" data-name="${esc(item.name)}" title="Delete Material">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    // Render Sequential Pagination (1 -> 2 -> 3)
    renderPaginationControls(btnsEl, state.overviewPage, totalPages, (newPage) => {
        state.overviewPage = newPage;
        renderOverviewTable();
    });

    attachOverviewTableListeners();
    updateOverviewSelectionBar();
}

function renderPaginationControls(container, currentPage, totalPages, onPageChange) {
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    let html = `
        <button type="button" class="page-btn" id="prevPageBtn" ${currentPage <= 1 ? "disabled" : ""}>‹</button>
    `;

    for (let p = 1; p <= totalPages; p++) {
        html += `<button type="button" class="page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
    }

    html += `
        <button type="button" class="page-btn" id="nextPageBtn" ${currentPage >= totalPages ? "disabled" : ""}>›</button>
    `;

    container.innerHTML = html;

    const prevBtn = container.querySelector("#prevPageBtn");
    const nextBtn = container.querySelector("#nextPageBtn");

    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            if (currentPage > 1) onPageChange(currentPage - 1);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            if (currentPage < totalPages) onPageChange(currentPage + 1);
        });
    }

    container.querySelectorAll(".page-btn[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
            const p = Number(btn.dataset.page);
            if (p && p !== currentPage) onPageChange(p);
        });
    });
}

function attachOverviewTableListeners() {
    // Row Checkbox Toggle
    document.querySelectorAll(".row-select-checkbox").forEach(cb => {
        cb.onchange = (e) => {
            e.stopPropagation();
            const id = cb.dataset.id;
            const tr = cb.closest("tr");
            if (cb.checked) {
                state.selectedOverviewIds.add(id);
                if (tr) tr.classList.add("row-selected");
            } else {
                state.selectedOverviewIds.delete(id);
                if (tr) tr.classList.remove("row-selected");
            }
            updateOverviewSelectionBar();
        };
    });

    // Select All Checkbox
    const selectAllCb = $("selectAllOverview");
    if (selectAllCb) {
        selectAllCb.onchange = () => {
            const filtered = getOverviewDataList();
            const startIdx = (state.overviewPage - 1) * state.overviewPageSize;
            const endIdx = Math.min(startIdx + state.overviewPageSize, filtered.length);
            const paged = filtered.slice(startIdx, endIdx);

            if (selectAllCb.checked) {
                paged.forEach(item => state.selectedOverviewIds.add(item.id));
            } else {
                paged.forEach(item => state.selectedOverviewIds.delete(item.id));
            }
            renderOverviewTable();
        };
    }

    // Bulk Deselect All
    const bulkDeselectBtn = $("bulkDeselectBtn");
    if (bulkDeselectBtn) {
        bulkDeselectBtn.onclick = () => {
            state.selectedOverviewIds.clear();
            renderOverviewTable();
        };
    }

    // Bulk Edit / Update
    const bulkEditBtn = $("bulkEditBtn");
    if (bulkEditBtn) {
        bulkEditBtn.onclick = () => {
            if (state.selectedOverviewIds.size === 0) {
                toast("Please select a raw material to edit.", "warning");
                return;
            }
            const firstId = Array.from(state.selectedOverviewIds)[0];
            if (state.selectedOverviewIds.size > 1) {
                toast(`Editing the first of ${state.selectedOverviewIds.size} selected materials.`);
            }
            openEditModal(firstId);
        };
    }

    // Bulk Delete
    const bulkDeleteBtn = $("bulkDeleteBtn");
    if (bulkDeleteBtn) {
        bulkDeleteBtn.onclick = async () => {
            const count = state.selectedOverviewIds.size;
            if (count === 0) return;

            if (!confirm(`Are you sure you want to delete the ${count} selected raw material(s)? This action cannot be undone.`)) {
                return;
            }

            const idsToDelete = Array.from(state.selectedOverviewIds);
            try {
                toast(`Deleting ${count} raw material(s)...`);
                const { error } = await supabase
                    .from("raw_materials")
                    .delete()
                    .in("id", idsToDelete);

                if (error) throw error;

                toast(`Successfully deleted ${count} raw material(s).`);
                state.selectedOverviewIds.clear();
                await loadData();
            } catch (err) {
                console.error("Bulk delete error:", err);
                toast("Failed to delete selected materials: " + (err.message || err), "error");
            }
        };
    }

    // Direct Row Edit
    document.querySelectorAll(".edit-direct-btn").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            openEditModal(id);
        };
    });

    // Direct Row Delete
    document.querySelectorAll(".delete-direct-btn").forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const name = btn.dataset.name || "this raw material";

            if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) return;

            try {
                toast(`Deleting "${name}"...`);
                const { error } = await supabase
                    .from("raw_materials")
                    .delete()
                    .eq("id", id);

                if (error) throw error;

                toast(`Successfully deleted "${name}".`);
                state.selectedOverviewIds.delete(id);
                await loadData();
            } catch (err) {
                console.error("Error deleting raw material:", err);
                toast("Failed to delete raw material: " + (err.message || err), "error");
            }
        };
    });
}

// Global click listener to close action menus
document.addEventListener("click", () => {
    if ($("invExportMenu")) $("invExportMenu").hidden = true;
});

/* ==========================================================
   TAB 2: RECEIVE TABLE & LOGIC (PUBLIC.STOCK_RECEIPTS)
   ========================================================== */

function renderReceiveTable() {
    const tbody = $("receiveTableBody");
    const countEl = $("receiveResultCount");
    const btnsEl = $("receivePaginationBtns");
    if (!tbody) return;

    let filtered = [...state.receipts];

    if (state.receiveSearch) {
        const q = state.receiveSearch.trim().toLowerCase();
        filtered = filtered.filter(r => `${r.materialName} ${r.materialCode} ${r.supplierName}`.toLowerCase().includes(q));
    }

    if (state.receiveDateFrom) {
        const fromTime = new Date(state.receiveDateFrom).getTime();
        filtered = filtered.filter(r => new Date(r.receiptDate || r.createdAt).getTime() >= fromTime);
    }

    if (state.receiveDateTo) {
        const toTime = new Date(state.receiveDateTo + "T23:59:59").getTime();
        filtered = filtered.filter(r => new Date(r.receiptDate || r.createdAt).getTime() <= toTime);
    }

    const total = filtered.length;
    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 32px 16px; color: var(--rm-ink-dim);">No stock receipt records recorded.</td></tr>`;
        if (countEl) countEl.textContent = "Showing 0 receipts";
        if (btnsEl) btnsEl.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / state.receivePageSize));
    if (state.receivePage > totalPages) state.receivePage = totalPages;
    if (state.receivePage < 1) state.receivePage = 1;

    const start = (state.receivePage - 1) * state.receivePageSize;
    const paged = filtered.slice(start, start + state.receivePageSize);

    if (countEl) countEl.textContent = `Showing ${start + 1}–${Math.min(start + state.receivePageSize, total)} of ${total} receipts`;

    tbody.innerHTML = paged.map(r => {
        const st = computeStockStatus(r.currentStock, r.minStock);
        return `
            <tr>
                <td>${esc(fmtDate(r.receiptDate || r.createdAt))}</td>
                <td><strong>${esc(r.materialName)}</strong></td>
                <td><span class="mat-id-badge">${esc(r.materialCode || "—")}</span></td>
                <td><span style="color: #047857; font-weight: 700;">+${fmtQty(r.receivedQuantity)}</span></td>
                <td>${esc(r.unit)}</td>
                <td>${esc(r.supplierName || "—")}</td>
                <td><strong>${fmtQty(r.currentStock)} ${esc(r.unit)}</strong></td>
                <td>${r.minStock !== null ? `${fmtQty(r.minStock)} ${esc(r.unit)}` : "—"}</td>
                <td><span class="status-badge ${st.cls}">${esc(st.badgeText)}</span></td>
            </tr>
        `;
    }).join("");

    renderPaginationControls(btnsEl, state.receivePage, totalPages, (newPage) => {
        state.receivePage = newPage;
        renderReceiveTable();
    });
}

/* ==========================================================
   TAB 3: DISBURSEMENT TABLE & LOGIC (PUBLIC.MATERIAL_DISBURSEMENTS)
   ========================================================== */

function renderDisbursementTable() {
    const tbody = $("disbursementTableBody");
    const countEl = $("disbursementResultCount");
    const btnsEl = $("disbursementPaginationBtns");
    if (!tbody) return;

    let filtered = [...state.disbursements];

    if (state.disburseSearch) {
        const q = state.disburseSearch.trim().toLowerCase();
        filtered = filtered.filter(d => `${d.materialName} ${d.materialCode} ${d.productContext}`.toLowerCase().includes(q));
    }

    if (state.disburseDateFrom) {
        const fromTime = new Date(state.disburseDateFrom).getTime();
        filtered = filtered.filter(d => new Date(d.usageDate || d.createdAt).getTime() >= fromTime);
    }

    if (state.disburseDateTo) {
        const toTime = new Date(state.disburseDateTo + "T23:59:59").getTime();
        filtered = filtered.filter(d => new Date(d.usageDate || d.createdAt).getTime() <= toTime);
    }

    const total = filtered.length;
    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 32px 16px; color: var(--rm-ink-dim);">No material disbursement records recorded.</td></tr>`;
        if (countEl) countEl.textContent = "Showing 0 disbursements";
        if (btnsEl) btnsEl.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / state.disbursePageSize));
    if (state.disbursePage > totalPages) state.disbursePage = totalPages;
    if (state.disbursePage < 1) state.disbursePage = 1;

    const start = (state.disbursePage - 1) * state.disbursePageSize;
    const paged = filtered.slice(start, start + state.disbursePageSize);

    if (countEl) countEl.textContent = `Showing ${start + 1}–${Math.min(start + state.disbursePageSize, total)} of ${total} disbursements`;

    tbody.innerHTML = paged.map(d => {
        const st = computeStockStatus(d.currentStock, d.minStock);
        return `
            <tr>
                <td>${esc(fmtDate(d.usageDate || d.createdAt))}</td>
                <td><strong>${esc(d.materialName)}</strong></td>
                <td><span class="mat-id-badge">${esc(d.materialCode || "—")}</span></td>
                <td><span style="color: #b45309; font-weight: 700;">-${fmtQty(d.consumedQuantity)}</span></td>
                <td>${esc(d.unit)}</td>
                <td>${esc(d.productContext || "—")}</td>
                <td><strong>${fmtQty(d.currentStock)} ${esc(d.unit)}</strong></td>
                <td>${d.minStock !== null ? `${fmtQty(d.minStock)} ${esc(d.unit)}` : "—"}</td>
                <td><span class="status-badge ${st.cls}">${esc(st.badgeText)}</span></td>
            </tr>
        `;
    }).join("");

    renderPaginationControls(btnsEl, state.disbursePage, totalPages, (newPage) => {
        state.disbursePage = newPage;
        renderDisbursementTable();
    });
}

/* ==========================================================
   FLATPICKR DATEPICKER HELPERS (TODAY ONLY - PAST & FUTURE DISABLED)
   ========================================================== */

function initModalDatePicker(elementId, initialDate = "today", todayOnly = true) {
    const el = typeof elementId === "string" ? $(elementId) : elementId;
    if (!el) return null;

    if (el._flatpickr) {
        el._flatpickr.destroy();
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const defaultVal = initialDate === "today" ? todayStr : (initialDate || todayStr);

    if (typeof flatpickr === "undefined") {
        el.value = defaultVal;
        if (todayOnly) {
            el.min = todayStr;
            el.max = todayStr;
        }
        return null;
    }

    const config = {
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d/m/Y",
        defaultDate: defaultVal,
        disableMobile: true,
        allowInput: false,
        animate: true
    };

    if (todayOnly) {
        config.minDate = "today";
        config.maxDate = "today";
    }

    return flatpickr(el, config);
}

/* ==========================================================
   ADD RAW MATERIAL MODAL LOGIC
   ========================================================== */

function openAddMaterialModal() {
    $("addMaterialForm").reset();
    setFieldError("addMatNameError");
    setFieldError("addMatUnitError");
    setFieldError("addMatMinStockError");
    setFieldError("addMatCurrentStockError");

    // Generate next available RM ID
    const existingNums = state.materials
        .map(m => {
            const match = String(m.itemCode || "").match(/^RM0*(\d+)$/i);
            return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => n > 0);

    const maxNum = existingNums.length ? Math.max(...existingNums) : 30;
    let nextNum = maxNum + 1;
    let nextCode = `RM${String(nextNum).padStart(3, "0")}`;

    while (state.materials.some(m => String(m.itemCode || "").toUpperCase() === nextCode.toUpperCase())) {
        nextNum++;
        nextCode = `RM${String(nextNum).padStart(3, "0")}`;
    }

    if ($("addMatId")) $("addMatId").value = nextCode;
    if ($("addMatStockDate")) initModalDatePicker("addMatStockDate", "today", true);

    $("addMaterialModalOverlay").classList.add("open");
}

function closeAddMaterialModal() {
    $("addMaterialModalOverlay").classList.remove("open");
}

async function handleAddMaterialSave() {
    const name = $("addMatName").value.trim();
    const itemCode = $("addMatId").value.trim();
    const unit = $("addMatUnit").value.trim();
    const minStockVal = $("addMatMinStock").value.trim();
    const minStock = minStockVal !== "" ? num(minStockVal) : null;
    const currentStockVal = $("addMatCurrentStock").value.trim();
    const initialCurrentStock = currentStockVal !== "" ? num(currentStockVal) : 0;
    const note = $("addMatNote").value.trim();

    setFieldError("addMatNameError");
    setFieldError("addMatUnitError");
    setFieldError("addMatMinStockError");
    setFieldError("addMatCurrentStockError");

    let isValid = true;
    if (!name) {
        setFieldError("addMatNameError", "Raw material name is required.");
        isValid = false;
    }
    if (!unit) {
        setFieldError("addMatUnitError", "Unit of measure is required.");
        isValid = false;
    }
    if (minStockVal === "" || minStock < 0) {
        setFieldError("addMatMinStockError", "Valid minimum stock threshold (≥ 0) is required.");
        isValid = false;
    }
    if (initialCurrentStock < 0) {
        setFieldError("addMatCurrentStockError", "Initial stock cannot be negative.");
        isValid = false;
    }

    // Duplicate Name Normalization Check
    const normName = name.toLowerCase();
    const nameExists = state.materials.some(m => m.name.trim().toLowerCase() === normName);
    if (nameExists) {
        setFieldError("addMatNameError", "Raw material already exists in catalog.");
        isValid = false;
    }

    // Duplicate Item Code Check
    const codeExists = state.materials.some(m => String(m.itemCode || "").toUpperCase() === itemCode.toUpperCase());
    if (codeExists) {
        setFieldError("addMatNameError", `Item code ${itemCode} already exists. Please refresh to regenerate.`);
        isValid = false;
    }

    if (!isValid) return;

    const saveBtn = $("addMaterialSaveBtn");
    saveBtn.disabled = true;

    try {
        // Insert into authoritative public.raw_materials table
        const { data: newMat, error: insertErr } = await supabase
            .from("raw_materials")
            .insert({
                item_code: itemCode,
                name: name,
                unit_of_measure: unit,
                minimum_threshold: minStock,
                description: note || null,
                current_stock: 0
            })
            .select()
            .single();

        if (insertErr) throw insertErr;

        // If user specified an initial stock balance, record it authoritatively via stock receipt
        if (initialCurrentStock > 0 && newMat?.id) {
            const dateVal = $("addMatStockDate").value || new Date().toISOString().slice(0, 10);
            const { error: rpcErr } = await supabase.rpc("record_stock_receipt_v2", {
                p_material_id: newMat.id,
                p_receipt_date: dateVal,
                p_quantity: initialCurrentStock,
                p_unit: unit,
                p_supplier_name: "Initial Catalog Balance"
            });
            if (rpcErr) {
                console.warn("Initial receipt note:", rpcErr);
            }
        }

        toast("Raw material added successfully.");
        closeAddMaterialModal();
        await loadData();
    } catch (err) {
        console.error("Add material error:", err);
        toast(err.message || "Failed to add raw material.", "error");
    } finally {
        saveBtn.disabled = false;
    }
}

/* ==========================================================
   EDIT / UPDATE RAW MATERIAL MODAL LOGIC
   ========================================================== */

function openEditModal(materialId) {
    const mat = state.materials.find(m => m.id === materialId);
    if (!mat) return;

    $("editMatIdInternal").value = mat.id;
    $("editMatName").value = mat.name;
    $("editMatCode").value = mat.itemCode || "—";
    $("editMatUnit").value = mat.unit || "kg";
    $("editMatCurrentStock").value = `${fmtQty(mat.currentStock)} ${mat.unit || ""}`;
    $("editMatMinStock").value = mat.minStock !== null ? mat.minStock : "";
    
    const dateVal = mat.createdAt ? mat.createdAt.slice(0, 10) : "today";
    if ($("editMatDate")) initModalDatePicker("editMatDate", dateVal, true);
    $("editMatNote").value = mat.note || "";

    setFieldError("editMatNameError");
    setFieldError("editMatMinStockError");

    $("editMaterialModalOverlay").classList.add("open");
}

function closeEditModal() {
    $("editMaterialModalOverlay").classList.remove("open");
}

async function handleEditMaterialSave() {
    const id = $("editMatIdInternal").value;
    const name = $("editMatName").value.trim();
    const minStockVal = $("editMatMinStock").value.trim();
    const minStock = minStockVal !== "" ? num(minStockVal) : null;
    const note = $("editMatNote").value.trim();

    setFieldError("editMatNameError");
    setFieldError("editMatMinStockError");

    let isValid = true;
    if (!name) {
        setFieldError("editMatNameError", "Material name is required.");
        isValid = false;
    }
    if (minStockVal === "" || minStock < 0) {
        setFieldError("editMatMinStockError", "Valid minimum stock threshold (≥ 0) is required.");
        isValid = false;
    }

    // Duplicate check excluding self
    const normName = name.toLowerCase();
    const duplicate = state.materials.some(m => m.id !== id && m.name.trim().toLowerCase() === normName);
    if (duplicate) {
        setFieldError("editMatNameError", "Another raw material with this name already exists.");
        isValid = false;
    }

    if (!isValid) return;

    const saveBtn = $("editMaterialSaveBtn");
    saveBtn.disabled = true;

    try {
        // Update raw_materials master catalog fields only (current_stock is never directly overwritten)
        const { error: updateErr } = await supabase
            .from("raw_materials")
            .update({
                name: name,
                minimum_threshold: minStock,
                description: note || null,
                updated_at: new Date().toISOString()
            })
            .eq("id", id);

        if (updateErr) throw updateErr;

        toast("Material updated successfully.");
        closeEditModal();
        await loadData();
    } catch (err) {
        console.error("Update material error:", err);
        toast(err.message || "Failed to update raw material.", "error");
    } finally {
        saveBtn.disabled = false;
    }
}

/* ==========================================================
   RECORD RECEIPT / DISBURSEMENT QUICK ACTIONS
   ========================================================== */

function populateModalDropdowns() {
    const recSelect = $("receiptMaterialSelect");
    const disSelect = $("disburseMaterialSelect");

    const optionsHtml = state.materials
        .map(m => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.itemCode || "RM")}) — ${esc(m.unit)}</option>`)
        .join("");

    if (recSelect) recSelect.innerHTML = `<option value="">Select Raw Material</option>` + optionsHtml;
    if (disSelect) disSelect.innerHTML = `<option value="">Select Raw Material</option>` + optionsHtml;
}

function openNewReceiveModal() {
    $("recordReceiptForm").reset();
    if ($("receiptDateInput")) initModalDatePicker("receiptDateInput", "today", true);
    setFieldError("receiptMaterialError");
    setFieldError("receiptQuantityError");
    $("recordReceiptModalOverlay").classList.add("open");
}

async function handleRecordReceiptSave() {
    const matId = $("receiptMaterialSelect").value;
    const qty = num($("receiptQuantityInput").value);
    const date = $("receiptDateInput").value || new Date().toISOString().slice(0, 10);
    const supplier = $("receiptSupplierInput").value.trim() || null;

    setFieldError("receiptMaterialError");
    setFieldError("receiptQuantityError");

    let isValid = true;
    if (!matId) { setFieldError("receiptMaterialError", "Please select a raw material."); isValid = false; }
    if (qty <= 0) { setFieldError("receiptQuantityError", "Quantity must be greater than 0."); isValid = false; }
    if (!isValid) return;

    const mat = state.materials.find(m => m.id === matId);
    const saveBtn = $("recordReceiptSaveBtn");
    saveBtn.disabled = true;

    try {
        const { error } = await supabase.rpc("record_stock_receipt_v2", {
            p_material_id: matId,
            p_receipt_date: date,
            p_quantity: qty,
            p_unit: mat?.unit || "kg",
            p_supplier_name: supplier
        });

        if (error) throw error;

        toast("Stock received successfully.");
        $("recordReceiptModalOverlay").classList.remove("open");
        await loadData();
    } catch (err) {
        console.error("Receipt error:", err);
        toast(err.message || "Failed to record stock receipt.", "error");
    } finally {
        saveBtn.disabled = false;
    }
}

function openNewDisburseModal() {
    $("recordDisburseForm").reset();
    if ($("disburseDateInput")) initModalDatePicker("disburseDateInput", "today", true);
    setFieldError("disburseMaterialError");
    setFieldError("disburseQuantityError");
    $("recordDisburseModalOverlay").classList.add("open");
}

async function handleRecordDisburseSave() {
    const matId = $("disburseMaterialSelect").value;
    const qty = num($("disburseQuantityInput").value);
    const date = $("disburseDateInput").value || new Date().toISOString().slice(0, 10);
    const context = $("disburseProductContextInput").value.trim() || null;

    setFieldError("disburseMaterialError");
    setFieldError("disburseQuantityError");

    const mat = state.materials.find(m => m.id === matId);
    let isValid = true;
    if (!matId || !mat) { setFieldError("disburseMaterialError", "Please select a raw material."); isValid = false; }
    if (qty <= 0) { setFieldError("disburseQuantityError", "Quantity must be greater than 0."); isValid = false; }
    if (mat && qty > mat.currentStock) {
        setFieldError("disburseQuantityError", `Cannot disburse more than available stock (${fmtQty(mat.currentStock, mat.unit)}).`);
        isValid = false;
    }
    if (!isValid) return;

    const saveBtn = $("recordDisburseSaveBtn");
    saveBtn.disabled = true;

    try {
        const { error } = await supabase.rpc("record_material_disbursement_v2", {
            p_material_id: matId,
            p_usage_date: date,
            p_quantity: qty,
            p_unit: mat.unit || "kg",
            p_activity_type: context,
            p_finished_product_name: context
        });

        if (error) throw error;

        toast("Material disbursement recorded successfully.");
        $("recordDisburseModalOverlay").classList.remove("open");
        await loadData();
    } catch (err) {
        console.error("Disbursement error:", err);
        toast(err.message || "Failed to record disbursement.", "error");
    } finally {
        saveBtn.disabled = false;
    }
}

/* ==========================================================
   IMPORT LOGIC (CSV, XLSX, XLS WITH 2-LEVEL DEDUP)
   ========================================================== */

let parsedImportRows = [];

async function computeFileFingerprint(file) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function openImportModal() {
    parsedImportRows = [];
    $("invImportFileInput").value = "";
    $("invImportPreviewArea").hidden = true;
    $("invImportPreviewArea").innerHTML = "";
    $("invImportConfirmBtn").disabled = true;
    $("invImportModalOverlay").classList.add("open");
}

function closeImportModal() {
    $("invImportModalOverlay").classList.remove("open");
}

function parseExcelDate(val) {
    if (!val && val !== 0) return null;
    if (val instanceof Date) {
        if (!isNaN(val.getTime())) {
            return val.toISOString().slice(0, 10);
        }
    }
    if (typeof val === "number" && val > 0) {
        // Excel serial date number conversion (1900 date system)
        const dt = new Date(Math.round((val - 25569) * 86400 * 1000));
        if (!isNaN(dt.getTime())) {
            return dt.toISOString().slice(0, 10);
        }
    }
    const str = String(val).trim();
    if (!str) return null;

    // YYYY-MM-DD or YYYY/MM/DD
    const matchIso = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (matchIso) {
        const y = matchIso[1];
        const m = matchIso[2].padStart(2, "0");
        const d = matchIso[3].padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    // MM/DD/YYYY or DD/MM/YYYY
    const matchUS = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (matchUS) {
        const p1 = parseInt(matchUS[1], 10);
        const p2 = parseInt(matchUS[2], 10);
        const y = matchUS[3];
        let m, d;
        if (p1 > 12) {
            d = String(p1).padStart(2, "0");
            m = String(p2).padStart(2, "0");
        } else {
            m = String(p1).padStart(2, "0");
            d = String(p2).padStart(2, "0");
        }
        return `${y}-${m}-${d}`;
    }

    const dt = new Date(str);
    if (!isNaN(dt.getTime())) {
        return dt.toISOString().slice(0, 10);
    }
    return null;
}

async function handleImportFileSelect(file) {
    if (!file) return;

    try {
        const data = await file.arrayBuffer();
        if (typeof XLSX === "undefined") {
            toast("Excel parser library is not loaded.", "error");
            return;
        }

        const workbook = XLSX.read(data, { type: "array", cellDates: true, dateNF: "yyyy-mm-dd" });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (!rows || rows.length === 0) {
            toast("The selected file contains no data rows.", "error");
            return;
        }

        const firstRowKeys = Object.keys(rows[0] || {});
        parsedImportRows = [];

        rows.forEach((r) => {
            const keys = Object.keys(r);
            const getVal = (pattern) => {
                const k = keys.find(key => pattern.test(key));
                return k ? String(r[k]).trim() : "";
            };
            const getRawVal = (pattern) => {
                const k = keys.find(key => pattern.test(key));
                return k ? r[k] : null;
            };

            const codeVal = getVal(/material_id|material id|item_code|item code|rm_id|rm id|material_code|material code|\bcode\b|\bid\b/i);
            const nameVal = getVal(/material_name|material name|item_name|item name|\bname\b/i) || (getVal(/material|item/i) !== codeVal ? getVal(/material|item/i) : "");

            let rawName = nameVal;
            let rawCode = codeVal;

            if (!rawName && rawCode) rawName = rawCode;
            if (!rawCode && rawName && /^RM\d+$/i.test(rawName.trim())) rawCode = rawName.trim();
            if (!rawName && !rawCode) return;

            let normCode = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (/^RM\d{1,2}$/.test(normCode)) {
                const numPart = normCode.replace("RM", "");
                normCode = `RM${numPart.padStart(3, "0")}`;
            }
            const normName = rawName.trim().toLowerCase();

            const existingMat = state.materials.find(m => {
                const mCode = String(m.itemCode || "").trim().toUpperCase();
                const mId = String(m.id || "").trim().toLowerCase();
                const mName = String(m.name || "").trim().toLowerCase();

                if (normCode && mCode === normCode) return true;
                if (normCode && mId === normCode.toLowerCase()) return true;
                if (normName && mName === normName) return true;
                if (normName && mCode === normName.toUpperCase()) return true;
                return false;
            });

            const resolvedName = existingMat ? existingMat.name : (rawName || rawCode);
            const resolvedCode = existingMat ? (existingMat.itemCode || normCode || rawCode) : (normCode || rawCode);

            const unit = getVal(/unit/i) || (existingMat ? existingMat.unit : "kg");
            const minStockStr = getVal(/min|threshold/i);
            
            const explicitReceiptStr = getVal(/receipt|received|incoming|in_qty|received_qty/i);
            const explicitDsbStr = getVal(/disburs|dsb|consumed|consumption|usage|out_qty|consumed_qty|used_qty|amount_used/i);
            const generalQtyStr = getVal(/stock|current|quantity|qty|amount/i);
            const typeStr = getVal(/type|activity|movement|transaction|action/i).toLowerCase();
            const note = getVal(/note|desc|remark|product/i);

            const rawDateCell = getRawVal(/date|time|timestamp|usage_date|receipt_date|usage date|receipt date/i);
            const parsedDate = parseExcelDate(rawDateCell);
            const recordDate = parsedDate || new Date().toISOString().slice(0, 10);

            let receiptQty = 0;
            let dsbQty = 0;

            if (explicitReceiptStr !== "") {
                receiptQty = Math.max(0, num(explicitReceiptStr));
            }
            if (explicitDsbStr !== "") {
                dsbQty = Math.max(0, num(explicitDsbStr));
            }

            if (explicitReceiptStr === "" && explicitDsbStr === "") {
                const qtyVal = generalQtyStr !== "" ? Math.max(0, num(generalQtyStr)) : 0;
                if (typeStr.includes("receipt") || typeStr.includes("receive") || typeStr.includes("in") || typeStr.includes("incoming")) {
                    receiptQty = qtyVal;
                } else {
                    dsbQty = qtyVal;
                }
            }

            parsedImportRows.push({
                name: resolvedName,
                code: resolvedCode,
                unit: unit.toLowerCase() || (existingMat ? (existingMat.unit || "kg").toLowerCase() : "kg"),
                minStock: minStockStr !== "" ? Math.max(0, num(minStockStr)) : (existingMat ? existingMat.minStock : null),
                receiptQty,
                dsbQty,
                recordDate,
                note: note || (existingMat ? existingMat.note : ""),
                isExisting: !!existingMat,
                existingMat: existingMat || null
            });
        });

        // Simple, clean preview area
        $("invImportPreviewArea").hidden = false;
        $("invImportPreviewArea").innerHTML = `
            <div style="padding: 14px 16px; background: var(--bg-app-2, #F8FAFC); border: 1px solid var(--border-subtle, #E2E8F0); border-radius: var(--radius-md, 8px); margin-bottom: 12px;">
                <div style="font-size: 0.9rem; font-weight: 600; color: var(--rm-ink, #0F172A); margin-bottom: 4px;">
                    Ready to import <strong>${parsedImportRows.length}</strong> records.
                </div>
                <div style="font-size: 0.8rem; color: var(--rm-ink-dim, #64748B);">
                    Recognized fields: ${firstRowKeys.join(", ")}
                </div>
            </div>
        `;
        $("invImportConfirmBtn").disabled = parsedImportRows.length === 0;
    } catch (err) {
        console.error("Import parse error:", err);
        toast("Failed to parse the file: " + err.message, "error");
    }
}

let isImportCancelled = false;

async function handleImportConfirm() {
    if (!parsedImportRows || parsedImportRows.length === 0) return;

    isImportCancelled = false;
    const confirmBtn = $("invImportConfirmBtn");
    const cancelBtn = $("invImportCancelBtn");
    const closeBtn = $("invImportModalClose");

    confirmBtn.disabled = true;

    // Enable Cancel & Close buttons so user can abort an urgent import at any time!
    if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.onclick = () => {
            isImportCancelled = true;
            toast("Import cancelled by user.", "info");
            closeImportModal();
        };
    }
    if (closeBtn) {
        closeBtn.style.pointerEvents = "auto";
        closeBtn.onclick = () => {
            isImportCancelled = true;
            toast("Import cancelled by user.", "info");
            closeImportModal();
        };
    }

    const originalBtnHTML = confirmBtn.innerHTML;
    confirmBtn.innerHTML = `
        <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; margin-right: 6px; animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2 a 10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
        Importing...
    `;

    const totalRows = parsedImportRows.length;
    let addedCount = 0;
    let updatedCount = 0;
    let totalReceiptsLogged = 0;
    let totalDsbsLogged = 0;

    // Render animated Circular Progress Ring & Percentage Bar UI
    const previewArea = $("invImportPreviewArea");
    if (previewArea) {
        previewArea.hidden = false;
        previewArea.innerHTML = `
            <div class="import-progress-box" style="padding: 18px 16px; background: rgba(37, 99, 235, 0.04); border: 1px solid rgba(37, 99, 235, 0.2); border-radius: var(--radius-md, 8px); margin-bottom: 12px;">
                <div style="display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 12px;">
                    <svg width="48" height="48" viewBox="0 0 44 44" style="transform: rotate(-90deg);">
                        <circle cx="22" cy="22" r="18" stroke="#E2E8F0" stroke-width="4" fill="none" />
                        <circle id="importCircleProgress" cx="22" cy="22" r="18" stroke="#2563EB" stroke-width="4" stroke-linecap="round" fill="none" stroke-dasharray="113.1" stroke-dashoffset="113.1" style="transition: stroke-dashoffset 0.15s ease;" />
                    </svg>
                    <div style="text-align: left;">
                        <div id="importPercentText" style="font-size: 1.25rem; font-weight: 800; color: #0F172A; line-height: 1.2;">0%</div>
                        <div id="importStatusText" style="font-size: 0.82rem; font-weight: 600; color: #64748B;">Importing data... (0 / ${totalRows} records)</div>
                    </div>
                </div>
                <div style="width: 100%; height: 8px; background: #E2E8F0; border-radius: 4px; overflow: hidden;">
                    <div id="importProgressBar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #2563EB, #10B981); transition: width 0.15s ease; border-radius: 4px;"></div>
                </div>
            </div>
        `;
    }

    try {
        const CHUNK_SIZE = 15;
        for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
            if (isImportCancelled) {
                console.log("Import process aborted by user cancellation.");
                break;
            }

            const chunk = parsedImportRows.slice(i, i + CHUNK_SIZE);

            await Promise.all(chunk.map(async (item, chunkIdx) => {
                if (isImportCancelled) return;

                let targetMatId = null;
                let targetUnit = item.unit || "kg";

                if (item.isExisting && item.existingMat) {
                    targetMatId = item.existingMat.id;
                    targetUnit = item.unit || item.existingMat.unit || "kg";

                    // Update master catalog attributes
                    const updatePayload = { updated_at: new Date().toISOString() };
                    if (item.minStock !== null && item.minStock !== undefined) updatePayload.minimum_threshold = item.minStock;
                    if (item.unit) updatePayload.unit_of_measure = item.unit;
                    if (item.note) updatePayload.description = item.note;

                    const { error: updateErr } = await supabase
                        .from("raw_materials")
                        .update(updatePayload)
                        .eq("id", targetMatId);

                    if (!updateErr) updatedCount++;
                } else {
                    // Generate next RM code
                    let code = item.code;
                    if (!code || state.materials.some(m => String(m.itemCode || "").toUpperCase() === code.toUpperCase())) {
                        const existingNums = state.materials
                            .map(m => {
                                const match = String(m.itemCode || "").match(/^RM0*(\d+)$/i);
                                return match ? parseInt(match[1], 10) : 0;
                            })
                            .filter(n => n > 0);
                        const maxNum = existingNums.length ? Math.max(...existingNums) : 30;
                        let nextNum = maxNum + 1 + addedCount + (i + chunkIdx);
                        code = `RM${String(nextNum).padStart(3, "0")}`;
                    }

                    const { data: newMat, error: insertErr } = await supabase
                        .from("raw_materials")
                        .insert({
                            item_code: code,
                            name: item.name,
                            unit_of_measure: item.unit,
                            minimum_threshold: item.minStock,
                            description: item.note || null,
                            current_stock: 0
                        })
                        .select()
                        .single();

                    if (!insertErr && newMat) {
                        addedCount++;
                        targetMatId = newMat.id;
                        targetUnit = newMat.unit_of_measure || item.unit || "kg";
                    }
                }

                if (targetMatId && !isImportCancelled) {
                    const recordDate = item.recordDate || new Date().toISOString().slice(0, 10);

                    // Record Stock Receipts with original Excel date
                    if (item.receiptQty > 0) {
                        const { error: recErr } = await supabase.rpc("record_stock_receipt_v2", {
                            p_material_id: targetMatId,
                            p_receipt_date: recordDate,
                            p_quantity: item.receiptQty,
                            p_unit: targetUnit,
                            p_supplier_name: "Imported Stock Receipt"
                        });
                        if (!recErr) totalReceiptsLogged++;
                    }

                    // Record Disbursements / DSB with original Excel date
                    if (item.dsbQty > 0) {
                        const { error: dsbErr } = await supabase.rpc("record_material_disbursement_v2", {
                            p_material_id: targetMatId,
                            p_usage_date: recordDate,
                            p_quantity: item.dsbQty,
                            p_unit: targetUnit,
                            p_activity_type: "Imported Disbursement",
                            p_finished_product_name: item.note || "Imported DSB Usage"
                        });
                        if (!dsbErr) totalDsbsLogged++;
                    }
                }
            }));

            if (isImportCancelled) break;

            // Update circular ring & percentage bar per batch
            const processedCount = Math.min(totalRows, i + CHUNK_SIZE);
            const pct = Math.round((processedCount / totalRows) * 100);
            const offset = 113.1 - (113.1 * pct) / 100;

            const circleEl = $("importCircleProgress");
            const barEl = $("importProgressBar");
            const pctEl = $("importPercentText");
            const statusEl = $("importStatusText");

            if (circleEl) circleEl.style.strokeDashoffset = String(offset);
            if (barEl) barEl.style.width = `${pct}%`;
            if (pctEl) pctEl.textContent = `${pct}%`;
            if (statusEl) statusEl.textContent = `Importing data... (${processedCount} / ${totalRows} records)`;
        }

        if (!isImportCancelled) {
            // Final 100% completion display
            const circleEl = $("importCircleProgress");
            const barEl = $("importProgressBar");
            const pctEl = $("importPercentText");
            const statusEl = $("importStatusText");

            if (circleEl) circleEl.style.strokeDashoffset = "0";
            if (barEl) barEl.style.width = "100%";
            if (pctEl) pctEl.textContent = "100%";
            if (statusEl) statusEl.textContent = `Successfully imported ${totalRows} records!`;

            const msgParts = [];
            if (addedCount > 0) msgParts.push(`${addedCount} new materials`);
            if (updatedCount > 0) msgParts.push(`${updatedCount} existing synced`);
            if (totalReceiptsLogged > 0) msgParts.push(`${totalReceiptsLogged} receipts logged`);
            if (totalDsbsLogged > 0) msgParts.push(`${totalDsbsLogged} disbursements logged`);

            toast(`Import completed: ${msgParts.join(", ") || `${parsedImportRows.length} records processed`}.`);
            
            setTimeout(async () => {
                closeImportModal();
                await loadData();
            }, 500);
        } else {
            await loadData();
        }
    } catch (err) {
        console.error("Import save error:", err);
        toast("Error while saving imported materials: " + err.message, "error");
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalBtnHTML;
        if (cancelBtn) {
            cancelBtn.disabled = false;
            cancelBtn.onclick = closeImportModal;
        }
        if (closeBtn) {
            closeBtn.style.pointerEvents = "auto";
            closeBtn.onclick = closeImportModal;
        }
    }
}

/* ==========================================================
   EXPORT LOGIC (CSV & EXCEL ONLY — FULL FILTERED DATASET)
   ========================================================== */

function getExportDataset() {
    const data = getOverviewDataList();
    return data.map(item => {
        const matName = String(item.name || item.raw_material_name || item.material_name || "Raw Material").trim();
        const matCode = String(item.itemCode || item.code || "—").trim();
        return [
            item.activityDate || "—",
            matName,
            matCode,
            item.minStock !== null ? `${item.minStock} ${item.unit}` : "—",
            `${item.currentStock} ${item.unit}`,
            item.unit || "",
            item.activityStatus,
            item.activityQty,
            item.activityUnit,
            item.status.label
        ];
    });
}

/* ==========================================================
   EXPORT MODAL ENGINE (VERIFIED TAB SELECTION & SMOOTH PROGRESS)
   ========================================================== */

let currentExportDataset = "overview";
let currentExportFormat = "xlsx";

function openExportModal() {
    const overlay = $("invExportModalOverlay");
    if (!overlay) return;

    currentExportDataset = "overview";
    currentExportFormat = "xlsx";

    // Set initial dataset cards
    const cards = document.querySelectorAll("#exportTabOptions .export-tab-card");
    cards.forEach(c => {
        if (c.dataset.dataset === "overview") {
            c.classList.add("active");
            const radio = c.querySelector("input[type='radio']");
            if (radio) radio.checked = true;
        } else {
            c.classList.remove("active");
        }
    });

    // Set initial format buttons
    const fmtBtns = document.querySelectorAll("#exportFormatOptions .export-format-btn");
    fmtBtns.forEach(b => {
        if (b.dataset.format === "xlsx") {
            b.classList.add("active");
            const radio = b.querySelector("input[type='radio']");
            if (radio) radio.checked = true;
        } else {
            b.classList.remove("active");
        }
    });

    // Hide progress area and reset confirm button
    const progressArea = $("invExportProgressArea");
    if (progressArea) {
        progressArea.hidden = true;
        progressArea.innerHTML = "";
    }
    const summaryBox = $("exportSummaryBox");
    if (summaryBox) summaryBox.hidden = false;

    const confirmBtn = $("invExportConfirmBtn");
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; margin-right: 6px;"><path d="M12 15V4M12 4L8 8M12 4L16 8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16V18C4 19.1046 4.89543 20 6 20H18C19.1046 20 20 19.1046 20 18V16" stroke-linecap="round"/></svg>
            Export & Download
        `;
    }

    updateExportSummary();
    overlay.classList.add("open");
}

function closeExportModal() {
    const overlay = $("invExportModalOverlay");
    if (overlay) overlay.classList.remove("open");
}

function updateExportSummary() {
    const titleEl = $("exportSummaryTitle");
    const descEl = $("exportSummaryDesc");
    if (!titleEl || !descEl) return;

    let datasetName = "Overview";
    let recordCount = state.materials.length;

    if (currentExportDataset === "receive") {
        datasetName = "Receive Records";
        recordCount = state.receipts.length;
    } else if (currentExportDataset === "disbursement") {
        datasetName = "Disbursement Logs";
        recordCount = state.disbursements.length;
    } else if (currentExportDataset === "other") {
        datasetName = "Other Details";
        recordCount = state.materials.length;
    } else if (currentExportDataset === "all") {
        datasetName = "All Datasets";
        recordCount = state.materials.length + state.receipts.length + state.disbursements.length;
    } else {
        datasetName = "Overview";
        recordCount = state.materials.length;
    }

    const fmtName = currentExportFormat.toUpperCase();
    titleEl.textContent = `Ready to Export ${datasetName}`;
    descEl.textContent = `${recordCount.toLocaleString()} verified records ready for download in ${fmtName} format.`;
}

function getFilteredTableRows(type) {
    if (!state.tableRows) return [];
    if (type === "overview") return state.tableRows;
    if (type === "receive") return state.tableRows.filter(r => r.activityStatus === "Received" || r.isReceipt);
    if (type === "disbursement") return state.tableRows.filter(r => r.activityStatus === "Disbursement" || r.isDisbursement);
    if (type === "other") return state.tableRows;
    return state.tableRows;
}

function getMatName(matId) {
    const m = state.materials.find(mat => mat.id === matId);
    return m ? m.name : "Raw Material";
}

function getMatCode(matId) {
    const m = state.materials.find(mat => mat.id === matId);
    return m ? (m.itemCode || "RM-CAT") : "RM-CAT";
}

function executeExcelExport(isFiltered, dateTag) {
    const wb = XLSX.utils.book_new();

    // 1. Overview Sheet Data
    const overviewHeaders = ["Raw Material Name", "Item Code", "Current Stock", "Unit", "Minimum Threshold", "Status", "Last Update Date"];
    const overviewData = state.materials.map(m => {
        let status = "Available";
        if (m.currentStock <= 0) status = "Out of Stock";
        else if (m.minimumThreshold !== null && m.currentStock <= m.minimumThreshold) status = "Might Restock";
        return [
            m.name,
            m.itemCode || "RM-CAT",
            m.currentStock,
            m.unit || "kg",
            m.minimumThreshold !== null ? m.minimumThreshold : "—",
            status,
            m.updatedAt ? m.updatedAt.slice(0, 10) : dateTag
        ];
    });

    // 2. Receipts Sheet Data
    const receiptHeaders = ["Receipt Date", "Raw Material Name", "Item Code", "Received Quantity", "Unit", "Supplier Name", "Received By", "Created At"];
    const receiptData = state.receipts.map(r => [
        r.receiptDate || (r.createdAt ? r.createdAt.slice(0, 10) : "—"),
        getMatName(r.materialId),
        getMatCode(r.materialId),
        r.receivedQuantity,
        r.unit || "kg",
        r.supplierName || "—",
        r.receivedBy || "Admin",
        r.createdAt || "—"
    ]);

    // 3. Disbursements Sheet Data
    const disbHeaders = ["Usage Date", "Raw Material Name", "Item Code", "Consumed Quantity", "Unit", "Activity Type", "Finished Product Name", "Recorded By", "Created At"];
    const disbData = state.disbursements.map(d => [
        d.usageDate || (d.createdAt ? d.createdAt.slice(0, 10) : "—"),
        getMatName(d.materialId),
        getMatCode(d.materialId),
        d.consumedQuantity,
        d.unit || "kg",
        d.activityType || "Disbursement",
        d.finishedProductName || "—",
        d.recordedBy || "User",
        d.createdAt || "—"
    ]);

    // 4. Other Details Sheet Data
    const otherHeaders = ["Raw Material Name", "Item Code", "Unit of Measure", "Minimum Threshold", "Reorder Quantity", "Lead Time (Days)", "Current Stock", "Description"];
    const otherData = state.materials.map(m => [
        m.name,
        m.itemCode || "RM-CAT",
        m.unit || "kg",
        m.minimumThreshold !== null ? m.minimumThreshold : "—",
        m.reorderQuantity !== null ? m.reorderQuantity : "—",
        m.leadTimeDays !== null ? m.leadTimeDays : "—",
        m.currentStock,
        m.description || "—"
    ]);

    if (currentExportDataset === "overview") {
        const ws = XLSX.utils.aoa_to_sheet([overviewHeaders, ...overviewData]);
        XLSX.utils.book_append_sheet(wb, ws, "Overview");
        XLSX.writeFile(wb, `RMIMS_Inventory_Overview_${dateTag}.xlsx`);
    } else if (currentExportDataset === "receive") {
        const ws = XLSX.utils.aoa_to_sheet([receiptHeaders, ...receiptData]);
        XLSX.utils.book_append_sheet(wb, ws, "Stock Receipts");
        XLSX.writeFile(wb, `RMIMS_Inventory_Receive_${dateTag}.xlsx`);
    } else if (currentExportDataset === "disbursement") {
        const ws = XLSX.utils.aoa_to_sheet([disbHeaders, ...disbData]);
        XLSX.utils.book_append_sheet(wb, ws, "Disbursements");
        XLSX.writeFile(wb, `RMIMS_Inventory_Disbursements_${dateTag}.xlsx`);
    } else if (currentExportDataset === "other") {
        const ws = XLSX.utils.aoa_to_sheet([otherHeaders, ...otherData]);
        XLSX.utils.book_append_sheet(wb, ws, "Material Details");
        XLSX.writeFile(wb, `RMIMS_Inventory_Other_Details_${dateTag}.xlsx`);
    } else {
        // ALL Combined Archive
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([overviewHeaders, ...overviewData]), "Overview");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([receiptHeaders, ...receiptData]), "Stock Receipts");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([disbHeaders, ...disbData]), "Disbursements");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([otherHeaders, ...otherData]), "Catalog Specs");
        XLSX.writeFile(wb, `RMIMS_Inventory_Complete_Archive_${dateTag}.xlsx`);
    }
}

function executeCsvExport(isFiltered, dateTag) {
    let headers = [];
    let data = [];
    let filenamePrefix = "RMIMS_Inventory";

    if (currentExportDataset === "receive") {
        filenamePrefix = "RMIMS_Inventory_Receive";
        headers = ["Receipt Date", "Raw Material Name", "Item Code", "Received Quantity", "Unit", "Supplier Name", "Received By", "Created At"];
        data = state.receipts.map(r => [
            r.receiptDate || (r.createdAt ? r.createdAt.slice(0, 10) : "—"),
            getMatName(r.materialId),
            getMatCode(r.materialId),
            r.receivedQuantity,
            r.unit || "kg",
            r.supplierName || "—",
            r.receivedBy || "Admin",
            r.createdAt || "—"
        ]);
    } else if (currentExportDataset === "disbursement") {
        filenamePrefix = "RMIMS_Inventory_Disbursements";
        headers = ["Usage Date", "Raw Material Name", "Item Code", "Consumed Quantity", "Unit", "Activity Type", "Finished Product Name", "Recorded By", "Created At"];
        data = state.disbursements.map(d => [
            d.usageDate || (d.createdAt ? d.createdAt.slice(0, 10) : "—"),
            getMatName(d.materialId),
            getMatCode(d.materialId),
            d.consumedQuantity,
            d.unit || "kg",
            d.activityType || "Disbursement",
            d.finishedProductName || "—",
            d.recordedBy || "User",
            d.createdAt || "—"
        ]);
    } else if (currentExportDataset === "other") {
        filenamePrefix = "RMIMS_Inventory_Other_Details";
        headers = ["Raw Material Name", "Item Code", "Unit of Measure", "Minimum Threshold", "Reorder Quantity", "Lead Time (Days)", "Current Stock", "Description"];
        data = state.materials.map(m => [
            m.name,
            m.itemCode || "RM-CAT",
            m.unit || "kg",
            m.minimumThreshold !== null ? m.minimumThreshold : "—",
            m.reorderQuantity !== null ? m.reorderQuantity : "—",
            m.leadTimeDays !== null ? m.leadTimeDays : "—",
            m.currentStock,
            m.description || "—"
        ]);
    } else {
        filenamePrefix = "RMIMS_Inventory_Overview";
        headers = ["Raw Material Name", "Item Code", "Current Stock", "Unit", "Minimum Threshold", "Status", "Last Update Date"];
        data = state.materials.map(m => {
            let status = "Available";
            if (m.currentStock <= 0) status = "Out of Stock";
            else if (m.minimumThreshold !== null && m.currentStock <= m.minimumThreshold) status = "Might Restock";
            return [
                m.name,
                m.itemCode || "RM-CAT",
                m.currentStock,
                m.unit || "kg",
                m.minimumThreshold !== null ? m.minimumThreshold : "—",
                status,
                m.updatedAt ? m.updatedAt.slice(0, 10) : dateTag
            ];
        });
    }

    const escapeCsv = (str) => `"${String(str ?? "").replace(/"/g, '""')}"`;
    const rows = [
        headers.map(escapeCsv).join(","),
        ...data.map(row => row.map(escapeCsv).join(","))
    ];

    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${filenamePrefix}_${dateTag}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function handleExportConfirm() {
    const confirmBtn = $("invExportConfirmBtn");
    const cancelBtn = $("invExportCancelBtn");
    const closeBtn = $("invExportModalClose");
    const summaryBox = $("exportSummaryBox");
    const progressArea = $("invExportProgressArea");

    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (closeBtn) closeBtn.style.pointerEvents = "none";
    if (summaryBox) summaryBox.hidden = true;

    if (progressArea) {
        progressArea.hidden = false;
        progressArea.innerHTML = `
            <div class="import-progress-box" style="padding: 20px 16px; background: rgba(16, 185, 129, 0.04); border: 1.5px solid rgba(16, 185, 129, 0.25); border-radius: var(--radius-md, 12px); margin-top: 10px;">
                <div style="display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 12px;">
                    <svg width="48" height="48" viewBox="0 0 44 44" style="transform: rotate(-90deg);">
                        <circle cx="22" cy="22" r="18" stroke="#E2E8F0" stroke-width="4" fill="none" />
                        <circle id="exportCircleProgress" cx="22" cy="22" r="18" stroke="#10B981" stroke-width="4" stroke-linecap="round" fill="none" stroke-dasharray="113.1" stroke-dashoffset="113.1" style="transition: stroke-dashoffset 0.2s ease;" />
                    </svg>
                    <div style="text-align: left;">
                        <div id="exportPercentText" style="font-size: 1.25rem; font-weight: 800; color: #0F172A; line-height: 1.2;">0%</div>
                        <div id="exportStatusText" style="font-size: 0.82rem; font-weight: 600; color: #64748B;">Preparing data records...</div>
                    </div>
                </div>
                <div style="width: 100%; height: 8px; background: #E2E8F0; border-radius: 4px; overflow: hidden;">
                    <div id="exportProgressBar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #10B981, #059669); transition: width 0.2s ease; border-radius: 4px;"></div>
                </div>
            </div>
        `;
    }

    const setProgress = (pct, status) => {
        const circle = $("exportCircleProgress");
        const bar = $("exportProgressBar");
        const pctText = $("exportPercentText");
        const statusText = $("exportStatusText");

        if (pctText) pctText.textContent = `${pct}%`;
        if (statusText) statusText.textContent = status;
        if (bar) bar.style.width = `${pct}%`;
        if (circle) {
            const circumference = 113.1;
            const offset = circumference - (pct / 100) * circumference;
            circle.style.strokeDashoffset = offset;
        }
    };

    try {
        setProgress(25, "Gathering verified catalog & transaction logs...");
        await new Promise(r => setTimeout(r, 260));

        setProgress(60, "Formatting table columns & units...");
        await new Promise(r => setTimeout(r, 280));

        const isFiltered = currentExportScope === "filtered";
        const dateTag = new Date().toISOString().slice(0, 10);

        if (currentExportFormat === "xlsx") {
            if (typeof XLSX === "undefined") {
                toast("Excel library is unavailable, exporting as CSV.", "warning");
                executeCsvExport(isFiltered, dateTag);
            } else {
                setProgress(85, "Compiling Excel spreadsheet workbook...");
                await new Promise(r => setTimeout(r, 240));
                executeExcelExport(isFiltered, dateTag);
            }
        } else {
            setProgress(85, "Generating UTF-8 CSV table...");
            await new Promise(r => setTimeout(r, 240));
            executeCsvExport(isFiltered, dateTag);
        }

        setProgress(100, "Export complete! Triggering download...");
        await new Promise(r => setTimeout(r, 450));

        toast(`Export generated successfully! Download started.`, "success");
        closeExportModal();

    } catch (err) {
        console.error("Export error:", err);
        toast("Export failed: " + err.message, "error");
    } finally {
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (closeBtn) closeBtn.style.pointerEvents = "auto";
    }
}
/* ==========================================================
   ATTACH EVENT LISTENERS & TAB NAVIGATION
   ========================================================== */

function setupEventListeners() {
    // 1. Attached Tabs Switching
    const tabBtns = document.querySelectorAll(".inv-tab-btn");
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const tabKey = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            // Hide all tab panes
            document.querySelectorAll(".inv-tab-pane").forEach(pane => pane.hidden = true);

            // Show selected tab pane
            if (tabKey === "overview") $("paneOverview").hidden = false;
            else if (tabKey === "receive") $("paneReceive").hidden = false;
            else if (tabKey === "disbursement") $("paneDisbursement").hidden = false;
            else if (tabKey === "other-details") $("paneOtherDetails").hidden = false;

            state.activeTab = tabKey;
        });
    });

    // 2. Overview Search & Filters
    if ($("invSearchInput")) {
        $("invSearchInput").addEventListener("input", (e) => {
            state.overviewSearch = e.target.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if ($("invDateFrom")) {
        $("invDateFrom").addEventListener("change", (e) => {
            state.overviewDateFrom = e.target.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if ($("invDateTo")) {
        $("invDateTo").addEventListener("change", (e) => {
            state.overviewDateTo = e.target.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if ($("invActivityStatusFilter")) {
        $("invActivityStatusFilter").addEventListener("change", (e) => {
            state.overviewActivityStatus = e.target.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if ($("invStatusFilter")) {
        $("invStatusFilter").addEventListener("change", (e) => {
            state.overviewStatus = e.target.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if ($("invSortFilter")) {
        $("invSortFilter").addEventListener("change", (e) => {
            state.overviewSort = e.target.value;
            renderOverviewTable();
        });
    }

    if ($("invClearFiltersBtn")) {
        $("invClearFiltersBtn").addEventListener("click", () => {
            state.overviewSearch = "";
            state.overviewDateFrom = "";
            state.overviewDateTo = "";
            state.overviewActivityStatus = "all";
            state.overviewStatus = "all";
            state.overviewSort = "latest";

            if ($("invSearchInput")) $("invSearchInput").value = "";
            if ($("invDateFrom")) {
                if ($("invDateFrom")._flatpickr) $("invDateFrom")._flatpickr.clear();
                else $("invDateFrom").value = "";
            }
            if ($("invDateTo")) {
                if ($("invDateTo")._flatpickr) $("invDateTo")._flatpickr.clear();
                else $("invDateTo").value = "";
            }
            if ($("invActivityStatusFilter")) $("invActivityStatusFilter").value = "all";
            if ($("invStatusFilter")) $("invStatusFilter").value = "all";
            if ($("invSortFilter")) $("invSortFilter").value = "latest";

            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if ($("overviewPageSize")) {
        $("overviewPageSize").addEventListener("change", (e) => {
            state.overviewPageSize = Number(e.target.value) || 10;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    // 3. Receive Tab Filters
    if ($("receiveSearchInput")) {
        $("receiveSearchInput").addEventListener("input", (e) => {
            state.receiveSearch = e.target.value;
            state.receivePage = 1;
            renderReceiveTable();
        });
    }
    if ($("receiveDateFrom")) {
        $("receiveDateFrom").addEventListener("change", (e) => {
            state.receiveDateFrom = e.target.value;
            state.receivePage = 1;
            renderReceiveTable();
        });
    }
    if ($("receiveDateTo")) {
        $("receiveDateTo").addEventListener("change", (e) => {
            state.receiveDateTo = e.target.value;
            state.receivePage = 1;
            renderReceiveTable();
        });
    }

    // 4. Disbursement Tab Filters
    if ($("disbursementSearchInput")) {
        $("disbursementSearchInput").addEventListener("input", (e) => {
            state.disburseSearch = e.target.value;
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }
    if ($("disburseDateFrom")) {
        $("disburseDateFrom").addEventListener("change", (e) => {
            state.disburseDateFrom = e.target.value;
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }
    if ($("disburseDateTo")) {
        $("disburseDateTo").addEventListener("change", (e) => {
            state.disburseDateTo = e.target.value;
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }

    // Initialize all Filter Flatpickr Calendars
    const filterDateInputIds = ["invDateFrom", "invDateTo", "receiveDateFrom", "receiveDateTo", "disburseDateFrom", "disburseDateTo"];
    filterDateInputIds.forEach(id => {
        const el = $(id);
        if (el && typeof flatpickr !== "undefined" && !el._flatpickr) {
            flatpickr(el, {
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "d/m/Y",
                disableMobile: true,
                allowInput: false,
                onChange: (selectedDates, dateStr) => {
                    el.value = dateStr;
                    el.dispatchEvent(new Event("change"));
                }
            });
        }
    });

    // 5. Header Actions
    if ($("refreshBtn")) $("refreshBtn").addEventListener("click", loadData);
    if ($("addMaterialBtn")) $("addMaterialBtn").addEventListener("click", openAddMaterialModal);
    if ($("addMaterialModalClose")) $("addMaterialModalClose").addEventListener("click", closeAddMaterialModal);
    if ($("addMaterialCancelBtn")) $("addMaterialCancelBtn").addEventListener("click", closeAddMaterialModal);
    if ($("addMaterialSaveBtn")) $("addMaterialSaveBtn").addEventListener("click", handleAddMaterialSave);

    if ($("editMaterialModalClose")) $("editMaterialModalClose").addEventListener("click", closeEditModal);
    if ($("editMaterialCancelBtn")) $("editMaterialCancelBtn").addEventListener("click", closeEditModal);
    if ($("editMaterialSaveBtn")) $("editMaterialSaveBtn").addEventListener("click", handleEditMaterialSave);

    // 6. Quick Action Modals (Receive / Disburse)
    if ($("btnOpenNewReceiveModal")) $("btnOpenNewReceiveModal").addEventListener("click", openNewReceiveModal);
    if ($("recordReceiptModalClose")) $("recordReceiptModalClose").addEventListener("click", () => $("recordReceiptModalOverlay").classList.remove("open"));
    if ($("recordReceiptCancelBtn")) $("recordReceiptCancelBtn").addEventListener("click", () => $("recordReceiptModalOverlay").classList.remove("open"));
    if ($("recordReceiptSaveBtn")) $("recordReceiptSaveBtn").addEventListener("click", handleRecordReceiptSave);

    if ($("btnOpenNewDisburseModal")) $("btnOpenNewDisburseModal").addEventListener("click", openNewDisburseModal);
    if ($("recordDisburseModalClose")) $("recordDisburseModalClose").addEventListener("click", () => $("recordDisburseModalOverlay").classList.remove("open"));
    if ($("recordDisburseCancelBtn")) $("recordDisburseCancelBtn").addEventListener("click", () => $("recordDisburseModalOverlay").classList.remove("open"));
    if ($("recordDisburseSaveBtn")) $("recordDisburseSaveBtn").addEventListener("click", handleRecordDisburseSave);

    // 7. Import Modal
    if ($("invImportBtn")) $("invImportBtn").addEventListener("click", openImportModal);
    if ($("invImportModalClose")) $("invImportModalClose").addEventListener("click", closeImportModal);
    if ($("invImportCancelBtn")) $("invImportCancelBtn").addEventListener("click", closeImportModal);
    if ($("invImportDropzone")) {
        $("invImportDropzone").addEventListener("click", () => $("invImportFileInput").click());
        $("invImportDropzone").addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
        $("invImportDropzone").addEventListener("drop", (e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleImportFileSelect(e.dataTransfer.files[0]);
            }
        });
    }
    if ($("invImportFileInput")) {
        $("invImportFileInput").addEventListener("change", (e) => {
            if (e.target.files && e.target.files[0]) {
                handleImportFileSelect(e.target.files[0]);
            }
        });
    }
    if ($("invImportConfirmBtn")) $("invImportConfirmBtn").addEventListener("click", handleImportConfirm);

    // 8. Export Modal Event Listeners
    if ($("invExportBtn")) $("invExportBtn").addEventListener("click", openExportModal);
    if ($("invExportModalClose")) $("invExportModalClose").addEventListener("click", closeExportModal);
    if ($("invExportCancelBtn")) $("invExportCancelBtn").addEventListener("click", closeExportModal);
    if ($("invExportConfirmBtn")) $("invExportConfirmBtn").addEventListener("click", handleExportConfirm);

    // Dataset card selection
    document.querySelectorAll("#exportTabOptions .export-tab-card").forEach(card => {
        card.addEventListener("click", () => {
            document.querySelectorAll("#exportTabOptions .export-tab-card").forEach(c => c.classList.remove("active"));
            card.classList.add("active");
            currentExportDataset = card.dataset.dataset || "overview";
            const radio = card.querySelector("input[type='radio']");
            if (radio) radio.checked = true;
            updateExportSummary();
        });
    });

    // Format selection
    document.querySelectorAll("#exportFormatOptions .export-format-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#exportFormatOptions .export-format-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentExportFormat = btn.dataset.format || "xlsx";
            const radio = btn.querySelector("input[type='radio']");
            if (radio) radio.checked = true;
            updateExportSummary();
        });
    });
}

// Initialization on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    loadData();
});

// Re-check auth state
onAuthStateChanged(auth, (user) => {
    if (user) {
        loadData();
    }
});

export { loadData };
