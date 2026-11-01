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
// "Production Batch" / "Production Operations".

import { getTrainedProfile, buildLiveForecaster, TRAINED_OVERALL_DAILY_MAPE, MIN_EVIDENCE_DAYS, REQUIREMENT_BAND_FRACTION } from './trained-forecast-engine.js';


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
  const mapePct = profile ? Number(profile.mape) || TRAINED_OVERALL_DAILY_MAPE : TRAINED_OVERALL_DAILY_MAPE;
  if (evidenceDays === 0) return { hasData: false, evidenceDays: 0, expected: 0, requirement: 0, half: 0, mapePct, basis: 'none' };

  if (profile && evidenceDays >= MIN_EVIDENCE_DAYS) {
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
      forecast7: null, forecast30: null, requirement7: null, requirement30: null, mapePct: f7.mapePct, reorderQty: null, daysOfCover: null, basis: 'none'
    };
  }
  const f30 = forecastHorizon(material, actuals, 30, opts);
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
let _ledgerCache = { at: 0, rows: [] };
const REF_LIKE = /^(\d{4}SM[A-Za-z]*-|REC-|DIS-)/i;

export function readRecordedDisbursements() {
  const now = Date.now();
  if (now - _ledgerCache.at < 1000) return _ledgerCache.rows;
  const read = (k) => { try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
  const out = new Map();
  const sig = (d) => [String(d.materialId ?? d.material_id ?? d.materialName ?? d.material_name ?? '').toLowerCase(),
    String(d.usage_date ?? d.usageDate ?? d.date ?? '').slice(0, 10),
    Number(d.consumed_quantity ?? d.consumedQuantity ?? d.quantity ?? 0)].join('|');
  const sigs = new Set();
  [...read('rmims_manager_disbursements'), ...read('rmims_custom_disbursements')].forEach(d => {
    if (!d) return;
    const tag = String(d.activity_type || d.activityType || '').match(/\[Ref:\s*([^\]]+)\]/i);
    const ref = String(d.ref || (tag && tag[1]) || (REF_LIKE.test(String(d.id || '')) ? d.id : '') || '').trim().toUpperCase();
    const key = ref ? 'ref:' + ref : 'id:' + String(d.id || '');
    if (out.has(key)) return;
    if (!ref && sigs.has(sig(d))) return;
    out.set(key, d);
    sigs.add(sig(d));
  });
  _ledgerCache = { at: now, rows: Array.from(out.values()) };
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
  '', 'all', 'null', 'undefined', '—', '-', 'production batch', 'production operations', 'general production',
  'operational batch', 'production issue', 'production usage', 'production', 'n/a', 'na', 'none'
]);

export function isPlaceholderProduct(name) {
  const s = String(name || '').replace(/\s*\[Ref:[^\]]*\]\s*/i, '').trim().toLowerCase();
  return PLACEHOLDER_PRODUCTS.has(s) || /imported operational usage/i.test(s);
}

/** The manager's own finished products (no built-in templates). */
export function getUserFinishedProducts() {
  const seen = new Map();
  FP_KEYS.forEach(k => {
    try {
      const arr = JSON.parse(localStorage.getItem(k) || '[]');
      if (!Array.isArray(arr)) return;
      arr.forEach(p => {
        if (!p || !p.name || TEMPLATE_IDS.has(p.id)) return;
        const key = String(p.name).toLowerCase().trim();
        const ex = seen.get(key);
        const cnt = (x) => Object.keys(x.recipeDetails || {}).length + (Array.isArray(x.materialNames) ? x.materialNames.length : 0);
        if (!ex || cnt(p) > cnt(ex)) seen.set(key, p);
      });
    } catch (_) {}
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
  return names.some(n => {
    const x = norm(n);
    return x && (x === target || x.includes(target) || target.includes(x));
  });
}

/** Finished products (names) whose formulation covers this raw material. */
export function finishedProductsForMaterial(materialName, products = getUserFinishedProducts()) {
  return products.filter(p => productUsesMaterial(p, materialName)).map(p => String(p.name).trim());
}

/**
 * Real finished product for a disbursement row: the one recorded with it, otherwise the finished product(s)
 * in My Inventory whose formulation uses this raw material. Never a placeholder.
 */
export function resolveFinishedProductName(materialName, storedName, products) {
  const clean = String(storedName || '').replace(/\s*\[Ref:[^\]]*\]\s*/i, '').trim();
  if (clean && !isPlaceholderProduct(clean)) return clean;
  const list = finishedProductsForMaterial(materialName, products);
  return list.length ? list.join(', ') : '—';
}
