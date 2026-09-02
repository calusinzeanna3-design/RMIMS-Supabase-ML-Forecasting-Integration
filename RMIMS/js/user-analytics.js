// js/user-analytics.js
//
// RMIMS USER — CONSUMPTION ANALYTICS
// Full Design & Operational Inheritance from Admin Consumption Analytics.
// Authoritative, Read-Only, 100% Live Supabase Data.
// Strictly Light Mode. No Mock Data. Unit-Safe.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

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
    chart1Period: "weekly",  // 'weekly' | 'monthly' | 'date_to_date'
    
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

        const pBtn = document.getElementById("profileBtn");
        if (pBtn) {
            const pText = pBtn.querySelector(".profile-text") || pBtn;
            pText.textContent = profile.full_name || profile.email || "Staff Member";
            const pAv = pBtn.querySelector(".avatar");
            if (pAv && profile.full_name) {
                pAv.textContent = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
            }
        }

        init();
    } catch (e) {
        console.error("User Auth guard error:", e);
        window.location.href = "../user-signin.html";
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
        const [matRes, useRes, recRes] = await Promise.all([
            supabase
                .from("raw_materials")
                .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, description, created_at")
                .order("name"),
            supabase
                .from("material_disbursements")
                .select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at")
                .order("usage_date", { ascending: false }),
            supabase
                .from("stock_receipts")
                .select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at")
                .order("receipt_date", { ascending: false })
        ]);

        if (matRes.error) throw matRes.error;
        if (useRes.error) console.warn("Disbursements fetch notice:", useRes.error);
        if (recRes.error) console.warn("Receipts fetch notice:", recRes.error);

        const rawMats = matRes.data || [];
        const rawUsage = useRes.data || [];
        const rawRecs = recRes.data || [];

        // Normalize Materials
        state.materials = rawMats.map(m => {
            const curStock = Number(m.current_stock) || 0;
            const minStock = m.minimum_threshold !== null ? Number(m.minimum_threshold) : 0;
            const statusInfo = computeStockHealth(curStock, minStock);

            // Compute Target Baseline (safe without hardcoded max)
            const targetBaseline = Math.max(minStock * 2, curStock, 1);
            const progressPct = Math.min(100, Math.round((curStock / targetBaseline) * 100));

            return {
                id: m.id,
                itemCode: m.item_code || "RM—",
                name: m.name || "Unnamed Material",
                unit: (m.unit_of_measure || "kg").trim(),
                currentStock: curStock,
                minStock: minStock,
                status: statusInfo,
                progressPct: isNaN(progressPct) ? 0 : progressPct,
                createdAt: m.created_at || new Date().toISOString()
            };
        });

        const matMap = new Map(state.materials.map(m => [m.id, m]));

        // Normalize Disbursements
        state.disbursements = rawUsage.map(d => {
            const mat = matMap.get(d.material_id);
            const rawProd = (d.finished_product_name || d.activity_type || "").trim();
            return {
                id: d.id,
                materialId: d.material_id,
                materialName: mat ? mat.name : "Raw Material",
                itemCode: mat ? mat.itemCode : "RM—",
                consumedQuantity: Number(d.consumed_quantity) || 0,
                usageDate: d.usage_date || (d.created_at ? d.created_at.split("T")[0] : null),
                unit: (d.unit || (mat ? mat.unit : "kg")).trim(),
                productName: rawProd && !isGenericOperationalName(rawProd) ? rawProd : null,
                activityType: d.activity_type,
                createdAt: d.created_at
            };
        });

        // Normalize Receipts
        state.receipts = rawRecs.map(r => {
            const mat = matMap.get(r.material_id);
            return {
                id: r.id,
                materialId: r.material_id,
                materialName: mat ? mat.name : "Raw Material",
                receivedQuantity: Number(r.received_quantity) || 0,
                receiptDate: r.receipt_date || (r.created_at ? r.created_at.split("T")[0] : null),
                unit: (r.unit || (mat ? mat.unit : "kg")).trim(),
                supplierName: r.supplier_name,
                createdAt: r.created_at
            };
        });

        populateMaterialSelectors();
        populateUnitFilter();
        renderAll();
    } catch (err) {
        console.error("Error loading live analytics data:", err);
    }
}

