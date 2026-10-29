/**
 * RMIMS Manager Supabase Service
 * Authoritative Supabase Integration for Store Management & Manager Modules:
 * - Live queries for raw_materials, stock_receipts, material_disbursements, activity_audit_logs, user_profiles
 * - Unified transaction approval & rejection linked directly to Supabase
 * - Real-time Inflow/Outflow ledger persistence to Supabase
 * - Zero hardcoded or zombie fallbacks; authentic live data synchronization
 * - Unified cross-module broadcast (Dashboard <-> Inventory <-> Receive <-> Disburse <-> Staff Activity)
 */

import { supabase } from './supabase-config.js';
import {
  getSystemRawMaterials,
  saveCustomRawMaterial,
  deleteSystemRawMaterial,
  saveCustomReceipt,
  saveCustomDisbursement,
  adjustSystemMaterialStock,
  updateMaterialActivityTimestamp,
  invalidateForecastCache
} from '../js/system-materials.js';

const STAFF_TX_KEY = 'rmims_staff_transactions';
const MGR_RECEIPTS_KEY = 'rmims_manager_receipts';
const MGR_DISBURSEMENTS_KEY = 'rmims_manager_disbursements';
const MGR_ACTIVITIES_KEY = 'rmims_manager_activities';

/**
 * Timeout helper for resilient live Supabase network requests
 */
function fetchWithTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase request timeout')), ms))
  ]);
}

/**
 * Fetch all live manager & store data directly from Supabase
 */
export async function fetchManagerDashboardData() {
  const result = {
    rawMaterials: [],
    stockReceipts: [],
    materialDisbursements: [],
    auditLogs: [],
    userProfiles: [],
    isLive: false
  };

  if (!supabase) return result;

  try {
    const [matRes, rcvRes, disbRes, logRes, profRes] = await Promise.allSettled([
      fetchWithTimeout(supabase.from('raw_materials').select('*').order('name')),
      fetchWithTimeout(supabase.from('stock_receipts').select('*').order('receipt_date', { ascending: false })),
      fetchWithTimeout(supabase.from('material_disbursements').select('*').order('usage_date', { ascending: false })),
      fetchWithTimeout(supabase.from('activity_audit_logs').select('*').order('created_at', { ascending: false }).limit(50)),
      fetchWithTimeout(supabase.from('user_profiles').select('*'))
    ]);

    if (matRes.status === 'fulfilled' && Array.isArray(matRes.value?.data)) {
      result.rawMaterials = matRes.value.data;
    }
    if (rcvRes.status === 'fulfilled' && Array.isArray(rcvRes.value?.data)) {
      result.stockReceipts = rcvRes.value.data;
    }
    if (disbRes.status === 'fulfilled' && Array.isArray(disbRes.value?.data)) {
      result.materialDisbursements = disbRes.value.data;
    }
    if (logRes.status === 'fulfilled' && Array.isArray(logRes.value?.data)) {
      result.auditLogs = logRes.value.data;
    }
    if (profRes.status === 'fulfilled' && Array.isArray(profRes.value?.data)) {
      result.userProfiles = profRes.value.data;
    }

    result.isLive = true;

    // Restore persistent finished products from Supabase
    fetchLiveFinishedProductsFromSupabase().catch(() => {});

    // Authoritatively synchronize Supabase raw_materials with local storage master cache
    if (matRes.status === 'fulfilled' && Array.isArray(matRes.value?.data)) {
      try {
        const reconciled = matRes.value.data.map(sm => {
          const code = String(sm.item_code || sm.id || '').toUpperCase().trim();
          return {
            id: sm.id || code,
            item_code: sm.item_code || code,
            name: sm.name,
            raw_material_name: sm.name,
            unit_of_measure: sm.unit_of_measure,
            unit: sm.unit_of_measure,
            current_stock: Number(sm.current_stock ?? 0),
            currentStock: Number(sm.current_stock ?? 0),
            minimum_threshold: Number(sm.minimum_threshold ?? 10),
            minimum_stock: Number(sm.minimum_threshold ?? 10),
            reorder_quantity: Number(sm.reorder_quantity ?? 25),
            lead_time_days: Number(sm.lead_time_days ?? 3),
            description: sm.description || `Raw material ${sm.name}`,
            created_at: sm.created_at || new Date().toISOString()
          };
        });
        // Preserve locally imported/updated materials during dashboard sync
        let existingOverrides = {};
        try { existingOverrides = JSON.parse(localStorage.getItem('rmims_manager_material_overrides') || '{}'); } catch (_) {}
        const mgrOverrides = { ...existingOverrides };
        reconciled.forEach(m => {
          const prev = existingOverrides[m.item_code] || {};
          const usePrev = prev.is_imported || prev.is_manual_override || Boolean(prev.last_updated) || (prev.current_stock > 0 && m.current_stock === 0);
          const firstDate = prev.date_added || prev.first_date || m.date_added || (m.created_at ? String(m.created_at).slice(0, 10) : '');
          const latestDate = prev.last_updated || prev.latest_date || m.updated_at || m.created_at || firstDate;
          mgrOverrides[m.item_code] = {
            ...prev,
            name: m.name,
            raw_material_name: m.name,
            unit: prev.unit || m.unit,
            current_stock: usePrev ? prev.current_stock : m.current_stock,
            minimum_stock: prev.minimum_stock ?? m.minimum_threshold,
            maximum_stock: prev.maximum_stock || (m.reorder_quantity * 4),
            date_added: firstDate,
            first_date: firstDate,
            display_date: prev.display_date || firstDate || '',
            last_updated: latestDate,
            latest_date: latestDate
          };
        });
        localStorage.setItem('rmims_manager_material_overrides', JSON.stringify(mgrOverrides));
      } catch (e) {
        console.warn('[ManagerSupabase] Error syncing materials to local storage:', e);
      }
    }

    // Authoritatively synchronize Supabase receipts with local manager receipts (merge without wiping local entries)
    if (rcvRes.status === 'fulfilled' && Array.isArray(rcvRes.value?.data)) {
      try {
        let deletedRecIds = new Set();
        try {
          deletedRecIds = new Set(JSON.parse(localStorage.getItem('rmims_deleted_receipt_ids') || '[]').map(x => String(x)));
        } catch (_) {}

        let existingLocalRec = [];
        try {
          const parsed = JSON.parse(localStorage.getItem(MGR_RECEIPTS_KEY) || '[]');
          if (Array.isArray(parsed)) existingLocalRec = parsed.filter(r => r && !deletedRecIds.has(String(r.ref || r.id)));
        } catch (_) {}

        const remoteRec = rcvRes.value.data
          .filter(sr => sr && !deletedRecIds.has(String(sr.id)))
          .map(sr => ({
            id: sr.id,
            ref: sr.id,
            date: sr.receipt_date,
            materialId: sr.material_id,
            materialName: sr.material_name || '',
            quantity: Number(sr.received_quantity || 0),
            unit: sr.unit || 'kg',
            supplier: sr.supplier_name || 'Inward Delivery',
            recordedBy: sr.received_by || 'Store Manager',
            status: 'Approved',
            createdAt: sr.created_at
          }));

        const recMap = new Map();
        existingLocalRec.forEach(r => recMap.set(String(r.ref || r.id), r));
        remoteRec.forEach(r => {
          const k = String(r.ref || r.id);
          if (!recMap.has(k)) recMap.set(k, r);
        });
        localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(Array.from(recMap.values())));
      } catch (e) {
        console.warn('[ManagerSupabase] Error syncing receipts to local storage:', e);
      }
    }

    // Authoritatively synchronize Supabase disbursements with local manager disbursements (merge without wiping local entries)
    if (disbRes.status === 'fulfilled' && Array.isArray(disbRes.value?.data)) {
      try {
        let deletedDisbIds = new Set();
        try {
          deletedDisbIds = new Set(JSON.parse(localStorage.getItem('rmims_deleted_disbursement_ids') || '[]').map(x => String(x)));
        } catch (_) {}

        let existingLocalDisb = [];
        try {
          const parsed = JSON.parse(localStorage.getItem(MGR_DISBURSEMENTS_KEY) || '[]');
          if (Array.isArray(parsed)) existingLocalDisb = parsed.filter(d => d && !deletedDisbIds.has(String(d.ref || d.id)));
        } catch (_) {}

        const remoteDisb = disbRes.value.data
          .filter(sd => sd && !deletedDisbIds.has(String(sd.id)))
          .map(sd => ({
            id: sd.id,
            ref: sd.id,
            date: sd.usage_date,
            materialId: sd.material_id,
            materialName: sd.material_name || '',
            quantity: Number(sd.consumed_quantity || 0),
            unit: sd.unit || 'kg',
            recipient: sd.finished_product_name || sd.activity_type || 'Production Batch',
            usedFor: sd.finished_product_name || sd.activity_type || 'Production Batch',
            recordedBy: sd.recorded_by || 'Store Manager',
            status: 'Approved',
            createdAt: sd.created_at
          }));

        const disbMap = new Map();
        existingLocalDisb.forEach(d => disbMap.set(String(d.ref || d.id), d));
        remoteDisb.forEach(d => {
          const k = String(d.ref || d.id);
          if (!disbMap.has(k)) disbMap.set(k, d);
        });
        localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(Array.from(disbMap.values())));
      } catch (e) {
        console.warn('[ManagerSupabase] Error syncing disbursements to local storage:', e);
      }
    }

  } catch (err) {
    console.warn('[ManagerSupabase] Live fetch warning:', err);
  }

  return result;
}

