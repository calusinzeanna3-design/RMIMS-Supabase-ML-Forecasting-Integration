// scratch/verify_user_material_activity.js
import fs from 'fs';
import path from 'path';

const htmlPath = path.resolve('RMIMS/user/material-activity.html');
const jsPath = path.resolve('RMIMS/js/user-material-activity.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

console.log("1. Checking forbidden elements (theme toggles, admin controls)...");
const forbidden = [
  "themeToggleBtn",
  "icon-sun",
  "icon-moon",
  "rmims-theme",
  "prefers-color-scheme"
];

forbidden.forEach(str => {
  if (htmlContent.includes(str)) {
    console.error(`FAILED: Found forbidden element/text '${str}' in user/material-activity.html`);
    process.exit(1);
  }
});
console.log("PASS: Clean light theme without dark mode toggles or overrides!");

console.log("2. Checking 2-card architecture, elements, and modals in user/material-activity.html...");
const requiredElements = [
  // Card 1
  'cardReceiveDisbursementManagement',
  'tabBtnProductOverview',
  'tabBtnMaterialOverview',
  'viewProductOverview',
  'viewMaterialOverview',
  'productSearchInput',
  'productSortSelect',
  'productCardsContainer',
  'materialSearchInput',
  'materialSortSelect',
  'materialOverviewTable',
  'materialOverviewTableBody',

  // Card 2
  'cardActualActivityHistory',
  'historyTotalsSummary',
  'histTotalCount',
  'histReceivedCount',
  'histDisbursedCount',
  'historySearchInput',
  'historyDateFrom',
  'historyDateTo',
  'historyActivityFilter',
  'historySortSelect',
  'activityHistoryTable',
  'activityHistoryTableBody',
  'historyResultCount',
  'historyPageSize',
  'historyPaginationBtns',

  // Modals
  'maReceiveModalOverlay',
  'maReceiveMaterialSelect',
  'maReceiveQuantityInput',
  'maReceiveSaveBtn',
  'maDisburseModalOverlay',
  'maDisburseMaterialSelect',
  'maDisburseQuantityInput',
  'maDisburseSaveBtn',
  'productBreakdownModalOverlay',
  'prodBreakdownTableBody',
  'materialBreakdownModalOverlay',
  'matBreakdownProductsTableBody'
];

requiredElements.forEach(id => {
  if (!htmlContent.includes(`id="${id}"`)) {
    console.error(`FAILED: Missing element ID '${id}' in user/material-activity.html`);
    process.exit(1);
  }
});
console.log("PASS: All required 2-card IDs, tables, inputs, and modals present in user/material-activity.html!");

console.log("3. Checking JS transactions, handlers, and stock validation...");
const requiredJsFunctions = [
  'loadAuthoritativeData',
  'buildFinishedProductsContext',
  'buildUnifiedActivities',
  'renderProductOverview',
  'renderMaterialOverview',
  'renderCard2History',
  'handleSaveReceive',
  'handleSaveDisburse',
  'openProductBreakdownModal',
  'openMaterialBreakdownModal',
  'record_stock_receipt_v2',
  'record_material_disbursement_v2'
];

requiredJsFunctions.forEach(fn => {
  if (!jsContent.includes(fn)) {
    console.error(`FAILED: Missing function or identifier '${fn}' in user-material-activity.js`);
    process.exit(1);
  }
});
console.log("PASS: All JS calculations, RPC transactions, and validation routines present!");

console.log("ALL VERIFICATIONS COMPLETED SUCCESSFULLY!");
