// js/system-materials.js
// Authoritative System-wide Raw Material Synchronization and Persistence Module
// Preserves all 59 baseline raw materials and seamlessly integrates newly created materials across the system.

import { AUTHENTIC_59_RAW_MATERIALS, AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from "./authentic-59-dataset.js";

export const RMIMS_CUSTOM_RAW_MATERIALS_KEY = "rmims_custom_raw_materials";
export const RMIMS_CUSTOM_RECEIPTS_KEY = "rmims_custom_receipts";
export const RMIMS_CUSTOM_DISBURSEMENTS_KEY = "rmims_custom_disbursements";
export const RMIMS_DELETED_MATERIALS_KEY = "rmims_deleted_material_ids";

/**
 * Returns all active raw materials for the entire system:
 * Baseline 59 Authentic materials + any Admin/User created custom materials - locally deleted materials.
 */
export function getSystemRawMaterials() {
    // Clone baseline 59 authentic materials
    let list = AUTHENTIC_59_RAW_MATERIALS.map(m => ({
        ...m,
        id: String(m.id || m.item_code),
        item_code: m.item_code || m.id,
        current_stock: Number(m.current_stock ?? 0),
        minimum_threshold: Number(m.minimum_threshold ?? m.minimum_stock ?? 10),
        minimum_stock: Number(m.minimum_threshold ?? m.minimum_stock ?? 10),
        unit_of_measure: m.unit_of_measure || m.unit || "kg",
        unit: m.unit_of_measure || m.unit || "kg"
    }));

    // Merge custom materials saved in localStorage
    try {
        const stored = localStorage.getItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY);
        if (stored) {
            const customMats = JSON.parse(stored);
            if (Array.isArray(customMats)) {
                customMats.forEach(cm => {
                    const normName = (cm.name || "").trim().toLowerCase();
                    const code = String(cm.item_code || cm.itemCode || cm.id || "").toUpperCase().trim();
                    const exists = list.some(m => 
                        (m.name || "").trim().toLowerCase() === normName ||
                        String(m.item_code || m.id || "").toUpperCase().trim() === code
                    );
                    if (!exists) {
                        list.push({
                            id: cm.id || code || `RM-${String(list.length + 1).padStart(3, "0")}`,
                            item_code: cm.item_code || cm.itemCode || code,
                            name: cm.name,
                            category: cm.category || "General Materials",
                            unit_of_measure: cm.unit_of_measure || cm.unit || "kg",
                            unit: cm.unit_of_measure || cm.unit || "kg",
                            current_stock: Number(cm.current_stock ?? cm.currentStock ?? 0),
                            minimum_threshold: Number(cm.minimum_threshold ?? cm.minimum_stock ?? cm.minimumStock ?? 10),
                            minimum_stock: Number(cm.minimum_threshold ?? cm.minimum_stock ?? cm.minimumStock ?? 10),
                            reorder_quantity: Number(cm.reorder_quantity ?? 25),
                            lead_time_days: Number(cm.lead_time_days ?? 3),
                            description: cm.description || `Raw material ${cm.name}`,
                            created_at: cm.created_at || new Date().toISOString()
                        });
                    }
                });
            }
        }
    } catch (e) {
        console.warn("[SystemMaterials] Could not load custom raw materials:", e);
    }

    // Filter out deleted materials
    try {
        const deletedRaw = localStorage.getItem(RMIMS_DELETED_MATERIALS_KEY);
        if (deletedRaw) {
            const deletedIds = new Set(JSON.parse(deletedRaw));
            if (deletedIds.size > 0) {
                list = list.filter(m => !deletedIds.has(String(m.id)) && !deletedIds.has((m.name || "").toLowerCase().trim()));
            }
        }
    } catch (e) {}

    return list;
}

/**
 * Persists a newly added raw material to localStorage and dispatches storage & sync events.
 */
