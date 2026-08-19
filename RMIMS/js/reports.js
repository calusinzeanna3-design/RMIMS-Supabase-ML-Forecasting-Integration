// js/reports.js
//
// Admin — Reports & Decision Support.
// Summarizes live authoritative data from public.raw_materials, public.stock_receipts,
// public.material_disbursements, and public.user_profiles.
//
// Strictly READ-ONLY. Zero direct stock mutations.
// Unit integrity preserved. No price/cost logic. Honest empty state.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

/* ==========================================================
   ROLE GUARD
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
            pText.textContent = `${profile.full_name || profile.email || "Admin"} ▼`;
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

let materials = [];
let usageRecords = [];
let stockReceipts = [];
let finishedProducts = [];
let requirementsByProduct = new Map();

let lastRefreshedAt = null;
let dataLoaded = false;

let reportType = "weekly";           // "weekly" | "monthly"
let anchorDate = startOfWeek(new Date()); // Monday of the visible week, or 1st of visible month

let currentReport = null;            // last generated report data model

const overallTableState = { search: "", status: "all", page: 1, pageSize: 8 };
const capacityTableState = { search: "", category: "all", page: 1, pageSize: 8 };

/* ==========================================================
   GENERIC HELPERS
   ========================================================== */

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}

function fmtQty(qty, unit) {
    if (qty === null || qty === undefined || qty === "" || Number.isNaN(Number(qty))) return "—";
    const n = Number(qty);
    const rounded = Math.round(n * 100) / 100;
    return `${rounded}${unit ? " " + unit : ""}`;
}

function fmtSigned(qty, unit) {
    if (qty === null || qty === undefined) return "—";
    const n = Math.round(Number(qty) * 100) / 100;
    return `${n >= 0 ? "+" : ""}${n}${unit ? " " + unit : ""}`;
}

const toastStack = document.getElementById("toastStack");
function showToast(message, type = "success") {
    if (!toastStack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 260); }, 3400);
}

/* ---------- dates ---------- */

const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function atMidnight(d) {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
}

function addDays(d, n) {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
}

function addMonths(d, n) {
    const c = new Date(d);
    c.setMonth(c.getMonth() + n);
    return c;
}

function startOfWeek(d) {
    const c = atMidnight(d);
    const day = c.getDay(); // 0 = Sun
    const diff = day === 0 ? -6 : 1 - day;
    return addDays(c, diff);
}

function startOfMonth(d) {
    const c = atMidnight(d);
    c.setDate(1);
    return c;
}

function endOfMonth(d) {
    const c = startOfMonth(d);
    return addDays(addMonths(c, 1), -1);
}

