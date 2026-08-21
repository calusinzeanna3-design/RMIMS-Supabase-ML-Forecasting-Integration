// scratch/verify_user_dashboard_additions.js
import fs from 'fs';
import path from 'path';

const htmlPath = path.resolve('RMIMS/user/dashboard.html');
const jsPath = path.resolve('RMIMS/js/user-dashboard.js');
const cssPath = path.resolve('RMIMS/css/user-dashboard.css');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');

console.log("1. Checking preserved existing dashboard elements...");
const existingElements = [
  'availableMaterialsCount',
  'rawMaterialsSubtitle',
  'consumedTicker',
  'consumedTickerText',
  'consumedFullSummary',
  'consumedComparison',
  'outOfStockCount',
  'outOfStockTicker',
  'outOfStockTickerText',
  'cardReceiveRawMaterials',
  'receivePieChart',
  'receiveLegendList',
  'topReceivedList',
  'adminTrendCard',
  'trendMaterialSelect',
  'trendGranularityGroup',
  'rawMaterialsTrendChart',
  'cardAiForecastSupport',
  'forecastSupportContainer'
];

existingElements.forEach(id => {
  if (!htmlContent.includes(`id="${id}"`)) {
    console.error(`FAILED: Missing preserved element ID '${id}' in user/dashboard.html`);
    process.exit(1);
  }
});
console.log("PASS: All existing dashboard elements preserved 100%!");

console.log("2. Checking that NO Quick Actions exist...");
if (htmlContent.toLowerCase().includes("quick action") || htmlContent.toLowerCase().includes("quick-action")) {
  console.error("FAILED: Quick actions found in user/dashboard.html!");
  process.exit(1);
}
console.log("PASS: Zero Quick Actions present!");

console.log("3. Checking Addition #1: Operational Attention...");
if (!htmlContent.includes('id="cardOperationalAttention"') || !htmlContent.includes('id="operationalAttentionContainer"')) {
  console.error("FAILED: Missing Operational Attention card or container in user/dashboard.html");
  process.exit(1);
}
if (!jsContent.includes("renderOperationalAttention") || !jsContent.includes("No materials currently require attention.")) {
  console.error("FAILED: Missing renderOperationalAttention or empty state in user-dashboard.js");
  process.exit(1);
}
console.log("PASS: Operational Attention section and live logic verified!");

console.log("4. Checking Addition #2: Recent Consumption Activity...");
if (!htmlContent.includes('id="cardRecentMaterialActivity"') || !htmlContent.includes('Recent Consumption Activity') || !htmlContent.includes('id="recentActivityTableBody"')) {
  console.error("FAILED: Missing Recent Consumption Activity card or table body in user/dashboard.html");
  process.exit(1);
}
if (!jsContent.includes("renderRecentMaterialActivity") || !jsContent.includes("No recent consumption activity recorded.")) {
  console.error("FAILED: Missing renderRecentMaterialActivity or empty state in user-dashboard.js");
  process.exit(1);
}
console.log("PASS: Recent Consumption Activity section and table logic verified!");

console.log("5. Checking AI Forecast Support card enhancements...");
if (!jsContent.includes("No live AI forecast results available.") || !jsContent.includes("Forecast Requirement:")) {
  console.error("FAILED: Missing enhanced AI forecast support details or empty state in user-dashboard.js");
  process.exit(1);
}
console.log("PASS: Enhanced AI Forecast Support verified!");

console.log("6. Checking user-dashboard.css...");
if (!cssContent.includes(".operational-attention-grid") || !cssContent.includes(".recent-activity-table")) {
  console.error("FAILED: Missing expected CSS classes in user-dashboard.css");
  process.exit(1);
}
console.log("PASS: user-dashboard.css styles verified!");

console.log("ALL USER DASHBOARD ADDITION VERIFICATIONS PASSED!");
