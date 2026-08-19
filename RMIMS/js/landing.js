/* ==========================================================
   RM(S)ME — FINAL MASTER LANDING PAGE ENGINE
   PREMIUM VITE-INSPIRED • 3D • TOUCH-FRIENDLY • ZERO REGRESSION
   ========================================================== */

const featureDetails = {
  "1": {
    num: "01 Capability",
    icon: "📦",
    title: "Inventory Management",
    does: "Record and monitor raw materials, current stock levels, units of measure, minimum safety thresholds, and supplier lead times in a structured catalog.",
    matters: "Maintains real-time stock balances across all facilities and prevents sudden production stockouts."
  },
  "2": {
    num: "02 Capability",
    icon: "📋",
    title: "Material Activity",
    does: "Track received incoming shipments and consumed raw material disbursements with immutable audit-logged ledger entries.",
    matters: "Provides complete traceability over where raw materials were allocated and verifies supplier deliveries."
  },
  "3": {
    num: "03 Capability",
    icon: "📊",
    title: "Consumption Analytics",
    does: "Analyze usage velocity, monthly trends, and high-demand material volume across all finished product recipes.",
    matters: "Transforms raw usage entries into clear visibility on consumption spikes and seasonal operational changes."
  },
  "4": {
    num: "04 Capability",
    icon: "📑",
    title: "Reports",
    does: "Generate audit-ready inventory summaries, movement logs, and stock valuation ledgers on demand.",
    matters: "Streamlines compliance reporting and management review without time-consuming manual spreadsheet consolidation."
  },
  "5": {
    num: "05 Capability",
    icon: "🤖",
    title: "AI-Based Forecasting",
    does: "Forecast 7-day and 4-week future raw material requirements using historical consumption time-series models.",
    matters: "Enables proactive stock reordering before materials run out, reducing emergency rush orders."
  },
  "6": {
    num: "06 Capability",
    icon: "💡",
    title: "Decision Support",
    does: "Compare current stock balances directly against projected weekly requirements to calculate replenishment recommendations.",
    matters: "Eliminates guesswork in purchasing by providing data-driven replenishment quantities."
  }
};

const stageData = [
  {
    num: "STAGE 01",
    title: "Record Raw Materials & Deliveries",
    desc: "Enter raw material specifications, units of measure, minimum thresholds, and log delivery receipts directly into an immutable inventory ledger.",
    pills: [
      "Raw material catalog and specifications can be recorded.",
      "Received delivery shipments are logged in real time.",
      "Accurate records eliminate manual ledger discrepancies."
    ],
    qc: {
      question: "What happens when a new shipment arrives?",
      optA: "A. Delivery quantity and receipt details are recorded",
      optB: "B. The system automatically purchases products",
      optC: "C. Existing database records are cleared",
      correct: "A",
      explanation: "✓ Correct! Delivery shipments are logged directly into the inventory ledger."
    }
  },
  {
    num: "STAGE 02",
    title: "Monitor Stock Levels & Material Movement",
    desc: "Track real-time inventory balances, monitor disbursements into production runs, and receive proactive threshold notifications.",
    pills: [
      "Real-time stock balance visibility across all materials.",
      "Safety threshold indicators flag items nearing minimum levels.",
      "Movement logs capture every receipt and disbursement event."
    ],
    qc: {
      question: "How does RM(S)ME help prevent sudden stockouts?",
      optA: "A. Through minimum safety threshold tracking and alerts",
      optB: "B. By shutting down factory machines",
      optC: "C. By restricting all material usage",
      correct: "A",
      explanation: "✓ Correct! Minimum thresholds alert staff before raw materials run out."
    }
  },
  {
    num: "STAGE 03",
    title: "Analyze Recorded Consumption Patterns",
    desc: "Examine usage velocity, monthly trends, and high-demand material volume across all finished product recipes.",
    pills: [
      "Historical usage patterns are computed from disbursement logs.",
      "Identifies high-consumption materials across production runs.",
      "Transforms raw ledger entries into clear operational insight."
    ],
    qc: {
      question: "What is the basis for consumption analytics?",
      optA: "A. Historical disbursement and usage records",
      optB: "B. Random estimated forecasts",
      optC: "C. External stock market data",
      correct: "A",
      explanation: "✓ Correct! Consumption patterns are computed from actual disbursement records."
    }
  },
  {
    num: "STAGE 04",
    title: "AI-Based Requirement Forecasting",
    desc: "Apply trained AutoReg statistical time-series models to historical usage to project 7-day and 4-week future material requirements.",
    pills: [
      "Trained AutoReg models estimate upcoming raw material needs.",
      "Provides 7-day and 4-week forward-looking planning horizons.",
      "Enables proactive replenishment before shortages occur."
    ],
    qc: {
      question: "What type of forecasting model powers RM(S)ME?",
      optA: "A. Statistical AutoReg time-series models",
      optB: "B. Automated trading bots",
      optC: "C. Manual rule-of-thumb guesses",
      correct: "A",
      explanation: "✓ Correct! Statistical AutoReg models project future demand from historical time-series."
    }
  },
  {
    num: "STAGE 05",
    title: "Support Better Inventory Planning & Decisions",
    desc: "Combine current balances, usage velocity, and projected requirements to generate practical replenishment recommendations.",
    pills: [
      "Decision-support recommendations calculate replenishment gaps.",
      "Guides purchasing schedules aligned with projected demand.",
      "Empowers managers to make informed, data-driven decisions."
    ],
    qc: {
      question: "What is the primary objective of RM(S)ME decision support?",
      optA: "A. Assist managers with data-driven replenishment guidance",
      optB: "B. Replace human management completely",
      optC: "C. Automatically place purchase orders",
      correct: "A",
      explanation: "✓ Correct! RM(S)ME provides decision guidance to assist human managers."
    }
  }
];

