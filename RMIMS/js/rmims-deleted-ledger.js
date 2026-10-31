// js/rmims-deleted-ledger.js
// Single source of truth for PERMANENTLY DELETED receipts / disbursements.
//
// Why this exists:
//   Transactions live in several places at once (manager ledger, system custom ledger,
//   approved staff transactions, Supabase rows). Removing a record from just one of them
//   lets the others "resurrect" it on the next sync. Every delete now writes a tombstone
//   here, and every merge/sync path skips anything that is tombstoned.
//
// The localStorage keys are the same ones the dashboard / forecasting / reports / admin
// inventory modules already read, so they all honour manager deletions automatically.

export const DELETED_DISBURSEMENTS_KEY = "rmims_deleted_disbursement_ids";
export const DELETED_RECEIPTS_KEY = "rmims_deleted_receipt_ids";

const KEY_BY_KIND = {
    disbursement: DELETED_DISBURSEMENTS_KEY,
    receipt: DELETED_RECEIPTS_KEY
};

const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();

function readList(key) {
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
        return [];
    }
}

/** Lower-cased Set of deleted ids/refs for a kind ('disbursement' | 'receipt'). */
export function getDeletedSet(kind) {
    const key = KEY_BY_KIND[kind];
    if (!key) return new Set();
    return new Set(readList(key).map(norm).filter(Boolean));
}

/** Mark one or more ids / reference numbers as permanently deleted. */
export function markDeleted(kind, ...ids) {
    const key = KEY_BY_KIND[kind];
    if (!key) return;
    const list = readList(key);
    const have = new Set(list.map(norm));
    ids.flat().forEach((id) => {
        const clean = String(id == null ? "" : id).trim();
        if (clean && !have.has(norm(clean))) {
            list.push(clean); // keep original case: older readers compare case-sensitively
            have.add(norm(clean));
        }
    });
    try {
        localStorage.setItem(key, JSON.stringify(list));
    } catch (_) {}
}

/** True if ANY of the given ids / refs is tombstoned for that kind. */
export function isDeleted(kind, ...ids) {
    const set = getDeletedSet(kind);
    if (set.size === 0) return false;
    return ids.flat().some((id) => {
        const k = norm(id);
        return k && set.has(k);
    });
}

/** True if the reference was deleted as either a receipt or a disbursement. */
export function isRefDeletedAny(...ids) {
    return isDeleted("disbursement", ...ids) || isDeleted("receipt", ...ids);
}

/** Pulls the system reference out of text such as "Production Usage [Ref: 2026SMM-D0007]". */
export function extractRefFromText(text) {
    const m = String(text || "").match(/\[Ref:\s*([^\]\s]+)\s*\]/i);
    return m ? m[1].trim() : "";
}
