// js/user-management.js
//
// Admin — User Management. Manages ACCOUNT / ACCESS / ROLE / STATUS /
// ACCOUNT DELETION REQUESTS only. Deliberately does not touch
// inventory, material activity, analytics, forecasting, or reports —
// see the scope notes at the top of the spec this implements.
//
// SECURITY NOTE: every guard in this file (last-active-admin
// protection, self-deactivation, role-change confirmation, etc.) is
// UI-level convenience only. The real enforcement lives in
// supabase/user-management-schema.sql (trg_prevent_last_admin_removal)
// and in the existing RLS policies from schema.sql, which restrict
// writes on public.users to the row owner or an active admin. A
// button being hidden here never substitutes for that.

import { auth, db, SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabase/supabase-config.js";
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, query, where, serverTimestamp } from "../supabase/db-compat.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ==========================================================
   ROLE GUARD
   ========================================================== */

let currentUser = null; // { uid, fullName, role }

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "../login.html"; return; }

    const snap = await getDocs(collection(db, "users"));
    const profile = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(u => u.id === user.uid);

    if (!profile || profile.status !== "active") { window.location.href = "../login.html"; return; }
    if (profile.role !== "admin") { window.location.href = "../user/dashboard.html"; return; }

    currentUser = { uid: user.uid, fullName: profile.fullName, role: profile.role, email: profile.email || user.email || "" };
    // The shared RMSME shell owns the visible profile/header. Keep its identity source in sync.
    try {
        localStorage.setItem("rmsmeCurrentUser", JSON.stringify({
            fullName: profile.fullName || "Account",
            email: profile.email || user.email || ""
        }));
    } catch (e) { /* non-blocking */ }
    document.querySelectorAll("[data-shell-name]").forEach(el => el.textContent = profile.fullName || "Account");
    document.querySelectorAll("[data-shell-email]").forEach(el => el.textContent = profile.email || user.email || "");
    document.querySelectorAll("[data-shell-avatar]").forEach(el => el.textContent = initials(profile.fullName));

    init();
});

function initials(name) {
    if (!name) return "AU";
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "AU";
}

/* ==========================================================
   STATE
   ========================================================== */

let users = [];
let dataLoaded = false;

const tableState = { search: "", status: "all", role: "all", page: 1, pageSize: 8, sortBy: "createdAt", sortDir: "desc" };

/* ==========================================================
   HELPERS
   ========================================================== */

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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

function millisOf(ts) {
    if (!ts) return 0;
    return ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
}

function roleLabel(role) { return role === "admin" ? "Admin" : "User"; }

const toastStack = document.getElementById("toastStack");
function showToast(message, type = "success") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 260); }, 3600);
}

function friendlyError(err, fallback) {
    console.error(err);
    if (err && typeof err.message === "string" && err.message.includes("At least one active Admin")) {
        return "At least one active Admin account must remain.";
    }
    return fallback;
}

/* ==========================================================
   DATA LOAD
   ========================================================== */

async function loadUsers() {
    const snap = await getDocs(collection(db, "users"));
    users = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt));
    dataLoaded = true;
}

async function refreshAll() {
    await loadUsers();
    renderSummary();
    renderTable();
}

/* ==========================================================
   DERIVED HELPERS
   ========================================================== */

function activeAdminCount(excludeId) {
    return users.filter(u => u.role === "admin" && u.status === "active" && u.id !== excludeId).length;
}

function findByEmail(email) {
    return users.find(u => (u.email || "").toLowerCase() === email.toLowerCase());
}

/* ==========================================================
   REFRESH BUTTON
   ========================================================== */

const refreshBtn = document.getElementById("refreshBtn");
const refreshIcon = document.getElementById("refreshIcon");
const refreshLabel = document.getElementById("refreshLabel");

refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.classList.add("spinning");
    refreshLabel.textContent = "Refreshing...";
    try {
        await refreshAll();
        showToast("User data refreshed successfully.");
    } catch (err) {
        console.error(err);
        showToast("Unable to refresh user data. Please try again.", "error");
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove("spinning");
        refreshLabel.textContent = "Refresh";
    }
});

/* ==========================================================
   SUMMARY CARDS
   ========================================================== */

function renderSummary() {
    const total = users.length;
    const active = users.filter(u => u.status === "active").length;
    const inactive = users.filter(u => u.status === "inactive").length;
    const pending = users.filter(u => u.deletionRequestStatus === "pending").length;

    document.getElementById("statTotal").textContent = total;
    document.getElementById("statActive").textContent = active;
    document.getElementById("statInactive").textContent = inactive;
    document.getElementById("statDeletion").textContent = pending;

    const adminCount = users.filter(u => u.role === "admin").length;
    const userCount = users.filter(u => u.role !== "admin").length;
    document.getElementById("roleAdminCount").textContent = adminCount;
    document.getElementById("roleUserCount").textContent = userCount;
    document.getElementById("roleAdminPlural").textContent = adminCount === 1 ? "" : "s";
    document.getElementById("roleUserPlural").textContent = userCount === 1 ? "" : "s";

    const sub = document.getElementById("statDeletionSub");
    const card = document.getElementById("deletionCard");
    if (pending > 0) {
        sub.textContent = `${pending} Pending`;
        card.classList.add("has-pending");
    } else {
        sub.textContent = "No pending requests";
        card.classList.remove("has-pending");
    }
}