/* ==========================================================
   STOCK HEALTH COMPUTATION
   ========================================================== */

function computeStockHealth(currentStock, minStock) {
    const cur = Number(currentStock) || 0;
    const min = Number(minStock) || 0;

    if (cur <= 0) {
        return { code: "OUT", label: "Out of Stock", cls: "ca-status-out" };
    }
    if (cur <= min) {
        return { code: "LOW", label: "Low Stock", cls: "ca-status-low" };
    }
    if (min > 0 && cur <= min * 1.5) {
        return { code: "STABLE", label: "Stable Stock", cls: "ca-status-stable" };
    }
    return { code: "GOOD", label: "Good Stock", cls: "ca-status-good" };
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

    const diffDays = Math.max(1, Math.round((dEnd - dStart) / 86400000));

    // Dynamic Interval Mapping
    if (period === "monthly") {
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
    } else if (diffDays <= 1) {
        // Single Day ("Today")
        const dateISO = formatDateISO(dStart);
        const dayLabel = dStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        intervals.push({
            label: `${dayLabel} (All Day)`,
            start: dateISO,
            end: dateISO
        });
    } else if (diffDays <= 7) {
        // Up to 7 days ("This Week", "Last 7 Days", etc.) -> Daily intervals
        let curr = new Date(dStart);
        while (curr <= dEnd) {
            const dateISO = formatDateISO(curr);
            intervals.push({
                label: curr.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
                start: dateISO,
                end: dateISO
            });
            curr.setDate(curr.getDate() + 1);
        }
    } else if (diffDays <= 31) {
        // Up to 1 month ("This Month", "Last Month", "Last 30 Days")
        if (period === "date_to_date") {
            let curr = new Date(dStart);
            const step = Math.max(1, Math.round(diffDays / 6));
            while (curr <= dEnd) {
                const startStr = formatDateISO(curr);
                const stepEnd = new Date(curr.getTime() + (step - 1) * 86400000);
                const endStr = formatDateISO(stepEnd > dEnd ? dEnd : stepEnd);
                intervals.push({
                    label: curr.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                    start: startStr,
                    end: endStr
                });
                curr.setDate(curr.getDate() + step);
            }
        } else {
            // Weekly intervals across the month
            let curr = new Date(dStart);
            while (curr <= dEnd) {
                const startStr = formatDateISO(curr);
                const stepEnd = new Date(curr.getTime() + 6 * 86400000);
                const endStr = formatDateISO(stepEnd > dEnd ? dEnd : stepEnd);
                const startLabel = curr.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                const endLabel = (stepEnd > dEnd ? dEnd : stepEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                intervals.push({
                    label: `${startLabel} – ${endLabel}`,
                    start: startStr,
                    end: endStr
                });
                curr.setDate(curr.getDate() + 7);
            }
        }
    } else {
        // Long ranges (> 31 days)
        if (period === "weekly") {
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
        } else {
            // Default to monthly intervals
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

    // Display top 5 active materials
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

    const intervals = generateTimelineIntervals("weekly", state.dateFrom, state.dateTo);
    const labels = intervals.map(i => i.label);

    const goodCounts = [];
    const stableCounts = [];
    const lowCounts = [];
    const outCounts = [];

    intervals.forEach(inv => {
        let g = 0, s = 0, l = 0, o = 0;
        state.materials.forEach(mat => {
            if (mat.status.code === "GOOD") g++;
            else if (mat.status.code === "STABLE") s++;
            else if (mat.status.code === "LOW") l++;
            else if (mat.status.code === "OUT") o++;
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
                    label: "Good Stock",
                    data: goodCounts,
                    borderColor: "#16a34a",
                    backgroundColor: "rgba(22, 163, 74, 0.12)",
                    borderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 3
                },
                {
                    label: "Stable Stock",
                    data: stableCounts,
                    borderColor: "#2563eb",
                    backgroundColor: "rgba(37, 99, 235, 0.1)",
                    borderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 3
                },
                {
                    label: "Low Stock",
                    data: lowCounts,
                    borderColor: "#ea580c",
                    backgroundColor: "rgba(234, 88, 12, 0.1)",
                    borderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 3
                },
                {
                    label: "Out of Stock",
                    data: outCounts,
                    borderColor: "#dc2626",
                    backgroundColor: "rgba(220, 38, 38, 0.1)",
                    borderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "#0f172a",
                    titleColor: "#f8fafc",
                    bodyColor: "#e2e8f0",
                    padding: 10,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: "#64748b", font: { size: 11, weight: 600 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: "#f1f5f9" },
                    ticks: { color: "#64748b", font: { size: 11 } }
                }
            }
        }
    });
}

/* ==========================================================
   5. RAW MATERIAL DISTRIBUTION (DONUT)
   ========================================================== */

function renderDistributionDonutCard() {
    const canvas = document.getElementById("distributionDonutCanvas");
    const donutTotalEl = document.getElementById("donutTotalCount");
    const listContainer = document.getElementById("distributionListContainer");
    if (!canvas) return;

    if (donutTotalEl) donutTotalEl.textContent = state.materials.length.toLocaleString();

    const ctx = canvas.getContext("2d");
    if (distributionDonutInstance) {
        distributionDonutInstance.destroy();
        distributionDonutInstance = null;
    }

    if (state.materials.length === 0) {
        if (listContainer) listContainer.innerHTML = `<div class="ca-empty-state"><p>No materials available.</p></div>`;
        return;
    }

    // Sort materials by current stock volume
    const sorted = [...state.materials].sort((a, b) => b.currentStock - a.currentStock);
    const totalVolume = sorted.reduce((sum, m) => sum + m.currentStock, 0) || 1;

    // Top 3-4 materials + "Others"
    const topLimit = 4;
    const topMats = sorted.slice(0, topLimit);
    const otherMats = sorted.slice(topLimit);

    const labels = topMats.map(m => m.name);
    const dataVals = topMats.map(m => m.currentStock);
    const colors = ["#2563eb", "#16a34a", "#ea580c", "#9333ea"];

    let otherVolume = 0;
    if (otherMats.length > 0) {
        otherVolume = otherMats.reduce((sum, m) => sum + m.currentStock, 0);
        labels.push("Others");
        dataVals.push(otherVolume);
        colors.push("#94a3b8");
    }

    distributionDonutInstance = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: labels,
            datasets: [
                {
                    data: dataVals,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: "#ffffff",
                    hoverOffset: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "74%",
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "#0f172a",
                    titleColor: "#f8fafc",
                    bodyColor: "#e2e8f0",
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed;
                            const pct = Math.round((val / totalVolume) * 100);
                            return ` ${context.label}: ${val.toLocaleString()} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    // Populate legend list
    if (listContainer) {
        listContainer.innerHTML = labels.map((lbl, idx) => {
            const val = dataVals[idx];
            const pct = Math.round((val / totalVolume) * 100);
            const dotColor = colors[idx];

            return `
                <div class="ca-dist-row">
                    <div class="ca-dist-row-left">
                        <span class="ca-dist-row-dot" style="background: ${dotColor};"></span>
                        <span class="ca-dist-row-name" title="${escapeHtml(lbl)}">${escapeHtml(lbl)}</span>
                    </div>
                    <div class="ca-dist-row-val">${pct}%</div>
                </div>
            `;
        }).join("");
    }
}

/* ==========================================================
   6. OVERALL RAW MATERIAL STATUS TABLE
   ========================================================== */

function renderOverallStatusTable() {
    const tbody = document.getElementById("overallStatusTableBody");
    const pageInfo = document.getElementById("tablePageInfo");
    const paginationControls = document.getElementById("tablePaginationControls");
    if (!tbody) return;

    // Filter & Search Logic
    const activeDisbs = state.disbursements.filter(d => isDateInRange(d.usageDate));

    // Map consumed quantity in selected period per material
    const consumedMap = new Map();
    activeDisbs.forEach(d => {
        consumedMap.set(d.materialId, (consumedMap.get(d.materialId) || 0) + d.consumedQuantity);
    });

    let filtered = state.materials.filter(mat => {
        // Search
        if (state.tableSearch) {
            const query = state.tableSearch.toLowerCase();
            const matchesName = mat.name.toLowerCase().includes(query);
            const matchesCode = mat.itemCode.toLowerCase().includes(query);
            
            // Check associated finished product context from disbursements
            const matchesProduct = state.disbursements.some(d => 
                d.materialId === mat.id && d.productName && d.productName.toLowerCase().includes(query)
            );

            if (!matchesName && !matchesCode && !matchesProduct) return false;
        }

        // Status filter
        if (state.tableStatus !== "ALL" && mat.status.code !== state.tableStatus) {
            return false;
        }

        // Unit filter
        if (state.tableUnit !== "ALL" && mat.unit !== state.tableUnit) {
            return false;
        }

        return true;
    });

    // Sorting
    filtered.sort((a, b) => {
        const aConsumed = consumedMap.get(a.id) || 0;
        const bConsumed = consumedMap.get(b.id) || 0;

        if (state.tableSort === "az") return a.name.localeCompare(b.name);
        if (state.tableSort === "za") return b.name.localeCompare(a.name);
        if (state.tableSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (state.tableSort === "high_consumed") return bConsumed - aConsumed;
        if (state.tableSort === "low_consumed") return aConsumed - bConsumed;
        if (state.tableSort === "high_stock") return b.currentStock - a.currentStock;
        if (state.tableSort === "low_stock") return a.currentStock - b.currentStock;
        // Default latest
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const total = filtered.length;

    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; padding: 36px 16px; color: var(--ca-text-dim);">
                    <strong>No raw materials found.</strong><br>
                    <span style="font-size: 0.8rem;">Try adjusting your search criteria or active filters.</span>
                </td>
            </tr>
        `;
        if (pageInfo) pageInfo.textContent = `Showing 0 to 0 of ${state.materials.length} materials`;
        if (paginationControls) paginationControls.innerHTML = "";
        return;
    }

    // Pagination
    const totalPages = Math.max(1, Math.ceil(total / state.tablePageSize));
    if (state.tablePage > totalPages) state.tablePage = totalPages;
    if (state.tablePage < 1) state.tablePage = 1;

    const start = (state.tablePage - 1) * state.tablePageSize;
    const end = Math.min(start + state.tablePageSize, total);
    const paged = filtered.slice(start, end);

    if (pageInfo) {
        pageInfo.textContent = `Showing ${start + 1} to ${end} of ${total} materials`;
    }

    tbody.innerHTML = paged.map(mat => {
        const periodConsumed = consumedMap.get(mat.id) || 0;
        let fillClass = "ca-progress-fill-green";
        if (mat.status.code === "STABLE") fillClass = "ca-progress-fill-blue";
        if (mat.status.code === "LOW") fillClass = "ca-progress-fill-orange";
        if (mat.status.code === "OUT") fillClass = "ca-progress-fill-red";

        return `
            <tr data-mat-id="${escapeHtml(mat.id)}">
                <td>
                    <div style="font-weight: 700; color: var(--ca-text-main);">${escapeHtml(mat.name)}</div>
                </td>
                <td><span class="ca-id-pill">${escapeHtml(mat.itemCode)}</span></td>
                <td><strong>${mat.currentStock.toLocaleString()}</strong></td>
                <td>${escapeHtml(mat.unit)}</td>
                <td>${mat.minStock.toLocaleString()}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px; width: 140px;">
                        <div class="ca-progress-track" style="flex:1;">
                            <div class="ca-progress-fill ${fillClass}" style="width: ${mat.progressPct}%;"></div>
                        </div>
                        <span style="font-size:0.75rem; font-weight:700; color:var(--ca-text-muted);">${mat.progressPct}%</span>
                    </div>
                </td>
                <td><strong style="color: var(--ca-orange);">${periodConsumed.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</strong></td>
                <td>
                    <span class="ca-status-badge ${mat.status.cls}">
                        <span class="ca-status-dot"></span>${mat.status.label}
                    </span>
                </td>
            </tr>
        `;
    }).join("");

    // Attach row click listeners for detail modal
    tbody.querySelectorAll("tr[data-mat-id]").forEach(row => {
        row.addEventListener("click", () => {
            const matId = row.getAttribute("data-mat-id");
            openMaterialDetailModal(matId);
        });
    });

    renderTablePagination(paginationControls, state.tablePage, totalPages, (newPage) => {
        state.tablePage = newPage;
        renderOverallStatusTable();
    });
}

function renderTablePagination(container, currentPage, totalPages, onPageChange) {
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    let html = `
        <button type="button" class="ca-page-btn" id="prevPageBtn" ${currentPage <= 1 ? "disabled" : ""}>‹</button>
    `;

    // Windowed Pagination Algorithm
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
            html += `<button type="button" class="ca-page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
        }
    });

    html += `
        <button type="button" class="ca-page-btn" id="nextPageBtn" ${currentPage >= totalPages ? "disabled" : ""}>›</button>
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

    container.querySelectorAll(".ca-page-btn[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
            const p = Number(btn.dataset.page);
            if (p && p !== currentPage) onPageChange(p);
        });
    });
}

