// scratch/verify_user_analytics.js
import fs from 'fs';
import path from 'path';

const htmlPath = path.resolve('RMIMS/user/analytics.html');
const jsPath = path.resolve('RMIMS/js/user-analytics.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

console.log("1. Checking forbidden elements (theme toggles, admin controls)...");
const forbidden = [
  "themeToggleBtn",
  "icon-sun",
  "icon-moon",
  "rmims-theme",
  "prefers-color-scheme"
];

forbidden.forEach(str => {
  if (htmlContent.includes(str)) {
    console.error(`FAILED: Found forbidden element/text '${str}' in user/analytics.html`);
    process.exit(1);
  }
});
console.log("PASS: Clean light theme without dark mode toggles or overrides!");

console.log("2. Checking layout, cards, charts, and modals in user/analytics.html...");
const requiredElements = [
  // KPIs
  'kpiTotalMaterials',
  'kpiTotalConsumedWrap',
  'kpiTotalConsumedList',
  'kpiMaterialsWithUsage',
  'kpiNeedsAttention',

  // Date controls
  'datePresetSelect',
  'customDatePickerWrap',
  'dateFromInput',
  'dateToInput',
  'clearDateBtn',
  'dateRangeStatusTag',

  // Row 1
  'chart1MaterialSelect',
  'chart1PeriodTabs',
  'overviewTrendChartCanvas',
  'stockProgressList',
  'viewAllProgressBtn',

  // Row 2
  'statusProgressChartCanvas',
  'distributionDonutCanvas',
  'donutTotalCount',
  'distributionListContainer',
  'viewAllDistBtn',

  // Row 3
  'tableSearchInput',
  'tableStatusFilter',
  'tableUnitFilter',
  'tableSortSelect',
  'overallStatusTable',
  'overallStatusTableBody',
  'tablePageInfo',
  'tableRowsPerPageSelect',
  'tablePaginationControls',

  // Modals
  'allMaterialsModalOverlay',
  'allMaterialsModalTableBody',
  'materialDetailModalOverlay',
  'matDetailTitle',
  'matDetailSubtitle',
  'matDetailProgressVal',
  'matDetailCurrentStockVal',
  'matDetailMinStockVal',
  'matDetailStatusVal',
  'matDetailPeriodUsageVal',
  'matDetailProductsTableBody',
  'allDistributionModalOverlay',
  'allDistributionModalTableBody'
];

requiredElements.forEach(id => {
  if (!htmlContent.includes(`id="${id}"`)) {
    console.error(`FAILED: Missing element ID '${id}' in user/analytics.html`);
    process.exit(1);
  }
});
console.log("PASS: All required analytics IDs, canvases, tables, and modals present in user/analytics.html!");

console.log("3. Checking JS calculations, chart renderers, and event handlers...");
const requiredJsFunctions = [
  'loadAuthoritativeData',
  'renderTopKPIs',
  'renderOverviewTrendChart',
  'renderStockProgressCard',
  'renderStatusProgressChart',
  'renderDistributionDonutCard',
  'renderOverallStatusTable',
  'openMaterialDetailModal',
  'openAllMaterialsModal',
  'openAllDistributionModal'
];

requiredJsFunctions.forEach(fn => {
  if (!jsContent.includes(fn)) {
    console.error(`FAILED: Missing function or identifier '${fn}' in user-analytics.js`);
    process.exit(1);
  }
});
console.log("PASS: All JS calculations, chart controllers, and modal handlers present!");

console.log("ALL USER ANALYTICS VERIFICATIONS COMPLETED SUCCESSFULLY!");
