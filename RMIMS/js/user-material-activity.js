// js/user-material-activity.js
//
// RMIMS V2 — User Material Activity Module
// Full Design & Operational Inheritance from Admin Material Activity
// Exact 2-Card Architecture:
// CARD 1: RECEIVE & DISBURSEMENT MANAGEMENT (Product Overview & Material Overview Tabs)
// CARD 2: ACTUAL ACTIVITY HISTORY (Chronological Transaction Ledger)
// Shared Data Contract: public.raw_materials, public.stock_receipts, public.material_disbursements
// Transaction Authority: record_stock_receipt_v2(), record_material_disbursement_v2()

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";
import {
    AUTHENTIC_59_RAW_MATERIALS,
    AUTHENTIC_STOCK_RECEIPTS_6MONTHS,
    AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS
} from "./authentic-59-dataset.js";
import { AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from "./authentic-finished-products.js";

/* ==========================================================
   ROLE GUARD & AUTHENTICATION
   ========================================================== */

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../user-signin.html";
        return;
    }

    try {
        const { data: profile, error } = await supabase
            .from("user_profiles")
            .select("id, full_name, email, role, status")
            .eq("id", user.uid)
            .maybeSingle();

        if (error || !profile || profile.status !== "active") {
            window.location.href = "../user-signin.html";
            return;
        }

        if (profile.role !== "user") {
            window.location.href = "../admin/dashboard.html";
            return;
        }

        currentUser = {
            uid: user.uid,
            fullName: profile.full_name || profile.email || "Staff Member",
            email: profile.email
        };

        const pBtn = document.getElementById("profileBtn");
        if (pBtn) {
            const pText = pBtn.querySelector(".profile-text") || pBtn;
            pText.textContent = `${currentUser.fullName}`;
            const pAv = pBtn.querySelector(".avatar");
            if (pAv && currentUser.fullName) {
                pAv.textContent = currentUser.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
            }
        }

        initPage();
    } catch (e) {
        console.error("User Auth guard error:", e);
        window.location.href = "../user-signin.html";
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

function initials(name) {
    return getInitials(name);
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
        n === "all" ||
        n === "all activities" ||
        n === "all products" ||
        n === "all materials" ||
        n === "none" ||
        n === "n/a" ||
        n === "na" ||
        n === "null" ||
        n === "undefined" ||
        n === "select" ||
        n === "default" ||
        n === "operational use" ||
        n === "operational" ||
        n === "general usage" ||
        n === "general" ||
        n === "usage" ||
        n === "operational material context" ||
        n === "operational batch" ||
        n === "general production" ||
        n === "production" ||
        n === "production usage" ||
        n === "sample usage" ||
        n === "unassigned / general stock" ||
        n === "unassigned" ||
        n === "imported dsb usage" ||
        n === "imported dsb" ||
        n === "imported disbursement" ||
        n === "imported stock receipt" ||
        n === "imported" ||
        n === "imported usage" ||
        n.includes("imported dsb") ||
        n.includes("imported disbursement")
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

        if (matErr || !mats || mats.length === 0) {
            state.materials = AUTHENTIC_59_RAW_MATERIALS.map(m => ({
                id: m.id,
                item_code: m.item_code,
                name: m.name,
                unit_of_measure: m.unit_of_measure,
                current_stock: m.current_stock,
                minimum_threshold: m.minimum_threshold,
                description: m.description,
                created_at: m.created_at
            }));
        } else {
            state.materials = mats;
        }

        // 2. Fetch stock receipts
        const { data: receipts, error: recErr } = await supabase
            .from("stock_receipts")
            .select("id, material_id, received_quantity, unit, receipt_date, supplier_name, created_at")
            .order("receipt_date", { ascending: false });

        if (recErr || !receipts || receipts.length === 0) {
            state.stockReceipts = AUTHENTIC_STOCK_RECEIPTS_6MONTHS;
        } else {
            state.stockReceipts = receipts;
        }

        // 3. Fetch material disbursements
        const { data: disbs, error: disbErr } = await supabase
            .from("material_disbursements")
            .select("id, material_id, consumed_quantity, unit, usage_date, activity_type, finished_product_name, created_at")
            .order("usage_date", { ascending: false });

        if (disbErr || !disbs || disbs.length === 0) {
            state.disbursements = AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS;
        } else {
            state.disbursements = disbs;
        }

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
    // 1. Load saved context from localStorage (configured by Admin)
    let saved = [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) saved = JSON.parse(raw);
    } catch {
        saved = [];
    }

    const prodMap = new Map();

    // Helper to find raw material ID by name
    function findMaterialIdByName(matName) {
        const query = (matName || "").toLowerCase().trim();
        const found = state.materials.find(m => {
            const name = (m.name || "").toLowerCase().trim();
            return name === query || name.includes(query) || query.includes(name);
        });
        return found ? found.id : null;
    }

    // Populate from Authentic Finished Products Catalog
    if (Array.isArray(AUTHENTIC_FINISHED_PRODUCTS_CATALOG)) {
        AUTHENTIC_FINISHED_PRODUCTS_CATALOG.forEach(p => {
            if (!p || !p.name) return;
            const norm = p.name.trim();
            const key = norm.toLowerCase();

            const matIds = [];
            if (Array.isArray(p.materialNames)) {
                p.materialNames.forEach(name => {
                    const mId = findMaterialIdByName(name);
                    if (mId && !matIds.includes(mId)) matIds.push(mId);
                });
            }

            prodMap.set(key, {
                id: "fp_" + key.replace(/[^a-z0-9]/g, "_"),
                name: norm,
                imageUrl: null,
                materialIds: matIds,
                createdAt: "2026-01-01T00:00:00Z"
            });
        });
    }

    // Add saved contexts (filtering out generic operational names)
    if (Array.isArray(saved)) {
        saved.forEach(p => {
            if (p && p.name && !isGenericOperationalName(p.name)) {
                const norm = p.name.trim().toLowerCase();
                if (prodMap.has(norm)) {
                    const ex = prodMap.get(norm);
                    if (p.imageUrl) ex.imageUrl = p.imageUrl;
                    if (Array.isArray(p.materialIds)) {
                        p.materialIds.forEach(id => {
                            if (!ex.materialIds.includes(id) && state.materials.some(m => m.id === id)) {
                                ex.materialIds.push(id);
                            }
                        });
                    }
                } else {
                    prodMap.set(norm, {
                        id: p.id || ("fp_" + norm),
                        name: p.name.trim(),
                        imageUrl: p.imageUrl || null,
                        materialIds: Array.isArray(p.materialIds) ? p.materialIds.filter(id => state.materials.some(m => m.id === id)) : [],
                        createdAt: p.createdAt || new Date().toISOString()
                    });
                }
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
    if (state.stockReceipts.length === 0 && state.materials.length > 0) {
        state.materials.forEach(mat => {
            const qty = Number(mat.current_stock) || 0;
            if (qty > 0) {
                const dateVal = mat.created_at || new Date().toISOString();
                list.push({
                    id: "rec_init_" + mat.id,
                    type: "receive",
                    typeLabel: "Receive",
                    date: dateVal,
                    context: "Initial Stock / Delivery Receipt",
                    materialId: mat.id,
                    materialName: mat.name || "Unknown Material",
                    itemCode: mat.item_code || "—",
                    quantity: qty,
                    unit: mat.unit_of_measure || "kg",
                    currentStock: qty,
                    minStock: Number(mat.minimum_threshold) || 0,
                    rawTimestamp: new Date(dateVal).getTime()
                });
            }
        });
    } else {
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
    }

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
    renderProductOverview();
    renderMaterialOverview();
}

function renderProductOverview() {
    const container = document.getElementById("productCardsContainer");
    if (!container) return;

    const search = state.productSearch.trim().toLowerCase();

    // Filter finished products based on search
    let filtered = state.finishedProducts.filter(prod => {
        if (!search) return true;
        if (prod.name.toLowerCase().includes(search)) return true;

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
        const matItems = prod.materialIds.map(mId => state.materials.find(m => m.id === mId)).filter(Boolean);
        const chipsHtml = matItems.length > 0
            ? matItems.map(m => `<span class="ma-item-chip">${escapeHtml(m.name)}</span>`).join("")
            : `<span style="font-size:0.75rem; color: var(--rm-ink-dim);">No linked materials</span>`;

        let totalReceived = 0;
        let unit = matItems[0]?.unit_of_measure || "kg";
        prod.materialIds.forEach(mId => {
            state.stockReceipts.forEach(r => {
                if (r.material_id === mId) {
                    totalReceived += Number(r.received_quantity != null ? r.received_quantity : r.quantity) || 0;
                }
            });
        });

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
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pId = btn.getAttribute("data-prod-id");
            const prod = state.finishedProducts.find(p => String(p.id) === String(pId) || p.name.toLowerCase() === String(pId).toLowerCase());
            const isSingle = prod?.materialIds?.length === 1;
            const allowed = (prod?.materialIds?.length > 0) ? prod.materialIds : null;
            openReceiveModal(isSingle ? prod.materialIds[0] : null, prod?.name || null, allowed);
        });
    });

    container.querySelectorAll(".btn-disburse-for-prod").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pId = btn.getAttribute("data-prod-id");
            const prod = state.finishedProducts.find(p => String(p.id) === String(pId) || p.name.toLowerCase() === String(pId).toLowerCase());
            const isSingle = prod?.materialIds?.length === 1;
            const allowed = (prod?.materialIds?.length > 0) ? prod.materialIds : null;
            openDisburseModal(isSingle ? prod.materialIds[0] : null, prod?.name || null, allowed);
        });
    });

    container.querySelectorAll(".btn-view-prod-breakdown").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pId = btn.getAttribute("data-prod-id");
            let prod = state.finishedProducts.find(p => String(p.id) === String(pId) || p.name.toLowerCase() === String(pId).toLowerCase());
            if (!prod) {
                const card = btn.closest(".ma-overview-card");
                const pName = card?.querySelector(".ma-card-item-title")?.textContent?.trim() || pId;
                prod = {
                    name: pName,
                    materialIds: state.materials.filter(m => state.disbursements.some(d => (d.finished_product_name || d.activity_type || "").trim().toLowerCase() === pName.toLowerCase() && d.material_id === m.id)).map(m => m.id)
                };
            }
            openProductBreakdownModal(prod);
        });
    });
}

