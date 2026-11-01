// supabase/supabase-config.js
//
// Supabase client configuration.
// no bundler, imported straight from a CDN in the browser.

// NOTE: the client is loaded with a dynamic import + timeout (instead of a static
// import) so a slow/blocked CDN can never freeze every page that depends on this
// module (this was why Raw Materials sat at 0 forever). If every CDN fails we fall
// back to an inert offline client and the app keeps working from local data.
const SUPABASE_CDNS = [
    new URL("../vendor/supabase/supabase.esm.js", import.meta.url).href,
    "https://esm.sh/@supabase/supabase-js@2",
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
];

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("CDN timeout")), ms))
    ]);
}

async function loadCreateClient() {
    for (const url of SUPABASE_CDNS) {
        try {
            const mod = await withTimeout(import(/* @vite-ignore */ url), url.includes("/vendor/") ? 8000 : 3500);
            if (mod && typeof mod.createClient === "function") return mod.createClient;
        } catch (e) {
            console.warn("[Supabase] CDN unavailable, trying next:", url);
        }
    }
    return null;
}

function createOfflineClient() {
    const result = { data: null, error: { message: "Supabase offline - using local data" } };
    const makeQuery = () => {
        const q = new Proxy(function () {}, {
            get(_t, prop) {
                if (prop === "then") return (res) => Promise.resolve(result).then(res);
                if (prop === "catch") return (rej) => Promise.resolve(result).catch(rej);
                return () => q;
            },
            apply() { return q; }
        });
        return q;
    };
    const noopSub = { data: { subscription: { unsubscribe() {} } } };
    return {
        __offline: true,
        from: () => makeQuery(),
        rpc: () => makeQuery(),
        channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
        removeChannel: () => {},
        storage: { from: () => makeQuery() },
        functions: { invoke: async () => result },
        auth: {
            getSession: async () => ({ data: { session: null }, error: null }),
            getUser: async () => ({ data: { user: null }, error: null }),
            onAuthStateChange: () => noopSub,
            signOut: async () => ({ error: null }),
            signInWithPassword: async () => ({ data: { user: null, session: null }, error: result.error }),
            signUp: async () => ({ data: { user: null, session: null }, error: result.error })
        }
    };
}

const createClient = await loadCreateClient();

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

export const supabase = createClient
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false
        }
    })
    : createOfflineClient();

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

