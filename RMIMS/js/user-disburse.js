/**
 * RMIMS Staff Disburse Logic
 * Implements Section 6, 7, 8, 9, 10, 11, 12, 13, 14:
 * - System-generated unique reference number (DIS-2026-XXXXX)
 * - Reference is non-editable, non-reusable
 * - 2-Step Workflow: Enter Information -> Review -> Reference Check -> Submit
 * - Reference Number is the ONLY basis for duplicate detection
 * - Duplicate warning modal with Cancel / Refresh Form
 * - Submission creates a Pending transaction sent to Manager for verification
 * - Official inventory is NOT updated yet
 */

import { getSystemRawMaterials } from './system-materials.js';
import { AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from './authentic-finished-products.js';
import {
  generateNextReference,
  checkReferenceDuplicate,
  showDuplicateWarningModal,
  submitStaffTransaction,
  getStaffTransactions,
  burnReference,
  updateStaffTransaction,
  deleteStaffTransaction
} from './rmims-transaction-engine.js';

// Authentic Bill of Materials (BOM) standard ratios (g/pcs/kl for Scones; kg/L for KXC)
const BASELINE_BOM_RATIOS = {
  // Authoritative Scones & Muffins Bakery (19 Nutribun Raw Materials) Ratios
  "All-Purpose / Bread Flour": 250,
  "Refined White Sugar": 100,
  "Fresh Yellow Squash (Kalabasa)": 350,
  "Full Cream Evaporated Milk": 80,
  "Skimmed Milk Powder": 80,
  "Condensed Milk": 100,
  "Fresh Whole Eggs": 1, // 1 pc
  "Baking Shortening": 80,
  "Pure Vegetable Shortening": 80,
  "Margarine": 80,
  "Bakery Margarine": 80,
  "Instant Dry Yeast": 15,
  "Baking Soda": 10,
  "Pure Food-Grade Baking Soda": 10,
  "Iodized Salt": 15,
  "Fine Iodized Table Salt": 15,
  "Bread Improver & Anti-Mold": 5,
  "Calcium Propionate": 5,
  "Potassium Sorbate": 5,
  "Crushed Peanuts / Nuts": 50,
  "Crushed Roasted Peanuts": 50,
  "Desiccated Coconut": 50,
  "Toasted Desiccated Coconut": 50,
  "Black Sesame Seeds": 20,
  "Natural Hulled White Sesame": 20,
  "Malunggay (Moringa) Flakes": 20,
  "Pure Moringa Powder": 20,
  "Vanilla Extract": 5,
  "Pure Liquid Vanilla Flavor": 5,
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

let rawMaterials = [];
let currentRef = '';
let currentReviewData = null;

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
  const select = document.getElementById('staffDisbMaterial');
  const qtyInput = document.getElementById('staffDisbQuantity');
  const bundleSection = document.getElementById('disbBundleSection');
  const bundleTitle = document.getElementById('disbBundleTitle');
  const bundleBadge = document.getElementById('disbBundleCountBadge');
  const productsGrid = document.getElementById('disbBundleProductsGrid');
  const stockWarning = document.getElementById('staffDisbStockWarning');

  if (!select || !bundleSection || !productsGrid) return;

  const selOpt = select.options[select.selectedIndex];
  if (!selOpt || !selOpt.value) {
    hideBundleDisburseSection();
    return;
  }

  const matName = selOpt.value;
  const unit = selOpt.dataset.unit || '';
  const qty = parseFloat(qtyInput ? qtyInput.value : 0) || 0;
  const currentStock = parseFloat(selOpt.dataset.stock || 0);

  if (stockWarning) {
    stockWarning.style.display = (qty > currentStock && currentStock > 0) ? 'block' : 'none';
  }

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
      <div class="rec-product-card ${statusClass}" data-product="${escapeHtml(p.productName)}" style="cursor:pointer;" title="Click to use in notes">
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

  // Add click to fill notes
  productsGrid.querySelectorAll('.rec-product-card').forEach(card => {
    card.addEventListener('click', () => {
      const prodName = card.dataset.product;
      const notesEl = document.getElementById('staffDisbNotes');
      if (notesEl && prodName) {
        notesEl.value = `${prodName} Batch`;
      }
    });
  });
}

function hideBundleDisburseSection() {
  const bundleSection = document.getElementById('disbBundleSection');
  const productsGrid = document.getElementById('disbBundleProductsGrid');
  const stockWarning = document.getElementById('staffDisbStockWarning');
  if (bundleSection) bundleSection.style.display = 'none';
  if (productsGrid) productsGrid.innerHTML = '';
  if (stockWarning) stockWarning.style.display = 'none';
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Returns the current logged-in staff info from the live session
function getLiveStaffInfo() {
  const candidates = ['currentUser', 'rmimsCurrentUser', 'userProfile', 'user'];
  for (const key of candidates) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const o = JSON.parse(raw);
      if (o && (o.fullName || o.name || o.email)) {
        return { name: o.fullName || o.name || '', email: o.email || '' };
      }
    } catch (_) {}
  }
  return { name: '', email: '' };
}

