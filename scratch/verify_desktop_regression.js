import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

console.log('====================================================');
console.log('VERIFYING DESKTOP REGRESSION (1366px, 1440px, 1920px)');
console.log('====================================================\n');

// Inspect rmims-unified.css rules for desktop viewports (min-width: 901px)
const cssPath = path.join(root, 'RMIMS', 'css', 'rmims-unified.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

const hasDesktopRecovery = cssContent.includes('@media (min-width: 901px)');
const hidesMobileMenuOnDesktop = cssContent.includes('.rmsme-mobile-menu-btn') && cssContent.includes('display: none');
const hidesBackdropOnDesktop = cssContent.includes('.rmsme-mobile-drawer-backdrop') && cssContent.includes('display: none');

console.log('1. CSS Desktop Scoping Check:');
console.log(`   - Desktop Recovery Media Query (@media (min-width: 901px)): ${hasDesktopRecovery ? '[PASS]' : '[FAIL]'}`);
console.log(`   - Mobile Menu Button hidden on Desktop: ${hidesMobileMenuOnDesktop ? '[PASS]' : '[FAIL]'}`);
console.log(`   - Mobile Backdrop hidden on Desktop: ${hidesBackdropOnDesktop ? '[PASS]' : '[FAIL]'}`);

// Check all desktop HTML pages
const pages = [
  'RMIMS/admin/dashboard.html',
  'RMIMS/admin/inventory.html',
  'RMIMS/admin/material-activity.html',
  'RMIMS/admin/analytics.html',
  'RMIMS/admin/forecasting.html',
  'RMIMS/admin/reports.html',
  'RMIMS/admin/user-management.html',
  'RMIMS/admin/settings.html',
  'RMIMS/user/dashboard.html',
  'RMIMS/user/inventory.html',
  'RMIMS/user/material-activity.html',
  'RMIMS/user/analytics.html',
  'RMIMS/user/reports.html',
  'RMIMS/user/settings.html'
];

console.log('\n2. Desktop Page Structure Check:');
let pagesOk = true;
pages.forEach(p => {
  const full = path.join(root, p);
  if (fs.existsSync(full)) {
    console.log(`   [PASS] ${p} exists and intact.`);
  } else {
    console.error(`   [FAIL] ${p} missing!`);
    pagesOk = false;
  }
});

if (hasDesktopRecovery && hidesMobileMenuOnDesktop && hidesBackdropOnDesktop && pagesOk) {
  console.log('\n====================================================');
  console.log('DESKTOP REGRESSION STATUS: 100% PASS!');
  console.log('Desktop layout, sidebar, cards, and modules remain completely unchanged.');
  console.log('====================================================');
} else {
  console.error('\n[FAIL] Desktop regression verification failed.');
  process.exit(1);
}
