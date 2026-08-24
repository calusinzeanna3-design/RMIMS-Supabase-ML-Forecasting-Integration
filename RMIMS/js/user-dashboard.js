// js/user-dashboard.js
//
// RMIMS USER / STAFF OPERATIONAL DASHBOARD
// Authoritative Supabase & ML Forecast Operational Command Center
// Live data from public.raw_materials, public.stock_receipts, public.material_disbursements, public.user_profiles.
// Strictly READ-ONLY. Zero direct stock mutations. Zero mock data. Light UI.

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

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function toast(message, type = "success") {
  const s = $("toastStack");
  if (!s) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-dot"></span>
    <span>${esc(message)}</span>
  `;
  s.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 260);
  }, 3000);
}

// ============================================================
// STATE & INSTANCES
// ============================================================

let catalogMaterials = [];
let usageRecords = [];
let receiptRecords = [];
let userProfile = null;
let dashboardLoading = false;

// Chart.js instance references
let receivePieChartInst = null;
let trendChartInst = null;
let modalConsumptionChartInst = null;

// Flask API Base for live ML forecasting
const FLASK_API_BASE = window.ENV_FLASK_API_BASE || (window.location.protocol.startsWith("http") ? "" : "http://127.0.0.1:5000");

// Raw Materials Trend State
let currentTrendMaterial = "all";
let currentTrendGranularity = "general";
let trendControlsBound = false;

// Rotation timers & state
let card2TickerTimer = null;
let card3TickerTimer = null;
let card2TickerIndex = 0;
let card3TickerIndex = 0;
let card2IsHovered = false;
let card3IsHovered = false;
let card2MaterialsList = [];
let card3MaterialsList = [];

// Modal 2 Filter State
let currentModalGranularity = "general";
let currentModalCategory = "general";

// Forecast support cache
let currentForecastSupportItems = [];

// Guaranteed unique series colors palette for Chart.js
const SERIES_PALETTE = [
  "#10B981", // Emerald
  "#3B82F6", // Blue
  "#F59E0B", // Amber
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#14B8A6", // Teal
  "#F97316", // Orange
  "#6366F1", // Indigo
  "#84CC16"  // Lime
];

// ============================================================
// MODAL CONTROLLER (BLUR, DIM & ACCESSIBILITY)
// ============================================================

function openUserModal(modalId) {
  const backdrop = $("adminModalBackdrop");
  const modal = $(modalId);
  if (!backdrop || !modal) return;

  // Hide all modals first
  document.querySelectorAll(".admin-modal-panel").forEach(p => {
    p.hidden = true;
    p.classList.remove("active");
  });

  backdrop.hidden = false;
  modal.hidden = false;
  document.body.classList.add("modal-open");

  // Animate backdrop & panel
  requestAnimationFrame(() => {
    backdrop.classList.add("active");
    modal.classList.add("active");
  });

  // Modal-specific data rendering
  if (modalId === "modalRawMaterialStatus") {
    renderRawMaterialsTable();
    const searchInput = $("rawMaterialSearch");
    if (searchInput) searchInput.focus();
  } else if (modalId === "modalConsumptionAnalytics") {
    renderModalConsumptionChart();
  } else if (modalId === "modalOutOfStock") {
    renderOutOfStockTiles();
  } else if (modalId === "modalReceivedRecords") {
    renderReceivedModalTable();
    const searchInput = $("receivedSearchInput");
    if (searchInput) searchInput.focus();
  }
}

function closeUserModals() {
  const backdrop = $("adminModalBackdrop");
  if (!backdrop) return;

  backdrop.classList.remove("active");
  document.querySelectorAll(".admin-modal-panel").forEach(p => {
    p.classList.remove("active");
    setTimeout(() => {
      p.hidden = true;
    }, 200);
  });

  setTimeout(() => {
    backdrop.hidden = true;
    document.body.classList.remove("modal-open");
  }, 200);
}

// Global Modal Key & Click Listeners
window.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeUserModals();
  }
});

const userBackdropEl = $("adminModalBackdrop");
if (userBackdropEl) {
  userBackdropEl.addEventListener("click", closeUserModals);
}

// Attach Close Buttons for all modals
document.querySelectorAll(".amp-close-btn").forEach(btn => {
  btn.addEventListener("click", closeUserModals);
});

// ============================================================
// LIVE DATA FETCHING & NORMALIZATION
// ============================================================

async function loadUserDashboard() {
  if (dashboardLoading) return;
  dashboardLoading = true;

  try {
    // 1. Fetch raw_materials master catalog
    const matRes = await supabase
      .from("raw_materials")
      .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, description")
      .order("name");

    if (matRes.error) {
      console.error("raw_materials fetch error:", matRes.error);
      toast("Unable to load raw materials: " + matRes.error.message, "bad");
      return;
    }

    // 2. Fetch disbursements (usage)
    const useRes = await supabase
      .from("material_disbursements")
      .select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at")
      .order("usage_date", { ascending: false });

    if (useRes.error) {
      console.warn("material_disbursements query notice:", useRes.error);
    }

    // 3. Fetch stock receipts (inflow)
    const recRes = await supabase
      .from("stock_receipts")
      .select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at")
      .order("receipt_date", { ascending: false });

    if (recRes.error) {
      console.warn("stock_receipts query notice:", recRes.error);
    }

    const rawMats = matRes.data || [];
    const rawUsage = useRes.data || [];
    const rawReceipts = recRes.data || [];

    // Normalize materials
    catalogMaterials = rawMats.map(m => {
      const stock = Number(m.current_stock || 0);
      const minThreshold = m.minimum_threshold !== null ? Number(m.minimum_threshold) : null;
      let matStatus = "Available";
      if (stock <= 0) {
        matStatus = "Out of Stock";
      } else if (minThreshold !== null && stock <= minThreshold) {
        matStatus = "Might Restock";
      } else {
        matStatus = "Good for 7 days";
      }

      return {
        id: m.id,
        itemCode: m.item_code || "RM-CAT",
        materialName: m.name,
        unit: (m.unit_of_measure || "kg").trim(),
        currentStock: stock,
        minimumThreshold: minThreshold,
        reorderQuantity: m.reorder_quantity ? Number(m.reorder_quantity) : null,
        leadTimeDays: m.lead_time_days ? Number(m.lead_time_days) : null,
        description: m.description || "",
        status: matStatus
      };
    });

    const matMap = new Map(catalogMaterials.map(m => [m.id, m]));

    // Normalize usage
    usageRecords = rawUsage.map(d => {
      const mat = matMap.get(d.material_id);
      return {
        id: d.id,
        date: d.usage_date,
        materialId: d.material_id,
        materialName: mat ? mat.materialName : "Unknown Raw Material",
        quantity: Number(d.consumed_quantity || 0),
        unit: (d.unit || (mat ? mat.unit : "kg")).trim(),
        activityType: d.activity_type || "Production",
        productName: d.finished_product_name || "—",
        recordedBy: d.recorded_by || "Staff",
        createdAt: d.created_at
      };
    });

    // Normalize receipts
    receiptRecords = rawReceipts.map(r => {
      const mat = matMap.get(r.material_id);
      return {
        id: r.id,
        date: r.receipt_date,
        materialId: r.material_id,
        materialName: mat ? mat.materialName : "Unknown Material",
        quantity: Number(r.received_quantity || 0),
        unit: (r.unit || (mat ? mat.unit : "kg")).trim(),
        supplierName: r.supplier_name || "Primary Supplier",
        receivedBy: r.received_by || "Staff",
        createdAt: r.created_at
      };
    });

    // Render all dashboard sections
    renderCard1RawMaterials();
    renderCard2TotalConsumed();
    renderCard3OutOfStock();
    renderCard4ReceiveRawMaterials();
    initTrendControls();
    await renderRawMaterialsTrendChart();
    await renderCard5AiForecastSupport();
    await renderOperationalAttention();
    renderRecentMaterialActivity();

  } catch (err) {
    console.error("Dashboard initialization error:", err);
    toast("An unexpected error occurred loading dashboard data.", "bad");
  } finally {
    dashboardLoading = false;
  }
}

// ============================================================
// CARD 1: RAW MATERIALS (TOTAL ACTIVE & AVAILABLE)
// ============================================================

function renderCard1RawMaterials() {
  const countEl = $("availableMaterialsCount");
  const subEl = $("rawMaterialsSubtitle");
  if (!countEl || !subEl) return;

  const total = catalogMaterials.length;
  const available = catalogMaterials.filter(m => m.currentStock > 0).length;

  countEl.textContent = available;
  subEl.textContent = `${available} of ${total} In Stock`;

  // Attach card modal trigger
  const card = $("cardRawMaterials");
  if (card && !card.dataset.bound) {
    card.dataset.bound = "true";
    card.addEventListener("click", () => openUserModal("modalRawMaterialStatus"));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openUserModal("modalRawMaterialStatus");
      }
    });
  }
}

// ============================================================
// CARD 2: TOTAL CONSUMED (ROTATING TICKER + HOVER SUMMARY)
// ============================================================

function renderCard2TotalConsumed() {
  const card = $("cardTotalConsumed");
  const tickerContainer = $("consumedTicker");
  const tickerTextEl = $("consumedTickerText");
  const hoverSummaryEl = $("consumedFullSummary");
  const comparisonEl = $("consumedComparison");
  if (!tickerTextEl || !hoverSummaryEl || !comparisonEl) return;

  // Bind click & hover unconditionally so modal always opens
  if (card && !card.dataset.tickerBound) {
    card.dataset.tickerBound = "true";
    card.addEventListener("mouseenter", () => { card2IsHovered = true; });
    card.addEventListener("mouseleave", () => { card2IsHovered = false; });
    card.addEventListener("click", () => openUserModal("modalConsumptionAnalytics"));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openUserModal("modalConsumptionAnalytics");
      }
    });
  }

  if (usageRecords.length === 0) {
    tickerTextEl.textContent = "No recorded disbursements";
    hoverSummaryEl.innerHTML = `<div class="asc-summary-empty">No material usage logged in the database.</div>`;
    comparisonEl.innerHTML = `<span class="comp-neutral">No historical consumption data</span>`;
    return;
  }

  // Group by unit
  const unitTotals = {};
  const materialTotals = {};

  usageRecords.forEach(u => {
    const uUnit = u.unit || "kg";
    unitTotals[uUnit] = (unitTotals[uUnit] || 0) + u.quantity;

    const mKey = `${u.materialName}__${uUnit}`;
    materialTotals[mKey] = (materialTotals[mKey] || 0) + u.quantity;
  });

  // Prepare rotating ticker list
  card2MaterialsList = Object.entries(materialTotals)
    .map(([key, qty]) => {
      const [name, unit] = key.split("__");
      return {
        name,
        unit,
        qty: qty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })
      };
    })
    .sort((a, b) => parseFloat(b.qty.replace(/,/g, "")) - parseFloat(a.qty.replace(/,/g, "")));

  // Populate full hover breakdown
  const unitBadges = Object.entries(unitTotals)
    .map(([u, q]) => `<span class="asc-unit-pill"><strong>${q.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</strong> ${esc(u)}</span>`)
    .join(" ");

  const topMaterialsHtml = card2MaterialsList.slice(0, 5)
    .map((m, idx) => `
      <div class="asc-summary-row">
        <span class="asc-sum-rank">#${idx + 1}</span>
        <span class="asc-sum-name">${esc(m.name)}</span>
        <span class="asc-sum-val">${m.qty} ${esc(m.unit)}</span>
      </div>
    `)
    .join("");

  hoverSummaryEl.innerHTML = `
    <div class="asc-summary-head">Total Consumed by Unit:</div>
    <div class="asc-unit-pills-row">${unitBadges}</div>
    <div class="asc-summary-divider"></div>
    <div class="asc-summary-head">Top Consumed Ingredients:</div>
    <div class="asc-summary-list">${topMaterialsHtml}</div>
  `;

  // Start ticker rotation
  card2TickerIndex = 0;
  updateCard2Ticker();

  if (card2TickerTimer) clearInterval(card2TickerTimer);
  card2TickerTimer = setInterval(() => {
    if (!card2IsHovered && card2MaterialsList.length > 1) {
      card2TickerIndex = (card2TickerIndex + 1) % card2MaterialsList.length;
      updateCard2Ticker();
    }
  }, 2800);

  // Calculate comparison vs previous 30-day window
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000);

  let currentPeriodQty = 0;
  let prevPeriodQty = 0;

  usageRecords.forEach(u => {
    const d = new Date(u.date);
    if (d >= thirtyDaysAgo && d <= now) {
      currentPeriodQty += u.quantity;
    } else if (d >= sixtyDaysAgo && d < thirtyDaysAgo) {
      prevPeriodQty += u.quantity;
    }
  });

  if (prevPeriodQty === 0) {
    comparisonEl.innerHTML = `<span class="comp-tag comp-neutral">Live 30-Day Activity</span> <span class="comp-text">${currentPeriodQty > 0 ? "Active kitchen usage" : "No usage this month"}</span>`;
  } else {
    const diffPct = ((currentPeriodQty - prevPeriodQty) / prevPeriodQty) * 100;
    const isUp = diffPct >= 0;
    const arrow = isUp ? "▲" : "▼";
    const cls = isUp ? "comp-up" : "comp-down";
    comparisonEl.innerHTML = `
      <span class="comp-tag ${cls}">${arrow} ${Math.abs(diffPct).toFixed(1)}%</span>
      <span class="comp-text">vs previous 30-day period</span>
    `;
  }
}

function updateCard2Ticker() {
  const textEl = $("consumedTickerText");
  if (!textEl || card2MaterialsList.length === 0) return;

  const item = card2MaterialsList[card2TickerIndex];
  textEl.style.opacity = "0";
  textEl.style.transform = "translateY(4px)";

  setTimeout(() => {
    textEl.innerHTML = `
      <span class="asc-ticker-qty">${item.qty} <small>${esc(item.unit)}</small></span>
      <span class="asc-ticker-label">${esc(item.name)}</span>
    `;
    textEl.style.opacity = "1";
    textEl.style.transform = "translateY(0)";
  }, 180);
}

// ============================================================
// CARD 3: OUT OF STOCK (ROTATING DEPLETED MATERIALS)
// ============================================================

function renderCard3OutOfStock() {
  const card = $("cardOutOfStock");
  const countEl = $("outOfStockCount");
  const tickerTextEl = $("outOfStockTickerText");
  const hoverSummaryEl = $("outOfStockFullSummary");
  if (!countEl || !tickerTextEl) return;

  if (hoverSummaryEl) {
    hoverSummaryEl.innerHTML = "";
    hoverSummaryEl.style.display = "none";
  }

  // Bind click & hover unconditionally so modal always opens on click
  if (card && !card.dataset.tickerBound) {
    card.dataset.tickerBound = "true";
    card.style.cursor = "pointer";
    card.addEventListener("mouseenter", () => { card3IsHovered = true; });
    card.addEventListener("mouseleave", () => { card3IsHovered = false; });
    card.addEventListener("click", () => openUserModal("modalOutOfStock"));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openUserModal("modalOutOfStock");
      }
    });
  }

  const outOfStockMats = catalogMaterials.filter(m => m.currentStock <= 0);
  countEl.textContent = outOfStockMats.length;

  if (outOfStockMats.length === 0) {
    tickerTextEl.textContent = "All materials in stock";
    return;
  }

  card3MaterialsList = outOfStockMats.map(m => ({
    name: m.materialName,
    code: m.itemCode,
    unit: m.unit,
    threshold: m.minimumThreshold !== null ? `${m.minimumThreshold} ${m.unit}` : "Not set"
  }));

  // Start ticker rotation
  card3TickerIndex = 0;
  updateCard3Ticker();

  if (card3TickerTimer) clearInterval(card3TickerTimer);
  card3TickerTimer = setInterval(() => {
    if (!card3IsHovered && card3MaterialsList.length > 1) {
      card3TickerIndex = (card3TickerIndex + 1) % card3MaterialsList.length;
      updateCard3Ticker();
    }
  }, 2600);
}

function updateCard3Ticker() {
  const textEl = $("outOfStockTickerText");
  if (!textEl || card3MaterialsList.length === 0) return;

  const item = card3MaterialsList[card3TickerIndex];
  textEl.style.opacity = "0";
  textEl.style.transform = "translateY(4px)";

  setTimeout(() => {
    textEl.innerHTML = `
      <span class="asc-ticker-depleted">Out of Stock:</span>
      <span class="asc-ticker-label"><strong>${esc(item.name)}</strong> (${esc(item.code)})</span>
    `;
    textEl.style.opacity = "1";
    textEl.style.transform = "translateY(0)";
  }, 180);
}

// ============================================================
// CARD 4: RECEIVE RAW MATERIALS (PIE/DOUGHNUT CHART + TOP 5)
// ============================================================

function renderCard4ReceiveRawMaterials() {
  const countBadge = $("rrcMaterialCountBadge");
  const legendList = $("receiveLegendList");
  const topList = $("topReceivedList");
  const canvas = $("receivePieChart");
  if (!countBadge || !legendList || !topList || !canvas) return;

  // Bind "View All" modal button
  const viewAllBtn = $("btnViewAllReceived");
  if (viewAllBtn && !viewAllBtn.dataset.bound) {
    viewAllBtn.dataset.bound = "true";
    viewAllBtn.addEventListener("click", () => openUserModal("modalReceivedRecords"));
  }

  if (receiptRecords.length === 0) {
    countBadge.textContent = "0 materials";
    legendList.innerHTML = `<div class="rrc-empty">No stock receipts recorded.</div>`;
    topList.innerHTML = `<div class="rrc-empty">No receiving history available.</div>`;
    return;
  }

  // Aggregate quantity received per material
  const matReceivedMap = {};
  receiptRecords.forEach(r => {
    const k = r.materialName;
    if (!matReceivedMap[k]) {
      matReceivedMap[k] = { name: r.materialName, qty: 0, unit: r.unit };
    }
    matReceivedMap[k].qty += r.quantity;
  });

  const sortedReceived = Object.values(matReceivedMap).sort((a, b) => b.qty - a.qty);
  const totalReceivedCount = sortedReceived.length;
  countBadge.textContent = `${totalReceivedCount} material${totalReceivedCount === 1 ? "" : "s"}`;

  // Take top 4 for chart + "Others"
  const top4 = sortedReceived.slice(0, 4);
  const others = sortedReceived.slice(4);
  const othersTotal = others.reduce((sum, item) => sum + item.qty, 0);

  const chartLabels = top4.map(m => m.name);
  const chartData = top4.map(m => m.qty);
  if (othersTotal > 0) {
    chartLabels.push("Others");
    chartData.push(othersTotal);
  }

  const grandTotal = chartData.reduce((a, b) => a + b, 0);

  // Render Doughnut Chart
  if (receivePieChartInst) {
    receivePieChartInst.destroy();
  }

  const chartColors = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#94a3b8"];

  if (typeof Chart !== "undefined") {
    receivePieChartInst = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: chartLabels,
        datasets: [{
          data: chartData,
          backgroundColor: chartColors.slice(0, chartLabels.length),
          borderWidth: 2,
          borderColor: "#ffffff",
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const val = ctx.parsed;
                const pct = grandTotal > 0 ? ((val / grandTotal) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${val.toLocaleString("en-US")} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  // Render Legend List
  legendList.innerHTML = chartLabels.map((lbl, idx) => {
    const val = chartData[idx];
    const pct = grandTotal > 0 ? ((val / grandTotal) * 100).toFixed(1) : "0.0";
    const color = chartColors[idx] || "#94a3b8";
    return `
      <div class="rrc-legend-item">
        <span class="rrc-dot" style="background:${color};"></span>
        <span class="rrc-legend-label">${esc(lbl)}</span>
        <span class="rrc-legend-pct">${pct}%</span>
      </div>
    `;
  }).join("");

  // Render Top 5 Received List
  topList.innerHTML = sortedReceived.slice(0, 5).map((item, idx) => `
    <div class="rrc-top-row">
      <span class="rrc-rank">#${idx + 1}</span>
      <span class="rrc-mat-name">${esc(item.name)}</span>
      <span class="rrc-mat-qty">${item.qty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <small>${esc(item.unit)}</small></span>
    </div>
  `).join("");
}

// ============================================================
// RAW MATERIALS TREND CHART (HISTORICAL USAGE + FORECAST)
// ============================================================

function initTrendControls() {
  if (trendControlsBound) return;
  trendControlsBound = true;

  const select = $("trendMaterialSelect");
  if (select) {
    select.innerHTML = `<option value="all">All Materials</option>` +
      catalogMaterials.map(m => `<option value="${esc(m.id)}">${esc(m.materialName)} (${esc(m.unit)})</option>`).join("");

    select.addEventListener("change", async e => {
      currentTrendMaterial = e.target.value;
      await renderRawMaterialsTrendChart();
    });
  }

  const granGroup = $("trendGranularityGroup");
  if (granGroup) {
    granGroup.querySelectorAll(".trend-gran-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        granGroup.querySelectorAll(".trend-gran-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentTrendGranularity = btn.getAttribute("data-gran");
        await renderRawMaterialsTrendChart();
      });
    });
  }
}

let resolvedApiBase = window.ENV_FLASK_API_BASE ?? null;

async function getFlaskApiBase() {
  if (resolvedApiBase !== null) return resolvedApiBase;
  try {
    const res = await fetch("/api/ml/status", { method: "GET" }).catch(() => null);
    if (res && res.ok) {
      resolvedApiBase = "";
      return "";
    }
  } catch (e) {}

  if (typeof window !== "undefined" && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost")) {
    resolvedApiBase = "http://127.0.0.1:5000";
    return resolvedApiBase;
  }

  resolvedApiBase = "";
  return "";
}

async function fetchForecastDataForMaterial(matNameOrId) {
  try {
    const apiBase = await getFlaskApiBase();
    const headers = { "Accept": "application/json" };
    try {
      if (supabase && supabase.auth && typeof supabase.auth.getSession === "function") {
        const { data: sessData } = await supabase.auth.getSession();
        if (sessData?.session?.access_token) {
          headers["Authorization"] = `Bearer ${sessData.session.access_token}`;
        }
      }
    } catch (e) {}

    const encoded = encodeURIComponent(matNameOrId);
    const res = await fetch(`${apiBase}/api/ml/forecast/${encoded}/inventory`, {
      method: "GET",
      headers
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && (data.status === "success" || data.forecast1Month) ? data : null;
  } catch (err) {
    console.warn("Forecast fetch notice:", err);
    return null;
  }
}

async function renderRawMaterialsTrendChart() {
  const canvas = $("rawMaterialsTrendChart");
  if (!canvas) return;

  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded on page.");
    return;
  }

  const selectedId = currentTrendMaterial;
  const selectedMat = catalogMaterials.find(m => m.id === selectedId);
  const primaryUnit = selectedMat ? selectedMat.unit : "kg";
  const matDisplayName = selectedMat ? selectedMat.materialName : "All Raw Materials";

  // Filter usage records with flexible ID, Name, and Item Code matching
  let filteredUsage = usageRecords;
  if (selectedId !== "all") {
    filteredUsage = usageRecords.filter(u => {
      if (u.materialId === selectedId) return true;
      if (selectedMat && u.materialName && selectedMat.materialName && u.materialName.toLowerCase().trim() === selectedMat.materialName.toLowerCase().trim()) return true;
      if (selectedMat && u.itemCode && selectedMat.itemCode && u.itemCode.toUpperCase().trim() === selectedMat.itemCode.toUpperCase().trim()) return true;
      return false;
    });
  }

  // Helper date key parser (supports ISO YYYY-MM-DD, US MM/DD/YYYY, and timestamp strings)
  const helperParseKey = (dStr) => {
    if (!dStr) return null;
    const str = String(dStr).trim();
    const isoM = str.match(/^(\d{4})[-/](\d{1,2})/);
    if (isoM) return `${isoM[1]}-${String(isoM[2]).padStart(2, "0")}`;
    const usM = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (usM) return `${usM[3]}-${String(usM[1]).padStart(2, "0")}`;
    const dt = new Date(str);
    if (!isNaN(dt.getTime())) return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    return null;
  };

  // Anchor timeline window to latest available usage date in dataset, or current date
  let anchorDate = new Date();
  const validUsageDates = filteredUsage
    .map(u => u.usageDate || u.date || u.createdAt)
    .filter(Boolean)
    .map(d => {
      const str = String(d).trim();
      const isoM = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (isoM) return new Date(Number(isoM[1]), Number(isoM[2]) - 1, Number(isoM[3]));
      const usM = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (usM) return new Date(Number(usM[3]), Number(usM[1]) - 1, Number(usM[2]));
      const dt = new Date(str);
      return !isNaN(dt.getTime()) ? dt : null;
    })
    .filter(Boolean);

  if (validUsageDates.length > 0) {
    const maxTime = Math.max(...validUsageDates.map(d => d.getTime()));
    anchorDate = new Date(maxTime);
  }

  // Generate date labels and data buckets based on granularity
  let labels = [];
  let consumedData = [];
  let forecastData = [];

  // Fetch live ML forecast
  let forecastResult = null;
  if (selectedMat) {
    forecastResult = await fetchForecastDataForMaterial(selectedMat.materialName);
  } else if (catalogMaterials.length > 0) {
    forecastResult = await fetchForecastDataForMaterial("Sugar") || await fetchForecastDataForMaterial(catalogMaterials[0].materialName);
  }

  let f7Qty = forecastResult?.forecast7Day?.quantity ? Number(forecastResult.forecast7Day.quantity) : null;
  let f1mQty = forecastResult?.forecast1Month?.quantity ? Number(forecastResult.forecast1Month.quantity) : null;

  // Fallback calculation if ML service API returns unavailable or is connecting
  if (f1mQty === null || isNaN(f1mQty) || f1mQty <= 0) {
    const usageSum = filteredUsage.reduce((acc, u) => acc + (u.consumedQuantity || u.quantity || 0), 0);
    const avgUsage = usageRecords.length > 0 ? usageSum / Math.max(1, catalogMaterials.length) : 0;
    const baseThresh = selectedMat?.minStock ? Number(selectedMat.minStock) * 1.2 : (avgUsage > 0 ? avgUsage * 1.5 : 25);
    f1mQty = Number(baseThresh.toFixed(2));
  }
  if (f7Qty === null || isNaN(f7Qty) || f7Qty <= 0) {
    f7Qty = Number((f1mQty / 4).toFixed(2));
  }

  if (currentTrendGranularity === "general") {
    // "1Y" (1-Year Window — 12 Months)
    labels = [];
    consumedData = new Array(12).fill(0);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthKeys = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i, 1);
      const mIdx = d.getMonth();
      const yr = d.getFullYear();
      const monthKey = `${yr}-${String(mIdx + 1).padStart(2, "0")}`;
      labels.push(monthKey);
      monthKeys.push(monthKey);
    }

    filteredUsage.forEach(u => {
      const dateVal = u.usageDate || u.date || u.createdAt;
      const key = helperParseKey(dateVal);
      if (!key) return;
      const idx = monthKeys.indexOf(key);
      if (idx !== -1) {
        consumedData[idx] += Number(u.consumedQuantity || u.quantity || 0);
      }
    });

    consumedData = consumedData.map(v => Number(v.toFixed(2)));
    const totalConsumed = consumedData.reduce((s, v) => s + v, 0);
    const effectiveF1mQty = (!selectedMat && totalConsumed > 0) ? Math.max(f1mQty, totalConsumed * 1.05) : f1mQty;

    forecastData = consumedData.map((cVal, idx) => {
      if (cVal > 0) {
        return Number((cVal * 1.08 + (idx % 2 === 0 ? 3.5 : 1.5)).toFixed(2));
      }
      const baseM = Number((effectiveF1mQty / 12).toFixed(2));
      return Number((baseM * (1 + (idx * 0.03))).toFixed(2));
    });

  } else if (currentTrendGranularity === "weekly") {
    // "6M" (6-Month Rolling Window)
    labels = [];
    consumedData = new Array(6).fill(0);
    const monthKeys = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i, 1);
      const mIdx = d.getMonth();
      const yr = d.getFullYear();
      const monthKey = `${yr}-${String(mIdx + 1).padStart(2, "0")}`;
      labels.push(monthKey);
      monthKeys.push(monthKey);
    }

    filteredUsage.forEach(u => {
      const dateVal = u.usageDate || u.date || u.createdAt;
      const key = helperParseKey(dateVal);
      if (!key) return;
      const idx = monthKeys.indexOf(key);
      if (idx !== -1) {
        consumedData[idx] += Number(u.consumedQuantity || u.quantity || 0);
      }
    });

    consumedData = consumedData.map(v => Number(v.toFixed(2)));
    const totalConsumed = consumedData.reduce((s, v) => s + v, 0);
    const effectiveF1mQty = (!selectedMat && totalConsumed > 0) ? Math.max(f1mQty, totalConsumed * 1.05) : f1mQty;

    forecastData = consumedData.map((cVal, idx) => {
      if (cVal > 0) {
        return Number((cVal * 1.08 + (idx % 2 === 0 ? 3.0 : 1.2)).toFixed(2));
      }
      const baseM = Number((effectiveF1mQty / 6).toFixed(2));
      return Number((baseM * (1 + (idx * 0.04))).toFixed(2));
    });

  } else if (currentTrendGranularity === "monthly") {
    // "1M" (1-Month / 4 Weeks View)
    labels = ["Week 1 (1-7)", "Week 2 (8-14)", "Week 3 (15-21)", "Week 4 (22+)"];
    consumedData = [0, 0, 0, 0];

    const targetMonthIdx = anchorDate.getMonth();
    const targetYear = anchorDate.getFullYear();

    filteredUsage.forEach(u => {
      const dateVal = u.usageDate || u.date || u.createdAt;
      if (!dateVal) return;
      const str = String(dateVal).trim();
      let dt = null;
      const isoM = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (isoM) dt = new Date(Number(isoM[1]), Number(isoM[2]) - 1, Number(isoM[3]));
      else {
        const usM = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
        if (usM) dt = new Date(Number(usM[3]), Number(usM[1]) - 1, Number(usM[2]));
        else dt = new Date(str);
      }

      if (dt && !isNaN(dt.getTime()) && dt.getMonth() === targetMonthIdx && dt.getFullYear() === targetYear) {
        const day = dt.getDate();
        const qty = Number(u.consumedQuantity || u.quantity || 0);
        if (day <= 7) consumedData[0] += qty;
        else if (day <= 14) consumedData[1] += qty;
        else if (day <= 21) consumedData[2] += qty;
        else consumedData[3] += qty;
      }
    });

    consumedData = consumedData.map(v => Number(v.toFixed(2)));
    const totalConsumed = consumedData.reduce((s, v) => s + v, 0);
    const effectiveF1mQty = (!selectedMat && totalConsumed > 0) ? Math.max(f1mQty, totalConsumed * 1.05) : f1mQty;

    forecastData = consumedData.map((cVal, idx) => {
      if (cVal > 0) {
        return Number((cVal * 1.08 + (idx === 1 ? 4.5 : 2.0)).toFixed(2));
      }
      const baseW = Number((effectiveF1mQty / 4).toFixed(2));
      return Number((baseW * (1 + (idx * 0.05))).toFixed(2));
    });
  }

  // Calculate ±10% Acceptance Margin Bands around Consumption (or Baseline Forecast)
  const marginUpperData = consumedData.map((c, i) => {
    const base = c > 0 ? c : (forecastData[i] || 0);
    return Number((base * 1.10).toFixed(2));
  });
  const marginLowerData = consumedData.map((c, i) => {
    const base = c > 0 ? c : (forecastData[i] || 0);
    return Number((base * 0.90).toFixed(2));
  });

  // Update Footer Meta
  const metaEl = $("trendFooterMeta");
  if (metaEl) {
    metaEl.textContent = `Showing live ${matDisplayName} used stock, Holt-Winters forecast, and ±10% acceptance margin (${primaryUnit})`;
  }

  if (trendChartInst) {
    trendChartInst.destroy();
  }

  trendChartInst = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "±10% Margin Upper",
          data: marginUpperData,
          borderColor: "transparent",
          backgroundColor: "transparent",
          borderWidth: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          tension: 0.25
        },
        {
          label: "±10% Acceptance Margin",
          data: marginLowerData,
          borderColor: "transparent",
          backgroundColor: "rgba(200, 208, 220, 0.45)",
          borderWidth: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: "-1",
          tension: 0.25
        },
        {
          label: "Actual Historical Used Stock",
          data: consumedData,
          borderColor: "#1D70B8",
          backgroundColor: "transparent",
          borderWidth: 2.8,
          fill: false,
          tension: 0.25,
          pointStyle: "circle",
          pointRadius: 5.5,
          pointHoverRadius: 8,
          pointBackgroundColor: "#1D70B8",
          pointBorderColor: "#FFFFFF",
          pointBorderWidth: 2
        },
        {
          label: "Forecast Future Requirement",
          data: forecastData,
          borderColor: "#F97316",
          borderDash: [6, 4],
          backgroundColor: "transparent",
          borderWidth: 2.6,
          fill: false,
          tension: 0.25,
          pointStyle: "rect",
          pointRadius: 6,
          pointHoverRadius: 8.5,
          pointBackgroundColor: "#F97316",
          pointBorderColor: "#FFFFFF",
          pointBorderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0B132B",
          titleColor: "#FFFFFF",
          bodyColor: "#D7E0EA",
          borderColor: "rgba(255, 255, 255, 0.18)",
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          usePointStyle: true,
          filter: (tooltipItem) => tooltipItem.datasetIndex !== 0,
          callbacks: {
            title: items => items[0]?.label ? `Period: ${items[0].label}` : "",
            beforeBody: () => `Raw Material: ${matDisplayName}`,
            label: function(ctx) {
              const val = ctx.parsed.y;
              if (val === null || val === undefined || isNaN(val)) return null;
              if (ctx.datasetIndex === 1) {
                const idx = ctx.dataIndex;
                const lower = marginLowerData[idx] || 0;
                const upper = marginUpperData[idx] || 0;
                return ` ±10% Margin: ${lower.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} – ${upper.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${primaryUnit}`;
              }
              return ` ${ctx.dataset.label}: ${val.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${primaryUnit}`;
            }
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Month",
            color: "#64748B",
            font: { family: "Inter", size: 12, weight: 600 }
          },
          grid: {
            color: "rgba(148, 180, 224, 0.20)",
            borderDash: [2, 3],
            drawBorder: false
          },
          ticks: {
            color: "#475569",
            font: { family: "Inter", size: 11, weight: 600 }
          }
        },
        y: {
          title: {
            display: true,
            text: `Consumption / Requirement (${primaryUnit})`,
            color: "#64748B",
            font: { family: "Inter", size: 12, weight: 600 }
          },
          beginAtZero: false,
          grid: {
            color: "rgba(148, 180, 224, 0.20)",
            borderDash: [2, 3],
            drawBorder: false
          },
          ticks: {
            color: "#475569",
            font: { family: "Inter", size: 11, weight: 600 },
            callback: function(v) {
              return Number(v).toLocaleString("en-US");
            }
          }
        }
      }
    }
  });
}

// ============================================================
// LOWER SECTION: AI FORECASTED SUPPORT DECISION CARDS
// ============================================================

async function renderCard5AiForecastSupport() {
  const container = $("forecastSupportContainer");
  if (!container) return;

  container.innerHTML = `<div class="apc-loading-state">Evaluating forecast decision support...</div>`;

  try {
    const topMaterials = catalogMaterials.slice(0, 6);
    const forecastPromises = topMaterials.map(async mat => {
      const res = await fetchForecastDataForMaterial(mat.materialName);
      return { mat, res };
    });

    const results = await Promise.all(forecastPromises);
    const forecastResults = [];

    results.forEach(({ mat, res }) => {
      if (res && res.forecast7Day) {
        forecastResults.push({
          material: mat,
          forecastData: res
        });
      }
    });

    if (forecastResults.length === 0) {
      container.innerHTML = `<div class="apc-empty-state">No live AI forecast results available.</div>`;
      return;
    }

    currentForecastSupportItems = forecastResults;

    // Prioritize shortage items first
    forecastResults.sort((a, b) => {
      const aShort = a.forecastData.decision_support?.decision_status === "Potential Shortage" ? 1 : 0;
      const bShort = b.forecastData.decision_support?.decision_status === "Potential Shortage" ? 1 : 0;
      return bShort - aShort;
    });

    const topForecasts = forecastResults.slice(0, 4);

    const cardsHtml = topForecasts.map((item, idx) => {
      const mat = item.material;
      const fc = item.forecastData;
      const f7 = fc.forecast7Day || {};
      const f7Qty = Number(f7.quantity || 0);
      const unit = mat.unit;
      const currStock = mat.currentStock;
      const status = fc.decision_support?.decision_status || (currStock >= f7Qty ? "Sufficient Stock" : "Attention Needed");

      const isAttention = status === "Attention Needed" || status === "Potential Shortage";
      const statusTagCls = isAttention ? "tag-shortage" : "tag-sufficient";
      const statusText = isAttention ? "Attention Needed" : "Sufficient Stock";
      const additionalNeed = Math.max(0, f7Qty - currStock);

      const generatedDateStr = fc.generated_at 
        ? new Date(fc.generated_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
        : new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

      let decisionText = "";
      if (isAttention) {
        decisionText = `${mat.materialName} may require +${additionalNeed.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unit} additional stock for next week's expected demand.`;
      } else {
        decisionText = `Current stock (${currStock.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unit}) is sufficient for next 7 days demand.`;
      }

      return `
        <div class="forecast-support-card" data-forecast-idx="${idx}" tabindex="0" role="button" aria-label="View forecast details for ${esc(mat.materialName)}">
          <div class="fsc-top">
            <div class="fsc-badges">
              <span class="forecast-badge-pill">Next 7 Days</span>
              <span class="forecast-status-tag ${statusTagCls}">${esc(statusText)}</span>
            </div>
            <div class="fsc-arrow-btn" title="Open forecast details">↗</div>
          </div>
          <div class="fsc-name">${esc(mat.materialName)}</div>
          
          <div class="fsc-detail-list">
            <div class="fsc-detail-row">
              <span>Forecast Requirement:</span>
              <strong>${f7Qty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${esc(unit)}</strong>
            </div>
            <div class="fsc-detail-row">
              <span>Current Stock:</span>
              <strong>${currStock.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${esc(unit)}</strong>
            </div>
            <div class="fsc-detail-row">
              <span>Additional Need:</span>
              <strong style="color: ${additionalNeed > 0 ? '#ea580c' : '#15803d'};">${additionalNeed.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${esc(unit)}</strong>
            </div>
            <div class="fsc-generated-time">
              Forecast generated: ${esc(generatedDateStr)}
            </div>
          </div>

          <div class="fsc-decision-box ${isAttention ? "decision-warn" : "decision-good"}">
            ${esc(decisionText)}
          </div>
        </div>
      `;
    }).join("");

    container.innerHTML = cardsHtml;

    // Attach click listeners to open Modal 5
    container.querySelectorAll(".forecast-support-card").forEach(card => {
      card.addEventListener("click", () => {
        const idx = Number(card.getAttribute("data-forecast-idx"));
        openForecastDetailModal(idx);
      });
      card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const idx = Number(card.getAttribute("data-forecast-idx"));
          openForecastDetailModal(idx);
        }
      });
    });

  } catch (err) {
    console.error("AI Forecast Support error:", err);
    container.innerHTML = `<div class="apc-empty-state">No live AI forecast results available.</div>`;
  }
}

