import os
import re
import json
import math
import pickle
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client

# ============================================================
# BACKWARD COMPATIBILITY PATCH FOR SCIPY 1.18+ UNPICKLING
# ============================================================
import scipy.sparse.linalg._interface as _interface
_orig_setstate = _interface.LinearOperator.__setstate__
def _safe_setstate(self, state):
    if isinstance(state, dict) and '_xp' not in state:
        state['_xp'] = 'numpy'
    return _orig_setstate(self, state)
_interface.LinearOperator.__setstate__ = _safe_setstate

# ============================================================
# FLASK APPLICATION CONFIGURATION
# ============================================================

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ============================================================
# SUPABASE CONFIGURATION (STRICT ENVIRONMENT VARIABLES ONLY)
# ============================================================

env_path = os.path.join(os.path.dirname(BASE_DIR), ".env")
if os.path.exists(env_path):
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("'\""))
    except Exception:
        pass

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://hgandqozgcpytxebhvtn.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_ANON_KEY") or "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ============================================================
# HORIZON CONFIGURATION FOR PURE TIME-SERIES DYNAMIC FORECASTING
# ============================================================

HORIZON_CONFIG = {
    'day': {'multiplier': 1, 'rule': 'D'},
    'week': {'multiplier': 7, 'rule': 'W-MON'},
    'month': {'multiplier': 31, 'rule': 'MS'},
    'year': {'multiplier': 365, 'rule': 'YS'}
}

# ============================================================
# MATERIAL MASTER & UNIT MAPPING
# ============================================================

AUTHORITATIVE_MATERIALS = [
    {"material_id": "RM001", "raw_material_name": "Chiton", "unit": "kg"},
    {"material_id": "RM002", "raw_material_name": "Salt", "unit": "kg"},
    {"material_id": "RM003", "raw_material_name": "Ground Pepper", "unit": "kg"},
    {"material_id": "RM004", "raw_material_name": "Crushed Garlic", "unit": "kg"},
    {"material_id": "RM005", "raw_material_name": "Optional Spices or Flavorings", "unit": "kg"},
    {"material_id": "RM006", "raw_material_name": "Cooking Oil", "unit": "L"},
    {"material_id": "RM007", "raw_material_name": "Small Shrimp", "unit": "kg"},
    {"material_id": "RM008", "raw_material_name": "Garlic", "unit": "kg"},
    {"material_id": "RM009", "raw_material_name": "Onion", "unit": "kg"},
    {"material_id": "RM010", "raw_material_name": "Spring Onion", "unit": "kg"},
    {"material_id": "RM011", "raw_material_name": "Cabbage", "unit": "kg"},
    {"material_id": "RM012", "raw_material_name": "Carrots", "unit": "kg"},
    {"material_id": "RM013", "raw_material_name": "Bell Pepper", "unit": "kg"},
    {"material_id": "RM014", "raw_material_name": "Soy Sauce", "unit": "L"},
    {"material_id": "RM015", "raw_material_name": "Sesame Oil", "unit": "L"},
    {"material_id": "RM016", "raw_material_name": "Oyster Sauce", "unit": "L"},
    {"material_id": "RM017", "raw_material_name": "Chicken", "unit": "kg"},
    {"material_id": "RM018", "raw_material_name": "Pork", "unit": "kg"},
    {"material_id": "RM019", "raw_material_name": "Loaf Bread", "unit": "loaf"},
    {"material_id": "RM020", "raw_material_name": "Butter/Margarine", "unit": "kg"},
    {"material_id": "RM021", "raw_material_name": "Sugar", "unit": "kg"},
    {"material_id": "RM022", "raw_material_name": "Pork Skin", "unit": "kg"},
    {"material_id": "RM023", "raw_material_name": "Raw Bananas", "unit": "kg"},
    {"material_id": "RM024", "raw_material_name": "Turmeric Powder", "unit": "kg"},
    {"material_id": "RM025", "raw_material_name": "Water", "unit": "L"},
    {"material_id": "RM026", "raw_material_name": "Peanuts", "unit": "kg"},
    {"material_id": "RM027", "raw_material_name": "Sea Salt", "unit": "kg"},
    {"material_id": "RM028", "raw_material_name": "Honey", "unit": "L"},
]

