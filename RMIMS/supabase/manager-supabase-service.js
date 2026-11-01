/**
 * RMIMS Manager Supabase Service
 * Authoritative Supabase Integration for Store Management & Manager Modules:
 * - Live queries for raw_materials, stock_receipts, material_disbursements, activity_audit_logs, user_profiles
 * - Unified transaction approval & rejection linked directly to Supabase
 * - Real-time Inflow/Outflow ledger persistence to Supabase
 * - Zero hardcoded or zombie fallbacks; authentic live data synchronization
 * - Unified cross-module broadcast (Dashboard <-> Inventory <-> Receive <-> Disburse <-> Staff Activity)
 */

import { markDeleted, isDeleted, isRefDeletedAny, extractRefFromText } from '../js/rmims-deleted-ledger.js';
import { txVersion } from '../js/rmims-tx-merge.js';
import { supabase } from './supabase-config.js';
import { loadRecorderDirectory, resolveRecorderName } from '../js/rmims-recorder-resolver.js';
import { resolveFinishedProductName } from '../js/rmims-reorder-engine.js';
import { getActiveTenantContext } from '../js/tenant-manager.js';
import {
  getSystemRawMaterials,
  saveCustomRawMaterial,
  deleteSystemRawMaterial,
  saveCustomReceipt,
  saveCustomDisbursement,
  adjustSystemMaterialStock,
  updateMaterialActivityTimestamp,
  invalidateForecastCache,
  resolveForecastingMaterialByName,
  healForecastingMaterialCodes
} from '../js/system-materials.js';

const STAFF_TX_KEY = 'rmims_staff_transactions';
const MGR_RECEIPTS_KEY = 'rmims_manager_receipts';
const MGR_DISBURSEMENTS_KEY = 'rmims_manager_disbursements';
const MGR_ACTIVITIES_KEY = 'rmims_manager_activities';

/**
 * Timeout helper for resilient live Supabase network requests
 */
function fetchWithTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase request timeout')), ms))
  ]);
}

/* ==========================================================================
 * LIVE SYNC CORE (Manager -> Staff)
 * Supabase raw_materials is the single source of truth. The local caches are
 * only a fast mirror that every page re-renders from.
 * ========================================================================== */
const CUSTOM_MATS_KEY = 'rmims_custom_raw_materials';
const MAT_OVERRIDES_KEY = 'rmims_manager_material_overrides';
const PENDING_PUSH_KEY = 'rmims_pending_material_pushes';

// Stock-moving ledger writes (receipt / disbursement RPCs) currently running. While > 0 the sync never
// pushes an absolute stock figure, so a movement can never be counted twice.
let ledgerInFlight = 0;

function readJsonSafe(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch (_) { return fallback; }
}

// Only write when the value really changed (prevents cross-tab "storage" ping-pong loops).
function setJsonIfChanged(key, value) {
  try {
    const next = JSON.stringify(value);
    if (localStorage.getItem(key) !== next) localStorage.setItem(key, next);
  } catch (_) {}
}

function hasVal(v) {
  return v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
}
function pickVal(...vals) { return vals.find(hasVal); }

