// js/rmims-tx-merge.js
// One place that decides "which copy of a staff transaction is the newest".
//
// Why this exists (the "I saved it, it showed, then it disappeared / went back" bug):
//   Several sync paths (database pull, other tabs, other devices over realtime) used to overwrite this device's
//   list with whatever copy they had, even an OLDER one. A record entered a second earlier could vanish, an approval
//   could flip back to Pending, and a deleted record could come back. Every merge now goes through here and the
//   newest version of each record always wins.

import { isRefDeletedAny } from './rmims-deleted-ledger.js';

const TIME_FIELDS = ['updatedAt', 'resubmittedAt', 'returnedAt', 'approvedAt', 'rejectedAt', 'deletedAt', 'createdAt', 'created_at'];

/** Latest moment this record was changed (ms since epoch, 0 if unknown). */
export function txVersion(t) {
  if (!t || typeof t !== 'object') return 0;
  let best = 0;
  for (const f of TIME_FIELDS) {
    const v = t[f];
    if (!v) continue;
    const ms = typeof v === 'number' ? v : Date.parse(v);
    if (Number.isFinite(ms) && ms > best) best = ms;
  }
  return best;
}

const refKey = (r) => String(r == null ? '' : r).trim().toLowerCase();

/**
 * Merge incoming copies into the local list. A record is replaced only when the incoming copy is at least as new.
 * Records unknown locally are added. Tombstoned (permanently deleted) references are never added back.
 * Returns { list, changed }.
 */
export function mergeStaffTransactionLists(localList, incomingList) {
  const list = Array.isArray(localList) ? localList.slice() : [];
  let changed = false;
  const index = new Map();
  list.forEach((t, i) => { if (t && t.ref) index.set(refKey(t.ref), i); });
  (Array.isArray(incomingList) ? incomingList : []).forEach(inc => {
    if (!inc || !inc.ref) return;
    const k = refKey(inc.ref);
    if (isRefDeletedAny(inc.ref)) return;
    const i = index.get(k);
    if (i === undefined) {
      index.set(k, list.length);
      list.push(inc);
      changed = true;
      return;
    }
    const cur = list[i];
    // Same reference but a different record (two devices issued the same number): keep ours; the owner check renumbers the loser.
    if (cur && cur.id && inc.id && cur.id !== inc.id) return;
    if (txVersion(inc) >= txVersion(cur)) {
      const next = { ...cur, ...inc };
      if (JSON.stringify(next) !== JSON.stringify(cur)) { list[i] = next; changed = true; }
    }
  });
  return { list, changed };
}
