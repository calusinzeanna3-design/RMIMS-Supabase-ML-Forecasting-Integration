const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// 1. Check activity-logs.html
const activityHtml = fs.readFileSync(path.join(root, 'RMIMS', 'admin', 'activity-logs.html'), 'utf8');
if (activityHtml.includes('2025')) {
  console.error('FAIL: activity-logs.html contains 2025!');
  process.exit(1);
}
if (!activityHtml.includes('Sep 21, 2026')) {
  console.error('FAIL: activity-logs.html does not contain Sep 21, 2026!');
  process.exit(1);
}
console.log('PASS: activity-logs.html has 0 instances of 2025 and uses Sep 21, 2026.');

// 2. Check overview.html
const overviewHtml = fs.readFileSync(path.join(root, 'RMIMS', 'admin', 'overview.html'), 'utf8');
if (overviewHtml.includes('2025')) {
  console.error('FAIL: overview.html contains 2025!');
  process.exit(1);
}
if (!overviewHtml.includes('Sep 21, 2026')) {
  console.error('FAIL: overview.html does not contain Sep 21, 2026!');
  process.exit(1);
}
console.log('PASS: overview.html has 0 instances of 2025 and uses Sep 21, 2026.');

// 3. Check admin-activity-logs.js
const activityJs = fs.readFileSync(path.join(root, 'RMIMS', 'js', 'admin-activity-logs.js'), 'utf8');
if (activityJs.includes('2025')) {
  console.error('FAIL: admin-activity-logs.js contains 2025!');
  process.exit(1);
}
if (!activityJs.includes("RECENT_DATE = '2026-09-21'")) {
  console.error('FAIL: admin-activity-logs.js RECENT_DATE is not 2026-09-21!');
  process.exit(1);
}
console.log('PASS: admin-activity-logs.js has 0 instances of 2025 and RECENT_DATE is 2026-09-21.');

// 4. Check admin-shell.css dark theme styling for calendar
const adminCss = fs.readFileSync(path.join(root, 'RMIMS', 'css', 'admin-shell.css'), 'utf8');
if (!adminCss.includes('background: #0B1726;')) {
  console.error('FAIL: admin-shell.css date-picker-popover is missing #0B1726 dark theme background!');
  process.exit(1);
}
console.log('PASS: admin-shell.css has dark sleek theme (#0B1726).');

console.log('ALL VERIFICATIONS PASSED!');
