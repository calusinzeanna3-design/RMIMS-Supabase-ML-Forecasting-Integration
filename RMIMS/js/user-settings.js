import { auth, db } from "../supabase/supabase-config.js";
import { doc, getDoc, collection, getDocs } from "../supabase/db-compat.js";
import { onAuthStateChanged, signOut } from "../supabase/auth-compat.js";

const $ = id => document.getElementById(id);
let currentUser = null;
let logoutInProgress = false;

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
    if (!name) return "U";
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "U";
}

const toastStack = document.getElementById("toastStack");
function showToast(message, type = "success") {
    if (!toastStack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${message}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => {
        el.classList.add("leaving");
        setTimeout(() => el.remove(), 250);
    }, 3800);
}

function openModal(id) {
    const m = $(id);
    if (m) m.classList.add("open");
}

function closeModal(id) {
    const m = $(id);
    if (m) m.classList.remove("open");
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

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "../login.html"; return; }

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!userDoc.exists()) { window.location.href = "../login.html"; return; }

        const data = userDoc.data();
        if (data.status !== "active") { window.location.href = "../login.html"; return; }
        if (data.role !== "user") { window.location.href = "../admin/dashboard.html"; return; }

        currentUser = {
            uid: user.uid,
            fullName: data.fullName || "",
            email: data.email || user.email || "",
            role: data.role || "user",
            status: data.status || "inactive"
        };

        const profileBtn = $("profileBtn");
        if (profileBtn) {
            const pText = profileBtn.querySelector(".profile-text") || profileBtn;
            pText.textContent = `${currentUser.fullName} ▼`;
            const pAv = profileBtn.querySelector(".avatar");
            if (pAv) pAv.textContent = initials(currentUser.fullName);
        }

        if ($("fullName")) $("fullName").value = currentUser.fullName;
        if ($("email")) $("email").value = currentUser.email;
        if ($("role")) $("role").value = "Staff / User";

        const statusEl = $("accountStatus");
        if (statusEl) statusEl.textContent = currentUser.status === "active" ? "Active" : "Inactive";
        if ($("statusDot")) $("statusDot").classList.toggle("inactive", currentUser.status !== "active");

        if ($("accountCreated")) $("accountCreated").textContent = fmtDate(data.createdAt);
        if ($("accountLastLogin")) $("accountLastLogin").textContent = fmtDateTime(data.lastActivityAt);

        loadSessionInfo();
        loadDataSummary();
    } catch (error) {
        console.error("Error loading user account:", error);
    }
});

/* ==========================================================
   SESSIONS & DEVICES
   ========================================================== */

async function loadSessionInfo() {
    const el = $("sessionInfo");
    if (!el) return;
    try {
        const { data, error } = await auth.auth.getSession();
        if (error || !data.session) { el.textContent = "Session information unavailable."; return; }

        const signedInAt = data.session.user?.last_sign_in_at
            ? fmtDateTime(data.session.user.last_sign_in_at)
            : "Recently logged in";

        el.textContent = `Signed in since ${signedInAt} on this device.`;
    } catch (err) {
        console.error(err);
        el.textContent = "Session information unavailable.";
    }
}

const signOutOthersBtn = $("signOutOthersBtn");
if (signOutOthersBtn) {
    signOutOthersBtn.addEventListener("click", async () => {
        const original = signOutOthersBtn.textContent;
        signOutOthersBtn.disabled = true;
        signOutOthersBtn.textContent = "Signing Out…";
        try {
            const { error } = await auth.auth.signOut({ scope: "others" });
            if (error) throw error;
            showToast("Other sessions have been signed out.");
        } catch (err) {
            showToast(err.message || "Unable to sign out other sessions.", "error");
        } finally {
            signOutOthersBtn.disabled = false;
            signOutOthersBtn.textContent = original;
        }
    });
}

/* ==========================================================
   CHANGE PASSWORD MODAL
   ========================================================== */

const openChangePasswordBtn = $("openChangePasswordBtn");
if (openChangePasswordBtn) {
    openChangePasswordBtn.addEventListener("click", () => {
        const form = $("changePasswordForm");
        if (form) form.reset();
        ["currentPasswordError", "newPasswordError", "confirmNewPasswordError"].forEach(id => {
            if ($(id)) $(id).textContent = "";
        });
        openModal("changePasswordModal");
    });
}