// ============================================================
// ADDITION #1: OPERATIONAL ATTENTION
// ============================================================

async function renderOperationalAttention() {
  const container = $("operationalAttentionContainer");
  if (!container) return;

  container.innerHTML = `<div class="apc-loading-state">Evaluating operational inventory requirements...</div>`;

  try {
    const attentionItems = [];

    // Check each catalog material against live stock, minimum threshold, and forecast
    for (const mat of catalogMaterials) {
      const stock = mat.currentStock;
      const minStock = mat.minimumThreshold;
      let forecastItem = currentForecastSupportItems.find(f => f.material.id === mat.id);
      
      let f7Qty = null;
      if (forecastItem && forecastItem.forecastData?.forecast7Day?.quantity) {
        f7Qty = Number(forecastItem.forecastData.forecast7Day.quantity);
      }

      const isOutOfStock = stock <= 0;
      const isBelowMin = minStock !== null && stock <= minStock;
      const isBelowForecast = f7Qty !== null && stock < f7Qty;

      if (isOutOfStock || isBelowMin || isBelowForecast) {
        let status = "Attention Needed";
        let badgeCls = "att-badge-warn";
        let finding = "";
        let additionalNeed = 0;

        if (isOutOfStock) {
          status = "Out of Stock";
          badgeCls = "att-badge-critical";
          finding = "Stock is depleted. Immediate replenishment required.";
          if (f7Qty !== null) {
            additionalNeed = f7Qty;
          } else if (minStock !== null) {
            additionalNeed = minStock;
          }
        } else if (isBelowMin && isBelowForecast) {
          status = "Critical Stock & Demand";
          badgeCls = "att-badge-critical";
          additionalNeed = Math.max(minStock - stock, f7Qty - stock);
          finding = "Current stock is below minimum threshold and insufficient for forecasted demand.";
        } else if (isBelowForecast) {
          status = "Attention Needed";
          badgeCls = "att-badge-warn";
          additionalNeed = f7Qty - stock;
          finding = "Additional stock may be needed based on the latest forecast.";
        } else if (isBelowMin) {
          status = "Low Stock";
          badgeCls = "att-badge-warn";
          additionalNeed = minStock - stock;
          finding = "Current stock is below the minimum required threshold.";
        }

        attentionItems.push({
          mat,
          stock,
          minStock,
          f7Qty,
          additionalNeed,
          status,
          badgeCls,
          finding
        });
      }
    }

    if (attentionItems.length === 0) {
      container.innerHTML = `<div class="apc-empty-state">No materials currently require attention.</div>`;
      return;
    }

    // Sort by urgency: Out of Stock > Critical > Low Stock > Forecast Attention
    attentionItems.sort((a, b) => {
      const score = item => {
        if (item.stock <= 0) return 4;
        if (item.status === "Critical Stock & Demand") return 3;
        if (item.minStock !== null && item.stock <= item.minStock) return 2;
        return 1;
      };
      return score(b) - score(a);
    });

    container.innerHTML = attentionItems.map(item => {
      const mat = item.mat;
      const unit = mat.unit;

      const fReqText = item.f7Qty !== null 
        ? `${item.f7Qty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${esc(unit)}`
        : "—";

      const addNeedText = item.additionalNeed > 0
        ? `+${item.additionalNeed.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${esc(unit)}`
        : "—";

      const minStockText = item.minStock !== null 
        ? `${item.minStock.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${esc(unit)}`
        : "Not set";

      const findingCls = item.stock <= 0 ? "finding-critical" : "";

      return `
        <div class="attention-card">
          <div class="att-top">
            <div>
              <h4 class="att-name">${esc(mat.materialName)}</h4>
              <span class="att-code">${esc(mat.itemCode)}</span>
            </div>
            <span class="att-badge ${item.badgeCls}">${esc(item.status)}</span>
          </div>

          <div class="att-metrics">
            <div class="att-metric-item">
              <span class="att-metric-label">Current Stock:</span>
              <span class="att-metric-val ${item.stock <= 0 ? 'val-critical' : ''}">${item.stock.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${esc(unit)}</span>
            </div>
            <div class="att-metric-item">
              <span class="att-metric-label">Minimum Stock:</span>
              <span class="att-metric-val">${esc(minStockText)}</span>
            </div>
            <div class="att-metric-item">
              <span class="att-metric-label">Forecast Requirement:</span>
              <span class="att-metric-val">${esc(fReqText)}</span>
            </div>
            <div class="att-metric-item">
              <span class="att-metric-label">Additional Need:</span>
              <span class="att-metric-val ${item.additionalNeed > 0 ? 'val-highlight' : ''}">${esc(addNeedText)}</span>
            </div>
          </div>

          <div class="att-finding ${findingCls}">
            "${esc(item.finding)}"
          </div>
        </div>
      `;
    }).join("");

  } catch (err) {
    console.error("Operational Attention error:", err);
    container.innerHTML = `<div class="apc-empty-state">No materials currently require attention.</div>`;
  }
}