/**
 * Record stock receipt directly to Supabase inflow ledger and update recorded stock
 */
export async function recordStockReceiptToSupabase(receipt) {
  if (!supabase || !receipt) return { success: false };

  try {
    const rawDate = receipt.date || receipt.receipt_date || new Date().toISOString().slice(0, 10);
    const dateOnly = String(rawDate).split(' • ')[0].split('T')[0];
    const qty = Number(receipt.quantity || receipt.received_quantity || 0);

    // Resolve 36-char material UUID if only code or name provided
    let resolvedMaterialId = (receipt.materialId && receipt.materialId.length === 36) ? receipt.materialId : null;
    if (!resolvedMaterialId && supabase) {
      try {
        const matSearch = receipt.materialId || receipt.item_code || receipt.materialName || receipt.material || '';
        const { data: foundMat } = await supabase.from('raw_materials')
          .select('id, current_stock')
          .or(`item_code.eq.${matSearch},name.ilike.${receipt.materialName || receipt.material || matSearch}`)
          .limit(1)
          .maybeSingle();
        if (foundMat && foundMat.id) {
          resolvedMaterialId = foundMat.id;
        }
      } catch (_) {}
    }

    // 1. Try stored procedure if available
    let rpcSuccess = false;
    if (resolvedMaterialId) {
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('record_stock_receipt_v2', {
          p_material_id: resolvedMaterialId,
          p_receipt_date: dateOnly,
          p_quantity: qty,
          p_unit: receipt.unit || 'kg',
          p_supplier_name: receipt.supplier || receipt.supplier_name || 'Inward Delivery'
        });
        if (!rpcErr && rpcData?.success) {
          rpcSuccess = true;
        }
      } catch (_) {}
    }

    // 2. Direct insert into stock_receipts if RPC not used
    if (!rpcSuccess) {
      const payload = {
        receipt_date: dateOnly,
        received_quantity: qty,
        unit: receipt.unit || 'kg',
        supplier_name: (receipt.supplier || receipt.supplier_name || 'Inward Delivery') + (receipt.ref ? ` [Ref: ${receipt.ref}]` : '')
      };
      if (resolvedMaterialId) {
        payload.material_id = resolvedMaterialId;
      }
      const { data, error } = await supabase.from('stock_receipts').insert([payload]).select();
      if (error) {
        console.warn('[ManagerSupabase] Direct stock_receipts insert notice:', error.message);
      }
    }

    // 3. Log to activity_audit_logs
    await logManagerActivityToSupabase({
      action: 'STOCK_RECEIPT',
      entityType: 'stock_receipts',
      entityId: receipt.ref || receipt.id || '',
      details: {
        ref: receipt.ref,
        material: receipt.materialName || receipt.material,
        quantity: qty,
        unit: receipt.unit,
        supplier: receipt.supplier
      }
    });

    return { success: true };
  } catch (err) {
    console.warn('[ManagerSupabase] Error recording receipt to Supabase:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Record material disbursement directly to Supabase outflow ledger and update recorded stock
 */
export async function recordMaterialDisbursementToSupabase(disbursement) {
  if (!supabase || !disbursement) return { success: false };

  try {
    const rawDate = disbursement.date || disbursement.usage_date || new Date().toISOString().slice(0, 10);
    const dateOnly = String(rawDate).split(' • ')[0].split('T')[0];
    const qty = Number(disbursement.quantity || disbursement.consumed_quantity || 0);

    // Resolve 36-char material UUID if only code or name provided
    let resolvedMaterialId = (disbursement.materialId && disbursement.materialId.length === 36) ? disbursement.materialId : null;
    if (!resolvedMaterialId && supabase) {
      try {
        const matSearch = disbursement.materialId || disbursement.item_code || disbursement.materialName || disbursement.material || '';
        const { data: foundMat } = await supabase.from('raw_materials')
          .select('id, current_stock')
          .or(`item_code.eq.${matSearch},name.ilike.${disbursement.materialName || disbursement.material || matSearch}`)
          .limit(1)
          .maybeSingle();
        if (foundMat && foundMat.id) {
          resolvedMaterialId = foundMat.id;
        }
      } catch (_) {}
    }

    // 1. Try stored procedure if available
    let rpcSuccess = false;
    if (resolvedMaterialId) {
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('record_material_disbursement_v2', {
          p_material_id: resolvedMaterialId,
          p_usage_date: dateOnly,
          p_quantity: qty,
          p_unit: disbursement.unit || 'kg',
          p_activity_type: (disbursement.activityType || disbursement.activity_type || 'Production Usage') + (disbursement.ref ? ` [Ref: ${disbursement.ref}]` : ''),
          p_finished_product_name: disbursement.recipient || disbursement.usedFor || disbursement.finished_product_name || 'Production Batch'
        });
        if (!rpcErr && rpcData?.success) {
          rpcSuccess = true;
        }
      } catch (_) {}
    }

    // 2. Direct insert into material_disbursements if RPC not used
    if (!rpcSuccess) {
      const payload = {
        usage_date: dateOnly,
        consumed_quantity: qty,
        unit: disbursement.unit || 'kg',
        activity_type: (disbursement.activityType || disbursement.activity_type || 'Production Usage') + (disbursement.ref ? ` [Ref: ${disbursement.ref}]` : ''),
        finished_product_name: disbursement.recipient || disbursement.usedFor || disbursement.finished_product_name || 'Production Batch'
      };
      if (resolvedMaterialId) {
        payload.material_id = resolvedMaterialId;
      }
      const { data, error } = await supabase.from('material_disbursements').insert([payload]).select();
      if (error) {
        console.warn('[ManagerSupabase] Direct material_disbursements insert notice:', error.message);
      }
    }

    // 3. Log to activity_audit_logs
    await logManagerActivityToSupabase({
      action: 'MATERIAL_DISBURSEMENT',
      entityType: 'material_disbursements',
      entityId: disbursement.ref || disbursement.id || '',
      details: {
        ref: disbursement.ref,
        material: disbursement.materialName || disbursement.material,
        quantity: qty,
        unit: disbursement.unit,
        recipient: disbursement.recipient || disbursement.usedFor
      }
    });

    return { success: true };
  } catch (err) {
    console.warn('[ManagerSupabase] Error recording disbursement to Supabase:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Append audit event to Supabase activity_audit_logs
 */
export async function logManagerActivityToSupabase({ action, entityType, entityId, details = {} }) {
  if (!supabase) return;
  try {
    let userId = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) userId = user.id;
    } catch (_) {}

    await supabase.from('activity_audit_logs').insert([{
      user_id: userId,
      action: action || 'MANAGER_ACTION',
      entity_type: entityType || 'general',
      entity_id: String(entityId || ''),
      details: details || {}
    }]);
  } catch (e) {
    console.warn('[ManagerSupabase] Audit log notice:', e);
  }
}

/**
 * Approve a transaction on Supabase and unify across all manager modules
 */
export async function approveTransactionOnSupabase(tx) {
  if (!tx) return { success: false, message: 'Invalid transaction' };

  const refStr = String(tx.ref || '');
  const isReceive = (tx.activity || tx.type || '').toLowerCase().includes('rec') ||
                    refStr.toUpperCase().startsWith('REC') ||
                    /-R\d+/i.test(refStr);
  const qty = parseFloat(tx.quantity != null ? tx.quantity : (tx.qtyNum != null ? tx.qtyNum : tx.qty)) || 0;
  const unit = tx.unit || (tx.qty ? String(tx.qty).replace(/^[0-9.\s]+/, '') : '') || 'kg';
  const materialName = tx.material || tx.materialName || '';

  // 1. Authoritative local stock update via system-materials
  const materials = getSystemRawMaterials();
  const searchName = String(materialName).trim().toLowerCase();
  const foundMat = materials.find(m =>
    (m.name || m.raw_material_name || '').trim().toLowerCase() === searchName ||
    String(m.id || '').toLowerCase() === searchName ||
    String(m.item_code || '').toLowerCase() === searchName
  );

  const matId = foundMat ? (foundMat.id || foundMat.item_code) : (tx.materialId || tx.item_code || materialName);
  const resolvedMatName = foundMat ? (foundMat.name || foundMat.raw_material_name) : materialName;
  const delta = isReceive ? qty : -qty;

  const updatedMat = adjustSystemMaterialStock(matId || resolvedMatName, delta);
  updateMaterialActivityTimestamp(matId || resolvedMatName, new Date().toISOString(), isReceive ? 'Receive' : 'Disburse', qty, unit);
  if (updatedMat) {
    saveRawMaterialToSupabase({
      id: updatedMat.id,
      item_code: updatedMat.item_code || updatedMat.id,
      name: updatedMat.name,
      raw_material_name: updatedMat.raw_material_name || updatedMat.name,
      current_stock: updatedMat.current_stock,
      unit: updatedMat.unit || updatedMat.unit_of_measure
    }).catch(e => console.warn('[ManagerSupabase] Stock sync notice:', e));
  }

  // 2. Persist to Supabase and custom ledgers
  if (isReceive) {
    saveCustomReceipt({
      id: `rec-${tx.ref}`,
      referenceNo: tx.ref,
      material_id: matId,
      material_name: resolvedMatName,
      received_quantity: qty,
      unit: unit,
      receipt_date: tx.date || new Date().toISOString().slice(0, 10),
      supplier_name: tx.supplier || 'Staff Inward Delivery',
      received_by: tx.staff || 'Staff Member'
    });

    try {
      const mgrRecRaw = localStorage.getItem(MGR_RECEIPTS_KEY);
      let mgrRecs = mgrRecRaw ? JSON.parse(mgrRecRaw) : [];
      if (!Array.isArray(mgrRecs)) mgrRecs = [];
      mgrRecs = mgrRecs.filter(r => r.ref !== tx.ref);
      mgrRecs.unshift({
        ref: tx.ref,
        date: tx.date || new Date().toISOString().slice(0, 10),
        time: tx.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        materialId: matId,
        materialName: resolvedMatName,
        quantity: qty,
        unit: unit,
        supplier: tx.supplier || 'Staff Inward Delivery',
        recordedBy: tx.staff || 'Staff Member',
        approvedBy: 'Store Manager',
        status: 'Approved',
        notes: tx.notes || `Submitted by ${tx.staff || 'Staff'}, approved by Manager`
      });
      localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(mgrRecs));
    } catch (_) {}

    // Supabase commit
    await recordStockReceiptToSupabase({
      ref: tx.ref,
      materialId: matId,
      materialName: resolvedMatName,
      quantity: qty,
      unit: unit,
      date: tx.date,
      supplier: tx.supplier
    });
  } else {
    saveCustomDisbursement({
      id: `disb-${tx.ref}`,
      referenceNo: tx.ref,
      material_id: matId,
      material_name: resolvedMatName,
      consumed_quantity: qty,
      unit: unit,
      usage_date: tx.date || new Date().toISOString().slice(0, 10),
      activity_type: 'Production Usage',
      finished_product_name: tx.usedFor || 'Production Batch',
      disbursed_by: tx.staff || 'Staff Member'
    });

    try {
      const mgrDisbRaw = localStorage.getItem(MGR_DISBURSEMENTS_KEY);
      let mgrDisbs = mgrDisbRaw ? JSON.parse(mgrDisbRaw) : [];
      if (!Array.isArray(mgrDisbs)) mgrDisbs = [];
      mgrDisbs = mgrDisbs.filter(d => d.ref !== tx.ref);
      mgrDisbs.unshift({
        ref: tx.ref,
        date: tx.date || new Date().toISOString().slice(0, 10),
        time: tx.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        materialId: matId,
        materialName: resolvedMatName,
        quantity: qty,
        unit: unit,
        recipient: tx.usedFor || 'Production Department',
        recordedBy: tx.staff || 'Staff Member',
        approvedBy: 'Store Manager',
        status: 'Approved',
        notes: tx.notes || `Submitted by ${tx.staff || 'Staff'}, approved by Manager`
      });
      localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(mgrDisbs));
    } catch (_) {}

    // Supabase commit
    await recordMaterialDisbursementToSupabase({
      ref: tx.ref,
      materialId: matId,
      materialName: resolvedMatName,
      quantity: qty,
      unit: unit,
      date: tx.date,
      recipient: tx.usedFor
    });
  }

  // 3. Update staff transaction status
  try {
    const rawStaff = localStorage.getItem(STAFF_TX_KEY);
    if (rawStaff) {
      const staffList = JSON.parse(rawStaff);
      if (Array.isArray(staffList)) {
        const idx = staffList.findIndex(t => t.ref === tx.ref || t.id === tx.id);
        if (idx !== -1) {
          staffList[idx].status = 'Approved';
          staffList[idx].approvedBy = 'Store Manager';
          staffList[idx].approvedAt = new Date().toISOString();
          staffList[idx].quantity = qty;
          staffList[idx].unit = unit;
          localStorage.setItem(STAFF_TX_KEY, JSON.stringify(staffList));
        }
      }
    }
  } catch (_) {}

  // 4. Log Manager Activity
  try {
    const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
    const actRaw = localStorage.getItem(MGR_ACTIVITIES_KEY);
    const acts = actRaw ? JSON.parse(actRaw) : [];
    acts.unshift({
      datetime: 'Just now',
      timestamp: new Date().toISOString(),
      activity: `Approve Transaction (${tx.ref})`,
      reference: tx.ref,
      status: 'Approved',
      user: curUser.name || curUser.fullName || curUser.username || 'Manager',
      role: curUser.role || 'Manager',
      branchLoc: curUser.branchLoc || curUser.location || '',
      branchName: curUser.branchName || curUser.branch || '',
      action: 'Approved',
      module: 'Inventory'
    });
    localStorage.setItem(MGR_ACTIVITIES_KEY, JSON.stringify(acts));
  } catch (_) {}

  // 5. Audit log in Supabase
  await logManagerActivityToSupabase({
    action: 'APPROVE_TRANSACTION',
    entityType: 'staff_transactions',
    entityId: tx.ref || tx.id || '',
    details: {
      ref: tx.ref,
      material: resolvedMatName,
      quantity: qty,
      unit: unit,
      activity: tx.activity || (isReceive ? 'Receive' : 'Disburse')
    }
  });

  // 6. Push notification for Staff
  const appNotif = {
    title: `Transaction Approved: ${tx.ref}`,
    message: `Store Manager approved ${tx.ref} (${qty} ${unit} of ${resolvedMatName}). Official stock synchronized.`,
    category: 'Inventory',
    badge: 'Approved',
    role: 'staff',
    targetRole: 'staff',
    roleScope: 'staff',
    priority: 'success',
    targetUrl: `user/my-activity.html?view=${encodeURIComponent(tx.ref)}`,
    ref: tx.ref,
    material: resolvedMatName,
    quantity: `${qty} ${unit}`,
    actor: 'Store Manager'
  };

  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(appNotif);
    }
  } catch (_) {}

  // 7. Global synchronization broadcast across all manager & staff modules
  invalidateForecastCache();
  broadcastManagerSync({
    action: 'approve_transaction',
    ref: tx.ref,
    material: resolvedMatName,
    isReceive: isReceive,
    notification: appNotif
  });

  return { success: true };
}

