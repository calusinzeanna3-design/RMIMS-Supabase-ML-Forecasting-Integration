// js/rmims-table-pager.js
//
// Pagination for record tables (10 rows per page by default), styled like the My Inventory pagination
// ("Showing 1–10 of 19 records" + numbered page buttons). It attaches to a <tbody>, shows one page of rows
// and re-applies itself automatically whenever the page's own code redraws the table, so no renderer needs
// to change. Empty-state rows (a single full-width cell) are left alone and hide the pager.

const STYLE_ID = 'rmimsTablePagerStyles';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
  .rmims-pager{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-top:12px;padding:14px 18px;
    background:#FAFDFB;border-top:1px solid rgba(20,83,45,.08);border-radius:0 0 14px 14px;box-sizing:border-box}
  .rmims-pager-info{font-size:13px;font-weight:500;color:#5C7A68}
  .rmims-pager-info strong{color:#0F2A1B;font-weight:600}
  .rmims-pager-btns{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .rmims-pager-btn{min-width:36px;height:36px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;
    border:1px solid #CBD5E1;background:#fff;color:#1E293B;font:600 12.5px Inter,system-ui,sans-serif;border-radius:8px;cursor:pointer;
    transition:all .18s ease;box-shadow:0 1px 2px rgba(15,23,42,.04)}
  .rmims-pager-btn:hover:not(:disabled){background:#F0FDF4;border-color:#22C55E;color:#15803D;transform:translateY(-1px)}
  .rmims-pager-btn.active{background:#15803D;border-color:#15803D;color:#fff;font-weight:700;box-shadow:0 2px 8px rgba(21,128,61,.28)}
  .rmims-pager-btn:disabled{opacity:.45;cursor:not-allowed;background:#F8FAFC;border-color:#E2E8F0;color:#94A3B8;box-shadow:none}
  .rmims-pager-gap{color:#94A3B8;padding:0 2px}
  `;
  document.head.appendChild(st);
}

const state = new Map(); // id -> current page

function isEmptyStateRow(tr) {
  return tr.cells.length === 1 && (tr.cells[0].colSpan || 1) > 1;
}

function pageList(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const from = Math.max(2, cur - 1), to = Math.min(total - 1, cur + 1);
  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 1) out.push('…');
  out.push(total);
  return out;
}

const CHEV_L = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
const CHEV_R = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

function pagerHost(tbody, id) {
  let pager = document.getElementById(`${id}__pager`);
  if (pager) return pager;
  const table = tbody.closest('table');
  if (!table) return null;
  // place after the scroll wrapper of the table when there is one
  let anchor = table;
  const p = table.parentElement;
  if (p && p.children.length === 1) anchor = p;
  pager = document.createElement('div');
  pager.id = `${id}__pager`;
  pager.className = 'rmims-pager';
  anchor.insertAdjacentElement('afterend', pager);
  return pager;
}

function apply(tbody, opts) {
  const { id, pageSize, label } = opts;
  const rows = Array.from(tbody.rows);
  const pager = pagerHost(tbody, id);
  if (!pager) return;

  if (rows.length === 0 || (rows.length === 1 && isEmptyStateRow(rows[0]))) {
    pager.style.display = 'none';
    return;
  }
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  let cur = Math.min(Math.max(1, state.get(id) || 1), pages);
  state.set(id, cur);

  const start = (cur - 1) * pageSize;
  rows.forEach((r, i) => { r.style.display = (i >= start && i < start + pageSize) ? '' : 'none'; });

  pager.style.display = 'flex';
  const end = Math.min(total, start + pageSize);
  pager.innerHTML = `
    <div class="rmims-pager-info">Showing <strong>${start + 1}–${end}</strong> of <strong>${total}</strong> ${label}</div>
    <div class="rmims-pager-btns">
      <button type="button" class="rmims-pager-btn" data-pg="prev" ${cur <= 1 ? 'disabled' : ''} aria-label="Previous page">${CHEV_L}</button>
      ${pageList(cur, pages).map(p => p === '…'
        ? '<span class="rmims-pager-gap">…</span>'
        : `<button type="button" class="rmims-pager-btn ${p === cur ? 'active' : ''}" data-pg="${p}" aria-label="Page ${p}">${p}</button>`).join('')}
      <button type="button" class="rmims-pager-btn" data-pg="next" ${cur >= pages ? 'disabled' : ''} aria-label="Next page">${CHEV_R}</button>
    </div>`;
  pager.querySelectorAll('[data-pg]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.pg;
      const now = state.get(id) || 1;
      state.set(id, v === 'prev' ? now - 1 : v === 'next' ? now + 1 : Number(v));
      apply(tbody, opts);
    });
  });
}

/**
 * Paginate a table body and keep it paginated through redraws.
 * @param {string} tbodyId
 * @param {{pageSize?:number, label?:string}} [options]
 */
export function autoPaginate(tbodyId, options = {}) {
  const opts = { id: tbodyId, pageSize: options.pageSize || 10, label: options.label || 'records' };
  const start = () => {
    const tbody = document.getElementById(tbodyId);
    if (!tbody || tbody.__rmimsPager) return;
    tbody.__rmimsPager = true;
    injectStyles();
    let queued = false;
    const run = () => { queued = false; apply(tbody, opts); };
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(run);
    }).observe(tbody, { childList: true });
    apply(tbody, opts);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}

/** Go back to page 1 (call when filters / search change). */
export function resetPage(tbodyId) { state.set(tbodyId, 1); }
