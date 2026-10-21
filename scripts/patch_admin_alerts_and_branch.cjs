const fs = require('fs');
const path = require('path');

console.log('=== Patching System Alerts Connection & Admin Branch Location ===');

// 1. Patch RMIMS/js/system-alerts-service.js
const alertsServicePath = path.join(__dirname, '..', 'RMIMS', 'js', 'system-alerts-service.js');
let alertsServiceContent = fs.readFileSync(alertsServicePath, 'utf8');

// A. Fix isLegacyMockAlert: Remove real company names 'kxc' and 'scones' so real alerts are never purged!
alertsServiceContent = alertsServiceContent.replace(
  /function isLegacyMockAlert\(alert\)\s*\{[\s\S]*?return\s*\([\s\S]*?\);\s*\}/,
  `function isLegacyMockAlert(alert) {
  if (!alert) return false;
  const str = \`\${alert.id || ''} \${alert.type || ''} \${alert.details || ''} \${alert.branch || ''} \${alert.branchLocation || ''}\`.toLowerCase();
  return (
    str.includes('simulated_user') ||
    str.includes('regional storage cluster') ||
    str.includes('demo_alert') ||
    str.includes('mock_alert') ||
    str.includes('slow response time (avg. 6.2s')
  );
}`
);
console.log('✓ Fixed isLegacyMockAlert in system-alerts-service.js (retained Scones & KXC real alerts)');

// B. Add syncOperationalAlerts function to bridge user operations (transactions, inventory, stockouts) into system alerts
const syncOperationalAlertsFunc = `
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
          const alertId = \`alt-rej-\${ref.toLowerCase().replace(/[^a-z0-9]/g, '_')}\`;
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
              details: \`Transaction \${ref} was rejected by Store Manager: "\${reason}". Action required by store personnel.\`,
              targetRole: 'Store Manager',
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
          const matNames = outOfStock.map(m => m.name).slice(0, 3).join(', ') + (outOfStock.length > 3 ? \` +\${outOfStock.length - 3} more\` : '');
          const alertId = \`alt-depleted-\${sMap.branchLoc.toLowerCase()}\`;
          const existing = alerts.find(a => a.id === alertId || (a.type === 'Critical Stock Depletion' && a.branchLocation === sMap.branchLoc));
          if (existing) {
            if (existing.occurrence !== outOfStock.length) {
              existing.occurrence = outOfStock.length;
              existing.lastDetected = timeNow;
              existing.details = \`\${outOfStock.length} raw material(s) critically depleted (0 in stock) at \${sMap.branchName}: \${matNames}.\`;
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
              branch: \`\${sMap.branchName} (\${sMap.branchLoc})\`,
              occurrence: outOfStock.length,
              lastDetected: timeNow,
              details: \`\${outOfStock.length} raw material(s) critically depleted (0 in stock) at \${sMap.branchName}: \${matNames}.\`,
              targetRole: 'Inventory Staff',
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
          const matNames = lowStock.map(m => m.name).slice(0, 3).join(', ') + (lowStock.length > 3 ? \` +\${lowStock.length - 3} more\` : '');
          const alertId = \`alt-lowstock-\${sMap.branchLoc.toLowerCase()}\`;
          const existing = alerts.find(a => a.id === alertId || (a.type === 'Low Stock Warning' && a.branchLocation === sMap.branchLoc));
          if (existing) {
            if (existing.occurrence !== lowStock.length) {
              existing.occurrence = lowStock.length;
              existing.lastDetected = timeNow;
              existing.details = \`\${lowStock.length} raw material(s) below safety reorder threshold at \${sMap.branchName}: \${matNames}.\`;
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
              branch: \`\${sMap.branchName} (\${sMap.branchLoc})\`,
              occurrence: lowStock.length,
              lastDetected: timeNow,
              details: \`\${lowStock.length} raw material(s) below safety reorder threshold at \${sMap.branchName}: \${matNames}.\`,
              targetRole: 'Store Manager',
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
`;

if (!alertsServiceContent.includes('export function syncOperationalAlerts')) {
  alertsServiceContent = alertsServiceContent.replace('export function getAlerts() {', `${syncOperationalAlertsFunc}\nexport function getAlerts() {`);
  console.log('✓ Added syncOperationalAlerts to system-alerts-service.js');
}

// In getAlerts(), call syncOperationalAlerts before returning
alertsServiceContent = alertsServiceContent.replace(
  /export function getAlerts\(\)\s*\{[\s\S]*?return JSON\.parse\(JSON\.stringify\(DEFAULT_ALERTS\)\);\s*\}/,
  `export function getAlerts() {
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
}`
);