const changePasswordForm = $("changePasswordForm");
if (changePasswordForm) {
    changePasswordForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentUser) return;

        const currentPassword = $("currentPassword").value;
        const newPassword = $("newPassword").value;
        const confirmNewPassword = $("confirmNewPassword").value;

        const currentErr = $("currentPasswordError");
        const newErr = $("newPasswordError");
        const confirmErr = $("confirmNewPasswordError");
        if (currentErr) currentErr.textContent = "";
        if (newErr) newErr.textContent = "";
        if (confirmErr) confirmErr.textContent = "";

        let hasError = false;
        if (!currentPassword) { if (currentErr) currentErr.textContent = "Current password is required."; hasError = true; }
        if (!newPassword || newPassword.length < 8) { if (newErr) newErr.textContent = "New password must be at least 8 characters."; hasError = true; }
        if (newPassword && currentPassword && newPassword === currentPassword) { if (newErr) newErr.textContent = "New password must be different from current password."; hasError = true; }
        if (!confirmNewPassword) { if (confirmErr) confirmErr.textContent = "Please confirm your new password."; hasError = true; }
        else if (newPassword !== confirmNewPassword) { if (confirmErr) confirmErr.textContent = "Passwords do not match."; hasError = true; }

        if (hasError) return;

        const btn = $("savePasswordBtn");
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Saving…";

        try {
            const { error: verifyError } = await auth.auth.signInWithPassword({
                email: currentUser.email,
                password: currentPassword
            });

            if (verifyError) {
                if (currentErr) currentErr.textContent = "Current password is incorrect.";
                return;
            }

            const { error: updateError } = await auth.auth.updateUser({ password: newPassword });
            if (updateError) throw updateError;

            showToast("Password updated successfully.");
            closeModal("changePasswordModal");
        } catch (err) {
            showToast(err.message || "Unable to update password.", "error");
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    });
}

/* ==========================================================
   DATA SUMMARY & BACKUP / RESTORE
   ========================================================== */

async function loadDataSummary() {
    try {
        const [mSnap, rSnap, uSnap] = await Promise.all([
            getDocs(collection(db, "materials")),
            getDocs(collection(db, "stockReceipts")),
            getDocs(collection(db, "usageRecords"))
        ]);
        if ($("summaryMaterials")) $("summaryMaterials").textContent = mSnap.docs.length;
        if ($("summaryStockReceipts")) $("summaryStockReceipts").textContent = rSnap.docs.length;
        if ($("summaryUsageRecords")) $("summaryUsageRecords").textContent = uSnap.docs.length;
    } catch (err) {
        console.error(err);
    }
}

const createBackupBtn = $("createBackupBtn");
if (createBackupBtn) {
    createBackupBtn.addEventListener("click", async () => {
        showToast("Generating user activity backup…");
        try {
            const [uSnap, rSnap] = await Promise.all([
                getDocs(collection(db, "usageRecords")),
                getDocs(collection(db, "stockReceipts"))
            ]);
            const payload = {
                exportDate: new Date().toISOString(),
                user: currentUser?.email || "User",
                usageRecords: uSnap.docs.map(d => ({ id: d.id, ...d.data() })),
                stockReceipts: rSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `RMIMS_User_Activity_Backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast("User activity backup file created successfully.");
        } catch (err) {
            showToast("Unable to generate backup.", "error");
        }
    });
}

/* ==========================================================
   DELETE ACCOUNT MODAL
   ========================================================== */

const openDeleteAccountBtn = $("openDeleteAccountBtn");
if (openDeleteAccountBtn) {
    openDeleteAccountBtn.addEventListener("click", () => {
        if ($("deleteConfirmText")) $("deleteConfirmText").value = "";
        openModal("deleteAccountModal");
    });
}

const confirmDeleteAccountBtn = $("confirmDeleteAccountBtn");
if (confirmDeleteAccountBtn) {
    confirmDeleteAccountBtn.addEventListener("click", async () => {
        const val = $("deleteConfirmText")?.value.trim();
        if (val !== "DELETE") {
            showToast("Please type DELETE to confirm.", "error");
            return;
        }
        showToast("Account deletion request submitted.");
        closeModal("deleteAccountModal");
        setTimeout(() => signOut(auth).then(() => window.location.href = "../login.html"), 1200);
    });
}

/* ==========================================================
   LOGOUT
   ========================================================== */

const logoutBtn = $("logoutBtn");
if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
        if (logoutInProgress) return;
        if (!confirm("Are you sure you want to log out of RMIMS?")) return;
        logoutInProgress = true;
        try {
            await signOut(auth);
            window.location.href = "../login.html";
        } catch (err) {
            logoutInProgress = false;
            showToast("Logout failed. Please try again.", "error");
        }
    });
}

/* ==========================================================
   SETTINGS NAVIGATION
   ========================================================== */

(function initSettingsNavigation() {
    const overview = document.getElementById('settings-overview');
    const views = [...document.querySelectorAll('.settings-detail-view')];
    if (!overview || !views.length) return;

    const valid = new Set(['account', 'security', 'sessions', 'data', 'system', 'danger']);
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
