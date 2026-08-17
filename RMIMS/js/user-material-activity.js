// js/user-material-activity.js
// User — Material Activity: [ Product Activity ] [ Material Overview ]
// 100% matched structure, components, and logic with Admin Material Activity.

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
    if (profile.role !== "user") { window.location.href = "../admin/dashboard.html"; return; }

    currentUser = { uid: user.uid, fullName: profile.fullName };
    const pBtn = document.getElementById("profileBtn");
    if (pBtn) {
        const pText = pBtn.querySelector(".profile-text") || pBtn;
        pText.textContent = `${profile.fullName || "Staff Member"} ▼`;
        const pAv = pBtn.querySelector(".avatar");
        if (pAv && profile.fullName) {
            pAv.textContent = profile.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
        }
    }

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
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}

function formatNum(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "0";
    return Number.isInteger(num) ? num.toString() : num.toFixed(2).replace(/\.00$/, "");
}

function showToast(msg, type = "info") {
    if (!toastStack) return;
    const t = document.createElement("div");
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    toastStack.appendChild(t);
    setTimeout(() => { t.classList.add("fade"); setTimeout(() => t.remove(), 300); }, 3200);
}

function statusPill(status) {
    if (status === "Critical") return `<span class="status stock-critical">Needs Restocking</span>`;
    if (status === "Low") return `<span class="status stock-low">Running Low</span>`;
    return `<span class="status stock-good">Good</span>`;
}

function startOfWeek(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

/* ==========================================================
   DATA INIT & RELOAD
   ========================================================== */

async function initPage() {
    await loadAllData();
    setupModeTabs();
    setupFilters();
    renderSummaryMetrics();
    renderProductChips();
    renderMaterialOverviewTable();
    renderActivityHistory();
}

async function loadAllData() {
    try {
        const [matSnap, fpSnap, reqSnap, useSnap, recSnap, userSnap] = await Promise.all([
            getDocs(collection(db, "materials")),
            getDocs(collection(db, "finishedProducts")),
            getDocs(collection(db, "productMaterialRequirements")),
            getDocs(collection(db, "usageRecords")),
            getDocs(collection(db, "stockReceipts")),
            getDocs(collection(db, "users"))
        ]);

        materials = matSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        finishedProducts = fpSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        requirements = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        usageRecords = useSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        stockReceipts = recSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        usersById.clear();
        userSnap.docs.forEach(d => usersById.set(d.id, d.data().fullName || d.data().email || "Staff"));

        requirementsByProduct.clear();
        requirementsByMaterial.clear();

        requirements.forEach(r => {
            if (!requirementsByProduct.has(r.productId)) requirementsByProduct.set(r.productId, []);
            requirementsByProduct.get(r.productId).push(r);

            if (!requirementsByMaterial.has(r.materialId)) requirementsByMaterial.set(r.materialId, []);
            requirementsByMaterial.get(r.materialId).push(r);
        });

    } catch (e) {
        console.error("Failed to load Material Activity data:", e);
        showToast("Unable to load latest activity data", "error");
    }
}

/* ==========================================================
   METRICS
   ========================================================== */

function renderSummaryMetrics() {
    const totalMat = materials.length;
    const needsRestock = materials.filter(m => m.status === "Low" || m.status === "Critical").length;

    const now = new Date();
    const weekStart = startOfWeek(now);

    const recWeekTotal = stockReceipts
        .filter(r => new Date(r.receivedDate || r.createdAt) >= weekStart)
        .reduce((sum, r) => sum + Number(r.receivedQuantity || 0), 0);

    const usedWeekTotal = usageRecords
        .filter(r => new Date(r.usageDate || r.createdAt) >= weekStart)
        .reduce((sum, r) => sum + Number(r.usedQuantity || 0), 0);

    document.getElementById("statTotalMaterials").textContent = totalMat.toLocaleString();
    document.getElementById("statReceivedWeek").textContent = recWeekTotal > 0 ? `${formatNum(recWeekTotal)} units` : "0 units";
    document.getElementById("statUsedWeek").textContent = usedWeekTotal > 0 ? `${formatNum(usedWeekTotal)} units` : "0 units";
    document.getElementById("statNeedsRestock").textContent = needsRestock.toLocaleString();
}

/* ==========================================================
   TABS
   ========================================================== */

function setupModeTabs() {
    const tabs = document.querySelectorAll("#modeTabs .mode-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");

            const mode = tab.dataset.mode;
            document.getElementById("productActivityMode").hidden = mode !== "product";
            document.getElementById("materialOverviewMode").hidden = mode !== "overview";
        });
    });
}

