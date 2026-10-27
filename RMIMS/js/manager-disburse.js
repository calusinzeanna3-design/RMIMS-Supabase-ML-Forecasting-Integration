/**
 * RMSME Manager Disburse Module Logic
 * Dedicated Manager Outward Flow:
 * - Sequential auto-generated non-editable, non-clickable reference number (DIS-2026-XXXXX)
 * - 2-step workflow: Details Form -> Review Modal -> Confirm & Instant Inventory Deduction (Lessens materials)
 * - Live Disbursements History Ledger with immediate persistence & full pagination
 * - Bundle Disburse: Automatically recognizes finished products containing the selected raw material
 * - Dynamic Requirement Stock calculation with Green (good/exact), Orange (partial), Red (unreached)
 * - Exact time tracking for all outward disbursements
 */

import {
  getSystemRawMaterials,
  parseSafeDate,
  saveCustomDisbursement,
  saveCustomRawMaterial,
  getSystemCustomDisbursements
} from './system-materials.js';

import { AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from './authentic-finished-products.js';
import {
  generateNextReference,
  checkReferenceDuplicate,
  showDuplicateWarningModal,
  updateManagerDisbursement,
  deleteManagerDisbursement
} from './rmims-transaction-engine.js';
import { recordMaterialDisbursementToSupabase, saveRawMaterialToSupabase, broadcastManagerSync, deleteMaterialDisbursementOnSupabase } from '../supabase/manager-supabase-service.js';
import { attachSearchableCombobox } from './rmims-combobox.js';

const MGR_DISBURSEMENTS_KEY = 'rmims_manager_disbursements';

// Authentic Bill of Materials (BOM) standard ratios (g/pcs/kl for Scones; kg/L for KXC)
const BASELINE_BOM_RATIOS = {
  // Authoritative Scones & Muffins Bakery (Strict 19 Nutribun Raw Materials) Ratios
  "All-Purpose / Bread Flour": 250,
  "Refined White Sugar": 100,
  "Fresh Yellow Squash (Kalabasa)": 350,
  "Skimmed Milk Powder": 80,
  "Condensed Milk": 100,
  "Fresh Whole Eggs": 1, // 1 pc
  "Baking Shortening": 80,
  "Margarine": 80,
  "Instant Dry Yeast": 15,
  "Baking Soda": 10,
  "Iodized Salt": 15,
  "Calcium Propionate": 5,
  "Potassium Sorbate": 5,
  "Crushed Peanuts / Nuts": 50,
  "Desiccated Coconut": 50,
  "Black Sesame Seeds": 20,
  "Malunggay (Moringa) Flakes": 20,
  "Vanilla Extract": 5,
  "Plastic Pillow Packaging": 0.02, // 0.02 kl film roll per batch

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

const INITIAL_MGR_DISBURSEMENTS = [];

let rawMaterials = [];
let managerDisbursements = [];
let currentPendingDisburse = null;

// Pagination state
let currentLedgerPage = 1;
let ledgerPageSize = 5;

// Generate next sequential reference number
function generateNextReferenceLocal() {
  return generateNextReference('DIS');
}

function loadDisbursements() {
  try {
    const raw = localStorage.getItem(MGR_DISBURSEMENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Cleanse legacy mock IDs
        managerDisbursements = parsed.filter(d => !['DIS-2026-00001', 'DIS-2026-00002', 'DIS-2026-00003', 'DIS-2026-00004', 'mgr-disb-001', 'mgr-disb-002', 'mgr-disb-003'].includes(d.ref || d.id));
        if (managerDisbursements.length !== parsed.length) {
          localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(managerDisbursements));
        }
      } else {
        managerDisbursements = [];
      }
    } else {
      managerDisbursements = [];
      localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify([]));
    }
  } catch (e) {
    managerDisbursements = [];
  }
  // Zero zombie data - no fallback reseeding

  // Seamlessly merge all approved Staff Disburse transactions
  try {
    const staffTxRaw = localStorage.getItem('rmims_staff_transactions');
    if (staffTxRaw) {
      const staffTxList = JSON.parse(staffTxRaw);
      if (Array.isArray(staffTxList)) {
        let modified = false;
        staffTxList.forEach(t => {
          const isDisb = (t.activity || t.type || '').toLowerCase().includes('disb') ||
                         String(t.ref || '').toUpperCase().startsWith('DIS');
          if (isDisb && t.status === 'Approved' && t.ref) {
            const rawQty = t.quantity != null ? t.quantity : (t.qtyNum != null ? t.qtyNum : t.qty);
            const numQty = parseFloat(rawQty) || 0;
            const unitVal = t.unit || (t.qty ? String(t.qty).replace(/^[0-9.\s]+/, '') : '') || 'kg';
            const existingIdx = managerDisbursements.findIndex(d => d.ref === t.ref);
            if (existingIdx === -1) {
              managerDisbursements.unshift({
                ref: t.ref,
                date: t.date || (t.approvedAt ? new Date(t.approvedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)),
                time: t.time || (t.approvedAt ? new Date(t.approvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '10:00 AM'),
                materialId: t.materialId || t.item_code || '',
                materialName: t.material || t.materialName || '',
                quantity: numQty,
                unit: unitVal,
                recipient: t.usedFor || t.recipient || 'Production Department',
                recordedBy: t.staff || t.user || 'Staff Member',
                approvedBy: t.approvedBy || 'Store Manager',
                status: 'Approved',
                notes: t.notes || (t.isUpdated ? 'Resubmitted & Approved' : 'Staff Submission Approved')
              });
              modified = true;
            } else {
              // Ensure existing record has correct numeric quantity and status
              if (managerDisbursements[existingIdx].quantity !== numQty || managerDisbursements[existingIdx].status !== 'Approved') {
                managerDisbursements[existingIdx].quantity = numQty;
                managerDisbursements[existingIdx].status = 'Approved';
                modified = true;
              }
            }
          }
        });
        if (modified) {
          localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(managerDisbursements));
        }
      }
    }
  } catch (e) {}
}

