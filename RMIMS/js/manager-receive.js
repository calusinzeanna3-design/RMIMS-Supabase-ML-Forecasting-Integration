/**
 * RMSME Manager Receive Module Logic
 * Dedicated Manager Inward Flow:
 * - Sequential auto-generated non-editable, non-clickable reference number (REC-2026-XXXXX)
 * - 2-step workflow: Details Form -> Review Modal -> Confirm & Instant Inventory Update
 * - Live Receipts History Ledger with immediate persistence & full pagination
 * - Bundle Receive: Automatically recognizes finished products containing the selected raw material
 * - Dynamic Requirement Stock calculation with Green (good/exact), Orange (partial), Red (unreached)
 * - Exact time tracking for all inward receipts
 */

import {
  getSystemRawMaterials,
  saveCustomReceipt,
  saveCustomRawMaterial,
  getSystemCustomReceipts
} from './system-materials.js';

import { AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from './authentic-finished-products.js';
import {
  generateNextReference,
  checkReferenceDuplicate,
  showDuplicateWarningModal,
  updateManagerReceipt,
  deleteManagerReceipt
} from './rmims-transaction-engine.js';

const MGR_RECEIPTS_KEY = 'rmims_manager_receipts';

// Authentic Bill of Materials (BOM) standard ratios (kg/L per finished food unit)
const BASELINE_BOM_RATIOS = {
  "Fresh Mature Coconut Meat": 0.40,
  "Panutsa Cane Sugar": 0.15,
  "Muscovado Brown Sugar": 0.12,
  "Pandan Leaves": 0.02,
  "Fresh Garlic": 0.10,
  "Red Chili Peppers (Siling Labuyo)": 0.05,
  "Palm Cooking Oil": 0.08,
  "Cane Vinegar": 0.06,
  "Iodized Salt": 0.015,
  "Refined White Sugar": 0.10,
  "Dried Red Chili Flakes": 0.03,
  "Cornstarch": 0.04,
  "Fresh Cassava Tubers": 0.35,
  "Cheese Seasoning Powder": 0.03,
  "All-Purpose Wheat Flour": 0.25,
  "Purified Water": 0.15,
  "Food Grade Sunset Yellow / Orange Dye": 0.005,
  "Garlic Powder": 0.02,
  "Unripe Green Saba Bananas": 0.30,
  "Vanilla Extract": 0.005,
  "Fresh Sweet Potato": 0.35,
  "Hard Wheat Bread Flour": 0.25,
  "Salted Creamery Butter": 0.08,
  "Condensed Milk": 0.10,
  "Fresh Chiton Mollusk (Kibit)": 0.25,
  "Ground Black Pepper": 0.01,
  "Pork Skin with Back Fat": 0.40,
  "Pure Pork Lard": 0.10,
  "Coarse Rock Salt": 0.03,
  "Fresh Kabasi Fish": 0.50,
  "Fresh Bangus (Milkfish) Skin": 0.30,
  "White Pepper Powder": 0.01,
  "Glutinous Rice (Malagkit for Pinipig)": 0.20,
  "Raw Shelled Peanuts": 0.15,
  "Fresh Whole Egg Whites": 0.15,
  "Cream of Tartar": 0.005,
  "Fresh Sapsap Fish": 0.50,
  "Fresh Purple Yam Tubers": 0.45,
  "Evaporated Milk": 0.10,
  "Green Raw Papaya": 0.40,
  "Fresh Carrots": 0.10,
  "Red Bell Peppers": 0.05,
  "Fresh Ginger": 0.03,
  "Red Onions": 0.06,
  "Seedless Raisins": 0.04,
  "Whole Black Peppercorns": 0.01,
  "Fresh Grated Coconut Meat": 0.40,
  "Powdered Milk": 0.08,
  "Fresh Whole Eggs": 0.12,
  "Baking Powder": 0.01,
  "Toasted Sesame Seeds": 0.02,
  "Refined Peanut Oil": 0.08,
  "Fresh Acetes Shrimp (Alamang)": 0.45,
  "Cleaned Chicken Crop (Butse)": 0.35
};

const INITIAL_MGR_RECEIPTS = [];

let rawMaterials = [];
let managerReceipts = [];
let currentPendingReceive = null;

// Pagination state
let currentLedgerPage = 1;
let ledgerPageSize = 5;

// Generate next sequential reference number
function getNextReceiveReference() {
  return generateNextReference('REC');
}

function loadReceipts() {
  try {
    const raw = localStorage.getItem(MGR_RECEIPTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Cleanse legacy mock IDs
        managerReceipts = parsed.filter(r => !['REC-2026-00125', 'REC-2026-00124', 'REC-2026-00120', 'REC-2026-00118'].includes(r.ref));
        if (managerReceipts.length !== parsed.length) {
          localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(managerReceipts));
        }
      } else {
        managerReceipts = [];
      }
    } else {
      managerReceipts = [];
      localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify([]));
    }
  } catch (e) {
    managerReceipts = [];
  }
}