/* ==========================================================
   MODALS
   ========================================================== */

function openMaterialDetailModal(matId) {
    const mat = state.materials.find(m => m.id === matId);
    if (!mat) return;

    const overlay = document.getElementById("materialDetailModalOverlay");
    if (!overlay) return;

    document.getElementById("matDetailTitle").textContent = mat.name;
    document.getElementById("matDetailSubtitle").textContent = `Item Code: ${mat.itemCode}`;
    document.getElementById("matDetailProgressVal").textContent = `${mat.progressPct}%`;
    document.getElementById("matDetailCurrentStockVal").textContent = `${mat.currentStock.toLocaleString()} ${mat.unit}`;
    document.getElementById("matDetailMinStockVal").textContent = `${mat.minStock.toLocaleString()} ${mat.unit}`;
    document.getElementById("matDetailStatusVal").textContent = mat.status.label;

    // Period usage calculations
    const now = new Date();
    
    // 1. Selected period usage
    let periodUsage = 0;
    state.disbursements.forEach(d => {
        if (d.materialId === mat.id && isDateInRange(d.usageDate)) {
            periodUsage += d.consumedQuantity;
        }
    });

    // 2. This week usage
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = formatDateISO(new Date(now.setDate(diff)));
    const todayStr = formatDateISO(new Date());

    let weekUsage = 0;
    state.disbursements.forEach(d => {
        if (d.materialId === mat.id && d.usageDate >= weekStart && d.usageDate <= todayStr) {
            weekUsage += d.consumedQuantity;
        }
    });

    // 3. This month usage
    const monthStart = formatDateISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    let monthUsage = 0;
    state.disbursements.forEach(d => {
        if (d.materialId === mat.id && d.usageDate >= monthStart && d.usageDate <= todayStr) {
            monthUsage += d.consumedQuantity;
        }
    });

    document.getElementById("matDetailPeriodUsageVal").textContent = `${periodUsage.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${mat.unit}`;
    document.getElementById("matDetailWeekUsageVal").textContent = `${weekUsage.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${mat.unit}`;
    document.getElementById("matDetailMonthUsageVal").textContent = `${monthUsage.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${mat.unit}`;

    // Finished Product usage breakdown
    const productUsageMap = new Map();
    state.disbursements.forEach(d => {
        if (d.materialId === mat.id && d.productName) {
            productUsageMap.set(d.productName, (productUsageMap.get(d.productName) || 0) + d.consumedQuantity);
        }
    });

    const tbody = document.getElementById("matDetailProductsTableBody");
    if (tbody) {
        const entries = Array.from(productUsageMap.entries()).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align:center; padding: 20px; color: var(--ca-text-dim);">
                        No finished product context recorded for this material.
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = entries.map(([pName, qty]) => {
                return `
                    <tr>
                        <td><strong>${escapeHtml(pName)}</strong></td>
                        <td><strong style="color: var(--ca-orange);">${qty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</strong></td>
                        <td>${escapeHtml(mat.unit)}</td>
                    </tr>
                `;
            }).join("");
        }
    }

    overlay.classList.add("active");
}

