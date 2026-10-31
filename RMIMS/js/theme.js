/* ==========================================================
   RM(S)ME THEME ENGINE — LIGHT MODE PERMANENT LOCK
   ========================================================== */

export function initThemeToggle() {
  document.documentElement.setAttribute("data-theme", "light");
  try {
    localStorage.setItem("rmsme_theme", "light");
  } catch (e) {}
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initThemeToggle);
} else {
  initThemeToggle();
}
