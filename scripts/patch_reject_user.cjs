const fs = require('fs');
const path = require('path');

console.log('--- Applying Reject User Account in admin-user-management.js ---');

const userMgmtPath = path.join(__dirname, '..', 'RMIMS', 'js', 'admin-user-management.js');
let userMgmtContent = fs.readFileSync(userMgmtPath, 'utf8');

const targetHeader = 'window.rejectUser = function (param) {';
const nextSection = '// Pagination Controls';

const startIdx = userMgmtContent.indexOf(targetHeader);
const endIdx = userMgmtContent.indexOf(nextSection, startIdx);

if (startIdx !== -1 && endIdx !== -1) {
  const newRejectUser = `window.rejectUser = async function (param) {
    const pendingList = getStoredPendingUsers();
    let target = pendingList.find(u => String(u.id) === String(param));
    let row = document.getElementById(param) || document.getElementById(\`req_\${param}\`);
    let name = target ? target.name : (row ? row.getAttribute('data-name') : 'User');
    let email = target ? target.email : (row ? row.getAttribute('data-email') : '');
    let username = target ? target.username : (row ? row.getAttribute('data-username') : '');

    const remaining = pendingList.filter(u => String(u.id) !== String(param) && \`req_\${u.id}\` !== String(param));
    saveStoredPendingUsers(remaining);

    // Also remove from registered directory if present
    try {
      const regList = getStoredRegisteredUsers();
      const updatedReg = regList.filter(u => String(u.id) !== String(param) && (email ? u.email?.toLowerCase() !== email.toLowerCase() : true));
      saveStoredRegisteredUsers(updatedReg);
    } catch (_) {}

    // Synchronize rejection directly to Supabase user_profiles (status: inactive)
    try {
      const srv = adminSrv || (await import('../supabase/admin-supabase-service.js'));
      if (srv && typeof srv.rejectUserAccount === 'function') {
        await srv.rejectUserAccount({
          id: target?.id || param,
          email: email,
          username: username,
          name: name
        });
      }
    } catch (err) {
      console.warn('[AdminUserManagement] Supabase rejection notice:', err.message || err);
    }

    // Log Activity
    try {
      const act = JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]');
      act.unshift({
        id: \`act-\${Date.now()}\`,
        timestamp: new Date().toISOString(),
        date: getLiveTodayISO(),
        user: 'Admin',
        role: 'Main Admin',
        branch: 'Headquarters',
        branchLoc: 'Headquarters',
        branchName: 'Headquarters',
        action: 'Rejected Account',
        module: 'User Management',
        details: \`Rejected registration request for \${name}\`,
        status: 'success'
      });
      localStorage.setItem('rmims_manager_activities', JSON.stringify(act.slice(0, 50)));
    } catch (_) {}

    renderPendingUsers();
    refreshCounters();

    // Broadcast live notification across all portals (Admin, Manager, Staff)
    try {
      if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
        window.pushRMIMSNotification({
          title: \`Registration Rejected: \${name}\`,
          message: \`Registration request for \${name} was rejected by Administrator.\`,
          category: 'Activity',
          badge: 'User Management',
          role: 'admin',
          targetRole: 'admin',
          roleScope: 'admin',
          priority: 'normal',
          targetUrl: 'admin/user-management.html',
          actor: 'Administrator'
        });
      }
    } catch (e) {}

    if (window.showAdminToast) {
      window.showAdminToast(\`Rejected registration for \${name}.\`, 'danger');
    }
  };

  `;

  userMgmtContent = userMgmtContent.slice(0, startIdx) + newRejectUser + userMgmtContent.slice(endIdx);
  fs.writeFileSync(userMgmtPath, userMgmtContent, 'utf8');
  console.log('✓ Successfully replaced window.rejectUser with Supabase sync in admin-user-management.js');
} else {
  console.error('❌ Could not locate indices for window.rejectUser', { startIdx, endIdx });
}
