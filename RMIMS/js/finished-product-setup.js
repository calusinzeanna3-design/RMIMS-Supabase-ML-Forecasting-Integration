/**
 * RMIMS ADMIN INVENTORY — OTHER DETAILS ONLY
 * Finished Product Context + Multi-File / Multi-Image Import & Validation
 */

import { supabase } from "../supabase/supabase-config.js";

// State
let rawMaterials = [];
let finishedProducts = [];
let filteredProducts = [];
let currentPage = 1;
let pageSize = 20;
let selectedProductIds = new Set();
let editingProductId = null;

// Import Wizard State
let importFiles = [];
let importImages = []; // Array of { file, name, dataUrl }
let parsedImportBatch = [];
let importSummary = {
    readyToSave: 0,
    duplicates: 0,
    invalid: 0,
    unknownMaterials: 0,
    ignoredFieldsCount: 0,
    ignoredFieldsList: [],
    matchedImages: 0,
    unmatchedImages: 0
};

// DOM Elements
const fpcCardsContainer = document.getElementById("fpcCardsContainer");
const fpcSearchInput = document.getElementById("fpcSearchInput");
const fpcSortSelect = document.getElementById("fpcSortSelect");
const fpcPageSizeSelect = document.getElementById("fpcPageSizeSelect");
const fpcResultCount = document.getElementById("fpcResultCount");
const fpcPaginationBtns = document.getElementById("fpcPaginationBtns");

// Add Modal Elements
const fpcAddProductBtn = document.getElementById("fpcAddProductBtn");
const fpcAddModalOverlay = document.getElementById("fpcAddModalOverlay");
const fpcAddModalClose = document.getElementById("fpcAddModalClose");
const fpcAddModalCancel = document.getElementById("fpcAddModalCancel");
const fpcAddModalSave = document.getElementById("fpcAddModalSave");
const fpcNameInput = document.getElementById("fpcNameInput");
const fpcNameError = document.getElementById("fpcNameError");
const fpcImageInput = document.getElementById("fpcImageInput");
const fpcImagePreviewWrap = document.getElementById("fpcImagePreviewWrap");
const fpcImagePreview = document.getElementById("fpcImagePreview");
const fpcRemoveImageBtn = document.getElementById("fpcRemoveImageBtn");
const fpcMatSearchInput = document.getElementById("fpcMatSearchInput");
const fpcMatMultiList = document.getElementById("fpcMatMultiList");
const fpcSelectedMatsCount = document.getElementById("fpcSelectedMatsCount");
const fpcMatError = document.getElementById("fpcMatError");

// View Details Modal Elements
const fpcDetailsModalOverlay = document.getElementById("fpcDetailsModalOverlay");
const fpcDetailsModalClose = document.getElementById("fpcDetailsModalClose");
const fpcDetailsCloseBtn = document.getElementById("fpcDetailsCloseBtn");
const fpcDetailsName = document.getElementById("fpcDetailsName");
const fpcDetailsMatCount = document.getElementById("fpcDetailsMatCount");
const fpcDetailsAvatarWrap = document.getElementById("fpcDetailsAvatarWrap");
const fpcDetailsTableBody = document.getElementById("fpcDetailsTableBody");

// Import Modal Elements
const fpcImportBtn = document.getElementById("fpcImportBtn");
const fpcImportModalOverlay = document.getElementById("fpcImportModalOverlay");
const fpcImportModalClose = document.getElementById("fpcImportModalClose");
const fpcImportCancelBtn = document.getElementById("fpcImportCancelBtn");
const fpcImportNextStepBtn = document.getElementById("fpcImportNextStepBtn");
const fpcImportBackBtn = document.getElementById("fpcImportBackBtn");
const fpcImportSaveBtn = document.getElementById("fpcImportSaveBtn");
const fpcImportDoneBtn = document.getElementById("fpcImportDoneBtn");

const fpcStepIndicator1 = document.getElementById("fpcStepIndicator1");
const fpcStepIndicator2 = document.getElementById("fpcStepIndicator2");
const fpcStepIndicator3 = document.getElementById("fpcStepIndicator3");

const fpcImportStep1View = document.getElementById("fpcImportStep1View");
const fpcImportStep2View = document.getElementById("fpcImportStep2View");
const fpcImportStep3View = document.getElementById("fpcImportStep3View");

const fpcSpreadsheetDropzone = document.getElementById("fpcSpreadsheetDropzone");
const fpcSpreadsheetInput = document.getElementById("fpcSpreadsheetInput");
const fpcSpreadsheetFilesList = document.getElementById("fpcSpreadsheetFilesList");

const fpcImagesDropzone = document.getElementById("fpcImagesDropzone");
const fpcImagesInput = document.getElementById("fpcImagesInput");
const fpcImagesFilesList = document.getElementById("fpcImagesFilesList");

const fpcFieldDetectionBox = document.getElementById("fpcFieldDetectionBox");
const fpcValidationSummaryBar = document.getElementById("fpcValidationSummaryBar");
const fpcImportPreviewTableBody = document.getElementById("fpcImportPreviewTableBody");
const fpcImportResultCard = document.getElementById("fpcImportResultCard");

// Local Storage Key
const STORAGE_KEY = "rmims_finished_product_context";

/* ==========================================================
   INITIALIZATION & DATA LOADING
   ========================================================== */

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        initEvents();
        loadData();
    });
} else {
    initEvents();
    loadData();
}

function isGenericOperationalName(name) {
    if (!name) return true;
    const n = String(name).trim().toLowerCase();
    return (
        n === "operational use" ||
        n === "operational" ||
        n === "general usage" ||
        n === "general" ||
        n === "usage" ||
        n === "operational material context" ||
        n === "operational batch" ||
        n === "general production" ||
        n === "production" ||
        n === "sample usage"
    );
}

