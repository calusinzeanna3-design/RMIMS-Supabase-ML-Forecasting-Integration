// Admin Dashboard — current RMIMS base.
// Dashboard-only visual result interaction. Existing inventory/usage data flow is preserved.

import { auth, db } from "../supabase/supabase-config.js";
import { collection, getDocs, doc, getDoc } from "../supabase/db-compat.js";
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


// ============================================================
// TOAST
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

    setTimeout(
      () => el.remove(),
      260
    );

  }, 3000);

}


// ============================================================
// INVENTORY STATUS
// ============================================================

function status(m) {

  const q =
    Number(m.quantity) || 0;

  const min =
    Number(m.minimumThreshold) || 0;

  if (q <= 0)
    return "Out of Stock";

  if (
    m.status === "Critical" ||
    q < min
  )
    return "Low Stock";

  return "Available";

}


// ============================================================
// LOAD DASHBOARD
// ============================================================

async function loadDashboard() {

  try {

    const [ms, us, rs] =
      await Promise.all([

        getDocs(
          collection(
            db,
            "materials"
          )
        ),

        getDocs(
          collection(
            db,
            "usageRecords"
          )
        ),

        getDocs(
          collection(
            db,
            "stockReceipts"
          )
        )

      ]);


    const materials =
      ms.docs.map(
        d => ({
          id: d.id,
          ...d.data()
        })
      );


    const usage =
      us.docs.map(
        d => ({
          id: d.id,
          ...d.data()
        })
      );


    const receipts =
      rs.docs.map(
        d => ({
          id: d.id,
          ...d.data()
        })
      );


    const totalMat = materials.length;
    const availMat = materials.filter(m => status(m) === "Available").length;
    const lowMat = materials.filter(m => status(m) === "Low Stock").length;
    const outMat = materials.filter(m => status(m) === "Out of Stock").length;

    if ($("dashTotalMaterials")) $("dashTotalMaterials").textContent = totalMat;
    if ($("dashAvailable")) $("dashAvailable").textContent = availMat;
    if ($("dashLowStock")) $("dashLowStock").textContent = lowMat;
    if ($("dashOutOfStock")) $("dashOutOfStock").textContent = outMat;

    renderDashConsumptionChart(usage);
    renderDashForecastChart();

    // Load live Forecast summary for Dashboard Priority #2
    const forecastBox = $("dashForecastAnalytics");
    if (forecastBox) {
      fetch("http://127.0.0.1:5000/api/ml/status")
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            forecastBox.innerHTML = `
              <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 180px; padding: 12px; background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 10px;">
                  <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #166534;">7-Day Requirement</span>
                  <div style="font-size: 20px; font-weight: 800; color: #14532D; margin-top: 2px;">Active (${data.total_models || 30} Raw Materials)</div>
                  <small style="color: #15803D;">Weekly Operational Forecast Active</small>
                </div>
                <div style="flex: 1; min-width: 180px; padding: 12px; background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 10px;">
                  <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #1E40AF;">1-Month Aggregate</span>
                  <div style="font-size: 20px; font-weight: 800; color: #1E3A8A; margin-top: 2px;">4-Week Expected Horizon</div>
                  <small style="color: #2563EB;">Monthly Planning Horizon</small>
                </div>
              </div>`;
          } else {
            forecastBox.innerHTML = `<div class="inline-notice warning"><span>Forecast information is temporarily unavailable.</span></div>`;
          }
        })
        .catch(() => {
          forecastBox.innerHTML = `<div class="inline-notice warning"><span>Forecast information is temporarily unavailable.</span></div>`;
        });
    }

    // ========================================================
    // RECENT ACTIVITIES (COMPACT FEED)
    // ========================================================

    const events = [

      ...receipts.map(
        r => ({
          date:
            r.createdAt ||
            r.receivedDate,

          type:
            "Received",

          material:
            r.materialName,

          qty:
            r.receivedQuantity,

          unit:
            r.unit
        })
      ),

      ...usage.map(
        u => ({
          date:
            u.createdAt ||
            u.usageDate,

          type:
            u.productName
              ? "Used"
              : "Consumed",

          material:
            u.materialName,

          qty:
            u.usedQuantity,

          unit:
            u.unit,

          product:
            u.productName
        })
      )

    ]
      .sort(
        (a, b) =>
          new Date(
            b.date || 0
          ) -
          new Date(
            a.date || 0
          )
      )
      .slice(0, 6);


    if ($("activitiesCount")) $("activitiesCount").textContent = events.length;


    $("activityFeed").innerHTML =
      events.length

        ? events.map(
            e => `

              <button
                type="button"
                class="activity-row"
              >

                <span
                  class="activity-dot"
                ></span>

                <span
                  class="activity-main"
                >

                  <strong>
                    ${esc(e.type)}
                    —
                    ${esc(e.material)}
                  </strong>

                  <small>
                    ${
                      e.product
                        ? `For ${esc(e.product)} · `
                        : ""
                    }

                    ${esc(e.qty)}
                    ${esc(e.unit || "")}
                  </small>

                </span>

                <span
                  class="activity-time"
                >
                  ${
                    e.date
                      ? esc(
                          new Date(
                            e.date
                          ).toLocaleDateString()
                        )
                      : "—"
                  }
                </span>

              </button>

            `
          ).join("")

        : `

          <div class="empty-state">

            <strong>
              No recent activity
            </strong>

            <span>
              Inventory activity will appear here
              after records are added.
            </span>

          </div>

        `;


    let dashConsumptionChartInstance = null;
    let dashForecastChartInstance = null;

    function renderDashConsumptionChart(usageRecords) {
      const canvas = $("dashConsumptionChart");
      if (!canvas || typeof Chart === "undefined") return;

      const ctx = canvas.getContext("2d");
      if (dashConsumptionChartInstance) dashConsumptionChartInstance.destroy();

      const dateMap = new Map();
      (usageRecords || []).forEach(u => {
        const dt = u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : (u.usageDate || "Recent");
        const qty = Number(u.usedQuantity || u.quantity || 0);
        dateMap.set(dt, (dateMap.get(dt) || 0) + qty);
      });

      let labels = [...dateMap.keys()].slice(-7);
      let dataPoints = labels.map(k => dateMap.get(k));

      if (!labels.length) {
        const now = new Date();
        labels = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (6 - i));
          return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        });
        dataPoints = [0, 0, 0, 0, 0, 0, 0];
      }

      dashConsumptionChartInstance = new Chart(ctx, {
        type: "line",
        data: {
          labels: labels,
          datasets: [{
            label: "Recorded Consumption",
            data: dataPoints,
            borderColor: "#10B981",
            backgroundColor: "rgba(16, 185, 129, 0.12)",
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointBackgroundColor: "#10B981"
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: "top", labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { mode: "index", intersect: false }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 11 } } },
            y: { beginAtZero: true, ticks: { font: { size: 11 } } }
          }
        }
      });
    }

    function renderDashForecastChart() {
      const canvas = $("dashForecastChart");
      if (!canvas || typeof Chart === "undefined") return;

      const ctx = canvas.getContext("2d");
      if (dashForecastChartInstance) dashForecastChartInstance.destroy();

      fetch("http://127.0.0.1:5000/api/ml/forecast/Sugar/inventory", {
        method: "GET",
        headers: { "Accept": "application/json" }
      })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        let weekValues = [0, 0, 0, 0];
        let materialUnit = "kg";
        if (data) {
          materialUnit = data.unit || "kg";
          const f7 = Number(data.forecast7Day?.quantity || data.forecast?.quantity) || 0;
          const f1m = Number(data.forecast1Month?.quantity) || (f7 * 4);
          if (Array.isArray(data.forecast1Month?.values) && data.forecast1Month.values.length >= 4) {
            weekValues = data.forecast1Month.values.slice(0, 4).map(v => Math.round(Number(v) || 0));
          } else if (f7 > 0) {
            const w1 = Math.round(f7);
            const w2 = Math.round(f7 * 0.98);
            const w3 = Math.round(f7 * 1.02);
            const w4 = Math.max(0, Math.round(f1m - (w1 + w2 + w3)));
            weekValues = [w1, w2, w3, w4];
          }
        }

        dashForecastChartInstance = new Chart(ctx, {
          type: "bar",
          data: {
            labels: ["Week 1", "Week 2", "Week 3", "Week 4"],
            datasets: [{
              label: `Forecast Requirement (${materialUnit})`,
              data: weekValues,
              backgroundColor: ["rgba(59, 130, 246, 0.75)", "rgba(59, 130, 246, 0.85)", "rgba(59, 130, 246, 0.75)", "rgba(59, 130, 246, 0.9)"],
              borderColor: "#2563EB",
              borderWidth: 1,
              borderRadius: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: true, position: "top", labels: { boxWidth: 12, font: { size: 11 } } },
              tooltip: { mode: "index", intersect: false }
            },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 11 } } },
              y: { beginAtZero: true, ticks: { font: { size: 11 } } }
            }
          }
        });
      })
      .catch(() => {
        dashForecastChartInstance = new Chart(ctx, {
          type: "bar",
          data: {
            labels: ["Week 1", "Week 2", "Week 3", "Week 4"],
            datasets: [{
              label: "Expected Requirement (4-Week)",
              data: [0, 0, 0, 0],
              backgroundColor: "rgba(59, 130, 246, 0.4)",
              borderColor: "#2563EB",
              borderWidth: 1
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } }
          }
        });
      });
    }

    // ========================================================
    // CONSUMPTION TOTALS
    // ========================================================

    const totalUsed =
      usage.reduce(
        (s, u) =>
          s +
          (
            Number(
              u.usedQuantity
            ) || 0
          ),
        0
      );


    const totalReceived =
      receipts.reduce(
        (s, r) =>
          s +
          (
            Number(
              r.receivedQuantity
            ) || 0
          ),
        0
      );


    $("consumptionNarrative").textContent =
      usage.length

        ? `${usage.length} consumption record${
            usage.length === 1
              ? ""
              : "s"
          } have been recorded, with ${
            totalUsed.toLocaleString()
          } total quantity used.`

        : "No consumption records have been recorded yet.";


    // ========================================================
    // CONSUMPTION HISTORY
    // ========================================================

    const history =
      usage
        .slice()
        .sort(
          (a, b) =>
            new Date(
              b.usageDate ||
              b.createdAt ||
              0
            ) -
            new Date(
              a.usageDate ||
              a.createdAt ||
              0
            )
        )
        .slice(0, 6);


    $("consumptionHistory").innerHTML =
      history.length

        ? history.map(
            u => `

              <div
                class="history-row"
              >

                <strong>
                  ${esc(
                    u.materialName
                  )}
                </strong>

                <span>
                  -
                  ${esc(
                    u.usedQuantity
                  )}
                  ${esc(
                    u.unit || ""
                  )}
                </span>

              </div>

            `
          ).join("")

        : `

          <div class="empty-state">

            <span>
              No consumption history yet.
            </span>

          </div>

        `;


    // ========================================================
    // SUGAR / LOW STOCK RESULTS
    // ========================================================

    const sugar =
      materials.find(
        m =>
          String(
            m.materialName || ""
          )
            .trim()
            .toLowerCase() ===
          "sugar"
      );


    const resultMaterials = [];


    if (sugar) {

      resultMaterials.push(
        sugar
      );

    }


    low.forEach(m => {

      if (
        !resultMaterials.some(
          x =>
            x.id === m.id
        )
      ) {

        resultMaterials.push(
          m
        );

      }

    });


    $("recommendationChips").innerHTML =
      resultMaterials.length

        ? resultMaterials
            .slice(0, 5)
            .map(
              m => `

                <div
                  class="recommendation-result"
                >

                  <div
                    class="recommendation-result-main"
                  >

                    <span
                      class="recommendation-result-dot"
                    ></span>

                    <span
                      class="recommendation-result-copy"
                    >

                      <strong>
                        ${esc(
                          m.materialName
                        )}
                      </strong>

                      <span>
                        ${esc(
                          status(m)
                        )}
                      </span>

                    </span>

                  </div>


                  <button
                    type="button"
                    class="view-result-btn"
                    data-material-id="${esc(
                      m.id
                    )}"
                    aria-label="View ${esc(
                      m.materialName
                    )} result"
                  >

                    View

                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >

                      <path
                        d="M5 12H19M13 6L19 12L13 18"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />

                    </svg>

                  </button>

                </div>

              `
            )
            .join("")

        : `

          <div
            class="recommendation-result stable-result"
          >

            <div
              class="recommendation-result-main"
            >

              <span
                class="recommendation-result-dot"
              ></span>

              <span
                class="recommendation-result-copy"
              >

                <strong>
                  Inventory looks stable
                </strong>

                <span>
                  No low-stock materials detected.
                </span>

              </span>

            </div>


            <button
              type="button"
              class="view-result-btn"
              data-material-name="Sugar"
            >
              View
            </button>

          </div>

        `;


    // ========================================================
    // SAVE DASHBOARD DATA
    // ========================================================

    window.__rmimsDashboardData = {

      materials,

      usage,

      receipts,

      totalReceived,

      totalUsed

    };


  } catch (err) {

    console.error(err);

    toast(
      "Could not load dashboard data.",
      "error"
    );

  }

}


