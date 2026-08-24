import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const copyRmimsAssetsPlugin = () => ({
  name: 'copy-rmims-assets',
  closeBundle() {
    const src = resolve(__dirname, 'RMIMS/assets');
    const dest1 = resolve(__dirname, 'dist/RMIMS/assets');
    const dest2 = resolve(__dirname, 'dist/assets');
    copyDirSync(src, dest1);
    copyDirSync(src, dest2);

    const jsSrc = resolve(__dirname, 'RMIMS/js');
    const jsDest = resolve(__dirname, 'dist/RMIMS/js');
    copyDirSync(jsSrc, jsDest);

    const indexSrc = resolve(__dirname, 'dist/RMIMS/index.html');
    const indexDest = resolve(__dirname, 'dist/index.html');
    if (fs.existsSync(indexSrc)) {
      fs.copyFileSync(indexSrc, indexDest);
    }

    console.log('[Vite Plugin] Successfully copied RMIMS assets, js, and root index.html to dist output.');
  }
});

export default defineConfig({
  base: './',
  root: '.',
  plugins: [copyRmimsAssetsPlugin()],
  server: {
    port: 5500,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/forecast': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      },
      '/historical-usage': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      },
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      }
    }
  },
  preview: {
    port: 5500,
    host: '127.0.0.1'
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'RMIMS/index.html'),
        login: resolve(__dirname, 'RMIMS/login.html'),
        portal: resolve(__dirname, 'RMIMS/portal.html'),
        kiosk: resolve(__dirname, 'RMIMS/kiosk-checkin.html'),
        userSignin: resolve(__dirname, 'RMIMS/user-signin.html'),
        // Admin pages
        adminAnalytics: resolve(__dirname, 'RMIMS/admin/analytics.html'),
        adminDashboard: resolve(__dirname, 'RMIMS/admin/dashboard.html'),
        adminForecasting: resolve(__dirname, 'RMIMS/admin/forecasting.html'),
        adminInventory: resolve(__dirname, 'RMIMS/admin/inventory.html'),
        adminMaterialActivity: resolve(__dirname, 'RMIMS/admin/material-activity.html'),
        adminReports: resolve(__dirname, 'RMIMS/admin/reports.html'),
        adminSettings: resolve(__dirname, 'RMIMS/admin/settings.html'),
        adminUserManagement: resolve(__dirname, 'RMIMS/admin/user-management.html'),
        // User pages
        userAnalytics: resolve(__dirname, 'RMIMS/user/analytics.html'),
        userDashboard: resolve(__dirname, 'RMIMS/user/dashboard.html'),
        userInventory: resolve(__dirname, 'RMIMS/user/inventory.html'),
        userMaterialActivity: resolve(__dirname, 'RMIMS/user/material-activity.html'),
        userReports: resolve(__dirname, 'RMIMS/user/reports.html'),
        userSettings: resolve(__dirname, 'RMIMS/user/settings.html')
      }
    }
  }
});

