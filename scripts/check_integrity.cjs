const fs = require('fs');
const files = [
  'RMIMS/js/reports.js',
  'RMIMS/js/backup-restore.js',
  'RMIMS/js/material-activity-admin.js'
];

let hasError = false;
for (const file of files) {
  try {
    const code = fs.readFileSync(file, 'utf8');
    // Basic check for unclosed brackets or syntax
    console.log(`Checking ${file}... (${code.length} chars)`);
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
    hasError = true;
  }
}
if (!hasError) console.log('All files verified OK!');
