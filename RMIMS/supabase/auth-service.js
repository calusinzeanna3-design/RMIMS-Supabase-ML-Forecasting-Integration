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
        // Step 1: Sign in with Supabase Auth
        const authPromise = supabase.auth.signInWithPassword({
            email: email.trim(),
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
                recordLoginFailure(email);
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

                profile = {
                    id: uid,
                    full_name: meta.full_name || data.user.email.split('@')[0],
                    email: data.user.email,
                    role: meta.role || "user",
                    operational_role: meta.operational_role || "staff",
                    status: meta.status || "active",
                    username: meta.username || data.user.email.split('@')[0],
                    branch_name: meta.branch_name || (isScones ? "Scones & Muffins Store" : "Branch Store"),
                    branch_location: meta.branch_location || "Lucena",
                    branch_store: meta.branch_store || (isScones ? "Scones & Muffins Bakery (Lucena)" : "Branch Store (Lucena)"),
                    company_id: assignedCompanyId,
                    company_name: assignedCompanyName,
                    dataset_folder: assignedDatasetFolder
                };
                profileError = null;
            } catch (e) { }
        }

        if (profileError || !profile) {
            await supabase.auth.signOut();
            throw new Error("No account profile record found. Please contact an Administrator.");
        }

        const cleanEmail = (data.user?.email || "").toLowerCase();
        const isMasterAdmin = cleanEmail === "calusinzeanna3@gmail.com";

        if (isMasterAdmin) {
            profile.role = "admin";
            profile.operational_role = "admin";
            profile.status = "active";
            profile.full_name = profile.full_name || "Zeanna";
            // Ensure Supabase user_profiles table also updates to active if possible
            try {
                await supabase.from("user_profiles").update({ status: "active", role: "admin", full_name: "Zeanna" }).eq("id", uid);
            } catch (_) {}
        }

        // Check for pending admin confirmation (Admins are the sole authority for account approvals)
        let isLocallyApproved = false;
        try {
            const regUsers = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
            isLocallyApproved = regUsers.some(u => 
                (u.email && u.email.toLowerCase() === cleanEmail) ||
                (u.username && profile.username && u.username.toLowerCase() === profile.username.toLowerCase())
            );
        } catch (_) {}

        if (!isMasterAdmin && (profile.status === "pending" || profile.status === "pending_approval")) {
            if (isLocallyApproved) {
                profile.status = "active";
                try {
                    await supabase.rpc('admin_approve_user', { p_identifier: cleanEmail });
                } catch (_) {}
            } else {
                await supabase.auth.signOut();
                throw new Error("Your account is pending Administrator approval. Please wait for an Administrator to verify and activate your account before signing in.");
            }
        }

        const isDumpAccount = cleanEmail === "admin@rmims.ph" || cleanEmail === "manager@rmims.ph" || cleanEmail === "staff@rmims.ph" || cleanEmail === "asst.manager@rmims.ph";
        if (isDumpAccount) {
            await supabase.auth.signOut();
            throw new Error("This demo account has been permanently disconnected from the system.");
        }

        if (!isMasterAdmin && profile.status !== "active") {
            await supabase.auth.signOut();
            throw new Error("Your account is inactive. Please contact an Administrator.");
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

        if (expectedRole === "manager" && !isManager && !isAdmin) {
            await supabase.auth.signOut();
            throw new Error("Access denied. Manager privileges required.");
        }

        if (expectedRole === "user" && (isManager || isAdmin)) {
            await supabase.auth.signOut();
            throw new Error("Access denied. Please use the appropriate workspace.");
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
            branchName: profile.branch_name || (isScones ? "Scones & Muffins Store" : "Branch Store"),
            branchLocation: profile.branch_location || "Lucena",
            branchStore: profile.branch_store || (isScones ? "Scones & Muffins Bakery (Lucena)" : "Branch Store (Lucena)"),
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

    const { data, error } = await supabase.auth.signUp({
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
                status: "pending", // pending admin confirmation
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
                status: "pending", // requires Admin confirmation
                company_id: assignedCompanyId,
                company_name: assignedCompanyName,
                dataset_folder: assignedDatasetFolder
            };

            const { error: upsertErr } = await supabase.from("user_profiles").upsert(profilePayload);
            if (upsertErr) {
                console.warn("user_profiles initialization notice:", upsertErr);
                // Fallback for pre-migration databases with legacy status check constraint
                if (upsertErr.message && upsertErr.message.includes("violates check constraint")) {
                    await supabase.from("user_profiles").upsert({
                        id: data.user.id,
                        email: email.trim(),
                        full_name: fullName.trim(),
                        role: "user",
                        status: "inactive"
                    });
                }
            }
        } catch (insertErr) {
            console.log("user_profiles initialization notice:", insertErr);
        }
    }

    // Since this account is pending Admin approval, sign out any auto-established session
    try {
        await supabase.auth.signOut();
    } catch (signOutErr) {
        // Non-blocking
    }

    return {
        user: data.user,
        username: cleanUsername,
        session: null
    };
}

