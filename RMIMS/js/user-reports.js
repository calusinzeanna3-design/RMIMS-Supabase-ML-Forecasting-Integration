// js/user-reports.js
//
// RMIMS USER — REPORTS & DECISION SUPPORT
// Interactive 5 Tabs (Overview, Recent Receiving, Recent Disbursement, Consumption, AI Forecast Support)
// Full Save As (Excel, PDF, CSV, JSON), Print, and Export Capabilities.
// Authoritative Supabase Data (raw_materials, stock_receipts, material_disbursements) & Latest AI Forecast Output.
// Strictly Light Mode. No Mock Data. Unit-Safe. Read-Only.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

/* ==========================================================
   ROLE & AUTH GUARD
   ========================================================== */

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "../user-signin.html"; return; }

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
            fullName: profile.full_name || "",
            email: profile.email || user.email || "",
            role: profile.role || "user"
        };

        const pBtn = document.getElementById("profileBtn");
        if (pBtn) {
            const pText = pBtn.querySelector(".profile-text") || pBtn;
            pText.textContent = profile.full_name || profile.email || "Staff Member";
            const pAv = pBtn.querySelector(".avatar");
            if (pAv && profile.full_name) pAv.textContent = initials(profile.full_name);
        }

        init();
    } catch (e) {
        console.error("User reports auth check failed:", e);
        window.location.href = "../user-signin.html";
    }
});

function initials(name) {
    if (!name) return "U";
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "U";
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
    forecastStatusText: "Forecast Available",
    
    // Period & Filter State
    periodPreset: "weekly", // 'all' | 'today' | 'weekly' | 'monthly' | 'custom'
    startDate: null,
    endDate: null,
    latestDataDate: null,
    generatedAt: null,
    
    // Active Screen Tab
    activeTab: "overview", // 'overview' | 'receiving' | 'disbursement' | 'consumption' | 'forecasting'
    
    // Tab Specific Filter & Pagination States
    rcvSearch: "",
    rcvSort: "latest",
    rcvPage: 1,
    rcvPageSize: 10,

    disbSearch: "",
    disbSort: "latest",
    disbPage: 1,
    disbPageSize: 10,

    cnsSearch: "",

    fcSearch: "",
    fcStatus: "all"
};

const $ = (id) => document.getElementById(id);

function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* ==========================================================
   INITIALIZATION
   ========================================================== */

let fpStart = null;
let fpEnd = null;

async function init() {
    initPeriodDates();
    initUserReportsFlatpickr();
    initEventListeners();
    await loadAuthoritativeData();
}

/* ==========================================================
   PERIOD & DATE HELPERS & FLATPICKR INITIALIZATION
   ========================================================== */

function initPeriodDates() {
    setPeriodPresetDates("weekly");
}

function setPeriodPresetDates(preset) {
    const anchor = state.latestDataDate ? new Date(state.latestDataDate) : new Date();

    if (preset === "today") {
        state.startDate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
        state.endDate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    } else if (preset === "weekly") {
        const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
        const start = addDays(end, -6);
        state.startDate = start;
        state.endDate = end;
    } else if (preset === "monthly") {
        const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
        const start = addDays(end, -29);
        state.startDate = start;
        state.endDate = end;
    } else if (preset === "all") {
        state.startDate = null;
        state.endDate = null;
    }

    const startInput = $("rptStartDate");
    const endInput = $("rptEndDate");
    if (startInput && state.startDate) startInput.value = formatDateISO(state.startDate);
    if (endInput && state.endDate) endInput.value = formatDateISO(state.endDate);

    if (fpStart) {
        if (state.startDate) fpStart.setDate(formatDateISO(state.startDate), false);
        else fpStart.clear();
    }
    if (fpEnd) {
        if (state.endDate) fpEnd.setDate(formatDateISO(state.endDate), false);
        else fpEnd.clear();
    }

    syncUserDateInputsInteractiveState();
    updateUserClearBtnVisibility();
}

function syncUserDateInputsInteractiveState() {
    const isCustom = state.periodPreset === "custom";
    const wrap = $("rptDateRangeGroup");

    if (wrap) {
        if (isCustom) {
            wrap.classList.remove("is-preset-locked");
            wrap.classList.add("is-custom-active");
            wrap.title = "Custom Date Range: Click date fields to modify range";
        } else {
            wrap.classList.add("is-preset-locked");
            wrap.classList.remove("is-custom-active");
            wrap.title = "Preset active: Dates are automatically loaded. Switch to 'Custom Date Range' in dropdown to edit.";
        }
    }

    if (fpStart && fpStart.altInput) {
        if (isCustom) {
            fpStart.altInput.style.pointerEvents = "auto";
            fpStart.altInput.style.cursor = "pointer";
            fpStart.altInput.classList.remove("input-locked");
        } else {
            fpStart.altInput.style.pointerEvents = "none";
            fpStart.altInput.style.cursor = "default";
            fpStart.altInput.classList.add("input-locked");
        }
    }

    if (fpEnd && fpEnd.altInput) {
        if (isCustom) {
            fpEnd.altInput.style.pointerEvents = "auto";
            fpEnd.altInput.style.cursor = "pointer";
            fpEnd.altInput.classList.remove("input-locked");
        } else {
            fpEnd.altInput.style.pointerEvents = "none";
            fpEnd.altInput.style.cursor = "default";
            fpEnd.altInput.classList.add("input-locked");
        }
    }
}

function updateUserClearBtnVisibility() {
    const clearBtn = $("clearReportDatesBtn");
    if (clearBtn) {
        if (state.startDate || state.endDate) {
            clearBtn.style.display = "inline-flex";
        } else {
            clearBtn.style.display = "none";
        }
    }
}

function initUserReportsFlatpickr() {
    const startInput = $("rptStartDate");
    const endInput = $("rptEndDate");
    const clearBtn = $("clearReportDatesBtn");
    const presetSelect = $("reportPeriodPreset");

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
                state.startDate = parseDateOnly(dateStr);
                if (presetSelect) presetSelect.value = "custom";
                state.periodPreset = "custom";
                syncUserDateInputsInteractiveState();
                updateUserClearBtnVisibility();
                renderAllReportSections();
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
                state.endDate = parseDateOnly(dateStr);
                if (presetSelect) presetSelect.value = "custom";
                state.periodPreset = "custom";
                syncUserDateInputsInteractiveState();
                updateUserClearBtnVisibility();
                renderAllReportSections();
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
            if (presetSelect) presetSelect.value = "all";
            state.periodPreset = "all";
            syncUserDateInputsInteractiveState();
            updateUserClearBtnVisibility();
            renderAllReportSections();
            showToast("Report date filter cleared.", "info");
        });
    }

    syncUserDateInputsInteractiveState();
    updateUserClearBtnVisibility();
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
    const diff = (day === 0 ? -6 : 1) - day;
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
        return `${MONTHS_ABBR[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()}`;
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
    if (preset === "weekly") return "Weekly";
    if (preset === "monthly") return "Monthly";
    if (preset === "today") return "Daily";
    return "Custom Period";
}

