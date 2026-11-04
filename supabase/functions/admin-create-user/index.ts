// supabase/functions/admin-create-user/index.ts
//
// RMIMS — Edge Function: the Administrator creates a Manager / Staff (or another Admin) login.
// Used by Admin -> User Management -> Add User. Runs on Supabase's server: the service key never reaches the
// browser and every check happens here.
//
// Security
//   * caller must send a valid signed-in session (Bearer token) AND be an ACTIVE Admin in public.user_profiles
//     (nothing is trusted from user_metadata or the e-mail address)
//   * each invalid case has its own check and message: same e-mail / username, company, role, password rules,
//     full name, e-mail format (database checks from 02_AUTH_SECURITY.sql + password rules here)
//   * Manager / Staff must belong to one of the registered companies; an Admin belongs to none
//   * rate limited per Admin
//
// Deploy:  supabase functions deploy admin-create-user --no-verify-jwt
//   (or Dashboard -> Edge Functions -> admin-create-user -> replace the code with this file -> Deploy;
//    turn OFF "Verify JWT": the function checks the session itself)

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MESSAGES: Record<string, string> = {
  OK: "Account created.",
  BAD_REQUEST: "The request could not be read. Please refresh the page and try again.",
  NOT_SIGNED_IN: "Your session has ended. Please sign in again.",
  NOT_ADMIN: "Only an active Administrator can create accounts.",
  TOO_MANY_REQUESTS: "Too many accounts created in a short time. Please wait a few minutes.",
  MISSING_FIELDS: "Please fill in every required field.",
  INVALID_EMAIL_FORMAT: "That e-mail address is not valid (example: name@company.com).",
  FULL_NAME_INVALID: "Please enter the person's real full name.",
  USERNAME_TOO_SHORT: "The username must have at least 3 characters.",
  USERNAME_INVALID: "The username can only use letters, numbers, dot, dash and underscore (no spaces).",
  USERNAME_TAKEN: "This username is already taken. Please choose another one.",
  EMAIL_ALREADY_REGISTERED: "An account with this e-mail address already exists.",
  EMAIL_PENDING_APPROVAL: "This e-mail address already has a request waiting for approval. Approve it instead.",
  COMPANY_NOT_FOUND: "That company does not exist in the system.",
  ROLE_INVALID: "Please choose Manager, Staff or Admin.",
  PASSWORD_TOO_SHORT: "The password must have at least 8 characters.",
  PASSWORD_TOO_WEAK: "The password must contain at least one letter and one number.",
  PASSWORD_HAS_SPACES: "The password cannot start or end with a space.",
  PASSWORD_CONTAINS_PERSONAL_INFO: "The password cannot contain the username or e-mail name.",
  SERVER_ERROR: "The account service is having a problem. Please try again in a moment.",
};

