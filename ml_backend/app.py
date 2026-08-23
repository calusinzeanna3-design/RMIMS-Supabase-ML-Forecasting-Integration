import os
import re
import json
import math
import joblib
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client
from statsmodels.tsa.ar_model import AutoReg

# ============================================================
# FLASK APPLICATION CONFIGURATION
# ============================================================

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# ============================================================
# SUPABASE CONFIGURATION (STRICT ENVIRONMENT VARIABLES ONLY)
# ============================================================
# Per RMIMS V2 Phase 7 Security Rules: No hardcoded credentials in source code.
# The server must obtain credentials from environment variables and fail clearly if missing.

# Read environment configuration if available
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

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "CRITICAL CONFIGURATION ERROR: 'SUPABASE_URL' and 'SUPABASE_KEY' (or 'SUPABASE_ANON_KEY') "
        "environment variables must be set. Hardcoded credential fallbacks are strictly prohibited."
    )

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


# ============================================================
# AUTHORITATIVE PHASE 6 MATERIAL REGISTRY (NON-ALPHABETICAL)
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
    {"material_id": "RM020", "raw_material_name": "Butter or Margarine", "unit": "kg"},
    {"material_id": "RM021", "raw_material_name": "Sugar", "unit": "kg"},
    {"material_id": "RM022", "raw_material_name": "Pork Skin", "unit": "kg"},
    {"material_id": "RM023", "raw_material_name": "Raw Bananas", "unit": "kg"},
    {"material_id": "RM024", "raw_material_name": "Turmeric Powder", "unit": "kg"},
    {"material_id": "RM025", "raw_material_name": "Water", "unit": "L"},
    {"material_id": "RM026", "raw_material_name": "White Sugar", "unit": "kg"},
    {"material_id": "RM027", "raw_material_name": "Peanuts", "unit": "kg"},
    {"material_id": "RM028", "raw_material_name": "Sea Salt", "unit": "kg"},
    {"material_id": "RM029", "raw_material_name": "Honey", "unit": "L"},
    {"material_id": "RM030", "raw_material_name": "Oil", "unit": "L"},
]

EXPECTED_MODELS_COUNT = 30
EXPECTED_TRAINING_START = "2025-01-01"
EXPECTED_TRAINING_END = "2026-08-09"
SUPPORTED_UNITS = ["kg", "L", "loaf"]


# ============================================================
# FAIL-FAST MODEL REGISTRY & LOADER (RMIMS_FINAL_MODELS ONLY)
# ============================================================

FINAL_MODELS_DIR = os.path.join(BASE_DIR, "models", "RMIMS_FINAL_MODELS")

if not os.path.exists(FINAL_MODELS_DIR):
    raise RuntimeError(
        f"CRITICAL ERROR: Approved model directory missing at '{FINAL_MODELS_DIR}'. "
        f"Legacy 'models/autoreg' is NOT used as fallback."
    )

autoreg_models = {}
model_registry_list = []

for item in AUTHORITATIVE_MATERIALS:
    rm_id = item["material_id"]
    mat_name = item["raw_material_name"]
    unit = item["unit"]
    filename = f"{rm_id}_AutoReg.pkl"
    pkl_path = os.path.join(FINAL_MODELS_DIR, filename)

    if not os.path.exists(pkl_path):
        raise RuntimeError(
            f"CRITICAL ERROR: Expected final model file '{filename}' for {rm_id} ({mat_name}) "
            f"not found in '{FINAL_MODELS_DIR}'. Fail-fast engaged."
        )

    try:
        model_obj = joblib.load(pkl_path)
    except Exception as e:
        raise RuntimeError(
            f"CRITICAL ERROR: Failed to deserialize final model '{filename}' for {rm_id}: {e}"
        )

    cls_name = model_obj.__class__.__name__
    if cls_name != "AutoRegResultsWrapper":
        raise RuntimeError(
            f"CRITICAL ERROR: Model '{filename}' for {rm_id} is '{cls_name}', expected 'AutoRegResultsWrapper'."
        )

    endog = model_obj.model.data.orig_endog
    obs_count = len(endog)
    start_dt = str(endog.index[0])[:10]
    end_dt = str(endog.index[-1])[:10]

    if end_dt != EXPECTED_TRAINING_END:
        raise RuntimeError(
            f"CRITICAL ERROR: Model '{filename}' training end date is '{end_dt}', expected '{EXPECTED_TRAINING_END}'."
        )

    lags_params = [k for k in model_obj.params.index if "quantity_consumed.L" in k]
    lag_count = len(lags_params) if lags_params else 7
    trend_setting = "ct" if ("const" in model_obj.params and "trend" in model_obj.params) else "c"

    entry = {
        "material_id": rm_id,
        "item_code": rm_id,
        "material": mat_name,
        "raw_material_name": mat_name,
        "unit": unit,
        "model_type": "AutoReg",
        "lags": lag_count,
        "trend": trend_setting,
        "training_start": start_dt,
        "training_end": end_dt,
        "observations": obs_count,
        "model_status": "trained",
        "model": model_obj,
    }

    autoreg_models[rm_id] = entry
    autoreg_models[rm_id.lower()] = entry
    autoreg_models[mat_name] = entry
    autoreg_models[mat_name.lower().strip()] = entry

    model_registry_list.append({
        "material_id": rm_id,
        "raw_material_name": mat_name,
        "unit": unit,
        "model_status": "trained",
        "lags": lag_count,
        "training_start": start_dt,
        "training_end": end_dt,
        "observations": obs_count,
    })

