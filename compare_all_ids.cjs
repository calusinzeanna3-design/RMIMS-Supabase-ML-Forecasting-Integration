const fs = require('fs');
const aHtml = fs.readFileSync('RMIMS/admin/material-activity.html', 'utf8');
const uHtml = fs.readFileSync('RMIMS/user/material-activity.html', 'utf8');

function getIds(html) {
  const matches = [];
  const regex = /id=["']([^"']+)["']/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

const aIds = new Set(getIds(aHtml));
const uIds = new Set(getIds(uHtml));

console.log('In User but missing in Admin:');
for (let id of uIds) {
  if (!aIds.has(id)) console.log('  missing:', id);
}

console.log('In Admin but missing in User:');
for (let id of aIds) {
  if (!uIds.has(id)) console.log('  missing:', id);
}
