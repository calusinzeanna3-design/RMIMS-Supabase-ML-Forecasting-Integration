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

    let list = isWiped ? [] : AUTHENTIC_59_RAW_MATERIALS.map(m => ({ ...m, current_stock: 0 }));
    
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
                            minimum_threshold: Number(cm.minimum_threshold ?? cm.minimum_stock ?? cm.minimumStock ?? 10),
                            minimum_stock: Number(cm.minimum_threshold ?? cm.minimum_stock ?? cm.minimumStock ?? 10),
                            reorder_quantity: Number(cm.reorder_quantity ?? 25),
                            lead_time_days: Number(cm.lead_time_days ?? 3),
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


export const AUTHENTIC_FINISHED_PRODUCTS_CATALOG = [
    {
        name: "Shing-a-ling",
        materialNames: ["All-Purpose Wheat Flour", "Purified Water", "Palm Cooking Oil", "Iodized Salt", "Food Grade Sunset Yellow / Orange Dye", "Garlic Powder"]
    },
    {
        name: "Sugar-Glazed Banana Chips",
        materialNames: ["Unripe Green Saba Bananas", "Refined White Sugar", "Palm Cooking Oil", "Iodized Salt", "Vanilla Extract"]
    },
    {
        name: "Crispy Cassava Chips",
        materialNames: ["Fresh Raw Cassava Tubers", "Palm Cooking Oil", "Iodized Salt", "Onion Powder", "Garlic Powder"]
    },
    {
        name: "Special Broas (Ladyfingers)",
        materialNames: ["All-Purpose Wheat Flour", "Refined White Sugar", "Fresh Whole Eggs", "Baking Powder", "Vanilla Extract"]
    },
    {
        name: "Camote Delight",
        materialNames: ["Sweet Potato (Camote)", "Condensed Milk", "Evaporated Milk", "Refined White Sugar", "Salted Butter"]
    },
    {
        name: "Classic Ensaymada",
        materialNames: ["All-Purpose Wheat Flour", "Instant Dry Yeast", "Refined White Sugar", "Salted Butter", "Fresh Whole Eggs", "Grated Cheddar Cheese"]
    },
    {
        name: "Pan de Sal Special",
        materialNames: ["All-Purpose Wheat Flour", "Instant Dry Yeast", "Refined White Sugar", "Iodized Salt", "Bread Crumbs", "Purified Water"]
    },
    {
        name: "Ube Halaya Pastries",
        materialNames: ["Purple Yam (Ube)", "Condensed Milk", "Evaporated Milk", "Salted Butter", "Refined White Sugar"]
    },
    {
        name: "Chocolate Crinkles",
        materialNames: ["All-Purpose Wheat Flour", "Pure Cocoa Powder", "Refined White Sugar", "Fresh Whole Eggs", "Confectioner's Powdered Sugar", "Baking Powder"]
    },
    {
        name: "Toasted Pastillas",
        materialNames: ["Powdered Full Cream Milk", "Condensed Milk", "Refined White Sugar", "Salted Butter"]
    },
    {
        name: "Coconut Macaroons",
        materialNames: ["Desiccated Coconut Flakes", "Condensed Milk", "Fresh Whole Eggs", "Refined White Sugar", "Salted Butter"]
    },
    {
        name: "Cheese Cupcakes",
        materialNames: ["All-Purpose Wheat Flour", "Grated Cheddar Cheese", "Condensed Milk", "Salted Butter", "Fresh Whole Eggs", "Baking Powder"]
    },
    {
        name: "Biscocho Crisps",
        materialNames: ["All-Purpose Wheat Flour", "Salted Butter", "Refined White Sugar", "Condensed Milk", "Vanilla Extract"]
    },
    {
        name: "Otap Sugar Biscuits",
        materialNames: ["All-Purpose Wheat Flour", "Refined White Sugar", "Palm Cooking Oil", "Iodized Salt", "Instant Dry Yeast"]
    },
    {
        name: "Yema Custard Tarts",
        materialNames: ["Fresh Whole Eggs", "Condensed Milk", "All-Purpose Wheat Flour", "Salted Butter", "Vanilla Extract"]
    },
    {
        name: "Polvoron Gold Selection",
        materialNames: ["All-Purpose Wheat Flour", "Powdered Full Cream Milk", "Refined White Sugar", "Salted Butter"]
    },
    {
        name: "Banana Loaf Cake",
        materialNames: ["Unripe Green Saba Bananas", "All-Purpose Wheat Flour", "Refined White Sugar", "Salted Butter", "Fresh Whole Eggs", "Baking Powder"]
    },
    {
        name: "Pianono Roll",
        materialNames: ["All-Purpose Wheat Flour", "Fresh Whole Eggs", "Refined White Sugar", "Salted Butter", "Vanilla Extract"]
    },
    {
        name: "Spanish Bread",
        materialNames: ["All-Purpose Wheat Flour", "Bread Crumbs", "Salted Butter", "Brown Sugar", "Instant Dry Yeast", "Purified Water"]
    },
    {
        name: "Butter Toast Crackers",
        materialNames: ["All-Purpose Wheat Flour", "Salted Butter", "Refined White Sugar", "Iodized Salt", "Instant Dry Yeast"]
    }
];

