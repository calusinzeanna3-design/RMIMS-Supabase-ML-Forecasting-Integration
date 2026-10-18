/**
 * RMIMS Staff My Activity & Correction Workflow
 * Implements Section 18, 19, 20, 21, 22, 27:
 * - Shows Staff member's transaction history (Receive and Disburse)
 * - Highlights transactions requiring correction with Manager's message
 * - "My Activity" acts as the dedicated viewer of manager messages and submitted activities
 * - When the message is viewed, staff clicks "Correct Record" (or "Update Record") at the bottom
 * - Automatically pops up the small box correction form right on screen (Never redirects to receive.html)
 * - Form matches the receive module form fields & structure in a small on-screen box
 * - Correction maintains the EXACT SAME reference number (locked display)
 * - Resubmission sets status to 'Pending' (NOT 'UPDATED')
 * - Resubmission stores change diff so Manager sees '🔵 UPDATED' in Review popup
 */

import { getSystemRawMaterials } from './system-materials.js';
import {
  getStaffTransactions,
  resubmitStaffCorrection,
  checkReferenceDuplicate
} from './rmims-transaction-engine.js';

let rawMaterials = [];
let allTransactions = [];
let activeTxForCorrection = null;

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function findTx(refOrId) {
  if (!refOrId) return null;
  const target = String(refOrId).trim().toLowerCase();
  let match = allTransactions.find(t => 
    (t.ref && String(t.ref).trim().toLowerCase() === target) || 
    (t.id && String(t.id).trim().toLowerCase() === target)
  );
  if (!match) {
    const fresh = getStaffTransactions();
    match = fresh.find(t => 
      (t.ref && String(t.ref).trim().toLowerCase() === target) || 
      (t.id && String(t.id).trim().toLowerCase() === target)
    );
  }
  return match;
}

function closeViewModal() {
  const modal = document.getElementById('viewTxModal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
}

function closeCorrectionModal() {
  const modal = document.getElementById('staffCorrectionModal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  rawMaterials = getSystemRawMaterials();
  populateMaterialSelects();
  initDatePickers();
  bindEvents();
  loadAndRenderActivity();

  // URL query check: e.g. ?correct=REC-2026-00125 or ?ref=REC-2026-00125 or ?view=REC-2026-00125
  const params = new URLSearchParams(window.location.search);
  const correctTarget = params.get('correct');
  const viewTarget = params.get('view') || params.get('ref');
  const filterVal = params.get('filter');

  if (filterVal) {
    const statusSelect = document.getElementById('filterStatusSelect');
    if (statusSelect) {
      statusSelect.value = filterVal;
      applyFiltersAndRender();
    }
  }

  if (correctTarget) {
    setTimeout(() => {
      const tx = findTx(correctTarget);
      if (tx) {
        openCorrectionModal(tx);
      }
    }, 200);
  } else if (viewTarget) {
    setTimeout(() => {
      const tx = findTx(viewTarget);
      if (tx) {
        openViewModal(tx);
      }
    }, 200);
  }

  // Cross-tab and real-time sync
  const refreshActivityState = () => {
    loadAndRenderActivity();
  };

  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.includes('transactions') || e.key.includes('materials') || e.key.includes('activity')) {
      refreshActivityState();
    }
  });
  window.addEventListener('rmims_staff_transactions_updated', refreshActivityState);
  window.addEventListener('rmims_inventory_updated', refreshActivityState);

  // If no transactions currently loaded, ping for state synchronization
  if (allTransactions.length === 0) {
    setTimeout(() => {
      if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
        window.broadcastRMIMSSync({ isStateRequest: true });
      }
    }, 400);
    setTimeout(() => {
      if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
        window.broadcastRMIMSSync({ isStateRequest: true });
      }
    }, 1200);
  }
});

function initDatePickers() {
  const corrDateInput = document.getElementById('corrDateInput');
  if (corrDateInput && typeof flatpickr !== 'undefined') {
    flatpickr(corrDateInput, {
      dateFormat: 'Y-m-d',
      maxDate: new Date(),
      allowInput: false
    });
  }
}

