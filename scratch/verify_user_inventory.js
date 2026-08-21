// scratch/verify_user_inventory.js
import fs from 'fs';
import path from 'path';

const htmlPath = path.resolve('RMIMS/user/inventory.html');
const jsPath = path.resolve('RMIMS/js/user-inventory.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

console.log("1. Checking forbidden admin controls in User Inventory...");
const forbidden = [
  "Add Finished Product",
  "fpcAddProductBtn",
  "fpcImportBtn",
  "fpcAddModalOverlay",
  "fpcImportModalOverlay",
  "Import Finished Product",
  "Add Materials",
  "Import Material",
  "themeToggleBtn"
];

forbidden.forEach(str => {
  if (htmlContent.includes(str)) {
    console.error(`FAILED: Found forbidden element/text '${str}' in user/inventory.html`);
    process.exit(1);
  }
});
console.log("PASS: Zero admin creation/import controls and no dark theme toggle in User Inventory!");

console.log("2. Checking 4-tab workspace & modals in User Inventory...");
const requiredElements = [
  'summaryTotalCount',
  'summaryActiveCount',
  'statInStockCount',
  'statLowStockCount',
  'statOutOfStockCount',
  'stockStatusBarTrack',
  'segInStock',
  'segLowStock',
  'segOutOfStock',
  'inventoryTabsBar',
  'tabBtnOverview',
  'tabBtnReceive',
  'tabBtnDisbursement',
  'tabBtnOtherDetails',
  'paneOverview',
  'paneReceive',
  'paneDisbursement',
  'paneOtherDetails',
  'invSearchInput',
  'invDateFrom',
  'invDateTo',
  'invActivityStatusFilter',
  'invStatusFilter',
  'invSortFilter',
  'invClearFiltersBtn',
  'overviewTable',
  'overviewTableBody',
  'overviewResultCount',
  'overviewPageSize',
  'overviewPaginationBtns',
  'receiveSearchInput',
  'receiveDateFrom',
  'receiveDateTo',
  'btnVisitReceiveActivity',
  'receiveTable',
  'receiveTableBody',
  'receiveResultCount',
  'receivePaginationBtns',
  'disbursementSearchInput',
  'disburseDateFrom',
  'disburseDateTo',
  'btnVisitDisburseActivity',
  'disbursementTable',
  'disbursementTableBody',
  'disbursementResultCount',
  'disbursementPaginationBtns',
  'fpcSearchInput',
  'fpcSortSelect',
  'fpcPageSizeSelect',
  'fpcCardsContainer',
  'fpcPaginationBar',
  'fpcResultCount',
  'fpcPaginationBtns',
  'editMaterialModalOverlay',
  'editMatIdInternal',
  'editMatName',
  'editMatMinStock',
  'editMaterialSaveBtn',
  'detailModalOverlay',
  'fpcDetailsModalOverlay'
];

requiredElements.forEach(id => {
  if (!htmlContent.includes(`id="${id}"`)) {
    console.error(`FAILED: Missing element ID '${id}' in user/inventory.html`);
    process.exit(1);
  }
});
console.log("PASS: All required elements and modal IDs present in user/inventory.html!");

console.log("3. Checking JS calculations, handlers, and stock formulas...");
if (!jsContent.includes("computeStockStatus") || !jsContent.includes("handleEditMaterialSave")) {
  console.error("FAILED: Missing stock status or edit material logic in user-inventory.js");
  process.exit(1);
}

if (!jsContent.includes("btnVisitReceiveActivity") || !jsContent.includes("btnVisitDisburseActivity")) {
  console.error("FAILED: Missing visit activity handlers in user-inventory.js");
  process.exit(1);
}

console.log("PASS: All checks passed with zero errors!");
