// supabase/functions/auth-gate/index.ts
//
// RMIMS — Edge Function: every sign-in, sign-up and password-reset goes through here.
// Runs on Supabase's server, so none of these checks (or their order) is visible in the browser's developer
// tools. The browser only receives { ok, code, message } and, on a successful sign-in, the session tokens.
//
// Each invalid case is decided by its own database check (file 02_AUTH_SECURITY.sql), called with the service key:
//   auth_check_rate_limit, auth_resolve_identifier, auth_check_lockout, auth_check_account_status,
//   auth_record_failed_login, auth_record_successful_login, auth_check_signup, auth_check_reset_email
// Password rules are checked here (the password is never sent to a database function).
//
// Deploy:  supabase functions deploy auth-gate --no-verify-jwt
//   (or Dashboard -> Edge Functions -> Deploy a new function -> name "auth-gate" -> paste this file,
//    then turn OFF "Enforce JWT verification" for this function: people are not signed in yet when they use it)

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// One message per case (the browser shows exactly this text)
const MESSAGES: Record<string, string> = {
  OK: "OK",
  BAD_REQUEST: "The request could not be read. Please refresh the page and try again.",
  TOO_MANY_REQUESTS: "Too many attempts. Please wait a few minutes before trying again.",
  EMPTY_IDENTIFIER: "Please enter your e-mail address or username.",
  EMPTY_PASSWORD: "Please enter your password.",
  INVALID_EMAIL_FORMAT: "That e-mail address is not valid. Please check it (example: name@company.com).",
  EMAIL_NOT_REGISTERED: "No account uses this e-mail address. Check the spelling or create an account.",
  USERNAME_NOT_FOUND: "No account uses this username. Check the spelling or sign in with your e-mail address.",
  WRONG_PASSWORD: "Incorrect password. Please try again.",
  ACCOUNT_LOCKED: "This account is locked after too many wrong passwords. Please contact the Administrator to unlock it.",
  ACCOUNT_LOCKED_TEMPORARY: "Too many wrong passwords. This account is locked for 15 minutes.",
  EMAIL_NOT_CONFIRMED: "This e-mail address has not been confirmed yet. Please open the confirmation e-mail first.",
  PENDING_APPROVAL: "Your account is waiting for the Administrator's approval. You can sign in once it is approved.",
  REJECTED: "Your account request was declined by the Administrator.",
  INACTIVE: "Your account is inactive. Please contact the Administrator.",
  SUSPENDED: "Your account is suspended. Please contact the Administrator.",
  NO_PROFILE: "This account has no RMIMS profile. Please contact the Administrator.",
  NO_COMPANY: "Your account is not assigned to a company yet. Please contact the Administrator.",
  MISSING_FIELDS: "Please fill in every required field.",
  FULL_NAME_INVALID: "Please enter your real full name.",
  USERNAME_TOO_SHORT: "The username must have at least 3 characters.",
  USERNAME_INVALID: "The username can only use letters, numbers, dot, dash and underscore (no spaces).",
  USERNAME_TAKEN: "This username is already taken. Please choose another one.",
  EMAIL_ALREADY_REGISTERED: "An account with this e-mail address already exists. Please sign in instead.",
  EMAIL_PENDING_APPROVAL: "This e-mail address is already registered and waiting for the Administrator's approval.",
  COMPANY_NOT_FOUND: "That company does not exist in the system. Please coordinate with the operator of the Admin.",
  ROLE_INVALID: "Please choose Manager or Staff.",
  PASSWORD_TOO_SHORT: "The password must have at least 8 characters.",
  PASSWORD_TOO_WEAK: "The password must contain at least one letter and one number.",
  PASSWORD_HAS_SPACES: "The password cannot start or end with a space.",
  PASSWORD_CONTAINS_PERSONAL_INFO: "The password cannot contain your username or e-mail name.",
  PASSWORDS_DO_NOT_MATCH: "The passwords do not match. Please type the same password twice.",
  SERVER_ERROR: "The sign-in service is having a problem. Please try again in a moment.",
};

