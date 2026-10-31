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
    isScones: false,
    companyAcronym: "KXC"
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
    isScones: true,
    companyAcronym: "SM"
  }
};

/**
 * Resolves tenant details from an arbitrary user object or session.
 * Strictly binds non-admin users (Manager, Staff) to their authenticated company.
 * Prevents stale localStorage keys from contaminating tenant assignment.
 */
export function resolveTenantFromUser(user = null) {
  // If in manager or user (staff) portal, strictly lock to Scones & Muffins Bakery
  const isManagerPortalOrUser = typeof window !== 'undefined' && 
    (window.location.pathname.includes('/manager/') || window.location.pathname.includes('/user/'));

  if (!user) {
    if (isManagerPortalOrUser) {
      try {
        localStorage.setItem("rmims_active_company_id", SCONES_TENANT_ID);
        localStorage.setItem("rmims_active_company_name", TENANT_CONFIGS[SCONES_TENANT_ID].name);
        localStorage.setItem("rmims_active_dataset_folder", TENANT_CONFIGS[SCONES_TENANT_ID].datasetFolder);
      } catch (_) {}
    }
    return { ...TENANT_CONFIGS[SCONES_TENANT_ID] };
  }

  const cleanEmail = String(user.email || '').toLowerCase().trim();
  const cleanUsername = String(user.username || user.user_metadata?.username || '').toLowerCase().trim();
  const cleanName = String(user.name || user.fullName || user.user_metadata?.full_name || '').toLowerCase().trim();
  const rawRole = String(user.role || user.operationalRole || user.operational_role || '').toLowerCase().trim();
  const isAdmin = cleanEmail === "calusinzeanna3@gmail.com" || rawRole === "admin" || rawRole === "super_admin";

  // If in manager or staff portal, or non-admin role, strictly enforce Scones & Muffins Bakery
  if ((isManagerPortalOrUser || !isAdmin) && (
    cleanName.includes("aizel") ||
    cleanUsername.includes("aizel") ||
    cleanEmail.includes("aizel") ||
    rawRole === "manager" ||
    rawRole === "staff" ||
    rawRole === "user" ||
    isManagerPortalOrUser
  )) {
    try {
      localStorage.setItem("rmims_active_company_id", SCONES_TENANT_ID);
      localStorage.setItem("rmims_active_company_name", TENANT_CONFIGS[SCONES_TENANT_ID].name);
      localStorage.setItem("rmims_active_dataset_folder", TENANT_CONFIGS[SCONES_TENANT_ID].datasetFolder);
    } catch (_) {}
    return { ...TENANT_CONFIGS[SCONES_TENANT_ID] };
  }

  // 1. Explicit Scones & Muffins account matches (Aizel, Scones Manager, Scones Staff)
  const isSconesExplicit = 
    cleanName.includes("aizel") ||
    cleanUsername.includes("aizel") ||
    cleanEmail.includes("aizel") ||
    cleanEmail === "zeannapatty@gmail.com" ||
    cleanEmail === "sconesandmuffins@gmail.com" ||
    cleanEmail === "scone2@gmail.com" ||
    cleanEmail.includes("scones") ||
    cleanUsername.includes("scones") ||
    cleanUsername.includes("muffin") ||
    cleanUsername.includes("nutribun") ||
    cleanName.includes("scones") ||
    cleanName.includes("muffin");

  if (isSconesExplicit) {
    try {
      localStorage.setItem("rmims_active_company_id", SCONES_TENANT_ID);
      localStorage.setItem("rmims_active_company_name", TENANT_CONFIGS[SCONES_TENANT_ID].name);
      localStorage.setItem("rmims_active_dataset_folder", TENANT_CONFIGS[SCONES_TENANT_ID].datasetFolder);
    } catch (_) {}
    return { ...TENANT_CONFIGS[SCONES_TENANT_ID] };
  }

  // 2. Explicit company/branch fields on the user object
  const userFields = [
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
    user.datasetFolder
  ].map(s => String(s || '').toLowerCase().trim()).join(' ');

  if (
    userFields.includes(SCONES_TENANT_ID) ||
    userFields.includes("scones") ||
    userFields.includes("muffin") ||
    userFields.includes("nutribun") ||
    userFields.includes("bakery")
  ) {
    try {
      localStorage.setItem("rmims_active_company_id", SCONES_TENANT_ID);
      localStorage.setItem("rmims_active_company_name", TENANT_CONFIGS[SCONES_TENANT_ID].name);
      localStorage.setItem("rmims_active_dataset_folder", TENANT_CONFIGS[SCONES_TENANT_ID].datasetFolder);
    } catch (_) {}
    return { ...TENANT_CONFIGS[SCONES_TENANT_ID] };
  }

  // Only allow KXC if explicitly KXC and user has admin permissions
  if (
    isAdmin && (
      userFields.includes(KXC_TENANT_ID) ||
      userFields.includes("kxc") ||
      cleanUsername.includes("kxc") ||
      cleanEmail.includes("kxc")
    )
  ) {
    try {
      localStorage.setItem("rmims_active_company_id", KXC_TENANT_ID);
      localStorage.setItem("rmims_active_company_name", TENANT_CONFIGS[KXC_TENANT_ID].name);
      localStorage.setItem("rmims_active_dataset_folder", TENANT_CONFIGS[KXC_TENANT_ID].datasetFolder);
    } catch (_) {}
    return { ...TENANT_CONFIGS[KXC_TENANT_ID] };
  }

  // 3. Fallback: check localStorage ONLY if user is admin
  if (isAdmin) {
    try {
      const activeFolder = localStorage.getItem("rmims_active_dataset_folder") || localStorage.getItem("rmims_active_company_id");
      if (activeFolder && TENANT_CONFIGS[activeFolder]) {
        return { ...TENANT_CONFIGS[activeFolder] };
      }
    } catch (_) {}
  }

  // Safe default to Scones & Muffins Bakery
  return { ...TENANT_CONFIGS[SCONES_TENANT_ID] };
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

  const cleanEmail = (user?.email || '').toLowerCase().trim();
  const isAdmin = cleanEmail === "calusinzeanna3@gmail.com" || 
    user?.role === "admin" || 
    user?.operationalRole === "admin" || 
    user?.operationalRole === "SUPER_ADMIN";

  const isManagerPortalOrUser = typeof window !== 'undefined' && 
    (window.location.pathname.includes('/manager/') || window.location.pathname.includes('/user/'));

  if (!isAdmin || isManagerPortalOrUser) {
    // Non-admins and anyone on manager/user portals are permanently locked to Scones & Muffins Bakery
    try {
      localStorage.setItem("rmims_active_company_id", SCONES_TENANT_ID);
      localStorage.setItem("rmims_active_company_name", TENANT_CONFIGS[SCONES_TENANT_ID].name);
      localStorage.setItem("rmims_active_dataset_folder", TENANT_CONFIGS[SCONES_TENANT_ID].datasetFolder);
    } catch (_) {}
    return {
      ...TENANT_CONFIGS[SCONES_TENANT_ID],
      isAdmin: false,
      userRole: user?.role || user?.operationalRole || "manager",
      assignedUser: user,
      canSwitchStore: false
    };
  }

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
    isAdmin: false,
    userRole: user?.role || user?.operationalRole || "manager",
    assignedUser: user,
    canSwitchStore: false // Only Admin can switch stores
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
    // Self-correct active context back to authentic assigned store
    try {
      localStorage.setItem("rmims_active_company_id", ctx.id);
      localStorage.setItem("rmims_active_company_name", ctx.name);
      localStorage.setItem("rmims_active_dataset_folder", ctx.datasetFolder);
    } catch (_) {}
    const err = new Error(`[STRICT RBAC VIOLATION] Session role '${ctx.userRole}' assigned to store '${ctx.name}' is strictly prohibited from opening AI forecasting folder '${targetFolder}'! Access has been reverted.`);
    err.name = "RbacPermissionError";
    console.error(err);
    throw err;
  }
  return true;
}

