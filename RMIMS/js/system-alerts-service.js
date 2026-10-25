// RMIMS System Diagnostics & Maintenance Alerts Service
// Implements backend alert policies:
// 1. Incorrect Password: 1 failed attempt is logged silently in telemetry (does NOT appear in system diagnostics).
//    Multiple failed attempts (>= 3) automatically escalate and alert the system diagnostics module.
// 2. Critical Incidents (Account Locked, Database Offline, Security Breach): Threshold = 1.
//    "Once is enough to alert" — immediately published to system diagnostics on the first occurrence.
// 3. Routine Diagnostics (System Latency, Duplicate Sync Warnings): Threshold = 3 occurrences before alerting.

const STORAGE_KEY_ALERTS = 'RMIMS_SYSTEM_ALERTS_V2';
const STORAGE_KEY_TELEMETRY = 'RMIMS_AUTH_TELEMETRY_V2';

// Configurable Alert Policy Thresholds
export const ALERT_THRESHOLDS = {
  INCORRECT_PASSWORD_ALERT: 3, // 1st attempt: silent; 3rd+ attempt: alerts module
  ACCOUNT_LOCKOUT: 5,          // 5th attempt: locks account and creates critical alert
  CRITICAL_INCIDENT: 1,        // Once is enough for critical alerts!
  ROUTINE_INCIDENT: 3          // Non-critical warnings require repeated occurrences
};

