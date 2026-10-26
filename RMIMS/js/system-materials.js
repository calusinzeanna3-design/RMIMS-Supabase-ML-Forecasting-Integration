// js/system-materials.js
// Authoritative System-wide Raw Material Synchronization and Persistence Module
// Preserves all 59 baseline raw materials and seamlessly integrates newly created materials across the system.

import { AUTHENTIC_59_RAW_MATERIALS, AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from "./authentic-59-dataset.js";
import { AUTHENTIC_19_SCONES_MATERIALS } from "./authentic-scones-dataset.js";
import { getActiveTenantContext } from "./tenant-manager.js";

export const RMIMS_CUSTOM_RAW_MATERIALS_KEY = "rmims_custom_raw_materials";
export const RMIMS_CUSTOM_RECEIPTS_KEY = "rmims_custom_receipts";
export const RMIMS_CUSTOM_DISBURSEMENTS_KEY = "rmims_custom_disbursements";
export const RMIMS_DELETED_MATERIALS_KEY = "rmims_deleted_material_ids";

export const RMIMS_WIPE_BASELINE_MATERIALS_KEY = "rmims_wipe_baseline_materials";

/**
 * Permanently removes all old test transactions, receipts, disbursements, and stale dates
 * inputted in previous sessions, ensuring a clean slate so they never affect the system.
 */
export function permanentlyPurgeOldWeeklyInputs() {
    try {
        const PURGE_FLAG = "rmims_purged_brand_new_v7";
        if (typeof window !== "undefined" && !localStorage.getItem(PURGE_FLAG)) {
            // 1. Permanently clear all old test receipts
            localStorage.setItem(RMIMS_CUSTOM_RECEIPTS_KEY, "[]");
            localStorage.setItem("rmims_manager_receipts", "[]");

            // 2. Permanently clear all old test disbursements
            localStorage.setItem(RMIMS_CUSTOM_DISBURSEMENTS_KEY, "[]");
            localStorage.setItem("rmims_manager_disbursements", "[]");

            // 3. Permanently clear all old staff transactions
            localStorage.setItem("staff_transactions", "[]");
            localStorage.setItem("rmims_staff_transactions", "[]");

            // 4. Permanently clear old activity logs and histories
            localStorage.setItem("rmims_manager_activities", "[]");
            localStorage.setItem("rmims_activity_logs", "[]");
            localStorage.setItem("rmims_system_activity_logs", "[]");
            localStorage.setItem("rmims_recent_activities", "[]");
            localStorage.setItem("rmims_pending_approvals", "[]");
            localStorage.setItem("rmims_staff_activity_logs", "[]");
            localStorage.setItem("rmims_material_history", "{}");
            localStorage.setItem("rmims_stock_history", "{}");

            // 5. Cleanse all overrides to remove old dates and timestamps
            const ovKeys = [
                "rmims_manager_material_overrides",
                "rmims_manager_inventory_overrides",
                "rmims_material_overrides"
            ];
            ovKeys.forEach(ovKey => {
                const raw = localStorage.getItem(ovKey);
                if (raw) {
                    try {
                        const ovs = JSON.parse(raw);
                        if (ovs && typeof ovs === 'object') {
                            Object.keys(ovs).forEach(k => {
                                if (ovs[k]) {
                                    delete ovs[k].date_added;
                                    delete ovs[k].last_updated;
                                    delete ovs[k].display_date;
                                    delete ovs[k].display_time;
                                    delete ovs[k].time_added;
                                    delete ovs[k].isUserExplicitEdit;
                                }
                            });
                            localStorage.setItem(ovKey, JSON.stringify(ovs));
                        }
                    } catch (_) {}
                }
            });

            // Set purge flag so it persists clean slate
            // 6. Permanently wipe all old forecast caches, predictions, and analytics summaries
            localStorage.removeItem("rmims_forecast_cache");
            localStorage.removeItem("rmims_forecast_timestamp");
            localStorage.removeItem("rmims_latest_forecast");
            localStorage.removeItem("rmims_analytics_cache");
            localStorage.removeItem("rmims_analytics_summary");
            localStorage.setItem("rmims_wipe_baseline_materials", "true");

            localStorage.setItem(PURGE_FLAG, "true");
            localStorage.setItem("rmims_inventory_updated", String(Date.now()));
        }
    } catch (e) {
        console.warn("[Purge] Notice:", e);
    }
}

// Automatically execute purge on module initialization
try {
    permanentlyPurgeOldWeeklyInputs();
} catch (_) {}


/**
 * Safely and reliably parses complex date strings:
 * Handles ISO, YYYY-MM-DD, bullet timestamps ("2026-10-16 • 10:30 AM"), standard text dates ("Oct 16, 2026")
 */
export function parseSafeDate(dStr) {
    if (!dStr) return null;
    if (dStr instanceof Date && !isNaN(dStr.getTime())) return dStr;
    let str = String(dStr).trim();
    str = str.replace(/[•|]/g, ' ').replace(/\s+/g, ' ').trim();
    let d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    const datePart = str.split(' ')[0];
    d = new Date(datePart);
    if (!isNaN(d.getTime())) return d;
    return null;
}


/**
 * Returns all active raw materials for the entire system:
 * Automatically selects the appropriate branch store / company dataset:
 * - Scones & Muffins Bakery: 19 Nutribun Materials (Folder: 1872cf44-e821-4370-b227-d1b7e4fc6f56)
 * - KXC Enterprise: 59 Materials (Folder: a72a7971-6ec7-4edc-ae72-89d702199ed9)
 * Seamlessly merges any custom user-added materials.
 */
/**
 * Authoritatively determines the measurement unit for raw materials:
 * - Fresh Whole Eggs (NB-006): 'pcs'
 * - Plastic Pillow Packaging (NB-019): 'kl'
 * - All other 17 Scones & Muffins baking materials (flour, sugar, yeast, etc.): 'g' (Grams)
 * - Non-Scones materials (KXC Enterprise): preserves original unit_of_measure or unit ('kg', 'L', etc.)
 */
export function getAuthoritativeMaterialUnit(material, isScones = false) {
    if (!material) return "kg";
    const code = String(material.item_code || material.itemCode || material.id || material.code || "").toUpperCase().trim();
    const name = String(material.name || material.raw_material_name || "").toLowerCase().trim();

    let checkScones = isScones;
    if (!checkScones) {
        try {
            const tCtx = getActiveTenantContext();
            checkScones = Boolean(tCtx && tCtx.isScones);
        } catch (_) {}
    }
    const isSconesItem = checkScones || code.startsWith("NB-") || name.includes("nutribun") || name.includes("scones");

    if (isSconesItem) {
        if (code === "NB-006" || name.includes("fresh whole eggs") || name.includes("egg")) {
            return "pcs";
        }
        if (code === "NB-019" || name.includes("plastic pillow") || name.includes("pillow packaging")) {
            return "kl";
        }
        return "g";
    }

    return material.unit_of_measure || material.unit || "kg";
}

/**
 * Returns all active raw materials for the entire system:
 * Automatically selects the appropriate branch store / company dataset:
 * - Scones & Muffins Bakery: 19 Nutribun Materials (Folder: 1872cf44-e821-4370-b227-d1b7e4fc6f56)
 * - KXC Enterprise: 59 Materials (Folder: a72a7971-6ec7-4edc-ae72-89d702199ed9)
 * Seamlessly merges any custom user-added materials and enforces authentic units.
 */
export function getSystemRawMaterials() {
    let tCtx = null;
    try {
        tCtx = getActiveTenantContext();
    } catch (_) {}
    const isScones = tCtx ? Boolean(tCtx.isScones) : true;
    const baseSource = isScones ? AUTHENTIC_19_SCONES_MATERIALS : AUTHENTIC_59_RAW_MATERIALS;

    let list = baseSource.map(m => {
        const stockVal = Number(m.current_stock ?? m.currentStock ?? m.stock ?? 0);
        const minVal = Number(m.minimum_threshold ?? m.minimum_stock ?? m.minimumStock ?? m.minStock ?? 10);
        const correctUnit = getAuthoritativeMaterialUnit(m, isScones);
        return {
            ...m,
            id: String(m.id || m.item_code),
            item_code: m.item_code || m.id,
            current_stock: stockVal,
            currentStock: stockVal,
            stock: stockVal,
            minimum_threshold: minVal,
            minimum_stock: minVal,
            minimumStock: minVal,
            minStock: minVal,
            unit_of_measure: correctUnit,
            unit: correctUnit
        };
    });

    // Merge custom materials saved in localStorage (user's real inputted data)
    try {
        const stored = localStorage.getItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY);
        if (stored) {
            let customMats = JSON.parse(stored);
            if (Array.isArray(customMats)) {
                let customModified = false;
                customMats.forEach(cm => {
                    const normName = (cm.name || cm.raw_material_name || "").trim().toLowerCase();
                    const code = String(cm.item_code || cm.itemCode || cm.id || "").toUpperCase().trim();
                    const foundIndex = list.findIndex(m => 
                        (m.name || m.raw_material_name || "").trim().toLowerCase() === normName ||
                        String(m.item_code || m.id || "").toUpperCase().trim() === code
                    );
                    const authUnit = getAuthoritativeMaterialUnit(cm, isScones);
                    if (isScones && (cm.unit !== authUnit || cm.unit_of_measure !== authUnit)) {
                        cm.unit = authUnit;
                        cm.unit_of_measure = authUnit;
                        customModified = true;
                    }
                    const record = {
                        id: cm.id || code || `RM-${String(list.length + 1).padStart(3, "0")}`,
                        item_code: cm.item_code || cm.itemCode || code,
                        name: cm.name,
                        category: cm.category || "General Materials",
                        unit_of_measure: authUnit,
                        unit: authUnit,
                        current_stock: Number(cm.current_stock ?? cm.currentStock ?? cm.stock ?? 0),
                        currentStock: Number(cm.current_stock ?? cm.currentStock ?? cm.stock ?? 0),
                        minimum_threshold: Number(cm.minimum_threshold ?? cm.minimum_stock ?? cm.minimumStock ?? 10),
                        minimum_stock: Number(cm.minimum_threshold ?? cm.minimum_stock ?? cm.minimumStock ?? 10),
                        reorder_quantity: Number(cm.reorder_quantity ?? 25),
                        lead_time_days: Number(cm.lead_time_days ?? 3),
                        description: cm.description || `Raw material ${cm.name}`,
                        created_at: cm.created_at || new Date().toISOString()
                    };
                    if (foundIndex !== -1) {
                        list[foundIndex] = { ...list[foundIndex], ...record };
                    } else {
                        list.push(record);
                    }
                });
                if (customModified) {
                    try {
                        localStorage.setItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY, JSON.stringify(customMats));
                    } catch (_) {}
                }
            }
        }
    } catch (e) {
        console.warn("[SystemMaterials] Could not load custom raw materials:", e);
    }

    // Also check manager inventory overrides for any user-inputted materials or live stock edits
    try {
        const ovKeys = ["rmims_manager_material_overrides", "rmims_manager_inventory_overrides"];
        ovKeys.forEach(ovKey => {
            const ovStored = localStorage.getItem(ovKey);
            if (!ovStored) return;
            const ovs = JSON.parse(ovStored);
            if (!ovs || typeof ovs !== 'object') return;

            Object.keys(ovs).forEach(key => {
                const ov = ovs[key];
                if (!ov) return;
                const code = String(key || ov.id || ov.item_code || "").toUpperCase().trim();
                const normName = (ov.name || ov.raw_material_name || "").trim().toLowerCase();
                const foundIndex = list.findIndex(m =>
                    (code && String(m.item_code || m.id || "").toUpperCase().trim() === code) ||
                    (normName && (m.name || m.raw_material_name || "").trim().toLowerCase() === normName)
                );
                const curStock = ov.current_stock !== undefined ? Number(ov.current_stock) : undefined;
                const minStock = (ov.minimum_stock !== undefined || ov.minimum_threshold !== undefined)
                    ? Number(ov.minimum_stock ?? ov.minimum_threshold)
                    : undefined;

                if (foundIndex !== -1) {
                    const existing = list[foundIndex];
                    const authUnit = getAuthoritativeMaterialUnit(existing, isScones);
                    list[foundIndex] = {
                        ...existing,
                        ...ov,
                        unit: authUnit,
                        unit_of_measure: authUnit,
                        current_stock: curStock !== undefined ? curStock : existing.current_stock,
                        currentStock: curStock !== undefined ? curStock : existing.current_stock,
                        stock: curStock !== undefined ? curStock : existing.current_stock,
                        minimum_threshold: minStock !== undefined ? minStock : existing.minimum_threshold,
                        minimum_stock: minStock !== undefined ? minStock : existing.minimum_threshold,
                        minimumStock: minStock !== undefined ? minStock : existing.minimum_threshold,
                        minStock: minStock !== undefined ? minStock : existing.minimum_threshold
                    };
                } else if (ov.name || ov.raw_material_name) {
                    const authUnit = getAuthoritativeMaterialUnit(ov, isScones);
                    const record = {
                        id: code || ov.id || `RM-${String(list.length + 1).padStart(3, "0")}`,
                        item_code: code || ov.item_code || ov.id,
                        name: ov.name || ov.raw_material_name,
                        raw_material_name: ov.name || ov.raw_material_name,
                        category: ov.category || "General Materials",
                        unit_of_measure: authUnit,
                        unit: authUnit,
                        current_stock: curStock !== undefined ? curStock : 0,
                        currentStock: curStock !== undefined ? curStock : 0,
                        stock: curStock !== undefined ? curStock : 0,
                        minimum_threshold: minStock !== undefined ? minStock : 10,
                        minimum_stock: minStock !== undefined ? minStock : 10,
                        minimumStock: minStock !== undefined ? minStock : 10,
                        minStock: minStock !== undefined ? minStock : 10,
                        reorder_quantity: Number(ov.reorder_quantity ?? 25),
                        lead_time_days: Number(ov.lead_time_days ?? 3),
                        description: ov.description || `Raw material ${ov.name || ov.raw_material_name}`,
                        created_at: ov.date_added || new Date().toISOString()
                    };
                    list.push(record);
                }
            });
        });
    } catch (e) {
        console.warn("[SystemMaterials] Could not apply manager overrides:", e);
    }

    // Filter out deleted materials with multi-alias check
    try {
        const deletedRaw = localStorage.getItem(RMIMS_DELETED_MATERIALS_KEY);
        if (deletedRaw) {
            const deletedArr = JSON.parse(deletedRaw);
            if (Array.isArray(deletedArr) && deletedArr.length > 0) {
                const deletedSet = new Set(deletedArr.map(d => String(d).trim().toLowerCase()));
                list = list.filter(m => {
                    const mId = String(m.id || "").trim().toLowerCase();
                    const mCode = String(m.item_code || m.itemCode || "").trim().toLowerCase();
                    const mName = String(m.name || m.raw_material_name || "").trim().toLowerCase();
                    return !deletedSet.has(mId) && !deletedSet.has(mCode) && !deletedSet.has(mName);
                });
            }
        }
    } catch (e) {}

    // Strict deduplication pass: never allow repeating or duplicate materials to show up
    const seenMatKeys = new Set();
    const dedupedList = [];
    list.forEach(m => {
        const code = String(m.item_code || m.id || "").toUpperCase().trim();
        const name = String(m.name || m.raw_material_name || "").toLowerCase().trim();
        const uniqueKey = code || name;
        if (!uniqueKey) return;
        if (seenMatKeys.has(uniqueKey) || (name && seenMatKeys.has(`name:${name}`))) {
            return; // skip duplicate or zombie entry
        }
        seenMatKeys.add(uniqueKey);
        if (name) seenMatKeys.add(`name:${name}`);
        dedupedList.push(m);
    });
    list = dedupedList;

    // Final property normalization: ensure every material has both snake_case and camelCase stock & threshold aliases
    return list.map(m => {
        const s = Number(m.current_stock ?? m.currentStock ?? m.stock ?? 0);
        const min = Number(m.minimum_threshold ?? m.minimum_stock ?? m.minimumStock ?? m.minStock ?? 10);
        const u = getAuthoritativeMaterialUnit(m, isScones);
        return {
            ...m,
            current_stock: s,
            currentStock: s,
            stock: s,
            minimum_threshold: min,
            minimum_stock: min,
            minimumStock: min,
            minStock: min,
            unit_of_measure: u,
            unit: u
        };
    });
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
        current_stock: Number(mat.current_stock ?? mat.currentStock ?? mat.stock ?? 0),
        currentStock: Number(mat.current_stock ?? mat.currentStock ?? mat.stock ?? 0),
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
 * Permanently deletes or hides a raw material from the system and all catalogs.
 */