/** Any date-ish value -> 'YYYY-MM-DD' (or null). Safe for DATE columns. */
function toIsoDateOnly(v) {
  if (!hasVal(v)) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Any date-ish value -> ISO timestamp (or null). Safe for TIMESTAMPTZ columns. */
function toIsoTimestamp(v) {
  if (!hasVal(v)) return null;
  const d = new Date(String(v).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function laterIso(...vals) {
  let best = null, bestMs = -Infinity;
  vals.forEach(v => {
    const iso = toIsoTimestamp(v);
    if (!iso) return;
    const ms = Date.parse(iso);
    if (ms > bestMs) { bestMs = ms; best = iso; }
  });
  return best;
}

function getPendingPushes() {
  const v = readJsonSafe(PENDING_PUSH_KEY, {});
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}
function markPendingPush(code, withStock = false) {
  if (!code) return;
  const p = getPendingPushes();
  p[code] = { ts: Date.now(), withStock: Boolean(withStock || (p[code] && p[code].withStock)) };
  setJsonIfChanged(PENDING_PUSH_KEY, p);
}
function clearPendingPush(code) {
  if (!code) return;
  const p = getPendingPushes();
  if (p[code]) { delete p[code]; setJsonIfChanged(PENDING_PUSH_KEY, p); }
}

function isManagerSession() {
  try {
    const raw = localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser');
    if (!raw) return false;
    const u = JSON.parse(raw);
    return String(u.operationalRole || u.operational_role || u.role || '').toLowerCase() === 'manager';
  } catch (_) { return false; }
}
/** Strict RBAC: administrators manage the system and never record raw-material movements. */
function isAdminSession() {
  try {
    const raw = localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser');
    if (!raw) return false;
    const u = JSON.parse(raw);
    const r = String(u.operationalRole || u.operational_role || u.role || '').toLowerCase();
    return r === 'admin' || r === 'administrator' || r === 'main admin' || r === 'super_admin';
  } catch (_) { return false; }
}
function activeTenantIsScones() {
  try { const t = getActiveTenantContext(); return t ? Boolean(t.isScones) : true; } catch (_) { return true; }
}


// ---------------------------------------------------------------------------------------------------------------
// Honest sync status: what the DATABASE actually answered on the last read / write (so screens never claim "Live"
// while the database is refusing or returning nothing).
// ---------------------------------------------------------------------------------------------------------------
const syncStatus = { state: 'unknown', message: '', rows: null, at: 0 };
export function getLiveSyncStatus() { return { ...syncStatus }; }
function setSyncStatus(state, message, rows = null) {
  const changed = syncStatus.state !== state || syncStatus.message !== message;
  syncStatus.state = state; syncStatus.message = message; syncStatus.rows = rows; syncStatus.at = Date.now();
  if (changed) { try { window.dispatchEvent(new CustomEvent('rmims_sync_status', { detail: { ...syncStatus } })); } catch (_) {} }
  if (changed && syncStatus.state !== 'ok' && syncStatus.state !== 'unknown') console.warn('[LiveSync] ' + syncStatus.message);
}

const LEGACY_OVERRIDES_KEY = 'rmims_manager_inventory_overrides';

/** getSystemRawMaterials applies this legacy store AFTER the main one, so a stale copy would shadow fresh values. */
function mirrorToLegacyOverrides(code, entry) {
  try {
    const legacy = readJsonSafe(LEGACY_OVERRIDES_KEY, null);
    if (!legacy || typeof legacy !== 'object' || !legacy[code]) return;
    legacy[code] = { ...legacy[code], ...entry };
    setJsonIfChanged(LEGACY_OVERRIDES_KEY, legacy);
  } catch (_) {}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeLike = (v) => String(v).replace(/[\\%_]/g, (c) => '\\' + c);

/**
 * Find the raw_materials row by UUID, item code or name. Plain .eq()/.ilike() filters (NOT .or()) so names
 * containing commas / parentheses - e.g. "Fresh Yellow Squash (Kalabasa)" - can never break the query.
 */
async function resolveRemoteMaterialRow({ id, code, name } = {}) {
  if (!supabase) return null;
  const cleanCode = String(code || '').trim();
  const cleanName = String(name || '').trim();
  const cols = 'id, item_code, name, current_stock';
  try {
    if (id && UUID_RE.test(String(id))) {
      const { data } = await supabase.from('raw_materials').select(cols).eq('id', id).limit(1).maybeSingle();
      if (data) return data;
    }
    if (cleanCode) {
      const { data } = await supabase.from('raw_materials').select(cols).eq('item_code', cleanCode.toUpperCase()).limit(1).maybeSingle();
      if (data) return data;
    }
    if (cleanName) {
      const { data } = await supabase.from('raw_materials').select(cols).eq('name', cleanName).limit(1).maybeSingle();
      if (data) return data;
      const { data: d2 } = await supabase.from('raw_materials').select(cols).ilike('name', escapeLike(cleanName)).limit(1).maybeSingle();
      if (d2) return d2;
    }
  } catch (_) {}
  return null;
}


// Item codes whose database row was JUST created with a stock figure that already includes the movement being
// recorded. The ledger recorder must not apply that movement a second time through the stored procedure.
const freshStockCodes = new Map();
function markFreshStock(code) { if (code) freshStockCodes.set(String(code).toUpperCase(), Date.now()); }
function claimFreshStock(code) {
  const k = String(code || '').toUpperCase();
  const ts = freshStockCodes.get(k);
  if (ts === undefined) return false;
  freshStockCodes.delete(k);
  return Date.now() - ts < 120000;
}

function findLocalMaterial(code, name) {
  const wantedCode = String(code || '').toUpperCase().trim();
  const wantedName = String(name || '').trim().toLowerCase();
  try {
    return (getSystemRawMaterials() || []).find(m =>
      (wantedCode && String(m.item_code || m.id || '').toUpperCase().trim() === wantedCode) ||
      (wantedName && String(m.name || m.raw_material_name || '').trim().toLowerCase() === wantedName)
    ) || null;
  } catch (_) { return null; }
}

function materialInsertPayload(m) {
  const code = String(m.item_code || m.id || '').toUpperCase().trim();
  const minStock = Number(m.minimum_threshold ?? m.minimum_stock ?? 0);
  const payload = {
    item_code: code,
    name: String(m.name || m.raw_material_name || '').trim(),
    unit_of_measure: m.unit_of_measure || m.unit || 'kg',
    current_stock: Number(m.current_stock ?? m.currentStock ?? 0),
    minimum_threshold: minStock,
    description: m.description || `Raw material ${m.name || ''}`.trim()
  };
  if (Number(m.reorder_quantity) > 0) payload.reorder_quantity = Number(m.reorder_quantity);
  if (hasVal(m.lead_time_days)) payload.lead_time_days = Number(m.lead_time_days);
  const fd = toIsoDateOnly(m.date_added || m.first_date);
  if (fd) { payload.date_added = fd; payload.first_date = fd; }
  return payload;
}

/**
 * Create the database row for a material that only exists locally (manager only; RLS blocks staff).
 * The stock written is this device's CURRENT figure, so it already includes any movement in progress.
 */
async function ensureRemoteMaterial(code, name) {
  if (!supabase || supabase.__offline) return null;
  const local = findLocalMaterial(code, name);
  if (!local) return null;
  const payload = materialInsertPayload(local);
  if (!payload.item_code || !payload.name) return null;
  try {
    const { data, error } = await supabase.from('raw_materials').insert([payload]).select('id, item_code, name, current_stock').limit(1);
    if (!error && Array.isArray(data) && data[0]) return data[0];
    if (error && String(error.code) === '23505') {
      return await resolveRemoteMaterialRow({ code: payload.item_code, name: payload.name });   // created by a parallel call
    }
    if (error) console.warn('[ManagerSupabase] ensure material notice:', error.message);
  } catch (_) {}
  return null;
}

/** Manager device: make sure every local material exists in the database so stock procedures can find it. */
async function seedMissingMaterials(remoteRows) {
  if (!supabase || supabase.__offline || !Array.isArray(remoteRows) || !isManagerSession() || ledgerInFlight > 0) return;
  const have = new Set(remoteRows.map(r => String(r.item_code || '').toUpperCase().trim()));
  const haveNames = new Set(remoteRows.map(r => String(r.name || '').trim().toLowerCase()));
  let locals = [];
  try { locals = getSystemRawMaterials() || []; } catch (_) {}
  const payloads = locals
    .filter(m => {
      const code = String(m.item_code || m.id || '').toUpperCase().trim();
      if (!code || have.has(code)) return false;
      if (haveNames.has(String(m.name || '').trim().toLowerCase())) return false;
      return true;   // the database stamps the company from the signed-in manager, so no client-side tenant rule is needed
    })
    .map(materialInsertPayload)
    .filter(p => p.item_code && p.name);
  if (!payloads.length) return { created: 0, failed: 0 };
  // One row at a time: a single rejected row (for example a code without the company's SKU prefix) must not block the others.
  let created = 0, failed = 0, firstError = '';
  for (const payload of payloads) {
    try {
      const { error } = await supabase.from('raw_materials').insert([payload]);
      if (!error) created++;
      else if (String(error.code) !== '23505') { failed++; if (!firstError) firstError = `${payload.item_code}: ${error.message}`; }
    } catch (e) { failed++; if (!firstError) firstError = `${payload.item_code}: ${e && e.message}`; }
  }
  if (failed) console.warn(`[ManagerSupabase] seed materials: ${created} created, ${failed} rejected. First rejection \u2192 ${firstError}`);
  else if (created) console.info(`[ManagerSupabase] seed materials: ${created} created in the database.`);
  if (created) scheduleLivePull(500, 'seeded');
  return { created, failed, firstError };
}

// Console helper for support: run  rmimsSyncMaterialsNow()  on the manager page to push this device's materials and see the result.
if (typeof window !== 'undefined') {
  window.rmimsSyncMaterialsNow = async () => {
    const { data, error } = await supabase.from('raw_materials').select('item_code,name');
    if (error) { console.warn('read error:', error.message); return { error: error.message }; }
    const res = await seedMissingMaterials(data || []);
    console.info('database rows before:', (data || []).length, 'result:', res);
    return res;
  };
}

/**
 * Reconcile the authoritative Supabase raw_materials rows into the local caches every page renders from.
 *  - Name / unit / MINIMUM STOCK / DATES: the database row always wins (this is the manager's edit).
 *  - Current stock: the database wins unless this device made a NEWER stock change the server has not caught up with.
 *  - A material with an un-pushed local edit (pending flag) is never overwritten.
 * Returns true when anything in the local cache changed.
 */
const LOCAL_STOCK_GRACE_MS = 30000;
export function reconcileRemoteMaterials(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const pending = getPendingPushes();
  const custom = readJsonSafe(CUSTOM_MATS_KEY, []);
  const customList = Array.isArray(custom) ? custom : [];
  const overridesRaw = readJsonSafe(MAT_OVERRIDES_KEY, {});
  const overrides = (overridesRaw && typeof overridesRaw === 'object') ? overridesRaw : {};

  const customIndex = new Map();
  customList.forEach((c, i) => {
    const k = String((c && (c.item_code || c.id)) || '').toUpperCase().trim();
    if (k) customIndex.set(k, i);
  });

  rows.forEach(r => {
    if (!r) return;
    const code = String(r.item_code || '').toUpperCase().trim();
    if (!code) return;
    // Tenant isolation is enforced by the database (row level security): only this company's rows arrive here.
    if (pending[code]) return;                          // local un-pushed edit wins until saved

    const prev = overrides[code] || {};
    const remoteStock = Number(r.current_stock ?? 0);
    const remoteUpdatedMs = Date.parse(r.updated_at || r.last_updated || '') || 0;
    const localStockTs = Number(prev.stock_local_ts || 0);
    // A stock movement made on this device keeps its figure until the database has had time to apply it
    // (stored procedure still running, or the row's updated_at was bumped by an unrelated field update first).
    const withinGrace = localStockTs > 0 && (Date.now() - localStockTs < LOCAL_STOCK_GRACE_MS || ledgerInFlight > 0);
    const localIsNewer = localStockTs > 0 && (localStockTs > remoteUpdatedMs || withinGrace);
    const stock = localIsNewer ? Number(prev.current_stock ?? remoteStock) : remoteStock;

    const minVal = Number(r.minimum_threshold ?? prev.minimum_stock ?? 0);
    const firstDate = toIsoDateOnly(r.first_date) || toIsoDateOnly(r.date_added) ||
      prev.first_date || prev.date_added || (r.created_at ? String(r.created_at).slice(0, 10) : '');
    const latest = laterIso(r.latest_date, r.last_updated, r.updated_at) || prev.last_updated || firstDate;
    const unit = r.unit_of_measure || prev.unit || '';

    const entry = {
      ...prev,
      id: code, item_code: code, db_id: r.id,
      name: r.name, raw_material_name: r.name,
      unit, unit_of_measure: unit,
      current_stock: stock, currentStock: stock, stock, is_zero_explicit: stock === 0,
      minimum_threshold: minVal, minimum_stock: minVal,
      description: r.description ?? prev.description,
      date_added: firstDate, first_date: firstDate, display_date: firstDate,
      last_updated: latest, latest_date: latest,
      is_imported: true, is_manual_override: true
    };
    if (hasVal(r.reorder_quantity)) entry.reorder_quantity = Number(r.reorder_quantity);
    if (hasVal(r.lead_time_days)) entry.lead_time_days = Number(r.lead_time_days);
    if (!localIsNewer && prev.stock_local_ts) delete entry.stock_local_ts; // server caught up

    overrides[code] = { ...entry, maximum_stock: prev.maximum_stock || (entry.reorder_quantity ? entry.reorder_quantity * 2 : prev.maximum_stock) };
    mirrorToLegacyOverrides(code, entry);

    const idx = customIndex.get(code);
    const customEntry = { ...(idx !== undefined ? customList[idx] : {}), ...entry, category: (idx !== undefined && customList[idx].category) || prev.category || undefined };
    if (idx !== undefined) customList[idx] = customEntry;
    else { customIndex.set(code, customList.length); customList.push(customEntry); }
  });

  const before = localStorage.getItem(CUSTOM_MATS_KEY) + '|' + localStorage.getItem(MAT_OVERRIDES_KEY);
  setJsonIfChanged(CUSTOM_MATS_KEY, customList);
  setJsonIfChanged(MAT_OVERRIDES_KEY, overrides);
  const after = localStorage.getItem(CUSTOM_MATS_KEY) + '|' + localStorage.getItem(MAT_OVERRIDES_KEY);
  return before !== after;
}

/**
 * Manager device only: if a local stock correction (e.g. an edited / deleted receipt) is newer than the server
 * value and any in-flight ledger RPC has had time to land, push the absolute figure so staff see the same stock.
 * Absolute writes are idempotent - they can never double count.
 */
async function healLocalNewerStock(rows) {
  if (!supabase || !Array.isArray(rows) || !isManagerSession() || ledgerInFlight > 0) return;
  const overrides = readJsonSafe(MAT_OVERRIDES_KEY, {});
  if (!overrides || typeof overrides !== 'object') return;
  const GRACE_MS = 10000;
  let changed = false;
  for (const r of rows) {
    if (!r) continue;
    const code = String(r.item_code || '').toUpperCase().trim();
    const ov = overrides[code];
    if (!ov || !ov.stock_local_ts) continue;
    const remoteUpdatedMs = Date.parse(r.updated_at || '') || 0;
    if (ov.stock_local_ts <= remoteUpdatedMs) continue;
    if (Date.now() - ov.stock_local_ts < GRACE_MS) continue;
    const localStock = Number(ov.current_stock);
    if (!Number.isFinite(localStock)) continue;
    if (Math.abs(localStock - Number(r.current_stock ?? 0)) < 1e-9) { delete ov.stock_local_ts; changed = true; continue; }
    try {
      const { error } = await supabase.from('raw_materials').update({ current_stock: localStock }).eq('id', r.id);
      if (!error) { delete ov.stock_local_ts; changed = true; }
    } catch (_) {}
  }
  if (changed) setJsonIfChanged(MAT_OVERRIDES_KEY, overrides);
}


/* ==========================================================================
 * RECEIPT / DISBURSEMENT LEDGER MAPPING
 * The reference number (e.g. 2026SMM-R0004) is stored inside the text column ("... [Ref: 2026SMM-R0004]").
 * Receipts saved through the stored procedure used to be written WITHOUT that tag, so on every other device
 * (and for staff) they showed up with a random id, the numbering restarted at 0001, and deleting them did not
 * remove the database copy (so they came back). The tag is written again now; for rows that were saved
 * without it, the number is recovered from the matching audit-log entry written at the same moment.
 * ========================================================================== */
function fetchLedgerAuditRowsQuery() {
  return supabase
    .from('activity_audit_logs')
    .select('action, entity_id, details, created_at')
    .in('action', ['STOCK_RECEIPT', 'MATERIAL_DISBURSEMENT'])
    .order('created_at', { ascending: false })
    .limit(1000);
}

const normName = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function makeRefRecoverer(auditRows, action) {
  const pool = (Array.isArray(auditRows) ? auditRows : [])
    .filter(r => r && String(r.action || '').toUpperCase() === action)
    .map(r => {
      let det = r.details;
      if (typeof det === 'string') { try { det = JSON.parse(det); } catch (_) { det = {}; } }
      det = det || {};
      return { ref: String(det.ref || r.entity_id || '').trim(), qty: Number(det.quantity), mat: normName(det.material), at: Date.parse(r.created_at || '') || 0, used: false };
    })
    .filter(x => x.ref && !/^[0-9a-f]{8}-/i.test(x.ref));
  return (qty, materialName, createdAt) => {
    const at = Date.parse(createdAt || '') || 0;
    const mat = normName(materialName);
    let best = null; let bestScore = Infinity;
    pool.forEach(c => {
      if (c.used || !(Math.abs(c.qty - Number(qty)) < 1e-9)) return;
      const dt = at && c.at ? Math.abs(c.at - at) : Infinity;
      if (dt > 10 * 60 * 1000) return;
      const score = dt + (mat && c.mat && mat !== c.mat ? 60 * 1000 : 0);
      if (score < bestScore) { bestScore = score; best = c; }
    });
    if (!best) return '';
    best.used = true;
    return best.ref;
  };
}

function mapRemoteReceipts(rows, matLookup, auditRows) {
  const recover = makeRefRecoverer(auditRows, 'STOCK_RECEIPT');
  return (rows || [])
    .filter(Boolean)
    .map(sr => {
      const mat = matLookup.get(sr.material_id) || {};
      const name = sr.material_name || mat.name || '';
      const tagged = extractRefFromText(sr.supplier_name);
      const ref = tagged || recover(sr.received_quantity, name, sr.created_at) || sr.id;
      return {
        id: ref,
        ref,
        dbId: sr.id,
        date: sr.receipt_date,
        materialId: mat.item_code || sr.material_id,
        materialName: name,
        quantity: Number(sr.received_quantity || 0),
        unit: sr.unit || mat.unit_of_measure || 'kg',
        supplier: String(sr.supplier_name || '').replace(/\s*\[Ref:[^\]]*\]\s*/i, '').trim(),
        recordedBy: resolveRecorderName({ recordedBy: sr.received_by, ref }),
        status: 'Approved',
        createdAt: sr.created_at
      };
    })
    .filter(r => !isDeleted('receipt', r.ref, r.dbId));
}

function mapRemoteDisbursements(rows, matLookup, auditRows) {
  const recover = makeRefRecoverer(auditRows, 'MATERIAL_DISBURSEMENT');
  return (rows || [])
    .filter(Boolean)
    .map(sd => {
      const mat = matLookup.get(sd.material_id) || {};
      const name = sd.material_name || mat.name || '';
      const tagged = extractRefFromText(sd.activity_type);
      const ref = tagged || recover(sd.consumed_quantity, name, sd.created_at) || sd.id;
      return {
        id: ref,
        ref,
        dbId: sd.id,
        date: sd.usage_date,
        materialId: mat.item_code || sd.material_id,
        materialName: name,
        quantity: Number(sd.consumed_quantity || 0),
        unit: sd.unit || mat.unit_of_measure || 'kg',
        recipient: resolveFinishedProductName(name, sd.finished_product_name),
        usedFor: resolveFinishedProductName(name, sd.finished_product_name),
        recordedBy: resolveRecorderName({ recordedBy: sd.recorded_by, ref }),
        status: 'Approved',
        createdAt: sd.created_at
      };
    })
    .filter(d => !isDeleted('disbursement', d.ref, d.dbId));
}

/**
 * Write the database ledger into this device's cache.
 * Manager: keep every local entry (one that has not reached the database yet must never disappear), add the
 * database entries this device does not have. Staff: the database is the ledger.
 * Read + write happen in one synchronous step so nothing saved in between can be lost.
 */
function mergeRemoteLedgerIntoLocal(key, kind, remoteList) {
  if (!isManagerSession()) {
    setJsonIfChanged(key, remoteList);
    return;
  }
  let local = readJsonSafe(key, []);
  if (!Array.isArray(local)) local = [];
  local = local.filter(r => r && !isDeleted(kind, r.ref, r.id));
  const byRef = new Map();
  local.forEach(r => byRef.set(String(r.ref || r.id), r));
  remoteList.forEach(r => {
    const k = String(r.ref || r.id);
    const mine = byRef.get(k);
    if (mine) {
      if (!mine.dbId && r.dbId) byRef.set(k, { ...mine, dbId: r.dbId });
      return;
    }
    byRef.set(k, r);
  });
  setJsonIfChanged(key, Array.from(byRef.values()));
}

/** Database ids of the ledger rows that carry this reference (tag in the text, or recovered from the audit log). */
async function findRemoteLedgerIdsForRef(kind, ref) {
  const table = kind === 'receipt' ? 'stock_receipts' : 'material_disbursements';
  const textCol = kind === 'receipt' ? 'supplier_name' : 'activity_type';
  const qtyCol = kind === 'receipt' ? 'received_quantity' : 'consumed_quantity';
  const ids = new Set();
  try {
    const [rowsRes, auditRes] = await Promise.all([
      fetchWithTimeout(supabase.from(table).select(`id, material_id, ${qtyCol}, ${textCol}, created_at`), 5000),
      fetchWithTimeout(fetchLedgerAuditRowsQuery(), 5000)
    ]);
    const rows = (rowsRes && Array.isArray(rowsRes.data)) ? rowsRes.data : [];
    const recover = makeRefRecoverer((auditRes && auditRes.data) || [], kind === 'receipt' ? 'STOCK_RECEIPT' : 'MATERIAL_DISBURSEMENT');
    let names = new Map();
    try { (getSystemRawMaterials() || []).forEach(m => { if (m.db_id) names.set(m.db_id, m.name); }); } catch (_) {}
    rows.forEach(r => {
      const tagged = extractRefFromText(r[textCol]);
      const got = tagged || recover(r[qtyCol], names.get(r.material_id) || '', r.created_at);
      if (got === ref) ids.add(r.id);
    });
  } catch (_) {}
  return Array.from(ids);
}

/**
 * Fetch all live manager & store data directly from Supabase
 */
export async function fetchManagerDashboardData() {
  const result = {
    rawMaterials: [],
    stockReceipts: [],
    materialDisbursements: [],
    auditLogs: [],
    userProfiles: [],
    isLive: false
  };

  if (!supabase) return result;

  try {
    const [matRes, rcvRes, disbRes, logRes, profRes, ledgerAuditRes] = await Promise.allSettled([
      fetchWithTimeout(supabase.from('raw_materials').select('*').order('name')),
      fetchWithTimeout(supabase.from('stock_receipts').select('*').order('receipt_date', { ascending: false })),
      fetchWithTimeout(supabase.from('material_disbursements').select('*').order('usage_date', { ascending: false })),
      fetchWithTimeout(supabase.from('activity_audit_logs').select('*').order('created_at', { ascending: false }).limit(50)),
      fetchWithTimeout(supabase.from('user_profiles').select('*')),
      fetchWithTimeout(fetchLedgerAuditRowsQuery())
    ]);

    if (matRes.status === 'fulfilled' && Array.isArray(matRes.value?.data)) {
      result.rawMaterials = matRes.value.data;
    }
    if (rcvRes.status === 'fulfilled' && Array.isArray(rcvRes.value?.data)) {
      result.stockReceipts = rcvRes.value.data;
    }
    if (disbRes.status === 'fulfilled' && Array.isArray(disbRes.value?.data)) {
      result.materialDisbursements = disbRes.value.data;
    }
    if (logRes.status === 'fulfilled' && Array.isArray(logRes.value?.data)) {
      result.auditLogs = logRes.value.data;
    }
    if (profRes.status === 'fulfilled' && Array.isArray(profRes.value?.data)) {
      result.userProfiles = profRes.value.data;
    }

    result.isLive = true;

    // Restore persistent finished products from Supabase
    fetchLiveFinishedProductsFromSupabase().catch(() => {});

    // Authoritatively synchronize Supabase raw_materials (stock, MINIMUM STOCK, DATES) with the local master cache
    if (matRes.status === 'fulfilled' && Array.isArray(matRes.value?.data)) {
      try {
        reconcileRemoteMaterials(matRes.value.data);
        healLocalNewerStock(matRes.value.data).catch(() => {});
      } catch (e) {
        console.warn('[ManagerSupabase] Error syncing materials to local storage:', e);
      }
    }

    // Resolve recorder UUIDs to real names before mapping the ledger
    try { await loadRecorderDirectory(supabase); } catch (_) {}

    // Lookup so remote ledger rows (which only carry a UUID) show a real material name / code
    const matLookup = new Map();
    (result.rawMaterials || []).forEach(m => { if (m && m.id) matLookup.set(m.id, m); });

    const auditLedgerRows = (ledgerAuditRes.status === 'fulfilled' && Array.isArray(ledgerAuditRes.value?.data)) ? ledgerAuditRes.value.data : [];

    // Receipts: merge without wiping local entries (manager), database is the ledger (staff)
    if (rcvRes.status === 'fulfilled' && Array.isArray(rcvRes.value?.data)) {
      try {
        const remoteRec = mapRemoteReceipts(rcvRes.value.data, matLookup, auditLedgerRows);
        mergeRemoteLedgerIntoLocal(MGR_RECEIPTS_KEY, 'receipt', remoteRec);
      } catch (e) {
        console.warn('[ManagerSupabase] Error syncing receipts to local storage:', e);
      }
    }

    // Disbursements: same rules
    if (disbRes.status === 'fulfilled' && Array.isArray(disbRes.value?.data)) {
      try {
        const remoteDisb = mapRemoteDisbursements(disbRes.value.data, matLookup, auditLedgerRows);
        mergeRemoteLedgerIntoLocal(MGR_DISBURSEMENTS_KEY, 'disbursement', remoteDisb);
      } catch (e) {
        console.warn('[ManagerSupabase] Error syncing disbursements to local storage:', e);
      }
    }

  } catch (err) {
    console.warn('[ManagerSupabase] Live fetch warning:', err);
  }

  return result;
}


/**
 * Fallback used ONLY when the stock-moving stored procedure could not run but the ledger row was saved.
 * Sets the database stock to this device's already-adjusted figure (absolute => idempotent, never double counts).
 */
async function pushLocalStockAbsolute(dbId, ...keys) {
  if (!supabase || !dbId) return;
  try {
    const wanted = keys.map(k => String(k || '').trim().toLowerCase()).filter(Boolean);
    const mat = (getSystemRawMaterials() || []).find(m =>
      wanted.includes(String(m.id || '').toLowerCase()) ||
      wanted.includes(String(m.item_code || '').toLowerCase()) ||
      wanted.includes(String(m.name || m.raw_material_name || '').trim().toLowerCase())
    );
    if (!mat) return;
    const stock = Number(mat.current_stock ?? mat.currentStock ?? 0);
    if (!Number.isFinite(stock)) return;
    await supabase.from('raw_materials').update({ current_stock: stock }).eq('id', dbId);
  } catch (_) {}
}

/**
 * Record stock receipt directly to Supabase inflow ledger and update recorded stock
 */
export async function recordStockReceiptToSupabase(receipt) {
  ledgerInFlight++;
  try { return await recordStockReceiptInternal(receipt); }
  finally { ledgerInFlight = Math.max(0, ledgerInFlight - 1); }
}

async function recordStockReceiptInternal(receipt) {
  if (!supabase || !receipt) return { success: false };
  if (isAdminSession()) return { success: false, error: 'Administrator accounts cannot record raw-material movements.' };

  try {
    const rawDate = receipt.date || receipt.receipt_date || new Date().toISOString().slice(0, 10);
    const dateOnly = String(rawDate).split(' • ')[0].split('T')[0];
    const qty = Number(receipt.quantity || receipt.received_quantity || 0);

    // Resolve 36-char material UUID if only code or name provided
    let resolvedMaterialId = (receipt.materialId && receipt.materialId.length === 36) ? receipt.materialId : null;
    let stockAlreadyApplied = false;
    if (!resolvedMaterialId) {
      const matCode = receipt.item_code || receipt.materialId;
      let foundMat = await resolveRemoteMaterialRow({ code: matCode, name: receipt.materialName || receipt.material });
      if (foundMat && foundMat.id) {
        if (claimFreshStock(foundMat.item_code || matCode)) stockAlreadyApplied = true;
      } else {
        // No database row yet: create it from this device's figure (already includes this movement).
        foundMat = await ensureRemoteMaterial(matCode, receipt.materialName || receipt.material);
        if (foundMat) stockAlreadyApplied = true;
      }
      if (foundMat && foundMat.id) resolvedMaterialId = foundMat.id;
    }

    // 1. Try stored procedure if available
    let rpcSuccess = false;
    if (resolvedMaterialId && !stockAlreadyApplied) {
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('record_stock_receipt_v2', {
          p_material_id: resolvedMaterialId,
          p_receipt_date: dateOnly,
          p_quantity: qty,
          p_unit: receipt.unit || 'kg',
          // The reference tag MUST be stored, otherwise other devices cannot recognise / delete this receipt.
          p_supplier_name: (receipt.supplier || receipt.supplier_name || '') + (receipt.ref ? ` [Ref: ${receipt.ref}]` : '')
        });
        if (!rpcErr && rpcData?.success) {
          rpcSuccess = true;
        }
      } catch (_) {}
    }

    // 2. Direct insert into stock_receipts if RPC not used
    if (!rpcSuccess) {
      const payload = {
        receipt_date: dateOnly,
        received_quantity: qty,
        unit: receipt.unit || 'kg',
        supplier_name: (receipt.supplier || receipt.supplier_name || '') + (receipt.ref ? ` [Ref: ${receipt.ref}]` : '')
      };
      if (resolvedMaterialId) {
        payload.material_id = resolvedMaterialId;
      }
      const { data, error } = await supabase.from('stock_receipts').insert([payload]).select();
      if (error) {
        console.warn('[ManagerSupabase] Direct stock_receipts insert notice:', error.message);
      } else if (resolvedMaterialId && !stockAlreadyApplied) {
        // The stored procedure did not run, so stock was not applied server-side: mirror the absolute figure.
        await pushLocalStockAbsolute(resolvedMaterialId, receipt.item_code, receipt.materialId, receipt.materialName, receipt.material);
      }
    }

    // 3. Log to activity_audit_logs
    await logManagerActivityToSupabase({
      action: 'STOCK_RECEIPT',
      entityType: 'stock_receipts',
      entityId: receipt.ref || receipt.id || '',
      details: {
        ref: receipt.ref,
        material: receipt.materialName || receipt.material,
        quantity: qty,
        unit: receipt.unit,
        supplier: receipt.supplier
      }
    });

    return { success: true, stockAppliedByProcedure: rpcSuccess || stockAlreadyApplied };
  } catch (err) {
    console.warn('[ManagerSupabase] Error recording receipt to Supabase:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Record material disbursement directly to Supabase outflow ledger and update recorded stock
 */
export async function recordMaterialDisbursementToSupabase(disbursement) {
  ledgerInFlight++;
  try { return await recordMaterialDisbursementInternal(disbursement); }
  finally { ledgerInFlight = Math.max(0, ledgerInFlight - 1); }
}

async function recordMaterialDisbursementInternal(disbursement) {
  if (!supabase || !disbursement) return { success: false };
  if (isAdminSession()) return { success: false, error: 'Administrator accounts cannot record raw-material movements.' };

  try {
    const rawDate = disbursement.date || disbursement.usage_date || new Date().toISOString().slice(0, 10);
    const dateOnly = String(rawDate).split(' • ')[0].split('T')[0];
    const qty = Number(disbursement.quantity || disbursement.consumed_quantity || 0);

    // Resolve 36-char material UUID if only code or name provided
    let resolvedMaterialId = (disbursement.materialId && disbursement.materialId.length === 36) ? disbursement.materialId : null;
    let stockAlreadyApplied = false;
    if (!resolvedMaterialId) {
      const matCode = disbursement.item_code || disbursement.materialId;
      let foundMat = await resolveRemoteMaterialRow({ code: matCode, name: disbursement.materialName || disbursement.material });
      if (foundMat && foundMat.id) {
        if (claimFreshStock(foundMat.item_code || matCode)) stockAlreadyApplied = true;
      } else {
        // No database row yet: create it from this device's figure (already includes this movement).
        foundMat = await ensureRemoteMaterial(matCode, disbursement.materialName || disbursement.material);
        if (foundMat) stockAlreadyApplied = true;
      }
      if (foundMat && foundMat.id) resolvedMaterialId = foundMat.id;
    }

    // 1. Try stored procedure if available
    let rpcSuccess = false;
    if (resolvedMaterialId && !stockAlreadyApplied) {
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('record_material_disbursement_v2', {
          p_material_id: resolvedMaterialId,
          p_usage_date: dateOnly,
          p_quantity: qty,
          p_unit: disbursement.unit || 'kg',
          p_activity_type: (disbursement.activityType || disbursement.activity_type || 'Production Usage') + (disbursement.ref ? ` [Ref: ${disbursement.ref}]` : ''),
          p_finished_product_name: resolveFinishedProductName(disbursement.materialName || disbursement.material, disbursement.recipient || disbursement.usedFor || disbursement.finished_product_name)
        });
        if (!rpcErr && rpcData?.success) {
          rpcSuccess = true;
        }
      } catch (_) {}
    }

    // 2. Direct insert into material_disbursements if RPC not used
    if (!rpcSuccess) {
      const payload = {
        usage_date: dateOnly,
        consumed_quantity: qty,
        unit: disbursement.unit || 'kg',
        activity_type: (disbursement.activityType || disbursement.activity_type || 'Production Usage') + (disbursement.ref ? ` [Ref: ${disbursement.ref}]` : ''),
        finished_product_name: resolveFinishedProductName(disbursement.materialName || disbursement.material, disbursement.recipient || disbursement.usedFor || disbursement.finished_product_name)
      };
      if (resolvedMaterialId) {
        payload.material_id = resolvedMaterialId;
      }
      const { data, error } = await supabase.from('material_disbursements').insert([payload]).select();
      if (error) {
        console.warn('[ManagerSupabase] Direct material_disbursements insert notice:', error.message);
      } else if (resolvedMaterialId && !stockAlreadyApplied) {
        await pushLocalStockAbsolute(resolvedMaterialId, disbursement.item_code, disbursement.materialId, disbursement.materialName, disbursement.material);
      }
    }

    // 3. Log to activity_audit_logs
    await logManagerActivityToSupabase({
      action: 'MATERIAL_DISBURSEMENT',
      entityType: 'material_disbursements',
      entityId: disbursement.ref || disbursement.id || '',
      details: {
        ref: disbursement.ref,
        material: disbursement.materialName || disbursement.material,
        quantity: qty,
        unit: disbursement.unit,
        recipient: disbursement.recipient || disbursement.usedFor
      }
    });

    return { success: true, stockAppliedByProcedure: rpcSuccess || stockAlreadyApplied };
  } catch (err) {
    console.warn('[ManagerSupabase] Error recording disbursement to Supabase:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Append audit event to Supabase activity_audit_logs
 */
export async function logManagerActivityToSupabase({ action, entityType, entityId, details = {} }) {
  if (!supabase) return;
  try {
    let userId = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) userId = user.id;
    } catch (_) {}

    await supabase.from('activity_audit_logs').insert([{
      user_id: userId,
      action: action || 'MANAGER_ACTION',
      entity_type: entityType || 'general',
      entity_id: String(entityId || ''),
      details: details || {}
    }]);
  } catch (e) {
    console.warn('[ManagerSupabase] Audit log notice:', e);
  }
}

/**
 * Approve a transaction on Supabase and unify across all manager modules
 */
export async function approveTransactionOnSupabase(tx) {
  if (!tx) return { success: false, message: 'Invalid transaction' };

  const refStr = String(tx.ref || '');
  const isReceive = (tx.activity || tx.type || '').toLowerCase().includes('rec') ||
                    refStr.toUpperCase().startsWith('REC') ||
                    /-R\d+/i.test(refStr);
  const qty = parseFloat(tx.quantity != null ? tx.quantity : (tx.qtyNum != null ? tx.qtyNum : tx.qty)) || 0;
  const unit = tx.unit || (tx.qty ? String(tx.qty).replace(/^[0-9.\s]+/, '') : '') || 'kg';
  const materialName = tx.material || tx.materialName || '';

  // 1. Authoritative local stock update via system-materials
  const materials = getSystemRawMaterials();
  const searchName = String(materialName).trim().toLowerCase();
  const foundMat = materials.find(m =>
    (m.name || m.raw_material_name || '').trim().toLowerCase() === searchName ||
    String(m.id || '').toLowerCase() === searchName ||
    String(m.item_code || '').toLowerCase() === searchName
  );

  const matId = foundMat ? (foundMat.id || foundMat.item_code) : (tx.materialId || tx.item_code || materialName);
  const resolvedMatName = foundMat ? (foundMat.name || foundMat.raw_material_name) : materialName;
  const delta = isReceive ? qty : -qty;

  const updatedMat = adjustSystemMaterialStock(matId || resolvedMatName, delta);
  updateMaterialActivityTimestamp(matId || resolvedMatName, new Date().toISOString(), isReceive ? 'Receive' : 'Disburse', qty, unit);
  if (updatedMat) {
    saveRawMaterialToSupabase({
      id: updatedMat.id,
      item_code: updatedMat.item_code || updatedMat.id,
      name: updatedMat.name,
      raw_material_name: updatedMat.raw_material_name || updatedMat.name,
      current_stock: updatedMat.current_stock,
      unit: updatedMat.unit || updatedMat.unit_of_measure
    }, { skipStockPush: true }).catch(e => console.warn('[ManagerSupabase] Stock sync notice:', e));
  }

  // 2. Persist to Supabase and custom ledgers
  if (isReceive) {
    saveCustomReceipt({
      id: `rec-${tx.ref}`,
      referenceNo: tx.ref,
      material_id: matId,
      material_name: resolvedMatName,
      received_quantity: qty,
      unit: unit,
      receipt_date: tx.date || new Date().toISOString().slice(0, 10),
      supplier_name: tx.supplier || '',
      received_by: tx.staff || 'Staff Member'
    });

    try {
      const mgrRecRaw = localStorage.getItem(MGR_RECEIPTS_KEY);
      let mgrRecs = mgrRecRaw ? JSON.parse(mgrRecRaw) : [];
      if (!Array.isArray(mgrRecs)) mgrRecs = [];
      mgrRecs = mgrRecs.filter(r => r.ref !== tx.ref);
      mgrRecs.unshift({
        ref: tx.ref,
        date: tx.date || new Date().toISOString().slice(0, 10),
        time: tx.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        materialId: matId,
        materialName: resolvedMatName,
        quantity: qty,
        unit: unit,
        supplier: tx.supplier || '',
        recordedBy: tx.staff || 'Staff Member',
        approvedBy: 'Store Manager',
        status: 'Approved',
        notes: tx.notes || `Submitted by ${tx.staff || 'Staff'}, approved by Manager`
      });
      localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(mgrRecs));
    } catch (_) {}

    // Supabase commit
    await recordStockReceiptToSupabase({
      ref: tx.ref,
      materialId: matId,
      materialName: resolvedMatName,
      quantity: qty,
      unit: unit,
      date: tx.date,
      supplier: tx.supplier
    });
  } else {
    saveCustomDisbursement({
      id: `disb-${tx.ref}`,
      referenceNo: tx.ref,
      material_id: matId,
      material_name: resolvedMatName,
      consumed_quantity: qty,
      unit: unit,
      usage_date: tx.date || new Date().toISOString().slice(0, 10),
      activity_type: 'Production Usage',
      finished_product_name: resolveFinishedProductName(resolvedMatName || materialName, tx.usedFor),
      disbursed_by: tx.staff || 'Staff Member'
    });

    try {
      const mgrDisbRaw = localStorage.getItem(MGR_DISBURSEMENTS_KEY);
      let mgrDisbs = mgrDisbRaw ? JSON.parse(mgrDisbRaw) : [];
      if (!Array.isArray(mgrDisbs)) mgrDisbs = [];
      mgrDisbs = mgrDisbs.filter(d => d.ref !== tx.ref);
      mgrDisbs.unshift({
        ref: tx.ref,
        date: tx.date || new Date().toISOString().slice(0, 10),
        time: tx.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        materialId: matId,
        materialName: resolvedMatName,
        quantity: qty,
        unit: unit,
        recipient: resolveFinishedProductName(resolvedMatName, tx.usedFor),
        recordedBy: tx.staff || 'Staff Member',
        approvedBy: 'Store Manager',
        status: 'Approved',
        notes: tx.notes || `Submitted by ${tx.staff || 'Staff'}, approved by Manager`
      });
      localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(mgrDisbs));
    } catch (_) {}

    // Supabase commit
    await recordMaterialDisbursementToSupabase({
      ref: tx.ref,
      materialId: matId,
      materialName: resolvedMatName,
      quantity: qty,
      unit: unit,
      date: tx.date,
      recipient: tx.usedFor
    });
  }

  // 3. Update staff transaction status
  let updatedStaffTx = null;
  try {
    const rawStaff = localStorage.getItem(STAFF_TX_KEY);
    if (rawStaff) {
      const staffList = JSON.parse(rawStaff);
      if (Array.isArray(staffList)) {
        const idx = staffList.findIndex(t => t.ref === tx.ref || t.id === tx.id);
        if (idx !== -1) {
          staffList[idx].status = 'Approved';
          staffList[idx].approvedBy = 'Store Manager';
          staffList[idx].approvedAt = new Date().toISOString();
          staffList[idx].updatedAt = new Date().toISOString();
          staffList[idx].quantity = qty;
          staffList[idx].unit = unit;
          updatedStaffTx = staffList[idx];
          localStorage.setItem(STAFF_TX_KEY, JSON.stringify(staffList));
        }
      }
    }
  } catch (_) {}

  if (updatedStaffTx) {
    await syncStaffTransactionToSupabase(updatedStaffTx);
  }

  // 4. Log Manager Activity
  try {
    const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
    const actRaw = localStorage.getItem(MGR_ACTIVITIES_KEY);
    const acts = actRaw ? JSON.parse(actRaw) : [];
    acts.unshift({
      datetime: 'Just now',
      timestamp: new Date().toISOString(),
      activity: 'Approve Transaction',
      reference: tx.ref,
      status: 'Approved',
      user: curUser.name || curUser.fullName || curUser.username || 'Manager',
      role: curUser.role || 'Manager',
      branchLoc: curUser.branchLoc || curUser.location || '',
      branchName: curUser.branchName || curUser.branch || '',
      action: 'Approved',
      module: 'Inventory'
    });
    localStorage.setItem(MGR_ACTIVITIES_KEY, JSON.stringify(acts));
  } catch (_) {}

  // 5. Audit log in Supabase
  await logManagerActivityToSupabase({
    action: 'APPROVE_TRANSACTION',
    entityType: 'staff_transactions',
    entityId: tx.ref || tx.id || '',
    details: {
      ref: tx.ref,
      material: resolvedMatName,
      quantity: qty,
      unit: unit,
      activity: tx.activity || (isReceive ? 'Receive' : 'Disburse')
    }
  });

  // 6. Push notification for Staff
  const appNotif = {
    title: `Transaction Approved: ${tx.ref}`,
    message: `Store Manager approved ${tx.ref} (${qty} ${unit} of ${resolvedMatName}). Official stock synchronized.`,
    category: 'Inventory',
    badge: 'Approved',
    role: 'staff',
    targetRole: 'staff',
    roleScope: 'staff',
    priority: 'success',
    targetUrl: `user/my-activity.html?view=${encodeURIComponent(tx.ref)}`,
    ref: tx.ref,
    material: resolvedMatName,
    quantity: `${qty} ${unit}`,
    actor: 'Store Manager'
  };

  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(appNotif);
    }
  } catch (_) {}

  // 7. Global synchronization broadcast across all manager & staff modules
  invalidateForecastCache();
  broadcastManagerSync({
    action: 'approve_transaction',
    ref: tx.ref,
    material: resolvedMatName,
    isReceive: isReceive,
    notification: appNotif
  });

  return { success: true };
}

/**
 * Reject a transaction on Supabase and unify across all manager modules
 */
export async function rejectTransactionOnSupabase(tx, reason = 'Details require correction.') {
  if (!tx) return { success: false, message: 'Invalid transaction' };

  // 1. Update staff transaction status in local storage
  let updatedStaffTx = null;
  try {
    const rawStaff = localStorage.getItem(STAFF_TX_KEY);
    if (rawStaff) {
      const staffList = JSON.parse(rawStaff);
      if (Array.isArray(staffList)) {
        const idx = staffList.findIndex(t => t.ref === tx.ref || t.id === tx.id);
        if (idx !== -1) {
          staffList[idx].status = 'Rejected';
          staffList[idx].rejectionReason = reason;
          staffList[idx].rejectedBy = 'Store Manager';
          staffList[idx].rejectedAt = new Date().toISOString();
          staffList[idx].updatedAt = new Date().toISOString();
          updatedStaffTx = staffList[idx];
          localStorage.setItem(STAFF_TX_KEY, JSON.stringify(staffList));
        }
      }
    }
  } catch (_) {}

  if (updatedStaffTx) {
    await syncStaffTransactionToSupabase(updatedStaffTx);
  }

  // 2. Log manager activity in local storage
  try {
    const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
    const actRaw = localStorage.getItem(MGR_ACTIVITIES_KEY);
    const acts = actRaw ? JSON.parse(actRaw) : [];
    acts.unshift({
      datetime: 'Just now',
      timestamp: new Date().toISOString(),
      activity: 'Reject Transaction',
      reference: tx.ref,
      status: 'Rejected',
      user: curUser.name || curUser.fullName || curUser.username || 'Manager',
      role: curUser.role || 'Manager',
      action: 'Rejected',
      module: 'Inventory'
    });
    localStorage.setItem(MGR_ACTIVITIES_KEY, JSON.stringify(acts));
  } catch (_) {}

  // 3. Audit log in Supabase
  await logManagerActivityToSupabase({
    action: 'REJECT_TRANSACTION',
    entityType: 'staff_transactions',
    entityId: tx.ref || tx.id || '',
    details: {
      ref: tx.ref,
      reason: reason,
      material: tx.material || tx.materialName
    }
  });

  // 4. Staff notification
  const rejNotif = {
    title: `Transaction Rejected: ${tx.ref}`,
    message: `Transaction ${tx.ref} was rejected by Store Manager: "${reason}".`,
    category: 'Inventory',
    badge: 'Rejected',
    role: 'staff',
    targetRole: 'staff',
    roleScope: 'staff',
    priority: 'danger',
    targetUrl: `user/my-activity.html?view=${encodeURIComponent(tx.ref)}`,
    ref: tx.ref,
    material: tx.material || tx.materialName || '',
    actor: 'Store Manager'
  };

  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(rejNotif);
    }
  } catch (_) {}

  // 5. Broadcast across tabs
  broadcastManagerSync({
    action: 'reject_transaction',
    ref: tx.ref,
    reason: reason,
    notification: rejNotif
  });

  return { success: true };
}


