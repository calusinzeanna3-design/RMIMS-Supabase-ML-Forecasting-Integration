import json
import math
import os
import sys
import unittest
import pandas as pd

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import (
    app,
    autoreg_models,
    model_metadata,
    training_config,
    is_unit_compatible,
    generate_autoreg_forecasts,
    build_current_weekly_series,
    normalize_unit
)


class TestForecastingIntegration(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()
        cls.base_dir = os.path.dirname(os.path.abspath(__file__))

    def test_01_old_pkl_files_untouched(self):
        """Verify old .pkl files exist and were not deleted or modified."""
        old_file1 = os.path.join(self.base_dir, "models", "RMIMS_FINAL_TIME_SERIES_MODEL_1YEAR.pkl")
        old_file2 = os.path.join(self.base_dir, "models", "RMIMS_Sugar_TimeSeries_Model.pkl")
        self.assertTrue(os.path.exists(old_file1), "RMIMS_FINAL_TIME_SERIES_MODEL_1YEAR.pkl must remain untouched.")
        self.assertTrue(os.path.exists(old_file2), "RMIMS_Sugar_TimeSeries_Model.pkl must remain untouched.")

    def test_02_all_30_autoreg_models_loaded(self):
        """Verify all 30 AutoReg model files load successfully."""
        unique_loaded = set(meta["material"] for meta in model_metadata.values())
        self.assertEqual(len(unique_loaded), 30, f"Expected 30 unique trained materials, got {len(unique_loaded)}")

    def test_03_status_endpoint(self):
        """Verify /api/ml/status returns correct AutoReg metadata."""
        res = self.client.get("/api/ml/status")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get("status"), "connected")
        self.assertEqual(data.get("model"), "AutoReg Time-Series")
        self.assertEqual(data.get("raw_material_models"), 30)
        self.assertEqual(data.get("lags"), 7)
        self.assertEqual(data.get("forecast_frequency"), "weekly")

    def test_04_materials_endpoint(self):
        """Verify /api/ml/materials returns list of 30 materials."""
        res = self.client.get("/api/ml/materials")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(len(data.get("materials", [])), 30)
        self.assertIn("Sugar", data["materials"])
        self.assertIn("Cooking Oil", data["materials"])
        self.assertIn("Loaf Bread", data["materials"])
        self.assertIn("Water", data["materials"])

    def test_05_empty_supabase_sugar_forecast(self):
        """Verify Sugar returns HTTP 200, kg unit, 7-day & 1-month forecasts when Supabase is empty."""
        res = self.client.get("/api/ml/forecast/Sugar")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get("material"), "Sugar")
        self.assertEqual(data.get("unit"), "kg")

        f7 = data.get("forecast7Day", {})
        f1m = data.get("forecast1Month", {})

        self.assertEqual(f7.get("start"), "2026-08-17")
        self.assertEqual(f7.get("end"), "2026-08-23")
        self.assertGreater(f7.get("quantity", -1), 0)

        self.assertEqual(f1m.get("start"), "2026-08-17")
        self.assertEqual(f1m.get("end"), "2026-09-13")
        self.assertGreater(f1m.get("quantity", -1), 0)

    def test_06_empty_supabase_cooking_oil_forecast(self):
        """Verify Cooking Oil returns HTTP 200 and L unit when Supabase is empty."""
        res = self.client.get("/api/ml/forecast/Cooking%20Oil")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get("unit"), "L")

    def test_07_empty_supabase_loaf_bread_forecast(self):
        """Verify Loaf Bread returns HTTP 200 and loaf unit when Supabase is empty."""
        res = self.client.get("/api/ml/forecast/Loaf%20Bread")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get("unit"), "loaf")

    def test_08_empty_supabase_water_forecast(self):
        """Verify Water returns HTTP 200 and L unit when Supabase is empty."""
        res = self.client.get("/api/ml/forecast/Water")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get("unit"), "L")

    def test_09_all_30_materials_empty_supabase_forecast(self):
        """Verify all 30 trained materials generate HTTP 200 forecasts when Supabase is empty."""
        unique_materials = sorted(list(set(meta["material"] for meta in model_metadata.values())))
        for mat in unique_materials:
            res = self.client.get(f"/api/ml/forecast/{mat}")
            self.assertEqual(res.status_code, 200, f"Forecast failed for material {mat}")
            data = res.get_json()
            self.assertEqual(data.get("material"), mat)
            self.assertIn("forecast7Day", data)
            self.assertIn("forecast1Month", data)
            self.assertGreaterEqual(data["forecast7Day"]["quantity"], 0.0)
            self.assertGreaterEqual(data["forecast1Month"]["quantity"], 0.0)
            self.assertFalse(math.isnan(data["forecast7Day"]["quantity"]))
            self.assertFalse(math.isinf(data["forecast7Day"]["quantity"]))

    def test_10_untrained_material_returns_404(self):
        """Verify requesting forecast for untrained material returns 404 unavailable."""
        res = self.client.get("/api/ml/forecast/Dragonfruit")
        self.assertEqual(res.status_code, 404)
        data = res.get_json()
        self.assertEqual(data.get("status"), "unavailable")
        self.assertIn("insufficient trained historical data", data.get("message", ""))

    def test_11_unit_compatibility_and_mismatch(self):
        """Verify unit compatibility and mismatch checking."""
        self.assertTrue(is_unit_compatible("kg", "kg"))
        self.assertTrue(is_unit_compatible("kilogram", "kg"))
        self.assertTrue(is_unit_compatible("L", "l"))
        self.assertTrue(is_unit_compatible("liter", "L"))
        self.assertTrue(is_unit_compatible("loaf", "loaf"))
        self.assertFalse(is_unit_compatible("sack", "kg"))
        self.assertFalse(is_unit_compatible("box", "L"))

    def test_12_no_double_counting_on_existing_week_update(self):
        """Verify updating an existing historical week replaces the value rather than double counting."""
        sugar_info = autoreg_models["Sugar"]
        baseline_series = build_current_weekly_series(sugar_info, usage_records_data=None)

        # Update latest baseline week (2026-08-16) with 250.0 kg
        records = [{"usage_date": "2026-08-16", "used_quantity": 250.0, "unit": "kg"}]
        updated_series = build_current_weekly_series(sugar_info, usage_records_data=records)

        self.assertEqual(len(baseline_series), len(updated_series), "Series length must remain 85 when updating existing week.")
        self.assertEqual(updated_series.loc["2026-08-16"], 250.0, "Existing week value must be replaced cleanly without double-counting.")

    def test_13_new_weekly_consumption_appends_and_shifts_dates(self):
        """Verify adding a new week after 2026-08-16 appends a new week and shifts forecast dates forward."""
        sugar_info = autoreg_models["Sugar"]

        # Add a record in a new week (2026-08-23)
        records = [{"usage_date": "2026-08-23", "used_quantity": 80.0, "unit": "kg"}]
        forecast_res = generate_autoreg_forecasts(sugar_info, usage_records_data=records)

        self.assertEqual(forecast_res["seriesLength"], 86, "Series length must increase to 86 when new week is appended.")
        self.assertEqual(forecast_res["historicalEnd"], "2026-08-23")
        self.assertEqual(forecast_res["forecast7Day"]["start"], "2026-08-24")
        self.assertEqual(forecast_res["forecast7Day"]["end"], "2026-08-30")
        self.assertEqual(forecast_res["forecast1Month"]["start"], "2026-08-24")
        self.assertEqual(forecast_res["forecast1Month"]["end"], "2026-09-20")

    def test_14_missing_inventory_record_resilience(self):
        """Verify forecast endpoint succeeds even if Supabase inventory record is missing."""
        res = self.client.get("/api/ml/forecast/Sugar/inventory")
        self.assertEqual(res.status_code, 200, "Must return HTTP 200 even if inventory record is missing.")
        data = res.get_json()
        self.assertIn("forecast7Day", data)
        self.assertIn("forecast1Month", data)
        self.assertEqual(data["current_inventory"]["status"], "Inventory data unavailable")

    def test_15_non_negative_finite_predictions(self):
        """Verify all predicted quantities are numeric, non-negative, and finite."""
        for name, entry in autoreg_models.items():
            if isinstance(name, str) and not name.islower():
                fc = generate_autoreg_forecasts(entry)
                self.assertGreaterEqual(fc["forecast7Day"]["quantity"], 0.0)
                self.assertGreaterEqual(fc["forecast1Month"]["quantity"], 0.0)
                self.assertFalse(math.isnan(fc["forecast7Day"]["quantity"]))
                self.assertFalse(math.isinf(fc["forecast7Day"]["quantity"]))


if __name__ == "__main__":
    unittest.main()