function saveDisbursements() {
  try {
    localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(managerDisbursements));
  } catch (e) {}
}

function initManagerDisburse() {
  rawMaterials = getSystemRawMaterials();
  loadDisbursements();

  initDatePicker();
  initReferenceDisplay();
  populateMaterialSelects();
  bindFormEvents();
  bindReviewModalEvents();
  bindDisbursementActionEvents();
  renderKpis();
  renderHistoryTable();

  // Listen for storage events to refresh if stock or finished products changed elsewhere
  const handleLiveRefresh = () => {
    rawMaterials = getSystemRawMaterials();
    loadDisbursements();
    populateMaterialSelects();
    renderKpis();
    renderHistoryTable();
    updateBundleDisbursePreview();
  };

  window.addEventListener('storage', handleLiveRefresh);
  window.addEventListener('rmims_manager_disbursements_updated', handleLiveRefresh);
  window.addEventListener('rmims_staff_transactions_updated', handleLiveRefresh);
  window.addEventListener('rmims_staff_activity_updated', handleLiveRefresh);
  window.addEventListener('rmims_inventory_updated', handleLiveRefresh);
  window.addEventListener('rmims_finished_products_updated', () => {
    updateBundleDisbursePreview();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initManagerDisburse);
} else {
  initManagerDisburse();
}

function initDatePicker() {
  const dateInput = document.getElementById('disbDateInput');
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
  const refDisplay = document.getElementById('mgrDisbRefDisplay');
  if (refDisplay) {
    refDisplay.textContent = generateNextReference('DIS');
  }
}

function populateMaterialSelects() {
  const select = document.getElementById('disbMaterialSelect');
  const filter = document.getElementById('disbMaterialFilter');

  if (!select) return;

  const prevVal = select.value;
  // Sort materials alphabetically
  const sorted = [...rawMaterials].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (sorted.length === 0) {
    select.innerHTML = '<option value="" disabled selected>No materials in inventory (Add or Receive first)</option>';
  } else {
    select.innerHTML = '<option value="">-- Choose Material to Disburse --</option>';
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
    opt.textContent = `${m.name} (${m.item_code || m.id}) - In Stock: ${m.current_stock ?? 0}${u ? ' ' + u : ''}`;
    select.appendChild(opt);

    if (filter) {
      const fOpt = document.createElement('option');
      fOpt.value = m.name;
      fOpt.textContent = m.name;
      filter.appendChild(fOpt);
    }
  });

  // Pre-select via URL parameters if present
  try {
    const sp = new URLSearchParams(window.location.search);
    const targetMat = sp.get('material') || sp.get('id') || sp.get('item_code') || sp.get('code');
    if (targetMat) {
      const match = Array.from(select.options).find(o => 
        String(o.value).toUpperCase() === targetMat.toUpperCase() ||
        String(o.dataset.name || '').toLowerCase() === targetMat.toLowerCase()
      );
      if (match) select.value = match.value;
    } else if (prevVal) {
      select.value = prevVal;
    }
  } catch (_) {
    if (prevVal) select.value = prevVal;
  }

  // Material change updates preview, unit badge & triggers Bundle Disburse recognition
  select.onchange = updateDisburseMaterialSelection;

  // Immediately synchronize unit badge and stock preview
  updateDisburseMaterialSelection();

  attachSearchableCombobox(select, {
    placeholder: 'Search raw material to disburse...',
    width: '100%'
  });

  if (filter) {
    attachSearchableCombobox(filter, {
      placeholder: 'Search material...',
      width: 'auto',
      minWidth: '170px',
      maxWidth: '240px'
    });
  }
}

function updateDisburseMaterialSelection() {
  const select = document.getElementById('disbMaterialSelect');
  if (!select) return;
  const selOpt = select.options[select.selectedIndex];
  const previewWrap = document.getElementById('disbStockPreviewWrap');
  const unitBadge = document.getElementById('disbUnitBadge');
  const curStockNum = document.getElementById('disbCurrentStockNum');
  const minStockNum = document.getElementById('disbMinStockNum');
  const warning = document.getElementById('disbStockWarning');
  const qtyInput = document.getElementById('disbQuantityInput');

  if (warning) warning.style.display = 'none';

  if (selOpt && selOpt.value) {
    const unit = selOpt.dataset.unit || '';
    const stock = selOpt.dataset.stock || '0';
    const min = selOpt.dataset.min || '10';

    if (unitBadge) unitBadge.textContent = unit || '--';
    if (curStockNum) curStockNum.textContent = unit ? `${stock} ${unit}` : `${stock}`;
    if (minStockNum) minStockNum.textContent = unit ? `${min} ${unit}` : `${min}`;
    if (previewWrap) previewWrap.style.display = 'inline-flex';
    if (qtyInput) qtyInput.placeholder = unit ? `e.g. 15 ${unit}` : 'e.g. 15';

    // Update Bundle Disburse preview
    updateBundleDisbursePreview();
  } else {
    if (previewWrap) previewWrap.style.display = 'none';
    if (unitBadge) unitBadge.textContent = '--';
    if (qtyInput) qtyInput.placeholder = 'e.g. 15';
    hideBundleDisburseSection();
  }
}

