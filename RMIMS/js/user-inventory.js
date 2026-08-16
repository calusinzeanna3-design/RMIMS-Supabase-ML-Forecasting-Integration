import {
    auth,
    db
} from "../supabase/supabase-config.js";

import {
    collection,
    getDocs,
    doc,
    getDoc
} from "../supabase/db-compat.js";

import {
    onAuthStateChanged
} from "../supabase/auth-compat.js";

/* ==========================
   ROLE PROTECTION
   (view-only page — no write operations anywhere below)
========================== */

const profileBtn =
document.getElementById("profileBtn");

onAuthStateChanged(auth, async(user)=>{

    if(!user){
        window.location.href = "../login.html";
        return;
    }

    const userDoc =
    await getDoc(doc(db,"users",user.uid));

    if(!userDoc.exists()){
        window.location.href = "../login.html";
        return;
    }

    const data = userDoc.data();

    if(data.role !== "user"){
        window.location.href = "../admin/dashboard.html";
        return;
    }

    profileBtn.textContent = data.fullName || "Staff";

    document.body.classList.add("auth-verified");
    loadInventory();

});

/* ==========================
   STATE
========================== */

const state = {
    materials: [],          // { id, materialName, category, unit, quantity, status, received, disbursed, lastActivityMs }
    materialsFailed: false,
    activityFailed: false,
    search: "",
    category: "",
    status: "",
    unit: "",
    sortField: "materialName",
    sortDir: "asc",
    page: 1,
    rowsPerPage: 10,
    expanded: false
};

const STORAGE_KEY = "rmims-user-inventory-expanded";

/* ==========================
   HELPERS
========================== */

function toMillis(ts){
    if(!ts) return 0;
    if(typeof ts.toMillis === "function") return ts.toMillis();
    if(typeof ts === "string") return new Date(ts).getTime();
    return 0;
}

function formatQty(qty, unit){
    const n = Number(qty);
    const num = Number.isFinite(n) ? n : 0;
    return unit ? `${num.toLocaleString()} ${unit}` : num.toLocaleString();
}

function formatDateTime(ms){
    if(!ms) return "—";
    const date = new Date(ms);
    return date.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}) +
        " " + date.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
}

function formatDateOnly(ms){
    if(!ms) return "—";
    return new Date(ms).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"});
}

