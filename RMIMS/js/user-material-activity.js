// js/user-material-activity.js
//
// RMIMS V2 — User Material Activity Module
// Shared Data Contract: public.raw_materials, public.stock_receipts, public.material_disbursements
// Transaction Authority: record_stock_receipt_v2(), record_material_disbursement_v2()
// Preserves User UI/UX & Styling with Raw Material Overview Centric Workflow.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

/* ==========================================================
   ROLE GUARD & AUTHENTICATION
   ========================================================== */

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../user-signin.html";
        return;
    }

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

        currentUser = {
            uid: user.uid,
            fullName: profile.full_name || profile.email || "Staff Member",
            email: profile.email
        };

        const pBtn = document.getElementById("profileBtn");
        if (pBtn) {
            const pText = pBtn.querySelector(".profile-text") || pBtn;
            pText.textContent = `${currentUser.fullName} ▼`;
            const pAv = pBtn.querySelector(".avatar");
            if (pAv && currentUser.fullName) {
                pAv.textContent = currentUser.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
            }
        }

        initPage();
    } catch (e) {
        console.error("User Auth guard error:", e);
        window.location.href = "../user-signin.html";
    }
});

/* ==========================================================
   STATE
   ========================================================== */

let materials = [];
let finishedProducts = [];
let requirementsByProduct = new Map();
let stockReceipts = [];
let usageRecords = [];
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
    setTimeout(() => {
        t.classList.add("fade");
        setTimeout(() => t.remove(), 300);
    }, 3200);
}

function statusPill(status) {
    if (status === "Critical") return `<span class="status stock-critical">Needs Restocking</span>`;
    if (status === "Low") return `<span class="status stock-low">Running Low</span>`;
    return `<span class="status stock-good">Good</span>`;
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
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
   DATA INIT & RELOAD (SHARED V2 DATA CONTRACT)
   ========================================================== */

async function initPage() {
    await loadAllData();
    setupModeTabs();
    setupFilters();
    renderSummaryMetrics();
    renderMaterialOverviewTable();
    renderProductChips();
    renderActivityHistory();

    // Default to Material Overview Centric mode for user
    activateOverviewModeByDefault();
}

function activateOverviewModeByDefault() {
    const tabs = document.querySelectorAll("#modeTabs .mode-tab");
    tabs.forEach(t => {
        if (t.dataset.mode === "overview") {
            t.classList.add("active");
        } else {
            t.classList.remove("active");
        }
    });

    const prodMode = document.getElementById("productActivityMode");
    const ovMode = document.getElementById("materialOverviewMode");
    if (prodMode) prodMode.hidden = true;
    if (ovMode) ovMode.hidden = false;
}

async function loadAllData() {
    try {
        const [matRes, recRes, useRes, userRes] = await Promise.all([
            supabase.from("raw_materials").select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days").order("item_code"),
            supabase.from("stock_receipts").select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at").order("receipt_date", { ascending: false }),
            supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("usage_date", { ascending: false }),
            supabase.from("user_profiles").select("id, full_name, email")
        ]);

        const rawMats = matRes.data || [];
        const rawReceipts = recRes.data || [];
        const rawDisbursements = useRes.data || [];
        const rawUsers = userRes.data || [];

        usersById.clear();
        rawUsers.forEach(d => usersById.set(d.id, d.full_name || d.email || "Staff"));

        materials = rawMats.map(m => {
            const stock = Number(m.current_stock || 0);
            const minRef = Number(m.minimum_threshold || 0);
            let status = "Available";
            if (stock <= (minRef / 2)) {
                status = "Critical";
            } else if (stock <= minRef) {
                status = "Low";
            }

            return {
                id: m.id,
                itemCode: m.item_code,
                materialName: m.name,
                unit: m.unit_of_measure || "kg",
                quantity: stock,
                minimumThreshold: minRef,
                reorderQuantity: Number(m.reorder_quantity || 0),
                status
            };
        });

        stockReceipts = rawReceipts.map(r => ({
            id: r.id,
            materialId: r.material_id,
            receivedQuantity: Number(r.received_quantity || 0),
            unit: r.unit,
            supplierName: r.supplier_name,
            receivedDate: r.receipt_date,
            receivedBy: r.received_by,
            createdAt: r.created_at
        }));

        usageRecords = rawDisbursements.map(d => ({
            id: d.id,
            materialId: d.material_id,
            usedQuantity: Number(d.consumed_quantity || 0),
            unit: d.unit,
            activityType: d.activity_type,
            finishedProductName: d.finished_product_name || "General Usage",
            usageDate: d.usage_date,
            recordedBy: d.recorded_by,
            createdAt: d.created_at
        }));

        // Discover Finished Products from disbursements
        const prodSet = new Set();
        usageRecords.forEach(u => {
            if (u.finishedProductName && u.finishedProductName !== "General Usage") {
                prodSet.add(u.finishedProductName.trim());
            }
        });

        const defaultProducts = ["Pandesal", "Cookies", "Cake", "Special Bread", "Banana Chips", "Pastries"];
        defaultProducts.forEach(p => prodSet.add(p));

        finishedProducts = Array.from(prodSet).sort().map((name, idx) => ({
            id: `prod_${idx + 1}`,
            productName: name,
            category: name.includes("Bread") || name === "Pandesal" ? "Bakery" : name.includes("Chips") ? "Snacks" : "Confectionery"
        }));

        requirementsByProduct.clear();
        materials.forEach(mat => {
            finishedProducts.forEach(prod => {
                if (!requirementsByProduct.has(prod.id)) requirementsByProduct.set(prod.id, []);
                requirementsByProduct.get(prod.id).push({
                    productId: prod.id,
                    materialId: mat.id,
                    quantityRequired: 1,
                    unit: mat.unit
                });
            });
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

    const statTotal = document.getElementById("statTotalMaterials");
    const statRec = document.getElementById("statReceivedWeek");
    const statUsed = document.getElementById("statUsedWeek");
    const statRestock = document.getElementById("statNeedsRestock");

    if (statTotal) statTotal.textContent = totalMat.toLocaleString();
    if (statRec) statRec.textContent = recWeekTotal > 0 ? `${formatNum(recWeekTotal)} units` : "0 units";
    if (statUsed) statUsed.textContent = usedWeekTotal > 0 ? `${formatNum(usedWeekTotal)} units` : "0 units";
    if (statRestock) statRestock.textContent = needsRestock.toLocaleString();
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
            const prodMode = document.getElementById("productActivityMode");
            const ovMode = document.getElementById("materialOverviewMode");

            if (prodMode) prodMode.hidden = mode !== "product";
            if (ovMode) ovMode.hidden = mode !== "overview";
        });
    });
}

