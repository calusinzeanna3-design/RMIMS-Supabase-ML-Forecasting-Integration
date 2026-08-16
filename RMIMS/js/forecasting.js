import { auth, supabase } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

const $ = (id) => document.getElementById(id);

let materials = [];
let currentResult = null;
let chart = null;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function showMessage(message, type = "error") {
  const el = $("forecastMessage");
  if (!el) return;
  el.textContent = message;
  el.className = `forecast-message ${type}`;
  el.hidden = false;
}

function clearMessage() {
  const el = $("forecastMessage");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

function setServiceStatus(label, state = "") {
  const badge = $("serviceBadge");
  if (!badge) return;
  badge.className = `forecast-service-badge ${state}`;
  badge.innerHTML = `<span class="service-dot"></span><span>${esc(label)}</span>`;
}

function kg(value, unit) {
  const n = Number(value) || 0;
  const u = String(unit || "").trim().toLowerCase();
  if (["g", "gram", "grams"].includes(u)) return n / 1000;
  return n;
}

function fmt(value, digits = 2) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatPeriod(start, end) {
  if (!start || !end) return "Waiting for forecast";
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${start} – ${end}`;
  const opts = { year: "numeric", month: "short", day: "numeric" };
  return `${a.toLocaleDateString("en-US", opts)} – ${b.toLocaleDateString("en-US", opts)}`;
}

async function getSession() {
  const { data, error } = await auth.auth.getSession();
  if (error) throw error;
  if (!data?.session?.access_token) throw new Error("Your session has expired. Please log in again.");
  return data.session;
}

async function checkMLService() {
  try {
    const response = await fetch("http://127.0.0.1:5000/api/ml/status");
    if (!response.ok) throw new Error("ML service unavailable");
    const data = await response.json();
    setServiceStatus(`${data.model || "Time-Series"} Forecast`, "connected");
  } catch (error) {
    setServiceStatus("ML service offline", "error");
  }
}

async function loadMaterials() {
  const select = $("materialSelect");
  try {
    const { data, error } = await supabase
      .from("materials")
      .select("id, material_name, unit, quantity, minimum_threshold, status")
      .order("material_name", { ascending: true });

    if (error) throw error;
    materials = data || [];

    if (!materials.length) {
      select.innerHTML = `<option value="">No raw materials available</option>`;
      return;
    }

    select.innerHTML = materials.map((m) =>
      `<option value="${esc(m.id)}">${esc(m.material_name)}</option>`
    ).join("");

    const sugar = materials.find((m) => String(m.material_name || "").trim().toLowerCase() === "sugar");
    if (sugar) select.value = sugar.id;
  } catch (error) {
    select.innerHTML = `<option value="">Unable to load materials</option>`;
    showMessage("Unable to load raw materials from Supabase.");
    console.error("Forecasting materials load failed:", error);
  }
}

async function loadHistoricalConsumption(material) {
  const { data, error } = await supabase
    .from("usage_records")
    .select("material_id, material_name, used_quantity, unit, usage_date, created_at")
    .or(`material_id.eq.${material.id},material_name.ilike.${material.material_name}`)
    .order("usage_date", { ascending: true });

  if (error) throw error;

  return (data || [])
    .filter((r) => r.used_quantity !== null && (r.usage_date || r.created_at))
    .map((r) => ({
      date: r.usage_date || r.created_at,
      quantity: Number(r.used_quantity) || 0,
      unit: r.unit || material.unit
    }));
}

async function requestForecast(material) {
  if (!material) {
    throw new Error("Please select a raw material.");
  }

  const materialName = String(
    material.material_name || ""
  ).trim();

  if (!materialName) {
    throw new Error("The selected raw material has no valid name.");
  }

  const session = await getSession();

  if (!session || !session.access_token) {
    throw new Error(
      "Your Supabase session is unavailable. Please log in again."
    );
  }

  /*
   * Encode the material name so names containing spaces,
   * such as "White Sugar" or "Butter or Margarine",
   * are safe inside the URL.
   */
  const encodedMaterialName = encodeURIComponent(
    materialName
  );

  const response = await fetch(
    `http://127.0.0.1:5000/api/ml/forecast/${encodedMaterialName}/inventory`,
    {
      method: "GET",

      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "Accept": "application/json"
      }
    }
  );

  const result = await response.json().catch(
    () => ({})
  );

  if (!response.ok) {

    if (
      response.status === 401 &&
      String(
        result.error || ""
      ).toLowerCase().includes("jwt")
    ) {

      throw new Error(
        "Your Supabase session has expired. Please refresh the page or log in again."
      );
    }

    throw new Error(
      result.error ||
      `Forecast request failed (${response.status}).`
    );
  }

  return result;
}