function populateMaterialSelects() {
  const corrMatSelect = document.getElementById('corrMaterialSelect');
  if (!corrMatSelect) return;

  corrMatSelect.innerHTML = '<option value="">-- Choose Raw Material --</option>';
  rawMaterials.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.name || m.materialName;
    const unit = m.unit_of_measure || m.unit || '';
    opt.textContent = unit ? `${m.name || m.materialName} (${m.category || 'General'} • ${unit})` : `${m.name || m.materialName} (${m.category || 'General'})`;
    opt.dataset.unit = unit;
    corrMatSelect.appendChild(opt);
  });

  // Material change updates stock preview badge and unit badge
  corrMatSelect.addEventListener('change', () => {
    updateStockPreview(corrMatSelect.value);
  });

  const corrUnitSelect = document.getElementById('corrUnitSelect');
  if (corrUnitSelect) {
    corrUnitSelect.addEventListener('change', () => {
      const badge = document.getElementById('corrUnitBadge');
      if (badge) badge.textContent = corrUnitSelect.value;
    });
  }
}

function updateStockPreview(matName) {
  const previewWrap = document.getElementById('corrStockPreview');
  const stockValEl = document.getElementById('corrStockVal');
  const minValEl = document.getElementById('corrMinVal');
  const unitBadge = document.getElementById('corrUnitBadge');
  const unitSelect = document.getElementById('corrUnitSelect');

  if (!previewWrap) return;

  if (!matName) {
    previewWrap.style.display = 'none';
    if (unitBadge) unitBadge.textContent = '--';
    return;
  }

  const mat = rawMaterials.find(m => (m.name || m.materialName) === matName);
  if (!mat) {
    previewWrap.style.display = 'none';
    if (unitBadge) unitBadge.textContent = '--';
    return;
  }

  const unit = mat.unit_of_measure || mat.unit || '';
  const currentStock = mat.currentStock != null ? mat.currentStock : (mat.stock != null ? mat.stock : 0);
  const minStock = mat.minStock != null ? mat.minStock : (mat.minThreshold != null ? mat.minThreshold : 10);

  if (stockValEl) stockValEl.textContent = unit ? `${currentStock} ${unit}` : `${currentStock}`;
  if (minValEl) minValEl.textContent = unit ? `${minStock} ${unit}` : `${minStock}`;
  if (unitBadge) unitBadge.textContent = unit || '--';
  if (unitSelect) {
    if (unit && !Array.from(unitSelect.options).some(o => o.value === unit)) {
      const opt = document.createElement('option');
      opt.value = unit;
      opt.textContent = unit;
      unitSelect.appendChild(opt);
    }
    unitSelect.value = unit || '';
  }

  previewWrap.style.display = 'inline-flex';
}

