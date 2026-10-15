const fs = require('fs');
const invJs = fs.readFileSync('RMIMS/js/inventory.js', 'utf8');
const adminInv = fs.readFileSync('RMIMS/admin/inventory.html', 'utf8');
const mgrInv = fs.readFileSync('RMIMS/manager/inventory.html', 'utf8');

const idRegex = /\$\(["']([^"']+)["']\)/g;
let match;
const usedIds = new Set();
while ((match = idRegex.exec(invJs)) !== null) {
  usedIds.add(match[1]);
}

console.log('Total unique IDs referenced via $(...):', usedIds.size);

const missingInAdmin = [];
const missingInMgr = [];

for (const id of usedIds) {
  if (!adminInv.includes('id="' + id + '"') && !adminInv.includes("id='" + id + "'")) {
    missingInAdmin.push(id);
  }
  if (!mgrInv.includes('id="' + id + '"') && !mgrInv.includes("id='" + id + "'")) {
    missingInMgr.push(id);
  }
}

console.log('Missing in Admin Inventory count:', missingInAdmin.length, missingInAdmin);
console.log('Missing in Manager Inventory count:', missingInMgr.length, missingInMgr);
