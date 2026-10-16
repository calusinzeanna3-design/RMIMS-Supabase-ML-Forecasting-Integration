/**
 * RMSME Manager Inventory Module
 * 100% Faithful to Reference UI Specifications
 * Complete Raw Material Management:
 * - View materials, Search, Filter, Sort
 * - Add material, Edit material, Archive material, Restore material, View history, Information
 * - All 14 fields: Material ID, Raw Material Name, Category, Unit, Current Stock,
 *   Minimum Stock, Maximum Stock, Storage Location, Supplier, Description, Date Added,
 *   Last Updated, Added By, Status.
 */

import { getSystemRawMaterials, saveCustomRawMaterial, getSystemNextItemCode, deleteSystemRawMaterial } from './system-materials.js';
import { AUTHENTIC_FINISHED_PRODUCTS_CATALOG } from './authentic-finished-products.js';

// Local storage keys for Manager specific overrides & history
const MGR_STORAGE_OVERRIDES_KEY = 'rmims_manager_material_overrides';
const MGR_ARCHIVED_KEY = 'rmims_manager_archived_materials';
const MGR_HISTORY_KEY = 'rmims_manager_material_history';

// Default authentic supplier mappings by category
const DEFAULT_SUPPLIERS = {
  'Additives & Colors': 'Chemrez Technologies Inc.',
  'Baking Supplies': 'San Miguel Pure Foods Co.',
  'Sweeteners': 'Northern Cane Mills Inc.',
  'Dairy & Eggs': 'Magnolia Dairy Philippines',
  'Liquids & Oils': 'B-Meg Agri Solutions',
  'Grains & Flours': 'Pilmico Foods Corporation',
  'Packaging': 'Steniel Packaging Corp.',
  'Flavorings & Extracts': 'McCormick Philippines'
};

// Default authentic locations by category
const DEFAULT_LOCATIONS = {
  'Additives & Colors': 'Dry Chemical Store - Shelf A1',
  'Baking Supplies': 'Warehouse A - Pallet 04',
  'Sweeteners': 'Silo 2 / Warehouse B',
  'Dairy & Eggs': 'Cold Storage Unit 1',
  'Liquids & Oils': 'Liquid Bulk Bay 3',
  'Grains & Flours': 'Flour Silo / Rack 1',
  'Packaging': 'Packaging Bay - Tier 2',
  'Flavorings & Extracts': 'Pantry Store - Cabinet 4'
};

// Authoritative Baseline Formulation Ratios (kg or L per finished product unit)
const BASELINE_BOM_RATIOS = {
  "Fresh Mature Coconut Meat": 0.40,
  "Panutsa Cane Sugar": 0.15,
  "Muscovado Brown Sugar": 0.12,
  "Pandan Leaves": 0.02,
  "Fresh Garlic": 0.10,
  "Red Chili Peppers (Siling Labuyo)": 0.05,
  "Palm Cooking Oil": 0.08,
  "Cane Vinegar": 0.06,
  "Iodized Salt": 0.015,
  "Refined White Sugar": 0.10,
  "Dried Red Chili Flakes": 0.03,
  "Cornstarch": 0.04,
  "Fresh Cassava Tubers": 0.35,
  "Cheese Seasoning Powder": 0.03,
  "All-Purpose Wheat Flour": 0.25,
  "Purified Water": 0.15,
  "Food Grade Sunset Yellow / Orange Dye": 0.005,
  "Garlic Powder": 0.02,
  "Unripe Green Saba Bananas": 0.30,
  "Vanilla Extract": 0.005,
  "Fresh Sweet Potato": 0.35,
  "Hard Wheat Bread Flour": 0.25,
  "Salted Creamery Butter": 0.08,
  "Condensed Milk": 0.10,
  "Fresh Chiton Mollusk (Kibit)": 0.25,
  "Ground Black Pepper": 0.01,
  "Pork Skin with Back Fat": 0.40,
  "Pure Pork Lard": 0.10,
  "Coarse Rock Salt": 0.03,
  "Fresh Kabasi Fish": 0.50,
  "Fresh Bangus (Milkfish) Skin": 0.30,
  "White Pepper Powder": 0.01,
  "Glutinous Rice (Malagkit for Pinipig)": 0.20,
  "Raw Shelled Peanuts": 0.15,
  "Fresh Whole Egg Whites": 0.15,
  "Cream of Tartar": 0.005,
  "Fresh Sapsap Fish": 0.50,
  "Fresh Purple Yam Tubers": 0.45,
  "Evaporated Milk": 0.10,
  "Green Raw Papaya": 0.40,
  "Fresh Carrots": 0.10,
  "Red Bell Peppers": 0.05,
  "Fresh Ginger": 0.03,
  "Red Onions": 0.06,
  "Seedless Raisins": 0.04,
  "Whole Black Peppercorns": 0.01,
  "Fresh Grated Coconut Meat": 0.40,
  "Powdered Milk": 0.08,
  "Fresh Whole Eggs": 0.12,
  "Baking Powder": 0.01,
  "Toasted Sesame Seeds": 0.02,
  "Refined Peanut Oil": 0.08,
  "Fresh Acetes Shrimp (Alamang)": 0.45,
  "Cleaned Chicken Crop (Butse)": 0.35
};

// Authentic Default Specifications Map (Form, type, or grade only - no quantity, stock, supplier, or price)
const MATERIAL_SPECS_MAP = {
  'RM-001': { raw_material_name: 'Food Colorant', specification_name: 'Sunset Yellow / Orange Powder Dye' },
  'RM-002': { raw_material_name: 'Baking Powder', specification_name: 'Double-Acting Leavening Powder' },
  'RM-003': { raw_material_name: 'Cream of Tartar', specification_name: 'Purified Potassium Bitartrate 99.5%' },
  'RM-004': { raw_material_name: 'Yeast', specification_name: 'Instant Active Dry Yeast' },
  'RM-005': { raw_material_name: 'Vinegar', specification_name: 'Naturally Fermented Cane Vinegar (4.5% Acidity)' },
  'RM-006': { raw_material_name: 'Soy Sauce', specification_name: 'Naturally Brewed Soy Sauce' },
  'RM-007': { raw_material_name: 'Condensed Milk', specification_name: 'Sweetened Condensed Filled Milk' },
  'RM-008': { raw_material_name: 'Evaporated Milk', specification_name: 'Evaporated Filled Milk' },
  'RM-009': { raw_material_name: 'Milk Powder', specification_name: 'Full Cream Bakery Powdered Milk' },
  'RM-010': { raw_material_name: 'Egg Whites', specification_name: 'Pasteurized Liquid Egg Whites' },
  'RM-011': { raw_material_name: 'Eggs', specification_name: 'Fresh Whole Grade-A Eggs' },
  'RM-012': { raw_material_name: 'Shortening', specification_name: 'All-Vegetable Emulsified Shortening' },
  'RM-013': { raw_material_name: 'Shortening', specification_name: 'Commercial Bakery Shortening' },
  'RM-014': { raw_material_name: 'Butter', specification_name: 'Salted Pure Creamery Butter 82% Fat' },
  'RM-015': { raw_material_name: 'Raisins', specification_name: 'Seedless Thompson Dried Raisins' },
  'RM-016': { raw_material_name: 'Vanilla Extract', specification_name: 'Pure Bourbon Vanilla Extract' },
  'RM-017': { raw_material_name: 'Wheat Flour', specification_name: 'All-Purpose Grade (Enriched)' },
  'RM-018': { raw_material_name: 'Cornstarch', specification_name: 'Pure Food Grade Maize Starch' },
  'RM-019': { raw_material_name: 'Glutinous Rice', specification_name: 'Whole Grain Malagkit Rice for Pinipig' },
  'RM-020': { raw_material_name: 'Wheat Flour', specification_name: 'Hard Wheat Bread Flour (14% Protein)' },
  'RM-021': { raw_material_name: 'Water', specification_name: 'Reverse Osmosis Purified Water' },
  'RM-022': { raw_material_name: 'Chicken Crop', specification_name: 'Cleaned Dried Chicken Crop (Butse)' },
  'RM-023': { raw_material_name: 'Pork Skin', specification_name: 'Dressed Pork Skin with Back Fat' },
  'RM-024': { raw_material_name: 'Peanuts', specification_name: 'Raw Shelled Red Skin Peanuts' },
  'RM-025': { raw_material_name: 'Sesame Seeds', specification_name: 'Toasted Natural Sesame Seeds' },
  'RM-026': { raw_material_name: 'Cooking Oil', specification_name: 'Refined Bleached Deodorized Palm Olein' },
  'RM-027': { raw_material_name: 'Pork Lard', specification_name: 'Pure Rendered Bakery Pork Lard' },
  'RM-028': { raw_material_name: 'Peanut Oil', specification_name: 'Refined Food Grade Peanut Oil' },
  'RM-029': { raw_material_name: 'Carrots', specification_name: 'Fresh Washed Orange Carrots' },
  'RM-030': { raw_material_name: 'Cassava', specification_name: 'Fresh Peeled Cassava Tubers' },
  'RM-031': { raw_material_name: 'Garlic', specification_name: 'Fresh Native Garlic Cloves' },
  'RM-032': { raw_material_name: 'Ginger', specification_name: 'Fresh Native Yellow Ginger' },
  'RM-033': { raw_material_name: 'Coconut Meat', specification_name: 'Fresh Fine Grated Coconut Meat' },
  'RM-034': { raw_material_name: 'Coconut Meat', specification_name: 'Fresh Mature Coconut Kernel' },
  'RM-035': { raw_material_name: 'Purple Yam', specification_name: 'Fresh Ube Purple Yam Tubers' },
  'RM-036': { raw_material_name: 'Sweet Potato', specification_name: 'Fresh Orange Sweet Potato (Kamote)' },
  'RM-037': { raw_material_name: 'Papaya', specification_name: 'Unripe Green Raw Papaya' },
  'RM-038': { raw_material_name: 'Pandan', specification_name: 'Fresh Fragrant Pandan Leaves' },
  'RM-039': { raw_material_name: 'Bell Peppers', specification_name: 'Fresh Crisp Red Bell Peppers' },
  'RM-040': { raw_material_name: 'Chili Peppers', specification_name: 'Fresh Red Siling Labuyo Chili' },
  'RM-041': { raw_material_name: 'Onions', specification_name: 'Fresh Red Bulb Onions' },
  'RM-042': { raw_material_name: 'Bananas', specification_name: 'Unripe Green Saba Cooking Bananas' },
  'RM-043': { raw_material_name: 'Shrimp', specification_name: 'Fresh Acetes Micro-Shrimp (Alamang)' },
  'RM-044': { raw_material_name: 'Milkfish Skin', specification_name: 'Fresh Trimmed Bangus Fish Skin' },
  'RM-045': { raw_material_name: 'Mollusk', specification_name: 'Fresh Shucked Chiton Mollusk (Kibit)' },
  'RM-046': { raw_material_name: 'Fish', specification_name: 'Fresh Whole Kabasi Fish' },
  'RM-047': { raw_material_name: 'Fish', specification_name: 'Fresh Whole Sapsap Slipmouth Fish' },
  'RM-048': { raw_material_name: 'Cheese Powder', specification_name: 'Savory Cheddar Cheese Seasoning' },
  'RM-049': { raw_material_name: 'Salt', specification_name: 'Coarse Solar Dried Rock Salt' },
  'RM-050': { raw_material_name: 'Salt', specification_name: 'Fine Vacuum Refined Iodized Salt' },
  'RM-051': { raw_material_name: 'Bay Leaves', specification_name: 'Dried Whole Laurel Bay Leaves' },
  'RM-052': { raw_material_name: 'Chili Flakes', specification_name: 'Dried Crushed Red Chili Pepper Flakes' },
  'RM-053': { raw_material_name: 'Garlic Powder', specification_name: 'Dehydrated Pure Garlic Powder' },
  'RM-054': { raw_material_name: 'Black Pepper', specification_name: 'Fine Ground Pure Black Pepper' },
  'RM-055': { raw_material_name: 'White Pepper', specification_name: 'Fine Ground Pure White Pepper' },
  'RM-056': { raw_material_name: 'Black Pepper', specification_name: 'Whole Dried Black Peppercorns Grade A' },
  'RM-057': { raw_material_name: 'Sugar', specification_name: 'Muscovado Unrefined Brown Cane Sugar' },
  'RM-058': { raw_material_name: 'Sugar', specification_name: 'Panutsa Raw Cane Sugar Block' },
  'RM-059': { raw_material_name: 'Sugar', specification_name: 'Refined White Sugar' }
};

// State
let rawMaterials = [];
let activeTab = 'all'; // 'all' | 'specifications' | 'archived'
let statusFilter = 'all'; // 'all' | 'Good' | 'Low' | 'Out of Stock'
let searchQuery = '';
let categoryFilter = 'all';
let locationFilter = 'all';
let sortFilter = 'chronological'; // Chronological by Item Code (RM-001 -> RM-060)
let currentPage = 1;
let pageSize = 10;
let pendingActionMaterialId = null;
let pendingActionType = null; // 'archive' | 'restore'

// Finished Products Catalog Storage Keys
const CUSTOM_FP_STORAGE_KEY = 'rmims_custom_finished_products';
const DELETED_FP_STORAGE_KEY = 'RMSME_DELETED_FINISHED_PRODUCTS';

/**
 * Unified Modal Show / Hide Helpers
 * Guarantees modal renders above all elements and overrides [hidden] in all CSS cascades
 */
function showModalBackdrop(modal) {
  if (!modal) return;
  modal.classList.add('active');
  modal.classList.add('open');
  modal.removeAttribute('hidden');
  modal.hidden = false;
  modal.style.setProperty('display', 'flex', 'important');
  modal.style.setProperty('visibility', 'visible', 'important');
  modal.style.setProperty('opacity', '1', 'important');
  modal.style.setProperty('pointer-events', 'auto', 'important');
  document.body.style.overflow = 'hidden';
}

function hideModalBackdrop(modal) {
  if (!modal) return;
  modal.classList.remove('active');
  modal.classList.remove('open');
  modal.setAttribute('hidden', '');
  modal.hidden = true;
  modal.style.setProperty('display', 'none', 'important');
  modal.style.setProperty('visibility', 'hidden', 'important');
  modal.style.setProperty('opacity', '0', 'important');
  modal.style.setProperty('pointer-events', 'none', 'important');
  document.body.style.overflow = '';
}

function exposeModalFunctionsToWindow() {
  if (typeof window === 'undefined') return;
  window.openAddMaterialModal = openAddMaterialModal;
  window.closeAddModal = closeAddModal;
  window.openFinishedFoodCatalogPopup = openFinishedFoodCatalogPopup;
  window.closeFinishedFoodCatalogModal = closeFinishedFoodCatalogModal;
  window.openAddFinishedProductPanel = openAddFinishedProductPanel;
  window.closeAddFinishedProductPanel = closeAddFinishedProductPanel;
  window.openEditFinishedProductPanel = openEditFinishedProductPanel;
  window.promptDeleteFinishedProduct = promptDeleteFinishedProduct;
  window.closeDeleteFinishedProductModal = closeDeleteFinishedProductModal;
  window.handleConfirmDeleteFinishedProduct = handleConfirmDeleteFinishedProduct;
  window.loadAuthenticFinishedFormulations = loadAuthenticFinishedFormulations;
  window.openExportChoicesModal = openExportChoicesModal;
  window.closeExportChoicesModal = closeExportChoicesModal;
  window.openImportRawMaterialsModal = openImportRawMaterialsModal;
  window.closeImportRawMaterialsModal = closeImportRawMaterialsModal;
  window.downloadImportRawMaterialsTemplate = downloadImportRawMaterialsTemplate;
  window.clearImportRawMaterialsFile = clearImportRawMaterialsFile;
  window.handleConfirmImportMaterials = handleConfirmImportMaterials;
  window.openRawMaterialSpecsPopup = openRawMaterialSpecsPopup;
  window.closeRawMaterialSpecsPopup = closeRawMaterialSpecsPopup;
  window.openFinishedProductModal = openFinishedProductModal;
  window.closeFinishedProductModal = closeFinishedProductModal;
  window.openEditMaterialModal = openEditMaterialModal;
  window.closeEditModal = closeEditModal;
  window.openMaterialInfoModal = openMaterialInfoModal;
  window.closeInfoModal = closeInfoModal;
  window.openMaterialHistoryModal = openMaterialHistoryModal;
  window.closeHistoryModal = closeHistoryModal;
  window.openConfirmModal = openConfirmModal;
  window.closeConfirmModal = closeConfirmModal;
  window.closeAllModals = closeAllModals;
}

// Immediately expose functions so inline onclick handlers always find them
exposeModalFunctionsToWindow();

function initManagerInventory() {
  exposeModalFunctionsToWindow();
  loadMaterials();
  initEventListeners();
  renderUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initManagerInventory);
} else {
  initManagerInventory();
}

// Listen for storage events (multi-tab sync)
window.addEventListener('storage', (e) => {
  if (!e.key || e.key.includes('material') || e.key.includes('inventory')) {
    loadMaterials();
    renderUI();
  }
});

/**
 * Load materials from authoritative system dataset + manager local storage overrides
 */
