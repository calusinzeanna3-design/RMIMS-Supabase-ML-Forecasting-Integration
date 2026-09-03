// js/backup-restore.js
//
// Admin Settings — Backup & Data Management.
//
// ARCHITECTURE: RMIMS has no backend server. Backup files are
// assembled client-side (this file) as a .zip of per-table JSON,
// then uploaded to the private "rmims-backups" Storage bucket so
// they stay downloadable later from Backup History. Restore does
// NOT delete/insert rows from the browser table-by-table — that
// cannot be made atomic. Instead the parsed backup payload is
// sent to the restore_backup() Postgres RPC (see
// supabase/backup-schema.sql), which performs the whole replace
// as a single transaction: any failure rolls back everything.
//
// SECURITY NOTE: the "who can restore" check here is UI-level
// convenience only. restore_backup() re-checks is_active_admin()
// itself before touching any table.

import { auth, db } from "../supabase/supabase-config.js";
import JSZip from "https://esm.sh/jszip@3.10.1";

const BUCKET = "rmims-backups";
const BACKUP_VERSION = 1;

const CATEGORIES = [
    { key: "raw_materials", label: "Raw Materials", table: "raw_materials" },
    { key: "stock_receipts", label: "Material Activity — Receive", table: "stock_receipts" },
    { key: "material_disbursements", label: "Material Activity — Used / Consumption Records", table: "material_disbursements" }
];

let currentUser = null; // set by initBackupRestore()
let backupInProgress = false;
let restoreInProgress = false;
let pendingRestoreFile = null;   // File selected in step 1
let verifiedRestorePayload = null; // parsed + verified payload, ready for restore

/* ==========================================================
   SMALL HELPERS
   ========================================================== */

function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function fmtBytes(bytes) {
    if (!bytes && bytes !== 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}

function slugTimestamp(d = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function showToast(message, type = "success") {
    const stack = document.getElementById("toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span></span>`;
    el.querySelector("span:last-child").textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
        el.classList.add("leaving");
        setTimeout(() => el.remove(), 250);
    }, 3800);
}

function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

/* ==========================================================
   DATA SUMMARY
   ========================================================== */

async function countRows(table) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    if (error) throw error;
    return count || 0;
}

export async function loadDataSummary() {
    const tiles = {
        materials: document.getElementById("summaryMaterials"),
        finished_products: document.getElementById("summaryFinishedProducts"),
        suppliers: document.getElementById("summarySuppliers"),
        stock_receipts: document.getElementById("summaryStockReceipts"),
        usage_records: document.getElementById("summaryUsageRecords"),
        users: document.getElementById("summaryUsers")
    };

    Object.values(tiles).forEach(el => { if (el) el.textContent = "…"; });

    try {
        const [materials, stockReceipts, usageRecords, users, supplierRows] = await Promise.all([
            countRows("raw_materials").catch(() => 0),
            countRows("stock_receipts").catch(() => 0),
            countRows("material_disbursements").catch(() => 0),
            countRows("user_profiles").catch(() => 0),
            db.from("stock_receipts").select("supplier_name").not("supplier_name", "is", null).catch(() => ({ data: [] }))
        ]);

        const distinctSuppliers = new Set(
            (supplierRows.data || [])
                .map(r => (r.supplier_name || "").trim().toLowerCase())
                .filter(Boolean)
        );

        if (tiles.materials) tiles.materials.textContent = materials;
        if (tiles.finished_products) tiles.finished_products.textContent = "—";
        if (tiles.suppliers) tiles.suppliers.textContent = distinctSuppliers.size || "—";
        if (tiles.stock_receipts) tiles.stock_receipts.textContent = stockReceipts;
        if (tiles.usage_records) tiles.usage_records.textContent = usageRecords;
        if (tiles.users) tiles.users.textContent = users;

    } catch (err) {
        console.error(err);
        Object.values(tiles).forEach(el => { if (el) el.textContent = "—"; });
        showToast("Unable to load the data summary. Please try again.", "error");
    }
}

/* ==========================================================
   CREATE BACKUP
   ========================================================== */

