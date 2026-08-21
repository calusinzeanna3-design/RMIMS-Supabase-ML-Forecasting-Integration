// js/material-activity-admin.js
//
// RMIMS V2 — Admin Material Activity Module (Clean Rebuild)
// Exact 2-Card Architecture:
// CARD 1: RECEIVE & DISBURSEMENT MANAGEMENT (Product Overview & Material Overview Tabs)
// CARD 2: ACTUAL ACTIVITY HISTORY (Chronological Transaction Ledger)
// Shared Data Contract: public.raw_materials, public.stock_receipts, public.material_disbursements
// Transaction Authority: record_stock_receipt_v2(), record_material_disbursement_v2()

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

/* ==========================================================
   ROLE GUARD & AUTHENTICATION
   ========================================================== */

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../login.html";
        return;
    }

    try {
        const { data: profile, error } = await supabase
            .from("user_profiles")
            .select("id, full_name, email, role, status")
            .eq("id", user.uid)
            .maybeSingle();

        if (error || !profile || profile.status !== "active") {
            window.location.href = "../login.html";
            return;
        }

        if (profile.role !== "admin") {
            window.location.href = "../user/dashboard.html";
            return;
        }

        currentUser = {
            uid: user.uid,
            fullName: profile.full_name || profile.email || "Admin",
            email: profile.email
        };

        const pBtn = document.getElementById("profileBtn");
        if (pBtn) {
            const pText = pBtn.querySelector(".profile-text") || pBtn;
            pText.textContent = `${currentUser.fullName} ▼`;
            const pAv = pBtn.querySelector(".avatar");
            if (pAv && currentUser.fullName) {
                pAv.textContent = currentUser.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
            }
        }

        initPage();
    } catch (e) {
        console.error("Auth guard error:", e);
        window.location.href = "../login.html";
    }
});

/* ==========================================================
   STATE
   ========================================================== */

const state = {
    materials: [],           // live from public.raw_materials
    stockReceipts: [],       // live from public.stock_receipts
    disbursements: [],       // live from public.material_disbursements
    finishedProducts: [],    // mapped products with bundled material IDs
    activities: [],          // combined unified activity list

    // Card 1 state
    card1Tab: "product",     // "product" or "material"
    productSearch: "",
    productSort: "latest",
    materialSearch: "",
    materialSort: "latest",

    // Card 2 History state
    historySearch: "",
    historyDateFrom: "",
    historyDateTo: "",
    historyActivity: "all",  // "all" | "receive" | "disbursement"
    historySort: "latest",
    historyPage: 1,
    historyPageSize: 10
};

const STORAGE_KEY = "rmims_finished_product_context";

/* ==========================================================
   HELPERS & UTILITIES
   ========================================================== */

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getInitials(name) {
    const parts = String(name || "FP").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "FP";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatDate(dateStr) {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch {
        return dateStr;
    }
}

function formatQty(val, unit = "") {
    const n = Number(val);
    if (isNaN(n)) return `0 ${unit}`.trim();
    const formatted = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return unit ? `${formatted} ${unit}` : formatted;
}

function computeStockStatus(currentStock, minStock) {
    const cur = Number(currentStock) || 0;
    const min = Number(minStock) || 0;
    if (cur <= 0) {
        return { label: "Out of Stock", cls: "status-badge-outofstock", dot: "dot-red" };
    }
    if (cur <= min) {
        return { label: "Low Stock", cls: "status-badge-lowstock", dot: "dot-orange" };
    }
    return { label: "In Stock", cls: "status-badge-instock", dot: "dot-green" };
}

function isGenericOperationalName(name) {
    if (!name) return true;
    const n = String(name).trim().toLowerCase();
    return (
        n === "operational use" ||
        n === "operational" ||
        n === "general usage" ||
        n === "general" ||
        n === "usage" ||
        n === "operational material context" ||
        n === "operational batch" ||
        n === "general production" ||
        n === "production" ||
        n === "sample usage" ||
        n === "unassigned / general stock" ||
        n === "unassigned"
    );
}

function toast(message, type = "info") {
    const stack = document.getElementById("toastStack");
    if (!stack) return;
    const t = document.createElement("div");
    t.className = `toast toast-${type} fade-in`;
    t.textContent = message;
    stack.appendChild(t);
    setTimeout(() => {
        t.style.opacity = "0";
        setTimeout(() => t.remove(), 300);
    }, 3500);
}

/* ==========================================================
   INITIALIZATION & DATA LOADING
   ========================================================== */

function initPage() {
    initEventListeners();
    loadAuthoritativeData();
}

async function loadAuthoritativeData() {
    try {
        // 1. Fetch live raw materials
        const { data: mats, error: matErr } = await supabase
            .from("raw_materials")
            .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, description, created_at")
            .order("name");

        if (matErr) throw matErr;
        state.materials = mats || [];

        // 2. Fetch stock receipts
        const { data: receipts, error: recErr } = await supabase
            .from("stock_receipts")
            .select("id, material_id, received_quantity, unit, receipt_date, supplier_name, created_at")
            .order("receipt_date", { ascending: false });

        if (recErr) throw recErr;
        state.stockReceipts = receipts || [];

        // 3. Fetch material disbursements
        const { data: disbs, error: disbErr } = await supabase
            .from("material_disbursements")
            .select("id, material_id, consumed_quantity, unit, usage_date, activity_type, finished_product_name, created_at")
            .order("usage_date", { ascending: false });

        if (disbErr) throw disbErr;
        state.disbursements = disbs || [];

        // 4. Build Finished Product Relationships
        buildFinishedProductsContext();

        // 5. Build Unified Activity Ledger
        buildUnifiedActivities();

        // 6. Populate Modal Dropdowns
        populateMaterialDropdowns();

        // 7. Render All Views
        renderCard1();
        renderCard2History();
    } catch (err) {
        console.error("Error loading authoritative data:", err);
        toast("Failed to load live data: " + (err.message || err), "error");
    }
}

function buildFinishedProductsContext() {
    // 1. Load saved context from localStorage
    let saved = [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) saved = JSON.parse(raw);
    } catch {
        saved = [];
    }

    const prodMap = new Map();

    // Add saved contexts (filtering out generic operational names)
    if (Array.isArray(saved)) {
        saved.forEach(p => {
            if (p && p.name && !isGenericOperationalName(p.name)) {
                const norm = p.name.trim().toLowerCase();
                prodMap.set(norm, {
                    id: p.id || ("fp_" + norm),
                    name: p.name.trim(),
                    imageUrl: p.imageUrl || null,
                    materialIds: Array.isArray(p.materialIds) ? p.materialIds.filter(id => state.materials.some(m => m.id === id)) : [],
                    createdAt: p.createdAt || new Date().toISOString()
                });
            }
        });
    }

    // Augment with disbursements that reference specific finished products
    state.disbursements.forEach(d => {
        const pName = (d.finished_product_name || d.activity_type || "").trim();
        if (pName && !isGenericOperationalName(pName)) {
            const norm = pName.toLowerCase();
            if (!prodMap.has(norm)) {
                prodMap.set(norm, {
                    id: "fp_" + norm,
                    name: pName,
                    imageUrl: null,
                    materialIds: d.material_id ? [d.material_id] : [],
                    createdAt: d.created_at || d.usage_date
                });
            } else {
                const item = prodMap.get(norm);
                if (d.material_id && !item.materialIds.includes(d.material_id)) {
                    item.materialIds.push(d.material_id);
                }
            }
        }
    });

    state.finishedProducts = Array.from(prodMap.values());
}

