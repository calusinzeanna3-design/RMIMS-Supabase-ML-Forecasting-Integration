/**
 * RMIMS Staff Inventory Logic (View-Only)
 * Implements Section 4 Requirements:
 * - Material | Category | Unit | Current Stock | Minimum Stock | Status | Days | Run-Out
 * - Removed: Storage Location, Material History
 * - Search raw materials... | Filter ▾ | Sort ▾
 * - Strictly View-Only: No Add, Edit, Delete, Stock Adjustment, or Direct Updates
 */

import { getSystemRawMaterials, saveCustomRawMaterial, deleteSystemRawMaterial } from './system-materials.js';
import {
  fetchUnifiedInventoryFromSupabase,
  saveRawMaterialToSupabase,
  deleteRawMaterialOnSupabase,
  broadcastManagerSync
} from '../supabase/manager-supabase-service.js';

let rawMaterials = [];
let currentPage = 1;
let pageSize = 10;

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initStaffInventory() {
  loadInventory();
  bindEvents();

  // Unified live Supabase sync
  try {
    fetchUnifiedInventoryFromSupabase().then(() => {
      loadInventory();
    }).catch(e => console.warn('[Staff Inventory] Supabase live sync notice:', e));
  } catch (_) {}

  // Cross-tab and cross-module real-time sync
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.includes('material') || e.key.includes('inventory') || e.key.includes('receipt') || e.key.includes('disburse')) {
      loadInventory();
    }
  });

  window.addEventListener('rmims_inventory_updated', () => {
    loadInventory();
  });

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const syncChannel = new BroadcastChannel('rmims_user_sync');
      syncChannel.onmessage = () => {
        loadInventory();
      };
    }
  } catch (_) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStaffInventory);
} else {
  initStaffInventory();
}

function loadInventory() {
  rawMaterials = getSystemRawMaterials();
  populateCategoryFilter();
  updateKpiCards();
  renderTable();
}

function updateKpiCards() {
  const total = rawMaterials.length;
  let good = 0;
  let low = 0;
  let critical = 0;

  rawMaterials.forEach(m => {
    const met = computeMetrics(m);
    if (met.statusKey === 'good') good++;
    else if (met.statusKey === 'low') low++;
    else if (met.statusKey === 'critical' || met.statusKey === 'out') critical++;
  });

  const elTotal = document.getElementById('kpiTotalMaterials');
  const elGood = document.getElementById('kpiGoodStock');
  const elLow = document.getElementById('kpiLowStock');
  const elCrit = document.getElementById('kpiCriticalStock');

  if (elTotal) elTotal.textContent = total;
  if (elGood) elGood.textContent = good;
  if (elLow) elLow.textContent = low;
  if (elCrit) elCrit.textContent = critical;
}

function bindEvents() {
  const searchInput = document.getElementById('staffInvSearch');
  const catFilter = document.getElementById('staffInvCategoryFilter');
  const statusFilter = document.getElementById('staffInvStatusFilter');
  const sortSelect = document.getElementById('staffInvSort');
  const sizeSelect = document.getElementById('staffInvPageSize');
  const refreshBtn = document.getElementById('btnRefreshStaffInv');
  const clearBtn = document.getElementById('btnClearStaffInvFilters');

  if (searchInput) searchInput.addEventListener('input', () => { currentPage = 1; renderTable(); });
  if (catFilter) catFilter.addEventListener('change', () => { currentPage = 1; renderTable(); });
  if (statusFilter) statusFilter.addEventListener('change', () => { currentPage = 1; renderTable(); });
  if (sortSelect) sortSelect.addEventListener('change', () => { currentPage = 1; renderTable(); });
  if (sizeSelect) sizeSelect.addEventListener('change', (e) => {
    pageSize = parseInt(e.target.value, 10) || 10;
    currentPage = 1;
    renderTable();
  });
  if (refreshBtn) refreshBtn.addEventListener('click', loadInventory);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (catFilter) catFilter.value = 'all';
      if (statusFilter) statusFilter.value = 'all';
      if (sortSelect) sortSelect.value = 'name_asc';
      currentPage = 1;
      renderTable();
    });
  }

  // Document-level delegation for Edit and Delete
  document.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-staff-edit');
    if (editBtn) {
      e.preventDefault();
      const id = editBtn.dataset.id || editBtn.getAttribute('data-id');
      if (id) openStaffEditModal(id);
      return;
    }
    const delBtn = e.target.closest('.btn-staff-delete');
    if (delBtn) {
      e.preventDefault();
      const id = delBtn.dataset.id || delBtn.getAttribute('data-id');
      const name = delBtn.dataset.name || delBtn.getAttribute('data-name');
      if (id) openStaffDeleteModal(id, name);
      return;
    }
  });

  // Action column delegation (Edit and Delete)
  const table = document.getElementById('staffInventoryTable');
  if (table) {
    table.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-staff-edit');
      if (editBtn) {
        openStaffEditModal(editBtn.dataset.id);
        return;
      }
      const delBtn = e.target.closest('.btn-staff-delete');
      if (delBtn) {
        openStaffDeleteModal(delBtn.dataset.id, delBtn.dataset.name);
        return;
      }
    });
  }

  // Edit modal buttons
  const editForm = document.getElementById('staffEditMaterialForm');
  const editClose = document.getElementById('staffEditCloseBtn');
  const editCancel = document.getElementById('staffEditCancelBtn');
  if (editClose) editClose.addEventListener('click', closeStaffEditModal);
  if (editCancel) editCancel.addEventListener('click', closeStaffEditModal);
  if (editForm) editForm.addEventListener('submit', handleStaffEditSubmit);

  // Delete modal buttons
  const delClose = document.getElementById('staffDeleteCloseBtn');
  const delCancel = document.getElementById('staffDeleteCancelBtn');
  const delSubmit = document.getElementById('staffDeleteSubmitBtn');
  if (delClose) delClose.addEventListener('click', closeStaffDeleteModal);
  if (delCancel) delCancel.addEventListener('click', closeStaffDeleteModal);
  if (delSubmit) delSubmit.addEventListener('click', handleStaffDeleteSubmit);
}