async function loadData() {
    try {
        // 1. Fetch live raw materials catalog
        const { data: mats, error: matErr } = await supabase
            .from("raw_materials")
            .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, description")
            .order("name");

        if (matErr) throw matErr;

        rawMaterials = (mats || []).map(m => ({
            id: m.id,
            itemCode: m.item_code || "",
            name: m.name || "",
            unit: m.unit_of_measure || "kg",
            currentStock: Number(m.current_stock) || 0,
            minimumStock: m.minimum_threshold !== null ? Number(m.minimum_threshold) : 0,
            status: computeStockStatus(Number(m.current_stock) || 0, m.minimum_threshold)
        }));

        // 2. Fetch disbursement records to discover any historic product contexts
        const { data: disbs } = await supabase
            .from("material_disbursements")
            .select("finished_product_name, material_id")
            .order("created_at", { ascending: false });

        // 3. Load saved context from LocalStorage (filtering out any generic operational labels)
        let savedContext = [];
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) savedContext = JSON.parse(raw);
        } catch (e) {
            console.warn("Notice loading local finished product context:", e);
        }

        // Map of productName -> { id, name, imageUrl, materialIds: Set, createdAt }
        const productMap = new Map();

        // Populate from saved context (strictly excluding generic operational names)
        if (Array.isArray(savedContext)) {
            savedContext.forEach(p => {
                if (!p || !p.name || isGenericOperationalName(p.name)) return;
                const norm = p.name.trim();
                productMap.set(norm.toLowerCase(), {
                    id: p.id || "fp_" + Math.random().toString(36).substr(2, 9),
                    name: norm,
                    imageUrl: p.imageUrl || null,
                    materialIds: new Set(p.materialIds || []),
                    createdAt: p.createdAt || new Date().toISOString()
                });
            });
        }

        // Populate / augment from historic disbursements (strictly excluding generic operational names)
        if (Array.isArray(disbs)) {
            disbs.forEach(d => {
                const prodName = d.finished_product_name ? d.finished_product_name.trim() : "";
                if (!prodName || isGenericOperationalName(prodName)) return;
                const key = prodName.toLowerCase();
                if (!productMap.has(key)) {
                    productMap.set(key, {
                        id: "fp_" + Math.random().toString(36).substr(2, 9),
                        name: prodName,
                        imageUrl: null,
                        materialIds: new Set(),
                        createdAt: new Date().toISOString()
                    });
                }
                if (d.material_id) {
                    productMap.get(key).materialIds.add(d.material_id);
                }
            });
        }

        // Convert map to finished products array
        finishedProducts = Array.from(productMap.values()).map(p => ({
            id: p.id,
            name: p.name,
            imageUrl: p.imageUrl,
            materialIds: Array.from(p.materialIds),
            createdAt: p.createdAt
        }));

        saveContextToStorage();
        applyFiltersAndRender();

    } catch (err) {
        console.error("Failed to load Finished Product Context data:", err);
        if (fpcCardsContainer) {
            fpcCardsContainer.innerHTML = `
                <div class="fpc-empty-state">
                    <h4>Unable to load context</h4>
                    <p>Please refresh the page to retry.</p>
                </div>`;
        }
    }
}

function saveContextToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(finishedProducts));
    } catch (e) {
        console.warn("Could not save to LocalStorage:", e);
    }
}

/* ==========================================================
   STOCK STATUS COMPUTATION
   ========================================================== */

function computeStockStatus(currentStock, minThreshold) {
    if (currentStock <= 0) return { label: "Out of Stock", cls: "status-badge-outofstock", dot: "dot-red" };
    if (minThreshold !== null && currentStock <= Number(minThreshold)) {
        return { label: "Low Stock", cls: "status-badge-lowstock", dot: "dot-orange" };
    }
    return { label: "In Stock", cls: "status-badge-instock", dot: "dot-green" };
}

/* ==========================================================
   FILTERING, SORTING & RENDERING CARDS
   ========================================================== */

function applyFiltersAndRender() {
    const query = (fpcSearchInput ? fpcSearchInput.value : "").trim().toLowerCase();
    const sort = fpcSortSelect ? fpcSortSelect.value : "latest";

    // 1. Filter
    filteredProducts = finishedProducts.filter(p => {
        if (!query) return true;
        // Match product name
        if (p.name.toLowerCase().includes(query)) return true;
        // Match linked material names or item codes
        const mats = p.materialIds.map(id => rawMaterials.find(m => m.id === id)).filter(Boolean);
        return mats.some(m => m.name.toLowerCase().includes(query) || m.itemCode.toLowerCase().includes(query));
    });

    // 2. Sort
    filteredProducts.sort((a, b) => {
        if (sort === "az") return a.name.localeCompare(b.name);
        if (sort === "za") return b.name.localeCompare(a.name);
        if (sort === "oldest") return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); // latest
    });

    // 3. Paginate
    const total = filteredProducts.length;
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage > maxPage) currentPage = maxPage;

    const start = (currentPage - 1) * pageSize;
    const paged = filteredProducts.slice(start, start + pageSize);

    // 4. Render
    renderProductCards(paged);
    renderPagination(total, maxPage);
}

function updateFpcSelectionBar() {
    const bar = document.getElementById("fpcSelectionBar");
    const countEl = document.getElementById("fpcSelectedCount");
    if (!bar) return;

    const count = selectedProductIds.size;
    if (count > 0) {
        bar.hidden = false;
        if (countEl) countEl.textContent = `${count} Selected`;
    } else {
        bar.hidden = true;
    }
}

