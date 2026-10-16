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
            .select("id, full_name, email, role, status, created_at, updated_at")
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

        const role = (profile.role || "").toLowerCase();
        if (role === "admin") {
            window.location.href = "../admin/settings.html";
            return;
        }
        if (role === "manager") {
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
    const storedPhoto = localStorage.getItem(`rmims_user_avatar_${currentUser.uid}`);
    const avPreview = $("profileAvatarPreview");
    const topAv = $("topbarAvatar");

    if (storedPhoto) {
        if (avPreview) avPreview.innerHTML = `<img src="${storedPhoto}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"/>`;
        if (topAv) topAv.innerHTML = `<img src="${storedPhoto}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"/>`;
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
            reader.onload = (re) => {
                const dataUrl = re.target.result;
                if (currentUser) localStorage.setItem(`rmims_user_avatar_${currentUser.uid}`, dataUrl);
                loadProfilePhoto();
                showToast("Profile avatar updated.", "success");
            };
            reader.readAsDataURL(file);
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener("click", () => {
            if (currentUser) localStorage.removeItem(`rmims_user_avatar_${currentUser.uid}`);
            const avPreview = $("profileAvatarPreview");
            const topAv = $("topbarAvatar");
            if (avPreview) avPreview.innerHTML = initials(currentUser.fullName);
            if (topAv) topAv.innerHTML = initials(currentUser.fullName);
            showToast("Profile avatar removed.", "info");
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
            const orig = saveBtn.textContent;
            saveBtn.disabled = true;
            saveBtn.textContent = "Updating...";

            try {
                const { error: verifyError } = await auth.signInWithPassword({
                    email: currentUser.email,
                    password: currentPass
                });

                if (verifyError) {
                    if (currentErr) currentErr.textContent = "Current password is incorrect.";
                    return;
                }

                const { error: updateError } = await auth.updateUser({ password: newPass });
                if (updateError) throw updateError;

                showToast("Password updated successfully.", "success");
                directPasswordForm.reset();
            } catch (err) {
                showToast(err.message || "Unable to update password.", "error");
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = orig;
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
                const { error } = await auth.signOut({ scope: "others" });
                if (error) throw error;
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
