// RMIMS Main Administration Overview Controller
// Initializes the Branch Stores Usage Chart using authentic RMIMS Emerald styling,
// handles chart timeframes, interactive account approvals, real-time system alerts, and overview search.

import { getAlerts, getCategoryCounts } from './system-alerts-service.js';
import { initAdminCalendarPicker, MONTH_NAMES_SHORT, getLiveTodayISO, getDaysAgoISO, formatDisplayDate } from './admin-calendar-picker.js';
import { getStoresData } from './admin-branch-stores.js';

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
    return JSON.parse(localStorage.getItem('rmims_pending_users') || '[]');
  } catch (_) {
    return [];
  }
}

function saveStoredPendingUsers(users) {
  try {
    localStorage.setItem('rmims_pending_users', JSON.stringify(users));
    window.dispatchEvent(new Event('rmims_pending_users_updated'));
    window.dispatchEvent(new Event('storage'));
  } catch (e) {
    console.warn('Failed saving pending users:', e);
  }
}

function logSystemActivity(action, details) {
  try {
    const list = JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]');
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
    localStorage.setItem('rmims_manager_activities', JSON.stringify(list.slice(0, 50)));
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

  // Remove from pending storage
  const currentPending = getStoredPendingUsers();
  const cleanId = String(userId || '').trim();
  const cleanName = String(userName || '').toLowerCase().trim();
  const approvedItem = currentPending.find(u => 
    String(u.id).trim() === cleanId ||
    `ovRow_${u.id}` === cleanId ||
    (cleanName && u.name && u.name.toLowerCase().trim() === cleanName) ||
    (cleanName && u.username && u.username.toLowerCase().trim() === cleanName)
  );

  const targetEmail = (approvedItem?.email || '').toLowerCase().trim();
  const targetUsername = (approvedItem?.username || '').toLowerCase().trim();

  const remaining = currentPending.filter(u => {
    const uId = String(u.id || '').trim();
    const uEmail = (u.email || '').toLowerCase().trim();
    const uUser = (u.username || '').toLowerCase().trim();
    return uId !== cleanId &&
           `ovRow_${uId}` !== cleanId &&
           !(targetEmail && uEmail && uEmail === targetEmail) &&
           !(targetUsername && uUser && uUser === targetUsername);
  });
  saveStoredPendingUsers(remaining);

  // Save into authoritative approved users cache
  try {
    const approvedCache = JSON.parse(localStorage.getItem('rmims_approved_users') || '[]');
    const appUserId = approvedItem?.id || (cleanId && !cleanId.startsWith('ovRow_') ? cleanId : `user-${Date.now()}`);
    const resolvedName = approvedItem?.name || userName || 'User';
    const resolvedUser = approvedItem?.username || (targetEmail ? targetEmail.split('@')[0] : 'user');
    const appIdx = approvedCache.findIndex(a => 
      (appUserId && a.id && String(a.id).trim() === String(appUserId).trim()) ||
      (targetEmail && a.email && a.email.toLowerCase().trim() === targetEmail) ||
      (resolvedUser && a.username && a.username.toLowerCase().trim() === resolvedUser)
    );
    const appRecord = {
      id: appUserId,
      name: resolvedName,
      username: resolvedUser,
      email: approvedItem?.email || '',
      role: approvedItem?.role || 'Staff',
      branchLoc: approvedItem?.branchLoc || 'Lucena',
      branchName: approvedItem?.branchName || 'Branch Store',
      status: 'Active',
      approvedAt: new Date().toISOString()
    };
    if (appIdx >= 0) {
      approvedCache[appIdx] = { ...approvedCache[appIdx], ...appRecord };
    } else {
      approvedCache.push(appRecord);
    }
    localStorage.setItem('rmims_approved_users', JSON.stringify(approvedCache));
  } catch (_) {}

  // If approved, add or update in registered directory
  try {
    const dir = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
    const resId = approvedItem?.id || (cleanId && !cleanId.startsWith('ovRow_') ? cleanId : `user-${Date.now()}`);
    const resEmail = approvedItem?.email || '';
    const resUser = approvedItem?.username || (resEmail ? resEmail.split('@')[0] : 'user');
    const resName = approvedItem?.name || userName || 'User';

    const existingIdx = dir.findIndex(u => 
      (resId && u.id && String(u.id).trim() === String(resId).trim()) ||
      (resEmail && u.email && u.email.toLowerCase().trim() === resEmail.toLowerCase().trim()) ||
      (resUser && u.username && u.username.toLowerCase().trim() === resUser.toLowerCase().trim())
    );

    if (existingIdx >= 0) {
      dir[existingIdx].status = 'Active';
      if (approvedItem?.branchLoc) dir[existingIdx].branchLoc = approvedItem.branchLoc;
      if (approvedItem?.branchName) dir[existingIdx].branchName = approvedItem.branchName;
      if (approvedItem?.role) dir[existingIdx].role = approvedItem.role;
    } else {
      dir.push({
        id: resId,
        name: resName,
        username: resUser,
        email: resEmail,
        branchLoc: approvedItem?.branchLoc || 'Lucena',
        branchName: approvedItem?.branchName || 'Branch Store',
        role: approvedItem?.role || 'Staff',
        status: 'Active'
      });
    }
    localStorage.setItem('rmims_registered_users', JSON.stringify(dir));
    window.dispatchEvent(new Event('rmims_registered_users_updated'));

    // Also register into RMIMS_BRANCH_STORES_V3
    try {
      const stores = JSON.parse(localStorage.getItem('RMIMS_BRANCH_STORES_V3') || '{}');
      const locRaw = (approvedItem?.branchLoc || '').trim();
      const locKey = locRaw.toLowerCase().replace(/[^a-z0-9]/g, '') || 'branch';
      const locationName = locRaw ? (locRaw.toUpperCase().includes('BRANCH') ? locRaw.toUpperCase() : `${locRaw.toUpperCase()} BRANCH`) : 'BRANCH STORE';
      const address = locRaw || 'Branch Location';
      const storeKey = (approvedItem?.branchName || 'branch').toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (!stores[storeKey]) {
        stores[storeKey] = {
          id: storeKey,
          name: approvedItem?.branchName || 'Branch Store',
          locKey: locKey,
          locationKey: locKey,
          locationName: locationName,
          address: address,
          managers: [],
          staff: []
        };
      }
      const isMgr = ((approvedItem?.role || '')).toLowerCase().includes('manager');
      const memberObj = {
        id: resId,
        name: resName,
        username: resUser,
        email: resEmail,
        initials: getInitials(resName),
        status: 'APPROVED',
        accessCode: String(Math.floor(100000 + Math.random() * 900000))
      };
      if (isMgr) {
        if (!stores[storeKey].managers.some(m => m.email === resEmail || m.username === resUser)) {
          stores[storeKey].managers.push(memberObj);
        }
      } else {
        if (!stores[storeKey].staff.some(s => s.email === resEmail || s.username === resUser)) {
          stores[storeKey].staff.push(memberObj);
        }
      }
      localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(stores));
      window.dispatchEvent(new Event('rmims_stores_updated'));
    } catch (_) {}
  } catch (_) {}

  // Standalone Supabase synchronization
  try {
    const srv = await import('../supabase/admin-supabase-service.js');
    const syncRes = await srv.approveUserAccount({
      id: approvedItem?.id || cleanId,
      email: approvedItem?.email,
      username: approvedItem?.username,
      name: userName || approvedItem?.name
    });

    if (syncRes && syncRes.success) {
      if (typeof window.showAdminToast === 'function') {
        window.showAdminToast(`Account for ${userName} approved and synchronized with Supabase (Active).`, 'success');
      }
    } else {
      if (typeof window.showAdminToast === 'function') {
        window.showAdminToast(`Account for ${userName} approved locally. Supabase notice: ${syncRes?.error || 'Awaiting sync'}.`, 'warning');
      }
    }
  } catch (_) {
    if (typeof window.showAdminToast === 'function') {
      window.showAdminToast(`Account for ${userName} approved successfully.`);
    }
  }

  logSystemActivity('Approved Account', `Approved access for ${userName} (${approvedItem ? approvedItem.role : 'Staff'})`);

  setTimeout(() => {
    renderOverviewPendingApprovals();
  }, 1000);
};

