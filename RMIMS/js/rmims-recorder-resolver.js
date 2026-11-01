// js/rmims-recorder-resolver.js
//
// Resolves WHO actually recorded a raw-material movement (Recorded By / Operator columns).
//
// Rules (strict RBAC):
//  1. A movement that started as a staff submission (ref like 2026SMSt-R0001 / 2026SMSt-D0001) is credited to
//     the staff member who submitted it, not to the manager who approved it.
//  2. Otherwise the database `recorded_by` / `received_by` UUID is resolved to the user's real name.
//  3. Administrators manage the system only; they never operate raw materials. Rows stamped with an admin
//     account (seed / import data) are shown as "System Import", never as "Admin".
//  4. Raw UUIDs are never shown to the user.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_IN_TEXT_RE = /\[Ref:\s*([^\]]+)\]/i;
const ADMIN_LIKE = new Set(['admin', 'administrator', 'main admin', 'system admin', 'super admin', 'system user', 'system']);
const GENERIC_LABELS = new Set(['staff', 'staff member', 'staff operator', 'staff receiver', 'store staff', 'all', 'null', 'undefined', '—', '-']);

export const SYSTEM_IMPORT_LABEL = 'System Import';

const directory = {
  loaded: false,
  profiles: new Map(),      // uuid -> { name, role }
  refAuthors: new Map(),    // ref -> { name, userId }
  movementAuthors: new Map()// ref -> userId (who logged STOCK_RECEIPT / MATERIAL_DISBURSEMENT)
};

function isAdminRole(p) {
  if (!p) return false;
  const r = String(p.role || '').toLowerCase();
  const op = String(p.operational_role || '').toLowerCase();
  return r === 'admin' || r === 'super_admin' || op === 'admin' || op === 'administrator';
}

function profileName(p) {
  return (p.full_name || p.username || (p.email ? String(p.email).split('@')[0] : '') || '').trim();
}

export function isStaffRef(ref) {
  return /SMSt-/i.test(String(ref || '')) || /^\d{4}[A-Z]*St-/i.test(String(ref || ''));
}

export function extractRef(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const m = String(t).match(REF_IN_TEXT_RE);
    if (m) return m[1].trim();
  }
  return '';
}

function readLocalStaffTransactions() {
  try {
    const raw = localStorage.getItem('rmims_staff_transactions');
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function rememberStaffAuthor(ref, name, userId) {
  if (!ref) return;
  const key = String(ref).trim().toUpperCase();
  const existing = directory.refAuthors.get(key);
  // First submission wins: that is the person who actually recorded it.
  if (existing && existing.name) return;
  const cleanName = String(name || '').trim();
  if (!cleanName && !userId) return;
  directory.refAuthors.set(key, { name: cleanName, userId: userId || null });
}

/**
 * Load profiles and staff-submission authors visible to the current user (RLS keeps it to their company).
 * Safe to call repeatedly; it refreshes the cache.
 */
export async function loadRecorderDirectory(supabase) {
  // Local staff transactions (works offline / before sync)
  readLocalStaffTransactions().forEach(t => {
    if (t && t.ref) rememberStaffAuthor(t.ref, t.staff || t.staffName || t.submittedBy, t.staffId || t.userId || t.user_id);
  });

  if (!supabase) { directory.loaded = true; return directory; }

  try {
    const [profRes, auditRes] = await Promise.all([
      supabase.from('user_profiles').select('id, full_name, username, email, role, operational_role'),
      supabase.from('activity_audit_logs')
        .select('user_id, action, entity_id, details, created_at')
        .in('action', ['STAFF_TX_STATE', 'STOCK_RECEIPT', 'MATERIAL_DISBURSEMENT'])
        .order('created_at', { ascending: true })
        .limit(5000)
    ]);

    (profRes && profRes.data || []).forEach(p => {
      directory.profiles.set(p.id, { name: profileName(p), isAdmin: isAdminRole(p), role: p.operational_role || p.role || '' });
    });

    (auditRes && auditRes.data || []).forEach(row => {
      const ref = String(row.entity_id || '').trim();
      if (!ref) return;
      if (row.action === 'STAFF_TX_STATE') {
        let det = row.details;
        if (typeof det === 'string') { try { det = JSON.parse(det); } catch (_) { det = {}; } }
        det = det || {};
        // Oldest snapshot = the original staff submission, logged by the staff member themselves.
        const prof = row.user_id ? directory.profiles.get(row.user_id) : null;
        const submitterName = (prof && !prof.isAdmin && prof.name) || det.staff || det.staffName || '';
        rememberStaffAuthor(ref, submitterName, row.user_id);
      } else if (!directory.movementAuthors.has(ref.toUpperCase()) && row.user_id) {
        directory.movementAuthors.set(ref.toUpperCase(), row.user_id);
      }
    });
  } catch (e) {
    console.warn('[RecorderResolver] directory load notice:', e && e.message);
  }

  directory.loaded = true;
  return directory;
}

function nameForUserId(uuid) {
  const p = directory.profiles.get(uuid);
  if (!p) return '';
  if (p.isAdmin) return SYSTEM_IMPORT_LABEL;
  return p.name || '';
}

/**
 * @param {object} o
 * @param {string} o.recordedBy  raw recorded_by / received_by value (UUID or legacy name)
 * @param {string} [o.ref]       transaction reference (or text containing "[Ref: ...]")
 * @param {string} [o.fallback]  label when nothing can be resolved
 */
export function resolveRecorderName({ recordedBy, ref, fallback = '—' } = {}) {
  const cleanRef = String(ref || '').trim();
  const refKey = cleanRef.toUpperCase();

  // 1. Staff submission -> the staff member who recorded it
  if (refKey && directory.refAuthors.has(refKey)) {
    const a = directory.refAuthors.get(refKey);
    const fromProfile = a.userId ? nameForUserId(a.userId) : '';
    const name = (fromProfile && fromProfile !== SYSTEM_IMPORT_LABEL) ? fromProfile : a.name;
    if (name && !ADMIN_LIKE.has(name.toLowerCase())) return name;
  }

  const raw = String(recordedBy == null ? '' : recordedBy).trim();

  // 2. Database UUID -> profile name
  if (UUID_RE.test(raw)) {
    const n = nameForUserId(raw);
    if (n) return n;
  }

  // 2b. The audit log of the movement itself knows who pushed it
  if (refKey && directory.movementAuthors.has(refKey)) {
    const n = nameForUserId(directory.movementAuthors.get(refKey));
    if (n) return n;
  }

  // 3. Legacy plain-text name
  if (raw && !UUID_RE.test(raw)) {
    const low = raw.toLowerCase();
    if (ADMIN_LIKE.has(low)) return SYSTEM_IMPORT_LABEL;
    if (!GENERIC_LABELS.has(low)) return raw;
  }

  // Unresolvable UUID (profile not visible) or empty
  if (UUID_RE.test(raw) && !directory.loaded) return fallback;
  return fallback;
}

/** Current signed-in user's display name, for stamping new local records. Never returns a UUID. */
export function currentRecorderName() {
  try {
    const u = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
    const n = (u.fullName || u.full_name || u.name || u.username || '').trim();
    return UUID_RE.test(n) ? '' : n;
  } catch (_) {
    return '';
  }
}