/**
 * Soft-delete a staff transaction: the record stays, but its status becomes "Deleted"
 * on the manager side AND on the staff side (synced through the audit log).
 */
export async function deleteStaffTransactionOnSupabase(tx, reason = '') {
  if (!tx || !tx.ref) return { success: false, message: 'Invalid transaction' };
  const nowIso = new Date().toISOString();
  let updated = null;
  try {
    const raw = localStorage.getItem(STAFF_TX_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) {
      const idx = list.findIndex(t => t.ref === tx.ref || (tx.id && t.id === tx.id));
      if (idx !== -1) {
        list[idx].previousStatus = list[idx].status;
        list[idx].status = 'Deleted';
        list[idx].deletedBy = 'Store Manager';
        list[idx].deletedAt = nowIso;
        list[idx].deleteReason = reason || '';
        list[idx].updatedAt = nowIso;
        updated = list[idx];
        localStorage.setItem(STAFF_TX_KEY, JSON.stringify(list));
      }
    }
  } catch (_) {}
  if (!updated) updated = { ...tx, status: 'Deleted', deletedBy: 'Store Manager', deletedAt: nowIso, updatedAt: nowIso };

  await syncStaffTransactionToSupabase(updated);

  try {
    const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
    const acts = JSON.parse(localStorage.getItem(MGR_ACTIVITIES_KEY) || '[]');
    acts.unshift({
      datetime: 'Just now', timestamp: nowIso,
      activity: 'Delete Transaction', reference: tx.ref, status: 'Deleted',
      user: curUser.name || curUser.fullName || curUser.username || 'Manager',
      role: curUser.role || 'Manager', action: 'Deleted', module: 'Inventory'
    });
    localStorage.setItem(MGR_ACTIVITIES_KEY, JSON.stringify(acts));
  } catch (_) {}

  await logManagerActivityToSupabase({
    action: 'DELETE_STAFF_TRANSACTION',
    entityType: 'staff_transactions',
    entityId: tx.ref,
    details: { ref: tx.ref, material: tx.material || tx.materialName, reason }
  });

  const notif = {
    title: `Transaction Deleted: ${tx.ref}`,
    message: `Transaction ${tx.ref} was deleted by the Store Manager.`,
    category: 'Inventory', badge: 'Deleted', role: 'staff', targetRole: 'staff', roleScope: 'staff',
    priority: 'warning', targetUrl: `user/my-activity.html?view=${encodeURIComponent(tx.ref)}`,
    ref: tx.ref, material: tx.material || tx.materialName || '', actor: 'Store Manager'
  };
  try { if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') window.pushRMIMSNotification(notif); } catch (_) {}
  broadcastManagerSync({ action: 'delete_transaction', ref: tx.ref, notification: notif });
  return { success: true, tx: updated };
}

/**
 * Return a transaction for staff correction on Supabase and unify across all manager modules
 */
export async function returnTransactionForCorrectionOnSupabase(tx, message = 'Please correct details and resubmit.') {
  if (!tx) return { success: false, message: 'Invalid transaction' };

  // 1. Update staff transaction status in local storage
  let updatedStaffTx = null;
  try {
    const rawStaff = localStorage.getItem(STAFF_TX_KEY);
    if (rawStaff) {
      const staffList = JSON.parse(rawStaff);
      if (Array.isArray(staffList)) {
        const idx = staffList.findIndex(t => t.ref === tx.ref || t.id === tx.id);
        if (idx !== -1) {
          staffList[idx].status = 'Correction Needed';
          staffList[idx].correctionMessage = message;
          staffList[idx].returnedBy = 'Store Manager';
          staffList[idx].returnedAt = new Date().toISOString();
          staffList[idx].updatedAt = new Date().toISOString();
          staffList[idx].isUpdated = false;
          updatedStaffTx = staffList[idx];
          localStorage.setItem(STAFF_TX_KEY, JSON.stringify(staffList));
        }
      }
    }
  } catch (_) {}

  if (!updatedStaffTx && tx.ref) {
    updatedStaffTx = {
      ...tx,
      status: 'Correction Needed',
      correctionMessage: message,
      returnedBy: 'Store Manager',
      returnedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isUpdated: false
    };
  }

  if (updatedStaffTx) {
    await syncStaffTransactionToSupabase(updatedStaffTx);
  }

  // 2. Log manager activity in local storage
  try {
    const curUser = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}');
    const actRaw = localStorage.getItem(MGR_ACTIVITIES_KEY);
    const acts = actRaw ? JSON.parse(actRaw) : [];
    acts.unshift({
      datetime: 'Just now',
      timestamp: new Date().toISOString(),
      activity: 'Requested Correction',
      reference: tx.ref,
      status: 'Correction Needed',
      user: curUser.name || curUser.fullName || curUser.username || 'Manager',
      role: curUser.role || 'Manager',
      action: 'Correction Needed',
      module: 'Inventory'
    });
    localStorage.setItem(MGR_ACTIVITIES_KEY, JSON.stringify(acts));
  } catch (_) {}

  // 3. Audit log in Supabase
  await logManagerActivityToSupabase({
    action: 'RETURN_FOR_CORRECTION',
    entityType: 'staff_transactions',
    entityId: tx.ref || tx.id || '',
    details: {
      ref: tx.ref,
      message: message,
      material: tx.material || tx.materialName
    }
  });

  // 4. Staff notification
  const corrNotif = {
    title: `Correction Requested: ${tx.ref}`,
    message: `Transaction ${tx.ref} returned by Store Manager: "${message}". Action required from staff.`,
    category: 'Inventory',
    badge: 'Action Required',
    role: 'staff',
    targetRole: 'staff',
    roleScope: 'staff',
    priority: 'high',
    targetUrl: `user/my-activity.html?correct=${encodeURIComponent(tx.ref)}`,
    ref: tx.ref,
    material: tx.material || tx.materialName || '',
    quantity: tx.quantity != null ? String(tx.quantity) : (tx.qty || ''),
    actor: 'Store Manager'
  };

  try {
    if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
      window.pushRMIMSNotification(corrNotif);
    }
  } catch (_) {}

  // 5. Broadcast across tabs
  broadcastManagerSync({
    action: 'return_for_correction',
    ref: tx.ref,
    message: message,
    notification: corrNotif
  });

  return { success: true };
}

