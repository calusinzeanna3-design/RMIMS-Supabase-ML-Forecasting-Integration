/**
 * RMIMS Transaction & Reference Engine
 * Implements global rules for Staff & Manager:
 * - System-generated unique reference numbers (REC-YYYY-XXXXX, DIS-YYYY-XXXXX)
 * - Reference Number is the ONLY basis for duplicate detection
 * - Duplicate checks operate across Staff ↔ Staff, Staff ↔ Manager, Manager ↔ Manager
 * - A reference that has been submitted or used cannot be reused
 * - Duplicate warning modal with Cancel / Refresh Form
 * - Refreshing creates a new reference and resets the form
 * - Correction maintains the original reference number
 * - Resubmitted transactions display 🔵 UPDATED inside Manager Review popup
 */

import { adjustSystemMaterialStock, getSystemRawMaterials } from './system-materials.js';
import { getCompanyAcronym, getRoleReferencePrefix } from './tenant-manager.js';
import { supabase } from '../supabase/supabase-config.js';

function persistStaffTxToSupabase(tx) {
  if (!tx || !tx.ref || !supabase) return;
  try {
    supabase.from('activity_audit_logs').insert([{
      action_type: 'STAFF_TX_STATE',
      entity_type: 'staff_transactions',
      entity_id: tx.ref,
      details: tx
    }]).then(() => {}).catch(() => {});
  } catch (_) {}
}

export const STAFF_TX_KEY = 'rmims_staff_transactions';
export const MGR_RECEIPTS_KEY = 'rmims_manager_receipts';
export const MGR_DISBURSEMENTS_KEY = 'rmims_manager_disbursements';
export const BURNED_REFS_KEY = 'rmims_burned_references';

export const AUTHENTIC_INITIAL_STAFF_TRANSACTIONS = [];
export const AUTHENTIC_INITIAL_MGR_RECEIPTS = [];
export const AUTHENTIC_INITIAL_MGR_DISBURSEMENTS = [];
export const AUTHENTIC_INITIAL_BURNED_REFS = [];

export function getBurnedReferences() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BURNED_REFS_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    return list;
  } catch (e) {
    return [];
  }
}

export function burnReference(ref) {
  if (!ref || typeof localStorage === 'undefined') return;
  const list = getBurnedReferences();
  if (!list.includes(ref)) {
    list.push(ref);
    try {
      localStorage.setItem(BURNED_REFS_KEY, JSON.stringify(list));
    } catch (e) {}
  }
}

/**
 * Returns all transaction records across Staff and Manager
 */
export function getAllCompanyTransactions() {
  const transactions = [];
  if (typeof localStorage === 'undefined') return transactions;

  // 1. Staff Transactions (Receive & Disburse, all statuses)
  try {
    const rawStaff = localStorage.getItem(STAFF_TX_KEY);
    if (rawStaff) {
      const parsed = JSON.parse(rawStaff);
      if (Array.isArray(parsed)) {
        parsed.forEach(t => {
          if (t && t.ref) {
            transactions.push({
              source: 'staff',
              id: t.id || t.ref,
              ref: t.ref,
              date: t.date || '',
              time: t.time || '',
              staff: t.staff || 'Staff Member',
              activity: t.activity || ((t.ref.startsWith('REC') || /-R\d+/i.test(t.ref)) ? 'Receive' : 'Disburse'),
              material: t.material || t.rawMaterial || '',
              qty: t.qty || (t.quantity ? `${t.quantity} ${t.unit || ''}` : ''),
              qtyNum: parseFloat(t.quantity || t.qtyNum || 0),
              unit: t.unit || '',
              status: t.status || 'Pending',
              notes: t.notes || '',
              usedFor: t.usedFor || '',
              supplier: t.supplier || '',
              isUpdated: !!t.isUpdated,
              previousCorrectionMessage: t.previousCorrectionMessage || '',
              previousValues: t.previousValues || null,
              createdAt: t.createdAt || ''
            });
          }
        });
      }
    }
  } catch (e) {
    console.warn('Error reading staff transactions:', e);
  }

  // 2. Manager Receipts
  try {
    const rawMgrRec = localStorage.getItem(MGR_RECEIPTS_KEY);
    let mgrRecList = rawMgrRec ? JSON.parse(rawMgrRec) : [];
    if (!Array.isArray(mgrRecList)) mgrRecList = [];
    mgrRecList.forEach(r => {
      if (r && r.ref) {
        transactions.push({
          source: 'manager',
          id: r.id || r.ref,
          ref: r.ref,
          date: r.date || '',
          time: r.time || '',
          staff: r.recordedBy || 'Manager',
          activity: 'Receive',
          material: r.material || '',
          qty: `${r.quantity || 0}${r.unit ? ' ' + r.unit : ''}`,
          qtyNum: parseFloat(r.quantity || 0),
          unit: r.unit || '',
          status: 'Approved',
          notes: r.notes || '',
          supplier: r.supplier || '',
          createdAt: r.createdAt || ''
        });
      }
    });
  } catch (e) {
    console.warn('Error reading manager receipts:', e);
  }

  // 3. Manager Disbursements
  try {
    const rawMgrDisb = localStorage.getItem(MGR_DISBURSEMENTS_KEY);
    let mgrDisbList = rawMgrDisb ? JSON.parse(rawMgrDisb) : [];
    if (!Array.isArray(mgrDisbList)) mgrDisbList = [];
    mgrDisbList.forEach(d => {
      if (d && d.ref) {
        transactions.push({
          source: 'manager',
          id: d.id || d.ref,
          ref: d.ref,
          date: d.date || '',
          time: d.time || '',
          staff: d.recordedBy || 'Manager',
          activity: 'Disburse',
          material: d.material || '',
          qty: `${d.quantity || 0}${d.unit ? ' ' + d.unit : ''}`,
          qtyNum: parseFloat(d.quantity || 0),
          unit: d.unit || '',
          status: 'Approved',
          notes: d.notes || '',
          usedFor: d.usedFor || '',
          createdAt: d.createdAt || ''
        });
      }
    });
  } catch (e) {
    console.warn('Error reading manager disbursements:', e);
  }

  // 4. Custom receipts/disbursements from system-materials (if present)
  try {
    const rawCustomRec = localStorage.getItem('rmims_custom_receipts');
    if (rawCustomRec) {
      const parsed = JSON.parse(rawCustomRec);
      if (Array.isArray(parsed)) {
        parsed.forEach(r => {
          if (r && (r.id || r.referenceNo)) {
            const ref = r.referenceNo || r.id;
            if (ref && !transactions.some(t => t.ref.toUpperCase() === ref.toUpperCase())) {
              transactions.push({
                source: 'system',
                id: ref,
                ref: ref,
                date: r.date || '',
                time: r.time || '',
                staff: r.receivedBy || 'Staff Member',
                activity: 'Receive',
                material: r.materialName || '',
                qty: `${r.quantity || 0}${r.unit ? ' ' + r.unit : ''}`,
                qtyNum: parseFloat(r.quantity || 0),
                unit: r.unit || '',
                status: 'Approved',
                notes: r.notes || '',
                supplier: r.supplierName || ''
              });
            }
          }
        });
      }
    }
  } catch (e) {}

  return transactions;
}

