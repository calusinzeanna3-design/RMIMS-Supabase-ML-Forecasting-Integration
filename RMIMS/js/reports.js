// js/reports.js
//
// RMIMS ADMIN — REPORTS & DECISION SUPPORT
// Rebuilt: Screen = Interactive Multiple Tabs (including AI Forecasting); Print = Continuous Document; Excel = Multi-Sheet Workbook; PDF = Continuous Document.
// Authoritative Supabase Data (raw_materials, stock_receipts, material_disbursements) & Authoritative AI Forecast Output.
// Strictly Light Mode. No Mock Data. Unit-Safe.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";
import { AUTHENTIC_59_RAW_MATERIALS, AUTHENTIC_STOCK_RECEIPTS_6MONTHS, AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS, AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from "./authentic-59-dataset.js";
import { AUTHENTIC_19_SCONES_MATERIALS } from "./authentic-scones-dataset.js";
import { getSystemRawMaterials, getSystemCustomReceipts, getSystemCustomDisbursements } from "./system-materials.js";
import { getActiveTenantContext } from "./tenant-manager.js";
import { attachSearchableCombobox } from "./rmims-combobox.js";

/* ==========================================================
   AI FORECAST SUPPORT INTEGRATION HELPER
   ========================================================== */

export function getMaterialAiRequirement(material, tenantCtx) {
    if (!material) return { forecast7Day: 0, reorderQty: 0, unit: "g" };
    const mName = String(material.name || material.raw_material_name || "").toLowerCase().trim();
    const mCode = String(material.itemCode || material.item_code || material.id || "").toUpperCase().trim();
    const curStock = Number(material.currentStock ?? material.current_stock ?? 0);
    const minThreshold = Number(material.minThreshold ?? material.minimum_threshold ?? material.minimum_stock ?? 0);
    const unit = (material.unit || material.unit_of_measure || (mCode.startsWith("NB-") ? "g" : "kg")).trim();

    let cachedFc = null;
    try {
        const rawCache = localStorage.getItem("rmims_forecast_cache");
        if (rawCache) {
            const cacheObj = JSON.parse(rawCache);
            cachedFc = cacheObj[material.name] || cacheObj[mName] || Object.values(cacheObj).find(c => 
                String(c.material_id || "").toUpperCase().trim() === mCode ||
                String(c.raw_material_name || "").toLowerCase().trim() === mName
            );
        }
    } catch (_) {}

    const isScones = tenantCtx ? Boolean(tenantCtx.isScones) : mCode.startsWith("NB-");
    const catalog = isScones ? AUTHENTIC_19_SCONES_MATERIALS : AUTHENTIC_59_RAW_MATERIALS;
    const baseMat = catalog.find(b => 
        String(b.item_code || b.id).toUpperCase().trim() === mCode ||
        String(b.name || b.raw_material_name || "").toLowerCase().trim() === mName
    );

    let f7Day = 0;
    if (cachedFc && cachedFc.forecast7Day && Number(cachedFc.forecast7Day.quantity) > 0) {
        f7Day = Number(cachedFc.forecast7Day.quantity);
    } else if (baseMat && Number(baseMat.forecast_weekly) > 0) {
        f7Day = Number(baseMat.forecast_weekly);
    } else if (material.forecast_weekly && Number(material.forecast_weekly) > 0) {
        f7Day = Number(material.forecast_weekly);
    } else if (baseMat && Number(baseMat.forecast_daily) > 0) {
        f7Day = Number((baseMat.forecast_daily * 7).toFixed(1));
    }

    let reorderNeeded = 0;
    if (curStock <= 0) {
        reorderNeeded = f7Day > 0 ? f7Day : (minThreshold > 0 ? minThreshold : 50);
    } else if (curStock < (f7Day + minThreshold)) {
        reorderNeeded = (f7Day + minThreshold) - curStock;
    }

    const isCountUnit = unit.toLowerCase() === "pcs" || unit.toLowerCase() === "pieces";
    const roundedReorder = isCountUnit ? Math.ceil(reorderNeeded) : Number(reorderNeeded.toFixed(1));
    const roundedFc = isCountUnit ? Math.ceil(f7Day) : Number(f7Day.toFixed(1));

    return {
        forecast7Day: roundedFc,
        reorderQty: roundedReorder,
        unit: unit
    };
}

/* ==========================================================
   ROLE & AUTH GUARD
   ========================================================== */

onAuthStateChanged(auth, async (user) => {
    if (window.location.pathname.toLowerCase().includes("/user/")) return;
    if (!user) {
        try {
            const rawLocal = localStorage.getItem("managerUser") || localStorage.getItem("rmimsCurrentUser") || localStorage.getItem("currentUser") || localStorage.getItem("userProfile") || localStorage.getItem("adminUser");
            if (rawLocal) {
                const parsed = JSON.parse(rawLocal);
                if (parsed) {
                    user = {
                        uid: parsed.id || parsed.uid || "local-manager-user",
                        id: parsed.id || parsed.uid || "local-manager-user",
                        email: parsed.email || "",
                        displayName: parsed.fullName || parsed.name || "Manager",
                        user_metadata: { full_name: parsed.fullName || parsed.name || "Manager" }
                    };
                }
            }
        } catch (e) {}
    }
    if (!user) { window.location.href = "../login.html"; return; }

    try {
        const uid = user.id || user.uid;
        const cleanEmail = (user.email || "").toLowerCase();
        const isMasterAdmin = cleanEmail === "calusinzeanna3@gmail.com";

        let profile = null;
        try {
            const { data } = await supabase
                .from("user_profiles")
                .select("id, full_name, email, role, operational_role, status")
                .eq("id", uid)
                .maybeSingle();
            if (data) profile = data;
        } catch (_) {}

        if (!profile) {
            try {
                const { data } = await supabase
                    .from("user_profiles")
                    .select("id, full_name, email, role, status")
                    .eq("id", uid)
                    .maybeSingle();
                if (data) profile = data;
            } catch (_) {}
        }

        let cached = null;
        try {
            const raw = localStorage.getItem("managerUser") || localStorage.getItem("rmimsCurrentUser") || localStorage.getItem("currentUser") || localStorage.getItem("userProfile");
            if (raw) cached = JSON.parse(raw);
        } catch (e) {}

        if (!profile && cached) {
            profile = {
                id: uid,
                full_name: cached.fullName || cached.name || "Manager",
                email: user.email || cached.email,
                role: cached.role || "manager",
                operational_role: cached.operationalRole || cached.operational_role || cached.role || "manager",
                status: cached.status || "active"
            };
        } else if (profile && cached) {
            if (!profile.operational_role) {
                profile.operational_role = cached.operationalRole || cached.operational_role || user.user_metadata?.operational_role || profile.role;
            }
            if (String(cached.status || "").toLowerCase() === "active" && String(profile.status || "").toLowerCase() === "pending") {
                profile.status = "active";
            }
        }

        if (isMasterAdmin) {
            if (!profile) {
                profile = {
                    id: uid,
                    full_name: user.displayName || user.user_metadata?.full_name || "Zeanna Calusin",
                    email: user.email,
                    role: "admin",
                    operational_role: "admin",
                    status: "active"
                };
            } else {
                profile.role = "admin";
                profile.operational_role = "admin";
                profile.status = "active";
            }
        }

        const pStatus = String(profile?.status || "").toLowerCase();
        const isRevoked = pStatus === "deleted" || pStatus === "rejected" || pStatus === "locked" || pStatus === "inactive" || pStatus === "suspended";
        if (!profile || (isRevoked && !isMasterAdmin)) {
            window.location.href = "../login.html";
            return;
        }

        const rawOp = String(profile.operational_role || profile.operationalRole || cached?.operationalRole || cached?.operational_role || '').toLowerCase();
        const rawRole = String(profile.role || cached?.role || '').toLowerCase();
        const isAdm = rawOp === 'admin' || rawRole === 'admin' || (isMasterAdmin && rawOp !== 'manager' && rawOp !== 'staff');
        const isMgr = !isAdm && (rawOp === 'manager' || rawRole === 'manager');

        // Strict role enforcement
        if (isAdm) {
            window.location.href = "../admin/overview.html";
            return;
        }
        if (!isMgr) {
            window.location.href = "../user/dashboard.html";
            return;
        }

        const pBtn = document.getElementById("profileBtn") || document.getElementById("rmsmeProfileBtn");
        let mName = (profile?.full_name || '').trim();
        const userEmail = (user?.email || profile?.email || '').trim().toLowerCase();
        if (!mName || ['manager', 'user account', 'user', 'undefined', 'null', '—', '-'].includes(mName.toLowerCase())) {
            if (userEmail === 'zeannapatricia@gmail.com') mName = 'Glazel';
            else if (userEmail === 'calusinzeanna3@gmail.com') mName = 'Zeanna';
            else mName = 'Aizel';
        }
        if (pBtn) {
            const nameEl = pBtn.querySelector("[data-shell-name]") || pBtn.querySelector(".profile-name") || pBtn.querySelector(".mgr-name");
            if (nameEl) nameEl.textContent = mName;
            const roleEl = pBtn.querySelector("[data-shell-role]") || pBtn.querySelector(".profile-role") || pBtn.querySelector(".mgr-role");
            if (roleEl) roleEl.textContent = "Manager";
            const pAv = pBtn.querySelector("[data-shell-avatar]") || pBtn.querySelector(".avatar") || pBtn.querySelector(".profile-avatar");
            const avUrl = localStorage.getItem("rmims_user_avatar") || localStorage.getItem("rmims_manager_avatar") || (user?.uid ? localStorage.getItem(`rmims_avatar_${user.uid}`) : "") || profile?.avatar_url || "";
            if (pAv) {
                if (avUrl) {
                    pAv.innerHTML = `<img src="${avUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"/>`;
                    pAv.style.padding = '0';
                    pAv.style.overflow = 'hidden';
                } else {
                    pAv.textContent = initials(mName) || "A";
                }
            }
        }
        const dropUserName = document.getElementById("dropdownUserName");
        if (dropUserName) dropUserName.textContent = mName;
        const dropUserRole = document.getElementById("dropdownUserRole");
        if (dropUserRole) dropUserRole.textContent = "Manager";

        init();
    } catch (e) {
        console.error("Auth guard error:", e);
        window.location.href = "../login.html";
    }
});

function initials(name) {
    if (!name) return "A";
    const cleaned = String(name).replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (!cleaned) return "A";
    return cleaned.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "A";
}

/* ==========================================================
   STATE
   ========================================================== */

const state = {
    materials: [],
    receipts: [],
    disbursements: [],
    forecastMap: new Map(),
    forecastList: [],
    lastForecastTimestamp: null,
    forecastStatusText: "Forecast Ready",
    
    // Period & Filter State
    periodPreset: "all", // 'all' | 'today' | 'weekly' | 'monthly' | 'custom'
    latestDataDate: null,
    startDate: null,
    endDate: null,
    generatedAt: null,
    
    // Active Screen Tab (null initially to match Image 1 empty state; reveals upon category selection)
    activeTab: null,
    selectedMaterialId: "all",
    selectedMaterialName: "All Catalog Raw Materials",
    
    // Tab Specific Filter States
    invSearch: "",
    invStatus: "all",
    invSort: "latest",
    invPage: 1,
    invPageSize: 10,

    rcvSearch: "",
    rcvSort: "latest",
    rcvPage: 1,
    rcvPageSize: 10,

    disbSearch: "",
    disbSort: "latest",
    disbPage: 1,
    disbPageSize: 10,

    actSearch: "",
    actType: "all",
    actSort: "latest",
    actPage: 1,
    actPageSize: 10,

    cnsSearch: "",
    cnsSort: "latest",
    cnsPage: 1,
    cnsPageSize: 10,

    // AI Forecasting Tab Filter & Pagination State
    fcSearch: "",
    fcStatus: "all",
    fcUnit: "all",
    fcHorizon: "7day", // '7day' | '1month'
    fcPage: 1,
    fcPageSize: 10
};

/* ==========================================================
   INITIALIZATION
   ========================================================== */

let fpStart = null;
let fpEnd = null;
let listenersInitialized = false;
let isPrinting = false;

async function init() {
    initPeriodDates();
    initReportsFlatpickr();
    initEventListeners();
    await loadAuthoritativeData();
}

// Ensure event listeners are attached immediately on DOM ready without waiting for remote auth
if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            initPeriodDates();
            initReportsFlatpickr();
            initEventListeners();
        });
    } else {
        initPeriodDates();
        initReportsFlatpickr();
        initEventListeners();
    }
}

/* ==========================================================
   PERIOD & DATE HELPERS & FLATPICKR INITIALIZATION
   ========================================================== */

function initPeriodDates() {
    setPeriodPresetDates("all");
}
function setPeriodPresetDates(preset) {
    const anchor = state.latestDataDate || new Date();
    const anchorStr = formatDateISO(anchor);

    if (preset === "today") {
        state.startDate = parseDateOnly(anchorStr);
        state.endDate = parseDateOnly(anchorStr);
    } else if (preset === "weekly") {
        state.endDate = parseDateOnly(anchorStr);
        state.startDate = addDays(state.endDate, -6);
    } else if (preset === "monthly") {
        state.endDate = parseDateOnly(anchorStr);
        state.startDate = addDays(state.endDate, -29);
    } else if (preset === "all") {
        state.startDate = null;
        state.endDate = null;
    }
    state.periodPreset = preset;

    const startInput = document.getElementById("rptStartDate");
    const endInput = document.getElementById("rptEndDate");
    const presetSelect = document.getElementById("reportPeriodPreset");

    if (presetSelect) presetSelect.value = preset;

    if (startInput) startInput.value = state.startDate ? formatDateISO(state.startDate) : "";
    if (endInput) endInput.value = state.endDate ? formatDateISO(state.endDate) : "";

    if (fpStart) {
        if (state.startDate) fpStart.setDate(formatDateISO(state.startDate), false);
        else fpStart.clear();
    }
    if (fpEnd) {
        if (state.endDate) fpEnd.setDate(formatDateISO(state.endDate), false);
        else fpEnd.clear();
    }

    syncDateInputsInteractiveState();
    updateClearBtnVisibility();
}

function syncDateInputsInteractiveState() {
    const isCustom = state.periodPreset === "custom";
    const wrap = document.getElementById("rptDateRangeGroup");

    if (wrap) {
        if (isCustom) {
            wrap.classList.add("is-custom-active");
            wrap.classList.remove("is-preset-locked");
            wrap.title = "Custom Date Range: Click date fields to modify range";
        } else {
            wrap.classList.remove("is-custom-active");
            wrap.classList.remove("is-preset-locked");
            wrap.title = "Click to pick a custom date range or select a period preset";
        }
    }

    if (fpStart && fpStart.altInput) {
        fpStart.altInput.style.pointerEvents = "auto";
        fpStart.altInput.style.cursor = "pointer";
        fpStart.altInput.classList.remove("input-locked");
    }

    if (fpEnd && fpEnd.altInput) {
        fpEnd.altInput.style.pointerEvents = "auto";
        fpEnd.altInput.style.cursor = "pointer";
        fpEnd.altInput.classList.remove("input-locked");
    }
}

function updateClearBtnVisibility() {
    const clearBtn = document.getElementById("clearReportDatesBtn");
    if (clearBtn) {
        if (state.startDate || state.endDate) {
            clearBtn.style.display = "inline-flex";
        } else {
            clearBtn.style.display = "none";
        }
    }
}

function initReportsFlatpickr() {
    const startInput = document.getElementById("rptStartDate");
    const endInput = document.getElementById("rptEndDate");
    const clearBtn = document.getElementById("clearReportDatesBtn");
    const presetSelect = document.getElementById("reportPeriodPreset");

    if (typeof flatpickr === "undefined") return;

    if (startInput && !startInput._flatpickr) {
        fpStart = flatpickr(startInput, {
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "d/m/Y",
            altInputClass: "inv-input-date",
            disableMobile: true,
            allowInput: true,
            defaultDate: state.startDate ? formatDateISO(state.startDate) : null,
            onChange: (selectedDates, dateStr) => {
                if (!dateStr) return;
                state.startDate = parseDateOnly(dateStr);
                if (presetSelect) presetSelect.value = "custom";
                state.periodPreset = "custom";
                syncDateInputsInteractiveState();
                updateClearBtnVisibility();
                updateMetadataLabels();
                renderAllTabs();
                updatePrintDocHtml();
            }
        });
        if (fpStart && fpStart.altInput) {
            fpStart.altInput.setAttribute("placeholder", "dd/mm/yyyy");
        }
    }

    if (endInput && !endInput._flatpickr) {
        fpEnd = flatpickr(endInput, {
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "d/m/Y",
            altInputClass: "inv-input-date",
            disableMobile: true,
            allowInput: true,
            defaultDate: state.endDate ? formatDateISO(state.endDate) : null,
            onChange: (selectedDates, dateStr) => {
                if (!dateStr) return;
                state.endDate = parseDateOnly(dateStr);
                if (presetSelect) presetSelect.value = "custom";
                state.periodPreset = "custom";
                syncDateInputsInteractiveState();
                updateClearBtnVisibility();
                updateMetadataLabels();
                renderAllTabs();
                updatePrintDocHtml();
            }
        });
        if (fpEnd && fpEnd.altInput) {
            fpEnd.altInput.setAttribute("placeholder", "dd/mm/yyyy");
        }
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            if (fpStart) fpStart.clear();
            if (fpEnd) fpEnd.clear();
            state.startDate = null;
            state.endDate = null;
            state.periodPreset = "all";
            if (presetSelect) presetSelect.value = "all";
            syncDateInputsInteractiveState();
            updateClearBtnVisibility();
            updateMetadataLabels();
            renderAllTabs();
            updatePrintDocHtml();
            showToast("Report date filter cleared.", "info");
        });
    }

    syncDateInputsInteractiveState();
    updateClearBtnVisibility();
}

function formatDateISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function parseDateOnly(value) {
    if (!value) return null;
    const s = String(value).slice(0, 10);
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

function addDays(d, n) {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
}

function startOfWeek(d) {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    const day = c.getDay(); // 0 = Sun
    const diff = day === 0 ? -6 : 1 - day;
    c.setDate(c.getDate() + diff);
    return c;
}

function withinRange(dateStr, start, end) {
    const d = parseDateOnly(dateStr);
    if (!d) return false;
    return d >= start && d <= end;
}

const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDisplayPeriod(start, end, preset) {
    if (!start || !end) return "All Available Records";
    if (preset === "all") return "All Recorded Data";
    if (preset === "today") {
        return `${MONTHS_ABBR[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} (Latest Update)`;
    }
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = sameYear && start.getMonth() === end.getMonth();

    if (sameMonth) {
        return `${MONTHS_ABBR[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
    }
    if (sameYear) {
        return `${MONTHS_ABBR[start.getMonth()]} ${start.getDate()} – ${MONTHS_ABBR[end.getMonth()]} ${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${MONTHS_ABBR[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} – ${MONTHS_ABBR[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

function formatPeriodTypeLabel(preset) {
    if (preset === "weekly") return "Weekly (Last 7 Days)";
    if (preset === "monthly") return "Monthly (Last 30 Days)";
    if (preset === "today") return "Daily (Latest Update)";
    return "Custom Period";
}

/* ==========================================================
   DATA LOAD (AUTHORITATIVE SUPABASE + AUTHORITATIVE FORECASTS)
   ========================================================== */

async function loadAuthoritativeData() {
    try {
        let rawMats = [];
        let rawReceipts = [];
        let rawDisbursements = [];

        // 1. Live Query to Supabase
        if (supabase) {
            try {
                const fetchWithTimeout = (promise, ms = 4000) => 
                    Promise.race([
                        promise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
                    ]);

                const [matRes, rcvRes, disbRes] = await Promise.allSettled([
                    fetchWithTimeout(supabase
                        .from("raw_materials")
                        .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days")
                        .order("name")),
                    fetchWithTimeout(supabase
                        .from("stock_receipts")
                        .select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at")
                        .order("receipt_date", { ascending: false })),
                    fetchWithTimeout(supabase
                        .from("material_disbursements")
                        .select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at")
                        .order("usage_date", { ascending: false }))
                ]);

                if (matRes.status === "fulfilled" && Array.isArray(matRes.value?.data)) rawMats = matRes.value.data;
                if (rcvRes.status === "fulfilled" && Array.isArray(rcvRes.value?.data)) rawReceipts = rcvRes.value.data;
                if (disbRes.status === "fulfilled" && Array.isArray(disbRes.value?.data)) rawDisbursements = disbRes.value.data;
            } catch (e) {
                console.warn("[Reports] Live Supabase query notice:", e);
            }
        }

        // 2. Material mapping (STRICTLY live & air-gapped per active company tenant)
        let tCtx = null;
        try { tCtx = getActiveTenantContext(); } catch (_) {}
        const isScones = tCtx ? Boolean(tCtx.isScones) : true;
        const expectedPrefix = isScones ? "NB-" : "RM-";

        const matBaseMap = new Map();

        // Helper to resolve canonical code for active tenant
        const getCanonicalCode = (rawName, rawCode) => {
            const cleanCode = String(rawCode || "").toUpperCase().trim();
            const cleanName = String(rawName || "").trim();
            const rec = resolveForecastingMaterialByName(cleanName, isScones);
            if (rec && rec.code && rec.code.startsWith(expectedPrefix)) return rec.code;
            if (cleanCode.startsWith(expectedPrefix)) {
                if (isScones && !cleanCode.match(/^NB-0(0[1-9]|1[0-9])$/)) {
                    const rec2 = resolveForecastingMaterialByName(cleanName, true);
                    return rec2 ? rec2.code : null;
                }
                return cleanCode;
            }
            return null;
        };

        // Seed with authentic system raw materials for the current tenant (guarantees strictly 19 for Scones, 59 for KXC)
        getSystemRawMaterials().forEach(m => {
            const code = getCanonicalCode(m.name || m.raw_material_name, m.item_code || m.id);
            if (!code) return;
            matBaseMap.set(code, {
                id: code,
                item_code: code,
                itemCode: code,
                name: m.name || m.raw_material_name,
                raw_material_name: m.raw_material_name || m.name,
                unit_of_measure: m.unit_of_measure || m.unit || (isScones ? "g" : "kg"),
                current_stock: Number(m.current_stock ?? m.currentStock ?? 0),
                minimum_threshold: Number(m.minimum_threshold ?? m.minimum_stock ?? 10),
                reorder_quantity: Number(m.reorder_quantity ?? 50),
                lead_time_days: Number(m.lead_time_days ?? 3)
            });
        });

        // Check local custom raw materials (persisted by Inventory module) matching active tenant
        let localCustomMats = [];
        try {
            const stored = localStorage.getItem("rmims_custom_raw_materials");
            if (stored) localCustomMats = JSON.parse(stored);
        } catch (_) {}

        if (Array.isArray(localCustomMats)) {
            localCustomMats.forEach(m => {
                const code = getCanonicalCode(m.name || m.raw_material_name, m.item_code || m.itemCode || m.id);
                if (!code) return;
                const existing = matBaseMap.get(code);
                const curStock = Number(m.current_stock ?? m.currentStock ?? m.stock ?? 0);
                if (existing) {
                    if (curStock > 0 || m.is_zero_explicit === true || m.is_manual_override === true) {
                        existing.current_stock = curStock;
                    }
                    if (m.unit || m.unit_of_measure) existing.unit_of_measure = m.unit || m.unit_of_measure;
                    if (m.minimum_threshold || m.minimum_stock) existing.minimum_threshold = Number(m.minimum_threshold ?? m.minimum_stock);
                } else if (!isScones) {
                    matBaseMap.set(code, {
                        id: code,
                        item_code: code,
                        name: m.name || m.raw_material_name,
                        unit_of_measure: m.unit_of_measure || m.unit || "kg",
                        current_stock: curStock,
                        minimum_threshold: Number(m.minimum_threshold ?? m.minimum_stock ?? 10),
                        reorder_quantity: Number(m.reorder_quantity ?? 50),
                        lead_time_days: Number(m.lead_time_days ?? 3)
                    });
                }
            });
        }

        // Merge Supabase raw materials matching active tenant
        (rawMats || []).forEach(m => {
            const code = getCanonicalCode(m.name, m.item_code || m.id);
            if (!code) return;
            const existing = matBaseMap.get(code);
            const curStock = Number(m.current_stock ?? 0);
            if (existing) {
                if (curStock > 0) existing.current_stock = curStock;
                if (m.minimum_threshold !== undefined && m.minimum_threshold !== null && Number(m.minimum_threshold) > 0) {
                    existing.minimum_threshold = Number(m.minimum_threshold);
                }
            } else if (!isScones) {
                matBaseMap.set(code, {
                    id: code,
                    item_code: code,
                    name: m.name,
                    unit_of_measure: m.unit_of_measure || "kg",
                    current_stock: curStock,
                    minimum_threshold: Number(m.minimum_threshold ?? 10),
                    reorder_quantity: Number(m.reorder_quantity ?? 50),
                    lead_time_days: Number(m.lead_time_days ?? 3)
                });
            }
        });

        // Enforce strict sequential sort and strict 19-material limit for Scones & Muffins
        rawMats = Array.from(matBaseMap.values());
        if (isScones) {
            rawMats = rawMats.filter(m => {
                const c = String(m.item_code || m.id).toUpperCase().trim();
                return /^NB-0(0[1-9]|1[0-9])$/.test(c);
            });
            rawMats.sort((a, b) => {
                const numA = parseInt(String(a.item_code || a.id).replace(/\D+/g, "") || "0", 10);
                const numB = parseInt(String(b.item_code || b.id).replace(/\D+/g, "") || "0", 10);
                return numA - numB;
            });
        }

        // 3. Receipts mapping (STRICTLY live: Supabase + local manager receipts, ZERO 6-month mock fallbacks)
        const recBaseMap = new Map();
        let localMgrReceipts = [];
        try {
            const r1 = JSON.parse(localStorage.getItem("rmims_manager_receipts") || "[]");
            const r2 = JSON.parse(localStorage.getItem("rmims_custom_receipts") || "[]");
            localMgrReceipts = [...r1, ...r2];
        } catch (_) {}

        localMgrReceipts.forEach(r => {
            const rId = String(r.id || r.ref || "");
            if (rId) recBaseMap.set(rId, {
                id: rId,
                material_id: r.materialId || r.material_id,
                received_quantity: Number(r.quantity || r.received_quantity || 0),
                receipt_date: r.date || r.receipt_date,
                unit: r.unit,
                supplier_name: r.supplier || r.supplier_name,
                received_by: r.recordedBy || r.received_by || "Store Manager",
                created_at: r.createdAt || r.created_at
            });
        });

        (rawReceipts || []).forEach(r => {
            const rId = String(r.id || "");
            if (rId) recBaseMap.set(rId, { ...(recBaseMap.get(rId) || {}), ...r });
        });
        rawReceipts = Array.from(recBaseMap.values());

        // 4. Disbursements mapping (STRICTLY live: Supabase + local manager disbursements, ZERO 6-month mock fallbacks)
        const disbBaseMap = new Map();
        let localMgrDisb = [];
        try {
            const d1 = JSON.parse(localStorage.getItem("rmims_manager_disbursements") || "[]");
            const d2 = JSON.parse(localStorage.getItem("rmims_custom_disbursements") || "[]");
            localMgrDisb = [...d1, ...d2];
        } catch (_) {}

        localMgrDisb.forEach(d => {
            const dId = String(d.id || d.ref || "");
            if (dId) disbBaseMap.set(dId, {
                id: dId,
                material_id: d.materialId || d.material_id,
                consumed_quantity: Number(d.quantity || d.consumed_quantity || 0),
                usage_date: d.date || d.usage_date,
                unit: d.unit,
                finished_product_name: d.recipient || d.finished_product_name,
                activity_type: d.activity_type || "Production Issue",
                recorded_by: d.recordedBy || d.recorded_by || "Store Manager",
                created_at: d.createdAt || d.created_at
            });
        });

        (rawDisbursements || []).forEach(d => {
            const dId = String(d.id || "");
            if (dId) disbBaseMap.set(dId, { ...(disbBaseMap.get(dId) || {}), ...d });
        });
        rawDisbursements = Array.from(disbBaseMap.values());

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
            rawMats = rawMats.filter(m => !deletedMatIds.has(String(m.id).toLowerCase().trim()) && !deletedMatIds.has((m.name || "").toLowerCase().trim()));
        }
        if (deletedRecIds.size > 0) {
            rawReceipts = rawReceipts.filter(r => !deletedRecIds.has(String(r.id)));
        }
        if (deletedDisbIds.size > 0) {
            rawDisbursements = rawDisbursements.filter(d => !deletedDisbIds.has(String(d.id)));
        }

        // Normalize Materials with Dynamic AI Forecast Requirement Integration
        state.materials = rawMats.map(m => {
            const stock = Number(m.current_stock || 0);
            const minThreshold = m.minimum_threshold !== null ? Number(m.minimum_threshold) : 0;
            let status = "Good";
            if (stock <= 0 || (minThreshold > 0 && stock <= (minThreshold / 2))) {
                status = "Critical";
            } else if (minThreshold > 0 && stock <= minThreshold) {
                status = "Low";
            }

            const aiReq = getMaterialAiRequirement(m, tCtx);
            const reorderQuantity = (aiReq.reorderQty && aiReq.reorderQty > 0) ? aiReq.reorderQty : Number(m.reorder_quantity || 0);

            return {
                id: m.id,
                itemCode: m.item_code || "RM—",
                name: m.name,
                unit: (m.unit_of_measure || m.unit || "").trim(),
                currentStock: stock,
                minThreshold: minThreshold,
                reorderQty: reorderQuantity,
                aiForecast7Day: aiReq.forecast7Day,
                status
            };
        });

        const matMap = new Map(state.materials.map(m => [m.id, m]));

        // Normalize Receipts
        state.receipts = rawReceipts.map(r => {
            const matKey = String(r.material_id || "").toLowerCase().trim();
            const mat = matMap.get(r.material_id) || state.materials.find(m => String(m.id).toLowerCase() === matKey || (m.name && m.name.toLowerCase() === matKey));
            const supName = (r.supplier_name && r.supplier_name.toLowerCase() !== "all" ? r.supplier_name : "Supplier").trim();
            const refNo = r.reference_no || r.ref || r.id || "—";
            const matCode = mat ? (mat.itemCode || mat.item_code || mat.id || "—") : (r.item_code || r.material_id || "—");
            let rTime = r.time || r.receipt_time || "";
            if (!rTime && r.created_at && r.created_at.includes("T")) {
                const parts = r.created_at.split("T")[1];
                rTime = parts ? parts.substring(0, 5) : "";
            }
            return {
                id: r.id,
                referenceNo: refNo,
                ref: refNo,
                receiptTime: rTime,
                materialCode: matCode,
                materialId: r.material_id,
                materialName: mat ? mat.name : "Raw Material",
                receivedQuantity: Number(r.received_quantity || 0),
                receiptDate: r.receipt_date || (r.created_at ? r.created_at.split("T")[0] : "—"),
                unit: (r.unit || (mat ? (mat.unit || mat.unit_of_measure) : "") || "").trim(),
                supplierName: supName,
                receivedBy: formatOperatorDisplay(r.received_by, "Admin"),
                createdAt: r.created_at
            };
        });

        // Normalize Disbursements
        state.disbursements = rawDisbursements.map(d => {
            const matKey = String(d.material_id || "").toLowerCase().trim();
            const mat = matMap.get(d.material_id) || state.materials.find(m => String(m.id).toLowerCase() === matKey || (m.name && m.name.toLowerCase() === matKey));
            const pName = (d.finished_product_name && d.finished_product_name.toLowerCase() !== "all" ? d.finished_product_name : (d.activity_type && d.activity_type.toLowerCase() !== "all" ? d.activity_type : "General Production")).trim();
            const actType = (d.activity_type && d.activity_type.toLowerCase() !== "all" ? d.activity_type : "Production Issue").trim();
            const refNo = d.reference_no || d.ref || d.id || "—";
            const matCode = mat ? (mat.itemCode || mat.item_code || mat.id || "—") : (d.item_code || d.material_id || "—");
            let dTime = d.time || d.usage_time || "";
            if (!dTime && d.created_at && d.created_at.includes("T")) {
                const parts = d.created_at.split("T")[1];
                dTime = parts ? parts.substring(0, 5) : "";
            }
            return {
                id: d.id,
                referenceNo: refNo,
                ref: refNo,
                usageTime: dTime,
                materialCode: matCode,
                materialId: d.material_id,
                materialName: mat ? mat.name : "Raw Material",
                disbursedQuantity: Number(d.consumed_quantity || 0),
                usageDate: d.usage_date || (d.created_at ? d.created_at.split("T")[0] : "—"),
                unit: (d.unit || (mat ? (mat.unit || mat.unit_of_measure) : "") || "").trim(),
                finishedProduct: pName,
                activityType: actType,
                recordedBy: formatOperatorDisplay(d.recorded_by, "Admin"),
                createdAt: d.created_at
            };
        });

        // Find latest recorded transaction date across receipts and disbursements
        let maxDateStr = null;
        state.receipts.forEach(r => {
            if (r.receiptDate && r.receiptDate !== "—" && (!maxDateStr || r.receiptDate > maxDateStr)) {
                maxDateStr = r.receiptDate;
            }
        });
        state.disbursements.forEach(d => {
            if (d.usageDate && d.usageDate !== "—" && (!maxDateStr || d.usageDate > maxDateStr)) {
                maxDateStr = d.usageDate;
            }
        });

        state.latestDataDate = parseDateOnly(maxDateStr) || new Date();
        setPeriodPresetDates(state.periodPreset);

        // Load Authoritative Forecast Cache / Output (staged as blank placeholders)
        loadAuthoritativeForecasts();

        state.generatedAt = new Date();
        populateMaterialDropdown();
        updateMetadataLabels();
        renderAllTabs();
        updatePrintDocHtml();

    } catch (err) {
        console.error("Error loading reports data:", err);
        showToast("Error loading authoritative records.", "error");
    }
}

function loadAuthoritativeForecasts() {
    state.forecastMap.clear();

    // Check for user-generated forecast results from AI-Based Forecasting module
    let cachedForecasts = null;
    try {
        const cachedData = localStorage.getItem("rmims_forecast_cache");
        const cachedTime = localStorage.getItem("rmims_forecast_timestamp");
        if (cachedData) {
            cachedForecasts = JSON.parse(cachedData);
            if (cachedTime) state.lastForecastTimestamp = new Date(cachedTime);
        }
    } catch (e) {
        console.warn("Forecast cache notice:", e);
    }

    if (cachedForecasts && typeof cachedForecasts === "object" && Object.keys(cachedForecasts).length > 0) {
        // Enforce strict ML forecasting isolation: 19 materials for Scones, 59 for KXC
        let isScones = true;
        try {
            const tCtx = window.getActiveTenantContext ? window.getActiveTenantContext() : null;
            if (tCtx && tCtx.isKxc) isScones = false;
            else if (tCtx && tCtx.isScones) isScones = true;
            else {
                const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
                const email = (curUser.email || '').toLowerCase();
                if (email === 'zeannapatricia@gmail.com') isScones = false;
            }
        } catch (_) {}

        const maxCanonicalCount = isScones ? 19 : 59;
        const canonicalMaterials = state.materials.filter(m => {
            const num = parseInt(String(m.itemCode || m.id || '').replace(/\D/g, ''), 10);
            return !isNaN(num) && num >= 1 && num <= maxCanonicalCount;
        });

        canonicalMaterials.forEach(m => {
            let cf = cachedForecasts[m.name] || cachedForecasts[m.name.trim()] || Object.entries(cachedForecasts).find(([k]) => k.trim().toLowerCase() === m.name.trim().toLowerCase())?.[1];
            if (cf) {
                const f7Qty = Number(cf.forecast7Day?.quantity ?? cf.forecast7Day ?? 0);
                const f1mQty = Number(cf.forecast1Month?.quantity ?? cf.forecast1Month ?? Number((f7Qty * 4.15).toFixed(1)));
                let decisionStatus = cf.decision_support?.decision_status || cf.decision_support?.status;
                if (!decisionStatus) {
                    if (m.currentStock <= 0) decisionStatus = "Out of Stock";
                    else if (m.currentStock <= m.minThreshold) decisionStatus = "Low Stock";
                    else decisionStatus = "Good";
                }
                const additionalNeed7 = Math.max(0, Number((f7Qty - m.currentStock).toFixed(1)));
                const additionalNeed1m = Math.max(0, Number((f1mQty - m.currentStock).toFixed(1)));
                const interpretation = cf.decision_support?.interpretation || (additionalNeed7 > 0 ? `Deficit of ${additionalNeed7.toFixed(1)} ${m.unit}. Reorder recommended.` : `Optimal inventory cushion.`);

                state.forecastMap.set(m.name, {
                    id: m.id,
                    itemCode: m.itemCode,
                    name: m.name,
                    unit: m.unit,
                    currentStock: m.currentStock,
                    minThreshold: m.minThreshold,
                    recentConsumption: 0,
                    finishedProduct: "Production Operations",
                    forecast7Day: f7Qty,
                    forecast1Month: f1mQty,
                    additionalNeed7,
                    additionalNeed1m,
                    status: decisionStatus,
                    interpretation
                });
            }
        });
    }

    state.forecastList = Array.from(state.forecastMap.values());
    if (state.forecastList.length > 0 && !state.lastForecastTimestamp) {
        state.lastForecastTimestamp = new Date();
    }
    state.forecastStatusText = state.forecastList.length > 0 ? "Forecast Ready" : "Awaiting Forecast Run";

    // Populate unit dropdown in forecasting tab
    populateForecastUnitFilter();
}

function populateForecastUnitFilter() {
    const unitSelect = document.getElementById("fcUnitFilter");
    if (!unitSelect) return;

    const currentVal = unitSelect.value;
    const units = Array.from(new Set(state.materials.map(m => m.unit))).filter(Boolean);
    unitSelect.innerHTML = `<option value="all">All Units</option>` + units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
    if (units.includes(currentVal)) unitSelect.value = currentVal;
}

function updateMetadataLabels() {
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    const pLblEl = document.getElementById("metaPeriodLabel");
    if (pLblEl) pLblEl.textContent = periodLabel;

    const genEl = document.getElementById("metaGeneratedTime");
    if (genEl && state.generatedAt) {
        genEl.textContent = state.generatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
    }

    const subTitle = document.getElementById("saveModalPeriodSubtitle");
    if (subTitle) subTitle.textContent = `Report Period: ${periodLabel}`;
}

/* ==========================================================
   RENDER ALL ON-SCREEN REPORT TABS
   ========================================================== */

function renderAllTabs() {
    renderManagerSummaryTab();
    renderRestockRecommendationsTab();
    renderInventoryRecordsTab();
    renderMaterialReceivingTab();
    renderMaterialDisbursementTab();
    renderMaterialActivityTab();
    renderConsumptionAnalysisTab();
    renderAiForecastingTab();
    updatePreviewBannerKpis();
    updatePrintDocHtml();
}

/* ==========================================================
   TAB 1: MANAGER SUMMARY
   ========================================================== */

function computePeriodStockStatus(mat) {
    if (!mat) return "Good";
    const stock = Number(mat.currentStock ?? mat.current_stock ?? 0);
    const min = Number(mat.minThreshold ?? mat.minimum_threshold ?? 0);
    if (stock <= 0) return "Critical";
    if (min > 0 && stock <= (min / 2)) return "Critical";
    if (min > 0 && stock <= min) return "Low";
    return "Good";
}

function renderManagerSummaryTab() {
    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    const periodReceipts = state.receipts.filter(r => 
        withinRange(r.receiptDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
    );
    const periodDisbursements = state.disbursements.filter(d => 
        withinRange(d.usageDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
    );

    const totalMats = targetMaterials.length;
    const targetDate = state.endDate || new Date().toISOString().slice(0, 10);
    const periodStatuses = targetMaterials.map(m => computePeriodStockStatus(m, targetDate));
    const goodStock = periodStatuses.filter(s => s === "Good" || s === "Stable").length;
    const attentionStock = periodStatuses.filter(s => s === "Low" || s === "Critical").length;
    const totalActivities = periodReceipts.length + periodDisbursements.length;

    // Mini KPI Cards
    const totEl = document.getElementById("mgrTotalMaterials");
    const goodEl = document.getElementById("mgrGoodStock");
    const attnEl = document.getElementById("mgrAttentionStock");
    const actEl = document.getElementById("mgrPeriodActivities");

    if (totEl) totEl.textContent = totalMats.toLocaleString();
    if (goodEl) goodEl.textContent = goodStock.toLocaleString();
    if (attnEl) attnEl.textContent = attentionStock.toLocaleString();
    if (actEl) actEl.textContent = totalActivities.toLocaleString();

    // Manager Overview Table
    const overviewBody = document.getElementById("mgrOverviewTableBody");
    if (overviewBody) {
        overviewBody.innerHTML = `
            <tr>
                <td><strong>Total Materials</strong></td>
                <td><strong>${totalMats}</strong></td>
                <td>${state.selectedMaterialId && state.selectedMaterialId !== "all" ? escapeHtml(state.selectedMaterialName) : "All Raw Materials"}</td>
                <td><span class="rpt-badge ${totalMats > 0 ? "rpt-badge-good" : ""}" style="${totalMats === 0 ? "background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0;" : ""}">${totalMats > 0 ? `${goodStock} Good / ${attentionStock} Attention` : "No Materials"}</span></td>
            </tr>
            <tr>
                <td><strong>Good Stock</strong></td>
                <td><strong>${goodStock}</strong></td>
                <td>Healthy Stock Level</td>
                <td><span class="rpt-badge ${goodStock > 0 ? "rpt-badge-good" : ""}" style="${goodStock === 0 ? "background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0;" : ""}">${goodStock > 0 ? "Sufficient Stock" : "No Materials"}</span></td>
            </tr>
            <tr>
                <td><strong>Low / Critical Stock</strong></td>
                <td><strong>${attentionStock}</strong></td>
                <td>Restock Needed</td>
                <td><span class="rpt-badge ${attentionStock > 0 ? "rpt-badge-critical" : ""}" style="${attentionStock === 0 ? "background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0;" : ""}">${attentionStock > 0 ? "Reorder Required" : "No Stock Alerts"}</span></td>
            </tr>
            <tr>
                <td><strong>Deliveries Received</strong></td>
                <td><strong>${periodReceipts.length}</strong></td>
                <td>Stock In (Deliveries)</td>
                <td>${periodReceipts.length > 0 ? `<span class="rpt-badge rpt-badge-good">${periodReceipts.length} Batches Stored</span>` : `<span class="rpt-badge" style="background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0;">No Activity in Period</span>`}</td>
            </tr>
            <tr>
                <td><strong>Production Usage</strong></td>
                <td><strong>${periodDisbursements.length}</strong></td>
                <td>Stock Used in Kitchen</td>
                <td>${periodDisbursements.length > 0 ? `<span class="rpt-badge rpt-badge-good">${periodDisbursements.length} Usages Recorded</span>` : `<span class="rpt-badge" style="background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0;">No Activity in Period</span>`}</td>
            </tr>
            <tr>
                <td><strong>Total Stock Released</strong></td>
                <td><strong>${periodDisbursements.length}</strong></td>
                <td>Stock Out (Disbursed)</td>
                <td>${periodDisbursements.length > 0 ? `<span class="rpt-badge rpt-badge-good">Released for Baking</span>` : `<span class="rpt-badge" style="background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0;">No Activity in Period</span>`}</td>
            </tr>
        `;
    }

    // Render Restock Recommendations (Dedicated Tab)
    renderRestockRecommendationsTab();

    // Render Visual Charts
    renderManagerCharts();
}

function renderRestockRecommendationsTab() {
    const decisionBody = document.getElementById("mgrDecisionTableBody");
    const critEl = document.getElementById("restockCritCount");
    const medEl = document.getElementById("restockMedCount");
    const goodEl = document.getElementById("restockGoodCount");

    const chkCrit = document.getElementById("chkRestockCrit");
    const chkMed = document.getElementById("chkRestockMed");
    const chkGood = document.getElementById("chkRestockGood");

    const showCrit = chkCrit ? chkCrit.checked : true;
    const showMed = chkMed ? chkMed.checked : true;
    const showGood = chkGood ? chkGood.checked : false;

    // Synchronize visual unchecked style on parent labels
    chkCrit?.closest(".pill-checklist")?.classList.toggle("is-unchecked", !showCrit);
    chkMed?.closest(".pill-checklist")?.classList.toggle("is-unchecked", !showMed);
    chkGood?.closest(".pill-checklist")?.classList.toggle("is-unchecked", !showGood);

    let critCount = 0;
    let medCount = 0;
    let goodCount = 0;

    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    let tCtx = null;
    try { tCtx = getActiveTenantContext(); } catch (_) {}

    const allDecisions = [];
    targetMaterials.forEach(m => {
        const aiReq = getMaterialAiRequirement(m, tCtx);
        const reqQty = (m.reorderQty && m.reorderQty > 0) ? m.reorderQty : (aiReq.reorderQty > 0 ? aiReq.reorderQty : 50);
        const fcNotice = aiReq.forecast7Day > 0 ? ` (Exact 7-Day AI Forecast Requirement: ${aiReq.forecast7Day.toLocaleString()} ${m.unit})` : "";

        if (m.status === "Critical") {
            critCount++;
            const minText = m.minThreshold > 0 ? ` (below threshold of ${m.minThreshold} ${m.unit})` : '';
            allDecisions.push({
                type: "critical",
                priority: "High Priority",
                badgeClass: "rpt-priority-high",
                material: m.name,
                stock: `${(m.currentStock || 0).toLocaleString()} ${m.unit}`,
                finding: (m.currentStock || 0) <= 0 ? `Out of stock (0 ${m.unit} on hand).` : `Stock is critically low: ${m.currentStock} ${m.unit}${minText}.`,
                action: `Order ${reqQty.toLocaleString()} ${m.unit} from supplier${fcNotice}.`
            });
        } else if (m.status === "Low") {
            medCount++;
            allDecisions.push({
                type: "medium",
                priority: "Medium",
                badgeClass: "rpt-priority-med",
                material: m.name,
                stock: `${(m.currentStock || 0).toLocaleString()} ${m.unit}`,
                finding: `Stock is getting low: ${m.currentStock} ${m.unit} (below threshold of ${m.minThreshold} ${m.unit}).`,
                action: `Prepare order of ${reqQty.toLocaleString()} ${m.unit} with supplier${fcNotice}.`
            });
        } else {
            goodCount++;
            allDecisions.push({
                type: "healthy",
                priority: "Healthy",
                badgeClass: "rpt-badge-good",
                material: m.name,
                stock: `${(m.currentStock || 0).toLocaleString()} ${m.unit}`,
                finding: `Stock is healthy: ${m.currentStock} ${m.unit} (meets operational buffer).`,
                action: aiReq.forecast7Day > 0 ? `Stock sufficient for projected 7-day AI demand (${aiReq.forecast7Day.toLocaleString()} ${m.unit}). No restock needed.` : `Stock sufficient. No restock needed.`
            });
        }
    });

    if (critEl) critEl.textContent = critCount;
    if (medEl) medEl.textContent = medCount;
    if (goodEl) goodEl.textContent = goodCount;

    if (!decisionBody) return;

    // If ALL are unchecked: NO view to see!
    if (!showCrit && !showMed && !showGood) {
        decisionBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; padding:44px 20px; color:#64748B;">
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;">
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="9" y1="9" x2="15" y2="15"></line>
                            <line x1="15" y1="9" x2="9" y2="15"></line>
                        </svg>
                        <div style="font-weight:700; font-size:0.95rem; color:#1E293B;">No Priority Categories Selected</div>
                        <div style="font-size:0.82rem; color:#64748B; max-width:380px;">All priority checklists are currently unchecked. Select one or more categories above to view records.</div>
                    </div>
                </td>
            </tr>`;
        return;
    }

    const visibleDecisions = allDecisions.filter(d => {
        if (d.type === "critical" && showCrit) return true;
        if (d.type === "medium" && showMed) return true;
        if (d.type === "healthy" && showGood) return true;
        return false;
    });

    if (targetMaterials.length === 0) {
        decisionBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:#64748b; font-weight:500;">No raw materials registered in inventory yet. Add materials in Inventory to view restock recommendations.</td></tr>';
        return;
    }

    if (visibleDecisions.length === 0) {
        decisionBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--rpt-text-dim); font-weight:600;">No items found matching the selected priority filters.</td></tr>';
    } else {
        decisionBody.innerHTML = visibleDecisions.map(d => `
            <tr>
                <td><span class="rpt-badge ${d.badgeClass}">${d.priority}</span></td>
                <td><strong>${escapeHtml(d.material)}</strong></td>
                <td>${escapeHtml(d.stock)}</td>
                <td>${escapeHtml(d.finding)}</td>
                <td><strong>${escapeHtml(d.action)}</strong></td>
            </tr>
        `).join("");
    }
}

let stockHealthChartInstance = null;
let qtyProgressChartInstance = null;

function renderManagerCharts() {
    if (typeof Chart === "undefined") return;

    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    // 1. Stock Health Breakdown Chart (Doughnut)
    const stockHealthCanvas = document.getElementById("stockHealthChart");
    if (stockHealthCanvas) {
        const goodCount = targetMaterials.filter(m => m.status === "Good").length;
        const lowCount = targetMaterials.filter(m => m.status === "Low").length;
        const criticalCount = targetMaterials.filter(m => m.status === "Critical").length;
        const totalMats = targetMaterials.length;

        const badge = document.getElementById("stockHealthTotalBadge");
        if (badge) badge.textContent = `${totalMats} Material${totalMats === 1 ? "" : "s"}`;

        if (stockHealthChartInstance) {
            stockHealthChartInstance.destroy();
            stockHealthChartInstance = null;
        }

        const ctx = stockHealthCanvas.getContext("2d");
        stockHealthChartInstance = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: ["Sufficient (Good)", "Low Buffer", "Critical Threshold"],
                datasets: [{
                    data: [goodCount, lowCount, criticalCount],
                    backgroundColor: [
                        "#16803c", // emerald green
                        "#f59e0b", // amber/orange
                        "#dc2626"  // red
                    ],
                    borderWidth: 2,
                    borderColor: "#ffffff"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: {
                            boxWidth: 12,
                            font: { size: 11, weight: "600" },
                            color: "#334155"
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const val = context.raw || 0;
                                const pct = totalMats > 0 ? ((val / totalMats) * 100).toFixed(1) : 0;
                                return ` ${context.label}: ${val} materials (${pct}%)`;
                            }
                        }
                    }
                },
                cutout: "68%"
            }
        });
    }

    // 2. Material Quantity Progress Chart (Daily Inflow vs Outflow)
    const qtyProgressCanvas = document.getElementById("qtyProgressChart");
    if (qtyProgressCanvas) {
        const periodReceipts = state.receipts.filter(r => 
            withinRange(r.receiptDate, state.startDate, state.endDate) &&
            (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
        );
        const periodDisbursements = state.disbursements.filter(d => 
            withinRange(d.usageDate, state.startDate, state.endDate) &&
            (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
        );

        // Generate date map across period range
        const dateLabels = [];
        const receivedMap = new Map();
        const disbursedMap = new Map();

        let totalRcv = 0;
        let totalDisb = 0;

        periodReceipts.forEach(r => {
            if (r.receiptDate) {
                receivedMap.set(r.receiptDate, (receivedMap.get(r.receiptDate) || 0) + r.receivedQuantity);
                totalRcv += r.receivedQuantity;
            }
        });

        periodDisbursements.forEach(d => {
            if (d.usageDate) {
                disbursedMap.set(d.usageDate, (disbursedMap.get(d.usageDate) || 0) + d.disbursedQuantity);
                totalDisb += d.disbursedQuantity;
            }
        });

        // Collect all distinct dates or interpolate between start and end
        if (state.startDate && state.endDate) {
            let cur = new Date(state.startDate);
            const end = new Date(state.endDate);
            while (cur <= end) {
                const s = formatDateISO(cur);
                dateLabels.push(s);
                cur = addDays(cur, 1);
            }
        } else {
            const allDates = Array.from(new Set([...receivedMap.keys(), ...disbursedMap.keys()])).sort();
            dateLabels.push(...allDates);
        }

        const formattedLabels = dateLabels.map(dStr => {
            const d = parseDateOnly(dStr);
            if (!d) return dStr;
            return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        });

        const rcvData = dateLabels.map(dStr => Number((receivedMap.get(dStr) || 0).toFixed(1)));
        const disbData = dateLabels.map(dStr => Number((disbursedMap.get(dStr) || 0).toFixed(1)));

        const badge = document.getElementById("qtyProgressTotalBadge");
        if (badge) badge.textContent = `+${totalRcv.toLocaleString()} in / -${totalDisb.toLocaleString()} out`;

        if (qtyProgressChartInstance) {
            qtyProgressChartInstance.destroy();
            qtyProgressChartInstance = null;
        }

        const ctx = qtyProgressCanvas.getContext("2d");
        qtyProgressChartInstance = new Chart(ctx, {
            type: "bar",
            data: {
                labels: formattedLabels.length > 0 ? formattedLabels : ["No Records"],
                datasets: [
                    {
                        label: "Received Inflow (+)",
                        data: rcvData.length > 0 ? rcvData : [0],
                        backgroundColor: "#16803c", // Emerald
                        borderRadius: 4,
                        barPercentage: 0.7,
                        categoryPercentage: 0.8
                    },
                    {
                        label: "Disbursed Outflow (-)",
                        data: disbData.length > 0 ? disbData : [0],
                        backgroundColor: "#2563eb", // Blue
                        borderRadius: 4,
                        barPercentage: 0.7,
                        categoryPercentage: 0.8
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "top",
                        labels: {
                            boxWidth: 10,
                            font: { size: 10.5, weight: "600" },
                            color: "#334155"
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ` ${context.dataset.label}: ${context.raw?.toLocaleString()}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 10, weight: "600" }, color: "#475569" }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: "#f1f5f9" },
                        ticks: { font: { size: 10 }, color: "#64748b" }
                    }
                }
            }
        });
    }
}

