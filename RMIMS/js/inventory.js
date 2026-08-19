// RMIMS V2 — Inventory Management (Admin)
// Authoritative tables: raw_materials, stock_receipts, material_disbursements, user_profiles.
// Controlled transactions: record_stock_receipt_v2(), record_material_disbursement_v2().
// ZERO direct current_stock mutations.

import { auth, supabase } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

const $ = id => document.getElementById(id);

const state = {
    materials: [],
    usage: [],
    receipts: [],
    search: "",
    category: "",
    status: "",
    page: 1,
    rowsPerPage: 10
};

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const num = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

const fmtQty = (v, u = "") => `${num(v).toLocaleString(undefined, { maximumFractionDigits: 4 })}${u ? ` ${u}` : ""}`;

function toast(message, type = "success") {
    const stack = $("toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${esc(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
        el.classList.add("leaving");
        setTimeout(() => el.remove(), 260);
    }, 3200);
}

function statusOf(m) {
    const q = num(m.quantity);
    const min = m.minimumThreshold !== null && m.minimumThreshold !== undefined ? num(m.minimumThreshold) : null;
    if (q <= 0) return { key: "out", cls: "critical", label: "🔴 Out of Stock" };
    if (min !== null && q < min) return { key: "low", cls: "low", label: "🟠 Low Stock" };
    return { key: "available", cls: "available", label: "🟢 Available" };
}

function setFieldError(id, msg = "") {
    const el = $(id);
    if (el) el.textContent = msg;
}

let matAnalyticsPage = 1;
const MAT_PER_PAGE = 4;

/* ==========================================================
   DATA LOAD
   ========================================================== */

async function loadData() {
    try {
        const [mRes, uRes, rRes] = await Promise.all([
            supabase.from("raw_materials").select("id, item_code, name, description, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, created_at, updated_at").order("name"),
            supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("created_at", { ascending: false }),
            supabase.from("stock_receipts").select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at").order("created_at", { ascending: false })
        ]);

        if (mRes.error) throw mRes.error;

        const rawList = mRes.data || [];
        const rawUsage = uRes.data || [];
        const rawReceipts = rRes.data || [];

        // Build material lookup map
        const matMap = new Map();
        rawList.forEach(m => matMap.set(m.id, m));

        state.materials = rawList.map(d => {
            const currentStock = num(d.current_stock);
            const minThreshold = d.minimum_threshold !== null && d.minimum_threshold !== undefined ? num(d.minimum_threshold) : null;
            let statusKey = "Available";
            if (currentStock <= 0) statusKey = "Critical";
            else if (minThreshold !== null && currentStock < minThreshold) statusKey = "Low";

            return {
                id: d.id,
                itemCode: d.item_code || "",
                materialName: d.name || "",
                description: d.description || "",
                category: d.description || "General",
                unit: d.unit_of_measure || "kg",
                quantity: currentStock,
                minimumThreshold: minThreshold,
                reorderQuantity: d.reorder_quantity,
                leadTimeDays: d.lead_time_days,
                supplier: d.description || "Standard Catalog",
                storageLocation: "",
                notes: d.description || "",
                status: statusKey,
                updatedAt: d.updated_at || null,
                createdAt: d.created_at || null
            };
        });

        state.usage = rawUsage.map(d => {
            const mat = matMap.get(d.material_id);
            return {
                id: d.id,
                materialId: d.material_id,
                materialName: mat ? mat.name : "Raw Material",
                productName: d.finished_product_name || d.activity_type || "General Usage",
                usedQuantity: num(d.consumed_quantity),
                unit: d.unit || (mat ? mat.unit_of_measure : "kg"),
                usageDate: d.usage_date || null,
                createdAt: d.created_at || null,
                remarks: d.activity_type || ""
            };
        });

        state.receipts = rawReceipts.map(d => {
            const mat = matMap.get(d.material_id);
            return {
                id: d.id,
                materialId: d.material_id,
                materialName: mat ? mat.name : "Raw Material",
                receivedQuantity: num(d.received_quantity),
                unit: d.unit || (mat ? mat.unit_of_measure : "kg"),
                receivedDate: d.receipt_date || null,
                createdAt: d.created_at || null,
                supplierName: d.supplier_name || "Standard Supplier",
                notes: d.supplier_name || ""
            };
        });

        populateCategoryFilter();
        populateChartDropdowns();
        renderSummary();
        renderTable();
        renderMaterialAnalytics();
        renderFinishedProductUsage();
        renderInventoryCharts();
        setupPaginationListeners();
        initChartFilterListeners();
    } catch (err) {
        console.error("loadData error:", err);
        state.materials = [];
        state.usage = [];
        state.receipts = [];
        populateCategoryFilter();
        populateChartDropdowns();
        renderSummary();
        renderTable();
        renderMaterialAnalytics();
        renderFinishedProductUsage();
        renderInventoryCharts();
        setupPaginationListeners();
        initChartFilterListeners();
    }
}

/* ==========================================================
   CHARTS & LIVE SCOPE FILTERS
   ========================================================== */

let invDonutChartInstance = null;
let invMovementChartInstance = null;

function populateChartDropdowns() {
    // 1. Stock Health Categories
    const catSelect = $("stockHealthCategorySelect");
    if (catSelect) {
        const currentVal = catSelect.value;
        const cats = [...new Set(state.materials.map(m => m.category || "General").filter(Boolean))].sort();
        catSelect.innerHTML = '<option value="">All Categories</option>' +
            cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
        if (cats.includes(currentVal)) catSelect.value = currentVal;
    }

    // 2. Stock Health Units
    const unitSelect = $("stockHealthUnitSelect");
    if (unitSelect) {
        const currentVal = unitSelect.value;
        const units = [...new Set(state.materials.map(m => m.unit).filter(Boolean))].sort();
        unitSelect.innerHTML = '<option value="">All Units</option>' +
            units.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
        if (units.includes(currentVal)) unitSelect.value = currentVal;
    }

    // 3. Movement Units
    const moveUnitSelect = $("movementUnitSelect");
    if (moveUnitSelect) {
        const currentVal = moveUnitSelect.value || "all";
        const moveUnits = [...new Set([
            ...state.receipts.map(r => r.unit),
            ...state.usage.map(u => u.unit),
            ...state.materials.map(m => m.unit)
        ].filter(Boolean))].sort();
        moveUnitSelect.innerHTML = '<option value="all">All Units</option>' +
            moveUnits.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
        if (currentVal === "all" || moveUnits.includes(currentVal)) {
            moveUnitSelect.value = currentVal;
        } else {
            moveUnitSelect.value = "all";
        }
    }
}

function getMovementDateRange(periodKey, customStart, customEnd) {
    const now = new Date();
    const formatDate = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    };

    const todayStr = formatDate(now);

    if (periodKey === "today") {
        return { startStr: todayStr, endStr: todayStr, label: "today" };
    }

    if (periodKey === "last7") {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return { startStr: formatDate(d), endStr: todayStr, label: "the last 7 days" };
    }

    if (periodKey === "last30") {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        return { startStr: formatDate(d), endStr: todayStr, label: "the last 30 days" };
    }

    if (periodKey === "month") {
        const d = new Date(now.getFullYear(), now.getMonth(), 1);
        return { startStr: formatDate(d), endStr: todayStr, label: "this month" };
    }

    if (periodKey === "custom" && customStart && customEnd) {
        let s = customStart;
        let e = customEnd;
        if (s > e) [s, e] = [e, s];
        return { startStr: s, endStr: e, label: `${s} to ${e}` };
    }

    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return { startStr: formatDate(d), endStr: todayStr, label: "the last 7 days" };
}

