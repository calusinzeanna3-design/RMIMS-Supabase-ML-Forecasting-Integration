console.log('====================================================');
console.log('LIVE ONLINE PUBLIC DEPLOYMENT VERIFICATION');
console.log('====================================================\n');

const baseUrl = 'https://rmims-7c156.web.app';

const urls = [
  `${baseUrl}/RMIMS/index.html`,
  `${baseUrl}/RMIMS/login.html`,
  `${baseUrl}/RMIMS/portal.html`,
  `${baseUrl}/RMIMS/user-signin.html`,
  `${baseUrl}/RMIMS/admin/dashboard.html`,
  `${baseUrl}/RMIMS/user/dashboard.html`,
  `${baseUrl}/RMIMS/admin/inventory.html`,
  `${baseUrl}/RMIMS/user/inventory.html`,
  `${baseUrl}/RMIMS/admin/material-activity.html`,
  `${baseUrl}/RMIMS/admin/analytics.html`,
  `${baseUrl}/RMIMS/admin/forecasting.html`,
  `${baseUrl}/RMIMS/admin/reports.html`,
  `${baseUrl}/RMIMS/admin/settings.html`,
  `${baseUrl}/RMIMS/assets/logo-icon.png`,
  `${baseUrl}/RMIMS/assets/rmsme-3d-logo.png`,
  `${baseUrl}/RMIMS/assets/logo-full.png`
];

async function verifyLiveDeployment() {
  let failed = false;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`[PASS 200 OK] ${url} -> ${res.headers.get('content-type')}`);
      } else {
        console.error(`[FAIL HTTP ${res.status}] ${url}`);
        failed = true;
      }
    } catch (e) {
      console.error(`[FETCH ERROR] ${url}: ${e.message}`);
      failed = true;
    }
  }

  if (failed) {
    console.error('\n[FAIL] Live verification encountered errors!');
    process.exit(1);
  } else {
    console.log('\n====================================================');
    console.log('ALL LIVE PUBLIC HTTPS ROUTES & ASSETS VERIFIED 100% SUCCESSFUL!');
    console.log(`LIVE PUBLIC URL: ${baseUrl}/RMIMS/index.html`);
    console.log('====================================================');
    process.exit(0);
  }
}

verifyLiveDeployment();
