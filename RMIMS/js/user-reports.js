import { auth, db } from "../supabase/supabase-config.js";
import { collection, getDocs, doc, getDoc } from "../supabase/db-compat.js";
import { onAuthStateChanged } from "../supabase/auth-compat.js";

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function formatNumber(value) {
    const n = safeNumber(value);
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
}

function setStatus(message = "", type = "info") {
    const el = $("reportStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `report-status ${type}`;
    el.hidden = !message;
}

function setLoading(isLoading) {
    const btn = $("printBtn");
    if (btn) btn.disabled = isLoading;
}

function showEmpty(tbody, colspan, message) {
    tbody.innerHTML = `
        <tr class="empty-row">
            <td colspan="${colspan}">${escapeHtml(message)}</td>
        </tr>`;
}

function normalizeStatus(data) {
    const quantity = safeNumber(data.quantity);
    if (quantity <= 0) return "Out of Stock";
    const raw = String(data.status || "").trim().toLowerCase();
    if (raw === "critical") return "Critical";
    if (raw === "low") return "Low";
    if (raw === "available") return "Available";
    return "Available";
}

function statusClass(status) {
    if (status === "Critical" || status === "Out of Stock") return "critical";
    if (status === "Low") return "low";
    return "available";
}

function stockGap(data) {
    const current = safeNumber(data.quantity);
    const minimum = safeNumber(data.minimumThreshold);
    return Math.max(minimum - current, 0);
}

async function verifyUser() {
    return new Promise((resolve) => {
        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                window.location.href = "../login.html";
                resolve(false);
                return;
            }

            try {
                const snap = await getDoc(doc(db, "users", user.uid));
                if (!snap.exists()) {
                    window.location.href = "../login.html";
                    resolve(false);
                    return;
                }

                const data = snap.data() || {};
                if (data.role !== "user") {
                    window.location.href = "../admin/dashboard.html";
                    resolve(false);
                    return;
                }

                const profile = $("profileBtn");
                if (profile) profile.querySelector(".profile-text")?.replaceChildren(
                    document.createTextNode(data.fullName || "User")
                );

                resolve(true);
            } catch (error) {
                console.error("User verification failed:", error);
                setStatus("Your account could not be verified. Please refresh and try again.", "error");
                resolve(false);
            }
        });
    });
}

async function loadReports() {
    setLoading(true);
    setStatus("Loading report data…", "info");

    try {
        const [materialsResult, usageResult] = await Promise.allSettled([
            getDocs(collection(db, "materials")),
            getDocs(collection(db, "usageRecords"))
        ]);

        if (materialsResult.status === "rejected") {
            throw materialsResult.reason;
        }

        const materials = [];
        materialsResult.value.forEach((item) => {
            materials.push({ id: item.id, ...item.data() });
        });

        const usageRecords = [];
        if (usageResult.status === "fulfilled") {
            usageResult.value.forEach((item) => {
                usageRecords.push({ id: item.id, ...item.data() });
            });
        }

        renderInventoryReport(materials);
        renderLowStockReport(materials);
        renderUsageSummary(usageRecords);
        generateRecommendations(materials, usageRecords);

        const usageWarning = usageResult.status === "rejected";
        if (usageWarning) {
            setStatus("Inventory report loaded, but consumption records could not be loaded. The usage section may be incomplete.", "warning");
        } else if (materials.length === 0 && usageRecords.length === 0) {
            setStatus("No inventory or consumption records are available yet.", "info");
        } else {
            setStatus(`Report updated successfully • ${new Date().toLocaleString()}`, "success");
        }
    } catch (error) {
        console.error("Reports load error:", error);
        setStatus("Unable to load the report right now. Your data was not changed. Please try again.", "error");

        showEmpty($("inventoryReportBody"), 4, "Unable to load inventory data.");
        showEmpty($("lowStockReportBody"), 4, "Unable to load low-stock data.");
        showEmpty($("usageReportBody"), 5, "Unable to load consumption data.");
        const recs = $("decisionSupportList");
        if (recs) recs.innerHTML = "<li>Report information is temporarily unavailable.</li>";
    } finally {
        setLoading(false);
    }
}

