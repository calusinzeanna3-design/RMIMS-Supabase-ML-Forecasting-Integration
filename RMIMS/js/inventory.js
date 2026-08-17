// Inventory Management — Admin
// Core inventory CRUD/import/export only. No ML, forecasting, REST API, or model integration.

import { auth, db, supabase } from "../supabase/supabase-config.js";
import {
    collection, getDocs, getDoc, doc, addDoc, updateDoc, deleteDoc,
    query, where
} from "../supabase/db-compat.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

const $ = id => document.getElementById(id);
const state = {
    materials: [],
    usage: [],
    receipts: [],
    search: "",
    category: "",
    status: "",
    page: 1,
    rowsPerPage: 10
};

const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const fmtQty = (v,u="") => `${num(v).toLocaleString(undefined,{maximumFractionDigits:4})}${u ? ` ${u}` : ""}`;

function toast(message,type="success"){
    const stack=$("toastStack"); if(!stack)return;
    const el=document.createElement("div"); el.className=`toast ${type}`;
    el.innerHTML=`<span class="toast-dot"></span><span>${esc(message)}</span>`;
    stack.appendChild(el);
    setTimeout(()=>{el.classList.add("leaving");setTimeout(()=>el.remove(),260)},3200);
}

function statusOf(m){
    const q=num(m.quantity), min=num(m.minimumThreshold);
    if(q<=0) return {key:"out",cls:"critical",label:"🔴 Out of Stock"};
    if(m.status==="Critical" || q<min) return {key:"low",cls:"low",label:"🟠 Low Stock"};
    return {key:"available",cls:"available",label:"🟢 Available"};
}

function setFieldError(id,msg=""){ const el=$(id); if(el)el.textContent=msg; }

let matAnalyticsPage = 1;
const MAT_PER_PAGE = 4;

async function loadData(){
    try{
        const [mRes, uRes, rRes] = await Promise.all([
            supabase.from("materials").select("*").catch(() => ({ data: null })),
            supabase.from("usage_records").select("*").catch(() => ({ data: null })),
            supabase.from("stock_receipts").select("*").catch(() => ({ data: null }))
        ]);

        let materialsList = [];
        if (mRes && mRes.data && mRes.data.length) {
            materialsList = mRes.data.map(d => ({
                id: d.id,
                materialName: d.material_name || d.materialName || d.name || "",
                minimumThreshold: num(d.minimum_threshold !== undefined ? d.minimum_threshold : d.minimumThreshold),
                quantity: num(d.quantity),
                unit: d.unit || "",
                category: d.category || "",
                supplier: d.supplier || "",
                storageLocation: d.storage_location || d.storageLocation || "",
                notes: d.notes || "",
                status: d.status || (num(d.quantity) <= 0 ? "Critical" : num(d.quantity) < num(d.minimum_threshold) ? "Low" : "Available"),
                updatedAt: d.updated_at || d.updatedAt || null,
                createdAt: d.created_at || d.createdAt || null
            }));
        } else {
            const firebaseMat = await getDocs(collection(db,"materials")).catch(() => ({ docs: [] }));
            materialsList = firebaseMat.docs ? firebaseMat.docs.map(d=> {
                const data = d.data();
                return {
                    id: d.id,
                    materialName: data.materialName || data.material_name || data.name || "",
                    minimumThreshold: num(data.minimumThreshold !== undefined ? data.minimumThreshold : data.minimum_threshold),
                    quantity: num(data.quantity),
                    unit: data.unit || "",
                    category: data.category || "",
                    supplier: data.supplier || "",
                    storageLocation: data.storageLocation || data.storage_location || "",
                    notes: data.notes || "",
                    status: data.status || (num(data.quantity) <= 0 ? "Critical" : num(data.quantity) < num(data.minimumThreshold) ? "Low" : "Available"),
                    updatedAt: data.updatedAt || data.updated_at || null,
                    createdAt: data.createdAt || data.created_at || null
                };
            }) : [];
        }

        state.materials = materialsList;

        let usageList = [];
        if (uRes && uRes.data && uRes.data.length) {
            usageList = uRes.data.map(d => ({
                id: d.id,
                productName: d.product_name || d.productName || "",
                materialName: d.material_name || d.materialName || "",
                usedQuantity: num(d.used_quantity !== undefined ? d.used_quantity : d.usedQuantity),
                unit: d.unit || "",
                usageDate: d.usage_date || d.usageDate || null,
                createdAt: d.created_at || d.createdAt || null,
                remarks: d.remarks || "",
                ...d
            }));
        } else {
            const firebaseUsage = await getDocs(collection(db,"usageRecords")).catch(() => ({ docs: [] }));
            usageList = firebaseUsage.docs ? firebaseUsage.docs.map(d=>({id:d.id,...d.data()})) : [];
        }

        state.usage = usageList;

        let receiptsList = [];
        if (rRes && rRes.data && rRes.data.length) {
            receiptsList = rRes.data.map(d => ({
                id: d.id,
                materialName: d.material_name || d.materialName || "",
                receivedQuantity: num(d.received_quantity !== undefined ? d.received_quantity : d.receivedQuantity),
                unit: d.unit || "",
                receivedDate: d.received_date || d.receivedDate || null,
                createdAt: d.created_at || d.createdAt || null,
                notes: d.notes || "",
                ...d
            }));
        } else {
            const firebaseReceipts = await getDocs(collection(db,"stockReceipts")).catch(() => ({ docs: [] }));
            receiptsList = firebaseReceipts.docs ? firebaseReceipts.docs.map(d=>({id:d.id,...d.data()})) : [];
        }

        state.receipts = receiptsList;

        populateCategoryFilter();
        renderSummary();
        renderTable();
        renderMaterialAnalytics();
        renderFinishedProductUsage();
        renderInventoryCharts();
        setupPaginationListeners();
    }catch(err){
        console.error("loadData error:", err);
        state.materials = [];
        state.usage = [];
        state.receipts = [];
        populateCategoryFilter();
        renderSummary();
        renderTable();
        renderMaterialAnalytics();
        renderFinishedProductUsage();
        renderInventoryCharts();
        setupPaginationListeners();
    }
}