function parseDateOnly(value) {
    if (!value) return null;
    const s = String(value).slice(0, 10);
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

function withinRange(dateStr, start, end) {
    const d = parseDateOnly(dateStr);
    if (!d) return false;
    return d >= start && d <= end;
}

function weekLabel(start, end) {
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) {
        return `${MONTHS_ABBR[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
    }
    return `${MONTHS_ABBR[start.getMonth()]} ${start.getDate()} – ${MONTHS_ABBR[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

function monthLabel(d) {
    return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

function shortDate(dateStr) {
    const d = parseDateOnly(dateStr);
    if (!d) return "—";
    return `${MONTHS_ABBR[d.getMonth()]} ${d.getDate()}`;
}

function fullDate(d) {
    return `${MONTHS_FULL[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function fullTime(d) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function currentPeriodRange() {
    if (reportType === "weekly") {
        const start = startOfWeek(anchorDate);
        const end = addDays(start, 6);
        return { start, end };
    }
    const start = startOfMonth(anchorDate);
    const end = endOfMonth(anchorDate);
    return { start, end };
}

function fileBaseName(type, start, end) {
    if (type === "weekly") {
        const mm = MONTHS_ABBR[start.getMonth()];
        const d1 = String(start.getDate()).padStart(2, "0");
        const d2 = String(end.getDate()).padStart(2, "0");
        return `RMIMS_Weekly_Report_${mm}${d1}-${d2}_${end.getFullYear()}`;
    }
    return `RMIMS_Monthly_Report_${MONTHS_FULL[start.getMonth()]}_${start.getFullYear()}`;
}

/* ==========================================================
   DATA LOAD (AUTHORITATIVE V2)
   ========================================================== */

async function loadAllData() {
    const [matRes, useRes, receiptRes] = await Promise.all([
        supabase.from("raw_materials").select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, description").order("name"),
        supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("usage_date", { ascending: false }),
        supabase.from("stock_receipts").select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at").order("receipt_date", { ascending: false })
    ]);

    if (matRes.error) throw matRes.error;
    if (useRes.error) console.warn("Disbursements query notice:", useRes.error);
    if (receiptRes.error) console.warn("Stock receipts query notice:", receiptRes.error);

    const rawMats = matRes.data || [];
    const rawDisbursements = useRes.data || [];
    const rawReceipts = receiptRes.data || [];

    materials = rawMats.map(m => {
        const stock = Number(m.current_stock || 0);
        const minThreshold = m.minimum_threshold !== null ? Number(m.minimum_threshold) : null;
        let status = "Good";
        if (stock <= 0 || (minThreshold !== null && stock <= (minThreshold / 2))) {
            status = "Critical";
        } else if (minThreshold !== null && stock <= minThreshold) {
            status = "Low";
        }
        return {
            id: m.id,
            itemCode: m.item_code,
            materialName: m.name,
            unit: m.unit_of_measure || "kg",
            quantity: stock,
            minimumThreshold: minThreshold,
            reorderQuantity: Number(m.reorder_quantity || 0),
            status
        };
    });

    const matMap = new Map(materials.map(m => [m.id, m]));

    stockReceipts = rawReceipts.map(r => {
        const mat = matMap.get(r.material_id);
        return {
            id: r.id,
            materialId: r.material_id,
            materialName: mat ? mat.materialName : "Raw Material",
            receivedQuantity: Number(r.received_quantity || 0),
            receivedDate: r.receipt_date,
            unit: r.unit || (mat ? mat.unit : "kg"),
            supplierName: r.supplier_name,
            receivedBy: r.received_by,
            createdAt: r.created_at
        };
    });

    usageRecords = rawDisbursements.map(d => {
        const mat = matMap.get(d.material_id);
        const rawProd = d.finished_product_name ? d.finished_product_name.trim() : "";
        const isProductDisbursement = rawProd && rawProd !== "General Usage";
        return {
            id: d.id,
            materialId: d.material_id,
            materialName: mat ? mat.materialName : "Raw Material",
            usedQuantity: Number(d.consumed_quantity || 0),
            usageDate: d.usage_date,
            unit: d.unit || (mat ? mat.unit : "kg"),
            productName: isProductDisbursement ? rawProd : "General Usage",
            productId: isProductDisbursement ? rawProd : null,
            activityType: d.activity_type,
            recordedBy: d.recorded_by,
            createdAt: d.created_at
        };
    });

    // Discover finished products from disbursements
    const productMap = new Map();
    usageRecords.forEach(u => {
        if (!u.productId) return;
        if (!productMap.has(u.productId)) {
            productMap.set(u.productId, {
                id: u.productId,
                productName: u.productId,
                category: u.productId.includes("Bread") || u.productId === "Pandesal" ? "Bakery" : u.productId.includes("Chips") ? "Snacks" : "Production",
                materials: new Map()
            });
        }
        const prod = productMap.get(u.productId);
        const currentUsed = prod.materials.get(u.materialId) || 0;
        prod.materials.set(u.materialId, currentUsed + u.usedQuantity);
    });

    finishedProducts = Array.from(productMap.values()).map(p => ({
        id: p.id,
        productName: p.productName,
        category: p.category,
        status: "Active"
    }));

    requirementsByProduct = new Map();
    productMap.forEach((p, prodId) => {
        const reqList = [];
        p.materials.forEach((tot, matId) => {
            const mat = matMap.get(matId);
            const count = usageRecords.filter(u => u.productId === prodId && u.materialId === matId).length || 1;
            reqList.push({
                productId: prodId,
                materialId: matId,
                requiredQuantity: Math.max(1, Math.round((tot / count) * 100) / 100),
                unit: mat ? mat.unit : "kg"
            });
        });
        requirementsByProduct.set(prodId, reqList);
    });

    lastRefreshedAt = new Date();
    dataLoaded = true;
    const asOfEl = document.getElementById("dataAsOf");
    if (asOfEl) asOfEl.textContent = `Data last refreshed: ${fullDate(lastRefreshedAt)}, ${fullTime(lastRefreshedAt)}`;
}

/* ==========================================================
   STOCK RECONSTRUCTION (previous / period-end quantities)
   ========================================================== */

function stockAsOf(material, asOf) {
    let afterReceived = 0;
    let afterUsed = 0;

    for (const r of stockReceipts) {
        if (r.materialId !== material.id) continue;
        const d = parseDateOnly(r.receivedDate);
        if (d && d > asOf) afterReceived += Number(r.receivedQuantity || 0);
    }
    for (const u of usageRecords) {
        if (u.materialId !== material.id) continue;
        const d = parseDateOnly(u.usageDate);
        if (d && d > asOf) afterUsed += Number(u.usedQuantity || 0);
    }

    return Number(material.quantity || 0) - afterReceived + afterUsed;
}

function statusForQty(qty, minThreshold) {
    if (qty <= 0) return "Critical";
    if (minThreshold !== null && qty < Number(minThreshold)) return "Low";
    return "Good";
}

function statusClass(label) {
    if (label === "Critical") return "critical";
    if (label === "Low") return "low";
    return "good";
}

function liveStatusLabel(material) {
    if (material.status === "Critical") return "Critical";
    if (material.status === "Low") return "Low";
    return "Good";
}

/* ==========================================================
   TREND
   ========================================================== */

function periodLengthDays(start, end) {
    return Math.round((end - start) / 86400000) + 1;
}

function consumedBetween(materialId, start, end) {
    return usageRecords
        .filter(u => u.materialId === materialId && withinRange(u.usageDate, start, end))
        .reduce((s, u) => s + Number(u.usedQuantity || 0), 0);
}

function trendFor(materialId, start, end) {
    const days = periodLengthDays(start, end);
    const prevEnd = addDays(start, -1);
    const prevStart = addDays(prevEnd, -(days - 1));

    const current = consumedBetween(materialId, start, end);
    const previous = consumedBetween(materialId, prevStart, prevEnd);

    if (current === 0 && previous === 0) return { trend: "flat", current, previous };
    if (previous === 0 && current > 0) return { trend: "up", current, previous };
    if (current >= previous * 1.15) return { trend: "up", current, previous };
    if (current <= previous * 0.85) return { trend: "down", current, previous };
    return { trend: "flat", current, previous };
}

/* ==========================================================
   PRODUCTION CAPACITY ENGINE
   ========================================================== */

function computeProductionCapacity() {
    if (finishedProducts.length === 0) return [];

    return finishedProducts.map(product => {
        const reqs = requirementsByProduct.get(product.id) || [];

        if (reqs.length === 0) {
            return {
                product, ok: false, statusLabel: "Incomplete",
                message: "Production capacity cannot be calculated because required material information is incomplete."
            };
        }

        let capacity = Infinity;
        let limiting = null;
        let unitIssue = false;
        let zeroStockMaterial = null;
        let missingMaterial = false;

        for (const r of reqs) {
            const mat = materials.find(m => m.id === r.materialId);
            if (!mat) { missingMaterial = true; continue; }

            if (r.unit && mat.unit && r.unit.trim().toLowerCase() !== mat.unit.trim().toLowerCase()) {
                unitIssue = true;
            }

            const req = Number(r.requiredQuantity || 0);
            if (req <= 0) continue;

            const stock = Number(mat.quantity || 0);
            if (stock <= 0 && !zeroStockMaterial) zeroStockMaterial = mat;

            const possible = Math.floor(stock / req);
            if (possible < capacity) { capacity = possible; limiting = mat; }
        }

        if (unitIssue) {
            return {
                product, ok: false, statusLabel: "Incompatible Units",
                message: "Production capacity cannot be calculated because material units are incompatible."
            };
        }
        if (missingMaterial || capacity === Infinity) {
            return {
                product, ok: false, statusLabel: "Incomplete",
                message: "Production capacity cannot be calculated because required material information is incomplete."
            };
        }
        if (zeroStockMaterial) {
            return {
                product, ok: true, capacity: 0, limiting: zeroStockMaterial, statusLabel: "Limited",
                message: `Production currently limited by ${zeroStockMaterial.materialName}.`
            };
        }

        return { product, ok: true, capacity, limiting, statusLabel: capacity > 0 ? "Limited" : "Critical", message: null };
    });
}

/* ==========================================================
   DECISION SUPPORT ENGINE
   ========================================================== */

function decisionFor(material, trend, isLimiting, periodType) {
    const name = material.materialName;
    const status = liveStatusLabel(material);
    const low = status === "Low" || status === "Critical";
    const highStock = status === "Good" && material.minimumThreshold !== null &&
        Number(material.quantity) >= Number(material.minimumThreshold) * 3;

    const weekly = periodType === "weekly";

    if (low && isLimiting) {
        return {
            finding: weekly ? "Production capacity is currently limited by this material." : "Repeatedly limits production capacity.",
            action: `Review availability of ${name}.`,
            priority: "High"
        };
    }
    if (low && trend === "up") {
        return {
            finding: weekly ? "Usage increased while stock is low." : "Repeated low-stock condition with rising usage.",
            action: "Review replenishment need.",
            priority: "High"
        };
    }
    if (low) {
        return {
            finding: weekly ? `Stock is ${status.toLowerCase()}.` : "Repeated low-stock condition during the period.",
            action: "Review replenishment need.",
            priority: status === "Critical" ? "High" : "Medium"
        };
    }
    if (highStock && trend !== "up") {
        return {
            finding: weekly ? "Stock is high with limited recent usage." : "Consistently high stock with limited usage.",
            action: "Review receiving frequency to avoid unnecessary accumulation.",
            priority: "Medium"
        };
    }
    if (trend === "up") {
        return {
            finding: weekly ? "Usage increased this week." : "Consistently high usage.",
            action: "Continue monitoring usage.",
            priority: "Medium"
        };
    }
    return {
        finding: weekly ? "Usage is stable." : "Stable usage across the period.",
        action: "Maintain current material flow.",
        priority: "Low"
    };
}

const PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };

function buildDecisionRows(start, end, periodType, capacityResults) {
    const limitingIds = new Set(
        capacityResults.filter(r => r.ok && r.limiting).map(r => r.limiting.id)
    );

    const candidateIds = new Set();
    materials.forEach(m => {
        if (m.status === "Low" || m.status === "Critical") candidateIds.add(m.id);
    });
    usageRecords.forEach(u => {
        if (withinRange(u.usageDate, start, end) && u.materialId) candidateIds.add(u.materialId);
    });
    stockReceipts.forEach(r => {
        if (withinRange(r.receivedDate, start, end) && r.materialId) candidateIds.add(r.materialId);
    });
    limitingIds.forEach(id => candidateIds.add(id));

    const rows = [...candidateIds]
        .map(id => materials.find(m => m.id === id))
        .filter(Boolean)
        .map(mat => {
            const { trend } = trendFor(mat.id, start, end);
            const decision = decisionFor(mat, trend, limitingIds.has(mat.id), periodType);
            return {
                material: mat.materialName,
                unit: mat.unit,
                condition: liveStatusLabel(mat),
                finding: decision.finding,
                action: decision.action,
                priority: decision.priority
            };
        });

    rows.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
    return rows.slice(0, 12);
}

/* ==========================================================
   IMPORTANT CHANGES
   ========================================================== */

function buildImportantChanges(start, end) {
    const items = [];

    materials.forEach(m => {
        if (m.status === "Critical") {
            items.push({ weight: 4, cls: "change-warn", text: `⚠ <strong>${escapeHtml(m.materialName)}</strong> stock is critical.` });
        } else if (m.status === "Low") {
            items.push({ weight: 3, cls: "change-warn", text: `⚠ <strong>${escapeHtml(m.materialName)}</strong> stock is low.` });
        }
    });

    materials.forEach(m => {
        const { trend, current, previous } = trendFor(m.id, start, end);
        if (trend === "up" && current > 0) {
            items.push({ weight: 2, cls: "change-up", text: `↑ <strong>${escapeHtml(m.materialName)}</strong> usage increased.` });
        } else if (trend === "down" && previous > 0) {
            items.push({ weight: 1, cls: "change-down", text: `↓ <strong>${escapeHtml(m.materialName)}</strong> usage decreased.` });
        }
    });

    items.sort((a, b) => b.weight - a.weight);
    const top = items.slice(0, 5);

    if (top.length === 0) {
        return [{ cls: "change-flat", text: "No significant changes detected during this period." }];
    }
    return top;
}

/* ==========================================================
   GOALS
   ========================================================== */

function buildWeeklyGoals(decisionRows) {
    const goals = [];
    const actionable = decisionRows.filter(r => r.priority === "High" || r.priority === "Medium").slice(0, 4);

    actionable.forEach(r => {
        if (r.action.startsWith("Review availability")) goals.push(`Review availability of ${r.material} for production.`);
        else if (r.action.startsWith("Review replenishment")) goals.push(`Review ${r.material} replenishment needs.`);
        else if (r.action.startsWith("Continue monitoring")) goals.push(`Continue monitoring ${r.material} usage.`);
        else if (r.action.startsWith("Review receiving")) goals.push(`Review receiving frequency for ${r.material}.`);
        else goals.push(`Maintain stable ${r.material} stock.`);
    });

    goals.push("Monitor materials approaching low-stock levels.");
    return [...new Set(goals)].slice(0, 5);
}

function buildMonthlyGoals(decisionRows) {
    const goals = [];
    const actionable = decisionRows.filter(r => r.priority === "High" || r.priority === "Medium").slice(0, 4);

    actionable.forEach(r => {
        if (r.priority === "High") goals.push(`Improve replenishment planning for ${r.material}.`);
        else goals.push(`Maintain sufficient stock for ${r.material}.`);
    });

    goals.push("Review materials repeatedly limiting production capacity.");
    goals.push("Monitor materials repeatedly reaching low stock.");
    return [...new Set(goals)].slice(0, 5);
}

/* ==========================================================
   REPORT MODEL
   ========================================================== */

function buildReport() {
    const { start, end } = currentPeriodRange();

    // ---- Receive Stocks ----
    const receivedMaterialIds = [...new Set(
        stockReceipts.filter(r => withinRange(r.receivedDate, start, end)).map(r => r.materialId)
    )];
    const receiveRows = receivedMaterialIds.map(id => {
        const mat = materials.find(m => m.id === id);
        if (!mat) return null;
        const receipts = stockReceipts.filter(r => r.materialId === id && withinRange(r.receivedDate, start, end));
        const received = receipts.reduce((s, r) => s + Number(r.receivedQuantity || 0), 0);
        const lastReceive = receipts.reduce((latest, r) => {
            const d = parseDateOnly(r.receivedDate);
            return (!latest || (d && d > latest)) ? d : latest;
        }, null);
        const previous = stockAsOf(mat, addDays(start, -1));
        const current = stockAsOf(mat, end);
        return {
            material: mat.materialName, unit: mat.unit,
            previous, received, lastReceive: lastReceive ? shortDate(lastReceive.toISOString()) : "—",
            current, statusLabel: statusForQty(current, mat.minimumThreshold)
        };
    }).filter(Boolean).sort((a, b) => a.material.localeCompare(b.material));

    // ---- Consumed Stocks ----
    const consumedMaterialIds = [...new Set(
        usageRecords.filter(u => withinRange(u.usageDate, start, end)).map(u => u.materialId)
    )];
    const consumedRows = consumedMaterialIds.map(id => {
        const mat = materials.find(m => m.id === id);
        if (!mat) return null;
        const consumed = consumedBetween(id, start, end);
        const previous = stockAsOf(mat, addDays(start, -1));
        const current = stockAsOf(mat, end);
        const { trend } = trendFor(id, start, end);
        return {
            material: mat.materialName, unit: mat.unit,
            previous, consumed, current, trend,
            statusLabel: statusForQty(current, mat.minimumThreshold)
        };
    }).filter(Boolean).sort((a, b) => a.material.localeCompare(b.material));

    // ---- Disbursement Progress ----
    const disbursementMap = new Map();
    usageRecords
        .filter(u => withinRange(u.usageDate, start, end) && u.productId)
        .forEach(u => {
            const key = `${u.materialId}|${u.productId}`;
            const d = parseDateOnly(u.usageDate);
            if (!disbursementMap.has(key)) {
                disbursementMap.set(key, {
                    material: u.materialName, product: u.productName || "—",
                    unit: u.unit, qty: 0, date: d
                });
            }
            const row = disbursementMap.get(key);
            row.qty += Number(u.usedQuantity || 0);
            if (d && (!row.date || d > row.date)) row.date = d;
        });
    const disbursementRows = [...disbursementMap.values()]
        .map(r => ({ ...r, date: r.date ? shortDate(r.date.toISOString()) : "—" }))
        .sort((a, b) => a.material.localeCompare(b.material));

    // ---- Overall Raw Materials ----
    const overallRows = materials.map(m => ({
        material: m.materialName, unit: m.unit,
        current: Number(m.quantity || 0), min: Number(m.minimumThreshold || 0),
        max: null,
        statusLabel: liveStatusLabel(m)
    })).sort((a, b) => a.material.localeCompare(b.material));

    // ---- Production Capacity ----
    const capacityResults = computeProductionCapacity();
    const capacityRows = capacityResults.map(r => ({
        product: r.product.productName, category: r.product.category || "Uncategorized",
        ok: r.ok, statusLabel: r.statusLabel,
        limiting: r.limiting ? r.limiting.materialName : "—",
        capacity: r.ok ? r.capacity : null,
        canProduce: r.ok ? fmtQty(r.capacity, "batches") : "—",
        message: r.message
    })).sort((a, b) => a.product.localeCompare(b.product));

    // ---- Decisions & Goals ----
    const importantChanges = buildImportantChanges(start, end);
    const decisionRows = buildDecisionRows(start, end, reportType, capacityResults);
    const goals = reportType === "weekly" ? buildWeeklyGoals(decisionRows) : buildMonthlyGoals(decisionRows);

    let immediateGoals = null;
    if (reportType === "monthly") {
        const iEnd = atMidnight(new Date());
        const iStart = addDays(iEnd, -6);
        const iCapacity = computeProductionCapacity();
        const iDecisions = buildDecisionRows(iStart, iEnd, "weekly", iCapacity);
        immediateGoals = buildWeeklyGoals(iDecisions);
    }

    // ---- Summary Cards ----
    const summary = {
        received: stockReceipts.filter(r => withinRange(r.receivedDate, start, end)).length,
        consumed: usageRecords.filter(u => withinRange(u.usageDate, start, end)).length,
        disbursed: usageRecords.filter(u => withinRange(u.usageDate, start, end) && u.productId).length,
        attention: materials.filter(m => m.status === "Low" || m.status === "Critical").length,
    };

    return {
        type: reportType, start, end,
        periodLabel: reportType === "weekly" ? weekLabel(start, end) : monthLabel(start),
        generatedAt: new Date(),
        snapshotAt: lastRefreshedAt || new Date(),
        summary, receiveRows, consumedRows, disbursementRows, overallRows, capacityRows,
        importantChanges, decisionRows, goals, immediateGoals,
        categories: [...new Set(finishedProducts.map(p => p.category).filter(Boolean))].sort()
    };
}

/* ==========================================================
   RENDER — CONTROL BAR
   ========================================================== */

function renderPeriodLabel() {
    const { start, end } = currentPeriodRange();
    const lbl = document.getElementById("periodLabel");
    if (lbl) {
        lbl.textContent = reportType === "weekly" ? weekLabel(start, end) : monthLabel(start);
    }
}

const reportTypeEl = document.getElementById("reportType");
if (reportTypeEl) {
    reportTypeEl.addEventListener("change", (e) => {
        reportType = e.target.value;
        anchorDate = reportType === "weekly" ? startOfWeek(new Date()) : startOfMonth(new Date());
        renderPeriodLabel();
    });
}

const periodPrevEl = document.getElementById("periodPrev");
if (periodPrevEl) {
    periodPrevEl.addEventListener("click", () => {
        anchorDate = reportType === "weekly" ? addDays(anchorDate, -7) : addMonths(anchorDate, -1);
        renderPeriodLabel();
    });
}

const periodNextEl = document.getElementById("periodNext");
if (periodNextEl) {
    periodNextEl.addEventListener("click", () => {
        anchorDate = reportType === "weekly" ? addDays(anchorDate, 7) : addMonths(anchorDate, 1);
        renderPeriodLabel();
    });
}

/* ==========================================================
   REFRESH
   ========================================================== */

const refreshBtn = document.getElementById("refreshBtn");
const refreshIcon = document.getElementById("refreshIcon");
const refreshLabel = document.getElementById("refreshLabel");

if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
        refreshBtn.disabled = true;
        refreshBtn.classList.add("spinning");
        if (refreshLabel) refreshLabel.textContent = "Refreshing...";

        try {
            await loadAllData();
            showToast("Data refreshed successfully.");
        } catch (err) {
            console.error(err);
            showToast("Unable to refresh data. Please try again.", "error");
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove("spinning");
            if (refreshLabel) refreshLabel.textContent = "Refresh";
        }
    });
}

/* ==========================================================
   GENERATE REPORT
   ========================================================== */

const generateBtn = document.getElementById("generateBtn");
if (generateBtn) {
    generateBtn.addEventListener("click", async () => {
        if (!dataLoaded) {
            try { await loadAllData(); } catch (err) {
                console.error(err);
                showToast("Unable to load data. Please try again.", "error");
                return;
            }
        }

        overallTableState.page = 1;
        overallTableState.search = "";
        overallTableState.status = "all";
        const ovSearch = document.getElementById("overallSearch");
        if (ovSearch) ovSearch.value = "";
        const ovStatus = document.getElementById("overallStatusFilter");
        if (ovStatus) ovStatus.value = "all";

        capacityTableState.page = 1;
        capacityTableState.search = "";
        capacityTableState.category = "all";
        const capSearch = document.getElementById("capacitySearch");
        if (capSearch) capSearch.value = "";
        const capCat = document.getElementById("capacityCategoryFilter");
        if (capCat) capCat.value = "all";

        currentReport = buildReport();
        renderReport(currentReport);

        const emptyEl = document.getElementById("reportEmptyState");
        if (emptyEl) emptyEl.hidden = true;
        const printEl = document.getElementById("printArea");
        if (printEl) printEl.hidden = false;
        const actEl = document.getElementById("reportActions");
        if (actEl) actEl.hidden = false;

        showToast("Report generated.");
    });
}

/* ==========================================================
   RENDER REPORT
   ========================================================== */

function renderReport(report) {
    const summaryTypeEl = document.getElementById("reportSummaryType");
    if (summaryTypeEl) summaryTypeEl.textContent = report.type === "weekly" ? "Weekly Report" : "Monthly Report";
    const summaryPeriodEl = document.getElementById("reportSummaryPeriod");
    if (summaryPeriodEl) summaryPeriodEl.textContent = report.periodLabel;
    const genAtEl = document.getElementById("reportGeneratedAt");
    if (genAtEl) genAtEl.textContent = `${fullDate(report.generatedAt)}, ${fullTime(report.generatedAt)}`;

    const cardRec = document.getElementById("cardReceived");
    if (cardRec) cardRec.textContent = `${report.summary.received} activities`;
    const cardCons = document.getElementById("cardConsumed");
    if (cardCons) cardCons.textContent = `${report.summary.consumed} activities`;
    const cardDisb = document.getElementById("cardDisbursed");
    if (cardDisb) cardDisb.textContent = `${report.summary.disbursed} activities`;
    const cardAttn = document.getElementById("cardAttention");
    if (cardAttn) cardAttn.textContent = `${report.summary.attention} materials`;

    const recNote = document.getElementById("receiveNote");
    if (recNote) recNote.textContent = report.periodLabel;
    const consNote = document.getElementById("consumedNote");
    if (consNote) consNote.textContent = report.periodLabel;
    const ovAsOf = document.getElementById("overallAsOf");
    if (ovAsOf) ovAsOf.textContent = `${fullDate(report.snapshotAt)}, ${fullTime(report.snapshotAt)}`;
    const capAsOf = document.getElementById("capacityAsOf");
    if (capAsOf) capAsOf.textContent = `${fullDate(report.snapshotAt)}, ${fullTime(report.snapshotAt)}`;

    renderReceiveTable(report);
    renderConsumedTable(report);
    renderDisbursementTable(report);
    renderCapacityCategoryOptions(report);
    renderOverallTable(report);
    renderCapacityTable(report);
    renderImportantChanges(report);
    renderDecisionSupport(report);
    renderGoals(report);
}

function renderReceiveTable(report) {
    const body = document.getElementById("receiveStocksBody");
    if (!body) return;
    if (report.receiveRows.length === 0) {
        body.innerHTML = `<tr class="empty-row"><td colspan="6">No receiving activity recorded for this period.</td></tr>`;
        return;
    }
    body.innerHTML = report.receiveRows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.material)}</strong></td>
            <td>${fmtQty(r.previous, r.unit)}</td>
            <td>${fmtQty(r.received, r.unit)}</td>
            <td>${escapeHtml(r.lastReceive)}</td>
            <td>${fmtQty(r.current, r.unit)}</td>
            <td><span class="status ${statusClass(r.statusLabel)}">${r.statusLabel}</span></td>
        </tr>`).join("");
}

function renderConsumedTable(report) {
    const body = document.getElementById("consumedStocksBody");
    if (!body) return;
    if (report.consumedRows.length === 0) {
        body.innerHTML = `<tr class="empty-row"><td colspan="6">No consumption activity recorded for this period.</td></tr>`;
        return;
    }
    const trendGlyph = { up: '<span class="trend-up">↑</span>', down: '<span class="trend-down">↓</span>', flat: '<span class="trend-flat">→</span>' };
    body.innerHTML = report.consumedRows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.material)}</strong></td>
            <td>${fmtQty(r.previous, r.unit)}</td>
            <td>${fmtQty(r.consumed, r.unit)}</td>
            <td>${fmtQty(r.current, r.unit)}</td>
            <td>${trendGlyph[r.trend] || "→"}</td>
            <td><span class="status ${statusClass(r.statusLabel)}">${r.statusLabel}</span></td>
        </tr>`).join("");
}

function renderDisbursementTable(report) {
    const body = document.getElementById("disbursementBody");
    if (!body) return;
    if (report.disbursementRows.length === 0) {
        body.innerHTML = `<tr class="empty-row"><td colspan="6">No materials were disbursed for production during this period.</td></tr>`;
        return;
    }
    body.innerHTML = report.disbursementRows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.material)}</strong></td>
            <td>${escapeHtml(r.product)}</td>
            <td>${fmtQty(r.qty, r.unit)}</td>
            <td>${escapeHtml(r.date)}</td>
            <td>100%</td>
            <td><span class="status complete">Complete</span></td>
        </tr>`).join("");
}

function filteredOverallRows(report) {
    const term = overallTableState.search.trim().toLowerCase();
    return report.overallRows.filter(r => {
        if (term && !r.material.toLowerCase().includes(term)) return false;
        if (overallTableState.status !== "all" && r.statusLabel !== overallTableState.status) return false;
        return true;
    });
}

function renderOverallTable(report) {
    const body = document.getElementById("overallBody");
    if (!body) return;
    const rows = filteredOverallRows(report);

    if (rows.length === 0) {
        body.innerHTML = `<tr class="empty-row"><td colspan="5">No raw materials match this search.</td></tr>`;
        const pag = document.getElementById("overallPagination");
        if (pag) pag.innerHTML = "";
        return;
    }

    const { pageRows, page, totalPages } = paginate(rows, overallTableState.page, overallTableState.pageSize);
    overallTableState.page = page;

    body.innerHTML = pageRows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.material)}</strong></td>
            <td>${fmtQty(r.current, r.unit)}</td>
            <td>${fmtQty(r.min, r.unit)}</td>
            <td>${r.max === null ? "—" : fmtQty(r.max, r.unit)}</td>
            <td><span class="status ${statusClass(r.statusLabel)}">${r.statusLabel}</span></td>
        </tr>`).join("");

    renderPagination("overallPagination", page, totalPages, (p) => { overallTableState.page = p; renderOverallTable(report); });
}

function renderCapacityCategoryOptions(report) {
    const select = document.getElementById("capacityCategoryFilter");
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="all">All Categories</option>` +
        report.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    select.value = report.categories.includes(current) ? current : "all";
}

