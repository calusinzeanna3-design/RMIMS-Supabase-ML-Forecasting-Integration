// RMIMS V2 — Finished Product Support Module (Inside Inventory Management)
// Supporting context for raw material consumption.
// Authoritative data source: public.material_disbursements (finished_product_name, material_id, consumed_quantity, unit).
// Master raw material reference: public.raw_materials.
// Transaction Authority: record_material_disbursement_v2().
// ZERO automatic BOM recipe deductions, NO price/cost logic, NO fake product data.

import { auth, supabase } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

let materials = [];
let finishedProducts = [];
let consumptionByProduct = new Map(); // productName -> [{ materialId, materialName, totalConsumed, unit, currentStock, status }]
let editingRequirements = [];
let pendingDeleteName = null;
let selectedImageData = null;
let importDataRows = [];
let importImages = [];
let importImageMap = new Map();

const $ = (id) => document.getElementById(id);
const fpsToggle = $("fpsToggle");
const fpsBody = $("fpsBody");
const fpsTableBody = $("fpsTableBody");
const fpsResultCount = $("fpsResultCount");
const addProductBtn = $("addProductBtn");
const fpsImportBtn = $("fpsImportBtn");

const fpModalOverlay = $("fpModalOverlay");
const fpModalTitle = $("fpModalTitle");
const fpModalSubtitle = $("fpModalSubtitle");
const fpModalClose = $("fpModalClose");
const fpModalCancel = $("fpModalCancel");
const fpModalSave = $("fpModalSave");
const fpId = $("fpId");
const fpName = $("fpName");
const fpNameError = $("fpNameError");
const fpCategory = $("fpCategory");
const fpCategoryNewWrap = $("fpCategoryNewWrap");
const fpCategoryNew = $("fpCategoryNew");
const fpUnit = $("fpUnit");
const fpDescription = $("fpDescription");
const fpImageFile = $("fpImageFile");
const fpImagePreview = $("fpImagePreview");
const fpStatus = $("fpStatus");
const fpAddRequirementBtn = $("fpAddRequirementBtn");
const fpRequirementsList = $("fpRequirementsList");
const fpRequirementsEmpty = $("fpRequirementsEmpty");

const fpConfirmModalOverlay = $("fpConfirmModalOverlay");
const fpConfirmCancelBtn = $("fpConfirmCancelBtn");
const fpConfirmOkBtn = $("fpConfirmOkBtn");
const toastStack = $("toastStack");

const fpImportModalOverlay = $("fpImportModalOverlay");
const fpImportModalClose = $("fpImportModalClose");
const fpImportCancelBtn = $("fpImportCancelBtn");
const fpChooseDataBtn = $("fpChooseDataBtn");
const fpImportDataFile = $("fpImportDataFile");
const fpImportDataName = $("fpImportDataName");
const fpChooseImagesBtn = $("fpChooseImagesBtn");
const fpImportImagesFiles = $("fpImportImagesFiles");
const fpImportImagesName = $("fpImportImagesName");
const fpImportImageMatches = $("fpImportImageMatches");
const fpImportPreviewBtn = $("fpImportPreviewBtn");
const fpImportConfirmBtn = $("fpImportConfirmBtn");
const fpImportPreviewSection = $("fpImportPreviewSection");
const fpImportSummary = $("fpImportSummary");
const fpImportWarnings = $("fpImportWarnings");
const fpImportPreviewBody = $("fpImportPreviewBody");
const fpImportGuideSteps = [...document.querySelectorAll("[data-import-guide-step]")];

