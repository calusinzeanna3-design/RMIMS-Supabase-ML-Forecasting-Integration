// RMIMS V2 — User Inventory Overview
// View-only operational catalog with live Supabase V2 data binding.
// Zero mock data. Authoritative tables: raw_materials, stock_receipts, material_disbursements.

import { auth, supabase } from "../supabase/supabase-config.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

/* ==========================
   ROLE PROTECTION
========================== */

const profileBtn = document.getElementById("profileBtn");

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

        await loadInventory();
    } catch (err) {
        console.error("Auth verification failed:", err);
        window.location.href = "../user-signin.html";
    }
});

/* ==========================
   STATE
========================== */

const state = {
    materials: [], // { id, itemCode, materialName, category, unit, quantity, minStock, status, received, disbursed, lastActivityMs }
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

function toMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts === "string") return new Date(ts).getTime();
    if (ts instanceof Date) return ts.getTime();
    return 0;
}

function formatQty(qty, unit) {
    const n = Number(qty);
    const numVal = Number.isFinite(n) ? n : 0;
    return unit ? `${numVal.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${unit}` : numVal.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatDateTime(ms) {
    if (!ms) return "—";
    const date = new Date(ms);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
        " " + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function statusInfo(status) {
    if (status === "Available") return { cls: "available", label: "🟢 Good" };
    if (status === "Low") return { cls: "low", label: "🟠 Running Low" };
    if (status === "Critical") return { cls: "critical", label: "🔴 Needs Restocking" };
    return { cls: "available", label: "—" };
}

function emptyStateHtml(title, sub) {
    return `
        <div class="empty-state">
            <strong>${escapeHtml(title)}</strong>
            ${sub ? `<span>${escapeHtml(sub)}</span>` : ""}
        </div>
    `;
}

function errorStateHtml(message) {
    return `
        <div class="error-state">
            <strong>${escapeHtml(message)}</strong>
            <button type="button" class="retry-btn btn-secondary" id="inventoryRetryBtn">Retry</button>
        </div>
    `;
}

function syncActivityToggleUI() {
    const toggleBtn = document.getElementById("toggleActivityBtn");
    if (toggleBtn) {
        toggleBtn.setAttribute("aria-expanded", state.expanded ? "true" : "false");
    }
}

/* ==========================
   LOAD DATA
========================== */

async function loadInventory() {
    try {
        state.expanded = sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch (err) {
        state.expanded = false;
    }
    syncActivityToggleUI();

    state.materialsFailed = false;
    state.activityFailed = false;

    let materialsList = [];
    let receiptsList = [];
    let disbursementsList = [];

    try {
        const [mRes, rRes, dRes] = await Promise.all([
            supabase.from("raw_materials").select("id, item_code, name, description, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days, created_at, updated_at").order("name"),
            supabase.from("stock_receipts").select("id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at").order("created_at", { ascending: false }),
            supabase.from("material_disbursements").select("id, usage_date, material_id, consumed_quantity, unit, activity_type, finished_product_name, recorded_by, created_at").order("created_at", { ascending: false })
        ]);

        if (mRes.error) throw mRes.error;
        materialsList = mRes.data || [];

        if (rRes.error) console.warn("Stock receipts fetch notice:", rRes.error);
        receiptsList = rRes.data || [];

        if (dRes.error) console.warn("Disbursements fetch notice:", dRes.error);
        disbursementsList = dRes.data || [];
    } catch (err) {
        console.error("Failed to load inventory data:", err);
        state.materialsFailed = true;
    }

    // Aggregate Received (Total) / Disbursed (Total) / Last Activity per material
    const receivedByMaterial = {};
    const disbursedByMaterial = {};
    const lastActivityByMaterial = {};

    receiptsList.forEach((r) => {
        if (!r.material_id) return;
        receivedByMaterial[r.material_id] = (receivedByMaterial[r.material_id] || 0) + (Number(r.received_quantity) || 0);
        const ms = toMillis(r.receipt_date || r.created_at);
        if (ms > (lastActivityByMaterial[r.material_id] || 0)) {
            lastActivityByMaterial[r.material_id] = ms;
        }
    });

    disbursementsList.forEach((d) => {
        if (!d.material_id) return;
        disbursedByMaterial[d.material_id] = (disbursedByMaterial[d.material_id] || 0) + (Number(d.consumed_quantity) || 0);
        const ms = toMillis(d.usage_date || d.created_at);
        if (ms > (lastActivityByMaterial[d.material_id] || 0)) {
            lastActivityByMaterial[d.material_id] = ms;
        }
    });

    state.materials = materialsList.map((m) => {
        const fallbackMs = toMillis(m.updated_at) || toMillis(m.created_at) || 0;
        const lastActivityMs = lastActivityByMaterial[m.id] || fallbackMs;
        const currentStock = Number(m.current_stock) || 0;
        const minThreshold = m.minimum_threshold !== null && m.minimum_threshold !== undefined ? Number(m.minimum_threshold) : null;

        let status = "Available";
        if (currentStock <= 0) {
            status = "Critical";
        } else if (minThreshold !== null && currentStock < minThreshold) {
            status = "Low";
        }

        return {
            id: m.id,
            itemCode: m.item_code || "",
            materialName: m.name || "",
            description: m.description || "",
            category: m.description || "General",
            unit: m.unit_of_measure || "kg",
            quantity: currentStock,
            minStock: minThreshold,
            reorderQty: m.reorder_quantity,
            leadTimeDays: m.lead_time_days,
            status,
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

function renderSummaryCards() {
    const totalEl = document.getElementById("cardTotalCount");
    const availableEl = document.getElementById("cardAvailableCount") || document.getElementById("cardAvailableStock");
    const lowEl = document.getElementById("cardLowCount") || document.getElementById("cardLowStockCount");
    const outEl = document.getElementById("cardOutCount");

    const total = state.materials.length;
    const available = state.materials.filter((m) => m.status === "Available").length;
    const low = state.materials.filter((m) => m.status === "Low").length;
    const out = state.materials.filter((m) => m.status === "Critical").length;

    if (totalEl) totalEl.textContent = total.toLocaleString();
    if (availableEl) availableEl.textContent = available.toLocaleString();
    if (lowEl) lowEl.textContent = low.toLocaleString();
    if (outEl) outEl.textContent = out.toLocaleString();
}

/* ==========================
   FILTERS
========================== */

function populateFilterOptions() {
    const categoryFilter = document.getElementById("categoryFilter");
    if (!categoryFilter) return;

    const categories = [...new Set(state.materials.map((m) => m.category).filter(Boolean))].sort();

    const currentCategory = categoryFilter.value;

    categoryFilter.innerHTML = `<option value="">All Categories</option>` +
        categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

    categoryFilter.value = categories.includes(currentCategory) ? currentCategory : "";
}

function getFilteredSortedMaterials() {
    const term = state.search.trim().toLowerCase();

    let list = state.materials.filter((m) => {
        if (state.category && m.category !== state.category) return false;
        if (state.status) {
            if (state.status === "available" && m.status !== "Available") return false;
            if (state.status === "low" && m.status !== "Low") return false;
            if (state.status === "out" && m.status !== "Critical") return false;
        }
        if (state.unit && m.unit !== state.unit) return false;

        if (term) {
            const haystack = `${m.materialName} ${m.itemCode} ${m.id} ${m.category}`.toLowerCase();
            if (!haystack.includes(term)) return false;
        }

        return true;
    });

    const dir = state.sortDir === "asc" ? 1 : -1;

    list = list.slice().sort((a, b) => {
        let av = a[state.sortField];
        let bv = b[state.sortField];

        if (typeof av === "string") av = av.toLowerCase();
        if (typeof bv === "string") bv = bv.toLowerCase();

        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
    });

    return list;
}

/* ==========================
   TABLE RENDERING
========================== */

function renderTable() {
    const tbody = document.getElementById("inventoryTableBody");
    const resultCount = document.getElementById("resultCount");
    const tableFooter = document.getElementById("tableFooter");
    const table = document.getElementById("inventoryTable");

    if (table) table.classList.toggle("expanded", state.expanded);

    if (state.materialsFailed) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="8">${errorStateHtml("Unable to load inventory information.")}</td></tr>`;
        if (resultCount) resultCount.textContent = "";
        if (tableFooter) tableFooter.hidden = true;
        wireRetryButton();
        return;
    }

    if (state.materials.length === 0) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="8">${emptyStateHtml("No raw materials recorded yet.", "Inventory records will appear once added by an administrator.")}</td></tr>`;
        if (resultCount) resultCount.textContent = "0 materials";
        if (tableFooter) tableFooter.hidden = true;
        return;
    }

    const filtered = getFilteredSortedMaterials();

    if (resultCount) resultCount.textContent = `${filtered.length} of ${state.materials.length} materials`;

    if (filtered.length === 0) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="8">${emptyStateHtml("No materials match your search.", "Try adjusting your search or filters.")}</td></tr>`;
        if (tableFooter) tableFooter.hidden = true;
        return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.rowsPerPage));
    if (state.page > totalPages) state.page = totalPages;

    const startIdx = (state.page - 1) * state.rowsPerPage;
    const pageItems = filtered.slice(startIdx, startIdx + state.rowsPerPage);

    if (tbody) {
        tbody.innerHTML = pageItems.map((m) => {
            const st = statusInfo(m.status);
            return `
                <tr>
                    <td data-label="Material">
                        <strong>${escapeHtml(m.materialName)}</strong>
                        ${m.itemCode ? `<br><small class="text-muted" style="color:var(--text-muted, #64748b);">${escapeHtml(m.itemCode)}</small>` : ""}
                    </td>
                    <td data-label="Category">${escapeHtml(m.category || "—")}</td>
                    <td data-label="Current Stock"><strong>${escapeHtml(formatQty(m.quantity, m.unit))}</strong></td>
                    <td data-label="Unit">${escapeHtml(m.unit || "—")}</td>
                    <td data-label="Minimum Stock">${m.minStock !== null && m.minStock !== undefined ? escapeHtml(formatQty(m.minStock, m.unit)) : "—"}</td>
                    <td data-label="Supplier">${escapeHtml(m.description || "Standard Catalog")}</td>
                    <td data-label="Status"><span class="status ${st.cls}">${st.label}</span></td>
                    <td data-label="Details">
                        <button type="button" class="btn-outline-sm view-detail-btn" data-id="${escapeHtml(m.id)}">View Details</button>
                    </td>
                </tr>
            `;
        }).join("");

        tbody.querySelectorAll(".view-detail-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const mat = state.materials.find(x => x.id === btn.dataset.id);
                if (mat) openDetailModal(mat);
            });
        });
    }

    if (tableFooter) tableFooter.hidden = false;
    renderPagination(filtered.length, totalPages, startIdx, pageItems.length);
}

function renderPagination(totalItems, totalPages, startIdx, pageItemCount) {
    const pageInfo = document.getElementById("pageInfo");
    const pageNumbers = document.getElementById("pageNumbers");
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");

    if (!pageInfo || !pageNumbers || !prevBtn || !nextBtn) return;

    const from = totalItems === 0 ? 0 : startIdx + 1;
    const to = startIdx + pageItemCount;

    pageInfo.textContent = `Showing ${from}–${to} of ${totalItems} materials`;

    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= totalPages;

    const pages = paginationWindow(state.page, totalPages);

    pageNumbers.innerHTML = pages.map((p) => {
        if (p === "…") {
            return `<span class="page-num ellipsis">…</span>`;
        }
        return `<button type="button" class="page-num ${p === state.page ? "active" : ""}" data-page="${p}">${p}</button>`;
    }).join("");

    pageNumbers.querySelectorAll("[data-page]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.page = Number(btn.dataset.page);
            renderTable();
        });
    });
}

function paginationWindow(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set([1, total, current, current - 1, current + 1]);
    const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
    const res = [];
    for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
            res.push("…");
        }
        res.push(sorted[i]);
    }
    return res;
}

function wireRetryButton() {
    document.getElementById("inventoryRetryBtn")?.addEventListener("click", () => {
        loadInventory();
    });
}

/* ==========================
   VIEW DETAIL MODAL
========================== */

function openDetailModal(mat) {
    const nameEl = document.getElementById("detailMaterialName");
    const catEl = document.getElementById("detailCategory");
    const bodyEl = document.getElementById("detailModalBody");
    const overlay = document.getElementById("detailModalOverlay");

    if (!overlay) return;

    if (nameEl) nameEl.textContent = mat.materialName;
    if (catEl) catEl.textContent = `${mat.category || "Uncategorized"} · Operational Detail`;

    if (bodyEl) {
        bodyEl.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-size:0.9rem;">
                <div><strong>Item Code:</strong> ${escapeHtml(mat.itemCode || "—")}</div>
                <div><strong>Current Stock:</strong> ${escapeHtml(formatQty(mat.quantity, mat.unit))}</div>
                <div><strong>Minimum Target:</strong> ${mat.minStock !== null && mat.minStock !== undefined ? escapeHtml(formatQty(mat.minStock, mat.unit)) : "—"}</div>
                <div><strong>Reorder Quantity:</strong> ${mat.reorderQty !== null && mat.reorderQty !== undefined ? escapeHtml(formatQty(mat.reorderQty, mat.unit)) : "—"}</div>
                <div><strong>Lead Time:</strong> ${mat.leadTimeDays !== null && mat.leadTimeDays !== undefined ? `${escapeHtml(mat.leadTimeDays)} days` : "—"}</div>
                <div><strong>Status:</strong> <span class="status ${statusInfo(mat.status).cls}">${statusInfo(mat.status).label}</span></div>
                <div><strong>Total Inflow (Recorded):</strong> +${escapeHtml(formatQty(mat.received, mat.unit))}</div>
                <div><strong>Total Outflow (Recorded):</strong> −${escapeHtml(formatQty(mat.disbursed, mat.unit))}</div>
                <div><strong>Last Stock Activity:</strong> ${escapeHtml(formatDateTime(mat.lastActivityMs))}</div>
            </div>
        `;
    }

    overlay.classList.add("active");
}

document.getElementById("detailModalClose")?.addEventListener("click", () => {
    document.getElementById("detailModalOverlay")?.classList.remove("active");
});
document.getElementById("detailModalCancel")?.addEventListener("click", () => {
    document.getElementById("detailModalOverlay")?.classList.remove("active");
});
document.getElementById("detailModalOverlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("detailModalOverlay")) {
        document.getElementById("detailModalOverlay")?.classList.remove("active");
    }
});

/* ==========================
   EVENT LISTENERS & BINDINGS
========================== */

document.getElementById("searchInput")?.addEventListener("input", function () {
    state.search = this.value;
    state.page = 1;
    syncFilterClearButton();
    renderTable();
});

document.getElementById("categoryFilter")?.addEventListener("change", function () {
    state.category = this.value;
    state.page = 1;
    syncFilterClearButton();
    renderTable();
});

document.getElementById("statusFilter")?.addEventListener("change", function () {
    state.status = this.value;
    state.page = 1;
    syncFilterClearButton();
    renderTable();
});

document.getElementById("filterClearBtn")?.addEventListener("click", () => {
    state.search = "";
    state.category = "";
    state.status = "";
    state.unit = "";
    const sIn = document.getElementById("searchInput"); if (sIn) sIn.value = "";
    const cFi = document.getElementById("categoryFilter"); if (cFi) cFi.value = "";
    const stFi = document.getElementById("statusFilter"); if (stFi) stFi.value = "";
    syncFilterClearButton();
    state.page = 1;
    renderTable();
});

function syncFilterClearButton() {
    const btn = document.getElementById("filterClearBtn");
    if (!btn) return;
    const active = !!(state.search || state.category || state.status || state.unit);
    btn.hidden = !active;
}

document.getElementById("overviewCards")?.addEventListener("click", (e) => {
    const card = e.target.closest("[data-filter]");
    if (!card) return;
    const filter = card.dataset.filter;
    state.status = filter === "all" ? "" : filter;
    const statusFilter = document.getElementById("statusFilter");
    if (statusFilter) statusFilter.value = state.status;
    syncFilterClearButton();
    state.page = 1;
    renderTable();
});

document.getElementById("refreshBtn")?.addEventListener("click", () => {
    loadInventory();
});

window.addEventListener("rmims:inventory-changed", loadInventory);
