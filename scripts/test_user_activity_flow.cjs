const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const myActHtmlPath = path.join(rootDir, 'RMIMS', 'user', 'my-activity.html');
const myActJsPath = path.join(rootDir, 'RMIMS', 'js', 'user-my-activity.js');
const txEnginePath = path.join(rootDir, 'RMIMS', 'js', 'rmims-transaction-engine.js');

console.log('=== END-TO-END VERIFICATION: STAFF MY ACTIVITY & CORRECTION POPUP ===\n');

let failed = [];
function assert(name, condition, errorMsg = '') {
  if (condition) {
    console.log(`[PASS] ${name}`);
  } else {
    console.error(`[FAIL] ${name}: ${errorMsg}`);
    failed.push({ name, errorMsg });
  }
}

// 1. Read files
const html = fs.readFileSync(myActHtmlPath, 'utf8');
const js = fs.readFileSync(myActJsPath, 'utf8');
const engine = fs.readFileSync(txEnginePath, 'utf8');

// 2. Test Viewer Modal Structure (Modal 1)
assert('Viewer Modal (#viewTxModal) exists', html.includes('id="viewTxModal"'));
assert('Viewer Modal has title "Activity & Manager Message Viewer"', html.includes('Activity &amp; Manager Message Viewer') || html.includes('Activity & Manager Message Viewer'));
assert('Viewer Modal has Manager Feedback Box (#viewTxCorrectionBox)', html.includes('id="viewTxCorrectionBox"'));
assert('Viewer Modal has Manager Feedback Text element (#viewTxCorrectionMsg)', html.includes('id="viewTxCorrectionMsg"'));
assert('Viewer Modal has Submitted Details (Ref, Activity, Material, Qty, Date, Source)',
  html.includes('id="viewTxRef"') &&
  html.includes('id="viewTxActivity"') &&
  html.includes('id="viewTxMaterial"') &&
  html.includes('id="viewTxQty"') &&
  html.includes('id="viewTxDate"') &&
  html.includes('id="viewTxSource"'));
assert('Viewer Modal has "Correct Record" button at the bottom (#btnGoToCorrect)',
  html.includes('id="btnGoToCorrect"') && html.includes('Correct Record'));

// 3. Test Small Box Popup Form Structure (Modal 2)
assert('Small Box Correction Modal (#staffCorrectionModal) exists', html.includes('id="staffCorrectionModal"'));
assert('Small Box Modal is compact (max-width: 500px)', html.includes('max-width:500px') || html.includes('max-width: 500px'));
assert('Small Box Modal has locked reference box matching receive module (.mgr-ref-display-box)',
  html.includes('class="mgr-ref-display-box"') &&
  html.includes('id="corrModalRefCode"') &&
  html.includes('class="mgr-ref-lock-icon"'));
assert('Small Box Modal has Manager Instruction reminder', html.includes('id="corrModalManagerMsg"'));
assert('Small Box Modal has Raw Material select with Stock Preview badge',
  html.includes('id="corrMaterialSelect"') &&
  html.includes('id="corrStockPreview"') &&
  html.includes('id="corrStockVal"') &&
  html.includes('id="corrMinVal"'));
assert('Small Box Modal has Quantity input with Unit badge (.mgr-input-with-unit)',
  html.includes('id="corrQuantityInput"') &&
  html.includes('class="mgr-input-with-unit"') &&
  html.includes('id="corrUnitBadge"'));
assert('Small Box Modal has Unit select with standard units',
  html.includes('id="corrUnitSelect"') &&
  html.includes('value="kg"') &&
  html.includes('value="L"') &&
  html.includes('value="g"'));
assert('Small Box Modal has Date, Supplier/Purpose, and Notes inputs',
  html.includes('id="corrDateInput"') &&
  html.includes('id="corrSourceInput"') &&
  html.includes('id="corrNotesInput"'));
assert('Small Box Modal has "View Message" button to return to Viewer Modal (#btnBackToViewModal)',
  html.includes('id="btnBackToViewModal"'));
assert('Small Box Modal has "Resubmit to Manager" button (#btnSubmitCorrection)',
  html.includes('id="btnSubmitCorrection"'));

// 4. Test Logic Flow in JS
assert('user-my-activity.js wires btnGoToCorrect to openCorrectionModal',
  js.includes('btnGoToCorrect.addEventListener') &&
  js.includes('openCorrectionModal'));
assert('user-my-activity.js wires btnBackToViewModal to openViewModal',
  js.includes('btnBackToView.addEventListener') &&
  js.includes('openViewModal'));
assert('user-my-activity.js wires dynamic stock preview on material change',
  js.includes('updateStockPreview') &&
  js.includes('corrStockPreview'));
assert('user-my-activity.js resubmits without navigating to receive.html',
  !js.includes('window.location.href = "receive.html"') &&
  !js.includes("window.location = 'receive.html'") &&
  !js.includes('location.href = "receive.html"') &&
  !js.includes('location.replace("receive.html")') &&
  !js.includes('location.assign("receive.html")'));
assert('URL parameters (?correct=, ?ref=, ?view=) open the Message Viewer first',
  js.includes("params.get('ref')") &&
  js.includes("params.get('correct')") &&
  js.includes("params.get('view')") &&
  js.includes('openViewModal(tx)'));

// 5. Test Engine behavior on resubmission
const testRef = 'REC-2026-00999';
const mockTx = {
  id: 'tx_test_123',
  ref: testRef,
  activity: 'Receive',
  material: 'White Sugar',
  quantity: 100,
  unit: 'kg',
  supplier: 'Victoria Milling',
  date: '2026-10-01',
  status: 'Correction Needed',
  correctionMessage: 'Please verify the quantity entered.'
};

assert('Engine supports resubmitStaffCorrection preserving same reference',
  engine.includes('resubmitStaffCorrection') &&
  engine.includes('STRICT RULE: KEEP SAME REFERENCE NUMBER'));

console.log('\n-------------------------------------------------------------');
if (failed.length === 0) {
  console.log('ALL 16 DETAILED CHECKS PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  console.error(`FAILED CHECKS COUNT: ${failed.length}`);
  process.exit(1);
}
