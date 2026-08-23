import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, 'dist');
const rmimsDir = path.join(projectRoot, 'RMIMS');

function getAllFiles(dirPath, arrayOfFiles = []) {
    if (!fs.existsSync(dirPath)) return arrayOfFiles;
    const files = fs.readdirSync(dirPath);
    files.forEach((file) => {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            arrayOfFiles.push(fullPath);
        }
    });
    return arrayOfFiles;
}

const distFiles = getAllFiles(distDir);
console.log("====================================================");
console.log("DEEP AUDIT: INSPECTING DIST BUNDLE INTEGRITY");
console.log("====================================================");
console.log(`Total Files in dist/: ${distFiles.length}`);

let errorCount = 0;
let warningCount = 0;

// 1. Verify HTML pages in dist
const distHtmlFiles = distFiles.filter(f => f.endsWith('.html'));
console.log(`\n1. Inspecting ${distHtmlFiles.length} HTML pages in dist...`);

distHtmlFiles.forEach(htmlPath => {
    const relPath = path.relative(distDir, htmlPath);
    const content = fs.readFileSync(htmlPath, 'utf8');

    // Extract script tags
    const scriptSrcMatches = [...content.matchAll(/src=["']([^"']+)["']/g)].map(m => m[1]);
    scriptSrcMatches.forEach(src => {
        if (src.startsWith('http://') || src.startsWith('https://')) return;
        const targetPath = path.resolve(path.dirname(htmlPath), src);
        if (!fs.existsSync(targetPath)) {
            console.error(`[ERROR] In ${relPath}: Script src="${src}" resolved to ${targetPath} which DOES NOT EXIST!`);
            errorCount++;
        }
    });

    // Extract link tags
    const linkHrefMatches = [...content.matchAll(/href=["']([^"']+)["']/g)].map(m => m[1]);
    linkHrefMatches.forEach(href => {
        if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#') || href.startsWith('data:')) return;
        const cleanHref = href.split('?')[0].split('#')[0];
        const targetPath = path.resolve(path.dirname(htmlPath), cleanHref);
        if (!fs.existsSync(targetPath)) {
            console.error(`[ERROR] In ${relPath}: Link href="${href}" resolved to ${targetPath} which DOES NOT EXIST!`);
            errorCount++;
        }
    });

    // Extract img src tags
    const imgSrcMatches = [...content.matchAll(/<img[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
    imgSrcMatches.forEach(src => {
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return;
        const targetPath = path.resolve(path.dirname(htmlPath), src);
        if (!fs.existsSync(targetPath)) {
            console.error(`[ERROR] In ${relPath}: Image src="${src}" resolved to ${targetPath} which DOES NOT EXIST!`);
            errorCount++;
        }
    });
});

// 2. Verify all JS bundle assets
const jsFiles = distFiles.filter(f => f.endsWith('.js'));
console.log(`\n2. Inspecting ${jsFiles.length} JavaScript bundles in dist/assets...`);
jsFiles.forEach(jsPath => {
    const content = fs.readFileSync(jsPath, 'utf8');
    if (content.includes('auth.auth')) {
        console.error(`[ERROR] Found auth.auth reference in ${path.relative(distDir, jsPath)}!`);
        errorCount++;
    }
});

// 3. Verify images and logos in dist/assets & dist/RMIMS/assets
console.log(`\n3. Inspecting required image assets...`);
const requiredAssets = [
    'assets/favicon-64.png',
    'assets/logo-icon.png',
    'assets/logo-full.png',
    'assets/rmsme-3d-logo.png'
];

requiredAssets.forEach(ast => {
    const p1 = path.join(distDir, ast);
    const p2 = path.join(distDir, 'RMIMS', ast);
    if (!fs.existsSync(p1) && !fs.existsSync(p2)) {
        console.error(`[ERROR] Asset ${ast} is missing from dist!`);
        errorCount++;
    } else {
        console.log(`[PASS] Asset present: ${ast}`);
    }
});

console.log("====================================================");
console.log(`AUDIT SUMMARY: ${errorCount} Errors, ${warningCount} Warnings`);
console.log("====================================================");
