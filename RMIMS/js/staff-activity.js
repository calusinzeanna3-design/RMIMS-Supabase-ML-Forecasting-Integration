/**
 * RMSME Staff Activity & Review Module Logic
 * Implements Section 15, 16, 17, 20, 21, 23, 25, 26, 30:
 * - 3 Manager Actions:
 *   1. Approve -> Updates official inventory, status = Approved
 *   2. Return for Correction -> Manager writes correction message, status = Correction Needed
 *   3. Reject -> Status = Rejected, no inventory update
 * - Manager sees 🔵 UPDATED inside the Review popup for resubmitted transactions
 * - Displays previous correction message and diff (e.g. Quantity: 200 kg → 150 kg)
 * - Actual status remains Pending
 * - Official inventory is updated ONLY after Manager approval
 */

import {
  getSystemRawMaterials,
  saveCustomRawMaterial,
  saveCustomReceipt,
  saveCustomDisbursement,
  adjustSystemMaterialStock,
  invalidateForecastCache
} from './system-materials.js';

import {
  getStaffTransactions
} from './rmims-transaction-engine.js';
import { approveTransactionOnSupabase, rejectTransactionOnSupabase, broadcastManagerSync } from '../supabase/manager-supabase-service.js';

const STAFF_TX_KEY = 'rmims_staff_transactions';

let transactions = [];
let activeReviewItem = null;

function loadTransactions() {
  transactions = getStaffTransactions();
}

function saveTransactions() {
  try {
    localStorage.setItem(STAFF_TX_KEY, JSON.stringify(transactions));
  } catch (e) {}
}