export function deleteSystemRawMaterial(idOrCodeOrName) {
    if (!idOrCodeOrName) return false;
    const target = String(idOrCodeOrName).trim();
    const targetLower = target.toLowerCase();
    const targetUpper = target.toUpperCase();

    // 1. Remove from custom raw materials
    try {
        const stored = localStorage.getItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY);
        if (stored) {
            let custom = JSON.parse(stored);
            if (Array.isArray(custom)) {
                custom = custom.filter(m => {
                    const id = String(m.id || '').toUpperCase();
                    const code = String(m.item_code || m.itemCode || '').toUpperCase();
                    const name = (m.name || '').trim().toLowerCase();
                    return id !== targetUpper && code !== targetUpper && name !== targetLower;
                });
                localStorage.setItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY, JSON.stringify(custom));
            }
        }
    } catch (e) {
        console.warn("[SystemMaterials] Error removing custom raw material:", e);
    }

    // 2. Mark as deleted in global deleted IDs set (include all aliases)
    try {
        const deletedRaw = localStorage.getItem(RMIMS_DELETED_MATERIALS_KEY);
        let deletedIds = deletedRaw ? JSON.parse(deletedRaw) : [];
        if (!Array.isArray(deletedIds)) deletedIds = [];
        
        [target, targetUpper, targetLower].forEach(val => {
            if (val && !deletedIds.includes(val)) deletedIds.push(val);
        });

        localStorage.setItem(RMIMS_DELETED_MATERIALS_KEY, JSON.stringify(deletedIds));
    } catch (e) {
        console.warn("[SystemMaterials] Error writing deleted material ID:", e);
    }

    // 3. Remove from both manager overrides storage keys
    const overrideKeys = ["rmims_manager_material_overrides", "rmims_manager_inventory_overrides"];
    overrideKeys.forEach(ovKey => {
        try {
            const ovRaw = localStorage.getItem(ovKey);
            if (ovRaw) {
                const ovs = JSON.parse(ovRaw);
                if (ovs && typeof ovs === 'object') {
                    delete ovs[target];
                    delete ovs[targetUpper];
                    delete ovs[targetLower];
                    localStorage.setItem(ovKey, JSON.stringify(ovs));
                }
            }
        } catch (e) {}
    });

    // 4. Invalidate forecast cache and broadcast
    invalidateForecastCache();
    localStorage.setItem("rmims_sync_event", JSON.stringify({
        time: Date.now(),
        action: "delete_material",
        id: target
    }));
    localStorage.setItem("rmims_inventory_updated", String(Date.now()));
    window.dispatchEvent(new Event("storage"));
    return true;
}