document.addEventListener('DOMContentLoaded', () => {
  rawMaterials = getSystemRawMaterials();
  populateMaterialSelect();
  initDatePicker();
  initNewReference();
  bindFormEvents();
  bindStaffDisbActionEvents();
  renderMySubmissions();

  // Cross-tab real-time sync
  const refreshDisburseState = () => {
    rawMaterials = getSystemRawMaterials();
    populateMaterialSelect();
    renderMySubmissions();
    updateBundleDisbursePreview();
  };

  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.includes('transactions') || e.key.includes('materials') || e.key.includes('finished') || e.key.includes('activity')) {
      refreshDisburseState();
    }
  });
  window.addEventListener('rmims_staff_transactions_updated', refreshDisburseState);
  window.addEventListener('rmims_inventory_updated', refreshDisburseState);
  window.addEventListener('rmims_finished_products_updated', () => {
    updateBundleDisbursePreview();
  });
});

function initNewReference() {
  currentRef = generateNextReference('DIS');
  const displayEl = document.getElementById('staffDisbRefDisplay');
  if (displayEl) displayEl.textContent = currentRef;
}

function initDatePicker() {
  const dateInput = document.getElementById('staffDisbDate');
  if (dateInput) {
    dateInput.value = new Date().toISOString().slice(0, 10);
    if (typeof flatpickr !== 'undefined') {
      flatpickr(dateInput, {
        defaultDate: new Date(),
        dateFormat: 'Y-m-d',
        maxDate: new Date(),
        allowInput: true
      });
    }
  }
}

function populateMaterialSelect() {
  const select = document.getElementById('staffDisbMaterial');
  if (!select) return;

  select.innerHTML = '<option value="">-- Choose Material to Disburse --</option>';
  rawMaterials.forEach(m => {
    const opt = document.createElement('option');
    const matName = m.name || m.materialName || m.raw_material_name || '';
    opt.value = matName;
    opt.dataset.name = matName;
    const unit = m.unit_of_measure || m.unit || '';
    opt.textContent = unit ? `${matName} (${m.category || 'General'} • ${unit})` : `${matName} (${m.category || 'General'})`;
    opt.dataset.unit = unit;
    opt.dataset.stock = m.current_stock ?? m.currentStock ?? m.stock ?? 0;
    opt.dataset.min = m.minimum_threshold ?? m.minimum_stock ?? m.minimumStock ?? 10;
    select.appendChild(opt);
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
    }
  } catch (_) {}

  // Trigger change to sync unit badge and preview
  select.dispatchEvent(new Event('change'));
}

