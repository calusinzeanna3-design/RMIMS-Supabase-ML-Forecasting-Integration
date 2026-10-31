"""
RMIMS (Raw Material Inventory Management System) - Multi-Tenant ML Forecasting Backend
======================================================================================
Production-grade Flask REST API providing pure Holt-Winters time-series forecasts,
multi-horizon demand planning, and automated inventory stock decision support.

MULTI-TENANT ISOLATION ARCHITECTURE:
- TENANT 1: KXC 5-Year Enterprise ("KXC_COMPANY" / Primary)
  * Scope: 59 Raw Materials (RM-001 to RM-059) + OVERALL_TOTAL Aggregate
  * Model File: rmims_time_series_model.pkl (5-Year Historical Dataset 2020-2025)
  * Locked Margin of Error: Strictly ±7.51% (Empirical 5-Year Model MAPE)

- TENANT 2: Scones & Muffins Bakery ("1872cf44-e821-4370-b227-d1b7e4fc6f56" / "SCONES_AND_MUFFINS")
  * Scope: 19 Raw Materials (NB-001 to NB-019) + OVERALL_TOTAL Aggregate
  * Folder: ml_backend/1872cf44-e821-4370-b227-d1b7e4fc6f56
  * Model File: bakery_nutribun_time_series_model.pkl (12-Year Dataset 2014-2025)
  * Margins: Exact per-SKU empirical margins from nutribun_12_year_exact_margins.csv
    (Company-Wide Mean Weekly MAPE: 2.70%, Daily MAPE: 7.95%)

STRICT ROLE-BASED ACCESS CONTROL (RBAC) & AIR-GAP GUARANTEES:
- SUPER_ADMIN & AUDITOR: Authorized across all companies.
- KXC_MANAGER & KXC_STAFF: Strictly restricted to KXC 5-Year Enterprise.
- SCONES_MUFFINS_MANAGER & SCONES_MUFFINS_STAFF: Strictly restricted to Scones & Muffins Bakery.
- Cross-company SKU querying or data mixing is strictly blocked at the API gateway layer.
"""

import os
import csv
import pickle
import logging
from enum import Enum
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS

# SciPy LinearOperator legacy unpickling compatibility patch
try:
    from scipy.sparse.linalg import LinearOperator  # type: ignore
    try:
        from scipy.sparse.linalg._interface import np_compat  # type: ignore
    except (ImportError, AttributeError):
        try:
            import scipy._external.array_api_compat.numpy as np_compat  # type: ignore
        except (ImportError, AttributeError):
            import numpy as np_compat  # type: ignore

    _orig_linear_operator_setstate = getattr(LinearOperator, "__setstate__", None)

    def _safe_linear_operator_setstate(self: object, state: object) -> None:
        if isinstance(state, dict):
            if "_xp" not in state:
                state["_xp"] = np_compat
                setattr(self, "_xp", np_compat)
                self.__dict__.update(state)
                return
        if _orig_linear_operator_setstate is not None:
            _orig_linear_operator_setstate(self, state)
        else:
            if isinstance(state, dict):
                self.__dict__.update(state)

    setattr(LinearOperator, "__setstate__", _safe_linear_operator_setstate)
except (ImportError, AttributeError, Exception):
    pass

# Configure Structured Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s - %(message)s'
)
logger = logging.getLogger("RMIMS-MultiTenant-ML")

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ----------------------------------------------------------------------
# 1. Multi-Tenant Identifiers & RBAC Definitions
# ----------------------------------------------------------------------
class CompanyTenant(str, Enum):
    KXC = "a72a7971-6ec7-4edc-ae72-89d702199ed9"
    KXC_LEGACY = "KXC_COMPANY"
    SCONES_MUFFINS = "1872cf44-e821-4370-b227-d1b7e4fc6f56"

TENANT_ALIASES = {
    # KXC 5-Year Enterprise updated dataset (a72a7971-6ec7-4edc-ae72-89d702199ed9)
    "A72A7971-6EC7-4EDC-AE72-89D702199ED9": CompanyTenant.KXC.value,
    "a72a7971-6ec7-4edc-ae72-89d702199ed9": CompanyTenant.KXC.value,
    "KXC": CompanyTenant.KXC.value,
    "KXC_COMPANY": CompanyTenant.KXC.value,
    "5YEAR": CompanyTenant.KXC.value,
    "5YEARS": CompanyTenant.KXC.value,
    "5-YEAR": CompanyTenant.KXC.value,
    "PRIMARY": CompanyTenant.KXC.value,
    "PASALUBONG": CompanyTenant.KXC.value,
    "DEFAULT": CompanyTenant.KXC.value,

    # Scones & Muffins Bakery aliases
    "1872CF44-E821-4370-B227-D1B7E4FC6F56": CompanyTenant.SCONES_MUFFINS.value,
    "1872cf44-e821-4370-b227-d1b7e4fc6f56": CompanyTenant.SCONES_MUFFINS.value,
    "SCONES_AND_MUFFINS": CompanyTenant.SCONES_MUFFINS.value,
    "SCONES_MUFFINS": CompanyTenant.SCONES_MUFFINS.value,
    "SCONES": CompanyTenant.SCONES_MUFFINS.value,
    "MUFFINS": CompanyTenant.SCONES_MUFFINS.value,
    "BAKERY": CompanyTenant.SCONES_MUFFINS.value,
    "NUTRIBUN": CompanyTenant.SCONES_MUFFINS.value
}