/**
 * Safely adjusts material stock by a positive or negative delta and syncs storage.
 */
export function adjustSystemMaterialStock(materialIdOrName, delta) {
    if (!materialIdOrName || delta === 0 || isNaN(delta)) return null;
    const list = getSystemRawMaterials();
    const searchId = String(materialIdOrName).trim().toLowerCase();
    const mat = list.find(m => 
        String(m.id || '').toLowerCase() === searchId ||
        String(m.item_code || '').toLowerCase() === searchId ||
        (m.name || '').trim().toLowerCase() === searchId ||
        ((m.name || '').toLowerCase().includes(searchId) && searchId.length > 3)
    );
    if (!mat) return null;

    const oldStock = Number(mat.current_stock || 0);
    const newStock = Math.max(0, oldStock + delta);
    mat.current_stock = newStock;
    mat.last_updated = new Date().toISOString();

    saveCustomRawMaterial(mat);

    // Synchronize both manager overrides keys with the new stock & latest timestamp
    try {
        const ovKeys = ["rmims_manager_material_overrides", "rmims_manager_inventory_overrides"];
        const idKey = String(mat.item_code || mat.id || '').toUpperCase().trim();
        const nameKey = (mat.name || mat.raw_material_name || '').trim();

        ovKeys.forEach(ovKey => {
            const ovRaw = localStorage.getItem(ovKey);
            const ovs = ovRaw ? JSON.parse(ovRaw) : {};
            const keyToUse = idKey || nameKey;
            if (keyToUse) {
                ovs[keyToUse] = {
                    ...(ovs[keyToUse] || {}),
                    name: mat.name,
                    raw_material_name: mat.raw_material_name || mat.name,
                    current_stock: newStock,
                    unit: mat.unit || mat.unit_of_measure,
                    last_updated: mat.last_updated
                };
                if (idKey && nameKey && idKey !== nameKey) {
                    ovs[nameKey] = {
                        ...(ovs[nameKey] || {}),
                        current_stock: newStock,
                        last_updated: mat.last_updated
                    };
                }
                localStorage.setItem(ovKey, JSON.stringify(ovs));
            }
        });
    } catch (e) {}

    // Invalidate forecast cache and broadcast
    invalidateForecastCache();
    try {
        localStorage.setItem("rmims_inventory_updated", String(Date.now()));
        window.dispatchEvent(new Event("storage"));
        const syncChannel = new BroadcastChannel('rmims_user_sync');
        syncChannel.postMessage({ type: 'INVENTORY_CHANGED', material: mat.name, currentStock: newStock, time: Date.now() });
    } catch (_) {}

    return mat;
}

