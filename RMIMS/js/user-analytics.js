// js/user-analytics.js
// User — Consumption Analytics.
// Subject: RAW MATERIAL CONSUMPTION, calculated from actual usage_records.
// 100% matched structure, components, and logic with Admin Analytics.

import { auth, db } from "../supabase/supabase-config.js";
import { collection, getDocs } from "../supabase/db-compat.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

/* ==========================================================
   ROLE GUARD
   ========================================================== */

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "../login.html"; return; }

    const snap = await getDocs(collection(db, "users"));
    const profile = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(u => u.id === user.uid);
    if (!profile || profile.status !== "active") { window.location.href = "../login.html"; return; }
    if (profile.role !== "user") { window.location.href = "../admin/dashboard.html"; return; }

    const pBtn = document.getElementById("profileBtn");
    if (pBtn) {
        const pText = pBtn.querySelector(".profile-text") || pBtn;
        pText.textContent = profile.fullName || "Staff Member";
        const pAv = pBtn.querySelector(".avatar");
        if (pAv && profile.fullName) {
            pAv.textContent = profile.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
        }
    }

    init();
});

/* ==========================================================
   STATE
   ========================================================== */

let materials = [];       // all raw materials
let usageRecords = [];    // ALL usage_records
let trendGranularity = "Weekly";
let sortKey = "name-asc";
let currentPage = 1;
const PAGE_SIZE = 10;

let barChart = null;
let lineChart = null;

/* ==========================================================
   DOM
   ========================================================== */

const $ = (id) => document.getElementById(id);

const searchInput = $("searchInput");
const dateRangeSelect = $("dateRangeSelect");
const customDateWrap = $("customDateWrap");
const startDateInput = $("startDateInput");
const endDateInput = $("endDateInput");
const categorySelect = $("categorySelect");
const unitSelect = $("unitSelect");
const statusSelect = $("statusSelect");
const resetFiltersBtn = $("resetFiltersBtn");
const sortSelect = $("sortSelect");

/* ==========================================================
   INFO ICON CONTENT
   ========================================================== */

const INFO_TEXT = {
    totalUsed: {
        title: "Total Used",
        body: "Shows the total recorded quantity used during the selected period. Different units are kept separate — quantities are never added together across units."
    },
    mostUsed: {
        title: "Most Used Raw Material",
        body: "Identifies the raw material with the highest recorded usage during the selected period."
    },
    materialsWithUsage: {
        title: "Materials With Usage",
        body: "Shows how many raw materials have recorded consumption during the selected period."
    },
    recentUsage: {
        title: "Recent Usage",
        body: "Shows the number of recent consumption activities recorded in the selected period."
    },
    rmConsumption: {
        title: "Raw Material Consumption",
        body: "Shows and compares the quantity of each raw material recorded as Used/Consumed during the selected period. Only actual consumption records are included — received quantities are not included."
    },
    consumptionTrend: {
        title: "Consumption Trend",
        body: "Shows how recorded raw-material consumption changes over the selected period. Trend comparisons use available historical consumption data — if there is not enough historical data, no trend is invented."
    },
    stockCompare: {
        title: "Consumption & Current Stock",
        body: "Compares recent raw-material usage with current available stock to help identify materials that may require attention. High consumption does not automatically mean low stock — status reflects actual inventory status."
    },
    rmUsageTable: {
        title: "Raw Material Usage",
        body: "Provides detailed consumption information for each raw material, including usage, previous-period comparison, trend, and current stock status."
    },
    recentConsumption: {
        title: "Recent Consumption",
        body: "Shows recent Used/Consumed activity recorded through Material Activity. Finished Product is shown only as activity context when available."
    }
};

/* ==========================================================
   HELPERS
   ========================================================== */

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}

function statusPill(material) {
    if (!material) return `<span class="status stock-good">—</span>`;
    if (material.status === "Critical") return `<span class="status stock-critical">Needs Restocking</span>`;
    if (material.status === "Low") return `<span class="status stock-low">Running Low</span>`;
    return `<span class="status stock-good">Good</span>`;
}

function trendBadge(trend) {
    if (trend.arrow === "up") return `<span class="trend-badge trend-up">↑ ${trend.change !== null ? Math.abs(Math.round(trend.change)) + "%" : "New"}</span>`;
    if (trend.arrow === "down") return `<span class="trend-badge trend-down">↓ ${trend.change !== null ? Math.abs(Math.round(trend.change)) + "%" : ""}</span>`;
    if (trend.arrow === "flat") return `<span class="trend-badge trend-flat">→ Stable</span>`;
    return `<span class="trend-badge trend-flat">—</span>`;
}

