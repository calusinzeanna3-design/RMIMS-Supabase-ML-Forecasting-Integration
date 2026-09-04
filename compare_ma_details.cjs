const fs = require('fs');

const userCode = fs.readFileSync('RMIMS/js/user-material-activity.js', 'utf8');
const adminCode = fs.readFileSync('RMIMS/js/material-activity-admin.js', 'utf8');

function getFnBody(code, fnName) {
  const start = code.indexOf(`function ${fnName}(`) !== -1 
    ? code.indexOf(`function ${fnName}(`) 
    : code.indexOf(`async function ${fnName}(`);
  if (start === -1) return '';
  // Find next function or end of reasonable block
  const nextFn = code.slice(start + 20).search(/\n(?:async\s+)?function\s+[a-zA-Z0-9_]+\s*\(/);
  return nextFn !== -1 ? code.slice(start, start + 20 + nextFn) : code.slice(start, start + 3000);
}

const fnsToCompare = [
  'openReceiveModal',
  'openDisburseModal',
  'handleSaveReceive',
  'handleSaveDisburse',
  'renderProductOverview',
  'renderMaterialOverview',
  'renderReceivePackageTable',
  'renderDisbursePackageTable'
];

for (const fn of fnsToCompare) {
  const u = getFnBody(userCode, fn);
  const a = getFnBody(adminCode, fn);
  if (u.trim() === a.trim()) {
    console.log(`[MATCH] ${fn}`);
  } else {
    console.log(`[DIFF]  ${fn}`);
    console.log(`  User length: ${u.length}, Admin length: ${a.length}`);
  }
}