function saveReceipts() {
  try {
    localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(managerReceipts));
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  rawMaterials = getSystemRawMaterials();
  loadReceipts();

  initDatePicker();
  initReferenceDisplay();
  populateMaterialSelects();
  bindFormEvents();
  bindReviewModalEvents();
  bindReceiptActionEvents();
  renderKpis();
  renderHistoryTable();

  // Listen for storage events to refresh if stock changed elsewhere
  window.addEventListener('storage', () => {
    rawMaterials = getSystemRawMaterials();
    renderKpis();
    renderHistoryTable();
  });
});

function initDatePicker() {
  const dateInput = document.getElementById('recDateInput');
  if (dateInput && typeof flatpickr !== 'undefined') {
    flatpickr(dateInput, {
      defaultDate: new Date(),
      dateFormat: 'Y-m-d',
      allowInput: true
    });
  } else if (dateInput) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
}

function initReferenceDisplay() {
  const refDisplay = document.getElementById('mgrRecRefDisplay');
  if (refDisplay) {
    refDisplay.textContent = generateNextReference('REC');
  }
}

function populateMaterialSelects() {
  const select = document.getElementById('recMaterialSelect');
  const filter = document.getElementById('recMaterialFilter');

  // Sort materials alphabetically
  const sorted = [...rawMaterials].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Clear existing options
  if (sorted.length === 0) {
    select.innerHTML = '<option value="" disabled selected>No materials registered yet (Add in Inventory first)</option>';
  } else {
    select.innerHTML = '<option value="">-- Choose Material to Receive --</option>';
  }
  if (filter) {
    filter.innerHTML = '<option value="all">All Materials</option>';
  }

  sorted.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id || m.item_code;
    const u = m.unit_of_measure || m.unit || '';
    opt.dataset.unit = u;
    opt.dataset.stock = m.current_stock ?? 0;
    opt.dataset.min = m.minimum_threshold ?? m.minimum_stock ?? 10;
    opt.dataset.name = m.name;
    opt.textContent = `${m.name} (${m.item_code || m.id}) - Current: ${m.current_stock ?? 0}${u ? ' ' + u : ''}`;
    select.appendChild(opt);

    if (filter) {
      const fOpt = document.createElement('option');
      fOpt.value = m.name;
      fOpt.textContent = m.name;
      filter.appendChild(fOpt);
    }
  });

  // Material change updates preview, unit badge & triggers Bundle Receive recognition
  select.addEventListener('change', () => {
    const selOpt = select.options[select.selectedIndex];
    const previewWrap = document.getElementById('recStockPreviewWrap');
    const unitBadge = document.getElementById('recUnitBadge');
    const curStockNum = document.getElementById('recCurrentStockNum');
    const minStockNum = document.getElementById('recMinStockNum');

    if (selOpt && selOpt.value) {
      const unit = selOpt.dataset.unit || '';
      const stock = selOpt.dataset.stock || '0';
      const min = selOpt.dataset.min || '10';

      if (unitBadge) unitBadge.textContent = unit || '--';
      if (curStockNum) curStockNum.textContent = unit ? `${stock} ${unit}` : `${stock}`;
      if (minStockNum) minStockNum.textContent = unit ? `${min} ${unit}` : `${min}`;
      if (previewWrap) previewWrap.style.display = 'inline-flex';

      // Update Bundle Receive finished products
      updateBundleReceivePreview();
    } else {
      if (previewWrap) previewWrap.style.display = 'none';
      if (unitBadge) unitBadge.textContent = '--';
      hideBundleReceiveSection();
    }
  });
}

function bindFormEvents() {
  const btnReview = document.getElementById('btnOpenReceiveReview');
  const btnReset = document.getElementById('btnResetReceiveForm');
  const btnRefresh = document.getElementById('btnRefreshReceive');
  const searchInput = document.getElementById('recSearchInput');
  const filterSelect = document.getElementById('recMaterialFilter');
  const sortSelect = document.getElementById('recSortFilter');
  const pageSizeSelect = document.getElementById('recPageSize');
  const qtyInput = document.getElementById('recQuantityInput');

  if (btnReview) {
    btnReview.addEventListener('click', handleOpenReviewModal);
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      setTimeout(() => {
        document.getElementById('recStockPreviewWrap').style.display = 'none';
        const unitBadge = document.getElementById('recUnitBadge');
        if (unitBadge) unitBadge.textContent = '--';
        hideBundleReceiveSection();
        initReferenceDisplay();
      }, 50);
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      rawMaterials = getSystemRawMaterials();
      loadReceipts();
      populateMaterialSelects();
      renderKpis();
      renderHistoryTable();
      initReferenceDisplay();
      hideBundleReceiveSection();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      currentLedgerPage = 1;
      renderHistoryTable();
    });
  }

  if (filterSelect) {
    filterSelect.addEventListener('change', () => {
      currentLedgerPage = 1;
      renderHistoryTable();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      currentLedgerPage = 1;
      renderHistoryTable();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => {
      ledgerPageSize = parseInt(pageSizeSelect.value, 10) || 5;
      currentLedgerPage = 1;
      renderHistoryTable();
    });
  }

  // Real-time calculation of Bundle Receive allocation as user inputs quantity
  if (qtyInput) {
    qtyInput.addEventListener('input', updateBundleReceivePreview);
  }
}

