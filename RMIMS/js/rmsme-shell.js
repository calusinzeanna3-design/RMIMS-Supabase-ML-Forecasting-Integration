(function () {
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
      <div class="rmsme-heading"><h1>${title}</h1><p>${subtitle}</p></div>
      <div class="rmsme-header-actions">
        <button class="rmsme-header-btn" id="rmsmeNotificationBtn" aria-label="Notifications" title="Notifications">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><span class="rmsme-notif-dot" id="rmsmeNotifDot"></span>
        </button>
        <button class="rmsme-header-btn" id="rmsmeHelpBtn" aria-label="Help" title="Help">?</button>
        <button class="rmsme-profile-btn" id="rmsmeProfileBtn" aria-expanded="false">
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
  }

  function initials(name) {
    const parts = String(name || 'Account').trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map(x => x[0]).join('') || 'A').toUpperCase();
  }
  function syncIdentity() {
    let name = 'Account', email = '';
    try {
      const candidates = ['currentUser', 'rmimsCurrentUser', 'userProfile', 'user'];
      for (const k of candidates) {
        const raw = localStorage.getItem(k); if (!raw) continue;
        const o = JSON.parse(raw); if (o?.fullName || o?.email) { name = o.fullName || o.name || name; email = o.email || email; break; }
      }
    } catch (e) { }
    const old = document.querySelector('.profile-text');
    if (old && old.textContent && !/loading/i.test(old.textContent) && old.textContent.trim() !== 'Staff Member') name = old.textContent.replace(/\s+▼\s*$/, '').trim() || name;
    document.querySelectorAll('[data-shell-name]').forEach(e => e.textContent = name);
    document.querySelectorAll('[data-shell-email]').forEach(e => e.textContent = email);
    document.querySelectorAll('[data-shell-avatar]').forEach(e => e.textContent = initials(name));
  }
  syncIdentity();
  setTimeout(syncIdentity, 800);

  const profileBtn = document.getElementById('rmsmeProfileBtn'), profile = document.getElementById('rmsmeProfile');
  const notifBtn = document.getElementById('rmsmeNotificationBtn'), notif = document.getElementById('rmsmeNotifications');
  const helpBtn = document.getElementById('rmsmeHelpBtn'), help = document.getElementById('rmsmeHelp');
  function closeMenus(except) { [profile, notif, help].forEach(x => { if (x && x !== except) x.hidden = true; }); }
  profileBtn?.addEventListener('click', () => { const open = profile.hidden; closeMenus(profile); profile.hidden = !open; profileBtn.setAttribute('aria-expanded', String(open)); });
  notifBtn?.addEventListener('click', () => { const open = notif.hidden; closeMenus(notif); notif.hidden = !open; });
  helpBtn?.addEventListener('click', () => { const open = help.hidden; closeMenus(help); help.hidden = !open; });
  document.getElementById('rmsmeLogout')?.addEventListener('click', async () => {
    localStorage.removeItem('rmsmeNotificationRead');
    localStorage.removeItem('rmsmeCurrentUser');
    try {
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

  document.getElementById("rmsmeSystemGuideBtn")?.addEventListener("click", () => {
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

  document.getElementById("rmsmeAboutBtn")?.addEventListener("click", () => {
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

  // Notification state is persistent: reading removes highlight but keeps history.
  const notificationsKey = 'rmsmeNotifications';
  const readKey = 'rmsmeNotificationRead';
  function getNotifications() {
    try {
      let list = JSON.parse(localStorage.getItem(notificationsKey) || '[]').filter(Boolean);
      if (!list.length) {
        list = [
          { id: 'notif-1', title: 'System Online', message: 'Forecast requirement service is active.', type: 'success', time: 'Just now' },
          { id: 'notif-2', title: 'Inventory Alert', message: 'Check materials approaching low stock threshold.', type: 'warning', time: 'Today' }
        ];
        localStorage.setItem(notificationsKey, JSON.stringify(list));
      }
      return list;
    } catch (e) { return []; }
  }
  function getRead() { try { return new Set(JSON.parse(localStorage.getItem(readKey) || '[]')); } catch (e) { return new Set(); } }
  function saveRead(set) { localStorage.setItem(readKey, JSON.stringify([...set])); }
  function renderNotifications() {
    const list = document.getElementById('rmsmeNotificationList'); if (!list) return;
    const data = getNotifications(), read = getRead();
    list.innerHTML = '';
    if (!data.length) { list.innerHTML = '<div class="rmsme-empty">No notifications yet.</div>'; document.getElementById('rmsmeNotifDot').style.display = 'none'; return; }
    data.slice(0, 8).forEach((n, i) => {
      const id = String(n.id || `${n.type || 'notice'}-${n.createdAt || i}`), isRead = read.has(id);
      const item = document.createElement('button'); item.type = 'button'; item.className = 'rmsme-notification-item ' + (isRead ? 'read' : 'unread');
      const notifIcon = n.type === 'warning' ? '<svg viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17h.01"/></svg>' : n.type === 'success' ? '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'; item.innerHTML = `<span class="rmsme-notif-icon">${notifIcon}</span><span><strong>${String(n.title || 'Notification')}</strong><small>${String(n.message || '')}</small><em>${String(n.time || 'Just now')}</em></span>${isRead ? '' : '<b>NEW</b>'}`;
      item.addEventListener('click', () => { read.add(id); saveRead(read); renderNotifications(); }); list.appendChild(item);
    });
    const unread = data.filter(n => !read.has(String(n.id || `${n.type || 'notice'}-${n.createdAt || 0}`))).length;
    document.getElementById('rmsmeNotifDot').style.display = unread ? 'block' : 'none';
  }
  document.getElementById('rmsmeMarkAll')?.addEventListener('click', () => { const set = getRead(); getNotifications().forEach((n, i) => set.add(String(n.id || `${n.type || 'notice'}-${n.createdAt || i}`))); saveRead(set); renderNotifications(); });
  renderNotifications();

  // Keep existing page-specific notification records compatible with the new shell.
  window.RMSME = window.RMSME || {};
  window.RMSME.pushNotification = function (n) {
    const data = getNotifications(); data.unshift({ ...n, id: n.id || `${Date.now()}-${Math.random()}` }); localStorage.setItem(notificationsKey, JSON.stringify(data.slice(0, 50))); renderNotifications();
  };
})();
