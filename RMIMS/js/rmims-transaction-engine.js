import { adjustSystemMaterialStock, getSystemRawMaterials, resolveForecastingMaterialByName, invalidateForecastCache } from './system-materials.js';
import { markDeleted, isDeleted, isRefDeletedAny, getDeletedSet } from './rmims-deleted-ledger.js';
import { getCompanyAcronym, getRoleReferencePrefix } from './tenant-manager.js';
import { supabase } from '../supabase/supabase-config.js';

const STAFF_TX_OUTBOX_KEY = 'rmims_staff_tx_outbox';
const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));
function withTimeoutP(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
function supabaseUsable() { return Boolean(supabase && !supabase.__offline && typeof supabase.from === 'function'); }

function readOutbox() {
  try { const v = JSON.parse(localStorage.getItem(STAFF_TX_OUTBOX_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}
function writeOutbox(list) {
  try { localStorage.setItem(STAFF_TX_OUTBOX_KEY, JSON.stringify(list.slice(-300))); } catch (_) {}
}
function queueOutbox(tx, isNew) {
  const list = readOutbox().filter(o => !(o && o.tx && o.tx.id === tx.id && o.tx.updatedAt === tx.updatedAt && o.tx.status === tx.status));
  list.push({ tx, isNew: Boolean(isNew), at: Date.now() });
  writeOutbox(list);
}

/**
 * Save the staff transaction state to the shared database log so the manager (and the staff member's other
 * devices) can see it. If the write fails (offline, expired sign-in, ...) it is kept in an outbox and retried,
 * instead of silently staying on this device only (the manager never saw such submissions).
 */
async function pushStaffTxState(tx) {
  const { error } = await withTimeoutP(supabase.from('activity_audit_logs').insert([{
    action: 'STAFF_TX_STATE',
    entity_type: 'staff_transactions',
    entity_id: String(tx.ref),
    details: tx
  }]), 8000);
  if (error) throw new Error(error.message || 'insert failed');
}

function persistStaffTxToSupabase(tx, { isNew = false } = {}) {
  if (!tx || !tx.ref) return;
  if (!supabaseUsable()) { queueOutbox(tx, isNew); return; }
  (async () => {
    try {
      await pushStaffTxState(tx);
      if (isNew) await verifyStaffReferenceOwnership(tx);
    } catch (e) {
      console.warn('[TransactionEngine] staff tx not shared yet, will retry:', e && e.message);
      queueOutbox(tx, isNew);
    }
  })();
}

let outboxRunning = false;
export async function flushStaffTxOutbox() {
  if (outboxRunning || !supabaseUsable()) return;
  const items = readOutbox();
  if (!items.length) return;
  outboxRunning = true;
  try {
    const remaining = [];
    for (const item of items) {
      const tx = item && item.tx;
      if (!tx || !tx.ref) continue;
      // Only push the newest local version of this record
      const current = readStaffListRaw().find(t => t && t.id === tx.id);
      const toSend = current || tx;
      try {
        await pushStaffTxState(toSend);
        if (item.isNew) await verifyStaffReferenceOwnership(toSend);
      } catch (_) {
        remaining.push(item);
      }
    }
    // keep items queued while we were running
    const fresh = readOutbox().filter(o => !items.includes(o) && !items.some(i => i && o && i.at === o.at && i.tx && o.tx && i.tx.id === o.tx.id));
    writeOutbox([...remaining, ...fresh]);
  } finally {
    outboxRunning = false;
  }
}

/**
 * Two staff phones that have not synced yet can both issue e.g. 2026SMSt-R0003. The first record saved to the
 * database keeps the number; the other device renumbers its own record so neither submission is lost.
 */
async function verifyStaffReferenceOwnership(tx) {
  if (!supabaseUsable() || !tx || !tx.ref || !tx.id) return;
  let rows = [];
  try {
    const res = await withTimeoutP(supabase
      .from('activity_audit_logs')
      .select('details, created_at')
      .eq('entity_type', 'staff_transactions')
      .eq('entity_id', String(tx.ref))
      .eq('action', 'STAFF_TX_STATE')
      .order('created_at', { ascending: true })
      .limit(25), 6000);
    rows = (res && Array.isArray(res.data)) ? res.data : [];
  } catch (_) { return; }
  let ownerId = null;
  for (const r of rows) {
    let det = r.details;
    if (typeof det === 'string') { try { det = JSON.parse(det); } catch (_) { det = null; } }
    if (det && det.id) { ownerId = det.id; break; }
  }
  if (!ownerId || ownerId === tx.id) return;

  // We lost: move our record to a fresh number.
  const oldRef = tx.ref;
  burnReference(oldRef);
  const type = /-D\d+/i.test(oldRef) || String(tx.activity || '').toLowerCase().startsWith('dis') ? 'DIS' : 'REC';
  let newRef = generateNextReference(type, 'staff');
  try { newRef = await reserveReference(newRef, type, 'staff'); } catch (_) {}
  const list = readStaffListRaw();
  const idx = list.findIndex(t => t && t.id === tx.id);
  const base = idx !== -1 ? list[idx] : tx;
  const moved = { ...base, ref: newRef, refChangedFrom: oldRef, updatedAt: new Date().toISOString() };
  if (idx !== -1) list[idx] = moved; else list.unshift(moved);
  writeStaffListRaw(list);
  try { localStorage.setItem('rmims_staff_activity_updated', String(Date.now())); } catch (_) {}
  try {
    window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail: moved }));
    if (typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification({
        title: `Reference updated: ${newRef}`,
        message: `Another staff device used ${oldRef} at the same time, so your ${String(moved.activity || 'submission').toLowerCase()} of ${moved.qty || moved.quantity} ${moved.material || ''} was saved as ${newRef}.`,
        category: 'Inventory', badge: 'Pending', role: 'staff', targetRole: 'staff', roleScope: 'staff', priority: 'normal',
        targetUrl: `user/my-activity.html?view=${encodeURIComponent(newRef)}`, ref: newRef
      });
    }
  } catch (_) {}
  try { await pushStaffTxState(moved); } catch (_) { queueOutbox(moved, true); return; }
  await verifyStaffReferenceOwnership(moved);
}

/** Is this reference already used anywhere in the company's shared records? (true / false / null = unknown) */
async function isReferenceTakenRemotely(ref) {
  if (!supabaseUsable() || !ref) return null;
  try {
    const tag = `%[Ref: ${String(ref).replace(/[\\%_]/g, c => '\\' + c)}]%`;
    const [a, b, c] = await withTimeoutP(Promise.all([
      supabase.from('activity_audit_logs').select('id').eq('entity_id', String(ref)).limit(1),
      supabase.from('stock_receipts').select('id').ilike('supplier_name', tag).limit(1),
      supabase.from('material_disbursements').select('id').ilike('activity_type', tag).limit(1)
    ]), 3500);
    const hit = [a, b, c].some(r => r && Array.isArray(r.data) && r.data.length > 0);
    if (hit) return true;
    if (a && a.error && b && b.error && c && c.error) return null;
    return false;
  } catch (_) {
    return null;
  }
}

/** True when this number can no longer be used (already saved here, synced from another device, or deleted). */
export function isReferenceUsed(ref) {
  if (!ref || ref === '--') return true;
  return checkReferenceDuplicate(ref).isDuplicate || isRefDeletedAny(ref);
}

/**
 * Final check right before a receive / disburse is saved: make sure the reference shown on the form is not
 * already used on another device or by a deleted record. Returns the reference to use (the same one, or the
 * next free one).
 */
export async function reserveReference(ref, type = 'REC', role = null) {
  let candidate = String(ref || '').trim() || generateNextReference(type, role);
  for (let i = 0; i < 15; i++) {
    const localTaken = checkReferenceDuplicate(candidate).isDuplicate || isRefDeletedAny(candidate);
    if (localTaken) {
      burnReference(candidate);
      candidate = generateNextReference(type, role);
      continue;
    }
    const remote = await isReferenceTakenRemotely(candidate);
    if (remote === true) {
      burnReference(candidate);
      candidate = generateNextReference(type, role);
      continue;
    }
    return candidate;
  }
  return candidate;
}

if (typeof window !== 'undefined') {
  const kick = () => { flushStaffTxOutbox().catch(() => {}); };
  setTimeout(kick, 3000);
  setInterval(kick, 15000);
  window.addEventListener('online', kick);
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

  // Permanently deleted receipts / disbursements keep their number forever. Those tombstones are shared through the
  // database, but the "burned" list is per browser, so without this a second browser / phone re-issued a deleted
  // number and the new record was immediately hidden as "deleted" (it saved, then vanished).
  ['receipt', 'disbursement'].forEach(kind => {
    getDeletedSet(kind).forEach(ref => {
      const match = ref.match(exactRegex) || ref.match(typeRegex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
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
  const allStaff = readStaffListRaw();
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
    updatedAt: new Date().toISOString(),
    isUpdated: false
  };

  // Never keep two records under one number on this device
  const sameRefIdx = allStaff.findIndex(t => t && t.ref && String(t.ref).toLowerCase() === String(tx.ref).toLowerCase());
  if (sameRefIdx !== -1) allStaff.splice(sameRefIdx, 1);
  allStaff.unshift(tx);
  try {
    localStorage.setItem(STAFF_TX_KEY, JSON.stringify(allStaff));
    localStorage.setItem('rmims_staff_activity_updated', String(Date.now()));
  } catch (e) {}
  burnReference(tx.ref);
  persistStaffTxToSupabase(tx, { isNew: true });

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
  const allStaff = readStaffListRaw();
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

/** Everything stored on this device, including records the staff member withdrew (kept so syncs know they are gone). */
export function readStaffListRaw() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STAFF_TX_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}
function writeStaffListRaw(list) {
  try { localStorage.setItem(STAFF_TX_KEY, JSON.stringify(list)); } catch (_) {}
}

export function getStaffTransactions() {
  try {
    const raw = localStorage.getItem(STAFF_TX_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    list = list.filter(Boolean);
    const BANNED_STAFF = ['user account', 'staff member', 'user', 'account', 'staff user', 'store manager', 'manager', 'admin', '—', '-'];
    let modified = false;
    list.forEach(t => {
      if (!t) return;
      const lowerStaff = String(t.staff || '').toLowerCase().trim();
      if (!t.staff || BANNED_STAFF.includes(lowerStaff)) {
        const resolved = String(t.staffEmail || '').split('@')[0];
        if (resolved && resolved !== t.staff) { t.staff = resolved; modified = true; }
      }
    });
    if (modified) {
      try {
        localStorage.setItem(STAFF_TX_KEY, JSON.stringify(list));
      } catch (_) {}
    }
    return list.filter(t => !t.withdrawnByStaff && !isRefDeletedAny(t.ref) && !['tx-staff-001', 'tx-staff-002', 'tx-staff-003', 'tx-staff-004', 'tx-staff-005', 'st-001', 'st-002', 'st-003', 'st-004', 'st-005'].includes(t.id));
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
  const allStaff = readStaffListRaw();
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
  const allStaff = readStaffListRaw();
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

  // The record is kept as "withdrawn" (hidden everywhere) instead of being removed. Removing it only on this
  // device let the next database sync bring it straight back, on this device and on the manager's.
  const nowIso = new Date().toISOString();
  const removed = {
    ...current,
    status: 'Deleted',
    withdrawnByStaff: true,
    deletedBy: current.staff || 'Staff',
    deletedAt: nowIso,
    updatedAt: nowIso
  };
  allStaff[idx] = removed;
  writeStaffListRaw(allStaff);
  try { localStorage.setItem('rmims_staff_activity_updated', String(Date.now())); } catch (e) {}
  burnReference(current.ref);
  persistStaffTxToSupabase(removed);

  window.dispatchEvent(new Event('storage'));
  window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail: removed }));
  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync({ transaction: removed });
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
  return deleteLedgerTransaction('receipt', refOrId);
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
  return deleteLedgerTransaction('disbursement', refOrId);
}

/**
 * ============================================================================
 * PERMANENT DELETE (receipts & disbursements)
 * ----------------------------------------------------------------------------
 * A transaction can exist in up to three local stores at once:
 *   1. Manager ledger            (rmims_manager_receipts / rmims_manager_disbursements)
 *   2. System custom ledger      (rmims_custom_receipts  / rmims_custom_disbursements)
 *   3. Approved staff submission (rmims_staff_transactions)
 * Deleting from only one of them (the old behaviour) either failed with
 * "not found" or let the record reappear on the next sync. This removes it from
 * every store, restores/reverts stock EXACTLY ONCE, and writes a tombstone so
 * no sync path can bring it back.
 * ============================================================================
 */
const LEDGER_KINDS = {
  receipt: {
    label: 'Receipt',
    mgrKey: MGR_RECEIPTS_KEY,
    customKey: 'rmims_custom_receipts',
    qtyFields: ['quantity', 'received_quantity', 'qtyNum'],
    stockSign: -1 // deleting an inward receipt takes the received quantity back OUT of stock
  },
  disbursement: {
    label: 'Disbursement',
    mgrKey: MGR_DISBURSEMENTS_KEY,
    customKey: 'rmims_custom_disbursements',
    qtyFields: ['quantity', 'consumed_quantity', 'qtyNum'],
    stockSign: +1 // deleting an outward disbursement puts the quantity back INTO stock
  }
};

function readJsonList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeJsonList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (_) {}
}

function recMatches(rec, key) {
  if (!rec) return false;
  const k = String(key || '').trim().toLowerCase();
  if (!k) return false;
  return [rec.ref, rec.id, rec.referenceNo, rec.reference_no]
    .some(v => v != null && String(v).trim().toLowerCase() === k);
}

function firstQty(rec, fields) {
  for (const f of fields) {
    const raw = rec && rec[f];
    if (raw != null && raw !== '') {
      const n = parseFloat(raw);
      if (!isNaN(n)) return n;
    }
  }
  // staff transactions sometimes only carry "720 g"
  if (rec && typeof rec.qty === 'string') {
    const n = parseFloat(rec.qty);
    if (!isNaN(n)) return n;
  }
  return 0;
}

/** Resolve a ledger record to the key adjustSystemMaterialStock understands (code first, then canonical name match). */
function resolveStockKey(rec) {
  const id = rec.materialId || rec.material_id || rec.item_code || '';
  const name = rec.materialName || rec.material_name || rec.material || '';
  try {
    const catalog = getSystemRawMaterials();
    const idLower = String(id).trim().toLowerCase();
    const nameLower = String(name).trim().toLowerCase();
    const direct = catalog.find(m =>
      (idLower && (String(m.id || '').toLowerCase() === idLower || String(m.item_code || '').toLowerCase() === idLower)) ||
      (nameLower && String(m.name || '').trim().toLowerCase() === nameLower));
    if (direct) return direct.item_code || direct.id;
    // Names coming from Supabase / staff entry can differ ("All Purpose Flour" vs "All-Purpose / Bread Flour")
    const recognized = resolveForecastingMaterialByName(name || id);
    if (recognized && recognized.code) {
      const viaCode = catalog.find(m => String(m.item_code || m.id || '').toUpperCase() === String(recognized.code).toUpperCase());
      if (viaCode) return viaCode.item_code || viaCode.id;
    }
  } catch (_) {}
  return id || name;
}

export function deleteLedgerTransaction(kind, refOrId) {
  const cfg = LEDGER_KINDS[kind];
  if (!cfg) return { success: false, message: 'Unknown transaction type.' };

  const key = String(refOrId || '').trim();
  if (!key) return { success: false, message: `${cfg.label} reference is missing.` };

  const mgrList = readJsonList(cfg.mgrKey);
  const customList = readJsonList(cfg.customKey);
  const staffList = readJsonList(STAFF_TX_KEY);

  const mgrRec = mgrList.find(r => recMatches(r, key)) || null;
  const customRec = customList.find(r => recMatches(r, key)) || null;
  const staffRec = staffList.find(r => recMatches(r, key)) || null;
  const found = mgrRec || customRec || staffRec;

  if (!found) {
    // Already removed earlier (double-click, second tab, remote sync echo): treat as done, never touch stock twice.
    if (isDeleted(kind, key)) return { success: true, alreadyDeleted: true, message: `${cfg.label} was already deleted.` };
    return { success: false, message: `${cfg.label} not found.` };
  }

  // Quantity & material come from the richest record available
  const qty = firstQty(mgrRec || customRec || staffRec, cfg.qtyFields) ||
              firstQty(customRec || staffRec || {}, cfg.qtyFields);
  const stockKey = resolveStockKey(mgrRec || customRec || staffRec || {}) ||
                   resolveStockKey(customRec || staffRec || {});

  // 1. Revert stock exactly once
  let stockResult = null;
  if (qty > 0 && stockKey) {
    stockResult = adjustSystemMaterialStock(stockKey, cfg.stockSign * qty);
  }

  // 2. Remove from every local store
  const ids = new Set([key]);
  [mgrRec, customRec, staffRec].forEach(r => {
    if (!r) return;
    [r.ref, r.id, r.referenceNo, r.reference_no].forEach(v => { if (v != null && String(v).trim()) ids.add(String(v).trim()); });
  });

  if (mgrRec) writeJsonList(cfg.mgrKey, mgrList.filter(r => !recMatches(r, key)));
  if (customRec) writeJsonList(cfg.customKey, customList.filter(r => !recMatches(r, key)));
  if (staffRec) writeJsonList(STAFF_TX_KEY, staffList.filter(r => !recMatches(r, key)));

  // 3. Tombstone so Supabase / staff / dashboard merges can never resurrect it
  markDeleted(kind, ...ids);
  burnReference(key); // the reference number is never reused

  // 4. Notify every module (inventory KPIs, forecast, reports, dashboard, staff view)
  try { invalidateForecastCache(); } catch (_) {}
  try {
    const now = String(Date.now());
    localStorage.setItem('rmims_inventory_updated', now);
    localStorage.setItem(kind === 'receipt' ? 'rmims_manager_receipts_updated' : 'rmims_manager_disbursements_updated', now);
    localStorage.setItem('rmims_staff_transactions_updated', now);
  } catch (_) {}
  try {
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new Event(kind === 'receipt' ? 'rmims_manager_receipts_updated' : 'rmims_manager_disbursements_updated'));
    window.dispatchEvent(new Event('rmims_inventory_updated'));
  } catch (_) {}

  const removed = mgrRec || customRec || staffRec;
  return {
    success: true,
    [kind]: removed,
    restoredQty: qty,
    stockKey,
    newStock: stockResult ? stockResult.current_stock : null
  };
}