/* ==========================================================
   SEARCH / FILTERS
   ========================================================== */

document.getElementById("searchInput")?.addEventListener("input", (e) => {
    tableState.search = e.target.value;
    tableState.page = 1;
    renderTable();
});
document.getElementById("statusFilter")?.addEventListener("change", (e) => {
    tableState.status = e.target.value;
    tableState.page = 1;
    renderTable();
});
document.getElementById("roleFilter")?.addEventListener("change", (e) => {
    tableState.role = e.target.value;
    tableState.page = 1;
    renderTable();
});

function applyUserFilter(status = "all") {
    tableState.status = status;
    tableState.page = 1;
    document.getElementById("statusFilter").value = status;
    renderTable();
}

function clearUserFilters() {
    tableState.search = "";
    tableState.status = "all";
    tableState.role = "all";
    tableState.page = 1;
    document.getElementById("searchInput").value = "";
    document.getElementById("statusFilter").value = "all";
    document.getElementById("roleFilter").value = "all";
    renderTable();
}

document.getElementById("clearUserFilters")?.addEventListener("click", clearUserFilters);
document.querySelectorAll(".card-filter").forEach(card => {
    const activate = () => applyUserFilter(card.dataset.summaryFilter || "all");
    card.addEventListener("click", activate);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });
});

document.querySelectorAll(".sort-button").forEach(btn => {
    btn.addEventListener("click", () => {
        const key = btn.dataset.sort;
        if (tableState.sortBy === key) tableState.sortDir = tableState.sortDir === "asc" ? "desc" : "asc";
        else { tableState.sortBy = key; tableState.sortDir = key === "createdAt" || key === "lastActivityAt" ? "desc" : "asc"; }
        tableState.page = 1;
        renderTable();
    });
});

function filteredUsers() {
    const term = tableState.search.trim().toLowerCase();
    const rows = users.filter(u => {
        if (term) {
            const hay = `${u.fullName || ""} ${u.email || ""}`.toLowerCase();
            if (!hay.includes(term)) return false;
        }
        if (tableState.status === "active" && u.status !== "active") return false;
        if (tableState.status === "inactive" && u.status !== "inactive") return false;
        if (tableState.status === "deletion" && u.deletionRequestStatus !== "pending") return false;
        if (tableState.role !== "all" && u.role !== tableState.role) return false;
        return true;
    });

    const valueOf = (u, key) => {
        if (["createdAt", "lastActivityAt"].includes(key)) return millisOf(u[key]);
        if (key === "role") return roleLabel(u.role).toLowerCase();
        if (key === "status") return `${u.status || ""} ${u.deletionRequestStatus || ""}`.toLowerCase();
        return String(u[key] || "").toLowerCase();
    };
    rows.sort((a, b) => {
        const av = valueOf(a, tableState.sortBy), bv = valueOf(b, tableState.sortBy);
        if (av < bv) return tableState.sortDir === "asc" ? -1 : 1;
        if (av > bv) return tableState.sortDir === "asc" ? 1 : -1;
        return 0;
    });
    return rows;
}

/* ==========================================================
   TABLE RENDER
   ========================================================== */

function paginate(rows, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return { pageRows: rows.slice(start, start + pageSize), page: safePage, totalPages };
}

