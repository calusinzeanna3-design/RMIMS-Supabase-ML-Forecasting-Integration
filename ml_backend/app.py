from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client
import joblib
import json
import math
import os
import pandas as pd
from statsmodels.tsa.ar_model import AutoReg


# ============================================================
# FLASK APPLICATION
# ============================================================

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# ============================================================
# SUPABASE CONFIGURATION
# ============================================================

DEFAULT_SUPABASE_URL = "https://zdslycwczwfsjdxkwokt.supabase.co"
DEFAULT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpkc2x5Y3djendmc2pkeGt3b2t0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNDQ4NzUsImV4cCI6MjEwMTcyMDg3NX0.ov_FvAiAuMmr651Yy2kf9Tnp6qctIHYddRVx9HathU0"

SUPABASE_URL = os.getenv("SUPABASE_URL", DEFAULT_SUPABASE_URL)
SUPABASE_KEY = os.getenv("SUPABASE_KEY", DEFAULT_SUPABASE_KEY)

print("Flask Supabase URL:", SUPABASE_URL)
print("Flask Supabase key length:", len(SUPABASE_KEY))

supabase = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)


# ============================================================
# AUTOREG PRODUCTION MODEL PACKAGE LOADER
# ============================================================

AUTOREG_DIR = os.path.join(BASE_DIR, "models", "autoreg")
METADATA_PATH = os.path.join(AUTOREG_DIR, "model_metadata.json")
CONFIG_PATH = os.path.join(AUTOREG_DIR, "RMIMS_training_config.json")

# Load training configuration and metadata
training_config = {}
if os.path.exists(CONFIG_PATH):
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        training_config = json.load(f)

model_metadata = {}
if os.path.exists(METADATA_PATH):
    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        model_metadata = json.load(f)

# In-memory model cache for the 30 AutoReg models
autoreg_models = {}

for material_key, meta in model_metadata.items():
    rel_file = meta.get("model_file", "")
    filename = os.path.basename(rel_file)
    pkl_path = os.path.join(AUTOREG_DIR, filename)

    if os.path.exists(pkl_path):
        try:
            model_obj = joblib.load(pkl_path)
            trend_setting = getattr(model_obj.model, "trend", "ct")
            entry = {
                "material": meta.get("material", material_key),
                "unit": meta.get("unit", "kg"),
                "model_name": meta.get("model", "AutoReg"),
                "lags": meta.get("lags", 7),
                "trend": trend_setting,
                "frequency": meta.get("frequency", "weekly"),
                "training_start": meta.get("training_start", "2025-01-05"),
                "training_end": meta.get("training_end", "2026-08-16"),
                "observations": meta.get("observations", 85),
                "model": model_obj
            }
            autoreg_models[material_key] = entry
            autoreg_models[material_key.lower().strip()] = entry
        except Exception as e:
            print(f"Warning: Failed to load model for {material_key} from {pkl_path}: {e}")
    else:
        print(f"Warning: Model file not found for {material_key} at {pkl_path}")

print(f"AutoReg Production Package loaded successfully. Cached models: {len(model_metadata)}")


# ============================================================
# HELPER & VALIDATION FUNCTIONS
# ============================================================

SUPPORTED_UNITS = ["kg", "L", "loaf"]


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
    norm_rec = normalize_unit(received_unit)
    norm_exp = normalize_unit(expected_unit)
    return norm_rec == norm_exp


def get_material_model(material_name):
    """Retrieve the AutoReg model entry for a material name."""
    if not material_name:
        return None
    key = str(material_name).strip()
    if key in autoreg_models:
        return autoreg_models[key]
    key_lower = key.lower()
    if key_lower in autoreg_models:
        return autoreg_models[key_lower]
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


def get_inventory(material_name, authenticated_supabase):
    """Get actual material inventory record from Supabase."""
    try:
        response = (
            authenticated_supabase
            .table("materials")
            .select("id, material_name, unit, quantity, minimum_threshold, status")
            .eq("material_name", material_name)
            .execute()
        )
        if not response.data:
            response = (
                authenticated_supabase
                .table("materials")
                .select("id, material_name, unit, quantity, minimum_threshold, status")
                .ilike("material_name", material_name)
                .execute()
            )
        return response.data[0] if response.data else None
    except Exception as e:
        print(f"Inventory query notice for {material_name}: {e}")
        return None