function renderMaterialOverview() {
    const tbody = document.getElementById("materialOverviewTableBody");
    if (!tbody) return;

    const search = state.materialSearch.trim().toLowerCase();

    // Filter raw materials based on search
    let filtered = state.materials.filter(mat => {
        if (!search) return true;
        if (mat.name.toLowerCase().includes(search)) return true;
        if (mat.item_code && mat.item_code.toLowerCase().includes(search)) return true;

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

    // Attach Event Listeners to Table buttons
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
   CARD 2: ACTUAL ACTIVITY HISTORY (RENDER & FILTER)
   ========================================================== */

function renderCard2History() {
    const tbody = document.getElementById("activityHistoryTableBody");
    const countEl = document.getElementById("historyResultCount");
    const paginationEl = document.getElementById("historyPaginationBtns");

    // Totals Counter Pills in Card Header
    const totalPill = document.getElementById("histTotalCount");
    const recPill = document.getElementById("histReceivedCount");
    const disbPill = document.getElementById("histDisbursedCount");

    let totalRec = 0;
    let totalDisb = 0;
    state.activities.forEach(a => {
        if (a.type === "receive") totalRec++;
        else if (a.type === "disbursement") totalDisb++;
    });

    if (totalPill) totalPill.textContent = state.activities.length;
    if (recPill) recPill.textContent = totalRec;
    if (disbPill) disbPill.textContent = totalDisb;

    if (!tbody) return;

    const search = state.historySearch.trim().toLowerCase();

    // Filter
    let filtered = state.activities.filter(act => {
        // Search
        if (search) {
            const matchesMat = act.materialName.toLowerCase().includes(search);
            const matchesCode = act.itemCode && act.itemCode.toLowerCase().includes(search);
            const matchesCtx = act.context && act.context.toLowerCase().includes(search);
            if (!matchesMat && !matchesCode && !matchesCtx) return false;
        }

        // Date Range
        if (state.historyDateFrom) {
            const actDate = new Date(act.date).getTime();
            const fromDate = new Date(state.historyDateFrom).getTime();
            if (actDate < fromDate) return false;
        }

        if (state.historyDateTo) {
            const actDate = new Date(act.date).getTime();
            const toDate = new Date(state.historyDateTo + "T23:59:59").getTime();
            if (actDate > toDate) return false;
        }

        // Activity Type
        if (state.historyActivity !== "all" && act.type !== state.historyActivity) {
            return false;
        }

        return true;
    });

    // Sort
    filtered.sort((a, b) => {
        if (state.historySort === "oldest") return a.rawTimestamp - b.rawTimestamp;
        if (state.historySort === "az") return a.materialName.localeCompare(b.materialName);
        if (state.historySort === "za") return b.materialName.localeCompare(a.materialName);
        // Default latest
        return b.rawTimestamp - a.rawTimestamp;
    });

    const total = filtered.length;

    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; padding: 36px 16px; color: var(--rm-ink-dim);">
                    <strong>No activities recorded.</strong><br>
                    <span style="font-size: 0.8rem;">Incoming receipts and disbursements will be logged in this ledger.</span>
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = `Showing 0 of ${state.activities.length} activities`;
        if (paginationEl) paginationEl.innerHTML = "";
        return;
    }

    // Pagination
    const totalPages = Math.max(1, Math.ceil(total / state.historyPageSize));
    if (state.historyPage > totalPages) state.historyPage = totalPages;
    if (state.historyPage < 1) state.historyPage = 1;

    const start = (state.historyPage - 1) * state.historyPageSize;
    const end = Math.min(start + state.historyPageSize, total);
    const paged = filtered.slice(start, end);

    if (countEl) {
        countEl.textContent = `Showing ${start + 1}–${end} of ${total} activities`;
    }

    tbody.innerHTML = paged.map(act => {
        const isRec = act.type === "receive";
        const badgeCls = isRec ? "status-badge-instock" : "status-badge-lowstock";
        const badgeText = isRec ? "Receive" : "Disbursement";
        const qtyPrefix = isRec ? "+" : "−";
        const qtyColor = isRec ? "#16a34a" : "#ea580c";
        const status = computeStockStatus(act.currentStock, act.minStock);

        return `
            <tr>
                <td>${escapeHtml(formatDate(act.date))}</td>
                <td><span class="ma-context-pill">${escapeHtml(act.context)}</span></td>
                <td><strong>${escapeHtml(act.materialName)}</strong></td>
                <td><span class="mat-id-badge">${escapeHtml(act.itemCode)}</span></td>
                <td><span class="status-badge ${badgeCls}">${badgeText}</span></td>
                <td><strong style="color:${qtyColor};">${qtyPrefix}${formatQty(act.quantity, act.unit)}</strong></td>
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

    renderPaginationControls(paginationEl, state.historyPage, totalPages, (newPage) => {
        state.historyPage = newPage;
        renderCard2History();
    });
}

function renderPaginationControls(container, currentPage, totalPages, onPageChange) {
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    let html = `
        <button type="button" class="page-btn page-nav-btn" id="prevHistPageBtn" ${currentPage <= 1 ? "disabled" : ""}>‹ Prev</button>
    `;

    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
            html += `<button type="button" class="page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
        } else if (p === currentPage - 2 || p === currentPage + 2) {
            html += `<span class="page-ellipsis">…</span>`;
        }
    }

    html += `
        <button type="button" class="page-btn page-nav-btn" id="nextHistPageBtn" ${currentPage >= totalPages ? "disabled" : ""}>Next ›</button>
    `;

    container.innerHTML = html;

    const prevBtn = container.querySelector("#prevHistPageBtn");
    const nextBtn = container.querySelector("#nextHistPageBtn");

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

/* ==========================================================
   MODAL CONTROLS & OPERATIONS
   ========================================================== */

function populateMaterialDropdowns() {
    const recSelect = document.getElementById("maReceiveMaterialSelect");
    const disbSelect = document.getElementById("maDisburseMaterialSelect");

    const buildOptions = () => {
        return state.materials.map(m => {
            return `<option value="${escapeHtml(m.id)}" data-unit="${escapeHtml(m.unit_of_measure || 'kg')}" data-stock="${m.current_stock}" data-code="${escapeHtml(m.item_code || 'RM—')}">${escapeHtml(m.name)} (${escapeHtml(m.item_code || 'RM—')})</option>`;
        }).join("");
    };

    const defaultHtml = `<option value="" disabled selected>Select a raw material...</option>` + buildOptions();

    if (recSelect) recSelect.innerHTML = defaultHtml;
    if (disbSelect) disbSelect.innerHTML = defaultHtml;
}

function clearModalErrors(prefix) {
    const errs = document.querySelectorAll(`[id^="${prefix}"][id$="Error"]`);
    errs.forEach(e => {
        e.textContent = "";
        e.style.display = "none";
    });
}

function setFieldError(id, msg) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.style.display = "block";
    }
}

function updateProductContextDropdown(selectEl, selectedMatId, preferredProduct = null, isOptional = false) {
    if (!selectEl) return;
    
    const prodsList = Array.isArray(state.finishedProducts) ? state.finishedProducts : [];

    // Find all finished products that contain this raw material
    const associatedProds = prodsList.filter(p => 
        Array.isArray(p.materialIds) && p.materialIds.map(String).includes(String(selectedMatId))
    );
    
    let html = "";
    if (isOptional) {
        html += `<option value="">Unassigned / General Stock</option>`;
    }
    
    if (associatedProds.length > 0) {
        html += `<optgroup label="Associated Finished Products">`;
        associatedProds.forEach(p => {
            html += `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`;
        });
        html += `</optgroup>`;
    }
    
    const otherProds = prodsList.filter(p => !associatedProds.some(ap => String(ap.id) === String(p.id)));
    if (otherProds.length > 0) {
        html += `<optgroup label="Other Finished Products">`;
        otherProds.forEach(p => {
            html += `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`;
        });
        html += `</optgroup>`;
    }
    
    html += `<optgroup label="General / Operational">`;
    html += `<option value="General Usage">General Usage</option>`;
    html += `</optgroup>`;
    
    selectEl.innerHTML = html;
    
    // Auto-selection priority:
    if (preferredProduct) {
        const match = Array.from(selectEl.options).find(opt => opt.value.toLowerCase() === preferredProduct.toLowerCase());
        if (match) {
            selectEl.value = match.value;
            return;
        } else {
            const newOpt = document.createElement("option");
            newOpt.value = preferredProduct;
            newOpt.textContent = preferredProduct;
            selectEl.prepend(newOpt);
            selectEl.value = preferredProduct;
            return;
        }
    }
    
    // Auto-select associated finished product if available
    if (associatedProds.length > 0) {
        selectEl.value = associatedProds[0].name;
    } else if (!isOptional && prodsList.length > 0) {
        selectEl.value = prodsList[0].name;
    } else if (!isOptional) {
        selectEl.value = "General Usage";
    }
}

function updateReceiveLivePreview() {
    const previewEl = document.getElementById("maReceiveStockPreview");
    const matSelect = document.getElementById("maReceiveMaterialSelect");
    const qtyInput = document.getElementById("maReceiveQuantityInput");
    if (!previewEl) return;

    const matId = matSelect ? matSelect.value : "";
    const mat = state.materials.find(m => m.id === matId);
    if (!mat) {
        previewEl.innerHTML = "";
        return;
    }

    const cur = Number(mat.current_stock) || 0;
    const qty = parseFloat(qtyInput?.value) || 0;
    const unit = mat.unit_of_measure || "kg";
    const next = cur + qty;

    previewEl.innerHTML = `Stock: <strong>${formatQty(cur, unit)}</strong> &nbsp;→&nbsp; After Receipt: <strong style="color:#059669;">${formatQty(next, unit)}</strong>`;
}

function updateDisburseLivePreview() {
    const previewEl = document.getElementById("maDisburseStockPreview");
    const matSelect = document.getElementById("maDisburseMaterialSelect");
    const qtyInput = document.getElementById("maDisburseQuantityInput");
    const warningBox = document.getElementById("maDisburseMarginWarning");
    const warningDesc = document.getElementById("maDisburseMarginWarningDesc");
    if (!previewEl) return;

    const matId = matSelect ? matSelect.value : "";
    const mat = state.materials.find(m => String(m.id) === String(matId));
    if (!mat) {
        previewEl.innerHTML = "";
        if (warningBox) warningBox.style.display = "none";
        return;
    }

    const cur = Number(mat.current_stock) || 0;
    const qty = parseFloat(qtyInput?.value) || 0;
    const unit = mat.unit_of_measure || "kg";
    const minThresh = Number(mat.minimum_threshold) || 0;
    const next = Math.max(0, cur - qty);

    if (qty > cur) {
        previewEl.innerHTML = `<span style="color: #dc2626; font-weight:700;">⚠️ Exceeds available stock (${formatQty(cur, unit)})</span>`;
    } else {
        previewEl.innerHTML = `Available: <strong>${formatQty(cur, unit)}</strong> &nbsp;→&nbsp; Remaining: <strong style="color:#ea580c;">${formatQty(next, unit)}</strong>`;
    }

    // Margin of Error Live Warning (+7.51% Upper Limit)
    const typicalBatchReq = Math.max(minThresh * 0.50, Math.min(cur * 0.50, 50), 10);
    const upperMarginLimit = typicalBatchReq * 1.0751; // +7.51% Limit

    if (warningBox && warningDesc) {
        if (qty > 0 && qty <= cur && qty > upperMarginLimit) {
            const excessPct = (((qty - typicalBatchReq) / typicalBatchReq) * 100).toFixed(1);
            warningDesc.textContent = `Entered quantity (${formatQty(qty, unit)}) exceeds standard batch allocation (${formatQty(typicalBatchReq, unit)}) by +${excessPct}%, overshooting the ±7.51% operational forecast margin. Verify recipe measurements before submitting.`;
            warningBox.style.display = "flex";
        } else {
            warningBox.style.display = "none";
        }
    }
}

function openReceiveModal(preselectedMatId = null, preselectedProduct = null, allowedMaterialIds = null) {
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
            updateProductContextDropdown(prodInput, activeId, null, true);
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
        }
    } else {
        if (matSelect) {
            matSelect.style.display = "block";
            if (availableMats.length > 0) {
                matSelect.value = availableMats[0].id;
                activeMatId = availableMats[0].id;
                if (unitInput) unitInput.value = availableMats[0].unit_of_measure || "kg";
            }
        }
        if (matDisplayWrap) matDisplayWrap.style.display = "none";
    }

    updateProductContextDropdown(prodInput, activeMatId, preselectedProduct, true);
    updateReceiveLivePreview();

    overlay.classList.add("open", "active");
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
    const prodInput = document.getElementById("maReceiveProductContextInput");
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
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
    }

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
        try {
            localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "receive" }));
        } catch {}
        await loadAuthoritativeData();
    } catch (err) {
        console.error("Save receipt error:", err);
        toast("Failed to record receipt: " + (err.message || err), "error");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Receipt";
        }
    }
}