MATERIAL_UNIT_MAP = {
    "Bell Pepper": "kg",
    "Butter/Margarine": "kg",
    "Butter or Margarine": "kg",
    "Cabbage": "kg",
    "Carrots": "kg",
    "Chicken": "kg",
    "Chiton": "kg",
    "Cooking Oil": "L",
    "Garlic": "kg",
    "Crushed Garlic": "kg",
    "Ground Pepper": "kg",
    "Honey": "L",
    "Loaf Bread": "loaf",
    "Onion": "kg",
    "Oyster Sauce": "L",
    "Peanuts": "kg",
    "Pork": "kg",
    "Pork Skin": "kg",
    "Raw Bananas": "kg",
    "Salt": "kg",
    "Sea Salt": "kg",
    "Sesame Oil": "L",
    "Small Shrimp": "kg",
    "Soy Sauce": "L",
    "Spring Onion": "kg",
    "Sugar": "kg",
    "White Sugar": "kg",
    "Turmeric Powder": "kg",
    "Water": "L",
    "OVERALL_TOTAL": "units"
}

# ============================================================
# MODEL LOADER & REGISTRY (rmims_time_series_model.pkl)
# ============================================================

MODEL_FILE = os.path.join(BASE_DIR, "rmims_time_series_model.pkl")

if not os.path.exists(MODEL_FILE):
    raise RuntimeError(f"CRITICAL ERROR: Production model artifact '{MODEL_FILE}' not found.")

with open(MODEL_FILE, "rb") as f:
    MODELS = pickle.load(f)

print(f"[SUCCESS] RMIMS Time-Series Service: Loaded {len(MODELS)} models from rmims_time_series_model.pkl.")

# Build lookup registry with aliases
model_lookup = {}
model_registry_list = []

for name, model_obj in MODELS.items():
    unit = MATERIAL_UNIT_MAP.get(name, "kg")
    
    # Check if there is an RM code
    matched_id = None
    for m in AUTHORITATIVE_MATERIALS:
        if m["raw_material_name"].lower() == name.lower():
            matched_id = m["material_id"]
            break
            
    entry = {
        "material_id": matched_id or name,
        "item_code": matched_id or name,
        "material": name,
        "raw_material_name": name,
        "unit": unit,
        "model_type": "Holt-Winters Exponential Smoothing",
        "model_status": "trained",
        "model": model_obj
    }
    
    # Register name keys
    model_lookup[name] = entry
    model_lookup[name.lower()] = entry
    
    if matched_id:
        model_lookup[matched_id] = entry
        model_lookup[matched_id.lower()] = entry
        
    # Extra aliases for variations
    if name == "Butter/Margarine":
        model_lookup["Butter or Margarine"] = entry
        model_lookup["butter or margarine"] = entry
        model_lookup["RM020"] = entry
        model_lookup["rm020"] = entry
    elif name == "Sugar":
        model_lookup["White Sugar"] = entry
        model_lookup["white sugar"] = entry
        model_lookup["RM021"] = entry
        model_lookup["rm021"] = entry
    elif name == "Garlic":
        model_lookup["Crushed Garlic"] = entry
        model_lookup["crushed garlic"] = entry

    model_registry_list.append({
        "material_id": matched_id or name,
        "raw_material_name": name,
        "unit": unit,
        "model_status": "trained",
        "model_type": "Holt-Winters"
    })

# ============================================================
# HELPER & VALIDATION FUNCTIONS
# ============================================================

def normalize_unit(unit_str):
    if not unit_str:
        return ""
    u = str(unit_str).strip().lower()
    if u in ["kg", "kilogram", "kilograms", "kilo", "kilos"]:
        return "kg"
    if u in ["l", "liter", "liters", "litre", "litres"]:
        return "L"
    if u in ["loaf", "loaves", "pc", "pcs", "piece", "pieces"]:
        return "loaf"
    return u


def is_unit_compatible(received_unit, expected_unit):
    return normalize_unit(received_unit) == normalize_unit(expected_unit)