function renderTable() {
    const body = document.getElementById("userTableBody");
    const rows = filteredUsers();

    document.getElementById("tableCount").textContent = `${rows.length} account${rows.length === 1 ? "" : "s"}`;

    const hasActiveFilters = tableState.search.trim() || tableState.status !== "all" || tableState.role !== "all";
    const clearFilters = document.getElementById("clearUserFilters");
    if (clearFilters) clearFilters.hidden = !hasActiveFilters;
    document.querySelectorAll(".sort-button").forEach(btn => {
        const span = btn.querySelector("span");
        const active = btn.dataset.sort === tableState.sortBy;
        btn.classList.toggle("active", active);
        if (span) span.textContent = active ? (tableState.sortDir === "asc" ? "↑" : "↓") : "↕";
    });

    if (!dataLoaded) {
        body.innerHTML = `<tr class="empty-row"><td colspan="4">Loading users...</td></tr>`;
        document.getElementById("tablePagination").innerHTML = "";
        return;
    }

    if (users.length === 0) {
        body.innerHTML = `<tr class="empty-row"><td colspan="4">No users have been added yet.</td></tr>`;
        document.getElementById("tablePagination").innerHTML = "";
        return;
    }

    if (rows.length === 0) {
        const hasFilters = tableState.status !== "all" || tableState.role !== "all";
        const hasSearch = tableState.search.trim().length > 0;
        const message = hasSearch ? "No users found." : hasFilters ? "No users match the selected filters." : "No users found.";
        body.innerHTML = `<tr class="empty-row"><td colspan="4">
            <p>${message}</p>
            ${hasSearch ? '<button type="button" class="btn-outline-sm" id="clearSearchBtn">Clear Search</button>' : ""}
        </td></tr>`;
        document.getElementById("tablePagination").innerHTML = "";
        const clearBtn = document.getElementById("clearSearchBtn");
        if (clearBtn) clearBtn.addEventListener("click", () => {
            document.getElementById("searchInput").value = "";
            tableState.search = "";
            renderTable();
        });
        return;
    }

    const { pageRows, page, totalPages } = paginate(rows, tableState.page, tableState.pageSize);
    tableState.page = page;

    body.innerHTML = pageRows.map(u => {
        const isSelf = u.id === currentUser.uid;
        const pending = u.deletionRequestStatus === "pending";

        return `<tr data-id="${u.id}">
            <td>
                <div class="name-cell">
                    <span class="name-avatar">${initials(u.fullName)}</span>
                    <div class="name-details">
                        <span class="name-primary">${escapeHtml(u.fullName || "—")}${isSelf ? '<span class="name-you">You</span>' : ""}</span>
                        <span class="name-email">${escapeHtml(u.email || "—")}</span>
                    </div>
                </div>
            </td>
            <td><span class="role ${u.role === "admin" ? "admin" : "user"}">${roleLabel(u.role)}</span></td>
            <td>
                <div class="status-stack">
                    <span class="status ${u.status === "active" ? "active" : "inactive"}">${u.status === "active" ? "Active" : "Inactive"}</span>
                    ${pending ? '<span class="status pending">Deletion Requested</span>' : ""}
                </div>
            </td>
            <td class="actions-cell">
                <div class="row-actions">
                    <button type="button" class="row-action view" data-view-user="${u.id}" aria-label="View ${escapeHtml(u.fullName || "user")}">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12S6 6.5 12 6.5S21.5 12 21.5 12S18 17.5 12 17.5S2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.7"/></svg>
                        <span>View</span>
                    </button>
                    <button type="button" class="row-action role-action" data-change-role="${u.id}" aria-label="Change role for ${escapeHtml(u.fullName || "user")}" ${isSelf ? "disabled title=\"You cannot change your own role.\"" : ""}>
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3L19 6V11C19 15.5 16.2 19.1 12 21C7.8 19.1 5 15.5 5 11V6L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <span>Change Role</span>
                    </button>
                    <button type="button" class="row-action reset" data-reset-password="${u.id}" aria-label="Reset password for ${escapeHtml(u.fullName || "user")}">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12A8 8 0 1 1 6.34 17.66" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 5V12H11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <span>Reset Password</span>
                    </button>
                    ${u.status === "active"
                ? `<button type="button" class="row-action deactivate" data-deactivate-user="${u.id}" aria-label="Deactivate ${escapeHtml(u.fullName || "user")}" ${isSelf ? "disabled title=\"You cannot deactivate your own account.\"" : ""}>
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M8 12H16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
                            <span>Deactivate</span>
                          </button>`
                : `<button type="button" class="row-action activate" data-activate-user="${u.id}" aria-label="Activate ${escapeHtml(u.fullName || "user")}">
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 12.5L11 15L15.8 9.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            <span>Activate</span>
                          </button>`}
                    <button type="button" class="row-action delete" data-delete-user="${u.id}" aria-label="Delete ${escapeHtml(u.fullName || "user")}" ${isSelf ? "disabled title=\"You cannot delete your own account.\"" : ""}>
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7H19M10 11V17M14 11V17M9 7V4H15V7M7 7L8 20H16L17 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <span>Delete</span>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join("");

    renderPagination(page, totalPages);
}

function renderPagination(page, totalPages) {
    const el = document.getElementById("tablePagination");
    if (totalPages <= 1) { el.innerHTML = ""; return; }

    let html = `<button ${page === 1 ? "disabled" : ""} data-p="${page - 1}">‹</button>`;
    for (let p = 1; p <= totalPages; p++) {
        html += `<button class="${p === page ? "active" : ""}" data-p="${p}">${p}</button>`;
    }
    html += `<button ${page === totalPages ? "disabled" : ""} data-p="${page + 1}">›</button>`;
    el.innerHTML = html;

    el.querySelectorAll("button[data-p]").forEach(btn => {
        btn.addEventListener("click", () => { tableState.page = Number(btn.dataset.p); renderTable(); });
    });
}

/* ==========================================================
   ROW ACTIONS — EXPLICIT LIKE THE REFERENCE UI
   ========================================================== */

async function sendPasswordReset(u) {
    if (!u?.email) {
        showToast("This account has no email address.", "error");
        return;
    }
    const target = await guardNotStale(u);
    if (!target) return;

    openConfirm({
        title: "Reset password?",
        message: `A password reset email will be sent to <strong>${escapeHtml(target.email)}</strong>. The current password will not be shown to you.`,
        confirmLabel: "Send Reset Email",
        onConfirm: async () => {
            try {
                const { error } = await auth.auth.resetPasswordForEmail(target.email);
                if (error) throw error;
                showToast("Password reset email sent successfully.");
                closeModal("confirmModal");
            } catch (err) {
                console.error(err);
                showToast("Unable to send the password reset email. Please try again.", "error");
                closeModal("confirmModal");
            }
        }
    });
}

function openDeleteUserConfirm(u) {
    if (u.id === currentUser.uid) {
        showToast("You cannot delete your own account.", "error");
        return;
    }

    openConfirm({
        title: "Delete this account?",
        message: `Delete <strong>${escapeHtml(u.fullName)}</strong>? The account will lose access to RMSME, while historical inventory and material activity records will be preserved.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
            try {
                const fresh = await guardNotStale(u);
                if (!fresh) { closeModal("confirmModal"); return; }

                if (fresh.role === "admin" && fresh.status === "active" && activeAdminCount(fresh.id) === 0) {
                    showToast("At least one active Admin account must remain.", "error");
                    closeModal("confirmModal");
                    return;
                }

                // Account removal is represented safely as deactivation in the client UI.
                // Historical records remain intact; actual Auth-user deletion requires a privileged backend function.
                await updateDoc(doc(db, "users", fresh.id), {
                    status: "inactive",
                    deletionRequestStatus: "none",
                    deletedAt: serverTimestamp(),
                    deletedBy: currentUser.uid
                });
                showToast("Account access removed. Historical records were preserved.");
                closeModal("confirmModal");
                await refreshAll();
            } catch (err) {
                showToast(friendlyError(err, "Unable to delete this account. Please try again."), "error");
                closeModal("confirmModal");
            }
        }
    });
}

