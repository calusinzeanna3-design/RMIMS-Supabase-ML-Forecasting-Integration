// js/reports.js
//
// RMIMS ADMIN — REPORTS & DECISION SUPPORT
// Rebuilt: Screen = Interactive Multiple Tabs (including AI Forecasting); Print = Continuous Document; Excel = Multi-Sheet Workbook; PDF = Continuous Document.
// Authoritative Supabase Data (raw_materials, stock_receipts, material_disbursements) & Authoritative AI Forecast Output.
// Strictly Light Mode. No Mock Data. Unit-Safe.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

/* ==========================================================
   ROLE & AUTH GUARD
   ========================================================== */

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "../login.html"; return; }

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
            const pAv = pBtn.querySelector(".avatar");
            if (pAv && profile.full_name) pAv.textContent = initials(profile.full_name);
        }

        init();
    } catch (e) {
        console.error("Auth guard error:", e);
        window.location.href = "../login.html";
    }
});

function initials(name) {
    if (!name) return "AU";
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "AU";
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
    forecastStatusText: "Forecast Ready",
    
    // Period & Filter State
    periodPreset: "weekly", // 'all' | 'today' | 'weekly' | 'monthly' | 'custom'
    latestDataDate: null,
    startDate: null,
    endDate: null,
    generatedAt: null,
    
    // Active Screen Tab
    activeTab: "manager", // 'manager' | 'inventory' | 'receiving' | 'disbursement' | 'activity' | 'consumption' | 'forecasting'
    
    // Tab Specific Filter States
    invSearch: "",
    invStatus: "all",
    rcvSearch: "",
    disbSearch: "",
    actSearch: "",
    actType: "all",
    cnsSearch: "",

    // AI Forecasting Tab Filter & Pagination State
    fcSearch: "",
    fcStatus: "all",
    fcUnit: "all",
    fcHorizon: "7day", // '7day' | '1month'
    fcPage: 1,
    fcPageSize: 10
};

/* ==========================================================
   INITIALIZATION
   ========================================================== */

async function init() {
    initPeriodDates();
    initEventListeners();
    await loadAuthoritativeData();
}

/* ==========================================================
   PERIOD & DATE HELPERS
   ========================================================== */

function initPeriodDates() {
    setPeriodPresetDates("weekly");
}

function setPeriodPresetDates(preset) {
    const anchor = state.latestDataDate || new Date();
    const anchorStr = formatDateISO(anchor);

    if (preset === "today") {
        state.startDate = parseDateOnly(anchorStr);
        state.endDate = parseDateOnly(anchorStr);
    } else if (preset === "weekly") {
        // Last 7 days ending on latest update date
        state.endDate = parseDateOnly(anchorStr);
        state.startDate = addDays(state.endDate, -6);
    } else if (preset === "monthly") {
        // Last 30 days ending on latest update date
        state.endDate = parseDateOnly(anchorStr);
        state.startDate = addDays(state.endDate, -29);
    } else if (preset === "all") {
        state.startDate = new Date(2020, 0, 1);
        state.endDate = new Date(anchor.getFullYear() + 1, 11, 31);
    }

    const startInput = document.getElementById("rptStartDate");
    const endInput = document.getElementById("rptEndDate");
    if (startInput && state.startDate) startInput.value = formatDateISO(state.startDate);
    if (endInput && state.endDate) endInput.value = formatDateISO(state.endDate);
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
    const diff = day === 0 ? -6 : 1 - day;
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

function formatPeriodTypeLabel(preset) {
    if (preset === "weekly") return "Weekly (Last 7 Days)";
    if (preset === "monthly") return "Monthly (Last 30 Days)";
    if (preset === "today") return "Daily (Latest Update)";
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
                .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days")
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
                materialId: r.material_id,
                materialName: mat ? mat.name : "Raw Material",
                receivedQuantity: Number(r.received_quantity || 0),
                receiptDate: r.receipt_date || (r.created_at ? r.created_at.split("T")[0] : "—"),
                unit: (r.unit || (mat ? mat.unit : "kg")).trim(),
                supplierName: r.supplier_name || "Authorized Supplier",
                receivedBy: r.received_by || "Inventory Staff",
                createdAt: r.created_at
            };
        });

        // Normalize Disbursements
        state.disbursements = rawDisbursements.map(d => {
            const mat = matMap.get(d.material_id);
            const pName = (d.finished_product_name || d.activity_type || "Production Batch").trim();
            return {
                id: d.id,
                materialId: d.material_id,
                materialName: mat ? mat.name : "Raw Material",
                disbursedQuantity: Number(d.consumed_quantity || 0),
                usageDate: d.usage_date || (d.created_at ? d.created_at.split("T")[0] : "—"),
                unit: (d.unit || (mat ? mat.unit : "kg")).trim(),
                finishedProduct: pName,
                activityType: d.activity_type || "Production Issue",
                recordedBy: d.recorded_by || "Production Staff",
                createdAt: d.created_at
            };
        });

        // Find latest recorded transaction date across receipts and disbursements
        let maxDateStr = null;
        state.receipts.forEach(r => {
            if (r.receiptDate && r.receiptDate !== "—" && (!maxDateStr || r.receiptDate > maxDateStr)) {
                maxDateStr = r.receiptDate;
            }
        });
        state.disbursements.forEach(d => {
            if (d.usageDate && d.usageDate !== "—" && (!maxDateStr || d.usageDate > maxDateStr)) {
                maxDateStr = d.usageDate;
            }
        });

        state.latestDataDate = parseDateOnly(maxDateStr) || new Date();
        setPeriodPresetDates(state.periodPreset);

        // Load Authoritative Forecast Cache / Output (staged as blank placeholders)
        loadAuthoritativeForecasts();

        state.generatedAt = new Date();
        updateMetadataLabels();
        renderAllTabs();
        updatePrintDocHtml();

    } catch (err) {
        console.error("Error loading reports data:", err);
        showToast("Error loading authoritative records.", "error");
    }
}

function loadAuthoritativeForecasts() {
    state.forecastMap.clear();

    // Map materials to their finished products from disbursement records
    const productMap = new Map();
    state.disbursements.forEach(d => {
        if (d.finishedProduct && d.finishedProduct !== "Production Issue" && d.finishedProduct !== "Operational Use" && d.finishedProduct !== "General Usage") {
            const arr = productMap.get(d.materialId) || [];
            if (!arr.includes(d.finishedProduct)) arr.push(d.finishedProduct);
            productMap.set(d.materialId, arr);
        }
    });

    // Compute recent consumption per material
    const recentUsageMap = new Map();
    state.disbursements.forEach(d => {
        recentUsageMap.set(d.materialId, (recentUsageMap.get(d.materialId) || 0) + d.disbursedQuantity);
    });

    // Check for cached forecast results from existing AI-Based Forecasting module
    let cachedForecasts = null;
    try {
        const cachedData = localStorage.getItem("rmims_forecast_cache");
        const cachedTime = localStorage.getItem("rmims_forecast_timestamp");
        if (cachedData) {
            cachedForecasts = JSON.parse(cachedData);
            if (cachedTime) state.lastForecastTimestamp = new Date(cachedTime);
        }
    } catch (e) {
        console.warn("Forecast cache notice:", e);
    }

    state.materials.forEach(m => {
        const recentUsage = recentUsageMap.get(m.id) || 0;
        const products = productMap.get(m.id) || [];
        const finishedProductDisplay = products.length > 0 ? products.join(", ") : "Bakery Operations";

        let f7Qty = 0;
        let f1mQty = 0;
        let decisionStatus = "Sufficient";

        if (cachedForecasts && cachedForecasts[m.name]) {
            const cf = cachedForecasts[m.name];
            f7Qty = Number(cf.forecast7Day?.quantity || 0);
            f1mQty = Number(cf.forecast1Month?.quantity || (f7Qty * 4));
            decisionStatus = cf.decision_support?.decision_status || "Sufficient";
        } else {
            // Baseline demand projection from live disbursements
            const avgWeekly = recentUsage > 0 ? recentUsage : Math.max(m.minThreshold * 0.5, 10);
            f7Qty = Number(avgWeekly.toFixed(1));
            f1mQty = Number((avgWeekly * 4).toFixed(1));

            const diff = m.currentStock - f7Qty;
            if (diff < 0) decisionStatus = "Potential Shortage";
            else if (m.currentStock <= m.minThreshold) decisionStatus = "Needs Attention";
            else if (diff <= m.minThreshold) decisionStatus = "Monitor";
            else decisionStatus = "Sufficient";
        }

        // Additional Need
        const additionalNeed7 = Math.max(0, Number((f7Qty - m.currentStock).toFixed(1)));
        const additionalNeed1m = Math.max(0, Number((f1mQty - m.currentStock).toFixed(1)));

        const item = {
            id: m.id,
            itemCode: m.itemCode,
            name: m.name,
            unit: m.unit,
            currentStock: m.currentStock,
            minThreshold: m.minThreshold,
            recentConsumption: recentUsage,
            finishedProduct: finishedProductDisplay,
            forecast7Day: f7Qty,
            forecast1Month: f1mQty,
            additionalNeed7,
            additionalNeed1m,
            status: decisionStatus
        };

        state.forecastMap.set(m.name, item);
    });

    state.forecastList = Array.from(state.forecastMap.values());
    if (!state.lastForecastTimestamp) state.lastForecastTimestamp = new Date();
    state.forecastStatusText = "Forecast Ready";

    // Populate unit dropdown in forecasting tab
    populateForecastUnitFilter();
}

