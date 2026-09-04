/**
 * RMIMS ADMIN INVENTORY — OTHER DETAILS ONLY
 * Finished Product Context + Multi-File / Multi-Image Import & Validation
 */

import { supabase } from "../supabase/supabase-config.js";
import { AUTHENTIC_59_RAW_MATERIALS, AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS } from "./authentic-59-dataset.js";
import { AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from "./authentic-finished-products.js";

// State
let rawMaterials = [];
let finishedProducts = [];
let filteredProducts = [];
let currentPage = 1;
let pageSize = 10;
let selectedProductIds = new Set();
let selectModeFpc = false;
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
const fpcImportConfirmBtn = document.getElementById("fpcImportConfirmBtn");
const fpcImportDoneBtn = document.getElementById("fpcImportDoneBtn");

const fpcStepIndicator1 = document.getElementById("fpcStepIndicator1");
const fpcStepIndicator2 = document.getElementById("fpcStepIndicator2");
const fpcStepLine = document.getElementById("fpcStepLine");

const fpcImportStep1View = document.getElementById("fpcImportStep1View");
const fpcImportLoadingView = document.getElementById("fpcImportLoadingView");
const fpcImportStep2View = document.getElementById("fpcImportStep2View");
const fpcImportResultCard = document.getElementById("fpcImportResultCard");

const fpcSpreadsheetDropzone = document.getElementById("fpcSpreadsheetDropzone");
const fpcSpreadsheetInput = document.getElementById("fpcSpreadsheetInput");
const fpcSpreadsheetFilesList = document.getElementById("fpcSpreadsheetFilesList");

const fpcImagesDropzone = document.getElementById("fpcImagesDropzone");
const fpcImagesInput = document.getElementById("fpcImagesInput");
const fpcImagesFilesList = document.getElementById("fpcImagesFilesList");

// Local Storage Keys
const STORAGE_KEY = "rmims_finished_product_context";
const DELETED_STORAGE_KEY = "rmims_deleted_finished_products";

function getDeletedProducts() {
    try {
        const raw = localStorage.getItem(DELETED_STORAGE_KEY);
        return raw ? new Set(JSON.parse(raw).map(x => String(x).toLowerCase().trim())) : new Set();
    } catch {
        return new Set();
    }
}

function addDeletedProduct(name) {
    if (!name) return;
    const deleted = getDeletedProducts();
    deleted.add(String(name).toLowerCase().trim());
    try {
        localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(Array.from(deleted)));
    } catch {}
}

function unmarkDeletedProduct(name) {
    if (!name) return;
    const deleted = getDeletedProducts();
    deleted.delete(String(name).toLowerCase().trim());
    try {
        localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(Array.from(deleted)));
    } catch {}
}

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
        n === "all" ||
        n === "all activities" ||
        n === "all products" ||
        n === "all materials" ||
        n === "none" ||
        n === "n/a" ||
        n === "na" ||
        n === "null" ||
        n === "undefined" ||
        n === "select" ||
        n === "default" ||
        n === "operational use" ||
        n === "operational" ||
        n === "general usage" ||
        n === "general" ||
        n === "usage" ||
        n === "operational material context" ||
        n === "operational batch" ||
        n === "general production" ||
        n === "production" ||
        n === "production usage" ||
        n === "sample usage" ||
        n === "unassigned / general stock" ||
        n === "unassigned" ||
        n === "imported dsb usage" ||
        n === "imported dsb" ||
        n === "imported disbursement" ||
        n === "imported stock receipt" ||
        n === "imported" ||
        n === "imported usage" ||
        n.includes("imported dsb") ||
        n.includes("imported disbursement")
    );
}