// Helper to clean and format branch location to concise labels (e.g., 'Lucena', 'Tiaong', 'Headquarters', 'System')
// Ensures no long wordy strings or full sentences appear in the location indicators
export function formatCleanBranchLocation(locInput, branchNameInput = '') {
  const combined = `${locInput || ''} ${branchNameInput || ''}`.toLowerCase().trim();
  if (!combined) return 'System';
  if (combined.includes('lucena')) return 'Lucena';
  if (combined.includes('tiaong')) return 'Tiaong';
  if (combined.includes('headquarters') || combined.includes('hq') || combined.includes('admin')) return 'Headquarters';
  if (combined.includes('all branch') || combined.includes('general system') || combined.includes('cluster') || combined.includes('system')) return 'System';
  
  const candidate = (locInput || branchNameInput || '').split(/[\s\-(,]/)[0].trim();
  if (candidate && candidate.length >= 3 && candidate.length <= 15) {
    return candidate.charAt(0).toUpperCase() + candidate.slice(1);
  }
  return 'System';
}

// Helper to determine the assigned contact / role depending on the diagnosed problem
export function getDiagnosticRecipient(alert = {}) {
  const typeLower = (alert.type || '').toLowerCase();
  const catLower = (alert.category || '').toLowerCase();
  const branchName = alert.branchName || alert.branch || 'Branch Store';
  const cleanBranchSlug = branchName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const branchDomain = cleanBranchSlug ? `${cleanBranchSlug}.com` : 'rmims.ph';

  // 1. Password / Login / Authentication Failures -> Store Manager
  if (typeLower.includes('password') || typeLower.includes('login') || typeLower.includes('auth')) {
    return {
      role: 'Manager',
      roleLabel: 'Store Manager',
      team: 'Store Management & Credentials',
      actionLabel: 'Send to Manager',
      defaultContact: `manager@${branchDomain}`,
      suggestedNote: `Action required: Multiple failed logins detected for ${branchName}. Store Manager assistance needed to verify credentials or assist password reset.`
    };
  }

  // 2. Account Lockout / User Access Security -> Store Manager
  if (typeLower.includes('lock') || typeLower.includes('security')) {
    return {
      role: 'Manager',
      roleLabel: 'Store Manager',
      team: 'Store Management & Security',
      actionLabel: 'Send to Manager',
      defaultContact: `manager@${branchDomain}`,
      suggestedNote: `Security alert: User account temporarily locked due to consecutive failed attempts. Store Manager verification required before unlocking.`
    };
  }

  // 3. Low Stock / Reorder Thresholds -> Store Manager
  if (typeLower.includes('low stock') || typeLower.includes('reorder') || typeLower.includes('threshold')) {
    return {
      role: 'Manager',
      roleLabel: 'Store Manager',
      team: 'Store Management & Purchasing',
      actionLabel: 'Send to Manager',
      defaultContact: `manager@${branchDomain}`,
      suggestedNote: `Stock warning: Raw materials fallen below safety reorder threshold at ${branchName}. Store Manager action required to approve purchase order.`
    };
  }

  // 4. Critical Stock Depletion / Out of Stock -> Store Staff
  if (typeLower.includes('depletion') || typeLower.includes('depleted') || typeLower.includes('out of stock')) {
    return {
      role: 'Staff',
      roleLabel: 'Store Staff',
      team: 'Branch Inventory & Stocking Personnel',
      actionLabel: 'Send to Staff',
      defaultContact: `inventory@${branchDomain}`,
      suggestedNote: `Critical inventory alert: Zero stock level detected for critical items at ${branchName}. Store Staff on-site inventory check required immediately.`
    };
  }

  // 5. Rejected Transactions -> Store Staff
  if (typeLower.includes('rejected') || typeLower.includes('transaction')) {
    return {
      role: 'Staff',
      roleLabel: 'Store Staff',
      team: 'Store Operations Personnel',
      actionLabel: 'Send to Staff',
      defaultContact: `staff@${branchDomain}`,
      suggestedNote: `Transaction flagged: Transaction was rejected by the Store Manager. Store Staff personnel must review rejection notes and re-submit.`
    };
  }

  // 6. Data Synchronization / Duplicate Entries -> Store Staff
  if (typeLower.includes('duplicate') || typeLower.includes('data') || catLower === 'data') {
    return {
      role: 'Staff',
      roleLabel: 'Store Staff',
      team: 'Branch Inventory & Data Operations',
      actionLabel: 'Send to Staff',
      defaultContact: `inventory@${branchDomain}`,
      suggestedNote: `Data sync warning: Duplicate entry or data discrepancy detected in branch sync for ${branchName}. Store Staff review required.`
    };
  }

  // 7. System Latency / Server Responsive / Database -> Main Administrator
  if (typeLower.includes('responsive') || typeLower.includes('performance') || typeLower.includes('latency') || catLower === 'performance' || typeLower.includes('database') || typeLower.includes('offline') || typeLower.includes('network')) {
    return {
      role: 'Admin',
      roleLabel: 'Main Administrator',
      team: 'Main Administration & Maintenance',
      actionLabel: 'Send to Admin',
      defaultContact: 'calusinzeanna3@gmail.com',
      suggestedNote: `Infrastructure incident: System performance degradation or connection anomaly detected at ${branchName}. Main Administrator review required.`
    };
  }

  // Default Fallback: Main Administrator
  return {
    role: 'Admin',
    roleLabel: 'Main Administrator',
    team: 'Main Administration',
    actionLabel: 'Send to Admin',
    defaultContact: 'calusinzeanna3@gmail.com',
    suggestedNote: `System diagnostic incident: ${alert.type || 'Diagnostic Incident'} recorded at ${branchName}. Admin attention requested.`
  };
}

// Default Initial Alerts Seed (Empty by default for production & Supabase integration)
const DEFAULT_ALERTS = [];

// Helper to identify and purge legacy mock/demo alerts
function isLegacyMockAlert(alert) {
  if (!alert) return false;
  const str = `${alert.id || ''} ${alert.type || ''} ${alert.details || ''} ${alert.branch || ''} ${alert.branchLocation || ''}`.toLowerCase();
  return (
    str.includes('simulated_user') ||
    str.includes('regional storage cluster') ||
    str.includes('demo_alert') ||
    str.includes('mock_alert') ||
    str.includes('slow response time (avg. 6.2s')
  );
}

// Auto-purge any cached mock alerts on module load
try {
  const purgeKey = 'RMIMS_MOCK_ALERTS_PURGED_V3';
  if (!localStorage.getItem(purgeKey)) {
    const rawExisting = localStorage.getItem(STORAGE_KEY_ALERTS);
    if (rawExisting) {
      try {
        const parsed = JSON.parse(rawExisting);
        const cleaned = Array.isArray(parsed) ? parsed.filter(a => !isLegacyMockAlert(a)) : [];
        localStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(cleaned));
      } catch (_) {
        localStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify([]));
      }
    } else {
      localStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify([]));
    }
    localStorage.removeItem('rmims_system_alerts');
    localStorage.removeItem(STORAGE_KEY_TELEMETRY);
    localStorage.setItem(purgeKey, 'true');
  }
} catch (_) {}


