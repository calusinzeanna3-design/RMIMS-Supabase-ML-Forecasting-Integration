// js/analytics.js
//
// RMIMS ADMIN — CONSUMPTION ANALYTICS
// Subject: Raw Material Stock & Consumption Analytics Dashboard.
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

    const intervals = generateTimelineIntervals("weekly", state.dateFrom, state.dateTo);
    const labels = intervals.map(i => i.label);

    const goodCounts = [];
    const stableCounts = [];
    const lowCounts = [];
    const outCounts = [];

    intervals.forEach(inv => {
        // Calculate status distribution for materials
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
                    label: "Good / Full",
                    data: goodCounts,
                    borderColor: "#16a34a",
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.2
                },
                {
                    label: "Stable",
                    data: stableCounts,
                    borderColor: "#2563eb",
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.2
                },
                {
                    label: "Low Stock",
                    data: lowCounts,
                    borderColor: "#ea580c",
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.2
                },
                {
                    label: "Out of Stock",
                    data: outCounts,
                    borderColor: "#dc2626",
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.2
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
                    padding: 10,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: "#64748b", font: { size: 11 } }
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0, color: "#64748b", font: { size: 11 } },
                    grid: { color: "#f1f5f9" }
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

function initEventListeners() {
    // 1. Date Controls
    const presetSel = document.getElementById("datePresetSelect");
    if (presetSel) {
        presetSel.addEventListener("change", () => {
            applyPreset(presetSel.value);
            renderAll();
        });
    }

    const fromInput = document.getElementById("dateFromInput");
    const toInput = document.getElementById("dateToInput");
    if (fromInput && toInput) {
        const handleCustomDate = () => {
            state.dateFrom = fromInput.value;
            state.dateTo = toInput.value;
            if (presetSel) presetSel.value = "custom";
            state.datePreset = "custom";
            updateDateStatusTag();
            renderAll();
        };
        fromInput.addEventListener("change", handleCustomDate);
        toInput.addEventListener("change", handleCustomDate);
    }

    const clearBtn = document.getElementById("clearDateBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            if (presetSel) presetSel.value = "this_week";
            applyPreset("this_week");
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
