const fs = require('fs');
const aMA = fs.readFileSync('RMIMS/admin/material-activity.html', 'utf8');
const uMA = fs.readFileSync('RMIMS/user/material-activity.html', 'utf8');

console.log('=== ADMIN maDisburse IDs ===');
console.log(Array.from(new Set(aMA.match(/id="maDisburse[a-zA-Z0-9_]+"/g))));

console.log('=== USER maDisburse IDs ===');
console.log(Array.from(new Set(uMA.match(/id="maDisburse[a-zA-Z0-9_]+"/g))));

console.log('=== ADMIN maReceive IDs ===');
console.log(Array.from(new Set(aMA.match(/id="maReceive[a-zA-Z0-9_]+"/g))));

console.log('=== USER maReceive IDs ===');
console.log(Array.from(new Set(uMA.match(/id="maReceive[a-zA-Z0-9_]+"/g))));
