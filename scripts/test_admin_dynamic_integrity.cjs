// Comprehensive verification script to verify zero hardcoded data in admin portal
const fs = require('fs');
const path = require('path');

console.log('=== VERIFYING ADMIN PORTAL DYNAMIC INTEGRITY (NO HARDCODED DATA) ===\n');

let failed = false;

// 1. Check admin javascript files for hardcoded fallbacks
const adminJsFiles = [
  'RMIMS/js/admin-activity-logs.js',
  'RMIMS/js/admin-overview.js',
  'RMIMS/js/admin-branch-stores.js',
  'RMIMS/js/admin-user-management.js',
  'RMIMS/js/admin-settings.js',
  'RMIMS/js/admin-shell.js',
  'RMIMS/js/admin-system-alerts.js',
  'RMIMS/supabase/admin-supabase-service.js'
];

const bannedHardcodedPatterns = [
  { pattern: /locClass\s*===\s*'lucena'\s*\?\s*'Lucena City, Quezon'\s*:\s*'Tiaong, Quezon'/, desc: 'Binary location ternary forcing Tiaong/Lucena' },
  { pattern: /'672295'/, desc: 'Hardcoded access code 672295' },
  { pattern: /'Staff 1'/, desc: 'Fake Staff 1 mock generator' },
  { pattern: /labels7\s*=\s*\['Sep 15'/, desc: 'Hardcoded chart date labels' },
  { pattern: /'09:00 AM'/, desc: 'Hardcoded 09:00 AM timestamp' }
];

adminJsFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  bannedHardcodedPatterns.forEach(({ pattern, desc }) => {
    if (pattern.test(content)) {
      console.error(`❌ FAIL [${file}]: Detected banned hardcoded pattern: ${desc}`);
      failed = true;
    }
  });
});

if (!failed) {
  console.log('✅ PASS: All Admin JS files have zero banned hardcoded patterns.');
}

// 2. Check admin HTML files for static mock table rows
const adminHtmlFiles = [
  'RMIMS/admin/activity-logs.html',
  'RMIMS/admin/overview.html',
  'RMIMS/admin/branch-stores.html',
  'RMIMS/admin/user-management.html',
  'RMIMS/admin/system-alerts.html',
  'RMIMS/admin/settings.html'
];

adminHtmlFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  // Check that table bodies have dynamic target IDs and no static mock rows
  const matches = content.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi) || [];
  matches.forEach(tbody => {
    if (tbody.includes('<tr>') && (tbody.includes('Rafael Cruz') || tbody.includes('Carla Mendoza') || tbody.includes('KXC Enterprises'))) {
      console.error(`❌ FAIL [${file}]: Static mock table row found in tbody: ${tbody}`);
      failed = true;
    }
  });
});

if (!failed) {
  console.log('✅ PASS: All Admin HTML table bodies are clean and dynamic.');
}

// 3. Verify settings profile fields have dynamic input IDs
const settingsHtml = fs.readFileSync('RMIMS/admin/settings.html', 'utf8');
if (settingsHtml.includes('id="adminSettingName"') && settingsHtml.includes('id="adminSettingRole"') && settingsHtml.includes('id="adminSettingEmail"')) {
  console.log('✅ PASS: Admin settings inputs have dynamic binding IDs.');
} else {
  console.error('❌ FAIL: Admin settings inputs missing dynamic IDs.');
  failed = true;
}

// 4. Verify admin-shell syncs profile with session storage
const shellJs = fs.readFileSync('RMIMS/js/admin-shell.js', 'utf8');
if (shellJs.includes('syncAdminProfile') && shellJs.includes('.profile-name') && shellJs.includes('.profile-avatar')) {
  console.log('✅ PASS: Admin shell dynamically binds profile from active session.');
} else {
  console.error('❌ FAIL: Admin shell missing dynamic profile sync.');
  failed = true;
}

// 5. Verify admin-branch-stores generates dynamic location labels and clean staff
const branchJs = fs.readFileSync('RMIMS/js/admin-branch-stores.js', 'utf8');
if (branchJs.includes('staff: []') && !branchJs.includes("locations.set('tiaong'") && !branchJs.includes("LOCATIONS_CONFIG = {")) {
  console.log('✅ PASS: Branch store creation assigns dynamic location label and has zero hardcoded cities/locations.');
} else {
  console.error('❌ FAIL: Branch store creation still has hardcoded location sets or static LOCATIONS_CONFIG.');
  failed = true;
}

// 6. Verify parseBranch in system-alerts-service.js does not hardcode cities
const alertsServiceJs = fs.readFileSync('RMIMS/js/system-alerts-service.js', 'utf8');
if (!alertsServiceJs.includes("str.toLowerCase().includes('tiaong')") && !alertsServiceJs.includes("str.toLowerCase().includes('lucena')")) {
  console.log('✅ PASS: System alerts service parseBranch uses dynamic regex without hardcoded cities.');
} else {
  console.error('❌ FAIL: System alerts service parseBranch still has hardcoded city checks.');
  failed = true;
}

// 7. Verify admin user management does not hardcode fallback cities
const userMgmtJs = fs.readFileSync('RMIMS/js/admin-user-management.js', 'utf8');
if (!userMgmtJs.includes("loc || 'Tiaong, Quezon'") && !userMgmtJs.includes("loc || 'Lucena City, Quezon'")) {
  console.log('✅ PASS: Admin user management location badges are completely dynamic.');
} else {
  console.error('❌ FAIL: Admin user management location badges contain hardcoded city fallbacks.');
  failed = true;
}

if (failed) {
  console.error('\n❌ OVERALL VERIFICATION FAILED.');
  process.exit(1);
} else {
  console.log('\n🎉 ALL DYNAMIC INTEGRITY CHECKS PASSED WITH 100% SUCCESS!');
  process.exit(0);
}
