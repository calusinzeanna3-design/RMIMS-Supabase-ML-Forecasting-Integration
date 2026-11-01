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
