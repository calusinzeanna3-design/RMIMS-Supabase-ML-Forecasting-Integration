const fs = require('fs');
const u = fs.readFileSync('RMIMS/user/reports.html', 'utf8');
const start = u.indexOf('id="tabOverview"');
if (start !== -1) {
  console.log(u.substring(start, start + 1500));
} else {
  console.log('tabOverview not found in user reports');
}