function openAllMaterialsModal() {
    const overlay = document.getElementById("allMaterialsModalOverlay");
    const tbody = document.getElementById("allMaterialsModalTableBody");
    if (!overlay || !tbody) return;

    tbody.innerHTML = state.materials.map(mat => {
        let fillClass = "ca-progress-fill-green";
        if (mat.status.code === "STABLE") fillClass = "ca-progress-fill-blue";
        if (mat.status.code === "LOW") fillClass = "ca-progress-fill-orange";
        if (mat.status.code === "OUT") fillClass = "ca-progress-fill-red";

        return `
            <tr>
                <td><strong>${escapeHtml(mat.name)}</strong></td>
                <td><span class="ca-id-pill">${escapeHtml(mat.itemCode)}</span></td>
                <td><strong>${mat.currentStock.toLocaleString()}</strong></td>
                <td>${escapeHtml(mat.unit)}</td>
                <td>${mat.minStock.toLocaleString()}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px; width: 120px;">
                        <div class="ca-progress-track" style="flex:1;">
                            <div class="ca-progress-fill ${fillClass}" style="width: ${mat.progressPct}%;"></div>
                        </div>
                        <span style="font-size:0.75rem; font-weight:700;">${mat.progressPct}%</span>
                    </div>
                </td>
                <td>
                    <span class="ca-status-badge ${mat.status.cls}">
                        <span class="ca-status-dot"></span>${mat.status.label}
                    </span>
                </td>
            </tr>
        `;
    }).join("");

    overlay.classList.add("active");
}