/**
 * Updates a raw material's activity timestamp across all manager overrides and custom ledgers.
 * Guarantees that the newest transaction or input immediately updates the inventory display date.
 */
export function updateMaterialActivityTimestamp(materialIdOrName, timestamp = new Date().toISOString(), activityType = 'Activity', qty = null, unit = null) {
    if (!materialIdOrName) return;
    const search = String(materialIdOrName).trim().toLowerCase();
    const list = getSystemRawMaterials();
    const mat = list.find(m => 
        String(m.id || '').toLowerCase() === search ||
        String(m.item_code || '').toLowerCase() === search ||
        (m.name || '').trim().toLowerCase() === search
    );

    const now = new Date(timestamp);
    const validTime = !isNaN(now.getTime()) ? now.toISOString() : new Date().toISOString();
    const idKey = mat ? String(mat.item_code || mat.id || '').toUpperCase().trim() : String(materialIdOrName).toUpperCase().trim();
    const nameKey = mat ? (mat.name || mat.raw_material_name || '').trim() : String(materialIdOrName).trim();

    try {
        const ovKeys = ["rmims_manager_material_overrides", "rmims_manager_inventory_overrides"];
        ovKeys.forEach(ovKey => {
            const ovRaw = localStorage.getItem(ovKey);
            const ovs = ovRaw ? JSON.parse(ovRaw) : {};
            const keys = [idKey, nameKey].filter(Boolean);
            keys.forEach(k => {
                ovs[k] = {
                    ...(ovs[k] || {}),
                    last_updated: validTime
                };
            });
            localStorage.setItem(ovKey, JSON.stringify(ovs));
        });
    } catch (_) {}

    if (mat) {
        mat.last_updated = validTime;
        saveCustomRawMaterial(mat);
    }

    try {
        localStorage.setItem("rmims_inventory_updated", String(Date.now()));
        window.dispatchEvent(new Event("storage"));
        const syncChannel = new BroadcastChannel('rmims_user_sync');
        syncChannel.postMessage({ type: 'MATERIAL_TIMESTAMP_UPDATED', material: nameKey, timestamp: validTime });
    } catch (_) {}
}