// ============================================================
// GET MATERIAL RESULT
// ============================================================

function getMaterialResult(material) {

  const data =
    window.__rmimsDashboardData ||
    {};

  const materialId =
    material?.id;

  const materialName =
    String(
      material?.materialName ||
      "Sugar"
    );


  const isSugar =
    materialName
      .trim()
      .toLowerCase() ===
    "sugar";


  // ==========================================================
  // SUGAR — REAL TIME-SERIES ML RESULT
  // ==========================================================

  if (
    isSugar &&
    window.__sugarMLResult
  ) {

    const ml =
      window.__sugarMLResult;


    const inventory =
      ml.current_inventory ||
      {};


    const forecast =
      ml.forecast ||
      {};


    const comparison =
      ml.comparison ||
      {};


    return {

      materialName:
        "Sugar",


      currentStock:
        Number(
          inventory.quantity
        ) || 0,


      minimumStock:
        Number(
          inventory.minimum_threshold
        ) || 0,


      unit:
        inventory.unit ||
        "G",


      inventoryStatus:
        inventory.status ||
        "",


      // ------------------------------------------------------
      // REAL FORECAST
      // ------------------------------------------------------

      forecastQuantity:
        Number(
          forecast.quantity
        ) || 0,


      forecastUnit:
        forecast.unit ||
        "kg",


      forecastPeriodStart:
        forecast.period_start ||
        "",


      forecastPeriodEnd:
        forecast.period_end ||
        "",


      forecastModel:
        forecast.model ||
        "Time-Series",


      // ------------------------------------------------------
      // REAL COMPARISON
      // ------------------------------------------------------

      inventoryQuantityKg:
        Number(
          comparison.inventory_quantity_kg
        ) || 0,


      currentStockKg:
        Number(
          comparison.inventory_quantity_kg
        ) || 0,


      differenceKg:
        Number(
          comparison.difference_kg
        ) || 0,


      decisionStatus:
        comparison.decision_status ||
        "No decision available",


      potentialShortageKg:
        Number(
          comparison.potential_shortage_kg
        ) || 0,


      mlResult:
        true

    };

  }


  // ==========================================================
  // OTHER MATERIALS — EXISTING LOGIC
  // ==========================================================

  const relatedUsage =
    (data.usage || []).filter(
      u =>
        String(
          u.materialId || ""
        ) ===
          String(
            materialId || ""
          )

        ||

        String(
          u.materialName || ""
        )
          .trim()
          .toLowerCase() ===
        materialName
          .trim()
          .toLowerCase()
    );


  const quantities =
    relatedUsage
      .map(
        u =>
          Number(
            u.usedQuantity
          ) || 0
      )
      .filter(
        v => v > 0
      );


  const totalConsumed =
    quantities.reduce(
      (a, b) =>
        a + b,
      0
    );


  const averageUsage =
    quantities.length
      ? totalConsumed /
        quantities.length
      : 0;


  const currentStock =
    Number(
      material?.quantity
    ) || 0;


  const minimumStock =
    Number(
      material?.minimumThreshold
    ) || 0;


  const projectedRequirement =
    averageUsage > 0
      ? averageUsage
      : minimumStock;


  const additionalNeeded =
    Math.max(
      0,
      projectedRequirement -
      currentStock
    );


  return {

    materialName,

    currentStock,

    minimumStock,

    totalConsumed,

    averageUsage,

    projectedRequirement,

    additionalNeeded,

    usageCount:
      quantities.length,

    unit:
      material?.unit ||
      relatedUsage[0]?.unit ||
      "unit",

    mlResult:
      false

  };

}


