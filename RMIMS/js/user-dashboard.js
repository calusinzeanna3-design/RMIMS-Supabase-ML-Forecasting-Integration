import {
    auth,
    db
} from "../supabase/supabase-config.js";

import {
    collection,
    query,
    orderBy,
    limit,
    getDocs,
    doc,
    getDoc
} from "../supabase/db-compat.js";

import {
    onAuthStateChanged
} from "../supabase/auth-compat.js";

/* ==========================
   ROLE PROTECTION + WELCOME
========================== */

const profileBtn =
document.getElementById("profileBtn");

const welcomeHeading =
document.getElementById("welcomeHeading");

function greetingWord(){
    const hour = new Date().getHours();
    if(hour < 12) return "Good morning";
    if(hour < 18) return "Good afternoon";
    return "Good evening";
}

onAuthStateChanged(auth, async(user)=>{

    if(!user){

        window.location.href =
        "../login.html";

        return;

    }

    const userDoc =
    await getDoc(
        doc(db,"users",user.uid)
    );

    if(!userDoc.exists()){

        window.location.href =
        "../login.html";

        return;

    }

    const data =
    userDoc.data();

    if(data.role !== "user"){

        window.location.href =
        "../admin/dashboard.html";

        return;

    }

    const firstName =
    (data.fullName || "there").split(" ")[0];

    profileBtn.querySelector(".profile-text").textContent =
    data.fullName || "Staff";

    if(welcomeHeading){
        welcomeHeading.textContent =
        `${greetingWord()}, ${firstName}`;
    }

    loadDashboard();

});

/* ==========================
   HELPERS
========================== */

function toMillis(ts){
    if(!ts) return 0;
    if(typeof ts.toMillis === "function") return ts.toMillis();
    if(typeof ts === "string") return new Date(ts).getTime();
    return 0;
}

function formatRelativeTime(ms){

    if(!ms) return "";

    const date = new Date(ms);
    const now = new Date();

    const isToday =
    date.toDateString() === now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
    date.toDateString() === yesterday.toDateString();

    const time = date.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});

    if(isToday) return `Today · ${time}`;
    if(isYesterday) return `Yesterday · ${time}`;

    return date.toLocaleDateString("en-US",{month:"short",day:"numeric"}) + ` · ${time}`;

}

function formatQty(qty, unit){
    const n = Number(qty);
    const num = Number.isFinite(n) ? n : 0;
    return unit ? `${num} ${unit}` : `${num}`;
}

