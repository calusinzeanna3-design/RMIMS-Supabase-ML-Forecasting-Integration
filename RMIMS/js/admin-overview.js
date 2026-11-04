// RMIMS Main Administration Overview Controller
// Initializes the Branch Stores Usage Chart using authentic RMIMS Emerald styling,
// handles chart timeframes, interactive account approvals, real-time system alerts, and overview search.

import { getAdminActivityList } from './admin-activity-feed.js';
import { maskOperationalDetails } from './admin-privacy.js';
import { getAlerts, getCategoryCounts, getDiagnosticRecipient, formatCleanBranchLocation } from './system-alerts-service.js';
import { initAdminCalendarPicker, MONTH_NAMES_SHORT, getLiveTodayISO, getDaysAgoISO, formatDisplayDate } from './admin-calendar-picker.js';
import { getStoresData } from './admin-branch-stores.js';
import {
  STORAGE_KEYS,
  isMockUser,
  matchesUser,
  broadcastUserSync,
  fetchPendingApprovals,
  fetchRegisteredUsers,
  fetchBranchStores,
  fetchLiveSystemActivities,
  approveUserAccount as srvApproveUser,
  rejectUserAccount as srvRejectUser,
  subscribeToAdminFeed
} from '../supabase/admin-supabase-service.js';

// Rebuild a block only when its content really changed (an identical rebuild restarts animations = flicker)
function setHtmlIfChanged(el, html) {
  if (!el) return;
  if (el.__rmimsHtml === html) return;
  el.__rmimsHtml = html;
  el.innerHTML = html;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJs(str) {
  return String(str || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getStoredPendingUsers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PENDING_USERS) || '[]';
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];

    let approved = [];
    let rejected = [];
    try { approved = JSON.parse(localStorage.getItem(STORAGE_KEYS.APPROVED_USERS) || '[]'); } catch (_) {}
    try { rejected = JSON.parse(localStorage.getItem(STORAGE_KEYS.REJECTED_USERS) || '[]'); } catch (_) {}

    return list.filter(u => {
      if (!u || isMockUser(u)) return false;
      if (approved.some(a => matchesUser(a, u))) return false;
      if (rejected.some(r => matchesUser(r, u))) return false;
      return true;
    });
  } catch (_) {
    return [];
  }
}

function saveStoredPendingUsers(users) {
  try {
    localStorage.setItem(STORAGE_KEYS.PENDING_USERS, JSON.stringify(users));
    window.dispatchEvent(new Event('rmims_pending_users_updated'));
    window.dispatchEvent(new Event('storage'));
  } catch (e) {
    console.warn('Failed saving pending users:', e);
  }
}

function logSystemActivity(action, details) {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVITY_LOGS) || '[]');
    list.unshift({
      id: `act-${Date.now()}`,
      timestamp: new Date().toISOString(),
      date: getLiveTodayISO(),
      user: 'Admin',
      role: 'Main Admin',
      branch: 'Headquarters',
      branchLoc: 'Headquarters',
      branchName: 'Headquarters',
      action: action,
      module: 'User Management',
      details: details,
      status: 'success'
    });
    localStorage.setItem(STORAGE_KEYS.ACTIVITY_LOGS, JSON.stringify(list.slice(0, 50)));
    window.dispatchEvent(new Event('storage'));
  } catch (_) {}
}

window.approveOverviewAccount = async function (userId, statusId, actionsId, userName) {
  const statusEl = document.getElementById(statusId);
  const actionsEl = document.getElementById(actionsId);

  if (statusEl) {
    statusEl.className = 'status-pill status-active';
    statusEl.textContent = 'Approved';
  }

  if (actionsEl) {
    actionsEl.innerHTML = `
      <span style="font-size: 12px; font-weight: 600; color: #16A34A; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: #DCFCE7; border-radius: 6px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Approved
      </span>
    `;
  }

  const currentPending = getStoredPendingUsers();
  const cleanId = String(userId || '').trim();
  const cleanName = String(userName || '').toLowerCase().trim();
  const approvedItem = currentPending.find(u => matchesUser({ id: cleanId, name: cleanName }, u));

  const resolvedName = userName || approvedItem?.name || 'User';
  const resolvedRole = approvedItem?.role || 'Staff';
  const resolvedEmail = approvedItem?.email || '';
  const resolvedUser = approvedItem?.username || (resolvedEmail ? resolvedEmail.split('@')[0] : 'user');
  const resolvedBranchLoc = approvedItem?.branchLoc || 'Lucena';
  const resolvedBranchName = approvedItem?.branchName || 'Branch Store';

  // Delegate to unified, bulletproof approveUserAccount
  try {
    const syncRes = await srvApproveUser({
      id: approvedItem?.id || cleanId,
      email: resolvedEmail,
      username: resolvedUser,
      name: resolvedName,
      role: resolvedRole,
      branchLoc: resolvedBranchLoc,
      branchName: resolvedBranchName
    });

    if (typeof window.showAdminToast === 'function') {
      window.showAdminToast(`Account for ${resolvedName} approved and synchronized with Supabase (Active).`, 'success');
    }
  } catch (err) {
    if (typeof window.showAdminToast === 'function') {
      window.showAdminToast(`Account for ${resolvedName} approved successfully.`, 'success');
    }
  }

  setTimeout(() => {
    renderOverviewPendingApprovals();
    renderOverviewLatestActivities();
    renderOverviewBranchStores();
    if (typeof updateOverviewKPICounters === 'function') updateOverviewKPICounters();
  }, 400);
};