def get_material_model(query_identifier):
    if not query_identifier:
        return None
    q = str(query_identifier).strip()

    if q in model_lookup:
        return model_lookup[q]
    if q.lower() in model_lookup:
        return model_lookup[q.lower()]

    m_code = re.search(r"\b(RM\d{3})\b", q, re.IGNORECASE)
    if m_code:
        rm_id = m_code.group(1).upper()
        if rm_id in model_lookup:
            return model_lookup[rm_id]

    clean_name = re.sub(r"\s*\(.*?\)", "", q).strip()
    if clean_name in model_lookup:
        return model_lookup[clean_name]
    if clean_name.lower() in model_lookup:
        return model_lookup[clean_name.lower()]

    return None


def get_authenticated_client():
    authorization = request.headers.get("Authorization")
    if not authorization or not authorization.startswith("Bearer "):
        return supabase, None
    access_token = authorization.replace("Bearer ", "", 1).strip()
    try:
        authenticated_supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        authenticated_supabase.postgrest.auth(access_token)
        return authenticated_supabase, None
    except Exception as e:
        return supabase, str(e)


def get_inventory(material_identifier, client):
    try:
        res = client.table("raw_materials").select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days").eq("item_code", material_identifier).execute()
        if res.data:
            return res.data[0]
        res = client.table("raw_materials").select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days").eq("name", material_identifier).execute()
        if res.data:
            return res.data[0]
        res = client.table("raw_materials").select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days").ilike("name", f"%{material_identifier}%").execute()
        return res.data[0] if res.data else None
    except Exception as e:
        print(f"Inventory query notice for '{material_identifier}': {e}")
        return None


def generate_time_series_forecast(material_info):
    """
    Computes dynamic 7-day (operational) and 1-month (planning) requirement forecasts
    directly using the pure Holt-Winters model.
    """
    model_obj = material_info["model"]
    
    # 7-day forward daily forecast
    daily_7d = np.maximum(model_obj.forecast(7), 0.0)
    qty_7day = float(daily_7d.sum())
    
    # 28-day forward (4-week) monthly requirement
    daily_28d = np.maximum(model_obj.forecast(28), 0.0)
    qty_1month = float(daily_28d.sum())
    
    forecast_start = daily_7d.index[0] if hasattr(daily_7d, "index") else pd.Timestamp.now()
    forecast_7day_end = daily_7d.index[-1] if hasattr(daily_7d, "index") else forecast_start + pd.Timedelta(days=6)
    forecast_1month_end = daily_28d.index[-1] if hasattr(daily_28d, "index") else forecast_start + pd.Timedelta(days=27)
    
    return {
        "historicalEnd": (forecast_start - pd.Timedelta(days=1)).strftime('%Y-%m-%d'),
        "forecast7Day": {
            "start": forecast_start.strftime('%Y-%m-%d'),
            "end": forecast_7day_end.strftime('%Y-%m-%d'),
            "quantity": round(qty_7day, 2),
            "unit": material_info["unit"],
        },
        "forecast1Month": {
            "start": forecast_start.strftime('%Y-%m-%d'),
            "end": forecast_1month_end.strftime('%Y-%m-%d'),
            "quantity": round(qty_1month, 2),
            "unit": material_info["unit"],
        },
    }

# ============================================================
# UNIFIED PURE TIME-SERIES REST API ENDPOINTS
# ============================================================

@app.route("/api/health", methods=["GET"])
@app.route("/health", methods=["GET"])
@app.route("/api/ml/status", methods=["GET"])
def health_check():
    """Health check returning total active time-series models."""
    return jsonify({
        "status": "healthy",
        "service": "RMIMS Time-Series Forecast Backend",
        "model_type": "Holt-Winters Exponential Smoothing",
        "total_available_models": len(MODELS),
        "models_loaded": len(MODELS),
        "expected_models": 27,
        "overall_general_supported": "OVERALL_TOTAL" in MODELS,
        "supported_units": ["kg", "L", "loaf"]
    }), 200


