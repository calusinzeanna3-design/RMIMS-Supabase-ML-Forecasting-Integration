"""
RMIMS (Raw Material Inventory Management System) - ML Forecasting Backend
========================================================================
Production-grade Flask REST API providing pure Holt-Winters time-series forecasts,
multi-horizon demand planning, and automated inventory stock decision support.

Author: Antigravity ML Engineering Team
Target Architecture: 59 Raw Materials + 1 OVERALL_TOTAL Aggregate Model (60 Models)
Locked Margin of Error: Strictly ±7.51% (Model 5-Year Empirical MAPE)
"""

import os
import pickle
import logging
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS

# The checked-in model was serialized before SciPy added ``_xp`` to
# LinearOperator's pickle state.  Current SciPy releases require that field
# during unpickling, so restore its standard NumPy-compatible backend only for
# those legacy objects.  Pickles produced by current SciPy keep their normal
# deserialization path.
try:
    from scipy.sparse.linalg._interface import LinearOperator, np_compat

    _linear_operator_setstate = LinearOperator.__setstate__

    def _load_legacy_linear_operator_state(instance, state):
        if "_xp" not in state:
            instance._xp = np_compat
            instance.__dict__.update(state)
            return
        _linear_operator_setstate(instance, state)

    LinearOperator.__setstate__ = _load_legacy_linear_operator_state
except (ImportError, AttributeError):
    # SciPy is installed with statsmodels in production.  Keep startup
    # compatible with environments whose SciPy version has no such hook.
    pass

# Configure Structured Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s - %(message)s'
)
logger = logging.getLogger("RMIMS-ML-Backend")

app = Flask(__name__)

# Enable Secure Cross-Origin Resource Sharing (CORS)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ----------------------------------------------------------------------
# 1. Authoritative Master Materials Catalog (59 SKUs)
# ----------------------------------------------------------------------
AUTHORITATIVE_MATERIALS = [
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

MATERIAL_BY_ID = {m["material_id"]: m for m in AUTHORITATIVE_MATERIALS}
MATERIAL_BY_NAME = {m["raw_material_name"].lower(): m for m in AUTHORITATIVE_MATERIALS}

# ----------------------------------------------------------------------
# 2. Model Loading & In-Memory Registry
# ----------------------------------------------------------------------
MODELS = {}
MODEL_FILENAMES = [
    os.path.join(os.path.dirname(__file__), "rmims_time_series_model.pkl"),
    "rmims_time_series_model.pkl",
    os.path.join(os.path.dirname(__file__), "..", "rmims_time_series_model.pkl"),
    r"C:\Users\Zeanna\anaconda_projects\a72a7971-6ec7-4edc-ae72-89d702199ed9\rmims_time_series_model.pkl"
]

def load_models():
    global MODELS
    loaded_file = None
    for path in MODEL_FILENAMES:
        if os.path.exists(path):
            try:
                with open(path, "rb") as f:
                    MODELS = pickle.load(f)
                loaded_file = path
                logger.info(f"Successfully loaded {len(MODELS)} models from '{path}'")
                break
            except Exception as e:
                logger.error(f"Failed to load model pickle at '{path}': {e}")
    
    if not loaded_file:
        logger.warning("No 'rmims_time_series_model.pkl' found. Endpoints will return ready status pending model copy.")

load_models()

# ----------------------------------------------------------------------
# 3. Defensive Identifier Resolution Helper
# ----------------------------------------------------------------------
def resolve_material_key(identifier: str):
    if not identifier:
        return None, None
    clean = str(identifier).strip()
    clean_upper = clean.upper()
    clean_lower = clean.lower()
    
    if clean_upper in ["OVERALL_TOTAL", "OVERALL", "TOTAL", "ALL", "ALL MATERIALS"]:
        meta = {"material_id": "OVERALL_TOTAL", "raw_material_name": "OVERALL TOTAL FACTORY CONSUMPTION", "unit": "kg/L", "category": "Aggregate"}
        return "OVERALL_TOTAL", meta

    if clean_upper in MATERIAL_BY_ID:
        return MATERIAL_BY_ID[clean_upper]["raw_material_name"], MATERIAL_BY_ID[clean_upper]

    if clean_upper.startswith("RM") and not clean_upper.startswith("RM-"):
        hyphenated = "RM-" + clean_upper[2:]
        if hyphenated in MATERIAL_BY_ID:
            return MATERIAL_BY_ID[hyphenated]["raw_material_name"], MATERIAL_BY_ID[hyphenated]

    if clean_lower in MATERIAL_BY_NAME:
        return MATERIAL_BY_NAME[clean_lower]["raw_material_name"], MATERIAL_BY_NAME[clean_lower]

    return None, None

# ----------------------------------------------------------------------
# 4. REST API Endpoints
# ----------------------------------------------------------------------

# LOCKED CONSTANT: Single Unified Margin of Error (7.51%)
LOCKED_MARGIN_OF_ERROR_PCT = 7.51
MARGIN_FACTOR = LOCKED_MARGIN_OF_ERROR_PCT / 100.0  # 0.0751

@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "RMIMS Machine Learning Forecasting API",
        "version": "2.0.0",
        "status": "online",
        "locked_margin_of_error": f"±{LOCKED_MARGIN_OF_ERROR_PCT}%",
        "authoritative_materials": len(AUTHORITATIVE_MATERIALS),
        "models_loaded": len(MODELS),
        "docs": {
            "health": "/api/health",
            "materials": "/api/materials",
            "forecast": "/api/forecast",
            "inventory_forecast": "/api/ml/forecast/<material_id>/inventory"
        }
    }), 200

