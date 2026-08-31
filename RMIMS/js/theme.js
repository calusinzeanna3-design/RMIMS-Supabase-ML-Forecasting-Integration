/* ==========================================================
   RM(S)ME SHARED THEME ENGINE
   Light / Dark Mode State & Event Manager
   ========================================================== */

export function initThemeToggle() {
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const storedTheme = localStorage.getItem("rmsme_theme");
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  
  let currentTheme = storedTheme || (prefersLight ? "light" : "dark");
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
}

// Auto-run if loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initThemeToggle);
} else {
  initThemeToggle();
}
