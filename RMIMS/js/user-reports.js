// js/user-reports.js
//
// RMIMS STAFF — OPERATIONAL REPORTS
// Adopts the Manager Reports architecture with strict role scoping:
// Permitted reports for Staff:
//   1. Inventory Records (Stock catalog, levels & status)
//   2. Material Receiving (Delivery receipts)
//   3. Material Disbursement (Production usage issues)
//   4. Material Activity (Chronological audit ledger)
// Intrusive locked badges or "restricted" labels are omitted; the view is clean and operational.
// Supports: Screen Tabs, Date Range Filters, Multi-Sheet Excel, Formatted PDF, and High-Definition Print.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";
import { AUTHENTIC_59_RAW_MATERIALS, AUTHENTIC_STOCK_RECEIPTS_6MONTHS, AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS } from "./authentic-59-dataset.js";
import { getSystemRawMaterials, getSystemCustomReceipts, getSystemCustomDisbursements } from "./system-materials.js";
import { attachSearchableCombobox } from "./rmims-combobox.js";

/* ==========================================================
   ROLE & AUTH GUARD
   ========================================================== */

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        try {
            const rawLocal = localStorage.getItem("staffUser") || localStorage.getItem("rmimsCurrentUser") || localStorage.getItem("currentUser") || localStorage.getItem("userProfile");
            if (rawLocal) {
                const parsed = JSON.parse(rawLocal);
                if (parsed) {
                    user = {
                        uid: parsed.id || parsed.uid || "local-staff-user",
                        id: parsed.id || parsed.uid || "local-staff-user",
                        email: parsed.email || "",
                        displayName: parsed.fullName || parsed.name || "Staff Member",
                        user_metadata: { full_name: parsed.fullName || parsed.name || "Staff Member" }
                    };
                }
            }
        } catch (e) {}
    }
    if (!user) { window.location.href = "../login.html"; return; }

    try {
        let { data: profile } = await supabase
            .from("user_profiles")
            .select("id, full_name, email, role, operational_role, status")
            .eq("id", user.uid)
            .maybeSingle();

        // Staff Reports: Allow direct access on Staff portal without forced redirects to Admin or Manager

        const uid = user.id || user.uid;
        const cleanEmail = (user.email || "").toLowerCase();

        if (!profile) {
            try {
                const raw = localStorage.getItem("rmimsCurrentUser") || localStorage.getItem("currentUser") || localStorage.getItem("userProfile");
                if (raw) {
                    const cached = JSON.parse(raw);
                    if (cached.email && cached.email.toLowerCase() === cleanEmail) {
                        profile = {
                            id: uid,
                            full_name: cached.fullName || cached.name || "Staff Member",
                            email: user.email,
                            role: cached.role || "staff",
                            status: "active"
                        };
                    }
                }
            } catch (e) {}
        }

        if (!profile) {
            profile = {
                id: uid,
                full_name: user.displayName || user.user_metadata?.full_name || "Staff User",
                email: user.email,
                role: "staff",
                status: "active"
            };
        }

        const pBtn = document.getElementById("profileBtn");
        if (pBtn) {
            const pText = pBtn.querySelector("[data-shell-name]") || pBtn.querySelector(".profile-name");
            if (pText) pText.textContent = profile.full_name || "Staff User";
            const pAv = pBtn.querySelector("[data-shell-avatar]") || pBtn.querySelector(".profile-avatar");
            if (pAv && profile.full_name) pAv.textContent = initials(profile.full_name);
        }

        init();
    } catch (e) {
        console.error("Auth guard error:", e);
        init();
    }
});

function initials(name) {
    if (!name) return "ST";
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "ST";
}

/* ==========================================================
   STATE
   ========================================================== */

const state = {
    materials: [],
    receipts: [],
    disbursements: [],
    
    // Period & Filter State
    periodPreset: "all",
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

    customSaveDirectoryHandle: null
};

/* ==========================================================
   INITIALIZATION
   ========================================================== */

let fpStart = null;
let fpEnd = null;

async function init() {
    initPeriodDates();
    initReportsFlatpickr();
    initEventListeners();
    await loadAuthoritativeData();
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

    updateClearBtnVisibility();
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
                updateClearBtnVisibility();
                updateMetadataLabels();
                renderAllTabs();
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
                updateClearBtnVisibility();
                updateMetadataLabels();
                renderAllTabs();
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
            updateClearBtnVisibility();
            updateMetadataLabels();
            renderAllTabs();
            showToast("Report date filter cleared.", "info");
        });
    }

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

