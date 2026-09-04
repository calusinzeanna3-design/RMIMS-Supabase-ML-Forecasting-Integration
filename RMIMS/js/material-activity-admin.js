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
import { AUTHENTIC_59_RAW_MATERIALS, AUTHENTIC_STOCK_RECEIPTS_6MONTHS, AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS } from "./authentic-59-dataset.js";
import { AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from "./authentic-finished-products.js";
import { getSystemRawMaterials, getSystemCustomReceipts, saveCustomReceipt, getSystemCustomDisbursements, saveCustomDisbursement, invalidateForecastCache } from "./system-materials.js";

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
    productPage: 1,
    productPageSize: 9,
    materialSearch: "",
    materialSort: "latest",
    materialPage: 1,
    materialPageSize: 10,

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

function getUserDisplayName() {
    try {
        const u = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
        return u.full_name || u.email || (u.role === 'admin' ? 'Administrator' : 'Staff User');
    } catch (e) {
        return 'Administrator';
    }
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
        const fetchWithTimeout = (promise, ms = 3000) => 
            Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
            ]);

        // Run all queries in PARALLEL
        const [matsRes, recsRes, disbsRes] = await Promise.allSettled([
            fetchWithTimeout(supabase.from("raw_materials").select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, description, created_at").order("name")),
            fetchWithTimeout(supabase.from("stock_receipts").select("id, material_id, received_quantity, unit, receipt_date, supplier_name, created_at").order("receipt_date", { ascending: false })),
            fetchWithTimeout(supabase.from("material_disbursements").select("id, material_id, consumed_quantity, unit, usage_date, activity_type, finished_product_name, created_at").order("usage_date", { ascending: false }))
        ]);

        // 1. Merge Materials (Baseline 59 + System Custom Materials + Supabase)
        const matMap = new Map();
        const baselineMats = getSystemRawMaterials();
        baselineMats.forEach(m => {
            const k = String(m.name || m.id || "").toLowerCase().trim();
            matMap.set(k, {
                id: String(m.id || m.item_code),
                item_code: m.item_code || m.itemCode || m.id,
                name: m.name,
                unit_of_measure: m.unit_of_measure || m.unit || "kg",
                current_stock: Number(m.current_stock ?? m.currentStock ?? 0),
                minimum_threshold: Number(m.minimum_threshold ?? m.minimum_stock ?? 10),
                description: m.description || "",
                created_at: m.created_at || new Date().toISOString()
            });
        });

        if (matsRes.status === "fulfilled" && matsRes.value?.data && matsRes.value.data.length > 0) {
            matsRes.value.data.forEach(m => {
                const k = String(m.name || m.id || "").toLowerCase().trim();
                const ex = matMap.get(k) || {};
                matMap.set(k, { ...ex, ...m });
            });
        }
        let mats = Array.from(matMap.values());

        // 2. Merge Receipts (Baseline 6 Months + System Custom Receipts + Supabase)
        const recMap = new Map();
        AUTHENTIC_STOCK_RECEIPTS_6MONTHS.forEach(r => recMap.set(String(r.id), { ...r }));
        getSystemCustomReceipts().forEach(r => recMap.set(String(r.id), { ...r }));
        if (recsRes.status === "fulfilled" && recsRes.value?.data && recsRes.value.data.length > 0) {
            recsRes.value.data.forEach(r => recMap.set(String(r.id), { ...(recMap.get(String(r.id)) || {}), ...r }));
        }
        let receipts = Array.from(recMap.values());

        // 3. Merge Disbursements (Baseline 6 Months + System Custom Disbursements + Supabase)
        const disbMap = new Map();
        AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS.forEach(d => disbMap.set(String(d.id), { ...d }));
        getSystemCustomDisbursements().forEach(d => disbMap.set(String(d.id), { ...d }));
        if (disbsRes.status === "fulfilled" && disbsRes.value?.data && disbsRes.value.data.length > 0) {
            disbsRes.value.data.forEach(d => disbMap.set(String(d.id), { ...(disbMap.get(String(d.id)) || {}), ...d }));
        }
        let disbs = Array.from(disbMap.values());

        // Retrieve locally deleted IDs across all registries
        let deletedMatIds = new Set();
        try {
            deletedMatIds = new Set(JSON.parse(localStorage.getItem("rmims_deleted_material_ids") || "[]").map(x => String(x).toLowerCase().trim()));
        } catch (e) {}

        let deletedDisbIds = new Set();
        try {
            deletedDisbIds = new Set(JSON.parse(localStorage.getItem("rmims_deleted_disbursement_ids") || "[]").map(x => String(x)));
        } catch (e) {}

        let deletedRecIds = new Set();
        try {
            deletedRecIds = new Set(JSON.parse(localStorage.getItem("rmims_deleted_receipt_ids") || "[]").map(x => String(x)));
        } catch (e) {}

        if (deletedMatIds.size > 0) {
            mats = mats.filter(m => !deletedMatIds.has(String(m.id).toLowerCase().trim()) && !deletedMatIds.has((m.name || "").toLowerCase().trim()));
        }
        if (deletedRecIds.size > 0) {
            receipts = receipts.filter(r => !deletedRecIds.has(String(r.id)));
        }
        if (deletedDisbIds.size > 0) {
            disbs = disbs.filter(d => !deletedDisbIds.has(String(d.id)));
        }

        // Compute dynamic live stock for each raw material based on full transaction ledger
        mats.forEach(m => {
            const mId = String(m.id).toLowerCase().trim();
            const mCode = String(m.item_code || "").toLowerCase().trim();
            const mName = String(m.name || "").toLowerCase().trim();

            const isMatch = (tid, tmat) => {
                const s = String(tid || tmat || "").toLowerCase().trim();
                return s === mId || s === mCode || s === mName;
            };

            const totRec = receipts.filter(r => isMatch(r.material_id, r.material_name)).reduce((s, r) => s + Number(r.received_quantity ?? r.receivedQuantity ?? r.quantity ?? 0), 0);
            const totDisb = disbs.filter(d => isMatch(d.material_id, d.material_name)).reduce((s, d) => s + Number(d.consumed_quantity ?? d.consumedQuantity ?? d.quantity ?? 0), 0);
            
            // If receipts & disbursements exist, calculate dynamically
            if (totRec > 0 || totDisb > 0) {
                m.current_stock = Math.max(0, Number((totRec - totDisb).toFixed(2)));
            }
        });

        state.materials = mats;
        state.stockReceipts = receipts;
        state.disbursements = disbs;

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

    let deletedProdNames = new Set();
    try {
        deletedProdNames = new Set(JSON.parse(localStorage.getItem("rmims_deleted_finished_products") || "[]").map(x => String(x).toLowerCase().trim()));
    } catch (e) {}

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
            if (deletedProdNames.has(key)) return;

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

    // Add saved contexts (filtering out generic operational names and deleted products)
    if (Array.isArray(saved)) {
        saved.forEach(p => {
            if (p && p.name && !isGenericOperationalName(p.name)) {
                const norm = p.name.trim().toLowerCase();
                if (deletedProdNames.has(norm)) return;
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
            let contextVal = (r.supplier_name || "").trim();
            if (!contextVal || isGenericOperationalName(contextVal)) {
                const linked = state.finishedProducts.filter(p => p.materialIds && p.materialIds.includes(r.material_id));
                contextVal = linked.length > 0 ? linked.map(p => p.name).join(", ") : "Inward Delivery";
            }
            list.push({
                id: "rec_" + r.id,
                type: "receive",
                typeLabel: "Receive",
                date: dateVal,
                context: contextVal,
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
        let contextName = (d.finished_product_name || d.activity_type || "").trim();
        if (!contextName || isGenericOperationalName(contextName)) {
            const linked = state.finishedProducts.filter(p => p.materialIds && p.materialIds.includes(d.material_id));
            contextName = linked.length > 0 ? linked.map(p => p.name).join(", ") : "Production Usage";
        }
        const qty = Number(d.consumed_quantity != null ? d.consumed_quantity : d.quantity) || 0;
        const dateVal = d.usage_date || d.disbursement_date || d.created_at;
        list.push({
            id: "disb_" + d.id,
            type: "disbursement",
            typeLabel: "Disbursement",
            date: dateVal,
            context: contextName,
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
    const countEl = document.getElementById("productResultCount");
    const paginationEl = document.getElementById("productPaginationBtns");
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

    const total = filtered.length;

    if (total === 0) {
        container.innerHTML = `
            <div class="ma-empty-state" style="grid-column: 1 / -1;">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                <p>No finished products match your search criteria.</p>
            </div>
        `;
        if (countEl) countEl.textContent = `Showing 0 of ${state.finishedProducts.length} finished products`;
        if (paginationEl) paginationEl.innerHTML = "";
        return;
    }

    // Pagination
    const totalPages = Math.max(1, Math.ceil(total / state.productPageSize));
    if (state.productPage > totalPages) state.productPage = totalPages;
    if (state.productPage < 1) state.productPage = 1;

    const start = (state.productPage - 1) * state.productPageSize;
    const end = Math.min(start + state.productPageSize, total);
    const paged = filtered.slice(start, end);

    if (countEl) {
        countEl.textContent = `Showing ${start + 1}–${end} of ${total} finished products`;
    }

    container.innerHTML = paged.map(prod => {
        // Compute bundled metrics
        // 1. Material chips
        const matItems = prod.materialIds.map(mId => state.materials.find(m => m.id === mId)).filter(Boolean);
        
        let chipsHtml = "";
        if (matItems.length === 0) {
            chipsHtml = `<span style="font-size:0.75rem; color: var(--rm-ink-dim);">No linked materials</span>`;
        } else {
            const visible = matItems.slice(0, 3).map(m => `<span class="ma-item-chip" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span>`).join("");
            const remaining = matItems.length - 3;
            const moreChip = remaining > 0
                ? `<span class="ma-chip-more btn-view-prod-breakdown" data-prod-id="${escapeHtml(prod.id)}" title="Click to view all ${matItems.length} materials">+${remaining} more</span>`
                : "";
            chipsHtml = visible + moreChip;
        }

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

    renderPaginationControls(paginationEl, state.productPage, totalPages, (newPage) => {
        state.productPage = newPage;
        renderProductOverview();
    });

    // Attach Event Listeners to Product Card buttons
    container.querySelectorAll(".btn-receive-for-prod").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pId = btn.getAttribute("data-prod-id");
            const prod = state.finishedProducts.find(p => String(p.id) === String(pId) || p.name.toLowerCase() === String(pId).toLowerCase());
            openReceiveModal(null, prod?.name || pId, prod?.materialIds || []);
        });
    });

    container.querySelectorAll(".btn-disburse-for-prod").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pId = btn.getAttribute("data-prod-id");
            const prod = state.finishedProducts.find(p => String(p.id) === String(pId) || p.name.toLowerCase() === String(pId).toLowerCase());
            openDisburseModal(null, prod?.name || pId, prod?.materialIds || []);
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
    const countEl = document.getElementById("materialResultCount");
    const paginationEl = document.getElementById("materialPaginationBtns");
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

    const total = filtered.length;

    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; padding: 32px; color: var(--rm-ink-dim);">
                    No raw materials match your search criteria.
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = `Showing 0 of ${state.materials.length} materials`;
        if (paginationEl) paginationEl.innerHTML = "";
        return;
    }

    // Pagination
    const totalPages = Math.max(1, Math.ceil(total / state.materialPageSize));
    if (state.materialPage > totalPages) state.materialPage = totalPages;
    if (state.materialPage < 1) state.materialPage = 1;

    const start = (state.materialPage - 1) * state.materialPageSize;
    const end = Math.min(start + state.materialPageSize, total);
    const paged = filtered.slice(start, end);

    if (countEl) {
        countEl.textContent = `Showing ${start + 1}–${end} of ${total} materials`;
    }

    tbody.innerHTML = paged.map(mat => {
        const curStock = Number(mat.current_stock) || 0;
        const minStock = Number(mat.minimum_threshold) || 0;
        const unit = mat.unit_of_measure || "kg";
        const status = computeStockStatus(curStock, minStock);

        // Calculate total received for this material
        let totalReceived = 0;
        state.stockReceipts.forEach(r => {
            if (String(r.material_id) === String(mat.id)) {
                totalReceived += Number(r.received_quantity != null ? r.received_quantity : r.quantity) || 0;
            }
        });

        // Calculate total disbursed for this material & usage by finished product
        let totalDisbursed = 0;
        const prodUsageMap = new Map();

        state.disbursements.forEach(d => {
            if (String(d.material_id) === String(mat.id)) {
                const qty = Number(d.consumed_quantity != null ? d.consumed_quantity : d.quantity) || 0;
                totalDisbursed += qty;
                const pName = (d.finished_product_name || d.activity_type || "").trim() || "General Usage";
                if (!isGenericOperationalName(pName)) {
                    prodUsageMap.set(pName, (prodUsageMap.get(pName) || 0) + qty);
                }
            }
        });

        // Associated products list
        const associatedProds = (state.finishedProducts || []).filter(p => p.materialIds && p.materialIds.map(String).includes(String(mat.id)));
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

    renderPaginationControls(paginationEl, state.materialPage, totalPages, (newPage) => {
        state.materialPage = newPage;
        renderMaterialOverview();
    });

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
        renderPaginationControls(paginationEl, state.historyPage, totalPages, (newPage) => {
            state.historyPage = newPage;
            renderCard2History();
        });
    }
}

function renderPaginationControls(container, currentPage, totalPages, onPageChange) {
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    const maxVisible = 7;
    let pages = [];
    if (totalPages <= maxVisible) {
        pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else {
        pages.push(1);
        if (currentPage > 4) pages.push("...");

        const start = Math.max(2, currentPage - 2);
        const end = Math.min(totalPages - 1, currentPage + 2);
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }

        if (currentPage < totalPages - 3) pages.push("...");
        pages.push(totalPages);
    }

    let html = `
        <button type="button" class="page-btn page-nav-btn page-nav-prev" ${currentPage <= 1 ? "disabled" : ""} title="Previous Page">‹ Prev</button>
    `;

    pages.forEach(p => {
        if (p === "...") {
            html += `<span class="page-ellipsis">…</span>`;
        } else {
            html += `<button type="button" class="page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
        }
    });

    html += `
        <button type="button" class="page-btn page-nav-btn page-nav-next" ${currentPage >= totalPages ? "disabled" : ""} title="Next Page">Next ›</button>
    `;

    container.innerHTML = html;

    const prevBtn = container.querySelector(".page-nav-prev");
    const nextBtn = container.querySelector(".page-nav-next");

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
            const p = Number(btn.getAttribute("data-page") || btn.dataset.page);
            if (p && p !== currentPage) onPageChange(p);
        });
    });
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
    if (subtitle) subtitle.textContent = `Usage and movement breakdown across finished products`;

    if (curStockEl) curStockEl.textContent = formatQty(curStock, unit);
    if (minStockEl) minStockEl.textContent = formatQty(minStock, unit);
    if (statusEl) {
        statusEl.className = `status-badge ${status.cls}`;
        statusEl.innerHTML = `<span class="badge-dot ${status.dot}"></span>${status.label}`;
    }

    let totalReceived = 0;
    const prodRecMap = new Map();
    state.stockReceipts.forEach(r => {
        if (String(r.material_id) === String(mat.id)) {
            const qty = Number(r.received_quantity != null ? r.received_quantity : r.quantity) || 0;
            totalReceived += qty;
            const supplier = (r.supplier_name || "").trim();

            let matchedProd = null;
            if (Array.isArray(state.finishedProducts)) {
                for (const p of state.finishedProducts) {
                    if (supplier.toLowerCase().includes(p.name.toLowerCase())) {
                        matchedProd = p.name;
                        break;
                    }
                }
            }
            if (matchedProd) {
                prodRecMap.set(matchedProd, (prodRecMap.get(matchedProd) || 0) + qty);
            } else {
                const contextKey = supplier ? (supplier.toLowerCase().includes("package") ? supplier : `Inbound (${supplier})`) : "Direct / Inbound Stock";
                prodRecMap.set(contextKey, (prodRecMap.get(contextKey) || 0) + qty);
            }
        }
    });

    let totalDisbursed = 0;
    const prodUsageMap = new Map();

    state.disbursements.forEach(d => {
        if (String(d.material_id) === String(mat.id)) {
            const qty = Number(d.consumed_quantity != null ? d.consumed_quantity : d.quantity) || 0;
            totalDisbursed += qty;
            const pName = (d.finished_product_name || d.activity_type || "").trim() || "General Usage";
            if (!isGenericOperationalName(pName)) {
                prodUsageMap.set(pName, (prodUsageMap.get(pName) || 0) + qty);
            }
        }
    });

    // Map finished products that link to this material
    const prodsList = Array.isArray(state.finishedProducts) ? state.finishedProducts : [];
    const associatedProds = prodsList.filter(p => p.materialIds && p.materialIds.map(String).includes(String(mat.id)));

    associatedProds.forEach(p => {
        if (!prodUsageMap.has(p.name)) {
            prodUsageMap.set(p.name, 0);
        }
        if (!prodRecMap.has(p.name)) {
            prodRecMap.set(p.name, 0);
        }
    });

    if (totalRecEl) totalRecEl.textContent = formatQty(totalReceived, unit);
    if (totalDisbEl) totalDisbEl.textContent = formatQty(totalDisbursed, unit);

    if (tbody) {
        const allKeys = new Set([...associatedProds.map(p => p.name), ...prodUsageMap.keys(), ...prodRecMap.keys()]);

        if (allKeys.size === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 24px; color: var(--rm-ink-dim); font-size: 0.85rem;">No product movement recorded yet.</td></tr>`;
        } else {
            const sortedKeys = Array.from(allKeys).sort((a, b) => {
                const aIsProd = associatedProds.some(p => p.name === a);
                const bIsProd = associatedProds.some(p => p.name === b);
                if (aIsProd && !bIsProd) return -1;
                if (!aIsProd && bIsProd) return 1;
                return a.localeCompare(b);
            });

            tbody.innerHTML = sortedKeys.map(key => {
                const rec = prodRecMap.get(key) || 0;
                const disb = prodUsageMap.get(key) || 0;
                return `
                    <tr>
                        <td><strong>${escapeHtml(key)}</strong></td>
                        <td><strong class="val-received" style="color:#16a34a; font-weight:700;">${formatQty(rec, unit)}</strong></td>
                        <td><strong class="val-disbursed" style="color:#ea580c; font-weight:700;">${formatQty(disb, unit)}</strong></td>
                        <td>${escapeHtml(unit)}</td>
                    </tr>
                `;
            }).join("");
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

let currentReceiveMode = "single"; // "single" | "package"
let currentReceiveProduct = null;  // { id, name, materialIds }

let currentDisburseMode = "single"; // "single" | "package"
let currentDisburseProduct = null;  // { id, name, materialIds }

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
    const mat = state.materials.find(m => m.id === matId);
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

    // Margin of Error Validation (+7.51% Upper Limit)
    const typicalBatchReq = Math.max(minThresh * 0.50, Math.min(cur * 0.50, 50), 10);
    const upperMarginLimit = typicalBatchReq * 1.0751;

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
    const dateInput = document.getElementById("maReceiveDateInput");
    const supplierInput = document.getElementById("maReceiveSupplierInput");
    const prodInput = document.getElementById("maReceiveProductContextInput");

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
        if (pkgAvatar) pkgAvatar.textContent = initials(prod.name);
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
                    ${escapeHtml(m.name)} (${escapeHtml(m.item_code || "RM—")}) — Current Stock: ${formatQty(m.current_stock, m.unit_of_measure)}
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
                    if (matAvatar) matAvatar.textContent = initials(mat.name);
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

function closeReceiveModal() {
    const overlay = document.getElementById("maReceiveModalOverlay");
    if (overlay) overlay.classList.remove("open", "active");
}

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

function closeDisburseModal() {
    const overlay = document.getElementById("maDisburseModalOverlay");
    if (overlay) overlay.classList.remove("open", "active");
}

async function handleSaveDisburse() {
    clearModalErrors("maDisburse");

    const dateInput = document.getElementById("maDisburseDateInput");
    const notesInput = document.getElementById("maDisburseNotesInput");
    const date = dateInput ? dateInput.value : "";
    const notes = notesInput ? notesInput.value.trim() : "";

    if (!date) {
        setFieldError("maDisburseDateError", "Disbursement date is required.");
        return;
    }

    if (currentDisburseMode === "package") {
        if (!currentDisburseProduct) return;
        const countInput = document.getElementById("maDisbursePackageCountInput");
        const pkgCount = Math.max(1, parseInt(countInput?.value) || 1);

        const matItems = (currentDisburseProduct.materialIds || [])
            .map(id => state.materials.find(m => String(m.id) === String(id)))
            .filter(Boolean);

        if (matItems.length === 0) {
            toast("No raw materials found in this product bundle to disburse.", "error");
            return;
        }

        // Validate stock sufficiency for all materials
        for (const mat of matItems) {
            const minStock = Number(mat.minimum_threshold) || 0;
            const baseUsage = Math.max(1, Math.round((minStock > 0 ? minStock : 10) * 0.5));
            const qtyToDeduct = baseUsage * pkgCount;
            const curStock = Number(mat.current_stock) || 0;
            if (qtyToDeduct > curStock) {
                toast(`Insufficient stock for ${mat.name}. Requires ${formatQty(qtyToDeduct, mat.unit_of_measure)}, available: ${formatQty(curStock, mat.unit_of_measure)}.`, "error");
                return;
            }
        }

        const nowIso = new Date().toISOString();
        const newDisbursements = [];
        const stockUpdates = [];

        // 1. Instant Optimistic Local Update
        matItems.forEach(mat => {
            const minStock = Number(mat.minimum_threshold) || 0;
            const baseUsage = Math.max(1, Math.round((minStock > 0 ? minStock : 10) * 0.5));
            const qtyToDeduct = baseUsage * pkgCount;
            const newStock = Math.max(0, (Number(mat.current_stock) || 0) - qtyToDeduct);

            mat.current_stock = newStock;

            const dsbObj = {
                id: `dsb-pkg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                material_id: mat.id,
                usage_date: date,
                consumed_quantity: qtyToDeduct,
                unit: mat.unit_of_measure || "kg",
                activity_type: currentDisburseProduct.name,
                finished_product_name: currentDisburseProduct.name,
                created_at: nowIso
            };
            newDisbursements.push(dsbObj);
            stockUpdates.push({ id: mat.id, stock: newStock });
        });

        state.disbursements = [...newDisbursements, ...state.disbursements];
        newDisbursements.forEach(d => saveCustomDisbursement(d));
        invalidateForecastCache();
        buildUnifiedActivities();
        renderCard1();
        renderCard2History();

        // 2. Immediate feedback & Close Modal
        toast(`Disbursed ${pkgCount} package(s) for ${currentDisburseProduct.name} (${matItems.length} ingredients deducted)`, "success");
        closeDisburseModal();

        // 3. Local sync broadcast
        try {
            localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "disburse_package", product: currentDisburseProduct.name, pkgCount }));
            localStorage.setItem("rmims_inventory_updated", Date.now().toString());
        } catch {}

        if (window.RMIMS_NOTIFICATIONS?.addNotification) {
            window.RMIMS_NOTIFICATIONS.addNotification({
                id: `notif-disb-pkg-${Date.now()}`,
                category: 'disbursement',
                priority: 'info',
                title: 'Package Disbursed',
                message: `${currentDisburseProduct.name} package disbursed (${pkgCount} batch, ${matItems.length} materials consumed).`,
                actor: `Source: Material Activity (${getUserDisplayName()})`,
                roleScope: 'all',
                timestamp: nowIso
            });
        }

        // 4. Background Database Batch Persistence (High-speed bulk insert & parallel stock updates)
        (async () => {
            try {
                const insertPayload = newDisbursements.map(d => ({
                    material_id: d.material_id,
                    usage_date: d.usage_date,
                    consumed_quantity: d.consumed_quantity,
                    unit: d.unit,
                    activity_type: d.activity_type,
                    finished_product_name: d.finished_product_name,
                    created_at: d.created_at
                }));
                await supabase.from("material_disbursements").insert(insertPayload);

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
    const matSelect = document.getElementById("maDisburseMaterialSelect");
    const qtyInput = document.getElementById("maDisburseQuantityInput");
    const prodInput = document.getElementById("maDisburseProductSelect");
    const matId = matSelect ? matSelect.value : "";
    const qty = Number(qtyInput ? qtyInput.value : 0);
    const productContext = prodInput ? (prodInput.value.trim() || "General Usage") : "General Usage";

    const mat = state.materials.find(m => String(m.id) === String(matId));

    let hasError = false;
    if (!matId || !mat) {
        setFieldError("maDisburseMaterialError", "Please select a raw material.");
        hasError = true;
    }
    if (!qty || isNaN(qty) || qty <= 0) {
        setFieldError("maDisburseQuantityError", "Quantity must be greater than 0.");
        hasError = true;
    }
    if (mat && qty > Number(mat.current_stock)) {
        setFieldError("maDisburseQuantityError", `Insufficient stock. Available: ${formatQty(mat.current_stock, mat.unit_of_measure)}.`);
        hasError = true;
    }

    if (hasError) return;

    const nowIso = new Date().toISOString();
    const newStock = Math.max(0, (Number(mat.current_stock) || 0) - qty);

    // 1. Optimistic Local Update
    mat.current_stock = newStock;
    const newDsb = {
        id: `dsb-sng-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        material_id: mat.id,
        usage_date: date,
        consumed_quantity: qty,
        unit: mat.unit_of_measure || "kg",
        activity_type: productContext,
        finished_product_name: productContext,
        created_at: nowIso
    };
    state.disbursements = [newDsb, ...state.disbursements];
    saveCustomDisbursement(newDsb);
    invalidateForecastCache();
    buildUnifiedActivities();
    renderCard1();
    renderCard2History();

    // 2. Immediate feedback & Close Modal
    toast(`Disbursed ${formatQty(qty, mat.unit_of_measure)} for ${productContext}`, "success");
    closeDisburseModal();

    // 3. Local sync
    try {
        localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "disburse", materialId: matId, qty, context: productContext }));
        localStorage.setItem("rmims_inventory_updated", Date.now().toString());
    } catch {}

    if (window.RMIMS_NOTIFICATIONS?.addNotification) {
        window.RMIMS_NOTIFICATIONS.addNotification({
            id: `notif-disb-mat-${Date.now()}`,
            category: 'disbursement',
            priority: 'info',
            title: 'Material Disbursed',
            message: `${mat.name} disbursed: ${qty} ${mat.unit_of_measure || "kg"} (for ${productContext}).`,
            actor: `Source: Material Activity (${getUserDisplayName()})`,
            roleScope: 'all',
            timestamp: nowIso
        });
    }

    // 4. Background Database Persistence
    (async () => {
        try {
            await supabase.from("material_disbursements").insert([{
                material_id: mat.id,
                usage_date: date,
                consumed_quantity: qty,
                unit: mat.unit_of_measure || "kg",
                activity_type: productContext,
                finished_product_name: productContext,
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

function setFieldError(elementId, msg = "") {
    const el = document.getElementById(elementId);
    if (el) el.textContent = msg;
}

function clearModalErrors(prefix) {
    document.querySelectorAll(`[id^="${prefix}"][id$="Error"]`).forEach(el => el.textContent = "");
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

    // Quick action buttons in Card 1 header
    const btnQuickRec = document.getElementById("btnQuickRecordReceipt");
    if (btnQuickRec) btnQuickRec.addEventListener("click", () => openReceiveModal());

    const btnQuickDisb = document.getElementById("btnQuickRecordDisburse");
    if (btnQuickDisb) btnQuickDisb.addEventListener("click", () => openDisburseModal());

    // Check URL parameters for navigation from other modules (e.g. inventory.html?tab=receive)
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const tabParam = urlParams.get("tab") || urlParams.get("action");
        if (tabParam === "receive") {
            if (tabMat && tabProd && viewMat && viewProd) {
                state.card1Tab = "material";
                tabMat.classList.add("active");
                tabProd.classList.remove("active");
                viewMat.hidden = false;
                viewProd.hidden = true;
            }
            const histActivity = document.getElementById("historyActivityFilter");
            if (histActivity) histActivity.value = "receive";
            state.historyActivity = "receive";
        } else if (tabParam === "disbursement" || tabParam === "disburse") {
            if (tabMat && tabProd && viewMat && viewProd) {
                state.card1Tab = "material";
                tabMat.classList.add("active");
                tabProd.classList.remove("active");
                viewMat.hidden = false;
                viewProd.hidden = true;
            }
            const histActivity = document.getElementById("historyActivityFilter");
            if (histActivity) histActivity.value = "disbursement";
            state.historyActivity = "disbursement";
        }
    } catch (e) {}
    const prodSearch = document.getElementById("productSearchInput");
    const prodSort = document.getElementById("productSortSelect");
    const prodPageSize = document.getElementById("productPageSize");

    if (prodSearch) {
        prodSearch.addEventListener("input", () => {
            state.productSearch = prodSearch.value;
            state.productPage = 1;
            renderProductOverview();
        });
    }

    if (prodSort) {
        prodSort.addEventListener("change", () => {
            state.productSort = prodSort.value;
            state.productPage = 1;
            renderProductOverview();
        });
    }

    if (prodPageSize) {
        prodPageSize.addEventListener("change", () => {
            state.productPageSize = Number(prodPageSize.value) || 9;
            state.productPage = 1;
            renderProductOverview();
        });
    }

    // Card 1: Material Overview Filters
    const matSearch = document.getElementById("materialSearchInput");
    const matSort = document.getElementById("materialSortSelect");
    const matPageSize = document.getElementById("materialPageSize");

    if (matSearch) {
        matSearch.addEventListener("input", () => {
            state.materialSearch = matSearch.value;
            state.materialPage = 1;
            renderMaterialOverview();
        });
    }

    if (matSort) {
        matSort.addEventListener("change", () => {
            state.materialSort = matSort.value;
            state.materialPage = 1;
            renderMaterialOverview();
        });
    }

    if (matPageSize) {
        matPageSize.addEventListener("change", () => {
            state.materialPageSize = Number(matPageSize.value) || 10;
            state.materialPage = 1;
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

    // Initialize Flatpickr Calendars with Custom System Theme
    initActivityFlatpickr();

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
        recMinus.addEventListener("click", (e) => {
            e.preventDefault();
            let current = parseFloat(recQty.value) || 0;
            if (current > 1) {
                recQty.value = current % 1 === 0 ? Math.max(1, current - 1) : Math.max(0.01, (current - 1).toFixed(2));
            } else {
                recQty.value = "1";
            }
            recQty.dispatchEvent(new Event("input"));
        });
    }
    if (recPlus && recQty) {
        recPlus.addEventListener("click", (e) => {
            e.preventDefault();
            let current = parseFloat(recQty.value) || 0;
            recQty.value = current % 1 === 0 ? (current + 1) : (current + 1).toFixed(2);
            recQty.dispatchEvent(new Event("input"));
        });
    }
    if (recQty) {
        recQty.addEventListener("input", updateReceiveLivePreview);
    }

    // Package Stepper - Receive Modal (Admin)
    const recPkgMinus = document.getElementById("maReceivePackageMinusBtn");
    const recPkgPlus = document.getElementById("maReceivePackagePlusBtn");
    const recPkgCount = document.getElementById("maReceivePackageCountInput");

    if (recPkgMinus && recPkgCount) {
        recPkgMinus.addEventListener("click", (e) => {
            e.preventDefault();
            const cur = Math.max(1, (parseInt(recPkgCount.value) || 1) - 1);
            recPkgCount.value = cur;
            renderReceivePackageTable(cur);
        });
    }
    if (recPkgPlus && recPkgCount) {
        recPkgPlus.addEventListener("click", (e) => {
            e.preventDefault();
            const cur = (parseInt(recPkgCount.value) || 1) + 1;
            recPkgCount.value = cur;
            renderReceivePackageTable(cur);
        });
    }
    if (recPkgCount) {
        recPkgCount.addEventListener("input", () => {
            const val = Math.max(1, parseInt(recPkgCount.value) || 1);
            renderReceivePackageTable(val);
        });
    }

    // Stepper buttons for Disburse Modal (+ and -)
    const disbMinus = document.getElementById("maDisburseMinusBtn");
    const disbPlus = document.getElementById("maDisbursePlusBtn");
    const disbQty = document.getElementById("maDisburseQuantityInput");
    if (disbMinus && disbQty) {
        disbMinus.addEventListener("click", (e) => {
            e.preventDefault();
            let current = parseFloat(disbQty.value) || 0;
            if (current > 1) {
                disbQty.value = current % 1 === 0 ? Math.max(1, current - 1) : Math.max(0.01, (current - 1).toFixed(2));
            } else {
                disbQty.value = "1";
            }
            disbQty.dispatchEvent(new Event("input"));
        });
    }
    if (disbPlus && disbQty) {
        disbPlus.addEventListener("click", (e) => {
            e.preventDefault();
            let current = parseFloat(disbQty.value) || 0;
            disbQty.value = current % 1 === 0 ? (current + 1) : (current + 1).toFixed(2);
            disbQty.dispatchEvent(new Event("input"));
        });
    }
    if (disbQty) {
        disbQty.addEventListener("input", updateDisburseLivePreview);
    }

    // Package Stepper - Disburse Modal (Admin)
    const disbPkgMinus = document.getElementById("maDisbursePackageMinusBtn");
    const disbPkgPlus = document.getElementById("maDisbursePackagePlusBtn");
    const disbPkgCount = document.getElementById("maDisbursePackageCountInput");

    if (disbPkgMinus && disbPkgCount) {
        disbPkgMinus.addEventListener("click", (e) => {
            e.preventDefault();
            const cur = Math.max(1, (parseInt(disbPkgCount.value) || 1) - 1);
            disbPkgCount.value = cur;
            renderDisbursePackageTable(cur);
        });
    }
    if (disbPkgPlus && disbPkgCount) {
        disbPkgPlus.addEventListener("click", (e) => {
            e.preventDefault();
            const cur = (parseInt(disbPkgCount.value) || 1) + 1;
            disbPkgCount.value = cur;
            renderDisbursePackageTable(cur);
        });
    }
    if (disbPkgCount) {
        disbPkgCount.addEventListener("input", () => {
            const val = Math.max(1, parseInt(disbPkgCount.value) || 1);
            renderDisbursePackageTable(val);
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

    // Cross-Tab / Cross-Window Real-time Sync
    let _storageDebounceTimer = null;
    window.addEventListener("storage", (e) => {
        if (!e.key || e.key.startsWith("rmims_") || e.key.includes("receipt") || e.key.includes("disbursement")) {
            clearTimeout(_storageDebounceTimer);
            _storageDebounceTimer = setTimeout(() => {
                loadAuthoritativeData();
            }, 120);
        }
    });

    // Supabase Realtime Channel Subscription for live cross-user updates (Admin)
    if (supabase && typeof supabase.channel === "function" && !window.__rmimsMaAdminChannel) {
        window.__rmimsMaAdminChannel = supabase
            .channel("rmims_admin_material_activity_sync")
            .on("postgres_changes", { event: "*", schema: "public", table: "stock_receipts" }, () => {
                loadAuthoritativeData();
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "material_disbursements" }, () => {
                loadAuthoritativeData();
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "raw_materials" }, () => {
                loadAuthoritativeData();
            })
            .subscribe();
    }
}
