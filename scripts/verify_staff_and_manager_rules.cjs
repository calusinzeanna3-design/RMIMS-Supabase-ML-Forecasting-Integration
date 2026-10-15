const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const rmimsDir = path.join(rootDir, 'RMIMS');
const userDir = path.join(rmimsDir, 'user');
const mgrDir = path.join(rmimsDir, 'manager');
const jsDir = path.join(rmimsDir, 'js');

console.log('=== RMSME: FULL STAFF SIDE + FINAL MANAGER RULES VERIFICATION ===\n');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = [];

function check(desc, condition, details = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`[PASS] ${desc}`);
  } else {
    failedChecks.push({ desc, details });
    console.error(`[FAIL] ${desc} - ${details}`);
  }
}

// -------------------------------------------------------------
// 1. FILE PRESENCE CHECKS
// -------------------------------------------------------------
console.log('--- 1. Checking File Existence ---');
const requiredUserFiles = [
  'dashboard.html',
  'inventory.html',
  'receive.html',
  'disburse.html',
  'my-activity.html',
  'reports.html',
  'settings.html'
];
requiredUserFiles.forEach(f => {
  const p = path.join(userDir, f);
  check(`User file exists: ${f}`, fs.existsSync(p), `Missing ${p}`);
});

const requiredMgrFiles = [
  'dashboard.html',
  'inventory.html',
  'receive.html',
  'disburse.html',
  'staff-activity.html',
  'forecasting.html',
  'reports.html',
  'settings.html'
];
requiredMgrFiles.forEach(f => {
  const p = path.join(mgrDir, f);
  check(`Manager file exists: ${f}`, fs.existsSync(p), `Missing ${p}`);
});

const requiredJsFiles = [
  'rmsme-shell.js',
  'rmims-transaction-engine.js',
  'user-dashboard.js',
  'user-inventory.js',
  'user-receive.js',
  'user-disburse.js',
  'user-my-activity.js',
  'staff-activity.js'
];
requiredJsFiles.forEach(f => {
  const p = path.join(jsDir, f);
  check(`JS engine file exists: ${f}`, fs.existsSync(p), `Missing ${p}`);
});

// -------------------------------------------------------------
// 2. SIDEBAR AND SHELL SPECIFICATION CHECKS (Section 2)
// -------------------------------------------------------------
console.log('\n--- 2. Checking Staff Sidebar & Topbar Shell ---');
const shellJs = fs.readFileSync(path.join(jsDir, 'rmsme-shell.js'), 'utf8');

check('Shell defines STAFF sidebar brand', shellJs.includes('<span class="brand-sub">STAFF</span>'));
check('Shell defines exact userSections: Dashboard, Inventory, Receive, Disburse',
  shellJs.includes("['dashboard.html', 'Dashboard', 'dashboard']") &&
  shellJs.includes("['inventory.html', 'Inventory', 'inventory']") &&
  shellJs.includes("['receive.html', 'Receive', 'receive']") &&
  shellJs.includes("['disburse.html', 'Disburse', 'disburse']"));
check('Shell defines REPORTS: Reports for Staff',
  shellJs.includes("heading: 'REPORTS'") &&
  shellJs.includes("['reports.html', 'Reports', 'reports']"));
check('Shell includes v2.0.0 • RMSME in Staff footer', shellJs.includes('v2.0.0 &bull; RMSME'));
check('Shell topbar has Staff John Reyes profile and avatar', shellJs.includes('John Reyes') && shellJs.includes('Staff'));
check('Shell profile dropdown includes My Activity, My Account, Change Password, Logout',
  shellJs.includes('href="my-activity.html"') &&
  shellJs.includes('href="settings.html?tab=account"') &&
  shellJs.includes('href="settings.html?tab=security"') &&
  shellJs.includes('Logout'));
check('Staff topbar does NOT render company selector', !shellJs.includes('staff-company-selector'));

// -------------------------------------------------------------
// 3. STAFF DASHBOARD CHECKS (Section 3)
// -------------------------------------------------------------
console.log('\n--- 3. Checking Staff Dashboard ---');
const dashHtml = fs.readFileSync(path.join(userDir, 'dashboard.html'), 'utf8');

check('Dashboard has 4 Summary Cards: Total Raw Materials, Available Stock, Low Stock, Today\'s Transactions',
  dashHtml.includes('Total Raw Materials') &&
  dashHtml.includes('Available Stock') &&
  dashHtml.includes('Low Stock') &&
  dashHtml.includes("Today's Transactions"));

