// js/user-reports.js
// User — Reports & Decision Support.
// Summarizes existing data from Inventory Management, Material Activity and Analytics.
// 100% matched structure, components, and logic with Admin Reports.

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
        pText.textContent = `${profile.fullName || "Staff Member"} ▼`;
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

let materials = [];
let usageRecords = [];
let stockReceipts = [];
let finishedProducts = [];
let productRequirements = [];

let currentReportType = "weekly";
let anchorDate = new Date();
let activeReport = null;

let overallSearchQuery = "";
let overallStatusFilter = "all";
let overallPage = 1;
const OVERALL_PAGE_SIZE = 10;

let capacitySearchQuery = "";
let capacityCategoryFilter = "all";
let capacityPage = 1;
const CAPACITY_PAGE_SIZE = 10;

const $ = (id) => document.getElementById(id);

/* ==========================================================
   HELPERS & DATE MATH
   ========================================================== */

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}

function formatNum(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "0";
    return Number.isInteger(num) ? num.toString() : num.toFixed(2).replace(/\.00$/, "");
}

function startOfWeek(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function endOfWeek(start) {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
}

function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function getPeriodRange(type, date) {
    if (type === "monthly") {
        const start = startOfMonth(date);
        const end = endOfMonth(date);
        return { start, end };
    }
    const start = startOfWeek(date);
    const end = endOfWeek(start);
    return { start, end };
}

function formatPeriodLabel(type, range) {
    if (type === "monthly") {
        return range.start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    const startStr = range.start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endStr = range.end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${startStr} – ${endStr}`;
}

function inRange(dateVal, range) {
    if (!dateVal) return false;
    const d = new Date(dateVal);
    return d >= range.start && d <= range.end;
}

function statusPill(status) {
    if (status === "Critical") return `<span class="status stock-critical">Needs Restocking</span>`;
    if (status === "Low") return `<span class="status stock-low">Running Low</span>`;
    return `<span class="status stock-good">Good</span>`;
}

function statusPillCapacity(limitStatus) {
    if (limitStatus === "Critical") return `<span class="status stock-critical">Critical</span>`;
    if (limitStatus === "Low") return `<span class="status stock-low">Low</span>`;
    return `<span class="status stock-good">Available</span>`;
}

/* ==========================================================
   DATA LOAD
   ========================================================== */

async function loadAll() {
    try {
        const [matSnap, usageSnap, receiptSnap, fpSnap, reqSnap] = await Promise.all([
            getDocs(collection(db, "materials")),
            getDocs(collection(db, "usageRecords")),
            getDocs(collection(db, "stockReceipts")),
            getDocs(collection(db, "finishedProducts")),
            getDocs(collection(db, "productMaterialRequirements"))
        ]);

        materials = matSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        usageRecords = usageSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        stockReceipts = receiptSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        finishedProducts = fpSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        productRequirements = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const now = new Date();
        $("dataAsOf").textContent = `Data last refreshed: ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;

        updatePeriodControls();
    } catch (e) {
        console.error("Error loading report data:", e);
    }
}

/* ==========================================================
   PERIOD CONTROLS & BINDINGS
   ========================================================== */

function updatePeriodControls() {
    currentReportType = $("reportType").value;
    const range = getPeriodRange(currentReportType, anchorDate);
    $("periodLabel").textContent = formatPeriodLabel(currentReportType, range);
}

$("reportType").addEventListener("change", () => {
    updatePeriodControls();
});

$("periodPrev").addEventListener("click", () => {
    if (currentReportType === "monthly") {
        anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1);
    } else {
        anchorDate = new Date(anchorDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    updatePeriodControls();
});

$("periodNext").addEventListener("click", () => {
    if (currentReportType === "monthly") {
        anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1);
    } else {
        anchorDate = new Date(anchorDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
    updatePeriodControls();
});

$("generateBtn").addEventListener("click", () => {
    generateReport();
});

$("refreshBtn").addEventListener("click", async () => {
    await loadAll();
    if (activeReport) generateReport();
});

/* ==========================================================
   REPORT BUILDER
   ========================================================== */

function generateReport() {
    const range = getPeriodRange(currentReportType, anchorDate);

    const periodReceipts = stockReceipts.filter(r => inRange(r.receivedDate || r.createdAt, range));
    const periodUsage = usageRecords.filter(r => inRange(r.usageDate || r.createdAt, range));

    const recByMat = new Map();
    periodReceipts.forEach(r => {
        const id = r.materialId;
        recByMat.set(id, (recByMat.get(id) || 0) + Number(r.receivedQuantity || 0));
    });

    const useByMat = new Map();
    periodUsage.forEach(r => {
        const id = r.materialId;
        useByMat.set(id, (useByMat.get(id) || 0) + Number(r.usedQuantity || 0));
    });

    const disByMat = new Map();
    const periodDisbursements = periodUsage.filter(r => r.productId);
    periodDisbursements.forEach(r => {
        const id = r.materialId;
        disByMat.set(id, (disByMat.get(id) || 0) + Number(r.usedQuantity || 0));
    });

    const receiveRows = materials.map(m => {
        const qtyReceived = recByMat.get(m.id) || 0;
        const lastRec = periodReceipts
            .filter(r => r.materialId === m.id)
            .sort((a, b) => new Date(b.receivedDate || b.createdAt) - new Date(a.receivedDate || a.createdAt))[0];
        return { material: m, qtyReceived, lastReceiveDate: lastRec ? (lastRec.receivedDate || lastRec.createdAt) : null };
    }).filter(r => r.qtyReceived > 0);

    const consumedRows = materials.map(m => {
        const qtyConsumed = useByMat.get(m.id) || 0;
        return { material: m, qtyConsumed };
    }).filter(r => r.qtyConsumed > 0);

    const disbursedRows = periodDisbursements.map(r => {
        const mat = materials.find(m => m.id === r.materialId) || { materialName: r.materialName, unit: r.unit };
        const prod = finishedProducts.find(p => p.id === r.productId) || { productName: r.productName };
        return {
            materialName: mat.materialName,
            productName: prod.productName,
            disbursedQuantity: r.usedQuantity,
            unit: r.unit || mat.unit || "",
            date: r.usageDate || r.createdAt
        };
    });

    activeReport = {
        type: currentReportType,
        range,
        receiveRows,
        consumedRows,
        disbursedRows,
        generatedAt: new Date()
    };

    renderReportView();
}

/* ==========================================================
   RENDER REPORT VIEW
   ========================================================== */

function renderReportView() {
    if (!activeReport) return;
    $("reportEmptyState").hidden = true;
    $("printArea").hidden = false;
    $("reportActions").hidden = false;

    $("reportSummaryType").textContent = `${activeReport.type === "monthly" ? "Monthly" : "Weekly"} Report`;
    $("reportSummaryPeriod").textContent = formatPeriodLabel(activeReport.type, activeReport.range);
    $("reportGeneratedAt").textContent = activeReport.generatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

    $("cardReceived").textContent = `${activeReport.receiveRows.length} materials`;
    $("cardConsumed").textContent = `${activeReport.consumedRows.length} materials`;
    $("cardDisbursed").textContent = `${activeReport.disbursedRows.length} activities`;

    const attentionMats = materials.filter(m => m.status === "Low" || m.status === "Critical");
    $("cardAttention").textContent = `${attentionMats.length} materials`;

    renderReceiveTable(activeReport.receiveRows);
    renderConsumedTable(activeReport.consumedRows);
    renderDisbursementTable(activeReport.disbursedRows);
    renderOverallTable();
    renderCapacityTable();
    renderInsightsAndDecisionSupport();
}

function renderReceiveTable(rows) {
    const tbody = $("receiveStocksBody");
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No stock receipts recorded for this period.</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.material.materialName)}</strong></td>
            <td>—</td>
            <td>+${formatNum(r.qtyReceived)} ${escapeHtml(r.material.unit || "")}</td>
            <td>${r.lastReceiveDate ? new Date(r.lastReceiveDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
            <td>${formatNum(r.material.quantity)} ${escapeHtml(r.material.unit || "")}</td>
            <td>${statusPill(r.material.status)}</td>
        </tr>`).join("");
}

function renderConsumedTable(rows) {
    const tbody = $("consumedStocksBody");
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No stock consumption recorded for this period.</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.material.materialName)}</strong></td>
            <td>—</td>
            <td>-${formatNum(r.qtyConsumed)} ${escapeHtml(r.material.unit || "")}</td>
            <td>${formatNum(r.material.quantity)} ${escapeHtml(r.material.unit || "")}</td>
            <td><span class="trend-badge trend-down">Used</span></td>
            <td>${statusPill(r.material.status)}</td>
        </tr>`).join("");
}

function renderDisbursementTable(rows) {
    const tbody = $("disbursementBody");
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No material disbursements issued for production in this period.</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.materialName)}</strong></td>
            <td>${escapeHtml(r.productName || "General Production")}</td>
            <td>${formatNum(r.disbursedQuantity)} ${escapeHtml(r.unit || "")}</td>
            <td>${new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
            <td><div class="progress-bar"><div class="progress-fill" style="width:100%"></div></div></td>
            <td><span class="status stock-good">Disbursed</span></td>
        </tr>`).join("");
}

function renderOverallTable() {
    const tbody = $("overallBody");
    const search = ($("overallSearch") ? $("overallSearch").value : "").trim().toLowerCase();
    const statusFilter = $("overallStatusFilter") ? $("overallStatusFilter").value : "all";

    const filtered = materials.filter(m =>
        (!search || m.materialName.toLowerCase().includes(search)) &&
        (statusFilter === "all" || m.status === statusFilter)
    );

    $("overallAsOf").textContent = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No materials found matching filters.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.slice(0, 10).map(m => `
        <tr>
            <td><strong>${escapeHtml(m.materialName)}</strong></td>
            <td>${formatNum(m.quantity)} ${escapeHtml(m.unit || "")}</td>
            <td>${m.minStock !== undefined ? `${formatNum(m.minStock)} ${escapeHtml(m.unit || "")}` : "—"}</td>
            <td>${m.maxStock ? `${formatNum(m.maxStock)} ${escapeHtml(m.unit || "")}` : "—"}</td>
            <td>${statusPill(m.status)}</td>
        </tr>`).join("");
}

function renderCapacityTable() {
    const tbody = $("capacityBody");
    const search = ($("capacitySearch") ? $("capacitySearch").value : "").trim().toLowerCase();

    $("capacityAsOf").textContent = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

    if (finishedProducts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No finished products setup configured.</p></div></td></tr>`;
        return;
    }

    const filtered = finishedProducts.filter(p => !search || p.productName.toLowerCase().includes(search));

    tbody.innerHTML = filtered.slice(0, 10).map(p => {
        const reqs = productRequirements.filter(r => r.productId === p.id);
        if (reqs.length === 0) {
            return `<tr><td><strong>${escapeHtml(p.productName)}</strong></td><td>—</td><td>Unconfigured</td><td>0</td><td><span class="status stock-low">No Requirements</span></td></tr>`;
        }

        let minCanProduce = Infinity;
        let limitingMatName = "None";

        reqs.forEach(r => {
            const mat = materials.find(m => m.id === r.materialId);
            if (!mat || Number(r.quantityRequired || 0) <= 0) return;
            const can = Math.floor(Number(mat.quantity || 0) / Number(r.quantityRequired));
            if (can < minCanProduce) {
                minCanProduce = can;
                limitingMatName = mat.materialName;
            }
        });

        if (minCanProduce === Infinity) minCanProduce = 0;
        const status = minCanProduce === 0 ? "Critical" : minCanProduce < 10 ? "Low" : "Available";

        return `
            <tr>
                <td><strong>${escapeHtml(p.productName)}</strong></td>
                <td>${escapeHtml(limitingMatName)}</td>
                <td>${formatNum(minCanProduce)} batches</td>
                <td>${formatNum(minCanProduce)} units</td>
                <td>${statusPillCapacity(status)}</td>
            </tr>`;
    }).join("");
}