export function saveCustomRawMaterial(mat) {
    let custom = [];
    try {
        const stored = localStorage.getItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY);
        if (stored) custom = JSON.parse(stored);
        if (!Array.isArray(custom)) custom = [];
    } catch (e) {
        custom = [];
    }

    const normName = (mat.name || "").trim().toLowerCase();
    const code = String(mat.item_code || mat.itemCode || mat.id || "").toUpperCase().trim();

    // Remove any previous match to avoid duplicates
    custom = custom.filter(m => 
        (m.name || "").trim().toLowerCase() !== normName &&
        String(m.item_code || m.itemCode || m.id || "").toUpperCase().trim() !== code
    );

    const fullRecord = {
        id: mat.id || code || `RM-${Date.now()}`,
        item_code: mat.item_code || mat.itemCode || code,
        name: mat.name,
        category: mat.category || "General Materials",
        unit_of_measure: mat.unit_of_measure || mat.unit || "kg",
        unit: mat.unit_of_measure || mat.unit || "kg",
        current_stock: Number(mat.current_stock ?? mat.currentStock ?? 0),
        minimum_threshold: Number(mat.minimum_threshold ?? mat.minimum_stock ?? mat.minimumStock ?? 10),
        minimum_stock: Number(mat.minimum_threshold ?? mat.minimum_stock ?? mat.minimumStock ?? 10),
        reorder_quantity: Number(mat.reorder_quantity ?? 25),
        lead_time_days: Number(mat.lead_time_days ?? 3),
        description: mat.description || `Raw material ${mat.name}`,
        created_at: mat.created_at || new Date().toISOString()
    };

    custom.push(fullRecord);
    localStorage.setItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY, JSON.stringify(custom));

    // Also remove from deleted set if it was previously marked deleted
    try {
        const deletedRaw = localStorage.getItem(RMIMS_DELETED_MATERIALS_KEY);
        if (deletedRaw) {
            let deletedIds = JSON.parse(deletedRaw);
            if (Array.isArray(deletedIds)) {
                deletedIds = deletedIds.filter(id => id !== fullRecord.id && id !== normName && id !== code);
                localStorage.setItem(RMIMS_DELETED_MATERIALS_KEY, JSON.stringify(deletedIds));
            }
        }
    } catch (e) {}

    // Broadcast system sync events
    localStorage.setItem("rmims_sync_event", JSON.stringify({
        time: Date.now(),
        action: "add_material",
        material: fullRecord
    }));
    localStorage.setItem("rmims_inventory_updated", String(Date.now()));
    window.dispatchEvent(new Event("storage"));

    return fullRecord;
}

/**
 * Calculates the next sequential item code (e.g. RM-060, RM-061) accurately.
 */
