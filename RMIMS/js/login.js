import { loginUser } from "../supabase/auth-service.js";
import { supabase } from "../supabase/supabase-config.js";

const loginForm = document.getElementById("loginForm");
const loginErrorEl = document.getElementById("loginError");
const loginSubmitBtn = document.getElementById("loginSubmitBtn");
const togglePw = document.getElementById("togglePw");
const passwordInput = document.getElementById("password");

function setLoginError(message) {
    loginErrorEl.style.color = "";
    loginErrorEl.textContent = message;
    loginErrorEl.classList.toggle("error", !!message);
}

function setLoginSuccess(message) {
    loginErrorEl.style.color = "#22C55E";
    loginErrorEl.textContent = message;
    loginErrorEl.classList.remove("error");
}

if (togglePw && passwordInput) {
    togglePw.addEventListener("click", () => {
        const isHidden = passwordInput.type === "password";
        passwordInput.type = isHidden ? "text" : "password";
        togglePw.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
}

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setLoginError("");

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    loginSubmitBtn.disabled = true;

    try {
        await loginUser(email, password, "admin");
    } catch (err) {
        setLoginError(err.message || "Unable to sign in. Please check your details and try again.");
        loginSubmitBtn.disabled = false;
    }
});

/* =========================================================
   FORGOT PASSWORD MODAL LOGIC
   ========================================================= */

const forgotPassLink = document.getElementById("forgotPassLink");
const forgotModal = document.getElementById("forgotPasswordModal");
const closeForgotModalBtn = document.getElementById("closeForgotModalBtn");
const cancelForgotBtn = document.getElementById("cancelForgotBtn");
const forgotForm = document.getElementById("forgotPasswordForm");
const forgotEmailInput = document.getElementById("forgotEmail");
const forgotMsg = document.getElementById("forgotMsg");
const sendForgotBtn = document.getElementById("sendForgotBtn");

function openForgotModal() {
    const currentEmail = document.getElementById("email")?.value.trim() || "";
    if (currentEmail) forgotEmailInput.value = currentEmail;
    forgotMsg.className = "auth-modal-msg";
    forgotMsg.textContent = "";
    forgotModal.classList.add("active");
    forgotModal.setAttribute("aria-hidden", "false");
}

function closeForgotModal() {
    forgotModal.classList.remove("active");
    forgotModal.setAttribute("aria-hidden", "true");
}

if (forgotPassLink) {
    forgotPassLink.addEventListener("click", (e) => {
        e.preventDefault();
        openForgotModal();
    });
}

if (closeForgotModalBtn) closeForgotModalBtn.addEventListener("click", closeForgotModal);
if (cancelForgotBtn) cancelForgotBtn.addEventListener("click", closeForgotModal);
if (forgotModal) {
    forgotModal.addEventListener("click", (e) => {
        if (e.target === forgotModal) closeForgotModal();
    });
}

if (forgotForm) {
    forgotForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = forgotEmailInput.value.trim();
        if (!email) return;

        forgotMsg.className = "auth-modal-msg";
        forgotMsg.textContent = "";
        sendForgotBtn.disabled = true;
        const origHtml = sendForgotBtn.innerHTML;
        sendForgotBtn.innerHTML = `<span class="auth-spinner"></span> Sending...`;

        try {
            const redirectUrl = window.location.href.split("#")[0];
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: redirectUrl
            });
            if (error) throw error;

            forgotMsg.className = "auth-modal-msg success";
            forgotMsg.textContent = "Recovery link sent! Please check your email inbox.";
            setTimeout(() => {
                closeForgotModal();
                setLoginSuccess("Password reset email sent! Check your inbox.");
            }, 3000);

        } catch (err) {
            forgotMsg.className = "auth-modal-msg error";
            forgotMsg.textContent = err.message || "Failed to send reset link. Please check your email and try again.";
        } finally {
            sendForgotBtn.disabled = false;
            sendForgotBtn.innerHTML = origHtml;
        }
    });
}

/* =========================================================
   SET NEW PASSWORD MODAL (PASSWORD RECOVERY FROM EMAIL LINK)
   ========================================================= */

const setNewPasswordModal = document.getElementById("setNewPasswordModal");
const setNewPasswordForm = document.getElementById("setNewPasswordForm");
const newPasswordInput = document.getElementById("newPassword");
const confirmNewPasswordInput = document.getElementById("confirmNewPassword");
const toggleNewPw = document.getElementById("toggleNewPw");
const toggleConfirmPw = document.getElementById("toggleConfirmPw");
const resetMsg = document.getElementById("resetMsg");
const saveNewPasswordBtn = document.getElementById("saveNewPasswordBtn");

