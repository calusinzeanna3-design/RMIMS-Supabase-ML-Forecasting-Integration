# RMIMS — PRE-RESTRUCTURE FORENSIC AUDIT REPORT
**Diagnosis Date:** August 18, 2026  
**Audit Type:** Read-Only Non-Destructive Forensic Architecture & Integration Audit  
**Operating Environment:** Windows / Vite 6 / Supabase PostgreSQL / Flask AutoReg (Python 3.12)

---

## A. EXECUTIVE SUMMARY

**Overall System Condition: HEALTHY (WITH ARCHITECTURAL RESTRUCTURING PREREQUISITES)**

The RMIMS (Raw Material Inventory Management & ML Forecasting System) is in an active, stable operational baseline with high structural integrity across its database security, machine learning model isolation, and frontend build pipeline:
- **Build Pipeline**: 100% PASS (`vite build` completes with 0 build errors across all 19 HTML entrypoints).
- **Backend & ML Gate**: 100% PASS (55/55 unit tests passing; 30/30 AutoReg models loaded from `RMIMS_FINAL_MODELS` with zero legacy fallbacks).
- **Database & RLS**: 100% PASS (Full RLS enforcement on all 5 core tables; privilege escalation, non-admin role modification, and direct stock tampering are strictly blocked at the PostgreSQL engine level).
- **No Mock Operational Fallbacks**: Zero synthetic/fake quantities are injected when live database tables are empty; the application adheres to honest empty-state reporting.

However, several architectural coupling issues, localhost hardcodings, legacy orphaned files, and unit-aggregation edge cases were identified that must be resolved in an orderly sequence before major modular restructuring.

---

## B. CRITICAL FINDINGS

| ID | Severity | File | Line(s) | Problem | Evidence | Impact | Recommended Fix |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CRIT-01** | **HIGH** | `RMIMS/js/forecasting.js`<br>`RMIMS/js/dashboard.js` | `forecasting.js:13`<br>`dashboard.js:864` | **Hardcoded Localhost API Base URL** | `const FLASK_API_BASE = "http://127.0.0.1:5000";`<br>`fetch("http://127.0.0.1:5000/api/ml/forecast/Sugar/inventory")` | In production environments or containerized deployments, client-side hardcoded `127.0.0.1:5000` bypasses proxy routing and fails when hosted on external domains. | Standardize on relative proxy endpoints (`/api/ml/...`) configured via `vite.config.js` or environment variable `VITE_API_BASE_URL`. |
| **CRIT-02** | **MEDIUM** | `RMIMS/js/analytics.js` | `analytics.js:398-403` | **Mixed-Unit Summation in "Others" Bar** | `data.push(rest.reduce((s, x) => s + x.currentTotal, 0));` | When "All Units" is selected in Consumption Analytics, materials with incompatible units (e.g., kg, L, loaf) in the 7th+ positions are summed into a single numerical total for the "Others" bar. | Group "Others" by distinct unit of measure or disable the mixed-unit "Others" bar when "All Units" filter is active. |
| **CRIT-03** | **MEDIUM** | `RMIMS/supabase/db-compat.js` | Full file (365 lines) | **Orphaned / Obsolete Compatibility Layer** | File exists in repository but has 0 import references across all 25 active JS modules. | Increases codebase maintenance overhead and cognitive burden during future refactoring. | Quarantine or delete in pre-approved cleanup phase after verifying no dynamic runtime dependencies. |
| **CRIT-04** | **LOW** | `RMIMS/index.html`<br>`RMIMS/portal.html`<br>`RMIMS/admin/*.html`<br>`RMIMS/user/*.html` | Various script tags | **Non-Module Script Inclusion Warnings in Vite** | `<script src="js/landing.js">`<br>`<script src="../js/chart.js">`<br>`<script src="../js/rmsme-shell.js">` | Emits Vite bundling notices during build (`can't be bundled without type="module" attribute`), causing them to load via global window scope instead of bundled chunks. | Migrate vanilla script inclusions to standard ES module imports or bundle them as static vendor assets. |
| **CRIT-05** | **LOW** | `RMIMS/kiosk-checkin.html`<br>`RMIMS/js/welcome.js` | Full files | **Orphaned Legacy Kiosk Page** | `kiosk-checkin.html` exists in Vite build inputs but is not linked in any navigation menu or portal flow. | Unmaintained page that could drift out of sync with V2 design system and security policies. | Officially deprecate or cleanly isolate in an auxiliary tools directory. |

---