function buildUnifiedActivities() {
    const list = [];

    // Receipts as "Receive"
    state.stockReceipts.forEach(r => {
        const mat = state.materials.find(m => m.id === r.material_id);
        const qty = Number(r.received_quantity != null ? r.received_quantity : r.quantity) || 0;
        const dateVal = r.receipt_date || r.received_date || r.created_at;
        list.push({
            id: "rec_" + r.id,
            type: "receive",
            typeLabel: "Receive",
            date: dateVal,
            context: "Unassigned / General Stock",
            materialId: r.material_id,
            materialName: mat ? mat.name : "Unknown Material",
            itemCode: mat ? (mat.item_code || "—") : "—",
            quantity: qty,
            unit: r.unit || r.unit_of_measure || (mat ? mat.unit_of_measure : "kg"),
            currentStock: mat ? Number(mat.current_stock) : 0,
            minStock: mat ? Number(mat.minimum_threshold) : 0,
            rawTimestamp: new Date(dateVal).getTime()
        });
    });

    // Disbursements as "Disbursement"
    state.disbursements.forEach(d => {
        const mat = state.materials.find(m => m.id === d.material_id);
        const contextName = (d.finished_product_name || d.activity_type || "").trim();
        const qty = Number(d.consumed_quantity != null ? d.consumed_quantity : d.quantity) || 0;
        const dateVal = d.usage_date || d.disbursement_date || d.created_at;
        list.push({
            id: "disb_" + d.id,
            type: "disbursement",
            typeLabel: "Disbursement",
            date: dateVal,
            context: contextName || "General Production",
            materialId: d.material_id,
            materialName: mat ? mat.name : "Unknown Material",
            itemCode: mat ? (mat.item_code || "—") : "—",
            quantity: qty,
            unit: d.unit || d.unit_of_measure || (mat ? mat.unit_of_measure : "kg"),
            currentStock: mat ? Number(mat.current_stock) : 0,
            minStock: mat ? Number(mat.minimum_threshold) : 0,
            rawTimestamp: new Date(dateVal).getTime()
        });
    });

    state.activities = list;
}

/* ==========================================================
   CARD 1: RECEIVE & DISBURSEMENT MANAGEMENT (RENDER)
   ========================================================== */

function renderCard1() {
    if (state.card1Tab === "product") {
        renderProductOverview();
    } else {
        renderMaterialOverview();
    }
}

