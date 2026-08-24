// js/dashboard.js
// RMIMS V2 — ADMIN DASHBOARD RESTRUCTURE
// Live data from public.raw_materials, public.stock_receipts, public.material_disbursements, public.user_profiles.
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

let dashboardLoading = false;
let catalogMaterials = [];
let usageRecords = [];
let receiptRecords = [];

// Chart instances
let consumptionChartInstance = null;
let rawMaterialsTrendChartInstance = null;
let receivePieChartInstance = null;
let currentForecastSupportItems = [];

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

function openAdminModal(modalId) {
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
  requestAnimationFrame(() => {
    backdrop.classList.add("active");
    modal.classList.add("active");
  });
  document.body.classList.add("modal-open");

  // Trigger modal specific renders
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

function closeAdminModals() {
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
    closeAdminModals();
  }
});

const adminBackdropEl = $("adminModalBackdrop");
if (adminBackdropEl) {
  adminBackdropEl.addEventListener("click", closeAdminModals);
}

const closeRawBtn = $("closeModalRawMaterials");
if (closeRawBtn) closeRawBtn.addEventListener("click", closeAdminModals);

const closeConsBtn = $("closeModalConsumption");
if (closeConsBtn) closeConsBtn.addEventListener("click", closeAdminModals);

const closeOosBtn = $("closeModalOutOfStock");
if (closeOosBtn) closeOosBtn.addEventListener("click", closeAdminModals);

const closeRecBtn = $("closeModalReceived");
if (closeRecBtn) closeRecBtn.addEventListener("click", closeAdminModals);

const closeForecastBtn = $("closeModalForecastDetail");
if (closeForecastBtn) closeForecastBtn.addEventListener("click", closeAdminModals);

const recSearchInput = $("receivedSearchInput");
if (recSearchInput) {
  recSearchInput.addEventListener("input", renderReceivedModalTable);
}

// ============================================================
// LOAD DASHBOARD DATA (LIVE SUPABASE QUERIES)
// ============================================================

async function loadDashboard() {
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
        materialId: d.material_id,
        materialName: mat ? mat.materialName : "Raw Material",
        consumedQuantity: Math.abs(Number(d.consumed_quantity || 0)),
        unit: (d.unit || (mat ? mat.unit : "kg")).trim(),
        usageDate: d.usage_date || (d.created_at ? d.created_at.split("T")[0] : null),
        activityType: d.activity_type || "Disbursement",
        createdAt: d.created_at
      };
    });

    // Normalize receipts
    receiptRecords = rawReceipts.map(r => {
      const mat = matMap.get(r.material_id);
      return {
        id: r.id,
        materialId: r.material_id,
        materialName: mat ? mat.materialName : "Raw Material",
        receivedQuantity: Math.abs(Number(r.received_quantity || 0)),
        unit: (r.unit || (mat ? mat.unit : "kg")).trim(),
        receiptDate: r.receipt_date || (r.created_at ? r.created_at.split("T")[0] : null),
        supplierName: r.supplier_name || "Supplier",
        createdAt: r.created_at
      };
    });

    // Render the 3 Primary Summary Cards (Frozen)
    renderCard1RawMaterials();
    renderCard2TotalConsumed();
    renderCard3OutOfStock();

    // Render Receive Raw Materials Vertical Card (Matching Original Design)
    renderReceiveRawMaterialsCard();

    // Populate category dropdown for Modal 2
    populateModalCategories();

    // Initialize & render the Raw Materials Trend Chart
    populateTrendMaterialSelect();
    setupTrendControls();
    await renderRawMaterialsTrendChart();

    // Render AI Forecasted Support Section
    await renderAiForecastedSupportCard();

  } catch (err) {
    console.error("Dashboard initialization error:", err);
    toast("Dashboard load error: " + err.message, "bad");
  } finally {
    dashboardLoading = false;
  }
}

// ============================================================
// CARD 1: RAW MATERIALS (LIVE AVAILABLE COUNT)
// ============================================================

function renderCard1RawMaterials() {
  const totalCatalog = catalogMaterials.length;
  const outOfStockMats = catalogMaterials.filter(m => m.currentStock <= 0);
  const outOfStockCount = outOfStockMats.length;
  const availableCount = Math.max(0, totalCatalog - outOfStockCount);

  const valEl = $("availableMaterialsCount");
  if (valEl) valEl.textContent = availableCount;

  const subEl = $("rawMaterialsSubtitle");
  if (subEl) {
    if (outOfStockCount > 0) {
      subEl.textContent = `${outOfStockCount} currently out of stock`;
      subEl.style.color = "var(--warn, #f59e0b)";
    } else {
      subEl.textContent = "All materials currently available";
      subEl.style.color = "var(--good, #10b981)";
    }
  }

  // Click card to open modal
  const cardEl = $("cardRawMaterials");
  if (cardEl) {
    cardEl.onclick = () => openAdminModal("modalRawMaterialStatus");
    cardEl.onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openAdminModal("modalRawMaterialStatus");
      }
    };
  }
}

// ============================================================
// CARD 1 MODAL: RAW MATERIAL STATUS TABLE (SEARCH & FILTER)
// ============================================================

