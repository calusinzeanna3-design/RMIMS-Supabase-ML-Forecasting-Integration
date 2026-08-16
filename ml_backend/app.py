from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client
import joblib
import os
import pandas as pd


# ============================================================
# FLASK APPLICATION
# ============================================================

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# ============================================================
# SUPABASE CONFIGURATION
# ============================================================

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_KEY environment variables are required."
    )

print("Flask Supabase URL:", SUPABASE_URL)
print("Flask Supabase key length:", len(SUPABASE_KEY))

supabase = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)


# ============================================================
# 1-YEAR TIME-SERIES MODEL
# ============================================================

MODEL_PATH = os.path.join(
    BASE_DIR,
    "models",
    "RMIMS_FINAL_TIME_SERIES_MODEL_1YEAR.pkl"
)

model_package = joblib.load(MODEL_PATH)

# Extract the 30 raw-material time-series models
time_series_models = model_package["models"]

print("1-Year Time-Series models loaded successfully.")
print("Loaded raw-material models:", len(time_series_models))
print("Model type:", model_package.get("model_type"))
print("Forecast frequency:", model_package.get("forecast_frequency"))
print("Training period:", model_package.get("training_period"))


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def get_material_model(material_name):
    """Return the trained model for the requested raw material."""
    return time_series_models.get(material_name)


def get_next_forecast_period(model):
    """
    Determine the next weekly forecast period from the fitted model.

    The Jupyter training workflow uses W-SUN, so the model's final
    historical observation represents the end of the historical week.
    """

    dates = model.model.data.dates

    if dates is None or len(dates) == 0:
        raise ValueError(
            "The trained model does not contain historical dates."
        )

    last_training_date = pd.Timestamp(
        dates[-1]
    )

    forecast_period_end = (
        last_training_date
        + pd.Timedelta(days=7)
    )

    forecast_period_start = (
        forecast_period_end
        - pd.Timedelta(days=6)
    )

    return (
        forecast_period_start,
        forecast_period_end
    )


def generate_material_forecast(material_name):
    """Generate the next weekly forecast for one raw material."""

    model = get_material_model(
        material_name
    )

    if model is None:
        raise KeyError(
            f"No trained time-series model found for "
            f"'{material_name}'."
        )

    forecast_period_start, forecast_period_end = (
        get_next_forecast_period(model)
    )

    forecast = model.predict(
        start=forecast_period_end,
        end=forecast_period_end
    )

    forecast_quantity = float(
        forecast.iloc[0]
    )

    # Prevent a negative predicted consumption value.
    forecast_quantity = max(
        forecast_quantity,
        0.0
    )

    return {
        "forecast_period_start":
            forecast_period_start.date().isoformat(),

        "forecast_period_end":
            forecast_period_end.date().isoformat(),

        "forecast_quantity":
            round(
                forecast_quantity,
                2
            )
    }


def normalize_inventory_to_kg(
    quantity,
    unit
):
    """Convert supported inventory units to kg."""

    original_unit = str(
        unit
    ).strip()

    normalized_unit = (
        original_unit.lower()
    )

    quantity = float(
        quantity
    )

    if normalized_unit in [
        "g",
        "gram",
        "grams"
    ]:

        return quantity / 1000.0

    if normalized_unit in [
        "kg",
        "kilogram",
        "kilograms"
    ]:

        return quantity

    raise ValueError(
        "Unsupported inventory unit: "
        + original_unit
    )


def get_inventory(
    material_name,
    authenticated_supabase
):
    """Get the actual inventory record from Supabase."""

    response = (
        authenticated_supabase
        .table("materials")
        .select(
            "id, material_name, unit, quantity, "
            "minimum_threshold, status"
        )
        .eq(
            "material_name",
            material_name
        )
        .execute()
    )

    if not response.data:
        return None

    return response.data[0]


# ============================================================
# AUTHENTICATED SUPABASE CLIENT
# ============================================================

