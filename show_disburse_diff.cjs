const fs = require('fs');

const uDis = fs.readFileSync('user_openDisburse.js', 'utf8');
const aDis = fs.readFileSync('admin_openDisburse.js', 'utf8');

console.log('--- USER OPENDISBURSE ---');
console.log(uDis.slice(0, 1000));
console.log('...\n', uDis.slice(-800));

console.log('--- ADMIN OPENDISBURSE ---');
console.log(aDis.slice(0, 1000));
console.log('...\n', aDis.slice(-800));
