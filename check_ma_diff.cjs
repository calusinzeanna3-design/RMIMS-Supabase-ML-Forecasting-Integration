const fs = require('fs');
const uMA = fs.readFileSync('RMIMS/js/user-material-activity.js', 'utf8');
const aMA = fs.readFileSync('RMIMS/js/material-activity-admin.js', 'utf8');

const uFns = (uMA.match(/function\s+([a-zA-Z0-9_]+)/g) || []).map(s => s.replace('function ', ''));
const aFns = (aMA.match(/function\s+([a-zA-Z0-9_]+)/g) || []).map(s => s.replace('function ', ''));

console.log('uFns:', uFns);
console.log('aFns:', aFns);
console.log('uFns not in aFns:', uFns.filter(f => !aFns.includes(f)));
console.log('aFns not in uFns:', aFns.filter(f => !uFns.includes(f)));
