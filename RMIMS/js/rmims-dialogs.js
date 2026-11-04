// js/rmims-dialogs.js
// In-app messages instead of the browser's own pop-ups ("127.0.0.1 says ..." / "localhost says ...").
//   window.alert(msg)            -> an RMIMS message card with an OK button
//   window.rmimsConfirm(msg, o)  -> an RMIMS Yes / No card, returns a Promise<boolean>
// A message shown right before the page reloads or moves to another page is kept and shown on the next page.
(function () {
  if (typeof window === 'undefined' || window.__rmimsDialogs) return;
  window.__rmimsDialogs = true;
  const PENDING = 'rmims_pending_notice';

  function css() {
    if (document.getElementById('rmimsDialogCss')) return;
    const st = document.createElement('style');
    st.id = 'rmimsDialogCss';
    st.textContent = `
    .rmd-back{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:2147483000;padding:16px;animation:rmdIn .12s ease}
    .rmd-card{background:#fff;border-radius:16px;max-width:440px;width:100%;box-shadow:0 24px 60px -20px rgba(15,42,27,.45);border-top:5px solid #15803D;font-family:Inter,system-ui,sans-serif;overflow:hidden}
    .rmd-card.rmd-warn{border-top-color:#EA580C}.rmd-card.rmd-error{border-top-color:#DC2626}.rmd-card.rmd-ok{border-top-color:#15803D}
    .rmd-body{padding:18px 20px 8px;display:flex;gap:12px;align-items:flex-start}
    .rmd-icon{flex:0 0 auto;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;color:#fff;background:#15803D}
    .rmd-warn .rmd-icon{background:#EA580C}.rmd-error .rmd-icon{background:#DC2626}
    .rmd-title{font-weight:800;font-size:15px;color:#0F2A1B;margin:2px 0 6px}
    .rmd-msg{font-size:13.5px;line-height:1.5;color:#334155;white-space:pre-line;overflow-wrap:anywhere}
    .rmd-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px 16px}
    .rmd-btn{min-height:38px;min-width:76px;padding:6px 18px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;border:1px solid #CBD5E1;background:#fff;color:#0F2A1B}
    .rmd-btn:focus-visible{outline:3px solid #86EFAC;outline-offset:2px}
    .rmd-btn.rmd-primary{background:#15803D;border-color:#15803D;color:#fff}
    .rmd-warn .rmd-btn.rmd-primary{background:#EA580C;border-color:#EA580C}
    .rmd-error .rmd-btn.rmd-primary{background:#DC2626;border-color:#DC2626}
    @keyframes rmdIn{from{opacity:0}to{opacity:1}}`;
    (document.head || document.documentElement).appendChild(st);
  }

  function toneOf(msg) {
    const m = String(msg || '');
    if (/^\s*(✓|✔)|success|saved|submitted|created|updated|recorded|deleted .*successfully/i.test(m)) return 'ok';
    if (/not saved|failed|error|cannot|could not|not allowed|denied|invalid|expired/i.test(m)) return 'error';
    if (/warning|please|exceed|below|are you sure|short|out of stock/i.test(m)) return 'warn';
    return 'ok';
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function show({ message, title, tone, buttons }) {
    css();
    return new Promise(resolve => {
      const t = tone || toneOf(message);
      const icon = t === 'ok' ? '✓' : (t === 'error' ? '!' : '⚠');
      const clean = String(message ?? '').replace(/^\s*[✓✔]\s*/, '');
      const head = title || (t === 'ok' ? 'Done' : (t === 'error' ? 'Something went wrong' : 'Please check'));
      const back = document.createElement('div');
      back.className = 'rmd-back';
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.innerHTML = `<div class="rmd-card rmd-${t}"><div class="rmd-body"><div class="rmd-icon" aria-hidden="true">${icon}</div>
        <div><div class="rmd-title">${esc(head)}</div><div class="rmd-msg">${esc(clean)}</div></div></div>
        <div class="rmd-foot">${buttons.map((b, i) => `<button type="button" class="rmd-btn ${b.primary ? 'rmd-primary' : ''}" data-i="${i}">${esc(b.text)}</button>`).join('')}</div></div>`;
      const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); done(buttons.find(b => b.cancel) ? buttons.find(b => b.cancel).value : buttons[0].value); }
      };
      back.addEventListener('click', (e) => {
        const btn = e.target.closest('.rmd-btn');
        if (btn) done(buttons[Number(btn.dataset.i)].value);
      });
      document.addEventListener('keydown', onKey, true);
      (document.body || document.documentElement).appendChild(back);
      const primary = back.querySelector('.rmd-primary') || back.querySelector('.rmd-btn');
      if (primary) setTimeout(() => primary.focus(), 0);
    });
  }

  // ---- alert() -> in-app message (kept across a reload / page change until OK is pressed) ----
  window.alert = function (message) {
    try { sessionStorage.setItem(PENDING, String(message ?? '')); } catch (_) {}
    show({ message, buttons: [{ text: 'OK', value: true, primary: true }] }).then(() => {
      try { sessionStorage.removeItem(PENDING); } catch (_) {}
    });
  };

  /** In-app Yes / No question. Resolves true for Yes. */
  window.rmimsConfirm = function (message, opts = {}) {
    return show({
      message, title: opts.title || 'Are you sure?', tone: opts.tone || 'warn',
      buttons: [
        { text: opts.noText || 'No', value: false, cancel: true },
        { text: opts.yesText || 'Yes', value: true, primary: true }
      ]
    });
  };

  // a message that was showing when the previous page reloaded / changed
  function replay() {
    let msg = null;
    try { msg = sessionStorage.getItem(PENDING); } catch (_) {}
    if (msg) window.alert(msg);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', replay);
  else replay();
})();