// C. In dispatchAlert, broadcast live notification to the target role (Manager or Staff)
alertsServiceContent = alertsServiceContent.replace(
  /export function dispatchAlert\(alertId,[\s\S]*?saveAlerts\(alerts\);\s*return alert;\s*\}/,
  `export function dispatchAlert(alertId, { role, recipientEmail, message, status = 'monitoring' } = {}) {
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
        title: \`Diagnostic Alert from Admin: \${alert.type}\`,
        message: message ? \`Administrator note: "\${message}". Issue: \${alert.details}\` : \`Administrator dispatched diagnostic alert: \${alert.details}\`,
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
}`
);

// D. Add window bindings at the bottom of system-alerts-service.js
if (!alertsServiceContent.includes('window.recordRMIMSIncident')) {
  alertsServiceContent = alertsServiceContent.replace(
    'if (typeof window !== \'undefined\') {',
    `if (typeof window !== 'undefined') {
  window.recordRMIMSIncident = recordSystemIncident;
  window.recordSystemIncident = recordSystemIncident;
  window.syncRMIMSAlerts = syncOperationalAlerts;`
  );
}

fs.writeFileSync(alertsServicePath, alertsServiceContent, 'utf8');
console.log('✓ Updated system-alerts-service.js');


// 2. Patch RMIMS/js/rmims-notifications.js to bridge notifications into System Alerts
const notifPath = path.join(__dirname, '..', 'RMIMS', 'js', 'rmims-notifications.js');
let notifContent = fs.readFileSync(notifPath, 'utf8');

const bridgeMarker = '// Public API to push live notifications';
if (!notifContent.includes('// Bridge to System Alerts if incoming notification')) {
  const targetPushHeader = 'window.pushRMIMSNotification = function (notif) {';
  const bridgeHook = `window.pushRMIMSNotification = function (notif) {
    if (!notif) return;

    // Bridge user operations to System Alerts
    try {
      if (typeof window !== 'undefined' && typeof window.recordRMIMSIncident === 'function') {
        const nTitle = String(notif.title || '').toLowerCase();
        const nBadge = String(notif.badge || '').toLowerCase();
        const nMsg = String(notif.message || '');
        const bName = notif.branch || notif.branchName || 'Store Branch';

        if (nTitle.includes('rejected') || nBadge.includes('rejected')) {
          window.recordRMIMSIncident({
            type: 'Transaction Rejected by Manager',
            category: 'functional',
            severity: 'warning',
            branch: bName,
            details: nMsg || notif.title,
            targetRole: 'Store Manager',
            actionLabel: 'Send to Manager'
          });
        } else if (nTitle.includes('low stock') || nBadge.includes('low stock')) {
          window.recordRMIMSIncident({
            type: 'Low Stock Warning',
            category: 'data',
            severity: 'warning',
            branch: bName,
            details: nMsg || notif.title,
            targetRole: 'Inventory Staff',
            actionLabel: 'Send to Staff'
          });
        }
      }
    } catch (_) {}
`;
  notifContent = notifContent.replace(targetPushHeader, bridgeHook);
  fs.writeFileSync(notifPath, notifContent, 'utf8');
  console.log('✓ Bridged rmims-notifications.js with System Alerts');
}


// 3. Patch RMIMS/js/admin-user-management.js for Admin Branch Location = Headquarters
const userMgmtPath = path.join(__dirname, '..', 'RMIMS', 'js', 'admin-user-management.js');
let userMgmtContent = fs.readFileSync(userMgmtPath, 'utf8');

// Ensure MASTER_ADMIN_RECORD has Headquarters
userMgmtContent = userMgmtContent.replace(/branchLoc:\s*'(Lucena|Unassigned|Headquarters)'/, "branchLoc: 'Headquarters'");
userMgmtContent = userMgmtContent.replace(/branchName:\s*'(Scones & Muffins Store|Main Administration|Headquarters)'/, "branchName: 'Headquarters'");

// In getStoredRegisteredUsers(), enforce that Admin (Zeanna) has Headquarters
userMgmtContent = userMgmtContent.replace(
  /\/\/ Ensure Master Admin Zeanna is present[\s\S]*?if \(!hasAdmin\) \{[\s\S]*?list\.unshift\(MASTER_ADMIN_RECORD\);[\s\S]*?\}/,
  `// Ensure Master Admin Zeanna is present with Headquarters location (separate from the two store companies)
      list = list.map(u => {
        if (!u) return u;
        const role = String(u.role || '').toLowerCase();
        const email = String(u.email || '').toLowerCase();
        const name = String(u.name || '').toLowerCase();
        const user = String(u.username || '').toLowerCase();
        if (role === 'administrator' || role === 'admin' || email === 'calusinzeanna3@gmail.com' || name === 'zeanna' || user === 'zeanna' || user === 'calusinzeanna3') {
          return {
            ...u,
            branchLoc: 'Headquarters',
            branchName: 'Headquarters',
            role: 'Administrator'
          };
        }
        return u;
      });

      const hasAdmin = list.some(u => 
        (u.email && u.email.toLowerCase() === 'calusinzeanna3@gmail.com') ||
        (u.name && u.name.toLowerCase() === 'zeanna')
      );
      if (!hasAdmin) {
        list.unshift(MASTER_ADMIN_RECORD);
      }`
);

