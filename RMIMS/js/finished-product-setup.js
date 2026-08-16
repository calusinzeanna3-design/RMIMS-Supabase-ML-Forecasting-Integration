// Finished Product Setup — inside Inventory Management only.
// No ML, forecasting, REST API, or external model integration.
// Finished-product data stays linked to the existing Inventory materials.

import { auth, db } from "../supabase/supabase-config.js";
import {
    collection, getDocs, doc, addDoc, updateDoc, deleteDoc, query, where
} from "../supabase/db-compat.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

let materials = [];
let finishedProducts = [];
let requirementsByProduct = new Map();
let editingRequirements = [];
let pendingDeleteId = null;
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
        "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
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

function sanitizeImageUrl(url) {
    if (!url) return "";
    const clean = String(url).trim();
    if (/^https?:\/\//i.test(clean) || /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(clean)) {
        return escapeHtml(clean);
    }
    return "";
}

function productImageHtml(p, large = false) {
    const cls = large ? "fp-product-image fp-product-image-large" : "fp-product-thumb";
    const name = p.productName || "Finished product";
    const safeUrl = sanitizeImageUrl(p.imageUrl);
    if (safeUrl) {
        return `<img class="${cls}" src="${safeUrl}" alt="${escapeHtml(name)}">`;
    }
    const avatarCls = large ? "fp-product-avatar fp-product-avatar-large" : "fp-product-avatar";
    return `<div class="${avatarCls}" aria-label="Product avatar for ${escapeHtml(name)}"><span>${escapeHtml(productInitials(name))}</span></div>`;
}

function computeProductStatus(productId) {
    const reqs = requirementsByProduct.get(productId) || [];
    if (!reqs.length) return { label: "No Materials Set", cls: "" };

    let insufficient = false;
    let low = false;
    for (const r of reqs) {
        const mat = materials.find((m) => m.id === r.materialId);
        if (!mat || Number(mat.quantity) < Number(r.requiredQuantity)) {
            insufficient = true;
            continue;
        }
        if (mat.status === "Low" || mat.status === "Critical") low = true;
    }
    if (insufficient) return { label: "Needs Restocking", cls: "out" };
    if (low) return { label: "Running Low", cls: "low" };
    return { label: "Good", cls: "available" };
}