function renderStockHealthDonut() {
    const canvas = $("invStatusDonutChart");
    const emptyEl = $("stockHealthEmptyState");
    const subtitleEl = $("stockHealthSubtitle");
    if (!canvas || typeof Chart === "undefined") return;

    const view = $("stockHealthFilter") ? $("stockHealthFilter").value : "all";
    const catSelect = $("stockHealthCategorySelect");
    const unitSelect = $("stockHealthUnitSelect");

    let filtered = [...state.materials];
    let subtitle = "Current stock condition across all raw materials.";

    if (view === "category") {
        const cat = catSelect ? catSelect.value : "";
        if (cat) {
            filtered = filtered.filter(m => String(m.category || "General").toLowerCase() === cat.toLowerCase());
            subtitle = `Stock condition for category: ${cat}.`;
        } else {
            subtitle = "Stock condition across all categories.";
        }
    } else if (view === "unit") {
        const u = unitSelect ? unitSelect.value : "";
        if (u) {
            filtered = filtered.filter(m => String(m.unit || "kg").toLowerCase() === u.toLowerCase());
            subtitle = `Stock condition for materials measured in ${u}.`;
        } else {
            subtitle = "Stock condition across all units.";
        }
    } else if (view === "low") {
        filtered = filtered.filter(m => statusOf(m).key === "low");
        subtitle = "Materials currently below their defined stock threshold.";
    } else if (view === "out") {
        filtered = filtered.filter(m => statusOf(m).key === "out");
        subtitle = "Materials with no available stock.";
    }

    if (subtitleEl) subtitleEl.textContent = subtitle;

    const avail = filtered.filter(m => statusOf(m).key === "available").length;
    const low = filtered.filter(m => statusOf(m).key === "low").length;
    const out = filtered.filter(m => statusOf(m).key === "out").length;
    const totalCount = filtered.length;

    console.log("[RMIMS Analytics] Stock Health:", {
        view,
        totalMaterials: totalCount,
        healthy: avail,
        lowStock: low,
        outOfStock: out
    });

    if (invDonutChartInstance) {
        invDonutChartInstance.destroy();
        invDonutChartInstance = null;
    }

    if (totalCount === 0) {
        canvas.style.display = "none";
        if (emptyEl) {
            emptyEl.style.display = "flex";
            emptyEl.textContent = "No materials match this view.";
        }
        return;
    }

    canvas.style.display = "block";
    if (emptyEl) emptyEl.style.display = "none";

    let labels = [];
    let data = [];
    let bgColors = [];

    if (view === "low") {
        labels = ["Low Stock"];
        data = [low];
        bgColors = ["#F59E0B"];
    } else if (view === "out") {
        labels = ["Out of Stock"];
        data = [out];
        bgColors = ["#EF4444"];
    } else {
        labels = ["Available", "Low Stock", "Out of Stock"];
        data = [avail, low, out];
        bgColors = ["#10B981", "#F59E0B", "#EF4444"];
    }

    const ctx = canvas.getContext("2d");
    invDonutChartInstance = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor: "#FFFFFF"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: "right",
                    labels: { boxWidth: 12, font: { size: 11, family: "Inter, sans-serif" } }
                },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        label: function (context) {
                            const label = context.label || "";
                            const val = context.raw || 0;
                            const pct = totalCount > 0 ? ((val / totalCount) * 100).toFixed(1) : "0.0";
                            return `${label}: ${val} materials (${pct}%)`;
                        }
                    }
                }
            },
            cutout: "68%"
        }
    });
}

function renderMovementChart() {
    const canvas = $("invReceivedVsUsedChart");
    const emptyEl = $("movementEmptyState");
    const subtitleEl = $("movementSubtitle");
    if (!canvas || typeof Chart === "undefined") return;

    const periodKey = $("movementPeriodSelect") ? $("movementPeriodSelect").value : "last7";
    const customStart = $("movementStartDate") ? $("movementStartDate").value : "";
    const customEnd = $("movementEndDate") ? $("movementEndDate").value : "";
    const selectedUnit = $("movementUnitSelect") ? $("movementUnitSelect").value : "all";

    const range = getMovementDateRange(periodKey, customStart, customEnd);

    let subtitle = `Raw-material movement for ${range.label}.`;
    if (selectedUnit !== "all") {
        const unitName = selectedUnit === "kg" ? "kilograms (kg)" : selectedUnit === "L" ? "liters (L)" : selectedUnit === "loaf" ? "loaves (loaf)" : selectedUnit;
        subtitle = `Raw-material movement for ${unitName} during ${range.label}.`;
    }
    if (subtitleEl) subtitleEl.textContent = subtitle;

    const filteredReceipts = (state.receipts || []).filter(r => r.receivedDate && r.receivedDate >= range.startStr && r.receivedDate <= range.endStr);
    const filteredUsage = (state.usage || []).filter(u => u.usageDate && u.usageDate >= range.startStr && u.usageDate <= range.endStr);

    let unitsList = [];
    if (selectedUnit !== "all") {
        unitsList = [selectedUnit];
    } else {
        const unitsSet = new Set();
        filteredReceipts.forEach(r => { if (r.unit) unitsSet.add(String(r.unit).trim()); });
        filteredUsage.forEach(u => { if (u.unit) unitsSet.add(String(u.unit).trim()); });
        if (!unitsSet.size) {
            (state.materials || []).forEach(m => { if (m.unit) unitsSet.add(String(m.unit).trim()); });
        }
        unitsList = Array.from(unitsSet).filter(Boolean).sort();
    }

    const receivedData = unitsList.map(u =>
        filteredReceipts
            .filter(r => String(r.unit || "kg").toLowerCase() === u.toLowerCase())
            .reduce((s, r) => s + (num(r.receivedQuantity) || 0), 0)
    );

    const usedData = unitsList.map(u =>
        filteredUsage
            .filter(uRow => String(uRow.unit || "kg").toLowerCase() === u.toLowerCase())
            .reduce((s, uRow) => s + (num(uRow.usedQuantity) || 0), 0)
    );

    const totalRec = receivedData.reduce((a, b) => a + b, 0);
    const totalUse = usedData.reduce((a, b) => a + b, 0);
    const hasMovement = (totalRec > 0 || totalUse > 0) && (filteredReceipts.length > 0 || filteredUsage.length > 0);

    console.log("[RMIMS Analytics] Movement:", {
        period: periodKey,
        dateRange: range,
        totalReceiptRecords: filteredReceipts.length,
        totalDisbursementRecords: filteredUsage.length,
        unitsDetected: unitsList,
        receivedByUnit: unitsList.map((u, i) => `${u}: ${receivedData[i]}`),
        usedByUnit: unitsList.map((u, i) => `${u}: ${usedData[i]}`)
    });

    if (invMovementChartInstance) {
        invMovementChartInstance.destroy();
        invMovementChartInstance = null;
    }

    if (!hasMovement) {
        canvas.style.display = "none";
        if (emptyEl) {
            emptyEl.style.display = "flex";
            emptyEl.textContent = "No movement recorded for this period.";
        }
        return;
    }

    canvas.style.display = "block";
    if (emptyEl) emptyEl.style.display = "none";

    const chartLabels = unitsList.map(u =>
        u === "kg" ? "Kilograms (kg)" : u === "L" ? "Liters (L)" : u === "loaf" ? "Loaves (loaf)" : `Unit (${u})`
    );

    const ctx = canvas.getContext("2d");
    invMovementChartInstance = new Chart(ctx, {
        type: "bar",
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: "Received",
                    data: receivedData,
                    backgroundColor: "rgba(16, 185, 129, 0.85)",
                    borderColor: "#10B981",
                    borderWidth: 1,
                    borderRadius: 6
                },
                {
                    label: "Used",
                    data: usedData,
                    backgroundColor: "rgba(239, 68, 68, 0.85)",
                    borderColor: "#EF4444",
                    borderWidth: 1,
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    labels: { boxWidth: 12, font: { size: 11, family: "Inter, sans-serif" } }
                },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        label: function (context) {
                            const datasetLabel = context.dataset.label || "";
                            const val = Number(context.raw || 0);
                            const unitLabel = unitsList[context.dataIndex] || "";
                            return `${datasetLabel}: ${val.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unitLabel}`;
                        }
                    }
                }
            },
            scales: {
                x: { grid: { display: false } },
                y: {
                    beginAtZero: true,
                    grid: { color: "rgba(226, 232, 240, 0.6)" },
                    ticks: { font: { size: 11 } }
                }
            }
        }
    });
}

