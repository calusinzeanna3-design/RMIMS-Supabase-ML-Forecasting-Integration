// Comprehensive Runtime Simulation Test for Location Divider Architecture

const fs = require('fs');
const vm = require('vm');

console.log('=== RUNNING COMPLETE LOCATION DIVIDER & BRANCH STORE RUNTIME TEST ===\n');

// 1. Mock DOM Environment
const elements = {};
function createElement(id) {
  const el = {
    id: id,
    innerHTML: '',
    textContent: '',
    classList: {
      classes: new Set(),
      add: function(c) { this.classes.add(c); },
      remove: function(c) { this.classes.delete(c); },
      contains: function(c) { return this.classes.has(c); }
    },
    style: {},
    addEventListener: function() {},
    reset: function() {}
  };
  elements[id] = el;
  return el;
}

// Pre-create standard IDs
[
  'locationDividersContainer',
  'overviewLocationDividersContainer',
  'locationStoresModal',
  'locModalTitle',
  'locModalSubtitle',
  'locStoresGrid',
  'storeDetailsModal',
  'modalStoreTitle',
  'modalStoreSubtitle',
  'modalKpiManagersVal',
  'modalKpiStaffVal',
  'modalKpiTotalPersonnelVal',
  'modalKpiOutputVal',
  'modalKpiStatusVal',
  'modalKpiRevenueVal',
  'modalMgrCountBadge',
  'modalStaffCountBadge',
  'modalManagersTbody',
  'modalStaffTbody',
  'addBranchModal',
  'addBranchForm',
  'branchLocationSelect',
  'branchName',
  'branchCode',
  'branchCategory',
  'branchManager'
].forEach(createElement);

const mockLocalStorage = {
  store: {
    'RMIMS_BRANCH_STORES_V3': JSON.stringify({
      'store-1': { id: 'store-1', name: 'Tiaong Branch Store', location: 'Tiaong, Quezon', locKey: 'tiaong', managers: [{ name: 'Test Mgr', initials: 'TM', email: 'tm@store.ph' }], staff: [] },
      'store-2': { id: 'store-2', name: 'Lucena Branch Store', location: 'Lucena City, Quezon', locKey: 'lucena', managers: [{ name: 'Lucena Mgr', initials: 'LM', email: 'lm@store.ph' }], staff: [] }
    })
  },
  getItem: function(key) { return this.store[key] || null; },
  setItem: function(key, val) { this.store[key] = String(val); }
};

const sandbox = {
  console: console,
  document: {
    getElementById: function(id) {
      if (!elements[id]) elements[id] = createElement(id);
      return elements[id];
    },
    querySelectorAll: function() { return []; },
    addEventListener: function() {}
  },
  window: {
    addEventListener: function() {},
    showAdminToast: function(msg, type) { console.log(`[Toast ${type || 'info'}]: ${msg}`); }
  },
  localStorage: mockLocalStorage,
  confirm: function() { return true; },
  Date: Date,
  Math: Math,
  JSON: JSON
};

// Bind window self-reference
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = mockLocalStorage;

// Read code from admin-branch-stores.js and strip ESM export keywords for vm execution
let jsContent = fs.readFileSync('RMIMS/js/admin-branch-stores.js', 'utf8');
jsContent = jsContent.replace(/export\s+function/g, 'function');

const context = vm.createContext(sandbox);
vm.runInContext(jsContent, context);

// Test 1: renderLocationDividers for branch-stores page
console.log('--- Test 1: Render Location Dividers on branch-stores.html ---');
context.window.renderLocationDividers('locationDividersContainer');
const branchDividersHtml = elements['locationDividersContainer'].innerHTML;

if (!branchDividersHtml.includes('TIAONG BRANCH') || !branchDividersHtml.includes('LUCENA BRANCH')) {
  console.error('FAIL: Missing TIAONG BRANCH or LUCENA BRANCH in dividers');
  process.exit(1);
}
if (!branchDividersHtml.includes("openLocationBranches('tiaong')")) {
  console.error('FAIL: Missing View Branches button for tiaong');
  process.exit(1);
}
if (branchDividersHtml.toLowerCase().includes('revenue') || branchDividersHtml.includes('₱')) {
  console.error('FAIL: Revenue detected in location divider cards!');
  process.exit(1);
}
console.log('PASS: Location divider cards render cleanly with Tiaong & Lucena and zero revenue.');

// Test 2: renderLocationDividers on overview.html
console.log('\n--- Test 2: Render Location Dividers on overview.html ---');
context.window.renderLocationDividers('overviewLocationDividersContainer');
const overviewDividersHtml = elements['overviewLocationDividersContainer'].innerHTML;
if (!overviewDividersHtml.includes('TIAONG BRANCH') || !overviewDividersHtml.includes('LUCENA BRANCH')) {
  console.error('FAIL: Missing dividers in overview container');
  process.exit(1);
}
console.log('PASS: Overview page location divider cards rendered.');

