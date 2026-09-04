const fs = require('fs');
const a = fs.readFileSync('RMIMS/admin/reports.html', 'utf8');
const lines = a.split('\n');
lines.forEach((l, i) => {
  if (l.includes('data-tab="activity"') || l.includes('id="pane-activity"') || l.includes('tab-activity')) {
    console.log(i + 1, l);
  }
});