// ============================================================
// OPEN MATERIAL RESULT
// ============================================================

function openMaterialResult(material) {

  const r =
    getMaterialResult(
      material
    );


  $("recModalTitle").textContent =
    `${r.materialName} — Result`;


  // ==========================================================
  // SUGAR — REAL TIME-SERIES ML RESULT
  // ==========================================================

  if (r.mlResult) {

    $("recModalConfidence").textContent =
      `${r.forecastModel} Forecast · ${
        r.forecastPeriodStart
      } to ${
        r.forecastPeriodEnd
      }`;


    // ========================================================
    // CURRENT CONSUMPTION SIGNAL
    // ========================================================

    const dashboardData =
      window.__rmimsDashboardData || {};

    const usage =
      dashboardData.usage || [];

    const sugarUsage =
      usage.filter(
        u =>
          String(
            u.materialName || ""
          )
            .trim()
            .toLowerCase() ===
          "sugar"
      );

    const sugarConsumed =
      sugarUsage.reduce(
        (sum, u) =>
          sum +
          (
            Number(
              u.usedQuantity
            ) || 0
          ),
        0
      );


    const displayUnit =
      r.unit || "G";


    const currentStock =
      Number(
        r.currentStock
      ) || 0;


    const currentStockKg =
      Number(
        r.inventoryQuantityKg
      ) || 0;


    const forecastQuantity =
      Number(
        r.forecastQuantity
      ) || 0;


    const shortage =
      Number(
        r.potentialShortageKg
      ) || 0;


    const difference =
      Number(
        r.differenceKg
      ) || 0;


    const decision =
      r.decisionStatus ||
      "No decision available";


    // ========================================================
    // 3D RESULT VIEW
    // ========================================================

    $("recModalBody").innerHTML = `

      <div class="result-hero">

        <div class="result-hero-orb">

          <span>
            ${esc(
              r.materialName
                .slice(0, 1)
                .toUpperCase()
            )}
          </span>

        </div>


        <div>

          <span class="result-eyebrow">
            RAW MATERIAL RESULT
          </span>


          <h5>
            ${esc(
              r.materialName
            )}
          </h5>


          <p>
            Follow the material from its current
            inventory through consumption to the
            Time-Series forecast and final result.
          </p>

        </div>

      </div>


      <!-- ====================================================
           3D PROCESS
      ===================================================== -->

      <div
        class="process-3d"
        aria-label="${esc(
          r.materialName
        )} inventory process"
      >

        <div class="process-line"></div>


        <!-- INVENTORY -->

        <button
          type="button"
          class="process-node active"
          data-process-step="0"
        >

          <span
            class="process-node-index"
          >
            01
          </span>


          <span
            class="process-node-icon"
          >
            ▣
          </span>


          <strong>
            Inventory
          </strong>


          <small>
  ${currentStockKg.toLocaleString(
    undefined,
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  )}
  KG
</small>

        </button>


        <!-- CONSUMPTION -->

        <button
          type="button"
          class="process-node"
          data-process-step="1"
        >

          <span
            class="process-node-index"
          >
            02
          </span>


          <span
            class="process-node-icon"
          >
            ↘
          </span>


          <strong>
            Consumption
          </strong>


          <small>
            ${sugarConsumed.toLocaleString(
              undefined,
              {
                maximumFractionDigits: 2
              }
            )}
            ${esc(displayUnit)}
          </small>

        </button>


        <!-- FORECAST -->

        <button
          type="button"
          class="process-node"
          data-process-step="2"
        >

          <span
            class="process-node-index"
          >
            03
          </span>


          <span
            class="process-node-icon"
          >
            ◌
          </span>


          <strong>
            Forecast
          </strong>


          <small>
            ${forecastQuantity.toLocaleString(
              undefined,
              {
                maximumFractionDigits: 2
              }
            )}
            ${esc(
              r.forecastUnit
            )}
          </small>

        </button>


        <!-- RESULT -->

        <button
          type="button"
          class="process-node"
          data-process-step="3"
        >

          <span
            class="process-node-index"
          >
            04
          </span>


          <span
            class="process-node-icon"
          >
            ✓
          </span>


          <strong>
            Result
          </strong>


          <small>
            ${
              shortage > 0
                ? `${shortage.toLocaleString(
                    undefined,
                    {
                      maximumFractionDigits: 2
                    }
                  )} KG shortage`
                : "Sufficient"
            }
          </small>

        </button>

      </div>


      <!-- ====================================================
           PROCESS DETAIL
      ===================================================== -->

      <div
        class="process-detail"
        id="processDetail"
      >

        <span
          class="process-detail-label"
        >
          CURRENT INVENTORY
        </span>


        <strong>

          ${currentStock.toLocaleString()}
          ${esc(displayUnit)}

        </strong>


        <p>

          Current ${esc(
            r.materialName
          )} inventory recorded in RMIMS.

        </p>

      </div>


      <!-- ====================================================
           RESULT STATISTICS
      ===================================================== -->

      <div
        class="result-stat-grid"
      >

        <div>

          <span>
            Current Stock
          </span>


          <strong>

            ${currentStock.toLocaleString()}
            ${esc(displayUnit)}

          </strong>

        </div>


        <div>

          <span>
            Forecast
          </span>


          <strong>

            ${forecastQuantity.toLocaleString(
              undefined,
              {
                maximumFractionDigits: 2
              }
            )}

            ${esc(
              r.forecastUnit
            )}

          </strong>

        </div>


        <div>

          <span>
            Forecast Period
          </span>


          <strong>

            ${esc(
              r.forecastPeriodStart
            )}

            –

            ${esc(
              r.forecastPeriodEnd
            )}

          </strong>

        </div>


        <div>

          <span>
            Potential Shortage
          </span>


          <strong>

            ${shortage.toLocaleString(
              undefined,
              {
                maximumFractionDigits: 2
              }
            )}

            KG

          </strong>

        </div>

      </div>


      <!-- ====================================================
           DECISION RESULT
      ===================================================== -->

      <div
        class="result-message"
      >

        <strong>
          ${esc(decision)}
        </strong>


        <span>

          The Time-Series forecast indicates
          a requirement of approximately

          <strong>
            ${forecastQuantity.toLocaleString(
              undefined,
              {
                maximumFractionDigits: 2
              }
            )}
            ${esc(r.forecastUnit)}
          </strong>

          for the forecast period.

          Current ${esc(
            r.materialName
          )} inventory is

          <strong>
            ${currentStockKg.toLocaleString(
              undefined,
              {
                maximumFractionDigits: 4
              }
            )}
            KG
          </strong>.

          ${
            shortage > 0

              ? `This indicates a potential shortage of approximately
                 ${shortage.toLocaleString(
                   undefined,
                   {
                     maximumFractionDigits: 2
                   }
                 )}
                 KG.`

              : "The current inventory is sufficient for the forecasted requirement."
          }

        </span>

      </div>

    `;


    $("recModalOverlay")
      .classList
      .add("open");


    requestAnimationFrame(() => {

      document
        .querySelectorAll(
          ".process-node"
        )
        .forEach(
          node =>
            node.addEventListener(
              "click",
              () =>
                showMLProcessStep(
                  node,
                  r
                )
            )
        );

    });


    return;

  }


  // ==========================================================
  // OTHER MATERIALS — EXISTING RESULT
  // ==========================================================

  $("recModalConfidence").textContent =
    r.usageCount

      ? `${r.usageCount} recorded consumption ${
          r.usageCount === 1
            ? "entry"
            : "entries"
        }`

      : "Using available inventory threshold";


  $("recModalBody").innerHTML = `

    <div class="result-hero">

      <div class="result-hero-orb">

        <span>
          ${esc(
            r.materialName
              .slice(0, 1)
              .toUpperCase()
          )}
        </span>

      </div>


      <div>

        <span class="result-eyebrow">
          RAW MATERIAL RESULT
        </span>


        <h5>
          ${esc(
            r.materialName
          )}
        </h5>


        <p>
          Follow the material from its current
          stock through consumption to the
          requirement result.
        </p>

      </div>

    </div>


    <div
      class="process-3d"
      aria-label="${esc(
        r.materialName
      )} inventory process"
    >

      <div
        class="process-line"
      ></div>


      <button
        type="button"
        class="process-node active"
        data-process-step="0"
      >

        <span
          class="process-node-index"
        >
          01
        </span>

        <span
          class="process-node-icon"
        >
          ▣
        </span>

        <strong>
          Inventory
        </strong>

        <small>
          ${r.currentStock.toLocaleString()}
          ${esc(r.unit)}
        </small>

      </button>


      <button
        type="button"
        class="process-node"
        data-process-step="1"
      >

        <span
          class="process-node-index"
        >
          02
        </span>

        <span
          class="process-node-icon"
        >
          ↘
        </span>

        <strong>
          Consumption
        </strong>

        <small>
          ${r.totalConsumed.toLocaleString()}
          ${esc(r.unit)}
        </small>

      </button>


      <button
        type="button"
        class="process-node"
        data-process-step="2"
      >

        <span
          class="process-node-index"
        >
          03
        </span>

        <span
          class="process-node-icon"
        >
          ◌
        </span>

        <strong>
          Forecast
        </strong>

        <small>
          ${r.projectedRequirement.toLocaleString(
            undefined,
            {
              maximumFractionDigits: 2
            }
          )}
          ${esc(r.unit)}
        </small>

      </button>


      <button
        type="button"
        class="process-node"
        data-process-step="3"
      >

        <span
          class="process-node-index"
        >
          04
        </span>

        <span
          class="process-node-icon"
        >
          ✓
        </span>

        <strong>
          Result
        </strong>

        <small>
          ${r.additionalNeeded.toLocaleString(
            undefined,
            {
              maximumFractionDigits: 2
            }
          )}
          ${esc(r.unit)}
          needed
        </small>

      </button>

    </div>


    <div
      class="process-detail"
      id="processDetail"
    >

      <span
        class="process-detail-label"
      >
        CURRENT INVENTORY
      </span>


      <strong>
        ${r.currentStock.toLocaleString()}
        ${esc(r.unit)}
      </strong>


      <p>
        ${
          r.currentStock <=
          r.minimumStock

            ? "Stock is at or below the minimum threshold and needs attention."

            : "Current stock is above the minimum threshold."
        }
      </p>

    </div>


    <div
      class="result-stat-grid"
    >

      <div>

        <span>
          Current Stock
        </span>

        <strong>
          ${r.currentStock.toLocaleString()}
          ${esc(r.unit)}
        </strong>

      </div>


      <div>

        <span>
          Consumed
        </span>

        <strong>
          ${r.totalConsumed.toLocaleString()}
          ${esc(r.unit)}
        </strong>

      </div>


      <div>

        <span>
          Projected Requirement
        </span>

        <strong>
          ${r.projectedRequirement.toLocaleString(
            undefined,
            {
              maximumFractionDigits: 2
            }
          )}
          ${esc(r.unit)}
        </strong>

      </div>


      <div>

        <span>
          Additional Needed
        </span>

        <strong>
          ${r.additionalNeeded.toLocaleString(
            undefined,
            {
              maximumFractionDigits: 2
            }
          )}
          ${esc(r.unit)}
        </strong>

      </div>

    </div>


    <div
      class="result-message"
    >

      <strong>
        ${esc(
          r.materialName
        )}
        result
      </strong>


      <span>

        ${
          r.additionalNeeded > 0

            ? `Based on the available consumption signal, approximately
               ${r.additionalNeeded.toLocaleString(
                 undefined,
                 {
                   maximumFractionDigits: 2
                 }
               )}
               ${esc(r.unit)}
               may be needed beyond the current stock.`

            : "Current stock is sufficient for the projected requirement based on the available dashboard data."
        }

      </span>

    </div>

  `;


  $("recModalOverlay")
    .classList
    .add("open");


  requestAnimationFrame(() => {

    document
      .querySelectorAll(
        ".process-node"
      )
      .forEach(
        node =>
          node.addEventListener(
            "click",
            () =>
              showProcessStep(
                node,
                r
              )
          )
      );

  });

}