function renderProductOverview() {
    const container = document.getElementById("productCardsContainer");
    if (!container) return;

    const search = state.productSearch.trim().toLowerCase();

    // Filter finished products based on search (by Product Name, Raw Material Name, or Raw Material ID)
    let filtered = state.finishedProducts.filter(prod => {
        if (!search) return true;
        // Match product name
        if (prod.name.toLowerCase().includes(search)) return true;

        // Match associated raw materials name or ID
        const hasMatchingMat = prod.materialIds.some(mId => {
            const mat = state.materials.find(m => m.id === mId);
            if (!mat) return false;
            return mat.name.toLowerCase().includes(search) || (mat.item_code && mat.item_code.toLowerCase().includes(search));
        });

        return hasMatchingMat;
    });

    // Sort
    filtered.sort((a, b) => {
        if (state.productSort === "az") return a.name.localeCompare(b.name);
        if (state.productSort === "za") return b.name.localeCompare(a.name);
        if (state.productSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="ma-empty-state">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                <p>No finished products match your search criteria.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(prod => {
        // Compute bundled metrics
        // 1. Material chips
        const matItems = prod.materialIds.map(mId => state.materials.find(m => m.id === mId)).filter(Boolean);
        const chipsHtml = matItems.length > 0
            ? matItems.map(m => `<span class="ma-item-chip">${escapeHtml(m.name)}</span>`).join("")
            : `<span style="font-size:0.75rem; color: var(--rm-ink-dim);">No linked materials</span>`;

        // 2. Total received for this product's materials
        let totalReceived = 0;
        let unit = matItems[0]?.unit_of_measure || "kg";
        prod.materialIds.forEach(mId => {
            state.stockReceipts.forEach(r => {
                if (r.material_id === mId) {
                    totalReceived += Number(r.received_quantity != null ? r.received_quantity : r.quantity) || 0;
                }
            });
        });

        // 3. Total disbursed strictly with this product context
        let totalDisbursed = 0;
        state.disbursements.forEach(d => {
            const pName = (d.finished_product_name || d.activity_type || "").trim().toLowerCase();
            if (pName === prod.name.toLowerCase() && prod.materialIds.includes(d.material_id)) {
                totalDisbursed += Number(d.consumed_quantity != null ? d.consumed_quantity : d.quantity) || 0;
            }
        });

        const avatarHtml = prod.imageUrl
            ? `<div class="ma-card-avatar"><img src="${escapeHtml(prod.imageUrl)}" alt="${escapeHtml(prod.name)}" class="ma-card-avatar-img"></div>`
            : `<div class="ma-card-avatar"><span>${escapeHtml(getInitials(prod.name))}</span></div>`;

        return `
            <div class="ma-overview-card fade-in">
                <div>
                    <div class="ma-card-top-info">
                        ${avatarHtml}
                        <div class="ma-card-head-text">
                            <h3 class="ma-card-item-title" title="${escapeHtml(prod.name)}">${escapeHtml(prod.name)}</h3>
                            <div class="ma-card-badge-row">
                                <span class="status-badge" style="background:#f1f5f9; color:#475569; border: 1px solid #e2e8f0;">
                                    ${matItems.length} Raw Material${matItems.length === 1 ? "" : "s"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="ma-bundled-section" style="margin-top: 12px;">
                        <span class="ma-bundled-label">Associated Materials</span>
                        <div class="ma-bundled-chips">
                            ${chipsHtml}
                        </div>
                    </div>

                    <div class="ma-metrics-row" style="margin-top: 12px;">
                        <div class="ma-metric-box">
                            <span class="ma-metric-label">Total Received</span>
                            <span class="ma-metric-value val-received">${formatQty(totalReceived, unit)}</span>
                        </div>
                        <div class="ma-metric-box">
                            <span class="ma-metric-label">Total Disbursed</span>
                            <span class="ma-metric-value val-disbursed">${formatQty(totalDisbursed, unit)}</span>
                        </div>
                    </div>
                </div>

                <div>
                    <div class="ma-card-actions">
                        <button type="button" class="btn-sm ma-btn-receive btn-receive-for-prod" data-prod-id="${escapeHtml(prod.id)}">
                            Receive
                        </button>
                        <button type="button" class="btn-sm ma-btn-disburse btn-disburse-for-prod" data-prod-id="${escapeHtml(prod.id)}">
                            Disburse
                        </button>
                    </div>
                    <button type="button" class="btn-sm ma-btn-breakdown btn-view-prod-breakdown" data-prod-id="${escapeHtml(prod.id)}" style="width: 100%; margin-top: 6px;">
                        View Breakdown
                    </button>
                </div>
            </div>
        `;
    }).join("");

    // Attach Event Listeners to Product Card buttons
    container.querySelectorAll(".btn-receive-for-prod").forEach(btn => {
        btn.addEventListener("click", () => {
            const pId = btn.getAttribute("data-prod-id");
            const prod = state.finishedProducts.find(p => p.id === pId);
            openReceiveModal(prod?.materialIds[0] || null, prod?.name || null);
        });
    });

    container.querySelectorAll(".btn-disburse-for-prod").forEach(btn => {
        btn.addEventListener("click", () => {
            const pId = btn.getAttribute("data-prod-id");
            const prod = state.finishedProducts.find(p => p.id === pId);
            openDisburseModal(prod?.materialIds[0] || null, prod?.name || null);
        });
    });

    container.querySelectorAll(".btn-view-prod-breakdown").forEach(btn => {
        btn.addEventListener("click", () => {
            const pId = btn.getAttribute("data-prod-id");
            const prod = state.finishedProducts.find(p => p.id === pId);
            if (prod) openProductBreakdownModal(prod);
        });
    });
}

function renderMaterialOverview() {
    const tbody = document.getElementById("materialOverviewTableBody");
    if (!tbody) return;

    const search = state.materialSearch.trim().toLowerCase();

    // Filter raw materials based on search (by Material Name, Material ID, or Associated Finished Products)
    let filtered = state.materials.filter(mat => {
        if (!search) return true;
        // Match material name or code
        if (mat.name.toLowerCase().includes(search)) return true;
        if (mat.item_code && mat.item_code.toLowerCase().includes(search)) return true;

        // Match associated finished product name
        const hasMatchingProd = state.finishedProducts.some(p => {
            return p.materialIds.includes(mat.id) && p.name.toLowerCase().includes(search);
        });

        return hasMatchingProd;
    });

    // Sort
    filtered.sort((a, b) => {
        if (state.materialSort === "az") return a.name.localeCompare(b.name);
        if (state.materialSort === "za") return b.name.localeCompare(a.name);
        if (state.materialSort === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; padding: 32px; color: var(--rm-ink-dim);">
                    No raw materials match your search criteria.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(mat => {
        const curStock = Number(mat.current_stock) || 0;
        const minStock = Number(mat.minimum_threshold) || 0;
        const unit = mat.unit_of_measure || "kg";
        const status = computeStockStatus(curStock, minStock);

        // Calculate total received for this material
        let totalReceived = 0;
        state.stockReceipts.forEach(r => {
            if (r.material_id === mat.id) {
                totalReceived += Number(r.received_quantity != null ? r.received_quantity : r.quantity) || 0;
            }
        });

        // Calculate total disbursed for this material & usage by finished product
        let totalDisbursed = 0;
        const prodUsageMap = new Map();

        state.disbursements.forEach(d => {
            if (d.material_id === mat.id) {
                const qty = Number(d.consumed_quantity != null ? d.consumed_quantity : d.quantity) || 0;
                totalDisbursed += qty;
                const pName = (d.finished_product_name || d.activity_type || "").trim() || "General Usage";
                if (!isGenericOperationalName(pName)) {
                    prodUsageMap.set(pName, (prodUsageMap.get(pName) || 0) + qty);
                }
            }
        });

        // Associated products list
        const associatedProds = state.finishedProducts.filter(p => p.materialIds.includes(mat.id));
        associatedProds.forEach(p => {
            if (!prodUsageMap.has(p.name)) {
                prodUsageMap.set(p.name, 0);
            }
        });

        const prodChipsHtml = Array.from(prodUsageMap.entries()).length > 0
            ? Array.from(prodUsageMap.entries()).map(([pName, qty]) => {
                return `<span class="ma-item-chip">${escapeHtml(pName)}${qty > 0 ? ` (${formatQty(qty, unit)})` : ""}</span>`;
            }).join(" ")
            : `<span style="font-size:0.75rem; color: var(--rm-ink-dim);">No finished products mapped</span>`;

        return `
            <tr>
                <td><strong>${escapeHtml(mat.name)}</strong></td>
                <td><span class="mat-id-badge">${escapeHtml(mat.item_code || "RM—")}</span></td>
                <td><strong>${formatQty(curStock, unit)}</strong></td>
                <td>${formatQty(minStock, unit)}</td>
                <td style="max-width: 240px;"><div style="display:flex; flex-wrap:wrap; gap:4px;">${prodChipsHtml}</div></td>
                <td><strong class="val-received" style="color:#16a34a;">${formatQty(totalReceived, unit)}</strong></td>
                <td><strong class="val-disbursed" style="color:#ea580c;">${formatQty(totalDisbursed, unit)}</strong></td>
                <td>
                    <span class="status-badge ${status.cls}">
                        <span class="badge-dot ${status.dot}"></span>${status.label}
                    </span>
                </td>
                <td style="text-align: center;">
                    <div class="ma-table-actions">
                        <button type="button" class="btn-tbl-action btn-tbl-receive btn-receive-for-mat" data-mat-id="${escapeHtml(mat.id)}">
                            Receive
                        </button>
                        <button type="button" class="btn-tbl-action btn-tbl-disburse btn-disburse-for-mat" data-mat-id="${escapeHtml(mat.id)}">
                            Disburse
                        </button>
                        <button type="button" class="btn-tbl-action btn-tbl-breakdown btn-view-mat-breakdown" data-mat-id="${escapeHtml(mat.id)}">
                            Breakdown
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    // Attach Event Listeners to Table Row buttons
    tbody.querySelectorAll(".btn-receive-for-mat").forEach(btn => {
        btn.addEventListener("click", () => {
            const mId = btn.getAttribute("data-mat-id");
            openReceiveModal(mId);
        });
    });

    tbody.querySelectorAll(".btn-disburse-for-mat").forEach(btn => {
        btn.addEventListener("click", () => {
            const mId = btn.getAttribute("data-mat-id");
            openDisburseModal(mId);
        });
    });

    tbody.querySelectorAll(".btn-view-mat-breakdown").forEach(btn => {
        btn.addEventListener("click", () => {
            const mId = btn.getAttribute("data-mat-id");
            const mat = state.materials.find(m => m.id === mId);
            if (mat) openMaterialBreakdownModal(mat);
        });
    });
}

/* ==========================================================
   CARD 2: ACTUAL ACTIVITY HISTORY (RENDER)
   ========================================================== */

function renderCard2History() {
    const tbody = document.getElementById("activityHistoryTableBody");
    const countEl = document.getElementById("historyResultCount");
    const paginationEl = document.getElementById("historyPaginationBtns");
    const totalCountEl = document.getElementById("histTotalCount");
    const recCountEl = document.getElementById("histReceivedCount");
    const disbCountEl = document.getElementById("histDisbursedCount");

    if (!tbody) return;

    // 1. Filter
    const search = state.historySearch.trim().toLowerCase();
    const fromDate = state.historyDateFrom ? new Date(state.historyDateFrom).getTime() : null;
    const toDate = state.historyDateTo ? new Date(state.historyDateTo + "T23:59:59").getTime() : null;

    let filtered = state.activities.filter(act => {
        // Activity filter
        if (state.historyActivity === "receive" && act.type !== "receive") return false;
        if (state.historyActivity === "disbursement" && act.type !== "disbursement") return false;

        // Date range filter
        if (fromDate && act.rawTimestamp < fromDate) return false;
        if (toDate && act.rawTimestamp > toDate) return false;

        // Search (by Finished Product Context, Raw Material Name, or Raw Material ID)
        if (search) {
            const matchContext = act.context.toLowerCase().includes(search);
            const matchMatName = act.materialName.toLowerCase().includes(search);
            const matchMatId = act.itemCode.toLowerCase().includes(search);
            if (!matchContext && !matchMatName && !matchMatId) return false;
        }

        return true;
    });

    // Update Totals Badges dynamically based on filtered set
    let receivedCount = 0;
    let disbursedCount = 0;
    filtered.forEach(a => {
        if (a.type === "receive") receivedCount++;
        if (a.type === "disbursement") disbursedCount++;
    });

    if (totalCountEl) totalCountEl.textContent = filtered.length.toLocaleString();
    if (recCountEl) recCountEl.textContent = receivedCount.toLocaleString();
    if (disbCountEl) disbCountEl.textContent = disbursedCount.toLocaleString();

    // 2. Sort
    filtered.sort((a, b) => {
        if (state.historySort === "oldest") return a.rawTimestamp - b.rawTimestamp;
        if (state.historySort === "az") return a.materialName.localeCompare(b.materialName);
        if (state.historySort === "za") return b.materialName.localeCompare(a.materialName);
        return b.rawTimestamp - a.rawTimestamp; // default latest
    });

    // 3. Paginate
    const totalRecords = filtered.length;
    const totalPages = Math.ceil(totalRecords / state.historyPageSize) || 1;
    if (state.historyPage > totalPages) state.historyPage = totalPages;
    if (state.historyPage < 1) state.historyPage = 1;

    const startIdx = (state.historyPage - 1) * state.historyPageSize;
    const pageRecords = filtered.slice(startIdx, startIdx + state.historyPageSize);

    // 4. Render Table
    if (pageRecords.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; padding: 32px; color: var(--rm-ink-dim);">
                    No actual activity records match the selected filters.
                </td>
            </tr>
        `;
    } else {
        tbody.innerHTML = pageRecords.map(act => {
            const status = computeStockStatus(act.currentStock, act.minStock);
            const badgeClass = act.type === "receive" ? "activity-badge-receive" : "activity-badge-disburse";
            return `
                <tr>
                    <td><strong>${escapeHtml(formatDate(act.date))}</strong></td>
                    <td>${escapeHtml(act.context)}</td>
                    <td><strong>${escapeHtml(act.materialName)}</strong></td>
                    <td><span class="mat-id-badge">${escapeHtml(act.itemCode)}</span></td>
                    <td><span class="activity-badge ${badgeClass}">${escapeHtml(act.typeLabel)}</span></td>
                    <td><strong>${formatQty(act.quantity)}</strong></td>
                    <td>${escapeHtml(act.unit)}</td>
                    <td>${formatQty(act.currentStock, act.unit)}</td>
                    <td>
                        <span class="status-badge ${status.cls}">
                            <span class="badge-dot ${status.dot}"></span>${status.label}
                        </span>
                    </td>
                </tr>
            `;
        }).join("");
    }

    // 5. Update Pagination Info & Buttons
    if (countEl) {
        if (totalRecords === 0) {
            countEl.textContent = "Showing 0 of 0 activities";
        } else {
            const endIdx = Math.min(startIdx + state.historyPageSize, totalRecords);
            countEl.textContent = `Showing ${startIdx + 1}–${endIdx} of ${totalRecords.toLocaleString()} activities`;
        }
    }

    if (paginationEl) {
        if (totalPages <= 1) {
            paginationEl.innerHTML = "";
            return;
        }

        let buttonsHtml = `
            <button type="button" class="btn-page" id="histPrevBtn" ${state.historyPage === 1 ? "disabled" : ""}>
                ‹ Prev
            </button>
        `;

        for (let p = 1; p <= totalPages; p++) {
            if (p === 1 || p === totalPages || (p >= state.historyPage - 1 && p <= state.historyPage + 1)) {
                buttonsHtml += `
                    <button type="button" class="btn-page ${p === state.historyPage ? "active" : ""}" data-page="${p}">
                        ${p}
                    </button>
                `;
            } else if (p === state.historyPage - 2 || p === state.historyPage + 2) {
                buttonsHtml += `<span class="page-ellipsis">…</span>`;
            }
        }

        buttonsHtml += `
            <button type="button" class="btn-page" id="histNextBtn" ${state.historyPage === totalPages ? "disabled" : ""}>
                Next ›
            </button>
        `;

        paginationEl.innerHTML = buttonsHtml;

        const prevBtn = document.getElementById("histPrevBtn");
        if (prevBtn) {
            prevBtn.addEventListener("click", () => {
                if (state.historyPage > 1) {
                    state.historyPage--;
                    renderCard2History();
                }
            });
        }

        const nextBtn = document.getElementById("histNextBtn");
        if (nextBtn) {
            nextBtn.addEventListener("click", () => {
                if (state.historyPage < totalPages) {
                    state.historyPage++;
                    renderCard2History();
                }
            });
        }

        paginationEl.querySelectorAll(".btn-page[data-page]").forEach(btn => {
            btn.addEventListener("click", () => {
                const p = Number(btn.getAttribute("data-page"));
                if (p && p !== state.historyPage) {
                    state.historyPage = p;
                    renderCard2History();
                }
            });
        });
    }
}

/* ==========================================================
   MODALS: BREAKDOWN MODALS
   ========================================================== */

function openProductBreakdownModal(prod) {
    const overlay = document.getElementById("productBreakdownModalOverlay");
    const title = document.getElementById("prodBreakdownTitle");
    const subtitle = document.getElementById("prodBreakdownSubtitle");
    const tbody = document.getElementById("prodBreakdownTableBody");

    if (!overlay || !tbody) return;

    if (title) title.textContent = `${prod.name} — Breakdown`;
    if (subtitle) subtitle.textContent = `Associated raw materials and actual movement for ${prod.name}`;

    const matItems = prod.materialIds.map(mId => state.materials.find(m => m.id === mId)).filter(Boolean);

    if (matItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--rm-ink-dim);">No raw materials mapped to this product.</td></tr>`;
    } else {
        tbody.innerHTML = matItems.map(mat => {
            const unit = mat.unit_of_measure || "kg";
            let received = 0;
            state.stockReceipts.forEach(r => {
                if (r.material_id === mat.id) {
                    received += Number(r.received_quantity != null ? r.received_quantity : r.quantity) || 0;
                }
            });

            let disbursed = 0;
            state.disbursements.forEach(d => {
                const pName = (d.finished_product_name || d.activity_type || "").trim().toLowerCase();
                if (pName === prod.name.toLowerCase() && d.material_id === mat.id) {
                    disbursed += Number(d.consumed_quantity != null ? d.consumed_quantity : d.quantity) || 0;
                }
            });

            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(mat.name)}</strong>
                        <span class="mat-id-badge" style="margin-left: 6px;">${escapeHtml(mat.item_code || "RM—")}</span>
                    </td>
                    <td><strong class="val-received" style="color:#16a34a;">${formatQty(received, unit)}</strong></td>
                    <td><strong class="val-disbursed" style="color:#ea580c;">${formatQty(disbursed, unit)}</strong></td>
                    <td><strong>${formatQty(mat.current_stock, unit)}</strong></td>
                    <td>${escapeHtml(unit)}</td>
                    <td style="text-align: center;">
                        <div class="ma-table-actions" style="justify-content: center;">
                            <button type="button" class="btn-tbl-action btn-tbl-receive btn-breakdown-row-receive" data-mat-id="${escapeHtml(mat.id)}" data-prod-name="${escapeHtml(prod.name)}">
                                Receive
                            </button>
                            <button type="button" class="btn-tbl-action btn-tbl-disburse btn-breakdown-row-disburse" data-mat-id="${escapeHtml(mat.id)}" data-prod-name="${escapeHtml(prod.name)}">
                                Disburse
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");

        // Attach listeners to breakdown row buttons
        tbody.querySelectorAll(".btn-breakdown-row-receive").forEach(b => {
            b.addEventListener("click", () => {
                const mId = b.getAttribute("data-mat-id");
                const pName = b.getAttribute("data-prod-name");
                closeProductBreakdownModal();
                openReceiveModal(mId, pName);
            });
        });

        tbody.querySelectorAll(".btn-breakdown-row-disburse").forEach(b => {
            b.addEventListener("click", () => {
                const mId = b.getAttribute("data-mat-id");
                const pName = b.getAttribute("data-prod-name");
                closeProductBreakdownModal();
                openDisburseModal(mId, pName);
            });
        });
    }

    overlay.classList.add("open", "active");
}

function closeProductBreakdownModal() {
    const overlay = document.getElementById("productBreakdownModalOverlay");
    if (overlay) overlay.classList.remove("open", "active");
}

function openMaterialBreakdownModal(mat) {
    const overlay = document.getElementById("materialBreakdownModalOverlay");
    const title = document.getElementById("matBreakdownTitle");
    const subtitle = document.getElementById("matBreakdownSubtitle");
    const curStockEl = document.getElementById("matBreakdownCurrentStock");
    const minStockEl = document.getElementById("matBreakdownMinStock");
    const statusEl = document.getElementById("matBreakdownStatus");
    const totalRecEl = document.getElementById("matBreakdownTotalReceived");
    const totalDisbEl = document.getElementById("matBreakdownTotalDisbursed");
    const tbody = document.getElementById("matBreakdownProductsTableBody");

    if (!overlay) return;

    const unit = mat.unit_of_measure || "kg";
    const curStock = Number(mat.current_stock) || 0;
    const minStock = Number(mat.minimum_threshold) || 0;
    const status = computeStockStatus(curStock, minStock);

    if (title) title.textContent = `${mat.name} (${mat.item_code || "RM—"}) — Breakdown`;
    if (subtitle) subtitle.textContent = `Usage breakdown across finished products`;

    let totalReceived = 0;
    state.stockReceipts.forEach(r => {
        if (r.material_id === mat.id) {
            totalReceived += Number(r.received_quantity != null ? r.received_quantity : r.quantity) || 0;
        }
    });

    let totalDisbursed = 0;
    const prodUsageMap = new Map();

    state.disbursements.forEach(d => {
        if (d.material_id === mat.id) {
            const qty = Number(d.consumed_quantity != null ? d.consumed_quantity : d.quantity) || 0;
            totalDisbursed += qty;
            const pName = (d.finished_product_name || d.activity_type || "").trim() || "General Usage";
            if (!isGenericOperationalName(pName)) {
                prodUsageMap.set(pName, (prodUsageMap.get(pName) || 0) + qty);
            }
        }
    });

    if (curStockEl) curStockEl.textContent = formatQty(curStock, unit);
    if (minStockEl) minStockEl.textContent = formatQty(minStock, unit);
    if (statusEl) {
        statusEl.innerHTML = `<span class="status-badge ${status.cls}"><span class="badge-dot ${status.dot}"></span>${status.label}</span>`;
    }
    if (totalRecEl) totalRecEl.textContent = formatQty(totalReceived, unit);
    if (totalDisbEl) totalDisbEl.textContent = formatQty(totalDisbursed, unit);

    if (tbody) {
        const entries = Array.from(prodUsageMap.entries());
        if (entries.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--rm-ink-dim);">No product disbursements recorded yet.</td></tr>`;
        } else {
            tbody.innerHTML = entries.map(([pName, qty]) => `
                <tr>
                    <td><strong>${escapeHtml(pName)}</strong></td>
                    <td><strong class="val-disbursed">${formatQty(qty, unit)}</strong></td>
                    <td>${escapeHtml(unit)}</td>
                </tr>
            `).join("");
        }
    }

    overlay.classList.add("open", "active");
}

function closeMaterialBreakdownModal() {
    const overlay = document.getElementById("materialBreakdownModalOverlay");
    if (overlay) overlay.classList.remove("open", "active");
}

/* ==========================================================
   MODALS: RECEIVE & DISBURSEMENT OPERATIONS
   ========================================================== */

function populateMaterialDropdowns() {
    const recSelect = document.getElementById("maReceiveMaterialSelect");
    const disbSelect = document.getElementById("maDisburseMaterialSelect");

    const optionsHtml = state.materials.map(m => {
        return `<option value="${escapeHtml(m.id)}" data-unit="${escapeHtml(m.unit_of_measure || "kg")}" data-stock="${m.current_stock}">
            ${escapeHtml(m.name)} (${escapeHtml(m.item_code || "RM—")}) — Available: ${formatQty(m.current_stock, m.unit_of_measure)}
        </option>`;
    }).join("");

    if (recSelect) {
        recSelect.innerHTML = `<option value="">Select Raw Material...</option>` + optionsHtml;
        recSelect.addEventListener("change", () => {
            const opt = recSelect.selectedOptions[0];
            const unit = opt ? opt.getAttribute("data-unit") : "kg";
            const unitInput = document.getElementById("maReceiveUnitDisplay");
            if (unitInput) unitInput.value = unit || "kg";
        });
    }

    if (disbSelect) {
        disbSelect.innerHTML = `<option value="">Select Raw Material...</option>` + optionsHtml;
        disbSelect.addEventListener("change", () => {
            const opt = disbSelect.selectedOptions[0];
            const unit = opt ? opt.getAttribute("data-unit") : "kg";
            const unitInput = document.getElementById("maDisburseUnitDisplay");
            if (unitInput) unitInput.value = unit || "kg";
        });
    }
}

function openReceiveModal(preselectedMatId = null, preselectedContext = null) {
    const overlay = document.getElementById("maReceiveModalOverlay");
    const form = document.getElementById("maReceiveForm");
    const matSelect = document.getElementById("maReceiveMaterialSelect");
    const matDisplayWrap = document.getElementById("maReceiveMaterialDisplayWrap");
    const matAvatar = document.getElementById("maReceiveMatAvatar");
    const matNameDisplay = document.getElementById("maReceiveMatNameDisplay");
    const matCodeDisplay = document.getElementById("maReceiveMatCodeDisplay");
    const matStockDisplay = document.getElementById("maReceiveMatStockDisplay");

    const qtyInput = document.getElementById("maReceiveQuantityInput");
    const unitInput = document.getElementById("maReceiveUnitDisplay");
    const dateInput = document.getElementById("maReceiveDateInput");
    const supplierInput = document.getElementById("maReceiveSupplierInput");
    const contextInput = document.getElementById("maReceiveProductContextInput");

    if (!overlay) return;

    if (form) form.reset();
    clearModalErrors("maReceive");

    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
    if (contextInput && preselectedContext) contextInput.value = preselectedContext;

    if (qtyInput) qtyInput.value = "1";

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
        }
    } else {
        if (matSelect) {
            matSelect.style.display = "block";
            const opt = matSelect.selectedOptions[0];
            if (unitInput) unitInput.value = opt ? opt.getAttribute("data-unit") : "kg";
        }
        if (matDisplayWrap) matDisplayWrap.style.display = "none";
    }

    overlay.classList.add("open", "active");
    if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
    }
}

function closeReceiveModal() {
    const overlay = document.getElementById("maReceiveModalOverlay");
    if (overlay) overlay.classList.remove("open", "active");
}

async function handleSaveReceive() {
    const matSelect = document.getElementById("maReceiveMaterialSelect");
    const qtyInput = document.getElementById("maReceiveQuantityInput");
    const dateInput = document.getElementById("maReceiveDateInput");
    const supplierInput = document.getElementById("maReceiveSupplierInput");
    const saveBtn = document.getElementById("maReceiveSaveBtn");

    clearModalErrors("maReceive");

    const matId = matSelect ? matSelect.value : "";
    const qty = Number(qtyInput ? qtyInput.value : 0);
    const date = dateInput ? dateInput.value : "";
    const supplier = supplierInput ? supplierInput.value.trim() : "";

    let hasError = false;
    if (!matId) {
        setFieldError("maReceiveMaterialError", "Please select a raw material.");
        hasError = true;
    }
    if (!qty || isNaN(qty) || qty <= 0) {
        setFieldError("maReceiveQuantityError", "Quantity must be greater than 0.");
        hasError = true;
    }
    if (!date) {
        setFieldError("maReceiveDateError", "Receipt date is required.");
        hasError = true;
    }

    if (hasError) return;

    const mat = state.materials.find(m => m.id === matId);
    if (saveBtn) saveBtn.disabled = true;

    try {
        const { error } = await supabase.rpc("record_stock_receipt_v2", {
            p_material_id: matId,
            p_receipt_date: date,
            p_quantity: qty,
            p_unit: mat?.unit_of_measure || "kg",
            p_supplier_name: supplier || null
        });

        if (error) throw error;

        toast(`Received ${formatQty(qty, mat?.unit_of_measure)} of ${mat?.name}`, "success");
        closeReceiveModal();
        await loadAuthoritativeData();
    } catch (err) {
        console.error("Save receipt error:", err);
        toast("Failed to record receipt: " + (err.message || err), "error");
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function openDisburseModal(preselectedMatId = null, preselectedProduct = null) {
    const overlay = document.getElementById("maDisburseModalOverlay");
    const form = document.getElementById("maDisburseForm");
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

    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
    if (prodInput && preselectedProduct) prodInput.value = preselectedProduct;

    if (qtyInput) qtyInput.value = "1";

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
        }
    } else {
        if (matSelect) {
            matSelect.style.display = "block";
            const opt = matSelect.selectedOptions[0];
            if (unitInput) unitInput.value = opt ? opt.getAttribute("data-unit") : "kg";
        }
        if (matDisplayWrap) matDisplayWrap.style.display = "none";
    }

    overlay.classList.add("open", "active");
    if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
    }
}

function closeDisburseModal() {
    const overlay = document.getElementById("maDisburseModalOverlay");
    if (overlay) overlay.classList.remove("open", "active");
}

async function handleSaveDisburse() {
    const matSelect = document.getElementById("maDisburseMaterialSelect");
    const qtyInput = document.getElementById("maDisburseQuantityInput");
    const prodInput = document.getElementById("maDisburseProductSelect");
    const dateInput = document.getElementById("maDisburseDateInput");
    const saveBtn = document.getElementById("maDisburseSaveBtn");

    clearModalErrors("maDisburse");

    const matId = matSelect ? matSelect.value : "";
    const qty = Number(qtyInput ? qtyInput.value : 0);
    const productContext = prodInput ? prodInput.value.trim() : "";
    const date = dateInput ? dateInput.value : "";

    const mat = state.materials.find(m => m.id === matId);

    let hasError = false;
    if (!matId || !mat) {
        setFieldError("maDisburseMaterialError", "Please select a raw material.");
        hasError = true;
    }
    if (!qty || isNaN(qty) || qty <= 0) {
        setFieldError("maDisburseQuantityError", "Quantity must be greater than 0.");
        hasError = true;
    }
    if (!productContext) {
        setFieldError("maDisburseProductError", "Finished product or context is required.");
        hasError = true;
    }
    if (!date) {
        setFieldError("maDisburseDateError", "Disbursement date is required.");
        hasError = true;
    }

    // Critical Stock Protection: Reject if requested > available stock
    if (mat && qty > Number(mat.current_stock)) {
        setFieldError("maDisburseQuantityError", `Insufficient stock. Available: ${formatQty(mat.current_stock, mat.unit_of_measure)}.`);
        hasError = true;
    }

    if (hasError) return;

    if (saveBtn) saveBtn.disabled = true;

    try {
        const { error } = await supabase.rpc("record_material_disbursement_v2", {
            p_material_id: matId,
            p_usage_date: date,
            p_quantity: qty,
            p_unit: mat.unit_of_measure || "kg",
            p_activity_type: productContext,
            p_finished_product_name: productContext
        });

        if (error) throw error;

        toast(`Disbursed ${formatQty(qty, mat.unit_of_measure)} for ${productContext}`, "success");
        closeDisburseModal();
        await loadAuthoritativeData();
    } catch (err) {
        console.error("Save disbursement error:", err);
        toast("Failed to record disbursement: " + (err.message || err), "error");
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function setFieldError(elementId, msg = "") {
    const el = document.getElementById(elementId);
    if (el) el.textContent = msg;
}

function clearModalErrors(prefix) {
    document.querySelectorAll(`[id^="${prefix}"][id$="Error"]`).forEach(el => el.textContent = "");
}

/* ==========================================================
   EVENT LISTENERS & BINDINGS
   ========================================================== */

function initEventListeners() {
    // Card 1 Tabs (Product Overview & Material Overview)
    const tabProd = document.getElementById("tabBtnProductOverview");
    const tabMat = document.getElementById("tabBtnMaterialOverview");
    const viewProd = document.getElementById("viewProductOverview");
    const viewMat = document.getElementById("viewMaterialOverview");

    if (tabProd && tabMat && viewProd && viewMat) {
        tabProd.addEventListener("click", () => {
            state.card1Tab = "product";
            tabProd.classList.add("active");
            tabMat.classList.remove("active");
            viewProd.hidden = false;
            viewMat.hidden = true;
            renderProductOverview();
        });

        tabMat.addEventListener("click", () => {
            state.card1Tab = "material";
            tabMat.classList.add("active");
            tabProd.classList.remove("active");
            viewMat.hidden = false;
            viewProd.hidden = true;
            renderMaterialOverview();
        });
    }

    // Card 1: Product Overview Filters
    const prodSearch = document.getElementById("productSearchInput");
    if (prodSearch) {
        prodSearch.addEventListener("input", () => {
            state.productSearch = prodSearch.value;
            renderProductOverview();
        });
    }

    const prodSort = document.getElementById("productSortSelect");
    if (prodSort) {
        prodSort.addEventListener("change", () => {
            state.productSort = prodSort.value;
            renderProductOverview();
        });
    }

    // Card 1: Material Overview Filters
    const matSearch = document.getElementById("materialSearchInput");
    if (matSearch) {
        matSearch.addEventListener("input", () => {
            state.materialSearch = matSearch.value;
            renderMaterialOverview();
        });
    }

    const matSort = document.getElementById("materialSortSelect");
    if (matSort) {
        matSort.addEventListener("change", () => {
            state.materialSort = matSort.value;
            renderMaterialOverview();
        });
    }

    // Card 2: Actual Activity History Filters
    const histSearch = document.getElementById("historySearchInput");
    if (histSearch) {
        histSearch.addEventListener("input", () => {
            state.historySearch = histSearch.value;
            state.historyPage = 1;
            renderCard2History();
        });
    }

    const histDateFrom = document.getElementById("historyDateFrom");
    if (histDateFrom) {
        histDateFrom.addEventListener("change", () => {
            state.historyDateFrom = histDateFrom.value;
            state.historyPage = 1;
            renderCard2History();
        });
    }

    const histDateTo = document.getElementById("historyDateTo");
    if (histDateTo) {
        histDateTo.addEventListener("change", () => {
            state.historyDateTo = histDateTo.value;
            state.historyPage = 1;
            renderCard2History();
        });
    }

    const histActivity = document.getElementById("historyActivityFilter");
    if (histActivity) {
        histActivity.addEventListener("change", () => {
            state.historyActivity = histActivity.value;
            state.historyPage = 1;
            renderCard2History();
        });
    }

    const histSort = document.getElementById("historySortSelect");
    if (histSort) {
        histSort.addEventListener("change", () => {
            state.historySort = histSort.value;
            state.historyPage = 1;
            renderCard2History();
        });
    }

    const histPageSize = document.getElementById("historyPageSize");
    if (histPageSize) {
        histPageSize.addEventListener("change", () => {
            state.historyPageSize = Number(histPageSize.value) || 10;
            state.historyPage = 1;
            renderCard2History();
        });
    }

    // Stepper buttons for Receive Modal (+ and -)
    const recMinus = document.getElementById("maReceiveMinusBtn");
    const recPlus = document.getElementById("maReceivePlusBtn");
    const recQty = document.getElementById("maReceiveQuantityInput");
    if (recMinus && recQty) {
        recMinus.addEventListener("click", () => {
            let current = parseFloat(recQty.value) || 0;
            if (current > 1) {
                recQty.value = current % 1 === 0 ? Math.max(1, current - 1) : Math.max(0.01, (current - 1).toFixed(2));
            } else {
                recQty.value = "1";
            }
        });
    }
    if (recPlus && recQty) {
        recPlus.addEventListener("click", () => {
            let current = parseFloat(recQty.value) || 0;
            recQty.value = current % 1 === 0 ? (current + 1) : (current + 1).toFixed(2);
        });
    }

    // Stepper buttons for Disburse Modal (+ and -)
    const disbMinus = document.getElementById("maDisburseMinusBtn");
    const disbPlus = document.getElementById("maDisbursePlusBtn");
    const disbQty = document.getElementById("maDisburseQuantityInput");
    if (disbMinus && disbQty) {
        disbMinus.addEventListener("click", () => {
            let current = parseFloat(disbQty.value) || 0;
            if (current > 1) {
                disbQty.value = current % 1 === 0 ? Math.max(1, current - 1) : Math.max(0.01, (current - 1).toFixed(2));
            } else {
                disbQty.value = "1";
            }
        });
    }
    if (disbPlus && disbQty) {
        disbPlus.addEventListener("click", () => {
            let current = parseFloat(disbQty.value) || 0;
            disbQty.value = current % 1 === 0 ? (current + 1) : (current + 1).toFixed(2);
        });
    }

    // Modal Action Buttons & Close Triggers
    const recSaveBtn = document.getElementById("maReceiveSaveBtn");
    if (recSaveBtn) recSaveBtn.addEventListener("click", handleSaveReceive);

    const recCloseBtn = document.getElementById("maReceiveModalClose");
    if (recCloseBtn) recCloseBtn.addEventListener("click", closeReceiveModal);

    const recCancelBtn = document.getElementById("maReceiveCancelBtn");
    if (recCancelBtn) recCancelBtn.addEventListener("click", closeReceiveModal);

    const disbSaveBtn = document.getElementById("maDisburseSaveBtn");
    if (disbSaveBtn) disbSaveBtn.addEventListener("click", handleSaveDisburse);

    const disbCloseBtn = document.getElementById("maDisburseModalClose");
    if (disbCloseBtn) disbCloseBtn.addEventListener("click", closeDisburseModal);

    const disbCancelBtn = document.getElementById("maDisburseCancelBtn");
    if (disbCancelBtn) disbCancelBtn.addEventListener("click", closeDisburseModal);

    const prodBreakClose1 = document.getElementById("productBreakdownModalClose");
    if (prodBreakClose1) prodBreakClose1.addEventListener("click", closeProductBreakdownModal);

    const prodBreakClose2 = document.getElementById("productBreakdownCloseBtn");
    if (prodBreakClose2) prodBreakClose2.addEventListener("click", closeProductBreakdownModal);

    const matBreakClose1 = document.getElementById("materialBreakdownModalClose");
    if (matBreakClose1) matBreakClose1.addEventListener("click", closeMaterialBreakdownModal);

    const matBreakClose2 = document.getElementById("materialBreakdownCloseBtn");
    if (matBreakClose2) matBreakClose2.addEventListener("click", closeMaterialBreakdownModal);

    // Backdrop Click Dismissal
    const overlays = [
        document.getElementById("maReceiveModalOverlay"),
        document.getElementById("maDisburseModalOverlay"),
        document.getElementById("productBreakdownModalOverlay"),
        document.getElementById("materialBreakdownModalOverlay")
    ];

    overlays.forEach(overlay => {
        if (!overlay) return;
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                overlay.classList.remove("open", "active");
            }
        });
    });

    // Escape Key Handler
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeReceiveModal();
            closeDisburseModal();
            closeProductBreakdownModal();
            closeMaterialBreakdownModal();
        }
    });
}