function filteredCapacityRows(report) {
    const term = capacityTableState.search.trim().toLowerCase();
    return report.capacityRows.filter(r => {
        if (term && !r.product.toLowerCase().includes(term)) return false;
        if (capacityTableState.category !== "all" && r.category !== capacityTableState.category) return false;
        return true;
    });
}

function renderCapacityTable(report) {
    const body = document.getElementById("capacityBody");
    if (!body) return;
    const rows = filteredCapacityRows(report);

    if (rows.length === 0) {
        body.innerHTML = `<tr class="empty-row"><td colspan="5">No finished products match this search.</td></tr>`;
        const pag = document.getElementById("capacityPagination");
        if (pag) pag.innerHTML = "";
        return;
    }

    const { pageRows, page, totalPages } = paginate(rows, capacityTableState.page, capacityTableState.pageSize);
    capacityTableState.page = page;

    body.innerHTML = pageRows.map(r => {
        if (!r.ok) {
            return `<tr>
                <td><strong>${escapeHtml(r.product)}</strong></td>
                <td colspan="4" class="capacity-message">${escapeHtml(r.message)}</td>
            </tr>`;
        }
        return `<tr>
            <td><strong>${escapeHtml(r.product)}</strong></td>
            <td>${escapeHtml(r.limiting)}</td>
            <td>${r.canProduce}</td>
            <td>${r.canProduce}</td>
            <td><span class="status ${r.capacity === 0 ? "critical" : "limited"}">${r.statusLabel}</span></td>
        </tr>`;
    }).join("");

    renderPagination("capacityPagination", page, totalPages, (p) => { capacityTableState.page = p; renderCapacityTable(report); });
}