fs.writeFileSync(userMgmtPath, userMgmtContent, 'utf8');
console.log('✓ Updated admin-user-management.js: Admin branch location set to Headquarters');


// 4. Patch RMIMS/supabase/admin-supabase-service.js
const adminSrvPath = path.join(__dirname, '..', 'RMIMS', 'supabase', 'admin-supabase-service.js');
let adminSrvContent = fs.readFileSync(adminSrvPath, 'utf8');

// In fetchRegisteredUsers, enforce Headquarters for Admin
adminSrvContent = adminSrvContent.replace(
  /branchLoc:\s*u\.branch_location\s*\|\|\s*\(u\.role === 'admin' \? 'Headquarters' : 'Unassigned'\),/,
  `branchLoc: (u.role === 'admin' || u.role === 'superadmin' || u.operational_role === 'admin' || (u.email && u.email.toLowerCase() === 'calusinzeanna3@gmail.com') || (u.name && u.name.toLowerCase() === 'zeanna')) ? 'Headquarters' : (u.branch_location || 'Unassigned'),`
);

adminSrvContent = adminSrvContent.replace(
  /branchName:\s*u\.branch_name\s*\|\|\s*\(u\.role === 'admin' \? 'Main Administration' : 'Branch Store'\),/,
  `branchName: (u.role === 'admin' || u.role === 'superadmin' || u.operational_role === 'admin' || (u.email && u.email.toLowerCase() === 'calusinzeanna3@gmail.com') || (u.name && u.name.toLowerCase() === 'zeanna')) ? 'Headquarters' : (u.branch_name || 'Branch Store'),`
);

fs.writeFileSync(adminSrvPath, adminSrvContent, 'utf8');
console.log('✓ Updated admin-supabase-service.js: fetchRegisteredUsers maps Admin to Headquarters');


// 5. Patch RMIMS/supabase/auth-service.js
const authSrvPath = path.join(__dirname, '..', 'RMIMS', 'supabase', 'auth-service.js');
let authSrvContent = fs.readFileSync(authSrvPath, 'utf8');

authSrvContent = authSrvContent.replace(
  /branchName:\s*profile\.branch_name\s*\|\|\s*\(isScones \? "Scones & Muffins Store" : "Branch Store"\),/,
  `branchName: isAdmin ? "Headquarters" : (profile.branch_name || (isScones ? "Scones & Muffins Bakery" : "Branch Store")),`
);

authSrvContent = authSrvContent.replace(
  /branchLocation:\s*profile\.branch_location\s*\|\|\s*"Lucena",/,
  `branchLocation: isAdmin ? "Headquarters" : (profile.branch_location || "Lucena"),`
);

authSrvContent = authSrvContent.replace(
  /branchStore:\s*profile\.branch_store\s*\|\|\s*\(isScones \? "Scones & Muffins Bakery \(Lucena\)" : "Branch Store \(Lucena\)"\),/,
  `branchStore: isAdmin ? "Headquarters" : (profile.branch_store || (isScones ? "Scones & Muffins Bakery (Lucena)" : "Branch Store")),`
);

// Also pass user store & branch into recordLoginFailure
authSrvContent = authSrvContent.replace(
  /if \(msg\.includes\("invalid"\) \|\| msg\.includes\("credential"\) \|\| msg\.includes\("password"\)\) \{\s*recordLoginFailure\(email\);\s*\}/,
  `if (msg.includes("invalid") || msg.includes("credential") || msg.includes("password")) {
                let userBranch = "Lucena";
                let userStore = "Scones & Muffins Bakery";
                try {
                    const clean = cleanEmailInput.toLowerCase().trim();
                    if (clean.includes("kxc") || clean.includes("tiaong") || clean.includes("glazel")) {
                        userBranch = "Tiaong";
                        userStore = "KXC 5-Year Enterprise";
                    }
                } catch (_) {}
                recordLoginFailure(cleanEmailInput, \`\${userStore} (\${userBranch})\`);
            }`
);

fs.writeFileSync(authSrvPath, authSrvContent, 'utf8');
console.log('✓ Updated auth-service.js: Admin session branch set to Headquarters and login failures track store');

console.log('=== All Patches Applied Successfully ===');
