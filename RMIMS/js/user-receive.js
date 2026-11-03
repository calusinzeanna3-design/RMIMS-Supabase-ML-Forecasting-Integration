/**
 * RMIMS Staff Receive Logic
 * Implements Section 5, 7, 8, 9, 10, 11, 12, 13, 14:
 * - System-generated unique reference number (REC-2026-XXXXX)
 * - Reference is non-editable, non-reusable
 * - 2-Step Workflow: Enter Information -> Review -> Reference Check -> Submit
 * - Reference Number is the ONLY basis for duplicate detection
 * - Duplicate warning modal with Cancel / Refresh Form
 * - Submission creates a Pending transaction sent to Manager for verification
 * - Official inventory is NOT updated yet
 */

import { autoPaginate } from './rmims-table-pager.js';
import { getLinkedFinishedProducts, notSetBundleCard, bindBundleSelection, getSelectedFinishedProduct } from './rmims-bundle.js';
import { getSystemRawMaterials } from './system-materials.js';
import { AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from './authentic-finished-products.js';
import {
  fetchUnifiedInventoryFromSupabase,
  fetchStaffTransactionsFromSupabase,
  broadcastManagerSync,
  fetchLiveFinishedProductsFromSupabase
} from '../supabase/manager-supabase-service.js';
import {
  generateNextReference,
  checkReferenceDuplicate,
  showDuplicateWarningModal,
  submitStaffTransaction,
  getStaffTransactions,
  burnReference,
  updateStaffTransaction,
  deleteStaffTransaction,
  reserveReference,
  isReferenceUsed
} from './rmims-transaction-engine.js';
import { attachSearchableCombobox } from './rmims-combobox.js';

// Authentic Bill of Materials (BOM) standard ratios (g/pcs/kl for Scones; kg/L for KXC)

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
  'ube halaya pastries', 'chocolate crinkles', 'toasted pastillas',
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
  // Shared with Manager & Staff (rmims-bundle.js): the manager's own formulations, no built-in ratios
  return getLinkedFinishedProducts(materialName);
}

function updateBundleReceivePreview() {
  const select = document.getElementById('staffRecMaterial');
  const qtyInput = document.getElementById('staffRecQuantity');
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

  const matName = selOpt.value;
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
          Formulations created in Finished Products setup will automatically calculate batch requirements and cascade stock here.
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
    if (p.neededStock == null) return notSetBundleCard(p, escapeHtml);
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
      <div class="rec-product-card ${statusClass}" data-product="${escapeHtml(p.productName)}" style="cursor:pointer;">
        <div class="rec-product-card-top">
          <span class="rec-product-name">${escapeHtml(p.productName)}</span>
          <span class="rec-badge-tag ${tagClass}">${statusText}</span>
        </div>
        <div class="rec-product-stats">
          <span class="rec-req-label">Requirement per Unit:</span>
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
  bindBundleSelection(productsGrid, matName, matchedProducts);
}

function hideBundleReceiveSection() {
  const bundleSection = document.getElementById('recBundleSection');
  const productsGrid = document.getElementById('recBundleProductsGrid');
  if (bundleSection) bundleSection.style.display = 'none';
  if (productsGrid) productsGrid.innerHTML = '';
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
  const candidates = ['currentUser', 'rmimsCurrentUser', 'userProfile', 'staffUser'];
  for (const key of candidates) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const o = JSON.parse(raw);
      if (o && (o.fullName || o.name || o.email || o.id)) {
        let name = (o.fullName || o.name || '').trim();
        const email = (o.email || '').toLowerCase().trim();
        const BANNED_STAFF = ['user account', 'staff member', 'user', 'account', 'staff user', 'store manager', 'manager', 'admin', '—', '-'];
        if (!name || BANNED_STAFF.includes(name.toLowerCase())) {
          name = (o.username || email.split('@')[0] || '').trim();
        }
        return {
          name,
          email,
          id: o.id || ''
        };
      }
    } catch (_) {}
  }
  return { name: '', email: '', id: '' };
}

