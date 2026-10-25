// RMIMS Admin System Alerts Controller
// Implements the user-specified alert backend policies & dynamic role dispatch:
// 1. Incorrect Password: 1 failed attempt is logged silently in security telemetry (does NOT appear in system diagnostics).
//    Multiple attempts (>= 3) automatically escalate and alert the system diagnostics module.
// 2. Critical Alerts (Account Locked, Database Offline, Security Breach): Threshold = 1.
//    "Once is enough to alert" — immediately alerts the module on the 1st occurrence!
// 3. Routine Diagnostics: Threshold = 3 occurrences before escalation.
// 4. Action: "Send to (role) contact, maintenance, etc." depending on the diagnosed problem.

import {
  getAlerts,
  getCategoryCounts,
  resolveAlertById,
  dispatchAlert,
  getDiagnosticRecipient,
  parseBranch,
  recordLoginFailure,
  recordSystemIncident,
  resetAlertsToDefault,
  ALERT_THRESHOLDS
} from './system-alerts-service.js';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  const statusFilter = document.getElementById('alertStatusFilter');
  const searchInput = document.getElementById('alertSearchInput');
  const alertsTable = document.getElementById('alertsTable');
  const tableBody = alertsTable ? alertsTable.querySelector('tbody') : null;

  // Metric Count Elements
  const statLogin = document.getElementById('statLoginAuthCount');
  const statPerf = document.getElementById('statSysPerfCount');
  const statData = document.getElementById('statFileDataCount');
  const statFunc = document.getElementById('statFuncErrorsCount');

  // Dispatch Modal Elements
  const dispatchModal = document.getElementById('alertDispatchModal');
  const dispatchAlertIdInput = document.getElementById('dispatchAlertId');
  const dispatchErrorTypeEl = document.getElementById('dispatchErrorType');
  const dispatchStatusPillEl = document.getElementById('dispatchStatusPill');
  const dispatchDotColorEl = document.getElementById('dispatchDotColor');
  const dispatchBranchAndDetailsEl = document.getElementById('dispatchBranchAndDetails');
  const dispatchRoleSelect = document.getElementById('dispatchRoleSelect');
  const dispatchContactInput = document.getElementById('dispatchContactInput');
  const dispatchMessageText = document.getElementById('dispatchMessageText');
  const dispatchStatusSelect = document.getElementById('dispatchStatusSelect');
  const dispatchSubmitBtnText = document.getElementById('dispatchSubmitBtnText');

  function updateMetricBoxes() {
    const counts = getCategoryCounts();
    if (statLogin) statLogin.textContent = counts.login;
    if (statPerf) statPerf.textContent = counts.performance;
    if (statData) statData.textContent = counts.data;
    if (statFunc) statFunc.textContent = counts.functional;
  }

  function renderAlertRows() {
    if (!tableBody) return;
    const alerts = getAlerts();
    const statusVal = statusFilter ? statusFilter.value : 'all';
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filtered = alerts.filter(a => {
      const statusMatch = statusVal === 'all' || a.status === statusVal;
      const bInfo = parseBranch(a.branchLocation && a.branchName ? { location: a.branchLocation, name: a.branchName } : a.branch);
      const locText = a.branchLocation || bInfo.location;
      const nameText = a.branchName || bInfo.name;
      const searchHaystack = `${a.type} ${locText} ${nameText} ${a.branch || ''} ${a.details} ${a.status} ${a.lastDetected}`.toLowerCase();
      const searchMatch = !query || searchHaystack.includes(query);
      return statusMatch && searchMatch;
    });

    if (filtered.length === 0) {
      if (alerts.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="9" style="text-align: center; padding: 48px 16px; color: var(--rm-ink-dim);">
              <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <div style="width: 44px; height: 44px; border-radius: 50%; background: rgba(16, 185, 129, 0.1); color: #10B981; display: flex; align-items: center; justify-content: center;">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <span style="font-size: 14px; font-weight: 600; color: var(--rm-ink);">No Active System Alerts</span>
                <span style="font-size: 12px; color: #94A3B8;">All branch stores, services, and sync workers are operating normally without diagnostic issues.</span>
              </div>
            </td>
          </tr>
        `;
      } else {
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; padding: 32px 16px; color: var(--rm-ink-dim);">
              No system maintenance alerts found matching your criteria.
            </td>
          </tr>
        `;
      }
      return;
    }

    tableBody.innerHTML = filtered.map(a => {
      // Color Dot based on status / severity
      let dotColor = '#DC2626'; // red for ongoing/critical
      if (a.status === 'monitoring') dotColor = '#D97706'; // amber
      if (a.status === 'resolved') dotColor = '#16A34A'; // green

      const isResolved = a.status === 'resolved';
      const recipient = getDiagnosticRecipient(a);
      const bInfo = parseBranch(a.branchLocation && a.branchName ? { location: a.branchLocation, name: a.branchName } : a.branch);
      const locText = a.branchLocation || bInfo.location;
      const nameText = a.branchName || bInfo.name;
      
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

      // Dynamic Role-based Action label depending on diagnosed problem
      let actionLabel = a.actionLabel || recipient.actionLabel || 'Send to Maintenance';
      if (isResolved) {
        actionLabel = a.dispatchRecord ? 'Dispatched (View)' : 'Resolved (View)';
      }

      const actionOpacity = isResolved ? 'style="opacity: 0.6;"' : '';
      const occurrenceText = `${a.occurrence} ${a.occurrence === 1 ? 'time' : 'times'}`;

      return `
        <tr data-status="${escapeHtml(a.status)}" data-alert-id="${escapeHtml(a.id)}">
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
          <td>
            <button class="btn-view-all" ${actionOpacity} onclick="window.openAlertDispatchModal('${escapeHtml(a.id)}')">${escapeHtml(actionLabel)}</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function refreshAll() {
    updateMetricBoxes();
    renderAlertRows();
  }

  // Filter Listeners
  if (statusFilter) statusFilter.addEventListener('change', renderAlertRows);
  if (searchInput) searchInput.addEventListener('input', renderAlertRows);

  // Dispatch Modal Handlers
  window.openAlertDispatchModal = function (alertId) {
    const alerts = getAlerts();
    const alert = alerts.find(a => a.id === alertId);
    if (!alert) return;

    const recipient = getDiagnosticRecipient(alert);
    const assignedRole = alert.targetRole || recipient.role;

    if (dispatchAlertIdInput) dispatchAlertIdInput.value = alert.id;
    if (dispatchErrorTypeEl) dispatchErrorTypeEl.textContent = alert.type;
    
    let dotColor = '#DC2626';
    if (alert.status === 'monitoring') dotColor = '#D97706';
    if (alert.status === 'resolved') dotColor = '#16A34A';
    if (dispatchDotColorEl) dispatchDotColorEl.style.color = dotColor;

    if (dispatchStatusPillEl) {
      dispatchStatusPillEl.className = `status-pill status-${alert.status}`;
      dispatchStatusPillEl.textContent = alert.status.charAt(0).toUpperCase() + alert.status.slice(1);
    }

    if (dispatchBranchAndDetailsEl) {
      const bInfo = parseBranch(alert.branchLocation && alert.branchName ? { location: alert.branchLocation, name: alert.branchName } : alert.branch);
      dispatchBranchAndDetailsEl.textContent = `${bInfo.location} | ${bInfo.name} • ${alert.occurrence} ${alert.occurrence === 1 ? 'time' : 'times'} • ${alert.details}`;
    }

    if (dispatchRoleSelect) {
      dispatchRoleSelect.value = assignedRole;
      if (!dispatchRoleSelect.value) dispatchRoleSelect.value = 'System Maintenance';
    }

    if (dispatchContactInput) {
      dispatchContactInput.value = (alert.dispatchRecord && alert.dispatchRecord.recipientEmail) 
        ? alert.dispatchRecord.recipientEmail 
        : recipient.defaultContact;
    }

    if (dispatchMessageText) {
      dispatchMessageText.value = (alert.dispatchRecord && alert.dispatchRecord.message)
        ? alert.dispatchRecord.message
        : recipient.suggestedNote;
    }

    if (dispatchStatusSelect) {
      dispatchStatusSelect.value = alert.status === 'resolved' ? 'resolved' : 'monitoring';
    }

    if (dispatchSubmitBtnText) {
      dispatchSubmitBtnText.textContent = `Send to ${assignedRole}`;
    }

    if (dispatchModal) {
      dispatchModal.classList.add('active');
    }
  };

  window.closeAlertDispatchModal = function () {
    if (dispatchModal) dispatchModal.classList.remove('active');
  };

  window.handleDispatchRoleChange = function (role) {
    if (dispatchSubmitBtnText) dispatchSubmitBtnText.textContent = `Send to ${role}`;
    
    // Auto-fill sensible contact email based on selected role
    const currentBranch = dispatchBranchAndDetailsEl ? dispatchBranchAndDetailsEl.textContent.trim() : '';
    const cleanBranchSlug = currentBranch.toLowerCase().replace(/[^a-z0-9]/g, '');
    const branchDomain = cleanBranchSlug ? `${cleanBranchSlug}.store.ph` : 'store.ph';

    if (role === 'Store Manager') {
      if (dispatchContactInput) dispatchContactInput.value = `manager@${branchDomain}`;
    } else if (role === 'Inventory Staff') {
      if (dispatchContactInput) dispatchContactInput.value = `inventory@${branchDomain}`;
    } else if (role === 'IT Maintenance') {
      if (dispatchContactInput) dispatchContactInput.value = 'it.maintenance@store.ph';
    } else if (role === 'System Maintenance') {
      if (dispatchContactInput) dispatchContactInput.value = 'maintenance.ops@store.ph';
    } else if (role === 'Account Security') {
      if (dispatchContactInput) dispatchContactInput.value = 'security.admin@store.ph';
    }
  };

  window.handleConfirmDispatch = function (e) {
    if (e) e.preventDefault();
    const alertId = dispatchAlertIdInput ? dispatchAlertIdInput.value : null;
    if (!alertId) return;

    const role = dispatchRoleSelect ? dispatchRoleSelect.value : 'System Maintenance';
    const recipientEmail = dispatchContactInput ? dispatchContactInput.value.trim() : '';
    const message = dispatchMessageText ? dispatchMessageText.value.trim() : '';
    const newStatus = dispatchStatusSelect ? dispatchStatusSelect.value : 'monitoring';

    dispatchAlert(alertId, {
      role,
      recipientEmail,
      message,
      status: newStatus
    });

    // Sync status change to Supabase
    import('../supabase/admin-supabase-service.js')
      .then(srv => srv.updateSystemAlertStatus(alertId, newStatus))
      .catch(() => {});

    window.closeAlertDispatchModal();
    refreshAll();

    if (window.showAdminToast) {
      window.showAdminToast(`Diagnostic notice dispatched to ${role} (${recipientEmail}).`);
    }
  };

  // Close modal when clicking backdrop outside modal content
  if (dispatchModal) {
    dispatchModal.addEventListener('click', (e) => {
      if (e.target === dispatchModal) {
        window.closeAlertDispatchModal();
      }
    });
  }

  // Legacy resolve handler
  window.resolveAlert = function (btn, alertName) {
    const row = btn.closest('tr');
    const alertId = row ? row.getAttribute('data-alert-id') : null;
    if (alertId) {
      window.openAlertDispatchModal(alertId);
    } else {
      if (window.showAdminToast) window.showAdminToast(`Incident "${alertName}" updated.`);
    }
  };

  // Listen to cross-module updates
  window.addEventListener('rmims:alerts-updated', () => {
    refreshAll();
  });
  window.addEventListener('storage', (e) => {
    if (e.key === 'RMIMS_SYSTEM_ALERTS_V2') {
      refreshAll();
    }
  });

  // Initial load
  refreshAll();

  // Asynchronously query Supabase for system maintenance alerts
  import('../supabase/admin-supabase-service.js')
    .then(srv => srv.fetchSystemAlerts())
    .then(alerts => {
      if (alerts && alerts.length > 0) {
        refreshAll();
      }
    })
    .catch(() => {});
});