function openAllDistributionModal() {
    const overlay = document.getElementById("allDistributionModalOverlay");
    const tbody = document.getElementById("allDistributionModalTableBody");
    if (!overlay || !tbody) return;

    const sorted = [...state.materials].sort((a, b) => b.currentStock - a.currentStock);
    const totalVolume = sorted.reduce((sum, m) => sum + m.currentStock, 0) || 1;

    tbody.innerHTML = sorted.map(mat => {
        const pct = Math.round((mat.currentStock / totalVolume) * 100);
        return `
            <tr>
                <td><strong>${escapeHtml(mat.name)}</strong></td>
                <td><span class="ca-id-pill">${escapeHtml(mat.itemCode)}</span></td>
                <td><strong>${mat.currentStock.toLocaleString()} ${escapeHtml(mat.unit)}</strong></td>
                <td><span style="font-weight: 700; color: var(--ca-blue);">${pct}%</span></td>
            </tr>
        `;
    }).join("");

    overlay.classList.add("active");
}

/* ==========================================================
   DROPDOWN POPULATION & EVENT LISTENERS
   ========================================================== */

function populateMaterialSelectors() {
    const select = document.getElementById("chart1MaterialSelect");
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = `<option value="ALL">All Materials</option>` + state.materials.map(m => {
        return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} (${escapeHtml(m.itemCode)})</option>`;
    }).join("");

    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
        select.value = currentVal;
    }
}

function populateUnitFilter() {
    const select = document.getElementById("tableUnitFilter");
    if (!select) return;

    const units = Array.from(new Set(state.materials.map(m => m.unit).filter(Boolean))).sort();
    select.innerHTML = `<option value="ALL">All Units</option>` + units.map(u => {
        return `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`;
    }).join("");
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

    // 2. Date Range Preset Select
    const presetSelect = document.getElementById("datePresetSelect");
    const clearDateBtn = document.getElementById("clearDateBtn");

    if (presetSelect) {
        presetSelect.addEventListener("change", () => {
            const val = presetSelect.value;
            applyPreset(val);
            renderAll();
        });
    }

    if (clearDateBtn) {
        clearDateBtn.addEventListener("click", () => {
            if (presetSelect) presetSelect.value = "all";
            applyPreset("all");
            renderAll();
        });
    }

    // 2. Chart 1 Material & Period Tabs
    const chart1MatSelect = document.getElementById("chart1MaterialSelect");
    if (chart1MatSelect) {
        chart1MatSelect.addEventListener("change", () => {
            state.chart1MaterialId = chart1MatSelect.value;
            renderOverviewTrendChart();
        });
    }

    const chart1Tabs = document.querySelectorAll("#chart1PeriodTabs .ca-period-tab");
    chart1Tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            chart1Tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.chart1Period = tab.getAttribute("data-period");
            renderOverviewTrendChart();
        });
    });

    // 3. Overall Table Controls
    const searchInput = document.getElementById("tableSearchInput");
    const statusFilter = document.getElementById("tableStatusFilter");
    const unitFilter = document.getElementById("tableUnitFilter");
    const sortSelect = document.getElementById("tableSortSelect");
    const rowsSelect = document.getElementById("tableRowsPerPageSelect");

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.tableSearch = searchInput.value.trim();
            state.tablePage = 1;
            renderOverallStatusTable();
        });
    }

    if (statusFilter) {
        statusFilter.addEventListener("change", () => {
            state.tableStatus = statusFilter.value;
            state.tablePage = 1;
            renderOverallStatusTable();
        });
    }

    if (unitFilter) {
        unitFilter.addEventListener("change", () => {
            state.tableUnit = unitFilter.value;
            state.tablePage = 1;
            renderOverallStatusTable();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            state.tableSort = sortSelect.value;
            state.tablePage = 1;
            renderOverallStatusTable();
        });
    }

    if (rowsSelect) {
        rowsSelect.addEventListener("change", () => {
            state.tablePageSize = Number(rowsSelect.value) || 10;
            state.tablePage = 1;
            renderOverallStatusTable();
        });
    }

    // 4. Modal Links & Triggers
    const viewAllProgressBtn = document.getElementById("viewAllProgressBtn");
    if (viewAllProgressBtn) viewAllProgressBtn.addEventListener("click", openAllMaterialsModal);

    const viewAllDistBtn = document.getElementById("viewAllDistBtn");
    if (viewAllDistBtn) viewAllDistBtn.addEventListener("click", openAllDistributionModal);

    // Modal Close Triggers
    const allMatClose = document.getElementById("allMaterialsModalClose");
    const allMatDone = document.getElementById("allMaterialsModalDoneBtn");
    if (allMatClose) allMatClose.addEventListener("click", () => document.getElementById("allMaterialsModalOverlay")?.classList.remove("active"));
    if (allMatDone) allMatDone.addEventListener("click", () => document.getElementById("allMaterialsModalOverlay")?.classList.remove("active"));

    const matDetailClose = document.getElementById("matDetailModalClose");
    const matDetailDone = document.getElementById("matDetailDoneBtn");
    if (matDetailClose) matDetailClose.addEventListener("click", () => document.getElementById("materialDetailModalOverlay")?.classList.remove("active"));
    if (matDetailDone) matDetailDone.addEventListener("click", () => document.getElementById("materialDetailModalOverlay")?.classList.remove("active"));

    const allDistClose = document.getElementById("allDistributionModalClose");
    const allDistDone = document.getElementById("allDistributionModalDoneBtn");
    if (allDistClose) allDistClose.addEventListener("click", () => document.getElementById("allDistributionModalOverlay")?.classList.remove("active"));
    if (allDistDone) allDistDone.addEventListener("click", () => document.getElementById("allDistributionModalOverlay")?.classList.remove("active"));

    // Close on overlay backdrop click or Escape
    document.querySelectorAll(".ca-modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) overlay.classList.remove("active");
        });
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            document.querySelectorAll(".ca-modal-overlay.active").forEach(ov => ov.classList.remove("active"));
        }
    });
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