/* -------- Date range handling -------- */

function startOfWeek(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = (day === 0 ? -6 : 1) - day; // Monday as start of week
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function getCurrentRange() {
    const now = new Date();

    if (startDateInput && endDateInput && startDateInput.value && endDateInput.value) {
        const start = new Date(startDateInput.value + "T00:00:00");
        const end = new Date(endDateInput.value + "T23:59:59");
        return { start, end };
    }

    const key = dateRangeSelect ? dateRangeSelect.value : "week";

    if (key === "today") {
        const start = new Date(now); start.setHours(0, 0, 0, 0);
        return { start, end: now };
    }
    if (key === "month") {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start, end: now };
    }
    if (key === "last7") {
        const start = new Date(now); start.setDate(start.getDate() - 7);
        return { start, end: now };
    }
    if (key === "last30") {
        const start = new Date(now); start.setDate(start.getDate() - 30);
        return { start, end: now };
    }
    return { start: startOfWeek(now), end: now };
}

function getPreviousRange(current) {
    const durationMs = current.end.getTime() - current.start.getTime();
    const prevEnd = new Date(current.start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);
    return { start: prevStart, end: prevEnd };
}

function inRange(dateStr, range) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= range.start && d <= range.end;
}

function hasHistoryBefore(materialId, beforeDate) {
    return usageRecords.some(r => r.materialId === materialId && new Date(r.usageDate) < beforeDate);
}

/* ==========================================================
   DATA LOAD
   ========================================================== */

async function loadAll() {
    const [matSnap, usageSnap] = await Promise.all([
        getDocs(collection(db, "materials")),
        getDocs(collection(db, "usageRecords"))
    ]);
    materials = matSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    usageRecords = usageSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.usageDate);

    populateFilterOptions();
    renderAll();
}

function populateFilterOptions() {
    if (!categorySelect || !unitSelect) return;
    const categories = [...new Set(materials.map(m => m.category).filter(Boolean))].sort();
    const currentCat = categorySelect.value;
    categorySelect.innerHTML = `<option value="">All Categories</option>` +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (categories.includes(currentCat)) categorySelect.value = currentCat;

    const units = [...new Set(materials.map(m => m.unit).filter(Boolean))].sort();
    const currentUnit = unitSelect.value;
    unitSelect.innerHTML = `<option value="">All Units</option>` +
        units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
    if (units.includes(currentUnit)) unitSelect.value = currentUnit;
}

/* ==========================================================
   CORE CALCULATION
   ========================================================== */

function computeMaterialStats() {
    const range = getCurrentRange();
    const prevRange = getPreviousRange(range);

    const search = searchInput ? searchInput.value.trim().toLowerCase() : "";
    const category = categorySelect ? categorySelect.value : "";
    const unit = unitSelect ? unitSelect.value : "";
    const status = statusSelect ? statusSelect.value : "";

    const filteredMaterials = materials.filter(m =>
        (!search || m.materialName.toLowerCase().includes(search)) &&
        (!category || m.category === category) &&
        (!unit || m.unit === unit) &&
        (!status || m.status === status)
    );

    const stats = filteredMaterials.map(mat => {
        const currentRecords = usageRecords.filter(r => r.materialId === mat.id && inRange(r.usageDate, range));
        const previousRecords = usageRecords.filter(r => r.materialId === mat.id && inRange(r.usageDate, prevRange));

        const currentTotal = currentRecords.reduce((s, r) => s + Number(r.usedQuantity || 0), 0);
        const previousTotal = previousRecords.reduce((s, r) => s + Number(r.usedQuantity || 0), 0);

        let trend;
        if (!hasHistoryBefore(mat.id, range.start)) {
            trend = { arrow: "none", change: null, label: "Not enough data" };
        } else if (previousTotal === 0 && currentTotal > 0) {
            trend = { arrow: "up", change: null, label: "New usage vs previous period" };
        } else if (previousTotal === 0 && currentTotal === 0) {
            trend = { arrow: "flat", change: 0, label: "No recorded usage" };
        } else {
            const change = ((currentTotal - previousTotal) / previousTotal) * 100;
            trend = { arrow: change > 5 ? "up" : change < -5 ? "down" : "flat", change, label: null };
        }

        return { material: mat, currentTotal, previousTotal, trend, recordCount: currentRecords.length };
    });

    return { stats, range, prevRange };
}