function bindFormEvents() {
  const btnReview = document.getElementById('btnOpenDisburseReview');
  const btnReset = document.getElementById('btnResetDisburseForm');
  const btnRefresh = document.getElementById('btnRefreshDisburse');
  const searchInput = document.getElementById('disbSearchInput');
  const filterSelect = document.getElementById('disbMaterialFilter');
  const sortSelect = document.getElementById('disbSortFilter');
  const pageSizeSelect = document.getElementById('disbPageSize');
  const qtyInput = document.getElementById('disbQuantityInput');

  if (btnReview) {
    btnReview.addEventListener('click', handleOpenReviewModal);
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      setTimeout(() => {
        const previewWrap = document.getElementById('disbStockPreviewWrap');
        const warning = document.getElementById('disbStockWarning');
        const unitBadge = document.getElementById('disbUnitBadge');
        if (previewWrap) previewWrap.style.display = 'none';
        if (warning) warning.style.display = 'none';
        if (unitBadge) unitBadge.textContent = '--';
        hideBundleDisburseSection();
        initReferenceDisplay();
      }, 50);
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      rawMaterials = getSystemRawMaterials();
      loadDisbursements();
      populateMaterialSelects();
      renderKpis();
      renderHistoryTable();
      initReferenceDisplay();
      hideBundleDisburseSection();
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

  // Real-time calculation of Bundle Disburse allocation as user enters quantity
  if (qtyInput) {
    qtyInput.addEventListener('input', () => {
      const select = document.getElementById('disbMaterialSelect');
      const warning = document.getElementById('disbStockWarning');
      const selOpt = select.options[select.selectedIndex];
      if (selOpt && selOpt.value && warning) {
        const curStock = parseFloat(selOpt.dataset.stock || 0);
        const val = parseFloat(qtyInput.value || 0);
        if (val > curStock) {
          warning.style.display = 'block';
        } else {
          warning.style.display = 'none';
        }
      }
      updateBundleDisbursePreview();
    });
  }
}

// ============================================================================
// BUNDLE DISBURSE LOGIC: RECOGNIZE FINISHED PRODUCTS & PRODUCTION IMPACT
// ============================================================================

function matchProductIngredient(ingredientName, selectedMaterialName) {
  const ing = String(ingredientName || '').toLowerCase().trim();
  const sel = String(selectedMaterialName || '').toLowerCase().trim();
  if (!ing || !sel) return false;
  if (ing === sel) return true;
  if (ing.includes(sel) || sel.includes(ing)) return true;

  // Normalize slashes, hyphens, and punctuation: e.g. "all-purpose / bread flour"
  const cleanStr = (s) => s.replace(/[\/\(\)\-_,&]/g, ' ').replace(/\s+/g, ' ').trim();
  const ingClean = cleanStr(ing);
  const selClean = cleanStr(sel);
  if (ingClean === selClean) return true;
  if (ingClean.includes(selClean) || selClean.includes(ingClean)) return true;

  // Token matching: check word overlap
  const stopWords = new Set(['and', 'with', 'the', 'for', 'in', 'of', 'powder', 'refined', 'fresh', 'pure', 'special', 'classic']);
  const ingTokens = ingClean.split(' ').filter(t => t.length > 2 && !stopWords.has(t));
  const selTokens = selClean.split(' ').filter(t => t.length > 2 && !stopWords.has(t));
  if (ingTokens.some(t => selTokens.includes(t))) return true;

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

const LEGACY_KXC_PRODUCT_NAMES = new Set([
  'shing-a-ling', 'toasty biscocho', 'apas bread', 'lengua de gato', 'biscocho chips',
  'coco jam', 'chili garlic sauce', 'spicy crunchy garlic', 'cheesy cassava chips',
  'sweet banana chips', 'sweet potato chips', 'chiton seafood chicharon', 'crispy bite chicharon',
  'dried kabasi', 'salted banana chips', 'crispy bite ficharon', 'crispy pinipig peanut',
  'fluffy crumbs meringue', 'dried sapsap', 'pure ube halaya', 'atsara', 'bukayo balls',
  'ube balls', 'crunchy peanut butter', 'chicharon (chiton)', 'binayong hipon',
  'crispy bucheron', 'sugar-glazed banana chips', 'crispy cassava chips',
  'special broas (ladyfingers)', 'camote delight', 'classic ensaymada', 'pan de sal special',
  'ube halaya pastries', 'chocolate crinkles', 'toasted pastillas', 'coconut macaroons',
  'cheese cupcakes', 'biscocho crisps', 'otap sugar biscuits', 'yema custard tarts',
  'polvoron gold selection', 'banana loaf cake', 'pianono roll', 'spanish bread',
  'butter toast crackers'
]);

function isLegacyKxcProduct(name) {
  if (!name) return false;
  const n = String(name).toLowerCase().trim();
  return LEGACY_KXC_PRODUCT_NAMES.has(n);
}

function getFinishedProductsForMaterial(materialName) {
  if (!materialName) return [];

  // Exclude legacy KXC products; recognize all user-created formulations across storage keys
  let catalog = [];
  const storageKeys = ['rmims_custom_finished_products', 'RMSME_CUSTOM_FINISHED_PRODUCTS', 'rmims_finished_product_context'];
  storageKeys.forEach(k => {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(cp => {
            const isCustom = Boolean(cp.recipeDetails || cp.id || cp.date_added || cp.date_modified);
            if (cp && cp.name && (isCustom || !isLegacyKxcProduct(cp.name)) && !catalog.some(p => p.name.toLowerCase() === cp.name.toLowerCase())) {
              const materialNames = Array.isArray(cp.materialNames)
                ? cp.materialNames
                : (Array.isArray(cp.raw_materials)
                    ? cp.raw_materials.map(r => (typeof r === 'object' && r ? (r.name || r.raw_material_name || r.materialName || '') : r))
                    : (Array.isArray(cp.materials)
                        ? cp.materials.map(m => (typeof m === 'object' && m ? (m.name || m.raw_material_name || m.materialName || '') : m))
                        : (Array.isArray(cp.ingredients)
                            ? cp.ingredients.map(i => (typeof i === 'object' && i ? (i.name || i.raw_material_name || i.materialName || '') : i))
                            : [])));
              catalog.push({
                name: cp.name,
                materialNames: materialNames.filter(Boolean),
                recipeDetails: cp.recipeDetails || {}
              });
            }
          });
        }
      }
    } catch (e) {}
  });

  const results = [];
  catalog.forEach(product => {
    const matchedIng = (product.materialNames || []).find(ing => matchProductIngredient(ing, materialName));
    if (matchedIng) {
      // Find ratio for this ingredient: check customized recipe input first
      const customNeed = product.recipeDetails && product.recipeDetails[matchedIng]?.needPerUnit !== undefined
        ? Number(product.recipeDetails[matchedIng].needPerUnit)
        : null;

      const isSconesRatio = Object.prototype.hasOwnProperty.call(BASELINE_BOM_RATIOS, matchedIng) && BASELINE_BOM_RATIOS[matchedIng] > 1;
      const ratio = (customNeed && customNeed > 0) ? customNeed : (BASELINE_BOM_RATIOS[matchedIng] || (
        isSconesRatio ? 100 :
        materialName.toLowerCase().includes('sugar') || materialName.toLowerCase().includes('flour') ? 0.25 :
        materialName.toLowerCase().includes('oil') ? 0.08 :
        materialName.toLowerCase().includes('salt') ? 0.015 : 0.15
      ));
      // Standard batch target is 50 finished product units
      const standardBatchUnits = 50;
      const neededStock = Math.max(0.1, Math.round(ratio * standardBatchUnits * 10) / 10);
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

function updateBundleDisbursePreview() {
  const select = document.getElementById('disbMaterialSelect');
  const qtyInput = document.getElementById('disbQuantityInput');
  const bundleSection = document.getElementById('disbBundleSection');
  const bundleTitle = document.getElementById('disbBundleTitle');
  const bundleBadge = document.getElementById('disbBundleCountBadge');
  const productsGrid = document.getElementById('disbBundleProductsGrid');

  if (!select || !bundleSection || !productsGrid) return;

  const selOpt = select.options[select.selectedIndex];
  if (!selOpt || !selOpt.value) {
    hideBundleDisburseSection();
    return;
  }

  const rawMatName = selOpt.dataset.name || selOpt.text || selOpt.textContent || '';
  const matName = rawMatName.replace(/\s*\([A-Z0-9\-_]+\)\s*-\s*Current:.*$/i, '').trim();
  const unit = selOpt.dataset.unit || '';
  const qty = parseFloat(qtyInput ? qtyInput.value : 0) || 0;

  const matchedProducts = getFinishedProductsForMaterial(matName);

  bundleSection.style.display = 'block';
  if (bundleTitle) {
    bundleTitle.textContent = `Linked Finished Products (${matName})`;
  }

  if (matchedProducts.length === 0) {
    if (bundleBadge) {
      bundleBadge.textContent = '0 products linked';
    }
    productsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 14px 16px; background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 8px; text-align: center; color: #64748B; font-size: 12.5px;">
        <span style="font-size: 15px; margin-right: 5px;">📦</span>
        No custom finished product formulations are linked to <strong>${escapeHtml(matName)}</strong> yet.
        <div style="font-size: 11px; color: #94A3B8; margin-top: 3px;">
          Formulations created in Finished Products setup will automatically calculate batch consumption and impact here.
        </div>
      </div>
    `;
    return;
  }

  if (bundleBadge) {
    bundleBadge.textContent = `${matchedProducts.length} recognized product${matchedProducts.length > 1 ? 's' : ''}`;
  }

  // Distribute / Cascade outward quantity across the matched finished products
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
      statusText = 'Partial Requirement';
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
      <div class="rec-product-card ${statusClass}" data-product="${escapeHtml(p.productName)}" style="cursor:pointer;" title="Click to use as disbursement purpose">
        <div class="rec-product-card-top">
          <span class="rec-product-name">${escapeHtml(p.productName)}</span>
          <span class="rec-badge-tag ${tagClass}">${statusText}</span>
        </div>
        <div class="rec-product-stats">
          <span class="rec-req-label">Batch Requirement:</span>
          <span class="rec-req-val">${needed}${unit ? ' ' + unit : ''}</span>
        </div>
        <div class="rec-product-stats" style="margin-top:-2px;">
          <span class="rec-req-label">Disbursed Allocation:</span>
          <span class="${numClass}">${allocated > 0 ? '+' + allocated.toFixed(1) : '0.0'}${unit ? ' ' + unit : ''} (${pct}%)</span>
        </div>
        <div class="rec-bar-wrap">
          <div class="rec-bar-fill ${fillClass}" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  }).join('');

  productsGrid.innerHTML = cardsHtml;

  // Add click to fill notes / purpose
  productsGrid.querySelectorAll('.rec-product-card').forEach(card => {
    card.addEventListener('click', () => {
      const prodName = card.dataset.product;
      const notesEl = document.getElementById('disbNotesInput');
      if (notesEl && prodName) {
        notesEl.value = `${prodName} Batch`;
      }
    });
  });
}

function hideBundleDisburseSection() {
  const bundleSection = document.getElementById('disbBundleSection');
  const productsGrid = document.getElementById('disbBundleProductsGrid');
  if (bundleSection) bundleSection.style.display = 'none';
  if (productsGrid) productsGrid.innerHTML = '';
}

// ============================================================================
// REVIEW MODAL & STOCK DEDUCTION (LESSENS MATERIALS)
// ============================================================================

function handleOpenReviewModal() {
  const select = document.getElementById('disbMaterialSelect');
  const qtyInput = document.getElementById('disbQuantityInput');
  const dateInput = document.getElementById('disbDateInput');
  const notesInput = document.getElementById('disbNotesInput');

  if (!select.value) {
    alert('Please select a raw material to disburse.');
    select.focus();
    return;
  }

  const qty = parseFloat(qtyInput.value);
  if (isNaN(qty) || qty <= 0) {
    alert('Please enter a valid positive quantity to disburse.');
    qtyInput.focus();
    return;
  }

  const selOpt = select.options[select.selectedIndex];
  const unit = selOpt.dataset.unit || '';
  const curStock = parseFloat(selOpt.dataset.stock || 0);
  const minStock = parseFloat(selOpt.dataset.min || 10);
  const newStock = Math.max(0, curStock - qty);
  const ref = document.getElementById('mgrDisbRefDisplay').textContent.trim();

  // SECTION 8, 9, 10: Reference Duplicate Check (Reference is the ONLY basis for duplicate detection)
  const dupCheck = checkReferenceDuplicate(ref);
  if (dupCheck.isDuplicate) {
    showDuplicateWarningModal({
      refNumber: ref,
      existingTransaction: dupCheck.existingTransaction,
      onCancel: () => {},
      onRefresh: () => {
        document.getElementById('mgrDisburseForm').reset();
        document.getElementById('disbStockPreviewWrap').style.display = 'none';
        const unitBadge = document.getElementById('disbUnitBadge');
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

  // Automatically determine production purpose from matched bundle products
  const rawDisbMatName = selOpt.dataset.name || selOpt.text || selOpt.textContent || '';
  const cleanDisbMatName = rawDisbMatName.replace(/\s*\([A-Z0-9\-_]+\)\s*-\s*Current:.*$/i, '').trim();
  const matchedProds = getFinishedProductsForMaterial(cleanDisbMatName);
  const usedFor = matchedProds.length > 0 
    ? (matchedProds.length === 1 ? `${matchedProds[0].productName} Batch` : `${matchedProds[0].productName} (+${matchedProds.length - 1} products)`)
    : (notesInput && notesInput.value.trim() ? notesInput.value.trim() : 'Production Batch');

  currentPendingDisburse = {
    ref,
    materialId: select.value,
    materialName: selOpt.dataset.name,
    quantity: qty,
    unit,
    curStock,
    newStock,
    minStock,
    date: formattedDateTime,
    time: timeStr,
    usedFor,
    notes: notesInput ? notesInput.value.trim() || 'Production batch consumption' : 'Production batch consumption'
  };

  // Populate Review Modal
  document.getElementById('revDisbRefVal').textContent = currentPendingDisburse.ref;
  document.getElementById('revDisbMaterialVal').textContent = `${currentPendingDisburse.materialName} (${currentPendingDisburse.materialId})`;
  document.getElementById('revDisbCurStockVal').textContent = unit ? `${curStock} ${unit}` : `${curStock}`;
  document.getElementById('revDisbOutwardQtyVal').textContent = unit ? `-${qty} ${unit}` : `-${qty}`;
  document.getElementById('revDisbNewStockVal').textContent = unit ? `${newStock} ${unit}` : `${newStock}`;
  const usedForValEl = document.getElementById('revDisbUsedForVal');
  if (usedForValEl) usedForValEl.textContent = currentPendingDisburse.usedFor;
  document.getElementById('revDisbDateVal').textContent = currentPendingDisburse.date;
  document.getElementById('revDisbNotesVal').textContent = currentPendingDisburse.notes;

  // Threshold alert check
  const alertBox = document.getElementById('revDisbThresholdAlert');
  if (alertBox) {
    if (newStock < minStock) {
      alertBox.style.display = 'flex';
      alertBox.querySelector('span').innerHTML = `<strong>Alert:</strong> Projected stock (${newStock}${unit ? ' ' + unit : ''}) falls below minimum threshold (${minStock}${unit ? ' ' + unit : ''})!`;
    } else {
      alertBox.style.display = 'none';
    }
  }

  const modal = document.getElementById('mgrDisburseReviewModal');
  if (modal) modal.classList.add('open');
}

function bindReviewModalEvents() {
  const modal = document.getElementById('mgrDisburseReviewModal');
  const btnClose = document.getElementById('btnCloseDisburseReview');
  const btnCancel = document.getElementById('btnCancelDisburseReview');
  const btnConfirm = document.getElementById('btnConfirmDisburse');

  const closeModal = () => {
    if (modal) modal.classList.remove('open');
  };

  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  if (btnConfirm) {
    btnConfirm.addEventListener('click', () => {
      if (!currentPendingDisburse) return;

      const p = currentPendingDisburse;

      // 1. Update raw material stock in system-materials (DEDUCTS / LESSENS MATERIALS)
      const mat = rawMaterials.find(m => String(m.id) === String(p.materialId) || String(m.item_code) === String(p.materialId));
      if (mat) {
        mat.current_stock = p.newStock;
        mat.last_updated = new Date().toISOString();
        saveCustomRawMaterial(mat);
      }
      updateMaterialActivityTimestamp(p.materialId || p.materialName, new Date().toISOString(), 'Disburse', p.quantity, p.unit);
      saveRawMaterialToSupabase({
        id: p.materialId,
        item_code: p.materialId,
        name: p.materialName,
        raw_material_name: p.materialName,
        current_stock: p.newStock,
        unit: p.unit
      }).catch(err => console.warn('[Disburse] Supabase stock upsert notice:', err));

      // Also ensure custom raw materials list reflects the reduced stock
      try {
        const customMats = JSON.parse(localStorage.getItem('rmims_custom_raw_materials') || '[]');
        const idx = customMats.findIndex(m => String(m.id) === String(p.materialId) || String(m.item_code) === String(p.materialId));
        if (idx !== -1) {
          customMats[idx].current_stock = p.newStock;
          customMats[idx].last_updated = new Date().toISOString();
          localStorage.setItem('rmims_custom_raw_materials', JSON.stringify(customMats));
        }
      } catch (e) {}

      // 2. Persist to system disbursements
      saveCustomDisbursement({
        id: p.ref,
        material_id: p.materialId,
        material_name: p.materialName,
        consumed_quantity: p.quantity,
        unit: p.unit,
        usage_date: p.date,
        activity_type: 'Production Usage',
        finished_product_name: p.usedFor,
        recorded_by: 'Store Manager'
      });

      // 3. Persist to manager disbursements ledger with exact delivery time
      const record = {
        ref: p.ref,
        date: p.date,
        materialId: p.materialId,
        materialName: p.materialName,
        quantity: p.quantity,
        unit: p.unit,
        usedFor: p.usedFor,
        recordedBy: 'Store Manager',
        status: 'Approved',
        notes: p.notes
      };

      managerDisbursements.unshift(record);
      saveDisbursements();

      // 4. Record into manager activities with full branch & user provenance
      try {
        const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
        const actRaw = localStorage.getItem('rmims_manager_activities');
        const acts = actRaw ? JSON.parse(actRaw) : [];
        acts.unshift({
          datetime: p.date,
          timestamp: new Date().toISOString(),
          activity: `Disburse Raw Material: -${p.quantity} ${p.unit} ${p.materialName} (${p.usedFor})`,
          reference: p.ref,
          status: 'Approved',
          user: curUser.name || curUser.fullName || curUser.username || 'Manager',
          role: curUser.role || 'Manager',
          branchLoc: curUser.branchLoc || curUser.location || '',
          branchName: curUser.branchName || curUser.branch || '',
          action: 'Disbursed',
          module: 'Inventory'
        });
        localStorage.setItem('rmims_manager_activities', JSON.stringify(acts));
      } catch (e) {}

      // Broadcast live notification across all roles (Admin, Manager, Staff)
      try {
        if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
          window.pushRMIMSNotification({
            title: `Raw Material Disbursed: ${p.materialName}`,
            message: `Disbursement of ${p.quantity} ${p.unit} of ${p.materialName} for ${p.usedFor} recorded (${p.ref}).`,
            category: 'Inventory',
            badge: 'Disbursed',
            role: 'manager',
            targetRole: 'manager',
            roleScope: 'manager',
            priority: 'normal',
            targetUrl: 'manager/disburse.html',
            ref: p.ref,
            material: p.materialName,
            quantity: `${p.quantity} ${p.unit}`,
            actor: 'Store Manager',
            productName: p.usedFor
          });
        }
      } catch (e) {}

      // 5. Commit directly to Supabase and broadcast cross-module sync
      recordMaterialDisbursementToSupabase(p).catch(err => console.warn('[Disburse] Supabase sync notice:', err));
      broadcastManagerSync({
        action: 'disburse',
        ref: p.ref,
        material: p.materialName,
        quantity: p.quantity,
        unit: p.unit
      });

      // Close modal and show feedback
      closeModal();

      // Reset form & generate new reference number
      document.getElementById('mgrDisburseForm').reset();
      const previewWrap = document.getElementById('disbStockPreviewWrap');
      const warning = document.getElementById('disbStockWarning');
      if (previewWrap) previewWrap.style.display = 'none';
      if (warning) warning.style.display = 'none';
      hideBundleDisburseSection();

      rawMaterials = getSystemRawMaterials();
      populateMaterialSelects();
      initReferenceDisplay();
      renderKpis();
      currentLedgerPage = 1;
      renderHistoryTable();

      alert(`✓ Material disbursed successfully!\n${p.quantity} ${p.unit} of ${p.materialName} deducted for ${p.usedFor} (Ref: ${p.ref}).`);
      currentPendingDisburse = null;
    });
  }
}

function renderKpis() {
  const todayCountEl = document.getElementById('kpiDisbToday');
  const monthCountEl = document.getElementById('kpiDisbMonth');
  const totalCountEl = document.getElementById('kpiDisbTotalCount');
  const topTargetEl = document.getElementById('kpiDisbTopTarget');

  const totalDisb = managerDisbursements.length;
  if (totalCountEl) totalCountEl.textContent = totalDisb;

  let todayKg = 0;
  let monthKg = 0;
  const targetSums = {};

  managerDisbursements.forEach(d => {
    const q = Number(d.quantity || 0);
    const target = d.usedFor || 'General Use';
    targetSums[target] = (targetSums[target] || 0) + q;

    if (String(d.date).includes('Today')) {
      todayKg += q;
    }
    monthKg += q;
  });

  if (todayCountEl) todayCountEl.textContent = todayKg.toLocaleString();
  if (monthCountEl) monthCountEl.textContent = monthKg.toLocaleString();

  let topTarget = '--';
  let maxQty = 0;
  Object.keys(targetSums).forEach(t => {
    if (targetSums[t] > maxQty) {
      maxQty = targetSums[t];
      topTarget = t;
    }
  });

  if (topTargetEl) topTargetEl.textContent = topTarget;
  const topTargetSubEl = document.getElementById('kpiDisbTopTargetSub');
  if (topTargetSubEl) {
    topTargetSubEl.textContent = maxQty > 0 ? `${maxQty.toLocaleString()} units consumed` : '--';
  }
}

// ============================================================================
// HISTORY LEDGER WITH PAGINATION, SORTING & TIME DISPLAY
// ============================================================================

function renderHistoryTable() {
  const tbody = document.getElementById('mgrDisburseHistoryTbody');
  const countEl = document.getElementById('disbLedgerCount');
  const paginationControls = document.getElementById('disbPaginationBtns');
  const search = (document.getElementById('disbSearchInput')?.value || '').toLowerCase().trim();
  const matFilter = document.getElementById('disbMaterialFilter')?.value || 'all';
  const sortOrder = document.getElementById('disbSortFilter')?.value || 'latest';

  if (!tbody) return;

  // 1. Filter
  let filtered = managerDisbursements.filter(d => {
    if (matFilter !== 'all' && d.materialName !== matFilter) return false;
    if (search) {
      const match = (d.ref || '').toLowerCase().includes(search) ||
                    (d.materialName || '').toLowerCase().includes(search) ||
                    (d.usedFor || '').toLowerCase().includes(search) ||
                    (d.notes || '').toLowerCase().includes(search);
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
      const pA = parseSafeDate(a.date) || parseSafeDate(a.usage_date) || parseSafeDate(a.created_at);
      const pB = parseSafeDate(b.date) || parseSafeDate(b.usage_date) || parseSafeDate(b.created_at);
      const dateA = pA ? pA.getTime() : 0;
      const dateB = pB ? pB.getTime() : 0;
      if (dateA !== dateB) return dateA - dateB;
      const numA = parseInt(String(a.ref || '').replace(/\D+/g, ''), 10) || 0;
      const numB = parseInt(String(b.ref || '').replace(/\D+/g, ''), 10) || 0;
      if (numA !== numB) return numA - numB;
      return (a.ref || '').localeCompare(b.ref || '');
    } else {
      // Default: latest first (newest timestamp / date first)
      const pA = parseSafeDate(a.date) || parseSafeDate(a.usage_date) || parseSafeDate(a.created_at);
      const pB = parseSafeDate(b.date) || parseSafeDate(b.usage_date) || parseSafeDate(b.created_at);
      const dateA = pA ? pA.getTime() : 0;
      const dateB = pB ? pB.getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      const numA = parseInt(String(a.ref || '').replace(/\D+/g, ''), 10) || 0;
      const numB = parseInt(String(b.ref || '').replace(/\D+/g, ''), 10) || 0;
      if (numB !== numA) return numB - numA;
      return (b.ref || '').localeCompare(a.ref || '');
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center; padding:36px 16px; color:#5C7A68; font-size:13px;">
          <div style="font-weight:700; color:#0F2A1B; margin-bottom:4px;">No disbursements recorded yet</div>
          <div style="font-size:12px; color:#94A3B8;">Outward raw material usage recorded for production will appear here automatically.</div>
        </td>
      </tr>
    `;
    if (countEl) countEl.textContent = 'Showing 0 disbursements';
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
      countEl.textContent = 'Showing 0 of 0 disbursements';
    } else {
      countEl.textContent = `Showing ${startIdx + 1} to ${endIdx} of ${totalItems} disbursements`;
    }
  }

  if (totalItems === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center; padding:32px; color:#64748B;">
          No disbursement transactions found matching criteria.
        </td>
      </tr>
    `;
    renderPaginationButtons(paginationControls, 0, 0);
    return;
  }

  // 4. Render rows with separate Date and Time cells
  tbody.innerHTML = pageItems.map(d => {
    const dateStr = String(d.date || '');
    let datePart = dateStr;
    let timePart = '9:40 AM';

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
        <td><span class="mgr-ref-pill">${escapeHtml(d.ref)}</span></td>
        <td>
          <span class="mgr-date-text" style="font-weight:600; color:#1E293B; font-size:12.5px;">${escapeHtml(datePart)}</span>
        </td>
        <td>
          <span class="mgr-time-text" style="font-size:12px; color:#B45309; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${escapeHtml(timePart)}
          </span>
        </td>
        <td><strong>${escapeHtml(d.materialName)}</strong></td>
        <td><span class="mgr-qty-delta disburse">-${d.quantity} ${escapeHtml(d.unit)}</span></td>
        <td style="color:#334155; font-weight:600;">${escapeHtml(d.usedFor || 'Production Batch')}</td>
        <td style="font-size:12px; color:#475569;">${escapeHtml(d.recordedBy || 'Store Manager')}</td>
        <td><span class="mgr-status-pill status-approved">Approved</span></td>
        <td style="color:#64748B; font-size:12px; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(d.notes || '')}">
          ${escapeHtml(d.notes || '-')}
        </td>
        <td style="text-align:right; white-space:nowrap;">
          <button type="button" class="btn-mgr-edit-disb" data-ref="${escapeHtml(d.ref)}" title="Edit disbursement" style="background:#FFFBEB; border:1px solid #FDE68A; color:#B45309; padding:4px 8px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; margin-right:4px;">
            ✏️ Edit
          </button>
          <button type="button" class="btn-mgr-del-disb" data-ref="${escapeHtml(d.ref)}" title="Delete disbursement" style="background:#FEF2F2; border:1px solid #FECACA; color:#DC2626; padding:4px 8px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;">
            🗑️ Delete
          </button>
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
    <button type="button" class="page-btn ${currentLedgerPage <= 1 ? 'disabled' : ''}" id="btnDisbPrev" ${currentLedgerPage <= 1 ? 'disabled' : ''} title="Previous Page">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
  `;

  for (let p = 1; p <= Math.max(1, totalPages); p++) {
    html += `
      <button type="button" class="page-btn ${p === currentLedgerPage ? 'active' : ''}" data-page="${p}">
        ${p}
      </button>
    `;
  }

  html += `
    <button type="button" class="page-btn ${currentLedgerPage >= totalPages ? 'disabled' : ''}" id="btnDisbNext" ${currentLedgerPage >= totalPages ? 'disabled' : ''} title="Next Page">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  `;

  container.innerHTML = html;

  // Bind pagination events
  const btnPrev = container.querySelector('#btnDisbPrev');
  const btnNext = container.querySelector('#btnDisbNext');

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (currentLedgerPage > 1) {
        currentLedgerPage--;
        renderHistoryTable();
      }
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (currentLedgerPage < totalPages) {
        currentLedgerPage++;
        renderHistoryTable();
      }
    });
  }

  container.querySelectorAll('button[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentLedgerPage = parseInt(btn.dataset.page, 10);
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

let pendingDeleteDisbursementRef = null;

function bindDisbursementActionEvents() {
  // Global document-level click delegation for Edit and Delete buttons
  document.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-mgr-edit-disb');
    if (editBtn) {
      e.preventDefault();
      e.stopPropagation();
      const ref = editBtn.dataset.ref;
      if (ref) openEditDisbursementModal(ref);
      return;
    }

    const delBtn = e.target.closest('.btn-mgr-del-disb');
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      const ref = delBtn.dataset.ref;
      if (ref) openDeleteDisbursementModal(ref);
      return;
    }
  });

  // Edit modal buttons
  const editModal = document.getElementById('mgrEditDisbModal');
  const btnCloseEdit = document.getElementById('btnCloseEditDisb');
  const btnCancelEdit = document.getElementById('btnCancelEditDisb');
  const formEdit = document.getElementById('mgrEditDisbForm');

  const closeEditModal = () => {
    if (editModal) {
      editModal.style.display = 'none';
      editModal.classList.remove('open', 'active');
    }
  };

  if (btnCloseEdit) btnCloseEdit.addEventListener('click', closeEditModal);
  if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);

  if (formEdit) {
    formEdit.addEventListener('submit', (e) => {
      e.preventDefault();
      const ref = (document.getElementById('editDisbRef')?.value || '').trim();
      const quantity = parseFloat(document.getElementById('editDisbQty')?.value);
      const usedFor = (document.getElementById('editDisbUsedFor')?.value || '').trim();
      const notes = (document.getElementById('editDisbNotes')?.value || '').trim();

      if (isNaN(quantity) || quantity <= 0) {
        alert('Please enter a valid positive quantity.');
        return;
      }
      if (!usedFor) {
        alert('Please specify the production target or purpose.');
        return;
      }

      const res = updateManagerDisbursement(ref, {
        quantity,
        usedFor,
        notes
      });

      if (res && res.success) {
        closeEditModal();
        rawMaterials = getSystemRawMaterials();
        loadDisbursements();
        renderKpis();
        renderHistoryTable();
        alert(`✓ Disbursement ${ref} updated successfully.`);
      } else {
        alert('Error updating disbursement: ' + (res?.message || 'Unknown error'));
      }
    });
  }

  // Delete modal buttons
  const delModal = document.getElementById('mgrDeleteDisbModal');
  const btnCloseDel = document.getElementById('btnCloseDeleteDisb');
  const btnCancelDel = document.getElementById('btnCancelDeleteDisb');
  const btnConfirmDel = document.getElementById('btnConfirmDeleteDisb');

  const closeDelModal = () => {
    pendingDeleteDisbursementRef = null;
    if (delModal) {
      delModal.style.display = 'none';
      delModal.classList.remove('open', 'active');
    }
  };

  if (btnCloseDel) btnCloseDel.addEventListener('click', closeDelModal);
  if (btnCancelDel) btnCancelDel.addEventListener('click', closeDelModal);

  if (btnConfirmDel) {
    btnConfirmDel.addEventListener('click', () => {
      if (!pendingDeleteDisbursementRef) return;
      const ref = pendingDeleteDisbursementRef;
      deleteMaterialDisbursementOnSupabase(ref).catch(() => {});
      const res = deleteManagerDisbursement(ref);
      if (res && res.success) {
        closeDelModal();
        rawMaterials = getSystemRawMaterials();
        loadDisbursements();
        renderKpis();
        renderHistoryTable();
        alert(`✓ Disbursement ${ref} deleted and outward stock restored.`);
      } else {
        alert('Error deleting disbursement: ' + (res?.message || 'Unknown error'));
      }
    });
  }
}

