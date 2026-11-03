// js/rmims-bundle.js
//
// Linked finished products ("bundle") for Receive / Disburse - ONE implementation for Manager and Staff.
// Uses only the manager's own finished-product formulations (My Inventory -> Finished Products), which are
// synced to staff devices. The requirement per unit is exactly what the manager entered in the formulation;
// if the manager left it blank the product is still listed, marked "not set" - no built-in ratio or batch size.

import { getUserFinishedProducts } from './rmims-reorder-engine.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[\/\(\)\-_,&.]/g, ' ').replace(/\s+/g, ' ').trim();

function ingredientNames(p) {
  const list = [];
  if (Array.isArray(p.materialNames)) list.push(...p.materialNames);
  Object.keys(p.recipeDetails || {}).forEach(k => { if (!list.includes(k)) list.push(k); });
  ['raw_materials', 'materials', 'ingredients'].forEach(key => {
    if (Array.isArray(p[key])) {
      p[key].forEach(r => {
        const n = (r && typeof r === 'object') ? (r.name || r.raw_material_name || r.materialName || '') : r;
        if (n && !list.includes(n)) list.push(n);
      });
    }
  });
  return list.filter(Boolean);
}

function matches(ingredient, materialName) {
  const a = norm(ingredient), b = norm(materialName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * @returns {Array<{productName:string, ingredientName:string, needPerUnit:number|null, neededStock:number|null, unit:string}>}
 *   neededStock = the manager's requirement per unit for this raw material (null when not set).
 */
export function getLinkedFinishedProducts(materialName) {
  if (!materialName) return [];
  const out = [];
  getUserFinishedProducts().forEach(p => {
    const ing = ingredientNames(p).find(n => matches(n, materialName));
    if (!ing) return;
    const det = (p.recipeDetails && p.recipeDetails[ing]) || {};
    const raw = det.needPerUnit ?? det.qtyPerUnit;
    const need = raw !== '' && raw != null && Number(raw) > 0 ? Number(raw) : null;
    out.push({
      productName: String(p.name).trim(),
      ingredientName: ing,
      needPerUnit: need,
      neededStock: need,
      ratio: need,
      unit: det.unit || ''
    });
  });
  return out;
}

/** Card for a linked product whose formulation has no requirement entered for this material. */
export function notSetBundleCard(p, escapeHtml) {
  return `
      <div class="rec-product-card status-unreached" data-product="${escapeHtml(p.productName)}" style="cursor:pointer;" title="Requirement per unit not set in this formulation">
        <div class="rec-product-card-top">
          <span class="rec-product-name">${escapeHtml(p.productName)}</span>
          <span class="rec-badge-tag tag-unreached">Not set</span>
        </div>
        <div class="rec-product-stats">
          <span class="rec-req-label">Requirement per Unit:</span>
          <span class="rec-req-val">Not set in formulation</span>
        </div>
        <div class="rec-bar-wrap"><div class="rec-bar-fill fill-unreached" style="width:0%;"></div></div>
      </div>`;
}

/* ============================================================================
 * ONE finished product per disbursement (Manager & Staff)
 * A disbursement record names exactly one finished product, so every product gets its own rows in Supabase,
 * Reports and Analytics (never "A, B" merged into one row). One linked product -> chosen automatically;
 * several -> the user taps the product card it is for.
 * ========================================================================== */
const selection = { material: '', product: '' };

/** Wire the bundle cards in `grid` for selection; call after the cards are rendered. */
export function bindBundleSelection(grid, materialName, linked) {
  if (!grid) return;
  const names = Array.from(new Set((linked || []).map(p => p.productName)));
  if (selection.material !== materialName || !names.includes(selection.product)) {
    selection.material = materialName;
    selection.product = names.length === 1 ? names[0] : '';
  }
  const paint = () => {
    grid.querySelectorAll('.rec-product-card').forEach(card => {
      const on = card.dataset.product === selection.product;
      card.style.outline = on ? '2px solid #15803D' : '';
      card.style.outlineOffset = on ? '2px' : '';
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
      card.title = on ? 'Selected: this record is for this finished product' : 'Tap to record this for this finished product';
    });
    let hint = grid.parentElement && grid.parentElement.querySelector('.rmims-bundle-pick-hint');
    if (!hint && grid.parentElement) {
      hint = document.createElement('div');
      hint.className = 'rmims-bundle-pick-hint';
      hint.style.cssText = 'margin-top:8px; font-size:12px; font-weight:600;';
      grid.insertAdjacentElement('afterend', hint);
    }
    if (hint) {
      if (names.length > 1) {
        hint.style.color = selection.product ? '#15803D' : '#B45309';
        hint.textContent = selection.product
          ? `Recording for: ${selection.product}`
          : 'Tap the finished product this record is for (one product per record).';
        hint.style.display = 'block';
      } else {
        hint.style.display = 'none';
      }
    }
  };
  grid.querySelectorAll('.rec-product-card').forEach(card => {
    if (card.__rmimsPick) return;
    card.__rmimsPick = true;
    card.addEventListener('click', () => { selection.product = card.dataset.product || ''; paint(); });
  });
  paint();
}

/**
 * The finished product for the disbursement being recorded.
 * @returns {{ok:boolean, product:string, message?:string}}
 */
export function getSelectedFinishedProduct(materialName) {
  const linked = Array.from(new Set(getLinkedFinishedProducts(materialName).map(p => p.productName)));
  if (linked.length === 0) return { ok: true, product: '' };
  if (linked.length === 1) return { ok: true, product: linked[0] };
  if (selection.material === materialName && linked.includes(selection.product)) return { ok: true, product: selection.product };
  return { ok: false, product: '', message: `"${materialName}" is used by ${linked.length} finished products (${linked.join(', ')}). Tap the one this record is for, so each finished product gets its own record.` };
}

export function clearBundleSelection() { selection.material = ''; selection.product = ''; }
