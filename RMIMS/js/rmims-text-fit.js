// js/rmims-text-fit.js
// Responsive text for the WHOLE system (not only tables): any text that is cut off - with "..." (ellipsis),
// clamped to a few lines, or clipped on one line - is allowed to wrap and show in full, so nothing is hidden
// when a screen gets crowded. Tables are left to their own rule (columns grow, the table scrolls sideways).
// It runs on load, on resize, and whenever the page adds or changes content (lists, cards, popups).
(function () {
  if (typeof window === 'undefined' || window.__rmimsTextFit) return;
  window.__rmimsTextFit = true;

  const FIT = 'rmims-text-fit';            // outside tables: the full text wraps onto the next line
  const FIT_ROW = 'rmims-text-fit-row';     // inside tables: the full text stays on one line, the column widens
  // never touched: graphics, the side menu (it collapses on purpose), the date-picker calendar
  const SKIP = 'svg, canvas, script, style, option, .rmims-unit-picker, [data-keep-ellipsis], .rmims-keep-ellipsis, '
    + '.flatpickr-calendar, aside, nav, .admin-sidebar, .rmsme-sidebar, [class*="sidebar"]';

  const hasOwnText = (el) => Array.prototype.some.call(el.childNodes, n => n.nodeType === 3 && n.textContent.trim());

  function isCut(el, cs) {
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    if (clamp) return el.scrollHeight > el.clientHeight + 1;
    const hidesX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
    const ellipsis = cs.textOverflow === 'ellipsis';
    if ((ellipsis || (cs.whiteSpace === 'nowrap' && hidesX)) && el.scrollWidth > el.clientWidth + 1) return true;
    if (hidesX && hasOwnText(el) && el.scrollWidth > el.clientWidth + 1) return true;
    // text cut off at the bottom by a fixed height (only boxes that hold text themselves, never collapsed panels)
    const hidesY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
    if (hidesY && el.clientHeight > 0 && hasOwnText(el) && el.scrollHeight > el.clientHeight + 2) return true;
    return false;
  }

  // ---- form boxes: a chosen / typed value longer than its box makes the box wider (nothing hidden) ----
  let measureCtx = null;
  function textWidth(text, cs) {
    try {
      measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
      measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return measureCtx.measureText(text).width;
    } catch (_) { return 0; }
  }
  function fitControl(el) {
    if (el.clientWidth === 0) return;
    let cs;
    try { cs = getComputedStyle(el); } catch (_) { return; }
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    let need = 0;
    if (el.tagName === 'SELECT') {
      const opt = el.options[el.selectedIndex];
      if (!opt) return;
      need = textWidth(opt.text, cs) + pad + 28;                  // + room for the arrow
    } else {
      if (!/^(text|search|email|url|tel|number|)$/i.test(el.type || '')) return;
      if (!el.value) return;
      // only the real width of the text decides (never the box's own width, so it cannot keep growing)
      need = textWidth(el.value, cs) + pad + 6;
    }
    if (need > el.offsetWidth + 1) {   // need comes only from the text, so this settles after one pass
      el.style.minWidth = Math.ceil(need) + 'px';
      el.classList.add('rmims-control-fit');
    }
    // searchable dropdowns size their own frame from CSS (rmims-ui-fixes.css); other boxes get their frame widened
    if (el.closest('.cal-combobox-input-box, .rm-combobox-wrap')) return;
    // checked on every pass: some dropdowns rebuild their frame's style after a value is picked
    if (el.classList.contains('rmims-control-fit')) fitFrames(el);
  }

  function fitFrames(el) {
    // the frame around the box (search icon, clear / arrow buttons) grows to hold everything, so they stay inside
    let frame = el.parentElement, depth = 0;
    while (frame && depth < 3 && frame !== document.body && !frame.matches('form, .mgr-form-group, .admin-card, section, .mgr-modal-body')) {
      let fcs = null;
      try { fcs = getComputedStyle(frame); } catch (_) {}
      const kids = Array.from(frame.children).filter(k => { try { const p = getComputedStyle(k).position; return p !== 'absolute' && p !== 'fixed'; } catch (_) { return true; } });
      if (fcs && /flex/.test(fcs.display) && fcs.flexDirection.startsWith('row') && !/wrap/.test(fcs.flexWrap)) {
        const gap = parseFloat(fcs.columnGap) || 0;
        const inner = kids.reduce((w, k) => w + k.getBoundingClientRect().width, 0) + gap * Math.max(0, kids.length - 1);
        const want = Math.ceil(inner + (parseFloat(fcs.paddingLeft) || 0) + (parseFloat(fcs.paddingRight) || 0) + (parseFloat(fcs.borderLeftWidth) || 0) + (parseFloat(fcs.borderRightWidth) || 0));
        if (want > frame.offsetWidth) { frame.style.minWidth = want + 'px'; frame.classList.add('rmims-control-fit'); }
      } else if (kids.length === 1 && kids[0].getBoundingClientRect().width > frame.clientWidth) {
        frame.style.minWidth = Math.ceil(kids[0].getBoundingClientRect().width + (frame.offsetWidth - frame.clientWidth)) + 'px';
        frame.classList.add('rmims-control-fit');
      }
      frame = frame.parentElement; depth++;
    }
  }

  function fit(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT') { if (!el.closest(SKIP)) fitControl(el); return; }
    if (el.tagName === 'TEXTAREA' || el.classList.contains(FIT) || el.classList.contains(FIT_ROW)) return;
    if (!el.textContent || !el.textContent.trim()) return;
    if (el.clientWidth === 0 && el.clientHeight === 0) return;   // hidden right now; checked again when shown
    let cs;
    try { cs = getComputedStyle(el); } catch (_) { return; }
    if (!isCut(el, cs)) return;
    if (el.closest(SKIP)) return;
    el.classList.add(el.closest('table') ? FIT_ROW : FIT);
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.closest && root.closest(SKIP) && root.tagName !== 'BODY') return;
    fit(root);
    const all = root.getElementsByTagName('*');
    // very large subtrees are scanned in the next idle moments so the page never stutters
    const n = all.length;
    if (n <= 1500) { for (let i = 0; i < n; i++) fit(all[i]); return; }
    let i = 0;
    const step = (deadline) => {
      const until = Date.now() + 12;
      while (i < n && (deadline && deadline.timeRemaining ? deadline.timeRemaining() > 2 : Date.now() < until)) fit(all[i++]);
      if (i < n) idle(step);
    };
    idle(step);
  }
  const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 500 }) : setTimeout(() => fn(null), 16));

  // batch everything that changed into one pass
  const pending = new Set();
  let timer = null;
  function queue(node) {
    if (!node) return;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return;
    pending.add(el);
    if (!timer) timer = setTimeout(flush, 120);
  }
  function flush() {
    timer = null;
    const roots = Array.from(pending);
    pending.clear();
    // skip nodes already inside another queued root
    roots.filter(r => !roots.some(o => o !== r && o.contains(r))).forEach(scan);
  }

  function start() {
    scan(document.body);
    try {
      new MutationObserver(records => {
        records.forEach(r => {
          if (r.type === 'childList') r.addedNodes.forEach(queue);
          else if (r.type === 'attributes' && r.target.nodeType === 1 && r.target.classList
                   && (r.target.classList.contains(FIT) || r.target.classList.contains(FIT_ROW))
                   && r.attributeName === 'class') return;   // our own mark
          else queue(r.target);   // text changed / an element was shown (style, class, hidden)
        });
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    } catch (_) {}
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => scan(document.body), 200); });
    // a value picked or typed into a form box: widen the box if the value does not fit
    document.addEventListener('change', (e) => { if (e.target && /^(INPUT|SELECT)$/.test(e.target.tagName)) fitControl(e.target); }, true);
    document.addEventListener('input', (e) => { if (e.target && e.target.tagName === 'INPUT') fitControl(e.target); }, true);
    // fonts and late data can change widths after load
    setTimeout(() => scan(document.body), 1500);
    setTimeout(() => scan(document.body), 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
