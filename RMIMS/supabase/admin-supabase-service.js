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

// ============================================================================
// 4. USER DIRECTORY & PENDING APPROVALS
// ============================================================================

/**
 * Fetch registered users directory from Supabase user_profiles.
 */
export async function fetchRegisteredUsers() {
  try {
    if (!supabase) throw new Error('Supabase client not initialized');

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    let users = (data || []).map(u => ({
      id: u.id,
      name: u.full_name || u.username || 'User',
      username: u.username || (u.email ? u.email.split('@')[0] : 'user'),
      email: u.email || '',
      branchLoc: u.branch_location || (u.role === 'admin' ? 'Headquarters' : 'Unassigned'),
      branchName: u.branch_name || (u.role === 'admin' ? 'Main Administration' : 'Branch Store'),
      role: (u.role === 'admin' || u.role === 'superadmin' || u.operational_role === 'admin') 
        ? 'Administrator' 
        : (u.operational_role ? (u.operational_role.charAt(0).toUpperCase() + u.operational_role.slice(1)) : 'Staff'),
      status: (u.status === 'pending' || u.status === 'pending_approval') ? 'Pending' : (u.status === 'inactive' ? 'Inactive' : 'Active'),
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

    // Merge with existing local registered users so new accounts are never lost
    try {
      const rawLocal = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
      const localUsers = rawLocal ? JSON.parse(rawLocal) : [];
      if (Array.isArray(localUsers)) {
        localUsers.forEach(lu => {
          if (!lu) return;
          const exists = users.some(u => 
            (u.id && lu.id && String(u.id) === String(lu.id)) ||
            (u.email && lu.email && u.email.toLowerCase() === lu.email.toLowerCase()) ||
            (u.username && lu.username && u.username.toLowerCase() === lu.username.toLowerCase())
          );
          if (!exists) {
            users.push(lu);
          }
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
    console.warn('[AdminSupabase] Fetch registered users failed, using local storage:', err.message || err);
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
      return raw ? JSON.parse(raw) : [];
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

    // Merge with existing local pending users so newly registered local users awaiting approval are preserved
    try {
      const rawLocal = localStorage.getItem(STORAGE_KEYS.PENDING_USERS);
      const localPending = rawLocal ? JSON.parse(rawLocal) : [];
      if (Array.isArray(localPending)) {
        localPending.forEach(lp => {
          if (!lp) return;
          const exists = pending.some(p => 
            (p.id && lp.id && String(p.id) === String(lp.id)) ||
            (p.email && lp.email && p.email.toLowerCase() === lp.email.toLowerCase()) ||
            (p.username && lp.username && p.username.toLowerCase() === lp.username.toLowerCase())
          );
          if (!exists) {
            pending.push(lp);
          }
        });
      }
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
 * Standalone: Supports user object or string (email, username, or UUID).
 */
export async function approveUserAccount(targetParam, approvedBy = 'Main Admin') {
  if (!targetParam) return;
  const targetId = typeof targetParam === 'object' ? (targetParam.id || '') : String(targetParam);
  const targetEmail = typeof targetParam === 'object' ? (targetParam.email || '') : (String(targetParam).includes('@') ? String(targetParam) : '');
  const targetUsername = typeof targetParam === 'object' ? (targetParam.username || '') : '';
  const identifier = targetEmail || targetUsername || targetId;

  // Local storage update
  try {
    const rawPending = localStorage.getItem(STORAGE_KEYS.PENDING_USERS);
    const pendingList = rawPending ? JSON.parse(rawPending) : [];
    const target = pendingList.find(u => 
      (targetId && String(u.id) === String(targetId)) ||
      (targetEmail && u.email && u.email.toLowerCase() === targetEmail.toLowerCase()) ||
      (targetUsername && u.username && u.username.toLowerCase() === targetUsername.toLowerCase())
    );
    const remainingPending = pendingList.filter(u => 
      !(targetId && String(u.id) === String(targetId)) &&
      !(targetEmail && u.email && u.email.toLowerCase() === targetEmail.toLowerCase())
    );
    localStorage.setItem(STORAGE_KEYS.PENDING_USERS, JSON.stringify(remainingPending));

    const rawReg = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
    const regList = rawReg ? JSON.parse(rawReg) : [];
    const searchEmail = targetEmail || (target?.email || '');
    const searchId = targetId || (target?.id || '');
    const searchUser = targetUsername || (target?.username || '');

    const existingIdx = regList.findIndex(r => 
      (searchEmail && r.email && r.email.toLowerCase() === searchEmail.toLowerCase()) || 
      (searchId && r.id && String(r.id) === String(searchId)) ||
      (searchUser && r.username && r.username.toLowerCase() === searchUser.toLowerCase())
    );

    if (existingIdx >= 0) {
      regList[existingIdx].status = 'Active';
    } else if (target) {
      regList.push({
        ...target,
        status: 'Active'
      });
    }
    localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(regList));

    window.dispatchEvent(new Event('rmims_pending_users_updated'));
    window.dispatchEvent(new Event('rmims_registered_users_updated'));
    window.dispatchEvent(new Event('storage'));
  } catch (_) {}

  // Log activity
  logAdminActivity({
    action: 'Approved Account',
    module: 'User Management',
    details: `Approved access for ${identifier} by ${approvedBy}`
  });

  try {
    if (!supabase) return { success: true, offline: true };

    // 1. Try RPC stored procedure first (most resilient, bypasses client trigger limits)
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('admin_approve_user', {
        p_identifier: identifier
      });
      if (!rpcError && rpcData?.success) {
        return { success: true, method: 'rpc' };
      }
    } catch (_) {}

    // 2. Direct Supabase updates by email, username, and UUID
    if (targetEmail) {
      await supabase.from('user_profiles').update({
        status: 'active',
        updated_at: new Date().toISOString()
      }).ilike('email', targetEmail);
    } else if (targetId && targetId.length > 20 && !targetId.startsWith('pending-')) {
      await supabase.from('user_profiles').update({
        status: 'active',
        updated_at: new Date().toISOString()
      }).eq('id', targetId);
    } else if (targetUsername) {
      await supabase.from('user_profiles').update({
        status: 'active',
        updated_at: new Date().toISOString()
      }).ilike('username', targetUsername);
    }

    return { success: true };
  } catch (err) {
    console.warn('[AdminSupabase] Approve user account failed on Supabase:', err.message || err);
    return { success: true, offline: true, error: err.message };
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
  fetchRegisteredUsers,
  fetchPendingApprovals,
  approveUserAccount,
  fetchSystemSettings,
  saveSystemSetting,
  permanentlyPurgeAllAccounts
};