function loadMaterials() {
  const baseMaterials = getSystemRawMaterials();
  const overrides = getStoredOverrides();
  const archivedIds = getArchivedIds();

  rawMaterials = baseMaterials.map((m, index) => {
    const id = String(m.item_code || m.id || `RM-${String(index + 1).padStart(3, '0')}`).toUpperCase();
    const ov = overrides[id] || {};
    const baseSpec = MATERIAL_SPECS_MAP[id] || {};

    const rawMaterialName = ov.raw_material_name || ov.name || baseSpec.raw_material_name || m.raw_material_name || m.name || 'Raw Material';
    const specificationName = ov.specification_name || baseSpec.specification_name || m.specification_name || `${rawMaterialName} Standard Food Grade`;

    const category = ov.category || m.category || 'Baking Supplies';
    const unit = ov.unit || m.unit_of_measure || m.unit || '';
    const currentStock = Number(ov.current_stock !== undefined ? ov.current_stock : (m.current_stock ?? 0));
    const minStock = Number(ov.minimum_stock !== undefined ? ov.minimum_stock : (m.minimum_threshold ?? m.minimum_stock ?? 10));
    const maxStock = Number(ov.maximum_stock !== undefined ? ov.maximum_stock : (m.reorder_quantity ? m.reorder_quantity * 4 : 100));
    const location = ov.storage_location || m.storage_location || DEFAULT_LOCATIONS[category] || 'Warehouse A - Shelf 1';
    const supplier = ov.supplier || m.supplier || DEFAULT_SUPPLIERS[category] || 'General Supply Co.';
    const description = ov.description || m.description || `Food grade ${specificationName} suitable for food processing operations.`;
    const dateAdded = ov.date_added || m.created_at || '2026-09-29';
    const lastUpdated = ov.last_updated || '2026-09-29 08:30 AM';
    const addedBy = ov.added_by || 'Store Manager';

    // Compute display_date and display_time cleanly
    let displayDate = 'Sep 29, 2026';
    let displayTime = '08:30 AM';
    try {
      const d = new Date(dateAdded);
      if (!isNaN(d.getTime())) {
        displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        displayTime = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (typeof dateAdded === 'string' && dateAdded.includes('-')) {
        const parts = dateAdded.split('T')[0].split('-');
        if (parts.length === 3) {
          const d2 = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          displayDate = d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
      }
    } catch (e) {}
    if (ov.time_added) displayTime = ov.time_added;
    if (ov.date_added && typeof ov.date_added === 'string' && !ov.date_added.includes('-')) {
      displayDate = ov.date_added;
    }

    const isArchived = archivedIds.has(id);
    let status = 'Good';
    if (isArchived) {
      status = 'Archived';
    } else if (currentStock <= 0) {
      status = 'Out of Stock';
    } else if (currentStock < minStock) {
      status = 'Low';
    }

    return {
      id,
      item_code: id,
      raw_material_name: rawMaterialName,
      name: rawMaterialName,
      specification_name: specificationName,
      category,
      unit,
      current_stock: currentStock,
      minimum_stock: minStock,
      maximum_stock: maxStock,
      storage_location: location,
      supplier,
      description,
      date_added: dateAdded,
      display_date: displayDate,
      display_time: displayTime,
      last_updated: lastUpdated,
      added_by: addedBy,
      status,
      isArchived
    };
  });
}

function getStoredOverrides() {
  try {
    const raw = localStorage.getItem(MGR_STORAGE_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveStoredOverrides(overrides) {
  try {
    localStorage.setItem(MGR_STORAGE_OVERRIDES_KEY, JSON.stringify(overrides));
    localStorage.setItem('rmims_inventory_updated', String(Date.now()));
  } catch (e) {
    console.error('Error saving overrides:', e);
  }
}

function getArchivedIds() {
  try {
    const raw = localStorage.getItem(MGR_ARCHIVED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    return new Set();
  }
}

function saveArchivedIds(idSet) {
  try {
    localStorage.setItem(MGR_ARCHIVED_KEY, JSON.stringify(Array.from(idSet)));
    localStorage.setItem('rmims_inventory_updated', String(Date.now()));
  } catch (e) {
    console.error('Error saving archived IDs:', e);
  }
}

function getMaterialHistory(id) {
  try {
    const raw = localStorage.getItem(MGR_HISTORY_KEY);
    const all = raw ? JSON.parse(raw) : {};
    return all[id] || [
      {
        timestamp: 'Sep 20, 2026, 08:30 AM',
        type: 'Created',
        user: 'Store Manager',
        detail: 'Initial catalog registration with verified stock thresholds.'
      }
    ];
  } catch (e) {
    return [];
  }
}

function logMaterialHistory(id, eventType, detail) {
  try {
    const raw = localStorage.getItem(MGR_HISTORY_KEY);
    const all = raw ? JSON.parse(raw) : {};
    if (!all[id]) all[id] = [];

    const now = new Date();
    const timeStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    all[id].unshift({
      timestamp: timeStr,
      type: eventType,
      user: 'Store Manager',
      detail: detail
    });

    localStorage.setItem(MGR_HISTORY_KEY, JSON.stringify(all));
  } catch (e) {
    console.error('Error logging history:', e);
  }
}

/**
 * Main UI Render Orchestrator
 */
function renderUI() {
  renderSummaryCards();
  renderCategoryFilterOptions();
  renderLocationFilterOptions();
  renderInventoryTable();
}

/**
 * Summary KPI Cards
 */
function renderSummaryCards() {
  const activeList = rawMaterials.filter(m => !m.isArchived);
  const totalCount = activeList.length;
  const inStockCount = activeList.filter(m => m.status === 'Available' || m.status === 'In Stock').length;
  const lowStockCount = activeList.filter(m => m.status === 'Low Stock').length;
  const outOfStockCount = activeList.filter(m => m.status === 'Out of Stock').length;
  const archivedCount = rawMaterials.filter(m => m.isArchived).length;

  const totalEl = document.getElementById('summaryTotalCount');
  const activeEl = document.getElementById('summaryActiveCount');
  const inStockEl = document.getElementById('statInStockCount');
  const lowStockEl = document.getElementById('statLowStockCount');
  const outOfStockEl = document.getElementById('statOutOfStockCount');

  if (totalEl) totalEl.textContent = rawMaterials.length;
  if (activeEl) activeEl.textContent = totalCount;
  if (inStockEl) inStockEl.textContent = inStockCount;
  if (lowStockEl) lowStockEl.textContent = lowStockCount;
  if (outOfStockEl) outOfStockEl.textContent = outOfStockCount;

  // Image 2 Top KPI Stat Cards for Manager Inventory
  const kpiTotal = document.getElementById('kpiMgrTotalMaterials');
  const kpiGood = document.getElementById('kpiMgrGoodStock');
  const kpiLow = document.getElementById('kpiMgrLowStock');
  const kpiCrit = document.getElementById('kpiMgrCriticalStock');

  const goodCount = activeList.filter(m => m.current_stock >= m.minimum_stock && m.current_stock > 0).length;
  const lowCount = activeList.filter(m => m.current_stock < m.minimum_stock && m.current_stock > 0).length;
  const outCount = activeList.filter(m => m.current_stock <= 0).length;

  if (kpiTotal) kpiTotal.textContent = totalCount;
  if (kpiGood) kpiGood.textContent = goodCount;
  if (kpiLow) kpiLow.textContent = lowCount;
  if (kpiCrit) kpiCrit.textContent = outCount;

  // Segmented Progress Bar
  const segInStock = document.getElementById('segInStock');
  const segLowStock = document.getElementById('segLowStock');
  const segOutOfStock = document.getElementById('segOutOfStock');

  if (totalCount > 0) {
    const inPct = ((inStockCount / totalCount) * 100).toFixed(1);
    const lowPct = ((lowStockCount / totalCount) * 100).toFixed(1);
    const outPct = ((outOfStockCount / totalCount) * 100).toFixed(1);

    if (segInStock) segInStock.style.width = `${inPct}%`;
    if (segLowStock) segLowStock.style.width = `${lowPct}%`;
    if (segOutOfStock) segOutOfStock.style.width = `${outPct}%`;
  } else {
    if (segInStock) segInStock.style.width = `0%`;
    if (segLowStock) segLowStock.style.width = `0%`;
    if (segOutOfStock) segOutOfStock.style.width = `0%`;
  }

  // Update tab badges
  const badgeAll = document.getElementById('badgeTabAll');
  const badgeSpecs = document.getElementById('badgeTabSpecs');
  const badgeFinished = document.getElementById('badgeTabFinished');
  const badgeArchived = document.getElementById('badgeTabArchived');

  const uniqueRawNames = new Set(rawMaterials.filter(m => !m.isArchived).map(m => m.raw_material_name || m.name));
  const allFinished = getAllFinishedProducts();
  const finishedCount = allFinished ? allFinished.length : 0;

  if (badgeAll) badgeAll.textContent = totalCount;
  if (badgeSpecs) badgeSpecs.textContent = uniqueRawNames.size;
  if (badgeFinished) badgeFinished.textContent = finishedCount;
  if (badgeArchived) badgeArchived.textContent = archivedCount;
}

/**
 * Filter dropdown options
 */
function renderCategoryFilterOptions() {
  const catSelect = document.getElementById('invCategoryFilter');
  if (!catSelect || (catSelect.dataset && catSelect.dataset.populated)) return;

  const categories = Array.from(new Set(rawMaterials.map(m => m.category).filter(Boolean))).sort();
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    catSelect.appendChild(opt);
  });
  if (!catSelect.dataset) catSelect.dataset = {};
  catSelect.dataset.populated = 'true';
}

function renderLocationFilterOptions() {
  const locSelect = document.getElementById('invLocationFilter');
  if (!locSelect || (locSelect.dataset && locSelect.dataset.populated)) return;

  const locations = Array.from(new Set(rawMaterials.map(m => m.storage_location).filter(Boolean))).sort();
  locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc;
    opt.textContent = loc;
    locSelect.appendChild(opt);
  });
  if (!locSelect.dataset) locSelect.dataset = {};
  locSelect.dataset.populated = 'true';
}

/**
 * Render Materials Table
 */
function renderInventoryTable() {
  const tbody = document.getElementById('overviewTableBody');
  const thead = document.getElementById('overviewTableHead');
  const tableWrapper = document.getElementById('overviewTableWrapper');
  const folderGrid = document.getElementById('specsFolderGrid');
  const fpWrapper = document.getElementById('finishedProductsWrapper');
  const paginationBar = document.querySelector('.inv-pagination-bar');
  if (!tbody) return;

  // Filter pipeline
  let filtered = rawMaterials.filter(m => !m.isArchived);

  // 1. Status Filter Dropdown
  if (statusFilter !== 'all') {
    if (statusFilter === 'Good' || statusFilter === 'Available' || statusFilter === 'In Stock') {
      filtered = filtered.filter(m => m.current_stock >= m.minimum_stock && m.current_stock > 0);
    } else if (statusFilter === 'Low' || statusFilter === 'Low Stock') {
      filtered = filtered.filter(m => m.current_stock < m.minimum_stock && m.current_stock > 0);
    } else if (statusFilter === 'Out of Stock') {
      filtered = filtered.filter(m => m.current_stock <= 0);
    } else {
      filtered = filtered.filter(m => m.status === statusFilter);
    }
  }

  // 2. Search Filter
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(m =>
      (m.raw_material_name || m.name || '').toLowerCase().includes(q) ||
      (m.specification_name || '').toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q)
    );
  }

  // 3. Sort Filter - Default Chronological (Item Code RM-001 -> RM-060)
  if (sortFilter === 'chronological' || sortFilter === 'code_asc') {
    filtered.sort((a, b) => {
      const numA = parseInt((a.id || '').replace(/\D/g, ''), 10) || 0;
      const numB = parseInt((b.id || '').replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });
  } else if (sortFilter === 'az') {
    filtered.sort((a, b) => (a.raw_material_name || a.name).localeCompare(b.raw_material_name || b.name));
  } else if (sortFilter === 'za') {
    filtered.sort((a, b) => (b.raw_material_name || b.name).localeCompare(a.raw_material_name || a.name));
  } else if (sortFilter === 'stock_asc') {
    filtered.sort((a, b) => a.current_stock - b.current_stock);
  } else if (sortFilter === 'stock_desc') {
    filtered.sort((a, b) => b.current_stock - a.current_stock);
  } else if (sortFilter === 'latest') {
    filtered.sort((a, b) => new Date(b.date_added || 0) - new Date(a.date_added || 0));
  } else {
    // Default fallback chronological
    filtered.sort((a, b) => {
      const numA = parseInt((a.id || '').replace(/\D/g, ''), 10) || 0;
      const numB = parseInt((b.id || '').replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });
  }

  if (tableWrapper) tableWrapper.style.display = 'block';
  if (paginationBar) paginationBar.style.display = 'flex';

  if (thead) {
    thead.innerHTML = `
      <tr style="background-color: #15803D !important;">
        <th style="width: 140px; background-color: #15803D !important; color: #FFFFFF !important; border-top-left-radius: 12px !important; border-bottom: 2px solid #14532D !important;">Code Raw Materials</th>
        <th style="background-color: #15803D !important; color: #FFFFFF !important; border-bottom: 2px solid #14532D !important;">Raw Material Name</th>
        <th style="text-align: right; width: 110px; background-color: #15803D !important; color: #FFFFFF !important; border-bottom: 2px solid #14532D !important;">Current Stock</th>
        <th style="text-align: right; width: 100px; background-color: #15803D !important; color: #FFFFFF !important; border-bottom: 2px solid #14532D !important;">Min Stock</th>
        <th style="width: 70px; background-color: #15803D !important; color: #FFFFFF !important; border-bottom: 2px solid #14532D !important;">Unit</th>
        <th style="width: 120px; background-color: #15803D !important; color: #FFFFFF !important; border-bottom: 2px solid #14532D !important;">Date</th>
        <th style="width: 100px; background-color: #15803D !important; color: #FFFFFF !important; border-bottom: 2px solid #14532D !important;">Time</th>
        <th style="text-align: center; width: 100px; background-color: #15803D !important; color: #FFFFFF !important; border-bottom: 2px solid #14532D !important;">Status</th>
        <th style="text-align: center; width: 140px; background-color: #15803D !important; color: #FFFFFF !important; border-top-right-radius: 12px !important; border-bottom: 2px solid #14532D !important;">Action</th>
      </tr>
    `;
  }

  const totalResults = filtered.length;
  const totalPages = Math.ceil(totalResults / pageSize) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIdx = (currentPage - 1) * pageSize;
  const paginated = filtered.slice(startIdx, startIdx + pageSize);

  // Update Result text (matching reference report image: "Showing 1 to 10 of 60 entries")
  const countEl = document.getElementById('overviewResultCount');
  if (countEl) {
    const endIdx = Math.min(startIdx + pageSize, totalResults);
    countEl.textContent = totalResults > 0
      ? `Showing ${startIdx + 1} to ${endIdx} of ${totalResults} entries`
      : 'Showing 0 entries';
  }

  // Update Card Subtitle count label
  const countLabel = document.getElementById('mgrInvCountLabel');
  if (countLabel) {
    const endIdx = Math.min(startIdx + pageSize, totalResults);
    countLabel.textContent = totalResults > 0
      ? `Showing ${startIdx + 1}–${endIdx} of ${totalResults} raw materials`
      : 'Showing 0 raw materials';
  }

  if (paginated.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding: 48px 16px; color: #64748B;">
          <div style="font-size: 28px; margin-bottom: 8px;">📦</div>
          <strong style="display:block; font-size: 14.5px; color: #0F2A1B; margin-bottom: 4px;">No materials found</strong>
          <p style="font-size: 13px; margin: 0; color: #5C7A68;">Try adjusting your search query or status filter.</p>
        </td>
      </tr>
    `;
    renderPagination(totalPages, 0);
    return;
  }

  tbody.innerHTML = paginated.map(m => {
    let statusText = 'Good';
    let statusPillClass = 'status-pill-good';
    let rowStatusClass = 'row-status-good';
    let rowBg = '#DCFCE7';      // Green for Good
    let rowBorder = '#BBF7D0';
    let leftBorderColor = '#16A34A';

    if (m.current_stock <= 0) {
      statusText = 'Out of Stock';
      statusPillClass = 'status-pill-out';
      rowStatusClass = 'row-status-out';
      rowBg = '#FEE2E2';        // Red for Out of Stock
      rowBorder = '#FECACA';
      leftBorderColor = '#DC2626';
    } else if (m.current_stock < m.minimum_stock) {
      statusText = 'Low';
      statusPillClass = 'status-pill-low';
      rowStatusClass = 'row-status-low';
      rowBg = '#FEF3C7';        // Orange for Low Stock
      rowBorder = '#FDE68A';
      leftBorderColor = '#D97706';
    } else {
      statusText = 'Good';
      statusPillClass = 'status-pill-good';
      rowStatusClass = 'row-status-good';
      rowBg = '#DCFCE7';        // Green for Good
      rowBorder = '#BBF7D0';
      leftBorderColor = '#16A34A';
    }

    const formattedStock = typeof m.current_stock === 'number'
      ? m.current_stock.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : m.current_stock;

    return `
      <tr data-id="${m.id}" class="${rowStatusClass}" style="background-color: ${rowBg} !important;">
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; border-left: 5px solid ${leftBorderColor} !important;">
          <span class="mgr-item-code" style="background: rgba(255,255,255,0.7);">${m.id}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;">
          <strong class="mgr-item-name" style="color: #0F2A1B;">${m.raw_material_name || m.name}</strong>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; text-align: right;">
          <span class="mgr-stock-bold ${m.current_stock <= 0 ? 'stock-out' : (m.current_stock < m.minimum_stock ? 'stock-low' : 'stock-healthy')}">${formattedStock}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; text-align: right;">
          <span class="mgr-stock-num" style="color: #1E293B;">${m.minimum_stock}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;">
          <span class="mgr-unit-text" style="color: #334155; font-weight: 600;">${m.unit}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;">
          <span class="mgr-date-text" style="color: #334155;">${m.display_date}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;">
          <span class="mgr-time-text" style="color: #475569;">${m.display_time}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; text-align: center;">
          <span class="mgr-status-pill ${statusPillClass}">${statusText}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; text-align: center;">
          <div style="display:inline-flex; align-items:center; gap:6px; justify-content:center;">
            <button type="button" class="btn-table-edit" data-id="${m.id}" title="Edit Material" style="padding:4px 8px; border-radius:6px; border:1px solid #0F766E; background:#FFFFFF; color:#0F766E; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Edit</span>
            </button>
            <button type="button" class="btn-table-delete" data-id="${m.id}" data-name="${escapeHtml(m.raw_material_name || m.name)}" title="Delete Material" style="padding:4px 8px; border-radius:6px; border:1px solid #FECACA; background:#FEF2F2; color:#DC2626; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <span>Delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  renderPagination(totalPages, totalResults);
}

/**
 * ==========================================================
 * SPECIFICATIONS FOLDER VIEW & POPUP WITH UPDATE LIST
 * ==========================================================
 */
let currentSpecsPopupRawName = '';

function renderSpecsFolderGrid(filteredMaterials) {
  const grid = document.getElementById('specsFolderGrid');
  if (!grid) return;

  // Group materials by raw_material_name
  const groups = new Map();
  filteredMaterials.forEach(m => {
    const rawName = m.raw_material_name || m.name || 'Raw Material';
    if (!groups.has(rawName)) {
      groups.set(rawName, []);
    }
    groups.get(rawName).push(m);
  });

  const countEl = document.getElementById('overviewResultCount');
  if (countEl) {
    countEl.textContent = `Showing ${groups.size} raw material folders (${filteredMaterials.length} total specifications)`;
  }

  // Clear pagination in folder view (all material folders visible)
  const paginControls = document.getElementById('overviewPaginationBtns');
  if (paginControls) paginControls.innerHTML = '';

  if (groups.size === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 16px; color: #64748B;">
        <div style="font-size: 32px; margin-bottom: 8px;">📁</div>
        <strong style="display:block; font-size: 15px; color: #0F2A1B; margin-bottom: 4px;">No material folders found</strong>
        <p style="font-size: 13px; margin: 0; color: #5C7A68;">Try adjusting your search query or status filter.</p>
      </div>
    `;
    return;
  }

  let html = '';
  groups.forEach((items, rawName) => {
    const specsCount = items.length;
    const badgeText = specsCount === 1 ? '1 Specification' : `${specsCount} Specifications`;
    
    // Status check across items in this folder
    const hasOutOfStock = items.some(i => i.status === 'Out of Stock');
    const hasLowStock = items.some(i => i.status === 'Low Stock');
    let healthDot = '#15803D';
    let healthLabel = 'Available';
    if (hasOutOfStock) {
      healthDot = '#DC2626';
      healthLabel = 'Out of Stock';
    } else if (hasLowStock) {
      healthDot = '#D97706';
      healthLabel = 'Low Stock';
    }

    // Specifications preview list (first 3 specs)
    const specsPreviewHtml = items.slice(0, 3).map(i => `
      <span class="mgr-folder-spec-pill" title="${i.specification_name}">
        • ${i.specification_name}
      </span>
    `).join('');

    const moreCount = specsCount > 3 ? `<span style="font-size:11px; color:#64748B; padding-left:4px;">+${specsCount - 3} more...</span>` : '';

    html += `
      <div class="mgr-folder-card" data-raw-name="${encodeURIComponent(rawName)}" role="button" tabindex="0" title="Click to open specifications for ${rawName}">
        <div class="mgr-folder-top">
          <div class="mgr-folder-icon-wrap">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <span class="mgr-folder-badge">
            ${badgeText}
          </span>
        </div>

        <div>
          <h4 class="mgr-folder-name">
            ${rawName}
          </h4>
          <div style="display:flex; align-items:center; gap:6px; font-size:11.5px; color:#5C7A68; margin-top:3px;">
            <span style="width:6px; height:6px; border-radius:50%; background:${healthDot};"></span>
            <span>${healthLabel}</span>
          </div>
        </div>

        <div class="mgr-folder-specs-list">
          ${specsPreviewHtml}
          ${moreCount}
        </div>

        <div class="mgr-folder-footer">
          <span>Open Specifications</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>
    `;
  });

  grid.innerHTML = html;

  // Add click & keyboard listeners to folder cards
  grid.querySelectorAll('.mgr-folder-card').forEach(card => {
    card.addEventListener('click', () => {
      const rawName = decodeURIComponent(card.dataset.rawName);
      openRawMaterialSpecsPopup(rawName);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const rawName = decodeURIComponent(card.dataset.rawName);
        openRawMaterialSpecsPopup(rawName);
      }
    });
  });
}

function openRawMaterialSpecsPopup(rawName = 'all') {
  currentSpecsPopupRawName = rawName || 'all';
  const modal = document.getElementById('modalRawMaterialSpecsPopup');
  if (!modal) return;

  // Populate raw materials select options
  const selectEl = document.getElementById('specsPopupMaterialSelect');
  if (selectEl) {
    const uniqueRawNames = Array.from(new Set(rawMaterials.filter(m => !m.isArchived).map(m => m.raw_material_name || m.name))).sort();
    selectEl.innerHTML = `
      <option value="all">All Raw Materials (${uniqueRawNames.length} Folders)</option>
      ${uniqueRawNames.map(name => `<option value="${name}" ${name === currentSpecsPopupRawName ? 'selected' : ''}>${name}</option>`).join('')}
    `;
    if (currentSpecsPopupRawName && currentSpecsPopupRawName !== 'all') {
      selectEl.value = currentSpecsPopupRawName;
    }
  }

  const titleEl = document.getElementById('specsPopupTitle');
  if (titleEl) {
    titleEl.textContent = (currentSpecsPopupRawName && currentSpecsPopupRawName !== 'all')
      ? `${currentSpecsPopupRawName} Specifications`
      : 'Raw Material Specifications';
  }

  const subtitleEl = document.getElementById('specsPopupSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent = (currentSpecsPopupRawName && currentSpecsPopupRawName !== 'all')
      ? `Specifications catalog & live update list for ${currentSpecsPopupRawName}`
      : 'Folder list & itemized specifications catalog with live update list';
  }

  const searchInput = document.getElementById('specsPopupSearchInput');
  if (searchInput) searchInput.value = '';

  renderSpecsPopupContent();

  const updatePanel = document.getElementById('specsUpdatePanel');
  if (updatePanel) updatePanel.style.display = 'none';

  showModalBackdrop(modal);
}

function closeRawMaterialSpecsPopup() {
  const modal = document.getElementById('modalRawMaterialSpecsPopup');
  hideModalBackdrop(modal);
}

function renderSpecsPopupContent() {
  const selectEl = document.getElementById('specsPopupMaterialSelect');
  const selRaw = selectEl ? selectEl.value : (currentSpecsPopupRawName || 'all');
  const searchEl = document.getElementById('specsPopupSearchInput');
  const query = searchEl ? searchEl.value.toLowerCase().trim() : '';

  let items = rawMaterials.filter(m => !m.isArchived);

  if (selRaw && selRaw !== 'all') {
    items = items.filter(m => (m.raw_material_name || m.name) === selRaw);
  }

  if (query) {
    items = items.filter(m => 
      (m.specification_name || '').toLowerCase().includes(query) ||
      (m.raw_material_name || m.name || '').toLowerCase().includes(query) ||
      m.id.toLowerCase().includes(query)
    );
  }

  // Meta bar stats
  const metaBar = document.getElementById('specsPopupMetaBar');
  if (metaBar) {
    const totalStock = items.reduce((acc, i) => acc + (Number(i.current_stock) || 0), 0);
    const distinctMats = new Set(items.map(i => i.raw_material_name || i.name)).size;
    metaBar.innerHTML = `
      <div class="specs-popup-meta-item">
        <span>Raw Material Scope:</span> <strong>${selRaw === 'all' ? `All Materials (${distinctMats} Folders)` : selRaw}</strong>
      </div>
      <div class="specs-popup-meta-item">
        <span>Total Specifications:</span> <strong>${items.length}</strong>
      </div>
      <div class="specs-popup-meta-item">
        <span>Combined Stock:</span> <strong>${totalStock.toLocaleString()}</strong>
      </div>
      <div class="specs-popup-meta-item" style="margin-left:auto;">
        <span style="font-size:11.5px; color:#5C7A68;">Click <strong>Update</strong> on any row to edit specifications</span>
      </div>
    `;
  }

  // Populate Table
  const tbody = document.getElementById('specsPopupTableBody');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:32px 16px; color:#64748B;">
          No specifications found. Click "+ Add Specification" to create one.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map(m => {
    let statusClass = 'status-instock';
    let rowStatusClass = 'row-status-good';
    let rowBg = '#DCFCE7';      // Green
    let rowBorder = '#BBF7D0';
    let leftBorderColor = '#16A34A';

    if (m.current_stock <= 0) {
      statusClass = 'status-outofstock';
      rowStatusClass = 'row-status-out';
      rowBg = '#FEE2E2';        // Red
      rowBorder = '#FECACA';
      leftBorderColor = '#DC2626';
    } else if (m.current_stock < m.minimum_stock) {
      statusClass = 'status-lowstock';
      rowStatusClass = 'row-status-low';
      rowBg = '#FEF3C7';        // Orange
      rowBorder = '#FDE68A';
      leftBorderColor = '#D97706';
    }

    return `
      <tr data-id="${m.id}" class="${rowStatusClass}" style="background-color: ${rowBg} !important;">
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; border-left: 5px solid ${leftBorderColor} !important;">
          <div style="font-weight:700; color:#0F2A1B; display:flex; align-items:center; gap:6px;">
            <span class="mgr-mat-badge" style="background: rgba(255,255,255,0.7);">${m.id}</span>
            <span>${m.raw_material_name || m.name}</span>
          </div>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;">
          <span class="mgr-spec-chip" title="${m.specification_name}" style="font-weight:700;">${m.specification_name}</span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;"><span style="font-weight:600; color:#334155;">${m.unit}</span></td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;"><strong style="color:#475569;">${m.minimum_stock} ${m.unit}</strong></td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;"><strong>${m.current_stock.toLocaleString()} ${m.unit}</strong></td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important;">
          <span class="mgr-status-badge ${statusClass}">
            <span class="mgr-status-dot"></span>
            ${m.status}
          </span>
        </td>
        <td style="background-color: ${rowBg} !important; border-bottom: 1px solid ${rowBorder} !important; text-align: right;">
          <button type="button" class="btn-primary-sm" data-action="popup-edit" data-id="${m.id}" title="Update Specification" style="font-size:11px; padding:4px 10px;">
            Update
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * ==========================================================
 * CUSTOM FINISHED PRODUCTS & ACTIVE CATALOG HELPERS
 * ==========================================================
 */

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getDeletedFinishedProducts() {
  try {
    const raw = localStorage.getItem(DELETED_FP_STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw).map(n => n.toLowerCase()) : []);
  } catch (e) {
    return new Set();
  }
}

function addDeletedFinishedProduct(name) {
  try {
    const raw = localStorage.getItem(DELETED_FP_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!arr.some(n => n.toLowerCase() === name.toLowerCase())) {
      arr.push(name);
      localStorage.setItem(DELETED_FP_STORAGE_KEY, JSON.stringify(arr));
    }
  } catch (e) {
    console.warn('Failed to save deleted finished product', e);
  }
}

const LEGACY_KXC_PRODUCT_NAMES = new Set([
  'shing-a-ling', 'toasty biscocho', 'apas bread', 'lengua de gato', 'biscocho chips',
  'coco jam', 'chili garlic sauce', 'spicy crunchy garlic', 'cheesy cassava chips',
  'sweet banana chips', 'sweet potato chips', 'chiton seafood chicharon', 'crispy bite chicharon',
  'dried kabasi', 'salted banana chips', 'crispy bite ficharon', 'crispy pinipig peanut',
  'fluffy crumbs meringue', 'dried sapsap', 'pure ube halaya', 'atsara', 'bukayo balls',
  'ube balls', 'crunchy peanut butter', 'chicharon (chiton)', 'binayong hipon',
  'crispy bucheron', 'sugar-glazed banana chips', 'crispy cassava chips',
  'special broas (ladyfingers)', 'camote delight', 'classic ensaymada', 'pan de sal special',
  'ube halaya pastries', 'chocolate crinkles', 'toasted pastillas', 'coconut macaroons',
  'cheese cupcakes', 'biscocho crisps', 'otap sugar biscuits', 'yema custard tarts',
  'polvoron gold selection', 'banana loaf cake', 'pianono roll', 'spanish bread',
  'butter toast crackers'
]);

function isLegacyKxcProduct(name) {
  if (!name) return false;
  const n = String(name).toLowerCase().trim();
  return LEGACY_KXC_PRODUCT_NAMES.has(n);
}

function getCustomFinishedProducts() {
  try {
    const raw = localStorage.getItem('rmims_custom_finished_products') || 
                localStorage.getItem('RMSME_CUSTOM_FINISHED_PRODUCTS') ||
                localStorage.getItem('rmims_finished_product_context');
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const cleaned = list.filter(p => p && p.name && !isLegacyKxcProduct(p.name));
    if (cleaned.length !== list.length) {
      saveCustomFinishedProducts(cleaned);
    }
    return cleaned;
  } catch (e) {
    console.warn('Failed to parse custom finished products', e);
    return [];
  }
}

function saveCustomFinishedProducts(list) {
  try {
    const json = JSON.stringify(list);
    localStorage.setItem('rmims_custom_finished_products', json);
    localStorage.setItem('RMSME_CUSTOM_FINISHED_PRODUCTS', json);
    localStorage.setItem('rmims_finished_product_context', json);
    // Broadcast storage event so open tabs/pages update immediately
    try {
      window.dispatchEvent(new Event('storage'));
      window.dispatchEvent(new CustomEvent('rmims_finished_products_updated', { detail: list }));
    } catch (_) {}
  } catch (e) {
    console.warn('Failed to save custom finished products', e);
  }
}

function getAllFinishedProducts() {
  const custom = getCustomFinishedProducts();
  const deleted = getDeletedFinishedProducts();

  return custom.filter(p => p && p.name && !deleted.has(p.name.toLowerCase()) && !isLegacyKxcProduct(p.name));
}

function loadAuthenticFinishedFormulations() {
  openAddFinishedProductPanel();
  showToast('Please use the formulation form to input your enterprise finished products.', 'info');
}
window.loadAuthenticFinishedFormulations = loadAuthenticFinishedFormulations;

// State for ingredients currently selected for the new finished product
const selectedNewFpMaterials = new Set();

function openAddFinishedProductPanel() {
  const panel = document.getElementById('addFinishedProductPanel');
  if (!panel) return;

  const isHidden = panel.style.display === 'none' || !panel.style.display;
  if (!isHidden && !document.getElementById('editingFpOriginalName')?.value) {
    closeAddFinishedProductPanel();
    return;
  }

  // Reset form state to Add mode
  const origNameInput = document.getElementById('editingFpOriginalName');
  if (origNameInput) origNameInput.value = '';

  const titleEl = document.getElementById('addFpFormTitle');
  if (titleEl) titleEl.textContent = 'Add Finished Product Formulation';

  const iconEl = document.getElementById('addFpFormIcon');
  if (iconEl) iconEl.textContent = '✨';

  const nameInput = document.getElementById('newFpName');
  if (nameInput) nameInput.value = '';

  const submitText = document.getElementById('btnSubmitAddFpText');
  if (submitText) submitText.textContent = 'Add Finished Product';

  selectedNewFpMaterials.clear();
  renderNewFpSelectedMaterials();
  populateAvailableRawMaterialsDropdown();

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (nameInput) nameInput.focus();
}
window.openAddFinishedProductPanel = openAddFinishedProductPanel;

function openEditFinishedProductPanel(productName) {
  const panel = document.getElementById('addFinishedProductPanel');
  if (!panel) return;

  const product = getAllFinishedProducts().find(p => p.name.toLowerCase() === productName.toLowerCase());
  if (!product) return;

  const modal = document.getElementById('modalFinishedFoodCatalogPopup');
  if (modal && modal.hidden) {
    showModalBackdrop(modal);
  }

  const origNameInput = document.getElementById('editingFpOriginalName');
  if (origNameInput) origNameInput.value = product.name;

  const titleEl = document.getElementById('addFpFormTitle');
  if (titleEl) titleEl.textContent = `Edit Formulation: ${product.name}`;

  const iconEl = document.getElementById('addFpFormIcon');
  if (iconEl) iconEl.textContent = '✏️';

  const nameInput = document.getElementById('newFpName');
  if (nameInput) nameInput.value = product.name;

  const submitText = document.getElementById('btnSubmitAddFpText');
  if (submitText) submitText.textContent = 'Save Changes';

  selectedNewFpMaterials.clear();
  (product.materialNames || []).forEach(m => selectedNewFpMaterials.add(m));
  renderNewFpSelectedMaterials();
  populateAvailableRawMaterialsDropdown();

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (nameInput) nameInput.focus();
}
window.openEditFinishedProductPanel = openEditFinishedProductPanel;

function closeAddFinishedProductPanel() {
  const panel = document.getElementById('addFinishedProductPanel');
  if (panel) panel.style.display = 'none';
  selectedNewFpMaterials.clear();
  const nameInput = document.getElementById('newFpName');
  if (nameInput) nameInput.value = '';
  const origNameInput = document.getElementById('editingFpOriginalName');
  if (origNameInput) origNameInput.value = '';
  const titleEl = document.getElementById('addFpFormTitle');
  if (titleEl) titleEl.textContent = 'Add Finished Product Formulation';
  const iconEl = document.getElementById('addFpFormIcon');
  if (iconEl) iconEl.textContent = '✨';
  const submitText = document.getElementById('btnSubmitAddFpText');
  if (submitText) submitText.textContent = 'Add Finished Product';
}

function populateAvailableRawMaterialsDropdown() {
  const select = document.getElementById('newFpRawMaterialSelect');
  if (!select) return;

  const available = (rawMaterials || []).filter(m => {
    const notArchived = !m.isArchived;
    const hasStock = Number(m.current_stock) > 0;
    const isAvail = (m.status === 'Available' || m.status === 'In Stock' || m.status === 'Good');
    return notArchived && hasStock && isAvail;
  });

  if (available.length === 0) {
    select.innerHTML = '<option value="">No available raw materials currently in inventory</option>';
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = available.map(m => {
    const matName = m.raw_material_name || m.name;
    return `<option value="${escapeHtml(matName)}">${escapeHtml(matName)} (Stock: ${Number(m.current_stock).toLocaleString()} ${escapeHtml(m.unit)})</option>`;
  }).join('');
}

function handleAddNewFpMaterial() {
  const select = document.getElementById('newFpRawMaterialSelect');
  if (!select || !select.value) return;

  const matName = select.value;
  if (selectedNewFpMaterials.has(matName)) {
    showToast(`"${matName}" is already in this recipe formulation.`, 'info');
    return;
  }

  selectedNewFpMaterials.add(matName);
  renderNewFpSelectedMaterials();
}

function removeNewFpMaterial(matName) {
  selectedNewFpMaterials.delete(matName);
  renderNewFpSelectedMaterials();
}

function renderNewFpSelectedMaterials() {
  const container = document.getElementById('newFpSelectedMaterialsTags');
  const countEl = document.getElementById('newFpSelectedCount');
  if (!container) return;

  if (countEl) countEl.textContent = selectedNewFpMaterials.size;

  if (selectedNewFpMaterials.size === 0) {
    container.innerHTML = `
      <span id="newFpEmptyHint" style="font-size:12px; color:#94A3B8; font-style:italic;">
        No raw materials added yet. Choose an available raw material from the dropdown above and click "+ Add Material".
      </span>
    `;
    return;
  }

  container.innerHTML = Array.from(selectedNewFpMaterials).map(matName => `
    <span class="mgr-recipe-tag">
      <span>${escapeHtml(matName)}</span>
      <button type="button" data-remove="${escapeHtml(matName)}" title="Remove ${escapeHtml(matName)}">&times;</button>
    </span>
  `).join('');

  container.querySelectorAll('button[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mat = btn.dataset.remove;
      removeNewFpMaterial(mat);
    });
  });
}

function handleAddFinishedProductSubmit(e) {
  e.preventDefault();

  const nameInput = document.getElementById('newFpName');
  const name = nameInput ? nameInput.value.trim() : '';
  const origNameInput = document.getElementById('editingFpOriginalName');
  const originalName = origNameInput ? origNameInput.value.trim() : '';

  if (!name) {
    alert('Please enter a finished product name.');
    if (nameInput) nameInput.focus();
    return;
  }

  if (selectedNewFpMaterials.size === 0) {
    alert('Please select and add at least one available raw material from your inventory.');
    const select = document.getElementById('newFpRawMaterialSelect');
    if (select) select.focus();
    return;
  }

  const allProducts = getAllFinishedProducts();
  if (originalName) {
    if (name.toLowerCase() !== originalName.toLowerCase()) {
      if (allProducts.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        alert(`A finished product named "${name}" already exists. Please choose a unique name.`);
        if (nameInput) nameInput.focus();
        return;
      }
    }
  } else {
    if (allProducts.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      alert(`A finished product named "${name}" already exists. Please choose a unique name.`);
      if (nameInput) nameInput.focus();
      return;
    }
  }

  const materialNames = Array.from(selectedNewFpMaterials);
  const custom = getCustomFinishedProducts();

  if (originalName) {
    const existingIndex = custom.findIndex(p => p.name.toLowerCase() === originalName.toLowerCase());
    const updatedProduct = {
      name,
      materialNames,
      category: 'Custom Finished Product',
      date_modified: new Date().toISOString()
    };
    if (existingIndex >= 0) {
      custom[existingIndex] = updatedProduct;
    } else {
      custom.unshift(updatedProduct);
      if (name.toLowerCase() !== originalName.toLowerCase()) {
        addDeletedFinishedProduct(originalName);
      }
    }
    saveCustomFinishedProducts(custom);
    showToast(`Formulation "${name}" updated successfully!`, 'success');
  } else {
    const newProduct = {
      name,
      materialNames,
      category: 'Custom Finished Product',
      date_added: new Date().toISOString()
    };
    custom.unshift(newProduct);
    saveCustomFinishedProducts(custom);
    showToast(`Finished product "${name}" created with ${materialNames.length} raw materials!`, 'success');
  }

  closeAddFinishedProductPanel();
  renderFinishedFoodModalContent('');
  renderFinishedProductsFolders();

  const detailModal = document.getElementById('modalFinishedProductFolder');
  if (detailModal && !detailModal.hidden) {
    openFinishedProductModal(name);
  } else if (!originalName) {
    openFinishedProductModal(name);
  }
}

/**
 * Delete Finished Product Flow
 */
let pendingDeleteFpName = null;

function promptDeleteFinishedProduct(name) {
  pendingDeleteFpName = name;
  const modal = document.getElementById('modalDeleteFinishedProductConfirm');
  const nameEl = document.getElementById('deleteTargetFpName');
  if (nameEl) nameEl.textContent = name;
  if (modal) showModalBackdrop(modal);
}
window.promptDeleteFinishedProduct = promptDeleteFinishedProduct;

function closeDeleteFinishedProductModal() {
  pendingDeleteFpName = null;
  const modal = document.getElementById('modalDeleteFinishedProductConfirm');
  if (modal) hideModalBackdrop(modal);
}
window.closeDeleteFinishedProductModal = closeDeleteFinishedProductModal;

function handleConfirmDeleteFinishedProduct() {
  if (!pendingDeleteFpName) return;
  const nameToDelete = pendingDeleteFpName;

  let custom = getCustomFinishedProducts();
  custom = custom.filter(p => p.name.toLowerCase() !== nameToDelete.toLowerCase());
  saveCustomFinishedProducts(custom);

  addDeletedFinishedProduct(nameToDelete);
  closeDeleteFinishedProductModal();

  const detailModal = document.getElementById('modalFinishedProductFolder');
  if (detailModal && !detailModal.hidden) {
    const titleEl = document.getElementById('fpPopupTitle');
    if (titleEl && titleEl.textContent.trim().toLowerCase() === nameToDelete.toLowerCase()) {
      closeFinishedProductModal();
    }
  }

  renderFinishedFoodModalContent('');
  renderFinishedProductsFolders();
  showToast(`Finished product "${nameToDelete}" deleted from catalog.`, 'success');
}
window.handleConfirmDeleteFinishedProduct = handleConfirmDeleteFinishedProduct;

/**
 * Shared Finished Product Card Builder & Event Attacher
 */
function buildFinishedProductCardHtml(p) {
  const matCount = p.materialNames ? p.materialNames.length : 0;
  const materialsPreviewHtml = (p.materialNames || []).slice(0, 3).map(m => `
    <span class="mgr-folder-spec-pill" title="${escapeHtml(m)}" style="background:#FFFBEB; color:#92400E; border:1px solid #FDE68A; display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:9999px; min-height:28px; height:auto; box-sizing:border-box;">
      <span style="font-size:13px; line-height:1; display:inline-flex; align-items:center; flex-shrink:0;">🌾</span>
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-flex; align-items:center; line-height:1.2; font-size:12px; font-weight:600; padding-bottom:1px;">${escapeHtml(m)}</span>
    </span>
  `).join('');
  const moreCount = (p.materialNames || []).length > 3 ? `<span style="font-size:11px; color:#B45309; padding-left:4px; font-weight:600;">+${(p.materialNames.length - 3)} more ingredients</span>` : '';

  return `
    <div class="mgr-folder-card mgr-fp-folder-card" data-fp-name="${encodeURIComponent(p.name)}" role="button" tabindex="0" title="Click to view recipe raw materials for ${escapeHtml(p.name)}">
      <div class="mgr-folder-top">
        <div class="mgr-folder-icon-wrap" style="background:#FEF3C7; color:#D97706;">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
        </div>

        <div class="mgr-fp-actions-group">
          <span class="mgr-folder-badge" style="background:rgba(217, 119, 6, 0.12); color:#B45309; font-weight:700;">${matCount} Materials</span>
          <button type="button" class="btn-fp-card-action btn-fp-card-edit" data-fp-edit="${encodeURIComponent(p.name)}" title="Edit ${escapeHtml(p.name)} formulation">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          <button type="button" class="btn-fp-card-action btn-fp-card-delete" data-fp-delete="${encodeURIComponent(p.name)}" title="Delete ${escapeHtml(p.name)} formulation">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            Delete
          </button>
        </div>
      </div>

      <div style="margin-top: 4px;">
        <h4 class="mgr-folder-name" title="${escapeHtml(p.name)}" style="font-size: 15px; font-weight: 700; color: #0F2A1B; margin-bottom: 2px;">${escapeHtml(p.name)}</h4>
        <div style="display:flex; align-items:center; gap:6px; font-size:11.5px; color:#5C7A68; margin-top:3px;">
          <span style="width:6px; height:6px; border-radius:50%; background:#D97706;"></span>
          <span>Finished Food Formulation</span>
        </div>
      </div>

      <div class="mgr-folder-specs-list" style="margin-top: 4px;">
        ${materialsPreviewHtml}
        ${moreCount}
      </div>

      <div class="mgr-folder-footer" style="color: #D97706; margin-top: 14px; border-top: 1px dashed #FDE68A;">
        <span>Open Formulation Guide</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  `;
}

function attachFinishedProductCardListeners(container) {
  if (!container) return;

  container.querySelectorAll('.mgr-fp-folder-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const fpName = decodeURIComponent(card.dataset.fpName);
      openFinishedProductModal(fpName);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('button')) return;
        e.preventDefault();
        const fpName = decodeURIComponent(card.dataset.fpName);
        openFinishedProductModal(fpName);
      }
    });
  });

  container.querySelectorAll('button[data-fp-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fpName = decodeURIComponent(btn.dataset.fpEdit);
      openEditFinishedProductPanel(fpName);
    });
  });

  container.querySelectorAll('button[data-fp-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fpName = decodeURIComponent(btn.dataset.fpDelete);
      promptDeleteFinishedProduct(fpName);
    });
  });
}

