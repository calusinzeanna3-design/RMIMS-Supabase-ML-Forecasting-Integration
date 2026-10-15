const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'RMIMS', 'manager', 'inventory.html');
const jsPath = path.join(__dirname, '..', 'RMIMS', 'js', 'manager-inventory.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

let errors = [];

// 1. Check Add Material form does not have the 4 removed fields
const addFormMatch = htmlContent.match(/<form id="addMaterialForm"[\s\S]*?<\/form>/i);
if (!addFormMatch) {
  errors.push('Could not find form #addMaterialForm in inventory.html');
} else {
  const addForm = addFormMatch[0];
  if (addForm.includes('id="addMatSpecName"')) errors.push('addMatSpecName still in addMaterialForm');
  if (addForm.includes('id="addMatLocation"')) errors.push('addMatLocation still in addMaterialForm');
  if (addForm.includes('id="addMatSupplier"')) errors.push('addMatSupplier still in addMaterialForm');
  if (addForm.includes('id="addMatDescription"')) errors.push('addMatDescription still in addMaterialForm');
}

// 2. Check no word "temporary" in finished product sections
const fpModalMatch = htmlContent.match(/<div class="mgr-modal-backdrop" id="modalFinishedProductFolder"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i);
if (fpModalMatch && /temporary/i.test(fpModalMatch[0])) {
  errors.push('Word "temporary" still found in modalFinishedProductFolder');
}

const fpCatalogMatch = htmlContent.match(/<div class="mgr-modal-backdrop" id="modalFinishedFoodCatalogPopup"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i);
if (fpCatalogMatch && /temporary/i.test(fpCatalogMatch[0])) {
  errors.push('Word "temporary" still found in modalFinishedFoodCatalogPopup');
}

if (/temporary/i.test(jsContent)) {
  errors.push('Word "temporary" still found in manager-inventory.js');
}

// 3. Check finished product formulation table in inventory.html
if (htmlContent.includes('Matched Specification')) {
  errors.push('"Matched Specification" found in inventory.html');
}
if (htmlContent.includes('Warehouse Stock')) {
  errors.push('"Warehouse Stock" found in inventory.html');
}
if (!htmlContent.includes('How Many Products Can Produce')) {
  errors.push('"How Many Products Can Produce" missing in inventory.html');
}

// 4. Check finished product cards in JS do not render the specs list preview (image 5)
const fpFolderFn = jsContent.match(/function renderFinishedProductsFolders[\s\S]*?^\}/m);
if (fpFolderFn && fpFolderFn[0].includes('mgr-folder-specs-list')) {
  errors.push('mgr-folder-specs-list still rendered in renderFinishedProductsFolders');
}
const fpFoodModalFn = jsContent.match(/function renderFinishedFoodModalContent[\s\S]*?^\}/m);
if (fpFoodModalFn && fpFoodModalFn[0].includes('mgr-folder-specs-list')) {
  errors.push('mgr-folder-specs-list still rendered in renderFinishedFoodModalContent');
}
if (jsContent.includes('SPECIFIED RAW MATERIALS:')) {
  errors.push('"SPECIFIED RAW MATERIALS:" still in manager-inventory.js');
}

// 5. Check Add Finished Product in modalFinishedFoodCatalogPopup
if (!htmlContent.includes('id="btnOpenAddFinishedProductPopup"')) {
  errors.push('btnOpenAddFinishedProductPopup missing in inventory.html');
}
if (!htmlContent.includes('id="addFinishedProductPanel"')) {
  errors.push('addFinishedProductPanel missing in inventory.html');
}
if (!htmlContent.includes('id="newFpName"')) {
  errors.push('newFpName missing in inventory.html');
}
if (!htmlContent.includes('id="newFpRawMaterialSelect"')) {
  errors.push('newFpRawMaterialSelect missing in inventory.html');
}
if (!htmlContent.includes('id="btnSubmitAddFinishedProduct"')) {
  errors.push('btnSubmitAddFinishedProduct missing in inventory.html');
}

// 6. Check JS functions for Add Finished Product
if (!jsContent.includes('function openAddFinishedProductPanel')) {
  errors.push('openAddFinishedProductPanel missing in manager-inventory.js');
}
if (!jsContent.includes('function populateAvailableRawMaterialsDropdown')) {
  errors.push('populateAvailableRawMaterialsDropdown missing in manager-inventory.js');
}
if (!jsContent.includes('function handleAddFinishedProductSubmit')) {
  errors.push('handleAddFinishedProductSubmit missing in manager-inventory.js');
}

// 7. Check Maximum Stock Capacity removed from forms and info cards
if (htmlContent.includes('id="addMatMaxStock"')) {
  errors.push('addMatMaxStock still in inventory.html');
}
if (htmlContent.includes('id="editMatMaxStock"')) {
  errors.push('editMatMaxStock still in inventory.html');
}
if (htmlContent.includes('id="infoMaxStock"')) {
  errors.push('infoMaxStock still in inventory.html');
}
if (htmlContent.includes('id="specsUpdateMaxStock"')) {
  errors.push('specsUpdateMaxStock still in inventory.html');
}

// 8. Check Row Status Coloring classes
const cssPath = path.join(__dirname, '..', 'RMIMS', 'css', 'manager-inventory.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');
if (!cssContent.includes('.row-status-good') || !cssContent.includes('.row-status-low') || !cssContent.includes('.row-status-out')) {
  errors.push('Row status CSS classes (.row-status-good, .row-status-low, .row-status-out) missing in manager-inventory.css');
}
if (!jsContent.includes('rowStatusClass')) {
  errors.push('rowStatusClass logic missing in manager-inventory.js');
}

// 9. Check JS syntax
try {
  new Function(jsContent.replace(/import\s+.*?from\s+['"].*?['"];?/g, ''));
} catch (err) {
  errors.push('JavaScript syntax error in manager-inventory.js: ' + err.message);
}

if (errors.length > 0) {
  console.error('FAIL: Found ' + errors.length + ' issues:');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
} else {
  console.log('PASS: All verification checks passed successfully!');
}