def get_authenticated_client():

    authorization = request.headers.get(
        "Authorization"
    )

    if not authorization:
        return (
            None,
            "Authorization header is required."
        )

    if not authorization.startswith(
        "Bearer "
    ):

        return (
            None,
            "Authorization header must use Bearer token."
        )

    access_token = authorization.replace(
        "Bearer ",
        "",
        1
    ).strip()

    if not access_token:
        return (
            None,
            "Access token is missing."
        )

    try:

        authenticated_supabase = create_client(
            SUPABASE_URL,
            SUPABASE_KEY
        )

        authenticated_supabase.postgrest.auth(
            access_token
        )

        return (
            authenticated_supabase,
            None
        )

    except Exception as e:

        return (
            None,
            str(e)
        )


# ============================================================
# API STATUS
# ============================================================

@app.get("/api/ml/status")
def ml_status():

    return jsonify({

        "status": "connected",

        "model": "Time-Series",

        "model_version": "1-year",

        "raw_material_models":
            len(time_series_models),

        "forecast_frequency":
            model_package.get(
                "forecast_frequency",
                "weekly"
            ),

        "training_period":
            model_package.get(
                "training_period"
            )

    })


# ============================================================
# LIST AVAILABLE FORECAST MATERIALS
# ============================================================

@app.get("/api/ml/materials")
def forecast_materials():

    return jsonify({

        "materials":
            sorted(
                time_series_models.keys()
            ),

        "count":
            len(time_series_models)

    })


# ============================================================
# REAL INVENTORY — GENERIC
# ============================================================

@app.get(
    "/api/ml/inventory/<material_name>"
)
def material_inventory(
    material_name
):

    try:

        authenticated_supabase, auth_error = (
            get_authenticated_client()
        )

        if auth_error:

            return jsonify({
                "error": auth_error
            }), 401

        inventory = get_inventory(
            material_name,
            authenticated_supabase
        )

        if inventory is None:

            return jsonify({
                "error": (
                    f"{material_name} "
                    "inventory record not found."
                )
            }), 404

        return jsonify({
            "rows": [inventory]
        })

    except Exception as e:

        return jsonify({
            "error": str(e)
        }), 500


# ============================================================
# SUGAR INVENTORY — BACKWARD COMPATIBILITY
# ============================================================

@app.get(
    "/api/ml/inventory/sugar"
)
def sugar_inventory():

    return material_inventory(
        "Sugar"
    )


# ============================================================
# GENERIC TIME-SERIES FORECAST
# ============================================================

@app.get(
    "/api/ml/forecast/<material_name>"
)
def material_forecast(
    material_name
):

    try:

        model = get_material_model(
            material_name
        )

        if model is None:

            return jsonify({

                "error": (
                    f"No trained time-series "
                    f"model found for "
                    f"'{material_name}'."
                ),

                "available_materials":
                    sorted(
                        time_series_models.keys()
                    )

            }), 404

        forecast_result = (
            generate_material_forecast(
                material_name
            )
        )

        return jsonify({

            "raw_material_name":
                material_name,

            "unit":
                "kg",

            "forecast_period_start":
                forecast_result[
                    "forecast_period_start"
                ],

            "forecast_period_end":
                forecast_result[
                    "forecast_period_end"
                ],

            "forecast_quantity":
                forecast_result[
                    "forecast_quantity"
                ],

            "model":
                "Time-Series",

            "model_version":
                "1-year"

        })

    except Exception as e:

        return jsonify({
            "error": str(e)
        }), 500


# ============================================================
# SUGAR TIME-SERIES FORECAST — BACKWARD COMPATIBILITY
# ============================================================

@app.get(
    "/api/ml/forecast/sugar"
)
def sugar_forecast():

    return material_forecast(
        "Sugar"
    )


# ============================================================
# GENERIC FORECAST + REAL INVENTORY
# ============================================================