async function loadData() {
    try {
        // 1. Fetch live raw materials catalog
        let mats = [];
        try {
            const { data, error } = await supabase
                .from("raw_materials")
                .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, description")
                .order("name");
            if (!error && data && data.length > 0) mats = data;
        } catch (e) {}

        const matKeyMap = new Map();
        AUTHENTIC_59_RAW_MATERIALS.forEach(m => matKeyMap.set((m.name || "").toLowerCase().trim(), { ...m }));
        mats.forEach(m => {
            const k = (m.name || "").toLowerCase().trim();
            matKeyMap.set(k, { ...(matKeyMap.get(k) || {}), ...m });
        });
        const combinedMats = Array.from(matKeyMap.values());

        rawMaterials = combinedMats.map(m => ({
            id: m.id,
            itemCode: m.item_code || "",
            name: m.name || "",
            unit: m.unit_of_measure || "kg",
            currentStock: Number(m.current_stock) || 0,
            minimumStock: m.minimum_threshold !== null ? Number(m.minimum_threshold) : 0,
            status: computeStockStatus(Number(m.current_stock) || 0, m.minimum_threshold)
        }));

        // 2. Fetch disbursement records to discover any historic product contexts
        let disbs = [...AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS];
        try {
            const { data } = await supabase
                .from("material_disbursements")
                .select("finished_product_name, material_id")
                .order("created_at", { ascending: false });
            if (data && data.length > 0) {
                disbs = [...data, ...AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS];
            }
        } catch (e) {}

        // 3. Load saved context from LocalStorage
        let savedContext = [];
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) savedContext = JSON.parse(raw);
        } catch (e) {
            console.warn("Notice loading local finished product context:", e);
        }

        const deletedSet = getDeletedProducts();

        // Map of productName -> { id, name, imageUrl, materialIds: Set, createdAt }
        const productMap = new Map();

        // Helper to find raw material ID by name
        function findMaterialIdByName(matName) {
            const query = (matName || "").toLowerCase().trim();
            const found = rawMaterials.find(m => {
                const name = (m.name || "").toLowerCase().trim();
                return name === query || name.includes(query) || query.includes(name);
            });
            return found ? found.id : null;
        }

        // 1. Populate from Master Authentic Finished Products Catalog
        if (Array.isArray(AUTHENTIC_FINISHED_PRODUCTS_CATALOG)) {
            AUTHENTIC_FINISHED_PRODUCTS_CATALOG.forEach(p => {
                if (!p || !p.name) return;
                const norm = p.name.trim();
                const key = norm.toLowerCase();
                if (deletedSet.has(key)) return;

                const matIds = new Set();
                if (Array.isArray(p.materialNames)) {
                    p.materialNames.forEach(name => {
                        const mId = findMaterialIdByName(name);
                        if (mId) matIds.add(mId);
                    });
                }

                productMap.set(key, {
                    id: "fp_" + key.replace(/[^a-z0-9]/g, "_"),
                    name: norm,
                    imageUrl: null,
                    materialIds: matIds,
                    createdAt: "2026-01-01T00:00:00Z"
                });
            });
        }

        // 2. Populate / augment from saved context
        if (Array.isArray(savedContext)) {
            savedContext.forEach(p => {
                if (!p || !p.name || isGenericOperationalName(p.name)) return;
                const norm = p.name.trim();
                const key = norm.toLowerCase();
                if (deletedSet.has(key)) return;

                if (productMap.has(key)) {
                    const existing = productMap.get(key);
                    if (p.imageUrl) existing.imageUrl = p.imageUrl;
                    if (Array.isArray(p.materialIds)) {
                        p.materialIds.forEach(id => existing.materialIds.add(id));
                    }
                } else {
                    productMap.set(key, {
                        id: p.id || "fp_" + key.replace(/[^a-z0-9]/g, "_"),
                        name: norm,
                        imageUrl: p.imageUrl || null,
                        materialIds: new Set(p.materialIds || []),
                        createdAt: p.createdAt || new Date().toISOString()
                    });
                }
            });
        }

        // 3. Populate / augment from historic disbursements
        if (Array.isArray(disbs)) {
            disbs.forEach(d => {
                const prodName = d.finished_product_name ? d.finished_product_name.trim() : "";
                if (!prodName || isGenericOperationalName(prodName)) return;
                const key = prodName.toLowerCase();
                if (deletedSet.has(key)) return;
                if (!productMap.has(key)) {
                    productMap.set(key, {
                        id: "fp_" + key.replace(/[^a-z0-9]/g, "_"),
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

    const toggleBtn = document.getElementById("toggleSelectFpcBtn");
    if (toggleBtn) {
        toggleBtn.classList.toggle("active", selectModeFpc);
        const textSpan = toggleBtn.querySelector(".select-btn-text");
        if (textSpan) textSpan.textContent = selectModeFpc ? "Hide Select" : "Select";
    }

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
        const linkedMaterials = p.materialIds
            .map(id => rawMaterials.find(rm => rm.id === id))
            .filter(Boolean);

        const avatarHtml = p.imageUrl
            ? `<div class="fpc-avatar"><img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" class="fpc-avatar-img"></div>`
            : `<div class="fpc-avatar"><span>${escapeHtml(getInitials(p.name))}</span></div>`;

        let chipsHtml = "";
        if (linkedMaterials.length > 0) {
            const visibleChips = linkedMaterials.slice(0, 3).map(m => `
                <span class="fpc-mat-chip" title="${escapeHtml(m.name)}: ${m.currentStock} ${escapeHtml(m.unit)}">${escapeHtml(m.name)}</span>
            `).join("");

            const extraCount = linkedMaterials.length - 3;
            const moreBadge = extraCount > 0 
                ? `<span class="fpc-mat-chip fpc-mat-chip-more btn-open-card-modal" data-id="${escapeHtml(p.id)}" title="Click to view all ${matCount} raw materials">+${extraCount} more</span>` 
                : "";

            chipsHtml = visibleChips + moreBadge;
        } else {
            chipsHtml = `<span class="fpc-no-mats-label">No raw materials linked</span>`;
        }

        return `
            <div class="fpc-card ${isSelected ? "card-selected" : ""}" data-id="${escapeHtml(p.id)}">
                <div class="fpc-card-select-circle ${selectModeFpc ? "" : "hidden-circle"}" data-id="${escapeHtml(p.id)}" title="Select finished product">
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
                    <div class="fpc-card-materials">
                        ${chipsHtml}
                    </div>
                </div>
                <div class="fpc-card-footer">
                    <button type="button" class="btn-view-details" data-id="${escapeHtml(p.id)}">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 14px; height: 14px;"><path d="M15 12A3 3 0 1 1 9 12A3 3 0 0 1 15 12Z" stroke="currentColor" stroke-width="2"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5C16.478 5 20.268 7.943 21.542 12C20.268 16.057 16.478 19 12 19C7.523 19 3.732 16.057 2.458 12Z" stroke="currentColor" stroke-width="2"/></svg>
                        View Details
                    </button>
                    <div class="fpc-card-footer-actions">
                        <button type="button" class="btn-card-edit" data-id="${escapeHtml(p.id)}" title="Edit product">
                            <svg viewBox="0 0 24 24" fill="none" width="13" height="13" stroke="currentColor" stroke-width="2"><path d="M11 4H4C3.44772 4 3 4.44772 3 5V20C3 20.5523 3.44772 21 4 21H19C19.5523 21 20 20.5523 20 20V13M18.5 2.5C19.3284 1.67157 20.6716 1.67157 21.5 2.5C22.3284 3.32843 22.3284 4.67157 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                        <button type="button" class="btn-card-delete" data-id="${escapeHtml(p.id)}" title="Delete product">
                            <svg viewBox="0 0 24 24" fill="none" width="13" height="13" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                    </div>
                </div>
            </div>`;
    }).join("");

    attachFpcCardListeners();
    updateFpcSelectionBar();
}

function deleteProductById(productId) {
    const prod = finishedProducts.find(p => p.id === productId);
    if (!prod) return;
    const conf = confirm(`Are you sure you want to delete finished product "${prod.name}"?`);
    if (!conf) return;

    addDeletedProduct(prod.name);
    finishedProducts = finishedProducts.filter(p => p.id !== productId);
    selectedProductIds.delete(productId);
    saveContextToStorage();
    closeDetailsModal();
    applyFiltersAndRender();
    showToast(`Deleted finished product "${prod.name}"`, "success");
}

function attachFpcCardListeners() {
    // Toggle Select Mode Button
    const toggleBtn = document.getElementById("toggleSelectFpcBtn");
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            selectModeFpc = !selectModeFpc;
            if (!selectModeFpc) selectedProductIds.clear();
            applyFiltersAndRender();
        };
    }

    // Hide Selection Button
    const hideBtn = document.getElementById("hideSelectionFpcBtn");
    if (hideBtn) {
        hideBtn.onclick = () => {
            selectModeFpc = false;
            selectedProductIds.clear();
            applyFiltersAndRender();
        };
    }

    // Circle Selection & Card Toggle
    fpcCardsContainer.querySelectorAll(".fpc-card").forEach(card => {
        const id = card.getAttribute("data-id");
        const circle = card.querySelector(".fpc-card-select-circle");

        const toggleSelection = (e) => {
            if (e.target.closest(".btn-view-details") || e.target.closest(".btn-card-edit") || e.target.closest(".btn-card-delete")) return;
            if (!selectModeFpc && !e.target.closest(".fpc-card-select-circle")) return;
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

    // View Details button and +N more badge
    fpcCardsContainer.querySelectorAll(".btn-view-details, .btn-open-card-modal").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            const prod = finishedProducts.find(p => p.id === id);
            if (prod) openDetailsModal(prod);
        });
    });

    // Single Edit button
    fpcCardsContainer.querySelectorAll(".btn-card-edit").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            const prod = finishedProducts.find(p => p.id === id);
            if (prod) openEditProductModal(prod);
        });
    });

    // Single Delete button
    fpcCardsContainer.querySelectorAll(".btn-card-delete").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            deleteProductById(id);
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

            selectedProductIds.forEach(id => {
                const p = finishedProducts.find(x => x.id === id);
                if (p) addDeletedProduct(p.name);
            });

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

    let btns = `<button type="button" class="inv-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;

    // Windowed Pagination Algorithm
    const maxVisible = 7;
    let pages = [];
    if (maxPage <= maxVisible) {
        pages = Array.from({ length: maxPage }, (_, i) => i + 1);
    } else {
        pages.push(1);
        if (currentPage > 4) pages.push("...");

        const start = Math.max(2, currentPage - 2);
        const end = Math.min(maxPage - 1, currentPage + 2);
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }

        if (currentPage < maxPage - 3) pages.push("...");
        pages.push(maxPage);
    }

    pages.forEach(p => {
        if (p === "...") {
            btns += `<span class="page-ellipsis">…</span>`;
        } else {
            btns += `<button type="button" class="inv-page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
        }
    });

    btns += `<button type="button" class="inv-page-btn" data-page="${currentPage + 1}" ${currentPage === maxPage ? "disabled" : ""}>›</button>`;

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

    const editBtn = document.getElementById("fpcDetailsEditBtn");
    const deleteBtn = document.getElementById("fpcDetailsDeleteBtn");

    if (editBtn) {
        editBtn.onclick = () => {
            closeDetailsModal();
            openEditProductModal(product);
        };
    }

    if (deleteBtn) {
        deleteBtn.onclick = () => {
            deleteProductById(product.id);
        };
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

    unmarkDeletedProduct(rawName);

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
   2-STEP IMPORT FINISHED PRODUCT CONTEXT (STEP 1: FILES -> STEP 2: SAVE)
   ========================================================== */

function openImportModal() {
    if (!fpcImportModalOverlay) return;

    // Reset Import state
    importFiles = [];
    importImages = [];
    if (fpcSpreadsheetInput) fpcSpreadsheetInput.value = "";
    if (fpcImagesInput) fpcImagesInput.value = "";

    renderSelectedSpreadsheetFiles();
    renderSelectedImagesList();
    goToImportStep(1);

    fpcImportModalOverlay.classList.add("open", "active");
}

function closeImportModal() {
    if (fpcImportModalOverlay) fpcImportModalOverlay.classList.remove("open", "active");
    importFiles = [];
    importImages = [];
    if (fpcSpreadsheetInput) fpcSpreadsheetInput.value = "";
    if (fpcImagesInput) fpcImagesInput.value = "";
    renderSelectedSpreadsheetFiles();
    renderSelectedImagesList();
    goToImportStep(1);
}

function goToImportStep(step) {
    if (fpcStepIndicator1) fpcStepIndicator1.classList.toggle("active", true);
    if (fpcStepIndicator2) fpcStepIndicator2.classList.toggle("active", step === 2 || step === "loading");
    if (fpcStepLine) fpcStepLine.classList.toggle("active", step === 2 || step === "loading");

    if (fpcImportStep1View) fpcImportStep1View.hidden = step !== 1;
    if (fpcImportLoadingView) fpcImportLoadingView.hidden = step !== "loading";
    if (fpcImportStep2View) fpcImportStep2View.hidden = step !== 2;

    if (fpcImportCancelBtn) fpcImportCancelBtn.hidden = step !== 1;
    if (fpcImportConfirmBtn) fpcImportConfirmBtn.hidden = step !== 1;
    if (fpcImportDoneBtn) fpcImportDoneBtn.hidden = step !== 2;
}

function renderSelectedSpreadsheetFiles() {
    const confirmBtn = document.getElementById("fpcImportConfirmBtn");
    if (!fpcSpreadsheetFilesList) return;
    if (!importFiles.length) {
        fpcSpreadsheetFilesList.innerHTML = "";
        if (confirmBtn) confirmBtn.disabled = true;
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

    if (confirmBtn) confirmBtn.disabled = importFiles.length === 0;
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

function normalizeForMatching(val) {
    return String(val || "")
        .toLowerCase()
        .replace(/\.(png|jpe?g|webp)$/i, "")
        .replace(/[-_.\s]+/g, "");
}

// 2-Step Import Execution with Smooth Loading & Save
async function handleImportFinishedProducts() {
    if (!importFiles.length) return;

    if (typeof window.XLSX === "undefined") {
        showToast("SheetJS library is loading. Please try again.", "error");
        return;
    }

    // Switch to Loading View
    goToImportStep("loading");

    // Smooth UX transition delay
    await new Promise(r => setTimeout(r, 600));

    try {
        const existingNames = new Set(finishedProducts.map(p => p.name.trim().toLowerCase()));
        let addedCount = 0;
        let duplicateCount = 0;
        let matchedImgCount = 0;
        let unknownMatCount = 0;

        for (const file of importFiles) {
            const buffer = await file.arrayBuffer();
            const workbook = window.XLSX.read(buffer, { type: "array" });
            const firstSheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[firstSheetName];
            const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });

            rows.forEach(row => {
                const keys = Object.keys(row);
                let productVal = "";
                let materialsVal = "";

                keys.forEach(k => {
                    const normK = k.trim().toLowerCase();
                    if (["finished product", "product name", "finished_product", "product", "item name", "finished product name"].includes(normK)) {
                        if (!productVal) productVal = String(row[k]).trim();
                    } else if (["raw materials", "materials", "ingredients", "raw_materials", "material"].includes(normK)) {
                        if (!materialsVal) materialsVal = String(row[k]).trim();
                    }
                });

                if (!productVal && !materialsVal) return;
                if (!productVal || isGenericOperationalName(productVal)) return;

                const normProdName = productVal.toLowerCase();
                if (existingNames.has(normProdName)) {
                    duplicateCount++;
                    return;
                }

                // Resolve raw materials
                const rawMatStrings = materialsVal
                    ? materialsVal.split(/[,;|•\n]+/).map(s => s.trim()).filter(Boolean)
                    : [];

                const validMatIds = [];
                rawMatStrings.forEach(str => {
                    const lower = str.toLowerCase();
                    const matched = rawMaterials.find(rm => rm.name.toLowerCase() === lower || rm.itemCode.toLowerCase() === lower);
                    if (matched && !validMatIds.includes(matched.id)) {
                        validMatIds.push(matched.id);
                    } else if (!matched) {
                        unknownMatCount++;
                    }
                });

                // Match product image if available
                let matchedImage = null;
                const normMatch = normalizeForMatching(productVal);
                const foundImg = importImages.find(img => normalizeForMatching(img.name) === normMatch);
                if (foundImg) {
                    matchedImage = foundImg.dataUrl;
                    matchedImgCount++;
                }

                const newProduct = {
                    id: "fp_" + Date.now().toString(36) + "_" + Math.random().toString(36).substr(2, 5),
                    name: productVal,
                    imageUrl: matchedImage,
                    materialIds: validMatIds,
                    createdAt: new Date().toISOString()
                };

                finishedProducts.unshift(newProduct);
                existingNames.add(normProdName);
                addedCount++;
            });
        }

        if (addedCount > 0) {
            saveContextToStorage();
            applyFiltersAndRender();

            // Populate Step 2 Save Summary View
            if (fpcImportResultCard) {
                fpcImportResultCard.innerHTML = `
                    <div style="width: 52px; height: 52px; border-radius: 50%; background: #DCFCE7; color: #16803C; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; font-size: 1.6rem; font-weight: 800; box-shadow: 0 4px 12px rgba(22, 128, 60, 0.18);">✓</div>
                    <h4 style="font-size: 1.15rem; font-weight: 800; color: var(--rm-ink, #0F172A); margin: 0 0 6px;">Saved &amp; Imported Successfully</h4>
                    <p style="color: var(--rm-ink-dim, #64748B); font-size: 0.86rem; margin: 0 0 20px;">${addedCount} finished product context records have been verified and saved to your inventory workspace.</p>
                    
                    <div class="fpc-result-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: left;">
                        <div class="fpc-result-box" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;">
                            <span style="font-size: 0.72rem; color: #64748B; display: block;">Products Saved</span>
                            <strong style="font-size: 1.15rem; font-weight: 700; color: #16803C;">${addedCount}</strong>
                        </div>
                        <div class="fpc-result-box" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;">
                            <span style="font-size: 0.72rem; color: #64748B; display: block;">Duplicates Skipped</span>
                            <strong style="font-size: 1.15rem; font-weight: 700; color: #EA580C;">${duplicateCount}</strong>
                        </div>
                        <div class="fpc-result-box" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;">
                            <span style="font-size: 0.72rem; color: #64748B; display: block;">Images Matched</span>
                            <strong style="font-size: 1.15rem; font-weight: 700; color: #2563EB;">${matchedImgCount}</strong>
                        </div>
                    </div>`;
            }

            goToImportStep(2);
            showToast(`Successfully saved ${addedCount} finished product(s)!`, "success");
        } else {
            goToImportStep(1);
            if (duplicateCount > 0) {
                showToast(`No new products imported (${duplicateCount} duplicates skipped).`, "info");
            } else {
                showToast("No valid finished products found in the selected file(s).", "error");
            }
        }
    } catch (err) {
        console.error("Import error:", err);
        goToImportStep(1);
        showToast("Failed to process file: " + (err.message || err), "error");
    }
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
    const confirmImportBtn = document.getElementById("fpcImportConfirmBtn");
    const doneImportBtn = document.getElementById("fpcImportDoneBtn");
    if (fpcImportBtn) fpcImportBtn.addEventListener("click", openImportModal);
    if (fpcImportModalClose) fpcImportModalClose.addEventListener("click", closeImportModal);
    if (fpcImportCancelBtn) fpcImportCancelBtn.addEventListener("click", closeImportModal);
    if (confirmImportBtn) confirmImportBtn.addEventListener("click", handleImportFinishedProducts);
    if (doneImportBtn) doneImportBtn.addEventListener("click", closeImportModal);

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
