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

// The rest of the app imports { auth, db }.
// To ensure 100% interoperability across all roles and pages whether code calls
// auth.signInWithPassword(), auth.auth.signInWithPassword(), auth.getSession(),
// auth.signOut(), or auth.from(), we wrap supabase.auth in a proxy that delegates
// to auth methods directly, while falling back to supabase root properties.
export const auth = (supabase && supabase.auth)
    ? new Proxy(supabase.auth, {
        get(target, prop, receiver) {
            if (prop === 'auth') return target;
            if (prop in target || typeof target[prop] !== 'undefined') {
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            }
            if (prop in supabase || typeof supabase[prop] !== 'undefined') {
                const val = supabase[prop];
                return typeof val === 'function' ? val.bind(supabase) : val;
            }
            return Reflect.get(target, prop, receiver);
        }
    })
    : supabase;

export const db = supabase;

if (typeof window !== 'undefined') {
    window.supabase = supabase;
    window.__rmimsSupabase = supabase;
    window.__rmimsAuth = auth;
}

export default supabase;

