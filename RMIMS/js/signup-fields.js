// js/signup-fields.js
//
// Account-creation fields:
//  1. Branch Location & Role open the SYSTEM dropdown (same white menu, mint #F0FDF4 hover, emerald text as
//     every filter inside RMIMS) instead of the browser's native blue/white popup.
//  2. Company is a plain text box (no dropdown). After 2 letters it shows a faded "shadow" completion of the
//     registered company name; Tab / → / Enter accepts it. Only companies registered in the system are
//     accepted: Scones & Muffins Bakery and KXC 5-Year Enterprise. Anything else is refused with:
//     "This company doesn't exist in the system. Please coordinate with the system admin / operator."

// The two companies registered in the system (fallback when the database list cannot be read).
export const REGISTERED_COMPANIES = ['Scones & Muffins Bakery', 'KXC 5-Year Enterprise'];
export const COMPANY_NOT_FOUND_MSG = "This company doesn't exist in the system. Please coordinate with the system admin / operator.";

let companyNames = [...REGISTERED_COMPANIES];

const canon = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(\w+?)s\b/g, '$1').replace(/\s+/g, ' ').trim();

/** Returns the registered company's exact name, or '' when the typed name is not a registered company. */
export function matchRegisteredCompany(typed) {
  const c = canon(typed);
  if (!c) return '';
  return companyNames.find(n => canon(n) === c) || '';
}

/** Load names from Supabase (public.registration_company_names) restricted to the registered companies. */
export async function loadCompanyNames(supabase) {
  try {
    if (!supabase || typeof supabase.rpc !== 'function') return companyNames;
    const { data, error } = await supabase.rpc('registration_company_names');
    if (error || !Array.isArray(data)) return companyNames;
    const fromDb = data.map(r => (typeof r === 'string' ? r : (r && (r.name || r.registration_company_names)) || '')).filter(Boolean);
    const allowed = REGISTERED_COMPANIES.filter(a => fromDb.some(n => canon(n) === canon(a)));
    if (allowed.length) companyNames = allowed;
  } catch (_) {}
  return companyNames;
}

function injectStyles() {
  if (document.getElementById('signupFieldStyles')) return;
  const st = document.createElement('style');
  st.id = 'signupFieldStyles';
  st.textContent = `
  .sf-ghost-host{position:relative;width:100%}
  .input-wrap .input-icon{z-index:2}
  .sf-ghost{position:absolute;inset:0;pointer-events:none;white-space:pre;overflow:hidden;display:flex;align-items:center;
    border:1.5px solid transparent;box-sizing:border-box;color:transparent}
  .sf-ghost .sf-rest{color:#9CB3A4}
  .sf-ghost-host input{position:relative;background:transparent !important;z-index:1}
  .sf-ghost-bg{position:absolute;inset:0;border-radius:12px;z-index:0}
  .sf-hint{margin-top:6px;font-size:.76rem;color:#64748B;font-weight:500}
  .sf-hint.ok{color:#15803D}
  .sf-hint.bad{color:#DC2626}
  .sf-menu{position:absolute;top:calc(100% + 5px);left:0;right:0;background:#fff;border:1px solid rgba(20,83,45,.14);border-radius:10px;
    box-shadow:0 10px 30px -4px rgba(20,83,45,.16),0 4px 10px -2px rgba(0,0,0,.05),0 0 0 1px rgba(20,83,45,.05);padding:5px;z-index:2500;
    opacity:0;visibility:hidden;transform:translateY(-4px) scale(.98);transform-origin:top left;transition:opacity .16s,transform .16s,visibility .16s;box-sizing:border-box}
  .sf-menu.open{opacity:1;visibility:visible;transform:none}
  .sf-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-radius:8px;font-size:.86rem;font-weight:600;color:#1E293B;cursor:pointer;user-select:none;outline:none}
  .sf-opt:hover,.sf-opt.active,.sf-opt[aria-selected="true"]{background:#F0FDF4;color:#15803D;font-weight:700}
  .sf-opt svg{width:14px;height:14px;color:#16803c;opacity:0}
  .sf-opt[aria-selected="true"] svg{opacity:1}
  .sf-select-open{border-color:var(--rm-mid,#16803c) !important;box-shadow:0 0 0 4px rgba(22,128,60,.12) !important}
  `;
  document.head.appendChild(st);
}

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

