// js/rmims-reorder-engine.js
//
// ONE source of truth for "Forecast" and "Reorder Quantity" across Reports, Inventory and Dashboards.
//
//   * Nothing comes from the built-in catalog / sample datasets.
//   * A material with NO recorded consumption has NO forecast and NO reorder quantity (null -> shown as "—").
//     You cannot know how much to reorder of something you have never used.
//   * Forecast level  = learned from recorded disbursements (users' own input).
//     Scones NB-xxx items additionally use the trained 12-year weekday/season SHAPE (trained-forecast-engine).
//     Other materials use the plain recorded daily average.
//   * Reorder quantity = 7-day forecast requirement + minimum stock - current stock, never < 0.
//     (No assumed lead time or cover days: only recorded usage, the trained model and the material's own minimum.)
//
// Also resolves the real FINISHED PRODUCT a raw material was disbursed for, from the manager's own
// finished-product formulations (My Inventory -> Finished Products), instead of placeholders like
// placeholder labels (old records).

import { txKey } from './rmims-tx-key.js';
import { isDeleted } from './rmims-deleted-ledger.js';
import { getTrainedProfile, buildLiveForecaster, MIN_EVIDENCE_DAYS, REQUIREMENT_BAND_FRACTION, modelMapeFor } from './trained-forecast-engine.js';


const isCountUnit = (u) => ['pcs', 'pc', 'pieces', 'piece', 'packs', 'pack', 'units'].includes(String(u || '').toLowerCase().trim());
export const roundQty = (v, unit) => (v == null || !isFinite(v)) ? null : (isCountUnit(unit) ? Math.ceil(v) : Math.round(v * 10) / 10);

