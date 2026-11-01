/**
 * Disburse limit rule (shared by the manager and staff Disburse pages).
 * A disbursement may never take stock below the material's MINIMUM stock, so the most that can be disbursed is
 * (current stock - minimum stock). Nothing can be disbursed once stock is at or below the minimum.
 */
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fmt(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

export function checkDisburseLimit({ current, minimum, quantity, unit = '' }) {
  const cur = num(current);
  const min = Math.max(0, num(minimum));
  const qty = num(quantity);
  const u = unit ? ' ' + unit : '';
  const maxAllowed = Math.max(0, +(cur - min).toFixed(4));

  if (!(qty > 0)) return { ok: true, maxAllowed, message: '' };

  if (cur <= min) {
    return { ok: false, maxAllowed: 0,
      message: `Cannot disburse: stock (${fmt(cur)}${u}) is already at or below the minimum stock (${fmt(min)}${u}). Receive more stock first.` };
  }
  if (qty > cur) {
    return { ok: false, maxAllowed,
      message: `Quantity exceeds the available stock (${fmt(cur)}${u}). You can disburse at most ${fmt(maxAllowed)}${u}.` };
  }
  if (cur - qty < min) {
    return { ok: false, maxAllowed,
      message: `Not allowed: disbursing ${fmt(qty)}${u} would leave ${fmt(cur - qty)}${u}, below the minimum stock of ${fmt(min)}${u}. You can disburse at most ${fmt(maxAllowed)}${u}.` };
  }
  return { ok: true, maxAllowed, message: '' };
}

/** Shows / clears the inline warning, marks the field and disables the action button while the quantity is not allowed. */
export function applyDisburseGuardUI({ result, warningEl, inputEl, buttonEl }) {
  const bad = !result.ok;
  if (warningEl) {
    warningEl.textContent = bad ? result.message : '';
    warningEl.style.display = bad ? 'block' : 'none';
  }
  if (inputEl) {
    inputEl.style.borderColor = bad ? '#DC2626' : '';
    inputEl.setAttribute('aria-invalid', bad ? 'true' : 'false');
  }
  if (buttonEl) {
    buttonEl.disabled = bad;
    buttonEl.style.opacity = bad ? '0.55' : '';
    buttonEl.style.cursor = bad ? 'not-allowed' : '';
    buttonEl.title = bad ? result.message : '';
  }
}
