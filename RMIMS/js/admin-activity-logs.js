// RMIMS Main Administration Activity Logs Controller
// Dynamically loads and renders real system activity records from live operational storage
// (manager activity audit log, stock receipts, material disbursements, and staff submissions).
// Supports dynamic KPI calculations, multi-filter toolbar, date range selection, and CSV export.

import { initAdminCalendarPicker, getLiveTodayISO, getDaysAgoISO, formatDisplayDate } from './admin-calendar-picker.js';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatLogTimestamp(ts) {
  if (!ts) return formatDisplayDate(getLiveTodayISO());
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  
  const dateStr = formatDisplayDate(d.toISOString().slice(0, 10));
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${dateStr} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const branchFilter = document.getElementById('branchFilter');
  const roleFilter = document.getElementById('roleFilter');
  const actionFilter = document.getElementById('actionFilter');
  const statusFilter = document.getElementById('statusFilter');
  const searchInput = document.getElementById('logSearchInput');
  const topSearchInput = document.getElementById('topSearchInput');
  const table = document.getElementById('activityTable');
  const tableBody = document.getElementById('activityTableBody') || (table ? table.querySelector('tbody') : null);
  const counter = document.getElementById('logPaginationCounter');
  const btnExport = document.getElementById('btnExportLogs');
  const btnClear = document.getElementById('btnClearFilters');

  // KPI Stat Card Elements
  const kpiTotal = document.getElementById('kpiTotalActivities');
  const kpiToday = document.getElementById('kpiActivitiesToday');
  const kpiLogins = document.getElementById('kpiActivitiesLogins');
  const kpiChanges = document.getElementById('kpiActivitiesChanges');

  // Date Range Popover elements
  const btnToggleDate = document.getElementById('btnToggleDateRange');
  const datePopover = document.getElementById('datePickerPopover');
  const btnCancelDate = document.getElementById('btnCancelDateRange');
  const btnApplyDate = document.getElementById('btnApplyDateRange');
  const dateDisplayLabel = document.getElementById('dateRangeDisplayLabel');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const bottomDateBox = document.getElementById('bottomDateBox');
  const startDateText = document.getElementById('startDateText');
  const endDateText = document.getElementById('endDateText');

  // Calendar State & Dynamic Live Date Engine
  const LIVE_TODAY = getLiveTodayISO();
  const LIVE_TODAY_LABEL = formatDisplayDate(LIVE_TODAY);

  if (dateDisplayLabel) dateDisplayLabel.textContent = LIVE_TODAY_LABEL;
  if (startDateText) startDateText.textContent = LIVE_TODAY_LABEL;
  if (endDateText) endDateText.textContent = LIVE_TODAY_LABEL;

  let appliedFilter = {
    mode: 'single',
    start: LIVE_TODAY,
    end: LIVE_TODAY
  };

  const calPicker = initAdminCalendarPicker({
    popover: datePopover,
    triggerBtn: btnToggleDate,
    displayLabel: dateDisplayLabel,
    colMonth1: document.getElementById('colMonth1'),
    colMonth2: document.getElementById('colMonth2'),
    gridMonth1: document.getElementById('daysGridMonth1'),
    gridMonth2: document.getElementById('daysGridMonth2'),
    monthTitle1: document.getElementById('monthTitle1'),
    monthTitle2: document.getElementById('monthTitle2'),
    btnPrev: document.getElementById('btnPrevMonth'),
    btnNext: document.getElementById('btnNextMonth'),
    btnNextSingle: document.getElementById('btnNextMonthSingle'),
    bottomBox: bottomDateBox,
    startDateLabel: startDateText,
    endDateLabel: endDateText,
    presetBtns: presetBtns,
    btnApply: btnApplyDate,
    btnCancel: btnCancelDate,
    initialPreset: 'this_month',
    initialStart: LIVE_TODAY,
    initialEnd: null,
    onApply: (applied) => {
      appliedFilter = {
        mode: applied.mode,
        start: applied.start,
        end: applied.end
      };
      filterRows();
    }
  });

  // Load and consolidate real system events
  function loadConsolidatedActivities() {
    const list = [];

    // 1. Manager / Admin Activities
    try {
      const mgrAct = JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]');
      mgrAct.forEach(item => {
        const itemDetails = (item.details || item.activity || '').trim();
        const user = (item.user || '').trim();
        const bLoc = (item.branchLoc || item.branch || (item.role === 'Main Admin' || item.role === 'Administrator' ? 'Headquarters' : '')).trim();
        const bName = (item.branchName || (item.role === 'Main Admin' || item.role === 'Administrator' ? 'Main Administration' : bLoc)).trim();
        const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
        
        // Strict requirement: must have a branch/HQ context and real user name
        if (!hasBranch && item.role !== 'Main Admin') return;
        const displayUser = user || (item.role === 'Main Admin' ? 'Zeanna' : (item.role === 'Manager' ? 'Store Manager' : 'Store Staff'));
        
        const txt = `${user} ${itemDetails} ${bLoc} ${bName}`.toLowerCase();
        if (txt.includes('simulated_user') || txt.includes('demo') || txt.includes('john reyes')) {
          return;
        }
        if (['receive', 'approve transaction', 'disburse'].includes(itemDetails.toLowerCase())) {
          return;
        }
        const itemDate = item.date || (item.timestamp ? String(item.timestamp).slice(0, 10) : LIVE_TODAY);
        list.push({
          id: item.id || `act-${Math.random()}`,
          timestamp: item.timestamp || new Date().toISOString(),
          date: itemDate,
          dateTimeStr: formatLogTimestamp(item.timestamp),
          user: user,
          role: item.role || 'Manager',
          branchLoc: bLoc,
          branchName: bName || bLoc,
          action: item.action || 'Updated',
          module: item.module || 'Inventory',
          details: itemDetails || 'Inventory operation executed.',
          status: item.status || 'success'
        });
      });
    } catch (_) {}

    // 2. Live Stock Receipts (Manager + Custom)
    try {
      const mgrRec = JSON.parse(localStorage.getItem('rmims_manager_receipts') || '[]');
      const customRec = JSON.parse(localStorage.getItem('rmims_custom_receipts') || '[]');
      const receipts = [...mgrRec, ...customRec];
      const seenRec = new Set();
      receipts.forEach(r => {
        const key = r.id || r.ref || JSON.stringify(r);
        if (seenRec.has(key)) return;
        seenRec.add(key);
        const bLoc = (r.branchLoc || '').trim();
        const bName = (r.branchName || '').trim();
        const user = (r.receivedBy || '').trim();
        const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
        if (!hasBranch) return;
        const displayUser = user || 'Store Manager';
        const ref = r.ref || '';
        if (['REC-2026-00125', 'REC-2026-00124', 'REC-2026-00120', 'REC-2026-00118'].includes(ref)) return;

        const rDate = r.receiptDate || r.date || (r.timestamp ? String(r.timestamp).slice(0, 10) : LIVE_TODAY);
        const itemCount = Array.isArray(r.items) ? r.items.length : 1;
        list.push({
          id: `rec-act-${r.id || r.ref || Math.random()}`,
          timestamp: r.timestamp || (rDate + 'T10:00:00Z'),
          date: rDate,
          dateTimeStr: formatLogTimestamp(r.timestamp || rDate),
          user: user,
          role: 'Manager',
          branchLoc: bLoc,
          branchName: bName || bLoc,
          action: 'Received',
          module: 'Receive',
          details: `Recorded stock receipt (${r.ref || 'Ref'}): ${itemCount} raw material item(s) from ${r.supplierName || 'Supplier'}.`,
          status: 'success'
        });
      });
    } catch (_) {}

    // 3. Live Material Disbursements (Manager + Custom)
    try {
      const mgrDisb = JSON.parse(localStorage.getItem('rmims_manager_disbursements') || '[]');
      const customDisb = JSON.parse(localStorage.getItem('rmims_custom_disbursements') || '[]');
      const disbursements = [...mgrDisb, ...customDisb];
      const seenDisb = new Set();
      disbursements.forEach(d => {
        const key = d.id || d.ref || JSON.stringify(d);
        if (seenDisb.has(key)) return;
        seenDisb.add(key);
        const bLoc = (d.branchLoc || '').trim();
        const bName = (d.branchName || '').trim();
        const user = (d.disbursedBy || '').trim();
        const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
        if (!hasBranch) return;
        const displayUser = user || 'Store Staff';
        const ref = d.ref || '';
        if (['DIS-2026-00091', 'DIS-2026-00088'].includes(ref)) return;

        const dDate = d.disbursementDate || d.date || (d.timestamp ? String(d.timestamp).slice(0, 10) : LIVE_TODAY);
        const itemCount = Array.isArray(d.items) ? d.items.length : 1;
        list.push({
          id: `disb-act-${d.id || d.ref || Math.random()}`,
          timestamp: d.timestamp || (dDate + 'T14:30:00Z'),
          date: dDate,
          dateTimeStr: formatLogTimestamp(d.timestamp || dDate),
          user: user,
          role: 'Staff',
          branchLoc: bLoc,
          branchName: bName || bLoc,
          action: 'Disbursed',
          module: 'Disbursement',
          details: `Disbursed stock (${d.ref || 'Ref'}): ${itemCount} item(s) for ${d.reason || 'Production batch'}.`,
          status: 'success'
        });
      });
    } catch (_) {}

    // 4. Staff Submissions & Transactions
    try {
      const staffTx = JSON.parse(localStorage.getItem('rmims_staff_transactions') || '[]');
      staffTx.forEach(st => {
        const bLoc = (st.branchLoc || '').trim();
        const bName = (st.branchName || '').trim();
        const user = (st.staff || st.user || '').trim();
        const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
        if (!hasBranch) return;
        const displayUser = user || 'Store Staff';
        const ref = st.ref || '';
        if (['REC-2026-00125', 'DIS-2026-00091'].includes(ref)) return;
        if (user.toLowerCase().includes('john reyes') || user.toLowerCase().includes('maria santos')) return;

        const stDate = st.date || (st.timestamp ? String(st.timestamp).slice(0, 10) : LIVE_TODAY);
        list.push({
          id: `staff-act-${st.id || Math.random()}`,
          timestamp: st.timestamp || (stDate + 'T09:00:00Z'),
          date: stDate,
          dateTimeStr: formatLogTimestamp(st.timestamp || stDate),
          user: user,
          role: 'Staff',
          branchLoc: bLoc,
          branchName: bName || bLoc,
          action: st.type === 'disbursement' ? 'Disbursed' : 'Created',
          module: st.type === 'disbursement' ? 'Disbursement' : 'Production',
          details: st.details || st.note || 'Staff transaction submitted.',
          status: 'success'
        });
      });
    } catch (_) {}

    // Sort descending by timestamp / date
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return list;
  }

  function populateBranchFilter(activities = []) {
    if (!branchFilter) return;
    const current = branchFilter.value;
    const branches = new Set();

    // Collect branches from actual registered/pending accounts & live activities
    try {
      const reg = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
      reg.forEach(u => {
        if (u.branchName && u.branchName.trim()) branches.add(u.branchName.trim());
      });
    } catch (_) {}
    try {
      const pend = JSON.parse(localStorage.getItem('rmims_pending_users') || '[]');
      pend.forEach(u => {
        if (u.branchName && u.branchName.trim()) branches.add(u.branchName.trim());
      });
    } catch (_) {}
    try {
      const stores = JSON.parse(localStorage.getItem('RMIMS_BRANCH_STORES_V3') || '{}');
      Object.values(stores).forEach(s => {
        if (s.name && s.name.trim()) branches.add(s.name.trim());
      });
    } catch (_) {}

    activities.forEach(a => {
      if (a.branchName && a.branchName.trim()) branches.add(a.branchName.trim());
    });

    branchFilter.querySelectorAll('option.dynamic-branch').forEach(o => o.remove());

    Array.from(branches).sort().forEach(bName => {
      const opt = document.createElement('option');
      opt.value = bName.toLowerCase();
      opt.textContent = bName;
      opt.className = 'dynamic-branch';
      branchFilter.appendChild(opt);
    });

    if (current && (current === 'all' || branches.has(current) || Array.from(branches).some(b => b.toLowerCase() === current.toLowerCase()))) {
      branchFilter.value = current;
    }
  }

  // Render and update KPI counters
  let currentLogPage = 1;
  const LOGS_PER_PAGE = 10;
  let currentFilteredActivities = [];

  function renderAllActivities() {
    if (!tableBody) return;
    const activities = loadConsolidatedActivities();
    populateBranchFilter(activities);

    // 1. Update KPI Stat Cards
    const totalCount = activities.length;
    const todayCount = activities.filter(a => a.date === LIVE_TODAY).length;
    const loginCount = activities.filter(a => (a.action || '').toLowerCase().includes('login')).length;
    const changesCount = activities.filter(a => {
      const act = (a.action || '').toLowerCase();
      return act.includes('update') || act.includes('create') || act.includes('disburs') || act.includes('receiv') || act.includes('delete');
    }).length;

    if (kpiTotal) kpiTotal.textContent = totalCount.toLocaleString();
    if (kpiToday) kpiToday.textContent = todayCount.toLocaleString();
    if (kpiLogins) kpiLogins.textContent = loginCount.toLocaleString();
    if (kpiChanges) kpiChanges.textContent = changesCount.toLocaleString();

    // 2. Render Table Rows
    if (activities.length === 0) {
      tableBody.innerHTML = `
        <tr id="emptyActivityRow">
          <td colspan="9" style="text-align: center; padding: 48px 16px; color: var(--rm-ink-dim);">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
              <div style="width: 48px; height: 48px; border-radius: 50%; background: #F1F5F9; display: flex; align-items: center; justify-content: center; color: #64748B;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>
              <span style="font-size: 14.5px; font-weight: 600; color: var(--rm-ink);">No Activity Logs Recorded</span>
              <span style="font-size: 12.5px; color: #94A3B8; max-width: 360px;">Inventory adjustments, receipts, disbursements, and account changes will be automatically logged here in real time.</span>
            </div>
          </td>
        </tr>
      `;
      if (counter) counter.textContent = 'Showing 0 activities';
      return;
    }

    filterRows();
  }

  // Filter rows function
  function buildLogPagination(total, perPage) {
    const container = document.getElementById('activityPaginationControls');
    const prevBtn = document.getElementById('btnPrevPage');
    const nextBtn = document.getElementById('btnNextPage');
    if (!container) return;

    // Remove previously generated number buttons
    container.querySelectorAll('.pagination-btn.pg-num').forEach(b => b.remove());

    const totalPages = Math.max(1, Math.ceil(total / perPage));

    if (total === 0) {
      if (prevBtn) {
        prevBtn.disabled = true;
        prevBtn.classList.add('disabled');
      }
      if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.classList.add('disabled');
      }
      const emptyBtn = document.createElement('button');
      emptyBtn.type = 'button';
      emptyBtn.className = 'pagination-btn pg-num disabled';
      emptyBtn.disabled = true;
      emptyBtn.textContent = '1';
      container.insertBefore(emptyBtn, nextBtn);
      return;
    }

    if (prevBtn) {
      prevBtn.disabled = (currentLogPage <= 1);
      if (currentLogPage <= 1) prevBtn.classList.add('disabled');
      else prevBtn.classList.remove('disabled');
      prevBtn.onclick = function() {
        if (currentLogPage > 1) {
          currentLogPage--;
          renderPagedActivities();
        }
      };
    }

    if (nextBtn) {
      nextBtn.disabled = (currentLogPage >= totalPages);
      if (currentLogPage >= totalPages) nextBtn.classList.add('disabled');
      else nextBtn.classList.remove('disabled');
      nextBtn.onclick = function() {
        if (currentLogPage < totalPages) {
          currentLogPage++;
          renderPagedActivities();
        }
      };
    }

    const maxShow = Math.min(totalPages, 5);
    for (let p = 1; p <= maxShow; p++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pagination-btn pg-num' + (p === currentLogPage ? ' active' : '');
      btn.textContent = String(p);
      btn.onclick = (function(page) {
        return function() {
          currentLogPage = page;
          renderPagedActivities();
        };
      })(p);
      container.insertBefore(btn, nextBtn);
    }
  }

  function renderPagedActivities() {
    if (!tableBody) return;
    const total = currentFilteredActivities.length;
    const totalPages = Math.max(1, Math.ceil(total / LOGS_PER_PAGE));
    if (currentLogPage > totalPages) currentLogPage = totalPages;
    if (currentLogPage < 1) currentLogPage = 1;

    if (total === 0) {
      tableBody.innerHTML = `
        <tr id="emptyActivityRow">
          <td colspan="9" style="text-align: center; padding: 48px 16px; color: var(--rm-ink-dim);">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
              <span style="font-size: 14.5px; font-weight: 600; color: var(--rm-ink);">No Matching Activity Records</span>
              <span style="font-size: 12.5px; color: #94A3B8;">No log entries match the selected branch, role, date, or search filter.</span>
            </div>
          </td>
        </tr>
      `;
      if (counter) counter.textContent = 'Showing 0 of 0 activities';
      buildLogPagination(0, LOGS_PER_PAGE);
      return;
    }

    const startIdx = (currentLogPage - 1) * LOGS_PER_PAGE;
    const endIdx = Math.min(startIdx + LOGS_PER_PAGE, total);
    const paged = currentFilteredActivities.slice(startIdx, endIdx);

    tableBody.innerHTML = paged.map(act => {
      const locRaw = (act.branchLoc || '').trim();
      let locClass = 'neutral';
      if (locRaw.toLowerCase().includes('lucena')) locClass = 'lucena';
      else if (locRaw.toLowerCase().includes('tiaong')) locClass = 'tiaong';
      else if (locRaw.toLowerCase().includes('hq') || locRaw.toLowerCase().includes('headquarter')) locClass = 'hq';
      let locBadgeText = locRaw || '—';
      if (locBadgeText.toLowerCase().includes('lucena')) locBadgeText = 'Lucena';
      else if (locBadgeText.toLowerCase().includes('tiaong')) locBadgeText = 'Tiaong';
      else if (locBadgeText.toLowerCase().includes('hq') || locBadgeText.toLowerCase().includes('headquarter')) locBadgeText = 'Headquarters';
      const roleClass = (act.role || 'Staff').toLowerCase();
      const actionRaw = (act.action || 'Updated').toLowerCase();
      
      let actionTagClass = 'updated';
      if (actionRaw.includes('login')) actionTagClass = 'login';
      else if (actionRaw.includes('creat')) actionTagClass = 'created';
      else if (actionRaw.includes('delet') || actionRaw.includes('reject')) actionTagClass = 'deleted';
      else if (actionRaw.includes('disburs')) actionTagClass = 'disbursed';
      else if (actionRaw.includes('receiv')) actionTagClass = 'received';
      else if (actionRaw.includes('view')) actionTagClass = 'viewed';

      const branchNameClean = (act.branchName || act.branch || '').trim();
      const branchAttr = branchNameClean.toLowerCase();
      const statusPillClass = act.status === 'failed' ? 'status-failed' : 'status-success';
      const statusText = act.status === 'failed' ? 'Failed' : 'Success';

      return `
        <tr data-branch="${escapeHtml(branchAttr || locClass)}" data-branch-loc="${locClass}" data-branch-name="${escapeHtml(branchAttr)}" data-role="${roleClass}" data-action="${actionTagClass}" data-status="${act.status === 'failed' ? 'failed' : 'success'}" data-date="${escapeHtml(act.date)}">
          <td>${escapeHtml(act.dateTimeStr)}</td>
          <td>
            <div class="user-cell">
              <div class="user-initial-chip">${getInitials(act.user)}</div>
              <strong>${escapeHtml(act.user)}</strong>
            </div>
          </td>
          <td><span class="role-pill ${roleClass}">${escapeHtml(act.role)}</span></td>
          <td><span class="location-badge ${locClass}">${escapeHtml(locBadgeText)}</span></td>
          <td>${escapeHtml(act.branchName)}</td>
          <td><span class="action-tag ${actionTagClass}">${escapeHtml(act.action)}</span></td>
          <td><strong>${escapeHtml(act.module)}</strong></td>
          <td>${escapeHtml(act.details)}</td>
          <td><span class="status-pill ${statusPillClass}">${statusText}</span></td>
        </tr>
      `;
    }).join('');

    if (counter) {
      counter.textContent = `Showing ${startIdx + 1} to ${endIdx} of ${total} activities`;
    }
    buildLogPagination(total, LOGS_PER_PAGE);
  }

  function filterRows() {
    const activities = loadConsolidatedActivities();
    const branchVal = branchFilter ? branchFilter.value : 'all';
    const roleVal = roleFilter ? roleFilter.value : 'all';
    const actionVal = actionFilter ? actionFilter.value : 'all';
    const statusVal = statusFilter ? statusFilter.value : 'all';

    const q1 = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const q2 = topSearchInput ? topSearchInput.value.toLowerCase().trim() : '';
    const query = q1 || q2;

    currentFilteredActivities = activities.filter(act => {
      const bVal = (branchVal || 'all').toLowerCase();
      const rowBranch = (act.branchName || '').toLowerCase();
      const rowLoc = (act.branchLoc || '').toLowerCase();
      const branchMatch = bVal === 'all' || 
        rowBranch === bVal || 
        rowLoc === bVal ||
        rowBranch.includes(bVal) ||
        rowLoc.includes(bVal);

      const rVal = (roleVal || 'all').toLowerCase();
      const actRole = (act.role || '').toLowerCase();
      const roleMatch = rVal === 'all' || actRole === rVal || actRole.includes(rVal);

      const aVal = (actionVal || 'all').toLowerCase();
      const actAction = (act.action || '').toLowerCase();
      const actionMatch = aVal === 'all' || actAction === aVal || actAction.includes(aVal);

      const sVal = (statusVal || 'all').toLowerCase();
      const actStatus = (act.status || '').toLowerCase();
      const statusMatch = sVal === 'all' || actStatus === sVal;

      const fullText = `${act.user || ''} ${act.action || ''} ${act.details || ''} ${act.module || ''} ${act.branchName || ''} ${act.branchLoc || ''}`.toLowerCase();
      const queryMatch = !query || fullText.includes(query);

      let dateMatch = true;
      if (appliedFilter && appliedFilter.start) {
        if (act.date) {
          if (appliedFilter.mode === 'single') {
            dateMatch = (act.date === appliedFilter.start);
          } else {
            dateMatch = (act.date >= appliedFilter.start && act.date <= appliedFilter.end);
          }
        }
      }

      return branchMatch && roleMatch && actionMatch && statusMatch && queryMatch && dateMatch;
    });

    currentLogPage = 1;
    renderPagedActivities();
  }

  // Event Listeners for Filters
  if (branchFilter) branchFilter.addEventListener('change', filterRows);
  if (roleFilter) roleFilter.addEventListener('change', filterRows);
  if (actionFilter) actionFilter.addEventListener('change', filterRows);
  if (statusFilter) statusFilter.addEventListener('change', filterRows);
  if (searchInput) searchInput.addEventListener('input', filterRows);
  if (topSearchInput) {
    topSearchInput.addEventListener('input', () => {
      if (searchInput) searchInput.value = topSearchInput.value;
      filterRows();
    });
  }

  // Clear Filters
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (branchFilter) branchFilter.value = 'all';
      if (roleFilter) roleFilter.value = 'all';
      if (actionFilter) actionFilter.value = 'all';
      if (statusFilter) statusFilter.value = 'all';
      if (searchInput) searchInput.value = '';
      if (topSearchInput) topSearchInput.value = '';

      // Reset date popover
      appliedFilter = {
        mode: 'single',
        start: LIVE_TODAY,
        end: LIVE_TODAY
      };
      if (calPicker) {
        calPicker.setSelection(LIVE_TODAY, null, LIVE_TODAY_LABEL);
      }

      filterRows();
      if (window.showAdminToast) {
        window.showAdminToast('All activity filters have been reset.');
      }
    });
  }

  // Export CSV
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      if (window.showAdminToast) {
        window.showAdminToast('Exporting activity log records to CSV...', 'success');
      }
      setTimeout(() => {
        const rows = [];
        rows.push(['Date & Time', 'User', 'Role', 'Branch Location', 'Branch Name', 'Action', 'Module', 'Details', 'Status']);

        table.querySelectorAll('tbody tr').forEach(tr => {
          if (tr.id === 'emptyActivityRow') return;
          if (tr.style.display !== 'none') {
            const cols = Array.from(tr.querySelectorAll('td')).map(td => {
              return td.textContent.trim().replace(/\s+/g, ' ');
            });
            rows.push(cols);
          }
        });

        if (rows.length <= 1) {
          if (window.showAdminToast) window.showAdminToast('No activity logs available to export.', 'danger');
          return;
        }

        const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.map(item => `"${item}"`).join(',')).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `RMIMS_Activity_Log_Records_${getLiveTodayISO()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, 500);
    });
  }

  // Initial Local Render
  renderAllActivities();

  // Asynchronously query Supabase for live managerial & staff transactions and audit trails
  import('../supabase/admin-supabase-service.js')
    .then(srv => {
      // 1. Fetch live system activities from Supabase
      srv.fetchLiveSystemActivities().then(liveLogs => {
        if (liveLogs && liveLogs.length > 0) {
          renderAllActivities();
        }
      }).catch(() => {});

      // 2. Real-time live websocket sync across devices
      srv.subscribeToAdminFeed(({ table }) => {
        if (table === 'stock_receipts' || table === 'material_disbursements' || table === 'admin_activity_logs') {
          srv.fetchLiveSystemActivities().then(() => {
            renderAllActivities();
          }).catch(() => {});
        }
      });
    })
    .catch(() => {});

  // Inter-tab user mutation synchronization
  try {
    const bc = new BroadcastChannel('rmims_user_sync');
    bc.onmessage = () => {
      populateBranchFilter();
      renderAllActivities();
    };
  } catch (_) {}

  window.addEventListener('rmims_inventory_updated', renderAllActivities);
  window.addEventListener('storage', (e) => {
    if (e.key === 'rmims_manager_activities' || e.key === 'rmims_manager_receipts' || e.key === 'rmims_manager_disbursements' || e.key === 'rmims_staff_transactions') {
      renderAllActivities();
    }
  });
});