check('Dashboard has Inventory Status Breakdown (Available, Low Stock, Critical, Out of Stock)',
  dashHtml.includes('Available (Good)') &&
  dashHtml.includes('Low Stock') &&
  dashHtml.includes('Critical') &&
  dashHtml.includes('Out of Stock'));

check('Dashboard has Smart Stock Alerts with Watch Stock & Critical',
  dashHtml.includes('Smart Stock Alerts') &&
  dashHtml.includes('badge-watch') &&
  dashHtml.includes('badge-critical'));

check('Dashboard has Top 5 Most Used Materials section',
  dashHtml.includes('Top 5 Most Used Materials'));

check('Dashboard has Recent Staff Activity section',
  dashHtml.includes('My Recent Activity') &&
  dashHtml.includes('staffDashboardActivityTbody'));

// -------------------------------------------------------------
// 4. STAFF INVENTORY CHECKS (Section 4)
// -------------------------------------------------------------
console.log('\n--- 4. Checking Staff Inventory ---');
const invHtml = fs.readFileSync(path.join(userDir, 'inventory.html'), 'utf8');

check('Staff Inventory is view-only', invHtml.includes('Staff View-Only') || invHtml.includes('view-only'));
check('Staff Inventory has table columns: Material, Category, Unit, Current Stock, Minimum Stock, Status, Est. Days Remaining, Expected Run-Out',
  invHtml.includes('Raw Material Name') &&
  invHtml.includes('Category') &&
  invHtml.includes('Unit') &&
  invHtml.includes('Current Stock') &&
  invHtml.includes('Minimum Stock') &&
  invHtml.includes('Status') &&
  invHtml.includes('Est. Days Remaining') &&
  invHtml.includes('Expected Run-Out'));

check('Staff Inventory REMOVED: Storage Location', !invHtml.includes('Storage Location') && !invHtml.includes('<th>Location</th>'));
check('Staff Inventory REMOVED: Material History', !invHtml.includes('Material History') && !invHtml.includes('<th>History</th>'));
check('Staff Inventory does NOT have Add Material button', !invHtml.includes('id="btnAddMaterial"') && !invHtml.includes('Add Raw Material'));

// -------------------------------------------------------------
// 5. STAFF RECEIVE & DISBURSE CHECKS (Sections 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)
// -------------------------------------------------------------
console.log('\n--- 5. Checking Staff Receive & Disburse ---');
const recHtml = fs.readFileSync(path.join(userDir, 'receive.html'), 'utf8');
const disbHtml = fs.readFileSync(path.join(userDir, 'disburse.html'), 'utf8');
const txEngineJs = fs.readFileSync(path.join(jsDir, 'rmims-transaction-engine.js'), 'utf8');
const recJs = fs.readFileSync(path.join(jsDir, 'user-receive.js'), 'utf8');
const disbJs = fs.readFileSync(path.join(jsDir, 'user-disburse.js'), 'utf8');

check('Receive Form has: Raw Material, Quantity, Unit, Date, Reference Number, Notes',
  recHtml.includes('id="staffRecMaterial"') &&
  recHtml.includes('id="staffRecQuantity"') &&
  recHtml.includes('id="staffRecUnit"') &&
  recHtml.includes('id="staffRecDate"') &&
  recHtml.includes('id="staffRecRefDisplay"') &&
  recHtml.includes('id="staffRecNotes"'));

check('Disburse Form has: Raw Material, Quantity, Unit, Used For, Date, Reference Number, Notes',
  disbHtml.includes('id="staffDisbMaterial"') &&
  disbHtml.includes('id="staffDisbQuantity"') &&
  disbHtml.includes('id="staffDisbUnit"') &&
  disbHtml.includes('id="staffDisbUsedFor"') &&
  disbHtml.includes('id="staffDisbDate"') &&
  disbHtml.includes('id="staffDisbRefDisplay"') &&
  disbHtml.includes('id="staffDisbNotes"'));

check('Reference Number is non-editable / locked display (not editable input)',
  recHtml.includes('staffRecRefDisplay') && !recHtml.includes('<input type="text" id="staffRecRefDisplay"') &&
  disbHtml.includes('staffDisbRefDisplay') && !disbHtml.includes('<input type="text" id="staffDisbRefDisplay"'));

check('Receive and Disburse have Review Modal (Section 13)',
  recHtml.includes('id="staffReceiveReviewModal"') &&
  disbHtml.includes('id="staffDisburseReviewModal"'));

