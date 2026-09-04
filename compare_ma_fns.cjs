const fs = require('fs');

const userCode = fs.readFileSync('RMIMS/js/user-material-activity.js', 'utf8');
const adminCode = fs.readFileSync('RMIMS/js/material-activity-admin.js', 'utf8');

function extractFunctions(code) {
  const matches = code.matchAll(/(?:function|async function)\s+([a-zA-Z0-9_]+)\s*\(/g);
  return Array.from(matches, m => m[1]);
}

const userFns = new Set(extractFunctions(userCode));
const adminFns = new Set(extractFunctions(adminCode));

console.log('Fns in User but not in Admin:');
for (const fn of userFns) {
  if (!adminFns.has(fn)) console.log('  -', fn);
}

console.log('\nFns in Admin but not in User:');
for (const fn of adminFns) {
  if (!userFns.has(fn)) console.log('  -', fn);
}
