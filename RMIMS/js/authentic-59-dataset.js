// js/authentic-59-dataset.js
// Authoritative 59 Raw Materials Master Dataset (Authentic Natural Operations, Dynamic Out-of-Stock Waves, ~80% Good/Stable, ~16% Low, ~4% Out)

export const RMIMS_CUSTOM_RAW_MATERIALS_KEY = "rmims_custom_raw_materials";
export const RMIMS_CUSTOM_RECEIPTS_KEY = "rmims_custom_receipts";
export const RMIMS_CUSTOM_DISBURSEMENTS_KEY = "rmims_custom_disbursements";
export const RMIMS_DELETED_MATERIALS_KEY = "rmims_deleted_material_ids";

export const RMIMS_WIPE_BASELINE_MATERIALS_KEY = "rmims_wipe_baseline_materials";

export function getSystemRawMaterials() {
    const isWiped = typeof localStorage !== 'undefined' 
        ? (localStorage.getItem(RMIMS_WIPE_BASELINE_MATERIALS_KEY) !== 'false') 
        : true;

    let list = AUTHENTIC_59_RAW_MATERIALS.map(m => ({ ...m }));
    
    // Merge custom materials added by Admin / System
    try {
        const stored = localStorage.getItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY);
        if (stored) {
            const customMats = JSON.parse(stored);
            if (Array.isArray(customMats)) {
                customMats.forEach(cm => {
                    const normName = (cm.name || cm.raw_material_name || "").trim().toLowerCase();
                    const code = String(cm.item_code || cm.itemCode || cm.id || "").toUpperCase().trim();
                    const exists = list.some(m => 
                        (m.name || m.raw_material_name || "").trim().toLowerCase() === normName ||
                        String(m.item_code || m.itemCode || m.id || "").toUpperCase().trim() === code
                    );
                    if (!exists) {
                        list.push({
                            id: cm.id || code || `RM-${String(list.length + 1).padStart(3, "0")}`,
                            item_code: cm.item_code || cm.itemCode || code,
                            name: cm.name || cm.raw_material_name,
                            raw_material_name: cm.name || cm.raw_material_name,
                            category: cm.category || "General Materials",
                            unit_of_measure: cm.unit_of_measure || cm.unit || "kg",
                            unit: cm.unit_of_measure || cm.unit || "kg",
                            current_stock: Number(cm.current_stock ?? cm.currentStock ?? 0),
                            minimum_threshold: Number(cm.minimum_threshold ?? cm.minimum_stock ?? cm.minimumStock ?? 0),
                            minimum_stock: Number(cm.minimum_threshold ?? cm.minimum_stock ?? cm.minimumStock ?? 0),
                            reorder_quantity: cm.reorder_quantity != null ? Number(cm.reorder_quantity) : null,
                            lead_time_days: cm.lead_time_days != null ? Number(cm.lead_time_days) : null,
                            description: cm.description || `Raw material ${cm.name || cm.raw_material_name}`,
                            created_at: cm.created_at || new Date().toISOString()
                        });
                    }
                });
            }
        }
    } catch (e) {
        console.warn("Could not load custom raw materials from storage:", e);
    }

    // Filter out deleted materials (safeguarding all 59 authentic baseline materials)
    try {
        const deletedRaw = localStorage.getItem(RMIMS_DELETED_MATERIALS_KEY);
        if (deletedRaw) {
            const deletedIds = new Set(JSON.parse(deletedRaw));
            if (deletedIds.size > 0) {
                list = list.filter(m => {
                    const code = String(m.item_code || m.id || '').toUpperCase();
                    const num = parseInt(code.replace(/^RM-?0*/i, ''), 10);
                    if (code.startsWith('RM-') && num >= 1 && num <= 59) return true; // protected authentic
                    return !deletedIds.has(String(m.id)) && !deletedIds.has((m.name || "").toLowerCase().trim());
                });
            }
        }
    } catch (e) {}

    return list;
}

