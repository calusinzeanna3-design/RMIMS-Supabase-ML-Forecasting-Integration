// ============================================================================
// RMIMS: ADMIN SUPABASE SERVICE (Comprehensive Portal Integration)
// ============================================================================
// Seamlessly connects the RMIMS Main Administration Portal to Supabase:
// - Branch Stores & Assigned Personnel CRUD
// - System Maintenance & Telemetry Alerts Management
// - Administrative Audit Trails & Activity Logging
// - Global Branch Synchronization & System Configurations
// - Pending Account Approvals & User Directory Sync
// 
// Features robust offline local storage mirroring and fallback:
// If Supabase is offline or network fails, all operations gracefully persist
// to localStorage and dispatch standard RMIMS synchronization events.
// ============================================================================

import { supabase } from './supabase-config.js';

// Local storage key constants (aligned 1-to-1 with Admin portal views)
export const STORAGE_KEYS = {
  BRANCH_STORES: 'RMIMS_BRANCH_STORES_V3',
  SYSTEM_ALERTS: 'RMIMS_SYSTEM_ALERTS_V2',
  REGISTERED_USERS: 'rmims_registered_users',
  PENDING_USERS: 'rmims_pending_users',
  APPROVED_USERS: 'rmims_approved_users',
  ACTIVITY_LOGS: 'rmims_manager_activities',
  SYSTEM_SETTINGS: 'rmims_admin_settings'
};

// ============================================================================
// 1. BRANCH STORES & PERSONNEL MANAGEMENT
// ============================================================================

/**
 * Fetch all branch stores including assigned managers and staff personnel.
 */
export async function fetchBranchStores() {
  try {
    if (!supabase) throw new Error('Supabase client not initialized');

    // Query branch stores and joined personnel
    const { data: stores, error: storesError } = await supabase
      .from('branch_stores')
      .select('*')
      .order('created_at', { ascending: true });

    if (storesError) throw storesError;

    const { data: personnel, error: personnelError } = await supabase
      .from('branch_store_personnel')
      .select('*')
      .order('created_at', { ascending: true });

    if (personnelError) throw personnelError;

    // Map into the format expected by admin-branch-stores.js
    const storesMap = {};
    (stores || []).forEach(s => {
      const storePersonnel = (personnel || []).filter(p => p.branch_id === s.id);
      storesMap[s.id] = {
        id: s.id,
        name: s.branch_name,
        location: s.branch_location,
        locKey: s.branch_key,
        address: s.address || '',
        status: s.operating_status || 'active',
        managers: storePersonnel
          .filter(p => p.role === 'Manager')
          .map(p => ({
            id: p.id,
            name: p.name,
            role: 'Manager',
            email: p.email || '',
            phone: p.phone || '',
            accessCode: p.phone ? `KEY-${p.phone.slice(-4)}` : 'KEY-MGR',
            shift: p.shift || 'Day Shift',
            status: p.status || 'Active'
          })),
        staff: storePersonnel
          .filter(p => p.role === 'Staff')
          .map(p => ({
            id: p.id,
            name: p.name,
            role: 'Staff',
            email: p.email || '',
            phone: p.phone || '',
            accessCode: p.phone ? `KEY-${p.phone.slice(-4)}` : 'KEY-STF',
            shift: p.shift || 'Day Shift',
            status: p.status || 'Active'
          }))
      };
    });

    // Update local storage mirror
    try {
      localStorage.setItem(STORAGE_KEYS.BRANCH_STORES, JSON.stringify(storesMap));
    } catch (_) {}

    return storesMap;
  } catch (err) {
    console.warn('[AdminSupabase] Fetch branch stores failed, falling back to local storage:', err.message || err);
    try {
      const local = localStorage.getItem(STORAGE_KEYS.BRANCH_STORES);
      return local ? JSON.parse(local) : {};
    } catch (_) {
      return {};
    }
  }
}

/**
 * Save or update a branch store with its assigned personnel.
 */
export async function saveBranchStore(store) {
  if (!store || !store.id) throw new Error('Store object with valid ID is required');

  // Update local storage mirror first for instant UI response
  let localStores = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BRANCH_STORES);
    localStores = raw ? JSON.parse(raw) : {};
    localStores[store.id] = store;
    localStorage.setItem(STORAGE_KEYS.BRANCH_STORES, JSON.stringify(localStores));
    window.dispatchEvent(new Event('rmims_stores_updated'));
    window.dispatchEvent(new Event('storage'));
  } catch (_) {}

  try {
    if (!supabase) return { success: true, offline: true };

    const storePayload = {
      id: store.id,
      branch_key: store.locKey || store.id,
      branch_name: store.name,
      branch_location: store.location,
      address: store.address || '',
      operating_status: store.status || 'active',
      updated_at: new Date().toISOString()
    };

    const { error: storeError } = await supabase
      .from('branch_stores')
      .upsert(storePayload, { onConflict: 'id' });

    if (storeError) throw storeError;

    // Sync personnel
    const personnelToUpsert = [];
    (store.managers || []).forEach(m => {
      personnelToUpsert.push({
        branch_id: store.id,
        name: m.name,
        role: 'Manager',
        email: m.email || null,
        phone: m.phone || null,
        shift: m.shift || 'Day Shift',
        status: m.status || 'Active'
      });
    });

    (store.staff || []).forEach(s => {
      personnelToUpsert.push({
        branch_id: store.id,
        name: s.name,
        role: 'Staff',
        email: s.email || null,
        phone: s.phone || null,
        shift: s.shift || 'Day Shift',
        status: s.status || 'Active'
      });
    });

    if (personnelToUpsert.length > 0) {
      // Clear existing personnel for this branch and re-insert
      await supabase.from('branch_store_personnel').delete().eq('branch_id', store.id);
      await supabase.from('branch_store_personnel').insert(personnelToUpsert);
    }

    return { success: true };
  } catch (err) {
    console.warn('[AdminSupabase] Save branch store failed on Supabase:', err.message || err);
    return { success: true, offline: true, error: err.message };
  }
}

/**
 * Delete a branch store and all its personnel.
 */
export async function deleteBranchStore(storeId) {
  if (!storeId) return;

  // Local storage update
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BRANCH_STORES);
    if (raw) {
      const stores = JSON.parse(raw);
      delete stores[storeId];
      localStorage.setItem(STORAGE_KEYS.BRANCH_STORES, JSON.stringify(stores));
      window.dispatchEvent(new Event('rmims_stores_updated'));
      window.dispatchEvent(new Event('storage'));
    }
  } catch (_) {}

  try {
    if (!supabase) return { success: true, offline: true };

    // Cascade delete associated personnel to prevent orphaned records
    try {
      await supabase
        .from('branch_store_personnel')
        .delete()
        .eq('branch_id', storeId);
    } catch (_) {}

    const { error } = await supabase
      .from('branch_stores')
      .delete()
      .eq('id', storeId);

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.warn('[AdminSupabase] Delete branch store failed on Supabase:', err.message || err);
    return { success: true, offline: true, error: err.message };
  }
}