/**
 * Automatically synchronize live user operations (from Manager and Staff portals)
 * into the Admin System Alerts dashboard.
 */
export function syncOperationalAlerts() {
  try {
    let alerts = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ALERTS);
      alerts = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(alerts)) alerts = [];
      alerts = alerts.filter(a => !isLegacyMockAlert(a));
    } catch (_) {
      alerts = [];
    }

    let changed = false;
    const timeNow = formatCurrentDateTime();

    // 1. Scan for Rejected Transactions in rmims_staff_transactions & rmims_manager_activities
    try {
      const rawTx = localStorage.getItem('rmims_staff_transactions');
      const staffTx = rawTx ? JSON.parse(rawTx) : [];
      if (Array.isArray(staffTx)) {
        staffTx.filter(t => (t.status || '').toLowerCase() === 'rejected').forEach(t => {
          const ref = t.ref || t.id || 'TX';
          const alertId = `alt-rej-${ref.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          const bInfo = parseBranch(t.branch || t.branchName || t.branchLocation || 'Store Branch');
          const reason = t.rejectionReason || 'Transaction flagged by store manager';
          const existing = alerts.find(a => a.id === alertId || (a.type === 'Transaction Rejected by Manager' && a.details && a.details.includes(ref)));
          
          if (!existing) {
            alerts.unshift({
              id: alertId,
              type: 'Transaction Rejected by Manager',
              category: 'functional',
              severity: 'warning',
              status: 'ongoing',
              branchLocation: bInfo.location || 'Lucena',
              branchName: bInfo.name || 'Store Branch',
              branch: bInfo.full,
              occurrence: 1,
              lastDetected: timeNow,
              details: `Transaction ${ref} was rejected by Store Manager: "${reason}". Action required by store personnel.`,
              targetRole: 'Staff',
              targetRoleLabel: 'Store Staff',
              actionLabel: 'Send to Manager'
            });
            changed = true;
          }
        });
      }
    } catch (_) {}

    // 2. Scan for Low Stock & Out of Stock Materials across stores
    try {
      const storeMaterialsMap = [
        { key: 'scones_raw_materials', branchLoc: 'Lucena', branchName: 'Scones & Muffins Bakery' },
        { key: 'kxc_raw_materials', branchLoc: 'Tiaong', branchName: 'KXC 5-Year Enterprise' },
        { key: 'rmims_raw_materials', branchLoc: 'Lucena', branchName: 'Scones & Muffins Bakery' }
      ];

      storeMaterialsMap.forEach(sMap => {
        const rawM = localStorage.getItem(sMap.key);
        if (!rawM) return;
        const list = JSON.parse(rawM);
        if (!Array.isArray(list)) return;

        // Find critical depleted (Out of stock)
        const outOfStock = list.filter(m => {
          const s = String(m.status || '').toLowerCase();
          const stock = Number(m.currentStock ?? m.stock ?? m.quantity ?? 100);
          return s === 'out of stock' || s === 'critical' || stock <= 0;
        });

        if (outOfStock.length > 0) {
          const matNames = outOfStock.map(m => m.name).slice(0, 3).join(', ') + (outOfStock.length > 3 ? ` +${outOfStock.length - 3} more` : '');
          const alertId = `alt-depleted-${sMap.branchLoc.toLowerCase()}`;
          const existing = alerts.find(a => a.id === alertId || (a.type === 'Critical Stock Depletion' && a.branchLocation === sMap.branchLoc));
          if (existing) {
            if (existing.occurrence !== outOfStock.length) {
              existing.occurrence = outOfStock.length;
              existing.lastDetected = timeNow;
              existing.details = `${outOfStock.length} raw material(s) critically depleted (0 in stock) at ${sMap.branchName}: ${matNames}.`;
              changed = true;
            }
          } else {
            alerts.unshift({
              id: alertId,
              type: 'Critical Stock Depletion',
              category: 'data',
              severity: 'critical',
              status: 'ongoing',
              branchLocation: sMap.branchLoc,
              branchName: sMap.branchName,
              branch: `${sMap.branchName} (${sMap.branchLoc})`,
              occurrence: outOfStock.length,
              lastDetected: timeNow,
              details: `${outOfStock.length} raw material(s) critically depleted (0 in stock) at ${sMap.branchName}: ${matNames}.`,
              targetRole: 'Staff',
              targetRoleLabel: 'Store Staff',
              actionLabel: 'Send to Staff'
            });
            changed = true;
          }
        }

        // Find low stock items
        const lowStock = list.filter(m => {
          const s = String(m.status || '').toLowerCase();
          const stock = Number(m.currentStock ?? m.stock ?? m.quantity ?? 100);
          const min = Number(m.minStock ?? m.minThreshold ?? 50);
          return (s === 'low' || s === 'low stock' || stock <= min) && stock > 0;
        });

        if (lowStock.length > 0) {
          const matNames = lowStock.map(m => m.name).slice(0, 3).join(', ') + (lowStock.length > 3 ? ` +${lowStock.length - 3} more` : '');
          const alertId = `alt-lowstock-${sMap.branchLoc.toLowerCase()}`;
          const existing = alerts.find(a => a.id === alertId || (a.type === 'Low Stock Warning' && a.branchLocation === sMap.branchLoc));
          if (existing) {
            if (existing.occurrence !== lowStock.length) {
              existing.occurrence = lowStock.length;
              existing.lastDetected = timeNow;
              existing.details = `${lowStock.length} raw material(s) below safety reorder threshold at ${sMap.branchName}: ${matNames}.`;
              changed = true;
            }
          } else {
            alerts.unshift({
              id: alertId,
              type: 'Low Stock Warning',
              category: 'data',
              severity: 'warning',
              status: 'ongoing',
              branchLocation: sMap.branchLoc,
              branchName: sMap.branchName,
              branch: `${sMap.branchName} (${sMap.branchLoc})`,
              occurrence: lowStock.length,
              lastDetected: timeNow,
              details: `${lowStock.length} raw material(s) below safety reorder threshold at ${sMap.branchName}: ${matNames}.`,
              targetRole: 'Manager',
              targetRoleLabel: 'Store Manager',
              actionLabel: 'Send to Manager'
            });
            changed = true;
          }
        }
      });
    } catch (_) {}

    if (changed) {
      localStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(alerts));
      window.dispatchEvent(new CustomEvent('rmims:alerts-updated', { detail: { alerts } }));
    }
    return alerts;
  } catch (err) {
    console.warn('[SystemAlerts] Operational alerts sync notice:', err);
    return [];
  }
}

export function getAlerts() {
  try {
    syncOperationalAlerts();
    const raw = localStorage.getItem(STORAGE_KEY_ALERTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(a => !isLegacyMockAlert(a));
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(cleaned));
        }
        return cleaned;
      }
    }
  } catch (e) {
    console.warn('Failed reading system alerts from localStorage:', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_ALERTS));
}

export function saveAlerts(alerts) {
  try {
    localStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(alerts));
    window.dispatchEvent(new CustomEvent('rmims:alerts-updated', { detail: { alerts } }));
  } catch (e) {
    console.warn('Failed saving system alerts:', e);
  }
}

function getTelemetry() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TELEMETRY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { loginFailures: {}, incidentCounts: {} };
}

function saveTelemetry(data) {
  try {
    localStorage.setItem(STORAGE_KEY_TELEMETRY, JSON.stringify(data));
  } catch (e) {}
}

function formatCurrentDateTime() {
  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[now.getMonth()];
  const day = String(now.getDate()).padStart(2, '0');
  const year = now.getFullYear();
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${month} ${day}, ${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

// Helper to cleanly parse branch into separate location and store name
export function parseBranch(input, defaultLoc = '', defaultName = '') {
  if (!input) return { location: defaultLoc, name: defaultName, full: defaultName ? `${defaultName}${defaultLoc ? ' (' + defaultLoc + ')' : ''}` : (defaultLoc || '—') };
  if (typeof input === 'object') {
    const loc = input.location || input.branchLocation || defaultLoc;
    const name = input.name || input.branchName || defaultName;
    return { location: loc, name: name, full: name ? `${name}${loc ? ' (' + loc + ')' : ''}` : (loc || '—') };
  }
  const str = String(input).trim();
  const match = str.match(/^(.*?)\s*\((.*?)\)$/);
  if (match) {
    return { name: match[1].trim(), location: match[2].trim(), full: str };
  }
  const dashMatch = str.match(/^(.*?)\s*[-–—]\s*(.*?)$/);
  if (dashMatch) {
    return { name: dashMatch[1].trim(), location: dashMatch[2].trim(), full: str };
  }
  const commaMatch = str.match(/^(.*?)\s*,\s*(.*?)$/);
  if (commaMatch) {
    return { name: commaMatch[1].trim(), location: commaMatch[2].trim(), full: str };
  }
  return { location: defaultLoc, name: str || defaultName, full: str ? (defaultLoc ? `${str} (${defaultLoc})` : str) : (defaultLoc || '—') };
}

/**
 * Record a failed login attempt (Incorrect Password policy rule)
 * Rule 1: Attempt 1 is recorded in telemetry silently. Does NOT appear in system diagnostics.
 * Rule 2: Multiple attempts (>= 3) alert the system diagnostics module.
 * Rule 3: 5 attempts triggers Account Locked (Critical alert, 1x immediate).
 */
export function recordLoginFailure(userOrEmail, branchInput = '') {
  const telemetry = getTelemetry();
  const key = (userOrEmail || 'unknown_user').toLowerCase().trim();
  const currentAttempts = (telemetry.loginFailures[key]?.count || 0) + 1;
  const timeNow = formatCurrentDateTime();
  const bInfo = parseBranch(branchInput);

  telemetry.loginFailures[key] = {
    user: key,
    branchLocation: bInfo.location,
    branchName: bInfo.name,
    branch: bInfo.full,
    count: currentAttempts,
    lastAttempt: timeNow
  };
  saveTelemetry(telemetry);

  // 1st attempt: SILENT - DO NOT alert system diagnostics
  if (currentAttempts < ALERT_THRESHOLDS.INCORRECT_PASSWORD_ALERT) {
    console.info(`[RMIMS Alert Backend]: 1st failed login for "${key}". Recorded in security telemetry silently (No system diagnostics alert generated).`);
    return {
      alerted: false,
      attempts: currentAttempts,
      threshold: ALERT_THRESHOLDS.INCORRECT_PASSWORD_ALERT,
      message: `Failed login attempt #${currentAttempts} logged silently. Threshold for system diagnostics alert is ${ALERT_THRESHOLDS.INCORRECT_PASSWORD_ALERT} attempts.`
    };
  }

  // Threshold reached (>= 3 attempts): ALERT THE MODULE!
  const alerts = getAlerts();
  let existingAlert = alerts.find(a => a.type === 'Incorrect Password' && (a.branchName === bInfo.name || a.branch === bInfo.full) && a.status === 'ongoing');

  if (existingAlert) {
    existingAlert.occurrence = currentAttempts;
    existingAlert.lastDetected = timeNow;
    existingAlert.details = `Multiple failed login attempts detected (${currentAttempts} consecutive attempts for user ${key}).`;
  } else {
    alerts.unshift({
      id: `alt-${Date.now()}`,
      type: 'Incorrect Password',
      category: 'login',
      branchLocation: bInfo.location,
      branchName: bInfo.name,
      branch: bInfo.full,
      occurrence: currentAttempts,
      lastDetected: timeNow,
      status: 'ongoing',
      severity: 'warning',
      details: `Multiple failed login attempts detected (${currentAttempts} consecutive attempts for user ${key}).`,
      targetRole: 'Manager',
      actionLabel: 'Send to Manager'
    });
  }

  // If lockout threshold reached (>= 5): CRITICAL ALERT triggered immediately ("once is enough to alert")
  let accountLocked = false;
  if (currentAttempts >= ALERT_THRESHOLDS.ACCOUNT_LOCKOUT) {
    accountLocked = true;
    let lockAlert = alerts.find(a => a.type === 'Account Locked' && (a.branchName === bInfo.name || a.branch === bInfo.full) && a.status === 'ongoing');
    if (!lockAlert) {
      alerts.unshift({
        id: `alt-lock-${Date.now()}`,
        type: 'Account Locked',
        category: 'login',
        branchLocation: bInfo.location,
        branchName: bInfo.name,
        branch: bInfo.full,
        occurrence: 1, // Once is enough for critical!
        lastDetected: timeNow,
        status: 'ongoing',
        severity: 'critical',
        details: `User account (${key}) temporarily locked due to excessive failed attempts (${currentAttempts} attempts).`,
        targetRole: 'Manager',
        actionLabel: 'Send to Manager'
      });
    }
  }

  saveAlerts(alerts);

  console.warn(`[RMIMS Alert Backend]: Multiple failed attempts (${currentAttempts}) detected! Escalated to System Diagnostics module.`);
  return {
    alerted: true,
    attempts: currentAttempts,
    accountLocked: accountLocked,
    message: `Alert triggered in System Diagnostics module: ${currentAttempts} failed attempts detected.`
  };
}

/**
 * Record a general system incident.
 * Rule: When critical, ONCE IS ENOUGH TO ALERT!
 * When non-critical / warning, requires >= 3 occurrences before alerting.
 */
export function recordSystemIncident({
  type,
  category = 'functional',
  branch = '',
  branchLocation = null,
  branchName = null,
  details = '',
  severity = 'warning',
  targetRole = null,
  actionLabel = null
}) {
  const bInfo = parseBranch(branchLocation && branchName ? { location: branchLocation, name: branchName } : branch);
  const telemetry = getTelemetry();
  const signature = `${type}::${bInfo.full}`;
  const count = (telemetry.incidentCounts[signature] || 0) + 1;
  telemetry.incidentCounts[signature] = count;
  saveTelemetry(telemetry);

  const isCritical = severity === 'critical';
  const timeNow = formatCurrentDateTime();

  // If NOT critical and count is less than threshold (e.g. 1st or 2nd minor glitch), do not alert!
  if (!isCritical && count < ALERT_THRESHOLDS.ROUTINE_INCIDENT) {
    console.info(`[RMIMS Alert Backend]: Non-critical incident "${type}" (count: ${count}). Stored in telemetry; requires ${ALERT_THRESHOLDS.ROUTINE_INCIDENT} occurrences to alert.`);
    return {
      alerted: false,
      count: count,
      threshold: ALERT_THRESHOLDS.ROUTINE_INCIDENT,
      message: `Non-critical incident recorded in telemetry (${count}/${ALERT_THRESHOLDS.ROUTINE_INCIDENT}). No alert triggered.`
    };
  }

  // Determine recipient role
  const recipient = getDiagnosticRecipient({ type, category, branch: bInfo.full });
  const finalRole = targetRole || recipient.role;
  const finalAction = actionLabel || recipient.actionLabel;

  // Either Critical (once is enough!) OR threshold reached:
  const alerts = getAlerts();
  let existing = alerts.find(a => a.type === type && (a.branchName === bInfo.name || a.branch === bInfo.full) && a.status !== 'resolved');

  if (existing) {
    existing.occurrence = isCritical ? existing.occurrence + 1 : count;
    existing.lastDetected = timeNow;
    existing.status = 'ongoing';
    if (details) existing.details = details;
  } else {
    alerts.unshift({
      id: `alt-${Date.now()}`,
      type: type,
      category: category,
      branchLocation: bInfo.location,
      branchName: bInfo.name,
      branch: bInfo.full,
      occurrence: isCritical ? 1 : count, // Critical: 1 occurrence is enough!
      lastDetected: timeNow,
      status: 'ongoing',
      severity: severity,
      details: details || `${type} detected at ${bInfo.full}.`,
      targetRole: finalRole,
      actionLabel: finalAction
    });
  }

  saveAlerts(alerts);
  console.warn(`[RMIMS Alert Backend]: Alert published to System Diagnostics: "${type}" (Severity: ${severity}, Occurrence: ${isCritical ? 1 : count})`);

  return {
    alerted: true,
    isCritical: isCritical,
    occurrence: isCritical ? 1 : count,
    message: isCritical
      ? `Critical alert triggered immediately on 1st occurrence: ${type}`
      : `Threshold met (${count} occurrences): ${type} alerted to module.`
  };
}

/**
 * Clear login failure counter upon successful sign-in
 */
export function clearLoginFailure(userOrEmail) {
  if (!userOrEmail) return;
  const telemetry = getTelemetry();
  const key = userOrEmail.toLowerCase().trim();
  if (telemetry.loginFailures[key]) {
    delete telemetry.loginFailures[key];
    saveTelemetry(telemetry);
  }
}

/**
 * Dispatch / Forward alert to designated contact or maintenance role
 */
export function dispatchAlert(alertId, { role, recipientEmail, message, status = 'monitoring' } = {}) {
  const alerts = getAlerts();
  const alert = alerts.find(a => a.id === alertId);
  if (!alert) return null;

  alert.status = status;
  if (role) alert.targetRole = role;
  alert.dispatchRecord = {
    role: role || alert.targetRole || 'Assigned Contact',
    recipientEmail: recipientEmail || '',
    message: message || '',
    dispatchedAt: formatCurrentDateTime(),
    dispatchedBy: 'Main Admin'
  };

  saveAlerts(alerts);

  // Broadcast interactive notification directly to Manager or Staff portal
  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      const targetRoleStr = String(alert.targetRole || role || '').toLowerCase();
      let targetPortalRole = 'all';
      if (targetRoleStr.includes('manager')) targetPortalRole = 'manager';
      else if (targetRoleStr.includes('staff')) targetPortalRole = 'staff';

      window.pushRMIMSNotification({
        title: `Diagnostic Alert from Admin: ${alert.type}`,
        message: message ? `Administrator note: "${message}". Issue: ${alert.details}` : `Administrator dispatched diagnostic alert: ${alert.details}`,
        category: 'alert',
        badge: 'Action Required',
        role: targetPortalRole,
        targetRole: targetPortalRole,
        roleScope: targetPortalRole,
        priority: alert.severity === 'critical' ? 'critical' : 'warning',
        targetUrl: targetPortalRole === 'manager' ? 'manager/dashboard.html' : 'user/dashboard.html',
        actor: 'Main Administrator'
      });
    }
  } catch (e) {
    console.warn('Failed broadcasting dispatched alert to notifications:', e);
  }

  return alert;
}