## C. FALLBACK / MOCK DATA FINDINGS

| File | Line | Code / Pattern | What It Does | Why It Exists | Category | Risk Level | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `RMIMS/js/forecasting.js` | 158–169 | `materials = Object.values(supaMaterialsMap).map(...)` | Loads dropdown catalog from Supabase if Flask is offline. | Ensures UI catalog populates from DB catalog even if ML backend is restarting. | **B (Error State Handling)** | **LOW** | Keep as legitimate error fallback; maintain honest "Forecast Unavailable" state. |
| `RMIMS/js/user-management.js` | 111–116 | `function friendlyError(err, fallback) { return fallback; }` | Maps raw network/RPC exceptions to clean UI text. | Prevents raw stack trace leakage to UI. | **B (Error State Handling)** | **LOW** | Acceptable safe error-handling pattern. |
| `RMIMS/js/settings.js` | 47–52 | `function friendlyError(err, fallback) { return fallback; }` | Maps raw network/RPC exceptions to clean UI text. | Prevents raw stack trace leakage to UI. | **B (Error State Handling)** | **LOW** | Acceptable safe error-handling pattern. |
| `RMIMS/js/dashboard.js` | 148 | `Math.abs(Number(d.consumed_quantity \|\| 0))` | Coerces disbursements to positive numerical magnitudes. | Prevents negative sign rendering in consumption summaries. | **A (Legitimate UI Normalization)** | **LOW** | Keep; guarantees positive consumption display rule. |
| `RMIMS/js/dashboard.js` | 65–75 | `renderDashboardError(message)` | Displays structured error banner when DB query fails. | Informs user truthfully without inventing mock statistics. | **B (Legitimate Error State)** | **LOW** | Complies with zero-mock policy. |
| `RMIMS/js/user-inventory.js` | 200–201 | `const fallbackMs = toMillis(m.updated_at) \|\| ...` | Fallback timestamp calculation for inventory sorting. | Handles sorting when material has had no recent transaction. | **A (UI Empty-State Handling)** | **LOW** | Safe deterministic calculation. |
| `ml_backend/app.py` | 559–563 | `decision_status = "Inventory data unavailable"` | Returns honest status when material is not in DB. | Computes forecast from historical baseline without inventing fake stock numbers. | **B (Honest Error Handling)** | **LOW** | Fully compliant with Phase 7/9 zero-fake-data rules. |

---

## D. DATABASE FINDINGS