function bindEvents() {
  // Search and filters
  const searchInput = document.getElementById('activitySearchInput');
  const activitySelect = document.getElementById('filterActivitySelect');
  const statusSelect = document.getElementById('filterStatusSelect');
  const btnRefresh = document.getElementById('btnRefreshActivity');
  const btnFilterCorr = document.getElementById('btnFilterCorrections');

  if (searchInput) searchInput.addEventListener('input', applyFiltersAndRender);
  if (activitySelect) activitySelect.addEventListener('change', applyFiltersAndRender);
  if (statusSelect) statusSelect.addEventListener('change', applyFiltersAndRender);

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadAndRenderActivity();
    });
  }

  if (btnFilterCorr) {
    btnFilterCorr.addEventListener('click', () => {
      if (statusSelect) {
        statusSelect.value = 'Correction Needed';
        applyFiltersAndRender();
      }
    });
  }

  // View modal events (Modal 1: Message & Activity Viewer)
  const viewModal = document.getElementById('viewTxModal');
  const btnCloseView1 = document.getElementById('btnCloseViewTx');
  const btnCloseView2 = document.getElementById('btnCloseViewTx2');
  const btnGoToCorrect = document.getElementById('btnGoToCorrect');

  if (btnCloseView1) btnCloseView1.addEventListener('click', closeViewModal);
  if (btnCloseView2) btnCloseView2.addEventListener('click', closeViewModal);
  if (viewModal) {
    viewModal.addEventListener('click', (e) => {
      if (e.target === viewModal) closeViewModal();
    });
  }

  // When staff is viewing the message, clicking "Correct Record" at the bottom
  // automatically pops up the small box form right on screen!
  if (btnGoToCorrect) {
    btnGoToCorrect.addEventListener('click', () => {
      closeViewModal();
      if (activeTxForCorrection) {
        openCorrectionModal(activeTxForCorrection);
      }
    });
  }

  // Correction modal events (Modal 2: Small Box Popup Form)
  const corrModal = document.getElementById('staffCorrectionModal');
  const btnCloseCorr = document.getElementById('btnCloseCorrectionModal');
  const btnCancelCorr = document.getElementById('btnCancelCorrection');
  const btnSubmitCorr = document.getElementById('btnSubmitCorrection');
  const btnBackToView = document.getElementById('btnBackToViewModal');

  if (btnCloseCorr) btnCloseCorr.addEventListener('click', closeCorrectionModal);
  if (btnCancelCorr) btnCancelCorr.addEventListener('click', closeCorrectionModal);
  if (corrModal) {
    corrModal.addEventListener('click', (e) => {
      if (e.target === corrModal) closeCorrectionModal();
    });
  }

  // Staff can switch back to view the message anytime
  if (btnBackToView) {
    btnBackToView.addEventListener('click', () => {
      closeCorrectionModal();
      if (activeTxForCorrection) {
        openViewModal(activeTxForCorrection);
      }
    });
  }

  if (btnSubmitCorr) {
    btnSubmitCorr.addEventListener('click', handleResubmitCorrection);
  }

  // Delegated click handler on table body for View Message and Correct buttons
  const tbody = document.getElementById('myActivityTbody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('.btn-view-tx');
      if (viewBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = viewBtn.getAttribute('data-id');
        const tx = findTx(id);
        if (tx) openViewModal(tx);
        return;
      }

      const correctBtn = e.target.closest('.btn-correct-tx');
      if (correctBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = correctBtn.getAttribute('data-id');
        const tx = findTx(id);
        if (tx) openCorrectionModal(tx);
        return;
      }
    });
  }
}

function loadAndRenderActivity() {
  allTransactions = getStaffTransactions();
  if (allTransactions.length === 0) {
    try {
      if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
        window.broadcastRMIMSSync({ isStateRequest: true });
      }
    } catch (_) {}
  }
  updateStatCards();
  applyFiltersAndRender();
}

function updateStatCards() {
  const totalEl = document.getElementById('statTotalSub');
  const pendingEl = document.getElementById('statPendingSub');
  const approvedEl = document.getElementById('statApprovedSub');
  const corrEl = document.getElementById('statCorrectionSub');
  const banner = document.getElementById('correctionAlertBanner');
  const bannerTitle = document.getElementById('correctionBannerTitle');

  const total = allTransactions.length;
  const pending = allTransactions.filter(t => t.status === 'Pending').length;
  const approved = allTransactions.filter(t => t.status === 'Approved').length;
  const corrections = allTransactions.filter(t => t.status === 'Correction Needed').length;

  if (totalEl) totalEl.textContent = total;
  if (pendingEl) pendingEl.textContent = pending;
  if (approvedEl) approvedEl.textContent = approved;
  if (corrEl) corrEl.textContent = corrections;

  if (banner) {
    if (corrections > 0) {
      banner.style.display = 'flex';
      if (bannerTitle) {
        bannerTitle.textContent = `Action Required: You have ${corrections} transaction${corrections === 1 ? '' : 's'} returned for correction`;
      }
    } else {
      banner.style.display = 'none';
    }
  }
}