function paginate(rows, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return { pageRows: rows.slice(start, start + pageSize), page: safePage, totalPages };
}

function renderPagination(containerId, page, totalPages, onChange) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (totalPages <= 1) { el.innerHTML = ""; return; }

    let html = `<button ${page === 1 ? "disabled" : ""} data-p="${page - 1}">‹</button>`;
    for (let p = 1; p <= totalPages; p++) {
        html += `<button class="${p === page ? "active" : ""}" data-p="${p}">${p}</button>`;
    }
    html += `<button ${page === totalPages ? "disabled" : ""} data-p="${page + 1}">›</button>`;
    el.innerHTML = html;

    el.querySelectorAll("button[data-p]").forEach(btn => {
        btn.addEventListener("click", () => onChange(Number(btn.dataset.p)));
    });
}

const ovSearchEl = document.getElementById("overallSearch");
if (ovSearchEl) {
    ovSearchEl.addEventListener("input", (e) => {
        overallTableState.search = e.target.value;
        overallTableState.page = 1;
        if (currentReport) renderOverallTable(currentReport);
    });
}

const ovStatusEl = document.getElementById("overallStatusFilter");
if (ovStatusEl) {
    ovStatusEl.addEventListener("change", (e) => {
        overallTableState.status = e.target.value;
        overallTableState.page = 1;
        if (currentReport) renderOverallTable(currentReport);
    });
}

