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

['openReceiveModal', 'openDisburseModal', 'handleSaveReceive', 'handleSaveDisburse', 'initEventListeners'].forEach(fn => {
    const aFn = extractFunction(adminJs, fn);
    const uFn = extractFunction(userJs, fn);
    console.log(`=== ${fn} in Admin (len ${aFn.length}) vs User (len ${uFn.length}) ===`);
});