// ============================================================================
// BUNDLE RECEIVE LOGIC: RECOGNIZE FINISHED PRODUCTS & CALCULATE REQUIREMENT
// ============================================================================

function matchProductIngredient(ingredientName, selectedMaterialName) {
  const ing = (ingredientName || '').toLowerCase().trim();
  const sel = (selectedMaterialName || '').toLowerCase().trim();
  if (!ing || !sel) return false;
  if (ing === sel) return true;
  if (ing.includes(sel) || sel.includes(ing)) return true;

  // Specific primary ingredient matching (prevents 'Salted Creamery Butter' from matching 'Iodized Salt')
  const isButter = sel.includes('butter');
  const isSugar = sel.includes('sugar') || sel.includes('panutsa') || sel.includes('muscovado');
  const isFlour = sel.includes('flour');
  const isOil = sel.includes('oil') || sel.includes('lard');
  const isSalt = (sel.includes('salt') || sel.includes('asin')) && !isButter;
  const isGarlic = sel.includes('garlic');
  const isChili = sel.includes('chili') || sel.includes('siling');
  const isMilk = sel.includes('milk');
  const isEgg = sel.includes('egg');
  const isBanana = sel.includes('banana') || sel.includes('saba');
  const isYam = sel.includes('yam') || sel.includes('ube');
  const isFish = sel.includes('fish') || sel.includes('sapsap') || sel.includes('kabasi') || sel.includes('bangus');

  if (isButter) return ing.includes('butter');
  if (isSugar) return ing.includes('sugar') || ing.includes('panutsa') || ing.includes('muscovado');
  if (isFlour) return ing.includes('flour');
  if (isOil) return ing.includes('oil') || ing.includes('lard');
  if (isSalt) return ing.includes('salt') && !ing.includes('butter');
  if (isGarlic) return ing.includes('garlic');
  if (isChili) return ing.includes('chili') || ing.includes('siling');
  if (isMilk) return ing.includes('milk');
  if (isEgg) return ing.includes('egg');
  if (isBanana) return ing.includes('banana') || ing.includes('saba');
  if (isYam) return ing.includes('yam') || ing.includes('ube');
  if (isFish) return ing.includes('fish') || ing.includes('sapsap') || ing.includes('kabasi') || ing.includes('bangus');

  return false;
}

function getFinishedProductsForMaterial(materialName) {
  if (!materialName) return [];

  const isBaselineWiped = localStorage.getItem('rmims_wipe_baseline_materials') !== 'false';
  let catalog = !isBaselineWiped ? [...AUTHENTIC_FINISHED_PRODUCTS_CATALOG] : [];
  try {
    const custom = JSON.parse(localStorage.getItem('rmims_custom_finished_products') || '[]');
    if (Array.isArray(custom)) {
      custom.forEach(cp => {
        if (cp.name && !catalog.some(p => p.name.toLowerCase() === cp.name.toLowerCase())) {
          catalog.push({
            name: cp.name,
            materialNames: Array.isArray(cp.raw_materials)
              ? cp.raw_materials.map(r => r.name || r)
              : (Array.isArray(cp.materialNames) ? cp.materialNames : [])
          });
        }
      });
    }
  } catch (e) {}

  const results = [];
  catalog.forEach(product => {
    const matchedIng = (product.materialNames || []).find(ing => matchProductIngredient(ing, materialName));
    if (matchedIng) {
      // Find ratio for this ingredient
      const ratio = BASELINE_BOM_RATIOS[matchedIng] || (
        materialName.toLowerCase().includes('sugar') || materialName.toLowerCase().includes('flour') ? 0.25 :
        materialName.toLowerCase().includes('oil') ? 0.08 :
        materialName.toLowerCase().includes('salt') ? 0.015 : 0.15
      );
      // Standard batch target is 50 finished product units
      const standardBatchUnits = 50;
      const neededStock = Math.max(0.5, Math.round(ratio * standardBatchUnits * 10) / 10);
      results.push({
        productName: product.name,
        ingredientName: matchedIng,
        ratio,
        neededStock
      });
    }
  });

  return results;
}

