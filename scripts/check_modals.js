const fs = require('fs');
const uMA = fs.readFileSync('RMIMS/user/material-activity.html', 'utf8');
const aMA = fs.readFileSync('RMIMS/admin/material-activity.html', 'utf8');

function findModals(html) {
  const matches = [];
  const regex = /id="([^"]*modal[^"]*)"/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

console.log('User MA modals:', findModals(uMA));
console.log('Admin MA modals:', findModals(aMA));