def get_historical_usage_records(material_name, authenticated_supabase):
    """Fetch live consumption records for the material from Supabase."""
    try:
        response = (
            authenticated_supabase
            .table("usage_records")
            .select("usage_date, created_at, used_quantity, unit")
            .ilike("material_name", material_name)
            .order("usage_date", desc=False)
            .execute()
        )
        return response.data or []
    except Exception as e:
        print(f"Historical usage fetch notice for {material_name}: {e}")
        return []


def build_current_weekly_series(material_info, usage_records_data=None):
    """
    Build current weekly time-series combining the model's locked baseline series
    with actual consumption records retrieved from Supabase. Handles empty Supabase cleanly.
    """
    model_obj = material_info["model"]
    baseline_vals = model_obj.model.data.orig_endog.values
    training_end_str = material_info.get("training_end", "2026-08-16")

    # Generate baseline W-SUN weekly dates ending at training_end (85 observations)
    dates = pd.date_range(end=training_end_str, periods=len(baseline_vals), freq="W-SUN")
    series = pd.Series(baseline_vals, index=dates, name="quantity_consumed", dtype=float)

    if not usage_records_data:
        return series

    # Process and validate Supabase usage records
    valid_records = []
    for r in usage_records_data:
        qty = r.get("used_quantity") if r.get("used_quantity") is not None else r.get("quantity")
        raw_date = r.get("usage_date") or r.get("created_at")
        unit = r.get("unit")

        if qty is not None and raw_date:
            try:
                num_qty = float(qty)
                if num_qty >= 0 and (not unit or is_unit_compatible(unit, material_info["unit"])):
                    valid_records.append({
                        "date": pd.to_datetime(raw_date),
                        "quantity": num_qty
                    })
            except Exception:
                continue

    if not valid_records:
        return series

    df_supa = pd.DataFrame(valid_records)
    supa_weekly = df_supa.resample("W-SUN", on="date")["quantity"].sum()

    # NO DOUBLE COUNTING:
    # Update existing weeks or append new weeks to series
    for dt, val in supa_weekly.items():
        series[dt] = float(val)

    series = series.sort_index()
    return series


def generate_autoreg_forecasts(material_info, usage_records_data=None):
    """
    Generate 7-day operational and 4-week monthly planning forecasts
    by fitting an AutoReg(lags=7) runtime model directly on the current
    Supabase-derived weekly time-series (or trained baseline when Supabase is empty).
    """
    # 1. Build current weekly time-series incorporating Supabase consumption data
    current_weekly_series = build_current_weekly_series(material_info, usage_records_data)
    obs_count = len(current_weekly_series)
    lags = material_info.get("lags", 7)
    trend = material_info.get("trend", "ct")

    # 2. Re-instantiate runtime AutoReg model with locked specification (AutoReg, lags=7, trend)
    runtime_model = AutoReg(current_weekly_series, lags=lags, trend=trend).fit()

    # 3. Generate 7-day forecast (Step 1 ahead)
    pred_step1 = runtime_model.predict(start=obs_count, end=obs_count)
    qty_7day = float(pred_step1.iloc[0]) if hasattr(pred_step1, "iloc") else float(pred_step1[0])

    # 4. Generate 4-week / 1-month forecast (Steps 1 to 4 ahead)
    pred_step4 = runtime_model.predict(start=obs_count, end=obs_count + 3)
    qty_1month = float(pred_step4.sum()) if hasattr(pred_step4, "sum") else sum(float(x) for x in pred_step4)

    # 5. Enforce non-negative, finite, numeric bounds
    if math.isnan(qty_7day) or math.isinf(qty_7day):
        qty_7day = 0.0
    else:
        qty_7day = max(0.0, qty_7day)

    if math.isnan(qty_1month) or math.isinf(qty_1month):
        qty_1month = 0.0
    else:
        qty_1month = max(0.0, qty_1month)

    # 6. Calculate dynamic dates based on the latest date in the current series
    latest_date = current_weekly_series.index[-1]
    anchor_date = pd.Timestamp(latest_date)

    forecast_start = anchor_date + pd.Timedelta(days=1)
    forecast_7day_end = forecast_start + pd.Timedelta(days=6)
    forecast_1month_end = forecast_start + pd.Timedelta(days=27)

    return {
        "historicalEnd": anchor_date.date().isoformat(),
        "seriesLength": obs_count,
        "latestWeeklyValue": float(current_weekly_series.iloc[-1]),
        "forecast7Day": {
            "start": forecast_start.date().isoformat(),
            "end": forecast_7day_end.date().isoformat(),
            "quantity": round(qty_7day, 2),
            "unit": material_info["unit"]
        },
        "forecast1Month": {
            "start": forecast_start.date().isoformat(),
            "end": forecast_1month_end.date().isoformat(),
            "quantity": round(qty_1month, 2),
            "unit": material_info["unit"]
        }
    }