function escapeHtml(str){
    return String(str ?? "").replace(/[&<>"']/g, (c)=>({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
}

function statusInfo(status){
    if(status === "Available") return { cls:"available", label:"🟢 Good" };
    if(status === "Low") return { cls:"low", label:"🟠 Running Low" };
    if(status === "Critical") return { cls:"critical", label:"🔴 Needs Restocking" };
    return { cls:"available", label:"—" };
}

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
            <button type="button" class="retry-btn btn-secondary" id="inventoryRetryBtn">Retry</button>
        </div>
    `;
}

/* ==========================
   LOAD DATA
========================== */

async function loadInventory(){

    // Restore remembered collapse/expand state for this session (default: collapsed)
    try{
        state.expanded = sessionStorage.getItem(STORAGE_KEY) === "1";
    }catch(err){
        state.expanded = false;
    }
    syncActivityToggleUI();

    let materials = [];
    let usageRecords = [];
    let stockReceipts = [];

    try{

        const materialsSnap = await getDocs(collection(db,"materials"));
        materialsSnap.forEach((item)=>{
            materials.push({ id:item.id, ...item.data() });
        });

    }catch(err){
        console.error("Failed to load materials:", err);
        state.materialsFailed = true;
    }

    try{

        const usageSnap = await getDocs(collection(db,"usageRecords"));
        usageSnap.forEach((item)=>{
            usageRecords.push({ id:item.id, ...item.data() });
        });

        const receiptsSnap = await getDocs(collection(db,"stockReceipts"));
        receiptsSnap.forEach((item)=>{
            stockReceipts.push({ id:item.id, ...item.data() });
        });

    }catch(err){
        console.error("Failed to load material activity:", err);
        state.activityFailed = true;
    }

    // Aggregate Received (Total) / Disbursed (Total) / Last Activity per material
    const receivedByMaterial = {};
    const disbursedByMaterial = {};
    const lastActivityByMaterial = {};

    stockReceipts.forEach((r)=>{
        if(!r.materialId) return;
        receivedByMaterial[r.materialId] = (receivedByMaterial[r.materialId] || 0) + (Number(r.receivedQuantity) || 0);
        const ms = toMillis(r.createdAt);
        if(ms > (lastActivityByMaterial[r.materialId] || 0)){
            lastActivityByMaterial[r.materialId] = ms;
        }
    });

    usageRecords.forEach((r)=>{
        if(!r.materialId) return;
        disbursedByMaterial[r.materialId] = (disbursedByMaterial[r.materialId] || 0) + (Number(r.usedQuantity) || 0);
        const ms = toMillis(r.createdAt);
        if(ms > (lastActivityByMaterial[r.materialId] || 0)){
            lastActivityByMaterial[r.materialId] = ms;
        }
    });

    state.materials = materials.map((m)=>{

        const fallbackMs = toMillis(m.updatedAt) || toMillis(m.createdAt) || 0;
        const lastActivityMs = lastActivityByMaterial[m.id] || fallbackMs;

        return {
            id: m.id,
            materialName: m.materialName || "Untitled Material",
            category: m.category || "Uncategorized",
            unit: m.unit || "",
            quantity: Number(m.quantity) || 0,
            status: m.status || "Available",
            received: receivedByMaterial[m.id] || 0,
            disbursed: disbursedByMaterial[m.id] || 0,
            lastActivityMs
        };

    });

    populateFilterOptions();
    renderSummaryCards();
    state.page = 1;
    renderTable();

}

/* ==========================
   SUMMARY CARDS
========================== */

function renderSummaryCards(){

    const totalEl = document.getElementById("cardTotalCount");
    const stockEl = document.getElementById("cardAvailableStock");
    const lowEl = document.getElementById("cardLowStockCount");
    const updatedEl = document.getElementById("cardLastUpdated");

    [totalEl, stockEl, lowEl, updatedEl].forEach(el=>el.classList.remove("skel"));

    if(state.materialsFailed){
        totalEl.textContent = "—";
        stockEl.textContent = "—";
        lowEl.textContent = "—";
        updatedEl.textContent = "—";
        return;
    }

    const materials = state.materials;
    const totalStock = materials.reduce((sum,m)=>sum + m.quantity, 0);
    const lowCount = materials.filter(m=>m.status === "Low" || m.status === "Critical").length;
    const latestMs = materials.reduce((max,m)=>Math.max(max, m.lastActivityMs || 0), 0);

    totalEl.textContent = materials.length.toLocaleString();
    stockEl.textContent = totalStock.toLocaleString();
    lowEl.textContent = lowCount.toLocaleString();
    updatedEl.textContent = latestMs ? formatDateTime(latestMs) : "—";

}

/* ==========================
   FILTER OPTIONS
========================== */

function populateFilterOptions(){

    const categoryFilter = document.getElementById("categoryFilter");
    const unitFilter = document.getElementById("unitFilter");

    const categories = [...new Set(state.materials.map(m=>m.category).filter(Boolean))].sort();
    const units = [...new Set(state.materials.map(m=>m.unit).filter(Boolean))].sort();

    const currentCategory = categoryFilter.value;
    const currentUnit = unitFilter.value;

    categoryFilter.innerHTML = `<option value="">All Categories</option>` +
        categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

    unitFilter.innerHTML = `<option value="">All Units</option>` +
        units.map(u=>`<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");

    categoryFilter.value = categories.includes(currentCategory) ? currentCategory : "";
    unitFilter.value = units.includes(currentUnit) ? currentUnit : "";

}

/* ==========================
   FILTER + SORT + PAGINATE + RENDER
========================== */

function getFilteredSortedMaterials(){

    const term = state.search.trim().toLowerCase();

    let list = state.materials.filter((m)=>{

        if(state.category && m.category !== state.category) return false;
        if(state.status && m.status !== state.status) return false;
        if(state.unit && m.unit !== state.unit) return false;

        if(term){
            const haystack = `${m.materialName} ${m.id} ${m.category}`.toLowerCase();
            if(!haystack.includes(term)) return false;
        }

        return true;

    });

    const dir = state.sortDir === "asc" ? 1 : -1;

    list = list.slice().sort((a,b)=>{

        let av = a[state.sortField];
        let bv = b[state.sortField];

        if(typeof av === "string") av = av.toLowerCase();
        if(typeof bv === "string") bv = bv.toLowerCase();

        if(av < bv) return -1 * dir;
        if(av > bv) return 1 * dir;
        return 0;

    });

    return list;

}

function renderTable(){

    const tbody = document.getElementById("inventoryTableBody");
    const resultCount = document.getElementById("resultCount");
    const tableFooter = document.getElementById("tableFooter");
    const table = document.getElementById("inventoryTable");

    table.classList.toggle("expanded", state.expanded);

    if(state.materialsFailed){
        tbody.innerHTML = `<tr><td colspan="8">${errorStateHtml("Unable to load inventory information.")}</td></tr>`;
        resultCount.textContent = "";
        tableFooter.hidden = true;
        wireRetryButton();
        return;
    }

    if(state.materials.length === 0){
        tbody.innerHTML = `<tr><td colspan="8">${emptyStateHtml("No raw materials available.", "Inventory information will appear here once materials are added.")}</td></tr>`;
        resultCount.textContent = "";
        tableFooter.hidden = true;
        return;
    }

    const filtered = getFilteredSortedMaterials();

    resultCount.textContent = `${filtered.length} of ${state.materials.length} materials`;

    if(filtered.length === 0){
        tbody.innerHTML = `<tr><td colspan="8">${emptyStateHtml("No materials match your search.", "Try adjusting your search or filters.")}</td></tr>`;
        tableFooter.hidden = true;
        return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.rowsPerPage));
    if(state.page > totalPages) state.page = totalPages;

    const startIdx = (state.page - 1) * state.rowsPerPage;
    const pageItems = filtered.slice(startIdx, startIdx + state.rowsPerPage);

    tbody.innerHTML = pageItems.map((m)=>{

        const st = statusInfo(m.status);

        return `
            <tr>
                <td data-label="Raw Material"><strong>${escapeHtml(m.materialName)}</strong></td>
                <td data-label="Category">${escapeHtml(m.category)}</td>
                <td data-label="Unit">${escapeHtml(m.unit || "—")}</td>
                <td data-label="Current Stock" class="col-right">${escapeHtml(formatQty(m.quantity, m.unit))}</td>
                <td data-label="Received (Total)" class="col-right activity-col qty-received">+${escapeHtml(formatQty(m.received, m.unit))}</td>
                <td data-label="Disbursed (Total)" class="col-right activity-col qty-disbursed">−${escapeHtml(formatQty(m.disbursed, m.unit))}</td>
                <td data-label="Status"><span class="status ${st.cls}">${st.label}</span></td>
                <td data-label="Last Activity">${escapeHtml(formatDateOnly(m.lastActivityMs))}</td>
            </tr>
        `;

    }).join("");

    tableFooter.hidden = false;
    renderPagination(filtered.length, totalPages, startIdx, pageItems.length);

}

