import { supabase } from "./supabase-config.js";
import { recordLoginFailure, clearLoginFailure } from "../js/system-alerts-service.js";

/**
 * Format auth errors into clean, user-friendly messages without exposing sensitive details.
 */
function friendlyAuthError(error) {
    if (!error) return "Unable to proceed. Please try again.";
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("invalid login credentials") || msg.includes("invalid credential")) {
        return "Invalid email or password. Please check your credentials and try again.";
    }
    if (msg.includes("user already registered") || msg.includes("already registered")) {
        return "An account with this email address already exists. Please sign in.";
    }
    if (msg.includes("email not confirmed")) {
        return "Your email address has not been confirmed. Please verify your email before logging in.";
    }
    if (msg.includes("password should be at least") || msg.includes("weak password")) {
        return "Password must be at least 8 characters.";
    }
    if (msg.includes("too many requests") || msg.includes("rate limit")) {
        return "Too many sign in attempts. Please wait a few moments and try again.";
    }
    return error.message || "Unable to proceed. Please check your details and try again.";
}

/**
 * Ensures the transition DOM overlay exists on the page and returns its elements.
 */
function ensureAuthTransitionDOM(expectedRole) {
    let overlay = document.getElementById("authTransitionOverlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "authTransitionOverlay";
        overlay.className = "auth-transition-overlay";
        overlay.setAttribute("aria-hidden", "true");
        
        let roleLabel = "Enterprise Workspace";
        if (expectedRole === "user") roleLabel = "Staff Workspace";
        else if (expectedRole === "admin" || expectedRole === "manager") roleLabel = "Manager Workspace";

        overlay.innerHTML = `
            <div class="auth-transition-card" role="status" aria-live="polite">
                <!-- Custom Animated Raw Material Packaging Box & Zip Tape Stage -->
                <div class="auth-box-stage">
                    <div class="rm-floating-item rm-item-grain" title="Grain Supplies">🌾</div>
                    <div class="rm-floating-item rm-item-bottle" title="Liquid & Chemical Ingredients">🧪</div>
                    <div class="rm-floating-item rm-item-sugar" title="Raw Material Package">📦</div>
                    <div class="rm-floating-item rm-item-ore" title="Mineral & Additive Components">✨</div>

                    <div class="rm-box-3d">
                        <div class="rm-box-front">
                            <div class="rm-box-brand">
                                <span class="rm-box-icon">📦</span>
                                <span class="rm-box-label">RM(S)ME CARGO</span>
                            </div>
                            <div class="rm-box-barcode"></div>
                        </div>

                        <!-- Emerald Dynamic Zip / Security Sealing Tape -->
                        <div class="rm-zip-tape-track">
                            <div class="rm-zip-tape-fill" id="authZipTape" style="width: 0%;">
                                <span class="rm-tape-text">RM(S)ME • SECURED • RAW MATERIALS • VERIFIED • </span>
                            </div>
                        </div>

                        <!-- Verified Seal Stamp when 100% -->
                        <div class="rm-stamp-badge" id="authStampBadge">
                            <span>✓ VERIFIED</span>
                        </div>
                    </div>
                </div>

                <div class="auth-trans-header">
                    <h3 class="auth-trans-title">Packaging & Authenticating Session</h3>
                    <p class="auth-trans-sub">Securing ${roleLabel}...</p>
                </div>
                <div class="auth-progress-box">
                    <div class="auth-progress-track">
                        <div class="auth-progress-bar" id="authProgressBar" style="width: 0%;"></div>
                    </div>
                    <div class="auth-progress-meta">
                        <span class="auth-status-text" id="authStatusText">
                            <span id="authStatusMessage">Initializing...</span>
                        </span>
                        <span class="auth-percent-text" id="authPercentText">0%</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    return {
        overlay,
        bar: overlay.querySelector("#authProgressBar"),
        zipTape: overlay.querySelector("#authZipTape"),
        stamp: overlay.querySelector("#authStampBadge"),
        message: overlay.querySelector("#authStatusMessage"),
        percent: overlay.querySelector("#authPercentText")
    };
}

function updateAuthProgress(dom, percentage, messageText) {
    if (!dom) return;
    if (dom.bar) dom.bar.style.width = `${percentage}%`;
    if (dom.zipTape) dom.zipTape.style.width = `${percentage}%`;
    if (dom.percent) dom.percent.textContent = `${Math.round(percentage)}%`;
    if (dom.message) dom.message.textContent = messageText;
    if (dom.stamp) {
        if (percentage >= 98) {
            dom.stamp.classList.add("is-stamped");
        } else {
            dom.stamp.classList.remove("is-stamped");
        }
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function showAuthTransition(expectedRole, initialMessage = "Connecting to Supabase Authentication...", initialPercent = 15) {
    const dom = ensureAuthTransitionDOM(expectedRole);
    dom.overlay.classList.add("is-active");
    dom.overlay.setAttribute("aria-hidden", "false");
    updateAuthProgress(dom, initialPercent, initialMessage);
    return dom;
}

function hideAuthTransition(dom) {
    if (dom && dom.overlay) {
        dom.overlay.classList.remove("is-active");
        dom.overlay.setAttribute("aria-hidden", "true");
    }
}

// Automatically synchronize and heal approved users cache on load
export function autoSyncApprovedUsersCache() {
    try {
        const rawApproved = localStorage.getItem('rmims_approved_users');
        let approvedCache = rawApproved ? JSON.parse(rawApproved) : [];
        if (!Array.isArray(approvedCache)) approvedCache = [];

        // 1. Pull any active user from registered directory
        const rawReg = localStorage.getItem('rmims_registered_users');
        const regList = rawReg ? JSON.parse(rawReg) : [];
        if (Array.isArray(regList)) {
            regList.forEach(u => {
                if (!u) return;
                const s = String(u.status || '').toLowerCase().trim();
                if (s === 'active') {
                    const uEmail = (u.email || '').toLowerCase().trim();
                    const uUser = (u.username || '').toLowerCase().trim();
                    const uId = String(u.id || '').trim();
                    const exists = approvedCache.some(a => 
                        (uEmail && a.email && a.email.toLowerCase().trim() === uEmail) ||
                        (uUser && a.username && a.username.toLowerCase().trim() === uUser) ||
                        (uId && a.id && String(a.id).trim() === uId)
                    );
                    if (!exists) {
                        approvedCache.push({
                            id: u.id,
                            name: u.name,
                            username: u.username,
                            email: u.email,
                            role: u.role || 'Staff',
                            branchLoc: u.branchLoc || 'Lucena',
                            branchName: u.branchName || 'Branch Store',
                            status: 'Active',
                            approvedAt: new Date().toISOString()
                        });
                    }
                }
            });
        }

        // 2. Pull personnel from branch stores
        try {
            const rawStores = localStorage.getItem('RMIMS_BRANCH_STORES_V3');
            const stores = rawStores ? JSON.parse(rawStores) : {};
            const storeList = Array.isArray(stores) ? stores : Object.values(stores);
            storeList.forEach(st => {
                const list = [...(st.managers || []), ...(st.staff || [])];
                list.forEach(p => {
                    if (!p) return;
                    const pEmail = (p.email || '').toLowerCase().trim();
                    const pUser = (p.username || '').toLowerCase().trim();
                    const pId = String(p.id || '').trim();
                    const exists = approvedCache.some(a => 
                        (pEmail && a.email && a.email.toLowerCase().trim() === pEmail) ||
                        (pUser && a.username && a.username.toLowerCase().trim() === pUser) ||
                        (pId && a.id && String(a.id).trim() === pId)
                    );
                    if (!exists) {
                        approvedCache.push({
                            id: p.id,
                            name: p.name,
                            username: p.username,
                            email: p.email,
                            role: p.role || 'Staff',
                            branchName: st.name,
                            status: 'Active',
                            approvedAt: new Date().toISOString()
                        });
                    }
                });
            });
        } catch (_) {}

        localStorage.setItem('rmims_approved_users', JSON.stringify(approvedCache));

        // 3. Purge any approved users from pending queue
        const rawPending = localStorage.getItem('rmims_pending_users');
        const pendingList = rawPending ? JSON.parse(rawPending) : [];
        if (Array.isArray(pendingList) && pendingList.length > 0) {
            const cleanPending = pendingList.filter(p => {
                if (!p) return false;
                const pEmail = (p.email || '').toLowerCase().trim();
                const pUser = (p.username || '').toLowerCase().trim();
                const pId = String(p.id || '').trim();
                const pName = (p.name || '').toLowerCase().trim();
                const isApproved = approvedCache.some(a => 
                    (pEmail && a.email && a.email.toLowerCase().trim() === pEmail) ||
                    (pUser && a.username && a.username.toLowerCase().trim() === pUser) ||
                    (pId && a.id && String(a.id).trim() === pId) ||
                    (pName && a.name && a.name.toLowerCase().trim() === pName)
                );
                return !isApproved;
            });
            if (cleanPending.length !== pendingList.length) {
                localStorage.setItem('rmims_pending_users', JSON.stringify(cleanPending));
                window.dispatchEvent(new Event('rmims_pending_users_updated'));
            }
        }
    } catch (_) {}
}

// Run immediately on script evaluation
autoSyncApprovedUsersCache();

export function isUserAccountDeleted(email, uid, username = '') {
    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanUid = (uid || '').trim();
    const cleanUser = (username || (cleanEmail ? cleanEmail.split('@')[0] : '')).toLowerCase().trim();
    try {
        const deleted = JSON.parse(localStorage.getItem('rmims_deleted_users') || '[]');
        if (Array.isArray(deleted) && deleted.length > 0) {
            return deleted.some(d => {
                if (!d) return false;
                const dEmail = (d.email || '').toLowerCase().trim();
                const dId = String(d.id || '').trim();
                const dUser = (d.username || '').toLowerCase().trim();
                return (cleanEmail && dEmail && dEmail === cleanEmail) ||
                       (cleanUid && dId && dId === cleanUid) ||
                       (cleanUser && dUser && (dUser === cleanUser || dUser.replace(/\s+/g, '') === cleanUser.replace(/\s+/g, '')));
            });
        }
    } catch (_) {}
    return false;
}

export function isUserAccountRejected(email, uid, username = '') {
    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanUid = (uid || '').trim();
    const cleanUser = (username || (cleanEmail ? cleanEmail.split('@')[0] : '')).toLowerCase().trim();
    try {
        const rejected = JSON.parse(localStorage.getItem('rmims_rejected_users') || '[]');
        if (Array.isArray(rejected) && rejected.length > 0) {
            return rejected.some(r => {
                if (!r) return false;
                const rEmail = (r.email || '').toLowerCase().trim();
                const rId = String(r.id || '').trim();
                const rUser = (r.username || '').toLowerCase().trim();
                return (cleanEmail && rEmail && rEmail === cleanEmail) ||
                       (cleanUid && rId && rId === cleanUid) ||
                       (cleanUser && rUser && (rUser === cleanUser || rUser.replace(/\s+/g, '') === cleanUser.replace(/\s+/g, '')));
            });
        }
    } catch (_) {}
    return false;
}

export function isUserPendingApproval(email, uid, profileStatus, username = '', fullName = '') {
    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanUid = (uid || '').trim();
    const cleanUser = (username || (cleanEmail ? cleanEmail.split('@')[0] : '')).toLowerCase().trim();
    const cleanName = (fullName || '').toLowerCase().trim();
    const pStatus = (profileStatus || '').toLowerCase().trim();

    // 0. Deleted or rejected accounts are not pending
    if (isUserAccountDeleted(cleanEmail, cleanUid, cleanUser) || pStatus === 'deleted') {
        return false;
    }
    if (isUserAccountRejected(cleanEmail, cleanUid, cleanUser) || pStatus === 'rejected') {
        return false;
    }

    // 1. Check explicitly approved users cache (authoritative source of admin approvals)
    try {
        const approvedCache = JSON.parse(localStorage.getItem('rmims_approved_users') || '[]');
        if (Array.isArray(approvedCache) && approvedCache.length > 0) {
            const isApproved = approvedCache.some(a => {
                if (!a) return false;
                const aEmail = (a.email || '').toLowerCase().trim();
                const aId = String(a.id || '').trim();
                const aUser = (a.username || '').toLowerCase().trim();
                const aName = (a.name || '').toLowerCase().trim();
                return (cleanEmail && aEmail && aEmail === cleanEmail) ||
                       (cleanUid && aId && aId === cleanUid) ||
                       (cleanUser && aUser && (aUser === cleanUser || aUser.replace(/\s+/g, '') === cleanUser.replace(/\s+/g, ''))) ||
                       (cleanName && aName && (aName === cleanName || aName.replace(/\s+/g, '') === cleanName.replace(/\s+/g, '')));
            });
            if (isApproved) {
                // Ensure removed from pending queue
                try {
                    const pending = JSON.parse(localStorage.getItem('rmims_pending_users') || '[]');
                    const filtered = pending.filter(p => {
                        const pEmail = (p.email || '').toLowerCase().trim();
                        const pId = String(p.id || '').trim();
                        const pUser = (p.username || '').toLowerCase().trim();
                        return !(cleanEmail && pEmail && pEmail === cleanEmail) &&
                               !(cleanUid && pId && pId === cleanUid) &&
                               !(cleanUser && pUser && pUser === cleanUser);
                    });
                    localStorage.setItem('rmims_pending_users', JSON.stringify(filtered));
                } catch (_) {}
                return false; // APPROVED: Access granted!
            }
        }
    } catch (_) {}

    // 2. Check local registered directory (active accounts take precedence over stale pending records)
    try {
        const registered = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
        if (Array.isArray(registered)) {
            const found = registered.find(u => {
                if (!u) return false;
                const uEmail = (u.email || '').toLowerCase().trim();
                const uId = String(u.id || '').trim();
                const uUser = (u.username || '').toLowerCase().trim();
                const uName = (u.name || '').toLowerCase().trim();
                return (cleanEmail && uEmail && uEmail === cleanEmail) ||
                       (cleanUid && uId && uId === cleanUid) ||
                       (cleanUser && uUser && (uUser === cleanUser || uUser.replace(/\s+/g, '') === cleanUser.replace(/\s+/g, ''))) ||
                       (cleanName && uName && (uName === cleanName || uName.replace(/\s+/g, '') === cleanName.replace(/\s+/g, '')));
            });
            if (found) {
                const s = (found.status || '').toLowerCase().trim();
                if (s === 'active') {
                    // Cache in approved users for persistent access
                    try {
                        const approvedCache = JSON.parse(localStorage.getItem('rmims_approved_users') || '[]');
                        if (!approvedCache.some(a => (cleanEmail && a.email === cleanEmail) || (cleanUid && a.id === cleanUid))) {
                            approvedCache.push({ id: cleanUid, email: cleanEmail, username: cleanUser, name: cleanName });
                            localStorage.setItem('rmims_approved_users', JSON.stringify(approvedCache));
                        }
                    } catch (_) {}
                    return false; // APPROVED: Access granted!
                }
                if (s === 'pending' || s === 'pending_approval') return true;
            }
        }
    } catch (_) {}

    // 3. Check profile status from Supabase (if Supabase returned active, account is confirmed active)
    if (pStatus === 'active') {
        return false;
    }

    // 4. Check if user is registered in RMIMS_BRANCH_STORES_V3 by admin
    try {
        const stores = JSON.parse(localStorage.getItem('RMIMS_BRANCH_STORES_V3') || '{}');
        const storeList = Array.isArray(stores) ? stores : Object.values(stores);
        for (const store of storeList) {
            const personnel = [...(store.managers || []), ...(store.staff || [])];
            const inStore = personnel.some(p => {
                if (!p) return false;
                const pEmail = (p.email || '').toLowerCase().trim();
                const pUser = (p.username || '').toLowerCase().trim();
                const pId = String(p.id || '').trim();
                return (cleanEmail && pEmail && pEmail === cleanEmail) ||
                       (cleanUser && pUser && pUser === cleanUser) ||
                       (cleanUid && pId && pId === cleanUid);
            });
            if (inStore) {
                return false; // Assigned by Admin to a branch store!
            }
        }
    } catch (_) {}

    // 5. Default fallback: non-admin accounts that are not explicitly approved or active MUST await approval
    return true;
}

/**
 * Authenticates a user against Supabase Auth and validates application role/status from public.user_profiles.
 * Integrated with the video progress transition lifecycle and smooth pacing.
 * 
 * @param {string} email - User email address
 * @param {string} password - User password
 * @param {"admin"|"user"} [expectedRole] - Optional portal-specific role constraint ("admin" or "user")
 */
export async function loginUser(email, password, expectedRole) {
    // 1. Launch interactive transition overlay
    const transDOM = showAuthTransition(expectedRole, "Connecting to Supabase Authentication...", 18);

    try {
        let cleanEmailInput = email.trim();
        if (!cleanEmailInput.includes('@')) {
            if (cleanEmailInput.toLowerCase() === 'zeanna' || cleanEmailInput.toLowerCase() === 'admin') {
                cleanEmailInput = 'calusinzeanna3@gmail.com';
            } else {
                const targetClean = cleanEmailInput.toLowerCase().replace(/\s+/g, '');
                
                // 1. Check approved users cache
                try {
                    const approved = JSON.parse(localStorage.getItem('rmims_approved_users') || '[]');
                    const found = approved.find(u => {
                        const uUser = (u.username || '').toLowerCase().replace(/\s+/g, '');
                        const uName = (u.name || '').toLowerCase().replace(/\s+/g, '');
                        return (uUser && uUser === targetClean) || (uName && uName === targetClean);
                    });
                    if (found && found.email) cleanEmailInput = found.email;
                } catch (_) {}

                // 2. Check registered users directory
                if (!cleanEmailInput.includes('@')) {
                    try {
                        const regList = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
                        const found = regList.find(u => {
                            const uUser = (u.username || '').toLowerCase().replace(/\s+/g, '');
                            const uName = (u.name || '').toLowerCase().replace(/\s+/g, '');
                            return (uUser && uUser === targetClean) || (uName && uName === targetClean);
                        });
                        if (found && found.email) cleanEmailInput = found.email;
                    } catch (_) {}
                }

                // 3. Check pending users
                if (!cleanEmailInput.includes('@')) {
                    try {
                        const pending = JSON.parse(localStorage.getItem('rmims_pending_users') || '[]');
                        const found = pending.find(u => {
                            const uUser = (u.username || '').toLowerCase().replace(/\s+/g, '');
                            const uName = (u.name || '').toLowerCase().replace(/\s+/g, '');
                            return (uUser && uUser === targetClean) || (uName && uName === targetClean);
                        });
                        if (found && found.email) cleanEmailInput = found.email;
                    } catch (_) {}
                }

                // 4. Query Supabase user_profiles if still not resolved
                if (!cleanEmailInput.includes('@')) {
                    try {
                        const { data: upData } = await supabase
                            .from('user_profiles')
                            .select('email')
                            .or(`username.ilike.${cleanEmailInput},username.ilike.${targetClean},full_name.ilike.${cleanEmailInput}`)
                            .limit(1)
                            .maybeSingle();
                        if (upData && upData.email) {
                            cleanEmailInput = upData.email;
                        }
                    } catch (_) {}
                }

                // Fallback store.ph domain if still no @
                if (!cleanEmailInput.includes('@')) {
                    cleanEmailInput = `${targetClean}@store.ph`;
                }
            }
        }

        // Step 1: Sign in with Supabase Auth
        const authPromise = supabase.auth.signInWithPassword({
            email: cleanEmailInput,
            password: password
        });

        // Smooth pacing delay to allow video playback
        await sleep(550);
        updateAuthProgress(transDOM, 38, "Verifying credentials & security tokens...");

        const { data, error } = await authPromise;

        if (error) {
            hideAuthTransition(transDOM);
            const msg = (error.message || "").toLowerCase();
            if (msg.includes("invalid") || msg.includes("credential") || msg.includes("password")) {
                let userBranch = "Lucena";
                let userStore = "Scones & Muffins Bakery";
                try {
                    const clean = cleanEmailInput.toLowerCase().trim();
                    if (clean.includes("kxc") || clean.includes("tiaong") || clean.includes("glazel")) {
                        userBranch = "Tiaong";
                        userStore = "KXC 5-Year Enterprise";
                    }
                } catch (_) {}
                recordLoginFailure(cleanEmailInput, `${userStore} (${userBranch})`);
            }
            throw new Error(friendlyAuthError(error));
        }

        if (!data?.user?.id) {
            await supabase.auth.signOut();
            throw new Error("Authentication succeeded but no user session was established.");
        }

        const uid = data.user.id;

        // Step 2: Validate security role & profile
        await sleep(650);
        updateAuthProgress(transDOM, 65, "Validating account role permissions & security profile...");

        let profile = null;
        let profileError = null;

        try {
            const res = await supabase
                .from("user_profiles")
                .select("id, full_name, email, role, status, operational_role, branch_name, branch_location, branch_store, username, company_id, company_name")
                .eq("id", uid)
                .maybeSingle();
            profile = res.data;
            profileError = res.error;
        } catch (e) {
            profileError = e;
        }

        // Graceful fallback to basic user_profiles columns
        if (!profile) {
            try {
                const coreRes = await supabase
                    .from("user_profiles")
                    .select("id, full_name, email, role, status")
                    .eq("id", uid)
                    .maybeSingle();
                if (coreRes.data) {
                    profile = coreRes.data;
                    profileError = null;
                }
            } catch (coreErr) { }
        }

        // Ensure account profile exists without hardcoding credentials to old admin
        if (!profile && data.user?.email) {
            // If profile record is missing from DB, query or initialize from user metadata safely
            try {
                const meta = data.user.user_metadata || {};
                const strToCheck = [
                    meta.company_id,
                    meta.company_name,
                    meta.branch_name,
                    meta.branch_store,
                    meta.branch_location
                ].map(s => String(s || '').toLowerCase()).join(' ');

                const isScones = strToCheck.includes("1872cf44-e821-4370-b227-d1b7e4fc6f56") ||
                    strToCheck.includes("scones") ||
                    strToCheck.includes("muffin") ||
                    strToCheck.includes("nutribun") ||
                    strToCheck.includes("bakery");

                const assignedCompanyId = isScones ? "1872cf44-e821-4370-b227-d1b7e4fc6f56" : "a72a7971-6ec7-4edc-ae72-89d702199ed9";
                const assignedCompanyName = isScones ? "Scones & Muffins Bakery" : "KXC 5-Year Enterprise";
                const assignedDatasetFolder = isScones ? "1872cf44-e821-4370-b227-d1b7e4fc6f56" : "a72a7971-6ec7-4edc-ae72-89d702199ed9";

                const opRole = meta.operational_role || (meta.role === "manager" ? "manager" : "staff");

                profile = {
                    id: uid,
                    full_name: meta.full_name || data.user.email.split('@')[0],
                    email: data.user.email,
                    role: meta.role || "user",
                    operational_role: opRole,
                    status: meta.status || "pending",
                    username: meta.username || data.user.email.split('@')[0],
                    branch_name: meta.branch_name || (isScones ? "Scones & Muffins Store" : "Branch Store"),
                    branch_location: meta.branch_location || "Lucena",
                    branch_store: meta.branch_store || (isScones ? "Scones & Muffins Bakery (Lucena)" : "Branch Store (Lucena)"),
                    company_id: assignedCompanyId,
                    company_name: assignedCompanyName,
                    dataset_folder: assignedDatasetFolder
                };
                profileError = null;
                try {
                    await supabase.from("user_profiles").upsert(profile);
                } catch (_) {}
            } catch (e) { }
        }

        if (!profile && data.user) {
            profile = {
                id: uid,
                full_name: data.user.email ? data.user.email.split('@')[0] : "User",
                email: data.user.email || email,
                role: "user",
                operational_role: "staff",
                status: "pending",
                username: data.user.email ? data.user.email.split('@')[0] : "user",
                branch_name: "Branch Store",
                branch_location: "Lucena"
            };
            try {
                await supabase.from("user_profiles").upsert(profile);
            } catch (_) {}
        }

        const cleanEmail = (data.user?.email || "").toLowerCase();
        const isMasterAdmin = cleanEmail === "calusinzeanna3@gmail.com";
        const accountUsername = profile.username || (data.user?.email ? data.user.email.split('@')[0] : '');
        const accountFullName = profile.full_name || '';

        if (isMasterAdmin) {
            profile.role = "admin";
            profile.operational_role = "admin";
            profile.status = "active";
            profile.full_name = profile.full_name || "Zeanna";
            // Ensure Supabase user_profiles table also updates to active if possible
            try {
                await supabase.from("user_profiles").upsert({
                    id: uid,
                    email: cleanEmail,
                    role: "admin",
                    operational_role: "admin",
                    status: "active",
                    full_name: profile.full_name
                });
            } catch (_) {}
        } else {
            // Unified Admin Security Check 1: Block permanently deleted accounts
            const isDeleted = isUserAccountDeleted(cleanEmail, uid, accountUsername) || profile.status === "deleted";
            if (isDeleted) {
                hideAuthTransition(transDOM);
                await supabase.auth.signOut();
                try {
                    localStorage.removeItem('currentUser');
                    localStorage.removeItem('rmimsCurrentUser');
                    localStorage.removeItem('userProfile');
                    sessionStorage.clear();
                } catch (_) {}
                throw new Error("This account has been deleted by the Administrator. Access is permanently revoked.");
            }

            // Unified Admin Security Check 2: Block rejected account applications
            const isRejected = isUserAccountRejected(cleanEmail, uid, accountUsername) || profile.status === "rejected";
            if (isRejected) {
                hideAuthTransition(transDOM);
                await supabase.auth.signOut();
                try {
                    localStorage.removeItem('currentUser');
                    localStorage.removeItem('rmimsCurrentUser');
                    localStorage.removeItem('userProfile');
                    sessionStorage.clear();
                } catch (_) {}
                throw new Error("Your account application was declined by the Administrator. Access denied.");
            }

            // Unified Admin Security Check 3: Block inactive/suspended accounts
            const isInactive = (profile.status === "inactive" || profile.status === "suspended") && !isMasterAdmin;
            if (isInactive) {
                hideAuthTransition(transDOM);
                await supabase.auth.signOut();
                try {
                    localStorage.removeItem('currentUser');
                    localStorage.removeItem('rmimsCurrentUser');
                    localStorage.removeItem('userProfile');
                    sessionStorage.clear();
                } catch (_) {}
                throw new Error("Your account is currently inactive or suspended. Please contact the Administrator.");
            }

            // Unified Admin Security Check 4: Enforce Admin approval for pending accounts
            const isPending = isUserPendingApproval(cleanEmail, uid, profile.status, accountUsername, accountFullName);
            if (isPending) {
                hideAuthTransition(transDOM);
                await supabase.auth.signOut();
                try {
                    localStorage.removeItem('currentUser');
                    localStorage.removeItem('rmimsCurrentUser');
                    localStorage.removeItem('userProfile');
                    sessionStorage.clear();
                } catch (_) {}
                throw new Error("Your account is currently awaiting Administrator approval. Please wait for the Main Admin to activate your access.");
            }
            profile.status = "active";

            // Ensure Supabase database user_profiles table is kept in sync with active status
            try {
                await supabase.from("user_profiles").update({
                    status: "active",
                    updated_at: new Date().toISOString()
                }).eq("id", uid);
            } catch (_) {}
        }

        const isDumpAccount = cleanEmail === "admin@rmims.ph" || cleanEmail === "manager@rmims.ph" || cleanEmail === "staff@rmims.ph" || cleanEmail === "asst.manager@rmims.ph";
        if (isDumpAccount) {
            await supabase.auth.signOut();
            throw new Error("This demo account has been permanently disconnected from the system.");
        }

        // Role gating only if explicitly requested (unified login permits all authorized roles)
        const opRole = String(profile.operational_role || profile.operationalRole || "").trim().toLowerCase();
        const baseRole = String(profile.role || "").trim().toLowerCase();
        const isAdmin = baseRole === "admin" || baseRole === "main_admin" || opRole === "admin" || isMasterAdmin;
        const isManager = !isAdmin && (opRole === "manager" || baseRole === "manager");
        const isStaff = !isAdmin && !isManager;
        const effectiveRole = isAdmin ? "admin" : (isManager ? "manager" : "staff");

        if (expectedRole === "admin" && !isAdmin) {
            await supabase.auth.signOut();
            throw new Error("Access denied. Administrator privileges required.");
        }

        // Step 3: Synchronize session storage with RBAC details
        await sleep(650);
        updateAuthProgress(transDOM, 88, "Synchronizing workspace session & operational permissions...");

        let sessionFullName = profile.full_name || profile.email;

        const strToCheck = [
            profile.company_id,
            profile.company_name,
            profile.branch_name,
            profile.branch_store,
            profile.branch_location
        ].map(s => String(s || '').toLowerCase()).join(' ');

        const isScones = strToCheck.includes("1872cf44-e821-4370-b227-d1b7e4fc6f56") ||
            strToCheck.includes("scones") ||
            strToCheck.includes("muffin") ||
            strToCheck.includes("nutribun") ||
            strToCheck.includes("bakery");

        const assignedCompanyId = isScones ? "1872cf44-e821-4370-b227-d1b7e4fc6f56" : "a72a7971-6ec7-4edc-ae72-89d702199ed9";
        const assignedCompanyName = isScones ? "Scones & Muffins Bakery" : "KXC 5-Year Enterprise";
        const assignedDatasetFolder = isScones ? "1872cf44-e821-4370-b227-d1b7e4fc6f56" : "a72a7971-6ec7-4edc-ae72-89d702199ed9";

        const destinationRoleLabel = isAdmin 
            ? "Main Administrator" 
            : (isManager ? "Manager" : "Staff");

        const sessionUser = {
            id: profile.id,
            fullName: sessionFullName,
            name: sessionFullName,
            email: profile.email,
            role: effectiveRole,
            operationalRole: effectiveRole,
            operational_role: effectiveRole,
            status: profile.status,
            username: profile.username || "",
            branchName: isAdmin ? "Headquarters" : (profile.branch_name || (isScones ? "Scones & Muffins Bakery" : "Branch Store")),
            branchLocation: isAdmin ? "Headquarters" : (profile.branch_location || "Lucena"),
            branchStore: isAdmin ? "Headquarters" : (profile.branch_store || (isScones ? "Scones & Muffins Bakery (Lucena)" : "Branch Store")),
            companyId: assignedCompanyId,
            company_id: assignedCompanyId,
            companyName: assignedCompanyName,
            company_name: assignedCompanyName,
            datasetFolder: assignedDatasetFolder,
            dataset_folder: assignedDatasetFolder
        };

        try {
            localStorage.setItem("currentUser", JSON.stringify(sessionUser));
            localStorage.setItem("rmimsCurrentUser", JSON.stringify(sessionUser));
            localStorage.setItem("userProfile", JSON.stringify(sessionUser));
            localStorage.setItem("rmims_active_company_id", assignedCompanyId);
            localStorage.setItem("rmims_active_company_name", assignedCompanyName);
            localStorage.setItem("rmims_active_dataset_folder", assignedDatasetFolder);
            localStorage.setItem("rmims_all_accounts_permanently_purged_v2", "true");
            localStorage.setItem("rmims_session_active", "true");

            if (isAdmin) {
                localStorage.setItem("adminUser", JSON.stringify(sessionUser));
                localStorage.setItem("rmimsAdminUser", JSON.stringify(sessionUser));
                localStorage.removeItem("managerUser");
                localStorage.removeItem("staffUser");
            } else if (isManager) {
                localStorage.setItem("managerUser", JSON.stringify(sessionUser));
                localStorage.removeItem("staffUser");
                localStorage.removeItem("adminUser");
                localStorage.removeItem("rmimsAdminUser");
            } else {
                localStorage.setItem("staffUser", JSON.stringify(sessionUser));
                localStorage.removeItem("managerUser");
                localStorage.removeItem("adminUser");
                localStorage.removeItem("rmimsAdminUser");
            }
            sessionStorage.setItem("rmims_login_session_id", `login-${profile.id}-${Date.now()}`);
            sessionStorage.setItem("rmims_just_logged_in", "true");
            sessionStorage.removeItem("rmims_session_login_recorded");

            // Dispatch dynamic role-tailored login notification across the system
            const notifCategory = isAdmin ? "Security & Access" : (isManager ? "Store Operations" : "Staff Activity");
            const notifTitle = isAdmin 
                ? "Administrator Authenticated" 
                : (isManager ? "Store Manager Signed In" : "Staff Personnel Session Active");
            const notifMessage = isAdmin
                ? `Admin ${sessionFullName} signed in to the Main Administration control center.`
                : (isManager 
                    ? `Manager ${sessionFullName} signed in to Store Management (${assignedCompanyName}).`
                    : `Staff member ${sessionFullName} signed in for inventory operations at ${profile.branch_name || 'Store Branch'}.`);
            
            const loginNotification = {
                id: `notif-login-${profile.id}-${Date.now()}`,
                title: notifTitle,
                message: notifMessage,
                category: notifCategory,
                priority: "success",
                actor: `${sessionFullName} (${destinationRoleLabel || 'User'})`,
                role: effectiveRole,
                targetRole: effectiveRole,
                roleScope: effectiveRole,
                userId: profile.id,
                email: profile.email,
                type: "user_login",
                timestamp: new Date().toISOString(),
                details: {
                    user_role: effectiveRole,
                    operational_role: effectiveRole,
                    company_id: assignedCompanyId,
                    company_name: assignedCompanyName,
                    branch_name: profile.branch_name || "Headquarters",
                    branch_location: profile.branch_location || "Lucena",
                    session_time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                }
            };

            const notifStoreKey = 'rmims_notifications_live_v2';
            const existingRaw = localStorage.getItem(notifStoreKey);
            const existingList = existingRaw ? JSON.parse(existingRaw) : [];
            existingList.unshift(loginNotification);
            localStorage.setItem(notifStoreKey, JSON.stringify(existingList.slice(0, 100)));
            window.dispatchEvent(new CustomEvent('rmims:notification_change'));
            window.dispatchEvent(new Event('storage'));

            // Record live detected account login activity across all user roles (Admin, Manager, Staff)
            try {
                const nowIso = new Date().toISOString();
                const nowCleanDate = nowIso.slice(0, 10);
                const cleanLoc = (isAdmin ? 'Headquarters' : (profile.branch_location || (isScones ? 'Lucena' : 'Tiaong'))).trim();
                const cleanBranchName = (isAdmin ? 'Main Administration' : (profile.branch_name || assignedCompanyName)).trim();
                
                const liveLoginActivity = {
                    id: `act-login-${profile.id}-${Date.now()}`,
                    timestamp: nowIso,
                    date: nowCleanDate,
                    user: sessionFullName,
                    role: destinationRoleLabel,
                    branchLoc: cleanLoc,
                    branchName: cleanBranchName,
                    action: 'Login',
                    module: 'Authentication',
                    details: `${destinationRoleLabel} ${sessionFullName} signed in to ${cleanBranchName} (${cleanLoc}). Session authenticated.`,
                    status: 'success'
                };

                const rawMgrActs = localStorage.getItem('rmims_manager_activities');
                const mgrActsList = rawMgrActs ? JSON.parse(rawMgrActs) : [];
                mgrActsList.unshift(liveLoginActivity);
                localStorage.setItem('rmims_manager_activities', JSON.stringify(mgrActsList.slice(0, 200)));

                // Also persist to Supabase admin_activity_logs if connected
                if (supabase) {
                    supabase.from('admin_activity_logs').insert([{
                        id: liveLoginActivity.id,
                        user_name: liveLoginActivity.user,
                        role: liveLoginActivity.role,
                        branch_location: liveLoginActivity.branchLoc,
                        branch_name: liveLoginActivity.branchName,
                        action: liveLoginActivity.action,
                        module: liveLoginActivity.module,
                        details: liveLoginActivity.details,
                        status: liveLoginActivity.status,
                        timestamp: liveLoginActivity.timestamp
                    }]).then(() => {}).catch(() => {});
                }
            } catch (_) {}
        } catch (e) { }

        // Step 4: Final verification & launch directly to the user's role workspace
        await sleep(600);
        updateAuthProgress(transDOM, 100, `Access Granted! Launching ${destinationRoleLabel} Dashboard...`);

        // Smooth 650ms completion pause for visual delight
        await sleep(650);

        // Clear any previous failed login attempt counters for this user upon success
        clearLoginFailure(email);

        // Route admin to Admin Overview, manager to Manager Dashboard, staff to User Dashboard
        const destination = isAdmin
            ? "admin/overview.html"
            : (isManager ? "manager/dashboard.html" : "user/dashboard.html");
        window.location.assign(new URL(destination, window.location.href).href);

    } catch (err) {
        // If authentication fails, gracefully hide the transition overlay so the error is visible
        hideAuthTransition(transDOM);
        throw err;
    }
}

/**
 * Signs the user out of Supabase Auth.
 */
export async function signOutUser() {
    try {
        sessionStorage.removeItem("rmims_login_session_id");
        sessionStorage.removeItem("rmims_session_login_recorded");
    } catch (e) { }
    const { error } = await supabase.auth.signOut();
    if (error) console.warn("Supabase signOut notice:", error);
}

/**
 * Signs up a new end-user (Staff / Manager) into Supabase.
 * Enforces that created accounts are End Users, assigned with 'pending' status
 * strictly requiring Admin confirmation before access is granted.
 */
export async function signUpUser({ fullName, email, username, password, branchName, branchLocation, branchStore, role, companyId, companyName }) {
    if (!email || !password) {
        throw new Error("Email and password are required.");
    }
    if (!username || !username.trim()) {
        throw new Error("Username is required.");
    }
    const cleanUsername = username.trim();
    if (cleanUsername.length < 3) {
        throw new Error("Username must be at least 3 characters.");
    }

    const combinedBranch = (branchName && branchLocation)
        ? `${branchName.trim()} (${branchLocation.trim()})`
        : (branchName?.trim() || branchStore || branchLocation?.trim() || "General Operations");

    const strToCheck = [
        companyId,
        companyName,
        branchName,
        branchLocation,
        branchStore
    ].map(s => String(s || '').toLowerCase()).join(' ');

    const isScones = strToCheck.includes("1872cf44-e821-4370-b227-d1b7e4fc6f56") ||
        strToCheck.includes("scones") ||
        strToCheck.includes("muffin") ||
        strToCheck.includes("nutribun") ||
        strToCheck.includes("bakery");

    const assignedCompanyId = isScones ? "1872cf44-e821-4370-b227-d1b7e4fc6f56" : "a72a7971-6ec7-4edc-ae72-89d702199ed9";
    const assignedCompanyName = isScones ? "Scones & Muffins Bakery" : "KXC 5-Year Enterprise";
    const assignedDatasetFolder = isScones ? "1872cf44-e821-4370-b227-d1b7e4fc6f56" : "a72a7971-6ec7-4edc-ae72-89d702199ed9";

    // Explicitly enforce end-user operational roles only (never admin)
    const validRoles = ["staff", "manager", "user", "user_staff"];
    const operationalRole = validRoles.includes(role) ? role : "staff";

    // Use non-persisting ephemeral client for signup so browser session is preserved
    let signUpClient = supabase;
    try {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("./supabase-config.js");
        signUpClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });
    } catch (_) {}

    const { data, error } = await signUpClient.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
            data: {
                full_name: fullName.trim(),
                username: cleanUsername,
                branch_store: combinedBranch,
                branch_name: branchName?.trim() || (isScones ? "Scones & Muffins Store" : "Branch Store"),
                branch_location: branchLocation?.trim() || "Lucena",
                operational_role: operationalRole,
                role: "user", // base role for schema access
                status: "pending", // Strictly requires Admin approval
                company_id: assignedCompanyId,
                company_name: assignedCompanyName,
                dataset_folder: assignedDatasetFolder
            }
        }
    });

    if (error) {
        throw new Error(friendlyAuthError(error));
    }

    // Record profile in user_profiles with status: 'pending'
    if (data?.user?.id) {
        try {
            const profilePayload = {
                id: data.user.id,
                email: email.trim(),
                full_name: fullName.trim(),
                username: cleanUsername,
                role: "user",
                operational_role: operationalRole,
                branch_name: branchName?.trim() || (isScones ? "Scones & Muffins Store" : "Branch Store"),
                branch_location: branchLocation?.trim() || "Lucena",
                branch_store: combinedBranch,
                status: "pending", // Strictly requires Admin approval
                company_id: assignedCompanyId,
                company_name: assignedCompanyName,
                dataset_folder: assignedDatasetFolder
            };

            const { error: upsertErr } = await supabase.from("user_profiles").upsert(profilePayload);
            if (upsertErr) {
                console.warn("user_profiles initialization notice:", upsertErr);
            }
        } catch (insertErr) {
            console.log("user_profiles initialization notice:", insertErr);
        }

        // Strictly place in pending queue for Admin approval.
        // DO NOT put in rmims_registered_users until approved by Admin!
        try {
            const pendingList = JSON.parse(localStorage.getItem('rmims_pending_users') || '[]');
            if (!pendingList.some(u => u.email && u.email.toLowerCase() === email.trim().toLowerCase())) {
                pendingList.unshift({
                    id: data.user.id,
                    name: fullName.trim(),
                    username: cleanUsername,
                    email: email.trim(),
                    role: operationalRole === 'manager' ? 'Manager' : 'Staff',
                    branchName: branchName?.trim() || 'Branch Store',
                    branchLoc: branchLocation?.trim() || 'Lucena',
                    status: 'Pending',
                    requestedOn: new Date().toISOString()
                });
                localStorage.setItem('rmims_pending_users', JSON.stringify(pendingList));
                window.dispatchEvent(new Event('rmims_pending_users_updated'));
            }
            window.dispatchEvent(new Event('storage'));
        } catch (_) {}
    }

    return {
        user: data.user,
        username: cleanUsername,
        session: null
    };
}