// ============================================================
// ML PROCESS STEP
// ============================================================

function showMLProcessStep(
  node,
  r
) {

  document
    .querySelectorAll(
      ".process-node"
    )
    .forEach(
      n =>
        n.classList.remove(
          "active"
        )
    );


  node.classList.add(
    "active"
  );


  const step =
    Number(
      node.dataset.processStep
    );


  const detail =
    $("processDetail");


  if (!detail)
    return;


  const steps = [

    {

      label:
        "CURRENT INVENTORY",

      value:
        `${r.currentStock} ${esc(
          r.unit
        )}`,

      text:
        `RMIMS currently records ${r.currentStock} ${esc(
          r.unit
        )} of Sugar.`

    },


    {

      label:
        "AI TIME-SERIES FORECAST",

      value:
        `${r.forecastQuantity.toLocaleString(
          undefined,
          {
            maximumFractionDigits: 2
          }
        )} ${esc(
          r.forecastUnit
        )}`,

      text:
        `The Time-Series model forecasts approximately ${r.forecastQuantity.toLocaleString(
          undefined,
          {
            maximumFractionDigits: 2
          }
        )} ${esc(
          r.forecastUnit
        )} from ${esc(
          r.forecastPeriodStart
        )} to ${esc(
          r.forecastPeriodEnd
        )}.`

    },


    {

      label:
        "INVENTORY COMPARISON",

      value:
        `${Math.abs(
          r.differenceKg
        ).toLocaleString(
          undefined,
          {
            maximumFractionDigits: 2
          }
        )} KG`,

      text:
        `Current inventory is ${r.inventoryQuantityKg.toLocaleString(
          undefined,
          {
            maximumFractionDigits: 4
          }
        )} KG compared with the forecasted requirement of ${r.forecastQuantity.toLocaleString(
          undefined,
          {
            maximumFractionDigits: 2
          }
        )} KG.`

    },


    {

      label:
        "DECISION SUPPORT RESULT",

      value:
        esc(
          r.decisionStatus
        ),

      text:
        r.potentialShortageKg > 0

          ? `The forecast indicates a potential shortage of approximately ${r.potentialShortageKg.toLocaleString(
              undefined,
              {
                maximumFractionDigits: 2
              }
            )} KG.`

          : "The current inventory is sufficient for the forecasted requirement."

    }

  ];


  const current =
    steps[step];


  if (!current)
    return;


  detail.innerHTML = `

    <span
      class="process-detail-label"
    >
      ${current.label}
    </span>


    <strong>
      ${current.value}
    </strong>


    <p>
      ${current.text}
    </p>

  `;

}


