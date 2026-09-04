const fs = require('fs');
const u = fs.readFileSync('RMIMS/js/user-material-activity.js', 'utf8');
const a = fs.readFileSync('RMIMS/js/material-activity-admin.js', 'utf8');

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

const uD = extractFunction(u, 'handleSaveDisburse');
const aD = extractFunction(a, 'handleSaveDisburse');
console.log('user handleSaveDisburse len:', uD.length, 'admin handleSaveDisburse len:', aD.length);

const uR = extractFunction(u, 'handleSaveReceive');
const aR = extractFunction(a, 'handleSaveReceive');
console.log('user handleSaveReceive len:', uR.length, 'admin handleSaveReceive len:', aR.length);

fs.writeFileSync('u_disburse.js', uD);
fs.writeFileSync('a_disburse.js', aD);
fs.writeFileSync('u_receive.js', uR);
fs.writeFileSync('a_receive.js', aR);
