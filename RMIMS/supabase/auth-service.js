// supabase/auth-service.js
// Supabase authentication service. Same exported functions
// (loginUser, registerUser), same behavior, now backed by Supabase.

import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    updateProfile
} from "./auth-compat.js";

import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    serverTimestamp
} from "./db-compat.js";

import { auth, db } from "./supabase-config.js";

export async function loginUser(email, password) {

    const userCredential = await signInWithEmailAndPassword(auth, email, password);

    const uid = userCredential.user.uid;

    const userDoc = await getDoc(doc(db, "users", uid));

    if (!userDoc.exists()) {
        await signOut(auth);
        throw new Error("No account record found. Please contact your administrator.");
    }

    const data = userDoc.data();

    if (data.status !== "active") {
        await signOut(auth);
        throw new Error("Your account is pending admin approval. Please try again later.");
    }

    // Powers the "Last Activity" column in Admin → User Management.
    // Best-effort: a failure here must never block login.
    try {
        await updateDoc(doc(db, "users", uid), { lastActivityAt: serverTimestamp() });
    } catch (err) {
        console.warn("Could not update lastActivityAt:", err);
    }

    if (data.role === "admin") {
        window.location.href = "admin/dashboard.html";
    } else {
        window.location.href = "user/dashboard.html";
    }
}

export async function registerUser(fullName, email, password) {

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    const uid = userCredential.user.uid;

    await updateProfile(userCredential.user, { displayName: fullName });

    await setDoc(doc(db, "users", uid), {
        fullName: fullName,
        email: email,
        role: "user",
        status: "inactive",
        createdAt: serverTimestamp()
    });

    await signOut(auth);

    return true;
}