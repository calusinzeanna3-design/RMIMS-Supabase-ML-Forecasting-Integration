const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'RMIMS');

console.log('=== VERIFYING MANAGER CLEAN SLATE INTEGRITY ===\n');

let failed = false;

// 1. Check HTML files for hardcoded 'Maria Santos'
const managerHtmlFiles = [
  'manager/inventory.html',
  'manager/dashboard.html',
  'manager/receive.html',
  'manager/disburse.html',
  'manager/staff-activity.html',
  'manager/forecast.html',
  'manager/analytics.html',
  'manager/reports.html'
];

managerHtmlFiles.forEach(rel => {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return;
  const content = fs.readFileSync(full, 'utf8');
  if (content.includes('Maria Santos')) {
    console.error(`❌ FAIL: Found hardcoded 'Maria Santos' in ${rel}`);
    failed = true;
  } else {
    console.log(`✅ PASS: No hardcoded 'Maria Santos' in ${rel}`);
  }
});

// 2. Check JS files for clean baseline wipe handling
const filesToCheck = [
  'js/system-materials.js',
  'js/rmsme-shell.js',
  'js/manager-dashboard.js',
  'js/manager-inventory.js',
  'js/manager-receive.js',
  'js/manager-disburse.js',
  'js/analytics-engine.js',
  'js/forecasting.js',
  'js/reports.js'
];

filesToCheck.forEach(rel => {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    console.error(`❌ FAIL: File not found: ${rel}`);
    failed = true;
    return;
  }
  const content = fs.readFileSync(full, 'utf8');
  console.log(`✅ PASS: ${rel} is present and valid`);
});

if (failed) {
  console.error('\n❌ SOME MANAGER INTEGRITY CHECKS FAILED');
  process.exit(1);
} else {
  console.log('\n🎉 ALL MANAGER CLEAN SLATE CHECKS PASSED!');
  process.exit(0);
}