/* ==========================================================
   REUSABLE PAGINATION HELPER
   ========================================================== */

function renderReportsPaginationBar({ containerId, currentPage, totalItems, pageSize, onPageChange }) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (totalItems === 0) {
        container.innerHTML = `
            <div class="inv-pagination-info">Showing 0–0 of 0 records</div>
            <div class="inv-pagination-controls">
                <button type="button" class="inv-page-btn disabled" disabled aria-label="Previous Page">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <button type="button" class="inv-page-btn disabled" disabled>1</button>
                <button type="button" class="inv-page-btn disabled" disabled aria-label="Next Page">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
            </div>
        `;
        return;
    }

    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const safePage = Math.max(1, Math.min(currentPage, totalPages));
    const startIdx = (safePage - 1) * pageSize + 1;
    const endIdx = Math.min(safePage * pageSize, totalItems);

    let pageButtonsHtml = `
        <button type="button" class="inv-page-btn" ${safePage <= 1 ? "disabled" : ""} data-page="${safePage - 1}" aria-label="Previous Page" title="Previous Page">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
    `;

    let startPage = Math.max(1, safePage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    if (startPage > 1) {
        pageButtonsHtml += `<button type="button" class="inv-page-btn" data-page="1">1</button>`;
        if (startPage > 2) pageButtonsHtml += `<span class="page-ellipsis">...</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
        pageButtonsHtml += `
            <button type="button" class="inv-page-btn ${p === safePage ? "active" : ""}" data-page="${p}">${p}</button>
        `;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) pageButtonsHtml += `<span class="page-ellipsis">...</span>`;
        pageButtonsHtml += `<button type="button" class="inv-page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    pageButtonsHtml += `
        <button type="button" class="inv-page-btn" ${safePage >= totalPages ? "disabled" : ""} data-page="${safePage + 1}" aria-label="Next Page" title="Next Page">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
    `;

    container.innerHTML = `
        <div class="inv-pagination-info">Showing ${startIdx}–${endIdx} of ${totalItems} records</div>
        <div class="inv-pagination-controls">
            ${pageButtonsHtml}
        </div>
    `;

    const buttons = container.querySelectorAll("button[data-page]");
    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetP = parseInt(btn.getAttribute("data-page"), 10);
            if (!isNaN(targetP) && targetP !== safePage && targetP >= 1 && targetP <= totalPages) {
                onPageChange(targetP);
            }
        });
    });
}

/* ==========================================================
   TAB 2: INVENTORY RECORDS
   ========================================================== */

function renderInventoryRecordsTab() {
    const tbody = document.getElementById("invTableBody");
    if (!tbody) return;

    const term = state.invSearch.trim().toLowerCase();
    const status = state.invStatus;

    let filtered = state.materials.filter(m => {
        if (state.selectedMaterialId && state.selectedMaterialId !== "all" && m.id !== state.selectedMaterialId) return false;
        if (term && !m.name.toLowerCase().includes(term) && !m.itemCode.toLowerCase().includes(term)) return false;
        if (status !== "all" && m.status !== status) return false;
        return true;
    });

    if (state.invSort === "oldest") {
        filtered = [...filtered].reverse();
    } else if (state.invSort === "az") {
        filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (state.invSort === "za") {
        filtered.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
    } else if (state.invSort === "high_stock") {
        filtered.sort((a, b) => (b.currentStock || 0) - (a.currentStock || 0));
    } else if (state.invSort === "low_stock") {
        filtered.sort((a, b) => (a.currentStock || 0) - (b.currentStock || 0));
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.invPageSize));
    if (state.invPage > totalPages) state.invPage = totalPages;

    const startIdx = (state.invPage - 1) * state.invPageSize;
    const pageItems = filtered.slice(startIdx, startIdx + state.invPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No inventory records match the search criteria.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(m => {
            const badgeCls = m.status === "Critical" ? "rpt-badge-critical" : (m.status === "Low" ? "rpt-badge-low" : "rpt-badge-good");
            return `
                <tr>
                    <td><strong>${escapeHtml(m.name)}</strong></td>
                    <td><span style="font-size:0.75rem; color:var(--rpt-text-mid);">${escapeHtml(m.itemCode)}</span></td>
                    <td>${escapeHtml(m.unit)}</td>
                    <td><strong>${m.currentStock.toLocaleString()}</strong></td>
                    <td>${m.minThreshold.toLocaleString()}</td>
                    <td>${m.reorderQty.toLocaleString()}</td>
                    <td><span class="rpt-badge ${badgeCls}">${m.status}</span></td>
                </tr>
            `;
        }).join("");
    }

    renderReportsPaginationBar({
        containerId: "invPaginationBar",
        currentPage: state.invPage,
        totalItems: filtered.length,
        pageSize: state.invPageSize,
        onPageChange: (p) => {
            state.invPage = p;
            renderInventoryRecordsTab();
        }
    });
}

/* ==========================================================
   TAB 3: MATERIAL RECEIVING
   ========================================================== */

function renderMaterialReceivingTab() {
    const tbody = document.getElementById("rcvTableBody");
    const countNote = document.getElementById("rcvTotalCountNote");
    if (!tbody) return;

    const term = state.rcvSearch.trim().toLowerCase();
    let filtered = state.receipts.filter(r => 
        withinRange(r.receiptDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
    );

    if (term) {
        filtered = filtered.filter(r => r.materialName.toLowerCase().includes(term) || r.supplierName.toLowerCase().includes(term) || r.receivedBy.toLowerCase().includes(term));
    }

    if (state.rcvSort === "oldest") {
        filtered.sort((a, b) => (a.receiptDate || "").localeCompare(b.receiptDate || ""));
    } else if (state.rcvSort === "az") {
        filtered.sort((a, b) => (a.materialName || "").localeCompare(b.materialName || ""));
    } else if (state.rcvSort === "za") {
        filtered.sort((a, b) => (b.materialName || "").localeCompare(a.materialName || ""));
    } else if (state.rcvSort === "highest") {
        filtered.sort((a, b) => (b.receivedQuantity || 0) - (a.receivedQuantity || 0));
    } else {
        filtered.sort((a, b) => (b.receiptDate || "").localeCompare(a.receiptDate || ""));
    }

    if (countNote) countNote.textContent = `${filtered.length} receipt${filtered.length === 1 ? "" : "s"} recorded`;

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.rcvPageSize));
    if (state.rcvPage > totalPages) state.rcvPage = totalPages;

    const startIdx = (state.rcvPage - 1) * state.rcvPageSize;
    const pageItems = filtered.slice(startIdx, startIdx + state.rcvPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No receiving records recorded for this period.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(r => `
            <tr>
                <td>${escapeHtml(r.receiptDate)}</td>
                <td><span style="font-size:0.75rem; color:#64748B; font-weight:600;">${escapeHtml(r.receiptTime || '—')}</span></td>
                <td><code class="ref-badge" style="font-family:monospace; background:rgba(16,185,129,0.1); color:#065f46; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(r.referenceNo || '—')}</code></td>
                <td><span style="font-family:monospace; font-size:12px; font-weight:700; color:#2563EB; background:#EFF6FF; padding:2px 6px; border-radius:4px; border:1px solid #DBEAFE;">${escapeHtml(r.materialCode || '—')}</span></td>
                <td><strong>${escapeHtml(r.materialName)}</strong></td>
                <td><strong style="color:var(--rpt-green-dark);">+${r.receivedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></td>
                <td>${escapeHtml(r.unit)}</td>
                <td>${escapeHtml(r.supplierName)}</td>
                <td>${escapeHtml(r.receivedBy)}</td>
                <td><span class="rpt-badge rpt-badge-good">Verified &amp; Received</span></td>
            </tr>
        `).join("");
    }

    renderReportsPaginationBar({
        containerId: "rcvPaginationBar",
        currentPage: state.rcvPage,
        totalItems: filtered.length,
        pageSize: state.rcvPageSize,
        onPageChange: (p) => {
            state.rcvPage = p;
            renderMaterialReceivingTab();
        }
    });
}

/* ==========================================================
   TAB 4: MATERIAL DISBURSEMENT
   ========================================================== */

function renderMaterialDisbursementTab() {
    const tbody = document.getElementById("disbTableBody");
    const countNote = document.getElementById("disbTotalCountNote");
    if (!tbody) return;

    const term = state.disbSearch.trim().toLowerCase();
    let filtered = state.disbursements.filter(d => 
        withinRange(d.usageDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
    );

    if (term) {
        filtered = filtered.filter(d => d.materialName.toLowerCase().includes(term) || d.finishedProduct.toLowerCase().includes(term) || d.activityType.toLowerCase().includes(term));
    }

    if (state.disbSort === "oldest") {
        filtered.sort((a, b) => (a.usageDate || "").localeCompare(b.usageDate || ""));
    } else if (state.disbSort === "az") {
        filtered.sort((a, b) => (a.materialName || "").localeCompare(b.materialName || ""));
    } else if (state.disbSort === "za") {
        filtered.sort((a, b) => (b.materialName || "").localeCompare(a.materialName || ""));
    } else if (state.disbSort === "highest") {
        filtered.sort((a, b) => (b.disbursedQuantity || 0) - (a.disbursedQuantity || 0));
    } else {
        filtered.sort((a, b) => (b.usageDate || "").localeCompare(a.usageDate || ""));
    }

    if (countNote) countNote.textContent = `${filtered.length} disbursement${filtered.length === 1 ? "" : "s"} recorded`;

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.disbPageSize));
    if (state.disbPage > totalPages) state.disbPage = totalPages;

    const startIdx = (state.disbPage - 1) * state.disbPageSize;
    const pageItems = filtered.slice(startIdx, startIdx + state.disbPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No material disbursements recorded for this period.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(d => `
            <tr>
                <td>${escapeHtml(d.usageDate)}</td>
                <td><span style="font-size:0.75rem; color:#64748B; font-weight:600;">${escapeHtml(d.usageTime || '—')}</span></td>
                <td><code class="ref-badge" style="font-family:monospace; background:rgba(239,68,68,0.1); color:#991b1b; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(d.referenceNo || '—')}</code></td>
                <td><span style="font-family:monospace; font-size:12px; font-weight:700; color:#2563EB; background:#EFF6FF; padding:2px 6px; border-radius:4px; border:1px solid #DBEAFE;">${escapeHtml(d.materialCode || '—')}</span></td>
                <td><strong>${escapeHtml(d.materialName)}</strong></td>
                <td><span style="font-weight:600; color:var(--rpt-blue-dark);">${escapeHtml(d.finishedProduct)}</span></td>
                <td><strong style="color:var(--rpt-orange-dark);">${d.disbursedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></td>
                <td>${escapeHtml(d.unit)}</td>
                <td><span style="font-size:0.75rem; color:var(--rpt-text-mid);">${escapeHtml(d.activityType)}</span></td>
                <td>${escapeHtml(d.recordedBy)}</td>
            </tr>
        `).join("");
    }

    renderReportsPaginationBar({
        containerId: "disbPaginationBar",
        currentPage: state.disbPage,
        totalItems: filtered.length,
        pageSize: state.disbPageSize,
        onPageChange: (p) => {
            state.disbPage = p;
            renderMaterialDisbursementTab();
        }
    });
}

/* ==========================================================
   TAB 5: MATERIAL ACTIVITY (CHRONOLOGICAL LOG)
   ========================================================== */

function renderMaterialActivityTab() {
    const tbody = document.getElementById("actTableBody");
    if (!tbody) return;

    const periodReceipts = state.receipts.filter(r => 
        withinRange(r.receiptDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
    );
    const periodDisbursements = state.disbursements.filter(d => 
        withinRange(d.usageDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
    );

    const activities = [];

    periodReceipts.forEach(r => {
        activities.push({
            date: r.receiptDate,
            time: r.receiptTime || '',
            referenceNo: r.referenceNo || '—',
            materialCode: r.materialCode || '—',
            type: "Received",
            material: r.materialName,
            qty: r.receivedQuantity,
            unit: r.unit,
            ref: r.supplierName,
            operator: r.receivedBy
        });
    });

    periodDisbursements.forEach(d => {
        activities.push({
            date: d.usageDate,
            time: d.usageTime || '',
            referenceNo: d.referenceNo || '—',
            materialCode: d.materialCode || '—',
            type: "Disbursed",
            material: d.materialName,
            qty: -d.disbursedQuantity,
            unit: d.unit,
            ref: d.finishedProduct,
            operator: d.recordedBy
        });
    });

    if (state.actSort === "oldest") {
        activities.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    } else if (state.actSort === "az") {
        activities.sort((a, b) => (a.material || "").localeCompare(b.material || ""));
    } else if (state.actSort === "za") {
        activities.sort((a, b) => (b.material || "").localeCompare(a.material || ""));
    } else {
        activities.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    }

    const term = state.actSearch.trim().toLowerCase();
    const typeFilter = state.actType;

    let filtered = activities.filter(a => {
        if (term && !a.material.toLowerCase().includes(term) && !a.ref.toLowerCase().includes(term) && !a.operator.toLowerCase().includes(term)) return false;
        if (typeFilter !== "all" && a.type !== typeFilter) return false;
        return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.actPageSize));
    if (state.actPage > totalPages) state.actPage = totalPages;

    const startIdx = (state.actPage - 1) * state.actPageSize;
    const pageItems = filtered.slice(startIdx, startIdx + state.actPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No activity transactions recorded for this period.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(a => {
            const isRcv = a.type === "Received";
            const badgeCls = isRcv ? "rpt-badge-good" : "rpt-badge-low";
            const qtyStr = isRcv ? `+${a.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${a.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
            const qtyColor = isRcv ? "var(--rpt-green-dark)" : "var(--rpt-red-dark)";

            return `
                <tr>
                    <td>${escapeHtml(a.date)}</td>
                    <td><span style="font-size:0.75rem; color:#64748B; font-weight:600;">${escapeHtml(a.time || '—')}</span></td>
                    <td><code class="ref-badge" style="font-family:monospace; background:rgba(99,102,241,0.1); color:#3730a3; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(a.referenceNo || '—')}</code></td>
                    <td><span style="font-family:monospace; font-size:12px; font-weight:700; color:#2563EB; background:#EFF6FF; padding:2px 6px; border-radius:4px; border:1px solid #DBEAFE;">${escapeHtml(a.materialCode || '—')}</span></td>
                    <td><span class="rpt-badge ${badgeCls}">${a.type}</span></td>
                    <td><strong>${escapeHtml(a.material)}</strong></td>
                    <td><strong style="color:${qtyColor};">${qtyStr}</strong></td>
                    <td>${escapeHtml(a.unit)}</td>
                    <td>${escapeHtml(a.ref)}</td>
                    <td>${escapeHtml(a.operator)}</td>
                </tr>
            `;
        }).join("");
    }

    renderReportsPaginationBar({
        containerId: "actPaginationBar",
        currentPage: state.actPage,
        totalItems: filtered.length,
        pageSize: state.actPageSize,
        onPageChange: (p) => {
            state.actPage = p;
            renderMaterialActivityTab();
        }
    });
}

/* ==========================================================
   TAB 6: CONSUMPTION ANALYSIS
   ========================================================== */

function renderConsumptionAnalysisTab() {
    const tbody = document.getElementById("cnsTableBody");
    if (!tbody) return;

    const periodDisbursements = state.disbursements.filter(d => 
        withinRange(d.usageDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
    );

    const days = Math.round((state.endDate - state.startDate) / 86400000) + 1;
    const prevEnd = addDays(state.startDate, -1);
    const prevStart = addDays(prevEnd, -(days - 1));

    const prevDisbursements = state.disbursements.filter(d => 
        withinRange(d.usageDate, prevStart, prevEnd) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
    );

    const curMap = new Map();
    periodDisbursements.forEach(d => {
        curMap.set(d.materialId, (curMap.get(d.materialId) || 0) + d.disbursedQuantity);
    });

    const prevMap = new Map();
    prevDisbursements.forEach(d => {
        prevMap.set(d.materialId, (prevMap.get(d.materialId) || 0) + d.disbursedQuantity);
    });

    const term = state.cnsSearch.trim().toLowerCase();

    const targetMats = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    let list = targetMats.map(m => {
        const curUsage = curMap.get(m.id) || 0;
        const prevUsage = prevMap.get(m.id) || 0;
                let trend = "No Activity";
        if (curUsage === 0 && prevUsage === 0) {
            trend = "No Activity";
        } else if (prevUsage === 0 && curUsage > 0) {
            trend = "Increasing";
        } else if (prevUsage > 0 && curUsage === 0) {
            trend = "Decreasing";
        } else if (curUsage >= prevUsage * 1.15) {
            trend = "Increasing";
        } else if (curUsage <= prevUsage * 0.85) {
            trend = "Decreasing";
        } else {
            trend = "Stable";
        }

        return {
            material: m.name,
            unit: m.unit,
            currentUsage: curUsage,
            previousUsage: prevUsage,
            currentStock: m.currentStock,
            trend,
            status: m.status
        };
    });

    if (term) {
        list = list.filter(l => l.material.toLowerCase().includes(term));
    }

    if (state.cnsSort === "oldest") {
        list = [...list].reverse();
    } else if (state.cnsSort === "az") {
        list.sort((a, b) => (a.material || "").localeCompare(b.material || ""));
    } else if (state.cnsSort === "za") {
        list.sort((a, b) => (b.material || "").localeCompare(a.material || ""));
    } else if (state.cnsSort === "high_consumed") {
        list.sort((a, b) => (b.currentUsage || 0) - (a.currentUsage || 0));
    } else if (state.cnsSort === "low_consumed") {
        list.sort((a, b) => (a.currentUsage || 0) - (b.currentUsage || 0));
    }

    const totalPages = Math.max(1, Math.ceil(list.length / state.cnsPageSize));
    if (state.cnsPage > totalPages) state.cnsPage = totalPages;

    const startIdx = (state.cnsPage - 1) * state.cnsPageSize;
    const pageItems = list.slice(startIdx, startIdx + state.cnsPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No consumption records match the filter.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(l => {
            const badgeCls = l.status === "Critical" ? "rpt-badge-critical" : (l.status === "Low" ? "rpt-badge-low" : "rpt-badge-good");
            const trendColor = l.trend === "Increasing" ? "var(--rpt-orange-dark)" : (l.trend === "Decreasing" ? "var(--rpt-blue-dark)" : "var(--rpt-text-muted)");

            return `
                <tr>
                    <td><strong>${escapeHtml(l.material)}</strong></td>
                    <td><strong>${l.currentUsage.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHtml(l.unit)}</strong></td>
                    <td>${l.previousUsage.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHtml(l.unit)}</td>
                    <td>${l.currentStock.toLocaleString()} ${escapeHtml(l.unit)}</td>
                    <td><strong style="color:${trendColor};">${l.trend}</strong></td>
                    <td><span class="rpt-badge ${badgeCls}">${l.status}</span></td>
                </tr>
            `;
        }).join("");
    }

    renderReportsPaginationBar({
        containerId: "cnsPaginationBar",
        currentPage: state.cnsPage,
        totalItems: list.length,
        pageSize: state.cnsPageSize,
        onPageChange: (p) => {
            state.cnsPage = p;
            renderConsumptionAnalysisTab();
        }
    });
}

/* ==========================================================
   TAB 7: AI FORECASTING REPORT
   ========================================================== */

function renderAiForecastingTab() {
    const isMonthly = state.fcHorizon === "1month";
    const targetForecasts = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.forecastList.filter(item => item.id === state.selectedMaterialId || item.itemCode === state.selectedMaterialId || (state.materials.find(m => m.id === state.selectedMaterialId)?.name === item.name))
        : state.forecastList;
    const hasMaterials = targetForecasts.length > 0;

    // 1. Forecast Status & Horizon KPI Cards
    const statusEl = document.getElementById("fcReportStatus");
    const matCountEl = document.getElementById("fcReportMatCount");
    const horizonEl = document.getElementById("fcReportHorizon");
    const lastTimeEl = document.getElementById("fcReportLastTime");

    if (!hasMaterials) {
        if (statusEl) {
            statusEl.textContent = "No Forecast Data";
            statusEl.className = "rpt-kpi-val";
            statusEl.style.color = "#64748B";
        }
        if (matCountEl) matCountEl.textContent = "0 Materials";
        if (horizonEl) horizonEl.textContent = "Awaiting Registered Materials";
        if (lastTimeEl) lastTimeEl.textContent = "No Activity Logged";
    } else {
        const shortageCount = targetForecasts.filter(item => {
            const addNeed = isMonthly ? item.additionalNeed1m : item.additionalNeed7;
            return addNeed > 0 || item.status === "Potential Shortage";
        }).length;

        const attentionCount = targetForecasts.filter(item => {
            const addNeed = isMonthly ? item.additionalNeed1m : item.additionalNeed7;
            return addNeed === 0 && (item.status === "Needs Attention" || item.status === "Low Stock Attention" || item.currentStock <= item.minThreshold);
        }).length;

        if (statusEl) {
            statusEl.style.color = "";
            if (shortageCount > 0) {
                statusEl.textContent = `${shortageCount} Shortage Risk${shortageCount > 1 ? "s" : ""}`;
                statusEl.className = "rpt-kpi-val text-red";
            } else if (attentionCount > 0) {
                statusEl.textContent = `${attentionCount} Attention Needed`;
                statusEl.className = "rpt-kpi-val text-orange";
            } else {
                statusEl.textContent = "Forecast Ready";
                statusEl.className = "rpt-kpi-val text-green";
            }
        }

        if (matCountEl) matCountEl.textContent = `${targetForecasts.length} Material${targetForecasts.length === 1 ? "" : "s"}`;
        if (horizonEl) {
            horizonEl.textContent = isMonthly ? "Horizon: 30-Day Projections" : "Horizon: 7-Day Operational";
        }

        if (lastTimeEl) {
            if (state.lastForecastTimestamp) {
                const dt = new Date(state.lastForecastTimestamp);
                lastTimeEl.textContent = `Synced: ${dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
            } else {
                lastTimeEl.textContent = "Status: Live AI Projections";
            }
        }
    }

    // 2. Unit-Safe Requirement Summary Pills
    const pillsContainer = document.getElementById("fcReportReqPills");
    if (pillsContainer) {
        if (!hasMaterials) {
            pillsContainer.innerHTML = `<span class="fc-unit-pill empty">0 Projected</span>`;
        } else {
            const unitMap = new Map();
            targetForecasts.forEach(item => {
                const req = isMonthly ? item.forecast1Month : item.forecast7Day;
                const u = item.unit || "units";
                unitMap.set(u, (unitMap.get(u) || 0) + req);
            });

            if (unitMap.size === 0) {
                pillsContainer.innerHTML = `<span class="fc-unit-pill empty">0 Projected</span>`;
            } else {
                pillsContainer.innerHTML = Array.from(unitMap.entries()).map(([unit, total]) => `
                    <span class="fc-unit-pill">
                        <strong>${total.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong>&nbsp;${escapeHtml(unit)}
                    </span>
                `).join("");
            }
        }
    }

    // 3. AI Forecast Decision Support Findings
    const decisionListEl = document.getElementById("fcReportDecisionList");
    if (decisionListEl) {
        if (!hasMaterials) {
            decisionListEl.innerHTML = `
                <div class="rpt-fc-decision-card" style="border-left-color: #94A3B8; background: #F8FAFC;">
                    <div class="rpt-fc-decision-title">
                        <span style="color:#475569;">No Inventory Available for Forecasting</span>
                        <span class="rpt-badge" style="background:#E2E8F0; color:#475569;">Awaiting Data</span>
                    </div>
                    <div class="rpt-fc-decision-body" style="color:#64748B;">
                        No raw materials have been registered in the system yet. Once materials and disbursements are logged, AI demand projections and run-out insights will automatically appear here.
                    </div>
                </div>
            `;
        } else {
            const criticalItems = targetForecasts.filter(item => {
                const addNeed = isMonthly ? item.additionalNeed1m : item.additionalNeed7;
                return addNeed > 0 || item.status === "Potential Shortage";
            });
            const attentionItems = targetForecasts.filter(item => {
                const addNeed = isMonthly ? item.additionalNeed1m : item.additionalNeed7;
                return addNeed === 0 && (item.status === "Needs Attention" || item.status === "Low Stock Attention" || item.currentStock <= item.minThreshold);
            });

            let cardsHtml = "";

            if (criticalItems.length > 0) {
                criticalItems.slice(0, 3).forEach(item => {
                    const req = isMonthly ? item.forecast1Month : item.forecast7Day;
                    const addNeed = isMonthly ? item.additionalNeed1m : item.additionalNeed7;
                    cardsHtml += `
                        <div class="rpt-fc-decision-card warning">
                            <div class="rpt-fc-decision-title">
                                <span style="color:#b91c1c;">${escapeHtml(item.name)} — Potential Deficit</span>
                                <span class="rpt-badge rpt-badge-shortage">Deficit Warning</span>
                            </div>
                            <div class="rpt-fc-decision-body">
                                Projected ${isMonthly ? "30-day" : "7-day"} requirement is <strong>${req.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${escapeHtml(item.unit)}</strong> vs current stock of <strong>${item.currentStock.toLocaleString()} ${escapeHtml(item.unit)}</strong>. Additional <strong>+${addNeed.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${escapeHtml(item.unit)}</strong> required to satisfy operations.
                            </div>
                        </div>
                    `;
                });
            }

            if (attentionItems.length > 0 && criticalItems.length < 3) {
                attentionItems.slice(0, 3 - criticalItems.length).forEach(item => {
                    cardsHtml += `
                        <div class="rpt-fc-decision-card attention">
                            <div class="rpt-fc-decision-title">
                                <span style="color:#c2410c;">${escapeHtml(item.name)} — Threshold Alert</span>
                                <span class="rpt-badge rpt-badge-attention">Needs Attention</span>
                            </div>
                            <div class="rpt-fc-decision-body">
                                Current stock (<strong>${item.currentStock.toLocaleString()} ${escapeHtml(item.unit)}</strong>) is within minimum safety threshold (<strong>${item.minThreshold} ${escapeHtml(item.unit)}</strong>). Place replenishment order with supplier to avoid kitchen stockout.
                            </div>
                        </div>
                    `;
                });
            }

            if (!cardsHtml) {
                cardsHtml = `
                    <div class="rpt-fc-decision-card">
                        <div class="rpt-fc-decision-title">
                            <span style="color:#15803d;">All Raw Materials Within Safe Operational Buffers</span>
                            <span class="rpt-badge rpt-badge-good">Sufficient Stock</span>
                        </div>
                        <div class="rpt-fc-decision-body">
                            Current inventory cushions across all registered materials fully satisfy projected ${isMonthly ? "30-day" : "7-day"} operational demand. No immediate shortage risks detected.
                        </div>
                    </div>
                `;
            }

            decisionListEl.innerHTML = cardsHtml;
        }
    }

    // 4. Filter & Search Table Rows
    const term = state.fcSearch.trim().toLowerCase();
    const unitFilter = state.fcUnit;
    const statusFilter = state.fcStatus;

    let filtered = targetForecasts.filter(item => {
        if (term) {
            const matchName = item.name.toLowerCase().includes(term);
            const matchCode = item.itemCode.toLowerCase().includes(term);
            const matchProduct = item.finishedProduct.toLowerCase().includes(term);
            if (!matchName && !matchCode && !matchProduct) return false;
        }
        if (unitFilter !== "all" && item.unit !== unitFilter) return false;

        const addNeed = isMonthly ? item.additionalNeed1m : item.additionalNeed7;
        if (statusFilter === "Sufficient" && (addNeed > 0 || item.status === "Potential Shortage" || item.status === "Needs Attention" || item.status === "Low Stock Attention")) return false;
        if (statusFilter === "Monitor" && item.status !== "Monitor") return false;
        if (statusFilter === "Needs Attention" && item.status !== "Needs Attention" && item.status !== "Low Stock Attention" && item.currentStock > item.minThreshold) return false;
        if (statusFilter === "Potential Shortage" && addNeed === 0 && item.status !== "Potential Shortage") return false;

        return true;
    });

    const countNote = document.getElementById("fcTotalCountNote");
    if (countNote) countNote.textContent = `${filtered.length} material${filtered.length === 1 ? "" : "s"}`;

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.fcPageSize));
    if (state.fcPage > totalPages) state.fcPage = totalPages;

    const startIdx = (state.fcPage - 1) * state.fcPageSize;
    const pageItems = filtered.slice(startIdx, startIdx + state.fcPageSize);

    const tbody = document.getElementById("fcTableBody");
    if (!tbody) return;

    if (!hasMaterials) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; padding:36px 16px; color:#64748B;">
                    <div style="font-weight:600; font-size:0.9rem; color:#334155; margin-bottom:4px;">No Raw Materials Available for Forecasting</div>
                    <div style="font-size:0.8rem; color:#64748B;">Add materials in <strong>My Inventory</strong> to begin generating automated forecast requirements.</div>
                </td>
            </tr>
        `;
    } else if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No materials match the forecast search criteria.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(item => {
            const req = isMonthly ? item.forecast1Month : item.forecast7Day;
            const addNeed = isMonthly ? item.additionalNeed1m : item.additionalNeed7;

            let badge = "";
            if (item.currentStock <= 0) {
                badge = `<span class="rpt-badge rpt-badge-shortage"><span class="rpt-status-dot" style="background:#dc2626;"></span>Out of Stock</span>`;
            } else if (item.currentStock <= item.minThreshold || addNeed > 0) {
                badge = `<span class="rpt-badge rpt-badge-attention"><span class="rpt-status-dot" style="background:#ea580c;"></span>Low Stock</span>`;
            } else {
                badge = `<span class="rpt-badge rpt-badge-good"><span class="rpt-status-dot" style="background:#16a34a;"></span>Good</span>`;
            }

            return `
                <tr>
                    <td><strong>${escapeHtml(item.name)}</strong></td>
                    <td><span style="font-size:0.75rem; color:var(--rpt-text-mid); font-family:monospace;">${escapeHtml(item.itemCode)}</span></td>
                    <td><span style="font-weight:600; color:var(--rpt-blue-dark);">${escapeHtml(item.finishedProduct)}</span></td>
                    <td><strong>${item.currentStock.toLocaleString()}</strong> <small style="color:var(--rpt-text-dim);">${escapeHtml(item.unit)}</small></td>
                    <td>${escapeHtml(item.unit)}</td>
                    <td>${item.recentConsumption > 0 ? `${item.recentConsumption.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${escapeHtml(item.unit)}` : `0 ${escapeHtml(item.unit)}`}</td>
                    <td><strong style="color:var(--rpt-blue-dark, #1e40af); font-weight:700;">${req.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${escapeHtml(item.unit)}</strong></td>
                    <td><strong style="color:${addNeed > 0 ? '#DC2626' : 'var(--rpt-text-mid)'}; font-weight:700;">${addNeed > 0 ? `+${addNeed.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${escapeHtml(item.unit)}` : `0 ${escapeHtml(item.unit)}`}</strong></td>
                    <td>${badge}</td>
                </tr>
            `;
        }).join("");
    }

    renderReportsPaginationBar({
        containerId: "fcPaginationBar",
        currentPage: state.fcPage,
        totalItems: filtered.length,
        pageSize: state.fcPageSize,
        onPageChange: (p) => {
            state.fcPage = p;
            renderAiForecastingTab();
        }
    });
}

/* ==========================================================
   UPDATE PRINT DOC HTML IN DOM
   ========================================================== */

function updatePrintDocHtml(tabToPrint = (state.activeTab || "manager")) {
    const printDoc = document.getElementById("continuousPrintDoc");
    if (!printDoc) return;
    const sections = Array.isArray(tabToPrint) ? tabToPrint : [tabToPrint || state.activeTab || "manager"];
    printDoc.innerHTML = buildContinuousPrintHtml(sections);
}

/* ==========================================================
   PRINT / PDF CONTINUOUS DOCUMENT BUILDER (IMAGE 2 EXACT FORMAT)
   ========================================================== */

/* ==========================================================
   PRINT / PDF CONTINUOUS DOCUMENT BUILDER (OFFICIAL RMSME TEMPLATE)
   ========================================================== */

function buildContinuousPrintHtml(selectedSections = [state.activeTab || "manager"]) {
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    const reportTypeStr = formatPeriodTypeLabel(state.periodPreset);
    const now = new Date();
    const genDateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTimeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const docRefCode = `RMSME-RPT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    const isSingleTab = selectedSections.length === 1;
    const scopeTitle = isSingleTab 
        ? `${getActiveTabDisplayName(selectedSections[0])} (${reportTypeStr} Snapshot)`
        : `Operational Report Package (${selectedSections.length} Sections)`;

    const reportTitle = isSingleTab 
        ? `${getActiveTabDisplayName(selectedSections[0])} Report`
        : `Manager Summary Report`;

    const targetMaterialLabel = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? (state.selectedMaterialName || "Selected Material")
        : "All Catalog Raw Materials";

    let filterContext = "All items in preview";
    if (isSingleTab) {
        const tabKey = selectedSections[0];
        if (tabKey === "inventory") {
            const parts = [];
            if (state.invSearch && state.invSearch.trim()) parts.push(`Search: "${state.invSearch.trim()}"`);
            if (state.invStatus && state.invStatus !== "all") parts.push(`Status: ${state.invStatus}`);
            if (parts.length) filterContext = parts.join(" | ");
        } else if (tabKey === "receiving") {
            if (state.rcvSearch && state.rcvSearch.trim()) filterContext = `Search: "${state.rcvSearch.trim()}"`;
        } else if (tabKey === "disbursement") {
            if (state.disbSearch && state.disbSearch.trim()) filterContext = `Search: "${state.disbSearch.trim()}"`;
        } else if (tabKey === "activity") {
            const parts = [];
            if (state.actSearch && state.actSearch.trim()) parts.push(`Search: "${state.actSearch.trim()}"`);
            if (state.actType && state.actType !== "all") parts.push(`Type: ${state.actType}`);
            if (parts.length) filterContext = parts.join(" | ");
        } else if (tabKey === "restock") {
            const chkCrit = document.getElementById("chkRestockCrit")?.checked;
            const chkMed = document.getElementById("chkRestockMed")?.checked;
            const chkGood = document.getElementById("chkRestockGood")?.checked;
            const pList = [];
            if (chkCrit) pList.push("High");
            if (chkMed) pList.push("Medium");
            if (chkGood) pList.push("Healthy");
            filterContext = pList.length > 0 ? `Priorities: ${pList.join(", ")}` : "All Restock Priorities";
        } else if (tabKey === "consumption") {
            if (state.cnsSearch && state.cnsSearch.trim()) filterContext = `Search: "${state.cnsSearch.trim()}"`;
        } else if (tabKey === "forecasting") {
            const parts = [];
            if (state.fcSearch && state.fcSearch.trim()) parts.push(`Search: "${state.fcSearch.trim()}"`);
            if (state.fcStatus && state.fcStatus !== "all") parts.push(`Status: ${state.fcStatus}`);
            if (parts.length) filterContext = parts.join(" | ");
        }
    }

    let sectionsHtml = "";

    // 1. FIRST CARD: Manager Summary
    if (selectedSections.includes("manager")) {
        const periodReceipts = state.receipts.filter(r => 
            withinRange(r.receiptDate, state.startDate, state.endDate) &&
            (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
        );
        const periodDisbursements = state.disbursements.filter(d => 
            withinRange(d.usageDate, state.startDate, state.endDate) &&
            (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
        );
        const totalMats = targetMaterials.length;
        const goodStock = targetMaterials.filter(m => m.status === "Good").length;
        const attentionStock = targetMaterials.filter(m => m.status === "Low" || m.status === "Critical").length;

        const decisions = [];
        targetMaterials.forEach(m => {
            if (m.status === "Critical") {
                decisions.push({
                    priority: "High",
                    material: m.name,
                    finding: `Stock reached critical threshold (${m.currentStock} ${m.unit} vs min ${m.minThreshold} ${m.unit}).`,
                    action: `Create urgent purchase receipt for ${m.reorderQty || 50} ${m.unit}.`
                });
            } else if (m.status === "Low") {
                decisions.push({
                    priority: "Medium",
                    material: m.name,
                    finding: `Stock is approaching minimum safety limit (${m.currentStock} ${m.unit} vs min ${m.minThreshold} ${m.unit}).`,
                    action: `Schedule replenishment order with primary supplier.`
                });
            }
        });

        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Executive Operational Metrics</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width: 60%;">Operational Metric</th>
                            <th style="width: 40%;">Result / Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td>Registered Raw Materials</td><td><strong>${totalMats}</strong> materials</td></tr>
                        <tr><td>Good Stock Balance</td><td><span style="color:#059669; font-weight:700;">${goodStock}</span> items</td></tr>
                        <tr><td>Requires Restock / Attention</td><td><span style="color:${attentionStock > 0 ? '#DC2626' : '#64748B'}; font-weight:700;">${attentionStock}</span> items</td></tr>
                        <tr><td>Total Periodic Inbound Receipts</td><td><strong>${periodReceipts.length}</strong> deliveries</td></tr>
                        <tr><td>Total Periodic Disbursements</td><td><strong>${periodDisbursements.length}</strong> batches</td></tr>
                    </tbody>
                </table>

                <h3 class="print-section-title" style="margin-top: 14px;">Strategic Decision Breakdown</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width: 14%;">Priority</th>
                            <th style="width: 22%;">Raw Material</th>
                            <th style="width: 32%;">What the Data Shows</th>
                            <th style="width: 32%;">Suggested Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${decisions.length === 0 ? `
                            <tr>
                                <td>Stable</td>
                                <td>All Items</td>
                                <td>No items currently require urgent intervention.</td>
                                <td>Continue standard monitoring.</td>
                            </tr>
                        ` :
                            decisions.map(d => `
                                <tr>
                                    <td><strong style="color:${d.priority === 'High' ? '#DC2626' : '#D97706'};">${escapeHtml(d.priority)}</strong></td>
                                    <td><strong>${escapeHtml(d.material)}</strong></td>
                                    <td>${escapeHtml(d.finding)}</td>
                                    <td>${escapeHtml(d.action)}</td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 2. Restock Recommendations (Action Guide)
    if (selectedSections.includes("restock")) {
        const restockData = getFilteredRecordsForPreviewTab("restock");
        const listToPrint = restockData.records;

        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Restock Priority &amp; Action Schedule</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Priority</th>
                            <th>Raw Material</th>
                            <th>Item Code</th>
                            <th>Current Stock</th>
                            <th>Min Threshold</th>
                            <th>Suggested Action</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${listToPrint.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">All raw material stock levels are currently healthy and adequate.</td></tr>` :
                            listToPrint.map(m => `
                                <tr>
                                    <td><strong style="color:${m.status === 'Critical' ? '#DC2626' : (m.status === 'Low' ? '#D97706' : '#059669')}">${escapeHtml(m.priority)}</strong></td>
                                    <td><strong>${escapeHtml(m.material)}</strong></td>
                                    <td><span style="font-family:'Inter', sans-serif; font-weight:600; color:#475569;">${escapeHtml(m.itemCode)}</span></td>
                                    <td>${escapeHtml(m.stock)}</td>
                                    <td>${escapeHtml(m.threshold)}</td>
                                    <td><span style="color:#2563EB; font-weight:600;">${escapeHtml(m.action)}</span></td>
                                    <td><strong style="color:${m.status === 'Good' ? '#059669' : (m.status === 'Low' ? '#D97706' : '#DC2626')}">${escapeHtml(m.status)}</strong></td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 3. Inventory Records
    if (selectedSections.includes("inventory")) {
        const invData = getFilteredRecordsForPreviewTab("inventory");
        const displayItems = isSingleTab ? invData.records : invData.records.slice(0, 15);

        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Raw Material Inventory Valuation &amp; Stock Records</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Raw Material</th>
                            <th>Item Code</th>
                            <th>Unit</th>
                            <th>Current Stock</th>
                            <th>Min Threshold</th>
                            <th>Reorder Qty</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${displayItems.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">No raw materials found matching current parameters.</td></tr>` :
                            displayItems.map(m => `
                                <tr>
                                    <td><strong>${escapeHtml(m.name)}</strong></td>
                                    <td><span style="font-family:'Inter', sans-serif; font-weight:600; color:#475569;">${escapeHtml(m.itemCode)}</span></td>
                                    <td>${escapeHtml(m.unit)}</td>
                                    <td><strong>${m.currentStock.toLocaleString()}</strong></td>
                                    <td>${m.minThreshold.toLocaleString()}</td>
                                    <td>${m.reorderQty.toLocaleString()}</td>
                                    <td><strong style="color:${m.status === 'Good' ? '#059669' : (m.status === 'Low' ? '#D97706' : '#DC2626')}">${escapeHtml(m.status)}</strong></td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 4. Material Inbound Receipts
    if (selectedSections.includes("receiving")) {
        const rcvData = getFilteredRecordsForPreviewTab("receiving");
        const displayReceipts = isSingleTab ? rcvData.records : rcvData.records.slice(0, 15);

        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Material Receiving Verified Log</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width:16%;">Receipt Date</th>
                            <th style="width:24%;">Raw Material</th>
                            <th style="width:18%;">Received Qty</th>
                            <th style="width:24%;">Supplier Name</th>
                            <th style="width:18%;">Received By</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${displayReceipts.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">No inward delivery receipts recorded for this period.</td></tr>` :
                            displayReceipts.map(r => `
                                <tr>
                                    <td>${escapeHtml(r.receiptDate)}</td>
                                    <td><strong>${escapeHtml(r.materialName)}</strong></td>
                                    <td><strong style="color:#059669;">+${(r.receivedQuantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> ${escapeHtml(r.unit || "")}</td>
                                    <td>${escapeHtml(r.supplierName || "—")}</td>
                                    <td>${escapeHtml(r.receivedBy || "Verified")}</td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 5. Material Disbursements
    if (selectedSections.includes("disbursement")) {
        const disbData = getFilteredRecordsForPreviewTab("disbursement");
        const displayDisbs = isSingleTab ? disbData.records : disbData.records.slice(0, 15);

        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Production Material Disbursement Log</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width:14%;">Usage Date</th>
                            <th style="width:24%;">Raw Material</th>
                            <th style="width:24%;">Finished Product / Batch</th>
                            <th style="width:18%;">Disbursed Qty</th>
                            <th style="width:20%;">Recorded By</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${displayDisbs.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">No production disbursements recorded for this period.</td></tr>` :
                            displayDisbs.map(d => `
                                <tr>
                                    <td>${escapeHtml(d.usageDate)}</td>
                                    <td><strong>${escapeHtml(d.materialName)}</strong></td>
                                    <td>${escapeHtml(d.finishedProduct || "Production Batch")}</td>
                                    <td><strong style="color:#DC2626;">-${(d.disbursedQuantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> ${escapeHtml(d.unit || "")}</td>
                                    <td>${escapeHtml(d.recordedBy || "Manager")}</td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 6. Material Activity Audit Ledger
    if (selectedSections.includes("activity")) {
        const actData = getFilteredRecordsForPreviewTab("activity");
        const displayActs = isSingleTab ? actData.records : actData.records.slice(0, 20);

        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Chronological Material Activity Movement Log</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width:14%;">Date</th>
                            <th style="width:14%;">Activity</th>
                            <th style="width:24%;">Raw Material</th>
                            <th style="width:16%;">Net Quantity</th>
                            <th style="width:18%;">Reference / Batch</th>
                            <th style="width:14%;">Operator</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${displayActs.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">No stock movements recorded for this period.</td></tr>` :
                            displayActs.map(a => `
                                <tr>
                                    <td>${escapeHtml(a.date)}</td>
                                    <td><span style="font-weight:700; color:${a.type === 'Received' ? '#059669' : '#DC2626'};">${escapeHtml(a.type)}</span></td>
                                    <td><strong>${escapeHtml(a.material)}</strong></td>
                                    <td><strong style="color:${a.qty > 0 ? '#059669' : '#DC2626'};">${a.qty > 0 ? "+" : ""}${(a.qty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> ${escapeHtml(a.unit || "")}</td>
                                    <td>${escapeHtml(a.ref || "—")}</td>
                                    <td>${escapeHtml(a.operator || "Manager")}</td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 7. Consumption Highlights
    if (selectedSections.includes("consumption")) {
        const cnsData = getFilteredRecordsForPreviewTab("consumption");
        const topConsumed = isSingleTab ? cnsData.records : cnsData.records.slice(0, 10);

        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Material Consumption Analysis &amp; Usage Trends</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Raw Material</th>
                            <th>Period Usage</th>
                            <th>Prior Period Usage</th>
                            <th>Current Stock</th>
                            <th>Usage Trend</th>
                            <th>Stock Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topConsumed.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">No material consumption recorded for this period.</td></tr>` :
                            topConsumed.map(m => `
                                <tr>
                                    <td><strong>${escapeHtml(m.name)}</strong></td>
                                    <td><strong>${(m.periodUsage || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> ${escapeHtml(m.unit)}</td>
                                    <td>${(m.priorUsage || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHtml(m.unit)}</td>
                                    <td>${(m.currentStock || 0).toLocaleString()} ${escapeHtml(m.unit)}</td>
                                    <td><span style="font-weight:600; color:${m.trend === 'increasing' ? '#DC2626' : (m.trend === 'decreasing' ? '#059669' : '#475569')}">${escapeHtml(m.trendText || m.trend)}</span></td>
                                    <td><strong style="color:${m.status === 'Good' ? '#059669' : (m.status === 'Low' ? '#D97706' : '#DC2626')}">${escapeHtml(m.status)}</strong></td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 8. AI Forecasting
    if (selectedSections.includes("forecasting")) {
        const fcData = getFilteredRecordsForPreviewTab("forecasting");
        const fcRecords = isSingleTab ? fcData.records : fcData.records.slice(0, 15);
        const isMonthly = state.fcHorizon === "1m";

        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">AI Forecasted Requirements &amp; Deficit Projections</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Raw Material</th>
                            <th>Item Code</th>
                            <th>Product Context</th>
                            <th>Current Stock</th>
                            <th>Projected Req (${isMonthly ? "30D" : "7D"})</th>
                            <th>Additional Needed</th>
                            <th>Stock Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${fcRecords.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">No forecasting projections recorded in the system.</td></tr>` :
                            fcRecords.map(f => {
                                const addNeeded = isMonthly ? f.additionalNeed1m : f.additionalNeed7;
                                return `
                                    <tr>
                                        <td><strong>${escapeHtml(f.name)}</strong></td>
                                        <td><span style="font-family:'Inter', sans-serif; font-weight:600; color:#475569;">${escapeHtml(f.itemCode)}</span></td>
                                        <td>${escapeHtml(f.finishedProduct || "—")}</td>
                                        <td>${(f.currentStock || 0).toLocaleString()} ${escapeHtml(f.unit)}</td>
                                        <td><strong>${(isMonthly ? (f.forecast1Month || 0) : (f.forecast7Day || 0)).toFixed(1)}</strong> ${escapeHtml(f.unit)}</td>
                                        <td><strong style="color:${addNeeded > 0 ? '#DC2626' : '#059669'};">${addNeeded > 0 ? "+" + addNeeded.toFixed(1) : "0"}</strong> ${escapeHtml(f.unit)}</td>
                                        <td><strong style="color:${(f.status === 'Out of Stock' || f.currentStock <= 0) ? '#DC2626' : ((f.status === 'Low Stock' || f.currentStock <= f.minThreshold) ? '#D97706' : '#059669')}">${escapeHtml(f.status || 'Good')}</strong></td>
                                    </tr>
                                `;
                            }).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // Verification & Audit Sign-Off
    return `
        <!-- PRINT DOCUMENT TABLE WRAPPER (MATCHING IMAGE 1 TEMPLATE) -->
        <table class="print-page-table-wrapper">
            <thead>
                <tr>
                    <th class="print-watermark-th">
                        <div class="print-page-watermark-box" aria-hidden="true">
                            <div class="print-watermark-inner">
                                <div class="print-watermark-text-primary">RMSME OFFICIAL REPORT</div>
                                <div class="print-watermark-text-secondary">PREVENT FAKE COPY • SYSTEM VERIFIED</div>
                            </div>
                        </div>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>
                        <!-- 1. HEADER (Left: RMSME + Subtitle, Right: Generated + Doc Ref) -->
                        <div class="print-header-row">
                            <div class="print-header-left">
                                <div class="print-brand-name">RMSME</div>
                                <div class="print-brand-desc">RAW MATERIAL STOCK MANAGEMENT &amp; FORECASTING ENTERPRISE</div>
                            </div>
                            <div class="print-header-right">
                                Generated: ${genDateStr} at ${genTimeStr} &nbsp;|&nbsp; Doc Ref: ${docRefCode}
                            </div>
                        </div>
                        <div class="print-header-divider"></div>

                        <!-- 2. DOCUMENT TITLE (Matches Image 1) -->
                        <h2 class="print-document-title">${escapeHtml(reportTitle)}</h2>

                        <!-- 3. METADATA GRID (Clean 2 Columns, No Box, Matches Image 1) -->
                        <div class="print-meta-grid">
                            <div class="print-meta-col">
                                <div class="print-meta-group">
                                    <span class="print-meta-label">REPORT HORIZON</span>
                                    <span class="print-meta-value">${escapeHtml(periodLabel)}</span>
                                </div>
                                <div class="print-meta-group">
                                    <span class="print-meta-label">MATERIAL SCOPE</span>
                                    <span class="print-meta-value">${escapeHtml(targetMaterialLabel)}</span>
                                </div>
                                <div class="print-meta-group">
                                    <span class="print-meta-label">ACTIVE FILTER</span>
                                    <span class="print-meta-value">${escapeHtml(filterContext)}</span>
                                </div>
                            </div>
                            <div class="print-meta-col">
                                <div class="print-meta-group">
                                    <span class="print-meta-label">GENERATED AT</span>
                                    <span class="print-meta-value">${genDateStr} ${genTimeStr}</span>
                                </div>
                                <div class="print-meta-group">
                                    <span class="print-meta-label">SCOPE INCLUSION</span>
                                    <span class="print-meta-value">Preview Filter Active Tab Only</span>
                                </div>
                                <div class="print-meta-group">
                                    <span class="print-meta-label">SOURCE DATABASE</span>
                                    <span class="print-meta-value">RMSME Authoritative PostgreSQL Database</span>
                                </div>
                            </div>
                        </div>
                        <div class="print-meta-divider"></div>

                        <!-- 4. REPORT SECTIONS -->
                        ${sectionsHtml}
                    </td>
                </tr>
            </tbody>
            <tfoot>
                <tr>
                    <td>
                        <!-- 5. FOOTER (Matches Image 1) -->
                        <div class="print-footer-container">
                            <div class="print-footer-row">
                                <span class="print-footer-brand">RMSME &mdash; Raw Material Stock Management &amp; Enterprise Forecasting System</span>
                                <span class="print-footer-page">Page 1 of 1</span>
                            </div>
                            <div class="print-footer-sub">
                                System Support: support@rmsme.internal | Hotline: (02) 8876-RMSME | Official System Generated Copy &mdash; Anti-Tamper Protected
                            </div>
                        </div>
                    </td>
                </tr>
            </tfoot>
        </table>
    `;
}

/* ==========================================================
   EXPORT PDF & EXCEL GENERATION (MATCHING OFFICIAL RMSME TEMPLATE)
   ========================================================== */

const RM_GREEN = [5, 150, 105];
const RM_INK = [15, 23, 42];
const RM_DIM = [100, 116, 139];

function getActiveTabDisplayName(tabKey) {
    const names = {
        manager: "Manager Summary",
        restock: "Restock Recommendations",
        inventory: "Inventory Records",
        receiving: "Material Receiving",
        disbursement: "Material Disbursement",
        activity: "Material Activity",
        consumption: "Consumption Analysis",
        forecasting: "AI Forecasting"
    };
    return names[tabKey] || "Current Report";
}

function getFilteredRecordsForPreviewTab(tabKey) {
    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    const periodReceipts = state.receipts.filter(r => 
        withinRange(r.receiptDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
    );

    const periodDisbursements = state.disbursements.filter(d => 
        withinRange(d.usageDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
    );

    if (tabKey === "inventory") {
        const term = (state.invSearch || "").trim().toLowerCase();
        const status = state.invStatus || "all";
        let filtered = targetMaterials.filter(m => {
            if (term && !m.name.toLowerCase().includes(term) && !m.itemCode.toLowerCase().includes(term)) return false;
            if (status !== "all" && m.status !== status) return false;
            return true;
        });
        if (state.invSort === "oldest") filtered = [...filtered].reverse();
        else if (state.invSort === "az") filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        else if (state.invSort === "za") filtered.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
        else if (state.invSort === "high_stock") filtered.sort((a, b) => (b.currentStock || 0) - (a.currentStock || 0));
        else if (state.invSort === "low_stock") filtered.sort((a, b) => (a.currentStock || 0) - (b.currentStock || 0));
        return { type: "inventory", records: filtered };
    }

    if (tabKey === "receiving") {
        const term = (state.rcvSearch || "").trim().toLowerCase();
        let filtered = [...periodReceipts];
        if (term) {
            filtered = filtered.filter(r => 
                (r.materialName || "").toLowerCase().includes(term) || 
                (r.supplierName || "").toLowerCase().includes(term) || 
                (r.receivedBy || "").toLowerCase().includes(term)
            );
        }
        if (state.rcvSort === "oldest") filtered.sort((a, b) => (a.receiptDate || "").localeCompare(b.receiptDate || ""));
        else if (state.rcvSort === "az") filtered.sort((a, b) => (a.materialName || "").localeCompare(b.materialName || ""));
        else if (state.rcvSort === "za") filtered.sort((a, b) => (b.materialName || "").localeCompare(a.materialName || ""));
        else if (state.rcvSort === "highest") filtered.sort((a, b) => (b.receivedQuantity || 0) - (a.receivedQuantity || 0));
        else filtered.sort((a, b) => (b.receiptDate || "").localeCompare(a.receiptDate || ""));
        return { type: "receiving", records: filtered };
    }

    if (tabKey === "disbursement") {
        const term = (state.disbSearch || "").trim().toLowerCase();
        let filtered = [...periodDisbursements];
        if (term) {
            filtered = filtered.filter(d => 
                (d.materialName || "").toLowerCase().includes(term) || 
                (d.finishedProduct || "").toLowerCase().includes(term) || 
                (d.activityType || "").toLowerCase().includes(term) ||
                (d.recordedBy || "").toLowerCase().includes(term)
            );
        }
        if (state.disbSort === "oldest") filtered.sort((a, b) => (a.usageDate || "").localeCompare(b.usageDate || ""));
        else if (state.disbSort === "az") filtered.sort((a, b) => (a.materialName || "").localeCompare(b.materialName || ""));
        else if (state.disbSort === "za") filtered.sort((a, b) => (b.materialName || "").localeCompare(a.materialName || ""));
        else if (state.disbSort === "highest") filtered.sort((a, b) => (b.disbursedQuantity || 0) - (a.disbursedQuantity || 0));
        else filtered.sort((a, b) => (b.usageDate || "").localeCompare(a.usageDate || ""));
        return { type: "disbursement", records: filtered };
    }

    if (tabKey === "activity") {
        const activities = [];
        periodReceipts.forEach(r => {
            activities.push({
                date: r.receiptDate,
                type: "Received",
                material: r.materialName,
                qty: r.receivedQuantity,
                unit: r.unit,
                ref: r.supplierName,
                operator: r.receivedBy
            });
        });
        periodDisbursements.forEach(d => {
            activities.push({
                date: d.usageDate,
                type: "Disbursed",
                material: d.materialName,
                qty: -d.disbursedQuantity,
                unit: d.unit,
                ref: d.finishedProduct,
                operator: d.recordedBy
            });
        });
        if (state.actSort === "oldest") activities.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
        else if (state.actSort === "az") activities.sort((a, b) => (a.material || "").localeCompare(b.material || ""));
        else if (state.actSort === "za") activities.sort((a, b) => (b.material || "").localeCompare(a.material || ""));
        else activities.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

        const term = (state.actSearch || "").trim().toLowerCase();
        const typeFilter = state.actType || "all";
        let filtered = activities.filter(a => {
            if (term && !a.material.toLowerCase().includes(term) && !a.ref.toLowerCase().includes(term) && !a.operator.toLowerCase().includes(term)) return false;
            if (typeFilter !== "all" && a.type !== typeFilter) return false;
            return true;
        });
        return { type: "activity", records: filtered };
    }

    if (tabKey === "restock") {
        const chkCrit = document.getElementById("chkRestockCrit");
        const chkMed = document.getElementById("chkRestockMed");
        const chkGood = document.getElementById("chkRestockGood");
        const showCrit = chkCrit ? chkCrit.checked : true;
        const showMed = chkMed ? chkMed.checked : true;
        const showGood = chkGood ? chkGood.checked : false;

        if (!showCrit && !showMed && !showGood) {
            return { type: "restock", records: [] };
        }

        const items = [];
        targetMaterials.forEach(m => {
            if (m.status === "Critical" && showCrit) {
                items.push({
                    priority: "High Priority",
                    material: m.name,
                    itemCode: m.itemCode,
                    stock: `${(m.currentStock || 0).toLocaleString()} ${m.unit}`,
                    threshold: `${(m.minThreshold || 0).toLocaleString()} ${m.unit}`,
                    action: `Order ${(m.reorderQty || 50).toLocaleString()} ${m.unit} immediately.`,
                    status: m.status
                });
            } else if (m.status === "Low" && showMed) {
                items.push({
                    priority: "Medium Priority",
                    material: m.name,
                    itemCode: m.itemCode,
                    stock: `${(m.currentStock || 0).toLocaleString()} ${m.unit}`,
                    threshold: `${(m.minThreshold || 0).toLocaleString()} ${m.unit}`,
                    action: `Prepare order for ${(m.reorderQty || 50).toLocaleString()} ${m.unit}.`,
                    status: m.status
                });
            } else if (m.status === "Good" && showGood) {
                items.push({
                    priority: "Healthy Buffer",
                    material: m.name,
                    itemCode: m.itemCode,
                    stock: `${(m.currentStock || 0).toLocaleString()} ${m.unit}`,
                    threshold: `${(m.minThreshold || 0).toLocaleString()} ${m.unit}`,
                    action: `Stock sufficient. No restock needed.`,
                    status: m.status
                });
            }
        });
        return { type: "restock", records: items };
    }

    if (tabKey === "consumption") {
        const curMap = new Map();
        periodDisbursements.forEach(d => curMap.set(d.materialId, (curMap.get(d.materialId) || 0) + d.disbursedQuantity));
        const days = Math.round((state.endDate - state.startDate) / 86400000) + 1;
        const prevEnd = addDays(state.startDate, -1);
        const prevStart = addDays(prevEnd, -(days - 1));
        const prevDisbursements = state.disbursements.filter(d => 
            withinRange(d.usageDate, prevStart, prevEnd) &&
            (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
        );
        const prevMap = new Map();
        prevDisbursements.forEach(d => prevMap.set(d.materialId, (prevMap.get(d.materialId) || 0) + d.disbursedQuantity));

        const term = (state.cnsSearch || "").trim().toLowerCase();
        let list = targetMaterials.map(m => {
            const curUsage = curMap.get(m.id) || 0;
            const prevUsage = prevMap.get(m.id) || 0;
            let trend = "Stable";
            if (prevUsage === 0 && curUsage > 0) trend = "Increasing";
            else if (curUsage >= prevUsage * 1.15) trend = "Increasing";
            else if (curUsage <= prevUsage * 0.85 && curUsage > 0) trend = "Decreasing";

            return {
                material: m.name,
                itemCode: m.itemCode,
                unit: m.unit,
                currentUsage: curUsage,
                previousUsage: prevUsage,
                currentStock: m.currentStock,
                trend,
                status: m.status
            };
        });

        if (term) list = list.filter(l => l.material.toLowerCase().includes(term) || (l.itemCode || "").toLowerCase().includes(term));
        if (state.cnsSort === "oldest") list = [...list].reverse();
        else if (state.cnsSort === "az") list.sort((a, b) => (a.material || "").localeCompare(b.material || ""));
        else if (state.cnsSort === "za") list.sort((a, b) => (b.material || "").localeCompare(a.material || ""));
        else if (state.cnsSort === "high_consumed") list.sort((a, b) => (b.currentUsage || 0) - (a.currentUsage || 0));
        else if (state.cnsSort === "low_consumed") list.sort((a, b) => (a.currentUsage || 0) - (b.currentUsage || 0));

        return { type: "consumption", records: list };
    }

    if (tabKey === "forecasting") {
        const isMonthly = state.fcHorizon === "1month";
        const targetForecasts = (state.selectedMaterialId && state.selectedMaterialId !== "all")
            ? state.forecastList.filter(item => item.id === state.selectedMaterialId || item.itemCode === state.selectedMaterialId || (state.materials.find(m => m.id === state.selectedMaterialId)?.name === item.name))
            : state.forecastList;

        const term = (state.fcSearch || "").trim().toLowerCase();
        const unitFilter = state.fcUnit || "all";
        const statusFilter = state.fcStatus || "all";

        let filtered = targetForecasts.filter(item => {
            if (term) {
                const matchName = (item.name || "").toLowerCase().includes(term);
                const matchCode = (item.itemCode || "").toLowerCase().includes(term);
                const matchProduct = (item.finishedProduct || "").toLowerCase().includes(term);
                if (!matchName && !matchCode && !matchProduct) return false;
            }
            if (unitFilter !== "all" && item.unit !== unitFilter) return false;

            const addNeed = isMonthly ? item.additionalNeed1m : item.additionalNeed7;
            if (statusFilter === "Sufficient" && (addNeed > 0 || item.status === "Potential Shortage" || item.status === "Needs Attention" || item.status === "Low Stock Attention")) return false;
            if (statusFilter === "Monitor" && item.status !== "Monitor") return false;
            if (statusFilter === "Needs Attention" && item.status !== "Needs Attention" && item.status !== "Low Stock Attention" && item.currentStock > item.minThreshold) return false;
            if (statusFilter === "Potential Shortage" && addNeed === 0 && item.status !== "Potential Shortage") return false;

            return true;
        });

        return { type: "forecasting", records: filtered, isMonthly };
    }

    // Default: 'manager'
    const goodStock = targetMaterials.filter(m => m.status === "Good").length;
    const attentionStock = targetMaterials.filter(m => m.status === "Low" || m.status === "Critical").length;
    const decisions = [];
    targetMaterials.forEach(m => {
        if (m.status === "Critical") {
            decisions.push({ priority: "High Priority", material: m.name, finding: `Critical stock: ${m.currentStock} ${m.unit} (below threshold of ${m.minThreshold} ${m.unit})`, action: `Place urgent order for ${m.reorderQty || 50} ${m.unit}` });
        } else if (m.status === "Low") {
            decisions.push({ priority: "Medium Priority", material: m.name, finding: `Low stock buffer: ${m.currentStock} ${m.unit} (below threshold of ${m.minThreshold} ${m.unit})`, action: `Prepare next procurement batch.` });
        }
    });

    return {
        type: "manager",
        summaryMetrics: [
            ["Registered Raw Materials", `${targetMaterials.length} materials`],
            ["Good Stock Balance", `${goodStock} items`],
            ["Requires Restock / Attention", `${attentionStock} items`],
            ["Total Periodic Inbound Receipts", `${periodReceipts.length} deliveries`],
            ["Total Periodic Disbursements", `${periodDisbursements.length} batches`]
        ],
        decisions
    };
}

function generateSingleTabPdf(tabKey = "manager") {
    if (typeof window.jspdf === "undefined" || !window.jspdf.jsPDF) {
        showToast("PDF generation library is still loading. Please wait a moment and try again.", "error");
        return null;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    const reportTypeStr = formatPeriodTypeLabel(state.periodPreset);
    const now = new Date();
    const genDateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTimeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const docRef = `RMSME-TAB-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    let y = 36;

    // 1. RMSME Official Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...RM_GREEN);
    doc.text("RMSME", 40, y);

    doc.setFontSize(8);
    doc.setTextColor(...RM_DIM);
    doc.setFont("helvetica", "normal");
    doc.text("RAW MATERIAL STOCK MANAGEMENT & FORECASTING ENTERPRISE", 40, y + 13);

    doc.setFontSize(7.5);
    doc.text(`Generated: ${genDateStr} at ${genTimeStr}  |  Doc Ref: ${docRef}`, pageWidth - 40, y + 13, { align: "right" });

    y += 26;
    doc.setDrawColor(5, 150, 105);
    doc.setLineWidth(1.5);
    doc.line(40, y, pageWidth - 40, y);
    y += 18;

    // 2. Specific Report Title
    const activeTitle = getActiveTabDisplayName(tabKey);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...RM_INK);
    doc.text(`${activeTitle} Report`, 40, y);
    y += 16;

    // 3. Metadata Grid with Active Preview Filters
    const colW = (pageWidth - 80) / 2;
    const targetMaterialLabel = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? (state.selectedMaterialName || "Selected Material")
        : "All Catalog Raw Materials";

    let filterContext = "All items in preview";
    if (tabKey === "inventory") {
        const parts = [];
        if (state.invSearch.trim()) parts.push(`Search: "${state.invSearch.trim()}"`);
        if (state.invStatus !== "all") parts.push(`Status: ${state.invStatus}`);
        if (parts.length) filterContext = parts.join(" | ");
    } else if (tabKey === "receiving") {
        if (state.rcvSearch.trim()) filterContext = `Search: "${state.rcvSearch.trim()}"`;
    } else if (tabKey === "disbursement") {
        if (state.disbSearch.trim()) filterContext = `Search: "${state.disbSearch.trim()}"`;
    } else if (tabKey === "activity") {
        const parts = [];
        if (state.actSearch.trim()) parts.push(`Search: "${state.actSearch.trim()}"`);
        if (state.actType !== "all") parts.push(`Type: ${state.actType}`);
        if (parts.length) filterContext = parts.join(" | ");
    } else if (tabKey === "restock") {
        const chkCrit = document.getElementById("chkRestockCrit")?.checked;
        const chkMed = document.getElementById("chkRestockMed")?.checked;
        const chkGood = document.getElementById("chkRestockGood")?.checked;
        const pList = [];
        if (chkCrit) pList.push("High");
        if (chkMed) pList.push("Medium");
        if (chkGood) pList.push("Healthy");
        filterContext = pList.length > 0 ? `Priorities: ${pList.join(", ")}` : "None Selected (Empty View)";
    } else if (tabKey === "consumption") {
        if (state.cnsSearch.trim()) filterContext = `Search: "${state.cnsSearch.trim()}"`;
    } else if (tabKey === "forecasting") {
        const parts = [];
        if (state.fcSearch.trim()) parts.push(`Search: "${state.fcSearch.trim()}"`);
        if (state.fcStatus !== "all") parts.push(`Status: ${state.fcStatus}`);
        if (parts.length) filterContext = parts.join(" | ");
    }

    const leftCol = [
        ["REPORT HORIZON", periodLabel],
        ["MATERIAL SCOPE", targetMaterialLabel],
        ["ACTIVE FILTER", filterContext]
    ];
    const rightCol = [
        ["GENERATED AT", `${genDateStr} ${genTimeStr}`],
        ["SCOPE INCLUSION", "Preview Filter Active Tab Only"],
        ["SOURCE DATABASE", "RMSME Authoritative PostgreSQL Database"]
    ];

    let leftY = y, rightY = y;
    leftCol.forEach(row => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...RM_DIM);
        doc.text(row[0], 40, leftY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...RM_INK);
        doc.text(String(row[1]), 40, leftY + 10);
        leftY += 23;
    });

    rightCol.forEach(row => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...RM_DIM);
        doc.text(row[0], 40 + colW, rightY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...RM_INK);
        doc.text(String(row[1]), 40 + colW, rightY + 10);
        rightY += 23;
    });

    y = Math.max(leftY, rightY) + 2;
    doc.setDrawColor(220, 226, 236);
    doc.setLineWidth(1);
    doc.line(40, y, pageWidth - 40, y);
    y += 18;

    // 4. Data Table for ONLY this active tab with filtered data
    const filteredData = getFilteredRecordsForPreviewTab(tabKey);

    if (tabKey === "manager") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(...RM_GREEN);
        doc.text("Executive Operational Metrics", 40, y);
        y += 12;

        doc.autoTable({
            startY: y,
            head: [["Operational Metric", "Result / Count"]],
            body: filteredData.summaryMetrics,
            margin: { left: 40, right: 40 },
            styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
        });
        y = doc.lastAutoTable.finalY + 18;

        if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 48; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(...RM_GREEN);
        doc.text("Strategic Decision Breakdown", 40, y);
        y += 10;

        const decRows = filteredData.decisions.length === 0 
            ? [["Stable", "All Items", "No items currently require urgent intervention.", "Continue standard monitoring."]]
            : filteredData.decisions.map(d => [d.priority, d.material, d.finding, d.action]);

        doc.autoTable({
            startY: y,
            head: [["Priority", "Raw Material", "What the Data Shows", "Suggested Action"]],
            body: decRows,
            margin: { left: 40, right: 40 },
            styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
        });
    } else if (tabKey === "restock") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(...RM_GREEN);
        doc.text("Restock Priority & Action Schedule", 40, y);
        y += 10;

        const rows = filteredData.records.length === 0
            ? [["—", "No restock records match the active priority checklist", "—", "—", "—", "—"]]
            : filteredData.records.map(r => [r.priority, r.material, r.itemCode, r.stock, r.threshold, r.action]);

        doc.autoTable({
            startY: y,
            head: [["Priority", "Raw Material", "Item Code", "Current Stock", "Min Threshold", "Recommended Action"]],
            body: rows,
            margin: { left: 40, right: 40 },
            styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
        });
    } else if (tabKey === "inventory") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(...RM_GREEN);
        doc.text("Raw Material Inventory Valuation & Stock Records", 40, y);
        y += 10;

        const rows = filteredData.records.length === 0
            ? [["—", "No inventory materials match the search/filter criteria", "—", "—", "—", "—", "—"]]
            : filteredData.records.map(m => [
                m.name,
                m.itemCode,
                m.unit,
                `${(m.currentStock || 0).toLocaleString()}`,
                `${(m.minThreshold || 0).toLocaleString()}`,
                `${(m.reorderQty || 0).toLocaleString()}`,
                m.status
            ]);

        doc.autoTable({
            startY: y,
            head: [["Raw Material", "Item Code", "Unit", "Current Stock", "Min Threshold", "Reorder Qty", "Status"]],
            body: rows,
            margin: { left: 40, right: 40 },
            styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
        });
    } else if (tabKey === "receiving") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(...RM_GREEN);
        doc.text("Material Receiving Verified Log", 40, y);
        y += 10;

        const rows = filteredData.records.length === 0
            ? [["—", "No receiving records match the period / search filter", "—", "—", "—", "—"]]
            : filteredData.records.map(r => [
                r.receiptDate,
                r.materialName,
                `+${(r.receivedQuantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.unit}`,
                r.supplierName,
                r.receivedBy,
                "Verified"
            ]);

        doc.autoTable({
            startY: y,
            head: [["Receipt Date", "Raw Material", "Received Qty", "Supplier Name", "Received By", "Status"]],
            body: rows,
            margin: { left: 40, right: 40 },
            styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
        });
    } else if (tabKey === "disbursement") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(...RM_GREEN);
        doc.text("Production Material Disbursement Log", 40, y);
        y += 10;

        const rows = filteredData.records.length === 0
            ? [["—", "No disbursements match the period / search filter", "—", "—", "—", "—"]]
            : filteredData.records.map(d => [
                d.usageDate,
                d.materialName,
                d.finishedProduct,
                `-${(d.disbursedQuantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${d.unit}`,
                d.activityType,
                d.recordedBy
            ]);

        doc.autoTable({
            startY: y,
            head: [["Usage Date", "Raw Material", "Finished Product / Batch", "Disbursed Qty", "Activity Type", "Recorded By"]],
            body: rows,
            margin: { left: 40, right: 40 },
            styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
        });
    } else if (tabKey === "activity") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(...RM_GREEN);
        doc.text("Chronological Material Activity Movement Log", 40, y);
        y += 10;

        const rows = filteredData.records.length === 0
            ? [["—", "No activity transactions match the filter", "—", "—", "—", "—"]]
            : filteredData.records.map(a => [
                a.date,
                a.type,
                a.material,
                a.type === "Received" ? `+${(a.qty || 0).toLocaleString()} ${a.unit}` : `${(a.qty || 0).toLocaleString()} ${a.unit}`,
                a.ref,
                a.operator
            ]);

        doc.autoTable({
            startY: y,
            head: [["Date", "Activity", "Raw Material", "Net Quantity", "Reference / Batch", "Operator"]],
            body: rows,
            margin: { left: 40, right: 40 },
            styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
        });
    } else if (tabKey === "consumption") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(...RM_GREEN);
        doc.text("Material Consumption Analysis & Usage Trends", 40, y);
        y += 10;

        const rows = filteredData.records.length === 0
            ? [["—", "No consumption records match the filter", "—", "—", "—", "—"]]
            : filteredData.records.map(c => [
                c.material,
                `${(c.currentUsage || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c.unit}`,
                `${(c.previousUsage || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c.unit}`,
                `${(c.currentStock || 0).toLocaleString()} ${c.unit}`,
                c.trend,
                c.status
            ]);

        doc.autoTable({
            startY: y,
            head: [["Raw Material", "Period Usage", "Prior Period Usage", "Current Stock", "Usage Trend", "Stock Status"]],
            body: rows,
            margin: { left: 40, right: 40 },
            styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
        });
    } else if (tabKey === "forecasting") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(...RM_GREEN);
        doc.text("AI Forecasted Requirements & Deficit Projections", 40, y);
        y += 10;

        const isMonthly = filteredData.isMonthly;
        const rows = filteredData.records.length === 0
            ? [["—", "No forecasting records match the filter", "—", "—", "—", "—", "—"]]
            : filteredData.records.map(f => [
                f.name,
                f.itemCode,
                f.finishedProduct,
                `${(f.currentStock || 0).toLocaleString()} ${f.unit}`,
                isMonthly ? `${(f.forecast1Month || 0).toFixed(1)} ${f.unit}` : `${(f.forecast7Day || 0).toFixed(1)} ${f.unit}`,
                (isMonthly ? f.additionalNeed1m : f.additionalNeed7) > 0 ? `+${(isMonthly ? f.additionalNeed1m : f.additionalNeed7).toFixed(1)} ${f.unit}` : "0",
                f.status || "Sufficient"
            ]);

        doc.autoTable({
            startY: y,
            head: [["Raw Material", "Item Code", "Product Context", "Current Stock", `Projected Req (${isMonthly ? "30D" : "7D"})`, "Additional Needed", "Status"]],
            body: rows,
            margin: { left: 40, right: 40 },
            styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
        });
    }

    // 5. Watermark & Footer Across All Pages (Matching Image 1)
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.saveGraphicsState();
        doc.setTextColor(226, 232, 240);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(32);
        doc.text("RMSME OFFICIAL REPORT", pageWidth / 2, doc.internal.pageSize.getHeight() / 2 - 12, {
            align: "center",
            angle: 35
        });
        doc.setFontSize(13);
        doc.setTextColor(236, 240, 246);
        doc.text("PREVENT FAKE COPY • SYSTEM VERIFIED", pageWidth / 2, doc.internal.pageSize.getHeight() / 2 + 18, {
            align: "center",
            angle: 35
        });
        doc.restoreGraphicsState();

        doc.setDrawColor(5, 150, 105);
        doc.setLineWidth(1);
        doc.line(40, doc.internal.pageSize.getHeight() - 34, pageWidth - 40, doc.internal.pageSize.getHeight() - 34);

        doc.setFontSize(7.5);
        doc.setTextColor(...RM_INK);
        doc.setFont("helvetica", "bold");
        doc.text("RMSME — Raw Material Stock Management & Enterprise Forecasting System", 40, doc.internal.pageSize.getHeight() - 22);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(...RM_DIM);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 40, doc.internal.pageSize.getHeight() - 22, { align: "right" });

        doc.setFontSize(6.8);
        doc.text("System Support: support@rmsme.internal | Hotline: (02) 8876-RMSME | Official System Generated Copy — Anti-Tamper Protected", 40, doc.internal.pageSize.getHeight() - 12);
    }

    return doc;
}

function generateSingleTabExcelBlob(tabKey = "manager") {
    if (typeof XLSX === "undefined") {
        showToast("Excel export library is loading. Please try again.", "error");
        return null;
    }
    const wb = XLSX.utils.book_new();
    const activeTitle = getActiveTabDisplayName(tabKey);
    const filteredData = getFilteredRecordsForPreviewTab(tabKey);

    let rows = [];
    let sheetName = activeTitle;

    if (tabKey === "manager") {
        sheetName = "Manager Summary";
        rows = [
            ["Metric", "Result / Value"],
            ...filteredData.summaryMetrics,
            [],
            ["Priority", "Raw Material", "Finding", "Suggested Action"],
            ...(filteredData.decisions.length === 0 ? [["Stable", "All Items", "No items require urgent attention", "Continue monitoring"]] : filteredData.decisions.map(d => [d.priority, d.material, d.finding, d.action]))
        ];
    } else if (tabKey === "restock") {
        sheetName = "Restock Guide";
        rows = [
            ["Priority", "Raw Material", "Item Code", "Current Stock", "Minimum Threshold", "Recommended Action", "Status"],
            ...filteredData.records.map(r => [r.priority, r.material, r.itemCode, r.stock, r.threshold, r.action, r.status])
        ];
    } else if (tabKey === "inventory") {
        sheetName = "Inventory Records";
        rows = [
            ["Raw Material", "Item Code", "Unit", "Current Stock", "Minimum Threshold", "Reorder Quantity", "Status"],
            ...filteredData.records.map(m => [m.name, m.itemCode, m.unit, m.currentStock, m.minThreshold, m.reorderQty, m.status])
        ];
    } else if (tabKey === "receiving") {
        sheetName = "Material Receiving";
        rows = [
            ["Receipt Date", "Raw Material", "Received Qty", "Unit", "Supplier Name", "Received By", "Status"],
            ...filteredData.records.map(r => [r.receiptDate, r.materialName, r.receivedQuantity, r.unit, r.supplierName, r.receivedBy, "Verified Inbound"])
        ];
    } else if (tabKey === "disbursement") {
        sheetName = "Material Disbursement";
        rows = [
            ["Usage Date", "Raw Material", "Finished Product / Batch", "Disbursed Qty", "Unit", "Activity Type", "Recorded By"],
            ...filteredData.records.map(d => [d.usageDate, d.materialName, d.finishedProduct, d.disbursedQuantity, d.unit, d.activityType, d.recordedBy])
        ];
    } else if (tabKey === "activity") {
        sheetName = "Material Activity";
        rows = [
            ["Date", "Movement Type", "Raw Material", "Net Quantity", "Unit", "Reference / Batch", "Operator"],
            ...filteredData.records.map(a => [a.date, a.type, a.material, a.qty, a.unit, a.ref, a.operator])
        ];
    } else if (tabKey === "consumption") {
        sheetName = "Consumption Analysis";
        rows = [
            ["Raw Material", "Item Code", "Period Usage", "Prior Period Usage", "Unit", "Current Stock Balance", "Usage Trend", "Stock Status"],
            ...filteredData.records.map(c => [c.material, c.itemCode, c.currentUsage, c.previousUsage, c.unit, c.currentStock, c.trend, c.status])
        ];
    } else if (tabKey === "forecasting") {
        sheetName = "AI Forecasting";
        const isMonthly = filteredData.isMonthly;
        rows = [
            ["Raw Material", "Item Code", "Finished Product", "Current Stock", "Unit", isMonthly ? "Forecast Req (30D)" : "Forecast Req (7D)", "Additional Needed", "Status"],
            ...filteredData.records.map(f => [f.name, f.itemCode, f.finishedProduct, f.currentStock, f.unit, isMonthly ? f.forecast1Month : f.forecast7Day, (isMonthly ? f.additionalNeed1m : f.additionalNeed7) || 0, f.status])
        ];
    }

    if (rows.length === 0) {
        rows = [["Status", "No records matched the filter criteria in preview"]];
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const safeSheetName = sheetName.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName);

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function generateContinuousPdf(selectedSections = ["manager", "inventory", "receiving", "disbursement", "activity", "consumption", "forecasting"]) {
    if (typeof window.jspdf === "undefined" || !window.jspdf.jsPDF) {
        showToast("PDF generation library is still loading. Please wait a moment and try again.", "error");
        return null;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    const reportTypeStr = formatPeriodTypeLabel(state.periodPreset);
    const now = new Date();
    const genDateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTimeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const docRef = `RMSME-PDF-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    let y = 36;

    // 1. RMSME Official Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...RM_GREEN);
    doc.text("RMSME", 40, y);

    doc.setFontSize(8);
    doc.setTextColor(...RM_DIM);
    doc.setFont("helvetica", "normal");
    doc.text("RAW MATERIAL STOCK MANAGEMENT & FORECASTING ENTERPRISE", 40, y + 13);

    doc.setFontSize(7.5);
    doc.text(`Generated: ${genDateStr} at ${genTimeStr}  |  Doc Ref: ${docRef}`, pageWidth - 40, y + 13, { align: "right" });

    y += 26;
    doc.setDrawColor(5, 150, 105);
    doc.setLineWidth(1.5);
    doc.line(40, y, pageWidth - 40, y);
    y += 18;

    // 2. Document Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...RM_INK);
    const mainDocTitle = selectedSections.length === 1 
        ? `${getActiveTabDisplayName(selectedSections[0])} Report` 
        : "Executive Manager Summary & Inventory Decision Report";
    doc.text(mainDocTitle, 40, y);
    y += 16;

    // 3. Metadata Grid
    const colW = (pageWidth - 80) / 2;
    const targetMaterialLabel = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? (state.selectedMaterialName || "Selected Material")
        : "All Catalog Raw Materials";

    const leftCol = [
        ["REPORT HORIZON", periodLabel],
        ["REPORT PRESET", `${reportTypeStr} Snapshot`],
        ["MATERIAL SCOPE", targetMaterialLabel]
    ];
    const rightCol = [
        ["GENERATED AT", `${genDateStr} ${genTimeStr}`],
        ["SYSTEM AUTHORITY", "RMSME Production & Inventory Controller"],
        ["SOURCE DATABASE", "RMSME Authoritative PostgreSQL Database"]
    ];

    let leftY = y, rightY = y;
    leftCol.forEach(row => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...RM_DIM);
        doc.text(row[0], 40, leftY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...RM_INK);
        doc.text(String(row[1]), 40, leftY + 10);
        leftY += 23;
    });

    rightCol.forEach(row => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...RM_DIM);
        doc.text(row[0], 40 + colW, rightY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...RM_INK);
        doc.text(String(row[1]), 40 + colW, rightY + 10);
        rightY += 23;
    });

    y = Math.max(leftY, rightY) + 2;
    doc.setDrawColor(220, 226, 236);
    doc.setLineWidth(1);
    doc.line(40, y, pageWidth - 40, y);
    y += 18;

    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    const targetForecasts = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.forecastList.filter(item => item.id === state.selectedMaterialId || item.itemCode === state.selectedMaterialId || (state.materials.find(m => m.id === state.selectedMaterialId)?.name === item.name))
        : state.forecastList;

    // 4. Sections in Exact Order (Manager Summary First)
    const officialOrder = ["manager", "restock", "inventory", "receiving", "disbursement", "activity", "consumption", "forecasting"];
    const orderedSelections = officialOrder.filter(k => selectedSections.includes(k));

    orderedSelections.forEach(key => {
        if (y > doc.internal.pageSize.getHeight() - 140) {
            doc.addPage();
            y = 48;
        }

        if (key === "manager") {
            const periodReceipts = state.receipts.filter(r => 
                withinRange(r.receiptDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
            );
            const periodDisbursements = state.disbursements.filter(d => 
                withinRange(d.usageDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
            );
            const goodStock = targetMaterials.filter(m => m.status === "Good").length;
            const attentionStock = targetMaterials.filter(m => m.status === "Low" || m.status === "Critical").length;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("1. Executive Manager Summary & Decisions", 40, y);
            y += 14;

            doc.autoTable({
                startY: y,
                head: [["Operational Metric", "Result / Count"]],
                body: [
                    ["Total Catalog Raw Materials", `${state.materials.length} registered materials`],
                    ["Optimal / Good Stock Items", `${goodStock} items`],
                    ["Attention Required (Low / Critical)", `${attentionStock} items`],
                    ["Period Material Receipts Logged", `${periodReceipts.length} receipt records`],
                    ["Period Production Disbursements Logged", `${periodDisbursements.length} disbursement records`]
                ],
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 16;

            const decisions = [];
            state.materials.forEach(m => {
                if (m.status === "Critical") {
                    decisions.push(["High", m.name, `Stock has reached critical threshold (${m.currentStock} ${m.unit} vs min ${m.minThreshold} ${m.unit}).`, `Create urgent purchase receipt for ${m.reorderQty || 50} ${m.unit}.`]);
                } else if (m.status === "Low") {
                    decisions.push(["Medium", m.name, `Stock approaching minimum safety threshold (${m.currentStock} ${m.unit} vs min ${m.minThreshold} ${m.unit}).`, `Schedule replenishment with primary supplier.`]);
                }
            });

            if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9.5);
            doc.setTextColor(...RM_INK);
            doc.text("Manager Strategic Decision Breakdown", 40, y);
            y += 8;

            doc.autoTable({
                startY: y,
                head: [["Priority", "Raw Material", "What the Data Shows", "Suggested Action"]],
                body: decisions.length === 0 ? [["Stable", "All Items", "No items currently require urgent intervention.", "Continue standard monitoring."]] : decisions,
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "restock") {
            if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("2. Restock Recommendations (Action Guide)", 40, y);
            y += 10;

            const restockItems = targetMaterials.map(m => {
                let priority = "Adequate";
                let action = "Sufficient stock on hand.";
                if (m.status === "Critical") {
                    priority = "High Priority";
                    action = `Place urgent order for ${m.reorderQty || 50} ${m.unit}`;
                } else if (m.status === "Low") {
                    priority = "Medium Priority";
                    action = `Schedule order for ${m.reorderQty || 50} ${m.unit}`;
                }
                return [
                    priority,
                    m.name,
                    `${m.currentStock.toLocaleString()} ${m.unit}`,
                    `${m.minThreshold.toLocaleString()} ${m.unit}`,
                    action
                ];
            });

            doc.autoTable({
                startY: y,
                head: [["Priority", "Raw Material", "Current Stock", "Min Threshold", "Recommended Action"]],
                body: restockItems.length === 0 ? [["—", "No materials match selection", "—", "—", "—"]] : restockItems,
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "inventory") {
            if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("3. Raw Material Inventory Records", 40, y);
            y += 10;

            doc.autoTable({
                startY: y,
                head: [["Raw Material", "Item Code", "Current Stock", "Minimum Threshold", "Reorder Quantity", "Status"]],
                body: targetMaterials.map(m => [
                    m.name,
                    m.itemCode,
                    `${m.currentStock.toLocaleString()} ${m.unit}`,
                    `${m.minThreshold.toLocaleString()} ${m.unit}`,
                    `${m.reorderQty.toLocaleString()} ${m.unit}`,
                    m.status
                ]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "receiving") {
            if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 48; }
            const periodReceipts = state.receipts.filter(r => 
                withinRange(r.receiptDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
            );

            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("4. Material Receiving Log", 40, y);
            y += 10;

            doc.autoTable({
                startY: y,
                head: [["Receipt Date", "Raw Material", "Received Qty", "Supplier Name", "Received By", "Status"]],
                body: periodReceipts.length === 0 ? [["—", "No receiving in selected period", "—", "—", "—", "—"]] :
                    periodReceipts.map(r => [
                        r.receiptDate,
                        r.materialName,
                        `+${r.receivedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.unit}`,
                        r.supplierName,
                        r.receivedBy,
                        "Verified"
                    ]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "disbursement") {
            if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 48; }
            const periodDisbursements = state.disbursements.filter(d => 
                withinRange(d.usageDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
            );

            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("5. Material Disbursement Log", 40, y);
            y += 10;

            doc.autoTable({
                startY: y,
                head: [["Usage Date", "Raw Material", "Finished Product / Batch", "Disbursed Qty", "Activity Type", "Recorded By"]],
                body: periodDisbursements.length === 0 ? [["—", "No disbursements in selected period", "—", "—", "—", "—"]] :
                    periodDisbursements.map(d => [
                        d.usageDate,
                        d.materialName,
                        d.finishedProduct,
                        `-${d.disbursedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${d.unit}`,
                        d.activityType,
                        d.recordedBy
                    ]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "activity") {
            if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 48; }
            const periodReceipts = state.receipts.filter(r => 
                withinRange(r.receiptDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
            );
            const periodDisbursements = state.disbursements.filter(d => 
                withinRange(d.usageDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
            );
            const activities = [];

            periodReceipts.forEach(r => activities.push([r.receiptDate, "Received", r.materialName, `+${r.receivedQuantity} ${r.unit}`, r.supplierName, r.receivedBy]));
            periodDisbursements.forEach(d => activities.push([d.usageDate, "Disbursed", d.materialName, `-${d.disbursedQuantity} ${d.unit}`, d.finishedProduct, d.recordedBy]));
            activities.sort((a, b) => b[0].localeCompare(a[0]));

            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("6. Material Activity Movement Log", 40, y);
            y += 10;

            doc.autoTable({
                startY: y,
                head: [["Date", "Activity", "Raw Material", "Net Quantity", "Reference / Batch", "Operator"]],
                body: activities.length === 0 ? [["—", "No movement records", "—", "—", "—", "—"]] : activities,
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "consumption") {
            if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 48; }
            const periodDisbursements = state.disbursements.filter(d => 
                withinRange(d.usageDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
            );
            const curMap = new Map();
            periodDisbursements.forEach(d => curMap.set(d.materialId, (curMap.get(d.materialId) || 0) + d.disbursedQuantity));

            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("7. Consumption Analysis & Usage Trends", 40, y);
            y += 10;

            doc.autoTable({
                startY: y,
                head: [["Raw Material", "Item Code", "Total Consumed in Period", "Current Stock Balance", "Status"]],
                body: targetMaterials.map(m => [
                    m.name,
                    m.itemCode,
                    `${(curMap.get(m.id) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${m.unit}`,
                    `${m.currentStock.toLocaleString()} ${m.unit}`,
                    m.status
                ]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "forecasting") {
            if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("8. AI Forecasting & Requirement Projections", 40, y);
            y += 10;

            doc.autoTable({
                startY: y,
                head: [["Raw Material", "ID", "Finished Product", "Current Stock", "Forecast Req (7D)", "Additional Needed", "Status"]],
                body: targetForecasts.map(item => [
                    item.name,
                    item.itemCode,
                    item.finishedProduct,
                    `${item.currentStock.toLocaleString()} ${item.unit}`,
                    item.forecast7Day !== null ? `${item.forecast7Day.toFixed(1)} ${item.unit}` : "—",
                    item.additionalNeed7 !== null && item.additionalNeed7 > 0 ? `+${item.additionalNeed7.toFixed(1)} ${item.unit}` : "0",
                    item.status || "—"
                ]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }
    });

    // 5. Centered Faded Watermark & Permanent RMSME Footer Across All Pages (Matching Image 1)
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);

        // Centered Faded Grey Anti-Fake Watermark
        doc.saveGraphicsState();
        doc.setTextColor(226, 232, 240);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(34);
        doc.text("RMSME OFFICIAL REPORT", pageWidth / 2, doc.internal.pageSize.getHeight() / 2 - 12, {
            align: "center",
            angle: 35
        });
        doc.setFontSize(13);
        doc.setTextColor(236, 240, 246);
        doc.text("PREVENT FAKE COPY • SYSTEM VERIFIED", pageWidth / 2, doc.internal.pageSize.getHeight() / 2 + 18, {
            align: "center",
            angle: 35
        });
        doc.restoreGraphicsState();

        // Footer divider line
        doc.setDrawColor(5, 150, 105);
        doc.setLineWidth(1);
        doc.line(40, doc.internal.pageSize.getHeight() - 34, pageWidth - 40, doc.internal.pageSize.getHeight() - 34);

        // Footer Text
        doc.setFontSize(7.5);
        doc.setTextColor(...RM_INK);
        doc.setFont("helvetica", "bold");
        doc.text("RMSME — Raw Material Stock Management & Enterprise Forecasting System", 40, doc.internal.pageSize.getHeight() - 22);

            doc.setFont("helvetica", "normal");
        doc.setTextColor(...RM_DIM);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 40, doc.internal.pageSize.getHeight() - 22, { align: "right" });

        doc.setFontSize(6.8);
        doc.text("System Support: support@rmsme.internal | Hotline: (02) 8876-RMSME | Official System Generated Copy — Anti-Tamper Protected", 40, doc.internal.pageSize.getHeight() - 12);
    }

    return doc;
}

/* ==========================================================
   EXPORT EXCEL WORKBOOK GENERATION (MULTI-SHEET WORKBOOK)
   ========================================================== */

function buildMultiSheetExcelWorkbook(selectedSections = ["manager", "restock", "inventory", "receiving", "disbursement", "activity", "consumption", "forecasting"]) {
    const wb = XLSX.utils.book_new();

    const officialOrder = ["manager", "restock", "inventory", "receiving", "disbursement", "activity", "consumption", "forecasting"];
    const orderedSelections = officialOrder.filter(k => selectedSections.includes(k));

    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    const periodReceipts = state.receipts.filter(r => 
        withinRange(r.receiptDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
    );
    const periodDisbursements = state.disbursements.filter(d => 
        withinRange(d.usageDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
    );

    const targetForecasts = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.forecastList.filter(item => item.id === state.selectedMaterialId || item.itemCode === state.selectedMaterialId || (state.materials.find(m => m.id === state.selectedMaterialId)?.name === item.name))
        : state.forecastList;

    orderedSelections.forEach(key => {
        if (key === "manager") {
            const goodStock = targetMaterials.filter(m => m.status === "Good").length;
            const attentionStock = targetMaterials.filter(m => m.status === "Low" || m.status === "Critical").length;
            const rows = [
                ["Metric", "Result"],
                ["Total Materials", targetMaterials.length],
                ["Good Stock", goodStock],
                ["Low / Critical", attentionStock],
                ["Receiving Records", periodReceipts.length],
                ["Consumption Records", periodDisbursements.length],
                ["Disbursement Records", periodDisbursements.length]
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Manager Summary");
        }

        if (key === "restock") {
            const restockRows = [
                ["Priority", "Raw Material", "Item Code", "Current Stock", "Min Threshold", "Suggested Reorder Qty", "Status"],
                ...targetMaterials.map(m => [
                    m.status === "Critical" ? "High Priority" : (m.status === "Low" ? "Medium Priority" : "Adequate"),
                    m.name,
                    m.itemCode,
                    `${m.currentStock} ${m.unit}`,
                    `${m.minThreshold} ${m.unit}`,
                    `${m.reorderQty || 50} ${m.unit}`,
                    m.status
                ])
            ];
            const ws = XLSX.utils.aoa_to_sheet(restockRows);
            XLSX.utils.book_append_sheet(wb, ws, "Restock Guide");
        }

        if (key === "inventory") {
            const rows = [
                ["Raw Material", "Item Code", "Unit", "Current Stock", "Minimum Threshold", "Reorder Quantity", "Status"],
                ...targetMaterials.map(m => [m.name, m.itemCode, m.unit, m.currentStock, m.minThreshold, m.reorderQty, m.status])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Inventory Records");
        }

        if (key === "receiving") {
            const rows = [
                ["Receipt Date", "Raw Material", "Received Qty", "Unit", "Supplier Name", "Received By", "Status"],
                ...periodReceipts.map(r => [r.receiptDate, r.materialName, r.receivedQuantity, r.unit, r.supplierName, r.receivedBy, "Verified"])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Material Receiving");
        }

        if (key === "disbursement") {
            const rows = [
                ["Usage Date", "Raw Material", "Finished Product / Batch", "Disbursed Qty", "Unit", "Activity Type", "Recorded By"],
                ...periodDisbursements.map(d => [d.usageDate, d.materialName, d.finishedProduct, d.disbursedQuantity, d.unit, d.activityType, d.recordedBy])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Material Disbursement");
        }

        if (key === "activity") {
            const activities = [];
            periodReceipts.forEach(r => activities.push([r.receiptDate, "Received", r.materialName, r.receivedQuantity, r.unit, r.supplierName, r.receivedBy]));
            periodDisbursements.forEach(d => activities.push([d.usageDate, "Disbursed", d.materialName, -d.disbursedQuantity, d.unit, d.finishedProduct, d.recordedBy]));
            activities.sort((a, b) => b[0].localeCompare(a[0]));

            const rows = [
                ["Date", "Activity", "Raw Material", "Net Quantity", "Unit", "Purpose / Context", "Recorded By"],
                ...activities
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Material Activity");
        }

        if (key === "consumption") {
            const curMap = new Map();
            periodDisbursements.forEach(d => curMap.set(d.materialId, (curMap.get(d.materialId) || 0) + d.disbursedQuantity));

            const rows = [
                ["Raw Material", "Total Consumed", "Unit", "Current Stock", "Status"],
                ...targetMaterials.map(m => [m.name, curMap.get(m.id) || 0, m.unit, m.currentStock, m.status])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Consumption Analysis");
        }

        if (key === "forecasting") {
            const rows = [
                ["Raw Material", "ID", "Finished Product", "Current Stock", "Unit", "Recent Consumption", "Forecast Req (7D)", "Forecast Req (30D)", "Additional Needed (7D)", "Status"],
                ...targetForecasts.map(item => [
                    item.name,
                    item.itemCode,
                    item.finishedProduct,
                    item.currentStock,
                    item.unit,
                    item.recentConsumption,
                    item.forecast7Day,
                    item.forecast1Month,
                    item.additionalNeed7,
                    item.status
                ])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "AI Forecasting");
        }
    });

    return wb;
}

function generateMultiSheetExcel(selectedSections, fileName = "RMIMS_Report_Package") {
    const wb = buildMultiSheetExcelWorkbook(selectedSections);
    XLSX.writeFile(wb, `${fileName}.xlsx`);
}

function generateMultiSheetExcelBlob(selectedSections) {
    const wb = buildMultiSheetExcelWorkbook(selectedSections);
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/* ==========================================================
   SAVE BLOB HELPER (INTERACTIVE FOLDER OR BROWSER DOWNLOAD)
   ========================================================== */

async function saveExportBlob({ blob, fileName, defaultExtension }) {
    const fullFileName = fileName.endsWith(`.${defaultExtension}`) ? fileName : `${fileName}.${defaultExtension}`;

    // 1. If user selected a custom directory using the File System Access API
    if (state.customSaveDirectoryHandle && typeof state.customSaveDirectoryHandle.getFileHandle === "function") {
        try {
            const fileHandle = await state.customSaveDirectoryHandle.getFileHandle(fullFileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return { success: true, mode: "custom-directory", location: state.customSaveDirectoryHandle.name };
        } catch (err) {
            console.warn("Direct directory write failed, falling back to download:", err);
        }
    }

    // 2. Fallback to standard automatic download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fullFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    return { success: true, mode: "browser-download" };
}

/* ==========================================================
   EVENT LISTENERS & UI WIRING
   ========================================================== */

function handlePrintReport() {
    if (isPrinting) return;
    isPrinting = true;
    const activeTab = state.activeTab || "manager";
    try {
        updatePrintDocHtml(activeTab);
    } catch (err) {
        console.error("Print doc update error:", err);
    }
    setTimeout(() => {
        try {
            window.print();
        } catch (e) {
            console.error("Print error:", e);
        } finally {
            // Re-enable after print dialog lifecycle finishes
            setTimeout(() => {
                isPrinting = false;
            }, 400);
        }
    }, 50);
}

function initEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    // 1. Category Card Selection & Workspace Panels
    const tabBtns = document.querySelectorAll(".rpt-cat-card, .rpt-tab-btn");
    const panels = {
        manager: document.getElementById("tabPanelManager"),
        restock: document.getElementById("tabPanelRestock"),
        inventory: document.getElementById("tabPanelInventory"),
        receiving: document.getElementById("tabPanelReceiving"),
        disbursement: document.getElementById("tabPanelDisbursement"),
        activity: document.getElementById("tabPanelActivity"),
        consumption: document.getElementById("tabPanelConsumption"),
        forecasting: document.getElementById("tabPanelForecasting")
    };

    function selectReportCategory(target, triggerToast = true) {
        if (!target) return;
        state.activeTab = target;

        tabBtns.forEach(b => {
            if (b.dataset.tab === target) b.classList.add("active");
            else b.classList.remove("active");
        });

        // Hide Empty State and Reveal Document Sheet (Matching Image 3 & 4)
        const emptyState = document.getElementById("rptEmptyPreviewState");
        const docSheet = document.getElementById("rptDocumentContainer");
        if (emptyState) emptyState.style.display = "none";
        if (docSheet) docSheet.style.display = "block";

        Object.keys(panels).forEach(k => {
            if (panels[k]) {
                if (k === target) {
                    panels[k].style.display = "block";
                    panels[k].classList.add("active");
                } else {
                    panels[k].style.display = "none";
                    panels[k].classList.remove("active");
                }
            }
        });

        // Update Corporate Preview Header & KPIs (Image 4)
        updateCorporatePreviewDetails(target);

        // Re-render tab specific content
        if (target === "manager") renderManagerSummaryTab();
        else if (target === "restock") renderRestockRecommendationsTab();
        else if (target === "inventory") renderInventoryRecordsTab();
        else if (target === "receiving") renderMaterialReceivingTab();
        else if (target === "disbursement") renderMaterialDisbursementTab();
        else if (target === "activity") renderMaterialActivityTab();
        else if (target === "consumption") renderConsumptionAnalysisTab();
        else if (target === "forecasting") renderAiForecastingTab();

        updatePrintDocHtml(target);

        if (triggerToast) {
            showToast("Report generated successfully.", "success");
        }
    }

    // Synchronize initial panel display state
    if (!state.activeTab) {
        selectReportCategory("manager", false);
    } else {
        selectReportCategory(state.activeTab, false);
    }

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.tab;
            if (!target) return;
            selectReportCategory(target, true);
        });
    });

    // Populate Specific Material Filter Dropdown
    populateMaterialDropdown();

    // Check URL parameters for tab (e.g. reports.html?tab=forecasting)
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const initialTab = urlParams.get("tab") || (window.location.hash ? window.location.hash.replace("#", "") : null);
        if (initialTab && panels[initialTab]) {
            selectReportCategory(initialTab, false);
        }
    } catch (e) {}

    // Restock Priority Checklist Listeners
    const chkCrit = document.getElementById("chkRestockCrit");
    const chkMed = document.getElementById("chkRestockMed");
    const chkGood = document.getElementById("chkRestockGood");
    [chkCrit, chkMed, chkGood].forEach(chk => {
        if (chk) {
            chk.addEventListener("change", () => {
                renderRestockRecommendationsTab();
            });
        }
    });

    // 2. Period Preset & Date Controls
    const presetSelect = document.getElementById("reportPeriodPreset");
    if (presetSelect) {
        presetSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            state.periodPreset = val;

            setPeriodPresetDates(val);
            syncDateInputsInteractiveState();
            updateClearBtnVisibility();
            updateMetadataLabels();
            renderAllTabs();
            updatePrintDocHtml();

            if (val === "custom" && fpStart) {
                fpStart.open();
            }
        });
    }

    // Refresh Live Data Button
    const genBtn = document.getElementById("generateReportBtn");
    if (genBtn) {
        genBtn.addEventListener("click", async () => {
            genBtn.classList.add("spinning");
            try {
                await loadAuthoritativeData();
                showToast("System data refreshed successfully. Reports are up to date.", "success");
            } catch (err) {
                console.error("Refresh error:", err);
                showToast("Error updating live report data.", "error");
            } finally {
                setTimeout(() => {
                    genBtn.classList.remove("spinning");
                }, 750);
            }
        });
    }

    // Clear Dates button
    const clearDatesBtn = document.getElementById("clearReportDatesBtn");
    if (clearDatesBtn) {
        clearDatesBtn.addEventListener("click", () => {
            if (fpStart) fpStart.clear();
            if (fpEnd) fpEnd.clear();
            state.startDate = null;
            state.endDate = null;
            state.periodPreset = "all";
            if (presetSelect) presetSelect.value = "all";
            syncDateInputsInteractiveState();
            updateClearBtnVisibility();
            updateMetadataLabels();
            renderAllTabs();
            updatePrintDocHtml();
        });
    }

    // 3. Filters per Tab
    const invSearch = document.getElementById("invSearchInput");
    if (invSearch) invSearch.addEventListener("input", (e) => { state.invSearch = e.target.value; state.invPage = 1; renderInventoryRecordsTab(); });
    const invStatus = document.getElementById("invStatusFilter");
    if (invStatus) invStatus.addEventListener("change", (e) => { state.invStatus = e.target.value; state.invPage = 1; renderInventoryRecordsTab(); });
    const invSort = document.getElementById("invSortFilter");
    if (invSort) invSort.addEventListener("change", (e) => { state.invSort = e.target.value; state.invPage = 1; renderInventoryRecordsTab(); });

    const rcvSearch = document.getElementById("rcvSearchInput");
    if (rcvSearch) rcvSearch.addEventListener("input", (e) => { state.rcvSearch = e.target.value; state.rcvPage = 1; renderMaterialReceivingTab(); });
    const rcvSort = document.getElementById("rcvSortFilter");
    if (rcvSort) rcvSort.addEventListener("change", (e) => { state.rcvSort = e.target.value; state.rcvPage = 1; renderMaterialReceivingTab(); });

    const disbSearch = document.getElementById("disbSearchInput");
    if (disbSearch) disbSearch.addEventListener("input", (e) => { state.disbSearch = e.target.value; state.disbPage = 1; renderMaterialDisbursementTab(); });
    const disbSort = document.getElementById("disbSortFilter");
    if (disbSort) disbSort.addEventListener("change", (e) => { state.disbSort = e.target.value; state.disbPage = 1; renderMaterialDisbursementTab(); });

    const actSearch = document.getElementById("actSearchInput");
    if (actSearch) actSearch.addEventListener("input", (e) => { state.actSearch = e.target.value; state.actPage = 1; renderMaterialActivityTab(); });
    const actType = document.getElementById("actTypeFilter");
    if (actType) actType.addEventListener("change", (e) => { state.actType = e.target.value; state.actPage = 1; renderMaterialActivityTab(); });
    const actSort = document.getElementById("actSortFilter");
    if (actSort) actSort.addEventListener("change", (e) => { state.actSort = e.target.value; state.actPage = 1; renderMaterialActivityTab(); });

    const cnsSearch = document.getElementById("cnsSearchInput");
    if (cnsSearch) cnsSearch.addEventListener("input", (e) => { state.cnsSearch = e.target.value; state.cnsPage = 1; renderConsumptionAnalysisTab(); });
    const cnsSort = document.getElementById("cnsSortFilter");
    if (cnsSort) cnsSort.addEventListener("change", (e) => { state.cnsSort = e.target.value; state.cnsPage = 1; renderConsumptionAnalysisTab(); });

    // AI Forecasting Filters & Search
    const fcSearch = document.getElementById("fcSearchInput");
    if (fcSearch) fcSearch.addEventListener("input", (e) => { state.fcSearch = e.target.value; state.fcPage = 1; renderAiForecastingTab(); });
    const fcStatus = document.getElementById("fcStatusFilter");
    if (fcStatus) fcStatus.addEventListener("change", (e) => { state.fcStatus = e.target.value; state.fcPage = 1; renderAiForecastingTab(); });
    const fcUnit = document.getElementById("fcUnitFilter");
    if (fcUnit) fcUnit.addEventListener("change", (e) => { state.fcUnit = e.target.value; state.fcPage = 1; renderAiForecastingTab(); });
    const fcHorizon = document.getElementById("fcHorizonFilter");
    if (fcHorizon) fcHorizon.addEventListener("change", (e) => { state.fcHorizon = e.target.value; state.fcPage = 1; renderAiForecastingTab(); });

    // Live Cross-Module Sync with Admin Forecasting module
    window.addEventListener("storage", (e) => {
        if (e.key === "rmims_forecast_cache" || e.key === "rmims_latest_forecast" || e.key === "rmims_forecast_timestamp") {
            loadAuthoritativeForecasts();
            renderAiForecastingTab();
            updatePrintDocHtml();
        }
    });
    window.addEventListener("rmims:forecast-updated", () => {
        loadAuthoritativeForecasts();
        renderAiForecastingTab();
        updatePrintDocHtml();
    });

    // 4. Print Action -> Single debounced print trigger
    const btnOverallPrint = document.getElementById("btnOverallPrint");
    if (btnOverallPrint) {
        btnOverallPrint.addEventListener("click", handlePrintReport);
    }
    const printBtn = document.getElementById("btnPrint");
    if (printBtn) {
        printBtn.addEventListener("click", handlePrintReport);
    }

    // 5. Specific Tab Export Modal (Single Active Category Export)
    const tabExportBtn = document.getElementById("btnTabExport");
    const tabExportOverlay = document.getElementById("tabExportModalOverlay");
    const tabExportClose = document.getElementById("tabExportCloseBtn");
    const tabExportCancel = document.getElementById("tabExportCancelBtn");
    const tabExportTitle = document.getElementById("tabExportModalTitle");
    const tabExportSub = document.getElementById("tabExportModalSub");
    const tabExportTargetName = document.getElementById("tabExportTargetName");
    const btnExportSpecificPdf = document.getElementById("btnExportSpecificPdf");
    const btnExportSpecificExcel = document.getElementById("btnExportSpecificExcel");

    const getActiveTabDisplayName = (tabKey) => {
        const names = {
            manager: "Manager Summary",
            restock: "Restock Recommendations",
            inventory: "Inventory Records",
            receiving: "Material Receiving",
            disbursement: "Material Disbursement",
            activity: "Material Activity",
            consumption: "Consumption Analysis",
            forecasting: "AI Forecasting"
        };
        return names[tabKey] || "Current Report";
    };

    const openTabExportModal = () => {
        if (!state.activeTab) {
            selectReportCategory("manager", false);
        }
        const activeName = getActiveTabDisplayName(state.activeTab || "manager");
        if (tabExportTitle) tabExportTitle.textContent = `Export: ${activeName}`;
        if (tabExportTargetName) tabExportTargetName.textContent = activeName;
        if (tabExportSub) {
            const pText = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
            tabExportSub.textContent = `Scope: ${state.selectedMaterialName || "All Raw Materials"} | Horizon: ${pText}`;
        }
        tabExportOverlay?.classList.add("open");
    };

    const closeTabExportModal = () => tabExportOverlay?.classList.remove("open");

    if (tabExportBtn && tabExportOverlay) {
        tabExportBtn.addEventListener("click", openTabExportModal);
    }
    if (tabExportClose) tabExportClose.addEventListener("click", closeTabExportModal);
    if (tabExportCancel) tabExportCancel.addEventListener("click", closeTabExportModal);
    if (tabExportOverlay) {
        tabExportOverlay.addEventListener("click", (e) => {
            if (e.target === tabExportOverlay) closeTabExportModal();
        });
    }

    if (btnExportSpecificPdf) {
        btnExportSpecificPdf.addEventListener("click", async () => {
            if (!state.activeTab) return;
            const activeName = getActiveTabDisplayName(state.activeTab);
            const safeName = activeName.replace(/[^a-zA-Z0-9]/g, '_');
            const pTag = state.periodPreset === "weekly" ? "Weekly" : (state.periodPreset === "monthly" ? "Monthly" : (state.periodPreset === "today" ? "Today" : (state.periodPreset === "all" ? "AllTime" : "Custom")));
            const matTag = (state.selectedMaterialId && state.selectedMaterialId !== "all") ? `_${(state.selectedMaterialName || "Material").replace(/[^a-zA-Z0-9]/g, '_')}` : "";
            const fileName = `RMIMS_${safeName}${matTag}_${pTag}`;

            try {
                btnExportSpecificPdf.disabled = true;
                const doc = generateSingleTabPdf(state.activeTab);
                if (doc) {
                    const pdfBlob = doc.output("blob");
                    await saveExportBlob({ blob: pdfBlob, fileName, defaultExtension: "pdf" });
                    showToast(`${activeName} exported as PDF.`, "success");
                }
            } catch (err) {
                console.error("Single PDF export error:", err);
                showToast("Error generating PDF.", "error");
            } finally {
                btnExportSpecificPdf.disabled = false;
                closeTabExportModal();
            }
        });
    }

    if (btnExportSpecificExcel) {
        btnExportSpecificExcel.addEventListener("click", async () => {
            if (!state.activeTab) return;
            const activeName = getActiveTabDisplayName(state.activeTab);
            const safeName = activeName.replace(/[^a-zA-Z0-9]/g, '_');
            const pTag = state.periodPreset === "weekly" ? "Weekly" : (state.periodPreset === "monthly" ? "Monthly" : (state.periodPreset === "today" ? "Today" : (state.periodPreset === "all" ? "AllTime" : "Custom")));
            const matTag = (state.selectedMaterialId && state.selectedMaterialId !== "all") ? `_${(state.selectedMaterialName || "Material").replace(/[^a-zA-Z0-9]/g, '_')}` : "";
            const fileName = `RMIMS_${safeName}${matTag}_${pTag}`;

            try {
                btnExportSpecificExcel.disabled = true;
                const excelBlob = generateSingleTabExcelBlob(state.activeTab);
                if (excelBlob) {
                    await saveExportBlob({ blob: excelBlob, fileName, defaultExtension: "xlsx" });
                    showToast(`${activeName} exported as Excel.`, "success");
                }
            } catch (err) {
                console.error("Single Excel export error:", err);
                showToast("Error generating Excel.", "error");
            } finally {
                btnExportSpecificExcel.disabled = false;
                closeTabExportModal();
            }
        });
    }

    // 6. Save As / Overall Export Modal (Full Multi-Category Package)
    const btnOverallExport = document.getElementById("btnOverallExport");
    const saveOverlay = document.getElementById("saveModalOverlay");
    const saveClose = document.getElementById("saveModalCloseBtn");
    const saveCancel = document.getElementById("saveModalCancelBtn");
    const saveConfirm = document.getElementById("saveModalConfirmBtn");
    const browseBtn = document.getElementById("browseLocationBtn");
    const locInput = document.getElementById("saveModalLocation");

    const openSaveModal = () => {
        const reportNameInput = document.getElementById("saveModalReportName");
        if (reportNameInput) {
            const pTag = state.periodPreset === "weekly" ? "Weekly" : (state.periodPreset === "monthly" ? "Monthly" : (state.periodPreset === "today" ? "Today" : (state.periodPreset === "all" ? "AllTime" : "Custom")));
            const startStr = state.startDate ? formatDateISO(state.startDate) : "";
            const endStr = state.endDate ? formatDateISO(state.endDate) : "";
            const matTag = (state.selectedMaterialId && state.selectedMaterialId !== "all") ? `_${(state.selectedMaterialName || "Material").replace(/[^a-zA-Z0-9]/g, '_')}` : "";
            reportNameInput.value = `RMIMS_${pTag}_Report${matTag}_${startStr || "Live"}_to_${endStr || "Live"}`;
        }
        const subtitle = document.getElementById("saveModalPeriodSubtitle");
        if (subtitle) {
            const pText = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
            subtitle.textContent = `Report Period: ${pText} | Scope: ${state.selectedMaterialName || "All Raw Materials"}`;
        }
        saveOverlay?.classList.add("open");
    };

    if (btnOverallExport && saveOverlay) {
        btnOverallExport.addEventListener("click", openSaveModal);
    }

    // Interactive Browse Location Picker
    if (browseBtn) {
        browseBtn.addEventListener("click", async () => {
            if ("showDirectoryPicker" in window) {
                try {
                    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
                    if (dirHandle) {
                        state.customSaveDirectoryHandle = dirHandle;
                        state.customSaveDirectoryName = dirHandle.name;
                        if (locInput) {
                            locInput.value = `📁 ${dirHandle.name} (Custom Folder)`;
                            locInput.style.color = "#059669";
                            locInput.style.fontWeight = "700";
                        }
                        showToast(`Target save folder selected: "${dirHandle.name}"`, "success");
                    }
                } catch (err) {
                    if (err.name !== "AbortError") {
                        console.error("Directory picker error:", err);
                        showToast("Could not access custom folder. Defaulting to Downloads.", "info");
                    }
                }
            } else {
                const folderName = prompt("Enter target folder name or label for your export archive:\n(e.g., Reports/August2026 or RMIMS_Archives)", state.customSaveDirectoryName || "RMIMS_Reports");
                if (folderName && folderName.trim()) {
                    state.customSaveDirectoryName = folderName.trim();
                    if (locInput) {
                        locInput.value = `📁 Downloads / ${state.customSaveDirectoryName}`;
                        locInput.style.color = "#059669";
                        locInput.style.fontWeight = "700";
                    }
                    showToast(`Save location set to: Downloads / ${state.customSaveDirectoryName}`, "success");
                }
            }
        });
    }

    if (locInput) {
        locInput.addEventListener("click", () => {
            if (state.customSaveDirectoryHandle || state.customSaveDirectoryName) {
                if (confirm("Reset save location back to default browser Downloads folder?")) {
                    state.customSaveDirectoryHandle = null;
                    state.customSaveDirectoryName = null;
                    locInput.value = "Downloads (Browser Default)";
                    locInput.style.color = "";
                    locInput.style.fontWeight = "";
                    showToast("Save location reset to default Downloads folder.", "info");
                }
            }
        });
    }

    const closeSaveModal = () => saveOverlay?.classList.remove("open");
    if (saveClose) saveClose.addEventListener("click", closeSaveModal);
    if (saveCancel) saveCancel.addEventListener("click", closeSaveModal);
    if (saveOverlay) {
        saveOverlay.addEventListener("click", (e) => {
            if (e.target === saveOverlay) closeSaveModal();
        });
    }

    document.getElementById("saveSelectAllBtn")?.addEventListener("click", () => {
        document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']").forEach(cb => cb.checked = true);
    });

    document.getElementById("saveClearAllBtn")?.addEventListener("click", () => {
        document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']").forEach(cb => cb.checked = false);
    });

    if (saveConfirm) {
        saveConfirm.addEventListener("click", async () => {
            const checkedBoxes = Array.from(document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']:checked"));
            if (checkedBoxes.length === 0) {
                showToast("Please select at least one report section.", "error");
                return;
            }

            const selectedKeys = checkedBoxes.map(cb => cb.value);
            const format = document.querySelector("input[name='saveFileFormat']:checked")?.value || "pdf";
            const rawName = document.getElementById("saveModalReportName")?.value.trim() || "RMIMS_Report";

            saveConfirm.disabled = true;
            saveConfirm.innerHTML = `<span class="spinner-border spinner-border-sm" style="width:14px;height:14px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin 0.6s linear infinite;"></span> Saving...`;

            try {
                if (format === "pdf") {
                    const doc = generateContinuousPdf(selectedKeys);
                    if (!doc) return;
                    const pdfBlob = doc.output("blob");
                    const res = await saveExportBlob({ blob: pdfBlob, fileName: rawName, defaultExtension: "pdf" });
                    if (res.mode === "custom-directory") {
                        showToast(`PDF saved directly to "${res.location}".`, "success");
                    } else {
                        showToast("Continuous PDF report downloaded.", "success");
                    }
                } else if (format === "excel") {
                    const excelBlob = generateMultiSheetExcelBlob(selectedKeys);
                    const res = await saveExportBlob({ blob: excelBlob, fileName: rawName, defaultExtension: "xlsx" });
                    if (res.mode === "custom-directory") {
                        showToast(`Excel workbook saved directly to "${res.location}".`, "success");
                    } else {
                        showToast("Multi-sheet Excel workbook generated.", "success");
                    }
                } else if (format === "both") {
                    const doc = generateContinuousPdf(selectedKeys);
                    if (!doc) return;
                    const pdfBlob = doc.output("blob");
                    const excelBlob = generateMultiSheetExcelBlob(selectedKeys);
                    
                    await saveExportBlob({ blob: pdfBlob, fileName: `${rawName}_Document`, defaultExtension: "pdf" });
                    await saveExportBlob({ blob: excelBlob, fileName: `${rawName}_Workbook`, defaultExtension: "xlsx" });
                    
                    if (state.customSaveDirectoryHandle) {
                        showToast(`PDF + Excel package saved to "${state.customSaveDirectoryHandle.name}".`, "success");
                    } else {
                        showToast("PDF + Excel report package generated.", "success");
                    }
                }
            } catch (err) {
                console.error("Save error:", err);
                showToast("An error occurred while saving the report.", "error");
            } finally {
                saveConfirm.disabled = false;
                saveConfirm.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="17" height="17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save Report`;
                closeSaveModal();
            }
        });
    }
}

/* ==========================================================
   CORPORATE PREVIEW DETAILS & KPI STATS (MATCHING IMAGE 4)
   ========================================================== */

function updateCorporatePreviewDetails(target) {
    const titles = {
        manager: { title: "Manager Summary", ref: "MRV-2026-MGR", desc: "Key stock levels, period activities, and operational health." },
        restock: { title: "Restock Recommendations", ref: "MRV-2026-RST", desc: "Actionable replenishment guide for low and critical inventory." },
        inventory: { title: "Inventory Records", ref: "MRV-2026-INV", desc: "Stock catalog, quantities on hand, units, and replenishment states." },
        receiving: { title: "Material Receiving", ref: "MRV-2026-RCV", desc: "Supplier deliveries, inbound shipments, lots, and dates." },
        disbursement: { title: "Material Disbursement", ref: "MRV-2026-DSB", desc: "Disbursed raw materials released for production batches." },
        activity: { title: "Material Activity", ref: "MRV-2026-ACT", desc: "Chronological audit ledger combining all inbound and outbound stock." },
        consumption: { title: "Consumption Analysis", ref: "MRV-2026-CNS", desc: "Material burn rates, daily consumption velocity, and usage trends." },
        forecasting: { title: "AI Forecasting", ref: "MRV-2026-FOR", desc: "Machine learning demand projections and safety stock targets." }
    };

    const info = titles[target] || { title: "Manager Summary", ref: "MRV-2026", desc: "Executive Report Preview" };
    const titleEl = document.getElementById("rptDocTitleText");
    const refEl = document.getElementById("rptDocRefText");
    const scopeEl = document.getElementById("rptDocScopeText");
    const mgrEl = document.getElementById("rptDocManagerText");
    const timeEl = document.getElementById("rptDocGenTimeText");
    const periodEl = document.getElementById("rptDocPeriodText");

    if (titleEl) titleEl.textContent = info.title;
    if (refEl) refEl.textContent = info.ref;
    if (scopeEl) scopeEl.textContent = state.selectedMaterialName || "All Catalog Raw Materials";
    if (mgrEl) {
        const pBtn = document.getElementById("profileBtn");
        let pName = pBtn?.querySelector("[data-shell-name]")?.textContent?.trim();
        if (!pName || ['manager', 'manager_01', 'user account', 'user'].includes(pName.toLowerCase())) {
            pName = "Aizel";
        }
        mgrEl.textContent = pName;
    }
    if (timeEl) {
        const now = new Date();
        timeEl.textContent = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + ", " + now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    }
    if (periodEl) {
        periodEl.textContent = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    }

    updatePreviewBannerKpis();
}

function updatePreviewBannerKpis() {
    let totalUnits = 0;
    let criticalItems = 0;
    let lowItems = 0;
    let zeroItems = 0;
    let goodItems = 0;

    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    targetMaterials.forEach(m => {
        totalUnits += (m.currentStock || 0);
        if (m.currentStock <= 0) zeroItems++;
        if (m.status === "Critical") criticalItems++;
        else if (m.status === "Low") lowItems++;
        else goodItems++;
    });

    const reorderNow = criticalItems + lowItems;

    const unitsEl = document.getElementById("prevKpiTotalUnits");
    const reorderEl = document.getElementById("prevKpiReorderNow");
    const outEl = document.getElementById("prevKpiOutOfStock");
    const suffEl = document.getElementById("prevKpiSufficient");
    const valEl = document.getElementById("prevKpiTotalValue");

    if (unitsEl) unitsEl.textContent = Math.round(totalUnits).toLocaleString();
    if (reorderEl) reorderEl.textContent = `${reorderNow} Items`;
    if (outEl) outEl.textContent = zeroItems;
    if (suffEl) suffEl.textContent = `${goodItems} Items`;
    if (valEl) valEl.textContent = `${targetMaterials.length} Materials`;
}

function populateMaterialDropdown() {
    const matSelect = document.getElementById("rptMaterialFilter");
    if (!matSelect) return;
    const currentVal = state.selectedMaterialId || "all";
    const sorted = [...state.materials].sort((a, b) => a.name.localeCompare(b.name));
    matSelect.innerHTML = `<option value="all"${currentVal === "all" ? " selected" : ""}>All Raw Materials</option>` + 
        sorted.map(m => `<option value="${escapeHtml(m.id)}"${m.id === currentVal ? " selected" : ""}>${escapeHtml(m.name)}</option>`).join("");
    
    matSelect.onchange = (e) => {
        const val = e.target.value;
        const selectedMat = state.materials.find(m => m.id === val);
        state.selectedMaterialId = val;
        state.selectedMaterialName = selectedMat ? selectedMat.name : "All Catalog Raw Materials";
        
        // Reset sub-tab text search boxes to avoid conflicting filters
        state.invSearch = ""; const invInp = document.getElementById("invSearchInput"); if (invInp) invInp.value = "";
        state.rcvSearch = ""; const rcvInp = document.getElementById("rcvSearchInput"); if (rcvInp) rcvInp.value = "";
        state.disbSearch = ""; const disbInp = document.getElementById("disbSearchInput"); if (disbInp) disbInp.value = "";
        state.actSearch = ""; const actInp = document.getElementById("actSearchInput"); if (actInp) actInp.value = "";
        state.cnsSearch = ""; const cnsInp = document.getElementById("cnsSearchInput"); if (cnsInp) cnsInp.value = "";
        state.fcSearch = ""; const fcInp = document.getElementById("fcSearchInput"); if (fcInp) fcInp.value = "";

        // Reset pagination pages to 1
        state.invPage = 1;
        state.rcvPage = 1;
        state.disbPage = 1;
        state.actPage = 1;
        state.cnsPage = 1;
        state.fcPage = 1;

        const scopeEl = document.getElementById("rptDocScopeText");
        if (scopeEl) scopeEl.textContent = state.selectedMaterialName;

        updateClearBtnVisibility();
        updateMetadataLabels();
        updateCorporatePreviewDetails(state.activeTab);
        renderAllTabs();
        updatePrintDocHtml();

        showToast(`Filtered by ${state.selectedMaterialName}`, "info");
    };

    attachSearchableCombobox(matSelect, {
        placeholder: "Filter specific material...",
        minWidth: "220px",
        maxWidth: "320px"
    });
}

/* ==========================================================
   TOAST NOTIFICATIONS & HELPERS
   ========================================================== */

function showToast(message, type = "success") {
    const stack = document.getElementById("toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
        el.classList.add("leaving");
        setTimeout(() => el.remove(), 260);
    }, 3200);
}

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}

function formatOperatorDisplay(val, fallback = "Manager") {
    if (!val || typeof val !== "string") return fallback;
    const clean = val.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean) || clean.toLowerCase() === "all" || clean.toLowerCase() === "null" || clean === "—" || clean.toLowerCase().includes("authorized") || clean.toLowerCase().includes("staff")) {
        return fallback;
    }
    return clean;
}

function formatContextDisplay(val, fallback = "General Production") {
    if (!val || typeof val !== "string") return fallback;
    const clean = val.trim();
    if (clean.toLowerCase() === "all" || clean.toLowerCase() === "null" || clean === "—" || !clean) {
        return fallback;
    }
    return clean;
}

window.addEventListener("beforeprint", updatePrintDocHtml);

window.__rmimsPrintReport = handlePrintReport;

// Storage sync across tabs and windows (debounced to prevent UI lag)
let _rptStorageDebounce = null;
window.addEventListener("storage", (e) => {
    if (!e.key || e.key.startsWith("rmims_") || e.key.includes("inventory") || e.key.includes("material") || e.key.includes("receipt") || e.key.includes("disburse")) {
        clearTimeout(_rptStorageDebounce);
        _rptStorageDebounce = setTimeout(() => loadAuthoritativeData(), 150);
    }
});

// Supabase Realtime Channel Subscription for live cross-user reports updates
if (supabase && typeof supabase.channel === "function" && !window.__rmimsAdminReportsChannel) {
    window.__rmimsAdminReportsChannel = supabase
        .channel("rmims_admin_reports_sync")
        .on("postgres_changes", { event: "*", schema: "public", table: "raw_materials" }, () => {
            loadAuthoritativeData();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "stock_receipts" }, () => {
            loadAuthoritativeData();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "material_disbursements" }, () => {
            loadAuthoritativeData();
        })
        .subscribe();
}

// Multi-module real-time live synchronization listeners
window.addEventListener("rmims_inventory_updated", () => loadAuthoritativeData());
window.addEventListener("rmims_manager_receipts_updated", () => loadAuthoritativeData());
window.addEventListener("rmims_manager_disbursements_updated", () => loadAuthoritativeData());
window.addEventListener("rmims_staff_transactions_updated", () => loadAuthoritativeData());
window.addEventListener("rmims_forecast_updated", () => loadAuthoritativeData());

try {
    if (typeof BroadcastChannel !== "undefined") {
        const syncChannel = new BroadcastChannel("rmims_user_sync");
        syncChannel.onmessage = () => {
            loadAuthoritativeData();
        };
    }
} catch (_) {}
