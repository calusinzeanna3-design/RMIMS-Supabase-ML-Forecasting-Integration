const fs = require('fs');
const path = require('path');

console.log('=== Verifying Branch Stores View Redesign (Image 1 & Image 2) ===');

const branchHtmlPath = path.join(__dirname, '..', 'RMIMS', 'admin', 'branch-stores.html');
const overviewHtmlPath = path.join(__dirname, '..', 'RMIMS', 'admin', 'overview.html');
const branchJsPath = path.join(__dirname, '..', 'RMIMS', 'js', 'admin-branch-stores.js');
const overviewJsPath = path.join(__dirname, '..', 'RMIMS', 'js', 'admin-overview.js');
const cssPath = path.join(__dirname, '..', 'RMIMS', 'css', 'admin-shell.css');

let allPassed = true;

// 1. Verify CSS contains Image 1 and Image 2 classes
const css = fs.readFileSync(cssPath, 'utf8');
const requiredCss = [
  '.branch-dir-intro',
  '.branch-dir-title',
  '.branch-dir-subtitle',
  '.branch-stores-directory-grid',
  '.branch-card-dark',
  '.branch-card-header',
  '.branch-card-stats-grid',
  '.branch-card-footer',
  '.btn-view-details-arrow',
  '.store-modal-overlay-dark',
  '.store-modal-window-dark',
  '.store-modal-kpi-row',
  '.store-kpi-tile-dark',
  '.role-section-header',
  '.role-table-dark',
  '.access-code-badge',
  '.role-status-approved',
  '.destructive-actions-card',
  '.btn-destructive-delete'
];

for (const sel of requiredCss) {
  if (!css.includes(sel)) {
    console.error(`FAIL: CSS missing selector "${sel}"`);
    allPassed = false;
  }
}
if (allPassed) console.log('PASS: CSS includes all Image 1 & Image 2 styling rules.');

// 2. Verify branch-stores.html
const branchHtml = fs.readFileSync(branchHtmlPath, 'utf8');
const requiredBranchHtml = [
  'Branch Stores Directory',
  'Select any branch store card below to view its assigned Managers and Staff members, or delete the branch.',
  'branchStoresDirectoryGrid',
  'storeDetailsModal',
  'modalStoreTitle',
  'modalStoreSubtitle',
  'modalKpiManagersVal',
  'modalKpiStaffVal',
  'modalKpiOutputVal',
  'modalKpiRevenueVal',
  'modalManagersTbody',
  'modalStaffTbody',
  'Destructive Store Actions',
  'deleteBranchStore()'
];

for (const snippet of requiredBranchHtml) {
  if (!branchHtml.includes(snippet)) {
    console.error(`FAIL: branch-stores.html missing snippet "${snippet}"`);
    allPassed = false;
  }
}
// Verify old messy Image 3 inline personnel rows are removed
const oldMessySnippets = [
  'assignees-list-preview',
  'Tiaong Municipality',
  'store-box-card'
];
for (const bad of oldMessySnippets) {
  if (branchHtml.includes(bad)) {
    console.error(`FAIL: branch-stores.html still contains messy Image 3 snippet "${bad}"`);
    allPassed = false;
  }
}
if (allPassed) console.log('PASS: branch-stores.html successfully updated to Image 1 directory & Image 2 modal.');

// 3. Verify overview.html
const overviewHtml = fs.readFileSync(overviewHtmlPath, 'utf8');
const requiredOverviewHtml = [
  'overviewBranchStoresGrid',
  'storeDetailsModal',
  'modalManagersTbody',
  'modalStaffTbody',
  'admin-branch-stores.js'
];
for (const snippet of requiredOverviewHtml) {
  if (!overviewHtml.includes(snippet)) {
    console.error(`FAIL: overview.html missing snippet "${snippet}"`);
    allPassed = false;
  }
}
if (allPassed) console.log('PASS: overview.html successfully updated with Image 1 grid and Image 2 modal.');

// 4. Verify admin-branch-stores.js
const branchJs = fs.readFileSync(branchJsPath, 'utf8');
const requiredJs = [
  'DEFAULT_STORES_DATA',
  'renderBranchStoresCards',
  'openStoreDetails',
  'closeStoreDetails',
  'deleteBranchStore',
  'submitAddBranch',
  'accessCode'
];
for (const snippet of requiredJs) {
  if (!branchJs.includes(snippet)) {
    console.error(`FAIL: admin-branch-stores.js missing snippet "${snippet}"`);
    allPassed = false;
  }
}
if (allPassed) console.log('PASS: admin-branch-stores.js contains all data models and handlers.');

// 5. Verify admin-overview.js
const overviewJs = fs.readFileSync(overviewJsPath, 'utf8');
if (!overviewJs.includes('renderBranchStoresCards')) {
  console.error('FAIL: admin-overview.js does not call renderBranchStoresCards');
  allPassed = false;
} else {
  console.log('PASS: admin-overview.js calls renderBranchStoresCards.');
}

if (allPassed) {
  console.log('\n>>> ALL CHECKS PASSED SUCCESSFULLY! <<<');
  process.exit(0);
} else {
  console.error('\n>>> SOME CHECKS FAILED! <<<');
  process.exit(1);
}