/**
 * Finished Food Catalog Popup Handlers
 */
function openFinishedFoodCatalogPopup() {
  const modal = document.getElementById('modalFinishedFoodCatalogPopup');
  if (!modal) return;

  const searchInput = document.getElementById('finishedFoodPopupSearchInput');
  if (searchInput) searchInput.value = '';

  closeAddFinishedProductPanel();
  populateAvailableRawMaterialsDropdown();
  renderFinishedFoodModalContent('');
  showModalBackdrop(modal);
}

function closeFinishedFoodCatalogModal() {
  const modal = document.getElementById('modalFinishedFoodCatalogPopup');
  hideModalBackdrop(modal);
}

function renderFinishedFoodModalContent(query = '') {
  const grid = document.getElementById('finishedFoodModalGrid');
  const countText = document.getElementById('finishedFoodCountText');
  if (!grid) return;

  let list = getAllFinishedProducts();
  if (query.trim()) {
    const q = query.toLowerCase().trim();
    list = list.filter(p => 
      p.name.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.materialNames || []).some(m => m.toLowerCase().includes(q))
    );
  }

  if (countText) {
    countText.textContent = `Showing ${list.length} Finished Food Formulations`;
  }

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="mgr-fp-empty-box">
        <div class="mgr-fp-empty-box-icon">🍱</div>
        <strong style="display:block; font-size: 15px; color: #0F2A1B; margin-bottom: 4px;">
          ${query.trim() ? 'No finished food products match your search' : 'No finished food formulations yet'}
        </strong>
        <p style="font-size: 13px; margin: 0 0 16px 0; color: #5C7A68;">
          ${query.trim() ? 'Try adjusting your search query or clear the filter.' : 'Click "+ Add Finished Product" above to create your enterprise product formulations.'}
        </p>
        <div style="display:inline-flex; gap:10px; flex-wrap:wrap; justify-content:center;">
          <button type="button" class="btn-primary-sm" onclick="window.openAddFinishedProductPanel && window.openAddFinishedProductPanel()"
            style="background:#D97706; border-color:#D97706; color:#FFFFFF; font-size:12px; font-weight:600; padding:6px 14px; border-radius:8px;">
            + Add Finished Product
          </button>
        </div>
      </div>
    `;
    return;
  }

  grid.innerHTML = list.map(p => buildFinishedProductCardHtml(p)).join('');
  attachFinishedProductCardListeners(grid);
}

function openSpecsUpdatePanel(id, mode = 'edit') {
  const panel = document.getElementById('specsUpdatePanel');
  if (!panel) return;

  const hiddenId = document.getElementById('specsUpdateHiddenId');
  const hiddenMode = document.getElementById('specsUpdateHiddenMode');
  const titleEl = document.getElementById('specsUpdateFormTitle');
  const targetIdEl = document.getElementById('specsUpdateTargetId');
  const specNameInput = document.getElementById('specsUpdateSpecName');
  const unitSelect = document.getElementById('specsUpdateUnit');
  const currentStockInput = document.getElementById('specsUpdateCurrentStock');
  const minStockInput = document.getElementById('specsUpdateMinStock');
  const maxStockInput = document.getElementById('specsUpdateMaxStock');
  const locationInput = document.getElementById('specsUpdateLocation');
  const supplierInput = document.getElementById('specsUpdateSupplier');

  if (mode === 'add') {
    const nextCode = getSystemNextItemCode(rawMaterials);
    if (hiddenId) hiddenId.value = nextCode;
    if (hiddenMode) hiddenMode.value = 'add';
    if (titleEl) titleEl.innerHTML = `Add Specification to <span style="color:#15803D;">${currentSpecsPopupRawName}</span>`;
    if (targetIdEl) targetIdEl.textContent = nextCode;
    if (specNameInput) specNameInput.value = '';
    if (unitSelect) unitSelect.value = '';
    if (currentStockInput) currentStockInput.value = 0;
    if (minStockInput) minStockInput.value = 10;
    if (maxStockInput) maxStockInput.value = 100;
    if (locationInput) locationInput.value = 'Warehouse A - Shelf 1';
    if (supplierInput) supplierInput.value = 'General Mills';
  } else {
    const m = rawMaterials.find(x => x.id === id);
    if (!m) return;
    if (hiddenId) hiddenId.value = m.id;
    if (hiddenMode) hiddenMode.value = 'edit';
    if (titleEl) titleEl.innerHTML = `Update Specification: <span style="color:#15803D;">${m.specification_name}</span>`;
    if (targetIdEl) targetIdEl.textContent = m.id;
    if (specNameInput) specNameInput.value = m.specification_name || '';
    if (unitSelect) unitSelect.value = m.unit || m.unit_of_measure || '';
    if (currentStockInput) currentStockInput.value = m.current_stock;
    if (minStockInput) minStockInput.value = m.minimum_stock;
    if (maxStockInput) maxStockInput.value = m.maximum_stock || '';
    if (locationInput) locationInput.value = m.storage_location || '';
    if (supplierInput) supplierInput.value = m.supplier || '';
  }

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (specNameInput) specNameInput.focus();
}

function handleSpecsInlineUpdateSubmit(e) {
  e.preventDefault();

  const hiddenId = document.getElementById('specsUpdateHiddenId');
  const hiddenMode = document.getElementById('specsUpdateHiddenMode');
  const id = hiddenId ? hiddenId.value : '';
  const mode = hiddenMode ? hiddenMode.value : 'edit';

  const specNameInput = document.getElementById('specsUpdateSpecName');
  const specName = specNameInput ? specNameInput.value.trim() : '';
  if (!specName) {
    alert('Please enter a valid specification name.');
    return;
  }

  const unit = document.getElementById('specsUpdateUnit').value;
  const currentStock = parseFloat(document.getElementById('specsUpdateCurrentStock').value) || 0;
  const minStock = parseFloat(document.getElementById('specsUpdateMinStock').value) || 0;
  const maxStockInputEl = document.getElementById('specsUpdateMaxStock');
  const maxStock = (maxStockInputEl && parseFloat(maxStockInputEl.value)) || (minStock * 5) || 100;
  const location = document.getElementById('specsUpdateLocation').value.trim() || 'Warehouse A';
  const supplier = document.getElementById('specsUpdateSupplier').value.trim() || 'General Supply Co.';

  let status = 'Good';
  if (currentStock === 0) status = 'Out of Stock';
  else if (currentStock < minStock) status = 'Low';

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = dateStr + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const displayTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const overrides = getStoredOverrides();

  if (mode === 'add') {
    const newItem = {
      id,
      name: `${currentSpecsPopupRawName} - ${specName}`,
      raw_material_name: currentSpecsPopupRawName,
      specification_name: specName,
      category: 'Baking Supplies',
      unit,
      current_stock: currentStock,
      minimum_stock: minStock,
      maximum_stock: maxStock,
      storage_location: location,
      supplier,
      status,
      description: `Specification ${specName} for ${currentSpecsPopupRawName} registered via specifications list.`,
      date_added: dateStr,
      display_date: dateStr,
      display_time: displayTime,
      last_updated: timeStr,
      added_by: 'Store Manager',
      isArchived: false
    };

    rawMaterials.unshift(newItem);
    overrides[id] = { ...newItem };
    saveStoredOverrides(overrides);

    saveCustomRawMaterial({
      id,
      name: `${currentSpecsPopupRawName} - ${specName}`,
      raw_material_name: currentSpecsPopupRawName,
      specification_name: specName,
      unit,
      current_stock: currentStock,
      minimum_stock: minStock,
      maximum_stock: maxStock,
      category: 'Baking Supplies'
    });

    logMaterialHistory(id, 'Created', `Created ${specName} specification for ${currentSpecsPopupRawName}`);
    showToast(`Added new specification for ${currentSpecsPopupRawName}!`, 'success');
  } else {
    const m = rawMaterials.find(x => x.id === id);
    if (!m) return;

    m.specification_name = specName;
    m.name = `${currentSpecsPopupRawName} - ${specName}`;
    m.unit = unit;
    m.current_stock = currentStock;
    m.minimum_stock = minStock;
    m.maximum_stock = maxStock;
    m.storage_location = location;
    m.supplier = supplier;
    m.status = status;
    m.last_updated = timeStr;
    m.display_date = dateStr;
    m.display_time = displayTime;

    overrides[id] = {
      ...(overrides[id] || {}),
      raw_material_name: currentSpecsPopupRawName,
      specification_name: specName,
      name: `${currentSpecsPopupRawName} - ${specName}`,
      unit,
      current_stock: currentStock,
      minimum_stock: minStock,
      maximum_stock: maxStock,
      storage_location: location,
      supplier,
      status,
      last_updated: timeStr,
      display_date: dateStr,
      display_time: displayTime
    };
    saveStoredOverrides(overrides);

    logMaterialHistory(id, 'Updated', `Updated specification to ${specName} (${currentStock} ${unit})`);
    showToast(`Specification list updated for ${currentSpecsPopupRawName}!`, 'success');
  }

  // Refresh views
  renderSpecsPopupContent();
  const panel = document.getElementById('specsUpdatePanel');
  if (panel) panel.style.display = 'none';

  renderSummaryCards();
  renderInventoryTable();
}

/**
 * Sequential pagination
 */
function renderPagination(totalPages, totalItems) {
  const container = document.getElementById('overviewPaginationBtns');
  if (!container) return;

  if (totalItems === 0 || totalPages === 0) {
    container.innerHTML = `
      <button type="button" class="pagination-btn inv-page-btn disabled" disabled aria-label="Previous Page" title="Previous Page">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button type="button" class="pagination-btn inv-page-btn disabled" disabled>1</button>
      <button type="button" class="pagination-btn inv-page-btn disabled" disabled aria-label="Next Page" title="Next Page">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    `;
    return;
  }

  const pages = Math.max(1, totalPages || 1);

  let html = `
    <button type="button" class="pagination-btn inv-page-btn ${currentPage <= 1 ? 'disabled' : ''}" data-page="prev" ${currentPage <= 1 ? 'disabled' : ''} aria-label="Previous Page" title="Previous Page">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
  `;

  for (let i = 1; i <= pages; i++) {
    html += `
      <button type="button" class="pagination-btn inv-page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}" title="Page ${i}">
        ${i}
      </button>
    `;
  }

  html += `
    <button type="button" class="pagination-btn inv-page-btn ${currentPage >= pages ? 'disabled' : ''}" data-page="next" ${currentPage >= pages ? 'disabled' : ''} aria-label="Next Page" title="Next Page">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  `;

  container.innerHTML = html;
}

/**
 * Event Listeners & Interaction wiring
 */
function initEventListeners() {
  // Search input
  const searchInput = document.getElementById('invSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchInputBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      currentPage = 1;
      if (clearSearchBtn) clearSearchBtn.style.display = searchQuery ? 'block' : 'none';
      renderInventoryTable();
    });
  }

  if (clearSearchBtn && searchInput) {
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.style.display = 'none';
      currentPage = 1;
      renderInventoryTable();
    });
  }

  // Status filter
  const statusSelect = document.getElementById('invStatusFilter');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      currentPage = 1;
      toggleClearFiltersBtn();
      renderInventoryTable();
    });
  }

  // Sort filter
  const sortSelect = document.getElementById('invSortFilter');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      sortFilter = e.target.value;
      renderInventoryTable();
    });
  }

  // Page size selector
  const pageSizeSelect = document.getElementById('overviewPageSize');
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      pageSize = parseInt(e.target.value, 10) || 10;
      currentPage = 1;
      renderInventoryTable();
    });
  }

  // Clear filters button
  const clearFiltersBtn = document.getElementById('invClearFiltersBtn');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (statusSelect) statusSelect.value = 'all';
      if (sortSelect) sortSelect.value = 'chronological';
      searchQuery = '';
      statusFilter = 'all';
      sortFilter = 'chronological';
      if (clearSearchBtn) clearSearchBtn.style.display = 'none';
      toggleClearFiltersBtn();
      currentPage = 1;
      renderInventoryTable();
    });
  }

  // Table action clicks (delegated)
  const tbody = document.getElementById('overviewTableBody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-table-edit');
      if (editBtn) {
        openEditMaterialModal(editBtn.dataset.id);
        return;
      }
      const delBtn = e.target.closest('.btn-table-delete');
      if (delBtn) {
        promptDeleteMaterial(delBtn.dataset.id, delBtn.dataset.name);
        return;
      }

      const btn = e.target.closest('.mgr-action-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!id) return;

      if (action === 'view') {
        openMaterialInfoModal(id);
      } else if (action === 'edit') {
        openEditMaterialModal(id);
      } else if (action === 'history') {
        openMaterialHistoryModal(id);
      } else if (action === 'archive') {
        openConfirmModal('archive', id);
      } else if (action === 'restore') {
        openConfirmModal('restore', id);
      }
    });
  }

  // Delete Material Confirmation Modal Buttons
  const btnCloseDel = document.getElementById('deleteConfirmCloseBtn');
  const btnCancelDel = document.getElementById('deleteConfirmCancelBtn');
  const btnSubmitDel = document.getElementById('deleteConfirmSubmitBtn');
  if (btnCloseDel) btnCloseDel.addEventListener('click', closeDeleteConfirmModal);
  if (btnCancelDel) btnCancelDel.addEventListener('click', closeDeleteConfirmModal);
  if (btnSubmitDel) btnSubmitDel.addEventListener('click', handleConfirmDeleteMaterial);

  // Pagination clicks (delegated)
  const paginationContainer = document.getElementById('overviewPaginationBtns');
  if (paginationContainer) {
    paginationContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.inv-page-btn');
      if (!btn || btn.classList.contains('disabled')) return;
      const pageVal = btn.dataset.page;
      if (pageVal === 'prev') {
        currentPage = Math.max(1, currentPage - 1);
      } else if (pageVal === 'next') {
        currentPage++;
      } else {
        currentPage = parseInt(pageVal, 10) || 1;
      }
      renderInventoryTable();
    });
  }

  // Card Toolbar Buttons: Specifications & Finished Food Popups
  const btnSpecs = document.getElementById('btnOpenSpecsPopup');
  if (btnSpecs) {
    btnSpecs.addEventListener('click', () => openRawMaterialSpecsPopup('all'));
  }

  const btnFinishedFood = document.getElementById('btnOpenFinishedFoodPopup');
  if (btnFinishedFood) {
    btnFinishedFood.addEventListener('click', openFinishedFoodCatalogPopup);
  }

  // Card Toolbar Buttons: Add Material & Export inside the card
  const cardAddBtn = document.getElementById('cardAddMaterialBtn');
  const addBtn = document.getElementById('addMaterialBtn');
  const toolbarAddBtn = document.getElementById('toolbarAddMaterialBtn');
  if (cardAddBtn) cardAddBtn.addEventListener('click', openAddMaterialModal);
  if (addBtn) addBtn.addEventListener('click', openAddMaterialModal);
  if (toolbarAddBtn) toolbarAddBtn.addEventListener('click', openAddMaterialModal);

  const cardExportBtn = document.getElementById('cardExportBtn');
  const invExportBtn = document.getElementById('invExportBtn');
  if (cardExportBtn) cardExportBtn.addEventListener('click', openExportChoicesModal);
  if (invExportBtn) invExportBtn.addEventListener('click', openExportChoicesModal);

  // Add Material Modal triggers
  const addModalClose = document.getElementById('addModalClose');
  const addModalCancel = document.getElementById('addModalCancelBtn');
  if (addModalClose) addModalClose.addEventListener('click', closeAddModal);
  if (addModalCancel) addModalCancel.addEventListener('click', closeAddModal);

  const addForm = document.getElementById('addMaterialForm');
  if (addForm) {
    addForm.addEventListener('submit', handleAddMaterialSubmit);
  }

  const addMatNameInput = document.getElementById('addMatName');
  if (addMatNameInput) {
    addMatNameInput.addEventListener('input', () => {
      const val = addMatNameInput.value.trim().toLowerCase();
      const feedback = document.getElementById('addMatNameFeedback');
      if (!val) {
        if (feedback) { feedback.style.display = 'none'; feedback.textContent = ''; }
        addMatNameInput.style.borderColor = '';
        return;
      }
      // Exact duplicate match only (e.g. "Salt" matches "salt", but "Sea Salt" does NOT match "Salt")
      const match = rawMaterials.find(m => (m.raw_material_name || m.name || '').trim().toLowerCase() === val);
      if (match) {
        addMatNameInput.style.borderColor = '#DC2626';
        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.color = '#DC2626';
          feedback.textContent = `⚠️ Raw material "${match.raw_material_name || match.name}" is already registered (Code: ${match.id}).`;
        }
      } else {
        addMatNameInput.style.borderColor = '#16A34A';
        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.color = '#16A34A';
          feedback.textContent = `✓ Raw material name is available.`;
        }
      }
    });
  }

  // Edit Material Modal triggers
  const editModalClose = document.getElementById('editModalClose');
  const editModalCancel = document.getElementById('editModalCancelBtn');
  if (editModalClose) editModalClose.addEventListener('click', closeEditModal);
  if (editModalCancel) editModalCancel.addEventListener('click', closeEditModal);

  const editForm = document.getElementById('editMaterialForm');
  if (editForm) {
    editForm.addEventListener('submit', handleEditMaterialSubmit);
  }

  // Info Modal close
  const infoModalClose = document.getElementById('infoModalClose');
  const infoModalCloseBtn = document.getElementById('infoModalCloseBtn');
  if (infoModalClose) infoModalClose.addEventListener('click', closeInfoModal);
  if (infoModalCloseBtn) infoModalCloseBtn.addEventListener('click', closeInfoModal);

  // History Modal close
  const historyModalClose = document.getElementById('historyModalClose');
  const historyModalCloseBtn = document.getElementById('historyModalCloseBtn');
  if (historyModalClose) historyModalClose.addEventListener('click', closeHistoryModal);
  if (historyModalCloseBtn) historyModalCloseBtn.addEventListener('click', closeHistoryModal);

  // Confirm Action Modal triggers
  const confirmClose = document.getElementById('confirmModalClose');
  const confirmCancel = document.getElementById('confirmModalCancelBtn');
  const confirmActionBtn = document.getElementById('confirmModalActionBtn');
  if (confirmClose) confirmClose.addEventListener('click', closeConfirmModal);
  if (confirmCancel) confirmCancel.addEventListener('click', closeConfirmModal);
  if (confirmActionBtn) confirmActionBtn.addEventListener('click', handleConfirmActionSubmit);

  // Export Choices Modal triggers
  const exportModalClose = document.getElementById('exportModalClose');
  const exportModalCancelBtn = document.getElementById('exportModalCancelBtn');
  const exportModalConfirmBtn = document.getElementById('exportModalConfirmBtn');
  if (exportModalClose) exportModalClose.addEventListener('click', closeExportChoicesModal);
  if (exportModalCancelBtn) exportModalCancelBtn.addEventListener('click', closeExportChoicesModal);
  if (exportModalConfirmBtn) exportModalConfirmBtn.addEventListener('click', handleExportConfirm);

  // Import Raw Materials Modal triggers
  const cardImportBtn = document.getElementById('cardImportBtn');
  if (cardImportBtn) cardImportBtn.addEventListener('click', openImportRawMaterialsModal);

  const importModalCloseBtn = document.getElementById('importModalCloseBtn');
  const importModalCancelBtn = document.getElementById('importModalCancelBtn');
  const importModalConfirmBtn = document.getElementById('importModalConfirmBtn');
  const btnClearImportFile = document.getElementById('btnClearImportFile');
  const rawMaterialsImportFileInput = document.getElementById('rawMaterialsImportFileInput');
  const importDropzone = document.getElementById('importRawMaterialsDropzone');

  if (importModalCloseBtn) importModalCloseBtn.addEventListener('click', closeImportRawMaterialsModal);
  if (importModalCancelBtn) importModalCancelBtn.addEventListener('click', closeImportRawMaterialsModal);
  if (importModalConfirmBtn) importModalConfirmBtn.addEventListener('click', handleConfirmImportMaterials);
  if (btnClearImportFile) btnClearImportFile.addEventListener('click', clearImportRawMaterialsFile);

  if (rawMaterialsImportFileInput) {
    rawMaterialsImportFileInput.addEventListener('change', handleImportFileSelected);
  }

  if (importDropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      importDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        importDropzone.classList.add('drag-active');
      }, false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
      importDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        importDropzone.classList.remove('drag-active');
      }, false);
    });
    importDropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        handleImportFileSelected({ target: { files: dt.files } });
      }
    });
  }

  // Finished Food Catalog Modal triggers
  const ffClose = document.getElementById('finishedFoodCatalogClose');
  const ffDone = document.getElementById('finishedFoodCatalogDoneBtn');
  if (ffClose) ffClose.addEventListener('click', closeFinishedFoodCatalogModal);
  if (ffDone) ffDone.addEventListener('click', closeFinishedFoodCatalogModal);

  const btnOpenAddFp = document.getElementById('btnOpenAddFinishedProductPopup');
  if (btnOpenAddFp) btnOpenAddFp.addEventListener('click', openAddFinishedProductPanel);

  const btnCancelAddFp = document.getElementById('btnCancelAddFinishedProduct');
  if (btnCancelAddFp) btnCancelAddFp.addEventListener('click', closeAddFinishedProductPanel);

  const btnAddNewFpMat = document.getElementById('btnAddNewFpMaterial');
  if (btnAddNewFpMat) btnAddNewFpMat.addEventListener('click', handleAddNewFpMaterial);

  const addFpForm = document.getElementById('addFinishedProductForm');
  if (addFpForm) addFpForm.addEventListener('submit', handleAddFinishedProductSubmit);

  const ffSearch = document.getElementById('finishedFoodPopupSearchInput');
  if (ffSearch) {
    ffSearch.addEventListener('input', (e) => {
      renderFinishedFoodModalContent(e.target.value);
    });
  }

  // Finished Product Formulation Modal close & header actions
  const fpPopupClose = document.getElementById('fpPopupClose');
  const fpPopupCloseBtn = document.getElementById('fpPopupCloseBtn');
  if (fpPopupClose) fpPopupClose.addEventListener('click', closeFinishedProductModal);
  if (fpPopupCloseBtn) fpPopupCloseBtn.addEventListener('click', closeFinishedProductModal);

  const btnFpDetailEdit = document.getElementById('btnFpDetailEdit');
  if (btnFpDetailEdit) {
    btnFpDetailEdit.addEventListener('click', () => {
      const titleEl = document.getElementById('fpPopupTitle');
      const name = titleEl ? titleEl.textContent.trim() : '';
      if (name) openEditFinishedProductPanel(name);
    });
  }

  const btnFpDetailDelete = document.getElementById('btnFpDetailDelete');
  if (btnFpDetailDelete) {
    btnFpDetailDelete.addEventListener('click', () => {
      const titleEl = document.getElementById('fpPopupTitle');
      const name = titleEl ? titleEl.textContent.trim() : '';
      if (name) promptDeleteFinishedProduct(name);
    });
  }

  // Delete Finished Product Confirmation Modal
  const deleteFpClose = document.getElementById('deleteFpConfirmCloseBtn');
  const deleteFpCancel = document.getElementById('deleteFpConfirmCancelBtn');
  const deleteFpSubmit = document.getElementById('deleteFpConfirmSubmitBtn');
  if (deleteFpClose) deleteFpClose.addEventListener('click', closeDeleteFinishedProductModal);
  if (deleteFpCancel) deleteFpCancel.addEventListener('click', closeDeleteFinishedProductModal);
  if (deleteFpSubmit) deleteFpSubmit.addEventListener('click', handleConfirmDeleteFinishedProduct);

  // Specifications popup listeners
  const specsPopupClose = document.getElementById('specsPopupClose');
  const specsPopupDoneBtn = document.getElementById('specsPopupDoneBtn');
  if (specsPopupClose) specsPopupClose.addEventListener('click', closeRawMaterialSpecsPopup);
  if (specsPopupDoneBtn) specsPopupDoneBtn.addEventListener('click', closeRawMaterialSpecsPopup);

  const specsMatSelect = document.getElementById('specsPopupMaterialSelect');
  if (specsMatSelect) {
    specsMatSelect.addEventListener('change', () => {
      currentSpecsPopupRawName = specsMatSelect.value;
      renderSpecsPopupContent();
    });
  }

  const specsSearchInput = document.getElementById('specsPopupSearchInput');
  if (specsSearchInput) {
    specsSearchInput.addEventListener('input', () => {
      renderSpecsPopupContent();
    });
  }

  const specsPopupAddNewBtn = document.getElementById('specsPopupAddNewBtn');
  if (specsPopupAddNewBtn) {
    specsPopupAddNewBtn.addEventListener('click', () => {
      openSpecsUpdatePanel(null, 'add');
    });
  }

  const specsUpdateCancelBtn = document.getElementById('specsUpdateCancelBtn');
  if (specsUpdateCancelBtn) {
    specsUpdateCancelBtn.addEventListener('click', () => {
      const panel = document.getElementById('specsUpdatePanel');
      if (panel) panel.style.display = 'none';
    });
  }

  const specsInlineForm = document.getElementById('specsInlineUpdateForm');
  if (specsInlineForm) {
    specsInlineForm.addEventListener('submit', handleSpecsInlineUpdateSubmit);
  }

  const specsPopupTableBody = document.getElementById('specsPopupTableBody');
  if (specsPopupTableBody) {
    specsPopupTableBody.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!id) return;

      if (action === 'popup-edit') {
        openSpecsUpdatePanel(id, 'edit');
      } else if (action === 'popup-history') {
        openMaterialHistoryModal(id);
      }
    });
  }

  // Backdrop click dismissal for all modals
  document.querySelectorAll('.mgr-modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeAllModals();
      }
    });
  });

  // Global ESC key to close any open modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });
}

function toggleClearFiltersBtn() {
  const clearBtn = document.getElementById('invClearFiltersBtn');
  if (!clearBtn) return;
  const isFiltered = searchQuery !== '' || locationFilter !== 'all' || sortFilter !== 'az';
  clearBtn.hidden = !isFiltered;
}

/**
 * ==========================================================
 * ADD MATERIAL FLOW
 * ==========================================================
 */
function openAddMaterialModal() {
  const modal = document.getElementById('modalAddMaterial');
  if (!modal) return;

  let nextCode = 'RM-060';
  try {
    nextCode = getSystemNextItemCode(rawMaterials);
  } catch (err) {
    console.warn('Could not compute next code:', err);
    const existingIds = rawMaterials.map(m => parseInt((m.id || '').replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 59;
    nextCode = `RM-${String(maxId + 1).padStart(3, '0')}`;
  }

  const form = document.getElementById('addMaterialForm');
  if (form && typeof form.reset === 'function') form.reset();

  const idInput = document.getElementById('addMatId');
  if (idInput) {
    idInput.value = nextCode;
    idInput.readOnly = true;
  }

  const feedback = document.getElementById('addMatNameFeedback');
  if (feedback) {
    feedback.style.display = 'none';
    feedback.textContent = '';
  }
  const nameInput = document.getElementById('addMatName');
  if (nameInput) {
    nameInput.style.borderColor = '';
  }

  const addedByInput = document.getElementById('addMatAddedBy');
  if (addedByInput) addedByInput.value = 'Store Manager';

  showModalBackdrop(modal);
}

function closeAddModal() {
  const modal = document.getElementById('modalAddMaterial');
  hideModalBackdrop(modal);
}

function handleAddMaterialSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('addMatId').value.trim().toUpperCase();
  const rawMaterialName = document.getElementById('addMatName').value.trim();
  const specInput = document.getElementById('addMatSpecName');
  const specificationName = (specInput && specInput.value.trim()) ? specInput.value.trim() : rawMaterialName;
  const catInput = document.getElementById('addMatCategory');
  const category = catInput ? catInput.value : 'Baking Supplies';
  const unit = document.getElementById('addMatUnit').value;
  const currentStock = parseFloat(document.getElementById('addMatCurrentStock').value) || 0;
  const minStock = parseFloat(document.getElementById('addMatMinStock').value) || 0;
  const maxStockInput = document.getElementById('addMatMaxStock');
  const maxStock = (maxStockInput && parseFloat(maxStockInput.value)) || (minStock * 5) || 100;
  const locEl = document.getElementById('addMatLocation');
  const location = (locEl && locEl.value.trim()) || DEFAULT_LOCATIONS[category] || 'Warehouse A - Shelf 1';
  const supEl = document.getElementById('addMatSupplier');
  const supplier = (supEl && supEl.value.trim()) || DEFAULT_SUPPLIERS[category] || 'General Supply Co.';
  const descEl = document.getElementById('addMatDescription');
  const description = (descEl && descEl.value.trim()) || `Raw material ${rawMaterialName} registered by Manager.`;

  if (!rawMaterialName) {
    alert('Please enter a raw material name.');
    return;
  }

  // Exact duplicate name check:
  // e.g. "Salt" and "salt" are duplicate -> warn & prevent.
  // "Sea Salt" vs "Salt" are NOT duplicates -> allowed!
  const nameTrimmedLower = rawMaterialName.toLowerCase();
  const exactDuplicate = rawMaterials.find(m => (m.raw_material_name || m.name || '').trim().toLowerCase() === nameTrimmedLower);
  if (exactDuplicate) {
    alert(`Raw material "${exactDuplicate.raw_material_name || exactDuplicate.name}" already exists in the catalog (${exactDuplicate.id}). Please enter a unique raw material name.`);
    const nameInput = document.getElementById('addMatName');
    const feedback = document.getElementById('addMatNameFeedback');
    if (nameInput) {
      nameInput.focus();
      nameInput.style.borderColor = '#DC2626';
    }
    if (feedback) {
      feedback.style.display = 'block';
      feedback.style.color = '#DC2626';
      feedback.textContent = `⚠️ Raw material "${exactDuplicate.raw_material_name || exactDuplicate.name}" already exists (Code: ${exactDuplicate.id}).`;
    }
    return;
  }

  const overrides = getStoredOverrides();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = dateStr + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  overrides[id] = {
    name: rawMaterialName,
    raw_material_name: rawMaterialName,
    specification_name: specificationName,
    category,
    unit,
    current_stock: currentStock,
    minimum_stock: minStock,
    maximum_stock: maxStock,
    storage_location: location,
    supplier,
    description,
    date_added: dateStr,
    last_updated: timeStr,
    added_by: 'Store Manager'
  };

  saveStoredOverrides(overrides);

  // Sync with system-materials module
  saveCustomRawMaterial({
    id,
    item_code: id,
    name: rawMaterialName,
    raw_material_name: rawMaterialName,
    specification_name: specificationName,
    category,
    unit_of_measure: unit,
    unit,
    current_stock: currentStock,
    minimum_threshold: minStock,
    minimum_stock: minStock,
    reorder_quantity: maxStock / 2,
    lead_time_days: 3,
    description,
    created_at: now.toISOString()
  });

  logMaterialHistory(id, 'Created', `Registered raw material "${rawMaterialName}" (${specificationName}) in catalog with initial stock of ${currentStock} ${unit}.`);

  closeAddModal();
  loadMaterials();
  renderUI();
  showToast(`Material "${rawMaterialName}" (${id}) created successfully.`, 'success');
}

/**
 * ==========================================================
 * DELETE MATERIAL FLOW
 * ==========================================================
 */
let pendingDeleteMaterialId = null;

function promptDeleteMaterial(id, name) {
  pendingDeleteMaterialId = id;
  const modal = document.getElementById('modalDeleteConfirm');
  const nameEl = document.getElementById('deleteTargetMaterialName');
  const codeEl = document.getElementById('deleteTargetMaterialCode');
  if (nameEl) nameEl.textContent = name || id;
  if (codeEl) codeEl.textContent = id;
  if (modal) showModalBackdrop(modal);
}

function closeDeleteConfirmModal() {
  pendingDeleteMaterialId = null;
  const modal = document.getElementById('modalDeleteConfirm');
  if (modal) hideModalBackdrop(modal);
}

function handleConfirmDeleteMaterial() {
  if (!pendingDeleteMaterialId) return;
  const id = pendingDeleteMaterialId;
  const mat = rawMaterials.find(m => m.id === id);
  const name = mat ? (mat.raw_material_name || mat.name) : id;

  deleteSystemRawMaterial(id);
  closeDeleteConfirmModal();
  loadMaterials();
  renderUI();
  showToast(`Material "${name}" (${id}) deleted successfully.`, 'success');
}

/**
 * ==========================================================
 * EDIT MATERIAL FLOW
 * ==========================================================
 */
function openEditMaterialModal(id) {
  const m = rawMaterials.find(x => x.id === id);
  if (!m) return;

  const modal = document.getElementById('modalEditMaterial');
  if (!modal) return;

  document.getElementById('editMatId').value = m.id;
  document.getElementById('editMatName').value = m.raw_material_name || m.name;
  const editSpec = document.getElementById('editMatSpecName');
  if (editSpec) editSpec.value = m.specification_name || '';
  const editCat = document.getElementById('editMatCategory');
  if (editCat) editCat.value = m.category;
  document.getElementById('editMatUnit').value = m.unit;
  document.getElementById('editMatCurrentStock').value = m.current_stock;
  document.getElementById('editMatMinStock').value = m.minimum_stock;
  const editMax = document.getElementById('editMatMaxStock');
  if (editMax) editMax.value = m.maximum_stock || '';
  const editLoc = document.getElementById('editMatLocation');
  if (editLoc) editLoc.value = m.storage_location || '';
  const editSup = document.getElementById('editMatSupplier');
  if (editSup) editSup.value = m.supplier || '';
  const editDesc = document.getElementById('editMatDescription');
  if (editDesc) editDesc.value = m.description || '';
  document.getElementById('editModalSubtitle').textContent = `Editing specifications for ${m.raw_material_name || m.name} (${m.id})`;

  showModalBackdrop(modal);
}

function closeEditModal() {
  const modal = document.getElementById('modalEditMaterial');
  hideModalBackdrop(modal);
}

function handleEditMaterialSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('editMatId').value.trim().toUpperCase();
  const m = rawMaterials.find(x => x.id === id);
  if (!m) return;

  const rawMaterialName = document.getElementById('editMatName').value.trim();
  const specInput = document.getElementById('editMatSpecName');
  const specificationName = (specInput && specInput.value.trim()) ? specInput.value.trim() : (m.specification_name || `${rawMaterialName} Standard Food Grade`);
  const editCat = document.getElementById('editMatCategory');
  const category = editCat ? editCat.value : (m.category || 'Baking Supplies');
  const unit = document.getElementById('editMatUnit').value;
  const currentStock = parseFloat(document.getElementById('editMatCurrentStock').value) || 0;
  const minStock = parseFloat(document.getElementById('editMatMinStock').value) || 0;
  const editMaxInput = document.getElementById('editMatMaxStock');
  const maxStock = (editMaxInput && parseFloat(editMaxInput.value)) || (m.maximum_stock !== undefined ? m.maximum_stock : (minStock * 5) || 100);
  const locInput = document.getElementById('editMatLocation');
  const location = (locInput && locInput.value.trim()) || (m.storage_location || 'Warehouse A - Shelf 1');
  const supInput = document.getElementById('editMatSupplier');
  const supplier = (supInput && supInput.value.trim()) || (m.supplier || 'General Supply Co.');
  const descInput = document.getElementById('editMatDescription');
  const description = (descInput && descInput.value.trim()) || (m.description || `Raw material ${rawMaterialName}`);

  // Track field diffs for history
  const diffs = [];
  if ((m.raw_material_name || m.name) !== rawMaterialName) diffs.push(`Raw material name changed to "${rawMaterialName}"`);
  if (m.specification_name !== specificationName) diffs.push(`Specification name changed to "${specificationName}"`);
  if (m.current_stock !== currentStock) diffs.push(`Stock adjusted from ${m.current_stock} to ${currentStock} ${unit}`);
  if (m.minimum_stock !== minStock) diffs.push(`Minimum threshold changed from ${m.minimum_stock} to ${minStock}`);
  if (m.storage_location !== location) diffs.push(`Location moved to ${location}`);
  if (m.supplier !== supplier) diffs.push(`Supplier updated to ${supplier}`);
  if (diffs.length === 0) diffs.push('Updated specifications');

  const overrides = getStoredOverrides();
  const now = new Date();
  const timeStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  overrides[id] = {
    ...(overrides[id] || {}),
    name: rawMaterialName,
    raw_material_name: rawMaterialName,
    specification_name: specificationName,
    category,
    unit,
    current_stock: currentStock,
    minimum_stock: minStock,
    maximum_stock: maxStock,
    storage_location: location,
    supplier,
    description,
    last_updated: timeStr
  };

  saveStoredOverrides(overrides);
  logMaterialHistory(id, 'Updated', diffs.join('. ') + '.');

  closeEditModal();
  loadMaterials();
  renderUI();
  showToast(`Material "${rawMaterialName}" (${id}) updated successfully.`, 'success');
}

/**
 * ==========================================================
 * INFORMATION / VIEW DETAILS MODAL
 * ==========================================================
 */
function openMaterialInfoModal(id) {
  const m = rawMaterials.find(x => x.id === id);
  if (!m) return;

  const modal = document.getElementById('modalMaterialInfo');
  if (!modal) return;

  document.getElementById('infoMatId').textContent = m.id;
  document.getElementById('infoMatName').textContent = m.raw_material_name || m.name;

  const specSub = document.getElementById('infoMatSpecSubtitle');
  if (specSub) specSub.textContent = `Specification: ${m.specification_name || 'Standard Grade'}`;

  const rawNameEl = document.getElementById('infoRawMaterialName');
  if (rawNameEl) rawNameEl.textContent = m.raw_material_name || m.name;

  const specNameEl = document.getElementById('infoSpecificationName');
  if (specNameEl) specNameEl.textContent = m.specification_name || '—';

  const statusTextEl = document.getElementById('infoStatusText');
  if (statusTextEl) statusTextEl.textContent = m.status;

  const statusEl = document.getElementById('infoMatStatus');
  statusEl.textContent = m.status;
  statusEl.className = `mgr-status-badge ${
    m.isArchived ? 'status-archived' : (m.status === 'Out of Stock' ? 'status-outofstock' : (m.status === 'Low Stock' ? 'status-lowstock' : 'status-instock'))
  }`;

  document.getElementById('infoCurrentStock').textContent = `${m.current_stock.toLocaleString()} ${m.unit}`;
  document.getElementById('infoMinStock').textContent = `${m.minimum_stock.toLocaleString()} ${m.unit}`;
  const infoMaxEl = document.getElementById('infoMaxStock');
  if (infoMaxEl) infoMaxEl.textContent = `${(m.maximum_stock || m.minimum_stock * 5 || 100).toLocaleString()} ${m.unit}`;

  const infoCat = document.getElementById('infoCategory');
  if (infoCat) infoCat.textContent = m.category;
  const infoUnitEl = document.getElementById('infoUnit');
  if (infoUnitEl) infoUnitEl.textContent = m.unit;
  const infoLocEl = document.getElementById('infoLocation');
  if (infoLocEl) infoLocEl.textContent = m.storage_location;
  const infoSupEl = document.getElementById('infoSupplier');
  if (infoSupEl) infoSupEl.textContent = m.supplier;
  const infoDateAddedEl = document.getElementById('infoDateAdded');
  if (infoDateAddedEl) infoDateAddedEl.textContent = m.date_added;
  const infoLastUpdatedEl = document.getElementById('infoLastUpdated');
  if (infoLastUpdatedEl) infoLastUpdatedEl.textContent = m.last_updated;
  const infoAddedByEl = document.getElementById('infoAddedBy');
  if (infoAddedByEl) infoAddedByEl.textContent = m.added_by;
  const infoDescEl = document.getElementById('infoDescription');
  if (infoDescEl) infoDescEl.textContent = m.description;

  // Direct modal action buttons
  const editBtn = document.getElementById('infoActionEditBtn');
  if (editBtn) {
    editBtn.onclick = () => {
      closeInfoModal();
      openEditMaterialModal(m.id);
    };
  }

  const histBtn = document.getElementById('infoActionHistoryBtn');
  if (histBtn) {
    histBtn.onclick = () => {
      closeInfoModal();
      openMaterialHistoryModal(m.id);
    };
  }

  const archBtn = document.getElementById('infoActionArchiveBtn');
  if (archBtn) {
    archBtn.textContent = m.isArchived ? 'Restore to Catalog' : 'Archive Material';
    archBtn.onclick = () => {
      closeInfoModal();
      openConfirmModal(m.isArchived ? 'restore' : 'archive', m.id);
    };
  }

  showModalBackdrop(modal);
}

function closeInfoModal() {
  const modal = document.getElementById('modalMaterialInfo');
  hideModalBackdrop(modal);
}

/**
 * ==========================================================
 * VIEW HISTORY MODAL
 * ==========================================================
 */
function openMaterialHistoryModal(id) {
  const m = rawMaterials.find(x => x.id === id);
  if (!m) return;

  const modal = document.getElementById('modalMaterialHistory');
  if (!modal) return;

  document.getElementById('histMatTitle').textContent = `Activity & Audit Trail: ${m.name} (${m.id})`;
  const listContainer = document.getElementById('materialHistoryList');

  const history = getMaterialHistory(id);

  if (history.length === 0) {
    listContainer.innerHTML = '<div style="padding: 24px; text-align: center; color: #64748B;">No prior history records found for this material.</div>';
  } else {
    listContainer.innerHTML = history.map(h => {
      let icon = '📜';
      if (h.type === 'Created') icon = '✨';
      if (h.type === 'Updated') icon = '✏️';
      if (h.type === 'Archived') icon = '📦';
      if (h.type === 'Restored') icon = '↩️';

      return `
        <div class="mgr-history-item">
          <div class="mgr-history-icon-col">
            <span class="mgr-history-dot">${icon}</span>
          </div>
          <div class="mgr-history-content">
            <div class="mgr-history-head">
              <span class="mgr-history-action">${h.type}</span>
              <span class="mgr-history-time">${h.timestamp}</span>
            </div>
            <div class="mgr-history-user">${h.user}</div>
            <div class="mgr-history-detail">${h.detail}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  showModalBackdrop(modal);
}