function renderInsightsAndDecisionSupport() {
    const changesList = $("importantChangesList");
    const lowMats = materials.filter(m => m.status === "Low" || m.status === "Critical");

    if (lowMats.length === 0) {
        changesList.innerHTML = `<li><strong>💡 Stable Inventory</strong><br>All tracked materials are currently in good stock standing.</li>`;
    } else {
        changesList.innerHTML = lowMats.map(m => `
            <li><strong>⚠ ${m.status === "Critical" ? "Critical Stockout Risk" : "Low Stock Alert"}</strong><br>${escapeHtml(m.materialName)} is currently at ${formatNum(m.quantity)} ${escapeHtml(m.unit || "")} (Minimum: ${formatNum(m.minStock || 0)}).</li>`).join("");
    }

    const decisionBody = $("decisionSupportBody");
    if (lowMats.length === 0) {
        decisionBody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No reorder actions required. Inventory is healthy.</p></div></td></tr>`;
    } else {
        decisionBody.innerHTML = lowMats.map(m => `
            <tr>
                <td><strong>${escapeHtml(m.materialName)}</strong></td>
                <td>${m.status === "Critical" ? "Stockout Impending" : "Below Minimum Target"}</td>
                <td>Current stock is ${formatNum(m.quantity)} ${escapeHtml(m.unit || "")}</td>
                <td>Reorder immediately to restore minimum inventory buffer</td>
                <td><span class="status ${m.status === "Critical" ? "stock-critical" : "stock-low"}">${m.status === "Critical" ? "High Priority" : "Medium Priority"}</span></td>
            </tr>`).join("");
    }

    const goalsList = $("goalsList");
    goalsList.innerHTML = `
        <li>Procure restock batches for materials tagged as Low or Critical.</li>
        <li>Log incoming shipments under Material Activity to maintain accurate availability counts.</li>
        <li>Review finished product recipe requirements for upcoming production targets.</li>`;
}

/* ==========================================================
   EXPORT & PRINT HANDLERS
   ========================================================== */

if ($("printReportBtn")) {
    $("printReportBtn").addEventListener("click", () => window.print());
}
if ($("printBtn")) {
    $("printBtn").addEventListener("click", () => window.print());
}

if ($("saveAsPdfBtn")) {
    $("saveAsPdfBtn").addEventListener("click", () => {
        $("saveModalOverlay").classList.add("active");
    });
}
if ($("saveAsExcelBtn")) {
    $("saveAsExcelBtn").addEventListener("click", () => {
        $("saveModalOverlay").classList.add("active");
    });
}
if ($("saveModalClose")) {
    $("saveModalClose").addEventListener("click", () => $("saveModalOverlay").classList.remove("active"));
}
if ($("saveModalCancel")) {
    $("saveModalCancel").addEventListener("click", () => $("saveModalOverlay").classList.remove("active"));
}

/* ==========================================================
   INIT
   ========================================================== */

function init() {
    loadAll();
}
