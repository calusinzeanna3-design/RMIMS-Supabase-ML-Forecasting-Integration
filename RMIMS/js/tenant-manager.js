// js/tenant-manager.js
// Enterprise Multi-Tenant & Role-Based Access Control (RBAC) Manager
// Enforces automatic dataset folder synchronization and strict air-gapping between:
// 1. KXC 5-Year Enterprise (Folder: a72a7971-6ec7-4edc-ae72-89d702199ed9, 59 SKUs)
// 2. Scones & Muffins Bakery (Folder: 1872cf44-e821-4370-b227-d1b7e4fc6f56, 19 SKUs)

import { AUTHENTIC_19_SCONES_MATERIALS } from "./authentic-scones-dataset.js";
import { AUTHENTIC_59_RAW_MATERIALS } from "./authentic-59-dataset.js";

export const KXC_TENANT_ID = "a72a7971-6ec7-4edc-ae72-89d702199ed9";
export const SCONES_TENANT_ID = "1872cf44-e821-4370-b227-d1b7e4fc6f56";

export const TENANT_CONFIGS = {
  [KXC_TENANT_ID]: {
    id: KXC_TENANT_ID,
    name: "KXC 5-Year Enterprise",
    alias: "KXC_COMPANY",
    datasetFolder: KXC_TENANT_ID,
    modelFile: "rmims_time_series_model.pkl",
    marginsFile: "kxc_strict_margin_boundaries_schedule.csv",
    materialsCount: 59,
    historicalSpan: "2020-2025 (5-Year Daily Dataset)",
    algorithm: "Holt-Winters Exponential Smoothing (Additive + Multiplicative)",
    corridor: "±10.0% Strict Margin Boundaries",
    lockedMape: "±7.51% Empirical Model MAPE",
    prefix: "RM-",
    defaultBranch: "Headquarters (Lucena)",
    badgeColor: "#10b981",
    isScones: false
  },
  [SCONES_TENANT_ID]: {
    id: SCONES_TENANT_ID,
    name: "Scones & Muffins Bakery",
    alias: "SCONES_MUFFINS",
    datasetFolder: SCONES_TENANT_ID,
    modelFile: "bakery_nutribun_time_series_model.pkl",
    marginsFile: "nutribun_12_year_exact_margins.csv",
    materialsCount: 19,
    historicalSpan: "2014-2025 (12-Year Nutribun Time Series)",
    algorithm: "Triple Exponential Smoothing (Holt-Winters)",
    corridor: "Weekly within ±5% / ±10% Boundaries",
    lockedMape: "Weekly MAPE: 2.70% • Daily MAPE: 7.95%",
    prefix: "NB-",
    defaultBranch: "Scones & Muffins Store (Lucena)",
    badgeColor: "#f59e0b",
    isScones: true
  }
};

/**
 * Resolves tenant details from an arbitrary user object or session.
 */
export function resolveTenantFromUser(user) {
  if (!user) {
    // Check fallback active storage keys before defaulting
    try {
      const activeFolder = localStorage.getItem("rmims_active_dataset_folder") || localStorage.getItem("rmims_active_company_id");
      if (activeFolder && TENANT_CONFIGS[activeFolder]) {
        return { ...TENANT_CONFIGS[activeFolder] };
      }
    } catch (_) {}
    return { ...TENANT_CONFIGS[SCONES_TENANT_ID] };
  }

  const strToCheck = [
    user.company_id,
    user.companyId,
    user.company_name,
    user.companyName,
    user.company,
    user.branch,
    user.store,
    user.location,
    user.branch_name,
    user.branchName,
    user.branch_store,
    user.branchStore,
    user.branch_location,
    user.branchLocation,
    user.dataset_folder,
    user.datasetFolder,
    user.role,
    user.operational_role,
    user.operationalRole,
    typeof localStorage !== 'undefined' ? localStorage.getItem("rmims_active_company_id") : '',
    typeof localStorage !== 'undefined' ? localStorage.getItem("rmims_active_company_name") : '',
    typeof localStorage !== 'undefined' ? localStorage.getItem("rmims_active_dataset_folder") : '',
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem("rmims_selected_branch") : '',
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem("rmims_selected_store") : ''
  ].map(s => String(s || '').toLowerCase()).join(' ');

  const isScones = strToCheck.includes(SCONES_TENANT_ID) ||
    strToCheck.includes("scones") ||
    strToCheck.includes("muffin") ||
    strToCheck.includes("nutribun") ||
    strToCheck.includes("bakery") ||
    !strToCheck.includes("kxc");

  return isScones ? { ...TENANT_CONFIGS[SCONES_TENANT_ID] } : { ...TENANT_CONFIGS[KXC_TENANT_ID] };
}

