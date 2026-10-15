// scripts/verify_branch_separation.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');

console.log('--- VERIFYING BRANCH SEPARATION ACROSS MODULES ---');

// 1. System Alerts
const alertsHtmlPath = path.join(root, 'RMIMS', 'admin', 'system-alerts.html');
const alertsHtml = fs.readFileSync(alertsHtmlPath, 'utf8');
assert(alertsHtml.includes('<th>Branch Location</th>'), 'system-alerts.html must have <th>Branch Location</th>');
assert(alertsHtml.includes('<th>Branch Name</th>'), 'system-alerts.html must have <th>Branch Name</th>');
assert(!alertsHtml.includes('<th>Affected Branch Store</th>'), 'system-alerts.html must not have legacy single branch store header');
console.log('✓ system-alerts.html headers verified');

const alertsJsPath = path.join(root, 'RMIMS', 'js', 'admin-system-alerts.js');
const alertsJs = fs.readFileSync(alertsJsPath, 'utf8');
assert(alertsJs.includes('locText') && alertsJs.includes('nameText'), 'admin-system-alerts.js must handle separated branch loc and name');
console.log('✓ admin-system-alerts.js separation verified');

// 2. User Management
const userMgmtHtmlPath = path.join(root, 'RMIMS', 'admin', 'user-management.html');
const userMgmtHtml = fs.readFileSync(userMgmtHtmlPath, 'utf8');
assert(userMgmtHtml.includes('<th>BRANCH LOCATION</th>'), 'user-management.html pendingTable / dirTable must have <th>BRANCH LOCATION</th>');
assert(userMgmtHtml.includes('<th>BRANCH NAME</th>'), 'user-management.html pendingTable / dirTable must have <th>BRANCH NAME</th>');
assert(userMgmtHtml.includes('id="newUserBranchLoc"'), 'user-management.html Add User modal must have newUserBranchLoc');
assert(userMgmtHtml.includes('id="newUserBranchName"'), 'user-management.html Add User modal must have newUserBranchName');
assert(userMgmtHtml.includes('id="editUserBranchLoc"'), 'user-management.html Edit User modal must have editUserBranchLoc');
assert(userMgmtHtml.includes('id="editUserBranchName"'), 'user-management.html Edit User modal must have editUserBranchName');
console.log('✓ user-management.html headers & modals verified');

const userMgmtJsPath = path.join(root, 'RMIMS', 'js', 'admin-user-management.js');
const userMgmtJs = fs.readFileSync(userMgmtJsPath, 'utf8');
assert(userMgmtJs.includes('branchLoc') && userMgmtJs.includes('branchName'), 'admin-user-management.js must handle branchLoc and branchName');
console.log('✓ admin-user-management.js controller separation verified');

// 3. Activity Logs
const activityHtmlPath = path.join(root, 'RMIMS', 'admin', 'activity-logs.html');
const activityHtml = fs.readFileSync(activityHtmlPath, 'utf8');
assert(activityHtml.includes('<th>Branch Location</th>'), 'activity-logs.html must have <th>Branch Location</th>');
assert(activityHtml.includes('<th>Branch Name</th>'), 'activity-logs.html must have <th>Branch Name</th>');
console.log('✓ activity-logs.html headers verified');

const activityJsPath = path.join(root, 'RMIMS', 'js', 'admin-activity-logs.js');
const activityJs = fs.readFileSync(activityJsPath, 'utf8');
assert(activityJs.includes("'Branch Location'") && activityJs.includes("'Branch Name'"), 'admin-activity-logs.js CSV export must have separated headers');
console.log('✓ admin-activity-logs.js CSV export headers verified');

// 4. Overview
const overviewHtmlPath = path.join(root, 'RMIMS', 'admin', 'overview.html');
const overviewHtml = fs.readFileSync(overviewHtmlPath, 'utf8');
assert(overviewHtml.includes('<th>Branch Location</th>'), 'overview.html must have <th>Branch Location</th>');
assert(overviewHtml.includes('<th>Branch Name</th>'), 'overview.html must have <th>Branch Name</th>');
assert(!overviewHtml.includes('<th>Affected Branch Store</th>'), 'overview.html alerts table must not have legacy single affected branch store');
console.log('✓ overview.html tables verified');

const overviewJsPath = path.join(root, 'RMIMS', 'js', 'admin-overview.js');
const overviewJs = fs.readFileSync(overviewJsPath, 'utf8');
assert(overviewJs.includes('locText') && overviewJs.includes('nameText'), 'admin-overview.js must handle separated branch loc and name');
console.log('✓ admin-overview.js alert rendering separation verified');

console.log('\n===========================================');
console.log('ALL VERIFICATIONS PASSED SUCCESSFULLY (100%)');
console.log('===========================================');