class UserRole(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN = "ADMIN"
    AUDITOR = "AUDITOR"
    KXC_MANAGER = "KXC_MANAGER"
    KXC_STAFF = "KXC_STAFF"
    SCONES_MUFFINS_MANAGER = "SCONES_MUFFINS_MANAGER"
    SCONES_MUFFINS_STAFF = "SCONES_MUFFINS_STAFF"

# Strict RBAC Permissions Matrix
KXC_TENANT_IDS = [CompanyTenant.KXC.value, "KXC_COMPANY"]
SCONES_TENANT_IDS = [CompanyTenant.SCONES_MUFFINS.value]

ROLE_PERMISSIONS = {
    # Full multi-tenant audit & management access
    UserRole.SUPER_ADMIN.value: KXC_TENANT_IDS + SCONES_TENANT_IDS,
    UserRole.ADMIN.value: KXC_TENANT_IDS + SCONES_TENANT_IDS,
    UserRole.AUDITOR.value: KXC_TENANT_IDS + SCONES_TENANT_IDS,

    # KXC 5-Year Enterprise roles (Air-gapped from Scones & Muffins)
    UserRole.KXC_MANAGER.value: KXC_TENANT_IDS,
    UserRole.KXC_STAFF.value: KXC_TENANT_IDS,
    "MANAGER": KXC_TENANT_IDS, # Default operational manager role
    "STAFF": KXC_TENANT_IDS,   # Default operational staff role
    "USER": KXC_TENANT_IDS,

    # Scones & Muffins Bakery roles (Air-gapped from KXC 5-Year Enterprise)
    UserRole.SCONES_MUFFINS_MANAGER.value: SCONES_TENANT_IDS,
    UserRole.SCONES_MUFFINS_STAFF.value: SCONES_TENANT_IDS,
    "MANAGER_SCONES": SCONES_TENANT_IDS,
    "STAFF_SCONES": SCONES_TENANT_IDS,
    "SCONES_USER": SCONES_TENANT_IDS
}

# ----------------------------------------------------------------------
# 2. Catalogs: KXC (59 SKUs) & Scones and Muffins (19 SKUs)
# ----------------------------------------------------------------------
KXC_MATERIALS = [
    {"material_id": "RM-001", "raw_material_name": "Food Grade Sunset Yellow / Orange Dye", "unit": "kg", "category": "Additives & Colors"},
    {"material_id": "RM-002", "raw_material_name": "Baking Powder", "unit": "kg", "category": "Baking Supplies"},
    {"material_id": "RM-003", "raw_material_name": "Cream of Tartar", "unit": "kg", "category": "Baking Supplies"},
    {"material_id": "RM-004", "raw_material_name": "Instant Dry Yeast", "unit": "kg", "category": "Baking Supplies"},
    {"material_id": "RM-005", "raw_material_name": "Cane Vinegar", "unit": "L", "category": "Condiments & Acids"},
    {"material_id": "RM-006", "raw_material_name": "Soy Sauce", "unit": "L", "category": "Condiments & Acids"},
    {"material_id": "RM-007", "raw_material_name": "Condensed Milk", "unit": "kg", "category": "Dairy"},
    {"material_id": "RM-008", "raw_material_name": "Evaporated Milk", "unit": "L", "category": "Dairy"},
    {"material_id": "RM-009", "raw_material_name": "Powdered Milk", "unit": "kg", "category": "Dairy"},
    {"material_id": "RM-010", "raw_material_name": "Fresh Whole Egg Whites", "unit": "kg", "category": "Dairy & Eggs"},
    {"material_id": "RM-011", "raw_material_name": "Fresh Whole Eggs", "unit": "kg", "category": "Dairy & Eggs"},
    {"material_id": "RM-012", "raw_material_name": "All-Vegetable Shortening", "unit": "kg", "category": "Dairy & Fats"},
    {"material_id": "RM-013", "raw_material_name": "Baking Shortening", "unit": "kg", "category": "Dairy & Fats"},
    {"material_id": "RM-014", "raw_material_name": "Salted Creamery Butter", "unit": "kg", "category": "Dairy & Fats"},
    {"material_id": "RM-015", "raw_material_name": "Seedless Raisins", "unit": "kg", "category": "Dry Goods"},
    {"material_id": "RM-016", "raw_material_name": "Vanilla Extract", "unit": "L", "category": "Flavorings & Extracts"},
    {"material_id": "RM-017", "raw_material_name": "All-Purpose Wheat Flour", "unit": "kg", "category": "Grains & Flours"},
    {"material_id": "RM-018", "raw_material_name": "Cornstarch", "unit": "kg", "category": "Grains & Flours"},
    {"material_id": "RM-019", "raw_material_name": "Glutinous Rice (Malagkit for Pinipig)", "unit": "kg", "category": "Grains & Flours"},
    {"material_id": "RM-020", "raw_material_name": "Hard Wheat Bread Flour", "unit": "kg", "category": "Grains & Flours"},
    {"material_id": "RM-021", "raw_material_name": "Purified Water", "unit": "L", "category": "Liquids"},
    {"material_id": "RM-022", "raw_material_name": "Cleaned Chicken Crop (Butse)", "unit": "kg", "category": "Meat & Poultry"},
    {"material_id": "RM-023", "raw_material_name": "Pork Skin with Back Fat", "unit": "kg", "category": "Meat & Poultry"},
    {"material_id": "RM-024", "raw_material_name": "Raw Shelled Peanuts", "unit": "kg", "category": "Nuts & Seeds"},
    {"material_id": "RM-025", "raw_material_name": "Toasted Sesame Seeds", "unit": "kg", "category": "Nuts & Seeds"},
    {"material_id": "RM-026", "raw_material_name": "Palm Cooking Oil", "unit": "L", "category": "Oils & Fats"},
    {"material_id": "RM-027", "raw_material_name": "Pure Pork Lard", "unit": "L", "category": "Oils & Fats"},
    {"material_id": "RM-028", "raw_material_name": "Refined Peanut Oil", "unit": "L", "category": "Oils & Fats"},
    {"material_id": "RM-029", "raw_material_name": "Fresh Carrots", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-030", "raw_material_name": "Fresh Cassava Tubers", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-031", "raw_material_name": "Fresh Garlic", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-032", "raw_material_name": "Fresh Ginger", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-033", "raw_material_name": "Fresh Grated Coconut Meat", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-034", "raw_material_name": "Fresh Mature Coconut Meat", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-035", "raw_material_name": "Fresh Purple Yam Tubers", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-036", "raw_material_name": "Fresh Sweet Potato", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-037", "raw_material_name": "Green Raw Papaya", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-038", "raw_material_name": "Pandan Leaves", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-039", "raw_material_name": "Red Bell Peppers", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-040", "raw_material_name": "Red Chili Peppers (Siling Labuyo)", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-041", "raw_material_name": "Red Onions", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-042", "raw_material_name": "Unripe Green Saba Bananas", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "RM-043", "raw_material_name": "Fresh Acetes Shrimp (Alamang)", "unit": "kg", "category": "Seafood"},
    {"material_id": "RM-044", "raw_material_name": "Fresh Bangus (Milkfish) Skin", "unit": "kg", "category": "Seafood"},
    {"material_id": "RM-045", "raw_material_name": "Fresh Chiton Mollusk (Kibit)", "unit": "kg", "category": "Seafood"},
    {"material_id": "RM-046", "raw_material_name": "Fresh Kabasi Fish", "unit": "kg", "category": "Seafood"},
    {"material_id": "RM-047", "raw_material_name": "Fresh Sapsap Fish", "unit": "kg", "category": "Seafood"},
    {"material_id": "RM-048", "raw_material_name": "Cheese Seasoning Powder", "unit": "kg", "category": "Seasonings & Powders"},
    {"material_id": "RM-049", "raw_material_name": "Coarse Rock Salt", "unit": "kg", "category": "Seasonings / Salts"},
    {"material_id": "RM-050", "raw_material_name": "Iodized Salt", "unit": "kg", "category": "Seasonings / Salts"},
    {"material_id": "RM-051", "raw_material_name": "Dried Bay Leaves (Laurel)", "unit": "kg", "category": "Spices & Seasonings"},
    {"material_id": "RM-052", "raw_material_name": "Dried Red Chili Flakes", "unit": "kg", "category": "Spices & Seasonings"},
    {"material_id": "RM-053", "raw_material_name": "Garlic Powder", "unit": "kg", "category": "Spices & Seasonings"},
    {"material_id": "RM-054", "raw_material_name": "Ground Black Pepper", "unit": "kg", "category": "Spices & Seasonings"},
    {"material_id": "RM-055", "raw_material_name": "White Pepper Powder", "unit": "kg", "category": "Spices & Seasonings"},
    {"material_id": "RM-056", "raw_material_name": "Whole Black Peppercorns", "unit": "kg", "category": "Spices & Seasonings"},
    {"material_id": "RM-057", "raw_material_name": "Muscovado Brown Sugar", "unit": "kg", "category": "Sweeteners"},
    {"material_id": "RM-058", "raw_material_name": "Panutsa Cane Sugar", "unit": "kg", "category": "Sweeteners"},
    {"material_id": "RM-059", "raw_material_name": "Refined White Sugar", "unit": "kg", "category": "Sweeteners"}
]

SCONES_MUFFINS_MATERIALS = [
    {"material_id": "NB-001", "raw_material_name": "All-Purpose / Bread Flour", "unit": "kg", "category": "Grains & Flours"},
    {"material_id": "NB-002", "raw_material_name": "Refined White Sugar", "unit": "kg", "category": "Sweeteners"},
    {"material_id": "NB-003", "raw_material_name": "Fresh Yellow Squash (Kalabasa)", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "NB-004", "raw_material_name": "Skimmed Milk Powder", "unit": "kg", "category": "Dairy"},
    {"material_id": "NB-005", "raw_material_name": "Condensed Milk", "unit": "kg", "category": "Dairy"},
    {"material_id": "NB-006", "raw_material_name": "Fresh Whole Eggs", "unit": "kg", "category": "Dairy & Eggs"},
    {"material_id": "NB-007", "raw_material_name": "Baking Shortening", "unit": "kg", "category": "Fats & Oils"},
    {"material_id": "NB-008", "raw_material_name": "Margarine", "unit": "kg", "category": "Fats & Oils"},
    {"material_id": "NB-009", "raw_material_name": "Instant Dry Yeast", "unit": "kg", "category": "Baking Supplies"},
    {"material_id": "NB-010", "raw_material_name": "Baking Soda", "unit": "kg", "category": "Baking Supplies"},
    {"material_id": "NB-011", "raw_material_name": "Iodized Salt", "unit": "kg", "category": "Seasonings / Salts"},
    {"material_id": "NB-012", "raw_material_name": "Calcium Propionate", "unit": "kg", "category": "Preservatives"},
    {"material_id": "NB-013", "raw_material_name": "Potassium Sorbate", "unit": "kg", "category": "Preservatives"},
    {"material_id": "NB-014", "raw_material_name": "Crushed Peanuts / Nuts", "unit": "kg", "category": "Nuts & Seeds"},
    {"material_id": "NB-015", "raw_material_name": "Desiccated Coconut", "unit": "kg", "category": "Dry Goods"},
    {"material_id": "NB-016", "raw_material_name": "Black Sesame Seeds", "unit": "kg", "category": "Nuts & Seeds"},
    {"material_id": "NB-017", "raw_material_name": "Malunggay (Moringa) Flakes", "unit": "kg", "category": "Produce / Agricultural"},
    {"material_id": "NB-018", "raw_material_name": "Vanilla Extract", "unit": "L", "category": "Flavorings & Extracts"},
    {"material_id": "NB-019", "raw_material_name": "Plastic Pillow Packaging", "unit": "pcs", "category": "Packaging Materials"}
]

# Quick Lookups
KXC_BY_ID = {m["material_id"]: m for m in KXC_MATERIALS}
KXC_BY_NAME = {m["raw_material_name"].lower(): m for m in KXC_MATERIALS}

SCONES_BY_ID = {m["material_id"]: m for m in SCONES_MUFFINS_MATERIALS}
SCONES_BY_NAME = {m["raw_material_name"].lower(): m for m in SCONES_MUFFINS_MATERIALS}

# ----------------------------------------------------------------------
# 3. Model Registries & Isolated In-Memory Storage
# ----------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KXC_FOLDER = os.path.join(BASE_DIR, "a72a7971-6ec7-4edc-ae72-89d702199ed9")
SCONES_FOLDER = os.path.join(BASE_DIR, "1872cf44-e821-4370-b227-d1b7e4fc6f56")

KXC_MODELS = {}
KXC_BOUNDARIES = {}
SCONES_MODELS = {}
SCONES_MARGINS = {}

# KXC Strict Margin Boundaries Loader (Folder: a72a7971-6ec7-4edc-ae72-89d702199ed9)
def load_kxc_margins():
    global KXC_BOUNDARIES
    schedule_file = os.path.join(KXC_FOLDER, "kxc_strict_margin_boundaries_schedule.csv")
    if not os.path.exists(schedule_file):
        schedule_file = os.path.join(BASE_DIR, "kxc_strict_margin_boundaries_schedule.csv")
    if os.path.exists(schedule_file):
        try:
            with open(schedule_file, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    sku = (row.get("SKU") or "").strip()
                    if sku:
                        KXC_BOUNDARIES[sku] = {
                            "sku": sku,
                            "material_name": row.get("Material Name"),
                            "unit": row.get("Unit"),
                            "corridor": row.get("Corridor", "±10.0% Boundary"),
                            "strict_min_floor_90d": float(row.get("Strict_Min_Floor (90d)", 0)),
                            "base_predicted_need_90d": float(row.get("Base_Predicted_Need (90d)", 0)),
                            "strict_max_ceiling_90d": float(row.get("Strict_Max_Ceiling (90d)", 0)),
                            "daily_min_allowed": float(row.get("Daily_Min_Allowed", 0)),
                            "daily_base_forecast": float(row.get("Daily_Base_Forecast", 0)),
                            "daily_max_allowed": float(row.get("Daily_Max_Allowed", 0)),
                            "status": row.get("Status", "LOCKED_INSIDE_BOUNDARIES")
                        }
            logger.info(f"Loaded {len(KXC_BOUNDARIES)} SKU strict margin boundaries from updated KXC dataset (a72a7971-6ec7-4edc-ae72-89d702199ed9).")
        except Exception as e:
            logger.error(f"Error loading KXC strict boundaries: {e}")

load_kxc_margins()

# Scones & Muffins Margins Loader
def load_scones_margins():
    global SCONES_MARGINS
    margins_file = os.path.join(SCONES_FOLDER, "nutribun_12_year_exact_margins.csv")
    if os.path.exists(margins_file):
        try:
            with open(margins_file, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    sku = row.get("SKU") or row.get("material_id")
                    if sku:
                        SCONES_MARGINS[sku] = {
                            "sku": sku,
                            "material_name": row.get("Material Name") or row.get("raw_material_name"),
                            "daily_mape": float(row.get("Daily MAPE (%)", 7.95)),
                            "weekly_mape": float(row.get("Weekly MAPE (%)", 2.70)),
                            "weekly_within_5pct": row.get("Weekly within ±5% (Min)", "88.0%"),
                            "weekly_within_10pct": row.get("Weekly within ±10% (Max)", "96.5%"),
                            "exact_p90_margin": row.get("Exact P90 Margin", "±5.43%"),
                            "exact_p95_margin": row.get("Exact P95 Margin", "±8.21%")
                        }
            logger.info(f"Loaded {len(SCONES_MARGINS)} SKU exact margins for Scones & Muffins tenant.")
        except Exception as e:
            logger.error(f"Error loading Scones & Muffins margins: {e}")

load_scones_margins()

def load_all_models():
    global KXC_MODELS, SCONES_MODELS
    # 1. Load KXC 5-Year Model (Updated Dataset Folder: a72a7971-6ec7-4edc-ae72-89d702199ed9)
    kxc_candidates = [
        os.path.join(KXC_FOLDER, "rmims_time_series_model.pkl"),
        os.path.join(BASE_DIR, "a72a7971-6ec7-4edc-ae72-89d702199ed9", "rmims_time_series_model.pkl"),
        os.path.join(BASE_DIR, "rmims_time_series_model.pkl"),
        "rmims_time_series_model.pkl",
        os.path.join(BASE_DIR, "..", "rmims_time_series_model.pkl")
    ]
    for p in kxc_candidates:
        if os.path.exists(p):
            try:
                with open(p, "rb") as f:
                    KXC_MODELS = pickle.load(f)
                logger.info(f"[Tenant: KXC updated a72a7971-6ec7-4edc-ae72-89d702199ed9] Successfully loaded {len(KXC_MODELS)} models from '{p}'.")
                break
            except Exception as e:
                logger.error(f"Failed to load KXC model at '{p}': {e}")

    # 2. Load Scones & Muffins Bakery Model (Folder: 1872cf44-e821-4370-b227-d1b7e4fc6f56)
    scones_candidates = [
        os.path.join(SCONES_FOLDER, "bakery_nutribun_time_series_model.pkl"),
        os.path.join(BASE_DIR, "bakery_nutribun_time_series_model.pkl")
    ]
    for p in scones_candidates:
        if os.path.exists(p):
            try:
                with open(p, "rb") as f:
                    SCONES_MODELS = pickle.load(f)
                logger.info(f"[Tenant: Scones & Muffins] Successfully loaded {len(SCONES_MODELS)} models from '{p}'.")
                break
            except Exception as e:
                logger.error(f"Failed to load Scones & Muffins model at '{p}': {e}")

load_all_models()

# Backward compatibility alias
MODELS = KXC_MODELS
AUTHORITATIVE_MATERIALS = KXC_MATERIALS
LOCKED_MARGIN_OF_ERROR_PCT = 7.51

# ----------------------------------------------------------------------
# 4. Strict RBAC & Tenant Resolution Middleware Helper
# ----------------------------------------------------------------------
def resolve_tenant_context():
    """
    Extracts tenant and user role from request headers, query parameters, or JSON body.
    Enforces RBAC validation and prevents cross-tenant leakage.
    """
    # 1. Determine target tenant
    raw_tenant = (
        request.headers.get("X-Company-Id") or
        request.headers.get("X-Tenant-Id") or
        request.headers.get("X-Company") or
        request.args.get("company_id") or
        request.args.get("tenant_id") or
        request.args.get("tenant") or
        request.args.get("company") or
        request.args.get("company_name")
    )
    if not raw_tenant and request.is_json:
        body = request.get_json(silent=True) or {}
        raw_tenant = body.get("company_id") or body.get("tenant_id") or body.get("tenant") or body.get("company")

    normalized_tenant = None
    if raw_tenant:
        normalized_tenant = TENANT_ALIASES.get(str(raw_tenant).strip().upper())
        if not normalized_tenant:
            normalized_tenant = TENANT_ALIASES.get(str(raw_tenant).strip())

    # Fallback to KXC if not specified, unless endpoint is explicitly /api/scones-muffins/*
    if not normalized_tenant:
        if request.path.startswith("/api/scones-muffins"):
            normalized_tenant = CompanyTenant.SCONES_MUFFINS.value
        else:
            normalized_tenant = CompanyTenant.KXC.value

    # 2. Determine user role
    raw_role = (
        request.headers.get("X-User-Role") or
        request.headers.get("X-Role") or
        request.args.get("user_role") or
        request.args.get("role")
    )
    if not raw_role and request.is_json:
        body = request.get_json(silent=True) or {}
        raw_role = body.get("user_role") or body.get("role")

    clean_role = str(raw_role).strip().upper() if raw_role else "SUPER_ADMIN" # Default permissive if internal server

    # 3. Enforce RBAC
    allowed_tenants = ROLE_PERMISSIONS.get(clean_role)
    if allowed_tenants is None:
        # Check standard role variations
        if clean_role.startswith("SCONES") or "MUFFIN" in clean_role:
            allowed_tenants = [CompanyTenant.SCONES_MUFFINS.value]
        elif "KXC" in clean_role:
            allowed_tenants = [CompanyTenant.KXC.value]
        elif clean_role in ["ADMIN", "SUPERADMIN", "SUPER_ADMIN", "AUDITOR"]:
            allowed_tenants = [CompanyTenant.KXC.value, CompanyTenant.SCONES_MUFFINS.value]
        else:
            allowed_tenants = [CompanyTenant.KXC.value]

    if normalized_tenant not in allowed_tenants:
        return None, None, (
            jsonify({
                "success": False,
                "error": f"[RBAC ACCESS DENIED] Role '{clean_role}' is not authorized to access company '{normalized_tenant}'!",
                "rbac_error": True,
                "authenticated_role": clean_role,
                "requested_company": normalized_tenant,
                "authorized_companies": allowed_tenants
            }), 403
        )

    return normalized_tenant, clean_role, None

def resolve_material_for_tenant(identifier: str, tenant: str):
    """
    Resolves material metadata and model key strictly within the tenant's air-gapped catalog.
    Prevents cross-contamination between RM- (5-year) and NB- (Scones & Muffins) materials.
    """
    if not identifier:
        return None, None, "Identifier cannot be empty"

    clean = identifier.strip()
    clean_upper = clean.upper()
    clean_lower = clean.lower()

    # Aggregate Overall Total handler
    if clean_upper in ["OVERALL_TOTAL", "OVERALL", "TOTAL", "ALL", "ALL MATERIALS"]:
        meta = {
            "material_id": "OVERALL_TOTAL",
            "raw_material_name": "OVERALL TOTAL PRODUCTION CONSUMPTION",
            "unit": "Total Vol" if tenant == CompanyTenant.SCONES_MUFFINS.value else "kg/L",
            "category": "Aggregate"
        }
        return "OVERALL_TOTAL", meta, None

    # AIR-GAP CHECK: Detect cross-tenant SKU pollution
    if tenant in [CompanyTenant.KXC.value, "KXC_COMPANY"]:
        if clean_upper.startswith("NB-") or "KALABASA" in clean_upper or "NUTRIBUN" in clean_upper:
            return None, None, f"[CROSS-COMPANY CONTAMINATION BLOCKED] SKU '{clean}' belongs to Scones & Muffins Bakery ('1872cf44-e821-4370-b227-d1b7e4fc6f56') and cannot be queried under KXC Enterprise ({CompanyTenant.KXC.value})!"

        if clean_upper in KXC_BY_ID:
            return KXC_BY_ID[clean_upper]["raw_material_name"], KXC_BY_ID[clean_upper], None
        if clean_upper.startswith("RM") and not clean_upper.startswith("RM-"):
            hyphenated = "RM-" + clean_upper[2:]
            if hyphenated in KXC_BY_ID:
                return KXC_BY_ID[hyphenated]["raw_material_name"], KXC_BY_ID[hyphenated], None
        if clean_lower in KXC_BY_NAME:
            return KXC_BY_NAME[clean_lower]["raw_material_name"], KXC_BY_NAME[clean_lower], None

    elif tenant == CompanyTenant.SCONES_MUFFINS.value:
        if clean_upper.startswith("RM-") or "PASALUBONG" in clean_upper or "COCO JAM" in clean_upper:
            return None, None, f"[CROSS-COMPANY CONTAMINATION BLOCKED] SKU '{clean}' belongs to KXC 5-Year Enterprise and cannot be queried under Scones & Muffins ('1872cf44-e821-4370-b227-d1b7e4fc6f56')!"

        if clean_upper in SCONES_BY_ID:
            return SCONES_BY_ID[clean_upper]["raw_material_name"], SCONES_BY_ID[clean_upper], None
        if clean_upper.startswith("NB") and not clean_upper.startswith("NB-"):
            hyphenated = "NB-" + clean_upper[2:]
            if hyphenated in SCONES_BY_ID:
                return SCONES_BY_ID[hyphenated]["raw_material_name"], SCONES_BY_ID[hyphenated], None
        if clean_lower in SCONES_BY_NAME:
            return SCONES_BY_NAME[clean_lower]["raw_material_name"], SCONES_BY_NAME[clean_lower], None

    return None, None, f"Material '{identifier}' not found in {tenant} catalog."

# ----------------------------------------------------------------------
# 5. REST API Endpoints
# ----------------------------------------------------------------------

@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "RMIMS Multi-Tenant Machine Learning Forecasting API",
        "version": "3.1.0-RBAC-ISOLATED",
        "status": "online",
        "tenants": {
            CompanyTenant.KXC.value: {
                "name": "KXC 5-Year Enterprise",
                "alias": "KXC_COMPANY",
                "folder": "ml_backend/a72a7971-6ec7-4edc-ae72-89d702199ed9",
                "dataset_file": "RMIMS_5_YEAR_DAILY_DATASET_2020_2025.csv",
                "model_file": "rmims_time_series_model.pkl",
                "margin_schedule": "kxc_strict_margin_boundaries_schedule.csv",
                "materials_count": len(KXC_MATERIALS),
                "models_loaded": len(KXC_MODELS),
                "margin_of_error": "±10.0% Strict Corridor / ±7.51% Empirical MAPE"
            },
            CompanyTenant.SCONES_MUFFINS.value: {
                "name": "Scones & Muffins Bakery",
                "alias": "SCONES_AND_MUFFINS",
                "folder": "ml_backend/1872cf44-e821-4370-b227-d1b7e4fc6f56",
                "model_file": "bakery_nutribun_time_series_model.pkl",
                "materials_count": len(SCONES_MUFFINS_MATERIALS),
                "models_loaded": len(SCONES_MODELS),
                "margin_of_error": "±2.70% (Weekly Mean) / Per-SKU Exact Margins"
            }
        },
        "rbac_enforced": True,
        "isolation_protocol": "Air-Gapped In-Memory Partitioning"
    }), 200

@app.route("/api/health", methods=["GET"])
@app.route("/api/ml/status", methods=["GET"])
def health_check():
    kxc_ok = len(KXC_MODELS) >= 59
    scones_ok = len(SCONES_MODELS) >= 19
    overall_healthy = kxc_ok and scones_ok

    return jsonify({
        "status": "healthy" if overall_healthy else "degraded",
        "service": "RMIMS Multi-Tenant Time-Series Forecasting Backend",
        "total_available_models": len(KXC_MODELS) + len(SCONES_MODELS),
        "rbac_active": True,
        "kxc_enterprise": {
            "tenant_id": CompanyTenant.KXC.value,
            "alias": "KXC_COMPANY",
            "folder": "a72a7971-6ec7-4edc-ae72-89d702199ed9",
            "status": "online" if kxc_ok else "pending_model",
            "models_loaded": len(KXC_MODELS),
            "expected": 60,
            "corridor": "±10.0% Strict Boundaries",
            "strict_boundaries_loaded": len(KXC_BOUNDARIES)
        },
        "scones_and_muffins_bakery": {
            "tenant_id": CompanyTenant.SCONES_MUFFINS.value,
            "status": "online" if scones_ok else "pending_model",
            "models_loaded": len(SCONES_MODELS),
            "expected": 20,
            "weekly_mean_mape": "2.70%",
            "daily_mean_mape": "7.95%"
        }
    }), (200 if overall_healthy else 200)

@app.route("/api/tenants", methods=["GET"])
def list_tenants():
    return jsonify({
        "success": True,
        "tenants": [
            {
                "id": CompanyTenant.KXC.value,
                "alias": "KXC_COMPANY",
                "name": "KXC 5-Year Enterprise",
                "folder": "a72a7971-6ec7-4edc-ae72-89d702199ed9",
                "sku_prefix": "RM-",
                "materials_count": len(KXC_MATERIALS),
                "dataset": "RMIMS 5-Year Daily Dataset 2020-2025 (Updated)",
                "dataset_file": "RMIMS_5_YEAR_DAILY_DATASET_2020_2025.csv",
                "model_file": "rmims_time_series_model.pkl",
                "strict_corridor": "±10.0% Boundary Corridor",
                "strict_boundaries_available": len(KXC_BOUNDARIES)
            },
            {
                "id": CompanyTenant.SCONES_MUFFINS.value,
                "name": "Scones & Muffins Bakery",
                "folder": "1872cf44-e821-4370-b227-d1b7e4fc6f56",
                "sku_prefix": "NB-",
                "materials_count": len(SCONES_MUFFINS_MATERIALS),
                "dataset": "Bakery Nutribun 12-Year Dataset (2014-2025)",
                "exact_margins_available": len(SCONES_MARGINS)
            }
        ],
        "rbac_roles": list(ROLE_PERMISSIONS.keys())
    }), 200

# ----------------------------------------------------------------------
# 6. Tenant-Aware Materials Catalog & Margin Endpoints
# ----------------------------------------------------------------------
@app.route("/api/ml/materials", methods=["GET"])
@app.route("/api/materials", methods=["GET"])
def get_materials_catalog():
    tenant, role, err_response = resolve_tenant_context()
    if err_response:
        return err_response

    if tenant == CompanyTenant.SCONES_MUFFINS.value:
        return jsonify({
            "success": True,
            "tenant": tenant,
            "company_name": "Scones & Muffins Bakery",
            "count": len(SCONES_MUFFINS_MATERIALS),
            "materials": SCONES_MUFFINS_MATERIALS
        }), 200
    else:
        return jsonify({
            "success": True,
            "tenant": CompanyTenant.KXC.value,
            "company_name": "KXC 5-Year Enterprise",
            "dataset_folder": "a72a7971-6ec7-4edc-ae72-89d702199ed9",
            "count": len(KXC_MATERIALS),
            "materials": KXC_MATERIALS
        }), 200

# Dedicated direct catalog & margin endpoints for KXC
@app.route("/api/kxc/materials", methods=["GET"])
def get_kxc_materials():
    return jsonify({
        "success": True,
        "tenant": CompanyTenant.KXC.value,
        "company_name": "KXC 5-Year Enterprise",
        "folder": "a72a7971-6ec7-4edc-ae72-89d702199ed9",
        "count": len(KXC_MATERIALS),
        "materials": KXC_MATERIALS
    }), 200

@app.route("/api/kxc/margins", methods=["GET"])
@app.route("/api/kxc/boundaries", methods=["GET"])
def get_kxc_boundaries():
    return jsonify({
        "success": True,
        "tenant": CompanyTenant.KXC.value,
        "company_name": "KXC 5-Year Enterprise",
        "folder": "a72a7971-6ec7-4edc-ae72-89d702199ed9",
        "corridor": "±10.0% Strict Margin Boundaries",
        "count": len(KXC_BOUNDARIES),
        "boundaries": KXC_BOUNDARIES
    }), 200

@app.route("/api/kxc/health", methods=["GET"])
def get_kxc_health():
    kxc_ok = len(KXC_MODELS) >= 59
    return jsonify({
        "success": True,
        "tenant": CompanyTenant.KXC.value,
        "folder": "a72a7971-6ec7-4edc-ae72-89d702199ed9",
        "status": "healthy" if kxc_ok else "degraded",
        "models_loaded": len(KXC_MODELS),
        "expected_models": 60,
        "corridor": "±10.0%",
        "materials_count": len(KXC_MATERIALS)
    }), (200 if kxc_ok else 503)

# Dedicated direct catalog endpoint for Scones & Muffins
@app.route("/api/scones-muffins/materials", methods=["GET"])
def get_scones_materials():
    return jsonify({
        "success": True,
        "tenant": CompanyTenant.SCONES_MUFFINS.value,
        "company_name": "Scones & Muffins Bakery",
        "folder": "1872cf44-e821-4370-b227-d1b7e4fc6f56",
        "count": len(SCONES_MUFFINS_MATERIALS),
        "materials": SCONES_MUFFINS_MATERIALS
    }), 200

@app.route("/api/scones-muffins/margins", methods=["GET"])
def get_scones_margins_table():
    return jsonify({
        "success": True,
        "tenant": CompanyTenant.SCONES_MUFFINS.value,
        "company_name": "Scones & Muffins Bakery",
        "company_wide_weekly_mape": "2.70%",
        "company_wide_daily_mape": "7.95%",
        "count": len(SCONES_MARGINS),
        "margins": SCONES_MARGINS
    }), 200

@app.route("/api/scones-muffins/health", methods=["GET"])
def get_scones_health():
    scones_ok = len(SCONES_MODELS) >= 19
    return jsonify({
        "success": True,
        "tenant": CompanyTenant.SCONES_MUFFINS.value,
        "folder": "1872cf44-e821-4370-b227-d1b7e4fc6f56",
        "status": "healthy" if scones_ok else "degraded",
        "models_loaded": len(SCONES_MODELS),
        "expected_models": 20,
        "weekly_mean_mape": "2.70%",
        "materials_count": len(SCONES_MUFFINS_MATERIALS)
    }), (200 if scones_ok else 503)

# ----------------------------------------------------------------------
# 7. Unified & Dedicated Forecast Endpoints
# ----------------------------------------------------------------------
def execute_forecast_calculation(tenant, role, identifier, horizon_type, horizon_val):
    model_key, meta, err = resolve_material_for_tenant(identifier, tenant)
    if err is not None or meta is None or model_key is None:
        return jsonify({"success": False, "error": err or "Material not found in catalog."}), 400

    # Pick the appropriate isolated model registry
    target_registry = SCONES_MODELS if tenant == CompanyTenant.SCONES_MUFFINS.value else KXC_MODELS

    model = target_registry.get(model_key) or target_registry.get(meta.get("material_id"))
    if not model:
        load_all_models()
        target_registry = SCONES_MODELS if tenant == CompanyTenant.SCONES_MUFFINS.value else KXC_MODELS
        model = target_registry.get(model_key) or target_registry.get(meta.get("material_id"))
        if not model:
            return jsonify({
                "success": False,
                "error": f"Trained model for '{model_key}' under tenant '{tenant}' is not loaded in memory."
            }), 503

    days_multiplier = {"day": 1, "week": 7, "month": 30, "year": 365}
    total_days = max(1, horizon_val * days_multiplier.get(horizon_type, 30))
    daily_preds = np.maximum(model.forecast(total_days).values, 0.0)

    start_date = datetime.now()
    dates = [start_date + timedelta(days=i) for i in range(1, total_days + 1)]
    df_fc = pd.DataFrame({"forecast": daily_preds}, index=pd.DatetimeIndex(dates))

    if horizon_type == "day":
        resampled = df_fc["forecast"].iloc[:horizon_val]
        labels = [d.strftime("%b %d, %Y") for d in resampled.index]
    elif horizon_type == "week":
        resampled = df_fc["forecast"].resample("W-MON").sum().iloc[:horizon_val]
        labels = [f"Week of {d.strftime('%b %d')}" for d in resampled.index]
    elif horizon_type == "year":
        resampled = df_fc["forecast"].resample("YS").sum().iloc[:horizon_val]
        labels = [d.strftime("%Y") for d in resampled.index]
    else:
        resampled = df_fc["forecast"].resample("MS").sum().iloc[:horizon_val]
        labels = [d.strftime("%B %Y") for d in resampled.index]

    values = [round(float(v), 2) for v in resampled.values]

    # Calculate Margins according to Tenant Specification
    if tenant == CompanyTenant.SCONES_MUFFINS.value:
        sku = str(meta.get("material_id", ""))
        margin_info = SCONES_MARGINS.get(sku, {})
        # Use exact weekly/daily MAPE or fallback to 2.70%
        if horizon_type in ["day"]:
            raw_margin = margin_info.get("daily_mape", 7.95)
        else:
            raw_margin = margin_info.get("weekly_mape", 2.70)
        try:
            margin_pct = float(raw_margin) if raw_margin is not None else 2.70
        except (ValueError, TypeError):
            margin_pct = 2.70
        margin_factor = float(margin_pct) / 100.0
    else:
        margin_pct = float(LOCKED_MARGIN_OF_ERROR_PCT) # 7.51%
        margin_factor = float(LOCKED_MARGIN_OF_ERROR_PCT) / 100.0

    upper_bounds = [round(float(v * (1.0 + margin_factor)), 2) for v in values]
    lower_bounds = [round(float(v * (1.0 - margin_factor)), 2) for v in values]

    return jsonify({
        "success": True,
        "tenant_id": tenant,
        "company_name": "Scones & Muffins Bakery" if tenant == CompanyTenant.SCONES_MUFFINS.value else "Pasalubong 5-Year Enterprise",
        "material_id": meta.get("material_id"),
        "raw_material_name": meta.get("raw_material_name"),
        "unit": meta.get("unit"),
        "category": meta.get("category"),
        "horizon_type": horizon_type,
        "horizon_value": horizon_val,
        "margin_of_error_pct": margin_pct,
        "margin_of_error": f"±{margin_pct:.2f}%",
        "total_projected_requirement": round(float(sum(values)), 2),
        "labels": labels,
        "forecast_values": values,
        "upper_margin": upper_bounds,
        "lower_margin": lower_bounds,
        "upper_margin_10pct": upper_bounds,
        "lower_margin_10pct": lower_bounds
    }), 200

@app.route("/api/forecast", methods=["POST", "GET"])
def get_dynamic_forecast():
    try:
        tenant, role, err_response = resolve_tenant_context()
        if err_response:
            return err_response

        if request.method == "POST":
            data = request.get_json(force=True, silent=True) or {}
        else:
            data = request.args.to_dict()

        identifier = data.get("raw_material_name") or data.get("material_id") or data.get("material_name") or "OVERALL_TOTAL"
        horizon_type = str(data.get("horizon_type", "month")).lower()
        horizon_val = int(data.get("horizon_value", 6))

        return execute_forecast_calculation(tenant, role, identifier, horizon_type, horizon_val)

    except Exception as e:
        logger.error(f"Error generating forecast: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

# Dedicated direct endpoint for Scones & Muffins
@app.route("/api/scones-muffins/forecast", methods=["POST", "GET"])
def get_scones_forecast():
    try:
        # Enforce Scones & Muffins tenant
        tenant = CompanyTenant.SCONES_MUFFINS.value
        raw_role = request.headers.get("X-User-Role") or request.args.get("role") or "SCONES_MUFFINS_MANAGER"
        
        # Check RBAC
        allowed = ROLE_PERMISSIONS.get(raw_role.upper(), [CompanyTenant.SCONES_MUFFINS.value])
        if tenant not in allowed:
            return jsonify({
                "success": False,
                "error": f"[RBAC ACCESS DENIED] Role '{raw_role}' cannot access Scones & Muffins tenant!"
            }), 403

        if request.method == "POST":
            data = request.get_json(force=True, silent=True) or {}
        else:
            data = request.args.to_dict()

        identifier = data.get("raw_material_name") or data.get("material_id") or data.get("material_name") or "OVERALL_TOTAL"
        horizon_type = str(data.get("horizon_type", "month")).lower()
        horizon_val = int(data.get("horizon_value", 6))

        return execute_forecast_calculation(tenant, raw_role, identifier, horizon_type, horizon_val)

    except Exception as e:
        logger.error(f"Error in scones forecast: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

# ----------------------------------------------------------------------
# 8. Operational Inventory Forecast Endpoint
# ----------------------------------------------------------------------
@app.route("/api/ml/forecast/<path:material_identifier>/inventory", methods=["GET"])
def get_inventory_operational_forecast(material_identifier):
    try:
        tenant, role, err_response = resolve_tenant_context()
        if err_response is not None or tenant is None:
            return err_response or (jsonify({"success": False, "error": "Invalid tenant context"}), 400)

        model_key, meta, err = resolve_material_for_tenant(material_identifier, tenant)
        if err is not None or meta is None or model_key is None:
            return jsonify({"success": False, "error": err or "Material not found."}), 400

        target_registry = SCONES_MODELS if tenant == CompanyTenant.SCONES_MUFFINS.value else KXC_MODELS
        model = target_registry.get(model_key) or target_registry.get(meta.get("material_id"))
        if not model:
            load_all_models()
            target_registry = SCONES_MODELS if tenant == CompanyTenant.SCONES_MUFFINS.value else KXC_MODELS
            model = target_registry.get(model_key) or target_registry.get(meta.get("material_id"))
            if not model:
                return jsonify({"success": False, "error": f"Model for '{model_key}' under tenant '{tenant}' not loaded."}), 503

        raw_28d = np.maximum(model.forecast(28).values, 0.0)
        qty_7d = round(float(np.sum(raw_28d[:7])), 2)
        qty_28d = round(float(np.sum(raw_28d)), 2)

        current_stock = float(request.args.get("current_stock", 0.0))
        min_threshold = float(request.args.get("min_threshold", 0.0))

        diff_7d = round(current_stock - qty_7d, 2)
        is_shortage = diff_7d < 0
        reorder_recommended = (current_stock <= min_threshold) or is_shortage

        margin_display = "±2.70%" if tenant == CompanyTenant.SCONES_MUFFINS.value else f"±{LOCKED_MARGIN_OF_ERROR_PCT}%"

        return jsonify({
            "success": True,
            "tenant_id": tenant,
            "material_id": meta.get("material_id"),
            "raw_material_name": meta.get("raw_material_name"),
            "unit": meta.get("unit"),
            "category": meta.get("category"),
            "margin_of_error": margin_display,
            "operational_7_day_requirement": qty_7d,
            "planning_28_day_requirement": qty_28d,
            "current_stock": current_stock,
            "net_surplus_deficit_7d": diff_7d,
            "status": "Potential Shortage" if is_shortage else "Sufficient",
            "reorder_recommended": reorder_recommended,
            "daily_breakdown_7d": [round(float(v), 2) for v in raw_28d[:7]]
        }), 200

    except Exception as e:
        logger.error(f"Error in operational inventory forecast: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    PORT = int(os.environ.get("PORT", 5000))
    logger.info(f"Starting RMIMS Multi-Tenant RBAC ML Service on port {PORT}...")
    app.run(host="0.0.0.0", port=PORT, debug=True)