const dayKey = (v) => {
  if (!v) return '';
  const s = String(v).split(' • ')[0];
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const norm = (s) => String(s || '').toLowerCase().replace(/[\/\(\)\-_,&.]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * True when a recipe ingredient name and a raw material name are the same material:
 * same words, one inside the other, or (for a renamed material) every word of the shorter name appears in the
 * longer one with at least two words in common - "All-Purpose Flour" = "All-Purpose / Bread Flour".
 */
export function sameMaterialName(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const ta = x.split(' ').filter(w => w.length > 1), tb = y.split(' ').filter(w => w.length > 1);
  const [small, big] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return small.length >= 2 && small.every(w => big.has(w));
}

/**
 * Build YYYY-MM-DD -> consumed quantity for ONE material from disbursement rows.
 * Rows may use either snake_case (Supabase) or camelCase (normalized) fields.
 */
export function buildActualsForMaterial(material, disbursements) {
  const map = new Map();
  if (!material || !Array.isArray(disbursements)) return map;
  const ids = new Set([material.id, material.itemCode, material.item_code, material.uuid, material.dbId]
    .filter(Boolean).map(x => String(x).toLowerCase().trim()));
  const nm = norm(material.name || material.raw_material_name);
  disbursements.forEach(d => {
    if (!d) return;
    const dId = String(d.materialId ?? d.material_id ?? d.materialCode ?? d.item_code ?? '').toLowerCase().trim();
    const dName = norm(d.materialName ?? d.material_name ?? d.material);
    const match = (dId && ids.has(dId)) || (nm && dName && dName === nm);
    if (!match) return;
    const q = Number(d.disbursedQuantity ?? d.consumed_quantity ?? d.consumedQuantity ?? d.quantity ?? 0);
    const k = dayKey(d.usageDate ?? d.usage_date ?? d.date ?? d.created_at);
    if (!(q > 0) || !k) return;
    map.set(k, (map.get(k) || 0) + q);
  });
  return map;
}

/**
 * Forecast for the next `days` days (starting tomorrow) from recorded consumption, with its margin of error.
 *   - Level comes ONLY from recorded usage.
 *   - Materials with a trained profile use the system's trained shape (trained-forecast-engine) once there are
 *     MIN_EVIDENCE_DAYS recorded days (the engine's own confidence rule); otherwise the recorded daily average.
 *   - Margin = the trained model's MAPE; requirement sits inside it (engine's REQUIREMENT_BAND_FRACTION).
 * @returns {{hasData:boolean, evidenceDays:number, expected:number, requirement:number, half:number, mapePct:number, basis:string}}
 */
export function forecastHorizon(material, actualsByDate, days, opts = {}) {
  const asOf = opts.asOf || new Date();
  const actuals = actualsByDate || new Map();
  let total = 0, evidenceDays = 0;
  actuals.forEach(q => { if (q > 0) { total += q; evidenceDays++; } });
  const code = String(material.itemCode || material.item_code || material.id || '').toUpperCase().trim();
  const profile = getTrainedProfile(code);
  const mapePct = modelMapeFor(code);
  if (evidenceDays === 0) return { hasData: false, evidenceDays: 0, expected: 0, requirement: 0, half: 0, mapePct, basis: 'none' };

  // always the model (also with few records: it reads a first batch as at least one week's usage, instead of
  // averaging per recorded day - that turned 5,035 g used this week into an 18,560 g weekly requirement)
  if (profile) {
    const fc = buildLiveForecaster(code, actuals, { asOf });
    if (fc.hasEvidence) {
      let expected = 0, requirement = 0, half = 0;
      const base = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
      for (let i = 1; i <= days; i++) {
        const r = fc.forecastFor(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
        expected += r.value; requirement += r.requirement; half += Math.max(0, r.upper - r.value);
      }
      return { hasData: true, evidenceDays, expected, requirement, half, mapePct, basis: 'trained-shape' };
    }
  }
  const avgDaily = total / evidenceDays;
  const expected = avgDaily * days;
  const half = expected * (mapePct / 100);
  return { hasData: true, evidenceDays, expected, requirement: expected + REQUIREMENT_BAND_FRACTION * half, half, mapePct, basis: 'recorded-average' };
}

/**
 * Data-driven forecast + reorder for one material.
 *   reorderQty = 7-day forecast requirement + minimum stock - current stock (never below 0)
 *   null everything when the material has no recorded consumption.
 */
export function computeDataDrivenReorder(material, actualsByDate, opts = {}) {
  const unit = material.unit || material.unit_of_measure || '';
  const stock = Math.max(0, Number(material.currentStock ?? material.current_stock ?? 0) || 0);
  const minStock = Math.max(0, Number(material.minThreshold ?? material.minimum_threshold ?? material.minimum_stock ?? material.minStock ?? 0) || 0);
  const actuals = actualsByDate || new Map();
  let recordedUsage = 0;
  actuals.forEach(q => { if (q > 0) recordedUsage += q; });

  const f7 = forecastHorizon(material, actuals, 7, opts);
  if (!f7.hasData) {
    return {
      hasData: false, evidenceDays: 0, lowConfidence: true, recordedUsage: 0, avgDaily: null,
      forecast7: null, forecast30: null, requirement7: null, requirement30: null, requirementTomorrow: null, mapePct: f7.mapePct, reorderQty: null, daysOfCover: null, basis: 'none'
    };
  }
  const f30 = forecastHorizon(material, actuals, 30, opts);
  const f1 = forecastHorizon(material, actuals, 1, opts);   // tomorrow
  return {
    hasData: true,
    evidenceDays: f7.evidenceDays,
    lowConfidence: f7.evidenceDays < MIN_EVIDENCE_DAYS,
    recordedUsage: roundQty(recordedUsage, unit),
    avgDaily: roundQty(recordedUsage / f7.evidenceDays, unit),
    forecast7: roundQty(f7.expected, unit),
    forecast30: roundQty(f30.expected, unit),
    requirement7: roundQty(f7.requirement, unit),
    requirement30: roundQty(f30.requirement, unit),
    requirementTomorrow: roundQty(f1.requirement, unit),
    mapePct: f7.mapePct,
    reorderQty: roundQty(Math.max(0, f7.requirement + minStock - stock), unit),
    // Days the current stock lasts at the forecast daily requirement (from recorded usage only)
    daysOfCover: f30.requirement > 0 ? Math.floor(stock / (f30.requirement / 30)) : null,
    basis: f7.basis
  };
}

/* ============================================================================
 * SHARED LEDGER (same records on every page)
 * The synced ledger (rmims_manager_disbursements: Supabase rows + this device's entries, merged by reference)
 * plus locally saved disbursements, one record per reference.
 * ========================================================================== */
let _ledgerCache = { stamp: null, rows: [] };

export function readRecordedDisbursements() {
  // cached only while the ledgers are unchanged (a sync that lands a moment later is picked up immediately)
  let rawA = '', rawB = '', rawDel = '';
  try { rawA = localStorage.getItem('rmims_manager_disbursements') || ''; rawB = localStorage.getItem('rmims_custom_disbursements') || ''; rawDel = localStorage.getItem('rmims_deleted_disbursement_ids') || ''; } catch (_) {}
  const stamp = rawA.length + ':' + rawB.length + ':' + rawDel.length + ':' + rawA.slice(0, 200) + rawB.slice(0, 200) + rawA.slice(-200) + rawB.slice(-200);
  if (_ledgerCache.stamp === stamp) return _ledgerCache.rows;
  const read = (k) => { try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
  const out = new Map();
  const sig = (d) => [String(d.materialId ?? d.material_id ?? d.materialName ?? d.material_name ?? '').toLowerCase(),
    String(d.usage_date ?? d.usageDate ?? d.date ?? '').slice(0, 10),
    Number(d.consumed_quantity ?? d.consumedQuantity ?? d.quantity ?? 0)].join('|');
  const sigs = new Set();
  [...read('rmims_manager_disbursements'), ...read('rmims_custom_disbursements')].forEach(d => {
    if (!d) return;
    if (isDeleted('disbursement', d.ref, d.id, d.dbId, d.referenceNo)) return; // removed by the user / in Supabase
    const key = txKey(d);
    if (out.has(key)) return;
    if (key.startsWith('id:') && sigs.has(sig(d))) return;
    out.set(key, d);
    sigs.add(sig(d));
  });
  _ledgerCache = { stamp, rows: Array.from(out.values()) };
  return _ledgerCache.rows;
}

/**
 * Stock coverage of one material from RECORDED usage only.
 * @returns {{hasData:boolean, dailyRequirement:number, daysOfCover:number|null}}
 */
export function getMaterialCoverage(material) {
  const plan = computeDataDrivenReorder(material, buildActualsForMaterial(material, readRecordedDisbursements()));
  if (!plan.hasData) return { hasData: false, dailyRequirement: 0, daysOfCover: null, requirement7: null, reorderQty: null };
  return { hasData: true, dailyRequirement: (plan.requirement30 || 0) / 30, daysOfCover: plan.daysOfCover, requirement7: plan.requirement7, reorderQty: plan.reorderQty };
}

/** Format a nullable quantity for a table cell. */
export function fmtQtyOrDash(v, unit, { signed = false } = {}) {
  if (v == null || !isFinite(v)) return '—';
  const s = Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${signed && v > 0 ? '+' : ''}${s}${unit ? ' ' + unit : ''}`;
}

/* ============================================================================
 * FINISHED PRODUCTS (user formulations from My Inventory)
 * ========================================================================== */

const FP_KEYS = ['rmims_custom_finished_products', 'RMSME_CUSTOM_FINISHED_PRODUCTS', 'rmims_finished_products', 'rmims_finished_product_context'];
const TEMPLATE_IDS = new Set(['fp-scones-01', 'fp-scones-formulation']);
const PLACEHOLDER_PRODUCTS = new Set([
  '', 'all', 'null', 'undefined', '—', '-', 'operational batch', 'material usage', 'n/a', 'na', 'none'
]);

export function isPlaceholderProduct(name) {
  const s = String(name || '').replace(/\s*\[Ref:[^\]]*\]\s*/i, '').trim().toLowerCase();
  return PLACEHOLDER_PRODUCTS.has(s) || /imported operational usage/i.test(s) || /^(general )?pro\u0064uction( batch| operations| issue| usage)?$/i.test(s);
}

/**
 * The manager's current finished products: the synced list (Supabase + this device) only. Older copies kept in
 * other storage keys and products the manager deleted are never shown (no stale "old inputs").
 */
export function getUserFinishedProducts() {
  let deleted = new Set();
  try { deleted = new Set((JSON.parse(localStorage.getItem('RMSME_DELETED_FINISHED_PRODUCTS') || '[]') || []).map(n => String(n).toLowerCase().trim())); } catch (_) {}
  let list = null;
  try {
    const raw = localStorage.getItem('rmims_custom_finished_products');
    if (raw != null) list = JSON.parse(raw);
  } catch (_) {}
  if (!Array.isArray(list)) {
    // first run on this device: fall back to the other keys once
    list = [];
    FP_KEYS.slice(1).forEach(k => { try { const a = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(a) && a.length && !list.length) list = a; } catch (_) {} });
  }
  const seen = new Map();
  list.forEach(p => {
    if (!p || !p.name || TEMPLATE_IDS.has(p.id)) return;
    const key = String(p.name).toLowerCase().trim();
    if (deleted.has(key) || seen.has(key)) return;
    seen.set(key, p);
  });
  return Array.from(seen.values());
}

function productUsesMaterial(p, materialName) {
  const target = norm(materialName);
  if (!target) return false;
  const names = [
    ...(Array.isArray(p.materialNames) ? p.materialNames : []),
    ...Object.keys(p.recipeDetails || {}),
    ...(Array.isArray(p.ingredients) ? p.ingredients.map(i => (i && (i.name || i.material || i.materialName)) || i) : [])
  ];
  return names.some(n => sameMaterialName(n, materialName));
}

/** Finished products (names) whose formulation covers this raw material. */
export function finishedProductsForMaterial(materialName, products = getUserFinishedProducts()) {
  return products.filter(p => productUsesMaterial(p, materialName)).map(p => String(p.name).trim());
}

/**
 * The finished product a disbursement was recorded for - exactly what was saved with it, nothing guessed.
 * Placeholders show as "—".
 */
export function resolveFinishedProductName(materialName, storedName) {
  const clean = String(storedName || '').replace(/\s*\[Ref:[^\]]*\]\s*/i, '').trim();
  return clean && !isPlaceholderProduct(clean) ? clean : '—';
}

/**
 * The finished product to SHOW for a record, from the Manager's current finished products only:
 *   - the saved name when it is one of the current products
 *   - otherwise (blank, "—", an old / merged / deleted name) the one current product that uses the material
 *   - "—" only when no current product (or more than one, until the database splits the record) uses it
 * The database (rmims_sync_finished_products) links and splits the records themselves; this keeps the screens
 * right in the meantime and never shows an old name.
 */
export function displayFinishedProduct(materialName, storedName, products = getUserFinishedProducts()) {
  const saved = resolveFinishedProductName(materialName, storedName);
  const list = (Array.isArray(products) ? products : []).filter(p => p && p.name);
  if (list.length === 0) return saved; // the product list has not loaded on this device yet
  const current = list.find(p => String(p.name).toLowerCase().trim() === saved.toLowerCase().trim());
  if (current) return String(current.name).trim();
  const linked = Array.from(new Set(finishedProductsForMaterial(materialName, list)));
  // no product picked when it was recorded: it covers every linked product (the database splits it per product)
  return linked.length === 1 ? linked[0] : (linked.length > 1 ? `All: ${linked.join(', ')}` : '—');
}

/** Value to SAVE as finished_product_name: the real product name, or null (never a placeholder). */
export function productNameForRecord(storedName) {
  const v = resolveFinishedProductName('', storedName);
  return v === '—' ? null : v;
}