window.rejectOverviewAccount = async function (userId, statusId, actionsId, userName) {
  const statusEl = document.getElementById(statusId);
  const actionsEl = document.getElementById(actionsId);

  if (statusEl) {
    statusEl.className = 'status-pill status-cancelled';
    statusEl.textContent = 'Rejected';
  }

  if (actionsEl) {
    actionsEl.innerHTML = `
      <span style="font-size: 12px; font-weight: 600; color: #DC2626; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: #FEE2E2; border-radius: 6px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        Rejected
      </span>
    `;
  }

  const currentPending = getStoredPendingUsers();
  const cleanId = String(userId || '').trim();
  const cleanName = String(userName || '').toLowerCase().trim();
  const target = currentPending.find(u => matchesUser({ id: cleanId, name: cleanName }, u));

  const resolvedName = userName || target?.name || 'User';

  try {
    await srvRejectUser({
      id: target?.id || cleanId,
      email: target?.email,
      username: target?.username,
      name: resolvedName
    });
  } catch (err) {
    console.warn('[AdminOverview] Rejection notice:', err.message || err);
  }

  if (typeof window.showAdminToast === 'function') {
    window.showAdminToast(`Account request for ${resolvedName} rejected.`, 'danger');
  }

  setTimeout(() => {
    renderOverviewPendingApprovals();
    if (typeof updateOverviewKPICounters === 'function') updateOverviewKPICounters();
  }, 400);
};

// Aliases for unified cross-component compatibility
window.approveUser = window.approveOverviewAccount;
window.rejectUser = window.rejectOverviewAccount;

// Delegated click handler for overview pending approval buttons
document.addEventListener('click', async (e) => {
  const approveBtn = e.target.closest('.btn-approve');
  if (approveBtn && !approveBtn.closest('#usersDirectoryTable')) {
    const row = approveBtn.closest('tr');
    const param = approveBtn.getAttribute('data-id') || row?.getAttribute('data-id') || row?.id;
    if (param && typeof window.approveOverviewAccount === 'function') {
      const statusId = row?.querySelector('.status-pill')?.id || '';
      const actionsId = row?.querySelector('.action-btn-group')?.id || '';
      const userName = row?.getAttribute('data-name') || '';
      e.preventDefault();
      e.stopPropagation();
      await window.approveOverviewAccount(param, statusId, actionsId, userName);
    }
  }
  const rejectBtn = e.target.closest('.btn-reject');
  if (rejectBtn && !rejectBtn.closest('#usersDirectoryTable')) {
    const row = rejectBtn.closest('tr');
    const param = rejectBtn.getAttribute('data-id') || row?.getAttribute('data-id') || row?.id;
    if (param && typeof window.rejectOverviewAccount === 'function') {
      const statusId = row?.querySelector('.status-pill')?.id || '';
      const actionsId = row?.querySelector('.action-btn-group')?.id || '';
      const userName = row?.getAttribute('data-name') || '';
      e.preventDefault();
      e.stopPropagation();
      await window.rejectOverviewAccount(param, statusId, actionsId, userName);
    }
  }
});


function renderOverviewPendingApprovals() {
  const tbody = document.getElementById('overviewApprovalTableBody');
  const countBadge = document.getElementById('overviewPendingCount');
  if (!tbody) return;

  const pendingList = getStoredPendingUsers();

  if (countBadge) {
    countBadge.textContent = `${pendingList.length} Request${pendingList.length === 1 ? '' : 's'} Pending`;
    if (pendingList.length === 0) {
      countBadge.classList.remove('status-pending');
      countBadge.classList.add('status-resolved');
    } else {
      countBadge.classList.remove('status-resolved');
      countBadge.classList.add('status-pending');
    }
  }

  if (pendingList.length === 0) {
    setHtmlIfChanged(tbody, `
      <tr>
        <td colspan="7" style="text-align: center; padding: 36px 16px; color: var(--rm-ink-dim);">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: #94A3B8;">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="8.5" cy="7" r="4"/>
              <polyline points="17 11 19 13 23 9"/>
            </svg>
            <span style="font-size: 13.5px; font-weight: 500; color: var(--rm-ink);">No pending account requests awaiting approval</span>
            <span style="font-size: 12px; color: #94A3B8;">Branch personnel registrations requiring admin validation will appear here.</span>
          </div>
        </td>
      </tr>
    `);
    return;
  }

  setHtmlIfChanged(tbody, pendingList.map(u => {
    const locRaw = (u.branchLoc || '').trim();
    let locClass = 'neutral';
    if (locRaw.toLowerCase().includes('lucena')) locClass = 'lucena';
    else if (locRaw.toLowerCase().includes('tiaong')) locClass = 'tiaong';
    const locBadgeText = locRaw || '—';
    const roleText = u.role || 'Staff';
    const initials = getInitials(u.name);
    const rowId = `ovRow_${u.id}`;
    const statusId = `ovStat_${u.id}`;
    const actionsId = `ovAct_${u.id}`;

    return `
      <tr id="${rowId}">
        <td>
          <div class="user-cell">
            <div class="user-initial-chip">${initials}</div>
            <strong>${escapeHtml(u.name)}</strong>
          </div>
        </td>
        <td><span class="location-badge ${locClass}">${escapeHtml(locBadgeText)}</span></td>
        <td>${escapeHtml(u.branchName || 'Store Branch')}</td>
        <td>${escapeHtml(roleText)}</td>
        <td>${escapeHtml(u.requestedOn ? (u.requestedOn.includes('T') ? formatDisplayDate(u.requestedOn) : u.requestedOn) : formatDisplayDate(getLiveTodayISO()))}</td>
        <td><span class="status-pill status-pending" id="${statusId}">Pending</span></td>
        <td>
          <div class="action-btn-group" id="${actionsId}">
            <button type="button" class="btn-approve" onclick="window.approveOverviewAccount('${escapeJs(u.id)}', '${statusId}', '${actionsId}', '${escapeJs(u.name)}')">Approve</button>
            <button type="button" class="btn-reject" onclick="window.rejectOverviewAccount('${escapeJs(u.id)}', '${statusId}', '${actionsId}', '${escapeJs(u.name)}')">Reject</button>
          </div>
        </td>
      </tr>
    `;
  }).join(''));
}