function applyFiltersAndRender() {
  const q = (document.getElementById('activitySearchInput')?.value || '').toLowerCase().trim();
  const act = document.getElementById('filterActivitySelect')?.value || 'ALL';
  const st = document.getElementById('filterStatusSelect')?.value || 'ALL';
  const tbody = document.getElementById('myActivityTbody');
  const countDisplay = document.getElementById('activityTableCountDisplay');

  if (!tbody) return;

  const filtered = allTransactions.filter(t => {
    // Search query
    if (q) {
      const matchRef = (t.ref || '').toLowerCase().includes(q);
      const matchMat = (t.material || '').toLowerCase().includes(q);
      const matchNotes = (t.notes || '').toLowerCase().includes(q);
      const matchSource = (t.supplier || t.usedFor || '').toLowerCase().includes(q);
      if (!matchRef && !matchMat && !matchNotes && !matchSource) return false;
    }

    // Activity filter
    if (act !== 'ALL') {
      const txAct = t.activity || t.type || '';
      if (txAct.toLowerCase() !== act.toLowerCase()) return false;
    }

    // Status filter
    if (st !== 'ALL') {
      if ((t.status || 'Pending') !== st) return false;
    }

    return true;
  });

  if (countDisplay) {
    countDisplay.textContent = `Showing ${filtered.length} of ${allTransactions.length} transaction${allTransactions.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:36px 16px; color:#64748B;">
          No transactions found matching the selected filters.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    const isReceive = (t.activity === 'Receive' || t.type === 'Receive');
    const actBadge = isReceive
      ? `<span class="badge" style="background:#DCFCE7; color:#15803D; font-weight:700; padding:3px 8px; border-radius:6px; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12l7 7 7-7"/></svg> Receive
         </span>`
      : `<span class="badge" style="background:#FEF3C7; color:#D97706; font-weight:700; padding:3px 8px; border-radius:6px; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14"/></svg> Disburse
         </span>`;

    const statusVal = t.status || 'Pending';
    let statusPill = '';
    if (statusVal === 'Approved') {
      statusPill = `<span class="badge" style="background:#DCFCE7; color:#15803D; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Approved</span>`;
    } else if (statusVal === 'Rejected') {
      statusPill = `<span class="badge" style="background:#FEE2E2; color:#DC2626; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Rejected</span>`;
    } else if (statusVal === 'Correction Needed') {
      statusPill = `<span class="badge" style="background:#FEF3C7; color:#D97706; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Correction Needed
      </span>`;
    } else {
      if (t.isUpdated) {
        statusPill = `<span class="badge" style="background:#E0F2FE; color:#0369A1; font-weight:700; padding:3px 8px; border-radius:6px; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;">
          Pending <span style="background:#0284C7; color:#FFF; font-size:9.5px; padding:1px 5px; border-radius:4px;">UPDATED</span>
        </span>`;
      } else {
        statusPill = `<span class="badge" style="background:#E0F2FE; color:#0369A1; font-weight:700; padding:3px 10px; border-radius:6px; font-size:11.5px;">Pending</span>`;
      }
    }

    const createdFormatted = t.createdAt
      ? new Date(t.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : (t.date || '--');

    const qtySign = isReceive ? '+' : '-';
    const qtyColor = isReceive ? '#15803D' : '#D97706';

    const rowId = escapeHtml(t.ref || t.id);

    let actionHtml = '';
    if (statusVal === 'Correction Needed') {
      // Both buttons open on-screen dialogs without navigating away
      actionHtml = `
        <div style="display:flex; justify-content:flex-end; gap:6px;">
          <button type="button" class="btn-view-tx" data-id="${rowId}" style="padding:4px 9px; font-size:11.5px; font-weight:600; border:1px solid #CBD5E1; background:#FFF; border-radius:6px; cursor:pointer; color:#334155; display:inline-flex; align-items:center; gap:4px;" title="View Manager Message and Activity">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> View Message
          </button>
          <button type="button" class="btn-correct-tx" data-id="${rowId}" style="padding:4px 10px; font-size:11.5px; font-weight:700; background:#D97706; color:#FFF; border:none; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; box-shadow:0 1px 3px rgba(217,119,6,0.25);" title="Open popup form to correct this transaction">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Correct
          </button>
        </div>
      `;
    } else if (statusVal === 'Pending') {
      // Allows staff to view details and edit record if needed before review
      actionHtml = `
        <div style="display:flex; justify-content:flex-end; gap:6px;">
          <button type="button" class="btn-view-tx" data-id="${rowId}" style="padding:4px 9px; font-size:11.5px; font-weight:600; color:#15803D; background:transparent; border:none; cursor:pointer;">
            View Details
          </button>
          <button type="button" class="btn-correct-tx" data-id="${rowId}" style="padding:4px 9px; font-size:11px; font-weight:700; background:#F0FDF4; color:#15803D; border:1px solid #BBF7D0; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:3px;" title="Update this pending submission">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit
          </button>
        </div>
      `;
    } else if (statusVal === 'Approved') {
      // Approved transactions: remove all actions, show blank/clean dash
      actionHtml = '<span style="color:#94A3B8; font-size:13px; font-weight:600;">—</span>';
    } else {
      actionHtml = `
        <button type="button" class="btn-view-tx" data-id="${rowId}" style="padding:4px 10px; font-size:11.5px; font-weight:600; color:#64748B; background:transparent; border:none; cursor:pointer;">
          View Details
        </button>
      `;
    }

    return `
      <tr style="${statusVal === 'Correction Needed' ? 'background:rgba(254, 243, 199, 0.25);' : ''}">
        <td style="color:#64748B; font-size:12px; white-space:nowrap;">${escapeHtml(createdFormatted)}</td>
        <td>${actBadge}</td>
        <td style="font-weight:700; font-family:'Sora',sans-serif; color:#0F2A1B; white-space:nowrap;">${escapeHtml(t.ref)}</td>
        <td style="font-weight:600; color:#0F2A1B;">${escapeHtml(t.material)}</td>
        <td style="font-weight:800; color:${qtyColor};">${qtySign}${escapeHtml(t.quantity)}${t.unit ? ' ' + escapeHtml(t.unit) : ''}</td>
        <td>${statusPill}</td>
        <td style="text-align:right; white-space:nowrap;">${actionHtml}</td>
      </tr>
    `;
  }).join('');

  // Explicit button listeners fallback:
  // 1) View Details / View Message button: Opens Activity & Message Viewer Modal
  tbody.querySelectorAll('.btn-view-tx').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const tx = findTx(id);
      if (tx) openViewModal(tx);
    });
  });

  // 2) Correct / Edit button: Opens the on-screen compact Correction Form Modal directly
  tbody.querySelectorAll('.btn-correct-tx').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const tx = findTx(id);
      if (tx) {
        openCorrectionModal(tx);
      }
    });
  });
}