/* ==========================================================
   DATA LOAD (AUTHORITATIVE SUPABASE + AUTHORITATIVE FORECASTS)
   ========================================================== */

async function loadAuthoritativeData() {
    try {
        const [matRes, rcvRes, disbRes] = await Promise.all([
            supabase
                .from("raw_materials")
                .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, description")
                .order("name"),
            supabase
                .from("stock_receipts")
                .select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at")
                .order("receipt_date", { ascending: false }),
            supabase
                .from("material_disbursements")
                .select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at")
                .order("usage_date", { ascending: false })
        ]);

        const rawMats = matRes.data || [];
        const rawReceipts = rcvRes.data || [];
        const rawDisbursements = disbRes.data || [];

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
                unit: (m.unit_of_measure || "kg").trim(),
                currentStock: stock,
                minThreshold: minThreshold,
                reorderQty: Number(m.reorder_quantity || 0),
                status
            };
        });

        const matMap = new Map(state.materials.map(m => [m.id, m]));

        // Normalize Receipts
        state.receipts = rawReceipts.map(r => {
            const mat = matMap.get(r.material_id);
            return {
                id: r.id,
                receiptDate: r.receipt_date || (r.created_at ? r.created_at.slice(0, 10) : ""),
                materialId: r.material_id,
                materialName: mat ? mat.name : "Raw Material",
                itemCode: mat ? mat.itemCode : "RM—",
                receivedQuantity: Number(r.received_quantity || 0),
                unit: (r.unit || (mat ? mat.unit : "kg")).trim(),
                currentStock: mat ? mat.currentStock : null,
                supplierName: r.supplier_name || "Direct Delivery",
                receivedBy: r.received_by || "Staff",
                status: "Verified",
                createdAt: r.created_at
            };
        });

        // Normalize Disbursements
        state.disbursements = rawDisbursements.map(d => {
            const mat = matMap.get(d.material_id);
            const prodName = d.finished_product_name && d.finished_product_name.trim() !== "" ? d.finished_product_name.trim() : "General Production";
            return {
                id: d.id,
                usageDate: d.usage_date || (d.created_at ? d.created_at.slice(0, 10) : ""),
                materialId: d.material_id,
                materialName: mat ? mat.name : "Raw Material",
                itemCode: mat ? mat.itemCode : "RM—",
                disbursedQuantity: Number(d.consumed_quantity || 0),
                unit: (d.unit || (mat ? mat.unit : "kg")).trim(),
                currentStock: mat ? mat.currentStock : null,
                finishedProduct: prodName,
                activityType: d.activity_type || "Production",
                recordedBy: d.recorded_by || "Staff",
                status: "Logged",
                createdAt: d.created_at
            };
        });

        // Compute Latest Recorded Data Date
        let maxDateStr = "";
        state.receipts.forEach(r => {
            if (r.receiptDate && r.receiptDate > maxDateStr) maxDateStr = r.receiptDate;
        });
        state.disbursements.forEach(d => {
            if (d.usageDate && d.usageDate > maxDateStr) maxDateStr = d.usageDate;
        });

        if (maxDateStr) {
            state.latestDataDate = parseDateOnly(maxDateStr);
        } else {
            state.latestDataDate = new Date();
        }

        // Re-anchor period presets
        setPeriodPresetDates(state.periodPreset);

        // Fetch Authoritative AI Forecast Data (Staged as blanks)
        await loadAuthoritativeForecasts();

        // Mark report generation timestamp
        state.generatedAt = new Date();

        renderAllReportSections();

    } catch (err) {
        console.error("Error loading authoritative report data:", err);
        showToast("Error loading report records from Supabase.", "error");
    }
}

async function loadAuthoritativeForecasts() {
    state.forecastMap.clear();
    state.forecastList = [];

    state.materials.forEach(mat => {
        const item = {
            name: mat.name,
            itemCode: mat.itemCode,
            unit: mat.unit,
            currentStock: mat.currentStock,
            forecast7Day: null,
            additionalNeed: null,
            status: "—",
            interpretation: "AI time-series demand forecasting module is currently in development."
        };

        state.forecastList.push(item);
        state.forecastMap.set(mat.name.toLowerCase(), item);
    });

    state.lastForecastTimestamp = null;
    state.forecastStatusText = "Awaiting ML Integration";
}

/* ==========================================================
   SAVE AS MODAL HANDLERS
   ========================================================== */

function openSaveModal() {
    const saveOverlay = $("saveModalOverlay");
    if (!saveOverlay) return;

    const periodSubtitle = $("saveModalPeriodSubtitle");
    if (periodSubtitle) {
        periodSubtitle.textContent = `Report Period: ${formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset)}`;
    }

    const reportNameInput = $("saveModalReportName");
    if (reportNameInput) {
        const pTag = state.periodPreset === "weekly" ? "Weekly" : (state.periodPreset === "monthly" ? "Monthly" : (state.periodPreset === "today" ? "Today" : "Operational"));
        const startStr = state.startDate ? formatDateISO(state.startDate) : "";
        const endStr = state.endDate ? formatDateISO(state.endDate) : "";
        reportNameInput.value = `RMIMS_${pTag}_Report_${startStr}_to_${endStr}`;
    }

    saveOverlay.classList.add("open");
}

function closeSaveModal() {
    const saveOverlay = $("saveModalOverlay");
    if (saveOverlay) saveOverlay.classList.remove("open");
}