/* ==========================================================
   PRODUCT ACTIVITY MODE
   ========================================================== */

function setupFilters() {
    const catSelect = document.getElementById("productCategoryFilter");
    const categories = [...new Set(finishedProducts.map(p => p.category).filter(Boolean))].sort();
    catSelect.innerHTML = `<option value="">All Categories</option>` +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

    const searchInput = document.getElementById("productSearchInput");
    [searchInput, catSelect].forEach(el => {
        el.addEventListener("input", () => renderProductChips());
    });

    const historyFilter = document.getElementById("historyRangeFilter");
    if (historyFilter) {
        historyFilter.addEventListener("change", () => renderActivityHistory());
    }

    document.getElementById("saveActivityBtnProduct")?.addEventListener("click", () => saveProductActivity());
    document.getElementById("saveActivityBtnOverview")?.addEventListener("click", () => saveOverviewActivity());
}

function renderProductChips() {
    const chipRow = document.getElementById("productChipRow");
    const search = document.getElementById("productSearchInput").value.trim().toLowerCase();
    const cat = document.getElementById("productCategoryFilter").value;

    const filtered = finishedProducts.filter(p =>
        (!search || p.productName.toLowerCase().includes(search)) &&
        (!cat || p.category === cat)
    );

    if (filtered.length === 0) {
        chipRow.innerHTML = `<span class="fps-empty-chip">No products found matching filters</span>`;
        selectedProductId = null;
        renderSelectedProductPanel();
        return;
    }

    if (!selectedProductId || !filtered.some(p => p.id === selectedProductId)) {
        selectedProductId = filtered[0].id;
    }

    chipRow.innerHTML = filtered.map(p => `
        <button type="button" class="product-chip ${p.id === selectedProductId ? "active" : ""}" data-product-id="${p.id}">
            <strong>${escapeHtml(p.productName)}</strong>
            <small>${escapeHtml(p.category || "Uncategorized")}</small>
        </button>`).join("");

    chipRow.querySelectorAll(".product-chip").forEach(btn => {
        btn.addEventListener("click", () => {
            selectedProductId = btn.dataset.productId;
            pendingProduct.clear();
            renderProductChips();
            renderSelectedProductPanel();
        });
    });

    renderSelectedProductPanel();
}

