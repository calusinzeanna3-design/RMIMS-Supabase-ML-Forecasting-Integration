// RMIMS User — Consumption Analytics
// Robust, unit-aware analytics with explicit edge-case handling.

import { auth, db } from "../supabase/supabase-config.js";
import { collection, getDocs, getDoc, doc } from "../supabase/db-compat.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

let currentUser = null;
let materials = [];
let usageRecords = [];
let trendGranularity = "Daily";
let currentRange = "week";
let lineChart = null;
let distributionChart = null;
let mostConsumedChart = null;
let currentPage = 1;
const PAGE_SIZE = 10;

const $ = (id) => document.getElementById(id);
const searchInput = $("searchInput");
const categorySelect = $("categorySelect");
const unitSelect = $("unitSelect");
const dateRangeSelect = $("dateRangeSelect");
const startDateInput = $("startDateInput");
const endDateInput = $("endDateInput");
const resetFiltersBtn = $("resetFiltersBtn");

/* ==========================================================
   INFO ICON CONTENT — balanced with the Admin analytics view
   ========================================================== */
const INFO_TEXT = {
    totalActivity: {
        title: "Total Material Activity",
        body: "Shows the number of recorded material-use activities included in the selected period. It counts activity records, not the total quantity consumed."
    },
    mostUsed: {
        title: "Most Used Material",
        body: "Identifies the raw material with the highest recorded consumption in the selected period. Materials with different units are not compared as if their quantities were the same."
    },
    leastUsed: {
        title: "Least Used Material",
        body: "Shows the material with the lowest recorded consumption among materials with usage in the selected period. If there is a tie or not enough comparable data, the system avoids forcing a single result."
    },
    totalConsumption: {
        title: "Total Consumption",
        body: "Shows recorded consumed quantities for the selected period. Different units such as kg, liters, and pieces are kept separate so the summary is not misleading."
    },
    consumptionTrend: {
        title: "Material Consumption Trend",
        body: "Shows how recorded material consumption changes over time. The system uses available historical records and does not invent an increase or decrease when there is not enough history."
    },
    usageBreakdown: {
        title: "Material Usage Breakdown",
        body: "Shows how recorded consumption is distributed across materials. When materials use different measurement units, the system keeps their quantities separate instead of combining incompatible units."
    },
    mostConsumed: {
        title: "Most Consumed Raw Materials",
        body: "Ranks materials by recorded consumption for the selected period. This helps identify which raw materials are being used most often or in the greatest recorded quantity within the same unit."
    },
    recentConsumption: {
        title: "Recent Material Consumption",
        body: "Shows the latest recorded Used/Consumed activities. A finished product may appear as context when it was included in the activity record."
    },
    usageOverview: {
        title: "Material Usage Overview",
        body: "Provides a material-by-material view of recorded consumption, trend, and current stock status. Archived materials can remain visible when they have historical usage."
    },
    consumptionInsights: {
        title: "Consumption Insights",
        body: "Summarizes useful observations from the selected consumption data, such as increasing usage, low stock, tied results, archived materials, or data-quality limitations."
    }
};

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function formatNum(v) {
    const n = num(v);
    return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatQty(v, unit = "") {
    const text = formatNum(v);
    return `${text}${unit ? ` ${escapeHtml(unit)}` : ""}`;
}

function normalizeDate(value) {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value?.toMillis === "function") return new Date(value.toMillis());
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function startOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
    d.setHours(0, 0, 0, 0);
    return d;
}