export function getSystemNextItemCode(existingMaterials) {
    const list = existingMaterials && existingMaterials.length > 0 ? existingMaterials : getSystemRawMaterials();
    const existingNums = list
        .map(m => {
            const codeStr = String(m.item_code || m.itemCode || m.id || "");
            const match = codeStr.match(/^RM-?0*(\d+)$/i);
            return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => n > 0);

    const maxNum = existingNums.length > 0 ? Math.max(...existingNums) : 59;
    let nextNum = maxNum + 1;
    let nextCode = `RM-${String(nextNum).padStart(3, "0")}`;

    while (list.some(m => {
        const c = String(m.item_code || m.itemCode || m.id || "").toUpperCase();
        return c === nextCode.toUpperCase() || c === `RM${String(nextNum).padStart(3, "0")}`.toUpperCase();
    })) {
        nextNum++;
        nextCode = `RM-${String(nextNum).padStart(3, "0")}`;
    }

    return nextCode;
}

/**
 * Loads custom receipts recorded via Add Material, Inventory, or Material Activity.
 */
export function getSystemCustomReceipts() {
    try {
        const raw = localStorage.getItem(RMIMS_CUSTOM_RECEIPTS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

/**
 * Saves a custom stock receipt to localStorage and invalidates forecast cache.
 */
export function saveCustomReceipt(receipt) {
    let receipts = getSystemCustomReceipts();
    const id = receipt.id || `rec-custom-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const normalized = {
        id: id,
        material_id: receipt.material_id || receipt.materialId,
        materialId: receipt.material_id || receipt.materialId,
        material_name: receipt.material_name || receipt.materialName || "",
        materialName: receipt.material_name || receipt.materialName || "",
        received_quantity: Number(receipt.received_quantity ?? receipt.receivedQuantity ?? receipt.quantity ?? 0),
        receivedQuantity: Number(receipt.received_quantity ?? receipt.receivedQuantity ?? receipt.quantity ?? 0),
        quantity: Number(receipt.received_quantity ?? receipt.receivedQuantity ?? receipt.quantity ?? 0),
        unit: receipt.unit || "kg",
        receipt_date: receipt.receipt_date || receipt.receiptDate || receipt.date || new Date().toISOString().slice(0, 10),
        receiptDate: receipt.receipt_date || receipt.receiptDate || receipt.date || new Date().toISOString().slice(0, 10),
        supplier_name: receipt.supplier_name || receipt.supplierName || receipt.supplier || "Inward Delivery",
        supplierName: receipt.supplier_name || receipt.supplierName || receipt.supplier || "Inward Delivery",
        received_by: receipt.received_by || receipt.receivedBy || "System User",
        created_at: receipt.created_at || receipt.createdAt || new Date().toISOString()
    };

    // De-duplicate if existing
    receipts = receipts.filter(r => String(r.id) !== String(id));
    receipts.unshift(normalized);
    localStorage.setItem(RMIMS_CUSTOM_RECEIPTS_KEY, JSON.stringify(receipts));
    localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "receive", receipt: normalized }));
    localStorage.setItem("rmims_inventory_updated", String(Date.now()));
    invalidateForecastCache();
    window.dispatchEvent(new Event("storage"));
    return receipts;
}

/**
 * Loads custom disbursements recorded via Inventory or Material Activity.
 */
export function getSystemCustomDisbursements() {
    try {
        const raw = localStorage.getItem(RMIMS_CUSTOM_DISBURSEMENTS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

/**
 * Saves a custom material disbursement to localStorage and invalidates forecast cache.
 */
export function saveCustomDisbursement(disbursement) {
    let disbs = getSystemCustomDisbursements();
    const id = disbursement.id || `disb-custom-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const normalized = {
        id: id,
        material_id: disbursement.material_id || disbursement.materialId,
        materialId: disbursement.material_id || disbursement.materialId,
        material_name: disbursement.material_name || disbursement.materialName || "",
        materialName: disbursement.material_name || disbursement.materialName || "",
        consumed_quantity: Number(disbursement.consumed_quantity ?? disbursement.consumedQuantity ?? disbursement.quantity ?? 0),
        consumedQuantity: Number(disbursement.consumed_quantity ?? disbursement.consumedQuantity ?? disbursement.quantity ?? 0),
        quantity: Number(disbursement.consumed_quantity ?? disbursement.consumedQuantity ?? disbursement.quantity ?? 0),
        unit: disbursement.unit || "kg",
        usage_date: disbursement.usage_date || disbursement.usageDate || disbursement.date || new Date().toISOString().slice(0, 10),
        usageDate: disbursement.usage_date || disbursement.usageDate || disbursement.date || new Date().toISOString().slice(0, 10),
        activity_type: disbursement.activity_type || disbursement.activityType || disbursement.context || "Production Usage",
        activityType: disbursement.activity_type || disbursement.activityType || disbursement.context || "Production Usage",
        finished_product_name: disbursement.finished_product_name || disbursement.finishedProductName || disbursement.context || "Operational Batch",
        finishedProductName: disbursement.finished_product_name || disbursement.finishedProductName || disbursement.context || "Operational Batch",
        recorded_by: disbursement.recorded_by || disbursement.recordedBy || "System User",
        created_at: disbursement.created_at || disbursement.createdAt || new Date().toISOString()
    };

    // De-duplicate if existing
    disbs = disbs.filter(d => String(d.id) !== String(id));
    disbs.unshift(normalized);
    localStorage.setItem(RMIMS_CUSTOM_DISBURSEMENTS_KEY, JSON.stringify(disbs));
    localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "disburse", disbursement: normalized }));
    localStorage.setItem("rmims_inventory_updated", String(Date.now()));
    invalidateForecastCache();
    window.dispatchEvent(new Event("storage"));
    return disbs;
}

/**
 * Automatically clears stale forecast caches across the system whenever new transactions occur.
 */
export function invalidateForecastCache() {
    try {
        localStorage.removeItem("rmims_forecast_cache");
        localStorage.removeItem("rmims_forecast_timestamp");
    } catch (e) {}
}

export { AUTHENTIC_59_RAW_MATERIALS, AUTHENTIC_FINISHED_PRODUCTS_CATALOG };
