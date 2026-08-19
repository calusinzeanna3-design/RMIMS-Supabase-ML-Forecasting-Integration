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
export const SUPABASE_URL = "https://hgandqozgcpytxebhvtn.supabase.co";
export const SUPABASE_ANON_KEY = window.ENV_SUPABASE_ANON_KEY || window.ENV_SUPABASE_KEY || "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-";

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