function initUserReceive() {
  rawMaterials = getSystemRawMaterials();
  populateMaterialSelect();
  initDatePicker();
  initNewReference();
  bindFormEvents();
  bindStaffSubmissionActionEvents();
  renderMySubmissions();

  // Live Supabase sync
  try {
    Promise.allSettled([
      fetchUnifiedInventoryFromSupabase(),
      fetchStaffTransactionsFromSupabase(),
      fetchLiveFinishedProductsFromSupabase() // manager's finished-product formulations (bundle guide)
    ]).then(() => {
      rawMaterials = getSystemRawMaterials();
      populateMaterialSelect();
      renderMySubmissions();
      updateBundleReceivePreview();
      if (!isReviewOpen('staffReceiveReviewModal') && isReferenceUsed(currentRef)) initNewReference();
    }).catch(() => {});
  } catch (_) {}

  // Cross-tab real-time sync
  const refreshReceiveState = () => {
    if (!isReviewOpen('staffReceiveReviewModal') && isReferenceUsed(currentRef)) initNewReference();
    rawMaterials = getSystemRawMaterials();
    populateMaterialSelect();
    renderMySubmissions();
    updateBundleReceivePreview();
  };

  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.includes('transactions') || e.key.includes('materials') || e.key.includes('finished') || e.key.includes('activity')) {
      refreshReceiveState();
    }
  });
  window.addEventListener('rmims_staff_transactions_updated', refreshReceiveState);
  window.addEventListener('rmims_inventory_updated', refreshReceiveState);
  window.addEventListener('rmims_finished_products_updated', () => {
    updateBundleReceivePreview();
  });
  window.addEventListener('rmims_manager_receipts_updated', refreshReceiveState);
  window.addEventListener('rmims_manager_disbursements_updated', refreshReceiveState);
  window.addEventListener('rmims_staff_activity_updated', refreshReceiveState);

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const syncChannel = new BroadcastChannel('rmims_user_sync');
      syncChannel.onmessage = () => {
        refreshReceiveState();
      };
    }
  } catch (_) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUserReceive);
} else {
  initUserReceive();
}

// The number shown on the form was generated before this device finished syncing; replace it when another device or
// a deleted record already uses it (otherwise the user first gets "reference already exists", or the save vanishes).
function isReviewOpen(id) {
  const m = document.getElementById(id);
  return Boolean(m && (m.classList.contains('open') || m.style.display === 'flex'));
}

function initNewReference() {
  currentRef = generateNextReference('REC', 'staff');
  const displayEl = document.getElementById('staffRecRefDisplay');
  if (displayEl) displayEl.textContent = currentRef;
}

function initDatePicker() {
  const dateInput = document.getElementById('staffRecDate');
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
  const select = document.getElementById('staffRecMaterial');
  if (!select) return;

  const prevVal = select.value;
  select.innerHTML = '<option value="">-- Choose Material to Receive --</option>';

  const safeMaterials = [...(rawMaterials || [])].sort((a, b) => (a.name || a.materialName || '').localeCompare(b.name || b.materialName || ''));
  safeMaterials.forEach(m => {
    const opt = document.createElement('option');
    const matName = m.name || m.materialName || m.raw_material_name || '';
    opt.value = matName;
    opt.dataset.name = matName;
    const unit = m.unit_of_measure || m.unit || '';
    opt.textContent = unit ? `${matName} (${m.category || 'General'} • ${unit})` : `${matName} (${m.category || 'General'})`;
    opt.dataset.unit = unit;
    opt.dataset.stock = m.current_stock ?? m.currentStock ?? m.stock ?? 0;
    opt.dataset.min = m.minimum_threshold ?? m.minimum_stock ?? m.minimumStock ?? 0;
    select.appendChild(opt);
  });

  // Pre-select via URL parameters if present, otherwise preserve current selection
  try {
    const sp = new URLSearchParams(window.location.search);
    const targetMat = sp.get('material') || sp.get('id') || sp.get('item_code') || sp.get('code');
    if (prevVal && Array.from(select.options).some(o => o.value === prevVal)) {
      select.value = prevVal;
    } else if (targetMat) {
      const match = Array.from(select.options).find(o => 
        String(o.value).toUpperCase() === targetMat.toUpperCase() ||
        String(o.dataset.name || '').toLowerCase() === targetMat.toLowerCase()
      );
      if (match) select.value = match.value;
    }
  } catch (_) {
    if (prevVal) select.value = prevVal;
  }

  // Trigger change to sync unit badge and preview
  select.dispatchEvent(new Event('change'));

  attachSearchableCombobox(select, {
    placeholder: 'Search raw material to receive...',
    width: '100%'
  });
}