/** Replace the native popup of a <select> with the system dropdown menu. The <select> keeps the value. */
export function enhanceSystemSelect(select) {
  if (!select || select._sfEnhanced) return;
  select._sfEnhanced = true;
  injectStyles();
  const wrap = select.closest('.input-wrap') || select.parentNode;
  const menu = document.createElement('div');
  menu.className = 'sf-menu';
  menu.setAttribute('role', 'listbox');
  menu.id = `${select.id}_sfMenu`;
  wrap.appendChild(menu);
  select.setAttribute('aria-haspopup', 'listbox');
  select.setAttribute('aria-controls', menu.id);
  select.setAttribute('aria-expanded', 'false');

  let activeIdx = -1;
  const opts = () => Array.from(select.options).filter(o => !o.disabled);

  function build() {
    menu.innerHTML = opts().map((o, i) =>
      `<div class="sf-opt" role="option" data-i="${i}" tabindex="-1" aria-selected="${o.value === select.value}">${o.textContent.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}${CHECK}</div>`).join('');
    menu.querySelectorAll('.sf-opt').forEach(el => {
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => choose(Number(el.dataset.i)));
    });
  }
  function highlight(i) {
    const items = menu.querySelectorAll('.sf-opt');
    activeIdx = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((el, k) => el.classList.toggle('active', k === activeIdx));
    items[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }
  function open() {
    build();
    menu.classList.add('open');
    select.classList.add('sf-select-open');
    select.setAttribute('aria-expanded', 'true');
    const cur = opts().findIndex(o => o.value === select.value);
    highlight(cur >= 0 ? cur : 0);
  }
  function close() {
    menu.classList.remove('open');
    select.classList.remove('sf-select-open');
    select.setAttribute('aria-expanded', 'false');
  }
  function choose(i) {
    const o = opts()[i];
    if (!o) return;
    select.value = o.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    select.focus();
  }

  select.addEventListener('mousedown', (e) => {
    e.preventDefault(); // suppress the native OS popup
    select.focus();
    menu.classList.contains('open') ? close() : open();
  });
  select.addEventListener('keydown', (e) => {
    const isOpen = menu.classList.contains('open');
    if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Spacebar'].includes(e.key)) {
      e.preventDefault();
      if (!isOpen) { open(); return; }
      if (e.key === 'ArrowDown') highlight(activeIdx + 1);
      else if (e.key === 'ArrowUp') highlight(activeIdx - 1);
      else choose(activeIdx);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      close();
    }
  });
  select.addEventListener('blur', () => setTimeout(close, 120));
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); }, true);
}

/** Typable company input with ghost-text completion after 2 letters and strict validation. */
export function enhanceCompanyInput(input, { onValidity } = {}) {
  if (!input || input._sfCompany) return;
  input._sfCompany = true;
  injectStyles();
  input.removeAttribute('list');
  const dl = document.getElementById('branchStoresDatalist');
  if (dl) dl.remove();
  input.setAttribute('autocomplete', 'off');

  const host = document.createElement('div');
  host.className = 'sf-ghost-host';
  input.parentNode.insertBefore(host, input);
  const bg = document.createElement('div');
  bg.className = 'sf-ghost-bg';
  const ghost = document.createElement('div');
  ghost.className = 'sf-ghost';
  ghost.innerHTML = '<span class="sf-typed"></span><span class="sf-rest"></span>';
  host.appendChild(bg);
  host.appendChild(ghost);
  host.appendChild(input);
  // The form stylesheet paints the input background with !important; move that paint (whatever the theme)
  // onto the layer underneath so the ghost text shows through.
  const paintBg = () => {
    input.style.removeProperty('background');
    input.style.removeProperty('background-color');
    const cs = getComputedStyle(input);
    bg.style.background = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : '#fff';
    input.style.setProperty('background', 'transparent', 'important');
    input.style.setProperty('background-color', 'transparent', 'important');
  };
  paintBg();
  new MutationObserver(paintBg).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  const icon = host.parentNode.querySelector('.input-icon');
  if (icon) icon.style.setProperty('z-index', '3', 'important');

  const hint = document.createElement('div');
  hint.className = 'sf-hint';
  hint.setAttribute('aria-live', 'polite');
  (input.closest('.input-group') || host.parentNode).appendChild(hint);

  const syncBox = () => {
    const cs = getComputedStyle(input);
    ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'fontSize', 'fontFamily', 'fontWeight', 'letterSpacing', 'borderRadius']
      .forEach(p => { ghost.style[p] = cs[p]; });
    bg.style.borderRadius = cs.borderRadius;
  };

  let suggestion = '';
  function update() {
    syncBox();
    const typed = input.value;
    suggestion = '';
    const t = typed.trimStart();
    if (t.length >= 2) {
      suggestion = companyNames.find(n => n.toLowerCase().startsWith(t.toLowerCase())) || '';
    }
    const rest = suggestion && suggestion.length > t.length ? suggestion.slice(t.length) : '';
    ghost.querySelector('.sf-typed').textContent = typed;
    ghost.querySelector('.sf-rest').textContent = rest;
    if (ghost.scrollWidth > ghost.clientWidth) ghost.scrollLeft = input.scrollLeft;

    hint.className = 'sf-hint';
    hint.textContent = rest ? 'Press Tab or → to complete.' : '';
  }
  function accept() {
    if (!suggestion) return false;
    input.value = suggestion;
    update();
    validate(true);
    return true;
  }
  function validate(show) {
    const v = input.value.trim();
    const match = matchRegisteredCompany(v);
    if (match && match !== v) input.value = match; // store the exact registered spelling
    const ok = Boolean(match);
    if (show && v) {
      hint.className = `sf-hint ${ok ? 'ok' : 'bad'}`;
      hint.textContent = ok ? 'Registered company.' : COMPANY_NOT_FOUND_MSG;
    }
    if (typeof onValidity === 'function') onValidity(ok);
    return ok;
  }

  input.addEventListener('input', () => { update(); if (typeof onValidity === 'function') onValidity(Boolean(matchRegisteredCompany(input.value))); });
  input.addEventListener('keydown', (e) => {
    const atEnd = input.selectionStart === input.value.length;
    const rest = ghost.querySelector('.sf-rest').textContent;
    if (rest && ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'ArrowRight' && atEnd) || e.key === 'Enter')) {
      e.preventDefault();
      accept();
    }
  });
  input.addEventListener('blur', () => { ghost.querySelector('.sf-rest').textContent = ''; validate(true); });
  input.addEventListener('scroll', () => { ghost.scrollLeft = input.scrollLeft; });
  window.addEventListener('resize', syncBox);
  update();

  input._sfValidate = validate;
}
