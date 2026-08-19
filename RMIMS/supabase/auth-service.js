// supabase/auth-service.js
// Supabase authentication service for RMIMS V2.
// Uses Supabase Auth (supabase.auth.signInWithPassword) as the authentication authority
// and public.user_profiles as the role authority.

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
 * Authenticates a user against Supabase Auth and validates application role/status from public.user_profiles.
 * 
 * @param {string} email - User email address
 * @param {string} password - User password
 * @param {"admin"|"user"} [expectedRole] - Optional portal-specific role constraint ("admin" or "user")
 */
export async function loginUser(email, password, expectedRole) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password
    });

    if (error) {
        throw new Error(friendlyAuthError(error));
    }

    if (!data?.user?.id) {
        await supabase.auth.signOut();
        throw new Error("Authentication succeeded but no user session was established.");
    }

    const uid = data.user.id;

    // Authoritative role lookup from public.user_profiles
    const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("id, full_name, email, role, status")
        .eq("id", uid)
        .maybeSingle();

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

    // Role-based destination routing
    const isRMIMSPath = window.location.pathname.toLowerCase().includes("/rmims");
    if (profile.role === "admin") {
        const target = isRMIMSPath ? "/RMIMS/admin/dashboard.html" : "admin/dashboard.html";
        window.location.href = target;
    } else {
        const target = isRMIMSPath ? "/RMIMS/user/dashboard.html" : "user/dashboard.html";
        window.location.href = target;
    }
}

/**
 * Signs the user out of Supabase Auth.
 */
export async function signOutUser() {
    const { error } = await supabase.auth.signOut();
    if (error) console.warn("Supabase signOut notice:", error);
}