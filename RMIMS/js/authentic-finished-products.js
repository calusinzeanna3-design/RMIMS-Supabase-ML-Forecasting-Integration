// RMIMS V2 — Finished Products Master Catalog
// Empty by default: all finished products and recipe formulations are dynamically created
// and managed by end-users via New Inputs in the Finished Products / Formulations module.

// Authoritative Scones & Muffins Bakery 19 Nutribun Raw Materials Finished Product Formulation
export const AUTHENTIC_SCONES_FINISHED_PRODUCTS = [
  {
    id: "fp-scones-01",
    name: "Scones Formulation",
    materialNames: [
      "All-Purpose / Bread Flour",
      "Refined White Sugar",
      "Fresh Yellow Squash (Kalabasa)",
      "Skimmed Milk Powder",
      "Condensed Milk",
      "Fresh Whole Eggs",
      "Baking Shortening",
      "Margarine",
      "Instant Dry Yeast",
      "Baking Soda",
      "Iodized Salt",
      "Calcium Propionate",
      "Potassium Sorbate",
      "Crushed Peanuts / Nuts",
      "Desiccated Coconut",
      "Black Sesame Seeds",
      "Malunggay (Moringa) Flakes",
      "Vanilla Extract",
      "Plastic Pillow Packaging"
    ],
    category: "Bakery & Breads",
    batchUnits: 50,
    created_at: "2026-09-29T08:30:00.000Z"
  }
];

export const AUTHENTIC_FINISHED_PRODUCTS_CATALOG = [
  ...AUTHENTIC_SCONES_FINISHED_PRODUCTS
];
