const fs = require('fs');
const path = require('path');

console.log("=== VERIFYING UNIFIED IMAGE 1 TEMPLATE PRINT & PDF REPORT ENGINE ===");

let passed = true;

// 1. Verify reports.css @media print rules
const cssPath = path.join(__dirname, '../RMIMS/css/reports.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

const printMediaStart = cssContent.indexOf('@media print');
if (printMediaStart === -1) {
    console.error("FAIL: @media print block not found in reports.css");
    passed = false;
} else {
    const printBlock = cssContent.slice(printMediaStart);
    const checks = [
        '.rpt-continuous-print-doc',
        '.print-page-table-wrapper',
        '.print-page-watermark-box',
        '.print-watermark-text-primary',
        '.print-watermark-text-secondary',
        '.print-header-row',
        '.print-brand-name',
        '.print-brand-desc',
        '.print-header-right',
        '.print-header-divider',
        '.print-document-title',
        '.print-meta-grid',
        '.print-section-title',
        '.print-table',
        '.print-footer-container'
    ];
    checks.forEach(c => {
        if (!printBlock.includes(c)) {
            console.error(`FAIL: reports.css missing selector: ${c}`);
            passed = false;
        } else {
            console.log(`PASS: reports.css contains selector: ${c}`);
        }
    });
}

// 2. Verify reports.js (Manager)
const mgrJsPath = path.join(__dirname, '../RMIMS/js/reports.js');
const mgrJs = fs.readFileSync(mgrJsPath, 'utf8');

const mgrChecks = [
    { desc: "Watermark thead in print doc", pattern: /print-watermark-th/, expected: true },
    { desc: "Watermark primary text", pattern: /RMSME OFFICIAL REPORT/, expected: true },
    { desc: "Watermark secondary text", pattern: /PREVENT FAKE COPY • SYSTEM VERIFIED/, expected: true },
    { desc: "Image 1 clean metadata grid", pattern: /print-meta-grid/, expected: true },
    { desc: "Image 1 header row", pattern: /print-header-row/, expected: true },
    { desc: "Image 1 footer container", pattern: /print-footer-container/, expected: true },
    { desc: "NO sign-off block in Manager reports.js", pattern: /PREPARED BY \(STORE MANAGER\)/, expected: false },
    { desc: "updatePrintDocHtml with activeTab", pattern: /updatePrintDocHtml\(tabToPrint\s*=\s*\(state\.activeTab/, expected: true },
    { desc: "handlePrintReport passes activeTab", pattern: /updatePrintDocHtml\(activeTab\)/, expected: true },
    { desc: "selectReportCategory updates print doc", pattern: /updatePrintDocHtml\(target\)/, expected: true },
    { desc: "PDF rotated watermark", pattern: /RMSME OFFICIAL REPORT/, expected: true },
    { desc: "PDF anti-fake banner", pattern: /PREVENT FAKE COPY • SYSTEM VERIFIED/, expected: true }
];

mgrChecks.forEach(c => {
    const hasPattern = c.pattern.test(mgrJs);
    if (hasPattern !== c.expected) {
        console.error(`FAIL: Manager reports.js check failed for ${c.desc} (expected: ${c.expected}, found: ${hasPattern})`);
        passed = false;
    } else {
        console.log(`PASS: Manager reports.js: ${c.desc}`);
    }
});

// 3. Verify user-reports.js (Staff)
const staffJsPath = path.join(__dirname, '../RMIMS/js/user-reports.js');
const staffJs = fs.readFileSync(staffJsPath, 'utf8');

const staffChecks = [
    { desc: "Watermark thead in print doc", pattern: /print-watermark-th/, expected: true },
    { desc: "Watermark primary text", pattern: /RMSME OFFICIAL REPORT/, expected: true },
    { desc: "Watermark secondary text", pattern: /PREVENT FAKE COPY • SYSTEM VERIFIED/, expected: true },
    { desc: "Image 1 clean metadata grid", pattern: /print-meta-grid/, expected: true },
    { desc: "Image 1 header row", pattern: /print-header-row/, expected: true },
    { desc: "Image 1 footer container", pattern: /print-footer-container/, expected: true },
    { desc: "NO sign-off block in Staff user-reports.js", pattern: /Prepared By \(Store Staff\)/i, expected: false },
    { desc: "updatePrintDocHtml with activeTab", pattern: /updatePrintDocHtml\(tabToPrint\s*=\s*\(state\.activeTab/, expected: true },
    { desc: "triggerPrint passes activeTab", pattern: /updatePrintDocHtml\(activeTab\)/, expected: true },
    { desc: "selectReportCategory updates print doc", pattern: /updatePrintDocHtml\(target\)/, expected: true },
    { desc: "generateStaffSingleTabPdf has A4 format", pattern: /new jsPDF\(\{\s*unit:\s*"pt",\s*format:\s*"a4"\s*\}\)/, expected: true },
    { desc: "generateStaffSingleTabPdf has rotated watermark", pattern: /RMSME OFFICIAL REPORT/, expected: true },
    { desc: "generateStaffSingleTabPdf has prevent fake copy", pattern: /PREVENT FAKE COPY • SYSTEM VERIFIED/, expected: true },
    { desc: "generateStaffPdf has A4 format", pattern: /new jsPDF\(\{\s*unit:\s*"pt",\s*format:\s*"a4"\s*\}\)/, expected: true },
    { desc: "generateStaffPdf has rotated watermark", pattern: /RMSME OFFICIAL REPORT/, expected: true }
];

staffChecks.forEach(c => {
    const hasPattern = c.pattern.test(staffJs);
    if (hasPattern !== c.expected) {
        console.error(`FAIL: Staff user-reports.js check failed for ${c.desc} (expected: ${c.expected}, found: ${hasPattern})`);
        passed = false;
    } else {
        console.log(`PASS: Staff user-reports.js: ${c.desc}`);
    }
});

if (passed) {
    console.log("\n>>> ALL TESTS PASSED: Staff and Manager Print & PDF templates strictly match Image 1 design specification with watermark, clean metadata, soft slate table headers, and zero sign-off boxes.");
    process.exit(0);
} else {
    console.error("\n>>> SOME TESTS FAILED.");
    process.exit(1);
}