const capSearchEl = document.getElementById("capacitySearch");
if (capSearchEl) {
    capSearchEl.addEventListener("input", (e) => {
        capacityTableState.search = e.target.value;
        capacityTableState.page = 1;
        if (currentReport) renderCapacityTable(currentReport);
    });
}

const capCatEl = document.getElementById("capacityCategoryFilter");
if (capCatEl) {
    capCatEl.addEventListener("change", (e) => {
        capacityTableState.category = e.target.value;
        capacityTableState.page = 1;
        if (currentReport) renderCapacityTable(currentReport);
    });
}

function renderImportantChanges(report) {
    const list = document.getElementById("importantChangesList");
    if (!list) return;
    list.innerHTML = report.importantChanges.map(c => `<li class="${c.cls}">${c.text}</li>`).join("");
}

function renderDecisionSupport(report) {
    const title = document.getElementById("decisionSupportTitle");
    const head = document.getElementById("decisionSupportHead");
    const body = document.getElementById("decisionSupportBody");
    if (!title || !head || !body) return;

    if (report.type === "weekly") {
        title.textContent = "Decision Support — Next 7 Days";
        head.innerHTML = `<tr><th>Raw Material</th><th>Current Condition</th><th>Finding</th><th>Recommended Action</th><th>Priority</th></tr>`;
        body.innerHTML = report.decisionRows.length ? report.decisionRows.map(r => `
            <tr>
                <td><strong>${escapeHtml(r.material)}</strong></td>
                <td><span class="status ${statusClass(r.condition)}">${r.condition}</span></td>
                <td>${escapeHtml(r.finding)}</td>
                <td>${escapeHtml(r.action)}</td>
                <td><span class="priority ${r.priority.toLowerCase()}">${r.priority}</span></td>
            </tr>`).join("") : `<tr class="empty-row"><td colspan="5">No materials currently require attention.</td></tr>`;
    } else {
        title.textContent = "Monthly Decisions";
        head.innerHTML = `<tr><th>Raw Material</th><th>Monthly Finding</th><th>Recommended Direction</th><th>Priority</th></tr>`;
        body.innerHTML = report.decisionRows.length ? report.decisionRows.map(r => `
            <tr>
                <td><strong>${escapeHtml(r.material)}</strong></td>
                <td>${escapeHtml(r.finding)}</td>
                <td>${escapeHtml(r.action)}</td>
                <td><span class="priority ${r.priority.toLowerCase()}">${r.priority}</span></td>
            </tr>`).join("") : `<tr class="empty-row"><td colspan="4">No materials currently require attention.</td></tr>`;
    }
}