/**
 * Synchronize a Staff Transaction state object to Supabase activity_audit_logs
 * so Staff and Manager portals always see the exact same transaction & correction state across tabs/sessions.
 */
export async function syncStaffTransactionToSupabase(tx) {
  if (!supabase || !tx || !tx.ref) return;
  try {
    await logManagerActivityToSupabase({
      action: 'STAFF_TX_STATE',
      entityType: 'staff_transactions',
      entityId: String(tx.ref),
      details: tx
    });
  } catch (e) {
    console.warn('[ManagerSupabase] Staff tx sync notice:', e);
  }
}

/**
 * Fetch and reconcile all Staff Transactions (Receive, Disburse, Corrections, Resubmissions) from Supabase
 */
function readLocalStaffList() {
  let list = [];
  try {
    const raw = localStorage.getItem(STAFF_TX_KEY);
    list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
  } catch (_) {
    list = [];
  }
  // Never show transactions the manager has permanently deleted
  return list.filter(item => item && !isRefDeletedAny(item.ref));
}

/**
 * Turn the shared audit-log rows into one "latest known state" per reference.
 * The FIRST snapshot saved for a reference decides which record owns that number; snapshots of a different
 * record that happened to get the same number (two devices, no sync yet) are ignored here.
 */
function buildRemoteStaffState(rowsNewestFirst) {
  const state = new Map(); // ref -> { tx, ver, ownerId }
  const chronological = [...rowsNewestFirst].reverse();
  chronological.forEach(row => {
    if (!row) return;
    let det = row.details;
    if (typeof det === 'string') { try { det = JSON.parse(det); } catch (_) { det = null; } }
    if (!det || typeof det !== 'object') return;
    const ref = String(det.ref || row.entity_id || '').trim();
    if (!ref) return;
    const actionType = String(row.action || row.action_type || '').toUpperCase();
    const rowTime = Date.parse(row.created_at || '') || 0;
    const rowIso = row.created_at || new Date().toISOString();
    const cur = state.get(ref);

    if (actionType === 'STAFF_TX_STATE' && det.activity && det.material) {
      const ownerId = cur ? cur.ownerId : (det.id || null);
      if (ownerId && det.id && det.id !== ownerId) return; // a different record that reused this number
      const tx = { ...(cur ? cur.tx : {}), ...det };
      state.set(ref, { tx, ver: Math.max(cur ? cur.ver : 0, txVersion(det), rowTime), ownerId: ownerId || det.id || null });
      return;
    }
    if (!cur) return;
    let patch = null;
    if (actionType === 'RETURN_FOR_CORRECTION') {
      patch = { status: 'Correction Needed', correctionMessage: det.message || cur.tx.correctionMessage || 'Please correct details and resubmit.', returnedBy: 'Store Manager', returnedAt: rowIso, isUpdated: false };
    } else if (actionType === 'APPROVE_TRANSACTION') {
      patch = { status: 'Approved', approvedBy: cur.tx.approvedBy || 'Store Manager', approvedAt: cur.tx.approvedAt || rowIso };
    } else if (actionType === 'DELETE_STAFF_TRANSACTION') {
      patch = { status: 'Deleted', deletedBy: cur.tx.deletedBy || 'Store Manager', deletedAt: cur.tx.deletedAt || rowIso };
    } else if (actionType === 'REJECT_TRANSACTION') {
      patch = { status: 'Rejected', rejectionReason: det.reason || cur.tx.rejectionReason || 'Rejected by Manager.', rejectedBy: 'Store Manager', rejectedAt: cur.tx.rejectedAt || rowIso };
    }
    // An action row only wins when it is newer than the last full snapshot (its own snapshot is written right after it).
    if (patch && rowTime > cur.ver) {
      state.set(ref, { ...cur, tx: { ...cur.tx, ...patch }, ver: rowTime });
    }
  });
  return state;
}

