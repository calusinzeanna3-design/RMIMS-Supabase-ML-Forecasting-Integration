const fs = require('fs');
const files = [
  'RMIMS/js/material-activity-admin.js',
  'RMIMS/js/user-material-activity.js',
  'RMIMS/js/inventory.js',
  'RMIMS/js/user-inventory.js',
  'RMIMS/js/reports.js',
  'RMIMS/js/user-reports.js',
  'RMIMS/js/dashboard.js',
  'RMIMS/js/user-dashboard.js'
];

files.forEach(f => {
  if (!fs.existsSync(f)) return;
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, i) => {
    if (l.includes('renderPaginationControls')) {
      console.log(`${f}:${i+1} -> ${l.trim()}`);
    }
  });
});