function escapeHtml(str) {
  if (str == null) return '';
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

  // Refresh button
  const btnRefresh = document.getElementById('btnRefreshStaffActivity');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadTransactions();
      populateStaffFilterOptions();
      renderCounters();
      renderTable();
    });
  }

  // Cross-tab and real-time sync
  const refreshAllState = () => {
    loadTransactions();
    populateStaffFilterOptions();
    renderCounters();
    renderTable();
  };

  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.includes('transactions') || e.key.includes('activity') || e.key.includes('materials') || e.key.includes('receipts') || e.key.includes('disbursements')) {
      refreshAllState();
    }
  });

  window.addEventListener('rmims_staff_transactions_updated', refreshAllState);
  window.addEventListener('rmims_inventory_updated', refreshAllState);

  // URL query check: e.g. ?review=REC-2026-00125
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
      const matchStaff = (t.staff || '').toLowerCase().includes(searchVal);
      const matchRef = (t.ref || '').toLowerCase().includes(searchVal);
      const matchMat = (t.material || '').toLowerCase().includes(searchVal);
      const matchNotes = (t.notes || '').toLowerCase().includes(searchVal);
      if (!matchStaff && !matchRef && !matchMat && !matchNotes) return false;
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
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:44px 16px; color:#5C7A68;">
          <div style="font-weight:700; font-size:15px; color:#0F2A1B; margin-bottom:6px;">No Staff Activity Records</div>
          <div style="font-size:13px; color:#64748B;">No staff material movements match your filter criteria.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    const isPending = t.status === 'Pending';
    const isReceive = (t.activity || '').toLowerCase().includes('rec');
    const isCorrection = t.status === 'Correction Needed';

    let statusPill = '';
    if (t.status === 'Approved') {
      statusPill = `<span class="badge" style="background:#DCFCE7; color:#15803D; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Approved</span>`;
    } else if (t.status === 'Rejected') {
      statusPill = `<span class="badge" style="background:#FEE2E2; color:#DC2626; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Rejected</span>`;
    } else if (isCorrection) {
      statusPill = `<span class="badge" style="background:#FEF3C7; color:#D97706; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Correction Needed</span>`;
    } else {
      statusPill = `<span class="badge" style="background:#E0F2FE; color:#0369A1; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Pending</span>`;
    }

    // Indicator if resubmitted (for manager table hint)
    const updatedTag = t.isUpdated ? `<span style="margin-left:6px; font-size:11px; background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; padding:1px 6px; border-radius:4px; font-weight:700;">Resubmitted</span>` : '';

    const dateStr = String(t.date || '');
    let datePart = dateStr || '—';
    let timePart = t.time || '—';
    if (dateStr.includes('•')) {
      const parts = dateStr.split('•');
      datePart = parts[0].trim();
      timePart = parts[1].trim();
    }

    return `
      <tr data-ref="${escapeHtml(t.ref)}">
        <td style="font-weight:600; color:#334155; font-size:12.5px;">${escapeHtml(datePart)}</td>
        <td style="font-size:12px; color:#64748B; font-weight:600;">${escapeHtml(timePart)}</td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="width:28px; height:28px; border-radius:50%; background:#DCFCE7; color:#15803D; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:11px;">
              ${escapeHtml(t.staff ? t.staff.charAt(0) : 'S')}
            </span>
            <span style="font-weight:600; color:#0F2A1B; font-size:13px;">${escapeHtml(t.staff || 'Staff Member')}</span>
          </div>
        </td>
        <td>
          <span style="display:inline-block; padding:2px 8px; border-radius:6px; font-size:11.5px; font-weight:700; background:${isReceive ? '#DCFCE7' : '#FEF3C7'}; color:${isReceive ? '#15803D' : '#D97706'};">
            ${escapeHtml(t.activity || 'Receive')}
          </span>
        </td>
        <td style="font-weight:600; color:#0F2A1B;">
          ${escapeHtml(t.material || 'Raw Material')}
        </td>
        <td style="font-weight:700; color:${isReceive ? '#15803D' : '#D97706'};">
          ${isReceive ? '+' : '-'}${escapeHtml(t.quantity || 0)}${t.unit ? ' ' + escapeHtml(t.unit) : ''}
        </td>
        <td>
          <span class="ref-plain-text" style="font-weight:700; font-family:'Sora',sans-serif; color:#0F2A1B;">${escapeHtml(t.ref || '--')}</span>
        </td>
        <td>
          ${statusPill} ${updatedTag}
        </td>
        <td style="text-align:right;">
          ${isPending 
            ? `<button type="button" class="btn-review-tx" data-ref="${escapeHtml(t.ref)}" style="padding:5px 12px; font-size:12px; font-weight:700; border-radius:6px; background:#15803D; color:#FFF; border:none; cursor:pointer;">Review</button>`
            : `<button type="button" class="btn-view-tx" data-ref="${escapeHtml(t.ref)}" style="padding:5px 10px; font-size:12px; font-weight:600; color:#5C7A68; background:transparent; border:none; cursor:pointer;">View</button>`
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

function bindReviewModalEvents() {
  const modal = document.getElementById('mgrTxReviewModal');
  const closeBtn = document.getElementById('closeTxReviewModal');
  const btnApprove = document.getElementById('btnApproveTx');
  const btnReturn = document.getElementById('btnReturnTx');
  const btnReject = document.getElementById('btnRejectTx');

  const btnConfirmReturn = document.getElementById('btnConfirmReturnTx');
  const btnCancelReturn = document.getElementById('btnCancelReturnTx');
  const btnConfirmReject = document.getElementById('btnConfirmRejectTx');
  const btnCancelReject = document.getElementById('btnCancelRejectTx');

  if (closeBtn) closeBtn.addEventListener('click', closeReviewModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeReviewModal();
    });
  }

  // 1. APPROVE ACTION (Section 16, 23)
  if (btnApprove) {
    btnApprove.addEventListener('click', handleApproveTransaction);
  }

  // 2. RETURN FOR CORRECTION ACTION (Section 16, 17)
  if (btnReturn) {
    btnReturn.addEventListener('click', () => {
      const correctionBox = document.getElementById('correctionReasonBox');
      const rejectBox = document.getElementById('rejectReasonBox');
      if (rejectBox) rejectBox.style.display = 'none';
      if (correctionBox) {
        correctionBox.style.display = 'flex';
        document.getElementById('correctionReasonInput')?.focus();
      }
    });
  }

  if (btnCancelReturn) {
    btnCancelReturn.addEventListener('click', () => {
      const correctionBox = document.getElementById('correctionReasonBox');
      if (correctionBox) correctionBox.style.display = 'none';
    });
  }

  if (btnConfirmReturn) {
    btnConfirmReturn.addEventListener('click', handleConfirmReturnForCorrection);
  }

  // 3. REJECT ACTION (Section 16)
  if (btnReject) {
    btnReject.addEventListener('click', () => {
      const correctionBox = document.getElementById('correctionReasonBox');
      const rejectBox = document.getElementById('rejectReasonBox');
      if (correctionBox) correctionBox.style.display = 'none';
      if (rejectBox) {
        rejectBox.style.display = 'flex';
        document.getElementById('rejectReasonInput')?.focus();
      }
    });
  }

  if (btnCancelReject) {
    btnCancelReject.addEventListener('click', () => {
      const rejectBox = document.getElementById('rejectReasonBox');
      if (rejectBox) rejectBox.style.display = 'none';
    });
  }

  if (btnConfirmReject) {
    btnConfirmReject.addEventListener('click', handleConfirmReject);
  }
}

function openReviewModal(item) {
  activeReviewItem = item;
  const modal = document.getElementById('mgrTxReviewModal');
  if (!modal) return;

  const isReceive = (item.activity || '').toLowerCase().includes('rec');

  document.getElementById('reviewRefNum').textContent = item.ref || '--';
  document.getElementById('reviewStaff').textContent = item.staff || 'Staff Member';
  document.getElementById('reviewActivity').textContent = item.activity || (isReceive ? 'Receive' : 'Disburse');
  document.getElementById('reviewActivity').style.color = isReceive ? '#15803D' : '#D97706';
  document.getElementById('reviewMaterial').textContent = item.material || '--';
  document.getElementById('reviewQuantity').textContent = `${isReceive ? '+' : '-'}${item.quantity}${item.unit ? ' ' + item.unit : ''}`;
  document.getElementById('reviewDate').textContent = item.date || 'Recent';
  document.getElementById('reviewNotes').textContent = item.notes || 'No extra notes provided.';

  // Section 20: 🔵 UPDATED INDICATOR inside the Review popup
  const updatedBadge = document.getElementById('reviewUpdatedBadge');
  const correctionDiffBox = document.getElementById('reviewCorrectionDiffBox');
  const prevCorrectionMsg = document.getElementById('revPrevCorrectionMsg');
  const diffDetails = document.getElementById('revDiffDetails');

  if (item.isUpdated) {
    if (updatedBadge) updatedBadge.style.display = 'inline-block';
    if (correctionDiffBox) {
      correctionDiffBox.style.display = 'flex';
      if (prevCorrectionMsg) {
        prevCorrectionMsg.textContent = `"${item.previousCorrectionMessage || 'Please verify the transaction details.'}"`;
      }
      if (diffDetails) {
        const prev = item.previousValues || {};
        const changes = [];
        if (prev.quantity != null && prev.quantity !== item.quantity) {
          changes.push(`Quantity: <strong>${prev.quantity} ${prev.unit || item.unit} &rarr; ${item.quantity} ${item.unit}</strong>`);
        }
        if (prev.material && prev.material !== item.material) {
          changes.push(`Material: <strong>${prev.material} &rarr; ${item.material}</strong>`);
        }
        if (prev.date && prev.date !== item.date) {
          changes.push(`Date: <strong>${prev.date} &rarr; ${item.date}</strong>`);
        }
        if (changes.length === 0) {
          changes.push(`Details revised and resubmitted by Staff.`);
        }
        diffDetails.innerHTML = changes.join('<br>');
      }
    }
  } else {
    if (updatedBadge) updatedBadge.style.display = 'none';
    if (correctionDiffBox) correctionDiffBox.style.display = 'none';
  }

  // Status badge
  const statusBadge = document.getElementById('reviewStatusBadge');
  if (statusBadge) {
    statusBadge.className = 'mgr-status-pill status-' + (item.status || 'pending').toLowerCase();
    statusBadge.textContent = item.status || 'Pending';
  }

  // Reset inputs & boxes
  document.getElementById('rejectReasonBox').style.display = 'none';
  document.getElementById('correctionReasonBox').style.display = 'none';
  document.getElementById('reviewResultBanner').style.display = 'none';

  const actionButtons = document.getElementById('reviewActionButtons');
  if (item.status === 'Approved') {
    if (actionButtons) actionButtons.style.display = 'none';
    showReviewResult(`✓ This transaction was approved by ${item.approvedBy || 'Manager'}. Official inventory has been updated.`, true);
  } else if (item.status === 'Rejected') {
    if (actionButtons) actionButtons.style.display = 'none';
    showReviewResult(`✗ This transaction was rejected: "${item.rejectionReason || 'Declined'}".`, false);
  } else if (item.status === 'Correction Needed') {
    if (actionButtons) actionButtons.style.display = 'none';
    showReviewResult(`⚠ Awaiting staff revision. Sent message: "${item.correctionMessage || 'Please correct details.'}".`, false, '#FFFBEB', '#92400E');
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

// 1. APPROVE TRANSACTION LOGIC
function handleApproveTransaction() {
  if (!activeReviewItem) return;

  const isReceive = (activeReviewItem.activity || activeReviewItem.type || '').toLowerCase().includes('rec') ||
                    String(activeReviewItem.ref || '').toUpperCase().startsWith('REC');
  const rawQty = activeReviewItem.quantity != null ? activeReviewItem.quantity :
                 (activeReviewItem.qtyNum != null ? activeReviewItem.qtyNum : activeReviewItem.qty);
  const qty = parseFloat(rawQty) || 0;
  const materialName = activeReviewItem.material;

  // Update transaction status
  activeReviewItem.status = 'Approved';
  activeReviewItem.approvedBy = 'Manager';
  activeReviewItem.approvedAt = new Date().toISOString();
  activeReviewItem.quantity = qty;
  if (!activeReviewItem.unit) {
    activeReviewItem.unit = (activeReviewItem.qty ? String(activeReviewItem.qty).replace(/^[0-9.\s]+/, '') : '') || 'kg';
  }

  // Ensure transactions array has the updated transaction and persist immediately
  const txIdx = transactions.findIndex(t => t.ref === activeReviewItem.ref || t.id === activeReviewItem.id);
  if (txIdx !== -1) {
    transactions[txIdx] = activeReviewItem;
  }
  saveTransactions();

  // Supabase commit
  approveTransactionOnSupabase(activeReviewItem).catch(e => console.warn('[StaffActivity] Supabase notice:', e));

  // =========================================================================
  // SECTION 23: OFFICIAL INVENTORY UPDATE RULE
  // Only approved Staff transactions update official inventory and Manager Ledgers
  // =========================================================================
  updateSystemInventory(materialName, qty, isReceive, activeReviewItem);

  renderCounters();
  renderTable();

  // Broadcast sync events across all open windows & tabs
  try {
    localStorage.setItem('rmims_staff_activity_updated', String(Date.now()));
    localStorage.setItem('rmims_inventory_updated', String(Date.now()));
    if (isReceive) {
      localStorage.setItem('rmims_manager_receipts_updated', String(Date.now()));
    } else {
      localStorage.setItem('rmims_manager_disbursements_updated', String(Date.now()));
    }
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail: activeReviewItem }));
    window.dispatchEvent(new CustomEvent('rmims_staff_activity_updated', { detail: activeReviewItem }));
    if (isReceive) {
      window.dispatchEvent(new CustomEvent('rmims_manager_receipts_updated', { detail: activeReviewItem }));
    } else {
      window.dispatchEvent(new CustomEvent('rmims_manager_disbursements_updated', { detail: activeReviewItem }));
    }
  } catch (e) {}

  // Broadcast live notification to Staff
  const appNotif = {
    title: `Transaction Approved: ${activeReviewItem.ref}`,
    message: `Store Manager approved ${activeReviewItem.ref} (${qty}${activeReviewItem.unit ? ' ' + activeReviewItem.unit : ''} of ${materialName}). Official stock synchronized.`,
    category: 'Inventory',
    badge: 'Approved',
    role: 'staff',
    targetRole: 'staff',
    roleScope: 'staff',
    priority: 'success',
    targetUrl: `user/my-activity.html?view=${encodeURIComponent(activeReviewItem.ref)}`,
    ref: activeReviewItem.ref,
    material: materialName,
    quantity: qty,
    actor: 'Store Manager'
  };

  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(appNotif);
    }
  } catch (e) {}

  // Broadcast cross-tab, cross-browser & cross-device to Staff
  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync({
        transaction: activeReviewItem,
        notification: appNotif,
        allTransactions: transactions
      });
    }
  } catch (e) {}

  showReviewResult('✓ Transaction approved successfully! Official inventory has been updated.', true);
  setTimeout(closeReviewModal, 1200);
}

// 2. RETURN FOR CORRECTION LOGIC
function handleConfirmReturnForCorrection() {
  if (!activeReviewItem) return;

  const msgInput = document.getElementById('correctionReasonInput');
  const msg = msgInput ? msgInput.value.trim() : '';

  if (!msg) {
    alert('Please enter a correction message for the Staff member.');
    if (msgInput) msgInput.focus();
    return;
  }

  // Section 16 & 17: Return for Correction
  // Staff receives message -> Status becomes Correction Needed
  activeReviewItem.status = 'Correction Needed';
  activeReviewItem.correctionMessage = msg;
  activeReviewItem.returnedBy = 'Manager';
  activeReviewItem.returnedAt = new Date().toISOString();

  saveTransactions();
  renderCounters();
  renderTable();

  // Broadcast sync events across all open windows & tabs
  try {
    localStorage.setItem('rmims_staff_activity_updated', String(Date.now()));
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail: activeReviewItem }));
  } catch (e) {}

  // Broadcast live notification across all roles (Admin, Manager, Staff)
  const corrNotif = {
    title: `Correction Requested: ${activeReviewItem.ref}`,
    message: `Transaction ${activeReviewItem.ref} returned by Store Manager: "${msg}". Action required from staff.`,
    category: 'Inventory',
    badge: 'Action Required',
    role: 'staff',
    targetRole: 'staff',
    roleScope: 'staff',
    priority: 'high',
    targetUrl: `user/my-activity.html?correct=${encodeURIComponent(activeReviewItem.ref)}`,
    ref: activeReviewItem.ref,
    material: activeReviewItem.material || activeReviewItem.rawMaterial || '',
    quantity: activeReviewItem.qty || `${activeReviewItem.quantity || ''}`,
    actor: 'Store Manager'
  };

  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(corrNotif);
    }
  } catch (e) {}

  // Broadcast cross-tab, cross-browser & cross-device to Staff and Admin
  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync({
        transaction: activeReviewItem,
        notification: corrNotif,
        allTransactions: transactions
      });
    }
  } catch (e) {}

  showReviewResult(`⚠ Transaction returned for correction. Staff will keep reference ${activeReviewItem.ref} and revise details.`, false, '#FFFBEB', '#92400E');
  setTimeout(closeReviewModal, 1300);
}

// 3. REJECT LOGIC
async function handleConfirmReject() {
  if (!activeReviewItem) return;

  const reasonInput = document.getElementById('rejectReasonInput');
  const reason = reasonInput ? reasonInput.value.trim() : '';

  if (!reason) {
    alert('Please enter the reason for rejection.');
    if (reasonInput) reasonInput.focus();
    return;
  }

  rejectTransactionOnSupabase(activeReviewItem, reason).catch(e => console.warn('[StaffActivity] Supabase notice:', e));

  if (!reason) {
    alert('Please enter the reason for rejection.');
    if (reasonInput) reasonInput.focus();
    return;
  }

  // Section 16: Reject -> Status: Rejected. Inventory is NOT updated.
  activeReviewItem.status = 'Rejected';
  activeReviewItem.rejectionReason = reason;
  activeReviewItem.rejectedBy = 'Manager';
  activeReviewItem.rejectedAt = new Date().toISOString();

  saveTransactions();
  renderCounters();
  renderTable();

  // Broadcast sync events across all open windows & tabs
  try {
    localStorage.setItem('rmims_staff_activity_updated', String(Date.now()));
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail: activeReviewItem }));
  } catch (e) {}

  // Broadcast live notification across all roles (Admin, Manager, Staff)
  const rejNotif = {
    title: `Transaction Rejected: ${activeReviewItem.ref}`,
    message: `Transaction ${activeReviewItem.ref} was rejected by Store Manager: "${reason}".`,
    category: 'Inventory',
    badge: 'Rejected',
    role: 'staff',
    targetRole: 'staff',
    roleScope: 'staff',
    priority: 'danger',
    targetUrl: `user/my-activity.html?view=${encodeURIComponent(activeReviewItem.ref)}`,
    ref: activeReviewItem.ref,
    material: activeReviewItem.material || activeReviewItem.rawMaterial || '',
    quantity: activeReviewItem.qty || `${activeReviewItem.quantity || ''}`,
    actor: 'Store Manager'
  };

  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(rejNotif);
    }
  } catch (e) {}

  // Broadcast cross-tab, cross-browser & cross-device to Staff and Admin
  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync({
        transaction: activeReviewItem,
        notification: rejNotif,
        allTransactions: transactions
      });
    }
  } catch (e) {}

  showReviewResult('✗ Transaction has been rejected. Official inventory was not modified.', false);
  setTimeout(closeReviewModal, 1200);
}

/**
 * Updates official system inventory upon approval
 * Reliably synchronizes official raw materials stock, custom ledgers, and manager ledgers
 */
function updateSystemInventory(materialName, quantity, isReceive, tx) {
  const materials = getSystemRawMaterials();
  const searchName = String(materialName || tx.material || '').trim().toLowerCase();
  const found = materials.find(m => 
    (m.name || m.materialName || m.raw_material_name || '').trim().toLowerCase() === searchName ||
    String(m.id || '').toLowerCase() === searchName ||
    String(m.item_code || '').toLowerCase() === searchName
  );

  const matId = found ? (found.id || found.item_code) : (tx.materialId || tx.item_code || tx.material);
  const resolvedMatName = found ? (found.name || found.materialName || found.raw_material_name) : materialName;
  const unit = tx.unit || (found ? (found.unit_of_measure || found.unit) : '') || 'kg';
  const delta = isReceive ? quantity : -quantity;

  // 1. Authoritative stock adjustment via system-materials (handles base + overrides)
  if (found || materialName) {
    adjustSystemMaterialStock(matId || resolvedMatName, delta);
    updateMaterialActivityTimestamp(matId || resolvedMatName, new Date().toISOString(), isReceive ? 'Receive' : 'Disburse', quantity, unit);
  }

  // 2. Also ensure custom raw materials list explicitly persists the updated stock
  try {
    const customMatsRaw = localStorage.getItem('rmims_custom_raw_materials');
    if (customMatsRaw) {
      const customMats = JSON.parse(customMatsRaw);
      if (Array.isArray(customMats)) {
        const cIdx = customMats.findIndex(m => 
          (m.name || '').trim().toLowerCase() === searchName ||
          String(m.id || '').toLowerCase() === String(matId).toLowerCase() ||
          String(m.item_code || '').toLowerCase() === String(matId).toLowerCase()
        );
        if (cIdx !== -1) {
          const oldStock = Number(customMats[cIdx].current_stock ?? customMats[cIdx].currentStock ?? 0);
          const newStock = Math.max(0, oldStock + delta);
          customMats[cIdx].current_stock = newStock;
          customMats[cIdx].currentStock = newStock;
          customMats[cIdx].last_updated = new Date().toISOString();
          localStorage.setItem('rmims_custom_raw_materials', JSON.stringify(customMats));
        }
      }
    }
  } catch (e) {}

  // 3. Log official receipt or disbursement
  if (isReceive) {
    saveCustomReceipt({
      id: `rec-${tx.ref}`,
      referenceNo: tx.ref,
      material_id: matId,
      materialId: matId,
      material_name: resolvedMatName,
      materialName: resolvedMatName,
      received_quantity: quantity,
      quantity: quantity,
      unit: unit,
      receipt_date: tx.date || new Date().toISOString().slice(0, 10),
      supplier_name: tx.supplier || 'Staff Inward Delivery',
      supplierName: tx.supplier || 'Staff Inward Delivery',
      received_by: tx.staff || 'Staff Member',
      created_at: new Date().toISOString()
    });

    // Also persist to rmims_manager_receipts ledger
    try {
      const mgrRecRaw = localStorage.getItem('rmims_manager_receipts');
      let mgrRecs = mgrRecRaw ? JSON.parse(mgrRecRaw) : [];
      if (!Array.isArray(mgrRecs)) mgrRecs = [];
      mgrRecs = mgrRecs.filter(r => r.ref !== tx.ref);
      mgrRecs.unshift({
        ref: tx.ref,
        date: tx.date || new Date().toISOString().slice(0, 10),
        time: tx.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        materialId: matId,
        materialName: resolvedMatName,
        quantity: quantity,
        unit: unit,
        supplier: tx.supplier || 'Staff Inward Delivery',
        recordedBy: tx.staff || 'Staff Member',
        approvedBy: 'Store Manager',
        status: 'Approved',
        notes: tx.notes || `Submitted by ${tx.staff || 'Staff'}, approved by Manager`
      });
      localStorage.setItem('rmims_manager_receipts', JSON.stringify(mgrRecs));
    } catch (e) {}
  } else {
    saveCustomDisbursement({
      id: `disb-${tx.ref}`,
      referenceNo: tx.ref,
      material_id: matId,
      materialId: matId,
      material_name: resolvedMatName,
      materialName: resolvedMatName,
      consumed_quantity: quantity,
      quantity: quantity,
      unit: unit,
      usage_date: tx.date || new Date().toISOString().slice(0, 10),
      activity_type: 'Production Usage',
      finished_product_name: tx.usedFor || 'Production Batch',
      context: tx.usedFor || 'Production Batch',
      recorded_by: tx.staff || 'Staff Member',
      created_at: new Date().toISOString()
    });

    // Also persist to rmims_manager_disbursements ledger
    try {
      const mgrDisbRaw = localStorage.getItem('rmims_manager_disbursements');
      let mgrDisbs = mgrDisbRaw ? JSON.parse(mgrDisbRaw) : [];
      if (!Array.isArray(mgrDisbs)) mgrDisbs = [];
      mgrDisbs = mgrDisbs.filter(d => d.ref !== tx.ref);
      mgrDisbs.unshift({
        ref: tx.ref,
        date: tx.date || new Date().toISOString().slice(0, 10),
        time: tx.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        materialId: matId,
        materialName: resolvedMatName,
        quantity: quantity,
        unit: unit,
        usedFor: tx.usedFor || 'Production Batch',
        recordedBy: tx.staff || 'Staff Member',
        approvedBy: 'Store Manager',
        status: 'Approved',
        notes: tx.notes || `Submitted by ${tx.staff || 'Staff'}, approved by Manager`
      });
      localStorage.setItem('rmims_manager_disbursements', JSON.stringify(mgrDisbs));
    } catch (e) {}
  }

  // 4. Record into manager activities
  try {
    const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
    const actRaw = localStorage.getItem('rmims_manager_activities');
    const acts = actRaw ? JSON.parse(actRaw) : [];
    acts.unshift({
      datetime: tx.date || new Date().toISOString().slice(0, 10),
      timestamp: new Date().toISOString(),
      activity: isReceive
        ? `Approved Staff Receive: +${quantity} ${unit} ${resolvedMatName} (${tx.ref})`
        : `Approved Staff Disburse: -${quantity} ${unit} ${resolvedMatName} (${tx.ref})`,
      reference: tx.ref,
      status: 'Approved',
      user: curUser.name || curUser.fullName || curUser.username || 'Store Manager',
      role: 'Manager',
      branchLoc: curUser.branchLoc || curUser.location || '',
      branchName: curUser.branchName || curUser.branch || '',
      action: isReceive ? 'Approved Receive' : 'Approved Disburse',
      module: 'Staff Activity'
    });
    localStorage.setItem('rmims_manager_activities', JSON.stringify(acts));
  } catch (e) {}

  // 5. Invalidate forecast cache and broadcast live sync events
  invalidateForecastCache();
  localStorage.setItem('rmims_inventory_updated', String(Date.now()));
  localStorage.setItem('rmims_staff_activity_updated', String(Date.now()));
  if (isReceive) {
    localStorage.setItem('rmims_manager_receipts_updated', String(Date.now()));
  } else {
    localStorage.setItem('rmims_manager_disbursements_updated', String(Date.now()));
  }
  window.dispatchEvent(new Event('storage'));
  window.dispatchEvent(new CustomEvent('rmims_inventory_updated', { detail: { materialName: resolvedMatName, delta } }));
  window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail: tx }));
  window.dispatchEvent(new CustomEvent('rmims_staff_activity_updated', { detail: tx }));
  if (isReceive) {
    window.dispatchEvent(new CustomEvent('rmims_manager_receipts_updated', { detail: tx }));
  } else {
    window.dispatchEvent(new CustomEvent('rmims_manager_disbursements_updated', { detail: tx }));
  }

  // Broadcast live notification across all roles (Admin, Manager, Staff)
  const appNotif = {
    title: `Transaction Approved: ${tx.ref}`,
    message: `Your submission ${tx.ref} (+${quantity} ${unit} of ${resolvedMatName}) was approved by Store Manager. Inventory updated.`,
    category: 'Inventory',
    badge: 'Approved',
    role: 'staff',
    targetRole: 'staff',
    roleScope: 'staff',
    priority: 'normal',
    targetUrl: `user/my-activity.html?view=${encodeURIComponent(tx.ref)}`,
    ref: tx.ref,
    material: resolvedMatName,
    quantity: `${quantity} ${unit}`,
    actor: 'Store Manager'
  };

  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(appNotif);
    }
  } catch (e) {}

  // Broadcast cross-tab, cross-browser & cross-device to Staff and Admin
  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync({
        transaction: tx,
        notification: appNotif,
        allTransactions: transactions
      });
    }
  } catch (e) {}
}

function showReviewResult(msg, isSuccess, customBg, customColor) {
  const banner = document.getElementById('reviewResultBanner');
  const actionButtons = document.getElementById('reviewActionButtons');
  if (actionButtons) actionButtons.style.display = 'none';
  if (banner) {
    banner.style.display = 'block';
    banner.style.background = customBg || (isSuccess ? '#DCFCE7' : '#FEE2E2');
    banner.style.color = customColor || (isSuccess ? '#15803D' : '#DC2626');
    banner.textContent = msg;
  }
}
