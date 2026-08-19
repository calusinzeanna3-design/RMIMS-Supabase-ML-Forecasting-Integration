// js/material-activity-admin.js
//
// RMIMS V2 — Admin Material Activity Module
// Shared Data Contract: public.raw_materials, public.stock_receipts, public.material_disbursements
// Transaction Authority: record_stock_receipt_v2(), record_material_disbursement_v2()
// Preserves Admin UI/UX, Navigation, Tabbed Layout, Product & Material Activity Views.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

/* ==========================================================
   ROLE GUARD & AUTHENTICATION
   ========================================================== */

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../login.html";
        return;
    }

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

        currentUser = {
            uid: user.uid,
            fullName: profile.full_name || profile.email || "Admin",
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
        console.error("Auth guard error:", e);
        window.location.href = "../login.html";
    }
});

/* ==========================================================
   STATE
   ========================================================== */

let materials = [];
let finishedProducts = [];
let requirementsByProduct = new Map();
let requirementsByMaterial = new Map();
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

function showToast(message, type = "success") {
    if (!toastStack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => {
        el.classList.add("leaving");
        setTimeout(() => el.remove(), 260);
    }, 3200);
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function startOfRange(range) {
    const now = new Date();
    if (range === "today") {
        now.setHours(0, 0, 0, 0);
        return now;
    }
    if (range === "week") {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return d;
    }
    if (range === "month") {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        return d;
    }
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
    const n = Number(qty);
    const formatted = Number.isFinite(n) ? (Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/\.00$/, "")) : qty;
    return `${formatted}${unit ? " " + unit : ""}`;
}

/* ==========================================================
   DATA LOAD (SHARED V2 DATA CONTRACT)
   ========================================================== */

