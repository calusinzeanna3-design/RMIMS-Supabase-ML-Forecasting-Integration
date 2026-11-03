# RMIMS — fresh Supabase setup

Run each file once in the Supabase SQL Editor, in this order (00 to 14). Every file is one module of the system.

| File | Module | What it holds |
|---|---|---|
| 00_WIPE_EVERYTHING_KEEP_ADMIN.sql | Wipe | Deletes every RMIMS table, function, trigger, policy, view and every login except the Admin |
| 01_CORE_COMPANIES_PROFILES_ROLES.sql | Core | Companies, user profiles, Admin / Manager / Staff role checks, sign-up profile trigger |
| 02_AUTH_SECURITY.sql | Sign-in security | One check per invalid case (used only by the auth-gate Edge Function), account approve / reject / unlock / delete |
| 03_ACTIVITY_LOGS_STAFF_SUBMISSIONS.sql | Activity | Operation log + staff submissions, Admin activity log |
| 04_INVENTORY_RAW_MATERIALS.sql | My Inventory | Raw materials (Manager writes, Staff reads) |
| 05_RECEIVE_STOCK_RECEIPTS.sql | Receive | Deliveries + the procedure that raises stock |
| 06_DISBURSE_MATERIAL_DISBURSEMENTS.sql | Disburse | Usage + the procedure that lowers stock |
| 07_FINISHED_PRODUCTS.sql | Finished products | Formulations, automatic link of records, per-material usage view |
| 08_NOTIFICATIONS_ALERTS.sql | Notifications | Bell notifications, Admin system alerts |
| 09_ADMIN_BRANCHES_SETTINGS_BACKUPS.sql | Admin | Branch stores, personnel, settings, backups + restore |
| 10_FACTORY_RESET.sql | Factory reset | Admin factory reset, Manager data reset, reset signal for every device |
| 11_REALTIME_AND_CHECK.sql | Live updates | Realtime for every module + final check (every line should say OK) |
| 12_REPORTS_VIEWS.sql | Reports | One read-only view per Reports tab (same security as the tables) |
| 13_IMPORT_RAW_MATERIALS.sql | Import | Import raw materials from the template file (Manager, or a CSV uploaded in Supabase) |
| 14_STAFF_REPORTS.sql | Staff reports | One row per staff submission and per staff member, each with its company (no cross-company) |

About 00: it keeps every login whose profile has the Admin role (no e-mail is written in the file).
Only if it stops with "No Admin account found", type your Admin e-mail inside `v_admin_emails` at the top
and run it again (that login must exist in Authentication → Users).

## Edge Function `auth-gate` (sign-in, sign-up, password reset)

File: `supabase/functions/auth-gate/index.ts` (at the project root, next to `vercel.json`).

* With the Supabase CLI: `supabase functions deploy auth-gate --no-verify-jwt`
* Or in the Dashboard: Edge Functions → Deploy a new function → Via Editor → name it `auth-gate` → paste the file →
  Deploy. Then open the function's settings and turn **off** "Verify JWT" (people are not signed in yet when they use it).

Nothing else to configure: the function reads the project URL and keys Supabase gives every function.

## Edge Function `admin-create-user` (Admin → User Management → Add User)

File: `supabase/functions/admin-create-user/index.ts`. Replace the old code of your existing `admin-create-user`
function with this file and deploy it the same way (Verify JWT **off**; the function checks the Admin session itself).

## Authentication settings (Dashboard → Authentication)

* Sign In / Providers → Email: keep enabled. New accounts are created by auth-gate already confirmed, and they
  cannot sign in until the Admin approves them in User Management.
* URL Configuration → add your site's address (e.g. `https://your-site.vercel.app/**`) to Redirect URLs so the
  password-reset link opens the system.