function findDisbursementRecord(ref) {
  if (!ref) return null;
  const cleanRef = String(ref).trim().toLowerCase();
  let disb = managerDisbursements.find(d => String(d.ref || '').trim().toLowerCase() === cleanRef);
  if (disb) return disb;

  try {
    const raw = localStorage.getItem(MGR_DISBURSEMENTS_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      disb = list.find(d => String(d.ref || '').trim().toLowerCase() === cleanRef);
      if (disb) return disb;
    }
  } catch (_) {}

  try {
    const rawStaff = localStorage.getItem('rmims_staff_transactions');
    if (rawStaff) {
      const staffList = JSON.parse(rawStaff);
      const st = staffList.find(t => String(t.ref || '').trim().toLowerCase() === cleanRef);
      if (st) {
        return {
          ref: st.ref,
          materialName: st.material || st.materialName || 'Raw Material',
          materialId: st.materialId || st.item_code || '',
          quantity: st.quantity != null ? st.quantity : (st.qtyNum != null ? st.qtyNum : parseFloat(st.qty) || 0),
          unit: st.unit || 'kg',
          usedFor: st.usedFor || st.recipient || 'Production Department',
          notes: st.notes || ''
        };
      }
    }
  } catch (_) {}

  return null;
}

function openEditDisbursementModal(ref) {
  const disb = findDisbursementRecord(ref);
  if (!disb) {
    alert(`Disbursement record ${ref} could not be located.`);
    return;
  }

  const modal = document.getElementById('mgrEditDisbModal');
  if (!modal) return;

  const mat = rawMaterials.find(m => 
    String(m.id || '').trim().toLowerCase() === String(disb.materialId || '').trim().toLowerCase() || 
    String(m.item_code || '').trim().toLowerCase() === String(disb.materialId || '').trim().toLowerCase() || 
    (m.name || '').toLowerCase() === (disb.materialName || '').toLowerCase()
  );
  const fallbackUnit = mat ? (mat.unit_of_measure || mat.unit) : '';

  const elRef = document.getElementById('editDisbRef');
  const elRefDisp = document.getElementById('editDisbRefDisplay');
  const elMat = document.getElementById('editDisbMaterial');
  const elQty = document.getElementById('editDisbQty');
  const elUnit = document.getElementById('editDisbUnit');
  const elUsed = document.getElementById('editDisbUsedFor');
  const elNotes = document.getElementById('editDisbNotes');

  if (elRef) elRef.value = disb.ref || '';
  if (elRefDisp) elRefDisp.value = disb.ref || '';
  if (elMat) elMat.value = `${disb.materialName || 'Raw Material'}${disb.materialId ? ` (${disb.materialId})` : ''}`;
  if (elQty) elQty.value = disb.quantity != null ? disb.quantity : '';
  if (elUnit) elUnit.value = disb.unit || fallbackUnit || '--';
  if (elUsed) elUsed.value = disb.usedFor || disb.recipient || '';
  if (elNotes) elNotes.value = disb.notes || '';

  modal.style.display = 'flex';
  modal.style.visibility = 'visible';
  modal.style.opacity = '1';
  modal.classList.add('open', 'active');
  modal.removeAttribute('hidden');
}

function openDeleteDisbursementModal(ref) {
  const disb = findDisbursementRecord(ref);
  if (!disb) {
    alert(`Disbursement record ${ref} could not be located.`);
    return;
  }

  pendingDeleteDisbursementRef = ref;
  const modal = document.getElementById('mgrDeleteDisbModal');
  const codeEl = document.getElementById('deleteDisbRefCode');
  const warnEl = document.getElementById('deleteDisbStockWarning');

  if (codeEl) codeEl.textContent = ref;
  if (warnEl) {
    warnEl.textContent = `⚠️ Warning: Deleting this disbursement will return +${disb.quantity} ${disb.unit || 'units'} back into "${disb.materialName}" stock.`;
  }

  if (modal) {
    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.classList.add('open', 'active');
    modal.removeAttribute('hidden');
  }
}

window.openEditDisbursementModal = openEditDisbursementModal;
window.openDeleteDisbursementModal = openDeleteDisbursementModal;