function closeHistoryModal() {
  const modal = document.getElementById('modalMaterialHistory');
  hideModalBackdrop(modal);
}

/**
 * ==========================================================
 * ARCHIVE & RESTORE CONFIRMATION MODAL
 * ==========================================================
 */
function openConfirmModal(actionType, id) {
  const m = rawMaterials.find(x => x.id === id);
  if (!m) return;

  pendingActionType = actionType;
  pendingActionMaterialId = id;

  const modal = document.getElementById('modalConfirmAction');
  if (!modal) return;

  const title = document.getElementById('confirmModalTitle');
  const msg = document.getElementById('confirmModalMessage');
  const btn = document.getElementById('confirmModalActionBtn');

  if (actionType === 'archive') {
    title.textContent = 'Archive Raw Material?';
    msg.textContent = `Are you sure you want to archive "${m.name}" (${m.id})? It will be safely moved to the Archived tab and hidden from active operational lists.`;
    btn.textContent = 'Yes, Archive Material';
    btn.className = 'btn-secondary-sm';
    btn.style.background = '#DC2626';
    btn.style.color = '#FFFFFF';
    btn.style.border = 'none';
  } else {
    title.textContent = 'Restore Raw Material?';
    msg.textContent = `Are you sure you want to restore "${m.name}" (${m.id}) back to the active catalog? Staff will be able to view and draw stock from this material again.`;
    btn.textContent = 'Yes, Restore to Catalog';
    btn.className = 'btn-primary-sm';
    btn.style.background = '#15803D';
    btn.style.color = '#FFFFFF';
    btn.style.border = 'none';
  }

  showModalBackdrop(modal);
}

