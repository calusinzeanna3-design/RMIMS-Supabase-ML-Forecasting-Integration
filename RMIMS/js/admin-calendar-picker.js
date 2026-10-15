// RMIMS Dynamic Admin Calendar & Date Range Picker
// Supports single month and dual-month custom ranges with fully dynamic month navigation (arrows move across all months and years).

export const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  const y = parts[0];
  const m = MONTH_NAMES_SHORT[parseInt(parts[1], 10) - 1];
  const d = String(parseInt(parts[2], 10)).padStart(2, '0');
  return `${m} ${d}, ${y}`;
}

export function getLiveTodayISO() {
  const now = new Date();
  const y = now.getFullYear() < 2026 ? 2026 : now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getDaysAgoISO(daysAgo) {
  const now = new Date();
  const y = now.getFullYear() < 2026 ? 2026 : now.getFullYear();
  const target = new Date(y, now.getMonth(), now.getDate() - daysAgo);
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${target.getFullYear()}-${m}-${d}`;
}

export function initAdminCalendarPicker(config) {
  const {
    popover,
    triggerBtn,
    displayLabel,
    colMonth1,
    colMonth2,
    gridMonth1,
    gridMonth2,
    monthTitle1,
    monthTitle2,
    btnPrev,
    btnNext,
    btnNextSingle,
    bottomBox,
    startDateLabel,
    endDateLabel,
    presetBtns,
    btnApply,
    btnCancel,
    initialPreset = 'custom', // 'this_month' | 'custom'
    initialStart = null,
    initialEnd = null,
    onApply = null
  } = config;

  if (!popover || !triggerBtn) {
    return null;
  }

  const liveToday = getLiveTodayISO();
  const defaultStart = initialStart !== undefined && initialStart !== null ? initialStart : liveToday;
  const defaultEnd = initialEnd !== undefined ? initialEnd : null;

  // Active State
  let activePreset = initialPreset;
  const now = new Date();
  let viewYear = now.getFullYear() < 2026 ? 2026 : now.getFullYear();
  let viewMonth = now.getMonth();

  if (defaultStart) {
    const parts = defaultStart.split('-');
    if (parts.length === 3) {
      viewYear = parseInt(parts[0], 10);
      viewMonth = parseInt(parts[1], 10) - 1;
    }
  }

  let selectionStart = defaultStart;
  let selectionEnd = defaultEnd;
  let appliedState = {
    start: defaultStart,
    end: defaultEnd,
    preset: initialPreset
  };

  // Configure dual calendar class initially
  if (activePreset === 'custom') {
    popover.classList.add('dual-calendar');
  } else {
    popover.classList.remove('dual-calendar');
  }

  // Render a specific month's days into its grid element
  function renderMonthDays(gridEl, y, m) {
    if (!gridEl) return;
    gridEl.innerHTML = '';

    // Day headers (Su - Sa)
    const dayHeaders = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    dayHeaders.forEach(dh => {
      const span = document.createElement('span');
      span.className = 'cal-day-header';
      span.textContent = dh;
      gridEl.appendChild(span);
    });

    const firstDayIndex = new Date(y, m, 1).getDay(); // 0 is Sunday
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    // Disabled empty slots before the 1st
    for (let i = 0; i < firstDayIndex; i++) {
      const blank = document.createElement('span');
      blank.className = 'cal-day disabled';
      blank.setAttribute('aria-hidden', 'true');
      gridEl.appendChild(blank);
    }

    // Days 1..daysInMonth
    for (let d = 1; d <= daysInMonth; d++) {
      const mStr = String(m + 1).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      const isoDate = `${y}-${mStr}-${dStr}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      btn.setAttribute('data-day', String(d));
      btn.setAttribute('data-date', isoDate);
      btn.setAttribute('aria-label', `${MONTH_NAMES_FULL[m]} ${d}, ${y}`);
      btn.setAttribute('role', 'gridcell');
      btn.textContent = String(d);

      if (isoDate === getLiveTodayISO()) {
        btn.classList.add('is-today');
      }

      let isSelected = false;
      if (selectionStart && !selectionEnd) {
        if (isoDate === selectionStart) {
          btn.classList.add('selected-single');
          isSelected = true;
        }
      } else if (selectionStart && selectionEnd) {
        if (isoDate === selectionStart) {
          btn.classList.add('range-start');
          isSelected = true;
        } else if (isoDate === selectionEnd) {
          btn.classList.add('range-end');
          isSelected = true;
        } else if (isoDate > selectionStart && isoDate < selectionEnd) {
          btn.classList.add('in-range');
          isSelected = true;
        }
      }

      btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      gridEl.appendChild(btn);
    }
  }

  // Update Month Titles and re-render day grids
  function renderAll() {
    // 1. Month 1
    if (monthTitle1) {
      monthTitle1.textContent = `${MONTH_NAMES_FULL[viewMonth]} ${viewYear}`;
    }
    renderMonthDays(gridMonth1, viewYear, viewMonth);

    // 2. Month 2 (Custom Range / Dual Calendar)
    const m2 = (viewMonth + 1) % 12;
    const y2 = viewMonth === 11 ? viewYear + 1 : viewYear;
    if (monthTitle2) {
      monthTitle2.textContent = `${MONTH_NAMES_FULL[m2]} ${y2}`;
    }
    renderMonthDays(gridMonth2, y2, m2);

    // 3. Bottom Preview Box
    if (bottomBox) {
      if (selectionStart && selectionEnd) {
        bottomBox.style.display = 'flex';
        if (startDateLabel) startDateLabel.textContent = formatDisplayDate(selectionStart);
        if (endDateLabel) endDateLabel.textContent = formatDisplayDate(selectionEnd);
      } else {
        bottomBox.style.display = 'none';
      }
    }
  }

  // Day Selection logic
  function handleDaySelect(clickedDate) {
    if (!selectionStart) {
      selectionStart = clickedDate;
      selectionEnd = null;
    } else if (selectionStart && !selectionEnd) {
      if (clickedDate === selectionStart) {
        selectionEnd = null;
      } else if (clickedDate < selectionStart) {
        selectionEnd = selectionStart;
        selectionStart = clickedDate;
      } else {
        selectionEnd = clickedDate;
      }
    } else {
      // Third tap / reset to fresh single date
      selectionStart = clickedDate;
      selectionEnd = null;
    }
    renderAll();
  }

  // Attach event delegation for days grids
  [gridMonth1, gridMonth2].forEach(grid => {
    if (!grid) return;
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.cal-day:not(.disabled)');
      if (!btn) return;
      e.stopPropagation();
      const clickedDate = btn.getAttribute('data-date');
      if (clickedDate) {
        handleDaySelect(clickedDate);
      }
    });
  });

  // Dynamic Month Navigation (Arrows move across ALL months and years!)
  function changeMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear--;
    } else if (viewMonth > 11) {
      viewMonth = 0;
      viewYear++;
    }
    renderAll();
  }

  if (btnPrev) {
    btnPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      changeMonth(-1);
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', (e) => {
      e.stopPropagation();
      changeMonth(1);
    });
  }

  if (btnNextSingle) {
    btnNextSingle.addEventListener('click', (e) => {
      e.stopPropagation();
      changeMonth(1);
    });
  }

  // Preset Tabs ("This Month" vs "Custom Range")
  if (presetBtns && presetBtns.length) {
    presetBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        presetBtns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        const preset = btn.getAttribute('data-preset');
        activePreset = preset;

        if (preset === 'custom') {
          popover.classList.add('dual-calendar');
          renderAll();
        } else {
          popover.classList.remove('dual-calendar');
          // Reset to current active selection or live today's year/month
          const activeDate = selectionStart || getLiveTodayISO();
          const parts = activeDate.split('-');
          if (parts.length === 3) {
            viewYear = parseInt(parts[0], 10);
            viewMonth = parseInt(parts[1], 10) - 1;
          }
          renderAll();
        }
      });
    });
  }

  // Popover Open / Close
  function openPopover() {
    popover.classList.add('open');
    triggerBtn.setAttribute('aria-expanded', 'true');
    const focusDate = selectionStart || getLiveTodayISO();
    if (focusDate) {
      const parts = focusDate.split('-');
      if (parts.length === 3) {
        viewYear = parseInt(parts[0], 10);
        viewMonth = parseInt(parts[1], 10) - 1;
      }
    }
    renderAll();
  }

  function closePopover() {
    popover.classList.remove('open');
    triggerBtn.setAttribute('aria-expanded', 'false');
  }

  triggerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover.classList.contains('open')) {
      closePopover();
    } else {
      openPopover();
    }
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (popover.classList.contains('open') && !popover.contains(e.target) && !triggerBtn.contains(e.target)) {
      closePopover();
    }
  });

  // Cancel Button
  if (btnCancel) {
    btnCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      closePopover();
      // Revert to applied state
      selectionStart = appliedState.start;
      selectionEnd = appliedState.end;
      renderAll();
    });
  }

  // Apply Button
  if (btnApply) {
    btnApply.addEventListener('click', (e) => {
      e.stopPropagation();
      closePopover();

      appliedState = {
        start: selectionStart,
        end: selectionEnd,
        preset: activePreset
      };

      let labelText = '';
      if (selectionStart && selectionEnd) {
        labelText = `${formatDisplayDate(selectionStart)} - ${formatDisplayDate(selectionEnd)}`;
      } else if (selectionStart) {
        labelText = formatDisplayDate(selectionStart);
      } else {
        labelText = formatDisplayDate(getLiveTodayISO());
      }

      if (displayLabel) {
        displayLabel.textContent = labelText;
      }

      if (typeof onApply === 'function') {
        onApply({
          mode: selectionStart && selectionEnd ? 'range' : 'single',
          start: selectionStart,
          end: selectionEnd || selectionStart,
          label: labelText
        });
      }

      if (window.showAdminToast) {
        window.showAdminToast(`Applied date filter: ${labelText}`);
      }
    });
  }

  // Initial render
  renderAll();

  return {
    setSelection(start, end, label) {
      selectionStart = start;
      selectionEnd = end;
      appliedState.start = start;
      appliedState.end = end;
      if (start) {
        const parts = start.split('-');
        if (parts.length === 3) {
          viewYear = parseInt(parts[0], 10);
          viewMonth = parseInt(parts[1], 10) - 1;
        }
      }
      if (displayLabel && label) {
        displayLabel.textContent = label;
      }
      renderAll();
    },
    open: openPopover,
    close: closePopover,
    render: renderAll
  };
}
