// js/user-settings.js
//
// RMIMS USER — SETTINGS & PRIVACY
// Two-Panel Workspace UI inherited from Admin Settings design.
// Strictly User Scope & Permissions. Live Supabase Account Data. Pure Light UI.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged, signOut } from "../supabase/auth-compat.js";
import "./rmsme-shell.js";

const $ = id => document.getElementById(id);
let currentUser = null;

/* ==========================================================
   HELPERS & TOASTS
   ========================================================== */

const toastStack = $("toastStack");
function showToast(message, type = "success") {
    if (!toastStack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${message}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(8px)";
        setTimeout(() => el.remove(), 200);
    }, 3200);
}

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
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
}

function initials(name) {
    if (!name) return "U";
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "U";
}

function openModal(id) { $(id)?.classList.add("open"); }
function closeModal(id) { $(id)?.classList.remove("open"); }

document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
});

document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal(overlay.id);
    });
});

/* ==========================================================
   TWO-PANEL COMPILER NAVIGATION
   ========================================================== */

function initNav() {
    const navItems = document.querySelectorAll(".settings-nav-item");
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const navKey = item.dataset.nav;
            if (!navKey) return;
            switchSection(navKey);
        });
    });

    // Check URL parameters for section or tab
    const params = new URLSearchParams(window.location.search);
    let targetSection = params.get("section") || params.get("tab") || "profile";
    if (targetSection === "account") targetSection = "profile";
    if (targetSection === "password") targetSection = "security";
    switchSection(targetSection);

    window.addEventListener("popstate", () => {
        const p = new URLSearchParams(window.location.search);
        let s = p.get("section") || p.get("tab") || "profile";
        if (s === "account") s = "profile";
        if (s === "password") s = "security";
        switchSection(s);
    });
}

function switchSection(sectionKey) {
    const validSections = ["profile", "security", "sessions"];
    const target = validSections.includes(sectionKey) ? sectionKey : "profile";

    // Update left nav buttons
    document.querySelectorAll(".settings-nav-item").forEach(item => {
        if (item.dataset.nav === target) item.classList.add("active");
        else item.classList.remove("active");
    });

    // Update right views
    document.querySelectorAll(".settings-panel-view").forEach(view => {
        if (view.id === `view-${target}`) view.classList.add("active");
        else view.classList.remove("active");
    });

    // Update Breadcrumb
    const crumbEl = $("settingsCrumb");
    if (crumbEl) {
        const titles = {
            profile: "Profile",
            security: "Password & Security",
            sessions: "Sessions & Devices"
        };
        crumbEl.textContent = titles[target] || "Settings";
    }
}

function getLocalStaffUser() {
    try {
        const raw = localStorage.getItem("staffUser") ||
                    localStorage.getItem("currentUser") || 
                    localStorage.getItem("rmimsCurrentUser") || 
                    localStorage.getItem("userProfile");
        if (raw) {
            const u = JSON.parse(raw);
            if (u && typeof u === "object") {
                const role = (u.role || u.operationalRole || "").toLowerCase();
                const isManagerEmail = (u.email || "").toLowerCase().includes("manager@");
                const isAdminEmail = (u.email || "").toLowerCase().startsWith("admin");
                const isStaffRole = role === "user" || role === "staff";
                const uid = u.id || u.uid || "active-staff-session";
                let sName = isStaffRole ? (u.fullName || u.name || "Store Staff") : "Store Staff";
                if (sName.toLowerCase().includes("rafael") || sName.toLowerCase().includes("cruz")) {
                    sName = "Store Staff";
                }
                return {
                    uid,
                    fullName: sName,
                    email: u.email || "",
                    role: "user",
                    status: u.status || "active",
                    createdAt: u.createdAt || u.created_at || new Date().toISOString(),
                    updatedAt: u.updatedAt || u.updated_at || new Date().toISOString()
                };
            }
        }
    } catch (e) {
        console.warn("Could not read local staff session:", e);
    }

    return { redirect: "../login.html" };
}

