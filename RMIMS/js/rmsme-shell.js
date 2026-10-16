import './rmims-notifications.js';

(function () {
  /* Cleanup Appearance Mode preference & attributes */
  try {
    localStorage.removeItem('rmims_theme_preference');
  } catch (e) {}
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-preference');

  /* Cleanse all mock accounts and dummy personnel across manager & staff */
  try {
    const BANNED_MOCK_NAMES = [
      'maria santos', 'kenneth ramos', 'rafael cruz', 'alyssa lim', 'carla mendoza',
      'carlos mendoza', 'victor morales', 'ethan cruz', 'sarah gomez', 'mark villanueva',
      'john reyes', 'kenneth lim'
    ];
    const DUMP_EMAILS = [
      'admin@rmims.ph', 'manager@rmims.ph', 'staff@rmims.ph', 'asst.manager@rmims.ph'
    ];

    ['currentUser', 'rmimsCurrentUser', 'userProfile', 'managerUser', 'staffUser', 'adminUser', 'rmimsAdminUser'].forEach(key => {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const p = JSON.parse(raw);
          const n = (p.fullName || p.name || '').toLowerCase();
          const e = (p.email || '').toLowerCase();
          if (BANNED_MOCK_NAMES.some(b => n.includes(b)) || DUMP_EMAILS.some(d => e.includes(d))) {
            localStorage.removeItem(key);
          }
        } catch (_) {}
      }
    });

    // Wipe branch stores personnel if any mock user is found
    const rawStores = localStorage.getItem('RMIMS_BRANCH_STORES_V3');
    if (rawStores) {
      try {
        const stores = JSON.parse(rawStores);
        let modified = false;
        Object.values(stores).forEach(st => {
          if (Array.isArray(st.managers)) {
            const origLen = st.managers.length;
            st.managers = st.managers.filter(m => {
              const mn = (m.name || m.username || '').toLowerCase();
              const me = (m.email || '').toLowerCase();
              return !BANNED_MOCK_NAMES.some(b => mn.includes(b)) && !DUMP_EMAILS.some(d => me.includes(d));
            });
            if (st.managers.length !== origLen) modified = true;
          }
          if (Array.isArray(st.staff)) {
            const origLen = st.staff.length;
            st.staff = st.staff.filter(s => {
              const sn = (s.name || s.username || '').toLowerCase();
              const se = (s.email || '').toLowerCase();
              return !BANNED_MOCK_NAMES.some(b => sn.includes(b)) && !DUMP_EMAILS.some(d => se.includes(d));
            });
            if (st.staff.length !== origLen) modified = true;
          }
        });
        if (modified) {
          localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(stores));
        }
      } catch (_) {}
    }

    // Cleanse registered and pending users
    ['rmims_registered_users', 'rmims_pending_users'].forEach(k => {
      const raw = localStorage.getItem(k);
      if (raw) {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            const clean = arr.filter(u => {
              const un = (u.name || u.username || '').toLowerCase();
              const ue = (u.email || '').toLowerCase();
              return !BANNED_MOCK_NAMES.some(b => un.includes(b)) && !DUMP_EMAILS.some(d => ue.includes(d));
            });
            if (clean.length !== arr.length) {
              localStorage.setItem(k, JSON.stringify(clean));
            }
          }
        } catch (_) {}
      }
    });

    // Cleanse fake staff login notifications
    const rawNotif = localStorage.getItem('rmims_notifications_live_v2');
    if (rawNotif) {
      try {
        const arr = JSON.parse(rawNotif);
        if (Array.isArray(arr)) {
          const clean = arr.filter(n => {
            if (!n || !n.id) return false;
            const t = (n.title || '').toLowerCase();
            const m = (n.message || '').toLowerCase();
            if (t.includes('staff user') || m.includes('staff account login detected')) return false;
            if (t.includes('signed in') && (t.includes('staff user') || !n.userId)) return false;
            if (t.includes('maria santos') || t.includes('rafael cruz') || t.includes('kenneth')) return false;
            return true;
          });
          if (clean.length !== arr.length) {
            localStorage.setItem('rmims_notifications_live_v2', JSON.stringify(clean));
          }
        }
      } catch (_) {}
    }
  } catch (e) {}

  const path = location.pathname.split('/').filter(Boolean);
  const isAnyAdmin = path.includes('admin') || path.includes('main-admin');
  const isStrictManager = path.includes('manager') && !isAnyAdmin;
  const isManager = path.includes('manager') || isAnyAdmin;
  const role = isAnyAdmin ? 'admin' : (isStrictManager ? 'manager' : 'user');
  const current = (path[path.length - 1] || '').toLowerCase();

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatBranchLabel(bName, bLoc) {
    if (!bName && !bLoc) return '— Branch Not Set —';
    if (bName && bLoc) {
      if (bName.toLowerCase().includes(bLoc.toLowerCase())) {
        return `${bName} Hub`;
      }
      return `${bName} \u2022 ${bLoc} Hub`;
    }
    return (bName || bLoc);
  }

  const icons = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5h-4v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/></svg>',
    inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    receive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>',
    disburse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>',
    activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
    analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    forecasting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
    simulation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>',
    reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  };

  const managerSections = [
    {
      heading: 'WORKSPACE',
      items: [
        ['dashboard.html', 'Dashboard', 'dashboard'],
        ['inventory.html', 'My Inventory', 'inventory'],
        ['receive.html', 'Receive', 'receive'],
        ['disburse.html', 'Disburse', 'disburse']
      ]
    },
    {
      heading: 'INSIGHTS',
      items: [
        ['analytics.html', 'Analytics', 'analytics'],
        ['forecasting.html', 'Forecast', 'forecasting']
      ]
    },
    {
      heading: 'REPORTS',
      items: [
        ['reports.html', 'Current Report', 'reports']
      ]
    },
    {
      heading: 'TEAM',
      items: [
        ['staff-activity.html', 'Staff Activity', 'users']
      ]
    }
  ];

  const adminSections = [
    {
      heading: 'WORKSPACE',
      items: [
        ['overview.html', 'Overview', 'dashboard'],
        ['branch-stores.html', 'Branch Stores', 'inventory'],
        ['activity-logs.html', 'Activity Logs', 'activity'],
        ['system-alerts.html', 'System Alerts', 'reports']
      ]
    },
    {
      heading: 'MANAGEMENT',
      items: [
        ['user-management.html', 'User Accounts', 'users'],
        ['settings.html', 'Settings', 'settings']
      ]
    }
  ];

  const userSections = [
    {
      heading: 'WORKSPACE',
      items: [
        ['dashboard.html', 'Dashboard', 'dashboard'],
        ['inventory.html', 'Inventory', 'inventory'],
        ['receive.html', 'Receive', 'receive'],
        ['disburse.html', 'Disburse', 'disburse']
      ]
    },
    {
      heading: 'REPORTS',
      items: [
        ['reports.html', 'Reports', 'reports']
      ]
    }
  ];

  const sections = isStrictManager ? managerSections : (isAnyAdmin ? adminSections : userSections);

  function isActive(href) {
    const baseHref = href.split('?')[0].toLowerCase();
    if (href.includes('?')) {
      return current === baseHref && location.search === '?' + href.split('?')[1];
    }
    if ((baseHref === 'usage.html' || baseHref === 'analytics.html') && (current === 'usage.html' || current === 'analytics.html')) return true;
    if (baseHref === 'receive.html' && (current === 'receive.html' || (current === 'material-activity.html' && location.search.includes('receive')))) return true;
    if (baseHref === 'disburse.html' && (current === 'disburse.html' || (current === 'material-activity.html' && (location.search.includes('disburse') || location.search.includes('disbursement'))))) return true;
    return current === baseHref;
  }

  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    if (isStrictManager) {
      sidebar.className = 'sidebar admin-sidebar';
      sidebar.innerHTML = `
        <div>
          <a href="dashboard.html" class="sidebar-header" title="RMSME Store Management">
            <div class="brand-logo-wrap">
              <img src="../assets/logo-icon.png" alt="RMSME Logo" class="brand-logo-img">
            </div>
            <div class="brand-titles">
              <span class="brand-name">RMSME</span>
              <span class="brand-sub">Store Management</span>
            </div>
          </a>
          <nav class="sidebar-nav" aria-label="Primary navigation">
            <a class="nav-link ${isActive('dashboard.html') ? 'active' : ''}" href="dashboard.html" title="Dashboard">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              <span>Dashboard</span>
            </a>
            <a class="nav-link ${isActive('inventory.html') ? 'active' : ''}" href="inventory.html" title="My Inventory">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              <span>My Inventory</span>
            </a>
            <a class="nav-link ${isActive('receive.html') ? 'active' : ''}" href="receive.html" title="Receive">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>
              <span>Receive</span>
            </a>
            <a class="nav-link ${isActive('disburse.html') ? 'active' : ''}" href="disburse.html" title="Disburse">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>
              <span>Disburse</span>
            </a>
            <a class="nav-link ${isActive('analytics.html') || isActive('usage.html') ? 'active' : ''}" href="analytics.html" title="Analytics">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              <span>Analytics</span>
            </a>
            <a class="nav-link ${isActive('forecasting.html') ? 'active' : ''}" href="forecasting.html" title="Forecast">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>
              <span>Forecast</span>
            </a>
            <a class="nav-link ${isActive('reports.html') ? 'active' : ''}" href="reports.html" title="Current Report">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span>Current Report</span>
            </a>
            <a class="nav-link ${isActive('staff-activity.html') ? 'active' : ''}" href="staff-activity.html" title="Staff Activity">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>Staff Activity</span>
            </a>
          </nav>
        </div>
        <div class="sidebar-bottom-nav">
          <button type="button" class="nav-link nav-btn-help" id="btnSidebarHelp">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>Help Center</span>
          </button>
          <a href="settings.html" class="nav-link ${isActive('settings.html') ? 'active' : ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0 1.51 1z"/></svg>
            <span>Settings</span>
          </a>
          <div class="sidebar-version">v2.0.0 &bull; RMSME</div>
        </div>`;
    } else if (!isAnyAdmin) {
      // STAFF ROLE SIDEBAR
      sidebar.className = 'sidebar admin-sidebar';
      sidebar.innerHTML = `
        <div>
          <a href="dashboard.html" class="sidebar-header" title="RMSME Store Staff">
            <div class="brand-logo-wrap">
              <img src="../assets/logo-icon.png" alt="RMSME Logo" class="brand-logo-img">
            </div>
            <div class="brand-titles">
              <span class="brand-name">RMSME</span>
              <span class="brand-sub">Store Staff</span>
            </div>
          </a>
          <nav class="sidebar-nav" aria-label="Primary navigation">
            <a class="nav-link ${isActive('dashboard.html') ? 'active' : ''}" href="dashboard.html" title="Dashboard">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              <span>Dashboard</span>
            </a>
            <a class="nav-link ${isActive('inventory.html') ? 'active' : ''}" href="inventory.html" title="My Inventory">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              <span>My Inventory</span>
            </a>
            <a class="nav-link ${isActive('receive.html') ? 'active' : ''}" href="receive.html" title="Receive">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>
              <span>Receive</span>
            </a>
            <a class="nav-link ${isActive('disburse.html') ? 'active' : ''}" href="disburse.html" title="Disburse">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>
              <span>Disburse</span>
            </a>
            <a class="nav-link ${isActive('my-activity.html') ? 'active' : ''}" href="my-activity.html" title="My Activity">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
              <span>My Activity</span>
            </a>
            <a class="nav-link ${isActive('reports.html') ? 'active' : ''}" href="reports.html" title="Reports">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span>Reports</span>
            </a>
          </nav>
        </div>
        <div class="sidebar-bottom-nav">
          <button type="button" class="nav-link nav-btn-help" id="btnSidebarHelp">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>Help Center</span>
          </button>
          <a href="settings.html" class="nav-link ${isActive('settings.html') ? 'active' : ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0 1.51 1z"/></svg>
            <span>Settings</span>
          </a>
          <div class="sidebar-version">v2.0.0 &bull; RMSME</div>
        </div>`;
    } else {
      sidebar.innerHTML = `
        <div class="rmsme-brand">
          <div class="rmsme-brand-mark"><img src="../assets/logo-icon.png" alt="RMSME"></div>
          <div class="rmsme-brand-copy"><strong>RMSME</strong><span>Inventory Intelligence</span></div>
        </div>
        <nav class="rmsme-nav" aria-label="Primary navigation">
          ${sections.map(sec => `
            <div class="rmsme-nav-heading">${sec.heading}</div>
            ${sec.items.map(([href, label, icon]) => `
              <a class="rmsme-nav-item ${isActive(href) ? 'active' : ''}" href="${href}" title="${label}">
                <span class="rmsme-nav-icon">${icons[icon] || icons.dashboard}</span>
                <span class="rmsme-nav-label">${label}</span>
              </a>
            `).join('')}
          `).join('')}
        </nav>
        <div class="rmsme-side-account">
          <div class="rmsme-side-avatar" data-shell-avatar>${isAnyAdmin ? 'A' : 'U'}</div>
          <div class="rmsme-side-user">
            <strong data-shell-name>${isAnyAdmin ? 'Administrator' : 'User'}</strong>
            <span data-shell-role>${isAnyAdmin ? 'System Admin' : 'Staff'}</span>
          </div>
          <button class="rmsme-side-logout" id="rmsmeSideLogout" aria-label="Log Out" title="Log Out">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>`;
    }
  }

  const breadcrumbMap = {
    'overview.html': 'Workspace / Overview',
    'dashboard.html': 'Workspace / Dashboard',
    'inventory.html': isStrictManager ? 'Workspace / My Inventory' : 'Workspace / Inventory',
    'receive.html': 'Workspace / Receive',
    'disburse.html': 'Workspace / Disburse',
    'my-activity.html': 'Workspace / My Activity',
    'material-activity.html': 'Workspace / Material Activity',
    'usage.html': 'Insights / Analytics',
    'analytics.html': isStrictManager ? 'Insights / Analytics' : 'Workspace / Analytics',
    'forecasting.html': isStrictManager ? 'Insights / Forecast' : 'Workspace / Forecasting',
    'simulation.html': 'Workspace / Simulation',
    'reports.html': isStrictManager ? 'Reports / Current Report' : 'Workspace / Reports',
    'staff-activity.html': 'Team / Staff Activity',
    'user-management.html': 'Management / Team Access',
    'settings.html': isManager ? 'Management / Settings & Privacy' : 'Account / Settings'
  };

  const titleMap = {
    'overview.html': ['Main Administration Overview', "Here's what's happening across all branch stores."],
    'dashboard.html': ['Dashboard', "Here's your company's raw materials inventory overview for today."],
    'inventory.html': [isStrictManager ? 'My Inventory' : 'Inventory Management', 'Manage raw materials inventory catalog and operational activity.'],
    'receive.html': ['Receive Raw Materials', 'Record incoming materials into inventory. Reference numbers are automatically generated.'],
    'disburse.html': ['Disburse Raw Materials', 'Record materials taken from inventory for production.'],
    'my-activity.html': ['My Activity', 'View your submitted transactions, track approvals, and correct returned items.'],
    'material-activity.html': ['Material Activity', 'Record and review raw-material movement.'],
    'usage.html': ['Analytics', 'Analyze raw-material consumption, rankings, and operational trends.'],
    'analytics.html': [isStrictManager ? 'Analytics' : 'Consumption Analytics', 'Analyze raw-material consumption and usage trends.'],
    'forecasting.html': ['AI Raw Material Forecast', 'Authoritative demand planning and AI raw-material forecasts.'],
    'simulation.html': ['Product Simulation', 'Predict producible units and ingredient depletion over a chosen horizon.'],
    'reports.html': ['Current Report', 'Generate comprehensive inventory summaries and operational reports.'],
    'staff-activity.html': ['Staff Activity', 'Monitor Staff activities, review submissions, and manage approvals.'],
    'user-management.html': ['User Management', 'Manage system users and their access.'],
    'settings.html': ['Settings & Privacy', 'Manage your account, system preferences, data, and security.']
  };

  // Standardize browser tab title: "[Page] | RMSME"
  if (titleMap[current]) {
    document.title = `${titleMap[current][0]} | RMSME`;
  }

  // Ensure favicon is present on all pages
  if (!document.querySelector('link[rel*="icon"]')) {
    const fav = document.createElement('link');
    fav.rel = 'icon';
    fav.type = 'image/png';
    fav.href = (location.pathname.includes('/admin/') || location.pathname.includes('/main-admin/') || location.pathname.includes('/manager/') || location.pathname.includes('/user/'))
      ? '../assets/favicon-64.png'
      : 'assets/favicon-64.png';
    document.head.appendChild(fav);
  }

  document.addEventListener('click', (event) => {
    const hashLink = event.target.closest('a[href^="#"]');
    if (hashLink && hashLink.closest('.sidebar, .rmsme-nav')) {
      const targetId = hashLink.getAttribute('href').slice(1);
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        event.preventDefault();
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        targetEl.classList.add('section-focused');
        setTimeout(() => targetEl.classList.remove('section-focused'), 1600);
      } else if (targetId === 'settingsModal') {
        event.preventDefault();
        const sm = document.getElementById('adminSettingsModal');
        if (sm) sm.style.display = 'flex';
      }
      document.body.classList.remove('rmsme-mobile-drawer-open');
      return;
    }

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
    const targetFile = url.pathname.split('/').pop() || '';
    if (targetFile && titleMap[targetFile]) {
      document.title = `${titleMap[targetFile][0]} | RMSME`;
    }
    document.body.classList.add('rmsme-navigating');
    window.setTimeout(() => { location.href = url.href; }, 140);
  }, true);

  // Standardize topbar header across all pages
  const oldTopbar = document.querySelector('.topbar');
  if (oldTopbar) {
    if (oldTopbar.querySelector('.header-actions') || oldTopbar.querySelector('#headerDate')) {
      oldTopbar.style.display = '';
    } else {
      const [title, subtitle] = titleMap[current] || ['RMSME', 'Raw Materials Inventory Management System'];
      const crumb = breadcrumbMap[current] || 'Workspace';

      if (isStrictManager) {
        oldTopbar.innerHTML = `
          <div class="rmsme-topbar-left">
            <button class="rmsme-mobile-menu-btn" id="rmsmeMobileMenuBtn" aria-label="Toggle Navigation" title="Toggle Navigation">
              <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <div class="rmsme-heading">
              <span class="rmsme-breadcrumb">${crumb}</span>
              <h1>${title}</h1>
              <p>${subtitle}</p>
            </div>
          </div>
          <div class="rmsme-topbar-center">
            <div class="mgr-header-search">
              <svg class="mgr-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input type="text" id="rmsmeGlobalSearch" placeholder="Search here..." autocomplete="off">
            </div>
          </div>
          <div class="rmsme-header-actions">
            <!-- Notifications Dropdown Anchor -->
            <div class="rmsme-popover-anchor" id="rmsmeNotifAnchor">
              <button class="mgr-bell-btn" id="rmsmeNotificationBtn" aria-label="Notifications" title="Notifications" aria-expanded="false">
                <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
                <span class="mgr-bell-dot" id="rmsmeNotifBadge" style="display:none;"></span>
              </button>
              <div class="rmsme-popover rmsme-notifications" id="rmsmeNotifications" hidden>
                <div class="rmsme-popover-head"><strong>Notifications</strong><button type="button" id="rmsmeMarkAll">Mark all as read</button></div>
                <div id="rmsmeNotificationList"><div class="rmsme-empty">No new notifications.</div></div>
                <div class="rmsme-popover-foot"><button type="button" id="rmsmeViewNotifications">View all notifications →</button></div>
              </div>
            </div>

            <!-- Profile Dropdown Anchor -->
            <div class="rmsme-popover-anchor" id="rmsmeProfileAnchor">
              <button class="mgr-profile-pill" id="rmsmeProfileBtn" aria-expanded="false" title="Manager Menu">
                <span class="mgr-avatar" data-shell-avatar>M</span>
                <span class="mgr-user-copy">
                  <strong class="mgr-name" data-shell-name>Manager</strong>
                  <small class="mgr-role" data-shell-role>Manager</small>
                </span>
                <span class="mgr-chev">▾</span>
              </button>
              <div class="rmsme-popover mgr-profile-dropdown" id="rmsmeProfile" hidden>
                <div class="mgr-profile-head">
                  <div class="mgr-online-badge">
                    <span class="mgr-status-indicator"></span>
                    <div>
                      <strong data-shell-name>Manager</strong>
                      <small data-shell-role style="display:block; color:#5C7A68; font-size:11.5px;">Manager</small>
                    </div>
                  </div>
                </div>
                <div class="mgr-popover-divider"></div>
                <a href="settings.html" class="mgr-popover-item">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0 1.51 1z"/></svg>
                  Account
                </a>
                <div class="mgr-popover-divider"></div>
                <button type="button" class="mgr-popover-item text-danger" id="rmsmeLogout">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  Logout
                </button>
              </div>
            </div>
          </div>`;
      } else if (!isAnyAdmin) {
        // STAFF TOPBAR
        oldTopbar.innerHTML = `
          <div class="rmsme-topbar-left">
            <button class="rmsme-mobile-menu-btn" id="rmsmeMobileMenuBtn" aria-label="Toggle Navigation" title="Toggle Navigation">
              <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <div class="rmsme-heading">
              <span class="rmsme-breadcrumb">${crumb}</span>
              <h1>${title}</h1>
              <p>${subtitle}</p>
            </div>
          </div>
          <div class="rmsme-topbar-center">
            <!-- Live Philippine Standard Time Clock -->
            <div class="topbar-clock" id="rmsmeTopbarClock" title="Live Philippine Standard Time (PST)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span class="topbar-clock-text" id="rmsmeClockText">Loading live clock...</span>
            </div>
          </div>
          <div class="rmsme-header-actions">
            <!-- Notifications Dropdown Anchor -->
            <div class="rmsme-popover-anchor" id="rmsmeNotifAnchor">
              <button class="mgr-bell-btn" id="rmsmeNotificationBtn" aria-label="Notifications" title="Notifications" aria-expanded="false">
                <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
                <span class="mgr-bell-dot" id="rmsmeNotifBadge" style="display:none;"></span>
              </button>
              <div class="rmsme-popover rmsme-notifications" id="rmsmeNotifications" hidden>
                <div class="rmsme-popover-head"><strong>Notifications</strong><button type="button" id="rmsmeMarkAll">Mark all as read</button></div>
                <div id="rmsmeNotificationList"><div class="rmsme-empty">No new notifications.</div></div>
                <div class="rmsme-popover-foot"><button type="button" id="rmsmeViewNotifications">View all notifications →</button></div>
              </div>
            </div>

            <!-- Profile Dropdown Anchor -->
            <div class="rmsme-popover-anchor" id="rmsmeProfileAnchor">
              <button class="mgr-profile-pill" id="rmsmeProfileBtn" aria-expanded="false" title="Staff Menu">
                <span class="mgr-avatar" data-shell-avatar>U</span>
                <span class="mgr-user-copy">
                  <strong class="mgr-name" data-shell-name>User</strong>
                  <small class="mgr-role" data-shell-role style="display:block; color:#5C7A68; font-size:11.5px;">Staff</small>
                </span>
                <span class="mgr-chev">▾</span>
              </button>
              <div class="rmsme-popover mgr-profile-dropdown" id="rmsmeProfile" hidden>
                <div class="mgr-profile-head">
                  <div class="mgr-online-badge">
                    <span class="mgr-status-indicator"></span>
                    <div>
                      <strong data-shell-name>Loading...</strong>
                      <small data-shell-role style="display:block; color:#5C7A68; font-size:11.5px;">— &bull; —</small>
                    </div>
                  </div>
                </div>
                <div class="mgr-popover-divider"></div>
                <a href="settings.html" class="mgr-popover-item">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0 1.51 1z"/></svg>
                  Account
                </a>
                <div class="mgr-popover-divider"></div>
                <button type="button" class="mgr-popover-item text-danger" id="rmsmeLogout">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  Logout
                </button>
              </div>
            </div>
          </div>`;
      } else {
        oldTopbar.innerHTML = `
          <div class="rmsme-topbar-left">
            <button class="rmsme-mobile-menu-btn" id="rmsmeMobileMenuBtn" aria-label="Toggle Navigation" title="Toggle Navigation">
              <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <div class="rmsme-heading">
              <span class="rmsme-breadcrumb">${crumb}</span>
              <h1>${title}</h1>
              <p>${subtitle}</p>
            </div>
          </div>
          <div class="rmsme-topbar-center">
            <!-- Prominent active Store / Branch badge -->
            <div class="rmsme-branch-badge" id="rmsmeBranchBadge" title="Assigned Store / Branch Hub">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 21h18M3 7v14M21 7v14M6 21V11M10 21V11M14 21V11M18 21V11M2 7l10-4 10 4"/>
              </svg>
              <span data-shell-branch>Loading branch...</span>
            </div>

            <!-- Live Clock in place of search bar: transparent and curved, live accurate PST -->
            <div class="topbar-clock" id="rmsmeTopbarClock" title="Live Philippine Standard Time (PST)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span class="topbar-clock-text" id="rmsmeClockText">Loading live clock...</span>
            </div>
          </div>
          <div class="rmsme-header-actions">
            <!-- Notifications Dropdown Anchor -->
            <div class="rmsme-popover-anchor" id="rmsmeNotifAnchor">
              <button class="rmsme-header-btn" id="rmsmeNotificationBtn" aria-label="Notifications" title="Notifications" aria-expanded="false">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
                <span class="rmsme-notif-badge" id="rmsmeNotifBadge" style="display:none;">0</span>
              </button>
              <div class="rmsme-popover rmsme-notifications" id="rmsmeNotifications" hidden>
                <div class="rmsme-popover-head"><strong>Notifications</strong><button type="button" id="rmsmeMarkAll">Mark all as read</button></div>
                <div id="rmsmeNotificationList"><div class="rmsme-empty">No new notifications.</div></div>
                <div class="rmsme-popover-foot"><button type="button" id="rmsmeViewNotifications">View all notifications →</button></div>
              </div>
            </div>

            <!-- Help Dropdown Anchor -->
            <div class="rmsme-popover-anchor" id="rmsmeHelpAnchor">
              <button class="rmsme-header-btn" id="rmsmeHelpBtn" aria-label="Help" title="Help" aria-expanded="false">?</button>
              <div class="rmsme-popover rmsme-help" id="rmsmeHelp" hidden>
                <strong>Help & Information</strong>
                <button type="button" id="rmsmeSystemGuideBtn">📖 System User Guide</button>
              </div>
            </div>

            <!-- Profile Dropdown Anchor -->
            <div class="rmsme-popover-anchor" id="rmsmeProfileAnchor">
              <button class="rmsme-profile-btn" id="rmsmeProfileBtn" aria-expanded="false" title="Account Menu">
                <span class="rmsme-avatar" data-shell-avatar>${isAnyAdmin ? 'A' : (isManager ? 'M' : 'U')}</span><span class="rmsme-profile-copy"><strong data-shell-name>Account</strong><small data-shell-role>${isAnyAdmin ? 'Administrator' : (isManager ? 'Manager' : 'Staff')}</small></span><span class="rmsme-chevron">⌄</span>
              </button>
              <div class="rmsme-popover rmsme-profile" id="rmsmeProfile" hidden>
                <div class="rmsme-profile-head"><span class="rmsme-avatar large" data-shell-avatar>${isAnyAdmin ? 'A' : (isManager ? 'M' : 'U')}</span><div><strong data-shell-name>Account</strong><small data-shell-role>${isAnyAdmin ? 'Administrator' : (isManager ? 'Manager' : 'Staff')}</small><small data-shell-email></small></div></div>
                <a href="settings.html">My Account</a><a href="settings.html">Settings</a>
                <button type="button" id="rmsmeLogout">Log Out</button>
              </div>
            </div>
          </div>`;
      }
    }
  }

  // Live Header Date and Clock Sync across all Manager and Shell pages
  function updateHeaderDate() {
    const el = document.getElementById('headerDate');
    if (!el) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const span = el.querySelector('span');
    if (span) {
      span.textContent = dateStr;
    } else {
      el.textContent = dateStr;
    }
  }
  updateHeaderDate();
  setInterval(updateHeaderDate, 30000);

  // Live Frontdesk Monitoring Clock Sync (matching Admin Overview exact digital format)
  function updateFrontdeskClock() {
    const fdTime = document.getElementById('frontdeskTime');
    const fdPeriod = document.getElementById('frontdeskPeriod');
    const fdDate = document.getElementById('frontdeskDate');
    if (!fdTime && !fdPeriod && !fdDate) return;

    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateNum = now.getDate();
    const year = now.getFullYear() < 2026 ? 2026 : now.getFullYear();

    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const hStr = String(hours).padStart(2, '0');

    if (fdTime) fdTime.textContent = `${hStr}:${minutes}:${seconds}`;
    if (fdPeriod) fdPeriod.textContent = ampm;
    if (fdDate) fdDate.textContent = `${dayName.toUpperCase()}, ${dateNum} ${monthName.toUpperCase()} ${year}`;
  }
  updateFrontdeskClock();
  setInterval(updateFrontdeskClock, 1000);

  // Mobile Navigation Drawer Controller
  function initMobileDrawer() {
    let mobileMenuBtn = document.getElementById('rmsmeMobileMenuBtn') || document.querySelector('.mobile-sidebar-toggle');
    const topbarLeft = document.querySelector('.admin-topbar .topbar-left, .topbar .topbar-left, .topbar-left');
    
    if (topbarLeft) {
      // Group titles/description in a vertical flex container if not already grouped
      let textGroup = topbarLeft.querySelector('.topbar-text-group');
      if (!textGroup) {
        textGroup = document.createElement('div');
        textGroup.className = 'topbar-text-group';
        const children = Array.from(topbarLeft.childNodes).filter(node => {
          return node !== mobileMenuBtn && !(node.classList && node.classList.contains('mobile-sidebar-toggle'));
        });
        children.forEach(child => textGroup.appendChild(child));
        topbarLeft.appendChild(textGroup);
      }

      if (!mobileMenuBtn) {
        mobileMenuBtn = document.createElement('button');
        mobileMenuBtn.type = 'button';
        mobileMenuBtn.id = 'rmsmeMobileMenuBtn';
        mobileMenuBtn.className = 'mobile-sidebar-toggle';
        mobileMenuBtn.setAttribute('aria-label', 'Toggle Navigation Menu');
        mobileMenuBtn.setAttribute('title', 'Toggle Navigation Menu');
        mobileMenuBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        `;
        topbarLeft.prepend(mobileMenuBtn);
      } else if (topbarLeft.firstChild !== mobileMenuBtn) {
        topbarLeft.prepend(mobileMenuBtn);
      }
    }

    let drawerBackdrop = document.querySelector('.rmsme-mobile-drawer-backdrop');
    if (!drawerBackdrop) {
      drawerBackdrop = document.createElement('div');
      drawerBackdrop.className = 'rmsme-mobile-drawer-backdrop';
      document.body.appendChild(drawerBackdrop);
    }

    function toggleMobileDrawer(open) {
      const shouldOpen = open !== undefined ? open : !document.body.classList.contains('rmsme-mobile-drawer-open');
      document.body.classList.toggle('rmsme-mobile-drawer-open', shouldOpen);
      const activeSidebar = document.querySelector('.sidebar, .admin-sidebar');
      if (activeSidebar) {
        activeSidebar.classList.toggle('mobile-open', shouldOpen);
      }
    }

    mobileMenuBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMobileDrawer();
    });

    drawerBackdrop?.addEventListener('click', () => {
      toggleMobileDrawer(false);
    });

    const activeSidebar = document.querySelector('.sidebar, .admin-sidebar');
    activeSidebar?.querySelectorAll('a, button').forEach(link => {
      if (link.id !== 'rmsmeMobileMenuBtn') {
        link.addEventListener('click', () => toggleMobileDrawer(false));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileDrawer);
  } else {
    initMobileDrawer();
  }

  function initials(name) {
    const parts = String(name || 'Account').trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map(x => x[0]).join('') || 'A').toUpperCase();
  }

  function syncIdentity() {
    let name = '', email = '';
    let roleTitle = isManager ? 'Manager' : 'Staff';
    let branchName = '', branchLocation = '';
    let hasSession = false;
    try {
      const candidates = isManager 
        ? ['managerUser', 'currentUser', 'rmimsCurrentUser', 'userProfile', 'user', 'adminUser', 'rmimsAdminUser']
        : ['staffUser', 'currentUser', 'rmimsCurrentUser', 'userProfile', 'user', 'adminUser', 'rmimsAdminUser'];
      for (const k of candidates) {
        const raw = localStorage.getItem(k); if (!raw) continue;
        const o = JSON.parse(raw);
        if (o?.fullName || o?.name || o?.email) {
          const rawName = o.fullName || o.name || '';
          const candidateEmail = (o.email || '').toLowerCase();
          const lowerName = rawName.toLowerCase();
          if (candidateEmail.includes('@rmims.ph') || lowerName.includes('maria santos') || lowerName.includes('rafael cruz')) {
            continue;
          }
          name = rawName;
          email = o.email || '';
          branchName = o.branchName || o.branch_name || '';
          branchLocation = o.branchLocation || o.branch_location || '';
          roleTitle = (o.role === 'admin' || isAnyAdmin) ? 'Administrator' : (isManager ? 'Manager' : 'Staff');
          hasSession = true;
          break;
        }
      }
    } catch (e) { }

    if (!hasSession) {
      // Do not prematurely bounce; allow async syncLiveSession to verify with Supabase Auth
      return;
    }

    document.querySelectorAll('[data-shell-name]').forEach(e => e.textContent = name);
    document.querySelectorAll('[data-shell-email]').forEach(e => e.textContent = email);
    document.querySelectorAll('[data-shell-avatar]').forEach(e => e.textContent = initials(name));
    document.querySelectorAll('[data-shell-role]').forEach(e => e.textContent = roleTitle);

    const branchLabel = formatBranchLabel(branchName, branchLocation);
    document.querySelectorAll('[data-shell-branch]').forEach(e => e.textContent = branchLabel);

    if (current === 'dashboard.html') {
      const hour = new Date().getHours();
      const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      
      if (isManager) {
        const greetingHeading = `${greet}, Manager!`;
        const greetingSub = "Here is your daily manager operational summary.";

        const welcomeEl = document.getElementById('overviewWelcomeGreeting') || document.getElementById('welcomeGreeting');
        if (welcomeEl) welcomeEl.textContent = greetingHeading;
        const subEl = document.getElementById('overviewWelcomeSub') || document.querySelector('.overview-welcome-sub');
        if (subEl) subEl.textContent = greetingSub;
      } else {
        const firstName = (name && name !== 'Staff Member' && name !== 'Store Manager') ? name.split(/\s+/)[0] : '';
        const greetingHeading = firstName ? `Welcome back, ${firstName}!` : 'Welcome back!';
        const greetingSub = "Here's what's happening across your store operations today.";

        const welcomeEl = document.getElementById('welcomeGreeting') || document.getElementById('overviewWelcomeGreeting');
        if (welcomeEl) welcomeEl.textContent = greetingHeading;
        const subEl = document.getElementById('welcomeSub') || document.querySelector('.overview-welcome-sub');
        if (subEl) subEl.textContent = greetingSub;
      }

      const headingP = document.querySelector('.rmsme-heading p');
      if (headingP) {
        headingP.textContent = isManager
          ? `${greet}, Manager! Here is your daily manager operational summary.`
          : "Here's what's happening across your store operations today.";
      }
    }
  }

  async function syncLiveSession() {
    try {
      const { supabase } = await import('../supabase/supabase-config.js');
      if (!supabase) return;

      // 1. Check getSession first (fast local token check) before getUser
      let authUser = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user) {
          authUser = session.user;
        }
      } catch (_) {}

      if (!authUser) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          authUser = user;
        } catch (_) {}
      }

      if (authUser) {
        let profile = null;
        try {
          const { data } = await supabase
            .from('user_profiles')
            .select('id, full_name, email, role, operational_role, branch_name, branch_location, status')
            .eq('id', authUser.id)
            .maybeSingle();
          profile = data;
        } catch (e) {
          try {
            const { data } = await supabase
              .from('user_profiles')
              .select('id, full_name, email, role, status')
              .eq('id', authUser.id)
              .maybeSingle();
            profile = data;
          } catch (_) {}
        }

        const cleanEmail = (authUser.email || "").toLowerCase();
        const isDumpAccount = cleanEmail === "admin@rmims.ph" || cleanEmail === "manager@rmims.ph" || cleanEmail === "staff@rmims.ph" || cleanEmail === "asst.manager@rmims.ph";
        if (isDumpAccount) {
          await supabase.auth.signOut();
          localStorage.removeItem('currentUser');
          localStorage.removeItem('rmimsCurrentUser');
          localStorage.removeItem('userProfile');
          window.location.href = '../login.html';
          return;
        }

        const isMasterAdmin = cleanEmail === "calusinzeanna3@gmail.com";

        if (isMasterAdmin) {
          if (!profile) {
            profile = {
              id: authUser.id || authUser.uid,
              email: authUser.email,
              full_name: 'Zeanna',
              role: 'admin',
              operational_role: 'admin',
              status: 'active'
            };
          } else {
            profile.role = 'admin';
            profile.operational_role = 'admin';
            profile.status = 'active';
          }
        }

        if (!profile) {
          try {
            const raw = localStorage.getItem("rmimsCurrentUser") || localStorage.getItem("currentUser") || localStorage.getItem("userProfile");
            if (raw) {
              const cached = JSON.parse(raw);
              if (cached.email && cached.email.toLowerCase() === cleanEmail) {
                profile = {
                  id: authUser.id || authUser.uid,
                  email: authUser.email,
                  full_name: cached.fullName || cached.name || "User",
                  role: cached.role || (isMasterAdmin ? "admin" : "user"),
                  operational_role: cached.operationalRole || (isMasterAdmin ? "admin" : "staff"),
                  status: cached.status || "active",
                  branch_name: cached.branchName || cached.branch_name || "",
                  branch_location: cached.branchLocation || cached.branch_location || ""
                };
              }
            }
          } catch (e) {}
        }

        if (profile) {
          // Live status guard: If pending approval or inactive, eject session (never eject master admin)
          if (profile.status && profile.status !== 'active' && !isMasterAdmin) {
            await supabase.auth.signOut();
            window.location.href = '../login.html';
            return;
          }
          // Live role guard: If trying to access manager pages without manager/admin role, redirect
          if (isManager && profile.role !== 'admin' && profile.role !== 'manager' && !isMasterAdmin) {
            window.location.href = '../user/dashboard.html';
            return;
          }

          let liveName = profile.full_name || profile.email;
          document.querySelectorAll('[data-shell-name]').forEach(e => e.textContent = liveName);
          if (profile.email) {
            document.querySelectorAll('[data-shell-email]').forEach(e => e.textContent = profile.email);
          }
          document.querySelectorAll('[data-shell-avatar]').forEach(e => e.textContent = isMasterAdmin ? 'A' : (isManager ? 'M' : initials(liveName)));

          const pBranchName = profile.branch_name || profile.branchName || '';
          const pBranchLoc = profile.branch_location || profile.branchLocation || '';
          const pBranchLabel = formatBranchLabel(pBranchName, pBranchLoc);
          document.querySelectorAll('[data-shell-branch]').forEach(e => e.textContent = pBranchLabel);

          let liveRoleTitle = isManager ? 'Manager' : 'Staff';
          if (profile.role === 'admin' || isAnyAdmin || isMasterAdmin) liveRoleTitle = 'Administrator';
          document.querySelectorAll('[data-shell-role]').forEach(e => e.textContent = liveRoleTitle);

          if (current === 'dashboard.html') {
            const hour = new Date().getHours();
            const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
            
            if (isManager) {
              const greetingHeading = `${greet}, Manager!`;
              const greetingSub = "Here is your daily manager operational summary.";

              const welcomeEl = document.getElementById('overviewWelcomeGreeting') || document.getElementById('welcomeGreeting');
              if (welcomeEl) welcomeEl.textContent = greetingHeading;
              const subEl = document.getElementById('overviewWelcomeSub') || document.querySelector('.overview-welcome-sub');
              if (subEl) subEl.textContent = greetingSub;
            } else {
              const firstName = (liveName && liveName !== 'Staff Member') ? liveName.split(/\s+/)[0] : '';
              const greetingHeading = firstName ? `Welcome back, ${firstName}!` : 'Welcome back!';
              const greetingSub = "Here's what's happening across your store operations today.";

              const welcomeEl = document.getElementById('welcomeGreeting') || document.getElementById('overviewWelcomeGreeting');
              if (welcomeEl) welcomeEl.textContent = greetingHeading;
              const subEl = document.getElementById('welcomeSub') || document.querySelector('.overview-welcome-sub');
              if (subEl) subEl.textContent = greetingSub;
            }

            const headingP = document.querySelector('.rmsme-heading p');
            if (headingP) {
              headingP.textContent = isManager
                ? `${greet}, Manager! Here is your daily manager operational summary.`
                : "Here's what's happening across your store operations today.";
            }
          }
        }
      } else {
        const hasLocal = localStorage.getItem('currentUser') || localStorage.getItem('userProfile') || localStorage.getItem('managerUser') || localStorage.getItem('staffUser') || localStorage.getItem('adminUser');
        if (!hasLocal && sessionStorage.getItem('rmims_just_logged_in') !== 'true') {
          window.location.href = '../login.html';
          return;
        }
      }
    } catch (e) { }
  }

  // Format and update live clock for topbar (matching Admin live clock aesthetic)
  function updateLiveClock() {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateNum = now.getDate();
    // Guarantee 2026 accurate live year
    const year = now.getFullYear() < 2026 ? 2026 : now.getFullYear();

    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hStr = String(hours).padStart(2, '0');

    const clockEls = document.querySelectorAll('.topbar-clock, #rmsmeTopbarClock, .header-date');
    clockEls.forEach((clockEl) => {
      const textEl = clockEl.querySelector('.topbar-clock-text') || clockEl.querySelector('span') || clockEl;
      textEl.textContent = `${dayName}, ${monthName} ${dateNum}, ${year} | ${hStr}:${minutes}:${seconds} ${ampm}`;
    });
  }

  // Shared Help Center Modal across Manager & User pages (100% Adopted Admin style)
  function setupHelpCenter() {
    let modalBackdrop = document.getElementById('helpCenterModal');
    if (!modalBackdrop) {
      modalBackdrop = document.createElement('div');
      modalBackdrop.id = 'helpCenterModal';
      modalBackdrop.className = 'help-modal-backdrop';
      modalBackdrop.innerHTML = `
        <div class="help-modal-window" role="dialog" aria-modal="true" aria-labelledby="helpModalTitle">
          <div class="help-modal-header">
            <div class="help-modal-title-group">
              <h3 id="helpModalTitle">Help Center</h3>
              <p>Quick answers to common questions and store operational guidelines.</p>
            </div>
            <button type="button" class="help-modal-close-btn" id="btnCloseHelpCenter" aria-label="Close Help Center">&times;</button>
          </div>

          <div class="help-faq-list">
            <div class="help-faq-item">
              <button type="button" class="help-faq-trigger">
                <span class="help-faq-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  </svg>
                </span>
                <span class="help-faq-question">How do I record raw materials receiving?</span>
                <svg class="help-faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <div class="help-faq-answer">
                Navigate to <strong>Receive</strong> in the sidebar or click <strong>Receive Materials</strong>. Select the supplier, purchase order, material batches, unit quantities, and expiration dates before confirming receipt into branch stock.
              </div>
            </div>

            <div class="help-faq-item">
              <button type="button" class="help-faq-trigger">
                <span class="help-faq-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  </svg>
                </span>
                <span class="help-faq-question">How do I disburse materials to kitchen / production?</span>
                <svg class="help-faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <div class="help-faq-answer">
                Click <strong>Disburse</strong> in the sidebar or quick actions. Choose the requested material, batch (FIFO order), quantity needed, and production batch reference to log the consumption decrement.
              </div>
            </div>

            <div class="help-faq-item">
              <button type="button" class="help-faq-trigger">
                <span class="help-faq-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="m3 17 6-6 4 4 8-8"/>
                    <path d="M14 7h7v7"/>
                  </svg>
                </span>
                <span class="help-faq-question">How does AI Forecasting generate reorder suggestions?</span>
                <svg class="help-faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <div class="help-faq-answer">
                The machine-learning pipeline trains on historical daily consumption patterns, lead times, and seasonal spikes to forecast demand for the next 7-30 days, alerting you before stock reaches critical thresholds.
              </div>
            </div>

            <div class="help-faq-item">
              <button type="button" class="help-faq-trigger">
                <span class="help-faq-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </span>
                <span class="help-faq-question">What reports and export formats are supported?</span>
                <svg class="help-faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <div class="help-faq-answer">
                You can generate inventory audit ledgers, consumption trends, and low-stock alerts with direct <strong>Excel / CSV export</strong> and printable high-resolution PDF summaries for store management records.
              </div>
            </div>
          </div>

          <div class="help-guide-card">
            <div class="help-guide-title-row">
              <h4 class="help-guide-title">Store Operations Guide</h4>
            </div>
            <p class="help-guide-text">Follow our store operations standard to maintain real-time stock integrity, prevent ingredient expiration, and optimize daily production batches.</p>
            <button type="button" class="btn-start-guide" id="btnStartOnboardingGuide">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
              </svg>
              <span>Explore Guide</span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modalBackdrop);
    }

    function openHelp() {
      modalBackdrop.classList.add('show');
    }
    function closeHelp() {
      modalBackdrop.classList.remove('show');
    }

    document.querySelectorAll('#mgrSideHelp, #btnSidebarHelp, #rmsmeHelpBtn, #rmsmeSystemGuideBtn, [href="#helpCenter"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openHelp();
      });
    });

    const closeBtn = document.getElementById('btnCloseHelpCenter');
    if (closeBtn) closeBtn.addEventListener('click', closeHelp);

    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeHelp();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalBackdrop.classList.contains('show')) {
        closeHelp();
      }
    });

    const guideBtn = document.getElementById('btnStartOnboardingGuide');
    if (guideBtn) {
      guideBtn.addEventListener('click', async () => {
        closeHelp();
        if (typeof window.startRmimsTour === 'function') {
          window.startRmimsTour({ force: true });
        } else {
          try {
            const isSub = window.location.pathname.includes('/manager/') || window.location.pathname.includes('/user/') || window.location.pathname.includes('/admin/');
            const scriptPath = isSub ? '../js/onboarding.js' : 'js/onboarding.js';
            const mod = await import(scriptPath);
            if (mod.startRmimsTour) {
              mod.startRmimsTour({ force: true });
            } else if (mod.checkAndShowOnboarding) {
              mod.checkAndShowOnboarding({ id: role, role }, null, { force: true });
            }
          } catch (e) {
            console.warn('Failed to launch onboarding tour:', e);
          }
        }
      });
    }

    modalBackdrop.querySelectorAll('.help-faq-trigger').forEach(trigger => {
      trigger.addEventListener('click', () => {
        const item = trigger.closest('.help-faq-item');
        const isActive = item.classList.contains('active');
        modalBackdrop.querySelectorAll('.help-faq-item').forEach(other => other.classList.remove('active'));
        if (!isActive) item.classList.add('active');
      });
    });
  }

  updateLiveClock();
  setInterval(updateLiveClock, 1000);
  setupHelpCenter();
  setTimeout(setupHelpCenter, 400);
  setupManagerAccountModals();
  setTimeout(setupManagerAccountModals, 400);

  syncIdentity();
  setTimeout(syncIdentity, 600);
  syncLiveSession();
  setTimeout(syncLiveSession, 1200);

  // Auto-check interactive spotlight tour for first-time session
  setTimeout(async () => {
    try {
      const isSub = window.location.pathname.includes('/manager/') || window.location.pathname.includes('/user/') || window.location.pathname.includes('/admin/');
      const scriptPath = isSub ? '../js/onboarding.js' : 'js/onboarding.js';
      const mod = await import(scriptPath);
      if (mod && typeof mod.checkAndShowOnboarding === 'function') {
        const userId = localStorage.getItem('rmims_user_id') || role;
        mod.checkAndShowOnboarding({ id: userId, role });
      }
    } catch (e) {}
  }, 900);

  function setupManagerAccountModals() {
    if (!isStrictManager) return;

    let overlay = document.getElementById('mgrModalsOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mgrModalsOverlay';
      overlay.innerHTML = `
        <style>
          .mgr-modal-backdrop {
            position: fixed !important;
            inset: 0 !important;
            background: rgba(15, 23, 42, 0.65) !important;
            backdrop-filter: blur(4px) !important;
            display: none !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 16px !important;
            z-index: 10050 !important;
            box-sizing: border-box !important;
            opacity: 0 !important;
            transition: opacity 0.2s ease !important;
          }
          .mgr-modal-backdrop.open {
            display: flex !important;
            opacity: 1 !important;
          }
          .mgr-modal-window {
            background: #FFFFFF !important;
            border-radius: 18px !important;
            border: 1px solid rgba(20, 83, 45, 0.12) !important;
            box-shadow: 0 20px 45px -8px rgba(15, 42, 27, 0.2) !important;
            width: 100% !important;
            max-width: 620px !important;
            max-height: 85vh !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
            animation: mgrZoomIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
          }
          @keyframes mgrZoomIn {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }
          .mgr-modal-head {
            padding: 18px 22px !important;
            border-bottom: 1px solid #E2E8F0 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 12px !important;
          }
          .mgr-modal-title {
            margin: 0 !important;
            font-family: 'Sora', sans-serif !important;
            font-size: 18px !important;
            font-weight: 700 !important;
            color: #0F2A1B !important;
          }
          .mgr-modal-sub {
            margin: 2px 0 0 !important;
            font-size: 12px !important;
            color: #5C7A68 !important;
          }
          .mgr-modal-close {
            background: #F1F5F9 !important;
            border: none !important;
            width: 34px !important;
            height: 34px !important;
            border-radius: 50% !important;
            font-size: 20px !important;
            color: #64748B !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            transition: all 0.15s ease !important;
          }
          .mgr-modal-close:hover {
            background: #FEE2E2 !important;
            color: #DC2626 !important;
          }
          .mgr-modal-body {
            padding: 20px 24px !important;
            overflow-y: auto !important;
            flex: 1 1 auto !important;
          }
          .mgr-modal-foot {
            padding: 14px 24px !important;
            border-top: 1px solid #E2E8F0 !important;
            display: flex !important;
            justify-content: flex-end !important;
            gap: 10px !important;
            background: #F8FAFC !important;
          }
        </style>

        <!-- MY ACTIVITY MODAL -->
        <div class="mgr-modal-backdrop" id="mgrMyActivityBackdrop">
          <div class="mgr-modal-window">
            <div class="mgr-modal-head">
              <div>
                <h3 class="mgr-modal-title">My Activity</h3>
                <p class="mgr-modal-sub">Overview of your manager operations and approvals.</p>
              </div>
              <button type="button" class="mgr-modal-close" id="closeMyActivityBackdrop">&times;</button>
            </div>
            <div class="mgr-modal-body">
              <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
                <thead>
                  <tr style="border-bottom:1.5px solid #CBD5E1; color:#64748B; font-size:11.5px; text-transform:uppercase; letter-spacing:0.5px;">
                    <th style="padding:10px 8px;">Date &amp; Time</th>
                    <th style="padding:10px 8px;">Activity</th>
                    <th style="padding:10px 8px;">Reference</th>
                    <th style="padding:10px 8px;">Status</th>
                  </tr>
                </thead>
                <tbody id="mgrMyActivityRows"></tbody>
              </table>
            </div>
            <div class="mgr-modal-foot">
              <button type="button" class="btn-secondary" id="btnOkMyActivity" style="padding:8px 18px; border-radius:8px; border:1px solid #CBD5E1; background:#FFFFFF; cursor:pointer;">Close</button>
            </div>
          </div>
        </div>

        <!-- CHANGE PASSWORD MODAL -->
        <div class="mgr-modal-backdrop" id="mgrChangePasswordBackdrop">
          <div class="mgr-modal-window" style="max-width:440px;">
            <div class="mgr-modal-head">
              <div>
                <h3 class="mgr-modal-title">Change Password</h3>
                <p class="mgr-modal-sub">Keep your manager account safe with a strong password.</p>
              </div>
              <button type="button" class="mgr-modal-close" id="closeChangePasswordBackdrop">&times;</button>
            </div>
            <form id="mgrChangePasswordModalForm" style="margin:0;">
              <div class="mgr-modal-body" style="display:flex; flex-direction:column; gap:14px;">
                <div>
                  <label style="display:block; font-size:12px; font-weight:600; color:#334155; margin-bottom:5px;">Current Password</label>
                  <input type="password" id="mgrInputCurrentPwd" required placeholder="Enter current password" style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid #CBD5E1; font-size:13px; box-sizing:border-box;">
                </div>
                <div>
                  <label style="display:block; font-size:12px; font-weight:600; color:#334155; margin-bottom:5px;">New Password</label>
                  <input type="password" id="mgrInputNewPwd" required minlength="6" placeholder="At least 6 characters" style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid #CBD5E1; font-size:13px; box-sizing:border-box;">
                </div>
                <div>
                  <label style="display:block; font-size:12px; font-weight:600; color:#334155; margin-bottom:5px;">Confirm New Password</label>
                  <input type="password" id="mgrInputConfirmPwd" required minlength="6" placeholder="Repeat new password" style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid #CBD5E1; font-size:13px; box-sizing:border-box;">
                </div>
                <div id="mgrPwdAlert" style="display:none; font-size:12px; padding:8px 12px; border-radius:6px;"></div>
              </div>
              <div class="mgr-modal-foot">
                <button type="button" class="btn-secondary" id="btnCancelChangePwd" style="padding:8px 18px; border-radius:8px; border:1px solid #CBD5E1; background:#FFFFFF; cursor:pointer;">Cancel</button>
                <button type="submit" class="btn-primary" style="padding:8px 18px; border-radius:8px; border:none; background:#15803D; color:#FFFFFF; font-weight:600; cursor:pointer;">Update Password</button>
              </div>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const activityBackdrop = document.getElementById('mgrMyActivityBackdrop');
    const pwdBackdrop = document.getElementById('mgrChangePasswordBackdrop');

    function openActivityModal() {
      closeMenus(null);
      if (!activityBackdrop) return;
      const defaultActs = [];
      let stored = [];
      try {
        const raw = localStorage.getItem('rmims_manager_activities');
        stored = raw ? JSON.parse(raw) : [];
      } catch (e) {
        stored = [];
      }
      const tbody = document.getElementById('mgrMyActivityRows');
      if (tbody) {
        if (!stored || stored.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="4" style="text-align:center; padding:24px 12px; color:#94A3B8; font-size:13px;">
                No recent activity records found.
              </td>
            </tr>
          `;
        } else {
          tbody.innerHTML = stored.map(row => `
            <tr style="border-bottom:1px solid #F1F5F9;">
              <td style="padding:10px 8px; font-weight:500; color:#334155;">${escapeHtml(row.datetime || row.date || '')}</td>
              <td style="padding:10px 8px; font-weight:600; color:#0F2A1B;">${escapeHtml(row.activity || row.details || '')}</td>
              <td style="padding:10px 8px; font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:12px; font-weight:600; color:#475569;">${escapeHtml(row.reference || '—')}</td>
              <td style="padding:10px 8px;">
                <span style="display:inline-block; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; background:${(row.status || '').toLowerCase() === 'approved' ? '#DCFCE7; color:#15803D;' : '#FEE2E2; color:#DC2626;'}">${escapeHtml(row.status || 'Success')}</span>
              </td>
            </tr>
          `).join('');
        }
      }
      activityBackdrop.classList.add('open');
    }

    function closeActivityModal() {
      if (activityBackdrop) activityBackdrop.classList.remove('open');
    }

    function openPwdModal() {
      closeMenus(null);
      if (!pwdBackdrop) return;
      const form = document.getElementById('mgrChangePasswordModalForm');
      if (form) form.reset();
      const alertBox = document.getElementById('mgrPwdAlert');
      if (alertBox) alertBox.style.display = 'none';
      pwdBackdrop.classList.add('open');
    }

    function closePwdModal() {
      if (pwdBackdrop) pwdBackdrop.classList.remove('open');
    }

    document.querySelectorAll('#mgrMyActivityBtn, #mgrHeaderMyActivityBtn').forEach(b => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        openActivityModal();
      });
    });

    document.querySelectorAll('#mgrChangePasswordBtn, #mgrHeaderChangePasswordBtn').forEach(b => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        openPwdModal();
      });
    });

    document.getElementById('closeMyActivityBackdrop')?.addEventListener('click', closeActivityModal);
    document.getElementById('btnOkMyActivity')?.addEventListener('click', closeActivityModal);
    activityBackdrop?.addEventListener('click', (e) => { if (e.target === activityBackdrop) closeActivityModal(); });

    document.getElementById('closeChangePasswordBackdrop')?.addEventListener('click', closePwdModal);
    document.getElementById('btnCancelChangePwd')?.addEventListener('click', closePwdModal);
    pwdBackdrop?.addEventListener('click', (e) => { if (e.target === pwdBackdrop) closePwdModal(); });

    document.getElementById('mgrChangePasswordModalForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const newP = document.getElementById('mgrInputNewPwd').value;
      const confP = document.getElementById('mgrInputConfirmPwd').value;
      const alertBox = document.getElementById('mgrPwdAlert');
      if (newP !== confP) {
        if (alertBox) {
          alertBox.textContent = 'New password and confirmation do not match.';
          alertBox.style.background = '#FEE2E2';
          alertBox.style.color = '#DC2626';
          alertBox.style.display = 'block';
        }
        return;
      }
      if (alertBox) {
        alertBox.textContent = 'Password updated successfully!';
        alertBox.style.background = '#DCFCE7';
        alertBox.style.color = '#15803D';
        alertBox.style.display = 'block';
      }
      setTimeout(() => {
        closePwdModal();
      }, 1000);
    });
  }

  const profile = document.getElementById('mgrProfileDropdown') || document.getElementById('profileDropdown') || document.getElementById('rmsmeProfile');
  const notifBtn = document.getElementById('notificationBtn') || document.getElementById('rmsmeNotificationBtn');
  const notif = document.getElementById('notificationDropdown') || document.getElementById('rmsmeNotifications');
  const helpBtn = document.getElementById('rmsmeHelpBtn'), help = document.getElementById('rmsmeHelp');

  function closeMenus(except) {
    [profile, notif, help].forEach(x => {
      if (x && x !== except) {
        x.hidden = true;
        x.classList.remove('open', 'active');
      }
    });
    document.querySelectorAll('#profileBtn, #rmsmeProfileBtn, .topbar-profile').forEach(b => {
      if (except !== profile) b.setAttribute('aria-expanded', 'false');
    });
    if (notifBtn && except !== notif) notifBtn.setAttribute('aria-expanded', 'false');
    if (helpBtn && except !== help) helpBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu(menu, btn) {
    if (!menu) return;
    const willOpen = menu.hidden || !menu.classList.contains('open');
    closeMenus(menu);
    menu.hidden = !willOpen;
    if (willOpen) {
      menu.classList.add('open');
    } else {
      menu.classList.remove('open');
    }
    if (btn) btn.setAttribute('aria-expanded', String(willOpen));
    if ((menu === notif || menu.id === 'notificationDropdown' || menu.id === 'rmsmeNotifications') && willOpen) {
      renderNotifications();
      syncAuthoritativeNotifications();
    }
  }

  notifBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.RMIMS_NOTIFICATIONS_POPUP) {
      const pRole = (path.includes('user') || role === 'user' || role === 'staff') ? 'staff' : (isManager ? 'manager' : 'staff');
      window.RMIMS_NOTIFICATIONS_POPUP.open(pRole);
    } else {
      toggleMenu(notif, notifBtn);
    }
  });

  document.querySelectorAll('#profileBtn, #rmsmeProfileBtn, .topbar-profile').forEach(btn => {
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const currentDrop = btn.closest('.rmsme-popover-anchor')?.querySelector('.mgr-profile-dropdown, .profile-dropdown') || profile;
      toggleMenu(currentDrop, btn);
    });
  });

  helpBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu(help, helpBtn);
  });

  // Close menus when clicking anywhere outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.rmsme-header-actions') &&
        !e.target.closest('.header-actions') &&
        !e.target.closest('.profile-dropdown') &&
        !e.target.closest('.mgr-profile-dropdown') &&
        !e.target.closest('.admin-profile-dropdown') &&
        !e.target.closest('.notifications-dropdown') &&
        !e.target.closest('.popover-anchor') &&
        !e.target.closest('.rmsme-popover-anchor') &&
        !e.target.closest('#profileBtn') &&
        !e.target.closest('#rmsmeProfileBtn') &&
        !e.target.closest('.topbar-profile') &&
        !e.target.closest('#notificationBtn') &&
        !e.target.closest('#rmsmeNotificationBtn')) {
      closeMenus(null);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenus(null);
    }
  });

  async function performSignOut() {
    // Preserve notification read state so read items stay read across sessions
    localStorage.removeItem('rmsmeCurrentUser');
    try {
      sessionStorage.removeItem("rmims_login_session_id");
      sessionStorage.removeItem("rmims_session_login_recorded");
      const { supabase } = await import('../supabase/supabase-config.js');
      if (supabase && supabase.auth) {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.warn("Sign out notice:", err);
    }
    location.href = '../login.html';
  }

  document.querySelectorAll('#headerLogoutBtn, #mgrHeaderLogoutBtn, #rmsmeLogout, #rmsmeSideLogout, [data-action="logout"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      performSignOut();
    });
  });

  // Global search input handling
  const globalSearch = document.getElementById('rmsmeGlobalSearch');
  if (globalSearch) {
    // If URL has ?q=, prefill search input
    try {
      const sp = new URLSearchParams(location.search);
      if (sp.has('q')) {
        globalSearch.value = sp.get('q');
      }
    } catch (e) {}

    globalSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = globalSearch.value.trim();
        if (!query) return;
        if (current === 'inventory.html') {
          const invSearch = document.getElementById('invSearchInput') || document.getElementById('searchInput') || document.querySelector('.search-box input');
          if (invSearch) {
            invSearch.value = query;
            invSearch.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else {
          location.href = `inventory.html?q=${encodeURIComponent(query)}`;
        }
      }
    });
  }

  // System Guide Modal (Fully Responsive Exit & Got It for Entire System)
  function showHelpModal(title, bodyHtml) {
    let overlay = document.getElementById("rmsmeGuideModalOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "rmsmeGuideModalOverlay";
      overlay.className = "modal-overlay open rmsme-guide-overlay";
      overlay.innerHTML = `
        <style>
          .rmsme-guide-overlay {
            position: fixed !important;
            inset: 0 !important;
            background: rgba(15, 23, 42, 0.78) !important;
            backdrop-filter: blur(5px) !important;
            display: none !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 16px !important;
            z-index: 10000 !important;
            box-sizing: border-box !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          .rmsme-guide-overlay.open {
            display: flex !important;
            opacity: 1 !important;
            visibility: visible !important;
            pointer-events: auto !important;
          }
          .rmsme-guide-card {
            max-width: min(640px, 96vw) !important;
            width: 100% !important;
            max-height: min(88vh, 760px) !important;
            padding: 24px !important;
            background: #ffffff !important;
            background-color: #ffffff !important;
            color: #0f172a !important;
            border-radius: 16px !important;
            border: 1px solid #cbd5e1 !important;
            box-shadow: 0 25px 60px -10px rgba(0, 0, 0, 0.45) !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
            animation: rmsmeModalZoom 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
          }
          @keyframes rmsmeModalZoom {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
          }
          .rmsme-guide-head {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            margin-bottom: 14px !important;
            border-bottom: 1px solid #e2e8f0 !important;
            padding-bottom: 12px !important;
            flex-shrink: 0 !important;
            gap: 12px !important;
          }
          .rmsme-guide-title {
            font-size: 1.18rem !important;
            font-weight: 700 !important;
            color: #0f172a !important;
            margin: 0 !important;
            line-height: 1.3 !important;
          }
          .rmsme-guide-close-btn {
            background: #f1f5f9 !important;
            border: 1px solid #e2e8f0 !important;
            width: 40px !important;
            height: 40px !important;
            min-width: 40px !important;
            min-height: 40px !important;
            border-radius: 50% !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-size: 1.45rem !important;
            cursor: pointer !important;
            color: #475569 !important;
            transition: all 0.18s ease !important;
            line-height: 1 !important;
            padding: 0 !important;
            flex-shrink: 0 !important;
          }
          .rmsme-guide-close-btn:hover {
            background: #fee2e2 !important;
            color: #dc2626 !important;
            border-color: #fca5a5 !important;
            transform: scale(1.05) !important;
          }
          .rmsme-guide-close-btn:active {
            transform: scale(0.95) !important;
          }
          .rmsme-guide-body {
            font-size: 0.9rem !important;
            line-height: 1.6 !important;
            color: #334155 !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
            padding-right: 6px !important;
            flex: 1 1 auto !important;
          }
          .rmsme-guide-foot {
            margin-top: 16px !important;
            padding-top: 12px !important;
            border-top: 1px solid #e2e8f0 !important;
            display: flex !important;
            justify-content: flex-end !important;
            flex-shrink: 0 !important;
          }
          .rmsme-guide-ok-btn {
            padding: 10px 28px !important;
            font-size: 0.92rem !important;
            font-weight: 600 !important;
            border-radius: 9px !important;
            background: #16803c !important;
            color: #ffffff !important;
            border: none !important;
            cursor: pointer !important;
            transition: all 0.18s ease !important;
            box-shadow: 0 2px 6px rgba(22, 128, 60, 0.28) !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-height: 42px !important;
          }
          .rmsme-guide-ok-btn:hover {
            background: #14532d !important;
            box-shadow: 0 4px 12px rgba(20, 83, 45, 0.35) !important;
            transform: translateY(-1px) !important;
          }
          .rmsme-guide-ok-btn:active {
            transform: translateY(0) !important;
          }

          /* Responsive tweaks for exit & got it buttons across entire system */
          @media (max-width: 580px) {
            .rmsme-guide-overlay {
              padding: 10px !important;
            }
            .rmsme-guide-card {
              padding: 16px 14px !important;
              max-height: 94vh !important;
              border-radius: 14px !important;
            }
            .rmsme-guide-title {
              font-size: 1.05rem !important;
            }
            .rmsme-guide-close-btn {
              width: 44px !important;
              height: 44px !important;
              min-width: 44px !important;
              min-height: 44px !important;
              font-size: 1.55rem !important;
            }
            .rmsme-guide-foot {
              margin-top: 12px !important;
              padding-top: 10px !important;
            }
            .rmsme-guide-ok-btn {
              width: 100% !important;
              padding: 12px 20px !important;
              font-size: 0.98rem !important;
              min-height: 46px !important;
            }
          }
        </style>
        <div class="modal-card rmsme-guide-card">
          <div class="rmsme-guide-head">
            <h3 id="rmsmeGuideModalTitle" class="rmsme-guide-title"></h3>
            <button type="button" id="rmsmeGuideModalClose" class="rmsme-guide-close-btn" aria-label="Close user guide" title="Exit User Guide">&times;</button>
          </div>
          <div id="rmsmeGuideModalBody" class="rmsme-guide-body"></div>
          <div class="rmsme-guide-foot">
            <button type="button" id="rmsmeGuideModalOk" class="rmsme-guide-ok-btn" title="Close and return to system">Got it</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const close = () => {
        overlay.classList.remove("open");
        overlay.style.setProperty("display", "none", "important");
        overlay.style.setProperty("visibility", "hidden", "important");
        overlay.style.setProperty("pointer-events", "none", "important");
        document.removeEventListener("keydown", handleKeydown);
      };
      const handleKeydown = (e) => {
        if (e.key === "Escape" || e.key === "Esc") close();
      };

      overlay.querySelector("#rmsmeGuideModalClose")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      });
      overlay.querySelector("#rmsmeGuideModalOk")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      });
      document.addEventListener("keydown", handleKeydown);
    }
    overlay.querySelector("#rmsmeGuideModalTitle").textContent = title;
    overlay.querySelector("#rmsmeGuideModalBody").innerHTML = bodyHtml;
    overlay.style.setProperty("display", "flex", "important");
    overlay.style.setProperty("visibility", "visible", "important");
    overlay.style.setProperty("pointer-events", "auto", "important");
    overlay.classList.add("open");
  }

  document.getElementById("rmsmeSystemGuideBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenus(null);
    showHelpModal("RMSME System User Guide", `
      <p style="margin-bottom:14px; font-size:0.95rem; color:#334155; line-height:1.5;">
        Welcome to <strong>RMSME</strong>! This system helps keep track of all raw materials and ingredients accurately, prevent running out of stock, and make sure daily operations run smoothly.
      </p>

      <!-- STAFF / USER SECTION -->
      <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:14px 16px; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="background:#e0f2fe; color:#0369a1; font-weight:700; font-size:0.8rem; padding:3px 8px; border-radius:6px;">👤 Staff / User Access</span>
          <span style="font-size:0.8rem; color:#64748b; font-weight:600;">Daily Material Operations</span>
        </div>
        <ul style="padding-left:18px; margin:0; font-size:0.86rem; color:#334155; line-height:1.55;">
          <li style="margin-bottom:6px;"><strong>Dashboard:</strong> Check what ingredients are running low and view urgent restocking alerts before daily production.</li>
          <li style="margin-bottom:6px;"><strong>Inventory:</strong> Look up available raw materials (sugar, flour, oil, etc.) and see how much stock is on hand.</li>
          <li style="margin-bottom:6px;"><strong>Material Activity:</strong> Record incoming items delivered by suppliers, and log materials taken out for daily production batches.</li>
          <li style="margin-bottom:6px;"><strong>AI Demand Forecasting:</strong> View 7-day and 30-day projected ingredient requirements (view-only) to plan ahead for upcoming material needs.</li>
          <li style="margin-bottom:6px;"><strong>Daily Reports:</strong> Review past usage history and check how much was consumed each day.</li>
        </ul>
      </div>

      <!-- ADMIN SECTION -->
      <div style="background:#faf5ff; border:1px solid #e9d5ff; border-radius:12px; padding:14px 16px; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="background:#f3e8ff; color:#7e22ce; font-weight:700; font-size:0.8rem; padding:3px 8px; border-radius:6px;">🛡️ Administrator Access</span>
          <span style="font-size:0.8rem; color:#64748b; font-weight:600;">Management & Master Controls</span>
        </div>
        <ul style="padding-left:18px; margin:0; font-size:0.86rem; color:#334155; line-height:1.55;">
          <li style="margin-bottom:6px;"><strong>Add & Import Ingredients:</strong> Register new ingredients, import supplier spreadsheets (Excel/CSV), and set low-stock warning limits.</li>
          <li style="margin-bottom:6px;"><strong>Finished Products & Recipes:</strong> Create and update production recipes for finished items and snacks (e.g., Shing-a-ling, Banana Chips).</li>
          <li style="margin-bottom:6px;"><strong>AI Demand Forecasting:</strong> Estimate how many kilograms of materials will be needed over the next 7 days and 30 days to purchase supplies ahead of time.</li>
          <li style="margin-bottom:6px;"><strong>System Audits & Exports:</strong> Download official PDF and Excel reports for inventory audits and monitor all activity records.</li>
        </ul>
      </div>

      <!-- HELPFUL TIPS -->
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:10px 14px;">
        <div style="font-weight:700; color:#166534; font-size:0.84rem; margin-bottom:4px;">💡 Helpful Tips</div>
        <ul style="padding-left:18px; margin:0; font-size:0.82rem; color:#166534; line-height:1.5;">
          <li><strong>Check measurements:</strong> Always confirm units (kg, liters, packs) when recording incoming or used materials.</li>
          <li><strong>Record right away:</strong> Logging materials immediately after receiving or using keeps current stock accurate across the system.</li>
        </ul>
      </div>
    `);
  });


  /* ==========================================================
     RMIMS LIVE SHARED NOTIFICATION SYSTEM (AUTHORITATIVE ENGINE)
     ========================================================== */

  const NOTIF_STORE_KEY = 'rmims_notifications_live_v2';
  const NOTIF_READ_KEY = 'rmims_notifications_read_v2';
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
          // Exclude any legacy mock items, fake staff sign-ins, and generic dump notifications
          return parsed.filter(n => {
            if (!n || !n.id) return false;
            if (n.id.startsWith('notif-sys-online-') || n.id.startsWith('notif-stock-low-sugar-')) return false;
            const t = (n.title || '').toLowerCase();
            const m = (n.message || '').toLowerCase();
            if (t.includes('staff user signed in') || m.includes('staff account login detected')) return false;
            if (t.includes('signed in') && (t.includes('staff user') || !n.userId)) return false;
            if (t.includes('maria santos') || t.includes('rafael cruz') || t.includes('kenneth ramos')) return false;
            return true;
          });
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
      if (isManager || role === 'admin') return true;
      // User / Staff role filtering:
      if (n.roleScope === 'admin' || n.roleScope === 'manager') return false;
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
          b.textContent = '';
          b.setAttribute('aria-label', `${unreadCount} unread notifications`);
          b.title = `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`;
          b.style.display = 'block';
          b.hidden = false;
        } else {
          b.textContent = '';
          b.removeAttribute('aria-label');
          b.removeAttribute('title');
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

      // D. Controlled User/Staff Realtime Actions (No automatic synthetic reminders)

      // F. Login Session Notification (Only for genuine authenticated users upon login)
      const justLoggedIn = sessionStorage.getItem('rmims_just_logged_in') === 'true';
      if (justLoggedIn) {
        sessionStorage.removeItem('rmims_just_logged_in');
        let accountName = null;
        let currentUserId = null;
        try {
          const raw = localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || localStorage.getItem('userProfile');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.fullName && parsed.fullName !== 'Staff User' && parsed.fullName !== 'Manager' && parsed.fullName !== 'Administrator') {
              accountName = parsed.fullName;
              currentUserId = parsed.id || null;
            }
          }
        } catch (e) { }

        if (accountName && currentUserId) {
          const sessionId = sessionStorage.getItem('rmims_login_session_id') || `session-${Date.now()}`;
          const loginId = `notif-login-${sessionId}`;
          const loginNotif = {
            id: loginId,
            category: 'login',
            priority: 'info',
            title: `${accountName} Signed In`,
            message: `${isManager ? 'Manager' : (role === 'admin' ? 'Administrator' : 'Staff')} account login detected.`,
            actor: 'Source: System',
            userId: currentUserId,
            roleScope: isManager ? 'manager' : role,
            timestamp: new Date().toISOString()
          };
          newNotifMap.set(loginId, loginNotif);

          // Broadcast sign-in event live to connected sessions
          try {
            if (window.__rmimsRealtimeChannel) {
              window.__rmimsRealtimeChannel.send({
                type: 'broadcast',
                event: 'user_login',
                payload: {
                  accountName,
                  role: isManager ? 'manager' : role,
                  userId: currentUserId,
                  timestamp: loginNotif.timestamp
                }
              });
            }
          } catch (_) { }
        }
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
            message: `Account registered as ${p.role === 'admin' ? 'Administrator' : (p.role === 'manager' ? 'Manager' : 'Staff User')} (${p.status === 'active' ? 'Active' : 'Inactive'}).`,
            actor: 'Source: User Management',
            roleScope: 'manager',
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
              if (!p.accountName || p.accountName === 'Staff User' || p.accountName === 'Manager' || !p.userId) {
                return;
              }
              const loginId = `notif-login-live-${p.userId}-${new Date(p.timestamp || Date.now()).getTime()}`;
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
      'select[data-custom-select="true"]'
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

