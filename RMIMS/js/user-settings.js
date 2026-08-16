import { auth, db } from "../supabase/supabase-config.js";
import { doc, getDoc } from "../supabase/db-compat.js";
import { onAuthStateChanged, signOut } from "../supabase/auth-compat.js";

const $ = (id) => document.getElementById(id);
let logoutInProgress = false;

function setStatus(message = "", type = "info") {
    const el = $("settingsStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `settings-status ${type}`;
    el.hidden = !message;
}

function setAccountFields(data) {
    const fullName = String(data?.fullName || "").trim();
    const email = String(data?.email || "").trim();
    const role = String(data?.role || "").trim();

    if ($("fullName")) $("fullName").value = fullName || "Not available";
    if ($("email")) $("email").value = email || "Not available";
    if ($("role")) $("role").value = role || "User";

    const profileText = document.querySelector("#profileBtn .profile-text");
    if (profileText) profileText.textContent = fullName || "User";

    const avatar = document.querySelector("#profileBtn .avatar");
    if (avatar) {
        const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
        avatar.textContent = initials || "U";
    }
}

async function loadAccount(user) {
    setStatus("Loading your account information…", "info");

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));

        if (!userDoc.exists()) {
            setStatus("Your account record could not be found. Please contact an administrator.", "error");
            return false;
        }

        const data = userDoc.data() || {};

        if (String(data.role || "").toLowerCase() !== "user") {
            window.location.href = "../admin/dashboard.html";
            return false;
        }

        if (String(data.status || "active").toLowerCase() === "inactive") {
            setStatus("This account is inactive. Please contact an administrator.", "error");
            return false;
        }

        setAccountFields(data);
        document.body.classList.add("auth-verified");
        setStatus("Account information loaded.", "success");
        return true;
    } catch (error) {
        console.error("User Settings Load Error:", error);
        setStatus("Unable to load your account information. Please try again.", "error");
        return false;
    }
}

function protectLogoutButton() {
    const button = $("logoutBtn");
    if (!button) return;

    button.addEventListener("click", async () => {
        if (logoutInProgress) return;

        const confirmed = window.confirm("Are you sure you want to logout?");
        if (!confirmed) return;

        logoutInProgress = true;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        setStatus("Signing you out…", "info");

        try {
            await signOut(auth);
            window.location.href = "../login.html";
        } catch (error) {
            console.error("Logout Error:", error);
            logoutInProgress = false;
            button.disabled = false;
            button.removeAttribute("aria-busy");
            setStatus("Logout failed. Your session is still active. Please try again.", "error");
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const retry = $("retrySettingsBtn");
    if (retry) {
        retry.addEventListener("click", () => {
            if (currentUser) loadAccount(currentUser);
        });
    }

    const menuToggle = document.querySelector(".menu-toggle");
    const sidebar = document.querySelector(".sidebar");
    if (menuToggle && sidebar) {
        menuToggle.addEventListener("click", () => sidebar.classList.toggle("open"));
    }

    protectLogoutButton();
});

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (!user) {
        window.location.href = "../login.html";
        return;
    }

    const ok = await loadAccount(user);
    if (!ok) return;
});
