console.log('====================================================');
console.log('VERIFYING ACTUAL LIVE PRODUCTION DEPLOYMENT URL');
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
  `${baseUrl}/RMIMS/admin/settings.html`
];

async function testLiveUrls() {
  let failed = false;
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok || res.status === 200 || res.status === 304) {
        console.log(`[PASS] ${url} -> HTTP ${res.status}`);
      } else {
        // Try GET if HEAD is restricted
        const resGet = await fetch(url);
        if (resGet.ok) {
          console.log(`[PASS] ${url} -> HTTP ${resGet.status}`);
        } else {
          console.error(`[FAIL] ${url} -> HTTP ${resGet.status}`);
          failed = true;
        }
      }
    } catch (err) {
      console.error(`[FAIL] ${url} -> Fetch Error: ${err.message}`);
      failed = true;
    }
  }

  if (failed) {
    console.error('\n[FAIL] Some production URLs failed verification.');
    process.exit(1);
  } else {
    console.log('\n[SUCCESS] ALL LIVE ONLINE PRODUCTION URLS VERIFIED SUCCESSFULLY!');
    console.log(`PRODUCTION URL: ${baseUrl}/RMIMS/index.html`);
  }
}

testLiveUrls();