// ============================================================
// EXISTING PROCESS STEP
// ============================================================

function showProcessStep(
  node,
  r
) {

  document
    .querySelectorAll(
      ".process-node"
    )
    .forEach(
      n =>
        n.classList.remove(
          "active"
        )
    );


  node.classList.add(
    "active"
  );


  const step =
    Number(
      node.dataset.processStep
    );


  const detail =
    $("processDetail");


  if (!detail)
    return;


  const copy = [

    [

      "CURRENT INVENTORY",

      `${r.currentStock.toLocaleString()} ${esc(
        r.unit
      )}`,

      r.currentStock <=
      r.minimumStock

        ? "Stock is at or below the minimum threshold and needs attention."

        : "Current stock is above the minimum threshold."

    ],


    [

      "CONSUMPTION SIGNAL",

      `${r.totalConsumed.toLocaleString()} ${esc(
        r.unit
      )}`,

      r.usageCount

        ? `Calculated from ${r.usageCount} recorded consumption ${
            r.usageCount === 1
              ? "entry"
              : "entries"
          }.`

        : "No consumption history is available yet."

    ],


    [

      "PROJECTED REQUIREMENT",

      `${r.projectedRequirement.toLocaleString(
        undefined,
        {
          maximumFractionDigits: 2
        }
      )} ${esc(r.unit)}`,

      r.usageCount

        ? "The dashboard uses the available consumption signal to show the projected requirement."

        : "The available minimum-stock threshold is used as the requirement reference."

    ],


    [

      "RECOMMENDED RESULT",

      `${r.additionalNeeded.toLocaleString(
        undefined,
        {
          maximumFractionDigits: 2
        }
      )} ${esc(r.unit)} needed`,

      r.additionalNeeded > 0

        ? "Additional stock may be needed to cover the projected requirement."

        : "Current stock covers the projected requirement based on the available dashboard data."

    ]

  ][step] || null;


  if (copy) {

    detail.innerHTML = `

      <span
        class="process-detail-label"
      >
        ${copy[0]}
      </span>


      <strong>
        ${copy[1]}
      </strong>


      <p>
        ${copy[2]}
      </p>

    `;

  }

}