if len(model_registry_list) != EXPECTED_MODELS_COUNT:
    raise RuntimeError(
        f"CRITICAL ERROR: Expected {EXPECTED_MODELS_COUNT} models, loaded {len(model_registry_list)}."
    )

print(
    f"[SUCCESS] RMIMS V2 Model Registry: {len(model_registry_list)}/{EXPECTED_MODELS_COUNT} "
    f"AutoReg models loaded from RMIMS_FINAL_MODELS (Training Cutoff: {EXPECTED_TRAINING_END})."
)


# ============================================================
# HELPER & VALIDATION FUNCTIONS
# ============================================================

def normalize_unit(unit_str):
    """Normalize common unit variants into standard model units (kg, L, loaf)."""
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
    """Check if received material unit matches expected trained model unit."""
    return normalize_unit(received_unit) == normalize_unit(expected_unit)


def get_material_model(query_identifier):
    """
    Retrieve model entry dynamically by material_id (RM001..RM030), material name,
    or composite identifier (e.g. 'Sugar (RM021)').
    """
    if not query_identifier:
        return None
    q = str(query_identifier).strip()

    # 1. Exact match
    if q in autoreg_models:
        return autoreg_models[q]
    q_lower = q.lower()
    if q_lower in autoreg_models:
        return autoreg_models[q_lower]

    # 2. Extract embedded RM-code (e.g. from 'Sugar (RM021)' -> 'RM021')
    m_code = re.search(r"\b(RM\d{3})\b", q, re.IGNORECASE)
    if m_code:
        rm_id = m_code.group(1).upper()
        if rm_id in autoreg_models:
            return autoreg_models[rm_id]

    # 3. Extract clean name by stripping parenthetical text (e.g. 'Sugar (RM021)' -> 'Sugar')
    clean_name = re.sub(r"\s*\(.*?\)", "", q).strip()
    if clean_name in autoreg_models:
        return autoreg_models[clean_name]
    if clean_name.lower() in autoreg_models:
        return autoreg_models[clean_name.lower()]

    return None


def get_authenticated_client():
    """Extract Bearer token and initialize an authenticated Supabase client."""
    authorization = request.headers.get("Authorization")
    if not authorization:
        return None, "Authorization header is required."
    if not authorization.startswith("Bearer "):
        return None, "Authorization header must use Bearer token."

    access_token = authorization.replace("Bearer ", "", 1).strip()
    if not access_token:
        return None, "Access token is missing."

    try:
        authenticated_supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        authenticated_supabase.postgrest.auth(access_token)
        return authenticated_supabase, None
    except Exception as e:
        return None, str(e)


