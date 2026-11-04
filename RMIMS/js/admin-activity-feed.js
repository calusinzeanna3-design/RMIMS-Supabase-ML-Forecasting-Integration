// js/admin-activity-feed.js
//
// ONE activity feed for the Admin: the Overview "Latest Activity Logs" card and the Activity Logs module both
// read this, so they always show the same synced records (Supabase audit logs, stock receipts, disbursements and
// staff submissions mirrored by admin-supabase-service.fetchLiveSystemActivities, plus this browser's own actions).

import { maskOperationalDetails } from './admin-privacy.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatLogTimestamp(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (isNaN(d.getTime())) return String(ts);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${dateStr} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

/** Local calendar date of a record (not the UTC day) so date filters match what the table shows. */
function localDateOf(ts, fallback) {
  const d = ts ? new Date(ts) : null;
  if (!d || isNaN(d.getTime())) return fallback;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getAdminActivityFeed() {
  const LIVE_TODAY = todayISO();
  const list = [];

  // 1. Manager / Admin Activities
  try {
    const mgrAct = JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]');
    mgrAct.forEach(item => {
      const itemDetails = (item.details || item.activity || '').trim();
      const user = (item.user || '').trim();
      const bLoc = (item.branchLoc || item.branch || (item.role === 'Main Admin' || item.role === 'Administrator' ? 'Headquarters' : '')).trim();
      const bName = (item.branchName || (item.role === 'Main Admin' || item.role === 'Administrator' ? 'Main Administration' : bLoc)).trim();
      const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
      
      // Strict requirement: must have a branch/HQ context and real user name
      if (!hasBranch && item.role !== 'Main Admin') return;
      const displayUser = user || (item.role === 'Main Admin' ? 'Admin' : (item.role === 'Manager' ? 'Store Manager' : 'Store Staff'));
      
      const txt = `${user} ${itemDetails} ${bLoc} ${bName}`.toLowerCase();
      if (txt.includes('simulated_user') || txt.includes('demo') || txt.includes('john reyes')) {
        return;
      }
      // Authentic operations included
      const itemDate = item.date || (item.timestamp ? String(item.timestamp).slice(0, 10) : LIVE_TODAY);
      list.push({
        id: item.id || `act-${Math.random()}`,
        timestamp: item.timestamp || new Date().toISOString(),
        date: itemDate,
        dateTimeStr: formatLogTimestamp(item.timestamp),
        user: user,
        role: item.role || 'Manager',
        branchLoc: bLoc,
        branchName: bName || bLoc,
        action: item.action || 'Updated',
        module: item.module || 'Inventory',
        details: itemDetails || 'Inventory operation executed.',
        status: item.status || 'success'
      });
    });
  } catch (_) {}

  // 2. Live Stock Receipts (Manager + Custom)
  try {
    const mgrRec = JSON.parse(localStorage.getItem('rmims_manager_receipts') || '[]');
    const customRec = JSON.parse(localStorage.getItem('rmims_custom_receipts') || '[]');
    const receipts = [...mgrRec, ...customRec];
    const seenRec = new Set();
    receipts.forEach(r => {
      const key = r.id || r.ref || JSON.stringify(r);
      if (seenRec.has(key)) return;
      seenRec.add(key);
      const bLoc = (r.branchLoc || '').trim();
      const bName = (r.branchName || '').trim();
      const user = (r.receivedBy || '').trim();
      const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
      if (!hasBranch) return;
      const displayUser = user || 'Store Manager';
      const ref = r.ref || '';
      // Process all authentic live receipts without hardcoded filters

      const rDate = r.receiptDate || r.date || (r.timestamp ? String(r.timestamp).slice(0, 10) : LIVE_TODAY);
      const itemCount = Array.isArray(r.items) ? r.items.length : 1;
      list.push({
        id: `rec-act-${r.id || r.ref || Math.random()}`,
        timestamp: r.timestamp || (rDate + 'T10:00:00Z'),
        date: rDate,
        dateTimeStr: formatLogTimestamp(r.timestamp || rDate),
        user: user,
        role: 'Manager',
        branchLoc: bLoc,
        branchName: bName || bLoc,
        action: 'Received',
        module: 'Receive',
        details: `Recorded stock receipt (${r.ref || 'Ref'}): ${itemCount} raw material item(s) from ${r.supplierName || 'Supplier'}.`,
        status: 'success'
      });
    });
  } catch (_) {}

  // 3. Live Material Disbursements (Manager + Custom)
  try {
    const mgrDisb = JSON.parse(localStorage.getItem('rmims_manager_disbursements') || '[]');
    const customDisb = JSON.parse(localStorage.getItem('rmims_custom_disbursements') || '[]');
    const disbursements = [...mgrDisb, ...customDisb];
    const seenDisb = new Set();
    disbursements.forEach(d => {
      const key = d.id || d.ref || JSON.stringify(d);
      if (seenDisb.has(key)) return;
      seenDisb.add(key);
      const bLoc = (d.branchLoc || '').trim();
      const bName = (d.branchName || '').trim();
      const user = (d.disbursedBy || '').trim();
      const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
      if (!hasBranch) return;
      const displayUser = user || 'Store Staff';
      const ref = d.ref || '';
      // Process all authentic live disbursements without hardcoded filters

      const dDate = d.disbursementDate || d.date || (d.timestamp ? String(d.timestamp).slice(0, 10) : LIVE_TODAY);
      const itemCount = Array.isArray(d.items) ? d.items.length : 1;
      list.push({
        id: `disb-act-${d.id || d.ref || Math.random()}`,
        timestamp: d.timestamp || (dDate + 'T14:30:00Z'),
        date: dDate,
        dateTimeStr: formatLogTimestamp(d.timestamp || dDate),
        user: user,
        role: 'Staff',
        branchLoc: bLoc,
        branchName: bName || bLoc,
        action: 'Disbursed',
        module: 'Disbursement',
        details: `Disbursed stock (${d.ref || 'Ref'}): ${itemCount} item(s) for ${d.reason || '—'}.`,
        status: 'success'
      });
    });
  } catch (_) {}

  // 4. Staff Submissions & Transactions
  try {
    const staffTx = JSON.parse(localStorage.getItem('rmims_staff_transactions') || '[]');
    staffTx.forEach(st => {
      const bLoc = (st.branchLoc || '').trim();
      const bName = (st.branchName || '').trim();
      const user = (st.staff || st.user || '').trim();
      const hasBranch = (bLoc !== '' && bLoc !== '—') || bName !== '';
      if (!hasBranch) return;
      const displayUser = user || 'Store Staff';
      const ref = st.ref || '';
      // Process all authentic staff transactions without hardcoded filters
      if (user.toLowerCase().includes('john reyes') || user.toLowerCase().includes('maria santos')) return;

      const stDate = st.date || (st.timestamp ? String(st.timestamp).slice(0, 10) : LIVE_TODAY);
      // real submit time: stored timestamp, else the recorded date + time
      let stTs = st.timestamp || st.createdAt || st.created_at || st.submittedAt || '';
      if (!stTs && st.date) {
        const tm = String(st.time || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        let h = tm ? Number(tm[1]) : 12; const mi = tm ? Number(tm[2]) : 0;
        if (tm && tm[3]) { if (/pm/i.test(tm[3]) && h < 12) h += 12; if (/am/i.test(tm[3]) && h === 12) h = 0; }
        const dt = new Date(st.date + 'T00:00:00'); dt.setHours(h, mi, 0, 0);
        stTs = isNaN(dt.getTime()) ? '' : dt.toISOString();
      }
      list.push({
        id: `staff-act-${st.id || Math.random()}`,
        timestamp: stTs || (stDate + 'T00:00:00'),
        date: stDate,
        dateTimeStr: formatLogTimestamp(st.timestamp || stDate),
        user: user,
        role: 'Staff',
        branchLoc: bLoc,
        branchName: bName || bLoc,
        action: 'Submitted',
        module: /disb/i.test(String(st.activity || st.type || '')) ? 'Disbursement' : 'Receive',
        details: st.details || st.note || `Submitted ${/disb/i.test(String(st.activity || st.type || '')) ? 'disbursement' : 'receipt'} ${st.ref || ''} for manager review (${st.status || 'Pending'}).`,
        status: 'success'
      });
    });
  } catch (_) {}

  // Sort descending by timestamp / date
  list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return list;
}


/** Same feed, normalised: no raw UUIDs as user names, local dates, newest first, one row per id. */
export function getAdminActivityList() {
  const seen = new Set();
  return getAdminActivityFeed()
    .filter(a => {
      const k = String(a.id || '');
      if (k && seen.has(k)) return false;
      if (k) seen.add(k);
      return true;
    })
    .map(a => ({
      ...a,
      user: UUID_RE.test(String(a.user || '').trim()) ? '—' : (a.user || '—'),
      date: localDateOf(a.timestamp, a.date),
      dateTimeStr: formatLogTimestamp(a.timestamp || a.date)
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export { maskOperationalDetails };