/**
 * MODAL 1: Activity & Manager Message Viewer
 * Shows the manager's feedback message and all submitted activities so staff knows what is wrong.
 * At the bottom, staff can click "Correct Record" / "Update Record" to open the small box form.
 */
function openViewModal(tx) {
  activeTxForCorrection = tx;
  const isReceive = (tx.activity === 'Receive' || tx.type === 'Receive');

  const refEl = document.getElementById('viewTxRef');
  const actEl = document.getElementById('viewTxActivity');
  const matEl = document.getElementById('viewTxMaterial');
  const qtyEl = document.getElementById('viewTxQty');
  const srcLbl = document.getElementById('viewTxSourceLabel');
  const srcEl = document.getElementById('viewTxSource');
  const dateEl = document.getElementById('viewTxDate');
  const notesEl = document.getElementById('viewTxNotes');

  if (refEl) refEl.textContent = tx.ref;
  if (actEl) actEl.textContent = tx.activity || tx.type || (isReceive ? 'Receive' : 'Disburse');
  if (matEl) matEl.textContent = tx.material;
  if (qtyEl) {
    qtyEl.textContent = `${isReceive ? '+' : '-'}${tx.quantity}${tx.unit ? ' ' + tx.unit : ''}`;
    qtyEl.style.color = isReceive ? '#15803D' : '#D97706';
  }
  if (srcLbl) srcLbl.textContent = isReceive ? 'Supplier / Delivery Source' : 'Used For / Purpose';
  if (srcEl) srcEl.textContent = tx.supplier || tx.usedFor || '--';
  if (dateEl) {
    dateEl.textContent = `${tx.date || '--'} ${tx.createdAt ? '(' + new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : ''}`;
  }
  if (notesEl) notesEl.textContent = tx.notes || 'No extra notes provided.';

  const statusBadge = document.getElementById('viewTxStatusBadge');
  const statusBanner = document.getElementById('viewTxStatusBanner');
  const correctionBox = document.getElementById('viewTxCorrectionBox');
  const btnCorrect = document.getElementById('btnGoToCorrect');

  const st = tx.status || 'Pending';
  if (statusBadge) statusBadge.textContent = st;

  if (st === 'Correction Needed') {
    if (statusBadge) statusBadge.style.color = '#D97706';
    if (statusBanner) {
      statusBanner.style.background = '#FFFBEB';
      statusBanner.style.borderColor = '#FDE68A';
    }
    if (correctionBox) {
      correctionBox.style.display = 'block';
      correctionBox.style.background = '#FFFBEB';
      correctionBox.style.borderColor = '#FCD34D';
      const msgEl = document.getElementById('viewTxCorrectionMsg');
      if (msgEl) msgEl.textContent = `"${tx.correctionMessage || 'Please verify the transaction details.'}"`;
    }
    if (btnCorrect) {
      btnCorrect.style.display = 'inline-flex';
      btnCorrect.style.background = '#D97706';
      btnCorrect.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Correct Record
      `;
    }
  } else if (st === 'Pending') {
    if (statusBadge) statusBadge.style.color = '#0369A1';
    if (statusBanner) {
      statusBanner.style.background = '#E0F2FE';
      statusBanner.style.borderColor = '#BAE6FD';
    }

    if (tx.isUpdated && correctionBox) {
      correctionBox.style.display = 'block';
      correctionBox.style.background = '#F0F9FF';
      correctionBox.style.borderColor = '#BAE6FD';
      const msgEl = document.getElementById('viewTxCorrectionMsg');
      if (msgEl) {
        msgEl.textContent = tx.previousCorrectionMessage 
          ? `Previous Revision Note: "${tx.previousCorrectionMessage}"` 
          : 'This submission has been updated and is awaiting Manager review.';
      }
    } else if (correctionBox) {
      correctionBox.style.display = 'none';
    }

    // Allow staff to update pending submission if they need to edit before manager review
    if (btnCorrect) {
      btnCorrect.style.display = 'inline-flex';
      btnCorrect.style.background = '#15803D';
      btnCorrect.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Update Record
      `;
    }
  } else {
    if (correctionBox) correctionBox.style.display = 'none';
    if (btnCorrect) btnCorrect.style.display = 'none';

    if (statusBadge && statusBanner) {
      if (st === 'Approved') {
        statusBadge.style.color = '#15803D';
        statusBanner.style.background = '#DCFCE7';
        statusBanner.style.borderColor = '#BBF7D0';
      } else if (st === 'Rejected') {
        statusBadge.style.color = '#DC2626';
        statusBanner.style.background = '#FEE2E2';
        statusBanner.style.borderColor = '#FECACA';
      }
    }
  }

  const modal = document.getElementById('viewTxModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('open');
  }
}