async function loadAll() {
    try {
        const [matRes, recRes, useRes, userRes] = await Promise.all([
            supabase.from("raw_materials").select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days").order("item_code"),
            supabase.from("stock_receipts").select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at").order("receipt_date", { ascending: false }),
            supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("usage_date", { ascending: false }),
            supabase.from("user_profiles").select("id, full_name, email")
        ]);

        if (matRes.error) console.warn("Raw materials fetch notice:", matRes.error);
        if (recRes.error) console.warn("Stock receipts fetch notice:", recRes.error);
        if (useRes.error) console.warn("Material disbursements fetch notice:", useRes.error);

        const rawMats = matRes.data || [];
        const rawReceipts = recRes.data || [];
        const rawDisbursements = useRes.data || [];
        const rawUsers = userRes.data || [];

        // Build User Map
        usersById = new Map(rawUsers.map(u => [u.id, u.full_name || u.email || "Staff"]));

        // Build Material Catalog
        materials = rawMats.map(m => {
            const stock = Number(m.current_stock || 0);
            const minThreshold = Number(m.minimum_threshold || 0);
            let status = "Good";
            if (stock <= (minThreshold / 2)) {
                status = "Critical";
            } else if (stock <= minThreshold) {
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

        // Build Receipts
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

        // Build Disbursements
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

        // Discover Finished Products dynamically from historical disbursements
        const productSet = new Set();
        usageRecords.forEach(u => {
            if (u.finishedProductName && u.finishedProductName !== "General Usage") {
                productSet.add(u.finishedProductName.trim());
            }
        });

        // Ensure default products exist if not yet logged in disbursements
        const defaultProducts = ["Pandesal", "Cookies", "Cake", "Special Bread", "Banana Chips", "Pastries"];
        defaultProducts.forEach(p => productSet.add(p));

        finishedProducts = Array.from(productSet).sort().map((name, idx) => ({
            id: `prod_${idx + 1}`,
            productName: name,
            category: name.includes("Bread") || name === "Pandesal" ? "Bakery" : name.includes("Chips") ? "Snacks" : "Confectionery"
        }));

        // Derive requirements contextually from disbursements
        requirementsByProduct = new Map();
        requirementsByMaterial = new Map();

        materials.forEach(mat => {
            const usedInProducts = new Set();
            usageRecords.filter(u => u.materialId === mat.id).forEach(u => {
                if (u.finishedProductName) usedInProducts.add(u.finishedProductName.trim());
            });

            // Map requirements
            finishedProducts.forEach(prod => {
                const wasUsed = usedInProducts.has(prod.productName);
                if (wasUsed || usedInProducts.size === 0) {
                    const reqObj = {
                        productId: prod.id,
                        materialId: mat.id,
                        requiredQuantity: 1,
                        unit: mat.unit
                    };
                    if (!requirementsByProduct.has(prod.id)) requirementsByProduct.set(prod.id, []);
                    requirementsByProduct.get(prod.id).push(reqObj);

                    if (!requirementsByMaterial.has(mat.id)) requirementsByMaterial.set(mat.id, []);
                    requirementsByMaterial.get(mat.id).push(reqObj);
                }
            });
        });

        renderSummary();
        renderCategoryFilter();
        renderProductChips();
        if (selectedProductId) renderProductActivityTable();
        renderOverviewTable();
        renderHistory();
    } catch (e) {
        console.error("Failed to load Material Activity data:", e);
        showToast("Error loading activity data", "error");
    }
}

/* ==========================================================
   SUMMARY METRICS
   ========================================================== */

function renderSummary() {
    const totalEl = document.getElementById("statTotalMaterials");
    if (totalEl) totalEl.textContent = materials.length;

    const receivedWeek = stockReceipts
        .filter(r => withinRange(r.receivedDate, "week"))
        .reduce((sum, r) => sum + Number(r.receivedQuantity || 0), 0);
    const recEl = document.getElementById("statReceivedWeek");
    if (recEl) recEl.textContent = receivedWeek > 0 ? `+${fmtQty(receivedWeek)}` : "—";

    const usedWeek = usageRecords
        .filter(r => withinRange(r.usageDate, "week"))
        .reduce((sum, r) => sum + Number(r.usedQuantity || 0), 0);
    const usedEl = document.getElementById("statUsedWeek");
    if (usedEl) usedEl.textContent = usedWeek > 0 ? `-${fmtQty(usedWeek)}` : "—";

    const needing = materials.filter(m => m.status === "Critical" || m.status === "Low").length;
    const needEl = document.getElementById("statNeedsRestock");
    if (needEl) needEl.textContent = needing;
}

/* ==========================================================
   MODE TABS
   ========================================================== */

document.querySelectorAll(".mode-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".mode-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const mode = tab.dataset.mode;
        const prodModeEl = document.getElementById("productActivityMode");
        const ovModeEl = document.getElementById("materialOverviewMode");
        if (prodModeEl) prodModeEl.hidden = mode !== "product";
        if (ovModeEl) ovModeEl.hidden = mode !== "overview";
    });
});

/* ==========================================================
   PRODUCT PICKER
   ========================================================== */

function renderCategoryFilter() {
    const select = document.getElementById("productCategoryFilter");
    if (!select) return;
    const categories = [...new Set(finishedProducts.map(p => p.category).filter(Boolean))].sort();
    const current = select.value;
    select.innerHTML = `<option value="">All Categories</option>` +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (categories.includes(current)) select.value = current;
}

