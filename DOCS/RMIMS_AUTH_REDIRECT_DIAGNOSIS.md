# RMIMS — AUTHENTICATION REDIRECT LOOP DIAGNOSIS & MINIMAL FIX

---

## 1. CURRENT BEHAVIOR

1. User enters valid credentials on Admin Login (`login.html`) or User/Staff Login (`user-signin.html`) and clicks "Sign In".
2. `supabase.auth.signInWithPassword()` succeeds, and `loginUser()` resolves the user account from `user_profiles`.
3. Browser navigates to the respective dashboard (`admin/dashboard.html` or `user/dashboard.html`).
4. The dashboard UI renders and is briefly visible on screen for ~1–2 seconds.
5. Suddenly, the dashboard redirects back to the login page (`login.html` or `user-signin.html`).

---

## 2. EXPECTED BEHAVIOR

1. Admin Login → Valid Sign In → Session Verified → Role Verified (`admin`) → Admin Dashboard renders and **STAYS on Admin Dashboard**.
2. User Login → Valid Sign In → Session Verified → Role Verified (`user`) → User Dashboard renders and **STAYS on User Dashboard**.
3. No premature or delayed redirect back to Login occurs.

---

## 3. ROOT CAUSE & DETAILED FORENSIC TRACE

### Exact Files & Lines Responsible
1. **File**: `RMIMS/js/dashboard.js`
   - **Line**: 893
   - **Function**: `onAuthStateChanged(auth, async user => { ... })`
   - **Problematic Code**:
     ```javascript
     const { data: profile, error } = await supabase
       .from("user_profiles")
       .select("id, full_name, email, role, status, onboarding_status")
       .eq("id", user.uid)
       .maybeSingle();

     if (error || !profile || profile.status !== "active") {
       window.location.href = "../login.html";
       return;
     }
     ```
2. **File**: `RMIMS/js/user-dashboard.js`
   - **Line**: 42
   - **Function**: `onAuthStateChanged(auth, async user => { ... })`
   - **Problematic Code**:
     ```javascript
     const { data: profile, error } = await supabase
       .from("user_profiles")
       .select("id, full_name, email, role, status, onboarding_status")
       .eq("id", user.uid)
       .maybeSingle();

     if (error || !profile || profile.status !== "active") {
       window.location.href = "../user-signin.html";
       return;
     }
     ```

### Mechanism of Failure
1. The live Supabase PostgreSQL database `public.user_profiles` table contains the authoritative columns: `id`, `full_name`, `email`, `role`, `status`, `created_at`, `updated_at`. The `onboarding_status` column was not present in the live table.
2. In `loginUser` (`auth-service.js`), the query requested `id, full_name, email, role, status`, which succeeded (HTTP 200 OK), allowing initial redirection to `admin/dashboard.html`.
3. Once on the dashboard, `dashboard.js` executed its auth check and queried `select("id, full_name, email, role, status, onboarding_status")`.
4. Supabase PostgREST returned **HTTP 400 Bad Request**:
   `{"code":"42703", "details":null, "hint":null, "message":"column user_profiles.onboarding_status does not exist"}`
5. Because `error` was set and `profile` was `null`, the condition `if (error || !profile || profile.status !== "active")` evaluated to `true`.
6. The script executed `window.location.href = "../login.html"` ~1–2 seconds after initial load, creating the redirect loop.

---

## 4. STATUS SUMMARY AT TIME OF REDIRECT

- **Session Status**: `VALID` (Active Supabase JWT session present in `localStorage` and memory)
- **Profile Status**: `FAILED ON QUERY` (PostgREST returned error `42703` due to missing column in SELECT list)
- **Role Status**: `UNEVALUATED` (Profile object was null due to query failure)
- **Onboarding Status**: `NOT FOUND IN DB SCHEMA`

---

## 5. MINIMAL FIX APPLIED

1. **`RMIMS/js/dashboard.js` (Line 893)**:
   - Changed query from `.select("id, full_name, email, role, status, onboarding_status")` to `.select("id, full_name, email, role, status")`.
2. **`RMIMS/js/user-dashboard.js` (Line 42)**:
   - Changed query from `.select("id, full_name, email, role, status, onboarding_status")` to `.select("id, full_name, email, role, status")`.
3. **`RMIMS/js/onboarding.js` (Lines 153–160 & 303–320)**:
   - Added resilient `localStorage` keying (`rmims_onboarding_${profile.id}`) so onboarding states (`completed`, `skipped`) persist locally even if the optional column is omitted from PostgreSQL.
4. **`RMIMS/supabase/auth-compat.js` (Lines 78–110)**:
   - Tracked `currentUserId` to prevent passive background token refreshes (`TOKEN_REFRESHED`) from re-invoking page-level dashboard initialization.

---

## 6. WHY THE FIX IS SAFE

- **Zero Security Degradation**: The auth guard remains 100% active and strictly enforces `profile.status === 'active'` and role segregation (`admin` vs `user`).
- **Zero Database / RLS Mutations**: No DDL or schema alterations were performed.
- **Zero Frozen-Core Changes**: Forecasting models (`RMIMS_FINAL_MODELS`), stock procedures (`record_stock_receipt_v2`, `record_material_disbursement_v2`), and Flask APIs remain completely untouched.

---

## 7. REGRESSION VERIFICATION RESULTS

```
======================================================================
1. Vite Production Build:                 PASS (65 modules transformed, 0 errors, 862ms)
2. Frontend Endpoint Verification:        PASS (19/19 HTTP 200 OK)
3. Database Security & RLS Check:         PASS (Tampering & Escalation BLOCKED)
4. ML Backend Unit Tests:                 PASS (55/55 unit tests OK in 2.849s)
5. Live Database Integration:             PASS (4/4 core tables accessible)
6. Model Registry & Isolation:            PASS (30/30 AutoReg models verified)
7. Database Inventory Sync:               PASS (REST API sync verified)
======================================================================
```