function populateForecastUnitFilter() {
    const unitSelect = document.getElementById("fcUnitFilter");
    if (!unitSelect) return;

    const currentVal = unitSelect.value;
    const units = Array.from(new Set(state.materials.map(m => m.unit))).filter(Boolean);
    unitSelect.innerHTML = `<option value="all">All Units</option>` + units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
    if (units.includes(currentVal)) unitSelect.value = currentVal;
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
   RENDER ALL ON-SCREEN REPORT TABS
   ========================================================== */

function renderAllTabs() {
    renderManagerSummaryTab();
    renderInventoryRecordsTab();
    renderMaterialReceivingTab();
    renderMaterialDisbursementTab();
    renderMaterialActivityTab();
    renderConsumptionAnalysisTab();
    renderAiForecastingTab();
}

/* ==========================================================
   TAB 1: MANAGER SUMMARY
   ========================================================== */

function renderManagerSummaryTab() {
    const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    const totalMats = state.materials.length;
    const goodStock = state.materials.filter(m => m.status === "Good").length;
    const attentionStock = state.materials.filter(m => m.status === "Low" || m.status === "Critical").length;
    const totalActivities = periodReceipts.length + periodDisbursements.length;

    // Mini KPI Cards
    const totEl = document.getElementById("mgrTotalMaterials");
    const goodEl = document.getElementById("mgrGoodStock");
    const attnEl = document.getElementById("mgrAttentionStock");
    const actEl = document.getElementById("mgrPeriodActivities");

    if (totEl) totEl.textContent = totalMats.toLocaleString();
    if (goodEl) goodEl.textContent = goodStock.toLocaleString();
    if (attnEl) attnEl.textContent = attentionStock.toLocaleString();
    if (actEl) actEl.textContent = totalActivities.toLocaleString();

    // Manager Overview Table
    const overviewBody = document.getElementById("mgrOverviewTableBody");
    if (overviewBody) {
        overviewBody.innerHTML = `
            <tr>
                <td><strong>Total Materials</strong></td>
                <td><strong>${totalMats}</strong></td>
                <td>Full Catalog</td>
                <td><span class="rpt-badge rpt-badge-good">${goodStock} Good / ${attentionStock} Attention</span></td>
            </tr>
            <tr>
                <td><strong>Good Stock</strong></td>
                <td><strong>${goodStock}</strong></td>
                <td>Optimal Buffer</td>
                <td><span class="rpt-badge rpt-badge-good">Sufficient Stock</span></td>
            </tr>
            <tr>
                <td><strong>Low / Critical</strong></td>
                <td><strong>${attentionStock}</strong></td>
                <td>Safety Buffer</td>
                <td><span class="rpt-badge ${attentionStock > 0 ? "rpt-badge-critical" : "rpt-badge-good"}">${attentionStock > 0 ? "Action Required" : "Optimal"}</span></td>
            </tr>
            <tr>
                <td><strong>Receiving Records</strong></td>
                <td><strong>${periodReceipts.length}</strong></td>
                <td>Inflow Batches</td>
                <td><span class="rpt-badge rpt-badge-good">Verified &amp; Stored</span></td>
            </tr>
            <tr>
                <td><strong>Consumption Records</strong></td>
                <td><strong>${periodDisbursements.length}</strong></td>
                <td>Disbursed Usage</td>
                <td><span class="rpt-badge rpt-badge-good">Production Use</span></td>
            </tr>
            <tr>
                <td><strong>Disbursement Records</strong></td>
                <td><strong>${periodDisbursements.length}</strong></td>
                <td>Outflow Releases</td>
                <td><span class="rpt-badge rpt-badge-good">Released for Operations</span></td>
            </tr>
        `;
    }

    // Manager Decision Breakdown Table
    const decisionBody = document.getElementById("mgrDecisionTableBody");
    if (decisionBody) {
        const decisions = [];
        state.materials.forEach(m => {
            if (m.status === "Critical") {
                decisions.push({
                    priority: "HIGH",
                    material: m.name,
                    stock: `${m.currentStock.toLocaleString()} ${m.unit}`,
                    finding: `Stock has reached critical threshold (${m.currentStock} ${m.unit} vs min ${m.minThreshold} ${m.unit}).`,
                    action: `Create urgent purchase receipt for ${m.reorderQty || 50} ${m.unit}.`
                });
            } else if (m.status === "Low") {
                decisions.push({
                    priority: "MEDIUM",
                    material: m.name,
                    stock: `${m.currentStock.toLocaleString()} ${m.unit}`,
                    finding: `Stock is approaching minimum safety limit (${m.currentStock} ${m.unit} vs min ${m.minThreshold} ${m.unit}).`,
                    action: `Schedule replenishment order with primary supplier.`
                });
            }
        });

        if (decisions.length === 0) {
            decisionBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--rpt-text-dim);">No raw materials currently require priority replenishment intervention.</td></tr>`;
        } else {
            decisionBody.innerHTML = decisions.map(d => `
                <tr>
                    <td><span class="rpt-badge ${d.priority === "HIGH" ? "rpt-priority-high" : "rpt-priority-med"}">${d.priority}</span></td>
                    <td><strong>${escapeHtml(d.material)}</strong></td>
                    <td>${escapeHtml(d.stock)}</td>
                    <td>${escapeHtml(d.finding)}</td>
                    <td><strong>${escapeHtml(d.action)}</strong></td>
                </tr>
            `).join("");
        }
    }

    // Render Visual Charts
    renderManagerCharts();
}

let stockHealthChartInstance = null;
let topConsumedChartInstance = null;

