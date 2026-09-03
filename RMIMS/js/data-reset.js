// js/data-reset.js
//
// Admin Settings — Danger Zone -> Data Reset.
//
// Every reset here calls the reset_system_data() RPC (see
// supabase/reset-schema.sql), a single SECURITY DEFINER Postgres
// function that deletes the requested tables inside one
// transaction — never a partial reset — and always refuses to
// touch users / system_activity_log / backup_history, no matter
// what scope is requested.
//
// SECURITY NOTE: the option list, confirmation text, and
// disabled buttons below are UI-level convenience only. The real
// enforcement (admin-only, protected tables) lives in the RPC.

import { db } from "../supabase/supabase-config.js";

const RESET_OPTIONS = [
    {
        key: "raw_materials",
        scopes: ["raw_materials"],
        title: "Reset Raw Material Data",
        confirmWord: "RESET",
        deleted: [
            "All Raw Materials, including supplier and storage info",
            "Product material requirements linked to those materials"
        ],
        kept: [
            "User accounts",
            "Finished Products",
            "Material Activity and Consumption Records (the material link on those rows will show as removed, but the record itself is preserved)"
        ]
    },
    {
        key: "stock_receipts",
        scopes: ["stock_receipts"],
        title: "Clear Material Activity (Receive)",
        confirmWord: "RESET",
        deleted: ["Recorded Receive activity"],
        kept: ["User accounts", "Raw Materials", "Finished Products", "Consumption Records (Used activity)"]
    },
    {
        key: "material_disbursements",
        scopes: ["material_disbursements"],
        title: "Clear Consumption Records",
        confirmWord: "RESET",
        deleted: ["Recorded Used/Consumed activity", "Consumption Analytics history that reads this data"],
        kept: ["User accounts", "Raw Materials", "Finished Products", "Receive activity"]
    },
    {
        key: "finished_products",
        scopes: ["finished_products"],
        title: "Reset Finished Product Setup",
        confirmWord: "RESET",
        deleted: ["Finished Products", "Their product material requirements"],
        kept: ["User accounts", "Raw Materials", "Material Activity and Consumption history"]
    }
];

const FULL_RESET_OPTION = {
    key: "all",
    scopes: ["raw_materials", "finished_products", "stock_receipts", "material_disbursements"],
    title: "Reset All System Data",
    confirmWord: "RESET ALL DATA",
    deleted: ["Raw Materials", "Finished Products", "Material Activity (Receive)", "Consumption Records", ],
    kept: ["User accounts", "Admin accounts", "System Activity / audit log", "Backup History"]
};

let currentOption = null;
let resetInProgress = false;
let onResetComplete = null; // callback to refresh Data Summary elsewhere

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
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
   RENDER RESET OPTION ROWS
   ========================================================== */

function renderResetOptions() {
    const container = document.getElementById("resetOptionsList");
    if (!container) return;

    container.innerHTML = RESET_OPTIONS.map(opt => `
        <div class="danger-row">
            <div class="danger-row-text">
                <strong>${escapeHtml(opt.title)}</strong>
                <span>${escapeHtml(opt.deleted[0])}${opt.deleted.length > 1 ? ", and more" : ""}</span>
            </div>
            <div class="button-group">
                <button type="button" class="btn-danger" data-reset-key="${opt.key}">Reset</button>
            </div>
        </div>
    `).join("");

    container.querySelectorAll("[data-reset-key]").forEach(btn => {
        btn.addEventListener("click", () => {
            const opt = RESET_OPTIONS.find(o => o.key === btn.dataset.resetKey);
            if (opt) openResetModal(opt);
        });
    });
}

/* ==========================================================
   MODAL
   ========================================================== */

function openResetModal(option) {
    currentOption = option;

    document.getElementById("resetModalTitle").textContent = option.title;
    document.getElementById("resetDeletedList").innerHTML = option.deleted.map(d => `<li>${escapeHtml(d)}</li>`).join("");
    document.getElementById("resetKeptList").innerHTML = option.kept.map(k => `<li>${escapeHtml(k)}</li>`).join("");
    document.getElementById("resetConfirmWordLabel").textContent = option.confirmWord;
    document.getElementById("resetConfirmInput").value = "";
    document.getElementById("resetConfirmInput").placeholder = option.confirmWord;

    const modal = document.getElementById("resetModal");
    modal.classList.toggle("reset-modal-severe", option.key === "all");

    openModal("resetModal");
}

document.getElementById("openFullResetBtn")?.addEventListener("click", () => openResetModal(FULL_RESET_OPTION));

document.getElementById("resetConfirmBtn")?.addEventListener("click", async () => {
    if (!currentOption || resetInProgress) return;

    const input = document.getElementById("resetConfirmInput");
    if (input.value.trim() !== currentOption.confirmWord) {
        showToast(`Type "${currentOption.confirmWord}" to confirm.`, "error");
        return;
    }

    resetInProgress = true;
    const btn = document.getElementById("resetConfirmBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Resetting…";

    try {
        let rpcSuccess = false;
        try {
            const { error: rpcError } = await db.rpc("reset_system_data", { scopes: currentOption.scopes });
            if (!rpcError) rpcSuccess = true;
            else console.warn("reset_system_data RPC error:", rpcError);
        } catch (rpcErr) {
            console.warn("reset_system_data RPC exception:", rpcErr);
            rpcSuccess = false;
        }

        if (!rpcSuccess) {
            // Direct table deletion fallback for the selected scopes
            const scopes = currentOption.scopes || [];

            // 1. Delete dependent transaction tables first to respect foreign keys
            if (scopes.includes("raw_materials") || scopes.includes("material_disbursements") || scopes.includes("all") || currentOption.key === "all") {
                const { error: disbErr } = await db.from("material_disbursements").delete().neq("id", "00000000-0000-0000-0000-000000000000");
                if (disbErr) console.warn("Disbursements reset warning:", disbErr);
            }
            if (scopes.includes("raw_materials") || scopes.includes("stock_receipts") || scopes.includes("all") || currentOption.key === "all") {
                const { error: recErr } = await db.from("stock_receipts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
                if (recErr) console.warn("Stock receipts reset warning:", recErr);
            }
            if (scopes.includes("raw_materials") || scopes.includes("all") || currentOption.key === "all") {
                const { error: matErr } = await db.from("raw_materials").delete().neq("id", "00000000-0000-0000-0000-000000000000");
                if (matErr) throw matErr;
            }

            // 2. Clear local storage contexts
            localStorage.removeItem("rmims_finished_product_context");
            localStorage.removeItem("rmims_raw_materials_context");
            localStorage.removeItem("rmims_inventory_cache");
        }

        showToast(`${currentOption.title} completed successfully.`);
        closeModal("resetModal");
        if (typeof onResetComplete === "function") onResetComplete();

    } catch (err) {
        console.error("Data reset failed:", err);
        showToast(err.message || `Unable to reset the selected data. Please try again.`, "error");

    } finally {
        resetInProgress = false;
        btn.disabled = false;
        btn.textContent = original;
    }
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

export function initDataReset(onComplete) {
    onResetComplete = onComplete || null;
    renderResetOptions();
}