export function saveCustomRawMaterial(mat) {
    let custom = [];
    try {
        const stored = localStorage.getItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY);
        if (stored) custom = JSON.parse(stored);
        if (!Array.isArray(custom)) custom = [];
    } catch (e) { custom = []; }

    const normName = (mat.name || "").trim().toLowerCase();
    const code = String(mat.item_code || mat.itemCode || mat.id || "").toUpperCase().trim();

    custom = custom.filter(m => 
        (m.name || "").trim().toLowerCase() !== normName &&
        String(m.item_code || m.itemCode || "").toUpperCase().trim() !== code
    );
    custom.push(mat);

    localStorage.setItem(RMIMS_CUSTOM_RAW_MATERIALS_KEY, JSON.stringify(custom));
    localStorage.setItem("rmims_sync_event", JSON.stringify({ time: Date.now(), action: "add_material", material: mat }));
    localStorage.setItem("rmims_inventory_updated", String(Date.now()));
    window.dispatchEvent(new Event("storage"));
    return custom;
}

export function getSystemNextItemCode(materialsList) {
    const mats = materialsList || getSystemRawMaterials();
    const existingNums = mats
        .map(m => {
            const codeStr = String(m.item_code || m.itemCode || m.id || "");
            const match = codeStr.match(/^RM-?0*(\d+)$/i);
            return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => n > 0);

    const maxNum = existingNums.length ? Math.max(...existingNums) : 59;
    let nextNum = maxNum + 1;
    let nextCode = `RM-${String(nextNum).padStart(3, "0")}`;

    while (mats.some(m => {
        const c = String(m.item_code || m.itemCode || m.id || "").toUpperCase();
        return c === nextCode.toUpperCase() || c === `RM${String(nextNum).padStart(3, "0")}`.toUpperCase();
    })) {
        nextNum++;
        nextCode = `RM-${String(nextNum).padStart(3, "0")}`;
    }

    return nextCode;
}


export const AUTHENTIC_FINISHED_PRODUCTS_CATALOG = [];


// KXC registered raw materials: IDENTITY ONLY (code, name, category, unit). No built-in figures.
export const AUTHENTIC_59_RAW_MATERIALS = [
  {
    "id": "RM-001",
    "item_code": "RM-001",
    "itemCode": "RM-001",
    "name": "Food Grade Sunset Yellow / Orange Dye",
    "raw_material_name": "Food Grade Sunset Yellow / Orange Dye",
    "category": "Additives & Colors",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-002",
    "item_code": "RM-002",
    "itemCode": "RM-002",
    "name": "Baking Powder",
    "raw_material_name": "Baking Powder",
    "category": "Baking Supplies",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-003",
    "item_code": "RM-003",
    "itemCode": "RM-003",
    "name": "Cream of Tartar",
    "raw_material_name": "Cream of Tartar",
    "category": "Baking Supplies",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-004",
    "item_code": "RM-004",
    "itemCode": "RM-004",
    "name": "Instant Dry Yeast",
    "raw_material_name": "Instant Dry Yeast",
    "category": "Baking Supplies",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-005",
    "item_code": "RM-005",
    "itemCode": "RM-005",
    "name": "Cane Vinegar",
    "raw_material_name": "Cane Vinegar",
    "category": "Condiments & Acids",
    "unit": "L",
    "unit_of_measure": "L"
  },
  {
    "id": "RM-006",
    "item_code": "RM-006",
    "itemCode": "RM-006",
    "name": "Soy Sauce",
    "raw_material_name": "Soy Sauce",
    "category": "Condiments & Acids",
    "unit": "L",
    "unit_of_measure": "L"
  },
  {
    "id": "RM-007",
    "item_code": "RM-007",
    "itemCode": "RM-007",
    "name": "Condensed Milk",
    "raw_material_name": "Condensed Milk",
    "category": "Dairy",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-008",
    "item_code": "RM-008",
    "itemCode": "RM-008",
    "name": "Evaporated Milk",
    "raw_material_name": "Evaporated Milk",
    "category": "Dairy",
    "unit": "L",
    "unit_of_measure": "L"
  },
  {
    "id": "RM-009",
    "item_code": "RM-009",
    "itemCode": "RM-009",
    "name": "Powdered Milk",
    "raw_material_name": "Powdered Milk",
    "category": "Dairy",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-010",
    "item_code": "RM-010",
    "itemCode": "RM-010",
    "name": "Fresh Whole Egg Whites",
    "raw_material_name": "Fresh Whole Egg Whites",
    "category": "Dairy & Eggs",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-011",
    "item_code": "RM-011",
    "itemCode": "RM-011",
    "name": "Fresh Whole Eggs",
    "raw_material_name": "Fresh Whole Eggs",
    "category": "Dairy & Eggs",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-012",
    "item_code": "RM-012",
    "itemCode": "RM-012",
    "name": "All-Vegetable Shortening",
    "raw_material_name": "All-Vegetable Shortening",
    "category": "Dairy & Fats",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-013",
    "item_code": "RM-013",
    "itemCode": "RM-013",
    "name": "Baking Shortening",
    "raw_material_name": "Baking Shortening",
    "category": "Dairy & Fats",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-014",
    "item_code": "RM-014",
    "itemCode": "RM-014",
    "name": "Salted Creamery Butter",
    "raw_material_name": "Salted Creamery Butter",
    "category": "Dairy & Fats",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-015",
    "item_code": "RM-015",
    "itemCode": "RM-015",
    "name": "Seedless Raisins",
    "raw_material_name": "Seedless Raisins",
    "category": "Dry Goods",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-016",
    "item_code": "RM-016",
    "itemCode": "RM-016",
    "name": "Vanilla Extract",
    "raw_material_name": "Vanilla Extract",
    "category": "Flavorings & Extracts",
    "unit": "L",
    "unit_of_measure": "L"
  },
  {
    "id": "RM-017",
    "item_code": "RM-017",
    "itemCode": "RM-017",
    "name": "All-Purpose Wheat Flour",
    "raw_material_name": "All-Purpose Wheat Flour",
    "category": "Grains & Flours",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-018",
    "item_code": "RM-018",
    "itemCode": "RM-018",
    "name": "Cornstarch",
    "raw_material_name": "Cornstarch",
    "category": "Grains & Flours",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-019",
    "item_code": "RM-019",
    "itemCode": "RM-019",
    "name": "Glutinous Rice (Malagkit for Pinipig)",
    "raw_material_name": "Glutinous Rice (Malagkit for Pinipig)",
    "category": "Grains & Flours",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-020",
    "item_code": "RM-020",
    "itemCode": "RM-020",
    "name": "Hard Wheat Bread Flour",
    "raw_material_name": "Hard Wheat Bread Flour",
    "category": "Grains & Flours",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-021",
    "item_code": "RM-021",
    "itemCode": "RM-021",
    "name": "Purified Water",
    "raw_material_name": "Purified Water",
    "category": "Liquids",
    "unit": "L",
    "unit_of_measure": "L"
  },
  {
    "id": "RM-022",
    "item_code": "RM-022",
    "itemCode": "RM-022",
    "name": "Cleaned Chicken Crop (Butse)",
    "raw_material_name": "Cleaned Chicken Crop (Butse)",
    "category": "Meat & Poultry",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-023",
    "item_code": "RM-023",
    "itemCode": "RM-023",
    "name": "Pork Skin with Back Fat",
    "raw_material_name": "Pork Skin with Back Fat",
    "category": "Meat & Poultry",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-024",
    "item_code": "RM-024",
    "itemCode": "RM-024",
    "name": "Raw Shelled Peanuts",
    "raw_material_name": "Raw Shelled Peanuts",
    "category": "Nuts & Seeds",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-025",
    "item_code": "RM-025",
    "itemCode": "RM-025",
    "name": "Toasted Sesame Seeds",
    "raw_material_name": "Toasted Sesame Seeds",
    "category": "Nuts & Seeds",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-026",
    "item_code": "RM-026",
    "itemCode": "RM-026",
    "name": "Palm Cooking Oil",
    "raw_material_name": "Palm Cooking Oil",
    "category": "Oils & Fats",
    "unit": "L",
    "unit_of_measure": "L"
  },
  {
    "id": "RM-027",
    "item_code": "RM-027",
    "itemCode": "RM-027",
    "name": "Pure Pork Lard",
    "raw_material_name": "Pure Pork Lard",
    "category": "Oils & Fats",
    "unit": "L",
    "unit_of_measure": "L"
  },
  {
    "id": "RM-028",
    "item_code": "RM-028",
    "itemCode": "RM-028",
    "name": "Refined Peanut Oil",
    "raw_material_name": "Refined Peanut Oil",
    "category": "Oils & Fats",
    "unit": "L",
    "unit_of_measure": "L"
  },
  {
    "id": "RM-029",
    "item_code": "RM-029",
    "itemCode": "RM-029",
    "name": "Fresh Carrots",
    "raw_material_name": "Fresh Carrots",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-030",
    "item_code": "RM-030",
    "itemCode": "RM-030",
    "name": "Fresh Cassava Tubers",
    "raw_material_name": "Fresh Cassava Tubers",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-031",
    "item_code": "RM-031",
    "itemCode": "RM-031",
    "name": "Fresh Garlic",
    "raw_material_name": "Fresh Garlic",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-032",
    "item_code": "RM-032",
    "itemCode": "RM-032",
    "name": "Fresh Ginger",
    "raw_material_name": "Fresh Ginger",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-033",
    "item_code": "RM-033",
    "itemCode": "RM-033",
    "name": "Fresh Grated Coconut Meat",
    "raw_material_name": "Fresh Grated Coconut Meat",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-034",
    "item_code": "RM-034",
    "itemCode": "RM-034",
    "name": "Fresh Mature Coconut Meat",
    "raw_material_name": "Fresh Mature Coconut Meat",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-035",
    "item_code": "RM-035",
    "itemCode": "RM-035",
    "name": "Fresh Purple Yam Tubers",
    "raw_material_name": "Fresh Purple Yam Tubers",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-036",
    "item_code": "RM-036",
    "itemCode": "RM-036",
    "name": "Fresh Sweet Potato",
    "raw_material_name": "Fresh Sweet Potato",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-037",
    "item_code": "RM-037",
    "itemCode": "RM-037",
    "name": "Green Raw Papaya",
    "raw_material_name": "Green Raw Papaya",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-038",
    "item_code": "RM-038",
    "itemCode": "RM-038",
    "name": "Pandan Leaves",
    "raw_material_name": "Pandan Leaves",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-039",
    "item_code": "RM-039",
    "itemCode": "RM-039",
    "name": "Red Bell Peppers",
    "raw_material_name": "Red Bell Peppers",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-040",
    "item_code": "RM-040",
    "itemCode": "RM-040",
    "name": "Red Chili Peppers (Siling Labuyo)",
    "raw_material_name": "Red Chili Peppers (Siling Labuyo)",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-041",
    "item_code": "RM-041",
    "itemCode": "RM-041",
    "name": "Red Onions",
    "raw_material_name": "Red Onions",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-042",
    "item_code": "RM-042",
    "itemCode": "RM-042",
    "name": "Unripe Green Saba Bananas",
    "raw_material_name": "Unripe Green Saba Bananas",
    "category": "Produce / Agricultural",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-043",
    "item_code": "RM-043",
    "itemCode": "RM-043",
    "name": "Fresh Acetes Shrimp (Alamang)",
    "raw_material_name": "Fresh Acetes Shrimp (Alamang)",
    "category": "Seafood",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-044",
    "item_code": "RM-044",
    "itemCode": "RM-044",
    "name": "Fresh Bangus (Milkfish) Skin",
    "raw_material_name": "Fresh Bangus (Milkfish) Skin",
    "category": "Seafood",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-045",
    "item_code": "RM-045",
    "itemCode": "RM-045",
    "name": "Fresh Chiton Mollusk (Kibit)",
    "raw_material_name": "Fresh Chiton Mollusk (Kibit)",
    "category": "Seafood",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-046",
    "item_code": "RM-046",
    "itemCode": "RM-046",
    "name": "Fresh Kabasi Fish",
    "raw_material_name": "Fresh Kabasi Fish",
    "category": "Seafood",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-047",
    "item_code": "RM-047",
    "itemCode": "RM-047",
    "name": "Fresh Sapsap Fish",
    "raw_material_name": "Fresh Sapsap Fish",
    "category": "Seafood",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-048",
    "item_code": "RM-048",
    "itemCode": "RM-048",
    "name": "Cheese Seasoning Powder",
    "raw_material_name": "Cheese Seasoning Powder",
    "category": "Seasonings & Powders",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-049",
    "item_code": "RM-049",
    "itemCode": "RM-049",
    "name": "Coarse Rock Salt",
    "raw_material_name": "Coarse Rock Salt",
    "category": "Seasonings / Salts",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-050",
    "item_code": "RM-050",
    "itemCode": "RM-050",
    "name": "Iodized Salt",
    "raw_material_name": "Iodized Salt",
    "category": "Seasonings / Salts",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-051",
    "item_code": "RM-051",
    "itemCode": "RM-051",
    "name": "Dried Bay Leaves (Laurel)",
    "raw_material_name": "Dried Bay Leaves (Laurel)",
    "category": "Spices & Seasonings",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-052",
    "item_code": "RM-052",
    "itemCode": "RM-052",
    "name": "Dried Red Chili Flakes",
    "raw_material_name": "Dried Red Chili Flakes",
    "category": "Spices & Seasonings",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-053",
    "item_code": "RM-053",
    "itemCode": "RM-053",
    "name": "Garlic Powder",
    "raw_material_name": "Garlic Powder",
    "category": "Spices & Seasonings",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-054",
    "item_code": "RM-054",
    "itemCode": "RM-054",
    "name": "Ground Black Pepper",
    "raw_material_name": "Ground Black Pepper",
    "category": "Spices & Seasonings",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-055",
    "item_code": "RM-055",
    "itemCode": "RM-055",
    "name": "White Pepper Powder",
    "raw_material_name": "White Pepper Powder",
    "category": "Spices & Seasonings",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-056",
    "item_code": "RM-056",
    "itemCode": "RM-056",
    "name": "Whole Black Peppercorns",
    "raw_material_name": "Whole Black Peppercorns",
    "category": "Spices & Seasonings",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-057",
    "item_code": "RM-057",
    "itemCode": "RM-057",
    "name": "Muscovado Brown Sugar",
    "raw_material_name": "Muscovado Brown Sugar",
    "category": "Sweeteners",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-058",
    "item_code": "RM-058",
    "itemCode": "RM-058",
    "name": "Panutsa Cane Sugar",
    "raw_material_name": "Panutsa Cane Sugar",
    "category": "Sweeteners",
    "unit": "kg",
    "unit_of_measure": "kg"
  },
  {
    "id": "RM-059",
    "item_code": "RM-059",
    "itemCode": "RM-059",
    "name": "Refined White Sugar",
    "raw_material_name": "Refined White Sugar",
    "category": "Sweeteners",
    "unit": "kg",
    "unit_of_measure": "kg"
  }
];

export const AUTHENTIC_STOCK_RECEIPTS_6MONTHS = [];
export const AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS = [];
