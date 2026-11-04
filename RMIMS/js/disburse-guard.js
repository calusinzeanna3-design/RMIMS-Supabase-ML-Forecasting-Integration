/**
 * Disburse limit rule (shared by the manager and staff Disburse pages).
 * - Taking MORE than the stock on hand is blocked (the database refuses it too).
 * - Taking stock BELOW the minimum stock is allowed, but shows a ⚠ warning, and the user is asked
 *   "Are you sure?" (Yes / No) before the stock is deducted. Yes deducts it, so Low / Out of Stock still shows.
 */
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fmt(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

export function checkDisburseLimit({ current, minimum, quantity, unit = '' }) {
  const cur = num(current);
  const min = Math.max(0, num(minimum));
  const qty = num(quantity);
  const u = unit ? ' ' + unit : '';
  const maxAllowed = Math.max(0, +cur.toFixed(4));

  if (!(qty > 0)) return { ok: true, warn: false, maxAllowed, message: '' };

  if (cur <= 0) {
    return { ok: false, warn: false, maxAllowed: 0,
      message: `Cannot disburse: there is no stock left (0${u}). Receive more stock first.` };
  }
  if (qty > cur + 1e-9) {
    return { ok: false, warn: false, maxAllowed,
      message: `Quantity exceeds the available stock (${fmt(cur)}${u}). You can disburse at most ${fmt(cur)}${u}.` };
  }
  const left = +(cur - qty).toFixed(4);
  if (min > 0 && left < min) {
    const outOfStock = left <= 0;
    return { ok: true, warn: true, belowMin: true, outOfStock, left, maxAllowed,
      message: outOfStock
        ? `⚠ Disbursing ${fmt(qty)}${u} will use up all the stock (0${u} left, minimum is ${fmt(min)}${u}). It will show as Out of Stock.`
        : `⚠ Disbursing ${fmt(qty)}${u} will leave ${fmt(left)}${u}, below the minimum stock of ${fmt(min)}${u}. It will show as Low.` };
  }
  if (left <= 0) {
    return { ok: true, warn: true, belowMin: true, outOfStock: true, left: 0, maxAllowed,
      message: `⚠ Disbursing ${fmt(qty)}${u} will use up all the stock. It will show as Out of Stock.` };
  }
  return { ok: true, warn: false, maxAllowed, message: '' };
}

/** Shows / clears the inline message. A blocked quantity disables the button; a warning keeps it enabled. */
export function applyDisburseGuardUI({ result, warningEl, inputEl, buttonEl }) {
  const bad = !result.ok;
  const warn = !!(result.ok && result.warn);
  if (warningEl) {
    warningEl.textContent = (bad || warn) ? result.message : '';
    warningEl.style.display = (bad || warn) ? 'block' : 'none';
    warningEl.style.color = warn ? '#C2410C' : '#DC2626';
  }
  if (inputEl) {
    inputEl.style.borderColor = bad ? '#DC2626' : (warn ? '#EA580C' : '');
    inputEl.setAttribute('aria-invalid', bad ? 'true' : 'false');
  }
  if (buttonEl) {
    buttonEl.disabled = bad;
    buttonEl.style.opacity = bad ? '0.55' : '';
    buttonEl.style.cursor = bad ? 'not-allowed' : '';
    buttonEl.title = bad ? result.message : '';
  }
}

/** Asks "Are you sure?" in the system's own Yes / No card when the disbursement goes below the minimum. */
export async function confirmBelowMinimum(result, { material = '', quantity = '', unit = '' } = {}) {
  if (!result || !result.warn) return true;
  const what = material ? `${fmt(num(quantity))}${unit ? ' ' + unit : ''} of ${material}` : 'this quantity';
  const msg = `${result.message.replace(/^⚠\s*/, '')}\n\nAre you sure you want to disburse ${what}?`;
  if (typeof window.rmimsConfirm === 'function') {
    return window.rmimsConfirm(msg, { title: 'Below minimum stock', yesText: 'Yes, disburse', noText: 'No', tone: 'warn' });
  }
  return false;
}
