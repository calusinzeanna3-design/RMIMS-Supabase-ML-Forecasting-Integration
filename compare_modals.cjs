const fs = require('fs');
const aHtml = fs.readFileSync('RMIMS/admin/material-activity.html', 'utf8');
const uHtml = fs.readFileSync('RMIMS/user/material-activity.html', 'utf8');

function findOverlays(html) {
  const matches = [];
  const regex = /id=["']([^"']*modal[^"']*)["']/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

console.log('ADMIN modal IDs:', findOverlays(aHtml));
console.log('USER modal IDs:', findOverlays(uHtml));
