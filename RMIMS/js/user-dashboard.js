// js/user-dashboard.js
// Staff Operational Dashboard — RMIMS V2.
// Summarizes live authoritative data from public.raw_materials, public.stock_receipts,
// public.material_disbursements, and public.user_profiles.
// Strictly READ-ONLY. Zero direct stock mutations. Zero mock data.

import { supabase, auth } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";
import { checkAndShowOnboarding } from "./onboarding.js";

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
   ROLE GUARD & AUTH SESSION PERSISTENCE
   ============================================================ */

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "../user-signin.html";
    return;
  }

  try {
    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("id, full_name, email, role, status")
      .eq("id", user.uid)
      .maybeSingle();

    if (error || !profile || profile.status !== "active") {
      window.location.href = "../user-signin.html";
      return;
    }

    if (profile.role !== "user") {
      window.location.href = "../admin/dashboard.html";
      return;
    }

    await checkAndShowOnboarding(profile, supabase);

    const firstName = (profile.full_name || "there").split(" ")[0];
    if ($("welcomeGreeting")) {
      $("welcomeGreeting").textContent = `${greetingWord()}, ${firstName} — Daily Operations`;
    }

    const pBtn = $("profileBtn");
    if (pBtn) {
      const pText = pBtn.querySelector(".profile-text") || pBtn;
      pText.textContent = profile.full_name || profile.email || "Staff Member";
      const pAv = pBtn.querySelector(".avatar");
      if (pAv && profile.full_name) {
        pAv.textContent = profile.full_name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map(x => x[0].toUpperCase())
          .join("");
      }
    }

    initUserDashboard();
  } catch (e) {
    console.error("User auth check error:", e);
    window.location.href = "../user-signin.html";
  }
});

/* ============================================================
   LIVE DATA FETCH & INITIALIZATION
   ============================================================ */

async function initUserDashboard() {
  try {
    const matRes = await supabase
      .from("raw_materials")
      .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, description")
      .order("name");

    if (matRes.error) {
      console.error("User raw_materials fetch error:", matRes.error);
      const feed = $("activityFeed");
      if (feed) {
        feed.innerHTML = `
          <div class="forecast-state-box error">
            <strong>Unable to load inventory data:</strong>
            <span>${esc(matRes.error.message)}</span>
          </div>
        `;
      }
      return;
    }

    const useRes = await supabase
      .from("material_disbursements")
      .select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at")
      .order("usage_date", { ascending: false });

    if (useRes.error) console.warn("Disbursements notice:", useRes.error);

    const recRes = await supabase
      .from("stock_receipts")
      .select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at")
      .order("receipt_date", { ascending: false });

    if (recRes.error) console.warn("Stock receipts notice:", recRes.error);

    const rawMats = matRes.data || [];
    const rawUsage = useRes.data || [];
    const rawReceipts = recRes.data || [];

    const materials = rawMats.map(m => {
      const stock = Number(m.current_stock || 0);
      const min = m.minimum_threshold !== null ? Number(m.minimum_threshold) : null;
      let status = "Available";
      if (stock <= 0) {
        status = "Critical"; // Out of stock
      } else if (min !== null && stock <= min) {
        status = "Low"; // Low stock
      }
      return {
        id: m.id,
        itemCode: m.item_code,
        materialName: m.name,
        unit: (m.unit_of_measure || "kg").trim(),
        quantity: stock,
        minimumThreshold: min,
        status
      };
    });

    const matMap = new Map(materials.map(m => [m.id, m]));

    const stockReceipts = rawReceipts.map(r => ({
      id: r.id,
      materialId: r.material_id,
      materialName: matMap.get(r.material_id)?.materialName || "Raw Material",
      receivedQuantity: Math.abs(Number(r.received_quantity || 0)),
      receivedDate: r.receipt_date,
      unit: (r.unit || matMap.get(r.material_id)?.unit || "kg").trim(),
      supplierName: r.supplier_name,
      createdAt: r.created_at
    }));

    const usageRecords = rawUsage.map(d => {
      const rawProd = d.finished_product_name ? d.finished_product_name.trim() : "";
      const isProduct = rawProd && rawProd !== "General Usage";
      return {
        id: d.id,
        materialId: d.material_id,
        materialName: matMap.get(d.material_id)?.materialName || "Raw Material",
        usedQuantity: Math.abs(Number(d.consumed_quantity || 0)),
        usageDate: d.usage_date,
        unit: (d.unit || matMap.get(d.material_id)?.unit || "kg").trim(),
        productName: isProduct ? rawProd : null,
        activityType: d.activity_type,
        createdAt: d.created_at
      };
    });

    const total = materials.length;
    const available = materials.filter(m => Number(m.quantity || 0) > Number(m.minimumThreshold || 0)).length;
    const low = materials.filter(m => Number(m.quantity || 0) > 0 && Number(m.quantity || 0) <= Number(m.minimumThreshold || 0)).length;
    const out = materials.filter(m => Number(m.quantity || 0) <= 0).length;
    const activityTotal = stockReceipts.length + usageRecords.length;

    if ($("userTotalMat")) $("userTotalMat").textContent = total;
    if ($("userAvailableMat")) $("userAvailableMat").textContent = available;
    if ($("userLowMat")) $("userLowMat").textContent = low;
    if ($("userOutMat")) $("userOutMat").textContent = out;
    if ($("userActivityCount")) $("userActivityCount").textContent = `${activityTotal} event${activityTotal === 1 ? "" : "s"}`;

    renderUserStockAttention(materials);
    renderUserForecastAdvice(materials);
    renderActivityFeed(usageRecords, stockReceipts);
    renderConsumptionSummary(usageRecords);

  } catch (err) {
    console.error("Failed loading staff dashboard data:", err);
  }
}

