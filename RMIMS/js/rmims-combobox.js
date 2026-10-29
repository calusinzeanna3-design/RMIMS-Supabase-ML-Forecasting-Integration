/**
 * RMIMS - Universal Searchable & Typable Combobox Component
 * Replaces standard <select> elements with an interactive, typable search combobox
 * that matches the Forecast Spline combobox design perfectly.
 */

export function attachSearchableCombobox(selectEl, options = {}) {
  if (!selectEl) return null;

  // If already attached, return existing instance or update options
  if (selectEl._rmimsCombobox) {
    selectEl._rmimsCombobox.sync();
    return selectEl._rmimsCombobox;
  }

  const {
    placeholder = 'Search raw material...',
    width = '',
    minWidth = '',
    maxWidth = '',
    customClass = '',
    onChange = null
  } = options;

  // Generate unique instance ID
  const instanceId = 'rm_combo_' + Math.random().toString(36).substring(2, 9);

  // Mark select so custom-select knows not to attach
  selectEl.dataset.hasCombobox = 'true';
  selectEl.dataset.noCustom = 'true';
  selectEl.dataset.customEnhanced = 'true';

  // Remove any redundant .rm-custom-select element in parent
  if (selectEl.parentNode) {
    const parent = selectEl.parentNode;
    const existingCustomSelects = parent.querySelectorAll('.rm-custom-select');
    existingCustomSelects.forEach(cs => {
      if (cs.dataset.selectId === selectEl.id || cs.previousElementSibling === selectEl || cs.nextElementSibling === selectEl || existingCustomSelects.length === 1) {
        cs.remove();
      }
    });
  }

  // Hide the native select but keep it in DOM for forms/validations
  selectEl.style.display = 'none';

  // Wrapper element
  const wrap = document.createElement('div');
  wrap.className = `cal-combobox-wrap rm-combobox-wrap ${customClass}`.trim();
  wrap.id = `${instanceId}_wrap`;
  if (width) {
    wrap.style.width = width;
    if (width !== '100%') {
      wrap.style.display = 'inline-block';
      wrap.style.verticalAlign = 'middle';
    }
  } else if (minWidth || maxWidth) {
    wrap.style.width = 'auto';
    wrap.style.display = 'inline-block';
    wrap.style.verticalAlign = 'middle';
  }
  if (minWidth) wrap.style.minWidth = minWidth;
  if (maxWidth) wrap.style.maxWidth = maxWidth;

  wrap.innerHTML = `
    <div class="cal-combobox-input-box" id="${instanceId}_inputBox">
      <svg class="cal-combobox-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input type="text" class="cal-combobox-input" id="${instanceId}_input" placeholder="${placeholder}" autocomplete="off">
      <button type="button" class="cal-combobox-clear" id="${instanceId}_clear" title="Clear search" style="display:none;">&times;</button>
      <svg class="cal-combobox-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </div>
    <div class="cal-combobox-dropdown" id="${instanceId}_dropdown"></div>
  `;

  // Insert wrap right next to the selectEl
  selectEl.parentNode.insertBefore(wrap, selectEl.nextSibling);

  const inputBox = wrap.querySelector('.cal-combobox-input-box');
  const input = wrap.querySelector('.cal-combobox-input');
  const clearBtn = wrap.querySelector('.cal-combobox-clear');
  const dropdown = wrap.querySelector('.cal-combobox-dropdown');

  let activeIndex = -1;
  let itemsList = [];

  function getOptionsData() {
    const opts = Array.from(selectEl.options || []);
    return opts.map(opt => ({
      value: opt.value,
      text: opt.textContent.trim(),
      code: opt.dataset.code || opt.dataset.itemCode || opt.dataset.unit || '',
      stock: opt.dataset.stock,
      selected: opt.selected,
      disabled: opt.disabled
    }));
  }

  function getSelectedText() {
    const selOpt = selectEl.options[selectEl.selectedIndex];
    if (!selOpt) return '';
    if (!selOpt.value && (selOpt.textContent.trim().startsWith('--') || selOpt.disabled)) {
      return '';
    }
    return selOpt.textContent.trim();
  }

  function renderDropdown(filterText = '') {
    const q = filterText.trim().toLowerCase();
    itemsList = getOptionsData();

    const filtered = itemsList.filter(item => {
      if (item.disabled && !item.value) return false;
      if (!q) return true;
      return item.text.toLowerCase().includes(q) || item.value.toLowerCase().includes(q) || (item.code && item.code.toLowerCase().includes(q));
    });

    if (filtered.length === 0) {
      dropdown.innerHTML = `<div class="cal-combobox-empty">No matching materials found</div>`;
      activeIndex = -1;
      return;
    }

    dropdown.innerHTML = filtered.map((item, idx) => {
      const isSelected = String(selectEl.value) === String(item.value);
      return `
        <div class="cal-combobox-item ${isSelected ? 'selected' : ''}" data-val="${escapeHtmlAttr(item.value)}" data-idx="${idx}">
          <span class="cal-item-name">${escapeHtml(item.text)}</span>
          ${item.code ? `<span class="cal-item-code">${escapeHtml(item.code)}</span>` : ''}
        </div>
      `;
    }).join('');

    activeIndex = -1;

    // Attach click events
    dropdown.querySelectorAll('.cal-combobox-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectValue(el.getAttribute('data-val'));
      });
    });
  }

  function selectValue(val) {
    selectEl.value = val;
    input.value = getSelectedText();
    dropdown.classList.remove('open');
    wrap.classList.remove('open');
    clearBtn.style.display = (val && val !== 'all' && val !== 'ALL') ? 'block' : 'none';

    // Dispatch native change and input events
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof selectEl.onchange === 'function') {
      selectEl.onchange({ target: selectEl });
    }

    if (typeof onChange === 'function') {
      onChange(val, selectEl);
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
    return Boolean(wrap.closest('.modal-sheet, .modal-overlay, .admin-modal-backdrop, .mgr-modal-backdrop, .rmims-notif-card, .rmims-detail-card, .help-modal-window'));
  }

  function openDropdown() {
    if (!isInsideModalOrNotif() && isNotificationOrModalActive()) {
      return;
    }
    dropdown.classList.add('open');
    wrap.classList.add('open');
    const curText = getSelectedText();
    // If the input matches selected text, show all items on open
    renderDropdown(input.value === curText ? '' : input.value);
  }

  function closeDropdown() {
    dropdown.classList.remove('open');
    wrap.classList.remove('open');
    input.value = getSelectedText();
    clearBtn.style.display = (selectEl.value && selectEl.value !== 'all' && selectEl.value !== 'ALL') ? 'block' : 'none';
  }

  // Events
  input.addEventListener('focus', () => {
    if (!isInsideModalOrNotif() && isNotificationOrModalActive()) {
      input.blur();
      const notif = document.getElementById('rmimsNotifBackdrop');
      if (notif) notif.classList.remove('open');
      document.body.classList.remove('rmims-notif-open', 'rmims-modal-open');
      closeDropdown();
      return;
    }
    openDropdown();
    input.select();
  });

  input.addEventListener('input', () => {
    openDropdown();
    clearBtn.style.display = input.value ? 'block' : 'none';
    renderDropdown(input.value);
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.cal-combobox-item');
    if (!dropdown.classList.contains('open')) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        openDropdown();
        e.preventDefault();
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        activeIndex = (activeIndex + 1) % items.length;
        updateActiveItem(items);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        updateActiveItem(items);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        selectValue(items[activeIndex].getAttribute('data-val'));
      } else if (items.length === 1) {
        selectValue(items[0].getAttribute('data-val'));
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  function updateActiveItem(items) {
    items.forEach((it, i) => {
      it.classList.toggle('selected', i === activeIndex);
      if (i === activeIndex) {
        it.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Prefer empty string or 'all'/'ALL' if present in options
    const allOpt = Array.from(selectEl.options).find(o => o.value === 'all' || o.value === 'ALL' || o.value === '');
    const resetVal = allOpt ? allOpt.value : (selectEl.options[0]?.value || '');
    selectValue(resetVal);
    input.value = getSelectedText();
    clearBtn.style.display = 'none';
    renderDropdown('');
  });

  // Clicking arrow icon toggles dropdown
  const arrowBtn = wrap.querySelector('.cal-combobox-arrow');
  if (arrowBtn) {
    arrowBtn.addEventListener('click', (e) => {
      if (!isInsideModalOrNotif() && isNotificationOrModalActive()) {
        e.preventDefault();
        e.stopPropagation();
        const notif = document.getElementById('rmimsNotifBackdrop');
        if (notif) notif.classList.remove('open');
        document.body.classList.remove('rmims-notif-open', 'rmims-modal-open');
        closeDropdown();
        return;
      }
      e.stopPropagation();
      if (dropdown.classList.contains('open')) {
        closeDropdown();
      } else {
        input.focus();
        openDropdown();
      }
    });
  }

  // Close when clicking outside (Capture phase guarantees execution even with stopPropagation)
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      closeDropdown();
    }
  }, true);

  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.topbar, header, .rmims-notif-backdrop, .modal-overlay, .admin-modal-backdrop, .mgr-modal-backdrop, .help-modal-backdrop, #rmsmeUserPopover, #notificationBtn, #rmsmeNotificationBtn, #adminNotificationBtn, .mgr-bell-btn')) {
      if (!wrap.contains(e.target)) {
        closeDropdown();
      }
    }
  }, true);

  // Observe programmatic changes or option population on selectEl
  const observer = new MutationObserver(() => {
    sync();
  });
  observer.observe(selectEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });

  function sync() {
    input.value = getSelectedText();
    clearBtn.style.display = (selectEl.value && selectEl.value !== 'all' && selectEl.value !== 'ALL') ? 'block' : 'none';
    if (dropdown.classList.contains('open')) {
      renderDropdown(input.value === getSelectedText() ? '' : input.value);
    }
    if (selectEl.parentNode) {
      const existingCustomSelects = selectEl.parentNode.querySelectorAll('.rm-custom-select');
      existingCustomSelects.forEach(cs => {
        if (cs.dataset.selectId === selectEl.id || cs.previousElementSibling === selectEl || cs.nextElementSibling === selectEl || existingCustomSelects.length === 1) {
          cs.remove();
        }
      });
    }
  }

  // Initial synchronization
  sync();

  const instance = {
    wrap,
    input,
    dropdown,
    sync,
    selectValue,
    destroy() {
      observer.disconnect();
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      selectEl.style.display = '';
      delete selectEl._rmimsCombobox;
    }
  };

  selectEl._rmimsCombobox = instance;
  return instance;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeHtmlAttr(str) {
  if (str == null) return '';
  return String(str).replace(/"/g, '&quot;');
}