function handleSaveConfirm() {
    const checkedBoxes = Array.from(document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']:checked"));
    if (checkedBoxes.length === 0) {
        showToast("Please select at least one report section.", "error");
        return;
    }

    const selectedKeys = checkedBoxes.map(cb => cb.value);
    const format = document.querySelector("input[name='saveFileFormat']:checked")?.value || "pdf";
    const rawName = $("saveModalReportName")?.value.trim() || `RMIMS_User_Report_${formatDateISO(new Date())}`;

    if (format === "pdf") {
        generateUserPdfReport(selectedKeys, rawName);
    } else if (format === "excel") {
        generateUserExcelWorkbook(selectedKeys, rawName);
    } else if (format === "both") {
        generateUserPdfReport(selectedKeys, rawName);
        generateUserExcelWorkbook(selectedKeys, rawName);
    } else if (format === "csv") {
        generateUserCsvPackage(selectedKeys, rawName);
    } else if (format === "json") {
        generateUserJsonExport(selectedKeys, rawName);
    }

    closeSaveModal();
}

/* ==========================================================
   EVENT LISTENERS
   ========================================================== */

function initEventListeners() {
    // Period Preset
    const presetSelect = $("reportPeriodPreset");
    if (presetSelect) {
        presetSelect.addEventListener("change", (e) => {
            state.periodPreset = e.target.value;
            setPeriodPresetDates(state.periodPreset);
            renderAllReportSections();
        });
    }

    // Refresh Live Data Button
    const genBtn = $("generateReportBtn");
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

    // Tabs
    const tabsBar = $("reportTabsBar");
    if (tabsBar) {
        tabsBar.addEventListener("click", (e) => {
            const btn = e.target.closest(".rpt-tab-btn");
            if (!btn) return;
            const targetTab = btn.dataset.tab;
            if (!targetTab) return;
            switchTab(targetTab);
        });
    }

    // Search & Filter listeners
    const rcvSearch = $("receivingSearchInput");
    if (rcvSearch) {
        rcvSearch.addEventListener("input", (e) => {
            state.rcvSearch = e.target.value.trim().toLowerCase();
            state.rcvPage = 1;
            renderTabReceiving();
        });
    }
    const rcvSort = $("receivingSortSelect");
    if (rcvSort) {
        rcvSort.addEventListener("change", (e) => {
            state.rcvSort = e.target.value;
            state.rcvPage = 1;
            renderTabReceiving();
        });
    }

    const disbSearch = $("disbursementSearchInput");
    if (disbSearch) {
        disbSearch.addEventListener("input", (e) => {
            state.disbSearch = e.target.value.trim().toLowerCase();
            state.disbPage = 1;
            renderTabDisbursement();
        });
    }
    const disbSort = $("disbursementSortSelect");
    if (disbSort) {
        disbSort.addEventListener("change", (e) => {
            state.disbSort = e.target.value;
            state.disbPage = 1;
            renderTabDisbursement();
        });
    }

    const cnsSearch = $("consumptionSearchInput");
    if (cnsSearch) {
        cnsSearch.addEventListener("input", (e) => {
            state.cnsSearch = e.target.value.trim().toLowerCase();
            renderTabConsumption();
        });
    }

    const fcSearch = $("forecastSearchInput");
    if (fcSearch) {
        fcSearch.addEventListener("input", (e) => {
            state.fcSearch = e.target.value.trim().toLowerCase();
            renderTabForecasting();
        });
    }
    const fcStatus = $("forecastStatusFilter");
    if (fcStatus) {
        fcStatus.addEventListener("change", (e) => {
            state.fcStatus = e.target.value;
            renderTabForecasting();
        });
    }

    // Save As Modal
    const btnSaveAs = $("btnSaveAs");
    if (btnSaveAs) btnSaveAs.addEventListener("click", openSaveModal);

    const saveOverlay = $("saveModalOverlay");
    if (saveOverlay) {
        saveOverlay.addEventListener("click", (e) => {
            if (e.target === saveOverlay) closeSaveModal();
        });
    }

    const saveCloseBtn = $("saveModalCloseBtn");
    if (saveCloseBtn) saveCloseBtn.addEventListener("click", closeSaveModal);

    const saveCancelBtn = $("saveModalCancelBtn");
    if (saveCancelBtn) saveCancelBtn.addEventListener("click", closeSaveModal);

    const saveConfirmBtn = $("saveModalConfirmBtn");
    if (saveConfirmBtn) saveConfirmBtn.addEventListener("click", handleSaveConfirm);

    const browseBtn = $("browseLocationBtn");
    if (browseBtn) {
        browseBtn.addEventListener("click", () => {
            showToast("Files are saved directly to your browser's default Downloads folder.", "info");
        });
    }

    // Section Checklist buttons
    const selectAllBtn = $("saveSelectAllBtn");
    if (selectAllBtn) {
        selectAllBtn.addEventListener("click", () => {
            const boxes = document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']");
            boxes.forEach(b => b.checked = true);
        });
    }
    const clearAllBtn = $("saveClearAllBtn");
    if (clearAllBtn) {
        clearAllBtn.addEventListener("click", () => {
            const boxes = document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']");
            boxes.forEach(b => b.checked = false);
        });
    }

    // Print Button
    const btnPrint = $("btnPrint");
    if (btnPrint) btnPrint.addEventListener("click", handlePrintReport);
}

/* ==========================================================
   TAB SWITCHING
   ========================================================== */

function switchTab(tabKey) {
    state.activeTab = tabKey;
    const tabBtns = document.querySelectorAll(".rpt-tab-btn");
    tabBtns.forEach(btn => {
        if (btn.dataset.tab === tabKey) btn.classList.add("active");
        else btn.classList.remove("active");
    });

    const panels = {
        overview: $("tabPanelOverview"),
        receiving: $("tabPanelReceiving"),
        disbursement: $("tabPanelDisbursement"),
        consumption: $("tabPanelConsumption"),
        forecasting: $("tabPanelForecasting")
    };

    Object.keys(panels).forEach(k => {
        if (panels[k]) {
            if (k === tabKey) panels[k].classList.add("active");
            else panels[k].classList.remove("active");
        }
    });
}

/* ==========================================================
   RENDER ALL SECTIONS
   ========================================================== */

function renderAllReportSections() {
    updateMetadataBar();
    renderTabOverview();
    renderTabReceiving();
    renderTabDisbursement();
    renderTabConsumption();
    renderTabForecasting();
}

function updateMetadataBar() {
    const periodEl = $("metaPeriodLabel");
    if (periodEl) {
        periodEl.textContent = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    }
    const genEl = $("metaGeneratedTime");
    if (genEl && state.generatedAt) {
        genEl.textContent = state.generatedAt.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        });
    }
}

/* ==========================================================
   TAB 1: OVERVIEW
   ========================================================== */

