// RMIMS V2 — User Inventory & Stock Management Module
// Authoritative tables: raw_materials, stock_receipts, material_disbursements, user_profiles.
// Full 4-tab workspace mirroring Admin Inventory visual design & operational capabilities.
// Features: Interactive Flatpickr Datepickers, 4-Tab Multi-Selection & Permanent Cascading Deletions,
// Unified Finished Product Card Boxes with "+N more" details viewer, and direct Material Activity navigation.

import { auth, supabase } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";
import {
    AUTHENTIC_59_RAW_MATERIALS,
    AUTHENTIC_STOCK_RECEIPTS_6MONTHS,
    AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS
} from "./authentic-59-dataset.js";
import { AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from "./authentic-finished-products.js";
import { getSystemRawMaterials, getSystemCustomReceipts, getSystemCustomDisbursements } from "./system-materials.js";
import "./rmsme-shell.js";

const $ = (id) => document.getElementById(id);

const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str));

/* ==========================
   ROLE PROTECTION
========================== */

const profileBtn = $("profileBtn");

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../user-signin.html";
        return;
    }

    try {
        const { data: profile, error } = await supabase
            .from("user_profiles")
            .select("id, full_name, role, status")
            .eq("id", user.uid)
            .single();

        if (error || !profile || profile.status !== "active") {
            window.location.href = "../user-signin.html";
            return;
        }

        if (profile.role !== "user") {
            window.location.href = "../admin/dashboard.html";
            return;
        }

        if (profileBtn) {
            const pText = profileBtn.querySelector(".profile-text") || profileBtn;
            pText.textContent = profile.full_name || "Staff";
            const pAv = profileBtn.querySelector(".avatar");
            if (pAv && profile.full_name) {
                pAv.textContent = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
            }
        }

        await initUserInventory();
    } catch (err) {
        console.error("Auth verification failed:", err);
        window.location.href = "../user-signin.html";
    }
});

/* ==========================
   STATE MANAGEMENT
========================== */

const state = {
    // Authoritative collections
    materials: [],
    receipts: [],
    disbursements: [],

    // Maps
    rawMaterialsMap: new Map(), // id -> material obj

    // Overview Tab State
    overviewSearch: "",
    overviewDateFrom: "",
    overviewDateTo: "",
    overviewActivityFilter: "all", // "all" | "receive" | "disbursement"
    overviewStatusFilter: "all",   // "all" | "in_stock" | "low_stock" | "out_of_stock"
    overviewSort: "latest",        // "latest" | "oldest" | "az" | "za"
    overviewPage: 1,
    overviewPageSize: 10,

    // Receive Tab State
    receiveSearch: "",
    receiveDateFrom: "",
    receiveDateTo: "",
    receiveSort: "latest",        // "latest" | "oldest" | "az" | "za"
    receivePage: 1,
    receivePageSize: 10,

    // Disbursement Tab State
    disburseSearch: "",
    disburseDateFrom: "",
    disburseDateTo: "",
    disburseSort: "latest",       // "latest" | "oldest" | "az" | "za"
    disbursePage: 1,
    disbursePageSize: 10,

    // Other Details (Finished Products) Tab State
    finishedProducts: [],
    fpcSearch: "",
    fpcSort: "latest",
    fpcPage: 1,
    fpcPageSize: 20,

    // Active Workspace Tab
    activeTab: "overview",

    // Multiple row selection and mode across all 4 tabs
    selectedOverviewIds: new Set(),
    selectedReceiveIds: new Set(),
    selectedDisburseIds: new Set(),
    selectedProductIds: new Set(),

    selectModeOverview: false,
    selectModeReceive: false,
    selectModeDisburse: false,
    selectModeFpc: false,

    currentlyViewingProduct: null
};

const FP_STORAGE_KEY = "rmims_finished_product_context";
const FP_DELETED_KEY = "rmims_deleted_finished_products";

/* ==========================
   HELPERS & FORMATTING
========================== */

const esc = (val) => String(val ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);

const num = (val) => {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
};

const fmtQty = (v, u = "") => `${num(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${u ? ` ${u}` : ""}`;