function renderGoals(report) {
    const title = document.getElementById("goalsTitle");
    if (title) {
        title.innerHTML = `
            <span class="title-icon icon-goals"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg></span>
            ${report.type === "weekly" ? "Next 7-Day Goals" : "Next Month Goals"}`;
    }

    const list = document.getElementById("goalsList");
    if (list) list.innerHTML = report.goals.map(g => `<li>${escapeHtml(g)}</li>`).join("");

    const immSection = document.getElementById("immediateGoalsSection");
    if (immSection) {
        if (report.type === "monthly" && report.immediateGoals) {
            immSection.hidden = false;
            const immList = document.getElementById("immediateGoalsList");
            if (immList) immList.innerHTML = report.immediateGoals.map(g => `<li>${escapeHtml(g)}</li>`).join("");
        } else {
            immSection.hidden = true;
        }
    }
}

/* ==========================================================
   PDF EXPORT (jsPDF + autoTable)
   ========================================================== */

const RM_GREEN = [22, 128, 60];
const RM_INK = [15, 23, 42];
const RM_DIM = [124, 138, 163];

function drawDocumentHeader(doc, report, opts) {
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 40;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...RM_GREEN);
    doc.text("RMIMS", 40, y);

    doc.setFontSize(9);
    doc.setTextColor(...RM_DIM);
    doc.setFont("helvetica", "normal");
    doc.text("RAW MATERIALS INVENTORY — REPORTS & DECISION SUPPORT", 40, y + 14);

    y += 40;
    doc.setDrawColor(220, 226, 236);
    doc.line(40, y, pageWidth - 40, y);
    y += 22;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...RM_INK);
    doc.text(opts.title, 40, y);
    y += 22;

    const meta = opts.meta;
    doc.setFontSize(9);
    const colW = (pageWidth - 80) / 2;
    let leftY = y, rightY = y;
    meta.forEach((row, i) => {
        const col = i % 2;
        const yy = col === 0 ? leftY : rightY;
        const x = 40 + col * colW;
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...RM_DIM);
        doc.text(row[0].toUpperCase(), x, yy);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...RM_INK);
        doc.text(String(row[1]), x, yy + 12);
        if (col === 0) leftY += 30; else rightY += 30;
    });

    y = Math.max(leftY, rightY) + 6;
    doc.setDrawColor(220, 226, 236);
    doc.line(40, y, pageWidth - 40, y);
    return y + 18;
}

function baseMeta(report, statusLabel) {
    const now = new Date();
    return [
        ["Report Type", report.type === "weekly" ? "Weekly" : "Monthly"],
        ["Report Period", report.periodLabel],
        ["Generated Date", fullDate(now)],
        ["Generated Time", fullTime(now)],
        ["Report Status", statusLabel || "Final Snapshot"],
        ["Prepared For", "MSME Inventory Management"],
        ["Prepared By", "RMIMS"],
        ["Source", "raw_materials + stock_receipts + material_disbursements"]
    ];
}

function snapshotMeta(report) {
    return [
        ["Report Type", "Current Snapshot"],
        ["As of Date", fullDate(report.snapshotAt)],
        ["As of Time", fullTime(report.snapshotAt)],
        ["Generated Date", fullDate(new Date())],
        ["Generated Time", fullTime(new Date())],
        ["Prepared For", "MSME Inventory Management"],
        ["Prepared By", "RMIMS"],
        ["Source", "raw_materials + stock_receipts + material_disbursements"]
    ];
}

function drawFooters(doc, report) {
    const pages = doc.internal.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(230, 234, 242);
        doc.line(40, pageHeight - 34, pageWidth - 40, pageHeight - 34);
        doc.setFontSize(8);
        doc.setTextColor(...RM_DIM);
        doc.setFont("helvetica", "normal");
        doc.text(`RMIMS | Reports & Decision Support`, 40, pageHeight - 20);
        doc.text(`${report.periodLabel}`, pageWidth / 2 - 40, pageHeight - 20);
        doc.text(`Page ${i} of ${pages}`, pageWidth - 90, pageHeight - 20);
    }
}

function autoTableSection(doc, y, title, head, rows, colStyles) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...RM_INK);
    doc.text(title, 40, y);
    doc.autoTable({
        startY: y + 8,
        head: [head],
        body: rows,
        margin: { left: 40, right: 40 },
        styles: { font: "helvetica", fontSize: 8.5, textColor: RM_INK, cellPadding: 6 },
        headStyles: { fillColor: [248, 250, 253], textColor: RM_DIM, fontStyle: "bold" },
        columnStyles: colStyles || {}
    });
    return doc.lastAutoTable.finalY + 26;
}

function textList(doc, y, title, items, numbered) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...RM_INK);
    doc.text(title, 40, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const pageWidth = doc.internal.pageSize.getWidth();
    items.forEach((raw, i) => {
        const text = raw.replace(/<[^>]+>/g, "");
        const prefix = numbered ? `${i + 1}. ` : "• ";
        const lines = doc.splitTextToSize(prefix + text, pageWidth - 80);
        lines.forEach(line => {
            if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 40; }
            doc.text(line, 40, y);
            y += 13;
        });
    });
    return y + 16;
}

