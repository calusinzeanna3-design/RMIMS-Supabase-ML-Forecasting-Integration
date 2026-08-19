import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
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