def get_inventory(material_identifier, authenticated_supabase):
    """
    Retrieve material master and recorded stock balance from Supabase public.raw_materials.
    Supports lookup by id (UUID), item_code (RM001), or name.
    """
    try:
        # 1. Try lookup by item_code
        res = (
            authenticated_supabase
            .table("raw_materials")
            .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days")
            .eq("item_code", material_identifier)
            .execute()
        )
        if res.data:
            return res.data[0]

        # 2. Try lookup by exact name
        res = (
            authenticated_supabase
            .table("raw_materials")
            .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days")
            .eq("name", material_identifier)
            .execute()
        )
        if res.data:
            return res.data[0]

        # 3. Try lookup by case-insensitive name
        res = (
            authenticated_supabase
            .table("raw_materials")
            .select("id, item_code, name, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days")
            .ilike("name", material_identifier)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception as e:
        print(f"Inventory query notice for '{material_identifier}': {e}")
        return None


def get_historical_usage_records(material_id_or_name, authenticated_supabase):
    """
    Retrieve operational disbursement records from Supabase public.material_disbursements.
    """
    try:
        res = (
            authenticated_supabase
            .table("material_disbursements")
            .select("usage_date, consumed_quantity, unit, material_id")
            .order("usage_date", desc=False)
            .execute()
        )
        return res.data or []
    except Exception as e:
        print(f"Historical usage fetch notice for '{material_id_or_name}': {e}")
        return []


def build_current_weekly_series(material_info, usage_records_data=None):
    """
    Build current weekly time-series combining the model's locked baseline series (ending 2026-08-09)
    with actual consumption records retrieved from Supabase.
    """
    model_obj = material_info["model"]
    baseline_vals = model_obj.model.data.orig_endog.values
    training_end_str = material_info.get("training_end", EXPECTED_TRAINING_END)

    # Daily baseline series ending on 2026-08-09
    dates = pd.date_range(end=training_end_str, periods=len(baseline_vals), freq="D")
    daily_series = pd.Series(baseline_vals, index=dates, name="quantity_consumed", dtype=float)

    # Resample baseline to Weekly (W-SUN)
    weekly_series = daily_series.resample("W-SUN").sum()

    if not usage_records_data:
        return weekly_series

    # Process and aggregate any runtime usage records from Supabase
    valid_records = []
    for r in usage_records_data:
        qty = r.get("consumed_quantity") if r.get("consumed_quantity") is not None else r.get("quantity")
        raw_date = r.get("usage_date") or r.get("created_at")
        unit = r.get("unit")

        if qty is not None and raw_date:
            try:
                num_qty = float(qty)
                if num_qty >= 0 and (not unit or is_unit_compatible(unit, material_info["unit"])):
                    valid_records.append({
                        "date": pd.to_datetime(raw_date),
                        "quantity": num_qty,
                    })
            except Exception:
                continue

    if not valid_records:
        return weekly_series

    df_supa = pd.DataFrame(valid_records)
    supa_weekly = df_supa.resample("W-SUN", on="date")["quantity"].sum()

    for dt, val in supa_weekly.items():
        weekly_series[dt] = float(val)

    weekly_series = weekly_series.sort_index()
    return weekly_series


def generate_autoreg_forecasts(material_info, usage_records_data=None):
    """
    Generate Weekly (7-day) and Monthly (4-week) forecasts dynamically using runtime AutoReg.
    """
    weekly_series = build_current_weekly_series(material_info, usage_records_data)
    obs_count = len(weekly_series)
    lags = min(material_info.get("lags", 7), max(1, obs_count - 1))
    trend = material_info.get("trend", "ct")

    runtime_model = AutoReg(weekly_series, lags=lags, trend=trend).fit()

    # Step 1: 7-Day Operational Forecast
    pred_step1 = runtime_model.predict(start=obs_count, end=obs_count)
    qty_7day = float(pred_step1.iloc[0]) if hasattr(pred_step1, "iloc") else float(pred_step1[0])

    # Steps 1 to 4: 4-Week Monthly Planning Forecast
    pred_step4 = runtime_model.predict(start=obs_count, end=obs_count + 3)
    qty_1month = float(pred_step4.sum()) if hasattr(pred_step4, "sum") else sum(float(x) for x in pred_step4)

    qty_7day = 0.0 if (math.isnan(qty_7day) or math.isinf(qty_7day)) else max(0.0, qty_7day)
    qty_1month = 0.0 if (math.isnan(qty_1month) or math.isinf(qty_1month)) else max(0.0, qty_1month)

    latest_date = weekly_series.index[-1]
    anchor_date = pd.Timestamp(latest_date)

    forecast_start = anchor_date + pd.Timedelta(days=1)
    forecast_7day_end = forecast_start + pd.Timedelta(days=6)
    forecast_1month_end = forecast_start + pd.Timedelta(days=27)

    return {
        "historicalEnd": anchor_date.date().isoformat(),
        "seriesLength": obs_count,
        "latestWeeklyValue": round(float(weekly_series.iloc[-1]), 2),
        "forecast7Day": {
            "start": forecast_start.date().isoformat(),
            "end": forecast_7day_end.date().isoformat(),
            "quantity": round(qty_7day, 2),
            "unit": material_info["unit"],
        },
        "forecast1Month": {
            "start": forecast_start.date().isoformat(),
            "end": forecast_1month_end.date().isoformat(),
            "quantity": round(qty_1month, 2),
            "unit": material_info["unit"],
        },
    }


# ============================================================
# API ENDPOINTS
# ============================================================

@app.get("/api/ml/status")
def ml_status():
    """Report model service health without exposing internal filesystem paths."""
    return jsonify({
        "status": "healthy",
        "model_type": "AutoReg",
        "models_loaded": len(model_registry_list),
        "expected_models": EXPECTED_MODELS_COUNT,
        "training_start": EXPECTED_TRAINING_START,
        "training_end": EXPECTED_TRAINING_END,
        "holdout_period": "2026-08-10 to 2026-08-17",
        "forecast_target": "2026-08-18 onward",
        "supported_units": SUPPORTED_UNITS,
    })


@app.get("/api/ml/materials")
def get_materials_catalog():
    """Return the authoritative 30-material registry with model status and parameters."""
    return jsonify({
        "status": "success",
        "count": len(model_registry_list),
        "materials": model_registry_list,
    })


@app.route("/api/ml/forecast", methods=["GET", "POST"])
def generic_forecast():
    """Support dynamic GET/POST forecasting for any material_id or raw_material_name."""
    material_query = None
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        material_query = data.get("material_id") or data.get("material") or data.get("raw_material_name")
    else:
        material_query = request.args.get("material_id") or request.args.get("material") or request.args.get("raw_material_name")

    if not material_query:
        return jsonify({
            "status": "error",
            "message": "Missing material query identifier ('material_id' or 'raw_material_name').",
        }), 400

    return material_forecast_inventory(material_query)


@app.route("/api/ml/forecast/<path:material_identifier>", methods=["GET", "POST"])
def material_forecast_baseline(material_identifier):
    """Generate AutoReg weekly and monthly forecast from trained baseline."""
    try:
        material_info = get_material_model(material_identifier)
        if material_info is None:
            return jsonify({
                "status": "unavailable",
                "message": f"Forecast unavailable: no trained AutoReg model found for '{material_identifier}'.",
                "available_materials": [m["material_id"] for m in AUTHORITATIVE_MATERIALS],
            }), 404

        forecast_res = generate_autoreg_forecasts(material_info)
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
                "type": "AutoReg",
                "frequency": "weekly",
                "lags": material_info["lags"],
                "training_end": material_info["training_end"],
                "status": "trained",
            },
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/ml/forecast/<path:material_identifier>/inventory", methods=["GET", "POST"])
def material_forecast_inventory(material_identifier):
    """
    Generate dynamic forecast comparing current recorded inventory against AutoReg predictions
    and producing system-generated decision-support insights.
    """
    try:
        material_info = get_material_model(material_identifier)
        if material_info is None:
            return jsonify({
                "status": "unavailable",
                "message": f"Forecast unavailable: no trained model for '{material_identifier}'.",
                "available_materials": [m["material_id"] for m in AUTHORITATIVE_MATERIALS],
            }), 404

        # Authenticate with Supabase if Bearer token present
        authenticated_supabase = None
        auth_header = request.headers.get("Authorization")
        if auth_header:
            try:
                authenticated_supabase, _ = get_authenticated_client()
            except Exception:
                authenticated_supabase = supabase
        else:
            authenticated_supabase = supabase

        # Retrieve inventory from public.raw_materials
        inventory = get_inventory(material_info["raw_material_name"], authenticated_supabase)
        has_inventory = inventory is not None

        if has_inventory:
            received_unit = str(inventory.get("unit_of_measure") or inventory.get("unit") or "").strip()
            if received_unit and not is_unit_compatible(received_unit, material_info["unit"]):
                return jsonify({
                    "status": "invalid",
                    "message": "Recorded material unit does not match the trained forecasting model.",
                    "expected_unit": material_info["unit"],
                    "received_unit": received_unit,
                }), 400

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

        # Fetch recent usage records from Supabase
        usage_records = get_historical_usage_records(material_info["raw_material_name"], authenticated_supabase)

        # Generate forecasts
        forecast_res = generate_autoreg_forecasts(material_info, usage_records)
        f7 = forecast_res["forecast7Day"]
        f1m = forecast_res["forecast1Month"]
        forecast_7d_qty = f7["quantity"]

        # Calculate Decision Support
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

        # Reorder Decision Support (Optional Fields)
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
                "type": "AutoReg",
                "frequency": "weekly",
                "lags": material_info["lags"],
                "training_end": material_info["training_end"],
                "status": "trained",
            },
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ============================================================
# RUN FLASK SERVER
# ============================================================

if __name__ == "__main__":
    print("[FLASK SERVER STARTING] Listening on http://127.0.0.1:5000")
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False,
        use_reloader=False
    )