export async function fetchStaffTransactionsFromSupabase() {
  if (!supabase) return readLocalStaffList();

  // Pull deletions made on other devices/sessions so they are tombstoned here too
  try {
    const { data: delLogs } = await fetchWithTimeout(
      supabase
        .from('activity_audit_logs')
        .select('action, entity_id, details')
        .in('action', ['DELETE_MATERIAL_DISBURSEMENT', 'DELETE_STOCK_RECEIPT'])
        .limit(300),
      3000
    );
    if (Array.isArray(delLogs)) {
      delLogs.forEach(row => {
        let det = row.details;
        if (typeof det === 'string') { try { det = JSON.parse(det); } catch (_) { det = null; } }
        const ref = String((det && det.ref) || row.entity_id || '').trim();
        if (!ref) return;
        markDeleted(row.action === 'DELETE_STOCK_RECEIPT' ? 'receipt' : 'disbursement', ref);
      });
    }
  } catch (_) {}

  let data = null;
  try {
    const res = await fetchWithTimeout(
      supabase
        .from('activity_audit_logs')
        .select('*')
        .eq('entity_type', 'staff_transactions')
        .order('created_at', { ascending: false })
        .limit(1000),
      6000
    );
    if (res && !res.error && Array.isArray(res.data)) data = res.data;
  } catch (err) {
    console.warn('[ManagerSupabase] Staff transactions fetch notice:', err && err.message);
  }

  // Read this device's list only NOW, after the network calls. Reading it before the await (old code) and writing
  // the merge back afterwards erased anything the user submitted while the request was running - that was the
  // "I submitted it, it showed, then it disappeared" bug on the Receive / Disburse / My Activity pages.
  const localList = readLocalStaffList();
  if (!data || data.length === 0) return localList;

  try {
    const remote = buildRemoteStaffState(data);
    const txMap = new Map();
    localList.forEach(item => { if (item && item.ref) txMap.set(String(item.ref), item); });

    remote.forEach((r, ref) => {
      if (isRefDeletedAny(ref)) { txMap.delete(ref); return; }
      const local = txMap.get(ref);
      if (!local) { txMap.set(ref, r.tx); return; }
      if (r.ownerId && local.id && local.id !== r.ownerId) {
        // This device holds a different record under a number that belongs to someone else. Keep the owner's record
        // here; the device that created the duplicate renumbers its own copy (see rmims-transaction-engine.js).
        txMap.set(ref, r.tx);
        return;
      }
      // Newest version wins. A local change that has not reached the database yet is never thrown away.
      if (r.ver >= txVersion(local)) txMap.set(ref, { ...local, ...r.tx });
    });

    const merged = Array.from(txMap.values()).sort((a, b) => txVersion(b) - txVersion(a));
    setJsonIfChanged(STAFF_TX_KEY, merged);
    return merged;
  } catch (err) {
    console.warn('[ManagerSupabase] Staff transactions merge notice:', err && err.message);
    return localList;
  }
}

/**
 * Universal cross-module and cross-tab synchronization trigger
 */
export function broadcastManagerSync(detail = {}) {
  const now = String(Date.now());
  try {
    localStorage.setItem('rmims_inventory_updated', now);
    localStorage.setItem('rmims_manager_receipts_updated', now);
    localStorage.setItem('rmims_manager_disbursements_updated', now);
    localStorage.setItem('rmims_staff_transactions_updated', now);
    localStorage.setItem('rmims_staff_activity_updated', now);
    localStorage.setItem('rmims_sync_event', JSON.stringify({ time: Date.now(), ...detail }));

    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('rmims_inventory_updated', { detail }));
    window.dispatchEvent(new CustomEvent('rmims_staff_transactions_updated', { detail }));
    window.dispatchEvent(new CustomEvent('rmims_staff_activity_updated', { detail }));
    window.dispatchEvent(new CustomEvent('rmims_manager_receipts_updated', { detail }));
    window.dispatchEvent(new CustomEvent('rmims_manager_disbursements_updated', { detail }));
  } catch (e) {}

  try {
    if (typeof window !== 'undefined' && typeof window.broadcastRMIMSSync === 'function') {
      window.broadcastRMIMSSync(detail);
    }
  } catch (_) {}

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('rmims_user_sync');
      channel.postMessage({ type: 'SYNC_UPDATE', ...detail, timestamp: Date.now() });
      channel.close();
    }
  } catch (_) {}
}

/**
 * Fetch live raw materials from Supabase and reconcile into local authoritative cache
 * Guarantees zero zombie materials and no resurrection of deleted items.
 */
