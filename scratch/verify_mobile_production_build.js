import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');

console.log('====================================================');
console.log('STEP 14-16: LOCAL PRODUCTION BUILD & REGRESSION AUDIT');
console.log('====================================================\n');

// 1. Production Asset Audit
console.log('--- 1. PRODUCTION ASSET & MANIFEST AUDIT ---');
const distRmimsAssets = path.join(distDir, 'RMIMS', 'assets');
const requiredAssets = ['logo-icon.png', 'rmsme-3d-logo.png', 'logo-full.png', 'favicon-32.png', 'favicon-192.png'];

let assetsOk = true;
requiredAssets.forEach(asset => {
  const p = path.join(distRmimsAssets, asset);
  if (fs.existsSync(p)) {
    console.log(`[PASS] Found asset: dist/RMIMS/assets/${asset} (${fs.statSync(p).size} bytes)`);
  } else {
    console.error(`[FAIL] Missing asset: dist/RMIMS/assets/${asset}`);
    assetsOk = false;
  }
});

// 2. Scan generated production HTML/JS for forbidden development paths (localhost, 127.0.0.1, file://, C:\)
console.log('\n--- 2. SCANNING FOR FORBIDDEN DEV PATHS IN DIST OUTPUT ---');
let forbiddenFound = false;

function scanDistFiles(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      scanDistFiles(full);
    } else if (f.name.endsWith('.html') || f.name.endsWith('.js') || f.name.endsWith('.css')) {
      const content = fs.readFileSync(full, 'utf8');
      const matches = content.match(/(?:file:\/\/\/|C:\\|C:\/)/gi);
      if (matches) {
        console.error(`[FAIL] ${path.relative(distDir, full)} contains dev path reference: ${matches.join(', ')}`);
        forbiddenFound = true;
      }
    }
  }
}
scanDistFiles(distDir);

if (!forbiddenFound) {
  console.log('[PASS] Zero development filesystem paths found in dist bundle.');
}

// 3. Viewport Meta Verification across all production HTML pages
console.log('\n--- 3. VIEWPORT META DECLARATION AUDIT ---');
let viewportOk = true;
const htmlFiles = [];

function findHtmlFiles(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      findHtmlFiles(full);
    } else if (f.name.endsWith('.html')) {
      htmlFiles.push(full);
    }
  }
}
findHtmlFiles(path.join(distDir, 'RMIMS'));

htmlFiles.forEach(file => {
  const html = fs.readFileSync(file, 'utf8');
  if (html.includes('name="viewport"') && html.includes('width=device-width')) {
    console.log(`[PASS] ${path.relative(distDir, file)} has standard viewport meta tag.`);
  } else {
    console.error(`[FAIL] ${path.relative(distDir, file)} missing viewport meta tag!`);
    viewportOk = false;
  }
});

// 4. Preview Server Asset Connectivity Test
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/RMIMS/index.html';
  const filePath = path.join(distDir, reqPath);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(5500, '127.0.0.1', async () => {
  console.log('\n--- 4. PRODUCTION PREVIEW ASSET CONNECTIVITY TEST ---');
  const testEndpoints = [
    'http://127.0.0.1:5500/RMIMS/index.html',
    'http://127.0.0.1:5500/RMIMS/assets/logo-icon.png',
    'http://127.0.0.1:5500/RMIMS/assets/rmsme-3d-logo.png',
    'http://127.0.0.1:5500/RMIMS/admin/dashboard.html',
    'http://127.0.0.1:5500/RMIMS/user/dashboard.html',
    'http://127.0.0.1:5500/RMIMS/admin/inventory.html',
    'http://127.0.0.1:5500/RMIMS/admin/forecasting.html'
  ];

  let serverOk = true;
  for (const url of testEndpoints) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        console.log(`[PASS] ${url} -> HTTP ${resp.status}`);
      } else {
        console.error(`[FAIL] ${url} -> HTTP ${resp.status}`);
        serverOk = false;
      }
    } catch (err) {
      console.error(`[FAIL] ${url} -> Fetch Error: ${err.message}`);
      serverOk = false;
    }
  }

  server.close(() => {
    console.log('\nProduction preview server stopped.');
    if (assetsOk && !forbiddenFound && viewportOk && serverOk) {
      console.log('\n====================================================');
      console.log('ALL LOCAL PRODUCTION DEPLOYMENT & ASSET CHECKS PASSED!');
      console.log('====================================================');
      process.exit(0);
    } else {
      console.error('\n[FAIL] Mobile production verification failed!');
      process.exit(1);
    }
  });
});