function renderProductChips() {
    const searchInput = document.getElementById("productSearchInput");
    const categorySelect = document.getElementById("productCategoryFilter");
    const search = searchInput ? searchInput.value.trim().toLowerCase() : "";
    const category = categorySelect ? categorySelect.value : "";

    const filtered = finishedProducts.filter(p =>
        (!search || p.productName.toLowerCase().includes(search)) &&
        (!category || p.category === category)
    );

    const row = document.getElementById("productChipRow");
    if (!row) return;

    if (finishedProducts.length === 0) {
        row.innerHTML = `<span class="fps-empty-chip">No finished products found.</span>`;
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

document.getElementById("productSearchInput")?.addEventListener("input", renderProductChips);
document.getElementById("productCategoryFilter")?.addEventListener("change", renderProductChips);

function selectProduct(id) {
    selectedProductId = id;
    pendingProduct = new Map();
    renderProductChips();
    const panel = document.getElementById("selectedProductPanel");
    const noSelect = document.getElementById("noProductSelected");
    if (panel) panel.hidden = false;
    if (noSelect) noSelect.hidden = true;
    const product = finishedProducts.find(p => p.id === id);
    const prodNameEl = document.getElementById("selectedProductName");
    if (prodNameEl) prodNameEl.textContent = product ? product.productName : "—";
    renderProductActivityTable();
}

/* ==========================================================
   PRODUCT ACTIVITY TABLE
   ========================================================== */

function totalsFor(materialId, kind, range = "week") {
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
    if (!tbody) return;

    if (reqs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>No raw materials linked to this product.</p></div></td></tr>`;
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
                <td>${receivedTotal ? `<span class="total-pill positive">+${fmtQty(receivedTotal, mat.unit)}</span>` : `<span class="total-pill none">—</span>`}</td>
                <td>${usedTotal ? `<span class="total-pill negative">-${fmtQty(usedTotal, mat.unit)}</span>` : `<span class="total-pill none">—</span>`}</td>
                <td><span class="status ${status.cls}">${status.label}</span></td>
            </tr>`;
    }).join("");

    bindSteppers("productActivityTableBody", pendingProduct);
}

/* ==========================================================
   STEPPER CONTROL
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
    if (!container) return;
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
   SAVE ACTIVITY (STORED PROCEDURES: record_stock_receipt_v2, record_material_disbursement_v2)
   ========================================================== */

document.getElementById("saveActivityBtnProduct")?.addEventListener("click", async () => {
    await saveActivity(pendingProduct, selectedProductId);
});

document.getElementById("saveActivityBtnOverview")?.addEventListener("click", async () => {
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

    // Client-side pre-validation
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
            showToast(`Enter a valid Receive quantity for ${mat?.materialName || "the material"}.`, "error");
            return;
        }
    }

    try {
        /*
         * 1. EXECUTE RECEIVE TRANSACTIONS VIA STORED PROCEDURE
         */
        for (const [materialId, v] of receiveEntries) {
            const mat = materials.find(m => m.id === materialId);
            if (!mat) continue;

            const recQty = Number(v.receive);
            const { data, error } = await supabase.rpc("record_stock_receipt_v2", {
                p_material_id: materialId,
                p_receipt_date: todayIso(),
                p_quantity: recQty,
                p_unit: mat.unit || "kg",
                p_supplier_name: null
            });

            if (error) throw error;
        }

        /*
         * 2. EXECUTE CONSUMPTION TRANSACTIONS VIA STORED PROCEDURE
         */
        if (usedEntries.length > 0) {
            const selectedProd = finishedProducts.find(p => p.id === productId);
            const prodName = selectedProd ? selectedProd.productName : null;

            for (const [materialId, v] of usedEntries) {
                const mat = materials.find(m => m.id === materialId);
                if (!mat) continue;

                const usedQty = Number(v.used);
                const { data, error } = await supabase.rpc("record_material_disbursement_v2", {
                    p_material_id: materialId,
                    p_usage_date: todayIso(),
                    p_quantity: usedQty,
                    p_unit: mat.unit || "kg",
                    p_activity_type: prodName ? "Production" : "General Usage",
                    p_finished_product_name: prodName
                });

                if (error) throw error;
            }
        }

        showToast("Activity saved successfully.");
        pendingMap.clear();
        await loadAll();
    } catch (err) {
        console.error("Material Activity save failed:", err);
        const msg = String(err?.message || err?.details || err || "");
        if (msg.includes("Insufficient Stock")) {
            showToast("Transaction blocked: Insufficient recorded stock in database.", "error");
        } else if (msg.includes("Access Denied")) {
            showToast("Access denied: You are not authorized or session expired.", "error");
        } else {
            showToast("Could not save activity. Please try again.", "error");
        }
    }
}

/* ==========================================================
   SHARED RAW MATERIAL OVERVIEW (ONE MATERIAL = ONE ITEM)
   ========================================================== */

const STICKY_LEFT = [{ key: "name", label: "Raw Material" }];
const STICKY_RIGHT = [
    { key: "stock", label: "Current Stock" },
    { key: "receive", label: "Receive" },
    { key: "used", label: "Used" },
    { key: "status", label: "Status" }
];