function newPdf() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: "pt", format: "a4" });
}

function ensureSpace(doc, y) {
    if (y > doc.internal.pageSize.getHeight() - 100) {
        doc.addPage();
        return 48;
    }
    return y;
}

function drawMiniBarChart(doc, title, rows, valueKey, unitLabel = "") {
    let y = ensureSpace(doc, doc.lastAutoTable ? doc.lastAutoTable.finalY + 16 : 80);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...RM_INK);
    doc.text(title, 40, y);
    y += 14;
    const max = Math.max(...rows.map(r => Number(r[valueKey] || 0)), 1);
    rows.slice(0, 8).forEach((r) => {
        const label = String(r.material || "").slice(0, 20);
        const value = Number(r[valueKey] || 0);
        const barW = Math.max(2, (pageWidthFor(doc) - 210) * (value / max));
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...RM_DIM);
        doc.text(label, 40, y + 7);
        doc.setFillColor(22, 128, 60); doc.roundedRect(145, y, barW, 9, 2, 2, "F");
        doc.setTextColor(...RM_INK); doc.text(`${value}${unitLabel ? " " + unitLabel : ""}`, 150 + barW, y + 7);
        y += 15;
    });
    return y + 6;
}
function pageWidthFor(doc) { return doc.internal.pageSize.getWidth(); }

function selectedReportLabel(key) {
    return ({ manager: "Manager Summary", inventory: "Inventory Records", receiving: "Material Receiving", disbursement: "Material Disbursement", activity: "Material Activity", consumption: "Consumption Analysis", decision: "Decision Support" })[key] || key;
}

function addSelectedPdfSection(doc, report, key, y) {
    if (key === "manager") {
        y = autoTableSection(doc, y, "Manager Overview", ["Metric", "Result"], [
            ["Total Materials", String(report.overallRows.length)],
            ["Good Stock", String(report.overallRows.filter(r => r.statusLabel === "Good").length)],
            ["Low / Critical", String(report.summary.attention)],
            ["Receiving Records", String(report.summary.received)],
            ["Consumption Records", String(report.summary.consumed)],
            ["Disbursement Records", String(report.summary.disbursed)],
        ]);
        y = ensureSpace(doc, y);
        y = autoTableSection(doc, y, "Manager Decision Breakdown", ["Priority", "Material", "What the Data Shows", "Suggested Action"],
            report.decisionRows.map(r => [r.priority, r.material, r.finding, r.action]));
        return y;
    }
    if (key === "inventory") {
        return autoTableSection(doc, y, "Inventory Records", ["Material", "Current Stock", "Minimum Stock", "Status"],
            report.overallRows.map(r => [r.material, fmtQty(r.current, r.unit), fmtQty(r.min, r.unit), r.statusLabel]));
    }
    if (key === "receiving") {
        return autoTableSection(doc, y, "Material Receiving", ["Material", "Previous Stock", "Received", "Last Receive", "Current Stock", "Status"],
            report.receiveRows.map(r => [r.material, fmtQty(r.previous, r.unit), fmtQty(r.received, r.unit), r.lastReceive, fmtQty(r.current, r.unit), r.statusLabel]));
    }
    if (key === "disbursement") {
        return autoTableSection(doc, y, "Material Disbursement / Release", ["Material", "Finished Product", "Released", "Date", "Status"],
            report.disbursementRows.map(r => [r.material, r.product, fmtQty(r.qty, r.unit), r.date, "Recorded"]));
    }
    if (key === "activity") {
        const rows = [];
        stockReceipts.filter(r => withinRange(r.receivedDate, report.start, report.end)).forEach(r => rows.push([r.receivedDate || "—", "Received", r.materialName, fmtSigned(Number(r.receivedQuantity || 0), r.unit || ""), "—"]));
        usageRecords.filter(u => withinRange(u.usageDate, report.start, report.end)).forEach(u => rows.push([u.usageDate || "—", u.productId ? "Disbursed / Used" : "Consumed", u.materialName, fmtSigned(-Number(u.usedQuantity || 0), u.unit || ""), u.productName || "—"]));
        rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        return autoTableSection(doc, y, "Material Activity Records", ["Date", "Activity", "Material", "Quantity", "Purpose / Product"], rows);
    }
    if (key === "consumption") {
        y = autoTableSection(doc, y, "Consumption Breakdown", ["Material", "Previous Stock", "Consumed", "Current Stock", "Trend", "Status"],
            report.consumedRows.map(r => [r.material, fmtQty(r.previous, r.unit), fmtQty(r.consumed, r.unit), fmtQty(r.current, r.unit), r.trend === "up" ? "Increasing" : r.trend === "down" ? "Decreasing" : "Stable", r.statusLabel]));
        y = ensureSpace(doc, y);
        return drawMiniBarChart(doc, "Top Recorded Consumption", report.consumedRows, "consumed");
    }
    if (key === "decision") {
        y = autoTableSection(doc, y, "Decision Support", ["Priority", "Material", "Condition", "Finding", "Recommended Action"],
            report.decisionRows.map(r => [r.priority, r.material, r.condition, r.finding, r.action]));
        return textList(doc, y, "Management Goals", report.goals, true);
    }
    return y;
}

function buildMainPdf(report, selectedKeys = ["manager"]) {
    const doc = newPdf();
    let y = drawDocumentHeader(doc, report, { title: "RMSME Report Package", meta: baseMeta(report) });
    selectedKeys.forEach((key, index) => {
        if (index > 0) { doc.addPage(); y = 48; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...RM_GREEN);
        doc.text(selectedReportLabel(key), 40, y); y += 18;
        y = addSelectedPdfSection(doc, report, key, y);
    });
    drawFooters(doc, report);
    return doc;
}

/* ==========================================================
   SAVE MODAL / DOWNLOAD ORCHESTRATION
   ========================================================== */

const saveModalOverlay = document.getElementById("saveModalOverlay");
const saveReportName = document.getElementById("saveReportName");
const saveModalSubtitle = document.getElementById("saveModalSubtitle");

function getSelectedReportKeys() {
    return [...document.querySelectorAll('#reportSelection input[type="checkbox"]:checked')].map(x => x.value);
}
function updateSelectedReportCount() {
    const n = getSelectedReportKeys().length;
    const cntEl = document.getElementById("selectedReportCount");
    if (cntEl) cntEl.textContent = `${n} selected`;
}
function openSaveModal(preferredFormat) {
    if (!currentReport) return;
    if (saveReportName) saveReportName.value = fileBaseName(currentReport.type, currentReport.start, currentReport.end);
    if (saveModalSubtitle) saveModalSubtitle.textContent = `${currentReport.type === "weekly" ? "Weekly" : "Monthly"} Report · ${currentReport.periodLabel}`;
    const prefEl = document.querySelector(`input[name="saveFormat"][value="${preferredFormat}"]`);
    if (prefEl) prefEl.checked = true;
    document.querySelectorAll('#reportSelection input[type="checkbox"]').forEach(x => x.checked = x.value === "manager");
    updateSelectedReportCount();
    if (saveModalOverlay) saveModalOverlay.classList.add("open");
}
function closeSaveModal() {
    window.__rmsmePrintMode = false;
    if (saveModalOverlay) saveModalOverlay.classList.remove("open");
}

