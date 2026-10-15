const fs = require('fs');
const path = require('path');

const overviewPath = path.join(__dirname, '..', 'RMIMS', 'admin', 'overview.html');
const cssPath = path.join(__dirname, '..', 'RMIMS', 'css', 'admin-shell.css');
const jsPath = path.join(__dirname, '..', 'RMIMS', 'js', 'admin-overview.js');

console.log('--- Verifying Overview UI & Modules Integrity ---');

// 1. Check overview.html
const overviewHtml = fs.readFileSync(overviewPath, 'utf8');

const requiredSelectors = [
  'chartRangeSelect',
  'usageDateRangeSpan',
  'branchUsageChart',
  'kpiActiveUsersToday',
  'kpiSystemActionsToday',
  'overviewApprovalTable',
  'overviewApprovalTableBody',
  'overviewBranchStoresTbody',
  'overviewAlertsTableBody',
  'overviewActivityTableBody'
];

let failed = 0;
for (const sel of requiredSelectors) {
  if (!overviewHtml.includes(sel)) {
    console.error(`❌ Missing in overview.html: ${sel}`);
    failed++;
  } else {
    console.log(`✅ Found in overview.html: ${sel}`);
  }
}

// 3. Check CSS rules
const cssContent = fs.readFileSync(cssPath, 'utf8');
const cssClasses = [
  '.branch-cards-grid',
  '.branch-store-item',
  '.branch-store-thumb',
  '.branch-store-thumb.amber',
  '.branch-store-thumb.sky',
  '.branch-store-thumb.purple',
  '.branch-store-stats',
  '.store-stat-mini',
  '.btn-store-details'
];
for (const cls of cssClasses) {
  if (!cssContent.includes(cls)) {
    console.error(`❌ Missing CSS class in admin-shell.css: ${cls}`);
    failed++;
  } else {
    console.log(`✅ Found CSS class in admin-shell.css: ${cls}`);
  }
}

// 4. Check admin-overview.js
const jsContent = fs.readFileSync(jsPath, 'utf8');
if (!jsContent.includes('approveOverviewAccount') || !jsContent.includes('rejectOverviewAccount')) {
  console.error('❌ Missing approval functions in admin-overview.js');
  failed++;
} else {
  console.log('✅ Found approval functions in admin-overview.js');
}

if (failed > 0) {
  console.error(`Verification FAILED with ${failed} issues.`);
  process.exit(1);
} else {
  console.log('🎉 ALL OVERVIEW UI VERIFICATIONS PASSED WITH 0 ERRORS!');
}