function bindFormEvents() {
  const matSelect = document.getElementById('staffDisbMaterial');
  const qtyInput = document.getElementById('staffDisbQuantity');
  const unitBadge = document.getElementById('staffDisbUnitBadge');
  const unitSelect = document.getElementById('staffDisbUnit');
  const stockPreview = document.getElementById('staffDisbStockPreview');
  const stockVal = document.getElementById('previewDisbStockVal');
  const minVal = document.getElementById('previewDisbMinVal');

  if (matSelect) {
    matSelect.addEventListener('change', () => {
      const selected = matSelect.options[matSelect.selectedIndex];
      if (selected && selected.value) {
        const u = selected.dataset.unit || '';
        if (unitBadge) unitBadge.textContent = u || '--';
        if (unitSelect) {
          if (u && !Array.from(unitSelect.options).some(o => o.value === u)) {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            unitSelect.appendChild(opt);
          }
          unitSelect.value = u;
        }
        if (qtyInput) qtyInput.placeholder = u ? `e.g. 20 ${u}` : 'e.g. 20';
        if (stockPreview) stockPreview.style.display = 'block';
        if (stockVal) stockVal.textContent = u ? `${selected.dataset.stock} ${u}` : `${selected.dataset.stock}`;
        if (minVal) minVal.textContent = u ? `${selected.dataset.min} ${u}` : `${selected.dataset.min}`;
        updateBundleDisbursePreview();
      } else {
        if (stockPreview) stockPreview.style.display = 'none';
        if (unitBadge) unitBadge.textContent = '--';
        if (unitSelect) unitSelect.value = '';
        if (qtyInput) qtyInput.placeholder = 'e.g. 20';
        hideBundleDisburseSection();
      }
    });
  }

  if (qtyInput) {
    qtyInput.addEventListener('input', () => {
      updateBundleDisbursePreview();
    });
  }

  const btnReview = document.getElementById('btnOpenStaffDisbReview');
  if (btnReview) {
    btnReview.addEventListener('click', handleOpenReview);
  }

  const btnReset = document.getElementById('btnResetStaffDisb');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      setTimeout(() => {
        if (stockPreview) stockPreview.style.display = 'none';
        if (unitBadge) unitBadge.textContent = '--';
        if (unitSelect) unitSelect.value = '';
        hideBundleDisburseSection();
        initDatePicker();
      }, 50);
    });
  }

  const modal = document.getElementById('staffDisburseReviewModal');
  const btnClose = document.getElementById('btnCloseStaffDisbReview');
  const btnCancel = document.getElementById('btnCancelStaffDisbSubmit');
  const btnConfirm = document.getElementById('btnConfirmStaffDisbSubmit');

  const closeModal = () => {
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
    }
  };

  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  if (btnConfirm) {
    btnConfirm.addEventListener('click', handleConfirmSubmission);
  }
}