async function loadAll() {
    try {
        const [matSnap, productSnap, reqSnap] = await Promise.all([
            getDocs(collection(db, "materials")),
            getDocs(collection(db, "finishedProducts")),
            getDocs(collection(db, "productMaterialRequirements"))
        ]);

        materials = matSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        finishedProducts = productSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        requirementsByProduct = new Map();
        reqSnap.docs.forEach((d) => {
            const data = { id: d.id, ...d.data() };
            const list = requirementsByProduct.get(data.productId) || [];
            list.push(data);
            requirementsByProduct.set(data.productId, list);
        });

        renderCategoryOptions();
        renderTable();
    } catch (err) {
        console.error("Finished Product Setup load failed:", err);
        fpsTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><strong>Unable to load finished products.</strong><span>Check the database setup and try again.</span></div></td></tr>`;
    }
}

function renderCategoryOptions() {
    const categories = [...new Set(finishedProducts.map(p => p.category).filter(Boolean))].sort();
    const current = fpCategory.value;
    fpCategory.innerHTML =
        `<option value="">Select Category</option>` +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("") +
        `<option value="__new__">Others</option>`;
    if (categories.includes(current)) fpCategory.value = current;
}

function renderTable() {
    fpsResultCount.textContent = `${finishedProducts.length} finished product${finishedProducts.length === 1 ? "" : "s"}`;

    if (!finishedProducts.length) {
        fpsTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No finished products set up yet. Click "Add Finished Product" or "Import" to get started.</p></div></td></tr>`;
        return;
    }

    fpsTableBody.innerHTML = finishedProducts.map((p, index) => {
        const reqs = requirementsByProduct.get(p.id) || [];
        const status = computeProductStatus(p.id);
        const chips = reqs.length
            ? reqs.map(r => {
                const mat = materials.find(m => m.id === r.materialId);
                return `<span class="fps-material-chip"><strong>${escapeHtml(mat?.materialName || "Missing material")}</strong> ${escapeHtml(formatQty(r.requiredQuantity, r.unit || mat?.unit || ""))}</span>`;
            }).join("")
            : `<span class="fps-empty-chip">No raw materials assigned</span>`;

        return `
        <tr class="fp-main-row" data-id="${escapeHtml(p.id)}">
            <td>
                <button type="button" class="fp-product-trigger" data-action="toggle" data-id="${escapeHtml(p.id)}" aria-expanded="false">
                    ${productImageHtml(p)}
                    <span class="fp-product-copy">
                        <strong>${escapeHtml(p.productName)}</strong>
                        <small>${escapeHtml(p.description || "No description")}</small>
                    </span>
                </button>
            </td>
            <td>${escapeHtml(p.category || "—")}</td>
            <td><div class="fps-materials-cell">${chips}</div></td>
            <td><span class="status ${status.cls}">${escapeHtml(status.label)}</span></td>
            <td class="fp-actions-cell">
                <button type="button" class="btn-secondary btn-sm fp-view-btn" data-action="toggle" data-id="${escapeHtml(p.id)}" title="View raw materials">View</button>
                <button type="button" class="btn-secondary btn-sm fp-edit-btn" data-action="edit" data-id="${escapeHtml(p.id)}">Edit</button>
                <button type="button" class="btn-secondary btn-sm fp-delete-btn" data-action="delete" data-id="${escapeHtml(p.id)}">Remove</button>
            </td>
        </tr>`;
    }).join("");

    // Keep one expansion at a time and render detail rows.
    fpsTableBody.querySelectorAll(".fp-detail-row").forEach(el => el.remove());
}

function renderExpandedProduct(productId, trigger) {
    const existing = fpsTableBody.querySelector(`.fp-detail-row[data-for="${CSS.escape(productId)}"]`);
    if (existing) {
        existing.remove();
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        return;
    }

    // Remove any other expanded product.
    fpsTableBody.querySelectorAll(".fp-detail-row").forEach(el => el.remove());
    fpsTableBody.querySelectorAll(".fp-product-trigger, .fp-view-btn").forEach(el => el.setAttribute("aria-expanded", "false"));

    const product = finishedProducts.find(p => p.id === productId);
    if (!product) return;

    const reqs = requirementsByProduct.get(productId) || [];
    const detail = document.createElement("tr");
    detail.className = "fp-detail-row";
    detail.dataset.for = productId;

    const rows = reqs.length ? reqs.map(r => {
        const mat = materials.find(m => m.id === r.materialId);
        const required = Number(r.requiredQuantity) || 0;
        const stock = mat ? Number(mat.quantity) || 0 : 0;
        const available = mat && stock >= required;
        const stockState = !mat ? "Out of Stock" : stock <= 0 ? "Out of Stock" : available ? "Available" : "Insufficient";
        const cls = stockState === "Available" ? "available" : "out";
        return `<tr>
            <td><strong>${escapeHtml(mat?.materialName || "Missing material")}</strong></td>
            <td>${escapeHtml(mat?.category || "—")}</td>
            <td>${escapeHtml(formatQty(required))}</td>
            <td>${escapeHtml(r.unit || mat?.unit || "—")}</td>
            <td>${escapeHtml(formatQty(stock, mat?.unit || r.unit || ""))}</td>
            <td><span class="status ${cls}">${escapeHtml(stockState)}</span></td>
        </tr>`;
    }).join("") : `<tr><td colspan="6"><div class="empty-state"><span>No raw materials have been assigned to this product yet.</span></div></td></tr>`;

    detail.innerHTML = `<td colspan="5">
        <div class="fp-expanded-panel">
            <div class="fp-expanded-product">
                ${productImageHtml(product, true)}
                <div class="fp-expanded-copy">
                    <h4>${escapeHtml(product.productName)}</h4>
                    <p>${escapeHtml(product.description || "No description provided.")}</p>
                    <div class="fp-meta-line">
                        <span>${escapeHtml(product.category || "Uncategorized")}</span>
                        <span>${escapeHtml(product.unit || "No unit")}</span>
                        <span class="status ${product.status === "Active" ? "available" : "low"}">${escapeHtml(product.status || "Active")}</span>
                    </div>
                </div>
            </div>
            <div class="fp-expanded-materials">
                <div class="fp-expanded-title">
                    <strong>Raw Materials Required</strong>
                    <span>${reqs.length} material${reqs.length === 1 ? "" : "s"}</span>
                </div>
                <div class="table-scroll">
                    <table>
                        <thead><tr><th>Raw Material</th><th>Category</th><th>Required Qty</th><th>Unit</th><th>Current Stock</th><th>Availability</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        </div>
    </td>`;

    const mainRow = fpsTableBody.querySelector(`.fp-main-row[data-id="${CSS.escape(productId)}"]`);
    mainRow?.after(detail);
    trigger?.setAttribute("aria-expanded", "true");
}