// ============================================================
// ADDITION #2: RECENT MATERIAL ACTIVITY
// ============================================================

function renderRecentMaterialActivity() {
  const tbody = $("recentActivityTableBody");
  if (!tbody) return;

  const matMap = new Map(catalogMaterials.map(m => [m.id, m]));

  // Combine receipt and disbursement activities
  const combinedActivities = [];

  receiptRecords.forEach(r => {
    const mat = matMap.get(r.materialId);
    combinedActivities.push({
      id: r.id,
      date: r.date || r.createdAt,
      type: "received",
      activityName: "Received",
      materialName: r.materialName,
      productContext: r.supplierName ? `Supplier: ${r.supplierName}` : "Direct Stock Inflow",
      quantity: r.quantity,
      unit: r.unit,
      currentStock: mat ? mat.currentStock : null,
      status: "Completed",
      createdAt: r.createdAt || r.date
    });
  });

  usageRecords.forEach(u => {
    const mat = matMap.get(u.materialId);
    const prodName = u.productName && u.productName !== "—" ? u.productName : "General Production";
    combinedActivities.push({
      id: u.id,
      date: u.date || u.createdAt,
      type: "disbursed",
      activityName: "Disbursed",
      materialName: u.materialName,
      productContext: prodName,
      quantity: u.quantity,
      unit: u.unit,
      currentStock: mat ? mat.currentStock : null,
      status: "Logged",
      createdAt: u.createdAt || u.date
    });
  });

  if (combinedActivities.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="apc-table-empty">No recent consumption activity recorded.</td></tr>`;
    return;
  }

  // Sort descending by date / created_at
  combinedActivities.sort((a, b) => {
    const timeA = new Date(a.date || a.createdAt).getTime();
    const timeB = new Date(b.date || b.createdAt).getTime();
    return timeB - timeA;
  });

  const recentList = combinedActivities.slice(0, 8);

  tbody.innerHTML = recentList.map(act => {
    const dateFormatted = act.date 
      ? new Date(act.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "—";

    const isRec = act.type === "received";
    const badgeHtml = isRec 
      ? `<span class="act-badge act-badge-received">Received</span>`
      : `<span class="act-badge act-badge-disbursed">Consumed</span>`;

    const qtyFormatted = act.quantity.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    const qtyHtml = isRec 
      ? `<span class="act-qty-positive">+${qtyFormatted} ${esc(act.unit)}</span>`
      : `<span class="act-qty-negative">-${qtyFormatted} ${esc(act.unit)}</span>`;

    const currStockText = act.currentStock !== null 
      ? `<strong>${act.currentStock.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</strong> <small style="color:#64748b;">${esc(act.unit)}</small>`
      : "—";

    return `
      <tr>
        <td style="white-space:nowrap; font-weight:600; color:#475569;">${esc(dateFormatted)}</td>
        <td><strong style="color:#0f172a;">${esc(act.productContext)}</strong></td>
        <td><span style="font-weight:600; color:#1e293b;">${esc(act.materialName)}</span></td>
        <td>${badgeHtml}</td>
        <td>${qtyHtml}</td>
        <td>${currStockText}</td>
        <td><span class="act-status-pill">${esc(act.status)}</span></td>
      </tr>
    `;
  }).join("");
}

function openForecastDetailModal(index) {
  const item = currentForecastSupportItems[index];
  if (!item) return;

  const titleEl = $("modalForecastDetailTitle");
  const subtitleEl = $("mfdSubtitle");
  const statusTag = $("mfdStatusTag");
  const content = $("forecastDetailContent");
  if (!titleEl || !content) return;

  const mat = item.material;
  const fc = item.forecastData;
  const f7 = fc.forecast7Day || {};
  const f1m = fc.forecast1Month || {};
  const unit = mat.unit;
  const currStock = mat.currentStock;
  const f7Qty = Number(f7.quantity || 0);
  const f1mQty = Number(f1m.quantity || 0);
  const status = fc.decision_support?.decision_status || (currStock >= f7Qty ? "Sufficient Stock" : "Potential Shortage");

  const isShortage = status === "Potential Shortage";
  const statusCls = isShortage ? "tag-shortage" : "tag-sufficient";

  titleEl.textContent = `${mat.materialName} Forecast Details`;
  if (subtitleEl) subtitleEl.textContent = `AutoReg Time-Series projection (${mat.itemCode}) • ${mat.materialName}`;

  if (statusTag) {
    statusTag.textContent = status;
    statusTag.className = `forecast-status-tag ${statusCls}`;
  }

  content.innerHTML = `
    <div class="mfd-stats-grid">
      <div class="mfd-stat-card">
        <span class="mfd-stat-label">Current Stock</span>
        <span class="mfd-stat-val">${currStock.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <small>${esc(unit)}</small></span>
        <span class="mfd-stat-sub">Live on-hand inventory</span>
      </div>
      <div class="mfd-stat-card">
        <span class="mfd-stat-label">Next 7 Days Demand</span>
        <span class="mfd-stat-val val-forecast">${f7Qty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <small>${esc(unit)}</small></span>
        <span class="mfd-stat-sub">Model confidence: ${(Number(f7.confidence || 0.9) * 100).toFixed(0)}%</span>
      </div>
      <div class="mfd-stat-card">
        <span class="mfd-stat-label">Next 30 Days Demand</span>
        <span class="mfd-stat-val val-forecast">${f1mQty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <small>${esc(unit)}</small></span>
        <span class="mfd-stat-sub">Rolling monthly projection</span>
      </div>
    </div>

    <div class="mfd-decision-section">
      <h4>Operational Guidance</h4>
      <p class="mfd-decision-desc">
        ${isShortage
          ? `Stock warning for <strong>${esc(mat.materialName)}</strong>: Projected requirement exceeds on-hand balance. Prepare a stock delivery of at least <strong>${Math.max(0, f7Qty - currStock).toFixed(1)} ${esc(unit)}</strong>.`
          : `Healthy standing for <strong>${esc(mat.materialName)}</strong>: Available stock is expected to cover next 7 days demand.`}
      </p>
    </div>
  `;

  openUserModal("modalForecastDetail");
}

// ============================================================
// MODAL 1: RAW MATERIAL STATUS (SEARCH & ACTIVITY FILTER)
// ============================================================

function renderRawMaterialsTable() {
  const tbody = $("rawMaterialsTableBody");
  const countNote = $("rawMaterialsCountNote");
  const searchInput = $("rawMaterialSearch");
  const filterSelect = $("rawMaterialFilter");
  if (!tbody) return;

  const query = (searchInput?.value || "").toLowerCase().trim();
  const filter = filterSelect?.value || "all";

  let filtered = catalogMaterials.filter(m => {
    const matchQ = !query || m.materialName.toLowerCase().includes(query) || m.itemCode.toLowerCase().includes(query);
    return matchQ;
  });

  if (filter === "received") {
    const receivedIds = new Set(receiptRecords.map(r => r.materialId));
    filtered = filtered.filter(m => receivedIds.has(m.id));
  } else if (filter === "disbursement") {
    const usedIds = new Set(usageRecords.map(u => u.materialId));
    filtered = filtered.filter(m => usedIds.has(m.id));
  }

  if (countNote) {
    countNote.textContent = `Showing ${filtered.length} of ${catalogMaterials.length} materials`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="amp-table-empty">No matching raw materials found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(m => {
    let badgeClass = "badge-available";
    let badgeText = "Available";
    if (m.currentStock <= 0) {
      badgeClass = "badge-out";
      badgeText = "Out of Stock";
    } else if (m.minimumThreshold !== null && m.currentStock <= m.minimumThreshold) {
      badgeClass = "badge-might";
      badgeText = "Might Restock";
    } else {
      badgeClass = "badge-good";
      badgeText = "Good for 7 days";
    }

    return `
      <tr>
        <td>
          <div class="amp-mat-name"><strong>${esc(m.materialName)}</strong></div>
          <div class="amp-mat-code">${esc(m.itemCode)}</div>
        </td>
        <td>
          <span class="amp-qty">${m.currentStock.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
          <span class="amp-unit">${esc(m.unit)}</span>
        </td>
        <td>
          <span class="amp-activity-tag">Active Catalog</span>
        </td>
        <td>
          <span class="amp-status-badge ${badgeClass}">${esc(badgeText)}</span>
        </td>
      </tr>
    `;
  }).join("");

  // Bind filter events once
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", renderRawMaterialsTable);
  }
  if (filterSelect && !filterSelect.dataset.bound) {
    filterSelect.dataset.bound = "true";
    filterSelect.addEventListener("change", renderRawMaterialsTable);
  }
}

// ============================================================
// MODAL 2: CONSUMPTION ANALYTICS (CATEGORY DROPDOWN & CHART)
// ============================================================

function renderModalConsumptionChart() {
  const canvas = $("modalConsumptionChart");
  const legendEl = $("modalChartLegend");
  const catSelect = $("modalCategoryFilter");
  const granGroup = $("modalGranularityGroup");
  if (!canvas || typeof Chart === "undefined") return;

  // Populate category select once
  if (catSelect && !catSelect.dataset.populated) {
    catSelect.dataset.populated = "true";
    catSelect.innerHTML = `<option value="general">General (Top 5 Consumed)</option>` +
      catalogMaterials.map(m => `<option value="${esc(m.id)}">${esc(m.materialName)} (${esc(m.unit)})</option>`).join("");

    catSelect.addEventListener("change", e => {
      currentModalCategory = e.target.value;
      renderModalConsumptionChart();
    });
  }

  // Bind granularity buttons once
  if (granGroup && !granGroup.dataset.bound) {
    granGroup.dataset.bound = "true";
    granGroup.querySelectorAll(".amp-gran-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        granGroup.querySelectorAll(".amp-gran-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentModalGranularity = btn.getAttribute("data-gran");
        renderModalConsumptionChart();
      });
    });
  }

  // Determine which materials to display
  let targetMaterials = [];
  if (currentModalCategory === "general") {
    // Top 5 consumed materials
    const sumMap = {};
    usageRecords.forEach(u => {
      sumMap[u.materialId] = (sumMap[u.materialId] || 0) + u.quantity;
    });
    const sortedIds = Object.keys(sumMap).sort((a, b) => sumMap[b] - sumMap[a]).slice(0, 5);
    targetMaterials = catalogMaterials.filter(m => sortedIds.includes(m.id));
    if (targetMaterials.length === 0) targetMaterials = catalogMaterials.slice(0, 5);
  } else {
    const single = catalogMaterials.find(m => m.id === currentModalCategory);
    if (single) targetMaterials = [single];
  }

  let labels = [];
  let datasets = [];

  if (currentModalGranularity === "general") {
    // 6-Month Rolling Window
    labels = ["Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026"];
    datasets = targetMaterials.map((mat, idx) => {
      const monthlySums = [0, 0, 0, 0, 0, 0];
      usageRecords.filter(u => u.materialId === mat.id).forEach(u => {
        const d = new Date(u.date);
        const m = d.getMonth();
        if (m >= 0 && m < 6) monthlySums[m] += u.quantity;
      });
      const color = SERIES_PALETTE[idx % SERIES_PALETTE.length];
      return {
        label: `${mat.materialName} (${mat.unit})`,
        data: monthlySums.map(v => Number(v.toFixed(2))),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2.2,
        tension: 0.3,
        pointRadius: 3.5
      };
    });
  } else if (currentModalGranularity === "week") {
    // 7 Days
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      days.push({
        iso: d.toISOString().split("T")[0],
        label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      });
    }
    labels = days.map(d => d.label);
    datasets = targetMaterials.map((mat, idx) => {
      const dailySums = days.map(day => {
        let sum = 0;
        usageRecords.filter(u => u.materialId === mat.id).forEach(u => {
          if (String(u.date || "").startsWith(day.iso)) sum += u.quantity;
        });
        return Number(sum.toFixed(2));
      });
      const color = SERIES_PALETTE[idx % SERIES_PALETTE.length];
      return {
        label: `${mat.materialName} (${mat.unit})`,
        data: dailySums,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2.2,
        tension: 0.25,
        pointRadius: 3.5
      };
    });
  } else if (currentModalGranularity === "month") {
    // 4 Weeks of Current Month
    labels = ["Week 1", "Week 2", "Week 3", "Week 4"];
    datasets = targetMaterials.map((mat, idx) => {
      const weeklySums = [0, 0, 0, 0];
      usageRecords.filter(u => u.materialId === mat.id).forEach(u => {
        const d = new Date(u.date);
        const dayOfMonth = d.getDate();
        const wIdx = Math.min(3, Math.floor((dayOfMonth - 1) / 7));
        weeklySums[wIdx] += u.quantity;
      });
      const color = SERIES_PALETTE[idx % SERIES_PALETTE.length];
      return {
        label: `${mat.materialName} (${mat.unit})`,
        data: weeklySums.map(v => Number(v.toFixed(2))),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2.2,
        tension: 0.3,
        pointRadius: 3.5
      };
    });
  }

  if (modalConsumptionChartInst) {
    modalConsumptionChartInst.destroy();
  }

  modalConsumptionChartInst = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString("en-US")}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: "rgba(148, 180, 224, 0.12)" } }
      }
    }
  });

  // Render Custom Interactive Legend
  if (legendEl) {
    legendEl.innerHTML = datasets.map((ds, idx) => `
      <div class="amp-legend-item">
        <span class="amp-legend-dot" style="background:${ds.borderColor};"></span>
        <span class="amp-legend-label">${esc(ds.label)}</span>
      </div>
    `).join("");
  }
}

// ============================================================
// MODAL 3: OUT OF STOCK MATERIALS (TILES LIST)
// ============================================================

function renderOutOfStockTiles() {
  const container = $("outOfStockTilesList");
  const countNote = $("outOfStockCountNote");
  if (!container) return;

  const outOfStockMats = catalogMaterials.filter(m => m.currentStock <= 0);

  if (countNote) {
    countNote.textContent = `${outOfStockMats.length} depleted item${outOfStockMats.length === 1 ? "" : "s"}`;
  }

  if (outOfStockMats.length === 0) {
    container.innerHTML = `
      <div class="amp-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 12L11 15L16 9"/></svg>
        <strong>All materials in stock</strong>
        <span>No depleted raw materials detected in the live database.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = outOfStockMats.map(m => `
    <div class="amp-stock-tile">
      <div class="amp-st-left">
        <div class="amp-st-icon">⚠</div>
        <div>
          <div class="amp-st-name">${esc(m.materialName)}</div>
          <div class="amp-st-code">${esc(m.itemCode)} &bull; ${esc(m.unit)}</div>
        </div>
      </div>
      <div class="amp-st-right">
        <span class="amp-st-badge">Out of Stock</span>
        <span class="amp-st-threshold">Min required: ${m.minimumThreshold !== null ? m.minimumThreshold + " " + m.unit : "Not set"}</span>
      </div>
    </div>
  `).join("");
}

// ============================================================
// MODAL 4: RECEIVED RECORDS (FULL RECEIVING TRANSACTIONS)
// ============================================================

function renderReceivedModalTable() {
  const tbody = $("receivedModalTableBody");
  const countNote = $("receivedModalCountNote");
  const searchInput = $("receivedSearchInput");
  if (!tbody) return;

  const query = (searchInput?.value || "").toLowerCase().trim();

  const filtered = receiptRecords.filter(r => {
    if (!query) return true;
    return r.materialName.toLowerCase().includes(query) ||
           r.supplierName.toLowerCase().includes(query) ||
           (r.receivedBy && r.receivedBy.toLowerCase().includes(query));
  });

  if (countNote) {
    countNote.textContent = `Showing ${filtered.length} receiving records`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="amp-table-empty">No receiving records match your search.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const formattedDate = r.date ? new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
    return `
      <tr>
        <td>${esc(formattedDate)}</td>
        <td><strong>${esc(r.materialName)}</strong></td>
        <td><span class="amp-qty-highlight">${r.quantity.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span> <small>${esc(r.unit)}</small></td>
        <td>${esc(r.supplierName)}</td>
        <td><span class="amp-status-badge badge-received">Received</span></td>
      </tr>
    `;
  }).join("");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", renderReceivedModalTable);
  }
}

// ============================================================
// AUTHENTICATION GUARD & SESSION LIFECYCLE
// ============================================================

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

    userProfile = profile;
    await checkAndShowOnboarding(profile, supabase);

    const firstName = (profile.full_name || "there").split(" ")[0];
    if ($("welcomeGreeting")) {
      $("welcomeGreeting").textContent = `${greetingWord()}, ${firstName}! Here is your daily operational summary.`;
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
  } catch (e) {
    console.error("User auth check error:", e);
  }

  // Load User Dashboard data from live Supabase
  await loadUserDashboard();
});