function handleOpenReview() {
  const matSelect = document.getElementById('staffDisbMaterial');
  const qtyInput = document.getElementById('staffDisbQuantity');
  const unitSelect = document.getElementById('staffDisbUnit');
  const dateInput = document.getElementById('staffDisbDate');
  const notesInput = document.getElementById('staffDisbNotes');

  const material = matSelect ? matSelect.value : '';
  const quantity = qtyInput ? parseFloat(qtyInput.value) : 0;
  const selectedOpt = matSelect && matSelect.selectedIndex >= 0 ? matSelect.options[matSelect.selectedIndex] : null;
  const unit = (selectedOpt && selectedOpt.dataset.unit) ? selectedOpt.dataset.unit : (unitSelect && unitSelect.value ? unitSelect.value : '');
  const date = dateInput ? dateInput.value : '';
  const notes = notesInput ? notesInput.value.trim() : '';

  if (!material) {
    alert('Please choose a raw material to disburse.');
    if (matSelect) matSelect.focus();
    return;
  }
  if (!quantity || quantity <= 0 || isNaN(quantity)) {
    alert('Please enter a valid positive quantity disbursed.');
    if (qtyInput) qtyInput.focus();
    return;
  }

  // Soft check for stock availability
  const currentStock = selectedOpt ? parseFloat(selectedOpt.dataset.stock || 0) : 0;
  if (quantity > currentStock) {
    const proceed = confirm(`Warning: The quantity entered (${quantity} ${unit}) exceeds currently recorded stock (${currentStock} ${unit}).\n\nDo you still wish to submit this disbursement for Manager review?`);
    if (!proceed) return;
  }

  if (!date) {
    alert('Please select the disbursement date.');
    if (dateInput) dateInput.focus();
    return;
  }

  // Derive usedFor / production purpose dynamically from matched bundle finished products
  const matchedProds = getFinishedProductsForMaterial(material);
  const usedFor = matchedProds.length > 0
    ? (matchedProds.length === 1 ? `${matchedProds[0].productName} Batch` : `${matchedProds[0].productName} (+${matchedProds.length - 1} products)`)
    : (notes || 'Production Batch');

  // =========================================================================
  // RULE #8, 9, 10: REFERENCE NUMBER CHECK (ONLY BASIS FOR DUPLICATE DETECTION)
  // =========================================================================
  const dupCheck = checkReferenceDuplicate(currentRef);
  if (dupCheck.isDuplicate) {
    showDuplicateWarningModal({
      refNumber: currentRef,
      existingTransaction: dupCheck.existingTransaction,
      onCancel: () => {
        // Return to disburse form, transaction not submitted
      },
      onRefresh: () => {
        // Section 11: Refresh Form
        // Form resets, old reference removed, system generates new reference
        document.getElementById('staffDisburseForm').reset();
        document.getElementById('staffDisbStockPreview').style.display = 'none';
        hideBundleDisburseSection();
        initDatePicker();
        initNewReference();
      }
    });
    return;
  }

  // Save current review data
  currentReviewData = {
    ref: currentRef,
    material,
    quantity,
    unit,
    usedFor,
    date,
    notes,
    activity: 'Disburse',
    staff: getLiveStaffInfo().name
  };

  // Populate Review Modal (Section 13)
  document.getElementById('revStaffDisbRef').textContent = currentRef;
  document.getElementById('revStaffDisbMaterial').textContent = material;
  document.getElementById('revStaffDisbQty').textContent = `-${quantity.toLocaleString()}${unit ? ' ' + unit : ''}`;
  document.getElementById('revStaffDisbUsedFor').textContent = usedFor;
  document.getElementById('revStaffDisbDate').textContent = date;
  document.getElementById('revStaffDisbNotes').textContent = notes || 'No extra notes provided.';

  const modal = document.getElementById('staffDisburseReviewModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('open');
  }
}

function handleConfirmSubmission() {
  if (!currentReviewData) return;

  // Final duplicate safety check
  const dupCheck = checkReferenceDuplicate(currentReviewData.ref);
  if (dupCheck.isDuplicate) {
    const modal = document.getElementById('staffDisburseReviewModal');
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
    }
    showDuplicateWarningModal({
      refNumber: currentReviewData.ref,
      existingTransaction: dupCheck.existingTransaction,
      onCancel: () => {},
      onRefresh: () => {
        document.getElementById('staffDisburseForm').reset();
        document.getElementById('staffDisbStockPreview').style.display = 'none';
        const unitBadge = document.getElementById('staffDisbUnitBadge');
        if (unitBadge) unitBadge.textContent = '--';
        const unitSelect = document.getElementById('staffDisbUnit');
        if (unitSelect) unitSelect.value = '';
        hideBundleDisburseSection();
        initNewReference();
      }
    });
    return;
  }

  // Section 14: Submit -> Status: Pending
  // Official inventory is NOT updated yet
  submitStaffTransaction({
    ref: currentReviewData.ref,
    date: currentReviewData.date,
    staff: getLiveStaffInfo().name,
    staffEmail: getLiveStaffInfo().email,
    role: 'Staff',
    activity: 'Disburse',
    type: 'Disburse',
    material: currentReviewData.material,
    quantity: currentReviewData.quantity,
    unit: currentReviewData.unit,
    usedFor: currentReviewData.usedFor,
    notes: currentReviewData.notes,
    status: 'Pending'
  });

  // Close review modal
  const modal = document.getElementById('staffDisburseReviewModal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }

  // Reset form and prepare fresh reference for next transaction
  document.getElementById('staffDisburseForm').reset();
  document.getElementById('staffDisbStockPreview').style.display = 'none';
  const unitBadge = document.getElementById('staffDisbUnitBadge');
  if (unitBadge) unitBadge.textContent = '--';
  const unitSelect = document.getElementById('staffDisbUnit');
  if (unitSelect) unitSelect.value = '';
  hideBundleDisburseSection();
  initDatePicker();
  initNewReference();

  // Render recent submissions
  renderMySubmissions();

  // User feedback
  alert(`Disbursement submitted successfully!\n\nReference: ${currentReviewData.ref}\nStatus: Pending Verification\n\nThe transaction has been sent to the Manager for review.`);
}