function closeConfirmModal() {
  const modal = document.getElementById('modalConfirmAction');
  hideModalBackdrop(modal);
  pendingActionMaterialId = null;
  pendingActionType = null;
}

function handleConfirmActionSubmit() {
  if (!pendingActionMaterialId || !pendingActionType) return;
  const id = pendingActionMaterialId;
  const m = rawMaterials.find(x => x.id === id);
  if (!m) return;

  const archivedIds = getArchivedIds();

  if (pendingActionType === 'archive') {
    archivedIds.add(id);
    saveArchivedIds(archivedIds);
    logMaterialHistory(id, 'Archived', 'Moved material to archive. Hidden from active operational lists.');
    showToast(`Material "${m.name}" (${id}) moved to Archived.`, 'danger');
  } else {
    archivedIds.delete(id);
    saveArchivedIds(archivedIds);
    logMaterialHistory(id, 'Restored', 'Restored material back to active catalog.');
    showToast(`Material "${m.name}" (${id}) restored to Active Catalog.`, 'success');
  }

  closeConfirmModal();
  loadMaterials();
  renderUI();
}

/**
 * ==========================================================
 * FINISHED PRODUCTS TAB: FOLDER CARDS & FORMULATION POPUP
 * (FORMULATION GUIDE)
 * ==========================================================
 */
