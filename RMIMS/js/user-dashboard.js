// js/user-dashboard.js
// Staff Operational Dashboard — Inventory Command Center matching Admin UI quality.

import { auth, db } from "../supabase/supabase-config.js";
import { collection, getDocs } from "../supabase/db-compat.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

const $ = id => document.getElementById(id);

const esc = v =>
    String(v ?? "").replace(
        /[&<>"']/g,
        c => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[c])
    );

function greetingWord() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
}

/* ============================================================
   ROLE GUARD & AUTH
   ============================================================ */

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "../login.html"; return; }

    const snap = await getDocs(collection(db, "users"));
    const profile = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(u => u.id === user.uid);

    if (!profile || profile.status !== "active") { window.location.href = "../login.html"; return; }
    if (profile.role !== "user") { window.location.href = "../admin/dashboard.html"; return; }

    const firstName = (profile.fullName || "there").split(" ")[0];
    if ($("welcomeGreeting")) {
        $("welcomeGreeting").textContent = `Inventory Command Center — ${greetingWord()}, ${firstName}`;
    }

    const pBtn = $("profileBtn");
    if (pBtn) {
        const pText = pBtn.querySelector(".profile-text") || pBtn;
        pText.textContent = `${profile.fullName || "Staff Member"} ▼`;
        const pAv = pBtn.querySelector(".avatar");
        if (pAv && profile.fullName) {
            pAv.textContent = profile.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
        }
    }

    initUserDashboard();
});

/* ============================================================
   DATA FETCH & RENDER
   ============================================================ */

async function initUserDashboard() {
    try {
        const [matSnap, usageSnap, receiptSnap] = await Promise.all([
            getDocs(collection(db, "materials")),
            getDocs(collection(db, "usageRecords")),
            getDocs(collection(db, "stockReceipts"))
        ]);

        const materials = matSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const usageRecords = usageSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const stockReceipts = receiptSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const total = materials.length;
        const available = materials.filter(m => Number(m.quantity || 0) > Number(m.minimumThreshold || 10)).length;
        const low = materials.filter(m => Number(m.quantity || 0) > 0 && Number(m.quantity || 0) <= Number(m.minimumThreshold || 10)).length;
        const out = materials.filter(m => Number(m.quantity || 0) <= 0).length;

        if ($("userTotalMat")) $("userTotalMat").textContent = total;
        if ($("userAvailableMat")) $("userAvailableMat").textContent = available;
        if ($("userLowMat")) $("userLowMat").textContent = low;
        if ($("userOutMat")) $("userOutMat").textContent = out;

        renderActivityFeed(usageRecords, stockReceipts);
        renderConsumptionSummary(usageRecords);
        renderRecommendations(materials);
    } catch (err) {
        console.error("Failed loading staff dashboard data:", err);
    }
}

/* ============================================================
   RECENT ACTIVITY FEED
   ============================================================ */

function renderActivityFeed(usageRecords, stockReceipts) {
    const feed = $("activityFeed") || $("userActivityFeed");
    const countBadge = $("activitiesCount") || $("activityLogCount");
    if (!feed) return;

    const events = [
        ...stockReceipts.map(r => ({
            date: r.createdAt || r.receivedDate,
            type: "Received",
            material: r.materialName || "Material",
            qty: r.receivedQuantity || 0,
            unit: r.unit || "",
            product: null
        })),
        ...usageRecords.map(u => ({
            date: u.createdAt || u.usageDate,
            type: u.productName ? "Used" : "Consumed",
            material: u.materialName || "Material",
            qty: u.usedQuantity || 0,
            unit: u.unit || "",
            product: u.productName || null
        }))
    ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 8);

    if (countBadge) countBadge.textContent = events.length;

    if (events.length === 0) {
        feed.innerHTML = `<div class="empty-state"><strong>No recent activity</strong><span>Inventory activity will appear here after records are logged.</span></div>`;
        return;
    }

    feed.innerHTML = events.map(e => `
        <div class="activity-row">
            <span class="activity-dot"></span>
            <span class="activity-main">
                <strong>${esc(e.type)} — ${esc(e.material)}</strong>
                <small>${e.product ? `For ${esc(e.product)} · ` : ""}${esc(e.qty)} ${esc(e.unit)}</small>
            </span>
            <span class="activity-time">${e.date ? esc(new Date(e.date).toLocaleDateString()) : "—"}</span>
        </div>
    `).join("");
}

