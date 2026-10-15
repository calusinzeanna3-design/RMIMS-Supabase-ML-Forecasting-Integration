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
    const jsDest1 = resolve(__dirname, 'dist/RMIMS/js');
    const jsDest2 = resolve(__dirname, 'dist/js');
    copyDirSync(jsSrc, jsDest1);
    copyDirSync(jsSrc, jsDest2);

    // Mirror all dist/RMIMS generated pages (HTML, admin, user) to dist root
    const rmimsDist = resolve(__dirname, 'dist/RMIMS');
    const rootDist = resolve(__dirname, 'dist');
    copyDirSync(rmimsDist, rootDist);

    console.log('[Vite Plugin] Successfully mirrored all RMIMS pages, assets, and JS directly to dist root.');
  }
});

export default defineConfig({
  base: './',
  root: '.',
  plugins: [copyRmimsAssetsPlugin()],
  server: {
    port: 5500,
    strictPort: true,
    host: '127.0.0.1'
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
        userSignin: resolve(__dirname, 'RMIMS/user-signin.html'),
        // Dedicated Main Admin Portal (System Design & Multi-Module Architecture)
        adminOverview: resolve(__dirname, 'RMIMS/admin/overview.html'),
        adminActivityLogs: resolve(__dirname, 'RMIMS/admin/activity-logs.html'),
        adminUserManagement: resolve(__dirname, 'RMIMS/admin/user-management.html'),
        adminBranchStores: resolve(__dirname, 'RMIMS/admin/branch-stores.html'),
        adminSystemAlerts: resolve(__dirname, 'RMIMS/admin/system-alerts.html'),
        adminSettings: resolve(__dirname, 'RMIMS/admin/settings.html'),
        // Dedicated Manager Workspace (Active Manager Pages)
        managerDashboard: resolve(__dirname, 'RMIMS/manager/dashboard.html'),
        managerDisburse: resolve(__dirname, 'RMIMS/manager/disburse.html'),
        managerForecasting: resolve(__dirname, 'RMIMS/manager/forecasting.html'),
        managerInventory: resolve(__dirname, 'RMIMS/manager/inventory.html'),
        managerReceive: resolve(__dirname, 'RMIMS/manager/receive.html'),
        managerReports: resolve(__dirname, 'RMIMS/manager/reports.html'),
        managerSettings: resolve(__dirname, 'RMIMS/manager/settings.html'),
        managerStaffActivity: resolve(__dirname, 'RMIMS/manager/staff-activity.html'),
        managerUsage: resolve(__dirname, 'RMIMS/manager/usage.html'),
        // Active Staff / User Pages
        userDashboard: resolve(__dirname, 'RMIMS/user/dashboard.html'),
        userInventory: resolve(__dirname, 'RMIMS/user/inventory.html'),
        userReceive: resolve(__dirname, 'RMIMS/user/receive.html'),
        userDisburse: resolve(__dirname, 'RMIMS/user/disburse.html'),
        userMyActivity: resolve(__dirname, 'RMIMS/user/my-activity.html'),
        userReports: resolve(__dirname, 'RMIMS/user/reports.html'),
        userSettings: resolve(__dirname, 'RMIMS/user/settings.html')
      }
    }
  }
});