let isStaffInitialized = false;

function applyStaffUser(userData) {
    if (!userData) return;
    if (userData.redirect) {
        window.location.href = userData.redirect;
        return;
    }
    currentUser = userData;

    // Populate Topbar Profile Button (preserve avatar and role elements)
    updateUserDisplay(currentUser.fullName);

    // Populate Form Fields
    if ($("fullName")) $("fullName").value = currentUser.fullName || "Store Staff";
    if ($("email")) $("email").value = currentUser.email || "";
    if ($("role")) $("role").value = "Staff Member";

    const statusEl = $("accountStatus");
    if (statusEl) statusEl.textContent = currentUser.status === "active" ? "Active" : "Inactive";
    if ($("statusDot")) $("statusDot").classList.toggle("inactive", currentUser.status !== "active");

    if ($("accountCreated")) $("accountCreated").textContent = fmtDate(currentUser.createdAt);
    if ($("accountLastLogin")) $("accountLastLogin").textContent = fmtDateTime(currentUser.updatedAt || currentUser.createdAt);

    loadProfilePhoto();
    loadSessionInfo();
    loadDataSummary();

    if (!isStaffInitialized) {
        isStaffInitialized = true;
        initNav();
        initActions();
    }
}

// Immediately check local staff session on page load so staff never sees a redirect
const immediateStaffUser = getLocalStaffUser();
if (immediateStaffUser) {
    if (immediateStaffUser.redirect) {
        window.location.href = immediateStaffUser.redirect;
    } else {
        applyStaffUser(immediateStaffUser);
    }
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        const local = getLocalStaffUser();
        if (local) {
            applyStaffUser(local);
            return;
        }
        window.location.href = "../login.html";
        return;
    }

    try {
        const { data: profile, error } = await supabase
            .from("user_profiles")
            .select("id, full_name, email, role, operational_role, status, created_at, updated_at")
            .eq("id", user.uid)
            .maybeSingle();

        if (error || !profile) {
            const local = getLocalStaffUser();
            if (local) {
                applyStaffUser(local);
                return;
            }
            window.location.href = "../login.html";
            return;
        }

        const rawOp = String(profile.operational_role || profile.operationalRole || '').toLowerCase();
        const rawRole = String(profile.role || '').toLowerCase();
        const isAdm = rawOp === 'admin' || rawRole === 'admin';
        const isMgr = !isAdm && (rawOp === 'manager' || rawRole === 'manager');

        if (isAdm) {
            window.location.href = "../admin/settings.html";
            return;
        }
        if (isMgr) {
            window.location.href = "../manager/settings.html";
            return;
        }

        if (profile.status !== "active") {
            window.location.href = "../login.html";
            return;
        }

        applyStaffUser({
            uid: user.uid,
            fullName: profile.full_name || "Store Staff",
            email: profile.email || user.email || "",
            role: "user",
            status: profile.status || "active",
            createdAt: profile.created_at,
            updatedAt: profile.updated_at
        });

    } catch (error) {
        console.error("Error loading user account:", error);
        const local = getLocalStaffUser();
        if (local) {
            applyStaffUser(local);
        } else {
            window.location.href = "../login.html";
        }
    }
});

function updateUserDisplay(name) {
    const displayName = name || "Store Staff";
    const profileBtn = $("profileBtn");
    if (profileBtn) {
        const nameEl = profileBtn.querySelector("[data-shell-name]") || profileBtn.querySelector(".profile-name");
        if (nameEl) nameEl.textContent = displayName;
        const roleEl = profileBtn.querySelector("[data-shell-role]") || profileBtn.querySelector(".profile-role");
        if (roleEl) roleEl.textContent = "Staff";
        const avEl = profileBtn.querySelector("[data-shell-avatar]") || profileBtn.querySelector(".profile-avatar") || $("topbarAvatar");
        if (avEl && !avEl.querySelector("img")) avEl.textContent = initials(displayName);
    }
    const avPreview = $("profileAvatarPreview");
    const topAv = $("topbarAvatar");
    const initStr = initials(displayName);
    if (avPreview && !avPreview.querySelector("img")) avPreview.textContent = initStr;
    if (topAv && !topAv.querySelector("img")) topAv.textContent = initStr;
}

