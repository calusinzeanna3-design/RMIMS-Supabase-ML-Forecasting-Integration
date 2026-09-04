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

const aRec = extractFunction(adminJs, 'openReceiveModal');
const uRec = extractFunction(userJs, 'openReceiveModal');
console.log('--- Difference in openReceiveModal ---');
if (aRec === uRec) {
    console.log('openReceiveModal is IDENTICAL');
} else {
    console.log('openReceiveModal is DIFFERENT');
}

const aDis = extractFunction(adminJs, 'openDisburseModal');
const uDis = extractFunction(userJs, 'openDisburseModal');
console.log('\n--- Difference in openDisburseModal ---');
if (aDis === uDis) {
    console.log('openDisburseModal is IDENTICAL');
} else {
    console.log('openDisburseModal is DIFFERENT:');
    console.log('Admin length:', aDis.length, 'User length:', uDis.length);
}