function renderFinishedProductsFolders() {
  const container = document.getElementById('finishedProductsFolderGrid');
  if (!container) return;

  const catalog = getAllFinishedProducts();

  let list = catalog;
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    list = catalog.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.materialNames && p.materialNames.some(m => m.toLowerCase().includes(q)))
    );
  }

  if (list.length === 0) {
    if (searchQuery.trim()) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px 16px; background: #FFFFFF; border-radius: 14px; border: 1px dashed #CBD5E1;">
          <div style="font-size: 32px; margin-bottom: 8px;">🍞</div>
          <strong style="display: block; font-size: 15px; color: #0F2A1B; margin-bottom: 4px;">No finished products match your search</strong>
          <p style="font-size: 13px; color: #5C7A68; margin: 0;">Try a different keyword or clear the search input.</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="mgr-fp-empty-box" style="grid-column: 1 / -1;">
          <div class="mgr-fp-empty-box-icon">📦</div>
          <h4>No finished food formulations yet</h4>
          <p>Click "+ Add Finished Product" to create your enterprise formulation recipes.</p>
          <div style="display:inline-flex; gap:10px; margin-top:6px; flex-wrap:wrap; justify-content:center;">
            <button type="button" class="btn btn-primary" onclick="openAddFinishedProductPanel()" style="font-size:12px; font-weight:700; background:#D97706; border-color:#B45309;">
              + Add Finished Product
            </button>
          </div>
        </div>
      `;
    }
    return;
  }

  container.innerHTML = list.map(p => buildFinishedProductCardHtml(p)).join('');
  attachFinishedProductCardListeners(container);
}

function openFinishedProductModal(productName) {
  const modal = document.getElementById('modalFinishedProductFolder');
  if (!modal) return;

  const product = getAllFinishedProducts().find(p => p.name.toLowerCase() === productName.toLowerCase());
  if (!product) return;

  const titleEl = document.getElementById('fpPopupTitle');
  const subEl = document.getElementById('fpPopupSubtitle');
  const countEl = document.getElementById('fpPopupCount');
  const tbody = document.getElementById('fpPopupMaterialsBody');

  if (titleEl) titleEl.textContent = product.name;
  if (subEl) subEl.textContent = `Raw Materials Formulation & Production Capacity Guide`;
  if (countEl) countEl.textContent = `${(product.materialNames || []).length} Raw Materials`;

  if (tbody) {
    tbody.innerHTML = (product.materialNames || []).map(matName => {
      const matched = rawMaterials.find(m => {
        const rName = (m.raw_material_name || m.name || '').toLowerCase();
        const sName = (m.specification_name || '').toLowerCase();
        const query = matName.toLowerCase();
        return rName.includes(query) || query.includes(rName) || sName.includes(query);
      }) || {
        raw_material_name: matName,
        specification_name: `${matName} Standard Formulation Grade`,
        current_stock: 0,
        unit: 'kg',
        status: 'Available',
        storage_location: 'Warehouse A - Shelf 1'
      };

      let statusBadge = '<span class="mgr-status-badge status-instock"><span class="mgr-status-dot"></span>Available</span>';
      let stockColor = '#15803D';
      if (matched.current_stock <= 0) {
        statusBadge = '<span class="mgr-status-badge status-outofstock"><span class="mgr-status-dot"></span>Out of Stock</span>';
        stockColor = '#DC2626';
      } else if (matched.current_stock < (matched.minimum_stock || 10)) {
        statusBadge = '<span class="mgr-status-badge status-lowstock"><span class="mgr-status-dot"></span>Low Stock</span>';
        stockColor = '#D97706';
      }

      // Calculate how many finished products it can produce in that stock
      const qtyPerUnit = BASELINE_BOM_RATIOS[matName] || (
        matName.toLowerCase().includes('sugar') || matName.toLowerCase().includes('flour') ? 0.25 :
        matName.toLowerCase().includes('oil') ? 0.08 :
        matName.toLowerCase().includes('salt') ? 0.015 : 0.15
      );
      const producible = qtyPerUnit > 0 ? Math.floor(matched.current_stock / qtyPerUnit) : 0;
      const producibleColor = producible > 0 ? '#15803D' : '#DC2626';
      const producibleBg = producible > 0 ? '#ECFDF5' : '#FEF2F2';

      return `
        <tr>
          <td>
            <strong style="color: #0F2A1B; font-size: 13.5px;">${matName}</strong>
            <small style="display:block; color: #64748B; font-size: 11px;">Recipe Raw Material</small>
          </td>
          <td style="text-align: right;">
            <strong style="color: ${stockColor}; font-size: 13px;">${Number(matched.current_stock).toLocaleString()} ${matched.unit}</strong>
          </td>
          <td><span style="font-weight:600; color:#334155; font-size:12.5px;">${matched.unit}</span></td>
          <td>${statusBadge}</td>
          <td>
            <div style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:8px; background:${producibleBg};">
              <strong style="color: ${producibleColor}; font-size: 13px;">${producible.toLocaleString()} units</strong>
              <small style="color: #64748B; font-size: 11px;">(${qtyPerUnit} ${matched.unit}/unit)</small>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  showModalBackdrop(modal);
}

function closeFinishedProductModal() {
  const modal = document.getElementById('modalFinishedProductFolder');
  hideModalBackdrop(modal);
}

/**
 * ==========================================================
 * EXPORT CHOICES MODAL & HANDLERS
 * ==========================================================
 */
function openExportChoicesModal() {
  const modal = document.getElementById('modalExportChoices');
  if (!modal) return;
  showModalBackdrop(modal);
}

function closeExportChoicesModal() {
  const modal = document.getElementById('modalExportChoices');
  hideModalBackdrop(modal);
}

/**
 * ==========================================================
 * IMPORT RAW MATERIALS FLOW
 * Required fields: Raw Material Name, Current Stock, Unit, Minimum Stock
 * Item Code is automatically assigned sequentially based on system data history.
 * Includes live percentage progress loader (like old import) and Excel (.xlsx/.xls) support.
 * ==========================================================
 */
let pendingImportMaterials = [];
let isImportCancelled = false;

function openImportRawMaterialsModal() {
  const modal = document.getElementById('modalImportRawMaterials');
  if (!modal) return;
  clearImportRawMaterialsFile();
  showModalBackdrop(modal);
}

function closeImportRawMaterialsModal() {
  const modal = document.getElementById('modalImportRawMaterials');
  hideModalBackdrop(modal);
  isImportCancelled = true;
  pendingImportMaterials = [];
}

function clearImportRawMaterialsFile() {
  pendingImportMaterials = [];
  isImportCancelled = false;

  const fileInput = document.getElementById('rawMaterialsImportFileInput');
  if (fileInput) fileInput.value = '';

  const fileInfo = document.getElementById('importFileSelectedInfo');
  if (fileInfo) fileInfo.style.display = 'none';

  const previewBox = document.getElementById('importPreviewBox');
  if (previewBox) previewBox.style.display = 'none';

  const progressBox = document.getElementById('importProgressContainer');
  if (progressBox) progressBox.style.display = 'none';

  const previewTbody = document.getElementById('importPreviewTableBody');
  if (previewTbody) previewTbody.innerHTML = '';

  const errorAlert = document.getElementById('importErrorAlert');
  if (errorAlert) {
    errorAlert.style.display = 'none';
    errorAlert.innerHTML = '';
  }

  const confirmBtn = document.getElementById('importModalConfirmBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 13l4 4L19 7"/>
      </svg>
      <span id="importModalConfirmText">Import Raw Materials</span>
    `;
  }

  const dropTitle = document.getElementById('importDropzoneTitle');
  if (dropTitle) dropTitle.textContent = 'Click to browse or drag & drop file here';
}

function downloadImportRawMaterialsTemplate() {
  const csvContent = 
`Raw Material Name,Current Stock,Unit,Minimum Stock
Organic Cane Sugar,500,kg,100
Refined Wheat Flour,750,kg,150
Pure Vegetable Oil,200,L,50
Iodized Table Salt,80,kg,20
Cocoa Powder,120,kg,30
Baking Soda,45,kg,15`;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'RMSME_Raw_Materials_Import_Template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('Downloaded Raw Materials Import Template (CSV).', 'info');
}

/**
 * Generates an array of sequential Item Codes (e.g. RM-060, RM-061 or starting from RM-001)
 * based on existing system data history.
 */
function generateSequentialItemCodes(count, currentList) {
  let list = [...(currentList || rawMaterials || [])];
  const codes = [];
  for (let i = 0; i < count; i++) {
    const nextCode = getSystemNextItemCode(list);
    codes.push(nextCode);
    list.push({ id: nextCode, item_code: nextCode });
  }
  return codes;
}

/**
 * RFC 4180 compliant CSV parser
 */
function parseCSVToRows(text) {
  const rows = [];
  let row = [''];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') { i++; }
      rows.push(row);
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
    i++;
  }
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) {
    rows.push(row);
  }
  return rows;
}

function showImportError(msg) {
  const errorAlert = document.getElementById('importErrorAlert');
  if (errorAlert) {
    errorAlert.style.display = 'block';
    errorAlert.innerHTML = `⚠️ ${msg}`;
  }
  const confirmBtn = document.getElementById('importModalConfirmBtn');
  if (confirmBtn) confirmBtn.disabled = true;
}

/**
 * Ensures SheetJS (XLSX) is available in browser with dynamic fallback
 */
async function ensureXLSX() {
  if (typeof window.XLSX !== 'undefined' && typeof window.XLSX.read === 'function') {
    return window.XLSX;
  }
  const urls = [
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'
  ];
  for (const url of urls) {
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => reject();
        document.head.appendChild(s);
      });
      if (typeof window.XLSX !== 'undefined' && typeof window.XLSX.read === 'function') {
        return window.XLSX;
      }
    } catch (e) {
      console.warn('Failed to load SheetJS from', url);
    }
  }
  return null;
}

async function handleImportFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const fileName = file.name;
  const fileSizeKB = (file.size / 1024).toFixed(1);
  const ext = fileName.split('.').pop().toLowerCase();

  if (!['csv', 'xlsx', 'xls'].includes(ext)) {
    alert('Please upload a valid .CSV or Excel (.XLSX / .XLS) file.');
    clearImportRawMaterialsFile();
    return;
  }

  // Update file selected indicator
  const fileInfo = document.getElementById('importFileSelectedInfo');
  const fileNameEl = document.getElementById('importSelectedFileName');
  const fileSizeEl = document.getElementById('importSelectedFileSize');
  const dropTitle = document.getElementById('importDropzoneTitle');

  if (fileInfo) fileInfo.style.display = 'flex';
  if (fileNameEl) fileNameEl.textContent = fileName;
  if (fileSizeEl) fileSizeEl.textContent = `(${fileSizeKB} KB)`;
  if (dropTitle) dropTitle.textContent = `Selected: ${fileName}`;

  try {
    if (ext === 'xlsx' || ext === 'xls') {
      const xlsxLib = await ensureXLSX();
      if (!xlsxLib) {
        showImportError('Excel parser (SheetJS) could not be loaded. Please save your file as .CSV and try again.');
        return;
      }

      const buffer = await file.arrayBuffer();
      const workbook = xlsxLib.read(buffer, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      // Try object rows first (header keys)
      const objRows = xlsxLib.utils.sheet_to_json(worksheet, { defval: '' });
      if (objRows && objRows.length > 0) {
        processParsedObjectRows(objRows);
        return;
      }

      // Fallback: 2D array
      const matrix = xlsxLib.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      processParsedMatrix(matrix);
    } else {
      // CSV file
      const text = await file.text();
      // Try SheetJS if available
      if (typeof window.XLSX !== 'undefined') {
        try {
          const wb = window.XLSX.read(text, { type: 'string' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const objRows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
          if (objRows && objRows.length > 0) {
            processParsedObjectRows(objRows);
            return;
          }
        } catch (e) {}
      }
      const matrix = parseCSVToRows(text);
      processParsedMatrix(matrix);
    }
  } catch (err) {
    console.error('Import file parse error:', err);
    showImportError(`Failed to parse file: ${err.message || 'Unknown error'}`);
  }
}

function processParsedObjectRows(rows) {
  if (!rows || rows.length === 0) {
    showImportError('The uploaded spreadsheet contains no data rows.');
    return;
  }

  const firstKeys = Object.keys(rows[0] || {});
  const getColKey = (keys, pattern) => keys.find(k => pattern.test(k));

  // Check required columns using forgiving regex patterns
  const nameKey = getColKey(firstKeys, /raw.*material.*name|material.*name|raw.*material|item.*name|\bname\b/i);
  const stockKey = getColKey(firstKeys, /current.*stock|current.*qty|in.*stock|\bstock\b|\bqty\b|\bquantity\b/i);
  const unitKey = getColKey(firstKeys, /unit.*of.*measure|unit.*measure|\bunit\b|\buom\b|\bmeasure\b/i);
  const minKey = getColKey(firstKeys, /min.*stock|minimum.*stock|min.*threshold|minimum.*threshold|\bmin\b|\bminimum\b|\bthreshold\b/i);

  const missing = [];
  if (!nameKey) missing.push('Raw Material Name');
  if (!stockKey) missing.push('Current Stock');
  if (!unitKey) missing.push('Unit');
  if (!minKey) missing.push('Minimum Stock');

  if (missing.length > 0) {
    showImportError(`Missing required column(s): <strong>${missing.join(', ')}</strong>.<br>Required fields: <code>Raw Material Name</code>, <code>Current Stock</code>, <code>Unit</code>, and <code>Minimum Stock</code>.<br><small style="color:#64748B;">Found columns: ${firstKeys.join(', ') || 'none'}</small>`);
    return;
  }

  const validRows = [];
  const errors = [];

  rows.forEach((r, idx) => {
    const rowNum = idx + 2;
    const rawName = String(r[nameKey] || '').trim();
    const rawStockStr = String(r[stockKey] || '').replace(/[$,]/g, '').trim();
    const rawUnit = String(r[unitKey] || '').trim();
    const rawMinStr = String(r[minKey] || '').replace(/[$,]/g, '').trim();

    if (!rawName && rawStockStr === '' && !rawUnit && rawMinStr === '') return; // Skip empty row

    const rowErrors = [];
    if (!rawName) rowErrors.push('Missing raw material name');

    const parsedStock = parseFloat(rawStockStr);
    if (rawStockStr === '' || isNaN(parsedStock) || parsedStock < 0) {
      rowErrors.push('Invalid current stock (must be a valid non-negative number)');
    }

    if (!rawUnit) {
      rowErrors.push('Missing unit of measure (e.g. kg, L, pcs)');
    }

    const parsedMin = parseFloat(rawMinStr);
    if (rawMinStr === '' || isNaN(parsedMin) || parsedMin < 0) {
      rowErrors.push('Invalid minimum stock (must be a valid non-negative number)');
    }

    if (rowErrors.length > 0) {
      errors.push(`Row ${rowNum} ("${rawName || 'Empty'}": ${rowErrors.join(', ')})`);
    } else {
      validRows.push({
        rowNum,
        name: rawName,
        current_stock: parsedStock,
        unit: rawUnit,
        minimum_stock: parsedMin
      });
    }
  });

  if (validRows.length === 0) {
    showImportError(`No valid raw material records found in spreadsheet.<br>${errors.slice(0, 5).join('<br>')}`);
    return;
  }

  // Automatic sequential code generation based on system data history
  const autoCodes = generateSequentialItemCodes(validRows.length, rawMaterials);
  const preparedItems = validRows.map((row, i) => {
    const code = autoCodes[i];
    let status = 'Available';
    let statusClass = 'status-instock';
    if (row.current_stock <= 0) {
      status = 'Out of Stock';
      statusClass = 'status-outofstock';
    } else if (row.current_stock <= row.minimum_stock) {
      status = 'Low Stock';
      statusClass = 'status-lowstock';
    }

    return {
      id: code,
      item_code: code,
      name: row.name,
      raw_material_name: row.name,
      current_stock: row.current_stock,
      unit: row.unit,
      minimum_stock: row.minimum_stock,
      status,
      statusClass
    };
  });

  pendingImportMaterials = preparedItems;
  renderImportPreview(preparedItems, errors);
}

function processParsedMatrix(matrix) {
  if (!matrix || matrix.length < 2) {
    showImportError('The uploaded file appears to be empty or contains no data rows.');
    return;
  }

  // Locate the header row (first non-empty row)
  let headerRowIndex = -1;
  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i].some(cell => String(cell).trim() !== '')) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    showImportError('Could not find a valid header row in the spreadsheet.');
    return;
  }

  const rawHeaders = matrix[headerRowIndex].map(h => String(h || '').trim());
  const nameIdx = rawHeaders.findIndex(h => /raw.*material.*name|material.*name|raw.*material|item.*name|\bname\b/i.test(h));
  const stockIdx = rawHeaders.findIndex(h => /current.*stock|current.*qty|in.*stock|\bstock\b|\bqty\b|\bquantity\b/i.test(h));
  const unitIdx = rawHeaders.findIndex(h => /unit.*of.*measure|unit.*measure|\bunit\b|\buom\b|\bmeasure\b/i.test(h));
  const minIdx = rawHeaders.findIndex(h => /min.*stock|minimum.*stock|min.*threshold|minimum.*threshold|\bmin\b|\bminimum\b|\bthreshold\b/i.test(h));

  const missingCols = [];
  if (nameIdx === -1) missingCols.push('Raw Material Name');
  if (stockIdx === -1) missingCols.push('Current Stock');
  if (unitIdx === -1) missingCols.push('Unit');
  if (minIdx === -1) missingCols.push('Minimum Stock');

  if (missingCols.length > 0) {
    showImportError(`Missing required column(s): <strong>${missingCols.join(', ')}</strong>.<br>Required format: <code>Raw Material Name</code>, <code>Current Stock</code>, <code>Unit</code>, and <code>Minimum Stock</code>.<br><small style="color:#64748B;">Found columns: ${rawHeaders.join(', ') || 'none'}</small>`);
    return;
  }

  const rawDataRows = matrix.slice(headerRowIndex + 1);
  const validRows = [];
  const errors = [];

  rawDataRows.forEach((row, idx) => {
    const rowNum = headerRowIndex + 2 + idx;
    // Skip completely empty rows
    if (!row || row.every(cell => String(cell).trim() === '')) return;

    const rawName = String(row[nameIdx] || '').trim();
    const rawStockStr = String(row[stockIdx] || '').replace(/[$,]/g, '').trim();
    const rawUnit = String(row[unitIdx] || '').trim();
    const rawMinStr = String(row[minIdx] || '').replace(/[$,]/g, '').trim();

    const rowErrors = [];
    if (!rawName) rowErrors.push('Missing raw material name');

    const parsedStock = parseFloat(rawStockStr);
    if (rawStockStr === '' || isNaN(parsedStock) || parsedStock < 0) {
      rowErrors.push('Invalid current stock (must be a valid non-negative number)');
    }

    if (!rawUnit) {
      rowErrors.push('Missing unit of measure (e.g. kg, L, pcs)');
    }

    const parsedMin = parseFloat(rawMinStr);
    if (rawMinStr === '' || isNaN(parsedMin) || parsedMin < 0) {
      rowErrors.push('Invalid minimum stock (must be a valid non-negative number)');
    }

    if (rowErrors.length > 0) {
      errors.push(`Row ${rowNum} ("${rawName || 'Empty Name'}"): ${rowErrors.join(', ')}`);
    } else {
      validRows.push({
        rowNum,
        name: rawName,
        current_stock: parsedStock,
        unit: rawUnit,
        minimum_stock: parsedMin
      });
    }
  });

  if (validRows.length === 0) {
    showImportError(`No valid raw material records found in spreadsheet.<br>${errors.slice(0, 5).join('<br>')}`);
    return;
  }

  // Automatic sequential code generation based on system data history
  const autoCodes = generateSequentialItemCodes(validRows.length, rawMaterials);
  const preparedItems = validRows.map((row, i) => {
    const code = autoCodes[i];
    let status = 'Available';
    let statusClass = 'status-instock';
    if (row.current_stock <= 0) {
      status = 'Out of Stock';
      statusClass = 'status-outofstock';
    } else if (row.current_stock <= row.minimum_stock) {
      status = 'Low Stock';
      statusClass = 'status-lowstock';
    }

    return {
      id: code,
      item_code: code,
      name: row.name,
      raw_material_name: row.name,
      current_stock: row.current_stock,
      unit: row.unit,
      minimum_stock: row.minimum_stock,
      status,
      statusClass
    };
  });

  pendingImportMaterials = preparedItems;
  renderImportPreview(preparedItems, errors);
}

function renderImportPreview(items, errors) {
  const errorAlert = document.getElementById('importErrorAlert');
  if (errorAlert) {
    if (errors && errors.length > 0) {
      errorAlert.style.display = 'block';
      errorAlert.innerHTML = `⚠️ <strong>Note:</strong> ${errors.length} row(s) had formatting issues and were skipped:<br>` +
        errors.slice(0, 4).map(e => `• ${e}`).join('<br>') +
        (errors.length > 4 ? `<br>...and ${errors.length - 4} more skipped.` : '');
    } else {
      errorAlert.style.display = 'none';
      errorAlert.innerHTML = '';
    }
  }

  const previewBox = document.getElementById('importPreviewBox');
  const tbody = document.getElementById('importPreviewTableBody');
  const titleEl = document.getElementById('importPreviewTitle');
  const badgeEl = document.getElementById('importValidationBadge');
  const confirmBtn = document.getElementById('importModalConfirmBtn');
  const confirmText = document.getElementById('importModalConfirmText');

  if (titleEl) titleEl.textContent = `Parsed Materials Preview (${items.length} Ready to Import)`;
  if (badgeEl) {
    badgeEl.textContent = `${items.length} Ready`;
    badgeEl.style.display = 'inline-block';
  }

  if (tbody) {
    tbody.innerHTML = items.map(item => `
      <tr>
        <td><strong style="color:#059669; font-family:monospace; font-size:12px;">${item.id}</strong></td>
        <td><strong>${item.name}</strong></td>
        <td style="text-align:right;">${item.current_stock.toLocaleString()}</td>
        <td>${item.unit}</td>
        <td style="text-align:right;">${item.minimum_stock.toLocaleString()}</td>
        <td><span class="mgr-status-badge ${item.statusClass}">${item.status}</span></td>
      </tr>
    `).join('');
  }

  if (previewBox) previewBox.style.display = 'block';

  if (confirmBtn) {
    confirmBtn.disabled = items.length === 0;
    if (confirmText) {
      confirmText.textContent = `Import ${items.length} Raw Material${items.length === 1 ? '' : 's'}`;
    }
  }
}

/**
 * Saves confirmed raw materials into inventory with animated percentage loader (0% -> 100%),
 * updates overrides, logs history, and refreshes the manager inventory UI.
 */
async function handleConfirmImportMaterials() {
  if (!pendingImportMaterials || pendingImportMaterials.length === 0) {
    alert('No raw materials to import. Please select a valid file first.');
    return;
  }

  isImportCancelled = false;
  const confirmBtn = document.getElementById('importModalConfirmBtn');
  const cancelBtn = document.getElementById('importModalCancelBtn');
  const closeBtn = document.getElementById('importModalCloseBtn');

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `
      <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px; margin-right: 6px; animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2 a 10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
      <span>Importing...</span>
    `;
  }

  // Show the animated circular progress & percentage box
  const progressBox = document.getElementById('importProgressContainer');
  const circleEl = document.getElementById('importCircleProgress');
  const barEl = document.getElementById('importProgressBar');
  const pctEl = document.getElementById('importPercentText');
  const statusEl = document.getElementById('importStatusText');

  if (progressBox) progressBox.style.display = 'block';
  if (circleEl) circleEl.style.strokeDashoffset = '113.1';
  if (barEl) barEl.style.width = '0%';
  if (pctEl) pctEl.textContent = '0%';

  const totalRows = pendingImportMaterials.length;
  if (statusEl) statusEl.textContent = `Importing data... (0 / ${totalRows} records)`;

  const overrides = getStoredOverrides();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = dateStr + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  let importedCount = 0;
  const CHUNK_SIZE = Math.max(1, Math.ceil(totalRows / 10));

  for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
    if (isImportCancelled) {
      console.log('Import cancelled by user.');
      break;
    }

    const chunk = pendingImportMaterials.slice(i, i + CHUNK_SIZE);

    chunk.forEach(item => {
      overrides[item.id] = {
        name: item.name,
        raw_material_name: item.name,
        specification_name: item.name,
        category: 'General Materials',
        unit: item.unit,
        current_stock: item.current_stock,
        minimum_stock: item.minimum_stock,
        maximum_stock: (item.minimum_stock * 5) || 100,
        storage_location: 'Warehouse A - Main Rack',
        supplier: 'Batch Imported via File',
        description: `Raw material ${item.name} batch imported by Store Manager.`,
        date_added: dateStr,
        last_updated: timeStr,
        added_by: 'Store Manager'
      };

      saveCustomRawMaterial({
        id: item.id,
        item_code: item.id,
        name: item.name,
        raw_material_name: item.name,
        specification_name: item.name,
        category: 'General Materials',
        unit_of_measure: item.unit,
        unit: item.unit,
        current_stock: item.current_stock,
        minimum_threshold: item.minimum_stock,
        minimum_stock: item.minimum_stock,
        reorder_quantity: Math.max(10, item.minimum_stock * 2),
        lead_time_days: 3,
        description: `Batch imported raw material ${item.name}`,
        created_at: now.toISOString()
      });

      logMaterialHistory(item.id, 'Imported', `Batch imported into inventory with initial stock of ${item.current_stock} ${item.unit} (Min: ${item.minimum_stock}).`);
      importedCount++;
    });

    // Update circular ring, progress bar and percent display
    const processedCount = Math.min(totalRows, i + CHUNK_SIZE);
    const pct = Math.round((processedCount / totalRows) * 100);
    const offset = 113.1 - (113.1 * pct) / 100;

    if (circleEl) circleEl.style.strokeDashoffset = String(offset);
    if (barEl) barEl.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (statusEl) statusEl.textContent = `Importing data... (${processedCount} / ${totalRows} records)`;

    // Brief smooth pause for visual feedback
    await new Promise(r => setTimeout(r, 65));
  }

  if (!isImportCancelled) {
    if (circleEl) circleEl.style.strokeDashoffset = '0';
    if (barEl) barEl.style.width = '100%';
    if (pctEl) pctEl.textContent = '100%';
    if (statusEl) statusEl.textContent = `Successfully imported ${totalRows} raw materials!`;

    saveStoredOverrides(overrides);

    // Wait briefly at 100% so user sees completion
    await new Promise(r => setTimeout(r, 650));

    closeImportRawMaterialsModal();
    loadMaterials();
    renderUI();
    showToast(`Successfully imported ${importedCount} raw materials into inventory!`, 'success');
  }

  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 13l4 4L19 7"/>
      </svg>
      <span id="importModalConfirmText">Import Raw Materials</span>
    `;
  }
}