@app.route("/api/health", methods=["GET"])
@app.route("/api/ml/status", methods=["GET"])
def health_check():
    is_healthy = len(MODELS) >= 59
    return jsonify({
        "status": "healthy" if is_healthy else "degraded",
        "service": "RMIMS Time-Series Forecasting Backend",
        "model_type": "Holt-Winters Exponential Smoothing (Multiplicative Weekly Seasonality)",
        "margin_of_error": f"±{LOCKED_MARGIN_OF_ERROR_PCT}%",
        "total_available_models": len(MODELS),
        "expected_models": 60,
        "overall_aggregate_supported": "OVERALL_TOTAL" in MODELS,
        "supported_units": ["kg", "L"]
    }), (200 if is_healthy else 503)

@app.route("/api/materials", methods=["GET"])
def get_materials_catalog():
    return jsonify({
        "success": True,
        "count": len(AUTHORITATIVE_MATERIALS),
        "materials": AUTHORITATIVE_MATERIALS
    }), 200

@app.route("/api/forecast", methods=["POST", "GET"])
def get_dynamic_forecast():
    try:
        if request.method == "POST":
            data = request.get_json(force=True, silent=True) or {}
        else:
            data = request.args.to_dict()

        identifier = data.get("raw_material_name") or data.get("material_id") or data.get("material_name") or "OVERALL_TOTAL"
        horizon_type = str(data.get("horizon_type", "month")).lower()
        horizon_val = int(data.get("horizon_value", 6))

        model_key, meta = resolve_material_key(identifier)
        if not model_key:
            return jsonify({
                "success": False,
                "error": f"Material '{identifier}' not found in master catalog."
            }), 404

        model = MODELS.get(model_key) or MODELS.get(meta.get("material_id"))
        if not model:
            load_models()
            model = MODELS.get(model_key) or MODELS.get(meta.get("material_id"))
            if not model:
                return jsonify({
                    "success": False,
                    "error": f"Trained model for '{model_key}' is not loaded."
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
        
        # Exact Single Margin of Error Calculation (Strictly ±7.51%)
        upper_bounds = [round(float(v * (1.0 + MARGIN_FACTOR)), 2) for v in values]
        lower_bounds = [round(float(v * (1.0 - MARGIN_FACTOR)), 2) for v in values]

        return jsonify({
            "success": True,
            "material_id": meta.get("material_id"),
            "raw_material_name": meta.get("raw_material_name"),
            "unit": meta.get("unit"),
            "category": meta.get("category"),
            "horizon_type": horizon_type,
            "horizon_value": horizon_val,
            "margin_of_error_pct": LOCKED_MARGIN_OF_ERROR_PCT,
            "margin_of_error": f"±{LOCKED_MARGIN_OF_ERROR_PCT}%",
            "total_projected_requirement": round(float(sum(values)), 2),
            "labels": labels,
            "forecast_values": values,
            "upper_margin": upper_bounds,
            "lower_margin": lower_bounds,
            "upper_margin_10pct": upper_bounds,  # Backward compatible for frontend chart bindings
            "lower_margin_10pct": lower_bounds
        }), 200

    except Exception as e:
        logger.error(f"Error generating forecast: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/ml/forecast/<path:material_identifier>/inventory", methods=["GET"])
def get_inventory_operational_forecast(material_identifier):
    try:
        model_key, meta = resolve_material_key(material_identifier)
        if not model_key:
            return jsonify({"success": False, "error": f"Material '{material_identifier}' not found."}), 404

        model = MODELS.get(model_key) or MODELS.get(meta.get("material_id"))
        if not model:
            load_models()
            model = MODELS.get(model_key) or MODELS.get(meta.get("material_id"))
            if not model:
                return jsonify({"success": False, "error": f"Model for '{model_key}' not loaded."}), 503

        raw_28d = np.maximum(model.forecast(28).values, 0.0)
        qty_7d = round(float(np.sum(raw_28d[:7])), 2)
        qty_28d = round(float(np.sum(raw_28d)), 2)

        current_stock = float(request.args.get("current_stock", 0.0))
        min_threshold = float(request.args.get("min_threshold", 0.0))

        diff_7d = round(current_stock - qty_7d, 2)
        is_shortage = diff_7d < 0
        reorder_recommended = (current_stock <= min_threshold) or is_shortage

        return jsonify({
            "success": True,
            "material_id": meta.get("material_id"),
            "raw_material_name": meta.get("raw_material_name"),
            "unit": meta.get("unit"),
            "category": meta.get("category"),
            "margin_of_error": f"±{LOCKED_MARGIN_OF_ERROR_PCT}%",
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
    logger.info(f"Starting RMIMS Flask ML Service on port {PORT} with locked ±{LOCKED_MARGIN_OF_ERROR_PCT}% margin...")
    app.run(host="0.0.0.0", port=PORT, debug=True)
