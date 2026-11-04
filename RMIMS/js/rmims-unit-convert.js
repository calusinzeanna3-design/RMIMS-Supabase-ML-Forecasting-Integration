// js/rmims-unit-convert.js
// Receive / Disburse: the quantity can be entered in ANY compatible unit (e.g. kg for a material kept in g,
// L for one kept in mL, dozen / tray for eggs kept in pcs). The entry is converted to the material's own stock
// unit before it is added up, so stock, ledgers, analytics and the forecast always stay in one unit.

const FAMILIES = {
  mass:   { g: 1, mg: 0.001, kg: 1000, lb: 453.59237, oz: 28.349523125 },
  volume: { ml: 1, l: 1000, gal: 3785.411784 },
  count:  { pcs: 1, dozen: 12, tray: 30 }
};
const LABEL = { g: 'g', mg: 'mg', kg: 'kg', lb: 'lb', oz: 'oz', ml: 'mL', l: 'L', gal: 'gal', pcs: 'pcs', dozen: 'dozen (12)', tray: 'tray (30)' };
const ALIASES = {
  g: 'g', gram: 'g', grams: 'g', gm: 'g', gms: 'g', grms: 'g',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l', ltr: 'l', ltrs: 'l',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs', unit: 'pcs', units: 'pcs', ea: 'pcs', each: 'pcs',
  dozen: 'dozen', doz: 'dozen', dz: 'dozen',
  tray: 'tray', trays: 'tray'
};

export function normalizeUnit(u) {
  const k = String(u || '').trim().toLowerCase().replace(/\.$/, '');
  return ALIASES[k] || k;
}
function familyOf(u) {
  const n = normalizeUnit(u);
  return Object.keys(FAMILIES).find(f => FAMILIES[f][n] !== undefined) || null;
}

/** Units the quantity may be entered in for a material kept in `stockUnit` (its own unit first). */
export function compatibleUnits(stockUnit) {
  const fam = familyOf(stockUnit);
  if (!fam) return [{ value: stockUnit || '', label: stockUnit || '--' }];
  const own = normalizeUnit(stockUnit);
  return [own, ...Object.keys(FAMILIES[fam]).filter(u => u !== own)].map(u => ({ value: u, label: LABEL[u] || u }));
}

/** Converts `qty` entered in `fromUnit` to `toUnit` (the material's stock unit). Unknown pairs are left as entered. */
export function convertQty(qty, fromUnit, toUnit) {
  const q = Number(qty);
  const f = normalizeUnit(fromUnit), t = normalizeUnit(toUnit);
  if (!isFinite(q) || !f || !t || f === t) return q;
  const fam = familyOf(f);
  if (!fam || familyOf(t) !== fam) return q;
  return Number(((q * FAMILIES[fam][f]) / FAMILIES[fam][t]).toFixed(6));
}

/**
 * Turns the unit badge next to a quantity input into a unit dropdown for the material's stock unit.
 * The badge keeps its id; the dropdown gets id `${badgeId}Select`.
 */
export function attachUnitPicker(badgeId, stockUnit) {
  const badge = document.getElementById(badgeId);
  if (!badge) return null;
  let sel = document.getElementById(badgeId + 'Select');
  const opts = compatibleUnits(stockUnit);
  if (!stockUnit || opts.length <= 1) {
    if (sel) sel.remove();
    badge.style.display = '';
    badge.textContent = stockUnit || '--';
    return null;
  }
  if (!sel) {
    sel = document.createElement('select');
    sel.id = badgeId + 'Select';
    sel.className = 'rmims-unit-picker';
    sel.title = 'Unit of the quantity you are entering (converted to the material\'s stock unit)';
    sel.setAttribute('aria-label', 'Unit of the entered quantity');
    badge.insertAdjacentElement('afterend', sel);
  }
  sel.dataset.stockUnit = stockUnit;
  sel.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  sel.value = opts[0].value;
  badge.style.display = 'none';
  badge.textContent = stockUnit;
  return sel;
}

/** Resets a picker back to the plain badge (form reset / no material selected). */
export function detachUnitPicker(badgeId) {
  const sel = document.getElementById(badgeId + 'Select');
  if (sel) sel.remove();
  const badge = document.getElementById(badgeId);
  if (badge) badge.style.display = '';
}

/**
 * The entered quantity in the material's stock unit.
 * @returns {{qty:number, entered:number, enteredUnit:string, converted:boolean, note:string}}
 */
export function readQtyInStockUnit(entered, badgeId, stockUnit) {
  const sel = document.getElementById(badgeId + 'Select');
  const from = sel && sel.value ? sel.value : stockUnit;
  const qty = convertQty(entered, from, stockUnit);
  const converted = normalizeUnit(from) !== normalizeUnit(stockUnit) && qty !== Number(entered);
  const label = (LABEL[normalizeUnit(from)] || from || '').replace(/\s*\(.*\)$/, '');
  const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });
  return {
    qty,
    entered: Number(entered),
    enteredUnit: from,
    converted,
    note: converted ? `Entered as ${fmt(entered)} ${label} = ${fmt(qty)} ${stockUnit}` : ''
  };
}
