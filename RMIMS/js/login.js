import { loginUser, signUpUser } from "../supabase/auth-service.js";
import { supabase } from "../supabase/supabase-config.js";

/* =========================================================
   DOM ELEMENTS: SIGN IN
   ========================================================= */

const signInView = document.getElementById("signInView");
const loginForm = document.getElementById("loginForm");
const loginErrorEl = document.getElementById("loginError");
const loginSubmitBtn = document.getElementById("loginSubmitBtn");
const togglePw = document.getElementById("togglePw");
const passwordInput = document.getElementById("password");
const toCreateAccountBtn = document.getElementById("toCreateAccountBtn");

/* =========================================================
   DOM ELEMENTS: CREATE ACCOUNT (END USER - SEPARATED SECTIONS)
   ========================================================= */

const createAccountView = document.getElementById("createAccountView");
const toSignInBtn = document.getElementById("toSignInBtn");
const toSignInFromS1Btn = document.getElementById("toSignInFromS1Btn");
const cancelToLoginBtn = document.getElementById("cancelToLoginBtn");
const backToLoginBtn = document.getElementById("backToLoginBtn");
const createAccountForm = document.getElementById("createAccountForm");

// Section 1: Profile & Operational Assignment
const regSection1 = document.getElementById("regSection1");
const regFullName = document.getElementById("regFullName");
const regEmail = document.getElementById("regEmail");
const regUsername = document.getElementById("regUsername");
const regBranchName = document.getElementById("regBranchName");
const regBranchLocation = document.getElementById("regBranchLocation");
const regRole = document.getElementById("regRole");
const regSection1Error = document.getElementById("regSection1Error");
const toSection2Btn = document.getElementById("toSection2Btn");

// Section 2: Security & Password
const regSection2 = document.getElementById("regSection2");
const displayHandleTag = document.getElementById("displayHandleTag");
const backToSection1Btn = document.getElementById("backToSection1Btn");
const backToSec1Btn = document.getElementById("backToSec1Btn");
const regPassword = document.getElementById("regPassword");
const regConfirmPassword = document.getElementById("regConfirmPassword");
const toggleRegPw = document.getElementById("toggleRegPw");
const toggleRegConfirmPw = document.getElementById("toggleRegConfirmPw");
const regSection2Error = document.getElementById("regSection2Error");
const regSubmitBtn = document.getElementById("regSubmitBtn");

/* =========================================================
   STATUS MESSAGE HELPERS
   ========================================================= */

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}

function setLoginError(message) {
    if (!loginErrorEl) return;
    loginErrorEl.style.color = "";
    if (!message) {
        loginErrorEl.textContent = "";
        loginErrorEl.className = "form-note";
        return;
    }
    // Check if the message indicates pending administrator approval
    if (message.toLowerCase().includes("pending administrator approval") || message.toLowerCase().includes("pending admin") || message.toLowerCase().includes("pending approval") || message.toLowerCase().includes("pending manager")) {
        loginErrorEl.className = "form-note warning";
        loginErrorEl.innerHTML = `<strong>⏳ Awaiting Admin Approval:</strong> ${escapeHtml(message)}`;
    } else {
        loginErrorEl.className = "form-note error";
        loginErrorEl.textContent = message;
    }
}

function setLoginSuccess(message) {
    if (!loginErrorEl) return;
    loginErrorEl.style.color = "";
    if (!message) {
        loginErrorEl.textContent = "";
        loginErrorEl.className = "form-note";
        return;
    }
    loginErrorEl.className = "form-note success";
    loginErrorEl.innerHTML = `<strong>✓ Account Ready:</strong> ${message}`;
}

function setRegSection1Error(message) {
    if (!regSection1Error) return;
    regSection1Error.textContent = message;
    regSection1Error.classList.toggle("error", !!message);
}

function setRegSection2Error(message) {
    if (!regSection2Error) return;
    regSection2Error.textContent = message;
    regSection2Error.classList.toggle("error", !!message);
}