function renderProductCards(products) {
    if (!fpcCardsContainer) return;

    if (!products.length) {
        fpcCardsContainer.innerHTML = `
            <div class="fpc-empty-state">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15M9 5C9 6.10457 9.89543 7 11 7H13C14.1046 7 15 6.10457 15 5M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5M9 12H15M9 16H13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                <h4>No Finished Product Context Found</h4>
                <p>Click <strong>"+ Add Finished Product"</strong> or <strong>"Import"</strong> to identify raw materials associated with your finished products.</p>
            </div>`;
        updateFpcSelectionBar();
        return;
    }

    fpcCardsContainer.innerHTML = products.map(p => {
        const isSelected = selectedProductIds.has(p.id);
        const matCount = p.materialIds.length;
        const matNames = p.materialIds
            .map(id => {
                const m = rawMaterials.find(rm => rm.id === id);
                return m ? m.name : null;
            })
            .filter(Boolean)
            .join(" · ") || "No raw materials linked";

        const avatarHtml = p.imageUrl
            ? `<div class="fpc-avatar"><img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" class="fpc-avatar-img"></div>`
            : `<div class="fpc-avatar"><span>${escapeHtml(getInitials(p.name))}</span></div>`;

        return `
            <div class="fpc-card ${isSelected ? "card-selected" : ""}" data-id="${escapeHtml(p.id)}">
                <div class="fpc-card-select-circle" data-id="${escapeHtml(p.id)}" title="Select finished product">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div>
                    <div class="fpc-card-top">
                        ${avatarHtml}
                        <div class="fpc-card-meta">
                            <h4 class="fpc-card-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h4>
                            <span class="fpc-mat-count-badge">${matCount} Raw Material${matCount === 1 ? "" : "s"}</span>
                        </div>
                    </div>
                    <div class="fpc-card-materials" title="${escapeHtml(matNames)}">
                        ${escapeHtml(matNames)}
                    </div>
                </div>
                <div class="fpc-card-footer">
                    <div class="fpc-card-direct-actions">
                        <button type="button" class="fpc-action-icon-btn btn-edit-prod" data-id="${escapeHtml(p.id)}" title="Edit / Update">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4C3.44772 4 3 4.44772 3 5V20C3 20.5523 3.44772 21 4 21H19C19.5523 21 20 20.5523 20 20V13M18.5 2.5C19.3284 1.67157 20.6716 1.67157 21.5 2.5C22.3284 3.32843 22.3284 4.67157 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z"/></svg>
                        </button>
                        <button type="button" class="fpc-action-icon-btn btn-delete-prod" data-id="${escapeHtml(p.id)}" title="Delete Finished Product">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                    <button type="button" class="btn-view-details" data-id="${escapeHtml(p.id)}">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 14px; height: 14px;"><path d="M15 12A3 3 0 1 1 9 12A3 3 0 0 1 15 12Z" stroke="currentColor" stroke-width="2"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5C16.478 5 20.268 7.943 21.542 12C20.268 16.057 16.478 19 12 19C7.523 19 3.732 16.057 2.458 12Z" stroke="currentColor" stroke-width="2"/></svg>
                        View Details
                    </button>
                </div>
            </div>`;
    }).join("");

    attachFpcCardListeners();
    updateFpcSelectionBar();
}

function attachFpcCardListeners() {
    // Circle Selection & Card Toggle
    fpcCardsContainer.querySelectorAll(".fpc-card").forEach(card => {
        const id = card.getAttribute("data-id");
        const circle = card.querySelector(".fpc-card-select-circle");

        const toggleSelection = (e) => {
            if (e.target.closest(".btn-view-details") || e.target.closest(".fpc-action-icon-btn")) return;
            if (selectedProductIds.has(id)) {
                selectedProductIds.delete(id);
                card.classList.remove("card-selected");
            } else {
                selectedProductIds.add(id);
                card.classList.add("card-selected");
            }
            updateFpcSelectionBar();
        };

        if (circle) circle.addEventListener("click", toggleSelection);
        card.addEventListener("click", toggleSelection);
    });

    // View Details button
    fpcCardsContainer.querySelectorAll(".btn-view-details").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            const prod = finishedProducts.find(p => p.id === id);
            if (prod) openDetailsModal(prod);
        });
    });

    // Direct Edit Button
    fpcCardsContainer.querySelectorAll(".btn-edit-prod").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            const prod = finishedProducts.find(p => p.id === id);
            if (prod) openEditProductModal(prod);
        });
    });

    // Direct Delete Button
    fpcCardsContainer.querySelectorAll(".btn-delete-prod").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            const prod = finishedProducts.find(p => p.id === id);
            if (!prod) return;
            const conf = confirm(`Are you sure you want to delete finished product "${prod.name}"?`);
            if (!conf) return;

            finishedProducts = finishedProducts.filter(p => p.id !== id);
            selectedProductIds.delete(id);
            saveContextToStorage();
            applyFiltersAndRender();
            showToast(`Deleted finished product "${prod.name}"`, "success");
        });
    });

    // Bulk Select All
    const selectAllBtn = document.getElementById("fpcBulkSelectAllBtn");
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            filteredProducts.forEach(p => selectedProductIds.add(p.id));
            renderProductCards(filteredProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize));
        };
    }

    // Bulk Deselect All
    const deselectBtn = document.getElementById("fpcBulkDeselectBtn");
    if (deselectBtn) {
        deselectBtn.onclick = () => {
            selectedProductIds.clear();
            renderProductCards(filteredProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize));
        };
    }

    // Bulk Edit
    const bulkEditBtn = document.getElementById("fpcBulkEditBtn");
    if (bulkEditBtn) {
        bulkEditBtn.onclick = () => {
            if (selectedProductIds.size === 0) return;
            const firstId = Array.from(selectedProductIds)[0];
            const prod = finishedProducts.find(p => p.id === firstId);
            if (prod) openEditProductModal(prod);
        };
    }

    // Bulk Delete
    const bulkDeleteBtn = document.getElementById("fpcBulkDeleteBtn");
    if (bulkDeleteBtn) {
        bulkDeleteBtn.onclick = () => {
            const count = selectedProductIds.size;
            if (count === 0) return;
            const conf = confirm(`Are you sure you want to delete ${count} selected finished product(s)?`);
            if (!conf) return;

            finishedProducts = finishedProducts.filter(p => !selectedProductIds.has(p.id));
            selectedProductIds.clear();
            saveContextToStorage();
            applyFiltersAndRender();
            showToast(`Successfully deleted ${count} finished product(s)`, "success");
        };
    }
}