// ============================================================
// MODALS
// ============================================================

function wireModals() {

  const closeIds = [

    "activityModalClose",

    "activityModalCloseBtn",

    "recModalClose",

    "recModalCloseBtn"

  ];


  closeIds.forEach(
    id =>

      $(id)?.addEventListener(
        "click",
        () => {

          const el =
            $(id)?.closest(
              ".modal-overlay"
            );


          if (el) {

            el.classList.remove(
              "open"
            );

          }

        }
      )
  );


  $("activityModalOverlay")
    ?.addEventListener(
      "click",
      e => {

        if (
          e.target ===
          $("activityModalOverlay")
        ) {

          $("activityModalOverlay")
            .classList
            .remove(
              "open"
            );

        }

      }
    );


  $("recModalOverlay")
    ?.addEventListener(
      "click",
      e => {

        if (
          e.target ===
          $("recModalOverlay")
        ) {

          $("recModalOverlay")
            .classList
            .remove(
              "open"
            );

        }

      }
    );


  $("recommendationChips")
    ?.addEventListener(
      "click",
      e => {

        const btn =
          e.target.closest(
            ".view-result-btn"
          );


        if (!btn)
          return;


        const data =
          window.__rmimsDashboardData ||
          {};


        const material =
          (data.materials || [])
            .find(
              m =>
                String(m.id) ===
                String(
                  btn.dataset.materialId
                )
            );


        openMaterialResult(

          material || {

            materialName:
              btn.dataset.materialName ||
              "Sugar"

          }

        );

      }
    );

}


