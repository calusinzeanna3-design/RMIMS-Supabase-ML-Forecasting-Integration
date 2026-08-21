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
    importedFingerprints: new Set()
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

        let activityStatus = "None";
        let activityQty = "—";
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
                <td colspan="11" style="text-align:center; padding: 36px 16px; color: var(--rm-ink-dim);">
                    <strong>No raw materials found.</strong><br>
                    <span style="font-size: 0.8rem;">Try adjusting your search criteria or filters.</span>
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = `Showing 0 of 0 raw materials`;
        if (btnsEl) btnsEl.innerHTML = "";
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
        let actBadge = `<span class="activity-badge activity-badge-none">— None</span>`;
        if (item.activityStatus === "Receive") {
            actBadge = `<span class="activity-badge activity-badge-receive">📥 Receive</span>`;
        } else if (item.activityStatus === "Disbursement") {
            actBadge = `<span class="activity-badge activity-badge-disburse">📤 Disbursement</span>`;
        }

        return `
            <tr data-id="${esc(item.id)}">
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
                    <div class="inv-action-dropdown">
                        <button type="button" class="inv-action-trigger" data-action-id="${esc(item.id)}" title="Actions">
                            ⋮
                        </button>
                        <div class="inv-action-menu" id="actionMenu_${esc(item.id)}">
                            <button type="button" class="inv-action-item action-edit-btn" data-id="${esc(item.id)}">
                                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 4H4C3.44772 4 3 4.44772 3 5V20C3 20.5523 3.44772 21 4 21H19C19.5523 21 20 20.5523 20 20V13M18.5 2.5C19.3284 1.67157 20.6716 1.67157 21.5 2.5C22.3284 3.32843 22.3284 4.67157 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                Edit / Update
                            </button>
                        </div>
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

    attachDropdownListeners();
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

function attachDropdownListeners() {
    // Close any open action menu on outside click
    document.querySelectorAll(".inv-action-trigger").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = btn.dataset.actionId;
            const menu = $(`actionMenu_${id}`);
            // Close other open action menus
            document.querySelectorAll(".inv-action-menu.open").forEach(m => {
                if (m !== menu) m.classList.remove("open");
            });
            if (menu) menu.classList.toggle("open");
        };
    });

    document.querySelectorAll(".action-edit-btn").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            document.querySelectorAll(".inv-action-menu.open").forEach(m => m.classList.remove("open"));
            openEditModal(id);
        };
    });
}

// Global click listener to close action menus
document.addEventListener("click", () => {
    document.querySelectorAll(".inv-action-menu.open").forEach(m => m.classList.remove("open"));
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
    if ($("addMatStockDate")) $("addMatStockDate").value = new Date().toISOString().slice(0, 10);

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
    $("editMatDate").value = mat.createdAt ? mat.createdAt.slice(0, 10) : "";
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
    if ($("receiptDateInput")) $("receiptDateInput").value = new Date().toISOString().slice(0, 10);
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
    if ($("disburseDateInput")) $("disburseDateInput").value = new Date().toISOString().slice(0, 10);
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

async function handleImportFileSelect(file) {
    if (!file) return;

    try {
        // Level 1: Deterministic file fingerprint deduplication
        const fingerprint = await computeFileFingerprint(file);
        if (state.importedFingerprints.has(fingerprint)) {
            toast("File already imported. No duplicate records were added.", "error");
            $("invImportPreviewArea").hidden = false;
            $("invImportPreviewArea").innerHTML = `
                <div style="padding: 16px; background: rgba(239, 68, 68, 0.08); border: 1px solid var(--red-border); border-radius: var(--radius-sm); color: #991b1b; font-size: 0.84rem;">
                    <strong>Duplicate File Detected:</strong> This exact file has already been imported previously.
                </div>
            `;
            $("invImportConfirmBtn").disabled = true;
            return;
        }

        const data = await file.arrayBuffer();
        if (typeof XLSX === "undefined") {
            toast("Excel parser library is not loaded.", "error");
            return;
        }

        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (!rows || rows.length === 0) {
            toast("The selected file contains no data rows.", "error");
            return;
        }

        // Process and categorize rows
        let validNew = 0;
        let skippedExisting = 0;
        let invalid = 0;
        parsedImportRows = [];

        rows.forEach((r, idx) => {
            // Find fields irrespective of case or slight variation
            const keys = Object.keys(r);
            const getVal = (pattern) => {
                const k = keys.find(key => pattern.test(key));
                return k ? String(r[k]).trim() : "";
            };

            const name = getVal(/material|name|item/i);
            const code = getVal(/code|id/i);
            const unit = getVal(/unit/i) || "kg";
            const minStockStr = getVal(/min|threshold/i);
            const curStockStr = getVal(/stock|current|quantity|qty/i);
            const note = getVal(/note|desc|remark/i);

            if (!name) {
                invalid++;
                return;
            }

            const normName = name.toLowerCase();
            const existingMat = state.materials.find(m => m.name.trim().toLowerCase() === normName || (code && String(m.itemCode || "").toUpperCase() === code.toUpperCase()));

            if (existingMat) {
                skippedExisting++;
            } else {
                validNew++;
                parsedImportRows.push({
                    name,
                    code,
                    unit: unit.toLowerCase(),
                    minStock: minStockStr !== "" ? Math.max(0, num(minStockStr)) : null,
                    currentStock: curStockStr !== "" ? Math.max(0, num(curStockStr)) : 0,
                    note
                });
            }
        });

        $("invImportPreviewArea").hidden = false;
        $("invImportPreviewArea").innerHTML = `
            <div class="import-summary-bar">
                <span>Total Read: <strong>${rows.length}</strong></span>
                <span style="color: var(--blue);">Valid New: <strong>${validNew}</strong></span>
                <span style="color: var(--amber);">Skipped Existing: <strong>${skippedExisting}</strong></span>
                <span style="color: var(--red);">Invalid: <strong>${invalid}</strong></span>
            </div>
            <p style="font-size: 0.78rem; color: var(--rm-ink-dim); margin-bottom: 8px;">
                Ready to import <strong>${validNew}</strong> new raw material records.
            </p>
        `;

        $("invImportConfirmBtn").disabled = validNew === 0;
        $("invImportConfirmBtn").dataset.fingerprint = fingerprint;
    } catch (err) {
        console.error("Import parse error:", err);
        toast("Failed to parse the file: " + err.message, "error");
    }
}

async function handleImportConfirm() {
    if (!parsedImportRows || parsedImportRows.length === 0) return;

    const confirmBtn = $("invImportConfirmBtn");
    const fingerprint = confirmBtn.dataset.fingerprint;
    confirmBtn.disabled = true;

    let addedCount = 0;
    try {
        for (const item of parsedImportRows) {
            // Generate next available RM code if not supplied
            let code = item.code;
            if (!code || state.materials.some(m => String(m.itemCode || "").toUpperCase() === code.toUpperCase())) {
                const existingNums = state.materials
                    .map(m => {
                        const match = String(m.itemCode || "").match(/^RM0*(\d+)$/i);
                        return match ? parseInt(match[1], 10) : 0;
                    })
                    .filter(n => n > 0);
                const maxNum = existingNums.length ? Math.max(...existingNums) : 30;
                let nextNum = maxNum + 1 + addedCount;
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
                if (item.currentStock > 0) {
                    await supabase.rpc("record_stock_receipt_v2", {
                        p_material_id: newMat.id,
                        p_receipt_date: new Date().toISOString().slice(0, 10),
                        p_quantity: item.currentStock,
                        p_unit: item.unit,
                        p_supplier_name: "Imported Balance"
                    });
                }
            }
        }

        if (fingerprint) {
            state.importedFingerprints.add(fingerprint);
        }

        toast(`Import completed: ${addedCount} raw materials added.`);
        closeImportModal();
        await loadData();
    } catch (err) {
        console.error("Import save error:", err);
        toast("Error while saving imported materials: " + err.message, "error");
    } finally {
        confirmBtn.disabled = false;
    }
}

/* ==========================================================
   EXPORT LOGIC (CSV & EXCEL ONLY — FULL FILTERED DATASET)
   ========================================================== */

function getExportDataset() {
    const data = getOverviewDataList();
    return data.map(item => [
        item.activityDate || "—",
        item.name || "",
        item.itemCode || "",
        item.minStock !== null ? `${item.minStock} ${item.unit}` : "—",
        `${item.currentStock} ${item.unit}`,
        item.unit || "",
        item.activityStatus,
        item.activityQty,
        item.activityUnit,
        item.status.label
    ]);
}

function exportToCSV() {
    const dataset = getExportDataset();
    const headers = [
        "Date",
        "Raw Material Name",
        "Raw Material ID",
        "Minimum Stock",
        "Current Stock",
        "Unit",
        "Activity Status",
        "Activity Quantity",
        "Activity Unit",
        "Status"
    ];

    const escapeCsv = (str) => `"${String(str ?? "").replace(/"/g, '""')}"`;
    const rows = [
        headers.map(escapeCsv).join(","),
        ...dataset.map(row => row.map(escapeCsv).join(","))
    ];

    const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(rows.join("\n"));
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", `RMIMS_Inventory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast("CSV export generated successfully.");
}