function getFilteredMaterials() {
  let filtered = rawMaterials.slice();

  if (activeTab === 'all' || activeTab === 'specifications') {
    filtered = filtered.filter(m => !m.isArchived);
  } else if (activeTab === 'archived') {
    filtered = filtered.filter(m => m.isArchived);
  }

  if (statusFilter !== 'all') {
    if (statusFilter === 'Available' || statusFilter === 'In Stock') {
      filtered = filtered.filter(m => m.status === 'Available' || m.status === 'In Stock');
    } else {
      filtered = filtered.filter(m => m.status === statusFilter);
    }
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(m =>
      (m.raw_material_name || m.name || '').toLowerCase().includes(q) ||
      (m.specification_name || '').toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      m.supplier.toLowerCase().includes(q) ||
      m.storage_location.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q)
    );
  }

  if (locationFilter !== 'all') {
    filtered = filtered.filter(m => m.storage_location === locationFilter);
  }

  if (sortFilter === 'az') {
    filtered.sort((a, b) => (a.raw_material_name || a.name).localeCompare(b.raw_material_name || b.name));
  } else if (sortFilter === 'za') {
    filtered.sort((a, b) => (b.raw_material_name || b.name).localeCompare(a.raw_material_name || a.name));
  } else if (sortFilter === 'stock_asc') {
    filtered.sort((a, b) => a.current_stock - b.current_stock);
  } else if (sortFilter === 'stock_desc') {
    filtered.sort((a, b) => b.current_stock - a.current_stock);
  } else if (sortFilter === 'id_asc') {
    filtered.sort((a, b) => a.id.localeCompare(b.id));
  } else if (sortFilter === 'id_desc') {
    filtered.sort((a, b) => b.id.localeCompare(a.id));
  } else if (sortFilter === 'latest') {
    filtered.sort((a, b) => new Date(b.date_added || 0) - new Date(a.date_added || 0));
  }

  return filtered;
}

function handleExportConfirm() {
  const formatEl = document.querySelector('input[name="exportFormatRadio"]:checked');
  const scopeEl = document.querySelector('input[name="exportScopeRadio"]:checked');
  const format = formatEl ? formatEl.value : 'csv';
  const scope = scopeEl ? scopeEl.value : 'all';

  closeExportChoicesModal();

  if (scope === 'finished') {
    exportFinishedProducts(format);
    return;
  }

  let dataToExport = [];
  if (scope === 'filtered') {
    dataToExport = getFilteredMaterials();
  } else {
    dataToExport = rawMaterials.filter(m => !m.isArchived);
  }

  if (format === 'csv') {
    exportMaterialsToCSV(dataToExport);
  } else if (format === 'excel') {
    exportMaterialsToExcel(dataToExport);
  } else if (format === 'pdf') {
    printInventoryReport(dataToExport);
  }
}

function exportMaterialsToCSV(data) {
  const headers = [
    'Material ID',
    'Raw Material Name',
    'Specification Name',
    'Unit',
    'Current Stock',
    'Minimum Stock',
    'Maximum Stock',
    'Storage Location',
    'Supplier',
    'Status',
    'Date Added',
    'Last Updated',
    'Added By',
    'Description'
  ];

  const rows = data.map(m => [
    `"${m.id}"`,
    `"${(m.raw_material_name || m.name || '').replace(/"/g, '""')}"`,
    `"${(m.specification_name || '').replace(/"/g, '""')}"`,
    `"${m.unit}"`,
    m.current_stock,
    m.minimum_stock,
    m.maximum_stock,
    `"${(m.storage_location || '').replace(/"/g, '""')}"`,
    `"${(m.supplier || '').replace(/"/g, '""')}"`,
    `"${m.status}"`,
    `"${m.date_added || ''}"`,
    `"${m.last_updated || ''}"`,
    `"${m.added_by || ''}"`,
    `"${(m.description || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `RMSME_Raw_Materials_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast(`Exported ${data.length} materials as CSV.`, 'success');
}

function exportMaterialsToExcel(data) {
  const dateStr = new Date().toISOString().slice(0, 10);
  let html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Raw Materials</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      <meta charset="utf-8">
      <style>
        table { border-collapse: collapse; width: 100%; font-family: Calibri, sans-serif; font-size: 11pt; }
        th { background: #15803D; color: #FFFFFF; font-weight: bold; border: 1px solid #0F2A1B; padding: 8px 12px; }
        td { border: 1px solid #D1D5DB; padding: 6px 10px; }
      </style>
    </head>
    <body>
      <h2>RMSME Raw Materials Inventory Catalog</h2>
      <p>Export Date: ${new Date().toLocaleString()} | Total Records: ${data.length}</p>
      <table>
        <thead>
          <tr>
            <th>Material ID</th>
            <th>Raw Material Name</th>
            <th>Specification Name</th>
            <th>Unit</th>
            <th>Current Stock</th>
            <th>Min Stock</th>
            <th>Max Stock</th>
            <th>Storage Location</th>
            <th>Supplier</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(m => `
            <tr>
              <td>${m.id}</td>
              <td><b>${m.raw_material_name || m.name}</b></td>
              <td>${m.specification_name || ''}</td>
              <td>${m.unit}</td>
              <td style="text-align:right;">${m.current_stock}</td>
              <td style="text-align:right;">${m.minimum_stock}</td>
              <td style="text-align:right;">${m.maximum_stock}</td>
              <td>${m.storage_location}</td>
              <td>${m.supplier}</td>
              <td>${m.status}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `RMSME_Raw_Materials_${dateStr}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`Exported ${data.length} materials as Excel workbook.`, 'success');
}

function printInventoryReport(data) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to open the print preview.');
    return;
  }

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>RMSME Inventory Catalog Audit Report - ${dateStr}</title>
      <style>
        body { font-family: 'Inter', -apple-system, sans-serif; color: #0F172A; padding: 24px; margin: 0; font-size: 12px; }
        .head { display: flex; justify-content: space-between; border-bottom: 2px solid #15803D; padding-bottom: 12px; margin-bottom: 16px; }
        h1 { font-size: 20px; color: #15803D; margin: 0 0 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { background: #F0FDF4; color: #15803D; border-bottom: 2px solid #BBF7D0; padding: 8px 10px; text-align: left; font-weight: 700; }
        td { border-bottom: 1px solid #E2E8F0; padding: 7px 10px; vertical-align: middle; }
        .badge { padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 10px; }
        .instock { background: #DCFCE7; color: #15803D; }
        .lowstock { background: #FEF3C7; color: #B45309; }
        .outstock { background: #FEE2E2; color: #DC2626; }
        @media print {
          @page { size: landscape; margin: 12mm; }
        }
      </style>
    </head>
    <body>
      <div class="head">
        <div>
          <h1>RMSME — Raw Materials Inventory Report</h1>
          <div style="color: #64748B;">Manager View Catalog Audit Sheet</div>
        </div>
        <div style="text-align: right;">
          <div><strong>Date:</strong> ${dateStr}</div>
          <div><strong>Records:</strong> ${data.length} materials</div>
          <div><strong>Prepared By:</strong> Store Manager</div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Raw Material Name</th>
            <th>Specification Name</th>
            <th>Stock Level</th>
            <th>Thresholds (Min/Max)</th>
            <th>Storage Location</th>
            <th>Supplier</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(m => `
            <tr>
              <td><strong>${m.id}</strong></td>
              <td><strong>${m.raw_material_name || m.name}</strong></td>
              <td>${m.specification_name || ''}</td>
              <td>${m.current_stock} ${m.unit}</td>
              <td>Min: ${m.minimum_stock} | Max: ${m.maximum_stock} ${m.unit}</td>
              <td>${m.storage_location}</td>
              <td>${m.supplier}</td>
              <td>
                <span class="badge ${m.status === 'Available' ? 'instock' : (m.status === 'Low Stock' ? 'lowstock' : 'outstock')}">
                  ${m.status}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top: 24px; text-align: right; color: #64748B; font-size: 10px;">
        RMSME Automated Operations System • Certified Official Audit Printout
      </div>
    </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 400);

  showToast('Opened printable inventory report.', 'success');
}

function exportFinishedProducts(format) {
  const catalog = getAllFinishedProducts();

  if (format === 'csv') {
    const headers = ['Finished Product', 'Raw Material', 'Current Stock', 'Unit', 'Stock Status', 'Products Can Produce'];
    const rows = [];
    catalog.forEach(p => {
      (p.materialNames || []).forEach(matName => {
        const matched = rawMaterials.find(m => {
          const rName = (m.raw_material_name || m.name || '').toLowerCase();
          return rName.includes(matName.toLowerCase()) || matName.toLowerCase().includes(rName);
        }) || { specification_name: 'Standard Food Grade', current_stock: 0, unit: '', status: 'Available', storage_location: 'Warehouse A' };

        const qtyPerUnit = BASELINE_BOM_RATIOS[matName] || (
          matName.toLowerCase().includes('sugar') || matName.toLowerCase().includes('flour') ? 0.25 :
          matName.toLowerCase().includes('oil') ? 0.08 :
          matName.toLowerCase().includes('salt') ? 0.015 : 0.15
        );
        const producibleUnits = qtyPerUnit > 0 ? Math.floor(matched.current_stock / qtyPerUnit) : 0;

        rows.push([
          `"${p.name.replace(/"/g, '""')}"`,
          `"${matName.replace(/"/g, '""')}"`,
          matched.current_stock,
          `"${matched.unit}"`,
          `"${matched.status}"`,
          `"${producibleUnits} units"`
        ]);
      });
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = `RMSME_Finished_Products_Formulations_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`Exported ${catalog.length} finished product recipes as CSV.`, 'success');
  } else if (format === 'excel') {
    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <style>
          table { border-collapse: collapse; width: 100%; font-family: Calibri, sans-serif; font-size: 11pt; }
          th { background: #D97706; color: #FFFFFF; font-weight: bold; border: 1px solid #78350F; padding: 8px 12px; }
          td { border: 1px solid #D1D5DB; padding: 6px 10px; }
        </style>
      </head>
      <body>
        <h2>RMSME Finished Products &amp; Raw Materials Formulations</h2>
        <p><b>Generated:</b> ${new Date().toLocaleString()}</p>
        <table>
          <thead>
            <tr>
              <th>Finished Product</th>
              <th>Raw Material</th>
              <th>Current Stock</th>
              <th>Unit</th>
              <th>Status</th>
              <th>Products Can Produce</th>
            </tr>
          </thead>
          <tbody>
            ${catalog.flatMap(p => (p.materialNames || []).map(matName => {
              const matched = rawMaterials.find(m => (m.raw_material_name || m.name || '').toLowerCase().includes(matName.toLowerCase())) || { current_stock: 0, unit: '', status: 'Available', storage_location: 'Warehouse A' };
              const qtyPerUnit = BASELINE_BOM_RATIOS[matName] || (
                matName.toLowerCase().includes('sugar') || matName.toLowerCase().includes('flour') ? 0.25 :
                matName.toLowerCase().includes('oil') ? 0.08 :
                matName.toLowerCase().includes('salt') ? 0.015 : 0.15
              );
              const producibleUnits = qtyPerUnit > 0 ? Math.floor(matched.current_stock / qtyPerUnit) : 0;
              return `
                <tr>
                  <td><b>${p.name}</b></td>
                  <td>${matName}</td>
                  <td style="text-align:right;">${matched.current_stock}</td>
                  <td>${matched.unit}</td>
                  <td>${matched.status}</td>
                  <td style="text-align:right;"><b>${producibleUnits} units</b></td>
                </tr>
              `;
            })).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `RMSME_Finished_Products_Formulations_${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${catalog.length} finished product recipes as Excel.`, 'success');
  } else {
    printInventoryReport(rawMaterials.filter(m => !m.isArchived));
  }
}

/**
 * Global Helpers
 */
function closeAllModals() {
  closeAddModal();
  closeEditModal();
  closeInfoModal();
  closeHistoryModal();
  closeConfirmModal();
  closeRawMaterialSpecsPopup();
  closeAddFinishedProductPanel();
  closeFinishedFoodCatalogModal();
  closeFinishedProductModal();
  closeDeleteFinishedProductModal();
  closeExportChoicesModal();
  closeImportRawMaterialsModal();
}

function showToast(message, type = 'info') {
  let container = document.getElementById('mgrToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'mgrToastContainer';
    container.className = 'mgr-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `mgr-toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : (type === 'danger' ? '⚠' : 'ℹ')}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// Final guarantee of global exposure
exposeModalFunctionsToWindow();
