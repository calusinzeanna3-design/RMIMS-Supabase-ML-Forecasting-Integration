const fs = require('fs');
const aHtml = fs.readFileSync('RMIMS/admin/material-activity.html', 'utf8');
const uHtml = fs.readFileSync('RMIMS/user/material-activity.html', 'utf8');

function getScripts(html) {
  return Array.from(html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/g), m => m[1]);
}

console.log('ADMIN scripts:');
console.log(getScripts(aHtml));

console.log('\nUSER scripts:');
console.log(getScripts(uHtml));
