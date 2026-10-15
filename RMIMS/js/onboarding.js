/* ============================================================
   RMIMS — SPOTLIGHT INTERACTIVE ONBOARDING TOUR ENGINE (JS)
   Clean, reliable section-highlighting tour with backdrop blur,
   dynamic element spotlight, step-by-step guidance, and
   Help Center "Explore Guide" replay support.
   ============================================================ */

function ensureOnboardingCSS() {
  if (document.getElementById('rmimsOnboardingCss')) return;
  const link = document.createElement('link');
  link.id = 'rmimsOnboardingCss';
  link.rel = 'stylesheet';

  const isSubFolder =
    window.location.pathname.includes('/manager/') ||
    window.location.pathname.includes('/admin/') ||
    window.location.pathname.includes('/user/');
  link.href = isSubFolder ? '../css/onboarding.css?v=20261015_spotlight' : 'css/onboarding.css?v=20261015_spotlight';
  document.head.appendChild(link);
}

/**
 * System Tour Steps Catalog with authentic RMIMS descriptions
 */
const SYSTEM_TOUR_STEPS = [
  {
    id: 'navigation',
    selector: '.sidebar-nav, .admin-sidebar nav, .admin-sidebar',
    title: 'Navigation Menu',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    desc: 'Use the primary navigation menu to quickly navigate between your Dashboard operations, Raw Materials Inventory catalog, Stock Deliveries (Receive), Material Issuance (Disburse), Analytics & AI Forecasting, Current Reports, and Staff Activity.'
  },
  {
    id: 'clock',
    selector: '#topbarClock, #frontdeskClockCard, .topbar-clock',
    title: 'Date & Time Clock',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    desc: 'This tracks real-time system clock to ensure all batch transactions, incoming supplier deliveries, operational disbursements, and audit logs maintain synchronized timestamps across your branch.'
  },
  {
    id: 'alerts',
    selector: '#notifAnchor, #notificationBtn',
    title: 'System Notifications',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    desc: 'Review live system alerts, stock notifications, and low threshold warnings to stay on top of critical raw material levels.'
  },
  {
    id: 'profile_settings',
    selector: '#profileAnchor, .topbar-profile, #profileBtn',
    title: 'Account Settings & Logout',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    desc: 'Click your profile pill anytime to open this dropdown menu. Here you can access Account & Settings to configure your credentials and store preferences, and find the Logout button to securely exit your session.',
    isOpenDropdown: true
  },
  {
    id: 'main_workspace',
    selector: '.admin-scroll-body, main.admin-scroll-body, .admin-main, main, .main-content',
    title: 'Main Operations Workspace',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`,
    desc: 'This is your central operational workspace. Across all modules, this main workspace presents your active store inventory ledgers, raw material inflow & outflow transactions, real-time analytics telemetry, AI forecasting projections, and official audit reports.'
  },
  {
    id: 'help_guide',
    selector: '#btnSidebarHelp, #mgrSideHelp, .nav-btn-help',
    title: 'Help Center & Tour Guide',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    desc: 'Need a refresher on store operations or standards? Open the Help Center anytime or click "Explore Guide" in the Help Center to restart this interactive walkthrough whenever you want.'
  }
];

let activeTourInstance = null;

/**
 * Starts the modern interactive spotlight tour.
 */
export function startRmimsTour(options = {}) {
  ensureOnboardingCSS();

  // Close any currently running tour
  if (activeTourInstance) {
    activeTourInstance.destroy();
  }

  // Filter steps down to elements that are actually present and visible in the current DOM
  const availableSteps = [];
  SYSTEM_TOUR_STEPS.forEach(stepDef => {
    const el = document.querySelector(stepDef.selector);
    if (el) {
      const rect = el.getBoundingClientRect();
      // Ensure element has dimension
      if (rect.width > 0 && rect.height > 0) {
        availableSteps.push({ ...stepDef, targetElement: el });
      }
    }
  });

  if (availableSteps.length === 0) {
    console.warn('[RMIMS Tour] No tour target elements found on current page.');
    return Promise.resolve();
  }

  return new Promise(resolve => {
    let currentStepIdx = 0;

    // 1. Create Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'rmims-tour-backdrop';
    backdrop.id = 'rmimsTourBackdrop';

    // 2. Create Spotlight Glow Box
    const spotlightBox = document.createElement('div');
    spotlightBox.className = 'rmims-tour-spotlight-box';
    spotlightBox.id = 'rmimsTourSpotlightBox';

    // 3. Create Guidance Card
    const card = document.createElement('div');
    card.className = 'rmims-tour-card';
    card.id = 'rmimsTourCard';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    document.body.appendChild(backdrop);
    document.body.appendChild(spotlightBox);
    document.body.appendChild(card);

    // Trigger initial fade-in
    requestAnimationFrame(() => {
      backdrop.classList.add('active');
      spotlightBox.classList.add('active');
      card.classList.add('active');
    });

    function closeProfileDropdownIfOpen() {
      const dropdown = document.getElementById('profileDropdown') || document.getElementById('mgrProfileDropdown') || document.querySelector('.mgr-profile-dropdown, .profile-dropdown');
      if (dropdown) {
        dropdown.hidden = true;
        dropdown.setAttribute('hidden', '');
        dropdown.classList.remove('open');
      }
      document.querySelectorAll('.rmims-tour-open-highlight').forEach(el => el.classList.remove('rmims-tour-open-highlight'));
    }

    function updateHighlightAndPosition() {
      const step = availableSteps[currentStepIdx];
      if (!step || !step.targetElement) return;

      const el = step.targetElement;
      let rect = el.getBoundingClientRect();
      const pad = 8;

      if (step.isOpenDropdown) {
        const dropdown = document.getElementById('profileDropdown') || document.getElementById('mgrProfileDropdown') || document.querySelector('.mgr-profile-dropdown, .profile-dropdown');
        if (dropdown) {
          dropdown.removeAttribute('hidden');
          dropdown.hidden = false;
          dropdown.classList.add('open');
          el.classList.add('rmims-tour-open-highlight');
          const dropRect = dropdown.getBoundingClientRect();
          if (dropRect.width > 0 && dropRect.height > 0) {
            rect = {
              left: Math.min(rect.left, dropRect.left),
              top: Math.min(rect.top, dropRect.top),
              right: Math.max(rect.right, dropRect.right),
              bottom: Math.max(rect.bottom, dropRect.bottom)
            };
          }
        }
      } else {
        closeProfileDropdownIfOpen();
      }

      const left = Math.max(0, rect.left - pad);
      const top = Math.max(0, rect.top - pad);
      const right = Math.min(window.innerWidth, (rect.right !== undefined ? rect.right : rect.left + rect.width) + pad);
      const bottom = Math.min(window.innerHeight, (rect.bottom !== undefined ? rect.bottom : rect.top + rect.height) + pad);
      const width = Math.max(20, right - left);
      const height = Math.max(20, bottom - top);

      // Cutout hole in backdrop so background outside is blurred/dimmed, and target is crystal clear
      backdrop.style.clipPath = `polygon(
        0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%,
        ${left}px ${top}px,
        ${right}px ${top}px,
        ${right}px ${bottom}px,
        ${left}px ${bottom}px,
        ${left}px ${top}px
      )`;

      // Position spotlight glowing border box exactly over target
      spotlightBox.style.left = `${left}px`;
      spotlightBox.style.top = `${top}px`;
      spotlightBox.style.width = `${width}px`;
      spotlightBox.style.height = `${height}px`;

      // Position Floating Card adjacent to spotlight
      positionTourCard(card, { left, top, right, bottom, width, height }, step);
    }

    function positionTourCard(cardEl, spot, step) {
      const cardRect = cardEl.getBoundingClientRect();
      const gap = 16;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let cardLeft, cardTop;

      // Profile dropdown step check (position card to the Left of the open dropdown)
      if (step && step.isOpenDropdown && spot.left - gap - cardRect.width >= 16) {
        cardLeft = spot.left - gap - cardRect.width;
        cardTop = Math.max(16, spot.top);
        cardEl.style.left = `${Math.round(cardLeft)}px`;
        cardEl.style.top = `${Math.round(cardTop)}px`;
        return;
      }

      // Broad workspace check (when highlighting the entire content side)
      if (spot.width > vw * 0.45 && spot.height > vh * 0.45) {
        cardLeft = Math.max(16, spot.left + (spot.width - cardRect.width) / 2);
        cardTop = Math.max(16, spot.top + Math.min(60, (spot.height - cardRect.height) / 2));
        cardEl.style.left = `${Math.round(cardLeft)}px`;
        cardEl.style.top = `${Math.round(cardTop)}px`;
        return;
      }

      // 1. Try placing to the Right (ideal for sidebar navigation)
      if (spot.right + gap + cardRect.width <= vw - 16) {
        cardLeft = spot.right + gap;
        cardTop = Math.max(16, Math.min(spot.top, vh - cardRect.height - 16));
      }
      // 2. Try placing Below (ideal for topbar clock, search, buttons)
      else if (spot.bottom + gap + cardRect.height <= vh - 16) {
        cardTop = spot.bottom + gap;
        cardLeft = Math.max(16, Math.min(spot.left, vw - cardRect.width - 16));
      }
      // 3. Try placing to the Left
      else if (spot.left - gap - cardRect.width >= 16) {
        cardLeft = spot.left - gap - cardRect.width;
        cardTop = Math.max(16, Math.min(spot.top, vh - cardRect.height - 16));
      }
      // 4. Try placing Above
      else if (spot.top - gap - cardRect.height >= 16) {
        cardTop = spot.top - gap - cardRect.height;
        cardLeft = Math.max(16, Math.min(spot.left, vw - cardRect.width - 16));
      }
      // 5. Fallback: Center on screen
      else {
        cardLeft = Math.max(16, (vw - cardRect.width) / 2);
        cardTop = Math.max(16, (vh - cardRect.height) / 2);
      }

      cardEl.style.left = `${Math.round(cardLeft)}px`;
      cardEl.style.top = `${Math.round(cardTop)}px`;
    }

    function renderStep() {
      const step = availableSteps[currentStepIdx];
      const isFirst = currentStepIdx === 0;
      const isLast = currentStepIdx === availableSteps.length - 1;
      const stepLabel = `${currentStepIdx + 1} / ${availableSteps.length}`;

      card.innerHTML = `
        <div class="rmims-tour-header">
          <div class="rmims-tour-title-group">
            <div class="rmims-tour-icon-wrap">
              ${step.icon}
            </div>
            <h3 class="rmims-tour-title">${step.title}</h3>
          </div>
          <span class="rmims-tour-step-pill">${stepLabel}</span>
        </div>

        <div class="rmims-tour-body">
          <p class="rmims-tour-desc">${step.desc}</p>
        </div>

        <div class="rmims-tour-footer">
          <button type="button" class="rmims-tour-btn-skip" id="rmimsTourSkipBtn">Skip Tour</button>
          <div class="rmims-tour-nav-btns">
            ${!isFirst ? `
              <button type="button" class="rmims-tour-btn-prev" id="rmimsTourPrevBtn">
                &larr; Previous
              </button>
            ` : ''}
            <button type="button" class="rmims-tour-btn-next" id="rmimsTourNextBtn">
              ${isLast ? 'Finish Tour &check;' : 'Next Step &rarr;'}
            </button>
          </div>
        </div>
      `;

      // Scroll target into view if needed
      try {
        step.targetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      } catch (e) {}

      // Reposition after card content rendered
      requestAnimationFrame(() => {
        updateHighlightAndPosition();
      });

      // Bind button events
      const skipBtn = card.querySelector('#rmimsTourSkipBtn');
      const prevBtn = card.querySelector('#rmimsTourPrevBtn');
      const nextBtn = card.querySelector('#rmimsTourNextBtn');

      if (skipBtn) {
        skipBtn.addEventListener('click', () => {
          finishTour('skipped');
        });
      }

      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          if (currentStepIdx > 0) {
            currentStepIdx--;
            renderStep();
          }
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          if (isLast) {
            finishTour('completed');
          } else {
            currentStepIdx++;
            renderStep();
          }
        });
      }
    }

    function handleResizeOrScroll() {
      updateHighlightAndPosition();
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        finishTour('skipped');
      } else if (e.key === 'ArrowRight' && currentStepIdx < availableSteps.length - 1) {
        currentStepIdx++;
        renderStep();
      } else if (e.key === 'ArrowLeft' && currentStepIdx > 0) {
        currentStepIdx--;
        renderStep();
      }
    }

    window.addEventListener('resize', handleResizeOrScroll, { passive: true });
    window.addEventListener('scroll', handleResizeOrScroll, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    function finishTour(status) {
      // Save state to localStorage
      try {
        localStorage.setItem('rmims_tour_status', status);
        localStorage.setItem('rmims_onboarding_completed', 'true');
        if (options.profile && options.profile.id) {
          localStorage.setItem(`rmims_onboarding_${options.profile.id}`, status);
        }
      } catch (e) {}

      // If finished, show friendly confirmation toast
      if (status === 'completed') {
        const toastFn = window.showToast || window.showAdminToast;
        if (typeof toastFn === 'function') {
          toastFn('Tour complete! You can restart the guide anytime in Help Center.', 'success');
        }
      }

      destroy();
      resolve(status);
    }

    function destroy() {
      window.removeEventListener('resize', handleResizeOrScroll);
      window.removeEventListener('scroll', handleResizeOrScroll);
      document.removeEventListener('keydown', handleKeyDown);

      closeProfileDropdownIfOpen();

      if (card && card.parentNode) card.parentNode.removeChild(card);
      if (spotlightBox && spotlightBox.parentNode) spotlightBox.parentNode.removeChild(spotlightBox);
      if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);

      activeTourInstance = null;
    }

    activeTourInstance = { destroy };

    renderStep();
  });
}

/**
 * Checks if the user should be shown the interactive tour upon landing,
 * and launches it if pending.
 */
export async function checkAndShowOnboarding(profile, supabaseClient, options = {}) {
  const profileId = (profile && profile.id) || 'guest';
  const localKey = 'rmims_onboarding_' + profileId;
  const storedStatus = localStorage.getItem(localKey) || localStorage.getItem('rmims_tour_status');

  // If force option is provided (like when clicking Explore Guide in Help Center), run immediately
  if (options.force) {
    return startRmimsTour({ profile, force: true });
  }

  // If user has already skipped or completed, do not show automatically
  if (storedStatus === 'completed' || storedStatus === 'skipped') {
    return;
  }

  // Check Supabase profile onboarding_status if available
  if (profile && profile.onboarding_status) {
    const s = String(profile.onboarding_status).toLowerCase();
    if (s === 'completed' || s === 'skipped') {
      try { localStorage.setItem(localKey, s); } catch (e) {}
      return;
    }
  }

  // Delay slightly so the page layout settles before highlighting
  setTimeout(() => {
    startRmimsTour({ profile });
  }, 450);
}

// Attach globally to window for direct triggers across all scripts & Help Center
window.startRmimsTour = startRmimsTour;
window.checkAndShowOnboarding = checkAndShowOnboarding;
