const fs = require('fs');

const adminJs = fs.readFileSync('RMIMS/js/material-activity-admin.js', 'utf8');

function extractFunction(code, fnName) {
    const regex = new RegExp(`async function ${fnName}\\b|function ${fnName}\\b`);
    const match = regex.exec(code);
    if (!match) return `Function ${fnName} not found!`;
    const start = match.index;
    let braceCount = 0;
    let started = false;
    let end = start;
    for (let i = start; i < code.length; i++) {
        if (code[i] === '{') {
            braceCount++;
            started = true;
        } else if (code[i] === '}') {
            braceCount--;
            if (started && braceCount === 0) {
                end = i + 1;
                break;
            }
        }
    }
    return code.substring(start, end);
}

const aSaveRec = extractFunction(adminJs, 'handleSaveReceive');
const aSaveDis = extractFunction(adminJs, 'handleSaveDisburse');

const aHtml = fs.readFileSync('RMIMS/admin/material-activity.html', 'utf8');

const idsSaveRec = Array.from(aSaveRec.matchAll(/document\.getElementById\(["']([^"']+)["']\)/g), m => m[1]);
const idsSaveDis = Array.from(aSaveDis.matchAll(/document\.getElementById\(["']([^"']+)["']\)/g), m => m[1]);

console.log('Missing IDs in handleSaveReceive:', idsSaveRec.filter(id => !aHtml.includes(`id="${id}"`)));
console.log('Missing IDs in handleSaveDisburse:', idsSaveDis.filter(id => !aHtml.includes(`id="${id}"`)));
