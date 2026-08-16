// supabase/supabase-config.js
//
// Supabase client configuration.
// no bundler, imported straight from a CDN in the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ------------------------------------------------------------------
// TODO: replace with YOUR Supabase project values.
// Project Settings -> API in the Supabase dashboard.
// The "anon" public key is safe to expose client-side (same trust
// public client key; Row Level Security
// policies (see supabase/schema.sql) are enabled — they are.
// ------------------------------------------------------------------
// Exported (not just module-local) so admin/user-management.js can spin
// up a short-lived, non-persisted secondary client for Admin-driven
// account creation — see the comment above createAuthAccount() there
// for why a second client is needed instead of reusing this one.
export const SUPABASE_URL = "https://zdslycwczwfsjdxkwokt.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpkc2x5Y3djendmc2pkeGt3b2t0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNDQ4NzUsImV4cCI6MjEwMTcyMDg3NX0.ov_FvAiAuMmr651Yy2kf9Tnp6qctIHYddRVx9HathU0";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
    }
});

// The rest of the app imports { auth, db } (matching the old
// The application imports the shared Supabase client and compatibility helpers.
// need the Supabase client itself — collection()/doc() call `.from()`
// on it, and onAuthStateChanged()/signIn()/etc. call `.auth.*` on it —
// so both names point at the same client instance.
export const auth = supabase;
export const db = supabase;

export default supabase;
