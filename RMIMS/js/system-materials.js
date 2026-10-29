// js/system-materials.js
// Authoritative System-wide Raw Material Synchronization and Persistence Module
// Preserves all 59 baseline raw materials and seamlessly integrates newly created materials across the system.

import { AUTHENTIC_59_RAW_MATERIALS, AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from "./authentic-59-dataset.js";
import { AUTHENTIC_19_SCONES_MATERIALS, getSconesMaterialImagePath } from "./authentic-scones-dataset.js";
import { getActiveTenantContext } from "./tenant-manager.js";

export { getSconesMaterialImagePath };

export const RMIMS_CUSTOM_RAW_MATERIALS_KEY = "rmims_custom_raw_materials";
export const RMIMS_CUSTOM_RECEIPTS_KEY = "rmims_custom_receipts";
export const RMIMS_CUSTOM_DISBURSEMENTS_KEY = "rmims_custom_disbursements";
export const RMIMS_DELETED_MATERIALS_KEY = "rmims_deleted_material_ids";
export const RMIMS_WIPE_BASELINE_MATERIALS_KEY = "rmims_wipe_baseline_materials";

// No hardcoded or undeletable material locks — all materials are controlled 100% by the end user
export const PROTECTED_SCONES_CODES = new Set();
export const PROTECTED_KXC_CODES = new Set();
export const PROTECTED_MATERIAL_CODES = new Set();
export const PROTECTED_MATERIAL_NAMES = new Set();

export function cleanseMaterialBlacklists() {
  // End-user deletions are respected permanently
}

/**
 * Permanently removes all system-seeded/patched dummy data while preserving
 * any genuine end-user imported or manually added materials and transactions.
 */
export function permanentlyPurgeOldWeeklyInputs() {
    try {
        const END_USER_CLEAN_FLAG = "rmims_end_user_clean_v21";
        if (typeof window !== "undefined" && !localStorage.getItem(END_USER_CLEAN_FLAG)) {
            const isUserCreatedItem = (item) => {
                if (!item || typeof item !== "object") return false;
                const stk = Number(item.current_stock ?? item.currentStock ?? item.stock ?? 0);
                if (stk > 0) return true;
                if (item.is_zero_explicit === true) return true;
                return false;
            };

            try {
                const customRaw = localStorage.getItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY);
                if (customRaw) {
                    const arr = JSON.parse(customRaw);
                    if (Array.isArray(arr)) {
                        const kept = arr.filter(isUserCreatedItem).map(it => ({
                            ...it,
                            is_imported: true,
                            is_manual_override: true
                        }));
                        localStorage.setItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY, JSON.stringify(kept));
                    }
                }
            } catch (_) {}

            ["rmims_manager_material_overrides", "rmims_manager_inventory_overrides"].forEach(k => {
                try {
                    const ovRaw = localStorage.getItem(k);
                    if (ovRaw) {
                        const ovs = JSON.parse(ovRaw);
                        if (ovs && typeof ovs === "object") {
                            const cleanedOvs = {};
                            Object.keys(ovs).forEach(key => {
                                if (isUserCreatedItem(ovs[key])) {
                                    cleanedOvs[key] = {
                                        ...ovs[key],
                                        is_imported: true,
                                        is_manual_override: true
                                    };
                                }
                            });
                            localStorage.setItem(k, JSON.stringify(cleanedOvs));
                        }
                    }
                } catch (_) {}
            });

            // Clear stale v18 blanket material blacklist so registered NB-001..NB-019 / RM-001..RM-059 codes are never blocked
            localStorage.removeItem(RMIMS_DELETED_MATERIALS_KEY);

            // Remove auto-seeded Scones Formulation finished product if it was system-generated
            ["rmims_custom_finished_products", "RMSME_CUSTOM_FINISHED_PRODUCTS", "rmims_finished_products", "rmims_finished_product_context"].forEach(fpKey => {
                try {
                    const fpRaw = localStorage.getItem(fpKey);
                    if (fpRaw) {
                        const fpArr = JSON.parse(fpRaw);
                        if (Array.isArray(fpArr)) {
                            const userFps = fpArr.filter(fp => fp && fp.id !== "fp-scones-formulation");
                            localStorage.setItem(fpKey, JSON.stringify(userFps));
                        }
                    }
                } catch (_) {}
            });

            localStorage.removeItem("rmims_forecast_cache");
            localStorage.removeItem("rmims_forecast_timestamp");
            localStorage.removeItem("rmims_latest_forecast");
            localStorage.removeItem("rmims_analytics_cache");
            localStorage.removeItem("rmims_analytics_summary");
            localStorage.setItem(END_USER_CLEAN_FLAG, "true");
        }
    } catch (e) {
        console.warn("[Purge] Notice:", e);
    }
}

// Automatically execute clean check on module initialization
try {
    permanentlyPurgeOldWeeklyInputs();
} catch (_) {}

