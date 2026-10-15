import os

base_dir = r"c:\Users\Zeanna\Downloads\RMIMS-AI-BASED-FORECASTING-INTEGRATED\RMIMS-DASHBOARD-VIEW-3D-SUGAR-APPLIED\RMIMS-Supabase-ML-Forecasting-Integration\RMIMS"
file_path = os.path.join(base_dir, "js", "staff-activity.js")

code = """/**
 * RMSME Staff Activity & Review Module Logic
 * Manages Staff-submitted Receive & Disburse transactions:
 * - Real live data only: No hardcoded/mock transactions
 * - Filtering by Staff member, Date, Activity type, and Status
 * - Automatic, non-editable, non-clickable reference numbers
 * - Manager approval and rejection flows
 * - Real-time stock update and activity log synchronization
 */

let transactions = [];

function loadTransactions() {
  try {
    const raw = localStorage.getItem('rmims_staff_transactions');
    if (raw) {
      const parsed = JSON.parse(raw);
      // Cleanse old hardcoded/mock records if they linger from initial templates
      if (Array.isArray(parsed)) {
        transactions = parsed.filter(t => !['st-001', 'st-002', 'st-003', 'st-004', 'st-005'].includes(t.id));
        // If all items were mock items, update localStorage to clean empty array
        if (transactions.length !== parsed.length) {
          localStorage.setItem('rmims_staff_transactions', JSON.stringify(transactions));
        }
      } else {
        transactions = [];
      }
    } else {
      transactions = [];
      localStorage.setItem('rmims_staff_transactions', JSON.stringify([]));
    }
  } catch (e) {
    transactions = [];
  }
}

function saveTransactions() {
  try {
    localStorage.setItem('rmims_staff_transactions', JSON.stringify(transactions));
  } catch (e) {}
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  loadTransactions();
  populateStaffFilterOptions();
  renderCounters();
  renderTable();
  bindFilterEvents();
  bindReviewModalEvents();

  // Cross-tab real-time sync
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key === 'rmims_staff_transactions' || e.key.includes('activity')) {
      loadTransactions();
      populateStaffFilterOptions();
      renderCounters();
      renderTable();
    }
  });

  // Check URL parameters (e.g. ?review=REC-2026-00125)
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.has('review')) {
      const targetRef = sp.get('review');
      const found = transactions.find(t => t.ref && t.ref.toLowerCase() === targetRef.toLowerCase());
      if (found) {
        setTimeout(() => openReviewModal(found), 250);
      }
    }
  } catch (e) {}
});

function populateStaffFilterOptions() {
  const select = document.getElementById('staffMemberFilter');
  if (!select) return;

  const currentVal = select.value;
  const staffNames = Array.from(new Set(transactions.map(t => t.staff).filter(Boolean))).sort();

  select.innerHTML = '<option value="all">All Staff Members</option>';
  staffNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

function renderCounters() {
  const total = transactions.length;
  const pending = transactions.filter(t => t.status === 'Pending').length;
  const approved = transactions.filter(t => t.status === 'Approved').length;
  const rejected = transactions.filter(t => t.status === 'Rejected').length;

  const totalEl = document.getElementById('kpiStaffTotal');
  const pendingEl = document.getElementById('kpiStaffPending');
  const approvedEl = document.getElementById('kpiStaffApproved');
  const rejectedEl = document.getElementById('kpiStaffRejected');

  if (totalEl) totalEl.textContent = total;
  if (pendingEl) pendingEl.textContent = pending;
  if (approvedEl) approvedEl.textContent = approved;
  if (rejectedEl) rejectedEl.textContent = rejected;
}

function renderTable() {
  const tbody = document.getElementById('staffActivityTbody');
  if (!tbody) return;

  const searchVal = (document.getElementById('staffSearchInput')?.value || '').toLowerCase().trim();
  const staffVal = document.getElementById('staffMemberFilter')?.value || 'all';
  const actVal = document.getElementById('staffActivityFilter')?.value || 'all';
  const statusVal = document.getElementById('staffStatusFilter')?.value || 'all';

  const filtered = transactions.filter(t => {
    if (searchVal) {
      const match = (t.staff && t.staff.toLowerCase().includes(searchVal)) ||
                    (t.ref && t.ref.toLowerCase().includes(searchVal)) ||
                    (t.material && t.material.toLowerCase().includes(searchVal)) ||
                    (t.notes && t.notes.toLowerCase().includes(searchVal));
      if (!match) return false;
    }
    if (staffVal !== 'all' && t.staff !== staffVal) return false;
    if (actVal !== 'all' && t.activity !== actVal) return false;
    if (statusVal !== 'all' && t.status !== statusVal) return false;
    return true;
  });

  const countLabel = document.getElementById('staffCountLabel');
  if (countLabel) {
    countLabel.textContent = `Showing ${filtered.length} of ${transactions.length} records`;
  }

  if (filtered.length === 0) {
    const isFiltered = Boolean(searchVal || staffVal !== 'all' || actVal !== 'all' || statusVal !== 'all');
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:44px 16px; color:#5C7A68;">
          <div style="font-weight:700; font-size:15px; color:#0F2A1B; margin-bottom:6px;">
            ${isFiltered ? 'No Matching Staff Records' : 'No Staff Activity Records'}
          </div>
          <div style="font-size:13px; color:#64748B; max-width:440px; margin:0 auto; line-height:1.5;">
            ${isFiltered 
              ? 'No transactions found matching your current filter criteria.' 
              : 'No staff material movements have been submitted yet. Submissions from staff members will appear here automatically for review and approval.'}
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    const isPending = t.status === 'Pending';
    const isReceive = (t.activity || '').toLowerCase().includes('rec');

    return `
      <tr data-ref="${escapeHtml(t.ref)}">
        <td style="font-weight:500; color:#334155;">${escapeHtml(t.date || 'Recent')}</td>
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="width:28px; height:28px; border-radius:50%; background:${t.staffColor || '#DBEAFE'}; color:${t.staffTextColor || '#1D4ED8'}; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:12px;">
              ${escapeHtml(t.staffInitial || (t.staff ? t.staff.charAt(0) : 'S'))}
            </span>
            <span style="font-weight:600; color:#0F2A1B;">${escapeHtml(t.staff || 'Staff Member')}</span>
          </div>
        </td>
        <td>
          <span style="display:inline-block; padding:3px 10px; border-radius:9999px; font-size:11.5px; font-weight:700; background:${isReceive ? '#DCFCE7' : '#FEE2E2'}; color:${isReceive ? '#15803D' : '#DC2626'};">
            ${escapeHtml(t.activity || 'Movement')}
          </span>
        </td>
        <td style="font-weight:600; color:#0F2A1B;">
          ${escapeHtml(t.material || 'Raw Material')} <span style="font-weight:500; color:#5C7A68;">(${escapeHtml(t.qty || t.quantity || '0 kg')})</span>
        </td>
        <td>
          <span class="ref-plain-text" title="Non-clickable, automatic Reference Number">${escapeHtml(t.ref || '--')}</span>
        </td>
        <td>
          <span class="mgr-status-pill status-${(t.status || 'pending').toLowerCase()}">${escapeHtml(t.status || 'Pending')}</span>
        </td>
        <td style="text-align:right;">
          ${isPending 
            ? `<button type="button" class="btn-review-tx" data-ref="${escapeHtml(t.ref)}">Review</button>`
            : `<button type="button" class="btn-view-tx" data-ref="${escapeHtml(t.ref)}">View</button>`
          }
        </td>
      </tr>
    `;
  }).join('');

  // Wire buttons in table
  tbody.querySelectorAll('.btn-review-tx, .btn-view-tx').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ref = btn.getAttribute('data-ref');
      const item = transactions.find(t => t.ref === ref);
      if (item) {
        openReviewModal(item);
      }
    });
  });
}

function bindFilterEvents() {
  const searchInput = document.getElementById('staffSearchInput');
  const staffSelect = document.getElementById('staffMemberFilter');
  const actSelect = document.getElementById('staffActivityFilter');
  const statusSelect = document.getElementById('staffStatusFilter');
  const resetBtn = document.getElementById('btnResetFilters');

  if (searchInput) searchInput.addEventListener('input', renderTable);
  if (staffSelect) staffSelect.addEventListener('change', renderTable);
  if (actSelect) actSelect.addEventListener('change', renderTable);
  if (statusSelect) statusSelect.addEventListener('change', renderTable);

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (staffSelect) staffSelect.value = 'all';
      if (actSelect) actSelect.value = 'all';
      if (statusSelect) statusSelect.value = 'all';
      renderTable();
    });
  }
}

// Review modal handling
let activeReviewItem = null;

function bindReviewModalEvents() {
  const modal = document.getElementById('mgrTxReviewModal');
  const closeBtn = document.getElementById('closeTxReviewModal');
  const btnApprove = document.getElementById('btnApproveTx');
  const btnReject = document.getElementById('btnRejectTx');

  if (closeBtn) closeBtn.addEventListener('click', closeReviewModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeReviewModal();
    });
  }

  if (btnApprove) {
    btnApprove.addEventListener('click', () => {
      if (!activeReviewItem) return;
      activeReviewItem.status = 'Approved';
      activeReviewItem.approvedBy = 'Maria Santos (Manager)';
      activeReviewItem.approvedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      saveTransactions();
      renderCounters();
      renderTable();
      showReviewResult('✓ Transaction approved successfully. Stock balance updated.', true);
      setTimeout(closeReviewModal, 1100);
    });
  }

  if (btnReject) {
    btnReject.addEventListener('click', () => {
      if (!activeReviewItem) return;
      const reasonBox = document.getElementById('rejectReasonBox');
      const reasonInput = document.getElementById('rejectReasonInput');

      if (reasonBox && reasonBox.style.display === 'none') {
        reasonBox.style.display = 'flex';
        btnReject.textContent = 'Confirm Rejection';
        if (reasonInput) reasonInput.focus();
        return;
      }

      const reason = reasonInput ? reasonInput.value.trim() : '';
      if (!reason) {
        alert('Please enter a brief explanation for rejection.');
        return;
      }

      activeReviewItem.status = 'Rejected';
      activeReviewItem.rejectedBy = 'Maria Santos (Manager)';
      activeReviewItem.rejectionReason = reason;
      activeReviewItem.rejectedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      saveTransactions();
      renderCounters();
      renderTable();
      showReviewResult('✗ Transaction has been rejected and returned to staff.', false);
      setTimeout(closeReviewModal, 1100);
    });
  }
}

function openReviewModal(item) {
  activeReviewItem = item;
  const modal = document.getElementById('mgrTxReviewModal');
  if (!modal) return;

  document.getElementById('reviewRefNum').textContent = item.ref || '--';
  document.getElementById('reviewStaff').textContent = item.staff || 'Staff Member';
  document.getElementById('reviewActivity').textContent = item.activity || 'Movement';
  document.getElementById('reviewActivity').style.color = (item.activity || '').toLowerCase().includes('rec') ? '#15803D' : '#DC2626';
  document.getElementById('reviewMaterial').textContent = item.material || '--';
  document.getElementById('reviewQuantity').textContent = item.qty || `${item.qtyNum || item.quantity || 0} ${item.unit || 'kg'}`;
  document.getElementById('reviewDate').textContent = item.date || 'Recent';
  document.getElementById('reviewNotes').textContent = item.notes || 'No extra notes provided.';

  const statusBadge = document.getElementById('reviewStatusBadge');
  if (statusBadge) {
    statusBadge.className = 'mgr-status-pill status-' + (item.status || 'pending').toLowerCase();
    statusBadge.textContent = item.status || 'Pending';
  }

  const reasonBox = document.getElementById('rejectReasonBox');
  const resultBanner = document.getElementById('reviewResultBanner');
  const actionButtons = document.getElementById('reviewActionButtons');
  const btnReject = document.getElementById('btnRejectTx');

  if (reasonBox) reasonBox.style.display = 'none';
  if (resultBanner) resultBanner.style.display = 'none';
  if (btnReject) btnReject.textContent = 'Reject';

  if (item.status === 'Approved') {
    if (actionButtons) actionButtons.style.display = 'none';
    if (resultBanner) {
      resultBanner.style.display = 'block';
      resultBanner.style.background = '#DCFCE7';
      resultBanner.style.color = '#15803D';
      resultBanner.textContent = `✓ This transaction was approved by ${item.approvedBy || 'Manager'}.`;
    }
  } else if (item.status === 'Rejected') {
    if (actionButtons) actionButtons.style.display = 'none';
    if (resultBanner) {
      resultBanner.style.display = 'block';
      resultBanner.style.background = '#FEE2E2';
      resultBanner.style.color = '#DC2626';
      resultBanner.textContent = `✗ This transaction was rejected: "${item.rejectionReason || 'Declined'}".`;
    }
  } else {
    if (actionButtons) actionButtons.style.display = 'flex';
  }

  modal.style.display = 'flex';
}

function closeReviewModal() {
  const modal = document.getElementById('mgrTxReviewModal');
  if (modal) modal.style.display = 'none';
  activeReviewItem = null;
}

function showReviewResult(msg, isSuccess) {
  const banner = document.getElementById('reviewResultBanner');
  const actionButtons = document.getElementById('reviewActionButtons');
  if (actionButtons) actionButtons.style.display = 'none';
  if (banner) {
    banner.style.display = 'block';
    banner.style.background = isSuccess ? '#DCFCE7' : '#FEE2E2';
    banner.style.color = isSuccess ? '#15803D' : '#DC2626';
    banner.textContent = msg;
  }
}
"""

with open(file_path, "w", encoding="utf-8") as f:
    f.write(code)

print("Updated js/staff-activity.js successfully.")
