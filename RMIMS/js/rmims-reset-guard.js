// js/rmims-reset-guard.js
//
// Factory reset that really empties every device.
// Supabase keeps one "reset_epoch" (public.system_state, file 10_FACTORY_RESET.sql). Every Admin / Manager / Staff
// page compares it with the last epoch this browser saw: when the database was reset (or freshly set up) after
// that, this browser deletes all of its saved RMIMS copies (records, materials, finished products, notifications,
// counters...) and reloads, so nothing old can come back from a browser. The sign-in session is kept.

import { supabase } from '../supabase/supabase-config.js';

const SEEN_KEY = 'rmims_reset_epoch_seen';
// kept: the signed-in session and who is signed in
const KEEP = /^(sb-|supabase\.|currentUser$|rmimsCurrentUser$|userProfile$|managerUser$|staffUser$|adminUser$|rmimsAdminUser$|rmims_session_active$|rmims_active_company_|rmims_active_dataset_folder$|rmims_reset_epoch_seen$)/;
const DATA = /^(rmims|rmsme|RMIMS|RMSME)/i;

/** Delete every RMIMS copy saved in this browser (the sign-in session stays). */
export function wipeLocalRmimsData() {
  let removed = 0;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    keys.forEach(k => { if (k && DATA.test(k) && !KEEP.test(k)) { localStorage.removeItem(k); removed++; } });
  } catch (_) {}
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
    keys.forEach(k => { if (k && DATA.test(k) && !/login|session/i.test(k)) sessionStorage.removeItem(k); });
  } catch (_) {}
  return removed;
}

function myCompanyId() {
  try {
    const u = JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || '{}') || {};
    return String(u.companyId || u.company_id || '');
  } catch (_) { return ''; }
}

let checking = false;
export async function checkSystemReset() {
  if (checking || !supabase || supabase.__offline) return false;
  checking = true;
  try {
    const { data, error } = await supabase.from('system_state').select('reset_epoch, reset_scope, company_id').eq('id', 1).maybeSingle();
    if (error || !data || !data.reset_epoch) return false;
    const epoch = Date.parse(data.reset_epoch) || 0;
    const seen = Date.parse(localStorage.getItem(SEEN_KEY) || '') || 0;
    if (epoch <= seen) return false;
    localStorage.setItem(SEEN_KEY, data.reset_epoch);   // set first: a reload never loops
    // a Manager's reset of one company does not touch the other company's devices
    if (data.company_id && myCompanyId() && data.company_id !== myCompanyId()) return false;
    const removed = wipeLocalRmimsData();
    localStorage.setItem(SEEN_KEY, data.reset_epoch);
    if (removed > 0) window.location.reload();   // old copies were on screen: show the clean state
    return true;
  } catch (_) {
    return false;
  } finally {
    checking = false;
  }
}

let started = false;
export function startResetGuard() {
  if (started || typeof window === 'undefined') return;
  started = true;
  checkSystemReset();
  try {
    if (supabase && typeof supabase.channel === 'function') {
      supabase.channel('rmims_system_state_reset')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'system_state' }, () => checkSystemReset())
        .subscribe();
    }
  } catch (_) {}
  window.addEventListener('focus', () => checkSystemReset());
  setInterval(() => { if (!document.hidden) checkSystemReset(); }, 30000);
}

startResetGuard();
