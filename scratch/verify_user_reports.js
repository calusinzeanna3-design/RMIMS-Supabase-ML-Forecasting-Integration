// scratch/verify_user_reports.js
import fs from 'fs';
import path from 'path';

const htmlPath = path.resolve('RMIMS/user/reports.html');
const jsPath = path.resolve('RMIMS/js/user-reports.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

console.log("1. Verifying 5 User Tabs in user/reports.html...");
const expectedTabs = [
    'tabPanelOverview',
    'tabPanelReceiving',
    'tabPanelDisbursement',
    'tabPanelConsumption',
    'tabPanelForecasting'
];
expectedTabs.forEach(tabId => {
    if (!htmlContent.includes(`id="${tabId}"`)) {
        console.error(`FAILED: Missing tab panel #${tabId} in user/reports.html`);
        process.exit(1);
    }
});
console.log("PASS: All 5 User Tabs are properly structured!");

console.log("2. Checking that NO Admin-only sections exist in User Reports...");
const forbiddenAdminSections = [
    'Manager Decision Breakdown',
    'tabPanelManager',
    'tabPanelInventory',
    'mgrDecisionTableBody'
];
forbiddenAdminSections.forEach(section => {
    if (htmlContent.includes(section)) {
        console.error(`FAILED: Admin-only section found in user/reports.html: ${section}`);
        process.exit(1);
    }
});
console.log("PASS: Zero Admin-only management sections in User Reports!");

console.log("3. Verifying KPI Cards and Tables in HTML...");
const expectedElements = [
    'reportPeriodPreset',
    'btnSaveAs',
    'btnPrint',
    'saveModalOverlay',
    'continuousPrintDoc',
    'kpiReceivedCount',
    'kpiDisbursedCount',
    'kpiConsumptionCount',
    'kpiAttentionCount',
    'overviewTableBody',
    'receivingTableBody',
    'disbursementTableBody',
    'consumptionTableBody',
    'forecastTableBody'
];
expectedElements.forEach(id => {
    if (!htmlContent.includes(`id="${id}"`)) {
        console.error(`FAILED: Missing element #${id} in user/reports.html`);
        process.exit(1);
    }
});
console.log("PASS: All required KPI cards, table bodies, and modals exist!");

console.log("4. Verifying Empty States in user-reports.js...");
const emptyStates = [
    "No activity recorded for the selected period.",
    "No receiving records found for the selected period.",
    "No disbursement records found for the selected period.",
    "No consumption records found for the selected period.",
    "No AI forecast support is currently available."
];
emptyStates.forEach(msg => {
    if (!jsContent.includes(msg)) {
        console.error(`FAILED: Missing required empty state in user-reports.js: "${msg}"`);
        process.exit(1);
    }
});
console.log("PASS: All required operational empty states verified!");

console.log("5. Verifying Save As & Export Functions in user-reports.js...");
const exportFunctions = [
    'generateUserExcelWorkbook',
    'generateUserPdfReport',
    'generateUserCsvPackage',
    'generateUserJsonExport',
    'handlePrintReport'
];
exportFunctions.forEach(fn => {
    if (!jsContent.includes(fn)) {
        console.error(`FAILED: Missing export function in user-reports.js: ${fn}`);
        process.exit(1);
    }
});
console.log("PASS: All Save As, Excel, PDF, CSV, JSON, and Print functions verified!");

console.log("ALL USER REPORTS VERIFICATIONS PASSED!");
