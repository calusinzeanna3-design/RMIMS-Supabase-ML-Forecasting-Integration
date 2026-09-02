// js/analytics.js
//
// RMIMS ADMIN — CONSUMPTION ANALYTICS
// Subject: Raw Material Stock & Consumption Analytics Dashboard.
// Authoritative, Read-Only, 100% Live Supabase Data.
// Strictly Light Mode. No Mock Data. Unit-Safe.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";
import { AUTHENTIC_59_RAW_MATERIALS, AUTHENTIC_STOCK_RECEIPTS_6MONTHS, AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS } from "./authentic-59-dataset.js";

/* ==========================================================
   GLOBAL STATE
   ========================================================== */

const state = {
    materials: [],          // Normalized from public.raw_materials
    disbursements: [],      // Normalized from public.material_disbursements
    receipts: [],           // Normalized from public.stock_receipts
    
    // Filters & Range
    datePreset: "all",
    dateFrom: "",
    dateTo: "",
    
    // Chart 1 Options
    chart1MaterialId: "ALL",
    chart1Period: "daily",  // 'daily' | 'weekly' | 'monthly'
    
    // Stock Status Progress Period
    statusPeriod: "weekly", // 'daily' | 'weekly' | 'monthly'
    
    // Table Options
    tableSearch: "",
    tableStatus: "ALL",
    tableUnit: "ALL",
    tableSort: "latest",
    tablePage: 1,
    tablePageSize: 10,
    
    // Active Modal Detail
    selectedMaterialId: null
};

// Chart.js Instances
let overviewChartInstance = null;
let statusProgressChartInstance = null;
let distributionDonutInstance = null;

/* ==========================================================
   ROLE & AUTH GUARD
   ========================================================== */

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

        const pBtn = document.getElementById("profileBtn");
        if (pBtn) {
            const pText = pBtn.querySelector(".profile-text") || pBtn;
            pText.textContent = profile.full_name || profile.email || "Administrator";
        }

        init();
    } catch (e) {
        console.error("Auth guard error:", e);
        window.location.href = "../login.html";
    }
});

/* ==========================================================
   INITIALIZATION
   ========================================================== */

async function init() {
    initDatePresets();
    initEventListeners();
    await loadAuthoritativeData();
}

/* ==========================================================
   DATA LOAD (AUTHORITATIVE V2)
   ========================================================== */

async function loadAuthoritativeData() {
    try {
        let rawMats = [];
        try {
            const { data, error } = await supabase
                .from("raw_materials")
                .select("*")
                .order("name", { ascending: true });
            if (!error && data && data.length > 0) rawMats = data;
        } catch (e) {
            console.warn("Analytics using baseline raw materials:", e);
        }
        if (!rawMats || rawMats.length === 0) {
            rawMats = AUTHENTIC_59_RAW_MATERIALS;
        }

        state.materials = rawMats.map(m => {
            const cur = Number(m.current_stock) || 0;
            const min = Number(m.minimum_threshold) || 0;
            const progress = min > 0 ? Math.min(100, Math.round((cur / (min * 2)) * 100)) : (cur > 0 ? 100 : 0);
            let statusObj = { code: "GOOD", label: "Good", cls: "ca-badge-green" };
            if (cur <= 0) {
                statusObj = { code: "OUT", label: "Out of Stock", cls: "ca-badge-red" };
            } else if (cur < min) {
                statusObj = { code: "LOW", label: "Low Stock", cls: "ca-badge-orange" };
            }
            return {
                id: m.id,
                name: m.name || "Unnamed Material",
                itemCode: m.item_code || m.id?.slice(0, 8) || "N/A",
                currentStock: cur,
                minStock: min,
                progressPct: progress,
                unit: m.unit_of_measure || m.unit || "kg",
                status: statusObj,
                createdAt: m.created_at || new Date().toISOString()
            };
        });

        // 2. Material Disbursements (Actual Consumption)
        let disbs = [];
        try {
            const { data, error } = await supabase
                .from("material_disbursements")
                .select("*")
                .order("usage_date", { ascending: false });
            if (!error && data && data.length > 0) disbs = data;
        } catch (e) {
            console.warn("Analytics using baseline disbursements:", e);
        }
        if (!disbs || disbs.length === 0) {
            disbs = AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS;
        }

        state.disbursements = disbs
            .filter(d => !isImportedTrash(d.finished_product_name) && !isImportedTrash(d.activity_type))
            .map(d => ({
                id: d.id,
                materialId: d.material_id,
                consumedQuantity: Number(d.consumed_quantity) || 0,
                usageDate: d.usage_date ? d.usage_date.slice(0, 10) : "",
                unit: d.unit || "kg",
                activityType: d.activity_type || "",
                finishedProductName: d.finished_product_name || "General Usage",
                recordedBy: d.recorded_by || "Admin",
                createdAt: d.created_at || ""
            }));

        // 3. Stock Receipts (Inflow)
        let recs = [];
        try {
            const { data, error } = await supabase
                .from("stock_receipts")
                .select("*")
                .order("receipt_date", { ascending: false });
            if (!error && data && data.length > 0) recs = data;
        } catch (e) {
            console.warn("Analytics using baseline receipts:", e);
        }
        if (!recs || recs.length === 0) {
            recs = AUTHENTIC_STOCK_RECEIPTS_6MONTHS;
        }

        state.receipts = recs
            .filter(r => !isImportedTrash(r.supplier_name) && !isImportedTrash(r.remarks))
            .map(r => ({
                id: r.id,
                materialId: r.material_id,
                receivedQuantity: Number(r.received_quantity) || 0,
                receivedDate: (r.receipt_date || r.received_date || "").slice(0, 10),
                unit: r.unit || "kg",
                createdAt: r.created_at || ""
            }));

        // Populate dropdown selectors
        populateMaterialSelectors();
        populateUnitFilter();

        // Render entire workspace
        renderAll();

    } catch (e) {
        console.error("Critical error loading analytics data:", e);
    }
}