document.getElementById("userTableBody").addEventListener("click", (e) => {
    const nameCell = e.target.closest(".name-cell");
    if (nameCell && !e.target.closest("button")) {
        const row = nameCell.closest("tr");
        const u = users.find(x => x.id === row?.dataset.id);
        if (u) openViewModal(u);
        return;
    }
    const viewBtn = e.target.closest("[data-view-user]");
    if (viewBtn) {
        e.preventDefault();
        const u = users.find(x => x.id === viewBtn.dataset.viewUser);
        if (u) openViewModal(u);
        return;
    }

    const roleBtn = e.target.closest("[data-change-role]");
    if (roleBtn) {
        e.preventDefault();
        if (roleBtn.disabled) return;
        const u = users.find(x => x.id === roleBtn.dataset.changeRole);
        if (u) openChangeRoleModal(u);
        return;
    }

    const resetBtn = e.target.closest("[data-reset-password]");
    if (resetBtn) {
        e.preventDefault();
        const u = users.find(x => x.id === resetBtn.dataset.resetPassword);
        if (u) sendPasswordReset(u);
        return;
    }

    const deactivateBtn = e.target.closest("[data-deactivate-user]");
    if (deactivateBtn) {
        e.preventDefault();
        if (deactivateBtn.disabled) return;
        const u = users.find(x => x.id === deactivateBtn.dataset.deactivateUser);
        if (u) openDeactivateConfirm(u);
        return;
    }

    const activateBtn = e.target.closest("[data-activate-user]");
    if (activateBtn) {
        e.preventDefault();
        const u = users.find(x => x.id === activateBtn.dataset.activateUser);
        if (u) openActivateConfirm(u);
        return;
    }

    const deleteBtn = e.target.closest("[data-delete-user]");
    if (deleteBtn) {
        e.preventDefault();
        const u = users.find(x => x.id === deleteBtn.dataset.deleteUser);
        if (u && !deleteBtn.disabled) openDeleteUserConfirm(u);
    }
});

/* ==========================================================
   MODAL PLUMBING
   ========================================================== */

function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
});
document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("open"); });
});

/* ==========================================================
   CONCURRENCY GUARD
   ========================================================== */

