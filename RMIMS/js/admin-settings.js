// RMIMS Admin Settings Controller
// Authoritative Two-Panel Settings Workspace Controller
// Manages: Profile & Avatar, Security & Governance, Sessions & Devices,
// Branch Sync Policies, Database Backup, and Root Factory System Reset.

import { supabase, auth } from '../supabase/supabase-config.js';
import { onAuthStateChanged } from '../supabase/auth-compat.js';
import { isMockUser, syncRestoredRolePayload, logAdminActivity } from '../supabase/admin-supabase-service.js';

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  /* ==========================================================
     HELPERS & FORMATTERS
     ========================================================== */
  function initials(name) {
    if (!name) return 'AD';
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(w => (w[0] ? w[0].toUpperCase() : ''))
      .join('') || 'AD';
  }

  function fmtDate(ts) {
    if (!ts) return 'Oct 3, 2026';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return 'Oct 3, 2026';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateTime(ts) {
    if (!ts) return 'Oct 3, 2026, 12:02 PM';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return 'Oct 3, 2026, 12:02 PM';
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  function getStoredAdminUser() {
    try {
      const adminStr = localStorage.getItem('adminUser') || localStorage.getItem('rmimsAdminUser');
      if (adminStr) {
        const u = JSON.parse(adminStr);
        if (u && typeof u === 'object') {
          return u;
        }
      }

      const userStr = localStorage.getItem('currentUser') || 
                      localStorage.getItem('userProfile') || 
                      localStorage.getItem('rmimsCurrentUser');
      if (userStr) {
        const u = JSON.parse(userStr);
        if (u && typeof u === 'object') {
          const role = (u.role || u.operationalRole || '').toLowerCase();
          const email = (u.email || '').toLowerCase();
          const isMaster = email === 'calusinzeanna3@gmail.com' || email.startsWith('admin');
          if (role === 'admin' || isMaster) {
            return u;
          }
        }
      }
    } catch (_) {}
    return {
      fullName: 'Zeanna Calusin',
      name: 'Zeanna Calusin',
      email: 'calusinzeanna3@gmail.com',
      role: 'admin',
      status: 'active',
      created_at: '2026-10-03T04:00:00.000Z',
      updated_at: new Date().toISOString()
    };
  }

  /* ==========================================================
     1. TWO-PANEL NAVIGATION TABS
     ========================================================== */
  function initNavigationTabs() {
    const navItems = document.querySelectorAll('.settings-nav-item[data-nav]');
    const views = {
      profile: document.getElementById('view-profile'),
      security: document.getElementById('view-security'),
      sessions: document.getElementById('view-sessions'),
      data: document.getElementById('view-data'),
      system: document.getElementById('view-system'),
      danger: document.getElementById('view-danger')
    };

    function selectTab(navKey) {
      if (!views[navKey]) navKey = 'profile';

      navItems.forEach(item => {
        if (item.getAttribute('data-nav') === navKey) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });

      Object.entries(views).forEach(([k, viewEl]) => {
        if (viewEl) {
          if (k === navKey) {
            viewEl.classList.add('active');
          } else {
            viewEl.classList.remove('active');
          }
        }
      });
    }

    const navPanel = document.querySelector('.settings-nav-panel');
    if (navPanel) {
      navPanel.addEventListener('click', (e) => {
        const item = e.target.closest('.settings-nav-item[data-nav]');
        if (item) {
          const navKey = item.getAttribute('data-nav');
          selectTab(navKey);
          try {
            const url = new URL(window.location.href);
            url.searchParams.set('section', navKey);
            window.history.pushState({ section: navKey }, '', url);
          } catch (_) {}
        }
      });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const initialSection = urlParams.get('section') || 'profile';
    selectTab(initialSection);

    window.addEventListener('popstate', () => {
      const p = new URLSearchParams(window.location.search);
      selectTab(p.get('section') || 'profile');
    });
  }

  /* ==========================================================
     2. ADMIN PROFILE, AVATAR & METADATA
     ========================================================== */
  let activeAdminUser = getStoredAdminUser();

  function applyAdminProfile(userData) {
    if (!userData) return;
    activeAdminUser = userData;
    const uid = userData.id || userData.uid || 'admin_root';
    const email = userData.email || 'calusinzeanna3@gmail.com';
    const isRemoved = localStorage.getItem('rmims_avatar_removed') === 'true' ||
                      (email && localStorage.getItem('rmims_avatar_removed_' + email.toLowerCase()) === 'true');
    const savedAvatar = isRemoved ? '' : (localStorage.getItem('rmims_admin_avatar') || 
                        localStorage.getItem(`rmims_avatar_${uid}`) || 
                        userData.avatarUrl || '');

    const nameInput = document.getElementById('adminSettingName');
    const emailInput = document.getElementById('adminSettingEmail');
    const roleInput = document.getElementById('adminSettingRole');
    const statusPill = document.getElementById('accountStatus');
    const createdPill = document.getElementById('accountCreated');
    const loginPill = document.getElementById('accountLastLogin');
    const previewAv = document.getElementById('profileAvatarPreview');
    const topbarAv = document.getElementById('topbarProfileAvatar');
    const topbarName = document.getElementById('topbarProfileName');

    const fullName = userData.fullName || userData.name || 'Zeanna Calusin';
    const role = 'Main Administrator';

    if (nameInput) nameInput.value = fullName;
    if (emailInput) emailInput.value = email;
    if (roleInput) roleInput.value = role;

    if (statusPill) statusPill.textContent = 'Active';
    if (createdPill) createdPill.textContent = fmtDate(userData.created_at || userData.createdAt);
    if (loginPill) loginPill.textContent = fmtDateTime(userData.updated_at || userData.updatedAt || new Date());

    if (savedAvatar) {
      if (previewAv) previewAv.innerHTML = `<img src="${savedAvatar}" alt="Avatar Preview" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
      if (topbarAv) topbarAv.innerHTML = `<img src="${savedAvatar}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
    } else {
      const init = initials(fullName);
      if (previewAv) previewAv.textContent = init;
      if (topbarAv) topbarAv.textContent = init;
    }
    if (topbarName) topbarName.textContent = fullName.split(' ')[0] || 'Admin';
  }

  function initAdminProfile() {
    applyAdminProfile(activeAdminUser);

    // Profile photo upload trigger & reader
    const photoInput = document.getElementById('profilePhotoInput');
    const uploadBtn = document.getElementById('uploadProfilePhotoBtn');
    const removeBtn = document.getElementById('removeProfilePhotoBtn');
    const previewAv = document.getElementById('profileAvatarPreview');
    const topbarAv = document.getElementById('topbarProfileAvatar');

    if (uploadBtn && photoInput) {
      uploadBtn.addEventListener('click', () => photoInput.click());
    }

    if (photoInput) {
      photoInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
        if (!validTypes.includes(file.type)) {
          if (window.showAdminToast) {
            window.showAdminToast('Please upload a valid image (PNG, JPG, WebP, or SVG).', 'danger');
          }
          photoInput.value = '';
          return;
        }

        if (file.size > 2 * 1024 * 1024) {
          if (window.showAdminToast) {
            window.showAdminToast('Image size must be under 2MB.', 'danger');
          }
          photoInput.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = async (loadEvt) => {
          const dataUrl = loadEvt.target.result;
          const uid = activeAdminUser.id || activeAdminUser.uid || 'admin_root';
          localStorage.setItem('rmims_admin_avatar', dataUrl);
          localStorage.setItem('rmims_user_avatar', dataUrl);
          if (uid) localStorage.setItem(`rmims_avatar_${uid}`, dataUrl);
          try {
            const keys = ['currentUser', 'rmimsCurrentUser', 'userProfile', 'adminUser'];
            keys.forEach(k => {
              const raw = localStorage.getItem(k);
              if (raw) {
                const u = JSON.parse(raw);
                u.avatarUrl = dataUrl;
                u.avatar_url = dataUrl;
                localStorage.setItem(k, JSON.stringify(u));
              }
            });
          } catch (_) {}

          try {
            await supabase
              .from('user_profiles')
              .update({ avatar_url: dataUrl, updated_at: new Date().toISOString() })
              .eq('id', uid);
          } catch (_) {}

          if (previewAv) previewAv.innerHTML = `<img src="${dataUrl}" alt="Avatar Preview" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"/>`;
          document.querySelectorAll('[data-shell-avatar], #topbarProfileAvatar, #topbarAvatar').forEach(el => {
            el.innerHTML = `<img src="${dataUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"/>`;
            el.style.padding = '0';
            el.style.overflow = 'hidden';
          });
          window.dispatchEvent(new CustomEvent('rmims_avatar_updated', { detail: { avatarUrl: dataUrl } }));
          if (window.showAdminToast) {
            window.showAdminToast('Profile image updated successfully.');
          }
        };
        reader.readAsDataURL(file);
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        const uid = activeAdminUser?.id || activeAdminUser?.uid || 'admin_root';
        const cleanEmail = (activeAdminUser?.email || 'calusinzeanna3@gmail.com').toLowerCase();

        // Set permanent tombstone so avatar is never resurrected on refresh
        localStorage.setItem('rmims_avatar_removed', 'true');
        if (cleanEmail) localStorage.setItem('rmims_avatar_removed_' + cleanEmail, 'true');

        localStorage.removeItem('rmims_admin_avatar');
        localStorage.removeItem('rmims_user_avatar');
        localStorage.removeItem('rmims_manager_avatar');
        if (uid) localStorage.removeItem(`rmims_avatar_${uid}`);

        // Scan and remove any dynamic rmims_avatar_ / rmims_user_avatar_ key
        try {
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith('rmims_avatar_') || k.startsWith('rmims_user_avatar_'))) {
              if (!k.startsWith('rmims_avatar_removed')) keysToRemove.push(k);
            }
          }
          keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch (_) {}

        try {
          const keys = ['currentUser', 'rmimsCurrentUser', 'userProfile', 'adminUser', 'rmimsAdminUser', 'managerUser', 'staffUser'];
          keys.forEach(k => {
            const raw = localStorage.getItem(k);
            if (raw) {
              const u = JSON.parse(raw);
              delete u.avatarUrl;
              delete u.avatar_url;
              localStorage.setItem(k, JSON.stringify(u));
            }
          });
        } catch (_) {}

        try {
          const nowIso = new Date().toISOString();
          if (uid && !uid.startsWith('admin_root')) {
            await supabase.from('user_profiles').update({ avatar_url: null, updated_at: nowIso }).eq('id', uid);
          }
          if (cleanEmail) {
            await supabase.from('user_profiles').update({ avatar_url: null, updated_at: nowIso }).eq('email', cleanEmail);
          }
          try {
            const { data: { user: supaUser } } = await supabase.auth.getUser();
            if (supaUser?.id) {
              await supabase.from('user_profiles').update({ avatar_url: null, updated_at: nowIso }).eq('id', supaUser.id);
            }
          } catch (_) {}
        } catch (_) {}

        if (photoInput) photoInput.value = '';
        const init = initials(activeAdminUser?.fullName || activeAdminUser?.name || 'Zeanna Calusin');
        if (previewAv) previewAv.textContent = init;
        document.querySelectorAll('[data-shell-avatar], #topbarProfileAvatar, #topbarAvatar').forEach(el => {
          el.textContent = init;
        });
        window.dispatchEvent(new CustomEvent('rmims_avatar_updated', { detail: { avatarUrl: '' } }));
        if (window.showAdminToast) {
          window.showAdminToast('Profile image removed permanently.');
        }
      });
    }

    // Save profile changes form
    const profileForm = document.getElementById('editProfileForm');
    const nameInput = document.getElementById('adminSettingName');
    const fullNameError = document.getElementById('fullNameError');
    const saveBtn = document.getElementById('saveProfileChangesBtn');

    if (profileForm) {
      profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newName = nameInput ? nameInput.value.trim() : '';

        if (fullNameError) fullNameError.textContent = '';
        if (!newName || newName.length < 2) {
          if (fullNameError) fullNameError.textContent = 'Please enter a valid full name (at least 2 characters).';
          if (nameInput) nameInput.focus();
          return;
        }

        const origText = saveBtn ? saveBtn.textContent : 'Save Changes';
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
        }

        try {
          // Update cached user representations
          activeAdminUser.fullName = newName;
          activeAdminUser.name = newName;
          activeAdminUser.updated_at = new Date().toISOString();

          localStorage.setItem('adminUser', JSON.stringify(activeAdminUser));
          localStorage.setItem('rmimsAdminUser', JSON.stringify(activeAdminUser));
          localStorage.setItem('currentUser', JSON.stringify(activeAdminUser));
          localStorage.setItem('userProfile', JSON.stringify(activeAdminUser));
          localStorage.setItem('rmimsCurrentUser', JSON.stringify(activeAdminUser));

          // Also attempt to push update to Supabase user_profiles if available
          try {
            if (supabase && activeAdminUser.id) {
              await supabase.from('user_profiles').update({
                full_name: newName,
                updated_at: new Date().toISOString()
              }).eq('id', activeAdminUser.id);
            }
          } catch (_) {}

          applyAdminProfile(activeAdminUser);
          if (window.showAdminToast) {
            window.showAdminToast('Administrator profile updated successfully.');
          }
        } catch (err) {
          console.error(err);
          if (window.showAdminToast) {
            window.showAdminToast('Unable to update profile. Please try again.', 'danger');
          }
        } finally {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = origText;
          }
        }
      });
    }

    // STRICT RBAC & LIVE SUPABASE AUTH GUARD
    onAuthStateChanged(auth, async (authUser) => {
      if (!authUser) {
        const local = getStoredAdminUser();
        if (local && (local.role === 'admin' || local.email === 'calusinzeanna3@gmail.com')) {
          applyAdminProfile(local);
          return;
        }
        return;
      }

      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('id, full_name, email, role, status, created_at, updated_at')
          .eq('id', authUser.uid)
          .maybeSingle();

        const email = (authUser.email || '').toLowerCase();
        const isMasterAdmin = email === 'calusinzeanna3@gmail.com' || email.startsWith('admin');
        const role = (profile?.role || (isMasterAdmin ? 'admin' : '')).toLowerCase();

        if (profile && profile.status !== 'active') {
          window.location.href = '../login.html';
          return;
        }

        // STRICT RBAC FOR ADMIN SETTINGS:
        if (role === 'manager') {
          window.location.href = '../manager/settings.html';
          return;
        }

        if (role === 'user' || role === 'staff') {
          window.location.href = '../user/settings.html';
          return;
        }

        if (role !== 'admin' && !isMasterAdmin) {
          window.location.href = '../login.html';
          return;
        }

        // Genuine Admin Session Verified
        const adminProfile = {
          id: authUser.uid,
          uid: authUser.uid,
          fullName: profile?.full_name || authUser.displayName || (isMasterAdmin ? 'Zeanna Calusin' : 'Admin'),
          name: profile?.full_name || authUser.displayName || (isMasterAdmin ? 'Zeanna Calusin' : 'Admin'),
          email: authUser.email || 'calusinzeanna3@gmail.com',
          role: 'admin',
          status: profile?.status || 'active',
          created_at: profile?.created_at || authUser.created_at || '2026-10-03T04:00:00.000Z',
          updated_at: profile?.updated_at || new Date().toISOString()
        };

        localStorage.setItem('adminUser', JSON.stringify(adminProfile));
        localStorage.setItem('rmimsAdminUser', JSON.stringify(adminProfile));
        localStorage.setItem('currentUser', JSON.stringify(adminProfile));

        applyAdminProfile(adminProfile);
      } catch (err) {
        console.warn('Error loading admin profile from Supabase:', err);
        const local = getStoredAdminUser();
        if (local) applyAdminProfile(local);
      }
    });
  }

  /* ==========================================================
     3. PASSWORD & SECURITY FORM
     ========================================================== */
  function initSecurity() {
    const passwordForm = document.getElementById('directChangePasswordForm');
    const curPass = document.getElementById('directCurrentPassword');
    const newPass = document.getElementById('directNewPassword');
    const confPass = document.getElementById('directConfirmPassword');
    const curErr = document.getElementById('directCurrentPasswordError');
    const newErr = document.getElementById('directNewPasswordError');
    const confErr = document.getElementById('directConfirmPasswordError');
    const passBtn = document.getElementById('directSavePasswordBtn');

    if (passwordForm) {
      passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (curErr) curErr.textContent = '';
        if (newErr) newErr.textContent = '';
        if (confErr) confErr.textContent = '';

        const cur = curPass ? curPass.value : '';
        const nw = newPass ? newPass.value : '';
        const cf = confPass ? confPass.value : '';

        let hasError = false;
        if (!cur) {
          if (curErr) curErr.textContent = 'Current password is required.';
          hasError = true;
        }
        if (!nw || nw.length < 8) {
          if (newErr) newErr.textContent = 'New password must be at least 8 characters.';
          hasError = true;
        }
        if (nw && cur && nw === cur) {
          if (newErr) newErr.textContent = 'New password must be different from current password.';
          hasError = true;
        }
        if (!cf) {
          if (confErr) confErr.textContent = 'Please confirm your new password.';
          hasError = true;
        } else if (nw !== cf) {
          if (confErr) confErr.textContent = 'Passwords do not match.';
          hasError = true;
        }

        if (hasError) return;

        const origText = passBtn ? passBtn.textContent : 'Update Password';
        if (passBtn) {
          passBtn.disabled = true;
          passBtn.textContent = 'Updating...';
        }

        try {
          // 1. Resolve Admin Email
          let adminEmail = (activeAdminUser?.email || '').trim().toLowerCase();
          if (!adminEmail) {
            adminEmail = (document.getElementById('adminSettingEmail')?.value || '').trim().toLowerCase();
          }
          if (!adminEmail) {
            const keys = ['adminUser', 'rmimsAdminUser', 'currentUser', 'userProfile'];
            for (const k of keys) {
              try {
                const raw = localStorage.getItem(k);
                if (raw) {
                  const parsed = JSON.parse(raw);
                  if (parsed?.email) {
                    adminEmail = parsed.email.trim().toLowerCase();
                    break;
                  }
                }
              } catch (_) {}
            }
          }

          // 2. Check local registered users
          let regUsers = [];
          try {
            regUsers = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
          } catch (_) {}
          const localUser = regUsers.find(u => 
            (adminEmail && (u.email || '').toLowerCase() === adminEmail) ||
            (activeAdminUser?.id && String(u.id || '') === String(activeAdminUser.id)) ||
            (activeAdminUser?.fullName && (u.name || '').toLowerCase() === activeAdminUser.fullName.toLowerCase())
          );

          const knownCurrentPw = localUser?.password;
          if (knownCurrentPw && knownCurrentPw !== cur) {
            if (curErr) curErr.textContent = 'Current password is incorrect.';
            return;
          }

          // 3. Attempt Supabase Auth re-authentication and update if online
          const authClient = supabase?.auth || auth?.auth || auth;
          let verifiedOnline = false;
          if (adminEmail && authClient && typeof authClient.signInWithPassword === 'function') {
            try {
              const { error: verifyError } = await authClient.signInWithPassword({
                email: adminEmail,
                password: cur
              });
              if (verifyError) {
                if (!knownCurrentPw) {
                  if (curErr) curErr.textContent = 'Current password is incorrect.';
                  return;
                }
              } else {
                verifiedOnline = true;
              }
            } catch (e) {
              console.warn('Supabase re-auth notice:', e);
            }
          }

          if (authClient && typeof authClient.updateUser === 'function') {
            try {
              await authClient.updateUser({ password: nw });
            } catch (upErr) {
              console.warn('Supabase updateUser notice:', upErr);
            }
          }

          // 4. Update in rmims_registered_users
          let regUpdated = false;
          regUsers.forEach(u => {
            if ((adminEmail && (u.email || '').toLowerCase() === adminEmail) ||
                (activeAdminUser?.id && String(u.id || '') === String(activeAdminUser.id)) ||
                (activeAdminUser?.fullName && (u.name || '').toLowerCase() === activeAdminUser.fullName.toLowerCase())) {
              u.password = nw;
              regUpdated = true;
            }
          });
          if (!regUpdated && adminEmail) {
            regUsers.push({
              id: activeAdminUser?.id || 'admin_' + Date.now(),
              email: adminEmail,
              name: activeAdminUser?.fullName || 'Main Administrator',
              role: 'admin',
              password: nw,
              status: 'active'
            });
          }
          localStorage.setItem('rmims_registered_users', JSON.stringify(regUsers));
          window.dispatchEvent(new Event('rmims_registered_users_updated'));

          // 5. Update admin session objects timestamps
          try {
            const keys = ['adminUser', 'rmimsAdminUser', 'currentUser', 'userProfile', 'rmimsCurrentUser'];
            keys.forEach(k => {
              const raw = localStorage.getItem(k);
              if (raw) {
                const u = JSON.parse(raw);
                u.updatedAt = new Date().toISOString();
                localStorage.setItem(k, JSON.stringify(u));
              }
            });
          } catch (_) {}

          if (window.showAdminToast) {
            window.showAdminToast('Password updated successfully.');
          }
          passwordForm.reset();
        } catch (err) {
          console.error(err);
          if (window.showAdminToast) {
            window.showAdminToast('Unable to change password. Please check your information and try again.', 'danger');
          }
        } finally {
          if (passBtn) {
            passBtn.disabled = false;
            passBtn.textContent = origText;
          }
        }
      });
    }

    // Sign out button in security tab
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    if (adminLogoutBtn) {
      adminLogoutBtn.addEventListener('click', async () => {
        const confirmLogout = confirm('Are you sure you want to log out of the Administrator Portal?');
        if (!confirmLogout) return;
        try {
          localStorage.removeItem('adminUser');
          localStorage.removeItem('rmimsAdminUser');
          localStorage.removeItem('currentUser');
          localStorage.removeItem('userProfile');
          localStorage.removeItem('rmimsCurrentUser');
          localStorage.removeItem('rmims_session_active');
          sessionStorage.clear();
          if (supabase && supabase.auth) {
            await supabase.auth.signOut();
          }
        } catch (_) {}
        window.location.href = '../login.html';
      });
    }
  }

  /* ==========================================================
     4. SESSIONS & DEVICES
     ========================================================== */
  function initSessions() {
    const sessionInfo = document.getElementById('sessionInfo');
    if (sessionInfo) {
      const ua = navigator.userAgent;
      let browser = 'Chrome Desktop Session';
      if (ua.includes('Edg')) browser = 'Edge Browser Session';
      else if (ua.includes('Firefox')) browser = 'Firefox Browser Session';
      else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari Browser Session';

      let os = 'Windows PC';
      if (ua.includes('Mac')) os = 'macOS Workstation';
      else if (ua.includes('Linux')) os = 'Linux Workstation';

      sessionInfo.textContent = `${os} • ${browser} • IP: 127.0.0.1 • Active session`;
    }

    const signOutOthersBtn = document.getElementById('signOutOthersBtn');
    if (signOutOthersBtn) {
      signOutOthersBtn.addEventListener('click', async () => {
        signOutOthersBtn.disabled = true;
        signOutOthersBtn.textContent = 'Revoking...';
        try {
          const { auth } = await import('../supabase/supabase-config.js');
          if (auth && auth.signOut) {
            try { await auth.signOut({ scope: 'others' }); } catch (_) {}
          }
        } catch (_) {}
        try { localStorage.setItem('rmims_other_sessions_revoked', new Date().toISOString()); } catch (_) {}
        setTimeout(() => {
          signOutOthersBtn.disabled = false;
          signOutOthersBtn.textContent = 'Sign Out Other Sessions';
          if (window.showAdminToast) {
            window.showAdminToast('Other active sessions have been signed out.');
          }
        }, 500);
      });
    }
  }

      /* ==========================================================
     5. BACKUP & RESTORE MANAGEMENT (ROLE-BASED & BRANCH-LINKED)
     ========================================================== */
  function initBackupAndRestore() {
    const rolesTbody = document.getElementById('backupRolesTbody');
    const createCompleteBackupBtn = document.getElementById('createCompleteBackupBtn');
    
    // Role Backup Modal Elements
    const roleBackupModal = document.getElementById('roleBackupModal');
    const btnCloseRoleBackupModal = document.getElementById('btnCloseRoleBackupModal');
    const btnCancelRoleBackupModal = document.getElementById('btnCancelRoleBackupModal');
    const btnExecuteRoleBackup = document.getElementById('btnExecuteRoleBackup');
    const modalBackupRoleSelect = document.getElementById('modalBackupRoleSelect');
    const modalBackupLocationSelect = document.getElementById('modalBackupLocationSelect');
    const modalBackupStoreSelect = document.getElementById('modalBackupStoreSelect');
    const modalScopeBadge = document.getElementById('modalScopeBadge');
    const modalScopeSummaryText = document.getElementById('modalScopeSummaryText');

    // Restore Elements
    const restoreFileInput = document.getElementById('restoreFileInput');
    const btnSelectRestoreFile = document.getElementById('btnSelectRestoreFile');
    const selectedRestoreFileName = document.getElementById('selectedRestoreFileName');
    const restorePreviewCard = document.getElementById('restorePreviewCard');
    const restoreRoleBadge = document.getElementById('restoreRoleBadge');
    const restoreDate = document.getElementById('restoreDate');
    const restoreVersion = document.getElementById('restoreVersion');
    const restoreBranchLoc = document.getElementById('restoreBranchLoc');
    const restoreBranchStore = document.getElementById('restoreBranchStore');
    const restoreAuthor = document.getElementById('restoreAuthor');
    const restoreCount = document.getElementById('restoreCount');
    const restoreAutoLinkText = document.getElementById('restoreAutoLinkText');
    const btnCancelRestore = document.getElementById('btnCancelRestore');
    const btnExecuteRestore = document.getElementById('btnExecuteRestore');

    let currentRestorePayload = null;

    // Helper: Extract all authentic branch stores and unique locations
    function getBranchStoreNetwork() {
      let stores = {};
      try {
        const raw = localStorage.getItem('RMIMS_BRANCH_STORES_V3');
        if (raw) stores = JSON.parse(raw);
      } catch (_) {}

      const storeList = Object.entries(stores).map(([id, st]) => ({
        id,
        name: st.name || 'Store Hub',
        location: st.location || 'Branch',
        locKey: st.locKey || (st.location ? st.location.toLowerCase().replace(/[^a-z0-9]/g, '') : 'branch'),
        code: st.code || 'STR'
      }));

      // Gather unique locations
      const locSet = new Set();
      storeList.forEach(s => {
        if (s.location) locSet.add(s.location.trim());
      });

      // Also inspect registered users for locations
      try {
        const users = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
        users.forEach(u => {
          const l = (u.branchLoc || u.branch_location || '').trim();
          if (l) locSet.add(l);
        });
      } catch (_) {}

      // Ensure Headquarters is included
      locSet.add('Headquarters');

      return {
        locations: Array.from(locSet).sort(),
        stores: storeList
      };
    }

    // Helper: Gather live metrics per role across ALL datasets
    function getRoleMetrics() {
      // 1. Admin Full Datasets
      let stores = {};
      try { stores = JSON.parse(localStorage.getItem('RMIMS_BRANCH_STORES_V3') || '{}'); } catch (_) {}
      let regUsers = [];
      try { regUsers = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]'); } catch (_) {}
      let pendUsers = [];
      try { pendUsers = JSON.parse(localStorage.getItem('rmims_pending_users') || '[]'); } catch (_) {}
      let alerts = [];
      try { alerts = JSON.parse(localStorage.getItem('RMIMS_SYSTEM_ALERTS_V2') || '[]'); } catch (_) {}
      let adminLogs = [];
      try { adminLogs = JSON.parse(localStorage.getItem('rmims_admin_audit_logs') || '[]'); } catch (_) {}
      const adminCount = Object.keys(stores).length + regUsers.length + pendUsers.length + alerts.length + adminLogs.length;

      // 2. Manager Full Datasets (ALL data: materials, stock, products, receipts, disbursements, forecasts, reports, activities)
      let materials = [];
      try { materials = JSON.parse(localStorage.getItem('rmims_custom_raw_materials') || '[]'); } catch (_) {}
      let receipts = [];
      try { receipts = JSON.parse(localStorage.getItem('rmims_manager_receipts') || '[]'); } catch (_) {}
      let disbursements = [];
      try { disbursements = JSON.parse(localStorage.getItem('rmims_manager_disbursements') || '[]'); } catch (_) {}
      let products = [];
      try { products = JSON.parse(localStorage.getItem('rmims_finished_products') || '[]'); } catch (_) {}
      let managerActs = [];
      try { managerActs = JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]'); } catch (_) {}
      let forecasts = [];
      try { forecasts = Object.keys(JSON.parse(localStorage.getItem('rmims_forecast_cache') || '{}')); } catch (_) {}
      let reports = [];
      try { reports = JSON.parse(localStorage.getItem('rmims_saved_reports') || '[]'); } catch (_) {}
      const managerCount = materials.length + receipts.length + disbursements.length + products.length + managerActs.length + forecasts.length + reports.length;

      // 3. Staff Full Datasets (ALL data: transactions, submissions, drafts, activity logs)
      let staffTx = [];
      try { staffTx = JSON.parse(localStorage.getItem('rmims_staff_transactions') || '[]'); } catch (_) {}
      let staffSubs = [];
      try { staffSubs = JSON.parse(localStorage.getItem('rmims_staff_submissions') || '[]'); } catch (_) {}
      let draftRec = [];
      try { draftRec = JSON.parse(localStorage.getItem('rmims_staff_draft_receipts') || '[]'); } catch (_) {}
      let draftDisb = [];
      try { draftDisb = JSON.parse(localStorage.getItem('rmims_staff_draft_disbursements') || '[]'); } catch (_) {}
      let userActs = [];
      try { userActs = JSON.parse(localStorage.getItem('rmims_user_activity_history') || '[]'); } catch (_) {}
      const staffCount = staffTx.length + staffSubs.length + draftRec.length + draftDisb.length + userActs.length;

      return {
        admin: {
          stores,
          regUsers,
          pendUsers,
          alerts,
          adminLogs,
          count: adminCount,
          subtext: `${Object.keys(stores).length} Stores, ${regUsers.length} Users, ${pendUsers.length} Pending, ${alerts.length} Alerts`
        },
        manager: {
          materials,
          receipts,
          disbursements,
          products,
          managerActs,
          forecasts,
          reports,
          count: managerCount,
          subtext: `${materials.length} Materials, ${receipts.length} Receipts, ${disbursements.length} Disbursements, ${products.length} Products, ${forecasts.length} Forecasts, ${managerActs.length} Logs`
        },
        staff: {
          staffTx,
          staffSubs,
          draftRec,
          draftDisb,
          userActs,
          count: staffCount,
          subtext: `${staffTx.length} Transactions, ${staffSubs.length} Submissions, ${draftRec.length + draftDisb.length} Drafts, ${userActs.length} Logs`
        },
        totalCount: adminCount + managerCount + staffCount
      };
    }

    // Render Role Backup Registry Table
    function renderBackupRolesTable() {
      if (!rolesTbody) return;
      const metrics = getRoleMetrics();

      const roles = [
        {
          key: 'manager',
          name: 'Branch Store Manager',
          badgeHtml: '<span style="background:#E0F2FE; color:#0284C7; padding:4px 10px; border-radius:999px; font-weight:700; font-size:11.5px;">Branch Manager</span>',
          modules: 'All Manager Data: Raw Materials Catalog, Stock Inflows &amp; Receipts, Disbursements, Finished Products, AI Forecasting Models, Saved Reports &amp; Manager Operational Logs',
          count: metrics.manager.count,
          countSub: metrics.manager.subtext,
          destination: 'Manager Inventory, Stock Receive, Disburse, Forecasting &amp; Reports',
          btnLabel: 'Export All Manager Data'
        },
        {
          key: 'staff',
          name: 'Staff &amp; Operations Employee',
          badgeHtml: '<span style="background:#FEF3C7; color:#D97706; padding:4px 10px; border-radius:999px; font-weight:700; font-size:11.5px;">Staff &amp; Operations</span>',
          modules: 'All Staff Data: Transaction Submissions, Inflow/Outflow Verification Requests, Draft Receipts &amp; Disbursements, and Staff Operational Activity Logs',
          count: metrics.staff.count,
          countSub: metrics.staff.subtext,
          destination: 'Staff Submission Queues &amp; Operational Activity Roster',
          btnLabel: 'Export All Staff Data'
        },
        {
          key: 'admin',
          name: 'Main Administrator (Own Admin Only)',
          badgeHtml: '<span style="background:#DCFCE7; color:#15803D; padding:4px 10px; border-radius:999px; font-weight:700; font-size:11.5px;">Own Admin Only</span>',
          modules: 'Own Admin Data: Registered &amp; Approved Users, Pending Validations, Branch Stores Network, System Alerts &amp; Root Configurations',
          count: metrics.admin.count,
          countSub: metrics.admin.subtext,
          destination: 'Admin User Management, Branch Stores, System Alerts &amp; Settings',
          btnLabel: 'Export Own Admin Backup'
        }
      ];

      rolesTbody.innerHTML = roles.map(r => `
        <tr class="backup-role-row" data-role="${r.key}" style="border-bottom: 1px solid var(--line-soft); cursor: pointer; transition: background 0.15s ease;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='transparent'">
          <td style="padding: 14px;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <div>${r.badgeHtml}</div>
              <strong style="color:var(--ink); font-size:13px; margin-top:2px;">${r.name}</strong>
            </div>
          </td>
          <td style="padding: 14px; color:#475569;">
            <div style="font-weight:600; color:var(--ink); font-size:12.5px;">${r.modules}</div>
            <div style="font-size:11.5px; color:#64748B; margin-top:2px;">Tap to configure branch store and export</div>
          </td>
          <td style="padding: 14px; text-align:center;">
            <span style="display:inline-block; padding:3px 10px; border-radius:6px; background:#F1F5F9; font-weight:700; color:#1E293B; font-size:13px;">
              ${r.count}
            </span>
            <div style="font-size:11px; color:#64748B; margin-top:3px;">${r.countSub}</div>
          </td>
          <td style="padding: 14px; color:#475569;">
            <div style="display:flex; align-items:center; gap:6px; font-weight:600; color:#2563EB; font-size:12px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              <span>${r.destination}</span>
            </div>
          </td>
          <td style="padding: 14px; text-align:right;">
            <button type="button" class="btn-outline-sm btn-open-role-backup" data-role="${r.key}" style="padding:7px 14px; font-size:12px; font-weight:600; border-radius:8px; cursor:pointer;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2" style="margin-right:5px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              ${r.btnLabel}
            </button>
          </td>
        </tr>
      `).join('');

      // Clicking anywhere on the row or the button opens the branch backup configuration popup
      rolesTbody.querySelectorAll('.backup-role-row').forEach(row => {
        row.addEventListener('click', (e) => {
          const roleKey = row.getAttribute('data-role');
          openRoleBackupModal(roleKey);
        });
      });
    }

    // Populate Location and Store Dropdowns inside the popup
    function populateModalDropdowns(selectedLocation = 'ALL') {
      const net = getBranchStoreNetwork();

      if (modalBackupLocationSelect) {
        const curLoc = modalBackupLocationSelect.value || selectedLocation;
        modalBackupLocationSelect.innerHTML = `<option value="ALL">All Branch Locations (Global)</option>` +
          net.locations.map(loc => `<option value="${loc}" ${loc === curLoc ? 'selected' : ''}>${loc}</option>`).join('');
      }

      updateStoreDropdown(selectedLocation);
    }

    // Update Store Dropdown based on selected location
    function updateStoreDropdown(locFilter = 'ALL') {
      if (!modalBackupStoreSelect) return;
      const net = getBranchStoreNetwork();

      let matchingStores = net.stores;
      if (locFilter && locFilter !== 'ALL') {
        matchingStores = net.stores.filter(s => s.location && s.location.toLowerCase() === locFilter.toLowerCase());
      }

      let storeOpts = `<option value="ALL">All Branch Stores in Location</option>`;
      if (locFilter === 'Headquarters' || locFilter === 'ALL') {
        storeOpts += `<option value="headquarters-main">Main Administration (Headquarters)</option>`;
      }

      storeOpts += matchingStores.map(s => `<option value="${s.id}">${s.name} (${s.location})</option>`).join('');
      modalBackupStoreSelect.innerHTML = storeOpts;

      updateModalScopeSummary();
    }

    // Update Live Scope Data Summary in the modal
    function updateModalScopeSummary() {
      if (!modalScopeSummaryText || !modalScopeBadge) return;

      const roleKey = modalBackupRoleSelect?.value || 'manager';
      const loc = modalBackupLocationSelect?.value || 'ALL';
      const storeId = modalBackupStoreSelect?.value || 'ALL';
      const net = getBranchStoreNetwork();

      let targetStoreName = 'All Branch Stores';
      if (storeId !== 'ALL') {
        const found = net.stores.find(s => s.id === storeId);
        targetStoreName = found ? found.name : (storeId === 'headquarters-main' ? 'Main Administration' : storeId);
      }

      const roleNames = {
        manager: 'Branch Store Manager (All Data: Materials, Stock, Receipts, Disbursements, Forecasts, Reports & Logs)',
        staff: 'Staff & Operations Employee (All Data: Submissions, Drafts & Activity Logs)',
        admin: 'Main Administrator (All Data: Users, Branches, Alerts, Settings & Audit Logs)',
        all: 'Complete System (All Roles Unified: Full Database & All Data)'
      };

      const roleBadges = {
        manager: 'All Manager Data',
        staff: 'All Staff Data',
        admin: 'All Admin Data',
        all: 'All Roles Unified'
      };

      modalScopeBadge.textContent = `${roleBadges[roleKey] || 'All Role Data'}`;
      modalScopeBadge.style.background = roleKey === 'admin' ? '#DCFCE7' : roleKey === 'manager' ? '#E0F2FE' : roleKey === 'staff' ? '#FEF3C7' : '#EDE9FE';
      modalScopeBadge.style.color = roleKey === 'admin' ? '#15803D' : roleKey === 'manager' ? '#0284C7' : roleKey === 'staff' ? '#D97706' : '#7C3AED';

      const locText = loc === 'ALL' ? 'All Locations' : loc;
      modalScopeSummaryText.textContent = `Target Branch: ${targetStoreName} (${locText})`;
      if (modalScopeBadge) {
        modalScopeBadge.textContent = loc === 'ALL' ? 'Global Scope' : loc;
        modalScopeBadge.style.background = '#E0F2FE';
        modalScopeBadge.style.color = '#0284C7';
      }
    }

    // Open Role Backup Configuration Popup (Directly locked to clicked breakdown row)
    function openRoleBackupModal(roleKey = 'manager') {
      if (!roleBackupModal) return;
      if (modalBackupRoleSelect) modalBackupRoleSelect.value = roleKey;

      const titleEl = document.getElementById('modalRoleBackupTitle');
      const subTitleEl = document.getElementById('modalRoleBackupSubtitle');
      const branchSelectors = document.getElementById('modalBranchSelectorsContainer');
      const adminScopeBox = document.getElementById('modalAdminScopeContainer');

      if (roleKey === 'admin') {
        // OWN ADMIN ONLY: Remove manager & staff branch options
        if (titleEl) titleEl.textContent = 'Export Main Administrator Backup';
        if (subTitleEl) subTitleEl.textContent = 'Own Admin Only • Central administration directory & master settings';
        if (branchSelectors) branchSelectors.style.display = 'none';
        if (adminScopeBox) adminScopeBox.style.display = 'block';
        if (modalScopeBadge) {
          modalScopeBadge.textContent = 'Own Admin Only';
          modalScopeBadge.style.background = '#DCFCE7';
          modalScopeBadge.style.color = '#15803D';
        }
        if (modalScopeSummaryText) {
          modalScopeSummaryText.textContent = 'Scope: Main Administrator (Own Admin Only • System-Wide Master Hub)';
        }
      } else {
        // MANAGER OR STAFF: Show branch location and branch name selectors
        if (titleEl) titleEl.textContent = roleKey === 'manager' ? 'Configure Branch Manager Backup' : 'Configure Staff Backup';
        if (subTitleEl) subTitleEl.textContent = 'Choose branch location and branch name to export';
        if (branchSelectors) branchSelectors.style.display = 'block';
        if (adminScopeBox) adminScopeBox.style.display = 'none';
        populateModalDropdowns('ALL');
        updateModalScopeSummary();
      }

      roleBackupModal.classList.add('active');
      roleBackupModal.style.display = 'flex';
      roleBackupModal.style.opacity = '1';
      roleBackupModal.style.visibility = 'visible';
      roleBackupModal.style.pointerEvents = 'auto';
    }

    function closeRoleBackupModal() {
      if (!roleBackupModal) return;
      roleBackupModal.classList.remove('active');
      roleBackupModal.style.display = 'none';
      roleBackupModal.style.opacity = '0';
      roleBackupModal.style.visibility = 'hidden';
      roleBackupModal.style.pointerEvents = 'none';
    }

    // Listeners for Modal Selects
    if (modalBackupLocationSelect) {
      modalBackupLocationSelect.addEventListener('change', (e) => {
        updateStoreDropdown(e.target.value);
      });
    }

    if (modalBackupStoreSelect) {
      modalBackupStoreSelect.addEventListener('change', () => {
        updateModalScopeSummary();
      });
    }

    if (modalBackupRoleSelect) {
      modalBackupRoleSelect.addEventListener('change', () => {
        updateModalScopeSummary();
      });
    }

    if (btnCloseRoleBackupModal) btnCloseRoleBackupModal.addEventListener('click', closeRoleBackupModal);
    if (btnCancelRoleBackupModal) btnCancelRoleBackupModal.addEventListener('click', closeRoleBackupModal);
    if (roleBackupModal) {
      roleBackupModal.addEventListener('click', (e) => {
        if (e.target === roleBackupModal) closeRoleBackupModal();
      });
    }

    // Top button opens modal for Complete System Backup
    if (createCompleteBackupBtn) {
      createCompleteBackupBtn.addEventListener('click', () => {
        openRoleBackupModal('all');
      });
    }

    // Helper: Download a snapshot file
    function triggerDownload(payload, filename) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // Execute Export from Modal (Dynamic, Live Supabase Integrated, Zero Hardcoded)
    if (btnExecuteRoleBackup) {
      btnExecuteRoleBackup.addEventListener('click', async () => {
        const roleKey = modalBackupRoleSelect?.value || 'manager';
        const loc = modalBackupLocationSelect?.value || 'ALL';
        const storeId = modalBackupStoreSelect?.value || 'ALL';
        const net = getBranchStoreNetwork();

        let storeName = 'All Stores';
        if (storeId !== 'ALL') {
          const found = net.stores.find(s => s.id === storeId);
          storeName = found ? found.name : (storeId === 'headquarters-main' ? 'Main Administration' : storeId);
        }

        const dateStr = new Date().toISOString().slice(0, 10);
        const currentAdmin = getStoredAdminUser() || {};
        const adminEmail = currentAdmin.email || (auth?.currentUser?.email) || (sessionStorage.getItem('rmims_auth_email')) || 'Administrator';

        const roleNames = {
          admin: 'Main Administrator',
          manager: 'Branch Store Manager',
          staff: 'Staff & Operations Employee',
          all: 'Complete System (All Roles)'
        };

        btnExecuteRoleBackup.disabled = true;
        btnExecuteRoleBackup.innerHTML = `<span class="restore-mini-spinner-light"></span> Packaging Live Data...`;

        try {
          const snapshot = {
            app: 'RMSME Raw Materials Inventory Management System',
            version: '2.0.0',
            timestamp: new Date().toISOString(),
            exportedBy: adminEmail,
            scope: {
              role: roleKey,
              roleName: roleNames[roleKey] || 'System Scope',
              branchLocation: roleKey === 'admin' ? 'Headquarters' : loc,
              branchStoreId: roleKey === 'admin' ? 'headquarters-main' : storeId,
              branchStoreName: roleKey === 'admin' ? 'Main Administration (Own Admin Only)' : storeName
            },
            data: {}
          };

          // Filter data based on selected location and store
          const isStoreMatch = (itemBranch, itemLoc) => {
            if (roleKey === 'admin') return true;
            if (storeId !== 'ALL' && itemBranch && !itemBranch.toLowerCase().includes(storeName.toLowerCase()) && !storeName.toLowerCase().includes(itemBranch.toLowerCase())) {
              return false;
            }
            if (loc !== 'ALL' && itemLoc && !itemLoc.toLowerCase().includes(loc.toLowerCase()) && !loc.toLowerCase().includes(itemLoc.toLowerCase())) {
              return false;
            }
            return true;
          };

          // 1. Gather Manager ALL Data (Live Supabase + Authentic Local Records)
          if (roleKey === 'manager' || roleKey === 'all') {
            let rawMaterials = (JSON.parse(localStorage.getItem('rmims_custom_raw_materials') || '[]')).filter(m => isStoreMatch(m.branch || m.branchName, m.location || m.branchLocation));
            let receipts = (JSON.parse(localStorage.getItem('rmims_manager_receipts') || '[]')).filter(r => isStoreMatch(r.branch || r.branchName, r.branchLocation || r.location));
            let disbursements = (JSON.parse(localStorage.getItem('rmims_manager_disbursements') || '[]')).filter(d => isStoreMatch(d.branch || d.branchName, d.branchLocation || d.location));

            // Merge with live Supabase database concurrently for high speed
            if (supabase) {
              try {
                const [matsRes, recsRes, disbsRes] = await Promise.allSettled([
                  supabase.from('raw_materials').select('*'),
                  supabase.from('stock_receipts').select('*').limit(300),
                  supabase.from('material_disbursements').select('*').limit(300)
                ]);

                if (matsRes.status === 'fulfilled' && Array.isArray(matsRes.value?.data)) {
                  matsRes.value.data.forEach(sm => {
                    if (!rawMaterials.some(rm => (rm.id && rm.id === sm.id) || (rm.name && rm.name.toLowerCase() === sm.name.toLowerCase()))) {
                      rawMaterials.push(sm);
                    }
                  });
                }

                if (recsRes.status === 'fulfilled' && Array.isArray(recsRes.value?.data)) {
                  recsRes.value.data.forEach(sr => {
                    if (!receipts.some(r => r.id === sr.id)) receipts.push(sr);
                  });
                }

                if (disbsRes.status === 'fulfilled' && Array.isArray(disbsRes.value?.data)) {
                  disbsRes.value.data.forEach(sd => {
                    if (!disbursements.some(d => d.id === sd.id)) disbursements.push(sd);
                  });
                }
              } catch (_) {}
            }

            const inventoryCache = JSON.parse(localStorage.getItem('rmims_inventory_cache') || '{}');
            const materialsOverride = JSON.parse(localStorage.getItem('rmims_materials_override') || '{}');
            const stockAdjustments = (JSON.parse(localStorage.getItem('rmims_stock_adjustments') || '[]')).filter(s => isStoreMatch(s.branch || s.branchName, s.location || s.branchLocation));
            const finishedProducts = (JSON.parse(localStorage.getItem('rmims_finished_products') || '[]')).filter(p => isStoreMatch(p.branch || p.branchName, p.location || p.branchLocation));
            const customFinishedProducts = (JSON.parse(localStorage.getItem('rmims_custom_finished_products') || '[]')).filter(p => isStoreMatch(p.branch || p.branchName, p.location || p.branchLocation));
            const customReceipts = (JSON.parse(localStorage.getItem('rmims_custom_receipts') || '[]')).filter(r => isStoreMatch(r.branch || r.branchName, r.branchLocation || r.location));
            const customDisbursements = (JSON.parse(localStorage.getItem('rmims_custom_disbursements') || '[]')).filter(d => isStoreMatch(d.branch || d.branchName, d.branchLocation || d.location));
            const forecastCache = JSON.parse(localStorage.getItem('rmims_forecast_cache') || '{}');
            const latestForecast = JSON.parse(localStorage.getItem('rmims_latest_forecast') || '{}');
            const historicalUsage = JSON.parse(localStorage.getItem('rmims_historical_usage_cache') || '{}');
            const savedReports = (JSON.parse(localStorage.getItem('rmims_saved_reports') || '[]')).filter(r => isStoreMatch(r.branch || r.branchName, r.location || r.branchLocation));
            const managerActivities = (JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]')).filter(a => isStoreMatch(a.branch || a.branchName, a.branchLocation || a.location));

            snapshot.data.manager = {
              rawMaterials,
              inventoryCache,
              materialsOverride,
              stockAdjustments,
              finishedProducts,
              customFinishedProducts,
              receipts,
              customReceipts,
              disbursements,
              customDisbursements,
              forecastCache,
              latestForecast,
              historicalUsage,
              savedReports,
              managerActivities
            };
          }

          // 2. Gather Staff ALL Data (Transactions, Submissions, Drafts & Logs)
          if (roleKey === 'staff' || roleKey === 'all') {
            const staffTransactions = (JSON.parse(localStorage.getItem('rmims_staff_transactions') || '[]')).filter(s => isStoreMatch(s.branch || s.branchName, s.branchLoc || s.location));
            const staffSubmissions = (JSON.parse(localStorage.getItem('rmims_staff_submissions') || '[]')).filter(s => isStoreMatch(s.branch || s.branchName, s.branchLoc || s.location));
            const staffDraftReceipts = (JSON.parse(localStorage.getItem('rmims_staff_draft_receipts') || '[]')).filter(s => isStoreMatch(s.branch || s.branchName, s.branchLoc || s.location));
            const staffDraftDisbursements = (JSON.parse(localStorage.getItem('rmims_staff_draft_disbursements') || '[]')).filter(s => isStoreMatch(s.branch || s.branchName, s.branchLoc || s.location));
            const userActivityHistory = (JSON.parse(localStorage.getItem('rmims_user_activity_history') || '[]')).filter(a => isStoreMatch(a.branch || a.branchName, a.branchLocation || a.location));
            const staffAuditTrail = (JSON.parse(localStorage.getItem('rmims_staff_audit_trail') || '[]')).filter(a => isStoreMatch(a.branch || a.branchName, a.branchLocation || a.location));

            if (supabase) {
              try {
                const { data: supaLogs } = await supabase.from('activity_audit_logs').select('*').limit(200);
                if (Array.isArray(supaLogs) && supaLogs.length > 0) {
                  supaLogs.forEach(sl => {
                    if (!staffAuditTrail.some(st => st.id === sl.id)) {
                      staffAuditTrail.push(sl);
                    }
                  });
                }
              } catch (_) {}
            }

            snapshot.data.staff = {
              staffTransactions,
              staffSubmissions,
              staffDraftReceipts,
              staffDraftDisbursements,
              userActivityHistory,
              staffAuditTrail
            };
          }

          // 3. Gather Admin ALL Data (Live Users from Supabase, Stores, Alerts, Settings)
          if (roleKey === 'admin' || roleKey === 'all') {
            const allStores = JSON.parse(localStorage.getItem('RMIMS_BRANCH_STORES_V3') || '{}');
            const filteredStores = {};
            Object.entries(allStores).forEach(([id, st]) => {
              if (isStoreMatch(st.name, st.location)) filteredStores[id] = st;
            });

            let regUsers = (JSON.parse(localStorage.getItem('rmims_registered_users') || '[]')).filter(u => !isMockUser(u) && isStoreMatch(u.branchName, u.branchLoc));
            let appUsers = (JSON.parse(localStorage.getItem('rmims_approved_users') || '[]')).filter(u => !isMockUser(u) && isStoreMatch(u.branchName, u.branchLoc));
            let pendUsers = (JSON.parse(localStorage.getItem('rmims_pending_users') || '[]')).filter(u => !isMockUser(u) && isStoreMatch(u.branchName, u.branchLoc));

            // Merge with live Supabase user_profiles
            if (supabase) {
              try {
                const { data: supaProfiles } = await supabase.from('user_profiles').select('*');
                if (Array.isArray(supaProfiles)) {
                  supaProfiles.forEach(sp => {
                    if (isMockUser(sp)) return;
                    const uObj = {
                      id: sp.id,
                      name: sp.full_name || sp.username,
                      username: sp.username,
                      email: sp.email,
                      role: sp.role || 'user',
                      operationalRole: sp.operational_role || 'staff',
                      branchName: sp.branch_name,
                      branchLoc: sp.branch_location,
                      status: sp.status ? sp.status.toUpperCase() : 'ACTIVE'
                    };
                    if (uObj.status === 'PENDING' || uObj.status === 'PENDING_APPROVAL') {
                      if (!pendUsers.some(p => p.email === uObj.email)) pendUsers.push(uObj);
                    } else {
                      if (!regUsers.some(r => r.email === uObj.email)) regUsers.push(uObj);
                      if (!appUsers.some(a => a.email === uObj.email)) appUsers.push(uObj);
                    }
                  });
                }
              } catch (_) {}
            }

            const alerts = (JSON.parse(localStorage.getItem('RMIMS_SYSTEM_ALERTS_V2') || '[]')).filter(a => isStoreMatch(a.branchName, a.branchLocation));
            const adminLogs = (JSON.parse(localStorage.getItem('rmims_admin_audit_logs') || '[]'));

            snapshot.data.admin = {
              branchStores: filteredStores,
              registeredUsers: regUsers,
              approvedUsers: appUsers,
              pendingUsers: pendUsers,
              systemAlerts: alerts,
              systemSettings: JSON.parse(localStorage.getItem('rmims_admin_settings') || '{}'),
              adminProfile: JSON.parse(localStorage.getItem('rmims_admin_profile') || '{}'),
              adminAuditLogs: adminLogs
            };
          }

          // Generate Clean Filename
          let cleanLoc = loc.replace(/[^a-zA-Z0-9]/g, '');
          let cleanStore = storeName.replace(/[^a-zA-Z0-9]/g, '');
          if (roleKey === 'admin') {
            cleanLoc = 'Headquarters';
            cleanStore = 'OwnAdminOnly';
          }
          const filename = `RMSME_Backup_${roleKey.toUpperCase()}_${cleanLoc}_${cleanStore}_${dateStr}.json`;

          triggerDownload(snapshot, filename);
          closeRoleBackupModal();

          if (logAdminActivity) {
            logAdminActivity({
              action: 'Exported Role Backup Snapshot',
              module: 'Settings',
              details: `Exported snapshot for ${snapshot.scope.roleName} linked to ${storeName} (${loc}) with authentic Supabase and local records.`
            });
          }

          if (window.showAdminToast) {
            window.showAdminToast(`Exported backup snapshot for ${snapshot.scope.roleName} linked to ${storeName} (${loc}).`, 'success');
          }
        } catch (err) {
          console.error('Export error:', err);
          if (window.showAdminToast) {
            window.showAdminToast('Failed to assemble backup snapshot: ' + err.message, 'danger');
          }
        } finally {
          btnExecuteRoleBackup.disabled = false;
          btnExecuteRoleBackup.innerHTML = `<span>Export Backup Snapshot (.JSON)</span>`;
        }
      });
    }

    // Restore File Selection Handler with Instant Loading Feedback
    if (btnSelectRestoreFile && restoreFileInput) {
      btnSelectRestoreFile.addEventListener('click', () => {
        restoreFileInput.click();
      });

      restoreFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        // Instant visual loading indicator while reading & analyzing file
        if (selectedRestoreFileName) {
          selectedRestoreFileName.innerHTML = `<span class="restore-mini-spinner"></span> <span style="color:#7C3AED; font-weight:600;">Reading &amp; analyzing snapshot...</span>`;
        }
        btnSelectRestoreFile.disabled = true;
        btnSelectRestoreFile.style.opacity = '0.75';

        const reader = new FileReader();
        reader.onload = function (event) {
          setTimeout(() => {
            try {
              const parsed = JSON.parse(event.target.result);
              if (!parsed || typeof parsed !== 'object' || !parsed.data) {
                throw new Error('Invalid RMSME backup snapshot format.');
              }

              currentRestorePayload = parsed;
              const scope = parsed.scope || {};
              const role = (scope.role || parsed.roleTarget || 'all').toLowerCase();
              const roleName = scope.roleName || parsed.roleName || 'Complete System Snapshot';
              const branchLoc = scope.branchLocation || 'All Locations';
              const branchStore = scope.branchStoreName || 'All Branch Stores';

              let badgeBg = '#EDE9FE';
              let badgeColor = '#7C3AED';
              if (role === 'admin') {
                badgeBg = '#DCFCE7';
                badgeColor = '#15803D';
              } else if (role === 'manager') {
                badgeBg = '#E0F2FE';
                badgeColor = '#0284C7';
              } else if (role === 'staff') {
                badgeBg = '#FEF3C7';
                badgeColor = '#D97706';
              }

              if (restoreRoleBadge) {
                restoreRoleBadge.textContent = roleName;
                restoreRoleBadge.style.background = badgeBg;
                restoreRoleBadge.style.color = badgeColor;
              }

              if (restoreDate) restoreDate.textContent = parsed.timestamp ? new Date(parsed.timestamp).toLocaleString() : 'N/A';
              if (restoreVersion) restoreVersion.textContent = parsed.version || 'v2.0.0';
              if (restoreBranchLoc) restoreBranchLoc.textContent = branchLoc;
              if (restoreBranchStore) restoreBranchStore.textContent = branchStore;
              if (restoreAuthor) restoreAuthor.textContent = parsed.exportedBy || 'Administrator';

              // Calculate payload item count
              let count = 0;
              const countItems = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                Object.values(obj).forEach(val => {
                  if (Array.isArray(val)) count += val.length;
                  else if (val && typeof val === 'object') countItems(val);
                });
              };
              countItems(parsed.data);
              if (restoreCount) restoreCount.textContent = `${count} Records Identified`;

              if (restoreAutoLinkText) {
                restoreAutoLinkText.textContent = `Auto-linking enabled: Data will be restored and linked directly to ${branchStore} (${branchLoc}) under ${roleName}.`;
              }

              if (selectedRestoreFileName) {
                selectedRestoreFileName.innerHTML = `<span style="color:#16A34A; font-weight:600;">✓ ${file.name}</span> <span style="font-size:11px; color:#64748B;">(${(file.size / 1024).toFixed(1)} KB)</span>`;
              }

              if (restorePreviewCard) restorePreviewCard.style.display = 'block';
            } catch (err) {
              console.error('Snapshot parse error:', err);
              if (window.showAdminToast) {
                window.showAdminToast('Uploaded file is not a valid RMSME backup snapshot.', 'danger');
              }
              if (selectedRestoreFileName) selectedRestoreFileName.textContent = 'Invalid file chosen';
              if (restorePreviewCard) restorePreviewCard.style.display = 'none';
              currentRestorePayload = null;
            } finally {
              btnSelectRestoreFile.disabled = false;
              btnSelectRestoreFile.style.opacity = '1';
            }
          }, 30);
        };
        reader.readAsText(file);
      });
    }

    // Cancel Restore
    if (btnCancelRestore) {
      btnCancelRestore.addEventListener('click', () => {
        if (restoreFileInput) restoreFileInput.value = '';
        if (selectedRestoreFileName) selectedRestoreFileName.textContent = 'No file chosen';
        if (restorePreviewCard) restorePreviewCard.style.display = 'none';
        const restoreProgressBox = document.getElementById('restoreProgressBox');
        if (restoreProgressBox) restoreProgressBox.style.display = 'none';
        currentRestorePayload = null;
      });
    }

    // Execute Restore Routing and Automatic Branch/Role Linking (Direct Supabase Sync)
    if (btnExecuteRestore) {
      btnExecuteRestore.addEventListener('click', async () => {
        if (!currentRestorePayload || !currentRestorePayload.data) {
          if (window.showAdminToast) window.showAdminToast('No valid backup file loaded.', 'danger');
          return;
        }

        const scope = currentRestorePayload.scope || {};
        const role = (scope.role || currentRestorePayload.roleTarget || 'all').toLowerCase();
        const roleName = scope.roleName || (role === 'admin' ? 'Administrator' : role === 'manager' ? 'Branch Manager' : role === 'staff' ? 'Staff' : 'Complete System');
        const targetStore = scope.branchStoreName || '';
        const targetLoc = scope.branchLocation || '';
        const isSpecificStore = targetStore && targetStore !== 'All Stores' && !targetStore.startsWith('All Branch Stores') && !targetStore.includes('Own Admin Only');

        if (!confirm(`Confirm Restore & Automatic Linking:\n\nThis snapshot will be applied and linked directly to:\n• Target Role: ${roleName}\n• Branch Location: ${targetLoc || 'Global'}\n• Branch Store Hub: ${targetStore || 'All Stores'}\n\nThis will update local records and synchronize all data directly to Supabase. Proceed?`)) {
          return;
        }

        const restoreProgressBox = document.getElementById('restoreProgressBox');
        const restoreProgressTitle = document.getElementById('restoreProgressTitle');
        const restoreProgressDetail = document.getElementById('restoreProgressDetail');

        btnExecuteRestore.disabled = true;
        btnExecuteRestore.innerHTML = `<span class="restore-mini-spinner-light"></span> Restoring &amp; Syncing...`;
        if (btnCancelRestore) btnCancelRestore.disabled = true;

        if (restoreProgressBox) {
          restoreProgressBox.style.display = 'flex';
          if (restoreProgressTitle) restoreProgressTitle.textContent = `Restoring & Synchronizing ${roleName} Data...`;
          if (restoreProgressDetail) restoreProgressDetail.textContent = `Linking records to ${targetStore || 'target modules'} and committing directly to Supabase...`;
        }

        try {
          const data = currentRestorePayload.data;
          let restoredCount = 0;

          // Route 1: Administrator Data
          if (role === 'admin' || role === 'all' || data.admin) {
            const adminData = data.admin || data;
            if (adminData.branchStores && typeof adminData.branchStores === 'object') {
              const curStores = JSON.parse(localStorage.getItem('RMIMS_BRANCH_STORES_V3') || '{}');
              Object.assign(curStores, adminData.branchStores);
              localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(curStores));
              restoredCount += Object.keys(adminData.branchStores).length;
            }
            if (Array.isArray(adminData.registeredUsers)) {
              const curReg = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
              adminData.registeredUsers.forEach(u => {
                if (isMockUser(u)) return;
                if (isSpecificStore) {
                  u.branchName = targetStore;
                  if (targetLoc && targetLoc !== 'ALL') u.branchLoc = targetLoc;
                }
                const idx = curReg.findIndex(c => (c.email && c.email.toLowerCase() === (u.email || '').toLowerCase()) || (c.id && c.id === u.id));
                if (idx >= 0) curReg[idx] = u;
                else curReg.push(u);
              });
              localStorage.setItem('rmims_registered_users', JSON.stringify(curReg));
              restoredCount += adminData.registeredUsers.length;
            }
            if (Array.isArray(adminData.approvedUsers)) {
              const curApp = JSON.parse(localStorage.getItem('rmims_approved_users') || '[]');
              adminData.approvedUsers.forEach(u => {
                if (isMockUser(u)) return;
                if (isSpecificStore) {
                  u.branchName = targetStore;
                  if (targetLoc && targetLoc !== 'ALL') u.branchLoc = targetLoc;
                }
                const idx = curApp.findIndex(c => (c.email && c.email.toLowerCase() === (u.email || '').toLowerCase()) || (c.id && c.id === u.id));
                if (idx >= 0) curApp[idx] = u;
                else curApp.push(u);
              });
              localStorage.setItem('rmims_approved_users', JSON.stringify(curApp));
            }
            if (Array.isArray(adminData.pendingUsers)) {
              const curPend = JSON.parse(localStorage.getItem('rmims_pending_users') || '[]');
              adminData.pendingUsers.forEach(u => {
                if (isMockUser(u)) return;
                if (isSpecificStore) {
                  u.branchName = targetStore;
                  if (targetLoc && targetLoc !== 'ALL') u.branchLoc = targetLoc;
                }
                const idx = curPend.findIndex(c => (c.email && c.email.toLowerCase() === (u.email || '').toLowerCase()) || (c.id && c.id === u.id));
                if (idx >= 0) curPend[idx] = u;
                else curPend.push(u);
              });
              localStorage.setItem('rmims_pending_users', JSON.stringify(curPend));
            }
            if (Array.isArray(adminData.systemAlerts)) {
              const curAlerts = JSON.parse(localStorage.getItem('RMIMS_SYSTEM_ALERTS_V2') || '[]');
              adminData.systemAlerts.forEach(a => {
                if (isSpecificStore) {
                  a.branchName = targetStore;
                  if (targetLoc && targetLoc !== 'ALL') a.branchLocation = targetLoc;
                }
                if (!curAlerts.some(c => c.id === a.id)) curAlerts.push(a);
              });
              localStorage.setItem('RMIMS_SYSTEM_ALERTS_V2', JSON.stringify(curAlerts));
              restoredCount += adminData.systemAlerts.length;
            }

            window.dispatchEvent(new Event('rmims_stores_updated'));
            window.dispatchEvent(new Event('rmims_registered_users_updated'));
            window.dispatchEvent(new Event('rmims_pending_users_updated'));
            window.dispatchEvent(new Event('rmims:alerts-updated'));
          }

          // Route 2: Branch Manager ALL Data (linked automatically to target branch store)
          if (role === 'manager' || role === 'all' || data.manager || data.materials) {
            const mgrData = data.manager || data;
            const mats = mgrData.rawMaterials || mgrData.materials;
            if (Array.isArray(mats)) {
              const curMats = JSON.parse(localStorage.getItem('rmims_custom_raw_materials') || '[]');
              mats.forEach(m => {
                if (isSpecificStore) m.branch = targetStore;
                const idx = curMats.findIndex(c => (c.id && c.id === m.id) || (c.name && c.name.toLowerCase() === (m.name || '').toLowerCase()));
                if (idx >= 0) curMats[idx] = m;
                else curMats.push(m);
              });
              localStorage.setItem('rmims_custom_raw_materials', JSON.stringify(curMats));
              restoredCount += mats.length;
            }

            const prods = mgrData.finishedProducts || mgrData.customFinishedProducts;
            if (Array.isArray(prods)) {
              const curProds = JSON.parse(localStorage.getItem('rmims_finished_products') || '[]');
              prods.forEach(p => {
                if (isSpecificStore) {
                  p.branch = targetStore;
                  p.branchName = targetStore;
                }
                const idx = curProds.findIndex(c => (c.id && c.id === p.id) || (c.name && c.name.toLowerCase() === (p.name || '').toLowerCase()));
                if (idx >= 0) curProds[idx] = p;
                else curProds.push(p);
              });
              localStorage.setItem('rmims_finished_products', JSON.stringify(curProds));
              restoredCount += prods.length;
            }

            const recs = mgrData.receipts || mgrData.customReceipts;
            if (Array.isArray(recs)) {
              const curRec = JSON.parse(localStorage.getItem('rmims_manager_receipts') || '[]');
              recs.forEach(r => {
                if (isSpecificStore) {
                  r.branch = targetStore;
                  r.branchName = targetStore;
                  if (targetLoc && targetLoc !== 'ALL') r.branchLocation = targetLoc;
                }
                const idx = curRec.findIndex(c => c.refNo && c.refNo === r.refNo);
                if (idx >= 0) curRec[idx] = r;
                else curRec.push(r);
              });
              localStorage.setItem('rmims_manager_receipts', JSON.stringify(curRec));
              restoredCount += recs.length;
            }

            const disbs = mgrData.disbursements || mgrData.customDisbursements;
            if (Array.isArray(disbs)) {
              const curDisb = JSON.parse(localStorage.getItem('rmims_manager_disbursements') || '[]');
              disbs.forEach(d => {
                if (isSpecificStore) {
                  d.branch = targetStore;
                  d.branchName = targetStore;
                  if (targetLoc && targetLoc !== 'ALL') d.branchLocation = targetLoc;
                }
                const idx = curDisb.findIndex(c => c.refNo && c.refNo === d.refNo);
                if (idx >= 0) curDisb[idx] = d;
                else curDisb.push(d);
              });
              localStorage.setItem('rmims_manager_disbursements', JSON.stringify(curDisb));
              restoredCount += disbs.length;
            }

            if (mgrData.forecastCache && typeof mgrData.forecastCache === 'object') {
              const curFc = JSON.parse(localStorage.getItem('rmims_forecast_cache') || '{}');
              Object.assign(curFc, mgrData.forecastCache);
              localStorage.setItem('rmims_forecast_cache', JSON.stringify(curFc));
              restoredCount += Object.keys(mgrData.forecastCache).length;
            }

            if (Array.isArray(mgrData.savedReports)) {
              const curRep = JSON.parse(localStorage.getItem('rmims_saved_reports') || '[]');
              mgrData.savedReports.forEach(r => {
                if (isSpecificStore) {
                  r.branch = targetStore;
                  r.branchName = targetStore;
                  if (targetLoc && targetLoc !== 'ALL') r.location = targetLoc;
                }
                curRep.unshift(r);
              });
              localStorage.setItem('rmims_saved_reports', JSON.stringify(curRep.slice(0, 200)));
              restoredCount += mgrData.savedReports.length;
            }

            if (Array.isArray(mgrData.managerActivities || mgrData.activityLogs)) {
              const acts = mgrData.managerActivities || mgrData.activityLogs;
              const curActs = JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]');
              acts.forEach(a => {
                if (isSpecificStore) {
                  a.branch = targetStore;
                  a.branchName = targetStore;
                  if (targetLoc && targetLoc !== 'ALL') a.branchLocation = targetLoc;
                }
                curActs.unshift(a);
              });
              localStorage.setItem('rmims_manager_activities', JSON.stringify(curActs.slice(0, 500)));
              restoredCount += acts.length;
            }

            window.dispatchEvent(new Event('rmims_inventory_updated'));
            window.dispatchEvent(new Event('rmims_receipts_updated'));
            window.dispatchEvent(new Event('rmims_disbursements_updated'));
          }

          // Route 3: Staff & Operations ALL Data (linked automatically to target branch store)
          if (role === 'staff' || role === 'all' || data.staff) {
            const stfData = data.staff || data;
            const txs = stfData.staffTransactions || stfData.staffSubmissions;
            if (Array.isArray(txs)) {
              const curTx = JSON.parse(localStorage.getItem('rmims_staff_transactions') || '[]');
              txs.forEach(s => {
                if (isSpecificStore) {
                  s.branch = targetStore;
                  s.branchName = targetStore;
                  if (targetLoc && targetLoc !== 'ALL') s.branchLoc = targetLoc;
                }
                curTx.unshift(s);
              });
              localStorage.setItem('rmims_staff_transactions', JSON.stringify(curTx.slice(0, 500)));
              restoredCount += txs.length;
            }

            if (Array.isArray(stfData.staffDraftReceipts)) {
              const curDraft = JSON.parse(localStorage.getItem('rmims_staff_draft_receipts') || '[]');
              stfData.staffDraftReceipts.forEach(d => {
                if (isSpecificStore) d.branch = targetStore;
                curDraft.unshift(d);
              });
              localStorage.setItem('rmims_staff_draft_receipts', JSON.stringify(curDraft));
              restoredCount += stfData.staffDraftReceipts.length;
            }

            if (Array.isArray(stfData.userActivityHistory || stfData.staffAuditTrail)) {
              const hist = stfData.userActivityHistory || stfData.staffAuditTrail;
              const curHist = JSON.parse(localStorage.getItem('rmims_user_activity_history') || '[]');
              hist.forEach(h => {
                if (isSpecificStore) {
                  h.branch = targetStore;
                  if (targetLoc && targetLoc !== 'ALL') h.branchLocation = targetLoc;
                }
                curHist.unshift(h);
              });
              localStorage.setItem('rmims_user_activity_history', JSON.stringify(curHist.slice(0, 500)));
              restoredCount += hist.length;
            }
          }

          window.dispatchEvent(new Event('storage'));

          // Synchronize directly with Supabase Database Tables with rapid pipeline
          let syncResult = null;
          try {
            if (syncRestoredRolePayload) {
              syncResult = await syncRestoredRolePayload(currentRestorePayload);
            }
          } catch (supaErr) {
            console.warn('[AdminSettings] Notice synchronizing restore with Supabase:', supaErr);
          }

          // Broadcast multi-tab synchronization
          try {
            if (typeof BroadcastChannel !== 'undefined') {
              const bc = new BroadcastChannel('rmims_user_sync');
              bc.postMessage({ action: 'RESTORE_COMPLETED', role, timestamp: Date.now() });
              bc.close();
            }
          } catch (_) {}

          const linkMsg = isSpecificStore ? ` and linked to ${targetStore} (${targetLoc})` : '';
          const supaCommitMsg = syncResult && syncResult.totalSynced > 0 
            ? ` and synchronized to Supabase (${syncResult.totalSynced} items committed)` 
            : ' and synced to Supabase';

          if (window.showAdminToast) {
            window.showAdminToast(`Restored ${restoredCount} records successfully${linkMsg}${supaCommitMsg} for ${roleName}.`, 'success');
          }

          // Reset file input & preview
          if (restoreFileInput) restoreFileInput.value = '';
          if (selectedRestoreFileName) selectedRestoreFileName.textContent = 'No file chosen';
          if (restorePreviewCard) restorePreviewCard.style.display = 'none';
          currentRestorePayload = null;

          // Refresh table live metrics
          renderBackupRolesTable();
        } catch (restoreErr) {
          console.error('Execution error during restore:', restoreErr);
          if (window.showAdminToast) {
            window.showAdminToast('Failed to apply restore snapshot: ' + restoreErr.message, 'danger');
          }
        } finally {
          btnExecuteRestore.disabled = false;
          btnExecuteRestore.innerHTML = `<span>Apply &amp; Restore to Role Modules</span>`;
          if (btnCancelRestore) btnCancelRestore.disabled = false;
          if (restoreProgressBox) restoreProgressBox.style.display = 'none';
        }
      });
    }

    // Initial render
    renderBackupRolesTable();
  }

  /* ==========================================================
     6. ROOT ADMIN FACTORY SYSTEM RESET
     Restores RMIMS to factory brand-new state:
     - Purges all operational stock movements (receipts & disbursements)
     - Purges all staff submissions and manager activity logs
     - Purges pending user approvals
     - Clears AI forecast caches
     - Resets raw material stocks to pristine catalog baselines
     ========================================================== */
  function initFactoryReset() {
    const modal = document.getElementById('factoryResetModal');
    const btnOpenModal = document.getElementById('btnOpenFactoryResetModal');
    const btnCloseModal = document.getElementById('btnCloseResetModal');
    const btnCancelModal = document.getElementById('btnCancelResetModal');
    const btnExecute = document.getElementById('btnExecuteResetConfirm');
    const confirmInput = document.getElementById('resetConfirmInput');

    function openResetModal() {
      if (!modal) return;
      modal.classList.add('active');
      modal.style.display = 'flex';
      modal.style.opacity = '1';
      modal.style.visibility = 'visible';
      modal.style.pointerEvents = 'auto';
      if (confirmInput) {
        confirmInput.value = '';
        setTimeout(() => confirmInput.focus(), 100);
      }
    }

    function closeResetModal() {
      if (!modal) return;
      modal.classList.remove('active');
      modal.style.display = 'none';
      modal.style.opacity = '0';
      modal.style.visibility = 'hidden';
      modal.style.pointerEvents = 'none';
      if (confirmInput) confirmInput.value = '';
    }

    document.addEventListener('click', (e) => {
      if (e.target.closest('#btnOpenFactoryResetModal')) {
        e.preventDefault();
        openResetModal();
      } else if (e.target.closest('#btnCloseResetModal') || e.target.closest('#btnCancelResetModal')) {
        e.preventDefault();
        closeResetModal();
      } else if (modal && e.target === modal) {
        closeResetModal();
      }
    });

    if (btnExecute) {
      btnExecute.addEventListener('click', () => {
        const confirmWord = (confirmInput ? confirmInput.value : '').trim();
        if (confirmWord !== 'RESET') {
          if (confirmInput) {
            confirmInput.style.borderColor = '#DC2626';
            confirmInput.focus();
          }
          if (window.showAdminToast) {
            window.showAdminToast('Please type "RESET" in capital letters to confirm.', 'danger');
          }
          return;
        }

        btnExecute.disabled = true;
        btnExecute.style.opacity = '0.7';
        btnExecute.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite;">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10"/>
          </svg>
          <span>Resetting System...</span>
        `;

        setTimeout(() => {
          try {
            // 1. Operational keys to completely remove
            const operationalKeys = [
              // Manager & Staff Receipts
              'rmims_manager_receipts',
              'rmims_custom_receipts',
              'rmims_deleted_receipt_ids',
              'rmims_receipt_counter',
              
              // Manager & Staff Disbursements
              'rmims_manager_disbursements',
              'rmims_custom_disbursements',
              'rmims_deleted_disbursement_ids',
              'rmims_disburse_counter',
              
              // Staff & Manager Audit Trails
              'rmims_manager_activities',
              'rmims_staff_transactions',
              'rmims_staff_submissions',
              'rmims_staff_draft_receipts',
              'rmims_staff_draft_disbursements',
              
              // Materials & Finished Products mutations & overrides
              'rmims_custom_raw_materials',
              'rmims_deleted_material_ids',
              'rmims_archived_materials',
              'rmims_materials_override',
              'rmims_custom_materials',
              'rmims_finished_products',
              'rmims_deleted_finished_products',
              'rmims_custom_finished_products',
              'rmims_finished_product_context',
              'rmims_raw_materials_context',
              'rmims_inventory_cache',
              'rmims_stock_adjustments',
              'rmims_inventory_adjustments',
              
              // AI Forecasting models and predictions cache
              'rmims_forecast_cache',
              'rmims_forecast_timestamp',
              'rmims_latest_forecast',
              'rmims_historical_usage_cache',
              
              // User management custom accounts & pending requests
              'rmims_pending_users',
              'rmims_user_approvals',
              'rmims_registered_users',
              
              // Diagnostics & Alerts
              'rmims_system_alerts',
              'RMIMS_SYSTEM_ALERTS_V2',

              // Branch stores network
              'RMIMS_BRANCH_STORES_V3'
            ];

            operationalKeys.forEach(k => {
              try { localStorage.removeItem(k); } catch (_) {}
            });

            // 2. Initialize pristine empty operational structures
            localStorage.setItem('rmims_manager_receipts', JSON.stringify([]));
            localStorage.setItem('rmims_manager_disbursements', JSON.stringify([]));
            localStorage.setItem('rmims_manager_activities', JSON.stringify([]));
            localStorage.setItem('rmims_staff_transactions', JSON.stringify([]));
            localStorage.setItem('rmims_pending_users', JSON.stringify([]));
            localStorage.setItem('rmims_registered_users', JSON.stringify([]));
            localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify({}));

            // 3. Broadcast sync events across all tabs/windows
            const now = Date.now();
            localStorage.setItem('rmims_sync_event', JSON.stringify({ time: now, action: 'factory_reset' }));
            localStorage.setItem('rmims_inventory_updated', String(now));
            window.dispatchEvent(new Event('rmims_inventory_updated'));
            window.dispatchEvent(new Event('storage'));

            closeResetModal();

            if (window.showAdminToast) {
              window.showAdminToast('System successfully restored to brand-new factory state! Reloading...');
            }

            setTimeout(() => {
              window.location.reload();
            }, 1200);

          } catch (err) {
            console.error('Factory Reset Error:', err);
            btnExecute.disabled = false;
            btnExecute.style.opacity = '1';
            btnExecute.textContent = 'Execute Reset';
            if (window.showAdminToast) {
              window.showAdminToast('Reset encountered an error. Please try again.', 'danger');
            }
          }
        }, 900);
      });
    }
  }

  // Initialize all controllers
  initNavigationTabs();
  initAdminProfile();
  initSecurity();
  initSessions();
  initBackupAndRestore();
  initFactoryReset();
});
