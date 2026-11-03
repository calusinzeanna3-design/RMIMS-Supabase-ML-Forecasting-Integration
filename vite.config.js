import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';
import { transformSync } from 'esbuild';

// Deployed copies: database setup files (.sql) and notes (.md) are never published, and the app's own
// JavaScript is minified (comments and formatting removed, no source maps).
const NEVER_PUBLISH = /\.(sql|md)$/i;

function copyDirSync(src, dest, opts = {}) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, opts);
    } else if (NEVER_PUBLISH.test(entry.name)) {
      continue;
    } else if (opts.minifyJs && /\.js$/i.test(entry.name)) {
      const code = fs.readFileSync(srcPath, 'utf8');
      try {
        // ES modules stay modules; classic <script> files keep their script semantics (no module rewriting)
        const isModule = /^\s*(import|export)\b/m.test(code);
        const out = transformSync(code, { loader: 'js', minifyWhitespace: true, minifySyntax: true, legalComments: 'none', target: 'es2022', ...(isModule ? { format: 'esm' } : {}), sourcemap: false });
        fs.writeFileSync(destPath, out.code);
      } catch (e) {
        console.warn('[Vite Plugin] could not minify', entry.name, '-', e.message);
        fs.copyFileSync(srcPath, destPath);
      }
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

    const cssSrc = resolve(__dirname, 'RMIMS/css');
    const cssDest1 = resolve(__dirname, 'dist/RMIMS/css');
    const cssDest2 = resolve(__dirname, 'dist/css');
    copyDirSync(cssSrc, cssDest1);
    copyDirSync(cssSrc, cssDest2);

    const jsSrc = resolve(__dirname, 'RMIMS/js');
    const jsDest1 = resolve(__dirname, 'dist/RMIMS/js');
    const jsDest2 = resolve(__dirname, 'dist/js');
    copyDirSync(jsSrc, jsDest1, { minifyJs: true });
    copyDirSync(jsSrc, jsDest2, { minifyJs: true });

    const sbSrc = resolve(__dirname, 'RMIMS/supabase');
    const sbDest1 = resolve(__dirname, 'dist/RMIMS/supabase');
    const sbDest2 = resolve(__dirname, 'dist/supabase');
    copyDirSync(sbSrc, sbDest1, { minifyJs: true });
    copyDirSync(sbSrc, sbDest2, { minifyJs: true });

    const vendorSrc = resolve(__dirname, 'RMIMS/vendor');
    copyDirSync(vendorSrc, resolve(__dirname, 'dist/RMIMS/vendor'));
    copyDirSync(vendorSrc, resolve(__dirname, 'dist/vendor'));

    const dataSrc = resolve(__dirname, 'DATASETS');
    const dataDest1 = resolve(__dirname, 'dist/DATASETS');
    const dataDest2 = resolve(__dirname, 'dist/RMIMS/DATASETS');
    copyDirSync(dataSrc, dataDest1);
    copyDirSync(dataSrc, dataDest2);

    // Mirror all dist/RMIMS generated pages (HTML, admin, user) to dist root
    const rmimsDist = resolve(__dirname, 'dist/RMIMS');
    const rootDist = resolve(__dirname, 'dist');
    copyDirSync(rmimsDist, rootDist);

    console.log('[Vite Plugin] Successfully mirrored all RMIMS pages, assets, CSS, Supabase, and JS directly to dist root.');
  }
});

export default defineConfig({
  base: '/',
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
    target: 'es2022',
    sourcemap: false,
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
        managerAnalytics: resolve(__dirname, 'RMIMS/manager/analytics.html'),
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

