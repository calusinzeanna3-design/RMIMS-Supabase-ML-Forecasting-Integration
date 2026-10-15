/**
 * RMIMS NOTIFICATION POPUP & DETAIL INSPECTION MODAL SYSTEM
 * Fully role-aware (Admin, Manager, Staff) with exact visual match to reference design.
 * Features:
 * - Pops up ONLY when notification icon is tapped (never displays statically).
 * - Admin tabs: All notification, Branch, User, System.
 * - Manager tabs: All notification, Employees, System.
 * - Staff tabs: All notification, System.
 * - User logins include masked/blurred device location (asterisks & blur).
 * - Full system operation coverage: add, import, export, upload, receive save, disburse save,
 *   finished product created, BOM added, raw materials updated, AI forecast generated, alerts, deletions.
 * - Staff coverage: receive saved/updated, disburse saved/updated, message incoming receive/disburse, AI reminders.
 * - Employees tab in Manager: staff progress, please check alerts, receive/disburse updates.
 * - Admin system: backups, restore, password changes, security alerts.
 * - Tapping any notification marks it as read and opens inspection detail modal.
 * - "Mark all as read" footer button.
 * - Search bar and All/Unread filters.
 * - Live synchronized across browser tabs.
 */

(function () {
  'use strict';

  // Ensure CSS is loaded
  function ensureNotificationStyles() {
    if (!document.getElementById('rmimsNotifStyles')) {
      const link = document.createElement('link');
      link.id = 'rmimsNotifStyles';
      link.rel = 'stylesheet';
      const pathPrefix = window.location.pathname.includes('/admin/') ||
                         window.location.pathname.includes('/manager/') ||
                         window.location.pathname.includes('/user/') ? '../' : './';
      link.href = `${pathPrefix}css/rmims-notifications.css`;
      document.head.appendChild(link);
    }
  }

  // Detect current portal role
  function getPortalRole() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/admin/')) return 'admin';
    if (path.includes('/manager/')) return 'manager';
    if (path.includes('/user/')) return 'staff';
    return 'manager';
  }

  const STORAGE_STORE_KEY = 'rmims_notifications_master_v6';
  const STORAGE_READ_KEY = 'rmims_notifications_read_v6';

  // Realistic seed data strictly matching user specifications
  function getSeedNotifications() {
    const now = new Date();
    const t = (offsetMins) => new Date(now.getTime() - offsetMins * 60 * 1000).toISOString();

    return [
      // -------------------------------------------------------------
      // ADMIN NOTIFICATIONS
      // -------------------------------------------------------------
      // Branch Tab
      {
        id: 'notif-adm-br-1',
        role: 'admin',
        category: 'branch',
        type: 'branch_added',
        priority: 'success',
        title: 'New Branch Store Added',
        message: 'Tayabas Highway Outlet (#BR-TYB-04) has been registered and synced to the RMSME central inventory route.',
        actor: 'Admin Console',
        storeLocation: 'Tayabas Highway, Quezon',
        actionLabel: 'View Branch',
        timestamp: t(15)
      },
      {
        id: 'notif-adm-br-2',
        role: 'admin',
        category: 'branch',
        type: 'branch_sync',
        priority: 'info',
        title: 'Lucena Central Branch Online',
        message: 'Store location Lucena City connected. Real-time telemetry, terminal heartbeat, and safe buffer limits verified.',
        actor: 'Network Daemon',
        storeLocation: 'Lucena City Central Mall',
        actionLabel: 'Check Telemetry',
        timestamp: t(120)
      },
      {
        id: 'notif-adm-br-3',
        role: 'admin',
        category: 'branch',
        type: 'user_branch_assigned',
        priority: 'info',
        title: 'User Branch Store Assigned',
        message: 'Store Manager Maria Santos assigned as Primary Overseer for Lucena Central Branch store.',
        actor: 'Administration',
        storeLocation: 'Lucena City Central Mall',
        actionLabel: 'View Assignment',
        timestamp: t(280)
      },

      // User Tab (Masked/blurred device locations with asterisks!)
      {
        id: 'notif-adm-usr-1',
        role: 'admin',
        category: 'user',
        type: 'daily_login',
        priority: 'info',
        title: 'Store Staff Daily Login',
        message: 'Juan Dela Cruz (Store Staff) timely morning sign-in recorded.',
        actor: 'Juan Dela Cruz',
        deviceLocation: 'Lucena City (120.98.***.***)',
        deviceType: 'Staff POS Terminal #02',
        actionLabel: 'Inspect Session',
        timestamp: t(25)
      },
      {
        id: 'notif-adm-usr-2',
        role: 'admin',
        category: 'user',
        type: 'daily_login',
        priority: 'info',
        title: 'Manager Daily Login',
        message: 'Maria Santos (Store Manager) authenticated into Management Suite.',
        actor: 'Maria Santos',
        deviceLocation: 'Tayabas Station (112.198.***.***)',
        deviceType: 'Manager Desktop Workstation',
        actionLabel: 'Inspect Session',
        timestamp: t(45)
      },
      {
        id: 'notif-adm-usr-3',
        role: 'admin',
        category: 'user',
        type: 'daily_login',
        priority: 'purple',
        title: 'Administrator Timely Login',
        message: 'System Administrator secure session authenticated.',
        actor: 'Super Admin',
        deviceLocation: 'Lucena HQ (192.168.***.***)',
        deviceType: 'Secure Admin Console',
        actionLabel: 'Verify Session',
        timestamp: t(70)
      },
      {
        id: 'notif-adm-usr-4',
        role: 'admin',
        category: 'user',
        type: 'user_created',
        priority: 'success',
        title: 'User Created',
        message: 'New store staff account created for Elena Reyes with active receiving privileges.',
        actor: 'Administration',
        deviceLocation: 'Lucena HQ (192.168.***.***)',
        actionLabel: 'View User',
        timestamp: t(340)
      },
      {
        id: 'notif-adm-usr-5',
        role: 'admin',
        category: 'user',
        type: 'user_reactivated',
        priority: 'success',
        title: 'User Reactivated',
        message: 'Staff account for Carlos Gomez reactivated after seasonal leave.',
        actor: 'Administration',
        deviceLocation: 'Lucena HQ (192.168.***.***)',
        actionLabel: 'View User',
        timestamp: t(520)
      },
      {
        id: 'notif-adm-usr-6',
        role: 'admin',
        category: 'user',
        type: 'user_deactivated',
        priority: 'warning',
        title: 'User Deactivated',
        message: 'Temporary auditor account deactivated upon completion of Q3 stock verification.',
        actor: 'Administration',
        deviceLocation: 'Lucena HQ (192.168.***.***)',
        actionLabel: 'Audit Logs',
        timestamp: t(1440)
      },

      // System Tab (Admin: backups, restore, password change, system alerts)
      {
        id: 'notif-adm-sys-1',
        role: 'admin',
        category: 'system',
        type: 'backup',
        priority: 'success',
        title: 'Database Backup Completed',
        message: 'Scheduled full database snapshot saved to encrypted cold storage (rmims_backup_20261010_0800.dump).',
        actor: 'Automated Backup Daemon',
        actionLabel: 'Inspect Backup',
        timestamp: t(35)
      },
      {
        id: 'notif-adm-sys-2',
        role: 'admin',
        category: 'system',
        type: 'restore',
        priority: 'info',
        title: 'System Restored Verification',
        message: 'Configuration tables verified against disaster recovery archive with 100% integrity parity.',
        actor: 'System Integrity Engine',
        actionLabel: 'Verify Integrity',
        timestamp: t(220)
      },
      {
        id: 'notif-adm-sys-3',
        role: 'admin',
        category: 'system',
        type: 'password_change',
        priority: 'warning',
        title: 'Admin Password Changed',
        message: 'Security credentials updated for Administrator profile. Two-factor session refreshed.',
        actor: 'Super Admin',
        deviceLocation: 'Lucena HQ (192.168.***.***)',
        actionLabel: 'Audit Security',
        timestamp: t(600)
      },
      {
        id: 'notif-adm-sys-4',
        role: 'admin',
        category: 'system',
        type: 'alert',
        priority: 'purple',
        title: 'System Alert: Telemetry Normal',
        message: 'Database storage consumption at 18.4%. All 59 raw materials and ML forecast models operational.',
        actor: 'Monitoring Daemon',
        actionLabel: 'System Telemetry',
        timestamp: t(720)
      },

      // -------------------------------------------------------------
      // MANAGER NOTIFICATIONS
      // -------------------------------------------------------------
      // Employees Tab (Progress notif of staff: please check, receive/disburse updated)
      {
        id: 'notif-mgr-emp-1',
        role: 'manager',
        category: 'employees',
        type: 'receive_check',
        priority: 'warning',
        title: 'Staff Added Receive Material — Please Check',
        message: 'Staff Juan Dela Cruz added 50 bags of Refined Sugar (Lot #RS-2026-088). Verification required before lot release.',
        actor: 'Staff: Juan Dela Cruz',
        actionLabel: 'Review Receipt',
        material: 'Refined Sugar (50kg)',
        quantity: '50 bags',
        timestamp: t(10)
      },
      {
        id: 'notif-mgr-emp-2',
        role: 'manager',
        category: 'employees',
        type: 'disburse_check',
        priority: 'warning',
        title: 'Disburse Material Added — Please Check',
        message: 'Staff Elena Reyes recorded disbursement of 120 kg Raw Sugar for Production Batch #PB-440. Please check approval.',
        actor: 'Staff: Elena Reyes',
        actionLabel: 'Check Disbursement',
        material: 'Raw Sugar (120kg)',
        quantity: '120 kg',
        timestamp: t(30)
      },
      {
        id: 'notif-mgr-emp-3',
        role: 'manager',
        category: 'employees',
        type: 'receive_updated',
        priority: 'info',
        title: 'Receive Material Updated',
        message: 'Staff updated delivery receipt #DR-9921 from 45 to 50 bags following physical pallet recount.',
        actor: 'Staff: Juan Dela Cruz',
        material: 'Washed Sugar',
        timestamp: t(65)
      },
      {
        id: 'notif-mgr-emp-4',
        role: 'manager',
        category: 'employees',
        type: 'disburse_updated',
        priority: 'info',
        title: 'Disburse Material Updated',
        message: 'Allocation notes modified on Disbursement #DS-1082 for Packaging Line 2 by Store Staff.',
        actor: 'Staff: Carlos Gomez',
        material: 'Polypropylene Sacks',
        timestamp: t(140)
      },
      {
        id: 'notif-mgr-emp-5',
        role: 'manager',
        category: 'employees',
        type: 'employee_added',
        priority: 'success',
        title: 'Employee Added',
        message: 'The employee has been added successfully and now has access to the selected stores.',
        actor: 'Store Management',
        timestamp: t(240)
      },

      // System Tab (Manager: add, import, export, upload, receive save, disburse save, finished product, AI forecast, alerts, deleted)
      {
        id: 'notif-mgr-sys-1',
        role: 'manager',
        category: 'system',
        type: 'file_imported',
        priority: 'success',
        title: 'File Imported Successfully',
        message: 'Import completed for raw_materials_q4_batch.xlsx. 59 raw materials and stock thresholds updated.',
        actor: 'Manager Suite',
        fileName: 'raw_materials_q4_batch.xlsx',
        fileRows: '59 records updated',
        timestamp: t(18)
      },
      {
        id: 'notif-mgr-sys-2',
        role: 'manager',
        category: 'system',
        type: 'file_exported',
        priority: 'info',
        title: 'File Exported',
        message: 'Export file generated: RMIMS_Disbursements_Oct2026.csv (Disbursements and Stock Audit log).',
        actor: 'Manager Suite',
        fileName: 'RMIMS_Disbursements_Oct2026.csv',
        timestamp: t(50)
      },
      {
        id: 'notif-mgr-sys-3',
        role: 'manager',
        category: 'system',
        type: 'file_uploaded',
        priority: 'info',
        title: 'Supplier Certificate Uploaded',
        message: 'Supplier Certificate of Analysis (COA) PDF uploaded for Refined Sugar delivery verification.',
        actor: 'Store Manager',
        fileName: 'COA_RefinedSugar_Lot088.pdf',
        timestamp: t(80)
      },
      {
        id: 'notif-mgr-sys-4',
        role: 'manager',
        category: 'system',
        type: 'receive_saved',
        priority: 'success',
        title: 'Receive Saved',
        message: 'Stock receipt #RC-2026-1049 saved to authoritative database with supplier reference DR-8812.',
        actor: 'Store Staff',
        material: 'Refined Sugar',
        quantity: '50 bags',
        timestamp: t(95)
      },
      {
        id: 'notif-mgr-sys-5',
        role: 'manager',
        category: 'system',
        type: 'disburse_saved',
        priority: 'info',
        title: 'Disburse Saved',
        message: 'Disbursement #DB-2026-0512 saved and deducted from current live store inventory.',
        actor: 'Store Staff',
        material: 'Brown Sugar',
        quantity: '15 sacks',
        timestamp: t(110)
      },
      {
        id: 'notif-mgr-sys-6',
        role: 'manager',
        category: 'system',
        type: 'finished_product_created',
        priority: 'purple',
        title: 'Finished Product Created',
        message: 'New recipe cataloged: "Refined White Sugar 1kg Retail Pack" (SKU #FP-RWS-01).',
        actor: 'Store Management',
        productName: 'Refined White Sugar 1kg Retail Pack',
        timestamp: t(160)
      },
      {
        id: 'notif-mgr-sys-7',
        role: 'manager',
        category: 'system',
        type: 'finished_product_bom_added',
        priority: 'purple',
        title: 'Finished Product Raw Materials Added',
        message: 'Bill of Materials linked: 1,000 kg Bulk Refined Sugar + 1,000 Polypropylene Units for Packaging.',
        actor: 'Store Management',
        timestamp: t(180)
      },
      {
        id: 'notif-mgr-sys-8',
        role: 'manager',
        category: 'system',
        type: 'raw_material_updated',
        priority: 'info',
        title: 'Raw Materials Updated',
        message: 'Safety buffer threshold for Washed Sugar adjusted from 150 to 200 bags to protect against supply lags.',
        actor: 'Store Management',
        material: 'Washed Sugar',
        timestamp: t(210)
      },
      {
        id: 'notif-mgr-sys-9',
        role: 'manager',
        category: 'system',
        type: 'ai_forecast_generated',
        priority: 'purple',
        title: 'AI Forecasting Generated',
        message: 'Random Forest & Prophet AI engine generated 30-day forecast across all 59 materials with ±7.51% tolerance.',
        actor: 'AI ML Engine',
        actionLabel: 'View Forecast',
        timestamp: t(250)
      },
      {
        id: 'notif-mgr-sys-10',
        role: 'manager',
        category: 'system',
        type: 'stock_alert',
        priority: 'warning',
        title: 'Alert: Low Stock Buffer',
        message: 'Brown Sugar inventory level (85 sacks) has breached the minimum safe reorder point of 100 sacks.',
        actor: 'System Watchdog',
        actionLabel: 'Check Stock',
        material: 'Brown Sugar',
        timestamp: t(310)
      },
      {
        id: 'notif-mgr-sys-11',
        role: 'manager',
        category: 'system',
        type: 'ai_support_alert',
        priority: 'purple',
        title: 'AI Support Alert: Demand Surge',
        message: 'Predictive seasonal spike: Sugar consumption forecasted to increase 18.4% next week due to holiday bakery orders.',
        actor: 'AI Support Assistant',
        timestamp: t(400)
      },
      {
        id: 'notif-mgr-sys-12',
        role: 'manager',
        category: 'system',
        type: 'item_deleted',
        priority: 'danger',
        title: 'Item Deleted',
        message: 'Deprecated packaging draft record #TMP-PKG-02 removed from database by manager.',
        actor: 'Store Management',
        timestamp: t(580)
      },

      // -------------------------------------------------------------
      // STAFF NOTIFICATIONS
      // -------------------------------------------------------------
      // System Tab (Staff: receive saved/updated, disburse saved/updated, incoming messages, AI reminders)
      {
        id: 'notif-stf-act-1',
        role: 'staff',
        category: 'activity',
        type: 'msg_incoming_receive',
        priority: 'warning',
        title: 'Message: Incoming Delivery Arriving Today',
        message: '100 sacks Raw Sugar arriving from Central Milling Corp at approximately 1:30 PM. Prepare bay 2 for staging.',
        actor: 'Logistics Dispatch',
        actionLabel: 'View ETA',
        material: 'Raw Sugar (100 sacks)',
        timestamp: t(8)
      },
      {
        id: 'notif-stf-act-2',
        role: 'staff',
        category: 'activity',
        type: 'msg_incoming_disburse',
        priority: 'info',
        title: 'Message: Incoming Disburse Request',
        message: 'Requisition order #REQ-882 pending staging for Bakery Line 3 (Requires 20 bags Washed Sugar).',
        actor: 'Production Line 3',
        actionLabel: 'Stage Material',
        material: 'Washed Sugar (20 bags)',
        timestamp: t(22)
      },
      {
        id: 'notif-stf-act-3',
        role: 'staff',
        category: 'activity',
        type: 'receive_saved',
        priority: 'success',
        title: 'Receive Saved',
        message: 'Stock receipt #RC-1049 (50 sacks Refined Sugar) successfully committed to authoritative store ledger.',
        actor: 'Juan Dela Cruz',
        actionLabel: 'View Ledger',
        material: 'Refined Sugar',
        quantity: '50 sacks',
        timestamp: t(40)
      },
      {
        id: 'notif-stf-act-4',
        role: 'staff',
        category: 'activity',
        type: 'receive_updated',
        priority: 'info',
        title: 'Receive Updated',
        message: 'Stock receipt #RC-1048 verified and delivery receipt DR-9921 attached.',
        actor: 'Juan Dela Cruz',
        actionLabel: 'View Receipt',
        material: 'Washed Sugar',
        timestamp: t(75)
      },
      {
        id: 'notif-stf-act-5',
        role: 'staff',
        category: 'activity',
        type: 'disburse_saved',
        priority: 'info',
        title: 'Disburse Saved',
        message: 'Disbursement #DB-0512 (12 sacks Brown Sugar) logged and deducted from current balance.',
        actor: 'Elena Reyes',
        actionLabel: 'View Entry',
        material: 'Brown Sugar',
        quantity: '12 sacks',
        timestamp: t(115)
      },
      {
        id: 'notif-stf-act-6',
        role: 'staff',
        category: 'activity',
        type: 'disburse_updated',
        priority: 'info',
        title: 'Disburse Updated',
        message: 'Requisition #DB-0510 allocation notes and line dispatch time updated.',
        actor: 'Carlos Gomez',
        actionLabel: 'Check Notes',
        timestamp: t(160)
      },
      {
        id: 'notif-stf-sys-1',
        role: 'staff',
        category: 'system',
        type: 'ai_reminder',
        priority: 'purple',
        title: 'Reminder: AI Forecast Recommendation',
        message: 'AI safety reorder suggestion: Replenish Molasses raw materials within 48 hours to avert line bottlenecks.',
        actor: 'AI Forecasting Advisor',
        actionLabel: 'Check Advice',
        material: 'Molasses (Buffer Warning)',
        timestamp: t(210)
      },
      {
        id: 'notif-stf-sys-2',
        role: 'staff',
        category: 'system',
        type: 'safe_buffer',
        priority: 'warning',
        title: 'Store Safe Buffer Limit Warning',
        message: 'Refined sugar safety margin reached. Restock prompt sent to Store Manager.',
        actor: 'Buffer Alert Daemon',
        actionLabel: 'View Warning',
        material: 'Refined Sugar',
        timestamp: t(290)
      }
    ];
  }

  // Retrieve stored notifications or seed if empty
  function getNotifications() {
    try {
      const raw = localStorage.getItem(STORAGE_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (_) {}

    const seed = getSeedNotifications();
    try {
      localStorage.setItem(STORAGE_STORE_KEY, JSON.stringify(seed));
    } catch (_) {}
    return seed;
  }

  function saveNotifications(list) {
    try {
      localStorage.setItem(STORAGE_STORE_KEY, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent('rmims:notification_change'));
    } catch (_) {}
  }

  // Read status set
  function getReadSet() {
    try {
      const raw = localStorage.getItem(STORAGE_READ_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
      }
    } catch (_) {}
    return new Set();
  }

  function saveReadSet(set) {
    try {
      const arr = Array.from(set);
      localStorage.setItem(STORAGE_READ_KEY, JSON.stringify(arr));
      window.dispatchEvent(new CustomEvent('rmims:notification_change'));
    } catch (_) {}
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return 'Just now';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Recently';

    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

    if (diffSec < 45) return 'Just now';
    if (diffSec < 3600) {
      const m = Math.max(1, Math.floor(diffSec / 60));
      return m === 1 ? '1 minute ago' : `${m} minutes ago`;
    }
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (diffSec < 86400) {
      return timeStr;
    }
    if (diffSec < 172800) {
      return `Yesterday, ${timeStr}`;
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function formatExactDate(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  function getStatusIcon(priority) {
    switch (priority) {
      case 'success':
        // Green circle checkmark
        return `<div class="rmims-notif-item-icon success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>`;
      case 'warning':
        // Orange triangle alert
        return `<div class="rmims-notif-item-icon warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>`;
      case 'danger':
        // Red circle x
        return `<div class="rmims-notif-item-icon danger">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        </div>`;
      case 'purple':
        // Purple spark / AI
        return `<div class="rmims-notif-item-icon purple">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"></path>
          </svg>
        </div>`;
      case 'info':
      default:
        // Blue exclamation circle
        return `<div class="rmims-notif-item-icon info">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>`;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Active state
  let currentActiveTab = 'all';
  let currentSearchQuery = '';
  let currentStatusFilter = 'all'; // 'all' or 'unread'

  // Unified category matcher supporting unified 'activity' and 'system'
  function isCategoryMatch(itemCategory, tabId) {
    if (!tabId || tabId === 'all') return true;
    const cat = String(itemCategory || '').toLowerCase();
    if (tabId === 'activity') {
      return cat === 'activity' || cat === 'branch' || cat === 'user' || cat === 'employees' || cat === 'operations';
    }
    if (tabId === 'system') {
      return cat === 'system';
    }
    return cat === tabId;
  }

  // Unified tabs across ALL roles (Admin, Manager, Staff) - strictly ONE design
  function getTabsForRole(role) {
    return [
      { id: 'all', label: 'All notifications' },
      { id: 'activity', label: 'Activity' },
      { id: 'system', label: 'System' }
    ];
  }

  // Filter notifications for active view
  function getFilteredNotifications(role) {
    const all = getNotifications();

    // Filter strictly by portal role
    const roleItems = all.filter(n => n.role === role);

    return roleItems.filter(n => {
      // Tab filter
      if (currentActiveTab !== 'all' && !isCategoryMatch(n.category, currentActiveTab)) {
        return false;
      }

      // Search query
      if (currentSearchQuery) {
        const text = `${n.title || ''} ${n.message || ''} ${n.actor || ''} ${n.category || ''} ${n.material || ''} ${n.fileName || ''} ${n.deviceLocation || ''}`.toLowerCase();
        if (!text.includes(currentSearchQuery)) {
          return false;
        }
      }

      return true;
    });
  }

  // Update topbar bell badge count
  function updateTopbarBadges(role) {
    const all = getNotifications();
    const readSet = getReadSet();
    const roleItems = all.filter(n => n.role === role);
    const unreadCount = roleItems.filter(n => !readSet.has(String(n.id))).length;

    // Find all bell buttons in DOM
    const bellButtons = document.querySelectorAll(
      '#notificationBtn, #rmsmeNotificationBtn, #adminNotificationBtn, .topbar-icon-btn, .mgr-bell-btn'
    );

    bellButtons.forEach(btn => {
      let badge = btn.querySelector('.rmims-bell-unread-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'rmims-bell-unread-badge';
        btn.appendChild(badge);
      }

      if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = 'flex';
        btn.setAttribute('aria-label', `${unreadCount} unread notifications`);
        btn.title = `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`;
      } else {
        badge.style.display = 'none';
        btn.setAttribute('aria-label', 'Notifications');
        btn.title = 'Notifications';
      }
    });
  }

  // Build the main notification popover modal
  function ensureNotificationModal(role) {
    let backdrop = document.getElementById('rmimsNotifBackdrop');
    if (backdrop) return backdrop;

    backdrop = document.createElement('div');
    backdrop.id = 'rmimsNotifBackdrop';
    backdrop.className = 'rmims-notif-backdrop';
    backdrop.innerHTML = `
      <div class="rmims-notif-card" role="dialog" aria-modal="true" aria-labelledby="rmimsNotifTitle">
        <!-- Header -->
        <div class="rmims-notif-header">
          <h2 class="rmims-notif-title" id="rmimsNotifTitle">Notifications</h2>
          <div class="rmims-notif-header-actions">
            <button type="button" class="rmims-notif-header-icon-btn" id="rmimsNotifSearchToggle" title="Search notifications">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </button>
            <button type="button" class="rmims-notif-close-btn" id="rmimsNotifCloseBtn" aria-label="Close notifications">✕</button>
          </div>
        </div>

        <!-- Role Tabs Bar (Matching reference design) -->
        <div class="rmims-notif-tabs-bar" id="rmimsNotifTabsBar">
          <!-- Populated by renderTabs() -->
        </div>

        <!-- Sleek Collapsible Search Bar (Zero clunky gray background) -->
        <div class="rmims-notif-search-container" id="rmimsNotifSearchContainer">
          <div class="rmims-notif-search-wrap">
            <svg class="rmims-notif-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" class="rmims-notif-search-input" id="rmimsNotifSearchInput" placeholder="Search notifications, materials, or files...">
            <button type="button" class="rmims-notif-search-clear" id="rmimsNotifSearchClear">✕</button>
          </div>
        </div>

        <!-- Notifications Body List -->
        <div class="rmims-notif-body" id="rmimsNotifList">
          <!-- Populated dynamically -->
        </div>

        <!-- Footer -->
        <div class="rmims-notif-footer">
          <button type="button" class="rmims-notif-mark-all-btn" id="rmimsNotifMarkAllBtn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Mark all as read
          </button>
          <button type="button" class="rmims-notif-view-all-btn" id="rmimsNotifViewAllBtn">View all</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    // Event listeners for close
    const closePopup = () => {
      backdrop.classList.remove('open');
    };

    backdrop.querySelector('#rmimsNotifCloseBtn').addEventListener('click', closePopup);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closePopup();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop.classList.contains('open')) {
        closePopup();
      }
    });

    // Mark all as read button - STRICTLY SCOPED TO ACTIVE TAB!
    backdrop.querySelector('#rmimsNotifMarkAllBtn').addEventListener('click', () => {
      const all = getNotifications();
      const readSet = getReadSet();
      
      // Only mark notifications that belong to the current active tab
      const tabItems = all.filter(n => {
        if (n.role !== role) return false;
        if (currentActiveTab === 'all') return true;
        return isCategoryMatch(n.category, currentActiveTab);
      });

      tabItems.forEach(n => readSet.add(String(n.id)));
      saveReadSet(readSet);
      renderTabs(role);
      renderList(role);
      updateTopbarBadges(role);
    });

    // View all button
    backdrop.querySelector('#rmimsNotifViewAllBtn').addEventListener('click', () => {
      currentActiveTab = 'all';
      currentStatusFilter = 'all';
      currentSearchQuery = '';
      const sInput = backdrop.querySelector('#rmimsNotifSearchInput');
      if (sInput) sInput.value = '';
      const sClear = backdrop.querySelector('#rmimsNotifSearchClear');
      if (sClear) sClear.classList.remove('visible');
      renderTabs(role);
      renderList(role);
    });

    // Search toggle & input handling
    const searchToggle = backdrop.querySelector('#rmimsNotifSearchToggle');
    const searchContainer = backdrop.querySelector('#rmimsNotifSearchContainer');
    const searchInput = backdrop.querySelector('#rmimsNotifSearchInput');
    const searchClear = backdrop.querySelector('#rmimsNotifSearchClear');

    searchToggle.addEventListener('click', () => {
      const isOpen = searchContainer.classList.toggle('open');
      searchToggle.classList.toggle('active', isOpen);
      if (isOpen) {
        searchInput.focus();
      } else {
        searchInput.value = '';
        currentSearchQuery = '';
        searchClear.classList.remove('visible');
        renderList(role);
      }
    });

    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.trim().toLowerCase();
      searchClear.classList.toggle('visible', Boolean(currentSearchQuery));
      renderList(role);
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      currentSearchQuery = '';
      searchClear.classList.remove('visible');
      searchInput.focus();
      renderList(role);
    });

    return backdrop;
  }

  // Render Tabs row with dynamic badge counts
  function renderTabs(role) {
    const tabsBar = document.getElementById('rmimsNotifTabsBar');
    if (!tabsBar) return;

    const tabs = getTabsForRole(role);
    const all = getNotifications();
    const readSet = getReadSet();
    const roleItems = all.filter(n => n.role === role);

    tabsBar.innerHTML = '';

    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `rmims-notif-tab ${tab.id === currentActiveTab ? 'active' : ''}`;
      btn.dataset.tab = tab.id;

      // Count unread for this tab
      const tabItems = tab.id === 'all' ? roleItems : roleItems.filter(n => isCategoryMatch(n.category, tab.id));
      const unreadCount = tabItems.filter(n => !readSet.has(String(n.id))).length;

      let badgeHtml = '';
      if (tab.id === currentActiveTab) {
        badgeHtml = `<span class="rmims-notif-tab-badge">${unreadCount}</span>`;
      } else if (unreadCount > 0) {
        badgeHtml = `<span class="rmims-notif-tab-badge inactive">${unreadCount}</span>`;
      }

      btn.innerHTML = `
        <span>${escapeHtml(tab.label)}</span>
        ${badgeHtml}
      `;

      btn.addEventListener('click', () => {
        currentActiveTab = tab.id;
        renderTabs(role);
        renderList(role);
      });

      tabsBar.appendChild(btn);
    });
  }

  // Render notification item list
  function renderList(role) {
    const listEl = document.getElementById('rmimsNotifList');
    if (!listEl) return;

    const items = getFilteredNotifications(role);
    const readSet = getReadSet();

    if (items.length === 0) {
      listEl.innerHTML = `
        <div class="rmims-notif-empty">
          <div class="rmims-notif-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z"></path>
              <path d="M13.7 21a2 2 0 0 1-3.4 0"></path>
            </svg>
          </div>
          <div class="rmims-notif-empty-text">No notifications found</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';

    items.forEach(n => {
      const isRead = readSet.has(String(n.id));
      const iconHtml = getStatusIcon(n.priority);
      const timeStr = formatTimeAgo(n.timestamp);

      // Category label formatted nicely
      let rawCat = String(n.category || 'System').toLowerCase();
      let catLabel = (rawCat === 'branch' || rawCat === 'user' || rawCat === 'employees' || rawCat === 'operations')
        ? 'Activity'
        : (rawCat.charAt(0).toUpperCase() + rawCat.slice(1));
      if (catLabel === 'All') catLabel = 'General';

      const card = document.createElement('div');
      card.className = `rmims-notif-item ${isRead ? 'read' : 'unread'}`;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      let actionHtml = '';
      if (n.actionLabel) {
        actionHtml = `
          <div class="rmims-notif-item-actions">
            <button type="button" class="rmims-notif-action-btn-primary item-action-trigger">${escapeHtml(n.actionLabel)}</button>
            ${n.type === 'invitation_pending' ? '<button type="button" class="rmims-notif-action-btn-secondary">Copy link</button>' : ''}
          </div>
        `;
      }

      card.innerHTML = `
        ${iconHtml}
        <div class="rmims-notif-item-content">
          <div class="rmims-notif-item-head">
            <span class="rmims-notif-item-title">${escapeHtml(n.title)}</span>
            <span class="rmims-notif-unread-dot" title="Unread"></span>
          </div>
          <div class="rmims-notif-item-desc">${escapeHtml(n.message)}</div>
          ${actionHtml}
          <div class="rmims-notif-item-footer">
            <span>${escapeHtml(timeStr)}</span>
            <span class="sep">•</span>
            <span>${escapeHtml(catLabel)}</span>
          </div>
        </div>
      `;

      // Tap event: Marks as read AND opens inspection detail popup!
      card.addEventListener('click', (e) => {
        // Mark as read
        readSet.add(String(n.id));
        saveReadSet(readSet);
        card.classList.remove('unread');
        card.classList.add('read');
        renderTabs(role);
        updateTopbarBadges(role);

        // Open inspection detail popup
        showInspectionDetail(n, role);
      });

      listEl.appendChild(card);
    });
  }

  // =========================================================================
  // SECONDARY DETAIL INSPECTION MODAL (Tapped item detail popup)
  // Shows time, name of file/material, actor, masked device location, Cancel/Back
  // =========================================================================
  function showInspectionDetail(notif, role) {
    let backdrop = document.getElementById('rmimsDetailBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'rmimsDetailBackdrop';
      backdrop.className = 'rmims-detail-backdrop';
      document.body.appendChild(backdrop);
    }

    const exactTime = formatExactDate(notif.timestamp);
    const relativeTime = formatTimeAgo(notif.timestamp);
    const priority = notif.priority || 'info';

    // Masked device location HTML (with asterisks and blur styling)
    let deviceLocationHtml = '';
    if (notif.deviceLocation) {
      deviceLocationHtml = `
        <div class="rmims-detail-meta-item">
          <span class="rmims-detail-meta-label">Device Location:</span>
          <span class="rmims-detail-meta-val">
            <span class="rmims-masked-location">
              🔒 ${escapeHtml(notif.deviceLocation)}
              <span class="rmims-masked-badge">Masked</span>
            </span>
          </span>
        </div>
      `;
    }

    let metaDetailsHtml = '';
    if (notif.fileName) {
      metaDetailsHtml += `
        <div class="rmims-detail-meta-item">
          <span class="rmims-detail-meta-label">File Name:</span>
          <span class="rmims-detail-meta-val">📄 ${escapeHtml(notif.fileName)}</span>
        </div>
      `;
    }
    if (notif.fileRows) {
      metaDetailsHtml += `
        <div class="rmims-detail-meta-item">
          <span class="rmims-detail-meta-label">Records Processed:</span>
          <span class="rmims-detail-meta-val">${escapeHtml(notif.fileRows)}</span>
        </div>
      `;
    }
    if (notif.material) {
      metaDetailsHtml += `
        <div class="rmims-detail-meta-item">
          <span class="rmims-detail-meta-label">Raw Material:</span>
          <span class="rmims-detail-meta-val">📦 ${escapeHtml(notif.material)}</span>
        </div>
      `;
    }
    if (notif.quantity) {
      metaDetailsHtml += `
        <div class="rmims-detail-meta-item">
          <span class="rmims-detail-meta-label">Quantity:</span>
          <span class="rmims-detail-meta-val">${escapeHtml(notif.quantity)}</span>
        </div>
      `;
    }
    if (notif.storeLocation) {
      metaDetailsHtml += `
        <div class="rmims-detail-meta-item">
          <span class="rmims-detail-meta-label">Store Location:</span>
          <span class="rmims-detail-meta-val">🏬 ${escapeHtml(notif.storeLocation)}</span>
        </div>
      `;
    }
    if (notif.productName) {
      metaDetailsHtml += `
        <div class="rmims-detail-meta-item">
          <span class="rmims-detail-meta-label">Product Name:</span>
          <span class="rmims-detail-meta-val">🏷️ ${escapeHtml(notif.productName)}</span>
        </div>
      `;
    }

    backdrop.innerHTML = `
      <div class="rmims-detail-card" role="dialog" aria-modal="true">
        <div class="rmims-detail-header">
          <h3>Notification Details</h3>
          <button type="button" class="rmims-detail-close-btn" id="rmimsDetailCloseBtn" aria-label="Back to notifications">✕</button>
        </div>
        <div class="rmims-detail-body">
          <div class="rmims-detail-badge-row">
            <span class="rmims-detail-badge ${priority}">${escapeHtml(priority)}</span>
            <span class="rmims-detail-badge info">${escapeHtml(notif.category || 'System')}</span>
          </div>

          <h2 class="rmims-detail-title">${escapeHtml(notif.title)}</h2>
          <p class="rmims-detail-desc">${escapeHtml(notif.message)}</p>

          <div class="rmims-detail-meta-box">
            <div class="rmims-detail-meta-item">
              <span class="rmims-detail-meta-label">Timestamp:</span>
              <span class="rmims-detail-meta-val">${escapeHtml(exactTime)} (${escapeHtml(relativeTime)})</span>
            </div>
            <div class="rmims-detail-meta-item">
              <span class="rmims-detail-meta-label">Initiated By:</span>
              <span class="rmims-detail-meta-val">${escapeHtml(notif.actor || 'System')}</span>
            </div>
            ${deviceLocationHtml}
            ${metaDetailsHtml}
          </div>
        </div>
        <div class="rmims-detail-footer">
          <button type="button" class="rmims-detail-btn-cancel" id="rmimsDetailCancelBtn">Cancel / Back</button>
          ${notif.actionLabel ? `<button type="button" class="rmims-detail-btn-action" id="rmimsDetailActionBtn">${escapeHtml(notif.actionLabel)}</button>` : ''}
        </div>
      </div>
    `;

    backdrop.classList.add('open');

    const closeDetail = () => {
      backdrop.classList.remove('open');
    };

    backdrop.querySelector('#rmimsDetailCloseBtn').addEventListener('click', closeDetail);
    backdrop.querySelector('#rmimsDetailCancelBtn').addEventListener('click', closeDetail);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeDetail();
    });

    const actionBtn = backdrop.querySelector('#rmimsDetailActionBtn');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        closeDetail();
        // Redirect to relevant screen if action involves forecast, stock, or logs
        if (notif.type === 'ai_forecast_generated' || notif.type === 'ai_reminder') {
          if (window.location.pathname.includes('/manager/')) {
            window.location.href = 'forecasting.html';
          }
        }
      });
    }
  }

  // Open notification popup
  function openNotificationsModal(role) {
    const backdrop = ensureNotificationModal(role);
    renderTabs(role);
    renderList(role);
    updateTopbarBadges(role);
    backdrop.classList.add('open');
  }

  // Bind bell button click handlers
  function bindBellButtons() {
    const role = getPortalRole();

    // Query all bell buttons (Admin, Manager, Staff)
    const selectors = [
      '#notificationBtn',
      '#rmsmeNotificationBtn',
      '#adminNotificationBtn',
      '.topbar-icon-btn',
      '.mgr-bell-btn'
    ];

    document.querySelectorAll(selectors.join(', ')).forEach(btn => {
      // Avoid double-binding
      if (btn.dataset.rmimsNotifBound) return;
      btn.dataset.rmimsNotifBound = 'true';

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNotificationsModal(role);
      });
    });

    updateTopbarBadges(role);
  }

  // Cross-tab and live event synchronization
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_STORE_KEY || e.key === STORAGE_READ_KEY) {
      const role = getPortalRole();
      updateTopbarBadges(role);
      const backdrop = document.getElementById('rmimsNotifBackdrop');
      if (backdrop && backdrop.classList.contains('open')) {
        renderTabs(role);
        renderList(role);
      }
    }
  });

  window.addEventListener('rmims:notification_change', () => {
    const role = getPortalRole();
    updateTopbarBadges(role);
    const backdrop = document.getElementById('rmimsNotifBackdrop');
    if (backdrop && backdrop.classList.contains('open')) {
      renderTabs(role);
      renderList(role);
    }
  });

  // Public API to push live notifications from any action (imports, receives, disbursements, backups, logins)
  window.pushRMIMSNotification = function (notif) {
    if (!notif) return;
    const all = getNotifications();
    const id = notif.id || `notif-live-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newNotif = {
      ...notif,
      id,
      timestamp: notif.timestamp || new Date().toISOString()
    };
    all.unshift(newNotif);
    saveNotifications(all);

    const role = getPortalRole();
    updateTopbarBadges(role);
  };

  window.RMIMS_NOTIFICATIONS_POPUP = {
    open: openNotificationsModal,
    updateBadges: updateTopbarBadges,
    push: window.pushRMIMSNotification
  };

  // Initialize on DOM load
  function init() {
    ensureNotificationStyles();
    bindBellButtons();
    const role = getPortalRole();
    updateTopbarBadges(role);

    // Re-check periodically or after dynamic header generation
    setTimeout(() => {
      bindBellButtons();
      updateTopbarBadges(role);
    }, 400);

    setTimeout(() => {
      bindBellButtons();
      updateTopbarBadges(role);
    }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
