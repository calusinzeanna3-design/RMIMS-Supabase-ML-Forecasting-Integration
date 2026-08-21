// scratch/test_print_and_save_user_reports.js
import fs from 'fs';
import path from 'path';

const htmlPath = path.resolve('RMIMS/user/reports.html');
const jsPath = path.resolve('RMIMS/js/user-reports.js');
const cssPath = path.resolve('RMIMS/css/reports.css');

const html = fs.readFileSync(htmlPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

console.log("=== 1. Checking HTML Elements and Click Handlers ===");
if (!html.includes('id="btnPrint"')) throw new Error("Missing #btnPrint in HTML");
if (!html.includes('id="btnSaveAs"')) throw new Error("Missing #btnSaveAs in HTML");
if (!html.includes('id="continuousPrintDoc"')) throw new Error("Missing #continuousPrintDoc in HTML");
if (!html.includes('id="saveModalOverlay"')) throw new Error("Missing #saveModalOverlay in HTML");
if (!html.includes('window.__rmimsPrintReport')) throw new Error("Missing window.__rmimsPrintReport inline handler on #btnPrint");
if (!html.includes('window.__rmimsOpenSaveModal')) throw new Error("Missing window.__rmimsOpenSaveModal inline handler on #btnSaveAs");
console.log("PASS: HTML Buttons and Containers are properly configured with inline + JS listeners!");

console.log("=== 2. Checking JS Variable Declarations & Handlers ===");
if (!js.includes('let currentUser = null;')) throw new Error("Missing let currentUser = null declaration");
if (!js.includes('function updatePrintDocHtml()')) throw new Error("Missing updatePrintDocHtml function");
if (!js.includes('function handlePrintReport()')) throw new Error("Missing handlePrintReport function");
if (!js.includes('function openSaveModal()')) throw new Error("Missing openSaveModal function");
if (!js.includes('function closeSaveModal()')) throw new Error("Missing closeSaveModal function");
if (!js.includes('function handleSaveConfirm()')) throw new Error("Missing handleSaveConfirm function");
if (!js.includes('window.__rmimsPrintReport = handlePrintReport;')) throw new Error("Missing window.__rmimsPrintReport assignment");
if (!js.includes('window.__rmimsOpenSaveModal = openSaveModal;')) throw new Error("Missing window.__rmimsOpenSaveModal assignment");
console.log("PASS: All JS print, save modal, and window bindings are defined!");

console.log("=== 3. Checking Print CSS Media Query ===");
if (!css.includes('@media print')) throw new Error("Missing @media print in reports.css");
if (!css.includes('.rpt-continuous-print-doc')) throw new Error("Missing .rpt-continuous-print-doc in reports.css");
if (!css.includes('.print-header-block')) throw new Error("Missing .print-header-block in reports.css");
if (!css.includes('.print-rmims-title')) throw new Error("Missing .print-rmims-title in reports.css");
console.log("PASS: reports.css contains full print stylesheet rules!");

console.log("ALL PRINT AND SAVE AS TESTS PASSED SUCCESSFULLY!");
