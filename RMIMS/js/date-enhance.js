/**
 * Replaces every native <input type="date"> with the system calendar (the same flatpickr theme used on
 * Receive / Disburse / Reports), so every date picker looks and behaves the same.
 * Code that reads or sets input.value (yyyy-mm-dd) keeps working: setting .value refreshes the picker.
 */
const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

function enhance(el) {
  if (!el || el._rmDate || el._flatpickr || typeof flatpickr === 'undefined') return;
  el._rmDate = true;
  let busy = false;
  const fp = flatpickr(el, {
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd/m/Y',
    altInputClass: 'inv-input-date',
    disableMobile: true,
    allowInput: true,
    minDate: el.getAttribute('min') || undefined,
    maxDate: el.getAttribute('max') || undefined,
    defaultDate: el.value || undefined,
    onChange: (_d, str) => { if (!busy) { el.dispatchEvent(new Event('change', { bubbles: true })); } },
  });
  if (!fp) return;
  try {
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return desc.get.call(el); },
      set(v) {
        if (busy) { desc.set.call(el, v); return; }
        busy = true;
        try { desc.set.call(el, v); fp.setDate(v || null, false); } finally { busy = false; }
      },
    });
  } catch (_) {}
  if (fp.altInput) {
    if (!fp.altInput.id) fp.altInput.id = (el.id || 'date') + '_display';
    if (!fp.altInput.name) fp.altInput.name = fp.altInput.id;
    fp.altInput.placeholder = fp.altInput.placeholder || 'dd/mm/yyyy';
    if (el.id) document.querySelectorAll(`label[for="${el.id}"]`).forEach(l => l.setAttribute('for', fp.altInput.id));
  }
}

function scan(root = document) {
  try {
    const list = root.querySelectorAll('input[type="date"]');
    if (!list.length) return;
    ensureFlatpickr().then(ok => { if (ok) list.forEach(enhance); });
  } catch (_) {}
}

let loading = null;
function ensureFlatpickr() {
  if (typeof flatpickr !== 'undefined') return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise(resolve => {
    try {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = new URL('../vendor/flatpickr/flatpickr.min.css', import.meta.url).href;
      document.head.appendChild(css);
      const theme = document.createElement('link');
      theme.rel = 'stylesheet';
      theme.href = new URL('../css/system-calendar.css', import.meta.url).href;
      document.head.appendChild(theme);
      const js = document.createElement('script');
      js.src = new URL('../vendor/flatpickr/flatpickr.min.js', import.meta.url).href;
      js.onload = () => resolve(typeof flatpickr !== 'undefined');
      js.onerror = () => resolve(false);
      document.head.appendChild(js);
    } catch (_) { resolve(false); }
  });
  return loading;
}

export function startDateEnhance() {
  if (startDateEnhance.started || typeof document === 'undefined') return;
  startDateEnhance.started = true;
  const run = () => {
    scan();
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 120); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
}