function renderDetails(result) {
  const current = result?.current_inventory || {};
  const forecast = result?.forecast || {};
  const comparison = result?.comparison || {};
  const decision = comparison.decision_status || "No decision available";

  $("forecastPeriodValue").textContent = formatPeriod(forecast.period_start, forecast.period_end);

  $("forecastDetails").innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><span>Raw Material</span><strong>${esc(result.raw_material_name || "—")}</strong></div>
      <div class="detail-item"><span>Forecast Model</span><strong>${esc(forecast.model || "Time-Series")}</strong></div>
      <div class="detail-item"><span>Current Inventory</span><strong>${fmt(current.quantity)} ${esc(current.unit || "")}</strong></div>
      <div class="detail-item"><span>Normalized Inventory</span><strong>${fmt(comparison.inventory_quantity_kg)} KG</strong></div>
      <div class="detail-item"><span>Forecast Requirement</span><strong>${fmt(forecast.quantity)} ${esc(forecast.unit || "KG")}</strong></div>
      <div class="detail-item"><span>Difference</span><strong>${fmt(comparison.difference_kg)} KG</strong></div>
      <div class="detail-item"><span>Forecast Period</span><strong>${esc(formatPeriod(forecast.period_start, forecast.period_end))}</strong></div>
      <div class="detail-item detail-decision"><span>Decision</span><strong>${esc(decision)}</strong></div>
    </div>
  `;

  $("view3dBtn").disabled = false;
}

function renderDecisionSummary(result) {
  const decision = String(result?.comparison?.decision_status || "").toLowerCase();
  $("shortageCount").textContent = decision.includes("shortage") ? "1" : "0";
  $("sufficientCount").textContent = decision.includes("sufficient") ? "1" : "0";
  $("excessCount").textContent = decision.includes("excess") ? "1" : "0";
}

function renderForecastMaterialList(result) {
  const list = $("forecastMaterialsList");
  const forecast = result?.forecast || {};
  const comparison = result?.comparison || {};
  const name = result?.raw_material_name || "Sugar";

  list.innerHTML = `
    <div class="forecast-material-item">
      <div>
        <strong>${esc(name)}</strong>
        <small>${esc(comparison.decision_status || "Forecast generated")}</small>
      </div>
      <div class="forecast-material-value">${fmt(forecast.quantity)} ${esc(forecast.unit || "KG")}</div>
    </div>
  `;
}

function renderChart(history, result) {
  const empty = $("chartEmptyState");
  const wrap = $("forecastChartWrap");

  if (!history.length) {
    if (chart) { chart.destroy(); chart = null; }
    wrap.hidden = true;
    empty.hidden = false;
    empty.innerHTML = `<div class="empty-state"><strong>No historical consumption data available.</strong><span>The forecast is still generated from the trained model, but no recorded consumption history is available to display for this material.</span></div>`;
    return;
  }

  empty.hidden = true;
  wrap.hidden = false;

  const labels = history.map((r) => new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  const historyValues = history.map((r) => kg(r.quantity, r.unit));
  const forecastValue = Number(result?.forecast?.quantity) || 0;
  const forecastEnd = result?.forecast?.period_end;

  labels.push(forecastEnd ? new Date(`${forecastEnd}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Forecast");

  const historicalSeries = [...historyValues, null];
  const forecastSeries = historyValues.map(() => null);
  forecastSeries.push(forecastValue);

  const ctx = $("forecastChart").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Historical Consumption (KG)",
          data: historicalSeries,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,.08)",
          tension: .32,
          borderWidth: 3,
          pointRadius: 3,
          fill: false
        },
        {
          label: "Forecast (KG)",
          data: forecastSeries,
          borderColor: "#159447",
          backgroundColor: "rgba(21,148,71,.08)",
          tension: .25,
          borderWidth: 3,
          pointRadius: 5,
          borderDash: [7, 5],
          spanGaps: false,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "KG" }, grid: { color: "rgba(120,144,128,.12)" } },
        x: { grid: { display: false } }
      }
    }
  });
}

async function generateForecast() {
  clearMessage();
  const select = $("materialSelect");
  const material = materials.find((m) => String(m.id) === String(select.value));
  const btn = $("generateForecastBtn");

  btn.disabled = true;
  btn.textContent = "Generating...";

  try {
    const [result, history] = await Promise.all([
      requestForecast(material),
      loadHistoricalConsumption(material)
    ]);

    currentResult = result;
    window.__rmimsForecastResult = result;

    renderDetails(result);
    renderDecisionSummary(result);
    renderForecastMaterialList(result);
    renderChart(history, result);

    showMessage("AI-based Time-Series forecast generated successfully from the Flask ML service.", "success");
    console.log("AI-BASED FORECAST RESULT:", result);
  } catch (error) {
    console.error("AI-based forecasting failed:", error);
    showMessage(error.message || "Unable to generate the forecast.", "error");
    $("view3dBtn").disabled = true;
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate Forecast";
  }
}

function open3DResult() {
  if (!currentResult) return;
  const name = encodeURIComponent(currentResult.raw_material_name || "Sugar");
  window.location.href = `dashboard.html?openForecastResult=${name}`;
}

async function init() {
  console.log("FORECASTING INIT STARTED");

  setServiceStatus("Checking ML service");

  try {
    await Promise.all([
      loadMaterials(),
      checkMLService()
    ]);

    console.log("FORECASTING INIT COMPLETED");

    $("generateForecastBtn")?.addEventListener(
      "click",
      generateForecast
    );

    $("view3dBtn")?.addEventListener(
      "click",
      open3DResult
    );

  } catch (error) {
    console.error(
      "FORECASTING INIT FAILED:",
      error
    );

    showMessage(
      "Unable to initialize forecasting.",
      "error"
    );
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }
  try {
    const { data: profile, error } = await supabase
      .from("users")
      .select("role,status")
      .eq("id", user.uid)
      .maybeSingle();

    if (error) throw error;
    if (!profile || profile.status !== "active") {
      window.location.href = "../login.html";
      return;
    }
    if (profile.role !== "admin") {
      window.location.href = "../user/dashboard.html";
      return;
    }
    await init();
  } catch (error) {
    console.error("Forecasting role check failed:", error);
    showMessage("Unable to verify your RMIMS account. Please refresh or sign in again.");
  }
});