function bindFormEvents() {
  const matSelect = document.getElementById('staffRecMaterial');
  const qtyInput = document.getElementById('staffRecQuantity');
  const unitBadge = document.getElementById('staffRecUnitBadge');
  const unitSelect = document.getElementById('staffRecUnit');
  const stockPreview = document.getElementById('staffRecStockPreview');
  const stockVal = document.getElementById('previewStockVal');
  const minVal = document.getElementById('previewMinVal');

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
        if (qtyInput) qtyInput.placeholder = u ? `e.g. 50 ${u}` : 'e.g. 50';
        if (stockPreview) stockPreview.style.display = 'block';
        if (stockVal) stockVal.textContent = u ? `${selected.dataset.stock} ${u}` : `${selected.dataset.stock}`;
        if (minVal) minVal.textContent = u ? `${selected.dataset.min} ${u}` : `${selected.dataset.min}`;
        updateBundleReceivePreview();
      } else {
        if (stockPreview) stockPreview.style.display = 'none';
        if (unitBadge) unitBadge.textContent = '--';
        if (unitSelect) unitSelect.value = '';
        if (qtyInput) qtyInput.placeholder = 'e.g. 50';
        hideBundleReceiveSection();
      }
    });
  }

  if (qtyInput) {
    qtyInput.addEventListener('input', updateBundleReceivePreview);
  }

  const btnReview = document.getElementById('btnOpenStaffRecReview');
  if (btnReview) {
    btnReview.addEventListener('click', handleOpenReview);
  }

  const btnReset = document.getElementById('btnResetStaffRec');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      setTimeout(() => {
        if (stockPreview) stockPreview.style.display = 'none';
        if (unitBadge) unitBadge.textContent = '--';
        if (unitSelect) unitSelect.value = '';
        hideBundleReceiveSection();
        initDatePicker();
      }, 50);
    });
  }

  const modal = document.getElementById('staffReceiveReviewModal');
  const btnClose = document.getElementById('btnCloseStaffRecReview');
  const btnCancel = document.getElementById('btnCancelStaffRecSubmit');
  const btnConfirm = document.getElementById('btnConfirmStaffRecSubmit');

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
  const matSelect = document.getElementById('staffRecMaterial');
  const qtyInput = document.getElementById('staffRecQuantity');
  const unitSelect = document.getElementById('staffRecUnit');
  const dateInput = document.getElementById('staffRecDate');
  const supInput = document.getElementById('staffRecSupplier');
  const notesInput = document.getElementById('staffRecNotes');

  const material = matSelect ? matSelect.value : '';
  const quantity = qtyInput ? parseFloat(qtyInput.value) : 0;
  const selectedOpt = matSelect && matSelect.selectedIndex >= 0 ? matSelect.options[matSelect.selectedIndex] : null;
  const unit = (selectedOpt && selectedOpt.dataset.unit) ? selectedOpt.dataset.unit : (unitSelect && unitSelect.value ? unitSelect.value : '');
  const date = dateInput ? dateInput.value : '';
  const supplier = supInput ? supInput.value.trim() : '';
  const notes = notesInput ? notesInput.value.trim() : '';

  if (!material) {
    alert('Please choose a raw material to receive.');
    if (matSelect) matSelect.focus();
    return;
  }
  if (!quantity || quantity <= 0 || isNaN(quantity)) {
    alert('Please enter a valid positive quantity received.');
    if (qtyInput) qtyInput.focus();
    return;
  }
  if (!date) {
    alert('Please select the date received.');
    if (dateInput) dateInput.focus();
    return;
  }
  if (!supplier) {
    alert('Please enter the delivery supplier / source.');
    if (supInput) supInput.focus();
    return;
  }

  // One finished product per receipt (same rule as Disburse)
  const pick = getSelectedFinishedProduct(material);
  if (!pick.ok) { alert(pick.message); return; }

  // =========================================================================
  // RULE #8, 9, 10: REFERENCE NUMBER CHECK (ONLY BASIS FOR DUPLICATE DETECTION)
  // =========================================================================
  const dupCheck = checkReferenceDuplicate(currentRef);
  if (dupCheck.isDuplicate) {
    showDuplicateWarningModal({
      refNumber: currentRef,
      existingTransaction: dupCheck.existingTransaction,
      onCancel: () => {
        // Return to receive form, transaction not submitted
      },
      onRefresh: () => {
        // Section 11: Refresh Form
        // Form resets, old reference removed, system generates new reference
        document.getElementById('staffReceiveForm').reset();
        document.getElementById('staffRecStockPreview').style.display = 'none';
        hideBundleReceiveSection();
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
    date,
    supplier,
    notes,
    usedFor: pick.product,
    activity: 'Receive',
    staff: getLiveStaffInfo().name
  };

  // Populate Review Modal (Section 13)
  document.getElementById('revStaffRecRef').textContent = currentRef;
  document.getElementById('revStaffRecMaterial').textContent = material;
  document.getElementById('revStaffRecQty').textContent = `+${quantity.toLocaleString()}${unit ? ' ' + unit : ''}`;
  document.getElementById('revStaffRecDate').textContent = date;
  document.getElementById('revStaffRecSupplier').textContent = supplier;
  document.getElementById('revStaffRecNotes').textContent = notes || 'No extra notes provided.';

  const modal = document.getElementById('staffReceiveReviewModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('open');
  }
}

let staffRecSubmitting = false;
async function handleConfirmSubmission() {
  if (!currentReviewData || staffRecSubmitting) return;
  staffRecSubmitting = true;
  const confirmBtn = document.getElementById('btnConfirmStaffRecSubmit');
  if (confirmBtn) confirmBtn.disabled = true;
  try {
    // Make sure no other device / deleted record already uses this number (it would make this submission vanish)
    const freeRef = await reserveReference(currentReviewData.ref, 'REC', 'staff');
    if (freeRef && freeRef !== currentReviewData.ref) {
      currentReviewData.ref = freeRef;
      currentRef = freeRef;
      const displayEl = document.getElementById('staffRecRefDisplay');
      if (displayEl) displayEl.textContent = freeRef;
    }
    submitReceiveNow();
  } finally {
    staffRecSubmitting = false;
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

function submitReceiveNow() {
  if (!currentReviewData) return;

  // Final duplicate safety check
  const dupCheck = checkReferenceDuplicate(currentReviewData.ref);
  if (dupCheck.isDuplicate) {
    const modal = document.getElementById('staffReceiveReviewModal');
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
    }
    showDuplicateWarningModal({
      refNumber: currentReviewData.ref,
      existingTransaction: dupCheck.existingTransaction,
      onCancel: () => {},
      onRefresh: () => {
        document.getElementById('staffReceiveForm').reset();
        document.getElementById('staffRecStockPreview').style.display = 'none';
        const unitBadge = document.getElementById('staffRecUnitBadge');
        if (unitBadge) unitBadge.textContent = '--';
        const unitSelect = document.getElementById('staffRecUnit');
        if (unitSelect) unitSelect.value = '';
        hideBundleReceiveSection();
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
    staffId: getLiveStaffInfo().id,
    role: 'Staff',
    activity: 'Receive',
    type: 'Receive',
    material: currentReviewData.material,
    quantity: currentReviewData.quantity,
    unit: currentReviewData.unit,
    supplier: currentReviewData.supplier,
    usedFor: currentReviewData.usedFor || '',
    notes: currentReviewData.notes
  });

  try {
    broadcastManagerSync({
      action: 'staff_receive_submitted',
      ref: currentReviewData.ref,
      material: currentReviewData.material,
      quantity: currentReviewData.quantity
    });
  } catch (_) {}

  const modal = document.getElementById('staffReceiveReviewModal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }

  alert(`✓ Transaction ${currentReviewData.ref} submitted to Manager for verification! Status: Pending.`);

  // Reset form and generate fresh reference
  const formEl = document.getElementById('staffReceiveForm');
  if (formEl) formEl.reset();
  const matSelectEl = document.getElementById('staffRecMaterial');
  if (matSelectEl) {
    matSelectEl.value = '';
    if (matSelectEl._rmimsCombobox) matSelectEl._rmimsCombobox.sync();
  }
  document.getElementById('staffRecStockPreview').style.display = 'none';
  const unitBadge = document.getElementById('staffRecUnitBadge');
  if (unitBadge) unitBadge.textContent = '--';
  const unitSelect = document.getElementById('staffRecUnit');
  if (unitSelect) unitSelect.value = '';
  hideBundleReceiveSection();
  initDatePicker();
  initNewReference();

  renderMySubmissions();
}

function renderMySubmissions() {
  const tbody = document.getElementById('myReceiveSubmissionsTbody');
  const countEl = document.getElementById('myRecSubCount');
  if (!tbody) return;

  const allStaff = getStaffTransactions() || [];
  if (allStaff.length === 0) {
    try {
      if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
        window.broadcastRMIMSSync({ isStateRequest: true });
      }
    } catch (_) {}
  }
  const myReceives = allStaff.filter(t => {
    const act = String(t.activity || t.type || '').toLowerCase();
    const refStr = String(t.ref || '');
    return act.includes('rec') || refStr.toUpperCase().startsWith('REC') || /-R\d+/i.test(refStr);
  });

  if (countEl) countEl.textContent = `${myReceives.length} submissions`;

  if (myReceives.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:28px 16px; color:#64748B;">
          No incoming material submissions recorded yet.
        </td>
      </tr>
    `;
    return;
  }

  const corrections = myReceives.filter(t => t.status === 'Correction Needed');
  const actionBanner = document.getElementById('staffRecActionRequiredBanner');
  const bannerTitle = document.getElementById('staffRecActionBannerTitle');
  const bannerDesc = document.getElementById('staffRecActionBannerDesc');
  if (actionBanner) {
    if (corrections.length > 0) {
      actionBanner.style.display = 'block';
      if (bannerTitle) bannerTitle.textContent = `Action Required: ${corrections.length} submission${corrections.length === 1 ? '' : 's'} returned for correction`;
      if (bannerDesc) {
        const latest = corrections[0];
        const msg = latest.correctionMessage ? ` "${latest.correctionMessage}"` : '';
        bannerDesc.textContent = `Submission ${latest.ref} returned by Store Manager with note:${msg}. Click Edit to revise.`;
      }
    } else {
      actionBanner.style.display = 'none';
    }
  }

  tbody.innerHTML = myReceives.map(t => {
    let statusPill = '<span class="status-pill pill-pending">Pending Review</span>';
    if (t.status === 'Approved') statusPill = '<span class="status-pill pill-approved">Approved</span>';
    else if (t.status === 'Rejected') statusPill = '<span class="status-pill pill-rejected">Rejected</span>';
    else if (t.status === 'Correction Needed') statusPill = '<span class="status-pill pill-correction">Correction Needed</span>';
    else if (t.status === 'Deleted') statusPill = '<span class="status-pill pill-rejected" style="background:#F1F5F9;color:#64748B;">Deleted by Manager</span>';

    const isCorrection = t.status === 'Correction Needed';

    return `
      <tr style="${isCorrection ? 'background:rgba(254, 243, 199, 0.25);' : ''}">
        <td><code style="background:#F1F5F9; padding:2px 6px; border-radius:5px; font-weight:700; color:#334155;">${escapeHtml(t.ref)}</code></td>
        <td><strong>${escapeHtml(t.date || '—')}</strong></td>
        <td><small style="color:#64748B; font-weight:600;">${escapeHtml(t.time || '—')}</small></td>
        <td><strong>${escapeHtml(t.material)}</strong></td>
        <td><span style="color:#15803D; font-weight:700;">+${t.quantity}${t.unit ? ' ' + escapeHtml(t.unit) : ''}</span></td>
        <td>${escapeHtml(t.supplier || '--')}</td>
        <td>${statusPill}</td>
        <td style="text-align:right; white-space:nowrap;">
          ${(t.status === 'Approved' || t.status === 'Deleted')
            ? `<span style="color:#94A3B8; font-size:13px; font-weight:600;">—</span>`
            : `
              <button type="button" class="btn-staff-rec-edit" data-ref="${escapeHtml(t.ref)}" title="Edit submission" style="background:#F0FDF4; border:1px solid #BBF7D0; color:#15803D; padding:4px 8px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; margin-right:4px;">
                ✏️ Edit
              </button>
              <button type="button" class="btn-staff-rec-delete" data-ref="${escapeHtml(t.ref)}" title="Delete submission" style="background:#FEF2F2; border:1px solid #FECACA; color:#DC2626; padding:4px 8px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; margin-right:4px;">
                🗑️ Delete
              </button>
              ${isCorrection
                ? `<a href="my-activity.html?correct=${encodeURIComponent(t.ref)}" class="btn-primary" style="text-decoration:none; padding:4px 10px; font-size:11.5px; border-radius:6px; display:inline-block;">Correct</a>`
                : `<a href="my-activity.html?view=${encodeURIComponent(t.ref)}" class="btn-secondary" style="text-decoration:none; padding:4px 10px; font-size:11.5px; border-radius:6px; display:inline-block;">View</a>`
              }
            `
          }
        </td>
      </tr>
    `;
  }).join('');
}

let pendingDeleteStaffRecRef = null;

function bindStaffSubmissionActionEvents() {
  const tbody = document.getElementById('myReceiveSubmissionsTbody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-staff-rec-edit');
      if (editBtn) {
        const ref = editBtn.dataset.ref;
        if (ref) openStaffEditRecModal(ref);
        return;
      }

      const delBtn = e.target.closest('.btn-staff-rec-delete');
      if (delBtn) {
        const ref = delBtn.dataset.ref;
        if (ref) openStaffDeleteRecModal(ref);
        return;
      }
    });
  }

  // Edit modal buttons
  const editModal = document.getElementById('staffEditRecModal');
  const btnCloseEdit = document.getElementById('btnCloseStaffEditRec');
  const btnCancelEdit = document.getElementById('btnCancelStaffEditRec');
  const formEdit = document.getElementById('staffEditRecForm');

  const closeEditModal = () => {
    if (editModal) editModal.style.display = 'none';
  };

  if (btnCloseEdit) btnCloseEdit.addEventListener('click', closeEditModal);
  if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);

  if (formEdit) {
    formEdit.addEventListener('submit', (e) => {
      e.preventDefault();
      const ref = document.getElementById('staffEditRecRef').value.trim();
      const quantity = parseFloat(document.getElementById('staffEditRecQty').value);
      const supplier = document.getElementById('staffEditRecSupplier').value.trim();
      const notes = document.getElementById('staffEditRecNotes').value.trim();

      if (isNaN(quantity) || quantity <= 0) {
        alert('Please enter a valid positive quantity.');
        return;
      }
      if (!supplier) {
        alert('Please enter a supplier/source.');
        return;
      }

      const allStaff = getStaffTransactions();
      const currentTx = allStaff.find(t => t.ref === ref);
      const isCorrection = currentTx && currentTx.status === 'Correction Needed';

      const res = updateStaffTransaction(ref, {
        quantity,
        supplier,
        notes
      });

      if (res && res.success) {
        closeEditModal();
        renderMySubmissions();
        alert(isCorrection
          ? `✓ Submission ${ref} corrected and resubmitted to Manager for review.`
          : `✓ Submission ${ref} updated successfully.`
        );
      } else {
        alert('Error updating submission: ' + (res?.message || 'Unknown error'));
      }
    });
  }

  // Delete modal buttons
  const delModal = document.getElementById('staffDeleteRecModal');
  const btnCloseDel = document.getElementById('btnCloseStaffDeleteRec');
  const btnCancelDel = document.getElementById('btnCancelStaffDeleteRec');
  const btnConfirmDel = document.getElementById('btnConfirmStaffDeleteRec');

  const closeDelModal = () => {
    pendingDeleteStaffRecRef = null;
    if (delModal) delModal.style.display = 'none';
  };

  if (btnCloseDel) btnCloseDel.addEventListener('click', closeDelModal);
  if (btnCancelDel) btnCancelDel.addEventListener('click', closeDelModal);

  if (btnConfirmDel) {
    btnConfirmDel.addEventListener('click', () => {
      if (!pendingDeleteStaffRecRef) return;
      const ref = pendingDeleteStaffRecRef;
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

function openStaffEditRecModal(ref) {
  const allStaff = getStaffTransactions();
  const tx = allStaff.find(t => t.ref === ref);
  if (!tx) return;

  const modal = document.getElementById('staffEditRecModal');
  if (!modal) return;

  const mat = rawMaterials.find(m => (m.name || '').toLowerCase() === (tx.material || '').toLowerCase() || String(m.id) === String(tx.materialId));
  const fallbackUnit = mat ? (mat.unit_of_measure || mat.unit) : '';

  document.getElementById('staffEditRecRef').value = tx.ref;
  document.getElementById('staffEditRecRefDisplay').value = tx.ref;
  document.getElementById('staffEditRecMaterial').value = tx.material || '';
  document.getElementById('staffEditRecQty').value = tx.quantity || 0;
  document.getElementById('staffEditRecUnit').value = tx.unit || fallbackUnit || '--';
  document.getElementById('staffEditRecSupplier').value = tx.supplier || '';
  document.getElementById('staffEditRecNotes').value = tx.notes || '';

  const corrBanner = document.getElementById('staffEditRecCorrectionBanner');
  const corrMsg = document.getElementById('staffEditRecCorrectionMsg');
  if (corrBanner) {
    if (tx.status === 'Correction Needed' || tx.correctionMessage) {
      corrBanner.style.display = 'block';
      if (corrMsg) corrMsg.textContent = `"${tx.correctionMessage || 'Please verify and correct the transaction details.'}"`;
    } else {
      corrBanner.style.display = 'none';
    }
  }

  modal.style.display = 'flex';
}

function openStaffDeleteRecModal(ref) {
  pendingDeleteStaffRecRef = ref;
  const modal = document.getElementById('staffDeleteRecModal');
  const codeEl = document.getElementById('staffDeleteRecRefCode');
  if (codeEl) codeEl.textContent = ref;
  if (modal) modal.style.display = 'flex';
}



// 10 records per page
autoPaginate('myReceiveSubmissionsTbody', { pageSize: 10, label: 'submissions' });