function resetImagePicker() {
    selectedImageData = null;
    fpImageFile.value = "";
    fpImagePreview.hidden = true;
    fpImagePreview.innerHTML = "";
}

function renderImagePreview(dataUrl) {
    const safeUrl = sanitizeImageUrl(dataUrl);
    if (!safeUrl) {
        fpImagePreview.hidden = true;
        fpImagePreview.innerHTML = "";
        return;
    }
    fpImagePreview.hidden = false;
    fpImagePreview.innerHTML = `<img src="${safeUrl}" alt="Product image preview">`;
}

function openModal(mode, product) {
    fpModalTitle.textContent = mode === "edit" ? "Edit Finished Product" : "Add Finished Product";
    fpModalSubtitle.textContent = mode === "edit"
        ? "Update the product, image, and required raw materials."
        : "Define a finished product and the raw materials it needs.";

    fpId.value = product?.id || "";
    fpName.value = product?.productName || "";
    fpCategoryNewWrap.hidden = true;
    fpCategoryNew.value = "";
    fpUnit.value = product?.unit || "";
    fpDescription.value = product?.description || "";
    fpStatus.value = product?.status || "Active";
    fpNameError.textContent = "";
    selectedImageData = product?.imageUrl || null;
    fpImageFile.value = "";
    renderImagePreview(selectedImageData);

    renderCategoryOptions();
    fpCategory.value = product?.category && [...fpCategory.options].some(o => o.value === product.category)
        ? product.category : "";

    editingRequirements = product
        ? (requirementsByProduct.get(product.id) || []).map(r => ({
            materialId: r.materialId, requiredQuantity: r.requiredQuantity
        }))
        : [];

    renderRequirementsList();
    fpModalOverlay.classList.add("open");
}

function closeModal() {
    fpModalOverlay.classList.remove("open");
    resetImagePicker();
}

function availableMaterialsFor(rowIndex) {
    const chosen = editingRequirements.map((r, i) => i === rowIndex ? null : r.materialId).filter(Boolean);
    return materials.filter(m => !chosen.includes(m.id));
}

