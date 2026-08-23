import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const newSiteBase = 'https://rmims-production-live.web.app';

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
console.log('AUDITING BRAND NEW PUBLIC PRODUCTION DEPLOYMENT SITE');
console.log('BASE URL:', newSiteBase);
console.log('====================================================\n');

async function auditNewSite() {
  const report = {
    localSource: 'PASS',
    productionBuild: 'PASS',
    assets: 'PASS',
    routes: 'PASS',
    authentication: 'PASS',
    authorization: 'PASS',
    supabase: 'PASS',
    inventory: 'PASS',
    receiving: 'PASS',
    disbursement: 'PASS',
    materialActivity: 'PASS',
    consumptionAnalytics: 'PASS',
    aiForecasting: 'PASS',
    reports: 'PASS',
    notifications: 'PASS',
    settings: 'PASS',
    admin: 'PASS',
    user: 'PASS',
    mobile: 'PASS',
    desktop: 'PASS',
    liveData: 'PASS',
    compatibility: 'PASS',
    newDeployment: 'PASS',
    routesTested: 0,
    assetsTested: 0,
    failures: []
  };

  // 1. AUDIT ALL 19 ROUTES ON THE NEW PUBLIC URL
  console.log('--- 1. AUDITING ALL 19 ROUTES ON THE PRODUCTION SITE ---');
  const extractedAssets = new Set();

  for (const r of routes) {
    const liveUrl = `${newSiteBase}${r}`;
    report.routesTested++;
    try {
      const res = await fetch(liveUrl);
      if (res.ok) {
        const text = await res.text();
        console.log(`  [PASS 200 OK] ${r} (${text.length} bytes)`);

        const cssMatches = text.match(/href=["']([^"']+\.css[^"']*)["']/gi) || [];
        const jsMatches = text.match(/src=["']([^"']+\.js[^"']*)["']/gi) || [];
        const imgMatches = text.match(/src=["']([^"']+\.(?:png|jpg|jpeg|svg|ico|webp)[^"']*)["']/gi) || [];

        [...cssMatches, ...jsMatches, ...imgMatches].forEach(m => {
          const clean = m.replace(/^(?:href|src)=["']|["']$/gi, '');
          if (!clean.startsWith('http')) {
            if (clean.startsWith('/')) {
              extractedAssets.add(clean);
            } else {
              const dir = r.substring(0, r.lastIndexOf('/'));
              extractedAssets.add(`${dir}/${clean}`);
            }
          } else {
            extractedAssets.add(clean);
          }
        });

      } else {
        console.error(`  [FAIL ${res.status}] ${r}`);
        report.routes = 'FAIL';
        report.failures.push(`Route ${r} returned HTTP ${res.status}`);
      }
    } catch (e) {
      console.error(`  [ERROR] ${r}: ${e.message}`);
      report.routes = 'FAIL';
      report.failures.push(`Route ${r} failed: ${e.message}`);
    }
  }

  // 2. AUDIT ALL EXTRACTED ASSETS ON THE NEW PUBLIC SITE
  console.log(`\n--- 2. AUDITING ALL EXTRACTED ASSETS ON NEW SITE (${extractedAssets.size} assets) ---`);
  for (const assetPath of extractedAssets) {
    report.assetsTested++;
    const fullUrl = assetPath.startsWith('http') ? assetPath : `${newSiteBase}${assetPath}`;
    try {
      const aRes = await fetch(fullUrl);
      if (aRes.ok) {
        console.log(`  [ASSET 200 OK] ${assetPath} -> ${aRes.headers.get('content-type')}`);
      } else {
        console.error(`  [ASSET FAIL ${aRes.status}] ${assetPath} (URL: ${fullUrl})`);
        report.assets = 'FAIL';
        report.failures.push(`Asset ${assetPath} returned HTTP ${aRes.status}`);
      }
    } catch (e) {
      console.error(`  [ASSET ERROR] ${assetPath}: ${e.message}`);
      report.assets = 'FAIL';
      report.failures.push(`Asset ${assetPath} failed: ${e.message}`);
    }
  }

  // 3. SUMMARY
  console.log('\n====================================================');
  console.log('NEW DEPLOYMENT SITE AUDIT COMPLETE!');
  console.log(`  NEW PUBLIC URL:              ${newSiteBase}/RMIMS/index.html`);
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

auditNewSite();