/**
 * Verifies whether a material code belongs to the specified tenant.
 * Guarantees zero cross-tenant raw materials leakage.
 */
export function assertMaterialBelongsToTenant(itemCode, isScones) {
  if (!itemCode) return false;
  const upper = String(itemCode).trim().toUpperCase();
  if (isScones) {
    return upper.startsWith("NB-");
  } else {
    return upper.startsWith("RM-");
  }
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
      current_stock: Number(m.current_stock ?? m.currentStock ?? 0),
      currentStock: Number(m.current_stock ?? m.currentStock ?? 0),
      minimum_threshold: Number(m.minimum_threshold || 10)
    }));
  }

  return AUTHENTIC_59_RAW_MATERIALS.map(m => ({
    ...m,
    id: m.item_code || m.id,
    itemCode: m.item_code || m.id,
    unit_of_measure: m.unit || m.unit_of_measure || "kg",
    current_stock: Number(m.current_stock ?? m.currentStock ?? 0),
    currentStock: Number(m.current_stock ?? m.currentStock ?? 0),
    minimum_threshold: Number(m.minimum_threshold || 10)
  }));
}

/**
 * Computes or resolves the unique company acronym from tenant config, user profile, or branch name.
 * Examples:
 * - "Scones & Muffins Bakery" / "Scones and Muffins" -> "SM"
 * - "KXC 5-Year Enterprise" -> "KXC"
 * - "Golden Crust Bakery" -> "GCB"
 */