function renderPagination(total, maxPage) {
    if (fpcResultCount) {
        const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
        const end = Math.min(total, currentPage * pageSize);
        fpcResultCount.textContent = `Showing ${start}–${end} of ${total} finished product${total === 1 ? "" : "s"}`;
    }

    if (!fpcPaginationBtns) return;
    if (maxPage <= 1) {
        fpcPaginationBtns.innerHTML = "";
        return;
    }

    let btns = `<button type="button" class="inv-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>‹ Prev</button>`;
    for (let p = 1; p <= maxPage; p++) {
        btns += `<button type="button" class="inv-page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
    }
    btns += `<button type="button" class="inv-page-btn" data-page="${currentPage + 1}" ${currentPage === maxPage ? "disabled" : ""}>Next ›</button>`;

    fpcPaginationBtns.innerHTML = btns;
    fpcPaginationBtns.querySelectorAll(".inv-page-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetPage = Number(btn.getAttribute("data-page"));
            if (targetPage >= 1 && targetPage <= maxPage && targetPage !== currentPage) {
                currentPage = targetPage;
                applyFiltersAndRender();
            }
        });
    });
}

/* ==========================================================
   VIEW DETAILS MODAL
   ========================================================== */

function openDetailsModal(product) {
    if (!fpcDetailsModalOverlay) return;

    if (fpcDetailsName) fpcDetailsName.textContent = product.name;
    if (fpcDetailsMatCount) {
        const c = product.materialIds.length;
        fpcDetailsMatCount.textContent = `${c} Associated Raw Material${c === 1 ? "" : "s"}`;
    }

    if (fpcDetailsAvatarWrap) {
        fpcDetailsAvatarWrap.innerHTML = product.imageUrl
            ? `<div class="fpc-avatar"><img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" class="fpc-avatar-img"></div>`
            : `<div class="fpc-avatar"><span>${escapeHtml(getInitials(product.name))}</span></div>`;
    }

    if (fpcDetailsTableBody) {
        const rows = product.materialIds.map(id => {
            const mat = rawMaterials.find(m => m.id === id);
            if (!mat) {
                return `
                    <tr>
                        <td><strong>Unknown Material</strong></td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td><span class="status-badge status-badge-outofstock">Unmapped</span></td>
                    </tr>`;
            }

            return `
                <tr>
                    <td><strong>${escapeHtml(mat.name)}</strong></td>
                    <td><span class="mat-id-badge">${escapeHtml(mat.itemCode || "—")}</span></td>
                    <td><strong>${mat.currentStock.toLocaleString()}</strong></td>
                    <td>${mat.minimumStock.toLocaleString()}</td>
                    <td>${escapeHtml(mat.unit)}</td>
                    <td><span class="status-badge ${mat.status.cls}"><span class="badge-dot ${mat.status.dot}"></span>${mat.status.label}</span></td>
                </tr>`;
        }).join("");

        fpcDetailsTableBody.innerHTML = rows || `<tr><td colspan="6" style="text-align: center; color: var(--rm-ink-dim); padding: 20px;">No materials linked to this product.</td></tr>`;
    }

    fpcDetailsModalOverlay.classList.add("open", "active");
}

function closeDetailsModal() {
    if (fpcDetailsModalOverlay) fpcDetailsModalOverlay.classList.remove("open", "active");
}

/* ==========================================================
   ADD FINISHED PRODUCT MODAL
   ========================================================== */

let selectedMaterialIds = new Set();
let addProductImageBase64 = null;

function openAddModal() {
    if (!fpcAddModalOverlay) return;
    editingProductId = null;

    const modalTitle = fpcAddModalOverlay.querySelector("h3");
    if (modalTitle) modalTitle.textContent = "Add Finished Product Context";

    // Reset fields
    if (fpcNameInput) fpcNameInput.value = "";
    if (fpcNameError) fpcNameError.textContent = "";
    if (fpcMatError) fpcMatError.textContent = "";
    if (fpcImageInput) fpcImageInput.value = "";
    if (fpcImagePreviewWrap) fpcImagePreviewWrap.hidden = true;
    if (fpcImagePreview) fpcImagePreview.src = "";
    addProductImageBase64 = null;
    selectedMaterialIds.clear();

    renderMaterialChecklist();
    fpcAddModalOverlay.classList.add("open", "active");
    if (fpcNameInput) fpcNameInput.focus();
}

function openEditProductModal(product) {
    if (!fpcAddModalOverlay || !product) return;
    editingProductId = product.id;

    const modalTitle = fpcAddModalOverlay.querySelector("h3");
    if (modalTitle) modalTitle.textContent = "Edit Finished Product Context";

    if (fpcNameInput) fpcNameInput.value = product.name;
    if (fpcNameError) fpcNameError.textContent = "";
    if (fpcMatError) fpcMatError.textContent = "";

    if (fpcImageInput) fpcImageInput.value = "";
    if (product.imageUrl) {
        if (fpcImagePreviewWrap) fpcImagePreviewWrap.hidden = false;
        if (fpcImagePreview) fpcImagePreview.src = product.imageUrl;
        addProductImageBase64 = product.imageUrl;
    } else {
        if (fpcImagePreviewWrap) fpcImagePreviewWrap.hidden = true;
        if (fpcImagePreview) fpcImagePreview.src = "";
        addProductImageBase64 = null;
    }

    selectedMaterialIds = new Set(product.materialIds || []);
    renderMaterialChecklist();
    fpcAddModalOverlay.classList.add("open", "active");
    if (fpcNameInput) fpcNameInput.focus();
}

function closeAddModal() {
    editingProductId = null;
    if (fpcAddModalOverlay) fpcAddModalOverlay.classList.remove("open", "active");
}