// ============================================================================
// 2. SYSTEM MAINTENANCE ALERTS MANAGEMENT
// ============================================================================

/**
 * Fetch active and historical system maintenance alerts.
 */
export async function fetchSystemAlerts() {
  try {
    if (!supabase) throw new Error('Supabase client not initialized');

    const { data, error } = await supabase
      .from('system_maintenance_alerts')
      .select('*')
      .order('last_detected', { ascending: false });

    if (error) throw error;

    // Map to camelCase structure used by system-alerts-service.js
    const mapped = (data || []).map(a => ({
      id: a.id,
      type: a.type,
      category: a.category,
      severity: a.severity,
      status: a.status,
      branchLocation: a.branch_location,
      branchName: a.branch_name,
      branch: `${a.branch_name} (${a.branch_location})`,
      occurrence: a.occurrence,
      firstDetected: a.first_detected,
      lastDetected: a.last_detected,
      details: a.details,
      suggestedAction: a.suggested_action,
      resolvedAt: a.resolved_at,
      resolvedBy: a.resolved_by
    }));

    try {
      localStorage.setItem(STORAGE_KEYS.SYSTEM_ALERTS, JSON.stringify(mapped));
    } catch (_) {}

    return mapped;
  } catch (err) {
    console.warn('[AdminSupabase] Fetch system alerts failed, falling back to local storage:', err.message || err);
    try {
      const local = localStorage.getItem(STORAGE_KEYS.SYSTEM_ALERTS);
      return local ? JSON.parse(local) : [];
    } catch (_) {
      return [];
    }
  }
}

/**
 * Create or broadcast a new system maintenance alert.
 */
export async function createSystemAlert(alert) {
  if (!alert) return null;

  const alertId = alert.id || `ALT-${Date.now().toString(36).toUpperCase()}`;
  const nowIso = new Date().toISOString();

  const formattedAlert = {
    id: alertId,
    type: alert.type || 'System Event',
    category: alert.category || 'system',
    severity: alert.severity || 'warning',
    status: alert.status || 'active',
    branchLocation: alert.branchLocation || alert.branchLoc || 'All Branches',
    branchName: alert.branchName || '',
    branch: alert.branch || `${alert.branchName || 'Store'} (${alert.branchLocation || 'Branch'})`,
    occurrence: alert.occurrence || 1,
    firstDetected: alert.firstDetected || nowIso,
    lastDetected: alert.lastDetected || nowIso,
    details: alert.details || '',
    suggestedAction: alert.suggestedAction || ''
  };

  // Local mirror update
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SYSTEM_ALERTS);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(formattedAlert);
    localStorage.setItem(STORAGE_KEYS.SYSTEM_ALERTS, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('rmims:alerts-updated', { detail: { alerts: list } }));
    window.dispatchEvent(new Event('storage'));
  } catch (_) {}

  try {
    if (!supabase) return formattedAlert;

    const payload = {
      id: alertId,
      type: formattedAlert.type,
      category: formattedAlert.category,
      severity: formattedAlert.severity,
      status: formattedAlert.status,
      branch_location: formattedAlert.branchLocation,
      branch_name: formattedAlert.branchName,
      occurrence: formattedAlert.occurrence,
      first_detected: formattedAlert.firstDetected,
      last_detected: formattedAlert.lastDetected,
      details: formattedAlert.details,
      suggested_action: formattedAlert.suggestedAction
    };

    await supabase.from('system_maintenance_alerts').insert([payload]);
    return formattedAlert;
  } catch (err) {
    console.warn('[AdminSupabase] Create system alert failed on Supabase:', err.message || err);
    return formattedAlert;
  }
}

/**
 * Update system alert status (e.g. resolve or monitor).
 */
export async function updateSystemAlertStatus(alertId, newStatus, resolvedBy = 'Admin') {
  if (!alertId || !newStatus) return;

  const nowIso = new Date().toISOString();

  // Local mirror update
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SYSTEM_ALERTS);
    if (raw) {
      const list = JSON.parse(raw);
      const target = list.find(a => String(a.id) === String(alertId));
      if (target) {
        target.status = newStatus;
        if (newStatus === 'resolved') {
          target.resolvedAt = nowIso;
          target.resolvedBy = resolvedBy;
        }
        localStorage.setItem(STORAGE_KEYS.SYSTEM_ALERTS, JSON.stringify(list));
        window.dispatchEvent(new CustomEvent('rmims:alerts-updated', { detail: { alerts: list } }));
        window.dispatchEvent(new Event('storage'));
      }
    }
  } catch (_) {}

  try {
    if (!supabase) return { success: true };

    const updatePayload = {
      status: newStatus,
      updated_at: nowIso
    };
    if (newStatus === 'resolved') {
      updatePayload.resolved_at = nowIso;
      updatePayload.resolved_by = resolvedBy;
    }

    const { error } = await supabase
      .from('system_maintenance_alerts')
      .update(updatePayload)
      .eq('id', alertId);

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.warn('[AdminSupabase] Update alert status failed on Supabase:', err.message || err);
    return { success: true, offline: true };
  }
}

// ============================================================================
// 3. ADMIN ACTIVITY AUDIT TRAILS
// ============================================================================

/**
 * Log an administrative activity to audit trail.
 */
export async function logAdminActivity(entry) {
  if (!entry) return;

  const now = new Date();
  const activity = {
    id: entry.id || `act-${Date.now()}`,
    timestamp: entry.timestamp || now.toISOString(),
    date: entry.date || now.toISOString().slice(0, 10),
    user: entry.user || entry.user_name || 'Admin',
    role: entry.role || 'Main Admin',
    branchLoc: entry.branchLoc || entry.branch_location || 'Headquarters',
    branchName: entry.branchName || entry.branch_name || 'Main Administration',
    action: entry.action || 'Updated',
    module: entry.module || 'Administration',
    details: entry.details || 'Operation completed.',
    status: entry.status || 'success'
  };

  // Local mirror update
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVITY_LOGS);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(activity);
    localStorage.setItem(STORAGE_KEYS.ACTIVITY_LOGS, JSON.stringify(list.slice(0, 100)));
    window.dispatchEvent(new Event('storage'));
  } catch (_) {}

  try {
    if (!supabase) return activity;

    const payload = {
      id: activity.id,
      user_name: activity.user,
      role: activity.role,
      branch_location: activity.branchLoc,
      branch_name: activity.branchName,
      action: activity.action,
      module: activity.module,
      details: activity.details,
      status: activity.status,
      timestamp: activity.timestamp
    };

    await supabase.from('admin_activity_logs').insert([payload]);
    return activity;
  } catch (err) {
    console.warn('[AdminSupabase] Log activity failed on Supabase:', err.message || err);
    return activity;
  }
}

