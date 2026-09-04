const fs = require('fs');

// We will inspect admin openReceiveModal and openDisburseModal for potential crashes or missing elements.
const aRec = fs.readFileSync('admin_openReceive.js', 'utf8');
const aDis = fs.readFileSync('admin_openDisburse.js', 'utf8');

// Check all getElementById in admin_openReceive.js
const idsRec = Array.from(aRec.matchAll(/document\.getElementById\(["']([^"']+)["']\)/g), m => m[1]);
const idsDis = Array.from(aDis.matchAll(/document\.getElementById\(["']([^"']+)["']\)/g), m => m[1]);

const aHtml = fs.readFileSync('RMIMS/admin/material-activity.html', 'utf8');

console.log('--- Missing IDs in Admin HTML for openReceiveModal ---');
const missingRec = idsRec.filter(id => !aHtml.includes(`id="${id}"`));
console.log(missingRec);

console.log('--- Missing IDs in Admin HTML for openDisburseModal ---');
const missingDis = idsDis.filter(id => !aHtml.includes(`id="${id}"`));
console.log(missingDis);
