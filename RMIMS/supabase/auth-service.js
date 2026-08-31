import { supabase } from "./supabase-config.js";

/**
 * Format auth errors into clean, user-friendly messages without exposing sensitive details.
 */
function friendlyAuthError(error) {
    if (!error) return "Unable to sign in. Please try again.";
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("invalid login credentials") || msg.includes("invalid credential")) {
        return "Invalid email or password. Please check your credentials and try again.";
    }
    if (msg.includes("email not confirmed")) {
        return "Your email address has not been confirmed. Please verify your email before logging in.";
    }
    if (msg.includes("too many requests") || msg.includes("rate limit")) {
        return "Too many sign in attempts. Please wait a few moments and try again.";
    }
    return error.message || "Unable to sign in. Please check your details and try again.";
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
        
        const isUserPortal = expectedRole === "user";
        const roleLabel = isUserPortal ? "Staff Workspace" : "Administrator Workspace";
        const isRMIMSPath = window.location.pathname.toLowerCase().includes("/rmims");
        const videoSrc = isRMIMSPath ? "/RMIMS/assets/auth-transition.mp4" : "assets/auth-transition.mp4";

        overlay.innerHTML = `
            <div class="auth-transition-card" role="status" aria-live="polite">
                <div class="auth-video-wrapper">
                    <video class="auth-transition-video" autoplay loop muted playsinline preload="auto">
                        <source src="${videoSrc}" type="video/mp4">
                    </video>
                </div>
                <div class="auth-trans-header">
                    <h3 class="auth-trans-title">Authenticating Session</h3>
                    <p class="auth-trans-sub">Connecting to ${roleLabel}...</p>
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
        message: overlay.querySelector("#authStatusMessage"),
        percent: overlay.querySelector("#authPercentText"),
        video: overlay.querySelector(".auth-transition-video")
    };
}

function updateAuthProgress(dom, percentage, messageText) {
    if (!dom) return;
    if (dom.bar) dom.bar.style.width = `${percentage}%`;
    if (dom.percent) dom.percent.textContent = `${Math.round(percentage)}%`;
    if (dom.message) dom.message.textContent = messageText;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function showAuthTransition(expectedRole, initialMessage = "Connecting to Supabase Authentication...", initialPercent = 15) {
    const dom = ensureAuthTransitionDOM(expectedRole);
    dom.overlay.classList.add("is-active");
    dom.overlay.setAttribute("aria-hidden", "false");
    if (dom.video) {
        dom.video.currentTime = 0;
        dom.video.play().catch(() => {});
    }
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

        const profilePromise = supabase
            .from("user_profiles")
            .select("id, full_name, email, role, status")
            .eq("id", uid)
            .maybeSingle();

        const { data: profile, error: profileError } = await profilePromise;

        if (profileError || !profile) {
            await supabase.auth.signOut();
            throw new Error("No account profile record found. Please contact your administrator.");
        }

        if (profile.status !== "active") {
            await supabase.auth.signOut();
            throw new Error("Your account is pending admin approval or inactive. Please contact your administrator.");
        }

        // Strict role gating per portal
        if (expectedRole === "admin" && profile.role !== "admin") {
            await supabase.auth.signOut();
            throw new Error("Access denied. Administrator privileges required.");
        }

        if (expectedRole === "user" && profile.role !== "user") {
            await supabase.auth.signOut();
            throw new Error("Access denied. Please use the Admin Sign In portal.");
        }

        // Step 3: Synchronize session storage
        await sleep(650);
        updateAuthProgress(transDOM, 88, "Synchronizing workspace session & inventory state...");

        const sessionUser = {
            id: profile.id,
            fullName: profile.full_name || profile.email,
            name: profile.full_name || profile.email,
            email: profile.email,
            role: profile.role,
            status: profile.status
        };

        try {
            localStorage.setItem("currentUser", JSON.stringify(sessionUser));
            localStorage.setItem("rmimsCurrentUser", JSON.stringify(sessionUser));
            localStorage.setItem("userProfile", JSON.stringify(sessionUser));
            sessionStorage.setItem("rmims_login_session_id", `login-${profile.id}-${Date.now()}`);
            sessionStorage.removeItem("rmims_session_login_recorded");
        } catch (e) { }

        // Step 4: Final verification & launch
        await sleep(600);
        updateAuthProgress(transDOM, 100, "Access Granted! Launching Workspace Dashboard...");

        // Smooth 650ms completion pause for visual delight
        await sleep(650);

        // Role-based destination routing
        const isRMIMSPath = window.location.pathname.toLowerCase().includes("/rmims");
        if (profile.role === "admin") {
            const target = isRMIMSPath ? "/RMIMS/admin/dashboard.html" : "admin/dashboard.html";
            window.location.href = target;
        } else {
            const target = isRMIMSPath ? "/RMIMS/user/dashboard.html" : "user/dashboard.html";
            window.location.href = target;
        }

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