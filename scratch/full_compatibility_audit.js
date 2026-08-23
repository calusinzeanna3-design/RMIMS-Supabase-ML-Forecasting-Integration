import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const baseUrl = 'https://rmims-7c156.web.app';

const routes = [
  '/RMIMS/index.html',
  '/RMIMS/login.html',
  '/RMIMS/portal.html',
  '/RMIMS/user-signin.html',
  '/RMIMS/kiosk-checkin.html',
  '/RMIMS/admin/dashboard.html',
  '/RMIMS/admin/inventory.html',
  '/RMIMS/admin/material-activity.html',
  '/RMIMS/admin/analytics.html',
  '/RMIMS/admin/forecasting.html',
  '/RMIMS/admin/reports.html',
  '/RMIMS/admin/user-management.html',
  '/RMIMS/admin/settings.html',
  '/RMIMS/user/dashboard.html',
  '/RMIMS/user/inventory.html',
  '/RMIMS/user/material-activity.html',
  '/RMIMS/user/analytics.html',
  '/RMIMS/user/reports.html',
  '/RMIMS/user/settings.html'
];

console.log('====================================================');
console.log('EXECUTING COMPREHENSIVE LOCAL vs DIST vs PUBLIC AUDIT');
console.log('====================================================\n');

async function runAudit() {
  const report = {
    localStatus: 'PASS',
    distStatus: 'PASS',
    deployedStatus: 'PASS',
    routesTested: 0,
    assetsTested: 0,
    failures: []
  };

  // 1. LOCAL SOURCE INSPECTION
  console.log('--- PHASE 1: LOCAL SOURCE STRUCTURE ---');
  routes.forEach(r => {
    const localPath = path.join(root, r.replace(/^\//, '').replace(/\//g, path.sep));
    if (fs.existsSync(localPath)) {
      console.log(`  [LOCAL FILE OK] ${r} (${fs.statSync(localPath).size} bytes)`);
    } else {
      console.error(`  [LOCAL FILE MISSING] ${localPath}`);
      report.localStatus = 'FAIL';
      report.failures.push(`Local source file missing: ${r}`);
    }
  });

  // 2. PRODUCTION DIST INSPECTION
  console.log('\n--- PHASE 2 & 3: PRODUCTION DIST STRUCTURE ---');
  routes.forEach(r => {
    const distPath = path.join(root, 'dist', r.replace(/^\//, '').replace(/\//g, path.sep));
    if (fs.existsSync(distPath)) {
      console.log(`  [DIST FILE OK] ${r} (${fs.statSync(distPath).size} bytes)`);
    } else {
      console.error(`  [DIST FILE MISSING] ${distPath}`);
      report.distStatus = 'FAIL';
      report.failures.push(`Production dist file missing: ${r}`);
    }
  });

  // 3. PUBLIC WEBSITE VERIFICATION ACROSS ALL ROUTES
  console.log('\n--- PHASE 4 & 5: PUBLIC DEPLOYMENT AUDIT ---');
  const allAssets = new Set();

  for (const route of routes) {
    const liveUrl = `${baseUrl}${route}`;
    report.routesTested++;
    try {
      const res = await fetch(liveUrl);
      if (res.ok) {
        const text = await res.text();
        console.log(`  [PUBLIC ROUTE 200 OK] ${route} (${text.length} bytes)`);

        // Extract CSS & JS & Image references
        const cssMatches = text.match(/href=["']([^"']+\.css[^"']*)["']/gi) || [];
        const jsMatches = text.match(/src=["']([^"']+\.js[^"']*)["']/gi) || [];
        const imgMatches = text.match(/src=["']([^"']+\.(?:png|jpg|jpeg|svg|ico|webp)[^"']*)["']/gi) || [];

        [...cssMatches, ...jsMatches, ...imgMatches].forEach(m => {
          const clean = m.replace(/^(?:href|src)=["']|["']$/gi, '');
          if (!clean.startsWith('http')) {
            if (clean.startsWith('/')) {
              allAssets.add(clean);
            } else {
              const dir = route.substring(0, route.lastIndexOf('/'));
              allAssets.add(`${dir}/${clean}`);
            }
          } else {
            allAssets.add(clean);
          }
        });

      } else {
        console.error(`  [PUBLIC ROUTE FAIL ${res.status}] ${route}`);
        report.deployedStatus = 'FAIL';
        report.failures.push(`Public route ${route} returned HTTP ${res.status}`);
      }
    } catch (e) {
      console.error(`  [PUBLIC ROUTE ERROR] ${route}: ${e.message}`);
      report.deployedStatus = 'FAIL';
      report.failures.push(`Public route ${route} failed with error: ${e.message}`);
    }
  }

  // 4. TEST ALL EXTRACTED PUBLIC ASSETS
  console.log(`\n--- PHASE 6 & 10: PUBLIC ASSET INTEGRITY AUDIT (${allAssets.size} assets) ---`);
  for (const assetPath of allAssets) {
    report.assetsTested++;
    const fullUrl = assetPath.startsWith('http') ? assetPath : `${baseUrl}${assetPath}`;
    try {
      const aRes = await fetch(fullUrl);
      if (aRes.ok) {
        console.log(`  [ASSET 200 OK] ${assetPath} -> ${aRes.headers.get('content-type')}`);
      } else {
        console.error(`  [ASSET FAIL ${aRes.status}] ${assetPath} (URL: ${fullUrl})`);
        report.deployedStatus = 'FAIL';
        report.failures.push(`Asset ${assetPath} returned HTTP ${aRes.status}`);
      }
    } catch (e) {
      console.error(`  [ASSET ERROR] ${assetPath}: ${e.message}`);
      report.deployedStatus = 'FAIL';
      report.failures.push(`Asset ${assetPath} failed: ${e.message}`);
    }
  }

  // 5. PRINT SUMMARY
  console.log('\n====================================================');
  console.log(`AUDIT COMPLETE:`);
  console.log(`  LOCAL SOURCE STATUS:        ${report.localStatus}`);
  console.log(`  PRODUCTION DIST STATUS:     ${report.distStatus}`);
  console.log(`  PUBLIC DEPLOYED SITE STATUS: ${report.deployedStatus}`);
  console.log(`  ROUTES TESTED:              ${report.routesTested}`);
  console.log(`  ASSETS TESTED:              ${report.assetsTested}`);
  console.log(`  TOTAL FAILURES:             ${report.failures.length}`);
  console.log('====================================================\n');

  if (report.failures.length > 0) {
    console.error('FAILURES SUMMARY:');
    report.failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }
}

runAudit();
