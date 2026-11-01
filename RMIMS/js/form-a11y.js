/**
 * Form accessibility fixer (runs on every page through rmsme-shell.js).
 *  - every input / select / textarea gets an id (and a name for text-like fields) so browsers can autofill them
 *  - every <label> is linked to its field with for="id"
 *  - a label whose for="" points at an id that does not exist is re-linked to the field next to it
 * It only ADDS missing attributes; it never changes an id, name or for that already works.
 */
const FIELD = 'input, select, textarea';
const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
let uid = 0;

function nextId(prefix) {
  let id;
  do { id = `${prefix}-${++uid}`; } while (document.getElementById(id));
  return id;
}

function labelTarget(label) {
  const inside = label.querySelector(FIELD);
  if (inside) return inside;
  let n = label.nextElementSibling;
  while (n) {
    if (n.matches && n.matches(FIELD)) return n;
    const f = n.querySelector && n.querySelector(FIELD);
    if (f) return f;
    if (n.tagName === 'LABEL') break;           // reached the next label: stop
    n = n.nextElementSibling;
  }
  const parent = label.parentElement;
  const own = parent && parent.querySelector(FIELD);
  return own || null;
}

export function fixFormA11y(root = document) {
  try {
    root.querySelectorAll(FIELD).forEach(el => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (SKIP_TYPES.has(type)) return;
      if (!el.id) el.id = nextId(el.name ? `f-${String(el.name).replace(/[^\w-]/g, '')}` : 'field');
      if (!el.name && type !== 'radio' && type !== 'checkbox') el.name = el.id;
    });

    // flatpickr hides the real input and shows an "alt" input: point labels at the visible one
    root.querySelectorAll('input.flatpickr-input[type="hidden"]').forEach(h => {
      const alt = h.nextElementSibling;
      if (!alt || alt.tagName !== 'INPUT' || !h.id) return;
      if (!alt.id) alt.id = `${h.id}_display`;
      if (!alt.name) alt.name = alt.id;
      document.querySelectorAll(`label[for="${h.id}"]`).forEach(l => l.setAttribute('for', alt.id));
    });

    // autocomplete hint on every field (stops the browser "autocomplete attribute" warning)
    root.querySelectorAll(FIELD).forEach(el => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (SKIP_TYPES.has(type) || el.hasAttribute('autocomplete')) return;
      const key = `${el.name || ''} ${el.id || ''}`.toLowerCase();
      let ac = 'off';
      if (type === 'email' || /email/.test(key)) ac = 'email';
      else if (type === 'password') ac = /new|confirm|repeat/.test(key) ? 'new-password' : 'current-password';
      else if (/full.?name|display.?name|^name\b/.test(key)) ac = 'name';
      else if (type === 'tel' || /phone|mobile/.test(key)) ac = 'tel';
      el.setAttribute('autocomplete', ac);
    });

    // fields that still have no label (search boxes, combobox inputs): give them an accessible name
    root.querySelectorAll(FIELD).forEach(el => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (SKIP_TYPES.has(type)) return;
      if ((el.labels && el.labels.length) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
      const group = el.closest('.mgr-field-group, .form-group, .field, .rm-combobox, .rmims-combobox');
      const near = group && group.querySelector('label');
      const text = (el.getAttribute('placeholder') || el.title || (near && near.textContent) || el.getAttribute('data-label')
        || String(el.name || el.id || '').replace(/[_-]+/g, ' ')).replace(/\s+/g, ' ').trim();
      if (text) el.setAttribute('aria-label', text.replace(/\.\.\.$/, ''));
    });

    root.querySelectorAll('label').forEach(label => {
      const wraps = label.querySelector(FIELD);
      if (wraps) return;                                            // nested label is already associated
      const current = label.getAttribute('for');
      if (current && document.getElementById(current)) return;      // already correct
      const target = labelTarget(label);
      if (!target) return;
      if (!target.id) target.id = nextId('field');
      label.setAttribute('for', target.id);
    });
  } catch (_) { /* never break a page over an accessibility nicety */ }
}

let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(() => fixFormA11y(document), 150); }

export function startFormA11y() {
  if (typeof document === 'undefined' || startFormA11y.started) return;
  startFormA11y.started = true;
  const run = () => {
    fixFormA11y(document);
    try {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
}