function renderMaterialChecklist(searchQuery = "") {
    if (!fpcMatMultiList) return;

    const query = searchQuery.trim().toLowerCase();
    const filtered = rawMaterials.filter(m => {
        if (!query) return true;
        return m.name.toLowerCase().includes(query) || m.itemCode.toLowerCase().includes(query);
    });

    if (!filtered.length) {
        fpcMatMultiList.innerHTML = `<div style="padding: 16px; text-align: center; font-size: 0.8rem; color: var(--rm-ink-dim);">No matching raw materials found in catalog.</div>`;
        return;
    }

    fpcMatMultiList.innerHTML = filtered.map(m => {
        const isChecked = selectedMaterialIds.has(m.id);
        return `
            <div class="fpc-mat-item ${isChecked ? "selected" : ""}" data-id="${escapeHtml(m.id)}">
                <div class="fpc-mat-item-left">
                    <input type="checkbox" id="chk_mat_${escapeHtml(m.id)}" ${isChecked ? "checked" : ""}>
                    <label for="chk_mat_${escapeHtml(m.id)}" style="cursor: pointer;">
                        <span class="fpc-mat-name">${escapeHtml(m.name)}</span>
                        <span class="fpc-mat-code">${escapeHtml(m.itemCode)}</span>
                    </label>
                </div>
                <div class="fpc-mat-metrics">
                    <span class="fpc-mat-stock">Stock: <strong>${m.currentStock.toLocaleString()}</strong> ${escapeHtml(m.unit)}</span>
                    <span class="status-badge ${m.status.cls}" style="font-size: 0.7rem; padding: 2px 6px;">${m.status.label}</span>
                </div>
            </div>`;
    }).join("");

    // Attach click toggle handlers
    fpcMatMultiList.querySelectorAll(".fpc-mat-item").forEach(item => {
        const id = item.getAttribute("data-id");
        const checkbox = item.querySelector('input[type="checkbox"]');

        const toggleItem = (checked) => {
            if (checked) {
                selectedMaterialIds.add(id);
                item.classList.add("selected");
            } else {
                selectedMaterialIds.delete(id);
                item.classList.remove("selected");
            }
            if (checkbox) checkbox.checked = checked;
            updateSelectedMaterialsCount();
        };

        item.addEventListener("click", (e) => {
            if (e.target.tagName !== "INPUT" && e.target.tagName !== "LABEL") {
                const next = !selectedMaterialIds.has(id);
                toggleItem(next);
            }
        });

        if (checkbox) {
            checkbox.addEventListener("change", () => {
                toggleItem(checkbox.checked);
            });
        }
    });

    updateSelectedMaterialsCount();
}

function updateSelectedMaterialsCount() {
    if (fpcSelectedMatsCount) {
        fpcSelectedMatsCount.textContent = `${selectedMaterialIds.size} selected`;
    }
}

function handleSaveProduct() {
    if (!fpcNameInput) return;

    const rawName = fpcNameInput.value.trim();
    if (!rawName) {
        if (fpcNameError) fpcNameError.textContent = "Finished product name is required.";
        fpcNameInput.focus();
        return;
    }

    if (isGenericOperationalName(rawName)) {
        if (fpcNameError) fpcNameError.textContent = "Please enter a specific finished product name (e.g. Pandesal, Banana Chips).";
        fpcNameInput.focus();
        return;
    }

    // Normalized duplicate check
    const normalized = rawName.toLowerCase();
    const duplicate = finishedProducts.find(p => p.name.toLowerCase() === normalized && p.id !== editingProductId);
    if (duplicate) {
        if (fpcNameError) fpcNameError.textContent = "Finished product already exists.";
        fpcNameInput.focus();
        return;
    }

    if (selectedMaterialIds.size === 0) {
        if (fpcMatError) fpcMatError.textContent = "Select at least one associated raw material.";
        return;
    }

    if (editingProductId) {
        const prod = finishedProducts.find(p => p.id === editingProductId);
        if (prod) {
            prod.name = rawName;
            prod.imageUrl = addProductImageBase64 || null;
            prod.materialIds = Array.from(selectedMaterialIds);
            prod.updatedAt = new Date().toISOString();
        }
        saveContextToStorage();
        closeAddModal();
        applyFiltersAndRender();
        showToast(`Updated finished product "${rawName}"`, "success");
        return;
    }

    // Create new finished product context
    const newProduct = {
        id: "fp_" + Date.now().toString(36) + "_" + Math.random().toString(36).substr(2, 5),
        name: rawName,
        imageUrl: addProductImageBase64 || null,
        materialIds: Array.from(selectedMaterialIds),
        createdAt: new Date().toISOString()
    };

    finishedProducts.unshift(newProduct);
    saveContextToStorage();
    closeAddModal();
    applyFiltersAndRender();
    showToast(`Added finished product context "${rawName}"`, "success");
}

/* ==========================================================
   3-STEP IMPORT WIZARD (OTHER DETAILS ONLY)
   ========================================================== */

function openImportModal() {
    if (!fpcImportModalOverlay) return;

    // Reset Import Wizard state
    importFiles = [];
    importImages = [];
    parsedImportBatch = [];
    importSummary = {
        readyToSave: 0,
        duplicates: 0,
        invalid: 0,
        unknownMaterials: 0,
        ignoredFieldsCount: 0,
        ignoredFieldsList: [],
        matchedImages: 0,
        unmatchedImages: 0
    };

    renderSelectedSpreadsheetFiles();
    renderSelectedImagesList();
    goToImportStep(1);

    fpcImportModalOverlay.classList.add("open", "active");
}

function closeImportModal() {
    if (fpcImportModalOverlay) fpcImportModalOverlay.classList.remove("open", "active");
}