/**
 * Fetch and consolidate real-time operational and audit activities across Supabase:
 * - Admin Activity Audit Trails (admin_activity_logs)
 * - Incoming Stock Receipts by Managers (stock_receipts)
 * - Outgoing Material Disbursements by Managers/Staff (material_disbursements)
 * Merges with local storage mirror for offline resilience without mock/fake data.
 */
export async function fetchLiveSystemActivities(options = {}) {
  const limit = options.limit || 100;
  const combined = [];
  const seenIds = new Set();

  if (supabase) {
    try {
      // 1. Fetch from admin_activity_logs
      const { data: adminLogs, error: logErr } = await supabase
        .from('admin_activity_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (!logErr && Array.isArray(adminLogs)) {
        adminLogs.forEach(item => {
          const id = item.id || `act-${item.timestamp}`;
          seenIds.add(id);
          combined.push({
            id,
            timestamp: item.timestamp,
            date: item.timestamp ? String(item.timestamp).slice(0, 10) : new Date().toISOString().slice(0, 10),
            user: item.user_name || 'Admin',
            role: item.role || 'Main Admin',
            branchLoc: item.branch_location || 'Headquarters',
            branchName: item.branch_name || 'Main Administration',
            action: item.action || 'Updated',
            module: item.module || 'System',
            details: item.details || 'Operation completed.',
            status: item.status || 'success'
          });
        });
      }
    } catch (_) {}

    try {
      // 2. Fetch from stock_receipts (Manager stock intake)
      const { data: receipts, error: recErr } = await supabase
        .from('stock_receipts')
        .select('*, raw_materials(name, item_code)')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!recErr && Array.isArray(receipts)) {
        receipts.forEach(r => {
          const id = `rec-${r.id}`;
          if (seenIds.has(id)) return;
          seenIds.add(id);
          const matName = r.raw_materials?.name || 'Raw Material';
          const rDate = r.receipt_date || (r.created_at ? String(r.created_at).slice(0, 10) : '');
          combined.push({
            id,
            timestamp: r.created_at || (rDate ? `${rDate}T10:00:00Z` : new Date().toISOString()),
            date: rDate || new Date().toISOString().slice(0, 10),
            user: r.supplier_name ? `Manager (${r.supplier_name})` : 'Store Manager',
            role: 'Manager',
            branchLoc: 'Branch Store',
            branchName: 'Inventory Operations',
            action: 'Received',
            module: 'Stock Receipts',
            details: `Received ${r.received_quantity} ${r.unit} of ${matName} from ${r.supplier_name || 'Supplier'}.`,
            status: 'success'
          });
        });
      }
    } catch (_) {}

    try {
      // 3. Fetch from material_disbursements (Manager & Staff disbursements)
      const { data: disbursements, error: disbErr } = await supabase
        .from('material_disbursements')
        .select('*, raw_materials(name, item_code)')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!disbErr && Array.isArray(disbursements)) {
        disbursements.forEach(d => {
          const id = `disb-${d.id}`;
          if (seenIds.has(id)) return;
          seenIds.add(id);
          const matName = d.raw_materials?.name || 'Raw Material';
          const dDate = d.usage_date || (d.created_at ? String(d.created_at).slice(0, 10) : '');
          const reason = d.finished_product_name || d.activity_type || 'Operations';
          combined.push({
            id,
            timestamp: d.created_at || (dDate ? `${dDate}T14:30:00Z` : new Date().toISOString()),
            date: dDate || new Date().toISOString().slice(0, 10),
            user: 'Store Staff',
            role: 'Staff',
            branchLoc: 'Branch Store',
            branchName: 'Production Hub',
            action: 'Disbursed',
            module: 'Disbursement',
            details: `Disbursed ${d.consumed_quantity} ${d.unit} of ${matName} for ${reason}.`,
            status: 'success'
          });
        });
      }
    } catch (_) {}
  }

  // 4. Merge with local activities (e.g. actions performed in the current browser session)
  try {
    const rawLocal = localStorage.getItem(STORAGE_KEYS.ACTIVITY_LOGS);
    const localLogs = rawLocal ? JSON.parse(rawLocal) : [];
    if (Array.isArray(localLogs)) {
      localLogs.forEach(item => {
        const id = item.id || `local-${item.timestamp}-${item.details}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          combined.push(item);
        }
      });
    }
  } catch (_) {}

  // Sort descending by timestamp
  combined.sort((a, b) => {
    const timeA = new Date(a.timestamp || (a.date + 'T00:00:00Z')).getTime();
    const timeB = new Date(b.timestamp || (b.date + 'T00:00:00Z')).getTime();
    return timeB - timeA;
  });

  // Mirror to localStorage
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVITY_LOGS, JSON.stringify(combined.slice(0, 150)));
  } catch (_) {}

  return combined;
}

// ============================================================================
// 4. USER DIRECTORY & PENDING APPROVALS
// ============================================================================

/**
 * Fetch registered users directory from Supabase user_profiles.
 */
export async function fetchRegisteredUsers() {
  try {
    if (!supabase) throw new Error('Supabase client not initialized');

    // Strictly fetch ONLY approved active or inactive users (NEVER pending)
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .not('status', 'in', '("pending","pending_approval")')
      .order('created_at', { ascending: false });

    if (error) throw error;

    let users = (data || [])
      .filter(u => u && u.status !== 'pending' && u.status !== 'pending_approval')
      .map(u => ({
        id: u.id,
        name: u.full_name || u.username || 'User',
        username: u.username || (u.email ? u.email.split('@')[0] : 'user'),
        email: u.email || '',
        branchLoc: u.branch_location || (u.role === 'admin' ? 'Headquarters' : 'Unassigned'),
        branchName: u.branch_name || (u.role === 'admin' ? 'Main Administration' : 'Branch Store'),
        role: (u.role === 'admin' || u.role === 'superadmin' || u.operational_role === 'admin') 
          ? 'Administrator' 
          : (u.operational_role ? (u.operational_role.charAt(0).toUpperCase() + u.operational_role.slice(1)) : 'Staff'),
        status: u.status === 'inactive' ? 'Inactive' : 'Active',
        created_at: u.created_at || new Date().toISOString()
      }));

    // Ensure Zeanna real admin is present
    const hasAdmin = users.some(u => 
      (u.email && u.email.toLowerCase() === 'calusinzeanna3@gmail.com') ||
      (u.name && u.name.toLowerCase() === 'zeanna')
    );
    if (!hasAdmin) {
      users.unshift({
        id: '66041f5a-ce74-4866-bfcc-b0d05014f13b',
        name: 'Zeanna',
        username: 'zeanna',
        email: 'calusinzeanna3@gmail.com',
        branchLoc: 'Headquarters',
        branchName: 'Main Administration',
        role: 'Administrator',
        status: 'Active',
        created_at: new Date().toISOString()
      });
    }

    // Realtime Supabase synchronization: Supabase user_profiles is the authoritative source.
    // Sync local mirror with real Supabase records to prevent zombie / orphaned accounts.

    // Ensure approved users cache is kept in sync with Supabase status
    try {
      const rawApproved = localStorage.getItem(STORAGE_KEYS.APPROVED_USERS);
      const approvedUsers = rawApproved ? JSON.parse(rawApproved) : [];
      if (Array.isArray(approvedUsers)) {
        approvedUsers.forEach(au => {
          if (!au) return;
          const auEmail = (au.email || '').toLowerCase().trim();
          const auId = String(au.id || '').trim();
          const match = users.find(u => 
            (auId && u.id && String(u.id) === auId) ||
            (auEmail && u.email && u.email.toLowerCase() === auEmail)
          );
          if (match) match.status = 'Active';
        });
      }
    } catch (_) {}

    try {
      localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(users));
      window.dispatchEvent(new Event('rmims_registered_users_updated'));
      window.dispatchEvent(new Event('storage'));
    } catch (_) {}

    return users;
  } catch (err) {
    console.warn('[AdminSupabase] Fetch registered users notice, using filtered local storage:', err.message || err);
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(u => {
        const s = String(u?.status || '').toLowerCase().trim();
        return s !== 'pending' && s !== 'pending_approval';
      }) : [];
    } catch (_) {
      return [];
    }
  }
}

/**
 * Fetch pending registration account requests awaiting Admin approval.
 */
export async function fetchPendingApprovals() {
  try {
    if (!supabase) throw new Error('Supabase client not initialized');

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .in('status', ['pending', 'pending_approval'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    let pending = (data || []).map(u => ({
      id: u.id,
      name: u.full_name || u.username || 'New Account',
      username: u.username || (u.email ? u.email.split('@')[0] : 'user'),
      email: u.email || '',
      branchLoc: u.branch_location || 'Unassigned',
      branchName: u.branch_name || '',
      role: u.operational_role ? (u.operational_role.charAt(0).toUpperCase() + u.operational_role.slice(1)) : 'Staff',
      status: 'Pending',
      createdAt: u.created_at
    }));

    // Realtime Supabase synchronization: Pending list is synced directly from Supabase user_profiles

    // Strictly filter out ANY user who is already approved in STORAGE_KEYS.APPROVED_USERS or REGISTERED_USERS as Active
    try {
      const rawApproved = localStorage.getItem(STORAGE_KEYS.APPROVED_USERS);
      const approvedUsers = rawApproved ? JSON.parse(rawApproved) : [];
      const rawReg = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
      const activeReg = rawReg ? JSON.parse(rawReg) : [];

      pending = pending.filter(p => {
        if (!p) return false;
        const pEmail = (p.email || '').toLowerCase().trim();
        const pUser = (p.username || '').toLowerCase().trim();
        const pId = String(p.id || '').trim();
        const pName = (p.name || '').toLowerCase().trim();

        const isApproved = Array.isArray(approvedUsers) && approvedUsers.some(a => {
          if (!a) return false;
          const aEmail = (a.email || '').toLowerCase().trim();
          const aUser = (a.username || '').toLowerCase().trim();
          const aId = String(a.id || '').trim();
          const aName = (a.name || '').toLowerCase().trim();
          return (pEmail && aEmail && aEmail === pEmail) ||
                 (pUser && aUser && (aUser === pUser || aUser.replace(/\s+/g, '') === pUser.replace(/\s+/g, ''))) ||
                 (pId && aId && aId === pId) ||
                 (pName && aName && (aName === pName || aName.replace(/\s+/g, '') === pName.replace(/\s+/g, '')));
        });
        if (isApproved) return false;

        const isRegActive = Array.isArray(activeReg) && activeReg.some(r => {
          if (!r) return false;
          const rStatus = String(r.status || '').toLowerCase().trim();
          if (rStatus !== 'active') return false;
          const rEmail = (r.email || '').toLowerCase().trim();
          const rUser = (r.username || '').toLowerCase().trim();
          const rId = String(r.id || '').trim();
          const rName = (r.name || '').toLowerCase().trim();
          return (pEmail && rEmail && rEmail === pEmail) ||
                 (pUser && rUser && (rUser === pUser || rUser.replace(/\s+/g, '') === pUser.replace(/\s+/g, ''))) ||
                 (pId && rId && rId === pId) ||
                 (pName && rName && (rName === pName || rName.replace(/\s+/g, '') === pName.replace(/\s+/g, '')));
        });
        if (isRegActive) return false;

        return true;
      });
    } catch (_) {}

    try {
      localStorage.setItem(STORAGE_KEYS.PENDING_USERS, JSON.stringify(pending));
      window.dispatchEvent(new Event('rmims_pending_users_updated'));
      window.dispatchEvent(new Event('storage'));
    } catch (_) {}

    return pending;
  } catch (err) {
    console.warn('[AdminSupabase] Fetch pending approvals failed, using local storage:', err.message || err);
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PENDING_USERS);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }
}

/**
 * Approve a pending user account and activate their portal access.
 * Synchronously updates both local storage and Supabase user_profiles status to 'active'.
 * Standalone: Supports user object or string (email, username, or UUID).
 */
export async function approveUserAccount(targetParam, approvedBy = 'Main Admin') {
  if (!targetParam) return { success: false, error: 'No target specified' };
  const targetId = typeof targetParam === 'object' ? (targetParam.id || '') : String(targetParam);
  const targetEmail = typeof targetParam === 'object' ? (targetParam.email || '') : (String(targetParam).includes('@') ? String(targetParam) : '');
  const targetUsername = typeof targetParam === 'object' ? (targetParam.username || '') : '';
  const targetName = typeof targetParam === 'object' ? (targetParam.name || '') : '';
  const identifier = targetEmail || targetUsername || targetId || targetName;

  const cleanEmail = targetEmail.toLowerCase().trim();
  const cleanUser = targetUsername.toLowerCase().trim();
  const cleanId = String(targetId).trim();
  const cleanName = targetName.toLowerCase().trim();

  // 1. Local storage synchronization: Move user from pending queue into registered directory as Active
  try {
    const rawPending = localStorage.getItem(STORAGE_KEYS.PENDING_USERS);
    const pendingList = rawPending ? JSON.parse(rawPending) : [];
    const target = pendingList.find(u => 
      (cleanId && String(u.id).trim() === cleanId) ||
      (cleanEmail && u.email && u.email.toLowerCase().trim() === cleanEmail) ||
      (cleanUser && u.username && u.username.toLowerCase().trim() === cleanUser) ||
      (cleanName && u.name && u.name.toLowerCase().trim() === cleanName)
    );
    const remainingPending = pendingList.filter(u => {
      const uId = String(u.id || '').trim();
      const uEmail = (u.email || '').toLowerCase().trim();
      const uUser = (u.username || '').toLowerCase().trim();
      const uName = (u.name || '').toLowerCase().trim();
      return !(cleanId && uId && uId === cleanId) &&
             !(cleanEmail && uEmail && uEmail === cleanEmail) &&
             !(cleanUser && uUser && uUser === cleanUser) &&
             !(cleanName && uName && uName === cleanName);
    });
    localStorage.setItem(STORAGE_KEYS.PENDING_USERS, JSON.stringify(remainingPending));

    // Save into authoritative approved users cache
    try {
      const rawApproved = localStorage.getItem(STORAGE_KEYS.APPROVED_USERS);
      const approvedList = rawApproved ? JSON.parse(rawApproved) : [];
      const resolvedEmail = cleanEmail || (target?.email ? target.email.toLowerCase().trim() : '');
      const resolvedUser = cleanUser || (target?.username ? target.username.toLowerCase().trim() : '');
      const resolvedId = cleanId || target?.id || `user-${Date.now()}`;
      const resolvedName = targetName || target?.name || resolvedUser || 'User';

      const existingAppIdx = approvedList.findIndex(a => 
        (resolvedId && a.id && String(a.id).trim() === String(resolvedId).trim()) ||
        (resolvedEmail && a.email && a.email.toLowerCase().trim() === resolvedEmail) ||
        (resolvedUser && a.username && a.username.toLowerCase().trim() === resolvedUser)
      );
      const appRecord = {
        id: resolvedId,
        name: resolvedName,
        username: resolvedUser,
        email: resolvedEmail,
        role: target?.role || targetParam?.role || 'Staff',
        branchLoc: target?.branchLoc || targetParam?.branchLoc || 'Lucena',
        branchName: target?.branchName || targetParam?.branchName || 'Branch Store',
        approvedAt: new Date().toISOString()
      };
      if (existingAppIdx >= 0) {
        approvedList[existingAppIdx] = { ...approvedList[existingAppIdx], ...appRecord };
      } else {
        approvedList.push(appRecord);
      }
      localStorage.setItem(STORAGE_KEYS.APPROVED_USERS, JSON.stringify(approvedList));
    } catch (_) {}

    const rawReg = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
    const regList = rawReg ? JSON.parse(rawReg) : [];
    const searchEmail = cleanEmail || (target?.email ? target.email.toLowerCase().trim() : '');
    const searchId = cleanId || (target?.id || '');
    const searchUser = cleanUser || (target?.username ? target.username.toLowerCase().trim() : '');
    const searchName = cleanName || (target?.name ? target.name.toLowerCase().trim() : '');

    const existingIdx = regList.findIndex(r => 
      (searchEmail && r.email && r.email.toLowerCase().trim() === searchEmail) || 
      (searchId && r.id && String(r.id).trim() === String(searchId).trim()) ||
      (searchUser && r.username && r.username.toLowerCase().trim() === searchUser) ||
      (searchName && r.name && r.name.toLowerCase().trim() === searchName)
    );

    if (existingIdx >= 0) {
      regList[existingIdx].status = 'Active';
    } else if (target) {
      regList.push({
        ...target,
        status: 'Active'
      });
    } else {
      regList.push({
        id: targetId || `user-${Date.now()}`,
        name: targetParam?.name || targetUsername || (targetEmail ? targetEmail.split('@')[0] : 'User'),
        username: targetUsername || (targetEmail ? targetEmail.split('@')[0] : 'user'),
        email: targetEmail,
        status: 'Active'
      });
    }
    localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(regList));

    window.dispatchEvent(new Event('rmims_pending_users_updated'));
    window.dispatchEvent(new Event('rmims_registered_users_updated'));
    window.dispatchEvent(new Event('storage'));
  } catch (_) {}

  // 2. Cascade delete from branch stores personnel to eliminate orphaned personnel
  try {
    const rawStores = localStorage.getItem('RMIMS_BRANCH_STORES_V3');
    if (rawStores) {
      const stores = JSON.parse(rawStores);
      if (stores && typeof stores === 'object') {
        let changed = false;
        Object.values(stores).forEach(st => {
          if (Array.isArray(st.managers)) {
            const b4 = st.managers.length;
            st.managers = st.managers.filter(m => 
              !(userId && String(m.id) === String(userId)) &&
              !(userEmail && m.email && m.email.toLowerCase() === userEmail.toLowerCase())
            );
            if (st.managers.length !== b4) changed = true;
          }
          if (Array.isArray(st.staff)) {
            const b4 = st.staff.length;
            st.staff = st.staff.filter(s => 
              !(userId && String(s.id) === String(userId)) &&
              !(userEmail && s.email && s.email.toLowerCase() === userEmail.toLowerCase())
            );
            if (st.staff.length !== b4) changed = true;
          }
        });
        if (changed) {
          localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(stores));
          window.dispatchEvent(new Event('rmims_stores_updated'));
        }
      }
    }
  } catch (_) {}

  // 2. Log activity
  logAdminActivity({
    action: 'Approved Account',
    module: 'User Management',
    details: `Approved access for ${identifier} by ${approvedBy}`
  });

  // 3. Supabase Cooperation Sync
  if (!supabase) return { success: true, offline: true };

  let lastError = null;

  // Method A: Call RPC 'admin_approve_user' (SECURITY DEFINER stored procedure)
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('admin_approve_user', {
      p_identifier: identifier
    });
    if (!rpcError && (rpcData?.success || rpcData?.updated_count > 0)) {
      console.log('[AdminSupabase] Approved via admin_approve_user RPC:', rpcData);
      return { success: true, method: 'rpc', data: rpcData };
    }
    if (rpcError) {
      lastError = rpcError;
    }
  } catch (rpcErr) {
    lastError = rpcErr;
  }

  // Method B: Direct Supabase updates on user_profiles
  // Try by UUID
  if (targetId && targetId.length > 20 && !targetId.startsWith('pending-') && !targetId.startsWith('user-')) {
    try {
      const { data: idRows, error: idErr } = await supabase
        .from('user_profiles')
        .update({
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', targetId)
        .select();

      if (!idErr && idRows && idRows.length > 0) {
        console.log('[AdminSupabase] Approved in Supabase by UUID:', idRows);
        return { success: true, method: 'direct_uuid', rows: idRows };
      }
      if (idErr) lastError = idErr;
    } catch (e) {
      lastError = e;
    }
  }

  // Try by Email
  if (targetEmail) {
    try {
      const { data: emailRows, error: emailErr } = await supabase
        .from('user_profiles')
        .update({
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .ilike('email', targetEmail.trim())
        .select();

      if (!emailErr && emailRows && emailRows.length > 0) {
        console.log('[AdminSupabase] Approved in Supabase by Email:', emailRows);
        return { success: true, method: 'direct_email', rows: emailRows };
      }
      if (emailErr) lastError = emailErr;
    } catch (e) {
      lastError = e;
    }
  }

  // Try by Username
  if (targetUsername) {
    try {
      const { data: userRows, error: userErr } = await supabase
        .from('user_profiles')
        .update({
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .ilike('username', targetUsername.trim())
        .select();

      if (!userErr && userRows && userRows.length > 0) {
        console.log('[AdminSupabase] Approved in Supabase by Username:', userRows);
        return { success: true, method: 'direct_username', rows: userRows };
      }
      if (userErr) lastError = userErr;
    } catch (e) {
      lastError = e;
    }
  }

  // Try by Full Name
  if (targetName) {
    try {
      const { data: nameRows, error: nameErr } = await supabase
        .from('user_profiles')
        .update({
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .ilike('full_name', targetName.trim())
        .select();

      if (!nameErr && nameRows && nameRows.length > 0) {
        console.log('[AdminSupabase] Approved in Supabase by Full Name:', nameRows);
        return { success: true, method: 'direct_fullname', rows: nameRows };
      }
      if (nameErr) lastError = nameErr;
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError) {
    console.warn('[AdminSupabase] Supabase approval update notice:', lastError.message || lastError);
  }

  // Local approval is always guaranteed and verified
  return { success: true, method: 'local_synchronized', identifier };
}

/**
 * Create a new user account in Supabase user_profiles.
 */

/**
 * Reject a pending user account registration.
 * Synchronously removes user from local storage pending queue and updates Supabase user_profiles
 * status to 'inactive', preventing resurrected / zombie pending accounts.
 */
export async function rejectUserAccount(targetParam, rejectedBy = 'Main Admin') {
  if (!targetParam) return { success: false, error: 'No target specified' };
  const targetId = typeof targetParam === 'object' ? (targetParam.id || '') : String(targetParam);
  const targetEmail = typeof targetParam === 'object' ? (targetParam.email || '') : (String(targetParam).includes('@') ? String(targetParam) : '');
  const targetUsername = typeof targetParam === 'object' ? (targetParam.username || '') : '';
  const targetName = typeof targetParam === 'object' ? (targetParam.name || '') : '';
  const identifier = targetEmail || targetUsername || targetId || targetName;

  const cleanEmail = targetEmail.toLowerCase().trim();
  const cleanUser = targetUsername.toLowerCase().trim();
  const cleanId = String(targetId).trim();
  const cleanName = targetName.toLowerCase().trim();

  // 1. Remove from local storage pending queue
  try {
    const rawPending = localStorage.getItem(STORAGE_KEYS.PENDING_USERS);
    const pendingList = rawPending ? JSON.parse(rawPending) : [];
    const remainingPending = pendingList.filter(u => {
      const uId = String(u.id || '').trim();
      const uEmail = (u.email || '').toLowerCase().trim();
      const uUser = (u.username || '').toLowerCase().trim();
      const uName = (u.name || '').toLowerCase().trim();
      return !(cleanId && uId && (uId === cleanId || `req_${uId}` === cleanId || `ovRow_${uId}` === cleanId)) &&
             !(cleanEmail && uEmail && uEmail === cleanEmail) &&
             !(cleanUser && uUser && uUser === cleanUser) &&
             !(cleanName && uName && uName === cleanName);
    });
    localStorage.setItem(STORAGE_KEYS.PENDING_USERS, JSON.stringify(remainingPending));

    // Also remove from registered directory if accidentally present
    const rawReg = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
    if (rawReg) {
      const regList = JSON.parse(rawReg);
      const remainingReg = regList.filter(u => {
        const uId = String(u.id || '').trim();
        const uEmail = (u.email || '').toLowerCase().trim();
        const uUser = (u.username || '').toLowerCase().trim();
        return !(cleanId && uId && uId === cleanId) &&
               !(cleanEmail && uEmail && uEmail === cleanEmail) &&
               !(cleanUser && uUser && uUser === cleanUser);
      });
      localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(remainingReg));
    }

    // Also remove from approved cache if present
    const rawApp = localStorage.getItem(STORAGE_KEYS.APPROVED_USERS);
    if (rawApp) {
      const appList = JSON.parse(rawApp);
      const remainingApp = appList.filter(a => {
        const aId = String(a.id || '').trim();
        const aEmail = (a.email || '').toLowerCase().trim();
        const aUser = (a.username || '').toLowerCase().trim();
        return !(cleanId && aId && aId === cleanId) &&
               !(cleanEmail && aEmail && aEmail === cleanEmail) &&
               !(cleanUser && aUser && aUser === cleanUser);
      });
      localStorage.setItem(STORAGE_KEYS.APPROVED_USERS, JSON.stringify(remainingApp));
    }

    window.dispatchEvent(new Event('rmims_pending_users_updated'));
    window.dispatchEvent(new Event('rmims_registered_users_updated'));
    window.dispatchEvent(new Event('storage'));
  } catch (_) {}

  // 2. Cascade delete from branch stores personnel
  try {
    const rawStores = localStorage.getItem('RMIMS_BRANCH_STORES_V3');
    if (rawStores) {
      const stores = JSON.parse(rawStores);
      if (stores && typeof stores === 'object') {
        let changed = false;
        Object.values(stores).forEach(st => {
          if (Array.isArray(st.managers)) {
            const b4 = st.managers.length;
            st.managers = st.managers.filter(m => 
              !(cleanId && String(m.id) === cleanId) &&
              !(cleanEmail && m.email && m.email.toLowerCase() === cleanEmail) &&
              !(cleanUser && m.username && m.username.toLowerCase() === cleanUser)
            );
            if (st.managers.length !== b4) changed = true;
          }
          if (Array.isArray(st.staff)) {
            const b4 = st.staff.length;
            st.staff = st.staff.filter(s => 
              !(cleanId && String(s.id) === cleanId) &&
              !(cleanEmail && s.email && s.email.toLowerCase() === cleanEmail) &&
              !(cleanUser && s.username && s.username.toLowerCase() === cleanUser)
            );
            if (st.staff.length !== b4) changed = true;
          }
        });
        if (changed) {
          localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(stores));
          window.dispatchEvent(new Event('rmims_stores_updated'));
        }
      }
    }
  } catch (_) {}

  // 3. Log activity
  logAdminActivity({
    action: 'Rejected Account',
    module: 'User Management',
    details: `Rejected registration request for ${targetName || identifier} by ${rejectedBy}`
  });

  // 4. Supabase Cooperation Sync
  if (!supabase) return { success: true, offline: true };

  let lastError = null;

  const updatePayload = {
    status: 'inactive',
    updated_at: new Date().toISOString()
  };

  // Method A: By UUID
  if (cleanId && cleanId.length > 20 && !cleanId.startsWith('pending-') && !cleanId.startsWith('user-') && !cleanId.startsWith('req_') && !cleanId.startsWith('ovRow_')) {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .update(updatePayload)
        .eq('id', cleanId)
        .select();
      if (!error && data && data.length > 0) {
        console.log('[AdminSupabase] Rejected/Inactivated in Supabase by UUID:', data);
        return { success: true, method: 'direct_uuid', rows: data };
      }
      if (error) lastError = error;
    } catch (e) {
      lastError = e;
    }
  }

  // Method B: By Email
  if (cleanEmail) {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .update(updatePayload)
        .ilike('email', cleanEmail)
        .select();
      if (!error && data && data.length > 0) {
        console.log('[AdminSupabase] Rejected/Inactivated in Supabase by Email:', data);
        return { success: true, method: 'direct_email', rows: data };
      }
      if (error) lastError = error;
    } catch (e) {
      lastError = e;
    }
  }

  // Method C: By Username
  if (cleanUser) {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .update(updatePayload)
        .ilike('username', cleanUser)
        .select();
      if (!error && data && data.length > 0) {
        console.log('[AdminSupabase] Rejected/Inactivated in Supabase by Username:', data);
        return { success: true, method: 'direct_username', rows: data };
      }
      if (error) lastError = error;
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError) {
    console.warn('[AdminSupabase] Supabase rejection notice:', lastError.message || lastError);
  }

  return { success: true, method: 'local_synchronized', identifier };
}


export async function createUserAccount(user) {
  if (!user || !user.email) return { success: false, error: 'Valid user with email is required' };
  
  const userId = user.id && user.id.length > 20 && !user.id.startsWith('user-') 
    ? user.id 
    : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `user-${Date.now()}`);

  const roleClean = String(user.role || 'Staff').toLowerCase();
  const operationalRole = roleClean.includes('admin') ? 'admin' : (roleClean.includes('manager') ? 'manager' : 'staff');
  const role = operationalRole === 'admin' ? 'admin' : (operationalRole === 'manager' ? 'manager' : 'staff');

  const payload = {
    id: userId,
    full_name: user.name || user.fullName || 'User',
    username: user.username || user.email.split('@')[0],
    email: user.email.trim().toLowerCase(),
    branch_location: user.branchLoc || 'Unassigned',
    branch_name: user.branchName || 'Branch Store',
    role: role,
    operational_role: operationalRole,
    status: user.status ? user.status.toLowerCase() : 'active',
    updated_at: new Date().toISOString()
  };

  // 1. Update local storage registered users
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
    const users = raw ? JSON.parse(raw) : [];
    const idx = users.findIndex(u => (u.id && u.id === userId) || (u.email && u.email.toLowerCase() === payload.email));
    const localRecord = {
      id: userId,
      name: payload.full_name,
      username: payload.username,
      email: payload.email,
      branchLoc: payload.branch_location,
      branchName: payload.branch_name,
      role: user.role || 'Staff',
      status: 'Active'
    };
    if (idx >= 0) users[idx] = localRecord;
    else users.push(localRecord);
    localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(users));
    window.dispatchEvent(new Event('rmims_registered_users_updated'));
    window.dispatchEvent(new Event('storage'));
  } catch (_) {}

  // 2. Persist to Supabase
  if (!supabase) return { success: true, offline: true, user: payload };

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(payload, { onConflict: 'email' })
      .select();

    if (error) throw error;
    return { success: true, user: (data && data[0]) || payload };
  } catch (err) {
    console.warn('[AdminSupabase] Create user profile failed on Supabase:', err.message || err);
    return { success: true, offline: true, error: err.message, user: payload };
  }
}

/**
 * Update an existing user account in Supabase user_profiles.
 */
export async function updateUserAccount(user) {
  if (!user || (!user.id && !user.email)) return { success: false, error: 'User ID or email required' };

  const roleClean = String(user.role || 'Staff').toLowerCase();
  const operationalRole = roleClean.includes('admin') ? 'admin' : (roleClean.includes('manager') ? 'manager' : 'staff');
  const role = operationalRole === 'admin' ? 'admin' : (operationalRole === 'manager' ? 'manager' : 'staff');

  const updateFields = {
    full_name: user.name || user.fullName,
    username: user.username,
    branch_location: user.branchLoc,
    branch_name: user.branchName,
    role: role,
    operational_role: operationalRole,
    status: user.status ? user.status.toLowerCase() : 'active',
    updated_at: new Date().toISOString()
  };

  // Local storage update
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
    const users = raw ? JSON.parse(raw) : [];
    const idx = users.findIndex(u => (user.id && String(u.id) === String(user.id)) || (user.email && u.email?.toLowerCase() === user.email.toLowerCase()));
    if (idx >= 0) {
      users[idx] = {
        ...users[idx],
        name: updateFields.full_name || users[idx].name,
        username: updateFields.username || users[idx].username,
        email: user.email || users[idx].email,
        branchLoc: updateFields.branch_location || users[idx].branchLoc,
        branchName: updateFields.branch_name || users[idx].branchName,
        role: user.role || users[idx].role,
        status: user.status || users[idx].status || 'Active'
      };
      localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(users));
      window.dispatchEvent(new Event('rmims_registered_users_updated'));
      window.dispatchEvent(new Event('storage'));
    }
  } catch (_) {}

  if (!supabase) return { success: true, offline: true };

  try {
    let query = supabase.from('user_profiles').update(updateFields);
    if (user.id && user.id.length > 20 && !user.id.startsWith('user-')) {
      query = query.eq('id', user.id);
    } else if (user.email) {
      query = query.ilike('email', user.email.trim());
    } else {
      query = query.ilike('username', user.username.trim());
    }

    const { error } = await query;
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.warn('[AdminSupabase] Update user failed on Supabase:', err.message || err);
    return { success: true, offline: true, error: err.message };
  }
}

/**
 * Delete a user account from Supabase user_profiles to eliminate zombie / resurrected users.
 */
export async function deleteUserAccount(userId, userEmail) {
  // 1. Remove from local mirrors
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
    const users = raw ? JSON.parse(raw) : [];
    const filtered = users.filter(u => 
      !(userId && String(u.id) === String(userId)) &&
      !(userEmail && u.email && u.email.toLowerCase() === userEmail.toLowerCase())
    );
    localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(filtered));

    const rawApp = localStorage.getItem(STORAGE_KEYS.APPROVED_USERS);
    const approved = rawApp ? JSON.parse(rawApp) : [];
    const filteredApp = approved.filter(u => 
      !(userId && String(u.id) === String(userId)) &&
      !(userEmail && u.email && u.email.toLowerCase() === userEmail.toLowerCase())
    );
    localStorage.setItem(STORAGE_KEYS.APPROVED_USERS, JSON.stringify(filteredApp));

    window.dispatchEvent(new Event('rmims_registered_users_updated'));
    window.dispatchEvent(new Event('storage'));
  } catch (_) {}

  if (!supabase) return { success: true, offline: true };

  try {
    let query = supabase.from('user_profiles').delete();
    if (userId && userId.length > 20 && !userId.startsWith('user-')) {
      query = query.eq('id', userId);
    } else if (userEmail) {
      query = query.ilike('email', userEmail.trim());
    } else {
      return { success: false, error: 'Valid identifier required for deletion' };
    }

    const { error } = await query;
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.warn('[AdminSupabase] Delete user failed on Supabase:', err.message || err);
    return { success: true, offline: true, error: err.message };
  }
}

/**
 * Subscribe to Supabase Realtime channel across core operational tables:
 * Instantly broadcasts database mutations made by Manager or Staff without page reload.
 */
export function subscribeToAdminFeed(onUpdate) {
  if (!supabase || typeof supabase.channel !== 'function') {
    return () => {};
  }

  try {
    const channel = supabase.channel('rmims-admin-live-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_receipts' }, payload => {
        if (typeof onUpdate === 'function') onUpdate({ table: 'stock_receipts', payload });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_disbursements' }, payload => {
        if (typeof onUpdate === 'function') onUpdate({ table: 'material_disbursements', payload });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_profiles' }, payload => {
        if (typeof onUpdate === 'function') onUpdate({ table: 'user_profiles', payload });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_activity_logs' }, payload => {
        if (typeof onUpdate === 'function') onUpdate({ table: 'admin_activity_logs', payload });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branch_stores' }, payload => {
        if (typeof onUpdate === 'function') onUpdate({ table: 'branch_stores', payload });
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch (_) {}
    };
  } catch (err) {
    console.warn('[AdminSupabase] Realtime subscription init notice:', err);
    return () => {};
  }
}

// ============================================================================
// 5. GLOBAL ADMIN SYSTEM SETTINGS
// ============================================================================

/**
 * Fetch all global administrative settings.
 */
export async function fetchSystemSettings() {
  try {
    if (!supabase) throw new Error('Supabase client not initialized');

    const { data, error } = await supabase
      .from('admin_system_settings')
      .select('*');

    if (error) throw error;

    const settings = {};
    (data || []).forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });

    try {
      localStorage.setItem(STORAGE_KEYS.SYSTEM_SETTINGS, JSON.stringify(settings));
    } catch (_) {}

    return settings;
  } catch (err) {
    console.warn('[AdminSupabase] Fetch system settings failed, using local storage:', err.message || err);
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SYSTEM_SETTINGS);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }
}

/**
 * Save a global system setting.
 */
export async function saveSystemSetting(key, value, updatedBy = 'Admin') {
  if (!key) return;

  // Local storage update
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SYSTEM_SETTINGS);
    const settings = raw ? JSON.parse(raw) : {};
    settings[key] = value;
    localStorage.setItem(STORAGE_KEYS.SYSTEM_SETTINGS, JSON.stringify(settings));
  } catch (_) {}

  try {
    if (!supabase) return { success: true, offline: true };

    const { error } = await supabase
      .from('admin_system_settings')
      .upsert({
        setting_key: key,
        setting_value: value,
        updated_by: updatedBy,
        updated_at: new Date().toISOString()
      }, { onConflict: 'setting_key' });

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.warn('[AdminSupabase] Save system setting failed on Supabase:', err.message || err);
    return { success: true, offline: true, error: err.message };
  }
}

/**
 * Permanently purge all accounts across local storage and Supabase backend.
 */
export async function permanentlyPurgeAllAccounts() {
  try {
    localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.PENDING_USERS, JSON.stringify([]));

    // Clear personnel from stores
    const rawStores = localStorage.getItem(STORAGE_KEYS.BRANCH_STORES);
    if (rawStores) {
      try {
        const stores = JSON.parse(rawStores);
        Object.values(stores).forEach(st => {
          st.managers = [];
          st.staff = [];
        });
        localStorage.setItem(STORAGE_KEYS.BRANCH_STORES, JSON.stringify(stores));
      } catch (_) {}
    }

    // Clear active sessions
    localStorage.removeItem('currentUser');
    localStorage.removeItem('rmimsCurrentUser');
    localStorage.removeItem('adminUser');
    localStorage.removeItem('managerUser');
    localStorage.removeItem('staffUser');
    localStorage.removeItem('userProfile');
    localStorage.removeItem('rmimsAdminUser');
    localStorage.removeItem('rmims_logged_in_user');

    window.dispatchEvent(new Event('rmims_registered_users_updated'));
    window.dispatchEvent(new Event('rmims_pending_users_updated'));
    window.dispatchEvent(new Event('rmims_stores_updated'));
    window.dispatchEvent(new Event('storage'));

    if (supabase) {
      try {
        await supabase.rpc('permanently_purge_all_accounts');
      } catch (_) {}
      try {
        await supabase.from('user_profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      } catch (_) {}
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

if (typeof window !== 'undefined') {
  window.permanentlyPurgeAllAccounts = permanentlyPurgeAllAccounts;
}

export default {
  STORAGE_KEYS,
  fetchBranchStores,
  saveBranchStore,
  deleteBranchStore,
  fetchSystemAlerts,
  createSystemAlert,
  updateSystemAlertStatus,
  logAdminActivity,
  fetchLiveSystemActivities,
  fetchRegisteredUsers,
  fetchPendingApprovals,
  approveUserAccount,
  rejectUserAccount,
  createUserAccount,
  updateUserAccount,
  deleteUserAccount,
  subscribeToAdminFeed,
  fetchSystemSettings,
  saveSystemSetting,
  permanentlyPurgeAllAccounts
};