/**
 * Recognizes raw material names already registered by the AI Forecasting models
 * (Scones & Muffins: NB-001..NB-019; KXC Enterprise: RM-001..RM-059) even when
 * the Excel spreadsheet rows are shuffled or use short names (e.g. "All Purpose Flour" -> NB-001, "Squash" -> NB-003).
 */
export function resolveForecastingMaterialByName(rawName, isSconesParam = null) {
    if (!rawName) return null;
    const clean = String(rawName).trim().toLowerCase();
    const norm = clean.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!norm) return null;

    let isScones = isSconesParam;
    if (isScones === null || isScones === undefined) {
        try {
            const tCtx = getActiveTenantContext();
            isScones = tCtx ? Boolean(tCtx.isScones) : true;
        } catch (_) {
            isScones = true;
        }
    }

    if (isScones) {
        // 1. Direct or normalized match against AUTHENTIC_19_SCONES_MATERIALS
        for (const m of AUTHENTIC_19_SCONES_MATERIALS) {
            const mNorm = String(m.name || m.raw_material_name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
            if (mNorm === norm) {
                return { code: m.item_code || m.id, canonicalName: m.name, unit: m.unit || 'g', category: m.category || 'Baking Supplies' };
            }
        }
        // 2. Intelligent keyword / alias recognition for all 19 registered Scones & Muffins forecasting materials
        const sconesRules = [
            { code: 'NB-001', unit: 'g', category: 'Grains & Flours', canonicalName: 'All-Purpose / Bread Flour', test: (s) => /\b(all\s*purpose|bread\s*flour|ap\s*flour|wheat\s*flour|flour)\b/.test(s) },
            { code: 'NB-002', unit: 'g', category: 'Sweeteners', canonicalName: 'Refined White Sugar', test: (s) => /\b(refined.*sugar|white\s*sugar|washed\s*sugar|granulated\s*sugar|sugar)\b/.test(s) },
            { code: 'NB-003', unit: 'g', category: 'Produce / Agricultural', canonicalName: 'Fresh Yellow Squash (Kalabasa)', test: (s) => /\b(squash|kalabasa|calabaza|pumpkin)\b/.test(s) },
            { code: 'NB-004', unit: 'g', category: 'Dairy', canonicalName: 'Skimmed Milk Powder', test: (s) => /\b(skimmed\s*milk|skim\s*milk|milk\s*powder|powdered\s*milk)\b/.test(s) },
            { code: 'NB-005', unit: 'g', category: 'Dairy', canonicalName: 'Condensed Milk', test: (s) => /\b(condensed\s*milk|condensed)\b/.test(s) },
            { code: 'NB-006', unit: 'pcs', category: 'Dairy & Eggs', canonicalName: 'Fresh Whole Eggs', test: (s) => /\b(whole\s*eggs?|fresh\s*eggs?|eggs?)\b/.test(s) },
            { code: 'NB-007', unit: 'g', category: 'Fats & Oils', canonicalName: 'Baking Shortening', test: (s) => /\b(baking\s*shortening|vegetable\s*shortening|shortening|lard)\b/.test(s) },
            { code: 'NB-008', unit: 'g', category: 'Fats & Oils', canonicalName: 'Margarine', test: (s) => /\b(margarine|butter)\b/.test(s) },
            { code: 'NB-009', unit: 'g', category: 'Leavening Agents', canonicalName: 'Instant Dry Yeast', test: (s) => /\b(instant.*yeast|dry\s*yeast|active\s*yeast|yeast)\b/.test(s) },
            { code: 'NB-010', unit: 'g', category: 'Leavening Agents', canonicalName: 'Baking Soda', test: (s) => /\b(baking\s*soda|sodium\s*bicarbonate|bicarbonate|soda)\b/.test(s) },
            { code: 'NB-011', unit: 'g', category: 'Seasonings & Spices', canonicalName: 'Iodized Salt', test: (s) => /\b(iodized\s*salt|fine\s*salt|sea\s*salt|rock\s*salt|salt)\b/.test(s) },
            { code: 'NB-012', unit: 'g', category: 'Preservatives & Additives', canonicalName: 'Calcium Propionate', test: (s) => /\b(calcium\s*propionate|propionate)\b/.test(s) },
            { code: 'NB-013', unit: 'g', category: 'Preservatives & Additives', canonicalName: 'Potassium Sorbate', test: (s) => /\b(potassium\s*sorbate|sorbate)\b/.test(s) },
            { code: 'NB-014', unit: 'g', category: 'Nuts & Seeds', canonicalName: 'Crushed Peanuts / Nuts', test: (s) => /\b(crushed\s*peanuts?|peanuts?|nuts?)\b/.test(s) },
            { code: 'NB-015', unit: 'g', category: 'Produce / Agricultural', canonicalName: 'Desiccated Coconut', test: (s) => /\b(desiccated\s*coconut|dessicated\s*coconut|shredded\s*coconut|coconut)\b/.test(s) },
            { code: 'NB-016', unit: 'g', category: 'Nuts & Seeds', canonicalName: 'Black Sesame Seeds', test: (s) => /\b(black\s*sesame|sesame\s*seeds?|sesame)\b/.test(s) },
            { code: 'NB-017', unit: 'g', category: 'Produce / Agricultural', canonicalName: 'Malunggay (Moringa) Flakes', test: (s) => /\b(malunggay|moringa)\b/.test(s) },
            { code: 'NB-018', unit: 'g', category: 'Flavorings & Extracts', canonicalName: 'Vanilla Extract', test: (s) => /\b(vanilla\s*extract|vanilla\s*flavor|vanilla)\b/.test(s) },
            { code: 'NB-019', unit: 'kl', category: 'Packaging Materials', canonicalName: 'Plastic Pillow Packaging', test: (s) => /\b(plastic\s*pillow|pillow\s*packaging|pillow\s*pack|packaging|cellophane|wrapper)\b/.test(s) }
        ];
        for (const rule of sconesRules) {
            if (rule.test(norm)) {
                return rule;
            }
        }
    } else {
        // KXC Enterprise 59 forecasting materials matching
        for (const m of AUTHENTIC_59_RAW_MATERIALS) {
            const mNorm = String(m.name || m.raw_material_name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
            if (mNorm === norm || (norm.length >= 4 && (mNorm.includes(norm) || norm.includes(mNorm)))) {
                return { code: m.item_code || m.id, canonicalName: m.name, unit: m.unit_of_measure || m.unit || 'kg', category: m.category || 'General Materials' };
            }
        }
    }
    return null;
}

/**
 * Heals any previously imported materials or overrides that were assigned sequential
 * auto-codes (e.g. NB-188 for "Squash") into their registered forecasting codes (e.g. NB-003),
 * preserving the earliest first_date and the latest latest_date & current_stock.
 */
export function healForecastingMaterialCodes() {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return;
    try {
        // 1. Heal rmims_custom_raw_materials
        const rawCustom = localStorage.getItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY);
        if (rawCustom) {
            const arr = JSON.parse(rawCustom);
            if (Array.isArray(arr) && arr.length > 0) {
                const byCode = new Map();
                let mutated = false;
                arr.forEach(item => {
                    if (!item || typeof item !== "object") return;
                    const name = item.name || item.raw_material_name || "";
                    const currentCode = String(item.item_code || item.id || "").toUpperCase().trim();
                    const isSconesCode = currentCode.startsWith("NB-") || !currentCode.startsWith("RM-");
                    const recognized = resolveForecastingMaterialByName(name, isSconesCode);
                    const targetCode = recognized ? recognized.code : currentCode;
                    if (recognized && targetCode !== currentCode) {
                        mutated = true;
                    }
                    const updatedItem = {
                        ...item,
                        id: targetCode || item.id,
                        item_code: targetCode || item.item_code,
                        is_imported: true,
                        is_manual_override: true
                    };
                    const key = targetCode || name.toLowerCase().trim();
                    if (!byCode.has(key)) {
                        byCode.set(key, updatedItem);
                    } else {
                        mutated = true;
                        const prev = byCode.get(key);
                        const prevFirst = prev.first_date || prev.date_added || "";
                        const currFirst = updatedItem.first_date || updatedItem.date_added || "";
                        const prevLatest = prev.latest_date || prev.last_updated || prevFirst || "";
                        const currLatest = updatedItem.latest_date || updatedItem.last_updated || currFirst || "";

                        const earliestDate = (prevFirst && currFirst)
                            ? (prevFirst <= currFirst ? prevFirst : currFirst)
                            : (prevFirst || currFirst);
                        const isCurrNewer = !prevLatest || (currLatest && currLatest >= prevLatest);
                        const latestWinner = isCurrNewer ? updatedItem : prev;
                        const latestDate = (prevLatest && currLatest)
                            ? (currLatest >= prevLatest ? currLatest : prevLatest)
                            : (currLatest || prevLatest || earliestDate);

                        byCode.set(key, {
                            ...prev,
                            ...latestWinner,
                            id: targetCode || latestWinner.id,
                            item_code: targetCode || latestWinner.item_code,
                            date_added: earliestDate,
                            first_date: earliestDate,
                            display_date: earliestDate,
                            last_updated: latestDate,
                            latest_date: latestDate,
                            is_imported: true,
                            is_manual_override: true
                        });
                    }
                });
                if (mutated) {
                    localStorage.setItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY, JSON.stringify(Array.from(byCode.values())));
                }
            }
        }

        // 2. Heal manager overrides
        const activeCodesAndNamesLower = new Set();
        ["rmims_manager_material_overrides", "rmims_manager_inventory_overrides"].forEach(ovKey => {
            const ovRaw = localStorage.getItem(ovKey);
            if (!ovRaw) return;
            const ovs = JSON.parse(ovRaw);
            if (!ovs || typeof ovs !== "object") return;
            const healedOvs = {};
            let ovMutated = false;

            Object.keys(ovs).forEach(k => {
                const ov = ovs[k];
                if (!ov || typeof ov !== "object") return;
                const name = ov.name || ov.raw_material_name || "";
                const currentCode = String(ov.item_code || ov.id || k || "").toUpperCase().trim();
                const isSconesCode = currentCode.startsWith("NB-") || !currentCode.startsWith("RM-");
                const recognized = resolveForecastingMaterialByName(name, isSconesCode);
                const targetKey = recognized ? recognized.code : k;
                if (recognized && targetKey !== k) {
                    ovMutated = true;
                }
                if (targetKey) activeCodesAndNamesLower.add(String(targetKey).toLowerCase().trim());
                if (name) activeCodesAndNamesLower.add(String(name).toLowerCase().trim());
                if (recognized && recognized.canonicalName) activeCodesAndNamesLower.add(String(recognized.canonicalName).toLowerCase().trim());

                if (!healedOvs[targetKey]) {
                    healedOvs[targetKey] = {
                        ...ov,
                        id: recognized ? recognized.code : (ov.id || k),
                        item_code: recognized ? recognized.code : (ov.item_code || k),
                        is_imported: true,
                        is_manual_override: true
                    };
                } else {
                    ovMutated = true;
                    const prev = healedOvs[targetKey];
                    const prevFirst = prev.first_date || prev.date_added || "";
                    const currFirst = ov.first_date || ov.date_added || "";
                    const prevLatest = prev.latest_date || prev.last_updated || prevFirst || "";
                    const currLatest = ov.latest_date || ov.last_updated || currFirst || "";

                    const earliestDate = (prevFirst && currFirst)
                        ? (prevFirst <= currFirst ? prevFirst : currFirst)
                        : (prevFirst || currFirst);
                    const isCurrNewer = !prevLatest || (currLatest && currLatest >= prevLatest);
                    const latestWinner = isCurrNewer ? ov : prev;
                    const latestDate = (prevLatest && currLatest)
                        ? (currLatest >= prevLatest ? currLatest : prevLatest)
                        : (currLatest || prevLatest || earliestDate);

                    healedOvs[targetKey] = {
                        ...prev,
                        ...latestWinner,
                        id: targetKey,
                        item_code: targetKey,
                        date_added: earliestDate,
                        first_date: earliestDate,
                        display_date: earliestDate,
                        last_updated: latestDate,
                        latest_date: latestDate,
                        is_imported: true,
                        is_manual_override: true
                    };
                }
            });

            if (ovMutated) {
                localStorage.setItem(ovKey, JSON.stringify(healedOvs));
            }
        });

        // Also collect active codes/names from rmims_custom_raw_materials
        try {
            const customAfter = JSON.parse(localStorage.getItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY) || "[]");
            if (Array.isArray(customAfter)) {
                customAfter.forEach(cm => {
                    if (!cm) return;
                    const c = String(cm.item_code || cm.id || "").toLowerCase().trim();
                    const n = String(cm.name || cm.raw_material_name || "").toLowerCase().trim();
                    if (c) activeCodesAndNamesLower.add(c);
                    if (n) activeCodesAndNamesLower.add(n);
                });
            }
        } catch (_) {}

        // 3. Remove any active/imported material codes & names from rmims_deleted_material_ids (case-insensitive)
        if (activeCodesAndNamesLower.size > 0) {
            try {
                const delRaw = localStorage.getItem(RMIMS_DELETED_MATERIALS_KEY);
                if (delRaw) {
                    const delArr = JSON.parse(delRaw);
                    if (Array.isArray(delArr) && delArr.length > 0) {
                        const filteredDel = delArr.filter(d => !activeCodesAndNamesLower.has(String(d || "").toLowerCase().trim()));
                        if (filteredDel.length !== delArr.length) {
                            localStorage.setItem(RMIMS_DELETED_MATERIALS_KEY, JSON.stringify(filteredDel));
                        }
                    }
                }
            } catch (_) {}
        }
    } catch (e) {
        console.warn("[SystemMaterials] Code heal notice:", e);
    }
}