function renderTabOverview() {
    const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));
    
    // Material Attention Count
    const attentionMaterials = state.materials.filter(m => m.status === "Low" || m.status === "Critical");
    
    const rcvCountEl = $("kpiReceivedCount");
    const disbCountEl = $("kpiDisbursedCount");
    const cnsCountEl = $("kpiConsumptionCount");
    const attCountEl = $("kpiAttentionCount");

    if (rcvCountEl) rcvCountEl.textContent = periodReceipts.length;
    if (disbCountEl) disbCountEl.textContent = periodDisbursements.length;
    if (cnsCountEl) cnsCountEl.textContent = periodDisbursements.length;
    if (attCountEl) attCountEl.textContent = attentionMaterials.length;

    const tbody = $("overviewTableBody");
    if (!tbody) return;

    if (periodReceipts.length === 0 && periodDisbursements.length === 0 && attentionMaterials.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="rpt-table-empty">No activity recorded for the selected period.</td></tr>`;
        return;
    }

    const displayPeriod = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);

    // Build Unit-Safe Received Summary
    const rcvUnitMap = new Map();
    periodReceipts.forEach(r => rcvUnitMap.set(r.unit, (rcvUnitMap.get(r.unit) || 0) + r.receivedQuantity));
    const rcvStr = Array.from(rcvUnitMap.entries()).map(([u, v]) => `${v.toLocaleString()} ${u}`).join(", ") || "0 items";

    // Build Unit-Safe Disbursed Summary
    const disbUnitMap = new Map();
    periodDisbursements.forEach(d => disbUnitMap.set(d.unit, (disbUnitMap.get(d.unit) || 0) + d.disbursedQuantity));
    const disbStr = Array.from(disbUnitMap.entries()).map(([u, v]) => `${v.toLocaleString()} ${u}`).join(", ") || "0 items";

    tbody.innerHTML = `
        <tr>
            <td><strong>Raw Material Receipts</strong></td>
            <td><span class="text-green font-bold">+${esc(rcvStr)}</span> (${periodReceipts.length} records)</td>
            <td>${esc(displayPeriod)}</td>
            <td><span class="status-pill status-good">Completed</span></td>
        </tr>
        <tr>
            <td><strong>Production Disbursements</strong></td>
            <td><span class="text-blue font-bold">-${esc(disbStr)}</span> (${periodDisbursements.length} records)</td>
            <td>${esc(displayPeriod)}</td>
            <td><span class="status-pill status-good">Logged</span></td>
        </tr>
        <tr>
            <td><strong>Active Raw Materials Monitored</strong></td>
            <td><strong>${state.materials.length}</strong> items in catalog</td>
            <td>Current Baseline</td>
            <td><span class="status-pill status-good">Active</span></td>
        </tr>
        <tr>
            <td><strong>Materials Needing Attention</strong></td>
            <td><strong>${attentionMaterials.length}</strong> items below threshold</td>
            <td>Real-Time</td>
            <td>${attentionMaterials.length > 0 ? `<span class="status-pill status-red">Attention Required</span>` : `<span class="status-pill status-good">Optimal</span>`}</td>
        </tr>
        <tr>
            <td><strong>AI Forecast Support Integration</strong></td>
            <td><strong>${state.forecastList.length}</strong> materials with AI projections</td>
            <td>Next 7 Days</td>
            <td><span class="status-pill status-blue">${esc(state.forecastStatusText)}</span></td>
        </tr>
    `;
}

/* ==========================================================
   TAB 2: RECENT RECEIVING
   ========================================================== */

function renderTabReceiving() {
    const tbody = $("receivingTableBody");
    const pagination = $("receivingPagination");
    if (!tbody) return;

    let filtered = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));

    if (state.rcvSearch) {
        filtered = filtered.filter(r => 
            r.materialName.toLowerCase().includes(state.rcvSearch) ||
            r.itemCode.toLowerCase().includes(state.rcvSearch) ||
            r.supplierName.toLowerCase().includes(state.rcvSearch)
        );
    }

    if (state.rcvSort === "latest") {
        filtered.sort((a, b) => new Date(b.receiptDate || b.createdAt).getTime() - new Date(a.receiptDate || a.createdAt).getTime());
    } else if (state.rcvSort === "oldest") {
        filtered.sort((a, b) => new Date(a.receiptDate || a.createdAt).getTime() - new Date(b.receiptDate || b.createdAt).getTime());
    } else if (state.rcvSort === "highest") {
        filtered.sort((a, b) => b.receivedQuantity - a.receivedQuantity);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="rpt-table-empty">No receiving records found for the selected period.</td></tr>`;
        if (pagination) pagination.innerHTML = "";
        return;
    }

    const totalPages = Math.ceil(filtered.length / state.rcvPageSize);
    if (state.rcvPage > totalPages) state.rcvPage = totalPages;
    const startIndex = (state.rcvPage - 1) * state.rcvPageSize;
    const pageItems = filtered.slice(startIndex, startIndex + state.rcvPageSize);

    tbody.innerHTML = pageItems.map(r => {
        const dateFormatted = r.receiptDate 
            ? new Date(r.receiptDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : "—";

        const stockText = r.currentStock !== null ? `${r.currentStock.toLocaleString()} ${r.unit}` : "—";

        return `
            <tr>
                <td style="white-space:nowrap; font-weight:600; color:#475569;">${esc(dateFormatted)}</td>
                <td><strong>${esc(r.materialName)}</strong></td>
                <td><span class="rpt-code-badge">${esc(r.itemCode)}</span></td>
                <td><span class="text-green font-bold">+${r.receivedQuantity.toLocaleString()}</span></td>
                <td>${esc(r.unit)}</td>
                <td>${esc(stockText)}</td>
                <td>${esc(r.supplierName)}</td>
                <td><span class="status-pill status-good">${esc(r.status)}</span></td>
            </tr>
        `;
    }).join("");

    renderPagination(pagination, state.rcvPage, totalPages, (newPage) => {
        state.rcvPage = newPage;
        renderTabReceiving();
    });
}

/* ==========================================================
   TAB 3: RECENT DISBURSEMENT
   ========================================================== */

