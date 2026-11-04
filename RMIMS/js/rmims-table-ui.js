// js/rmims-table-ui.js
// One look for the whole system:
//   1. Every table with a status column: rows stay WHITE, each row gets an outline in its status colour
//      (red = critical / out of stock, orange = low / pending, green = good / received), and the status itself uses
//      the My Inventory oval (white inside, coloured text and border).
//   2. "Received By / Recorded By / Disbursed By / Operator" columns show initials (full name on hover).
//   3. No blue anywhere: blue text and blue badges are switched to the system green.
// Runs on load and whenever a page adds or changes content (tables re-render, popups open).
(function () {
  if (typeof window === 'undefined' || window.__rmimsTableUi) return;
  window.__rmimsTableUi = true;

  const STATUS_HEAD = /(^|\s)(status|stock alert|alert urgency|urgency|limit status|priority)(\s|$)/i;
  const NAME_HEAD = /^(received by|recorded by|disbursed by|operator|staff member|staff|submitted by|approved by|verified by|staff name)$/i;

  function toneOf(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return '';
    if (/(out of stock|critical|shortage|deficit|rejected|deleted|depleted|below limit|stockout|expired|overdue|high priority|urgent)/.test(t)) return 'red';
    if (/(low|running low|attention|warning|pending|correction|near limit|order soon|reorder|medium)/.test(t)) return 'orange';
    if (/(good|enough|adequate|sufficient|approved|received|in stock|above limit|available|active|ok\b|completed|success)/.test(t)) return 'green';
    return 'neutral';
  }

  function initials(name) {
    const words = String(name || '').replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    return words.slice(0, 3).map(w => w[0].toUpperCase()).join('');
  }

  function headerTexts(table) {
    const head = table.tHead && table.tHead.rows[0] ? table.tHead.rows[0] : null;
    if (!head) return [];
    const out = [];
    Array.from(head.cells).forEach(c => {
      const span = Math.max(1, c.colSpan || 1);
      for (let k = 0; k < span; k++) out.push((c.textContent || '').replace(/\s+/g, ' ').trim());
    });
    return out;
  }

  function processTable(table) {
    if (!table || table.closest('.flatpickr-calendar')) return;
    const heads = headerTexts(table);
    if (!heads.length) return;
    const statusIdx = heads.findIndex(h => STATUS_HEAD.test(h));
    const nameIdx = heads.map((h, i) => (NAME_HEAD.test(h) ? i : -1)).filter(i => i >= 0);
    if (statusIdx < 0 && !nameIdx.length) return;

    Array.from(table.tBodies).forEach(tb => Array.from(tb.rows).forEach(tr => {
      if (tr.cells.length < Math.min(heads.length, Math.max(statusIdx, ...nameIdx, 0) + 1)) return; // empty-state rows
      // initials
      nameIdx.forEach(i => {
        const cell = tr.cells[i];
        if (!cell || cell.dataset.rmimsInitials === '1') return;
        // the name without any avatar letter that sits in front of it
        let full = '';
        try {
          const c = cell.cloneNode(true);
          c.querySelectorAll('[class*="avatar"], .table-avatar, .mgr-user-avatar-chip').forEach(a => a.remove());
          full = (c.textContent || '').replace(/\s+/g, ' ').trim();
        } catch (_) { full = (cell.textContent || '').replace(/\s+/g, ' ').trim(); }
        if (!full || full === '—' || full === '-') return;
        const ini = initials(full);
        if (!ini || ini === full) { cell.dataset.rmimsInitials = '1'; return; }
        cell.dataset.rmimsInitials = '1';
        cell.title = full;
        cell.innerHTML = `<span class="rmims-initials" aria-label="${full.replace(/"/g, '&quot;')}">${ini}</span>`;
      });
      // status row + oval
      if (statusIdx >= 0) {
        const cell = tr.cells[statusIdx];
        if (!cell) return;
        const tone = toneOf(cell.textContent);
        if (!tone) return;
        const want = 'rmims-row-' + tone;
        if (!tr.classList.contains(want)) {
          tr.classList.remove('rmims-row-red', 'rmims-row-orange', 'rmims-row-green', 'rmims-row-neutral');
          tr.classList.add('rmims-status-row', want);
        }
        // rows stay white (older screens painted whole rows with a status colour)
        if (tr.style.backgroundColor) tr.style.setProperty('background-color', '#FFFFFF', 'important');
        Array.from(tr.cells).forEach(td => {
          if (td.style.backgroundColor) td.style.setProperty('background-color', '#FFFFFF', 'important');
        });
        const pills = cell.querySelectorAll('span, div.badge, .badge, .status-pill, .mgr-status-pill, .rpt-badge, .fc-status-badge');
        const pill = Array.from(pills).find(p => (p.textContent || '').trim() && !p.querySelector('span span')) || null;
        if (pill && !pill.classList.contains('rmims-status-oval')) {
          pill.classList.add('rmims-status-oval');
        }
        if (pill) {
          pill.classList.remove('rmims-oval-red', 'rmims-oval-orange', 'rmims-oval-green', 'rmims-oval-neutral');
          pill.classList.add('rmims-oval-' + tone);
        }
      }
    }));
  }

  // ---- no blue: blue text / badges become the system green ----
  const SKIP_COLOR = 'svg, canvas, script, style, .flatpickr-calendar, [data-keep-color]';
  function parseRgb(v) {
    const m = String(v || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const isBlue = (c) => c && c.a > 0.05 && c.b > 140 && c.b > c.r + 50 && c.b > c.g + 20;
  const isLightBlue = (c) => c && c.a > 0.05 && c.b >= 235 && c.b > c.r + 8 && c.b >= c.g && c.r > 180;
  function recolor(el) {
    if (!el || el.nodeType !== 1 || el.dataset.rmimsNoBlue === '1') return;
    if (el.closest(SKIP_COLOR)) return;
    let cs;
    try { cs = getComputedStyle(el); } catch (_) { return; }
    const col = parseRgb(cs.color);
    const bg = parseRgb(cs.backgroundColor);
    let changed = false;
    const whiteText = col && col.r > 230 && col.g > 230 && col.b > 230;
    if (isBlue(col)) { el.style.setProperty('color', '#166534', 'important'); changed = true; }
    if (isBlue(bg)) {
      // a solid blue badge with white text becomes solid green; any other blue background becomes light green
      // with dark green text, so the text is always readable
      if (whiteText && bg.a > 0.6) el.style.setProperty('background-color', '#15803D', 'important');
      else { el.style.setProperty('background-color', '#DCFCE7', 'important'); el.style.setProperty('color', '#14532D', 'important'); }
      changed = true;
    }
    else if (isLightBlue(bg)) { el.style.setProperty('background-color', '#F0FDF4', 'important'); changed = true; }
    const bc = parseRgb(cs.borderTopColor);
    if ((isBlue(bc) || isLightBlue(bc)) && parseFloat(cs.borderTopWidth) > 0) { el.style.setProperty('border-color', '#BBF7D0', 'important'); changed = true; }
    if (changed) el.dataset.rmimsNoBlue = '1';
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    const tables = root.tagName === 'TABLE' ? [root] : Array.from(root.getElementsByTagName('table'));
    const owner = root.closest && root.closest('table');
    if (owner && !tables.includes(owner)) tables.push(owner);
    tables.forEach(processTable);
    recolor(root);
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) recolor(all[i]);
  }

  const pending = new Set();
  let timer = null;
  function queue(n) {
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    if (!el) return;
    pending.add(el);
    if (!timer) timer = setTimeout(flush, 120);
  }
  function flush() {
    timer = null;
    const roots = Array.from(pending);
    pending.clear();
    roots.filter(r => !roots.some(o => o !== r && o.contains(r))).forEach(scan);
  }
  function start() {
    scan(document.body);
    try {
      // processed in the observer callback itself (before the browser paints), so a redrawn table never flashes
      // full names / unstyled statuses for a moment before the initials and status colours appear
      new MutationObserver(recs => {
        recs.forEach(r => {
          if (r.type === 'childList') { r.addedNodes.forEach(queue); if (r.target && r.target.closest && r.target.closest('table')) queue(r.target); }
          else if (r.type === 'characterData') queue(r.target);
          else if (r.attributeName === 'hidden' || r.attributeName === 'class') {
            const t = r.target;
            if (t.classList && (t.classList.contains('rmims-status-row') || t.classList.contains('rmims-status-oval'))) return;
            queue(t);
          }
        });
        if (timer) { clearTimeout(timer); flush(); }
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    } catch (_) {}
    setTimeout(() => scan(document.body), 1500);
    setTimeout(() => scan(document.body), 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