/**
 * Calculates the next sequential item code (e.g. RM-060, RM-061) accurately.
 */
export function getSystemNextItemCode(existingMaterials) {
    let tCtx = null;
    try { tCtx = getActiveTenantContext(); } catch (_) {}
    const isScones = tCtx && tCtx.isScones;
    const prefix = isScones ? "NB-" : "RM-";
    const baseCount = isScones ? 19 : 59;

    const list = existingMaterials && existingMaterials.length > 0 ? existingMaterials : getSystemRawMaterials();
    const regex = isScones ? /^NB-?0*(\d+)$/i : /^RM-?0*(\d+)$/i;

    const existingNums = list
        .map(m => {
            const codeStr = String(m.item_code || m.itemCode || m.id || "");
            const match = codeStr.match(regex);
            return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => n > 0);

    const maxNum = existingNums.length > 0 ? Math.max(...existingNums) : baseCount;
    let nextNum = maxNum + 1;
    let nextCode = `${prefix}${String(nextNum).padStart(3, "0")}`;

    while (list.some(m => {
        const c = String(m.item_code || m.itemCode || m.id || "").toUpperCase();
        return c === nextCode.toUpperCase();
    })) {
        nextNum++;
        nextCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
    }

    return nextCode;
}

/**
 * Loads custom receipts recorded via Add Material, Inventory, or Material Activity.
 */
export function getSystemCustomReceipts() {
    const map = new Map();
    // 1. Load custom receipts
    try {
        const raw = localStorage.getItem(RMIMS_CUSTOM_RECEIPTS_KEY);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                arr.forEach(r => {
                    const key = String(r.ref || r.id || '').trim();
                    if (key) map.set(key, r);
                });
            }
        }
    } catch (_) {}

    // 2. Load manager receipts & approved receipts ledger
    try {
        const rawMgr = localStorage.getItem('rmims_manager_receipts');
        if (rawMgr) {
            const arrMgr = JSON.parse(rawMgr);
            if (Array.isArray(arrMgr)) {
                arrMgr.forEach(r => {
                    const key = String(r.ref || r.id || '').trim();
                    if (key) {
                        const normalized = {
                            id: r.id || r.ref || key,
                            ref: r.ref || r.id || key,
                            material_id: r.materialId || r.material_id,
                            materialId: r.materialId || r.material_id,
                            material_name: r.materialName || r.material_name,
                            materialName: r.materialName || r.material_name,
                            received_quantity: Number(r.quantity ?? r.received_quantity ?? 0),
                            receivedQuantity: Number(r.quantity ?? r.received_quantity ?? 0),
                            quantity: Number(r.quantity ?? r.received_quantity ?? 0),
                            unit: r.unit || '',
                            receipt_date: r.date || r.receipt_date || new Date().toISOString().slice(0, 10),
                            supplier_name: r.supplier || r.supplier_name || 'Inward Delivery',
                            supplierName: r.supplier || r.supplier_name || 'Inward Delivery',
                            status: r.status || 'Approved',
                            created_at: r.createdAt || r.created_at || new Date().toISOString()
                        };
                        map.set(key, { ...normalized, ...r });
                    }
                });
            }
        }
    } catch (_) {}

    return Array.from(map.values());
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
        unit: receipt.unit || getAuthoritativeMaterialUnit({ id: receipt.material_id || receipt.materialId, name: receipt.material_name || receipt.materialName }),
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
    const map = new Map();
    // 1. Load custom disbursements
    try {
        const raw = localStorage.getItem(RMIMS_CUSTOM_DISBURSEMENTS_KEY);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                arr.forEach(d => {
                    const key = String(d.ref || d.id || '').trim();
                    if (key) map.set(key, d);
                });
            }
        }
    } catch (_) {}

    // 2. Load manager disbursements & approved disbursements ledger
    try {
        const rawMgr = localStorage.getItem('rmims_manager_disbursements');
        if (rawMgr) {
            const arrMgr = JSON.parse(rawMgr);
            if (Array.isArray(arrMgr)) {
                arrMgr.forEach(d => {
                    const key = String(d.ref || d.id || '').trim();
                    if (key) {
                        const normalized = {
                            id: d.id || d.ref || key,
                            ref: d.ref || d.id || key,
                            material_id: d.materialId || d.material_id,
                            materialId: d.materialId || d.material_id,
                            material_name: d.materialName || d.material_name,
                            materialName: d.materialName || d.material_name,
                            consumed_quantity: Number(d.quantity ?? d.consumed_quantity ?? 0),
                            consumedQuantity: Number(d.quantity ?? d.consumed_quantity ?? 0),
                            quantity: Number(d.quantity ?? d.consumed_quantity ?? 0),
                            unit: d.unit || '',
                            usage_date: d.date || d.usage_date || new Date().toISOString().slice(0, 10),
                            finished_product_name: d.finishedProductName || d.product || d.finished_product_name || 'Operational Usage',
                            status: d.status || 'Approved',
                            created_at: d.createdAt || d.created_at || new Date().toISOString()
                        };
                        map.set(key, { ...normalized, ...d });
                    }
                });
            }
        }
    } catch (_) {}

    return Array.from(map.values());
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
        unit: disbursement.unit || getAuthoritativeMaterialUnit({ id: disbursement.material_id || disbursement.materialId, name: disbursement.material_name || disbursement.materialName }),
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
        localStorage.removeItem("rmims_latest_forecast");
        localStorage.removeItem("rmims_analytics_cache");
        localStorage.removeItem("rmims_analytics_summary");
    } catch (e) {}
}

export { AUTHENTIC_59_RAW_MATERIALS, AUTHENTIC_FINISHED_PRODUCTS_CATALOG };