export async function fetchUnifiedInventoryFromSupabase() {
  try {
    healForecastingMaterialCodes();
  } catch (_) {}

  if (!supabase) return getSystemRawMaterials();

  // 0. AUTHORITATIVE: pull the live raw_materials rows (carries the manager's edited minimum stock, dates, stock).
  const remoteCodes = new Set();
  try {
    const { data: remoteRows, error: remoteErr } = await fetchWithTimeout(
      supabase.from('raw_materials').select('*').order('item_code'), 6000);
    if (remoteErr) {
      let why = 'Database refused the read: ' + (remoteErr.message || remoteErr.code || 'unknown error');
      if (/permission denied/i.test(String(remoteErr.message || ''))) {
        // "permission denied for table" = the database sees this browser as signed OUT (anonymous), or the setup SQL was not run.
        let hasSession = false;
        try { const { data: sd } = await supabase.auth.getSession(); hasSession = !!(sd && sd.session); } catch (_) {}
        why += hasSession
          ? ' \u2014 You are signed in, so run RMIMS_RBAC_MULTI_COMPANY_SETUP.sql in Supabase (table access is not granted yet).'
          : ' \u2014 Your database sign-in has expired. Log out, then log in again with your email and password.';
      }
      setSyncStatus('read_error', why);
    } else if (Array.isArray(remoteRows) && remoteRows.length === 0) {
      setSyncStatus('read_empty', 'The database returned 0 materials for your account. Your account has no company assigned yet, is not approved, or the RBAC SQL has not been run. Ask the administrator to assign your company.', 0);
    } else if (Array.isArray(remoteRows)) {
      setSyncStatus('ok', 'Synced with the database', remoteRows.length);
    }
    if (!remoteErr && Array.isArray(remoteRows)) {
      remoteRows.forEach(r => { if (r && r.item_code) remoteCodes.add(String(r.item_code).toUpperCase().trim()); });
      reconcileRemoteMaterials(remoteRows);
      healLocalNewerStock(remoteRows).catch(() => {});
      seedMissingMaterials(remoteRows).catch(() => {});
    }
  } catch (e) {
    console.warn('[ManagerSupabase] Live raw_materials pull notice:', e && e.message);
  }

  // Network first, THEN read the local caches. Reading them before this await and writing them back afterwards
  // overwrote any stock change made in the meantime (a receive / disburse "went back" a few seconds later).
  let auditRows = null;
  try {
    const res = await fetchWithTimeout(
      supabase
        .from('activity_audit_logs')
        .select('*')
        .eq('entity_type', 'raw_materials')
        .order('created_at', { ascending: true })
        .limit(300),
      4000
    );
    auditRows = res && res.data;
  } catch (_) {}

  try {
    const deletedRaw = localStorage.getItem('rmims_deleted_material_ids');
    const deletedArr = deletedRaw ? JSON.parse(deletedRaw) : [];
    const deletedSet = new Set(Array.isArray(deletedArr) ? deletedArr.map(d => String(d).trim().toLowerCase()) : []);

    let existingCustom = [];
    try { existingCustom = JSON.parse(localStorage.getItem('rmims_custom_raw_materials') || '[]'); } catch (_) {}
    let existingOverrides = {};
    try { existingOverrides = JSON.parse(localStorage.getItem('rmims_manager_material_overrides') || '{}'); } catch (_) {}

    const mergedMap = new Map();

    // 1. Always preserve local user-imported and user-added materials first
    if (Array.isArray(existingCustom)) {
      existingCustom.forEach(c => {
        if (!c || (!c.name && !c.raw_material_name)) return;
        const name = c.name || c.raw_material_name;
        const rawCode = String(c.item_code || c.id || '').toUpperCase().trim();
        const isSconesCode = rawCode.startsWith('NB-') || !rawCode.startsWith('RM-');
        const recognized = resolveForecastingMaterialByName(name, isSconesCode);
        const key = (recognized && recognized.code) ? recognized.code : rawCode;
        if (!key) return;
        const isCoreProtected = /^NB-0(0[1-9]|1[0-9])$/i.test(key) || /^RM-0(0[1-9]|[1-5][0-9])$/i.test(key);
        const isImportedOrManual = Boolean(c.is_imported || c.is_manual_override || Number(c.current_stock ?? 0) > 0);
        if (isCoreProtected || isImportedOrManual || !deletedSet.has(key.toLowerCase())) {
          mergedMap.set(key, {
            ...c,
            id: key,
            item_code: key,
            is_imported: true,
            is_manual_override: true
          });
        }
      });
    }

    if (existingOverrides && typeof existingOverrides === 'object') {
      Object.keys(existingOverrides).forEach(rawKey => {
        const ov = existingOverrides[rawKey];
        if (!ov || (!ov.name && !ov.raw_material_name)) return;
        const name = ov.name || ov.raw_material_name;
        const rawCode = String(ov.item_code || ov.id || rawKey || '').toUpperCase().trim();
        const isSconesCode = rawCode.startsWith('NB-') || !rawCode.startsWith('RM-');
        const recognized = resolveForecastingMaterialByName(name, isSconesCode);
        const key = (recognized && recognized.code) ? recognized.code : rawCode;
        if (!key) return;
        const isImportedOrManual = Boolean(ov.is_imported || ov.is_manual_override || Number(ov.current_stock ?? 0) > 0);
        if (isImportedOrManual || !deletedSet.has(key.toLowerCase())) {
          const prev = mergedMap.get(key) || {};
          mergedMap.set(key, {
            ...prev,
            ...ov,
            id: key,
            item_code: key,
            name: ov.name || ov.raw_material_name || prev.name,
            raw_material_name: ov.raw_material_name || ov.name || prev.raw_material_name,
            unit: ov.unit || ov.unit_of_measure || prev.unit || (recognized && recognized.unit) || 'g',
            unit_of_measure: ov.unit || ov.unit_of_measure || prev.unit_of_measure || (recognized && recognized.unit) || 'g',
            current_stock: Number(ov.current_stock ?? prev.current_stock ?? 0),
            currentStock: Number(ov.current_stock ?? prev.currentStock ?? 0),
            minimum_threshold: Number(ov.minimum_stock ?? ov.minimum_threshold ?? prev.minimum_threshold ?? 0),
            minimum_stock: Number(ov.minimum_stock ?? ov.minimum_threshold ?? prev.minimum_stock ?? 0),
            date_added: ov.date_added || ov.first_date || prev.date_added || '',
            first_date: ov.first_date || ov.date_added || prev.first_date || '',
            last_updated: ov.last_updated || ov.latest_date || prev.last_updated || '',
            latest_date: ov.latest_date || ov.last_updated || prev.latest_date || '',
            is_imported: true,
            is_manual_override: true
          });
        }
      });
    }

    // 2. Also check Supabase activity_audit_logs for UPSERT_RAW_MATERIAL / CREATE_RAW_MATERIAL so imported items sync across tabs/sessions
    //    (rows were fetched BEFORE the local caches were read, see above)
    try {
      if (Array.isArray(auditRows) && auditRows.length > 0) {
        auditRows.forEach(row => {
          if (!row) return;
          const act = String(row.action || row.action_type || '').toUpperCase();
          let det = row.details;
          if (typeof det === 'string') {
            try { det = JSON.parse(det); } catch (_) { det = null; }
          }
          if (act === 'DELETE_RAW_MATERIAL') {
            const delTarget = String((det && (det.target || det.id)) || row.entity_id || '').toUpperCase().trim();
            // If the database still has this material it was re-created afterwards: the old delete log is stale.
            if (delTarget && !remoteCodes.has(delTarget)) mergedMap.delete(delTarget);
            return;
          }
          if ((act === 'UPSERT_RAW_MATERIAL' || act === 'CREATE_RAW_MATERIAL') && det && det.name) {
            const rawCode = String(det.id || row.entity_id || '').toUpperCase().trim();
            const isSconesCode = rawCode.startsWith('NB-') || !rawCode.startsWith('RM-');
            const recognized = resolveForecastingMaterialByName(det.name, isSconesCode);
            const key = (recognized && recognized.code) ? recognized.code : rawCode;
            if (!key || deletedSet.has(key.toLowerCase()) || deletedSet.has(String(det.name).toLowerCase().trim())) return;
            if (remoteCodes.has(key)) return; // live database row is authoritative; never use a stale log snapshot

            const rowDateStr = det.firstDate || det.date_added || (row.created_at ? String(row.created_at).slice(0, 10) : '');
            const rowLatestStr = det.latestDate || det.last_updated || rowDateStr;
            const existing = mergedMap.get(key);
            if (!existing) {
              mergedMap.set(key, {
                id: key,
                item_code: key,
                name: det.name,
                raw_material_name: det.name,
                category: det.category || (recognized && recognized.category) || 'Baking Supplies',
                unit: det.unit || (recognized && recognized.unit) || 'g',
                unit_of_measure: det.unit || (recognized && recognized.unit) || 'g',
                current_stock: Number(det.stock ?? det.current_stock ?? 0),
                currentStock: Number(det.stock ?? det.current_stock ?? 0),
                minimum_threshold: Number(det.minStock ?? det.minimum_stock ?? 0),
                minimum_stock: Number(det.minStock ?? det.minimum_stock ?? 0),
                date_added: rowDateStr,
                first_date: rowDateStr,
                display_date: rowDateStr,
                last_updated: rowLatestStr,
                latest_date: rowLatestStr,
                created_at: row.created_at || new Date().toISOString(),
                is_imported: true,
                is_manual_override: true
              });
            }
          }
        });
      }
    } catch (_) {}

    if (mergedMap.size === 0) {
      try {
        const sysMats = getSystemRawMaterials();
        (sysMats || []).forEach(sm => {
          const k = String(sm.item_code || sm.id).toUpperCase().trim();
          if (k) mergedMap.set(k, { ...sm, id: k, item_code: k });
        });
      } catch (_) {}
    }

    const finalReconciled = Array.from(mergedMap.values());
    if (finalReconciled.length > 0) {
      localStorage.setItem('rmims_custom_raw_materials', JSON.stringify(finalReconciled));

      const mgrOverrides = {};
      finalReconciled.forEach(m => {
        const key = String(m.item_code || m.id || '').toUpperCase().trim();
        const prev = existingOverrides[key] || {};
        const firstDate = m.first_date || m.date_added || prev.date_added || prev.first_date || '';
        const latestDate = m.latest_date || m.last_updated || prev.last_updated || prev.latest_date || firstDate;
        mgrOverrides[key] = {
          ...prev,
          id: key,
          item_code: key,
          name: m.name,
          raw_material_name: m.raw_material_name || m.name,
          unit: m.unit || prev.unit,
          current_stock: Number(m.current_stock ?? 0),
          minimum_stock: Number(m.minimum_threshold ?? m.minimum_stock ?? 0),
          maximum_stock: prev.maximum_stock || (m.reorder_quantity ? m.reorder_quantity * 4 : 100),
          date_added: firstDate,
          first_date: firstDate,
          display_date: m.display_date || prev.display_date || firstDate || '',
          last_updated: latestDate,
          latest_date: latestDate,
          is_imported: true,
          is_manual_override: true
        };
      });
      localStorage.setItem('rmims_manager_material_overrides', JSON.stringify(mgrOverrides));
    }
  } catch (err) {
    console.warn('[ManagerSupabase] Live inventory sync notice:', err);
  }

  return getSystemRawMaterials();
}

/**
 * Save or update a raw material to Supabase and unify across all manager and staff modules.
 *
 * Only fields the caller actually provides are written. Previously every call silently reset "minimum stock"
 * to 10 (and dates to now) whenever a receive / disburse / approval touched a material.
 *
 * opts.skipStockPush = true -> do NOT write current_stock to the database. Used by receive / disburse /
 *   approve flows, where the stored procedure already moves the stock on the server (writing both is what
 *   duplicated inventory).
 * opts.silent = true -> no broadcast (used by background retries).
 */