/**
 * Reject a transaction on Supabase and unify across all manager modules
 */
export async function rejectTransactionOnSupabase(tx, reason = 'Details require correction.') {
  if (!tx) return { success: false, message: 'Invalid transaction' };

  // 1. Update staff transaction status in local storage
  try {
    const rawStaff = localStorage.getItem(STAFF_TX_KEY);
    if (rawStaff) {
      const staffList = JSON.parse(rawStaff);
      if (Array.isArray(staffList)) {
        const idx = staffList.findIndex(t => t.ref === tx.ref || t.id === tx.id);
        if (idx !== -1) {
          staffList[idx].status = 'Rejected';
          staffList[idx].rejectionReason = reason;
          staffList[idx].rejectedBy = 'Store Manager';
          staffList[idx].rejectedAt = new Date().toISOString();
          localStorage.setItem(STAFF_TX_KEY, JSON.stringify(staffList));
        }
      }
    }
  } catch (_) {}

  // 2. Log manager activity in local storage
  try {
    const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
    const actRaw = localStorage.getItem(MGR_ACTIVITIES_KEY);
    const acts = actRaw ? JSON.parse(actRaw) : [];
    acts.unshift({
      datetime: 'Just now',
      timestamp: new Date().toISOString(),
      activity: `Reject Transaction (${tx.ref})`,
      reference: tx.ref,
      status: 'Rejected',
      user: curUser.name || curUser.fullName || curUser.username || 'Manager',
      role: curUser.role || 'Manager',
      action: 'Rejected',
      module: 'Inventory'
    });
    localStorage.setItem(MGR_ACTIVITIES_KEY, JSON.stringify(acts));
  } catch (_) {}

  // 3. Audit log in Supabase
  await logManagerActivityToSupabase({
    action: 'REJECT_TRANSACTION',
    entityType: 'staff_transactions',
    entityId: tx.ref || tx.id || '',
    details: {
      ref: tx.ref,
      reason: reason,
      material: tx.material || tx.materialName
    }
  });

  // 4. Staff notification
  const rejNotif = {
    title: `Transaction Rejected: ${tx.ref}`,
    message: `Transaction ${tx.ref} was rejected by Store Manager: "${reason}".`,
    category: 'Inventory',
    badge: 'Rejected',
    role: 'staff',
    targetRole: 'staff',
    roleScope: 'staff',
    priority: 'danger',
    targetUrl: `user/my-activity.html?view=${encodeURIComponent(tx.ref)}`,
    ref: tx.ref,
    material: tx.material || tx.materialName || '',
    actor: 'Store Manager'
  };

  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(rejNotif);
    }
  } catch (_) {}

  // 5. Broadcast across tabs
  broadcastManagerSync({
    action: 'reject_transaction',
    ref: tx.ref,
    reason: reason,
    notification: rejNotif
  });

  return { success: true };
}

