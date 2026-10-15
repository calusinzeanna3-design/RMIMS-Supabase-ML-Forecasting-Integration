const fs = require('fs');
const a = fs.readFileSync('RMIMS/admin/reports.html', 'utf8');
const tabMatches = a.match(/class="rpt-tab-btn[^"]*"[^>]*data-tab="([^"]*)"/g);
console.log('Admin reports tabs:');
console.log(tabMatches);