/* =========================================================
   PASSWORD VISIBILITY TOGGLE HELPER
   ========================================================= */

function bindPasswordToggle(btn, input) {
    if (!btn || !input) return;
    btn.addEventListener("click", () => {
        const isHidden = input.type === "password";
        input.type = isHidden ? "text" : "password";
        btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
}

bindPasswordToggle(togglePw, passwordInput);
bindPasswordToggle(toggleRegPw, regPassword);
bindPasswordToggle(toggleRegConfirmPw, regConfirmPassword);

/* =========================================================
   VIEW SWITCHING: SIGN IN <-> CREATE ACCOUNT
   ========================================================= */

function showCreateAccountView() {
    const authPanel = document.getElementById("authPanel") || document.querySelector(".workspace-panel.auth-panel");
    if (authPanel) authPanel.classList.add("wide-panel");
    if (signInView) {
        signInView.style.display = "none";
        signInView.classList.remove("active");
    }
    if (createAccountView) {
        createAccountView.style.display = "block";
        createAccountView.classList.add("active");
    }
    resetCreateAccountForm();
}

function showSignInView() {
    const authPanel = document.getElementById("authPanel") || document.querySelector(".workspace-panel.auth-panel");
    if (authPanel) authPanel.classList.remove("wide-panel");
    if (createAccountView) {
        createAccountView.style.display = "none";
        createAccountView.classList.remove("active");
    }
    if (signInView) {
        signInView.style.display = "block";
        signInView.classList.add("active");
    }
    setLoginError("");
}

if (toCreateAccountBtn) {
    toCreateAccountBtn.addEventListener("click", (e) => {
        e.preventDefault();
        showCreateAccountView();
        window.location.hash = "create-account";
    });
}

if (toSignInBtn) {
    toSignInBtn.addEventListener("click", (e) => {
        e.preventDefault();
        showSignInView();
        if (window.location.hash === "#create-account") {
            if (window.history.replaceState) {
                window.history.replaceState(null, document.title, window.location.pathname);
            }
        }
    });
}

if (toSignInFromS1Btn) {
    toSignInFromS1Btn.addEventListener("click", (e) => {
        e.preventDefault();
        showSignInView();
        if (window.location.hash === "#create-account") {
            if (window.history.replaceState) {
                window.history.replaceState(null, document.title, window.location.pathname);
            }
        }
    });
}

// Support opening directly with #create-account in URL
if (window.location.hash === "#create-account") {
    showCreateAccountView();
}

/* =========================================================
   UNIFIED SIGN IN SUBMISSION (NO ROLE HARDCODING)
   ========================================================= */

if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setLoginError("");

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        loginSubmitBtn.disabled = true;

        try {
            // Unified login: does not restrict by role; routes dynamically based on account profile
            await loginUser(email, password);
        } catch (err) {
            setLoginError(err.message || "Unable to sign in. Please check your details and try again.");
            loginSubmitBtn.disabled = false;
        }
    });
}

/* =========================================================
   CREATE ACCOUNT (END USER): SEPARATED SECTIONS FLOW LOGIC
   ========================================================= */

function resetCreateAccountForm() {
    setRegSection1Error("");
    setRegSection2Error("");
    if (createAccountForm) {
        createAccountForm.reset();
    }
    if (regSection1) regSection1.style.display = "block";
    if (regSection2) regSection2.style.display = "none";
    if (displayHandleTag) displayHandleTag.textContent = "username";
}

// Cancel / Back to Login buttons
if (cancelToLoginBtn) {
    cancelToLoginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        showSignInView();
    });
}

if (backToLoginBtn) {
    backToLoginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        showSignInView();
    });
}

// Username input listener: clear error on input without restricting typing
if (regUsername) {
    regUsername.addEventListener("input", () => {
        setRegSection1Error("");
    });
}