function selectedCategories() {
    return CATEGORIES.filter(c => document.getElementById(`cat_${c.key}`)?.checked);
}

async function gatherBackupData(categories) {
    const payload = {};
    const recordCounts = {};

    for (const cat of categories) {
        const { data, error } = await db.from(cat.table).select("*");
        if (error) throw new Error(`Unable to read ${cat.table}: ${error.message}`);
        payload[cat.key] = data || [];
        recordCounts[cat.key] = (data || []).length;
    }

    return { payload, recordCounts };
}

async function createBackup(isComplete) {
    if (backupInProgress) return;

    const categories = isComplete ? CATEGORIES : selectedCategories();
    if (categories.length === 0) {
        showToast("Select at least one category to back up.", "error");
        return;
    }

    backupInProgress = true;
    const createBtn = document.getElementById("createBackupBtn");
    const completeBtn = document.getElementById("createCompleteBackupBtn");
    const originalCreateText = createBtn.textContent;
    const originalCompleteText = completeBtn.textContent;
    createBtn.disabled = true;
    completeBtn.disabled = true;
    createBtn.textContent = "Creating Backup…";
    completeBtn.textContent = "Creating Backup…";

    const backupName = `RMIMS_Backup_${slugTimestamp()}`;

    try {
        const { payload, recordCounts } = await gatherBackupData(categories);

        const manifest = {
            rmims_backup: true,
            version: BACKUP_VERSION,
            created_at: new Date().toISOString(),
            created_by: currentUser?.email || "unknown",
            categories: categories.map(c => c.key),
            record_counts: recordCounts
        };

        const zip = new JSZip();
        zip.file("manifest.json", JSON.stringify(manifest, null, 2));
        for (const cat of categories) {
            zip.file(`${cat.table}.json`, JSON.stringify(payload[cat.key], null, 2));
        }

        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        const storagePath = `${currentUser.uid}/${backupName}.zip`;

        const { error: uploadError } = await db.storage
            .from(BUCKET)
            .upload(storagePath, blob, { contentType: "application/zip", upsert: false });

        if (uploadError) throw uploadError;

        const { error: historyError } = await db.from("backup_history").insert({
            backup_name: backupName,
            storage_path: storagePath,
            created_by: currentUser.uid,
            created_by_name: currentUser.fullName,
            file_size_bytes: blob.size,
            status: "complete",
            categories: categories.map(c => c.key),
            record_counts: recordCounts
        });

        if (historyError) throw historyError;

        // Also push the file straight to the Admin's device — Backup
        // History covers "download it again later"; this covers the
        // "I just made one, give it to me now" expectation.
        triggerBrowserDownload(blob, `${backupName}.zip`);

        showToast("Backup created successfully.");
        await loadBackupHistory();

        return { backupName, storagePath };

    } catch (err) {
        console.error(err);

        // Record the failure truthfully — never a fake success entry,
        // and never a fake "complete" backup either.
        try {
            await db.from("backup_history").insert({
                backup_name: backupName,
                storage_path: "",
                created_by: currentUser?.uid,
                created_by_name: currentUser?.fullName || "Unknown",
                status: "failed",
                categories: categories.map(c => c.key),
                record_counts: {}
            });
        } catch (logErr) {
            console.error("Unable to record failed backup:", logErr);
        }

        showToast("Backup could not be completed. Please try again.", "error");
        await loadBackupHistory();

    } finally {
        backupInProgress = false;
        createBtn.disabled = false;
        completeBtn.disabled = false;
        createBtn.textContent = originalCreateText;
        completeBtn.textContent = originalCompleteText;
    }
}

function triggerBrowserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ==========================================================
   BACKUP HISTORY
   ========================================================== */