function openSetNewPasswordModal() {
    resetMsg.className = "auth-modal-msg";
    resetMsg.textContent = "";
    if (setNewPasswordModal) {
        setNewPasswordModal.classList.add("active");
        setNewPasswordModal.setAttribute("aria-hidden", "false");
    }
}

function closeSetNewPasswordModal() {
    if (setNewPasswordModal) {
        setNewPasswordModal.classList.remove("active");
        setNewPasswordModal.setAttribute("aria-hidden", "true");
    }
}

function bindToggle(btn, input) {
    if (!btn || !input) return;
    btn.addEventListener("click", () => {
        const isHidden = input.type === "password";
        input.type = isHidden ? "text" : "password";
        btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
}

bindToggle(toggleNewPw, newPasswordInput);
bindToggle(toggleConfirmPw, confirmNewPasswordInput);

let recoveryTokens = null;

// Check if arriving with recovery token in URL hash or search params
function checkRecoveryState() {
    const hash = window.location.hash || "";
    const search = window.location.search || "";

    if (hash.includes("error=") || search.includes("error=")) {
        try {
            const raw = hash.startsWith("#") ? hash.substring(1) : (search.startsWith("?") ? search.substring(1) : "");
            const params = new URLSearchParams(raw);
            const desc = params.get("error_description");
            if (desc) {
                setLoginError(decodeURIComponent(desc.replace(/\+/g, " ")));
            }
        } catch (e) {}
    }

    const isRecovery = hash.includes("type=recovery") || search.includes("type=recovery") || hash.includes("access_token=");
    
    if (isRecovery) {
        try {
            const rawParams = hash.startsWith("#") ? hash.substring(1) : (search.startsWith("?") ? search.substring(1) : "");
            const urlParams = new URLSearchParams(rawParams);
            const accessToken = urlParams.get("access_token");
            const refreshToken = urlParams.get("refresh_token");

            if (accessToken) {
                recoveryTokens = { accessToken, refreshToken };
                supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken || ""
                }).catch(e => console.warn("Recovery session init notice:", e));
            }
        } catch (e) {
            console.warn("Parse recovery params error:", e);
        }

        openSetNewPasswordModal();
    }
}

checkRecoveryState();

// Also listen to Supabase Auth State for PASSWORD_RECOVERY
supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && window.location.hash.includes("type=recovery"))) {
        if (session && session.access_token) {
            recoveryTokens = { accessToken: session.access_token, refreshToken: session.refresh_token };
        }
        openSetNewPasswordModal();
    }
});

if (setNewPasswordForm) {
    setNewPasswordForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const newPass = newPasswordInput.value;
        const confirmPass = confirmNewPasswordInput.value;

        resetMsg.className = "auth-modal-msg";
        resetMsg.textContent = "";

        if (newPass.length < 8) {
            resetMsg.className = "auth-modal-msg error";
            resetMsg.textContent = "Password must be at least 8 characters.";
            return;
        }

        if (newPass !== confirmPass) {
            resetMsg.className = "auth-modal-msg error";
            resetMsg.textContent = "Passwords do not match. Please re-enter.";
            return;
        }

        saveNewPasswordBtn.disabled = true;
        const origHtml = saveNewPasswordBtn.innerHTML;
        saveNewPasswordBtn.innerHTML = `<span class="auth-spinner"></span> Updating Password...`;

        try {
            // Guarantee active session from token if available
            if (recoveryTokens && recoveryTokens.accessToken) {
                await supabase.auth.setSession({
                    access_token: recoveryTokens.accessToken,
                    refresh_token: recoveryTokens.refreshToken || ""
                }).catch(err => console.warn("Session ensure warning:", err));
            }

            const { error } = await supabase.auth.updateUser({
                password: newPass
            });

            if (error) throw error;

            resetMsg.className = "auth-modal-msg success";
            resetMsg.textContent = "Password updated successfully! Redirecting to sign in...";

            // Clean hash from URL bar
            if (window.history.replaceState) {
                window.history.replaceState(null, document.title, window.location.pathname);
            }

            setTimeout(() => {
                closeSetNewPasswordModal();
                setLoginSuccess("Password updated successfully! Please sign in with your new password.");
                passwordInput.value = "";
                passwordInput.focus();
            }, 1800);

        } catch (err) {
            resetMsg.className = "auth-modal-msg error";
            resetMsg.textContent = err.message || "Failed to update password. Please try again.";
        } finally {
            saveNewPasswordBtn.disabled = false;
            saveNewPasswordBtn.innerHTML = origHtml;
        }
    });
}