@app.get(
    "/api/ml/forecast/<material_name>/inventory"
)
def material_forecast_inventory(
    material_name
):

    try:

        # ====================================================
        # 1. AUTHENTICATED SUPABASE ACCESS
        # ====================================================

        authenticated_supabase, auth_error = (
            get_authenticated_client()
        )

        if auth_error:

            return jsonify({
                "error": auth_error
            }), 401


        # ====================================================
        # 2. CHECK MODEL
        # ====================================================

        if material_name not in time_series_models:

            return jsonify({

                "error": (
                    f"No trained model found "
                    f"for '{material_name}'."
                )

            }), 404


        # ====================================================
        # 3. GET REAL INVENTORY FROM SUPABASE
        # ====================================================

        inventory = get_inventory(
            material_name,
            authenticated_supabase
        )

        if inventory is None:

            return jsonify({

                "error": (
                    f"{material_name} "
                    "inventory record not found."
                )

            }), 404


        # ====================================================
        # 4. GET FORECAST FROM 1-YEAR MODEL
        # ====================================================

        forecast_result = (
            generate_material_forecast(
                material_name
            )
        )

        forecast_quantity = (
            forecast_result[
                "forecast_quantity"
            ]
        )


        # ====================================================
        # 5. GET REAL INVENTORY VALUES
        # ====================================================

        inventory_quantity = float(
            inventory["quantity"]
        )

        original_inventory_unit = str(
            inventory["unit"]
        ).strip()


        # ====================================================
        # 6. UNIT NORMALIZATION
        # ====================================================

        inventory_quantity_kg = (
            normalize_inventory_to_kg(
                inventory_quantity,
                original_inventory_unit
            )
        )


        # ====================================================
        # 7. COMPARE REAL STOCK WITH FORECAST
        # ====================================================

        difference_kg = (
            inventory_quantity_kg
            - forecast_quantity
        )


        if difference_kg < 0:

            decision_status = (
                "Potential Shortage"
            )

            potential_shortage_kg = abs(
                difference_kg
            )

        elif difference_kg == 0:

            decision_status = (
                "Sufficient for Forecasted Requirement"
            )

            potential_shortage_kg = 0

        else:

            decision_status = (
                "Potential Excess"
            )

            potential_shortage_kg = 0


        # ====================================================
        # 8. RETURN DECISION-SUPPORT RESULT
        # ====================================================

        return jsonify({

            "raw_material_name":
                inventory[
                    "material_name"
                ],

            "current_inventory": {

                "quantity":
                    inventory_quantity,

                "unit":
                    original_inventory_unit,

                "minimum_threshold":
                    inventory[
                        "minimum_threshold"
                    ],

                "status":
                    inventory[
                        "status"
                    ]

            },

            "forecast": {

                "period_start":
                    forecast_result[
                        "forecast_period_start"
                    ],

                "period_end":
                    forecast_result[
                        "forecast_period_end"
                    ],

                "quantity":
                    round(
                        forecast_quantity,
                        2
                    ),

                "unit":
                    "kg",

                "model":
                    "Time-Series",

                "model_version":
                    "1-year"

            },

            "comparison": {

                "inventory_quantity_kg":
                    round(
                        inventory_quantity_kg,
                        4
                    ),

                "difference_kg":
                    round(
                        difference_kg,
                        2
                    ),

                "decision_status":
                    decision_status,

                "potential_shortage_kg":
                    round(
                        potential_shortage_kg,
                        2
                    )

            }

        })


    except ValueError as e:

        return jsonify({
            "error": str(e)
        }), 400

    except Exception as e:

        return jsonify({
            "error": str(e)
        }), 500


# ============================================================
# SUGAR FORECAST + REAL INVENTORY — BACKWARD COMPATIBILITY
# ============================================================

@app.get(
    "/api/ml/forecast/sugar/inventory"
)
def sugar_forecast_inventory():

    return material_forecast_inventory(
        "Sugar"
    )


# ============================================================
# RUN FLASK
# ============================================================

if __name__ == "__main__":

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )