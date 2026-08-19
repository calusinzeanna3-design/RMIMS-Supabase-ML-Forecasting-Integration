/* ============================================================
   RMIMS V2 — ACCOUNT-BOUND ONBOARDING SYSTEM (JS)
   ============================================================ */

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureOnboardingCSS() {
  if (document.getElementById("rmimsOnboardingCss")) return;
  const link = document.createElement("link");
  link.id = "rmimsOnboardingCss";
  link.rel = "stylesheet";

  const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/user/");
  link.href = isSubFolder ? "../css/onboarding.css" : "css/onboarding.css";
  document.head.appendChild(link);
}

const adminSteps = [
  {
    stepTag: "Step 1 of 7 — Welcome",
    title: "Welcome to RMIMS Administrator Portal",
    desc: "RMIMS helps micro, small, and medium enterprises manage raw materials, monitor movement ledgers, analyze usage patterns, and support inventory planning through AI forecasting.",
    features: [
      { icon: "📦", title: "Master Catalog", text: "Maintain raw material specifications and safety thresholds." },
      { icon: "📋", title: "Movement Ledgers", text: "Record factual stock receipts and disbursements." },
      { icon: "📊", title: "Usage Analytics", text: "Analyze consumption patterns across operational activities." },
      { icon: "🤖", title: "AI Forecasting", text: "7-day and 4-week AutoReg requirement projections." }
    ]
  },
  {
    stepTag: "Step 2 of 7 — Master Catalog",
    title: "Inventory Master Catalog & Safety Thresholds",
    desc: "Manage raw material specifications, units of measure, minimum safety thresholds, reorder quantities, and lead times. Stock balances update automatically as transactions are recorded.",
    features: [
      { icon: "⚡", title: "Real-Time Stock", text: "Accurate current balances derived from movement ledgers." },
      { icon: "⚠️", title: "Threshold Alerts", text: "Low stock and critical stock indicators." }
    ]
  },
  {
    stepTag: "Step 3 of 7 — Movement Ledgers",
    title: "Stock Receipts & Disbursement Ledgers",
    desc: "Track factual incoming deliveries from suppliers and outgoing material dispatches for operations. Every entry creates an immutable record linked to your user account.",
    features: [
      { icon: "📥", title: "Inflow Ledger", text: "Log stock receipts with supplier name and received quantity." },
      { icon: "📤", title: "Outflow Ledger", text: "Log disbursements with product context and activity type." }
    ]
  },
  {
    stepTag: "Step 4 of 7 — Analytics & Reports",
    title: "Consumption Analytics & Audit Reporting",
    desc: "Evaluate usage velocity, high-consumption materials, and product dispatches. Generate structured CSV/PDF reports for operational reviews and compliance audits.",
    features: [
      { icon: "📈", title: "Usage Patterns", text: "Visual charts for monthly and daily consumption trends." },
      { icon: "📑", title: "Structured Export", text: "Export movement ledgers and stock balances on demand." }
    ]
  },
  {
    stepTag: "Step 5 of 7 — AI Forecasting",
    title: "AI-Based Forecasting & Decision Support",
    desc: "RMIMS utilizes 30 trained AutoReg time-series models to project future raw material requirements over 7-day and 4-week planning horizons to assist replenishment decisions.",
    features: [
      { icon: "🔮", title: "Time-Series Models", text: "AutoReg models trained on historical consumption." },
      { icon: "💡", title: "Decision Support", text: "Compare current stock against projected requirements." }
    ]
  },
  {
    stepTag: "Step 6 of 7 — Administration",
    title: "User Management & Administrative Controls",
    desc: "As an Administrator, you manage team access profiles, enforce role separation (Admin vs Staff), monitor system activity audit logs, and maintain system settings.",
    features: [
      { icon: "👥", title: "User Management", text: "Provision and review active staff user profiles." },
      { icon: "🛡️", title: "Role Security", text: "Strict role separation enforced by database RLS." }
    ]
  },
  {
    stepTag: "Step 7 of 7 — Educational Check",
    title: "Understanding Check (Educational Only)",
    desc: "A quick 3-question understanding check on RMIMS operations. (This test is for your learning only and does NOT alter account permissions or access).",
    quiz: {
      question: "What is the primary authority for user permissions in RMIMS?",
      options: [
        { text: "The onboarding completion popup status", correct: false },
        { text: "Your authenticated account profile and Supabase database RLS", correct: true },
        { text: "Browser local storage settings", correct: false }
      ],
      feedback: "Correct! Permissions and access are governed strictly by your authenticated account profile in Supabase."
    }
  }
];

const staffSteps = [
  {
    stepTag: "Step 1 of 5 — Welcome",
    title: "Welcome to RMIMS Operations Staff View",
    desc: "As an Operational User, RMIMS provides you with clean tools to log raw material receipts, record disbursements, and monitor current stock balances.",
    features: [
      { icon: "📦", title: "Stock Visibility", text: "Check current raw material inventory levels." },
      { icon: "📥", title: "Receive Stock", text: "Log incoming raw material deliveries from suppliers." },
      { icon: "📤", title: "Disburse Material", text: "Record raw material usage for operational activities." },
      { icon: "📄", title: "Activity Reports", text: "Review recent inventory transaction history." }
    ]
  },
  {
    stepTag: "Step 2 of 5 — Inventory View",
    title: "Inventory Stock Visibility",
    desc: "View up-to-date raw material inventory balances, units of measure, and safety indicators. Understand which materials are available or low on stock.",
    features: [
      { icon: "🔍", title: "Search & Filter", text: "Quickly locate materials by item code or name." },
      { icon: "📊", title: "Unit Separation", text: "View quantities in precise metric units (kg, L, loaf)." }
    ]
  },
  {
    stepTag: "Step 3 of 5 — Logging Movement",
    title: "Logging Deliveries & Operational Disbursements",
    desc: "Record stock receipts when deliveries arrive, or log material usage when issuing materials for operations. Keep inventory accurate with every transaction.",
    features: [
      { icon: "📝", title: "Direct Entry", text: "Simple entry forms for receipts and disbursements." },
      { icon: "🔒", title: "Account Traceability", text: "Transactions are securely logged under your account." }
    ]
  },
  {
    stepTag: "Step 4 of 5 — Reports",
    title: "Operational Reports & Movement History",
    desc: "Access recent activity feeds, check transaction timestamps, and review historical usage records for your daily operational tasks.",
    features: [
      { icon: "📜", title: "Activity Log", text: "View past receipts and disbursements in chronological order." },
      { icon: "⬇️", title: "Export Activity", text: "Generate structured activity summary files." }
    ]
  },
  {
    stepTag: "Step 5 of 5 — Educational Check",
    title: "Understanding Check (Educational Only)",
    desc: "A quick 3-question understanding check on operational procedures. (This test is educational only and does NOT alter account permissions or access).",
    quiz: {
      question: "What should you do when raw material arrives from a supplier?",
      options: [
        { text: "Record it in the Stock Receipts inflow log under the correct material and quantity", correct: true },
        { text: "Wait until year-end to log the transaction", correct: false },
        { text: "Manually change the database schema", correct: false }
      ],
      feedback: "Correct! Logging deliveries in the Stock Receipts inflow log immediately updates the raw material balance."
    }
  }
];

