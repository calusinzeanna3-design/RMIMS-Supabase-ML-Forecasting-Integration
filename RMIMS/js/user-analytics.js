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
    datePreset: "this_week",
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
        n === "unassigned / general stock"
    );
}

/* ==========================================================
   DATE HELPERS & PRESETS
   ========================================================== */

function initDatePresets() {
    applyPreset("this_week");
}

function applyPreset(preset) {
    state.datePreset = preset;
    const now = new Date();
    let from = new Date();
    let to = new Date();

    if (preset === "today") {
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

    if (preset !== "custom") {
        state.dateFrom = formatDateISO(from);
        state.dateTo = formatDateISO(to);

        const fromInput = document.getElementById("dateFromInput");
        const toInput = document.getElementById("dateToInput");
        if (fromInput) fromInput.value = state.dateFrom;
        if (toInput) toInput.value = state.dateTo;
    }

    updateDateStatusTag();
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

    // 2. Total Consumed (Unit-Safe Aggregation)
    const activeDisbs = state.disbursements.filter(d => isDateInRange(d.usageDate));
    const consumedByUnit = new Map();

    activeDisbs.forEach(d => {
        const u = d.unit || "kg";
        consumedByUnit.set(u, (consumedByUnit.get(u) || 0) + d.consumedQuantity);
    });

    const consumedListEl = document.getElementById("kpiTotalConsumedList");
    if (consumedListEl) {
        if (consumedByUnit.size === 0) {
            consumedListEl.innerHTML = `<span class="ca-kpi-value">0</span> <span style="font-size:0.8rem; color:var(--ca-text-dim);">units</span>`;
        } else {
            const entries = Array.from(consumedByUnit.entries()).sort((a, b) => b[1] - a[1]);
            consumedListEl.innerHTML = entries.map(([unit, qty]) => {
                return `
                    <div class="ca-kpi-unit-badge">
                        <span>${qty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                        <span style="font-size:0.75rem; color:var(--ca-text-muted);">${escapeHtml(unit)}</span>
                    </div>
                `;
            }).join("");
        }
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

    // Build timeline intervals based on period & active date range
    const intervals = generateTimelineIntervals(state.chart1Period, state.dateFrom, state.dateTo);
    const labels = intervals.map(i => i.label);

    const actualData = [];
    const minTargetData = [];

    intervals.forEach(inv => {
        // Compute consumption or stock in interval
        let intervalUsage = 0;
        let minThreshold = selectedMat ? selectedMat.minStock : 0;

        state.disbursements.forEach(d => {
            if (d.usageDate >= inv.start && d.usageDate <= inv.end) {
                if (isAll || d.materialId === state.chart1MaterialId) {
                    intervalUsage += d.consumedQuantity;
                }
            }
        });

        if (isAll) {
            // Aggregate minimum threshold across all catalog items
            minThreshold = state.materials.reduce((sum, m) => sum + m.minStock, 0);
        }

        actualData.push(Number(intervalUsage.toFixed(2)));
        minTargetData.push(Number(minThreshold.toFixed(2)));
    });

    overviewChartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    label: isAll ? "Total Usage" : `${selectedMat?.name} Usage`,
                    data: actualData,
                    borderColor: "#16a34a",
                    backgroundColor: "rgba(22, 163, 74, 0.08)",
                    borderWidth: 2.5,
                    pointBackgroundColor: "#16a34a",
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    fill: true,
                    tension: 0.3
                },
                {
                    label: isAll ? "Combined Minimum Target" : `${selectedMat?.name} Minimum Target`,
                    data: minTargetData,
                    borderColor: "#ea580c",
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    tension: 0
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
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const unit = selectedMat ? selectedMat.unit : "units";
                            return ` ${context.dataset.label}: ${context.parsed.y.toLocaleString()} ${unit}`;
                        }
                    }
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

function generateTimelineIntervals(period, fromStr, toStr) {
    const intervals = [];
    const dStart = fromStr ? new Date(fromStr) : new Date(Date.now() - 28 * 86400000);
    const dEnd = toStr ? new Date(toStr) : new Date();

    if (period === "monthly") {
        let curr = new Date(dStart.getFullYear(), dStart.getMonth(), 1);
        while (curr <= dEnd) {
            const startStr = formatDateISO(curr);
            const nextMonth = new Date(curr.getFullYear(), curr.getMonth() + 1, 0);
            const endStr = formatDateISO(nextMonth);
            intervals.push({
                label: curr.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
                start: startStr,
                end: endStr
            });
            curr.setMonth(curr.getMonth() + 1);
        }
    } else {
        // Weekly / Date-to-Date
        let curr = new Date(dStart);
        let stepDays = period === "weekly" ? 7 : Math.max(1, Math.round((dEnd - dStart) / (7 * 86400000)));

        while (curr <= dEnd) {
            const startStr = formatDateISO(curr);
            const stepEnd = new Date(curr.getTime() + (stepDays - 1) * 86400000);
            const endStr = formatDateISO(stepEnd > dEnd ? dEnd : stepEnd);
            intervals.push({
                label: curr.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                start: startStr,
                end: endStr
            });
            curr.setDate(curr.getDate() + stepDays);
        }
    }

    return intervals.length > 0 ? intervals : [{ label: "Current Period", start: fromStr, end: toStr }];
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

    for (let p = 1; p <= totalPages; p++) {
        html += `<button type="button" class="ca-page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
    }

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

function initEventListeners() {
    // 1. Date Range Preset Select
    const presetSelect = document.getElementById("datePresetSelect");
    const customWrap = document.getElementById("customDatePickerWrap");
    const dateFromInput = document.getElementById("dateFromInput");
    const dateToInput = document.getElementById("dateToInput");
    const clearDateBtn = document.getElementById("clearDateBtn");

    if (presetSelect) {
        presetSelect.addEventListener("change", () => {
            const val = presetSelect.value;
            if (val === "custom") {
                if (customWrap) customWrap.style.display = "flex";
            } else {
                if (customWrap) customWrap.style.display = "none";
                applyPreset(val);
                renderAll();
            }
        });
    }

    if (dateFromInput) {
        dateFromInput.addEventListener("change", () => {
            state.dateFrom = dateFromInput.value;
            updateDateStatusTag();
            renderAll();
        });
    }

    if (dateToInput) {
        dateToInput.addEventListener("change", () => {
            state.dateTo = dateToInput.value;
            updateDateStatusTag();
            renderAll();
        });
    }

    if (clearDateBtn) {
        clearDateBtn.addEventListener("click", () => {
            if (presetSelect) presetSelect.value = "this_week";
            if (customWrap) customWrap.style.display = "none";
            applyPreset("this_week");
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