/**
 * Generate next unique reference number across all company records.
 * Non-editable, non-reusable.
 * Follows RBAC company & role format:
 * - Manager: e.g. "2026SMM-0001"
 * - Staff:   e.g. "2026SMSt-0001"
 * @param {'REC' | 'DIS'} type
 * @param {'manager' | 'staff' | null} role
 * @param {object | null} context
 * @returns {string} e.g. "2026SMM-0001" or "2026SMSt-0001"
 */
export function generateNextReference(type = 'REC', role = null, context = null) {
  const currentYear = new Date().getFullYear();

  // 1. Resolve role (Manager vs Staff)
  let resolvedRole = role;
  if (!resolvedRole) {
    if (typeof window !== 'undefined') {
      const p = (window.location.pathname || '').toLowerCase();
      if (p.includes('/manager/')) resolvedRole = 'manager';
      else if (p.includes('/user/')) resolvedRole = 'staff';
    }
  }
  if (!resolvedRole) {
    try {
      const uRaw = localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || localStorage.getItem('userProfile');
      if (uRaw) {
        const u = JSON.parse(uRaw);
        const r = String(u.operational_role || u.operationalRole || u.role || '').toLowerCase();
        resolvedRole = (r === 'staff' || r === 'user') ? 'staff' : 'manager';
      }
    } catch (_) {}
  }
  if (!resolvedRole) {
    resolvedRole = 'manager';
  }

  const cleanRole = String(resolvedRole).toLowerCase();
  const roleTag = (cleanRole === 'staff' || cleanRole === 'user') ? 'St' : 'M';
  const acronym = getCompanyAcronym(context);
  const cleanType = String(type || 'REC').toUpperCase();
  const typeLetter = (cleanType === 'DIS' || cleanType === 'DISBURSE') ? 'D' : 'R';

  // Standard format required by specification:
  // e.g. SMM-R#### in manager, SMSt-D#### as staff (incorporating current year 2026):
  // Manager Receive:  "2026SMM-R0001"
  // Manager Disburse: "2026SMM-D0001"
  // Staff Receive:    "2026SMSt-R0001"
  // Staff Disburse:   "2026SMSt-D0001"
  const prefix = `${currentYear}${acronym}${roleTag}-${typeLetter}`;

  const allTx = getAllCompanyTransactions();
  const burned = getBurnedReferences();

  let maxNum = 0;

  // Regex to match exact new pattern e.g. 2026SMM-R0001 or SMM-R0001
  const exactRegex = new RegExp(`^(?:${currentYear})?${acronym}${roleTag}-${typeLetter}(\\d+)`, 'i');
  // Match any reference with the same role and type letter
  const typeRegex = new RegExp(`${roleTag}-${typeLetter}(\\d+)`, 'i');
  // Fallback regex for prior references with the same role tag
  const roleRegex = new RegExp(`^${currentYear}.*?${roleTag}-(\\d+)`, 'i');

  allTx.forEach(t => {
    if (t.ref) {
      let match = t.ref.match(exactRegex) || t.ref.match(typeRegex) || t.ref.match(roleRegex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  });

  burned.forEach(ref => {
    if (ref) {
      let match = ref.match(exactRegex) || ref.match(typeRegex) || ref.match(roleRegex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  });

  // Continuous sequence starting at 0001, padded to 4 digits
  const nextNum = maxNum + 1;
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

/**
 * Resets all transaction ledger references and burned list so references restart brand new from 00001.
 */
export function resetAllReferencesToBrandNew() {
  try {
    localStorage.removeItem(BURNED_REFS_KEY);
    localStorage.removeItem(STAFF_TX_KEY);
    localStorage.removeItem(MGR_RECEIPTS_KEY);
    localStorage.removeItem(MGR_DISBURSEMENTS_KEY);
    localStorage.setItem('rmims_brand_new_refs_reset_v3', 'true');
    window.dispatchEvent(new Event('storage'));
    return { success: true, message: 'All references reset to 00001 (Brand New).' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

if (typeof window !== 'undefined') {
  window.resetRMIMSReferences = resetAllReferencesToBrandNew;
}

/**
 * Checks if a reference number already exists in company transactions.
 * Reference Number is the ONLY basis for duplicate detection.
 * Works across Staff ↔ Staff, Staff ↔ Manager, Manager ↔ Manager.
 *
 * @param {string} refNumber
 * @param {string} [excludeId] - optional ID to ignore (e.g. when editing the SAME returned transaction)
 * @returns {{ isDuplicate: boolean, existingTransaction: object | null }}
 */
export function checkReferenceDuplicate(refNumber, excludeId = null) {
  if (!refNumber) return { isDuplicate: false, existingTransaction: null };

  const cleanRef = String(refNumber).trim().toUpperCase();
  const allTx = getAllCompanyTransactions();

  const found = allTx.find(t => {
    if (excludeId && (t.id === excludeId || t.ref === excludeId)) {
      return false; // same transaction being corrected
    }
    return t.ref && t.ref.trim().toUpperCase() === cleanRef;
  });

  if (found) {
    return {
      isDuplicate: true,
      existingTransaction: found
    };
  }

  // Also check burned references list
  const burned = getBurnedReferences();
  if (burned.some(r => r && r.trim().toUpperCase() === cleanRef)) {
    return {
      isDuplicate: true,
      existingTransaction: {
        ref: cleanRef,
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        time: 'Previously Used / Cancelled'
      }
    };
  }

  return { isDuplicate: false, existingTransaction: null };
}

/**
 * Renders and shows the exact Duplicate Warning Modal required by the specification:
 *
 * ⚠️ REFERENCE NUMBER ALREADY EXISTS
 * Reference: REC-2026-00125
 * Existing Transaction:
 * Date: October 1, 2026
 * Time: 10:25 AM
 * This reference number has already been used.
 * Please refresh the form or cancel this transaction.
 * [ Cancel ]     [ Refresh Form ]
 */
export function showDuplicateWarningModal({ refNumber, existingTransaction, onCancel, onRefresh }) {
  let modal = document.getElementById('rmimsDuplicateWarningModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'rmimsDuplicateWarningModal';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.68);
      backdrop-filter: blur(4px);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-sizing: border-box;
      font-family: 'Inter', -apple-system, sans-serif;
    `;
    document.body.appendChild(modal);
  }

  const txDate = existingTransaction?.date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const txTime = existingTransaction?.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  modal.innerHTML = `
    <div style="background:#FFFFFF; border-radius:18px; border:1px solid #FECACA; box-shadow:0 24px 50px -10px rgba(220,38,38,0.25); width:100%; max-width:440px; overflow:hidden; animation:rmimsPopIn 0.22s cubic-bezier(0.16,1,0.3,1);">
      <div style="padding:22px 24px 18px; background:#FEF2F2; border-bottom:1px solid #FEE2E2; display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px; height:40px; border-radius:12px; background:#FEE2E2; color:#DC2626; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:22px;">
          ⚠️
        </div>
        <div>
          <h3 style="margin:0; font-family:'Sora',sans-serif; font-size:16px; font-weight:800; color:#991B1B; text-transform:uppercase; letter-spacing:0.02em;">Reference Number Already Exists</h3>
          <p style="margin:4px 0 0; font-size:12.5px; color:#B91C1C;">Duplicate reference detected during review verification.</p>
        </div>
      </div>

      <div style="padding:20px 24px; display:flex; flex-direction:column; gap:14px;">
        <div style="background:#F8FAFC; border:1.5px solid #E2E8F0; border-radius:12px; padding:14px 16px;">
          <div style="font-size:11.5px; font-weight:700; color:#64748B; text-transform:uppercase; letter-spacing:0.04em;">Reference:</div>
          <div style="font-family:'Sora',sans-serif; font-size:18px; font-weight:800; color:#0F172A; margin:3px 0 10px;">${refNumber}</div>

          <div style="font-size:11.5px; font-weight:700; color:#64748B; text-transform:uppercase; letter-spacing:0.04em;">Existing Transaction:</div>
          <div style="font-size:13px; color:#334155; margin-top:2px;">
            <div><strong>Date:</strong> ${txDate}</div>
            <div><strong>Time:</strong> ${txTime}</div>
          </div>
        </div>

        <p style="margin:0; font-size:13px; line-height:1.45; color:#475569;">
          <strong>This reference number has already been used.</strong><br>
          Please refresh the form to generate a new reference number or cancel this transaction.
        </p>
      </div>

      <div style="padding:14px 24px 18px; background:#F8FAFC; border-top:1px solid #E2E8F0; display:flex; justify-content:flex-end; gap:10px;">
        <button type="button" id="btnDupCancel" style="padding:9px 18px; border-radius:9px; border:1px solid #CBD5E1; background:#FFFFFF; color:#475569; font-size:13px; font-weight:600; cursor:pointer;">
          Cancel
        </button>
        <button type="button" id="btnDupRefresh" style="padding:9px 20px; border-radius:9px; border:none; background:#DC2626; color:#FFFFFF; font-size:13px; font-weight:700; cursor:pointer; box-shadow:0 2px 8px rgba(220,38,38,0.25);">
          Refresh Form
        </button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  const btnCancel = modal.querySelector('#btnDupCancel');
  const btnRefresh = modal.querySelector('#btnDupRefresh');

  btnCancel.onclick = () => {
    modal.style.display = 'none';
    if (typeof onCancel === 'function') onCancel();
  };

  btnRefresh.onclick = () => {
    burnReference(refNumber);
    modal.style.display = 'none';
    if (typeof onRefresh === 'function') onRefresh();
  };
}

/**
 * Save a new Staff transaction (starts as Pending)
 */
export function submitStaffTransaction(data) {
  const allStaff = getStaffTransactions();
  let resolvedMatId = data.materialId || data.item_code || '';
  let resolvedMatName = data.material || data.materialName || '';
  try {
    const mats = getSystemRawMaterials() || [];
    const q = String(resolvedMatName || resolvedMatId).trim().toLowerCase();
    const found = mats.find(m =>
      (m.name || m.raw_material_name || '').trim().toLowerCase() === q ||
      String(m.id || '').toLowerCase() === q ||
      String(m.item_code || '').toLowerCase() === q
    );
    if (found) {
      resolvedMatId = found.id || found.item_code || resolvedMatId;
      resolvedMatName = found.name || found.raw_material_name || resolvedMatName;
    }
  } catch (_) {}

  const tx = {
    id: `st-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    ref: data.ref,
    date: data.date,
    time: data.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    staff: data.staff || '',
    staffEmail: data.staffEmail || '',
    activity: data.activity, // 'Receive' or 'Disburse'
    materialId: resolvedMatId,
    material: resolvedMatName,
    materialName: resolvedMatName,
    quantity: parseFloat(data.quantity || 0),
    qty: `${data.quantity}${data.unit ? ' ' + data.unit : ''}`,
    unit: data.unit || '',
    usedFor: data.usedFor || '',
    supplier: data.supplier || '',
    notes: data.notes || '',
    status: 'Pending',
    createdAt: new Date().toISOString(),
    isUpdated: false
  };

  allStaff.unshift(tx);
  try {
    localStorage.setItem(STAFF_TX_KEY, JSON.stringify(allStaff));
    localStorage.setItem('rmims_staff_activity_updated', String(Date.now()));
  } catch (e) {}
  persistStaffTxToSupabase(tx);

  // Broadcast live notification across all portals (Admin, Manager, Staff)
  let staffTxNotif = null;
  try {
    const act = tx.activity || ((tx.ref.startsWith('REC') || /-R\d+/i.test(tx.ref)) ? 'Receive' : 'Disburse');
    staffTxNotif = {
      title: `New Staff ${act}: ${tx.ref}`,
      message: `${tx.staff || 'Staff member'} submitted a ${act.toLowerCase()} record for ${tx.qty || (tx.quantity + ' ' + (tx.unit || ''))} of ${tx.material} (${tx.ref}).`,
      category: 'Inventory',
      badge: 'Pending Review',
      role: 'manager',
      targetRole: 'manager',
      roleScope: 'manager',
      priority: 'normal',
      targetUrl: 'manager/staff-activity.html',
      ref: tx.ref,
      material: tx.material,
      quantity: tx.qty || `${tx.quantity} ${tx.unit || ''}`,
      actor: tx.staff || 'Staff Member',
      timestamp: new Date().toISOString()
    };
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(staffTxNotif);
    }
  } catch (e) {}

  // Trigger cross-tab storage and real-time custom events
  window.dispatchEvent(new Event('storage'));
  window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail: tx }));
  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync({
        transaction: tx,
        allTransactions: allStaff,
        notification: staffTxNotif
      });
    }
  } catch (e) {}
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('rmims_user_sync');
      channel.postMessage({ type: 'STAFF_TX_SUBMITTED', transaction: tx, timestamp: Date.now() });
      channel.close();
    }
  } catch (_) {}
  return tx;
}

/**
 * Resubmit a returned transaction after Staff correction
 * Keeps the EXACT SAME reference number.
 * Status becomes Pending.
 * Sets isUpdated = true and logs previous correction info.
 */
export function resubmitStaffCorrection(refOrId, updatedFields, previousTx) {
  const allStaff = getStaffTransactions();
  const searchKey = String(refOrId || '').trim().toLowerCase();
  const idx = allStaff.findIndex(t => 
    (t.ref && t.ref.toLowerCase() === searchKey) || 
    (t.id && String(t.id).toLowerCase() === searchKey)
  );
  if (idx === -1) {
    return { success: false, message: 'Transaction record not found.' };
  }

  const current = allStaff[idx];
  const targetRef = current.ref || refOrId;

  // Capture diff for review popup
  const previousValues = {
    material: current.material,
    quantity: current.quantity,
    qty: current.qty || `${current.quantity}${current.unit ? ' ' + current.unit : ''}`,
    unit: current.unit,
    date: current.date,
    notes: current.notes,
    usedFor: current.usedFor,
    supplier: current.supplier
  };

  const newQty = parseFloat(updatedFields.quantity != null ? updatedFields.quantity : current.quantity);
  const newUnit = updatedFields.unit || current.unit || '';

  const updatedTx = {
    ...current,
    ...updatedFields,
    quantity: newQty,
    qty: `${newQty}${newUnit ? ' ' + newUnit : ''}`,
    qtyNum: newQty,
    unit: newUnit,
    ref: targetRef, // STRICT RULE: KEEP SAME REFERENCE NUMBER
    status: 'Pending', // STRICT RULE: STATUS IS PENDING
    isUpdated: true, // TRIGGERS 🔵 UPDATED IN REVIEW POPUP
    previousCorrectionMessage: current.rejectionReason || current.correctionMessage || 'Please verify details.',
    previousValues: previousValues,
    updatedAt: new Date().toISOString(),
    success: true
  };

  allStaff[idx] = updatedTx;

  try {
    localStorage.setItem(STAFF_TX_KEY, JSON.stringify(allStaff));
    localStorage.setItem('rmims_staff_activity_updated', String(Date.now()));
  } catch (e) {}
  persistStaffTxToSupabase(updatedTx);

  // Broadcast live notification across all portals (Admin, Manager, Staff)
  let mgrResubmitNotif = null;
  try {
    mgrResubmitNotif = {
      title: `Transaction Resubmitted: ${targetRef}`,
      message: `Staff corrected and resubmitted ${targetRef} (${updatedTx.qty} of ${updatedTx.material}). Pending review.`,
      category: 'Inventory',
      badge: 'Updated',
      role: 'manager',
      targetRole: 'manager',
      roleScope: 'manager',
      priority: 'normal',
      targetUrl: 'manager/staff-activity.html',
      ref: targetRef,
      material: updatedTx.material,
      quantity: updatedTx.qty,
      actor: updatedTx.staff || 'Staff Member',
      timestamp: new Date().toISOString()
    };
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      // 1. Notify Manager of resubmission
      window.pushRMIMSNotification(mgrResubmitNotif);

      // 2. Notify Staff member that their resubmission is now pending manager review
      window.pushRMIMSNotification({
        title: `Resubmitted to Manager: ${targetRef}`,
        message: `You revised and resubmitted ${targetRef} (${updatedTx.qty} of ${updatedTx.material}) to Store Manager for approval.`,
        category: 'Inventory',
        badge: 'Pending',
        role: 'staff',
        targetRole: 'staff',
        roleScope: 'staff',
        priority: 'normal',
        targetUrl: `user/my-activity.html?view=${encodeURIComponent(targetRef)}`,
        ref: targetRef,
        material: updatedTx.material,
        quantity: updatedTx.qty,
        actor: updatedTx.staff || 'Staff Member',
        timestamp: new Date().toISOString()
      });
    }
  } catch (e) {}

  window.dispatchEvent(new Event('storage'));
  window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail: updatedTx }));
  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync({
        transaction: updatedTx,
        allTransactions: allStaff,
        notification: mgrResubmitNotif
      });
    }
  } catch (e) {}
  return updatedTx;
}

export function getStaffTransactions() {
  try {
    const raw = localStorage.getItem(STAFF_TX_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    const BANNED_STAFF = ['user account', 'staff member', 'user', 'account', 'staff user', 'store manager', 'manager', 'admin', '—', '-'];
    let modified = false;
    list.forEach(t => {
      if (!t) return;
      const lowerStaff = String(t.staff || '').toLowerCase().trim();
      if (!t.staff || BANNED_STAFF.includes(lowerStaff)) {
        let resolved = 'Staff_1';
        if (t.staffEmail === 'scone2@gmail.com') resolved = 'Staff_2';
        else if (t.staffEmail === 'zeannapatty@gmail.com') resolved = 'Aizel';
        else if (t.staffEmail === 'zeannapatricia@gmail.com') resolved = 'Glazel';
        t.staff = resolved;
        modified = true;
      }
      if (t.approvedBy && BANNED_STAFF.includes(String(t.approvedBy).toLowerCase().trim())) {
        t.approvedBy = 'Aizel';
        modified = true;
      }
    });
    if (modified) {
      try {
        localStorage.setItem(STAFF_TX_KEY, JSON.stringify(list));
      } catch (_) {}
    }
    return list.filter(t => !['tx-staff-001', 'tx-staff-002', 'tx-staff-003', 'tx-staff-004', 'tx-staff-005', 'st-001', 'st-002', 'st-003', 'st-004', 'st-005'].includes(t.id));
  } catch (e) {
    return [];
  }
}

/**
 * Updates a Staff transaction record and synchronizes stock if it was already Approved.
 * If transaction was returned for 'Correction Needed', it resets to 'Pending', marks 'isUpdated: true',
 * records previous values, and alerts both Manager and Staff.
 */
export function updateStaffTransaction(refOrId, updatedFields) {
  const allStaff = getStaffTransactions();
  const searchKey = String(refOrId || '').trim().toLowerCase();
  const idx = allStaff.findIndex(t => 
    (t.ref && t.ref.toLowerCase() === searchKey) || 
    (t.id && String(t.id).toLowerCase() === searchKey)
  );
  if (idx === -1) return { success: false, message: 'Transaction not found.' };

  const current = allStaff[idx];
  const oldQty = parseFloat(current.quantity || current.qtyNum || 0);
  const newQty = updatedFields.quantity != null ? parseFloat(updatedFields.quantity) : oldQty;
  const newUnit = updatedFields.unit || current.unit || '';
  const isApproved = (current.status || '').toLowerCase() === 'approved';
  const isCorrection = (current.status || '') === 'Correction Needed';
  const targetRef = current.ref || refOrId;

  // If approved, adjust inventory delta
  if (isApproved && newQty !== oldQty) {
    const isReceive = (current.activity || current.type || '').toLowerCase() === 'receive';
    const delta = isReceive ? (newQty - oldQty) : (oldQty - newQty);
    adjustSystemMaterialStock(current.material, delta);
  }

  const previousValues = {
    material: current.material,
    quantity: current.quantity,
    qty: current.qty || `${current.quantity}${current.unit ? ' ' + current.unit : ''}`,
    unit: current.unit,
    date: current.date,
    notes: current.notes,
    usedFor: current.usedFor,
    supplier: current.supplier
  };

  const updatedTx = {
    ...current,
    ...updatedFields,
    quantity: newQty,
    qty: `${newQty}${newUnit ? ' ' + newUnit : ''}`,
    qtyNum: newQty,
    unit: newUnit,
    status: isCorrection ? 'Pending' : (updatedFields.status || current.status || 'Pending'),
    isUpdated: isCorrection ? true : (current.isUpdated || false),
    previousCorrectionMessage: isCorrection ? (current.correctionMessage || current.rejectionReason || 'Please verify details.') : (current.previousCorrectionMessage || null),
    previousValues: isCorrection ? previousValues : (current.previousValues || null),
    updatedAt: new Date().toISOString(),
    success: true
  };

  allStaff[idx] = updatedTx;
  try {
    localStorage.setItem(STAFF_TX_KEY, JSON.stringify(allStaff));
    localStorage.setItem('rmims_staff_activity_updated', String(Date.now()));
  } catch (e) {}
  persistStaffTxToSupabase(updatedTx);

  // Broadcast live notifications to Manager and Staff
  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      const actTitle = isCorrection ? `Transaction Resubmitted: ${targetRef}` : `Submission Updated: ${targetRef}`;
      const mgrMsg = isCorrection
        ? `Staff corrected and resubmitted ${targetRef} (${updatedTx.qty} of ${updatedTx.material}). Pending review.`
        : `Staff updated submission ${targetRef} (${updatedTx.qty} of ${updatedTx.material}). Pending review.`;

      // 1. Notify Manager
      window.pushRMIMSNotification({
        title: actTitle,
        message: mgrMsg,
        category: 'Inventory',
        badge: isCorrection ? 'Updated' : 'Pending Review',
        role: 'manager',
        targetRole: 'manager',
        roleScope: 'manager',
        priority: 'normal',
        targetUrl: 'manager/staff-activity.html',
        ref: targetRef,
        material: updatedTx.material,
        quantity: updatedTx.qty,
        actor: updatedTx.staff || 'Staff Member'
      });

      // 2. Notify Staff member
      window.pushRMIMSNotification({
        title: isCorrection ? `Resubmitted to Manager: ${targetRef}` : `Update Sent to Manager: ${targetRef}`,
        message: isCorrection
          ? `You revised and resubmitted ${targetRef} (${updatedTx.qty} of ${updatedTx.material}) to Store Manager for approval.`
          : `Updated details for ${targetRef} (${updatedTx.qty} of ${updatedTx.material}) sent to Store Manager for review.`,
        category: 'Inventory',
        badge: 'Pending',
        role: 'staff',
        targetRole: 'staff',
        roleScope: 'staff',
        priority: 'normal',
        targetUrl: `user/my-activity.html?view=${encodeURIComponent(targetRef)}`,
        ref: targetRef,
        material: updatedTx.material,
        quantity: updatedTx.qty,
        actor: updatedTx.staff || 'Staff Member'
      });
    }
  } catch (e) {}

  window.dispatchEvent(new Event('storage'));
  window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail: updatedTx }));
  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync({
        transaction: updatedTx,
        allTransactions: allStaff
      });
    }
  } catch (e) {}
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('rmims_user_sync');
      channel.postMessage({ type: 'STAFF_TX_UPDATED', transaction: updatedTx, timestamp: Date.now() });
      channel.close();
    }
  } catch (_) {}
  return { success: true, transaction: updatedTx };
}

/**
 * Deletes a Staff transaction record and reverts stock if it was Approved.
 */
export function deleteStaffTransaction(refOrId) {
  const allStaff = getStaffTransactions();
  const searchKey = String(refOrId || '').trim().toLowerCase();
  const idx = allStaff.findIndex(t => 
    (t.ref && t.ref.toLowerCase() === searchKey) || 
    (t.id && String(t.id).toLowerCase() === searchKey)
  );
  if (idx === -1) return { success: false, message: 'Transaction not found.' };

  const current = allStaff[idx];
  const isApproved = (current.status || '').toLowerCase() === 'approved';
  const qty = parseFloat(current.quantity || current.qtyNum || 0);

  // If approved, revert stock adjustment
  if (isApproved && qty > 0) {
    const isReceive = (current.activity || current.type || '').toLowerCase() === 'receive';
    const delta = isReceive ? -qty : qty;
    adjustSystemMaterialStock(current.material, delta);
  }

  const removed = allStaff.splice(idx, 1)[0];
  try {
    localStorage.setItem(STAFF_TX_KEY, JSON.stringify(allStaff));
    localStorage.setItem('rmims_staff_activity_updated', String(Date.now()));
  } catch (e) {}

  window.dispatchEvent(new Event('storage'));
  window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail: removed }));
  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync({
        deletedRef: current.ref || refOrId,
        allTransactions: allStaff
      });
    }
  } catch (e) {}
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('rmims_user_sync');
      channel.postMessage({ type: 'STAFF_TX_DELETED', ref: current.ref || refOrId, timestamp: Date.now() });
      channel.close();
    }
  } catch (_) {}
  return { success: true, transaction: removed };
}

/**
 * Updates a Manager Receipt and adjusts raw material inventory delta.
 */
export function updateManagerReceipt(refOrId, updatedFields) {
  let receipts = [];
  try {
    receipts = JSON.parse(localStorage.getItem(MGR_RECEIPTS_KEY) || '[]');
  } catch (e) { receipts = []; }

  const searchKey = String(refOrId || '').trim().toLowerCase();
  const idx = receipts.findIndex(r => 
    (r.ref && r.ref.toLowerCase() === searchKey) || 
    (r.id && String(r.id).toLowerCase() === searchKey)
  );
  if (idx === -1) return { success: false, message: 'Receipt not found.' };

  const current = receipts[idx];
  const oldQty = parseFloat(current.quantity || 0);
  const newQty = updatedFields.quantity != null ? parseFloat(updatedFields.quantity) : oldQty;
  const unit = updatedFields.unit || current.unit || '';

  // Stock adjustment for receive: (newQty - oldQty)
  const delta = newQty - oldQty;
  if (delta !== 0) {
    adjustSystemMaterialStock(current.materialId || current.materialName || current.material, delta);
  }

  const updatedRec = {
    ...current,
    ...updatedFields,
    quantity: newQty,
    unit: unit,
    updatedAt: new Date().toISOString()
  };
  receipts[idx] = updatedRec;

  try {
    localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(receipts));
  } catch (e) {}

  // Also update rmims_custom_receipts if matching ID
  try {
    const customKey = 'rmims_custom_receipts';
    let custom = JSON.parse(localStorage.getItem(customKey) || '[]');
    const cIdx = custom.findIndex(c => String(c.id).toLowerCase() === searchKey || (c.ref && c.ref.toLowerCase() === searchKey));
    if (cIdx !== -1) {
      custom[cIdx] = {
        ...custom[cIdx],
        ...updatedFields,
        received_quantity: newQty,
        quantity: newQty,
        unit: unit
      };
      localStorage.setItem(customKey, JSON.stringify(custom));
    }
  } catch (e) {}

  window.dispatchEvent(new Event('storage'));
  return { success: true, receipt: updatedRec };
}

/**
 * Deletes a Manager Receipt and reverts stock by subtracting inward quantity.
 */
export function deleteManagerReceipt(refOrId) {
  let receipts = [];
  try {
    receipts = JSON.parse(localStorage.getItem(MGR_RECEIPTS_KEY) || '[]');
  } catch (e) { receipts = []; }

  const searchKey = String(refOrId || '').trim().toLowerCase();
  const idx = receipts.findIndex(r => 
    (r.ref && r.ref.toLowerCase() === searchKey) || 
    (r.id && String(r.id).toLowerCase() === searchKey)
  );
  if (idx === -1) return { success: false, message: 'Receipt not found.' };

  const current = receipts[idx];
  const qty = parseFloat(current.quantity || 0);

  // Revert inward stock: -qty
  if (qty > 0) {
    adjustSystemMaterialStock(current.materialId || current.materialName || current.material, -qty);
  }

  const removed = receipts.splice(idx, 1)[0];
  try {
    localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(receipts));
  } catch (e) {}

  // Also remove from rmims_custom_receipts
  try {
    const customKey = 'rmims_custom_receipts';
    let custom = JSON.parse(localStorage.getItem(customKey) || '[]');
    custom = custom.filter(c => String(c.id).toLowerCase() !== searchKey && (!c.ref || c.ref.toLowerCase() !== searchKey));
    localStorage.setItem(customKey, JSON.stringify(custom));
  } catch (e) {}

  window.dispatchEvent(new Event('storage'));
  return { success: true, receipt: removed };
}

/**
 * Updates a Manager Disbursement and adjusts raw material inventory delta.
 */
export function updateManagerDisbursement(refOrId, updatedFields) {
  let disbursements = [];
  try {
    disbursements = JSON.parse(localStorage.getItem(MGR_DISBURSEMENTS_KEY) || '[]');
  } catch (e) { disbursements = []; }

  const searchKey = String(refOrId || '').trim().toLowerCase();
  const idx = disbursements.findIndex(d => 
    (d.ref && d.ref.toLowerCase() === searchKey) || 
    (d.id && String(d.id).toLowerCase() === searchKey)
  );
  if (idx === -1) return { success: false, message: 'Disbursement not found.' };

  const current = disbursements[idx];
  const oldQty = parseFloat(current.quantity || 0);
  const newQty = updatedFields.quantity != null ? parseFloat(updatedFields.quantity) : oldQty;
  const unit = updatedFields.unit || current.unit || '';

  // Stock adjustment for disburse: outward usage delta is (oldQty - newQty)
  const delta = oldQty - newQty;
  if (delta !== 0) {
    adjustSystemMaterialStock(current.materialId || current.materialName || current.material, delta);
  }

  const updatedDisb = {
    ...current,
    ...updatedFields,
    quantity: newQty,
    unit: unit,
    updatedAt: new Date().toISOString()
  };
  disbursements[idx] = updatedDisb;

  try {
    localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(disbursements));
  } catch (e) {}

  // Also update rmims_custom_disbursements
  try {
    const customKey = 'rmims_custom_disbursements';
    let custom = JSON.parse(localStorage.getItem(customKey) || '[]');
    const cIdx = custom.findIndex(c => String(c.id).toLowerCase() === searchKey || (c.ref && c.ref.toLowerCase() === searchKey));
    if (cIdx !== -1) {
      custom[cIdx] = {
        ...custom[cIdx],
        ...updatedFields,
        consumed_quantity: newQty,
        quantity: newQty,
        unit: unit
      };
      localStorage.setItem(customKey, JSON.stringify(custom));
    }
  } catch (e) {}

  window.dispatchEvent(new Event('storage'));
  return { success: true, disbursement: updatedDisb };
}

/**
 * Deletes a Manager Disbursement and returns outward quantity back to stock.
 */
export function deleteManagerDisbursement(refOrId) {
  let disbursements = [];
  try {
    disbursements = JSON.parse(localStorage.getItem(MGR_DISBURSEMENTS_KEY) || '[]');
  } catch (e) { disbursements = []; }

  const searchKey = String(refOrId || '').trim().toLowerCase();
  const idx = disbursements.findIndex(d => 
    (d.ref && d.ref.toLowerCase() === searchKey) || 
    (d.id && String(d.id).toLowerCase() === searchKey)
  );
  if (idx === -1) return { success: false, message: 'Disbursement not found.' };

  const current = disbursements[idx];
  const qty = parseFloat(current.quantity || 0);

  // Return outward stock back: +qty
  if (qty > 0) {
    adjustSystemMaterialStock(current.materialId || current.materialName || current.material, qty);
  }

  const removed = disbursements.splice(idx, 1)[0];
  try {
    localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(disbursements));
  } catch (e) {}

  // Also remove from rmims_custom_disbursements
  try {
    const customKey = 'rmims_custom_disbursements';
    let custom = JSON.parse(localStorage.getItem(customKey) || '[]');
    custom = custom.filter(c => String(c.id).toLowerCase() !== searchKey && (!c.ref || c.ref.toLowerCase() !== searchKey));
    localStorage.setItem(customKey, JSON.stringify(custom));
  } catch (e) {}

  window.dispatchEvent(new Event('storage'));
  return { success: true, disbursement: removed };
}