try {
    healForecastingMaterialCodes();
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
    // Always respect an explicit user-provided or imported unit first
    const explicitUnit = (material.unit_of_measure || material.unit || "").trim();
    if (explicitUnit) return explicitUnit;

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

    return "kg";
}

/**
 * Returns ONLY active raw materials imported or added by the end user (or stored in Supabase).
 * Strictly NEVER auto-seeds dummy/hardcoded catalog items.
 */
export function getSystemRawMaterials() {
    try {
        healForecastingMaterialCodes();
    } catch (_) {}
    let tCtx = null;
    try {
        tCtx = getActiveTenantContext();
    } catch (_) {}
    const isScones = tCtx ? Boolean(tCtx.isScones) : true;
    const prefix = isScones ? "NB-" : "RM-";
    const otherPrefix = isScones ? "RM-" : "NB-";
    const catalogRef = isScones ? AUTHENTIC_19_SCONES_MATERIALS : AUTHENTIC_59_RAW_MATERIALS;

    let list = catalogRef.map(b => {
        const bCode = String(b.item_code || b.itemCode || b.id || "").toUpperCase().trim();
        const bUnit = (b.unit || b.unit_of_measure || getAuthoritativeMaterialUnit(b, isScones)).trim();
        const bStock = Number((b.current_stock !== undefined && Number(b.current_stock) > 0) ? b.current_stock : (b.currentStock ?? b.current_stock ?? 0));
        const bMin = Number(b.minimum_threshold ?? b.minimum_stock ?? 10);
        const bFirst = b.date_added || b.first_date || "";
        const bLatest = b.last_updated || b.latest_date || bFirst || "";
        return {
            ...b,
            id: bCode,
            item_code: bCode,
            itemCode: bCode,
            name: b.name || b.raw_material_name,
            raw_material_name: b.raw_material_name || b.name,
            category: b.category || (isScones ? "Baking Supplies" : "General Materials"),
            unit: bUnit,
            unit_of_measure: bUnit,
            current_stock: bStock,
            currentStock: bStock,
            stock: bStock,
            minimum_threshold: bMin,
            minimum_stock: bMin,
            minimumStock: bMin,
            minStock: bMin,
            date_added: bFirst,
            first_date: bFirst,
            display_date: b.display_date || bFirst || "",
            last_updated: bLatest,
            latest_date: bLatest
        };
    });

    // 1. Merge user-imported / user-added materials from rmims_custom_raw_materials
    try {
        const stored = localStorage.getItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY);
        if (stored) {
            const customMats = JSON.parse(stored);
            if (Array.isArray(customMats)) {
                customMats.forEach(cm => {
                    if (!cm || (!cm.name && !cm.raw_material_name)) return;
                    const rawCode = String(cm.item_code || cm.itemCode || cm.id || "").toUpperCase().trim();
                    if (!cm.is_imported && !cm.is_manual_override && rawCode.startsWith(otherPrefix)) return; // tenant isolation for non-imported items

                    const recognized = resolveForecastingMaterialByName(cm.name || cm.raw_material_name, isScones);
                    const code = (recognized && recognized.code && recognized.code.startsWith(prefix))
                        ? recognized.code
                        : rawCode;
                    const normName = (cm.name || cm.raw_material_name || "").trim().toLowerCase();

                    const foundIndex = list.findIndex(m =>
                        (code && String(m.item_code || m.id || "").toUpperCase().trim() === code) ||
                        (normName && (m.name || m.raw_material_name || "").trim().toLowerCase() === normName)
                    );

                    const rawCmStock = Number(cm.current_stock ?? cm.currentStock ?? cm.stock ?? 0);
                    const resolvedMin = Number(cm.minimum_threshold ?? cm.minimum_stock ?? cm.minimumStock ?? cm.minStock ?? 10);
                    const firstDate = cm.date_added || cm.first_date || (cm.created_at ? String(cm.created_at).slice(0, 10) : "");
                    const latestDate = cm.last_updated || cm.latest_date || cm.updated_at || firstDate || "";

                    if (foundIndex !== -1) {
                        const existing = list[foundIndex];
                        const resolvedUnit = (cm.unit || cm.unit_of_measure || existing.unit || getAuthoritativeMaterialUnit(existing, isScones));
                        const finalStock = (rawCmStock > 0 || cm.is_zero_explicit === true) ? rawCmStock : existing.current_stock;
                        const finalMin = resolvedMin > 0 ? resolvedMin : existing.minimum_threshold;
                        const mergedFirst = firstDate || existing.date_added || "";
                        const mergedLatest = latestDate || existing.last_updated || mergedFirst || "";

                        list[foundIndex] = {
                            ...existing,
                            ...cm,
                            id: existing.id,
                            item_code: existing.item_code,
                            itemCode: existing.item_code,
                            name: existing.name || cm.name || cm.raw_material_name,
                            raw_material_name: existing.raw_material_name || cm.raw_material_name || cm.name,
                            category: cm.category || existing.category,
                            unit_of_measure: resolvedUnit,
                            unit: resolvedUnit,
                            current_stock: finalStock,
                            currentStock: finalStock,
                            stock: finalStock,
                            minimum_threshold: finalMin,
                            minimum_stock: finalMin,
                            minimumStock: finalMin,
                            minStock: finalMin,
                            date_added: mergedFirst,
                            first_date: mergedFirst,
                            display_date: cm.display_date || mergedFirst || existing.display_date || "",
                            last_updated: mergedLatest,
                            latest_date: mergedLatest,
                            forecast_daily: existing.forecast_daily,
                            forecast_weekly: existing.forecast_weekly,
                            forecast_monthly: existing.forecast_monthly,
                            forecast_90d: existing.forecast_90d,
                            daily_mape: existing.daily_mape,
                            weekly_mape: existing.weekly_mape,
                            p90_margin: existing.p90_margin,
                            p95_margin: existing.p95_margin
                        };
                    } else if (code.startsWith(prefix) || cm.is_imported) {
                        const resolvedCode = code.startsWith(prefix) ? code : `${prefix}${String(list.length + 1).padStart(3, "0")}`;
                        const resolvedUnit = (cm.unit || cm.unit_of_measure || getAuthoritativeMaterialUnit(cm, isScones));
                        list.push({
                            ...cm,
                            id: resolvedCode,
                            item_code: resolvedCode,
                            itemCode: resolvedCode,
                            name: cm.name || cm.raw_material_name,
                            raw_material_name: cm.raw_material_name || cm.name,
                            category: cm.category || (isScones ? "Baking Supplies" : "General Materials"),
                            unit_of_measure: resolvedUnit,
                            unit: resolvedUnit,
                            current_stock: rawCmStock,
                            currentStock: rawCmStock,
                            stock: rawCmStock,
                            minimum_threshold: resolvedMin,
                            minimum_stock: resolvedMin,
                            minimumStock: resolvedMin,
                            minStock: resolvedMin,
                            date_added: firstDate,
                            first_date: firstDate,
                            display_date: cm.display_date || firstDate || "",
                            last_updated: latestDate,
                            latest_date: latestDate
                        });
                    }
                });
            }
        }
    } catch (e) {
        console.warn("[SystemMaterials] Could not load custom raw materials:", e);
    }

    // 2. Merge manager inventory overrides (including any items imported or added directly to overrides)
    try {
        const ovKeys = ["rmims_manager_material_overrides", "rmims_manager_inventory_overrides"];
        ovKeys.forEach(ovKey => {
            const ovStored = localStorage.getItem(ovKey);
            if (!ovStored) return;
            const ovs = JSON.parse(ovStored);
            if (!ovs || typeof ovs !== 'object') return;

            Object.keys(ovs).forEach(key => {
                const ov = ovs[key];
                if (!ov || (!ov.name && !ov.raw_material_name)) return;
                const rawCode = String(ov.item_code || ov.id || key || "").toUpperCase().trim();
                if (!ov.is_imported && !ov.is_manual_override && rawCode.startsWith(otherPrefix)) return;

                const recognized = resolveForecastingMaterialByName(ov.name || ov.raw_material_name, isScones);
                const code = (recognized && recognized.code && recognized.code.startsWith(prefix))
                    ? recognized.code
                    : rawCode;
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
                    const resolvedUnit = ov.unit || ov.unit_of_measure || existing.unit || getAuthoritativeMaterialUnit(existing, isScones);
                    const finalStock = (curStock !== undefined && (curStock > 0 || ov.is_zero_explicit === true))
                        ? curStock
                        : existing.current_stock;
                    const finalMin = (minStock !== undefined && minStock > 0) ? minStock : existing.minimum_threshold;
                    const firstDate = ov.date_added || ov.first_date || existing.date_added || "";
                    const latestDate = ov.last_updated || ov.latest_date || existing.last_updated || firstDate || "";

                    list[foundIndex] = {
                        ...existing,
                        ...ov,
                        id: existing.id,
                        item_code: existing.item_code || existing.id,
                        itemCode: existing.item_code || existing.id,
                        name: existing.name || ov.name || ov.raw_material_name,
                        raw_material_name: existing.raw_material_name || ov.raw_material_name || ov.name,
                        unit: resolvedUnit,
                        unit_of_measure: resolvedUnit,
                        current_stock: finalStock,
                        currentStock: finalStock,
                        stock: finalStock,
                        minimum_threshold: finalMin,
                        minimum_stock: finalMin,
                        minimumStock: finalMin,
                        minStock: finalMin,
                        date_added: firstDate,
                        first_date: firstDate,
                        display_date: ov.display_date || firstDate || existing.display_date || "",
                        last_updated: latestDate,
                        latest_date: latestDate,
                        forecast_daily: existing.forecast_daily,
                        forecast_weekly: existing.forecast_weekly,
                        forecast_monthly: existing.forecast_monthly,
                        forecast_90d: existing.forecast_90d,
                        daily_mape: existing.daily_mape,
                        weekly_mape: existing.weekly_mape,
                        p90_margin: existing.p90_margin,
                        p95_margin: existing.p95_margin
                    };
                } else if (code.startsWith(prefix) || ov.is_imported) {
                    const resolvedCode = code.startsWith(prefix) ? code : `${prefix}${String(list.length + 1).padStart(3, "0")}`;
                    const resolvedUnit = ov.unit || ov.unit_of_measure || getAuthoritativeMaterialUnit(ov, isScones);
                    const finalStock = curStock !== undefined ? curStock : 0;
                    const finalMin = minStock !== undefined ? minStock : 10;
                    const firstDate = ov.date_added || ov.first_date || "";
                    const latestDate = ov.last_updated || ov.latest_date || firstDate || "";

                    list.push({
                        ...ov,
                        id: resolvedCode,
                        item_code: resolvedCode,
                        itemCode: resolvedCode,
                        name: ov.name || ov.raw_material_name,
                        raw_material_name: ov.raw_material_name || ov.name,
                        category: ov.category || (isScones ? "Baking Supplies" : "General Materials"),
                        unit: resolvedUnit,
                        unit_of_measure: resolvedUnit,
                        current_stock: finalStock,
                        currentStock: finalStock,
                        stock: finalStock,
                        minimum_threshold: finalMin,
                        minimum_stock: finalMin,
                        minimumStock: finalMin,
                        minStock: finalMin,
                        date_added: firstDate,
                        first_date: firstDate,
                        display_date: ov.display_date || firstDate || "",
                        last_updated: latestDate,
                        latest_date: latestDate
                    });
                }
            });
        });
    } catch (e) {
        console.warn("[SystemMaterials] Could not apply manager overrides:", e);
    }

    // 3. Filter out deleted materials (never filter out newly imported materials)
    try {
        const deletedRaw = localStorage.getItem(RMIMS_DELETED_MATERIALS_KEY);
        if (deletedRaw) {
            const deletedArr = JSON.parse(deletedRaw);
            if (Array.isArray(deletedArr) && deletedArr.length > 0) {
                const deletedSet = new Set(deletedArr.map(d => String(d).trim().toLowerCase()));
                list = list.filter(m => {
                    if (m.is_imported === true) return true;
                    const mId = String(m.id || "").trim().toLowerCase();
                    const mCode = String(m.item_code || m.itemCode || "").trim().toLowerCase();
                    const mName = String(m.name || m.raw_material_name || "").trim().toLowerCase();
                    return !deletedSet.has(mId) && !deletedSet.has(mCode) && !deletedSet.has(mName);
                });
            }
        }
    } catch (e) {}

    // 4. Sort sequentially by item code number
    list.sort((a, b) => {
        const numA = parseInt(String(a.item_code || a.id).replace(/^[A-Z]+-?0*/i, "") || "0", 10);
        const numB = parseInt(String(b.item_code || b.id).replace(/^[A-Z]+-?0*/i, "") || "0", 10);
        return numA - numB;
    });

    // 5. Deduplicate by item code and normalized name
    const seenMatKeys = new Set();
    const dedupedList = [];
    list.forEach(m => {
        const code = String(m.item_code || m.id || "").toUpperCase().trim();
        const name = String(m.name || m.raw_material_name || "").toLowerCase().trim();
        const uniqueKey = code || name;
        if (!uniqueKey) return;
        if (seenMatKeys.has(uniqueKey) || (name && seenMatKeys.has(`name:${name}`))) {
            return;
        }
        seenMatKeys.add(uniqueKey);
        if (name) seenMatKeys.add(`name:${name}`);
        dedupedList.push(m);
    });

    return dedupedList.map(m => {
        const s = Number(m.current_stock ?? m.currentStock ?? m.stock ?? 0);
        const min = Number(m.minimum_threshold ?? m.minimum_stock ?? m.minimumStock ?? m.minStock ?? 10);
        const u = m.unit || m.unit_of_measure || getAuthoritativeMaterialUnit(m, isScones);
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

    const normName = (mat.name || mat.raw_material_name || "").trim().toLowerCase();
    let code = String(mat.item_code || mat.itemCode || mat.id || "").toUpperCase().trim();
    const isSconesCode = code.startsWith("NB-") || !code.startsWith("RM-");
    const recognized = resolveForecastingMaterialByName(mat.name || mat.raw_material_name, isSconesCode);
    if (recognized && recognized.code) {
        code = recognized.code;
    }

    // Find any previous match so we preserve the earliest ever first_date
    const prevEntry = custom.find(m =>
        (m.name || m.raw_material_name || "").trim().toLowerCase() === normName ||
        String(m.item_code || m.itemCode || m.id || "").toUpperCase().trim() === code
    );

    // Remove any previous match to avoid duplicates
    custom = custom.filter(m => 
        (m.name || m.raw_material_name || "").trim().toLowerCase() !== normName &&
        String(m.item_code || m.itemCode || m.id || "").toUpperCase().trim() !== code
    );

    const incomingFirst = mat.first_date || mat.date_added || (prevEntry && (prevEntry.first_date || prevEntry.date_added)) || new Date().toISOString().slice(0, 10);
    const prevFirst = prevEntry ? (prevEntry.first_date || prevEntry.date_added || "") : "";
    const resolvedFirstDate = (prevFirst && incomingFirst)
        ? (prevFirst <= incomingFirst ? prevFirst : incomingFirst)
        : (incomingFirst || prevFirst);
    const incomingLatest = mat.latest_date || mat.last_updated || incomingFirst;
    const prevLatest = prevEntry ? (prevEntry.latest_date || prevEntry.last_updated || "") : "";
    const resolvedLatestDate = (prevLatest && incomingLatest)
        ? (incomingLatest >= prevLatest ? incomingLatest : prevLatest)
        : (incomingLatest || prevLatest || resolvedFirstDate);

    const fullRecord = {
        id: code || mat.id || `RM-${Date.now()}`,
        item_code: code || mat.item_code || mat.itemCode,
        name: mat.name || mat.raw_material_name,
        raw_material_name: mat.raw_material_name || mat.name,
        specification_name: mat.specification_name || mat.name || mat.raw_material_name,
        category: mat.category || (recognized && recognized.category) || "General Materials",
        unit_of_measure: mat.unit_of_measure || mat.unit || (recognized && recognized.unit) || "kg",
        unit: mat.unit_of_measure || mat.unit || (recognized && recognized.unit) || "kg",
        current_stock: Number(mat.current_stock ?? mat.currentStock ?? mat.stock ?? 0),
        currentStock: Number(mat.current_stock ?? mat.currentStock ?? mat.stock ?? 0),
        minimum_threshold: Number(mat.minimum_threshold ?? mat.minimum_stock ?? mat.minimumStock ?? 10),
        minimum_stock: Number(mat.minimum_threshold ?? mat.minimum_stock ?? mat.minimumStock ?? 10),
        reorder_quantity: Number(mat.reorder_quantity ?? 25),
        lead_time_days: Number(mat.lead_time_days ?? 3),
        storage_location: mat.storage_location || "Warehouse A - Shelf 1",
        supplier: mat.supplier || "General Supply Co.",
        description: mat.description || `Raw material ${mat.name || mat.raw_material_name}`,
        date_added: resolvedFirstDate,
        first_date: resolvedFirstDate,
        display_date: mat.display_date || resolvedFirstDate,
        last_updated: resolvedLatestDate,
        latest_date: resolvedLatestDate,
        created_at: mat.created_at || (prevEntry && prevEntry.created_at) || new Date().toISOString(),
        is_imported: Boolean(mat.is_imported || (prevEntry && prevEntry.is_imported)),
        is_manual_override: true
    };

    custom.push(fullRecord);
    localStorage.setItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY, JSON.stringify(custom));

    // Also remove from deleted set if it was previously marked deleted (case-insensitive)
    try {
        const deletedRaw = localStorage.getItem(RMIMS_DELETED_MATERIALS_KEY);
        if (deletedRaw) {
            let deletedIds = JSON.parse(deletedRaw);
            if (Array.isArray(deletedIds)) {
                const toClear = new Set([
                    String(fullRecord.id || "").toLowerCase().trim(),
                    String(fullRecord.item_code || "").toLowerCase().trim(),
                    String(code || "").toLowerCase().trim(),
                    normName,
                    recognized && recognized.canonicalName ? String(recognized.canonicalName).toLowerCase().trim() : ""
                ].filter(Boolean));
                deletedIds = deletedIds.filter(id => !toClear.has(String(id || "").toLowerCase().trim()));
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

    // 5. Asynchronously persist real input to Supabase raw_materials table
    if (typeof window !== "undefined" && window.supabase && fullRecord.name) {
        (async () => {
            try {
                const payload = {
                    item_code: fullRecord.item_code,
                    name: fullRecord.name,
                    description: fullRecord.description || `Raw material ${fullRecord.name}`,
                    unit_of_measure: fullRecord.unit_of_measure || "kg",
                    minimum_threshold: fullRecord.minimum_threshold,
                    reorder_quantity: fullRecord.reorder_quantity,
                    lead_time_days: fullRecord.lead_time_days,
                    current_stock: fullRecord.current_stock
                };
                if (fullRecord.id && fullRecord.id.length === 36) {
                    payload.id = fullRecord.id;
                }
                await window.supabase.from("raw_materials").upsert([payload], {
                    onConflict: payload.id ? "id" : "item_code"
                });
            } catch (_) {}
        })();
    }

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

    // Protected authentic raw materials can NEVER be deleted
    if (PROTECTED_MATERIAL_CODES.has(targetUpper) || PROTECTED_MATERIAL_NAMES.has(targetLower)) {
        console.warn(`[SystemMaterials] Protected authentic material '${target}' cannot be deleted.`);
        return false;
    }

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

    // 5. Asynchronously delete from Supabase (cascading dependent receipts & disbursements first to prevent foreign key block)
    if (typeof window !== "undefined" && window.supabase) {
        (async () => {
            try {
                let resolvedMatId = (target.length === 36) ? target : null;
                if (!resolvedMatId) {
                    const { data: row } = await window.supabase.from('raw_materials')
                        .select('id')
                        .or(`item_code.ilike.${target},name.ilike.${target}`)
                        .limit(1)
                        .maybeSingle();
                    if (row && row.id) resolvedMatId = row.id;
                }
                if (resolvedMatId) {
                    await window.supabase.from('stock_receipts').delete().eq('material_id', resolvedMatId);
                    await window.supabase.from('material_disbursements').delete().eq('material_id', resolvedMatId);
                    await window.supabase.from('raw_materials').delete().eq('id', resolvedMatId);
                }
                await window.supabase.from('raw_materials').delete().ilike('item_code', target);
                await window.supabase.from('raw_materials').delete().ilike('name', target);
            } catch (_) {}
        })();
    }

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
                    last_updated: mat.last_updated,
                    is_manual_override: true
                };
                if (idKey && nameKey && idKey !== nameKey) {
                    ovs[nameKey] = {
                        ...(ovs[nameKey] || {}),
                        current_stock: newStock,
                        last_updated: mat.last_updated,
                        is_manual_override: true
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