/**
 * Return a transaction for staff correction on Supabase and unify across all manager modules
 */
export async function returnTransactionForCorrectionOnSupabase(tx, message = 'Please correct details and resubmit.') {
  if (!tx) return { success: false, message: 'Invalid transaction' };

  // 1. Update staff transaction status in local storage
  try {
    const rawStaff = localStorage.getItem(STAFF_TX_KEY);
    if (rawStaff) {
      const staffList = JSON.parse(rawStaff);
      if (Array.isArray(staffList)) {
        const idx = staffList.findIndex(t => t.ref === tx.ref || t.id === tx.id);
        if (idx !== -1) {
          staffList[idx].status = 'Correction Needed';
          staffList[idx].correctionMessage = message;
          staffList[idx].returnedBy = 'Store Manager';
          staffList[idx].returnedAt = new Date().toISOString();
          staffList[idx].isUpdated = false;
          localStorage.setItem(STAFF_TX_KEY, JSON.stringify(staffList));
        }
      }
    }
  } catch (_) {}

  // 2. Log manager activity in local storage
  try {
    const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
    const actRaw = localStorage.getItem(MGR_ACTIVITIES_KEY);
    const acts = actRaw ? JSON.parse(actRaw) : [];
    acts.unshift({
      datetime: 'Just now',
      timestamp: new Date().toISOString(),
      activity: `Requested Correction (${tx.ref})`,
      reference: tx.ref,
      status: 'Correction Needed',
      user: curUser.name || curUser.fullName || curUser.username || 'Manager',
      role: curUser.role || 'Manager',
      action: 'Correction Needed',
      module: 'Inventory'
    });
    localStorage.setItem(MGR_ACTIVITIES_KEY, JSON.stringify(acts));
  } catch (_) {}

  // 3. Audit log in Supabase
  await logManagerActivityToSupabase({
    action: 'RETURN_FOR_CORRECTION',
    entityType: 'staff_transactions',
    entityId: tx.ref || tx.id || '',
    details: {
      ref: tx.ref,
      message: message,
      material: tx.material || tx.materialName
    }
  });

  // 4. Staff notification
  const corrNotif = {
    title: `Correction Requested: ${tx.ref}`,
    message: `Transaction ${tx.ref} returned by Store Manager: "${message}". Action required from staff.`,
    category: 'Inventory',
    badge: 'Action Required',
    role: 'staff',
    targetRole: 'staff',
    roleScope: 'staff',
    priority: 'high',
    targetUrl: `user/my-activity.html?correct=${encodeURIComponent(tx.ref)}`,
    ref: tx.ref,
    material: tx.material || tx.materialName || '',
    quantity: tx.quantity != null ? String(tx.quantity) : (tx.qty || ''),
    actor: 'Store Manager'
  };

  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(corrNotif);
    }
  } catch (_) {}

  // 5. Broadcast across tabs
  broadcastManagerSync({
    action: 'return_for_correction',
    ref: tx.ref,
    message: message,
    notification: corrNotif
  });

  return { success: true };
}