function goToImportStep(step) {
    if (fpcStepIndicator1) fpcStepIndicator1.classList.toggle("active", step >= 1);
    if (fpcStepIndicator2) fpcStepIndicator2.classList.toggle("active", step >= 2);
    if (fpcStepIndicator3) fpcStepIndicator3.classList.toggle("active", step >= 3);

    if (fpcImportStep1View) fpcImportStep1View.hidden = step !== 1;
    if (fpcImportStep2View) fpcImportStep2View.hidden = step !== 2;
    if (fpcImportStep3View) fpcImportStep3View.hidden = step !== 3;

    if (fpcImportNextStepBtn) fpcImportNextStepBtn.hidden = step !== 1;
    if (fpcImportBackBtn) fpcImportBackBtn.hidden = step !== 2;
    if (fpcImportSaveBtn) fpcImportSaveBtn.hidden = step !== 2;
    if (fpcImportDoneBtn) fpcImportDoneBtn.hidden = step !== 3;
    if (fpcImportCancelBtn) fpcImportCancelBtn.hidden = step === 3;
}

function renderSelectedSpreadsheetFiles() {
    if (!fpcSpreadsheetFilesList) return;
    if (!importFiles.length) {
        fpcSpreadsheetFilesList.innerHTML = "";
        if (fpcImportNextStepBtn) fpcImportNextStepBtn.disabled = true;
        return;
    }

    fpcSpreadsheetFilesList.innerHTML = importFiles.map((f, i) => `
        <div class="fpc-file-chip">
            <span>📄 ${escapeHtml(f.name)} (${(f.size / 1024).toFixed(1)} KB)</span>
            <button type="button" class="chip-remove" data-index="${i}">✕</button>
        </div>
    `).join("");

    fpcSpreadsheetFilesList.querySelectorAll(".chip-remove").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = Number(btn.getAttribute("data-index"));
            importFiles.splice(idx, 1);
            renderSelectedSpreadsheetFiles();
        });
    });

    if (fpcImportNextStepBtn) fpcImportNextStepBtn.disabled = importFiles.length === 0;
}

function renderSelectedImagesList() {
    if (!fpcImagesFilesList) return;
    if (!importImages.length) {
        fpcImagesFilesList.innerHTML = "";
        return;
    }

    fpcImagesFilesList.innerHTML = importImages.map((img, i) => `
        <div class="fpc-file-chip">
            <span>🖼️ ${escapeHtml(img.name)}</span>
            <button type="button" class="chip-remove" data-index="${i}">✕</button>
        </div>
    `).join("");

    fpcImagesFilesList.querySelectorAll(".chip-remove").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = Number(btn.getAttribute("data-index"));
            importImages.splice(idx, 1);
            renderSelectedImagesList();
        });
    });
}

// Step 2: Validate and Preview
async function runValidateAndPreview() {
    if (!importFiles.length) return;

    if (typeof window.XLSX === "undefined") {
        showToast("SheetJS library is loading. Please try again.", "error");
        return;
    }

    parsedImportBatch = [];
    const detectedColumns = new Set();
    const ignoredColumns = new Set();

    const existingNames = new Set(finishedProducts.map(p => p.name.trim().toLowerCase()));
    const batchNames = new Set();

    let readyCount = 0;
    let dupCount = 0;
    let invCount = 0;
    let unknownMatCount = 0;
    let matchedImgCount = 0;
    let unmatchedImgCount = 0;

    for (const file of importFiles) {
        const buffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });

        rows.forEach(row => {
            // Check keys in row
            const keys = Object.keys(row);
            let productVal = "";
            let materialsVal = "";

            keys.forEach(k => {
                const normK = k.trim().toLowerCase();
                if (["finished product", "product name", "finished_product", "product", "item name", "finished product name"].includes(normK)) {
                    detectedColumns.add(k);
                    if (!productVal) productVal = String(row[k]).trim();
                } else if (["raw materials", "materials", "ingredients", "raw_materials", "material"].includes(normK)) {
                    detectedColumns.add(k);
                    if (!materialsVal) materialsVal = String(row[k]).trim();
                } else {
                    ignoredColumns.add(k);
                }
            });

            // If empty row, skip
            if (!productVal && !materialsVal) return;

            // Validation logic
            let status = "ready";
            let statusBadge = `<span class="status-badge status-badge-instock">✓ Ready</span>`;
            let message = "Valid";
            const normProdName = productVal.toLowerCase();

            // 1. Missing Name or Generic Operational Name
            if (!productVal) {
                status = "invalid";
                statusBadge = `<span class="status-badge status-badge-outofstock">✕ Invalid</span>`;
                message = "Missing Product Name";
                invCount++;
            }
            else if (isGenericOperationalName(productVal)) {
                status = "invalid";
                statusBadge = `<span class="status-badge status-badge-outofstock">✕ Invalid</span>`;
                message = "Generic operational label not allowed";
                invCount++;
            }
            // 2. Duplicate in database
            else if (existingNames.has(normProdName)) {
                status = "duplicate";
                statusBadge = `<span class="status-badge status-badge-lowstock">⚠ Duplicate</span>`;
                message = "Already Exists";
                dupCount++;
            }
            // 3. Duplicate within batch
            else if (batchNames.has(normProdName)) {
                status = "duplicate";
                statusBadge = `<span class="status-badge status-badge-lowstock">⚠ Duplicate</span>`;
                message = "Duplicate in Batch";
                dupCount++;
            }

            // Resolve Raw Materials
            const rawMatStrings = materialsVal
                ? materialsVal.split(/[,;|•\n]+/).map(s => s.trim()).filter(Boolean)
                : [];

            const validMatIds = [];
            const unknownMats = [];

            rawMatStrings.forEach(str => {
                const lower = str.toLowerCase();
                const matched = rawMaterials.find(rm => rm.name.toLowerCase() === lower || rm.itemCode.toLowerCase() === lower);
                if (matched) {
                    if (!validMatIds.includes(matched.id)) validMatIds.push(matched.id);
                } else {
                    unknownMats.push(str);
                }
            });

            if (unknownMats.length > 0) {
                unknownMatCount += unknownMats.length;
                if (status === "ready") {
                    status = validMatIds.length > 0 ? "partial" : "invalid";
                    statusBadge = `<span class="status-badge status-badge-lowstock">⚠ Partial</span>`;
                    message = `Unknown Raw Material: ${unknownMats.join(", ")}`;
                    if (validMatIds.length === 0) {
                        invCount++;
                    }
                }
            }

            if (status === "ready" && validMatIds.length === 0) {
                status = "invalid";
                statusBadge = `<span class="status-badge status-badge-outofstock">✕ Invalid</span>`;
                message = "No valid raw materials found";
                invCount++;
            }

            // Image matching
            let matchedImage = null;
            if (productVal) {
                const normMatch = normalizeForMatching(productVal);
                const found = importImages.find(img => normalizeForMatching(img.name) === normMatch);
                if (found) {
                    matchedImage = found.dataUrl;
                    matchedImgCount++;
                }
            }

            if (status === "ready" || status === "partial") {
                batchNames.add(normProdName);
                readyCount++;
            }

            parsedImportBatch.push({
                productName: productVal,
                rawMaterialStrings,
                validMaterialIds: validMatIds,
                unknownMaterials: unknownMats,
                imageUrl: matchedImage,
                status,
                statusBadge,
                message
            });
        });
    }

    unmatchedImgCount = Math.max(0, importImages.length - matchedImgCount);

    importSummary = {
        readyToSave: readyCount,
        duplicates: dupCount,
        invalid: invCount,
        unknownMaterials: unknownMatCount,
        ignoredFieldsCount: ignoredColumns.size,
        ignoredFieldsList: Array.from(ignoredColumns),
        matchedImages: matchedImgCount,
        unmatchedImages: unmatchedImgCount
    };

    // Render Step 2 Views
    renderStep2FieldDetection(detectedColumns, ignoredColumns);
    renderStep2SummaryBar();
    renderStep2PreviewTable();

    goToImportStep(2);
    if (fpcImportSaveBtn) fpcImportSaveBtn.disabled = readyCount === 0;
}

