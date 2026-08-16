// supabase/auth-compat.js
//
// A small authentication compatibility adapter backed by Supabase Auth.
// Preserves the existing call shapes RMIMS already uses everywhere:
// onAuthStateChanged(auth, cb), signInWithEmailAndPassword(auth, email, pw),
// createUserWithEmailAndPassword(auth, email, pw), signOut(auth),
// updateProfile(user, { displayName }).
//
// `auth` throughout RMIMS is just the Supabase client (see
// supabase-config.js, which exports the same client as both `auth`
// and `db`).

// Supabase user.id is exposed as uid, plus a displayName mirror so
// existing RMIMS login code can keep working without changes.
// `authClient` is stashed on the object so updateProfile(user, ...) below
// (which receives the user object — not
// the auth client) can still call back into Supabase Auth.
function toSupabaseUser(supabaseUser, authClient) {
    if (!supabaseUser) return null;
    return {
        uid: supabaseUser.id,
        email: supabaseUser.email,
        displayName: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.displayName || null,
        _authClient: authClient
    };
}

// Maps common Supabase Auth error messages to the error
// `.code` values that js/login.js's friendlyAuthError() already
// checks for, so existing error handling keeps working unchanged.
function toSupabaseError(error) {
    if (!error) return error;
    const msg = (error.message || "").toLowerCase();

    let code = "";
    if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("already been registered")) {
        code = "auth/email-already-in-use";
    } else if (msg.includes("invalid email") || msg.includes("unable to validate email")) {
        code = "auth/invalid-email";
    } else if (msg.includes("password") && (msg.includes("least") || msg.includes("weak") || msg.includes("short"))) {
        code = "auth/weak-password";
    }

    const wrapped = new Error(error.message);
    wrapped.code = code;
    return wrapped;
}

export function getAuth(supabaseClient) {
    return supabaseClient;
}

export async function signInWithEmailAndPassword(auth, email, password) {
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error) throw toSupabaseError(error);
    return { user: toSupabaseUser(data.user, auth) };
}

export async function createUserWithEmailAndPassword(auth, email, password) {
    const { data, error } = await auth.auth.signUp({ email, password });
    if (error) throw toSupabaseError(error);
    return { user: toSupabaseUser(data.user, auth) };
}

export async function signOut(auth) {
    const { error } = await auth.auth.signOut();
    if (error) throw error;
}

export async function updateProfile(user, { displayName }) {
    if (!user || !user._authClient) return;
    const { error } = await user._authClient.auth.updateUser({ data: { full_name: displayName } });
    if (error) throw error;
}

// onAuthStateChanged(auth, callback) — fires immediately with the
// current session, then
// on every future sign-in/sign-out.
export function onAuthStateChanged(auth, callback) {
    auth.auth.getSession().then(({ data }) => {
        callback(toSupabaseUser(data.session?.user, auth));
    });

    const { data: sub } = auth.auth.onAuthStateChange((_event, session) => {
        callback(toSupabaseUser(session?.user, auth));
    });

    // Returns an unsubscribe function.
    return () => sub.subscription.unsubscribe();
}