function exportToExcel() {
    if (typeof XLSX === "undefined") {
        toast("Excel export library not available.", "error");
        return;
    }

    const dataset = getExportDataset();
    const headers = [
        "Date",
        "Raw Material Name",
        "Raw Material ID",
        "Minimum Stock",
        "Current Stock",
        "Unit",
        "Activity Status",
        "Activity Quantity",
        "Activity Unit",
        "Status"
    ];

    const wsData = [headers, ...dataset];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory Overview");
    XLSX.writeFile(wb, `RMIMS_Inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast("Excel (.xlsx) export generated successfully.");
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
            if ($("invDateFrom")) $("invDateFrom").value = "";
            if ($("invDateTo")) $("invDateTo").value = "";
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

    // 8. Export Menu
    if ($("invExportBtn")) {
        $("invExportBtn").addEventListener("click", (e) => {
            e.stopPropagation();
            const menu = $("invExportMenu");
            if (menu) menu.hidden = !menu.hidden;
        });
    }
    if ($("exportCsvOption")) {
        $("exportCsvOption").addEventListener("click", () => {
            if ($("invExportMenu")) $("invExportMenu").hidden = true;
            exportToCSV();
        });
    }
    if ($("exportExcelOption")) {
        $("exportExcelOption").addEventListener("click", () => {
            if ($("invExportMenu")) $("invExportMenu").hidden = true;
            exportToExcel();
        });
    }
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