/* ==========================================================
   PROFILE AVATAR HANDLING
   ========================================================== */

function loadProfilePhoto() {
    if (!currentUser) return;
    const cleanEmail = (currentUser.email || "").toLowerCase();
    const isRemoved = localStorage.getItem('rmims_avatar_removed') === 'true' ||
                      (cleanEmail && localStorage.getItem('rmims_avatar_removed_' + cleanEmail) === 'true');
    const storedPhoto = isRemoved ? "" : (localStorage.getItem("rmims_user_avatar") ||
                        localStorage.getItem(`rmims_avatar_${currentUser.uid}`) ||
                        localStorage.getItem(`rmims_user_avatar_${currentUser.uid}`) ||
                        currentUser.avatarUrl);
    const avPreview = $("profileAvatarPreview");
    const topAv = $("topbarAvatar") || document.getElementById("topbarProfileAvatar");

    if (storedPhoto) {
        if (avPreview) avPreview.innerHTML = `<img src="${storedPhoto}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;"/>`;
        if (topAv) topAv.innerHTML = `<img src="${storedPhoto}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;"/>`;
    } else {
        updateUserDisplay(currentUser.fullName);
    }
}

/* ==========================================================
   ACTIONS & FORM HANDLERS
   ========================================================== */

function initActions() {
    // Profile photo buttons
    const uploadBtn = $("uploadProfilePhotoBtn");
    const photoInput = $("profilePhotoInput");
    const removeBtn = $("removeProfilePhotoBtn");

    if (uploadBtn && photoInput) {
        uploadBtn.addEventListener("click", () => photoInput.click());
        photoInput.addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
                showToast("Image size must be less than 2MB.", "error");
                return;
            }
            const reader = new FileReader();
            reader.onload = async (re) => {
                const dataUrl = re.target.result;
                if (currentUser) {
                    const cleanEmail = (currentUser.email || "").toLowerCase();
                    localStorage.removeItem('rmims_avatar_removed');
                    if (cleanEmail) localStorage.removeItem('rmims_avatar_removed_' + cleanEmail);

                    currentUser.avatarUrl = dataUrl;
                    localStorage.setItem(`rmims_avatar_${currentUser.uid}`, dataUrl);
                    localStorage.setItem(`rmims_user_avatar_${currentUser.uid}`, dataUrl);
                    localStorage.setItem("rmims_user_avatar", dataUrl);
                    try {
                        const keys = ["currentUser", "rmimsCurrentUser", "userProfile", "staffUser", "managerUser"];
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
                loadProfilePhoto();
                document.querySelectorAll("[data-shell-avatar], #topbarProfileAvatar, #topbarAvatar").forEach(el => {
                    el.innerHTML = `<img src="${dataUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"/>`;
                    el.style.padding = '0';
                    el.style.overflow = 'hidden';
                });
                window.dispatchEvent(new CustomEvent("rmims_avatar_updated", { detail: { avatarUrl: dataUrl } }));
                showToast("Profile avatar updated.", "success");
            };
            reader.readAsDataURL(file);
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener("click", async () => {
            const cleanEmail = (currentUser?.email || "").toLowerCase();

            // Set permanent tombstone so avatar is never resurrected on refresh
            localStorage.setItem('rmims_avatar_removed', 'true');
            if (cleanEmail) localStorage.setItem('rmims_avatar_removed_' + cleanEmail, 'true');

            if (currentUser) {
                currentUser.avatarUrl = "";
                localStorage.removeItem(`rmims_avatar_${currentUser.uid}`);
                localStorage.removeItem(`rmims_user_avatar_${currentUser.uid}`);
            }
            localStorage.removeItem("rmims_user_avatar");
            localStorage.removeItem("rmims_manager_avatar");
            localStorage.removeItem("rmims_admin_avatar");

            // Scan and remove any dynamic rmims_avatar_ / rmims_user_avatar_ key
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

            try {
                const keys = ["currentUser", "rmimsCurrentUser", "userProfile", "staffUser", "managerUser", "adminUser"];
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
                if (currentUser?.uid && !currentUser.uid.startsWith("active-")) {
                    await supabase
                        .from("user_profiles")
                        .update({ avatar_url: null, updated_at: nowIso })
                        .eq("id", currentUser.uid);
                }
                if (cleanEmail) {
                    await supabase
                        .from("user_profiles")
                        .update({ avatar_url: null, updated_at: nowIso })
                        .eq("email", cleanEmail);
                }
                try {
                    const { data: { user: supaUser } } = await supabase.auth.getUser();
                    if (supaUser?.id) {
                        await supabase.from("user_profiles").update({ avatar_url: null, updated_at: nowIso }).eq("id", supaUser.id);
                    }
                } catch (_) {}
            } catch (dbErr) {
                console.warn("Supabase avatar removal warning:", dbErr);
            }

            const avPreview = $("profileAvatarPreview");
            const fallbackChar = initials(currentUser?.fullName || "Staff");
            if (avPreview) avPreview.innerHTML = fallbackChar;
            document.querySelectorAll("[data-shell-avatar], #topbarProfileAvatar, #topbarAvatar").forEach(el => {
                el.textContent = fallbackChar;
            });
            window.dispatchEvent(new CustomEvent("rmims_avatar_updated", { detail: { avatarUrl: "" } }));
            showToast("Profile avatar removed permanently.", "info");
        });
    }

    // Edit Profile Form
    const editProfileForm = $("editProfileForm");
    if (editProfileForm) {
        editProfileForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!currentUser) return;

            const nameInput = $("fullName");
            const nameErr = $("fullNameError");
            if (nameErr) nameErr.textContent = "";

            const newName = nameInput ? nameInput.value.trim() : "";
            if (!newName) {
                if (nameErr) nameErr.textContent = "Full name cannot be empty.";
                return;
            }

            // Security Gate 1: Verify legitimate registered email
            const cleanEmail = (currentUser.email || "").toLowerCase().trim();
            const LEGIT_EMAILS = [
                "zeannapatty@gmail.com",
                "zeannapatricia@gmail.com",
                "calusinzeanna3@gmail.com",
                "sconesandmuffins@gmail.com",
                "scone2@gmail.com"
            ];
            let isLegitEmail = LEGIT_EMAILS.includes(cleanEmail);
            if (!isLegitEmail && cleanEmail) {
                try {
                    const reg = JSON.parse(localStorage.getItem("rmims_registered_users") || "[]");
                    isLegitEmail = reg.some(u => u && (u.email || "").toLowerCase().trim() === cleanEmail && String(u.status || "").toLowerCase() === "active");
                } catch (_) {}
            }

            if (!cleanEmail || !isLegitEmail) {
                console.error("[Security] Blocked unauthorized profile alteration attempt from non-legit account:", cleanEmail);
                const userObjKeys = ["currentUser", "rmimsCurrentUser", "userProfile", "managerUser", "staffUser", "adminUser", "rmimsAdminUser"];
                userObjKeys.forEach(k => localStorage.removeItem(k));
                sessionStorage.clear();
                try { await supabase.auth.signOut(); } catch (_) {}
                alert("Security Alert: Unauthorized account session. Profile modification blocked.");
                window.location.replace("../login.html");
                return;
            }

            // Security Gate 2: Block unauthorized / zombie placeholder names
            const BANNED_INPUT_NAMES = ["manager", "user account", "user", "account", "unauthorized", "staff member", "staff user", "store manager", "admin", "administrator", "—", "-"];
            if (BANNED_INPUT_NAMES.includes(newName.toLowerCase())) {
                if (nameErr) nameErr.textContent = "Unauthorized name. Please enter your authentic registered name.";
                return;
            }

            const saveBtn = $("saveProfileChangesBtn");
            const orig = saveBtn.textContent;
            saveBtn.disabled = true;
            saveBtn.textContent = "Saving...";

            try {
                try {
                    const { error } = await supabase
                        .from("user_profiles")
                        .update({ full_name: newName, updated_at: new Date().toISOString() })
                        .eq("id", currentUser.uid);
                    if (error) console.warn("Supabase update error:", error);
                } catch (dbErr) {
                    console.warn("Supabase profile update warning:", dbErr);
                }

                currentUser.fullName = newName;

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

                updateUserDisplay(newName);
                showToast("Profile changes saved successfully.", "success");
            } catch (err) {
                console.error("Profile update error:", err);
                showToast(err.message || "Failed to update profile.", "error");
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = orig;
            }
        });
    }

    // Direct Change Password Form
    const directPasswordForm = $("directChangePasswordForm");
    if (directPasswordForm) {
        directPasswordForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!currentUser) return;

            const currentPass = $("directCurrentPassword")?.value || "";
            const newPass = $("directNewPassword")?.value || "";
            const confirmPass = $("directConfirmPassword")?.value || "";

            const currentErr = $("directCurrentPasswordError");
            const newErr = $("directNewPasswordError");
            const confirmErr = $("directConfirmPasswordError");

            if (currentErr) currentErr.textContent = "";
            if (newErr) newErr.textContent = "";
            if (confirmErr) confirmErr.textContent = "";

            let hasError = false;
            if (!currentPass) { if (currentErr) currentErr.textContent = "Current password is required."; hasError = true; }
            if (!newPass || newPass.length < 8) { if (newErr) newErr.textContent = "New password must be at least 8 characters."; hasError = true; }
            if (newPass && currentPass && newPass === currentPass) { if (newErr) newErr.textContent = "New password must be different from current password."; hasError = true; }
            if (!confirmPass) { if (confirmErr) confirmErr.textContent = "Please confirm your new password."; hasError = true; }
            else if (newPass !== confirmPass) { if (confirmErr) confirmErr.textContent = "Passwords do not match."; hasError = true; }

            if (hasError) return;

            const saveBtn = $("directSavePasswordBtn");
            const orig = saveBtn ? saveBtn.textContent : "Update Password";
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = "Updating...";
            }

            try {
                // 1. Resolve Staff Email
                let userEmail = (currentUser?.email || "").trim().toLowerCase();
                if (!userEmail) {
                    userEmail = ($("email")?.value || "").trim().toLowerCase();
                }
                if (!userEmail) {
                    const keys = ["staffUser", "currentUser", "rmimsCurrentUser", "userProfile"];
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

                // 2. Check local registered users & branch stores
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
                            const list = [...(st.staff || []), ...(st.managers || [])];
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

                const knownCurrentPw = localUser?.password || storeUser?.password;
                if (knownCurrentPw && knownCurrentPw !== currentPass) {
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
                            password: currentPass
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
                        await authClient.updateUser({ password: newPass });
                    } catch (upErr) {
                        console.warn("Supabase updateUser notice:", upErr);
                    }
                }

                // 4. Update in rmims_registered_users (CONFIDENTIALITY: NEVER store plaintext password in localStorage)
                let regUpdated = false;
                regUsers.forEach(u => {
                    if (u && u.password !== undefined) delete u.password;
                    if ((userEmail && (u.email || "").toLowerCase() === userEmail) ||
                        (currentUser?.uid && String(u.id || "") === String(currentUser.uid)) ||
                        (currentUser?.fullName && (u.name || "").toLowerCase() === currentUser.fullName.toLowerCase())) {
                        regUpdated = true;
                    }
                });
                if (!regUpdated && userEmail) {
                    regUsers.push({
                        id: currentUser?.uid || "user_" + Date.now(),
                        email: userEmail,
                        name: currentUser?.fullName || "Staff_1",
                        role: "user",
                        status: "active"
                    });
                }
                localStorage.setItem("rmims_registered_users", JSON.stringify(regUsers));
                window.dispatchEvent(new Event("rmims_registered_users_updated"));

                // 5. Update in RMIMS_BRANCH_STORES_V3 (CONFIDENTIALITY: Scrub passwords from local store records)
                try {
                    const rawStores = localStorage.getItem("RMIMS_BRANCH_STORES_V3");
                    if (rawStores) {
                        const stores = JSON.parse(rawStores);
                        const storeList = Array.isArray(stores) ? stores : Object.values(stores);
                        storeList.forEach(st => {
                            const list = [...(st.staff || []), ...(st.managers || [])];
                            list.forEach(p => {
                                if (p && p.password !== undefined) delete p.password;
                            });
                        });
                        localStorage.setItem("RMIMS_BRANCH_STORES_V3", JSON.stringify(stores));
                    }
                } catch (_) {}

                // Clear password input fields immediately from DOM
                const curPwEl = $("currentPassword");
                const newPwEl = $("newPassword");
                const confPwEl = $("confirmPassword");
                if (curPwEl) curPwEl.value = "";
                if (newPwEl) newPwEl.value = "";
                if (confPwEl) confPwEl.value = "";

                // 6. Update staffUser / currentUser timestamps
                try {
                    const keys = ["staffUser", "currentUser", "rmimsCurrentUser", "userProfile"];
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
                directPasswordForm.reset();
            } catch (err) {
                console.error("Staff password change error:", err);
                showToast("Unable to change password. Please check your information and try again.", "error");
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = orig;
                }
            }
        });
    }

    // Logout Button
    const logoutBtn = $("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            try {
                localStorage.removeItem("currentUser");
                localStorage.removeItem("rmimsCurrentUser");
                sessionStorage.clear();
                await signOut(auth);
                window.location.href = "../login.html";
            } catch (e) {
                window.location.href = "../login.html";
            }
        });
    }

    // Sign out other sessions
    const signOutOthersBtn = $("signOutOthersBtn");
    if (signOutOthersBtn) {
        signOutOthersBtn.addEventListener("click", async () => {
            const original = signOutOthersBtn.textContent;
            signOutOthersBtn.disabled = true;
            signOutOthersBtn.textContent = "Signing Out…";
            try {
                const authClient = supabase?.auth || auth?.auth || auth;
                if (authClient && typeof authClient.signOut === "function") {
                    try {
                        await authClient.signOut({ scope: "others" });
                    } catch (e) {
                        console.warn("SignOut others warning:", e);
                    }
                }
                try {
                    localStorage.setItem("rmims_other_sessions_revoked", new Date().toISOString());
                } catch (_) {}
                showToast("Other device sessions have been revoked.", "success");
            } catch (err) {
                showToast(err.message || "Unable to sign out other sessions.", "error");
            } finally {
                signOutOthersBtn.disabled = false;
                signOutOthersBtn.textContent = original;
            }
        });
    }

    // Create Backup Button
    const createBackupBtn = $("createBackupBtn");
    if (createBackupBtn) {
        createBackupBtn.addEventListener("click", async () => {
            showToast("Generating user activity backup…", "info");
            try {
                const [uRes, rRes] = await Promise.all([
                    supabase.from("material_disbursements").select("*"),
                    supabase.from("stock_receipts").select("*")
                ]);

                const backupData = {
                    version: "2.0",
                    exportedAt: new Date().toISOString(),
                    exportedBy: currentUser ? currentUser.email : "user",
                    receipts: rRes.data || [],
                    disbursements: uRes.data || []
                };

                const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `RMIMS_User_Activity_Backup_${new Date().toISOString().slice(0, 10)}.json`;
                link.click();
                showToast("Activity backup downloaded successfully.", "success");
            } catch (err) {
                showToast("Failed to generate backup: " + err.message, "error");
            }
        });
    }

    // Restore Backup Button
    const openRestoreBtn = $("openRestoreBtn");
    const restoreFileInput = $("restoreFileInput");
    if (openRestoreBtn && restoreFileInput) {
        openRestoreBtn.addEventListener("click", () => restoreFileInput.click());
        restoreFileInput.addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                try {
                    const parsed = JSON.parse(re.target.result);
                    if (parsed.receipts && parsed.disbursements) {
                        showToast(`Backup verified: ${parsed.receipts.length} receipts and ${parsed.disbursements.length} disbursements found.`, "success");
                    } else {
                        showToast("Invalid RMSME activity backup file format.", "error");
                    }
                } catch (_) {
                    showToast("Could not parse the selected backup file.", "error");
                }
            };
            reader.readAsText(file);
        });
    }

    // Delete Account Modal Trigger
    const openDeleteBtn = $("openDeleteAccountBtn");
    if (openDeleteBtn) {
        openDeleteBtn.addEventListener("click", () => {
            const confirmInput = $("deleteConfirmText");
            if (confirmInput) confirmInput.value = "";
            openModal("deleteAccountModal");
        });
    }

    // Confirm Delete Account
    const confirmDeleteBtn = $("confirmDeleteAccountBtn");
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener("click", async () => {
            const confirmInput = $("deleteConfirmText");
            if (!confirmInput || confirmInput.value.trim() !== "DELETE") {
                showToast("Please type DELETE to confirm account deactivation.", "error");
                return;
            }

            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.textContent = "Deactivating...";

            try {
                if (currentUser) {
                    await supabase
                        .from("user_profiles")
                        .update({ status: "inactive", updated_at: new Date().toISOString() })
                        .eq("id", currentUser.uid);
                }
                localStorage.removeItem("currentUser");
                localStorage.removeItem("rmimsCurrentUser");
                sessionStorage.clear();
                await signOut(auth);
                window.location.href = "../login.html";
            } catch (err) {
                showToast(err.message || "Failed to deactive account.", "error");
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.textContent = "Confirm Deletion";
            }
        });
    }
}

