// js/user-analytics.js
//
// User — Consumption Analytics.
// Subject: RAW MATERIAL CONSUMPTION, calculated from actual
// public.material_disbursements joined to public.raw_materials.
// Finished Product appears only as supporting context.
// Strictly READ-ONLY. Zero direct stock mutations.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

/* ==========================================================
   ROLE GUARD
   ========================================================== */

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
        console.error("User auth check failed:", e);
        window.location.href = "../user-signin.html";
    }
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

function startOfWeek(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
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
   DATA LOAD (AUTHORITATIVE V2)
   ========================================================== */

async function loadAll() {
    const [matRes, useRes] = await Promise.all([
        supabase.from("raw_materials").select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, description").order("name"),
        supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("usage_date", { ascending: false })
    ]);

    if (matRes.error) throw matRes.error;
    if (useRes.error) console.warn("Disbursements query notice:", useRes.error);

    const rawMats = matRes.data || [];
    const rawUsage = useRes.data || [];

    materials = rawMats.map(m => {
        const stock = Number(m.current_stock || 0);
        const min = m.minimum_threshold !== null ? Number(m.minimum_threshold) : null;
        let status = "Good";
        if (stock <= 0 || (min !== null && stock <= (min / 2))) {
            status = "Critical";
        } else if (min !== null && stock <= min) {
            status = "Low";
        }
        return {
            id: m.id,
            itemCode: m.item_code,
            materialName: m.name,
            unit: m.unit_of_measure || "kg",
            quantity: stock,
            minimumThreshold: min,
            status
        };
    });

    const matMap = new Map(materials.map(m => [m.id, m]));

    usageRecords = rawUsage.map(d => {
        const mat = matMap.get(d.material_id);
        const rawProd = d.finished_product_name ? d.finished_product_name.trim() : "";
        const isProduct = rawProd && rawProd !== "General Usage";
        return {
            id: d.id,
            materialId: d.material_id,
            materialName: mat ? mat.materialName : "Raw Material",
            usedQuantity: Number(d.consumed_quantity || 0),
            usageDate: d.usage_date,
            unit: d.unit || (mat ? mat.unit : "kg"),
            productName: isProduct ? rawProd : null,
            activityType: d.activity_type,
            createdAt: d.created_at
        };
    });

    populateFilterOptions();
    renderAll();
}

function populateFilterOptions() {
    const categories = [...new Set(materials.map(m => m.category || "General").filter(Boolean))].sort();
    const currentCat = categorySelect ? categorySelect.value : "";
    if (categorySelect) {
        categorySelect.innerHTML = `<option value="">All Categories</option>` +
            categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
        if (categories.includes(currentCat)) categorySelect.value = currentCat;
    }

    const units = [...new Set(materials.map(m => m.unit).filter(Boolean))].sort();
    const currentUnit = unitSelect ? unitSelect.value : "";
    if (unitSelect) {
        unitSelect.innerHTML = `<option value="">All Units</option>` +
            units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
        if (units.includes(currentUnit)) unitSelect.value = currentUnit;
    }
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
        (!category || (m.category || "General") === category) &&
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

function renderSummary(stats) {
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

    const mostUsedEl = $("mostUsedMaterial");
    const mostUsedSub = $("mostUsedSubtext");
    if (mostUsedEl) {
        if (withUsage.length === 0) {
            mostUsedEl.textContent = "-";
            if (mostUsedSub) mostUsedSub.textContent = "";
        } else {
            const top = [...withUsage].sort((a, b) => b.currentTotal - a.currentTotal)[0];
            mostUsedEl.textContent = top.material.materialName;
            if (mostUsedSub) mostUsedSub.textContent = `${formatNum(top.currentTotal)} ${top.material.unit || ""} used`;
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
   RENDER: BAR CHART
   ========================================================== */

function renderBarChart(stats) {
    const withUsage = [...stats.filter(s => s.currentTotal > 0)].sort((a, b) => b.currentTotal - a.currentTotal);
    const ctx = document.getElementById("distributionChart");
    const othersHint = $("othersHintBar");
    if (!ctx || typeof Chart === "undefined") return;

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
                backgroundColor: labels.map(l => l === "Others" ? "rgba(124,146,179,.35)" : "rgba(37,99,235,.75)"),
                borderRadius: 8,
                maxBarThickness: 46
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
   RENDER: LINE CHART
   ========================================================== */

function renderLineChart(stats) {
    const { range } = computeMaterialStats();
    const ctx = document.getElementById("consumptionChart");
    if (!ctx || typeof Chart === "undefined") return;
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
   RENDER: TABLES
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

    switch (sortKey) {
        case "name-asc": rows.sort((a, b) => a.material.materialName.localeCompare(b.material.materialName)); break;
        case "name-desc": rows.sort((a, b) => b.material.materialName.localeCompare(a.material.materialName)); break;
        case "used-desc": rows.sort((a, b) => b.currentTotal - a.currentTotal); break;
        case "used-asc": rows.sort((a, b) => a.currentTotal - b.currentTotal); break;
        case "change-desc": rows.sort((a, b) => (b.trend.change ?? -Infinity) - (a.trend.change ?? -Infinity)); break;
        case "change-asc": rows.sort((a, b) => (a.trend.change ?? Infinity) - (b.trend.change ?? Infinity)); break;
        case "status": {
            const order = { Critical: 0, Low: 1, Available: 2, Good: 2 };
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
                <td>${escapeHtml(s.material.category || "General")}</td>
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
        .sort((a, b) => new Date(b.usageDate || b.createdAt || 0) - new Date(a.usageDate || a.createdAt || 0))
        .slice(0, 8);

    const tbody = $("recentActivityList");
    if (!tbody) return;

    if (recent.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><p>No consumption data yet. Consumption analytics will appear here once material activity is recorded.</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = recent.map(r => `
        <tr>
            <td>${new Date(r.usageDate || r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
            <td>${escapeHtml(r.materialName)}</td>
            <td>${formatNum(r.usedQuantity)} ${escapeHtml(r.unit || "")}</td>
            <td>${escapeHtml(r.productName || "—")}</td>
        </tr>`).join("");
}

/* ==========================================================
   RENDER: CONSUMPTION INSIGHTS
   ========================================================== */

function renderInsights(stats) {
    const list = $("insightsList");
    if (!list) return;

    const withUsage = stats.filter(s => s.currentTotal > 0);
    if (withUsage.length === 0) {
        list.innerHTML = `<li>No consumption activity recorded for this period. Insights will appear once raw materials are consumed.</li>`;
        return;
    }

    const items = [];
    const top = [...withUsage].sort((a, b) => b.currentTotal - a.currentTotal)[0];
    if (top) {
        items.push(`<strong>${escapeHtml(top.material.materialName)}</strong> is the most consumed material during this period, with ${formatNum(top.currentTotal)} ${escapeHtml(top.material.unit || "")} used.`);
    }

    const risingLow = withUsage.filter(s => (s.material.status === "Low" || s.material.status === "Critical") && s.trend.arrow === "up");
    risingLow.forEach(s => {
        items.push(`⚠ <strong>${escapeHtml(s.material.materialName)}</strong> has increasing usage while current stock is low.`);
    });

    const rising = withUsage.filter(s => s.trend.arrow === "up" && !risingLow.includes(s));
    if (rising.length > 0) {
        items.push(`${rising.length} raw material${rising.length > 1 ? "s" : ""} showed increased consumption compared with the previous period.`);
    }

    list.innerHTML = items.map(t => `<li>${t}</li>`).join("");
}

/* ==========================================================
   RENDER ALL
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
}

/* ==========================================================
   EVENT LISTENERS & INIT
   ========================================================== */

function init() {
    loadAll();

    if (searchInput) searchInput.addEventListener("input", () => { currentPage = 1; renderAll(); });
    if (dateRangeSelect) dateRangeSelect.addEventListener("change", () => { currentPage = 1; renderAll(); });
    if (startDateInput) startDateInput.addEventListener("change", () => { currentPage = 1; renderAll(); });
    if (endDateInput) endDateInput.addEventListener("change", () => { currentPage = 1; renderAll(); });
    if (categorySelect) categorySelect.addEventListener("change", () => { currentPage = 1; renderAll(); });
    if (unitSelect) unitSelect.addEventListener("change", () => { currentPage = 1; renderAll(); });
    if (statusSelect) statusSelect.addEventListener("change", () => { currentPage = 1; renderAll(); });

    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener("click", () => {
            if (searchInput) searchInput.value = "";
            if (dateRangeSelect) dateRangeSelect.value = "week";
            if (startDateInput) startDateInput.value = "";
            if (endDateInput) endDateInput.value = "";
            if (categorySelect) categorySelect.value = "";
            if (unitSelect) unitSelect.value = "";
            if (statusSelect) statusSelect.value = "";
            currentPage = 1;
            renderAll();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener("change", (e) => {
            sortKey = e.target.value;
            currentPage = 1;
            renderAll();
        });
    }

    document.querySelectorAll(".period-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            trendGranularity = btn.dataset.period;
            const { stats } = computeMaterialStats();
            renderLineChart(stats);
        });
    });
}