window.rejectOverviewAccount = function (userId, statusId, actionsId, userName) {
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
  const remaining = currentPending.filter(u => String(u.id) !== String(userId));
  saveStoredPendingUsers(remaining);

  logSystemActivity('Rejected Account', `Rejected account request for ${userName}`);

  if (typeof window.showAdminToast === 'function') {
    window.showAdminToast(`Account request for ${userName} rejected.`, 'danger');
  }

  setTimeout(() => {
    renderOverviewPendingApprovals();
  }, 1000);
};

function renderOverviewPendingApprovals() {
  const tbody = document.getElementById('overviewApprovalTableBody');
  if (!tbody) return;

  const pendingList = getStoredPendingUsers();

  if (pendingList.length === 0) {
    tbody.innerHTML = `
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
    `;
    return;
  }

  tbody.innerHTML = pendingList.map(u => {
    const locRaw = (u.branchLoc || '').trim();
    let locClass = 'neutral';
    if (locRaw.toLowerCase().includes('lucena')) locClass = 'lucena';
    else if (locRaw.toLowerCase().includes('tiaong')) locClass = 'tiaong';
    const locBadgeText = locRaw || '—';
    const roleClass = (u.role || 'Staff').toLowerCase();
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
  }).join('');
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

  const list = [];
  try {
    const mgr = JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]');
    mgr.forEach(m => {
      const details = (m.details || m.activity || '').trim();
      const user = (m.user || '').trim();
      const bLoc = (m.branchLoc || m.branch || '').trim();
      const bName = (m.branchName || '').trim();
      const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
      if (!hasBranch) return;
      if (!user || user.toLowerCase() === 'store manager' || user.toLowerCase() === 'store staff') return;

      const txt = `${user} ${details} ${bLoc} ${bName}`.toLowerCase();
      if (txt.includes('simulated_user') || txt.includes('demo') || txt.includes('john reyes')) {
        return;
      }
      if (['receive', 'approve transaction', 'disburse'].includes(details.toLowerCase())) {
        return;
      }
      list.push({
        user: user,
        action: m.action || 'Updated',
        branchLoc: bLoc,
        branchName: bName || bLoc,
        details: details || 'Inventory operation executed.',
        timestamp: m.timestamp || m.datetime || new Date().toISOString()
      });
    });
  } catch (_) {}

  try {
    const recs = JSON.parse(localStorage.getItem('rmims_manager_receipts') || '[]');
    recs.forEach(r => {
      const bLoc = (r.branchLoc || '').trim();
      const bName = (r.branchName || '').trim();
      const user = (r.receivedBy || '').trim();
      const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
      if (!hasBranch) return;
      if (!user || user.toLowerCase() === 'store manager' || user.toLowerCase() === 'store staff') return;
      const ref = r.ref || '';
      if (['REC-2026-00125', 'REC-2026-00124', 'REC-2026-00120', 'REC-2026-00118'].includes(ref)) return;

      const txt = `${user} ${r.supplierName || ''} ${bLoc} ${bName}`.toLowerCase();
      if (txt.includes('simulated_user')) return;
      list.push({
        user: user,
        action: 'Received',
        branchLoc: bLoc,
        branchName: bName || bLoc,
        details: `Received ${Array.isArray(r.items) ? r.items.length : 1} raw material(s) (${ref || 'Ref'})`,
        timestamp: r.timestamp || ((r.receiptDate || r.date || getLiveTodayISO()) + 'T10:00:00Z')
      });
    });
  } catch (_) {}

  try {
    const disbs = JSON.parse(localStorage.getItem('rmims_manager_disbursements') || '[]');
    disbs.forEach(d => {
      const bLoc = (d.branchLoc || '').trim();
      const bName = (d.branchName || '').trim();
      const user = (d.disbursedBy || '').trim();
      const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
      if (!hasBranch) return;
      if (!user || user.toLowerCase() === 'store staff' || user.toLowerCase() === 'store manager') return;
      const ref = d.ref || '';
      if (['DIS-2026-00091', 'DIS-2026-00088'].includes(ref)) return;

      const txt = `${user} ${d.reason || ''} ${bLoc} ${bName}`.toLowerCase();
      if (txt.includes('simulated_user')) return;
      list.push({
        user: user,
        action: 'Disbursed',
        branchLoc: bLoc,
        branchName: bName || bLoc,
        details: `Disbursed ${Array.isArray(d.items) ? d.items.length : 1} item(s) for ${d.reason || 'production'} (${ref || 'Ref'})`,
        timestamp: d.timestamp || ((d.disbursementDate || d.date || getLiveTodayISO()) + 'T14:00:00Z')
      });
    });
  } catch (_) {}

  list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (list.length === 0) {
    tbody.innerHTML = `
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
    `;
    return;
  }

  tbody.innerHTML = list.slice(0, 5).map(act => {
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
        <td>${escapeHtml(act.details)}</td>
        <td>${escapeHtml(formatLogTime(act.timestamp))}</td>
      </tr>
    `;
  }).join('');
}

function renderOverviewBranchStores() {
  const tbody = document.getElementById('overviewBranchStoresTbody');
  if (!tbody) return;

  const stores = getStoresData();
  const storeList = Object.values(stores);

  if (storeList.length === 0) {
    tbody.innerHTML = `
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
    `;
    return;
  }

  tbody.innerHTML = storeList.map(s => {
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
  }).join('');
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
  gradSky.addColorStop(0, 'rgba(14, 165, 233, 0.22)');
  gradSky.addColorStop(1, 'rgba(14, 165, 233, 0.02)');

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
  const DATASET_COLORS = ['#10B981', '#0EA5E9', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
  function buildChartLegend() {
    const legendEl = document.getElementById('branchUsageChartLegend');
    if (!legendEl) return;
    if (!chart || !chart.data || !chart.data.datasets || chart.data.datasets.length === 0) {
      legendEl.innerHTML = '<span style="color:var(--rm-ink-dim,#5C7A68);font-size:12px;">No branches registered</span>';
      return;
    }
    legendEl.innerHTML = chart.data.datasets.map((ds, i) => {
      const color = ds.borderColor || DATASET_COLORS[i % DATASET_COLORS.length];
      const label = ds.label || `Branch Store ${i + 1}`;
      return `<div class="legend-item">
        <span class="legend-dot" style="background:${color};"></span>
        <span>${label}</span>
      </div>`;
    }).join('');
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

  function updateOverviewChartForRange(startStr, endStr) {
    if (!startStr) return;
    const startDate = new Date(startStr);
    const endDate = endStr ? new Date(endStr) : new Date(startStr);
    const diffDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);

    const activeStores = getStoresData();
    const currentStoreList = Object.values(activeStores);
    const hasStores = currentStoreList.length > 0;

    let labels = [];

    if (diffDays === 1) {
      labels = ['8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM'];
    } else if (diffDays <= 7) {
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        labels.push(`${MONTH_NAMES_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`);
      }
      if (rangeSelect) rangeSelect.value = '7';
    } else if (diffDays <= 14) {
      for (let i = 0; i < 7; i++) {
        const pointDate = new Date(startDate.getTime() + (endDate.getTime() - startDate.getTime()) * (i / 6));
        labels.push(`${MONTH_NAMES_SHORT[pointDate.getMonth()]} ${String(pointDate.getDate()).padStart(2, '0')}`);
      }
      if (rangeSelect) rangeSelect.value = '14';
    } else {
      const pointsCount = Math.min(diffDays, 7);
      for (let i = 0; i < pointsCount; i++) {
        const pointDate = new Date(startDate.getTime() + (endDate.getTime() - startDate.getTime()) * (i / (pointsCount - 1)));
        labels.push(`${MONTH_NAMES_SHORT[pointDate.getMonth()]} ${String(pointDate.getDate()).padStart(2, '0')}`);
      }
      if (rangeSelect) rangeSelect.value = '30';
    }

    // Compute real activity data per store from live records
    const store1Key = currentStoreList[0] ? (currentStoreList[0].locKey || currentStoreList[0].location || 'store1') : 'all';
    const store2Key = currentStoreList[1] ? (currentStoreList[1].locKey || currentStoreList[1].location || 'store2') : null;

    const store1Data = hasStores ? buildRealChartDataForStore(store1Key, labels, startDate, endDate, diffDays) : labels.map(() => 0);
    const store2Data = hasStores && currentStoreList.length > 1 && store2Key ? buildRealChartDataForStore(store2Key, labels, startDate, endDate, diffDays) : labels.map(() => 0);

    updateOverviewKPICounters();

    chart.data.labels = labels;
    if (currentStoreList.length === 0) {
      chart.data.datasets = [
        {
          label: 'All Activity',
          data: labels.map(() => 0),
          borderColor: '#10B981',
          backgroundColor: gradEmerald,
          borderWidth: 2.8,
          fill: true,
          tension: 0.38,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10B981',
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2
        }
      ];
    } else {
      chart.data.datasets = currentStoreList.slice(0, 4).map((st, idx) => {
        const color = DATASET_COLORS[idx % DATASET_COLORS.length];
        const storeKey = st.locKey || st.location || st.name;
        const storeData = buildRealChartDataForStore(storeKey, labels, startDate, endDate, diffDays);
        return {
          label: `${st.name} (${st.location || 'Branch'})`,
          data: storeData,
          borderColor: color,
          backgroundColor: idx === 0 ? gradEmerald : (idx === 1 ? gradSky : 'rgba(245, 158, 11, 0.08)'),
          borderWidth: 2.8,
          fill: true,
          tension: 0.38,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: color,
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2
        };
      });
    }
    chart.update();
    buildChartLegend();
  }

  function updateOverviewKPICounters() {
    // 1. Live Active Users (Directory active accounts + registered custom accounts + branch personnel)
    try {
      const userSet = new Set();
      const customUsers = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
      const mockUserTokens = ['maria santos', 'kenneth ramos', 'rafael cruz', 'alyssa lim', 'carla mendoza', 'carlos mendoza'];
      customUsers
        .filter(u => !mockUserTokens.some(tok => (u.name || u.username || '').toLowerCase().includes(tok)))
        .filter(u => u.status === 'Active' || !u.status)
        .forEach(u => userSet.add(u.email || u.username || u.name));
      
      const stores = getStoresData();
      Object.values(stores).forEach(st => {
        (st.managers || []).forEach(m => userSet.add(m.email || m.username || m.name));
        (st.staff || []).forEach(s => userSet.add(s.email || s.username || s.name));
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

  if (rangeSelect) {
    rangeSelect.addEventListener('change', (e) => {
      const days = e.target.value;
      const end = getLiveTodayISO();
      let start;
      if (days === '14') {
        start = getDaysAgoISO(13);
      } else if (days === '30') {
        start = getDaysAgoISO(29);
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
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; padding: 36px 16px; color: var(--rm-ink-dim);">
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
        `;
      } else {
        tbody.innerHTML = alerts.map(a => {
          let dotColor = '#DC2626';
          if (a.status === 'monitoring') dotColor = '#D97706';
          if (a.status === 'resolved') dotColor = '#16A34A';
          const occurrenceText = `${a.occurrence} ${a.occurrence === 1 ? 'time' : 'times'}`;
          const locText = a.branchLocation || a.branch || '';
          const nameText = a.branchName || '';

          const locTextLower = (locText || '').toLowerCase();
          let locClass = 'neutral';
          let locBadgeText = locText || 'All Branches';
          if (locTextLower.includes('tiaong')) {
            locClass = 'tiaong';
            locBadgeText = locText;
          } else if (locTextLower.includes('lucena')) {
            locClass = 'lucena';
            locBadgeText = locText;
          } else if (locTextLower.includes('headquarters')) {
            locClass = 'hq';
          } else if (locTextLower) {
            locClass = 'custom';
          }

          return `
            <tr data-status="${escapeHtml(a.status)}">
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="color: ${dotColor};">●</span>
                  <strong>${escapeHtml(a.type)}</strong>
                </div>
              </td>
              <td><span class="location-badge ${locClass}">${escapeHtml(locBadgeText)}</span></td>
              <td>${escapeHtml(nameText)}</td>
              <td>${escapeHtml(occurrenceText)}</td>
              <td>${escapeHtml(a.lastDetected)}</td>
              <td><span class="status-pill status-${escapeHtml(a.status)}">${escapeHtml(a.status.charAt(0).toUpperCase() + a.status.slice(1))}</span></td>
              <td>${escapeHtml(a.details)}</td>
            </tr>
          `;
        }).join('');
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
        srv.fetchBranchStores()
      ]).then(() => {
        renderOverviewPendingApprovals();
        renderOverviewLatestActivities();
        renderOverviewBranchStores();
        updateOverviewKPICounters();
        updateOverviewChartForRange(initStart, initEnd);
      }).catch(() => {});

      // Real-time live websocket feed across devices (Manager, Staff, Admin)
      srv.subscribeToAdminFeed(({ table }) => {
        if (table === 'user_profiles') {
          srv.fetchPendingApprovals().then(() => {
            renderOverviewPendingApprovals();
            updateOverviewKPICounters();
          }).catch(() => {});
        } else if (table === 'stock_receipts' || table === 'material_disbursements' || table === 'admin_activity_logs') {
          srv.fetchLiveSystemActivities().then(() => {
            renderOverviewLatestActivities();
            updateOverviewKPICounters();
            updateOverviewChartForRange(initStart, initEnd);
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
    updateOverviewChartForRange(initStart, initEnd);
  });
  window.addEventListener('rmims_inventory_updated', () => {
    renderOverviewLatestActivities();
    renderOverviewBranchStores();
    updateOverviewKPICounters();
    updateOverviewChartForRange(initStart, initEnd);
  });
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
      updateOverviewChartForRange(initStart, initEnd);
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