/* ==========================================================
   RENDER: SUMMARY CARDS
   ========================================================== */

function renderSummary(stats, range) {
    const withUsage = stats.filter(s => s.currentTotal > 0);

    const byUnit = new Map();
    withUsage.forEach(s => {
        const u = s.material.unit || "";
        byUnit.set(u, (byUnit.get(u) || 0) + s.currentTotal);
    });
    const totalUsedEl = $("totalUsedValue");
    if (totalUsedEl) {
        if (byUnit.size === 0) {
            totalUsedEl.innerHTML = `<span class="unit-total-row" style="font-size:.95rem;color:var(--text-faint);font-weight:600;">No usage recorded</span>`;
        } else {
            totalUsedEl.innerHTML = [...byUnit.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([u, total]) => `<div class="unit-total-row">${formatNum(total)}<span>${escapeHtml(u)}</span></div>`)
                .join("");
        }
    }

    if ($("mostUsedMaterial")) {
        if (withUsage.length === 0) {
            $("mostUsedMaterial").textContent = "-";
            if ($("mostUsedSubtext")) $("mostUsedSubtext").textContent = "";
        } else {
            const top = [...withUsage].sort((a, b) => b.currentTotal - a.currentTotal)[0];
            $("mostUsedMaterial").textContent = top.material.materialName;
            if ($("mostUsedSubtext")) $("mostUsedSubtext").textContent = `${formatNum(top.currentTotal)} ${top.material.unit || ""} used`;
        }
    }

    if ($("materialsWithUsage")) $("materialsWithUsage").textContent = withUsage.length;
    const recentCount = withUsage.reduce((s, x) => s + x.recordCount, 0);
    if ($("recentUsageCount")) $("recentUsageCount").textContent = recentCount;
}

function formatNum(n) {
    const num = Number(n);
    return Number.isInteger(num) ? num.toString() : num.toFixed(2).replace(/\.00$/, "");
}

/* ==========================================================
   RENDER: BAR CHART (Raw Material Consumption)
   ========================================================== */

function renderBarChart(stats) {
    const withUsage = [...stats.filter(s => s.currentTotal > 0)].sort((a, b) => b.currentTotal - a.currentTotal);
    const ctx = document.getElementById("distributionChart");
    const othersHint = $("othersHintBar");
    if (!ctx) return;

    if (withUsage.length === 0) {
        if (barChart) { barChart.destroy(); barChart = null; }
        if (othersHint) othersHint.hidden = true;
        return;
    }

    const TOP_N = 6;
    const top = withUsage.slice(0, TOP_N);
    const rest = withUsage.slice(TOP_N);

    const labels = top.map(s => s.material.materialName);
    const data = top.map(s => s.currentTotal);

    if (rest.length > 0) {
        labels.push("Others");
        data.push(rest.reduce((s, x) => s + x.currentTotal, 0));
        if (othersHint) othersHint.hidden = false;
    } else {
        if (othersHint) othersHint.hidden = true;
    }

    if (barChart) barChart.destroy();
    barChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: ["#2563eb", "#22c08a", "#f5a524", "#a87cf2", "#3b82f6", "#10b981", "#64748b"]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, grid: { color: "rgba(148,180,224,.14)" } }, x: { grid: { display: false } } }
        }
    });
}

/* ==========================================================
   RENDER: LINE CHART (Consumption Trend - Weekly / Monthly)
   ========================================================== */

function renderLineChart(stats) {
    const { range } = computeMaterialStats();
    const ctx = document.getElementById("consumptionChart");
    if (!ctx) return;
    const withUsage = stats.filter(s => s.currentTotal > 0);

    if (withUsage.length === 0) {
        if (lineChart) { lineChart.destroy(); lineChart = null; }
        return;
    }

    const materialIds = new Set(withUsage.map(s => s.material.id));
    const relevantRecords = usageRecords.filter(r => materialIds.has(r.materialId) && inRange(r.usageDate, range));

    const buckets = new Map();
    relevantRecords.forEach(r => {
        const label = bucketLabel(new Date(r.usageDate), trendGranularity);
        buckets.set(label, (buckets.get(label) || 0) + Number(r.usedQuantity || 0));
    });

    const sortedLabels = [...buckets.keys()].sort();
    const data = sortedLabels.map(l => buckets.get(l));

    if (lineChart) lineChart.destroy();
    lineChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: sortedLabels.map(l => formatBucketLabel(l, trendGranularity)),
            datasets: [{
                data,
                borderColor: "#2563eb",
                backgroundColor: "rgba(37,99,235,.12)",
                fill: true,
                tension: 0.35,
                pointRadius: 4,
                pointBackgroundColor: "#2563eb"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, grid: { color: "rgba(148,180,224,.14)" } }, x: { grid: { display: false } } }
        }
    });
}

