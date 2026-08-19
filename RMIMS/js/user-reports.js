// js/user-reports.js
//
// User — Reports & Decision Support.
// Summarizes live authoritative data from public.raw_materials, public.stock_receipts,
// and public.material_disbursements for operational user view.
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
            pText.textContent = `${profile.full_name || profile.email || "Staff Member"} ▼`;
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

let materials = [];
let usageRecords = [];
let stockReceipts = [];
let finishedProducts = [];
let requirementsByProduct = new Map();

let currentReportType = "weekly";
let anchorDate = new Date();
let activeReport = null;

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
   DATA LOAD (AUTHORITATIVE V2)
   ========================================================== */

async function loadAll() {
    try {
        const [matRes, useRes, recRes] = await Promise.all([
            supabase.from("raw_materials").select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, description").order("name"),
            supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("usage_date", { ascending: false }),
            supabase.from("stock_receipts").select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at").order("receipt_date", { ascending: false })
        ]);

        if (matRes.error) throw matRes.error;
        if (useRes.error) console.warn("Disbursements notice:", useRes.error);
        if (recRes.error) console.warn("Stock receipts notice:", recRes.error);

        materials = (matRes.data || []).map(m => {
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
                minStock: min,
                status
            };
        });

        const matMap = new Map(materials.map(m => [m.id, m]));

        stockReceipts = (recRes.data || []).map(r => ({
            id: r.id,
            materialId: r.material_id,
            materialName: matMap.get(r.material_id)?.materialName || "Raw Material",
            receivedQuantity: Number(r.received_quantity || 0),
            receivedDate: r.receipt_date,
            unit: r.unit || matMap.get(r.material_id)?.unit || "kg",
            supplierName: r.supplier_name,
            createdAt: r.created_at
        }));

        usageRecords = (useRes.data || []).map(d => {
            const rawProd = d.finished_product_name ? d.finished_product_name.trim() : "";
            const isProduct = rawProd && rawProd !== "General Usage";
            return {
                id: d.id,
                materialId: d.material_id,
                materialName: matMap.get(d.material_id)?.materialName || "Raw Material",
                usedQuantity: Number(d.consumed_quantity || 0),
                usageDate: d.usage_date,
                unit: d.unit || matMap.get(d.material_id)?.unit || "kg",
                productName: isProduct ? rawProd : "General Usage",
                productId: isProduct ? rawProd : null,
                activityType: d.activity_type,
                createdAt: d.created_at
            };
        });

        // Discover finished products
        const productMap = new Map();
        usageRecords.forEach(u => {
            if (!u.productId) return;
            if (!productMap.has(u.productId)) {
                productMap.set(u.productId, {
                    id: u.productId,
                    productName: u.productId,
                    category: u.productId.includes("Bread") || u.productId === "Pandesal" ? "Bakery" : "Production",
                    materials: new Map()
                });
            }
            const prod = productMap.get(u.productId);
            const curr = prod.materials.get(u.materialId) || 0;
            prod.materials.set(u.materialId, curr + u.usedQuantity);
        });

        finishedProducts = Array.from(productMap.values()).map(p => ({
            id: p.id,
            productName: p.productName,
            category: p.category
        }));

        requirementsByProduct = new Map();
        productMap.forEach((p, prodId) => {
            const reqList = [];
            p.materials.forEach((tot, matId) => {
                const count = usageRecords.filter(u => u.productId === prodId && u.materialId === matId).length || 1;
                reqList.push({
                    productId: prodId,
                    materialId: matId,
                    requiredQuantity: Math.max(1, Math.round((tot / count) * 100) / 100)
                });
            });
            requirementsByProduct.set(prodId, reqList);
        });

        const now = new Date();
        const asOfEl = $("dataAsOf");
        if (asOfEl) {
            asOfEl.textContent = `Data last refreshed: ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
        }

        updatePeriodControls();
    } catch (e) {
        console.error("Error loading report data:", e);
    }
}

/* ==========================================================
   PERIOD CONTROLS & BINDINGS
   ========================================================== */

function updatePeriodControls() {
    const repEl = $("reportType");
    if (!repEl) return;
    currentReportType = repEl.value;
    const range = getPeriodRange(currentReportType, anchorDate);
    const pLbl = $("periodLabel");
    if (pLbl) pLbl.textContent = formatPeriodLabel(currentReportType, range);
}

const repTypeEl = $("reportType");
if (repTypeEl) repTypeEl.addEventListener("change", updatePeriodControls);

const pPrev = $("periodPrev");
if (pPrev) {
    pPrev.addEventListener("click", () => {
        if (currentReportType === "monthly") {
            anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1);
        } else {
            anchorDate = new Date(anchorDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        }
        updatePeriodControls();
    });
}

const pNext = $("periodNext");
if (pNext) {
    pNext.addEventListener("click", () => {
        if (currentReportType === "monthly") {
            anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1);
        } else {
            anchorDate = new Date(anchorDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
        updatePeriodControls();
    });
}

const genBtn = $("generateBtn");
if (genBtn) {
    genBtn.addEventListener("click", () => {
        generateReport();
    });
}

const refBtn = $("refreshBtn");
if (refBtn) {
    refBtn.addEventListener("click", async () => {
        await loadAll();
        if (activeReport) generateReport();
    });
}

/* ==========================================================
   REPORT BUILDER
   ========================================================== */

function generateReport() {
    const range = getPeriodRange(currentReportType, anchorDate);

    const periodReceipts = stockReceipts.filter(r => inRange(r.receivedDate || r.createdAt, range));
    const periodUsage = usageRecords.filter(u => inRange(u.usageDate || u.createdAt, range));

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

    const periodDisbursements = periodUsage.filter(r => r.productId);

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
        return {
            materialName: mat.materialName,
            productName: r.productName || "General Production",
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
    const emptyEl = $("reportEmptyState");
    if (emptyEl) emptyEl.hidden = true;
    const printArea = $("printArea");
    if (printArea) printArea.hidden = false;
    const reportActions = $("reportActions");
    if (reportActions) reportActions.hidden = false;

    const repTypeTitle = $("reportSummaryType");
    if (repTypeTitle) repTypeTitle.textContent = `${activeReport.type === "monthly" ? "Monthly" : "Weekly"} Report`;
    const repPeriod = $("reportSummaryPeriod");
    if (repPeriod) repPeriod.textContent = formatPeriodLabel(activeReport.type, activeReport.range);
    const genAt = $("reportGeneratedAt");
    if (genAt) genAt.textContent = activeReport.generatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

    const cardRec = $("cardReceived");
    if (cardRec) cardRec.textContent = `${activeReport.receiveRows.length} materials`;
    const cardCons = $("cardConsumed");
    if (cardCons) cardCons.textContent = `${activeReport.consumedRows.length} materials`;
    const cardDisb = $("cardDisbursed");
    if (cardDisb) cardDisb.textContent = `${activeReport.disbursedRows.length} activities`;

    const attentionMats = materials.filter(m => m.status === "Low" || m.status === "Critical");
    const cardAttn = $("cardAttention");
    if (cardAttn) cardAttn.textContent = `${attentionMats.length} materials`;

    renderReceiveTable(activeReport.receiveRows);
    renderConsumedTable(activeReport.consumedRows);
    renderDisbursementTable(activeReport.disbursedRows);
    renderOverallTable();
    renderCapacityTable();
    renderInsightsAndDecisionSupport();
}

function renderReceiveTable(rows) {
    const tbody = $("receiveStocksBody");
    if (!tbody) return;
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
    if (!tbody) return;
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
    if (!tbody) return;
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
    if (!tbody) return;
    const search = ($("overallSearch") ? $("overallSearch").value : "").trim().toLowerCase();
    const statusFilter = $("overallStatusFilter") ? $("overallStatusFilter").value : "all";

    const filtered = materials.filter(m =>
        (!search || m.materialName.toLowerCase().includes(search)) &&
        (statusFilter === "all" || m.status === statusFilter)
    );

    const asOfEl = $("overallAsOf");
    if (asOfEl) asOfEl.textContent = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No materials found matching filters.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.slice(0, 10).map(m => `
        <tr>
            <td><strong>${escapeHtml(m.materialName)}</strong></td>
            <td>${formatNum(m.quantity)} ${escapeHtml(m.unit || "")}</td>
            <td>${m.minStock !== null && m.minStock !== undefined ? `${formatNum(m.minStock)} ${escapeHtml(m.unit || "")}` : "—"}</td>
            <td>—</td>
            <td>${statusPill(m.status)}</td>
        </tr>`).join("");
}

function renderCapacityTable() {
    const tbody = $("capacityBody");
    if (!tbody) return;
    const search = ($("capacitySearch") ? $("capacitySearch").value : "").trim().toLowerCase();

    const capAsOf = $("capacityAsOf");
    if (capAsOf) capAsOf.textContent = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

    if (finishedProducts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No finished products recorded yet.</p></div></td></tr>`;
        return;
    }

    const filtered = finishedProducts.filter(p => !search || p.productName.toLowerCase().includes(search));

    tbody.innerHTML = filtered.slice(0, 10).map(p => {
        const reqs = requirementsByProduct.get(p.id) || [];
        if (reqs.length === 0) {
            return `<tr><td><strong>${escapeHtml(p.productName)}</strong></td><td>—</td><td>Unconfigured</td><td>0</td><td><span class="status stock-low">No Requirements</span></td></tr>`;
        }

        let minCanProduce = Infinity;
        let limitingMatName = "None";

        reqs.forEach(r => {
            const mat = materials.find(m => m.id === r.materialId);
            if (!mat || Number(r.requiredQuantity || 0) <= 0) return;
            const can = Math.floor(Number(mat.quantity || 0) / Number(r.requiredQuantity));
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
                <td>${formatNum(minCanProduce)} batches</td>
                <td>${statusPillCapacity(status)}</td>
            </tr>`;
    }).join("");
}

function renderInsightsAndDecisionSupport() {
    const changesList = $("importantChangesList");
    const lowMats = materials.filter(m => m.status === "Low" || m.status === "Critical");

    if (changesList) {
        if (lowMats.length === 0) {
            changesList.innerHTML = `<li><strong>💡 Stable Inventory</strong><br>All tracked materials are currently in good stock standing.</li>`;
        } else {
            changesList.innerHTML = lowMats.map(m => `
                <li><strong>⚠ ${m.status === "Critical" ? "Critical Stockout Risk" : "Low Stock Alert"}</strong><br>${escapeHtml(m.materialName)} is currently at ${formatNum(m.quantity)} ${escapeHtml(m.unit || "")} (Minimum: ${formatNum(m.minStock || 0)}).</li>`).join("");
        }
    }

    const decisionBody = $("decisionSupportBody");
    if (decisionBody) {
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
    }

    const goalsList = $("goalsList");
    if (goalsList) {
        goalsList.innerHTML = `
            <li>Procure restock batches for materials tagged as Low or Critical.</li>
            <li>Log incoming shipments under Material Activity to maintain accurate availability counts.</li>
            <li>Review finished product recipe requirements for upcoming production targets.</li>`;
    }
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

/* ==========================================================
   INIT
   ========================================================== */

function init() {
    loadAll();
}