function normalizeForMatching(val) {
    return String(val || "")
        .toLowerCase()
        .replace(/\.(png|jpe?g|webp)$/i, "")
        .replace(/[-_.\s]+/g, "");
}

function renderStep2FieldDetection(detected, ignored) {
    if (!fpcFieldDetectionBox) return;

    const detectedHtml = Array.from(detected).map(f => `<span class="fpc-field-tag fpc-tag-supported">${escapeHtml(f)}</span>`).join("") || "<em>Finished Product, Raw Materials</em>";
    const ignoredHtml = Array.from(ignored).map(f => `<span class="fpc-field-tag fpc-tag-ignored">${escapeHtml(f)}</span>`).join("") || "<em>None</em>";

    fpcFieldDetectionBox.innerHTML = `
        <div class="fpc-field-line">
            <strong>Supported Fields (Mapped):</strong> ${detectedHtml}
        </div>
        <div class="fpc-field-line">
            <strong>Ignored Fields (Skipped):</strong> ${ignoredHtml}
        </div>`;
}

function renderStep2SummaryBar() {
    if (!fpcValidationSummaryBar) return;
    fpcValidationSummaryBar.innerHTML = `
        <div class="summary-pill-group">
            <span class="summary-pill pill-green">Ready to Save: <strong>${importSummary.readyToSave}</strong></span>
            <span class="summary-pill pill-orange">Duplicates: <strong>${importSummary.duplicates}</strong></span>
            <span class="summary-pill pill-red">Invalid: <strong>${importSummary.invalid}</strong></span>
            <span class="summary-pill pill-orange">Unknown Materials: <strong>${importSummary.unknownMaterials}</strong></span>
            <span class="summary-pill pill-gray">Ignored Fields: <strong>${importSummary.ignoredFieldsCount}</strong></span>
            <span class="summary-pill pill-blue">Matched Images: <strong>${importSummary.matchedImages}</strong></span>
        </div>`;
}

function renderStep2PreviewTable() {
    if (!fpcImportPreviewTableBody) return;

    if (!parsedImportBatch.length) {
        fpcImportPreviewTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">No rows could be extracted from selected files.</td></tr>`;
        return;
    }

    fpcImportPreviewTableBody.innerHTML = parsedImportBatch.map(r => `
        <tr>
            <td>${r.statusBadge}</td>
            <td><strong>${escapeHtml(r.productName || "—")}</strong></td>
            <td>${escapeHtml(r.rawMaterialStrings.join(", ") || "—")}</td>
            <td>${r.imageUrl ? '<span style="color: var(--emerald); font-weight: 700;">✓ Matched</span>' : '<span style="color: var(--rm-ink-dim);">Avatar</span>'}</td>
            <td><small>${escapeHtml(r.message)}</small></td>
        </tr>
    `).join("");
}