/* ==========================================================
   PRODUCT ACTIVITY MODE
   ========================================================== */

function setupFilters() {
    const catSelect = document.getElementById("productCategoryFilter");
    if (catSelect) {
        const categories = [...new Set(finishedProducts.map(p => p.category).filter(Boolean))].sort();
        catSelect.innerHTML = `<option value="">All Categories</option>` +
            categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    }

    const searchInput = document.getElementById("productSearchInput");
    [searchInput, catSelect].forEach(el => {
        if (el) el.addEventListener("input", () => renderProductChips());
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
    if (!chipRow) return;

    const searchInput = document.getElementById("productSearchInput");
    const catSelect = document.getElementById("productCategoryFilter");
    const search = searchInput ? searchInput.value.trim().toLowerCase() : "";
    const cat = catSelect ? catSelect.value : "";

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
        if (panel) panel.hidden = true;
        if (emptyState) emptyState.hidden = false;
        return;
    }

    if (panel) panel.hidden = false;
    if (emptyState) emptyState.hidden = true;
    const nameEl = document.getElementById("selectedProductName");
    if (nameEl) nameEl.textContent = prod.productName;

    const reqs = requirementsByProduct.get(prod.id) || [];
    const tbody = document.getElementById("productActivityTableBody");
    if (!tbody) return;

    if (reqs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>No raw material requirements configured for this product.</p></div></td></tr>`;
        return;
    }

    const recByMat = aggregateTotalReceived();
    const useByMat = aggregateTotalUsed();

    tbody.innerHTML = reqs.map(r => {
        const mat = materials.find(m => m.id === r.materialId) || { materialName: "Material", quantity: 0, unit: r.unit, status: "Available" };
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
   RAW MATERIAL OVERVIEW MODE (ONE RAW MATERIAL = ONE ITEM)
   ========================================================== */

function renderMaterialOverviewTable() {
    const table = document.getElementById("overviewTable");
    if (!table) return;

    const recByMat = aggregateTotalReceived();
    const useByMat = aggregateTotalUsed();

    if (materials.length === 0) {
        table.innerHTML = `<tr><td><div class="empty-state"><p>No raw materials found in catalog.</p></div></td></tr>`;
        return;
    }

    table.innerHTML = `
        <thead>
            <tr>
                <th>Raw Material</th>
                <th>Products Used For</th>
                <th>Unit</th>
                <th>Current Stock</th>
                <th>Receive</th>
                <th>Used</th>
                <th>Total Received</th>
                <th>Total Used</th>
                <th>Net Movement</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            ${materials.map(m => {
                const pending = pendingOverview.get(m.id) || { receive: "", used: "" };
                const totalRec = recByMat.get(m.id) || 0;
                const totalUsed = useByMat.get(m.id) || 0;
                const netMovement = totalRec - totalUsed;

                const productsSet = new Set();
                usageRecords.filter(u => u.materialId === m.id).forEach(u => {
                    if (u.finishedProductName) productsSet.add(u.finishedProductName.trim());
                });
                const productsList = productsSet.size > 0 ? Array.from(productsSet).join(", ") : "General Usage";

                return `
                    <tr data-material-id="${m.id}">
                        <td><strong>${escapeHtml(m.materialName)}</strong> <small style="color:var(--text-muted);">(${escapeHtml(m.itemCode || "")})</small></td>
                        <td><span style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(productsList)}</span></td>
                        <td>${escapeHtml(m.unit || "—")}</td>
                        <td><strong>${formatNum(m.quantity)} ${escapeHtml(m.unit || "")}</strong></td>
                        <td><input type="number" class="act-input ov-receive" min="0" step="any" placeholder="0" value="${pending.receive}"></td>
                        <td><input type="number" class="act-input ov-used" min="0" step="any" placeholder="0" value="${pending.used}"></td>
                        <td>${totalRec > 0 ? `<span class="total-pill positive">+${formatNum(totalRec)} ${escapeHtml(m.unit || "")}</span>` : "—"}</td>
                        <td>${totalUsed > 0 ? `<span class="total-pill negative">-${formatNum(totalUsed)} ${escapeHtml(m.unit || "")}</span>` : "—"}</td>
                        <td><strong style="color:${netMovement >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${netMovement > 0 ? '+' : ''}${formatNum(netMovement)} ${escapeHtml(m.unit || "")}</strong></td>
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
   SAVE ACTIONS (STORED PROCEDURES: record_stock_receipt_v2, record_material_disbursement_v2)
   ========================================================== */

async function saveProductActivity() {
    const prod = finishedProducts.find(p => p.id === selectedProductId);
    const prodName = prod ? prod.productName : null;

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

    await executeActivityTransactions(entries, prodName);
    pendingProduct.clear();
    await initPage();
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

    await executeActivityTransactions(entries, null);
    pendingOverview.clear();
    await initPage();
}

async function executeActivityTransactions(entries, finishedProductName) {
    try {
        for (const entry of entries) {
            const mat = materials.find(m => m.id === entry.matId);
            if (!mat) continue;

            // 1. Inflow Transaction via stored procedure
            if (entry.rec > 0) {
                const { error: recErr } = await supabase.rpc("record_stock_receipt_v2", {
                    p_material_id: mat.id,
                    p_receipt_date: todayIso(),
                    p_quantity: entry.rec,
                    p_unit: mat.unit || "kg",
                    p_supplier_name: null
                });

                if (recErr) throw recErr;
            }

            // 2. Outflow Transaction via stored procedure
            if (entry.used > 0) {
                const { error: useErr } = await supabase.rpc("record_material_disbursement_v2", {
                    p_material_id: mat.id,
                    p_usage_date: todayIso(),
                    p_quantity: entry.used,
                    p_unit: mat.unit || "kg",
                    p_activity_type: finishedProductName ? "Production" : "General Usage",
                    p_finished_product_name: finishedProductName
                });

                if (useErr) throw useErr;
            }
        }

        showToast("Activity saved successfully!", "success");
    } catch (e) {
        console.error("Error saving activity via stored procedures:", e);
        const msg = String(e?.message || e?.details || e || "");
        if (msg.includes("Insufficient Stock")) {
            showToast("Stock deficit: Recorded stock balance is insufficient.", "error");
        } else if (msg.includes("Access Denied")) {
            showToast("Unauthorized: Account inactive or session expired.", "error");
        } else {
            showToast("Failed to save activity. Please check connection.", "error");
        }
    }
}

/* ==========================================================
   ACTIVITY HISTORY
   ========================================================== */

function renderActivityHistory() {
    const tbody = document.getElementById("activityHistoryBody");
    if (!tbody) return;

    const filterEl = document.getElementById("historyRangeFilter");
    const filter = filterEl ? filterEl.value : "week";

    let history = [];

    stockReceipts.forEach(r => {
        const mat = materials.find(m => m.id === r.materialId);
        history.push({
            type: "receive",
            date: r.receivedDate || r.createdAt,
            productName: "—",
            materialName: mat ? mat.materialName : "Raw Material",
            quantity: r.receivedQuantity,
            unit: r.unit,
            user: usersById.get(r.receivedBy) || "Staff"
        });
    });

    usageRecords.forEach(r => {
        const mat = materials.find(m => m.id === r.materialId);
        history.push({
            type: "used",
            date: r.usageDate || r.createdAt,
            productName: r.finishedProductName || "General Usage",
            materialName: mat ? mat.materialName : "Raw Material",
            quantity: r.usedQuantity,
            unit: r.unit,
            user: usersById.get(r.recordedBy) || "Staff"
        });
    });

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
            <td>${new Date(h.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
            <td><span class="status ${h.type === "receive" ? "stock-good" : "stock-low"}">${h.type === "receive" ? "Received" : "Consumed"}</span></td>
            <td>${escapeHtml(h.productName)}</td>
            <td><strong>${escapeHtml(h.materialName)}</strong></td>
            <td>${formatNum(h.quantity)} ${escapeHtml(h.unit || "")}</td>
            <td>${escapeHtml(h.user)}</td>
        </tr>`).join("");
}