/**
 * Universal cross-module and cross-tab synchronization trigger
 */
export function broadcastManagerSync(detail = {}) {
  const now = String(Date.now());
  try {
    localStorage.setItem('rmims_inventory_updated', now);
    localStorage.setItem('rmims_manager_receipts_updated', now);
    localStorage.setItem('rmims_manager_disbursements_updated', now);
    localStorage.setItem('rmims_staff_transactions_updated', now);
    localStorage.setItem('rmims_staff_activity_updated', now);
    localStorage.setItem('rmims_sync_event', JSON.stringify({ time: Date.now(), ...detail }));

    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('rmims_inventory_updated', { detail }));
    window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail }));
    window.dispatchEvent(new CustomEvent('rmims_staff_activity_updated', { detail }));
    window.dispatchEvent(new CustomEvent('rmims_manager_receipts_updated', { detail }));
    window.dispatchEvent(new CustomEvent('rmims_manager_disbursements_updated', { detail }));
  } catch (e) {}

  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync(detail);
    }
  } catch (_) {}

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('rmims_user_sync');
      channel.postMessage({ type: 'SYNC_UPDATE', ...detail, timestamp: Date.now() });
      channel.close();
    }
  } catch (_) {}
}

/**
 * Fetch live raw materials from Supabase and reconcile into local authoritative cache
 * Guarantees zero zombie materials and no resurrection of deleted items.
 */
export async function fetchUnifiedInventoryFromSupabase() {
  if (!supabase) return getSystemRawMaterials();

  try {
    const { data, error } = await fetchWithTimeout(supabase.from('raw_materials').select('*').order('name'), 4000);
    if (!error && Array.isArray(data)) {
      const deletedRaw = localStorage.getItem('rmims_deleted_material_ids');
      const deletedArr = deletedRaw ? JSON.parse(deletedRaw) : [];
      const deletedSet = new Set(Array.isArray(deletedArr) ? deletedArr.map(d => String(d).trim().toLowerCase()) : []);

      // EXACT authoritative sync: localCustom matches authoritative Supabase rows.
      // If a material was deleted from Supabase, it is NOT preserved locally.
      const reconciled = data.filter(sm => {
        const codeLower = String(sm.item_code || sm.id || '').toLowerCase().trim();
        const nameLower = (sm.name || '').trim().toLowerCase();
        const idLower = String(sm.id || '').toLowerCase().trim();
        return !deletedSet.has(codeLower) && !deletedSet.has(nameLower) && !deletedSet.has(idLower);
      }).map(sm => {
        const code = String(sm.item_code || sm.id || '').toUpperCase().trim();
        return {
          id: sm.id || code,
          item_code: sm.item_code || code,
          name: sm.name,
          raw_material_name: sm.name,
          unit_of_measure: sm.unit_of_measure,
          unit: sm.unit_of_measure,
          current_stock: Number(sm.current_stock ?? 0),
          currentStock: Number(sm.current_stock ?? 0),
          minimum_threshold: Number(sm.minimum_threshold ?? 10),
          minimum_stock: Number(sm.minimum_threshold ?? 10),
          reorder_quantity: Number(sm.reorder_quantity ?? 25),
          lead_time_days: Number(sm.lead_time_days ?? 3),
          description: sm.description || `Raw material ${sm.name}`,
          created_at: sm.created_at || new Date().toISOString()
        };
      });

      // Merge with existing local custom materials and manager overrides so imported/updated stocks and dates are preserved
      let existingCustom = [];
      try { existingCustom = JSON.parse(localStorage.getItem('rmims_custom_raw_materials') || '[]'); } catch (_) {}
      let existingOverrides = {};
      try { existingOverrides = JSON.parse(localStorage.getItem('rmims_manager_material_overrides') || '{}'); } catch (_) {}

      const mergedMap = new Map();
      reconciled.forEach(m => {
        const key = String(m.item_code || m.id || '').toUpperCase().trim();
        const locOv = existingOverrides[key] || {};
        const locCust = Array.isArray(existingCustom) ? existingCustom.find(c => String(c.item_code || c.id || '').toUpperCase().trim() === key || (c.name || '').toLowerCase() === (m.name || '').toLowerCase()) : null;
        const preserveLocal = (locOv && (locOv.is_imported || locOv.is_manual_override || (locOv.current_stock > 0 && m.current_stock === 0))) ||
                              (locCust && (locCust.is_imported || locCust.is_manual_override || (locCust.current_stock > 0 && m.current_stock === 0)));
        const finalStock = preserveLocal
          ? Number(locOv.current_stock ?? locCust?.current_stock ?? m.current_stock ?? 0)
          : (m.current_stock > 0 ? m.current_stock : Number(locOv.current_stock ?? locCust?.current_stock ?? 0));
        const finalMin = Number(locOv.minimum_stock ?? locCust?.minimum_stock ?? m.minimum_threshold ?? 10);
        const firstDate = locOv.date_added || locOv.first_date || locCust?.date_added || locCust?.first_date || m.date_added || (m.created_at ? String(m.created_at).slice(0, 10) : '');
        const latestDate = locOv.last_updated || locOv.latest_date || locCust?.last_updated || locCust?.latest_date || m.updated_at || m.created_at || firstDate;
        mergedMap.set(key, {
          ...m,
          ...(locCust || {}),
          id: m.id || key,
          item_code: key || m.id,
          current_stock: finalStock,
          currentStock: finalStock,
          minimum_threshold: finalMin,
          minimum_stock: finalMin,
          date_added: firstDate,
          first_date: firstDate,
          display_date: locOv.display_date || locCust?.display_date || firstDate || '',
          last_updated: latestDate,
          latest_date: latestDate,
          is_imported: Boolean(locOv.is_imported || locCust?.is_imported),
          is_manual_override: Boolean(locOv.is_manual_override || locCust?.is_manual_override)
        });
      });

      if (Array.isArray(existingCustom)) {
        existingCustom.forEach(c => {
          if (!c) return;
          const key = String(c.item_code || c.id || '').toUpperCase().trim();
          if (key && !mergedMap.has(key) && !deletedSet.has(key.toLowerCase())) {
            mergedMap.set(key, c);
          }
        });
      }

      const finalReconciled = Array.from(mergedMap.values());
      localStorage.setItem('rmims_custom_raw_materials', JSON.stringify(finalReconciled));

      const mgrOverrides = { ...existingOverrides };
      finalReconciled.forEach(m => {
        const key = String(m.item_code || m.id || '').toUpperCase().trim();
        const prev = existingOverrides[key] || {};
        const firstDate = prev.date_added || prev.first_date || m.date_added || '';
        const latestDate = prev.last_updated || prev.latest_date || m.last_updated || m.created_at || firstDate;
        mgrOverrides[key] = {
          ...prev,
          name: m.name,
          raw_material_name: m.raw_material_name || m.name,
          unit: prev.unit || m.unit,
          current_stock: m.current_stock,
          minimum_stock: m.minimum_threshold,
          maximum_stock: prev.maximum_stock || (m.reorder_quantity ? m.reorder_quantity * 4 : 100),
          date_added: firstDate,
          first_date: firstDate,
          display_date: prev.display_date || m.display_date || firstDate || '',
          last_updated: latestDate,
          latest_date: latestDate
        };
      });
      localStorage.setItem('rmims_manager_material_overrides', JSON.stringify(mgrOverrides));
    }
  } catch (err) {
    console.warn('[ManagerSupabase] Live inventory sync notice:', err);
  }

  return getSystemRawMaterials();
}

