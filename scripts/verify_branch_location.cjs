const fs = require('fs');

const branchHtml = fs.readFileSync('RMIMS/admin/branch-stores.html', 'utf8');
const overviewHtml = fs.readFileSync('RMIMS/admin/overview.html', 'utf8');
const branchJs = fs.readFileSync('RMIMS/js/admin-branch-stores.js', 'utf8');
const shellCss = fs.readFileSync('RMIMS/css/admin-shell.css', 'utf8');

console.log('=== VERIFYING REMOVAL OF UNWANTED ELEMENTS & DARKMODE ===');
const unwanted = [
  'Branch Store & Location Network',
  'Total Branch Stores',
  'Municipal Hubs',
  'Network Gateway Sync',
  'TOTAL REVENUE',
  'totalRevenue',
  '#0B1120',
  '#060B14'
];

let failed = false;
unwanted.forEach(term => {
  const inBranch = branchHtml.includes(term);
  const inOverview = overviewHtml.includes(term);
  const inJs = branchJs.includes(term);
  const inCss = shellCss.includes(term);
  if (inBranch || inOverview || inJs || inCss) {
    console.error(`ERROR: ${term} still present! branch=${inBranch}, overview=${inOverview}, js=${inJs}, css=${inCss}`);
    failed = true;
  }
});

if (failed) {
  process.exit(1);
}

console.log('=== VERIFYING BRANCH MODULE ARCHITECTURE ===');
const requiredBranch = [
  'id="locationDividersContainer"',
  'id="locationStoresModal"',
  'id="locStoresGrid"',
  'id="storeDetailsModal"',
  'id="modalManagersTbody"',
  'id="modalStaffTbody"',
  'window.backToLocationBranches()',
  'btn-add-branch-pill'
];

requiredBranch.forEach(id => {
  if (!branchHtml.includes(id)) {
    console.error(`ERROR: Missing in branch-stores.html: ${id}`);
    process.exit(1);
  }
});
console.log('branch-stores.html: All required containers, modals & pill buttons verified!');

console.log('=== VERIFYING OVERVIEW PURITY (NO LOCATION MODALS OR DIVIDERS) ===');
const forbiddenOverview = [
  'id="overviewLocationDividersContainer"',
  'id="locationDividersContainer"',
  'id="locationStoresModal"',
  'id="storeDetailsModal"',
  'admin-branch-stores.js'
];

forbiddenOverview.forEach(id => {
  if (overviewHtml.includes(id)) {
    console.error(`ERROR: overview.html MUST NOT contain ${id}!`);
    process.exit(1);
  }
});

if (!overviewHtml.includes('overviewBranchStoresTbody')) {
  console.error('ERROR: overview.html must contain overviewBranchStoresTbody summary table!');
  process.exit(1);
}
console.log('overview.html: Verified pure executive overview table, NO location dividers or modals!');

console.log('=== ALL SPEC CHECKS PASSED SUCCESSFULLY ===');