export async function saveRawMaterialToSupabase(material, opts = {}) {
  if (!material) return { success: false, message: 'Invalid material' };

  const rawId = String(material.id || material.item_code || '').toUpperCase().trim();
  const name = (material.name || material.raw_material_name || '').trim();
  const isSconesCode = rawId.startsWith('NB-') || !rawId.startsWith('RM-');
  const recognized = resolveForecastingMaterialByName(name, isSconesCode);
  const id = (recognized && recognized.code) ? recognized.code : rawId;

  let existing = {};
  try {
    const wantedName = name.toLowerCase();
    existing = (getSystemRawMaterials() || []).find(m =>
      String(m.item_code || m.id || '').toUpperCase().trim() === id ||
      (wantedName && String(m.name || m.raw_material_name || '').trim().toLowerCase() === wantedName)
    ) || {};
  } catch (_) {}

  const providedStock = pickVal(material.current_stock, material.currentStock, material.stock);
  const providedMin = pickVal(material.minimum_threshold, material.minimum_stock, material.minimumStock);
  const providedReorder = pickVal(material.reorder_quantity);
  const providedLead = pickVal(material.lead_time_days);
  const providedFirst = pickVal(material.date_added, material.first_date);
  const providedLatest = pickVal(material.last_updated, material.latest_date);

  const unit = pickVal(material.unit, material.unit_of_measure, existing.unit_of_measure, existing.unit, recognized && recognized.unit) || 'kg';
  const stock = Number(hasVal(providedStock) ? providedStock : (existing.current_stock ?? 0));
  const minStock = Number(hasVal(providedMin) ? providedMin : (existing.minimum_threshold ?? existing.minimum_stock ?? 0));
  const reorderQty = Number(hasVal(providedReorder) ? providedReorder : (existing.reorder_quantity ?? ((minStock * 2) || 25)));
  const leadTime = Number(hasVal(providedLead) ? providedLead : (existing.lead_time_days ?? 3));
  const desc = pickVal(material.description, existing.description) || `Raw material ${name}`;
  const cat = pickVal(material.category, existing.category, recognized && recognized.category) || 'General Materials';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = dateStr + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const resolvedFirstDate = pickVal(providedFirst, existing.date_added, existing.first_date) || now.toISOString().slice(0, 10);
  const resolvedLatestDate = hasVal(providedLatest) ? providedLatest : timeStr;
  const isMovementPush = Boolean(opts.skipStockPush);

  // Un-pushed local edit: protect it from being overwritten by a sync until it is saved.
  if (id) markPendingPush(id, !isMovementPush && hasVal(providedStock));

  // 1. Authoritative local persistence
  saveCustomRawMaterial({
    id: id || `RM-${Date.now()}`,
    item_code: id,
    name,
    raw_material_name: name,
    specification_name: material.specification_name || existing.specification_name || name,
    category: cat,
    unit_of_measure: unit,
    unit,
    current_stock: stock,
    minimum_threshold: minStock,
    minimum_stock: minStock,
    reorder_quantity: reorderQty,
    lead_time_days: leadTime,
    description: desc,
    date_added: resolvedFirstDate,
    first_date: resolvedFirstDate,
    display_date: material.display_date || existing.display_date || resolvedFirstDate,
    last_updated: resolvedLatestDate,
    latest_date: resolvedLatestDate,
    created_at: material.created_at || existing.created_at || now.toISOString(),
    is_imported: Boolean(material.is_imported ?? true),
    is_manual_override: true
  });

  // 2. Synchronize manager material overrides
  try {
    const ovs = readJsonSafe(MAT_OVERRIDES_KEY, {});
    const prevOv = ovs[id] || {};
    const firstDateToKeep = pickVal(providedFirst, prevOv.date_added, resolvedFirstDate);
    ovs[id] = {
      ...prevOv,
      id, item_code: id, name, raw_material_name: name,
      specification_name: material.specification_name || prevOv.specification_name || name,
      category: cat, unit,
      current_stock: stock,
      minimum_stock: minStock,
      maximum_stock: material.maximum_stock || prevOv.maximum_stock || (minStock * 5) || 100,
      storage_location: material.storage_location || prevOv.storage_location || '',
      supplier: material.supplier || prevOv.supplier || 'General Supply Co.',
      description: desc,
      date_added: firstDateToKeep, first_date: firstDateToKeep,
      display_date: material.display_date || prevOv.display_date || firstDateToKeep,
      last_updated: resolvedLatestDate, latest_date: resolvedLatestDate,
      is_imported: true, is_manual_override: true,
      is_zero_explicit: stock === 0
    };
    // Movement-driven stock is applied server-side by the stored procedure: stamp it so the sync knows this
    // device's figure is "newer than the server" until the server confirms it.
    if (isMovementPush && hasVal(providedStock)) ovs[id].stock_local_ts = Date.now();
    setJsonIfChanged(MAT_OVERRIDES_KEY, ovs);
    mirrorToLegacyOverrides(id, ovs[id]);
  } catch (_) {}

  // 3. Supabase write (update-by-id, otherwise insert). Plain filters only; no ON CONFLICT dependence.
  let pushed = false;
  if (supabase) {
    try {
      const payload = { name, unit_of_measure: unit };
      if (id) payload.item_code = id;
      if (hasVal(providedStock) && !isMovementPush) payload.current_stock = stock;
      if (hasVal(providedMin)) payload.minimum_threshold = minStock;
      if (hasVal(providedReorder) && reorderQty > 0) payload.reorder_quantity = reorderQty;
      if (hasVal(providedLead)) payload.lead_time_days = leadTime;
      if (hasVal(material.description)) payload.description = desc;
      const fd = toIsoDateOnly(providedFirst);
      if (fd) { payload.date_added = fd; payload.first_date = fd; }
      const ld = hasVal(providedLatest) ? toIsoTimestamp(providedLatest) : null;
      if (ld) { payload.last_updated = ld; payload.latest_date = ld; }

      const found = await resolveRemoteMaterialRow({ id: material.db_id || existing.db_id, code: id, name });
      let error = null;
      if (found && found.id) {
        // .select() makes a row-level-security refusal visible: a blocked UPDATE succeeds with 0 rows and no error.
        const upd = await supabase.from('raw_materials').update(payload).eq('id', found.id).select('id');
        error = upd.error;
        if (!error && (!Array.isArray(upd.data) || upd.data.length === 0)) {
          error = { message: 'The database refused this change (0 rows updated). Your account is not allowed to edit this material: it must be an approved Store Manager assigned to the same company.' };
        }
      } else {
        // New row: always create it with this device's current figure. When that figure already includes a
        // movement being recorded, flag it so the ledger recorder does not apply the movement a second time.
        if (!('current_stock' in payload)) payload.current_stock = stock;
        ({ error } = await supabase.from('raw_materials').insert([payload]));
        if (!error && isMovementPush) markFreshStock(id);
      }

      if (error) {
        console.warn('[ManagerSupabase] raw_materials save notice (will retry on next sync):', error.message);
        setSyncStatus('write_denied', 'Saved on this device only, NOT shared with staff. ' + error.message);
      } else {
        setSyncStatus('ok', 'Synced with the database', syncStatus.rows);
        pushed = true;
        clearPendingPush(id);
        await logManagerActivityToSupabase({
          action: 'UPSERT_RAW_MATERIAL',
          entityType: 'raw_materials',
          entityId: id,
          details: { id, name, unit, stock, minStock, category: cat, firstDate: resolvedFirstDate, latestDate: resolvedLatestDate, is_imported: true }
        });
      }
    } catch (err) {
      console.warn('[ManagerSupabase] Error saving raw material to Supabase:', err);
    }
  } else {
    clearPendingPush(id);
  }

  // 4. Universal broadcast across all portals
  if (!opts.silent) broadcastManagerSync({ action: 'update_material', id, name, stock, unit });

  return { success: true, pushed };
}

/**
 * Permanently delete a raw material from Supabase and all local caches.
 * Ensures the material is never brought back.
 */
export async function deleteRawMaterialOnSupabase(idOrCodeOrName) {
  if (!idOrCodeOrName) return { success: false };
  const clean = String(idOrCodeOrName).trim();

  deleteSystemRawMaterial(clean);

  try {
    const ovs = readJsonSafe(MAT_OVERRIDES_KEY, null);
    if (ovs && typeof ovs === 'object') {
      delete ovs[clean]; delete ovs[clean.toUpperCase()]; delete ovs[clean.toLowerCase()];
      setJsonIfChanged(MAT_OVERRIDES_KEY, ovs);
    }
  } catch (_) {}
  clearPendingPush(clean.toUpperCase());

  if (supabase) {
    try {
      const row = await resolveRemoteMaterialRow({ id: clean, code: clean, name: clean });
      if (row && row.id) {
        await supabase.from('stock_receipts').delete().eq('material_id', row.id);
        await supabase.from('material_disbursements').delete().eq('material_id', row.id);
        await supabase.from('raw_materials').delete().eq('id', row.id);
      }
      await logManagerActivityToSupabase({ action: 'DELETE_RAW_MATERIAL', entityType: 'raw_materials', entityId: clean, details: { target: clean } });
    } catch (err) {
      console.warn('[ManagerSupabase] Error deleting material on Supabase:', err);
    }
  }

  broadcastManagerSync({ action: 'delete_material', id: clean });
  return { success: true };
}

/**
 * Fetch live stock receipts from Supabase and synchronize with local manager receipts
 */
export async function fetchLiveStockReceiptsFromSupabase() {
  if (!supabase) return readJsonSafe(MGR_RECEIPTS_KEY, []);

  try {
    const [rcv, mats, audit] = await Promise.all([
      fetchWithTimeout(supabase.from('stock_receipts').select('*').order('receipt_date', { ascending: false }), 5000),
      fetchWithTimeout(supabase.from('raw_materials').select('id, item_code, name, unit_of_measure'), 5000).catch(() => ({ data: [] })),
      fetchWithTimeout(fetchLedgerAuditRowsQuery(), 5000).catch(() => ({ data: [] }))
    ]);
    if (rcv && !rcv.error && Array.isArray(rcv.data)) {
      try { await loadRecorderDirectory(supabase); } catch (_) {}
      const matLookup = new Map();
      ((mats && mats.data) || []).forEach(m => { if (m && m.id) matLookup.set(m.id, m); });
      const remoteRec = mapRemoteReceipts(rcv.data, matLookup, (audit && audit.data) || []);
      mergeRemoteLedgerIntoLocal(MGR_RECEIPTS_KEY, 'receipt', remoteRec);
    }
  } catch (err) {
    console.warn('[ManagerSupabase] Live receipts fetch notice:', err);
  }

  return readJsonSafe(MGR_RECEIPTS_KEY, []);
}

/**
 * Delete a stock receipt from Supabase and local storage, reverting stock if applicable
 */
export async function deleteStockReceiptOnSupabase(refOrId) {
  if (!refOrId) return { success: false };
  const cleanRef = String(refOrId).trim();

  // Local removal + stock revert are done by deleteManagerReceipt() in rmims-transaction-engine.js.
  // This function ONLY cleans up the remote copy (never touches local records or stock).
  markDeleted('receipt', cleanRef);

  // 2. Delete on Supabase
  if (supabase) {
    try {
      if (cleanRef.length === 36) {
        await supabase.from('stock_receipts').delete().eq('id', cleanRef);
      }
      await supabase.from('stock_receipts').delete().ilike('supplier_name', `%[Ref: ${escapeLike(cleanRef)}]%`);
      // Rows saved without the tag (older versions): find them through the audit log and delete by id.
      const extraIds = await findRemoteLedgerIdsForRef('receipt', cleanRef);
      for (const id of extraIds) { await supabase.from('stock_receipts').delete().eq('id', id); markDeleted('receipt', id); }

      await logManagerActivityToSupabase({
        action: 'DELETE_STOCK_RECEIPT',
        entityType: 'stock_receipts',
        entityId: cleanRef,
        details: { ref: cleanRef }
      });
    } catch (err) {
      console.warn('[ManagerSupabase] Error deleting stock receipt on Supabase:', err);
    }
  }

  // 3. Broadcast sync
  invalidateForecastCache();
  broadcastManagerSync({
    action: 'delete_receipt',
    ref: cleanRef
  });

  return { success: true };
}

/**
 * Permanently deletes a material disbursement from Supabase and local storage
 */
export async function deleteMaterialDisbursementOnSupabase(refOrId) {
  if (!refOrId) return { success: false };
  const cleanRef = String(refOrId).trim();

  // Local removal + stock restore are done by deleteManagerDisbursement() in rmims-transaction-engine.js.
  // This function ONLY cleans up the remote copy (never touches local records or stock).
  markDeleted('disbursement', cleanRef);

  // 2. Delete on Supabase
  if (supabase) {
    try {
      if (cleanRef.length === 36) {
        await supabase.from('material_disbursements').delete().eq('id', cleanRef);
      }
      await supabase.from('material_disbursements').delete().ilike('activity_type', `%[Ref: ${escapeLike(cleanRef)}]%`);
      const extraIds = await findRemoteLedgerIdsForRef('disbursement', cleanRef);
      for (const id of extraIds) { await supabase.from('material_disbursements').delete().eq('id', id); markDeleted('disbursement', id); }

      await logManagerActivityToSupabase({
        action: 'DELETE_MATERIAL_DISBURSEMENT',
        entityType: 'material_disbursements',
        entityId: cleanRef,
        details: { ref: cleanRef }
      });
    } catch (err) {
      console.warn('[ManagerSupabase] Error deleting material disbursement on Supabase:', err);
    }
  }

  // 3. Broadcast sync
  invalidateForecastCache();
  broadcastManagerSync({
    action: 'delete_disbursement',
    ref: cleanRef
  });

  return { success: true };
}


/**
 * Permanently saves a Finished Product formulation to Supabase activity audit logs
 * so it is continuously preserved across sessions and never removed.
 */
export async function saveFinishedProductToSupabase(product) {
  if (!supabase || !product || !product.name) return { success: false };
  try {
    await logManagerActivityToSupabase({
      action: 'UPSERT_FINISHED_PRODUCT',
      entityType: 'finished_products',
      entityId: product.id || product.name,
      details: {
        id: product.id || ('fp-' + Date.now()),
        name: product.name,
        materialNames: product.materialNames || [],
        recipeDetails: product.recipeDetails || {},
        category: product.category || 'Bakery & Breads',
        batchUnits: product.batchUnits != null ? product.batchUnits : null,
        date_added: product.date_added || new Date().toISOString(),
        last_updated: new Date().toISOString()
      }
    });
    return { success: true };
  } catch (err) {
    console.warn('[ManagerSupabase] Error saving finished product formulation to Supabase:', err);
    return { success: false, error: err };
  }
}

/**
 * Reconciles finished products saved in Supabase activity audit logs into local storage.
 */
