import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const cssDir = path.join(root, 'RMIMS', 'css');
const adminDir = path.join(root, 'RMIMS', 'admin');
const userDir = path.join(root, 'RMIMS', 'user');
const rootPagesDir = path.join(root, 'RMIMS');

const viewports = [
  { name: 'Mobile SE', width: 320 },
  { name: 'Mobile Standard', width: 360 },
  { name: 'iPhone 6/7/8', width: 375 },
  { name: 'iPhone 12/13/14', width: 390 },
  { name: 'Pixel 7', width: 393 },
  { name: 'Galaxy S20', width: 412 },
  { name: 'iPhone 14 Pro Max', width: 430 },
  { name: 'iPad Mini', width: 768 },
  { name: 'iPad Pro', width: 1024 },
  { name: 'Laptop Small', width: 1366 },
  { name: 'Laptop Standard', width: 1440 },
  { name: 'Full HD Desktop', width: 1920 }
];

console.log('====================================================');
console.log('PHASE 1: MOBILE AUDIT & LAYOUT DIAGNOSTICS');
console.log('====================================================\n');

// 1. Audit CSS files for fixed widths > 320px outside media queries or overflow-x issues
const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
console.log(`Inspecting ${cssFiles.length} CSS stylesheets in RMIMS/css/ ...`);

cssFiles.forEach(file => {
  const content = fs.readFileSync(path.join(cssDir, file), 'utf8');
  // Check for fixed min-width > 320px on body or main wrappers
  const minWidthMatches = content.match(/min-width:\s*([4-9]\d{2}|1\d{3})px/g);
  if (minWidthMatches) {
    console.log(`[NOTICE] ${file} has min-width rules > 320px: ${minWidthMatches.join(', ')}`);
  }
});

// 2. Audit HTML pages for missing viewport meta tag or unhandled table wrappers
const allPages = [
  ...fs.readdirSync(adminDir).filter(f => f.endsWith('.html')).map(f => path.join('admin', f)),
  ...fs.readdirSync(userDir).filter(f => f.endsWith('.html')).map(f => path.join('user', f)),
  ...fs.readdirSync(rootPagesDir).filter(f => f.endsWith('.html')).map(f => f)
];

console.log(`\nInspecting ${allPages.length} HTML pages for viewport meta tag & table wrapping ...`);

allPages.forEach(relPath => {
  const fullPath = path.join(root, 'RMIMS', relPath);
  const html = fs.readFileSync(fullPath, 'utf8');

  const hasViewport = html.includes('name="viewport"') && html.includes('width=device-width');
  if (!hasViewport) {
    console.warn(`[WARNING] ${relPath} missing standard mobile viewport meta tag!`);
  }

  // Check tables for scroll wrappers
  const tableCount = (html.match(/<table/g) || []).length;
  const tableContainerCount = (html.match(/class="[^"]*(table-responsive|table-wrapper|table-container|table-card)[^"]*"/g) || []).length;

  if (tableCount > 0 && tableContainerCount === 0) {
    console.warn(`[NOTICE] ${relPath} has ${tableCount} tables without explicit responsive container class.`);
  }
});

console.log('\nInitial static audit completed.');