function updateBundleReceivePreview() {
  const select = document.getElementById('recMaterialSelect');
  const qtyInput = document.getElementById('recQuantityInput');
  const bundleSection = document.getElementById('recBundleSection');
  const bundleTitle = document.getElementById('recBundleTitle');
  const bundleBadge = document.getElementById('recBundleCountBadge');
  const productsGrid = document.getElementById('recBundleProductsGrid');

  if (!select || !bundleSection || !productsGrid) return;

  const selOpt = select.options[select.selectedIndex];
  if (!selOpt || !selOpt.value) {
    hideBundleReceiveSection();
    return;
  }

  const matName = selOpt.dataset.name || selOpt.textContent;
  const unit = selOpt.dataset.unit || '';
  const qty = parseFloat(qtyInput ? qtyInput.value : 0) || 0;

  const matchedProducts = getFinishedProductsForMaterial(matName);

  if (matchedProducts.length === 0) {
    bundleSection.style.display = 'none';
    return;
  }

  bundleSection.style.display = 'block';
  if (bundleTitle) {
    bundleTitle.textContent = `Linked Finished Products (${matName})`;
  }
  if (bundleBadge) {
    bundleBadge.textContent = `${matchedProducts.length} recognized product${matchedProducts.length > 1 ? 's' : ''}`;
  }

  // Distribute / Cascade incoming quantity across the matched finished products
  let remainingQty = qty;

  const cardsHtml = matchedProducts.map(p => {
    const needed = p.neededStock;
    const allocated = Math.min(Math.max(0, remainingQty), needed);
    remainingQty = Math.max(0, remainingQty - allocated);

    let statusClass = 'status-unreached';
    let numClass = 'rec-num-red';
    let tagClass = 'tag-unreached';
    let fillClass = 'fill-unreached';
    let statusText = "0 / Won't Reach";
    let pct = 0;

    if (allocated >= needed && needed > 0) {
      statusClass = 'status-good';
      numClass = 'rec-num-green';
      tagClass = 'tag-good';
      fillClass = 'fill-good';
      statusText = 'Sufficient / Exact';
      pct = 100;
    } else if (allocated > 0 && allocated < needed) {
      statusClass = 'status-partial';
      numClass = 'rec-num-orange';
      tagClass = 'tag-partial';
      fillClass = 'fill-partial';
      statusText = 'Partial Need';
      pct = Math.round((allocated / needed) * 100);
    } else {
      statusClass = 'status-unreached';
      numClass = 'rec-num-red';
      tagClass = 'tag-unreached';
      fillClass = 'fill-unreached';
      statusText = "0 / Won't Reach";
      pct = 0;
    }

    return `
      <div class="rec-product-card ${statusClass}">
        <div class="rec-product-card-top">
          <span class="rec-product-name">${escapeHtml(p.productName)}</span>
          <span class="rec-badge-tag ${tagClass}">${statusText}</span>
        </div>
        <div class="rec-product-stats">
          <span class="rec-req-label">Batch Requirement:</span>
          <span class="rec-req-val">${needed}${unit ? ' ' + unit : ''}</span>
        </div>
        <div class="rec-product-stats" style="margin-top:-2px;">
          <span class="rec-req-label">Stock Allocated:</span>
          <span class="${numClass}">
            ${allocated > 0 ? '+' : ''}${allocated.toFixed(1)}${unit ? ' ' + unit : ''}
            <small style="font-weight:600; font-size:11px; opacity:0.85;">(${pct}%)</small>
          </span>
        </div>
        <div class="rec-bar-wrap">
          <div class="rec-bar-fill ${fillClass}" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  }).join('');

  productsGrid.innerHTML = cardsHtml;
}

function hideBundleReceiveSection() {
  const bundleSection = document.getElementById('recBundleSection');
  if (bundleSection) {
    bundleSection.style.display = 'none';
  }
}

// ============================================================================
// REVIEW MODAL & INVENTORY SYNCHRONIZATION
// ============================================================================

function handleOpenReviewModal() {
  const select = document.getElementById('recMaterialSelect');
  const qtyInput = document.getElementById('recQuantityInput');
  const dateInput = document.getElementById('recDateInput');
  const supplierInput = document.getElementById('recSupplierInput');
  const notesInput = document.getElementById('recNotesInput');

  if (!select.value) {
    alert('Please select a raw material to receive.');
    select.focus();
    return;
  }

  const qty = parseFloat(qtyInput.value);
  if (isNaN(qty) || qty <= 0) {
    alert('Please enter a valid positive quantity received.');
    qtyInput.focus();
    return;
  }

  if (!supplierInput.value.trim()) {
    alert('Please specify the delivery supplier or source.');
    supplierInput.focus();
    return;
  }

  const selOpt = select.options[select.selectedIndex];
  const unit = selOpt.dataset.unit || '';
  const curStock = parseFloat(selOpt.dataset.stock || 0);
  const newStock = curStock + qty;
  const ref = document.getElementById('mgrRecRefDisplay').textContent.trim();

  // SECTION 8, 9, 10: Reference Duplicate Check (Reference is the ONLY basis for duplicate detection)
  const dupCheck = checkReferenceDuplicate(ref);
  if (dupCheck.isDuplicate) {
    showDuplicateWarningModal({
      refNumber: ref,
      existingTransaction: dupCheck.existingTransaction,
      onCancel: () => {},
      onRefresh: () => {
        document.getElementById('mgrReceiveForm').reset();
        document.getElementById('recStockPreviewWrap').style.display = 'none';
        const unitBadge = document.getElementById('recUnitBadge');
        if (unitBadge) unitBadge.textContent = '--';
        initReferenceDisplay();
      }
    });
    return;
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const rawDate = dateInput.value || now.toISOString().slice(0, 10);
  const formattedDateTime = `${rawDate} • ${timeStr}`;

  currentPendingReceive = {
    ref,
    materialId: select.value,
    materialName: selOpt.dataset.name,
    quantity: qty,
    unit,
    curStock,
    newStock,
    date: formattedDateTime,
    time: timeStr,
    supplier: supplierInput.value.trim(),
    notes: notesInput ? notesInput.value.trim() || 'Direct delivery' : 'Direct delivery'
  };

  // Populate Review Modal
  document.getElementById('revRefVal').textContent = currentPendingReceive.ref;
  document.getElementById('revMaterialVal').textContent = `${currentPendingReceive.materialName} (${currentPendingReceive.materialId})`;
  document.getElementById('revCurStockVal').textContent = unit ? `${curStock} ${unit}` : `${curStock}`;
  document.getElementById('revInwardQtyVal').textContent = unit ? `+${qty} ${unit}` : `+${qty}`;
  document.getElementById('revNewStockVal').textContent = unit ? `${newStock} ${unit}` : `${newStock}`;
  document.getElementById('revDateVal').textContent = currentPendingReceive.date;
  document.getElementById('revSupplierVal').textContent = currentPendingReceive.supplier;
  document.getElementById('revNotesVal').textContent = currentPendingReceive.notes;

  const modal = document.getElementById('mgrReceiveReviewModal');
  if (modal) modal.classList.add('open');
}

function bindReviewModalEvents() {
  const modal = document.getElementById('mgrReceiveReviewModal');
  const btnClose = document.getElementById('btnCloseReceiveReview');
  const btnCancel = document.getElementById('btnCancelReceiveReview');
  const btnConfirm = document.getElementById('btnConfirmReceive');

  const closeModal = () => {
    if (modal) modal.classList.remove('open');
  };

  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  if (btnConfirm) {
    btnConfirm.addEventListener('click', () => {
      if (!currentPendingReceive) return;

      const p = currentPendingReceive;

      // 1. Update raw material stock in system-materials and persist
      const mat = rawMaterials.find(m => String(m.id) === String(p.materialId) || String(m.item_code) === String(p.materialId));
      if (mat) {
        mat.current_stock = p.newStock;
        mat.last_updated = new Date().toISOString();
        saveCustomRawMaterial(mat);
      }

      // Also ensure custom raw materials list reflects the updated stock
      try {
        const customMats = JSON.parse(localStorage.getItem('rmims_custom_raw_materials') || '[]');
        const idx = customMats.findIndex(m => String(m.id) === String(p.materialId) || String(m.item_code) === String(p.materialId));
        if (idx !== -1) {
          customMats[idx].current_stock = p.newStock;
          customMats[idx].last_updated = new Date().toISOString();
          localStorage.setItem('rmims_custom_raw_materials', JSON.stringify(customMats));
        }
      } catch (e) {}

      // 2. Persist to system receipts ledger
      saveCustomReceipt({
        id: p.ref,
        material_id: p.materialId,
        material_name: p.materialName,
        received_quantity: p.quantity,
        unit: p.unit,
        receipt_date: p.date,
        supplier_name: p.supplier,
        received_by: 'Store Manager'
      });

      // 3. Persist to manager receipts ledger with exact delivery time
      const record = {
        ref: p.ref,
        date: p.date,
        materialId: p.materialId,
        materialName: p.materialName,
        quantity: p.quantity,
        unit: p.unit,
        supplier: p.supplier,
        recordedBy: 'Store Manager',
        status: 'Approved',
        notes: p.notes
      };

      managerReceipts.unshift(record);
      saveReceipts();

      // 4. Record into manager activities with full branch & user provenance
      try {
        const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
        const actRaw = localStorage.getItem('rmims_manager_activities');
        const acts = actRaw ? JSON.parse(actRaw) : [];
        acts.unshift({
          datetime: p.date,
          timestamp: new Date().toISOString(),
          activity: `Receive Raw Material: +${p.quantity} ${p.unit} ${p.materialName}`,
          reference: p.ref,
          status: 'Approved',
          user: curUser.name || curUser.fullName || curUser.username || 'Manager',
          role: curUser.role || 'Manager',
          branchLoc: curUser.branchLoc || curUser.location || '',
          branchName: curUser.branchName || curUser.branch || '',
          action: 'Received',
          module: 'Inventory'
        });
        localStorage.setItem('rmims_manager_activities', JSON.stringify(acts));
      } catch (e) {}

      // 5. Broadcast inventory update event across all tabs
      localStorage.setItem('rmims_inventory_updated', String(Date.now()));
      window.dispatchEvent(new Event('storage'));

      // Close modal and show feedback
      closeModal();

      // Reset form & generate new reference number
      document.getElementById('mgrReceiveForm').reset();
      document.getElementById('recStockPreviewWrap').style.display = 'none';
      hideBundleReceiveSection();
      rawMaterials = getSystemRawMaterials();
      populateMaterialSelects();
      initReferenceDisplay();
      renderKpis();
      currentLedgerPage = 1;
      renderHistoryTable();

      alert(`✓ Stock received successfully!\n${p.quantity} ${p.unit} of ${p.materialName} added to inventory (Ref: ${p.ref}).`);
      currentPendingReceive = null;
    });
  }
}

// ============================================================================
// KPI RENDERING
// ============================================================================

function renderKpis() {
  const todayCountEl = document.getElementById('kpiRecToday');
  const todaySubEl = document.getElementById('kpiRecTodaySub');
  const monthCountEl = document.getElementById('kpiRecMonth');
  const monthSubEl = document.getElementById('kpiRecMonthSub');
  const totalCountEl = document.getElementById('kpiRecTotalCount');
  const topMaterialEl = document.getElementById('kpiRecTopMaterial');
  const topMaterialSubEl = document.getElementById('kpiRecTopMaterialSub');

  const totalReceipts = managerReceipts.length;
  if (totalCountEl) totalCountEl.textContent = totalReceipts;

  let todayKg = 0;
  let todayShipments = 0;
  let monthKg = 0;
  let monthDeliveries = 0;
  const matSums = {};

  const todayStr = new Date().toISOString().slice(0, 10);
  const currentMonthStr = todayStr.slice(0, 7);

  managerReceipts.forEach(r => {
    const q = Number(r.quantity || 0);
    const mName = r.materialName || 'Material';
    matSums[mName] = (matSums[mName] || 0) + q;

    const rDateStr = String(r.date || '');
    if (rDateStr.includes('Today') || rDateStr.includes(todayStr)) {
      todayKg += q;
      todayShipments++;
    }
    if (rDateStr.includes(currentMonthStr) || rDateStr.includes('Today') || rDateStr.includes('Yesterday')) {
      monthKg += q;
      monthDeliveries++;
    } else {
      monthKg += q;
      monthDeliveries++;
    }
  });

  if (todayCountEl) todayCountEl.textContent = todayKg.toLocaleString();
  if (todaySubEl) todaySubEl.textContent = `Across ${todayShipments} shipment${todayShipments === 1 ? '' : 's'}`;

  if (monthCountEl) monthCountEl.textContent = monthKg.toLocaleString();
  if (monthSubEl) monthSubEl.textContent = `${monthDeliveries} verified deliver${monthDeliveries === 1 ? 'y' : 'ies'}`;

  let topMat = '--';
  let maxQty = 0;
  Object.keys(matSums).forEach(m => {
    if (matSums[m] > maxQty) {
      maxQty = matSums[m];
      topMat = m;
    }
  });

  if (topMaterialEl) topMaterialEl.textContent = topMat;
  const topMatObj = rawMaterials.find(m => m.name === topMat);
  const topUnit = topMatObj ? (topMatObj.unit_of_measure || topMatObj.unit || '') : '';
  if (topMaterialSubEl) topMaterialSubEl.textContent = topUnit ? `${maxQty} ${topUnit} total inward` : `${maxQty} total inward`;
}

// ============================================================================
// HISTORY LEDGER WITH PAGINATION, SORTING & TIME DISPLAY
// ============================================================================

function renderHistoryTable() {
  const tbody = document.getElementById('mgrReceiveHistoryTbody');
  const countEl = document.getElementById('recLedgerCount');
  const paginationControls = document.getElementById('recPaginationBtns');
  const search = (document.getElementById('recSearchInput')?.value || '').toLowerCase().trim();
  const matFilter = document.getElementById('recMaterialFilter')?.value || 'all';
  const sortOrder = document.getElementById('recSortFilter')?.value || 'latest';

  if (!tbody) return;

  // 1. Filter
  let filtered = managerReceipts.filter(r => {
    if (matFilter !== 'all' && r.materialName !== matFilter) return false;
    if (search) {
      const match = (r.ref || '').toLowerCase().includes(search) ||
                    (r.materialName || '').toLowerCase().includes(search) ||
                    (r.supplier || '').toLowerCase().includes(search) ||
                    (r.notes || '').toLowerCase().includes(search);
      if (!match) return false;
    }
    return true;
  });

  // 2. Sort
  filtered.sort((a, b) => {
    if (sortOrder === 'az') {
      return (a.materialName || '').localeCompare(b.materialName || '');
    } else if (sortOrder === 'za') {
      return (b.materialName || '').localeCompare(a.materialName || '');
    } else if (sortOrder === 'qty_desc') {
      return Number(b.quantity || 0) - Number(a.quantity || 0);
    } else if (sortOrder === 'qty_asc') {
      return Number(a.quantity || 0) - Number(b.quantity || 0);
    } else if (sortOrder === 'oldest') {
      return (a.ref || '').localeCompare(b.ref || '');
    } else {
      // Default: latest first
      return (b.ref || '').localeCompare(a.ref || '');
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:36px 16px; color:#5C7A68; font-size:13px;">
          <div style="font-weight:700; color:#0F2A1B; margin-bottom:4px;">No receipts recorded yet</div>
          <div style="font-size:12px; color:#94A3B8;">Incoming raw material deliveries recorded will appear here automatically.</div>
        </td>
      </tr>
    `;
    if (countEl) countEl.textContent = 'Showing 0 receipts';
    renderPaginationButtons(paginationControls, 0, 0);
    return;
  }

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ledgerPageSize));

  if (currentLedgerPage > totalPages) {
    currentLedgerPage = totalPages;
  }

  // 3. Slice for pagination
  const startIdx = (currentLedgerPage - 1) * ledgerPageSize;
  const endIdx = Math.min(startIdx + ledgerPageSize, totalItems);
  const pageItems = filtered.slice(startIdx, endIdx);

  if (countEl) {
    if (totalItems === 0) {
      countEl.textContent = 'Showing 0 of 0 receipts';
    } else {
      countEl.textContent = `Showing ${startIdx + 1} to ${endIdx} of ${totalItems} receipts`;
    }
  }

  if (totalItems === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:32px; color:#64748B;">
          No receive transactions found matching criteria.
        </td>
      </tr>
    `;
    renderPaginationButtons(paginationControls, 0, 0);
    return;
  }

  // 4. Render rows with prominent time display
  tbody.innerHTML = pageItems.map(r => {
    const dateStr = String(r.date || '');
    let datePart = dateStr;
    let timePart = '10:00 AM';

    if (dateStr.includes('•')) {
      const parts = dateStr.split('•');
      datePart = parts[0].trim();
      timePart = parts[1].trim();
    } else if (dateStr.includes(',')) {
      const parts = dateStr.split(',');
      datePart = parts[0].trim();
      timePart = parts.slice(1).join(',').trim();
    }

    return `
      <tr>
        <td><span class="mgr-ref-pill">${escapeHtml(r.ref)}</span></td>
        <td>
          <div style="font-weight:600; color:#1E293B; font-size:12.5px;">${escapeHtml(datePart)}</div>
          <div style="font-size:11.5px; color:#15803D; font-weight:700; display:flex; align-items:center; gap:4px; margin-top:2px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${escapeHtml(timePart)}
          </div>
        </td>
        <td><strong>${escapeHtml(r.materialName)}</strong></td>
        <td><span class="mgr-qty-delta receive">+${r.quantity} ${escapeHtml(r.unit)}</span></td>
        <td style="color:#334155; font-size:13px;">${escapeHtml(r.supplier || 'Inward Delivery')}</td>
        <td style="font-size:12px; color:#475569;">${escapeHtml(r.recordedBy || 'Store Manager')}</td>
        <td><span class="mgr-status-pill status-approved">Approved</span></td>
        <td style="color:#64748B; font-size:12px; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(r.notes || '')}">
          ${escapeHtml(r.notes || '-')}
        </td>
        <td style="text-align: center;">
          <div style="display:inline-flex; align-items:center; gap:6px; justify-content:center;">
            <button type="button" class="btn-mgr-edit-rec" data-ref="${escapeHtml(r.ref)}" title="Edit Receipt" style="padding:4px 8px; border-radius:6px; border:1px solid #0F766E; background:#FFFFFF; color:#0F766E; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Edit</span>
            </button>
            <button type="button" class="btn-mgr-del-rec" data-ref="${escapeHtml(r.ref)}" title="Delete Receipt" style="padding:4px 8px; border-radius:6px; border:1px solid #FECACA; background:#FEF2F2; color:#DC2626; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <span>Delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // 5. Render Pagination Controls
  renderPaginationButtons(paginationControls, totalPages, totalItems);
}