/* ==========================================================
   DATA SUMMARY & SESSIONS LOAD
   ========================================================== */

async function loadSessionInfo() {
    const el = $("sessionInfo");
    if (!el) return;
    try {
        const { data, error } = await auth.getSession();
        if (error || !data.session) { el.textContent = "Session active on current device."; return; }

        const signedInAt = data.session.user?.last_sign_in_at
            ? fmtDateTime(data.session.user.last_sign_in_at)
            : "Recently signed in";

        el.textContent = `Signed in since ${signedInAt} on this device.`;
    } catch (_) {
        el.textContent = "Session active on current device.";
    }
}

async function loadDataSummary() {
    try {
        const [mRes, rRes, uRes] = await Promise.all([
            supabase.from("raw_materials").select("id", { count: "exact", head: true }),
            supabase.from("stock_receipts").select("id", { count: "exact", head: true }),
            supabase.from("material_disbursements").select("id", { count: "exact", head: true })
        ]);
        if ($("summaryMaterials")) $("summaryMaterials").textContent = mRes.count ?? 0;
        if ($("summaryStockReceipts")) $("summaryStockReceipts").textContent = rRes.count ?? 0;
        if ($("summaryUsageRecords")) $("summaryUsageRecords").textContent = uRes.count ?? 0;
    } catch (err) {
        console.warn("Data summary load notice:", err);
    }
}
