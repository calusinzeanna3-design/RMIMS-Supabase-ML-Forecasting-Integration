import {
    auth,
    db
} from "../supabase/supabase-config.js";

import {
    collection,
    getDocs,
    addDoc,
    doc,
    getDoc,
    serverTimestamp
}
from "../supabase/db-compat.js";

import {
    onAuthStateChanged
}
from "../supabase/auth-compat.js";

/* ==========================
   ROLE PROTECTION
========================== */

const profileBtn = document.getElementById("profileBtn");
let currentUser = null; // { uid, fullName }

onAuthStateChanged(auth, async(user)=>{

    if(!user){
        window.location.href = "../login.html";
        return;
    }

    const userDoc = await getDoc(doc(db,"users",user.uid));

    if(!userDoc.exists()){
        window.location.href = "../login.html";
        return;
    }

    const data = userDoc.data();

    if(data.role !== "user"){
        window.location.href = "../admin/dashboard.html";
        return;
    }

    currentUser = { uid: user.uid, fullName: data.fullName || "Staff" };
    profileBtn.textContent = `${data.fullName} ▼`;

});

/* ==========================
   STATE
========================== */

const state = {
    products: [],          // [{id, productName, category, icon}]
    productMaterials: [],  // [{productId, materialId}]
    materials: {},         // materialId -> {materialName, category, unit, quantity, minimumThreshold, status, isActive}
    recent: [],            // combined usage + receipt records, newest first
    selectedProductId: null,
    receiveQty: {},         // materialId -> number
    usedQty: {},            // materialId -> number
    savingReceive: false,
    savingUsed: false
};

/* ==========================
   HELPERS
========================== */

function escapeHtml(str){
    return String(str ?? "").replace(/[&<>"']/g, (c)=>({
        "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
    }[c]));
}

function formatQty(qty, unit){
    const n = Number(qty) || 0;
    const rounded = Math.round(n * 100) / 100;
    return `${rounded} ${unit || ""}`.trim();
}

function computeStatus(quantity, minimumThreshold){
    const threshold = Number(minimumThreshold) || 0;
    if(quantity <= threshold / 2) return "Critical";
    if(quantity <= threshold) return "Low";
    return "Available";
}

function statusInfo(status){
    if(status === "Critical") return { cls:"critical", label:"🔴 Critical" };
    if(status === "Low") return { cls:"low", label:"🟠 Low" };
    return { cls:"available", label:"🟢 Good" };
}

function toMillis(ts){
    if(!ts) return 0;
    if(typeof ts.toMillis === "function") return ts.toMillis();
    if(typeof ts.seconds === "number") return ts.seconds * 1000;
    const ms = new Date(ts).getTime();
    return Number.isNaN(ms) ? 0 : ms;
}