function renderPaginationButtons(container, totalPages, totalItems) {
  if (!container) return;
  if (totalItems === 0 || totalPages === 0) {
    container.innerHTML = `
      <button type="button" class="page-btn disabled" disabled aria-label="Previous Page">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button type="button" class="page-btn disabled" disabled>1</button>
      <button type="button" class="page-btn disabled" disabled aria-label="Next Page">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    `;
    return;
  }

  let html = `
    <button type="button" class="page-btn ${currentLedgerPage <= 1 ? 'disabled' : ''}" id="btnRecPrev" ${currentLedgerPage <= 1 ? 'disabled' : ''} aria-label="Previous Page" title="Previous Page">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
  `;

  for (let i = 1; i <= Math.max(1, totalPages); i++) {
    html += `
      <button type="button" class="page-btn ${i === currentLedgerPage ? 'active' : ''}" data-page="${i}">
        ${i}
      </button>
    `;
  }

  html += `
    <button type="button" class="page-btn ${currentLedgerPage >= totalPages ? 'disabled' : ''}" id="btnRecNext" ${currentLedgerPage >= totalPages ? 'disabled' : ''} aria-label="Next Page" title="Next Page">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  `;

  container.innerHTML = html;

  // Bind pagination clicks
  const prevBtn = container.querySelector('#btnRecPrev');
  if (prevBtn && !prevBtn.disabled) {
    prevBtn.addEventListener('click', () => {
      currentLedgerPage--;
      renderHistoryTable();
    });
  }

  const nextBtn = container.querySelector('#btnRecNext');
  if (nextBtn && !nextBtn.disabled) {
    nextBtn.addEventListener('click', () => {
      currentLedgerPage++;
      renderHistoryTable();
    });
  }

  container.querySelectorAll('button[data-page]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentLedgerPage = parseInt(e.target.dataset.page, 10);
      renderHistoryTable();
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * ============================================================================
 * EDIT & DELETE RECEIPT ACTION HANDLERS
 * ============================================================================
 */
let pendingDeleteReceiptRef = null;

function bindReceiptActionEvents() {
  const tbody = document.getElementById('mgrReceiveHistoryTbody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-mgr-edit-rec');
      if (editBtn) {
        openEditReceiptModal(editBtn.dataset.ref);
        return;
      }
      const delBtn = e.target.closest('.btn-mgr-del-rec');
      if (delBtn) {
        openDeleteReceiptModal(delBtn.dataset.ref);
        return;
      }
    });
  }

  // Edit modal buttons
  const editForm = document.getElementById('mgrEditReceiptForm');
  const btnCloseEdit = document.getElementById('btnCloseEditReceipt');
  const btnCancelEdit = document.getElementById('btnCancelEditReceipt');

  const closeEditModal = () => {
    const modal = document.getElementById('mgrEditReceiptModal');
    if (modal) modal.style.display = 'none';
  };

  if (btnCloseEdit) btnCloseEdit.addEventListener('click', closeEditModal);
  if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);

  if (editForm) {
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const ref = document.getElementById('editRecRef').value;
      const newQty = parseFloat(document.getElementById('editRecQty').value);
      const supplier = document.getElementById('editRecSupplier').value.trim();
      const notes = document.getElementById('editRecNotes').value.trim();

      if (isNaN(newQty) || newQty <= 0) {
        alert('Please enter a valid positive quantity.');
        return;
      }

      const res = updateManagerReceipt(ref, {
        quantity: newQty,
        supplier: supplier,
        notes: notes
      });

      if (res && res.success) {
        closeEditModal();
        rawMaterials = getSystemRawMaterials();
        loadReceipts();
        renderKpis();
        renderHistoryTable();
        alert(`✓ Receipt ${ref} updated successfully.`);
      } else {
        alert('Error updating receipt: ' + (res?.message || 'Unknown error'));
      }
    });
  }

  // Delete modal buttons
  const btnCloseDel = document.getElementById('btnCloseDeleteReceipt');
  const btnCancelDel = document.getElementById('btnCancelDeleteReceipt');
  const btnConfirmDel = document.getElementById('btnConfirmDeleteReceipt');

  const closeDelModal = () => {
    pendingDeleteReceiptRef = null;
    const modal = document.getElementById('mgrDeleteReceiptModal');
    if (modal) modal.style.display = 'none';
  };

  if (btnCloseDel) btnCloseDel.addEventListener('click', closeDelModal);
  if (btnCancelDel) btnCancelDel.addEventListener('click', closeDelModal);

  if (btnConfirmDel) {
    btnConfirmDel.addEventListener('click', () => {
      if (!pendingDeleteReceiptRef) return;
      const ref = pendingDeleteReceiptRef;
      const res = deleteManagerReceipt(ref);
      if (res && res.success) {
        closeDelModal();
        rawMaterials = getSystemRawMaterials();
        loadReceipts();
        renderKpis();
        renderHistoryTable();
        alert(`✓ Receipt ${ref} deleted and inward stock reverted.`);
      }
    });
  }
}