function renderInventoryReport(materials) {
    const body = $("inventoryReportBody");
    if (!body) return;

    if (!materials.length) {
        showEmpty(body, 4, "No raw materials have been recorded yet.");
    } else {
        body.innerHTML = materials.map((data) => {
            const name = data.materialName || data.material_name || "Unnamed material";
            const quantity = safeNumber(data.quantity);
            const unit = data.unit || "—";
            const status = normalizeStatus(data);
            const category = data.category || "Uncategorized";

            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(name)}</strong>
                        <small class="report-subtext">${escapeHtml(category)}</small>
                    </td>
                    <td>${formatNumber(quantity)}</td>
                    <td>${escapeHtml(unit)}</td>
                    <td><span class="status ${statusClass(status)}">${escapeHtml(status)}</span></td>
                </tr>`;
        }).join("");
    }

    const total = materials.length;
    const low = materials.filter(m => ["Low", "Critical"].includes(normalizeStatus(m)) || normalizeStatus(m) === "Out of Stock").length;

    if ($("totalMaterials")) $("totalMaterials").textContent = formatNumber(total);
    if ($("lowStockItems")) $("lowStockItems").textContent = formatNumber(low);
}

function renderLowStockReport(materials) {
    const body = $("lowStockReportBody");
    if (!body) return;

    const lowMaterials = materials.filter((m) => {
        const status = normalizeStatus(m);
        return status === "Low" || status === "Critical" || status === "Out of Stock";
    });

    if (!lowMaterials.length) {
        showEmpty(body, 4, "No low-stock or critical materials were found.");
        return;
    }

    body.innerHTML = lowMaterials.map((data) => {
        const name = data.materialName || data.material_name || "Unnamed material";
        const quantity = safeNumber(data.quantity);
        const minimum = safeNumber(data.minimumThreshold);
        const unit = data.unit || "—";
        const gap = stockGap(data);
        const status = normalizeStatus(data);

        return `
            <tr>
                <td><strong>${escapeHtml(name)}</strong></td>
                <td>${formatNumber(quantity)} ${escapeHtml(unit)}</td>
                <td>${formatNumber(minimum)} ${escapeHtml(unit)}</td>
                <td>${formatNumber(gap)} ${escapeHtml(unit)}</td>
            </tr>`;
    }).join("");
}

function renderUsageSummary(records) {
    const body = $("usageReportBody");
    if (!body) return;

    if (!records.length) {
        showEmpty(body, 5, "No consumption records have been recorded yet.");
        if ($("totalUsageRecords")) $("totalUsageRecords").textContent = "0";
        return;
    }

    // Do not add quantities across different units.
    const grouped = new Map();
    records.forEach((r) => {
        const name = r.materialName || r.material_name || "Unknown material";
        const unit = r.unit || "unit not specified";
        const qty = safeNumber(r.usedQuantity ?? r.used_quantity);
        const key = `${name}|||${unit}`;
        if (!grouped.has(key)) grouped.set(key, { name, unit, quantity: 0, count: 0 });
        if (qty > 0) {
            grouped.get(key).quantity += qty;
            grouped.get(key).count += 1;
        }
    });

    const rows = [...grouped.values()].filter(x => x.quantity > 0).sort((a, b) => b.quantity - a.quantity);

    if (!rows.length) {
        showEmpty(body, 5, "No valid positive consumption quantities were found.");
    } else {
        body.innerHTML = rows.slice(0, 20).map((row) => `
            <tr>
                <td><strong>${escapeHtml(row.name)}</strong></td>
                <td>${formatNumber(row.quantity)}</td>
                <td>${escapeHtml(row.unit)}</td>
                <td>${formatNumber(row.count)}</td>
                <td>${row.count === 1 ? "Single record" : "Recorded usage"}</td>
            </tr>
        `).join("");
    }

    if ($("totalUsageRecords")) $("totalUsageRecords").textContent = formatNumber(records.length);
}

function generateRecommendations(materials, usageRecords) {
    const list = $("decisionSupportList");
    if (!list) return;

    const recommendations = [];
    const critical = materials.filter(m => normalizeStatus(m) === "Critical" || normalizeStatus(m) === "Out of Stock");
    const low = materials.filter(m => normalizeStatus(m) === "Low");

    critical.slice(0, 5).forEach(m => {
        const name = m.materialName || m.material_name || "Unnamed material";
        recommendations.push(`<li><strong>${escapeHtml(name)}</strong> needs attention because its current stock is critical or out of stock.</li>`);
    });

    low.slice(0, 5).forEach(m => {
        const name = m.materialName || m.material_name || "Unnamed material";
        recommendations.push(`<li><strong>${escapeHtml(name)}</strong> is below its minimum stock threshold.</li>`);
    });

    if (!usageRecords.length) {
        recommendations.push("<li>No consumption history is available yet. Record material usage to build useful consumption reports.</li>");
    }

    if (!recommendations.length) {
        recommendations.push("<li>Current inventory levels do not show any low or critical stock conditions.</li>");
    }

    list.innerHTML = recommendations.join("");
}

document.addEventListener("DOMContentLoaded", async () => {
    const verified = await verifyUser();
    if (!verified) return;

    const printBtn = $("printBtn");
    if (printBtn) {
        printBtn.addEventListener("click", () => {
            if (printBtn.disabled) return;
            window.print();
        });
    }

    const retryBtn = $("retryReportBtn");
    if (retryBtn) retryBtn.addEventListener("click", loadReports);

    const menuToggle = document.querySelector(".menu-toggle");
    const sidebar = document.querySelector(".sidebar");
    if (menuToggle && sidebar) {
        menuToggle.addEventListener("click", () => sidebar.classList.toggle("open"));
    }

    await loadReports();
});
