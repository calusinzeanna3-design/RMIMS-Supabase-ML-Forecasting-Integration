import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const targetUrl = 'https://rmims-7c156.web.app/RMIMS/admin/material-activity.html';
const baseUrl = 'https://rmims-7c156.web.app';

console.log('====================================================');
console.log('AUDITING PUBLIC DEPLOYED TARGET:');
console.log(targetUrl);
console.log('====================================================\n');

async function auditPublicPage() {
  // 1. Fetch live page HTML
  console.log('--- 1. FETCHING LIVE PUBLIC HTML ---');
  let htmlText = '';
  try {
    const res = await fetch(targetUrl);
    console.log(`[LIVE HTML]: HTTP ${res.status} ${res.statusText}`);
    if (!res.ok) {
      console.error(`[FAIL] Could not fetch ${targetUrl}`);
      process.exit(1);
    }
    htmlText = await res.text();
    console.log(`[LIVE HTML SIZE]: ${htmlText.length} bytes`);
  } catch (err) {
    console.error('[FETCH ERROR]:', err.message);
    process.exit(1);
  }

  // 2. Check HTML for required Material Activity sections
  console.log('\n--- 2. MATERIAL ACTIVITY REQUIRED SECTIONS CHECK ---');
  const requiredKeywords = [
    'Material Activity',
    'Product Overview',
    'Material Overview',
    'Actual Activity',
    'Record Stock Receipt',
    'Record Material Disbursement',
    'Finished Product',
    'Raw Material'
  ];

  let sectionsOk = true;
  requiredKeywords.forEach(kw => {
    if (htmlText.toLowerCase().includes(kw.toLowerCase())) {
      console.log(`  [PASS] Found section keyword: "${kw}"`);
    } else {
      console.error(`  [FAIL] Missing section keyword: "${kw}"`);
      sectionsOk = false;
    }
  });

  // 3. Extract and check all asset paths referenced in HTML
  console.log('\n--- 3. EXTRACTING & VERIFYING REFERENCED ASSETS ---');
  const assetUrls = new Set();

  // Extract CSS
  const cssMatches = htmlText.match(/href=["']([^"']+\.css[^"']*)["']/gi) || [];
  cssMatches.forEach(m => {
    const clean = m.replace(/^href=["']|["']$/gi, '');
    assetUrls.add(clean);
  });

  // Extract JS
  const jsMatches = htmlText.match(/src=["']([^"']+\.js[^"']*)["']/gi) || [];
  jsMatches.forEach(m => {
    const clean = m.replace(/^src=["']|["']$/gi, '');
    assetUrls.add(clean);
  });

  // Extract Images
  const imgMatches = htmlText.match(/src=["']([^"']+\.(?:png|jpg|jpeg|svg|ico|webp)[^"']*)["']/gi) || [];
  imgMatches.forEach(m => {
    const clean = m.replace(/^src=["']|["']$/gi, '');
    assetUrls.add(clean);
  });

  console.log(`Extracted ${assetUrls.size} asset URL(s) from material-activity.html:`);
  
  let assetsOk = true;
  for (const assetPath of assetUrls) {
    let resolvedUrl = assetPath;
    if (!assetPath.startsWith('http://') && !assetPath.startsWith('https://')) {
      if (assetPath.startsWith('/')) {
        resolvedUrl = `${baseUrl}${assetPath}`;
      } else {
        resolvedUrl = `${baseUrl}/RMIMS/admin/${assetPath}`;
      }
    }

    try {
      const aRes = await fetch(resolvedUrl);
      if (aRes.ok) {
        console.log(`  [PASS ${aRes.status}] ${assetPath} -> ${aRes.headers.get('content-type')}`);
      } else {
        console.error(`  [FAIL ${aRes.status}] ${assetPath} (Resolved: ${resolvedUrl})`);
        assetsOk = false;
      }
    } catch (e) {
      console.error(`  [ERROR] ${assetPath}: ${e.message}`);
      assetsOk = false;
    }
  }

  // 4. Compare Source vs Dist HTML
  console.log('\n--- 4. COMPARING STATES (SOURCE vs DIST) ---');
  const sourcePath = path.join(root, 'RMIMS', 'admin', 'material-activity.html');
  const distPath = path.join(root, 'dist', 'RMIMS', 'admin', 'material-activity.html');

  if (fs.existsSync(sourcePath)) console.log(`[SOURCE FILE]: ${sourcePath} (${fs.statSync(sourcePath).size} bytes)`);
  if (fs.existsSync(distPath)) console.log(`[DIST FILE]:   ${distPath} (${fs.statSync(distPath).size} bytes)`);

  // 5. Inspect Vite configuration
  console.log('\n--- 5. VITE CONFIGURATION CHECK ---');
  const viteConfigPath = path.join(root, 'vite.config.js');
  if (fs.existsSync(viteConfigPath)) console.log(`[vite.config.js]: exists (${fs.statSync(viteConfigPath).size} bytes)`);

  if (sectionsOk && assetsOk) {
    console.log('\n====================================================');
    console.log('PUBLIC MATERIAL ACTIVITY PAGE VERIFICATION: 100% PASS!');
    console.log('====================================================');
  } else {
    console.error('\n[FAIL] Material Activity page verification failed.');
    process.exit(1);
  }
}

auditPublicPage();