// Transition from Section 1 (Profile & Assignment) to Section 2 (Password Security)
if (toSection2Btn) {
    toSection2Btn.addEventListener("click", () => {
        setRegSection1Error("");

        const fullName = regFullName?.value.trim() || "";
        const email = regEmail?.value.trim() || "";
        const username = regUsername?.value.trim() || "";
        const branchName = regBranchName?.value.trim() || "";
        const branchLocation = regBranchLocation?.value || "";

        if (!fullName) {
            setRegSection1Error("Please enter your full name.");
            regFullName?.focus();
            return;
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setRegSection1Error("Please enter a valid email address.");
            regEmail?.focus();
            return;
        }

        if (!username || username.length < 3) {
            setRegSection1Error("Username must be at least 3 characters long.");
            regUsername?.focus();
            return;
        }

        if (!branchName) {
            setRegSection1Error("Please enter your company / branch store name.");
            regBranchName?.focus();
            return;
        }

        if (!branchLocation) {
            setRegSection1Error("Please select your branch location.");
            regBranchLocation?.focus();
            return;
        }

        // Validated: Proceed to Section 2
        if (displayHandleTag) {
            displayHandleTag.textContent = username;
        }

        if (regSection1) regSection1.style.display = "none";
        if (regSection2) {
            regSection2.style.display = "block";
            regSection2.classList.remove("fadeInSection");
            void regSection2.offsetWidth; // trigger reflow
            regSection2.classList.add("fadeInSection");
        }

        if (regPassword) {
            regPassword.focus();
        }
    });
}

// Back to Section 1 button handlers
function returnToSection1() {
    setRegSection2Error("");
    if (regSection2) regSection2.style.display = "none";
    if (regSection1) {
        regSection1.style.display = "block";
        regSection1.classList.remove("fadeInSection");
        void regSection1.offsetWidth; // trigger reflow
        regSection1.classList.add("fadeInSection");
    }
    if (regUsername) {
        regUsername.focus();
    }
}

if (backToSection1Btn) {
    backToSection1Btn.addEventListener("click", (e) => {
        e.preventDefault();
        returnToSection1();
    });
}

if (backToSec1Btn) {
    backToSec1Btn.addEventListener("click", (e) => {
        e.preventDefault();
        returnToSection1();
    });
}

