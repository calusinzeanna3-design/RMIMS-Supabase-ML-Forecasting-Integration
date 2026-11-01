// js/rmims-notification-feed.js
//
// Links the notifications of Admin, Manager and Staff across devices through Supabase
// (table public.system_notifications, see supabase/RMIMS_SHARED_NOTIFICATIONS.sql):
//
//   Admin   <- updates of the Managers and Staff of every company
//   Manager <- updates of the Staff of its company + system messages from the Admin
//   Staff   <- updates of the Manager of its company + system messages from the Admin
//
// It does not change how notifications look or behave. Every notification a user action already creates
// through window.pushRMIMSNotification keeps working locally exactly as before; this module additionally
// publishes it to the shared feed, and writes shared items from other users into the same local store the
// existing bell / popup already read. Company and role scoping are enforced by the database (RLS).

import { supabase } from '../supabase/supabase-config.js';

const STORE_KEY = 'rmims_notifications_live_v2';
const FEED_PREFIX = 'feed-';
const PULL_DAYS = 14;
const PULL_LIMIT = 150;

function portalRole() {
  const p = window.location.pathname.toLowerCase();
  if (p.includes('/admin/')) return 'admin';
  if (p.includes('/manager/')) return 'manager';
  if (p.includes('/user/')) return 'staff';
  return '';
}

function currentUser() {
  try { return JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}') || {}; }
  catch (_) { return {}; }
}

const low = (v) => String(v || '').toLowerCase();

/** Notifications that every device rebuilds from the database by itself, or that are private to one role. */
function isLocalOnly(n, sender) {
  const id = String(n.id || '');
  if (n._fromFeed || n.sharedFeed || id.startsWith(FEED_PREFIX)) return true;
  if (id.startsWith('notif-staff-tx-') || id.startsWith('notif-stock-') || id.startsWith('notif-login-')) return true;
  const title = low(n.title), cat = low(n.category), badge = low(n.badge), msg = low(n.message);
  if (cat === 'login' || n.type === 'user_login' || title.includes('signed in') || msg.includes('login detected')) return true;
  if (sender === 'admin') {
    // Admin-private: accounts, registrations, security, credentials
    if (cat === 'security' || cat === 'user' || cat === 'security & access') return true;
    if (badge.includes('registration') || badge.includes('user management') || badge.includes('unlocked') || badge.includes('critical')) return true;
    if (/registration|account (locked|approved|unlocked)|new user created|password|security alert/.test(title)) return true;
  }
  return false;
}

/** Who should receive what this sender creates. */
function targetsFor(n, sender) {
  if (sender === 'staff') return ['manager', 'admin'];
  if (sender === 'manager') return ['staff', 'admin'];
  if (sender === 'admin') {
    const t = low(n.targetRole || n.role || n.roleScope);
    if (t.includes('manager')) return ['manager'];
    if (t.includes('staff') || t === 'user') return ['staff'];
    return ['manager', 'staff'];
  }
  return [];
}

async function publish(n) {
  const sender = portalRole();
  if (!supabase || !sender || !n || isLocalOnly(n, sender)) return;
  const targets = targetsFor(n, sender);
  if (!targets.length) return;
  const u = currentUser();
  const row = {
    company_name: localStorage.getItem('rmims_active_company_name') || u.companyName || u.company_name || null,
    branch_location: u.branchLoc || u.branchLocation || u.location || null,
    sender_name: u.fullName || u.name || u.username || null,
    sender_role: sender,               // re-stamped by the database
    target_roles: targets,             // re-validated by the database
    title: String(n.title || 'System Notification').slice(0, 300),
    message: n.message ? String(n.message).slice(0, 2000) : null,
    category: n.category || null,
    priority: n.priority || null,
    badge: n.badge || null,
    target_url: n.targetUrl || null,
    reference: n.ref || n.reference || null,
    source_key: String(n.id || '') || null
  };
  try {
    const { error } = await supabase.from('system_notifications').insert([row]);
    if (error && !/duplicate|unique/i.test(error.message || '')) {
      console.warn('[NotificationFeed] publish notice:', error.message);
    }
  } catch (e) {
    console.warn('[NotificationFeed] publish notice:', e && e.message);
  }
}