// Step 3: Save Valid Records
function saveImportedRecords() {
    const validRows = parsedImportBatch.filter(r => r.status === "ready" || r.status === "partial");
    if (!validRows.length) return;

    let addedCount = 0;

    validRows.forEach(r => {
        const newProduct = {
            id: "fp_" + Date.now().toString(36) + "_" + Math.random().toString(36).substr(2, 5),
            name: r.productName.trim(),
            imageUrl: r.imageUrl || null,
            materialIds: r.validMaterialIds,
            createdAt: new Date().toISOString()
        };
        finishedProducts.unshift(newProduct);
        addedCount++;
    });

    saveContextToStorage();
    applyFiltersAndRender();

    // Render Step 3 Result Card
    if (fpcImportResultCard) {
        fpcImportResultCard.innerHTML = `
            <div style="font-size: 2.5rem; color: var(--emerald);">✓</div>
            <h4>Import Complete</h4>
            <p style="color: var(--rm-ink-dim); margin-bottom: 20px;">Successfully added valid finished product context records to Inventory.</p>
            
            <div class="fpc-result-grid">
                <div class="fpc-result-box">
                    <span>Added Products</span>
                    <strong style="color: var(--emerald);">${addedCount}</strong>
                </div>
                <div class="fpc-result-box">
                    <span>Skipped (Duplicates)</span>
                    <strong style="color: var(--orange);">${importSummary.duplicates}</strong>
                </div>
                <div class="fpc-result-box">
                    <span>Invalid Rows</span>
                    <strong style="color: #EF4444;">${importSummary.invalid}</strong>
                </div>
                <div class="fpc-result-box">
                    <span>Unknown Materials</span>
                    <strong>${importSummary.unknownMaterials}</strong>
                </div>
                <div class="fpc-result-box">
                    <span>Ignored Fields</span>
                    <strong>${importSummary.ignoredFieldsCount}</strong>
                </div>
                <div class="fpc-result-box">
                    <span>Images Matched</span>
                    <strong style="color: var(--blue);">${importSummary.matchedImages}</strong>
                </div>
            </div>`;
    }

    goToImportStep(3);
    showToast(`Successfully imported ${addedCount} finished product configurations!`, "success");
}

/* ==========================================================
   EVENT LISTENERS
   ========================================================== */

function initEvents() {
    // Search, Sort, Page Size
    if (fpcSearchInput) fpcSearchInput.addEventListener("input", () => { currentPage = 1; applyFiltersAndRender(); });
    if (fpcSortSelect) fpcSortSelect.addEventListener("change", () => { currentPage = 1; applyFiltersAndRender(); });
    if (fpcPageSizeSelect) fpcPageSizeSelect.addEventListener("change", () => {
        pageSize = Number(fpcPageSizeSelect.value) || 20;
        currentPage = 1;
        applyFiltersAndRender();
    });

    // Add Modal
    if (fpcAddProductBtn) fpcAddProductBtn.addEventListener("click", openAddModal);
    if (fpcAddModalClose) fpcAddModalClose.addEventListener("click", closeAddModal);
    if (fpcAddModalCancel) fpcAddModalCancel.addEventListener("click", closeAddModal);
    if (fpcAddModalSave) fpcAddModalSave.addEventListener("click", handleSaveProduct);
    if (fpcMatSearchInput) fpcMatSearchInput.addEventListener("input", () => renderMaterialChecklist(fpcMatSearchInput.value));

    // Image Input in Add Modal
    if (fpcImageInput) {
        fpcImageInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    addProductImageBase64 = ev.target.result;
                    if (fpcImagePreview) fpcImagePreview.src = addProductImageBase64;
                    if (fpcImagePreviewWrap) fpcImagePreviewWrap.hidden = false;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (fpcRemoveImageBtn) {
        fpcRemoveImageBtn.addEventListener("click", () => {
            addProductImageBase64 = null;
            if (fpcImageInput) fpcImageInput.value = "";
            if (fpcImagePreviewWrap) fpcImagePreviewWrap.hidden = true;
        });
    }

    // View Details Modal
    if (fpcDetailsModalClose) fpcDetailsModalClose.addEventListener("click", closeDetailsModal);
    if (fpcDetailsCloseBtn) fpcDetailsCloseBtn.addEventListener("click", closeDetailsModal);

    // Import Modal
    if (fpcImportBtn) fpcImportBtn.addEventListener("click", openImportModal);
    if (fpcImportModalClose) fpcImportModalClose.addEventListener("click", closeImportModal);
    if (fpcImportCancelBtn) fpcImportCancelBtn.addEventListener("click", closeImportModal);
    if (fpcImportBackBtn) fpcImportBackBtn.addEventListener("click", () => goToImportStep(1));
    if (fpcImportNextStepBtn) fpcImportNextStepBtn.addEventListener("click", runValidateAndPreview);
    if (fpcImportSaveBtn) fpcImportSaveBtn.addEventListener("click", saveImportedRecords);
    if (fpcImportDoneBtn) fpcImportDoneBtn.addEventListener("click", closeImportModal);

    // Import Dropzones
    if (fpcSpreadsheetDropzone && fpcSpreadsheetInput) {
        fpcSpreadsheetDropzone.addEventListener("click", () => fpcSpreadsheetInput.click());
        fpcSpreadsheetInput.addEventListener("change", (e) => {
            const files = Array.from(e.target.files);
            files.forEach(f => {
                if (!importFiles.some(ex => ex.name === f.name && ex.size === f.size)) {
                    importFiles.push(f);
                }
            });
            fpcSpreadsheetInput.value = "";
            renderSelectedSpreadsheetFiles();
        });
    }

    if (fpcImagesDropzone && fpcImagesInput) {
        fpcImagesDropzone.addEventListener("click", () => fpcImagesInput.click());
        fpcImagesInput.addEventListener("change", (e) => {
            const files = Array.from(e.target.files);
            files.forEach(f => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    if (!importImages.some(ex => ex.name === f.name)) {
                        importImages.push({
                            file: f,
                            name: f.name,
                            dataUrl: ev.target.result
                        });
                        renderSelectedImagesList();
                    }
                };
                reader.readAsDataURL(f);
            });
            fpcImagesInput.value = "";
        });
    }

    // Backdrop click handlers to close modals
    [fpcAddModalOverlay, fpcDetailsModalOverlay, fpcImportModalOverlay].forEach(overlay => {
        if (!overlay) return;
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                overlay.classList.remove("open", "active");
            }
        });
    });

    // Escape key handler
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeAddModal();
            closeDetailsModal();
            closeImportModal();
        }
    });
}

/* ==========================================================
   UTILITY HELPERS
   ========================================================== */

function getInitials(name) {
    const parts = String(name || "FP").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "FP";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function showToast(message, type = "info") {
    const stack = document.getElementById("toastStack");
    if (!stack) return;
    const toast = document.createElement("div");
    toast.className = `toast toast-${type} fade-in`;
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