/* ============================================================
   1. WHAT NEEDS ATTENTION TODAY (HUMAN-FRIENDLY STOCK ALERTS)
   ============================================================ */

function renderUserStockAttention(materials) {
  const container = $("userAttentionContainer");
  const badge = $("userAttentionBadge");
  if (!container) return;

  const needy = (materials || []).filter(
    m => m.status === "Low" || m.status === "Critical" || Number(m.quantity || 0) <= Number(m.minimumThreshold || 0)
  );

  if (badge) {
    badge.textContent = `${needy.length} Item${needy.length === 1 ? "" : "s"}`;
    badge.className = `panel-badge ${needy.length === 0 ? "badge-good" : "badge-warn"}`;
  }

  if (needy.length === 0) {
    container.innerHTML = `
      <div class="user-attention-card good">
        <div class="attention-icon">✓</div>
        <div class="attention-content">
          <strong>All materials are ready for operations.</strong>
          <p>No ingredients are currently running low or out of stock.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = needy.map(m => {
    const isOut = Number(m.quantity || 0) <= 0 || m.status === "Critical";
    const statusLabel = isOut ? "Out of Stock" : "Running Low";
    const adviceText = isOut
      ? `${esc(m.materialName)} has 0 ${esc(m.unit)} remaining. Please receive new delivery before preparing dishes.`
      : `${esc(m.materialName)} is running low with only ${m.quantity} ${esc(m.unit)} left (safety minimum: ${m.minimumThreshold} ${esc(m.unit)}).`;

    return `
      <div class="user-attention-card ${isOut ? "critical" : "warning"}">
        <div class="attention-icon">${isOut ? "✕" : "!"}</div>
        <div class="attention-content">
          <div class="attention-top">
            <strong>${esc(m.materialName)}</strong>
            <span class="stock-tag ${isOut ? "tag-out" : "tag-low"}">${esc(statusLabel)}</span>
          </div>
          <p>${esc(adviceText)}</p>
        </div>
      </div>
    `;
  }).join("");
}

/* ============================================================
   2. UPCOMING REQUIREMENTS (SIMPLE PLAIN-LANGUAGE FORECAST)
   ============================================================ */

async function renderUserForecastAdvice(materials) {
  const container = $("userForecastContainer");
  const badge = $("userForecastBadge");
  if (!container) return;

  if (!materials || materials.length === 0) {
    container.innerHTML = `<div class="empty-state"><span>No materials in catalog.</span></div>`;
    return;
  }

  // Choose prominent material (e.g. Sugar or lowest material)
  const sugarMat = materials.find(m => m.materialName.toLowerCase() === "sugar");
  const targetMat = sugarMat || materials[0];

  const apiBase = window.ENV_FLASK_API_BASE || (window.location.protocol.startsWith("http") ? "" : "http://127.0.0.1:5000");
  const endpoint = `${apiBase}/api/ml/forecast/${encodeURIComponent(targetMat.materialName)}/inventory`;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";

    const res = await fetch(endpoint, {
      method: "GET",
      headers: { "Accept": "application/json", "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) {
      container.innerHTML = `
        <div class="user-forecast-card">
          <strong>Upcoming Demand</strong>
          <p>Forecast service is currently offline. Review current stock levels directly in inventory.</p>
        </div>
      `;
      return;
    }

    const data = await res.json();
    if (data && data.status === "success") {
      const f7 = Number(data.forecast7Day?.quantity) || 0;
      const unit = data.unit || "kg";
      const liveStock = targetMat.quantity;
      const isDeficit = liveStock < f7;

      if (badge) badge.textContent = `${targetMat.materialName} Forecast`;

      container.innerHTML = `
        <div class="user-forecast-card">
          <div class="forecast-top">
            <strong>${esc(targetMat.materialName)} — Expected 7-Day Requirement</strong>
            <span class="forecast-qty-pill">${f7.toFixed(1)} ${esc(unit)}</span>
          </div>
          <p style="margin-top: 6px; font-size: 13px; color: #D7E0EA;">
            Based on recent usage patterns, kitchen operations will require approximately <strong>${f7.toFixed(1)} ${esc(unit)}</strong> over the next 7 days.
            Current available stock is <strong>${liveStock.toFixed(1)} ${esc(unit)}</strong>.
          </p>
          <div style="margin-top: 8px; font-size: 12px; color: ${isDeficit ? '#FCA5A5' : '#86EFAC'};">
            ${isDeficit ? `⚠️ Current stock may be insufficient for the full week. Prepare to receive delivery.` : `✓ Available stock is sufficient for this week's projected usage.`}
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="user-forecast-card">
          <strong>Upcoming Demand</strong>
          <p>No forecast projection available yet.</p>
        </div>
      `;
    }
  } catch (e) {
    console.warn("User forecast advice notice:", e);
    container.innerHTML = `
      <div class="user-forecast-card">
        <strong>Upcoming Demand</strong>
        <p>Forecast data currently unavailable.</p>
      </div>
    `;
  }
}

/* ============================================================
   3. RECENT ACTIVITY FEED
   ============================================================ */

function renderActivityFeed(usageRecords, stockReceipts) {
  const feed = $("activityFeed");
  const countBadge = $("activitiesCount");
  if (!feed) return;

  const events = [
    ...stockReceipts.map(r => ({
      date: r.createdAt || r.receivedDate,
      badge: "RECEIVED",
      badgeCls: "received",
      material: r.materialName || "Material",
      qty: Math.abs(Number(r.receivedQuantity || 0)),
      unit: r.unit || "kg",
      detail: r.supplierName ? `From ${r.supplierName}` : "Stock Delivery"
    })),
    ...usageRecords.map(u => ({
      date: u.createdAt || u.usageDate,
      badge: u.productName ? "USED" : "CONSUMED",
      badgeCls: u.productName ? "used" : "consumed",
      material: u.materialName || "Material",
      qty: Math.abs(Number(u.usedQuantity || 0)),
      unit: u.unit || "kg",
      detail: u.productName ? `For ${u.productName}` : "Daily Kitchen Usage"
    }))
  ]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 8);

  if (countBadge) countBadge.textContent = `${events.length} Event${events.length === 1 ? "" : "s"}`;

  if (events.length === 0) {
    feed.innerHTML = `
      <div class="empty-state">
        <strong>No recent activity</strong>
        <span>Recent stock receipts and kitchen usage events will appear here once recorded.</span>
      </div>
    `;
    return;
  }

  feed.innerHTML = events.map(e => `
    <div class="activity-row">
      <div class="activity-left">
        <span class="activity-badge ${e.badgeCls}">${esc(e.badge)}</span>
        <div class="activity-body">
          <strong>${esc(e.material)}</strong>
          <small>${esc(e.detail)}</small>
        </div>
      </div>
      <div class="activity-right">
        <span class="activity-qty">${e.qty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${esc(e.unit)}</span>
        <span class="activity-time">${e.date ? esc(new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })) : "—"}</span>
      </div>
    </div>
  `).join("");
}

/* ============================================================
   4. CONSUMPTION & USAGE HIGHLIGHTS
   ============================================================ */

function renderConsumptionSummary(usageRecords) {
  const narrative = $("consumptionNarrative");
  const history = $("consumptionHistory");

  if (!usageRecords || usageRecords.length === 0) {
    if (narrative) narrative.innerHTML = `<span>No usage records logged yet.</span>`;
    if (history) history.innerHTML = `<div class="empty-state"><span>No consumption history yet.</span></div>`;
    return;
  }

  const totalsByUnit = {};
  usageRecords.forEach(u => {
    const unit = (u.unit || "kg").trim();
    const qty = Math.abs(Number(u.usedQuantity || 0));
    totalsByUnit[unit] = (totalsByUnit[unit] || 0) + qty;
  });

  const unitPills = Object.entries(totalsByUnit)
    .map(([u, sum]) => `<span class="unit-badge-pill"><strong>${sum.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</strong> ${esc(u)}</span>`)
    .join(" &bull; ");

  if (narrative) {
    narrative.innerHTML = `
      <div>
        <strong>${usageRecords.length} usage record${usageRecords.length === 1 ? "" : "s"} logged</strong>
        <div style="margin-top: 6px;">Total: ${unitPills}</div>
      </div>
    `;
  }

  if (history) {
    const matMap = new Map();
    usageRecords.forEach(u => {
      const key = u.materialId || u.materialName;
      const qty = Math.abs(Number(u.usedQuantity || 0));
      if (!matMap.has(key)) {
        matMap.set(key, {
          materialName: u.materialName,
          unit: u.unit || "kg",
          totalQuantity: 0
        });
      }
      matMap.get(key).totalQuantity += qty;
    });

    const sorted = [...matMap.values()].sort((a, b) => b.totalQuantity - a.totalQuantity).slice(0, 5);

    history.innerHTML = sorted.map(u => `
      <div class="history-row">
        <strong>${esc(u.materialName)}</strong>
        <span class="history-row-qty">${u.totalQuantity.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${esc(u.unit || "")}</span>
      </div>
    `).join("");
  }
}