let invDonutChartInstance = null;
let invMovementChartInstance = null;

function renderInventoryCharts() {
    // 1. Stock Health Distribution Donut Chart
    const canvasDonut = $("invStatusDonutChart");
    if (canvasDonut && typeof Chart !== "undefined") {
        const ctx = canvasDonut.getContext("2d");
        if (invDonutChartInstance) invDonutChartInstance.destroy();

        const avail = state.materials.filter(m => statusOf(m).key === "available").length;
        const low = state.materials.filter(m => statusOf(m).key === "low").length;
        const out = state.materials.filter(m => statusOf(m).key === "out").length;
        const hasData = state.materials.length > 0;

        invDonutChartInstance = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: hasData ? ["Available", "Low Stock", "Out of Stock"] : ["No Inventory Data Available"],
                datasets: [{
                    data: hasData ? [avail, low, out] : [1],
                    backgroundColor: hasData ? ["#10B981", "#F59E0B", "#EF4444"] : ["#CBD5E1"],
                    borderWidth: 2,
                    borderColor: "#FFFFFF"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: "right", labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: { enabled: hasData }
                },
                cutout: "68%"
            }
        });
    }

    // 2. Received vs Used Movement Bar Chart
    const canvasMovement = $("invReceivedVsUsedChart");
    if (canvasMovement && typeof Chart !== "undefined") {
        const ctx = canvasMovement.getContext("2d");
        if (invMovementChartInstance) invMovementChartInstance.destroy();

        const totalReceived = state.receipts.reduce((s, r) => s + (num(r.receivedQuantity) || 0), 0);
        const totalUsed = state.usage.reduce((s, u) => s + (num(u.usedQuantity) || 0), 0);

        invMovementChartInstance = new Chart(ctx, {
            type: "bar",
            data: {
                labels: ["Current Period Movement"],
                datasets: [
                    {
                        label: "Quantity Received",
                        data: [totalReceived || 0],
                        backgroundColor: "rgba(16, 185, 129, 0.8)",
                        borderColor: "#10B981",
                        borderWidth: 1,
                        borderRadius: 6
                    },
                    {
                        label: "Quantity Used",
                        data: [totalUsed || 0],
                        backgroundColor: "rgba(239, 68, 68, 0.8)",
                        borderColor: "#EF4444",
                        borderWidth: 1,
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: "top", labels: { boxWidth: 12, font: { size: 11 } } }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true }
                }
            }
        });
    }
}

function setupPaginationListeners() {
    const prevBtn = $("prevMatPageBtn");
    const nextBtn = $("nextMatPageBtn");
    if (prevBtn && !prevBtn.dataset.bound) {
        prevBtn.dataset.bound = "true";
        prevBtn.addEventListener("click", () => {
            if (matAnalyticsPage > 1) {
                matAnalyticsPage--;
                renderMaterialAnalytics();
            }
        });
    }
    if (nextBtn && !nextBtn.dataset.bound) {
        nextBtn.dataset.bound = "true";
        nextBtn.addEventListener("click", () => {
            const totalPages = Math.ceil(state.materials.length / MAT_PER_PAGE);
            if (matAnalyticsPage < totalPages) {
                matAnalyticsPage++;
                renderMaterialAnalytics();
            }
        });
    }
}