/**
 * MODAL 2: Small Box Popup Correction Form
 * "automatically popup only in the screen just like the receive module form but this time is just small box but same form"
 * - Compact box
 * - Preserves reference number
 * - Same form fields as receive / disburse
 * - Resubmits on screen with zero redirect
 */
function openCorrectionModal(tx) {
  if (!tx) return;
  activeTxForCorrection = tx;
  const isReceive = (tx.activity === 'Receive' || tx.type === 'Receive');

  // Populate locked reference display box
  const refCodeEl = document.getElementById('corrModalRefCode');
  const legacyRefEl = document.getElementById('corrModalRef');
  if (refCodeEl) refCodeEl.textContent = tx.ref;
  if (legacyRefEl) legacyRefEl.textContent = tx.ref;

  const txIdEl = document.getElementById('corrTxId');
  if (txIdEl) txIdEl.value = tx.ref || tx.id;

  const headerTitle = document.getElementById('corrFormHeaderTitle');
  if (headerTitle) {
    headerTitle.textContent = isReceive ? 'Correct Receive Submission' : 'Correct Disburse Submission';
  }

  const managerMsgEl = document.getElementById('corrModalManagerMsg');
  if (managerMsgEl) {
    managerMsgEl.textContent = `"${tx.correctionMessage || tx.previousCorrectionMessage || 'Please review and verify the quantity or details entered.'}"`;
  }

  // Pre-populate fields
  const matSelect = document.getElementById('corrMaterialSelect');
  if (matSelect) {
    matSelect.value = tx.material || '';
    updateStockPreview(tx.material);
  }

  const qtyInput = document.getElementById('corrQuantityInput');
  if (qtyInput) qtyInput.value = tx.quantity || '';

  const unitSelect = document.getElementById('corrUnitSelect');
  if (unitSelect) unitSelect.value = tx.unit || '';

  const unitBadge = document.getElementById('corrUnitBadge');
  if (unitBadge) unitBadge.textContent = tx.unit || '--';

  const sourceLabel = document.getElementById('corrSourceLabel');
  const sourceInput = document.getElementById('corrSourceInput');
  if (isReceive) {
    if (sourceLabel) sourceLabel.innerHTML = 'Supplier / Delivery Source <span class="required">*</span>';
    if (sourceInput) {
      sourceInput.value = tx.supplier || '';
      sourceInput.placeholder = 'e.g. Agro-Industrial Supplies, Central Milling';
    }
  } else {
    if (sourceLabel) sourceLabel.innerHTML = 'Used For / Purpose <span class="required">*</span>';
    if (sourceInput) {
      sourceInput.value = tx.usedFor || '';
      sourceInput.placeholder = 'e.g. Pastillas Batch 12';
    }
  }

  const dateInput = document.getElementById('corrDateInput');
  if (dateInput) dateInput.value = tx.date || '';

  const notesInput = document.getElementById('corrNotesInput');
  if (notesInput) notesInput.value = tx.notes || '';

  const modal = document.getElementById('staffCorrectionModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('open');
  }
}