function reply(code: string, extra: Record<string, unknown> = {}, ok = false) {
  return new Response(JSON.stringify({ ok, code, message: MESSAGES[code] || MESSAGES.SERVER_ERROR, ...extra }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function checkPassword(pw: string, email: string, username: string): string {
  if (pw.length < 8) return "PASSWORD_TOO_SHORT";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "PASSWORD_TOO_WEAK";
  if (pw !== pw.trim()) return "PASSWORD_HAS_SPACES";
  const p = pw.toLowerCase();
  const local = email.split("@")[0].toLowerCase();
  if ((username.length >= 3 && p.includes(username.toLowerCase())) || (local.length >= 3 && p.includes(local))) {
    return "PASSWORD_CONTAINS_PERSONAL_INFO";
  }
  return "OK";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply("BAD_REQUEST");

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const firstKey = (name: string) => {
    try { const v = JSON.parse(Deno.env.get(name) ?? "{}"); return String(v.default ?? Object.values(v)[0] ?? ""); } catch { return ""; }
  };
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || firstKey("SUPABASE_SECRET_KEYS");
  if (!url || !serviceKey) return reply("SERVER_ERROR");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // 1. who is calling: a real session, and an ACTIVE Admin according to the database only
    const token = (req.headers.get("Authorization") || "").replace(/^bearer\s+/i, "").trim();
    if (!token) return reply("NOT_SIGNED_IN");
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user) return reply("NOT_SIGNED_IN");
    const { data: caller } = await admin.from("user_profiles")
      .select("id, operational_role, status").eq("id", who.user.id).maybeSingle();
    if (!caller || caller.operational_role !== "admin" || caller.status !== "active") return reply("NOT_ADMIN");

    const { data: rate } = await admin.rpc("auth_check_rate_limit", {
      p_bucket: `admin:${caller.id}:create-user`, p_max: 30, p_window_seconds: 600,
    });
    if (rate !== "OK") return reply("TOO_MANY_REQUESTS");

    // 2. input
    let body: Record<string, string> = {};
    try { body = await req.json(); } catch { return reply("BAD_REQUEST"); }
    const email = String(body.email || "").trim().toLowerCase();
    const username = String(body.username || "").trim();
    const fullName = String(body.full_name || "").trim();
    const role = String(body.operational_role || body.role || "").trim().toLowerCase();
    const company = String(body.company || body.company_name || body.company_id || "").trim();
    const password = String(body.password || "");
    const branchName = String(body.branch_name || company).trim();
    const branchLocation = String(body.branch_location || "").trim();
    if (!["manager", "staff", "admin"].includes(role)) return reply("ROLE_INVALID");
    if (!email || !username || !fullName || !password) return reply("MISSING_FIELDS");

    // 3. the same checks as self sign-up (one code per problem); an Admin has no company
    const check = (await admin.rpc("auth_check_signup", {
      p_email: email, p_username: username, p_full_name: fullName,
      p_company: role === "admin" ? "Scones & Muffins Bakery" : company,  // company is ignored for an Admin
      p_role: role === "admin" ? "staff" : role, p_branch_location: branchLocation,
    })).data;
    if (!check || check.code !== "OK") return reply(check?.code || "SERVER_ERROR");
    const pw = checkPassword(password, email, username);
    if (pw !== "OK") return reply(pw);

    // 4. create the login (confirmed: the Admin vouches for it) - the profile is created by the database trigger
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username,
        operational_role: role === "admin" ? "staff" : role,   // the trigger only accepts manager / staff
        company_id: role === "admin" ? null : check.company_id,
        company_name: role === "admin" ? null : check.company_name,
        branch_name: role === "admin" ? null : branchName,
        branch_location: role === "admin" ? null : branchLocation,
        branch_store: role === "admin" ? null : (branchLocation ? `${branchName} (${branchLocation})` : branchName),
      },
    });
    if (createErr || !created?.user?.id) {
      const m = String(createErr?.message || "").toLowerCase();
      if (m.includes("already") || m.includes("registered") || m.includes("exists")) return reply("EMAIL_ALREADY_REGISTERED");
      return reply("SERVER_ERROR");
    }

    // 5. created by the Admin = approved right away (an Admin account becomes admin here, server-side only)
    const patch: Record<string, unknown> = { status: "active", approved_at: new Date().toISOString(), approved_by: caller.id };
    if (role === "admin") Object.assign(patch, { role: "admin", operational_role: "admin" });
    const { error: upErr } = await admin.from("user_profiles").update(patch).eq("id", created.user.id);
    if (upErr) {
      await admin.auth.admin.deleteUser(created.user.id);   // never leave a half-made account
      return reply("SERVER_ERROR");
    }
    await admin.rpc("auth_log_event", {
      p_email: email, p_action: "Account Created", p_status: "success",
      p_details: `Administrator created a ${role} account${role === "admin" ? "" : ` for ${check.company_name}`}.`,
      p_ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    });

    return reply("OK", {
      user: { id: created.user.id, email, username, full_name: fullName, operational_role: role,
              company_id: role === "admin" ? null : check.company_id, company_name: role === "admin" ? null : check.company_name },
    }, true);
  } catch (e) {
    console.error("[admin-create-user]", e instanceof Error ? e.message : e);
    return reply("SERVER_ERROR");
  }
});