/* ============================================================
   CONSUMPTION SUMMARY & NARRATIVE
   ============================================================ */

function renderConsumptionSummary(usageRecords) {
    const narrative = $("consumptionNarrative");
    const history = $("consumptionHistory");

    const totalUsed = usageRecords.reduce((s, u) => s + (Number(u.usedQuantity) || 0), 0);

    if (narrative) {
        narrative.textContent = usageRecords.length
            ? `${usageRecords.length} consumption record${usageRecords.length === 1 ? "" : "s"} logged, with ${totalUsed.toLocaleString()} total units consumed across production runs.`
            : "No consumption records logged yet.";
    }

    if (history) {
        const sorted = usageRecords.slice().sort((a, b) => new Date(b.usageDate || b.createdAt || 0) - new Date(a.usageDate || a.createdAt || 0)).slice(0, 5);

        if (sorted.length === 0) {
            history.innerHTML = `<div class="empty-state"><span>No consumption history yet.</span></div>`;
            return;
        }

        history.innerHTML = sorted.map(u => `
            <div class="history-row">
                <strong>${esc(u.materialName)}</strong>
                <span>-${esc(u.usedQuantity)} ${esc(u.unit || "")}</span>
            </div>
        `).join("");
    }
}

/* ============================================================
   RECOMMENDATIONS / STOCK ATTENTION
   ============================================================ */

function renderRecommendations(materials) {
    const container = $("recommendationsContainer");
    if (!container) return;

    const needy = materials.filter(m => m.status === "Low" || m.status === "Critical" || Number(m.quantity || 0) <= Number(m.minimumThreshold || m.minStock || 10));

    if (needy.length === 0) {
        container.innerHTML = `
            <div class="recommendation-result">
                <div class="recommendation-result-main">
                    <span class="recommendation-result-dot" style="background: linear-gradient(135deg, #10B981, #059669); box-shadow: 0 0 0 5px rgba(16,185,129,.12);"></span>
                    <span class="recommendation-result-copy">
                        <strong>All Stock Levels Healthy</strong>
                        <span>All raw materials currently meet or exceed target operational thresholds.</span>
                    </span>
                </div>
                <span class="badge good" style="padding:6px 12px; font-size:12px; border-radius:20px; flex-shrink:0;">✓ Optimal</span>
            </div>
        `;
        return;
    }

    container.innerHTML = needy.map(m => {
        const isCritical = m.status === "Critical";
        return `
            <div class="recommendation-result">
                <div class="recommendation-result-main">
                    <span class="recommendation-result-dot" style="${isCritical ? 'background: linear-gradient(135deg, #EF4444, #DC2626); box-shadow: 0 0 0 5px rgba(239,68,68,.12);' : 'background: linear-gradient(135deg, #F59E0B, #D97706); box-shadow: 0 0 0 5px rgba(245,158,11,.12);'}"></span>
                    <span class="recommendation-result-copy">
                        <strong>${esc(m.materialName)}</strong>
                        <span>Current balance: ${m.quantity} ${esc(m.unit || "")} (Min: ${m.minimumThreshold || m.minStock || 10})</span>
                    </span>
                </div>
                <span class="badge ${isCritical ? 'bad' : 'warn'}" style="padding:6px 12px; font-size:12px; border-radius:20px; flex-shrink:0;">${esc(m.status || "Low Stock")}</span>
            </div>
        `;
    }).join("");
}
