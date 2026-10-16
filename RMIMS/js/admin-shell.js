import './rmims-notifications.js';

(function () {
  'use strict';

  // Format and update live clock for frontdesk monitoring card and topbar
  function updateLiveClock() {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateNum = now.getDate();
    // Guarantee 2026 accurate year
    const year = now.getFullYear() < 2026 ? 2026 : now.getFullYear();

    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 hour is 12
    const hStr = String(hours).padStart(2, '0');

    // 1. Update Frontdesk Monitoring Clock (Image 1 Style)
    const fdTime = document.getElementById('frontdeskTime');
    const fdPeriod = document.getElementById('frontdeskPeriod');
    const fdDate = document.getElementById('frontdeskDate');

    if (fdTime) {
      fdTime.textContent = `${hStr}:${minutes}:${seconds}`;
    }
    if (fdPeriod) {
      fdPeriod.textContent = ampm;
    }
    if (fdDate) {
      // Format matching Image 1: "Wednesday, 3 July 2024" -> "Thursday, 24 September 2026"
      fdDate.textContent = `${dayName}, ${dateNum} ${monthName} ${year}`;
    }

    // 2. Update Topbar Clock (all admin pages)
    const clockEls = document.querySelectorAll('.topbar-clock');
    clockEls.forEach((clockEl) => {
      const textEl = clockEl.querySelector('.topbar-clock-text') || clockEl;
      textEl.textContent = `${dayName}, ${monthName} ${dateNum}, ${year} | ${hStr}:${minutes}:${seconds} ${ampm}`;
    });
  }

  // Active navigation highlight
  function highlightActiveNav() {
    const currentPath = window.location.pathname.toLowerCase();
    const navLinks = document.querySelectorAll('.sidebar-nav .nav-link, .sidebar-bottom-nav .nav-link');

    navLinks.forEach(link => {
      const href = (link.getAttribute('href') || '').toLowerCase();
      if (!href) return;
      const hrefBase = href.split('/').pop();
      const currentBase = currentPath.split('/').pop() || 'overview.html';

      if (hrefBase === currentBase || (currentBase === '' && hrefBase === 'overview.html')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  // Toast notification system
  window.showAdminToast = function (message, type = 'success') {
    let toast = document.getElementById('adminToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'adminToast';
      toast.className = 'admin-toast';
      document.body.appendChild(toast);
    }

    toast.className = `admin-toast ${type} show`;
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        ${type === 'success' 
          ? '<polyline points="20 6 9 17 4 12"></polyline>' 
          : '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'}
      </svg>
      <span>${message}</span>
    `;

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  };

  // Profile click dropdown and session menu
  function setupProfileMenu() {
    const profileBtn = document.querySelector('.topbar-profile');
    if (!profileBtn) return;

    // Check if anchor wrapper exists; if not, wrap profileBtn
    let anchor = profileBtn.closest('.rmsme-popover-anchor');
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.className = 'rmsme-popover-anchor';
      anchor.id = 'adminProfileAnchor';
      profileBtn.parentNode.insertBefore(anchor, profileBtn);
      anchor.appendChild(profileBtn);
    }

    let dropdown = document.getElementById('profileDropdown') || document.getElementById('adminProfileDropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'profileDropdown';
      dropdown.className = 'rmsme-popover mgr-profile-dropdown admin-profile-dropdown';
      dropdown.hidden = true;
      dropdown.innerHTML = `
        <div class="mgr-profile-head">
          <div class="mgr-online-badge">
            <span class="mgr-status-indicator"></span>
            <div>
              <strong id="dropdownAdminName" data-shell-name>Admin</strong>
              <small data-shell-role style="display:block; color:#5C7A68; font-size:11.5px;">Main Admin</small>
            </div>
          </div>
        </div>
        <div class="mgr-popover-divider"></div>
        <a href="settings.html" class="mgr-popover-item admin-popover-item" id="headerAccountLink">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Account
        </a>
        <div class="mgr-popover-divider"></div>
        <button type="button" class="mgr-popover-item admin-popover-item text-danger" id="headerLogoutBtn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Logout
        </button>
      `;
      anchor.appendChild(dropdown);
    }

    profileBtn.style.cursor = 'pointer';

    function closeAdminMenu() {
      dropdown.hidden = true;
      dropdown.classList.remove('open');
      profileBtn.setAttribute('aria-expanded', 'false');
    }

    function toggleAdminMenu() {
      const willOpen = dropdown.hidden;
      dropdown.hidden = !willOpen;
      if (willOpen) {
        dropdown.classList.add('open');
        profileBtn.setAttribute('aria-expanded', 'true');
        const curName = document.querySelector('.profile-name')?.textContent || 'Admin';
        const nameSlot = dropdown.querySelector('#dropdownAdminName, [data-shell-name]');
        if (nameSlot) nameSlot.textContent = curName;
      } else {
        dropdown.classList.remove('open');
        profileBtn.setAttribute('aria-expanded', 'false');
      }
    }

    profileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAdminMenu();
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#profileAnchor, #adminProfileAnchor') && !e.target.closest('.mgr-profile-dropdown, .admin-profile-dropdown') && !e.target.closest('.topbar-profile')) {
        closeAdminMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAdminMenu();
      }
    });

    dropdown.querySelector('#headerLogoutBtn, #adminHeaderLogoutBtn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      localStorage.removeItem('adminUser');
      localStorage.removeItem('rmimsAdminUser');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('userProfile');
      localStorage.removeItem('rmsmeCurrentUser');
      try {
        sessionStorage.clear();
        const { supabase } = await import('../supabase/supabase-config.js');
        if (supabase && supabase.auth) {
          await supabase.auth.signOut();
        }
      } catch (_) {}
      window.location.href = '../login.html';
    });
  }

  // Bell notifications toggle
  function setupNotifications() {
    const bellBtn = document.querySelector('#notificationBtn, .topbar-icon-btn, #adminNotificationBtn');
    if (!bellBtn) return;

    if (!bellBtn.id) bellBtn.id = 'notificationBtn';
    bellBtn.setAttribute('title', 'Notifications');
    bellBtn.setAttribute('aria-label', 'Notifications');

    if (window.RMIMS_NOTIFICATIONS_POPUP) {
      window.RMIMS_NOTIFICATIONS_POPUP.updateBadges('admin');
    }

    bellBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.RMIMS_NOTIFICATIONS_POPUP) {
        window.RMIMS_NOTIFICATIONS_POPUP.open('admin');
      }
    });
  }

  // Help Center Modal & Accordion Setup (Image 2 & Image 3)
  function setupHelpCenter() {
    // 1. Ensure modal backdrop is injected
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
              <p>Quick answers to common questions and onboarding resources.</p>
            </div>
            <button type="button" class="help-modal-close-btn" id="btnCloseHelpCenter" aria-label="Close Help Center">&times;</button>
          </div>

          <!-- FAQ Accordion List (Image 3 Style) -->
          <div class="help-faq-list">
            <!-- Item 1: How do I create a branch store? -->
            <div class="help-faq-item">
              <button type="button" class="help-faq-trigger">
                <span class="help-faq-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="16"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                </span>
                <span class="help-faq-question">How do I create a branch store?</span>
                <svg class="help-faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <div class="help-faq-answer">
                Navigate to <strong>Branch Stores</strong> in the sidebar and click <strong>+ Add Branch Store</strong>. Specify the municipality location, business trade name, store category, and primary manager credentials to register a new store unit.
              </div>
            </div>

            <!-- Item 2: How can I invite collaborators? -->
            <div class="help-faq-item">
              <button type="button" class="help-faq-trigger">
                <span class="help-faq-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/>
                    <line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                </span>
                <span class="help-faq-question">How can I invite collaborators?</span>
                <svg class="help-faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <div class="help-faq-answer">
                Open the <strong>User Management</strong> module and click <strong>+ Add User</strong>. Enter their full name, work email address, assigned branch location, and operational role (Manager or Branch Staff).
              </div>
            </div>

            <!-- Item 3: What file formats are supported? -->
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
                <span class="help-faq-question">What file formats are supported?</span>
                <svg class="help-faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <div class="help-faq-answer">
                RMIMS supports structured <strong>CSV exports</strong> for audit activity logs, movement ledgers, inventory counts, and forecasting summary data, along with official print-ready PDF reports.
              </div>
            </div>

            <!-- Item 4: How do I manage workspace settings? -->
            <div class="help-faq-item">
              <button type="button" class="help-faq-trigger">
                <span class="help-faq-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                </span>
                <span class="help-faq-question">How do I manage workspace settings?</span>
                <svg class="help-faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <div class="help-faq-answer">
                Access the <strong>Settings</strong> module pinned at the bottom of the sidebar to configure administrator profiles, system diagnostics frequency, security session rules, and notification preferences.
              </div>
            </div>
          </div>

          <!-- Quick Start Guide Card (Image 3 Style) -->
          <div class="help-guide-card">
            <div class="help-guide-title-row">
              <h4 class="help-guide-title">New to RMIMS?</h4>
              <span class="help-guide-badge">Guide</span>
            </div>
            <p class="help-guide-text">Follow our quick start guide to learn how to create branch stores, upload materials, and manage system operations.</p>
            <button type="button" class="btn-start-guide" id="btnStartOnboardingGuide">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="10"/>
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
              </svg>
              <span>Start Guide</span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modalBackdrop);
    }

    // 2. Open / Close triggers
    const openBtn = document.getElementById('btnSidebarHelp');
    const closeBtn = document.getElementById('btnCloseHelpCenter');

    function openHelp() {
      modalBackdrop.classList.add('show');
    }

    function closeHelp() {
      modalBackdrop.classList.remove('show');
    }

    if (openBtn) {
      openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openHelp();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', closeHelp);
    }

    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeHelp();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalBackdrop.classList.contains('show')) {
        closeHelp();
      }
    });

    // 3. Accordion toggling
    const faqTriggers = modalBackdrop.querySelectorAll('.help-faq-trigger');
    faqTriggers.forEach(trigger => {
      trigger.addEventListener('click', () => {
        const item = trigger.closest('.help-faq-item');
        if (!item) return;
        const isActive = item.classList.contains('active');
        
        // Optional accordion behavior: collapse others or just toggle clicked
        faqTriggers.forEach(t => {
          const other = t.closest('.help-faq-item');
          if (other && other !== item) other.classList.remove('active');
        });

        if (isActive) {
          item.classList.remove('active');
        } else {
          item.classList.add('active');
        }
      });
    });

    // 4. Start Guide Button -> Triggers Onboarding ("when we say guide is onboarding")
    const startGuideBtn = document.getElementById('btnStartOnboardingGuide');
    if (startGuideBtn) {
      startGuideBtn.addEventListener('click', async () => {
        closeHelp();
        try {
          const { startRmimsTour } = await import('./onboarding.js');
          if (typeof startRmimsTour === 'function') {
            await startRmimsTour({ force: true });
          }
        } catch (err) {
          console.warn('Could not launch onboarding tour module:', err);
          window.showAdminToast('Starting RMIMS interactive onboarding guide...', 'success');
        }
      });
    }
  }

  function setAdminDefaultProfile() {
    document.querySelectorAll('.profile-name').forEach(el => { el.textContent = 'Admin'; });
    document.querySelectorAll('.profile-role').forEach(el => { el.textContent = 'Main Admin'; });
    document.querySelectorAll('.profile-avatar').forEach(el => { el.textContent = 'A'; });
    const greetingEl = document.getElementById('overviewWelcomeGreeting');
    if (greetingEl) {
      greetingEl.textContent = 'Welcome back!';
    }
  }

  // Dynamic session sync for admin topbar profile
  function syncAdminProfile() {
    try {
      const userStr = localStorage.getItem('adminUser') || localStorage.getItem('rmimsAdminUser') || localStorage.getItem('currentUser') || localStorage.getItem('userProfile') || localStorage.getItem('rmimsCurrentUser');
      if (!userStr) {
        setAdminDefaultProfile();
        window.location.href = '../login.html';
        return;
      }
      const user = JSON.parse(userStr);
      if (!user) {
        setAdminDefaultProfile();
        window.location.href = '../login.html';
        return;
      }

      const cleanEmail = (user.email || '').toLowerCase();
      if (cleanEmail === 'admin@rmims.ph' || cleanEmail === 'manager@rmims.ph' || cleanEmail === 'staff@rmims.ph') {
        localStorage.removeItem('adminUser');
        localStorage.removeItem('rmimsAdminUser');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('userProfile');
        localStorage.removeItem('rmimsCurrentUser');
        window.location.href = '../login.html';
        return;
      }

      // Check if user is genuinely an Admin
      const isAdmin = user.role === 'admin' || user.role === 'main_admin' || user.operationalRole === 'admin' || cleanEmail === 'calusinzeanna3@gmail.com';
      const isKnownNonAdmin = (user.name || user.fullName || '').toLowerCase().includes('maria santos') || user.role === 'user' || user.role === 'staff' || user.role === 'manager';

      if (!isAdmin || isKnownNonAdmin) {
        setAdminDefaultProfile();
        return;
      }

      const name = user.fullName || user.name || user.username || 'Admin';
      const role = 'Main Admin';
      const initial = (name.trim()[0] || 'A').toUpperCase();

      document.querySelectorAll('.profile-name').forEach(el => {
        el.textContent = name;
      });
      document.querySelectorAll('.profile-role').forEach(el => {
        el.textContent = role;
      });
      const uid = user.id || user.uid;
      const avatarUrl = localStorage.getItem('rmims_admin_avatar') || (uid ? localStorage.getItem(`rmims_avatar_${uid}`) : '') || user.avatarUrl;

      document.querySelectorAll('.profile-avatar').forEach(el => {
        if (avatarUrl) {
          el.innerHTML = `<img src="${avatarUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
        } else {
          el.textContent = initial;
        }
      });

      const greetingEl = document.getElementById('overviewWelcomeGreeting');
      if (greetingEl) {
        greetingEl.textContent = `Welcome back, ${name}!`;
      }
    } catch (_) {
      setAdminDefaultProfile();
    }
  }

  // One-time self-healing cleanser for legacy mock/sample data across browser storage
  function cleanseLegacyMockData() {
    try {
      // 1. Cleanse legacy mock branch stores
      const rawStores = localStorage.getItem('RMIMS_BRANCH_STORES_V3');
      if (rawStores) {
        const mockTokens = ['kxc', 'scones', 'lucena bakers hub', 'sweet treats', 'rafael cruz', 'kenneth lim', 'victor morales'];
        if (mockTokens.some(tok => rawStores.toLowerCase().includes(tok))) {
          const parsed = JSON.parse(rawStores);
          const clean = {};
          Object.entries(parsed).forEach(([id, st]) => {
            const combined = `${id} ${st.name || ''} ${st.location || ''} ${(st.managers || []).map(m => m.name).join(' ')}`.toLowerCase();
            if (!mockTokens.some(tok => combined.includes(tok))) {
              clean[id] = st;
            }
          });
          localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(clean));
          window.dispatchEvent(new Event('rmims_stores_updated'));
        }
      }

      // 1. Permanent removal of all existing user accounts across the system
      if (!localStorage.getItem('rmims_all_accounts_permanently_purged_v2')) {
        localStorage.setItem('rmims_registered_users', JSON.stringify([]));
        localStorage.setItem('rmims_pending_users', JSON.stringify([]));
        
        // Remove personnel from branch stores
        const rawStores = localStorage.getItem('RMIMS_BRANCH_STORES_V3');
        if (rawStores) {
          try {
            const stores = JSON.parse(rawStores);
            Object.values(stores).forEach(st => {
              st.managers = [];
              st.staff = [];
            });
            localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(stores));
            window.dispatchEvent(new Event('rmims_stores_updated'));
          } catch (_) {}
        }
        
        // Clear active session accounts
        localStorage.removeItem('currentUser');
        localStorage.removeItem('rmimsCurrentUser');
        localStorage.removeItem('adminUser');
        localStorage.removeItem('managerUser');
        localStorage.removeItem('staffUser');
        localStorage.removeItem('userProfile');
        localStorage.removeItem('rmimsAdminUser');
        localStorage.removeItem('rmims_logged_in_user');
        
        localStorage.setItem('rmims_all_accounts_permanently_purged_v2', 'true');
        window.dispatchEvent(new Event('rmims_registered_users_updated'));
        window.dispatchEvent(new Event('rmims_pending_users_updated'));
        window.dispatchEvent(new Event('storage'));
      }

      // Check and wipe stale demo or Main Administrator session from localStorage
      ['currentUser', 'adminUser', 'rmimsAdminUser', 'userProfile', 'rmimsCurrentUser', 'managerUser', 'staffUser'].forEach(key => {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const p = JSON.parse(raw);
            const name = (p.fullName || p.name || '').toLowerCase();
            const email = (p.email || '').toLowerCase();
            if (name === 'main administrator' || email.includes('@rmims.ph')) {
              localStorage.removeItem(key);
            }
          } catch (_) {}
        }
      });

      // 2. Cleanse legacy mock registered users
      const rawUsers = localStorage.getItem('rmims_registered_users');
      if (rawUsers) {
        const mockUserTokens = ['maria santos', 'kenneth ramos', 'rafael cruz', 'alyssa lim', 'carla mendoza', 'carlos mendoza', 'victor morales', 'ethan cruz', 'sarah gomez'];
        if (mockUserTokens.some(tok => rawUsers.toLowerCase().includes(tok))) {
          const parsed = JSON.parse(rawUsers);
          if (Array.isArray(parsed)) {
            const clean = parsed.filter(u => {
              const combined = `${u.name || ''} ${u.username || ''} ${u.email || ''}`.toLowerCase();
              return !mockUserTokens.some(tok => combined.includes(tok));
            });
            localStorage.setItem('rmims_registered_users', JSON.stringify(clean));
            window.dispatchEvent(new Event('rmims_registered_users_updated'));
          }
        }
      }

      // 3. Cleanse orphaned dummy activity logs lacking branch or user info
      const rawAct = localStorage.getItem('rmims_manager_activities');
      if (rawAct) {
        const parsed = JSON.parse(rawAct);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter(item => {
            const details = (item.details || item.activity || '').trim();
            const user = (item.user || '').trim();
            const bLoc = (item.branchLoc || item.branch || '').trim();
            const bName = (item.branchName || '').trim();
            // In a clean multi-branch system, real logs must belong to an actual branch and named user
            const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
            const isPlaceholderUser = !user || user.toLowerCase() === 'store manager' || user.toLowerCase() === 'store staff';
            const isMockAction = ['receive', 'approve transaction', 'disburse'].includes(details.toLowerCase());
            const txt = `${user} ${details} ${bLoc} ${bName}`.toLowerCase();
            const hasMock = txt.includes('kxc') || txt.includes('scones') || txt.includes('simulated_user') || txt.includes('demo') || txt.includes('john reyes');
            
            // If it has no branch, is a placeholder user, or has mock tokens, purge it
            if (!hasBranch || isPlaceholderUser || isMockAction || hasMock) {
              return false;
            }
            return true;
          });
          if (clean.length !== parsed.length) {
            localStorage.setItem('rmims_manager_activities', JSON.stringify(clean));
          }
        }
      }

      // 4. Cleanse legacy mock staff transactions
      const rawStaffTx = localStorage.getItem('rmims_staff_transactions');
      if (rawStaffTx) {
        const parsed = JSON.parse(rawStaffTx);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter(tx => {
            const ref = tx.ref || '';
            const staff = (tx.staff || tx.user || '').toLowerCase();
            const bLoc = (tx.branchLoc || '').trim();
            const bName = (tx.branchName || '').trim();
            const isMockRef = ['REC-2026-00125', 'DIS-2026-00091', 'REC-2026-00124', 'DIS-2026-00088', 'REC-2026-00120'].includes(ref);
            const isMockStaff = staff.includes('john reyes') || staff.includes('maria santos');
            const noBranch = !bLoc && !bName;
            return !isMockRef && !isMockStaff && !noBranch;
          });
          if (clean.length !== parsed.length) {
            localStorage.setItem('rmims_staff_transactions', JSON.stringify(clean));
          }
        }
      }

      // 5. Cleanse legacy mock receipts and disbursements lacking branch
      const rawMgrRec = localStorage.getItem('rmims_manager_receipts');
      if (rawMgrRec) {
        const parsed = JSON.parse(rawMgrRec);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter(r => {
            const isMockRef = ['REC-2026-00125', 'REC-2026-00124', 'REC-2026-00120', 'REC-2026-00118'].includes(r.ref);
            const noBranch = !(r.branchLoc || '').trim() && !(r.branchName || '').trim();
            return !isMockRef && !noBranch;
          });
          if (clean.length !== parsed.length) {
            localStorage.setItem('rmims_manager_receipts', JSON.stringify(clean));
          }
        }
      }

      const rawMgrDisb = localStorage.getItem('rmims_manager_disbursements');
      if (rawMgrDisb) {
        const parsed = JSON.parse(rawMgrDisb);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter(d => {
            const isMockRef = ['DIS-2026-00091', 'DIS-2026-00088'].includes(d.ref);
            const noBranch = !(d.branchLoc || '').trim() && !(d.branchName || '').trim();
            return !isMockRef && !noBranch;
          });
          if (clean.length !== parsed.length) {
            localStorage.setItem('rmims_manager_disbursements', JSON.stringify(clean));
          }
        }
      }

      // 6. Cleanse fake staff login notifications from shared storage
      const rawNotif = localStorage.getItem('rmims_notifications_live_v2');
      if (rawNotif) {
        const parsed = JSON.parse(rawNotif);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter(n => {
            if (!n || !n.id) return false;
            const t = (n.title || '').toLowerCase();
            const m = (n.message || '').toLowerCase();
            if (t.includes('staff user') || m.includes('staff account login detected')) return false;
            if (t.includes('signed in') && (t.includes('staff user') || !n.userId)) return false;
            if (t.includes('maria santos') || t.includes('rafael cruz') || t.includes('kenneth ramos')) return false;
            return true;
          });
          if (clean.length !== parsed.length) {
            localStorage.setItem('rmims_notifications_live_v2', JSON.stringify(clean));
            window.dispatchEvent(new CustomEvent('rmims:notification_change'));
          }
        }
      }
    } catch (_) {}
  }

  // Run cleanser immediately
  cleanseLegacyMockData();

  // Mobile Navigation Drawer Controller
  function setupMobileDrawer() {
    let mobileMenuBtn = document.getElementById('rmsmeMobileMenuBtn') || document.querySelector('.mobile-sidebar-toggle');
    const topbarLeft = document.querySelector('.admin-topbar .topbar-left, .topbar .topbar-left, .topbar-left');
    
    if (topbarLeft) {
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

    function toggleDrawer(open) {
      const shouldOpen = open !== undefined ? open : !document.body.classList.contains('rmsme-mobile-drawer-open');
      document.body.classList.toggle('rmsme-mobile-drawer-open', shouldOpen);
      const activeSidebar = document.querySelector('.admin-sidebar, .sidebar');
      if (activeSidebar) {
        activeSidebar.classList.toggle('mobile-open', shouldOpen);
      }
    }

    mobileMenuBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDrawer();
    });

    drawerBackdrop?.addEventListener('click', () => {
      toggleDrawer(false);
    });

    const activeSidebar = document.querySelector('.admin-sidebar, .sidebar');
    activeSidebar?.querySelectorAll('a, button').forEach(link => {
      if (link.id !== 'rmsmeMobileMenuBtn') {
        link.addEventListener('click', () => toggleDrawer(false));
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    cleanseLegacyMockData();
    updateLiveClock();
    setInterval(updateLiveClock, 1000); // live 1-second accurate frontdesk clock monitoring
    highlightActiveNav();
    syncAdminProfile();
    setupProfileMenu();
    setupNotifications();
    setupHelpCenter();
    setupMobileDrawer();
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'currentUser' || e.key === 'userProfile' || e.key === 'rmimsCurrentUser') {
      syncAdminProfile();
    }
  });
})();