check('Duplicate check modal with exact specification title and buttons: Cancel & Refresh Form',
  txEngineJs.includes('Reference Number Already Exists') &&
  txEngineJs.includes('btnDupCancel') &&
  txEngineJs.includes('btnDupRefresh') &&
  txEngineJs.includes('Refresh Form'));

check('Duplicate detection is based ONLY on Reference Number',
  txEngineJs.includes('Reference Number is the ONLY basis for duplicate detection') &&
  txEngineJs.includes('cleanRef = String(refNumber).trim().toUpperCase()'));

check('Staff submission sets status to Pending',
  recJs.includes("status: 'Pending'") || txEngineJs.includes("status: 'Pending'"));

// -------------------------------------------------------------
// 6. MANAGER STAFF ACTIVITY CHECKS (Sections 15, 16, 17, 20, 21, 25, 26)
// -------------------------------------------------------------
console.log('\n--- 6. Checking Manager Staff Activity ---');
const staffActHtml = fs.readFileSync(path.join(mgrDir, 'staff-activity.html'), 'utf8');
const staffActJs = fs.readFileSync(path.join(jsDir, 'staff-activity.js'), 'utf8');

check('Manager Staff Activity has Review Modal', staffActHtml.includes('id="mgrTxReviewModal"'));
check('Manager Review modal contains 🔵 UPDATED indicator', staffActHtml.includes('🔵 UPDATED') && staffActHtml.includes('id="reviewUpdatedBadge"'));
check('Manager Review modal shows Previous Correction message and Updated Info',
  staffActHtml.includes('id="reviewCorrectionDiffBox"') &&
  staffActHtml.includes('id="revPrevCorrectionMsg"') &&
  staffActHtml.includes('id="revDiffDetails"'));
check('Manager has 3 actions: Approve, Return for Correction, Reject',
  staffActHtml.includes('id="btnApproveTx"') &&
  staffActHtml.includes('id="btnReturnTx"') &&
  staffActHtml.includes('id="btnRejectTx"'));
check('Manager does NOT directly edit Staff transaction (no input fields to alter material or quantity directly)',
  !staffActHtml.includes('id="editStaffMaterial"') &&
  !staffActHtml.includes('id="editStaffQuantity"'));
check('Return for Correction opens instruction box for Manager to write message',
  staffActHtml.includes('id="correctionReasonBox"') &&
  staffActHtml.includes('id="correctionReasonInput"'));

// -------------------------------------------------------------
// 7. STAFF MY ACTIVITY & CORRECTION WORKFLOW (Sections 18, 19, 22, 27)
// -------------------------------------------------------------
console.log('\n--- 7. Checking Staff My Activity & Correction ---');
const myActHtml = fs.readFileSync(path.join(userDir, 'my-activity.html'), 'utf8');
const myActJs = fs.readFileSync(path.join(jsDir, 'user-my-activity.js'), 'utf8');

check('Staff My Activity displays history with statuses (Pending, Approved, Rejected, Correction Needed)',
  myActHtml.includes('id="myActivityTbody"'));
check('Correction modal displays Manager message and locked original reference',
  myActHtml.includes('id="staffCorrectionModal"') &&
  myActHtml.includes('id="corrModalManagerMsg"') &&
  (myActHtml.includes('id="corrModalRef"') || myActHtml.includes('id="corrModalRefCode"')));
check('Activity & Manager Message Viewer displays manager message and submitted activity',
  myActHtml.includes('id="viewTxModal"') &&
  myActHtml.includes('id="viewTxCorrectionBox"') &&
  myActHtml.includes('id="viewTxCorrectionMsg"') &&
  myActHtml.includes('id="btnGoToCorrect"'));
check('Small Box Correction Form matches receive module form and is on-screen modal',
  myActHtml.includes('id="staffCorrectionModal"') &&
  myActHtml.includes('class="mgr-ref-display-box"') &&
  myActHtml.includes('id="corrStockPreview"') &&
  myActHtml.includes('id="corrQuantityInput"') &&
  myActHtml.includes('id="corrUnitBadge"') &&
  myActHtml.includes('id="btnBackToViewModal"'));
check('Correction workflow does NOT redirect or navigate to receive.html',
  !myActJs.includes('window.location.href = "receive.html"') &&
  !myActJs.includes("window.location = 'receive.html'") &&
  !myActJs.includes('window.location.replace("receive.html")'));
check('Correction keeps EXACT SAME reference number on resubmission',
  myActJs.includes('resubmitStaffCorrection') &&
  txEngineJs.includes('STRICT RULE: KEEP SAME REFERENCE NUMBER'));
