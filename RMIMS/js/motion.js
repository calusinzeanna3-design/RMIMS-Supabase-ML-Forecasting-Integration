/* RMSME motion controller (see css/motion.css). Safe: if anything fails the page simply shows normally. */
(function () {
  if (typeof document === 'undefined' || window.__rmMotion) return;
  window.__rmMotion = true;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  document.documentElement.classList.add('rm-js');

  // ---- cards: fade in on open + when scrolled into view, fade out when scrolled past the top
  const CARD = '.kpi-card,[class*="kpi-card"],[class*="stat-card"],.card,[class*="-card"]:not([class*="modal"]):not([class*="nav"]),.panel,[class*="-panel"],.rpt-specific-export-card,.forecast-support-card';
  let io = null, counter = 0;
  function eligible(el) {
    if (el.classList.contains('rm-card')) return false;
    if (el.closest('[class*="modal"],[class*="backdrop"],[class*="overlay"],[class*="dropdown"],[class*="popover"],nav,aside,header,table,.fsc-bargraph-container')) return false;
    if (el.parentElement && el.parentElement.closest('.rm-card')) return false;   // only the outer card animates
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'sticky' || cs.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 60 && r.height > 30;
  }
  function register(root) {
    try {
      const list = (root.matches && root.matches(CARD)) ? [root] : [];
      root.querySelectorAll && root.querySelectorAll(CARD).forEach(e => list.push(e));
      list.forEach(el => {
        if (!eligible(el)) return;
        el.classList.add('rm-card', 'rm-pre');
        el.style.setProperty('--rm-i', String(Math.min(counter++ % 10, 9)));
        io.observe(el);
      });
    } catch (_) {}
  }
  function setupCards() {
    if (!('IntersectionObserver' in window)) return;
    io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        const el = en.target;
        if (en.isIntersecting) {
          el.classList.remove('rm-out');
          if (el.classList.contains('rm-pre')) {
            el.classList.remove('rm-pre'); el.classList.add('rm-in');
            setTimeout(() => { el.classList.remove('rm-in'); el.classList.add('rm-seen'); }, 600 + (parseInt(el.style.getPropertyValue('--rm-i')) || 0) * 28);
          }
        } else if (el.classList.contains('rm-seen')) {
          const above = en.boundingClientRect.bottom < (en.rootBounds ? en.rootBounds.top : 0) + 8;
          el.classList.toggle('rm-out', above);          // scrolled off the top → fade out; off the bottom → stay ready
        }
      });
    }, { threshold: 0, rootMargin: '-60px 0px 0px 0px' });
    register(document.body);
    let t = null;
    new MutationObserver(muts => {
      clearTimeout(t);
      t = setTimeout(() => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) register(n); })), 80);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ---- pop-ups: anything modal-like fades in the moment it becomes visible
  const POP = '[class*="modal"],[class*="backdrop"],[class*="overlay"],[class*="dropdown"],[class*="popover"],[role="dialog"]';
  const wasVisible = new WeakMap();
  function visible(el) {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  }
  function checkPop(el) {
    if (!el.matches || !el.matches(POP)) return;
    const now = visible(el), before = wasVisible.get(el) || false;
    wasVisible.set(el, now);
    if (now && !before) {
      el.classList.remove('rm-pop-in'); void el.offsetWidth; el.classList.add('rm-pop-in');
      setTimeout(() => el.classList.remove('rm-pop-in'), 450);
    }
  }
  function setupPops() {
    new MutationObserver(muts => {
      muts.forEach(m => {
        if (m.type === 'attributes') checkPop(m.target);
        else m.addedNodes.forEach(n => { if (n.nodeType === 1) { checkPop(n); n.querySelectorAll && n.querySelectorAll(POP).forEach(checkPop); } });
      });
    }).observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'], childList: true, subtree: true });
  }

  // ---- page transitions on internal links
  function setupLinks() {
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      if (a.target && a.target !== '_self') return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href) || a.hasAttribute('download')) return;
      let u; try { u = new URL(a.href, location.href); } catch (_) { return; }
      if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search)) return;
      e.preventDefault();
      document.body.classList.add('rm-leave');
      setTimeout(() => { location.href = u.href; }, 170);
    });
    window.addEventListener('pageshow', ev => { if (ev.persisted) document.body.classList.remove('rm-leave'); });
  }

  function start() { setupCards(); setupPops(); setupLinks(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
