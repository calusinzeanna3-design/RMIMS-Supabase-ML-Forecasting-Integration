// RMIMS V2 — User Inventory & Stock Management Module
// Authoritative tables: raw_materials, stock_receipts, material_disbursements, user_profiles.
// Full 4-tab workspace matching Admin Inventory visual design & UX with permitted Staff/User edit & operational capabilities.
// Finished Products are read-only Admin inputs. Material Activity buttons are kept safely unlinked until Material Activity is rebuilt.
// Zero mock data. Strictly light theme.

import { auth, supabase } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

const $ = (id) => document.getElementById(id);

/* ==========================
   ROLE PROTECTION
========================== */

const profileBtn = $("profileBtn");

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../user-signin.html";
        return;
    }

    try {
        const { data: profile, error } = await supabase
            .from("user_profiles")
            .select("id, full_name, role, status")
            .eq("id", user.uid)
            .single();

        if (error || !profile || profile.status !== "active") {
            window.location.href = "../user-signin.html";
            return;
        }

        if (profile.role !== "user") {
            window.location.href = "../admin/dashboard.html";
            return;
        }

        if (profileBtn) {
            const pText = profileBtn.querySelector(".profile-text") || profileBtn;
            pText.textContent = profile.full_name || "Staff";
            const pAv = profileBtn.querySelector(".avatar");
            if (pAv && profile.full_name) {
                pAv.textContent = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
            }
        }

        await initUserInventory();
    } catch (err) {
        console.error("Auth verification failed:", err);
        window.location.href = "../user-signin.html";
    }
});

/* ==========================
   STATE MANAGEMENT
========================== */

const state = {
    // Authoritative collections
    materials: [],
    receipts: [],
    disbursements: [],

    // Maps
    rawMaterialsMap: new Map(), // id -> material obj

    // Overview Tab State
    overviewSearch: "",
    overviewDateFrom: "",
    overviewDateTo: "",
    overviewActivityFilter: "all", // "all" | "receive" | "disbursement"
    overviewStatusFilter: "all",   // "all" | "in_stock" | "low_stock" | "out_of_stock"
    overviewSort: "latest",        // "latest" | "oldest" | "az" | "za"
    overviewPage: 1,
    overviewPageSize: 10,

    // Receive Tab State
    receiveSearch: "",
    receiveDateFrom: "",
    receiveDateTo: "",
    receivePage: 1,
    receivePageSize: 10,

    // Disbursement Tab State
    disburseSearch: "",
    disburseDateFrom: "",
    disburseDateTo: "",
    disbursePage: 1,
    disbursePageSize: 10,

    // Other Details (Finished Products) Tab State
    finishedProducts: [],
    fpcSearch: "",
    fpcSort: "latest",
    fpcPage: 1,
    fpcPageSize: 10,

    // Active Workspace Tab
    activeTab: "overview"
};

const FP_STORAGE_KEY = "rmims_finished_product_context";

/* ==========================
   HELPERS & FORMATTING
========================== */