// ============================================================
// ML FORECAST CONNECTION
// ============================================================

let sugarForecastLoaded =
  false;


async function loadSugarForecastFromML() {

  // Prevent duplicate ML requests.

  if (
    sugarForecastLoaded
  ) {

    return;

  }


  sugarForecastLoaded =
    true;


  try {

    // Get the existing RMIMS Supabase session.

    const {

      data: sessionData,

      error: sessionError

    } =
      await auth.auth.getSession();


    if (
      sessionError
    ) {

      throw sessionError;

    }


    const session =
      sessionData?.session;


    if (!session) {

      console.warn(
        "ML forecast skipped: no active Supabase session."
      );

      return;

    }


    const accessToken =
      session.access_token;


    console.log(
      "Existing RMIMS Supabase session found."
    );


    console.log(
      "Sending authenticated request to Flask ML backend..."
    );


    const response =
      await fetch(

        "http://127.0.0.1:5000/api/ml/forecast/sugar/inventory",

        {

          method:
            "GET",

          headers: {

            "Authorization":
              `Bearer ${accessToken}`

          }

        }

      );


    const result =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        result.error ||
        "ML forecast request failed."
      );

    }


    console.log(
      "REAL ML FORECAST RESULT:",
      result
    );


    console.log(
      "ML RESULT JSON:",
      JSON.stringify(
        result,
        null,
        2
      )
    );


    // Store the real ML result so
    // the Sugar Result modal can use it.

    window.__sugarMLResult =
      result;


    return result;


  } catch (error) {

    console.error(
      "ML forecast connection failed:",
      error
    );

  }

}


