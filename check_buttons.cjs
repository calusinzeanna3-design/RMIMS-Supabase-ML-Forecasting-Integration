const fs = require('fs');
const uMA = fs.readFileSync('RMIMS/js/user-material-activity.js', 'utf8');
const aMA = fs.readFileSync('RMIMS/js/material-activity-admin.js', 'utf8');

function getButtons(str, fnName) {
  const idx = str.indexOf(fnName);
  if (idx === -1) return [];
  const chunk = str.slice(idx, idx + 4000);
  const regex = /<button[^>]*>[\s\S]*?<\/button>/gi;
  const buttons = [];
  let m;
  while ((m = regex.exec(chunk)) !== null) {
    buttons.push(m[0].replace(/\s+/g, ' '));
  }
  return buttons;
}

console.log('=== USER Product Overview Buttons ===');
console.log(getButtons(uMA, 'function renderProductOverview('));

console.log('=== ADMIN Product Overview Buttons ===');
console.log(getButtons(aMA, 'function renderProductOverview('));

console.log('=== USER Material Overview Buttons ===');
console.log(getButtons(uMA, 'function renderMaterialOverview('));

console.log('=== ADMIN Material Overview Buttons ===');
console.log(getButtons(aMA, 'function renderMaterialOverview('));