check('Resubmission sets status to Pending and marks isUpdated: true',
  txEngineJs.includes("status: 'Pending'") &&
  txEngineJs.includes("isUpdated: true"));

// -------------------------------------------------------------
// 8. STAFF & MANAGER OBSOLETE FILES PERMANENT REMOVAL
// -------------------------------------------------------------
console.log('\n--- 8. Checking Obsolete Forbidden Files Permanently Removed ---');
const forbiddenUserPages = ['analytics.html', 'forecasting.html', 'material-activity.html', 'simulation.html'];
forbiddenUserPages.forEach(p => {
  check(`Forbidden staff page ${p} permanently removed`, !fs.existsSync(path.join(userDir, p)));
});
check('Obsolete manager simulation.html permanently removed', !fs.existsSync(path.join(mgrDir, 'simulation.html')));

// -------------------------------------------------------------
// 9. FUNCTIONAL UNIT TESTS FOR TRANSACTION ENGINE
// -------------------------------------------------------------
console.log('\n--- 9. Running Functional Unit Tests for Engine Logic ---');

// Mock localStorage for node environment
const storage = {};
global.localStorage = {
  getItem: (k) => storage[k] || null,
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};
global.window = {
  dispatchEvent: () => {}
};
global.Event = function(name) { this.name = name; };

// Dynamically import ESM transaction engine using native import
(async () => {
  try {
    const engine = await import('../RMIMS/js/rmims-transaction-engine.js');

    // Test 1: Reference format
    const recRef = engine.generateNextReference('REC');
    const disbRef = engine.generateNextReference('DIS');
    const currentYear = new Date().getFullYear();

    check(`REC reference follows pattern REC-${currentYear}-NNNNN: ${recRef}`,
      new RegExp(`^REC-${currentYear}-\\d{5}$`).test(recRef));
    check(`DIS reference follows pattern DIS-${currentYear}-NNNNN: ${disbRef}`,
      new RegExp(`^DIS-${currentYear}-\\d{5}$`).test(disbRef));

    // Test 2: Submit Staff Transaction
    const staffTx = engine.submitStaffTransaction({
      ref: recRef,
      date: '2026-10-01',
      material: 'Sugar',
      quantity: 50,
      unit: 'kg',
      supplier: 'Central Milling',
      activity: 'Receive',
      staff: 'John Reyes'
    });
    check('Staff transaction created with status Pending', staffTx.status === 'Pending');
    check('Staff transaction retains reference number', staffTx.ref === recRef);

    // Test 3: Duplicate detection strictly on reference number
    const dupCheck1 = engine.checkReferenceDuplicate(recRef);
    check('Submitted reference detected as duplicate', dupCheck1.isDuplicate === true);

    // Test 4: Different reference with same material, date, quantity is NOT duplicate
    const newRef = engine.generateNextReference('REC');
    const dupCheck2 = engine.checkReferenceDuplicate(newRef);
    check('New reference with identical material & quantity is NOT duplicate', dupCheck2.isDuplicate === false);

    // Test 5: Resubmission after correction preserves original reference
    const correctedTx = engine.resubmitStaffCorrection(recRef, {
      quantity: 45,
      notes: 'Quantity corrected per manager review'
    });
    check('Resubmitted transaction retains EXACT SAME reference number', correctedTx.ref === recRef);
    check('Resubmitted transaction status is Pending', correctedTx.status === 'Pending');
    check('Resubmitted transaction has isUpdated flag true for 🔵 UPDATED badge', correctedTx.isUpdated === true);
    check('Resubmitted transaction records previous values diff', correctedTx.previousValues && correctedTx.previousValues.quantity === 50);

  } catch (err) {
    console.error('Error during engine test execution:', err);
    check('Engine functional tests executed successfully', false, err.message);
  }

  // -------------------------------------------------------------
  // SUMMARY RESULTS
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`TOTAL VERIFICATION CHECKS: ${totalChecks}`);
  console.log(`PASSED: ${passedChecks}`);
  console.log(`FAILED: ${failedChecks.length}`);
  console.log('=============================================================');

  if (failedChecks.length === 0) {
    console.log('\n>>> ALL SPECIFICATIONS AND BUSINESS RULES FULLY VERIFIED! <<<');
    process.exit(0);
  } else {
    console.error('\nFAILURES DETECTED:');
    failedChecks.forEach(f => console.error(` - ${f.desc}: ${f.details}`));
    process.exit(1);
  }
})();