function setImportGuideStep(step) {
    const active = Math.max(1, Math.min(4, Number(step) || 1));
    fpImportGuideSteps.forEach(el => {
        const n = Number(el.dataset.importGuideStep);
        el.classList.toggle("active", n === active);
        el.classList.toggle("completed", n < active);
    });
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
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

function normalizeName(value) {
    return String(value ?? "")
        .toLowerCase()
        .trim()
        .replace(/\.(png|jpe?g|webp)$/i, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
}

function fileNameWithoutExtension(fileName) {
    return String(fileName || "").replace(/\.[^.]+$/, "");
}

function formatQty(value, unit = "") {
    const n = Number(value);
    const text = Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "0";
    return unit ? `${text} ${unit}` : text;
}

function productInitials(name) {
    const words = String(name || "Product").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "P";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

function productImageHtml(p, large = false) {
    const cls = large ? "fp-product-image fp-product-image-large" : "fp-product-thumb";
    const name = p.productName || "Finished product";
    if (p.imageUrl) {
        return `<img class="${cls}" src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(name)}">`;
    }
    const avatarCls = large ? "fp-product-avatar fp-product-avatar-large" : "fp-product-avatar";
    return `<div class="${avatarCls}" aria-label="Product avatar for ${escapeHtml(name)}"><span>${escapeHtml(productInitials(name))}</span></div>`;
}

function computeProductStatus(productName) {
    const consumedMats = consumptionByProduct.get(productName) || [];
    if (!consumedMats.length) return { label: "No Usage Recorded", cls: "" };

    let hasCritical = false;
    let hasLow = false;
    for (const item of consumedMats) {
        const mat = materials.find(m => m.id === item.materialId);
        if (!mat || Number(mat.current_stock) <= 0) {
            hasCritical = true;
        } else if (mat.minimum_threshold !== null && Number(mat.current_stock) < Number(mat.minimum_threshold)) {
            hasLow = true;
        }
    }
    if (hasCritical) return { label: "Needs Restocking", cls: "out" };
    if (hasLow) return { label: "Running Low", cls: "low" };
    return { label: "Good", cls: "available" };
}

/* ==========================================================
   DATA LOAD (DERIVED FROM AUTHORITATIVE V2 DISBURSEMENTS)
   ========================================================== */

async function loadAll() {
    try {
        const [matRes, useRes] = await Promise.all([
            supabase.from("raw_materials").select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, description").order("name"),
            supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("created_at", { ascending: false })
        ]);

        if (matRes.error) throw matRes.error;
        if (useRes.error) console.warn("Disbursements query notice:", useRes.error);

        materials = (matRes.data || []).map(m => ({
            id: m.id,
            itemCode: m.item_code,
            materialName: m.name,
            unit: m.unit_of_measure || "kg",
            current_stock: Number(m.current_stock) || 0,
            minimum_threshold: m.minimum_threshold !== null ? Number(m.minimum_threshold) : null,
            description: m.description || ""
        }));

        const disbursements = useRes.data || [];

        // Group actual consumption by finished product name
        consumptionByProduct = new Map();
        const productMetadata = new Map(); // productName -> { category, unit, description, status }

        disbursements.forEach(d => {
            const rawProdName = d.finished_product_name ? d.finished_product_name.trim() : "";
            if (!rawProdName || rawProdName === "General Usage") return;

            if (!consumptionByProduct.has(rawProdName)) {
                consumptionByProduct.set(rawProdName, []);
                productMetadata.set(rawProdName, {
                    category: rawProdName.includes("Bread") || rawProdName === "Pandesal" ? "Bakery" : rawProdName.includes("Chips") ? "Snacks" : "Production",
                    unit: "batches",
                    description: `Production records for ${rawProdName}`,
                    status: "Active"
                });
            }

            const list = consumptionByProduct.get(rawProdName);
            const mat = materials.find(m => m.id === d.material_id);
            const qty = Number(d.consumed_quantity) || 0;
            const unit = d.unit || (mat ? mat.unit : "kg");

            const existingMat = list.find(item => item.materialId === d.material_id && item.unit === unit);
            if (existingMat) {
                existingMat.totalConsumed += qty;
            } else {
                list.push({
                    materialId: d.material_id,
                    materialName: mat ? mat.materialName : "Raw Material",
                    totalConsumed: qty,
                    unit,
                    currentStock: mat ? mat.current_stock : 0
                });
            }
        });

        // Build list of finished products
        finishedProducts = Array.from(consumptionByProduct.keys()).sort().map(name => {
            const meta = productMetadata.get(name) || {};
            return {
                id: name,
                productName: name,
                category: meta.category || "Production",
                unit: meta.unit || "batches",
                description: meta.description || "",
                status: meta.status || "Active",
                imageUrl: null
            };
        });

        renderCategoryOptions();
        renderTable();
    } catch (err) {
        console.error("Finished Product Setup load failed:", err);
        if (fpsTableBody) {
            fpsTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><strong>Unable to load finished products.</strong><span>Check the database connection and try again.</span></div></td></tr>`;
        }
    }
}

function renderCategoryOptions() {
    if (!fpCategory) return;
    const categories = [...new Set(finishedProducts.map(p => p.category).filter(Boolean))].sort();
    const current = fpCategory.value;
    fpCategory.innerHTML =
        `<option value="">Select Category</option>` +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("") +
        `<option value="__new__">Others</option>`;
    if (categories.includes(current)) fpCategory.value = current;
}

function renderTable() {
    if (!fpsTableBody) return;
    if (fpsResultCount) {
        fpsResultCount.textContent = `${finishedProducts.length} finished product${finishedProducts.length === 1 ? "" : "s"}`;
    }

    if (!finishedProducts.length) {
        fpsTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><strong>No finished-product usage records yet.</strong><span>Finished product insights will appear here once raw material consumption is recorded under specific finished products.</span></div></td></tr>`;
        return;
    }

    fpsTableBody.innerHTML = finishedProducts.map((p) => {
        const consumedMats = consumptionByProduct.get(p.productName) || [];
        const status = computeProductStatus(p.productName);
        const chips = consumedMats.length
            ? consumedMats.map(r => {
                return `<span class="fps-material-chip"><strong>${escapeHtml(r.materialName)}</strong> ${escapeHtml(formatQty(r.totalConsumed, r.unit))}</span>`;
            }).join("")
            : `<span class="fps-empty-chip">No consumption recorded</span>`;

        return `
        <tr class="fp-main-row" data-id="${escapeHtml(p.id)}">
            <td>
                <button type="button" class="fp-product-trigger" data-action="toggle" data-id="${escapeHtml(p.id)}" aria-expanded="false">
                    ${productImageHtml(p)}
                    <span class="fp-product-copy">
                        <strong>${escapeHtml(p.productName)}</strong>
                        <small>${escapeHtml(p.description || "Consumption Context")}</small>
                    </span>
                </button>
            </td>
            <td>${escapeHtml(p.category || "—")}</td>
            <td><div class="fps-materials-cell">${chips}</div></td>
            <td><span class="status ${status.cls}">${escapeHtml(status.label)}</span></td>
            <td class="fp-actions-cell">
                <button type="button" class="btn-secondary btn-sm fp-view-btn" data-action="toggle" data-id="${escapeHtml(p.id)}" title="View raw materials consumed">View</button>
                <button type="button" class="btn-secondary btn-sm fp-edit-btn" data-action="edit" data-id="${escapeHtml(p.id)}">Log Usage</button>
            </td>
        </tr>`;
    }).join("");

    fpsTableBody.querySelectorAll(".fp-detail-row").forEach(el => el.remove());
}

function renderExpandedProduct(productName, trigger) {
    const existing = fpsTableBody.querySelector(`.fp-detail-row[data-for="${CSS.escape(productName)}"]`);
    if (existing) {
        existing.remove();
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        return;
    }

    fpsTableBody.querySelectorAll(".fp-detail-row").forEach(el => el.remove());
    fpsTableBody.querySelectorAll(".fp-product-trigger, .fp-view-btn").forEach(el => el.setAttribute("aria-expanded", "false"));

    const product = finishedProducts.find(p => p.productName === productName);
    if (!product) return;

    const consumedMats = consumptionByProduct.get(productName) || [];
    const detail = document.createElement("tr");
    detail.className = "fp-detail-row";
    detail.dataset.for = productName;

    const rows = consumedMats.length ? consumedMats.map(r => {
        const mat = materials.find(m => m.id === r.materialId);
        const stock = mat ? Number(mat.current_stock) : 0;
        const minThreshold = mat?.minimum_threshold !== null ? Number(mat?.minimum_threshold) : null;
        let stockState = "Available";
        if (stock <= 0) stockState = "Out of Stock";
        else if (minThreshold !== null && stock < minThreshold) stockState = "Low Stock";
        const cls = stockState === "Available" ? "available" : stockState === "Low Stock" ? "low" : "out";

        return `<tr>
            <td><strong>${escapeHtml(r.materialName)}</strong></td>
            <td>${escapeHtml(mat?.description || "—")}</td>
            <td>${escapeHtml(formatQty(r.totalConsumed, r.unit))}</td>
            <td>${escapeHtml(r.unit || "—")}</td>
            <td>${escapeHtml(formatQty(stock, r.unit))}</td>
            <td><span class="status ${cls}">${escapeHtml(stockState)}</span></td>
        </tr>`;
    }).join("") : `<tr><td colspan="6"><div class="empty-state"><span>No raw materials recorded for this product yet.</span></div></td></tr>`;

    detail.innerHTML = `<td colspan="5">
        <div class="fp-expanded-panel">
            <div class="fp-expanded-product">
                ${productImageHtml(product, true)}
                <div class="fp-expanded-copy">
                    <h4>${escapeHtml(product.productName)}</h4>
                    <p>${escapeHtml(product.description || "Historical raw-material consumption context.")}</p>
                    <div class="fp-meta-line">
                        <span>${escapeHtml(product.category || "Production")}</span>
                        <span>${escapeHtml(product.unit || "batches")}</span>
                        <span class="status ${product.status === "Active" ? "available" : "low"}">${escapeHtml(product.status || "Active")}</span>
                    </div>
                </div>
            </div>
            <div class="fp-expanded-materials">
                <div class="fp-expanded-title">
                    <strong>Actual Raw Materials Consumed</strong>
                    <span>${consumedMats.length} material${consumedMats.length === 1 ? "" : "s"} used</span>
                </div>
                <div class="table-scroll">
                    <table>
                        <thead><tr><th>Raw Material</th><th>Category</th><th>Total Consumed</th><th>Unit</th><th>Current Stock Balance</th><th>Stock Status</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        </div>
    </td>`;

    const mainRow = fpsTableBody.querySelector(`.fp-main-row[data-id="${CSS.escape(productName)}"]`);
    mainRow?.after(detail);
    trigger?.setAttribute("aria-expanded", "true");
}

function resetImagePicker() {
    selectedImageData = null;
    if (fpImageFile) fpImageFile.value = "";
    if (fpImagePreview) {
        fpImagePreview.hidden = true;
        fpImagePreview.innerHTML = "";
    }
}

function renderImagePreview(dataUrl) {
    if (!fpImagePreview) return;
    if (!dataUrl) {
        fpImagePreview.hidden = true;
        fpImagePreview.innerHTML = "";
        return;
    }
    fpImagePreview.hidden = false;
    fpImagePreview.innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="Product image preview">`;
}

function openModal(mode, product) {
    if (!fpModalOverlay) return;
    fpModalTitle.textContent = mode === "edit" ? `Record Usage for ${product?.productName || "Product"}` : "Add Finished Product Consumption";
    fpModalSubtitle.textContent = "Log actual raw-material consumption under this finished product context.";

    fpId.value = product?.productName || "";
    fpName.value = product?.productName || "";
    if (fpCategoryNewWrap) fpCategoryNewWrap.hidden = true;
    if (fpCategoryNew) fpCategoryNew.value = "";
    if (fpUnit) fpUnit.value = product?.unit || "batches";
    if (fpDescription) fpDescription.value = product?.description || "";
    if (fpStatus) fpStatus.value = product?.status || "Active";
    if (fpNameError) fpNameError.textContent = "";
    selectedImageData = product?.imageUrl || null;
    if (fpImageFile) fpImageFile.value = "";
    renderImagePreview(selectedImageData);

    renderCategoryOptions();
    if (fpCategory) {
        fpCategory.value = product?.category && [...fpCategory.options].some(o => o.value === product.category)
            ? product.category : "";
    }

    editingRequirements = [];
    renderRequirementsList();
    fpModalOverlay.classList.add("open");
}

function closeModal() {
    if (fpModalOverlay) fpModalOverlay.classList.remove("open");
    resetImagePicker();
}

function availableMaterialsFor(rowIndex) {
    const chosen = editingRequirements.map((r, i) => i === rowIndex ? null : r.materialId).filter(Boolean);
    return materials.filter(m => !chosen.includes(m.id));
}

function renderRequirementsList() {
    if (!fpRequirementsList || !fpRequirementsEmpty) return;
    fpRequirementsEmpty.hidden = editingRequirements.length > 0;
    fpRequirementsList.querySelectorAll(".fps-req-row").forEach(el => el.remove());

    editingRequirements.forEach((req, index) => {
        const row = document.createElement("div");
        row.className = "fps-req-row";
        const options = availableMaterialsFor(index).map(m =>
            `<option value="${escapeHtml(m.id)}" ${m.id === req.materialId ? "selected" : ""}>${escapeHtml(m.materialName)} (Stock: ${m.current_stock} ${m.unit})</option>`
        ).join("");
        const selected = materials.find(m => m.id === req.materialId);

        row.innerHTML = `
            <div class="input-group">
                <label>Raw Material</label>
                <select class="fp-req-material">
                    <option value="">Select raw material</option>${options}
                </select>
            </div>
            <div class="input-group">
                <label>Quantity to Disburse</label>
                <input type="number" min="0.01" step="any" class="fp-req-qty" value="${escapeHtml(req.requiredQuantity ?? "")}" placeholder="0">
            </div>
            <div class="fps-req-unit">${escapeHtml(selected?.unit || "kg")}</div>
            <button type="button" class="fps-req-remove" title="Remove row">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>`;

        row.querySelector(".fp-req-material").addEventListener("change", e => {
            editingRequirements[index].materialId = e.target.value || null;
            renderRequirementsList();
        });
        row.querySelector(".fp-req-qty").addEventListener("input", e => {
            editingRequirements[index].requiredQuantity = e.target.value;
        });
        row.querySelector(".fps-req-remove").addEventListener("click", () => {
            editingRequirements.splice(index, 1);
            renderRequirementsList();
        });
        fpRequirementsList.appendChild(row);
    });
}

if (fpAddRequirementBtn) {
    fpAddRequirementBtn.addEventListener("click", () => {
        if (!materials.length) {
            showToast("No raw materials found in catalog. Add materials in Inventory first.", "warn");
            return;
        }
        editingRequirements.push({ materialId: null, requiredQuantity: "" });
        renderRequirementsList();
    });
}

if (fpCategory) {
    fpCategory.addEventListener("change", () => {
        if (fpCategoryNewWrap) fpCategoryNewWrap.hidden = fpCategory.value !== "__new__";
    });
}

if (fpImageFile) {
    fpImageFile.addEventListener("change", async () => {
        const file = fpImageFile.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            showToast("Please choose a valid image file.", "error");
            return;
        }
        try {
            selectedImageData = await compressImage(file);
            renderImagePreview(selectedImageData);
        } catch (err) {
            showToast("Could not read the image.", "error");
        }
    });
}

async function compressImage(file, maxSize = 1000, quality = 0.82) {
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = dataUrl;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
}

if (fpModalSave) {
    fpModalSave.addEventListener("click", async () => {
        if (fpNameError) fpNameError.textContent = "";
        const name = fpName.value.trim();
        if (!name) {
            if (fpNameError) fpNameError.textContent = "Finished product name is required.";
            return;
        }

        const cleanDisbursements = [];
        const seen = new Set();
        for (const r of editingRequirements) {
            if (!r.materialId) {
                if (r.requiredQuantity) {
                    showToast("Select a raw material for every row.", "error");
                    return;
                }
                continue;
            }
            const qty = Number(r.requiredQuantity);
            if (!Number.isFinite(qty) || qty <= 0) {
                showToast("Disbursed quantity must be greater than 0.", "error");
                return;
            }
            if (seen.has(r.materialId)) {
                showToast("A raw material can only be assigned once per entry.", "error");
                return;
            }
            seen.add(r.materialId);
            const mat = materials.find(m => m.id === r.materialId);
            if (mat && qty > mat.current_stock) {
                showToast(`Cannot disburse ${qty} ${mat.unit} of ${mat.materialName}. Current stock is only ${mat.current_stock} ${mat.unit}.`, "error");
                return;
            }
            cleanDisbursements.push({
                materialId: r.materialId,
                quantity: qty,
                unit: mat?.unit || "kg"
            });
        }

        if (!cleanDisbursements.length) {
            showToast("Please add at least one raw material to record consumption.", "warn");
            return;
        }

        fpModalSave.disabled = true;
        try {
            const today = new Date().toISOString().slice(0, 10);
            for (const d of cleanDisbursements) {
                const { error: rpcErr } = await supabase.rpc("record_material_disbursement_v2", {
                    p_material_id: d.materialId,
                    p_usage_date: today,
                    p_quantity: d.quantity,
                    p_unit: d.unit,
                    p_activity_type: "Production",
                    p_finished_product_name: name
                });
                if (rpcErr) throw rpcErr;
            }

            showToast(`Recorded consumption for ${name} successfully.`);
            closeModal();
            await loadAll();
            window.dispatchEvent(new CustomEvent("rmims:inventory-changed"));
        } catch (err) {
            console.error(err);
            showToast(err.message || "Could not record consumption.", "error");
        } finally {
            fpModalSave.disabled = false;
        }
    });
}

if (fpsTableBody) {
    fpsTableBody.addEventListener("click", e => {
        const action = e.target.closest("[data-action]");
        if (!action) return;
        const id = action.dataset.id;
        if (action.dataset.action === "toggle") {
            renderExpandedProduct(id, action);
        } else if (action.dataset.action === "edit") {
            const product = finishedProducts.find(p => p.productName === id);
            if (product) openModal("edit", product);
        }
    });
}

if (fpModalClose) fpModalClose.addEventListener("click", closeModal);
if (fpModalCancel) fpModalCancel.addEventListener("click", closeModal);
if (fpModalOverlay) fpModalOverlay.addEventListener("click", e => { if (e.target === fpModalOverlay) closeModal(); });
if (addProductBtn) addProductBtn.addEventListener("click", () => openModal("add", null));

if (fpsToggle) {
    fpsToggle.addEventListener("click", () => {
        const expanded = fpsToggle.getAttribute("aria-expanded") === "true";
        fpsToggle.setAttribute("aria-expanded", String(!expanded));
        if (fpsBody) fpsBody.hidden = expanded;
        if (!expanded) loadAll();
    });
}

/* ==========================================================
   BULK IMPORT FINISHED PRODUCT CONSUMPTION
   ========================================================== */

function resetImportState() {
    importDataRows = [];
    importImages = [];
    importImageMap = new Map();
    if (fpImportDataFile) fpImportDataFile.value = "";
    if (fpImportImagesFiles) fpImportImagesFiles.value = "";
    if (fpImportDataName) fpImportDataName.textContent = "No data file selected.";
    if (fpImportImagesName) fpImportImagesName.textContent = "No images selected.";
    if (fpImportImageMatches) fpImportImageMatches.innerHTML = "";
    if (fpImportPreviewSection) fpImportPreviewSection.hidden = true;
    if (fpImportSummary) fpImportSummary.innerHTML = "";
    if (fpImportWarnings) fpImportWarnings.innerHTML = "";
    if (fpImportPreviewBody) fpImportPreviewBody.innerHTML = "";
    if (fpImportConfirmBtn) fpImportConfirmBtn.disabled = true;
    setImportGuideStep(1);
}

function openImportModal() {
    resetImportState();
    if (fpImportModalOverlay) fpImportModalOverlay.classList.add("open");
}

function closeImportModal() {
    if (fpImportModalOverlay) fpImportModalOverlay.classList.remove("open");
}

if (fpsImportBtn) fpsImportBtn.addEventListener("click", openImportModal);
if (fpImportModalClose) fpImportModalClose.addEventListener("click", closeImportModal);
if (fpImportCancelBtn) fpImportCancelBtn.addEventListener("click", closeImportModal);
if (fpImportModalOverlay) {
    fpImportModalOverlay.addEventListener("click", e => {
        if (e.target === fpImportModalOverlay) closeImportModal();
    });
}
if (fpChooseDataBtn) fpChooseDataBtn.addEventListener("click", () => fpImportDataFile?.click());
if (fpChooseImagesBtn) fpChooseImagesBtn.addEventListener("click", () => fpImportImagesFiles?.click());

if (fpImportDataFile) {
    fpImportDataFile.addEventListener("change", async () => {
        const file = fpImportDataFile.files?.[0];
        if (!file) return;
        if (fpImportDataName) fpImportDataName.textContent = file.name;
        try {
            importDataRows = await parseImportFile(file);
            showToast(`${importDataRows.length} data row${importDataRows.length === 1 ? "" : "s"} loaded successfully.`, "success");
            setImportGuideStep(2);
            runImportPreviewUI();
        } catch (err) {
            importDataRows = [];
            showToast(err.message || "Could not read the import file.", "error");
            runImportPreviewUI();
        }
    });
}

if (fpImportImagesFiles) {
    fpImportImagesFiles.addEventListener("change", async () => {
        importImages = [...(fpImportImagesFiles.files || [])];
        if (fpImportImagesName) fpImportImagesName.textContent = `${importImages.length} image${importImages.length === 1 ? "" : "s"} selected.`;
        importImageMap = new Map();
        for (const file of importImages) {
            try {
                importImageMap.set(normalizeName(fileNameWithoutExtension(file.name)), await compressImage(file));
            } catch (err) {
                console.warn("Image skipped:", file.name, err);
            }
        }
        setImportGuideStep(3);
        runImportPreviewUI();
    });
}

async function parseImportFile(file) {
    if (typeof XLSX === "undefined") throw new Error("Spreadsheet importer is unavailable.");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
        throw new Error("The import file is empty.");
    }

    const allParsedRows = [];

    function isFinishedProductHeader(h) {
        if (!h || h.includes("batches") || h.includes("entries") || h.includes("summary") || h.includes("total") || h.includes("date")) return false;
        return h === "finished product" || h === "product" || h === "product name" || h === "finished product name" || h === "finished_product" || h === "product_name" || h === "item name" || h === "item";
    }

    function isRawMaterialHeader(h) {
        if (!h || h.includes("entries") || h.includes("summary") || h.includes("total") || h.includes("date")) return false;
        return h === "raw material" || h === "material" || h === "material name" || h === "raw material name" || h === "raw_material" || h === "material_name" || h === "ingredient";
    }

    function isDateValue(val) {
        return /^\d{4}-\d{2}-\d{2}/.test(String(val || "").trim()) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(String(val || "").trim());
    }

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        const rawAoA = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (!rawAoA || !rawAoA.length) continue;

        let headerRowIndex = -1;
        let colIdx = { prod: -1, mat: -1, cat: -1, qty: -1, unit: -1, supplier: -1 };

        for (let r = 0; r < rawAoA.length; r++) {
            const rowVals = (rawAoA[r] || []).map(v => normalizeHeader(v));
            const prodIdx = rowVals.findIndex(h => isFinishedProductHeader(h));
            const matIdx = rowVals.findIndex(h => isRawMaterialHeader(h));

            if (prodIdx !== -1 && matIdx !== -1 && prodIdx !== matIdx) {
                headerRowIndex = r;
                colIdx = {
                    prod: prodIdx,
                    mat: matIdx,
                    cat: rowVals.findIndex(h => h.includes("category")),
                    qty: rowVals.findIndex(h => h.includes("quantity") || h.includes("qty") || h.includes("used") || h.includes("amount") || h.includes("consumed")),
                    unit: rowVals.findIndex(h => h.includes("unit")),
                    supplier: rowVals.findIndex(h => h.includes("supplier"))
                };
                break;
            }
        }

        if (headerRowIndex !== -1) {
            for (let r = headerRowIndex + 1; r < rawAoA.length; r++) {
                const row = rawAoA[r] || [];
                const productName = String(row[colIdx.prod] || "").trim();
                const materialName = String(row[colIdx.mat] || "").trim();
                if (!productName || !materialName) continue;
                if (isDateValue(productName) || isDateValue(materialName)) continue;

                const normProd = normalizeHeader(productName);
                if (normProd.includes("finished product") || normProd.includes("total") || normProd.includes("disbursement") || normProd.includes("received")) continue;

                allParsedRows.push({
                    "finished product": productName,
                    "raw material": materialName,
                    "category": colIdx.cat !== -1 ? String(row[colIdx.cat] || "").trim() : "",
                    "required quantity": colIdx.qty !== -1 ? Number(row[colIdx.qty]) || 1 : 1,
                    "unit": colIdx.unit !== -1 ? String(row[colIdx.unit] || "").trim() : "",
                    "supplier": colIdx.supplier !== -1 ? String(row[colIdx.supplier] || "").trim() : ""
                });
            }
        } else {
            const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
            sheetRows.forEach(row => {
                const out = {};
                Object.entries(row).forEach(([k, v]) => { out[normalizeHeader(k)] = v; });
                const prod = value(out, "finished product", "product", "product name", "item");
                const mat = value(out, "raw material", "material", "material name");
                if (prod && mat && !isDateValue(prod) && !isDateValue(mat)) {
                    allParsedRows.push(out);
                }
            });
        }
    }

    if (!allParsedRows.length) {
        throw new Error("No finished product and raw material records found in the import file.");
    }

    return allParsedRows;
}

function normalizeHeader(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
}

function value(row, ...keys) {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== "") return String(row[key]).trim();
    }
    return "";
}

function getImageForProduct(productName) {
    const key = normalizeName(productName);
    if (importImageMap.has(key)) return importImageMap.get(key);
    for (const [imgKey, imgData] of importImageMap.entries()) {
        if (key.includes(imgKey) || imgKey.includes(key)) {
            return imgData;
        }
    }
    return null;
}

function buildImportGroups() {
    const groups = new Map();
    for (const row of importDataRows) {
        const productName = value(row, "finished product", "product", "product name");
        const materialName = value(row, "raw material", "material", "material name");
        if (!productName || !materialName) continue;

        const key = normalizeName(productName);
        if (!groups.has(key)) {
            groups.set(key, {
                productName,
                category: value(row, "category"),
                unit: value(row, "unit", "product unit"),
                description: value(row, "description"),
                status: value(row, "status") || "Active",
                materials: []
            });
        }
        const g = groups.get(key);
        const qty = Number(value(row, "required quantity", "quantity", "required qty", "consumed quantity", "used")) || 1;
        g.materials.push({
            name: materialName,
            category: value(row, "raw material category", "material category"),
            unit: value(row, "raw material unit", "material unit", "unit"),
            quantity: qty,
            stock: Number(value(row, "current stock", "stock")) || 0,
            minimum: Number(value(row, "minimum stock", "minimum threshold", "min stock")) || 0,
            supplier: value(row, "supplier"),
            storageLocation: value(row, "storage location"),
            notes: value(row, "notes", "description")
        });
    }
    return [...groups.values()];
}

function renderImageMatchPreview() {
    const groups = buildImportGroups();
    if (!groups.length || !importImageMap.size || !fpImportImageMatches) {
        if (fpImportImageMatches) fpImportImageMatches.innerHTML = "";
        return;
    }
    const html = groups.map(g => {
        const img = getImageForProduct(g.productName);
        return `<div class="fp-import-match ${img ? "matched" : "unmatched"}">
            ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(g.productName)}">` : `<div class="fp-product-avatar fp-product-avatar-small" aria-label="Product avatar"><span>${escapeHtml(productInitials(g.productName))}</span></div>`}
            <span>${escapeHtml(g.productName)}</span>
            <small>${img ? "Image matched" : "No matching image"}</small>
        </div>`;
    }).join("");
    fpImportImageMatches.innerHTML = html;
}

function inventoryMatch(materialName) {
    const key = normalizeName(materialName);
    return materials.find(m => normalizeName(m.materialName) === key);
}

function buildImportPreview() {
    const groups = buildImportGroups();
    const warnings = [];
    let materialEntries = 0;
    let missingMaterials = 0;
    let matchedImages = 0;
    let unmatchedImages = 0;

    groups.forEach(g => {
        const image = getImageForProduct(g.productName);
        if (image) matchedImages++;

        const seen = new Set();
        g.materials.forEach(m => {
            materialEntries++;
            if (!Number.isFinite(m.quantity) || m.quantity <= 0) warnings.push(`${g.productName}: invalid consumption quantity for ${m.name}.`);
            const existing = inventoryMatch(m.name);
            if (!existing) missingMaterials++;
            const k = normalizeName(m.name);
            if (seen.has(k)) warnings.push(`${g.productName}: ${m.name} is listed more than once.`);
            seen.add(k);
        });
    });

    for (const key of importImageMap.keys()) {
        if (!groups.some(g => normalizeName(g.productName) === key || normalizeName(g.productName).includes(key) || key.includes(normalizeName(g.productName)))) {
            unmatchedImages++;
        }
    }

    if (unmatchedImages) warnings.push(`${unmatchedImages} uploaded image${unmatchedImages === 1 ? "" : "s"} did not match a product name.`);
    if (missingMaterials) warnings.push(`${missingMaterials} raw-material reference${missingMaterials === 1 ? "" : "s"} must exist in Inventory before logging consumption.`);
    if (!groups.length) warnings.push("No valid finished-product rows were found.");
    return { groups, warnings, materialEntries, missingMaterials, matchedImages, unmatchedImages };
}

function runImportPreviewUI() {
    setImportGuideStep(3);
    const preview = buildImportPreview();
    if (!preview.groups.length) {
        if (fpImportConfirmBtn) fpImportConfirmBtn.disabled = true;
        if (fpImportPreviewSection) fpImportPreviewSection.hidden = false;
        if (fpImportSummary) fpImportSummary.innerHTML = `<div class="fp-import-stat error"><strong>0</strong><span>finished products</span></div>`;
        if (fpImportWarnings) fpImportWarnings.innerHTML = `<div class="field-error">${escapeHtml(preview.warnings[0] || "No valid data found.")}</div>`;
        if (fpImportPreviewBody) fpImportPreviewBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px 0; color:var(--rm-ink-dim);">No finished product preview rows generated.</td></tr>`;
        return;
    }

    if (fpImportPreviewSection) fpImportPreviewSection.hidden = false;
    if (fpImportConfirmBtn) fpImportConfirmBtn.disabled = false;
    if (fpImportSummary) {
        fpImportSummary.innerHTML = `
            <div class="fp-import-stat"><strong>${preview.groups.length}</strong><span>finished products</span></div>
            <div class="fp-import-stat"><strong>${preview.materialEntries}</strong><span>raw-material entries</span></div>
            <div class="fp-import-stat"><strong>${preview.matchedImages}</strong><span>images matched</span></div>
            <div class="fp-import-stat"><strong>${preview.missingMaterials}</strong><span>unmatched materials</span></div>`;
    }

    if (fpImportWarnings) {
        fpImportWarnings.innerHTML = preview.warnings.length
            ? preview.warnings.map(w => `<div class="fp-import-warning">⚠ ${escapeHtml(w)}</div>`).join("")
            : `<div class="fp-import-success">✓ Ready to record finished-product consumption.</div>`;
    }

    if (fpImportPreviewBody) {
        fpImportPreviewBody.innerHTML = preview.groups.flatMap(g => g.materials.map(m => {
            const existing = inventoryMatch(m.name);
            const image = getImageForProduct(g.productName);
            return `<tr>
                <td>${image ? `<img class="fp-import-mini-image" src="${escapeHtml(image)}" alt="${escapeHtml(g.productName)}">` : `<span class="fp-product-avatar fp-product-avatar-mini" aria-label="Product avatar"><span>${escapeHtml(productInitials(g.productName))}</span></span>`}</td>
                <td><strong>${escapeHtml(g.productName)}</strong></td>
                <td>${escapeHtml(g.category || "—")}</td>
                <td>${escapeHtml(m.name)}</td>
                <td>${escapeHtml(formatQty(m.quantity, m.unit))}</td>
                <td>${existing ? `<span class="status available">Disburse from stock</span>` : `<span class="status low">Material not in Catalog</span>`}</td>
            </tr>`;
        })).join("");
    }

    renderImageMatchPreview();
    setImportGuideStep(4);
}

if (fpImportPreviewBtn) fpImportPreviewBtn.addEventListener("click", runImportPreviewUI);

if (fpImportConfirmBtn) {
    fpImportConfirmBtn.addEventListener("click", async () => {
        const preview = buildImportPreview();
        if (!preview.groups.length || preview.warnings.some(w => /invalid consumption quantity/i.test(w))) return;

        fpImportConfirmBtn.disabled = true;
        let successCount = 0;
        let errorCount = 0;
        const today = new Date().toISOString().slice(0, 10);

        try {
            for (const g of preview.groups) {
                for (const m of g.materials) {
                    const mat = inventoryMatch(m.name);
                    if (!mat) {
                        errorCount++;
                        continue;
                    }

                    const { error: rpcErr } = await supabase.rpc("record_material_disbursement_v2", {
                        p_material_id: mat.id,
                        p_usage_date: today,
                        p_quantity: m.quantity,
                        p_unit: mat.unit || m.unit || "kg",
                        p_activity_type: "Production",
                        p_finished_product_name: g.productName
                    });

                    if (rpcErr) {
                        console.warn("Disbursement import error:", rpcErr);
                        errorCount++;
                    } else {
                        successCount++;
                    }
                }
            }

            showToast(`Imported consumption: ${successCount} entries processed${errorCount > 0 ? `, ${errorCount} errors` : ""}.`);
            closeImportModal();
            await loadAll();
            window.dispatchEvent(new CustomEvent("rmims:inventory-changed"));
        } catch (err) {
            console.error(err);
            showToast(err.message || "Import failed.", "error");
        } finally {
            fpImportConfirmBtn.disabled = false;
        }
    });
}

/* ==========================================================
   ROLE GUARD
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
            window.location.href = "../user/dashboard.html";
            return;
        }
    } catch (e) {
        console.warn("Finished product setup role check failed:", e);
    }
    loadAll();
});