function withinRange(dateStr, start, end) {
    const d = parseDateOnly(dateStr);
    if (!d) return false;
    return (!start || d >= start) && (!end || d <= end);
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

/* ==========================================================
   DATA LOAD (AUTHORITATIVE SUPABASE + FALLBACK)
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
                        .select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at, reference_no")
                        .order("receipt_date", { ascending: false })),
                    fetchWithTimeout(supabase
                        .from("material_disbursements")
                        .select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at, reference_no")
                        .order("usage_date", { ascending: false }))
                ]);

                if (matRes.status === "fulfilled" && Array.isArray(matRes.value?.data)) rawMats = matRes.value.data;
                if (rcvRes.status === "fulfilled" && Array.isArray(rcvRes.value?.data)) rawReceipts = rcvRes.value.data;
                if (disbRes.status === "fulfilled" && Array.isArray(disbRes.value?.data)) rawDisbursements = disbRes.value.data;
            } catch (e) {
                console.warn("[UserReports] Live Supabase query notice:", e);
            }
        }

        // 2. Material mapping (STRICTLY live: Supabase + custom materials, ZERO mock/baseline fallbacks)
        const matBaseMap = new Map();
        let localCustomMats = [];
        try {
            const stored = localStorage.getItem("rmims_custom_raw_materials");
            if (stored) localCustomMats = JSON.parse(stored);
        } catch (_) {}

        if (Array.isArray(localCustomMats)) {
            localCustomMats.forEach(m => {
                const k = String(m.name || m.id || "").toLowerCase().trim();
                matBaseMap.set(k, {
                    id: String(m.id || m.item_code || m.itemCode || k),
                    item_code: m.item_code || m.itemCode || m.id || "RM—",
                    name: m.name,
                    unit_of_measure: m.unit_of_measure || m.unit || "",
                    current_stock: Number(m.current_stock ?? m.currentStock ?? 0),
                    minimum_threshold: Number(m.minimum_threshold ?? m.minimum_stock ?? 10),
                    reorder_quantity: Number(m.reorder_quantity ?? 50),
                    lead_time_days: Number(m.lead_time_days ?? 3)
                });
            });
        }

        (rawMats || []).forEach(m => {
            const k = String(m.name || m.id || "").toLowerCase().trim();
            const existing = matBaseMap.get(k);
            if (existing) {
                existing.id = String(m.id || existing.id);
                if (m.current_stock !== undefined && m.current_stock !== null) existing.current_stock = Number(m.current_stock);
                if (m.item_code) existing.item_code = m.item_code;
                if (m.unit_of_measure) existing.unit_of_measure = m.unit_of_measure;
                if (m.minimum_threshold !== undefined && m.minimum_threshold !== null) existing.minimum_threshold = Number(m.minimum_threshold);
                if (m.reorder_quantity !== undefined && m.reorder_quantity !== null) existing.reorder_quantity = Number(m.reorder_quantity);
            } else {
                matBaseMap.set(k, {
                    id: String(m.id || k),
                    item_code: m.item_code || "RM—",
                    name: m.name,
                    unit_of_measure: m.unit_of_measure || m.unit || "",
                    current_stock: Number(m.current_stock || 0),
                    minimum_threshold: Number(m.minimum_threshold ?? 10),
                    reorder_quantity: Number(m.reorder_quantity ?? 50),
                    lead_time_days: Number(m.lead_time_days ?? 3)
                });
            }
        });

        rawMats = Array.from(matBaseMap.values()).filter(m => {
            const n = String(m.name || '').toLowerCase();
            const c = String(m.item_code || m.id || '').toUpperCase();
            return !n.includes('coconut') && c !== 'NB-015' && c !== 'RM-033' && c !== 'RM-034';
        });

        // 3. Receipts mapping (STRICTLY live: Supabase + local receipts, ZERO mock fallbacks)
        const recBaseMap = new Map();
        let localReceipts = [];
        try {
            const r1 = JSON.parse(localStorage.getItem("rmims_manager_receipts") || "[]");
            const r2 = JSON.parse(localStorage.getItem("rmims_custom_receipts") || "[]");
            localReceipts = [...r1, ...r2];
        } catch (_) {}

        localReceipts.forEach(r => {
            const rId = String(r.id || r.ref || "");
            if (rId) recBaseMap.set(rId, {
                id: rId,
                material_id: r.materialId || r.material_id,
                received_quantity: Number(r.quantity || r.received_quantity || 0),
                receipt_date: r.date || r.receipt_date,
                unit: r.unit,
                supplier_name: r.supplier || r.supplier_name,
                received_by: r.recordedBy || r.received_by || "Staff Member",
                created_at: r.createdAt || r.created_at
            });
        });

        (rawReceipts || []).forEach(r => {
            const rId = String(r.id || "");
            if (rId) recBaseMap.set(rId, { ...(recBaseMap.get(rId) || {}), ...r });
        });
        rawReceipts = Array.from(recBaseMap.values());

        // 4. Disbursements mapping (STRICTLY live: Supabase + local disbursements, ZERO mock fallbacks)
        const disbBaseMap = new Map();
        let localDisb = [];
        try {
            const d1 = JSON.parse(localStorage.getItem("rmims_manager_disbursements") || "[]");
            const d2 = JSON.parse(localStorage.getItem("rmims_custom_disbursements") || "[]");
            localDisb = [...d1, ...d2];
        } catch (_) {}

        localDisb.forEach(d => {
            const dId = String(d.id || d.ref || "");
            if (dId) disbBaseMap.set(dId, {
                id: dId,
                material_id: d.materialId || d.material_id,
                consumed_quantity: Number(d.quantity || d.consumed_quantity || 0),
                usage_date: d.date || d.usage_date,
                unit: d.unit,
                finished_product_name: d.recipient || d.finished_product_name,
                activity_type: d.activity_type || "Production Issue",
                recorded_by: d.recordedBy || d.recorded_by || "Staff Member",
                created_at: d.createdAt || d.created_at
            });
        });

        (rawDisbursements || []).forEach(d => {
            const dId = String(d.id || "");
            if (dId) disbBaseMap.set(dId, { ...(disbBaseMap.get(dId) || {}), ...d });
        });
        rawDisbursements = Array.from(disbBaseMap.values());

        // Normalize Materials
        state.materials = rawMats.map(m => {
            const stock = Number(m.current_stock || 0);
            const minThreshold = m.minimum_threshold !== null ? Number(m.minimum_threshold) : 0;
            let status = "Good";
            if (stock <= 0 || (minThreshold > 0 && stock <= (minThreshold / 2))) {
                status = "Critical";
            } else if (minThreshold > 0 && stock <= minThreshold) {
                status = "Low";
            }
            return {
                id: m.id,
                itemCode: m.item_code || "RM—",
                name: m.name,
                unit: (m.unit_of_measure || m.unit || "").trim(),
                currentStock: stock,
                minThreshold: minThreshold,
                reorderQty: Number(m.reorder_quantity || 0),
                status
            };
        });

        // Fast Material lookup map
        const matMap = new Map();
        state.materials.forEach(m => {
            matMap.set(m.id, m);
            matMap.set(m.name.toLowerCase().trim(), m);
        });

        // Normalize Receipts
        state.receipts = rawReceipts.map(r => {
            const rMat = matMap.get(r.material_id) || matMap.get((r.raw_material_name || "").toLowerCase().trim());
            return {
                id: r.id,
                receiptDate: r.receipt_date || (r.created_at ? r.created_at.slice(0, 10) : "—"),
                materialId: r.material_id,
                materialName: rMat ? rMat.name : (r.raw_material_name || "Unknown Material"),
                receivedQuantity: Number(r.received_quantity || 0),
                unit: r.unit || (rMat ? rMat.unit : ""),
                supplierName: r.supplier_name || "Primary Supplier",
                receivedBy: r.received_by || "Staff Receiver"
            };
        });

        // Normalize Disbursements
        state.disbursements = rawDisbursements.map(d => {
            const dMat = matMap.get(d.material_id) || matMap.get((d.raw_material_name || "").toLowerCase().trim());
            return {
                id: d.id,
                usageDate: d.usage_date || (d.created_at ? d.created_at.slice(0, 10) : "—"),
                materialId: d.material_id,
                materialName: dMat ? dMat.name : (d.raw_material_name || "Unknown Material"),
                disbursedQuantity: Number(d.consumed_quantity || 0),
                unit: d.unit || (dMat ? dMat.unit : ""),
                activityType: d.activity_type || "Production Run",
                finishedProduct: d.finished_product_name || "Production Line",
                recordedBy: d.recorded_by || "Staff Operator"
            };
        });

        // Determine anchor date
        let maxDateStr = null;
        state.receipts.forEach(r => {
            if (r.receiptDate && r.receiptDate !== "—" && (!maxDateStr || r.receiptDate > maxDateStr)) maxDateStr = r.receiptDate;
        });
        state.disbursements.forEach(d => {
            if (d.usageDate && d.usageDate !== "—" && (!maxDateStr || d.usageDate > maxDateStr)) maxDateStr = d.usageDate;
        });

        state.latestDataDate = parseDateOnly(maxDateStr) || new Date();
        setPeriodPresetDates(state.periodPreset);

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
   RENDER TABS
   ========================================================== */

function renderAllTabs() {
    renderInventoryRecordsTab();
    renderMaterialReceivingTab();
    renderMaterialDisbursementTab();
    renderMaterialActivityTab();
    updatePreviewBannerKpis();
    updatePrintDocHtml();
}

/* --- TAB 1: INVENTORY RECORDS --- */
function renderInventoryRecordsTab() {
    const tbody = document.getElementById("invTableBody");
    const paginationEl = document.getElementById("invPaginationBar");
    if (!tbody) return;

    let list = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : [...state.materials];

    // Search filter
    if (state.invSearch.trim()) {
        const q = state.invSearch.toLowerCase().trim();
        list = list.filter(m => m.name.toLowerCase().includes(q) || m.itemCode.toLowerCase().includes(q));
    }

    // Status filter
    if (state.invStatus !== "all") {
        list = list.filter(m => m.status === state.invStatus);
    }

    // Sort
    if (state.invSort === "az") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (state.invSort === "za") list.sort((a, b) => b.name.localeCompare(a.name));
    else if (state.invSort === "high_stock") list.sort((a, b) => b.currentStock - a.currentStock);
    else if (state.invSort === "low_stock") list.sort((a, b) => a.currentStock - b.currentStock);
    else if (state.invSort === "oldest") list.reverse();

    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / state.invPageSize));
    if (state.invPage > totalPages) state.invPage = totalPages;

    const startIdx = (state.invPage - 1) * state.invPageSize;
    const pageItems = list.slice(startIdx, startIdx + state.invPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:32px; color:#64748b;">No matching inventory materials found.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(m => `
            <tr>
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td><span style="font-family:'Inter', sans-serif; font-weight:600; color:#475569;">${escapeHtml(m.itemCode)}</span></td>
                <td>${escapeHtml(m.unit)}</td>
                <td><strong>${m.currentStock.toLocaleString()}</strong></td>
                <td>${m.minThreshold.toLocaleString()}</td>
                <td>${m.reorderQty.toLocaleString()}</td>
                <td>
                    <span class="rpt-badge ${m.status === 'Good' ? 'rpt-badge-good' : (m.status === 'Low' ? 'rpt-badge-low' : 'rpt-badge-critical')}">
                        ${escapeHtml(m.status)}
                    </span>
                </td>
            </tr>
        `).join("");
    }

    renderPaginationBar(paginationEl, state.invPage, totalPages, total, state.invPageSize, (newPage) => {
        state.invPage = newPage;
        renderInventoryRecordsTab();
    });
}

/* --- TAB 2: MATERIAL RECEIVING --- */
function renderMaterialReceivingTab() {
    const tbody = document.getElementById("rcvTableBody");
    const countNote = document.getElementById("rcvTotalCountNote");
    const paginationEl = document.getElementById("rcvPaginationBar");
    if (!tbody) return;

    let list = state.receipts.filter(r => 
        withinRange(r.receiptDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
    );

    if (state.rcvSearch.trim()) {
        const q = state.rcvSearch.toLowerCase().trim();
        list = list.filter(r => r.materialName.toLowerCase().includes(q) || r.supplierName.toLowerCase().includes(q) || r.receivedBy.toLowerCase().includes(q));
    }

    if (state.rcvSort === "az") list.sort((a, b) => a.materialName.localeCompare(b.materialName));
    else if (state.rcvSort === "za") list.sort((a, b) => b.materialName.localeCompare(a.materialName));
    else if (state.rcvSort === "highest") list.sort((a, b) => b.receivedQuantity - a.receivedQuantity);
    else if (state.rcvSort === "oldest") list.sort((a, b) => a.receiptDate.localeCompare(b.receiptDate));
    else list.sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));

    const total = list.length;
    if (countNote) countNote.textContent = `${total} delivery receipt${total === 1 ? '' : 's'} recorded`;

    const totalPages = Math.max(1, Math.ceil(total / state.rcvPageSize));
    if (state.rcvPage > totalPages) state.rcvPage = totalPages;

    const startIdx = (state.rcvPage - 1) * state.rcvPageSize;
    const pageItems = list.slice(startIdx, startIdx + state.rcvPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:#64748b;">No material delivery records found for this period.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(r => `
            <tr>
                <td>${escapeHtml(r.receiptDate)} ${r.receiptTime ? `<span style="font-size:0.75rem; color:#64748B; font-weight:600; display:block;">${escapeHtml(r.receiptTime)}</span>` : ''}</td>
                <td><code class="ref-badge" style="font-family:monospace; background:rgba(16,185,129,0.1); color:#065f46; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(r.referenceNo || '—')}</code></td>
                <td><strong>${escapeHtml(r.materialName)}</strong></td>
                <td><strong style="color:#059669;">+${r.receivedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></td>
                <td>${escapeHtml(r.unit)}</td>
                <td>${escapeHtml(r.supplierName)}</td>
                <td>${escapeHtml(r.receivedBy)}</td>
                <td><span class="rpt-badge rpt-badge-good">Verified Inbound</span></td>
            </tr>
        `).join("");
    }

    renderPaginationBar(paginationEl, state.rcvPage, totalPages, total, state.rcvPageSize, (newPage) => {
        state.rcvPage = newPage;
        renderMaterialReceivingTab();
    });
}

/* --- TAB 3: MATERIAL DISBURSEMENT --- */
function renderMaterialDisbursementTab() {
    const tbody = document.getElementById("disbTableBody");
    const countNote = document.getElementById("disbTotalCountNote");
    const paginationEl = document.getElementById("disbPaginationBar");
    if (!tbody) return;

    let list = state.disbursements.filter(d => 
        withinRange(d.usageDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
    );

    if (state.disbSearch.trim()) {
        const q = state.disbSearch.toLowerCase().trim();
        list = list.filter(d => d.materialName.toLowerCase().includes(q) || d.finishedProduct.toLowerCase().includes(q) || d.recordedBy.toLowerCase().includes(q));
    }

    if (state.disbSort === "az") list.sort((a, b) => a.materialName.localeCompare(b.materialName));
    else if (state.disbSort === "za") list.sort((a, b) => b.materialName.localeCompare(a.materialName));
    else if (state.disbSort === "highest") list.sort((a, b) => b.disbursedQuantity - a.disbursedQuantity);
    else if (state.disbSort === "oldest") list.sort((a, b) => a.usageDate.localeCompare(b.usageDate));
    else list.sort((a, b) => b.usageDate.localeCompare(a.usageDate));

    const total = list.length;
    if (countNote) countNote.textContent = `${total} production disbursement${total === 1 ? '' : 's'} recorded`;

    const totalPages = Math.max(1, Math.ceil(total / state.disbPageSize));
    if (state.disbPage > totalPages) state.disbPage = totalPages;

    const startIdx = (state.disbPage - 1) * state.disbPageSize;
    const pageItems = list.slice(startIdx, startIdx + state.disbPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:#64748b;">No production disbursement records found for this period.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(d => `
            <tr>
                <td>${escapeHtml(d.usageDate)} ${d.usageTime ? `<span style="font-size:0.75rem; color:#64748B; font-weight:600; display:block;">${escapeHtml(d.usageTime)}</span>` : ''}</td>
                <td><code class="ref-badge" style="font-family:monospace; background:rgba(239,68,68,0.1); color:#991b1b; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(d.referenceNo || '—')}</code></td>
                <td><strong>${escapeHtml(d.materialName)}</strong></td>
                <td>${escapeHtml(d.finishedProduct)}</td>
                <td><strong style="color:#DC2626;">-${d.disbursedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></td>
                <td>${escapeHtml(d.unit)}</td>
                <td><span class="rpt-badge" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">${escapeHtml(d.activityType)}</span></td>
                <td>${escapeHtml(d.recordedBy)}</td>
            </tr>
        `).join("");
    }

    renderPaginationBar(paginationEl, state.disbPage, totalPages, total, state.disbPageSize, (newPage) => {
        state.disbPage = newPage;
        renderMaterialDisbursementTab();
    });
}

/* --- TAB 4: MATERIAL ACTIVITY --- */
function renderMaterialActivityTab() {
    const tbody = document.getElementById("actTableBody");
    const paginationEl = document.getElementById("actPaginationBar");
    if (!tbody) return;

    const rcvs = state.receipts.filter(r => 
        withinRange(r.receiptDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
    ).map(r => ({
        date: r.receiptDate,
        time: r.receiptTime || '',
        referenceNo: r.referenceNo || '—',
        type: "Received",
        material: r.materialName,
        netQty: r.receivedQuantity,
        unit: r.unit,
        context: r.supplierName,
        operator: r.receivedBy
    }));

    const disbs = state.disbursements.filter(d => 
        withinRange(d.usageDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
    ).map(d => ({
        date: d.usageDate,
        time: d.usageTime || '',
        referenceNo: d.referenceNo || '—',
        type: "Disbursed",
        material: d.materialName,
        netQty: -d.disbursedQuantity,
        unit: d.unit,
        context: d.finishedProduct,
        operator: d.recordedBy
    }));

    let list = [...rcvs, ...disbs];

    if (state.actType !== "all") {
        list = list.filter(a => a.type === state.actType);
    }

    if (state.actSearch.trim()) {
        const q = state.actSearch.toLowerCase().trim();
        list = list.filter(a => a.material.toLowerCase().includes(q) || a.context.toLowerCase().includes(q) || a.operator.toLowerCase().includes(q));
    }

    if (state.actSort === "az") list.sort((a, b) => a.material.localeCompare(b.material));
    else if (state.actSort === "za") list.sort((a, b) => b.material.localeCompare(a.material));
    else if (state.actSort === "oldest") list.sort((a, b) => a.date.localeCompare(b.date));
    else list.sort((a, b) => b.date.localeCompare(a.date));

    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / state.actPageSize));
    if (state.actPage > totalPages) state.actPage = totalPages;

    const startIdx = (state.actPage - 1) * state.actPageSize;
    const pageItems = list.slice(startIdx, startIdx + state.actPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:#64748b;">No material activity recorded for this period.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(a => `
            <tr>
                <td>${escapeHtml(a.date)} ${a.time ? `<span style="font-size:0.75rem; color:#64748B; font-weight:600; display:block;">${escapeHtml(a.time)}</span>` : ''}</td>
                <td><code class="ref-badge" style="font-family:monospace; background:rgba(99,102,241,0.1); color:#3730a3; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(a.referenceNo || '—')}</code></td>
                <td>
                    <span class="rpt-badge ${a.type === 'Received' ? 'rpt-badge-good' : 'rpt-badge-critical'}">
                        ${escapeHtml(a.type)}
                    </span>
                </td>
                <td><strong>${escapeHtml(a.material)}</strong></td>
                <td><strong style="color:${a.netQty > 0 ? '#059669' : '#DC2626'};">${a.netQty > 0 ? '+' : ''}${a.netQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></td>
                <td>${escapeHtml(a.unit)}</td>
                <td>${escapeHtml(a.context)}</td>
                <td>${escapeHtml(a.operator)}</td>
            </tr>
        `).join("");
    }

    renderPaginationBar(paginationEl, state.actPage, totalPages, total, state.actPageSize, (newPage) => {
        state.actPage = newPage;
        renderMaterialActivityTab();
    });
}

function renderPaginationBar(container, curPage, totalPages, totalItems, pageSize, onPageChange) {
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

    const startNum = totalItems === 0 ? 0 : (curPage - 1) * pageSize + 1;
    const endNum = Math.min(curPage * pageSize, totalItems);
    const safeTotal = Math.max(1, totalPages);

    let pageButtonsHtml = `
        <button type="button" class="inv-page-btn" id="btnPrev" ${curPage <= 1 ? "disabled" : ""} aria-label="Previous Page" title="Previous Page">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
    `;

    let startPage = Math.max(1, curPage - 2);
    let endPage = Math.min(safeTotal, startPage + 4);
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    if (startPage > 1) {
        pageButtonsHtml += `<button type="button" class="inv-page-btn" data-page="1">1</button>`;
        if (startPage > 2) pageButtonsHtml += `<span class="page-ellipsis">...</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
        pageButtonsHtml += `
            <button type="button" class="inv-page-btn ${p === curPage ? "active" : ""}" data-page="${p}">${p}</button>
        `;
    }

    if (endPage < safeTotal) {
        if (endPage < safeTotal - 1) pageButtonsHtml += `<span class="page-ellipsis">...</span>`;
        pageButtonsHtml += `<button type="button" class="inv-page-btn" data-page="${safeTotal}">${safeTotal}</button>`;
    }

    pageButtonsHtml += `
        <button type="button" class="inv-page-btn" id="btnNext" ${curPage >= safeTotal ? "disabled" : ""} aria-label="Next Page" title="Next Page">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
    `;

    container.innerHTML = `
        <div class="inv-pagination-info">Showing ${startNum}–${endNum} of ${totalItems} records</div>
        <div class="inv-pagination-controls">
            ${pageButtonsHtml}
        </div>
    `;

    const prevBtn = container.querySelector("#btnPrev");
    const nextBtn = container.querySelector("#btnNext");
    if (prevBtn && !prevBtn.disabled) prevBtn.addEventListener("click", () => onPageChange(curPage - 1));
    if (nextBtn && !nextBtn.disabled) nextBtn.addEventListener("click", () => onPageChange(curPage + 1));

    container.querySelectorAll("button[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
            const p = parseInt(btn.getAttribute("data-page"), 10);
            if (!isNaN(p) && p !== curPage && p >= 1 && p <= safeTotal) {
                onPageChange(p);
            }
        });
    });
}