function renderInventoryCharts() {
    renderStockHealthDonut();
    renderMovementChart();
}

function initChartFilterListeners() {
    const stockView = $("stockHealthFilter");
    const stockCat = $("stockHealthCategorySelect");
    const stockUnit = $("stockHealthUnitSelect");

    if (stockView && !stockView.dataset.bound) {
        stockView.dataset.bound = "true";
        stockView.addEventListener("change", () => {
            const v = stockView.value;
            if (stockCat) stockCat.style.display = v === "category" ? "inline-block" : "none";
            if (stockUnit) stockUnit.style.display = v === "unit" ? "inline-block" : "none";
            renderStockHealthDonut();
        });
    }

    if (stockCat && !stockCat.dataset.bound) {
        stockCat.dataset.bound = "true";
        stockCat.addEventListener("change", renderStockHealthDonut);
    }

    if (stockUnit && !stockUnit.dataset.bound) {
        stockUnit.dataset.bound = "true";
        stockUnit.addEventListener("change", renderStockHealthDonut);
    }

    const movePeriod = $("movementPeriodSelect");
    const moveCustomWrap = $("movementCustomDateWrap");
    const moveStart = $("movementStartDate");
    const moveEnd = $("movementEndDate");
    const moveUnit = $("movementUnitSelect");

    if (movePeriod && !movePeriod.dataset.bound) {
        movePeriod.dataset.bound = "true";
        movePeriod.addEventListener("change", () => {
            const isCustom = movePeriod.value === "custom";
            if (moveCustomWrap) moveCustomWrap.style.display = isCustom ? "inline-flex" : "none";
            if (isCustom && moveStart && moveEnd && (!moveStart.value || !moveEnd.value)) {
                const now = new Date();
                const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
                const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                if (!moveStart.value) moveStart.value = fmt(d7);
                if (!moveEnd.value) moveEnd.value = fmt(now);
            }
            renderMovementChart();
        });
    }

    if (moveStart && !moveStart.dataset.bound) {
        moveStart.dataset.bound = "true";
        moveStart.addEventListener("change", () => {
            if (moveStart.value && moveEnd.value && moveStart.value > moveEnd.value) {
                moveEnd.value = moveStart.value;
            }
            renderMovementChart();
        });
    }

    if (moveEnd && !moveEnd.dataset.bound) {
        moveEnd.dataset.bound = "true";
        moveEnd.addEventListener("change", () => {
            if (moveStart.value && moveEnd.value && moveEnd.value < moveStart.value) {
                moveStart.value = moveEnd.value;
            }
            renderMovementChart();
        });
    }

    if (moveUnit && !moveUnit.dataset.bound) {
        moveUnit.dataset.bound = "true";
        moveUnit.addEventListener("change", renderMovementChart);
    }
}

function setupPaginationListeners() {
    const prevBtn = $("prevMatPageBtn");
    const nextBtn = $("nextMatPageBtn");
    if (prevBtn && !prevBtn.dataset.bound) {
        prevBtn.dataset.bound = "true";
        prevBtn.addEventListener("click", () => {
            if (matAnalyticsPage > 1) {
                matAnalyticsPage--;
                renderMaterialAnalytics();
            }
        });
    }
    if (nextBtn && !nextBtn.dataset.bound) {
        nextBtn.dataset.bound = "true";
        nextBtn.addEventListener("click", () => {
            const totalPages = Math.ceil(state.materials.length / MAT_PER_PAGE);
            if (matAnalyticsPage < totalPages) {
                matAnalyticsPage++;
                renderMaterialAnalytics();
            }
        });
    }
}