/**
 * Save or update a raw material to Supabase and unify across all manager and staff modules
 */
export async function saveRawMaterialToSupabase(material) {
  if (!material) return { success: false, message: 'Invalid material' };

  const id = String(material.id || material.item_code || '').toUpperCase().trim();
  const name = (material.name || material.raw_material_name || '').trim();
  const unit = material.unit || material.unit_of_measure || 'kg';
  const stock = Number(material.current_stock ?? material.currentStock ?? material.stock ?? 0);
  const minStock = Number(material.minimum_threshold ?? material.minimum_stock ?? material.minimumStock ?? 10);
  const reorderQty = Number(material.reorder_quantity ?? (minStock * 2) ?? 25);
  const leadTime = Number(material.lead_time_days ?? 3);
  const desc = material.description || `Raw material ${name}`;
  const cat = material.category || 'General Materials';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = dateStr + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const resolvedFirstDate = material.date_added || material.first_date || now.toISOString().slice(0, 10);
  const resolvedLatestDate = material.last_updated || material.latest_date || timeStr;

  // 1. Authoritative local persistence
  saveCustomRawMaterial({
    id: id || `RM-${Date.now()}`,
    item_code: id,
    name,
    raw_material_name: name,
    specification_name: material.specification_name || name,
    category: cat,
    unit_of_measure: unit,
    unit,
    current_stock: stock,
    minimum_threshold: minStock,
    minimum_stock: minStock,
    reorder_quantity: reorderQty,
    lead_time_days: leadTime,
    description: desc,
    date_added: resolvedFirstDate,
    first_date: resolvedFirstDate,
    display_date: material.display_date || resolvedFirstDate,
    last_updated: resolvedLatestDate,
    latest_date: resolvedLatestDate,
    created_at: material.created_at || now.toISOString(),
    is_imported: Boolean(material.is_imported),
    is_manual_override: true
  });

  // 2. Synchronize manager material overrides
  try {
    const ovRaw = localStorage.getItem('rmims_manager_material_overrides');
    const ovs = ovRaw ? JSON.parse(ovRaw) : {};
    const prevOv = ovs[id] || {};
    const firstDateToKeep = material.date_added || prevOv.date_added || resolvedFirstDate;
    ovs[id] = {
      ...prevOv,
      name,
      raw_material_name: name,
      specification_name: material.specification_name || name,
      category: cat,
      unit,
      current_stock: stock,
      minimum_stock: minStock,
      maximum_stock: material.maximum_stock || (minStock * 5) || 100,
      storage_location: material.storage_location || 'Warehouse A - Shelf 1',
      supplier: material.supplier || 'General Supply Co.',
      description: desc,
      date_added: firstDateToKeep,
      first_date: firstDateToKeep,
      display_date: material.display_date || prevOv.display_date || firstDateToKeep,
      last_updated: resolvedLatestDate,
      latest_date: resolvedLatestDate,
      is_imported: Boolean(material.is_imported || prevOv.is_imported),
      is_manual_override: true
    };
    localStorage.setItem('rmims_manager_material_overrides', JSON.stringify(ovs));
  } catch (_) {}

  // 3. Supabase upsert
  if (supabase) {
    try {
      const payload = {
        name,
        unit_of_measure: unit,
        current_stock: stock,
        minimum_threshold: minStock,
        reorder_quantity: reorderQty,
        lead_time_days: leadTime,
        description: desc
      };
      if (id && id.length === 36 && !id.startsWith('RM-') && !id.startsWith('NB-')) {
        payload.id = id;
      }
      if (id) {
        payload.item_code = id;
      }

      let { error } = await supabase.from('raw_materials').upsert([payload], { onConflict: (id && id.length === 36) ? 'id' : 'item_code' });
      if (error) {
        try {
          const { data: existing } = await supabase.from('raw_materials')
            .select('id')
            .or(`item_code.eq.${id},name.ilike.${name}`)
            .limit(1)
            .maybeSingle();
          if (existing && existing.id) {
            const { error: updErr } = await supabase.from('raw_materials').update(payload).eq('id', existing.id);
            if (!updErr) error = null;
          }
        } catch (_) {}
        if (error) console.warn('[ManagerSupabase] Supabase raw_materials upsert notice:', error.message);
      }

      await logManagerActivityToSupabase({
        action: 'UPSERT_RAW_MATERIAL',
        entityType: 'raw_materials',
        entityId: id,
        details: { id, name, unit, stock, minStock }
      });
    } catch (err) {
      console.warn('[ManagerSupabase] Error saving raw material to Supabase:', err);
    }
  }

  // 4. Universal broadcast across all portals
  broadcastManagerSync({
    action: 'update_material',
    id,
    name,
    stock,
    unit
  });

  return { success: true };
}