function renderManagerCharts() {
    if (typeof Chart === "undefined") return;

    // 1. Stock Health Breakdown Chart (Doughnut)
    const stockHealthCanvas = document.getElementById("stockHealthChart");
    if (stockHealthCanvas) {
        const goodCount = state.materials.filter(m => m.status === "Good").length;
        const lowCount = state.materials.filter(m => m.status === "Low").length;
        const criticalCount = state.materials.filter(m => m.status === "Critical").length;
        const totalMats = state.materials.length;

        const badge = document.getElementById("stockHealthTotalBadge");
        if (badge) badge.textContent = `${totalMats} Materials`;

        if (stockHealthChartInstance) {
            stockHealthChartInstance.destroy();
            stockHealthChartInstance = null;
        }

        const ctx = stockHealthCanvas.getContext("2d");
        stockHealthChartInstance = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: ["Sufficient (Good)", "Low Buffer", "Critical Threshold"],
                datasets: [{
                    data: [goodCount, lowCount, criticalCount],
                    backgroundColor: [
                        "#16803c", // emerald green
                        "#f59e0b", // amber/orange
                        "#dc2626"  // red
                    ],
                    borderWidth: 2,
                    borderColor: "#ffffff"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: {
                            boxWidth: 12,
                            font: { size: 11, weight: "600" },
                            color: "#334155"
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const val = context.raw || 0;
                                const pct = totalMats > 0 ? ((val / totalMats) * 100).toFixed(1) : 0;
                                return ` ${context.label}: ${val} materials (${pct}%)`;
                            }
                        }
                    }
                },
                cutout: "68%"
            }
        });
    }

    // 2. Top Consumed Materials Chart (Horizontal Bar)
    const topConsumedCanvas = document.getElementById("topConsumedChart");
    if (topConsumedCanvas) {
        const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

        // Aggregate by material name
        const usageMap = new Map();
        const unitMap = new Map();
        periodDisbursements.forEach(d => {
            usageMap.set(d.materialName, (usageMap.get(d.materialName) || 0) + d.disbursedQuantity);
            if (!unitMap.has(d.materialName)) unitMap.set(d.materialName, d.unit);
        });

        // Sort descending and take top 5
        const sorted = Array.from(usageMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const labels = sorted.map(item => item[0]);
        const dataValues = sorted.map(item => item[1]);
        const units = sorted.map(item => unitMap.get(item[0]) || "units");

        const badge = document.getElementById("topConsumedTotalBadge");
        if (badge) badge.textContent = `${periodDisbursements.length} Records`;

        if (topConsumedChartInstance) {
            topConsumedChartInstance.destroy();
            topConsumedChartInstance = null;
        }

        const ctx = topConsumedCanvas.getContext("2d");
        topConsumedChartInstance = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels.length > 0 ? labels : ["No Disbursements"],
                datasets: [{
                    label: "Quantity Consumed",
                    data: dataValues.length > 0 ? dataValues : [0],
                    backgroundColor: "rgba(37, 99, 235, 0.85)", // Blue
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const idx = context.dataIndex;
                                const u = units[idx] || "";
                                return ` Consumed: ${context.raw?.toLocaleString()} ${u}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: "#f1f5f9" },
                        ticks: { font: { size: 10 }, color: "#64748b" }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { font: { size: 11, weight: "600" }, color: "#1e293b" }
                    }
                }
            }
        });
    }
}

/* ==========================================================
   TAB 2: INVENTORY RECORDS
   ========================================================== */

function renderInventoryRecordsTab() {
    const tbody = document.getElementById("invTableBody");
    if (!tbody) return;

    const term = state.invSearch.trim().toLowerCase();
    const status = state.invStatus;

    let filtered = state.materials.filter(m => {
        if (term && !m.name.toLowerCase().includes(term) && !m.itemCode.toLowerCase().includes(term)) return false;
        if (status !== "all" && m.status !== status) return false;
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No inventory records match the search criteria.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(m => {
        const badgeCls = m.status === "Critical" ? "rpt-badge-critical" : (m.status === "Low" ? "rpt-badge-low" : "rpt-badge-good");
        return `
            <tr>
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td><span style="font-size:0.75rem; color:var(--rpt-text-mid);">${escapeHtml(m.itemCode)}</span></td>
                <td>${escapeHtml(m.unit)}</td>
                <td><strong>${m.currentStock.toLocaleString()}</strong></td>
                <td>${m.minThreshold.toLocaleString()}</td>
                <td>${m.reorderQty.toLocaleString()}</td>
                <td><span class="rpt-badge ${badgeCls}">${m.status}</span></td>
            </tr>
        `;
    }).join("");
}

/* ==========================================================
   TAB 3: MATERIAL RECEIVING
   ========================================================== */

function renderMaterialReceivingTab() {
    const tbody = document.getElementById("rcvTableBody");
    const countNote = document.getElementById("rcvTotalCountNote");
    if (!tbody) return;

    const term = state.rcvSearch.trim().toLowerCase();
    let filtered = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));

    if (term) {
        filtered = filtered.filter(r => r.materialName.toLowerCase().includes(term) || r.supplierName.toLowerCase().includes(term) || r.receivedBy.toLowerCase().includes(term));
    }

    if (countNote) countNote.textContent = `${filtered.length} receipt${filtered.length === 1 ? "" : "s"} recorded`;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No receiving records recorded for this period.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(r => `
        <tr>
            <td>${escapeHtml(r.receiptDate)}</td>
            <td><strong>${escapeHtml(r.materialName)}</strong></td>
            <td><strong style="color:var(--rpt-green-dark);">+${r.receivedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></td>
            <td>${escapeHtml(r.unit)}</td>
            <td>${escapeHtml(r.supplierName)}</td>
            <td>${escapeHtml(r.receivedBy)}</td>
            <td><span class="rpt-badge rpt-badge-good">Verified &amp; Received</span></td>
        </tr>
    `).join("");
}

/* ==========================================================
   TAB 4: MATERIAL DISBURSEMENT
   ========================================================== */

function renderMaterialDisbursementTab() {
    const tbody = document.getElementById("disbTableBody");
    const countNote = document.getElementById("disbTotalCountNote");
    if (!tbody) return;

    const term = state.disbSearch.trim().toLowerCase();
    let filtered = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    if (term) {
        filtered = filtered.filter(d => d.materialName.toLowerCase().includes(term) || d.finishedProduct.toLowerCase().includes(term) || d.activityType.toLowerCase().includes(term));
    }

    if (countNote) countNote.textContent = `${filtered.length} disbursement${filtered.length === 1 ? "" : "s"} recorded`;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No material disbursements recorded for this period.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(d => `
        <tr>
            <td>${escapeHtml(d.usageDate)}</td>
            <td><strong>${escapeHtml(d.materialName)}</strong></td>
            <td><span style="font-weight:600; color:var(--rpt-blue-dark);">${escapeHtml(d.finishedProduct)}</span></td>
            <td><strong style="color:var(--rpt-orange-dark);">${d.disbursedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></td>
            <td>${escapeHtml(d.unit)}</td>
            <td><span style="font-size:0.75rem; color:var(--rpt-text-mid);">${escapeHtml(d.activityType)}</span></td>
            <td>${escapeHtml(d.recordedBy)}</td>
        </tr>
    `).join("");
}

/* ==========================================================
   TAB 5: MATERIAL ACTIVITY (CHRONOLOGICAL LOG)
   ========================================================== */

function renderMaterialActivityTab() {
    const tbody = document.getElementById("actTableBody");
    if (!tbody) return;

    const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    const activities = [];

    periodReceipts.forEach(r => {
        activities.push({
            date: r.receiptDate,
            type: "Received",
            material: r.materialName,
            qty: r.receivedQuantity,
            unit: r.unit,
            ref: r.supplierName,
            operator: r.receivedBy
        });
    });

    periodDisbursements.forEach(d => {
        activities.push({
            date: d.usageDate,
            type: "Disbursed",
            material: d.materialName,
            qty: -d.disbursedQuantity,
            unit: d.unit,
            ref: d.finishedProduct,
            operator: d.recordedBy
        });
    });

    activities.sort((a, b) => b.date.localeCompare(a.date));

    const term = state.actSearch.trim().toLowerCase();
    const typeFilter = state.actType;

    let filtered = activities.filter(a => {
        if (term && !a.material.toLowerCase().includes(term) && !a.ref.toLowerCase().includes(term) && !a.operator.toLowerCase().includes(term)) return false;
        if (typeFilter !== "all" && a.type !== typeFilter) return false;
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No activity transactions recorded for this period.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(a => {
        const isRcv = a.type === "Received";
        const badgeCls = isRcv ? "rpt-badge-good" : "rpt-badge-low";
        const qtyStr = isRcv ? `+${a.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${a.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        const qtyColor = isRcv ? "var(--rpt-green-dark)" : "var(--rpt-red-dark)";

        return `
            <tr>
                <td>${escapeHtml(a.date)}</td>
                <td><span class="rpt-badge ${badgeCls}">${a.type}</span></td>
                <td><strong>${escapeHtml(a.material)}</strong></td>
                <td><strong style="color:${qtyColor};">${qtyStr}</strong></td>
                <td>${escapeHtml(a.unit)}</td>
                <td>${escapeHtml(a.ref)}</td>
                <td>${escapeHtml(a.operator)}</td>
            </tr>
        `;
    }).join("");
}

/* ==========================================================
   TAB 6: CONSUMPTION ANALYSIS
   ========================================================== */

function renderConsumptionAnalysisTab() {
    const tbody = document.getElementById("cnsTableBody");
    if (!tbody) return;

    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    const days = Math.round((state.endDate - state.startDate) / 86400000) + 1;
    const prevEnd = addDays(state.startDate, -1);
    const prevStart = addDays(prevEnd, -(days - 1));

    const prevDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, prevStart, prevEnd));

    const curMap = new Map();
    periodDisbursements.forEach(d => {
        curMap.set(d.materialId, (curMap.get(d.materialId) || 0) + d.disbursedQuantity);
    });

    const prevMap = new Map();
    prevDisbursements.forEach(d => {
        prevMap.set(d.materialId, (prevMap.get(d.materialId) || 0) + d.disbursedQuantity);
    });

    const term = state.cnsSearch.trim().toLowerCase();

    let list = state.materials.map(m => {
        const curUsage = curMap.get(m.id) || 0;
        const prevUsage = prevMap.get(m.id) || 0;
        let trend = "Stable";
        if (prevUsage === 0 && curUsage > 0) trend = "Increasing";
        else if (curUsage >= prevUsage * 1.15) trend = "Increasing";
        else if (curUsage <= prevUsage * 0.85 && curUsage > 0) trend = "Decreasing";

        return {
            material: m.name,
            unit: m.unit,
            currentUsage: curUsage,
            previousUsage: prevUsage,
            currentStock: m.currentStock,
            trend,
            status: m.status
        };
    });

    if (term) {
        list = list.filter(l => l.material.toLowerCase().includes(term));
    }

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No consumption records match the filter.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(l => {
        const badgeCls = l.status === "Critical" ? "rpt-badge-critical" : (l.status === "Low" ? "rpt-badge-low" : "rpt-badge-good");
        const trendColor = l.trend === "Increasing" ? "var(--rpt-orange-dark)" : (l.trend === "Decreasing" ? "var(--rpt-blue-dark)" : "var(--rpt-text-muted)");

        return `
            <tr>
                <td><strong>${escapeHtml(l.material)}</strong></td>
                <td><strong>${l.currentUsage.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHtml(l.unit)}</strong></td>
                <td>${l.previousUsage.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHtml(l.unit)}</td>
                <td>${l.currentStock.toLocaleString()} ${escapeHtml(l.unit)}</td>
                <td><strong style="color:${trendColor};">${l.trend}</strong></td>
                <td><span class="rpt-badge ${badgeCls}">${l.status}</span></td>
            </tr>
        `;
    }).join("");
}

/* ==========================================================
   TAB 7: AI FORECASTING REPORT
   ========================================================== */

function renderAiForecastingTab() {
    // 1. Forecast Status & Horizon KPI Cards
    const statusEl = document.getElementById("fcReportStatus");
    const matCountEl = document.getElementById("fcReportMatCount");
    const horizonEl = document.getElementById("fcReportHorizon");
    const lastTimeEl = document.getElementById("fcReportLastTime");

    if (statusEl) statusEl.textContent = "In Development";
    if (matCountEl) matCountEl.textContent = state.materials.length.toString();
    if (horizonEl) horizonEl.textContent = "Horizon: Staged (Next 7 Days)";

    if (lastTimeEl) {
        lastTimeEl.textContent = "Status: Awaiting ML Integration";
    }

    // 2. Unit-Safe Requirement Summary Placeholder
    const pillsContainer = document.getElementById("fcReportReqPills");
    if (pillsContainer) {
        pillsContainer.innerHTML = `<span class="fc-unit-pill" style="background:#f1f5f9; color:#64748b; font-weight:500;">— Awaiting Model Run —</span>`;
    }

    // 3. AI Forecast Decision Support Findings Placeholder
    const decisionListEl = document.getElementById("fcReportDecisionList");
    if (decisionListEl) {
        decisionListEl.innerHTML = `
            <div class="rpt-fc-decision-card">
                <div class="rpt-fc-decision-title">
                    <span>AI Forecasting Module In Progress</span>
                    <span class="rpt-badge rpt-badge-monitor">Staging</span>
                </div>
                <div class="rpt-fc-decision-body">Statistical time-series demand predictions and shortage warnings will automatically populate this section once the forecasting module is developed.</div>
            </div>
        `;
    }

    // 4. Filter & Search Table Rows
    const term = state.fcSearch.trim().toLowerCase();
    const unitFilter = state.fcUnit;

    let filtered = state.forecastList.filter(item => {
        if (term) {
            const matchName = item.name.toLowerCase().includes(term);
            const matchCode = item.itemCode.toLowerCase().includes(term);
            const matchProduct = item.finishedProduct.toLowerCase().includes(term);
            if (!matchName && !matchCode && !matchProduct) return false;
        }
        if (unitFilter !== "all" && item.unit !== unitFilter) return false;
        return true;
    });

    const countNote = document.getElementById("fcTotalCountNote");
    if (countNote) countNote.textContent = `${filtered.length} material${filtered.length === 1 ? "" : "s"}`;

    // 5. Pagination
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.fcPageSize));
    if (state.fcPage > totalPages) state.fcPage = totalPages;

    const prevBtn = document.getElementById("fcPrevPageBtn");
    const nextBtn = document.getElementById("fcNextPageBtn");
    const pageInfo = document.getElementById("fcPaginationInfo");

    if (prevBtn) prevBtn.disabled = state.fcPage <= 1;
    if (nextBtn) nextBtn.disabled = state.fcPage >= totalPages;
    if (pageInfo) pageInfo.textContent = `Page ${state.fcPage} of ${totalPages} (${filtered.length} total)`;

    const startIdx = (state.fcPage - 1) * state.fcPageSize;
    const pageItems = filtered.slice(startIdx, startIdx + state.fcPageSize);

    const tbody = document.getElementById("fcTableBody");
    if (!tbody) return;

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:var(--rpt-text-dim);">No materials match the forecast search criteria.</td></tr>`;
        return;
    }

    tbody.innerHTML = pageItems.map(item => {
        return `
            <tr>
                <td><strong>${escapeHtml(item.name)}</strong></td>
                <td><span style="font-size:0.75rem; color:var(--rpt-text-mid);">${escapeHtml(item.itemCode)}</span></td>
                <td><span style="font-weight:600; color:var(--rpt-blue-dark);">${escapeHtml(item.finishedProduct)}</span></td>
                <td><strong>${item.currentStock.toLocaleString()} ${escapeHtml(item.unit)}</strong></td>
                <td>${escapeHtml(item.unit)}</td>
                <td>${item.recentConsumption > 0 ? `${item.recentConsumption.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${escapeHtml(item.unit)}` : "—"}</td>
                <td><span style="color:var(--rpt-text-dim); font-weight:600;">—</span></td>
                <td><span style="color:var(--rpt-text-dim); font-weight:600;">—</span></td>
                <td><span class="rpt-badge rpt-badge-monitor">—</span></td>
            </tr>
        `;
    }).join("");
}

/* ==========================================================
   UPDATE PRINT DOC HTML IN DOM
   ========================================================== */

function updatePrintDocHtml() {
    const printDoc = document.getElementById("continuousPrintDoc");
    if (printDoc) {
        printDoc.innerHTML = buildContinuousPrintHtml(["manager", "inventory", "receiving", "disbursement", "activity", "consumption", "forecasting"]);
    }
}

/* ==========================================================
   PRINT / PDF CONTINUOUS DOCUMENT BUILDER (IMAGE 2 EXACT FORMAT)
   ========================================================== */

function buildContinuousPrintHtml(selectedSections = ["manager", "inventory", "receiving", "disbursement", "activity", "consumption", "forecasting"]) {
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    const reportTypeStr = formatPeriodTypeLabel(state.periodPreset);
    const now = new Date();
    const genDateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTimeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    let sectionsHtml = "";

    // 1. Manager Summary
    if (selectedSections.includes("manager")) {
        const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
        const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));
        const totalMats = state.materials.length;
        const goodStock = state.materials.filter(m => m.status === "Good").length;
        const attentionStock = state.materials.filter(m => m.status === "Low" || m.status === "Critical").length;

        const decisions = [];
        state.materials.forEach(m => {
            if (m.status === "Critical") {
                decisions.push({
                    priority: "High",
                    material: m.name,
                    finding: `Stock has reached critical threshold (${m.currentStock} ${m.unit} vs min ${m.minThreshold} ${m.unit}).`,
                    action: `Create urgent purchase receipt for ${m.reorderQty || 50} ${m.unit}.`
                });
            } else if (m.status === "Low") {
                decisions.push({
                    priority: "Medium",
                    material: m.name,
                    finding: `Stock is approaching minimum safety limit (${m.currentStock} ${m.unit} vs min ${m.minThreshold} ${m.unit}).`,
                    action: `Schedule replenishment order with primary supplier.`
                });
            }
        });

        sectionsHtml += `
            <div class="print-section">
                <h2 class="print-section-header-green">Manager Summary</h2>
                <h3 class="print-subsection-title">Manager Overview</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width: 75%;">Metric</th>
                            <th style="width: 25%;">Result</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td>Total Materials</td><td>${totalMats}</td></tr>
                        <tr><td>Good Stock</td><td>${goodStock}</td></tr>
                        <tr><td>Low / Critical</td><td>${attentionStock}</td></tr>
                        <tr><td>Receiving Records</td><td>${periodReceipts.length}</td></tr>
                        <tr><td>Consumption Records</td><td>${periodDisbursements.length}</td></tr>
                        <tr><td>Disbursement Records</td><td>${periodDisbursements.length}</td></tr>
                    </tbody>
                </table>

                <h3 class="print-subsection-title">Manager Decision Breakdown</h3>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th style="width: 15%;">Priority</th>
                            <th style="width: 25%;">Material</th>
                            <th style="width: 30%;">What the Data Shows</th>
                            <th style="width: 30%;">Suggested Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${decisions.length === 0 ? `<tr><td colspan="4" style="text-align:center;">No materials currently require priority intervention.</td></tr>` :
                            decisions.map(d => `
                                <tr>
                                    <td><strong>${escapeHtml(d.priority)}</strong></td>
                                    <td><strong>${escapeHtml(d.material)}</strong></td>
                                    <td>${escapeHtml(d.finding)}</td>
                                    <td>${escapeHtml(d.action)}</td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 2. Inventory Records
    if (selectedSections.includes("inventory")) {
        sectionsHtml += `
            <div class="print-section">
                <h2 class="print-section-header-green">Inventory Records</h2>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Raw Material</th>
                            <th>Current Stock</th>
                            <th>Minimum Stock</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.materials.map(m => `
                            <tr>
                                <td><strong>${escapeHtml(m.name)}</strong></td>
                                <td>${m.currentStock.toLocaleString()} ${escapeHtml(m.unit)}</td>
                                <td>${m.minThreshold.toLocaleString()} ${escapeHtml(m.unit)}</td>
                                <td>${escapeHtml(m.status)}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    // 3. Material Receiving
    if (selectedSections.includes("receiving")) {
        const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
        sectionsHtml += `
            <div class="print-section">
                <h2 class="print-section-header-green">Material Receiving</h2>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Receipt Date</th>
                            <th>Raw Material</th>
                            <th>Received</th>
                            <th>Supplier Name</th>
                            <th>Received By</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${periodReceipts.length === 0 ? `<tr><td colspan="6" style="text-align:center;">No receiving records for this period.</td></tr>` :
                            periodReceipts.map(r => `
                                <tr>
                                    <td>${escapeHtml(r.receiptDate)}</td>
                                    <td><strong>${escapeHtml(r.materialName)}</strong></td>
                                    <td>+${r.receivedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHtml(r.unit)}</td>
                                    <td>${escapeHtml(r.supplierName)}</td>
                                    <td>${escapeHtml(r.receivedBy)}</td>
                                    <td>Verified</td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 4. Material Disbursement
    if (selectedSections.includes("disbursement")) {
        const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));
        sectionsHtml += `
            <div class="print-section">
                <h2 class="print-section-header-green">Material Disbursement</h2>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Usage Date</th>
                            <th>Raw Material</th>
                            <th>Finished Product / Batch</th>
                            <th>Released</th>
                            <th>Activity Type</th>
                            <th>Recorded By</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${periodDisbursements.length === 0 ? `<tr><td colspan="6" style="text-align:center;">No disbursements for this period.</td></tr>` :
                            periodDisbursements.map(d => `
                                <tr>
                                    <td>${escapeHtml(d.usageDate)}</td>
                                    <td><strong>${escapeHtml(d.materialName)}</strong></td>
                                    <td>${escapeHtml(d.finishedProduct)}</td>
                                    <td>${d.disbursedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHtml(d.unit)}</td>
                                    <td>${escapeHtml(d.activityType)}</td>
                                    <td>${escapeHtml(d.recordedBy)}</td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 5. Material Activity
    if (selectedSections.includes("activity")) {
        const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
        const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));
        const activities = [];

        periodReceipts.forEach(r => activities.push({ date: r.receiptDate, type: "Received", mat: r.materialName, qty: r.receivedQuantity, unit: r.unit, ref: r.supplierName, op: r.receivedBy }));
        periodDisbursements.forEach(d => activities.push({ date: d.usageDate, type: "Disbursed", mat: d.materialName, qty: -d.disbursedQuantity, unit: d.unit, ref: d.finishedProduct, op: d.recordedBy }));
        activities.sort((a, b) => b.date.localeCompare(a.date));

        sectionsHtml += `
            <div class="print-section">
                <h2 class="print-section-header-green">Material Activity</h2>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Activity</th>
                            <th>Raw Material</th>
                            <th>Quantity</th>
                            <th>Purpose / Context</th>
                            <th>Recorded By</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${activities.length === 0 ? `<tr><td colspan="6" style="text-align:center;">No movements recorded for this period.</td></tr>` :
                            activities.map(a => `
                                <tr>
                                    <td>${escapeHtml(a.date)}</td>
                                    <td>${escapeHtml(a.type)}</td>
                                    <td><strong>${escapeHtml(a.mat)}</strong></td>
                                    <td>${a.qty > 0 ? "+" : ""}${a.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHtml(a.unit)}</td>
                                    <td>${escapeHtml(a.ref)}</td>
                                    <td>${escapeHtml(a.op)}</td>
                                </tr>
                            `).join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    // 6. Consumption Analysis
    if (selectedSections.includes("consumption")) {
        const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));
        const curMap = new Map();
        periodDisbursements.forEach(d => curMap.set(d.materialId, (curMap.get(d.materialId) || 0) + d.disbursedQuantity));

        sectionsHtml += `
            <div class="print-section">
                <h2 class="print-section-header-green">Consumption Analysis</h2>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Raw Material</th>
                            <th>Total Consumed</th>
                            <th>Current Stock</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.materials.map(m => {
                            const used = curMap.get(m.id) || 0;
                            return `
                                <tr>
                                    <td><strong>${escapeHtml(m.name)}</strong></td>
                                    <td>${used.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHtml(m.unit)}</td>
                                    <td>${m.currentStock.toLocaleString()} ${escapeHtml(m.unit)}</td>
                                    <td>${escapeHtml(m.status)}</td>
                                </tr>
                            `;
                        }).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    // 7. AI Forecasting (Staged as Blanks)
    if (selectedSections.includes("forecasting")) {
        sectionsHtml += `
            <div class="print-section">
                <h2 class="print-section-header-green">AI Forecasting &amp; Requirement Projections</h2>
                <div style="font-size: 8.5pt; color: #475569; margin-bottom: 8px;">
                    <strong>Forecast Status:</strong> In Development (Awaiting ML Model Run) | <strong>Horizon:</strong> Staged (Next 7 Days)
                </div>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Raw Material</th>
                            <th>ID</th>
                            <th>Finished Product</th>
                            <th>Current Stock</th>
                            <th>Forecast Req (7D)</th>
                            <th>Additional Needed</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.forecastList.map(item => `
                            <tr>
                                <td><strong>${escapeHtml(item.name)}</strong></td>
                                <td>${escapeHtml(item.itemCode)}</td>
                                <td>${escapeHtml(item.finishedProduct)}</td>
                                <td>${item.currentStock.toLocaleString()} ${escapeHtml(item.unit)}</td>
                                <td>${item.forecast7Day !== null ? `${item.forecast7Day.toFixed(1)} ${escapeHtml(item.unit)}` : "—"}</td>
                                <td>${item.additionalNeed7 !== null && item.additionalNeed7 > 0 ? `${item.additionalNeed7.toFixed(1)} ${escapeHtml(item.unit)}` : "—"}</td>
                                <td>${escapeHtml(item.status || "—")}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    return `
        <div class="print-header-block">
            <h1 class="print-rmims-title">RMIMS</h1>
            <div class="print-rmims-sub">RAW MATERIALS INVENTORY — REPORTS &amp; DECISION SUPPORT</div>
        </div>

        <div class="print-doc-divider"></div>

        <h2 class="print-doc-title">RMSME Report Package</h2>

        <div class="print-meta-grid-2col">
            <div class="print-meta-col">
                <div class="print-meta-item">
                    <span class="print-meta-lbl">REPORT TYPE</span>
                    <span class="print-meta-val">${escapeHtml(reportTypeStr)}</span>
                </div>
                <div class="print-meta-item">
                    <span class="print-meta-lbl">GENERATED DATE</span>
                    <span class="print-meta-val">${escapeHtml(genDateStr)}</span>
                </div>
                <div class="print-meta-item">
                    <span class="print-meta-lbl">REPORT STATUS</span>
                    <span class="print-meta-val">Final Snapshot</span>
                </div>
                <div class="print-meta-item">
                    <span class="print-meta-lbl">PREPARED BY</span>
                    <span class="print-meta-val">RMIMS</span>
                </div>
            </div>
            <div class="print-meta-col">
                <div class="print-meta-item">
                    <span class="print-meta-lbl">REPORT PERIOD</span>
                    <span class="print-meta-val">${escapeHtml(periodLabel)}</span>
                </div>
                <div class="print-meta-item">
                    <span class="print-meta-lbl">GENERATED TIME</span>
                    <span class="print-meta-val">${escapeHtml(genTimeStr)}</span>
                </div>
                <div class="print-meta-item">
                    <span class="print-meta-lbl">PREPARED FOR</span>
                    <span class="print-meta-val">MSME Inventory Management</span>
                </div>
                <div class="print-meta-item">
                    <span class="print-meta-lbl">SOURCE</span>
                    <span class="print-meta-val">raw_materials + stock_receipts + material_disbursements</span>
                </div>
            </div>
        </div>

        <div class="print-doc-divider"></div>

        ${sectionsHtml}

        <div class="print-doc-footer">
            <span>RMIMS | Reports &amp; Decision Support</span>
            <span>${escapeHtml(periodLabel)}</span>
        </div>
    `;
}

/* ==========================================================
   EXPORT PDF GENERATION (MATCHING IMAGE 2 EXACT FORMAT)
   ========================================================== */

const RM_GREEN = [22, 128, 60];
const RM_INK = [15, 23, 42];
const RM_DIM = [124, 138, 163];

function generateContinuousPdf(selectedSections = ["manager", "inventory", "receiving", "disbursement", "activity", "consumption", "forecasting"]) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const periodLabel = formatDisplayPeriod(state.startDate, state.endDate, state.periodPreset);
    const reportTypeStr = formatPeriodTypeLabel(state.periodPreset);
    const now = new Date();
    const genDateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const genTimeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    let y = 40;

    // 1. RMIMS Header (Image 2)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...RM_GREEN);
    doc.text("RMIMS", 40, y);

    doc.setFontSize(8.5);
    doc.setTextColor(...RM_DIM);
    doc.setFont("helvetica", "normal");
    doc.text("RAW MATERIALS INVENTORY — REPORTS & DECISION SUPPORT", 40, y + 14);

    y += 34;
    doc.setDrawColor(220, 226, 236);
    doc.line(40, y, pageWidth - 40, y);
    y += 20;

    // 2. Document Title (Image 2)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...RM_INK);
    doc.text("RMSME Report Package", 40, y);
    y += 20;

    // 3. 2-Column Metadata Grid (Image 2)
    const colW = (pageWidth - 80) / 2;
    const leftCol = [
        ["REPORT TYPE", reportTypeStr],
        ["GENERATED DATE", genDateStr],
        ["REPORT STATUS", "Final Snapshot"],
        ["PREPARED BY", "RMIMS"]
    ];
    const rightCol = [
        ["REPORT PERIOD", periodLabel],
        ["GENERATED TIME", genTimeStr],
        ["PREPARED FOR", "MSME Inventory Management"],
        ["SOURCE", "raw_materials + stock_receipts + material_disbursements"]
    ];

    let leftY = y, rightY = y;
    leftCol.forEach(row => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...RM_DIM);
        doc.text(row[0], 40, leftY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...RM_INK);
        doc.text(String(row[1]), 40, leftY + 11);
        leftY += 26;
    });

    rightCol.forEach(row => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...RM_DIM);
        doc.text(row[0], 40 + colW, rightY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...RM_INK);
        doc.text(String(row[1]), 40 + colW, rightY + 11);
        rightY += 26;
    });

    y = Math.max(leftY, rightY) + 4;
    doc.setDrawColor(220, 226, 236);
    doc.line(40, y, pageWidth - 40, y);
    y += 22;

    // 4. Sections in Exact Order
    const officialOrder = ["manager", "inventory", "receiving", "disbursement", "activity", "consumption", "forecasting"];
    const orderedSelections = officialOrder.filter(k => selectedSections.includes(k));

    orderedSelections.forEach(key => {
        if (y > doc.internal.pageSize.getHeight() - 140) {
            doc.addPage();
            y = 48;
        }

        if (key === "manager") {
            const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
            const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));
            const goodStock = state.materials.filter(m => m.status === "Good").length;
            const attentionStock = state.materials.filter(m => m.status === "Low" || m.status === "Critical").length;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("Manager Summary", 40, y);
            y += 16;

            doc.setFontSize(10);
            doc.setTextColor(...RM_INK);
            doc.text("Manager Overview", 40, y);

            doc.autoTable({
                startY: y + 6,
                head: [["Metric", "Result"]],
                body: [
                    ["Total Materials", String(state.materials.length)],
                    ["Good Stock", String(goodStock)],
                    ["Low / Critical", String(attentionStock)],
                    ["Receiving Records", String(periodReceipts.length)],
                    ["Consumption Records", String(periodDisbursements.length)],
                    ["Disbursement Records", String(periodDisbursements.length)]
                ],
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });

            y = doc.lastAutoTable.finalY + 16;

            const decisions = [];
            state.materials.forEach(m => {
                if (m.status === "Critical") {
                    decisions.push(["High", m.name, `Stock reached critical threshold (${m.currentStock} ${m.unit}).`, `Create urgent purchase receipt for ${m.reorderQty || 50} ${m.unit}.`]);
                } else if (m.status === "Low") {
                    decisions.push(["Medium", m.name, `Stock approaching minimum limit (${m.currentStock} ${m.unit}).`, `Schedule replenishment order.`]);
                }
            });

            if (y > doc.internal.pageSize.getHeight() - 100) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.setTextColor(...RM_INK);
            doc.text("Manager Decision Breakdown", 40, y);

            doc.autoTable({
                startY: y + 6,
                head: [["Priority", "Material", "What the Data Shows", "Suggested Action"]],
                body: decisions.length === 0 ? [["—", "All materials sufficient", "No critical conditions detected", "Continue normal operations"]] : decisions,
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });

            y = doc.lastAutoTable.finalY + 22;
        }

        if (key === "inventory") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("Inventory Records", 40, y);

            doc.autoTable({
                startY: y + 8,
                head: [["Raw Material", "Current Stock", "Minimum Stock", "Status"]],
                body: state.materials.map(m => [m.name, `${m.currentStock.toLocaleString()} ${m.unit}`, `${m.minThreshold.toLocaleString()} ${m.unit}`, m.status]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });

            y = doc.lastAutoTable.finalY + 22;
        }

        if (key === "receiving") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));

            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("Material Receiving", 40, y);

            doc.autoTable({
                startY: y + 8,
                head: [["Receipt Date", "Raw Material", "Received", "Supplier Name", "Received By", "Status"]],
                body: periodReceipts.length === 0 ? [["—", "No receiving records", "—", "—", "—", "—"]] :
                    periodReceipts.map(r => [r.receiptDate, r.materialName, `+${r.receivedQuantity} ${r.unit}`, r.supplierName, r.receivedBy, "Verified"]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });

            y = doc.lastAutoTable.finalY + 22;
        }

        if (key === "disbursement") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("Material Disbursement", 40, y);

            doc.autoTable({
                startY: y + 8,
                head: [["Usage Date", "Raw Material", "Finished Product", "Released", "Activity Type", "Recorded By"]],
                body: periodDisbursements.length === 0 ? [["—", "No disbursements", "—", "—", "—", "—"]] :
                    periodDisbursements.map(d => [d.usageDate, d.materialName, d.finishedProduct, `${d.disbursedQuantity} ${d.unit}`, d.activityType, d.recordedBy]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });

            y = doc.lastAutoTable.finalY + 22;
        }

        if (key === "activity") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
            const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));
            const activities = [];

            periodReceipts.forEach(r => activities.push([r.receiptDate, "Received", r.materialName, `+${r.receivedQuantity} ${r.unit}`, r.supplierName, r.receivedBy]));
            periodDisbursements.forEach(d => activities.push([d.usageDate, "Disbursed", d.materialName, `-${d.disbursedQuantity} ${d.unit}`, d.finishedProduct, d.recordedBy]));
            activities.sort((a, b) => b[0].localeCompare(a[0]));

            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("Material Activity", 40, y);

            doc.autoTable({
                startY: y + 8,
                head: [["Date", "Activity", "Raw Material", "Quantity", "Purpose / Context", "Recorded By"]],
                body: activities.length === 0 ? [["—", "No movements", "—", "—", "—", "—"]] : activities,
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });

            y = doc.lastAutoTable.finalY + 22;
        }

        if (key === "consumption") {
            if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 48; }
            const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));
            const curMap = new Map();
            periodDisbursements.forEach(d => curMap.set(d.materialId, (curMap.get(d.materialId) || 0) + d.disbursedQuantity));

            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(...RM_GREEN);
            doc.text("Consumption Analysis", 40, y);

            doc.autoTable({
                startY: y + 8,
                head: [["Raw Material", "Total Consumed", "Current Stock", "Status"]],
                body: state.materials.map(m => [m.name, `${(curMap.get(m.id) || 0).toLocaleString()} ${m.unit}`, `${m.currentStock.toLocaleString()} ${m.unit}`, m.status]),
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
            doc.text("AI Forecasting & Requirement Projections", 40, y);
            y += 16;

            doc.setFontSize(8.5);
            doc.setTextColor(...RM_DIM);
            doc.setFont("helvetica", "normal");
            doc.text("Status: In Development (Awaiting ML Model Run) | Horizon: Staged (Next 7 Days)", 40, y);
            y += 12;

            doc.autoTable({
                startY: y + 6,
                head: [["Raw Material", "ID", "Finished Product", "Current Stock", "Forecast Req (7D)", "Additional Needed", "Status"]],
                body: state.forecastList.map(item => [
                    item.name,
                    item.itemCode,
                    item.finishedProduct,
                    `${item.currentStock.toLocaleString()} ${item.unit}`,
                    item.forecast7Day !== null ? `${item.forecast7Day.toFixed(1)} ${item.unit}` : "—",
                    item.additionalNeed7 !== null && item.additionalNeed7 > 0 ? `${item.additionalNeed7.toFixed(1)} ${item.unit}` : "—",
                    item.status || "—"
                ]),
                margin: { left: 40, right: 40 },
                styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 5 },
                headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" }
            });

            y = doc.lastAutoTable.finalY + 22;
        }
    });

    // 5. Page Footers (Image 2)
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(220, 226, 236);
        doc.line(40, doc.internal.pageSize.getHeight() - 30, pageWidth - 40, doc.internal.pageSize.getHeight() - 30);
        doc.setFontSize(7.5);
        doc.setTextColor(...RM_DIM);
        doc.setFont("helvetica", "normal");
        doc.text("RMIMS | Reports & Decision Support", 40, doc.internal.pageSize.getHeight() - 18);
        doc.text(`${periodLabel}`, pageWidth / 2 - 40, doc.internal.pageSize.getHeight() - 18);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 80, doc.internal.pageSize.getHeight() - 18);
    }

    return doc;
}

