// js/material-activity-admin.js
//
// Admin — Material Activity: [ Product Activity ] [ Material Overview ]
// Reuses the existing materials / usage_records / stock_receipts /
// plus the new finished_products /
// product_material_requirements tables. Current Stock always lives
// on materials.quantity — never duplicated per product.

import { auth, db } from "../supabase/supabase-config.js";
import {
    collection,
    getDocs,
    doc,
    addDoc,
    updateDoc
} from "../supabase/db-compat.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

/* ==========================================================
   ROLE GUARD
   ========================================================== */

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "../login.html"; return; }

    const snap = await getDocs(collection(db, "users"));
    const profile = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(u => u.id === user.uid);

    if (!profile || profile.status !== "active") { window.location.href = "../login.html"; return; }
    if (profile.role !== "admin") { window.location.href = "../user/dashboard.html"; return; }

    currentUser = { uid: user.uid, fullName: profile.fullName };
    document.body.classList.add("auth-verified");
    document.getElementById("profileBtn").textContent = `${profile.fullName} ▼`;

    initPage();
});

/* ==========================================================
   STATE
   ========================================================== */

let materials = [];
let finishedProducts = [];
let requirements = [];
let requirementsByProduct = new Map();
let requirementsByMaterial = new Map();
let usageRecords = [];
let stockReceipts = [];
let usersById = new Map();

let selectedProductId = null;
let pendingProduct = new Map();  // materialId -> {receive, used}
let pendingOverview = new Map(); // materialId -> {receive, used}

const toastStack = document.getElementById("toastStack");

/* ==========================================================
   HELPERS
   ========================================================== */

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}

function showToast(message, type = "success") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 260); }, 3200);
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

function startOfRange(range) {
    const now = new Date();
    if (range === "today") { now.setHours(0, 0, 0, 0); return now; }
    if (range === "week") { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
    if (range === "month") { const d = new Date(now); d.setDate(d.getDate() - 30); return d; }
    return null; // "all"
}

function withinRange(dateVal, range) {
    if (range === "all") return true;
    const from = startOfRange(range);
    if (!from) return true;
    const d = dateVal ? new Date(dateVal) : null;
    return d && d >= from;
}

function statusInfo(material) {
    if (!material) return { label: "—", cls: "" };
    if (material.status === "Critical") return { label: "Needs Restocking", cls: "out" };
    if (material.status === "Low") return { label: "Running Low", cls: "low" };
    return { label: "Good", cls: "available" };
}

function fmtQty(qty, unit) {
    if (qty === null || qty === undefined || qty === "") return "—";
    return `${qty}${unit ? " " + unit : ""}`;
}

/* ==========================================================
   DATA LOAD
   ========================================================== */

async function loadAll() {
    const [matSnap, prodSnap, reqSnap, usageSnap, receiptSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, "materials")),
        getDocs(collection(db, "finishedProducts")),
        getDocs(collection(db, "productMaterialRequirements")),
        getDocs(collection(db, "usageRecords")),
        getDocs(collection(db, "stockReceipts")),
        getDocs(collection(db, "users"))
    ]);

    materials = matSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    finishedProducts = prodSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.status === "Active");
    requirements = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    usageRecords = usageSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    stockReceipts = receiptSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    usersById = new Map(usersSnap.docs.map(d => [d.id, d.data().fullName || "Unknown"]));

    requirementsByProduct = new Map();
    requirementsByMaterial = new Map();
    requirements.forEach(r => {
        if (!requirementsByProduct.has(r.productId)) requirementsByProduct.set(r.productId, []);
        requirementsByProduct.get(r.productId).push(r);
        if (!requirementsByMaterial.has(r.materialId)) requirementsByMaterial.set(r.materialId, []);
        requirementsByMaterial.get(r.materialId).push(r);
    });

    renderSummary();
    renderCategoryFilter();
    renderProductChips();
    if (selectedProductId) renderProductActivityTable();
    renderOverviewTable();
    renderHistory();
}

/* ==========================================================
   SUMMARY METRICS
   ========================================================== */