function bucketLabel(date, granularity) {
    if (granularity === "Monthly") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const start = startOfWeek(date);
    return start.toISOString().slice(0, 10);
}

function formatBucketLabel(label, granularity) {
    if (granularity === "Monthly") {
        const [y, m] = label.split("-");
        return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }
    const weekStart = new Date(label);
    return `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/* ==========================================================
   RENDER: TABLES & INSIGHTS
   ========================================================== */

function renderStockCompareTable(stats) {
    const tbody = $("stockCompareTableBody");
    if (!tbody) return;
    const rows = stats.filter(s => s.currentTotal > 0).sort((a, b) => b.currentTotal - a.currentTotal);

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No consumption data found for the selected filters.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(s => `
        <tr>
            <td><strong>${escapeHtml(s.material.materialName)}</strong></td>
            <td>${formatNum(s.currentTotal)} ${escapeHtml(s.material.unit || "")}</td>
            <td>${formatNum(s.material.quantity)} ${escapeHtml(s.material.unit || "")}</td>
            <td>${trendBadge(s.trend)}</td>
            <td>${statusPill(s.material)}</td>
        </tr>`).join("");
}

function renderUsageTable(stats) {
    let rows = [...stats];
    if (!sortSelect) return;

    switch (sortKey) {
        case "name-asc": rows.sort((a, b) => a.material.materialName.localeCompare(b.material.materialName)); break;
        case "name-desc": rows.sort((a, b) => b.material.materialName.localeCompare(a.material.materialName)); break;
        case "used-desc": rows.sort((a, b) => b.currentTotal - a.currentTotal); break;
        case "used-asc": rows.sort((a, b) => a.currentTotal - b.currentTotal); break;
        case "change-desc": rows.sort((a, b) => (b.trend.change ?? -Infinity) - (a.trend.change ?? -Infinity)); break;
        case "change-asc": rows.sort((a, b) => (a.trend.change ?? Infinity) - (b.trend.change ?? Infinity)); break;
        case "status": {
            const order = { Critical: 0, Low: 1, Available: 2 };
            rows.sort((a, b) => (order[a.material.status] ?? 3) - (order[b.material.status] ?? 3));
            break;
        }
    }

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const tbody = $("analyticsTableBody");
    if (!tbody) return;
    if (pageRows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>No consumption data found for the selected filters.</p></div></td></tr>`;
    } else {
        tbody.innerHTML = pageRows.map(s => `
            <tr>
                <td><strong>${escapeHtml(s.material.materialName)}</strong></td>
                <td>${escapeHtml(s.material.category || "—")}</td>
                <td>${escapeHtml(s.material.unit || "—")}</td>
                <td>${s.currentTotal > 0 ? formatNum(s.currentTotal) : "—"}</td>
                <td>${s.previousTotal > 0 ? formatNum(s.previousTotal) : "—"}</td>
                <td>${s.trend.change !== null ? `${s.trend.change >= 0 ? "+" : ""}${Math.round(s.trend.change)}%` : "—"}</td>
                <td>${trendBadge(s.trend)}</td>
                <td>${statusPill(s.material)}</td>
            </tr>`).join("");
    }

    if ($("pageInfo")) {
        $("pageInfo").textContent = total === 0
            ? "Showing 0 to 0 of 0 materials"
            : `Showing ${(currentPage - 1) * PAGE_SIZE + 1} to ${Math.min(currentPage * PAGE_SIZE, total)} of ${total} materials`;
    }

    const controls = $("paginationControls");
    if (controls) {
        controls.innerHTML = "";
        for (let p = 1; p <= totalPages; p++) {
            const btn = document.createElement("button");
            btn.textContent = p;
            btn.className = "page-btn" + (p === currentPage ? " active" : "");
            btn.addEventListener("click", () => { currentPage = p; renderAll(); });
            controls.appendChild(btn);
        }
    }
}

