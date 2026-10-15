const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'RMIMS', 'css', 'admin-shell.css');
const htmlPath = path.join(__dirname, '..', 'RMIMS', 'admin', 'activity-logs.html');

console.log('--- Verifying Activity Logs Date Range Theme Alignment ---');

const css = fs.readFileSync(cssPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

// 1. Check no darkmode colors in date picker CSS
const darkColors = ['#0B1726', '#060D17', '#0F2035'];
let hasDarkColor = false;
for (const color of darkColors) {
  if (css.includes(color)) {
    console.error(`FAIL: Found dark mode color ${color} in admin-shell.css`);
    hasDarkColor = true;
  }
}
if (!hasDarkColor) {
  console.log('PASS: No dark mode background colors in admin-shell.css.');
}

// 2. Check date-picker-popover styling in admin-shell.css
const expectedTokens = [
  'background: #FFFFFF;',
  'border: 1px solid var(--rm-line);',
  'box-shadow: 0 16px 36px -6px rgba(15, 47, 29, 0.16)',
  'background: #DCFCE7 !important;',
  'color: #15803D !important;',
  'linear-gradient(135deg, #22C55E 0%, #15803D 100%)',
  '#btnToggleDateRange'
];

let allTokensFound = true;
for (const token of expectedTokens) {
  if (!css.includes(token)) {
    console.error(`FAIL: Missing expected token "${token}" in date-picker styles`);
    allTokensFound = false;
  }
}
if (allTokensFound) {
  console.log('PASS: All Emerald & Mint light theme tokens verified in date picker CSS.');
}

// 3. Verify HTML structure for date range trigger & popover
if (html.includes('id="btnToggleDateRange"') && html.includes('id="datePickerPopover"')) {
  console.log('PASS: HTML contains date range trigger and popover dialog.');
} else {
  console.error('FAIL: Missing date range elements in activity-logs.html');
  process.exit(1);
}

if (!hasDarkColor && allTokensFound) {
  console.log('SUCCESS: Date range popover is fully aligned with the RMIMS Admin Light Design System!');
  process.exit(0);
} else {
  process.exit(1);
}
