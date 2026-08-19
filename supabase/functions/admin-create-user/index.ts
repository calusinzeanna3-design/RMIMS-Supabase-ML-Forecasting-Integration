// supabase/functions/admin-create-user/index.ts
//
// RMIMS V2 — Edge Function: Secure Admin User Provisioning
// Purpose: Allows authenticated active administrators to securely provision new
//          user accounts without exposing the service_role key to browser-side code.
//
// Authoritative Project: rmims-v2 (hgandqozgcpytxebhvtn)
// Phase: Phase 8 (Edge Functions) — Step 8.4: Secure Admin User Creation

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Standard CORS headers for RMIMS frontend integration
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Email validation regex (RFC 5322 simplified)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req: Request) => {
  // 1. Handle CORS Preflight Request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 2. Validate HTTP Method
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({
          error: "Method Not Allowed",
          message: "Only POST requests are supported.",
        }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 3. Validate Environment Configuration (Dynamic Server Secrets)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_KEY") ||
      supabaseServiceRoleKey;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({
          error: "Configuration Error",
          message: "Server configuration missing required Supabase environment secrets.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 4. Extract and Validate Authorization Header
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          message: "Missing Authorization header.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!authHeader.startsWith("Bearer ") && !authHeader.startsWith("bearer ")) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          message: "Malformed Authorization header. Expected 'Bearer <token>'.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.replace(/^bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          message: "Empty Bearer token provided.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 5. Cryptographic JWT Verification via Supabase Auth
    const authVerificationClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user: callingUser },
      error: authError,
    } = await authVerificationClient.auth.getUser(token);

    if (authError || !callingUser) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          message: "Invalid, expired, or unverified authentication token.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 6. Verify Administrator Authorization via Database Record (public.user_profiles)
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: adminProfile, error: profileError } = await adminClient
      .from("user_profiles")
      .select("id, email, full_name, role, status")
      .eq("id", callingUser.id)
      .single();

    if (profileError || !adminProfile) {
      return new Response(
        JSON.stringify({
          error: "Forbidden",
          message: "Caller profile not found or access denied.",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 7. Enforce Active Status and Administrator Role Checks
    if (adminProfile.status !== "active") {
      return new Response(
        JSON.stringify({
          error: "Forbidden",
          message: "Caller account is inactive or pending administrator approval.",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (adminProfile.role !== "admin") {
      return new Response(
        JSON.stringify({
          error: "Forbidden",
          message: "Insufficient privileges. Administrator role required.",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 8. Parse Request Body Safely
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "Invalid JSON request body.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!body || typeof body !== "object") {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "Request body must be a valid JSON object.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 9. Input Validation — Email
    const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
    if (!rawEmail) {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "Field 'email' is required.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!EMAIL_REGEX.test(rawEmail)) {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "Field 'email' must be a valid email address.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const normalizedEmail = rawEmail.toLowerCase();

    // 10. Input Validation — Password (Enforce minimum 8 characters)
    const rawPassword = typeof body.password === "string" ? body.password : "";
    if (!rawPassword) {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "Field 'password' is required.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (rawPassword.length < 8) {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "Password must be at least 8 characters long.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 11. Input Validation — Full Name
    const rawFullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    if (!rawFullName || rawFullName.length < 2) {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "Field 'full_name' is required (minimum 2 characters).",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 12. Input Validation — Role Security Guard
    // Prohibit arbitrary administrative self-elevation or admin creation via this endpoint
    const requestedRole = typeof body.role === "string" ? body.role.trim().toLowerCase() : "user";
    if (requestedRole !== "user") {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "Administrative role creation is not permitted. New users must have role 'user'.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const assignedRole = "user";
    const assignedStatus = "active";

    // 13. Create Supabase Auth User via Server-Side Admin API
    const { data: authData, error: createAuthError } =
      await adminClient.auth.admin.createUser({
        email: normalizedEmail,
        password: rawPassword,
        email_confirm: true,
        user_metadata: {
          full_name: rawFullName,
        },
      });

    if (createAuthError) {
      const errMsg = createAuthError.message.toLowerCase();
      if (
        errMsg.includes("already registered") ||
        errMsg.includes("already exists") ||
        errMsg.includes("duplicate") ||
        createAuthError.status === 422
      ) {
        return new Response(
          JSON.stringify({
            error: "Conflict",
            message: "A user with this email address already exists.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          error: "User Creation Error",
          message: createAuthError.message,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!authData?.user?.id) {
      return new Response(
        JSON.stringify({
          error: "User Creation Error",
          message: "Auth user was created without a valid identifier.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const newUserId = authData.user.id;

    // 14. Synchronize User Profile Record in public.user_profiles
    const { error: profileInsertError } = await adminClient
      .from("user_profiles")
      .insert({
        id: newUserId,
        email: normalizedEmail,
        full_name: rawFullName,
        role: assignedRole,
        status: assignedStatus,
      });

    // 15. Handle Partial Failure (Rollback Auth User if Profile Insertion Fails)
    if (profileInsertError) {
      try {
        await adminClient.auth.admin.deleteUser(newUserId);
      } catch (cleanupError) {
        console.error("Rollback cleanup failed for auth user:", newUserId, cleanupError);
      }

      return new Response(
        JSON.stringify({
          error: "Database Error",
          message: "Failed to create user profile record. User creation was safely rolled back.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 16. Record Audit Event in public.activity_audit_logs
    try {
      await adminClient.from("activity_audit_logs").insert({
        user_id: callingUser.id,
        action: "ADMIN_CREATE_USER",
        entity_type: "user_profiles",
        entity_id: newUserId,
        details: {
          created_user_id: newUserId,
          created_user_email: normalizedEmail,
          created_user_name: rawFullName,
          assigned_role: assignedRole,
          assigned_status: assignedStatus,
          created_by_admin: callingUser.id,
        },
      });
    } catch (auditError) {
      // Non-blocking log warning; user creation already committed
      console.warn("Audit log creation notice:", auditError);
    }

    // 17. Success Response (Zero passwords, tokens, or service-role keys returned)
    return new Response(
      JSON.stringify({
        status: "success",
        message: "User account created successfully.",
        user: {
          id: newUserId,
          email: normalizedEmail,
          full_name: rawFullName,
          role: assignedRole,
          status: assignedStatus,
        },
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
