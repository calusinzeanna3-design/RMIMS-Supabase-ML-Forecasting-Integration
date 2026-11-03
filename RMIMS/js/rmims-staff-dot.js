// js/rmims-staff-dot.js
// Red dot in the sidebar while something is waiting for THIS role; it disappears as soon as nothing is waiting
// and comes back only when a new transaction needs attention.
//   Manager -> "Staff Activity": staff submissions waiting for the manager (Pending / Resubmitted)
//   Staff   -> "My Activity":    the signed-in staff member's transactions the manager returned for correction,
//                                plus manager decisions (approved / rejected) not yet seen in My Activity

const STAFF_TX_KEY = 'rmims_staff_transactions';

function portal() {
  const p = window.location.pathname.toLowerCase();
  if (p.includes('/manager/')) return 'manager';
  if (p.includes('/user/')) return 'staff';
  return '';
}

function readTx() {
  try {
    const list = JSON.parse(localStorage.getItem(STAFF_TX_KEY) || '[]');
    return Array.isArray(list) ? list.filter(Boolean) : [];
  } catch (_) { return []; }
}

const st = (t) => String(t.status || '').toLowerCase().trim();

function me() {
  try {
    const u = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}') || {};
    return { email: String(u.email || '').toLowerCase().trim(), name: String(u.fullName || u.full_name || u.name || '').toLowerCase().trim() };
  } catch (_) { return { email: '', name: '' }; }
}

function isMine(t, who) {
  const e = String(t.staffEmail || '').toLowerCase().trim();
  const n = String(t.staff || t.staffName || '').toLowerCase().trim();
  if (who.email && e) return e === who.email;
  if (who.name && n) return n === who.name;
  return true; // a staff device only holds its own company's transactions
}

const seenKey = () => `rmims_staff_dot_seen_${me().email || me().name || 'staff'}`;
const decisionSig = (t) => `${String(t.ref || t.id || '')}:${st(t)}`;

/** Number of items waiting for this role. */
function waitingCount(role) {
  const tx = readTx();
  if (role === 'manager') {
    // waiting for the MANAGER only (a correction request is waiting for the staff member, not the manager)
    return tx.filter(t => /^(pending|resubmitted|updated)/.test(st(t))).length;
  }
  if (role === 'staff') {
    const who = me();
    const mine = tx.filter(t => isMine(t, who));
    const corrections = mine.filter(t => /correction|returned/.test(st(t))).length;
    let seen = new Set();
    try { seen = new Set(JSON.parse(localStorage.getItem(seenKey()) || '[]')); } catch (_) {}
    const unseenDecisions = mine.filter(t => /^(approved|rejected)/.test(st(t)) && !seen.has(decisionSig(t))).length;
    return corrections + unseenDecisions;
  }
  return 0;
}

/** Opening My Activity marks the manager's decisions as seen (corrections stay until the staff member fixes them). */
function markStaffDecisionsSeen() {
  const who = me();
  const sigs = readTx().filter(t => isMine(t, who) && /^(approved|rejected)/.test(st(t))).map(decisionSig);
  try { localStorage.setItem(seenKey(), JSON.stringify(sigs.slice(-2000))); } catch (_) {}
}

function paint() {
  const role = portal();
  if (!role) return;
  const target = role === 'manager' ? 'staff-activity.html' : 'my-activity.html';
  const label = role === 'manager' ? 'Staff Activity' : 'My Activity';
  if (role === 'staff' && window.location.pathname.toLowerCase().endsWith('/my-activity.html')) markStaffDecisionsSeen();
  const n = waitingCount(role);
  document.querySelectorAll(`a[href$="${target}"]`).forEach(a => {
    if (a.classList.contains('btn-view-all')) return; // sidebar / nav links only
    let dot = a.querySelector('.rmims-nav-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'rmims-nav-dot';
      dot.style.cssText = 'display:none;width:9px;height:9px;border-radius:50%;background:#EF4444;box-shadow:0 0 0 2px rgba(239,68,68,.18);margin-left:auto;flex:0 0 auto;';
      if (getComputedStyle(a).display.indexOf('flex') === -1) dot.style.marginLeft = '8px';
      a.appendChild(dot);
    }
    dot.style.display = n > 0 ? 'inline-block' : 'none';
    dot.title = n > 0 ? `${n} waiting for you` : '';
    a.setAttribute('aria-label', n > 0 ? `${label}, ${n} waiting` : label);
  });
}

if (portal()) {
  const start = () => { paint(); setTimeout(paint, 600); setTimeout(paint, 2000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('storage', (e) => { if (!e.key || e.key === STAFF_TX_KEY) paint(); });
  ['rmims_staff_transactions_updated', 'rmims_staff_activity_updated', 'rmims_live_data_updated', 'rmims:notification_change']
    .forEach(ev => window.addEventListener(ev, paint));
  setInterval(paint, 5000);
}
