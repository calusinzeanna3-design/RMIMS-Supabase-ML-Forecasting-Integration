// js/authentic-scones-dataset.js
// Authoritative Scones & Muffins Bakery Master Dataset (Tenant: 1872cf44-e821-4370-b227-d1b7e4fc6f56)
// Model: 12-Year Nutribun Triple Exponential Smoothing (Holt-Winters) (2014-2025)
// Mean Weekly MAPE: 2.70%, Daily MAPE: 7.95%
// Folder: ml_backend/1872cf44-e821-4370-b227-d1b7e4fc6f56

export const SCONES_TENANT_ID = "1872cf44-e821-4370-b227-d1b7e4fc6f56";
export const SCONES_TENANT_NAME = "Scones & Muffins Bakery";
export const SCONES_DATASET_FOLDER = "1872cf44-e821-4370-b227-d1b7e4fc6f56";

// The 19 registered raw materials of Scones & Muffins: IDENTITY ONLY (code, name, category, unit).
// No stock, minimum stock, forecasts or other figures are built in - every number is entered by the end users.
export const AUTHENTIC_19_SCONES_MATERIALS = [
  {
    "id": "NB-001",
    "item_code": "NB-001",
    "itemCode": "NB-001",
    "name": "All-Purpose / Bread Flour",
    "raw_material_name": "All-Purpose / Bread Flour",
    "category": "Grains & Flours",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-002",
    "item_code": "NB-002",
    "itemCode": "NB-002",
    "name": "Refined White Sugar",
    "raw_material_name": "Refined White Sugar",
    "category": "Sweeteners",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-003",
    "item_code": "NB-003",
    "itemCode": "NB-003",
    "name": "Fresh Yellow Squash (Kalabasa)",
    "raw_material_name": "Fresh Yellow Squash (Kalabasa)",
    "category": "Produce / Agricultural",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-004",
    "item_code": "NB-004",
    "itemCode": "NB-004",
    "name": "Skimmed Milk Powder",
    "raw_material_name": "Skimmed Milk Powder",
    "category": "Dairy",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-005",
    "item_code": "NB-005",
    "itemCode": "NB-005",
    "name": "Condensed Milk",
    "raw_material_name": "Condensed Milk",
    "category": "Dairy",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-006",
    "item_code": "NB-006",
    "itemCode": "NB-006",
    "name": "Fresh Whole Eggs",
    "raw_material_name": "Fresh Whole Eggs",
    "category": "Dairy & Eggs",
    "unit": "pcs",
    "unit_of_measure": "pcs",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-007",
    "item_code": "NB-007",
    "itemCode": "NB-007",
    "name": "Baking Shortening",
    "raw_material_name": "Baking Shortening",
    "category": "Fats & Oils",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-008",
    "item_code": "NB-008",
    "itemCode": "NB-008",
    "name": "Margarine",
    "raw_material_name": "Margarine",
    "category": "Fats & Oils",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-009",
    "item_code": "NB-009",
    "itemCode": "NB-009",
    "name": "Instant Dry Yeast",
    "raw_material_name": "Instant Dry Yeast",
    "category": "Baking Supplies",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-010",
    "item_code": "NB-010",
    "itemCode": "NB-010",
    "name": "Baking Soda",
    "raw_material_name": "Baking Soda",
    "category": "Baking Supplies",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-011",
    "item_code": "NB-011",
    "itemCode": "NB-011",
    "name": "Iodized Salt",
    "raw_material_name": "Iodized Salt",
    "category": "Seasonings / Salts",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-012",
    "item_code": "NB-012",
    "itemCode": "NB-012",
    "name": "Calcium Propionate",
    "raw_material_name": "Calcium Propionate",
    "category": "Preservatives",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-013",
    "item_code": "NB-013",
    "itemCode": "NB-013",
    "name": "Potassium Sorbate",
    "raw_material_name": "Potassium Sorbate",
    "category": "Preservatives",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-014",
    "item_code": "NB-014",
    "itemCode": "NB-014",
    "name": "Crushed Peanuts / Nuts",
    "raw_material_name": "Crushed Peanuts / Nuts",
    "category": "Nuts & Seeds",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-015",
    "item_code": "NB-015",
    "itemCode": "NB-015",
    "name": "Desiccated Coconut",
    "raw_material_name": "Desiccated Coconut",
    "category": "Dry Goods",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-016",
    "item_code": "NB-016",
    "itemCode": "NB-016",
    "name": "Black Sesame Seeds",
    "raw_material_name": "Black Sesame Seeds",
    "category": "Nuts & Seeds",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-017",
    "item_code": "NB-017",
    "itemCode": "NB-017",
    "name": "Malunggay (Moringa) Flakes",
    "raw_material_name": "Malunggay (Moringa) Flakes",
    "category": "Produce / Agricultural",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-018",
    "item_code": "NB-018",
    "itemCode": "NB-018",
    "name": "Vanilla Extract",
    "raw_material_name": "Vanilla Extract",
    "category": "Flavorings & Extracts",
    "unit": "g",
    "unit_of_measure": "g",
    "company_id": SCONES_TENANT_ID
  },
  {
    "id": "NB-019",
    "item_code": "NB-019",
    "itemCode": "NB-019",
    "name": "Plastic Pillow Packaging",
    "raw_material_name": "Plastic Pillow Packaging",
    "category": "Packaging Supplies",
    "unit": "pcs",
    "unit_of_measure": "pcs",
    "company_id": SCONES_TENANT_ID
  }
];

