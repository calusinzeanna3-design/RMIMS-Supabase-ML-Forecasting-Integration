const fs = require('fs');

const userCode = fs.readFileSync('RMIMS/js/user-material-activity.js', 'utf8');
const adminCode = fs.readFileSync('RMIMS/js/material-activity-admin.js', 'utf8');

function getFn(code, fnName) {
  const reg = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*\\([\\s\\S]*?\\n(?=(?:async\\s+)?function|\\/\\*|$)`);
  const m = code.match(reg);
  return m ? m[0] : '';
}

['openDisburseModal', 'handleSaveReceive', 'handleSaveDisburse'].forEach(fn => {
  console.log(`\n================== ${fn} DIFF ==================`);
  const u = getFn(userCode, fn);
  const a = getFn(adminCode, fn);
  const uLines = u.split('\n');
  const aLines = a.split('\n');
  
  console.log(`User lines: ${uLines.length}, Admin lines: ${aLines.length}`);
  // Let's print unique lines or diffs
  for (let i = 0; i < Math.max(uLines.length, aLines.length); i++) {
    const ul = (uLines[i] || '').trim();
    const al = (aLines[i] || '').trim();
    if (ul !== al) {
      console.log(`L${i+1}:`);
      console.log(`  USER : ${ul.slice(0, 100)}`);
      console.log(`  ADMIN: ${al.slice(0, 100)}`);
      if (i > 30) {
        console.log('...stopping diff print for this fn...');
        break;
      }
    }
  }
});