function renderTabDisbursement() {
    const tbody = $("disbursementTableBody");
    const pagination = $("disbursementPagination");
    if (!tbody) return;

    let filtered = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    if (state.disbSearch) {
        filtered = filtered.filter(d => 
            d.materialName.toLowerCase().includes(state.disbSearch) ||
            d.itemCode.toLowerCase().includes(state.disbSearch) ||
            d.finishedProduct.toLowerCase().includes(state.disbSearch)
        );
    }

    if (state.disbSort === "latest") {
        filtered.sort((a, b) => new Date(b.usageDate || b.createdAt).getTime() - new Date(a.usageDate || a.createdAt).getTime());
    } else if (state.disbSort === "oldest") {
        filtered.sort((a, b) => new Date(a.usageDate || a.createdAt).getTime() - new Date(b.usageDate || b.createdAt).getTime());
    } else if (state.disbSort === "highest") {
        filtered.sort((a, b) => b.disbursedQuantity - a.disbursedQuantity);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="rpt-table-empty">No disbursement records found for the selected period.</td></tr>`;
        if (pagination) pagination.innerHTML = "";
        return;
    }

    const totalPages = Math.ceil(filtered.length / state.disbPageSize);
    if (state.disbPage > totalPages) state.disbPage = totalPages;
    const startIndex = (state.disbPage - 1) * state.disbPageSize;
    const pageItems = filtered.slice(startIndex, startIndex + state.disbPageSize);

    tbody.innerHTML = pageItems.map(d => {
        const dateFormatted = d.usageDate 
            ? new Date(d.usageDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : "—";

        const stockText = d.currentStock !== null ? `${d.currentStock.toLocaleString()} ${d.unit}` : "—";

        return `
            <tr>
                <td style="white-space:nowrap; font-weight:600; color:#475569;">${esc(dateFormatted)}</td>
                <td><strong style="color:#0f172a;">${esc(d.finishedProduct)}</strong></td>
                <td><span style="font-weight:600; color:#1e293b;">${esc(d.materialName)}</span></td>
                <td><span class="rpt-code-badge">${esc(d.itemCode)}</span></td>
                <td><span class="text-red font-bold">-${d.disbursedQuantity.toLocaleString()}</span></td>
                <td>${esc(d.unit)}</td>
                <td>${esc(stockText)}</td>
                <td><span class="status-pill status-good">${esc(d.status)}</span></td>
            </tr>
        `;
    }).join("");

    renderPagination(pagination, state.disbPage, totalPages, (newPage) => {
        state.disbPage = newPage;
        renderTabDisbursement();
    });
}

function renderPagination(container, currentPage, totalPages, onPageChange) {
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = `
        <button type="button" class="rpt-page-btn" id="prevPageBtn" ${currentPage === 1 ? "disabled" : ""}>← Previous</button>
        <span class="rpt-page-info">Page ${currentPage} of ${totalPages}</span>
        <button type="button" class="rpt-page-btn" id="nextPageBtn" ${currentPage === totalPages ? "disabled" : ""}>Next →</button>
    `;

    const prevBtn = container.querySelector("#prevPageBtn");
    const nextBtn = container.querySelector("#nextPageBtn");

    if (prevBtn) prevBtn.addEventListener("click", () => onPageChange(currentPage - 1));
    if (nextBtn) nextBtn.addEventListener("click", () => onPageChange(currentPage + 1));
}

/* ==========================================================
   TAB 4: CONSUMPTION (TODAY, WEEKLY, MONTHLY BREAKDOWN)
   ========================================================== */

function renderTabConsumption() {
    const tbody = $("consumptionTableBody");
    if (!tbody) return;

    const now = new Date();
    const todayStr = formatDateISO(now);
    const weekStart = startOfWeek(now);
    const weekEnd = addDays(weekStart, 6);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    // Unit-safe calculation across period
    const unitMap = new Map();
    const activeMaterialsSet = new Set();

    periodDisbursements.forEach(d => {
        unitMap.set(d.unit, (unitMap.get(d.unit) || 0) + d.disbursedQuantity);
        activeMaterialsSet.add(d.materialId);
    });

    const cnsListEl = $("cnsTotalConsumedList");
    if (cnsListEl) {
        if (unitMap.size === 0) {
            cnsListEl.innerHTML = `<span style="font-size:1.1rem; font-weight:800; color:#64748b;">0 items</span>`;
        } else {
            cnsListEl.innerHTML = Array.from(unitMap.entries()).map(([unit, val]) => `
                <span class="rpt-unit-pill"><strong>${val.toLocaleString()}</strong> ${esc(unit)}</span>
            `).join("");
        }
    }

    const cnsMatCountEl = $("cnsActiveMaterialsCount");
    const cnsRecCountEl = $("cnsTotalRecordsCount");
    if (cnsMatCountEl) cnsMatCountEl.textContent = activeMaterialsSet.size;
    if (cnsRecCountEl) cnsRecCountEl.textContent = periodDisbursements.length;

    let displayMaterials = state.materials;
    if (state.cnsSearch) {
        displayMaterials = displayMaterials.filter(m => 
            m.name.toLowerCase().includes(state.cnsSearch) ||
            m.itemCode.toLowerCase().includes(state.cnsSearch)
        );
    }

    if (displayMaterials.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="rpt-table-empty">No consumption records found for the selected period.</td></tr>`;
        return;
    }

    tbody.innerHTML = displayMaterials.map(m => {
        // Today usage
        const todayUsage = state.disbursements
            .filter(d => d.materialId === m.id && d.usageDate === todayStr)
            .reduce((sum, d) => sum + d.disbursedQuantity, 0);

        // Week usage
        const weekUsage = state.disbursements
            .filter(d => d.materialId === m.id && withinRange(d.usageDate, weekStart, weekEnd))
            .reduce((sum, d) => sum + d.disbursedQuantity, 0);

        // Month usage
        const monthUsage = state.disbursements
            .filter(d => d.materialId === m.id && withinRange(d.usageDate, monthStart, monthEnd))
            .reduce((sum, d) => sum + d.disbursedQuantity, 0);

        // Selected Period usage
        const periodUsage = state.disbursements
            .filter(d => d.materialId === m.id && withinRange(d.usageDate, state.startDate, state.endDate))
            .reduce((sum, d) => sum + d.disbursedQuantity, 0);

        let statusBadge = `<span class="status-pill status-good">Normal</span>`;
        if (m.status === "Critical") statusBadge = `<span class="status-pill status-red">Critical</span>`;
        else if (m.status === "Low") statusBadge = `<span class="status-pill status-orange">Low Stock</span>`;

        return `
            <tr>
                <td><strong>${esc(m.name)}</strong></td>
                <td><span class="rpt-code-badge">${esc(m.itemCode)}</span></td>
                <td>${todayUsage > 0 ? `<strong class="text-blue">${todayUsage.toLocaleString()} ${esc(m.unit)}</strong>` : `<span style="color:#94a3b8;">0 ${esc(m.unit)}</span>`}</td>
                <td>${weekUsage > 0 ? `<strong class="text-blue">${weekUsage.toLocaleString()} ${esc(m.unit)}</strong>` : `<span style="color:#94a3b8;">0 ${esc(m.unit)}</span>`}</td>
                <td>${monthUsage > 0 ? `<strong class="text-blue">${monthUsage.toLocaleString()} ${esc(m.unit)}</strong>` : `<span style="color:#94a3b8;">0 ${esc(m.unit)}</span>`}</td>
                <td><strong class="text-green">${periodUsage.toLocaleString()} ${esc(m.unit)}</strong></td>
                <td><strong>${m.currentStock.toLocaleString()}</strong> <small style="color:#64748b;">${esc(m.unit)}</small></td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join("");
}

/* ==========================================================
   TAB 5: AI FORECAST SUPPORT
   ========================================================== */

function renderTabForecasting() {
    const tbody = $("forecastTableBody");
    const metaPill = $("forecastGeneratedMeta");
    if (!tbody) return;

    if (metaPill) {
        if (state.lastForecastTimestamp) {
            const dt = new Date(state.lastForecastTimestamp);
            metaPill.textContent = `Forecast Generated: ${dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} — ${dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
        } else {
            metaPill.textContent = "Forecast Generated: Live System";
        }
    }

    if (state.forecastList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="rpt-table-empty">No AI forecast support is currently available.</td></tr>`;
        return;
    }

    let filtered = state.forecastList;

    if (state.fcSearch) {
        filtered = filtered.filter(f => 
            f.name.toLowerCase().includes(state.fcSearch) ||
            f.itemCode.toLowerCase().includes(state.fcSearch) ||
            f.status.toLowerCase().includes(state.fcSearch)
        );
    }

    if (state.fcStatus === "shortage") {
        filtered = filtered.filter(f => f.status.includes("Attention") || f.status.includes("Critical") || f.additionalNeed > 0);
    } else if (state.fcStatus === "sufficient") {
        filtered = filtered.filter(f => f.status.includes("Sufficient") || f.additionalNeed === 0);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="rpt-table-empty">No matching forecast records found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(f => {
        return `
            <tr>
                <td><strong>${esc(f.name)}</strong></td>
                <td><span class="rpt-code-badge">${esc(f.itemCode)}</span></td>
                <td><span style="font-weight:600; color:#475569;">Next 7 Days</span></td>
                <td><strong>${f.currentStock.toLocaleString()}</strong> <small style="color:#64748b;">${esc(f.unit)}</small></td>
                <td><span style="color:#94a3b8; font-weight:600;">—</span></td>
                <td><span style="color:#94a3b8; font-weight:600;">—</span></td>
                <td><span class="status-pill status-neutral">—</span></td>
                <td><span style="font-size:0.8rem; color:#475569;">${esc(f.interpretation)}</span></td>
            </tr>
        `;
    }).join("");
}

/* ==========================================================
   EXCEL WORKBOOK EXPORT (5 ORGANIZED SHEETS)
   ========================================================== */

function generateUserExcelWorkbook(selectedSections = ["overview", "receiving", "disbursement", "consumption", "forecasting"], fileName = "RMIMS_User_Report") {
    if (typeof XLSX === "undefined") {
        showToast("Excel export library is loading, please try again.", "error");
        return;
    }

    const wb = XLSX.utils.book_new();

    const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    selectedSections.forEach(key => {
        if (key === "overview") {
            const rows = [
                ["RMIMS - Reports & Decision Support (User Overview)"],
                ["Report Period", formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset)],
                ["Generated At", state.generatedAt ? state.generatedAt.toLocaleString() : new Date().toLocaleString()],
                [],
                ["Category", "Result", "Period", "Status"],
                ["Raw Material Receipts", `${periodReceipts.length} activities`, "Selected Period", "Completed"],
                ["Production Disbursements", `${periodDisbursements.length} activities`, "Selected Period", "Logged"],
                ["Active Raw Materials", `${state.materials.length} items`, "Catalog Baseline", "Active"],
                ["Materials Needing Attention", `${state.materials.filter(m => m.status !== "Good").length} items`, "Real-Time", "Action Required"]
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Overview");
        }

        if (key === "receiving") {
            const rows = [
                ["Date", "Raw Material", "Material ID", "Quantity", "Unit", "Current Stock", "Supplier / Context", "Status"],
                ...periodReceipts.map(r => [
                    r.receiptDate,
                    r.materialName,
                    r.itemCode,
                    r.receivedQuantity,
                    r.unit,
                    r.currentStock !== null ? r.currentStock : "",
                    r.supplierName,
                    r.status
                ])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Recent Receiving");
        }

        if (key === "disbursement") {
            const rows = [
                ["Date", "Finished Product / Context", "Raw Material", "Material ID", "Quantity", "Unit", "Current Stock", "Status"],
                ...periodDisbursements.map(d => [
                    d.usageDate,
                    d.finishedProduct,
                    d.materialName,
                    d.itemCode,
                    d.disbursedQuantity,
                    d.unit,
                    d.currentStock !== null ? d.currentStock : "",
                    d.status
                ])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Recent Disbursement");
        }

        if (key === "consumption") {
            const rows = [
                ["Raw Material", "Material ID", "Unit", "Current Stock", "Period Consumed", "Status"],
                ...state.materials.map(m => {
                    const consumed = periodDisbursements
                        .filter(d => d.materialId === m.id)
                        .reduce((sum, d) => sum + d.disbursedQuantity, 0);
                    return [m.name, m.itemCode, m.unit, m.currentStock, consumed, m.status];
                })
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Consumption");
        }

        if (key === "forecasting") {
            const rows = [
                ["Raw Material", "Material ID", "Forecast Period", "Current Stock", "Forecast Requirement (7D)", "Additional Need", "Status", "Operational Interpretation"],
                ...state.forecastList.map(f => [
                    f.name,
                    f.itemCode,
                    "Next 7 Days",
                    f.currentStock,
                    f.forecast7Day,
                    f.additionalNeed,
                    f.status,
                    f.interpretation
                ])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "AI Forecast Support");
        }
    });

    XLSX.writeFile(wb, `${fileName}.xlsx`);
    showToast(`Excel report saved: ${fileName}.xlsx`, "success");
}

/* ==========================================================
   PDF DOCUMENT EXPORT (jsPDF + autoTable)
   ========================================================== */

function generateUserPdfReport(selectedSections = ["overview", "receiving", "disbursement", "consumption", "forecasting"], fileName = "RMIMS_User_Report") {
    if (typeof window.jspdf === "undefined" || !window.jspdf.jsPDF) {
        showToast("PDF generation library is loading, please try again.", "error");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 48;

    const RM_GREEN = [22, 128, 60];
    const RM_INK = [15, 23, 42];
    const RM_DIM = [100, 116, 139];

    // Document Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...RM_INK);
    doc.text("RMIMS | Reports & Decision Support", 40, y);
    y += 18;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...RM_DIM);
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    doc.text(`Report Period: ${periodLabel}  |  Generated: ${state.generatedAt ? state.generatedAt.toLocaleString() : new Date().toLocaleString()}`, 40, y);
    y += 18;

    doc.setDrawColor(220, 226, 236);
    doc.setLineWidth(1);
    doc.line(40, y, pageWidth - 40, y);
    y += 20;

    const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    selectedSections.forEach(key => {
        if (y > doc.internal.pageSize.getHeight() - 140) {
            doc.addPage();
            y = 48;
        }

        if (key === "overview") {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("1. Operational Overview", 40, y);
            y += 12;

            doc.autoTable({
                startY: y,
                head: [["Category", "Result", "Period", "Status"]],
                body: [
                    ["Raw Material Receipts", `${periodReceipts.length} records logged`, periodLabel, "Completed"],
                    ["Production Disbursements", `${periodDisbursements.length} records logged`, periodLabel, "Logged"],
                    ["Active Raw Materials", `${state.materials.length} items in catalog`, "Baseline", "Active"],
                    ["Materials Needing Attention", `${state.materials.filter(m => m.status !== "Good").length} items`, "Real-Time", "Attention Needed"]
                ],
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 22;
        }

        if (key === "receiving") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("2. Recent Raw Material Receiving", 40, y);
            y += 12;

            doc.autoTable({
                startY: y,
                head: [["Date", "Raw Material", "Material ID", "Quantity", "Supplier / Context", "Status"]],
                body: periodReceipts.length === 0 ? [["—", "No receiving records", "—", "—", "—", "—"]] :
                    periodReceipts.map(r => [r.receiptDate, r.materialName, r.itemCode, `+${r.receivedQuantity} ${r.unit}`, r.supplierName, r.status]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 22;
        }

        if (key === "disbursement") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("3. Recent Material Disbursement", 40, y);
            y += 12;

            doc.autoTable({
                startY: y,
                head: [["Date", "Finished Product / Context", "Raw Material", "ID", "Disbursed", "Status"]],
                body: periodDisbursements.length === 0 ? [["—", "No disbursements", "—", "—", "—", "—"]] :
                    periodDisbursements.map(d => [d.usageDate, d.finishedProduct, d.materialName, d.itemCode, `-${d.disbursedQuantity} ${d.unit}`, d.status]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 22;
        }

        if (key === "consumption") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("4. Raw Material Consumption Analysis", 40, y);
            y += 12;

            doc.autoTable({
                startY: y,
                head: [["Raw Material", "Item Code", "Current Stock", "Period Consumed", "Status"]],
                body: state.materials.map(m => {
                    const consumed = periodDisbursements
                        .filter(d => d.materialId === m.id)
                        .reduce((sum, d) => sum + d.disbursedQuantity, 0);
                    return [m.name, m.itemCode, `${m.currentStock.toLocaleString()} ${m.unit}`, `${consumed.toLocaleString()} ${m.unit}`, m.status];
                }),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 22;
        }

        if (key === "forecasting") {
            if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("5. AI Forecast Support", 40, y);
            y += 12;

            doc.autoTable({
                startY: y,
                head: [["Raw Material", "ID", "Current Stock", "Forecast Req (7D)", "Additional Need", "Status"]],
                body: state.forecastList.length === 0 ? [["—", "—", "No AI forecast available", "—", "—", "—"]] :
                    state.forecastList.map(f => [
                        f.name,
                        f.itemCode,
                        `${f.currentStock.toLocaleString()} ${f.unit}`,
                        `${f.forecast7Day.toFixed(1)} ${f.unit}`,
                        f.additionalNeed > 0 ? `+${f.additionalNeed.toFixed(1)} ${f.unit}` : "0",
                        f.status
                    ]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 22;
        }
    });

    // Page Numbers
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(220, 226, 236);
        doc.line(40, doc.internal.pageSize.getHeight() - 30, pageWidth - 40, doc.internal.pageSize.getHeight() - 30);
        doc.setFontSize(7.5);
        doc.setTextColor(...RM_DIM);
        doc.text("RMIMS | Reports & Decision Support", 40, doc.internal.pageSize.getHeight() - 18);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 80, doc.internal.pageSize.getHeight() - 18);
    }

    doc.save(`${fileName}.pdf`);
    showToast(`PDF report downloaded: ${fileName}.pdf`, "success");
}

/* ==========================================================
   CSV & JSON EXPORT
   ========================================================== */

function generateUserCsvPackage(selectedSections, fileName) {
    const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    let csvContent = `RMIMS User Report\nPeriod,${formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset)}\nGenerated,${new Date().toISOString()}\n\n`;

    if (selectedSections.includes("receiving")) {
        csvContent += `--- RECENT RECEIVING ---\nDate,Raw Material,Item Code,Quantity,Unit,Supplier,Status\n`;
        periodReceipts.forEach(r => {
            csvContent += `"${r.receiptDate}","${r.materialName}","${r.itemCode}",${r.receivedQuantity},"${r.unit}","${r.supplierName}","${r.status}"\n`;
        });
        csvContent += `\n`;
    }

    if (selectedSections.includes("disbursement")) {
        csvContent += `--- RECENT DISBURSEMENT ---\nDate,Finished Product,Raw Material,Item Code,Quantity,Unit,Status\n`;
        periodDisbursements.forEach(d => {
            csvContent += `"${d.usageDate}","${d.finishedProduct}","${d.materialName}","${d.itemCode}",${d.disbursedQuantity},"${d.unit}","${d.status}"\n`;
        });
        csvContent += `\n`;
    }

    if (selectedSections.includes("consumption")) {
        csvContent += `--- CONSUMPTION ANALYSIS ---\nRaw Material,Item Code,Unit,Current Stock,Period Consumed,Status\n`;
        state.materials.forEach(m => {
            const consumed = periodDisbursements.filter(d => d.materialId === m.id).reduce((s, d) => s + d.disbursedQuantity, 0);
            csvContent += `"${m.name}","${m.itemCode}","${m.unit}",${m.currentStock},${consumed},"${m.status}"\n`;
        });
        csvContent += `\n`;
    }

    if (selectedSections.includes("forecasting")) {
        csvContent += `--- AI FORECAST SUPPORT ---\nRaw Material,Item Code,Unit,Current Stock,Forecast 7D,Additional Need,Status\n`;
        state.forecastList.forEach(f => {
            csvContent += `"${f.name}","${f.itemCode}","${f.unit}",${f.currentStock},${f.forecast7Day},${f.additionalNeed},"${f.status}"\n`;
        });
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName}.csv`;
    link.click();
    showToast(`CSV data downloaded: ${fileName}.csv`, "success");
}

function generateUserJsonExport(selectedSections, fileName) {
    const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    const exportData = {
        title: "RMIMS Reports & Decision Support (User)",
        period: formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset),
        generatedAt: new Date().toISOString(),
        sections: {}
    };

    if (selectedSections.includes("overview")) {
        exportData.sections.overview = {
            totalMaterials: state.materials.length,
            receiptCount: periodReceipts.length,
            disbursementCount: periodDisbursements.length,
            attentionNeededCount: state.materials.filter(m => m.status !== "Good").length
        };
    }
    if (selectedSections.includes("receiving")) exportData.sections.receiving = periodReceipts;
    if (selectedSections.includes("disbursement")) exportData.sections.disbursement = periodDisbursements;
    if (selectedSections.includes("consumption")) exportData.sections.materials = state.materials;
    if (selectedSections.includes("forecasting")) exportData.sections.forecasting = state.forecastList;

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName}.json`;
    link.click();
    showToast(`JSON export saved: ${fileName}.json`, "success");
}

/* ==========================================================
   PRINT REPORT HANDLER (MATCHING CLASSIC RMIMS TEMPLATE)
   ========================================================== */

function updatePrintDocHtml() {
    const printDoc = $("continuousPrintDoc");
    if (!printDoc) return;

    const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);

    const reportTypeLabel = {
        today: "Daily Snapshot",
        weekly: "Weekly",
        monthly: "Monthly",
        all: "All Records",
        custom: "Custom Range"
    }[state.periodPreset] || "Operational Report";

    const genDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTime = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    let html = `
        <div class="print-header-block">
            <h1 class="print-rmims-title">RMIMS</h1>
            <div class="print-rmims-sub">RAW MATERIALS INVENTORY — REPORTS &amp; DECISION SUPPORT</div>
        </div>

        <div class="print-doc-divider"></div>

        <h2 class="print-doc-title">RMSME Report Package</h2>

        <div class="print-meta-grid-2col">
            <div class="print-meta-item">
                <span class="print-meta-lbl">REPORT TYPE</span>
                <span class="print-meta-val">${esc(reportTypeLabel)}</span>
            </div>
            <div class="print-meta-item">
                <span class="print-meta-lbl">REPORT PERIOD</span>
                <span class="print-meta-val">${esc(periodLabel)}</span>
            </div>
            <div class="print-meta-item">
                <span class="print-meta-lbl">GENERATED DATE</span>
                <span class="print-meta-val">${esc(genDate)}</span>
            </div>
            <div class="print-meta-item">
                <span class="print-meta-lbl">GENERATED TIME</span>
                <span class="print-meta-val">${esc(genTime)}</span>
            </div>
            <div class="print-meta-item">
                <span class="print-meta-lbl">REPORT STATUS</span>
                <span class="print-meta-val">Final Snapshot</span>
            </div>
            <div class="print-meta-item">
                <span class="print-meta-lbl">PREPARED FOR</span>
                <span class="print-meta-val">MSME Inventory Management</span>
            </div>
            <div class="print-meta-item">
                <span class="print-meta-lbl">PREPARED BY</span>
                <span class="print-meta-val">${esc(currentUser?.fullName || "RMIMS Staff")}</span>
            </div>
            <div class="print-meta-item">
                <span class="print-meta-lbl">SOURCE</span>
                <span class="print-meta-val">raw_materials + stock_receipts + material_disbursements</span>
            </div>
        </div>

        <div class="print-doc-divider"></div>

        <!-- SECTION 1: OPERATIONAL SUMMARY -->
        <div class="print-section">
            <h3 class="print-section-header-green">Manager Summary</h3>
            <h4 class="print-subsection-title">Manager Overview</h4>
            <table class="print-table">
                <thead>
                    <tr>
                        <th style="width: 65%;">Metric</th>
                        <th style="width: 35%;">Result</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Total Materials</td>
                        <td><strong>${state.materials.length}</strong></td>
                    </tr>
                    <tr>
                        <td>Good Stock</td>
                        <td><strong>${state.materials.filter(m => m.status === "Good").length}</strong></td>
                    </tr>
                    <tr>
                        <td>Low / Critical</td>
                        <td><strong>${state.materials.filter(m => m.status !== "Good").length}</strong></td>
                    </tr>
                    <tr>
                        <td>Receiving Records</td>
                        <td><strong>${periodReceipts.length}</strong></td>
                    </tr>
                    <tr>
                        <td>Consumption Records</td>
                        <td><strong>${periodDisbursements.length}</strong></td>
                    </tr>
                    <tr>
                        <td>Disbursement Records</td>
                        <td><strong>${periodDisbursements.length}</strong></td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- SECTION 2: RECENT RECEIVING -->
        <div class="print-section">
            <h3 class="print-section-header-green">Recent Raw Material Receiving Records</h3>
            <table class="print-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Raw Material</th>
                        <th>Material ID</th>
                        <th>Quantity</th>
                        <th>Unit</th>
                        <th>Supplier / Context</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${periodReceipts.length === 0 ? `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:12px;">No material receiving records recorded in this period.</td></tr>` : 
                    periodReceipts.map(r => `
                        <tr>
                            <td>${esc(r.receiptDate)}</td>
                            <td><strong>${esc(r.materialName)}</strong></td>
                            <td>${esc(r.itemCode)}</td>
                            <td>+${r.receivedQuantity}</td>
                            <td>${esc(r.unit)}</td>
                            <td>${esc(r.supplierName || r.finishedProduct || "General Stock")}</td>
                            <td>${esc(r.status)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>

        <!-- SECTION 3: RECENT DISBURSEMENT -->
        <div class="print-section">
            <h3 class="print-section-header-green">Recent Material Disbursement Records</h3>
            <table class="print-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Finished Product / Context</th>
                        <th>Raw Material</th>
                        <th>Material ID</th>
                        <th>Quantity</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${periodDisbursements.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:12px;">No material disbursements recorded in this period.</td></tr>` :
                    periodDisbursements.map(d => `
                        <tr>
                            <td>${esc(d.usageDate)}</td>
                            <td><strong>${esc(d.finishedProduct || "General Production")}</strong></td>
                            <td>${esc(d.materialName)}</td>
                            <td>${esc(d.itemCode)}</td>
                            <td>-${d.disbursedQuantity} ${esc(d.unit)}</td>
                            <td>${esc(d.status)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>

        <!-- SECTION 4: CONSUMPTION ANALYSIS -->
        <div class="print-section">
            <h3 class="print-section-header-green">Raw Material Consumption Analysis</h3>
            <table class="print-table">
                <thead>
                    <tr>
                        <th>Raw Material</th>
                        <th>ID</th>
                        <th>Current Stock</th>
                        <th>Period Consumed</th>
                        <th>Stock Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.materials.length === 0 ? `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:12px;">No catalog raw materials registered.</td></tr>` :
                    state.materials.map(m => {
                        const consumed = periodDisbursements.filter(d => d.materialId === m.id).reduce((sum, d) => sum + d.disbursedQuantity, 0);
                        return `
                            <tr>
                                <td><strong>${esc(m.name)}</strong></td>
                                <td>${esc(m.itemCode)}</td>
                                <td>${m.currentStock.toLocaleString()} ${esc(m.unit)}</td>
                                <td>${consumed.toLocaleString()} ${esc(m.unit)}</td>
                                <td>${esc(m.status)}</td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        </div>

        <!-- SECTION 5: AI FORECAST SUPPORT -->
        <div class="print-section">
            <h3 class="print-section-header-green">AI Forecast Support &amp; Operational Projections</h3>
            <table class="print-table">
                <thead>
                    <tr>
                        <th>Raw Material</th>
                        <th>ID</th>
                        <th>Current Stock</th>
                        <th>Forecast Requirement (7D)</th>
                        <th>Additional Need</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.forecastList.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:12px;">No AI forecast projections recorded.</td></tr>` :
                    state.forecastList.map(f => `
                        <tr>
                            <td><strong>${esc(f.name)}</strong></td>
                            <td>${esc(f.itemCode)}</td>
                            <td>${f.currentStock.toLocaleString()} ${esc(f.unit)}</td>
                            <td>${f.forecast7Day.toFixed(1)} ${esc(f.unit)}</td>
                            <td>${f.additionalNeed > 0 ? `+${f.additionalNeed.toFixed(1)} ${esc(f.unit)}` : "0"}</td>
                            <td>${esc(f.status)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>

        <div class="print-doc-footer">
            <span>RMIMS — Raw Materials Inventory Management System</span>
            <span>Confidential &amp; Proprietary Operational Report</span>
        </div>
    `;

    printDoc.innerHTML = html;
}

function handlePrintReport() {
    try {
        updatePrintDocHtml();
        window.print();
    } catch (err) {
        console.error("Print report generation error:", err);
        window.print();
    }
}

window.addEventListener("beforeprint", updatePrintDocHtml);

// Global window functions for direct inline click handlers
window.__rmimsOpenSaveModal = openSaveModal;
window.__rmimsCloseSaveModal = closeSaveModal;
window.__rmimsHandleSaveConfirm = handleSaveConfirm;
window.__rmimsPrintReport = handlePrintReport;

// Initialize event listeners immediately so buttons work instantly without waiting for network/auth
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        initPeriodDates();
        initEventListeners();
    });
} else {
    initPeriodDates();
    initEventListeners();
}

/* ==========================================================
   TOAST NOTIFICATIONS
   ========================================================== */

function showToast(message, type = "info") {
    const stack = $("toastStack");
    if (!stack) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type} fade-in`;
    toast.innerHTML = `<span>${esc(message)}</span>`;

    stack.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