function openDisburseModal(preselectedMatId = null, preselectedProduct = null, allowedMaterialIds = null) {
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

    const todayStr = new Date().toISOString().slice(0, 10);
    if (dateInput) {
        if (dateInput._flatpickr) {
            dateInput._flatpickr.setDate(todayStr, true);
        } else {
            dateInput.value = todayStr;
        }
    }
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
            updateProductContextDropdown(prodInput, activeId, null, false);
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
                if (matAvatar) matAvatar.textContent = getInitials(mat.name);
                if (matNameDisplay) matNameDisplay.textContent = mat.name;
                if (matCodeDisplay) matCodeDisplay.textContent = mat.item_code || "RM—";
                if (matStockDisplay) matStockDisplay.textContent = formatQty(mat.current_stock, mat.unit_of_measure);
            }
            if (unitInput) unitInput.value = mat.unit_of_measure || "kg";
        }
    } else {
        if (matSelect) {
            matSelect.style.display = "block";
            if (availableMats.length > 0) {
                matSelect.value = availableMats[0].id;
                activeMatId = availableMats[0].id;
                if (unitInput) unitInput.value = availableMats[0].unit_of_measure || "kg";
            }
        }
        if (matDisplayWrap) matDisplayWrap.style.display = "none";
    }

    updateProductContextDropdown(prodInput, activeMatId, preselectedProduct, false);
    updateDisburseLivePreview();

    overlay.classList.add("open", "active");
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

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
    }

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
        try {
            localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "disburse" }));
        } catch {}
        await loadAuthoritativeData();
    } catch (err) {
        console.error("Save disbursement error:", err);
        toast("Failed to record disbursement: " + (err.message || err), "error");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Disbursement";
        }
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

    const matItems = (prod.materialIds || []).map(mId => state.materials.find(m => String(m.id) === String(mId))).filter(Boolean);

    if (matItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--rm-ink-dim);">No raw materials mapped to this product.</td></tr>`;
    } else {
        tbody.innerHTML = matItems.map(mat => {
            const unit = mat.unit_of_measure || "kg";
            let received = 0;
            state.stockReceipts.forEach(r => {
                if (String(r.material_id) === String(mat.id)) {
                    received += Number(r.received_quantity != null ? r.received_quantity : r.quantity) || 0;
                }
            });

            let disbursed = 0;
            state.disbursements.forEach(d => {
                const pName = (d.finished_product_name || d.activity_type || "").trim().toLowerCase();
                if (pName === prod.name.toLowerCase() && String(d.material_id) === String(mat.id)) {
                    disbursed += Number(d.consumed_quantity != null ? d.consumed_quantity : d.quantity) || 0;
                }
            });

            return `
                <tr>
                    <td><strong>${escapeHtml(mat.name)}</strong></td>
                    <td><span class="mat-id-badge">${escapeHtml(mat.item_code || "RM—")}</span></td>
                    <td><strong class="val-received" style="color:#16a34a;">${formatQty(received, unit)}</strong></td>
                    <td><strong class="val-disbursed" style="color:#ea580c;">${formatQty(disbursed, unit)}</strong></td>
                    <td><strong>${formatQty(mat.current_stock, unit)}</strong></td>
                    <td>${escapeHtml(unit)}</td>
                </tr>
            `;
        }).join("");
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

    if (!overlay || !mat) return;

    const unit = mat.unit_of_measure || "kg";
    const curStock = Number(mat.current_stock) || 0;
    const minStock = Number(mat.minimum_threshold) || 0;
    const status = computeStockStatus(curStock, minStock);

    if (title) title.textContent = `${mat.name} (${mat.item_code || "RM—"}) — Breakdown`;
    if (subtitle) subtitle.textContent = `Usage breakdown across finished products`;

    if (curStockEl) curStockEl.textContent = formatQty(curStock, unit);
    if (minStockEl) minStockEl.textContent = formatQty(minStock, unit);
    if (statusEl) {
        statusEl.className = `status-badge ${status.cls}`;
        statusEl.innerHTML = `<span class="badge-dot ${status.dot}"></span>${status.label}`;
    }

    let totalRec = 0;
    state.stockReceipts.forEach(r => {
        if (String(r.material_id) === String(mat.id)) {
            totalRec += Number(r.received_quantity != null ? r.received_quantity : r.quantity) || 0;
        }
    });

    let totalDisb = 0;
    const prodUsage = new Map();
    state.disbursements.forEach(d => {
        if (String(d.material_id) === String(mat.id)) {
            const qty = Number(d.consumed_quantity != null ? d.consumed_quantity : d.quantity) || 0;
            totalDisb += qty;
            const pName = (d.finished_product_name || d.activity_type || "").trim() || "General Usage";
            if (!isGenericOperationalName(pName)) {
                prodUsage.set(pName, (prodUsage.get(pName) || 0) + qty);
            }
        }
    });

    // Map finished products that link to this material
    const prodsList = Array.isArray(state.finishedProducts) ? state.finishedProducts : [];
    prodsList.forEach(p => {
        if (p.materialIds && p.materialIds.map(String).includes(String(mat.id)) && !prodUsage.has(p.name)) {
            prodUsage.set(p.name, 0);
        }
    });

    if (totalRecEl) totalRecEl.textContent = formatQty(totalRec, unit);
    if (totalDisbEl) totalDisbEl.textContent = formatQty(totalDisb, unit);

    if (tbody) {
        if (prodUsage.size === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--rm-ink-dim);">No finished products mapped to this material.</td></tr>`;
        } else {
            tbody.innerHTML = Array.from(prodUsage.entries()).map(([pName, qty]) => `
                <tr>
                    <td><strong>${escapeHtml(pName)}</strong></td>
                    <td><strong class="val-disbursed" style="color:#ea580c;">${formatQty(qty, unit)}</strong></td>
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
   FLATPICKR CALENDAR INITIALIZATION (CUSTOM SYSTEM THEME)
   ========================================================== */

function initActivityFlatpickr() {
    const clearBtn = document.getElementById("clearHistoryDatesBtn");

    const updateClearBtnVisibility = () => {
        if (clearBtn) {
            clearBtn.style.display = (state.historyDateFrom || state.historyDateTo) ? "inline-flex" : "none";
        }
    };

    const filterDateInputIds = ["historyDateFrom", "historyDateTo"];
    filterDateInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && typeof flatpickr !== "undefined" && !el._flatpickr) {
            const fp = flatpickr(el, {
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "d/m/Y",
                altInputClass: "inv-input-date",
                disableMobile: true,
                allowInput: true,
                onChange: (selectedDates, dateStr) => {
                    el.value = dateStr;
                    if (id === "historyDateFrom") state.historyDateFrom = dateStr;
                    if (id === "historyDateTo") state.historyDateTo = dateStr;
                    updateClearBtnVisibility();
                    state.historyPage = 1;
                    renderCard2History();
                },
                onClose: (selectedDates, dateStr, instance) => {
                    if (instance && instance.altInput) {
                        const raw = instance.altInput.value.trim();
                        if (!raw) {
                            instance.clear();
                            if (id === "historyDateFrom") state.historyDateFrom = "";
                            if (id === "historyDateTo") state.historyDateTo = "";
                            updateClearBtnVisibility();
                            state.historyPage = 1;
                            renderCard2History();
                        } else {
                            const parsed = instance.parseDate(raw, "d/m/Y") || instance.parseDate(raw, "Y-m-d");
                            if (parsed) {
                                instance.setDate(parsed, true);
                            }
                        }
                    }
                }
            });

            if (fp && fp.altInput) {
                fp.altInput.setAttribute("placeholder", "dd/mm/yyyy");
                fp.altInput.addEventListener("blur", () => {
                    const raw = fp.altInput.value.trim();
                    if (!raw) {
                        fp.clear();
                        if (id === "historyDateFrom") state.historyDateFrom = "";
                        if (id === "historyDateTo") state.historyDateTo = "";
                        updateClearBtnVisibility();
                        state.historyPage = 1;
                        renderCard2History();
                    } else {
                        const parsed = fp.parseDate(raw, "d/m/Y") || fp.parseDate(raw, "Y-m-d");
                        if (parsed) {
                            fp.setDate(parsed, true);
                        }
                    }
                });
            }
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            const fromEl = document.getElementById("historyDateFrom");
            const toEl = document.getElementById("historyDateTo");
            if (fromEl && fromEl._flatpickr) fromEl._flatpickr.clear();
            if (toEl && toEl._flatpickr) toEl._flatpickr.clear();
            state.historyDateFrom = "";
            state.historyDateTo = "";
            updateClearBtnVisibility();
            state.historyPage = 1;
            renderCard2History();
        });
    }

    // Modal Date Pickers (Receive & Disburse modals)
    const modalDateIds = ["maReceiveDateInput", "maDisburseDateInput"];
    modalDateIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && typeof flatpickr !== "undefined" && !el._flatpickr) {
            const modalFp = flatpickr(el, {
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "d/m/Y",
                altInputClass: "ma-modal-date-input",
                defaultDate: "today",
                disableMobile: true,
                allowInput: true,
                onChange: (selectedDates, dateStr) => {
                    el.value = dateStr;
                }
            });
            if (modalFp && modalFp.altInput) {
                modalFp.altInput.setAttribute("placeholder", "dd/mm/yyyy");
                modalFp.altInput.addEventListener("blur", () => {
                    const raw = modalFp.altInput.value.trim();
                    if (raw) {
                        const parsed = modalFp.parseDate(raw, "d/m/Y") || modalFp.parseDate(raw, "Y-m-d");
                        if (parsed) modalFp.setDate(parsed, true);
                    }
                });
            }
        }
    });
}

/* ==========================================================
   EVENT LISTENERS INITIALIZATION
   ========================================================== */

function initEventListeners() {
    // 1. Tab Switching (Product Overview vs Material Overview)
    const tabProd = document.getElementById("tabBtnProductOverview");
    const tabMat = document.getElementById("tabBtnMaterialOverview");
    const viewProd = document.getElementById("viewProductOverview");
    const viewMat = document.getElementById("viewMaterialOverview");

    if (tabProd && tabMat) {
        tabProd.addEventListener("click", () => {
            state.card1Tab = "product";
            tabProd.classList.add("active");
            tabMat.classList.remove("active");
            if (viewProd) viewProd.hidden = false;
            if (viewMat) viewMat.hidden = true;
            renderProductOverview();
        });

        tabMat.addEventListener("click", () => {
            state.card1Tab = "material";
            tabMat.classList.add("active");
            tabProd.classList.remove("active");
            if (viewMat) viewMat.hidden = false;
            if (viewProd) viewProd.hidden = true;
            renderMaterialOverview();
        });
    }

    // 2. Card 1 Filters (Product Search & Sort)
    const prodSearch = document.getElementById("productSearchInput");
    const prodSort = document.getElementById("productSortSelect");

    if (prodSearch) {
        prodSearch.addEventListener("input", () => {
            state.productSearch = prodSearch.value;
            renderProductOverview();
        });
    }

    if (prodSort) {
        prodSort.addEventListener("change", () => {
            state.productSort = prodSort.value;
            renderProductOverview();
        });
    }

    // 3. Card 1 Filters (Material Search & Sort)
    const matSearch = document.getElementById("materialSearchInput");
    const matSort = document.getElementById("materialSortSelect");

    if (matSearch) {
        matSearch.addEventListener("input", () => {
            state.materialSearch = matSearch.value;
            renderMaterialOverview();
        });
    }

    if (matSort) {
        matSort.addEventListener("change", () => {
            state.materialSort = matSort.value;
            renderMaterialOverview();
        });
    }

    // 4. Card 2 History Filters
    const histSearch = document.getElementById("historySearchInput");
    const histAct = document.getElementById("historyActivityFilter");
    const histSort = document.getElementById("historySortSelect");
    const histPageSize = document.getElementById("historyPageSize");

    if (histSearch) {
        histSearch.addEventListener("input", () => {
            state.historySearch = histSearch.value;
            state.historyPage = 1;
            renderCard2History();
        });
    }

    // Initialize Flatpickr Calendars with Custom System Theme
    initActivityFlatpickr();

    if (histAct) {
        histAct.addEventListener("change", () => {
            state.historyActivity = histAct.value;
            state.historyPage = 1;
            renderCard2History();
        });
    }

    if (histSort) {
        histSort.addEventListener("change", () => {
            state.historySort = histSort.value;
            state.historyPage = 1;
            renderCard2History();
        });
    }

    if (histPageSize) {
        histPageSize.addEventListener("change", () => {
            state.historyPageSize = Number(histPageSize.value) || 10;
            state.historyPage = 1;
            renderCard2History();
        });
    }

    // 5. Modals - Receive Modal
    const recClose = document.getElementById("maReceiveModalClose");
    const recCancel = document.getElementById("maReceiveCancelBtn");
    const recSave = document.getElementById("maReceiveSaveBtn");
    const recMinus = document.getElementById("maReceiveMinusBtn");
    const recPlus = document.getElementById("maReceivePlusBtn");
    const recQtyInput = document.getElementById("maReceiveQuantityInput");

    if (recClose) recClose.addEventListener("click", closeReceiveModal);
    if (recCancel) recCancel.addEventListener("click", closeReceiveModal);
    if (recSave) recSave.addEventListener("click", handleSaveReceive);

    if (recMinus && recQtyInput) {
        recMinus.addEventListener("click", (e) => {
            e.preventDefault();
            const cur = Math.max(0.01, (Number(recQtyInput.value) || 0) - 1);
            recQtyInput.value = cur % 1 === 0 ? Math.max(1, cur) : cur.toFixed(2);
            recQtyInput.dispatchEvent(new Event("input"));
        });
    }

    if (recPlus && recQtyInput) {
        recPlus.addEventListener("click", (e) => {
            e.preventDefault();
            const cur = (Number(recQtyInput.value) || 0) + 1;
            recQtyInput.value = cur % 1 === 0 ? cur : cur.toFixed(2);
            recQtyInput.dispatchEvent(new Event("input"));
        });
    }

    if (recQtyInput) {
        recQtyInput.addEventListener("input", updateReceiveLivePreview);
    }

    // 6. Modals - Disburse Modal
    const disbClose = document.getElementById("maDisburseModalClose");
    const disbCancel = document.getElementById("maDisburseCancelBtn");
    const disbSave = document.getElementById("maDisburseSaveBtn");
    const disbMinus = document.getElementById("maDisburseMinusBtn");
    const disbPlus = document.getElementById("maDisbursePlusBtn");
    const disbQtyInput = document.getElementById("maDisburseQuantityInput");

    if (disbClose) disbClose.addEventListener("click", closeDisburseModal);
    if (disbCancel) disbCancel.addEventListener("click", closeDisburseModal);
    if (disbSave) disbSave.addEventListener("click", handleSaveDisburse);

    if (disbMinus && disbQtyInput) {
        disbMinus.addEventListener("click", (e) => {
            e.preventDefault();
            const cur = Math.max(0.01, (Number(disbQtyInput.value) || 0) - 1);
            disbQtyInput.value = cur % 1 === 0 ? Math.max(1, cur) : cur.toFixed(2);
            disbQtyInput.dispatchEvent(new Event("input"));
        });
    }

    if (disbPlus && disbQtyInput) {
        disbPlus.addEventListener("click", (e) => {
            e.preventDefault();
            const cur = (Number(disbQtyInput.value) || 0) + 1;
            disbQtyInput.value = cur % 1 === 0 ? cur : cur.toFixed(2);
            disbQtyInput.dispatchEvent(new Event("input"));
        });
    }

    if (disbQtyInput) {
        disbQtyInput.addEventListener("input", updateDisburseLivePreview);
    }

    // 7. Modals - Product & Material Breakdown Modal Close Buttons
    const prodBreakdownClose = document.getElementById("productBreakdownModalClose");
    const prodBreakdownBtnClose = document.getElementById("productBreakdownCloseBtn");
    const matBreakdownClose = document.getElementById("materialBreakdownModalClose");
    const matBreakdownBtnClose = document.getElementById("materialBreakdownCloseBtn");

    if (prodBreakdownClose) prodBreakdownClose.addEventListener("click", () => {
        document.getElementById("productBreakdownModalOverlay")?.classList.remove("open", "active");
    });
    if (prodBreakdownBtnClose) prodBreakdownBtnClose.addEventListener("click", () => {
        document.getElementById("productBreakdownModalOverlay")?.classList.remove("open", "active");
    });

    if (matBreakdownClose) matBreakdownClose.addEventListener("click", () => {
        document.getElementById("materialBreakdownModalOverlay")?.classList.remove("open", "active");
    });
    if (matBreakdownBtnClose) matBreakdownBtnClose.addEventListener("click", () => {
        document.getElementById("materialBreakdownModalOverlay")?.classList.remove("open", "active");
    });

    // 8. Refresh button
    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            await loadAuthoritativeData();
            toast("Material Activity data refreshed.");
        });
    }

    // 9. Close overlays on background click or Esc key
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) overlay.classList.remove("open", "active");
        });
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            document.querySelectorAll(".modal-overlay.open, .modal-overlay.active").forEach(ov => ov.classList.remove("open", "active"));
        }
    });

    // Cross-Tab / Cross-Window Real-time Sync
    window.addEventListener("storage", (e) => {
        if (e.key === "rmims_sync_event" || e.key === "rmims_inventory_updated") {
            loadAuthoritativeData();
        }
    });
}

