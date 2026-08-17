// js/settings.js
//
// Admin Settings — Account / Security / Danger Zone.
//
// SECURITY NOTE: every guard in this file (last-active-admin
// protection, confirmation text, etc.) is UI-level convenience
// only. The real enforcement lives in
// supabase/settings-schema.sql (trg_prevent_last_admin_deletion,
// delete_own_account()) and supabase/user-management-schema.sql
// (trg_prevent_last_admin_removal). A button being hidden or
// disabled here never substitutes for that.

import { auth, db } from "../supabase/supabase-config.js";
import { doc, getDoc, collection, getDocs } from "../supabase/db-compat.js";
import { onAuthStateChanged, signOut } from "../supabase/auth-compat.js";
import { initBackupRestore, loadDataSummary as reloadDataSummary } from "./backup-restore.js";
import { initDataReset } from "./data-reset.js";

/* ==========================================================
   STATE
   ========================================================== */

let currentUser = null; // { uid, fullName, email, role, status }

/* ==========================================================
   HELPERS
   ========================================================== */

function fmtDate(ts) {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(ts) {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
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
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span></span>`;
    el.querySelector("span:last-child").textContent = message;
    toastStack.appendChild(el);
    setTimeout(() => {
        el.classList.add("leaving");
        setTimeout(() => el.remove(), 250);
    }, 3800);
}

/* ==========================================================
   MODAL HELPERS
   ========================================================== */

function openModal(id) {
    document.getElementById(id).classList.add("open");
}

function closeModal(id) {
    document.getElementById(id).classList.remove("open");
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
   ROLE GUARD + LOAD USER INFORMATION
   ========================================================== */

const profileBtn = document.getElementById("profileBtn");

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "../login.html"; return; }

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));

        if (!userDoc.exists()) { window.location.href = "../login.html"; return; }

        const data = userDoc.data();

        if (data.status !== "active") { window.location.href = "../login.html"; return; }
        if (data.role !== "admin") { window.location.href = "../user/dashboard.html"; return; }

        currentUser = {
            uid: user.uid,
            fullName: data.fullName || "",
            email: data.email || user.email || "",
            role: data.role || "user",
            status: data.status || "inactive"
        };

        if (profileBtn) {
            const pText = profileBtn.querySelector(".profile-text") || profileBtn;
            pText.textContent = `${currentUser.fullName} ▼`;
            const pAv = profileBtn.querySelector(".avatar");
            if (pAv) pAv.textContent = initials(currentUser.fullName);
        }

        document.getElementById("fullName").value = currentUser.fullName;
        document.getElementById("email").value = currentUser.email;
        document.getElementById("role").value = currentUser.role === "admin" ? "Admin" : "Staff / User";

        const statusEl = document.getElementById("accountStatus");
        statusEl.textContent = currentUser.status === "active" ? "Active" : "Inactive";
        document.getElementById("statusDot").classList.toggle("inactive", currentUser.status !== "active");

        document.getElementById("accountCreated").textContent = fmtDate(data.createdAt);
        document.getElementById("accountLastLogin").textContent = fmtDateTime(data.lastActivityAt);

        loadSessionInfo();

        initBackupRestore({ uid: currentUser.uid, fullName: currentUser.fullName, email: currentUser.email });
        initDataReset(reloadDataSummary);

    } catch (error) {
        console.error("Error loading account:", error);
        showToast("Unable to load account information. Please try again.", "error");
    }
});

/* ==========================================================
   SECURITY — CURRENT SESSION
   ========================================================== */

async function loadSessionInfo() {
    const el = document.getElementById("sessionInfo");
    try {
        const { data, error } = await auth.auth.getSession();
        if (error || !data.session) { el.textContent = "Session information unavailable."; return; }

        const signedInAt = data.session.user?.last_sign_in_at
            ? fmtDateTime(data.session.user.last_sign_in_at)
            : "—";

        el.textContent = `Signed in since ${signedInAt} on this device.`;
    } catch (err) {
        console.error(err);
        el.textContent = "Session information unavailable.";
    }
}

document.getElementById("signOutOthersBtn").addEventListener("click", async () => {
    const btn = document.getElementById("signOutOthersBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Signing Out…";
    try {
        const { error } = await auth.auth.signOut({ scope: "others" });
        if (error) throw error;
        showToast("Other sessions have been signed out.");
    } catch (err) {
        showToast(friendlyError(err, "Unable to sign out other sessions. Please try again."), "error");
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
});

/* ==========================================================
   CHANGE PASSWORD
   ========================================================== */

document.getElementById("openChangePasswordBtn").addEventListener("click", () => {
    document.getElementById("changePasswordForm").reset();
    ["currentPasswordError", "newPasswordError", "confirmNewPasswordError"].forEach(id => {
        document.getElementById(id).textContent = "";
    });
    openModal("changePasswordModal");
});

document.getElementById("changePasswordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmNewPassword = document.getElementById("confirmNewPassword").value;

    const currentErr = document.getElementById("currentPasswordError");
    const newErr = document.getElementById("newPasswordError");
    const confirmErr = document.getElementById("confirmNewPasswordError");
    currentErr.textContent = "";
    newErr.textContent = "";
    confirmErr.textContent = "";

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
        // Re-authenticate with the current password to verify it before
        // changing anything — Supabase Auth has no separate
        // "verify current password" endpoint.
        const { error: verifyError } = await auth.auth.signInWithPassword({
            email: currentUser.email,
            password: currentPassword
        });

        if (verifyError) {
            currentErr.textContent = "Current password is incorrect.";
            return;
        }

        const { error: updateError } = await auth.auth.updateUser({ password: newPassword });
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

/* ==========================================================
   LOGOUT
   ========================================================== */

document.getElementById("logoutBtn").addEventListener("click", async () => {
    const confirmLogout = confirm("Are you sure you want to logout?");
    if (!confirmLogout) return;

    try {
        await signOut(auth);
        window.location.href = "../login.html";
    } catch (error) {
        console.error("Logout Error:", error);
        showToast("Unable to sign out. Please try again.", "error");
    }
});

/* ==========================================================
   DANGER ZONE — DELETE MY ACCOUNT
   ========================================================== */

document.getElementById("openDeleteAccountBtn").addEventListener("click", async () => {
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
        confirmInput.value = "";

        let isLastActiveAdmin = false;

        if (currentUser.role === "admin" && currentUser.status === "active") {
            const snap = await getDocs(collection(db, "users"));
            const otherActiveAdmins = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(u => u.id !== currentUser.uid && u.role === "admin" && u.status === "active");
            isLastActiveAdmin = otherActiveAdmins.length === 0;
        }

        blockedNote.style.display = isLastActiveAdmin ? "block" : "none";
        confirmFields.style.display = isLastActiveAdmin ? "none" : "block";
        confirmBtn.style.display = isLastActiveAdmin ? "none" : "inline-block";

        openModal("deleteAccountModal");

    } catch (err) {
        showToast(friendlyError(err, "Unable to check account status. Please try again."), "error");
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
});

document.getElementById("confirmDeleteAccountBtn").addEventListener("click", async () => {
    const confirmInput = document.getElementById("deleteConfirmText");
    if (confirmInput.value.trim() !== "DELETE") {
        showToast('Type "DELETE" to confirm.', "error");
        return;
    }

    const btn = document.getElementById("confirmDeleteAccountBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Deleting…";

    try {
        // Backend RPC — verifies last-active-admin protection again at
        // the database level (see supabase/settings-schema.sql) before
        // deleting the auth account. This is the only real enforcement.
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

/* ==========================================================
   SETTINGS NAVIGATION — dedicated page-style views
   ========================================================== */
(function initSettingsNavigation() {
    const overview = document.getElementById('settings-overview');
    const views = [...document.querySelectorAll('.settings-detail-view')];
    if (!overview || !views.length) return;

    const valid = new Set(['account', 'system', 'data', 'security', 'danger', 'sessions']);
    function showView(section) {
        const target = valid.has(section) ? section : null;
        overview.style.display = target ? 'none' : '';
        views.forEach(v => { v.style.display = v.dataset.settingsView === target ? '' : 'none'; });
        const crumb = document.querySelector('.crumb-active');
        if (crumb) crumb.textContent = target ? (target === 'sessions' ? 'Sessions & Devices' : target[0].toUpperCase() + target.slice(1)) : 'Settings';
        window.scrollTo(0, 0);
    }
    function readSection() {
        const params = new URLSearchParams(window.location.search);
        return params.get('section') || '';
    }
    showView(readSection());
    document.querySelectorAll('[data-settings-link]').forEach(link => {
        link.addEventListener('click', (e) => {
            const section = link.dataset.settingsLink;
            if (!valid.has(section)) return;
            e.preventDefault();
            const url = new URL(window.location.href);
            url.searchParams.set('section', section);
            history.pushState({ section }, '', url);
            showView(section);
        });
    });
    window.addEventListener('popstate', () => showView(readSection()));
    document.querySelectorAll('.settings-back-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const url = new URL(window.location.href);
            url.searchParams.delete('section');
            history.pushState({}, '', url);
            showView('');
        });
    });
})();