function formatLogTime(ts) {
  if (!ts) return formatDisplayDate(getLiveTodayISO()) + ' 09:00 AM';
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

function renderOverviewLatestActivities() {
  const tbody = document.getElementById('overviewActivityTableBody');
  if (!tbody) return;

  // Same synced feed as the Activity Logs module (admin-activity-feed.js), newest first
  const list = getAdminActivityList();

  if (list.length === 0) {
    setHtmlIfChanged(tbody, `
      <tr>
        <td colspan="6" style="text-align: center; padding: 36px 16px; color: var(--rm-ink-dim);">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <div style="width: 40px; height: 40px; border-radius: 50%; background: #F1F5F9; display: flex; align-items: center; justify-content: center; color: #94A3B8;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <span style="font-size: 13.5px; font-weight: 500; color: var(--rm-ink);">No recent activity logs recorded</span>
            <span style="font-size: 12px; color: #94A3B8;">Activities and transactions will automatically appear here once users begin operating the system.</span>
          </div>
        </td>
      </tr>
    `);
    return;
  }

  setHtmlIfChanged(tbody, list.slice(0, 5).map(act => {
    const locRaw = (act.branchLoc || '').trim();
    let locClass = 'neutral';
    if (locRaw.toLowerCase().includes('lucena')) locClass = 'lucena';
    else if (locRaw.toLowerCase().includes('tiaong')) locClass = 'tiaong';
    const locBadgeText = locRaw || '—';
    const actionRaw = (act.action || 'Updated').toLowerCase();
    let actionTagClass = 'updated';
    if (actionRaw.includes('login')) actionTagClass = 'login';
    else if (actionRaw.includes('creat')) actionTagClass = 'created';
    else if (actionRaw.includes('delet') || actionRaw.includes('reject')) actionTagClass = 'deleted';
    else if (actionRaw.includes('disburs')) actionTagClass = 'disbursed';

    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-initial-chip">${getInitials(act.user)}</div>
            <strong>${escapeHtml(act.user)}</strong>
          </div>
        </td>
        <td><span class="action-tag ${actionTagClass}">${escapeHtml(act.action)}</span></td>
        <td><span class="location-badge ${locClass}">${escapeHtml(locBadgeText)}</span></td>
        <td>${escapeHtml(act.branchName)}</td>
        <td>${escapeHtml(maskOperationalDetails(act.details))}</td>
        <td>${escapeHtml(formatLogTime(act.timestamp))}</td>
      </tr>
    `;
  }).join(''));
}

function renderOverviewBranchStores() {
  const tbody = document.getElementById('overviewBranchStoresTbody');
  if (!tbody) return;

  const stores = getStoresData();
  const storeList = Object.values(stores);

  if (storeList.length === 0) {
    setHtmlIfChanged(tbody, `
      <tr>
        <td colspan="5" style="text-align: center; padding: 32px 16px; color: var(--rm-ink-dim);">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: #94A3B8;">
              <path d="M3 21h18"/>
              <path d="M3 7v14"/>
              <path d="M21 7v14"/>
              <path d="M2 7l10-4 10 4"/>
            </svg>
            <span style="font-size: 13.5px; font-weight: 500; color: var(--rm-ink);">No branch stores registered yet</span>
            <span style="font-size: 12px; color: #94A3B8;">Store locations registered in Branch Stores will appear here.</span>
          </div>
        </td>
      </tr>
    `);
    return;
  }

  setHtmlIfChanged(tbody, storeList.map(s => {
    const locRaw = (s.location || s.locKey || '').trim();
    let locClass = 'neutral';
    if (locRaw.toLowerCase().includes('lucena')) locClass = 'lucena';
    else if (locRaw.toLowerCase().includes('tiaong')) locClass = 'tiaong';
    const locBadgeText = locRaw || '—';
    const mgrName = (s.managers && s.managers[0] && s.managers[0].name) ? s.managers[0].name : (s.manager || 'Unassigned');
    const staffCount = ((s.managers || []).length + (s.staff || []).length);

    return `
      <tr>
        <td><span class="location-badge ${locClass}">${escapeHtml(locBadgeText)}</span></td>
        <td>
          <div>
            <strong>${escapeHtml(s.name)}</strong>
            <div style="font-size: 11.5px; color: var(--rm-ink-dim);">${escapeHtml(s.category || 'Store Hub')}</div>
          </div>
        </td>
        <td>${escapeHtml(mgrName)}</td>
        <td>${staffCount} Employee${staffCount === 1 ? '' : 's'}</td>
        <td><span class="status-pill status-${(s.status || 'active').toLowerCase()}">${escapeHtml(s.status || 'Active')}</span></td>
      </tr>
    `;
  }).join(''));
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('branchUsageChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // RMIMS Emerald Gradient for Store 1
  const gradEmerald = ctx.createLinearGradient(0, 0, 0, 240);
  gradEmerald.addColorStop(0, 'rgba(16, 185, 129, 0.28)');
  gradEmerald.addColorStop(1, 'rgba(16, 185, 129, 0.02)');

  // RMIMS Sky/Teal Gradient for Store 2
  const gradSky = ctx.createLinearGradient(0, 0, 0, 240);
  gradSky.addColorStop(0, 'rgba(20, 83, 45, 0.22)');
  gradSky.addColorStop(1, 'rgba(20, 83, 45, 0.02)');

  // Initial stores from storage
  const initialStores = getStoresData();
  const initStoreList = Object.values(initialStores);

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false // Using custom styled legend matching the mockup
        },
        tooltip: {
          backgroundColor: 'rgba(17, 22, 27, 0.94)',
          titleFont: { family: 'Inter', size: 12, weight: '700' },
          bodyFont: { family: 'Inter', size: 12 },
          padding: 12,
          cornerRadius: 10,
          boxPadding: 6,
          usePointStyle: true,
          callbacks: {
            label: function (context) {
              return ` ${context.dataset.label.split(' ')[0]}: ${context.parsed.y} active users`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: true,
            color: 'rgba(20, 83, 45, 0.06)'
          },
          ticks: {
            color: '#5C7A68',
            font: { family: 'Inter', size: 11, weight: '500' }
          }
        },
        y: {
          beginAtZero: true,
          max: 100,
          grid: {
            color: 'rgba(20, 83, 45, 0.08)'
          },
          ticks: {
            stepSize: 20,
            color: '#5C7A68',
            font: { family: 'Inter', size: 11, weight: '500' }
          },
          title: {
            display: true,
            text: 'Active Users',
            color: '#5C7A68',
            font: { family: 'Inter', size: 11, weight: '600' }
          }
        }
      }
    }
  });

  // ─── Dynamic Custom Legend Builder ───────────────────────────────────────
  // Populates the #branchUsageChartLegend container from live chart dataset
  // labels and colors — no hardcoded branch names.
  const DATASET_COLORS = ['#10B981', '#14532D', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
  function buildChartLegend() {
    const legendEl = document.getElementById('branchUsageChartLegend');
    if (!legendEl) return;
    if (!chart || !chart.data || !chart.data.datasets || chart.data.datasets.length === 0) {
      setHtmlIfChanged(legendEl, '<span style="color:var(--rm-ink-dim,#5C7A68);font-size:12px;">No branches registered</span>');
      return;
    }
    setHtmlIfChanged(legendEl, chart.data.datasets.map((ds, i) => {
      const color = ds.borderColor || DATASET_COLORS[i % DATASET_COLORS.length];
      const label = ds.label || `Branch Store ${i + 1}`;
      return `<div class="legend-item">
        <span class="legend-dot" style="background:${color};"></span>
        <span>${label}</span>
      </div>`;
    }).join(''));
  }
  buildChartLegend();

  // Range dropdown & Calendar Popover Integration
  const rangeSelect = document.getElementById('chartRangeSelect');
  const dateRangeSpan = document.getElementById('usageDateRangeSpan');
  const kpiUsers = document.getElementById('kpiActiveUsersToday');
  const kpiActions = document.getElementById('kpiSystemActionsToday');

  const popover = document.getElementById('datePickerPopoverOverview');
  const triggerBtn = document.getElementById('btnToggleDateRangeOverview');

  let calendarPickerInstance = null;

  // Build real activity counts per label slot from localStorage records
  function buildRealChartDataForStore(storeKey, labels, startDate, endDate, diffDays) {
    const allLogs = [];
    try { allLogs.push(...JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]')); } catch (_) {}
    try { allLogs.push(...JSON.parse(localStorage.getItem('rmims_manager_receipts') || '[]')); } catch (_) {}
    try { allLogs.push(...JSON.parse(localStorage.getItem('rmims_manager_disbursements') || '[]')); } catch (_) {}
    try { allLogs.push(...JSON.parse(localStorage.getItem('rmims_staff_transactions') || '[]')); } catch (_) {}

    // Filter by store key or branch name/loc match
    const storeLogs = allLogs.filter(entry => {
      const bLoc = (entry.branchLoc || entry.branch || '').trim();
      const bName = (entry.branchName || '').trim();
      if (!bLoc && !bName) return false;
      const locStr = bLoc.toLowerCase();
      const nameStr = bName.toLowerCase();
      return storeKey === 'all' || locStr.includes(storeKey.toLowerCase()) || nameStr.includes(storeKey.toLowerCase());
    });

    if (diffDays === 1) {
      // Count by 2-hour blocks: 8AM, 10AM, 12PM, 2PM, 4PM, 6PM, 8PM
      const hours = [8, 10, 12, 14, 16, 18, 20];
      return hours.map(h => storeLogs.filter(e => {
        const d = new Date(e.timestamp || (e.date + 'T00:00:00Z'));
        return d.toISOString().slice(0, 10) === startDate.toISOString().slice(0, 10) && d.getHours() >= h && d.getHours() < h + 2;
      }).length);
    } else {
      // Count per label date
      return labels.map(label => {
        return storeLogs.filter(e => {
          const ts = e.timestamp || ((e.date || e.receiptDate || e.disbursementDate || '') + 'T00:00:00Z');
          const entryDate = new Date(ts).toISOString().slice(0, 10);
          // Match label to date (label is like 'Jan 01' or 'Sep 30')
          const labelDate = new Date(ts);
          const labelStr = `${MONTH_NAMES_SHORT[labelDate.getMonth()]} ${String(labelDate.getDate()).padStart(2, '0')}`;
          return labelStr === label;
        }).length;
      });
    }
  }

  // ─── Role usage lines: distinct active users per day, by system role (shared admin activity feed) ───
  const ROLE_SERIES = {
    total:   { label: 'Total (All Roles)', color: '#10B981', fill: 'rgba(16, 185, 129, 0.10)' },
    admin:   { label: 'Admin',             color: '#F87171', fill: 'rgba(248, 113, 113, 0.12)' },
    manager: { label: 'Manager',           color: '#4ADE80', fill: 'rgba(20, 83, 45, 0.12)' },
    staff:   { label: 'Staff',             color: '#FBBF24', fill: 'rgba(251, 191, 36, 0.14)' }
  };
  const roleSelect = document.getElementById('chartRoleSelect');
  let lastRange = null;

  function roleKeyOf(role) {
    const r = String(role || '').toLowerCase();
    if (r.includes('admin')) return 'admin';
    if (r.includes('manager')) return 'manager';
    if (r.includes('staff') || r === 'user') return 'staff';
    return '';
  }
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function updateOverviewChartForRange(startStr, endStr) {
    if (!startStr) return;
    lastRange = [startStr, endStr];
    const startDate = new Date(startStr + 'T00:00:00');
    const endDate = endStr ? new Date(endStr + 'T00:00:00') : new Date(startStr + 'T00:00:00');
    const diffDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);

    // Every date in the range is shown on the axis (no sampling)
    const dayKeys = [];
    const labels = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dayKeys.push(ymd(d));
      labels.push(`${MONTH_NAMES_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`);
    }

    // distinct active users per day per role
    const sets = { admin: new Map(), manager: new Map(), staff: new Map() };
    getAdminActivityList().forEach(a => {
      const rk = roleKeyOf(a.role);
      if (!rk) return;
      const t = new Date(a.timestamp || (a.date + 'T00:00:00'));
      if (isNaN(t.getTime())) return;
      const k = ymd(t);
      const who = String(a.user || '').trim().toLowerCase();
      if (!who || who === '—') return;
      if (!sets[rk].has(k)) sets[rk].set(k, new Set());
      sets[rk].get(k).add(who);
    });
    const series = {};
    ['admin', 'manager', 'staff'].forEach(rk => { series[rk] = dayKeys.map(k => (sets[rk].get(k) || new Set()).size); });
    series.total = dayKeys.map((_, i) => series.admin[i] + series.manager[i] + series.staff[i]);

    const sel = roleSelect ? roleSelect.value : 'general';
    const keys = sel === 'general' ? ['total', 'admin', 'manager', 'staff'] : [sel];

    updateOverviewKPICounters();

    // Same numbers as what is already drawn: leave the chart alone (no redraw, no re-animation)
    const signature = JSON.stringify([labels, keys, keys.map(k => series[k])]);
    if (chart.__rmimsSig === signature) return;
    const sameShape = chart.__rmimsShape === JSON.stringify([labels, keys]);
    chart.__rmimsSig = signature;
    chart.__rmimsShape = JSON.stringify([labels, keys]);
    if (sameShape && chart.data.datasets.length === keys.length) {
      // only the values changed: move the existing lines to the new values smoothly
      keys.forEach((k, i) => { chart.data.datasets[i].data = series[k]; });
      const peakNow = Math.max(1, ...keys.flatMap(k => series[k]));
      chart.options.scales.y.suggestedMax = peakNow + 1;
      chart.options.scales.y.ticks.stepSize = peakNow > 10 ? undefined : 1;
      chart.update();
      return;
    }

    chart.data.labels = labels;
    chart.data.datasets = keys.map(k => ({
      label: ROLE_SERIES[k].label,
      data: series[k],
      borderColor: ROLE_SERIES[k].color,
      backgroundColor: ROLE_SERIES[k].fill,
      borderWidth: k === 'total' ? 2.8 : 2.4,
      fill: k === 'total' || keys.length === 1,
      tension: 0.3,
      cubicInterpolationMode: 'monotone',
      pointRadius: diffDays > 31 ? 2 : 3.5,
      pointHoverRadius: 6,
      pointBackgroundColor: ROLE_SERIES[k].color,
      pointBorderColor: '#FFFFFF',
      pointBorderWidth: 2
    }));
    const peak = Math.max(1, ...keys.flatMap(k => series[k]));
    chart.options.scales.y.max = undefined;
    chart.options.scales.y.suggestedMax = peak + 1;
    chart.options.scales.y.ticks.stepSize = peak > 10 ? undefined : 1;
    chart.options.scales.y.ticks.precision = 0;
    chart.options.scales.x.ticks.autoSkip = false;
    chart.options.scales.x.ticks.maxRotation = diffDays > 14 ? 60 : 0;
    chart.options.scales.x.ticks.minRotation = diffDays > 14 ? 45 : 0;
    chart.options.plugins.tooltip.callbacks.label = (c) => ` ${c.dataset.label}: ${c.parsed.y} active user${c.parsed.y === 1 ? '' : 's'}`;
    chart.update();
    buildChartLegend();
  }

  if (roleSelect) {
    roleSelect.addEventListener('change', () => { if (lastRange) updateOverviewChartForRange(lastRange[0], lastRange[1]); });
  }

  function updateOverviewKPICounters() {
    // 1. Live Active Users (Directory active accounts + registered custom accounts + branch personnel)
    try {
      const userSet = new Set();
      const customUsers = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
      let deletedUsers = [];
      let rejectedUsers = [];
      try { deletedUsers = JSON.parse(localStorage.getItem('rmims_deleted_users') || '[]'); } catch (_) {}
      try { rejectedUsers = JSON.parse(localStorage.getItem('rmims_rejected_users') || '[]'); } catch (_) {}

      const mockUserTokens = [
        'maria santos', 'kenneth ramos', 'rafael cruz', 'alyssa lim', 'carla mendoza',
        'carlos mendoza', 'john doe', 'jane doe', 'test user', 'dummy'
      ];

      customUsers
        .filter(u => u && !mockUserTokens.some(tok => (u.name || u.username || u.email || '').toLowerCase().includes(tok)))
        .filter(u => !deletedUsers.some(d => (d.id && d.id === u.id) || (d.email && u.email && d.email.toLowerCase() === u.email.toLowerCase())))
        .filter(u => !rejectedUsers.some(r => (r.id && r.id === u.id) || (r.email && u.email && r.email.toLowerCase() === u.email.toLowerCase())))
        .filter(u => u.status === 'Active' || !u.status)
        .forEach(u => userSet.add((u.email || u.username || u.name).toLowerCase()));
      
      const stores = getStoresData();
      Object.values(stores).forEach(st => {
        (st.managers || [])
          .filter(m => !deletedUsers.some(d => (d.id && d.id === m.id) || (d.email && m.email && d.email.toLowerCase() === m.email.toLowerCase())))
          .forEach(m => userSet.add((m.email || m.username || m.name).toLowerCase()));
        (st.staff || [])
          .filter(s => !deletedUsers.some(d => (d.id && d.id === s.id) || (d.email && s.email && d.email.toLowerCase() === s.email.toLowerCase())))
          .forEach(s => userSet.add((s.email || s.username || s.name).toLowerCase()));
      });
      if (kpiUsers) {
        kpiUsers.textContent = String(userSet.size);
      }
    } catch (_) {
      if (kpiUsers) kpiUsers.textContent = '0';
    }

    // 2. Live System Actions Today (Actual receipts, disbursements, activities today)
    try {
      const todayISO = getLiveTodayISO();
      const mgrRec = JSON.parse(localStorage.getItem('rmims_manager_receipts') || '[]');
      const custRec = JSON.parse(localStorage.getItem('rmims_custom_receipts') || '[]');
      const receipts = [...mgrRec, ...custRec];
      const mgrDisb = JSON.parse(localStorage.getItem('rmims_manager_disbursements') || '[]');
      const custDisb = JSON.parse(localStorage.getItem('rmims_custom_disbursements') || '[]');
      const disbursements = [...mgrDisb, ...custDisb];
      const activities = JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]');
      const staffTx = JSON.parse(localStorage.getItem('rmims_staff_transactions') || '[]');

      const isToday = (dStr) => {
        if (!dStr) return false;
        return String(dStr).startsWith(todayISO);
      };

      const todayRec = receipts.filter(r => isToday(r.date || r.receiptDate || r.timestamp)).length;
      const todayDisb = disbursements.filter(d => isToday(d.date || d.disbursementDate || d.timestamp)).length;
      const todayAct = activities.filter(a => isToday(a.date || a.timestamp || a.lastDetected)).length;
      const todayStaff = staffTx.filter(s => isToday(s.date || s.timestamp)).length;

      const totalActions = todayRec + todayDisb + todayAct + todayStaff;
      if (kpiActions) {
        kpiActions.textContent = String(totalActions);
      }
    } catch (_) {
      if (kpiActions) kpiActions.textContent = '0';
    }
  }

  const liveToday = getLiveTodayISO();
  const initStart = getDaysAgoISO(13);
  const initEnd = liveToday;
  const initLabel = `${formatDisplayDate(initStart)} - ${formatDisplayDate(initEnd)}`;

  if (dateRangeSpan) {
    dateRangeSpan.textContent = initLabel;
  }

  if (popover && triggerBtn) {
    calendarPickerInstance = initAdminCalendarPicker({
      popover,
      triggerBtn,
      displayLabel: dateRangeSpan,
      colMonth1: document.getElementById('colMonth1Overview'),
      colMonth2: document.getElementById('colMonth2Overview'),
      gridMonth1: document.getElementById('daysGridMonth1Overview'),
      gridMonth2: document.getElementById('daysGridMonth2Overview'),
      monthTitle1: document.getElementById('monthTitle1Overview'),
      monthTitle2: document.getElementById('monthTitle2Overview'),
      btnPrev: document.getElementById('btnPrevMonthOverview'),
      btnNext: document.getElementById('btnNextMonthOverview'),
      btnNextSingle: document.getElementById('btnNextMonthSingleOverview'),
      bottomBox: document.getElementById('bottomDateBoxOverview'),
      startDateLabel: document.getElementById('startDateTextOverview'),
      endDateLabel: document.getElementById('endDateTextOverview'),
      presetBtns: popover.querySelectorAll('.preset-btn'),
      btnApply: document.getElementById('btnApplyDateRangeOverview'),
      btnCancel: document.getElementById('btnCancelDateRangeOverview'),
      initialPreset: 'custom',
      initialStart: initStart,
      initialEnd: initEnd,
      onApply: (applied) => {
        updateOverviewChartForRange(applied.start, applied.end);
      }
    });
  }

  // Initial 14 days chart state
  updateOverviewChartForRange(initStart, initEnd);
  // later live refreshes keep the range the person chose
  function refreshChart() {
    if (lastRange) updateOverviewChartForRange(lastRange[0], lastRange[1]);
    else updateOverviewChartForRange(initStart, initEnd);
  }

  if (rangeSelect) {
    rangeSelect.addEventListener('change', (e) => {
      const days = e.target.value;
      let end = getLiveTodayISO();
      let start;
      if (days === '14') {
        start = getDaysAgoISO(13);
      } else if (days === '30') {
        start = getDaysAgoISO(29);
      } else if (days === 'prev30') {
        // the 30 days before the last 30 days
        start = getDaysAgoISO(59);
        end = getDaysAgoISO(30);
      } else {
        start = getDaysAgoISO(6);
      }
      const label = `${formatDisplayDate(start)} - ${formatDisplayDate(end)}`;
      if (calendarPickerInstance) calendarPickerInstance.setSelection(start, end, label);
      updateOverviewChartForRange(start, end);
    });
  }

  // Section 4: Real-time System Maintenance Alerts Synchronizer
  function refreshOverviewAlerts() {
    const tbody = document.getElementById('overviewAlertsTableBody');
    if (!tbody) return;

    // Render top 5 most recent alerts
    if (tbody) {
      const alerts = getAlerts().slice(0, 5);
      if (alerts.length === 0) {
        setHtmlIfChanged(tbody, `
          <tr>
            <td colspan="8" style="text-align: center; padding: 36px 16px; color: var(--rm-ink-dim);">
              <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <div style="width: 40px; height: 40px; border-radius: 50%; background: rgba(16, 185, 129, 0.1); color: #10B981; display: flex; align-items: center; justify-content: center;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <span style="font-size: 13.5px; font-weight: 500; color: var(--rm-ink);">No active system maintenance alerts detected</span>
                <span style="font-size: 12px; color: #94A3B8;">System anomalies, failed logins, and diagnostic alerts will appear here in real time.</span>
              </div>
            </td>
          </tr>
        `);
      } else {
        setHtmlIfChanged(tbody, alerts.map(a => {
          let dotColor = '#DC2626';
          if (a.status === 'monitoring') dotColor = '#D97706';
          if (a.status === 'resolved') dotColor = '#16A34A';
          const occurrenceText = `${a.occurrence} ${a.occurrence === 1 ? 'time' : 'times'}`;
          const locText = a.branchLocation || a.branch || '';
          const nameText = a.branchName || '';

          // Clean, concise branch location label
          const locBadgeText = formatCleanBranchLocation ? formatCleanBranchLocation(locText, nameText) : (locText || 'System');
          const locTextLower = locBadgeText.toLowerCase();
          let locClass = 'neutral';
          if (locTextLower.includes('tiaong')) {
            locClass = 'tiaong';
          } else if (locTextLower.includes('lucena')) {
            locClass = 'lucena';
          } else if (locTextLower.includes('headquarters') || locTextLower.includes('hq')) {
            locClass = 'hq';
          } else if (locTextLower.includes('system')) {
            locClass = 'system';
          }

          // Link problem to determined user role
          const recipient = getDiagnosticRecipient(a);
          const targetRoleLabel = a.targetRoleLabel || (recipient && recipient.roleLabel) || (a.targetRole === 'Manager' ? 'Store Manager' : (a.targetRole === 'Staff' ? 'Store Staff' : 'Main Administrator'));
          const roleClass = (a.targetRole || (recipient && recipient.role) || 'Admin').toLowerCase();

          return `
            <tr data-status="${escapeHtml(a.status)}">
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="color: ${dotColor};">●</span>
                  <strong>${escapeHtml(a.type)}</strong>
                </div>
              </td>
              <td><span class="role-badge role-${escapeHtml(roleClass)}">${escapeHtml(targetRoleLabel)}</span></td>
              <td><span class="location-badge ${locClass}">${escapeHtml(locBadgeText)}</span></td>
              <td>${escapeHtml(nameText)}</td>
              <td>${escapeHtml(occurrenceText)}</td>
              <td>${escapeHtml(a.lastDetected)}</td>
              <td><span class="status-pill status-${escapeHtml(a.status)}">${escapeHtml(a.status.charAt(0).toUpperCase() + a.status.slice(1))}</span></td>
              <td>${escapeHtml(maskOperationalDetails(a.details))}</td>
            </tr>
          `;
        }).join(''));
      }
    }
  }

  // Initialize pending approvals, latest activity logs, branch stores directory, and real-time KPI counters
  renderOverviewPendingApprovals();
  renderOverviewLatestActivities();
  renderOverviewBranchStores();
  updateOverviewKPICounters();

  // Asynchronously query Supabase for live pending approvals, real-time activities, and registered stores
  import('../supabase/admin-supabase-service.js')
    .then(srv => {
      Promise.all([
        srv.fetchPendingApprovals(),
        srv.fetchLiveSystemActivities(),
        srv.fetchRegisteredUsers().catch(() => null),
        srv.fetchBranchStores()
      ]).then(() => {
        renderOverviewPendingApprovals();
        renderOverviewLatestActivities();
        renderOverviewBranchStores();
        updateOverviewKPICounters();
        refreshChart();
      }).catch(() => {});

      // Real-time live websocket feed across devices (Manager, Staff, Admin)
      srv.subscribeToAdminFeed(({ table }) => {
        if (table === 'user_profiles') {
          Promise.all([
            srv.fetchPendingApprovals(),
            srv.fetchRegisteredUsers(),
            srv.fetchBranchStores()
          ]).then(() => {
            renderOverviewPendingApprovals();
            renderOverviewBranchStores();
            updateOverviewKPICounters();
          }).catch(() => {});
        } else if (table === 'stock_receipts' || table === 'material_disbursements' || table === 'admin_activity_logs') {
          srv.fetchLiveSystemActivities().then(() => {
            renderOverviewLatestActivities();
            updateOverviewKPICounters();
            refreshChart();
          }).catch(() => {});
        } else if (table === 'branch_stores') {
          srv.fetchBranchStores().then(() => {
            renderOverviewBranchStores();
            updateOverviewKPICounters();
          }).catch(() => {});
        }
      });
    })
    .catch(() => {});

  // Initialize and listen for alert engine events and storage synchronization
  refreshOverviewAlerts();
  window.addEventListener('rmims:alerts-updated', refreshOverviewAlerts);
  window.addEventListener('rmims_pending_users_updated', () => {
    renderOverviewPendingApprovals();
    renderOverviewLatestActivities();
    renderOverviewBranchStores();
    updateOverviewKPICounters();
  });
  window.addEventListener('rmims_registered_users_updated', () => {
    renderOverviewPendingApprovals();
    renderOverviewBranchStores();
    updateOverviewKPICounters();
  });
  window.addEventListener('rmims_stores_updated', () => {
    renderOverviewBranchStores();
    updateOverviewKPICounters();
  });
  window.addEventListener('rmims_inventory_updated', () => {
    renderOverviewLatestActivities();
    renderOverviewBranchStores();
    updateOverviewKPICounters();
    refreshChart();
  });
  // Inter-tab instant real-time synchronization
  try {
    const bc = new BroadcastChannel('rmims_user_sync');
    bc.onmessage = (event) => {
      renderOverviewPendingApprovals();
      renderOverviewLatestActivities();
      renderOverviewBranchStores();
      updateOverviewKPICounters();
    };
  } catch (_) {}

  window.addEventListener('storage', (e) => {
    if (e.key === 'RMIMS_SYSTEM_ALERTS_V2') {
      refreshOverviewAlerts();
    }
    if (e.key === 'rmims_pending_users' || e.key === 'rmims_registered_users') {
      renderOverviewPendingApprovals();
      renderOverviewBranchStores();
      updateOverviewKPICounters();
    }
    if (e.key === 'RMIMS_BRANCH_STORES_V3' || e.key === 'rmims_stores_updated') {
      renderOverviewBranchStores();
      updateOverviewKPICounters();
    }
    if (e.key === 'rmims_manager_activities' || e.key === 'rmims_manager_receipts' || e.key === 'rmims_manager_disbursements' || e.key === 'rmims_staff_transactions') {
      renderOverviewLatestActivities();
      updateOverviewKPICounters();
    }
  });

  // Real-time Overview Global Search
  const searchInput = document.getElementById('overviewSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      
      // Filter tables on overview page
      const tables = document.querySelectorAll('.admin-table tbody');
      tables.forEach((tbody) => {
        const rows = tbody.querySelectorAll('tr');
        rows.forEach((row) => {
          if (!query) {
            row.style.display = '';
            return;
          }
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(query) ? '' : 'none';
        });
      });

    });
  }
});