function renderMaterialAnalytics() {
    const grid = $("matQuantityBarGrid");
    const indicator = $("matPageIndicator");
    const prevBtn = $("prevMatPageBtn");
    const nextBtn = $("nextMatPageBtn");
    if (!grid) return;

    const sortedMaterials = [...state.materials].sort((a, b) => String(a.materialName || "").localeCompare(String(b.materialName || "")));
    const totalPages = Math.max(1, Math.ceil(sortedMaterials.length / MAT_PER_PAGE));
    if (matAnalyticsPage > totalPages) matAnalyticsPage = totalPages;
    if (matAnalyticsPage < 1) matAnalyticsPage = 1;

    const pageMaterials = sortedMaterials.slice((matAnalyticsPage - 1) * MAT_PER_PAGE, matAnalyticsPage * MAT_PER_PAGE);

    if (indicator) indicator.textContent = `Page ${matAnalyticsPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = matAnalyticsPage <= 1;
    if (nextBtn) nextBtn.disabled = matAnalyticsPage >= totalPages;

    if (!pageMaterials.length) {
        grid.innerHTML = `<div style="grid-column: 1/-1; padding: 24px 0; text-align: center; color: var(--rm-ink-dim, #64748b); font-size: 13px; font-weight: 500;">No raw materials recorded yet.</div>`;
        return;
    }

    grid.innerHTML = pageMaterials.map(m => {
        const qty = num(m.quantity);
        const min = m.minimumThreshold !== null && m.minimumThreshold !== undefined ? num(m.minimumThreshold) : 0;
        const maxRef = Math.max(qty, min * 2.5, 80);
        const pct = Math.min(100, Math.max(5, Math.round((qty / maxRef) * 100)));
        const st = statusOf(m);
        const badgeBg = st.key === "out" ? "rgba(239, 68, 68, 0.12)" : st.key === "low" ? "rgba(245, 158, 11, 0.12)" : "rgba(16, 185, 129, 0.12)";
        const badgeColor = st.key === "out" ? "#DC2626" : st.key === "low" ? "#D97706" : "#059669";
        const barColor = st.key === "out" ? "#EF4444" : st.key === "low" ? "#F59E0B" : "#10B981";

        return `
            <div style="padding: 20px; background: #ffffff; border: 1px solid var(--line-soft, #E2E8F0); border-radius: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <strong style="font-size: 15px; font-weight: 700; color: var(--rm-ink, #0F172A);">${esc(m.materialName)}</strong>
                        <span style="font-size: 13px; font-weight: 800; color: var(--rm-ink, #0F172A); background: rgba(0,0,0,0.04); padding: 4px 10px; border-radius: 20px;">${fmtQty(qty, m.unit || "")}</span>
                    </div>
                    <div style="font-size: 12px; color: var(--rm-ink-dim, #64748B); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <span>Code: <strong style="color: var(--rm-ink, #1E293B);">${esc(m.itemCode || "—")}</strong></span>
                        <span>Min Stock: <strong style="color: var(--rm-ink, #1E293B);">${min ? fmtQty(min, m.unit || "") : "—"}</strong></span>
                    </div>
                </div>
                <div>
                    <div style="height: 9px; background: rgba(0,0,0,0.06); border-radius: 6px; overflow: hidden; position: relative; margin-bottom: 10px;">
                        <div style="height: 100%; width: ${pct}%; background: ${barColor}; border-radius: 6px; transition: width 0.4s ease;"></div>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 12px; background: ${badgeBg}; color: ${badgeColor}; display: inline-flex; align-items: center; gap: 4px;">
                            ${esc(st.label)}
                        </span>
                        <span style="font-size: 11px; color: var(--rm-ink-dim, #64748B);">Category: ${esc(m.category || "—")}</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

let prodAnalyticsPage = 1;
const PROD_PER_PAGE = 4;

function renderFinishedProductUsage() {
    const container = $("finishedProductUsageContainer");
    const indicator = $("prodPageIndicator");
    const prevBtn = $("prevProdPageBtn");
    const nextBtn = $("nextProdPageBtn");
    if (!container) return;

    const usageWithProduct = state.usage.filter(u => u.productName && u.usedQuantity);
    if (!usageWithProduct.length) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 24px 0; text-align: center;">
                <p style="margin: 0; font-size: 13px; color: var(--rm-ink-dim, #64748b); font-weight: 500;">No product consumption records recorded yet.</p>
            </div>`;
        if (indicator) indicator.textContent = "Page 1 of 1";
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }

    const prodMap = new Map();
    usageWithProduct.forEach(u => {
        const key = u.productName;
        if (!prodMap.has(key)) prodMap.set(key, []);
        prodMap.get(key).push(u);
    });

    const entries = [...prodMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const totalPages = Math.max(1, Math.ceil(entries.length / PROD_PER_PAGE));
    if (prodAnalyticsPage > totalPages) prodAnalyticsPage = totalPages;
    if (prodAnalyticsPage < 1) prodAnalyticsPage = 1;

    const pageEntries = entries.slice((prodAnalyticsPage - 1) * PROD_PER_PAGE, prodAnalyticsPage * PROD_PER_PAGE);

    if (indicator) indicator.textContent = `Page ${prodAnalyticsPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = prodAnalyticsPage <= 1;
    if (nextBtn) nextBtn.disabled = prodAnalyticsPage >= totalPages;

    if (!prevBtn?.dataset.bound) {
        if (prevBtn) {
            prevBtn.dataset.bound = "true";
            prevBtn.addEventListener("click", () => {
                if (prodAnalyticsPage > 1) {
                    prodAnalyticsPage--;
                    renderFinishedProductUsage();
                }
            });
        }
        if (nextBtn) {
            nextBtn.dataset.bound = "true";
            nextBtn.addEventListener("click", () => {
                if (prodAnalyticsPage < totalPages) {
                    prodAnalyticsPage++;
                    renderFinishedProductUsage();
                }
            });
        }
    }

    const maxVal = Math.max(...entries.map(([_, items]) => items.reduce((s, i) => s + (num(i.usedQuantity) || 0), 0)), 1);

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
            ${pageEntries.map(([prod, items]) => {
                const totalUsed = items.reduce((s, i) => s + (num(i.usedQuantity) || 0), 0);
                const pct = Math.min(100, Math.max(8, Math.round((totalUsed / maxVal) * 100)));
                const matSummary = items.slice(0, 3).map(i => `${esc(i.materialName)}: ${fmtQty(i.usedQuantity, i.unit || "")}`).join(" • ");
                return `
                    <div style="padding: 20px; background: #ffffff; border: 1px solid var(--line-soft, #E2E8F0); border-radius: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                <strong style="font-size: 15px; font-weight: 700; color: var(--rm-ink, #0F172A);">${esc(prod)}</strong>
                                <span style="font-size: 12px; font-weight: 700; color: #16803C; background: rgba(22, 128, 60, 0.08); padding: 4px 10px; border-radius: 20px;">${fmtQty(totalUsed)} total used</span>
                            </div>
                            <div style="font-size: 12px; color: var(--rm-ink-dim, #64748B); margin-bottom: 14px; line-height: 1.4;">
                                ${matSummary ? `Materials consumed: <strong style="color: var(--rm-ink);">${matSummary}</strong>` : "Raw material usage recorded"}
                            </div>
                        </div>
                        <div>
                            <div style="height: 9px; background: rgba(0,0,0,0.06); border-radius: 6px; overflow: hidden; margin-bottom: 6px;">
                                <div style="height: 100%; width: ${pct}%; background: linear-gradient(90deg, #16803C, #10B981); border-radius: 6px; transition: width 0.4s ease;"></div>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--rm-ink-dim);">
                                <span>Usage Level</span>
                                <span style="font-weight: 600; color: var(--rm-ink);">${pct}% of peak</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function populateCategoryFilter() {
    const el = $("categoryFilter");
    if (!el) return;
    const categories = [...new Set(state.materials.map(m => m.category).filter(Boolean))].sort();
    const current = el.value;
    el.innerHTML = `<option value="">All Categories</option>` + categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    if (categories.includes(current)) el.value = current;
}

function renderSummary() {
    const total = state.materials.length;
    const available = state.materials.filter(m => statusOf(m).key === "available").length;
    const low = state.materials.filter(m => statusOf(m).key === "low").length;
    const out = state.materials.filter(m => statusOf(m).key === "out").length;
    if ($("cardTotalCount")) $("cardTotalCount").textContent = total;
    if ($("cardAvailableCount")) $("cardAvailableCount").textContent = available;
    if ($("cardLowCount")) $("cardLowCount").textContent = low;
    if ($("cardOutCount")) $("cardOutCount").textContent = out;
}

function filtered() {
    const term = state.search.trim().toLowerCase();
    return state.materials.filter(m => {
        if (state.category && m.category !== state.category) return false;
        if (state.status && statusOf(m).key !== state.status) return false;
        if (term && !`${m.materialName} ${m.itemCode} ${m.category} ${m.supplier || ""}`.toLowerCase().includes(term)) return false;
        return true;
    }).sort((a, b) => String(a.materialName || "").localeCompare(String(b.materialName || "")));
}

function renderTable() {
    const tbody = $("inventoryTableBody"), result = $("resultCount");
    if (!tbody) return;
    const list = filtered();
    if (result) result.textContent = `${list.length} of ${state.materials.length} materials`;
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><strong>No raw materials recorded yet.</strong><span>Add a material or adjust your filters.</span></div></td></tr>`;
        return;
    }
    const pages = Math.max(1, Math.ceil(list.length / state.rowsPerPage));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.rowsPerPage;
    const rows = list.slice(start, start + state.rowsPerPage);
    tbody.innerHTML = rows.map(m => {
        const st = statusOf(m);
        return `<tr data-id="${esc(m.id)}">
            <td data-label="Material">
                <strong>${esc(m.materialName)}</strong>
                ${m.itemCode ? `<br><small style="color: var(--rm-ink-dim, #64748b);">${esc(m.itemCode)}</small>` : ""}
            </td>
            <td data-label="Category">${esc(m.category || "—")}</td>
            <td data-label="Current Stock"><strong>${esc(fmtQty(m.quantity, m.unit))}</strong></td>
            <td data-label="Unit">${esc(m.unit || "—")}</td>
            <td data-label="Minimum Stock">${m.minimumThreshold !== null && m.minimumThreshold !== undefined ? esc(fmtQty(m.minimumThreshold, m.unit)) : "—"}</td>
            <td data-label="Supplier">${esc(m.supplier || "—")}</td>
            <td data-label="Status"><span class="status ${st.cls}">${esc(st.label)}</span></td>
            <td data-label="Actions">
                <button class="btn-secondary btn-sm mat-view" data-id="${esc(m.id)}">View</button>
                <button class="btn-secondary btn-sm mat-edit" data-id="${esc(m.id)}">Edit</button>
                <button class="btn-secondary btn-sm mat-delete" data-id="${esc(m.id)}">Delete</button>
            </td>
        </tr>`;
    }).join("");
}

/* ==========================================================
   MATERIAL MODAL (ADD / EDIT)
   ========================================================== */

function openModal(modalId, material = null) {
    $("matId").value = material?.id || "";
    $("matName").value = material?.materialName || "";
    $("matQuantity").value = material?.quantity !== undefined ? material.quantity : "";
    $("matQuantity").disabled = !!material; // Current stock is controlled via Receive/Disburse procedures
    $("matMinThreshold").value = material?.minimumThreshold !== null && material?.minimumThreshold !== undefined ? material.minimumThreshold : "";
    $("matSupplier").value = material?.supplier || "";
    $("matStorageLocation").value = material?.storageLocation || "";
    $("matNotes").value = material?.notes || "";
    $("matUnit").value = material?.unit || "kg";
    $("matCategoryNewWrap").hidden = true;
    $("matCategoryNew").value = "";
    ["matNameError", "matCategoryError", "matCategoryNewError", "matUnitError", "matQuantityError", "matMinThresholdError", "matSupplierError"].forEach(x => setFieldError(x));
    const cats = [...new Set(state.materials.map(m => m.category).filter(Boolean))].sort();
    const current = material?.category || "";
    $("matCategory").innerHTML = `<option value="">Select Category</option>` + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("") + `<option value="__new__">Others</option>`;
    if (cats.includes(current)) $("matCategory").value = current;
    else if (current) {
        $("matCategory").value = "__new__";
        $("matCategoryNewWrap").hidden = false;
        $("matCategoryNew").value = current;
    }
    $("materialModalTitle").textContent = material ? "Edit Raw Material" : "Add Raw Material";
    $("materialModalSubtitle").textContent = material ? "Update raw material catalog details." : "Enter new raw material details.";
    $("materialModalOverlay").classList.add("open");
}

function closeMaterialModal() {
    $("materialModalOverlay").classList.remove("open");
}

async function saveMaterial() {
    const name = $("matName").value.trim();
    const category = $("matCategory").value === "__new__" ? $("matCategoryNew").value.trim() : $("matCategory").value;
    const unit = $("matUnit").value.trim();
    const initialQty = num($("matQuantity").value);
    const minInput = $("matMinThreshold").value.trim();
    const min = minInput !== "" ? num(minInput) : null;
    const isEdit = !!$("matId").value;

    let valid = true;
    if (!name) { setFieldError("matNameError", "Material name is required."); valid = false; }
    if (!unit) { setFieldError("matUnitError", "Unit is required."); valid = false; }
    if (min !== null && min < 0) { setFieldError("matMinThresholdError", "Minimum threshold cannot be negative."); valid = false; }

    const duplicate = state.materials.find(m => String(m.materialName || "").trim().toLowerCase() === name.toLowerCase() && m.id !== $("matId").value);
    if (duplicate) { setFieldError("matNameError", "A material with this name already exists in catalog."); valid = false; }
    if (!valid) return;

    $("materialModalSave").disabled = true;
    try {
        const id = $("matId").value;
        if (id) {
            // Update raw_materials master fields (current_stock is never directly modified)
            const { error: updateErr } = await supabase
                .from("raw_materials")
                .update({
                    name,
                    unit_of_measure: unit,
                    minimum_threshold: min,
                    description: category || $("matNotes")?.value?.trim() || null,
                    updated_at: new Date().toISOString()
                })
                .eq("id", id);

            if (updateErr) throw updateErr;
            toast("Material updated successfully.");
        } else {
            // Generate sequential item code if not present
            const existingCodes = state.materials.map(m => m.itemCode).filter(c => c && c.startsWith("RM"));
            let nextIndex = state.materials.length + 1;
            let nextCode = `RM${String(nextIndex).padStart(3, "0")}`;
            while (state.materials.some(m => m.itemCode === nextCode)) {
                nextIndex++;
                nextCode = `RM${String(nextIndex).padStart(3, "0")}`;
            }

            // Insert new master raw_material with current_stock = 0
            const { data: newMat, error: insertErr } = await supabase
                .from("raw_materials")
                .insert({
                    item_code: nextCode,
                    name,
                    unit_of_measure: unit,
                    minimum_threshold: min,
                    description: category || $("matNotes")?.value?.trim() || null,
                    current_stock: 0
                })
                .select()
                .single();

            if (insertErr) throw insertErr;

            // If initial stock was provided, execute through authoritative stock receipt procedure
            if (initialQty > 0 && newMat?.id) {
                const { error: rpcErr } = await supabase.rpc("record_stock_receipt_v2", {
                    p_material_id: newMat.id,
                    p_receipt_date: new Date().toISOString().slice(0, 10),
                    p_quantity: initialQty,
                    p_unit: unit,
                    p_supplier_name: $("matSupplier")?.value?.trim() || "Initial Balance"
                });
                if (rpcErr) {
                    console.warn("Initial receipt RPC error:", rpcErr);
                    toast("Material added, but initial receipt failed: " + rpcErr.message, "error");
                }
            }

            toast("Raw material added successfully.");
        }

        closeMaterialModal();
        await loadData();
        window.dispatchEvent(new CustomEvent("rmims:inventory-changed"));
    } catch (err) {
        console.error(err);
        toast(err.message || "Could not save material.", "error");
    } finally {
        $("materialModalSave").disabled = false;
    }
}

async function openDetails(id) {
    const m = state.materials.find(x => x.id === id);
    if (!m) return;
    const st = statusOf(m);
    $("detailsName").textContent = m.materialName;
    $("detailsStatus").innerHTML = `<span class="status ${st.cls}">${esc(st.label)}</span>`;
    $("detailsCategory").textContent = m.category || "—";
    $("detailsSupplier").textContent = m.supplier || "—";
    $("detailsStock").textContent = fmtQty(m.quantity, m.unit);
    $("detailsMinStock").textContent = m.minimumThreshold !== null && m.minimumThreshold !== undefined ? fmtQty(m.minimumThreshold, m.unit) : "—";
    $("detailsLocation").textContent = m.itemCode ? `Code: ${m.itemCode}` : "—";
    $("detailsUpdated").textContent = m.updatedAt ? new Date(m.updatedAt).toLocaleString() : "—";
    $("detailsNotes").textContent = m.notes || "—";
    $("detailsReceiveBtn").dataset.id = id;
    $("detailsUseBtn").dataset.id = id;
    $("detailsEditBtn").dataset.id = id;

    const history = [
        ...state.receipts.filter(x => x.materialId === id).map(x => ({ date: x.createdAt || x.receivedDate, type: "Received", qty: x.receivedQuantity, unit: x.unit || m.unit, notes: x.supplierName })),
        ...state.usage.filter(x => x.materialId === id).map(x => ({ date: x.createdAt || x.usageDate, type: "Used", qty: x.usedQuantity, unit: x.unit || m.unit, notes: x.productName }))
    ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    $("detailsHistoryList").innerHTML = history.length ? history.slice(0, 10).map(h => `<div class="history-row"><strong>${esc(h.type)}</strong><span>${esc(fmtQty(h.qty, h.unit))}</span><small>${esc(h.date ? new Date(h.date).toLocaleString() : "—")} ${h.notes ? `· ${esc(h.notes)}` : ""}</small></div>`).join("") : `<div class="empty-state"><span>No activity recorded yet.</span></div>`;
    $("detailsOverlay").classList.add("open");
}

/* ==========================================================
   RECEIVE STOCK (AUTHORITATIVE STORED PROCEDURE)
   ========================================================== */

function openReceive(id) {
    const m = state.materials.find(x => x.id === id);
    $("receiveMaterialId").value = id;
    $("receiveQuantity").value = "";
    $("receiveDate").value = new Date().toISOString().slice(0, 10);
    $("receiveNotes").value = "";
    if ($("receiveModalSubtitle")) $("receiveModalSubtitle").textContent = m ? `${m.materialName} (${m.unit || "kg"})` : "—";
    setFieldError("receiveQuantityError");
    $("receiveModalOverlay").classList.add("open");
}

async function saveReceive() {
    const id = $("receiveMaterialId").value;
    const q = num($("receiveQuantity").value);
    const m = state.materials.find(x => x.id === id);
    const date = $("receiveDate").value || new Date().toISOString().slice(0, 10);
    const supplier = $("receiveNotes")?.value?.trim() || null;

    if (!m) {
        toast("Material not found.", "error");
        return;
    }
    if (q <= 0) {
        setFieldError("receiveQuantityError", "Quantity received must be greater than 0.");
        return;
    }

    $("receiveModalSave").disabled = true;
    try {
        const { data, error } = await supabase.rpc("record_stock_receipt_v2", {
            p_material_id: id,
            p_receipt_date: date,
            p_quantity: q,
            p_unit: m.unit || "kg",
            p_supplier_name: supplier
        });

        if (error) throw error;

        $("receiveModalOverlay").classList.remove("open");
        toast("Stock received successfully.");
        await loadData();
        window.dispatchEvent(new CustomEvent("rmims:inventory-changed"));
    } catch (err) {
        console.error("Receive error:", err);
        const msg = String(err.message || err.details || err || "");
        if (msg.includes("Access Denied")) {
            toast("Access Denied: Your account is unauthorized or session expired.", "error");
        } else {
            toast(err.message || "Could not record stock receipt.", "error");
        }
    } finally {
        $("receiveModalSave").disabled = false;
    }
}

/* ==========================================================
   USE STOCK (AUTHORITATIVE STORED PROCEDURE)
   ========================================================== */

function openUse(id) {
    const m = state.materials.find(x => x.id === id);
    $("useMaterialId").value = id;
    $("useQuantity").value = "";
    $("useDate").value = new Date().toISOString().slice(0, 10);
    $("useNotes").value = "";
    if ($("useModalSubtitle")) $("useModalSubtitle").textContent = m ? `${m.materialName} (Available: ${fmtQty(m.quantity, m.unit)})` : "—";
    setFieldError("useQuantityError");
    $("useModalOverlay").classList.add("open");
}

async function saveUse() {
    const id = $("useMaterialId").value;
    const q = num($("useQuantity").value);
    const m = state.materials.find(x => x.id === id);
    const date = $("useDate").value || new Date().toISOString().slice(0, 10);
    const productName = $("useNotes")?.value?.trim() || null;

    if (!m) {
        toast("Material not found.", "error");
        return;
    }
    if (q <= 0) {
        setFieldError("useQuantityError", "Quantity used must be greater than 0.");
        return;
    }
    if (q > num(m.quantity)) {
        setFieldError("useQuantityError", `Cannot disburse more than available stock (${fmtQty(m.quantity, m.unit)}).`);
        return;
    }

    $("useModalSave").disabled = true;
    try {
        const { data, error } = await supabase.rpc("record_material_disbursement_v2", {
            p_material_id: id,
            p_usage_date: date,
            p_quantity: q,
            p_unit: m.unit || "kg",
            p_activity_type: productName ? "Production" : "General Usage",
            p_finished_product_name: productName
        });

        if (error) throw error;

        $("useModalOverlay").classList.remove("open");
        toast("Material usage recorded successfully.");
        await loadData();
        window.dispatchEvent(new CustomEvent("rmims:inventory-changed"));
    } catch (err) {
        console.error("Disbursement error:", err);
        const msg = String(err.message || err.details || err || "");
        if (msg.includes("Insufficient Stock")) {
            toast("Transaction blocked: Insufficient stock recorded in database.", "error");
        } else if (msg.includes("Access Denied")) {
            toast("Access Denied: Your account is unauthorized or session expired.", "error");
        } else {
            toast(err.message || "Could not record material usage.", "error");
        }
    } finally {
        $("useModalSave").disabled = false;
    }
}

/* ==========================================================
   DELETE MATERIAL
   ========================================================== */

async function deleteMaterial(id) {
    const m = state.materials.find(x => x.id === id);
    if (!m) return;
    if (!confirm(`Delete raw material "${m.materialName}"? This cannot be undone.`)) return;
    try {
        const { error } = await supabase.from("raw_materials").delete().eq("id", id);
        if (error) throw error;
        toast("Material deleted.");
        await loadData();
        window.dispatchEvent(new CustomEvent("rmims:inventory-changed"));
    } catch (err) {
        toast(err.message || "Could not delete material.", "error");
    }
}

/* ==========================================================
   IMPORT WORKFLOW (MULTI-TYPE V2 MIGRATION)
   ========================================================== */

let pendingImportRows = [];
let detectedImportType = "MASTER"; // "MASTER" | "RECEIPT" | "USE"

function openImport() {
    $("importFileInput").value = "";
    $("importPreviewArea").innerHTML = "";
    $("importConfirmBtn").disabled = true;
    pendingImportRows = [];
    $("importModalOverlay").classList.add("open");
}

function closeImport() {
    $("importModalOverlay").classList.remove("open");
}

function normHeader(v) {
    return String(v || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function getColVal(row, ...aliases) {
    const map = {};
    Object.entries(row).forEach(([k, v]) => map[normHeader(k)] = v);
    for (const a of aliases) {
        const norm = normHeader(a);
        if (map[norm] !== undefined && map[norm] !== null && map[norm] !== "") {
            const val = map[norm];
            return typeof val === "string" ? val.trim() : val;
        }
    }
    return "";
}

function normalizeImportDate(val) {
    if (!val && val !== 0) return new Date().toISOString().slice(0, 10);

    // 1. Native JavaScript Date object
    if (val instanceof Date && !isNaN(val.getTime())) {
        const y = val.getUTCFullYear();
        const m = String(val.getUTCMonth() + 1).padStart(2, "0");
        const d = String(val.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    const str = String(val).trim();
    if (!str) return new Date().toISOString().slice(0, 10);

    // 2. Excel serial number (numeric, e.g. 46249, 46244, "46249")
    // In Excel 1900 date system, day 1 is 1900-01-01.
    // 25569 days between 1899-12-30 (Excel epoch accounting for 1900 leap bug) and 1970-01-01 (Unix epoch).
    if (/^\d+(\.\d+)?$/.test(str) && !str.includes("-") && !str.includes("/")) {
        const serial = parseFloat(str);
        if (serial > 0 && serial < 2958465) {
            const utcMs = Math.round((serial - 25569) * 86400 * 1000);
            const d = new Date(utcMs);
            if (!isNaN(d.getTime())) {
                const y = d.getUTCFullYear();
                const m = String(d.getUTCMonth() + 1).padStart(2, "0");
                const day = String(d.getUTCDate()).padStart(2, "0");
                return `${y}-${m}-${day}`;
            }
        }
    }

    // 3. ISO Date format YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
    const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (isoMatch) {
        const y = isoMatch[1];
        const m = String(parseInt(isoMatch[2], 10)).padStart(2, "0");
        const day = String(parseInt(isoMatch[3], 10)).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    // 4. US Date format MM/DD/YYYY or M/D/YYYY
    const mdyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (mdyMatch) {
        const m = String(parseInt(mdyMatch[1], 10)).padStart(2, "0");
        const day = String(parseInt(mdyMatch[2], 10)).padStart(2, "0");
        const y = mdyMatch[3];
        return `${y}-${m}-${day}`;
    }

    // 5. General parseable date string
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, "0");
        const d = String(parsed.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    return new Date().toISOString().slice(0, 10);
}

$("importFileInput").addEventListener("change", async () => {
    const file = $("importFileInput").files?.[0];
    if (!file) return;
    try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (!rows.length) throw new Error("The file contains no data rows.");

        pendingImportRows = rows;

        // Automatically detect record type from header columns
        const firstRow = rows[0] || {};
        const headerKeys = Object.keys(firstRow).map(normHeader);

        const hasReceiveHints = headerKeys.some(k => k.includes("receive") || k.includes("receipt") || k.includes("supplier"));
        const hasUseHints = headerKeys.some(k => k.includes("used") || k.includes("consumed") || k.includes("disburse") || k.includes("finished product"));

        if (hasReceiveHints && !hasUseHints) detectedImportType = "RECEIPT";
        else if (hasUseHints && !hasReceiveHints) detectedImportType = "USE";
        else detectedImportType = "MASTER";

        renderImportPreview();
    } catch (err) {
        pendingImportRows = [];
        $("importPreviewArea").innerHTML = `<div class="field-error" style="padding: 12px; color: #dc2626;">${esc(err.message || "Invalid file.")}</div>`;
        $("importConfirmBtn").disabled = true;
    }
});

function renderImportPreview() {
    const container = $("importPreviewArea");
    if (!container || !pendingImportRows.length) return;

    // Type selector controls
    let typeSelectHtml = `
        <div style="margin: 16px 0; padding: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">
            <label style="display: block; font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Selected Import Destination:</label>
            <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                <label style="font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                    <input type="radio" name="importTypeRadio" value="MASTER" ${detectedImportType === "MASTER" ? "checked" : ""}>
                    <strong>Material Master</strong> (Catalog)
                </label>
                <label style="font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                    <input type="radio" name="importTypeRadio" value="RECEIPT" ${detectedImportType === "RECEIPT" ? "checked" : ""}>
                    <strong>Receive Records</strong> (Inflow RPC)
                </label>
                <label style="font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                    <input type="radio" name="importTypeRadio" value="USE" ${detectedImportType === "USE" ? "checked" : ""}>
                    <strong>Usage Records</strong> (Outflow RPC)
                </label>
            </div>
        </div>
    `;

    // Preview table rows
    const previewRows = pendingImportRows.slice(0, 8);
    let tableHeader = "";
    let tableRows = "";

    if (detectedImportType === "MASTER") {
        tableHeader = `<tr><th>Item Code</th><th>Material Name</th><th>Unit</th><th>Min Threshold</th><th>Description</th></tr>`;
        tableRows = previewRows.map(r => `
            <tr>
                <td>${esc(getColVal(r, "item code", "code", "id") || "Auto-generate")}</td>
                <td><strong>${esc(getColVal(r, "material name", "material", "name") || "Missing")}</strong></td>
                <td>${esc(getColVal(r, "unit", "unit of measure") || "kg")}</td>
                <td>${esc(getColVal(r, "minimum stock", "minimum threshold", "min stock") || "—")}</td>
                <td>${esc(getColVal(r, "description", "category", "notes") || "—")}</td>
            </tr>
        `).join("");
    } else if (detectedImportType === "RECEIPT") {
        tableHeader = `<tr><th>Date</th><th>Material</th><th>Received Qty</th><th>Unit</th><th>Supplier</th></tr>`;
        tableRows = previewRows.map(r => `
            <tr>
                <td>${esc(normalizeImportDate(getColVal(r, "receipt date", "date")))}</td>
                <td><strong>${esc(getColVal(r, "material name", "material", "item code") || "Missing")}</strong></td>
                <td>${esc(getColVal(r, "received quantity", "received", "quantity") || "0")}</td>
                <td>${esc(getColVal(r, "unit") || "kg")}</td>
                <td>${esc(getColVal(r, "supplier name", "supplier", "notes") || "Standard Supplier")}</td>
            </tr>
        `).join("");
    } else {
        tableHeader = `<tr><th>Date</th><th>Material</th><th>Used Qty</th><th>Unit</th><th>Finished Product</th></tr>`;
        tableRows = previewRows.map(r => `
            <tr>
                <td>${esc(normalizeImportDate(getColVal(r, "usage date", "date")))}</td>
                <td><strong>${esc(getColVal(r, "material name", "material", "item code") || "Missing")}</strong></td>
                <td>${esc(getColVal(r, "consumed quantity", "used", "quantity") || "0")}</td>
                <td>${esc(getColVal(r, "unit") || "kg")}</td>
                <td>${esc(getColVal(r, "finished product name", "finished product", "product") || "General Usage")}</td>
            </tr>
        `).join("");
    }

    container.innerHTML = `
        ${typeSelectHtml}
        <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #334155;">
            Previewing ${previewRows.length} of ${pendingImportRows.length} rows:
        </div>
        <div class="table-scroll" style="max-height: 220px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
            <table style="width: 100%; font-size: 12px;">
                <thead>${tableHeader}</thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>
    `;

    container.querySelectorAll('input[name="importTypeRadio"]').forEach(radio => {
        radio.addEventListener("change", (e) => {
            detectedImportType = e.target.value;
            renderImportPreview();
        });
    });

    $("importConfirmBtn").disabled = false;
}

$("importConfirmBtn").addEventListener("click", async () => {
    if (!pendingImportRows.length) return;
    $("importConfirmBtn").disabled = true;
    const originalText = $("importConfirmBtn").textContent;
    $("importConfirmBtn").textContent = "Importing...";

    let successCount = 0;
    let errorCount = 0;
    const importErrors = [];

    try {
        if (detectedImportType === "MASTER") {
            for (let i = 0; i < pendingImportRows.length; i++) {
                const row = pendingImportRows[i];
                const rowNum = i + 2;
                const name = String(getColVal(row, "material name", "material", "name") || "").trim();
                if (!name) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum}: Material name is missing.`);
                    continue;
                }
                const unit = String(getColVal(row, "unit", "unit of measure") || "kg").trim();
                const desc = getColVal(row, "description", "category", "notes") || null;
                const minVal = getColVal(row, "minimum stock", "minimum threshold", "min stock");
                const min = minVal !== "" ? num(minVal) : null;
                let itemCode = String(getColVal(row, "item code", "code") || "").trim();

                const existing = state.materials.find(m => String(m.materialName || "").trim().toLowerCase() === name.toLowerCase());

                if (existing) {
                    const { error: upErr } = await supabase.from("raw_materials").update({
                        unit_of_measure: unit,
                        minimum_threshold: min,
                        description: desc,
                        updated_at: new Date().toISOString()
                    }).eq("id", existing.id);
                    if (upErr) {
                        errorCount++;
                        importErrors.push(`Row ${rowNum} (${name}): ${upErr.message || "Update error"}`);
                    } else {
                        successCount++;
                    }
                } else {
                    if (!itemCode) {
                        let nextIndex = state.materials.length + successCount + 1;
                        itemCode = `RM${String(nextIndex).padStart(3, "0")}`;
                    }
                    const { error: inErr } = await supabase.from("raw_materials").insert({
                        item_code: itemCode,
                        name,
                        unit_of_measure: unit,
                        minimum_threshold: min,
                        description: desc,
                        current_stock: 0
                    });
                    if (inErr) {
                        errorCount++;
                        importErrors.push(`Row ${rowNum} (${name}): ${inErr.message || "Insert error"}`);
                    } else {
                        successCount++;
                    }
                }
            }
        } else if (detectedImportType === "RECEIPT") {
            for (let i = 0; i < pendingImportRows.length; i++) {
                const row = pendingImportRows[i];
                const rowNum = i + 2;
                const matIdentifier = String(getColVal(row, "material name", "material", "item code", "name") || "").trim();
                const rawQty = getColVal(row, "received quantity", "received", "quantity");
                const qty = num(rawQty);
                const rawDate = getColVal(row, "receipt date", "date");
                const date = normalizeImportDate(rawDate);
                const unit = String(getColVal(row, "unit") || "").trim();
                const supplier = getColVal(row, "supplier name", "supplier", "notes") || null;

                if (!matIdentifier) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum}: Material identifier is missing.`);
                    continue;
                }

                if (isNaN(qty) || qty <= 0) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum} (${matIdentifier}): Invalid quantity '${rawQty}'. Quantity must be greater than 0.`);
                    continue;
                }

                const mat = state.materials.find(m =>
                    m.id === matIdentifier ||
                    String(m.itemCode || "").toLowerCase() === matIdentifier.toLowerCase() ||
                    String(m.materialName || "").toLowerCase() === matIdentifier.toLowerCase()
                );

                if (!mat) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum}: Material '${matIdentifier}' not found in raw_materials catalog.`);
                    continue;
                }

                if (unit && mat.unit && unit.toLowerCase() !== mat.unit.toLowerCase()) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum} (${mat.materialName}): Unit mismatch. Expected '${mat.unit}', got '${unit}'.`);
                    continue;
                }

                const { error: rpcErr } = await supabase.rpc("record_stock_receipt_v2", {
                    p_material_id: mat.id,
                    p_receipt_date: date,
                    p_quantity: qty,
                    p_unit: unit || mat.unit || "kg",
                    p_supplier_name: supplier
                });

                if (rpcErr) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum} (${mat.materialName}): ${rpcErr.message || "Database transaction error"}`);
                } else {
                    successCount++;
                }
            }
        } else if (detectedImportType === "USE") {
            for (let i = 0; i < pendingImportRows.length; i++) {
                const row = pendingImportRows[i];
                const rowNum = i + 2;
                const matIdentifier = String(getColVal(row, "material name", "material", "item code", "name") || "").trim();
                const rawQty = getColVal(row, "consumed quantity", "used", "quantity");
                const qty = num(rawQty);
                const rawDate = getColVal(row, "usage date", "date");
                const date = normalizeImportDate(rawDate);
                const unit = String(getColVal(row, "unit") || "").trim();
                const prod = getColVal(row, "finished product name", "finished product", "product") || null;

                if (!matIdentifier) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum}: Material identifier is missing.`);
                    continue;
                }

                if (isNaN(qty) || qty <= 0) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum} (${matIdentifier}): Invalid quantity '${rawQty}'. Quantity must be greater than 0.`);
                    continue;
                }

                const mat = state.materials.find(m =>
                    m.id === matIdentifier ||
                    String(m.itemCode || "").toLowerCase() === matIdentifier.toLowerCase() ||
                    String(m.materialName || "").toLowerCase() === matIdentifier.toLowerCase()
                );

                if (!mat) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum}: Material '${matIdentifier}' not found in raw_materials catalog.`);
                    continue;
                }

                if (unit && mat.unit && unit.toLowerCase() !== mat.unit.toLowerCase()) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum} (${mat.materialName}): Unit mismatch. Expected '${mat.unit}', got '${unit}'.`);
                    continue;
                }

                if (num(mat.quantity) < qty) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum} (${mat.materialName}): Insufficient stock. Available: ${mat.quantity} ${mat.unit}, Requested: ${qty} ${mat.unit}.`);
                    continue;
                }

                const { error: rpcErr } = await supabase.rpc("record_material_disbursement_v2", {
                    p_material_id: mat.id,
                    p_usage_date: date,
                    p_quantity: qty,
                    p_unit: unit || mat.unit || "kg",
                    p_activity_type: prod ? "Production" : "General Usage",
                    p_finished_product_name: prod
                });

                if (rpcErr) {
                    errorCount++;
                    importErrors.push(`Row ${rowNum} (${mat.materialName}): ${rpcErr.message || "Database transaction error"}`);
                } else {
                    successCount++;
                }
            }
        }

        closeImport();
        if (errorCount > 0) {
            console.warn("Import errors:", importErrors);
            const errSummary = importErrors.slice(0, 3).join("; ");
            const more = importErrors.length > 3 ? ` (+${importErrors.length - 3} more errors)` : "";
            toast(`Import completed: ${successCount} processed, ${errorCount} errors. ${errSummary}${more}`, "error");
        } else {
            toast(`Import completed: ${successCount} processed, 0 errors.`, "success");
        }
        await loadData();
        window.dispatchEvent(new CustomEvent("rmims:inventory-changed"));
    } catch (err) {
        toast(err.message || "Import failed.", "error");
    } finally {
        $("importConfirmBtn").disabled = false;
        $("importConfirmBtn").textContent = originalText;
    }
});

/* ==========================================================
   EXPORT WORKFLOW
   ========================================================== */

function exportExcel() {
    const rows = state.materials.map(m => ({
        "Item Code": m.itemCode || "",
        "Material Name": m.materialName,
        "Category": m.category,
        "Current Stock": m.quantity,
        "Unit": m.unit,
        "Minimum Stock": m.minimumThreshold !== null ? m.minimumThreshold : "—",
        "Supplier": m.supplier || "",
        "Status": statusOf(m).label
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, "RMIMS-Inventory-V2.xlsx");
}

function exportPdf() {
    if (!window.jspdf) return;
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    pdf.text("RMIMS Inventory Records (V2 Authoritative)", 14, 15);
    pdf.autoTable({
        startY: 22,
        head: [["Item Code", "Material", "Category", "Stock", "Unit", "Min Threshold", "Status"]],
        body: state.materials.map(m => [
            m.itemCode || "—",
            m.materialName,
            m.category,
            m.quantity,
            m.unit,
            m.minimumThreshold !== null ? m.minimumThreshold : "—",
            statusOf(m).label
        ])
    });
    pdf.save("RMIMS-Inventory-V2.pdf");
}

/* ==========================================================
   EVENT LISTENERS & BINDINGS
   ========================================================== */

$("addMaterialBtn").addEventListener("click", () => openModal("materialModalOverlay"));
$("materialModalClose").addEventListener("click", closeMaterialModal);
$("materialModalCancel").addEventListener("click", closeMaterialModal);
$("materialModalOverlay").addEventListener("click", e => { if (e.target === $("materialModalOverlay")) closeMaterialModal(); });
$("materialModalSave").addEventListener("click", saveMaterial);
$("matCategory").addEventListener("change", e => $("matCategoryNewWrap").hidden = e.target.value !== "__new__");

$("inventoryTableBody").addEventListener("click", e => {
    const id = e.target.closest("button")?.dataset.id;
    if (!id) return;
    if (e.target.closest(".mat-view")) openDetails(id);
    else if (e.target.closest(".mat-edit")) openModal("materialModalOverlay", state.materials.find(m => m.id === id));
    else if (e.target.closest(".mat-delete")) deleteMaterial(id);
});

$("detailsClose").addEventListener("click", () => $("detailsOverlay").classList.remove("open"));
$("detailsOverlay").addEventListener("click", e => { if (e.target === $("detailsOverlay")) $("detailsOverlay").classList.remove("open"); });
$("detailsReceiveBtn").addEventListener("click", () => { $("detailsOverlay").classList.remove("open"); openReceive($("detailsReceiveBtn").dataset.id); });
$("detailsUseBtn").addEventListener("click", () => { $("detailsOverlay").classList.remove("open"); openUse($("detailsUseBtn").dataset.id); });
$("detailsEditBtn").addEventListener("click", () => { $("detailsOverlay").classList.remove("open"); openModal("materialModalOverlay", state.materials.find(m => m.id === $("detailsEditBtn").dataset.id)); });

$("receiveModalClose").addEventListener("click", () => $("receiveModalOverlay").classList.remove("open"));
$("receiveModalCancel").addEventListener("click", () => $("receiveModalOverlay").classList.remove("open"));
$("receiveModalSave").addEventListener("click", saveReceive);

$("useModalClose").addEventListener("click", () => $("useModalOverlay").classList.remove("open"));
$("useModalCancel").addEventListener("click", () => $("useModalOverlay").classList.remove("open"));
$("useModalSave").addEventListener("click", saveUse);

$("importBtn").addEventListener("click", openImport);
$("importModalClose").addEventListener("click", closeImport);
$("importModalCancel").addEventListener("click", closeImport);
$("importDropzone").addEventListener("click", () => $("importFileInput").click());
$("exportBtn").addEventListener("click", () => $("exportModalOverlay").classList.add("open"));
$("exportModalClose").addEventListener("click", () => $("exportModalOverlay").classList.remove("open"));
$("exportExcelBtn").addEventListener("click", exportExcel);
$("exportPdfBtn").addEventListener("click", exportPdf);
$("refreshBtn").addEventListener("click", loadData);

$("searchInput").addEventListener("input", e => { state.search = e.target.value; state.page = 1; renderTable(); });
$("categoryFilter").addEventListener("change", e => { state.category = e.target.value; state.page = 1; renderTable(); });
$("statusFilter").addEventListener("change", e => { state.status = e.target.value; state.page = 1; renderTable(); });
$("filterClearBtn").addEventListener("click", () => {
    state.search = ""; state.category = ""; state.status = "";
    $("searchInput").value = ""; $("categoryFilter").value = ""; $("statusFilter").value = "";
    renderTable();
});
$("overviewCards").addEventListener("click", e => {
    const card = e.target.closest("[data-filter]");
    if (!card) return;
    state.status = card.dataset.filter === "all" ? "" : card.dataset.filter;
    $("statusFilter").value = state.status;
    renderTable();
});

window.addEventListener("rmims:inventory-changed", loadData);

/* ==========================================================
   ROLE GUARD & INITIALIZATION
   ========================================================== */

onAuthStateChanged(auth, async user => {
    if (!user) {
        window.location.href = "../login.html";
        return;
    }
    try {
        const { data: profile, error } = await supabase
            .from("user_profiles")
            .select("id, full_name, role, status")
            .eq("id", user.uid)
            .single();

        if (error || !profile || profile.status !== "active") {
            window.location.href = "../login.html";
            return;
        }
        if (profile.role !== "admin") {
            window.location.href = "../user/inventory.html";
            return;
        }

        const pBtn = document.getElementById("profileBtn");
        if (pBtn) {
            const pText = pBtn.querySelector(".profile-text") || pBtn;
            pText.textContent = `${profile.full_name || "Admin"} ▼`;
            const pAv = pBtn.querySelector(".avatar");
            if (pAv && profile.full_name) {
                pAv.textContent = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
            }
        }
    } catch (e) {
        console.warn("Role check failed:", e);
    }
    await loadData();
});