function openEditReceiptModal(ref) {
  const rec = managerReceipts.find(r => r.ref === ref);
  if (!rec) return;

  const modal = document.getElementById('mgrEditReceiptModal');
  if (!modal) return;

  document.getElementById('editRecRef').value = rec.ref;
  document.getElementById('editRecRefDisplay').value = rec.ref;
  document.getElementById('editRecMaterial').value = `${rec.materialName} (${rec.materialId || ''})`;
  document.getElementById('editRecQty').value = rec.quantity;
  document.getElementById('editRecUnit').value = rec.unit || 'kg';
  document.getElementById('editRecSupplier').value = rec.supplier || '';
  document.getElementById('editRecNotes').value = rec.notes || '';

  modal.style.display = 'flex';
}

function openDeleteReceiptModal(ref) {
  const rec = managerReceipts.find(r => r.ref === ref);
  if (!rec) return;

  pendingDeleteReceiptRef = ref;
  const modal = document.getElementById('mgrDeleteReceiptModal');
  const codeEl = document.getElementById('deleteRecRefCode');
  const warnEl = document.getElementById('deleteRecStockWarning');

  if (codeEl) codeEl.textContent = ref;
  if (warnEl) {
    warnEl.textContent = `⚠️ Warning: Deleting this receipt will deduct ${rec.quantity} ${rec.unit || 'units'} from "${rec.materialName}" stock.`;
  }

  modal.style.display = 'flex';
}

