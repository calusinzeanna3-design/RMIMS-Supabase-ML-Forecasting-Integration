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
    try {
      const u = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
      const r = (u.operationalRole || u.role || '').toLowerCase();
      if (r === 'admin') return 'admin';
      if (r === 'manager') return 'manager';
      if (r === 'staff' || r === 'user') return 'staff';
    } catch (_) {}
    return 'staff';
  }

  function getCurrentUserId() {
    try {
      const u = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || localStorage.getItem('userProfile') || '{}');
      return u.id || u.email || null;
    } catch (_) {
      return null;
    }
  }

  // Strict role isolation: each role only receives notifications within their operational scope
  function isNotificationInScope(n, portalRole, currentUserId) {
    if (!n || !n.id) return false;

    const targetRole = String(n.targetRole || n.role || n.roleScope || '').toLowerCase();
    const title = String(n.title || '').toLowerCase();
    const message = String(n.message || '').toLowerCase();
    const category = String(n.category || '').toLowerCase();
    const badge = String(n.badge || '').toLowerCase();
    const targetUrl = String(n.targetUrl || '').toLowerCase();

    // 1. ADMIN SCOPE
    if (portalRole === 'admin') {
      if (targetRole === 'manager' || targetRole === 'staff' || targetRole === 'user') {
        return false;
      }
      if (
        badge.includes('pending review') ||
        badge.includes('action required') ||
        badge.includes('received') ||
        badge.includes('disbursed') ||
        title.includes('raw material received') ||
        title.includes('raw material disbursed') ||
        title.includes('new staff receive') ||
        title.includes('new staff disburse') ||
        title.includes('correction requested') ||
        title.includes('transaction approved') ||
        title.includes('transaction rejected') ||
        targetUrl.includes('manager/') ||
        targetUrl.includes('user/')
      ) {
        return false;
      }
      if (category === 'login' || n.type === 'user_login' || title.includes('signed in') || title.includes('authenticated')) {
        return targetRole === 'admin' || title.includes('admin') || message.includes('admin');
      }
      return (
        targetRole === 'admin' ||
        targetUrl.includes('admin/') ||
        badge.includes('registration') ||
        badge.includes('user management') ||
        badge.includes('backup') ||
        badge.includes('restore') ||
        category === 'system' ||
        category === 'security & access' ||
        category === 'user' ||
        title.includes('registration') ||
        title.includes('admin') ||
        title.includes('backup') ||
        title.includes('restore') ||
        title.includes('user account')
      );
    }

    // 2. MANAGER SCOPE
    if (portalRole === 'manager') {
      if (targetRole === 'admin') return false;
      if (
        targetUrl.includes('admin/') ||
        badge.includes('registration') ||
        badge.includes('backup') ||
        badge.includes('restore') ||
        title.includes('registration request') ||
        title.includes('new user created') ||
        title.includes('account approved') ||
        title.includes('registration rejected') ||
        title.includes('system backup') ||
        title.includes('system restored')
      ) {
        return false;
      }
      if (targetRole === 'staff' && (badge.includes('action required') || title.includes('correction requested'))) {
        return false;
      }
      if (category === 'login' || n.type === 'user_login' || title.includes('signed in') || title.includes('authenticated')) {
        return targetRole === 'manager' || title.includes('manager') || message.includes('manager');
      }
      return (
        targetRole === 'manager' ||
        targetRole === 'all' ||
        targetUrl.includes('manager/') ||
        category === 'alert' ||
        category === 'inventory' ||
        category === 'receiving' ||
        category === 'disbursement' ||
        category === 'forecasting' ||
        category === 'employees' ||
        category === 'store operations' ||
        badge.includes('pending review') ||
        badge.includes('received') ||
        badge.includes('disbursed') ||
        badge.includes('updated') ||
        badge.includes('approved') ||
        badge.includes('rejected') ||
        title.includes('stock') ||
        title.includes('material') ||
        title.includes('transaction')
      );
    }

    // 3. STAFF / USER SCOPE
    if (portalRole === 'staff' || portalRole === 'user') {
      if (targetRole === 'admin' || targetRole === 'manager') return false;
      if (
        targetUrl.includes('admin/') ||
        badge.includes('registration') ||
        badge.includes('user management') ||
        badge.includes('backup') ||
        badge.includes('restore') ||
        badge.includes('pending review') ||
        title.includes('registration') ||
        title.includes('system backup') ||
        title.includes('system restored')
      ) {
        return false;
      }
      if (title.includes('raw material received') || title.includes('raw material disbursed')) {
        return false;
      }
      if (category === 'login' || n.type === 'user_login' || title.includes('signed in') || title.includes('authenticated')) {
        if (n.userId && currentUserId && n.userId !== currentUserId) return false;
        return targetRole === 'staff' || targetRole === 'user' || title.includes('staff');
      }
      return (
        targetRole === 'staff' ||
        targetRole === 'user' ||
        targetUrl.includes('user/') ||
        badge.includes('action required') ||
        badge.includes('approved') ||
        badge.includes('rejected') ||
        title.includes('correction requested') ||
        title.includes('transaction approved') ||
        title.includes('transaction rejected') ||
        category === 'alert' ||
        title.includes('out of stock') ||
        title.includes('low stock') ||
        title.includes('stock restored')
      );
    }

    return false;
  }

  const STORAGE_STORE_KEY = 'rmims_notifications_live_v2';
  const STORAGE_READ_KEY = 'rmims_notifications_read_v2';

  // Purge legacy hardcoded/seed notifications from browser storage
  try {
    const legacyKeys = [
      'rmims_notifications_master_v6',
      'rmims_notifications_master_v5',
      'rmims_notifications_master',
      'rmims_live_notifications',
      'rmims_notifications_read_v6',
      'rmims_notifications_read'
    ];
    legacyKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  } catch (_) {}

  // Pure dynamic notification storage - strictly 0 default/mock data
  function getSeedNotifications() {
    return [];
  }

  // Filter helper to reject any fake/dump staff notifications while permitting real dynamic user logins
  function isCleanNotification(n) {
    if (!n || !n.id) return false;
    const t = (n.title || '').toLowerCase();
    const m = (n.message || '').toLowerCase();
    const a = (n.actor || '').toLowerCase();
    const BANNED_TOKENS = [
      'maria santos', 'kenneth ramos', 'rafael cruz', 'alyssa lim', 'carla mendoza',
      'carlos mendoza', 'victor morales', 'ethan cruz', 'sarah gomez', 'mark villanueva',
      '@rmims.ph'
    ];
    if (BANNED_TOKENS.some(tok => t.includes(tok) || m.includes(tok) || a.includes(tok))) return false;
    return true;
  }

  // Immediately cleanse any dump notifications from localStorage
  try {
    const raw = localStorage.getItem(STORAGE_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const clean = parsed.filter(isCleanNotification);
        localStorage.setItem(STORAGE_STORE_KEY, JSON.stringify(clean));
      }
    }
  } catch (_) {}

  // Retrieve stored notifications (clean empty array if nothing added yet)
  function getNotifications() {
    try {
      const raw = localStorage.getItem(STORAGE_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter(isCleanNotification);
          if (clean.length !== parsed.length) {
            localStorage.setItem(STORAGE_STORE_KEY, JSON.stringify(clean));
          }
          return clean;
        }
      }
    } catch (_) {}
    return [];
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
    const uid = getCurrentUserId();

    // Notification appears only if it is in scope for this active portal role
    const roleItems = all.filter(n => isNotificationInScope(n, role, uid));

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
    const uid = getCurrentUserId();
    const roleItems = all.filter(n => isNotificationInScope(n, role, uid));
    const unreadCount = roleItems.filter(n => !readSet.has(String(n.id))).length;

    // Find all bell buttons in DOM
    const bellButtons = document.querySelectorAll(
      '#notificationBtn, #rmsmeNotificationBtn, #adminNotificationBtn, .topbar-icon-btn, .mgr-bell-btn'
    );

    bellButtons.forEach(btn => {
      // Remove any legacy stray badge elements
      btn.querySelectorAll('.badge, .notification-count, .topbar-badge').forEach(b => {
        if (!b.classList.contains('rmims-bell-unread-badge')) {
          b.remove();
        }
      });

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
        badge.textContent = '';
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

    // Mark all as read button - STRICTLY SCOPED TO ACTIVE TAB AND ROLE SCOPE!
    backdrop.querySelector('#rmimsNotifMarkAllBtn').addEventListener('click', () => {
      const all = getNotifications();
      const readSet = getReadSet();
      const uid = getCurrentUserId();
      
      // Only mark notifications that belong to the current active tab and are in scope
      const tabItems = all.filter(n => {
        if (!isNotificationInScope(n, role, uid)) return false;
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
    const uid = getCurrentUserId();
    const roleItems = all.filter(n => isNotificationInScope(n, role, uid));

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
    if (notif.ref) {
      metaDetailsHtml += `
        <div class="rmims-detail-meta-item">
          <span class="rmims-detail-meta-label">Reference No:</span>
          <span class="rmims-detail-meta-val">🔖 <strong>${escapeHtml(notif.ref)}</strong></span>
        </div>
      `;
    }
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
    if (all.some(n => String(n.id) === String(id))) return;

    const callerRole = getPortalRole();
    const effectiveRole = notif.role || notif.targetRole || notif.roleScope || callerRole;
    const newNotif = {
      role: effectiveRole,
      targetRole: notif.targetRole || effectiveRole,
      roleScope: notif.roleScope || effectiveRole,
      category: 'activity',
      priority: 'info',
      ...notif,
      id,
      timestamp: notif.timestamp || new Date().toISOString()
    };
    all.unshift(newNotif);
    saveNotifications(all);

    const role = getPortalRole();
    updateTopbarBadges(role);
    const backdrop = document.getElementById('rmimsNotifBackdrop');
    if (backdrop && backdrop.classList.contains('open')) {
      renderTabs(role);
      renderList(role);
    }
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
