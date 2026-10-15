// Comprehensive runtime & functional test for Branch Stores Redesign
const fs = require('fs');
const path = require('path');

console.log('--- Testing Branch Stores Runtime Functionality ---');

// Mock a lightweight browser DOM environment
const jsPath = path.join(__dirname, '..', 'RMIMS', 'js', 'admin-branch-stores.js');
const jsCode = fs.readFileSync(jsPath, 'utf8');

// Set up globals
global.window = {};
global.document = {
  elements: {},
  getElementById(id) {
    if (!this.elements[id]) {
      this.elements[id] = {
        id,
        innerHTML: '',
        textContent: '',
        value: '',
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          contains(c) { return this.classes.has(c); }
        },
        addEventListener(event, fn) {}
      };
    }
    return this.elements[id];
  },
  addEventListener(event, fn) {}
};
global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = v; },
  removeItem(k) { delete this.store[k]; }
};

// Evaluate the script
const evalScript = new Function(
  'window', 'document', 'localStorage',
  jsCode.replace('export function renderBranchStoresCards', 'window.renderBranchStoresCards = function')
);
evalScript(global.window, global.document, global.localStorage);

console.log('Testing renderBranchStoresCards...');
const dirGrid = global.document.getElementById('branchStoresDirectoryGrid');
global.window.renderBranchStoresCards('branchStoresDirectoryGrid');

if (!dirGrid.innerHTML.includes('KXC Enterprises')) {
  console.error('FAIL: KXC Enterprises not rendered');
  process.exit(1);
}
if (!dirGrid.innerHTML.includes('MANAGER(S)') || !dirGrid.innerHTML.includes('STAFF / EMPLOYEES')) {
  console.error('FAIL: 2x2 grid stats labels missing');
  process.exit(1);
}
if (!dirGrid.innerHTML.includes('Personnel &amp; Branch Audit') && !dirGrid.innerHTML.includes('Personnel & Branch Audit')) {
  console.error('FAIL: Footer audit label missing');
  process.exit(1);
}
if (!dirGrid.innerHTML.includes('View Details')) {
  console.error('FAIL: View Details button missing');
  process.exit(1);
}
console.log('PASS: Directory cards render properly with Image 1 structure.');

// Test Modal opening
console.log('Testing openStoreDetails for kxc...');
const storeModal = global.document.getElementById('storeDetailsModal');
global.window.openStoreDetails('kxc');

const title = global.document.getElementById('modalStoreTitle').textContent;
const managersHtml = global.document.getElementById('modalManagersTbody').innerHTML;
const staffHtml = global.document.getElementById('modalStaffTbody').innerHTML;

if (!title.includes('KXC Enterprises Store Details')) {
  console.error(`FAIL: Modal title incorrect: "${title}"`);
  process.exit(1);
}
if (!managersHtml.includes('Rafael Cruz') || !managersHtml.includes('rafael_cruz')) {
  console.error('FAIL: Branch Managers table missing Rafael Cruz');
  process.exit(1);
}
if (!staffHtml.includes('Alyssa Lim') || !staffHtml.includes('672295')) {
  console.error('FAIL: Branch Staff table missing Alyssa Lim or access code 672295');
  process.exit(1);
}
if (!staffHtml.includes('Mark Villanueva') || !staffHtml.includes('861058')) {
  console.error('FAIL: Branch Staff table missing Mark Villanueva or access code 861058');
  process.exit(1);
}
if (!storeModal.classList.contains('active')) {
  console.error('FAIL: Modal not active');
  process.exit(1);
}
console.log('PASS: Image 2 Store Details Modal populates separate role tables with authentic data and access codes.');

// Test modal close
global.window.closeStoreDetails();
if (storeModal.classList.contains('active')) {
  console.error('FAIL: Modal did not close');
  process.exit(1);
}
console.log('PASS: Modal closes correctly.');

console.log('\n>>> ALL RUNTIME TESTS PASSED WITH 100% SUCCESS! <<<');