function renderOverviewTable() {
    const table = document.getElementById("overviewTable");
    if (!table) return;

    if (materials.length === 0) {
        table.innerHTML = `<tr><td><div class="empty-state"><p>No raw materials found in catalog.</p></div></td></tr>`;
        return;
    }

    const thead = `<thead><tr>
        ${STICKY_LEFT.map(c => `<th class="sticky-col col-${c.key}">${c.label}</th>`).join("")}
        <th>Products Used For</th>
        <th>Total Received</th>
        <th>Total Consumed</th>
        <th>Net Movement</th>
        ${STICKY_RIGHT.map(c => `<th class="sticky-col col-${c.key}">${c.label}</th>`).join("")}
    </tr></thead>`;

    const rows = materials.map(mat => {
        if (!pendingOverview.has(mat.id)) pendingOverview.set(mat.id, { receive: 0, used: 0 });
        const pending = pendingOverview.get(mat.id);

        const totalRec = stockReceipts
            .filter(r => r.materialId === mat.id)
            .reduce((s, r) => s + Number(r.receivedQuantity || 0), 0);

        const totalUsed = usageRecords
            .filter(r => r.materialId === mat.id)
            .reduce((s, r) => s + Number(r.usedQuantity || 0), 0);

        const netMovement = totalRec - totalUsed;

        const productsSet = new Set();
        usageRecords.filter(u => u.materialId === mat.id).forEach(u => {
            if (u.finishedProductName) productsSet.add(u.finishedProductName.trim());
        });
        const productsList = productsSet.size > 0 ? Array.from(productsSet).join(", ") : "General Usage";

        const status = statusInfo(mat);

        return `<tr data-material-id="${mat.id}">
            <td class="sticky-col col-name"><strong>${escapeHtml(mat.materialName)}</strong> <small style="color:var(--text-muted);">(${escapeHtml(mat.itemCode || "")})</small></td>
            <td><span style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(productsList)}</span></td>
            <td>${totalRec > 0 ? `<span class="total-pill positive">+${fmtQty(totalRec, mat.unit)}</span>` : "—"}</td>
            <td>${totalUsed > 0 ? `<span class="total-pill negative">-${fmtQty(totalUsed, mat.unit)}</span>` : "—"}</td>
            <td><strong style="color:${netMovement >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${netMovement > 0 ? '+' : ''}${fmtQty(netMovement, mat.unit)}</strong></td>
            <td class="sticky-col col-stock"><strong>${fmtQty(mat.quantity, mat.unit)}</strong></td>
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
    let left = 0;
    STICKY_LEFT.forEach(c => {
        table.querySelectorAll(`.col-${c.key}`).forEach(el => { el.style.left = `${left}px`; });
        const sample = table.querySelector(`.col-${c.key}`);
        left += sample ? sample.offsetWidth : 160;
    });

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

document.getElementById("historyRangeFilter")?.addEventListener("change", renderHistory);

function renderHistory() {
    const rangeEl = document.getElementById("historyRangeFilter");
    const range = rangeEl ? rangeEl.value : "week";
    const tbody = document.getElementById("activityHistoryBody");
    if (!tbody) return;

    const receipts = stockReceipts
        .filter(r => withinRange(r.receivedDate, range))
        .map(r => {
            const mat = materials.find(m => m.id === r.materialId);
            return {
                date: r.receivedDate,
                activity: "Received",
                product: "—",
                material: mat ? mat.materialName : "Raw Material",
                qty: `+${fmtQty(r.receivedQuantity, r.unit)}`,
                by: usersById.get(r.receivedBy) || "Staff"
            };
        });

    const usages = usageRecords
        .filter(r => withinRange(r.usageDate, range))
        .map(r => {
            const mat = materials.find(m => m.id === r.materialId);
            return {
                date: r.usageDate,
                activity: "Used",
                product: r.finishedProductName || "General Usage",
                material: mat ? mat.materialName : "Raw Material",
                qty: `-${fmtQty(r.usedQuantity, r.unit)}`,
                by: usersById.get(r.recordedBy) || "Staff"
            };
        });

    const all = [...receipts, ...usages].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (all.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No activity recorded for this period.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = all.map(r => `
        <tr>
            <td>${r.date ? new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
            <td><span class="status ${r.activity === "Received" ? "available" : "low"}">${r.activity}</span></td>
            <td>${escapeHtml(r.product)}</td>
            <td><strong>${escapeHtml(r.material)}</strong></td>
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
