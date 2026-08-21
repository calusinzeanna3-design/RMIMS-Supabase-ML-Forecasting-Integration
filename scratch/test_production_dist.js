import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, '..', 'dist');

const PORT = 5500;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/RMIMS/index.html';
  
  const filePath = path.join(distDir, reqPath);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Production preview server listening at http://127.0.0.1:${PORT}`);
  
  const testUrls = [
    `http://127.0.0.1:${PORT}/RMIMS/index.html`,
    `http://127.0.0.1:${PORT}/RMIMS/login.html`,
    `http://127.0.0.1:${PORT}/RMIMS/portal.html`,
    `http://127.0.0.1:${PORT}/RMIMS/admin/dashboard.html`,
    `http://127.0.0.1:${PORT}/RMIMS/user/dashboard.html`,
    `http://127.0.0.1:${PORT}/RMIMS/admin/inventory.html`,
    `http://127.0.0.1:${PORT}/RMIMS/admin/forecasting.html`,
    `http://127.0.0.1:${PORT}/RMIMS/admin/reports.html`,
    `http://127.0.0.1:${PORT}/RMIMS/admin/settings.html`
  ];

  let allOk = true;
  for (const url of testUrls) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        console.log(`[PASS] ${url} -> HTTP ${resp.status}`);
      } else {
        console.error(`[FAIL] ${url} -> HTTP ${resp.status}`);
        allOk = false;
      }
    } catch (e) {
      console.error(`[FAIL] ${url} -> Error: ${e.message}`);
      allOk = false;
    }
  }

  server.close(() => {
    console.log('\nProduction preview server stopped.');
    if (allOk) {
      console.log('ALL PRODUCTION PREVIEW PAGES VERIFIED SUCCESSFULLY!');
      process.exit(0);
    } else {
      process.exit(1);
    }
  });
});
