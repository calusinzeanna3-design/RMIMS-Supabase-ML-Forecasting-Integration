/**
 * One shared, real password change for admin / manager / staff.
 * 1. finds the signed-in account (Supabase session, falling back to the saved profile email)
 * 2. verifies the CURRENT password with Supabase
 * 3. sets the NEW password with Supabase and checks the result (errors are never swallowed)
 * Returns { ok, field: 'current'|'new'|'general', message }.
 */
import { supabase } from './supabase-config.js';

function savedEmail() {
  for (const k of ['currentUser', 'rmimsCurrentUser', 'userProfile', 'managerUser', 'staffUser', 'adminUser']) {
    try {
      const e = JSON.parse(localStorage.getItem(k) || 'null')?.email;
      if (e) return String(e).trim().toLowerCase();
    } catch (_) {}
  }
  return '';
}

function friendly(err) {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('same') || m.includes('different from the old')) return { field: 'new', message: 'New password must be different from your current password.' };
  if (m.includes('weak') || m.includes('at least') || m.includes('characters') || m.includes('pwned') || m.includes('easy to guess'))
    return { field: 'new', message: err.message || 'Please choose a stronger password.' };
  if (m.includes('rate') || m.includes('too many')) return { field: 'general', message: 'Too many attempts. Please wait a minute and try again.' };
  if (m.includes('fetch') || m.includes('network') || m.includes('failed to')) return { field: 'general', message: 'Cannot reach the server. Check your internet connection and try again.' };
  if (m.includes('session') || m.includes('jwt') || m.includes('not authenticated')) return { field: 'general', message: 'Your sign-in expired. Please log in again, then change your password.' };
  return { field: 'general', message: err?.message || 'Unable to change password right now.' };
}

export async function changeAccountPassword(currentPassword, newPassword) {
  try {
    const auth = supabase?.auth;
    if (!auth) return { ok: false, field: 'general', message: 'Authentication service is not available.' };

    let email = '';
    try { email = (await auth.getSession())?.data?.session?.user?.email || ''; } catch (_) {}
    email = (email || savedEmail()).trim().toLowerCase();
    if (!email) return { ok: false, field: 'general', message: 'Your sign-in expired. Please log in again, then change your password.' };

    const { error: verifyError } = await auth.signInWithPassword({ email, password: currentPassword });
    if (verifyError) {
      const m = String(verifyError.message || '').toLowerCase();
      if (m.includes('invalid') || m.includes('credential')) return { ok: false, field: 'current', message: 'Current password is incorrect.' };
      return { ok: false, ...friendly(verifyError) };
    }

    const { error: updateError } = await auth.updateUser({ password: newPassword });
    if (updateError) return { ok: false, ...friendly(updateError) };

    // never keep plaintext passwords anywhere locally
    try {
      const users = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
      users.forEach(u => { if (u && u.password !== undefined) delete u.password; });
      localStorage.setItem('rmims_registered_users', JSON.stringify(users));
    } catch (_) {}
    return { ok: true, message: 'Password updated successfully.' };
  } catch (e) {
    return { ok: false, ...friendly(e) };
  }
}