async function loadBackupHistory() {
    const tbody = document.getElementById("backupHistoryBody");
    if (!tbody) return;

    try {
        const { data, error } = await db
            .from("backup_history")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(20);

        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No backups yet. Create one above.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(row => `
            <tr>
                <td>${escapeHtml(row.backup_name)}</td>
                <td>${fmtDateTime(row.created_at)}</td>
                <td>${row.status === "complete" ? fmtBytes(row.file_size_bytes) : "—"}</td>
                <td><span class="status ${row.status === "complete" ? "active" : "rejected"}">${row.status === "complete" ? "✓ Complete" : "Failed"}</span></td>
                <td class="actions-cell">
                    ${row.status === "complete"
                        ? `<button type="button" class="btn-outline-sm" data-download-backup="${row.id}">Download</button>`
                        : `—`}
                </td>
            </tr>
        `).join("");

        tbody.querySelectorAll("[data-download-backup]").forEach(btn => {
            btn.addEventListener("click", () => downloadBackup(btn.dataset.downloadBackup, data));
        });

    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Unable to load backup history.</td></tr>`;
    }
}

async function downloadBackup(id, rows) {
    const row = rows.find(r => r.id === id);
    if (!row) return;

    try {
        const { data, error } = await db.storage.from(BUCKET).download(row.storage_path);
        if (error) throw error;
        triggerBrowserDownload(data, `${row.backup_name}.zip`);
    } catch (err) {
        console.error(err);
        showToast("Backup download failed. Please try again.", "error");
    }
}

/* ==========================================================
   RESTORE — STEP 1: SELECT FILE
   ========================================================== */

function resetRestoreFlow() {
    pendingRestoreFile = null;
    verifiedRestorePayload = null;
    document.getElementById("restoreFileInput").value = "";
    document.getElementById("restoreSelectedFile").textContent = "No file selected.";
    document.getElementById("restoreVerifyBtn").disabled = true;
    document.getElementById("restoreVerifyResult").innerHTML = "";
    document.getElementById("restoreContinueBtn").style.display = "none";
}

document.getElementById("restoreFileInput")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    pendingRestoreFile = file || null;
    verifiedRestorePayload = null;
    document.getElementById("restoreVerifyResult").innerHTML = "";
    document.getElementById("restoreContinueBtn").style.display = "none";
    document.getElementById("restoreSelectedFile").textContent = file ? file.name : "No file selected.";
    document.getElementById("restoreVerifyBtn").disabled = !file;
});

/* ==========================================================
   RESTORE — STEP 2: VERIFY BACKUP
   ========================================================== */

async function verifyRestoreFile() {
    if (!pendingRestoreFile) return;

    const resultEl = document.getElementById("restoreVerifyResult");
    const verifyBtn = document.getElementById("restoreVerifyBtn");
    const continueBtn = document.getElementById("restoreContinueBtn");
    const original = verifyBtn.textContent;
    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verifying…";
    resultEl.innerHTML = "";
    continueBtn.style.display = "none";

    try {
        let zip;
        try {
            zip = await JSZip.loadAsync(pendingRestoreFile);
        } catch {
            throw { code: "invalid" };
        }

        const manifestFile = zip.file("manifest.json");
        if (!manifestFile) throw { code: "invalid" };

        let manifest;
        try {
            manifest = JSON.parse(await manifestFile.async("string"));
        } catch {
            throw { code: "corrupted" };
        }

        if (!manifest || manifest.rmims_backup !== true) throw { code: "invalid" };
        if (typeof manifest.version !== "number") throw { code: "corrupted" };
        if (manifest.version > BACKUP_VERSION) throw { code: "incompatible" };
        if (!Array.isArray(manifest.categories) || manifest.categories.length === 0) throw { code: "corrupted" };

        const payload = {};
        for (const key of manifest.categories) {
            const cat = CATEGORIES.find(c => c.key === key);
            if (!cat) continue; // ignore unknown categories rather than fail the whole restore
            const file = zip.file(`${cat.table}.json`);
            if (!file) throw { code: "corrupted" };
            try {
                payload[key] = JSON.parse(await file.async("string"));
            } catch {
                throw { code: "corrupted" };
            }
            if (!Array.isArray(payload[key])) throw { code: "corrupted" };
        }

        verifiedRestorePayload = { manifest, payload };

        const rows = manifest.categories.map(key => {
            const cat = CATEGORIES.find(c => c.key === key);
            const label = cat ? cat.label : key;
            const count = manifest.record_counts?.[key] ?? payload[key]?.length ?? 0;
            return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${count}</strong></div>`;
        }).join("");

        resultEl.innerHTML = `
            <div class="inline-notice inline-notice-verified">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/></svg>
                <div>
                    <strong>✓ Backup Verified</strong>
                    <div class="confirm-note" style="margin-top:8px;">
                        Backup Date: ${fmtDateTime(manifest.created_at)}<br>
                        Backup Version: ${manifest.version}
                    </div>
                    <div class="detail-grid" style="margin-top:10px;">${rows}</div>
                </div>
            </div>
        `;
        continueBtn.style.display = "inline-block";

    } catch (err) {
        const messages = {
            invalid: "This is not a valid RMIMS backup file.",
            corrupted: "This backup file is corrupted or incomplete.",
            incompatible: "This backup was created for an incompatible RMIMS version."
        };
        const code = err && err.code ? err.code : null;
        console.error(err);
        resultEl.innerHTML = `<div class="inline-notice">${messages[code] || "This backup file is corrupted or incomplete."}</div>`;

    } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = original;
    }
}

