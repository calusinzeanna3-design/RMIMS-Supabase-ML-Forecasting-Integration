// js/settings.js
//
// RMIMS ADMIN SETTINGS — Full-Width Two-Panel Settings Workspace
// Authoritative Supabase Account & Auth Integration
// Light UI Only. No Mock Data.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged, signOut } from "../supabase/auth-compat.js";
import { initBackupRestore, loadDataSummary as reloadDataSummary } from "./backup-restore.js";
import { initDataReset } from "./data-reset.js";

/* ==========================================================
   STATE
   ========================================================== */

let currentUser = null; // { uid, fullName, email, role, status, avatarUrl, createdAt, updatedAt }
let pendingAvatarDataUrl = null; // Staged avatar file to save

/* ==========================================================
   HELPERS
   ========================================================== */

function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function initials(name) {
    if (!name) return "AU";
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "AU";
}

function friendlyError(err, fallback) {
    console.error(err);
    if (err && typeof err.message === "string" && err.message.includes("At least one active Admin")) {
        return "At least one active Admin account must remain.";
    }
    return fallback;
}

const toastStack = document.getElementById("toastStack");
function showToast(message, type = "success") {
    if (!toastStack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span></span>`;
    el.querySelector("span:last-child").textContent = message;
    toastStack.appendChild(el);
    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(8px)";
        setTimeout(() => el.remove(), 220);
    }, 3200);
}

/* ==========================================================
   MODAL HELPERS
   ========================================================== */

function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("open");
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
}

document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
});

document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal(overlay.id);
    });
});

/* ==========================================================
   ROLE GUARD & LOAD ACCOUNT
   ========================================================== */

function getLocalManagerOrAdmin() {
    try {
        const raw = localStorage.getItem("managerUser");
        if (raw) {
            const u = JSON.parse(raw);
            if (u && typeof u === "object") {
                const uid = u.id || u.uid || "active-manager-session";
                let mgrName = u.fullName || u.name || "Manager";
                if (!mgrName || mgrName.toLowerCase().includes("rafael") || mgrName.toLowerCase().includes("cruz") || mgrName.toLowerCase().includes("staff") || mgrName.includes("Maria Santos")) {
                    mgrName = "Manager";
                }
                let mgrEmail = u.email || "";
                return {
                    uid,
                    fullName: mgrName,
                    email: mgrEmail,
                    role: "manager",
                    status: u.status || "active",
                    avatarUrl: localStorage.getItem(`rmims_avatar_${uid}`) || "",
                    createdAt: u.createdAt || u.created_at || new Date().toISOString(),
                    updatedAt: u.updatedAt || u.updated_at || new Date().toISOString()
                };
            }
        }

        const curRaw = localStorage.getItem("currentUser") || 
                       localStorage.getItem("rmimsCurrentUser") || 
                       localStorage.getItem("userProfile");
        if (curRaw) {
            const u = JSON.parse(curRaw);
            if (u && typeof u === "object") {
                const role = (u.role || u.operationalRole || "").toLowerCase();
                const email = (u.email || "").toLowerCase();
                const isMaster = email === "calusinzeanna3@gmail.com";

                if (role === "admin" || isMaster) {
                    return { redirect: "../admin/settings.html" };
                }

                if (role === "user" || role === "staff") {
                    return { redirect: "../user/settings.html" };
                }
            }
        }
    } catch (e) {
        console.warn("Could not read local manager session:", e);
    }

    return { redirect: "../login.html" };
}

let isInitialized = false;

function applyManagerUser(userData) {
    if (!userData) return;
    if (userData.redirect) {
        window.location.href = userData.redirect;
        return;
    }
    // Deep sanitize manager identity: ensure no staff names (Rafael Cruz, etc.) bleed into manager
    if (!userData.fullName || userData.fullName.toLowerCase().includes("rafael") || userData.fullName.toLowerCase().includes("cruz") || userData.fullName.toLowerCase().includes("staff") || userData.fullName.includes("Maria Santos")) {
        userData.fullName = "Manager";
    }
    if (!userData.email || userData.email.toLowerCase().includes("staff@")) {
        userData.email = userData.email || "";
    }
    currentUser = userData;
    syncUserInterface();

    if (!isInitialized) {
        isInitialized = true;
        initNavigation();
        initProfileEditor();
        initSecurityForm();
        loadSessionInfo();

        try {
            initBackupRestore({ uid: currentUser.uid, fullName: currentUser.fullName, email: currentUser.email });
        } catch (be) {
            console.warn("Backup/restore init warning:", be);
        }

        try {
            initDataReset(reloadDataSummary);
        } catch (re) {
            console.warn("Data reset init warning:", re);
        }
    }
}

// Immediately check local session on page load so manager never sees a flash or redirect
const immediateLocalUser = getLocalManagerOrAdmin();
if (immediateLocalUser) {
    if (immediateLocalUser.redirect) {
        window.location.href = immediateLocalUser.redirect;
    } else {
        applyManagerUser(immediateLocalUser);
    }
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        // Fall back to local active session
        const local = getLocalManagerOrAdmin();
        if (local) {
            if (local.redirect) {
                window.location.href = local.redirect;
                return;
            }
            applyManagerUser(local);
            return;
        }
        // Only redirect to login if NO session exists at all
        window.location.href = "../login.html";
        return;
    }

    try {
        let { data: profile, error } = await supabase
            .from("user_profiles")
            .select("id, full_name, email, role, operational_role, status, created_at, updated_at")
            .eq("id", user.uid)
            .maybeSingle();

        const uid = user.id || user.uid;
        const cleanEmail = (user.email || "").toLowerCase();
        const isMasterAdmin = cleanEmail === "calusinzeanna3@gmail.com";

        if (isMasterAdmin) {
            if (!profile) {
                profile = {
                    id: uid,
                    full_name: user.displayName || user.user_metadata?.full_name || "Zeanna Calusin",
                    email: user.email,
                    role: "admin",
                    operational_role: "admin",
                    status: "active",
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
            } else {
                profile.role = "admin";
                profile.operational_role = "admin";
                profile.status = "active";
            }
            error = null;
        }

        if (!profile) {
            const local = getLocalManagerOrAdmin();
            if (local && !local.redirect) {
                profile = {
                    id: uid,
                    full_name: local.fullName,
                    email: user.email || local.email,
                    role: local.role,
                    operational_role: local.operationalRole || local.role,
                    status: local.status,
                    created_at: local.createdAt,
                    updated_at: local.updatedAt
                };
                error = null;
            }
        }

        if (profile && profile.status !== "active") {
            window.location.href = "../login.html";
            return;
        }

        const rawOp = String(profile.operational_role || profile.operationalRole || '').toLowerCase();
        const rawRole = String(profile.role || '').toLowerCase();
        const isAdm = rawOp === 'admin' || rawRole === 'admin' || isMasterAdmin;
        const isMgr = !isAdm && (rawOp === 'manager' || rawRole === 'manager');

        if (profile && isAdm) {
            window.location.href = "../admin/settings.html";
            return;
        }

        if (profile && !isAdm && !isMgr) {
            window.location.href = "../user/settings.html";
            return;
        }

        if (profile) {
            let mName = profile.full_name || "";
            if (!mName || mName.toLowerCase().includes("rafael") || mName.toLowerCase().includes("cruz") || mName.toLowerCase().includes("staff") || mName.includes("Maria Santos")) {
                mName = "Manager";
            }
            let mEmail = profile.email || user.email || "";
            applyManagerUser({
                uid: user.uid,
                fullName: mName,
                email: mEmail,
                role: profile.role || "manager",
                status: profile.status || "active",
                avatarUrl: localStorage.getItem(`rmims_avatar_${user.uid}`) || "",
                createdAt: profile.created_at,
                updatedAt: profile.updated_at
            });
        }

    } catch (error) {
        console.error("Error loading account in Settings:", error);
        const local = getLocalManagerOrAdmin();
        if (local && !local.redirect) {
            applyManagerUser(local);
        }
    }
});

function syncUserInterface() {
    if (!currentUser) return;

    // 1. Topbar Profile Header
    if (profileBtn) {
        const nameEl = profileBtn.querySelector("[data-shell-name]") || profileBtn.querySelector(".profile-name") || profileBtn.querySelector(".mgr-name");
        if (nameEl) nameEl.textContent = currentUser.fullName || "Manager";
        const roleEl = profileBtn.querySelector("[data-shell-role]") || profileBtn.querySelector(".profile-role") || profileBtn.querySelector(".mgr-role");
        if (roleEl) roleEl.textContent = (currentUser.role === "admin") ? "Main Admin" : "Manager";
        const topAv = profileBtn.querySelector("[data-shell-avatar]") || profileBtn.querySelector(".profile-avatar") || profileBtn.querySelector(".avatar") || document.getElementById("topbarAvatar");
        if (topAv) {
            if (currentUser.avatarUrl) {
                topAv.innerHTML = `<img src="${currentUser.avatarUrl}" alt="Avatar"/>`;
            } else {
                topAv.textContent = initials(currentUser.fullName || "Manager");
            }
        }
    }

    // 2. Profile Details Panel
    const fullNameInput = document.getElementById("fullName");
    const emailInput = document.getElementById("email");
    const roleInput = document.getElementById("role");
    const statusEl = document.getElementById("accountStatus");
    const statusDot = document.getElementById("statusDot");
    const createdEl = document.getElementById("accountCreated");
    const loginEl = document.getElementById("accountLastLogin");
    const previewAv = document.getElementById("profileAvatarPreview");

    if (fullNameInput) fullNameInput.value = currentUser.fullName || "Manager";
    if (emailInput) emailInput.value = currentUser.email || "";
    if (roleInput) roleInput.value = (currentUser.role === "admin" || currentUser.role === "manager") ? "Manager" : "Staff Member";

    if (statusEl) statusEl.textContent = currentUser.status === "active" ? "Active" : "Inactive";
    if (statusDot) statusDot.classList.toggle("inactive", currentUser.status !== "active");

    if (createdEl) createdEl.textContent = fmtDate(currentUser.createdAt);
    if (loginEl) loginEl.textContent = fmtDateTime(currentUser.updatedAt);

    if (previewAv) {
        if (currentUser.avatarUrl) {
            previewAv.innerHTML = `<img src="${currentUser.avatarUrl}" alt="Avatar"/>`;
        } else {
            previewAv.textContent = initials(currentUser.fullName || "Manager");
        }
    }
}

/* ==========================================================
   TWO-PANEL SETTINGS NAVIGATION
   ========================================================== */

function initNavigation() {
    const navItems = document.querySelectorAll(".settings-nav-item");
    const views = {
        profile: document.getElementById("view-profile"),
        security: document.getElementById("view-security"),
        sessions: document.getElementById("view-sessions"),
        data: document.getElementById("view-data"),
        system: document.getElementById("view-system"),
        danger: document.getElementById("view-danger")
    };

    const breadcrumbCrumb = document.getElementById("settingsCrumb");
    const navTitles = {
        profile: "Profile",
        security: "Password & Security",
        sessions: "Sessions & Devices",
        data: "Backup & Restore",
        system: "System Information",
        danger: "Delete Account & Reset Data"
    };

    function selectTab(tabKey) {
        if (!views[tabKey]) tabKey = "profile";

        navItems.forEach(item => {
            if (item.getAttribute("data-nav") === tabKey) item.classList.add("active");
            else item.classList.remove("active");
        });

        Object.entries(views).forEach(([k, viewEl]) => {
            if (viewEl) {
                if (k === tabKey) viewEl.classList.add("active");
                else viewEl.classList.remove("active");
            }
        });

        if (breadcrumbCrumb) {
            breadcrumbCrumb.textContent = navTitles[tabKey] || "Settings";
        }
    }

    navItems.forEach(btn => {
        btn.addEventListener("click", () => {
            const navKey = btn.getAttribute("data-nav");
            selectTab(navKey);

            const url = new URL(window.location.href);
            url.searchParams.set("section", navKey);
            history.pushState({ section: navKey }, "", url);
        });
    });

    // Handle deep-linking via query parameter ?section=... or ?tab=...
    const urlParams = new URLSearchParams(window.location.search);
    let initialSection = urlParams.get("section") || urlParams.get("tab") || "profile";
    if (initialSection === "account") initialSection = "profile";
    if (initialSection === "password") initialSection = "security";
    selectTab(initialSection);

    window.addEventListener("popstate", () => {
        const params = new URLSearchParams(window.location.search);
        let s = params.get("section") || params.get("tab") || "profile";
        if (s === "account") s = "profile";
        if (s === "password") s = "security";
        selectTab(s);
    });
}

/* ==========================================================
   EDIT PROFILE & PHOTO UPLOADER
   ========================================================== */

function initProfileEditor() {
    const photoInput = document.getElementById("profilePhotoInput");
    const uploadBtn = document.getElementById("uploadProfilePhotoBtn");
    const removeBtn = document.getElementById("removeProfilePhotoBtn");
    const previewAv = document.getElementById("profileAvatarPreview");
    const profileForm = document.getElementById("editProfileForm");
    const fullNameInput = document.getElementById("fullName");
    const fullNameError = document.getElementById("fullNameError");
    const saveBtn = document.getElementById("saveProfileChangesBtn");

    if (uploadBtn && photoInput) {
        uploadBtn.addEventListener("click", () => photoInput.click());
    }

    if (photoInput) {
        photoInput.addEventListener("change", (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            // Validate image type
            const validTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
            if (!validTypes.includes(file.type)) {
                showToast("Please upload a valid image (PNG, JPG, WebP, or SVG).", "error");
                photoInput.value = "";
                return;
            }

            // Validate image size (<= 2MB)
            if (file.size > 2 * 1024 * 1024) {
                showToast("Image size must be under 2MB.", "error");
                photoInput.value = "";
                return;
            }

            const reader = new FileReader();
            reader.onload = (loadEvt) => {
                pendingAvatarDataUrl = loadEvt.target.result;
                if (previewAv) {
                    previewAv.innerHTML = `<img src="${pendingAvatarDataUrl}" alt="Avatar Preview"/>`;
                }
                showToast("Profile image staged. Click 'Save Changes' to apply.");
            };
            reader.readAsDataURL(file);
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener("click", () => {
            pendingAvatarDataUrl = "";
            if (photoInput) photoInput.value = "";
            if (previewAv) {
                previewAv.textContent = initials(currentUser.fullName);
            }
            showToast("Profile image removed. Click 'Save Changes' to apply.");
        });
    }

    if (profileForm) {
        profileForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!currentUser) return;

            const newName = fullNameInput?.value.trim();
            if (fullNameError) fullNameError.textContent = "";

            if (!newName || newName.length < 2) {
                if (fullNameError) fullNameError.textContent = "Please enter a valid full name (at least 2 characters).";
                return;
            }

            const origText = saveBtn.textContent;
            saveBtn.disabled = true;
            saveBtn.textContent = "Saving…";

            try {
                const nowIso = new Date().toISOString();
                const updatePayload = {
                    full_name: newName,
                    updated_at: nowIso
                };

                let supabaseSucceeded = false;
                try {
                    const { error } = await supabase
                        .from("user_profiles")
                        .update(updatePayload)
                        .eq("id", currentUser.uid);
                    if (!error) supabaseSucceeded = true;
                } catch (dbErr) {
                    console.warn("Supabase profile update warning:", dbErr);
                }

                if (pendingAvatarDataUrl !== null) {
                    if (pendingAvatarDataUrl) {
                        localStorage.setItem(`rmims_avatar_${currentUser.uid}`, pendingAvatarDataUrl);
                    } else {
                        localStorage.removeItem(`rmims_avatar_${currentUser.uid}`);
                    }
                    currentUser.avatarUrl = pendingAvatarDataUrl;
                }
                currentUser.fullName = newName;
                currentUser.updatedAt = nowIso;

                // Synchronize across active localStorage user keys
                try {
                    const keys = ["currentUser", "rmimsCurrentUser", "userProfile"];
                    keys.forEach(k => {
                        const raw = localStorage.getItem(k);
                        if (raw) {
                            const u = JSON.parse(raw);
                            u.fullName = newName;
                            u.name = newName;
                            localStorage.setItem(k, JSON.stringify(u));
                        }
                    });
                } catch (se) {}

                syncUserInterface();
                showToast("Profile updated successfully.");

            } catch (err) {
                console.error("Error saving profile changes:", err);
                showToast(friendlyError(err, "Unable to save profile changes. Please try again."), "error");
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = origText;
            }
        });
    }
}

/* ==========================================================
   PASSWORD & SECURITY FORM
   ========================================================== */

function initSecurityForm() {
    // 1. Direct Password Form
    const directForm = document.getElementById("directChangePasswordForm");
    if (directForm) {
        directForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!currentUser) return;

            const currentPassword = document.getElementById("directCurrentPassword")?.value;
            const newPassword = document.getElementById("directNewPassword")?.value;
            const confirmPassword = document.getElementById("directConfirmPassword")?.value;

            const currentErr = document.getElementById("directCurrentPasswordError");
            const newErr = document.getElementById("directNewPasswordError");
            const confirmErr = document.getElementById("directConfirmPasswordError");

            if (currentErr) currentErr.textContent = "";
            if (newErr) newErr.textContent = "";
            if (confirmErr) confirmErr.textContent = "";

            let hasError = false;
            if (!currentPassword) {
                if (currentErr) currentErr.textContent = "Current password is required.";
                hasError = true;
            }
            if (!newPassword || newPassword.length < 8) {
                if (newErr) newErr.textContent = "New password must be at least 8 characters.";
                hasError = true;
            }
            if (newPassword && currentPassword && newPassword === currentPassword) {
                if (newErr) newErr.textContent = "New password must be different from current password.";
                hasError = true;
            }
            if (!confirmPassword) {
                if (confirmErr) confirmErr.textContent = "Please confirm your new password.";
                hasError = true;
            } else if (newPassword !== confirmPassword) {
                if (confirmErr) confirmErr.textContent = "Passwords do not match.";
                hasError = true;
            }

            if (hasError) return;

            const btn = document.getElementById("directSavePasswordBtn");
            const orig = btn.textContent;
            btn.disabled = true;
            btn.textContent = "Updating…";

            try {
                // Re-verify current password
                const { error: verifyError } = await auth.signInWithPassword({
                    email: currentUser.email,
                    password: currentPassword
                });

                if (verifyError) {
                    if (currentErr) currentErr.textContent = "Current password is incorrect.";
                    return;
                }

                const { error: updateError } = await auth.updateUser({ password: newPassword });
                if (updateError) throw updateError;

                showToast("Password updated successfully.");
                directForm.reset();

            } catch (err) {
                console.error(err);
                showToast("Unable to change password. Please check your information and try again.", "error");
            } finally {
                btn.disabled = false;
                btn.textContent = orig;
            }
        });
    }

    // 2. Modal Password Form (fallback support)
    const modalForm = document.getElementById("changePasswordForm");
    if (modalForm) {
        modalForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!currentUser) return;

            const currentPassword = document.getElementById("currentPassword").value;
            const newPassword = document.getElementById("newPassword").value;
            const confirmNewPassword = document.getElementById("confirmNewPassword").value;

            const currentErr = document.getElementById("currentPasswordError");
            const newErr = document.getElementById("newPasswordError");
            const confirmErr = document.getElementById("confirmNewPasswordError");

            if (currentErr) currentErr.textContent = "";
            if (newErr) newErr.textContent = "";
            if (confirmErr) confirmErr.textContent = "";

            let hasError = false;
            if (!currentPassword) { currentErr.textContent = "Current password is required."; hasError = true; }
            if (!newPassword || newPassword.length < 8) { newErr.textContent = "New password must be at least 8 characters."; hasError = true; }
            if (newPassword && currentPassword && newPassword === currentPassword) { newErr.textContent = "New password must be different from the current password."; hasError = true; }
            if (!confirmNewPassword) { confirmErr.textContent = "Please confirm your new password."; hasError = true; }
            else if (newPassword !== confirmNewPassword) { confirmErr.textContent = "Passwords do not match."; hasError = true; }

            if (hasError) return;

            const btn = document.getElementById("savePasswordBtn");
            const original = btn.textContent;
            btn.disabled = true;
            btn.textContent = "Saving…";

            try {
                const { error: verifyError } = await auth.signInWithPassword({
                    email: currentUser.email,
                    password: currentPassword
                });

                if (verifyError) {
                    currentErr.textContent = "Current password is incorrect.";
                    return;
                }

                const { error: updateError } = await auth.updateUser({ password: newPassword });
                if (updateError) throw updateError;

                showToast("Password changed successfully.");
                closeModal("changePasswordModal");

            } catch (err) {
                console.error(err);
                showToast("Unable to change password. Please check your information and try again.", "error");
            } finally {
                btn.disabled = false;
                btn.textContent = original;
            }
        });
    }

    // 3. Logout Button
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            const confirmLogout = confirm("Are you sure you want to logout of RMSME?");
            if (!confirmLogout) return;

            try {
                await signOut(auth);
                window.location.href = "../login.html";
            } catch (error) {
                console.error("Logout Error:", error);
                showToast("Unable to sign out. Please try again.", "error");
            }
        });
    }
}

/* ==========================================================
   SESSIONS & DEVICES
   ========================================================== */

async function loadSessionInfo() {
    const el = document.getElementById("sessionInfo");
    if (!el) return;

    try {
        const { data, error } = await auth.getSession();
        if (error || !data.session) {
            el.textContent = "Session active on this browser.";
            return;
        }

        const signedInAt = data.session.user?.last_sign_in_at
            ? fmtDateTime(data.session.user.last_sign_in_at)
            : "Live active session";

        // Discover browser
        const ua = navigator.userAgent;
        let browserName = "Web Browser";
        if (ua.includes("Chrome") && !ua.includes("Edg")) browserName = "Google Chrome";
        else if (ua.includes("Edg")) browserName = "Microsoft Edge";
        else if (ua.includes("Firefox")) browserName = "Mozilla Firefox";
        else if (ua.includes("Safari") && !ua.includes("Chrome")) browserName = "Apple Safari";

        const osName = ua.includes("Windows") ? "Windows OS" : (ua.includes("Mac") ? "macOS" : (ua.includes("Linux") ? "Linux" : "Desktop"));

        el.textContent = `${browserName} on ${osName} — Active since ${signedInAt}`;
    } catch (err) {
        console.error(err);
        el.textContent = "Session active on this browser.";
    }
}

document.getElementById("signOutOthersBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("signOutOthersBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Signing Out…";
    try {
        const { error } = await auth.signOut({ scope: "others" });
        if (error) throw error;
        showToast("Other active sessions have been signed out.");
    } catch (err) {
        showToast(friendlyError(err, "Unable to sign out other sessions. Please try again."), "error");
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
});

/* ==========================================================
   DANGER ZONE — DELETE ACCOUNT
   ========================================================== */

document.getElementById("openDeleteAccountBtn")?.addEventListener("click", async () => {
    if (!currentUser) return;

    const btn = document.getElementById("openDeleteAccountBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Checking…";

    try {
        const blockedNote = document.getElementById("deleteAccountBlockedNote");
        const confirmFields = document.getElementById("deleteAccountConfirmFields");
        const confirmBtn = document.getElementById("confirmDeleteAccountBtn");
        const confirmInput = document.getElementById("deleteConfirmText");
        if (confirmInput) confirmInput.value = "";

        let isLastActiveAdmin = false;

        if (currentUser.role === "admin" && currentUser.status === "active") {
            const { data: activeAdmins } = await supabase
                .from("user_profiles")
                .select("id, role, status")
                .eq("role", "admin")
                .eq("status", "active");
            const otherActiveAdmins = (activeAdmins || [])
                .filter(u => u.id !== currentUser.uid);
            isLastActiveAdmin = otherActiveAdmins.length === 0;
        }

        if (blockedNote) blockedNote.style.display = isLastActiveAdmin ? "block" : "none";
        if (confirmFields) confirmFields.style.display = isLastActiveAdmin ? "none" : "block";
        if (confirmBtn) confirmBtn.style.display = isLastActiveAdmin ? "none" : "inline-block";

        openModal("deleteAccountModal");

    } catch (err) {
        showToast(friendlyError(err, "Unable to check account status. Please try again."), "error");
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
});

document.getElementById("confirmDeleteAccountBtn")?.addEventListener("click", async () => {
    const confirmInput = document.getElementById("deleteConfirmText");
    if (!confirmInput || confirmInput.value.trim() !== "DELETE") {
        showToast('Type "DELETE" to confirm.', "error");
        return;
    }

    const btn = document.getElementById("confirmDeleteAccountBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Deleting…";

    try {
        const { error } = await auth.rpc("delete_own_account");
        if (error) throw error;

        closeModal("deleteAccountModal");
        showToast("Your account has been deleted.");
        setTimeout(() => { window.location.href = "../login.html"; }, 1200);

    } catch (err) {
        showToast(friendlyError(err, "Unable to delete your account. Please try again."), "error");
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
});
