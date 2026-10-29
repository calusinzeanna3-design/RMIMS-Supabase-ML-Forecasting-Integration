/**
 * RMIMS Unified Custom Select & Filter Engine
 * Replaces native browser select popups with unified emerald-themed custom dropdowns.
 * Ensures all filter options display the unified #F0FDF4 mint background & #15803D emerald text.
 */

(function () {
  'use strict';

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
    if (!select) return;
    if (select.dataset.hasCombobox === 'true' || select._rmimsCombobox) return;
    if (select.dataset.customEnhanced === 'true') return;
    if (select.dataset.noCustom === 'true' || select.classList.contains('no-custom-select')) return;
    if (select.parentNode && (select.parentNode.querySelector('.cal-combobox-wrap') || select.parentNode.querySelector('.rm-combobox-wrap'))) return;
    if (select.style.display === 'none' && !select.classList.contains('rmims-native-select-hidden')) return;
    if (select.getAttribute('aria-hidden') === 'true' && !select.classList.contains('rmims-native-select-hidden')) return;
    if (select.closest('#template-container, template, .flatpickr-calendar, .flatpickr-current-month, .flatpickr-months')) return;
    if (select.classList.contains('flatpickr-monthDropdown-months')) return;

    const originalWidth = select.style.width;
    const originalMinWidth = select.style.minWidth;

    select.dataset.customEnhanced = 'true';
    select.classList.add('rmims-native-select-hidden');
    select.style.setProperty('display', 'none', 'important');
    select.style.setProperty('position', 'absolute', 'important');
    select.style.setProperty('left', '-99999px', 'important');
    select.style.setProperty('top', '-99999px', 'important');
    select.style.setProperty('width', '0', 'important');
    select.style.setProperty('height', '0', 'important');
    select.style.setProperty('min-width', '0', 'important');
    select.style.setProperty('min-height', '0', 'important');
    select.style.setProperty('max-width', '0', 'important');
    select.style.setProperty('max-height', '0', 'important');
    select.style.setProperty('padding', '0', 'important');
    select.style.setProperty('margin', '0', 'important');
    select.style.setProperty('border', 'none', 'important');
    select.style.setProperty('background', 'none', 'important');
    select.style.setProperty('opacity', '0', 'important');
    select.style.setProperty('pointer-events', 'none', 'important');
    select.style.setProperty('visibility', 'hidden', 'important');

    const wrapper = document.createElement('div');
    wrapper.className = 'rm-custom-select';
    if (select.id) wrapper.dataset.selectId = select.id;

    // Check if this select is inside an inline filter toolbar / row
    const isInlineFilter = select.closest(
      '.inv-filter-toolbar, .table-filters, .filter-bar, .rpt-toolbar, ' +
      '.activity-filter-toolbar, .mgr-search-filter-card, .directory-toolbar, ' +
      '.inv-filter-group, .staff-filter-box, .staff-search-box'
    ) || select.style.width === 'auto' || select.classList.contains('mgr-filter-select-compact');

    const isFullWidthRequested = select.classList.contains('w-100') || select.dataset.fullWidth === 'true';

    if (isFullWidthRequested || (!isInlineFilter && select.closest('.modal-body .form-group, .modal-body .mgr-form-group'))) {
      wrapper.classList.add('rm-select-block');
    }

    if (select.className) {
      const excludedClasses = [
        'inv-select', 'rmims-native-select-hidden', 'dropdown-select',
        'mgr-form-select', 'form-select', 'form-select-sm', 'rpt-select',
        'rpt-fe-select', 'fc-chart-select', 'staff-filter-select', 'staff-select',
        'mgr-select-filter', 'mgr-table-filter-select', 'mgr-filter-select-compact'
      ];
      const customClasses = select.className
        .split(' ')
        .filter(c => !excludedClasses.includes(c))
        .join(' ');
      if (customClasses) wrapper.className += ' ' + customClasses;
    }

    if (originalWidth && originalWidth !== 'auto' && originalWidth !== '0' && originalWidth !== '0px') {
      wrapper.style.width = originalWidth;
    }
    if (originalMinWidth && originalMinWidth !== '0' && originalMinWidth !== '0px') {
      wrapper.style.minWidth = originalMinWidth;
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

    function isNotificationOrModalActive() {
      const notif = document.getElementById('rmimsNotifBackdrop');
      if (notif && notif.classList.contains('open')) return true;
      if (document.body.classList.contains('rmims-notif-open') || document.body.classList.contains('rmims-modal-open')) return true;
      if (document.querySelector('.rmsme-all-notifs-overlay.open, .rmims-detail-backdrop.open, .help-modal-backdrop.show')) return true;
      return false;
    }

    function isInsideModalOrNotif() {
      return Boolean(wrapper.closest('.modal-sheet, .modal-overlay, .admin-modal-backdrop, .mgr-modal-backdrop, .rmims-notif-card, .rmims-detail-card, .help-modal-window'));
    }

    function openMenu() {
      // If notification modal or page modal is active, page filters must NEVER open or show!
      if (!isInsideModalOrNotif() && isNotificationOrModalActive()) {
        return;
      }

      document.querySelectorAll('.rm-custom-select.open').forEach(el => {
        if (el !== wrapper) {
          el.classList.remove('open');
          el.querySelector('.rm-select-trigger')?.setAttribute('aria-expanded', 'false');
        }
      });

      wrapper.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');

      // Smart alignment: by default right: 0 aligns with trigger right border
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      if (rect.left < 10) {
        menu.classList.add('align-left');
      } else if (rect.right > viewportWidth - 10) {
        menu.classList.remove('align-left');
      }
    }

    function closeMenu() {
      wrapper.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function handleTriggerInteraction(e) {
      if (!isInsideModalOrNotif() && isNotificationOrModalActive()) {
        // Notification is open on top of dashboard! Dismiss notification and do NOT open dropdown
        e.preventDefault();
        e.stopPropagation();
        const notif = document.getElementById('rmimsNotifBackdrop');
        if (notif) notif.classList.remove('open');
        document.querySelectorAll('.rmsme-all-notifs-overlay.open, .rmims-detail-backdrop.open').forEach(el => el.classList.remove('open'));
        document.body.classList.remove('rmims-notif-open', 'rmims-modal-open');
        closeAllCustomSelects();
        return;
      }

      e.stopPropagation();
      if (wrapper.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    }

    trigger.addEventListener('click', handleTriggerInteraction);
    trigger.addEventListener('pointerdown', (e) => {
      if (!isInsideModalOrNotif() && isNotificationOrModalActive()) {
        e.preventDefault();
        e.stopPropagation();
        handleTriggerInteraction(e);
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
      'select.dropdown-select, ' +
      'select.mgr-form-select, ' +
      'select.mgr-select-filter, ' +
      'select.staff-filter-select, ' +
      'select.rpt-select, ' +
      'select.rpt-fe-select, ' +
      'select.fc-chart-select, ' +
      'select.filter-select, ' +
      'select[data-custom-select="true"], ' +
      '.card-actions select, ' +
      '.filter-bar select, ' +
      '.table-filter-bar select, ' +
      '.rpt-filters select, ' +
      '.inv-filter-group select, ' +
      '.mgr-search-filter-card select, ' +
      '.directory-toolbar select, ' +
      '#chartRangeSelect, ' +
      '#chartMaterialSelect, ' +
      '#invStatusFilter, ' +
      '#invSortFilter, ' +
      '#staffInvStatusFilter, ' +
      '#staffInvSort, ' +
      '#staffMemberFilter, ' +
      '#staffActivityFilter, ' +
      '#staffStatusFilter, ' +
      '#recMaterialFilter, ' +
      '#recSortFilter, ' +
      '#disbMaterialFilter, ' +
      '#disbSortFilter, ' +
      '#filterActivitySelect, ' +
      '#filterStatusSelect, ' +
      '#reportPeriodPreset, ' +
      '#anTrendMaterialSelect'
    );

    targetSelects.forEach(sel => {
      if (sel.dataset.hasCombobox === 'true' || sel._rmimsCombobox || (sel.parentNode && sel.parentNode.querySelector('.cal-combobox-wrap'))) {
        return;
      }
      enhanceCustomSelect(sel);
    });

    // Clean up any duplicate .rm-custom-select if adjacent to or associated with a combobox
    document.querySelectorAll('.rm-custom-select').forEach(cs => {
      const prev = cs.previousElementSibling;
      const next = cs.nextElementSibling;
      const selectId = cs.dataset.selectId;
      const linkedSelect = selectId ? document.getElementById(selectId) : null;
      if (
        (prev && (prev.classList.contains('cal-combobox-wrap') || prev.classList.contains('rm-combobox-wrap'))) ||
        (next && (next.classList.contains('cal-combobox-wrap') || next.classList.contains('rm-combobox-wrap'))) ||
        (linkedSelect && (linkedSelect.dataset.hasCombobox === 'true' || linkedSelect._rmimsCombobox))
      ) {
        cs.remove();
      }
    });
  }

  function closeAllCustomSelects() {
    document.querySelectorAll('.rm-custom-select.open').forEach(el => {
      el.classList.remove('open');
      el.querySelector('.rm-select-trigger')?.setAttribute('aria-expanded', 'false');
    });
  }

  // Global listeners for closing dropdowns (Capture phase guarantees execution even with stopPropagation)
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.rm-custom-select')) {
      closeAllCustomSelects();
    }
  }, true);

  // Also close on pointerdown on modals, topbars, bell buttons, and backdrops
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.topbar, header, .rmims-notif-backdrop, .modal-overlay, .admin-modal-backdrop, .mgr-modal-backdrop, .help-modal-backdrop, #rmsmeUserPopover, #notificationBtn, #rmsmeNotificationBtn, #adminNotificationBtn, .mgr-bell-btn')) {
      if (!e.target.closest('.rm-custom-select')) {
        closeAllCustomSelects();
      }
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllCustomSelects();
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
  setTimeout(initAllCustomSelects, 1000);

  // Dynamic observer for newly added filters/selects in modals and tables
  let mutationTimeout = null;
  const domObserver = new MutationObserver(() => {
    if (mutationTimeout) cancelAnimationFrame(mutationTimeout);
    mutationTimeout = requestAnimationFrame(() => {
      initAllCustomSelects();
    });
  });

  if (document.body) {
    domObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      domObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  window.RMIMS_CUSTOM_SELECT = {
    init: initAllCustomSelects,
    enhance: enhanceCustomSelect,
    closeAll: closeAllCustomSelects
  };

})();