function renderMaterialAnalytics() {
    const grid = $("matQuantityBarGrid");
    const indicator = $("matPageIndicator");
    const prevBtn = $("prevMatPageBtn");
    const nextBtn = $("nextMatPageBtn");
    if (!grid) return;

    const sortedMaterials = [...state.materials].sort((a, b) => String(a.materialName || "").localeCompare(String(b.materialName || "")));
    const totalPages = Math.max(1, Math.ceil(sortedMaterials.length / MAT_PER_PAGE));
    if (matAnalyticsPage > totalPages) matAnalyticsPage = totalPages;
    if (matAnalyticsPage < 1) matAnalyticsPage = 1;

    const pageMaterials = sortedMaterials.slice((matAnalyticsPage - 1) * MAT_PER_PAGE, matAnalyticsPage * MAT_PER_PAGE);

    if (indicator) indicator.textContent = `Page ${matAnalyticsPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = matAnalyticsPage <= 1;
    if (nextBtn) nextBtn.disabled = matAnalyticsPage >= totalPages;

    if (!pageMaterials.length) {
        grid.innerHTML = `<div style="grid-column: 1/-1; padding: 24px 0; text-align: center; color: var(--rm-ink-dim); font-size: 13px; font-weight: 500;">No raw materials found yet.</div>`;
        return;
    }

    grid.innerHTML = pageMaterials.map(m => {
        const qty = num(m.quantity);
        const min = num(m.minimumThreshold || 10);
        const maxRef = Math.max(qty, min * 2.5, 80);
        const pct = Math.min(100, Math.max(5, Math.round((qty / maxRef) * 100)));
        const st = statusOf(m);
        const badgeBg = st.key === "out" ? "rgba(239, 68, 68, 0.12)" : st.key === "low" ? "rgba(245, 158, 11, 0.12)" : "rgba(16, 185, 129, 0.12)";
        const badgeColor = st.key === "out" ? "#DC2626" : st.key === "low" ? "#D97706" : "#059669";
        const barColor = st.key === "out" ? "#EF4444" : st.key === "low" ? "#F59E0B" : "#10B981";

        return `
            <div style="padding: 20px; background: #ffffff; border: 1px solid var(--line-soft, #E2E8F0); border-radius: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <strong style="font-size: 15px; font-weight: 700; color: var(--rm-ink, #0F172A);">${esc(m.materialName)}</strong>
                        <span style="font-size: 13px; font-weight: 800; color: var(--rm-ink, #0F172A); background: rgba(0,0,0,0.04); padding: 4px 10px; border-radius: 20px;">${fmtQty(qty, m.unit || "kg")}</span>
                    </div>
                    <div style="font-size: 12px; color: var(--rm-ink-dim, #64748B); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <span>Category: <strong style="color: var(--rm-ink, #1E293B);">${esc(m.category || "General")}</strong></span>
                        <span>Min Stock: <strong style="color: var(--rm-ink, #1E293B);">${fmtQty(min, m.unit || "kg")}</strong></span>
                    </div>
                </div>
                <div>
                    <div style="height: 9px; background: rgba(0,0,0,0.06); border-radius: 6px; overflow: hidden; position: relative; margin-bottom: 10px;">
                        <div style="height: 100%; width: ${pct}%; background: ${barColor}; border-radius: 6px; transition: width 0.4s ease;"></div>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 12px; background: ${badgeBg}; color: ${badgeColor}; display: inline-flex; align-items: center; gap: 4px;">
                            ${esc(st.label)}
                        </span>
                        <span style="font-size: 11px; color: var(--rm-ink-dim, #64748B);">Supplier: ${esc(m.supplier || "Supplier")}</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

let prodAnalyticsPage = 1;
const PROD_PER_PAGE = 4;

function renderFinishedProductUsage() {
    const container = $("finishedProductUsageContainer");
    const indicator = $("prodPageIndicator");
    const prevBtn = $("prevProdPageBtn");
    const nextBtn = $("nextProdPageBtn");
    if (!container) return;

    const usageWithProduct = state.usage.filter(u => u.productName && u.usedQuantity);
    if (!usageWithProduct.length) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 24px 0; text-align: center;">
                <p style="margin: 0; font-size: 13px; color: var(--rm-ink-dim); font-weight: 500;">No product consumption records available yet.</p>
            </div>`;
        if (indicator) indicator.textContent = "Page 1 of 1";
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }

    const prodMap = new Map();
    usageWithProduct.forEach(u => {
        const key = u.productName;
        if (!prodMap.has(key)) prodMap.set(key, []);
        prodMap.get(key).push(u);
    });

    const entries = [...prodMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const totalPages = Math.max(1, Math.ceil(entries.length / PROD_PER_PAGE));
    if (prodAnalyticsPage > totalPages) prodAnalyticsPage = totalPages;
    if (prodAnalyticsPage < 1) prodAnalyticsPage = 1;

    const pageEntries = entries.slice((prodAnalyticsPage - 1) * PROD_PER_PAGE, prodAnalyticsPage * PROD_PER_PAGE);

    if (indicator) indicator.textContent = `Page ${prodAnalyticsPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = prodAnalyticsPage <= 1;
    if (nextBtn) nextBtn.disabled = prodAnalyticsPage >= totalPages;

    if (!prevBtn?.dataset.bound) {
        if (prevBtn) {
            prevBtn.dataset.bound = "true";
            prevBtn.addEventListener("click", () => {
                if (prodAnalyticsPage > 1) {
                    prodAnalyticsPage--;
                    renderFinishedProductUsage();
                }
            });
        }
        if (nextBtn) {
            nextBtn.dataset.bound = "true";
            nextBtn.addEventListener("click", () => {
                if (prodAnalyticsPage < totalPages) {
                    prodAnalyticsPage++;
                    renderFinishedProductUsage();
                }
            });
        }
    }

    const maxVal = Math.max(...entries.map(([_, items]) => items.reduce((s, i) => s + (num(i.usedQuantity) || 0), 0)), 1);

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
            ${pageEntries.map(([prod, items]) => {
                const totalUsed = items.reduce((s, i) => s + (num(i.usedQuantity) || 0), 0);
                const pct = Math.min(100, Math.max(8, Math.round((totalUsed / maxVal) * 100)));
                const matSummary = items.slice(0, 3).map(i => `${esc(i.materialName)}: ${fmtQty(i.usedQuantity, i.unit || "")}`).join(" • ");
                return `
                    <div style="padding: 20px; background: #ffffff; border: 1px solid var(--line-soft, #E2E8F0); border-radius: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                <strong style="font-size: 15px; font-weight: 700; color: var(--rm-ink, #0F172A);">${esc(prod)}</strong>
                                <span style="font-size: 12px; font-weight: 700; color: #16803C; background: rgba(22, 128, 60, 0.08); padding: 4px 10px; border-radius: 20px;">${fmtQty(totalUsed)} total used</span>
                            </div>
                            <div style="font-size: 12px; color: var(--rm-ink-dim, #64748B); margin-bottom: 14px; line-height: 1.4;">
                                ${matSummary ? `Materials consumed: <strong style="color: var(--rm-ink);">${matSummary}</strong>` : "Raw material usage recorded"}
                            </div>
                        </div>
                        <div>
                            <div style="height: 9px; background: rgba(0,0,0,0.06); border-radius: 6px; overflow: hidden; margin-bottom: 6px;">
                                <div style="height: 100%; width: ${pct}%; background: linear-gradient(90deg, #16803C, #10B981); border-radius: 6px; transition: width 0.4s ease;"></div>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--rm-ink-dim);">
                                <span>Usage Level</span>
                                <span style="font-weight: 600; color: var(--rm-ink);">${pct}% of peak</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function populateCategoryFilter(){
    const el=$("categoryFilter");
    if(!el)return;
    const categories=[...new Set(state.materials.map(m=>m.category).filter(Boolean))].sort();
    const current=el.value;
    el.innerHTML=`<option value="">All Categories</option>`+categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
    if(categories.includes(current))el.value=current;
}

function renderSummary(){
    const total=state.materials.length;
    const available=state.materials.filter(m=>statusOf(m).key==="available").length;
    const low=state.materials.filter(m=>statusOf(m).key==="low").length;
    const out=state.materials.filter(m=>statusOf(m).key==="out").length;
    $("cardTotalCount").textContent=total;
    $("cardAvailableCount").textContent=available;
    $("cardLowCount").textContent=low;
    $("cardOutCount").textContent=out;
}

function filtered(){
    const term=state.search.trim().toLowerCase();
    return state.materials.filter(m=>{
        if(state.category && m.category!==state.category)return false;
        if(state.status && statusOf(m).key!==state.status)return false;
        if(term && !`${m.materialName} ${m.category} ${m.supplier||""}`.toLowerCase().includes(term))return false;
        return true;
    }).sort((a,b)=>String(a.materialName||"").localeCompare(String(b.materialName||"")));
}

function renderTable(){
    const tbody=$("inventoryTableBody"), result=$("resultCount");
    const list=filtered();
    result.textContent=`${list.length} of ${state.materials.length} materials`;
    if(!list.length){
        tbody.innerHTML=`<tr><td colspan="8"><div class="empty-state"><strong>No raw materials found.</strong><span>Add a material or adjust your filters.</span></div></td></tr>`;
        return;
    }
    const pages=Math.max(1,Math.ceil(list.length/state.rowsPerPage));
    state.page=Math.min(state.page,pages);
    const start=(state.page-1)*state.rowsPerPage;
    const rows=list.slice(start,start+state.rowsPerPage);
    tbody.innerHTML=rows.map(m=>{
        const st=statusOf(m);
        return `<tr data-id="${esc(m.id)}">
            <td data-label="Material"><strong>${esc(m.materialName)}</strong></td>
            <td data-label="Category">${esc(m.category||"—")}</td>
            <td data-label="Current Stock">${esc(fmtQty(m.quantity,m.unit))}</td>
            <td data-label="Unit">${esc(m.unit||"—")}</td>
            <td data-label="Minimum Stock">${esc(fmtQty(m.minimumThreshold,m.unit))}</td>
            <td data-label="Supplier">${esc(m.supplier||"—")}</td>
            <td data-label="Status"><span class="status ${st.cls}">${esc(st.label)}</span></td>
            <td data-label="Actions">
                <button class="btn-secondary btn-sm mat-view" data-id="${esc(m.id)}">View</button>
                <button class="btn-secondary btn-sm mat-edit" data-id="${esc(m.id)}">Edit</button>
                <button class="btn-secondary btn-sm mat-delete" data-id="${esc(m.id)}">Delete</button>
            </td>
        </tr>`;
    }).join("");
}

function openModal(id, material=null){
    $("matId").value=material?.id||"";
    $("matName").value=material?.materialName||"";
    $("matQuantity").value=material?.quantity ?? "";
    $("matMinThreshold").value=material?.minimumThreshold ?? "";
    $("matSupplier").value=material?.supplier||"";
    $("matStorageLocation").value=material?.storageLocation||"";
    $("matNotes").value=material?.notes||"";
    $("matUnit").value=material?.unit||"";
    $("matCategoryNewWrap").hidden=true;
    $("matCategoryNew").value="";
    ["matNameError","matCategoryError","matCategoryNewError","matUnitError","matQuantityError","matMinThresholdError","matSupplierError"].forEach(x=>setFieldError(x));
    const cats=[...new Set(state.materials.map(m=>m.category).filter(Boolean))].sort();
    const current=material?.category||"";
    $("matCategory").innerHTML=`<option value="">Select Category</option>`+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("")+`<option value="__new__">Others</option>`;
    if(cats.includes(current))$("matCategory").value=current;
    else if(current){$("matCategory").value="__new__";$("matCategoryNewWrap").hidden=false;$("matCategoryNew").value=current;}
    $("materialModalTitle").textContent=material?"Edit Raw Material":"Add Raw Material";
    $("materialModalSubtitle").textContent=material?"Update the raw-material record.":"Enter the raw-material details.";
    $("materialModalOverlay").classList.add("open");
}

function closeMaterialModal(){$("materialModalOverlay").classList.remove("open");}

async function saveMaterial(){
    const name=$("matName").value.trim();
    const category=$("matCategory").value==="__new__"?$("matCategoryNew").value.trim():$("matCategory").value;
    const unit=$("matUnit").value.trim();
    const quantity=num($("matQuantity").value);
    const min=num($("matMinThreshold").value);
    let valid=true;
    if(!name){setFieldError("matNameError","Material name is required.");valid=false;}
    if(!category){setFieldError("matCategoryError","Category is required.");valid=false;}
    if(!unit){setFieldError("matUnitError","Unit is required.");valid=false;}
    if(quantity<0){setFieldError("matQuantityError","Quantity cannot be negative.");valid=false;}
    if(min<0){setFieldError("matMinThresholdError","Minimum stock cannot be negative.");valid=false;}
    const duplicate=state.materials.find(m=>String(m.materialName||"").trim().toLowerCase()===name.toLowerCase() && m.id!==$("matId").value);
    if(duplicate){setFieldError("matNameError","A material with this name already exists.");valid=false;}
    if(!valid)return;

    const payload={
        materialName:name,category,unit,quantity,minimumThreshold:min,
        supplier:$("matSupplier").value.trim()||null,
        storageLocation:$("matStorageLocation").value.trim()||null,
        notes:$("matNotes").value.trim()||null,
        status:quantity<=0?"Critical":quantity<min?"Low":"Available"
    };
    $("materialModalSave").disabled=true;
    try{
        const id=$("matId").value;
        if(id) await updateDoc(doc(db,"materials",id),payload);
        else await addDoc(collection(db,"materials"),payload);
        closeMaterialModal(); toast(id?"Material updated.":"Material added."); await loadData();
    }catch(err){console.error(err);toast(err.message||"Could not save material.","error")}
    finally{$("materialModalSave").disabled=false;}
}

async function openDetails(id){
    const m=state.materials.find(x=>x.id===id); if(!m)return;
    const st=statusOf(m);
    $("detailsName").textContent=m.materialName;
    $("detailsStatus").innerHTML=`<span class="status ${st.cls}">${esc(st.label)}</span>`;
    $("detailsCategory").textContent=m.category||"—";
    $("detailsSupplier").textContent=m.supplier||"—";
    $("detailsStock").textContent=fmtQty(m.quantity,m.unit);
    $("detailsMinStock").textContent=fmtQty(m.minimumThreshold,m.unit);
    $("detailsLocation").textContent=m.storageLocation||"—";
    $("detailsUpdated").textContent=m.updatedAt?new Date(m.updatedAt).toLocaleString():"—";
    $("detailsNotes").textContent=m.notes||"—";
    $("detailsReceiveBtn").dataset.id=id;$("detailsUseBtn").dataset.id=id;$("detailsEditBtn").dataset.id=id;
    const history=[
        ...state.receipts.filter(x=>x.materialId===id).map(x=>({date:x.createdAt||x.receivedDate,type:"Received",qty:x.receivedQuantity,unit:x.unit||m.unit,notes:x.notes})),
        ...state.usage.filter(x=>x.materialId===id).map(x=>({date:x.createdAt||x.usageDate,type:"Used",qty:x.usedQuantity,unit:x.unit||m.unit,notes:x.remarks}))
    ].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
    $("detailsHistoryList").innerHTML=history.length?history.slice(0,10).map(h=>`<div class="history-row"><strong>${esc(h.type)}</strong><span>${esc(fmtQty(h.qty,h.unit))}</span><small>${esc(h.date?new Date(h.date).toLocaleString():"—")} ${h.notes?`· ${esc(h.notes)}`:""}</small></div>`).join(""):`<div class="empty-state"><span>No activity recorded yet.</span></div>`;
    $("detailsOverlay").classList.add("open");
}

function openReceive(id){
    $("receiveMaterialId").value=id;$("receiveQuantity").value="";$("receiveDate").value=new Date().toISOString().slice(0,10);$("receiveNotes").value="";setFieldError("receiveQuantityError");$("receiveModalOverlay").classList.add("open");
}
async function saveReceive(){
    const id=$("receiveMaterialId").value,q=num($("receiveQuantity").value);
    const m=state.materials.find(x=>x.id===id);
    if(!m||q<=0){setFieldError("receiveQuantityError","Enter a quantity greater than 0.");return;}
    $("receiveModalSave").disabled=true;
    try{
        let rpcDone = false;
        try {
            const { data, error } = await supabase.rpc("record_stock_receipt_atomic", {
                p_material_id: id,
                p_quantity: q,
                p_received_date: $("receiveDate").value || null,
                p_notes: $("receiveNotes").value.trim() || null
            });
            if (!error && data?.success) rpcDone = true;
        } catch (e) {
            rpcDone = false;
        }

        if (!rpcDone) {
            await addDoc(collection(db,"stockReceipts"),{
                materialId:id,
                materialName:m.materialName,
                receivedQuantity:q,
                unit:m.unit,
                receivedDate:$("receiveDate").value||null,
                notes:$("receiveNotes").value.trim()||null
            });
            const newQty = num(m.quantity) + q;
            await updateDoc(doc(db,"materials",id),{
                quantity: newQty,
                status: newQty <= 0 ? "Critical" : newQty < num(m.minimumThreshold) ? "Low" : "Available"
            });
        }

        $("receiveModalOverlay").classList.remove("open");
        toast("Stock received.");
        await loadData();
    }catch(err){
        toast(err.message||"Could not record stock receipt.","error");
    }finally{
        $("receiveModalSave").disabled=false;
    }
}
function openUse(id){
    $("useMaterialId").value=id;$("useQuantity").value="";$("useDate").value=new Date().toISOString().slice(0,10);$("useNotes").value="";setFieldError("useQuantityError");$("useModalOverlay").classList.add("open");
}
async function saveUse(){
    const id=$("useMaterialId").value,q=num($("useQuantity").value),m=state.materials.find(x=>x.id===id);
    if(!m||q<=0){setFieldError("useQuantityError","Enter a quantity greater than 0.");return;}
    if(q>num(m.quantity)){setFieldError("useQuantityError","Used quantity cannot be greater than current stock.");return;}
    $("useModalSave").disabled=true;
    try{
        let rpcDone = false;
        try {
            const { data, error } = await supabase.rpc("record_stock_usage_atomic", {
                p_material_id: id,
                p_quantity: q,
                p_usage_date: $("useDate").value || null,
                p_remarks: $("useNotes").value.trim() || null
            });
            if (!error && data?.success) rpcDone = true;
        } catch (e) {
            rpcDone = false;
        }

        if (!rpcDone) {
            await addDoc(collection(db,"usageRecords"),{
                materialId:id,
                materialName:m.materialName,
                usedQuantity:q,
                unit:m.unit,
                usageDate:$("useDate").value||null,
                remarks:$("useNotes").value.trim()||null
            });
            const remaining = Math.max(0, num(m.quantity) - q);
            await updateDoc(doc(db,"materials",id),{
                quantity: remaining,
                status: remaining <= 0 ? "Critical" : remaining < num(m.minimumThreshold) ? "Low" : "Available"
            });
        }

        $("useModalOverlay").classList.remove("open");
        toast("Material usage recorded.");
        await loadData();
    }catch(err){
        toast(err.message||"Could not record material usage.","error");
    }finally{
        $("useModalSave").disabled=false;
    }
}

async function deleteMaterial(id){
    const m=state.materials.find(x=>x.id===id);if(!m)return;
    if(!confirm(`Delete "${m.materialName}"? This cannot be undone.`))return;
    try{await deleteDoc(doc(db,"materials",id));toast("Material deleted.");await loadData();}catch(err){toast(err.message||"Could not delete material.","error")}
}

function openImport(){ $("importFileInput").value=""; $("importPreviewArea").innerHTML=""; $("importConfirmBtn").disabled=true; $("importModalOverlay").classList.add("open");}
function closeImport(){$("importModalOverlay").classList.remove("open");}

let pendingImport=[];
$("importFileInput").addEventListener("change",async()=>{
    const file=$("importFileInput").files?.[0];if(!file)return;
    try{
        const wb=XLSX.read(await file.arrayBuffer(),{type:"array"}),sheet=wb.Sheets[wb.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(sheet,{defval:""});
        if(!rows.length)throw new Error("The file is empty.");
        pendingImport=rows;
        $("importPreviewArea").innerHTML=`<div class="import-summary"><strong>${rows.length}</strong> rows ready to import.</div>`;
        $("importConfirmBtn").disabled=false;
    }catch(err){pendingImport=[];$("importPreviewArea").innerHTML=`<div class="field-error">${esc(err.message||"Invalid file.")}</div>`}
});

function normHeader(v){return String(v||"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");}
function rowVal(row,...keys){
    const map={};Object.entries(row).forEach(([k,v])=>map[normHeader(k)]=v);
    for(const k of keys){if(map[k]!==undefined&&map[k]!=="")return String(map[k]).trim();}
    return "";
}

$("importConfirmBtn").addEventListener("click",async()=>{
    if(!pendingImport.length)return;
    $("importConfirmBtn").disabled=true;
    try{
        for(const row of pendingImport){
            const name=rowVal(row,"material name","material","name");
            if(!name)continue;
            const category=rowVal(row,"category")||"Uncategorized";
            const unit=rowVal(row,"unit")||"pcs";
            const quantity=Math.max(0,num(rowVal(row,"current stock","quantity","stock")));
            const min=Math.max(0,num(rowVal(row,"minimum stock","minimum threshold","min stock")));
            const existing=state.materials.find(m=>String(m.materialName||"").trim().toLowerCase()===name.toLowerCase());
            const payload={materialName:name,category,unit,quantity,minimumThreshold:min,supplier:rowVal(row,"supplier")||null,storageLocation:rowVal(row,"storage location")||null,notes:rowVal(row,"notes","description")||null,status:quantity<=0?"Critical":quantity<min?"Low":"Available"};
            if(existing)await updateDoc(doc(db,"materials",existing.id),payload);else await addDoc(collection(db,"materials"),payload);
        }
        closeImport();toast("Inventory import completed.");await loadData();
    }catch(err){toast(err.message||"Import failed.","error")}finally{$("importConfirmBtn").disabled=false;}
});

function exportExcel(){
    const rows=state.materials.map(m=>({Material:m.materialName,Category:m.category,CurrentStock:m.quantity,Unit:m.unit,MinimumStock:m.minimumThreshold,Supplier:m.supplier||"",Status:statusOf(m).key}));
    const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Inventory");XLSX.writeFile(wb,"RMIMS-Inventory.xlsx");
}
function exportPdf(){
    if(!window.jspdf)return;
    const {jsPDF}=window.jspdf;const pdf=new jsPDF();pdf.text("RMIMS Inventory Records",14,15);
    pdf.autoTable({startY:22,head:[["Material","Category","Stock","Unit","Minimum","Supplier","Status"]],body:state.materials.map(m=>[m.materialName,m.category,m.quantity,m.unit,m.minimumThreshold,m.supplier||"",statusOf(m).label])});
    pdf.save("RMIMS-Inventory.pdf");
}

$("addMaterialBtn").addEventListener("click",()=>openModal("materialModalOverlay"));
$("materialModalClose").addEventListener("click",closeMaterialModal);
$("materialModalCancel").addEventListener("click",closeMaterialModal);
$("materialModalOverlay").addEventListener("click",e=>{if(e.target===$("materialModalOverlay"))closeMaterialModal()});
$("materialModalSave").addEventListener("click",saveMaterial);
$("matCategory").addEventListener("change",e=>$("matCategoryNewWrap").hidden=e.target.value!=="__new__");

$("inventoryTableBody").addEventListener("click",e=>{
    const id=e.target.closest("button")?.dataset.id;if(!id)return;
    if(e.target.closest(".mat-view"))openDetails(id);
    else if(e.target.closest(".mat-edit"))openModal("materialModalOverlay",state.materials.find(m=>m.id===id));
    else if(e.target.closest(".mat-delete"))deleteMaterial(id);
});

$("detailsClose").addEventListener("click",()=>$("detailsOverlay").classList.remove("open"));
$("detailsOverlay").addEventListener("click",e=>{if(e.target===$("detailsOverlay"))$("detailsOverlay").classList.remove("open")});
$("detailsReceiveBtn").addEventListener("click",()=>{ $("detailsOverlay").classList.remove("open");openReceive($("detailsReceiveBtn").dataset.id);});
$("detailsUseBtn").addEventListener("click",()=>{ $("detailsOverlay").classList.remove("open");openUse($("detailsUseBtn").dataset.id);});
$("detailsEditBtn").addEventListener("click",()=>{ $("detailsOverlay").classList.remove("open");openModal("materialModalOverlay",state.materials.find(m=>m.id===$("detailsEditBtn").dataset.id));});

$("receiveModalClose").addEventListener("click",()=>$("receiveModalOverlay").classList.remove("open"));
$("receiveModalCancel").addEventListener("click",()=>$("receiveModalOverlay").classList.remove("open"));
$("receiveModalSave").addEventListener("click",saveReceive);
$("useModalClose").addEventListener("click",()=>$("useModalOverlay").classList.remove("open"));
$("useModalCancel").addEventListener("click",()=>$("useModalOverlay").classList.remove("open"));
$("useModalSave").addEventListener("click",saveUse);

$("importBtn").addEventListener("click",openImport);
$("importModalClose").addEventListener("click",closeImport);
$("importModalCancel").addEventListener("click",closeImport);
$("importDropzone").addEventListener("click",()=>$("importFileInput").click());
$("exportBtn").addEventListener("click",()=>$("exportModalOverlay").classList.add("open"));
$("exportModalClose").addEventListener("click",()=>$("exportModalOverlay").classList.remove("open"));
$("exportExcelBtn").addEventListener("click",exportExcel);
$("exportPdfBtn").addEventListener("click",exportPdf);
$("refreshBtn").addEventListener("click",loadData);

$("searchInput").addEventListener("input",e=>{state.search=e.target.value;state.page=1;renderTable()});
$("categoryFilter").addEventListener("change",e=>{state.category=e.target.value;state.page=1;renderTable()});
$("statusFilter").addEventListener("change",e=>{state.status=e.target.value;state.page=1;renderTable()});
$("filterClearBtn").addEventListener("click",()=>{state.search="";state.category="";state.status="";$("searchInput").value="";$("categoryFilter").value="";$("statusFilter").value="";renderTable()});
$("overviewCards").addEventListener("click",e=>{
    const card=e.target.closest("[data-filter]");if(!card)return;
    state.status=card.dataset.filter==="all"?"":card.dataset.filter;$("statusFilter").value=state.status;renderTable();
});

window.addEventListener("rmims:inventory-changed",loadData);

onAuthStateChanged(auth,async user=>{
    if(!user){window.location.href="../login.html";return;}
    try{
        const profile=await getDoc(doc(db,"users",user.uid));
        if(profile.exists()&&profile.data().role!=="admin"){window.location.href="../user/inventory.html";return;}
    }catch(e){console.warn("Role check failed",e);}
    await loadData();
});