@app.route("/api/materials", methods=["GET"])
@app.route("/api/ml/materials", methods=["GET"])
def get_materials_catalog():
    """Returns materials catalog compatible with both new API and RMIMS frontend."""
    materials = [m for m in MODELS.keys() if m != 'OVERALL_TOTAL']
    return jsonify({
        "status": "success",
        "count": len(MODELS),
        "total_materials": len(materials),
        "materials": model_registry_list,
        "overall_general_supported": "OVERALL_TOTAL" in MODELS
    }), 200


@app.route("/api/forecast", methods=["POST"])
def dynamic_forecast_endpoint():
    """
    Dynamic Pure Time-Series forecast generation endpoint.
    JSON Request Body:
    {
        "material_name": "Sugar",        # or "OVERALL_TOTAL"
        "horizon_type": "month",         # "day", "week", "month", or "year"
        "horizon_value": 3               # number of periods forward
    }
    """
    try:
        data = request.get_json(silent=True) or {}
        material_name = data.get("raw_material_name") or data.get("material_name") or data.get("material_id") or "OVERALL_TOTAL"
        horizon_type = str(data.get("horizon_type", "month")).lower()
        horizon_value = int(data.get("horizon_value", 1))

        material_info = get_material_model(material_name)
        if not material_info:
            return jsonify({
                "status": "error",
                "error": f"Raw material '{material_name}' not found.",
                "available_materials": list(MODELS.keys())
            }), 400

        if horizon_type not in HORIZON_CONFIG:
            return jsonify({
                "status": "error",
                "error": f"Invalid horizon_type '{horizon_type}'. Must be one of: {list(HORIZON_CONFIG.keys())}"
            }), 400

        if horizon_value < 1:
            return jsonify({"status": "error", "error": "horizon_value must be a positive integer >= 1"}), 400

        days_needed = horizon_value * HORIZON_CONFIG[horizon_type]["multiplier"]
        model = material_info["model"]

        # Pure dynamic forecast projection
        raw_daily_fc = np.maximum(model.forecast(days_needed), 0.0)

        df_fc = pd.DataFrame({
            "date": raw_daily_fc.index,
            "forecast_requirement": raw_daily_fc.values
        })

        rule = HORIZON_CONFIG[horizon_type]["rule"]
        if rule != "D":
            df_fc = df_fc.groupby(pd.Grouper(key="date", freq=rule))["forecast_requirement"].sum().reset_index()
            df_fc = df_fc.head(horizon_value)

        forecast_records = [
            {
                "period_date": row["date"].strftime("%Y-%m-%d"),
                "forecast_quantity": round(float(row["forecast_requirement"]), 2)
            }
            for _, row in df_fc.iterrows()
        ]

        total_forecast_quantity = round(float(df_fc["forecast_requirement"].sum()), 2)

        return jsonify({
            "status": "success",
            "raw_material_name": material_info["raw_material_name"],
            "unit": material_info["unit"],
            "horizon_type": horizon_type,
            "horizon_value": horizon_value,
            "total_forecast_requirement": total_forecast_quantity,
            "forecast_breakdown": forecast_records
        }), 200

    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/ml/forecast", methods=["GET", "POST"])
def generic_ml_forecast():
    material_query = None
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        material_query = data.get("material_id") or data.get("material") or data.get("raw_material_name") or data.get("material_name")
    else:
        material_query = request.args.get("material_id") or request.args.get("material") or request.args.get("raw_material_name")

    if not material_query:
        material_query = "Sugar"

    return material_forecast_inventory(material_query)