export async function fetchLiveFinishedProductsFromSupabase() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('activity_audit_logs')
      .select('details, created_at')
      .eq('action', 'UPSERT_FINISHED_PRODUCT')
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) return [];

    const storageKeys = [
      'rmims_custom_finished_products',
      'RMSME_CUSTOM_FINISHED_PRODUCTS',
      'rmims_finished_products',
      'rmims_finished_product_context'
    ];

    let currentList = [];
    try {
      const raw = localStorage.getItem('rmims_custom_finished_products');
      if (raw) currentList = JSON.parse(raw);
      if (!Array.isArray(currentList)) currentList = [];
    } catch (_) {}

    // Newest record per product name (rows arrive newest first)
    const remoteMap = new Map();
    data.forEach(row => {
      const det = row.details;
      if (det && det.name) {
        const norm = String(det.name).toLowerCase().trim();
        if (!remoteMap.has(norm)) remoteMap.set(norm, det);
      }
    });

    const nameMap = new Map();
    if (isManagerSession()) {
      // Manager: keep own products (including ones not saved yet) and add any the database has that are missing
      currentList.forEach(p => { if (p && p.name) nameMap.set(String(p.name).toLowerCase().trim(), p); });
      remoteMap.forEach((det, norm) => { if (!nameMap.has(norm)) nameMap.set(norm, det); });
    } else {
      // Staff never author formulations: the manager's latest version is the truth
      remoteMap.forEach((det, norm) => nameMap.set(norm, det));
    }

    const reconciled = Array.from(nameMap.values());
    const before = JSON.stringify(currentList);
    const json = JSON.stringify(reconciled);
    if (json !== before) {
      storageKeys.forEach(k => {
        try { localStorage.setItem(k, json); } catch (_) {}
      });
      try {
        window.dispatchEvent(new CustomEvent('rmims_finished_products_updated', { detail: reconciled }));
        window.dispatchEvent(new CustomEvent('rmims_live_data_updated', { detail: { source: 'live-sync', reason: 'finished-products' } }));
      } catch (_) {}
    }

    return reconciled;
  } catch (e) {
    console.warn('[ManagerSupabase] Error restoring finished products from Supabase:', e);
    return [];
  }
}

/**
 * Permanently purge all old test/mock data from Supabase tables
 */
export async function purgeAllLegacyMockDataFromSupabase() {
  // Purge routine retained as safe no-op
}

/**
 * Universal Global Realtime Supabase Channel
 * Listens to all mutations across raw_materials, stock_receipts, material_disbursements, activity_audit_logs
 * and automatically broadcasts across all browser tabs and role modules.
 */
if (supabase && typeof supabase.channel === 'function' && typeof window !== 'undefined' && !window.__rmimsGlobalSupabaseChannel) {
  try {
    window.__rmimsGlobalSupabaseChannel = supabase
      .channel('rmims_global_live_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_materials' }, (payload) => {
        if (payload.eventType === 'DELETE' && payload.old) {
          const oldTarget = payload.old.id || payload.old.item_code || payload.old.name;
          if (oldTarget) deleteSystemRawMaterial(oldTarget);
        }
        fetchUnifiedInventoryFromSupabase().then(() => {
          broadcastManagerSync({ source: 'supabase_raw_materials' });
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_receipts' }, (payload) => {
        if (payload.eventType === 'DELETE' && payload.old) {
          const oldId = String(payload.old.id || '').trim();
          let recs = JSON.parse(localStorage.getItem(MGR_RECEIPTS_KEY) || '[]');
          recs = recs.filter(r => r.ref !== oldId && r.id !== oldId);
          localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(recs));
        }
        fetchLiveStockReceiptsFromSupabase().then(() => {
          broadcastManagerSync({ source: 'supabase_stock_receipts' });
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_disbursements' }, (payload) => {
        if (payload.eventType === 'DELETE' && payload.old) {
          const oldId = String(payload.old.id || '').trim();
          let disbs = JSON.parse(localStorage.getItem(MGR_DISBURSEMENTS_KEY) || '[]');
          disbs = disbs.filter(d => d.ref !== oldId && d.id !== oldId);
          localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(disbs));
        }
        fetchManagerDashboardData().then(() => {
          broadcastManagerSync({ source: 'supabase_material_disbursements' });
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_audit_logs' }, () => {
        Promise.allSettled([
          fetchLiveFinishedProductsFromSupabase(),
          fetchStaffTransactionsFromSupabase()
        ]).then(() => {
          broadcastManagerSync({ source: 'supabase_audit_logs' });
        });
      })
      .subscribe();
  } catch (err) {
    console.warn('[ManagerSupabase] Global realtime subscription notice:', err);
  }
}


/* ==========================================================================
 * LIVE SYNC ENGINE - keeps every manager + staff page current
 *   1. Supabase Realtime (postgres_changes) on materials / receipts / disbursements / audit rows
 *   2. Polling safety net (15s when Realtime is not connected, 60s when it is)
 *   3. Instant refresh when the tab regains focus / becomes visible / comes back online
 * When a pull changes anything, the local events the pages already listen to are re-fired, so inventory tables,
 * KPIs and dashboards re-render with the manager's latest values.
 * ========================================================================== */
const LIVE_WATCH_KEYS = [STAFF_TX_KEY, MGR_RECEIPTS_KEY, MGR_DISBURSEMENTS_KEY, CUSTOM_MATS_KEY, MAT_OVERRIDES_KEY];
let liveSyncStarted = false;
let liveChannel = null;
let liveRealtimeOk = false;
let livePullRunning = false;
let livePullQueued = false;
let livePullTimer = null;
let liveLastPullAt = 0;

function liveSignature() {
  try {
    return LIVE_WATCH_KEYS.map(k => {
      const v = localStorage.getItem(k) || '';
      let h = 0;
      for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) | 0;
      return `${v.length}:${h}`;
    }).join('|');
  } catch (_) { return String(Date.now()); }
}

/** Re-send the existing local events (no localStorage writes => no cross-tab loops). */
function notifyLiveViews(detail = {}) {
  const d = { source: 'live-sync', ...detail };
  ['rmims_inventory_updated', 'rmims_manager_receipts_updated', 'rmims_manager_disbursements_updated',
   'rmims_staff_transactions_updated', 'rmims_staff_activity_updated', 'rmims_live_data_updated'
  ].forEach(name => { try { window.dispatchEvent(new CustomEvent(name, { detail: d })); } catch (_) {} });
}

async function retryPendingPushes() {
  if (!supabase || supabase.__offline) return;
  const pending = getPendingPushes();
  const codes = Object.keys(pending);
  if (!codes.length) return;
  const ovs = readJsonSafe(MAT_OVERRIDES_KEY, {});
  for (const code of codes) {
    const meta = pending[code] || {};
    const ov = ovs[code];
    if (!ov) { clearPendingPush(code); continue; }
    if (Date.now() - (meta.ts || 0) < 4000) continue; // original save may still be running
    const mat = {
      id: code, item_code: code, db_id: ov.db_id, name: ov.name, unit: ov.unit,
      minimum_threshold: ov.minimum_stock, date_added: ov.date_added, last_updated: ov.last_updated,
      description: ov.description, reorder_quantity: ov.reorder_quantity, lead_time_days: ov.lead_time_days
    };
    if (meta.withStock) mat.current_stock = ov.current_stock;
    try { await saveRawMaterialToSupabase(mat, { silent: true }); } catch (_) {}
  }
}

/** One full pull of everything manager and staff share. Never throws. */
/** Safety net: keep the last 3 snapshots of this device's ledgers/stock before any database pull may touch them. */
function snapshotLocalLedgers() {
  try {
    const keys = [MGR_RECEIPTS_KEY, MGR_DISBURSEMENTS_KEY, STAFF_TX_KEY, CUSTOM_MATS_KEY, MAT_OVERRIDES_KEY, 'rmims_custom_finished_products'];
    const snap = {};
    let any = false;
    keys.forEach(k => { const v = localStorage.getItem(k); if (v && v !== '[]' && v !== '{}') { snap[k] = v; any = true; } });
    if (!any) return;
    const sig = Object.values(snap).reduce((n, v) => n + v.length, 0);
    const idx = JSON.parse(localStorage.getItem('rmims_safety_snapshots_idx') || '[]');
    if (idx.length && idx[idx.length - 1].sig === sig) return;      // nothing changed since last snapshot
    const id = 'rmims_safety_snapshot_' + Date.now();
    localStorage.setItem(id, JSON.stringify(snap));
    idx.push({ id, sig, at: new Date().toISOString() });
    while (idx.length > 3) { const old = idx.shift(); localStorage.removeItem(old.id); }
    localStorage.setItem('rmims_safety_snapshots_idx', JSON.stringify(idx));
  } catch (_) { /* storage full: skip */ }
}

/** If this device lost its saved lists (empty) but an older safety snapshot still has them, put them back. Never overwrites data that exists. */
function restoreEmptyFromSnapshot() {
  try {
    const idx = JSON.parse(localStorage.getItem('rmims_safety_snapshots_idx') || '[]');
    for (let i = idx.length - 1; i >= 0; i--) {
      const snap = JSON.parse(localStorage.getItem(idx[i].id) || 'null');
      if (!snap) continue;
      Object.keys(snap).forEach(k => {
        const cur = localStorage.getItem(k);
        if (!cur || cur === '[]' || cur === '{}') localStorage.setItem(k, snap[k]);
      });
    }
  } catch (_) {}
}

export async function pullLiveData(reason = 'manual') {
  if (!supabase || supabase.__offline) return false;
  restoreEmptyFromSnapshot();
  snapshotLocalLedgers();
  if (livePullRunning) { livePullQueued = true; return false; }
  livePullRunning = true;
  const before = liveSignature();
  try {
    await retryPendingPushes();
    await Promise.allSettled([
      fetchUnifiedInventoryFromSupabase(),
      fetchManagerDashboardData(),
      fetchStaffTransactionsFromSupabase()
    ]);
  } catch (e) {
    console.warn('[LiveSync] pull notice:', e && e.message);
  } finally {
    livePullRunning = false;
    liveLastPullAt = Date.now();
  }
  const changed = liveSignature() !== before;
  if (changed) notifyLiveViews({ reason });
  if (livePullQueued) { livePullQueued = false; scheduleLivePull(500, 'queued'); }
  return changed;
}

function scheduleLivePull(delay = 400, reason = 'event') {
  clearTimeout(livePullTimer);
  livePullTimer = setTimeout(() => { pullLiveData(reason); }, delay);
}

export function startLiveSync() {
  if (liveSyncStarted || typeof window === 'undefined' || !supabase || supabase.__offline) return;
  liveSyncStarted = true;

  try {
    if (typeof supabase.channel === 'function') {
      liveChannel = supabase.channel('rmims-live-sync');
      ['raw_materials', 'stock_receipts', 'material_disbursements', 'activity_audit_logs'].forEach(table => {
        liveChannel.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduleLivePull(350, `realtime:${table}`));
      });
      liveChannel.subscribe((status) => {
        liveRealtimeOk = (status === 'SUBSCRIBED');
        if (liveRealtimeOk) scheduleLivePull(200, 'realtime-connected');
      });
    }
  } catch (e) {
    console.warn('[LiveSync] realtime unavailable, polling only:', e && e.message);
  }

  setInterval(() => {
    if (document.hidden) return;
    const every = liveRealtimeOk ? 12000 : 8000;   // realtime is instant; this safety poll covers a silently dropped event
    if (Date.now() - liveLastPullAt >= every - 500) pullLiveData('poll');
  }, 5000);

  window.addEventListener('focus', () => scheduleLivePull(150, 'focus'));
  window.addEventListener('online', () => scheduleLivePull(150, 'online'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleLivePull(150, 'visible'); });

  try {
    supabase.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED' || evt === 'INITIAL_SESSION') scheduleLivePull(300, `auth:${evt}`);
    });
  } catch (_) {}

  scheduleLivePull(100, 'startup');
}

/**
 * One-time clean-up: earlier versions turned every stock decrease in an imported file into a "disbursement"
 * (product "Imported Operational Usage"). Nobody entered those, so remove them from this device once.
 */
function purgeInferredDisbursementsOnce() {
  try {
    if (localStorage.getItem('rmims_purged_inferred_disb_v2')) return;
    const isInferred = d => d && (String(d.id || d.ref || '').startsWith('disb-import-') ||
      /imported operational usage/i.test(String(d.finished_product_name || d.finishedProductName || d.usedFor || d.recipient || '')));
    let removed = 0;
    [MGR_DISBURSEMENTS_KEY, 'rmims_custom_disbursements'].forEach(key => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      const kept = arr.filter(d => !isInferred(d));
      removed += arr.length - kept.length;
      if (kept.length !== arr.length) localStorage.setItem(key, JSON.stringify(kept));
    });
    localStorage.setItem('rmims_purged_inferred_disb_v2', String(Date.now()));
    if (removed) { console.info(`[LiveSync] removed ${removed} disbursement(s) that nobody entered.`); try { notifyLiveViews({ reason: 'purge-inferred' }); } catch (_) {} }
  } catch (_) {}
}
if (typeof window !== 'undefined') purgeInferredDisbursementsOnce();

// Auto-start on every manager / staff page that imports this service.
if (typeof window !== 'undefined' && /\/(manager|user)\//.test(window.location.pathname)) {
  const boot = () => { try { startLiveSync(); } catch (e) { console.warn('[LiveSync] start notice:', e && e.message); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