function renderRecentConsumption() {
    const recent = [...usageRecords]
        .sort((a, b) => new Date(b.usageDate) - new Date(a.usageDate))
        .slice(0, 8);

    const tbody = $("recentActivityList");
    if (!tbody) return;
    if (recent.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><p>No consumption data yet. Consumption analytics will appear here once material activity is recorded.</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = recent.map(r => `
        <tr>
            <td>${new Date(r.usageDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
            <td>${escapeHtml(r.materialName)}</td>
            <td>${formatNum(r.usedQuantity)} ${escapeHtml(r.unit || "")}</td>
            <td>${escapeHtml(r.productName || "—")}</td>
        </tr>`).join("");
}

function renderModalHistory() {
    const all = [...usageRecords].sort((a, b) => new Date(b.usageDate) - new Date(a.usageDate));
    const list = $("modalHistoryList");
    if (!list) return;
    if (all.length === 0) { list.innerHTML = `<p style="padding:20px;text-align:center;color:var(--text-faint);">No consumption records yet.</p>`; return; }
    list.innerHTML = all.map(r => `
        <div class="activity-item">
            <span>${new Date(r.usageDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} — <strong>${escapeHtml(r.materialName)}</strong> ${escapeHtml(r.productName ? `(${r.productName})` : "")}</span>
            <span>${formatNum(r.usedQuantity)} ${escapeHtml(r.unit || "")}</span>
        </div>`).join("");
}

function renderInsights(stats) {
    const withUsage = stats.filter(s => s.currentTotal > 0);
    const list = $("insightsList");
    if (!list) return;

    if (withUsage.length === 0) {
        list.innerHTML = `<li>No consumption data yet. Insights will appear here once material activity is recorded.</li>`;
        return;
    }

    const candidates = [];
    withUsage.filter(s => (s.material.status === "Low" || s.material.status === "Critical") && s.trend.arrow === "up")
        .forEach(s => candidates.push({
            priority: 1, icon: "⚠", title: "Stock Attention",
            text: `${s.material.materialName} has increased usage while its current stock is ${s.material.status === "Critical" ? "critically low" : "low"}.`,
            magnitude: s.trend.change ?? 999
        }));

    withUsage.filter(s => s.trend.change !== null && s.trend.change > 25)
        .forEach(s => candidates.push({
            priority: 2, icon: "↑", title: "Usage Change",
            text: `${s.material.materialName} usage increased by ${Math.round(s.trend.change)}% compared with the previous period.`,
            magnitude: s.trend.change
        }));

    const top = [...withUsage].sort((a, b) => b.currentTotal - a.currentTotal)[0];
    if (top) candidates.push({
        priority: 4, icon: "💡", title: "Highest Usage",
        text: `${top.material.materialName} has the highest recorded consumption during the selected period.`,
        magnitude: top.currentTotal
    });

    if (candidates.length === 0) {
        candidates.push({ priority: 6, icon: "💡", title: "Observation", text: "Not enough previous data to determine a trend.", magnitude: 0 });
    }

    candidates.sort((a, b) => a.priority - b.priority || b.magnitude - a.magnitude);
    list.innerHTML = candidates.slice(0, 4).map(c => `
        <li><strong>${c.icon} ${escapeHtml(c.title)}</strong><br>${escapeHtml(c.text)}</li>`).join("");
}

/* ==========================================================
   INFO POPOVERS
   ========================================================== */

let infoHideTimer = null;

function getOrCreatePopover() {
    let popover = document.getElementById("infoPopover");
    if (!popover) {
        popover = document.createElement("div");
        popover.id = "infoPopover";
        popover.className = "info-popover";
        popover.hidden = true;
        popover.innerHTML = `<strong id="infoPopoverTitle"></strong><p id="infoPopoverBody"></p>`;
        document.body.appendChild(popover);
        popover.addEventListener("mouseenter", () => clearTimeout(infoHideTimer));
        popover.addEventListener("mouseleave", scheduleHideInfoPopover);
    }
    return popover;
}

function showInfoPopover(btn) {
    clearTimeout(infoHideTimer);
    const key = btn.dataset.info || btn.dataset.infoKey;
    const info = INFO_TEXT[key];
    if (!info) return;

    const popover = getOrCreatePopover();
    const titleEl = document.getElementById("infoPopoverTitle");
    const bodyEl = document.getElementById("infoPopoverBody");
    if (titleEl) titleEl.textContent = `ⓘ ${info.title}`;
    if (bodyEl) bodyEl.textContent = info.body;

    popover.hidden = false;
    void popover.offsetWidth;

    const rect = btn.getBoundingClientRect();
    let left = rect.left;
    if (left + 280 > window.innerWidth) left = Math.max(12, window.innerWidth - 296);
    let top = rect.bottom + 8;
    if (top + 120 > window.innerHeight) top = Math.max(12, rect.top - 120);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;

    popover.classList.add("visible");
}

function scheduleHideInfoPopover() {
    const popover = document.getElementById("infoPopover");
    if (!popover) return;
    clearTimeout(infoHideTimer);
    infoHideTimer = setTimeout(() => {
        popover.classList.remove("visible");
        infoHideTimer = setTimeout(() => { popover.hidden = true; }, 220);
    }, 60);
}

document.querySelectorAll(".info-icon").forEach(btn => {
    btn.addEventListener("mouseenter", () => showInfoPopover(btn));
    btn.addEventListener("mouseleave", scheduleHideInfoPopover);
    btn.addEventListener("focus", () => showInfoPopover(btn));
    btn.addEventListener("blur", scheduleHideInfoPopover);
    btn.addEventListener("touchstart", (e) => {
        e.stopPropagation();
        showInfoPopover(btn);
    }, { passive: true });
});

/* ==========================================================
   MASTER RENDER
   ========================================================== */

function renderAll() {
    const { stats, range } = computeMaterialStats();

    renderSummary(stats, range);
    renderBarChart(stats);
    renderLineChart(stats);
    renderStockCompareTable(stats);
    renderUsageTable(stats);
    renderRecentConsumption();
    renderInsights(stats);

    if ($("noDataBlock")) {
        const noData = usageRecords.length === 0;
        $("noDataBlock").hidden = !noData;
    }
}

/* ==========================================================
   BINDINGS
   ========================================================== */

[searchInput, categorySelect, unitSelect, statusSelect].filter(Boolean).forEach(el => {
    el.addEventListener("input", () => { currentPage = 1; renderAll(); });
});

if (dateRangeSelect) {
    dateRangeSelect.addEventListener("change", () => {
        if (startDateInput) startDateInput.value = "";
        if (endDateInput) endDateInput.value = "";
        if ($("clearCustomDateBtn")) $("clearCustomDateBtn").hidden = true;
        currentPage = 1;
        renderAll();
    });
}

function handleCustomDateChange() {
    if ($("clearCustomDateBtn")) $("clearCustomDateBtn").hidden = !(startDateInput && endDateInput && startDateInput.value && endDateInput.value);
    currentPage = 1;
    renderAll();
}
if (startDateInput) startDateInput.addEventListener("change", handleCustomDateChange);
if (endDateInput) endDateInput.addEventListener("change", handleCustomDateChange);

if ($("clearCustomDateBtn")) {
    $("clearCustomDateBtn").addEventListener("click", () => {
        if (startDateInput) startDateInput.value = "";
        if (endDateInput) endDateInput.value = "";
        $("clearCustomDateBtn").hidden = true;
        currentPage = 1;
        renderAll();
    });
}

if (sortSelect) {
    sortSelect.addEventListener("change", () => { sortKey = sortSelect.value; currentPage = 1; renderAll(); });
}

if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        if (categorySelect) categorySelect.value = "";
        if (unitSelect) unitSelect.value = "";
        if (statusSelect) statusSelect.value = "";
        if (dateRangeSelect) dateRangeSelect.value = "week";
        if (startDateInput) startDateInput.value = "";
        if (endDateInput) endDateInput.value = "";
        if ($("clearCustomDateBtn")) $("clearCustomDateBtn").hidden = true;
        if (sortSelect) sortSelect.value = "name-asc";
        sortKey = "name-asc";
        currentPage = 1;
        renderAll();
    });
}

document.querySelectorAll(".period-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        trendGranularity = btn.dataset.period;
        renderAll();
    });
});

if ($("viewAllRecentBtn")) {
    $("viewAllRecentBtn").addEventListener("click", () => {
        renderModalHistory();
        if ($("modalOverlay")) $("modalOverlay").classList.add("active");
    });
}
if ($("modalCloseBtn")) {
    $("modalCloseBtn").addEventListener("click", () => {
        if ($("modalOverlay")) $("modalOverlay").classList.remove("active");
    });
}
if ($("modalOverlay")) {
    $("modalOverlay").addEventListener("click", (e) => {
        if (e.target.id === "modalOverlay") $("modalOverlay").classList.remove("active");
    });
}

/* ==========================================================
   INIT
   ========================================================== */

function init() {
    loadAll();
}