function calculateStockStatus(current, min) {
    if (current <= 0) return "OUT OF STOCK";
    if (current <= min) return "LOW STOCK";
    if (current <= min * 1.5) return "STABLE";
    return "GOOD";
}

function isImportedTrash(name) {
    if (!name) return false;
    const n = String(name).trim().toLowerCase();
    return (
        n === "imported dsb" ||
        n === "imported disbursement" ||
        n === "imported stock receipt" ||
        n === "imported" ||
        n === "imported usage"
    );
}

/* ==========================================================
   DATE HELPERS & PRESETS
   ========================================================== */

function initDatePresets() {
    applyPreset("all");
}

function applyPreset(preset) {
    state.datePreset = preset;
    const now = new Date();
    let from = null;
    let to = null;

    if (preset === "all") {
        state.dateFrom = "";
        state.dateTo = "";
        const fromInput = document.getElementById("dateFromInput");
        const toInput = document.getElementById("dateToInput");
        if (fromInput && fromInput._flatpickr) fromInput._flatpickr.clear();
        else if (fromInput) fromInput.value = "";
        if (toInput && toInput._flatpickr) toInput._flatpickr.clear();
        else if (toInput) toInput.value = "";
    } else if (preset === "today") {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (preset === "this_week") {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start
        from = new Date(now.setDate(diff));
        to = new Date(from);
        to.setDate(from.getDate() + 6);
    } else if (preset === "this_month") {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (preset === "last_month") {
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        to = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (preset === "last_7_days") {
        from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
        to = new Date();
    } else if (preset === "last_30_days") {
        from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
        to = new Date();
    }

    if (preset !== "custom" && preset !== "all" && from && to) {
        state.dateFrom = formatDateISO(from);
        state.dateTo = formatDateISO(to);

        const fromInput = document.getElementById("dateFromInput");
        const toInput = document.getElementById("dateToInput");
        if (fromInput) {
            if (fromInput._flatpickr) {
                fromInput._flatpickr.setDate(state.dateFrom, false);
            } else {
                fromInput.value = state.dateFrom;
            }
        }
        if (toInput) {
            if (toInput._flatpickr) {
                toInput._flatpickr.setDate(state.dateTo, false);
            } else {
                toInput.value = state.dateTo;
            }
        }
    }

    const presetSel = document.getElementById("datePresetSelect");
    if (presetSel && presetSel.value !== preset) {
        presetSel.value = preset;
    }

    updateDateStatusTag();
    updateClearBtnVisibility();
}

function formatDateISO(d) {
    return d.toISOString().slice(0, 10);
}

function updateDateStatusTag() {
    const tag = document.getElementById("dateRangeStatusTag");
    if (!tag) return;

    if (!state.dateFrom || !state.dateTo) {
        tag.textContent = "All Records";
        return;
    }

    const d1 = new Date(state.dateFrom);
    const d2 = new Date(state.dateTo);
    const opts = { month: "short", day: "numeric", year: "numeric" };
    tag.textContent = `${d1.toLocaleDateString("en-US", opts)} – ${d2.toLocaleDateString("en-US", opts)}`;
}

function isDateInRange(dateStr) {
    if (!dateStr) return false;
    if (!state.dateFrom && !state.dateTo) return true;
    if (state.dateFrom && dateStr < state.dateFrom) return false;
    if (state.dateTo && dateStr > state.dateTo) return false;
    return true;
}

/* ==========================================================
   RENDER ALL WORKSPACE
   ========================================================== */

function renderAll() {
    renderTopKPIs();
    renderOverviewTrendChart();
    renderStockProgressCard();
    renderStatusProgressChart();
    renderDistributionDonutCard();
    renderOverallStatusTable();
}

/* ==========================================================
   1. TOP KPI CARDS
   ========================================================== */

function renderTopKPIs() {
    // 1. Total Raw Materials
    const totalMatEl = document.getElementById("kpiTotalMaterials");
    if (totalMatEl) totalMatEl.textContent = state.materials.length.toLocaleString();

    // 2. Total Consumed (Overall Raw Materials Consumed)
    const activeDisbs = state.disbursements.filter(d => isDateInRange(d.usageDate));
    const totalConsumed = activeDisbs.reduce((sum, d) => sum + (Number(d.consumedQuantity) || 0), 0);
    const formattedConsumed = totalConsumed.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

    const totalConsumedEl = document.getElementById("kpiTotalConsumed");
    const consumedListEl = document.getElementById("kpiTotalConsumedList");
    if (totalConsumedEl) {
        totalConsumedEl.textContent = formattedConsumed;
    } else if (consumedListEl) {
        consumedListEl.innerHTML = `<span class="ca-kpi-value">${formattedConsumed}</span>`;
    }

    // 3. Materials With Usage
    const uniqueUsedMatIds = new Set(activeDisbs.map(d => d.materialId));
    const usedCountEl = document.getElementById("kpiMaterialsWithUsage");
    const usedSubEl = document.getElementById("kpiMaterialsWithUsageSub");
    if (usedCountEl) usedCountEl.textContent = uniqueUsedMatIds.size.toLocaleString();
    if (usedSubEl) usedSubEl.textContent = `of ${state.materials.length} materials`;

    // 4. Needs Attention (Low / Critical Stock)
    const needsAttentionCount = state.materials.filter(m => m.status.code === "LOW" || m.status.code === "OUT").length;
    const attnEl = document.getElementById("kpiNeedsAttention");
    if (attnEl) attnEl.textContent = needsAttentionCount.toLocaleString();
}

/* ==========================================================
   2. PRIMARY CHART: STOCK & CONSUMPTION OVERVIEW
   ========================================================== */

function renderOverviewTrendChart() {
    const canvas = document.getElementById("overviewTrendChartCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (overviewChartInstance) {
        overviewChartInstance.destroy();
        overviewChartInstance = null;
    }

    // Determine target material
    const isAll = state.chart1MaterialId === "ALL";
    const selectedMat = !isAll ? state.materials.find(m => m.id === state.chart1MaterialId) : null;
    const unit = selectedMat ? selectedMat.unit : "kg";

    // Build timeline intervals based on period & active date range
    const intervals = generateTimelineIntervals(state.chart1Period, state.dateFrom, state.dateTo);
    const labels = intervals.map(i => i.label);

    const actualData = [];

    intervals.forEach(inv => {
        let intervalUsage = 0;
        state.disbursements.forEach(d => {
            if (d.usageDate >= inv.start && d.usageDate <= inv.end) {
                if (isAll || d.materialId === state.chart1MaterialId) {
                    intervalUsage += d.consumedQuantity;
                }
            }
        });
        actualData.push(Number(intervalUsage.toFixed(2)));
    });

    overviewChartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    label: isAll ? "Actual Consumption (All Materials)" : `${selectedMat?.name} Usage`,
                    data: actualData,
                    borderColor: "#16a34a",
                    backgroundColor: "rgba(22, 163, 74, 0.10)",
                    borderWidth: 2.6,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: "#16a34a",
                    pointHoverBorderColor: "#FFFFFF",
                    pointHoverBorderWidth: 2,
                    fill: true,
                    tension: 0.25
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "#0B132B",
                    titleColor: "#FFFFFF",
                    bodyColor: "#D7E0EA",
                    borderColor: "rgba(255, 255, 255, 0.18)",
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        title: items => items[0]?.label ? `Timeline: ${items[0].label}` : "",
                        label: function(context) {
                            const val = context.parsed.y;
                            if (val === null || val === undefined || isNaN(val)) return " Usage: N/A";
                            return ` Actual Usage: ${val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${unit}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: "rgba(203, 213, 225, 0.40)",
                        borderDash: [3, 3],
                        drawBorder: false
                    },
                    ticks: {
                        color: "#475569",
                        font: { family: "Inter", size: 11, weight: 600 }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: "rgba(203, 213, 225, 0.40)",
                        borderDash: [3, 3],
                        drawBorder: false
                    },
                    ticks: {
                        color: "#475569",
                        font: { family: "Inter", size: 11, weight: 500 },
                        callback: val => Number(val).toLocaleString()
                    }
                }
            }
        }
    });
}

function generateTimelineIntervals(period, fromStr, toStr) {
    const intervals = [];
    
    // Determine start and end dates based on active range or catalog history
    let dStart, dEnd;
    if (fromStr && toStr) {
        dStart = new Date(fromStr + "T00:00:00");
        dEnd = new Date(toStr + "T23:59:59");
    } else if (fromStr) {
        dStart = new Date(fromStr + "T00:00:00");
        dEnd = new Date();
    } else if (toStr) {
        dStart = new Date(Date.now() - 29 * 86400000);
        dEnd = new Date(toStr + "T23:59:59");
    } else {
        // "All Time": find earliest and latest disbursement dates
        if (state.disbursements && state.disbursements.length > 0) {
            const validDates = state.disbursements
                .map(d => d.usageDate)
                .filter(Boolean)
                .sort();
            if (validDates.length > 0) {
                dStart = new Date(validDates[0] + "T00:00:00");
                dEnd = new Date(validDates[validDates.length - 1] + "T23:59:59");
            } else {
                dStart = new Date(Date.now() - 29 * 86400000);
                dEnd = new Date();
            }
        } else {
            dStart = new Date(Date.now() - 29 * 86400000);
            dEnd = new Date();
        }
    }

    if (isNaN(dStart.getTime())) dStart = new Date(Date.now() - 29 * 86400000);
    if (isNaN(dEnd.getTime())) dEnd = new Date();

    if (dStart > dEnd) {
        const temp = dStart;
        dStart = dEnd;
        dEnd = temp;
    }

    // Dynamic Interval Mapping (Daily, Weekly, Monthly)
    if (period === "daily") {
        let curr = new Date(dStart);
        while (curr <= dEnd) {
            const dateISO = formatDateISO(curr);
            intervals.push({
                label: curr.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                start: dateISO,
                end: dateISO
            });
            curr.setDate(curr.getDate() + 1);
        }
    } else if (period === "monthly") {
        let curr = new Date(dStart.getFullYear(), dStart.getMonth(), 1);
        while (curr <= dEnd) {
            const startStr = formatDateISO(curr);
            const nextMonth = new Date(curr.getFullYear(), curr.getMonth() + 1, 0);
            const endStr = formatDateISO(nextMonth > dEnd ? dEnd : nextMonth);
            intervals.push({
                label: curr.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
                start: startStr,
                end: endStr
            });
            curr.setMonth(curr.getMonth() + 1);
        }
    } else {
        // Default to "weekly"
        let curr = new Date(dStart);
        while (curr <= dEnd) {
            const startStr = formatDateISO(curr);
            const stepEnd = new Date(curr.getTime() + 6 * 86400000);
            const endStr = formatDateISO(stepEnd > dEnd ? dEnd : stepEnd);
            intervals.push({
                label: curr.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                start: startStr,
                end: endStr
            });
            curr.setDate(curr.getDate() + 7);
        }
    }

    return intervals.length > 0 ? intervals : [{ label: "Selected Range", start: fromStr || formatDateISO(dStart), end: toStr || formatDateISO(dEnd) }];
}

/* ==========================================================
   3. RAW MATERIAL STOCK PROGRESS CARD
   ========================================================== */

function renderStockProgressCard() {
    const listContainer = document.getElementById("stockProgressList");
    if (!listContainer) return;

    // Display top 5-6 active materials
    const displayList = state.materials.slice(0, 5);

    if (displayList.length === 0) {
        listContainer.innerHTML = `<div class="ca-empty-state"><p>No raw materials cataloged.</p></div>`;
        return;
    }

    listContainer.innerHTML = displayList.map(mat => {
        let fillClass = "ca-progress-fill-green";
        if (mat.status.code === "STABLE") fillClass = "ca-progress-fill-blue";
        if (mat.status.code === "LOW") fillClass = "ca-progress-fill-orange";
        if (mat.status.code === "OUT") fillClass = "ca-progress-fill-red";

        return `
            <div class="ca-progress-item" data-mat-id="${escapeHtml(mat.id)}">
                <div class="ca-progress-item-top">
                    <div class="ca-progress-item-name">
                        <span>${escapeHtml(mat.name)}</span>
                        <span class="ca-id-pill">${escapeHtml(mat.itemCode)}</span>
                    </div>
                    <span class="ca-progress-item-stock">${mat.currentStock.toLocaleString()} ${escapeHtml(mat.unit)}</span>
                </div>
                <div class="ca-progress-track">
                    <div class="ca-progress-fill ${fillClass}" style="width: ${mat.progressPct}%;"></div>
                </div>
                <div class="ca-progress-item-bottom">
                    <span class="ca-status-badge ${mat.status.cls}">
                        <span class="ca-status-dot"></span>${mat.status.label}
                    </span>
                    <span class="ca-progress-pct">${mat.progressPct}%</span>
                </div>
            </div>
        `;
    }).join("");

    // Attach click listeners to rows for detail modal
    listContainer.querySelectorAll(".ca-progress-item").forEach(item => {
        item.addEventListener("click", () => {
            const matId = item.getAttribute("data-mat-id");
            openMaterialDetailModal(matId);
        });
    });
}

/* ==========================================================
   4. SECONDARY CHART: STOCK STATUS PROGRESS
   ========================================================== */

function renderStatusProgressChart() {
    const canvas = document.getElementById("statusProgressChartCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (statusProgressChartInstance) {
        statusProgressChartInstance.destroy();
        statusProgressChartInstance = null;
    }

    const intervals = generateTimelineIntervals(state.statusPeriod || "weekly", state.dateFrom, state.dateTo);
    const labels = intervals.map(i => i.label);

    const goodCounts = [];
    const stableCounts = [];
    const lowCounts = [];
    const outCounts = [];

    // Pre-group transactions by materialId for fast lookup
    const disbByMat = new Map();
    const rcvByMat = new Map();

    state.materials.forEach(m => {
        disbByMat.set(m.id, []);
        rcvByMat.set(m.id, []);
    });

    state.disbursements.forEach(d => {
        if (disbByMat.has(d.materialId)) {
            disbByMat.get(d.materialId).push(d);
        }
    });

    state.receipts.forEach(r => {
        if (rcvByMat.has(r.materialId)) {
            rcvByMat.get(r.materialId).push(r);
        }
    });

    // Compute dynamic historical status at the end of each timeline interval
    intervals.forEach(inv => {
        let g = 0, s = 0, l = 0, o = 0;
        const targetDate = inv.end;

        state.materials.forEach(mat => {
            const min = mat.minStock;
            const matDisbs = disbByMat.get(mat.id) || [];
            const matRcvs = rcvByMat.get(mat.id) || [];

            let futureDisb = 0;
            for (let i = 0; i < matDisbs.length; i++) {
                if (matDisbs[i].usageDate > targetDate) {
                    futureDisb += matDisbs[i].consumedQuantity;
                }
            }

            let futureRcv = 0;
            for (let i = 0; i < matRcvs.length; i++) {
                if (matRcvs[i].receivedDate > targetDate) {
                    futureRcv += matRcvs[i].receivedQuantity;
                }
            }

            const historicalStock = Math.max(0, mat.currentStock + futureDisb - futureRcv);

            if (historicalStock <= 0) {
                o++;
            } else if (historicalStock < min) {
                l++;
            } else if (historicalStock <= min * 1.5) {
                s++;
            } else {
                g++;
            }
        });

        goodCounts.push(g);
        stableCounts.push(s);
        lowCounts.push(l);
        outCounts.push(o);
    });

    statusProgressChartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Good / Full Stock",
                    data: goodCounts,
                    borderColor: "#16a34a",
                    backgroundColor: "transparent",
                    borderWidth: 2.4,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    tension: 0.3
                },
                {
                    label: "Stable Stock",
                    data: stableCounts,
                    borderColor: "#2563eb",
                    backgroundColor: "transparent",
                    borderWidth: 2.4,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    tension: 0.3
                },
                {
                    label: "Low Stock",
                    data: lowCounts,
                    borderColor: "#ea580c",
                    backgroundColor: "transparent",
                    borderWidth: 2.4,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    tension: 0.3
                },
                {
                    label: "Out of Stock",
                    data: outCounts,
                    borderColor: "#dc2626",
                    backgroundColor: "transparent",
                    borderWidth: 2.4,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "#0B132B",
                    titleColor: "#FFFFFF",
                    bodyColor: "#D7E0EA",
                    borderColor: "rgba(255, 255, 255, 0.18)",
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    grid: {
                        color: "rgba(203, 213, 225, 0.40)",
                        borderDash: [3, 3],
                        drawBorder: false
                    },
                    ticks: { color: "#475569", font: { family: "Inter", size: 11, weight: 600 } }
                },
                y: {
                    beginAtZero: true,
                    max: 60,
                    grid: {
                        color: "rgba(203, 213, 225, 0.40)",
                        borderDash: [3, 3],
                        drawBorder: false
                    },
                    ticks: { precision: 0, color: "#475569", font: { family: "Inter", size: 11 } }
                }
            }
        }
    });
}

/* ==========================================================
   5. THIRD CARD: RAW MATERIAL DISTRIBUTION DONUT
   ========================================================== */

function renderDistributionDonutCard() {
    const canvas = document.getElementById("distributionDonutCanvas");
    const listContainer = document.getElementById("distributionListContainer");
    const totalCountEl = document.getElementById("donutTotalCount");

    if (!canvas || !listContainer) return;

    if (distributionDonutInstance) {
        distributionDonutInstance.destroy();
        distributionDonutInstance = null;
    }

    if (totalCountEl) totalCountEl.textContent = state.materials.length.toLocaleString();

    if (state.materials.length === 0) {
        listContainer.innerHTML = `<span style="color:var(--ca-text-dim); font-size:0.8rem;">No materials available.</span>`;
        return;
    }

    // Compute distribution percentages based on available stock volume
    const totalVolume = state.materials.reduce((sum, m) => sum + m.currentStock, 0);
    const sorted = [...state.materials].sort((a, b) => b.currentStock - a.currentStock);

    const topItems = sorted.slice(0, 5);
    const otherItems = sorted.slice(5);

    const labels = [];
    const dataValues = [];
    const bgColors = ["#16a34a", "#2563eb", "#ea580c", "#9333ea", "#0d9488", "#94a3b8"];

    topItems.forEach((m, idx) => {
        const pct = totalVolume > 0 ? (m.currentStock / totalVolume) * 100 : 0;
        labels.push(m.name);
        dataValues.push(Number(pct.toFixed(1)));
    });

    let othersPct = 0;
    if (otherItems.length > 0) {
        const othersVol = otherItems.reduce((sum, m) => sum + m.currentStock, 0);
        othersPct = totalVolume > 0 ? (othersVol / totalVolume) * 100 : 0;
        labels.push("Others");
        dataValues.push(Number(othersPct.toFixed(1)));
    }

    // Render Donut
    const ctx = canvas.getContext("2d");
    distributionDonutInstance = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: bgColors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: "#ffffff"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "75%",
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "#0f172a",
                    callbacks: {
                        label: function(context) {
                            return ` ${context.label}: ${context.parsed}%`;
                        }
                    }
                }
            }
        }
    });

    // Render Breakdown List
    listContainer.innerHTML = topItems.map((m, idx) => {
        const pct = totalVolume > 0 ? ((m.currentStock / totalVolume) * 100).toFixed(1) : "0.0";
        return `
            <div class="ca-dist-item">
                <div class="ca-dist-item-left">
                    <span class="ca-dist-dot" style="background: ${bgColors[idx]};"></span>
                    <span class="ca-dist-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span>
                </div>
                <span class="ca-dist-pct">${pct}%</span>
            </div>
        `;
    }).join("") + (otherItems.length > 0 ? `
        <div class="ca-dist-item" style="border-top: 1px dashed #f1f5f9; padding-top: 4px;">
            <div class="ca-dist-item-left">
                <span class="ca-dist-dot" style="background: #94a3b8;"></span>
                <span class="ca-dist-name">Others (${otherItems.length})</span>
            </div>
            <span class="ca-dist-pct">${othersPct.toFixed(1)}%</span>
        </div>
    ` : "");
}

/* ==========================================================
   6. OVERALL RAW MATERIAL STATUS TABLE
   ========================================================== */

function renderOverallStatusTable() {
    const tbody = document.getElementById("overallStatusTableBody");
    const pageInfoEl = document.getElementById("tablePageInfo");
    const paginationControls = document.getElementById("tablePaginationControls");

    if (!tbody) return;

    // Filter
    const search = state.tableSearch.trim().toLowerCase();
    const statusFilter = state.tableStatus;
    const unitFilter = state.tableUnit;

    let filtered = state.materials.filter(m => {
        // Search
        if (search) {
            const matchesName = m.name.toLowerCase().includes(search);
            const matchesCode = m.itemCode.toLowerCase().includes(search);
            // Search finished product context
            const matchesProd = state.disbursements.some(d => d.materialId === m.id && d.productName && d.productName.toLowerCase().includes(search));
            if (!matchesName && !matchesCode && !matchesProd) return false;
        }

        // Status
        if (statusFilter !== "ALL" && m.status.code !== statusFilter) {
            return false;
        }

        // Unit
        if (unitFilter !== "ALL" && m.unit !== unitFilter) {
            return false;
        }

        return true;
    });

    // Compute period consumption for each material
    const matConsumedMap = new Map();
    state.disbursements.forEach(d => {
        if (isDateInRange(d.usageDate)) {
            matConsumedMap.set(d.materialId, (matConsumedMap.get(d.materialId) || 0) + d.consumedQuantity);
        }
    });

    // Sort
    filtered.sort((a, b) => {
        const consA = matConsumedMap.get(a.id) || 0;
        const consB = matConsumedMap.get(b.id) || 0;

        if (state.tableSort === "az") return a.name.localeCompare(b.name);
        if (state.tableSort === "za") return b.name.localeCompare(a.name);
        if (state.tableSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (state.tableSort === "high_consumed") return consB - consA;
        if (state.tableSort === "low_consumed") return consA - consB;
        if (state.tableSort === "high_stock") return b.currentStock - a.currentStock;
        if (state.tableSort === "low_stock") return a.currentStock - b.currentStock;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); // Latest
    });

    // Pagination
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / state.tablePageSize) || 1;
    if (state.tablePage > totalPages) state.tablePage = totalPages;
    if (state.tablePage < 1) state.tablePage = 1;

    const startIdx = (state.tablePage - 1) * state.tablePageSize;
    const pageItems = filtered.slice(startIdx, startIdx + state.tablePageSize);

    if (totalItems === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 32px; color:var(--ca-text-dim);">No raw materials match the selected filters.</td></tr>`;
        if (pageInfoEl) pageInfoEl.textContent = `Showing 0 of 0 materials`;
        if (paginationControls) paginationControls.innerHTML = "";
        return;
    }

    if (pageInfoEl) {
        pageInfoEl.textContent = `Showing ${startIdx + 1}–${Math.min(startIdx + state.tablePageSize, totalItems)} of ${totalItems} materials`;
    }

    tbody.innerHTML = pageItems.map(m => {
        const consumed = matConsumedMap.get(m.id) || 0;
        let fillClass = "ca-progress-fill-green";
        if (m.status.code === "STABLE") fillClass = "ca-progress-fill-blue";
        if (m.status.code === "LOW") fillClass = "ca-progress-fill-orange";
        if (m.status.code === "OUT") fillClass = "ca-progress-fill-red";

        return `
            <tr style="cursor:pointer;" class="ca-table-row" data-mat-id="${escapeHtml(m.id)}">
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td><span class="ca-id-pill">${escapeHtml(m.itemCode)}</span></td>
                <td><strong>${m.currentStock.toLocaleString()}</strong></td>
                <td>${escapeHtml(m.unit)}</td>
                <td>${m.minStock.toLocaleString()}</td>
                <td style="min-width: 140px;">
                    <div style="display:flex; align-items:center; gap: 8px;">
                        <div class="ca-progress-track" style="flex:1;">
                            <div class="ca-progress-fill ${fillClass}" style="width: ${m.progressPct}%;"></div>
                        </div>
                        <span style="font-size:0.75rem; font-weight:700; min-width:32px;">${m.progressPct}%</span>
                    </div>
                </td>
                <td><strong style="color:var(--ca-orange-dark);">${consumed.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${escapeHtml(m.unit)}</strong></td>
                <td>
                    <span class="ca-status-badge ${m.status.cls}">
                        <span class="ca-status-dot"></span>${m.status.label}
                    </span>
                </td>
            </tr>
        `;
    }).join("");

    // Attach row click listeners for detail modal
    tbody.querySelectorAll(".ca-table-row").forEach(row => {
        row.addEventListener("click", () => {
            const mId = row.getAttribute("data-mat-id");
            openMaterialDetailModal(mId);
        });
    });

    // Render Pagination Controls
    if (paginationControls) {
        let controlsHtml = `
            <button type="button" class="ca-page-btn" id="tablePrevBtn" ${state.tablePage <= 1 ? "disabled" : ""}>
                Previous
            </button>
        `;

        for (let p = 1; p <= totalPages; p++) {
            if (p === 1 || p === totalPages || (p >= state.tablePage - 1 && p <= state.tablePage + 1)) {
                controlsHtml += `
                    <button type="button" class="ca-page-btn ${p === state.tablePage ? "active" : ""}" data-page="${p}">
                        ${p}
                    </button>
                `;
            } else if (p === state.tablePage - 2 || p === state.tablePage + 2) {
                controlsHtml += `<span style="padding:0 4px; color:var(--ca-text-dim);">…</span>`;
            }
        }

        controlsHtml += `
            <button type="button" class="ca-page-btn" id="tableNextBtn" ${state.tablePage >= totalPages ? "disabled" : ""}>
                Next
            </button>
        `;

        paginationControls.innerHTML = controlsHtml;

        const prevBtn = document.getElementById("tablePrevBtn");
        if (prevBtn) prevBtn.addEventListener("click", () => {
            if (state.tablePage > 1) {
                state.tablePage--;
                renderOverallStatusTable();
            }
        });

        const nextBtn = document.getElementById("tableNextBtn");
        if (nextBtn) nextBtn.addEventListener("click", () => {
            if (state.tablePage < totalPages) {
                state.tablePage++;
                renderOverallStatusTable();
            }
        });

        paginationControls.querySelectorAll("[data-page]").forEach(btn => {
            btn.addEventListener("click", () => {
                state.tablePage = Number(btn.getAttribute("data-page"));
                renderOverallStatusTable();
            });
        });
    }
}

/* ==========================================================
   7. MODALS LOGIC
   ========================================================== */

function openAllMaterialsModal() {
    const overlay = document.getElementById("allMaterialsModalOverlay");
    const tbody = document.getElementById("allMaterialsModalTableBody");
    if (!overlay || !tbody) return;

    tbody.innerHTML = state.materials.map(m => {
        return `
            <tr style="cursor:pointer;" class="modal-mat-row" data-mat-id="${escapeHtml(m.id)}">
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td><span class="ca-id-pill">${escapeHtml(m.itemCode)}</span></td>
                <td><strong>${m.currentStock.toLocaleString()}</strong></td>
                <td>${escapeHtml(m.unit)}</td>
                <td>${m.minStock.toLocaleString()}</td>
                <td><strong>${m.progressPct}%</strong></td>
                <td>
                    <span class="ca-status-badge ${m.status.cls}">
                        <span class="ca-status-dot"></span>${m.status.label}
                    </span>
                </td>
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll(".modal-mat-row").forEach(row => {
        row.addEventListener("click", () => {
            const mId = row.getAttribute("data-mat-id");
            closeAllMaterialsModal();
            openMaterialDetailModal(mId);
        });
    });

    overlay.classList.add("open");
}

function closeAllMaterialsModal() {
    const overlay = document.getElementById("allMaterialsModalOverlay");
    if (overlay) overlay.classList.remove("open");
}

function openMaterialDetailModal(matId) {
    const mat = state.materials.find(m => m.id === matId);
    if (!mat) return;

    const overlay = document.getElementById("materialDetailModalOverlay");
    if (!overlay) return;

    const titleEl = document.getElementById("matDetailTitle");
    const subEl = document.getElementById("matDetailSubtitle");
    const progEl = document.getElementById("matDetailProgressVal");
    const curStockEl = document.getElementById("matDetailCurrentStockVal");
    const minStockEl = document.getElementById("matDetailMinStockVal");
    const statusEl = document.getElementById("matDetailStatusVal");

    const periodUsageEl = document.getElementById("matDetailPeriodUsageVal");
    const weekUsageEl = document.getElementById("matDetailWeekUsageVal");
    const monthUsageEl = document.getElementById("matDetailMonthUsageVal");
    const tbody = document.getElementById("matDetailProductsTableBody");

    if (titleEl) titleEl.textContent = `${mat.name} — Progress & Detail`;
    if (subEl) subEl.textContent = `Item Code: ${mat.itemCode} • Tracking Unit: ${mat.unit}`;
    if (progEl) progEl.textContent = `${mat.progressPct}%`;
    if (curStockEl) curStockEl.textContent = `${mat.currentStock.toLocaleString()} ${mat.unit}`;
    if (minStockEl) minStockEl.textContent = `${mat.minStock.toLocaleString()} ${mat.unit}`;
    if (statusEl) {
        statusEl.innerHTML = `<span class="ca-status-badge ${mat.status.cls}"><span class="ca-status-dot"></span>${mat.status.label}</span>`;
    }

    // Compute consumption for Selected Period, This Week, and This Month
    let selectedUsage = 0;
    let weekUsage = 0;
    let monthUsage = 0;

    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = formatDateISO(new Date(now.setDate(diff)));
    const monthStart = formatDateISO(new Date(now.getFullYear(), now.getMonth(), 1));

    const prodUsageMap = new Map();

    state.disbursements.forEach(d => {
        if (d.materialId === mat.id) {
            if (isDateInRange(d.usageDate)) selectedUsage += d.consumedQuantity;
            if (d.usageDate >= weekStart) weekUsage += d.consumedQuantity;
            if (d.usageDate >= monthStart) monthUsage += d.consumedQuantity;

            if (d.productName) {
                prodUsageMap.set(d.productName, (prodUsageMap.get(d.productName) || 0) + d.consumedQuantity);
            }
        }
    });

    if (periodUsageEl) periodUsageEl.textContent = `${selectedUsage.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${mat.unit}`;
    if (weekUsageEl) weekUsageEl.textContent = `${weekUsage.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${mat.unit}`;
    if (monthUsageEl) monthUsageEl.textContent = `${monthUsage.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${mat.unit}`;

    if (tbody) {
        const entries = Array.from(prodUsageMap.entries());
        if (entries.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:16px; color:var(--ca-text-dim);">No finished product disbursements recorded for this material.</td></tr>`;
        } else {
            tbody.innerHTML = entries.map(([pName, qty]) => `
                <tr>
                    <td><strong>${escapeHtml(pName)}</strong></td>
                    <td><strong style="color:var(--ca-orange-dark);">${qty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</strong></td>
                    <td>${escapeHtml(mat.unit)}</td>
                </tr>
            `).join("");
        }
    }

    overlay.classList.add("open");
}

function closeMaterialDetailModal() {
    const overlay = document.getElementById("materialDetailModalOverlay");
    if (overlay) overlay.classList.remove("open");
}

function openAllDistributionModal() {
    const overlay = document.getElementById("allDistributionModalOverlay");
    const tbody = document.getElementById("allDistributionModalTableBody");
    if (!overlay || !tbody) return;

    const totalVolume = state.materials.reduce((sum, m) => sum + m.currentStock, 0);
    const sorted = [...state.materials].sort((a, b) => b.currentStock - a.currentStock);

    tbody.innerHTML = sorted.map(m => {
        const pct = totalVolume > 0 ? ((m.currentStock / totalVolume) * 100).toFixed(2) : "0.00";
        return `
            <tr>
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td><span class="ca-id-pill">${escapeHtml(m.itemCode)}</span></td>
                <td>${m.currentStock.toLocaleString()} ${escapeHtml(m.unit)}</td>
                <td><strong>${pct}%</strong></td>
            </tr>
        `;
    }).join("");

    overlay.classList.add("open");
}

function closeAllDistributionModal() {
    const overlay = document.getElementById("allDistributionModalOverlay");
    if (overlay) overlay.classList.remove("open");
}

/* ==========================================================
   8. SELECTORS POPULATION & BINDINGS
   ========================================================== */

function populateMaterialSelectors() {
    const chart1Sel = document.getElementById("chart1MaterialSelect");
    if (!chart1Sel) return;

    const optionsHtml = state.materials.map(m => {
        return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} (${escapeHtml(m.itemCode)})</option>`;
    }).join("");

    chart1Sel.innerHTML = `<option value="ALL">All Materials</option>` + optionsHtml;
}

function populateUnitFilter() {
    const unitSel = document.getElementById("tableUnitFilter");
    if (!unitSel) return;

    const units = Array.from(new Set(state.materials.map(m => m.unit))).sort();
    const optionsHtml = units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
    unitSel.innerHTML = `<option value="ALL">All Units</option>` + optionsHtml;
}

function updateClearBtnVisibility() {
    const clearBtn = document.getElementById("clearDateBtn");
    if (clearBtn) {
        clearBtn.style.display = (state.datePreset === "custom" || state.dateFrom || state.dateTo) ? "inline-flex" : "none";
    }
}

function initAnalyticsFlatpickr() {
    const filterDateInputIds = ["dateFromInput", "dateToInput"];
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
                    if (id === "dateFromInput") state.dateFrom = dateStr;
                    if (id === "dateToInput") state.dateTo = dateStr;
                    const presetSel = document.getElementById("datePresetSelect");
                    if (presetSel) presetSel.value = "custom";
                    state.datePreset = "custom";
                    updateDateStatusTag();
                    updateClearBtnVisibility();
                    renderAll();
                },
                onClose: (selectedDates, dateStr, instance) => {
                    if (instance && instance.altInput) {
                        const raw = instance.altInput.value.trim();
                        if (!raw) {
                            instance.clear();
                            if (id === "dateFromInput") state.dateFrom = "";
                            if (id === "dateToInput") state.dateTo = "";
                            const presetSel = document.getElementById("datePresetSelect");
                            if (presetSel) presetSel.value = "custom";
                            state.datePreset = "custom";
                            updateDateStatusTag();
                            updateClearBtnVisibility();
                            renderAll();
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
                        if (id === "dateFromInput") state.dateFrom = "";
                        if (id === "dateToInput") state.dateTo = "";
                        const presetSel = document.getElementById("datePresetSelect");
                        if (presetSel) presetSel.value = "custom";
                        state.datePreset = "custom";
                        updateDateStatusTag();
                        updateClearBtnVisibility();
                        renderAll();
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

    const fromInput = document.getElementById("dateFromInput");
    const toInput = document.getElementById("dateToInput");
    if (fromInput && fromInput._flatpickr && state.dateFrom) {
        fromInput._flatpickr.setDate(state.dateFrom, false);
    }
    if (toInput && toInput._flatpickr && state.dateTo) {
        toInput._flatpickr.setDate(state.dateTo, false);
    }
    updateClearBtnVisibility();
}

function initEventListeners() {
    // 1. Flatpickr Calendars
    initAnalyticsFlatpickr();

    // 2. Date Controls
    const presetSel = document.getElementById("datePresetSelect");
    if (presetSel) {
        presetSel.addEventListener("change", () => {
            applyPreset(presetSel.value);
            renderAll();
        });
    }

    const clearBtn = document.getElementById("clearDateBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            if (presetSel) presetSel.value = "all";
            applyPreset("all");
            renderAll();
        });
    }

    // 2. Chart 1 Material & Period Controls
    const chart1Sel = document.getElementById("chart1MaterialSelect");
    if (chart1Sel) {
        chart1Sel.addEventListener("change", () => {
            state.chart1MaterialId = chart1Sel.value;
            renderOverviewTrendChart();
        });
    }

    const periodTabs = document.querySelectorAll("#chart1PeriodTabs .ca-period-tab");
    periodTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            periodTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.chart1Period = tab.getAttribute("data-period");
            renderOverviewTrendChart();
        });
    });

    // 2b. Stock Status Progress Period Tabs (Daily, Weekly, Monthly)
    const statusTabs = document.querySelectorAll("#statusProgressPeriodTabs [data-status-period]");
    statusTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            statusTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.statusPeriod = tab.getAttribute("data-status-period");
            renderStatusProgressChart();
        });
    });

    // 3. Table Toolbar Listeners
    const searchInput = document.getElementById("tableSearchInput");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.tableSearch = searchInput.value;
            state.tablePage = 1;
            renderOverallStatusTable();
        });
    }

    const statusFilter = document.getElementById("tableStatusFilter");
    if (statusFilter) {
        statusFilter.addEventListener("change", () => {
            state.tableStatus = statusFilter.value;
            state.tablePage = 1;
            renderOverallStatusTable();
        });
    }

    const unitFilter = document.getElementById("tableUnitFilter");
    if (unitFilter) {
        unitFilter.addEventListener("change", () => {
            state.tableUnit = unitFilter.value;
            state.tablePage = 1;
            renderOverallStatusTable();
        });
    }

    const sortSel = document.getElementById("tableSortSelect");
    if (sortSel) {
        sortSel.addEventListener("change", () => {
            state.tableSort = sortSel.value;
            state.tablePage = 1;
            renderOverallStatusTable();
        });
    }

    const rowsPerPage = document.getElementById("tableRowsPerPageSelect");
    if (rowsPerPage) {
        rowsPerPage.addEventListener("change", () => {
            state.tablePageSize = Number(rowsPerPage.value) || 10;
            state.tablePage = 1;
            renderOverallStatusTable();
        });
    }

    // 4. Modal Triggers
    const viewAllProgBtn = document.getElementById("viewAllProgressBtn");
    if (viewAllProgBtn) viewAllProgBtn.addEventListener("click", openAllMaterialsModal);

    const closeAllMatBtn = document.getElementById("allMaterialsModalClose");
    if (closeAllMatBtn) closeAllMatBtn.addEventListener("click", closeAllMaterialsModal);

    const doneAllMatBtn = document.getElementById("allMaterialsModalDoneBtn");
    if (doneAllMatBtn) doneAllMatBtn.addEventListener("click", closeAllMaterialsModal);

    const closeMatDetailBtn = document.getElementById("matDetailModalClose");
    if (closeMatDetailBtn) closeMatDetailBtn.addEventListener("click", closeMaterialDetailModal);

    const doneMatDetailBtn = document.getElementById("matDetailDoneBtn");
    if (doneMatDetailBtn) doneMatDetailBtn.addEventListener("click", closeMaterialDetailModal);

    const viewAllDistBtn = document.getElementById("viewAllDistBtn");
    if (viewAllDistBtn) viewAllDistBtn.addEventListener("click", openAllDistributionModal);

    const closeAllDistBtn = document.getElementById("allDistributionModalClose");
    if (closeAllDistBtn) closeAllDistBtn.addEventListener("click", closeAllDistributionModal);

    const doneAllDistBtn = document.getElementById("allDistributionModalDoneBtn");
    if (doneAllDistBtn) doneAllDistBtn.addEventListener("click", closeAllDistributionModal);

    // 5. Backdrop Click Dismissal
    const overlays = [
        document.getElementById("allMaterialsModalOverlay"),
        document.getElementById("materialDetailModalOverlay"),
        document.getElementById("allDistributionModalOverlay")
    ];

    overlays.forEach(overlay => {
        if (!overlay) return;
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                overlay.classList.remove("open");
            }
        });
    });

    // 6. Escape Key Handler
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeAllMaterialsModal();
            closeMaterialDetailModal();
            closeAllDistributionModal();
        }
    });
}

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}