function renderMySubmissions() {
  const tbody = document.getElementById('myDisburseSubmissionsTbody');
  const countEl = document.getElementById('myDisbSubCount');
  if (!tbody) return;

  const staffTx = getStaffTransactions().filter(t => t.activity === 'Disburse' || t.type === 'Disburse');
  if (countEl) countEl.textContent = `${staffTx.length} submission${staffTx.length === 1 ? '' : 's'}`;

  if (staffTx.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:28px 16px; color:#64748B;">
          No disburse submissions recorded yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = staffTx.slice(0, 10).map(t => {
    let statusBadge = '';
    const st = t.status || 'Pending';
    if (st === 'Approved') {
      statusBadge = `<span class="badge" style="background:#DCFCE7; color:#15803D; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Approved</span>`;
    } else if (st === 'Rejected') {
      statusBadge = `<span class="badge" style="background:#FEE2E2; color:#DC2626; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Rejected</span>`;
    } else if (st === 'Correction Needed') {
      statusBadge = `<span class="badge" style="background:#FEF3C7; color:#D97706; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Correction Needed</span>`;
    } else {
      statusBadge = `<span class="badge" style="background:#E0F2FE; color:#0369A1; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Pending</span>`;
    }

    let actionBtn = '';
    if (st === 'Correction Needed') {
      actionBtn = `<a href="my-activity.html?ref=${encodeURIComponent(t.ref)}" class="btn-primary" style="padding:4px 10px; font-size:11px; text-decoration:none; background:#D97706; border-radius:6px; display:inline-block;">Correct</a>`;
    } else {
      actionBtn = `<a href="my-activity.html?ref=${encodeURIComponent(t.ref)}" style="color:#15803D; text-decoration:none; font-weight:600; font-size:12px;">View</a>`;
    }

    const createdFormatted = t.createdAt ? new Date(t.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : (t.date || '--');

    return `
      <tr>
        <td style="font-weight:700; font-family:'Sora',sans-serif; color:#0F2A1B;">${escapeHtml(t.ref)}</td>
        <td style="color:#64748B; font-size:12px;">${escapeHtml(createdFormatted)}</td>
        <td style="font-weight:600; color:#0F2A1B;">${escapeHtml(t.material)}</td>
        <td style="font-weight:700; color:#D97706;">-${escapeHtml(t.quantity)}${t.unit ? ' ' + escapeHtml(t.unit) : ''}</td>
        <td style="color:#334155; font-size:12px;">${escapeHtml(t.usedFor || 'General Batch')}</td>
        <td>${statusBadge}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button type="button" class="btn-staff-disb-edit" data-ref="${escapeHtml(t.ref)}" title="Edit submission" style="background:#FFFBEB; border:1px solid #FDE68A; color:#B45309; padding:4px 8px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; margin-right:4px;">
            ✏️ Edit
          </button>
          <button type="button" class="btn-staff-disb-delete" data-ref="${escapeHtml(t.ref)}" title="Delete submission" style="background:#FEF2F2; border:1px solid #FECACA; color:#DC2626; padding:4px 8px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; margin-right:4px;">
            🗑️ Delete
          </button>
          ${actionBtn}
        </td>
      </tr>
    `;
  }).join('');
}

let pendingDeleteStaffDisbRef = null;

function bindStaffDisbActionEvents() {
  const tbody = document.getElementById('myDisburseSubmissionsTbody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-staff-disb-edit');
      if (editBtn) {
        const ref = editBtn.dataset.ref;
        if (ref) openStaffEditDisbModal(ref);
        return;
      }

      const delBtn = e.target.closest('.btn-staff-disb-delete');
      if (delBtn) {
        const ref = delBtn.dataset.ref;
        if (ref) openStaffDeleteDisbModal(ref);
        return;
      }
    });
  }

  // Edit modal buttons
  const editModal = document.getElementById('staffEditDisbModal');
  const btnCloseEdit = document.getElementById('btnCloseStaffEditDisb');
  const btnCancelEdit = document.getElementById('btnCancelStaffEditDisb');
  const formEdit = document.getElementById('staffEditDisbForm');

  const closeEditModal = () => {
    if (editModal) editModal.style.display = 'none';
  };

  if (btnCloseEdit) btnCloseEdit.addEventListener('click', closeEditModal);
  if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);

  if (formEdit) {
    formEdit.addEventListener('submit', (e) => {
      e.preventDefault();
      const ref = document.getElementById('staffEditDisbRef').value.trim();
      const quantity = parseFloat(document.getElementById('staffEditDisbQty').value);
      const usedFor = document.getElementById('staffEditDisbUsedFor').value.trim();
      const notes = document.getElementById('staffEditDisbNotes').value.trim();

      if (isNaN(quantity) || quantity <= 0) {
        alert('Please enter a valid positive quantity.');
        return;
      }
      if (!usedFor) {
        alert('Please enter a production purpose / batch.');
        return;
      }

      const res = updateStaffTransaction(ref, {
        quantity,
        usedFor,
        notes
      });

      if (res && res.success) {
        closeEditModal();
        renderMySubmissions();
        alert(`✓ Submission ${ref} updated successfully.`);
      } else {
        alert('Error updating submission: ' + (res?.message || 'Unknown error'));
      }
    });
  }

  // Delete modal buttons
  const delModal = document.getElementById('staffDeleteDisbModal');
  const btnCloseDel = document.getElementById('btnCloseStaffDeleteDisb');
  const btnCancelDel = document.getElementById('btnCancelStaffDeleteDisb');
  const btnConfirmDel = document.getElementById('btnConfirmStaffDeleteDisb');

  const closeDelModal = () => {
    pendingDeleteStaffDisbRef = null;
    if (delModal) delModal.style.display = 'none';
  };

  if (btnCloseDel) btnCloseDel.addEventListener('click', closeDelModal);
  if (btnCancelDel) btnCancelDel.addEventListener('click', closeDelModal);

  if (btnConfirmDel) {
    btnConfirmDel.addEventListener('click', () => {
      if (!pendingDeleteStaffDisbRef) return;
      const ref = pendingDeleteStaffDisbRef;
      const res = deleteStaffTransaction(ref);
      if (res && res.success) {
        closeDelModal();
        renderMySubmissions();
        alert(`✓ Submission ${ref} deleted successfully.`);
      } else {
        alert('Error deleting submission: ' + (res?.message || 'Unknown error'));
      }
    });
  }
}