/**
 * Gets the current active tenant context.
 * For Admin (Zeanna), allows active store switching if selected.
 * For Managers and Staff, strictly locks into their assigned store.
 */
export function getActiveTenantContext() {
  let user = null;
  try {
    const raw = localStorage.getItem("currentUser") || 
      localStorage.getItem("rmimsCurrentUser") || 
      localStorage.getItem("userProfile") || 
      localStorage.getItem("managerUser") || 
      localStorage.getItem("staffUser");
    if (raw) user = JSON.parse(raw);
  } catch (_) {}

  const cleanEmail = (user?.email || '').toLowerCase();
  const isAdmin = cleanEmail === "calusinzeanna3@gmail.com" || 
    user?.role === "admin" || 
    user?.operationalRole === "admin" || 
    user?.operationalRole === "SUPER_ADMIN";

  if (isAdmin) {
    const adminSelected = localStorage.getItem("rmims_admin_selected_store_id") || localStorage.getItem("rmims_active_company_id");
    if (adminSelected && TENANT_CONFIGS[adminSelected]) {
      return {
        ...TENANT_CONFIGS[adminSelected],
        isAdmin: true,
        userRole: "SUPER_ADMIN",
        assignedUser: user,
        canSwitchStore: true
      };
    }
    // Default administrator view to Scones & Muffins Bakery
    return {
      ...TENANT_CONFIGS[SCONES_TENANT_ID],
      isAdmin: true,
      userRole: "SUPER_ADMIN",
      assignedUser: user,
      canSwitchStore: true
    };
  }

  const baseConfig = resolveTenantFromUser(user);
  return {
    ...baseConfig,
    isAdmin: !!isAdmin,
    userRole: user?.role || user?.operationalRole || (isAdmin ? "SUPER_ADMIN" : "manager"),
    assignedUser: user,
    canSwitchStore: !!isAdmin // Only Admin can switch stores
  };
}

/**
 * Validates whether the active session is permitted to access a given folder.
 * Returns true if permitted, or throws an RBAC violation.
 */
export function assertRbacFolderAccess(targetFolder) {
  const ctx = getActiveTenantContext();
  if (ctx.isAdmin) return true; // Super Admin has dual-tenant audit rights

  if (ctx.datasetFolder !== targetFolder) {
    const err = new Error(`[STRICT RBAC VIOLATION] Session role '${ctx.userRole}' assigned to store '${ctx.name}' is strictly prohibited from opening AI forecasting folder '${targetFolder}'!`);
    err.name = "RbacPermissionError";
    console.error(err);
    throw err;
  }
  return true;
}

/**
 * Sets the active tenant for Admin session only.
 */
export function setAdminActiveTenant(tenantId) {
  const ctx = getActiveTenantContext();
  if (!ctx.isAdmin) {
    console.warn("[RBAC] Only Administrator can switch store view contexts.");
    return false;
  }

  if (TENANT_CONFIGS[tenantId]) {
    localStorage.setItem("rmims_admin_selected_store_id", tenantId);
    localStorage.setItem("rmims_active_company_id", tenantId);
    localStorage.setItem("rmims_active_company_name", TENANT_CONFIGS[tenantId].name);
    localStorage.setItem("rmims_active_dataset_folder", TENANT_CONFIGS[tenantId].datasetFolder);
    window.dispatchEvent(new CustomEvent("rmims:store-switched", { detail: TENANT_CONFIGS[tenantId] }));
    window.dispatchEvent(new Event("storage"));
    return true;
  }
  return false;
}

/**
 * Returns the authoritative materials array matching the active tenant.
 */
export function getTenantMaterials() {
  const ctx = getActiveTenantContext();
  if (ctx.isScones) {
    return AUTHENTIC_19_SCONES_MATERIALS.map(m => ({
      ...m,
      id: m.item_code,
      itemCode: m.item_code,
      unit_of_measure: m.unit,
      current_stock: Number(m.current_stock || 0),
      minimum_threshold: Number(m.minimum_threshold || 10)
    }));
  }

  return AUTHENTIC_59_RAW_MATERIALS.map(m => ({
    ...m,
    id: m.item_code || m.id,
    itemCode: m.item_code || m.id,
    unit_of_measure: m.unit || m.unit_of_measure || "kg",
    current_stock: Number(m.current_stock || 0),
    minimum_threshold: Number(m.minimum_threshold || 10)
  }));
}
