// Inventory Management — Admin
// Core inventory CRUD/import/export only. No ML, forecasting, REST API, or model integration.

import { auth, db } from "../supabase/supabase-config.js";
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

async function loadData(){
    try{
        const [m,u,r]=await Promise.all([
            getDocs(collection(db,"materials")),
            getDocs(collection(db,"usageRecords")),
            getDocs(collection(db,"stockReceipts"))
        ]);
        state.materials=m.docs.map(d=>({id:d.id,...d.data()}));
        state.usage=u.docs.map(d=>({id:d.id,...d.data()}));
        state.receipts=r.docs.map(d=>({id:d.id,...d.data()}));
        populateCategoryFilter();
        renderSummary();
        renderTable();
    }catch(err){
        console.error(err);
        $("inventoryTableBody").innerHTML=`<tr><td colspan="8"><div class="error-state"><strong>Unable to load inventory.</strong><span>Check your Supabase connection and database tables.</span></div></td></tr>`;
    }
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
        await addDoc(collection(db,"stockReceipts"),{materialId:id,materialName:m.materialName,receivedQuantity:q,unit:m.unit,receivedDate:$("receiveDate").value||null,notes:$("receiveNotes").value.trim()||null});
        await updateDoc(doc(db,"materials",id),{quantity:num(m.quantity)+q,status:(num(m.quantity)+q)<=0?"Critical":(num(m.quantity)+q)<num(m.minimumThreshold)?"Low":"Available"});
        $("receiveModalOverlay").classList.remove("open");toast("Stock received.");await loadData();
    }catch(err){toast(err.message||"Could not record stock receipt.","error")}finally{$("receiveModalSave").disabled=false;}
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
        await addDoc(collection(db,"usageRecords"),{materialId:id,materialName:m.materialName,usedQuantity:q,unit:m.unit,usageDate:$("useDate").value||null,remarks:$("useNotes").value.trim()||null});
        const remaining=num(m.quantity)-q;
        await updateDoc(doc(db,"materials",id),{quantity:remaining,status:remaining<=0?"Critical":remaining<num(m.minimumThreshold)?"Low":"Available"});
        $("useModalOverlay").classList.remove("open");toast("Material usage recorded.");await loadData();
    }catch(err){toast(err.message||"Could not record material usage.","error")}finally{$("useModalSave").disabled=false;}
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
    document.body.classList.add("auth-verified");
    await loadData();
});
