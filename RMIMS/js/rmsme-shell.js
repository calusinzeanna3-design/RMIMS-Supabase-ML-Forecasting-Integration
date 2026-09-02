// RMIMS Universal Shell & Live Shared Notification System
// Standard header, sidebar, profile, and real-time notification engine across all Admin & User pages.

(function () {
  /* Cleanup Appearance Mode preference & attributes */
  try {
    localStorage.removeItem('rmims_theme_preference');
  } catch (e) {}
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-preference');

  const path = location.pathname.split('/').filter(Boolean);
  const role = path.includes('admin') ? 'admin' : 'user';
  const current = (path[path.length - 1] || '').toLowerCase();

  const icons = {
    dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    materials: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z"/><path d="M12 2v20M3 7l9 5 9-5"/></svg>',
    activity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M5 12h14M5 19h9"/><path d="m17 16 3 3-3 3"/></svg>',
    forecasting: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16"/><path d="M7 15l4-5 3 3 5-7"/></svg>',
    analytics: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
    reports: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 13h8M8 17h5"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 8.5a3 3 0 0 1 0 5.5M17 15c2 .7 3.5 2.3 3.5 5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19 13.5 2 1.5-2 3-2.5-.7c-.4.4-.9.7-1.4.9L14.5 21h-5l-.6-2.8c-.5-.2-1-.5-1.4-.9L5 18l-2-3 2-1.5a7 7 0 0 1 0-3L3 9l2-3 2.5.7c.4-.4.9-.7 1.4-.9L9.5 3h5l.6 2.8c.5.2 1 .5 1.4.9L19 6l2 3-2 1.5a7 7 0 0 1 0 3Z"/></svg>'
  };

  const items = [
    ['dashboard.html', 'Dashboard', 'dashboard'],
    ['inventory.html', 'Inventory', 'materials', 'material-group'],
    ['material-activity.html', 'Material Activity', 'activity', 'material-child'],
    ['analytics.html', 'Consumption Analytics', 'analytics'],
    ...(role === 'admin' ? [['forecasting.html', 'AI-Based Forecasting', 'forecasting']] : []),
    ['reports.html', 'Reports', 'reports'],
    ...(role === 'admin' ? [['user-management.html', 'User Management', 'users']] : []),
    ['settings.html', 'Settings', 'settings']
  ];

  function isActive(href) { return current === href.toLowerCase(); }

  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="rmsme-brand">
        <div class="rmsme-brand-mark"><img src="../assets/logo-icon.png" alt="RMSME"></div>
        <div class="rmsme-brand-copy"><strong>RMSME</strong><span>Raw Materials Inventory<br>Management System</span></div>
      </div>
      <nav class="rmsme-nav" aria-label="Primary navigation">
        ${items.map(([href, label, icon, type]) => type === 'material-group' ? `
          <button type="button" class="rmsme-nav-item rmsme-material-toggle" aria-expanded="false" title="Materials" aria-controls="rmsme-material-subnav">
            <span class="rmsme-nav-icon">${icons[icon]}</span><span class="rmsme-nav-label">Materials</span><span class="rmsme-nav-chevron">⌄</span>
          </button>
          <div class="rmsme-subnav" id="rmsme-material-subnav">
            <a class="rmsme-subitem ${isActive('inventory.html') ? 'active' : ''}" href="inventory.html"><span>Inventory</span></a>
            <a class="rmsme-subitem ${isActive('material-activity.html') ? 'active' : ''}" href="material-activity.html"><span>Material Activity</span></a>
          </div>` : type === 'material-child' ? '' : `
          <a class="rmsme-nav-item ${isActive(href) ? 'active' : ''}" href="${href}" title="${label}"><span class="rmsme-nav-icon">${icons[icon]}</span><span class="rmsme-nav-label">${label}</span></a>`).join('')}
      </nav>
      <div class="rmsme-side-account">
        <div class="rmsme-side-avatar" data-shell-avatar>A</div>
        <div class="rmsme-side-user"><strong data-shell-name>Account</strong><span>${role === 'admin' ? 'Administrator' : 'User'}</span></div>
        <span class="rmsme-side-arrow">›</span>
      </div>`;

    const toggle = sidebar.querySelector('.rmsme-material-toggle');
    const sub = sidebar.querySelector('.rmsme-subnav');
    const hasActiveMaterial = !!sidebar.querySelector('.rmsme-subitem.active');

    const setMaterialsOpen = (open) => {
      sidebar.classList.toggle('materials-open', open);
      toggle?.setAttribute('aria-expanded', String(open));
      if (sub) sub.setAttribute('aria-hidden', String(!open));
    };

    setMaterialsOpen(hasActiveMaterial);

    toggle?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isMobile = window.innerWidth <= 900;
      const isCollapsed = sidebar.classList.contains('collapsed') || sidebar.offsetWidth < 120;
      
      if (isCollapsed && !isMobile) {
        window.location.href = 'inventory.html';
        return;
      }

      setMaterialsOpen(!sidebar.classList.contains('materials-open'));
    });

    sidebar.querySelectorAll('.rmsme-subitem').forEach(link => {
      link.addEventListener('click', () => setMaterialsOpen(true));
    });
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    let url;
    try { url = new URL(href, location.href); } catch (e) { return; }
    if (url.origin !== location.origin) return;
    if (!/\.html(?:$|[?#])/.test(url.pathname)) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    const shell = link.closest('.sidebar,.rmsme-nav,.rmsme-popover');
    if (!shell) return;
    event.preventDefault();
    document.body.classList.add('rmsme-navigating');
    window.setTimeout(() => { location.href = url.href; }, 140);
  }, true);

  // Standardize topbar header across all pages
  const oldTopbar = document.querySelector('.topbar');
  if (oldTopbar) {
    const titleMap = {
      'dashboard.html': ['Dashboard', 'Overview of your raw materials and inventory activity.'],
      'inventory.html': ['Inventory Management', 'Manage your raw materials and current stock.'],
      'material-activity.html': ['Material Activity', 'Record and review raw-material movement.'],
      'analytics.html': ['Consumption Analytics', 'Understand how raw materials are being consumed.'],
      'forecasting.html': ['AI-Based Forecasting', 'Generate predictive raw-material requirements using the trained Time-Series model.'],
      'reports.html': ['Reports & Decision Support', 'View and generate inventory and consumption reports.'],
      'user-management.html': ['User Management', 'Manage system users and their access.'],
      'settings.html': ['Settings', 'Manage your account, system preferences, data, and security.']
    };
    const [title, subtitle] = titleMap[current] || ['RMSME', 'Raw Materials Inventory Management System'];
    oldTopbar.innerHTML = `
      <div style="display:flex; align-items:center; flex:1 1 auto; min-width:0; overflow:hidden;">
        <button class="rmsme-mobile-menu-btn" id="rmsmeMobileMenuBtn" aria-label="Toggle Navigation" title="Toggle Navigation">
          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <div class="rmsme-heading" style="flex:1 1 auto; min-width:0; overflow:hidden;"><h1>${title}</h1><p>${subtitle}</p></div>
      </div>
      <div class="rmsme-header-actions">
        <button class="rmsme-header-btn" id="rmsmeNotificationBtn" aria-label="Notifications" title="Notifications" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
          <span class="rmsme-notif-badge" id="rmsmeNotifBadge" style="display:none;">0</span>
        </button>
        <button class="rmsme-header-btn" id="rmsmeHelpBtn" aria-label="Help" title="Help" aria-expanded="false">?</button>
        <button class="rmsme-profile-btn" id="rmsmeProfileBtn" aria-expanded="false" title="Account Menu">
          <span class="rmsme-avatar" data-shell-avatar>A</span><span class="rmsme-profile-copy"><strong data-shell-name>Account</strong><small>${role === 'admin' ? 'Administrator' : 'User'}</small></span><span class="rmsme-chevron">⌄</span>
        </button>
        <div class="rmsme-popover rmsme-notifications" id="rmsmeNotifications" hidden>
          <div class="rmsme-popover-head"><strong>Notifications</strong><button type="button" id="rmsmeMarkAll">Mark all as read</button></div>
          <div id="rmsmeNotificationList"><div class="rmsme-empty">No new notifications.</div></div>
          <div class="rmsme-popover-foot"><button type="button" id="rmsmeViewNotifications">View all notifications →</button></div>
        </div>
        <div class="rmsme-popover rmsme-help" id="rmsmeHelp" hidden>
          <strong>Help & Information</strong>
          <button type="button" id="rmsmeSystemGuideBtn">📖 System User Guide</button>
          <button type="button" id="rmsmeAboutBtn">ℹ About RMIMS</button>
        </div>
        <div class="rmsme-popover rmsme-profile" id="rmsmeProfile" hidden>
          <div class="rmsme-profile-head"><span class="rmsme-avatar large" data-shell-avatar>A</span><div><strong data-shell-name>Account</strong><small>${role === 'admin' ? 'Administrator' : 'User'}</small><small data-shell-email></small></div></div>
          <a href="settings.html">My Account</a><a href="settings.html">Settings</a>
          <button type="button" id="rmsmeLogout">Log Out</button>
        </div>
      </div>`;

    // Mobile Navigation Drawer Controller
    const mobileMenuBtn = document.getElementById('rmsmeMobileMenuBtn');
    let drawerBackdrop = document.querySelector('.rmsme-mobile-drawer-backdrop');
    if (!drawerBackdrop) {
      drawerBackdrop = document.createElement('div');
      drawerBackdrop.className = 'rmsme-mobile-drawer-backdrop';
      document.body.appendChild(drawerBackdrop);
    }

    function toggleMobileDrawer(open) {
      const shouldOpen = open !== undefined ? open : !document.body.classList.contains('rmsme-mobile-drawer-open');
      document.body.classList.toggle('rmsme-mobile-drawer-open', shouldOpen);
    }

    mobileMenuBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMobileDrawer();
    });

    drawerBackdrop?.addEventListener('click', () => {
      toggleMobileDrawer(false);
    });

    sidebar?.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => toggleMobileDrawer(false));
    });
  }

  function initials(name) {
    const parts = String(name || 'Account').trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map(x => x[0]).join('') || 'A').toUpperCase();
  }

  function syncIdentity() {
    let name = role === 'admin' ? 'Admin' : 'Staff Member', email = '';
    try {
      const candidates = ['currentUser', 'rmimsCurrentUser', 'userProfile', 'user'];
      for (const k of candidates) {
        const raw = localStorage.getItem(k); if (!raw) continue;
        const o = JSON.parse(raw);
        if (o?.fullName || o?.name || o?.email) {
          name = o.fullName || o.name || name;
          email = o.email || email;
          break;
        }
      }
    } catch (e) { }
    const old = document.querySelector('.profile-text');
    if (old && old.textContent && !/loading/i.test(old.textContent) && old.textContent.trim() !== 'Staff Member') {
      name = old.textContent.replace(/\s+▼\s*$/, '').trim() || name;
    }
    document.querySelectorAll('[data-shell-name]').forEach(e => e.textContent = name);
    document.querySelectorAll('[data-shell-email]').forEach(e => e.textContent = email);
    document.querySelectorAll('[data-shell-avatar]').forEach(e => e.textContent = initials(name));
  }
  syncIdentity();
  setTimeout(syncIdentity, 600);

  const profileBtn = document.getElementById('rmsmeProfileBtn'), profile = document.getElementById('rmsmeProfile');
  const notifBtn = document.getElementById('rmsmeNotificationBtn'), notif = document.getElementById('rmsmeNotifications');
  const helpBtn = document.getElementById('rmsmeHelpBtn'), help = document.getElementById('rmsmeHelp');

  function closeMenus(except) {
    [profile, notif, help].forEach(x => {
      if (x && x !== except) x.hidden = true;
    });
    if (profileBtn && except !== profile) profileBtn.setAttribute('aria-expanded', 'false');
    if (notifBtn && except !== notif) notifBtn.setAttribute('aria-expanded', 'false');
    if (helpBtn && except !== help) helpBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu(menu, btn) {
    if (!menu) return;
    const willOpen = menu.hidden;
    closeMenus(menu);
    menu.hidden = !willOpen;
    if (btn) btn.setAttribute('aria-expanded', String(willOpen));
    if (menu === notif && willOpen) {
      renderNotifications();
      syncAuthoritativeNotifications();
    }
  }

  notifBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu(notif, notifBtn);
  });

  profileBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu(profile, profileBtn);
  });

  helpBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu(help, helpBtn);
  });

  // Close menus when clicking anywhere outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.rmsme-header-actions')) {
      closeMenus(null);
    }
  });

  document.getElementById('rmsmeLogout')?.addEventListener('click', async () => {
    // Preserve notification read state so read items stay read across sessions
    localStorage.removeItem('rmsmeCurrentUser');
    try {
      sessionStorage.removeItem("rmims_login_session_id");
      sessionStorage.removeItem("rmims_session_login_recorded");
      const { supabase } = await import('../supabase/supabase-config.js');
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("Sign out notice:", err);
    }
    const isUser = location.pathname.includes('/user/');
    location.href = isUser ? '../user-signin.html' : '../login.html';
  });

  // System Guide & About Modal
  function showHelpModal(title, bodyHtml) {
    let overlay = document.getElementById("rmsmeGuideModalOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "rmsmeGuideModalOverlay";
      overlay.className = "modal-overlay open";
      overlay.innerHTML = `
        <div class="modal-card" style="max-width:560px; padding:24px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
            <h3 id="rmsmeGuideModalTitle" style="font-size:1.15rem; font-weight:700; color:var(--ink);"></h3>
            <button type="button" id="rmsmeGuideModalClose" style="background:none; border:none; font-size:1.4rem; cursor:pointer; color:var(--text-soft);">&times;</button>
          </div>
          <div id="rmsmeGuideModalBody" style="font-size:.9rem; line-height:1.6; color:var(--text-body); max-height:65vh; overflow-y:auto;"></div>
          <div style="margin-top:20px; text-align:right;">
            <button type="button" id="rmsmeGuideModalOk" class="btn-primary" style="padding:8px 20px;">Got it</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.classList.remove("open");
      overlay.querySelector("#rmsmeGuideModalClose").addEventListener("click", close);
      overlay.querySelector("#rmsmeGuideModalOk").addEventListener("click", close);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    }
    overlay.querySelector("#rmsmeGuideModalTitle").textContent = title;
    overlay.querySelector("#rmsmeGuideModalBody").innerHTML = bodyHtml;
    overlay.classList.add("open");
  }

  document.getElementById("rmsmeSystemGuideBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenus(null);
    showHelpModal("RMIMS System User Guide", `
      <p style="margin-bottom:12px;">Welcome to the <strong>Raw Materials Inventory Management System (RMIMS)</strong>. Below is a quick overview of how to use each core section:</p>
      <ul style="padding-left:20px; margin-bottom:12px;">
        <li style="margin-bottom:8px;"><strong>Dashboard:</strong> View stock summaries, alert counts, and recent activity logs at a glance.</li>
        <li style="margin-bottom:8px;"><strong>Inventory Management:</strong> Manage raw material items, minimum thresholds, categories, and supplier details.</li>
        <li style="margin-bottom:8px;"><strong>Material Activity:</strong> Log raw materials received from suppliers or issued for finished product batches.</li>
        <li style="margin-bottom:8px;"><strong>Consumption Analytics:</strong> Monitor material usage trends, rankings, and historical consumption.</li>
        <li style="margin-bottom:8px;"><strong>Forecasting (Admin):</strong> Generate 7-day operational and 1-month planning forecasts based on recorded consumption patterns.</li>
        <li style="margin-bottom:8px;"><strong>Reports & Decision Support:</strong> Export structured PDF/Excel inventory and consumption reports.</li>
      </ul>
      <p>For additional assistance, contact your system administrator.</p>
    `);
  });

  document.getElementById("rmsmeAboutBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenus(null);
    showHelpModal("About RMIMS", `
      <p style="margin-bottom:12px;"><strong>Raw Materials Inventory Management System (RMIMS)</strong></p>
      <p style="margin-bottom:12px;">RMIMS is a raw materials management platform built for precision inventory tracking, consumption analytics, and decision support.</p>
      <p style="margin-bottom:8px;"><strong>Key Capabilities:</strong></p>
      <ul style="padding-left:20px; margin-bottom:12px;">
        <li>Automated stock status monitoring & alert notifications</li>
        <li>Predictive raw material requirement forecasting (7-day & 1-month horizons)</li>
        <li>Separation of units (kg, L, loaf) for data integrity</li>
        <li>Role-based access control (Administrator & User roles)</li>
      </ul>
      <p style="font-size:.82rem; color:var(--text-soft);">System Version 2.0 · Raw Materials Inventory Management System</p>
    `);
  });

  /* ==========================================================
     RMIMS LIVE SHARED NOTIFICATION SYSTEM (AUTHORITATIVE ENGINE)
     ========================================================== */

  const NOTIF_STORE_KEY = 'rmims_live_notifications';
  const NOTIF_READ_KEY = 'rmims_notifications_read';
  const NOTIF_STOCK_STATES_KEY = 'rmims_stock_states';
  const NOTIF_DAILY_REMINDER_KEY = 'rmims_last_daily_reminder';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getStoredNotifications() {
    try {
      const raw = localStorage.getItem(NOTIF_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Exclude any legacy mock items
          return parsed.filter(n => n && n.id && !n.id.startsWith('notif-sys-online-') && !n.id.startsWith('notif-stock-low-sugar-'));
        }
      }
    } catch (e) { }
    return [];
  }

  function saveStoredNotifications(list) {
    try {
      localStorage.setItem(NOTIF_STORE_KEY, JSON.stringify(list.slice(0, 100)));
    } catch (e) { }
  }

  function getReadStorageKey() {
    let uid = '';
    try {
      const u = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || localStorage.getItem('userProfile') || '{}');
      uid = u.id || u.email || '';
    } catch (e) {}
    return uid ? `rmims_notifications_read_${uid}` : NOTIF_READ_KEY;
  }

  function getReadSet() {
    try {
      const key = getReadStorageKey();
      const specific = JSON.parse(localStorage.getItem(key) || 'null');
      if (Array.isArray(specific) && specific.length > 0) {
        return new Set(specific);
      }
      return new Set(JSON.parse(localStorage.getItem(NOTIF_READ_KEY) || '[]'));
    } catch (e) {
      return new Set();
    }
  }

  function saveReadSet(set) {
    try {
      const arr = [...set];
      const key = getReadStorageKey();
      localStorage.setItem(key, JSON.stringify(arr));
      localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(arr));
    } catch (e) { }
  }

  function getVisibleNotifications() {
    const allNotifs = getStoredNotifications();
    let currentUserId = null;
    try {
      const u = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
      currentUserId = u.id || null;
    } catch (e) {}

    return allNotifs.filter(n => {
      if (!n || !n.id) return false;
      if (role === 'admin') return true;
      // User / Staff role filtering:
      if (n.roleScope === 'admin') return false;
      if (n.category === 'login' && n.userId && currentUserId && n.userId !== currentUserId) {
        return false;
      }
      return true;
    });
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return 'Just now';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Recently';

    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 45) return 'Just now';
    if (diffSec < 3600) {
      const m = Math.max(1, Math.floor(diffSec / 60));
      return m === 1 ? '1 minute ago' : `${m} minutes ago`;
    }
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (diffSec < 86400) {
      const isToday = now.getDate() === date.getDate() && now.getMonth() === date.getMonth() && now.getFullYear() === date.getFullYear();
      if (isToday) {
        const hours = Math.floor(diffSec / 3600);
        if (hours <= 6) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
        return `Today, ${timeStr}`;
      }
      return `Yesterday, ${timeStr}`;
    }
    if (diffSec < 172800) {
      return `Yesterday, ${timeStr}`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateTimeExact(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  function getPrioritySvg(priority) {
    switch (priority) {
      case 'success':
        return '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>';
      case 'warning':
        return '<svg viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17h.01"/></svg>';
      case 'critical':
        return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
      case 'info':
      default:
        return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>';
    }
  }

  // Render Topbar Dropdown & Unread Counter
  function renderNotifications() {
    const listEl = document.getElementById('rmsmeNotificationList');
    const badgeEl = document.getElementById('rmsmeNotifBadge');
    const legacyBadgeEl = document.getElementById('notifBadge');
    const visibleNotifs = getVisibleNotifications();
    const readSet = getReadSet();

    const unreadCount = visibleNotifs.filter(n => !readSet.has(String(n.id))).length;

    [badgeEl, legacyBadgeEl].forEach(b => {
      if (b) {
        if (unreadCount > 0) {
          b.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
          b.style.display = 'inline-flex';
          b.hidden = false;
        } else {
          b.textContent = '0';
          b.style.display = 'none';
          b.hidden = true;
        }
      }
    });

    if (!listEl) return;

    if (visibleNotifs.length === 0) {
      listEl.innerHTML = '<div class="rmsme-empty">No new notifications.</div>';
      return;
    }

    const top8 = visibleNotifs.slice(0, 8);
    listEl.innerHTML = '';

    top8.forEach((n) => {
      const isRead = readSet.has(String(n.id));
      const priorityClass = `priority-${n.priority || 'info'}`;
      const iconSvg = getPrioritySvg(n.priority);
      const timeStr = formatTimeAgo(n.timestamp);
      const exactTime = formatDateTimeExact(n.timestamp);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `rmsme-notification-item ${isRead ? 'read' : 'unread'}`;
      btn.setAttribute('title', `${exactTime} (${timeStr})`);
      btn.innerHTML = `
        <span class="rmsme-notif-icon ${priorityClass}">${iconSvg}</span>
        <div class="rmsme-notif-content">
          <div class="rmsme-notif-title-row">
            <span class="rmsme-notif-title">${escapeHtml(n.title || 'Notification')}</span>
            ${isRead ? '' : '<span class="rmsme-notif-badge-new">NEW</span>'}
          </div>
          <span class="rmsme-notif-desc">${escapeHtml(n.message || '')}</span>
          <div class="rmsme-notif-meta-row">
            <span class="rmsme-notif-actor">${escapeHtml(n.actor || 'Source: System')}</span>
            <span class="rmsme-notif-sep">•</span>
            <span class="rmsme-notif-time">${escapeHtml(timeStr)}</span>
          </div>
        </div>
      `;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        readSet.add(String(n.id));
        saveReadSet(readSet);
        renderNotifications();
        if (document.getElementById("rmsmeAllNotificationsOverlay")?.classList.contains("open")) {
          renderModalList();
        }
      });

      listEl.appendChild(btn);
    });
  }

  // Mark all notifications as read
  document.getElementById('rmsmeMarkAll')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const visibleNotifs = getVisibleNotifications();
    const readSet = getReadSet();
    visibleNotifs.forEach(n => readSet.add(String(n.id)));
    saveReadSet(readSet);
    renderNotifications();
    if (document.getElementById("rmsmeAllNotificationsOverlay")?.classList.contains("open")) {
      renderModalList();
    }
  });

  // Cross-tab synchronization
  window.addEventListener('storage', (e) => {
    if (e.key === NOTIF_STORE_KEY || e.key === NOTIF_READ_KEY) {
      renderNotifications();
      if (document.getElementById("rmsmeAllNotificationsOverlay")?.classList.contains("open")) {
        renderModalList();
      }
    }
  });

  /* ==========================================================
     AUTHORITATIVE DATA INGESTION & EVENT SYNC
     ========================================================== */

  let isSyncing = false;

  async function syncAuthoritativeNotifications() {
    if (isSyncing) return;
    isSyncing = true;

    try {
      const { supabase } = await import('../supabase/supabase-config.js');
      if (!supabase) return;

      // 1. Fetch live operational data from Supabase
      const [matRes, rcvRes, disbRes, userRes] = await Promise.all([
        supabase.from('raw_materials').select('id, name, item_code, current_stock, minimum_threshold, unit_of_measure, updated_at'),
        supabase.from('stock_receipts').select('id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at').order('created_at', { ascending: false }).limit(30),
        supabase.from('material_disbursements').select('id, usage_date, material_id, consumed_quantity, unit, finished_product_name, recorded_by, created_at').order('created_at', { ascending: false }).limit(30),
        supabase.from('user_profiles').select('id, full_name, email, role, status, created_at').order('created_at', { ascending: false }).limit(20)
      ]);

      const materials = matRes.data || [];
      const receipts = rcvRes.data || [];
      const disbursements = disbRes.data || [];
      const profiles = userRes.data || [];

      // Build quick lookup maps
      const userMap = new Map();
      profiles.forEach(p => {
        userMap.set(p.id, {
          name: p.full_name || p.email || (p.role === 'admin' ? 'Administrator' : 'Staff User'),
          role: p.role === 'admin' ? 'Administrator' : 'Staff User'
        });
      });

      const matMap = new Map();
      materials.forEach(m => matMap.set(m.id, m));

      const newNotifMap = new Map();

      // Load existing stored notifications to preserve history
      const existingList = getStoredNotifications();
      existingList.forEach(n => {
        if (n && n.id) newNotifMap.set(String(n.id), n);
      });

      // A. Inflow Notifications (Material Received)
      receipts.forEach(r => {
        const mat = matMap.get(r.material_id);
        const matName = mat ? mat.name : 'Raw Material';
        const actorProfile = r.received_by ? userMap.get(r.received_by) : null;
        const actorLabel = actorProfile ? `Added by: ${actorProfile.name}` : (r.received_by ? `Added by: ${r.received_by}` : 'Source: System');
        const eventId = `notif-receipt-${r.id}`;

        newNotifMap.set(eventId, {
          id: eventId,
          category: 'receiving',
          priority: 'success',
          title: 'Material Received',
          message: `${matName} received: ${r.received_quantity} ${r.unit || 'units'}.`,
          actor: actorLabel,
          material: matName,
          timestamp: r.created_at || (r.receipt_date ? `${r.receipt_date}T12:00:00Z` : new Date().toISOString())
        });
      });

      // B. Outflow Notifications (Material Disbursed)
      disbursements.forEach(d => {
        const mat = matMap.get(d.material_id);
        const matName = mat ? mat.name : 'Raw Material';
        const actorProfile = d.recorded_by ? userMap.get(d.recorded_by) : null;
        const actorLabel = actorProfile ? `Added by: ${actorProfile.name}` : (d.recorded_by ? `Added by: ${d.recorded_by}` : 'Source: System');
        const eventId = `notif-disbursement-${d.id}`;
        const prodContext = d.finished_product_name ? ` (for ${d.finished_product_name})` : '';

        newNotifMap.set(eventId, {
          id: eventId,
          category: 'disbursement',
          priority: 'info',
          title: 'Material Disbursed',
          message: `${matName} disbursed: ${d.consumed_quantity} ${d.unit || 'units'}${prodContext}.`,
          actor: actorLabel,
          material: matName,
          timestamp: d.created_at || (d.usage_date ? `${d.usage_date}T12:00:00Z` : new Date().toISOString())
        });
      });

      // C. Stock Status Transition Alerts
      let prevStates = {};
      try {
        prevStates = JSON.parse(localStorage.getItem(NOTIF_STOCK_STATES_KEY) || '{}');
      } catch (e) { }

      const currStates = {};
      const todayISO = new Date().toISOString().slice(0, 10);

      materials.forEach(m => {
        const stock = Number(m.current_stock || 0);
        const minThresh = m.minimum_threshold !== null ? Number(m.minimum_threshold) : 0;
        const dateSuffix = m.updated_at ? m.updated_at.slice(0, 10) : todayISO;
        let currStatus = 'good';

        if (stock <= 0) {
          currStatus = 'zero';
        } else if (minThresh > 0 && stock <= minThresh) {
          currStatus = 'low';
        }

        currStates[m.id] = currStatus;
        const prevStatus = prevStates[m.id];

        if (currStatus === 'zero') {
          const alertId = `notif-stock-zero-${m.id}-${dateSuffix}`;
          newNotifMap.set(alertId, {
            id: alertId,
            category: 'alert',
            priority: 'critical',
            title: 'Out of Stock Alert',
            message: `${m.name} is currently out of stock.`,
            actor: 'Source: System',
            material: m.name,
            timestamp: m.updated_at || new Date().toISOString()
          });
        } else if (currStatus === 'low') {
          const alertId = `notif-stock-low-${m.id}-${dateSuffix}`;
          newNotifMap.set(alertId, {
            id: alertId,
            category: 'alert',
            priority: 'warning',
            title: 'Low Stock Alert',
            message: `${m.name} is below its minimum stock threshold.`,
            actor: 'Source: System',
            material: m.name,
            timestamp: m.updated_at || new Date().toISOString()
          });
        } else if (currStatus === 'good' && (prevStatus === 'low' || prevStatus === 'zero')) {
          const alertId = `notif-stock-restored-${m.id}-${dateSuffix}`;
          newNotifMap.set(alertId, {
            id: alertId,
            category: 'inventory',
            priority: 'success',
            title: 'Stock Restored',
            message: `${m.name} has returned to a healthy stock level.`,
            actor: 'Source: System',
            material: m.name,
            timestamp: m.updated_at || new Date().toISOString()
          });
        }
      });

      localStorage.setItem(NOTIF_STOCK_STATES_KEY, JSON.stringify(currStates));

      // D. Controlled Daily Forecast Reminder (Strictly 1 per calendar day)
      const lastDaily = localStorage.getItem(NOTIF_DAILY_REMINDER_KEY);
      const reminderId = `notif-daily-forecast-${todayISO}`;
      if (lastDaily !== todayISO || !newNotifMap.has(reminderId)) {
        newNotifMap.set(reminderId, {
          id: reminderId,
          category: 'forecast',
          priority: 'info',
          title: 'Daily Forecast Review',
          message: 'Review the latest AI-based raw-material forecast for current operational requirements.',
          actor: 'Source: AI Forecasting',
          timestamp: `${todayISO}T08:00:00.000Z`
        });
        localStorage.setItem(NOTIF_DAILY_REMINDER_KEY, todayISO);
      }

      // E. Live AI Forecast Ready State
      try {
        const cachedFcRaw = localStorage.getItem('rmims_latest_forecast') || localStorage.getItem('rmims_forecast_timestamp');
        if (cachedFcRaw) {
          let fcDate = todayISO;
          let fcTimestamp = new Date().toISOString();
          let attnMsg = 'The latest predictive raw-material forecast is available for review.';
          if (cachedFcRaw.startsWith('{')) {
            const fcObj = JSON.parse(cachedFcRaw);
            fcDate = fcObj.generatedDate || todayISO;
            fcTimestamp = fcObj.generatedAt || fcTimestamp;
            if (fcObj.attentionCount > 0) {
              attnMsg = `The latest forecast identified ${fcObj.attentionCount} raw materials requiring replenishment attention.`;
            }
          } else {
            fcDate = cachedFcRaw.slice(0, 10);
            fcTimestamp = cachedFcRaw;
          }

          const fcId = `notif-forecast-ready-${fcDate}`;
          newNotifMap.set(fcId, {
            id: fcId,
            category: 'forecast',
            priority: 'success',
            title: 'AI Forecast Ready',
            message: attnMsg,
            actor: 'Source: AI Forecasting',
            timestamp: fcTimestamp
          });
        }
      } catch (e) { }

      // F. Login Session Notification (Once per authenticated login session)
      const sessionId = sessionStorage.getItem('rmims_login_session_id') || `session-${todayISO}`;
      sessionStorage.setItem('rmims_login_session_id', sessionId);

      if (!sessionStorage.getItem('rmims_session_login_recorded')) {
        sessionStorage.setItem('rmims_session_login_recorded', 'true');
        let accountName = role === 'admin' ? 'Administrator' : 'Staff User';
        let currentUserId = null;
        try {
          const raw = localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || localStorage.getItem('userProfile');
          if (raw) {
            const parsed = JSON.parse(raw);
            accountName = parsed.fullName || parsed.name || accountName;
            currentUserId = parsed.id || null;
          }
        } catch (e) { }

        const loginId = `notif-login-${sessionId}`;
        const loginNotif = {
          id: loginId,
          category: 'login',
          priority: 'info',
          title: `${accountName} Signed In`,
          message: `${role === 'admin' ? 'Administrator' : 'Staff'} account login detected.`,
          actor: 'Source: System',
          userId: currentUserId,
          roleScope: role,
          timestamp: new Date().toISOString()
        };
        newNotifMap.set(loginId, loginNotif);

        // Broadcast sign-in event live to connected Admin sessions
        try {
          if (window.__rmimsRealtimeChannel) {
            window.__rmimsRealtimeChannel.send({
              type: 'broadcast',
              event: 'user_login',
              payload: {
                accountName,
                role,
                userId: currentUserId,
                timestamp: loginNotif.timestamp
              }
            });
          }
        } catch (_) { }
      }

      // G. User Account Creation Notifications
      profiles.forEach(p => {
        if (p && p.created_at) {
          const userNotifId = `notif-user-reg-${p.id}`;
          newNotifMap.set(userNotifId, {
            id: userNotifId,
            category: 'user',
            priority: 'info',
            title: `User Account: ${p.full_name || p.email}`,
            message: `Account registered as ${p.role === 'admin' ? 'Administrator' : 'Staff User'} (${p.status === 'active' ? 'Active' : 'Inactive'}).`,
            actor: 'Source: User Management',
            roleScope: 'admin',
            timestamp: p.created_at
          });
        }
      });

      // Merge and sort: strictly NEWEST → OLDEST
      const mergedList = Array.from(newNotifMap.values()).sort((a, b) => {
        const tA = new Date(a.timestamp).getTime() || 0;
        const tB = new Date(b.timestamp).getTime() || 0;
        return tB - tA;
      });

      saveStoredNotifications(mergedList);
      renderNotifications();
      if (document.getElementById("rmsmeAllNotificationsOverlay")?.classList.contains("open")) {
        renderModalList();
      }

      // Managed Supabase Realtime Subscription (Single instance per page with clean unload)
      if (!window.__rmimsRealtimeChannel) {
        window.__rmimsRealtimeChannel = supabase
          .channel('rmims_shared_notifications')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_receipts' }, () => syncAuthoritativeNotifications())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'material_disbursements' }, () => syncAuthoritativeNotifications())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_materials' }, () => syncAuthoritativeNotifications())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'user_profiles' }, () => syncAuthoritativeNotifications())
          .on('broadcast', { event: 'user_login' }, payload => {
            if (payload?.payload) {
              const p = payload.payload;
              const loginId = `notif-login-live-${p.userId || 'usr'}-${new Date(p.timestamp || Date.now()).getTime()}`;
              const stored = getStoredNotifications();
              if (!stored.some(n => n.id === loginId)) {
                stored.unshift({
                  id: loginId,
                  category: 'login',
                  priority: 'info',
                  title: `${p.accountName} Signed In`,
                  message: `${p.role === 'admin' ? 'Administrator' : 'Staff'} account login detected.`,
                  actor: 'Source: System',
                  userId: p.userId,
                  roleScope: p.role,
                  timestamp: p.timestamp || new Date().toISOString()
                });
                saveStoredNotifications(stored);
                renderNotifications();
              }
            }
          })
          .subscribe();

        window.addEventListener('beforeunload', () => {
          if (window.__rmimsRealtimeChannel) {
            supabase.removeChannel(window.__rmimsRealtimeChannel);
            window.__rmimsRealtimeChannel = null;
          }
        });
      }
    } catch (err) {
      console.warn("Authoritative notification sync notice:", err);
    } finally {
      isSyncing = false;
    }
  }

  // Global Notification helper for direct system actions
  window.RMIMS_NOTIFICATIONS = {
    sync: syncAuthoritativeNotifications,
    render: renderNotifications,
    addNotification: function(notif) {
      if (!notif) return;
      const stored = getStoredNotifications();
      const id = notif.id || `notif-user-act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      if (!stored.some(n => n.id === id)) {
        stored.unshift({
          id: id,
          category: notif.category || 'user',
          priority: notif.priority || 'info',
          title: notif.title || 'System Notification',
          message: notif.message || '',
          actor: notif.actor || 'Source: System',
          roleScope: notif.roleScope || 'admin',
          timestamp: notif.timestamp || new Date().toISOString()
        });
        saveStoredNotifications(stored);
        renderNotifications();
        if (document.getElementById("rmsmeAllNotificationsOverlay")?.classList.contains("open")) {
          renderModalList();
        }
      }
    }
  };

  // Initial render & sync
  renderNotifications();
  setTimeout(syncAuthoritativeNotifications, 200);

  /* ==========================================================
     "VIEW ALL NOTIFICATIONS" MODAL
     ========================================================== */

  let activeCategoryFilter = 'all';
  let searchQuery = '';
  let currentPage = 1;
  const ITEMS_PER_PAGE = 8;

  function showAllNotificationsModal() {
    let overlay = document.getElementById("rmsmeAllNotificationsOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "rmsmeAllNotificationsOverlay";
      overlay.className = "rmsme-all-notifs-overlay";
      overlay.innerHTML = `
        <div class="rmsme-all-notifs-card" role="dialog" aria-modal="true" aria-labelledby="rmsmeModalTitle">
          <div class="rmsme-all-notifs-header">
            <div class="rmsme-all-notifs-title-wrap">
              <h3 class="rmsme-all-notifs-title" id="rmsmeModalTitle">Notifications</h3>
              <span class="rmsme-all-notifs-count-pill" id="rmsmeModalUnreadPill">0 unread</span>
            </div>
            <div class="rmsme-all-notifs-actions">
              <button type="button" class="rmsme-btn-link-action" id="rmsmeModalMarkAllBtn">Mark all as read</button>
              <button type="button" class="rmsme-modal-close-btn" id="rmsmeModalCloseBtn" aria-label="Close dialog">✕</button>
            </div>
          </div>

          <div class="rmsme-all-notifs-toolbar">
            <div class="rmsme-notifs-search-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input type="text" class="rmsme-notifs-search-input" id="rmsmeModalSearchInput" placeholder="Search notifications, materials, or actors..."/>
            </div>
            <div class="rmsme-notifs-filter-pills" id="rmsmeFilterPills">
              <button type="button" class="rmsme-filter-pill active" data-cat="all">All</button>
              <button type="button" class="rmsme-filter-pill" data-cat="unread">Unread</button>
              <button type="button" class="rmsme-filter-pill" data-cat="receiving">Receiving</button>
              <button type="button" class="rmsme-filter-pill" data-cat="disbursement">Disbursement</button>
              <button type="button" class="rmsme-filter-pill" data-cat="alert">Stock Alerts</button>
              <button type="button" class="rmsme-filter-pill" data-cat="forecast">Forecast</button>
              <button type="button" class="rmsme-filter-pill" data-cat="inventory">Inventory</button>
              <button type="button" class="rmsme-filter-pill" data-cat="login">Login</button>
            </div>
          </div>

          <div class="rmsme-all-notifs-body" id="rmsmeModalNotifsList">
            <!-- Populated via JS -->
          </div>

          <div class="rmsme-all-notifs-footer">
            <span id="rmsmeModalPageInfo">Showing 0 of 0</span>
            <div class="rmsme-notifs-pagination">
              <button type="button" class="rmsme-page-btn" id="rmsmeModalPrevPage" disabled>Previous</button>
              <button type="button" class="rmsme-page-btn" id="rmsmeModalNextPage" disabled>Next</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const closeModal = () => {
        overlay.classList.remove("open");
      };

      overlay.querySelector("#rmsmeModalCloseBtn").addEventListener("click", closeModal);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && overlay.classList.contains("open")) closeModal();
      });

      overlay.querySelector("#rmsmeModalMarkAllBtn").addEventListener("click", () => {
        const visibleNotifs = getVisibleNotifications();
        const readSet = getReadSet();
        visibleNotifs.forEach(n => readSet.add(String(n.id)));
        saveReadSet(readSet);
        renderNotifications();
        renderModalList();
      });

      overlay.querySelector("#rmsmeModalSearchInput").addEventListener("input", (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        currentPage = 1;
        renderModalList();
      });

      overlay.querySelector("#rmsmeFilterPills").addEventListener("click", (e) => {
        const pill = e.target.closest(".rmsme-filter-pill");
        if (!pill) return;
        overlay.querySelectorAll(".rmsme-filter-pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        activeCategoryFilter = pill.dataset.cat || 'all';
        currentPage = 1;
        renderModalList();
      });

      overlay.querySelector("#rmsmeModalPrevPage").addEventListener("click", () => {
        if (currentPage > 1) {
          currentPage--;
          renderModalList();
        }
      });

      overlay.querySelector("#rmsmeModalNextPage").addEventListener("click", () => {
        currentPage++;
        renderModalList();
      });
    }

    renderModalList();
    overlay.classList.add("open");
  }

  function renderModalList() {
    const listEl = document.getElementById("rmsmeModalNotifsList");
    const unreadPill = document.getElementById("rmsmeModalUnreadPill");
    const pageInfo = document.getElementById("rmsmeModalPageInfo");
    const prevBtn = document.getElementById("rmsmeModalPrevPage");
    const nextBtn = document.getElementById("rmsmeModalNextPage");

    if (!listEl) return;

    const visibleNotifs = getVisibleNotifications();
    const readSet = getReadSet();
    const unreadCount = visibleNotifs.filter(n => !readSet.has(String(n.id))).length;

    if (unreadPill) unreadPill.textContent = `${unreadCount} unread`;

    // Filter by category & search
    let filtered = visibleNotifs.filter(n => {
      const isUnread = !readSet.has(String(n.id));

      if (activeCategoryFilter === 'unread') {
        if (!isUnread) return false;
      } else if (activeCategoryFilter !== 'all') {
        if (n.category !== activeCategoryFilter) return false;
      }

      if (searchQuery) {
        const text = `${n.title || ''} ${n.message || ''} ${n.actor || ''} ${n.category || ''} ${n.material || ''}`.toLowerCase();
        if (!text.includes(searchQuery)) return false;
      }

      return true;
    });

    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;

    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageItems = filtered.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    if (pageInfo) {
      pageInfo.textContent = totalCount === 0
        ? 'Showing 0 notifications'
        : `Showing ${startIdx + 1}–${Math.min(startIdx + ITEMS_PER_PAGE, totalCount)} of ${totalCount} notifications`;
    }

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

    if (pageItems.length === 0) {
      listEl.innerHTML = '<div class="rmsme-empty" style="padding:40px 20px;">No notifications matching your criteria.</div>';
      return;
    }

    listEl.innerHTML = '';

    pageItems.forEach(n => {
      const isRead = readSet.has(String(n.id));
      const priorityClass = `priority-${n.priority || 'info'}`;
      const iconSvg = getPrioritySvg(n.priority);
      const catClass = `cat-${n.category || 'system'}`;
      const exactTime = formatDateTimeExact(n.timestamp);
      const relativeTime = formatTimeAgo(n.timestamp);

      const itemEl = document.createElement("div");
      itemEl.className = `rmsme-modal-notif-item ${isRead ? 'read' : 'unread'}`;
      itemEl.innerHTML = `
        <span class="rmsme-notif-icon ${priorityClass}" style="width:32px; height:32px; border-radius:8px;">${iconSvg}</span>
        <div class="rmsme-modal-notif-body">
          <div class="rmsme-modal-notif-header-row">
            <div class="rmsme-modal-notif-title">
              <span>${escapeHtml(n.title || 'Notification')}</span>
              <span class="rmsme-category-badge ${catClass}">${escapeHtml(n.category || 'System')}</span>
            </div>
            ${isRead ? '<span style="font-size:0.72rem; color:#94a3b8;">Read</span>' : '<button type="button" class="rmsme-btn-link-action mark-item-read-btn" style="font-size:0.72rem;">Mark as read</button>'}
          </div>
          <div class="rmsme-modal-notif-desc">${escapeHtml(n.message || '')}</div>
          <div class="rmsme-modal-notif-footer-row">
            <span style="font-weight:600; color:#475569;">${escapeHtml(n.actor || 'Source: System')}</span>
            <span>${escapeHtml(exactTime)} (${escapeHtml(relativeTime)})</span>
          </div>
        </div>
      `;

      const readBtn = itemEl.querySelector(".mark-item-read-btn");
      if (readBtn) {
        readBtn.addEventListener("click", () => {
          readSet.add(String(n.id));
          saveReadSet(readSet);
          renderNotifications();
          renderModalList();
        });
      }

      listEl.appendChild(itemEl);
    });
  }

  // Hook "View all notifications →" click
  document.getElementById('rmsmeViewNotifications')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenus(null);
    showAllNotificationsModal();
  });

  // Global helper API
  window.RMIMS_NOTIFICATIONS = {
    sync: syncAuthoritativeNotifications,
    render: renderNotifications,
    openModal: showAllNotificationsModal,
    markAllAsRead: () => {
      const visibleNotifs = getVisibleNotifications();
      const readSet = getReadSet();
      visibleNotifs.forEach(n => readSet.add(String(n.id)));
      saveReadSet(readSet);
      renderNotifications();
    },
    push: (n) => {
      const data = getStoredNotifications();
      const id = n.id || `notif-manual-${Date.now()}`;
      data.unshift({ ...n, id, timestamp: n.timestamp || new Date().toISOString() });
      saveStoredNotifications(data);
      renderNotifications();
    }
  };

  window.RMSME = window.RMSME || {};
  window.RMSME.pushNotification = window.RMIMS_NOTIFICATIONS.push;

  // ==========================================================
  // RMIMS MODERN CUSTOM SELECT / DROPDOWN ENGINE
  // ==========================================================
  function getOptionDecorator(val, text) {
    const v = (val || '').toLowerCase().trim();
    const t = (text || '').toLowerCase().trim();

    // Activity filter
    if (v === 'all' && (t.includes('activity') || t.includes('status: all') || t === 'all')) {
      return `<span class="rm-opt-icon-wrap rm-icon-all"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg></span>`;
    }
    if (v === 'receive' || t.includes('receive')) {
      return `<span class="rm-opt-icon-wrap rm-badge-receive"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg></span>`;
    }
    if (v === 'disbursement' || v === 'disburse' || t.includes('disburse')) {
      return `<span class="rm-opt-icon-wrap rm-badge-disburse"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20V8m0 0l-4 4m4-4l4 4M4 4h16"/></svg></span>`;
    }

    // Stock status dots
    if (v === 'in_stock' || (t.includes('in stock') && !t.includes('out') && !t.includes('low'))) {
      return `<span class="rm-status-dot rm-dot-green"></span>`;
    }
    if (v === 'low_stock' || t.includes('low stock')) {
      return `<span class="rm-status-dot rm-dot-amber"></span>`;
    }
    if (v === 'out_of_stock' || t.includes('out of stock')) {
      return `<span class="rm-status-dot rm-dot-red"></span>`;
    }

    // Sort icons
    if (v === 'latest' || t.includes('latest')) {
      return `<span class="rm-opt-icon-wrap rm-icon-all"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></span>`;
    }
    if (v === 'oldest' || t.includes('oldest')) {
      return `<span class="rm-opt-icon-wrap rm-icon-all"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg></span>`;
    }
    if (v === 'az' || t.includes('a–z') || t.includes('a-z') || t.includes('a to z')) {
      return `<span class="rm-opt-icon-wrap rm-icon-all"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h4l-4 8h4M7 4l4 4-4 4M14 4h7M14 9h5M14 14h3M14 19h1"/></svg></span>`;
    }
    if (v === 'za' || t.includes('z–a') || t.includes('z-a') || t.includes('z to a')) {
      return `<span class="rm-opt-icon-wrap rm-icon-all"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16H3l4-8H3M7 20l4-4-4-4M14 4h1M14 9h3M14 14h5M14 19h7"/></svg></span>`;
    }

    return '';
  }

  function enhanceCustomSelect(select) {
    if (!select || select.dataset.customEnhanced === 'true') return;
    if (select.classList.contains('inv-select-sm') && !select.classList.contains('enhance-sm')) {
      return;
    }

    select.dataset.customEnhanced = 'true';
    select.classList.add('rmims-native-select-hidden');

    const wrapper = document.createElement('div');
    wrapper.className = 'rm-custom-select';
    if (select.id) wrapper.dataset.selectId = select.id;
    if (select.className) {
      const customClasses = select.className
        .split(' ')
        .filter(c => c !== 'inv-select' && c !== 'rmims-native-select-hidden')
        .join(' ');
      if (customClasses) wrapper.className += ' ' + customClasses;
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'rm-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (select.title) trigger.title = select.title;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'rm-select-value';

    const chevronSvg = `
      <svg class="rm-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 9l6 6 6-6"/>
      </svg>`;

    trigger.appendChild(valueSpan);
    trigger.insertAdjacentHTML('beforeend', chevronSvg);

    const menu = document.createElement('div');
    menu.className = 'rm-select-menu';
    menu.setAttribute('role', 'listbox');

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    select.parentNode.insertBefore(wrapper, select.nextSibling);

    let isUpdating = false;

    function renderOptions() {
      menu.innerHTML = '';
      const options = Array.from(select.options);
      let selectedOption = options.find(o => o.value === select.value) || options[0];

      options.forEach(opt => {
        const isSelected = opt === selectedOption;
        const optEl = document.createElement('div');
        optEl.className = `rm-select-option ${isSelected ? 'selected' : ''}`;
        optEl.setAttribute('role', 'option');
        optEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        optEl.dataset.value = opt.value;

        const decorator = getOptionDecorator(opt.value, opt.textContent);
        optEl.innerHTML = `
          <div class="rm-opt-content">
            ${decorator}
            <span class="rm-opt-label">${opt.textContent}</span>
          </div>
          <svg class="rm-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;

        optEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (select.value !== opt.value) {
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.dispatchEvent(new Event('input', { bubbles: true }));
          }
          syncUI();
          closeMenu();
        });

        menu.appendChild(optEl);
      });

      syncUI();
    }

    function syncUI() {
      if (isUpdating) return;
      isUpdating = true;
      try {
        const options = Array.from(select.options);
        const selectedOption = options.find(o => o.value === select.value) || options[0];
        if (selectedOption) {
          const dec = getOptionDecorator(selectedOption.value, selectedOption.textContent);
          valueSpan.innerHTML = `${dec}<span>${selectedOption.textContent}</span>`;

          const allOptEls = menu.querySelectorAll('.rm-select-option');
          allOptEls.forEach(el => {
            const isMatch = el.dataset.value === selectedOption.value;
            el.classList.toggle('selected', isMatch);
            el.setAttribute('aria-selected', isMatch ? 'true' : 'false');
          });
        }
      } finally {
        isUpdating = false;
      }
    }

    function openMenu() {
      document.querySelectorAll('.rm-custom-select.open').forEach(el => {
        if (el !== wrapper) {
          el.classList.remove('open');
          el.querySelector('.rm-select-trigger')?.setAttribute('aria-expanded', 'false');
        }
      });

      wrapper.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');

      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - 12) {
        menu.classList.add('align-right');
      } else {
        menu.classList.remove('align-right');
      }
    }

    function closeMenu() {
      wrapper.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (wrapper.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    try {
      const proto = HTMLSelectElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) {
        Object.defineProperty(select, 'value', {
          get() {
            return desc.get.call(this);
          },
          set(v) {
            desc.set.call(this, v);
            syncUI();
          },
          configurable: true
        });
      }
    } catch (err) {}

    select.addEventListener('change', syncUI);
    select.addEventListener('input', syncUI);

    const observer = new MutationObserver(() => {
      renderOptions();
    });
    observer.observe(select, { childList: true, subtree: true, attributes: true });

    renderOptions();
  }

  function initAllCustomSelects() {
    const targetSelects = document.querySelectorAll(
      'select.inv-select, #invActivityStatusFilter, #invStatusFilter, #invSortFilter, #fpcSortSelect, #historyActivityFilter, #historySortSelect, #productSortSelect, #materialSortSelect, select[data-custom-select="true"]'
    );
    targetSelects.forEach(sel => {
      enhanceCustomSelect(sel);
    });
  }

  // Global listeners for closing dropdowns
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.rm-custom-select')) {
      document.querySelectorAll('.rm-custom-select.open').forEach(el => {
        el.classList.remove('open');
        el.querySelector('.rm-select-trigger')?.setAttribute('aria-expanded', 'false');
      });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.rm-custom-select.open').forEach(el => {
        el.classList.remove('open');
        el.querySelector('.rm-select-trigger')?.setAttribute('aria-expanded', 'false');
      });
    }
  });

  // Auto initialize on load and DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllCustomSelects);
  } else {
    initAllCustomSelects();
  }
  window.addEventListener('load', initAllCustomSelects);
  setTimeout(initAllCustomSelects, 300);

  window.RMIMS_CUSTOM_SELECT = {
    init: initAllCustomSelects,
    enhance: enhanceCustomSelect
  };

})();