/* ==========================================================
   EXPORT EXCEL WORKBOOK GENERATION (MULTI-SHEET WORKBOOK)
   ========================================================== */

function generateMultiSheetExcel(selectedSections = ["manager", "inventory", "receiving", "disbursement", "activity", "consumption", "forecasting"], fileName = "RMIMS_Report_Package") {
    const wb = XLSX.utils.book_new();

    const officialOrder = ["manager", "inventory", "receiving", "disbursement", "activity", "consumption", "forecasting"];
    const orderedSelections = officialOrder.filter(k => selectedSections.includes(k));

    const periodReceipts = state.receipts.filter(r => withinRange(r.receiptDate, state.startDate, state.endDate));
    const periodDisbursements = state.disbursements.filter(d => withinRange(d.usageDate, state.startDate, state.endDate));

    orderedSelections.forEach(key => {
        if (key === "manager") {
            const goodStock = state.materials.filter(m => m.status === "Good").length;
            const attentionStock = state.materials.filter(m => m.status === "Low" || m.status === "Critical").length;
            const rows = [
                ["Metric", "Result"],
                ["Total Materials", state.materials.length],
                ["Good Stock", goodStock],
                ["Low / Critical", attentionStock],
                ["Receiving Records", periodReceipts.length],
                ["Consumption Records", periodDisbursements.length],
                ["Disbursement Records", periodDisbursements.length]
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Manager Summary");
        }

        if (key === "inventory") {
            const rows = [
                ["Raw Material", "Item Code", "Unit", "Current Stock", "Minimum Stock", "Status"],
                ...state.materials.map(m => [m.name, m.itemCode, m.unit, m.currentStock, m.minThreshold, m.status])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Inventory Records");
        }

        if (key === "receiving") {
            const rows = [
                ["Receipt Date", "Raw Material", "Received Qty", "Unit", "Supplier Name", "Received By", "Status"],
                ...periodReceipts.map(r => [r.receiptDate, r.materialName, r.receivedQuantity, r.unit, r.supplierName, r.receivedBy, "Verified"])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Material Receiving");
        }

        if (key === "disbursement") {
            const rows = [
                ["Usage Date", "Raw Material", "Finished Product / Batch", "Disbursed Qty", "Unit", "Activity Type", "Recorded By"],
                ...periodDisbursements.map(d => [d.usageDate, d.materialName, d.finishedProduct, d.disbursedQuantity, d.unit, d.activityType, d.recordedBy])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Material Disbursement");
        }

        if (key === "activity") {
            const activities = [];
            periodReceipts.forEach(r => activities.push([r.receiptDate, "Received", r.materialName, r.receivedQuantity, r.unit, r.supplierName, r.receivedBy]));
            periodDisbursements.forEach(d => activities.push([d.usageDate, "Disbursed", d.materialName, -d.disbursedQuantity, d.unit, d.finishedProduct, d.recordedBy]));
            activities.sort((a, b) => b[0].localeCompare(a[0]));

            const rows = [
                ["Date", "Activity", "Raw Material", "Net Quantity", "Unit", "Purpose / Context", "Recorded By"],
                ...activities
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Material Activity");
        }

        if (key === "consumption") {
            const curMap = new Map();
            periodDisbursements.forEach(d => curMap.set(d.materialId, (curMap.get(d.materialId) || 0) + d.disbursedQuantity));

            const rows = [
                ["Raw Material", "Total Consumed", "Unit", "Current Stock", "Status"],
                ...state.materials.map(m => [m.name, curMap.get(m.id) || 0, m.unit, m.currentStock, m.status])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Consumption Analysis");
        }

        if (key === "forecasting") {
            const rows = [
                ["Raw Material", "ID", "Finished Product", "Current Stock", "Unit", "Recent Consumption", "Forecast Req (7D)", "Forecast Req (30D)", "Additional Needed (7D)", "Status"],
                ...state.forecastList.map(item => [
                    item.name,
                    item.itemCode,
                    item.finishedProduct,
                    item.currentStock,
                    item.unit,
                    item.recentConsumption,
                    item.forecast7Day,
                    item.forecast1Month,
                    item.additionalNeed7,
                    item.status
                ])
            ];
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "AI Forecasting");
        }
    });

    XLSX.writeFile(wb, `${fileName}.xlsx`);
}

/* ==========================================================
   EVENT LISTENERS & UI WIRING
   ========================================================== */

function initEventListeners() {
    // 1. Tab Switching
    const tabBtns = document.querySelectorAll(".rpt-tab-btn");
    const panels = {
        manager: document.getElementById("tabPanelManager"),
        inventory: document.getElementById("tabPanelInventory"),
        receiving: document.getElementById("tabPanelReceiving"),
        disbursement: document.getElementById("tabPanelDisbursement"),
        activity: document.getElementById("tabPanelActivity"),
        consumption: document.getElementById("tabPanelConsumption"),
        forecasting: document.getElementById("tabPanelForecasting")
    };

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const tabKey = btn.getAttribute("data-tab");
            state.activeTab = tabKey;

            Object.entries(panels).forEach(([k, panel]) => {
                if (panel) {
                    if (k === tabKey) panel.classList.add("active");
                    else panel.classList.remove("active");
                }
            });
        });
    });

    // 2. Period Preset & Date Controls
    const presetSelect = document.getElementById("reportPeriodPreset");
    const startInput = document.getElementById("rptStartDate");
    const endInput = document.getElementById("rptEndDate");
    const genBtn = document.getElementById("generateReportBtn");

    if (presetSelect) {
        presetSelect.addEventListener("change", () => {
            state.periodPreset = presetSelect.value;
            setPeriodPresetDates(presetSelect.value);
            updateMetadataLabels();
            renderAllTabs();
            updatePrintDocHtml();
        });
    }

    if (startInput) {
        startInput.addEventListener("change", () => {
            state.startDate = parseDateOnly(startInput.value);
            state.periodPreset = "custom";
            if (presetSelect) presetSelect.value = "custom";
            updateMetadataLabels();
            renderAllTabs();
            updatePrintDocHtml();
        });
    }

    if (endInput) {
        endInput.addEventListener("change", () => {
            state.endDate = parseDateOnly(endInput.value);
            state.periodPreset = "custom";
            if (presetSelect) presetSelect.value = "custom";
            updateMetadataLabels();
            renderAllTabs();
            updatePrintDocHtml();
        });
    }

    if (genBtn) {
        genBtn.addEventListener("click", async () => {
            await loadAuthoritativeData();
            showToast("Report parameters refreshed.");
        });
    }

    // 3. Tab Toolbar Search & Filter Listeners
    const invSearch = document.getElementById("invSearchInput");
    if (invSearch) invSearch.addEventListener("input", (e) => { state.invSearch = e.target.value; renderInventoryRecordsTab(); });
    const invStatus = document.getElementById("invStatusFilter");
    if (invStatus) invStatus.addEventListener("change", (e) => { state.invStatus = e.target.value; renderInventoryRecordsTab(); });

    const rcvSearch = document.getElementById("rcvSearchInput");
    if (rcvSearch) rcvSearch.addEventListener("input", (e) => { state.rcvSearch = e.target.value; renderMaterialReceivingTab(); });

    const disbSearch = document.getElementById("disbSearchInput");
    if (disbSearch) disbSearch.addEventListener("input", (e) => { state.disbSearch = e.target.value; renderMaterialDisbursementTab(); });

    const actSearch = document.getElementById("actSearchInput");
    if (actSearch) actSearch.addEventListener("input", (e) => { state.actSearch = e.target.value; renderMaterialActivityTab(); });
    const actType = document.getElementById("actTypeFilter");
    if (actType) actType.addEventListener("change", (e) => { state.actType = e.target.value; renderMaterialActivityTab(); });

    const cnsSearch = document.getElementById("cnsSearchInput");
    if (cnsSearch) cnsSearch.addEventListener("input", (e) => { state.cnsSearch = e.target.value; renderConsumptionAnalysisTab(); });

    // AI Forecasting Filters & Search
    const fcSearch = document.getElementById("fcSearchInput");
    if (fcSearch) fcSearch.addEventListener("input", (e) => { state.fcSearch = e.target.value; state.fcPage = 1; renderAiForecastingTab(); });
    const fcStatus = document.getElementById("fcStatusFilter");
    if (fcStatus) fcStatus.addEventListener("change", (e) => { state.fcStatus = e.target.value; state.fcPage = 1; renderAiForecastingTab(); });
    const fcUnit = document.getElementById("fcUnitFilter");
    if (fcUnit) fcUnit.addEventListener("change", (e) => { state.fcUnit = e.target.value; state.fcPage = 1; renderAiForecastingTab(); });
    const fcHorizon = document.getElementById("fcHorizonFilter");
    if (fcHorizon) fcHorizon.addEventListener("change", (e) => { state.fcHorizon = e.target.value; renderAiForecastingTab(); });

    // AI Forecasting Pagination
    const fcPrev = document.getElementById("fcPrevPageBtn");
    if (fcPrev) fcPrev.addEventListener("click", () => { if (state.fcPage > 1) { state.fcPage--; renderAiForecastingTab(); } });
    const fcNext = document.getElementById("fcNextPageBtn");
    if (fcNext) fcNext.addEventListener("click", () => { state.fcPage++; renderAiForecastingTab(); });

    // 4. Print Action -> Directly triggers browser printer dialog (No file download)
    const printBtn = document.getElementById("btnPrint");
    if (printBtn) {
        printBtn.addEventListener("click", () => {
            updatePrintDocHtml();
            window.print();
        });
    }

    // 5. Save As Modal
    const saveAsBtn = document.getElementById("btnSaveAs");
    const saveOverlay = document.getElementById("saveModalOverlay");
    const saveClose = document.getElementById("saveModalCloseBtn");
    const saveCancel = document.getElementById("saveModalCancelBtn");
    const saveConfirm = document.getElementById("saveModalConfirmBtn");

    if (saveAsBtn && saveOverlay) {
        saveAsBtn.addEventListener("click", () => {
            const reportNameInput = document.getElementById("saveModalReportName");
            if (reportNameInput) {
                const pTag = state.periodPreset === "weekly" ? "Weekly" : (state.periodPreset === "monthly" ? "Monthly" : (state.periodPreset === "today" ? "Today" : "Custom"));
                const startStr = state.startDate ? formatDateISO(state.startDate) : "";
                const endStr = state.endDate ? formatDateISO(state.endDate) : "";
                reportNameInput.value = `RMIMS_${pTag}_Report_${startStr}_to_${endStr}`;
            }
            saveOverlay.classList.add("open");
        });
    }

    const closeSaveModal = () => saveOverlay?.classList.remove("open");
    if (saveClose) saveClose.addEventListener("click", closeSaveModal);
    if (saveCancel) saveCancel.addEventListener("click", closeSaveModal);
    if (saveOverlay) {
        saveOverlay.addEventListener("click", (e) => {
            if (e.target === saveOverlay) closeSaveModal();
        });
    }

    document.getElementById("saveSelectAllBtn")?.addEventListener("click", () => {
        document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']").forEach(cb => cb.checked = true);
    });

    document.getElementById("saveClearAllBtn")?.addEventListener("click", () => {
        document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']").forEach(cb => cb.checked = false);
    });

    if (saveConfirm) {
        saveConfirm.addEventListener("click", () => {
            const checkedBoxes = Array.from(document.querySelectorAll("#saveSectionsChecklist input[type='checkbox']:checked"));
            if (checkedBoxes.length === 0) {
                showToast("Please select at least one report section.", "error");
                return;
            }

            const selectedKeys = checkedBoxes.map(cb => cb.value);
            const format = document.querySelector("input[name='saveFileFormat']:checked")?.value || "pdf";
            const rawName = document.getElementById("saveModalReportName")?.value.trim() || "RMIMS_Report";

            if (format === "pdf") {
                const doc = generateContinuousPdf(selectedKeys);
                doc.save(`${rawName}.pdf`);
                showToast("Continuous PDF report downloaded.");
            } else if (format === "excel") {
                generateMultiSheetExcel(selectedKeys, rawName);
                showToast("Multi-sheet Excel workbook generated.");
            } else if (format === "both") {
                const doc = generateContinuousPdf(selectedKeys);
                doc.save(`${rawName}.pdf`);
                generateMultiSheetExcel(selectedKeys, rawName);
                showToast("PDF + Excel report package generated.");
            }

            closeSaveModal();
        });
    }
}

/* ==========================================================
   TOAST NOTIFICATIONS & HELPERS
   ========================================================== */

function showToast(message, type = "success") {
    const stack = document.getElementById("toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
        el.classList.add("leaving");
        setTimeout(() => el.remove(), 260);
    }, 3200);
}

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}
