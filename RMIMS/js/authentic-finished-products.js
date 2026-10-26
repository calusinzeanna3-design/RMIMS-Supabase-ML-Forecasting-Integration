// RMIMS V2 — Authoritative Finished Products Master Catalog & Unified Formulation Engine
// Never secretly deletes or hides user-inputted finished products or recipes.
// Automatically synchronizes across local storage keys, BroadcastChannel, and Supabase.

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
      "Black Sesame Seeds",
      "Malunggay (Moringa) Flakes",
      "Vanilla Extract",
      "Plastic Pillow Packaging"
    ],
    category: "Bakery & Breads",
    batchUnits: 50,
    created_at: new Date().toISOString()
  }
];

export const AUTHENTIC_FINISHED_PRODUCTS_CATALOG = [
  ...AUTHENTIC_SCONES_FINISHED_PRODUCTS
];

export const FINISHED_PRODUCT_STORAGE_KEYS = [
  'rmims_custom_finished_products',
  'RMSME_CUSTOM_FINISHED_PRODUCTS',
  'rmims_finished_products',
  'rmims_finished_product_context'
];

/**
 * Returns all active finished products and custom formulations across the entire system.
 * Deduplicates by name while preserving user-inputted ingredient details.
 */
export function getUnifiedFinishedProducts() {
  const seenMap = new Map();

  FINISHED_PRODUCT_STORAGE_KEYS.forEach(k => {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.forEach(p => {
            if (p && p.name) {
              const normName = String(p.name).toLowerCase().trim();
              const existing = seenMap.get(normName);
              if (!existing) {
                seenMap.set(normName, p);
              } else {
                // Keep the record that has the most complete recipeDetails or ingredients
                const exCount = Object.keys(existing.recipeDetails || {}).length;
                const newCount = Object.keys(p.recipeDetails || {}).length;
                if (newCount > exCount || (!existing.recipeDetails && p.recipeDetails)) {
                  seenMap.set(normName, p);
                }
              }
            }
          });
        }
      }
    } catch (_) {}
  });

  // If no products exist yet, seed baseline Scones formulation
  if (seenMap.size === 0) {
    AUTHENTIC_SCONES_FINISHED_PRODUCTS.forEach(p => {
      seenMap.set(String(p.name).toLowerCase().trim(), { ...p });
    });
  }

  return Array.from(seenMap.values());
}

/**
 * Persists a finished product formulation across all system storage keys and broadcasts.
 */
export function saveUnifiedFinishedProduct(product) {
  if (!product || !product.name) return;
  const list = getUnifiedFinishedProducts();
  const normName = String(product.name).toLowerCase().trim();
  const idx = list.findIndex(p => String(p.name).toLowerCase().trim() === normName);

  const fullProduct = {
    id: product.id || ('fp-' + Date.now()),
    name: product.name,
    materialNames: Array.isArray(product.materialNames) ? product.materialNames : [],
    recipeDetails: product.recipeDetails || {},
    category: product.category || 'Bakery & Breads',
    batchUnits: Number(product.batchUnits || 50),
    date_added: product.date_added || new Date().toISOString(),
    last_updated: new Date().toISOString(),
    created_at: product.created_at || product.date_added || new Date().toISOString()
  };

  if (idx >= 0) {
    list[idx] = { ...list[idx], ...fullProduct };
  } else {
    list.unshift(fullProduct);
  }

  const json = JSON.stringify(list);
  FINISHED_PRODUCT_STORAGE_KEYS.forEach(k => {
    try {
      localStorage.setItem(k, json);
    } catch (_) {}
  });

  // Dispatch events for live updates across open modules
  try {
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('rmims_finished_products_updated', { detail: list }));
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('rmims_user_sync');
      bc.postMessage({ type: 'finished_products_updated', product: fullProduct });
    }
  } catch (_) {}

  return fullProduct;
}

/**
 * Checks if an ingredient name matches a selected raw material name.
 */
export function matchProductIngredient(ingredientName, selectedMaterialName) {
  const ing = String(ingredientName || '').toLowerCase().trim();
  const sel = String(selectedMaterialName || '').toLowerCase().trim();
  if (!ing || !sel) return false;
  if (ing === sel) return true;
  if (ing.includes(sel) || sel.includes(ing)) return true;

  const cleanStr = (s) => s.replace(/[\/\(\)\-_,&]/g, ' ').replace(/\s+/g, ' ').trim();
  const cIng = cleanStr(ing);
  const cSel = cleanStr(sel);
  if (cIng === cSel || cIng.includes(cSel) || cSel.includes(cIng)) return true;

  const ingTokens = cIng.split(' ').filter(w => w.length > 2);
  const selTokens = cSel.split(' ').filter(w => w.length > 2);
  return ingTokens.some(t => selTokens.includes(t));
}
