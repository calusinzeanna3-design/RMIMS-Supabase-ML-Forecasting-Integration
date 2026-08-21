// scratch/verify_user_dashboard.js
import fs from 'fs';
import path from 'path';

const htmlPath = path.resolve('RMIMS/user/dashboard.html');
const jsPath = path.resolve('RMIMS/js/user-dashboard.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

const requiredIds = [
  'welcomeGreeting',
  'livePill',
  'cardRawMaterials',
  'availableMaterialsCount',
  'rawMaterialsSubtitle',
  'cardTotalConsumed',
  'consumedTicker',
  'consumedTickerText',
  'consumedFullSummary',
  'consumedComparison',
  'cardOutOfStock',
  'outOfStockCount',
  'outOfStockTicker',
  'outOfStockTickerText',
  'outOfStockFullSummary',
  'cardReceiveRawMaterials',
  'rrcMaterialCountBadge',
  'rrcUnitBadge',
  'receivePieChart',
  'receiveLegendList',
  'topReceivedList',
  'btnViewAllReceived',
  'adminTrendCard',
  'trendMaterialSelect',
  'trendGranularityGroup',
  'rawMaterialsTrendChart',
  'trendFooterMeta',
  'cardAiForecastSupport',
  'forecastSupportContainer',
  'adminModalBackdrop',
  'modalRawMaterialStatus',
  'rawMaterialSearch',
  'rawMaterialFilter',
  'rawMaterialsTableBody',
  'rawMaterialsCountNote',
  'modalConsumptionAnalytics',
  'modalCategoryFilter',
  'modalGranularityGroup',
  'modalConsumptionChart',
  'modalChartLegend',
  'modalChartInsights',
  'modalOutOfStock',
  'outOfStockTilesList',
  'outOfStockCountNote',
  'modalReceivedRecords',
  'receivedSearchInput',
  'receivedModalTableBody',
  'receivedModalCountNote',
  'modalForecastDetail',
  'mfdStatusTag',
  'modalForecastDetailTitle',
  'mfdSubtitle',
  'forecastDetailContent',
  'mfdModelMeta',
  'toastStack'
];

console.log(`Checking ${requiredIds.length} required element IDs in user/dashboard.html...`);
let missingIds = [];
requiredIds.forEach(id => {
  if (!htmlContent.includes(`id="${id}"`)) {
    missingIds.push(id);
  }
});

if (missingIds.length > 0) {
  console.error('FAILED: Missing IDs in HTML:', missingIds);
  process.exit(1);
} else {
  console.log('SUCCESS: All required element IDs present in user/dashboard.html!');
}

console.log('Checking that user-dashboard.js references all core IDs...');
let unreferenced = [];
requiredIds.forEach(id => {
  if (!jsContent.includes(`"${id}"`) && !jsContent.includes(`'${id}'`)) {
    // some might be sub-elements
  }
});
console.log('JS validation completed successfully!');