document.addEventListener("DOMContentLoaded", () => {
  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouchDevice = window.matchMedia('(hover: none)').matches;

  // ==========================================
  // 1. VIEW / STATE TRANSITION ENGINE
  // ==========================================
  let currentViewId = "home";
  const navLinks = document.querySelectorAll(".main-nav .nav-link");

  function switchView(targetViewId) {
    if (!targetViewId || targetViewId === currentViewId) {
      if (targetViewId === "home") {
        const homePanel = document.getElementById("view-home");
        if (homePanel) homePanel.scrollTop = 0;
      }
      return;
    }

    const currentPanel = document.querySelector(`.view-panel[data-view-id="${currentViewId}"]`);
    const targetPanel = document.querySelector(`.view-panel[data-view-id="${targetViewId}"]`);

    if (!targetPanel) return;

    // Outgoing transition
    if (currentPanel) {
      currentPanel.classList.remove("is-active");
      currentPanel.classList.add("is-leaving");
      setTimeout(() => {
        currentPanel.classList.remove("is-leaving");
      }, 500);
    }

    // Incoming transition
    targetPanel.classList.add("is-active");
    targetPanel.scrollTop = 0;
    currentViewId = targetViewId;

    // Update active nav links
    navLinks.forEach(link => {
      if (link.dataset.viewTarget === targetViewId) {
        link.classList.add("active");
      } else {
        link.classList.remove("active");
      }
    });

    // Close mobile menu if open
    const mainNav = document.getElementById("mainNav");
    const navToggle = document.getElementById("navToggle");
    if (mainNav && navToggle) {
      mainNav.classList.remove("is-open");
      navToggle.classList.remove("is-active");
      navToggle.setAttribute("aria-expanded", "false");
    }
  }

  // Attach view switcher to all elements with data-view-target
  document.addEventListener("click", (e) => {
    const targetEl = e.target.closest("[data-view-target]");
    if (targetEl) {
      e.preventDefault();
      const targetView = targetEl.getAttribute("data-view-target");
      switchView(targetView);
    }
  });

  // ==========================================
  // 2. MOBILE NAV TOGGLE
  // ==========================================
  const navToggle = document.getElementById("navToggle");
  const mainNav = document.getElementById("mainNav");

  if (navToggle && mainNav) {
    navToggle.addEventListener("click", () => {
      const isOpen = mainNav.classList.toggle("is-open");
      navToggle.classList.toggle("is-active", isOpen);
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }

  // ==========================================
  // 3. 3D HERO LOGO PARALLAX (DESKTOP ONLY)
  // ==========================================
  const logoCard = document.getElementById("logoPopupCard");
  if (logoCard && !isReducedMotion && !isTouchDevice) {
    let animFrame = null;
    logoCard.addEventListener('mousemove', (e) => {
      if (animFrame) cancelAnimationFrame(animFrame);
      animFrame = requestAnimationFrame(() => {
        const rect = logoCard.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        const rotX = Math.min(Math.max((y / rect.height) * -6, -3), 3);
        const rotY = Math.min(Math.max((x / rect.width) * 6, -3.5), 3.5);
        logoCard.style.transform = `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale3d(1.025, 1.025, 1.025) translateY(-5px)`;
      });
    });

    logoCard.addEventListener('mouseleave', () => {
      if (animFrame) cancelAnimationFrame(animFrame);
      logoCard.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1) translateY(0)';
    });
  }

  // Header Logo Subtle 3D Tilt (Desktop only, max ±2.5deg)
  const headerBrand = document.getElementById("headerBrandMark");
  if (headerBrand && !isReducedMotion && !isTouchDevice) {
    let brandFrame = null;
    headerBrand.addEventListener('mousemove', (e) => {
      if (brandFrame) cancelAnimationFrame(brandFrame);
      brandFrame = requestAnimationFrame(() => {
        const rect = headerBrand.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        const rotX = Math.min(Math.max((y / rect.height) * -4, -2), 2);
        const rotY = Math.min(Math.max((x / rect.width) * 4, -2.5), 2.5);
        headerBrand.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale3d(1.02, 1.02, 1.02)`;
      });
    });

    headerBrand.addEventListener('mouseleave', () => {
      if (brandFrame) cancelAnimationFrame(brandFrame);
      headerBrand.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    });
  }

  // Graceful 3D logo error handler
  const logo3dImg = document.querySelector(".logo-3d-img");
  if (logo3dImg) {
    logo3dImg.addEventListener("error", () => {
      logo3dImg.src = "assets/logo-full.png";
    });
  }

  // ==========================================
  // 4. FEATURE CARD EXPANSION ENGINE
  // ==========================================
  const expansionDrawer = document.getElementById("featureExpansionDrawer");
  const expansionCloseBtn = document.getElementById("expansionCloseBtn");
  const expIcon = document.getElementById("expIcon");
  const expNum = document.getElementById("expNum");
  const expTitle = document.getElementById("expTitle");
  const expDoes = document.getElementById("expDoes");
  const expMatters = document.getElementById("expMatters");

  function openFeatureExpansion(featureId) {
    const details = featureDetails[featureId];
    if (!details || !expansionDrawer) return;

    if (expIcon) expIcon.textContent = details.icon;
    if (expNum) expNum.textContent = details.num;
    if (expTitle) expTitle.textContent = details.title;
    if (expDoes) expDoes.textContent = details.does;
    if (expMatters) expMatters.textContent = details.matters;

    expansionDrawer.classList.add("is-open");
    expansionDrawer.setAttribute("aria-hidden", "false");
  }

  function closeFeatureExpansion() {
    if (!expansionDrawer) return;
    expansionDrawer.classList.remove("is-open");
    expansionDrawer.setAttribute("aria-hidden", "true");
  }

  document.querySelectorAll(".feature-card").forEach(card => {
    card.addEventListener("click", () => {
      openFeatureExpansion(card.dataset.featureId);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFeatureExpansion(card.dataset.featureId);
      }
    });
  });

  if (expansionCloseBtn) {
    expansionCloseBtn.addEventListener("click", closeFeatureExpansion);
  }

  if (expansionDrawer) {
    expansionDrawer.addEventListener("click", (e) => {
      if (e.target === expansionDrawer) closeFeatureExpansion();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expansionDrawer && expansionDrawer.classList.contains("is-open")) {
      closeFeatureExpansion();
    }
  });

  // ==========================================
  // 5. HOW IT WORKS 5-STAGE & QUICK CHECK ENGINE
  // ==========================================
  const stepPills = document.querySelectorAll(".process-step-pill");
  const stepNumEl = document.getElementById("howActiveStepNum");
  const stepTitleEl = document.getElementById("howActiveStepTitle");
  const stepDescEl = document.getElementById("howActiveStepDesc");
  const pill1 = document.getElementById("infoPill1");
  const pill2 = document.getElementById("infoPill2");
  const pill3 = document.getElementById("infoPill3");
  const qcQuestionEl = document.getElementById("qcQuestion");
  const qcOptA = document.getElementById("qcOptA");
  const qcOptB = document.getElementById("qcOptB");
  const qcOptC = document.getElementById("qcOptC");
  const qcFeedback = document.getElementById("qcFeedback");

  let currentStageIndex = 0;

  function setStage(index) {
    const data = stageData[index];
    if (!data) return;

    currentStageIndex = index;

    stepPills.forEach((pill, i) => {
      if (i === index) {
        pill.classList.add("is-active-step");
        pill.setAttribute("aria-selected", "true");
      } else {
        pill.classList.remove("is-active-step");
        pill.setAttribute("aria-selected", "false");
      }
    });

    if (stepNumEl) stepNumEl.textContent = data.num;
    if (stepTitleEl) stepTitleEl.textContent = data.title;
    if (stepDescEl) stepDescEl.textContent = data.desc;

    // Update floating info pills with re-triggered animation
    if (pill1) pill1.textContent = data.pills[0];
    if (pill2) pill2.textContent = data.pills[1];
    if (pill3) pill3.textContent = data.pills[2];

    const infoContainer = document.getElementById("howInfoItems");
    if (infoContainer) {
      infoContainer.querySelectorAll(".info-pill-item").forEach(item => {
        item.style.animation = 'none';
        item.offsetHeight; /* trigger reflow */
        item.style.animation = '';
      });
    }

    // Update Quick Check question & choices
    if (qcQuestionEl) qcQuestionEl.textContent = data.qc.question;
    if (qcOptA) {
      qcOptA.textContent = data.qc.optA;
      qcOptA.className = "qc-btn";
    }
    if (qcOptB) {
      qcOptB.textContent = data.qc.optB;
      qcOptB.className = "qc-btn";
    }
    if (qcOptC) {
      qcOptC.textContent = data.qc.optC;
      qcOptC.className = "qc-btn";
    }
    if (qcFeedback) {
      qcFeedback.textContent = "";
      qcFeedback.style.color = "";
    }
  }

  stepPills.forEach(pill => {
    pill.addEventListener("click", () => {
      const idx = parseInt(pill.dataset.stepIndex, 10);
      setStage(idx);
    });
    pill.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setStage(parseInt(pill.dataset.stepIndex, 10));
      }
    });
  });

  // Quick Check answer selection
  const qcButtons = [qcOptA, qcOptB, qcOptC];
  qcButtons.forEach(btn => {
    if (btn) {
      btn.addEventListener("click", () => {
        const selectedChoice = btn.dataset.choice;
        const currentQC = stageData[currentStageIndex].qc;

        qcButtons.forEach(b => {
          if (b) b.className = "qc-btn";
        });

        if (selectedChoice === currentQC.correct) {
          btn.classList.add("is-correct");
          if (qcFeedback) {
            qcFeedback.textContent = currentQC.explanation;
            qcFeedback.style.color = "var(--color-emerald-light)";
          }
        } else {
          btn.classList.add("is-incorrect");
          if (qcFeedback) {
            qcFeedback.textContent = "✗ Please review the stage objectives and try again.";
            qcFeedback.style.color = "#FCA5A5";
          }
        }
      });
    }
  });

  // ==========================================
  // 6. CONNECT / FAQ ACCORDION ENGINE
  // ==========================================
  const faqItems = document.querySelectorAll(".faq-item");
  faqItems.forEach(item => {
    const questionBtn = item.querySelector(".faq-question");
    if (questionBtn) {
      questionBtn.addEventListener("click", () => {
        const isOpen = item.classList.contains("is-open");

        // Close other FAQs for clean single-expanded view
        faqItems.forEach(otherItem => {
          if (otherItem !== item) {
            otherItem.classList.remove("is-open");
            const otherBtn = otherItem.querySelector(".faq-question");
            if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
          }
        });

        // Toggle current item
        if (isOpen) {
          item.classList.remove("is-open");
          questionBtn.setAttribute("aria-expanded", "false");
        } else {
          item.classList.add("is-open");
          questionBtn.setAttribute("aria-expanded", "true");
        }
      });
    }
  });
});