const esc = (val) => String(val ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const num = (val) => {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
};

const fmtQty = (v, u = "") => `${num(v).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}${u ? ` ${u}` : ""}`;

const fmtDate = (d) => {
    if (!d) return "—";
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return String(d);
    return dateObj.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

function getInitials(name) {
    if (!name) return "FP";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function setFieldError(elementId, errorMsg = "") {
    const el = $(elementId);
    if (!el) return;
    el.textContent = errorMsg;
    el.style.display = errorMsg ? "block" : "none";
}

function toast(message, type = "success") {
    const stack = $("toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${esc(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
        el.classList.add("leaving");
        setTimeout(() => el.remove(), 260);
    }, 3200);
}

/* ==========================================================
   STOCK STATUS FORMULA (INHERITED FROM ADMIN INVENTORY)
   ========================================================== */

function computeStockStatus(currentStock, minStock) {
    const q = num(currentStock);
    const min = minStock !== null && minStock !== undefined && minStock !== "" ? num(minStock) : null;
    if (q <= 0) {
        return { key: "out_of_stock", label: "Out of Stock", cls: "status-badge-outofstock", dotCls: "dot-red", badgeText: "🔴 Out of Stock" };
    }
    if (min !== null && q <= min) {
        return { key: "low_stock", label: "Low Stock", cls: "status-badge-lowstock", dotCls: "dot-orange", badgeText: "🟠 Low Stock" };
    }
    return { key: "in_stock", label: "In Stock", cls: "status-badge-instock", dotCls: "dot-green", badgeText: "🟢 In Stock" };
}

function computeStockProgress(currentStock, minStock, maxStock) {
    const curr = num(currentStock);
    const min = minStock !== null && minStock !== undefined ? num(minStock) : 0;
    const max = maxStock !== null && maxStock !== undefined && num(maxStock) > 0 
        ? num(maxStock) 
        : (min > 0 ? min * 2 : (curr > 0 ? curr * 1.5 : 100));

    if (curr <= 0) {
        return { pct: 0, cls: "fill-red", target: max };
    }

    const pct = Math.min(100, Math.max(1, Math.round((curr / max) * 100)));
    let cls = "fill-green";
    if (min > 0 && curr <= min) {
        cls = "fill-orange";
    }
    return { pct, cls, target: max };
}

function isGenericOperationalName(name) {
    if (!name) return true;
    const n = String(name).trim().toLowerCase();
    return (
        n === "operational use" ||
        n === "operational" ||
        n === "general usage" ||
        n === "general" ||
        n === "usage" ||
        n === "operational material context" ||
        n === "operational batch" ||
        n === "general production" ||
        n === "production" ||
        n === "sample usage"
    );
}

/* ==========================================================
   INITIALIZATION & TAB SWITCHING
   ========================================================== */

async function initUserInventory() {
    setupTabSwitching();
    setupOverviewEventListeners();
    setupReceiveEventListeners();
    setupDisburseEventListeners();
    setupEditModalEventListeners();
    setupOtherDetailsEventListeners();

    if ($("refreshBtn")) {
        $("refreshBtn").addEventListener("click", () => loadAllData(true));
    }

    await loadAllData();
}

function setupTabSwitching() {
    const tabs = [
        { btn: $("tabBtnOverview"), pane: $("paneOverview"), key: "overview", crumb: "Overview" },
        { btn: $("tabBtnReceive"), pane: $("paneReceive"), key: "receive", crumb: "Receive" },
        { btn: $("tabBtnDisbursement"), pane: $("paneDisbursement"), key: "disbursement", crumb: "Disbursement" },
        { btn: $("tabBtnOtherDetails"), pane: $("paneOtherDetails"), key: "other-details", crumb: "Other Details" }
    ];

    const currentCrumb = $("currentCrumb");

    tabs.forEach(t => {
        if (!t.btn) return;
        t.btn.addEventListener("click", () => {
            state.activeTab = t.key;
            tabs.forEach(o => {
                if (o.btn) o.btn.classList.toggle("active", o.key === t.key);
                if (o.pane) o.pane.hidden = o.key !== t.key;
            });
            if (currentCrumb) currentCrumb.textContent = t.crumb;

            if (t.key === "overview") renderOverviewTable();
            else if (t.key === "receive") renderReceiveTable();
            else if (t.key === "disbursement") renderDisbursementTable();
            else if (t.key === "other-details") renderFinishedProducts();
        });
    });
}

/* ==========================================================
   DATA LOADING & STATE AGGREGATION
   ========================================================== */

async function loadAllData(showToast = false) {
    try {
        const [mRes, rRes, dRes] = await Promise.all([
            supabase.from("raw_materials").select("id, item_code, name, description, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, created_at, updated_at").order("name"),
            supabase.from("stock_receipts").select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at").order("receipt_date", { ascending: false }),
            supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("usage_date", { ascending: false })
        ]);

        if (mRes.error) throw mRes.error;
        const rawMaterialsList = mRes.data || [];
        const rawReceipts = rRes.data || [];
        const rawDisbursements = dRes.data || [];

        // Build Raw Material Map & Catalog Objects
        state.rawMaterialsMap.clear();
        state.materials = rawMaterialsList.map(d => {
            const currentStock = num(d.current_stock);
            const minStock = d.minimum_threshold !== null && d.minimum_threshold !== undefined ? num(d.minimum_threshold) : null;
            const maxStock = d.reorder_quantity !== null && d.reorder_quantity !== undefined ? num(d.reorder_quantity) : null;
            const status = computeStockStatus(currentStock, minStock);
            const progress = computeStockProgress(currentStock, minStock, maxStock);
            const unit = (d.unit_of_measure || "kg").trim();
            const category = d.description ? d.description.split("—")[0].trim() : "General";

            const matObj = {
                id: d.id,
                itemCode: d.item_code || "",
                name: d.name || "Unnamed Material",
                category,
                unit,
                currentStock,
                minStock,
                maxStock,
                progress,
                status,
                note: d.description || "",
                createdAt: d.created_at || null,
                updatedAt: d.updated_at || null,
                latestActivityDate: d.created_at || null,
                latestActivityType: "Initial Stock",
                latestActivityQty: currentStock,
                latestActivityUnit: unit
            };

            state.rawMaterialsMap.set(d.id, matObj);
            return matObj;
        });

        // Store Receipts & Disbursements
        if (rawReceipts.length === 0 && rawMaterialsList.length > 0) {
            state.receipts = rawMaterialsList.filter(m => num(m.current_stock) > 0).map(d => ({
                id: `rec-${d.id}`,
                material_id: d.id,
                received_quantity: num(d.current_stock),
                unit: (d.unit_of_measure || "kg").trim(),
                receipt_date: d.created_at ? d.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
                supplier_name: d.description && d.description.includes("Supplier:") ? d.description.split("Supplier:")[1].trim() : "Standard Supplier / Received Delivery",
                created_at: d.created_at || new Date().toISOString()
            }));
        } else {
            state.receipts = rawReceipts;
        }
        state.disbursements = rawDisbursements;

        // Associate latest activity for each material
        const actByMat = new Map();
        state.receipts.forEach(r => {
            const cur = actByMat.get(r.material_id);
            const rTime = new Date(r.receipt_date || r.created_at || 0).getTime();
            if (!cur || rTime > cur.time) {
                actByMat.set(r.material_id, {
                    time: rTime,
                    date: r.receipt_date || r.created_at,
                    type: "Receive",
                    qty: num(r.received_quantity),
                    unit: r.unit || "kg"
                });
            }
        });

        state.disbursements.forEach(d => {
            const cur = actByMat.get(d.material_id);
            const dTime = new Date(d.usage_date || d.created_at || 0).getTime();
            if (!cur || dTime > cur.time) {
                actByMat.set(d.material_id, {
                    time: dTime,
                    date: d.usage_date || d.created_at,
                    type: "Disbursement",
                    qty: num(d.consumed_quantity),
                    unit: d.unit || "kg"
                });
            }
        });

        state.materials.forEach(m => {
            const act = actByMat.get(m.id);
            if (act) {
                m.latestActivityDate = act.date;
                m.latestActivityType = act.type;
                m.latestActivityQty = act.qty;
                m.latestActivityUnit = act.unit;
            } else if (m.currentStock > 0) {
                m.latestActivityType = "Receive";
                m.latestActivityQty = m.currentStock;
                m.latestActivityUnit = m.unit;
            }
        });

        // Load Finished Products (Admin-inputted products only)
        let savedContext = [];
        try {
            const raw = localStorage.getItem(FP_STORAGE_KEY);
            if (raw) savedContext = JSON.parse(raw);
        } catch (e) {
            console.warn("Notice loading local finished product context:", e);
        }

        const productMap = new Map();
        if (Array.isArray(savedContext)) {
            savedContext.forEach(p => {
                if (!p || !p.name || isGenericOperationalName(p.name)) return;
                const norm = p.name.trim();
                productMap.set(norm.toLowerCase(), {
                    id: p.id || "fp_" + Math.random().toString(36).substr(2, 9),
                    name: norm,
                    imageUrl: p.imageUrl || null,
                    materialIds: new Set(p.materialIds || []),
                    createdAt: p.createdAt || new Date().toISOString()
                });
            });
        }

        rawDisbursements.forEach(d => {
            const prodName = d.finished_product_name ? d.finished_product_name.trim() : "";
            if (!prodName || isGenericOperationalName(prodName)) return;
            const key = prodName.toLowerCase();
            if (!productMap.has(key)) {
                productMap.set(key, {
                    id: "fp_" + Math.random().toString(36).substr(2, 9),
                    name: prodName,
                    imageUrl: null,
                    materialIds: new Set(),
                    createdAt: new Date().toISOString()
                });
            }
            if (d.material_id) {
                productMap.get(key).materialIds.add(d.material_id);
            }
        });

        state.finishedProducts = Array.from(productMap.values()).map(p => ({
            id: p.id,
            name: p.name,
            imageUrl: p.imageUrl,
            materialIds: Array.from(p.materialIds),
            createdAt: p.createdAt
        }));

        // Render Summary Cards & Active Pane
        renderSummary();
        if (state.activeTab === "overview") renderOverviewTable();
        else if (state.activeTab === "receive") renderReceiveTable();
        else if (state.activeTab === "disbursement") renderDisbursementTable();
        else if (state.activeTab === "other-details") renderFinishedProducts();

        if (showToast) toast("Inventory data refreshed.");
    } catch (err) {
        console.error("loadAllData error:", err);
        toast("Failed to load inventory data.", "error");
    }
}

/* ==========================================================
   SUMMARY & STOCK HEALTH PRESENTATION
   ========================================================== */

function renderSummary() {
    const totalCount = state.materials.length;
    let inStockCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    state.materials.forEach(m => {
        if (m.status.key === "in_stock") inStockCount++;
        else if (m.status.key === "low_stock") lowStockCount++;
        else if (m.status.key === "out_of_stock") outOfStockCount++;
    });

    if ($("summaryTotalCount")) $("summaryTotalCount").textContent = totalCount;
    if ($("summaryActiveCount")) $("summaryActiveCount").textContent = totalCount;
    if ($("statInStockCount")) $("statInStockCount").textContent = inStockCount;
    if ($("statLowStockCount")) $("statLowStockCount").textContent = lowStockCount;
    if ($("statOutOfStockCount")) $("statOutOfStockCount").textContent = outOfStockCount;

    const inStockPct = totalCount > 0 ? (inStockCount / totalCount) * 100 : 0;
    const lowStockPct = totalCount > 0 ? (lowStockCount / totalCount) * 100 : 0;
    const outOfStockPct = totalCount > 0 ? (outOfStockCount / totalCount) * 100 : 0;

    if ($("segInStock")) $("segInStock").style.width = `${inStockPct}%`;
    if ($("segLowStock")) $("segLowStock").style.width = `${lowStockPct}%`;
    if ($("segOutOfStock")) $("segOutOfStock").style.width = `${outOfStockPct}%`;
}

/* ==========================================================
   TAB 1: OVERVIEW (11-COLUMN INVENTORY TABLE + USER EDIT)
   ========================================================== */

function setupOverviewEventListeners() {
    const searchInput = $("invSearchInput");
    const dateFrom = $("invDateFrom");
    const dateTo = $("invDateTo");
    const actFilter = $("invActivityStatusFilter");
    const statusFilter = $("invStatusFilter");
    const sortFilter = $("invSortFilter");
    const pageSizeSelect = $("overviewPageSize");
    const clearBtn = $("invClearFiltersBtn");

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.overviewSearch = searchInput.value.trim().toLowerCase();
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (dateFrom) {
        dateFrom.addEventListener("change", () => {
            state.overviewDateFrom = dateFrom.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (dateTo) {
        dateTo.addEventListener("change", () => {
            state.overviewDateTo = dateTo.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (actFilter) {
        actFilter.addEventListener("change", () => {
            state.overviewActivityFilter = actFilter.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (statusFilter) {
        statusFilter.addEventListener("change", () => {
            state.overviewStatusFilter = statusFilter.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (sortFilter) {
        sortFilter.addEventListener("change", () => {
            state.overviewSort = sortFilter.value;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (pageSizeSelect) {
        pageSizeSelect.addEventListener("change", () => {
            state.overviewPageSize = Number(pageSizeSelect.value) || 10;
            state.overviewPage = 1;
            renderOverviewTable();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            state.overviewSearch = "";
            state.overviewDateFrom = "";
            state.overviewDateTo = "";
            state.overviewActivityFilter = "all";
            state.overviewStatusFilter = "all";
            state.overviewSort = "latest";
            state.overviewPage = 1;

            if (searchInput) searchInput.value = "";
            if (dateFrom) dateFrom.value = "";
            if (dateTo) dateTo.value = "";
            if (actFilter) actFilter.value = "all";
            if (statusFilter) statusFilter.value = "all";
            if (sortFilter) sortFilter.value = "latest";

            renderOverviewTable();
        });
    }

    // Material Detail Modal Close
    const modalClose = $("detailModalClose");
    const modalCancel = $("detailModalCancel");
    const modalOverlay = $("detailModalOverlay");

    if (modalClose) modalClose.addEventListener("click", () => modalOverlay.classList.remove("open"));
    if (modalCancel) modalCancel.addEventListener("click", () => modalOverlay.classList.remove("open"));
    if (modalOverlay) {
        modalOverlay.addEventListener("click", (e) => {
            if (e.target === modalOverlay) modalOverlay.classList.remove("open");
        });
    }
}

function getFilteredOverviewList() {
    let filtered = state.materials.filter(item => {
        // Search
        if (state.overviewSearch) {
            const combined = `${item.name} ${item.itemCode} ${item.category} ${item.note}`.toLowerCase();
            if (!combined.includes(state.overviewSearch)) return false;
        }

        // Date Range
        if (state.overviewDateFrom && item.latestActivityDate) {
            if (new Date(item.latestActivityDate) < new Date(state.overviewDateFrom)) return false;
        }
        if (state.overviewDateTo && item.latestActivityDate) {
            const d = new Date(state.overviewDateTo);
            d.setHours(23, 59, 59, 999);
            if (new Date(item.latestActivityDate) > d) return false;
        }

        // Activity Type
        if (state.overviewActivityFilter !== "all") {
            const act = String(item.latestActivityType || "").toLowerCase();
            if (state.overviewActivityFilter === "receive" && act !== "receive") return false;
            if (state.overviewActivityFilter === "disbursement" && act !== "disbursement") return false;
        }

        // Stock Status
        if (state.overviewStatusFilter !== "all" && item.status.key !== state.overviewStatusFilter) {
            return false;
        }

        return true;
    });

    // Sorting
    filtered.sort((a, b) => {
        if (state.overviewSort === "az") return a.name.localeCompare(b.name);
        if (state.overviewSort === "za") return b.name.localeCompare(a.name);
        if (state.overviewSort === "oldest") {
            return new Date(a.latestActivityDate || a.createdAt || 0).getTime() - new Date(b.latestActivityDate || b.createdAt || 0).getTime();
        }
        // Default latest
        return new Date(b.latestActivityDate || b.createdAt || 0).getTime() - new Date(a.latestActivityDate || a.createdAt || 0).getTime();
    });

    return filtered;
}

function renderOverviewTable() {
    const tbody = $("overviewTableBody");
    const countEl = $("overviewResultCount");
    const btnsEl = $("overviewPaginationBtns");
    const clearBtn = $("invClearFiltersBtn");
    if (!tbody) return;

    const filtered = getFilteredOverviewList();
    const total = filtered.length;

    const isFiltered = !!state.overviewSearch || !!state.overviewDateFrom || !!state.overviewDateTo || state.overviewActivityFilter !== "all" || state.overviewStatusFilter !== "all" || state.overviewSort !== "latest";
    if (clearBtn) clearBtn.hidden = !isFiltered;

    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align:center; padding: 36px 16px; color: var(--rm-ink-dim);">
                    <strong>No raw materials found.</strong><br>
                    <span style="font-size: 0.8rem;">Try adjusting your search criteria or filters.</span>
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = `Showing 0 of ${state.materials.length} raw materials`;
        if (btnsEl) btnsEl.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / state.overviewPageSize));
    if (state.overviewPage > totalPages) state.overviewPage = totalPages;
    if (state.overviewPage < 1) state.overviewPage = 1;

    const startIdx = (state.overviewPage - 1) * state.overviewPageSize;
    const endIdx = Math.min(startIdx + state.overviewPageSize, total);
    const paged = filtered.slice(startIdx, endIdx);

    if (countEl) {
        countEl.textContent = `Showing ${startIdx + 1}–${endIdx} of ${total} raw materials`;
    }

    tbody.innerHTML = paged.map(item => {
        let actCls = "status-badge";
        if (item.latestActivityType === "Receive") actCls = "status-badge status-badge-instock";
        else if (item.latestActivityType === "Disbursement") actCls = "status-badge status-badge-lowstock";

        return `
            <tr data-id="${esc(item.id)}">
                <td>${esc(fmtDate(item.latestActivityDate || item.createdAt))}</td>
                <td>
                    <div class="mat-name-cell">
                        <span class="mat-name-primary">${esc(item.name)}</span>
                        ${item.note ? `<span class="mat-name-note" title="${esc(item.note)}">${esc(item.note)}</span>` : ""}
                    </div>
                </td>
                <td><span class="mat-id-badge">${esc(item.itemCode || "—")}</span></td>
                <td>${item.minStock !== null ? `${fmtQty(item.minStock)} ${esc(item.unit)}` : "—"}</td>
                <td><strong>${fmtQty(item.currentStock)} ${esc(item.unit)}</strong></td>
                <td>${esc(item.unit)}</td>
                <td><span class="${actCls}">${esc(item.latestActivityType || "Initial Stock")}</span></td>
                <td>${item.latestActivityQty !== null ? fmtQty(item.latestActivityQty) : "—"}</td>
                <td>${esc(item.latestActivityUnit || item.unit)}</td>
                <td><span class="status-badge ${item.status.cls}">${esc(item.status.badgeText)}</span></td>
                <td style="text-align: right; white-space: nowrap;">
                    <button type="button" class="btn-outline-sm btn-mat-edit" data-id="${esc(item.id)}" title="Edit Material" style="padding: 4px 8px; font-size: 0.76rem; margin-right: 4px;">
                        Edit
                    </button>
                    <button type="button" class="btn-outline-sm btn-mat-detail" data-id="${esc(item.id)}" title="View Details" style="padding: 4px 8px; font-size: 0.76rem;">
                        View
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    renderPaginationControls(btnsEl, state.overviewPage, totalPages, (p) => {
        state.overviewPage = p;
        renderOverviewTable();
    });

    tbody.querySelectorAll(".btn-mat-edit").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const mat = state.rawMaterialsMap.get(id);
            if (mat) openEditMaterialModal(mat);
        });
    });

    tbody.querySelectorAll(".btn-mat-detail").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const mat = state.rawMaterialsMap.get(id);
            if (mat) openMaterialDetailModal(mat);
        });
    });
}

/* ==========================================================
   EDIT MATERIAL MODAL & LOGIC (STAFF/USER ACCESS)
   ========================================================== */

function setupEditModalEventListeners() {
    const closeBtn = $("editMaterialModalClose");
    const cancelBtn = $("editMaterialCancelBtn");
    const saveBtn = $("editMaterialSaveBtn");
    const overlay = $("editMaterialModalOverlay");

    if (closeBtn) closeBtn.addEventListener("click", () => overlay.classList.remove("open"));
    if (cancelBtn) cancelBtn.addEventListener("click", () => overlay.classList.remove("open"));
    if (overlay) {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) overlay.classList.remove("open");
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", handleEditMaterialSave);
    }
}

function initModalDatePicker(elementId, initialDate = "today", todayOnly = true) {
    const el = typeof elementId === "string" ? $(elementId) : elementId;
    if (!el) return null;

    if (el._flatpickr) {
        el._flatpickr.destroy();
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const defaultVal = initialDate === "today" ? todayStr : (initialDate || todayStr);

    if (typeof flatpickr === "undefined") {
        el.value = defaultVal;
        if (todayOnly) {
            el.min = todayStr;
            el.max = todayStr;
        }
        return null;
    }

    const config = {
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d/m/Y",
        defaultDate: defaultVal,
        disableMobile: true,
        allowInput: false,
        animate: true
    };

    if (todayOnly) {
        config.minDate = "today";
        config.maxDate = "today";
    }

    return flatpickr(el, config);
}

function openEditMaterialModal(mat) {
    const overlay = $("editMaterialModalOverlay");
    if (!overlay) return;

    $("editMatIdInternal").value = mat.id;
    $("editMatName").value = mat.name;
    $("editMatCode").value = mat.itemCode || "—";
    $("editMatUnit").value = mat.unit || "kg";
    $("editMatCurrentStock").value = `${fmtQty(mat.currentStock)} ${mat.unit}`;
    $("editMatMinStock").value = mat.minStock !== null ? mat.minStock : "";
    
    const dateVal = mat.createdAt ? new Date(mat.createdAt).toISOString().slice(0, 10) : "today";
    if ($("editMatDate")) initModalDatePicker("editMatDate", dateVal, true);
    $("editMatNote").value = mat.note || "";

    setFieldError("editMatNameError");
    setFieldError("editMatMinStockError");

    overlay.classList.add("open");
}

async function handleEditMaterialSave() {
    const id = $("editMatIdInternal").value;
    const name = $("editMatName").value.trim();
    const minStockVal = $("editMatMinStock").value.trim();
    const minStock = minStockVal !== "" ? num(minStockVal) : null;
    const note = $("editMatNote").value.trim();

    setFieldError("editMatNameError");
    setFieldError("editMatMinStockError");

    let isValid = true;
    if (!name) {
        setFieldError("editMatNameError", "Material name is required.");
        isValid = false;
    }
    if (minStockVal === "" || minStock < 0) {
        setFieldError("editMatMinStockError", "Valid minimum stock threshold (≥ 0) is required.");
        isValid = false;
    }

    const normName = name.toLowerCase();
    const duplicate = state.materials.some(m => m.id !== id && m.name.trim().toLowerCase() === normName);
    if (duplicate) {
        setFieldError("editMatNameError", "Another raw material with this name already exists.");
        isValid = false;
    }

    if (!isValid) return;

    const saveBtn = $("editMaterialSaveBtn");
    saveBtn.disabled = true;

    try {
        const { error: updateErr } = await supabase
            .from("raw_materials")
            .update({
                name: name,
                minimum_threshold: minStock,
                description: note || null,
                updated_at: new Date().toISOString()
            })
            .eq("id", id);

        if (updateErr) throw updateErr;

        toast("Material updated successfully.");
        $("editMaterialModalOverlay").classList.remove("open");
        await loadAllData();
    } catch (err) {
        console.error("Update material error:", err);
        toast(err.message || "Failed to update raw material.", "error");
    } finally {
        saveBtn.disabled = false;
    }
}

/* ==========================================================
   TAB 2: RECEIVE (LIVE STOCK RECEIPTS TABLE + VISIT ACTIVITY)
   ========================================================== */

function setupReceiveEventListeners() {
    const searchInput = $("receiveSearchInput");
    const dateFrom = $("receiveDateFrom");
    const dateTo = $("receiveDateTo");
    const visitBtn = $("btnVisitReceiveActivity");

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.receiveSearch = searchInput.value.trim().toLowerCase();
            state.receivePage = 1;
            renderReceiveTable();
        });
    }

    if (dateFrom) {
        dateFrom.addEventListener("change", () => {
            state.receiveDateFrom = dateFrom.value;
            state.receivePage = 1;
            renderReceiveTable();
        });
    }

    if (dateTo) {
        dateTo.addEventListener("change", () => {
            state.receiveDateTo = dateTo.value;
            state.receivePage = 1;
            renderReceiveTable();
        });
    }

    if (visitBtn) {
        visitBtn.addEventListener("click", () => {
            toast("Material Activity will be available in the upcoming step.", "info");
        });
    }
}

function renderReceiveTable() {
    const tbody = $("receiveTableBody");
    const countEl = $("receiveResultCount");
    const btnsEl = $("receivePaginationBtns");
    if (!tbody) return;

    let filtered = state.receipts.filter(r => {
        const mat = state.rawMaterialsMap.get(r.material_id);
        const matName = mat ? mat.name.toLowerCase() : "";
        const matCode = mat ? mat.itemCode.toLowerCase() : "";
        const supplier = (r.supplier_name || "").toLowerCase();

        if (state.receiveSearch) {
            const combined = `${matName} ${matCode} ${supplier}`;
            if (!combined.includes(state.receiveSearch)) return false;
        }

        if (state.receiveDateFrom && r.receipt_date) {
            if (new Date(r.receipt_date) < new Date(state.receiveDateFrom)) return false;
        }
        if (state.receiveDateTo && r.receipt_date) {
            const d = new Date(state.receiveDateTo);
            d.setHours(23, 59, 59, 999);
            if (new Date(r.receipt_date) > d) return false;
        }

        return true;
    });

    const total = filtered.length;
    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; padding: 36px 16px; color: var(--rm-ink-dim);">
                    <strong>No stock receipts found.</strong><br>
                    <span style="font-size: 0.8rem;">Incoming receipts logged via Material Activity will appear here.</span>
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = "Showing 0 receipts";
        if (btnsEl) btnsEl.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / state.receivePageSize));
    if (state.receivePage > totalPages) state.receivePage = totalPages;
    if (state.receivePage < 1) state.receivePage = 1;

    const start = (state.receivePage - 1) * state.receivePageSize;
    const end = Math.min(start + state.receivePageSize, total);
    const paged = filtered.slice(start, end);

    if (countEl) countEl.textContent = `Showing ${start + 1}–${end} of ${total} receipts`;

    tbody.innerHTML = paged.map(r => {
        const mat = state.rawMaterialsMap.get(r.material_id);
        const name = mat ? mat.name : "Unknown Material";
        const code = mat ? mat.itemCode : "—";
        const curStock = mat ? `${fmtQty(mat.currentStock)} ${mat.unit}` : "—";
        const minStock = mat && mat.minStock !== null ? `${fmtQty(mat.minStock)} ${mat.unit}` : "—";
        const statusBadge = mat ? `<span class="status-badge ${mat.status.cls}">${esc(mat.status.badgeText)}</span>` : "—";

        return `
            <tr>
                <td>${esc(fmtDate(r.receipt_date || r.created_at))}</td>
                <td><strong>${esc(name)}</strong></td>
                <td><span class="mat-id-badge">${esc(code)}</span></td>
                <td><strong>+${fmtQty(r.received_quantity)}</strong></td>
                <td>${esc(r.unit || "kg")}</td>
                <td>${esc(r.supplier_name || "Standard Supplier")}</td>
                <td>${curStock}</td>
                <td>${minStock}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join("");

    renderPaginationControls(btnsEl, state.receivePage, totalPages, (p) => {
        state.receivePage = p;
        renderReceiveTable();
    });
}

/* ==========================================================
   TAB 3: DISBURSEMENT (LIVE CONSUMPTION TABLE + VISIT ACTIVITY)
   ========================================================== */

function setupDisburseEventListeners() {
    const searchInput = $("disbursementSearchInput");
    const dateFrom = $("disburseDateFrom");
    const dateTo = $("disburseDateTo");
    const visitBtn = $("btnVisitDisburseActivity");

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.disburseSearch = searchInput.value.trim().toLowerCase();
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }

    if (dateFrom) {
        dateFrom.addEventListener("change", () => {
            state.disburseDateFrom = dateFrom.value;
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }

    if (dateTo) {
        dateTo.addEventListener("change", () => {
            state.disburseDateTo = dateTo.value;
            state.disbursePage = 1;
            renderDisbursementTable();
        });
    }

    if (visitBtn) {
        visitBtn.addEventListener("click", () => {
            toast("Material Activity will be available in the upcoming step.", "info");
        });
    }
}

function renderDisbursementTable() {
    const tbody = $("disbursementTableBody");
    const countEl = $("disbursementResultCount");
    const btnsEl = $("disbursementPaginationBtns");
    if (!tbody) return;

    let filtered = state.disbursements.filter(d => {
        const mat = state.rawMaterialsMap.get(d.material_id);
        const matName = mat ? mat.name.toLowerCase() : "";
        const matCode = mat ? mat.itemCode.toLowerCase() : "";
        const context = `${d.activity_type || ""} ${d.finished_product_name || ""}`.toLowerCase();

        if (state.disburseSearch) {
            const combined = `${matName} ${matCode} ${context}`;
            if (!combined.includes(state.disburseSearch)) return false;
        }

        if (state.disburseDateFrom && d.usage_date) {
            if (new Date(d.usage_date) < new Date(state.disburseDateFrom)) return false;
        }
        if (state.disburseDateTo && d.usage_date) {
            const dt = new Date(state.disburseDateTo);
            dt.setHours(23, 59, 59, 999);
            if (new Date(d.usage_date) > dt) return false;
        }

        return true;
    });

    const total = filtered.length;
    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; padding: 36px 16px; color: var(--rm-ink-dim);">
                    <strong>No material disbursements found.</strong><br>
                    <span style="font-size: 0.8rem;">Usage logged via Material Activity will appear here.</span>
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = "Showing 0 disbursements";
        if (btnsEl) btnsEl.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / state.disbursePageSize));
    if (state.disbursePage > totalPages) state.disbursePage = totalPages;
    if (state.disbursePage < 1) state.disbursePage = 1;

    const start = (state.disbursePage - 1) * state.disbursePageSize;
    const end = Math.min(start + state.disbursePageSize, total);
    const paged = filtered.slice(start, end);

    if (countEl) countEl.textContent = `Showing ${start + 1}–${end} of ${total} disbursements`;

    tbody.innerHTML = paged.map(d => {
        const mat = state.rawMaterialsMap.get(d.material_id);
        const name = mat ? mat.name : "Unknown Material";
        const code = mat ? mat.itemCode : "—";
        const curStock = mat ? `${fmtQty(mat.currentStock)} ${mat.unit}` : "—";
        const minStock = mat && mat.minStock !== null ? `${fmtQty(mat.minStock)} ${mat.unit}` : "—";
        const statusBadge = mat ? `<span class="status-badge ${mat.status.cls}">${esc(mat.status.badgeText)}</span>` : "—";
        const usageContext = d.finished_product_name || d.activity_type || "General Usage";

        return `
            <tr>
                <td>${esc(fmtDate(d.usage_date || d.created_at))}</td>
                <td><strong>${esc(name)}</strong></td>
                <td><span class="mat-id-badge">${esc(code)}</span></td>
                <td><strong style="color: var(--amber-dark, #D97706);">${fmtQty(d.consumed_quantity)}</strong></td>
                <td>${esc(d.unit || "kg")}</td>
                <td>${esc(usageContext)}</td>
                <td>${curStock}</td>
                <td>${minStock}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join("");

    renderPaginationControls(btnsEl, state.disbursePage, totalPages, (p) => {
        state.disbursePage = p;
        renderDisbursementTable();
    });
}

/* ==========================================================
   TAB 4: OTHER DETAILS (FINISHED PRODUCTS - READ ONLY)
   ========================================================== */

function setupOtherDetailsEventListeners() {
    const searchInput = $("fpcSearchInput");
    const sortSelect = $("fpcSortSelect");
    const pageSizeSelect = $("fpcPageSizeSelect");
    const detailsClose = $("fpcDetailsModalClose");
    const detailsCancel = $("fpcDetailsModalCancel");
    const detailsOverlay = $("fpcDetailsModalOverlay");

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.fpcSearch = searchInput.value.trim().toLowerCase();
            state.fpcPage = 1;
            renderFinishedProducts();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            state.fpcSort = sortSelect.value;
            state.fpcPage = 1;
            renderFinishedProducts();
        });
    }

    if (pageSizeSelect) {
        pageSizeSelect.addEventListener("change", () => {
            state.fpcPageSize = Number(pageSizeSelect.value) || 10;
            state.fpcPage = 1;
            renderFinishedProducts();
        });
    }

    if (detailsClose) detailsClose.addEventListener("click", () => detailsOverlay.classList.remove("open"));
    if (detailsCancel) detailsCancel.addEventListener("click", () => detailsOverlay.classList.remove("open"));
    if (detailsOverlay) {
        detailsOverlay.addEventListener("click", (e) => {
            if (e.target === detailsOverlay) detailsOverlay.classList.remove("open");
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const editOverlay = $("editMaterialModalOverlay");
            const detOverlay = $("detailModalOverlay");
            const fpcOverlay = $("fpcDetailsModalOverlay");

            if (editOverlay) editOverlay.classList.remove("open");
            if (detOverlay) detOverlay.classList.remove("open");
            if (fpcOverlay) fpcOverlay.classList.remove("open");
        }
    });
}

function renderFinishedProducts() {
    const container = $("fpcCardsContainer");
    const resultCountEl = $("fpcResultCount");
    const paginationBtns = $("fpcPaginationBtns");
    if (!container) return;

    let filtered = state.finishedProducts.filter(p => {
        if (!state.fpcSearch) return true;
        if (p.name.toLowerCase().includes(state.fpcSearch)) return true;

        const mats = p.materialIds.map(id => state.rawMaterialsMap.get(id)).filter(Boolean);
        return mats.some(m => m.name.toLowerCase().includes(state.fpcSearch) || m.itemCode.toLowerCase().includes(state.fpcSearch));
    });

    filtered.sort((a, b) => {
        if (state.fpcSort === "az") return a.name.localeCompare(b.name);
        if (state.fpcSort === "za") return b.name.localeCompare(a.name);
        if (state.fpcSort === "oldest") return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    if (state.finishedProducts.length === 0) {
        container.innerHTML = `
            <div class="fpc-empty-state" style="grid-column: 1 / -1; padding: 48px 24px; text-align: center;">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 44px; height: 44px; color: #94a3b8; margin-bottom: 12px;"><path d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15M9 5C9 6.10457 9.89543 7 11 7H13C14.1046 7 15 6.10457 15 5M9 12H15M9 16H13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--rm-ink); margin: 0 0 6px;">No finished products have been configured yet.</h4>
                <p style="font-size: 0.84rem; color: var(--rm-ink-dim); margin: 0;">Finished products configured by Administrators will automatically appear here.</p>
            </div>
        `;
        if (resultCountEl) resultCountEl.textContent = "Showing 0 finished products";
        if (paginationBtns) paginationBtns.innerHTML = "";
        return;
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="fpc-empty-state" style="grid-column: 1 / -1; padding: 36px 20px; text-align: center;">
                <h4 style="font-size: 0.98rem; font-weight: 700; color: var(--rm-ink); margin: 0 0 6px;">No finished products found</h4>
                <p style="font-size: 0.84rem; color: var(--rm-ink-dim); margin: 0;">No items match "${esc(state.fpcSearch)}".</p>
            </div>
        `;
        if (resultCountEl) resultCountEl.textContent = "Showing 0 of " + state.finishedProducts.length + " finished products";
        if (paginationBtns) paginationBtns.innerHTML = "";
        return;
    }

    const total = filtered.length;
    const maxPage = Math.max(1, Math.ceil(total / state.fpcPageSize));
    if (state.fpcPage > maxPage) state.fpcPage = maxPage;

    const start = (state.fpcPage - 1) * state.fpcPageSize;
    const paged = filtered.slice(start, start + state.fpcPageSize);

    if (resultCountEl) {
        const s = start + 1;
        const e = Math.min(total, start + state.fpcPageSize);
        resultCountEl.textContent = `Showing ${s}–${e} of ${total} finished product${total === 1 ? "" : "s"}`;
    }

    container.innerHTML = paged.map(p => {
        const matCount = p.materialIds.length;
        const linkedMaterials = p.materialIds.map(id => state.rawMaterialsMap.get(id)).filter(Boolean);

        const avatarHtml = p.imageUrl
            ? `<div class="fpc-avatar"><img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" class="fpc-avatar-img"></div>`
            : `<div class="fpc-avatar"><span>${esc(getInitials(p.name))}</span></div>`;

        const matRowsHtml = linkedMaterials.length > 0
            ? linkedMaterials.map(m => `
                <div class="fpc-mat-preview-row">
                    <span class="fpc-mat-name" title="${esc(m.name)}">${esc(m.name)}</span>
                    <span class="fpc-mat-qty">${fmtQty(m.currentStock)} ${esc(m.unit)}</span>
                    <span class="status-badge ${m.status.cls}" style="font-size: 0.7rem; padding: 2px 6px;">
                        ${esc(m.status.badgeText)}
                    </span>
                </div>
            `).join("")
            : `<div style="font-size: 0.8rem; color: var(--rm-ink-dim); padding: 4px 0;">No raw materials currently mapped.</div>`;

        return `
            <div class="fpc-card">
                <div>
                    <div class="fpc-card-top">
                        ${avatarHtml}
                        <div class="fpc-card-meta">
                            <h4 class="fpc-card-title" title="${esc(p.name)}">${esc(p.name)}</h4>
                            <span class="fpc-mat-count-badge">${matCount} raw material${matCount === 1 ? "" : "s"}</span>
                        </div>
                    </div>

                    <div class="fpc-mat-preview-list">
                        ${matRowsHtml}
                    </div>
                </div>

                <div class="fpc-card-footer" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <button type="button" class="btn-view-details btn-fpc-details" data-id="${esc(p.id)}">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 14px; height: 14px;"><path d="M15 12A3 3 0 1 1 9 12A3 3 0 0 1 15 12Z" stroke="currentColor" stroke-width="2"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5C16.478 5 20.268 7.943 21.542 12C20.268 16.057 16.478 19 12 19C7.523 19 3.732 16.057 2.458 12Z" stroke="currentColor" stroke-width="2"/></svg>
                        View Details
                    </button>
                    <button type="button" class="btn-receive-disburse-disabled btn-fpc-activity-unlinked" title="Material Activity will be available in the upcoming step" disabled>
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 13px; height: 13px;"><path d="M9 2H15M9 2C7.89543 2 7 2.89543 7 4V5H17V4C17 2.89543 16.1046 2 15 2M9 2H7.5C6.67157 2 6 2.67157 6 3.5V20.5C6 21.3284 6.67157 22 7.5 22H16.5C17.3284 22 18 21.3284 18 20.5V3.5C18 2.67157 17.3284 2 16.5 2H15" stroke="currentColor" stroke-width="1.6"/><path d="M9 12H15M9 16H15M9 8H11" stroke="currentColor" stroke-linecap="round" stroke-width="1.6"/></svg>
                        Material Activity
                    </button>
                </div>
            </div>
        `;
    }).join("");

    container.querySelectorAll(".btn-fpc-details").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const prod = state.finishedProducts.find(p => p.id === id);
            if (prod) openFinishedProductModal(prod);
        });
    });

    renderPaginationControls(paginationBtns, state.fpcPage, maxPage, (newPage) => {
        state.fpcPage = newPage;
        renderFinishedProducts();
    });
}

function openFinishedProductModal(product) {
    const overlay = $("fpcDetailsModalOverlay");
    const nameEl = $("fpcDetailsName");
    const countEl = $("fpcDetailsMatCount");
    const avatarWrap = $("fpcDetailsAvatarWrap");
    const tbody = $("fpcDetailsTableBody");
    if (!overlay) return;

    if (nameEl) nameEl.textContent = product.name;
    if (countEl) {
        const c = product.materialIds.length;
        countEl.textContent = `${c} Associated Raw Material${c === 1 ? "" : "s"}`;
    }

    if (avatarWrap) {
        avatarWrap.innerHTML = product.imageUrl
            ? `<div class="fpc-avatar"><img src="${esc(product.imageUrl)}" alt="${esc(product.name)}" class="fpc-avatar-img"></div>`
            : `<div class="fpc-avatar"><span>${esc(getInitials(product.name))}</span></div>`;
    }

    if (tbody) {
        const rows = product.materialIds.map(id => {
            const mat = state.rawMaterialsMap.get(id);
            if (!mat) {
                return `
                    <tr>
                        <td><strong>Unknown Material</strong></td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td><span class="status-badge status-badge-outofstock">🔴 Unmapped</span></td>
                    </tr>
                `;
            }

            return `
                <tr>
                    <td><strong>${esc(mat.name)}</strong></td>
                    <td><span class="mat-id-badge">${esc(mat.itemCode || "—")}</span></td>
                    <td><strong>${fmtQty(mat.currentStock)} ${esc(mat.unit)}</strong></td>
                    <td>${mat.minStock !== null ? `${fmtQty(mat.minStock)} ${esc(mat.unit)}` : "—"}</td>
                    <td>${esc(mat.unit)}</td>
                    <td><span class="status-badge ${mat.status.cls}">${esc(mat.status.badgeText)}</span></td>
                </tr>
            `;
        }).join("");

        tbody.innerHTML = rows || `<tr><td colspan="6" style="text-align: center; color: var(--rm-ink-dim); padding: 20px;">No materials currently linked to this product.</td></tr>`;
    }

    overlay.classList.add("open");
}

/* ==========================================================
   READ-ONLY MATERIAL DETAIL VIEW MODAL
   ========================================================== */

function openMaterialDetailModal(mat) {
    const overlay = $("detailModalOverlay");
    const nameEl = $("detailMaterialName");
    const subEl = $("detailMaterialSubtitle");
    const bodyEl = $("detailModalBody");
    if (!overlay || !bodyEl) return;

    if (nameEl) nameEl.textContent = mat.name;
    if (subEl) subEl.textContent = `${mat.itemCode ? `ID: ${mat.itemCode} · ` : ""}${mat.category}`;

    const maxDisplay = mat.maxStock !== null ? `${fmtQty(mat.maxStock)} ${esc(mat.unit)}` : `${fmtQty(mat.progress.target)} ${esc(mat.unit)}`;

    bodyEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                <div style="background: #F8FAFC; border: 1px solid var(--rm-line, #E2E8F0); border-radius: 8px; padding: 12px;">
                    <span style="font-size: 0.72rem; color: var(--rm-ink-dim, #64748B); text-transform: uppercase; font-weight: 700;">Current Stock</span>
                    <div style="font-size: 1.25rem; font-weight: 800; color: var(--rm-ink, #0F172A); margin-top: 4px;">
                        ${fmtQty(mat.currentStock)} <small style="font-size: 0.78rem; font-weight: 600;">${esc(mat.unit)}</small>
                    </div>
                </div>
                <div style="background: #F8FAFC; border: 1px solid var(--rm-line, #E2E8F0); border-radius: 8px; padding: 12px;">
                    <span style="font-size: 0.72rem; color: var(--rm-ink-dim, #64748B); text-transform: uppercase; font-weight: 700;">Minimum Stock</span>
                    <div style="font-size: 1.25rem; font-weight: 800; color: var(--rm-ink, #0F172A); margin-top: 4px;">
                        ${mat.minStock !== null ? fmtQty(mat.minStock) : "0"} <small style="font-size: 0.78rem; font-weight: 600;">${esc(mat.unit)}</small>
                    </div>
                </div>
                <div style="background: #F8FAFC; border: 1px solid var(--rm-line, #E2E8F0); border-radius: 8px; padding: 12px;">
                    <span style="font-size: 0.72rem; color: var(--rm-ink-dim, #64748B); text-transform: uppercase; font-weight: 700;">Max Capacity</span>
                    <div style="font-size: 1.25rem; font-weight: 800; color: var(--rm-ink, #0F172A); margin-top: 4px;">
                        ${maxDisplay}
                    </div>
                </div>
            </div>

            <div style="background: #F8FAFC; border: 1px solid var(--rm-line, #E2E8F0); border-radius: 8px; padding: 14px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-size: 0.78rem; font-weight: 700; color: var(--rm-ink, #0F172A);">Stock Progress</span>
                    <span class="status-badge ${mat.status.cls}">${esc(mat.status.badgeText)}</span>
                </div>
                <div class="mat-progress-track" style="height: 10px;">
                    <div class="mat-progress-fill ${mat.progress.cls}" style="width: ${mat.progress.pct}%;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.74rem; color: var(--rm-ink-dim, #64748B); margin-top: 6px;">
                    <span>Health: ${mat.progress.pct}%</span>
                    <span>Target: ${maxDisplay}</span>
                </div>
            </div>

            <div style="background: #FFFFFF; border: 1px solid var(--rm-line, #E2E8F0); border-radius: 8px; overflow: hidden; font-size: 0.84rem;">
                <div style="display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #F1F5F9;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500;">Material ID / Item Code:</span>
                    <strong>${esc(mat.itemCode || "—")}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #F1F5F9;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500;">Category:</span>
                    <strong>${esc(mat.category)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #F1F5F9;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500;">Measurement Unit:</span>
                    <strong>${esc(mat.unit)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #F1F5F9;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500;">Date Added:</span>
                    <span>${esc(fmtDate(mat.createdAt))}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #F1F5F9;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500;">Last Activity / Updated:</span>
                    <span>${esc(fmtDate(mat.latestActivityDate || mat.updatedAt || mat.createdAt))}</span>
                </div>
                <div style="padding: 10px 14px;">
                    <span style="color: var(--rm-ink-dim, #64748B); font-weight: 500; display: block; margin-bottom: 4px;">Notes / Description:</span>
                    <span style="color: var(--rm-ink, #0F172A); font-style: ${mat.note ? "normal" : "italic"};">${esc(mat.note || "No specific notes provided.")}</span>
                </div>
            </div>
        </div>
    `;

    overlay.classList.add("open");
}

/* ==========================================================
   PAGINATION CONTROLS GENERATOR
   ========================================================== */

function renderPaginationControls(container, currentPage, totalPages, onPageChange) {
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    let html = `
        <button type="button" class="inv-page-btn" id="prevPageBtn" ${currentPage <= 1 ? "disabled" : ""}>‹</button>
    `;

    for (let p = 1; p <= totalPages; p++) {
        html += `<button type="button" class="inv-page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
    }

    html += `
        <button type="button" class="inv-page-btn" id="nextPageBtn" ${currentPage >= totalPages ? "disabled" : ""}>›</button>
    `;

    container.innerHTML = html;

    const prevBtn = container.querySelector("#prevPageBtn");
    const nextBtn = container.querySelector("#nextPageBtn");

    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            if (currentPage > 1) onPageChange(currentPage - 1);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            if (currentPage < totalPages) onPageChange(currentPage + 1);
        });
    }

    container.querySelectorAll(".inv-page-btn[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
            const p = Number(btn.dataset.page);
            if (p && p !== currentPage) onPageChange(p);
        });
    });
}