const fmtDate = (d) => {
    if (!d) return "—";
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return String(d);
    return dateObj.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

function getInitials(name) {
    if (!name) return "FP";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function setFieldError(elementId, errorMsg = "") {
    const el = $(elementId);
    if (!el) return;
    el.textContent = errorMsg;
    el.style.display = errorMsg ? "block" : "none";
}

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

/* ==========================================================
   STOCK STATUS FORMULA
   ========================================================== */

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

function computeStockProgress(currentStock, minStock, maxStock) {
    const curr = num(currentStock);
    const min = minStock !== null && minStock !== undefined ? num(minStock) : 0;
    const max = maxStock !== null && maxStock !== undefined && num(maxStock) > 0 
        ? num(maxStock) 
        : (min > 0 ? min * 2 : (curr > 0 ? curr * 1.5 : 100));

    if (curr <= 0) {
        return { pct: 0, cls: "fill-red", target: max };
    }

    const pct = Math.min(100, Math.max(1, Math.round((curr / max) * 100)));
    let cls = "fill-green";
    if (min > 0 && curr <= min) {
        cls = "fill-orange";
    }
    return { pct, cls, target: max };
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

/* ==========================================================
   INITIALIZATION & TAB SWITCHING
   ========================================================== */

async function initUserInventory() {
    setupTabSwitching();
    setupOverviewEventListeners();
    setupReceiveEventListeners();
    setupDisburseEventListeners();
    setupEditModalEventListeners();
    setupOtherDetailsEventListeners();

    if ($("refreshBtn")) {
        $("refreshBtn").addEventListener("click", () => loadAllData(true));
    }

    await loadAllData();
}

function setupTabSwitching() {
    const tabs = [
        { btn: $("tabBtnOverview"), pane: $("paneOverview"), key: "overview", crumb: "Overview" },
        { btn: $("tabBtnReceive"), pane: $("paneReceive"), key: "receive", crumb: "Receive" },
        { btn: $("tabBtnDisbursement"), pane: $("paneDisbursement"), key: "disbursement", crumb: "Disbursement" },
        { btn: $("tabBtnOtherDetails"), pane: $("paneOtherDetails"), key: "other-details", crumb: "Other Details" }
    ];

    const currentCrumb = $("currentCrumb");

    tabs.forEach(t => {
        if (!t.btn) return;
        t.btn.addEventListener("click", () => {
            state.activeTab = t.key;
            tabs.forEach(o => {
                if (o.btn) o.btn.classList.toggle("active", o.key === t.key);
                if (o.pane) o.pane.hidden = o.key !== t.key;
            });
            if (currentCrumb) currentCrumb.textContent = t.crumb;

            if (t.key === "overview") renderOverviewTable();
            else if (t.key === "receive") renderReceiveTable();
            else if (t.key === "disbursement") renderDisbursementTable();
            else if (t.key === "other-details") renderFinishedProducts();
        });
    });
}

/* ==========================================================
   DATA LOADING & STATE AGGREGATION
   ========================================================== */

async function loadAllData(showToast = false) {
    try {
        let rawMaterialsList = getSystemRawMaterials();
        let rawReceipts = [...AUTHENTIC_STOCK_RECEIPTS_6MONTHS, ...getSystemCustomReceipts()];
        let rawDisbursements = [...AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS, ...getSystemCustomDisbursements()];

        try {
            const fetchWithTimeout = (promise, ms = 4000) => 
                Promise.race([
                    promise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
                ]);

            const [mRes, rRes, dRes] = await Promise.allSettled([
                fetchWithTimeout(supabase.from("raw_materials").select("id, item_code, name, description, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, created_at, updated_at").order("name")),
                fetchWithTimeout(supabase.from("stock_receipts").select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at").order("receipt_date", { ascending: false })),
                fetchWithTimeout(supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("usage_date", { ascending: false }))
            ]);

            if (mRes.status === "fulfilled" && mRes.value?.data && mRes.value.data.length > 0) {
                const matKeyMap = new Map();
                rawMaterialsList.forEach(m => matKeyMap.set((m.name || "").toLowerCase().trim(), { ...m }));
                mRes.value.data.forEach(m => {
                    const k = (m.name || "").toLowerCase().trim();
                    matKeyMap.set(k, { ...(matKeyMap.get(k) || {}), ...m });
                });
                rawMaterialsList = Array.from(matKeyMap.values());
            }

            if (rRes.status === "fulfilled" && rRes.value?.data && rRes.value.data.length > 0) {
                const recKeyMap = new Map();
                rawReceipts.forEach(r => recKeyMap.set(String(r.id), { ...r }));
                rRes.value.data.forEach(r => recKeyMap.set(String(r.id), { ...r }));
                rawReceipts = Array.from(recKeyMap.values());
            }

            if (dRes.status === "fulfilled" && dRes.value?.data && dRes.value.data.length > 0) {
                const disbKeyMap = new Map();
                rawDisbursements.forEach(d => disbKeyMap.set(String(d.id), { ...d }));
                dRes.value.data.forEach(d => disbKeyMap.set(String(d.id), { ...d }));
                rawDisbursements = Array.from(disbKeyMap.values());
            }
        } catch (e) {
            console.warn("Using baseline inventory dataset:", e);
        }

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

        let deletedProdNames = new Set();
        try {
            deletedProdNames = new Set(JSON.parse(localStorage.getItem(FP_DELETED_KEY) || "[]").map(x => String(x).toLowerCase().trim()));
        } catch (e) {}

        if (deletedMatIds.size > 0) {
            rawMaterialsList = rawMaterialsList.filter(m => !deletedMatIds.has(String(m.id).toLowerCase().trim()) && !deletedMatIds.has((m.name || "").toLowerCase().trim()));
        }
        if (deletedDisbIds.size > 0) {
            rawDisbursements = rawDisbursements.filter(d => !deletedDisbIds.has(String(d.id)));
        }
        if (deletedRecIds.size > 0) {
            rawReceipts = rawReceipts.filter(r => !deletedRecIds.has(String(r.id)));
        }

        // Compute current stock dynamically from the live ledger formula
        const rcvSumMap = new Map();
        rawReceipts.forEach(r => {
            const mId = String(r.material_id || r.materialId || "");
            const mCode = String(r.material_code || r.materialCode || r.item_code || "");
            const mName = String(r.material_name || r.materialName || "").toLowerCase().trim();
            const q = Number(r.received_quantity || r.receivedQuantity || r.quantity || 0);
            if (mId) rcvSumMap.set(mId, (rcvSumMap.get(mId) || 0) + q);
            if (mCode) rcvSumMap.set(mCode, (rcvSumMap.get(mCode) || 0) + q);
            if (mName) rcvSumMap.set(mName, (rcvSumMap.get(mName) || 0) + q);
        });

        const disbSumMap = new Map();
        rawDisbursements.forEach(d => {
            const mId = String(d.material_id || d.materialId || "");
            const mCode = String(d.material_code || d.materialCode || d.item_code || "");
            const mName = String(d.material_name || d.materialName || "").toLowerCase().trim();
            const q = Number(d.consumed_quantity || d.consumedQuantity || d.quantity || 0);
            if (mId) disbSumMap.set(mId, (disbSumMap.get(mId) || 0) + q);
            if (mCode) disbSumMap.set(mCode, (disbSumMap.get(mCode) || 0) + q);
            if (mName) disbSumMap.set(mName, (disbSumMap.get(mName) || 0) + q);
        });

        // Build Raw Material Map & Catalog Objects
        state.rawMaterialsMap.clear();
        state.materials = rawMaterialsList.map((d, mIdx) => {
            const minStock = d.minimum_threshold !== null && d.minimum_threshold !== undefined ? num(d.minimum_threshold) : 25;
            const maxStock = d.reorder_quantity !== null && d.reorder_quantity !== undefined ? num(d.reorder_quantity) : null;
            
            const cycleLength = 38 + ((mIdx * 7) % 17);
            const offset = (mIdx * 3.7) % cycleLength;
            const day0 = offset % cycleLength;
            let initFactor = 1.85;
            if (day0 < 1.8) initFactor = 0.0;
            else if (day0 < 8.5) initFactor = 0.40 + ((day0 - 1.8) / 6.7) * 0.55;
            else if (day0 < 19.0) initFactor = 1.05 + ((day0 - 8.5) / 10.5) * 0.40;
            else initFactor = 1.55 + ((cycleLength - day0) / (cycleLength - 19.0)) * 0.70;
            const initialStock = minStock * initFactor;

            const mId = String(d.id);
            const mCode = String(d.item_code || "");
            const mName = String(d.name || "").toLowerCase().trim();
            const totalRcv = rcvSumMap.get(mId) || rcvSumMap.get(mCode) || rcvSumMap.get(mName) || 0;
            const totalDisb = disbSumMap.get(mId) || disbSumMap.get(mCode) || disbSumMap.get(mName) || 0;

            const currentStock = (totalRcv > 0 || totalDisb > 0)
                ? Math.max(0, Number((initialStock + totalRcv - totalDisb).toFixed(2)))
                : num(d.current_stock);

            const status = computeStockStatus(currentStock, minStock);
            const progress = computeStockProgress(currentStock, minStock, maxStock);
            const unit = (d.unit_of_measure || "kg").trim();
            const category = d.description ? d.description.split("—")[0].trim() : "General";

            const matObj = {
                id: d.id,
                itemCode: d.item_code || "",
                item_code: d.item_code || "",
                name: d.name || "Unnamed Material",
                category,
                unit,
                unit_of_measure: unit,
                currentStock,
                current_stock: currentStock,
                minStock,
                minimum_threshold: minStock,
                maxStock,
                reorder_quantity: maxStock,
                progress,
                status,
                note: d.description || "",
                description: d.description || "",
                createdAt: d.created_at || null,
                created_at: d.created_at || null,
                updatedAt: d.updated_at || null
            };

            if (d.id) {
                state.rawMaterialsMap.set(d.id, matObj);
                state.rawMaterialsMap.set(String(d.id), matObj);
                state.rawMaterialsMap.set(String(d.id).toLowerCase().trim(), matObj);
            }
            if (d.item_code) {
                state.rawMaterialsMap.set(d.item_code, matObj);
                state.rawMaterialsMap.set(String(d.item_code).toLowerCase().trim(), matObj);
            }
            if (d.name) {
                state.rawMaterialsMap.set((d.name || "").toLowerCase().trim(), matObj);
            }
            return matObj;
        });

        state.receipts = rawReceipts;
        state.disbursements = rawDisbursements;

        // Load Finished Products Catalog & Saved Context
        let savedContext = [];
        try {
            const raw = localStorage.getItem(FP_STORAGE_KEY);
            if (raw) savedContext = JSON.parse(raw);
        } catch (e) {
            console.warn("Notice loading local finished product context:", e);
        }

        const productMap = new Map();

        // Helper to find raw material ID by name
        function findMaterialIdByName(matName) {
            const query = (matName || "").toLowerCase().trim();
            const found = state.materials.find(m => {
                const name = (m.name || "").toLowerCase().trim();
                return name === query || name.includes(query) || query.includes(name);
            });
            return found ? found.id : null;
        }

        // 1. Populate from Authentic Finished Products Catalog
        if (Array.isArray(AUTHENTIC_FINISHED_PRODUCTS_CATALOG)) {
            AUTHENTIC_FINISHED_PRODUCTS_CATALOG.forEach(p => {
                if (!p || !p.name) return;
                const norm = p.name.trim();
                const key = norm.toLowerCase();
                if (deletedProdNames.has(key)) return;

                const matIds = new Set();
                if (Array.isArray(p.materialNames)) {
                    p.materialNames.forEach(name => {
                        const mId = findMaterialIdByName(name);
                        if (mId) matIds.add(mId);
                    });
                }

                productMap.set(key, {
                    id: "fp_" + key.replace(/[^a-z0-9]/g, "_"),
                    name: norm,
                    imageUrl: null,
                    materialIds: matIds,
                    createdAt: "2026-01-01T00:00:00Z"
                });
            });
        }

        // 2. Populate / augment from saved context
        if (Array.isArray(savedContext)) {
            savedContext.forEach(p => {
                if (!p || !p.name || isGenericOperationalName(p.name)) return;
                const norm = p.name.trim();
                const key = norm.toLowerCase();
                if (deletedProdNames.has(key)) return;

                if (productMap.has(key)) {
                    const existing = productMap.get(key);
                    if (p.imageUrl) existing.imageUrl = p.imageUrl;
                    if (Array.isArray(p.materialIds)) {
                        p.materialIds.forEach(id => existing.materialIds.add(id));
                    }
                } else {
                    productMap.set(key, {
                        id: p.id || "fp_" + key.replace(/[^a-z0-9]/g, "_"),
                        name: norm,
                        imageUrl: p.imageUrl || null,
                        materialIds: new Set(p.materialIds || []),
                        createdAt: p.createdAt || new Date().toISOString()
                    });
                }
            });
        }

        // 3. Populate / augment from historic disbursements
        rawDisbursements.forEach(d => {
            const prodName = d.finished_product_name ? d.finished_product_name.trim() : "";
            if (!prodName || isGenericOperationalName(prodName)) return;
            const key = prodName.toLowerCase();
            if (deletedProdNames.has(key)) return;

            if (!productMap.has(key)) {
                productMap.set(key, {
                    id: "fp_" + key.replace(/[^a-z0-9]/g, "_"),
                    name: prodName,
                    imageUrl: null,
                    materialIds: new Set(),
                    createdAt: new Date().toISOString()
                });
            }
            if (d.material_id) {
                productMap.get(key).materialIds.add(d.material_id);
            }
        });

        state.finishedProducts = Array.from(productMap.values()).map(p => ({
            id: p.id,
            name: p.name,
            imageUrl: p.imageUrl,
            materialIds: Array.from(p.materialIds),
            createdAt: p.createdAt
        }));

        // Render Summary Cards & Active Pane
        renderSummary();
        if (state.activeTab === "overview") renderOverviewTable();
        else if (state.activeTab === "receive") renderReceiveTable();
        else if (state.activeTab === "disbursement") renderDisbursementTable();
        else if (state.activeTab === "other-details") renderFinishedProducts();

        if (showToast) toast("Inventory data refreshed.");
    } catch (err) {
        console.error("loadAllData error:", err);
        toast("Failed to load inventory data.", "error");
    }
}

/* ==========================================================
   SUMMARY & STOCK HEALTH PRESENTATION
   ========================================================== */

function renderSummary() {
    const totalCount = state.materials.length;
    let inStockCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    state.materials.forEach(m => {
        if (m.status.key === "in_stock") inStockCount++;
        else if (m.status.key === "low_stock") lowStockCount++;
        else if (m.status.key === "out_of_stock") outOfStockCount++;
    });

    if ($("summaryTotalCount")) $("summaryTotalCount").textContent = totalCount;
    if ($("summaryActiveCount")) $("summaryActiveCount").textContent = totalCount;
    if ($("statInStockCount")) $("statInStockCount").textContent = inStockCount;
    if ($("statLowStockCount")) $("statLowStockCount").textContent = lowStockCount;
    if ($("statOutOfStockCount")) $("statOutOfStockCount").textContent = outOfStockCount;

    const inStockPct = totalCount > 0 ? (inStockCount / totalCount) * 100 : 0;
    const lowStockPct = totalCount > 0 ? (lowStockCount / totalCount) * 100 : 0;
    const outOfStockPct = totalCount > 0 ? (outOfStockCount / totalCount) * 100 : 0;

    if ($("segInStock")) $("segInStock").style.width = `${inStockPct}%`;
    if ($("segLowStock")) $("segLowStock").style.width = `${lowStockPct}%`;
    if ($("segOutOfStock")) $("segOutOfStock").style.width = `${outOfStockPct}%`;
}

/* ==========================================================
   UNIVERSAL FLATPICKR INITIALIZER HELPER
   ========================================================== */

function initModalDatePicker(elementId, initialDate = "today", todayOnly = false) {
    const el = typeof elementId === "string" ? $(elementId) : elementId;
    if (!el) return null;

    if (el._flatpickr) {
        el._flatpickr.destroy();
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const defaultVal = initialDate === "today" ? todayStr : (initialDate || todayStr);

    if (typeof flatpickr === "undefined") {
        el.value = defaultVal;
        return null;
    }

    const config = {
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d/m/Y",
        defaultDate: defaultVal,
        disableMobile: true,
        allowInput: true,
        animate: true
    };

    if (todayOnly) {
        config.minDate = "today";
        config.maxDate = "today";
    }

    return flatpickr(el, config);
}

function initDateFilter(inputEl, onSelect) {
    if (!inputEl || typeof flatpickr === "undefined") return null;
    if (inputEl._flatpickr) inputEl._flatpickr.destroy();

    const fp = flatpickr(inputEl, {
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d/m/Y",
        altInputClass: "inv-input-date",
        disableMobile: true,
        allowInput: true,
        onChange: (selectedDates, dateStr) => {
            inputEl.value = dateStr;
            if (onSelect) onSelect(dateStr);
        },
        onClose: (selectedDates, dateStr, instance) => {
            if (instance && instance.altInput) {
                const val = instance.altInput.value.trim();
                if (!val) {
                    instance.clear();
                    inputEl.value = "";
                    if (onSelect) onSelect("");
                } else {
                    const parsed = instance.parseDate(val, "d/m/Y") || instance.parseDate(val, "Y-m-d");
                    if (parsed) instance.setDate(parsed, true);
                }
            }
        }
    });

    if (fp && fp.altInput) {
        fp.altInput.setAttribute("placeholder", "dd/mm/yyyy");
        fp.altInput.addEventListener("blur", () => {
            const val = fp.altInput.value.trim();
            if (!val) {
                fp.clear();
                inputEl.value = "";
                if (onSelect) onSelect("");
            }
        });
    }

    return fp;
}

/* ==========================================================
   CASCADE DELETION FOR RAW MATERIALS (TAB 1)
   ========================================================== */

async function deleteRawMaterialsCascade(idsToDelete) {
    if (!idsToDelete || idsToDelete.length === 0) return;

    const uuidIds = idsToDelete.filter(isUUID);

    if (uuidIds.length > 0) {
        // 1. Delete associated material disbursements
        try {
            const { error: disbError } = await supabase
                .from("material_disbursements")
                .delete()
                .in("material_id", uuidIds);
            if (disbError) console.warn("Notice deleting material_disbursements:", disbError);
        } catch (e) {}

        // 2. Delete associated stock receipts
        try {
            const { error: recError } = await supabase
                .from("stock_receipts")
                .delete()
                .in("material_id", uuidIds);
            if (recError) console.warn("Notice deleting stock_receipts:", recError);
        } catch (e) {}

        // 3. Delete from raw_materials
        try {
            const { error: matError } = await supabase
                .from("raw_materials")
                .delete()
                .in("id", uuidIds);
            if (matError) console.warn("Notice deleting raw_materials:", matError);
        } catch (e) {}
    }

    // 4. Save deleted material IDs and normalized names into local storage registry
    try {
        const deletedMatIds = JSON.parse(localStorage.getItem("rmims_deleted_material_ids") || "[]");
        idsToDelete.forEach(id => {
            const idStr = String(id);
            if (!deletedMatIds.includes(idStr)) deletedMatIds.push(idStr);
            const matObj = (state.materials || []).find(m => String(m.id) === idStr);
            if (matObj && matObj.name) {
                const normName = matObj.name.toLowerCase().trim();
                if (!deletedMatIds.includes(normName)) deletedMatIds.push(normName);
            }
        });
        localStorage.setItem("rmims_deleted_material_ids", JSON.stringify(deletedMatIds));
    } catch (e) {}
}

/* ==========================================================
   TAB 1: OVERVIEW (11-COLUMN INVENTORY TABLE + USER EDIT & DELETE)
   ========================================================== */

function setupOverviewEventListeners() {
    const searchInput = $("invSearchInput");
    const dateFrom = $("invDateFrom");
    const dateTo = $("invDateTo");
    const actFilter = $("invActivityStatusFilter");
    const statusFilter = $("invStatusFilter");
    const sortFilter = $("invSortFilter");
    const pageSizeSelect = $("overviewPageSize");
    const clearBtn = $("invClearFiltersBtn");
    const clearDatesBtn = $("clearInvDatesBtn");

    const syncClearBtn = () => {
        if (clearDatesBtn) {
            clearDatesBtn.style.display = (state.overviewDateFrom || state.overviewDateTo) ? "inline-flex" : "none";
        }
    };

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.overviewSearch = searchInput.value.trim().toLowerCase();
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (dateFrom) {
        initDateFilter(dateFrom, (dateStr) => {
            state.overviewDateFrom = dateStr;
            syncClearBtn();
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (dateTo) {
        initDateFilter(dateTo, (dateStr) => {
            state.overviewDateTo = dateStr;
            syncClearBtn();
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (clearDatesBtn) {
        clearDatesBtn.addEventListener("click", () => {
            if (dateFrom && dateFrom._flatpickr) dateFrom._flatpickr.clear();
            if (dateTo && dateTo._flatpickr) dateTo._flatpickr.clear();
            if (dateFrom) dateFrom.value = "";
            if (dateTo) dateTo.value = "";
            state.overviewDateFrom = "";
            state.overviewDateTo = "";
            syncClearBtn();
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (actFilter) {
        actFilter.addEventListener("change", () => {
            state.overviewActivityFilter = actFilter.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (statusFilter) {
        statusFilter.addEventListener("change", () => {
            state.overviewStatusFilter = statusFilter.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (sortFilter) {
        sortFilter.addEventListener("change", () => {
            state.overviewSort = sortFilter.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (pageSizeSelect) {
        pageSizeSelect.addEventListener("change", () => {
            state.overviewPageSize = Number(pageSizeSelect.value) || 10;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            state.overviewSearch = "";
            state.overviewDateFrom = "";
            state.overviewDateTo = "";
            state.overviewActivityFilter = "all";
            state.overviewStatusFilter = "all";
            state.overviewSort = "latest";
            state.overviewPage = 1;

            if (searchInput) searchInput.value = "";
            if (dateFrom && dateFrom._flatpickr) dateFrom._flatpickr.clear();
            if (dateTo && dateTo._flatpickr) dateTo._flatpickr.clear();
            if (dateFrom) dateFrom.value = "";
            if (dateTo) dateTo.value = "";
            if (actFilter) actFilter.value = "all";
            if (statusFilter) statusFilter.value = "all";
            if (sortFilter) sortFilter.value = "latest";

            syncClearBtn();
            renderOverviewTable();
        });
    }

    // Material Detail Modal Close
    const modalClose = $("detailModalClose");
    const modalCancel = $("detailModalCancel");
    const modalOverlay = $("detailModalOverlay");

    if (modalClose) modalClose.addEventListener("click", () => modalOverlay.classList.remove("open"));
    if (modalCancel) modalCancel.addEventListener("click", () => modalOverlay.classList.remove("open"));
    if (modalOverlay) {
        modalOverlay.addEventListener("click", (e) => {
            if (e.target === modalOverlay) modalOverlay.classList.remove("open");
        });
    }
}

function getOverviewDataList() {
    const list = state.materials.map(m => {
        const targetId = String(m.id || "").toLowerCase().trim();
        const targetCode = String(m.itemCode || m.item_code || "").toLowerCase().trim();
        const targetName = (m.name || "").toLowerCase().trim();

        const normalizeCode = (c) => {
            if (!c) return "";
            const str = String(c).toLowerCase().trim();
            const match = str.match(/^(?:rm-?)?0*(\d+)$/i);
            return match ? `rm-${String(match[1]).padStart(3, "0")}` : str;
        };
        const normTargetCode = normalizeCode(targetCode || targetId);

        const isMatch = (matId, matName, matCode) => {
            const id = String(matId || "").toLowerCase().trim();
            const name = String(matName || "").toLowerCase().trim();
            const code = String(matCode || "").toLowerCase().trim();
            const normId = normalizeCode(id);
            const normCd = normalizeCode(code);
            return (id && (id === targetId || id === targetCode || (normTargetCode && normId === normTargetCode))) ||
                   (code && (code === targetCode || code === targetId || (normTargetCode && normCd === normTargetCode))) ||
                   (name && (name === targetName || (targetName && (name.includes(targetName) || targetName.includes(name)))));
        };

        // Find and sort all receipts for this material chronologically descending
        const matReceipts = state.receipts.filter(r => isMatch(r.materialId || r.material_id, r.materialName || r.material_name, r.materialCode || r.material_code || r.item_code));
        matReceipts.sort((a, b) => {
            const dateA = new Date(a.receiptDate || a.receipt_date || a.createdAt || a.created_at || 0).getTime();
            const dateB = new Date(b.receiptDate || b.receipt_date || b.createdAt || b.created_at || 0).getTime();
            return dateB - dateA;
        });

        // Find and sort all disbursements for this material chronologically descending
        const matDisbursements = state.disbursements.filter(d => isMatch(d.materialId || d.material_id, d.materialName || d.material_name, d.materialCode || d.material_code || d.item_code));
        matDisbursements.sort((a, b) => {
            const dateA = new Date(a.usageDate || a.usage_date || a.createdAt || a.created_at || 0).getTime();
            const dateB = new Date(b.usageDate || b.usage_date || b.createdAt || b.created_at || 0).getTime();
            return dateB - dateA;
        });

        const latestReceipt = matReceipts[0] || null;
        const latestDisburse = matDisbursements[0] || null;

        let activityStatus = m.currentStock > 0 ? "Receive" : "None";
        let activityQty = m.currentStock > 0 ? fmtQty(m.currentStock) : "—";
        let activityUnit = m.unit || "kg";
        let activityDate = m.createdAt ? String(m.createdAt).slice(0, 10) : "";
        let activityTimestamp = m.createdAt ? new Date(m.createdAt).getTime() : 0;

        if (latestReceipt && latestDisburse) {
            const rDate = new Date(latestReceipt.receiptDate || latestReceipt.receipt_date || latestReceipt.createdAt || latestReceipt.created_at || 0).getTime();
            const dDate = new Date(latestDisburse.usageDate || latestDisburse.usage_date || latestDisburse.createdAt || latestDisburse.created_at || 0).getTime();
            if (rDate >= dDate) {
                activityStatus = "Receive";
                const rQty = Number(latestReceipt.receivedQuantity ?? latestReceipt.received_quantity ?? latestReceipt.quantity ?? 0);
                activityQty = fmtQty(rQty);
                activityUnit = latestReceipt.unit || m.unit;
                activityDate = (latestReceipt.receiptDate || latestReceipt.receipt_date || latestReceipt.createdAt || latestReceipt.created_at || "").toString().slice(0, 10);
                activityTimestamp = rDate;
            } else {
                activityStatus = "Disbursement";
                const dQty = Number(latestDisburse.consumedQuantity ?? latestDisburse.consumed_quantity ?? latestDisburse.quantity ?? 0);
                activityQty = fmtQty(dQty);
                activityUnit = latestDisburse.unit || m.unit;
                activityDate = (latestDisburse.usageDate || latestDisburse.usage_date || latestDisburse.createdAt || latestDisburse.created_at || "").toString().slice(0, 10);
                activityTimestamp = dDate;
            }
        } else if (latestReceipt) {
            activityStatus = "Receive";
            const rQty = Number(latestReceipt.receivedQuantity ?? latestReceipt.received_quantity ?? latestReceipt.quantity ?? 0);
            activityQty = fmtQty(rQty);
            activityUnit = latestReceipt.unit || m.unit;
            activityDate = (latestReceipt.receiptDate || latestReceipt.receipt_date || latestReceipt.createdAt || latestReceipt.created_at || "").toString().slice(0, 10);
            activityTimestamp = new Date(latestReceipt.receiptDate || latestReceipt.receipt_date || latestReceipt.createdAt || latestReceipt.created_at || 0).getTime();
        } else if (latestDisburse) {
            activityStatus = "Disbursement";
            const dQty = Number(latestDisburse.consumedQuantity ?? latestDisburse.consumed_quantity ?? latestDisburse.quantity ?? 0);
            activityQty = fmtQty(dQty);
            activityUnit = latestDisburse.unit || m.unit;
            activityDate = (latestDisburse.usageDate || latestDisburse.usage_date || latestDisburse.createdAt || latestDisburse.created_at || "").toString().slice(0, 10);
            activityTimestamp = new Date(latestDisburse.usageDate || latestDisburse.usage_date || latestDisburse.createdAt || latestDisburse.created_at || 0).getTime();
        } else if (m.currentStock > 0) {
            activityStatus = "Receive";
            activityQty = fmtQty(m.currentStock);
            activityUnit = m.unit || "kg";
        }

        const status = computeStockStatus(m.currentStock, m.minStock);

        return {
            id: m.id,
            name: m.name,
            itemCode: m.itemCode || m.item_code || "",
            minStock: m.minStock,
            currentStock: m.currentStock,
            unit: m.unit,
            activityStatus,
            activityQty,
            activityUnit,
            activityDate,
            activityTimestamp,
            note: m.note || m.description || "",
            status
        };
    });

    // Apply Filters
    const query = (state.overviewSearch || "").trim().toLowerCase();
    const dateFrom = state.overviewDateFrom ? new Date(state.overviewDateFrom).getTime() : null;
    const dateTo = state.overviewDateTo ? new Date(state.overviewDateTo + "T23:59:59").getTime() : null;
    const actFilter = (state.overviewActivityStatus || state.overviewActivityFilter || "all").toLowerCase();
    const statFilter = state.overviewStatus || state.overviewStatusFilter || "all";

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
        if (actFilter === "receive" && item.activityStatus !== "Receive") return false;
        if (actFilter === "disbursement" && item.activityStatus !== "Disbursement") return false;

        // 4. Stock Status Filter
        if (statFilter !== "all" && item.status.key !== statFilter) return false;

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

const getFilteredOverviewList = getOverviewDataList;

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
    const clearBtn = $("invClearFiltersBtn");
    if (!tbody) return;

    const filtered = getOverviewDataList();
    const total = filtered.length;

    const isFiltered = !!state.overviewSearch || !!state.overviewDateFrom || !!state.overviewDateTo || (state.overviewActivityStatus || state.overviewActivityFilter) !== "all" || (state.overviewStatus || state.overviewStatusFilter) !== "all" || state.overviewSort !== "latest";
    if (clearBtn) clearBtn.hidden = !isFiltered;

    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" style="text-align:center; padding: 36px 16px; color: var(--rm-ink-dim);">
                    <strong>No raw materials found.</strong><br>
                    <span style="font-size: 0.8rem;">Try adjusting your search criteria or filters.</span>
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = `Showing 0 of ${state.materials.length} raw materials`;
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

    const isSelectMode = !!state.selectModeOverview;
    const thSelect = $("overviewTable")?.querySelector("thead th.col-select");
    if (thSelect) thSelect.classList.toggle("hidden-col", !isSelectMode);

    const toggleBtn = $("toggleSelectOverviewBtn");
    if (toggleBtn) {
        toggleBtn.classList.toggle("active", isSelectMode);
        const textSpan = toggleBtn.querySelector(".select-btn-text");
        if (textSpan) textSpan.textContent = isSelectMode ? "Hide Select" : "Select";
    }

    if (countEl) {
        countEl.textContent = `Showing ${startIdx + 1}–${endIdx} of ${total} raw materials`;
    }

    tbody.innerHTML = paged.map(item => {
        const isSelected = state.selectedOverviewIds.has(item.id);
        let actBadge = `<span class="activity-badge activity-badge-none">— None</span>`;
        if (item.activityStatus === "Receive") {
            actBadge = `<span class="activity-badge activity-badge-receive">Receive</span>`;
        } else if (item.activityStatus === "Disbursement") {
            actBadge = `<span class="activity-badge activity-badge-disburse">Disbursement</span>`;
        }

        return `
            <tr data-id="${esc(item.id)}" class="${isSelected ? "row-selected" : ""}">
                <td class="col-select ${isSelectMode ? "" : "hidden-col"}" style="text-align: center;">
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
                <td style="text-align: right; white-space: nowrap;">
                    <div class="row-direct-actions">
                        <button type="button" class="row-action-btn delete-direct-btn" data-id="${esc(item.id)}" data-name="${esc(item.name)}" title="Delete Raw Material">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    renderPaginationControls(btnsEl, state.overviewPage, totalPages, (p) => {
        state.overviewPage = p;
        renderOverviewTable();
    });

    attachUserOverviewListeners();
    updateOverviewSelectionBar();
}

function attachUserOverviewListeners() {
    // Toggle Selection Mode
    const toggleSelectOverviewBtn = $("toggleSelectOverviewBtn");
    if (toggleSelectOverviewBtn) {
        toggleSelectOverviewBtn.onclick = () => {
            state.selectModeOverview = !state.selectModeOverview;
            if (!state.selectModeOverview) state.selectedOverviewIds.clear();
            renderOverviewTable();
        };
    }

    // Hide Selection Button
    const hideSelectionOverviewBtn = $("hideSelectionOverviewBtn");
    if (hideSelectionOverviewBtn) {
        hideSelectionOverviewBtn.onclick = () => {
            state.selectModeOverview = false;
            state.selectedOverviewIds.clear();
            renderOverviewTable();
        };
    }

    // Header Select All Checkbox
    const selectAllOverview = $("selectAllOverview");
    if (selectAllOverview) {
        selectAllOverview.onchange = (e) => {
            const filtered = getFilteredOverviewList();
            const startIdx = (state.overviewPage - 1) * state.overviewPageSize;
            const endIdx = Math.min(startIdx + state.overviewPageSize, filtered.length);
            const paged = filtered.slice(startIdx, endIdx);

            if (e.target.checked) {
                paged.forEach(item => state.selectedOverviewIds.add(item.id));
            } else {
                paged.forEach(item => state.selectedOverviewIds.delete(item.id));
            }
            renderOverviewTable();
        };
    }

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

    // Bulk Select All
    const bulkSelectAllBtn = $("bulkSelectAllBtn");
    if (bulkSelectAllBtn) {
        bulkSelectAllBtn.onclick = () => {
            const filtered = getFilteredOverviewList();
            filtered.forEach(item => state.selectedOverviewIds.add(item.id));
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
            const mat = state.rawMaterialsMap.get(firstId);
            if (mat) openEditMaterialModal(mat);
        };
    }

    // Bulk Delete Selected
    const bulkDeleteBtn = $("bulkDeleteBtn");
    if (bulkDeleteBtn) {
        bulkDeleteBtn.onclick = async () => {
            const count = state.selectedOverviewIds.size;
            if (count === 0) return;

            if (!confirm(`Are you sure you want to permanently delete the ${count} selected raw material(s) and their transaction history? This action cannot be undone.`)) {
                return;
            }

            const idsToDelete = Array.from(state.selectedOverviewIds);
            try {
                toast(`Deleting ${count} raw material(s)...`);
                await deleteRawMaterialsCascade(idsToDelete);

                toast(`Successfully deleted ${count} raw material(s).`);
                state.selectedOverviewIds.clear();
                await loadAllData();
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
            const id = btn.getAttribute("data-id");
            const mat = state.rawMaterialsMap.get(id);
            if (mat) openEditMaterialModal(mat);
        };
    });

    // Direct Row Detail
    document.querySelectorAll(".detail-direct-btn").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            const mat = state.rawMaterialsMap.get(id);
            if (mat) openMaterialDetailModal(mat);
        };
    });

    // Direct Row Delete
    document.querySelectorAll("#overviewTableBody .delete-direct-btn").forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            const name = btn.getAttribute("data-name") || "this raw material";

            if (!confirm(`Are you sure you want to permanently delete "${name}" and all its transaction history? This action cannot be undone.`)) return;

            try {
                toast(`Deleting "${name}"...`);
                await deleteRawMaterialsCascade([id]);

                toast(`Successfully deleted "${name}".`);
                state.selectedOverviewIds.delete(id);
                await loadAllData();
            } catch (err) {
                console.error("Error deleting raw material:", err);
                toast("Failed to delete raw material: " + (err.message || err), "error");
            }
        };
    });
}

/* ==========================================================
   EDIT MATERIAL MODAL & LOGIC (STAFF/USER ACCESS)
   ========================================================== */

function setupEditModalEventListeners() {
    const closeBtn = $("editMaterialModalClose");
    const cancelBtn = $("editMaterialCancelBtn");
    const saveBtn = $("editMaterialSaveBtn");
    const overlay = $("editMaterialModalOverlay");

    if (closeBtn) closeBtn.addEventListener("click", () => overlay.classList.remove("open"));
    if (cancelBtn) cancelBtn.addEventListener("click", () => overlay.classList.remove("open"));
    if (overlay) {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) overlay.classList.remove("open");
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", handleEditMaterialSave);
    }
}

function openEditMaterialModal(mat) {
    const overlay = $("editMaterialModalOverlay");
    if (!overlay) return;

    $("editMatIdInternal").value = mat.id;
    $("editMatName").value = mat.name;
    $("editMatCode").value = mat.itemCode || "—";
    $("editMatUnit").value = mat.unit || "kg";
    $("editMatCurrentStock").value = `${fmtQty(mat.currentStock)} ${mat.unit}`;
    $("editMatMinStock").value = mat.minStock !== null ? mat.minStock : "";
    
    const dateVal = mat.createdAt ? new Date(mat.createdAt).toISOString().slice(0, 10) : "today";
    if ($("editMatDate")) initModalDatePicker("editMatDate", dateVal, false);
    $("editMatNote").value = mat.note || "";

    setFieldError("editMatNameError");
    setFieldError("editMatMinStockError");

    overlay.classList.add("open");
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
        $("editMaterialModalOverlay").classList.remove("open");
        await loadAllData();
    } catch (err) {
        console.error("Update material error:", err);
        toast(err.message || "Failed to update raw material.", "error");
    } finally {
        saveBtn.disabled = false;
    }
}

/* ==========================================================
   TAB 2: RECEIVE (LIVE STOCK RECEIPTS TABLE + SELECTION & DELETE)
   ========================================================== */

function setupReceiveEventListeners() {
    const searchInput = $("receiveSearchInput");
    const dateFrom = $("receiveDateFrom");
    const dateTo = $("receiveDateTo");
    const clearDatesBtn = $("clearReceiveDatesBtn");
    const sortSelect = $("receiveSortFilter");
    const clearFiltersBtn = $("receiveClearFiltersBtn");

    const syncClearBtn = () => {
        if (clearDatesBtn) {
            clearDatesBtn.style.display = (state.receiveDateFrom || state.receiveDateTo) ? "inline-flex" : "none";
        }
    };

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.receiveSearch = searchInput.value.trim().toLowerCase();
            state.receivePage = 1;
            renderReceiveTable();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            state.receiveSort = sortSelect.value;
            state.receivePage = 1;
            renderReceiveTable();
        });
    }

    if (dateFrom) {
        initDateFilter(dateFrom, (dateStr) => {
            state.receiveDateFrom = dateStr;
            syncClearBtn();
            state.receivePage = 1;
            renderReceiveTable();
        });
    }

    if (dateTo) {
        initDateFilter(dateTo, (dateStr) => {
            state.receiveDateTo = dateStr;
            syncClearBtn();
            state.receivePage = 1;
            renderReceiveTable();
        });
    }

    if (clearDatesBtn) {
        clearDatesBtn.addEventListener("click", () => {
            if (dateFrom && dateFrom._flatpickr) dateFrom._flatpickr.clear();
            if (dateTo && dateTo._flatpickr) dateTo._flatpickr.clear();
            if (dateFrom) dateFrom.value = "";
            if (dateTo) dateTo.value = "";
            state.receiveDateFrom = "";
            state.receiveDateTo = "";
            syncClearBtn();
            state.receivePage = 1;
            renderReceiveTable();
        });
    }

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener("click", () => {
            state.receiveSearch = "";
            state.receiveDateFrom = "";
            state.receiveDateTo = "";
            state.receiveSort = "latest";

            if (searchInput) searchInput.value = "";
            if (dateFrom && dateFrom._flatpickr) dateFrom._flatpickr.clear();
            if (dateTo && dateTo._flatpickr) dateTo._flatpickr.clear();
            if (dateFrom) dateFrom.value = "";
            if (dateTo) dateTo.value = "";
            if (sortSelect) sortSelect.value = "latest";

            syncClearBtn();
            state.receivePage = 1;
            renderReceiveTable();
        });
    }
}

function updateReceiveSelectionBar() {
    const bar = $("receiveSelectionBar");
    const countEl = $("receiveSelectedCount");
    const selectAllCb = $("selectAllReceive");
    if (!bar) return;

    const selectedCount = state.selectedReceiveIds.size;
    if (selectedCount > 0) {
        bar.hidden = false;
        if (countEl) countEl.textContent = `${selectedCount} Selected`;
    } else {
        bar.hidden = true;
    }

    const filtered = getFilteredReceiveList();
    const start = (state.receivePage - 1) * state.receivePageSize;
    const end = Math.min(start + state.receivePageSize, filtered.length);
    const paged = filtered.slice(start, end);

    if (selectAllCb && paged.length > 0) {
        const allSelected = paged.every(r => state.selectedReceiveIds.has(String(r.id)));
        const someSelected = paged.some(r => state.selectedReceiveIds.has(String(r.id)));
        selectAllCb.checked = allSelected;
        selectAllCb.indeterminate = !allSelected && someSelected;
    } else if (selectAllCb) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
    }
}

function getFilteredReceiveList() {
    let list = state.receipts.filter(r => {
        const mat = state.rawMaterialsMap.get(r.material_id);
        const matName = mat ? mat.name.toLowerCase() : "";
        const matCode = mat ? mat.itemCode.toLowerCase() : "";
        const supplier = (r.supplier_name || "").toLowerCase();

        if (state.receiveSearch) {
            const combined = `${matName} ${matCode} ${supplier}`;
            if (!combined.includes(state.receiveSearch)) return false;
        }

        if (state.receiveDateFrom && r.receipt_date) {
            if (new Date(r.receipt_date) < new Date(state.receiveDateFrom)) return false;
        }
        if (state.receiveDateTo && r.receipt_date) {
            const d = new Date(state.receiveDateTo);
            d.setHours(23, 59, 59, 999);
            if (new Date(r.receipt_date) > d) return false;
        }

        return true;
    });

    const sort = state.receiveSort || "latest";
    list.sort((a, b) => {
        const matA = state.rawMaterialsMap.get(a.material_id);
        const matB = state.rawMaterialsMap.get(b.material_id);
        const nameA = matA ? matA.name : (a.material_name || "");
        const nameB = matB ? matB.name : (b.material_name || "");

        if (sort === "az") return nameA.localeCompare(nameB);
        if (sort === "za") return nameB.localeCompare(nameA);
        if (sort === "oldest") return new Date(a.receipt_date || a.created_at || 0) - new Date(b.receipt_date || b.created_at || 0);
        return new Date(b.receipt_date || b.created_at || 0) - new Date(a.receipt_date || a.created_at || 0);
    });

    return list;
}

function renderReceiveTable() {
    const tbody = $("receiveTableBody");
    const countEl = $("receiveResultCount");
    const btnsEl = $("receivePaginationBtns");
    if (!tbody) return;

    const filtered = getFilteredReceiveList();
    const total = filtered.length;

    // Check if clear button should be shown
    const isFiltered = !!state.receiveSearch || !!state.receiveDateFrom || !!state.receiveDateTo || state.receiveSort !== "latest";
    if ($("receiveClearFiltersBtn")) $("receiveClearFiltersBtn").hidden = !isFiltered;

    const isSelectMode = !!state.selectModeReceive;
    const thSelect = $("receiveTable")?.querySelector("thead th.col-select");
    if (thSelect) thSelect.classList.toggle("hidden-col", !isSelectMode);

    const toggleBtn = $("toggleSelectReceiveBtn");
    if (toggleBtn) {
        toggleBtn.classList.toggle("active", isSelectMode);
        const textSpan = toggleBtn.querySelector(".select-btn-text");
        if (textSpan) textSpan.textContent = isSelectMode ? "Hide Select" : "Select";
    }

    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align:center; padding: 36px 16px; color: var(--rm-ink-dim);">
                    <strong>No stock receipts found.</strong><br>
                    <span style="font-size: 0.8rem;">Incoming receipts logged via Material Activity will appear here.</span>
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = "Showing 0 receipts";
        if (btnsEl) btnsEl.innerHTML = "";
        updateReceiveSelectionBar();
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / state.receivePageSize));
    if (state.receivePage > totalPages) state.receivePage = totalPages;
    if (state.receivePage < 1) state.receivePage = 1;

    const start = (state.receivePage - 1) * state.receivePageSize;
    const end = Math.min(start + state.receivePageSize, total);
    const paged = filtered.slice(start, end);

    if (countEl) countEl.textContent = `Showing ${start + 1}–${end} of ${total} receipts`;

    tbody.innerHTML = paged.map(r => {
        const mat = state.rawMaterialsMap.get(r.material_id);
        const name = mat ? mat.name : "Unknown Material";
        const code = mat ? mat.itemCode : "—";
        const curStock = mat ? `${fmtQty(mat.currentStock)} ${mat.unit}` : "—";
        const minStock = mat && mat.minStock !== null ? `${fmtQty(mat.minStock)} ${mat.unit}` : "—";
        const statusBadge = mat ? `<span class="status-badge ${mat.status.cls}">${esc(mat.status.badgeText)}</span>` : "—";
        const isSelected = state.selectedReceiveIds.has(String(r.id));

        return `
            <tr data-id="${esc(r.id)}" class="${isSelected ? "row-selected" : ""}">
                <td class="col-select ${isSelectMode ? "" : "hidden-col"}" style="text-align: center;">
                    <input type="checkbox" class="inv-custom-checkbox rec-select-checkbox" data-id="${esc(r.id)}" ${isSelected ? "checked" : ""}>
                </td>
                <td>${esc(fmtDate(r.receipt_date || r.created_at))}</td>
                <td><strong>${esc(name)}</strong></td>
                <td><span class="mat-id-badge">${esc(code)}</span></td>
                <td><span style="color: #047857; font-weight: 700;">+${fmtQty(r.received_quantity)}</span></td>
                <td>${esc(r.unit || "kg")}</td>
                <td>${esc(r.supplier_name || "Standard Supplier")}</td>
                <td>${curStock}</td>
                <td>${minStock}</td>
                <td>${statusBadge}</td>
                <td style="text-align: right; white-space: nowrap;">
                    <div class="row-direct-actions">
                        <button type="button" class="row-action-btn delete-direct-btn delete-rec-btn" data-id="${esc(r.id)}" title="Delete Receipt Record">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    renderPaginationControls(btnsEl, state.receivePage, totalPages, (p) => {
        state.receivePage = p;
        renderReceiveTable();
    });

    attachReceiveTableListeners();
    updateReceiveSelectionBar();
}

function attachReceiveTableListeners() {
    const toggleBtn = $("toggleSelectReceiveBtn");
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            state.selectModeReceive = !state.selectModeReceive;
            if (!state.selectModeReceive) state.selectedReceiveIds.clear();
            renderReceiveTable();
        };
    }

    const hideBtn = $("hideSelectionReceiveBtn");
    if (hideBtn) {
        hideBtn.onclick = () => {
            state.selectModeReceive = false;
            state.selectedReceiveIds.clear();
            renderReceiveTable();
        };
    }

    const selectAllReceive = $("selectAllReceive");
    if (selectAllReceive) {
        selectAllReceive.onchange = (e) => {
            const filtered = getFilteredReceiveList();
            const start = (state.receivePage - 1) * state.receivePageSize;
            const end = Math.min(start + state.receivePageSize, filtered.length);
            const paged = filtered.slice(start, end);

            if (e.target.checked) {
                paged.forEach(r => state.selectedReceiveIds.add(String(r.id)));
            } else {
                paged.forEach(r => state.selectedReceiveIds.delete(String(r.id)));
            }
            renderReceiveTable();
        };
    }

    document.querySelectorAll(".rec-select-checkbox").forEach(cb => {
        cb.onchange = (e) => {
            e.stopPropagation();
            const id = String(cb.dataset.id);
            const tr = cb.closest("tr");
            if (cb.checked) {
                state.selectedReceiveIds.add(id);
                if (tr) tr.classList.add("row-selected");
            } else {
                state.selectedReceiveIds.delete(id);
                if (tr) tr.classList.remove("row-selected");
            }
            updateReceiveSelectionBar();
        };
    });

    const bulkSelectAllReceiveBtn = $("bulkSelectAllReceiveBtn");
    if (bulkSelectAllReceiveBtn) {
        bulkSelectAllReceiveBtn.onclick = () => {
            const filtered = getFilteredReceiveList();
            filtered.forEach(r => state.selectedReceiveIds.add(String(r.id)));
            renderReceiveTable();
        };
    }

    const bulkDeselectReceiveBtn = $("bulkDeselectReceiveBtn");
    if (bulkDeselectReceiveBtn) {
        bulkDeselectReceiveBtn.onclick = () => {
            state.selectedReceiveIds.clear();
            renderReceiveTable();
        };
    }

    const bulkDeleteReceiveBtn = $("bulkDeleteReceiveBtn");
    if (bulkDeleteReceiveBtn) {
        bulkDeleteReceiveBtn.onclick = async () => {
            const count = state.selectedReceiveIds.size;
            if (count === 0) return;
            const conf = confirm(`Are you sure you want to permanently delete the ${count} selected stock receipt record(s)? This will update current inventory balances.`);
            if (!conf) return;

            try {
                const idsToDelete = Array.from(state.selectedReceiveIds);
                const uuidIds = idsToDelete.filter(isUUID);
                const customIds = idsToDelete.filter(id => !isUUID(id));

                if (uuidIds.length > 0) {
                    const { error } = await supabase.from("stock_receipts").delete().in("id", uuidIds);
                    if (error) throw error;
                }

                let deleted = [];
                try { deleted = JSON.parse(localStorage.getItem("rmims_deleted_receipt_ids") || "[]"); } catch (e) {}
                idsToDelete.forEach(id => {
                    const idStr = String(id);
                    if (!deleted.includes(idStr)) deleted.push(idStr);
                });
                localStorage.setItem("rmims_deleted_receipt_ids", JSON.stringify(deleted));

                state.selectedReceiveIds.clear();
                await loadAllData();
                toast(`Successfully deleted ${count} stock receipt record(s).`, "success");
            } catch (err) {
                console.error("Error deleting stock receipts:", err);
                toast("Failed to delete stock receipts: " + (err.message || err), "error");
            }
        };
    }

    document.querySelectorAll(".delete-rec-btn").forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            if (!id) return;
            const conf = confirm("Are you sure you want to permanently delete this stock receipt record?");
            if (!conf) return;

            try {
                if (isUUID(id)) {
                    const { error } = await supabase.from("stock_receipts").delete().eq("id", id);
                    if (error) throw error;
                }

                let deleted = [];
                try { deleted = JSON.parse(localStorage.getItem("rmims_deleted_receipt_ids") || "[]"); } catch (e) {}
                if (!deleted.includes(String(id))) deleted.push(String(id));
                localStorage.setItem("rmims_deleted_receipt_ids", JSON.stringify(deleted));

                state.selectedReceiveIds.delete(String(id));
                await loadAllData();
                toast("Stock receipt record deleted successfully.", "success");
            } catch (err) {
                console.error("Error deleting stock receipt:", err);
                toast("Failed to delete stock receipt: " + (err.message || err), "error");
            }
        };
    });
}

/* ==========================================================
   TAB 3: DISBURSEMENT (LIVE CONSUMPTION TABLE + SELECTION & DELETE)
   ========================================================== */

function setupDisburseEventListeners() {
    const searchInput = $("disbursementSearchInput");
    const dateFrom = $("disburseDateFrom");
    const dateTo = $("disburseDateTo");
    const clearDatesBtn = $("clearDisburseDatesBtn");
    const sortSelect = $("disburseSortFilter");
    const clearFiltersBtn = $("disburseClearFiltersBtn");

    const syncClearBtn = () => {
        if (clearDatesBtn) {
            clearDatesBtn.style.display = (state.disburseDateFrom || state.disburseDateTo) ? "inline-flex" : "none";
        }
    };

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.disburseSearch = searchInput.value.trim().toLowerCase();
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            state.disburseSort = sortSelect.value;
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }

    if (dateFrom) {
        initDateFilter(dateFrom, (dateStr) => {
            state.disburseDateFrom = dateStr;
            syncClearBtn();
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }

    if (dateTo) {
        initDateFilter(dateTo, (dateStr) => {
            state.disburseDateTo = dateStr;
            syncClearBtn();
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }

    if (clearDatesBtn) {
        clearDatesBtn.addEventListener("click", () => {
            if (dateFrom && dateFrom._flatpickr) dateFrom._flatpickr.clear();
            if (dateTo && dateTo._flatpickr) dateTo._flatpickr.clear();
            if (dateFrom) dateFrom.value = "";
            if (dateTo) dateTo.value = "";
            state.disburseDateFrom = "";
            state.disburseDateTo = "";
            syncClearBtn();
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener("click", () => {
            state.disburseSearch = "";
            state.disburseDateFrom = "";
            state.disburseDateTo = "";
            state.disburseSort = "latest";

            if (searchInput) searchInput.value = "";
            if (dateFrom && dateFrom._flatpickr) dateFrom._flatpickr.clear();
            if (dateTo && dateTo._flatpickr) dateTo._flatpickr.clear();
            if (dateFrom) dateFrom.value = "";
            if (dateTo) dateTo.value = "";
            if (sortSelect) sortSelect.value = "latest";

            syncClearBtn();
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }
}

function updateDisburseSelectionBar() {
    const bar = $("disburseSelectionBar");
    const countEl = $("disburseSelectedCount");
    const selectAllCb = $("selectAllDisburse");
    if (!bar) return;

    const selectedCount = state.selectedDisburseIds.size;
    if (selectedCount > 0) {
        bar.hidden = false;
        if (countEl) countEl.textContent = `${selectedCount} Selected`;
    } else {
        bar.hidden = true;
    }

    const filtered = getFilteredDisburseList();
    const start = (state.disbursePage - 1) * state.disbursePageSize;
    const end = Math.min(start + state.disbursePageSize, filtered.length);
    const paged = filtered.slice(start, end);

    if (selectAllCb && paged.length > 0) {
        const allSelected = paged.every(d => state.selectedDisburseIds.has(String(d.id)));
        const someSelected = paged.some(d => state.selectedDisburseIds.has(String(d.id)));
        selectAllCb.checked = allSelected;
        selectAllCb.indeterminate = !allSelected && someSelected;
    } else if (selectAllCb) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
    }
}

function getFilteredDisburseList() {
    let list = state.disbursements.filter(d => {
        const mat = state.rawMaterialsMap.get(d.material_id);
        const matName = mat ? mat.name.toLowerCase() : "";
        const matCode = mat ? mat.itemCode.toLowerCase() : "";
        const context = `${d.activity_type || ""} ${d.finished_product_name || ""}`.toLowerCase();

        if (state.disburseSearch) {
            const combined = `${matName} ${matCode} ${context}`;
            if (!combined.includes(state.disburseSearch)) return false;
        }

        if (state.disburseDateFrom && d.usage_date) {
            if (new Date(d.usage_date) < new Date(state.disburseDateFrom)) return false;
        }
        if (state.disburseDateTo && d.usage_date) {
            const dt = new Date(state.disburseDateTo);
            dt.setHours(23, 59, 59, 999);
            if (new Date(d.usage_date) > dt) return false;
        }

        return true;
    });

    const sort = state.disburseSort || "latest";
    list.sort((a, b) => {
        const matA = state.rawMaterialsMap.get(a.material_id);
        const matB = state.rawMaterialsMap.get(b.material_id);
        const nameA = matA ? matA.name : (a.material_name || "");
        const nameB = matB ? matB.name : (b.material_name || "");

        if (sort === "az") return nameA.localeCompare(nameB);
        if (sort === "za") return nameB.localeCompare(nameA);
        if (sort === "oldest") return new Date(a.usage_date || a.created_at || 0) - new Date(b.usage_date || b.created_at || 0);
        return new Date(b.usage_date || b.created_at || 0) - new Date(a.usage_date || a.created_at || 0);
    });

    return list;
}

function renderDisbursementTable() {
    const tbody = $("disbursementTableBody");
    const countEl = $("disbursementResultCount");
    const btnsEl = $("disbursementPaginationBtns");
    if (!tbody) return;

    const filtered = getFilteredDisburseList();
    const total = filtered.length;

    // Check if clear button should be shown
    const isFiltered = !!state.disburseSearch || !!state.disburseDateFrom || !!state.disburseDateTo || state.disburseSort !== "latest";
    if ($("disburseClearFiltersBtn")) $("disburseClearFiltersBtn").hidden = !isFiltered;

    const isSelectMode = !!state.selectModeDisburse;
    const thSelect = $("disbursementTable")?.querySelector("thead th.col-select");
    if (thSelect) thSelect.classList.toggle("hidden-col", !isSelectMode);

    const toggleBtn = $("toggleSelectDisburseBtn");
    if (toggleBtn) {
        toggleBtn.classList.toggle("active", isSelectMode);
        const textSpan = toggleBtn.querySelector(".select-btn-text");
        if (textSpan) textSpan.textContent = isSelectMode ? "Hide Select" : "Select";
    }

    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align:center; padding: 36px 16px; color: var(--rm-ink-dim);">
                    <strong>No material disbursements found.</strong><br>
                    <span style="font-size: 0.8rem;">Usage logged via Material Activity will appear here.</span>
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = "Showing 0 disbursements";
        if (btnsEl) btnsEl.innerHTML = "";
        updateDisburseSelectionBar();
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / state.disbursePageSize));
    if (state.disbursePage > totalPages) state.disbursePage = totalPages;
    if (state.disbursePage < 1) state.disbursePage = 1;

    const start = (state.disbursePage - 1) * state.disbursePageSize;
    const end = Math.min(start + state.disbursePageSize, total);
    const paged = filtered.slice(start, end);

    if (countEl) countEl.textContent = `Showing ${start + 1}–${end} of ${total} disbursements`;

    tbody.innerHTML = paged.map(d => {
        const mat = state.rawMaterialsMap.get(d.material_id);
        const name = mat ? mat.name : "Unknown Material";
        const code = mat ? mat.itemCode : "—";
        const curStock = mat ? `${fmtQty(mat.currentStock)} ${mat.unit}` : "—";
        const minStock = mat && mat.minStock !== null ? `${fmtQty(mat.minStock)} ${mat.unit}` : "—";
        const statusBadge = mat ? `<span class="status-badge ${mat.status.cls}">${esc(mat.status.badgeText)}</span>` : "—";
        const usageContext = d.finished_product_name || d.activity_type || "General Usage";
        const isSelected = state.selectedDisburseIds.has(String(d.id));

        return `
            <tr data-id="${esc(d.id)}" class="${isSelected ? "row-selected" : ""}">
                <td class="col-select ${isSelectMode ? "" : "hidden-col"}" style="text-align: center;">
                    <input type="checkbox" class="inv-custom-checkbox disb-select-checkbox" data-id="${esc(d.id)}" ${isSelected ? "checked" : ""}>
                </td>
                <td>${esc(fmtDate(d.usage_date || d.created_at))}</td>
                <td><strong>${esc(name)}</strong></td>
                <td><span class="mat-id-badge">${esc(code)}</span></td>
                <td><strong style="color: var(--amber-dark, #D97706); font-weight: 700;">-${fmtQty(d.consumed_quantity)}</strong></td>
                <td>${esc(d.unit || "kg")}</td>
                <td>${esc(usageContext)}</td>
                <td>${curStock}</td>
                <td>${minStock}</td>
                <td>${statusBadge}</td>
                <td style="text-align: right; white-space: nowrap;">
                    <div class="row-direct-actions">
                        <button type="button" class="row-action-btn delete-direct-btn delete-dsb-btn" data-id="${esc(d.id)}" title="Delete Disbursement Record">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    renderPaginationControls(btnsEl, state.disbursePage, totalPages, (p) => {
        state.disbursePage = p;
        renderDisbursementTable();
    });

    attachDisburseTableListeners();
    updateDisburseSelectionBar();
}

function attachDisburseTableListeners() {
    const toggleBtn = $("toggleSelectDisburseBtn");
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            state.selectModeDisburse = !state.selectModeDisburse;
            if (!state.selectModeDisburse) state.selectedDisburseIds.clear();
            renderDisbursementTable();
        };
    }

    const hideBtn = $("hideSelectionDisburseBtn");
    if (hideBtn) {
        hideBtn.onclick = () => {
            state.selectModeDisburse = false;
            state.selectedDisburseIds.clear();
            renderDisbursementTable();
        };
    }

    const selectAllDisburse = $("selectAllDisburse");
    if (selectAllDisburse) {
        selectAllDisburse.onchange = (e) => {
            const filtered = getFilteredDisburseList();
            const start = (state.disbursePage - 1) * state.disbursePageSize;
            const end = Math.min(start + state.disbursePageSize, filtered.length);
            const paged = filtered.slice(start, end);

            if (e.target.checked) {
                paged.forEach(d => state.selectedDisburseIds.add(String(d.id)));
            } else {
                paged.forEach(d => state.selectedDisburseIds.delete(String(d.id)));
            }
            renderDisbursementTable();
        };
    }

    document.querySelectorAll(".disb-select-checkbox").forEach(cb => {
        cb.onchange = (e) => {
            e.stopPropagation();
            const id = String(cb.dataset.id);
            const tr = cb.closest("tr");
            if (cb.checked) {
                state.selectedDisburseIds.add(id);
                if (tr) tr.classList.add("row-selected");
            } else {
                state.selectedDisburseIds.delete(id);
                if (tr) tr.classList.remove("row-selected");
            }
            updateDisburseSelectionBar();
        };
    });

    const bulkSelectAllDisburseBtn = $("bulkSelectAllDisburseBtn");
    if (bulkSelectAllDisburseBtn) {
        bulkSelectAllDisburseBtn.onclick = () => {
            const filtered = getFilteredDisburseList();
            filtered.forEach(d => state.selectedDisburseIds.add(String(d.id)));
            renderDisbursementTable();
        };
    }

    const bulkDeselectDisburseBtn = $("bulkDeselectDisburseBtn");
    if (bulkDeselectDisburseBtn) {
        bulkDeselectDisburseBtn.onclick = () => {
            state.selectedDisburseIds.clear();
            renderDisbursementTable();
        };
    }

    const bulkDeleteDisburseBtn = $("bulkDeleteDisburseBtn");
    if (bulkDeleteDisburseBtn) {
        bulkDeleteDisburseBtn.onclick = async () => {
            const count = state.selectedDisburseIds.size;
            if (count === 0) return;
            const conf = confirm(`Are you sure you want to permanently delete the ${count} selected material disbursement record(s)? This will update current inventory balances.`);
            if (!conf) return;

            try {
                const idsToDelete = Array.from(state.selectedDisburseIds);
                const uuidIds = idsToDelete.filter(isUUID);

                if (uuidIds.length > 0) {
                    const { error } = await supabase.from("material_disbursements").delete().in("id", uuidIds);
                    if (error) throw error;
                }

                let deleted = [];
                try { deleted = JSON.parse(localStorage.getItem("rmims_deleted_disbursement_ids") || "[]"); } catch (e) {}
                idsToDelete.forEach(id => {
                    const idStr = String(id);
                    if (!deleted.includes(idStr)) deleted.push(idStr);
                });
                localStorage.setItem("rmims_deleted_disbursement_ids", JSON.stringify(deleted));

                state.selectedDisburseIds.clear();
                await loadAllData();
                toast(`Successfully deleted ${count} disbursement record(s).`, "success");
            } catch (err) {
                console.error("Error deleting disbursements:", err);
                toast("Failed to delete disbursements: " + (err.message || err), "error");
            }
        };
    }

    document.querySelectorAll(".delete-dsb-btn").forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            if (!id) return;
            const conf = confirm("Are you sure you want to permanently delete this material disbursement record?");
            if (!conf) return;

            try {
                if (isUUID(id)) {
                    const { error } = await supabase.from("material_disbursements").delete().eq("id", id);
                    if (error) throw error;
                }

                let deleted = [];
                try { deleted = JSON.parse(localStorage.getItem("rmims_deleted_disbursement_ids") || "[]"); } catch (e) {}
                if (!deleted.includes(String(id))) deleted.push(String(id));
                localStorage.setItem("rmims_deleted_disbursement_ids", JSON.stringify(deleted));

                state.selectedDisburseIds.delete(String(id));
                await loadAllData();
                toast("Material disbursement record deleted successfully.", "success");
            } catch (err) {
                console.error("Error deleting disbursement:", err);
                toast("Failed to delete disbursement: " + (err.message || err), "error");
            }
        };
    });
}

/* ==========================================================
   TAB 4: OTHER DETAILS (FINISHED PRODUCTS - UNIFIED CARDS & DELETE)
   ========================================================== */

function setupOtherDetailsEventListeners() {
    const searchInput = $("fpcSearchInput");
    const sortSelect = $("fpcSortSelect");
    const pageSizeSelect = $("fpcPageSizeSelect");
    const detailsClose = $("fpcDetailsModalClose");
    const detailsCloseBtn = $("fpcDetailsCloseBtn");
    const detailsDeleteBtn = $("fpcDetailsDeleteBtn");
    const detailsOverlay = $("fpcDetailsModalOverlay");

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.fpcSearch = searchInput.value.trim().toLowerCase();
            state.fpcPage = 1;
            renderFinishedProducts();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            state.fpcSort = sortSelect.value;
            state.fpcPage = 1;
            renderFinishedProducts();
        });
    }

    if (pageSizeSelect) {
        pageSizeSelect.addEventListener("change", () => {
            state.fpcPageSize = Number(pageSizeSelect.value) || 20;
            state.fpcPage = 1;
            renderFinishedProducts();
        });
    }

    if (detailsClose) detailsClose.addEventListener("click", () => detailsOverlay.classList.remove("open"));
    if (detailsCloseBtn) detailsCloseBtn.addEventListener("click", () => detailsOverlay.classList.remove("open"));
    if (detailsOverlay) {
        detailsOverlay.addEventListener("click", (e) => {
            if (e.target === detailsOverlay) detailsOverlay.classList.remove("open");
        });
    }

    if (detailsDeleteBtn) {
        detailsDeleteBtn.addEventListener("click", () => {
            if (state.currentlyViewingProduct) {
                deleteProductByName(state.currentlyViewingProduct.name);
            }
        });
    }

    // Toggle Select Mode
    const toggleBtn = $("toggleSelectFpcBtn");
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            state.selectModeFpc = !state.selectModeFpc;
            if (!state.selectModeFpc) state.selectedProductIds.clear();
            renderFinishedProducts();
        };
    }

    const hideBtn = $("hideSelectionFpcBtn");
    if (hideBtn) {
        hideBtn.onclick = () => {
            state.selectModeFpc = false;
            state.selectedProductIds.clear();
            renderFinishedProducts();
        };
    }

    const bulkSelectAllBtn = $("fpcBulkSelectAllBtn");
    if (bulkSelectAllBtn) {
        bulkSelectAllBtn.onclick = () => {
            state.finishedProducts.forEach(p => state.selectedProductIds.add(p.id));
            renderFinishedProducts();
        };
    }

    const bulkDeselectBtn = $("fpcBulkDeselectBtn");
    if (bulkDeselectBtn) {
        bulkDeselectBtn.onclick = () => {
            state.selectedProductIds.clear();
            renderFinishedProducts();
        };
    }

    const bulkDeleteBtn = $("fpcBulkDeleteBtn");
    if (bulkDeleteBtn) {
        bulkDeleteBtn.onclick = () => {
            const count = state.selectedProductIds.size;
            if (count === 0) return;
            const conf = confirm(`Are you sure you want to delete the ${count} selected finished product(s)?`);
            if (!conf) return;

            let deleted = [];
            try { deleted = JSON.parse(localStorage.getItem(FP_DELETED_KEY) || "[]"); } catch (e) {}

            state.selectedProductIds.forEach(id => {
                const p = state.finishedProducts.find(x => x.id === id);
                if (p && p.name) {
                    const norm = p.name.toLowerCase().trim();
                    if (!deleted.includes(norm)) deleted.push(norm);
                }
            });

            localStorage.setItem(FP_DELETED_KEY, JSON.stringify(deleted));
            state.selectedProductIds.clear();
            loadAllData();
            toast(`Successfully deleted ${count} finished product(s).`, "success");
        };
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const editOverlay = $("editMaterialModalOverlay");
            const detOverlay = $("detailModalOverlay");
            const fpcOverlay = $("fpcDetailsModalOverlay");

            if (editOverlay) editOverlay.classList.remove("open");
            if (detOverlay) detOverlay.classList.remove("open");
            if (fpcOverlay) fpcOverlay.classList.remove("open");
        }
    });
}

function deleteProductByName(productName) {
    if (!productName) return;
    const conf = confirm(`Are you sure you want to permanently delete finished product "${productName}"?`);
    if (!conf) return;

    let deleted = [];
    try { deleted = JSON.parse(localStorage.getItem(FP_DELETED_KEY) || "[]"); } catch (e) {}
    const norm = productName.toLowerCase().trim();
    if (!deleted.includes(norm)) deleted.push(norm);
    localStorage.setItem(FP_DELETED_KEY, JSON.stringify(deleted));

    // Also remove from saved custom context
    try {
        let saved = JSON.parse(localStorage.getItem(FP_STORAGE_KEY) || "[]");
        saved = saved.filter(p => (p.name || "").toLowerCase().trim() !== norm);
        localStorage.setItem(FP_STORAGE_KEY, JSON.stringify(saved));
    } catch (e) {}

    const overlay = $("fpcDetailsModalOverlay");
    if (overlay) overlay.classList.remove("open");

    state.selectedProductIds.clear();
    loadAllData();
    toast(`Deleted finished product "${productName}".`, "success");
}

function updateFpcSelectionBar() {
    const bar = $("fpcSelectionBar");
    const countEl = $("fpcSelectedCount");
    if (!bar) return;

    const count = state.selectedProductIds.size;
    if (count > 0) {
        bar.hidden = false;
        if (countEl) countEl.textContent = `${count} Selected`;
    } else {
        bar.hidden = true;
    }
}

function renderFinishedProducts() {
    const container = $("fpcCardsContainer");
    const resultCountEl = $("fpcResultCount");
    const paginationBtns = $("fpcPaginationBtns");
    if (!container) return;

    const toggleBtn = $("toggleSelectFpcBtn");
    if (toggleBtn) {
        toggleBtn.classList.toggle("active", state.selectModeFpc);
        const textSpan = toggleBtn.querySelector(".select-btn-text");
        if (textSpan) textSpan.textContent = state.selectModeFpc ? "Hide Select" : "Select";
    }

    let filtered = state.finishedProducts.filter(p => {
        if (!state.fpcSearch) return true;
        if (p.name.toLowerCase().includes(state.fpcSearch)) return true;

        const mats = p.materialIds.map(id => state.rawMaterialsMap.get(id)).filter(Boolean);
        return mats.some(m => m.name.toLowerCase().includes(state.fpcSearch) || m.itemCode.toLowerCase().includes(state.fpcSearch));
    });

    filtered.sort((a, b) => {
        if (state.fpcSort === "az") return a.name.localeCompare(b.name);
        if (state.fpcSort === "za") return b.name.localeCompare(a.name);
        if (state.fpcSort === "oldest") return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    if (state.finishedProducts.length === 0) {
        container.innerHTML = `
            <div class="fpc-empty-state" style="grid-column: 1 / -1; padding: 48px 24px; text-align: center;">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 44px; height: 44px; color: #94a3b8; margin-bottom: 12px;"><path d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15M9 5C9 6.10457 9.89543 7 11 7H13C14.1046 7 15 6.10457 15 5M9 12H15M9 16H13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--rm-ink); margin: 0 0 6px;">No finished products configured.</h4>
                <p style="font-size: 0.84rem; color: var(--rm-ink-dim); margin: 0;">Finished products and linked materials will automatically appear here.</p>
            </div>
        `;
        if (resultCountEl) resultCountEl.textContent = "Showing 0 finished products";
        if (paginationBtns) paginationBtns.innerHTML = "";
        updateFpcSelectionBar();
        return;
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="fpc-empty-state" style="grid-column: 1 / -1; padding: 36px 20px; text-align: center;">
                <h4 style="font-size: 0.98rem; font-weight: 700; color: var(--rm-ink); margin: 0 0 6px;">No finished products found</h4>
                <p style="font-size: 0.84rem; color: var(--rm-ink-dim); margin: 0;">No items match "${esc(state.fpcSearch)}".</p>
            </div>
        `;
        if (resultCountEl) resultCountEl.textContent = "Showing 0 of " + state.finishedProducts.length + " finished products";
        if (paginationBtns) paginationBtns.innerHTML = "";
        updateFpcSelectionBar();
        return;
    }

    const total = filtered.length;
    const maxPage = Math.max(1, Math.ceil(total / state.fpcPageSize));
    if (state.fpcPage > maxPage) state.fpcPage = maxPage;

    const start = (state.fpcPage - 1) * state.fpcPageSize;
    const paged = filtered.slice(start, start + state.fpcPageSize);

    if (resultCountEl) {
        const s = start + 1;
        const e = Math.min(total, start + state.fpcPageSize);
        resultCountEl.textContent = `Showing ${s}–${e} of ${total} finished product${total === 1 ? "" : "s"}`;
    }

    container.innerHTML = paged.map(p => {
        const isSelected = state.selectedProductIds.has(p.id);
        const matCount = p.materialIds.length;
        const linkedMaterials = p.materialIds.map(id => state.rawMaterialsMap.get(id)).filter(Boolean);

        const avatarHtml = p.imageUrl
            ? `<div class="fpc-avatar"><img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" class="fpc-avatar-img"></div>`
            : `<div class="fpc-avatar"><span>${esc(getInitials(p.name))}</span></div>`;

        // Render clean unified badges (first 3 chips + clickable "+N more" badge)
        let chipsHtml = "";
        if (linkedMaterials.length > 0) {
            const visibleChips = linkedMaterials.slice(0, 3).map(m => `
                <span class="fpc-mat-chip" title="${esc(m.name)}: ${fmtQty(m.currentStock)} ${esc(m.unit)}">${esc(m.name)}</span>
            `).join("");

            const extraCount = linkedMaterials.length - 3;
            const moreBadge = extraCount > 0 
                ? `<span class="fpc-mat-chip fpc-mat-chip-more btn-open-card-modal" data-id="${esc(p.id)}" title="Click to view all ${matCount} raw materials">+${extraCount} more</span>` 
                : "";

            chipsHtml = visibleChips + moreBadge;
        } else {
            chipsHtml = `<span class="fpc-no-mats-label">No raw materials linked</span>`;
        }

        return `
            <div class="fpc-card ${isSelected ? "card-selected" : ""}" data-id="${esc(p.id)}">
                <div class="fpc-card-select-circle ${state.selectModeFpc ? "" : "hidden-circle"}" data-id="${esc(p.id)}" title="Select product">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>

                <div>
                    <div class="fpc-card-top">
                        ${avatarHtml}
                        <div class="fpc-card-meta">
                            <h4 class="fpc-card-title" title="${esc(p.name)}">${esc(p.name)}</h4>
                            <span class="fpc-mat-count-badge">${matCount} raw material${matCount === 1 ? "" : "s"}</span>
                        </div>
                    </div>

                    <div class="fpc-card-materials">
                        ${chipsHtml}
                    </div>
                </div>

                <div class="fpc-card-footer">
                    <button type="button" class="btn-view-details btn-fpc-details" data-id="${esc(p.id)}" title="View complete raw material ledger">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 14px; height: 14px;"><path d="M15 12A3 3 0 1 1 9 12A3 3 0 0 1 15 12Z" stroke="currentColor" stroke-width="2"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5C16.478 5 20.268 7.943 21.542 12C20.268 16.057 16.478 19 12 19C7.523 19 3.732 16.057 2.458 12Z" stroke="currentColor" stroke-width="2"/></svg>
                        View Details
                    </button>
                    <div class="fpc-card-footer-actions">
                        <a href="./material-activity.html?tab=disbursement&product=${encodeURIComponent(p.name)}" class="row-action-btn" title="Open Material Activity for this product" style="text-decoration: none; color: inherit; display: inline-flex; align-items: center; justify-content: center;">
                            <svg viewBox="0 0 24 24" fill="none" width="13" height="13" stroke="currentColor" stroke-width="1.8"><path d="M12 15V4M12 4L8 8M12 4L16 8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16V18C4 19.1046 4.89543 20 6 20H18C19.1046 20 20 19.1046 20 18V16" stroke-linecap="round"/></svg>
                        </a>
                        <button type="button" class="row-action-btn delete-card-btn" data-id="${esc(p.id)}" data-name="${esc(p.name)}" title="Delete finished product">
                            <svg viewBox="0 0 24 24" fill="none" width="13" height="13" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    attachFpcCardListeners();
    updateFpcSelectionBar();

    renderPaginationControls(paginationBtns, state.fpcPage, maxPage, (newPage) => {
        state.fpcPage = newPage;
        renderFinishedProducts();
    });
}

function attachFpcCardListeners() {
    // Circle Selection & Card Toggle
    document.querySelectorAll(".fpc-card").forEach(card => {
        const id = card.getAttribute("data-id");
        const circle = card.querySelector(".fpc-card-select-circle");

        const toggleSelection = (e) => {
            if (e.target.closest(".btn-view-details") || e.target.closest(".delete-card-btn") || e.target.closest("a") || e.target.closest(".btn-open-card-modal")) return;
            if (!state.selectModeFpc && !e.target.closest(".fpc-card-select-circle")) return;
            if (state.selectedProductIds.has(id)) {
                state.selectedProductIds.delete(id);
                card.classList.remove("card-selected");
            } else {
                state.selectedProductIds.add(id);
                card.classList.add("card-selected");
            }
            updateFpcSelectionBar();
        };

        if (circle) circle.addEventListener("click", toggleSelection);
        card.addEventListener("click", toggleSelection);
    });

    // View Details Button & +N more badge
    document.querySelectorAll(".btn-fpc-details, .btn-open-card-modal").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            const prod = state.finishedProducts.find(p => p.id === id);
            if (prod) openFinishedProductModal(prod);
        });
    });

    // Card Direct Delete
    document.querySelectorAll(".delete-card-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const name = btn.getAttribute("data-name");
            if (name) deleteProductByName(name);
        });
    });
}

function openFinishedProductModal(product) {
    state.currentlyViewingProduct = product;
    const overlay = $("fpcDetailsModalOverlay");
    const nameEl = $("fpcDetailsName");
    const countEl = $("fpcDetailsMatCount");
    const avatarWrap = $("fpcDetailsAvatarWrap");
    const tbody = $("fpcDetailsTableBody");
    if (!overlay) return;

    if (nameEl) nameEl.textContent = product.name;
    if (countEl) {
        const c = product.materialIds.length;
        countEl.textContent = `${c} Associated Raw Material${c === 1 ? "" : "s"}`;
    }

    if (avatarWrap) {
        avatarWrap.innerHTML = product.imageUrl
            ? `<div class="fpc-avatar"><img src="${esc(product.imageUrl)}" alt="${esc(product.name)}" class="fpc-avatar-img"></div>`
            : `<div class="fpc-avatar"><span>${esc(getInitials(product.name))}</span></div>`;
    }

    if (tbody) {
        const rows = product.materialIds.map(id => {
            const mat = state.rawMaterialsMap.get(id);
            if (!mat) {
                return `
                    <tr>
                        <td><strong>Unknown Material</strong></td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td><span class="status-badge status-badge-outofstock">🔴 Unmapped</span></td>
                    </tr>
                `;
            }

            return `
                <tr>
                    <td><strong>${esc(mat.name)}</strong></td>
                    <td><span class="mat-id-badge">${esc(mat.itemCode || "—")}</span></td>
                    <td><strong>${fmtQty(mat.currentStock)} ${esc(mat.unit)}</strong></td>
                    <td>${mat.minStock !== null ? `${fmtQty(mat.minStock)} ${esc(mat.unit)}` : "—"}</td>
                    <td>${esc(mat.unit)}</td>
                    <td><span class="status-badge ${mat.status.cls}">${esc(mat.status.badgeText)}</span></td>
                </tr>
            `;
        }).join("");

        tbody.innerHTML = rows || `<tr><td colspan="6" style="text-align: center; color: var(--rm-ink-dim); padding: 20px;">No materials currently linked to this product.</td></tr>`;
    }

    overlay.classList.add("open");
}

/* ==========================================================
   READ-ONLY MATERIAL DETAIL VIEW MODAL
   ========================================================== */

function openMaterialDetailModal(mat) {
    const overlay = $("detailModalOverlay");
    const nameEl = $("detailMaterialName");
    const subEl = $("detailMaterialSubtitle");
    const bodyEl = $("detailModalBody");
    if (!overlay || !bodyEl) return;

    if (nameEl) nameEl.textContent = mat.name;
    if (subEl) subEl.textContent = `${mat.itemCode ? `ID: ${mat.itemCode} · ` : ""}${mat.category}`;

    const maxDisplay = mat.maxStock !== null ? `${fmtQty(mat.maxStock)} ${esc(mat.unit)}` : `${fmtQty(mat.progress.target)} ${esc(mat.unit)}`;

    bodyEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                <div style="background: #F8FAFC; border: 1px solid var(--rm-line, #E2E8F0); border-radius: 8px; padding: 12px;">
                    <span style="font-size: 0.72rem; color: var(--rm-ink-dim, #64748B); text-transform: uppercase; font-weight: 700;">Current Stock</span>
                    <div style="font-size: 1.25rem; font-weight: 800; color: var(--rm-ink, #0F172A); margin-top: 4px;">
                        ${fmtQty(mat.currentStock)} <small style="font-size: 0.78rem; font-weight: 600;">${esc(mat.unit)}</small>
                    </div>
                </div>
                <div style="background: #F8FAFC; border: 1px solid var(--rm-line, #E2E8F0); border-radius: 8px; padding: 12px;">
                    <span style="font-size: 0.72rem; color: var(--rm-ink-dim, #64748B); text-transform: uppercase; font-weight: 700;">Minimum Stock</span>
                    <div style="font-size: 1.25rem; font-weight: 800; color: var(--rm-ink, #0F172A); margin-top: 4px;">
                        ${mat.minStock !== null ? fmtQty(mat.minStock) : "0"} <small style="font-size: 0.78rem; font-weight: 600;">${esc(mat.unit)}</small>
                    </div>
                </div>
                <div style="background: #F8FAFC; border: 1px solid var(--rm-line, #E2E8F0); border-radius: 8px; padding: 12px;">
                    <span style="font-size: 0.72rem; color: var(--rm-ink-dim, #64748B); text-transform: uppercase; font-weight: 700;">Max Capacity</span>
                    <div style="font-size: 1.25rem; font-weight: 800; color: var(--rm-ink, #0F172A); margin-top: 4px;">
                        ${maxDisplay}
                    </div>
                </div>
            </div>

            <div style="background: #F8FAFC; border: 1px solid var(--rm-line, #E2E8F0); border-radius: 8px; padding: 14px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-size: 0.78rem; font-weight: 700; color: var(--rm-ink, #0F172A);">Stock Progress</span>
                    <span class="status-badge ${mat.status.cls}">${esc(mat.status.badgeText)}</span>
                </div>
                <div class="mat-progress-track" style="height: 10px;">
                    <div class="mat-progress-fill ${mat.progress.cls}" style="width: ${mat.progress.pct}%;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.74rem; color: var(--rm-ink-dim, #64748B); margin-top: 6px;">
                    <span>Health: ${mat.progress.pct}%</span>
                    <span>Target: ${maxDisplay}</span>
                </div>
            </div>

            <div style="background: #FFFFFF; border: 1px solid var(--rm-line, #E2E8F0); border-radius: 8px; overflow: hidden; font-size: 0.84rem;">
                <div style="display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #F1F5F9;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500;">Material ID / Item Code:</span>
                    <strong>${esc(mat.itemCode || "—")}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #F1F5F9;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500;">Category:</span>
                    <strong>${esc(mat.category)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #F1F5F9;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500;">Measurement Unit:</span>
                    <strong>${esc(mat.unit)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #F1F5F9;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500;">Date Added:</span>
                    <span>${esc(fmtDate(mat.createdAt))}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #F1F5F9;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500;">Last Activity / Updated:</span>
                    <span>${esc(fmtDate(mat.latestActivityDate || mat.updatedAt || mat.createdAt))}</span>
                </div>
                <div style="padding: 10px 14px;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500; display: block; margin-bottom: 4px;">Notes / Description:</span>
                    <span style="color: var(--rm-ink, #0F172A); font-style: ${mat.note ? "normal" : "italic"};">${esc(mat.note || "No specific notes provided.")}</span>
                </div>
            </div>
        </div>
    `;

    overlay.classList.add("open");
}

/* ==========================================================
   PAGINATION CONTROLS GENERATOR
   ========================================================== */

function renderPaginationControls(container, currentPage, totalPages, onPageChange) {
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    let html = `
        <button type="button" class="inv-page-btn" id="prevPageBtn" ${currentPage <= 1 ? "disabled" : ""} title="Previous Page">‹</button>
    `;

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

    pages.forEach(p => {
        if (p === "...") {
            html += `<span class="page-ellipsis">…</span>`;
        } else {
            html += `<button type="button" class="inv-page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
        }
    });

    html += `
        <button type="button" class="inv-page-btn" id="nextPageBtn" ${currentPage >= totalPages ? "disabled" : ""} title="Next Page">›</button>
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

    container.querySelectorAll(".inv-page-btn[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
            const p = Number(btn.dataset.page);
            if (p && p !== currentPage) onPageChange(p);
        });
    });
}

// Storage sync across tabs, windows, and same-window synthetic events
window.addEventListener("storage", (e) => {
    // e.key is null for synthetic events dispatched by window.dispatchEvent(new Event("storage"))
    if (!e.key || e.key.startsWith("rmims_") || e.key.includes("inventory") || e.key.includes("material")) {
        loadAllData();
    }
});

// Supabase Realtime Channel Subscription for live cross-user inventory updates
if (supabase && typeof supabase.channel === "function" && !window.__rmimsUserInvChannel) {
    window.__rmimsUserInvChannel = supabase
        .channel("rmims_user_inventory_sync")
        .on("postgres_changes", { event: "*", schema: "public", table: "raw_materials" }, () => {
            loadAllData();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "stock_receipts" }, () => {
            loadAllData();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "material_disbursements" }, () => {
            loadAllData();
        })
        .subscribe();
}
