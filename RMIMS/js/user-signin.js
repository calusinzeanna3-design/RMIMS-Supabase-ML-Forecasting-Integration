import { loginUser } from "../supabase/auth-service.js";

const loginForm = document.getElementById("loginForm");
const loginErrorEl = document.getElementById("loginError");
const loginSubmitBtn = document.getElementById("loginSubmitBtn");
const togglePw = document.getElementById("togglePw");
const passwordInput = document.getElementById("password");

function setLoginError(message) {
    loginErrorEl.textContent = message;
    loginErrorEl.classList.toggle("error", !!message);
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

        await loginUser(email, password, "user");

    } catch (err) {

        setLoginError(err.message || "Unable to sign in. Please check your details and try again.");
        loginSubmitBtn.disabled = false;

    }

});