function readStore() {
  try { const a = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch (_) { return []; }
}

function roleLabel(r) { return r === 'admin' ? 'Admin' : r === 'manager' ? 'Manager' : 'Staff'; }

function toLocal(row, me) {
  const who = [row.sender_name, roleLabel(row.sender_role)].filter(Boolean).join(' · ');
  const where = me === 'admin' ? [row.company_name, row.branch_location].filter(Boolean).join(' · ') : '';
  return {
    id: FEED_PREFIX + row.id,
    sharedFeed: true,
    _fromFeed: true,
    targetRoles: row.target_roles || [],
    senderRole: row.sender_role,
    title: row.title,
    message: where ? `${row.message || ''} (${where})`.trim() : (row.message || ''),
    category: row.category || (row.sender_role === 'admin' ? 'system' : 'activity'),
    priority: row.priority || 'info',
    badge: row.badge || undefined,
    targetUrl: row.target_url || undefined,
    ref: row.reference || undefined,
    branch: row.branch_location || undefined,
    branchName: row.company_name || undefined,
    actor: where ? `${who} — ${where}` : who,
    role: me,
    targetRole: me,
    roleScope: me,
    timestamp: row.created_at
  };
}

/** Same update already present locally (e.g. a pending staff submission rebuilt from synced data)? */
function alreadyShown(store, item) {
  const t = low(item.title), m = low(item.message), ref = low(item.ref);
  return store.some(n => {
    if (String(n.id) === item.id) return true;
    if (low(n.title) === t && low(n.message) === m) return true;
    return Boolean(ref) && low(n.ref || n.reference) === ref && low(n.badge) === low(item.badge);
  });
}

function ingest(rows) {
  const me = portalRole();
  if (!me || !Array.isArray(rows) || !rows.length) return;
  const myId = currentUser().id;
  const store = readStore();
  let added = 0;
  rows.forEach(row => {
    if (!row || !row.id) return;
    if (myId && row.sender_id === myId) return;               // my own update is already local
    if (!(row.target_roles || []).includes(me)) return;       // RLS already filters; defensive
    const item = toLocal(row, me);
    if (alreadyShown(store, item)) return;
    store.unshift(item);
    added++;
  });
  if (!added) return;
  store.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('rmims:notification_change')); } catch (_) {}
  try { window.RMIMS_NOTIFICATIONS && typeof window.RMIMS_NOTIFICATIONS.render === 'function' && window.RMIMS_NOTIFICATIONS.render(); } catch (_) {}
  try { window.RMIMS_NOTIFICATIONS_POPUP && window.RMIMS_NOTIFICATIONS_POPUP.updateBadges && window.RMIMS_NOTIFICATIONS_POPUP.updateBadges(me); } catch (_) {}
}

async function pull() {
  if (!supabase) return;
  try {
    const since = new Date(Date.now() - PULL_DAYS * 86400000).toISOString();
    const { data, error } = await supabase
      .from('system_notifications')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(PULL_LIMIT);
    if (!error) ingest(data || []);
  } catch (_) {}
}

function wrapPush() {
  const orig = window.pushRMIMSNotification;
  if (typeof orig !== 'function' || orig.__rmimsFeedWrapped) return Boolean(orig && orig.__rmimsFeedWrapped);
  const wrapped = function (notif) {
    const result = orig.apply(this, arguments);
    try { if (notif && !notif._fromFeed) publish(notif); } catch (_) {}
    return result;
  };
  wrapped.__rmimsFeedWrapped = true;
  window.pushRMIMSNotification = wrapped;
  if (window.RMIMS_NOTIFICATIONS_POPUP) window.RMIMS_NOTIFICATIONS_POPUP.push = wrapped;
  return true;
}

function start() {
  if (window.__rmimsNotificationFeed || !portalRole()) return;
  window.__rmimsNotificationFeed = true;
  if (!wrapPush()) {
    let tries = 0;
    const t = setInterval(() => { if (wrapPush() || ++tries > 40) clearInterval(t); }, 250);
  }
  pull();
  try {
    if (supabase && typeof supabase.channel === 'function') {
      supabase
        .channel('rmims_shared_notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_notifications' }, (payload) => {
          if (payload && payload.new) ingest([payload.new]);
        })
        .subscribe();
    }
  } catch (_) {}
  // Catch up when the tab comes back (realtime may have been paused)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
}

start();

export const RMIMSNotificationFeed = { pull, publish };