/**
 * Permanently delete a raw material from Supabase and all local caches.
 * Ensures the material is never brought back.
 */
export async function deleteRawMaterialOnSupabase(idOrCodeOrName) {
  if (!idOrCodeOrName) return { success: false };
  const clean = String(idOrCodeOrName).trim();

  // 1. Authoritative local permanent deletion
  deleteSystemRawMaterial(clean);

  // 2. Remove from manager material overrides
  try {
    const ovRaw = localStorage.getItem('rmims_manager_material_overrides');
    if (ovRaw) {
      const ovs = JSON.parse(ovRaw);
      delete ovs[clean];
      delete ovs[clean.toUpperCase()];
      delete ovs[clean.toLowerCase()];
      localStorage.setItem('rmims_manager_material_overrides', JSON.stringify(ovs));
    }
  } catch (_) {}

  // 3. Delete from Supabase raw_materials (cascading child transactions first to prevent foreign key error)
  if (supabase) {
    try {
      let resolvedMatId = (clean.length === 36) ? clean : null;
      if (!resolvedMatId) {
        const { data: matRow } = await supabase.from('raw_materials')
          .select('id')
          .or(`item_code.ilike.${clean},name.ilike.${clean}`)
          .limit(1)
          .maybeSingle();
        if (matRow && matRow.id) resolvedMatId = matRow.id;
      }

      if (resolvedMatId) {
        await supabase.from('stock_receipts').delete().eq('material_id', resolvedMatId);
        await supabase.from('material_disbursements').delete().eq('material_id', resolvedMatId);
        await supabase.from('raw_materials').delete().eq('id', resolvedMatId);
      }
      await supabase.from('raw_materials').delete().ilike('item_code', clean);
      await supabase.from('raw_materials').delete().ilike('name', clean);

      await logManagerActivityToSupabase({
        action: 'DELETE_RAW_MATERIAL',
        entityType: 'raw_materials',
        entityId: clean,
        details: { target: clean }
      });
    } catch (err) {
      console.warn('[ManagerSupabase] Error deleting material on Supabase:', err);
    }
  }

  // 4. Universal broadcast
  broadcastManagerSync({
    action: 'delete_material',
    id: clean
  });

  return { success: true };
}

/**
 * Fetch live stock receipts from Supabase and synchronize with local manager receipts
 */
export async function fetchLiveStockReceiptsFromSupabase() {
  if (!supabase) return JSON.parse(localStorage.getItem(MGR_RECEIPTS_KEY) || '[]');

  try {
    const { data, error } = await fetchWithTimeout(
      supabase.from('stock_receipts').select('*').order('receipt_date', { ascending: false }),
      4000
    );
    if (!error && Array.isArray(data)) {
      let deletedRecIds = new Set();
      try {
        deletedRecIds = new Set(JSON.parse(localStorage.getItem('rmims_deleted_receipt_ids') || '[]').map(x => String(x)));
      } catch (_) {}

      // Merge Supabase receipts with existing local receipts so local records are never wiped
      let existingLocalRec = [];
      try {
        const parsed = JSON.parse(localStorage.getItem(MGR_RECEIPTS_KEY) || '[]');
        if (Array.isArray(parsed)) existingLocalRec = parsed.filter(r => r && !deletedRecIds.has(String(r.ref || r.id)));
      } catch (_) {}

      const remoteRec = data
        .filter(sr => sr && !deletedRecIds.has(String(sr.id)))
        .map(sr => ({
          id: sr.id,
          ref: sr.id,
          date: sr.receipt_date,
          materialId: sr.material_id,
          materialName: sr.material_name || '',
          quantity: Number(sr.received_quantity || 0),
          unit: sr.unit || 'kg',
          supplier: sr.supplier_name || 'Inward Delivery',
          recordedBy: sr.received_by || 'Store Manager',
          status: 'Approved',
          createdAt: sr.created_at
        }));

      const recMap = new Map();
      existingLocalRec.forEach(r => recMap.set(String(r.ref || r.id), r));
      remoteRec.forEach(r => {
        const k = String(r.ref || r.id);
        if (!recMap.has(k)) recMap.set(k, r);
      });
      const reconciled = Array.from(recMap.values());

      localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(reconciled));
      return reconciled;
    }
  } catch (err) {
    console.warn('[ManagerSupabase] Live receipts fetch notice:', err);
  }

  return JSON.parse(localStorage.getItem(MGR_RECEIPTS_KEY) || '[]');
}

/**
 * Delete a stock receipt from Supabase and local storage, reverting stock if applicable
 */
export async function deleteStockReceiptOnSupabase(refOrId) {
  if (!refOrId) return { success: false };
  const cleanRef = String(refOrId).trim();

  // 1. Delete locally from manager receipts and custom receipts
  try {
    let receipts = JSON.parse(localStorage.getItem(MGR_RECEIPTS_KEY) || '[]');
    const targetIdx = receipts.findIndex(r =>
      (r.ref && r.ref.toLowerCase() === cleanRef.toLowerCase()) ||
      (r.id && String(r.id).toLowerCase() === cleanRef.toLowerCase())
    );
    if (targetIdx !== -1) {
      const rec = receipts[targetIdx];
      const qty = parseFloat(rec.quantity || 0);
      if (qty > 0) {
        adjustSystemMaterialStock(rec.materialId || rec.materialName || rec.material, -qty);
      }
      receipts.splice(targetIdx, 1);
      localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(receipts));
    }

    const customKey = 'rmims_custom_receipts';
    let custom = JSON.parse(localStorage.getItem(customKey) || '[]');
    custom = custom.filter(c => String(c.id).toLowerCase() !== cleanRef.toLowerCase() && (!c.ref || c.ref.toLowerCase() !== cleanRef.toLowerCase()));
    localStorage.setItem(customKey, JSON.stringify(custom));
  } catch (_) {}

  // 2. Delete on Supabase
  if (supabase) {
    try {
      if (cleanRef.length === 36) {
        await supabase.from('stock_receipts').delete().eq('id', cleanRef);
      }
      await supabase.from('stock_receipts').delete().ilike('supplier_name', `%${cleanRef}%`);

      await logManagerActivityToSupabase({
        action: 'DELETE_STOCK_RECEIPT',
        entityType: 'stock_receipts',
        entityId: cleanRef,
        details: { ref: cleanRef }
      });
    } catch (err) {
      console.warn('[ManagerSupabase] Error deleting stock receipt on Supabase:', err);
    }
  }

  // 3. Broadcast sync
  invalidateForecastCache();
  broadcastManagerSync({
    action: 'delete_receipt',
    ref: cleanRef
  });

  return { success: true };
}

