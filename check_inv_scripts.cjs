const fs = require('fs');
const aHtml = fs.readFileSync('RMIMS/admin/inventory.html', 'utf8');
const uHtml = fs.readFileSync('RMIMS/user/inventory.html', 'utf8');
console.log('admin inventory scripts:', Array.from(aHtml.matchAll(/<script[^>]*src=["']([^"']+)["']/g), m => m[1]));
console.log('user inventory scripts:', Array.from(uHtml.matchAll(/<script[^>]*src=["']([^"']+)["']/g), m => m[1]));