/**
 * Resolve an active alert by ID
 */
export function resolveAlertById(alertId) {
  const alerts = getAlerts();
  const alert = alerts.find(a => a.id === alertId);
  if (alert) {
    alert.status = 'resolved';
    saveAlerts(alerts);
    return true;
  }
  return false;
}

/**
 * Calculate Category Counts for the 4 stat metric boxes
 */
export function getCategoryCounts() {
  const alerts = getAlerts();
  const counts = {
    login: 0,
    performance: 0,
    data: 0,
    functional: 0
  };

  alerts.forEach(a => {
    if (a.status !== 'resolved') {
      const cat = a.category || 'functional';
      if (counts[cat] !== undefined) {
        counts[cat] += 1;
      }
    }
  });

  return counts;
}

/**
 * Reset alerts to default seed
 */
export function resetAlertsToDefault() {
  saveAlerts(DEFAULT_ALERTS);
  localStorage.removeItem(STORAGE_KEY_TELEMETRY);
}

// Global exposure for browser console testing
if (typeof window !== 'undefined') {
  window.recordRMIMSIncident = recordSystemIncident;
  window.recordSystemIncident = recordSystemIncident;
  window.syncRMIMSAlerts = syncOperationalAlerts;
  window.RMIMS_AlertService = {
    getAlerts,
    recordLoginFailure,
    recordSystemIncident,
    clearLoginFailure,
    resolveAlertById,
    getCategoryCounts,
    resetAlertsToDefault,
    ALERT_THRESHOLDS
  };
}
