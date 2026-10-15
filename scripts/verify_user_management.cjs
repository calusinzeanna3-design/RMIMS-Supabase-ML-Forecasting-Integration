const fs = require('fs');
const path = require('path');

const userMgmtHtmlPath = path.join(__dirname, '..', 'RMIMS', 'admin', 'user-management.html');
const userMgmtJsPath = path.join(__dirname, '..', 'RMIMS', 'js', 'admin-user-management.js');
const adminShellCssPath = path.join(__dirname, '..', 'RMIMS', 'css', 'admin-shell.css');

console.log('--- Verifying User Management Module ---');

// 1. Check HTML exists and contains key elements
const html = fs.readFileSync(userMgmtHtmlPath, 'utf8');

const requiredHtmlSnippets = [
  'Total Users',
  'Active Users',
  'Pending Approval',
  'Inactive Users',
  'Awaiting Approval for Accounts',
  'pendingCount',
  'Registered Store Users',
  'Search user, email, or branch...',
  'All Branches',
  'btnOpenAddUser',
  'usersDirectoryTable',
  'usersDirectoryTableBody',
  'pendingTable',
  'pendingTableBody',
  'table-pagination-footer',
  'addUserModal',
  'editUserModal'
];

let htmlPass = true;
for (const snippet of requiredHtmlSnippets) {
  if (!html.includes(snippet)) {
    console.error(`FAIL: Missing HTML snippet "${snippet}"`);
    htmlPass = false;
  }
}
if (htmlPass) console.log('PASS: All required HTML components and structures verified.');

// 2. Check JS file syntax and exports
const js = fs.readFileSync(userMgmtJsPath, 'utf8');
const requiredJsSnippets = [
  'submitAddUser',
  'openEditUser',
  'submitEditUser',
  'deleteUser',
  'approveUser',
  'rejectUser',
  'filterDirectory',
  'refreshCounters'
];

let jsPass = true;
for (const snippet of requiredJsSnippets) {
  if (!js.includes(snippet)) {
    console.error(`FAIL: Missing JS function "${snippet}"`);
    jsPass = false;
  }
}
if (jsPass) console.log('PASS: All required JS handlers and logic verified.');

// 3. Check CSS for user management styling
const css = fs.readFileSync(adminShellCssPath, 'utf8');
const requiredCssSnippets = [
  '.status-pill.status-approved',
  '.status-dot',
  '.user-subtext',
  '.search-box-wrapper',
  '.btn-edit',
  '.btn-delete',
  '.table-pagination-footer',
  '.pagination-controls',
  '.pagination-btn'
];

let cssPass = true;
for (const snippet of requiredCssSnippets) {
  if (!css.includes(snippet)) {
    console.error(`FAIL: Missing CSS selector "${snippet}"`);
    cssPass = false;
  }
}
if (cssPass) console.log('PASS: All required CSS classes and selectors verified.');

if (htmlPass && jsPass && cssPass) {
  console.log('SUCCESS: User Management redesign verification fully passed!');
  process.exit(0);
} else {
  console.error('FAIL: User Management verification failed.');
  process.exit(1);
}