# ============================================================
# API ENDPOINTS
# ============================================================

@app.get("/api/ml/status")
def ml_status():
    """Return backend status and AutoReg model metadata."""
    unique_materials = set(meta["material"] for meta in model_metadata.values())
    return jsonify({
        "status": "connected",
        "model": "AutoReg Time-Series",
        "model_version": "production_autoreg",
        "raw_material_models": len(unique_materials),
        "forecast_frequency": training_config.get("frequency", "weekly"),
        "lags": training_config.get("lags", 7),
        "training_period": f"{training_config.get('training_start', '2025-01-01')} to {training_config.get('training_end', '2026-08-16')}",
        "supported_units": SUPPORTED_UNITS
    })


@app.route("/api/ml/materials", methods=["GET"])
def forecast_materials():
    """Return list of all trained materials with model metadata and units."""
    unique_materials = sorted(list(set(meta["material"] for meta in model_metadata.values())))
    models_summary = []
    seen = set()
    for meta in model_metadata.values():
        mat_name = meta["material"]
        if mat_name not in seen:
            seen.add(mat_name)
            models_summary.append({
                "material": mat_name,
                "name": mat_name,
                "unit": meta.get("unit", "kg"),
                "lags": meta.get("lags", 7),
                "frequency": meta.get("frequency", "weekly")
            })
    return jsonify({
        "materials": unique_materials,
        "count": len(unique_materials),
        "models": models_summary
    })


@app.route("/api/ml/forecast", methods=["GET", "POST"])
def generic_forecast():
    """Support both GET/POST for material forecasting with query param or body."""
    material_name = "Sugar"
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        material_name = data.get("material") or data.get("raw_material_name") or "Sugar"
    else:
        material_name = request.args.get("material") or request.args.get("raw_material_name") or "Sugar"
    return material_forecast_inventory(material_name)