// Re-fetches the row right before applying a sensitive action so a
// second Admin's more-recent change is never silently overwritten.
async function refetchUser(id) {
    const snap = await getDoc(doc(db, "users", id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function guardNotStale(capturedUser) {
    const fresh = await refetchUser(capturedUser.id);
    if (!fresh) {
        showToast("This account no longer exists. Refreshing.", "error");
        await refreshAll();
        return null;
    }
    if (millisOf(fresh.updatedAt) > millisOf(capturedUser.updatedAt)) {
        showToast("This account has already been updated.", "error");
        await refreshAll();
        return null;
    }
    return fresh;
}

/* ==========================================================
   VIEW DETAILS
   ========================================================== */

async function openViewModal(u) {
    document.getElementById("viewUserName").textContent = u.fullName || "—";
    document.getElementById("viewUserEmail").textContent = u.email || "—";

    document.getElementById("viewAccountInfo").innerHTML = detailItems([
        ["Role", roleLabel(u.role)],
        ["Status", u.status === "active" ? "🟢 Active" : "⚪ Inactive"],
        ["Date Created", fmtDate(u.createdAt)],
        ["Last Activity", fmtDateTime(u.lastActivityAt)]
    ]);

    const reqStatusLabel = { none: "No Request", pending: "Deletion Requested", rejected: "Request Rejected", cancelled: "Cancelled" }[u.deletionRequestStatus || "none"];
    document.getElementById("viewAccountRequests").innerHTML = detailItems([
        ["Deletion Request Status", reqStatusLabel],
        ["Request Date", fmtDate(u.deletionRequestedAt)]
    ]);

    document.getElementById("viewActivitySummary").innerHTML = `<div class="detail-item"><span>Recorded Activities</span><strong>Loading...</strong></div>`;
    openModal("viewUserModal");

    try {
        const [usageSnap, receiptSnap] = await Promise.all([
            getDocs(query(collection(db, "usageRecords"), where("createdBy", "==", u.id))),
            getDocs(query(collection(db, "stockReceipts"), where("createdBy", "==", u.id)))
        ]);
        const count = usageSnap.size + receiptSnap.size;
        document.getElementById("viewActivitySummary").innerHTML = count > 0
            ? detailItems([["Recorded Activities", String(count)]])
            : `<div class="detail-item"><span>Recorded Activities</span><strong>No recorded activity.</strong></div>`;
    } catch (err) {
        console.error(err);
        document.getElementById("viewActivitySummary").innerHTML = `<div class="detail-item"><span>Recorded Activities</span><strong>—</strong></div>`;
    }
}

function detailItems(pairs) {
    return pairs.map(([label, value]) => `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("");
}

/* ==========================================================
   EDIT USER
   ========================================================== */

let editingUser = null;

function openEditModal(u) {
    editingUser = u;
    document.getElementById("editUserSubtitle").textContent = roleLabel(u.role);
    document.getElementById("editUserId").value = u.id;
    document.getElementById("editFullName").value = u.fullName || "";
    document.getElementById("editEmail").value = u.email || "";
    document.getElementById("editFullNameError").textContent = "";
    document.getElementById("editEmailError").textContent = "";
    document.getElementById("editFullName").classList.remove("invalid");
    document.getElementById("editEmail").classList.remove("invalid");
    openModal("editUserModal");
}

document.getElementById("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!editingUser) return;

    const fullNameEl = document.getElementById("editFullName");
    const emailEl = document.getElementById("editEmail");
    const fullNameErr = document.getElementById("editFullNameError");
    const emailErr = document.getElementById("editEmailError");
    fullNameErr.textContent = ""; emailErr.textContent = "";
    fullNameEl.classList.remove("invalid"); emailEl.classList.remove("invalid");

    const fullName = fullNameEl.value.trim();
    const email = emailEl.value.trim();
    let valid = true;

    if (!fullName) { fullNameErr.textContent = "Please complete all required fields."; fullNameEl.classList.add("invalid"); valid = false; }
    if (!isValidEmail(email)) { emailErr.textContent = "Please enter a valid email address."; emailEl.classList.add("invalid"); valid = false; }
    else {
        const dupe = findByEmail(email);
        if (dupe && dupe.id !== editingUser.id) { emailErr.textContent = "This email is already registered."; emailEl.classList.add("invalid"); valid = false; }
    }
    if (!valid) return;

    const submitBtn = document.getElementById("editUserSubmit");
    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = "Saving...";

    try {
        const fresh = await guardNotStale(editingUser);
        if (!fresh) return;

        await updateDoc(doc(db, "users", editingUser.id), { fullName, email });
        showToast("Account updated successfully.");
        closeModal("editUserModal");
        await refreshAll();
    } catch (err) {
        friendlyError(err, "");
        showToast("Unable to update the account. Please try again.", "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = original;
    }
});

/* ==========================================================
   CHANGE ROLE MODAL
   ========================================================== */

let roleChangeUser = null;

function openChangeRoleModal(u) {
    if (u.id === currentUser.uid) {
        showToast("You cannot change your own role.", "error");
        return;
    }
    roleChangeUser = u;
    document.getElementById("changeRoleUserId").value = u.id;
    document.getElementById("changeRoleSubtitle").textContent = `${u.fullName || "User"} · Current role: ${roleLabel(u.role)}`;
    document.getElementById("changeRoleSelect").value = u.role === "admin" ? "admin" : "user";
    updateRoleChangeHint();
    openModal("changeRoleModal");
}

function updateRoleChangeHint() {
    const value = document.getElementById("changeRoleSelect").value;
    const hint = document.getElementById("changeRoleHint");
    const warning = document.getElementById("changeRoleWarning");
    hint.textContent = value === "admin"
        ? "This account will gain access to administrator features, including User Management."
        : "This account will have standard User access. Administrator features will no longer be available.";
    if (roleChangeUser && roleChangeUser.role === "admin" && value === "user" && activeAdminCount(roleChangeUser.id) === 0) {
        warning.hidden = false;
        warning.textContent = "This change is blocked because RMSME must always have at least one active Administrator.";
    } else {
        warning.hidden = true;
        warning.textContent = "";
    }
}

document.getElementById("changeRoleSelect").addEventListener("change", updateRoleChangeHint);

document.getElementById("changeRoleForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!roleChangeUser) return;
    const targetRole = document.getElementById("changeRoleSelect").value;
    if (targetRole === roleChangeUser.role) {
        closeModal("changeRoleModal");
        showToast("No role change was made.");
        return;
    }
    if (roleChangeUser.role === "admin" && targetRole === "user" && activeAdminCount(roleChangeUser.id) === 0) {
        showToast("At least one active Admin account must remain.", "error");
        return;
    }
    const submit = document.getElementById("changeRoleSubmit");
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = "Saving...";
    try {
        const fresh = await guardNotStale(roleChangeUser);
        if (!fresh) { closeModal("changeRoleModal"); return; }
        await updateDoc(doc(db, "users", roleChangeUser.id), { role: targetRole, updatedAt: serverTimestamp() });
        showToast(`Role updated to ${roleLabel(targetRole)}.`);
        closeModal("changeRoleModal");
        await refreshAll();
    } catch (err) {
        showToast(friendlyError(err, "Unable to update the user's role. Please try again."), "error");
    } finally {
        submit.disabled = false;
        submit.textContent = original;
        roleChangeUser = null;
    }
});

/* ==========================================================
   GENERIC CONFIRM MODAL
   ========================================================== */

let confirmHandler = null;

function openConfirm({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").innerHTML = message;
    const btn = document.getElementById("confirmActionBtn");
    btn.textContent = confirmLabel;
    btn.className = danger ? "btn-primary" : "btn-primary";
    btn.style.background = danger ? "linear-gradient(90deg,#c23b3b,#a92f2f)" : "";
    btn.style.boxShadow = danger ? "0 8px 18px rgba(194,59,59,.28)" : "";
    confirmHandler = onConfirm;
    openModal("confirmModal");
}

document.getElementById("confirmActionBtn").addEventListener("click", async () => {
    if (!confirmHandler) return;
    const btn = document.getElementById("confirmActionBtn");
    btn.disabled = true;
    try {
        await confirmHandler();
    } finally {
        btn.disabled = false;
    }
});

/* ---------- Change Role ---------- */

function openChangeRoleConfirm(u) {
    if (u.id === currentUser.uid) {
        showToast("You cannot remove your own administrative access.", "error");
        return;
    }
    const targetRole = u.role === "admin" ? "user" : "admin";
    const targetLabel = roleLabel(targetRole);

    openConfirm({
        title: `Change role to ${targetLabel}?`,
        message: `Change <strong>${escapeHtml(u.fullName)}</strong>'s role to <strong>${targetLabel}</strong>? ${targetRole === "admin"
            ? "This will give the account access to administrative features."
            : "This will remove the account's access to administrative features."}`,
        confirmLabel: "Confirm",
        onConfirm: async () => {
            try {
                const fresh = await guardNotStale(u);
                if (!fresh) { closeModal("confirmModal"); return; }

                if (u.role === "admin" && targetRole === "user" && activeAdminCount(u.id) === 0) {
                    showToast("At least one active Admin account must remain.", "error");
                    closeModal("confirmModal");
                    return;
                }

                await updateDoc(doc(db, "users", u.id), { role: targetRole });
                showToast(`Role updated to ${targetLabel}.`);
                closeModal("confirmModal");
                await refreshAll();
            } catch (err) {
                showToast(friendlyError(err, "Unable to update the user's role. Please try again."), "error");
                closeModal("confirmModal");
            }
        }
    });
}

/* ---------- Deactivate ---------- */

function openDeactivateConfirm(u) {
    if (u.id === currentUser.uid) {
        showToast("You cannot deactivate your current account.", "error");
        return;
    }
    openConfirm({
        title: "Deactivate this account?",
        message: `The user will no longer be able to access RMIMS. Existing records will be preserved.<div class="confirm-note">Deactivating <strong>${escapeHtml(u.fullName)}</strong> (${roleLabel(u.role)}) does not delete any material activity, receiving, or usage history already recorded under this account.</div>`,
        confirmLabel: "Deactivate",
        danger: true,
        onConfirm: async () => {
            try {
                const fresh = await guardNotStale(u);
                if (!fresh) { closeModal("confirmModal"); return; }

                if (u.role === "admin" && activeAdminCount(u.id) === 0) {
                    showToast("At least one active Admin account must remain.", "error");
                    closeModal("confirmModal");
                    return;
                }

                await updateDoc(doc(db, "users", u.id), { status: "inactive" });
                showToast("Account deactivated successfully.");
                closeModal("confirmModal");
                await refreshAll();
            } catch (err) {
                showToast(friendlyError(err, "Unable to deactivate this account. Please try again."), "error");
                closeModal("confirmModal");
            }
        }
    });
}

/* ---------- Activate ---------- */

function openActivateConfirm(u) {
    openConfirm({
        title: "Activate this account?",
        message: `<strong>${escapeHtml(u.fullName)}</strong> will be able to access RMIMS again as ${roleLabel(u.role)}.`,
        confirmLabel: "Activate",
        onConfirm: async () => {
            try {
                const fresh = await guardNotStale(u);
                if (!fresh) { closeModal("confirmModal"); return; }

                // Activation never changes role — intentionally not included below.
                await updateDoc(doc(db, "users", u.id), { status: "active" });
                showToast("Account activated successfully.");
                closeModal("confirmModal");
                await refreshAll();
            } catch (err) {
                showToast(friendlyError(err, "Unable to activate this account. Please try again."), "error");
                closeModal("confirmModal");
            }
        }
    });
}

/* ==========================================================
   REVIEW DELETION REQUEST
   ========================================================== */

let reviewingUser = null;

function openReviewDeletionModal(u) {
    reviewingUser = u;
    document.getElementById("reviewDeletionSubtitle").textContent = `Requested ${fmtDate(u.deletionRequestedAt)}`;
    document.getElementById("reviewDeletionInfo").innerHTML = detailItems([
        ["User", u.fullName || "—"],
        ["Email", u.email || "—"],
        ["Role", roleLabel(u.role)],
        ["Request Date", fmtDate(u.deletionRequestedAt)],
        ["Current Status", u.status === "active" ? "Active" : "Inactive"]
    ]);
    openModal("reviewDeletionModal");
}

document.getElementById("rejectDeletionBtn").addEventListener("click", async () => {
    if (!reviewingUser) return;
    const btn = document.getElementById("rejectDeletionBtn");
    btn.disabled = true;
    try {
        const fresh = await guardNotStale(reviewingUser);
        if (!fresh) { closeModal("reviewDeletionModal"); return; }

        await updateDoc(doc(db, "users", reviewingUser.id), {
            deletionRequestStatus: "rejected",
            deletionReviewedAt: serverTimestamp(),
            deletionReviewedBy: currentUser.uid
        });
        showToast(`Deletion request rejected. The account remains ${fresh.status === "active" ? "active" : "inactive"}.`);
        closeModal("reviewDeletionModal");
        await refreshAll();
    } catch (err) {
        showToast(friendlyError(err, "Unable to update the deletion request. Please try again."), "error");
        closeModal("reviewDeletionModal");
    } finally {
        btn.disabled = false;
    }
});

document.getElementById("approveDeletionBtn").addEventListener("click", async () => {
    if (!reviewingUser) return;

    if (reviewingUser.id === currentUser.uid) {
        showToast("You cannot remove your own administrative access.", "error");
        return;
    }

    const btn = document.getElementById("approveDeletionBtn");
    btn.disabled = true;
    try {
        const fresh = await guardNotStale(reviewingUser);
        if (!fresh) { closeModal("reviewDeletionModal"); return; }

        if (fresh.role === "admin" && fresh.status === "active" && activeAdminCount(fresh.id) === 0) {
            showToast("Cannot approve this request because at least one active Admin account must remain.", "error");
            closeModal("reviewDeletionModal");
            return;
        }

        await updateDoc(doc(db, "users", reviewingUser.id), {
            status: "inactive",
            deletionRequestStatus: "none",
            deletionReviewedAt: serverTimestamp(),
            deletionReviewedBy: currentUser.uid
        });
        showToast("Account deactivated. Historical records have been preserved.");
        closeModal("reviewDeletionModal");
        await refreshAll();
    } catch (err) {
        showToast(friendlyError(err, "Unable to update the deletion request. Please try again."), "error");
        closeModal("reviewDeletionModal");
    } finally {
        btn.disabled = false;
    }
});

/* ==========================================================
   ADD USER
   ========================================================== */

const addUserModal = document.getElementById("addUserModal");
let reactivateTargetId = null;

document.getElementById("addUserBtn").addEventListener("click", () => {
    document.getElementById("addUserForm").reset();
    document.getElementById("addRole").value = "user";
    ["addFullNameError", "addEmailError", "addPasswordError"].forEach(id => document.getElementById(id).textContent = "");
    document.getElementById("addFullName").classList.remove("invalid");
    document.getElementById("addEmail").classList.remove("invalid");
    document.getElementById("addPassword").classList.remove("invalid");
    document.getElementById("duplicateEmailNotice").hidden = true;
    document.getElementById("reactivateInsteadBtn").hidden = true;
    reactivateTargetId = null;
    openModal("addUserModal");
});

document.getElementById("reactivateInsteadBtn").addEventListener("click", async () => {
    if (!reactivateTargetId) return;
    const target = users.find(u => u.id === reactivateTargetId);
    if (!target) return;

    const btn = document.getElementById("reactivateInsteadBtn");
    btn.disabled = true;
    try {
        await updateDoc(doc(db, "users", target.id), { status: "active" });
        showToast("Account reactivated.");
        closeModal("addUserModal");
        await refreshAll();
    } catch (err) {
        showToast(friendlyError(err, "Unable to activate this account. Please try again."), "error");
    } finally {
        btn.disabled = false;
    }
});

// A second, non-persisted Supabase client. Regular signUp() on the
// PRIMARY client (`auth`) would replace the currently signed-in
// Admin's session with the newly created user's session — this
// throwaway client creates the auth account without ever touching
// the Admin's own login.
function createTempAuthClient() {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
}

document.getElementById("addUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullNameEl = document.getElementById("addFullName");
    const emailEl = document.getElementById("addEmail");
    const passwordEl = document.getElementById("addPassword");
    const roleEl = document.getElementById("addRole");

    const fullNameErr = document.getElementById("addFullNameError");
    const emailErr = document.getElementById("addEmailError");
    const passwordErr = document.getElementById("addPasswordError");
    const duplicateNotice = document.getElementById("duplicateEmailNotice");
    const duplicateText = document.getElementById("duplicateEmailText");
    const reactivateBtn = document.getElementById("reactivateInsteadBtn");

    [fullNameErr, emailErr, passwordErr].forEach(el => el.textContent = "");
    [fullNameEl, emailEl, passwordEl].forEach(el => el.classList.remove("invalid"));
    duplicateNotice.hidden = true;
    reactivateBtn.hidden = true;
    reactivateTargetId = null;

    const fullName = fullNameEl.value.trim();
    const email = emailEl.value.trim();
    const password = passwordEl.value;
    const role = roleEl.value;

    let valid = true;

    if (!fullName) { fullNameErr.textContent = "Please complete all required fields."; fullNameEl.classList.add("invalid"); valid = false; }

    if (!isValidEmail(email)) {
        emailErr.textContent = "Please enter a valid email address.";
        emailEl.classList.add("invalid");
        valid = false;
    } else {
        const dupe = findByEmail(email);
        if (dupe) {
            valid = false;
            duplicateNotice.hidden = false;
            if (dupe.status === "active") {
                duplicateText.textContent = "This email is already registered.";
            } else {
                duplicateText.textContent = "This account already exists and is inactive.";
                reactivateBtn.hidden = false;
                reactivateTargetId = dupe.id;
            }
        }
    }

    if (!password || password.length < 8) {
        passwordErr.textContent = "Password must be at least 8 characters.";
        passwordEl.classList.add("invalid");
        valid = false;
    }

    if (!valid) return;

    const submitBtn = document.getElementById("addUserSubmit");
    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = "Creating...";

    let tempClient = null;
    try {
        tempClient = createTempAuthClient();
        const { data, error } = await tempClient.auth.signUp({ email, password });
        if (error) throw error;

        const uid = data.user?.id;
        if (!uid) throw new Error("Account creation did not return a user id.");

        await setDoc(doc(db, "users", uid), {
            fullName, email, role,
            status: "active", // Admin-provisioned accounts are granted access immediately
            createdAt: serverTimestamp()
        });

        showToast("User created successfully.");
        closeModal("addUserModal");
        await refreshAll();
    } catch (err) {
        console.error(err);
        const msg = (err && err.message || "").toLowerCase();
        if (msg.includes("already registered") || msg.includes("already exists")) {
            duplicateNotice.hidden = false;
            duplicateText.textContent = "This email is already registered.";
        } else if (msg.includes("password")) {
            passwordErr.textContent = "Password is too weak. Use at least 8 characters.";
            passwordEl.classList.add("invalid");
        } else {
            showToast("Unable to create the account. Please try again.", "error");
        }
    } finally {
        try { await tempClient?.auth.signOut(); } catch { /* no-op: client was never persisted */ }
        submitBtn.disabled = false;
        submitBtn.textContent = original;
    }
});

/* ==========================================================
   INIT
   ========================================================== */

async function init() {
    try {
        await loadUsers();
        renderSummary();
        renderTable();
    } catch (err) {
        console.error(err);
        showToast("Unable to load user data. Please try again.", "error");
    }
}


/* ==========================================================
   USER / ROLE MANAGEMENT TABS
   ========================================================== */
const rolesTab = document.getElementById("rolesTab");
const usersTab = document.getElementById("usersTab");
const rolesPanel = document.getElementById("rolesPanel");
const usersPanel = document.getElementById("usersPanel");

function activateManagementTab(tab) {
    const showRoles = tab === "roles";
    rolesTab.classList.toggle("active", showRoles);
    usersTab.classList.toggle("active", !showRoles);
    rolesTab.setAttribute("aria-selected", String(showRoles));
    usersTab.setAttribute("aria-selected", String(!showRoles));
    rolesPanel.hidden = !showRoles;
    usersPanel.hidden = showRoles;
}

rolesTab.addEventListener("click", () => activateManagementTab("roles"));
usersTab.addEventListener("click", () => activateManagementTab("users"));

document.querySelectorAll(".role-view-users").forEach(btn => {
    btn.addEventListener("click", () => {
        const role = btn.dataset.role;
        activateManagementTab("users");
        document.getElementById("roleFilter").value = role;
        tableState.role = role;
        tableState.page = 1;
        renderTable();
    });
});