function populateCategoryFilter() {
  const select = document.getElementById('staffInvCategoryFilter');
  if (!select) return;

  const currentVal = select.value;
  const categories = Array.from(new Set(rawMaterials.map(m => m.category).filter(Boolean))).sort();

  select.innerHTML = '<option value="all">All Categories</option>';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

function computeMetrics(m) {
  const stock = Number(m.current_stock ?? m.currentStock ?? m.stock ?? 0);
  const min = Number(m.minimum_threshold ?? m.minimum_stock ?? m.minimumStock ?? m.minStock ?? 10);
  const dailyBurn = Number(m.forecast_daily || m.avg_daily_usage || m.avgDailyConsumption || m.dailyUsage || Math.max(0.5, Number((min / 7).toFixed(1))));

  const daysRemaining = (dailyBurn > 0 && stock > 0) ? Math.max(0, Math.round(stock / dailyBurn)) : 0;

  let statusKey = 'good';
  let statusText = 'Good';
  let tagClass = 'tag-good';
  let rowClass = 'row-good';

  if (stock <= 0 || stock < min) {
    statusKey = 'out';
    statusText = 'Out of Stock';
    tagClass = 'tag-out';
    rowClass = 'row-out';
  } else if (daysRemaining <= 3) {
    statusKey = 'low';
    statusText = 'Low';
    tagClass = 'tag-low';
    rowClass = 'row-low';
  } else {
    statusKey = 'good';
    statusText = 'Good';
    tagClass = 'tag-good';
    rowClass = 'row-good';
  }

  // Calculate expected run-out date
  let runOutText = 'Sufficient';
  if (stock <= 0 || stock < min) {
    runOutText = stock <= 0 ? 'Depleted' : 'Below Minimum';
  } else if (daysRemaining < 90) {
    const target = new Date();
    target.setDate(target.getDate() + daysRemaining);
    runOutText = target.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return {
    stock,
    min,
    daysRemaining,
    statusKey,
    statusText,
    tagClass,
    rowClass,
    runOutText
  };
}

function renderTable() {
  const tbody = document.getElementById('staffInvTbody');
  if (!tbody) return;

  const searchVal = (document.getElementById('staffInvSearch')?.value || '').toLowerCase().trim();
  const catVal = document.getElementById('staffInvCategoryFilter')?.value || 'all';
  const statusVal = document.getElementById('staffInvStatusFilter')?.value || 'all';
  const sortVal = document.getElementById('staffInvSort')?.value || 'name_asc';

  // 1. Filter
  const filtered = rawMaterials.filter(m => {
    const name = (m.name || m.materialName || '').toLowerCase();
    const cat = (m.category || '').toLowerCase();

    if (searchVal && !name.includes(searchVal) && !cat.includes(searchVal)) {
      return false;
    }
    if (catVal !== 'all' && m.category !== catVal) {
      return false;
    }

    if (statusVal !== 'all') {
      const sKey = statusVal.toLowerCase();
      const met = computeMetrics(m);
      if (sKey === 'good' || sKey === 'available' || sKey === 'in stock') {
        if (met.statusKey !== 'good') return false;
      } else if (sKey === 'low' || sKey === 'low stock') {
        if (met.statusKey !== 'low') return false;
      } else if (sKey === 'out of stock' || sKey === 'out' || sKey === 'critical') {
        if (met.statusKey !== 'out') return false;
      }
    }

    return true;
  });

  // 2. Sort
  filtered.sort((a, b) => {
    const mA = computeMetrics(a);
    const mB = computeMetrics(b);
    const nameA = (a.name || a.materialName || '').toLowerCase();
    const nameB = (b.name || b.materialName || '').toLowerCase();

    if (sortVal === 'name_asc') return nameA.localeCompare(nameB);
    if (sortVal === 'name_desc') return nameB.localeCompare(nameA);
    if (sortVal === 'stock_desc') return mB.stock - mA.stock;
    if (sortVal === 'stock_asc') return mA.stock - mB.stock;
    if (sortVal === 'days_asc') return mA.daysRemaining - mB.daysRemaining;
    return 0;
  });

  // Count Label
  const countLabel = document.getElementById('staffInvCountLabel');
  if (countLabel) {
    countLabel.textContent = `Showing ${filtered.length} of ${rawMaterials.length} raw materials`;
  }

  // 3. Paginate
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  const startIdx = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + pageSize);

  // Pagination info
  const pagInfo = document.getElementById('staffInvPaginationInfo');
  if (pagInfo) {
    const from = totalItems === 0 ? 0 : startIdx + 1;
    const to = Math.min(startIdx + pageSize, totalItems);
    pagInfo.textContent = `Showing ${from}-${to} of ${totalItems} materials`;
  }

  renderPaginationControls(totalPages, totalItems);

  if (pageItems.length === 0) {
    const isFiltered = Boolean(searchVal || catVal !== 'all' || statusVal !== 'all');
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 56px 20px; background: #FFFFFF; border-bottom: none;">
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;">
            <div style="width: 52px; height: 52px; border-radius: 14px; background: #F8FCF9; border: 1px solid var(--rm-line); color: #64748B; display: flex; align-items: center; justify-content: center; box-shadow: var(--rm-shadow-sm);">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            </div>
            <strong style="color: var(--rm-ink); font-size: 15px; font-weight: 700; margin-top: 4px;">
              ${isFiltered ? 'No raw materials match your filter criteria.' : 'No Raw Materials Recorded'}
            </strong>
            <p style="margin: 0; font-size: 13px; color: var(--rm-ink-dim); max-width: 480px; line-height: 1.5;">
              ${isFiltered 
                ? 'Try adjusting your search query or reset category and status filters.' 
                : 'Raw materials inventory stock levels, threshold status, and estimated run-out dates will appear here.'}
            </p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  // Render Table Rows (Unified Manager & Staff Stock Status Table Rows)
  tbody.innerHTML = pageItems.map(m => {
    const met = computeMetrics(m);
    const unit = m.unit_of_measure || m.unit || '';

    let statusText = 'Good';
    let statusPillClass = 'status-pill-good';
    let rowStatusClass = 'row-status-good';
    let rowBg = '#DCFCE7';      // Green for Good
    let rowBorder = '#BBF7D0';
    let leftBorderColor = '#16A34A';

    if (met.statusKey === 'out' || met.stock <= 0 || met.stock < met.min) {
      statusText = 'Out of Stock';
      statusPillClass = 'status-pill-out';
      rowStatusClass = 'row-status-out';
      rowBg = '#FEE2E2';        // Red for Out of Stock
      rowBorder = '#FECACA';
      leftBorderColor = '#DC2626';
    } else if (met.statusKey === 'low' || met.daysRemaining <= 3) {
      statusText = 'Low';
      statusPillClass = 'status-pill-low';
      rowStatusClass = 'row-status-low';
      rowBg = '#FEF3C7';        // Amber for Low Stock
      rowBorder = '#FDE68A';
      leftBorderColor = '#D97706';
    } else {
      statusText = 'Good';
      statusPillClass = 'status-pill-good';
      rowStatusClass = 'row-status-good';
      rowBg = '#DCFCE7';        // Green for Good
      rowBorder = '#BBF7D0';
      leftBorderColor = '#16A34A';
    }

    const formattedStock = met.stock.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const formattedMin = met.min.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

    return `
      <tr class="${rowStatusClass}" style="background-color: ${rowBg} !important;">
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; border-left: 5px solid ${leftBorderColor} !important;">
          <strong style="color:#0F2A1B; font-size:13.5px;">${escapeHtml(m.name || m.materialName)}</strong>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;">
          <span style="color:#475569; font-weight:500;">${escapeHtml(m.category || 'General')}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;">
          <span style="background:rgba(255,255,255,0.7); color:#475569; padding:2px 7px; border-radius:6px; font-size:12px; font-weight:600;">${escapeHtml(unit || '--')}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; text-align: right;">
          <strong style="font-size:14px;" class="${statusText === 'Out of Stock' ? 'stock-out' : (statusText === 'Low' ? 'stock-low' : 'stock-healthy')}">
            ${formattedStock}${unit ? ' ' + unit : ''}
          </strong>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; text-align: right;">
          <span style="color:#1E293B; font-weight:600;">
            ${formattedMin}${unit ? ' ' + unit : ''}
          </span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; text-align: center;">
          <span class="mgr-status-pill ${statusPillClass}">
            ${statusText}
          </span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; text-align: center;">
          <span style="font-weight:700; color:${met.daysRemaining <= 3 ? '#DC2626' : '#334155'};">
            ${met.daysRemaining === 0 ? '0 days' : `${met.daysRemaining} ${met.daysRemaining === 1 ? 'day' : 'days'}`}
          </span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;">
          <span class="runout-date" style="color:#334155; font-size:12px; font-weight:500;">${escapeHtml(met.runOutText)}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; text-align: center;">
          <div style="display:inline-flex; align-items:center; gap:6px; justify-content:center;">
            <button type="button" class="btn-staff-edit" data-id="${m.id || m.item_code}" data-name="${escapeHtml(m.name || m.materialName)}" title="Edit Material" style="padding:4px 8px; border-radius:6px; border:1px solid #0F766E; background:#FFFFFF; color:#0F766E; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Edit</span>
            </button>
            <button type="button" class="btn-staff-delete" data-id="${m.id || m.item_code}" data-name="${escapeHtml(m.name || m.materialName)}" title="Delete Material" style="padding:4px 8px; border-radius:6px; border:1px solid #FECACA; background:#FEF2F2; color:#DC2626; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <span>Delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderPaginationControls(totalPages, totalItems) {
  const container = document.getElementById('staffInvPaginationBtns');
  if (!container) return;

  container.innerHTML = '';

  if (totalItems === 0 || totalPages === 0) {
    container.innerHTML = `
      <button type="button" class="pagination-btn disabled" disabled aria-label="Previous Page">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button type="button" class="pagination-btn disabled" disabled>1</button>
      <button type="button" class="pagination-btn disabled" disabled aria-label="Next Page">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    `;
    return;
  }

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = `pagination-btn ${currentPage <= 1 ? 'disabled' : ''}`;
  prevBtn.id = 'btnPrevPage';
  prevBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  prevBtn.disabled = currentPage <= 1;
  prevBtn.setAttribute('aria-label', 'Previous Page');
  prevBtn.onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  };
  container.appendChild(prevBtn);

  if (totalPages <= 1) {
    const pageBtn = document.createElement('button');
    pageBtn.type = 'button';
    pageBtn.className = 'pagination-btn active';
    pageBtn.textContent = '1';
    container.appendChild(pageBtn);
  } else {
    const maxShow = Math.min(totalPages, 5);
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + maxShow - 1);
    if (endPage - startPage < maxShow - 1) {
      startPage = Math.max(1, endPage - maxShow + 1);
    }

    for (let p = startPage; p <= endPage; p++) {
      const pageBtn = document.createElement('button');
      pageBtn.type = 'button';
      pageBtn.className = `pagination-btn ${p === currentPage ? 'active' : ''}`;
      pageBtn.textContent = String(p);
      pageBtn.onclick = () => {
        currentPage = p;
        renderTable();
      };
      container.appendChild(pageBtn);
    }
  }

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = `pagination-btn ${currentPage >= totalPages ? 'disabled' : ''}`;
  nextBtn.id = 'btnNextPage';
  nextBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  nextBtn.disabled = currentPage >= totalPages;
  nextBtn.setAttribute('aria-label', 'Next Page');
  nextBtn.onclick = () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  };
  container.appendChild(nextBtn);
}

/**
 * ==========================================================
 * STAFF EDIT & DELETE MODAL HANDLERS
 * ==========================================================
 */
let pendingDeleteStaffMatId = null;

function openStaffEditModal(id) {
  const cleanId = String(id || '').trim().toUpperCase();
  const m = rawMaterials.find(x => 
    String(x.id || '').trim().toUpperCase() === cleanId || 
    String(x.item_code || '').trim().toUpperCase() === cleanId ||
    (x.name && x.name.toLowerCase() === String(id).toLowerCase())
  );
  if (!m) {
    alert(`Material "${id}" could not be located.`);
    return;
  }

  const modal = document.getElementById('modalStaffEditMaterial');
  if (!modal) return;

  const idEl = document.getElementById('staffEditMatId');
  const nameEl = document.getElementById('staffEditMatName');
  const catEl = document.getElementById('staffEditMatCategory');
  const unitEl = document.getElementById('staffEditMatUnit');
  const stockEl = document.getElementById('staffEditMatCurrentStock');
  const minEl = document.getElementById('staffEditMatMinStock');

  if (idEl) idEl.value = m.id || m.item_code;
  if (nameEl) nameEl.value = m.name || m.materialName || '';
  if (catEl) catEl.value = m.category || 'General';
  if (unitEl) unitEl.value = m.unit_of_measure || m.unit || 'kg';
  if (stockEl) stockEl.value = m.current_stock ?? m.currentStock ?? 0;
  if (minEl) minEl.value = m.minimum_threshold ?? m.minimum_stock ?? m.minimumStock ?? 10;
  
  const sub = document.getElementById('staffEditModalSubtitle');
  if (sub) sub.textContent = `Editing specifications for ${m.name || m.materialName} (${m.id || m.item_code})`;

  modal.style.display = 'flex';
}

function closeStaffEditModal() {
  const modal = document.getElementById('modalStaffEditMaterial');
  if (modal) modal.style.display = 'none';
}

function handleStaffEditSubmit(e) {
  e.preventDefault();
  const idEl = document.getElementById('staffEditMatId');
  if (!idEl) return;
  const id = idEl.value;
  const m = rawMaterials.find(x => String(x.id) === String(id) || String(x.item_code) === String(id));
  if (!m) return;

  const nameEl = document.getElementById('staffEditMatName');
  const catEl = document.getElementById('staffEditMatCategory');
  const unitEl = document.getElementById('staffEditMatUnit');
  const stockEl = document.getElementById('staffEditMatCurrentStock');
  const minEl = document.getElementById('staffEditMatMinStock');

  const name = nameEl ? nameEl.value.trim() : (m.name || m.materialName);
  const category = (catEl && catEl.value.trim()) || 'General';
  const unit = (unitEl && unitEl.value.trim()) || 'kg';
  const currentStock = stockEl ? (parseFloat(stockEl.value) || 0) : 0;
  const minStock = minEl ? (parseFloat(minEl.value) || 0) : 0;

  const updatedMat = {
    ...m,
    id: m.id || id,
    item_code: m.item_code || id,
    name: name,
    category: category,
    unit: unit,
    unit_of_measure: unit,
    current_stock: currentStock,
    currentStock: currentStock,
    minimum_threshold: minStock,
    minimum_stock: minStock,
    minimumStock: minStock,
    last_updated: new Date().toISOString()
  };

  saveRawMaterialToSupabase(updatedMat);
  closeStaffEditModal();
  loadInventory();
  alert(`✓ Raw material "${name}" updated successfully.`);
}

function openStaffDeleteModal(id, name) {
  pendingDeleteStaffMatId = id;
  const modal = document.getElementById('modalStaffDeleteConfirm');
  const nameEl = document.getElementById('staffDeleteTargetName');
  const codeEl = document.getElementById('staffDeleteTargetCode');
  if (nameEl) nameEl.textContent = name || id;
  if (codeEl) codeEl.textContent = id;
  if (modal) modal.style.display = 'flex';
}

function closeStaffDeleteModal() {
  pendingDeleteStaffMatId = null;
  const modal = document.getElementById('modalStaffDeleteConfirm');
  if (modal) modal.style.display = 'none';
}

function handleStaffDeleteSubmit() {
  if (!pendingDeleteStaffMatId) return;
  const id = pendingDeleteStaffMatId;
  const m = rawMaterials.find(x => String(x.id) === String(id) || String(x.item_code) === String(id));
  const name = m ? (m.name || m.materialName) : id;

  deleteRawMaterialOnSupabase(id);
  closeStaffDeleteModal();
  loadInventory();
  alert(`✓ Raw material "${name}" deleted from catalog.`);
}