@app.route("/api/ml/forecast/<path:material_identifier>", methods=["GET", "POST"])
def material_forecast_baseline(material_identifier):
    """Generate dynamic forecast from pure time-series baseline."""
    try:
        material_info = get_material_model(material_identifier)
        if material_info is None:
            return jsonify({
                "status": "unavailable",
                "message": f"Forecast unavailable: no trained model found for '{material_identifier}'.",
                "available_materials": list(MODELS.keys()),
            }), 404

        forecast_res = generate_time_series_forecast(material_info)
        f7 = forecast_res["forecast7Day"]
        f1m = forecast_res["forecast1Month"]

        return jsonify({
            "status": "success",
            "material_id": material_info["material_id"],
            "raw_material_name": material_info["raw_material_name"],
            "unit": material_info["unit"],
            "historicalEnd": forecast_res["historicalEnd"],
            "forecast7Day": f7,
            "forecast1Month": f1m,
            "model": {
                "type": "Holt-Winters Exponential Smoothing",
                "frequency": "daily",
                "status": "trained",
            },
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/ml/forecast/<path:material_identifier>/inventory", methods=["GET", "POST"])
def material_forecast_inventory(material_identifier):
    """
    Generate dynamic forecast comparing current recorded inventory against predictions
    and producing system-generated decision-support insights for RMIMS dashboards.
    """
    try:
        material_info = get_material_model(material_identifier)
        if material_info is None:
            return jsonify({
                "status": "unavailable",
                "message": f"Forecast unavailable: no trained model for '{material_identifier}'.",
                "available_materials": list(MODELS.keys()),
            }), 404

        client, _ = get_authenticated_client()
        inventory = get_inventory(material_info["raw_material_name"], client)
        has_inventory = inventory is not None

        if has_inventory:
            received_unit = str(inventory.get("unit_of_measure") or inventory.get("unit") or "").strip()
            current_stock = float(inventory.get("current_stock") if inventory.get("current_stock") is not None else inventory.get("quantity", 0))
            min_thresh = inventory.get("minimum_threshold")
            reorder_qty = inventory.get("reorder_quantity")
            lead_time = inventory.get("lead_time_days")
        else:
            received_unit = material_info["unit"]
            current_stock = 0.0
            min_thresh = None
            reorder_qty = None
            lead_time = None

        forecast_res = generate_time_series_forecast(material_info)
        f7 = forecast_res["forecast7Day"]
        f1m = forecast_res["forecast1Month"]
        forecast_7d_qty = f7["quantity"]

        # Decision support calculations
        if has_inventory:
            diff = current_stock - forecast_7d_qty
            if diff < 0:
                decision_status = "Potential Shortage"
                insight = (
                    f"Current recorded stock ({current_stock} {material_info['unit']}) is below the "
                    f"7-day forecasted requirement ({forecast_7d_qty} {material_info['unit']}). Review material requirements."
                )
            elif diff == 0:
                decision_status = "Sufficient for Forecasted Requirement"
                insight = "Current recorded stock exactly matches the 7-day forecasted requirement."
            else:
                decision_status = "Potential Excess"
                insight = (
                    f"Current recorded stock ({current_stock} {material_info['unit']}) is sufficient for "
                    f"the upcoming forecasted requirement ({forecast_7d_qty} {material_info['unit']})."
                )
        else:
            diff = None
            decision_status = "Inventory data unavailable"
            insight = "Inventory records not found in database. Forecast computed from trained historical baseline."

        reorder_recommended = False
        if min_thresh is not None and has_inventory:
            if current_stock <= float(min_thresh):
                reorder_recommended = True

        return jsonify({
            "status": "success",
            "material_id": material_info["material_id"],
            "raw_material_name": material_info["raw_material_name"],
            "unit": material_info["unit"],
            "historicalEnd": forecast_res["historicalEnd"],
            "forecast7Day": f7,
            "forecast1Month": f1m,
            "current_inventory": {
                "current_stock": current_stock if has_inventory else None,
                "unit": received_unit,
                "minimum_threshold": min_thresh,
                "reorder_quantity": reorder_qty,
                "lead_time_days": lead_time,
                "recorded_in_db": has_inventory,
            },
            "decision_support": {
                "difference": round(diff, 2) if diff is not None else None,
                "decision_status": decision_status,
                "system_insight": insight,
                "reorder_recommended": reorder_recommended,
            },
            "model": {
                "type": "Holt-Winters Exponential Smoothing",
                "frequency": "daily",
                "status": "trained",
            },
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/forecast/comparison", methods=["GET", "POST"])
@app.route("/api/ml/forecast/comparison/<path:material_identifier>", methods=["GET", "POST"])
def material_historical_comparison(material_identifier=None):
    """
    Returns 2021-2025 actual historical used stock vs 2026 Jan-Jun forecasted requirement
    with ±10% acceptance margin bounds.
    """
    try:
        query = material_identifier
        if not query:
            if request.method == "POST":
                body = request.get_json(silent=True) or {}
                query = body.get("raw_material_name") or body.get("material_name") or body.get("material_id") or "OVERALL_TOTAL"
            else:
                query = request.args.get("material") or request.args.get("raw_material_name") or "OVERALL_TOTAL"

        material_info = get_material_model(query)
        if not material_info:
            return jsonify({
                "status": "error",
                "error": f"Raw material '{query}' not found.",
                "available_materials": list(MODELS.keys())
            }), 404

        model = material_info["model"]
        unit = material_info["unit"]

        # Extract 2021-2025 historical series
        history_series = pd.Series(model.model.endog, index=model.model._index)

        # 2021-2025 Yearly Totals
        yearly_dict = history_series.groupby(history_series.index.year).sum().round(2).to_dict()
        yearly_history = [{"year": int(y), "used_stock": float(v)} for y, v in yearly_dict.items()]

        # 2025 Monthly Actual Used Stock (Jan - Dec)
        hist_2025 = history_series["2025-01-01":"2025-12-31"]
        monthly_2025_series = hist_2025.groupby(pd.Grouper(freq="MS")).sum().round(2)
        monthly_2025 = [
            {
                "period": dt.strftime("%Y-%m"),
                "month_name": dt.strftime("%b %Y"),
                "actual_used_stock": round(float(val), 2),
                "margin_upper_10": round(float(val * 1.10), 2),
                "margin_lower_10": round(float(val * 0.90), 2)
            }
            for dt, val in monthly_2025_series.items()
        ]

        # 2026 Forecast (12 Months / Jan to Dec, with focus on Jan to Jun H1)
        raw_fc = np.maximum(model.forecast(365), 0.0)
        df_fc = pd.DataFrame({"date": raw_fc.index, "val": raw_fc.values})
        df_fc_m = df_fc.groupby(pd.Grouper(key="date", freq="MS"))["val"].sum().round(2)

        forecast_2026_h1 = [
            {
                "period": dt.strftime("%Y-%m"),
                "month_name": dt.strftime("%b %Y"),
                "forecast_requirement": round(float(val), 2),
                "margin_upper_10": round(float(val * 1.10), 2),
                "margin_lower_10": round(float(val * 0.90), 2)
            }
            for dt, val in df_fc_m.head(6).items()
        ]

        forecast_2026_full = [
            {
                "period": dt.strftime("%Y-%m"),
                "month_name": dt.strftime("%b %Y"),
                "forecast_requirement": round(float(val), 2),
                "margin_upper_10": round(float(val * 1.10), 2),
                "margin_lower_10": round(float(val * 0.90), 2)
            }
            for dt, val in df_fc_m.head(12).items()
        ]

        # Summary statistics
        total_2025_used = round(float(monthly_2025_series.sum()), 2)
        h1_2025_used = round(float(monthly_2025_series.head(6).sum()), 2)
        h1_2026_forecast = round(float(df_fc_m.head(6).sum()), 2)
        growth_rate_h1 = round(((h1_2026_forecast - h1_2025_used) / max(1, h1_2025_used)) * 100, 2)

        return jsonify({
            "status": "success",
            "raw_material_name": material_info["raw_material_name"],
            "material_id": material_info["material_id"],
            "unit": unit,
            "comparison_title": f"2021-2025 Historical Used Stock vs 2026 Jan-Jun Forecast: {material_info['raw_material_name']}",
            "historical_yearly_2021_2025": yearly_history,
            "historical_monthly_2025": monthly_2025,
            "forecast_monthly_2026_h1": forecast_2026_h1,
            "forecast_monthly_2026_full": forecast_2026_full,
            "metrics": {
                "total_2025_used_stock": total_2025_used,
                "h1_2025_used_stock": h1_2025_used,
                "h1_2026_forecast_requirement": h1_2026_forecast,
                "h1_demand_growth_pct": growth_rate_h1,
                "unit": unit
            }
        }), 200

    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

# ============================================================
# MAIN ENTRYPOINT
# ============================================================

if __name__ == "__main__":
    print("[FLASK SERVER STARTING] Pure Time-Series Service listening on http://127.0.0.1:5000")
    app.run(host="0.0.0.0", port=5000, debug=False)