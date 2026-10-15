const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'RMIMS', 'admin', 'branch-stores.html');
const jsPath = path.join(__dirname, '..', 'RMIMS', 'js', 'admin-branch-stores.js');
const cssPath = path.join(__dirname, '..', 'RMIMS', 'css', 'admin-shell.css');

console.log('--- Verifying Branch Stores Location & Card-in-Card Architecture ---');

// 1. Check HTML
const html = fs.readFileSync(htmlPath, 'utf8');

const requiredHtmlSnippets = [
  'kpi-stat-card',
  'kpiTotalStores',
  'kpiTotalLocations',
  'kpiTotalPersonnel',
  'kpiSyncHealth',
  'branch-network-toolbar',
  'branchCardSearchInput',
  'location-branch-card',
  'Tiaong Municipality',
  'Lucena City',
  'stores-subgrid',
  'store-box-card',
  'KXC Enterprises',
  "Tiaong Baker's Choice",
  'Scones &amp; Muffins',
  'Lucena Bakers Hub',
  'store-access-section',
  'Authorized System Personnel',
  'assignees-list-preview',
  'assignee-row-mini',
  'role-pill manager',
  'role-pill staff',
  'btn-enter-store',
  'storeDetailsModal',
  'modalPersonnelTbody',
  'addBranchModal'
];

let htmlPass = true;
for (const snippet of requiredHtmlSnippets) {
  if (!html.includes(snippet)) {
    console.error(`FAIL: Missing snippet in branch-stores.html: "${snippet}"`);
    htmlPass = false;
  }
}
if (htmlPass) console.log('PASS: HTML contains hierarchical location boxes, store inner cards, and personnel access lists.');

// 2. Check JS
const js = fs.readFileSync(jsPath, 'utf8');
const requiredJsSnippets = [
  'STORES_DATA',
  'openStoreDetails',
  'submitAddBranch',
  'openAddStoreForLocation',
  'applyFilters',
  'btnAssignNewStaff'
];

let jsPass = true;
for (const snippet of requiredJsSnippets) {
  if (!js.includes(snippet)) {
    console.error(`FAIL: Missing JS snippet in admin-branch-stores.js: "${snippet}"`);
    jsPass = false;
  }
}
if (jsPass) console.log('PASS: JS controller handles store data model, modals, and dynamic location cards.');

// 3. Check CSS
const css = fs.readFileSync(cssPath, 'utf8');
const requiredCssSnippets = [
  '.location-branch-card',
  '.location-card-header',
  '.stores-subgrid',
  '.store-box-card',
  '.store-access-section',
  '.role-pill.manager',
  '.role-pill.comanager',
  '.role-pill.staff',
  '.btn-enter-store',
  '.store-modal-card'
];

let cssPass = true;
for (const snippet of requiredCssSnippets) {
  if (!css.includes(snippet)) {
    console.error(`FAIL: Missing CSS selector in admin-shell.css: "${snippet}"`);
    cssPass = false;
  }
}
if (cssPass) console.log('PASS: CSS contains all styling for location boxes, store inner cards, and access badges.');

if (htmlPass && jsPass && cssPass) {
  console.log('SUCCESS: Branch Stores hierarchical redesign verification completely PASSED!');
  process.exit(0);
} else {
  process.exit(1);
}
