/* ==========================================================
   RM(S)ME PORTAL — INTERACTIVE ENGINE
   Hover reactions, 3D pointer parallax, and smooth transitions
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouchDevice = window.matchMedia('(hover: none)').matches;

  const stage = document.getElementById("rmStage");
  const cardAdmin = document.getElementById("cardAdmin");
  const cardUser = document.getElementById("cardUser");
  const illustration = document.getElementById("materialIllustration");

  // 1. Existing Hover Reactions on Stage Clusters
  if (stage && cardAdmin) {
    cardAdmin.addEventListener("mouseenter", () => stage.classList.add("hover-admin"));
    cardAdmin.addEventListener("mouseleave", () => stage.classList.remove("hover-admin"));
  }

  if (stage && cardUser) {
    cardUser.addEventListener("mouseenter", () => stage.classList.add("hover-user"));
    cardUser.addEventListener("mouseleave", () => stage.classList.remove("hover-user"));
  }

  // 2. Subtle 3D Pointer Tracking on Portal Cards (Desktop only, max ±2.5deg)
  if (!isReducedMotion && !isTouchDevice) {
    [cardAdmin, cardUser].forEach(card => {
      if (!card) return;
      let cardFrame = null;

      card.addEventListener("mousemove", (e) => {
        if (cardFrame) cancelAnimationFrame(cardFrame);
        cardFrame = requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left - rect.width / 2;
          const y = e.clientY - rect.top - rect.height / 2;
          const rotX = Math.min(Math.max((y / rect.height) * -5, -2.5), 2.5);
          const rotY = Math.min(Math.max((x / rect.width) * 5, -2.5), 2.5);
          card.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-8px) scale3d(1.02, 1.02, 1.02)`;
        });
      });

      card.addEventListener("mouseleave", () => {
        if (cardFrame) cancelAnimationFrame(cardFrame);
        card.style.transform = '';
      });
    });

    // 3. Subtle Background Illustration Parallax (Desktop only, max ±6px)
    if (stage && illustration) {
      let stageFrame = null;
      stage.addEventListener("mousemove", (e) => {
        if (stageFrame) cancelAnimationFrame(stageFrame);
        stageFrame = requestAnimationFrame(() => {
          const rect = stage.getBoundingClientRect();
          const x = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
          const y = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
          illustration.style.transform = `translate(${x * 6}px, ${y * 6}px)`;
        });
      });

      stage.addEventListener("mouseleave", () => {
        if (stageFrame) cancelAnimationFrame(stageFrame);
        illustration.style.transform = 'translate(0, 0)';
      });
    }
  }
});