document.getElementById("restoreVerifyBtn")?.addEventListener("click", verifyRestoreFile);

/* ==========================================================
   RESTORE — STEP 3: FINAL WARNING + SAFETY BACKUP + RESTORE
   ========================================================== */

document.getElementById("restoreContinueBtn")?.addEventListener("click", () => {
    if (!verifiedRestorePayload) return;
    document.getElementById("restoreConfirmText").value = "";
    document.getElementById("safetyBackupStatus").textContent = "";
    openModal("restoreFinalModal");
});

document.getElementById("createSafetyBackupBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("createSafetyBackupBtn");
    const statusEl = document.getElementById("safetyBackupStatus");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Creating Safety Backup…";
    statusEl.textContent = "";

    const result = await createBackup(true);

    btn.disabled = false;
    btn.textContent = original;
    statusEl.textContent = result ? `Safety backup "${result.backupName}" created.` : "Safety backup could not be completed.";
});

document.getElementById("restoreSystemBtn")?.addEventListener("click", async () => {
    if (!verifiedRestorePayload) return;
    if (restoreInProgress) return;

    const confirmInput = document.getElementById("restoreConfirmText");
    if (confirmInput.value.trim() !== "RESTORE") {
        showToast('Type "RESTORE" to confirm.', "error");
        return;
    }

    restoreInProgress = true;
    const btn = document.getElementById("restoreSystemBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Restoring…";

    try {
        const { error } = await db.rpc("restore_backup", { payload: verifiedRestorePayload.payload });
        if (error) throw error;

        showToast("System restored successfully.");
        closeModal("restoreFinalModal");
        closeModal("restoreModal");
        resetRestoreFlow();
        await loadDataSummary();

    } catch (err) {
        console.error(err);
        showToast("Restore could not be completed. Current system data has not been confirmed as restored.", "error");

    } finally {
        restoreInProgress = false;
        btn.disabled = false;
        btn.textContent = original;
    }
});

/* ==========================================================
   MODAL WIRING (categories checklist + open/close)
   ========================================================== */

function renderCategoryCheckboxes() {
    const container = document.getElementById("backupCategoryList");
    if (!container) return;
    container.innerHTML = CATEGORIES.map(c => `
        <label class="category-check">
            <input type="checkbox" id="cat_${c.key}" checked>
            <span>${escapeHtml(c.label)}</span>
        </label>
    `).join("");
}

document.getElementById("createBackupBtn")?.addEventListener("click", () => createBackup(false));
document.getElementById("createCompleteBackupBtn")?.addEventListener("click", () => createBackup(true));

document.getElementById("openRestoreBtn")?.addEventListener("click", () => {
    resetRestoreFlow();
    openModal("restoreModal");
});

document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
});
document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal(overlay.id);
    });
});

/* ==========================================================
   INIT
   ========================================================== */

export function initBackupRestore(user) {
    currentUser = user; // { uid, fullName, email }
    renderCategoryCheckboxes();
    loadDataSummary();
    loadBackupHistory();
}