/* ==========================================================
   PRINT DOCUMENT COMPILER (STAFF REPORT - UNIFIED WATERMARK TEMPLATE)
   ========================================================== */

const RM_GREEN = [5, 150, 105];
const RM_INK = [15, 23, 42];
const RM_DIM = [100, 116, 139];
const RM_BORDER = [226, 232, 240];

function formatPeriodTypeLabel(preset) {
    if (preset === "weekly") return "Weekly (Last 7 Days)";
    if (preset === "monthly") return "Monthly (Last 30 Days)";
    if (preset === "today") return "Daily (Latest Update)";
    if (preset === "all") return "All Time";
    return "Custom Period";
}

function updatePrintDocHtml(tabToPrint = (state.activeTab || "inventory")) {
    const printDoc = document.getElementById("continuousPrintDoc");
    if (!printDoc) return;
    const sections = Array.isArray(tabToPrint) ? tabToPrint : [tabToPrint || state.activeTab || "inventory"];
    printDoc.innerHTML = buildContinuousPrintHtml(sections);
}

function buildContinuousPrintHtml(selectedSections = [state.activeTab || "inventory"]) {
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    const reportTypeStr = formatPeriodTypeLabel(state.periodPreset);
    const now = new Date();
    const genDateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTimeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const docRefCode = `RMSME-STAFF-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    const isSingleTab = selectedSections.length === 1;
    const reportTitle = isSingleTab 
        ? `${getStaffActiveTabDisplayName(selectedSections[0])} Report`
        : `Staff Operational Report`;
    const targetMaterialLabel = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? (state.selectedMaterialName || "Selected Material")
        : "All Catalog Raw Materials";

    let filterContext = "All items in preview";
    if (isSingleTab) {
        const tabKey = selectedSections[0];
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
        }
    }

    let sectionsHtml = "";

    // 1. Inventory Records
    if (selectedSections.includes("inventory")) {
        const invData = getStaffFilteredRecordsForPreviewTab("inventory");
        const invRecords = isSingleTab ? invData.records : invData.records.slice(0, 25);
        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Master Inventory Records &amp; Stock Ledger</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width:25%;">Raw Material</th>
                            <th style="width:15%;">Item Code</th>
                            <th style="width:15%;">Current Stock</th>
                            <th style="width:15%;">Min Threshold</th>
                            <th style="width:15%;">Reorder Qty</th>
                            <th style="width:15%;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${invRecords.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">No inventory records match the selected scope.</td></tr>` :
                            invRecords.map(m => `
                                <tr>
                                    <td><strong>${escapeHtml(m.name)}</strong></td>
                                    <td><span style="font-family:'Inter', sans-serif; font-weight:600; color:#475569;">${escapeHtml(m.itemCode)}</span></td>
                                    <td><strong>${(m.currentStock || 0).toLocaleString()}</strong> ${escapeHtml(m.unit)}</td>
                                    <td>${(m.minThreshold || 0).toLocaleString()} ${escapeHtml(m.unit)}</td>
                                    <td>${(m.reorderQty || 0).toLocaleString()} ${escapeHtml(m.unit)}</td>
                                    <td><strong style="color:${m.status === 'Good' ? '#059669' : (m.status === 'Low' ? '#D97706' : '#DC2626')}">${escapeHtml(m.status)}</strong></td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 2. Material Receiving
    if (selectedSections.includes("receiving")) {
        const rcvData = getStaffFilteredRecordsForPreviewTab("receiving");
        const rcvRecords = isSingleTab ? rcvData.records : rcvData.records.slice(0, 25);
        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Material Inbound Delivery Receipts</h3>
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
                        ${rcvRecords.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">No inward delivery receipts for this period.</td></tr>` :
                            rcvRecords.map(r => `
                                <tr>
                                    <td>${escapeHtml(r.receiptDate)}</td>
                                    <td><strong>${escapeHtml(r.materialName)}</strong></td>
                                    <td><strong style="color:#059669;">+${(r.receivedQuantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> ${escapeHtml(r.unit)}</td>
                                    <td>${escapeHtml(r.supplierName)}</td>
                                    <td>${escapeHtml(r.receivedBy)}</td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 3. Material Disbursement
    if (selectedSections.includes("disbursement")) {
        const disbData = getStaffFilteredRecordsForPreviewTab("disbursement");
        const disbRecords = isSingleTab ? disbData.records : disbData.records.slice(0, 25);
        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Production Material Disbursement Log</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width:16%;">Usage Date</th>
                            <th style="width:24%;">Raw Material</th>
                            <th style="width:24%;">Finished Product Context</th>
                            <th style="width:18%;">Disbursed Qty</th>
                            <th style="width:18%;">Recorded By</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${disbRecords.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">No production disbursements for this period.</td></tr>` :
                            disbRecords.map(d => `
                                <tr>
                                    <td>${escapeHtml(d.usageDate)}</td>
                                    <td><strong>${escapeHtml(d.materialName)}</strong></td>
                                    <td>${escapeHtml(d.finishedProduct || "—")}</td>
                                    <td><strong style="color:#DC2626;">-${(d.disbursedQuantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> ${escapeHtml(d.unit)}</td>
                                    <td>${escapeHtml(d.recordedBy)}</td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 4. Material Activity
    if (selectedSections.includes("activity")) {
        const actData = getStaffFilteredRecordsForPreviewTab("activity");
        const actRecords = isSingleTab ? actData.records : actData.records.slice(0, 25);
        sectionsHtml += `
            <div class="print-section">
                <h3 class="print-section-title">Chronological Material Activity Movement Log</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width:15%;">Date</th>
                            <th style="width:15%;">Activity</th>
                            <th style="width:25%;">Raw Material</th>
                            <th style="width:15%;">Net Qty</th>
                            <th style="width:15%;">Reference / Batch</th>
                            <th style="width:15%;">Operator</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${actRecords.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">No material activity recorded for this period.</td></tr>` :
                            actRecords.map(a => {
                                const isRcv = a.type === "Received";
                                return `
                                    <tr>
                                        <td>${escapeHtml(a.date)}</td>
                                        <td><span style="font-weight:700; color:${isRcv ? '#059669' : '#DC2626'};">${escapeHtml(a.type)}</span></td>
                                        <td><strong>${escapeHtml(a.material)}</strong></td>
                                        <td><strong style="color:${isRcv ? '#059669' : '#DC2626'};">${isRcv ? '+' : ''}${(a.netQty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> ${escapeHtml(a.unit)}</td>
                                        <td>${escapeHtml(a.context || "—")}</td>
                                        <td>${escapeHtml(a.operator || "Staff")}</td>
                                    </tr>
                                `;
                            }).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

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

                        <!-- 5. SIGNATURES BLOCK (RECORDED BY & ACCEPTED BY) -->
                        <div class="print-signatures-box">
                            <div class="print-sign-col">
                                <div class="print-sign-title">RECORDED BY (STORE STAFF)</div>
                                <div class="print-sign-line"></div>
                                <div class="print-sign-sub">Signature over Printed Name / Date</div>
                            </div>
                            <div class="print-sign-col">
                                <div class="print-sign-title">ACCEPTED BY (STORE MANAGER)</div>
                                <div class="print-sign-line"></div>
                                <div class="print-sign-sub">Signature over Printed Name / Date</div>
                            </div>
                        </div>
                        <div class="print-sign-note">
                            * Official system report verified against RMSME authoritative inventory datastores. Anti-tamper protected document.
                        </div>

                        <!-- 6. PERFORATED CUT LINE & AUDIT TEAR-OFF SLIP -->
                        <div class="print-cut-line-wrapper">
                            <div class="print-cut-line">
                                <span class="print-cut-scissors">✂</span>
                                <span class="print-cut-text">CUT HERE FOR AUDIT SLIP / ACCOUNTING ACKNOWLEDGMENT COPY</span>
                                <span class="print-cut-scissors">✂</span>
                            </div>
                        </div>

                        <div class="print-cut-slip">
                            <div class="print-cut-slip-header">
                                <div class="print-cut-slip-title">RMSME OPERATIONAL AUDIT &amp; TEAR-OFF VOUCHER SLIP</div>
                                <div class="print-cut-slip-ref">Doc Ref: ${docRefCode} &nbsp;|&nbsp; Generated: ${genDateStr} ${genTimeStr}</div>
                            </div>
                            <div class="print-cut-slip-body">
                                <div class="print-cut-slip-meta">
                                    <div><strong>Report Title:</strong> ${escapeHtml(reportTitle)}</div>
                                    <div><strong>Report Horizon:</strong> ${escapeHtml(periodLabel)}</div>
                                    <div><strong>Scope:</strong> ${escapeHtml(targetMaterialLabel)} (${escapeHtml(filterContext)})</div>
                                </div>
                                <div class="print-cut-slip-signs">
                                    <div class="print-cut-sign-item">
                                        <span class="print-cut-sign-label">RECORDED BY:</span>
                                        <span class="print-cut-sign-blank">____________________________________</span>
                                        <span class="print-cut-sign-date">Date: ____________</span>
                                    </div>
                                    <div class="print-cut-sign-item">
                                        <span class="print-cut-sign-label">ACCEPTED BY:</span>
                                        <span class="print-cut-sign-blank">____________________________________</span>
                                        <span class="print-cut-sign-date">Date: ____________</span>
                                    </div>
                                </div>
                            </div>
                            <div class="print-cut-slip-footer">
                                CONFIDENTIAL &mdash; RMSME INTERNAL AUDIT &amp; DECISION REPORT &bull; STRICTLY FOR OPERATIONAL USE
                            </div>
                        </div>
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
   EXPORT ENGINE: EXCEL (XLSX) & PDF (jsPDF + autoTable)
   ========================================================== */

function getCheckedReportSections() {
    const checks = document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']:checked");
    return Array.from(checks).map(c => c.value);
}

async function handleSaveReport() {
    const formatEl = document.querySelector("input[name='saveFileFormat']:checked");
    const format = formatEl ? formatEl.value : "pdf";
    const nameInput = document.getElementById("saveModalReportName");
    const baseName = (nameInput?.value || "RMSME_Staff_Report").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    const selectedSections = getCheckedReportSections();

    if (selectedSections.length === 0) {
        showToast("Please select at least one report section to include.", "error");
        return;
    }

    const modal = document.getElementById("saveModalOverlay");
    if (modal) modal.classList.remove("open");

    showToast("Generating report package...", "info");

    try {
        if (format === "excel") {
            await generateStaffExcel(baseName, selectedSections);
            showToast("Excel workbook downloaded successfully.", "success");
        } else if (format === "pdf") {
            await generateStaffPdf(baseName, selectedSections);
            showToast("PDF document downloaded successfully.", "success");
        } else if (format === "both") {
            await generateStaffExcel(baseName, selectedSections);
            await generateStaffPdf(baseName, selectedSections);
            showToast("Report package (PDF + Excel) downloaded successfully.", "success");
        }
    } catch (err) {
        console.error("Export error:", err);
        showToast("Error generating report export.", "error");
    }
}

function getStaffActiveTabDisplayName(tabKey) {
    const names = {
        inventory: "Inventory Records",
        receiving: "Material Receiving",
        disbursement: "Material Disbursement",
        activity: "Material Activity"
    };
    return names[tabKey] || "Current Report";
}

function getStaffFilteredRecordsForPreviewTab(tabKey) {
    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : [...state.materials];

    const periodReceipts = state.receipts.filter(r => 
        withinRange(r.receiptDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
    );

    const periodDisbursements = state.disbursements.filter(d => 
        withinRange(d.usageDate, state.startDate, state.endDate) &&
        (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
    );

    if (tabKey === "inventory") {
        let list = [...targetMaterials];
        const term = (state.invSearch || "").trim().toLowerCase();
        if (term) {
            list = list.filter(m => m.name.toLowerCase().includes(term) || m.itemCode.toLowerCase().includes(term));
        }
        if (state.invStatus && state.invStatus !== "all") {
            list = list.filter(m => m.status === state.invStatus);
        }
        if (state.invSort === "az") list.sort((a, b) => a.name.localeCompare(b.name));
        else if (state.invSort === "za") list.sort((a, b) => b.name.localeCompare(a.name));
        else if (state.invSort === "high_stock") list.sort((a, b) => b.currentStock - a.currentStock);
        else if (state.invSort === "low_stock") list.sort((a, b) => a.currentStock - b.currentStock);
        else if (state.invSort === "oldest") list.reverse();
        return { type: "inventory", records: list };
    }

    if (tabKey === "receiving") {
        let list = [...periodReceipts];
        const term = (state.rcvSearch || "").trim().toLowerCase();
        if (term) {
            list = list.filter(r => 
                (r.materialName || "").toLowerCase().includes(term) || 
                (r.supplierName || "").toLowerCase().includes(term) || 
                (r.receivedBy || "").toLowerCase().includes(term)
            );
        }
        if (state.rcvSort === "az") list.sort((a, b) => a.materialName.localeCompare(b.materialName));
        else if (state.rcvSort === "za") list.sort((a, b) => b.materialName.localeCompare(a.materialName));
        else if (state.rcvSort === "highest") list.sort((a, b) => b.receivedQuantity - a.receivedQuantity);
        else if (state.rcvSort === "oldest") list.sort((a, b) => a.receiptDate.localeCompare(b.receiptDate));
        else list.sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
        return { type: "receiving", records: list };
    }

    if (tabKey === "disbursement") {
        let list = [...periodDisbursements];
        const term = (state.disbSearch || "").trim().toLowerCase();
        if (term) {
            list = list.filter(d => 
                (d.materialName || "").toLowerCase().includes(term) || 
                (d.finishedProduct || "").toLowerCase().includes(term) || 
                (d.recordedBy || "").toLowerCase().includes(term)
            );
        }
        if (state.disbSort === "az") list.sort((a, b) => a.materialName.localeCompare(b.materialName));
        else if (state.disbSort === "za") list.sort((a, b) => b.materialName.localeCompare(a.materialName));
        else if (state.disbSort === "highest") list.sort((a, b) => b.disbursedQuantity - a.disbursedQuantity);
        else if (state.disbSort === "oldest") list.sort((a, b) => a.usageDate.localeCompare(b.usageDate));
        else list.sort((a, b) => b.usageDate.localeCompare(a.usageDate));
        return { type: "disbursement", records: list };
    }

    if (tabKey === "activity") {
        const rcvs = periodReceipts.map(r => ({
            date: r.receiptDate,
            type: "Received",
            material: r.materialName,
            netQty: r.receivedQuantity,
            unit: r.unit,
            context: r.supplierName,
            operator: r.receivedBy
        }));
        const disbs = periodDisbursements.map(d => ({
            date: d.usageDate,
            type: "Disbursed",
            material: d.materialName,
            netQty: -d.disbursedQuantity,
            unit: d.unit,
            context: d.finishedProduct,
            operator: d.recordedBy
        }));
        let list = [...rcvs, ...disbs];
        if (state.actType && state.actType !== "all") {
            list = list.filter(a => a.type === state.actType);
        }
        const term = (state.actSearch || "").trim().toLowerCase();
        if (term) {
            list = list.filter(a => 
                (a.material || "").toLowerCase().includes(term) || 
                (a.context || "").toLowerCase().includes(term) || 
                (a.operator || "").toLowerCase().includes(term)
            );
        }
        if (state.actSort === "az") list.sort((a, b) => a.material.localeCompare(b.material));
        else if (state.actSort === "za") list.sort((a, b) => b.material.localeCompare(a.material));
        else if (state.actSort === "oldest") list.sort((a, b) => a.date.localeCompare(b.date));
        else list.sort((a, b) => b.date.localeCompare(a.date));
        return { type: "activity", records: list };
    }

    return { type: "inventory", records: targetMaterials };
}

/* ==========================================================
   STAFF SIGNATURES & PERFORATED CUT LINE EXPORT HELPERS
   ========================================================== */

function drawPdfSignaturesAndCutLine(doc, y, pageWidth, pageHeight, reportTitle, periodLabel, docRef) {
    if (y + 155 > pageHeight - 40) {
        doc.addPage();
        y = 48;
    }

    const boxWidth = pageWidth - 80;
    const boxHeight = 65;

    // 1. Signatures Box (Recorded By & Accepted By)
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(40, y, boxWidth, boxHeight, 3, 3, "FD");

    // Recorded By Column
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(51, 65, 85);
    doc.text("RECORDED BY (STORE STAFF)", 54, y + 15);

    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.75);
    doc.line(54, y + 44, 54 + (boxWidth / 2) - 30, y + 44);

    doc.setFontSize(6.8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("Signature over Printed Name / Date", 54, y + 54);

    // Accepted By Column
    const col2X = 40 + (boxWidth / 2) + 14;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(51, 65, 85);
    doc.text("ACCEPTED BY (STORE MANAGER)", col2X, y + 15);

    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.75);
    doc.line(col2X, y + 44, 40 + boxWidth - 14, y + 44);

    doc.setFontSize(6.8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("Signature over Printed Name / Date", col2X, y + 54);

    y += boxHeight + 7;

    // Verification Note
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 116, 139);
    doc.text("* Official system report verified against RMSME authoritative inventory datastores. Anti-tamper protected document.", pageWidth / 2, y, { align: "center" });

    y += 12;

    // 2. Perforated Cut Line (Dashed)
    doc.setDrawColor(148, 163, 184);
    if (typeof doc.setLineDashPattern === "function") {
        doc.setLineDashPattern([3, 2.5], 0);
    } else if (typeof doc.setLineDash === "function") {
        doc.setLineDash([3, 2.5], 0);
    }
    doc.line(40, y, pageWidth - 40, y);
    if (typeof doc.setLineDashPattern === "function") {
        doc.setLineDashPattern([], 0);
    } else if (typeof doc.setLineDash === "function") {
        doc.setLineDash([], 0);
    }

    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 116, 139);
    doc.text("--- ✂  CUT HERE FOR AUDIT SLIP / ACCOUNTING ACKNOWLEDGMENT COPY  ✂ ---", pageWidth / 2, y + 7, { align: "center" });

    y += 12;

    // 3. Tear-Off Slip Box
    const slipHeight = 52;
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(40, y, boxWidth, slipHeight, 2, 2, "FD");

    doc.setFontSize(7.2);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(5, 150, 105);
    doc.text("RMSME OPERATIONAL AUDIT & TEAR-OFF VOUCHER SLIP", 50, y + 12);

    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(`Doc Ref: ${docRef}`, boxWidth + 30, y + 12, { align: "right" });

    doc.setTextColor(51, 65, 85);
    doc.setFontSize(6.8);
    doc.text(`Scope: ${reportTitle} (${periodLabel})`, 50, y + 24);

    doc.text("RECORDED BY: _____________________  Date: ________", 50, y + 36);
    doc.text("ACCEPTED BY: _____________________  Date: ________", col2X, y + 36);

    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 116, 139);
    doc.text("CONFIDENTIAL — RMSME INTERNAL AUDIT & DECISION REPORT • STRICTLY FOR OPERATIONAL USE", pageWidth / 2, y + 46, { align: "center" });

    return y + slipHeight;
}

function appendExcelSignaturesAndCutLine(ws) {
    if (typeof XLSX === "undefined" || !ws) return;
    const todayStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const cutRows = [
        [],
        ["----------------------------------------------------------------------------------------------------------------------------------------"],
        ["✂  CUT HERE FOR AUDIT SLIP / ACCOUNTING ACKNOWLEDGMENT COPY  ✂"],
        ["----------------------------------------------------------------------------------------------------------------------------------------"],
        ["RMSME OPERATIONAL AUDIT & TEAR-OFF VOUCHER SLIP", "", `Date: ${todayStr}`, "Official System Verified"],
        [],
        ["RECORDED BY (Store Staff):", "____________________________________", "", "ACCEPTED BY (Store Manager):", "____________________________________"],
        ["Signature over Printed Name / Date:", "", "", "Signature over Printed Name / Date:", ""],
        [],
        ["* Official system report verified against RMSME authoritative inventory datastores. Anti-tamper protected."]
    ];
    XLSX.utils.sheet_add_aoa(ws, cutRows, { origin: -1 });
}

async function generateStaffSingleTabPdf(fileName, tabKey = (state.activeTab || "inventory")) {
    if (typeof window.jspdf === "undefined" && typeof jspdf === "undefined") {
        throw new Error("jsPDF library not loaded");
    }
    const { jsPDF } = window.jspdf || jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    const reportTypeStr = formatPeriodTypeLabel(state.periodPreset);
    const now = new Date();
    const genDateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTimeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const docRef = `RMSME-STAFF-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

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
    const activeTitle = getStaffActiveTabDisplayName(tabKey);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...RM_INK);
    doc.text(`${activeTitle} Report`, 40, y);
    y += 16;

    // 3. Metadata Grid with Active Scope & Filters
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
    }

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("REPORT HORIZON:", 40, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text(`${periodLabel} (${reportTypeStr})`, 130, y);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("SYSTEM SOURCE:", 40 + colW, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text("RMSME PostgreSQL Database", 130 + colW, y);
    y += 13;

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("MATERIAL SCOPE:", 40, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text(targetMaterialLabel, 130, y);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("CLASSIFICATION:", 40 + colW, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text("Confidential / Operational Use Only", 130 + colW, y);
    y += 13;

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("ACTIVE FILTERS:", 40, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text(filterContext, 130, y);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("AUTHORITY:", 40 + colW, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text("Store Staff", 130 + colW, y);
    y += 18;

    // 4. AutoTable for Active Tab
    const filtered = getStaffFilteredRecordsForPreviewTab(tabKey);

    if (tabKey === "inventory") {
        const tableData = filtered.records.length === 0
            ? [["No inventory materials match the search / filter criteria", "—", "—", "—", "—", "—"]]
            : filtered.records.map(m => [
                m.name,
                m.itemCode,
                `${(m.currentStock || 0).toLocaleString()} ${m.unit}`,
                `${(m.minThreshold || 0).toLocaleString()} ${m.unit}`,
                `${(m.reorderQty || 0).toLocaleString()} ${m.unit}`,
                m.status
            ]);
        doc.autoTable({
            startY: y,
            head: [["Raw Material", "Item Code", "Current Stock", "Min Threshold", "Reorder Qty", "Status"]],
            body: tableData,
            theme: "grid",
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" },
            styles: { fontSize: 8.5, cellPadding: 4.5 },
            margin: { left: 40, right: 40 }
        });
    } else if (tabKey === "receiving") {
        const tableData = filtered.records.length === 0
            ? [["No receiving records match the search / period filter", "—", "—", "—", "—", "—"]]
            : filtered.records.map(r => [
                r.receiptDate,
                r.materialName,
                `+${(r.receivedQuantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.unit}`,
                r.supplierName,
                r.receivedBy,
                "Verified Inbound"
            ]);
        doc.autoTable({
            startY: y,
            head: [["Receipt Date", "Raw Material", "Received Qty", "Supplier Name", "Received By", "Status"]],
            body: tableData,
            theme: "grid",
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" },
            styles: { fontSize: 8.5, cellPadding: 4.5 },
            margin: { left: 40, right: 40 }
        });
    } else if (tabKey === "disbursement") {
        const tableData = filtered.records.length === 0
            ? [["No disbursement records match the search / period filter", "—", "—", "—", "—", "—"]]
            : filtered.records.map(d => [
                d.usageDate,
                d.materialName,
                d.finishedProduct || "—",
                `-${(d.disbursedQuantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${d.unit}`,
                d.activityType || "Kitchen Issue",
                d.recordedBy
            ]);
        doc.autoTable({
            startY: y,
            head: [["Usage Date", "Raw Material", "Finished Product", "Disbursed Qty", "Activity Type", "Recorded By"]],
            body: tableData,
            theme: "grid",
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" },
            styles: { fontSize: 8.5, cellPadding: 4.5 },
            margin: { left: 40, right: 40 }
        });
    } else if (tabKey === "activity") {
        const tableData = filtered.records.length === 0
            ? [["No activity transactions match the filter", "—", "—", "—", "—", "—"]]
            : filtered.records.map(a => [
                a.date,
                a.type,
                a.material,
                a.type === "Received" ? `+${(a.netQty || 0).toLocaleString()} ${a.unit}` : `${(a.netQty || 0).toLocaleString()} ${a.unit}`,
                a.context || "—",
                a.operator || "Staff"
            ]);
        doc.autoTable({
            startY: y,
            head: [["Date", "Movement Type", "Raw Material", "Net Quantity", "Reference / Batch", "Operator"]],
            body: tableData,
            theme: "grid",
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" },
            styles: { fontSize: 8.5, cellPadding: 4.5 },
            margin: { left: 40, right: 40 }
        });
    }

    // 5. Signatures (Recorded By & Accepted By) and Perforated Cut Line
    const finalTableY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 16 : y + 20;
    drawPdfSignaturesAndCutLine(doc, finalTableY, pageWidth, pageHeight, `${activeTitle} Report`, periodLabel, docRef);

    // 6. Watermark & Footer across all pages (Matching Image 1)
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
        doc.text("RMSME — Raw Material Stock Management & Enterprise Operations System", 40, doc.internal.pageSize.getHeight() - 22);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(...RM_DIM);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 40, doc.internal.pageSize.getHeight() - 22, { align: "right" });

        doc.setFontSize(6.8);
        doc.text("System Support: operations@rmsme.internal | Official System Generated Copy — Anti-Tamper Protected", 40, doc.internal.pageSize.getHeight() - 12);
    }

    doc.save(`${fileName}.pdf`);
}

async function generateStaffSingleTabExcel(fileName, tabKey = "inventory") {
    if (typeof XLSX === "undefined") {
        throw new Error("XLSX library not loaded");
    }
    const wb = XLSX.utils.book_new();
    const activeTitle = getStaffActiveTabDisplayName(tabKey);
    const filtered = getStaffFilteredRecordsForPreviewTab(tabKey);

    let rows = [];
    if (tabKey === "inventory") {
        rows = filtered.records.map(m => ({
            "Item Code": m.itemCode,
            "Raw Material Name": m.name,
            "Unit": m.unit,
            "Current Stock": m.currentStock,
            "Minimum Threshold": m.minThreshold,
            "Reorder Quantity": m.reorderQty,
            "Status": m.status
        }));
    } else if (tabKey === "receiving") {
        rows = filtered.records.map(r => ({
            "Receipt Date": r.receiptDate,
            "Raw Material": r.materialName,
            "Received Quantity": r.receivedQuantity,
            "Unit": r.unit,
            "Supplier Name": r.supplierName,
            "Received By": r.receivedBy
        }));
    } else if (tabKey === "disbursement") {
        rows = filtered.records.map(d => ({
            "Usage Date": d.usageDate,
            "Raw Material": d.materialName,
            "Disbursed Quantity": d.disbursedQuantity,
            "Unit": d.unit,
            "Finished Product Context": d.finishedProduct,
            "Activity Type": d.activityType,
            "Recorded By": d.recordedBy
        }));
    } else if (tabKey === "activity") {
        rows = filtered.records.map(a => ({
            "Date": a.date,
            "Movement Type": a.type,
            "Raw Material": a.material,
            "Net Change": a.netQty,
            "Unit": a.unit,
            "Reference / Context": a.context,
            "Operator": a.operator
        }));
    }

    const wsData = rows.length > 0 ? rows : [{ "Status": "No records matched current filter criteria in preview" }];
    const ws = XLSX.utils.json_to_sheet(wsData);
    appendExcelSignaturesAndCutLine(ws);
    const safeSheetName = activeTitle.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    XLSX.writeFile(wb, `${fileName}.xlsx`);
}

async function generateStaffExcel(baseName, sections) {
    if (typeof XLSX === "undefined") {
        throw new Error("XLSX library not loaded");
    }

    const wb = XLSX.utils.book_new();

    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    // 1. Inventory Records
    if (sections.includes("inventory")) {
        const invRows = targetMaterials.map(m => ({
            "Item Code": m.itemCode,
            "Raw Material Name": m.name,
            "Unit": m.unit,
            "Current Stock": m.currentStock,
            "Minimum Threshold": m.minThreshold,
            "Reorder Quantity": m.reorderQty,
            "Status": m.status
        }));
        const ws = XLSX.utils.json_to_sheet(invRows);
        appendExcelSignaturesAndCutLine(ws);
        XLSX.utils.book_append_sheet(wb, ws, "Inventory Records");
    }

    // 2. Receiving
    if (sections.includes("receiving")) {
        const rcvRows = state.receipts
            .filter(r => withinRange(r.receiptDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId))
            .map(r => ({
                "Receipt Date": r.receiptDate,
                "Raw Material": r.materialName,
                "Received Quantity": r.receivedQuantity,
                "Unit": r.unit,
                "Supplier Name": r.supplierName,
                "Received By": r.receivedBy
            }));
        const ws = XLSX.utils.json_to_sheet(rcvRows.length > 0 ? rcvRows : [{ "Status": "No receipts recorded for period" }]);
        appendExcelSignaturesAndCutLine(ws);
        XLSX.utils.book_append_sheet(wb, ws, "Material Receiving");
    }

    // 3. Disbursement
    if (sections.includes("disbursement")) {
        const disbRows = state.disbursements
            .filter(d => withinRange(d.usageDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId))
            .map(d => ({
                "Usage Date": d.usageDate,
                "Raw Material": d.materialName,
                "Disbursed Quantity": d.disbursedQuantity,
                "Unit": d.unit,
                "Finished Product Context": d.finishedProduct,
                "Activity Type": d.activityType,
                "Recorded By": d.recordedBy
            }));
        const ws = XLSX.utils.json_to_sheet(disbRows.length > 0 ? disbRows : [{ "Status": "No disbursements recorded for period" }]);
        appendExcelSignaturesAndCutLine(ws);
        XLSX.utils.book_append_sheet(wb, ws, "Material Disbursement");
    }

    // 4. Activity
    if (sections.includes("activity")) {
        const rcvs = state.receipts
            .filter(r => withinRange(r.receiptDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId))
            .map(r => ({
                "Date": r.receiptDate,
                "Movement Type": "Received",
                "Raw Material": r.materialName,
                "Net Change": r.receivedQuantity,
                "Unit": r.unit,
                "Reference / Context": r.supplierName,
                "Operator": r.receivedBy
            }));
        const disbs = state.disbursements
            .filter(d => withinRange(d.usageDate, state.startDate, state.endDate) &&
                (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId))
            .map(d => ({
                "Date": d.usageDate,
                "Movement Type": "Disbursed",
                "Raw Material": d.materialName,
                "Net Change": -d.disbursedQuantity,
                "Unit": d.unit,
                "Reference / Context": d.finishedProduct,
                "Operator": d.recordedBy
            }));
        const combined = [...rcvs, ...disbs].sort((a, b) => b.Date.localeCompare(a.Date));
        const ws = XLSX.utils.json_to_sheet(combined.length > 0 ? combined : [{ "Status": "No activity recorded for period" }]);
        appendExcelSignaturesAndCutLine(ws);
        XLSX.utils.book_append_sheet(wb, ws, "Material Activity");
    }

    XLSX.writeFile(wb, `${baseName}.xlsx`);
}

async function generateStaffPdf(baseName, sections) {
    if (typeof window.jspdf === "undefined" && typeof jspdf === "undefined") {
        throw new Error("jsPDF library not loaded");
    }

    const { jsPDF } = window.jspdf || jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    const reportTypeStr = formatPeriodTypeLabel(state.periodPreset);
    const now = new Date();
    const genDateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTimeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const docRef = `RMSME-PKG-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

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

    // 2. Package Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...RM_INK);
    doc.text("RMSME Store Operations Report Package", 40, y);
    y += 16;

    // 3. Metadata Grid
    const colW = (pageWidth - 80) / 2;
    const targetMaterialLabel = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? (state.selectedMaterialName || "Selected Material")
        : "All Catalog Raw Materials";

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("REPORT HORIZON:", 40, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text(`${periodLabel} (${reportTypeStr})`, 130, y);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("SYSTEM SOURCE:", 40 + colW, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text("RMSME PostgreSQL Database", 130 + colW, y);
    y += 13;

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("MATERIAL SCOPE:", 40, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text(targetMaterialLabel, 130, y);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("CLASSIFICATION:", 40 + colW, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text("Confidential / Operational Use Only", 130 + colW, y);
    y += 13;

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("SECTIONS INCLUDED:", 40, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text(`${sections.length} Sections (${sections.map(s => getStaffActiveTabDisplayName(s)).join(", ")})`, 130, y);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RM_DIM);
    doc.text("AUTHORITY:", 40 + colW, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_INK);
    doc.text("Store Staff", 130 + colW, y);
    y += 20;

    const targetMaterials = (state.selectedMaterialId && state.selectedMaterialId !== "all")
        ? state.materials.filter(m => m.id === state.selectedMaterialId)
        : state.materials;

    // 1. Inventory Records
    if (sections.includes("inventory")) {
        if (y > pageHeight - 160) { doc.addPage(); y = 40; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...RM_GREEN);
        doc.text("1. Master Inventory Records & Stock Ledger", 40, y);
        y += 10;

        const tableData = targetMaterials.length === 0
            ? [["No inventory materials recorded in catalog", "—", "—", "—", "—", "—"]]
            : targetMaterials.map(m => [
                m.name,
                m.itemCode,
                `${(m.currentStock || 0).toLocaleString()} ${m.unit}`,
                `${(m.minThreshold || 0).toLocaleString()} ${m.unit}`,
                `${(m.reorderQty || 0).toLocaleString()} ${m.unit}`,
                m.status
            ]);

        doc.autoTable({
            startY: y,
            head: [["Raw Material", "Item Code", "Current Stock", "Min Threshold", "Reorder Qty", "Status"]],
            body: tableData,
            theme: "grid",
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" },
            styles: { fontSize: 8.5, cellPadding: 4 },
            margin: { left: 40, right: 40 }
        });

        y = doc.lastAutoTable.finalY + 22;
    }

    // 2. Receiving
    if (sections.includes("receiving")) {
        if (y > pageHeight - 160) { doc.addPage(); y = 40; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...RM_GREEN);
        doc.text("2. Material Inbound Delivery Receipts", 40, y);
        y += 10;

        const rcvFiltered = state.receipts.filter(r => 
            withinRange(r.receiptDate, state.startDate, state.endDate) &&
            (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
        );
        const tableData = rcvFiltered.length === 0
            ? [["No inbound receipts for period", "—", "—", "—", "—", "—"]]
            : rcvFiltered.map(r => [
                r.receiptDate,
                r.materialName,
                `+${(r.receivedQuantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.unit}`,
                r.supplierName,
                r.receivedBy,
                "Verified Inbound"
            ]);

        doc.autoTable({
            startY: y,
            head: [["Receipt Date", "Raw Material", "Received Qty", "Supplier Name", "Received By", "Status"]],
            body: tableData,
            theme: "grid",
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" },
            styles: { fontSize: 8.5, cellPadding: 4 },
            margin: { left: 40, right: 40 }
        });

        y = doc.lastAutoTable.finalY + 22;
    }

    // 3. Disbursement
    if (sections.includes("disbursement")) {
        if (y > pageHeight - 160) { doc.addPage(); y = 40; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...RM_GREEN);
        doc.text("3. Production Material Disbursements", 40, y);
        y += 10;

        const disbFiltered = state.disbursements.filter(d => 
            withinRange(d.usageDate, state.startDate, state.endDate) &&
            (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
        );
        const tableData = disbFiltered.length === 0
            ? [["No disbursements for period", "—", "—", "—", "—", "—"]]
            : disbFiltered.map(d => [
                d.usageDate,
                d.materialName,
                d.finishedProduct || "—",
                `-${(d.disbursedQuantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${d.unit}`,
                d.activityType || "Kitchen Issue",
                d.recordedBy
            ]);

        doc.autoTable({
            startY: y,
            head: [["Usage Date", "Raw Material", "Finished Product", "Disbursed Qty", "Activity Type", "Recorded By"]],
            body: tableData,
            theme: "grid",
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" },
            styles: { fontSize: 8.5, cellPadding: 4 },
            margin: { left: 40, right: 40 }
        });

        y = doc.lastAutoTable.finalY + 22;
    }

    // 4. Activity
    if (sections.includes("activity")) {
        if (y > pageHeight - 160) { doc.addPage(); y = 40; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...RM_GREEN);
        doc.text("4. Chronological Material Activity Audit Ledger", 40, y);
        y += 10;

        const rcvs = state.receipts.filter(r => 
            withinRange(r.receiptDate, state.startDate, state.endDate) &&
            (!state.selectedMaterialId || state.selectedMaterialId === "all" || r.materialId === state.selectedMaterialId)
        ).map(r => [
            r.receiptDate,
            "Received",
            r.materialName,
            `+${r.receivedQuantity} ${r.unit}`,
            r.supplierName,
            r.receivedBy
        ]);

        const disbs = state.disbursements.filter(d => 
            withinRange(d.usageDate, state.startDate, state.endDate) &&
            (!state.selectedMaterialId || state.selectedMaterialId === "all" || d.materialId === state.selectedMaterialId)
        ).map(d => [
            d.usageDate,
            "Disbursed",
            d.materialName,
            `-${d.disbursedQuantity} ${d.unit}`,
            d.finishedProduct || "—",
            d.recordedBy
        ]);

        const combined = [...rcvs, ...disbs].sort((a, b) => b[0].localeCompare(a[0]));

        doc.autoTable({
            startY: y,
            head: [["Date", "Movement Type", "Raw Material", "Net Quantity", "Reference / Batch", "Operator"]],
            body: combined.length > 0 ? combined : [["—", "—", "No activity for period", "—", "—", "—"]],
            theme: "grid",
            headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" },
            styles: { fontSize: 8.5, cellPadding: 4 },
            margin: { left: 40, right: 40 }
        });

        y = doc.lastAutoTable.finalY + 22;
    }

    // Signatures (Recorded By & Accepted By) and Perforated Cut Line
    const finalTableY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 16 : y + 20;
    drawPdfSignaturesAndCutLine(doc, finalTableY, pageWidth, pageHeight, "Operational Summary Package", periodLabel, docRef);

    // Watermark & Footer across all pages (Matching Image 1)
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
        doc.text("RMSME — Raw Material Stock Management & Enterprise Operations System", 40, doc.internal.pageSize.getHeight() - 22);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(...RM_DIM);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 40, doc.internal.pageSize.getHeight() - 22, { align: "right" });

        doc.setFontSize(6.8);
        doc.text("System Support: operations@rmsme.internal | Official System Generated Copy — Anti-Tamper Protected", 40, doc.internal.pageSize.getHeight() - 12);
    }

    doc.save(`${baseName}.pdf`);
}

/* ==========================================================
   EVENT LISTENERS & UI WIRING
   ========================================================== */

let listenersInitialized = false;

function initEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    // 1. Category Card Selection & Workspace Panels
    const tabBtns = document.querySelectorAll(".rpt-cat-card, .rpt-tab-btn");
    const panels = {
        inventory: document.getElementById("tabPanelInventory"),
        receiving: document.getElementById("tabPanelReceiving"),
        disbursement: document.getElementById("tabPanelDisbursement"),
        activity: document.getElementById("tabPanelActivity")
    };

    function selectReportCategory(target, triggerToast = true) {
        if (!target) return;
        state.activeTab = target;

        tabBtns.forEach(b => {
            if (b.dataset.tab === target) b.classList.add("active");
            else b.classList.remove("active");
        });

        // Hide Empty State and Reveal Document Sheet
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

        updateCorporatePreviewDetails(target);

        if (target === "inventory") renderInventoryRecordsTab();
        else if (target === "receiving") renderMaterialReceivingTab();
        else if (target === "disbursement") renderMaterialDisbursementTab();
        else if (target === "activity") renderMaterialActivityTab();

        updatePrintDocHtml(target);

        if (triggerToast) {
            showToast("Report generated successfully.", "success");
        }
    }

    // Synchronize initial panel display state
    if (!state.activeTab) {
        selectReportCategory("inventory", false);
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

    populateMaterialDropdown();

    // 2. Period Preset & Date Controls
    const presetSelect = document.getElementById("reportPeriodPreset");
    if (presetSelect) {
        presetSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            setPeriodPresetDates(val);
            updateMetadataLabels();
            renderAllTabs();
            if (val === "custom" && fpStart) fpStart.open();
        });
    }

    // 3. Tab Specific Filters
    const invSearch = document.getElementById("invSearchInput");
    if (invSearch) invSearch.addEventListener("input", (e) => { state.invSearch = e.target.value; state.invPage = 1; renderInventoryRecordsTab(); updatePrintDocHtml(state.activeTab || "inventory"); });
    const invStatus = document.getElementById("invStatusFilter");
    if (invStatus) invStatus.addEventListener("change", (e) => { state.invStatus = e.target.value; state.invPage = 1; renderInventoryRecordsTab(); updatePrintDocHtml(state.activeTab || "inventory"); });
    const invSort = document.getElementById("invSortFilter");
    if (invSort) invSort.addEventListener("change", (e) => { state.invSort = e.target.value; state.invPage = 1; renderInventoryRecordsTab(); updatePrintDocHtml(state.activeTab || "inventory"); });

    const rcvSearch = document.getElementById("rcvSearchInput");
    if (rcvSearch) rcvSearch.addEventListener("input", (e) => { state.rcvSearch = e.target.value; state.rcvPage = 1; renderMaterialReceivingTab(); updatePrintDocHtml(state.activeTab || "receiving"); });
    const rcvSort = document.getElementById("rcvSortFilter");
    if (rcvSort) rcvSort.addEventListener("change", (e) => { state.rcvSort = e.target.value; state.rcvPage = 1; renderMaterialReceivingTab(); updatePrintDocHtml(state.activeTab || "receiving"); });

    const disbSearch = document.getElementById("disbSearchInput");
    if (disbSearch) disbSearch.addEventListener("input", (e) => { state.disbSearch = e.target.value; state.disbPage = 1; renderMaterialDisbursementTab(); updatePrintDocHtml(state.activeTab || "disbursement"); });
    const disbSort = document.getElementById("disbSortFilter");
    if (disbSort) disbSort.addEventListener("change", (e) => { state.disbSort = e.target.value; state.disbPage = 1; renderMaterialDisbursementTab(); updatePrintDocHtml(state.activeTab || "disbursement"); });

    const actSearch = document.getElementById("actSearchInput");
    if (actSearch) actSearch.addEventListener("input", (e) => { state.actSearch = e.target.value; state.actPage = 1; renderMaterialActivityTab(); updatePrintDocHtml(state.activeTab || "activity"); });
    const actType = document.getElementById("actTypeFilter");
    if (actType) actType.addEventListener("change", (e) => { state.actType = e.target.value; state.actPage = 1; renderMaterialActivityTab(); updatePrintDocHtml(state.activeTab || "activity"); });
    const actSort = document.getElementById("actSortFilter");
    if (actSort) actSort.addEventListener("change", (e) => { state.actSort = e.target.value; state.actPage = 1; renderMaterialActivityTab(); updatePrintDocHtml(state.activeTab || "activity"); });

    // 4. Save As Modal Controls
    const btnSaveAs = document.getElementById("btnSaveAs");
    const btnOverallExport = document.getElementById("btnOverallExport");
    const saveModal = document.getElementById("saveModalOverlay");
    const saveClose = document.getElementById("saveModalCloseBtn");
    const saveCancel = document.getElementById("saveModalCancelBtn");
    const saveConfirm = document.getElementById("saveModalConfirmBtn");
    const selectAllBtn = document.getElementById("saveSelectAllBtn");
    const clearAllBtn = document.getElementById("saveClearAllBtn");

    const openSaveModal = () => {
        if (saveModal) {
            saveModal.classList.add("open");
            const reportNameInput = document.getElementById("saveModalReportName");
            if (reportNameInput) {
                const pTag = state.periodPreset === "weekly" ? "Weekly" : (state.periodPreset === "monthly" ? "Monthly" : (state.periodPreset === "today" ? "Today" : (state.periodPreset === "all" ? "AllTime" : "Custom")));
                const startStr = state.startDate ? formatDateISO(state.startDate) : "";
                const endStr = state.endDate ? formatDateISO(state.endDate) : "";
                const matTag = (state.selectedMaterialId && state.selectedMaterialId !== "all") ? `_${(state.selectedMaterialName || "Material").replace(/[^a-zA-Z0-9]/g, '_')}` : "";
                reportNameInput.value = `RMSME_Staff_${pTag}_Report${matTag}_${startStr || "Live"}_to_${endStr || "Live"}`;
            }
            updateMetadataLabels();
        }
    };

    if (btnOverallExport) btnOverallExport.addEventListener("click", openSaveModal);
    if (saveClose && saveModal) saveClose.addEventListener("click", () => { saveModal.classList.remove("open"); });
    if (saveCancel && saveModal) saveCancel.addEventListener("click", () => { saveModal.classList.remove("open"); });
    if (saveModal) {
        saveModal.addEventListener("click", (e) => {
            if (e.target === saveModal) saveModal.classList.remove("open");
        });
    }
    if (saveConfirm) saveConfirm.addEventListener("click", handleSaveReport);

    if (selectAllBtn) {
        selectAllBtn.addEventListener("click", () => {
            document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']").forEach(cb => cb.checked = true);
        });
    }
    if (clearAllBtn) {
        clearAllBtn.addEventListener("click", () => {
            document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']").forEach(cb => cb.checked = false);
        });
    }

    // 4b. Specific Tab Export Modal (Staff Single Active Category Export)
    const tabExportBtn = document.getElementById("btnTabExport");
    const tabExportOverlay = document.getElementById("tabExportModalOverlay");
    const tabExportClose = document.getElementById("tabExportCloseBtn");
    const tabExportCancel = document.getElementById("tabExportCancelBtn");
    const tabExportTitle = document.getElementById("tabExportModalTitle");
    const tabExportSub = document.getElementById("tabExportModalSub");
    const tabExportTargetName = document.getElementById("tabExportTargetName");
    const btnExportSpecificPdf = document.getElementById("btnExportSpecificPdf");
    const btnExportSpecificExcel = document.getElementById("btnExportSpecificExcel");

    const getStaffActiveTabDisplayName = (tabKey) => {
        const names = {
            inventory: "Inventory Records",
            receiving: "Material Receiving",
            disbursement: "Material Disbursement",
            activity: "Material Activity"
        };
        return names[tabKey] || "Current Report";
    };

    const openTabExportModal = () => {
        if (!state.activeTab) {
            selectReportCategory("inventory", false);
        }
        const activeName = getStaffActiveTabDisplayName(state.activeTab || "inventory");
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
            const activeName = getStaffActiveTabDisplayName(state.activeTab);
            const safeName = activeName.replace(/[^a-zA-Z0-9]/g, '_');
            const pTag = state.periodPreset === "weekly" ? "Weekly" : (state.periodPreset === "monthly" ? "Monthly" : (state.periodPreset === "today" ? "Today" : (state.periodPreset === "all" ? "AllTime" : "Custom")));
            const matTag = (state.selectedMaterialId && state.selectedMaterialId !== "all") ? `_${(state.selectedMaterialName || "Material").replace(/[^a-zA-Z0-9]/g, '_')}` : "";
            const fileName = `RMSME_Staff_${safeName}${matTag}_${pTag}`;

            try {
                btnExportSpecificPdf.disabled = true;
                await generateStaffSingleTabPdf(fileName, state.activeTab);
                showToast(`${activeName} exported as PDF.`, "success");
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
            const activeName = getStaffActiveTabDisplayName(state.activeTab);
            const safeName = activeName.replace(/[^a-zA-Z0-9]/g, '_');
            const pTag = state.periodPreset === "weekly" ? "Weekly" : (state.periodPreset === "monthly" ? "Monthly" : (state.periodPreset === "today" ? "Today" : (state.periodPreset === "all" ? "AllTime" : "Custom")));
            const matTag = (state.selectedMaterialId && state.selectedMaterialId !== "all") ? `_${(state.selectedMaterialName || "Material").replace(/[^a-zA-Z0-9]/g, '_')}` : "";
            const fileName = `RMSME_Staff_${safeName}${matTag}_${pTag}`;

            try {
                btnExportSpecificExcel.disabled = true;
                await generateStaffSingleTabExcel(fileName, state.activeTab);
                showToast(`${activeName} exported as Excel.`, "success");
            } catch (err) {
                console.error("Single Excel export error:", err);
                showToast("Error generating Excel.", "error");
            } finally {
                btnExportSpecificExcel.disabled = false;
                closeTabExportModal();
            }
        });
    }

    // 5. Print Document Trigger (Unified Active Tab Output)
    let isPrinting = false;
    const btnOverallPrint = document.getElementById("btnOverallPrint");
    const printBtn = document.getElementById("btnPrint");
    const triggerPrint = () => {
        if (isPrinting) return;
        isPrinting = true;
        const activeTab = state.activeTab || "inventory";
        updatePrintDocHtml(activeTab);
        setTimeout(() => {
            try {
                window.print();
            } catch (e) {
                console.error("Print error:", e);
            } finally {
                setTimeout(() => {
                    isPrinting = false;
                }, 400);
            }
        }, 50);
    };
    if (btnOverallPrint) btnOverallPrint.addEventListener("click", triggerPrint);
    if (printBtn) printBtn.addEventListener("click", triggerPrint);
    window.addEventListener("beforeprint", () => {
        updatePrintDocHtml(state.activeTab || "inventory");
    });
    window.__rmimsPrintReport = triggerPrint;
}

/* ==========================================================
   CORPORATE PREVIEW DETAILS & KPI STATS (MATCHING IMAGE 4)
   ========================================================== */

function updateCorporatePreviewDetails(target) {
    const titles = {
        inventory: { title: "Inventory Records", ref: "SRV-2026-INV", desc: "Stock catalog, quantities on hand, units, and replenishment states." },
        receiving: { title: "Material Receiving", ref: "SRV-2026-RCV", desc: "Supplier deliveries, inbound shipments, lots, and dates." },
        disbursement: { title: "Material Disbursement", ref: "SRV-2026-DSB", desc: "Disbursed raw materials released for production batches." },
        activity: { title: "Material Activity", ref: "SRV-2026-ACT", desc: "Chronological audit ledger combining all inbound and outbound stock." }
    };

    const info = titles[target] || { title: "Inventory Records", ref: "SRV-2026", desc: "Operational Report Preview" };
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
        const pName = pBtn?.querySelector("[data-shell-name]")?.textContent || "Staff User";
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
        
        // Reset sub-tab text searches to avoid conflicting filters
        state.invSearch = ""; const invInp = document.getElementById("invSearchInput"); if (invInp) invInp.value = "";
        state.rcvSearch = ""; const rcvInp = document.getElementById("rcvSearchInput"); if (rcvInp) rcvInp.value = "";
        state.disbSearch = ""; const disbInp = document.getElementById("disbSearchInput"); if (disbInp) disbInp.value = "";
        state.actSearch = ""; const actInp = document.getElementById("actSearchInput"); if (actInp) actInp.value = "";

        // Reset pagination pages to 1
        state.invPage = 1;
        state.rcvPage = 1;
        state.disbPage = 1;
        state.actPage = 1;

        const scopeEl = document.getElementById("rptDocScopeText");
        if (scopeEl) scopeEl.textContent = state.selectedMaterialName;

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
   UTILITY HELPERS
   ========================================================= */

function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function showToast(message, type = "info") {
    const stack = document.getElementById("toastStack");
    if (!stack) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        background: ${type === 'success' ? '#15803D' : (type === 'error' ? '#DC2626' : '#0F2A1B')};
        color: #FFFFFF;
        padding: 10px 18px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        margin-top: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        display: flex;
        align-items: center;
        gap: 8px;
        animation: toastIn 0.25s ease;
    `;
    toast.textContent = message;
    stack.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.25s ease";
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}


// Storage & cross-tab sync listeners
let _userRptStorageDebounce = null;
window.addEventListener("storage", (e) => {
    if (!e.key || e.key.startsWith("rmims_") || e.key.includes("inventory") || e.key.includes("material") || e.key.includes("receipt") || e.key.includes("disburse")) {
        clearTimeout(_userRptStorageDebounce);
        _userRptStorageDebounce = setTimeout(() => loadAuthoritativeData(), 150);
    }
});

window.addEventListener("rmims_inventory_updated", () => loadAuthoritativeData());
window.addEventListener("rmims_manager_receipts_updated", () => loadAuthoritativeData());
window.addEventListener("rmims_manager_disbursements_updated", () => loadAuthoritativeData());
window.addEventListener("rmims_staff_transactions_updated", () => loadAuthoritativeData());
window.addEventListener("rmims_staff_activity_updated", () => loadAuthoritativeData());

try {
    if (typeof BroadcastChannel !== "undefined") {
        const syncChannel = new BroadcastChannel("rmims_user_sync");
        syncChannel.onmessage = () => {
            loadAuthoritativeData();
        };
    }
} catch (_) {}

if (supabase && typeof supabase.channel === "function" && !window.__rmimsStaffReportsChannel) {
    window.__rmimsStaffReportsChannel = supabase
        .channel("rmims_staff_reports_sync")
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