function renderSelectedProductPanel() {
    const panel = document.getElementById("selectedProductPanel");
    const emptyState = document.getElementById("noProductSelected");
    const prod = finishedProducts.find(p => p.id === selectedProductId);

    if (!prod) {
        panel.hidden = true;
        emptyState.hidden = false;
        return;
    }

    panel.hidden = false;
    emptyState.hidden = true;
    document.getElementById("selectedProductName").textContent = prod.productName;

    const reqs = requirementsByProduct.get(prod.id) || [];
    const tbody = document.getElementById("productActivityTableBody");

    if (reqs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>No raw material requirements configured for this product.</p></div></td></tr>`;
        return;
    }

    const recByMat = aggregateTotalReceived();
    const useByMat = aggregateTotalUsed();

    tbody.innerHTML = reqs.map(r => {
        const mat = materials.find(m => m.id === r.materialId) || { materialName: r.materialName, quantity: 0, unit: r.unit, status: "Available" };
        const pending = pendingProduct.get(r.materialId) || { receive: "", used: "" };

        return `
            <tr data-material-id="${r.materialId}">
                <td><strong>${escapeHtml(mat.materialName)}</strong></td>
                <td>${formatNum(r.quantityRequired)} ${escapeHtml(r.unit || mat.unit || "")}</td>
                <td>${formatNum(mat.quantity)} ${escapeHtml(mat.unit || "")}</td>
                <td><input type="number" class="act-input act-receive" min="0" step="any" placeholder="0" value="${pending.receive}"></td>
                <td><input type="number" class="act-input act-used" min="0" step="any" placeholder="0" value="${pending.used}"></td>
                <td>${formatNum(recByMat.get(r.materialId) || 0)} ${escapeHtml(mat.unit || "")}</td>
                <td>${formatNum(useByMat.get(r.materialId) || 0)} ${escapeHtml(mat.unit || "")}</td>
                <td>${statusPill(mat.status)}</td>
            </tr>`;
    }).join("");

    tbody.querySelectorAll(".act-input").forEach(input => {
        input.addEventListener("input", (e) => {
            const tr = e.target.closest("tr");
            const matId = tr.dataset.materialId;
            const receiveVal = tr.querySelector(".act-receive").value;
            const usedVal = tr.querySelector(".act-used").value;
            pendingProduct.set(matId, { receive: receiveVal, used: usedVal });
        });
    });
}

/* ==========================================================
   MATERIAL OVERVIEW MODE
   ========================================================== */

function renderMaterialOverviewTable() {
    const table = document.getElementById("overviewTable");
    const recByMat = aggregateTotalReceived();
    const useByMat = aggregateTotalUsed();

    if (materials.length === 0) {
        table.innerHTML = `<tr><td><div class="empty-state"><p>No raw materials found.</p></div></td></tr>`;
        return;
    }

    table.innerHTML = `
        <thead>
            <tr>
                <th>Raw Material</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Current Stock</th>
                <th>Receive</th>
                <th>Used</th>
                <th>Total Received</th>
                <th>Total Used</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            ${materials.map(m => {
        const pending = pendingOverview.get(m.id) || { receive: "", used: "" };
        return `
                    <tr data-material-id="${m.id}">
                        <td><strong>${escapeHtml(m.materialName)}</strong></td>
                        <td>${escapeHtml(m.category || "—")}</td>
                        <td>${escapeHtml(m.unit || "—")}</td>
                        <td>${formatNum(m.quantity)} ${escapeHtml(m.unit || "")}</td>
                        <td><input type="number" class="act-input ov-receive" min="0" step="any" placeholder="0" value="${pending.receive}"></td>
                        <td><input type="number" class="act-input ov-used" min="0" step="any" placeholder="0" value="${pending.used}"></td>
                        <td>${formatNum(recByMat.get(m.id) || 0)} ${escapeHtml(m.unit || "")}</td>
                        <td>${formatNum(useByMat.get(m.id) || 0)} ${escapeHtml(m.unit || "")}</td>
                        <td>${statusPill(m.status)}</td>
                    </tr>`;
    }).join("")}
        </tbody>`;

    table.querySelectorAll(".act-input").forEach(input => {
        input.addEventListener("input", (e) => {
            const tr = e.target.closest("tr");
            const matId = tr.dataset.materialId;
            const receiveVal = tr.querySelector(".ov-receive").value;
            const usedVal = tr.querySelector(".ov-used").value;
            pendingOverview.set(matId, { receive: receiveVal, used: usedVal });
        });
    });
}

function aggregateTotalReceived() {
    const map = new Map();
    stockReceipts.forEach(r => map.set(r.materialId, (map.get(r.materialId) || 0) + Number(r.receivedQuantity || 0)));
    return map;
}

function aggregateTotalUsed() {
    const map = new Map();
    usageRecords.forEach(r => map.set(r.materialId, (map.get(r.materialId) || 0) + Number(r.usedQuantity || 0)));
    return map;
}

/* ==========================================================
   SAVE ACTIONS
   ========================================================== */

async function saveProductActivity() {
    const prod = finishedProducts.find(p => p.id === selectedProductId);
    if (!prod) return;

    let entries = [];
    pendingProduct.forEach((val, matId) => {
        const rec = Number(val.receive || 0);
        const used = Number(val.used || 0);
        if (rec > 0 || used > 0) entries.push({ matId, rec, used });
    });

    if (entries.length === 0) {
        showToast("No quantities entered to save", "warning");
        return;
    }

    try {
        const now = new Date().toISOString();

        for (const entry of entries) {
            const mat = materials.find(m => m.id === entry.matId);
            if (!mat) continue;

            let newQty = Number(mat.quantity || 0);

            if (entry.rec > 0) {
                newQty += entry.rec;
                await addDoc(collection(db, "stockReceipts"), {
                    materialId: mat.id,
                    materialName: mat.materialName,
                    receivedQuantity: entry.rec,
                    unit: mat.unit || "",
                    receivedDate: now,
                    createdBy: currentUser?.uid || "",
                    createdAt: now
                });
            }

            if (entry.used > 0) {
                newQty = Math.max(0, newQty - entry.used);
                await addDoc(collection(db, "usageRecords"), {
                    materialId: mat.id,
                    materialName: mat.materialName,
                    productId: prod.id,
                    productName: prod.productName,
                    usedQuantity: entry.used,
                    unit: mat.unit || "",
                    usageDate: now,
                    createdBy: currentUser?.uid || "",
                    createdAt: now
                });
            }

            const newStatus = newQty === 0 ? "Critical" : newQty <= (mat.minStock || 10) ? "Low" : "Available";
            await updateDoc(doc(db, "materials", mat.id), {
                quantity: newQty,
                status: newStatus,
                updatedAt: now
            });
        }

        showToast("Product activity saved successfully!", "success");
        pendingProduct.clear();
        await initPage();
    } catch (e) {
        console.error("Error saving product activity:", e);
        showToast("Failed to save activity", "error");
    }
}

async function saveOverviewActivity() {
    let entries = [];
    pendingOverview.forEach((val, matId) => {
        const rec = Number(val.receive || 0);
        const used = Number(val.used || 0);
        if (rec > 0 || used > 0) entries.push({ matId, rec, used });
    });

    if (entries.length === 0) {
        showToast("No quantities entered to save", "warning");
        return;
    }

    try {
        const now = new Date().toISOString();

        for (const entry of entries) {
            const mat = materials.find(m => m.id === entry.matId);
            if (!mat) continue;

            let newQty = Number(mat.quantity || 0);

            if (entry.rec > 0) {
                newQty += entry.rec;
                await addDoc(collection(db, "stockReceipts"), {
                    materialId: mat.id,
                    materialName: mat.materialName,
                    receivedQuantity: entry.rec,
                    unit: mat.unit || "",
                    receivedDate: now,
                    createdBy: currentUser?.uid || "",
                    createdAt: now
                });
            }

            if (entry.used > 0) {
                newQty = Math.max(0, newQty - entry.used);
                await addDoc(collection(db, "usageRecords"), {
                    materialId: mat.id,
                    materialName: mat.materialName,
                    usedQuantity: entry.used,
                    unit: mat.unit || "",
                    usageDate: now,
                    createdBy: currentUser?.uid || "",
                    createdAt: now
                });
            }

            const newStatus = newQty === 0 ? "Critical" : newQty <= (mat.minStock || 10) ? "Low" : "Available";
            await updateDoc(doc(db, "materials", mat.id), {
                quantity: newQty,
                status: newStatus,
                updatedAt: now
            });
        }

        showToast("Material overview activity saved successfully!", "success");
        pendingOverview.clear();
        await initPage();
    } catch (e) {
        console.error("Error saving overview activity:", e);
        showToast("Failed to save activity", "error");
    }
}

/* ==========================================================
   ACTIVITY HISTORY
   ========================================================== */

function renderActivityHistory() {
    const tbody = document.getElementById("activityHistoryBody");
    const filter = document.getElementById("historyRangeFilter")?.value || "week";

    let history = [];

    stockReceipts.forEach(r => history.push({
        type: "receive",
        date: r.receivedDate || r.createdAt,
        productName: "—",
        materialName: r.materialName,
        quantity: r.receivedQuantity,
        unit: r.unit,
        user: usersById.get(r.createdBy) || "Staff"
    }));

    usageRecords.forEach(r => history.push({
        type: "used",
        date: r.usageDate || r.createdAt,
        productName: r.productName || "General Usage",
        materialName: r.materialName,
        quantity: r.usedQuantity,
        unit: r.unit,
        user: usersById.get(r.createdBy) || "Staff"
    }));

    const now = new Date();
    history = history.filter(h => {
        if (filter === "all") return true;
        const d = new Date(h.date);
        if (filter === "today") return d.toDateString() === now.toDateString();
        if (filter === "week") return d >= startOfWeek(now);
        if (filter === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        return true;
    });

    history.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No material activity recorded for this period.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = history.slice(0, 15).map(h => `
        <tr>
            <td>${new Date(h.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
            <td><span class="status ${h.type === "receive" ? "stock-good" : "stock-low"}">${h.type === "receive" ? "Received" : "Consumed"}</span></td>
            <td>${escapeHtml(h.productName)}</td>
            <td><strong>${escapeHtml(h.materialName)}</strong></td>
            <td>${formatNum(h.quantity)} ${escapeHtml(h.unit || "")}</td>
            <td>${escapeHtml(h.user)}</td>
        </tr>`).join("");
}
