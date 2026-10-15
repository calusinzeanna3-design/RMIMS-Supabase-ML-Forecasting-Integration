/* ==========================================================
   RM(S)ME — FINAL MASTER LANDING PAGE ENGINE
   SCROLLABLE • THEME TOGGLE • 3D • TOUCH-FRIENDLY
   ========================================================== */

// Auto-forward Supabase password recovery tokens if arriving at landing page root
(function checkLandingRecovery() {
  const hash = window.location.hash || "";
  const search = window.location.search || "";
  if (hash.includes("type=recovery") || search.includes("type=recovery") || (hash.includes("access_token=") && !hash.includes("type=signup"))) {
    window.location.replace("login.html" + search + hash);
  }
})();

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
  // 1. THEME ENGINE (LIGHT / DARK MODE TOGGLE)
  // ==========================================
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const storedTheme = localStorage.getItem("rmsme_theme");
  
  let currentTheme = storedTheme || "dark";
  applyTheme(currentTheme);

  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("rmsme_theme", theme);
    if (themeToggleBtn) {
      themeToggleBtn.setAttribute(
        "title",
        theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
      );
      themeToggleBtn.setAttribute(
        "aria-label",
        theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
      );
    }
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      applyTheme(newTheme);
    });
  }

  // ==========================================
  // 2. SMOOTH SCROLLING & MOBILE NAV HANDLERS
  // ==========================================
  const navLinks = document.querySelectorAll(".main-nav .nav-link");
  const mainNav = document.getElementById("mainNav");
  const navToggle = document.getElementById("navToggle");

  // Close mobile nav when clicking a link
  navLinks.forEach(link => {
    link.addEventListener("click", () => {
      if (mainNav && mainNav.classList.contains("is-open")) {
        mainNav.classList.remove("is-open");
        if (navToggle) {
          navToggle.classList.remove("is-active");
          navToggle.setAttribute("aria-expanded", "false");
        }
      }
    });
  });

  // ==========================================
  // 3. MOBILE NAV TOGGLE
  // ==========================================
  if (navToggle && mainNav) {
    navToggle.addEventListener("click", () => {
      const isOpen = mainNav.classList.toggle("is-open");
      navToggle.classList.toggle("is-active", isOpen);
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }

  // ==========================================
  // 4. 3D HERO LOGO PARALLAX (DESKTOP ONLY)
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

  // FinFlow 3-Card Stage 3D Perspective Parallax (Desktop Only)
  const ffCards = document.querySelectorAll(".ff-card");
  if (ffCards.length && !isReducedMotion && !isTouchDevice) {
    ffCards.forEach(card => {
      let cardFrame = null;
      const isLeft = card.classList.contains("ff-card-left");
      const isRight = card.classList.contains("ff-card-right");
      const isCenter = card.classList.contains("ff-card-center");

      const baseRotZ = isLeft ? -7 : (isRight ? 7 : 0);
      const baseRotY = isLeft ? 16 : (isRight ? -16 : 0);
      const baseRotX = isCenter ? 4 : 10;
      const baseScale = isCenter ? 1.06 : 1;
      const baseLift = isCenter ? -14 : 24;

      card.addEventListener("mousemove", (e) => {
        if (cardFrame) cancelAnimationFrame(cardFrame);
        cardFrame = requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left - rect.width / 2;
          const y = e.clientY - rect.top - rect.height / 2;
          const deltaRotX = Math.min(Math.max((y / rect.height) * -8, -5), 5);
          const deltaRotY = Math.min(Math.max((x / rect.width) * 8, -5), 5);
          card.style.transform = `perspective(1200px) rotateX(${baseRotX + deltaRotX}deg) rotateY(${baseRotY + deltaRotY}deg) rotateZ(${baseRotZ}deg) scale(${baseScale + 0.02}) translateY(${baseLift - 8}px)`;
        });
      });

      card.addEventListener("mouseleave", () => {
        if (cardFrame) cancelAnimationFrame(cardFrame);
        card.style.transform = "";
      });
    });
  }

  // Header Logo Subtle 3D Tilt
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
  // 5. FEATURE CARD EXPANSION ENGINE
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
  // 6. HOW IT WORKS 5-STAGE & QUICK CHECK ENGINE
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
  // 7. CONNECT / FAQ ACCORDION ENGINE
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

  // ==========================================
  // 7b. REDESIGNED FAQ ACCORDION ENGINE
  // ==========================================
  const ffFaqRows = document.querySelectorAll(".ff-faq-row");
  ffFaqRows.forEach(row => {
    const qBtn = row.querySelector(".ff-faq-q");
    const toggleIcon = row.querySelector(".ff-faq-toggle");
    if (qBtn) {
      qBtn.addEventListener("click", () => {
        const isOpen = row.classList.contains("is-open");
        // Close other rows for clean single-expanded view
        ffFaqRows.forEach(other => {
          if (other !== row) {
            other.classList.remove("is-open");
            const otherBtn = other.querySelector(".ff-faq-q");
            const otherToggle = other.querySelector(".ff-faq-toggle");
            if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
            if (otherToggle) otherToggle.textContent = "+";
          }
        });

        if (isOpen) {
          row.classList.remove("is-open");
          qBtn.setAttribute("aria-expanded", "false");
          if (toggleIcon) toggleIcon.textContent = "+";
        } else {
          row.classList.add("is-open");
          qBtn.setAttribute("aria-expanded", "true");
          if (toggleIcon) toggleIcon.textContent = "−";
        }
      });
    }
  });

  // ==========================================
  // 7c. NETWORK WORKFLOW MAP INTERACTION
  // ==========================================
  const mapNodes = document.querySelectorAll(".ff-facility-node");
  const mapStageNum = document.getElementById("mapStageNum");
  const mapStageTitle = document.getElementById("mapStageTitle");
  const mapStageText = document.getElementById("mapStageText");

  const facilityStages = [
    {
      num: "STAGE 01",
      title: "Delivery Dock & Inbound Logging",
      text: "Raw material shipments from certified suppliers arrive and are immediately checked against vendor delivery receipts in the digital ledger."
    },
    {
      num: "STAGE 02",
      title: "Quality Inspection & Verification",
      text: "Inspecting received raw materials for specifications, expiration batches, moisture tolerance, and unit-of-measure conformity."
    },
    {
      num: "STAGE 03",
      title: "Central Storage & Stock Monitoring",
      text: "Continuous real-time tracking of raw material balances, units of measure, and safety buffer thresholds across all warehouse zones."
    },
    {
      num: "STAGE 04",
      title: "Production Line Disbursement",
      text: "Batch disbursement orders draw exact ingredient quantities according to standardized recipes, updating residual inventory live."
    },
    {
      num: "STAGE 05",
      title: "AI Demand & Reorder Forecasting",
      text: "Auto-regressive time-series statistical engines evaluate velocity and consumption trends to predict 7-day and 4-week reorder needs."
    }
  ];

  mapNodes.forEach(node => {
    node.addEventListener("click", () => {
      const stageIdx = parseInt(node.getAttribute("data-stage") || "0", 10);
      const stage = facilityStages[stageIdx];
      if (stage) {
        mapNodes.forEach(n => n.classList.remove("is-active"));
        node.classList.add("is-active");
        if (mapStageNum) mapStageNum.textContent = stage.num;
        if (mapStageTitle) mapStageTitle.textContent = stage.title;
        if (mapStageText) mapStageText.textContent = stage.text;
      }
    });
  });

  // ==========================================
  // 7d. PRICING BILLING TOGGLE (MONTHLY / YEARLY)
  // ==========================================
  const billingMonthly = document.getElementById("billingMonthly");
  const billingYearly = document.getElementById("billingYearly");
  const priceStarter = document.querySelector(".price-starter");
  const pricePro = document.querySelector(".price-pro");
  const priceEnt = document.querySelector(".price-ent");
  const pricePeriods = document.querySelectorAll(".p-period");

  if (billingMonthly && billingYearly) {
    billingMonthly.addEventListener("click", () => {
      billingMonthly.classList.add("is-active");
      billingYearly.classList.remove("is-active");
      if (priceStarter) priceStarter.textContent = "0.00";
      if (pricePro) pricePro.textContent = "19.00";
      if (priceEnt) priceEnt.textContent = "199.00";
      pricePeriods.forEach(p => p.textContent = "/month");
    });

    billingYearly.addEventListener("click", () => {
      billingYearly.classList.add("is-active");
      billingMonthly.classList.remove("is-active");
      if (priceStarter) priceStarter.textContent = "0.00";
      if (pricePro) pricePro.textContent = "15.00";
      if (priceEnt) priceEnt.textContent = "159.00";
      pricePeriods.forEach(p => p.textContent = "/month (billed yearly)");
    });
  }

  // ==========================================
  // 7e. DASHBOARD MOCKUP PREVIEW TABS
  // ==========================================
  const dashTabs = document.querySelectorAll(".dash-tab");
  dashTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      dashTabs.forEach(t => t.classList.remove("is-active"));
      tab.classList.add("is-active");
    });
  });

  // ==========================================
  // 8. SCROLL REVEAL & SMOOTH EXIT ENGINE
  // ==========================================
  if (!isReducedMotion) {
    // Auto-tag sections, columns and cards with reveal animation classes
    const leftElements = document.querySelectorAll(".hero-text-col, .about-left-col, .workflow-rail, .connect-card, .connect-left-col, .ff-faq-left-col");
    leftElements.forEach(el => {
      el.classList.add("reveal-item", "reveal-left");
    });

    const rightElements = document.querySelectorAll(".hero-visual-stage, .about-right-col, .interactive-stage-panel, .faq-card, .ff-faq-right-col");
    rightElements.forEach(el => {
      el.classList.add("reveal-item", "reveal-right");
    });

    const headingWraps = document.querySelectorAll(".view-heading-wrap, .ff-section-header, .ff-arch-heading-wrap, .site-footer");
    headingWraps.forEach(el => {
      el.classList.add("reveal-item", "reveal-up");
    });

    const staggerGrids = [
      document.querySelectorAll(".objectives-grid .objective-card"),
      document.querySelectorAll(".features-view-grid .feature-card"),
      document.querySelectorAll(".benefits-grid .benefit-card"),
      document.querySelectorAll(".workflow-rail .process-step-pill"),
      document.querySelectorAll(".faq-accordion .faq-item"),
      document.querySelectorAll(".ff-solutions-bento .ff-bento-card"),
      document.querySelectorAll(".ff-advantages-grid .ff-adv-item"),
      document.querySelectorAll(".ff-pricing-grid .ff-price-card"),
      document.querySelectorAll(".ff-news-grid .ff-news-card"),
      document.querySelectorAll(".ff-stats-counter-row .ff-stat-box")
    ];

    staggerGrids.forEach(cardList => {
      cardList.forEach((card, idx) => {
        card.classList.add("reveal-item", "reveal-up");
        const delayClass = `delay-${Math.min((idx % 6) + 1, 6)}`;
        card.classList.add(delayClass);
      });
    });

    const singleProminentElements = document.querySelectorAll(".ff-dashboard-window, .ff-quote-card, .ff-network-map-card, .ff-bridge-banner, .ff-luminous-dome-wrap");
    singleProminentElements.forEach(el => {
      el.classList.add("reveal-item", "reveal-up");
    });

    const allRevealItems = document.querySelectorAll(".reveal-item");

    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const el = entry.target;
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
          el.classList.remove("is-exited-up");
        } else {
          // When element has scrolled past above the viewport, apply smooth exit-up
          if (entry.boundingClientRect.top < 0) {
            el.classList.add("is-exited-up");
            el.classList.remove("is-visible");
          } else {
            // When below the viewport, reset for fresh entrance on scroll down
            el.classList.remove("is-visible", "is-exited-up");
          }
        }
      });
    }, {
      threshold: 0.05,
      rootMargin: "0px 0px -20px 0px"
    });

    allRevealItems.forEach(item => revealObserver.observe(item));

    // Guarantee reveal for elements in view on bottom scroll
    window.addEventListener("scroll", () => {
      const isAtBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 60);
      if (isAtBottom) {
        document.querySelectorAll("#connect .reveal-item, .site-footer.reveal-item").forEach(el => {
          el.classList.add("is-visible");
          el.classList.remove("is-exited-up");
        });
      }
    }, { passive: true });
  }
});