function handleResubmitCorrection() {
  if (!activeTxForCorrection) return;

  const targetRef = activeTxForCorrection.ref || document.getElementById('corrModalRefCode')?.textContent;
  const material = document.getElementById('corrMaterialSelect')?.value;
  const quantity = parseFloat(document.getElementById('corrQuantityInput')?.value || 0);
  const selectedOpt = document.getElementById('corrMaterialSelect')?.options[document.getElementById('corrMaterialSelect')?.selectedIndex];
  const unit = (selectedOpt && selectedOpt.dataset.unit) ? selectedOpt.dataset.unit : (document.getElementById('corrUnitSelect')?.value || activeTxForCorrection.unit || '');
  const sourceVal = document.getElementById('corrSourceInput')?.value?.trim();
  const date = document.getElementById('corrDateInput')?.value;
  const notes = document.getElementById('corrNotesInput')?.value?.trim();

  if (!material) {
    alert('Please choose a raw material.');
    return;
  }
  if (!quantity || quantity <= 0 || isNaN(quantity)) {
    alert('Please enter a valid positive quantity.');
    return;
  }
  if (!date) {
    alert('Please specify the transaction date.');
    return;
  }

  const isReceive = (activeTxForCorrection.activity === 'Receive' || activeTxForCorrection.type === 'Receive');
  const finalSource = sourceVal || (isReceive ? (activeTxForCorrection.supplier || 'Standard Delivery') : (activeTxForCorrection.usedFor || 'General Batch'));

  const updatedFields = {
    material,
    quantity,
    qty: `${quantity} ${unit}`,
    qtyNum: quantity,
    unit,
    date,
    notes,
    supplier: isReceive ? finalSource : (activeTxForCorrection.supplier || ''),
    usedFor: !isReceive ? finalSource : (activeTxForCorrection.usedFor || '')
  };

  // Section 18 & 19: Keep same reference, resubmit to Manager
  // Status becomes 'Pending' (NOT 'UPDATED'), isUpdated set to true
  const res = resubmitStaffCorrection(targetRef, updatedFields);

  if (!res || !res.success) {
    alert(`Could not resubmit: ${res?.message || 'Error occurred'}`);
    return;
  }

  // Close modal
  closeCorrectionModal();

  // Reload data in-place
  loadAndRenderActivity();

  // In-place confirmation alert (No redirect to receive.html!)
  alert(`Transaction Updated Successfully!\n\nReference: ${targetRef}\nStatus: Pending\n\nYour record was returned to the Manager for verification.`);
}

if (typeof window !== 'undefined') {
  window.openViewModal = openViewModal;
  window.openCorrectionModal = openCorrectionModal;
  window.closeViewModal = closeViewModal;
  window.closeCorrectionModal = closeCorrectionModal;
}