function toast(message, type = "success"){
    const stack = document.getElementById("toastStack");
    const el = document.createElement("div");
    el.className = `toast ${type === "success" ? "" : type}`.trim();
    el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>`;
    stack.appendChild(el);
    setTimeout(()=>{ el.remove(); }, 4200);
}

function isDirty(){
    return Object.values(state.receiveQty).some(q=>q>0) || Object.values(state.usedQty).some(q=>q>0);
}

/* ---- confirm modal (Cancel / Discard-or-Continue) ---- */

const confirmModal = document.getElementById("confirmModal");
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalMessage = document.getElementById("confirmModalMessage");
const confirmModalCancel = document.getElementById("confirmModalCancel");
const confirmModalConfirm = document.getElementById("confirmModalConfirm");

function confirmDialog({ title, message, confirmLabel = "Discard Changes", cancelLabel = "Cancel" }){
    return new Promise(resolve=>{
        confirmModalTitle.textContent = title;
        confirmModalMessage.textContent = message;
        confirmModalConfirm.textContent = confirmLabel;
        confirmModalCancel.textContent = cancelLabel;
        confirmModal.classList.add("open");

        function cleanup(result){
            confirmModal.classList.remove("open");
            confirmModalCancel.removeEventListener("click", onCancel);
            confirmModalConfirm.removeEventListener("click", onConfirm);
            resolve(result);
        }
        function onCancel(){ cleanup(false); }
        function onConfirm(){ cleanup(true); }

        confirmModalCancel.addEventListener("click", onCancel);
        confirmModalConfirm.addEventListener("click", onConfirm);
    });
}

/* ==========================
   LOAD DATA
========================== */

async function loadAll(){

    const [productsSnap, productMaterialsSnap, materialsSnap, usageSnap, receiptsSnap] = await Promise.all([
        getDocs(collection(db,"finishedProducts")),
        getDocs(collection(db,"productMaterialRequirements")),
        getDocs(collection(db,"materials")),
        getDocs(collection(db,"usageRecords")),
        getDocs(collection(db,"stockReceipts"))
    ]);

    state.products = productsSnap.docs
        .map(d=>({ id:d.id, ...d.data() }))
        .filter(p => (p.status || "Active") === "Active")
        .map(p => ({ ...p, icon: "📦" }));
    state.productMaterials = productMaterialsSnap.docs.map(d=>d.data());

    state.materials = {};
    materialsSnap.forEach(m=>{
        state.materials[m.id] = { id:m.id, ...m.data() };
    });

    state.recent = mergeRecent(usageSnap, receiptsSnap);

}

function mergeRecent(usageSnap, receiptsSnap){
    const usageRows = usageSnap.docs.map(d=>({ ...d.data(), _type:"used" }));
    const receiptRows = receiptsSnap.docs.map(d=>({ ...d.data(), _type:"receive" }));
    return [...usageRows, ...receiptRows]
        .sort((a,b)=> toMillis(b.createdAt) - toMillis(a.createdAt))
        .slice(0, 8);
}

/* ==========================
   PRODUCT PICKER
========================== */

const pickerBtn = document.getElementById("productPickerBtn");
const pickerLabel = document.getElementById("productPickerLabel");
const pickerPanel = document.getElementById("productPickerPanel");
const pickerList = document.getElementById("productPickerList");
const pickerSearch = document.getElementById("productSearchInput");

function renderProductPicker(filterText = ""){

    if(state.products.length === 0){
        pickerList.innerHTML = `<div class="pp-empty">No finished products are set up yet.</div>`;
        return;
    }

    const term = filterText.trim().toLowerCase();

    const filtered = state.products.filter(p=>
        !term || p.productName.toLowerCase().includes(term) || (p.category || "").toLowerCase().includes(term)
    );

    if(filtered.length === 0){
        pickerList.innerHTML = `<div class="pp-empty">No products match "${escapeHtml(filterText)}".</div>`;
        return;
    }

    const byCategory = {};
    filtered.forEach(p=>{
        const cat = p.category || "Other";
        (byCategory[cat] ||= []).push(p);
    });

    pickerList.innerHTML = Object.entries(byCategory).map(([cat, items])=>`
        <div class="pp-group-label">${escapeHtml(cat)}</div>
        ${items.map(p=>`
            <button type="button" class="pp-item" data-id="${p.id}">
                <span class="pp-item-emoji">${p.icon || "📦"}</span>
                <span>${escapeHtml(p.productName)}</span>
            </button>
        `).join("")}
    `).join("");

    pickerList.querySelectorAll(".pp-item").forEach(btn=>{
        btn.addEventListener("click", ()=>{
            requestSelectProduct(btn.dataset.id);
            closePicker();
        });
    });

}

function openPicker(){
    pickerPanel.classList.add("open");
    renderProductPicker(pickerSearch.value);
    pickerSearch.focus();
}

function closePicker(){
    pickerPanel.classList.remove("open");
}

pickerBtn.addEventListener("click", ()=>{
    pickerPanel.classList.contains("open") ? closePicker() : openPicker();
});

document.addEventListener("click", (e)=>{
    if(!document.getElementById("productPicker").contains(e.target)){
        closePicker();
    }
});

pickerSearch.addEventListener("input", function(){
    renderProductPicker(this.value);
});

/* ==========================
   SELECT PRODUCT (with unsaved-changes guard)
========================== */

async function requestSelectProduct(productId){

    if(productId === state.selectedProductId) return;

    if(state.selectedProductId && isDirty()){
        const discard = await confirmDialog({
            title: "Unsaved changes",
            message: "You have unsaved changes. Do you want to discard them?",
            confirmLabel: "Discard Changes",
            cancelLabel: "Cancel"
        });
        if(!discard) return; // keep current product + entered quantities
    }

    selectProduct(productId);

}

function selectProduct(productId){

    state.selectedProductId = productId;
    state.receiveQty = {};
    state.usedQty = {};

    const product = state.products.find(p=>p.id === productId);
    if(!product) return;

    pickerLabel.textContent = product.productName;
    pickerLabel.classList.add("has-value");

    const materialIds = currentMaterialIds();

    materialIds.forEach(id=>{
        state.receiveQty[id] = 0;
        state.usedQty[id] = 0;
    });

    renderSelectedProductArea(product, materialIds);
    renderReceiveTable(materialIds);
    renderUsedTable(materialIds);

    document.getElementById("receiveCard").style.display = materialIds.length ? "" : "none";
    document.getElementById("usedCard").style.display = materialIds.length ? "" : "none";

}

function currentMaterialIds(){
    if(!state.selectedProductId) return [];
    return state.productMaterials
        .filter(pm=>pm.productId === state.selectedProductId)
        .map(pm=>pm.materialId);
}

function renderSelectedProductArea(product, materialIds){

    const area = document.getElementById("selectedProductArea");

    if(materialIds.length === 0){
        area.innerHTML = `
            <div class="selected-product-card fade-in">
                <div class="spc-emoji">${product.icon || "📦"}</div>
                <div>
                    <div class="spc-eyebrow">Selected Product</div>
                    <div class="spc-name">${escapeHtml(product.productName)}</div>
                    <div class="spc-meta">${escapeHtml(product.category || "")}</div>
                </div>
            </div>
            <div class="empty-state fade-in" style="background:var(--card-bg); border:1px solid var(--line-soft); border-radius:var(--radius-lg); box-shadow:var(--shadow-soft); margin-bottom:22px;">
                <span>No raw materials are currently associated with this finished product.</span>
            </div>
        `;
        return;
    }

    area.innerHTML = `
        <div class="selected-product-card fade-in">
            <div class="spc-emoji">${product.icon || "📦"}</div>
            <div>
                <div class="spc-eyebrow">Selected Product</div>
                <div class="spc-name">${escapeHtml(product.productName)}</div>
                <div class="spc-meta">${escapeHtml(product.category || "")} · ${materialIds.length} raw material${materialIds.length === 1 ? "" : "s"}</div>
            </div>
        </div>
    `;

}

function renderNoProductState(){
    const area = document.getElementById("selectedProductArea");
    area.innerHTML = `
        <div class="no-product-card fade-in">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L21 7V17L12 22L3 17V7L12 2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 2V22M3 7L12 12M21 7L12 12" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            <strong>Select a finished product to begin.</strong>
            <span>The raw materials for the selected product will appear here.</span>
        </div>
    `;
    document.getElementById("receiveCard").style.display = "none";
    document.getElementById("usedCard").style.display = "none";
}

/* ==========================
   RECEIVE TABLE
========================== */

function renderReceiveTable(materialIds){

    const tbody = document.getElementById("receiveTableBody");

    tbody.innerHTML = materialIds.map(id=>{
        const m = state.materials[id];
        if(!m) return "";
        const qty = state.receiveQty[id] || 0;
        const after = (Number(m.quantity) || 0) + qty;
        const st = statusInfo(m.status);
        const inactive = m.isActive === false;

        if(inactive){
            return `
            <tr data-material-id="${id}" class="row-disabled">
                <td data-label="Raw Material">
                    <span class="mat-name">${escapeHtml(m.materialName)}</span>
                    <div class="row-unavailable-note">This material is currently unavailable for activity.</div>
                </td>
                <td data-label="Current Stock" class="col-right">${escapeHtml(formatQty(m.quantity, m.unit))}</td>
                <td data-label="Receive" class="col-right">—</td>
                <td data-label="After Receive" class="col-right">—</td>
                <td data-label="Status"><span class="status ${st.cls}">${st.label}</span></td>
            </tr>
            `;
        }

        return `
        <tr data-material-id="${id}">
            <td data-label="Raw Material"><span class="mat-name">${escapeHtml(m.materialName)}</span></td>
            <td data-label="Current Stock" class="col-right">${escapeHtml(formatQty(m.quantity, m.unit))}</td>
            <td data-label="Receive" class="col-right">
                <span class="stepper">
                    <button type="button" class="stepper-btn" data-action="dec" data-table="receive">−</button>
                    <span class="stepper-value" data-role="receive-value">${qty}</span>
                    <button type="button" class="stepper-btn" data-action="inc" data-table="receive">+</button>
                </span>
            </td>
            <td data-label="After Receive" class="col-right">
                <span class="after-value ${qty > 0 ? "changed" : ""}" data-role="receive-after">${formatQty(after, m.unit)}</span>
            </td>
            <td data-label="Status"><span class="status ${st.cls}">${st.label}</span></td>
        </tr>
        `;
    }).join("");

    tbody.querySelectorAll(".stepper-btn[data-table='receive']").forEach(btn=>{
        btn.addEventListener("click", ()=>{
            const row = btn.closest("tr");
            const id = row.dataset.materialId;
            const delta = btn.dataset.action === "inc" ? 1 : -1;
            const next = Math.max(0, (state.receiveQty[id] || 0) + delta);
            state.receiveQty[id] = next;
            updateReceiveRow(row, id);
            updateReceiveSummary();
        });
    });

    updateReceiveSummary();

}

function updateReceiveRow(row, id){
    const m = state.materials[id];
    const qty = state.receiveQty[id] || 0;
    row.querySelector("[data-role='receive-value']").textContent = qty;
    const afterEl = row.querySelector("[data-role='receive-after']");
    const after = (Number(m.quantity) || 0) + qty;
    afterEl.textContent = formatQty(after, m.unit);
    afterEl.classList.toggle("changed", qty > 0);
}

function updateReceiveSummary(){
    const entries = Object.entries(state.receiveQty).filter(([,q])=>q > 0);
    const summaryEl = document.getElementById("receiveSummaryText");
    const saveBtn = document.getElementById("saveReceiveBtn");

    if(entries.length === 0){
        summaryEl.innerHTML = "No materials selected to receive yet.";
        saveBtn.disabled = true;
        return;
    }

    const parts = entries.map(([id,q])=>{
        const m = state.materials[id];
        return `${m.materialName} +${formatQty(q, m.unit)}`;
    });

    summaryEl.innerHTML = `<strong>${entries.length} material${entries.length === 1 ? "" : "s"}</strong> to receive: ${escapeHtml(parts.join(", "))}`;
    saveBtn.disabled = false;
}

/* ==========================
   USED TABLE
========================== */

function renderUsedTable(materialIds){

    const tbody = document.getElementById("usedTableBody");

    tbody.innerHTML = materialIds.map(id=>{
        const m = state.materials[id];
        if(!m) return "";
        const qty = state.usedQty[id] || 0;
        const current = Number(m.quantity) || 0;
        const after = current - qty;
        const st = statusInfo(m.status);
        const atMax = qty >= current;
        const inactive = m.isActive === false;

        if(inactive){
            return `
            <tr data-material-id="${id}" class="row-disabled">
                <td data-label="Raw Material">
                    <span class="mat-name">${escapeHtml(m.materialName)}</span>
                    <div class="row-unavailable-note">This material is currently unavailable for activity.</div>
                </td>
                <td data-label="Current Stock" class="col-right">${escapeHtml(formatQty(m.quantity, m.unit))}</td>
                <td data-label="Used" class="col-right">—</td>
                <td data-label="After Used" class="col-right">—</td>
                <td data-label="Status"><span class="status ${st.cls}">${st.label}</span></td>
            </tr>
            `;
        }

        return `
        <tr data-material-id="${id}">
            <td data-label="Raw Material"><span class="mat-name">${escapeHtml(m.materialName)}</span></td>
            <td data-label="Current Stock" class="col-right">${escapeHtml(formatQty(m.quantity, m.unit))}</td>
            <td data-label="Used" class="col-right">
                <span class="stepper">
                    <button type="button" class="stepper-btn" data-action="dec" data-table="used">−</button>
                    <span class="stepper-value" data-role="used-value">${qty}</span>
                    <button type="button" class="stepper-btn" data-action="inc" data-table="used" ${atMax ? "disabled" : ""}>+</button>
                </span>
            </td>
            <td data-label="After Used" class="col-right">
                <span class="after-value ${qty > 0 ? "changed" : ""}" data-role="used-after">${formatQty(after, m.unit)}</span>
            </td>
            <td data-label="Status"><span class="status ${st.cls}">${st.label}</span></td>
        </tr>
        `;
    }).join("");

    tbody.querySelectorAll(".stepper-btn[data-table='used']").forEach(btn=>{
        btn.addEventListener("click", ()=>{
            const row = btn.closest("tr");
            const id = row.dataset.materialId;
            const m = state.materials[id];
            const current = Number(m.quantity) || 0;

            if(btn.dataset.action === "inc"){
                if((state.usedQty[id] || 0) + 1 > current){
                    toast(`Not enough stock available. Current stock: ${formatQty(current, m.unit)}.`, "error");
                    return;
                }
                state.usedQty[id] = (state.usedQty[id] || 0) + 1;
            } else {
                state.usedQty[id] = Math.max(0, (state.usedQty[id] || 0) - 1);
            }

            renderUsedTable(Object.keys(state.usedQty));
            updateUsedSummary();
        });
    });

    updateUsedSummary();

}

function updateUsedSummary(){

    const entries = Object.entries(state.usedQty).filter(([,q])=>q > 0);
    const summaryEl = document.getElementById("usedSummaryText");
    const saveBtn = document.getElementById("saveUsedBtn");
    const warningsEl = document.getElementById("usedWarnings");

    if(entries.length === 0){
        summaryEl.innerHTML = "No materials selected to use yet.";
        saveBtn.disabled = true;
        warningsEl.innerHTML = "";
        return;
    }

    const parts = entries.map(([id,q])=>{
        const m = state.materials[id];
        return `${m.materialName} −${formatQty(q, m.unit)}`;
    });

    summaryEl.innerHTML = `<strong>${entries.length} material${entries.length === 1 ? "" : "s"}</strong> to use: ${escapeHtml(parts.join(", "))}`;
    saveBtn.disabled = false;

    const nearCritical = entries
        .map(([id,q])=>{
            const m = state.materials[id];
            const after = (Number(m.quantity) || 0) - q;
            const status = computeStatus(after, m.minimumThreshold);
            return { m, status };
        })
        .filter(x=> x.status === "Low" || x.status === "Critical");

    warningsEl.innerHTML = nearCritical.map(x=>`
        <div class="activity-warning">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 9V13M12 17H12.01M10.29 3.86L1.82 18A2 2 0 0 0 3.55 21H20.45A2 2 0 0 0 22.18 18L13.71 3.86A2 2 0 0 0 10.29 3.86Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            Warning: ${escapeHtml(x.m.materialName)} is approaching its minimum stock level.
        </div>
    `).join("");

}

/* ==========================
   STALE-DATA CHECK (run right before every save)
========================== */

async function verifyStillCurrent(materialIds){

    // 1. Has the product's material list changed since we loaded it?
    const pmSnap = await getDocs(collection(db,"productMaterialRequirements"));
    const freshPm = pmSnap.docs.map(d=>d.data()).filter(pm=>pm.productId === state.selectedProductId);
    const freshIds = new Set(freshPm.map(pm=>pm.materialId));
    const cachedIds = new Set(currentMaterialIds());

    if(freshIds.size !== cachedIds.size || [...freshIds].some(id=>!cachedIds.has(id))){
        return { ok:false, reason:"stale_product" };
    }

    // 2. Has any involved material been archived, renamed, or had its unit changed?
    for(const id of materialIds){
        const snap = await getDoc(doc(db,"materials",id));
        if(!snap.exists()){
            return { ok:false, reason:"stale_product" };
        }
        const fresh = snap.data();
        const cached = state.materials[id];
        if(fresh.isActive === false){
            return { ok:false, reason:"inactive", materialName: fresh.materialName };
        }
        if(fresh.materialName !== cached.materialName || fresh.unit !== cached.unit){
            return { ok:false, reason:"stale_product" };
        }
        // keep our cache honest for the actual save step
        state.materials[id] = { id, ...fresh };
    }

    return { ok:true };

}

/* ==========================
   SAVE RECEIVE
========================== */

const saveReceiveBtn = document.getElementById("saveReceiveBtn");
const saveReceiveBtnOriginalHtml = saveReceiveBtn.innerHTML;

saveReceiveBtn.addEventListener("click", async()=>{

    if(state.savingReceive) return; // duplicate-click guard

    if(!state.selectedProductId){
        toast("Please select a finished product first.", "error");
        return;
    }

    const entries = Object.entries(state.receiveQty).filter(([,q])=>q > 0);

    if(entries.length === 0){
        toast("Please enter a quantity before saving.", "error");
        return;
    }

    if(entries.some(([,q])=> !Number.isFinite(q) || q < 0)){
        toast("Please enter a valid quantity.", "error");
        return;
    }

    state.savingReceive = true;
    saveReceiveBtn.disabled = true;
    saveReceiveBtn.textContent = "Saving...";

    try {

        const check = await verifyStillCurrent(entries.map(([id])=>id));
        if(!check.ok){
            if(check.reason === "inactive"){
                toast("This material is no longer available. Please refresh the data.", "error");
            } else {
                toast("The product information has been updated. Please refresh before saving.", "error");
            }
            return;
        }

        const resultingStatuses = [];

        for(const [materialId, qty] of entries){

            const m = state.materials[materialId];

            const { data, error } = await db.rpc("adjust_material_stock", {
                p_material_id: materialId,
                p_delta: qty
            });

            if(error) throw error;

            const row = Array.isArray(data) ? data[0] : data;

            await addDoc(collection(db,"stockReceipts"), {
                materialId,
                materialName: m.materialName,
                receivedQuantity: qty,
                unit: m.unit,
                receivedDate: new Date().toISOString().slice(0,10),
                notes: "",
                createdBy: currentUser ? currentUser.uid : null,
                 recordedBy: currentUser ? currentUser.fullName : "",
                createdAt: serverTimestamp()
            });

            m.quantity = row.quantity;
            m.status = row.status;
            resultingStatuses.push({ name:m.materialName, status:row.status });

        }

        toast("Receive activity saved successfully.");

        state.receiveQty = {};
        const materialIds = currentMaterialIds();
        renderReceiveTable(materialIds);
        renderUsedTable(materialIds);
        await refreshRecent();

    } catch(err){
        console.error(err);
        const msg = String(err?.message || "");
        if(msg.startsWith("insufficient_stock")){
            const current = msg.split(":")[1] || "0";
            toast(`Not enough stock available. Current stock: ${current}.`, "error");
        } else if(msg === "material_inactive"){
            toast("This material is no longer available. Please refresh the data.", "error");
        } else {
            toast("Unable to save activity. Please check your connection and try again.", "error");
        }
    } finally {
        state.savingReceive = false;
        saveReceiveBtn.disabled = false;
        saveReceiveBtn.innerHTML = saveReceiveBtnOriginalHtml;
        updateReceiveSummary();
    }

});

/* ==========================
   SAVE USED
========================== */

const saveUsedBtn = document.getElementById("saveUsedBtn");
const saveUsedBtnOriginalHtml = saveUsedBtn.innerHTML;

saveUsedBtn.addEventListener("click", async()=>{

    if(state.savingUsed) return;

    if(!state.selectedProductId){
        toast("Please select a finished product first.", "error");
        return;
    }

    const entries = Object.entries(state.usedQty)
        .filter(([,q])=>Number(q) > 0)
        .map(([materialId, q])=>({
            material_id: materialId,
            used_quantity: Number(q)
        }));

    if(entries.length === 0){
        toast("Please enter a quantity before saving.", "error");
        return;
    }

    if(entries.some(entry =>
        !Number.isFinite(entry.used_quantity) ||
        entry.used_quantity <= 0
    )){
        toast("Please enter a valid quantity.", "error");
        return;
    }

    state.savingUsed = true;
    saveUsedBtn.disabled = true;
    saveUsedBtn.textContent = "Saving...";

    try {

        const check = await verifyStillCurrent(
            entries.map(entry=>entry.material_id)
        );

        if(!check.ok){
            if(check.reason === "inactive"){
                toast(
                    "This material is no longer available. Please refresh the data.",
                    "error"
                );
            } else {
                toast(
                    "The product information has been updated. Please refresh before saving.",
                    "error"
                );
            }
            return;
        }

        /*
         * IMPORTANT:
         * Do not deduct stock and insert usage_records separately.
         * The RPC performs both operations inside one PostgreSQL
         * transaction. If one material fails, the whole activity
         * is rolled back.
         */
        const { data, error } = await db.rpc(
            "record_material_usage_batch",
            {
                p_product_id: state.selectedProductId,
                p_entries: entries,
                p_usage_date: new Date().toISOString().slice(0,10),
                p_remarks: ""
            }
        );

        if(error) throw error;

        const result = data || {};
        const resultEntries = Array.isArray(result.entries)
            ? result.entries
            : [];

        /*
         * Update the local UI from the database result so the user
         * immediately sees the new stock without another manual
         * calculation.
         */
        resultEntries.forEach(row=>{
            const materialId = row.material_id;
            if(!state.materials[materialId]) return;

            state.materials[materialId].quantity =
                Number(row.new_quantity);

            state.materials[materialId].status =
                row.status;
        });

        const criticalMaterials = resultEntries
            .filter(row => row.status === "Critical");

        state.usedQty = {};

        const materialIds = currentMaterialIds();

        renderReceiveTable(materialIds);
        renderUsedTable(materialIds);
        await refreshRecent();

        toast("Used activity saved successfully.");

        criticalMaterials.forEach(row=>{
            toast(
                `${row.material_name} is now at a critical stock level.`,
                "warn"
            );
        });

    } catch(err){

        console.error("record_material_usage_batch failed:", err);

        const msg = String(err?.message || "");

        if(msg.startsWith("insufficient_stock")){
            const current = msg.split(":")[1] || "0";
            toast(
                `Not enough stock available. Current stock: ${current}.`,
                "error"
            );
        } else if(msg.startsWith("material_inactive")){
            toast(
                "This material is no longer available. Please refresh the data.",
                "error"
            );
        } else if(msg === "product_not_found"){
            toast(
                "The selected finished product is no longer available. Please refresh.",
                "error"
            );
        } else if(msg === "not_authenticated"){
            toast(
                "Your session has expired. Please sign in again.",
                "error"
            );
        } else {
            toast(
                "Unable to save activity. No stock or usage record was partially saved.",
                "error"
            );
        }

    } finally {

        state.savingUsed = false;
        saveUsedBtn.disabled = false;
        saveUsedBtn.innerHTML = saveUsedBtnOriginalHtml;
        updateUsedSummary();

    }

});

/* ==========================
   RECENT ACTIVITY
========================== */

function renderRecentActivity(){

    const body = document.getElementById("recentActivityBody");

    if(state.recent.length === 0){
        body.innerHTML = `<div class="empty-state"><span>No recent material activity.</span></div>`;
        return;
    }

    body.innerHTML = state.recent.map(r=>{
        const isReceive = r._type === "receive";
        const qty = isReceive ? r.receivedQuantity : r.usedQuantity;
        const when = r.createdAt ? new Date(toMillis(r.createdAt)).toLocaleString("en-US",{ month:"long", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" }) : "";

        return `
        <div class="recent-activity-item">
            <span class="ra-icon ${isReceive ? "receive" : "used"}">${isReceive ? "📥" : "📤"}</span>
            <div class="ra-text">
                <div class="ra-title">${isReceive ? "Receive" : "Used"} · ${escapeHtml(r.materialName)} ${isReceive ? "+" : "−"}${formatQty(qty, r.unit)}</div>
                <div class="ra-time">${escapeHtml(when)}${r.recordedBy ? " · " + escapeHtml(r.recordedBy) : ""}</div>
            </div>
        </div>
        `;
    }).join("");

}

async function refreshRecent(){
    const [usageSnap, receiptsSnap] = await Promise.all([
        getDocs(collection(db,"usageRecords")),
        getDocs(collection(db,"stockReceipts"))
    ]);
    state.recent = mergeRecent(usageSnap, receiptsSnap);
    renderRecentActivity();
}

/* ==========================
   REFRESH BUTTON (with unsaved-changes guard)
========================== */

const refreshBtn = document.getElementById("refreshBtn");
const refreshBtnOriginalHtml = refreshBtn.innerHTML;

refreshBtn.addEventListener("click", async()=>{

    if(isDirty()){
        const proceed = await confirmDialog({
            title: "Unsaved changes",
            message: "You have unsaved changes. Refreshing may remove them.",
            confirmLabel: "Continue",
            cancelLabel: "Cancel Refresh"
        });
        if(!proceed) return;
    }

    await doRefresh();

});

async function doRefresh(){

    refreshBtn.classList.add("spinning");
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = refreshBtn.innerHTML.replace("Refresh", "Refreshing...");

    try {

        const [productsSnap, productMaterialsSnap, materialsSnap] = await Promise.all([
            getDocs(collection(db,"finishedProducts")),
            getDocs(collection(db,"productMaterialRequirements")),
            getDocs(collection(db,"materials"))
        ]);

        state.products = productsSnap.docs
            .map(d=>({ id:d.id, ...d.data() }))
            .filter(p => (p.status || "Active") === "Active")
            .map(p => ({ ...p, icon: "📦" }));
        state.productMaterials = productMaterialsSnap.docs.map(d=>d.data());

        state.materials = {};
        materialsSnap.forEach(m=>{
            state.materials[m.id] = { id:m.id, ...m.data() };
        });

        await refreshRecent();
        renderProductPicker(pickerSearch.value);

        if(state.selectedProductId){

            const stillExists = state.products.some(p=>p.id === state.selectedProductId);

            if(!stillExists){
                state.selectedProductId = null;
                state.receiveQty = {};
                state.usedQty = {};
                pickerLabel.textContent = "Select Finished Product";
                pickerLabel.classList.remove("has-value");
                renderNoProductState();
                toast("The product information has been updated. Please refresh before saving.", "error");
            } else {
                const materialIds = currentMaterialIds();
                // clamp any in-progress Used quantities to the refreshed stock
                materialIds.forEach(id=>{
                    const m = state.materials[id];
                    if(m && state.usedQty[id] > m.quantity){
                        state.usedQty[id] = m.quantity;
                    }
                });
                const product = state.products.find(p=>p.id === state.selectedProductId);
                renderSelectedProductArea(product, materialIds);
                renderReceiveTable(materialIds);
                renderUsedTable(materialIds);
                document.getElementById("receiveCard").style.display = materialIds.length ? "" : "none";
                document.getElementById("usedCard").style.display = materialIds.length ? "" : "none";
            }

        }

        toast("Data refreshed successfully.");

    } catch(err){
        console.error(err);
        toast("Unable to refresh data. Please try again.", "error");
    } finally {
        refreshBtn.classList.remove("spinning");
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = refreshBtnOriginalHtml;
    }

}

/* ==========================
   INITIAL LOAD
========================== */

(async function init(){

    renderNoProductState();

    try {
        await loadAll();
        renderProductPicker();
        renderRecentActivity();
    } catch(err){
        console.error(err);
        pickerList.innerHTML = `<div class="pp-empty">Unable to load products right now.</div>`;
    }

})();
