import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

console.log('====================================================');
console.log('STEP 1: DIAGNOSING MOBILE ASSET & CSS ISSUES');
console.log('====================================================\n');

// 1. Inspect logo references across HTML pages
const rmimsDir = path.join(root, 'RMIMS');

function scanDirForLogos(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      scanDirForLogos(full);
    } else if (f.name.endsWith('.html') || f.name.endsWith('.js') || f.name.endsWith('.css')) {
      const content = fs.readFileSync(full, 'utf8');
      const matches = content.match(/src=["']([^"']*(?:logo|brand|icon|img|assets)[^"']*)["']/gi) || [];
      if (matches.length > 0) {
        console.log(`- ${path.relative(root, full)} matches:`, matches);
      }
    }
  }
}

console.log('--- SCANNING FOR LOGO / IMAGE SRC REFERENCES ---');
scanDirForLogos(rmimsDir);

// 2. Check existing logo files in directory structure
console.log('\n--- SEARCHING PHYSICAL IMAGE / LOGO FILES IN REPO ---');
function findImageFiles(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const full = path.join(dir, f.name);
    if (f.isDirectory() && !f.name.startsWith('.') && f.name !== 'node_modules' && f.name !== 'dist') {
      findImageFiles(full);
    } else if (/\.(png|jpg|jpeg|svg|gif|ico|webp)$/i.test(f.name)) {
      console.log(`  [FOUND IMAGE]: ${path.relative(root, full)} (${fs.statSync(full).size} bytes)`);
    }
  }
}
findImageFiles(root);

// 3. Inspect vite.config.js
console.log('\n--- VITE CONFIG BASE & INPUT PATHS ---');
const viteConfigPath = path.join(root, 'vite.config.js');
if (fs.existsSync(viteConfigPath)) {
  console.log(fs.readFileSync(viteConfigPath, 'utf8'));
} else {
  console.log('vite.config.js not found!');
}
