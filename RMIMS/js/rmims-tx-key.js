// js/rmims-tx-key.js
// ONE identity per real stock movement. The same receipt / disbursement can exist as
//   "2026SMSt-D0002" (manager ledger), "disb-2026SMSt-D0002" (local custom ledger),
//   "... [Ref: 2026SMSt-D0002]" (Supabase text tag) or referenceNo on the record.
// All of them map to the same key, so every page counts the movement exactly once.

const PREFIX = /^(rec|rcv|receipt|disb|dis-act|disb-act|rec-act|disbursement)[-_]/i;
const TAG = /\[Ref:\s*([^\]]+)\]/i;

export function canonicalTxRef(rec) {
  if (!rec) return '';
  const fromTag = (s) => { const m = String(s || '').match(TAG); return m ? m[1].trim() : ''; };
  let ref = rec.ref || rec.referenceNo || rec.reference_no || rec.reference
    || fromTag(rec.supplier_name) || fromTag(rec.activity_type) || fromTag(rec.supplierName) || fromTag(rec.activityType) || '';
  if (!ref) {
    const id = String(rec.id || '').trim();
    const stripped = id.replace(PREFIX, '');
    // only ids that look like system references count as references
    if (/^\d{4}SM[A-Za-z]*-[A-Za-z]?\d+$/i.test(stripped) || /^(REC|DIS)-\d/i.test(stripped)) ref = stripped;
  }
  return String(ref).replace(PREFIX, '').trim().toUpperCase();
}

/** Stable key: the reference when there is one, else the record id. */
export function txKey(rec) {
  const r = canonicalTxRef(rec);
  return r ? 'ref:' + r : 'id:' + String((rec && rec.id) || '');
}