export function getCompanyAcronym(tenantOrUser = null) {
  let context = tenantOrUser;
  if (!context) {
    try {
      context = getActiveTenantContext();
    } catch (_) {}
  }

  // 1. If explicit companyAcronym is defined on tenant
  if (context?.companyAcronym) {
    return String(context.companyAcronym).toUpperCase().trim();
  }
  if (context?.isScones) {
    return "SM";
  }

  // 2. Derive from company_name, companyName, branch_name, branchName, or name
  const candidateName = String(
    context?.company_name ||
    context?.companyName ||
    context?.name ||
    context?.branch_name ||
    context?.branchName ||
    context?.branch ||
    ""
  ).trim();

  if (!candidateName) return "SM"; // Default to authentic Scones & Muffins

  const lower = candidateName.toLowerCase();
  if (lower.includes("scones") || lower.includes("muffin")) return "SM";
  if (lower.includes("kxc")) return "KXC";

  // Clean and extract significant words (omit connector words)
  const words = candidateName
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => !["and", "&", "the", "of", "in", "store", "branch", "enterprise", "ph", "inc", "corp", "co"].includes(w.toLowerCase()));

  if (words.length >= 2) {
    const acronym = words.map(w => w[0].toUpperCase()).join("");
    return acronym.slice(0, 4);
  } else if (words.length === 1 && words[0].length >= 2) {
    if (words[0] === words[0].toUpperCase()) {
      return words[0].slice(0, 4);
    }
    return words[0].slice(0, 3).toUpperCase();
  }

  return "SM";
}

/**
 * Generates the standardized RBAC reference prefix for a given role and company/branch.
 * Example for Scones & Muffins in 2026:
 * - Manager: "2026SMM-"
 * - Staff: "2026SMSt-"
 */
export function getRoleReferencePrefix(role = 'manager', tenantOrUser = null, type = 'REC') {
  const currentYear = new Date().getFullYear();
  const acronym = getCompanyAcronym(tenantOrUser);
  const cleanRole = String(role || '').toLowerCase();
  const roleTag = (cleanRole === 'staff' || cleanRole === 'user') ? 'St' : 'M';
  const cleanType = String(type || 'REC').toUpperCase();
  const typeLetter = (cleanType === 'DIS' || cleanType === 'DISBURSE') ? 'D' : 'R';
  return `${currentYear}${acronym}${roleTag}-${typeLetter}`;
}