export async function checkAndShowOnboarding(profile, supabaseClient) {
  if (!profile || !profile.id) return;

  const localKey = "rmims_onboarding_" + profile.id;
  const localStatus = localStorage.getItem(localKey);
  const currentStatus = String(profile.onboarding_status || localStatus || "pending").toLowerCase();
  if (currentStatus === "completed" || currentStatus === "skipped") {
    return;
  }

  ensureOnboardingCSS();

  return new Promise(resolve => {
    const role = (profile.role || "user").toLowerCase();
    const steps = role === "admin" ? adminSteps : staffSteps;
    let currentStepIdx = 0;

    const overlay = document.createElement("div");
    overlay.className = "onboarding-overlay";
    overlay.id = "rmimsOnboardingOverlay";

    function renderStep() {
      const step = steps[currentStepIdx];
      const isLast = currentStepIdx === steps.length - 1;
      const isFirst = currentStepIdx === 0;

      let featuresHtml = "";
      if (step.features) {
        featuresHtml = `
          <div class="onboarding-feature-list">
            ${step.features.map(f => `
              <div class="onboarding-feature-item">
                <span class="onboarding-feature-icon">${esc(f.icon)}</span>
                <div>
                  <strong>${esc(f.title)}</strong>
                  <div style="font-size: 12px; color: #64748B; margin-top: 2px;">${esc(f.text)}</div>
                </div>
              </div>
            `).join("")}
          </div>
        `;
      }

      let quizHtml = "";
      if (step.quiz) {
        quizHtml = `
          <div class="onboarding-quiz-card">
            <div class="onboarding-quiz-q">${esc(step.quiz.question)}</div>
            <div class="onboarding-quiz-options">
              ${step.quiz.options.map((opt, i) => `
                <button type="button" class="onboarding-quiz-opt" data-opt-idx="${i}">
                  ${esc(opt.text)}
                </button>
              `).join("")}
            </div>
            <div class="onboarding-quiz-feedback" id="obQuizFeedback" style="display: none;"></div>
          </div>
        `;
      }

      const dotsHtml = steps.map((_, idx) => `
        <div class="onboarding-dot ${idx === currentStepIdx ? "active" : ""}"></div>
      `).join("");

      overlay.innerHTML = `
        <div class="onboarding-card">
          <div class="onboarding-header">
            <div class="onboarding-brand">
              <span class="onboarding-brand-title">RMSME Onboarding</span>
            </div>
            <span class="onboarding-role-badge">${role === "admin" ? "Administrator" : "Staff / User"}</span>
          </div>

          <div class="onboarding-body">
            <div class="onboarding-step-content">
              <div class="onboarding-step-indicator">${esc(step.stepTag)}</div>
              <h2 class="onboarding-title">${esc(step.title)}</h2>
              <p class="onboarding-desc">${esc(step.desc)}</p>
              ${featuresHtml}
              ${quizHtml}
            </div>
          </div>

          <div class="onboarding-footer">
            <div class="onboarding-progress-dots">${dotsHtml}</div>
            <div class="onboarding-actions">
              <button type="button" class="btn-ob-skip" id="obSkipBtn">Skip</button>
              ${!isFirst ? `<button type="button" class="btn-ob-secondary" id="obBackBtn">Back</button>` : ""}
              <button type="button" class="btn-ob-primary" id="obNextBtn">
                ${isLast ? "Get Started →" : "Next →"}
              </button>
            </div>
          </div>
        </div>
      `;

      // Quiz event listeners
      if (step.quiz) {
        const optBtns = overlay.querySelectorAll(".onboarding-quiz-opt");
        const feedbackEl = overlay.querySelector("#obQuizFeedback");
        optBtns.forEach((btn, idx) => {
          btn.addEventListener("click", () => {
            optBtns.forEach(b => b.classList.remove("selected-correct"));
            const opt = step.quiz.options[idx];
            if (opt.correct) {
              btn.classList.add("selected-correct");
              if (feedbackEl) {
                feedbackEl.style.display = "block";
                feedbackEl.textContent = step.quiz.feedback;
              }
            } else {
              if (feedbackEl) {
                feedbackEl.style.display = "block";
                feedbackEl.style.color = "#DC2626";
                feedbackEl.textContent = "Not quite. Select another option to test your understanding.";
              }
            }
          });
        });
      }

      // Next / Back event listeners
      const nextBtn = overlay.querySelector("#obNextBtn");
      if (nextBtn) {
        nextBtn.addEventListener("click", async () => {
          if (isLast) {
            await saveStatus("completed");
          } else {
            currentStepIdx++;
            renderStep();
          }
        });
      }

      const backBtn = overlay.querySelector("#obBackBtn");
      if (backBtn) {
        backBtn.addEventListener("click", () => {
          if (currentStepIdx > 0) {
            currentStepIdx--;
            renderStep();
          }
        });
      }

      const skipBtn = overlay.querySelector("#obSkipBtn");
      if (skipBtn) {
        skipBtn.addEventListener("click", async () => {
          await saveStatus("skipped");
        });
      }
    }

    async function saveStatus(statusValue) {
      const localKey = "rmims_onboarding_" + profile.id;
      try {
        localStorage.setItem(localKey, statusValue);
        profile.onboarding_status = statusValue;
        const { error } = await supabaseClient
          .from("user_profiles")
          .update({ onboarding_status: statusValue })
          .eq("id", profile.id);

        if (error) {
          console.warn("Failed to persist onboarding status to account:", error);
        }
      } catch (e) {
        console.warn("onboarding_status update exception:", e);
      } finally {
        overlay.remove();
        resolve();
      }
    }

    document.body.appendChild(overlay);
    renderStep();
  });
}