// Unified Account Creation Submission (Section 2 Complete)
if (createAccountForm) {
    createAccountForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setRegSection2Error("");

        const fullName = regFullName?.value.trim() || "";
        const email = regEmail?.value.trim() || "";
        const username = regUsername?.value.trim() || "";
        const branchName = regBranchName?.value.trim() || "";
        const branchLocation = regBranchLocation?.value || "";
        const role = regRole?.value || "staff";
        const password = regPassword?.value || "";
        const confirmPassword = regConfirmPassword?.value || "";

        // Double-check Section 1 values
        if (!fullName || !email || !username || !branchName || !branchLocation) {
            returnToSection1();
            setRegSection1Error("Please complete your profile and branch assignment details.");
            return;
        }

        if (password.length < 6) {
            setRegSection2Error("Password must be at least 6 characters long.");
            regPassword?.focus();
            return;
        }

        if (password !== confirmPassword) {
            setRegSection2Error("Passwords do not match. Please re-enter your password.");
            regConfirmPassword?.focus();
            return;
        }

        regSubmitBtn.disabled = true;
        const origSubmitHtml = regSubmitBtn.innerHTML;
        regSubmitBtn.innerHTML = `<span class="auth-spinner"></span> Creating Account...`;

        try {
            await signUpUser({
                fullName,
                email,
                username,
                password,
                branchName,
                branchLocation,
                role
            });

            // Mirror to registered users directory as active immediately
            try {
                const regList = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
                const alreadyExists = regList.some(p => (p.email && p.email.toLowerCase() === email.toLowerCase()) || (p.username && p.username.toLowerCase() === username.toLowerCase()));
                if (!alreadyExists) {
                    const now = new Date();
                    const dateFormatted = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) + ' ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                    const strToCheck = [branchName, branchLocation].map(s => String(s || '').toLowerCase()).join(' ');
                    const isScones = strToCheck.includes("scones") || strToCheck.includes("muffin") || strToCheck.includes("bakery") || strToCheck.includes("nutribun");
                    const compId = isScones ? "1872cf44-e821-4370-b227-d1b7e4fc6f56" : "a72a7971-6ec7-4edc-ae72-89d702199ed9";
                    const compName = isScones ? "Scones & Muffins Bakery" : "KXC 5-Year Enterprise";
                    const compFolder = isScones ? "1872cf44-e821-4370-b227-d1b7e4fc6f56" : "a72a7971-6ec7-4edc-ae72-89d702199ed9";

                    regList.unshift({
                        id: regResult?.user?.id || `user-${Date.now()}`,
                        name: fullName,
                        username: username,
                        email: email,
                        companyId: compId,
                        company_id: compId,
                        companyName: compName,
                        company_name: compName,
                        datasetFolder: compFolder,
                        dataset_folder: compFolder,
                        branchName: branchName.trim(),
                        branchLoc: branchLocation.trim(),
                        role: role === 'manager' ? 'Manager' : 'Staff',
                        status: 'Active',
                        created_at: new Date().toISOString()
                    });
                    localStorage.setItem('rmims_registered_users', JSON.stringify(regList));

                    // Broadcast active registration notification scoped to admin
                    try {
                      if (typeof window.pushRMIMSNotification === 'function') {
                        window.pushRMIMSNotification({
                          title: `New User Registered: ${fullName}`,
                          message: `${fullName} has registered as an active ${role === 'manager' ? 'Manager' : 'Staff'} for ${branchName.trim()}.`,
                          category: 'Activity',
                          badge: 'Registration',
                          role: 'admin',
                          targetRole: 'admin',
                          roleScope: 'admin',
                          priority: 'info',
                          targetUrl: 'admin/user-management.html',
                          actor: fullName
                        });
                      } else {
                        const notifKey = 'rmims_notifications_live_v2';
                        const existing = JSON.parse(localStorage.getItem(notifKey) || '[]');
                        existing.unshift({
                          id: `notif-live-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                          title: `New User Registered: ${fullName}`,
                          message: `${fullName} has registered as an active ${role === 'manager' ? 'Manager' : 'Staff'} for ${branchName.trim()}.`,
                          category: 'activity',
                          badge: 'Registration',
                          role: 'admin',
                          targetRole: 'admin',
                          roleScope: 'admin',
                          priority: 'info',
                          timestamp: new Date().toISOString(),
                          targetUrl: 'admin/user-management.html',
                          actor: fullName
                        });
                        localStorage.setItem(notifKey, JSON.stringify(existing));
                      }
                    } catch (_) {}

                    window.dispatchEvent(new Event('rmims_registered_users_updated'));
                    window.dispatchEvent(new Event('storage'));
                }
            } catch (_) {}

            // Autonomous launch: seamlessly log in directly into the user's workspace
            try {
                showSignInView();
                resetCreateAccountForm();
                await loginUser(email, password);
                return;
            } catch (autoLoginErr) {
                console.warn("Auto-login fallback caught:", autoLoginErr);
                showSignInView();
                const emailField = document.getElementById("email");
                if (emailField) {
                    emailField.value = email;
                }
                if (passwordInput) {
                    passwordInput.value = password;
                    passwordInput.focus();
                }
                setLoginSuccess(`Account <strong>@${escapeHtml(username)}</strong> is active! Click Sign In to launch your workspace.`);
                resetCreateAccountForm();
            }

        } catch (err) {
            const msg = err.message || "Failed to create account. Please verify your details.";
            if (msg.toLowerCase().includes("email") || msg.toLowerCase().includes("username")) {
                returnToSection1();
                setRegSection1Error(msg);
            } else {
                setRegSection2Error(msg);
            }
        } finally {
            regSubmitBtn.disabled = false;
            regSubmitBtn.innerHTML = origSubmitHtml;
        }
    });
}

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

bindPasswordToggle(toggleNewPw, newPasswordInput);
bindPasswordToggle(toggleConfirmPw, confirmNewPasswordInput);

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
