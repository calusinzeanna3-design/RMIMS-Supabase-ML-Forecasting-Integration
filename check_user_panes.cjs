const fs = require('fs');
const u = fs.readFileSync('RMIMS/user/reports.html', 'utf8');
const lines = u.split('\n');
lines.forEach((l, i) => {
  if (l.includes('rpt-tab-pane') || l.includes('tab-pane') || l.includes('data-tab')) {
    console.log(i + 1, l);
  }
});
