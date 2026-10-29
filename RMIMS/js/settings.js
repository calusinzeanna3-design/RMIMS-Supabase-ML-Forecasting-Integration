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
        const keys = ["managerUser", "currentUser", "rmimsCurrentUser", "userProfile"];
        for (const k of keys) {
            const raw = localStorage.getItem(k);
            if (!raw) continue;
            let u = null;
            try { u = JSON.parse(raw); } catch (_) { continue; }
            if (!u || typeof u !== "object") continue;

            const role = String(u.role || u.operationalRole || u.operational_role || "").toLowerCase();
            const email = String(u.email || "").toLowerCase();
            const isMaster = email === "calusinzeanna3@gmail.com";

            if (role === "admin" || isMaster) {
                return { redirect: "../admin/settings.html" };
            }
            if (role === "user" || role === "staff") {
                return { redirect: "../user/settings.html" };
            }

            const uid = u.id || u.uid || "active-manager-session";
            let mgrName = u.fullName || u.name || u.full_name || "Manager";
            if (!mgrName || mgrName.toLowerCase().includes("rafael") || mgrName.toLowerCase().includes("cruz") || mgrName.toLowerCase().includes("staff") || mgrName.includes("Maria Santos")) {
                mgrName = "Manager";
            }
            let mgrEmail = u.email || "";
            const isRemoved = localStorage.getItem('rmims_avatar_removed') === 'true' ||
                              (mgrEmail && localStorage.getItem('rmims_avatar_removed_' + mgrEmail.toLowerCase()) === 'true');
            const av = isRemoved ? "" : (localStorage.getItem(`rmims_avatar_${uid}`) ||
                       localStorage.getItem("rmims_manager_avatar") ||
                       localStorage.getItem("rmims_user_avatar") ||
                       u.avatarUrl || u.avatar_url || "");
            return {
                uid,
                fullName: mgrName,
                email: mgrEmail,
                role: "manager",
                status: u.status || "active",
                avatarUrl: av,
                createdAt: u.createdAt || u.created_at || new Date().toISOString(),
                updatedAt: u.updatedAt || u.updated_at || new Date().toISOString()
            };
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
    const isUserRemoved = localStorage.getItem('rmims_avatar_removed') === 'true' ||
                          (userData.email && localStorage.getItem('rmims_avatar_removed_' + userData.email.toLowerCase()) === 'true');
    if (isUserRemoved) {
        userData.avatarUrl = "";
    } else if (!userData.avatarUrl) {
        userData.avatarUrl = localStorage.getItem(`rmims_avatar_${userData.uid}`) ||
                             localStorage.getItem("rmims_manager_avatar") ||
                             localStorage.getItem("rmims_user_avatar") || "";
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
            .select("id, full_name, email, role, operational_role, status, created_at, updated_at, avatar_url")
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
            const isAuthRemoved = localStorage.getItem('rmims_avatar_removed') === 'true' ||
                                  (mEmail && localStorage.getItem('rmims_avatar_removed_' + mEmail.toLowerCase()) === 'true');
            const avUrl = isAuthRemoved ? "" : (profile.avatar_url || 
                          localStorage.getItem(`rmims_avatar_${user.uid}`) || 
                          localStorage.getItem("rmims_manager_avatar") || 
                          localStorage.getItem("rmims_user_avatar") || "");
            applyManagerUser({
                uid: user.uid,
                fullName: mName,
                email: mEmail,
                role: "manager",
                status: profile.status || "active",
                avatarUrl: avUrl,
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
        document.querySelectorAll("[data-shell-avatar], #topbarProfileAvatar, #topbarAvatar").forEach(topAv => {
            if (currentUser.avatarUrl) {
                topAv.innerHTML = `<img src="${currentUser.avatarUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"/>`;
                topAv.style.padding = '0';
                topAv.style.overflow = 'hidden';
            } else {
                topAv.textContent = initials(currentUser.fullName || "Manager");
            }
        });
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
    if (roleInput) roleInput.value = "Store Manager";

    if (statusEl) statusEl.textContent = currentUser.status === "active" ? "Active" : "Inactive";
    if (statusDot) statusDot.classList.toggle("inactive", currentUser.status !== "active");

    if (createdEl) createdEl.textContent = fmtDate(currentUser.createdAt);
    if (loginEl) loginEl.textContent = fmtDateTime(currentUser.updatedAt);

    if (previewAv) {
        if (currentUser.avatarUrl) {
            previewAv.innerHTML = `<img src="${currentUser.avatarUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"/>`;
            previewAv.style.padding = '0';
            previewAv.style.overflow = 'hidden';
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
            reader.onload = async (loadEvt) => {
                const dataUrl = loadEvt.target.result;
                pendingAvatarDataUrl = dataUrl;
                if (currentUser) {
                    const cleanEmail = (currentUser.email || "").toLowerCase();
                    localStorage.removeItem('rmims_avatar_removed');
                    if (cleanEmail) localStorage.removeItem('rmims_avatar_removed_' + cleanEmail);

                    currentUser.avatarUrl = dataUrl;
                    try {
                        localStorage.setItem(`rmims_avatar_${currentUser.uid}`, dataUrl);
                        localStorage.setItem("rmims_manager_avatar", dataUrl);
                        localStorage.setItem("rmims_user_avatar", dataUrl);
                        const keys = ["currentUser", "rmimsCurrentUser", "userProfile", "managerUser", "staffUser", "adminUser"];
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
                        if (currentUser.uid && !currentUser.uid.startsWith("active-")) {
                            await supabase
                                .from("user_profiles")
                                .update({ avatar_url: dataUrl, updated_at: new Date().toISOString() })
                                .eq("id", currentUser.uid);
                        }
                        if (cleanEmail) {
                            await supabase
                                .from("user_profiles")
                                .update({ avatar_url: dataUrl, updated_at: new Date().toISOString() })
                                .eq("email", cleanEmail);
                        }
                    } catch (dbErr) {
                        console.warn("Direct Supabase avatar update warning:", dbErr);
                    }
                }

                syncUserInterface();
                window.dispatchEvent(new CustomEvent("rmims_avatar_updated", { detail: { avatarUrl: dataUrl } }));
                showToast("Profile image updated successfully.", "success");
            };
            reader.readAsDataURL(file);
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener("click", async () => {
            pendingAvatarDataUrl = "";
            if (photoInput) photoInput.value = "";
            const cleanEmail = (currentUser?.email || "").toLowerCase();

            // Set permanent tombstone so avatar is never resurrected on refresh
            localStorage.setItem('rmims_avatar_removed', 'true');
            if (cleanEmail) localStorage.setItem('rmims_avatar_removed_' + cleanEmail, 'true');

            // 1. Clear explicit avatar keys
            if (currentUser) {
                currentUser.avatarUrl = "";
                localStorage.removeItem(`rmims_avatar_${currentUser.uid}`);
            }
            localStorage.removeItem("rmims_manager_avatar");
            localStorage.removeItem("rmims_user_avatar");
            localStorage.removeItem("rmims_admin_avatar");

            // 2. Scan and remove any dynamic rmims_avatar_ / rmims_user_avatar_ key
            try {
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && (k.startsWith("rmims_avatar_") || k.startsWith("rmims_user_avatar_"))) {
                        if (!k.startsWith("rmims_avatar_removed")) keysToRemove.push(k);
                    }
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
            } catch (_) {}

            // 3. Clear avatar from all cached user objects
            const userObjKeys = ["currentUser", "rmimsCurrentUser", "userProfile", "managerUser", "staffUser", "adminUser", "rmimsAdminUser"];
            userObjKeys.forEach(k => {
                try {
                    const raw = localStorage.getItem(k);
                    if (raw) {
                        const u = JSON.parse(raw);
                        delete u.avatarUrl;
                        delete u.avatar_url;
                        localStorage.setItem(k, JSON.stringify(u));
                    }
                } catch (_) {}
            });

            // 4. Clear avatar from rmims_registered_users
            try {
                const reg = JSON.parse(localStorage.getItem("rmims_registered_users") || "[]");
                let regChanged = false;
                reg.forEach(u => {
                    if ((cleanEmail && (u.email || "").toLowerCase() === cleanEmail) ||
                        (currentUser?.uid && String(u.id || "") === String(currentUser.uid)) ||
                        (currentUser?.fullName && (u.name || "").toLowerCase() === currentUser.fullName.toLowerCase())) {
                        delete u.avatarUrl;
                        delete u.avatar_url;
                        regChanged = true;
                    }
                });
                if (regChanged) localStorage.setItem("rmims_registered_users", JSON.stringify(reg));
            } catch (_) {}

            // 5. Update Supabase permanently (by ID, by auth user, and by email)
            try {
                const nowIso = new Date().toISOString();
                if (currentUser?.uid && !currentUser.uid.startsWith("active-")) {
                    await supabase.from("user_profiles").update({ avatar_url: null, updated_at: nowIso }).eq("id", currentUser.uid);
                }
                if (cleanEmail) {
                    await supabase.from("user_profiles").update({ avatar_url: null, updated_at: nowIso }).eq("email", cleanEmail);
                }
                try {
                    const { data: { user: supaUser } } = await supabase.auth.getUser();
                    if (supaUser?.id) {
                        await supabase.from("user_profiles").update({ avatar_url: null, updated_at: nowIso }).eq("id", supaUser.id);
                    }
                } catch (_) {}
            } catch (dbErr) {
                console.warn("Supabase avatar removal notice:", dbErr);
            }

            syncUserInterface();
            window.dispatchEvent(new CustomEvent("rmims_avatar_updated", { detail: { avatarUrl: "" } }));
            showToast("Profile image removed permanently.", "info");
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

                const cleanEmail = (currentUser.email || "").toLowerCase();
                const isExplicitlyRemoved = localStorage.getItem('rmims_avatar_removed') === 'true' ||
                                            (cleanEmail && localStorage.getItem('rmims_avatar_removed_' + cleanEmail) === 'true');

                if (pendingAvatarDataUrl !== null) {
                    if (pendingAvatarDataUrl) {
                        localStorage.removeItem('rmims_avatar_removed');
                        if (cleanEmail) localStorage.removeItem('rmims_avatar_removed_' + cleanEmail);
                        localStorage.setItem(`rmims_avatar_${currentUser.uid}`, pendingAvatarDataUrl);
                        localStorage.setItem("rmims_manager_avatar", pendingAvatarDataUrl);
                        localStorage.setItem("rmims_user_avatar", pendingAvatarDataUrl);
                        updatePayload.avatar_url = pendingAvatarDataUrl;
                    } else {
                        updatePayload.avatar_url = null;
                    }
                    currentUser.avatarUrl = pendingAvatarDataUrl;
                    window.dispatchEvent(new CustomEvent("rmims_avatar_updated", { detail: { avatarUrl: pendingAvatarDataUrl } }));
                } else if (isExplicitlyRemoved || !currentUser.avatarUrl) {
                    updatePayload.avatar_url = null;
                } else if (currentUser.avatarUrl) {
                    updatePayload.avatar_url = currentUser.avatarUrl;
                }

                try {
                    if (currentUser.uid && !currentUser.uid.startsWith("active-")) {
                        await supabase
                            .from("user_profiles")
                            .update(updatePayload)
                            .eq("id", currentUser.uid);
                    }
                    if (cleanEmail) {
                        await supabase
                            .from("user_profiles")
                            .update(updatePayload)
                            .eq("email", cleanEmail);
                    }
                } catch (dbErr) {
                    console.warn("Supabase profile update warning:", dbErr);
                }

                currentUser.fullName = newName;
                currentUser.updatedAt = nowIso;

                // Synchronize across active localStorage user keys
                try {
                    const keys = ["currentUser", "rmimsCurrentUser", "userProfile", "managerUser"];
                    keys.forEach(k => {
                        const raw = localStorage.getItem(k);
                        if (raw) {
                            const u = JSON.parse(raw);
                            u.fullName = newName;
                            u.name = newName;
                            if (currentUser.avatarUrl) {
                                u.avatarUrl = currentUser.avatarUrl;
                                u.avatar_url = currentUser.avatarUrl;
                            }
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
                // 1. Resolve email
                let userEmail = (currentUser?.email || "").trim().toLowerCase();
                if (!userEmail) {
                    userEmail = (document.getElementById("email")?.value || "").trim().toLowerCase();
                }
                if (!userEmail) {
                    const keys = ["managerUser", "currentUser", "rmimsCurrentUser", "userProfile"];
                    for (const k of keys) {
                        try {
                            const raw = localStorage.getItem(k);
                            if (raw) {
                                const parsed = JSON.parse(raw);
                                if (parsed?.email) {
                                    userEmail = parsed.email.trim().toLowerCase();
                                    currentUser.email = userEmail;
                                    break;
                                }
                            }
                        } catch (_) {}
                    }
                }

                // 2. Local registered user & branch store record check
                let regUsers = [];
                try {
                    regUsers = JSON.parse(localStorage.getItem("rmims_registered_users") || "[]");
                } catch (_) {}
                const localUser = regUsers.find(u => 
                    (userEmail && (u.email || "").toLowerCase() === userEmail) ||
                    (currentUser?.uid && String(u.id || "") === String(currentUser.uid)) ||
                    (currentUser?.fullName && (u.name || "").toLowerCase() === currentUser.fullName.toLowerCase())
                );

                let storeUser = null;
                try {
                    const rawStores = localStorage.getItem("RMIMS_BRANCH_STORES_V3");
                    if (rawStores) {
                        const stores = JSON.parse(rawStores);
                        const storeList = Array.isArray(stores) ? stores : Object.values(stores);
                        for (const st of storeList) {
                            const list = [...(st.managers || []), ...(st.staff || [])];
                            for (const p of list) {
                                if (p && (
                                    (userEmail && (p.email || "").toLowerCase() === userEmail) ||
                                    (currentUser?.fullName && (p.name || "").toLowerCase() === currentUser.fullName.toLowerCase())
                                )) {
                                    storeUser = p;
                                    break;
                                }
                            }
                            if (storeUser) break;
                        }
                    }
                } catch (_) {}

                // If localUser or storeUser has an established password, verify it:
                const knownCurrentPw = localUser?.password || storeUser?.password;
                if (knownCurrentPw && knownCurrentPw !== currentPassword) {
                    if (currentErr) currentErr.textContent = "Current password is incorrect.";
                    return;
                }

                // 3. Attempt Supabase Auth re-authentication and update if online
                const authClient = supabase?.auth || auth?.auth || auth;
                let verifiedOnline = false;
                if (userEmail && authClient && typeof authClient.signInWithPassword === "function") {
                    try {
                        const { error: verifyError } = await authClient.signInWithPassword({
                            email: userEmail,
                            password: currentPassword
                        });
                        if (verifyError) {
                            if (!knownCurrentPw) {
                                if (currentErr) currentErr.textContent = "Current password is incorrect.";
                                return;
                            }
                        } else {
                            verifiedOnline = true;
                        }
                    } catch (e) {
                        console.warn("Supabase re-auth notice:", e);
                    }
                }

                if (authClient && typeof authClient.updateUser === "function") {
                    try {
                        await authClient.updateUser({ password: newPassword });
                    } catch (upErr) {
                        console.warn("Supabase updateUser notice:", upErr);
                    }
                }

                // 4. Update in rmims_registered_users
                let regUpdated = false;
                regUsers.forEach(u => {
                    if ((userEmail && (u.email || "").toLowerCase() === userEmail) ||
                        (currentUser?.uid && String(u.id || "") === String(currentUser.uid))) {
                        u.password = newPassword;
                        regUpdated = true;
                    }
                });
                if (!regUpdated && userEmail) {
                    regUsers.push({
                        id: currentUser?.uid || "user_" + Date.now(),
                        email: userEmail,
                        name: currentUser?.fullName || "Manager",
                        role: currentUser?.role || "manager",
                        password: newPassword,
                        status: "active"
                    });
                }
                localStorage.setItem("rmims_registered_users", JSON.stringify(regUsers));
                window.dispatchEvent(new Event("rmims_registered_users_updated"));

                // 5. Update in RMIMS_BRANCH_STORES_V3
                try {
                    const rawStores = localStorage.getItem("RMIMS_BRANCH_STORES_V3");
                    if (rawStores) {
                        const stores = JSON.parse(rawStores);
                        const storeList = Array.isArray(stores) ? stores : Object.values(stores);
                        let storeChanged = false;
                        storeList.forEach(st => {
                            const list = [...(st.managers || []), ...(st.staff || [])];
                            list.forEach(p => {
                                if (p && ((userEmail && (p.email || "").toLowerCase() === userEmail) || (p.name && p.name === currentUser?.fullName))) {
                                    p.password = newPassword;
                                    storeChanged = true;
                                }
                            });
                        });
                        if (storeChanged) {
                            localStorage.setItem("RMIMS_BRANCH_STORES_V3", JSON.stringify(stores));
                        }
                    }
                } catch (_) {}

                // 6. Update userProfile / managerUser updated_at
                try {
                    const keys = ["managerUser", "currentUser", "rmimsCurrentUser", "userProfile"];
                    keys.forEach(k => {
                        const raw = localStorage.getItem(k);
                        if (raw) {
                            const u = JSON.parse(raw);
                            u.updatedAt = new Date().toISOString();
                            localStorage.setItem(k, JSON.stringify(u));
                        }
                    });
                } catch (_) {}

                showToast("Password updated successfully.", "success");
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

            const currentPassword = document.getElementById("currentPassword")?.value || "";
            const newPassword = document.getElementById("newPassword")?.value || "";
            const confirmNewPassword = document.getElementById("confirmNewPassword")?.value || "";

            const currentErr = document.getElementById("currentPasswordError");
            const newErr = document.getElementById("newPasswordError");
            const confirmErr = document.getElementById("confirmNewPasswordError");

            if (currentErr) currentErr.textContent = "";
            if (newErr) newErr.textContent = "";
            if (confirmErr) confirmErr.textContent = "";

            let hasError = false;
            if (!currentPassword) { if (currentErr) currentErr.textContent = "Current password is required."; hasError = true; }
            if (!newPassword || newPassword.length < 8) { if (newErr) newErr.textContent = "New password must be at least 8 characters."; hasError = true; }
            if (newPassword && currentPassword && newPassword === currentPassword) { if (newErr) newErr.textContent = "New password must be different from the current password."; hasError = true; }
            if (!confirmNewPassword) { if (confirmErr) confirmErr.textContent = "Please confirm your new password."; hasError = true; }
            else if (newPassword !== confirmNewPassword) { if (confirmErr) confirmErr.textContent = "Passwords do not match."; hasError = true; }

            if (hasError) return;

            const btn = document.getElementById("savePasswordBtn");
            const original = btn ? btn.textContent : "Save";
            if (btn) {
                btn.disabled = true;
                btn.textContent = "Saving…";
            }

            try {
                let userEmail = (currentUser?.email || "").trim().toLowerCase();
                if (!userEmail) {
                    const keys = ["managerUser", "currentUser", "rmimsCurrentUser", "userProfile"];
                    for (const k of keys) {
                        try {
                            const raw = localStorage.getItem(k);
                            if (raw) {
                                const parsed = JSON.parse(raw);
                                if (parsed?.email) {
                                    userEmail = parsed.email.trim().toLowerCase();
                                    currentUser.email = userEmail;
                                    break;
                                }
                            }
                        } catch (_) {}
                    }
                }

                let regUsers = [];
                try {
                    regUsers = JSON.parse(localStorage.getItem("rmims_registered_users") || "[]");
                } catch (_) {}
                const localUser = regUsers.find(u => 
                    (userEmail && (u.email || "").toLowerCase() === userEmail) ||
                    (currentUser?.uid && String(u.id || "") === String(currentUser.uid))
                );

                const knownCurrentPw = localUser?.password;
                if (knownCurrentPw && knownCurrentPw !== currentPassword) {
                    if (currentErr) currentErr.textContent = "Current password is incorrect.";
                    return;
                }

                const authClient = supabase?.auth || auth?.auth || auth;
                if (userEmail && authClient && typeof authClient.signInWithPassword === "function") {
                    try {
                        const { error: verifyError } = await authClient.signInWithPassword({
                            email: userEmail,
                            password: currentPassword
                        });
                        if (verifyError) {
                            const errMsg = (verifyError.message || "").toLowerCase();
                            if ((errMsg.includes("invalid") || errMsg.includes("credential")) && !knownCurrentPw) {
                                if (currentErr) currentErr.textContent = "Current password is incorrect.";
                                return;
                            }
                        }
                    } catch (e) {
                        console.warn("Supabase re-auth notice:", e);
                    }
                }

                if (authClient && typeof authClient.updateUser === "function") {
                    try {
                        await authClient.updateUser({ password: newPassword });
                    } catch (upErr) {
                        console.warn("Supabase updateUser notice:", upErr);
                    }
                }

                let regUpdated = false;
                regUsers.forEach(u => {
                    if ((userEmail && (u.email || "").toLowerCase() === userEmail) ||
                        (currentUser?.uid && String(u.id || "") === String(currentUser.uid))) {
                        u.password = newPassword;
                        regUpdated = true;
                    }
                });
                if (!regUpdated && userEmail) {
                    regUsers.push({
                        id: currentUser?.uid || "user_" + Date.now(),
                        email: userEmail,
                        name: currentUser?.fullName || "Manager",
                        role: currentUser?.role || "manager",
                        password: newPassword,
                        status: "active"
                    });
                }
                localStorage.setItem("rmims_registered_users", JSON.stringify(regUsers));
                window.dispatchEvent(new Event("rmims_registered_users_updated"));

                showToast("Password changed successfully.", "success");
                closeModal("changePasswordModal");
                modalForm.reset();

            } catch (err) {
                console.error(err);
                showToast("Unable to change password. Please check your information and try again.", "error");
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = original;
                }
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
        const authClient = supabase?.auth || auth?.auth || auth;
        if (authClient && typeof authClient.signOut === "function") {
            try {
                await authClient.signOut({ scope: "others" });
            } catch (soErr) {
                console.warn("Supabase signOut others warning:", soErr);
            }
        }
        try {
            localStorage.setItem("rmims_other_sessions_revoked", new Date().toISOString());
        } catch (_) {}
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
