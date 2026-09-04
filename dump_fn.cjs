const fs = require('fs');

const adminJs = fs.readFileSync('RMIMS/js/material-activity-admin.js', 'utf8');
const userJs = fs.readFileSync('RMIMS/js/user-material-activity.js', 'utf8');

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

fs.writeFileSync('user_openDisburse.js', extractFunction(userJs, 'openDisburseModal'));
fs.writeFileSync('admin_openDisburse.js', extractFunction(adminJs, 'openDisburseModal'));
fs.writeFileSync('user_openReceive.js', extractFunction(userJs, 'openReceiveModal'));
fs.writeFileSync('admin_openReceive.js', extractFunction(adminJs, 'openReceiveModal'));
console.log('Saved files for comparison');