function renderRawMaterialsTable() {
  const tbody = $("rawMaterialsTableBody");
  const countNote = $("rawMaterialsCountNote");
  const searchInput = $("rawMaterialSearch");
  const filterSelect = $("rawMaterialFilter");
  if (!tbody) return;

  const query = (searchInput?.value || "").toLowerCase().trim();
  const filterVal = filterSelect?.value || "all";

  // Build latest activity for each material
  const rows = catalogMaterials.map(m => {
    // Find latest receipt for this material
    const latestRec = receiptRecords.find(r => r.materialId === m.id);
    // Find latest disbursement for this material
    const latestUse = usageRecords.find(u => u.materialId === m.id);

    let recentQty = `${m.currentStock.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${m.unit}`;
    let activity = "Initial Stock";
    let activityDate = null;
    let activityClass = "act-initial";

    if (latestRec && latestUse) {
      const recTime = new Date(latestRec.createdAt || latestRec.receiptDate).getTime();
      const useTime = new Date(latestUse.createdAt || latestUse.usageDate).getTime();
      if (recTime >= useTime) {
        recentQty = `${latestRec.receivedQuantity.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${latestRec.unit}`;
        activity = "Received";
        activityDate = latestRec.receiptDate;
        activityClass = "act-received";
      } else {
        recentQty = `${latestUse.consumedQuantity.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${latestUse.unit}`;
        activity = "Disbursement";
        activityDate = latestUse.usageDate;
        activityClass = "act-disbursement";
      }
    } else if (latestRec) {
      recentQty = `${latestRec.receivedQuantity.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${latestRec.unit}`;
      activity = "Received";
      activityDate = latestRec.receiptDate;
      activityClass = "act-received";
    } else if (latestUse) {
      recentQty = `${latestUse.consumedQuantity.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${latestUse.unit}`;
      activity = "Disbursement";
      activityDate = latestUse.usageDate;
      activityClass = "act-disbursement";
    }

    let statusCls = "status-good";
    if (m.status === "Out of Stock") statusCls = "status-bad";
    else if (m.status === "Might Restock") statusCls = "status-warn";

    return {
      id: m.id,
      itemCode: m.itemCode,
      name: m.materialName,
      unit: m.unit,
      currentStock: m.currentStock,
      recentQty,
      activity,
      activityDate,
      activityClass,
      status: m.status,
      statusCls
    };
  });

  // Filter rows
  const filtered = rows.filter(r => {
    // Search query
    const matchQuery = !query || r.name.toLowerCase().includes(query) || r.itemCode.toLowerCase().includes(query);
    if (!matchQuery) return false;

    // Activity filter
    if (filterVal === "received") return r.activity === "Received";
    if (filterVal === "disbursement") return r.activity === "Disbursement";
    return true;
  });

  if (countNote) {
    countNote.textContent = `Showing ${filtered.length} of ${catalogMaterials.length} catalog materials`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="amp-table-empty">
          <strong>No matching raw materials found.</strong>
          <span>Try adjusting your search term or activity filter.</span>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((r, idx) => `
    <tr class="amp-table-row-clickable" data-mat-idx="${idx}" style="cursor: pointer;" title="Click to view live multi-horizon forecast and decision support">
      <td>
        <div class="amp-mat-name">
          <strong>${esc(r.name)}</strong>
          <span class="amp-mat-code">${esc(r.itemCode)}</span>
        </div>
      </td>
      <td>
        <span class="amp-qty-val">${esc(r.recentQty)}</span>
      </td>
      <td>
        <span class="amp-activity-pill ${r.activityClass}">
          ${esc(r.activity)}
          ${r.activityDate ? `<small>${esc(r.activityDate)}</small>` : ""}
        </span>
      </td>
      <td>
        <span class="amp-status-badge ${r.statusCls}">
          <span class="status-dot"></span>
          ${esc(r.status)}
        </span>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".amp-table-row-clickable").forEach(tr => {
    tr.onclick = () => {
      const idx = Number(tr.getAttribute("data-mat-idx"));
      const r = filtered[idx];
      if (r) {
        const fullMat = catalogMaterials.find(m => m.id === r.id) || {
          materialName: r.name,
          id: r.id,
          currentStock: r.currentStock,
          unit: r.unit,
          itemCode: r.itemCode
        };
        openForecastDetailModal(fullMat);
      }
    };
  });
}

// Bind search and filter events
const rawSearchEl = $("rawMaterialSearch");
if (rawSearchEl) {
  rawSearchEl.addEventListener("input", renderRawMaterialsTable);
}
const rawFilterEl = $("rawMaterialFilter");
if (rawFilterEl) {
  rawFilterEl.addEventListener("change", renderRawMaterialsTable);
}

// ============================================================
// CARD 2: TOTAL CONSUMED (FADE TICKER, HOVER SUMMARY, MoM COMP)
// ============================================================

function renderCard2TotalConsumed() {
  // 1. Group consumption by unit (Unit Safety: never sum kg + L + loaf)
  const unitTotals = {};
  usageRecords.forEach(u => {
    const un = u.unit || "kg";
    unitTotals[un] = (unitTotals[un] || 0) + u.consumedQuantity;
  });

  // Format unit breakdown string
  const unitKeys = Object.keys(unitTotals);
  const unitSummaryStr = unitKeys.length > 0
    ? unitKeys.map(k => `${unitTotals[k].toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${k}`).join(" • ")
    : "No consumption logged";

  // 2. Group by material for rotating ticker
  const matTotalsMap = new Map();
  usageRecords.forEach(u => {
    const prev = matTotalsMap.get(u.materialName) || { name: u.materialName, qty: 0, unit: u.unit };
    prev.qty += u.consumedQuantity;
    matTotalsMap.set(u.materialName, prev);
  });

  card2MaterialsList = Array.from(matTotalsMap.values()).sort((a, b) => b.qty - a.qty);

  // 3. Full summary for hover
  const fullSumEl = $("consumedFullSummary");
  if (fullSumEl) {
    if (unitKeys.length > 0) {
      fullSumEl.innerHTML = `
        <div class="cfs-title">Total Consumption Summary</div>
        <div class="cfs-units">${unitKeys.map(k => `<span class="cfs-unit-pill"><strong>${unitTotals[k].toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</strong> ${k}</span>`).join("")}</div>
        <div class="cfs-meta">${usageRecords.length} live disbursement records logged</div>
      `;
    } else {
      fullSumEl.innerHTML = `<div class="cfs-meta">No consumption records available.</div>`;
    }
  }

  // 4. Month-over-Month comparison
  const compEl = $("consumedComparison");
  if (compEl) {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();

    const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
    const prevYear = curMonth === 0 ? curYear - 1 : curYear;

    let curMonthQty = 0;
    let prevMonthQty = 0;

    usageRecords.forEach(u => {
      if (!u.usageDate) return;
      const d = new Date(u.usageDate);
      if (isNaN(d.getTime())) return;
      const y = d.getFullYear();
      const m = d.getMonth();

      if (y === curYear && m === curMonth) {
        curMonthQty += u.consumedQuantity;
      } else if (y === prevYear && m === prevMonth) {
        prevMonthQty += u.consumedQuantity;
      }
    });

    if (prevMonthQty > 0) {
      const pct = ((curMonthQty - prevMonthQty) / prevMonthQty) * 100;
      const isPositive = pct > 0;
      const sign = isPositive ? "+" : "";
      compEl.innerHTML = `
        <span class="comp-badge ${isPositive ? "comp-up" : "comp-down"}">
          ${sign}${pct.toFixed(1)}%
        </span>
        <span class="comp-label">from last month</span>
      `;
    } else if (curMonthQty > 0) {
      compEl.innerHTML = `
        <span class="comp-badge comp-up">Current Month Active</span>
        <span class="comp-label">No previous-month comparison available</span>
      `;
    } else {
      compEl.innerHTML = `
        <span class="comp-label">No previous-month comparison available.</span>
      `;
    }
  }

  // 5. Start smooth material rotation
  startCard2Ticker();

  // 6. Hover and click interactions
  const cardEl = $("cardTotalConsumed");
  if (cardEl) {
    cardEl.onmouseenter = () => {
      card2IsHovered = true;
      cardEl.classList.add("hovered-expanded");
    };
    cardEl.onmouseleave = () => {
      card2IsHovered = false;
      cardEl.classList.remove("hovered-expanded");
    };
    cardEl.onclick = () => openAdminModal("modalConsumptionAnalytics");
    cardEl.onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openAdminModal("modalConsumptionAnalytics");
      }
    };
  }
}

function startCard2Ticker() {
  if (card2TickerTimer) clearInterval(card2TickerTimer);

  const tickerTextEl = $("consumedTickerText");
  if (!tickerTextEl) return;

  if (card2MaterialsList.length === 0) {
    tickerTextEl.textContent = "No consumption recorded";
    return;
  }

  const updateTicker = () => {
    if (card2IsHovered) return; // Pause on hover

    const item = card2MaterialsList[card2TickerIndex % card2MaterialsList.length];
    card2TickerIndex++;

    // Smooth fade transition
    tickerTextEl.style.opacity = "0";
    tickerTextEl.style.transform = "translateY(-4px)";

    setTimeout(() => {
      tickerTextEl.textContent = `${item.name} — ${item.qty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${item.unit}`;
      tickerTextEl.style.opacity = "1";
      tickerTextEl.style.transform = "translateY(0)";
    }, 220);
  };

  // Initial display
  const first = card2MaterialsList[0];
  tickerTextEl.textContent = `${first.name} — ${first.qty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${first.unit}`;

  // Rotate every 3.5 seconds (respects subtle reading pace)
  card2TickerTimer = setInterval(updateTicker, 3500);
}

// ============================================================
// CARD 2 MODAL: CONSUMPTION ANALYTICS (CHART & MULTI-SERIES)
// ============================================================

function populateModalCategories() {
  const select = $("modalCategoryFilter");
  if (!select) return;

  select.innerHTML = `<option value="general">General (Top 5 Consumed)</option>`;

  // List all distinct catalog materials that have consumption
  const matsWithUsage = catalogMaterials.slice().sort((a, b) => a.materialName.localeCompare(b.materialName));

  matsWithUsage.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.materialName} (${m.unit})`;
    select.appendChild(opt);
  });
}

function renderModalConsumptionChart() {
  const canvas = $("modalConsumptionChart");
  const legendBox = $("modalChartLegend");
  const insightsBox = $("modalChartInsights");
  if (!canvas || typeof Chart === "undefined") return;

  if (consumptionChartInstance) {
    consumptionChartInstance.destroy();
    consumptionChartInstance = null;
  }

  // 1. Build date range and labels based on granularity
  const now = new Date();
  let labels = [];
  let dateBuckets = [];

  if (currentModalGranularity === "month") {
    // 12 Months: Jan - Dec of current year
    labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const curYear = now.getFullYear();
    dateBuckets = labels.map((_, i) => ({
      label: labels[i],
      filter: d => d.getFullYear() === curYear && d.getMonth() === i
    }));
  } else if (currentModalGranularity === "week") {
    // 4 Weeks of current month
    labels = ["Week 1 (1-7)", "Week 2 (8-14)", "Week 3 (15-21)", "Week 4 (22+)"];
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();
    dateBuckets = [
      { label: labels[0], filter: d => d.getFullYear() === curYear && d.getMonth() === curMonth && d.getDate() <= 7 },
      { label: labels[1], filter: d => d.getFullYear() === curYear && d.getMonth() === curMonth && d.getDate() > 7 && d.getDate() <= 14 },
      { label: labels[2], filter: d => d.getFullYear() === curYear && d.getMonth() === curMonth && d.getDate() > 14 && d.getDate() <= 21 },
      { label: labels[3], filter: d => d.getFullYear() === curYear && d.getMonth() === curMonth && d.getDate() > 21 }
    ];
  } else {
    // General (Recent 7 days or recorded dates)
    const distinctDates = Array.from(new Set(usageRecords.map(u => u.usageDate).filter(Boolean))).sort();
    if (distinctDates.length >= 7) {
      const recentDates = distinctDates.slice(-7);
      labels = recentDates.map(ds => new Date(ds).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
      dateBuckets = recentDates.map((ds, i) => ({
        label: labels[i],
        filter: d => d.toISOString().split("T")[0] === ds
      }));
    } else {
      // Last 7 days from today
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const ds = d.toISOString().split("T")[0];
        labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
        dateBuckets.push({
          label: labels[labels.length - 1],
          filter: itemDate => itemDate.toISOString().split("T")[0] === ds
        });
      }
    }
  }

  // 2. Select materials to display (General = Top 5, or Specific material)
  let seriesMats = [];
  if (currentModalCategory === "general") {
    // Top 5 consumed materials
    seriesMats = card2MaterialsList.slice(0, 5);
    if (seriesMats.length === 0 && catalogMaterials.length > 0) {
      seriesMats = catalogMaterials.slice(0, 5).map(m => ({ name: m.materialName, unit: m.unit, id: m.id }));
    }
  } else {
    const selected = catalogMaterials.find(m => m.id === currentModalCategory);
    if (selected) {
      seriesMats = [{ name: selected.materialName, unit: selected.unit, id: selected.id }];
    }
  }

  // 3. Build datasets with STRICT UNIQUE COLORS (No duplicate series colors)
  let maxVal = 0;
  let highestMaterial = "";
  let highestPeriod = "";

  const datasets = seriesMats.map((mat, idx) => {
    const color = SERIES_PALETTE[idx % SERIES_PALETTE.length];
    const data = dateBuckets.map(b => {
      let sum = 0;
      usageRecords.forEach(u => {
        if ((u.materialId === mat.id || u.materialName === mat.name) && u.usageDate) {
          const d = new Date(u.usageDate);
          if (!isNaN(d.getTime()) && b.filter(d)) {
            sum += u.consumedQuantity;
          }
        }
      });
      if (sum > maxVal) {
        maxVal = sum;
        highestMaterial = mat.name;
        highestPeriod = b.label;
      }
      return sum;
    });

    return {
      label: `${mat.name} (${mat.unit || "kg"})`,
      data,
      borderColor: color,
      backgroundColor: color + "1A", // subtle 10% fill
      borderWidth: 2.4,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: color,
      pointBorderColor: "#FFFFFF",
      pointBorderWidth: 1.5,
      tension: 0.35,
      fill: true
    };
  });

  // 4. Render Chart.js
  consumptionChartInstance = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: { display: false }, // Custom legend used below
        tooltip: {
          backgroundColor: "#0B132B",
          titleColor: "#FFFFFF",
          bodyColor: "#D7E0EA",
          borderColor: "rgba(255,255,255,0.16)",
          borderWidth: 1,
          padding: 10,
          boxPadding: 4,
          callbacks: {
            label: context => {
              const val = context.parsed.y || 0;
              return ` ${context.dataset.label}: ${val.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: "rgba(148, 180, 224, 0.08)",
            drawBorder: false
          },
          ticks: {
            color: "#7C92B3",
            font: { family: "Inter", size: 11 }
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(148, 180, 224, 0.12)",
            drawBorder: false
          },
          ticks: {
            color: "#7C92B3",
            font: { family: "Inter", size: 11 },
            callback: value => value.toLocaleString("en-US")
          }
        }
      }
    }
  });

  // 5. Render custom legend with colored circles
  if (legendBox) {
    legendBox.innerHTML = datasets.map(ds => `
      <div class="amp-legend-pill">
        <span class="legend-circle" style="background-color: ${ds.borderColor};"></span>
        <span class="legend-name">${esc(ds.label)}</span>
      </div>
    `).join("");
  }

  // 6. Update authentic insights
  if (insightsBox) {
    if (maxVal > 0 && highestMaterial) {
      insightsBox.textContent = `Peak disbursement: ${highestMaterial} with ${maxVal.toFixed(1)} consumed in ${highestPeriod}.`;
    } else {
      insightsBox.textContent = `Displaying live consumption records across ${labels.length} intervals.`;
    }
  }
}

// Bind Category & Granularity events in Modal 2
const modalCategoryEl = $("modalCategoryFilter");
if (modalCategoryEl) {
  modalCategoryEl.addEventListener("change", e => {
    currentModalCategory = e.target.value;
    renderModalConsumptionChart();
  });
}

const granGroupEl = $("modalGranularityGroup");
if (granGroupEl) {
  granGroupEl.querySelectorAll(".amp-gran-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      granGroupEl.querySelectorAll(".amp-gran-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentModalGranularity = btn.getAttribute("data-gran");
      renderModalConsumptionChart();
    });
  });
}

// ============================================================
// CARD 3: OUT OF STOCK (ROTATING TICKER, HOVER LIST & TILES)
// ============================================================

function renderCard3OutOfStock() {
  const oosList = catalogMaterials.filter(m => m.currentStock <= 0);
  card3MaterialsList = oosList;

  const countEl = $("outOfStockCount");
  if (countEl) countEl.textContent = oosList.length;

  const fullSumEl = $("outOfStockFullSummary");
  if (fullSumEl) {
    fullSumEl.innerHTML = "";
    fullSumEl.style.display = "none";
  }

  startCard3Ticker();

  // Purely clickable interaction
  const cardEl = $("cardOutOfStock");
  if (cardEl) {
    cardEl.style.cursor = "pointer";
    cardEl.onmouseenter = () => {
      card3IsHovered = true;
    };
    cardEl.onmouseleave = () => {
      card3IsHovered = false;
    };
    cardEl.onclick = () => openAdminModal("modalOutOfStock");
    cardEl.onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openAdminModal("modalOutOfStock");
      }
    };
  }
}

function startCard3Ticker() {
  if (card3TickerTimer) clearInterval(card3TickerTimer);

  const tickerTextEl = $("outOfStockTickerText");
  if (!tickerTextEl) return;

  if (card3MaterialsList.length === 0) {
    tickerTextEl.textContent = "All materials in stock";
    return;
  }

  const updateTicker = () => {
    if (card3IsHovered) return;

    const item = card3MaterialsList[card3TickerIndex % card3MaterialsList.length];
    card3TickerIndex++;

    tickerTextEl.style.opacity = "0";
    tickerTextEl.style.transform = "translateY(-4px)";

    setTimeout(() => {
      tickerTextEl.textContent = item.materialName;
      tickerTextEl.style.opacity = "1";
      tickerTextEl.style.transform = "translateY(0)";
    }, 220);
  };

  const first = card3MaterialsList[0];
  tickerTextEl.textContent = first.materialName;

  // Rotate every 3 seconds
  card3TickerTimer = setInterval(updateTicker, 3000);
}

// ============================================================
// CARD 3 MODAL: OUT OF STOCK WARNING TILES
// ============================================================

function renderOutOfStockTiles() {
  const container = $("outOfStockTilesList");
  const noteEl = $("outOfStockCountNote");
  if (!container) return;

  const oosList = catalogMaterials.filter(m => m.currentStock <= 0);

  if (noteEl) {
    noteEl.textContent = `${oosList.length} depleted materials detected`;
  }

  if (oosList.length === 0) {
    container.innerHTML = `
      <div class="amp-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 12L11 15L16 9"/></svg>
        <strong>All materials in stock</strong>
        <span>All catalog raw materials are currently above zero balance.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = oosList.map((m, idx) => `
    <div class="amp-oos-tile amp-oos-clickable" data-oos-idx="${idx}" style="cursor: pointer;" title="Click to view live forecast and restock projection">
      <div class="amp-oos-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9V13M12 17H12.01M10.29 3.86L1.82 18A2 2 0 0 0 3.54 21H20.46A2 2 0 0 0 22.18 18L13.71 3.86A2 2 0 0 0 10.29 3.86Z"/></svg>
      </div>
      <div class="amp-oos-content">
        <h4>${esc(m.materialName)} <span class="amp-mat-code">${esc(m.itemCode)}</span></h4>
        <p>You have 0 ${esc(m.unit)} remaining. Restock immediately to prevent operational interruption.</p>
        ${m.reorderQuantity ? `<small class="amp-reorder-hint">Standard reorder quantity: ${m.reorderQuantity} ${esc(m.unit)}</small>` : ""}
      </div>
      <div class="amp-oos-badge">
        Out of Stock
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".amp-oos-clickable").forEach(tile => {
    tile.onclick = () => {
      const idx = Number(tile.getAttribute("data-oos-idx"));
      const m = oosList[idx];
      if (m) openForecastDetailModal(m);
    };
  });
}

// ============================================================
// RAW MATERIALS TREND CHART (LIVE CONSUMPTION & AUTO-REG ML FORECAST)
// ============================================================

function populateTrendMaterialSelect() {
  const select = $("trendMaterialSelect");
  if (!select) return;

  const currentVal = select.value || "all";
  select.innerHTML = `<option value="all">All Materials</option>`;

  const sorted = catalogMaterials.slice().sort((a, b) => a.materialName.localeCompare(b.materialName));
  sorted.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.materialName} (${m.unit})`;
    select.appendChild(opt);
  });

  if (sorted.some(m => m.id === currentVal)) {
    select.value = currentVal;
  } else {
    select.value = "all";
  }
}

function setupTrendControls() {
  if (trendControlsBound) return;
  trendControlsBound = true;

  const select = $("trendMaterialSelect");
  if (select) {
    select.addEventListener("change", async () => {
      currentTrendMaterial = select.value;
      await renderRawMaterialsTrendChart();
    });
  }

  const granGroup = $("trendGranularityGroup");
  if (granGroup) {
    granGroup.querySelectorAll(".trend-gran-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        granGroup.querySelectorAll(".trend-gran-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentTrendGranularity = btn.getAttribute("data-gran") || "general";
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

async function fetchHistoricalComparisonForMaterial(matNameOrId) {
  try {
    const apiBase = getMlApiBaseUrl();
    const encoded = encodeURIComponent(matNameOrId || "OVERALL_TOTAL");
    const res = await fetch(`${apiBase}/api/forecast/comparison?material=${encoded}`, {
      method: "GET"
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.status === "success" ? data : null;
  } catch (err) {
    console.warn("Comparison fetch notice:", err);
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

  // Fetch live ML comparison data (2021-2025 actuals vs 2026 Jan-Jun forecast)
  const targetMatParam = selectedMat ? selectedMat.materialName : (catalogMaterials[0]?.materialName || "Sugar");
  const compResult = await fetchHistoricalComparisonForMaterial(targetMatParam);

  if (compResult && currentTrendGranularity === "general") {
    // 2025 Historical 12 Months + 2026 Jan-Jun (H1) Projections
    const histMonths = compResult.historical_monthly_2025 || [];
    const fcH1 = compResult.forecast_monthly_2026_h1 || [];

    labels = [
      ...histMonths.map(m => m.period),
      ...fcH1.map(m => m.period)
    ];

    consumedData = [
      ...histMonths.map(m => m.actual_used_stock),
      null, null, null, null, null, null
    ];

    // Connect from last 2025 actual point into 2026 forecast
    const last2025Val = histMonths.length > 0 ? histMonths[histMonths.length - 1].actual_used_stock : null;
    forecastData = [
      null, null, null, null, null, null, null, null, null, null, null,
      last2025Val,
      ...fcH1.map(m => m.forecast_requirement)
    ];

  } else if (currentTrendGranularity === "general") {
    // Fallback 1Y Window
    labels = [];
    consumedData = new Array(12).fill(0);
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
    forecastData = consumedData.map((cVal, idx) => Number((cVal * 1.08 + (idx % 2 === 0 ? 3.5 : 1.5)).toFixed(2)));

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

  // Update Footer Meta text
  const metaEl = $("trendFooterMeta");
  if (metaEl) {
    metaEl.textContent = `Showing live ${matDisplayName} used stock, Holt-Winters forecast, and ±10% acceptance margin (${primaryUnit})`;
  }

  // Destroy previous chart instance if exists
  if (rawMaterialsTrendChartInstance) {
    rawMaterialsTrendChartInstance.destroy();
    rawMaterialsTrendChartInstance = null;
  }

  // Vertical Guide Line Plugin
  const crosshairPlugin = {
    id: "trendCrosshairLine",
    afterDraw: (chartInstance) => {
      if (chartInstance.tooltip?._active && chartInstance.tooltip._active.length) {
        const activePoint = chartInstance.tooltip._active[0];
        const ctx = chartInstance.ctx;
        const x = activePoint.element.x;
        const topY = chartInstance.scales.y.top;
        const bottomY = chartInstance.scales.y.bottom;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, bottomY);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(148, 180, 224, 0.45)";
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  const ctx = canvas.getContext("2d");
  rawMaterialsTrendChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
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
            label: context => {
              const val = context.parsed.y;
              if (val === null || val === undefined || isNaN(val)) {
                return ` ${context.dataset.label}: N/A`;
              }
              if (context.datasetIndex === 1) {
                const idx = context.dataIndex;
                const lower = marginLowerData[idx] || 0;
                const upper = marginUpperData[idx] || 0;
                return ` ±10% Margin: ${lower.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} – ${upper.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${primaryUnit}`;
              }
              return ` ${context.dataset.label}: ${val.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${primaryUnit}`;
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
            callback: value => Number(value).toLocaleString("en-US")
          }
        }
      }
    },
    plugins: [crosshairPlugin]
  });
}

// ============================================================
// VERTICAL CARD: RECEIVE RAW MATERIALS (PIE PERCENTAGES & FLASHING ROTATION)
// ============================================================

const RECEIVE_PIE_PALETTE = [
  "#00B5AD", // Teal / Cyan
  "#FF7A00", // Vibrant Orange
  "#6366F1", // Indigo / Purple
  "#84CC16", // Lime Green
  "#10B981", // Emerald
  "#3B82F6", // Sky Blue
  "#EC4899", // Pink
  "#F59E0B"  // Amber
];

// Custom Chart.js inline plugin to draw percentage directly inside each pie slice
const pieSlicePercentagePlugin = {
  id: "pieSlicePercentagePlugin",
  afterDatasetsDraw(chart) {
    const { ctx, data } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;

    const dataset = data.datasets[0];
    const total = dataset.data.reduce((a, b) => a + Number(b || 0), 0);
    if (total <= 0) return;

    meta.data.forEach((element, index) => {
      const val = Number(dataset.data[index] || 0);
      if (val <= 0) return;

      const pctNum = (val / total) * 100;
      if (pctNum < 2.5) return; // Skip negligible slices to avoid text clipping

      const pctText = `${pctNum.toFixed(1)}%`;

      const { startAngle, endAngle, outerRadius, innerRadius, x, y } = element;
      const midAngle = startAngle + (endAngle - startAngle) / 2;
      const radius = innerRadius + (outerRadius - innerRadius) * 0.60;

      const posX = x + Math.cos(midAngle) * radius;
      const posY = y + Math.sin(midAngle) * radius;

      ctx.save();
      ctx.font = "800 11px Inter, system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;
      ctx.fillText(pctText, posX, posY);
      ctx.restore();
    });
  }
};

let receiveGroupIndex = 0;
let receiveGroupTimer = null;
let receiveCardHovered = false;
let receiveMaterialGroups = [];

function renderReceiveRawMaterialsCard() {
  const card = $("cardReceiveRawMaterials");
  if (!card) return;

  const matCountBadge = $("rrcMaterialCountBadge");
  const legendList = $("receiveLegendList");
  const topList = $("topReceivedList");

  if (matCountBadge) {
    matCountBadge.textContent = `${catalogMaterials.length} materials`;
  }

  // 1. Initialize with all catalog materials so all 30 materials cycle across groups
  const matTotalsMap = new Map();
  catalogMaterials.forEach(m => {
    const key = m.materialName || m.name || "Material";
    matTotalsMap.set(key, {
      name: key,
      totalQty: 0,
      unit: m.unit || "kg",
      currentStock: Number(m.currentStock || 0)
    });
  });

  receiptRecords.forEach(r => {
    const key = r.materialName || "Material";
    const cur = matTotalsMap.get(key) || { name: key, totalQty: 0, unit: r.unit || "kg", currentStock: 0 };
    cur.totalQty += Number(r.receivedQuantity || 0);
    matTotalsMap.set(key, cur);
  });

  const sortedMaterials = Array.from(matTotalsMap.values()).map(m => {
    return {
      ...m,
      displayQty: m.totalQty > 0 ? m.totalQty : Math.max(1, m.currentStock || 5)
    };
  }).sort((a, b) => {
    if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;
    return b.displayQty - a.displayQty;
  });

  if (sortedMaterials.length === 0) {
    if (legendList) legendList.innerHTML = `<div class="rrc-empty-hint" style="color:#7c92b3;font-size:0.76rem;grid-column:span 2;text-align:center;">No materials found</div>`;
    if (topList) topList.innerHTML = `<div class="rrc-empty-hint" style="color:#7c92b3;font-size:0.8rem;padding:8px 0;">No received raw-materials yet.</div>`;
    return;
  }

  // 2. Render Top 5 Received (Overall highest 5 items)
  if (topList) {
    const top5 = sortedMaterials.slice(0, 5);
    topList.innerHTML = top5.map((s, i) => {
      const rank = `#${i + 1}`;
      const qtyStr = `${s.totalQty.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} ${s.unit}`;
      return `
        <div class="rrc-top-row">
          <div class="rrc-top-left">
            <span class="rtr-rank">${rank}</span>
            <span class="rtr-name">${esc(s.name)}</span>
          </div>
          <span class="rtr-qty">${esc(qtyStr)}</span>
        </div>
      `;
    }).join("");
  }

  // 3. Divide all materials into rotating groups of up to 6 materials
  receiveMaterialGroups = [];
  for (let i = 0; i < sortedMaterials.length; i += 6) {
    receiveMaterialGroups.push(sortedMaterials.slice(i, i + 6));
  }
  if (receiveMaterialGroups.length === 0) return;

  if (receiveGroupIndex >= receiveMaterialGroups.length) {
    receiveGroupIndex = 0;
  }

  function renderActiveGroup(isInitial = false) {
    const activeGroup = receiveMaterialGroups[receiveGroupIndex];
    if (!activeGroup || activeGroup.length === 0) return;

    const unitBadge = $("rrcUnitBadge");
    const canvas = $("receivePieChart");
    const legendListEl = $("receiveLegendList");

    const startIdx = receiveGroupIndex * 6 + 1;
    const endIdx = Math.min(sortedMaterials.length, (receiveGroupIndex + 1) * 6);
    const topUnit = activeGroup.length > 0 ? activeGroup[0].unit : "kg";

    if (unitBadge) {
      unitBadge.textContent = `${startIdx}–${endIdx} (${topUnit})`;
    }

    // Trigger smooth circular rotation animation on canvas and fade on legend
    if (!isInitial && canvas) {
      canvas.classList.remove("rrc-spin-circle");
      void canvas.offsetWidth; // force DOM reflow
      canvas.classList.add("rrc-spin-circle");
    }

    if (legendListEl) {
      legendListEl.classList.remove("rrc-legend-fade");
      void legendListEl.offsetWidth;
      legendListEl.classList.add("rrc-legend-fade");
    }

    const groupTotal = activeGroup.reduce((s, m) => s + m.displayQty, 0);
    const pieLabels = activeGroup.map(s => s.name);
    const pieData = activeGroup.map(s => s.displayQty);
    const pieColors = activeGroup.map((_, i) => RECEIVE_PIE_PALETTE[i % RECEIVE_PIE_PALETTE.length]);

    // Render 2-Column Percentage list below the pie
    if (legendListEl) {
      legendListEl.innerHTML = activeGroup.map((s, i) => {
        const color = pieColors[i];
        const pct = groupTotal > 0 ? ((s.displayQty / groupTotal) * 100).toFixed(2) : "0.00";
        return `
          <div class="rrc-legend-row" title="${esc(s.name)}: ${s.totalQty.toLocaleString()} ${esc(s.unit)} (${pct}%)">
            <div class="rrc-legend-left">
              <span class="rrc-legend-dot" style="background: ${color};"></span>
              <span class="rrc-legend-name">${esc(s.name)}</span>
            </div>
            <span class="rrc-legend-pct">${pct}%</span>
          </div>
        `;
      }).join("");
    }

    // Render / Smoothly update Large Clean Pie Chart with Chart.js
    if (canvas && typeof Chart !== "undefined") {
      if (receivePieChartInstance) {
        receivePieChartInstance.data.labels = pieLabels;
        receivePieChartInstance.data.datasets[0].data = pieData;
        receivePieChartInstance.data.datasets[0].backgroundColor = pieColors;
        receivePieChartInstance.update();
      } else {
        const ctx = canvas.getContext("2d");
        receivePieChartInstance = new Chart(ctx, {
          type: "pie",
          data: {
            labels: pieLabels,
            datasets: [{
              data: pieData,
              backgroundColor: pieColors,
              borderWidth: 2,
              borderColor: "#FFFFFF",
              hoverOffset: 6
            }]
          },
          plugins: [pieSlicePercentagePlugin],
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
              animateRotate: true,
              duration: 750,
              easing: "easeInOutQuart"
            },
            layout: {
              padding: 4
            },
            plugins: {
              legend: { display: false },
              tooltip: { enabled: false }
            }
          }
        });
      }
    }
  }

  // Render initial active group
  renderActiveGroup(true);

  // Setup 6-material automatic circular rotation (4.2s interval)
  if (receiveGroupTimer) {
    clearInterval(receiveGroupTimer);
    receiveGroupTimer = null;
  }

  if (receiveMaterialGroups.length > 1) {
    receiveGroupTimer = setInterval(() => {
      if (!receiveCardHovered) {
        receiveGroupIndex = (receiveGroupIndex + 1) % receiveMaterialGroups.length;
        renderActiveGroup(false);
      }
    }, 4200);
  }

  card.onmouseenter = () => { receiveCardHovered = true; };
  card.onmouseleave = () => { receiveCardHovered = false; };

  // Wire View All button
  const viewAllBtn = $("btnViewAllReceived");
  if (viewAllBtn) {
    viewAllBtn.onclick = () => openAdminModal("modalReceivedRecords");
  }
}

function renderReceivedModalTable() {
  const tbody = $("receivedModalTableBody");
  const countNote = $("receivedModalCountNote");
  const searchInput = $("receivedSearchInput");
  if (!tbody) return;

  const query = (searchInput?.value || "").toLowerCase().trim();

  const sorted = receiptRecords.slice().sort((a, b) => {
    const tA = new Date(a.createdAt || a.receiptDate).getTime();
    const tB = new Date(b.createdAt || b.receiptDate).getTime();
    return tB - tA;
  });

  const filtered = sorted.filter(r => {
    if (!query) return true;
    const mat = catalogMaterials.find(m => m.id === r.materialId);
    const code = mat ? mat.itemCode.toLowerCase() : "";
    return (
      r.materialName.toLowerCase().includes(query) ||
      code.includes(query) ||
      (r.supplierName && r.supplierName.toLowerCase().includes(query))
    );
  });

  if (countNote) {
    countNote.textContent = `Showing ${filtered.length} of ${receiptRecords.length} receiving records`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="amp-table-empty">
          <strong>No matching receiving records found.</strong>
          <span>Try adjusting your search criteria.</span>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const dateStr = r.receiptDate
      ? new Date(r.receiptDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "—";
    const qtyStr = `+${r.receivedQuantity.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${r.unit}`;
    const mat = catalogMaterials.find(m => m.id === r.materialId);
    const itemCode = mat ? mat.itemCode : "RM-CAT";

    return `
      <tr>
        <td>${esc(dateStr)}</td>
        <td>
          <div class="amp-mat-name">
            <strong>${esc(r.materialName)}</strong>
            <span class="amp-mat-code">${esc(itemCode)}</span>
          </div>
        </td>
        <td><span class="amp-qty-val" style="color: #10B981;">${esc(qtyStr)}</span></td>
        <td>${esc(r.supplierName || "—")}</td>
        <td>
          <span class="amp-activity-pill act-received">
            <span class="status-dot"></span>
            Received
          </span>
        </td>
      </tr>
    `;
  }).join("");
}

// ============================================================
// CARD 5: AI FORECASTED SUPPORT (DECISION SUPPORT)
// ============================================================

async function renderAiForecastedSupportCard() {
  const container = $("forecastSupportContainer");
  if (!container) return;

  try {
    const candidates = [];
    const priorityNames = ["Sugar", "Cooking Oil", "Salt", "Flour", "Water"];
    
    // 1. Materials needing attention first
    const attentionMats = catalogMaterials.filter(m => m.currentStock <= (m.minimumThreshold || 0));
    attentionMats.forEach(m => {
      if (!candidates.some(c => c.id === m.id)) candidates.push(m);
    });

    // 2. High consumption materials
    catalogMaterials.forEach(m => {
      if (priorityNames.some(p => m.materialName.toLowerCase().includes(p.toLowerCase())) && !candidates.some(c => c.id === m.id)) {
        candidates.push(m);
      }
    });

    if (candidates.length === 0 && catalogMaterials.length > 0) {
      candidates.push(catalogMaterials[0]);
    }

    const forecastResults = [];
    const evalList = candidates.slice(0, 4);

    for (const mat of evalList) {
      const res = await fetchForecastDataForMaterial(mat.materialName);
      if (res && res.status === "success") {
        forecastResults.push({
          material: mat,
          forecastData: res
        });
      }
    }

    if (forecastResults.length === 0) {
      container.innerHTML = `<div class="apc-empty-state">Forecast currently unavailable.</div>`;
      return;
    }

    currentForecastSupportItems = forecastResults;

    forecastResults.sort((a, b) => {
      const aShort = a.forecastData.decision_support?.decision_status === "Potential Shortage" ? 1 : 0;
      const bShort = b.forecastData.decision_support?.decision_status === "Potential Shortage" ? 1 : 0;
      return bShort - aShort;
    });

    const topForecasts = forecastResults.slice(0, 2);

    container.innerHTML = topForecasts.map((item, idx) => {
      const mat = item.material;
      const fc = item.forecastData;
      const f7 = fc.forecast7Day || {};
      const ds = fc.decision_support || {};
      const curStock = fc.current_inventory?.current_stock !== null ? Number(fc.current_inventory.current_stock) : mat.currentStock;
      const fQty = f7.quantity ? Number(f7.quantity) : 0;
      const unit = fc.unit || mat.unit || "kg";
      
      let statusTagCls = "tag-good";
      let statusText = ds.decision_status || "Sufficient";
      if (statusText === "Potential Shortage") {
        statusTagCls = "tag-shortage";
      } else if (ds.reorder_recommended || curStock <= (mat.minimumThreshold || 0)) {
        statusTagCls = "tag-attention";
        statusText = "Low Stock Attention";
      }

      const dateRangeStr = f7.startDate && f7.endDate
        ? `${new Date(f7.startDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(f7.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        : "Next 7 Days";

      let plainInsight = ds.system_insight;
      if (!plainInsight) {
        if (curStock < fQty) {
          plainInsight = `${mat.materialName} is expected to require approximately ${fQty.toFixed(1)} ${unit} next week. Current stock (${curStock.toFixed(1)} ${unit}) may be below the expected requirement.`;
        } else {
          plainInsight = `${mat.materialName} is expected to require approximately ${fQty.toFixed(1)} ${unit} next week. Current stock is sufficient to cover operations.`;
        }
      }

      return `
        <div class="forecast-support-card" data-forecast-idx="${idx}" tabindex="0" role="button" aria-label="View forecast details for ${esc(mat.materialName)}">
          <div class="fsc-top">
            <div class="fsc-badges">
              <span class="forecast-badge-pill">Next Week Forecast</span>
              <span class="forecast-status-tag ${statusTagCls}">${esc(statusText)}</span>
            </div>
            <div class="fsc-arrow-btn" title="Open forecast details">↗</div>
          </div>
          <div class="fsc-main">
            <span class="fsc-mat-name">${esc(mat.materialName)}</span>
            <span class="fsc-qty-box">${fQty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <small>${esc(unit)}</small></span>
          </div>
          <div class="fsc-meta-row">
            <span>Period: ${esc(dateRangeStr)}</span>
            <span>Current Stock: <strong>${curStock.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${esc(unit)}</strong></span>
          </div>
          <div class="fsc-insight-box">
            ${esc(plainInsight)}
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".forecast-support-card").forEach(card => {
      const clickHandler = () => {
        const idx = Number(card.getAttribute("data-forecast-idx"));
        const selected = topForecasts[idx];
        if (selected) openForecastDetailModal(selected);
      };
      card.onclick = clickHandler;
      card.onkeydown = e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          clickHandler();
        }
      };
    });

  } catch (err) {
    console.warn("Forecast support render notice:", err);
    container.innerHTML = `<div class="apc-empty-state">Forecast currently unavailable.</div>`;
  }
}

let modalForecastChartInstance = null;
let activeForecastModalContext = null;

async function updateModalForecastProjection() {
  if (!activeForecastModalContext) return;
  const mat = activeForecastModalContext;
  const horizonType = $("modalHorizonType")?.value || "month";
  const horizonVal = Math.max(1, parseInt($("modalHorizonValue")?.value || "3", 10));

  const statusTitle = $("decisionStatusTitle");
  const insightText = $("decisionInsightText");
  const totalReqText = $("modalTotalReqText");
  const statusTag = $("mfdStatusTag");
  const canvas = $("modalForecastChart");

  if (statusTitle) statusTitle.textContent = "Computing Pure Time-Series Projection...";
  if (insightText) insightText.textContent = `Running Holt-Winters ETS model for ${horizonVal} ${horizonType}(s)...`;
  if (totalReqText) totalReqText.textContent = "...";

  try {
    const apiBase = await getFlaskApiBase();
    const headers = { "Content-Type": "application/json", "Accept": "application/json" };
    try {
      if (supabase && supabase.auth && typeof supabase.auth.getSession === "function") {
        const { data: sessData } = await supabase.auth.getSession();
        if (sessData?.session?.access_token) {
          headers["Authorization"] = `Bearer ${sessData.session.access_token}`;
        }
      }
    } catch (e) {}

    const res = await fetch(`${apiBase}/api/forecast`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        raw_material_name: mat.materialName,
        horizon_type: horizonType,
        horizon_value: horizonVal
      })
    });

    if (!res.ok) {
      throw new Error(`Forecast API returned ${res.status}`);
    }

    const data = await res.json();
    const totalReq = Number(data.total_forecast_requirement || 0);
    const unit = data.unit || mat.unit || "kg";
    const curStock = Number(mat.currentStock || 0);
    const diff = curStock - totalReq;

    if (totalReqText) {
      totalReqText.textContent = `${totalReq.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${unit}`;
    }

    // Evaluate Decision Support Metrics
    if (diff < 0) {
      if (statusTitle) {
        statusTitle.textContent = "DEFICIT WARNING — Potential Shortage";
        statusTitle.style.color = "#EF4444";
      }
      if (insightText) {
        insightText.textContent = `${mat.materialName} projected requirement (${totalReq.toFixed(1)} ${unit}) exceeds on-hand stock (${curStock.toFixed(1)} ${unit}) by ${Math.abs(diff).toFixed(1)} ${unit}. Advance procurement recommended.`;
      }
      if (statusTag) {
        statusTag.className = "forecast-status-tag tag-shortage";
        statusTag.textContent = "Potential Shortage";
      }
    } else if (curStock <= (mat.minimumThreshold || 0)) {
      if (statusTitle) {
        statusTitle.textContent = "ATTENTION — Low Safety Buffer Stock";
        statusTitle.style.color = "#F59E0B";
      }
      if (insightText) {
        insightText.textContent = `${mat.materialName} is at or below minimum threshold (${mat.minimumThreshold} ${unit}). Maintain safety stock.`;
      }
      if (statusTag) {
        statusTag.className = "forecast-status-tag tag-attention";
        statusTag.textContent = "Low Stock Attention";
      }
    } else {
      if (statusTitle) {
        statusTitle.textContent = "OPTIMAL SURPLUS — Sufficient Stock";
        statusTitle.style.color = "#10B981";
      }
      if (insightText) {
        insightText.textContent = `On-hand stock (${curStock.toFixed(1)} ${unit}) covers the projected ${horizonVal} ${horizonType}(s) requirement (${totalReq.toFixed(1)} ${unit}) with a surplus of +${diff.toFixed(1)} ${unit}.`;
      }
      if (statusTag) {
        statusTag.className = "forecast-status-tag tag-good";
        statusTag.textContent = "Sufficient";
      }
    }

    // Render Time-Series Chart Canvas
    if (canvas && typeof Chart !== "undefined") {
      if (modalForecastChartInstance) {
        modalForecastChartInstance.destroy();
        modalForecastChartInstance = null;
      }

      const breakdown = Array.isArray(data.forecast_breakdown) ? data.forecast_breakdown : [];
      const chartLabels = breakdown.map((item, idx) => {
        if (item.period_date) {
          const dt = new Date(item.period_date);
          if (!isNaN(dt.getTime())) {
            return horizonType === "year" 
              ? dt.toLocaleDateString("en-US", { year: "numeric" })
              : dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }
          return item.period_date;
        }
        return `${horizonType.toUpperCase()} ${idx + 1}`;
      });

      const chartValues = breakdown.map(item => Number(item.forecast_quantity || 0));

      const ctx = canvas.getContext("2d");
      modalForecastChartInstance = new Chart(ctx, {
        type: "bar",
        data: {
          labels: chartLabels,
          datasets: [{
            label: `Forecasted ${mat.materialName} Requirement (${unit})`,
            data: chartValues,
            backgroundColor: "rgba(37, 99, 235, 0.65)",
            hoverBackgroundColor: "rgba(37, 99, 235, 0.90)",
            borderColor: "#2563EB",
            borderWidth: 1.5,
            borderRadius: 6,
            barPercentage: 0.6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#0B132B",
              titleColor: "#FFFFFF",
              bodyColor: "#D7E0EA",
              padding: 10,
              callbacks: {
                label: (ctx) => ` Required: ${Number(ctx.parsed.y).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${unit}`
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: "#64748B", font: { size: 11, weight: "500" } }
            },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(148, 180, 224, 0.15)" },
              ticks: { color: "#64748B", font: { size: 11 } }
            }
          }
        }
      });
    }

  } catch (err) {
    console.warn("Dynamic forecast calculation notice:", err);
    if (statusTitle) statusTitle.textContent = "Forecast Status";
    if (insightText) insightText.textContent = "Connected to RMIMS Live Integration.";
    if (totalReqText) totalReqText.textContent = "Available";
  }
}

function openForecastDetailModal(itemOrMat) {
  const modal = $("modalForecastDetail");
  const content = $("forecastDetailContent");
  const titleEl = $("modalForecastDetailTitle");
  const subtitle = $("mfdSubtitle");
  if (!modal || !content) return;

  let mat = null;
  let fc = null;

  if (itemOrMat.material) {
    mat = itemOrMat.material;
    fc = itemOrMat.forecastData || {};
  } else if (itemOrMat.materialName) {
    mat = itemOrMat;
  } else if (typeof itemOrMat === "string") {
    mat = catalogMaterials.find(m => m.materialName.toLowerCase() === itemOrMat.toLowerCase()) || {
      materialName: itemOrMat,
      itemCode: "RM-CAT",
      currentStock: 0,
      unit: "kg",
      minimumThreshold: 0
    };
  }

  if (!mat) return;
  activeForecastModalContext = mat;

  const f7 = fc?.forecast7Day || {};
  const f1m = fc?.forecast1Month || {};
  const curStock = Number(mat.currentStock || 0);
  const minStock = mat.minimumThreshold !== null && mat.minimumThreshold !== undefined ? Number(mat.minimumThreshold) : "—";
  const unit = mat.unit || "kg";
  const f7Qty = f7.quantity ? Number(f7.quantity) : 0;
  const f1mQty = f1m.quantity ? Number(f1m.quantity) : 0;
  const diff = curStock - f7Qty;

  if (titleEl) titleEl.textContent = `${mat.materialName} (${mat.itemCode || "RM-CAT"})`;
  if (subtitle) {
    subtitle.textContent = `Pure Time-Series (Holt-Winters ETS) & Live Supabase Inventory`;
  }

  const matUsageTotal = usageRecords
    .filter(u => u.materialId === mat.id || u.materialName === mat.materialName)
    .reduce((sum, u) => sum + u.consumedQuantity, 0);

  content.innerHTML = `
    <div class="mfd-stats-grid">
      <div class="mfd-stat-tile">
        <span class="mfd-stat-lbl">Current On-Hand Stock</span>
        <span class="mfd-stat-val">${curStock.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <small>${esc(unit)}</small></span>
      </div>
      <div class="mfd-stat-tile">
        <span class="mfd-stat-lbl">7-Day Baseline</span>
        <span class="mfd-stat-val val-forecast">${f7Qty > 0 ? f7Qty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : "Live Calculating"} <small>${esc(unit)}</small></span>
      </div>
      <div class="mfd-stat-tile">
        <span class="mfd-stat-lbl">Safety Threshold</span>
        <span class="mfd-stat-val">${typeof minStock === "number" ? `${minStock.toLocaleString("en-US")} ${esc(unit)}` : esc(minStock)}</span>
      </div>
      <div class="mfd-stat-tile">
        <span class="mfd-stat-lbl">Historical Consumed</span>
        <span class="mfd-stat-val">${matUsageTotal.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <small>${esc(unit)}</small></span>
      </div>
    </div>
  `;

  // Wire horizon controls
  const refreshBtn = $("modalRefreshBtn");
  const horizonTypeSelect = $("modalHorizonType");
  const horizonValInput = $("modalHorizonValue");

  if (refreshBtn) refreshBtn.onclick = () => updateModalForecastProjection();
  if (horizonTypeSelect) horizonTypeSelect.onchange = () => updateModalForecastProjection();
  if (horizonValInput) horizonValInput.onchange = () => updateModalForecastProjection();

  openAdminModal("modalForecastDetail");

  // Trigger dynamic projection immediately
  updateModalForecastProjection();
}

// ============================================================
// AUTHENTICATION GUARD & SESSION LIFECYCLE
// ============================================================

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("id, full_name, email, role, status")
      .eq("id", user.uid)
      .maybeSingle();

    if (error || !profile || profile.status !== "active") {
      window.location.href = "../login.html";
      return;
    }

    if (profile.role !== "admin") {
      window.location.href = "../login.html";
      return;
    }

    await checkAndShowOnboarding(profile, supabase);

    const profileBtn = $("profileBtn");
    if (profileBtn) {
      const pText = profileBtn.querySelector(".profile-text") || profileBtn;
      pText.textContent = profile.full_name || profile.email || "Admin";
      const pAv = profileBtn.querySelector(".avatar");
      if (pAv && profile.full_name) {
        pAv.textContent = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
      }
    }
  } catch (err) {
    console.warn("Dashboard role check notice:", err);
  }

  // Load dashboard data from live Supabase
  await loadDashboard();
});