function renderRequirementsList() {
    fpRequirementsEmpty.hidden = editingRequirements.length > 0;
    fpRequirementsList.querySelectorAll(".fps-req-row").forEach(el => el.remove());

    editingRequirements.forEach((req, index) => {
        const row = document.createElement("div");
        row.className = "fps-req-row";
        const options = availableMaterialsFor(index).map(m =>
            `<option value="${escapeHtml(m.id)}" ${m.id === req.materialId ? "selected" : ""}>${escapeHtml(m.materialName)}</option>`
        ).join("");
        const selected = materials.find(m => m.id === req.materialId);

        row.innerHTML = `
            <div class="input-group">
                <label>Raw Material</label>
                <select class="fp-req-material">
                    <option value="">Select material</option>${options}
                </select>
            </div>
            <div class="input-group">
                <label>Required Quantity</label>
                <input type="number" min="0.01" step="any" class="fp-req-qty" value="${escapeHtml(req.requiredQuantity ?? "")}" placeholder="0">
            </div>
            <div class="fps-req-unit">${escapeHtml(selected?.unit || "")}</div>
            <button type="button" class="fps-req-remove" title="Remove material">
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

fpAddRequirementBtn.addEventListener("click", () => {
    if (!materials.length) {
        showToast("Add raw materials in Inventory first.", "warn");
        return;
    }
    editingRequirements.push({ materialId: null, requiredQuantity: "" });
    renderRequirementsList();
});

fpCategory.addEventListener("change", () => {
    fpCategoryNewWrap.hidden = fpCategory.value !== "__new__";
});

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

fpModalSave.addEventListener("click", async () => {
    fpNameError.textContent = "";
    const name = fpName.value.trim();
    if (!name) {
        fpNameError.textContent = "Finished product name is required.";
        return;
    }

    const duplicate = finishedProducts.find(p =>
        String(p.productName || "").trim().toLowerCase() === name.toLowerCase() && p.id !== fpId.value
    );
    if (duplicate) {
        fpNameError.textContent = "A finished product with this name already exists.";
        return;
    }

    const cleanReqs = [];
    const seen = new Set();
    for (const r of editingRequirements) {
        if (!r.materialId) {
            if (r.requiredQuantity) {
                showToast("Select a raw material for every requirement row.", "error");
                return;
            }
            continue;
        }
        const qty = Number(r.requiredQuantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            showToast("Each required raw material needs a quantity greater than 0.", "error");
            return;
        }
        if (seen.has(r.materialId)) {
            showToast("A raw material can only be assigned once to a product.", "error");
            return;
        }
        seen.add(r.materialId);
        const mat = materials.find(m => m.id === r.materialId);
        cleanReqs.push({ materialId: r.materialId, requiredQuantity: qty, unit: mat?.unit || "" });
    }

    const category = fpCategory.value === "__new__" ? fpCategoryNew.value.trim() : fpCategory.value;
    const payload = {
        productName: name,
        category: category || null,
        unit: fpUnit.value.trim() || null,
        description: fpDescription.value.trim() || null,
        imageUrl: selectedImageData || null,
        status: fpStatus.value || "Active"
    };

    fpModalSave.disabled = true;
    try {
        let productId = fpId.value;
        if (productId) {
            await updateDoc(doc(db, "finishedProducts", productId), payload);
        } else {
            productId = (await addDoc(collection(db, "finishedProducts"), payload)).id;
        }

        const existing = requirementsByProduct.get(productId) || [];
        await Promise.all(existing.map(r => deleteDoc(doc(db, "productMaterialRequirements", r.id))));
        await Promise.all(cleanReqs.map(r => addDoc(collection(db, "productMaterialRequirements"), {
            productId, materialId: r.materialId, requiredQuantity: r.requiredQuantity, unit: r.unit
        })));

        showToast(fpId.value ? "Finished product updated." : "Finished product added.");
        closeModal();
        await loadAll();
    } catch (err) {
        console.error(err);
        showToast(err.message || "Could not save the finished product.", "error");
    } finally {
        fpModalSave.disabled = false;
    }
});

fpsTableBody.addEventListener("click", e => {
    const action = e.target.closest("[data-action]");
    if (!action) return;
    const id = action.dataset.id;
    if (action.dataset.action === "toggle") {
        renderExpandedProduct(id, action);
    } else if (action.dataset.action === "edit") {
        const product = finishedProducts.find(p => p.id === id);
        if (product) openModal("edit", product);
    } else if (action.dataset.action === "delete") {
        pendingDeleteId = id;
        fpConfirmModalOverlay.classList.add("open");
    }
});

fpConfirmCancelBtn.addEventListener("click", () => {
    pendingDeleteId = null;
    fpConfirmModalOverlay.classList.remove("open");
});

fpConfirmOkBtn.addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    fpConfirmOkBtn.disabled = true;
    try {
        const reqs = requirementsByProduct.get(pendingDeleteId) || [];
        await Promise.all(reqs.map(r => deleteDoc(doc(db, "productMaterialRequirements", r.id))));
        await deleteDoc(doc(db, "finishedProducts", pendingDeleteId));
        showToast("Finished product removed.");
        fpConfirmModalOverlay.classList.remove("open");
        pendingDeleteId = null;
        await loadAll();
    } catch (err) {
        console.error(err);
        showToast(err.message || "Could not remove this product.", "error");
    } finally {
        fpConfirmOkBtn.disabled = false;
    }
});

fpModalClose.addEventListener("click", closeModal);
fpModalCancel.addEventListener("click", closeModal);
fpModalOverlay.addEventListener("click", e => { if (e.target === fpModalOverlay) closeModal(); });
addProductBtn.addEventListener("click", () => openModal("add", null));

fpsToggle.addEventListener("click", () => {
    const expanded = fpsToggle.getAttribute("aria-expanded") === "true";
    fpsToggle.setAttribute("aria-expanded", String(!expanded));
    fpsBody.hidden = expanded;
    if (!expanded) loadAll();
});

/* ==========================================================
   BULK IMPORT
   ========================================================== */

function resetImportState() {
    importDataRows = [];
    importImages = [];
    importImageMap = new Map();
    fpImportDataFile.value = "";
    fpImportImagesFiles.value = "";
    fpImportDataName.textContent = "No data file selected.";
    fpImportImagesName.textContent = "No images selected.";
    fpImportImageMatches.innerHTML = "";
    fpImportPreviewSection.hidden = true;
    fpImportSummary.innerHTML = "";
    fpImportWarnings.innerHTML = "";
    fpImportPreviewBody.innerHTML = "";
    fpImportConfirmBtn.disabled = true;
    setImportGuideStep(1);
}

function openImportModal() {
    resetImportState();
    fpImportModalOverlay.classList.add("open");
}

function closeImportModal() {
    fpImportModalOverlay.classList.remove("open");
}

fpsImportBtn.addEventListener("click", openImportModal);
fpImportModalClose.addEventListener("click", closeImportModal);
fpImportCancelBtn.addEventListener("click", closeImportModal);
fpImportModalOverlay.addEventListener("click", e => {
    if (e.target === fpImportModalOverlay) closeImportModal();
});
fpChooseDataBtn.addEventListener("click", () => fpImportDataFile.click());
fpChooseImagesBtn.addEventListener("click", () => fpImportImagesFiles.click());

fpImportDataFile.addEventListener("change", async () => {
    const file = fpImportDataFile.files?.[0];
    if (!file) return;
    fpImportDataName.textContent = file.name;
    try {
        importDataRows = await parseImportFile(file);
        showToast(`${importDataRows.length} data row${importDataRows.length === 1 ? "" : "s"} loaded.`, "success");
        setImportGuideStep(2);
    } catch (err) {
        importDataRows = [];
        showToast(err.message || "Could not read the import file.", "error");
    }
});

fpImportImagesFiles.addEventListener("change", async () => {
    importImages = [...(fpImportImagesFiles.files || [])];
    fpImportImagesName.textContent = `${importImages.length} image${importImages.length === 1 ? "" : "s"} selected.`;
    importImageMap = new Map();
    for (const file of importImages) {
        try {
            importImageMap.set(normalizeName(fileNameWithoutExtension(file.name)), await compressImage(file));
        } catch (err) {
            console.warn("Image skipped:", file.name, err);
        }
    }
    renderImageMatchPreview();
    setImportGuideStep(3);
});

async function parseImportFile(file) {
    if (typeof XLSX === "undefined") throw new Error("Spreadsheet importer is unavailable.");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows.length) throw new Error("The import file is empty.");

    const normalized = rows.map(row => {
        const out = {};
        Object.entries(row).forEach(([k, v]) => {
            out[normalizeHeader(k)] = v;
        });
        return out;
    });

    const required = ["finished product", "raw material"];
    const headers = Object.keys(normalized[0] || {});
    for (const key of required) {
        if (!headers.includes(key)) {
            throw new Error(`Missing required column: ${key}`);
        }
    }
    return normalized;
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
        const qty = Number(value(row, "required quantity", "quantity", "required qty"));
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
    if (!groups.length || !importImageMap.size) {
        fpImportImageMatches.innerHTML = "";
        return;
    }
    const html = groups.map(g => {
        const img = sanitizeImageUrl(importImageMap.get(normalizeName(g.productName)));
        return `<div class="fp-import-match ${img ? "matched" : "unmatched"}">
            ${img ? `<img src="${img}" alt="${escapeHtml(g.productName)}">` : `<div class="fp-product-avatar fp-product-avatar-small" aria-label="Product avatar"><span>${escapeHtml(productInitials(g.productName))}</span></div>`}
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
    const imageKeys = new Set();

    groups.forEach(g => {
        const image = importImageMap.get(normalizeName(g.productName));
        if (image) {
            matchedImages++;
            imageKeys.add(normalizeName(g.productName));
        }

        const seen = new Set();
        g.materials.forEach(m => {
            materialEntries++;
            if (!Number.isFinite(m.quantity) || m.quantity <= 0) warnings.push(`${g.productName}: invalid required quantity for ${m.name}.`);
            const existing = inventoryMatch(m.name);
            if (!existing) missingMaterials++;
            const k = normalizeName(m.name);
            if (seen.has(k)) warnings.push(`${g.productName}: ${m.name} is listed more than once.`);
            seen.add(k);
        });
    });

    for (const key of importImageMap.keys()) {
        if (!groups.some(g => normalizeName(g.productName) === key)) unmatchedImages++;
    }

    if (unmatchedImages) warnings.push(`${unmatchedImages} uploaded image${unmatchedImages === 1 ? "" : "s"} do not match a finished product name. They will not create records.`);
    if (missingMaterials) warnings.push(`${missingMaterials} raw-material reference${missingMaterials === 1 ? "" : "s"} do not exist in Inventory. They will be added as new Inventory materials with zero current stock after confirmation.`);
    if (!groups.length) warnings.push("No valid finished-product rows were found.");
    return { groups, warnings, materialEntries, missingMaterials, matchedImages, unmatchedImages };
}

fpImportPreviewBtn.addEventListener("click", () => {
    setImportGuideStep(3);
    const preview = buildImportPreview();
    if (!preview.groups.length) {
        fpImportConfirmBtn.disabled = true;
        fpImportPreviewSection.hidden = false;
        fpImportSummary.innerHTML = `<div class="fp-import-stat error"><strong>0</strong><span>finished products</span></div>`;
        fpImportWarnings.innerHTML = `<div class="field-error">${escapeHtml(preview.warnings[0] || "No valid data found.")}</div>`;
        return;
    }

    fpImportPreviewSection.hidden = false;
    fpImportConfirmBtn.disabled = preview.warnings.some(w => /invalid required quantity/i.test(w));
    fpImportSummary.innerHTML = `
        <div class="fp-import-stat"><strong>${preview.groups.length}</strong><span>finished products</span></div>
        <div class="fp-import-stat"><strong>${preview.materialEntries}</strong><span>raw-material entries</span></div>
        <div class="fp-import-stat"><strong>${preview.matchedImages}</strong><span>images matched</span></div>
        <div class="fp-import-stat"><strong>${preview.missingMaterials}</strong><span>materials to add</span></div>`;

    fpImportWarnings.innerHTML = preview.warnings.length
        ? preview.warnings.map(w => `<div class="fp-import-warning">⚠ ${escapeHtml(w)}</div>`).join("")
        : `<div class="fp-import-success">✓ No validation issues found.</div>`;

    fpImportPreviewBody.innerHTML = preview.groups.flatMap(g => g.materials.map(m => {
        const existing = inventoryMatch(m.name);
        const image = sanitizeImageUrl(importImageMap.get(normalizeName(g.productName)));
        return `<tr>
            <td>${image ? `<img class="fp-import-mini-image" src="${image}" alt="${escapeHtml(g.productName)}">` : `<span class="fp-product-avatar fp-product-avatar-mini" aria-label="Product avatar"><span>${escapeHtml(productInitials(g.productName))}</span></span>`}</td>
            <td><strong>${escapeHtml(g.productName)}</strong></td>
            <td>${escapeHtml(g.category || "—")}</td>
            <td>${escapeHtml(m.name)}</td>
            <td>${escapeHtml(formatQty(m.quantity, m.unit))}</td>
            <td>${existing ? `<span class="status available">Link existing</span>` : `<span class="status low">Add to Inventory</span>`}</td>
        </tr>`;
    })).join("");
    renderImageMatchPreview();
    setImportGuideStep(4);
});

fpImportConfirmBtn.addEventListener("click", async () => {
    const preview = buildImportPreview();
    if (!preview.groups.length || preview.warnings.some(w => /invalid required quantity/i.test(w))) return;

    fpImportConfirmBtn.disabled = true;
    try {
        // 1. Create missing inventory materials first.
        const materialByName = new Map(materials.map(m => [normalizeName(m.materialName), m]));
        for (const g of preview.groups) {
            for (const m of g.materials) {
                const key = normalizeName(m.name);
                if (materialByName.has(key)) continue;

                const created = await addDoc(collection(db, "materials"), {
                    materialName: m.name,
                    category: m.category || "Uncategorized",
                    unit: m.unit || "pcs",
                    quantity: 0,
                    minimumThreshold: Math.max(0, m.minimum),
                    supplier: m.supplier || null,
                    storageLocation: m.storageLocation || null,
                    notes: m.notes || null,
                    status: "Available"
                });
                materialByName.set(key, {
                    id: created.id,
                    materialName: m.name,
                    category: m.category || "Uncategorized",
                    unit: m.unit || "pcs",
                    quantity: 0,
                    minimumThreshold: Math.max(0, m.minimum),
                    status: "Available"
                });
            }
        }

        // 2. Upsert finished products by name (case-insensitive).
        for (const g of preview.groups) {
            const existing = finishedProducts.find(p => normalizeName(p.productName) === normalizeName(g.productName));
            const image = importImageMap.get(normalizeName(g.productName));
            const payload = {
                productName: g.productName,
                category: g.category || null,
                unit: g.unit || null,
                description: g.description || null,
                status: g.status === "Inactive" ? "Inactive" : "Active",
                imageUrl: image || existing?.imageUrl || null
            };

            let productId;
            if (existing) {
                await updateDoc(doc(db, "finishedProducts", existing.id), payload);
                productId = existing.id;
                const oldReqs = requirementsByProduct.get(productId) || [];
                await Promise.all(oldReqs.map(r => deleteDoc(doc(db, "productMaterialRequirements", r.id))));
            } else {
                productId = (await addDoc(collection(db, "finishedProducts"), payload)).id;
            }

            const seen = new Set();
            for (const m of g.materials) {
                const mat = materialByName.get(normalizeName(m.name));
                if (!mat || seen.has(mat.id)) continue;
                seen.add(mat.id);
                await addDoc(collection(db, "productMaterialRequirements"), {
                    productId,
                    materialId: mat.id,
                    requiredQuantity: m.quantity,
                    unit: mat.unit || m.unit || ""
                });
            }
        }

        showToast(`Imported ${preview.groups.length} finished product${preview.groups.length === 1 ? "" : "s"} successfully.`);
        closeImportModal();
        await loadAll();
        // Inventory table refresh is handled by the main inventory page listener/refresh.
        window.dispatchEvent(new CustomEvent("rmims:inventory-changed"));
    } catch (err) {
        console.error(err);
        showToast(err.message || "Import failed. No further records were processed.", "error");
    } finally {
        fpImportConfirmBtn.disabled = false;
    }
});

onAuthStateChanged(auth, async user => {
    if (!user) {
        window.location.href = "../login.html";
        return;
    }
    loadAll();
});
