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
    periodPreset: "all", // 'all' | 'today' | 'weekly' | 'monthly' | 'custom'
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
    cnsPage: 1,
    cnsPageSize: 10,

    fcSearch: "",
    fcStatus: "all",
    fcPage: 1,
    fcPageSize: 10,

    customSaveDirectoryHandle: null,
    customSaveDirectoryName: null
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
    setPeriodPresetDates("all");
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
            const supName = (r.supplier_name && r.supplier_name.toLowerCase() !== "all" ? r.supplier_name : "Supplier").trim();
            return {
                id: r.id,
                receiptDate: r.receipt_date || (r.created_at ? r.created_at.slice(0, 10) : ""),
                materialId: r.material_id,
                materialName: mat ? mat.name : "Raw Material",
                itemCode: mat ? mat.itemCode : "RM—",
                receivedQuantity: Number(r.received_quantity || 0),
                unit: (r.unit || (mat ? mat.unit : "kg")).trim(),
                currentStock: mat ? mat.currentStock : null,
                supplierName: supName,
                receivedBy: formatOperatorDisplay(r.received_by, "User"),
                status: "Verified",
                createdAt: r.created_at
            };
        });

        // Normalize Disbursements
        state.disbursements = rawDisbursements.map(d => {
            const mat = matMap.get(d.material_id);
            const prodName = (d.finished_product_name && d.finished_product_name.toLowerCase() !== "all" ? d.finished_product_name : (d.activity_type && d.activity_type.toLowerCase() !== "all" ? d.activity_type : "General Production")).trim();
            const actType = (d.activity_type && d.activity_type.toLowerCase() !== "all" ? d.activity_type : "Production Issue").trim();
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
                activityType: actType,
                recordedBy: formatOperatorDisplay(d.recorded_by, "User"),
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

/* ==========================================================
   SAVE BLOB HELPER (INTERACTIVE FOLDER OR BROWSER DOWNLOAD)
   ========================================================== */

async function saveUserExportBlob({ blob, fileName, defaultExtension }) {
    const fullFileName = fileName.endsWith(`.${defaultExtension}`) ? fileName : `${fileName}.${defaultExtension}`;

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

async function handleSaveConfirm() {
    const checkedBoxes = Array.from(document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']:checked"));
    if (checkedBoxes.length === 0) {
        showToast("Please select at least one report section.", "error");
        return;
    }

    const selectedKeys = checkedBoxes.map(cb => cb.value);
    const format = document.querySelector("input[name='saveFileFormat']:checked")?.value || "pdf";
    const rawName = $("saveModalReportName")?.value.trim() || `RMIMS_User_Report_${formatDateISO(new Date())}`;
    const confirmBtn = $("saveModalConfirmBtn");

    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<span class="spinner-border spinner-border-sm" style="width:14px;height:14px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin 0.6s linear infinite;"></span> Saving...`;
    }

    try {
        if (format === "pdf") {
            generateUserPdfReport(selectedKeys, rawName);
        } else if (format === "excel") {
            generateUserExcelWorkbook(selectedKeys, rawName);
        } else if (format === "both") {
            generateUserPdfReport(selectedKeys, `${rawName}_Document`);
            generateUserExcelWorkbook(selectedKeys, `${rawName}_Workbook`);
        } else if (format === "csv") {
            generateUserCsvPackage(selectedKeys, rawName);
        } else if (format === "json") {
            generateUserJsonExport(selectedKeys, rawName);
        }
    } catch (err) {
        console.error("User save error:", err);
        showToast("Error saving report package.", "error");
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="17" height="17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save Report`;
        }
        closeSaveModal();
    }
}

/* ==========================================================
   EVENT LISTENERS
   ========================================================== */

let listenersInitialized = false;
let isPrinting = false;

function initEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

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
            state.cnsPage = 1;
            renderTabConsumption();
        });
    }

    const fcSearch = $("forecastSearchInput");
    if (fcSearch) {
        fcSearch.addEventListener("input", (e) => {
            state.fcSearch = e.target.value.trim().toLowerCase();
            state.fcPage = 1;
            renderTabForecasting();
        });
    }
    const fcStatus = $("forecastStatusFilter");
    if (fcStatus) {
        fcStatus.addEventListener("change", (e) => {
            state.fcStatus = e.target.value;
            state.fcPage = 1;
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

    // Interactive Browse Location Picker
    const browseBtn = $("browseLocationBtn");
    const locInput = $("saveModalLocation");

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
   REUSABLE PAGINATION HELPER
   ========================================================== */

function renderReportsPaginationBar({ containerId, currentPage, totalItems, pageSize, onPageChange }) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (totalItems === 0) {
        container.innerHTML = `
            <div class="inv-pagination-info">Showing 0 to 0 of 0 entries</div>
            <div class="inv-pagination-controls">
                <button type="button" class="inv-page-btn" disabled>&laquo; Prev</button>
                <button type="button" class="inv-page-btn active" disabled>1</button>
                <button type="button" class="inv-page-btn" disabled>Next &raquo;</button>
            </div>
        `;
        return;
    }

    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const safePage = Math.max(1, Math.min(currentPage, totalPages));
    const startIdx = (safePage - 1) * pageSize + 1;
    const endIdx = Math.min(safePage * pageSize, totalItems);

    let pageButtonsHtml = `
        <button type="button" class="inv-page-btn" ${safePage <= 1 ? "disabled" : ""} data-page="${safePage - 1}">&laquo; Prev</button>
    `;

    let startPage = Math.max(1, safePage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    if (startPage > 1) {
        pageButtonsHtml += `<button type="button" class="inv-page-btn" data-page="1">1</button>`;
        if (startPage > 2) pageButtonsHtml += `<span class="page-ellipsis" style="padding: 0 4px; color: #94A3B8;">...</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
        pageButtonsHtml += `
            <button type="button" class="inv-page-btn ${p === safePage ? "active" : ""}" data-page="${p}">${p}</button>
        `;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) pageButtonsHtml += `<span class="page-ellipsis" style="padding: 0 4px; color: #94A3B8;">...</span>`;
        pageButtonsHtml += `<button type="button" class="inv-page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    pageButtonsHtml += `
        <button type="button" class="inv-page-btn" ${safePage >= totalPages ? "disabled" : ""} data-page="${safePage + 1}">Next &raquo;</button>
    `;

    container.innerHTML = `
        <div class="inv-pagination-info">Showing ${startIdx} to ${endIdx} of ${totalItems} entries</div>
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
   TAB 2: RECENT RECEIVING
   ========================================================== */

function renderTabReceiving() {
    const tbody = $("receivingTableBody");
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

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.rcvPageSize));
    if (state.rcvPage > totalPages) state.rcvPage = totalPages;
    const startIndex = (state.rcvPage - 1) * state.rcvPageSize;
    const pageItems = filtered.slice(startIndex, startIndex + state.rcvPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="rpt-table-empty">No receiving records found for the selected period.</td></tr>`;
    } else {
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
    }

    renderReportsPaginationBar({
        containerId: "receivingPagination",
        currentPage: state.rcvPage,
        totalItems: filtered.length,
        pageSize: state.rcvPageSize,
        onPageChange: (newPage) => {
            state.rcvPage = newPage;
            renderTabReceiving();
        }
    });
}

/* ==========================================================
   TAB 3: RECENT DISBURSEMENT
   ========================================================== */

function renderTabDisbursement() {
    const tbody = $("disbursementTableBody");
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

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.disbPageSize));
    if (state.disbPage > totalPages) state.disbPage = totalPages;
    const startIndex = (state.disbPage - 1) * state.disbPageSize;
    const pageItems = filtered.slice(startIndex, startIndex + state.disbPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="rpt-table-empty">No disbursement records found for the selected period.</td></tr>`;
    } else {
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
    }

    renderReportsPaginationBar({
        containerId: "disbursementPagination",
        currentPage: state.disbPage,
        totalItems: filtered.length,
        pageSize: state.disbPageSize,
        onPageChange: (newPage) => {
            state.disbPage = newPage;
            renderTabDisbursement();
        }
    });
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

    const totalPages = Math.max(1, Math.ceil(displayMaterials.length / state.cnsPageSize));
    if (state.cnsPage > totalPages) state.cnsPage = totalPages;
    const startIndex = (state.cnsPage - 1) * state.cnsPageSize;
    const pageItems = displayMaterials.slice(startIndex, startIndex + state.cnsPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="rpt-table-empty">No consumption records found for the selected period.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(m => {
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

    renderReportsPaginationBar({
        containerId: "consumptionPagination",
        currentPage: state.cnsPage,
        totalItems: displayMaterials.length,
        pageSize: state.cnsPageSize,
        onPageChange: (newPage) => {
            state.cnsPage = newPage;
            renderTabConsumption();
        }
    });
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

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.fcPageSize));
    if (state.fcPage > totalPages) state.fcPage = totalPages;
    const startIndex = (state.fcPage - 1) * state.fcPageSize;
    const pageItems = filtered.slice(startIndex, startIndex + state.fcPageSize);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="rpt-table-empty">No matching forecast records found.</td></tr>`;
    } else {
        tbody.innerHTML = pageItems.map(f => {
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

    renderReportsPaginationBar({
        containerId: "forecastPagination",
        currentPage: state.fcPage,
        totalItems: filtered.length,
        pageSize: state.fcPageSize,
        onPageChange: (newPage) => {
            state.fcPage = newPage;
            renderTabForecasting();
        }
    });
}

/* ==========================================================
   EXCEL WORKBOOK EXPORT (5 ORGANIZED SHEETS)
   ========================================================== */

function buildUserExcelWorkbook(selectedSections = ["overview", "receiving", "disbursement", "consumption", "forecasting"]) {
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

    return wb;
}

async function generateUserExcelWorkbook(selectedSections = ["overview", "receiving", "disbursement", "consumption", "forecasting"], fileName = "RMIMS_User_Report") {
    if (typeof XLSX === "undefined") {
        showToast("Excel export library is loading, please try again.", "error");
        return;
    }

    const wb = buildUserExcelWorkbook(selectedSections);
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const excelBlob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const res = await saveUserExportBlob({ blob: excelBlob, fileName, defaultExtension: "xlsx" });
    if (res.mode === "custom-directory") {
        showToast(`Excel workbook saved directly to "${res.location}".`, "success");
    } else {
        showToast("Excel workbook downloaded successfully.", "success");
    }
}

/* ==========================================================
   PDF DOCUMENT EXPORT (jsPDF + autoTable)
   ========================================================== */

async function generateUserPdfReport(selectedSections = ["overview", "receiving", "disbursement", "consumption", "forecasting"], fileName = "RMIMS_User_Report") {
    if (typeof window.jspdf === "undefined" || !window.jspdf.jsPDF) {
        showToast("PDF generation library is loading, please try again.", "error");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 36;

    const RM_GREEN = [5, 150, 105];
    const RM_INK = [15, 23, 42];
    const RM_DIM = [100, 116, 139];

    const now = new Date();
    const genDateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTimeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    const docRef = `RMSME-USR-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

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
    doc.text("Operational Inventory & Production Report", 40, y);
    y += 16;

    // 3. Metadata Grid
    const colW = (pageWidth - 80) / 2;
    const leftCol = [
        ["REPORT HORIZON", periodLabel],
        ["REPORT PRESET", `${state.periodPreset.toUpperCase()} Snapshot`],
        ["SECURITY CLASSIFICATION", "Confidential / Internal Use Only"]
    ];
    const rightCol = [
        ["GENERATED AT", `${genDateStr} ${genTimeStr}`],
        ["PREPARED BY", currentUser?.fullName || "User"],
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

    const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    selectedSections.forEach(key => {
        if (y > doc.internal.pageSize.getHeight() - 140) {
            doc.addPage();
            y = 48;
        }

        if (key === "overview") {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("1. Operational Summary & Inventory Health", 40, y);
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
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "receiving") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("2. Recent Raw Material Receiving Log", 40, y);
            y += 12;

            doc.autoTable({
                startY: y,
                head: [["Date", "Raw Material", "ID", "Qty", "Unit", "Supplier", "Status"]],
                body: periodReceipts.length === 0 ? [["—", "—", "No receiving in period", "—", "—", "—", "—"]] :
                    periodReceipts.map(r => [
                        r.receiptDate,
                        r.materialName,
                        r.itemCode,
                        `+${r.receivedQuantity}`,
                        r.unit,
                        r.supplierName,
                        r.status
                    ]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "disbursement") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("3. Recent Raw Material Disbursement Log", 40, y);
            y += 12;

            doc.autoTable({
                startY: y,
                head: [["Date", "Product / Context", "Raw Material", "ID", "Qty", "Unit", "Status"]],
                body: periodDisbursements.length === 0 ? [["—", "—", "No disbursements in period", "—", "—", "—", "—"]] :
                    periodDisbursements.map(d => [
                        d.usageDate,
                        d.finishedProduct,
                        d.materialName,
                        d.itemCode,
                        `-${d.disbursedQuantity}`,
                        d.unit,
                        d.status
                    ]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "consumption") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("4. Consumption Analysis & Usage Trends", 40, y);
            y += 12;

            doc.autoTable({
                startY: y,
                head: [["Raw Material", "ID", "Current Stock", "Period Consumed", "Status"]],
                body: state.materials.map(m => {
                    const consumed = periodDisbursements.filter(d => d.materialId === m.id).reduce((sum, d) => sum + d.disbursedQuantity, 0);
                    return [
                        m.name,
                        m.itemCode,
                        `${m.currentStock.toLocaleString()} ${m.unit}`,
                        `${consumed.toLocaleString()} ${m.unit}`,
                        m.status
                    ];
                }),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }

        if (key === "forecasting") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...RM_GREEN);
            doc.text("5. AI Forecast Support & Projections", 40, y);
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
                styles: { font: "helvetica", fontSize: 8, textColor: RM_INK, cellPadding: 4.5 },
                headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" }
            });
            y = doc.lastAutoTable.finalY + 20;
        }
    });

    // Centered Faded Grey Watermark & Permanent Footer Across All Pages
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);

        // Centered Faded Grey Watermark
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
        doc.text("System Support: support@rmsme.internal | Helpline: (02) 8876-RMSME | Official System Generated Copy — Anti-Tamper Protected", 40, doc.internal.pageSize.getHeight() - 12);
    }

    const pdfBlob = doc.output("blob");
    const res = await saveUserExportBlob({ blob: pdfBlob, fileName, defaultExtension: "pdf" });
    if (res.mode === "custom-directory") {
        showToast(`PDF report saved directly to "${res.location}".`, "success");
    } else {
        showToast(`PDF report downloaded: ${fileName}.pdf`, "success");
    }
}

/* ==========================================================
   CSV & JSON EXPORT
   ========================================================== */

async function generateUserCsvPackage(selectedSections, fileName) {
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
        csvContent += `--- AI FORECAST SUPPORT ---\nRaw Material,Item Code,Forecast Period,Current Stock,Forecast 7D,Additional Need,Status\n`;
        state.forecastList.forEach(f => {
            csvContent += `"${f.name}","${f.itemCode}","Next 7 Days",${f.currentStock},${f.forecast7Day},${f.additionalNeed},"${f.status}"\n`;
        });
    }

    const csvBlob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const res = await saveUserExportBlob({ blob: csvBlob, fileName, defaultExtension: "csv" });
    if (res.mode === "custom-directory") {
        showToast(`CSV package saved directly to "${res.location}".`, "success");
    } else {
        showToast("CSV package exported successfully.", "success");
    }
}

async function generateUserJsonExport(selectedSections, fileName) {
    const exportObj = {
        meta: {
            title: "RMIMS User Report Export",
            periodPreset: state.periodPreset,
            startDate: state.startDate ? formatDateISO(state.startDate) : null,
            endDate: state.endDate ? formatDateISO(state.endDate) : null,
            generatedAt: new Date().toISOString()
        }
    };

    if (selectedSections.includes("overview")) {
        exportObj.overview = {
            totalMaterials: state.materials.length,
            needingAttention: state.materials.filter(m => m.status !== "Good").length,
            periodReceiptsCount: state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate)).length,
            periodDisbursementsCount: state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate)).length
        };
    }

    if (selectedSections.includes("receiving")) {
        exportObj.receiving = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    }

    if (selectedSections.includes("disbursement")) {
        exportObj.disbursement = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));
    }

    if (selectedSections.includes("consumption")) {
        exportObj.consumption = state.materials.map(m => ({
            materialId: m.id,
            materialName: m.name,
            currentStock: m.currentStock,
            unit: m.unit,
            periodConsumed: state.disbursements.filter(d => d.materialId === m.id && withinRange(d.usageDate, state.startDate, state.endDate)).reduce((s, d) => s + d.disbursedQuantity, 0)
        }));
    }

    if (selectedSections.includes("forecasting")) {
        exportObj.forecasting = state.forecastList;
    }

    const jsonBlob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
    const res = await saveUserExportBlob({ blob: jsonBlob, fileName, defaultExtension: "json" });
    if (res.mode === "custom-directory") {
        showToast(`JSON report saved directly to "${res.location}".`, "success");
    } else {
        showToast("JSON report exported successfully.", "success");
    }
};

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
        today: "Daily Operational Snapshot",
        weekly: "Weekly Inventory Movement",
        monthly: "Monthly Stock Summary",
        all: "Complete Enterprise History",
        custom: "Custom Date Horizon"
    }[state.periodPreset] || "Executive Operational Report";

    const now = new Date();
    const genDate = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTime = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    const docRefCode = `RMSME-USR-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const goodStock = state.materials.filter(m => m.status === "Good").length;
    const attentionStock = state.materials.filter(m => m.status !== "Good").length;

    let html = `
        <!-- PRINT DOCUMENT TABLE WRAPPER (ENABLES WATERMARK AND FOOTER ON EVERY PAGE) -->
        <table class="print-page-table-wrapper">
            <thead>
                <tr>
                    <th class="print-watermark-th">
                        <div class="print-page-watermark-box" aria-hidden="true">
                            <div class="print-watermark-inner">
                                <img src="../assets/logo-icon.png" class="print-watermark-logo-img" alt="RMSME Watermark Logo" />
                                <div class="print-watermark-title">RMSME</div>
                                <div class="print-watermark-sub">RAW MATERIAL STOCK MANAGEMENT &amp; FORECASTING ENTERPRISE</div>
                                <div class="print-watermark-tag">OFFICIAL SYSTEM REPORT • PREVENT FAKE COPY</div>
                            </div>
                        </div>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>
                        <!-- OFFICIAL PERMANENT RMSME HEADER WITH SYSTEM LOGO ICON -->
                        <div class="print-header-block">
                            <div class="print-logo-row">
                                <img src="../assets/logo-icon.png" class="print-header-logo-img" alt="RMSME System Logo" />
                                <div class="print-system-info">
                                    <h1 class="print-rmims-title">RMSME</h1>
                                    <div class="print-rmims-sub">RAW MATERIAL STOCK MANAGEMENT &amp; FORECASTING ENTERPRISE</div>
                                </div>
                            </div>
                            <div class="print-doc-meta-right">
                                <div><strong>Generated:</strong> ${genDate} at ${genTime}</div>
                                <div><strong>Operator:</strong> ${esc(currentUser?.fullName || "User")}</div>
                                <div><strong>Document Ref:</strong> <span style="font-family:monospace;">${docRefCode}</span></div>
                            </div>
                        </div>

                        <!-- METADATA CARD GRID -->
                        <div class="print-meta-grid-2col">
                            <div class="print-meta-item">
                                <span class="print-meta-lbl">REPORT HORIZON</span>
                                <span class="print-meta-val">${esc(periodLabel)}</span>
                            </div>
                            <div class="print-meta-item">
                                <span class="print-meta-lbl">REPORT PRESET</span>
                                <span class="print-meta-val">${esc(reportTypeLabel)}</span>
                            </div>
                            <div class="print-meta-item">
                                <span class="print-meta-lbl">SECURITY CLASSIFICATION</span>
                                <span class="print-meta-val">Confidential / Internal Operation</span>
                            </div>
                            <div class="print-meta-item">
                                <span class="print-meta-lbl">DATA INTEGRITY</span>
                                <span class="print-meta-val">Verified PostgreSQL Ledger</span>
                            </div>
                        </div>

                        <!-- FIRST CARD: OPERATIONAL SUMMARY & OVERVIEW -->
                        <div class="print-section">
                            <div class="print-section-header-wrap">
                                <h3 class="print-section-header-green">1. Operational Summary &amp; Overview</h3>
                                <span class="print-source-pill">Source: Operational Summary Matrix</span>
                            </div>
                            
                            <div class="print-kpi-summary-grid">
                                <div class="print-kpi-box">
                                    <div class="print-kpi-box-lbl">TOTAL RAW MATERIALS</div>
                                    <div class="print-kpi-box-num">${state.materials.length}</div>
                                </div>
                                <div class="print-kpi-box">
                                    <div class="print-kpi-box-lbl">OPTIMAL STOCK</div>
                                    <div class="print-kpi-box-num" style="color: #059669;">${goodStock}</div>
                                </div>
                                <div class="print-kpi-box">
                                    <div class="print-kpi-box-lbl">NEEDS ATTENTION</div>
                                    <div class="print-kpi-box-num" style="color: #dc2626;">${attentionStock}</div>
                                </div>
                                <div class="print-kpi-box">
                                    <div class="print-kpi-box-lbl">RECEIVING LOGS</div>
                                    <div class="print-kpi-box-num">${periodReceipts.length}</div>
                                </div>
                            </div>

                            <h4 class="print-subsection-title">Operational Health Matrix</h4>
                            <table class="print-table">
                                <thead>
                                    <tr>
                                        <th style="width: 60%;">Metric / Dimension</th>
                                        <th style="width: 40%;">Value / Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>Total Active Catalog Materials</td>
                                        <td><strong>${state.materials.length} items</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Materials at Optimal / Good Stock</td>
                                        <td><strong style="color: #059669;">${goodStock} items</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Materials Requiring Reorder / Attention</td>
                                        <td><strong style="color: ${attentionStock > 0 ? '#dc2626' : '#059669'};">${attentionStock} items</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Material Receipts in Selected Horizon</td>
                                        <td><strong>${periodReceipts.length} recorded transactions</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Production Disbursements in Selected Horizon</td>
                                        <td><strong>${periodDisbursements.length} recorded transactions</strong></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- SECTION 2: RAW MATERIAL INVENTORY RECORDS -->
                        <div class="print-section">
                            <div class="print-section-header-wrap">
                                <h3 class="print-section-header-green">2. Raw Material Inventory Records</h3>
                                <span class="print-source-pill">Source: raw_materials Catalog Ledger</span>
                            </div>
                            <table class="print-table">
                                <thead>
                                    <tr>
                                        <th>Raw Material</th>
                                        <th>Item Code</th>
                                        <th>Current Stock</th>
                                        <th>Minimum Threshold</th>
                                        <th>Reorder Quantity</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${state.materials.map(m => `
                                        <tr>
                                            <td><strong>${esc(m.name)}</strong></td>
                                            <td><span style="font-family:monospace; font-weight:700; color:#475569;">${esc(m.itemCode)}</span></td>
                                            <td><strong>${m.currentStock.toLocaleString()}</strong> ${esc(m.unit)}</td>
                                            <td>${m.minThreshold.toLocaleString()} ${esc(m.unit)}</td>
                                            <td>${m.reorderQty.toLocaleString()} ${esc(m.unit)}</td>
                                            <td><strong style="color:${m.status === 'Good' ? '#059669' : (m.status === 'Low' ? '#d97706' : '#dc2626')}">${esc(m.status)}</strong></td>
                                        </tr>
                                    `).join("")}
                                </tbody>
                            </table>
                        </div>

                        <!-- SECTION 3: RAW MATERIAL RECEIVING -->
                        <div class="print-section">
                            <div class="print-section-header-wrap">
                                <h3 class="print-section-header-green">3. Material Receiving Log</h3>
                                <span class="print-source-pill">Source: stock_receipts Inbound Records</span>
                            </div>
                            <table class="print-table">
                                <thead>
                                    <tr>
                                        <th>Receipt Date</th>
                                        <th>Raw Material</th>
                                        <th>Item Code</th>
                                        <th>Received Qty</th>
                                        <th>Unit</th>
                                        <th>Supplier / Source</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${periodReceipts.length === 0 ? `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:8px;">No material receiving records recorded in this period.</td></tr>` : 
                                    periodReceipts.map(r => `
                                        <tr>
                                            <td>${esc(r.receiptDate)}</td>
                                            <td><strong>${esc(r.materialName)}</strong></td>
                                            <td>${esc(r.itemCode)}</td>
                                            <td>+${r.receivedQuantity}</td>
                                            <td>${esc(r.unit)}</td>
                                            <td>${esc(formatContextDisplay(r.supplierName, "Supplier"))}</td>
                                            <td>${esc(r.status || "Verified")}</td>
                                        </tr>
                                    `).join("")}
                                </tbody>
                            </table>
                        </div>

                        <!-- SECTION 4: MATERIAL DISBURSEMENT -->
                        <div class="print-section">
                            <div class="print-section-header-wrap">
                                <h3 class="print-section-header-green">4. Material Disbursement Log</h3>
                                <span class="print-source-pill">Source: material_disbursements Production Issue Ledger</span>
                            </div>
                            <table class="print-table">
                                <thead>
                                    <tr>
                                        <th>Usage Date</th>
                                        <th>Target Product / Context</th>
                                        <th>Raw Material</th>
                                        <th>Item Code</th>
                                        <th>Disbursed Qty</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${periodDisbursements.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:8px;">No material disbursements recorded in this period.</td></tr>` :
                                    periodDisbursements.map(d => `
                                        <tr>
                                            <td>${esc(d.usageDate)}</td>
                                            <td><strong>${esc(formatContextDisplay(d.finishedProduct, "General Production"))}</strong></td>
                                            <td>${esc(d.materialName)}</td>
                                            <td>${esc(d.itemCode)}</td>
                                            <td>-${d.disbursedQuantity} ${esc(d.unit)}</td>
                                            <td>${esc(d.status || "Recorded")}</td>
                                        </tr>
                                    `).join("")}
                                </tbody>
                            </table>
                        </div>

                        <!-- SECTION 5: CONSUMPTION ANALYSIS -->
                        <div class="print-section">
                            <div class="print-section-header-wrap">
                                <h3 class="print-section-header-green">5. Raw Material Consumption Analysis</h3>
                                <span class="print-source-pill">Source: Period Usage vs Catalog Health</span>
                            </div>
                            <table class="print-table">
                                <thead>
                                    <tr>
                                        <th>Raw Material</th>
                                        <th>Item Code</th>
                                        <th>Current Stock</th>
                                        <th>Period Consumed</th>
                                        <th>Stock Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${state.materials.length === 0 ? `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:8px;">No catalog raw materials registered.</td></tr>` :
                                    state.materials.map(m => {
                                        const consumed = periodDisbursements.filter(d => d.materialId === m.id).reduce((sum, d) => sum + d.disbursedQuantity, 0);
                                        return `
                                            <tr>
                                                <td><strong>${esc(m.name)}</strong></td>
                                                <td>${esc(m.itemCode)}</td>
                                                <td>${m.currentStock.toLocaleString()} ${esc(m.unit)}</td>
                                                <td>${consumed.toLocaleString()} ${esc(m.unit)}</td>
                                                <td><span style="font-weight:600; color:${m.status === 'Critical' ? '#dc2626' : (m.status === 'Low' ? '#d97706' : '#059669')};">${esc(m.status)}</span></td>
                                            </tr>
                                        `;
                                    }).join("")}
                                </tbody>
                            </table>
                        </div>

                        <!-- SECTION 6: AI FORECAST PROJECTIONS -->
                        <div class="print-section">
                            <div class="print-section-header-wrap">
                                <h3 class="print-section-header-green">6. AI Forecast Projections &amp; Requirement Needs</h3>
                                <span class="print-source-pill">Source: AI Demand Forecasting Engine</span>
                            </div>
                            <table class="print-table">
                                <thead>
                                    <tr>
                                        <th>Raw Material</th>
                                        <th>Item Code</th>
                                        <th>Current Stock</th>
                                        <th>Forecast Requirement (7D)</th>
                                        <th>Additional Needed</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${state.forecastList.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:8px;">No AI forecast projections recorded.</td></tr>` :
                                    state.forecastList.map(f => `
                                        <tr>
                                            <td><strong>${esc(f.name)}</strong></td>
                                            <td>${esc(f.itemCode)}</td>
                                            <td>${f.currentStock.toLocaleString()} ${esc(f.unit)}</td>
                                            <td>${f.forecast7Day.toFixed(1)} ${esc(f.unit)}</td>
                                            <td>${f.additionalNeed > 0 ? `+${f.additionalNeed.toFixed(1)} ${esc(f.unit)}` : "0"}</td>
                                            <td>${esc(f.status || "Projected")}</td>
                                        </tr>
                                    `).join("")}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            </tbody>
            <tfoot>
                <tr>
                    <td>
                        <!-- Bottom System Ownership & Contact Footer on Every Page -->
                        <div class="print-doc-footer">
                            <div class="print-confidential-bottom">
                                <span>CONFIDENTIAL — RMSME INTERNAL AUDIT &amp; DECISION REPORT • STRICTLY FOR OPERATIONAL USE</span>
                            </div>
                            <div class="print-footer-top">
                                <span>RMSME — RAW MATERIAL STOCK MANAGEMENT &amp; FORECASTING ENTERPRISE</span>
                                <span>CONFIDENTIAL &amp; PROPRIETARY SYSTEM DOCUMENT</span>
                            </div>
                            <div class="print-footer-contact">
                                <span>System Support: <strong>support@rmsme.internal</strong> | Helpline: <strong>(02) 8876-RMSME</strong></span>
                                <span>Official System Generated Copy • Anti-Tamper Protected</span>
                            </div>
                        </div>
                    </td>
                </tr>
            </tfoot>
        </table>
    `;

    printDoc.innerHTML = html;
}

function handlePrintReport() {
    if (isPrinting) return;
    isPrinting = true;
    try {
        updatePrintDocHtml();
        setTimeout(() => {
            try {
                window.print();
            } catch (err) {
                console.error("Print error:", err);
            } finally {
                setTimeout(() => {
                    isPrinting = false;
                }, 400);
            }
        }, 50);
    } catch (err) {
        console.error("Print report generation error:", err);
        isPrinting = false;
    }
}

function formatOperatorDisplay(val, fallback = "User") {
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

// Global window functions for direct inline click handlers
window.__rmimsOpenSaveModal = openSaveModal;
window.__rmimsCloseSaveModal = closeSaveModal;
window.__rmimsHandleSaveConfirm = handleSaveConfirm;
window.__rmimsPrintReport = handlePrintReport;

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
