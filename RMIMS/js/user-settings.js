import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged, signOut } from "../supabase/auth-compat.js";

const $ = id => document.getElementById(id);
let currentUser = null;
let logoutInProgress = false;

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
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function initials(name) {
    if (!name) return "US";
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "US";
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
   ROLE GUARD & LOAD ACCOUNT
   ========================================================== */

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "../user-signin.html"; return; }

    try {
        const { data: profile, error } = await supabase
            .from("user_profiles")
            .select("id, full_name, email, role, status, created_at, updated_at")
            .eq("id", user.uid)
            .maybeSingle();

        if (error || !profile) { window.location.href = "../user-signin.html"; return; }
        if (profile.status !== "active") { window.location.href = "../user-signin.html"; return; }
        if (profile.role !== "user") { window.location.href = "../admin/dashboard.html"; return; }

        currentUser = {
            uid: user.uid,
            fullName: profile.full_name || "",
            email: profile.email || user.email || "",
            role: profile.role || "user",
            status: profile.status || "inactive"
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

        if ($("accountCreated")) $("accountCreated").textContent = fmtDate(profile.created_at);
        if ($("accountLastLogin")) $("accountLastLogin").textContent = fmtDateTime(profile.updated_at);

        loadSessionInfo();
        loadDataSummary();
    } catch (error) {
        console.error("Error loading user account:", error);
        window.location.href = "../user-signin.html";
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
        const [mRes, rRes, uRes] = await Promise.all([
            supabase.from("raw_materials").select("id", { count: "exact", head: true }),
            supabase.from("stock_receipts").select("id", { count: "exact", head: true }),
            supabase.from("material_disbursements").select("id", { count: "exact", head: true })
        ]);
        if ($("summaryMaterials")) $("summaryMaterials").textContent = mRes.count ?? 0;
        if ($("summaryStockReceipts")) $("summaryStockReceipts").textContent = rRes.count ?? 0;
        if ($("summaryUsageRecords")) $("summaryUsageRecords").textContent = uRes.count ?? 0;
    } catch (err) {
        console.error("Data summary load notice:", err);
    }
}

const createBackupBtn = $("createBackupBtn");
if (createBackupBtn) {
    createBackupBtn.addEventListener("click", async () => {
        showToast("Generating user activity backup…");
        try {
            const [uRes, rRes] = await Promise.all([
                supabase.from("material_disbursements").select("*"),
                supabase.from("stock_receipts").select("*")
            ]);
            const payload = {
                exportDate: new Date().toISOString(),
                user: currentUser?.email || "User",
                usageRecords: uRes.data || [],
                stockReceipts: rRes.data || []
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
        setTimeout(() => supabase.auth.signOut().then(() => window.location.href = "../user-signin.html"), 1200);
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
            await supabase.auth.signOut();
            window.location.href = "../user-signin.html";
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