@app.route("/api/ml/inventory/<material_name>", methods=["GET"])
def material_inventory(material_name):
    """Retrieve raw inventory data from Supabase for a material."""
    try:
        authenticated_supabase, auth_error = get_authenticated_client()
        if auth_error:
            return jsonify({"error": auth_error}), 401

        inventory = get_inventory(material_name, authenticated_supabase)
        if inventory is None:
            return jsonify({"error": f"{material_name} inventory record not found."}), 404

        return jsonify({"rows": [inventory]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ml/inventory/sugar", methods=["GET"])
def sugar_inventory():
    return material_inventory("Sugar")


@app.route("/api/ml/forecast/<material_name>", methods=["GET", "POST"])
def material_forecast(material_name):
    """
    Generate AutoReg 7-day and 1-month forecasts for a material.
    Supports empty Supabase database cleanly using trained historical baseline.
    """
    try:
        material_info = get_material_model(material_name)
        if material_info is None:
            return jsonify({
                "status": "unavailable",
                "message": "Forecast unavailable: insufficient trained historical data for this material.",
                "available_materials": sorted(list(set(meta["material"] for meta in model_metadata.values())))
            }), 404

        forecast_res = generate_autoreg_forecasts(material_info)
        f7 = forecast_res["forecast7Day"]
        f1m = forecast_res["forecast1Month"]

        return jsonify({
            "material": material_info["material"],
            "raw_material_name": material_info["material"],
            "unit": material_info["unit"],
            "historicalEnd": forecast_res["historicalEnd"],
            "forecast7Day": f7,
            "forecast1Month": f1m,
            "forecast_period_start": f7["start"],
            "forecast_period_end": f7["end"],
            "forecast_quantity": f7["quantity"],
            "model": {
                "type": "AutoReg",
                "frequency": "weekly",
                "lags": material_info["lags"],
                "status": "trained"
            }
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/ml/forecast/sugar")
def sugar_forecast():
    return material_forecast("Sugar")


@app.route("/api/ml/forecast/<material_name>/inventory", methods=["GET", "POST"])
def material_forecast_inventory(material_name):
    """
    Generate forecast using live Supabase consumption history and compare against current inventory.
    Handles empty Supabase inventory/usage tables cleanly without crashing.
    """
    try:
        # 1. Authenticate with Supabase if Bearer header present
        authenticated_supabase = None
        auth_header = request.headers.get("Authorization")
        if auth_header:
            try:
                authenticated_supabase, auth_error = get_authenticated_client()
                if auth_error or not authenticated_supabase:
                    authenticated_supabase = supabase
            except Exception:
                authenticated_supabase = supabase
        else:
            authenticated_supabase = supabase

        # 2. Check trained model availability
        material_info = get_material_model(material_name)
        if material_info is None:
            return jsonify({
                "status": "unavailable",
                "message": "Forecast unavailable: insufficient trained historical data for this material.",
                "available_materials": sorted(list(set(meta["material"] for meta in model_metadata.values())))
            }), 404

        # 3. Retrieve real inventory record from Supabase (or handle empty inventory cleanly)
        inventory = get_inventory(material_name, authenticated_supabase)
        has_inventory = inventory is not None

        if has_inventory:
            received_unit = str(inventory.get("unit", "")).strip()
            # 4. Strict Unit Validation
            if not is_unit_compatible(received_unit, material_info["unit"]):
                return jsonify({
                    "status": "invalid",
                    "message": "The material unit does not match the trained forecasting model.",
                    "expected_unit": material_info["unit"],
                    "received_unit": received_unit
                }), 400
            current_stock = float(inventory.get("quantity", 0))
            inv_threshold = inventory.get("minimum_threshold", 0)
            inv_status_raw = inventory.get("status", "Available")
        else:
            received_unit = material_info["unit"]
            current_stock = 0.0
            inv_threshold = 0
            inv_status_raw = "Inventory data unavailable"

        # 5. Retrieve live usage records for this material from Supabase
        usage_records_data = get_historical_usage_records(material_info["material"], authenticated_supabase)

        # 6. Generate dynamic 7-day and 1-month forecasts fitting AutoReg on series
        forecast_res = generate_autoreg_forecasts(material_info, usage_records_data)
        f7 = forecast_res["forecast7Day"]
        f1m = forecast_res["forecast1Month"]

        forecast_qty_7day = f7["quantity"]

        # 7. Compare current stock against 7-day forecast if inventory available
        if has_inventory:
            diff = current_stock - forecast_qty_7day
            if diff < 0:
                decision_status = "Potential Shortage"
                potential_shortage = abs(diff)
            elif diff == 0:
                decision_status = "Sufficient for Forecasted Requirement"
                potential_shortage = 0.0
            else:
                decision_status = "Potential Excess"
                potential_shortage = 0.0
        else:
            diff = 0.0
            decision_status = "Inventory data unavailable"
            potential_shortage = 0.0

        # 8. Construct complete API response
        return jsonify({
            "material": material_info["material"],
            "raw_material_name": material_info["material"],
            "unit": material_info["unit"],
            "historicalEnd": forecast_res["historicalEnd"],

            "forecast7Day": f7,
            "forecast1Month": f1m,

            "current_inventory": {
                "quantity": current_stock,
                "unit": received_unit,
                "minimum_threshold": inv_threshold,
                "status": inv_status_raw
            },

            "forecast": {
                "period_start": f7["start"],
                "period_end": f7["end"],
                "quantity": f7["quantity"],
                "unit": material_info["unit"],
                "model": "AutoReg",
                "model_version": "production_autoreg"
            },

            "comparison": {
                "inventory_quantity_kg": current_stock if normalize_unit(received_unit) == "kg" else None,
                "inventory_quantity": current_stock,
                "difference_kg": round(diff, 2) if normalize_unit(received_unit) == "kg" else None,
                "difference": round(diff, 2) if has_inventory else None,
                "decision_status": decision_status,
                "potential_shortage_kg": round(potential_shortage, 2) if normalize_unit(received_unit) == "kg" else None,
                "potential_shortage": round(potential_shortage, 2) if has_inventory else None,
                "unit": material_info["unit"]
            },

            "model": {
                "type": "AutoReg",
                "frequency": "weekly",
                "lags": material_info["lags"],
                "status": "trained"
            }
        })

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/ml/forecast/sugar/inventory")
def sugar_forecast_inventory():
    return material_forecast_inventory("Sugar")


# ============================================================
# RUN FLASK SERVER
# ============================================================

if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )