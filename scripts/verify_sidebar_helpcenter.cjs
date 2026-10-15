const fs = require('fs');
const path = require('path');

console.log('=== VERIFYING SIDEBAR & HELP CENTER REDESIGN (Image 2 & Image 3) ===');

const adminPages = [
  'overview.html',
  'activity-logs.html',
  'user-management.html',
  'branch-stores.html',
  'system-alerts.html',
  'settings.html'
];

let allPassed = true;

adminPages.forEach(file => {
  const p = path.join(__dirname, '..', 'RMIMS', 'admin', file);
  const html = fs.readFileSync(p, 'utf8');

  // Check 1: sidebar-bottom-nav exists
  if (!html.includes('class="sidebar-bottom-nav"')) {
    console.error(`FAIL: ${file} missing .sidebar-bottom-nav container!`);
    allPassed = false;
  }

  // Check 2: btnSidebarHelp exists and does NOT have badge 8
  if (!html.includes('id="btnSidebarHelp"')) {
    console.error(`FAIL: ${file} missing #btnSidebarHelp!`);
    allPassed = false;
  }
  if (html.includes('class="nav-badge-pill">8</span>')) {
    console.error(`FAIL: ${file} still has red badge 8 on Help Center!`);
    allPassed = false;
  }

  // Check 2b: sidebar-header has brand-icon-box and brand-name RMSME (no brand-sub)
  if (!html.includes('<span class="brand-name">RMSME</span>')) {
    console.error(`FAIL: ${file} missing <span class="brand-name">RMSME</span> in sidebar-header!`);
    allPassed = false;
  }
  if (html.includes('brand-sub')) {
    console.error(`FAIL: ${file} still has brand-sub subtitle!`);
    allPassed = false;
  }

  // Check 2c: sidebar-version exists with v2.0.0
  if (!html.includes('class="sidebar-version"') || !html.includes('v2.0.0')) {
    console.error(`FAIL: ${file} missing .sidebar-version with v2.0.0!`);
    allPassed = false;
  }

  // Check 3: settings.html link is inside sidebar-bottom-nav
  const bottomNavStart = html.indexOf('class="sidebar-bottom-nav"');
  const bottomNavEnd = html.indexOf('</aside>', bottomNavStart);
  const bottomNavContent = html.substring(bottomNavStart, bottomNavEnd);

  if (!bottomNavContent.includes('href="settings.html"')) {
    console.error(`FAIL: ${file} does not have settings.html link inside .sidebar-bottom-nav!`);
    allPassed = false;
  }

  // Check 4: settings.html link has active class only on settings.html
  if (file === 'settings.html') {
    if (!bottomNavContent.includes('class="nav-link active"')) {
      console.error(`FAIL: settings.html should have .active on settings link!`);
      allPassed = false;
    }
  }

  // Check 5: Top modules preserved in sidebar-nav
  const topNavStart = html.indexOf('class="sidebar-nav"');
  const topNavContent = html.substring(topNavStart, bottomNavStart);
  const expectedModules = ['overview.html', 'activity-logs.html', 'user-management.html', 'branch-stores.html', 'system-alerts.html'];
  expectedModules.forEach(mod => {
    if (!topNavContent.includes(`href="${mod}"`)) {
      console.error(`FAIL: ${file} top navigation missing module link: ${mod}`);
      allPassed = false;
    }
  });

  console.log(`✓ ${file} sidebar structure verified.`);
});

// Check CSS
const cssPath = path.join(__dirname, '..', 'RMIMS', 'css', 'admin-shell.css');
const css = fs.readFileSync(cssPath, 'utf8');
const requiredCssSelectors = [
  '.sidebar-bottom-nav',
  '.nav-badge-pill',
  '.help-modal-backdrop',
  '.help-modal-window',
  '.help-faq-list',
  '.help-faq-item',
  '.help-faq-trigger',
  '.help-faq-chevron',
  '.help-faq-answer',
  '.help-guide-card',
  '.btn-start-guide'
];

requiredCssSelectors.forEach(sel => {
  if (!css.includes(sel)) {
    console.error(`FAIL: admin-shell.css missing required selector "${sel}"`);
    allPassed = false;
  }
});
console.log('✓ admin-shell.css styling rules verified.');

// Check JS
const jsPath = path.join(__dirname, '..', 'RMIMS', 'js', 'admin-shell.js');
const js = fs.readFileSync(jsPath, 'utf8');
const requiredJsSnippets = [
  '.sidebar-bottom-nav .nav-link',
  'setupHelpCenter',
  'helpCenterModal',
  'btnSidebarHelp',
  'btnCloseHelpCenter',
  'help-faq-trigger',
  'btnStartOnboardingGuide'
];

requiredJsSnippets.forEach(snip => {
  if (!js.includes(snip)) {
    console.error(`FAIL: admin-shell.js missing required snippet "${snip}"`);
    allPassed = false;
  }
});
console.log('✓ admin-shell.js interactive controller verified.');

if (allPassed) {
  console.log('\n===========================================');
  console.log('ALL VERIFICATIONS PASSED SUCCESSFULLY (100%)');
  console.log('===========================================');
} else {
  console.error('\n>>> SOME CHECKS FAILED! <<<');
  process.exit(1);
}
