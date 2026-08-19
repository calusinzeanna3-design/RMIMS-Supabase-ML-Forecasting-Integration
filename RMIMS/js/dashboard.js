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

    // Populate category dropdown for Modal 2
    populateModalCategories();

    // Initialize & render the Raw Materials Trend Chart
    populateTrendMaterialSelect();
    setupTrendControls();
    await renderRawMaterialsTrendChart();

  } catch (err) {
    console.error("Dashboard initialization error:", err);
    toast("Dashboard load error: " + err.message, "bad");
  } finally {
    dashboardLoading = false;
  }
}

// ============================================================
// CARD 1: RAW MATERIALS (LIVE AVAILABLE COUNT & HOVER TOOLTIP)
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

  // Tooltip content
  const ahtTotal = $("ahtTotalCatalog");
  if (ahtTotal) ahtTotal.textContent = totalCatalog;

  const ahtAvail = $("ahtAvailable");
  if (ahtAvail) ahtAvail.textContent = availableCount;

  const ahtOos = $("ahtOutOfStock");
  if (ahtOos) ahtOos.textContent = outOfStockCount;

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

  tbody.innerHTML = filtered.map(r => `
    <tr>
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
    if (oosList.length > 0) {
      fullSumEl.innerHTML = `
        <div class="cfs-title text-warn">${oosList.length} raw materials need attention</div>
        <div class="cfs-list">${oosList.map(m => `<span class="cfs-item"><strong>${esc(m.materialName)}</strong> (0 ${esc(m.unit)})</span>`).join(", ")}</div>
      `;
    } else {
      fullSumEl.innerHTML = `<div class="cfs-meta text-good">All catalog materials have healthy inventory standing.</div>`;
    }
  }

  startCard3Ticker();

  // Hover & click interactions
  const cardEl = $("cardOutOfStock");
  if (cardEl) {
    cardEl.onmouseenter = () => {
      card3IsHovered = true;
      cardEl.classList.add("hovered-expanded");
    };
    cardEl.onmouseleave = () => {
      card3IsHovered = false;
      cardEl.classList.remove("hovered-expanded");
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

  container.innerHTML = oosList.map(m => `
    <div class="amp-oos-tile">
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

async function fetchForecastDataForMaterial(matNameOrId) {
  try {
    const { data: sessData } = await auth.auth.getSession();
    const headers = { "Accept": "application/json" };
    if (sessData?.session?.access_token) {
      headers["Authorization"] = `Bearer ${sessData.session.access_token}`;
    }
    const encoded = encodeURIComponent(matNameOrId);
    const res = await fetch(`${FLASK_API_BASE}/api/ml/forecast/${encoded}/inventory`, {
      method: "GET",
      headers
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.status === "success" ? data : null;
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

  // Filter usage records
  let filteredUsage = usageRecords;
  if (selectedId !== "all") {
    filteredUsage = usageRecords.filter(u => u.materialId === selectedId);
  } else {
    // For "all", maintain unit safety by taking primary unit records (kg)
    filteredUsage = usageRecords.filter(u => (u.unit || "").toLowerCase() === "kg");
  }

  // Generate date labels and data buckets based on granularity
  let labels = [];
  let consumedData = [];
  let forecastData = [];

  const now = new Date();
  const currentMonthIdx = now.getMonth();
  const currentYear = now.getFullYear();

  // Fetch live ML forecast
  let forecastResult = null;
  if (selectedMat) {
    forecastResult = await fetchForecastDataForMaterial(selectedMat.materialName);
  } else if (catalogMaterials.length > 0) {
    // For 'All', query representative material forecast
    forecastResult = await fetchForecastDataForMaterial("Sugar") || await fetchForecastDataForMaterial(catalogMaterials[0].materialName);
  }

  const f7Qty = forecastResult?.forecast7Day?.quantity ? Number(forecastResult.forecast7Day.quantity) : null;
  const f1mQty = forecastResult?.forecast1Month?.quantity ? Number(forecastResult.forecast1Month.quantity) : null;

  if (currentTrendGranularity === "weekly") {
    labels = ["Week 1 (1-7)", "Week 2 (8-14)", "Week 3 (15-21)", "Week 4 (22+)"];
    consumedData = [0, 0, 0, 0];

    filteredUsage.forEach(u => {
      if (!u.usageDate) return;
      const d = new Date(u.usageDate);
      if (d.getMonth() === currentMonthIdx && d.getFullYear() === currentYear) {
        const day = d.getDate();
        if (day <= 7) consumedData[0] += u.consumedQuantity;
        else if (day <= 14) consumedData[1] += u.consumedQuantity;
        else if (day <= 21) consumedData[2] += u.consumedQuantity;
        else consumedData[3] += u.consumedQuantity;
      }
    });

    if (f1mQty !== null) {
      const weeklyForecast = f1mQty / 4;
      forecastData = [
        Number(weeklyForecast.toFixed(2)),
        Number(weeklyForecast.toFixed(2)),
        Number(weeklyForecast.toFixed(2)),
        Number(weeklyForecast.toFixed(2))
      ];
    } else {
      forecastData = [null, null, null, null];
    }

  } else if (currentTrendGranularity === "monthly") {
    labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    consumedData = new Array(12).fill(0);

    filteredUsage.forEach(u => {
      if (!u.usageDate) return;
      const d = new Date(u.usageDate);
      if (d.getFullYear() === currentYear) {
        const m = d.getMonth();
        if (m >= 0 && m < 12) {
          consumedData[m] += u.consumedQuantity;
        }
      }
    });

    forecastData = new Array(12).fill(null);
    if (f1mQty !== null) {
      for (let i = currentMonthIdx; i < 12; i++) {
        forecastData[i] = Number(f1mQty.toFixed(2));
      }
    }

  } else {
    // "general": Show actual recorded dates or recent 7 calendar days
    const dateMap = new Map();
    filteredUsage.forEach(u => {
      if (!u.usageDate) return;
      dateMap.set(u.usageDate, (dateMap.get(u.usageDate) || 0) + u.consumedQuantity);
    });

    let distinctDates = Array.from(dateMap.keys()).sort();
    if (distinctDates.length === 0) {
      // Create past 7 calendar days
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        distinctDates.push(d.toISOString().split("T")[0]);
      }
    }

    labels = distinctDates.map(ds => {
      const dt = new Date(ds + "T00:00:00");
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });

    consumedData = distinctDates.map(ds => Number((dateMap.get(ds) || 0).toFixed(2)));

    if (f7Qty !== null) {
      const dailyForecast = f7Qty / 7;
      forecastData = distinctDates.map(() => Number(dailyForecast.toFixed(2)));
    } else {
      forecastData = distinctDates.map(() => null);
    }
  }

  // Update Footer Meta text
  const metaEl = $("trendFooterMeta");
  if (metaEl) {
    if (forecastResult) {
      metaEl.textContent = `Showing live ${matDisplayName} disbursements & AutoReg ML forecast (${primaryUnit})`;
    } else {
      metaEl.textContent = `Showing live ${matDisplayName} disbursements (Forecast connecting to ML service)`;
    }
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
          label: "Consumed",
          data: consumedData,
          borderColor: "#10B981",
          backgroundColor: "rgba(16, 185, 129, 0.10)",
          borderWidth: 2.6,
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: "#10B981",
          pointBorderColor: "#FFFFFF",
          pointBorderWidth: 2
        },
        {
          label: "Forecasted Raw Materials",
          data: forecastData,
          borderColor: "#3B82F6",
          borderDash: [6, 6],
          backgroundColor: "rgba(59, 130, 246, 0.06)",
          borderWidth: 2.2,
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: "#3B82F6",
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
          borderColor: "rgba(255, 255, 255, 0.16)",
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          usePointStyle: true,
          callbacks: {
            title: items => items[0]?.label || "",
            beforeBody: () => `Material: ${matDisplayName}`,
            label: context => {
              const val = context.parsed.y;
              if (val === null || val === undefined || isNaN(val)) {
                return ` ${context.dataset.label}: Forecast unavailable`;
              }
              return ` ${context.dataset.label}: ${val.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ${primaryUnit}`;
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
            font: { family: "Inter", size: 11, weight: 500 }
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
            callback: v => `${v.toLocaleString("en-US")} ${primaryUnit}`
          }
        }
      }
    },
    plugins: [crosshairPlugin]
  });
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