function renderPagination(totalItems, totalPages, startIdx, pageItemCount){

    const pageInfo = document.getElementById("pageInfo");
    const pageNumbers = document.getElementById("pageNumbers");
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");

    const from = totalItems === 0 ? 0 : startIdx + 1;
    const to = startIdx + pageItemCount;

    pageInfo.textContent = `Showing ${from}–${to} of ${totalItems} materials`;

    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= totalPages;

    const pages = paginationWindow(state.page, totalPages);

    pageNumbers.innerHTML = pages.map((p)=>{
        if(p === "…"){
            return `<span class="page-num ellipsis">…</span>`;
        }
        return `<button type="button" class="page-num ${p === state.page ? "active" : ""}" data-page="${p}">${p}</button>`;
    }).join("");

    pageNumbers.querySelectorAll("[data-page]").forEach((btn)=>{
        btn.addEventListener("click", ()=>{
            state.page = Number(btn.dataset.page);
            renderTable();
        });
    });

}

function paginationWindow(current, total){

    if(total <= 7) return Array.from({length:total}, (_,i)=>i+1);

    const pages = new Set([1, total, current, current-1, current+1]);
    const sorted = [...pages].filter(p=>p>=1 && p<=total).sort((a,b)=>a-b);

    const result = [];
    let prev = 0;

    sorted.forEach((p)=>{
        if(prev && p - prev > 1) result.push("…");
        result.push(p);
        prev = p;
    });

    return result;

}