const savePdfBtn = document.getElementById("saveAsPdfBtn");
if (savePdfBtn) savePdfBtn.addEventListener("click", () => openSaveModal("pdf"));
const saveExcelBtn = document.getElementById("saveAsExcelBtn");
if (saveExcelBtn) saveExcelBtn.addEventListener("click", () => openSaveModal("excel"));
const saveCloseBtn = document.getElementById("saveModalClose");
if (saveCloseBtn) saveCloseBtn.addEventListener("click", closeSaveModal);
const saveCancelBtn = document.getElementById("saveModalCancel");
if (saveCancelBtn) saveCancelBtn.addEventListener("click", closeSaveModal);
if (saveModalOverlay) saveModalOverlay.addEventListener("click", e => { if (e.target === saveModalOverlay) closeSaveModal(); });
document.querySelectorAll('#reportSelection input[type="checkbox"]').forEach(x => x.addEventListener("change", updateSelectedReportCount));

const selAllBtn = document.getElementById("selectAllReports");
if (selAllBtn) {
    selAllBtn.addEventListener("click", () => {
        document.querySelectorAll('#reportSelection input[type="checkbox"]').forEach(x => x.checked = true);
        updateSelectedReportCount();
    });
}
const clearAllBtn = document.getElementById("clearAllReports");
if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
        document.querySelectorAll('#reportSelection input[type="checkbox"]').forEach(x => x.checked = false);
        updateSelectedReportCount();
    });
}

const browseBtn = document.getElementById("browseLocationBtn");
if (browseBtn) {
    browseBtn.addEventListener("click", async () => {
        if (!window.showDirectoryPicker) { showToast("Your browser will use its default downloads location.", "success"); return; }
        try {
            const handle = await window.showDirectoryPicker();
            const locDisp = document.getElementById("saveLocationDisplay");
            if (locDisp) locDisp.value = handle.name;
        } catch { }
    });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const saveConfirmBtn = document.getElementById("saveModalConfirm");
if (saveConfirmBtn) {
    saveConfirmBtn.addEventListener("click", async () => {
        if (window.__rmsmePrintMode) {
            const selected = getSelectedReportKeys();
            if (!selected.length) { showToast("Select at least one report.", "error"); return; }
            const blob = buildMainPdf(currentReport, selected).output("blob");
            const url = URL.createObjectURL(blob);
            const w = window.open(url, "_blank");
            if (w) { w.onload = () => setTimeout(() => w.print(), 500); } else { downloadBlob(blob, "RMSME_Selected_Report.pdf"); }
            window.__rmsmePrintMode = false;
            closeSaveModal();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            return;
        }
        if (!currentReport) return;
        const selected = getSelectedReportKeys();
        if (!selected.length) { showToast("Select at least one report.", "error"); return; }
        const format = document.querySelector('input[name="saveFormat"]:checked')?.value || "both";
        const baseName = (saveReportName?.value || fileBaseName(currentReport.type, currentReport.start, currentReport.end)).trim();
        const btn = document.getElementById("saveModalConfirm");
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Preparing...";
        try {
            const pdfBlob = (format === "pdf" || format === "both") ? buildMainPdf(currentReport, selected).output("blob") : null;
            const xlsxBlob = (format === "excel" || format === "both") ? new Blob([XLSX.write(buildSelectedWorkbook(currentReport, selected), { bookType: "xlsx", type: "array" })], { type: "application/octet-stream" }) : null;
            if (format === "pdf" || format === "both") downloadBlob(pdfBlob, `${baseName}.pdf`);
            if (format === "excel" || format === "both") downloadBlob(xlsxBlob, `${baseName}.xlsx`);
            showToast(`${selected.length} report section${selected.length > 1 ? "s" : ""} saved.`);
            closeSaveModal();
        } catch (err) {
            console.error(err);
            showToast("Could not save the selected reports.", "error");
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    });
}

function buildSelectedWorkbook(report, selected) {
    const wb = XLSX.utils.book_new();
    const add = (name, head, rows) => {
        const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
        XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    };
    if (selected.includes("manager")) add("Manager Summary", ["Metric", "Result"], [
        ["Total Materials", report.overallRows.length], ["Good Stock", report.overallRows.filter(r => r.statusLabel === "Good").length], ["Low / Critical", report.summary.attention], ["Receiving Records", report.summary.received], ["Consumption Records", report.summary.consumed], ["Disbursement Records", report.summary.disbursed]
    ]);
    if (selected.includes("inventory")) add("Inventory", ["Material", "Current Stock", "Minimum Stock", "Status"], report.overallRows.map(r => [r.material, r.current, r.min, r.statusLabel]));
    if (selected.includes("receiving")) add("Receiving", ["Material", "Previous Stock", "Received", "Last Receive", "Current Stock", "Status"], report.receiveRows.map(r => [r.material, r.previous, r.received, r.lastReceive, r.current, r.statusLabel]));
    if (selected.includes("disbursement")) add("Disbursement", ["Material", "Finished Product", "Released", "Date", "Status"], report.disbursementRows.map(r => [r.material, r.product, r.qty, r.date, "Recorded"]));
    if (selected.includes("activity")) {
        const rows = [];
        stockReceipts.filter(r => withinRange(r.receivedDate, report.start, report.end)).forEach(r => rows.push([r.receivedDate || "—", "Received", r.materialName, Number(r.receivedQuantity || 0), "—"]));
        usageRecords.filter(u => withinRange(u.usageDate, report.start, report.end)).forEach(u => rows.push([u.usageDate || "—", u.productId ? "Disbursed / Used" : "Consumed", u.materialName, -Number(u.usedQuantity || 0), u.productName || "—"]));
        add("Activity", ["Date", "Activity", "Material", "Quantity", "Purpose / Product"], rows);
    }
    if (selected.includes("consumption")) add("Consumption", ["Material", "Previous Stock", "Consumed", "Current Stock", "Trend", "Status"], report.consumedRows.map(r => [r.material, r.previous, r.consumed, r.current, r.trend, r.statusLabel]));
    if (selected.includes("decision")) add("Decision Support", ["Priority", "Material", "Condition", "Finding", "Recommended Action"], report.decisionRows.map(r => [r.priority, r.material, r.condition, r.finding, r.action]));
    return wb;
}

/* ==========================================================
   PRINT
   ========================================================== */

const printBtn = document.getElementById("printReportBtn");
if (printBtn) {
    printBtn.addEventListener("click", () => {
        if (!currentReport) { showToast("Generate a report first.", "error"); return; }
        window.__rmsmePrintMode = true;
        openSaveModal("pdf");
        if (saveModalSubtitle) saveModalSubtitle.textContent = `${currentReport.type === "weekly" ? "Weekly" : "Monthly"} Report · Select sections to print`;
        const cfmBtn = document.getElementById("saveModalConfirm");
        if (cfmBtn) cfmBtn.textContent = "Print Selected Reports";
    });
}

/* ==========================================================
   INIT
   ========================================================== */

async function init() {
    renderPeriodLabel();
    try {
        await loadAllData();
        document.getElementById("generateBtn")?.click();
    } catch (err) {
        console.error(err);
        showToast("Unable to load data. Please try again.", "error");
    }
}
