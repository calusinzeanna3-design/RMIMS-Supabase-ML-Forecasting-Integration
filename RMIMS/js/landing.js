/* ==========================================================
   RMIMS LANDING PAGE INTERACTIONS
   ========================================================== */

/* ---- sticky header shadow ---- */
const header = document.getElementById("siteHeader");
function onScrollHeader(){
  if (!header) return;
  header.classList.toggle("is-scrolled", window.scrollY > 8);
}
onScrollHeader();
window.addEventListener("scroll", onScrollHeader, { passive:true });

/* ---- mobile nav toggle ---- */
const navToggle = document.getElementById("navToggle");
const mainNav = document.getElementById("mainNav");

if (navToggle && mainNav){
  navToggle.addEventListener("click", () => {
    const isOpen = mainNav.classList.toggle("is-open");
    navToggle.classList.toggle("is-active", isOpen);
    navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  mainNav.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => {
      mainNav.classList.remove("is-open");
      navToggle.classList.remove("is-active");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
}

/* ---- how-it-works flow carousel ---- */
const flowTrack = document.getElementById("flowTrack");
const flowPrev = document.getElementById("flowPrev");
const flowNext = document.getElementById("flowNext");
const flowDots = document.getElementById("flowDots");
const flowTabs = document.querySelectorAll(".flow-tab");
const allSlides = flowTrack ? Array.from(flowTrack.querySelectorAll(".flow-slide")) : [];

let currentTrack = "admin";
let currentStep = 0;

function slidesFor(track){
  return allSlides.filter(s => s.dataset.track === track);
}

function renderFlow(){
  if (!flowTrack) return;

  const visible = slidesFor(currentTrack);
  const stepCount = visible.length;

  // reorder DOM so the active track's slides sit contiguously at the start
  const other = allSlides.filter(s => s.dataset.track !== currentTrack);
  [...visible, ...other].forEach(s => flowTrack.appendChild(s));

  const offset = -(currentStep * 100);
  flowTrack.style.transform = `translateX(${offset}%)`;

  // hide the inactive track's slides from layout entirely
  other.forEach(s => { s.style.display = "none"; });
  visible.forEach(s => { s.style.display = ""; });

  if (flowPrev) flowPrev.disabled = currentStep === 0;
  if (flowNext) flowNext.disabled = currentStep === stepCount - 1;

  if (flowDots){
    flowDots.innerHTML = "";
    for (let i = 0; i < stepCount; i++){
      const dot = document.createElement("span");
      dot.className = "flow-dot" + (i === currentStep ? " is-active" : "");
      dot.addEventListener("click", () => { currentStep = i; renderFlow(); });
      flowDots.appendChild(dot);
    }
  }
}

if (flowTabs.length){
  flowTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      flowTabs.forEach(t => { t.classList.remove("is-active"); t.setAttribute("aria-selected","false"); });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected","true");
      currentTrack = tab.dataset.track;
      currentStep = 0;
      renderFlow();
    });
  });
}

if (flowPrev) flowPrev.addEventListener("click", () => { if (currentStep > 0){ currentStep--; renderFlow(); } });
if (flowNext) flowNext.addEventListener("click", () => {
  const max = slidesFor(currentTrack).length - 1;
  if (currentStep < max){ currentStep++; renderFlow(); }
});

renderFlow();

/* ---- FAQ accordion ---- */
document.querySelectorAll(".faq-item").forEach(item => {
  const q = item.querySelector(".faq-q");
  const a = item.querySelector(".faq-a");
  if (!q || !a) return;

  q.addEventListener("click", () => {
    const isOpen = item.classList.contains("is-open");

    document.querySelectorAll(".faq-item.is-open").forEach(open => {
      if (open !== item){
        open.classList.remove("is-open");
        open.querySelector(".faq-q").setAttribute("aria-expanded","false");
        open.querySelector(".faq-a").style.maxHeight = null;
      }
    });

    item.classList.toggle("is-open", !isOpen);
    q.setAttribute("aria-expanded", (!isOpen).toString());
    a.style.maxHeight = !isOpen ? a.scrollHeight + "px" : null;
  });
});

/* ---- footer year ---- */
const footerYear = document.getElementById("footerYear");
if (footerYear) footerYear.textContent = new Date().getFullYear();