function wireRetryButton(){
    const btn = document.getElementById("inventoryRetryBtn");
    if(btn){
        btn.addEventListener("click", ()=>location.reload());
    }
}

/* ==========================
   ACTIVITY DETAILS TOGGLE
========================== */

function syncActivityToggleUI(){

    const btn = document.getElementById("activityToggleBtn");
    const label = document.getElementById("activityToggleLabel");

    btn.setAttribute("aria-expanded", state.expanded ? "true" : "false");
    label.textContent = state.expanded
        ? "Hide Receive & Disbursement Details"
        : "Show Receive & Disbursement Details";

}

document.getElementById("activityToggleBtn").addEventListener("click", ()=>{

    state.expanded = !state.expanded;

    try{
        sessionStorage.setItem(STORAGE_KEY, state.expanded ? "1" : "0");
    }catch(err){
        // sessionStorage unavailable — safe to ignore, state still holds in-memory
    }

    syncActivityToggleUI();
    renderTable();

});

/* ==========================
   SEARCH / FILTERS / SORT / PAGE SIZE
========================== */

document.getElementById("searchInput").addEventListener("input", function(){
    state.search = this.value;
    state.page = 1;
    renderTable();
    syncFilterClearButton();
});

document.getElementById("categoryFilter").addEventListener("change", function(){
    state.category = this.value;
    state.page = 1;
    renderTable();
    syncFilterClearButton();
});

document.getElementById("statusFilter").addEventListener("change", function(){
    state.status = this.value;
    state.page = 1;
    renderTable();
    syncFilterClearButton();
});

document.getElementById("unitFilter").addEventListener("change", function(){
    state.unit = this.value;
    state.page = 1;
    renderTable();
    syncFilterClearButton();
});

document.getElementById("filterClearBtn").addEventListener("click", ()=>{

    state.search = "";
    state.category = "";
    state.status = "";
    state.unit = "";
    state.page = 1;

    document.getElementById("searchInput").value = "";
    document.getElementById("categoryFilter").value = "";
    document.getElementById("statusFilter").value = "";
    document.getElementById("unitFilter").value = "";

    renderTable();
    syncFilterClearButton();

});

function syncFilterClearButton(){
    const btn = document.getElementById("filterClearBtn");
    const active = !!(state.search || state.category || state.status || state.unit);
    btn.hidden = !active;
}

document.getElementById("rowsPerPageSelect").addEventListener("change", function(){
    state.rowsPerPage = Number(this.value) || 10;
    state.page = 1;
    renderTable();
});

document.getElementById("prevPageBtn").addEventListener("click", ()=>{
    if(state.page > 1){
        state.page -= 1;
        renderTable();
    }
});

document.getElementById("nextPageBtn").addEventListener("click", ()=>{
    state.page += 1; // renderTable() clamps to the last valid page
    renderTable();
});

document.querySelectorAll("#inventoryTable th.sortable").forEach((th)=>{

    th.addEventListener("click", ()=>{

        const field = th.dataset.sort;

        if(state.sortField === field){
            state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        }else{
            state.sortField = field;
            state.sortDir = "asc";
        }

        document.querySelectorAll("#inventoryTable th.sortable").forEach((h)=>{
            h.classList.remove("sort-active");
            const arrow = h.querySelector(".sort-arrow");
            if(arrow) arrow.remove();
        });

        th.classList.add("sort-active");
        const arrow = document.createElement("span");
        arrow.className = "sort-arrow";
        arrow.textContent = state.sortDir === "asc" ? "▲" : "▼";
        th.appendChild(arrow);

        renderTable();

    });

});