function renderSummary() {
    document.getElementById("statTotalMaterials").textContent = materials.length;

    const receivedWeek = stockReceipts
        .filter(r => withinRange(r.receivedDate, "week"))
        .reduce((sum, r) => sum + Number(r.receivedQuantity || 0), 0);
    document.getElementById("statReceivedWeek").textContent = receivedWeek > 0 ? `+${receivedWeek}` : "—";

    const usedWeek = usageRecords
        .filter(r => withinRange(r.usageDate, "week"))
        .reduce((sum, r) => sum + Number(r.usedQuantity || 0), 0);
    document.getElementById("statUsedWeek").textContent = usedWeek > 0 ? `-${usedWeek}` : "—";

    const needing = materials.filter(m => m.status === "Critical" || m.status === "Low").length;
    document.getElementById("statNeedsRestock").textContent = needing;
}

/* ==========================================================
   MODE TABS
   ========================================================== */

document.querySelectorAll(".mode-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".mode-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const mode = tab.dataset.mode;
        document.getElementById("productActivityMode").hidden = mode !== "product";
        document.getElementById("materialOverviewMode").hidden = mode !== "overview";
    });
});

/* ==========================================================
   PRODUCT PICKER
   ========================================================== */

function renderCategoryFilter() {
    const select = document.getElementById("productCategoryFilter");
    const categories = [...new Set(finishedProducts.map(p => p.category).filter(Boolean))].sort();
    const current = select.value;
    select.innerHTML = `<option value="">All Categories</option>` +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (categories.includes(current)) select.value = current;
}

function renderProductChips() {
    const search = document.getElementById("productSearchInput").value.trim().toLowerCase();
    const category = document.getElementById("productCategoryFilter").value;

    const filtered = finishedProducts.filter(p =>
        (!search || p.productName.toLowerCase().includes(search)) &&
        (!category || p.category === category)
    );

    const row = document.getElementById("productChipRow");

    if (finishedProducts.length === 0) {
        row.innerHTML = `<span class="fps-empty-chip">No finished products set up yet. Add one in Inventory Management → Finished Product Setup.</span>`;
        return;
    }
    if (filtered.length === 0) {
        row.innerHTML = `<span class="fps-empty-chip">No finished products match your search.</span>`;
        return;
    }

    row.innerHTML = filtered.map(p => {
        const reqCount = (requirementsByProduct.get(p.id) || []).length;
        return `
            <button type="button" class="product-chip ${p.id === selectedProductId ? "selected" : ""}" data-id="${p.id}">
                <strong>${escapeHtml(p.productName)}</strong>
                <span>${reqCount} raw material${reqCount === 1 ? "" : "s"}</span>
            </button>`;
    }).join("");

    row.querySelectorAll(".product-chip").forEach(chip => {
        chip.addEventListener("click", () => selectProduct(chip.dataset.id));
    });
}

document.getElementById("productSearchInput").addEventListener("input", renderProductChips);
document.getElementById("productCategoryFilter").addEventListener("change", renderProductChips);

function selectProduct(id) {
    selectedProductId = id;
    pendingProduct = new Map();
    renderProductChips();
    document.getElementById("selectedProductPanel").hidden = false;
    document.getElementById("noProductSelected").hidden = true;
    const product = finishedProducts.find(p => p.id === id);
    document.getElementById("selectedProductName").textContent = product ? product.productName : "—";
    renderProductActivityTable();
}

/* ==========================================================
   PRODUCT ACTIVITY TABLE
   ========================================================== */

function totalsFor(materialId, kind, range = "week") {
    // kind: "received" | "used"
    if (kind === "received") {
        const total = stockReceipts
            .filter(r => r.materialId === materialId && withinRange(r.receivedDate, range))
            .reduce((s, r) => s + Number(r.receivedQuantity || 0), 0);
        return total > 0 ? total : null;
    }
    const total = usageRecords
        .filter(r => r.materialId === materialId && withinRange(r.usageDate, range))
        .reduce((s, r) => s + Number(r.usedQuantity || 0), 0);
    return total > 0 ? total : null;
}