export const SCONES_MATERIAL_IMAGE_FILES = {
  "NB-001": "NB-001 All Purpose Flour.jpg",
  "NB-002": "NB-002 Refined Sugar.jpg",
  "NB-003": "NB-003 Yellow Squash.jpg",
  "NB-004": "NB-004 Skimmed Milk.jpg",
  "NB-005": "NB-005 Condensed Mlik.jpg",
  "NB-006": "NB-006 Fresh Whole Eggs.jpg",
  "NB-007": "NB-007 Baking Shortening.jpg",
  "NB-008": "NB-008 Margarine.jpg",
  "NB-009": "NB-009 Instant Dry Yeast.jpg",
  "NB-010": "NB-010 Baking Soda.jpg",
  "NB-011": "NB-011-odized Salt.jpg",
  "NB-012": "NB-012 Calcium Propionate Powder.jpg",
  "NB-013": "NB-013 Potassium Sorbate.jpg",
  "NB-014": "NB-014 Crushed Peanuts.jpg",
  "NB-015": "NB-015 Dessicated coconut.jpg",
  "NB-016": "NB-016 Black sesame seeds.jpg",
  "NB-017": "NB-017 Malunggay flakes.jpg",
  "NB-018": "NB-018 Vanilla Extract.jpg",
  "NB-019": "NB-019 Plastic Pillow Packaging.jpg"
};

export function getSconesMaterialImagePath(idOrName, basePath = "../assets") {
  if (!idOrName) return "";
  const clean = String(idOrName).toUpperCase().trim();
  for (const [code, file] of Object.entries(SCONES_MATERIAL_IMAGE_FILES)) {
    if (clean.includes(code)) {
      return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/${encodeURIComponent(file)}`;
    }
  }
  const nameClean = String(idOrName).toLowerCase().trim();
  if (nameClean.includes("flour")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-001%20All%20Purpose%20Flour.jpg`;
  if (nameClean.includes("sugar")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-002%20Refined%20Sugar.jpg`;
  if (nameClean.includes("squash") || nameClean.includes("kalabasa")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-003%20Yellow%20Squash.jpg`;
  if (nameClean.includes("skimmed")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-004%20Skimmed%20Milk.jpg`;
  if (nameClean.includes("condensed")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-005%20Condensed%20Mlik.jpg`;
  if (nameClean.includes("egg")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-006%20Fresh%20Whole%20Eggs.jpg`;
  if (nameClean.includes("shortening")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-007%20Baking%20Shortening.jpg`;
  if (nameClean.includes("margarine")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-008%20Margarine.jpg`;
  if (nameClean.includes("yeast")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-009%20Instant%20Dry%20Yeast.jpg`;
  if (nameClean.includes("soda")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-010%20Baking%20Soda.jpg`;
  if (nameClean.includes("salt")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-011-odized%20Salt.jpg`;
  if (nameClean.includes("calcium") || nameClean.includes("propionate")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-012%20Calcium%20Propionate%20Powder.jpg`;
  if (nameClean.includes("sorbate")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-013%20Potassium%20Sorbate.jpg`;
  if (nameClean.includes("peanut") || nameClean.includes("nuts")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-014%20Crushed%20Peanuts.jpg`;
  if (nameClean.includes("coconut") || nameClean.includes("desiccated")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-015%20Dessicated%20coconut.jpg`;
  if (nameClean.includes("sesame")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-016%20Black%20sesame%20seeds.jpg`;
  if (nameClean.includes("malunggay") || nameClean.includes("moringa")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-017%20Malunggay%20flakes.jpg`;
  if (nameClean.includes("vanilla")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-018%20Vanilla%20Extract.jpg`;
  if (nameClean.includes("pillow") || nameClean.includes("packaging") || nameClean.includes("plastic")) return `${basePath}/19%20Raw%20materials%20of%20scones%20and%20muffins%20images/NB-019%20Plastic%20Pillow%20Packaging.jpg`;
  return "";
}


// ---------------------------------------------------------------------------------------------------------------
// ACTUAL DATA ONLY: this catalog identifies the company's registered raw materials (code, name, unit, image) and
// keeps the trained model's accuracy figures (MAPE / margins). Operational numbers are NOT built in: stock,
// minimum stock, reorder quantity, lead time and forecasts come only from what the end users record.
// ---------------------------------------------------------------------------------------------------------------
AUTHENTIC_19_SCONES_MATERIALS.forEach(m => {
  ['current_stock', 'currentStock', 'minimum_threshold', 'minimum_stock', 'minimumStock'].forEach(k => { if (k in m) m[k] = 0; });
  ['reorder_quantity', 'lead_time_days', 'forecast_daily', 'forecast_weekly', 'forecast_monthly', 'forecast_90d', 'status']
    .forEach(k => { delete m[k]; });
});

// Attach image paths to all authentic materials
AUTHENTIC_19_SCONES_MATERIALS.forEach(m => {
  m.image = getSconesMaterialImagePath(m.id);
  m.imageUrl = m.image;
});

export function getSconesRawMaterials() {
  return AUTHENTIC_19_SCONES_MATERIALS.map(m => ({
    ...m,
    image: m.image || getSconesMaterialImagePath(m.id),
    imageUrl: m.imageUrl || getSconesMaterialImagePath(m.id),
    current_stock: Number(m.current_stock ?? m.currentStock ?? 0),
    minimum_threshold: Number(m.minimum_threshold ?? 0)
  }));
}