function escapeHtml(str){
    return String(str ?? "").replace(/[&<>"']/g, (c)=>({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
}

/* ==========================
   DASHBOARD DATA
========================== */

async function loadDashboard(){

    let materials = [];
    let usageRecords = [];
    let stockReceipts = [];
    let materialsFailed = false;
    let activityFailed = false;

    try{

        const materialsSnap =
        await getDocs(collection(db,"materials"));

        materialsSnap.forEach((item)=>{
            materials.push({ id:item.id, ...item.data() });
        });

    }catch(err){

        console.error("Failed to load materials:", err);
        materialsFailed = true;

    }

    try{

        const usageSnap =
        await getDocs(
            query(
                collection(db,"usageRecords"),
                orderBy("createdAt","desc"),
                limit(25)
            )
        );

        usageSnap.forEach((item)=>{
            usageRecords.push({ id:item.id, ...item.data() });
        });

        const receiptsSnap =
        await getDocs(
            query(
                collection(db,"stockReceipts"),
                orderBy("createdAt","desc"),
                limit(25)
            )
        );

        receiptsSnap.forEach((item)=>{
            stockReceipts.push({ id:item.id, ...item.data() });
        });

    }catch(err){

        console.error("Failed to load material activity:", err);
        activityFailed = true;

    }

    renderSummary(materials, usageRecords, stockReceipts, materialsFailed, activityFailed);
    renderStatusList(materials, materialsFailed);
    renderAttentionList(materials, materialsFailed);
    renderActivityFeed(usageRecords, stockReceipts, activityFailed);
    renderReminders(materials, materialsFailed);

}

/* ==========================
   SUMMARY CARDS
========================== */

function renderSummary(materials, usageRecords, stockReceipts, materialsFailed, activityFailed){

    const totalEl = document.getElementById("kpiTotalMaterials");
    const stockEl = document.getElementById("kpiAvailableStock");
    const lowEl = document.getElementById("kpiLowStock");
    const activityEl = document.getElementById("kpiRecentActivity");

    [totalEl, stockEl, lowEl, activityEl].forEach(el=>el.classList.remove("kpi-skel"));

    if(materialsFailed){
        totalEl.textContent = "—";
        stockEl.textContent = "—";
        lowEl.textContent = "—";
    }else{
        const totalStock = materials.reduce((sum,m)=>sum + (Number(m.quantity) || 0), 0);
        const lowCount = materials.filter(m=> m.status === "Low" || m.status === "Critical").length;

        totalEl.textContent = materials.length;
        stockEl.textContent = totalStock.toLocaleString();
        lowEl.textContent = lowCount;
    }

    if(activityFailed){
        activityEl.textContent = "—";
    }else{
        activityEl.textContent = usageRecords.length + stockReceipts.length;
    }

}

/* ==========================
   INVENTORY STATUS
========================== */

function renderStatusList(materials, failed){

    const container = document.getElementById("statusList");

    if(failed){
        container.innerHTML = errorStateHtml("Unable to load inventory status.");
        return;
    }

    if(materials.length === 0){
        container.innerHTML = emptyStateHtml("No materials yet.", "Materials will appear here once they're added to inventory.");
        return;
    }

    const good = materials.filter(m=>m.status === "Available").length;
    const low = materials.filter(m=>m.status === "Low").length;
    const critical = materials.filter(m=>m.status === "Critical").length;

    container.innerHTML = `
        <div class="status-row">
            <span class="status-row-label"><span class="status-dot good"></span>Good</span>
            <span class="status-row-count">${good}</span>
        </div>
        <div class="status-row">
            <span class="status-row-label"><span class="status-dot warn"></span>Running Low</span>
            <span class="status-row-count">${low}</span>
        </div>
        <div class="status-row">
            <span class="status-row-label"><span class="status-dot bad"></span>Needs Restocking</span>
            <span class="status-row-count">${critical}</span>
        </div>
    `;

}

/* ==========================
   MATERIALS NEEDING ATTENTION
========================== */

function renderAttentionList(materials, failed){

    const container = document.getElementById("attentionList");
    const countEl = document.getElementById("attentionCount");

    if(failed){
        container.innerHTML = errorStateHtml("Unable to load materials needing attention.");
        countEl.textContent = "—";
        return;
    }

    const needing = materials
        .filter(m=> m.status === "Low" || m.status === "Critical")
        .sort((a,b)=> (a.status === "Critical" ? 0 : 1) - (b.status === "Critical" ? 0 : 1))
        .slice(0, 6);

    countEl.textContent = needing.length;

    if(needing.length === 0){
        container.innerHTML = emptyStateHtml("You're all caught up.", "No materials currently need attention.");
        return;
    }

    container.innerHTML = needing.map(m=>{
        const isCritical = m.status === "Critical";
        return `
            <div class="attention-row">
                <div>
                    <div class="attention-name">${escapeHtml(m.materialName)}</div>
                    <div class="attention-stock">Current stock: ${formatQty(m.quantity, m.unit)}</div>
                </div>
                <span class="pill ${isCritical ? "bad" : "warn"}">${isCritical ? "🔴 Needs Restocking" : "🟠 Running Low"}</span>
            </div>
        `;
    }).join("");

}

/* ==========================
   RECENT MATERIAL ACTIVITY
========================== */

function renderActivityFeed(usageRecords, stockReceipts, failed){

    const container = document.getElementById("activityFeed");
    const countEl = document.getElementById("activityCount");

    if(failed){
        container.innerHTML = errorStateHtml("Unable to load recent activity.");
        countEl.textContent = "—";
        return;
    }

    const used = usageRecords.map(r=>({
        type:"used",
        materialName:r.materialName,
        quantity:r.usedQuantity,
        unit:r.unit,
        ms:toMillis(r.createdAt)
    }));

    const received = stockReceipts.map(r=>({
        type:"received",
        materialName:r.materialName,
        quantity:r.receivedQuantity,
        unit:r.unit,
        ms:toMillis(r.createdAt)
    }));

    const combined = [...used, ...received]
        .sort((a,b)=> b.ms - a.ms)
        .slice(0, 6);

    countEl.textContent = used.length + received.length;

    if(combined.length === 0){
        container.innerHTML = emptyStateHtml("No material activity yet.", "Received and used material records will appear here once activity is recorded.");
        return;
    }

    container.innerHTML = combined.map(item=>{

        const isReceived = item.type === "received";

        return `
            <div class="activity-row">
                <div class="activity-icon ${isReceived ? "icon-green" : "icon-orange"}">
                    ${isReceived ? "📥" : "📤"}
                </div>
                <div class="activity-main">
                    <div class="activity-title">${escapeHtml(item.materialName)}</div>
                    <div class="activity-desc">${isReceived ? "Received" : "Used"} ${isReceived ? "+" : "−"}${formatQty(item.quantity, item.unit)}</div>
                </div>
                <div class="activity-time">${formatRelativeTime(item.ms)}</div>
            </div>
        `;

    }).join("");

}

/* ==========================
   STAFF REMINDERS
========================== */

let remindersVisible = true;

function renderReminders(materials, failed){

    const body = document.getElementById("remindersBody");
    const countEl = document.getElementById("reminderCount");
    const hideBtn = document.getElementById("remindersHideBtn");
    const collapsedRow = document.getElementById("remindersCollapsedRow");
    const collapsedCount = document.getElementById("remindersCollapsedCount");

    if(failed){
        body.innerHTML = errorStateHtml("Unable to load staff reminders.");
        countEl.textContent = "—";
        hideBtn.hidden = true;
        return;
    }

    const critical = materials
        .filter(m=>m.status === "Critical")
        .map(m=>({
            priority:"bad",
            icon:"🔴",
            title:`${m.materialName} needs attention`,
            sub:`Current stock: ${formatQty(m.quantity, m.unit)}`
        }));

    const low = materials
        .filter(m=>m.status === "Low")
        .map(m=>({
            priority:"warn",
            icon:"🟠",
            title:`${m.materialName} is running low`,
            sub:`Current stock: ${formatQty(m.quantity, m.unit)}`
        }));

    const reminders = [...critical, ...low].slice(0, 6);

    countEl.textContent = reminders.length;

    function renderBody(){

        if(reminders.length === 0){
            body.innerHTML = `
                <div class="empty-state">
                    <strong>✓ You're all caught up.</strong>
                    <span>No inventory actions need your attention.</span>
                </div>
            `;
            hideBtn.hidden = true;
            collapsedRow.hidden = true;
            return;
        }

        if(!remindersVisible){
            body.innerHTML = "";
            hideBtn.hidden = true;
            collapsedRow.hidden = false;
            collapsedCount.textContent = reminders.length;
            return;
        }

        collapsedRow.hidden = true;
        hideBtn.hidden = false;

        body.innerHTML = `
            <div class="reminder-list">
                ${reminders.map(r=>`
                    <div class="reminder-item priority-${r.priority}">
                        <span class="reminder-icon">${r.icon}</span>
                        <div class="reminder-body">
                            <div class="reminder-title">${escapeHtml(r.title)}</div>
                            <div class="reminder-sub">${escapeHtml(r.sub)}</div>
                            <a class="reminder-action" href="inventory.html">View Inventory →</a>
                        </div>
                    </div>
                `).join("")}
            </div>
        `;

    }

    renderBody();

    hideBtn.onclick = ()=>{
        remindersVisible = false;
        renderBody();
    };

    collapsedRow.onclick = ()=>{
        remindersVisible = true;
        renderBody();
    };

}

/* ==========================
   SHARED EMPTY / ERROR STATE MARKUP
========================== */

function emptyStateHtml(title, sub){
    return `
        <div class="empty-state">
            <strong>${escapeHtml(title)}</strong>
            ${sub ? `<span>${escapeHtml(sub)}</span>` : ""}
        </div>
    `;
}

function errorStateHtml(message){
    return `
        <div class="error-state">
            <strong>${escapeHtml(message)}</strong>
            <button class="retry-btn" onclick="location.reload()">Retry</button>
        </div>
    `;
}