function renderProductActivityTable() {
    const reqs = requirementsByProduct.get(selectedProductId) || [];
    const tbody = document.getElementById("productActivityTableBody");

    if (reqs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>No raw materials have been set up for this finished product yet. Configure it in Inventory Management → Finished Product Setup.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = reqs.map(req => {
        const mat = materials.find(m => m.id === req.materialId);
        if (!mat) return "";
        if (!pendingProduct.has(mat.id)) pendingProduct.set(mat.id, { receive: 0, used: 0 });
        const pending = pendingProduct.get(mat.id);

        const receivedTotal = totalsFor(mat.id, "received");
        const usedTotal = totalsFor(mat.id, "used");
        const status = statusInfo(mat);

        return `
            <tr data-material-id="${mat.id}">
                <td><strong>${escapeHtml(mat.materialName)}</strong></td>
                <td>${fmtQty(req.requiredQuantity, req.unit || mat.unit)}</td>
                <td>${fmtQty(mat.quantity, mat.unit)}</td>
                <td>${renderStepper(mat.id, "receive", pending.receive)}</td>
                <td>${renderStepper(mat.id, "used", pending.used)}</td>
                <td>${receivedTotal ? `<span class="total-pill positive">+${receivedTotal} ${mat.unit || ""}</span>` : `<span class="total-pill none">—</span>`}</td>
                <td>${usedTotal ? `<span class="total-pill negative">-${usedTotal} ${mat.unit || ""}</span>` : `<span class="total-pill none">—</span>`}</td>
                <td><span class="status ${status.cls}">${status.label}</span></td>
            </tr>`;
    }).join("");

    bindSteppers("productActivityTableBody", pendingProduct);
}

/* ==========================================================
   STEPPER CONTROL (shared markup + binding)
   ========================================================== */

function renderStepper(materialId, kind, value) {
    return `
        <span class="stepper ${kind}" data-material="${materialId}" data-kind="${kind}">
            <button type="button" class="step-minus">−</button>
            <span class="stepper-value">${value}</span>
            <button type="button" class="step-plus">+</button>
        </span>`;
}

function bindSteppers(containerId, pendingMap) {
    const container = document.getElementById(containerId);
    container.querySelectorAll(".stepper").forEach(stepper => {
        const materialId = stepper.dataset.material;
        const kind = stepper.dataset.kind;
        const valueEl = stepper.querySelector(".stepper-value");

        stepper.querySelector(".step-plus").addEventListener("click", () => {
            const entry = pendingMap.get(materialId) || { receive: 0, used: 0 };
            entry[kind] = Number(entry[kind] || 0) + 1;
            pendingMap.set(materialId, entry);
            valueEl.textContent = entry[kind];
        });

        stepper.querySelector(".step-minus").addEventListener("click", () => {
            const entry = pendingMap.get(materialId) || { receive: 0, used: 0 };
            entry[kind] = Math.max(0, Number(entry[kind] || 0) - 1);
            pendingMap.set(materialId, entry);
            valueEl.textContent = entry[kind];
        });
    });
}

/* ==========================================================
   SAVE ACTIVITY — PRODUCT MODE
   ========================================================== */

document.getElementById("saveActivityBtnProduct").addEventListener("click", async () => {
    await saveActivity(pendingProduct, selectedProductId);
});

document.getElementById("saveActivityBtnOverview").addEventListener("click", async () => {
    await saveActivity(pendingOverview, null);
});

async function saveActivity(pendingMap, productId) {
    const entries = [...pendingMap.entries()]
        .filter(([, v]) => Number(v.receive) > 0 || Number(v.used) > 0);

    if (entries.length === 0) {
        showToast("No changes to save. Adjust Receive or Used with +/- first.", "warn");
        return;
    }

    const receiveEntries = entries.filter(([, v]) => Number(v.receive) > 0);
    const usedEntries = entries.filter(([, v]) => Number(v.used) > 0);

    // "Used" must always be tied to a selected finished product.
    // Material Overview has no product context, so it may receive stock
    // but cannot create a consumption record.
    if (usedEntries.length > 0 && !productId) {
        showToast(
            "To record Used materials, select a finished product first in Product Activity.",
            "warn"
        );
        return;
    }

    // Client-side validation gives immediate feedback. The database RPC
    // performs the authoritative stock check inside the transaction.
    for (const [materialId, v] of usedEntries) {
        const mat = materials.find(m => m.id === materialId);
        if (!mat) continue;

        const used = Number(v.used);
        if (!Number.isFinite(used) || used <= 0) {
            showToast(`Enter a valid Used quantity for ${mat.materialName}.`, "error");
            return;
        }

        if (used > Number(mat.quantity)) {
            showToast(
                `Not enough stock. Only ${mat.quantity} ${mat.unit || ""} of ${mat.materialName} is currently available.`,
                "error"
            );
            return;
        }
    }

    for (const [materialId, v] of receiveEntries) {
        const received = Number(v.receive);
        if (!Number.isFinite(received) || received <= 0) {
            const mat = materials.find(m => m.id === materialId);
            showToast(
                `Enter a valid Receive quantity for ${mat?.materialName || "the material"}.`,
                "error"
            );
            return;
        }
    }

    try {
        /*
         * RECEIVE
         * Uses the existing database stock RPC so stock/status changes are
         * calculated in PostgreSQL, then records the receipt for history.
         */
        for (const [materialId, v] of receiveEntries) {
            const mat = materials.find(m => m.id === materialId);
            if (!mat) continue;

            const { data, error } = await db.rpc("adjust_material_stock", {
                p_material_id: materialId,
                p_delta: Number(v.receive)
            });

            if (error) throw error;

            const row = Array.isArray(data) ? data[0] : data;

            await addDoc(collection(db, "stockReceipts"), {
                materialId,
                materialName: mat.materialName,
                receivedQuantity: Number(v.receive),
                unit: mat.unit,
                receivedDate: todayIso(),
                notes: null,
                createdBy: currentUser.uid,
                recordedBy: currentUser.fullName || ""
            });

            if (row) {
                mat.quantity = Number(row.quantity);
                mat.status = row.status;
            }
        }

        /*
         * USED
         * One RPC call handles all selected materials atomically:
         * validate product -> validate materials -> deduct stock ->
         * insert usage_records. If any entry fails, the Used transaction
         * rolls back as a whole.
         */
        if (usedEntries.length > 0) {
            const rpcEntries = usedEntries.map(([materialId, v]) => ({
                material_id: materialId,
                used_quantity: Number(v.used)
            }));

            const { data, error } = await db.rpc(
                "record_material_usage_batch",
                {
                    p_product_id: productId,
                    p_entries: rpcEntries,
                    p_usage_date: todayIso(),
                    p_remarks: ""
                }
            );

            if (error) throw error;

            const resultEntries = Array.isArray(data?.entries) ? data.entries : [];
            resultEntries.forEach(row => {
                const mat = materials.find(m => m.id === row.material_id);
                if (!mat) return;
                mat.quantity = Number(row.new_quantity);
                mat.status = row.status;
            });
        }

        showToast("Activity saved.");
        pendingMap.clear();
        await loadAll();
    } catch (err) {
        console.error("Material Activity save failed:", err);

        const message = String(err?.message || err?.details || err || "");

        if (message.includes("not_authenticated")) {
            showToast("Your session has expired. Please sign in again.", "error");
        } else if (message.includes("product_not_found")) {
            showToast("The selected finished product is no longer available. Refresh and try again.", "error");
        } else if (message.includes("material_not_found") || message.includes("material_inactive")) {
            showToast("One of the selected materials is no longer available. Refresh and try again.", "error");
        } else if (message.includes("insufficient_stock")) {
            showToast("Not enough stock is available for one or more materials.", "error");
        } else if (message.includes("invalid_quantity")) {
            showToast("One or more Used quantities are invalid.", "error");
        } else {
            showToast("Could not save activity. Please check your connection and try again.", "error");
        }
    }
}

/* ==========================================================
   MATERIAL OVERVIEW (matrix)
   ========================================================== */

const STICKY_LEFT = [{ key: "name", label: "Raw Material" }];
const STICKY_RIGHT = [
    { key: "total", label: "Total Required" },
    { key: "stock", label: "Current Stock" },
    { key: "receive", label: "Receive" },
    { key: "used", label: "Used" },
    { key: "status", label: "Status" }
];

function renderOverviewTable() {
    const table = document.getElementById("overviewTable");
    const materialsWithReqs = materials.filter(m => (requirementsByMaterial.get(m.id) || []).length > 0);

    if (materialsWithReqs.length === 0) {
        table.innerHTML = `<tr><td><div class="empty-state"><p>No raw materials are linked to a finished product yet. Set this up in Inventory Management → Finished Product Setup.</p></div></td></tr>`;
        return;
    }

    const thead = `<thead><tr>
        ${STICKY_LEFT.map(c => `<th class="sticky-col col-${c.key}">${c.label}</th>`).join("")}
        ${finishedProducts.map(p => `<th class="product-col">${escapeHtml(p.productName)}</th>`).join("")}
        ${STICKY_RIGHT.map(c => `<th class="sticky-col col-${c.key}">${c.label}</th>`).join("")}
    </tr></thead>`;

    const rows = materialsWithReqs.map(mat => {
        if (!pendingOverview.has(mat.id)) pendingOverview.set(mat.id, { receive: 0, used: 0 });
        const pending = pendingOverview.get(mat.id);

        const totalRequired = (requirementsByMaterial.get(mat.id) || []).reduce((s, r) => s + Number(r.requiredQuantity || 0), 0);
        const status = statusInfo(mat);

        const productCells = finishedProducts.map(p => {
            const req = (requirementsByProduct.get(p.id) || []).find(r => r.materialId === mat.id);
            return `<td class="product-col">${req ? fmtQty(req.requiredQuantity, req.unit || mat.unit) : "—"}</td>`;
        }).join("");

        return `<tr data-material-id="${mat.id}">
            <td class="sticky-col col-name"><strong>${escapeHtml(mat.materialName)}</strong></td>
            ${productCells}
            <td class="sticky-col col-total">${fmtQty(totalRequired, mat.unit)}</td>
            <td class="sticky-col col-stock">${fmtQty(mat.quantity, mat.unit)}</td>
            <td class="sticky-col col-receive">${renderStepper(mat.id, "receive", pending.receive)}</td>
            <td class="sticky-col col-used">${renderStepper(mat.id, "used", pending.used)}</td>
            <td class="sticky-col col-status"><span class="status ${status.cls}">${status.label}</span></td>
        </tr>`;
    }).join("");

    table.innerHTML = thead + `<tbody>${rows}</tbody>`;

    bindSteppers("overviewTable", pendingOverview);
    applyStickyOffsets(table);
}

function applyStickyOffsets(table) {
    // Left block starts at 0.
    let left = 0;
    STICKY_LEFT.forEach(c => {
        table.querySelectorAll(`.col-${c.key}`).forEach(el => { el.style.left = `${left}px`; });
        const sample = table.querySelector(`.col-${c.key}`);
        left += sample ? sample.offsetWidth : 160;
    });

    // Right block accumulates from the rightmost (status) backwards.
    let right = 0;
    [...STICKY_RIGHT].reverse().forEach(c => {
        table.querySelectorAll(`.col-${c.key}`).forEach(el => { el.style.right = `${right}px`; });
        const sample = table.querySelector(`.col-${c.key}`);
        right += sample ? sample.offsetWidth : 110;
    });
}

/* ==========================================================
   ACTIVITY HISTORY
   ========================================================== */

document.getElementById("historyRangeFilter").addEventListener("change", renderHistory);

function renderHistory() {
    const range = document.getElementById("historyRangeFilter").value;
    const tbody = document.getElementById("activityHistoryBody");

    const receipts = stockReceipts
        .filter(r => withinRange(r.receivedDate, range))
        .map(r => ({
            date: r.receivedDate,
            activity: "Received",
            product: "—",
            material: r.materialName,
            qty: `+${r.receivedQuantity} ${r.unit || ""}`,
            by: usersById.get(r.createdBy) || "—"
        }));

    const usages = usageRecords
        .filter(r => withinRange(r.usageDate, range))
        .map(r => ({
            date: r.usageDate,
            activity: "Used",
            product: r.productName || "—",
            material: r.materialName,
            qty: `-${r.usedQuantity} ${r.unit || ""}`,
            by: usersById.get(r.createdBy) || "—"
        }));

    const all = [...receipts, ...usages].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (all.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No activity recorded for this period.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = all.map(r => `
        <tr>
            <td>${r.date ? new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
            <td>${r.activity}</td>
            <td>${escapeHtml(r.product)}</td>
            <td>${escapeHtml(r.material)}</td>
            <td>${escapeHtml(r.qty)}</td>
            <td>${escapeHtml(r.by)}</td>
        </tr>`).join("");
}

/* ==========================================================
   INIT
   ========================================================== */

function initPage() {
    loadAll();
}