function getRange() {
    const now = new Date();
    if (startDateInput?.value || endDateInput?.value) {
        if (!startDateInput.value || !endDateInput.value) return { error: "Select both start and end dates." };
        const start = new Date(`${startDateInput.value}T00:00:00`);
        const end = new Date(`${endDateInput.value}T23:59:59.999`);
        if (start > end) return { error: "Invalid date range. End date must be on or after the start date." };
        if (start > now) return { error: "Future dates cannot be used for historical consumption analytics." };
        return { start, end: end > now ? now : end };
    }
    const key = dateRangeSelect?.value || currentRange;
    if (key === "today") {
        const start = new Date(now); start.setHours(0, 0, 0, 0); return { start, end: now };
    }
    if (key === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
    if (key === "last30") { const start = new Date(now); start.setDate(start.getDate() - 30); return { start, end: now }; }
    return { start: startOfWeek(now), end: now };
}

function previousRange(range) {
    const duration = range.end.getTime() - range.start.getTime();
    const end = new Date(range.start.getTime() - 1);
    return { start: new Date(end.getTime() - duration), end };
}

function inRange(date, range) {
    const d = normalizeDate(date);
    return d && d >= range.start && d <= range.end;
}

function materialStatus(material) {
    if (!material) return "Unknown";
    if (material.status) return material.status;
    const qty = num(material.quantity ?? material.currentStock);
    const min = num(material.minimumThreshold ?? material.minimumStock);
    if (qty <= min / 2) return "Critical";
    if (qty <= min) return "Low";
    return "Available";
}

function showState(type, message) {
    const box = $("analyticsState");
    if (!box) return;
    box.className = `analytics-state ${type}`;
    box.hidden = false;
    box.innerHTML = message;
}

function hideState() { const box = $("analyticsState"); if (box) box.hidden = true; }

function showError(message) {
    showState("error", `<strong>Unable to load analytics.</strong><span>${escapeHtml(message)}</span><button id="retryAnalyticsBtn" type="button">Try Again</button>`);
    $("retryAnalyticsBtn")?.addEventListener("click", loadAll);
}

function populateFilters() {
    const categories = [...new Set(materials.map(m => m.category).filter(Boolean))].sort();
    const units = [...new Set(materials.map(m => m.unit).filter(Boolean))].sort();
    const oldCat = categorySelect.value, oldUnit = unitSelect.value;
    categorySelect.innerHTML = `<option value="">All Categories</option>${categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}`;
    unitSelect.innerHTML = `<option value="">All Units</option>${units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("")}`;
    categorySelect.value = categories.includes(oldCat) ? oldCat : "";
    unitSelect.value = units.includes(oldUnit) ? oldUnit : "";
}

function validUsageRecords() {
    return usageRecords.filter(r => {
        const q = num(r.usedQuantity);
        return normalizeDate(r.usageDate) && q > 0;
    });
}

function computeStats() {
    const range = getRange();
    if (range.error) return { error: range.error };
    const prev = previousRange(range);
    const search = (searchInput.value || "").trim().toLowerCase();
    const category = categorySelect.value;
    const unit = unitSelect.value;

    const filteredMaterials = materials.filter(m => {
        const name = String(m.materialName || m.name || "").toLowerCase();
        return (!search || name.includes(search)) && (!category || m.category === category) && (!unit || m.unit === unit);
    });

    const stats = filteredMaterials.map(material => {
        const records = validUsageRecords().filter(r => r.materialId === material.id && inRange(r.usageDate, range));
        const prevRecords = validUsageRecords().filter(r => r.materialId === material.id && inRange(r.usageDate, prev));
        const total = records.reduce((s, r) => s + num(r.usedQuantity), 0);
        const previous = prevRecords.reduce((s, r) => s + num(r.usedQuantity), 0);
        const hasOlder = validUsageRecords().some(r => r.materialId === material.id && normalizeDate(r.usageDate) < range.start);
        let trend = { arrow: "none", change: null, label: "Not enough data" };
        if (hasOlder && previous > 0) {
            const change = ((total - previous) / previous) * 100;
            trend = { arrow: change > 5 ? "up" : change < -5 ? "down" : "flat", change, label: change > 5 ? "Increasing" : change < -5 ? "Decreasing" : "Stable" };
        } else if (hasOlder && total > 0 && previous === 0) {
            trend = { arrow: "up", change: null, label: "New usage" };
        }
        return { material, records, total, previous, trend };
    });
    return { stats, range, prev };
}

function renderSummary(stats) {
    const withUsage = stats.filter(s => s.total > 0);
    const byUnit = new Map();
    withUsage.forEach(s => byUnit.set(s.material.unit || "unit", (byUnit.get(s.material.unit || "unit") || 0) + s.total));

    $("totalUsageRecords").textContent = validUsageRecords().filter(r => inRange(r.usageDate, getRange())).length.toLocaleString();
    const totalEl = $("totalConsumption");
    if (!withUsage.length) totalEl.innerHTML = `<span class="summary-muted">No usage recorded</span>`;
    else totalEl.innerHTML = [...byUnit.entries()].sort((a,b) => b[1]-a[1]).map(([u,v]) => `<span class="summary-unit">${formatNum(v)} <small>${escapeHtml(u)}</small></span>`).join("");

    if (!withUsage.length) {
        $("mostUsedMaterial").textContent = "—";
        $("leastUsedMaterial").textContent = "—";
        $("mostUsedMaterial").title = "No consumption records in the selected period.";
        $("leastUsedMaterial").title = "No consumption records in the selected period.";
        return;
    }

    const groups = new Map();
    withUsage.forEach(s => {
        const key = s.material.unit || "unit";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    });
    // A cross-unit 'most used' label is only shown if all active records use one unit.
    if (groups.size === 1) {
        const arr = [...withUsage].sort((a,b) => b.total - a.total);
        const max = arr[0].total;
        const min = arr[arr.length - 1].total;
        const tops = arr.filter(x => x.total === max);
        const lows = arr.filter(x => x.total === min);
        $("mostUsedMaterial").textContent = tops.map(x => x.material.materialName).join(" / ");
        $("leastUsedMaterial").textContent = lows.map(x => x.material.materialName).join(" / ");
        $("mostUsedMaterial").title = `${formatQty(max, arr[0].material.unit)} used`;
        $("leastUsedMaterial").title = `${formatQty(min, arr[arr.length-1].material.unit)} used`;
    } else {
        $("mostUsedMaterial").textContent = "By unit";
        $("leastUsedMaterial").textContent = "By unit";
        $("mostUsedMaterial").title = "Materials with different units are not directly compared.";
        $("leastUsedMaterial").title = "Materials with different units are not directly compared.";
    }
}

function destroyCharts() {
    [lineChart, distributionChart, mostConsumedChart].forEach(c => c?.destroy());
    lineChart = distributionChart = mostConsumedChart = null;
}

function renderNoDataChart(canvasId, message) {
    const canvas = $(canvasId); if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save(); ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-soft") || "#64748b";
    ctx.font = "600 14px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillText(message, canvas.width/2, canvas.height/2); ctx.restore();
}

function renderCharts(stats, range) {
    const usable = stats.filter(s => s.total > 0);
    destroyCharts();
    const units = [...new Set(usable.map(s => s.material.unit || "unit"))];

    if (!usable.length) {
        renderNoDataChart("consumptionChart", "No consumption data for this period");
        renderNoDataChart("distributionChart", "No material usage to display");
        renderNoDataChart("mostConsumedBarChart", "No material usage to rank");
        return;
    }

    // Trend is only aggregated when the selected set has one unit. This prevents kg + pcs + L from being added.
    if (units.length === 1) {
        const buckets = new Map();
        validUsageRecords().filter(r => inRange(r.usageDate, range) && units.includes(materials.find(m=>m.id===r.materialId)?.unit || "unit")).forEach(r => {
            const d = normalizeDate(r.usageDate); let key;
            if (trendGranularity === "Monthly") key = d.toLocaleDateString(undefined,{month:"short",year:"numeric"});
            else if (trendGranularity === "Weekly") key = `Week of ${startOfWeek(d).toLocaleDateString(undefined,{month:"short",day:"numeric"})}`;
            else key = d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
            buckets.set(key, (buckets.get(key)||0) + num(r.usedQuantity));
        });
        lineChart = new Chart($("consumptionChart"), { type:"line", data:{labels:[...buckets.keys()],datasets:[{label:`Quantity used (${units[0]})`,data:[...buckets.values()],tension:.35,fill:true}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}} });
    } else renderNoDataChart("consumptionChart", "Select one unit to view a comparable trend");

    const top = [...usable].sort((a,b)=>b.total-a.total).slice(0,6);
    const rest = [...usable].sort((a,b)=>b.total-a.total).slice(6);
    const labels = top.map(s=>s.material.materialName);
    const values = top.map(s=>s.total);
    if (rest.length) { labels.push("Others"); values.push(rest.reduce((s,x)=>s+x.total,0)); }
    distributionChart = new Chart($("distributionChart"), { type:"doughnut", data:{labels,datasets:[{data:values}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"}}} });
    mostConsumedChart = new Chart($("mostConsumedBarChart"), { type:"bar", data:{labels:top.map(s=>s.material.materialName),datasets:[{label:"Quantity used",data:top.map(s=>s.total)}]}, options:{responsive:true,maintainAspectRatio:false,indexAxis:top.length>=6?"y":"x",plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}} });
}

function trendHtml(t) {
    if (t.arrow === "up") return `<span class="trend-badge trend-up">↑ ${t.change === null ? "New" : `${Math.abs(Math.round(t.change))}%`}</span>`;
    if (t.arrow === "down") return `<span class="trend-badge trend-down">↓ ${Math.abs(Math.round(t.change))}%</span>`;
    if (t.arrow === "flat") return `<span class="trend-badge trend-flat">→ Stable</span>`;
    return `<span class="trend-badge trend-flat">— Not enough data</span>`;
}

function statusHtml(material) {
    const s = materialStatus(material);
    const cls = s === "Critical" ? "stock-critical" : s === "Low" ? "stock-low" : s === "Available" ? "stock-good" : "stock-unknown";
    const label = s === "Critical" ? "Needs Restocking" : s === "Low" ? "Running Low" : s === "Available" ? "Good" : s;
    return `<span class="status ${cls}">${label}</span>`;
}

function renderTable(stats) {
    const rows = [...stats].sort((a,b)=>b.total-a.total);
    const totalPages = Math.max(1, Math.ceil(rows.length/PAGE_SIZE));
    currentPage = Math.min(currentPage,totalPages);
    const pageRows = rows.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
    const tbody = $("analyticsTableBody");
    if (!rows.length) tbody.innerHTML = `<tr><td colspan="6" class="empty-table">No materials match the selected filters.</td></tr>`;
    else tbody.innerHTML = pageRows.map(s=>`<tr>
        <td><strong>${escapeHtml(s.material.materialName || s.material.name || "Unknown")}</strong>${s.material.isActive===false?` <span class="archived-label">Archived</span>`:""}</td>
        <td>${escapeHtml(s.material.category||"—")}</td>
        <td>${escapeHtml(s.material.unit||"—")}</td>
        <td>${s.total > 0 ? formatQty(s.total,s.material.unit) : "0"}</td>
        <td>${trendHtml(s.trend)}</td>
        <td>${statusHtml(s.material)}</td>
    </tr>`).join("");
    $("pageInfo").textContent = rows.length ? `Showing ${(currentPage-1)*PAGE_SIZE+1} to ${Math.min(currentPage*PAGE_SIZE,rows.length)} of ${rows.length} materials` : "Showing 0 to 0 of 0 materials";
    const controls=$("paginationControls"); controls.innerHTML="";
    for(let p=1;p<=totalPages;p++){const b=document.createElement("button");b.textContent=p;b.className=p===currentPage?"active":"";b.addEventListener("click",()=>{currentPage=p;renderPage();});controls.appendChild(b);}
}

function renderRecent(range) {
    const recent = validUsageRecords().filter(r=>inRange(r.usageDate,range)).sort((a,b)=>normalizeDate(b.usageDate)-normalizeDate(a.usageDate)).slice(0,8);
    const list=$("recentActivityList");
    if(!recent.length){list.innerHTML=`<div class="empty-state">No consumption records found for the selected period.</div>`;return;}
    list.innerHTML=recent.map(r=>{const m=materials.find(x=>x.id===r.materialId);return `<div class="activity-item"><div><strong>${escapeHtml(m?.materialName||r.materialName||"Unknown material")}</strong><small>${normalizeDate(r.usageDate)?.toLocaleDateString()||"Unknown date"}${r.finishedProductName?` · ${escapeHtml(r.finishedProductName)}`:""}</small></div><b>${formatQty(r.usedQuantity,m?.unit||r.unit||"")}</b></div>`}).join("");
}

function renderInsights(stats) {
    const list=$("insightsList");
    const usable=stats.filter(s=>s.total>0);
    const messages=[];
    if(!usable.length){messages.push("No consumption data is available for the selected period.");}
    else {
        const units=[...new Set(usable.map(s=>s.material.unit||"unit"))];
        if(units.length>1) messages.push("Materials use different measurement units. Totals are kept separate to avoid misleading calculations.");
        const tiedMax=usable.filter(s=>s.total===Math.max(...usable.map(x=>x.total)));
        if(tiedMax.length>1 && units.length===1) messages.push(`${tiedMax.length} materials are tied for highest consumption.`);
        const noHistory=usable.filter(s=>s.trend.arrow==="none");
        if(noHistory.length) messages.push(`${noHistory.length} material${noHistory.length===1?" has":"s have"} not enough history for a reliable trend comparison.`);
        const lowHigh=usable.filter(s=>["Low","Critical"].includes(materialStatus(s.material)));
        if(lowHigh.length) messages.push(`${lowHigh.length} consumed material${lowHigh.length===1?" is":"s are"} currently low or critical in stock.`);
        const archived=usable.filter(s=>s.material.isActive===false);
        if(archived.length) messages.push("Historical consumption from archived materials is still included.");
    }
    list.innerHTML=messages.map(m=>`<li>${escapeHtml(m)}</li>`).join("");
}

function renderQuality(range) {
    const valid = validUsageRecords();
    const invalid = usageRecords.length - valid.length;
    const orphan = valid.filter(r=>!materials.some(m=>m.id===r.materialId));
    const mixed = [];
    const byMaterial = new Map();
    valid.forEach(r=>{if(!byMaterial.has(r.materialId))byMaterial.set(r.materialId,new Set());const m=materials.find(x=>x.id===r.materialId);byMaterial.get(r.materialId).add(m?.unit||r.unit||"unknown")});
    byMaterial.forEach((units,id)=>{if(units.size>1)mixed.push(id)});
    const messages=[];
    if(invalid) messages.push(`${invalid} invalid or zero/negative consumption record${invalid===1?"":"s"} excluded.`);
    if(orphan.length) messages.push(`${orphan.length} consumption record${orphan.length===1?"":"s"} reference a missing material and were excluded from material summaries.`);
    if(mixed.length) messages.push(`${mixed.length} material${mixed.length===1?" has":"s have"} inconsistent units and need data review.`);
    const box=$("analyticsDataQuality");
    if(!box)return;
    if(messages.length){box.hidden=false;box.innerHTML=`<strong>Data quality notice</strong><ul>${messages.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>`;}
    else box.hidden=true;
}

function renderPage(){
    const result=computeStats();
    if(result.error){showState("warning",`<strong>Check your date range.</strong><span>${escapeHtml(result.error)}</span>`);return;}
    hideState();
    renderSummary(result.stats,result.range);
    renderCharts(result.stats,result.range);
    renderTable(result.stats);
    renderRecent(result.range);
    renderInsights(result.stats);
    renderQuality(result.range);
}

async function loadAll(){
    try{
        showState("loading","Loading consumption analytics…");
        const [matSnap,usageSnap]=await Promise.all([getDocs(collection(db,"materials")),getDocs(collection(db,"usageRecords"))]);
        materials=matSnap.docs.map(d=>({id:d.id,...d.data()}));
        usageRecords=usageSnap.docs.map(d=>({id:d.id,...d.data()}));
        populateFilters();
        renderPage();
        if(!usageRecords.length) showState("info","<strong>No consumption records yet.</strong><span>Record material usage in Material Activity to begin building consumption analytics.</span>");
    }catch(error){console.error(error);showError("The system could not retrieve consumption records. Your data was not replaced with zeros.");}
}

function init(){
    if($('profileBtn') && currentUser) $('profileBtn').querySelector('.profile-text')?.replaceChildren(document.createTextNode(currentUser.fullName));
    loadAll();
}

onAuthStateChanged(auth, async user=>{
    if(!user){window.location.href="../login.html";return;}
    try{
        const snap=await getDoc(doc(db,"users",user.uid));
        if(!snap.exists()){window.location.href="../login.html";return;}
        const profile=snap.data();
        if(profile.role!=="user"){window.location.href="../admin/dashboard.html";return;}
        if(profile.status && profile.status!=="active"){window.location.href="../login.html";return;}
        currentUser={uid:user.uid,fullName:profile.fullName||"Staff"};
        document.body.classList.add("auth-verified");
        init();
    }catch(e){console.error(e);showError("Your account could not be verified. Please sign in again.");}
});

/* ==========================================================
   INFO ICON POPOVER
   ========================================================== */
let infoHideTimer = null;

function showInfoPopover(btn) {
    clearTimeout(infoHideTimer);
    const info = INFO_TEXT[btn.dataset.info];
    if (!info) return;
    const popover = $("infoPopover");
    if (!popover) return;
    $("infoPopoverTitle").textContent = `ⓘ ${info.title}`;
    $("infoPopoverBody").textContent = info.body;
    popover.hidden = false;
    void popover.offsetWidth;
    const rect = btn.getBoundingClientRect();
    const width = 280;
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    let top = rect.bottom + 8;
    if (top + 150 > window.innerHeight) top = Math.max(12, rect.top - 150);
    popover.style.left = `${Math.max(12, left)}px`;
    popover.style.top = `${top}px`;
    popover.classList.add("visible");
}

function scheduleHideInfoPopover() {
    const popover = $("infoPopover");
    if (!popover) return;
    clearTimeout(infoHideTimer);
    infoHideTimer = setTimeout(() => {
        popover.classList.remove("visible");
        infoHideTimer = setTimeout(() => { popover.hidden = true; }, 220);
    }, 60);
}

document.querySelectorAll(".info-icon").forEach(btn => {
    btn.addEventListener("mouseenter", () => showInfoPopover(btn));
    btn.addEventListener("mouseleave", scheduleHideInfoPopover);
    btn.addEventListener("focus", () => showInfoPopover(btn));
    btn.addEventListener("blur", scheduleHideInfoPopover);
    btn.addEventListener("touchstart", e => {
        e.stopPropagation();
        showInfoPopover(btn);
    }, { passive: true });
});

$("infoPopover")?.addEventListener("mouseenter", () => clearTimeout(infoHideTimer));
$("infoPopover")?.addEventListener("mouseleave", scheduleHideInfoPopover);
document.addEventListener("touchstart", e => {
    const popover = $("infoPopover");
    if (popover && !popover.hidden && !popover.contains(e.target) && !e.target.closest(".info-icon")) scheduleHideInfoPopover();
});

function bind(){
    [searchInput,categorySelect,unitSelect].forEach(el=>el?.addEventListener("input",()=>{currentPage=1;renderPage();}));
    dateRangeSelect?.addEventListener("change",()=>{startDateInput.value="";endDateInput.value="";currentRange=dateRangeSelect.value;currentPage=1;renderPage();});
    [startDateInput,endDateInput].forEach(el=>el?.addEventListener("change",()=>{currentPage=1;renderPage();}));
    resetFiltersBtn?.addEventListener("click",()=>{searchInput.value="";categorySelect.value="";unitSelect.value="";dateRangeSelect.value="week";startDateInput.value="";endDateInput.value="";currentPage=1;renderPage();});
    document.querySelectorAll(".period-btn").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".period-btn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");trendGranularity=btn.dataset.period;renderPage();}));
    $("viewAllRecentBtn")?.addEventListener("click",()=>{
        const result=computeStats();if(result.error)return;
        const recent=validUsageRecords().sort((a,b)=>normalizeDate(b.usageDate)-normalizeDate(a.usageDate));
        const list=$("modalHistoryList");
        list.innerHTML=recent.length?recent.map(r=>{const m=materials.find(x=>x.id===r.materialId);return `<div class="activity-item"><div><strong>${escapeHtml(m?.materialName||"Unknown material")}</strong><small>${normalizeDate(r.usageDate)?.toLocaleString()||"Unknown date"}</small></div><b>${formatQty(r.usedQuantity,m?.unit||r.unit||"")}</b></div>`}).join(""):"<div class='empty-state'>No consumption records found.</div>";
        $("modalOverlay").classList.add("active");
    });
    $("modalCloseBtn")?.addEventListener("click",()=>$("modalOverlay").classList.remove("active"));
    $("modalOverlay")?.addEventListener("click",e=>{if(e.target.id==="modalOverlay")$("modalOverlay").classList.remove("active")});
}

bind();
