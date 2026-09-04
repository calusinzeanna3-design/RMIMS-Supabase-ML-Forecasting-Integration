const fs = require('fs');

const aHtml = fs.readFileSync('RMIMS/admin/material-activity.html', 'utf8');
const uHtml = fs.readFileSync('RMIMS/user/material-activity.html', 'utf8');

function getButtons(html) {
    const regex = /<button[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/button>/gi;
    const btns = [];
    let m;
    while ((m = regex.exec(html)) !== null) {
        btns.push({ id: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() });
    }
    return btns;
}

console.log('User buttons:');
console.log(getButtons(uHtml));

console.log('\nAdmin buttons:');
console.log(getButtons(aHtml));