// ============================================================
// AUTHENTICATION + DASHBOARD STARTUP
// ============================================================

onAuthStateChanged(

  auth,

  async user => {

    if (!user) {

      window.location.href =
        "../login.html";

      return;

    }


    try {

      const profile =
        await getDoc(

          doc(
            db,
            "users",
            user.uid
          )

        );


      if (
        !profile.exists() ||
        profile.data().status !==
          "active"
      ) {

        window.location.href =
          "../login.html";

        return;

      }


      if (
        profile.data().role !==
          "admin"
      ) {

        window.location.href =
          "../user/dashboard.html";

        return;

      }


      // profileBtn may not exist
      // on every dashboard version.

      const profileBtn =
        $("profileBtn");


      if (profileBtn) {

        profileBtn.textContent =
          profile.data().fullName ||
          "Administrator";

      }


    } catch (err) {

      console.warn(
        "Dashboard role check failed",
        err
      );

    }


    wireModals();

    await loadSugarForecastFromML();

    await loadDashboard();

    // ADDITIVE FORECASTING MODULE BRIDGE:
    // When the Forecasting page asks to open the existing 3D result,
    // reuse the current dashboard result/modal instead of creating a second UI.
    try {
      const forecastMaterialName = new URLSearchParams(location.search).get("openForecastResult");
      if (forecastMaterialName) {
        const data = window.__rmimsDashboardData || {};
        const material = (data.materials || []).find(
          m => String(m.materialName || "").trim().toLowerCase() === String(forecastMaterialName).trim().toLowerCase()
        ) || { materialName: forecastMaterialName };
        window.setTimeout(() => openMaterialResult(material), 80);
        window.history.replaceState({}, document.title, location.pathname);
      }
    } catch (forecastBridgeError) {
      console.warn("Forecasting 3D result bridge failed:", forecastBridgeError);
    }

  }

);