export const AUTHENTIC_59_RAW_MATERIALS = [
    {
        "id": "RM-001",
        "item_code": "RM-001",
        "name": "Food Grade Sunset Yellow / Orange Dye",
        "category": "Additives & Colors",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 10,
        "reorder_quantity": 25,
        "lead_time_days": 5,
        "description": "Authentic raw material Food Grade Sunset Yellow / Orange Dye (RM-001) for Additives & Colors",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-002",
        "item_code": "RM-002",
        "name": "Baking Powder",
        "category": "Baking Supplies",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 25,
        "reorder_quantity": 50,
        "lead_time_days": 3,
        "description": "Authentic raw material Baking Powder (RM-002) for Baking Supplies",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-003",
        "item_code": "RM-003",
        "name": "Cream of Tartar",
        "category": "Baking Supplies",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 10,
        "reorder_quantity": 20,
        "lead_time_days": 4,
        "description": "Authentic raw material Cream of Tartar (RM-003) for Baking Supplies",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-004",
        "item_code": "RM-004",
        "name": "Instant Dry Yeast",
        "category": "Baking Supplies",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 20,
        "reorder_quantity": 40,
        "lead_time_days": 3,
        "description": "Authentic raw material Instant Dry Yeast (RM-004) for Baking Supplies",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-005",
        "item_code": "RM-005",
        "name": "Cane Vinegar",
        "category": "Condiments & Acids",
        "unit_of_measure": "L",
        "current_stock": 0,
        "minimum_threshold": 80,
        "reorder_quantity": 150,
        "lead_time_days": 4,
        "description": "Authentic raw material Cane Vinegar (RM-005) for Condiments & Acids",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-006",
        "item_code": "RM-006",
        "name": "Soy Sauce",
        "category": "Condiments & Acids",
        "unit_of_measure": "L",
        "current_stock": 0,
        "minimum_threshold": 60,
        "reorder_quantity": 120,
        "lead_time_days": 4,
        "description": "Authentic raw material Soy Sauce (RM-006) for Condiments & Acids",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-007",
        "item_code": "RM-007",
        "name": "Condensed Milk",
        "category": "Dairy",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 150,
        "reorder_quantity": 300,
        "lead_time_days": 3,
        "description": "Authentic raw material Condensed Milk (RM-007) for Dairy",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-008",
        "item_code": "RM-008",
        "name": "Evaporated Milk",
        "category": "Dairy",
        "unit_of_measure": "L",
        "current_stock": 0,
        "minimum_threshold": 120,
        "reorder_quantity": 250,
        "lead_time_days": 3,
        "description": "Authentic raw material Evaporated Milk (RM-008) for Dairy",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-009",
        "item_code": "RM-009",
        "name": "Powdered Milk",
        "category": "Dairy",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 200,
        "reorder_quantity": 400,
        "lead_time_days": 4,
        "description": "Authentic raw material Powdered Milk (RM-009) for Dairy",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-010",
        "item_code": "RM-010",
        "name": "Fresh Whole Egg Whites",
        "category": "Dairy & Eggs",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 75,
        "reorder_quantity": 150,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Whole Egg Whites (RM-010) for Dairy & Eggs",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-011",
        "item_code": "RM-011",
        "name": "Fresh Whole Eggs",
        "category": "Dairy & Eggs",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 250,
        "reorder_quantity": 500,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Whole Eggs (RM-011) for Dairy & Eggs",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-012",
        "item_code": "RM-012",
        "name": "All-Vegetable Shortening",
        "category": "Dairy & Fats",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 100,
        "reorder_quantity": 200,
        "lead_time_days": 5,
        "description": "Authentic raw material All-Vegetable Shortening (RM-012) for Dairy & Fats",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-013",
        "item_code": "RM-013",
        "name": "Baking Shortening",
        "category": "Dairy & Fats",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 100,
        "reorder_quantity": 200,
        "lead_time_days": 5,
        "description": "Authentic raw material Baking Shortening (RM-013) for Dairy & Fats",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-014",
        "item_code": "RM-014",
        "name": "Salted Creamery Butter",
        "category": "Dairy & Fats",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 90,
        "reorder_quantity": 180,
        "lead_time_days": 4,
        "description": "Authentic raw material Salted Creamery Butter (RM-014) for Dairy & Fats",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-015",
        "item_code": "RM-015",
        "name": "Seedless Raisins",
        "category": "Dry Goods",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 40,
        "reorder_quantity": 80,
        "lead_time_days": 7,
        "description": "Authentic raw material Seedless Raisins (RM-015) for Dry Goods",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-016",
        "item_code": "RM-016",
        "name": "Vanilla Extract",
        "category": "Flavorings & Extracts",
        "unit_of_measure": "L",
        "current_stock": 0,
        "minimum_threshold": 10,
        "reorder_quantity": 20,
        "lead_time_days": 6,
        "description": "Authentic raw material Vanilla Extract (RM-016) for Flavorings & Extracts",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-017",
        "item_code": "RM-017",
        "name": "All-Purpose Wheat Flour",
        "category": "Grains & Flours",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 600,
        "reorder_quantity": 1200,
        "lead_time_days": 3,
        "description": "Authentic raw material All-Purpose Wheat Flour (RM-017) for Grains & Flours",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-018",
        "item_code": "RM-018",
        "name": "Cornstarch",
        "category": "Grains & Flours",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 150,
        "reorder_quantity": 300,
        "lead_time_days": 4,
        "description": "Authentic raw material Cornstarch (RM-018) for Grains & Flours",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-019",
        "item_code": "RM-019",
        "name": "Glutinous Rice (Malagkit for Pinipig)",
        "category": "Grains & Flours",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 180,
        "reorder_quantity": 350,
        "lead_time_days": 5,
        "description": "Authentic raw material Glutinous Rice (Malagkit for Pinipig) (RM-019) for Grains & Flours",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-020",
        "item_code": "RM-020",
        "name": "Hard Wheat Bread Flour",
        "category": "Grains & Flours",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 450,
        "reorder_quantity": 900,
        "lead_time_days": 3,
        "description": "Authentic raw material Hard Wheat Bread Flour (RM-020) for Grains & Flours",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-021",
        "item_code": "RM-021",
        "name": "Purified Water",
        "category": "Liquids",
        "unit_of_measure": "L",
        "current_stock": 0,
        "minimum_threshold": 1000,
        "reorder_quantity": 2000,
        "lead_time_days": 1,
        "description": "Authentic raw material Purified Water (RM-021) for Liquids",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-022",
        "item_code": "RM-022",
        "name": "Cleaned Chicken Crop (Butse)",
        "category": "Meat & Poultry",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 50,
        "reorder_quantity": 100,
        "lead_time_days": 2,
        "description": "Authentic raw material Cleaned Chicken Crop (Butse) (RM-022) for Meat & Poultry",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-023",
        "item_code": "RM-023",
        "name": "Pork Skin with Back Fat",
        "category": "Meat & Poultry",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 200,
        "reorder_quantity": 400,
        "lead_time_days": 2,
        "description": "Authentic raw material Pork Skin with Back Fat (RM-023) for Meat & Poultry",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-024",
        "item_code": "RM-024",
        "name": "Raw Shelled Peanuts",
        "category": "Nuts & Seeds",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 150,
        "reorder_quantity": 300,
        "lead_time_days": 5,
        "description": "Authentic raw material Raw Shelled Peanuts (RM-024) for Nuts & Seeds",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-025",
        "item_code": "RM-025",
        "name": "Toasted Sesame Seeds",
        "category": "Nuts & Seeds",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 30,
        "reorder_quantity": 60,
        "lead_time_days": 5,
        "description": "Authentic raw material Toasted Sesame Seeds (RM-025) for Nuts & Seeds",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-026",
        "item_code": "RM-026",
        "name": "Palm Cooking Oil",
        "category": "Oils & Fats",
        "unit_of_measure": "L",
        "current_stock": 0,
        "minimum_threshold": 700,
        "reorder_quantity": 1400,
        "lead_time_days": 3,
        "description": "Authentic raw material Palm Cooking Oil (RM-026) for Oils & Fats",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-027",
        "item_code": "RM-027",
        "name": "Pure Pork Lard",
        "category": "Oils & Fats",
        "unit_of_measure": "L",
        "current_stock": 0,
        "minimum_threshold": 100,
        "reorder_quantity": 200,
        "lead_time_days": 4,
        "description": "Authentic raw material Pure Pork Lard (RM-027) for Oils & Fats",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-028",
        "item_code": "RM-028",
        "name": "Refined Peanut Oil",
        "category": "Oils & Fats",
        "unit_of_measure": "L",
        "current_stock": 0,
        "minimum_threshold": 80,
        "reorder_quantity": 150,
        "lead_time_days": 5,
        "description": "Authentic raw material Refined Peanut Oil (RM-028) for Oils & Fats",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-029",
        "item_code": "RM-029",
        "name": "Fresh Carrots",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 60,
        "reorder_quantity": 120,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Carrots (RM-029) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-030",
        "item_code": "RM-030",
        "name": "Fresh Cassava Tubers",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 200,
        "reorder_quantity": 400,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Cassava Tubers (RM-030) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-031",
        "item_code": "RM-031",
        "name": "Fresh Garlic",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 120,
        "reorder_quantity": 240,
        "lead_time_days": 3,
        "description": "Authentic raw material Fresh Garlic (RM-031) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-032",
        "item_code": "RM-032",
        "name": "Fresh Ginger",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 50,
        "reorder_quantity": 100,
        "lead_time_days": 3,
        "description": "Authentic raw material Fresh Ginger (RM-032) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-033",
        "item_code": "RM-033",
        "name": "Fresh Grated Coconut Meat",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 140,
        "reorder_quantity": 280,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Grated Coconut Meat (RM-033) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-034",
        "item_code": "RM-034",
        "name": "Fresh Mature Coconut Meat",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 150,
        "reorder_quantity": 300,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Mature Coconut Meat (RM-034) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-035",
        "item_code": "RM-035",
        "name": "Fresh Purple Yam Tubers",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 200,
        "reorder_quantity": 400,
        "lead_time_days": 3,
        "description": "Authentic raw material Fresh Purple Yam Tubers (RM-035) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-036",
        "item_code": "RM-036",
        "name": "Fresh Sweet Potato",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 100,
        "reorder_quantity": 200,
        "lead_time_days": 3,
        "description": "Authentic raw material Fresh Sweet Potato (RM-036) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-037",
        "item_code": "RM-037",
        "name": "Green Raw Papaya",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 90,
        "reorder_quantity": 180,
        "lead_time_days": 2,
        "description": "Authentic raw material Green Raw Papaya (RM-037) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-038",
        "item_code": "RM-038",
        "name": "Pandan Leaves",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 10,
        "reorder_quantity": 20,
        "lead_time_days": 2,
        "description": "Authentic raw material Pandan Leaves (RM-038) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-039",
        "item_code": "RM-039",
        "name": "Red Bell Peppers",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 30,
        "reorder_quantity": 60,
        "lead_time_days": 3,
        "description": "Authentic raw material Red Bell Peppers (RM-039) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-040",
        "item_code": "RM-040",
        "name": "Red Chili Peppers (Siling Labuyo)",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 15,
        "reorder_quantity": 30,
        "lead_time_days": 2,
        "description": "Authentic raw material Red Chili Peppers (Siling Labuyo) (RM-040) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-041",
        "item_code": "RM-041",
        "name": "Red Onions",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 100,
        "reorder_quantity": 200,
        "lead_time_days": 3,
        "description": "Authentic raw material Red Onions (RM-041) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-042",
        "item_code": "RM-042",
        "name": "Unripe Green Saba Bananas",
        "category": "Produce / Agricultural",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 450,
        "reorder_quantity": 900,
        "lead_time_days": 2,
        "description": "Authentic raw material Unripe Green Saba Bananas (RM-042) for Produce / Agricultural",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-043",
        "item_code": "RM-043",
        "name": "Fresh Acetes Shrimp (Alamang)",
        "category": "Seafood",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 70,
        "reorder_quantity": 140,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Acetes Shrimp (Alamang) (RM-043) for Seafood",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-044",
        "item_code": "RM-044",
        "name": "Fresh Bangus (Milkfish) Skin",
        "category": "Seafood",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 80,
        "reorder_quantity": 160,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Bangus (Milkfish) Skin (RM-044) for Seafood",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-045",
        "item_code": "RM-045",
        "name": "Fresh Chiton Mollusk (Kibit)",
        "category": "Seafood",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 50,
        "reorder_quantity": 100,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Chiton Mollusk (Kibit) (RM-045) for Seafood",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-046",
        "item_code": "RM-046",
        "name": "Fresh Kabasi Fish",
        "category": "Seafood",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 40,
        "reorder_quantity": 80,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Kabasi Fish (RM-046) for Seafood",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-047",
        "item_code": "RM-047",
        "name": "Fresh Sapsap Fish",
        "category": "Seafood",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 50,
        "reorder_quantity": 100,
        "lead_time_days": 2,
        "description": "Authentic raw material Fresh Sapsap Fish (RM-047) for Seafood",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-048",
        "item_code": "RM-048",
        "name": "Cheese Seasoning Powder",
        "category": "Seasonings & Powders",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 35,
        "reorder_quantity": 70,
        "lead_time_days": 5,
        "description": "Authentic raw material Cheese Seasoning Powder (RM-048) for Seasonings & Powders",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-049",
        "item_code": "RM-049",
        "name": "Coarse Rock Salt",
        "category": "Seasonings / Salts",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 150,
        "reorder_quantity": 300,
        "lead_time_days": 4,
        "description": "Authentic raw material Coarse Rock Salt (RM-049) for Seasonings / Salts",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-050",
        "item_code": "RM-050",
        "name": "Iodized Salt",
        "category": "Seasonings / Salts",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 200,
        "reorder_quantity": 400,
        "lead_time_days": 4,
        "description": "Authentic raw material Iodized Salt (RM-050) for Seasonings / Salts",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-051",
        "item_code": "RM-051",
        "name": "Dried Bay Leaves (Laurel)",
        "category": "Spices & Seasonings",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 8,
        "reorder_quantity": 15,
        "lead_time_days": 7,
        "description": "Authentic raw material Dried Bay Leaves (Laurel) (RM-051) for Spices & Seasonings",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-052",
        "item_code": "RM-052",
        "name": "Dried Red Chili Flakes",
        "category": "Spices & Seasonings",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 12,
        "reorder_quantity": 25,
        "lead_time_days": 6,
        "description": "Authentic raw material Dried Red Chili Flakes (RM-052) for Spices & Seasonings",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-053",
        "item_code": "RM-053",
        "name": "Garlic Powder",
        "category": "Spices & Seasonings",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 25,
        "reorder_quantity": 50,
        "lead_time_days": 5,
        "description": "Authentic raw material Garlic Powder (RM-053) for Spices & Seasonings",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-054",
        "item_code": "RM-054",
        "name": "Ground Black Pepper",
        "category": "Spices & Seasonings",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 40,
        "reorder_quantity": 80,
        "lead_time_days": 5,
        "description": "Authentic raw material Ground Black Pepper (RM-054) for Spices & Seasonings",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-055",
        "item_code": "RM-055",
        "name": "White Pepper Powder",
        "category": "Spices & Seasonings",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 20,
        "reorder_quantity": 40,
        "lead_time_days": 5,
        "description": "Authentic raw material White Pepper Powder (RM-055) for Spices & Seasonings",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-056",
        "item_code": "RM-056",
        "name": "Whole Black Peppercorns",
        "category": "Spices & Seasonings",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 20,
        "reorder_quantity": 40,
        "lead_time_days": 6,
        "description": "Authentic raw material Whole Black Peppercorns (RM-056) for Spices & Seasonings",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-057",
        "item_code": "RM-057",
        "name": "Muscovado Brown Sugar",
        "category": "Sweeteners",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 220,
        "reorder_quantity": 450,
        "lead_time_days": 4,
        "description": "Authentic raw material Muscovado Brown Sugar (RM-057) for Sweeteners",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-058",
        "item_code": "RM-058",
        "name": "Panutsa Cane Sugar",
        "category": "Sweeteners",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 130,
        "reorder_quantity": 260,
        "lead_time_days": 4,
        "description": "Authentic raw material Panutsa Cane Sugar (RM-058) for Sweeteners",
        "created_at": "2026-01-01T00:00:00Z"
    },
    {
        "id": "RM-059",
        "item_code": "RM-059",
        "name": "Refined White Sugar",
        "category": "Sweeteners",
        "unit_of_measure": "kg",
        "current_stock": 0,
        "minimum_threshold": 750,
        "reorder_quantity": 1500,
        "lead_time_days": 3,
        "description": "Authentic raw material Refined White Sugar (RM-059) for Sweeteners",
        "created_at": "2026-01-01T00:00:00Z"
    }
];


// All old imported historical records permanently deleted; ML trained data preserved.
export const AUTHENTIC_STOCK_RECEIPTS_6MONTHS = [];
export const AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS = [];