function openStaffEditDisbModal(ref) {
  const allStaff = getStaffTransactions();
  const tx = allStaff.find(t => t.ref === ref);
  if (!tx) return;

  const modal = document.getElementById('staffEditDisbModal');
  if (!modal) return;

  const mat = rawMaterials.find(m => (m.name || '').toLowerCase() === (tx.material || '').toLowerCase() || String(m.id) === String(tx.materialId));
  const fallbackUnit = mat ? (mat.unit_of_measure || mat.unit) : '';

  document.getElementById('staffEditDisbRef').value = tx.ref;
  document.getElementById('staffEditDisbRefDisplay').value = tx.ref;
  document.getElementById('staffEditDisbMaterial').value = tx.material || '';
  document.getElementById('staffEditDisbQty').value = tx.quantity || 0;
  document.getElementById('staffEditDisbUnit').value = tx.unit || fallbackUnit || '--';
  document.getElementById('staffEditDisbUsedFor').value = tx.usedFor || '';
  document.getElementById('staffEditDisbNotes').value = tx.notes || '';

  modal.style.display = 'flex';
}

function openStaffDeleteDisbModal(ref) {
  pendingDeleteStaffDisbRef = ref;
  const modal = document.getElementById('staffDeleteDisbModal');
  const codeEl = document.getElementById('staffDeleteDisbRefCode');
  if (codeEl) codeEl.textContent = ref;
  if (modal) modal.style.display = 'flex';
}