// Test 3: Tap "View Branches" on Tiaong
console.log('\n--- Test 3: Tap "View Branches" on TIAONG BRANCH ---');
context.window.openLocationBranches('tiaong');

if (!elements['locationStoresModal'].classList.contains('active')) {
  console.error('FAIL: locationStoresModal did not activate');
  process.exit(1);
}

const locStoresHtml = elements['locStoresGrid'].innerHTML;
if (!locStoresHtml.includes('KXC Enterprises') || !locStoresHtml.includes("Tiaong Baker's Choice")) {
  console.error('FAIL: Missing Tiaong stores in popup modal');
  process.exit(1);
}
if (locStoresHtml.toLowerCase().includes('revenue') || locStoresHtml.includes('₱')) {
  console.error('FAIL: Revenue detected in small store boxes!');
  process.exit(1);
}
if (!locStoresHtml.includes('MANAGERS') || !locStoresHtml.includes('STAFF ROSTER') || !locStoresHtml.includes('TOTAL ROLES')) {
  console.error('FAIL: Missing role counts in small store boxes');
  process.exit(1);
}
console.log('PASS: Tiaong popup opens with small store boxes showing role counts and zero revenue.');

// Test 4: Tap "KXC Enterprises" small box
console.log('\n--- Test 4: Tap "KXC Enterprises" Store Box ---');
context.window.openStoreDetails('kxc', 'tiaong');

if (elements['locationStoresModal'].classList.contains('active')) {
  console.error('FAIL: locationStoresModal should close when store details opens');
  process.exit(1);
}
if (!elements['storeDetailsModal'].classList.contains('active')) {
  console.error('FAIL: storeDetailsModal did not activate');
  process.exit(1);
}

console.log('Store Title:', elements['modalStoreTitle'].textContent);
if (!elements['modalStoreTitle'].textContent.includes('KXC Enterprises')) {
  console.error('FAIL: Wrong store title');
  process.exit(1);
}

// Check Manager Roster
const mgrTbodyHtml = elements['modalManagersTbody'].innerHTML;
if (!mgrTbodyHtml.includes('Rafael Cruz') || !mgrTbodyHtml.includes('rafael_cruz') || !mgrTbodyHtml.includes('APPROVED')) {
  console.error('FAIL: Rafael Cruz missing in Branch Managers table');
  process.exit(1);
}

// Check Staff Roster & Access Codes
const staffTbodyHtml = elements['modalStaffTbody'].innerHTML;
const expectedStaff = [
  { name: 'Alyssa Lim', code: '672295' },
  { name: 'Mark Villanueva', code: '861058' },
  { name: 'Carla Mendoza', code: '419382' }
];

expectedStaff.forEach(s => {
  if (!staffTbodyHtml.includes(s.name) || !staffTbodyHtml.includes(s.code)) {
    console.error(`FAIL: Missing ${s.name} with code ${s.code} in Branch Staff table`);
    process.exit(1);
  }
});
console.log('PASS: Separate tables for Branch Managers & Staff with access codes verified.');

// Test 5: Back to Branches button
console.log('\n--- Test 5: Back to Branches Navigation ---');
context.window.backToLocationBranches();
if (elements['storeDetailsModal'].classList.contains('active')) {
  console.error('FAIL: storeDetailsModal should be closed after back');
  process.exit(1);
}
if (!elements['locationStoresModal'].classList.contains('active')) {
  console.error('FAIL: locationStoresModal should be active after back');
  process.exit(1);
}
console.log('PASS: Back button returns smoothly to location stores modal.');

// Test 6: Lucena Branch Network
console.log('\n--- Test 6: Lucena Branch Network & Scones & Muffins ---');
context.window.openLocationBranches('lucena');
const lucenaStoresHtml = elements['locStoresGrid'].innerHTML;
if (!lucenaStoresHtml.includes('Scones &amp; Muffins') && !lucenaStoresHtml.includes('Scones & Muffins')) {
  console.error('FAIL: Missing Scones & Muffins in Lucena popup');
  process.exit(1);
}

context.window.openStoreDetails('scones', 'lucena');
const sconesMgrHtml = elements['modalManagersTbody'].innerHTML;
const sconesStaffHtml = elements['modalStaffTbody'].innerHTML;

if (!sconesMgrHtml.includes('Kenneth Lim') || !sconesMgrHtml.includes('Ethan Cruz')) {
  console.error('FAIL: Missing Kenneth Lim or Ethan Cruz in Scones managers');
  process.exit(1);
}
if (!sconesStaffHtml.includes('Sarah Gomez') || !sconesStaffHtml.includes('739201')) {
  console.error('FAIL: Missing Sarah Gomez with code in Scones staff');
  process.exit(1);
}
console.log('PASS: Lucena network and Scones & Muffins roster with access codes verified.');

console.log('\n=== ALL 6 RUNTIME SIMULATION TESTS PASSED WITH 100% SUCCESS! ===');