### 1. Schema & Table Architecture
The PostgreSQL database (Supabase project `hgandqozgcpytxebhvtn`) contains 5 core tables defined in [V2_FINAL_DATABASE_SCHEMA.sql](file:///c:/Users/Zeanna/Downloads/RMIMS-AI-BASED-FORECASTING-INTEGRATED/RMIMS-DASHBOARD-VIEW-3D-SUGAR-APPLIED/RMIMS-Supabase-ML-Forecasting-Integration/RMIMS/supabase/V2_FINAL_DATABASE_SCHEMA.sql):
- `public.user_profiles` (System Metadata / Access Control)
- `public.raw_materials` (Master Raw Materials Catalog & Balance)
- `public.stock_receipts` (Inflow Transaction Ledger)
- `public.material_disbursements` (Outflow Consumption Ledger)
- `public.activity_audit_logs` (Audit Compliance Ledger)

### 2. Transaction Integrity & Direct Stock Mutation Ban
- **Stored Procedures**: Direct updates to `raw_materials.current_stock` by non-admins are blocked by RLS. All stock movements must execute through `record_stock_receipt_v2()` and `record_material_disbursement_v2()`.
- **Concurrency Locking**: Stored procedures employ `SELECT ... FOR UPDATE` row locks to prevent race conditions during rapid disbursements.
- **Audit Logging**: Every successful receipt and disbursement automatically records an entry into `activity_audit_logs`.

### 3. Live Data Observations
- All 5 tables are accessible and structurally sound.
- In production/testing with standard anon client keys, RLS requires active session authentication (`is_active_user()`) to retrieve rows, preventing unauthorized data exfiltration.

---

## E. SECURITY FINDINGS

### 1. Row Level Security (RLS)
- **`user_profiles`**: Authenticated active users can view profiles; users can only update their own display name; admins have full management rights; trigger `trg_prevent_self_elevation` blocks non-admin self-promotion.
- **`raw_materials`**: Read access open to all active users; write access (insert, update catalog details, delete) restricted strictly to admins (`is_admin_user()`).
- **`stock_receipts` & `material_disbursements`**: Read and insert permissions granted to active users; updates/deletions restricted to admins.
- **`activity_audit_logs`**: Read access restricted to admins; insert open to active users; deletion blocked.

### 2. Credential Exposure Audit
- **Frontend Codebase**: Searched all HTML, JS, CSS, and asset files. **Zero service-role keys, private admin secrets, or database master passwords exist in the browser frontend.**
- **Configuration**: Client uses public anon publishable key (`SUPABASE_ANON_KEY`) in [supabase-config.js](file:///c:/Users/Zeanna/Downloads/RMIMS-AI-BASED-FORECASTING-INTEGRATED/RMIMS-DASHBOARD-VIEW-3D-SUGAR-APPLIED/RMIMS-Supabase-ML-Forecasting-Integration/RMIMS/supabase/supabase-config.js).
- **Backend**: Flask backend (`ml_backend/app.py`) reads credentials strictly from environment variables (`SUPABASE_URL`, `SUPABASE_KEY`) with fail-fast exception handling if missing.

---

## F. FRONTEND FINDINGS

### 1. DOM Elements & Canvas Registrations
All 13 canvas chart IDs across the application have corresponding initialization handlers:
- `admin/dashboard.html` ➔ `dashConsumptionChart`, `dashForecastChart` (Initialized by `js/dashboard.js`)
- `admin/forecasting.html` ➔ `forecastChart`, `top4ForecastChart`, `bundleForecastChart`, `horizonForecastChart`, `forecastRequirementBarChart`, `decisionDonutChart` (Initialized by `js/forecasting.js`)
- `admin/inventory.html` ➔ `invStatusDonutChart`, `invReceivedVsUsedChart` (Initialized by `js/inventory.js`)
- `admin/analytics.html` ➔ `distributionChart`, `consumptionChart`, `categoryDonutChart` (Initialized by `js/analytics.js`)
- `user/analytics.html` ➔ `trendChart` (Initialized by `js/user-analytics.js`)

### 2. Blank Visualization Protection
- Charts check `typeof Chart !== "undefined"` and verify data array length before attempting to construct Chart.js instances.
- If data is empty, canvas containers destroy previous instances and render clean empty-state fallback messages rather than crashing the JavaScript runtime.

---

## G. BACKEND & API FINDINGS

### 1. API Surface & Endpoints
| Endpoint | Method | Purpose | Auth Required | Backend Handler |
| :--- | :--- | :--- | :--- | :--- |
| `/api/ml/status` | GET | Health & model metadata report | No | `ml_status()` |
| `/api/ml/materials` | GET | 30-material registry catalog | No | `get_materials_catalog()` |
| `/api/ml/forecast` | GET/POST | Query forecast for material query param | Optional Bearer | `generic_forecast()` |
| `/api/ml/forecast/<mat_id>` | GET/POST | AutoReg weekly/monthly baseline forecast | Optional Bearer | `material_forecast_baseline()` |
| `/api/ml/forecast/<mat_id>/inventory` | GET/POST | Dynamic forecast + DB inventory comparison | Optional Bearer | `material_forecast_inventory()` |

### 2. Verification
- Safe GET requests to `/api/ml/status` report `status: healthy`, `models_loaded: 30`, and training cutoff `2026-08-09`.
- Non-existent material queries (e.g. `RM999`) return HTTP 404 with structured error JSON.

---

## H. FORECASTING & MACHINE LEARNING FINDINGS

### 1. Model Isolation & Architecture
- **Model Storage**: Exactly 30 finalized `.pkl` files stored in `ml_backend/models/RMIMS_FINAL_MODELS/`.
- **Model Type**: All 30 models deserialize as statsmodels `AutoRegResultsWrapper`.
- **Training Baseline**: Exactly 586 daily observations spanning `2025-01-01` to `2026-08-09`.
- **Zero Legacy Fallback**: The loader in `ml_backend/app.py` enforces a fail-fast policy; if any model file is missing or invalid, it aborts execution immediately rather than falling back to unapproved legacy artifacts.

### 2. Resolution & Unit Preservation
- Materials resolve bi-directionally by Item Code (`RM001`–`RM030`) and canonical material name (`Chiton`, `Sugar`, `Cooking Oil`, etc.).
- Unit integrity is strictly enforced across `kg`, `L`, and `loaf`. Mismatched unit queries trigger HTTP 400 validation errors.

---

## I. DATA INTEGRITY FINDINGS

1. **Unit Independence**:
   - Inventory movements, stock receipts, and disbursements enforce matching unit strings against the raw material catalog.
   - Summaries and dashboards group metrics by unit; quantities are never combined into arbitrary scalar sums (with the single exception noted in finding CRIT-02).
2. **Negative Quantities**:
   - Database schemas apply `CHECK (current_stock >= 0)`, `CHECK (received_quantity > 0)`, and `CHECK (consumed_quantity > 0)`.
   - UI formatting normalizes all consumption records via `Math.abs(...)`.
3. **Date Consistency**:
   - Import parser in `inventory.js` handles native Date objects, Excel serial numbers (1900 date system), ISO strings (`YYYY-MM-DD`), and US formats (`MM/DD/YYYY`).

---

## J. TEST SUITE RESULTS

| Verification Suite | Execution Command | Result |
| :--- | :--- | :--- |
| **Vite Production Build** | `npm.cmd run build` | **PASS** (`✓ built in 1.25s`, 60 modules transformed, 0 build errors) |
| **Frontend Endpoint Verification** | `python ml_backend/verify_frontend_endpoints.py` | **PASS** (`19/19 HTTP 200 OK`) |
| **Database Security & RLS Audit** | `python ml_backend/run_security_check.py` | **PASS** (`All privilege escalation & inventory tampering checks BLOCKED`) |
| **Forecasting & ML Integration Tests** | `python -m unittest test_forecasting_integration.py` | **PASS** (100% test pass rate) |
| **Edge Function Auth & Role Guard** | `python -m unittest test_edge_function_auth.py` | **PASS** (100% test pass rate) |
| **Phase 8.6 Live Data Gate** | `python -m unittest test_step_8_6_live_gate.py` | **PASS** (100% test pass rate) |
| **30-Model Parameter & Boundary Audit** | `python ml_backend/run_step_9_3_models_audit.py` | **PASS** (30/30 models valid) |

---

## K. SYSTEM ROUTE MAP

```
Public Landing (RMIMS/index.html)
        ↓
Portal Selector (RMIMS/portal.html)
   ├── Admin Login (RMIMS/login.html)
   │        ↓
   │   Admin Portal Routes:
   │   ├── Dashboard (RMIMS/admin/dashboard.html)
   │   ├── Inventory (RMIMS/admin/inventory.html)
   │   ├── Material Activity (RMIMS/admin/material-activity.html)
   │   ├── Consumption Analytics (RMIMS/admin/analytics.html)
   │   ├── AI-Based Forecasting (RMIMS/admin/forecasting.html)
   │   ├── Reports & Decision Support (RMIMS/admin/reports.html)
   │   ├── User Management (RMIMS/admin/user-management.html)
   │   └── Settings & Backup (RMIMS/admin/settings.html)
   │
   └── Staff / User Sign In (RMIMS/user-signin.html)
            ↓
       Staff Portal Routes:
       ├── Dashboard (RMIMS/user/dashboard.html)
       ├── Inventory View (RMIMS/user/inventory.html)
       ├── Material Activity (RMIMS/user/material-activity.html)
       ├── Consumption Analytics (RMIMS/user/analytics.html)
       ├── Reports (RMIMS/user/reports.html)
       └── User Settings (RMIMS/user/settings.html)
```

---

## L. RESTRUCTURING RISK MAP

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RESTRUCTURING RISK TIERS                        │
├────────────────────────────────────────────────────────────────────────┤
│ 1. FROZEN / DO NOT TOUCH (Security & Mathematical Foundation)          │
│    • RMIMS/supabase/V2_FINAL_DATABASE_SCHEMA.sql (RLS, SPs, Triggers)  │
│    • ml_backend/models/RMIMS_FINAL_MODELS/*.pkl (30 AutoReg Models)    │
│    • notebooks/RMIMS_FINAL_TRAINING_DATA.csv (Authoritative Training)  │
│    • ml_backend/run_security_check.py (Security Gate)                  │
├────────────────────────────────────────────────────────────────────────┤
│ 2. CAREFUL — HIGH DEPENDENCIES (Core Integration & Auth Layer)        │
│    • RMIMS/supabase/supabase-config.js (Global Client)                 │
│    • RMIMS/supabase/auth-service.js (Session & Role Routing)           │
│    • RMIMS/js/rmsme-shell.js (Shared Navigation & Profile Component)   │
│    • ml_backend/app.py (Authoritative Flask API & Resampling Logic)    │
│    • vite.config.js (Proxy & Multi-Page Rollup Config)                 │
├────────────────────────────────────────────────────────────────────────┤
│ 3. SAFE TO RESTRUCTURE (Modular Frontend Modules)                      │
│    • RMIMS/admin/*.html and RMIMS/js/ (dashboard, inventory, etc.)     │
│    • RMIMS/user/*.html and RMIMS/js/ (user-dashboard, etc.)            │
│    • CSS stylesheets (rmims-theme.css, index.css, user-auth.css)      │
├────────────────────────────────────────────────────────────────────────┤
│ 4. SAFE TO QUARANTINE / CLEANUP (Orphaned / Legacy Files)              │
│    • RMIMS/supabase/db-compat.js (Unreferenced)                        │
│    • legacy_archive/ (Deprecated Phase 1–5 artifacts)                  │
│    • scratch/ (Temporary image inspection scripts)                     │
│    • RMIMS/kiosk-checkin.html & RMIMS/js/welcome.js (Unlinked)          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## M. RECOMMENDED RESTRUCTURE ORDER

When proceeding with future restructuring, execute in the following safe, dependency-ordered sequence:

1. **Phase 1: Environment & API Base URL Standardization**
   - Replace hardcoded `http://127.0.0.1:5000` in `forecasting.js` and `dashboard.js` with environment-aware relative `/api/ml` endpoints.
2. **Phase 2: Quarantine Orphaned Legacy Files**
   - Move unreferenced files (`db-compat.js`, `legacy_archive/`, scratch files) into a designated archive without touching active JS imports.
3. **Phase 3: Module Script & Bundler Optimization**
   - Convert vanilla script tags (`chart.js`, `rmsme-shell.js`, `landing.js`) to ES module imports to eliminate Vite build warnings.
4. **Phase 4: Unit Integrity Guard in Analytics**
   - Refactor `renderBarChart()` in `analytics.js` so that the "Others" bucket respects unit boundaries when "All Units" is selected.
5. **Phase 5: Shared Component Extraction**
   - Formalize `rmsme-shell.js` and toast notification utilities into shared, reusable ES modules for Admin and User portals.
6. **Phase 6: Operational Module Refactoring (Admin & Staff)**
   - Refactor Admin and User portal views independently (Dashboard ➔ Inventory ➔ Activity ➔ Forecasting ➔ Analytics ➔ Reports ➔ Settings).
7. **Phase 7: End-to-End Regression & Security Gate Verification**
   - Re-run full test suite (`npm run build`, `verify_frontend_endpoints.py`, `run_security_check.py`, ML unit tests) to guarantee zero functional or security regressions.

---

## AUDIT COMPLETION STATEMENT

**NO SYSTEM MODIFICATIONS WERE PERFORMED DURING THIS AUDIT.**

---

## TOP 10 ISSUES TO RESOLVE BEFORE RESTRUCTURING

1. **Eliminate Hardcoded `127.0.0.1:5000` URLs**: Standardize `forecasting.js` (line 13) and `dashboard.js` (line 864) to use environment-driven relative proxy URLs.
2. **Fix Mixed-Unit Summation in Analytics**: Ensure `distributionChart` in `analytics.js` does not sum disparate units (kg, L, loaf) into a single "Others" bar.
3. **Quarantine Unreferenced `db-compat.js`**: Isolate the unused 365-line compatibility adapter to prevent developer confusion during restructuring.
4. **Resolve Vite Non-Module Script Warnings**: Convert `<script src=".../chart.js">` and `<script src=".../rmsme-shell.js">` to standard module imports.
5. **Formalize Orphaned Kiosk Page**: Determine whether `kiosk-checkin.html` / `welcome.js` should be archived or officially linked.
6. **Standardize Shared Shell Profile State**: Refactor profile avatar and identity syncing across `rmsme-shell.js`, `dashboard.js`, and `user-dashboard.js` into a unified auth state subscriber.
7. **Protect Frozen ML Registry**: Ensure `ml_backend/models/RMIMS_FINAL_MODELS` and its 30 model weights remain strictly read-only and immutable during directory changes.
8. **Preserve RLS Stored Procedure Authority**: Ensure no refactoring reintroduces direct client-side `current_stock` updates; keep all stock movements mediated via PostgreSQL stored procedures.
9. **Eliminate Redundant Localhost Proxy Rules**: Align `vite.config.js` proxy paths (`/api`, `/forecast`, `/health`, `/historical-usage`) with active Flask endpoints.
10. **Clean Up Scratch & Legacy Archive Directories**: Move temporary test scripts in `scratch/` and outdated schemas in `legacy_archive/` outside the production build scope.