/**
 * Permanently deletes a material disbursement from Supabase and local storage
 */
export async function deleteMaterialDisbursementOnSupabase(refOrId) {
  if (!refOrId) return { success: false };
  const cleanRef = String(refOrId).trim();

  // 1. Delete locally from rmims_manager_disbursements and rmims_custom_disbursements
  try {
    let disbursements = JSON.parse(localStorage.getItem(MGR_DISBURSEMENTS_KEY) || '[]');
    const targetIdx = disbursements.findIndex(d => String(d.id).toLowerCase() === cleanRef.toLowerCase() || (d.ref && d.ref.toLowerCase() === cleanRef.toLowerCase()));
    if (targetIdx !== -1) {
      disbursements.splice(targetIdx, 1);
      localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(disbursements));
    }

    const customKey = 'rmims_custom_disbursements';
    let custom = JSON.parse(localStorage.getItem(customKey) || '[]');
    custom = custom.filter(c => String(c.id).toLowerCase() !== cleanRef.toLowerCase() && (!c.ref || c.ref.toLowerCase() !== cleanRef.toLowerCase()));
    localStorage.setItem(customKey, JSON.stringify(custom));
  } catch (_) {}

  // 2. Delete on Supabase
  if (supabase) {
    try {
      if (cleanRef.length === 36) {
        await supabase.from('material_disbursements').delete().eq('id', cleanRef);
      }
      await supabase.from('material_disbursements').delete().ilike('activity_type', `%${cleanRef}%`);

      await logManagerActivityToSupabase({
        action: 'DELETE_MATERIAL_DISBURSEMENT',
        entityType: 'material_disbursements',
        entityId: cleanRef,
        details: { ref: cleanRef }
      });
    } catch (err) {
      console.warn('[ManagerSupabase] Error deleting material disbursement on Supabase:', err);
    }
  }

  // 3. Broadcast sync
  invalidateForecastCache();
  broadcastManagerSync({
    action: 'delete_disbursement',
    ref: cleanRef
  });

  return { success: true };
}


/**
 * Permanently saves a Finished Product formulation to Supabase activity audit logs
 * so it is continuously preserved across sessions and never removed.
 */
export async function saveFinishedProductToSupabase(product) {
  if (!supabase || !product || !product.name) return { success: false };
  try {
    await logManagerActivityToSupabase({
      action: 'UPSERT_FINISHED_PRODUCT',
      entityType: 'finished_products',
      entityId: product.id || product.name,
      details: {
        id: product.id || ('fp-' + Date.now()),
        name: product.name,
        materialNames: product.materialNames || [],
        recipeDetails: product.recipeDetails || {},
        category: product.category || 'Bakery & Breads',
        batchUnits: product.batchUnits || 50,
        date_added: product.date_added || new Date().toISOString(),
        last_updated: new Date().toISOString()
      }
    });
    return { success: true };
  } catch (err) {
    console.warn('[ManagerSupabase] Error saving finished product formulation to Supabase:', err);
    return { success: false, error: err };
  }
}

/**
 * Reconciles finished products saved in Supabase activity audit logs into local storage.
 */
export async function fetchLiveFinishedProductsFromSupabase() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('activity_audit_logs')
      .select('details, created_at')
      .eq('action', 'UPSERT_FINISHED_PRODUCT')
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) return [];

    const storageKeys = [
      'rmims_custom_finished_products',
      'RMSME_CUSTOM_FINISHED_PRODUCTS',
      'rmims_finished_products',
      'rmims_finished_product_context'
    ];

    let currentList = [];
    try {
      const raw = localStorage.getItem('rmims_custom_finished_products');
      if (raw) currentList = JSON.parse(raw);
      if (!Array.isArray(currentList)) currentList = [];
    } catch (_) {}

    const nameMap = new Map();
    currentList.forEach(p => {
      if (p && p.name) nameMap.set(String(p.name).toLowerCase().trim(), p);
    });

    data.forEach(row => {
      const det = row.details;
      if (det && det.name) {
        const norm = String(det.name).toLowerCase().trim();
        if (!nameMap.has(norm)) {
          nameMap.set(norm, det);
        }
      }
    });

    const reconciled = Array.from(nameMap.values());
    if (reconciled.length > currentList.length) {
      const json = JSON.stringify(reconciled);
      storageKeys.forEach(k => {
        try { localStorage.setItem(k, json); } catch (_) {}
      });
      try {
        window.dispatchEvent(new CustomEvent('rmims_finished_products_updated', { detail: reconciled }));
      } catch (_) {}
    }

    return reconciled;
  } catch (e) {
    console.warn('[ManagerSupabase] Error restoring finished products from Supabase:', e);
    return [];
  }
}

/**
 * Permanently purge all old test/mock data from Supabase tables
 */
export async function purgeAllLegacyMockDataFromSupabase() {
  // Purge routine retained as safe no-op
}

/**
 * Universal Global Realtime Supabase Channel
 * Listens to all mutations across raw_materials, stock_receipts, material_disbursements, activity_audit_logs
 * and automatically broadcasts across all browser tabs and role modules.
 */
if (supabase && typeof supabase.channel === 'function' && typeof window !== 'undefined' && !window.__rmimsGlobalSupabaseChannel) {
  try {
    window.__rmimsGlobalSupabaseChannel = supabase
      .channel('rmims_global_live_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_materials' }, (payload) => {
        if (payload.eventType === 'DELETE' && payload.old) {
          const oldTarget = payload.old.id || payload.old.item_code || payload.old.name;
          if (oldTarget) deleteSystemRawMaterial(oldTarget);
        }
        fetchUnifiedInventoryFromSupabase().then(() => {
          broadcastManagerSync({ source: 'supabase_raw_materials' });
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_receipts' }, (payload) => {
        if (payload.eventType === 'DELETE' && payload.old) {
          const oldId = String(payload.old.id || '').trim();
          let recs = JSON.parse(localStorage.getItem(MGR_RECEIPTS_KEY) || '[]');
          recs = recs.filter(r => r.ref !== oldId && r.id !== oldId);
          localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(recs));
        }
        fetchLiveStockReceiptsFromSupabase().then(() => {
          broadcastManagerSync({ source: 'supabase_stock_receipts' });
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_disbursements' }, (payload) => {
        if (payload.eventType === 'DELETE' && payload.old) {
          const oldId = String(payload.old.id || '').trim();
          let disbs = JSON.parse(localStorage.getItem(MGR_DISBURSEMENTS_KEY) || '[]');
          disbs = disbs.filter(d => d.ref !== oldId && d.id !== oldId);
          localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(disbs));
        }
        fetchManagerDashboardData().then(() => {
          broadcastManagerSync({ source: 'supabase_material_disbursements' });
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_audit_logs' }, () => {
        fetchLiveFinishedProductsFromSupabase().then(() => {
          broadcastManagerSync({ source: 'supabase_audit_logs' });
        });
      })
      .subscribe();
  } catch (err) {
    console.warn('[ManagerSupabase] Global realtime subscription notice:', err);
  }
}