function reply(code: string, extra: Record<string, unknown> = {}, ok = false) {
  return new Response(JSON.stringify({ ok, code, message: MESSAGES[code] || MESSAGES.SERVER_ERROR, ...extra }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim();
}

// --- password rules (separate check per rule) ---------------------------------------------------------------
function checkPasswordLength(pw: string) { return pw.length >= 8 ? "OK" : "PASSWORD_TOO_SHORT"; }
function checkPasswordStrength(pw: string) { return /[A-Za-z]/.test(pw) && /[0-9]/.test(pw) ? "OK" : "PASSWORD_TOO_WEAK"; }
function checkPasswordSpaces(pw: string) { return pw === pw.trim() ? "OK" : "PASSWORD_HAS_SPACES"; }
function checkPasswordPersonal(pw: string, email: string, username: string) {
  const p = pw.toLowerCase();
  const local = email.split("@")[0].toLowerCase();
  if ((username && username.length >= 3 && p.includes(username.toLowerCase())) || (local.length >= 3 && p.includes(local))) {
    return "PASSWORD_CONTAINS_PERSONAL_INFO";
  }
  return "OK";
}
function checkPasswordMatch(pw: string, confirm: string) { return pw === confirm ? "OK" : "PASSWORDS_DO_NOT_MATCH"; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply("BAD_REQUEST");

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  // projects on the new API keys expose them as JSON lists; older projects as single keys
  const firstKey = (name: string) => {
    try { const v = JSON.parse(Deno.env.get(name) ?? "{}"); return String(v.default ?? Object.values(v)[0] ?? ""); } catch { return ""; }
  };
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || firstKey("SUPABASE_SECRET_KEYS");
  // the public key the browser itself used (it is public by design), else the project's anon key
  const anonKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || firstKey("SUPABASE_PUBLISHABLE_KEYS");
  if (!url || !serviceKey || !anonKey) return reply("SERVER_ERROR");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const publicClient = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { return reply("BAD_REQUEST"); }
  const action = String(body.action || "");
  const ip = clientIp(req);

  try {
    // ------------------------------------------------------------------------------------------------ SIGN IN
    if (action === "login") {
      const identifier = String(body.identifier || "").trim();
      const password = String(body.password || "");

      if ((await rpc("auth_check_rate_limit", { p_bucket: `ip:${ip}:login`, p_max: 30, p_window_seconds: 300 })) !== "OK") {
        return reply("TOO_MANY_REQUESTS");
      }
      const who = await rpc("auth_resolve_identifier", { p_identifier: identifier });
      if (who.code !== "OK") return reply(who.code);
      const email = String(who.email);
      if (!password) return reply("EMPTY_PASSWORD");
      if ((await rpc("auth_check_rate_limit", { p_bucket: `email:${email}:login`, p_max: 15, p_window_seconds: 300 })) !== "OK") {
        return reply("TOO_MANY_REQUESTS");
      }

      const lock = await rpc("auth_check_lockout", { p_email: email });
      if (lock.code !== "OK") return reply(lock.locked_until ? "ACCOUNT_LOCKED_TEMPORARY" : "ACCOUNT_LOCKED");

      const pc = publicClient();
      const { data: signIn, error: signErr } = await pc.auth.signInWithPassword({ email, password });
      if (signErr || !signIn?.session) {
        const m = String(signErr?.message || "").toLowerCase();
        if (m.includes("not confirmed")) return reply("EMAIL_NOT_CONFIRMED");
        const fail = await rpc("auth_record_failed_login", { p_email: email, p_ip: ip });
        if (fail.code === "ACCOUNT_LOCKED") return reply(fail.temporary ? "ACCOUNT_LOCKED_TEMPORARY" : "ACCOUNT_LOCKED", { attempts: fail.attempts });
        return reply("WRONG_PASSWORD", { attempts: fail.attempts, remaining: fail.remaining, max: fail.max, warning: fail.warning });
      }

      // correct password: the account must be approved and usable
      const status = await rpc("auth_check_account_status", { p_email: email });
      if (status.code !== "OK") {
        try { await pc.auth.signOut(); } catch (_) { /* session dropped */ }
        return reply(status.code);
      }

      await rpc("auth_record_successful_login", { p_email: email, p_ip: ip });
      return reply("OK", {
        role: status.role,
        session: { access_token: signIn.session.access_token, refresh_token: signIn.session.refresh_token },
      }, true);
    }

    // ------------------------------------------------------------------------------------------------ SIGN UP
    if (action === "signup") {
      const email = String(body.email || "").trim().toLowerCase();
      const username = String(body.username || "").trim();
      const fullName = String(body.full_name || "").trim();
      const company = String(body.company || "").trim();
      const role = String(body.role || "").trim().toLowerCase();
      const password = String(body.password || "");
      const confirm = String(body.confirm_password ?? body.password ?? "");
      const branchName = String(body.branch_name || company).trim();
      const branchLocation = String(body.branch_location || "").trim();

      if ((await rpc("auth_check_rate_limit", { p_bucket: `ip:${ip}:signup`, p_max: 10, p_window_seconds: 3600 })) !== "OK") {
        return reply("TOO_MANY_REQUESTS");
      }
      if (!password) return reply("MISSING_FIELDS");
      const check = await rpc("auth_check_signup", {
        p_email: email, p_username: username, p_full_name: fullName, p_company: company, p_role: role, p_branch_location: branchLocation,
      });
      if (check.code !== "OK") return reply(check.code);

      for (const code of [checkPasswordLength(password), checkPasswordStrength(password), checkPasswordSpaces(password),
                          checkPasswordPersonal(password, email, username), checkPasswordMatch(password, confirm)]) {
        if (code !== "OK") return reply(code);
      }

      const { error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // access is controlled by the Administrator's approval
        user_metadata: {
          full_name: fullName,
          username,
          operational_role: role,
          company_id: check.company_id,
          company_name: check.company_name,
          branch_name: branchName,
          branch_location: branchLocation,
          branch_store: branchLocation ? `${branchName} (${branchLocation})` : branchName,
        },
      });
      if (createErr) {
        const m = String(createErr.message || "").toLowerCase();
        if (m.includes("already") || m.includes("registered") || m.includes("exists")) return reply("EMAIL_ALREADY_REGISTERED");
        if (m.includes("password")) return reply("PASSWORD_TOO_WEAK");
        return reply("SERVER_ERROR");
      }
      await rpc("auth_log_event", { p_email: email, p_action: "Registration", p_status: "success",
                                    p_details: `New ${role} account for ${check.company_name} is waiting for approval.`, p_ip: ip });
      return reply("OK", { company_name: check.company_name }, true);
    }

    // ------------------------------------------------------------------------------------------------ RESET PASSWORD
    if (action === "reset_password") {
      const email = String(body.email || "").trim().toLowerCase();
      if ((await rpc("auth_check_rate_limit", { p_bucket: `ip:${ip}:reset`, p_max: 5, p_window_seconds: 900 })) !== "OK") {
        return reply("TOO_MANY_REQUESTS");
      }
      const check = await rpc("auth_check_reset_email", { p_email: email });
      if (check.code !== "OK") return reply(check.code);
      const redirectTo = String(body.redirect_to || "");
      const { error } = await publicClient().auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
      if (error) return reply(String(error.message || "").toLowerCase().includes("rate") ? "TOO_MANY_REQUESTS" : "SERVER_ERROR");
      return reply("OK", {}, true);
    }

    return reply("BAD_REQUEST");
  } catch (e) {
    console.error("[auth-gate]", e instanceof Error ? e.message : e);
    return reply("SERVER_ERROR");
  }
});
