import json
import math
import os
import sys
import unittest
import pandas as pd

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Set environment credentials for test environment
os.environ.setdefault("SUPABASE_URL", "https://hgandqozgcpytxebhvtn.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-")

from app import (
    app,
    supabase,
    MODELS,
    model_lookup,
    model_registry_list,
    get_material_model,
    get_inventory,
    generate_time_series_forecast,
    normalize_unit,
    is_unit_compatible,
)


class TestForecastingIntegration(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()
        cls.base_dir = os.path.dirname(os.path.abspath(__file__))

    def test_01_supabase_client_initialization(self):
        """1. Verify Supabase client initializes correctly with valid URL and key."""
        self.assertIsNotNone(supabase, "Supabase client must be initialized.")
        self.assertTrue(hasattr(supabase, "table"), "Supabase client must provide table query methods.")

    def test_02_raw_materials_database_query(self):
        """2. Verify public.raw_materials query is handled gracefully without crashing."""
        res = get_inventory("Chiton", supabase)
        self.assertTrue(res is None or isinstance(res, dict))

    def test_03_health_check_endpoint(self):
        """3. Verify /api/health and /health report healthy status with 27 models."""
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["total_available_models"], 27)
        self.assertTrue(data["overall_general_supported"])

    def test_04_materials_list_endpoint(self):
        """4. Verify /api/materials returns 26 individual materials and general support."""
        res = self.client.get("/api/materials")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["total_materials"], 26)
        self.assertTrue(data["overall_general_supported"])

    def test_05_dynamic_post_forecast_single_material(self):
        """5. Verify POST /api/forecast returns dynamic forecast breakdown for Sugar."""
        payload = {
            "material_name": "Sugar",
            "horizon_type": "month",
            "horizon_value": 3
        }
        res = self.client.post("/api/forecast", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["raw_material_name"], "Sugar")
        self.assertEqual(data["unit"], "kg")
        self.assertEqual(len(data["forecast_breakdown"]), 3)
        self.assertGreater(data["total_forecast_requirement"], 0)

    def test_06_dynamic_post_forecast_overall_total(self):
        """6. Verify POST /api/forecast returns dynamic forecast for OVERALL_TOTAL."""
        payload = {
            "material_name": "OVERALL_TOTAL",
            "horizon_type": "week",
            "horizon_value": 4
        }
        res = self.client.post("/api/forecast", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["raw_material_name"], "OVERALL_TOTAL")
        self.assertEqual(len(data["forecast_breakdown"]), 4)
        self.assertGreater(data["total_forecast_requirement"], 0)

    def test_07_all_27_pure_time_series_models_loaded(self):
        """7. Verify exactly 27 time-series models are loaded in memory."""
        self.assertEqual(len(MODELS), 27)
        expected_keys = [
            'Bell Pepper', 'Butter/Margarine', 'Cabbage', 'Carrots', 'Chicken', 'Chiton',
            'Cooking Oil', 'Garlic', 'Ground Pepper', 'Honey', 'Loaf Bread', 'Onion',
            'Oyster Sauce', 'Peanuts', 'Pork', 'Pork Skin', 'Raw Bananas', 'Salt',
            'Sea Salt', 'Sesame Oil', 'Small Shrimp', 'Soy Sauce', 'Spring Onion',
            'Sugar', 'Turmeric Powder', 'Water', 'OVERALL_TOTAL'
        ]
        for key in expected_keys:
            self.assertIn(key, MODELS, f"Missing model key: {key}")

    def test_08_alias_resolution(self):
        """8. Verify alias resolution works for RM codes and variations."""
        sugar_info = get_material_model("Sugar")
        self.assertIsNotNone(sugar_info)
        self.assertEqual(sugar_info["raw_material_name"], "Sugar")

        butter_info = get_material_model("Butter or Margarine")
        self.assertIsNotNone(butter_info)
        self.assertEqual(butter_info["raw_material_name"], "Butter/Margarine")

        rm001_info = get_material_model("RM001")
        self.assertIsNotNone(rm001_info)
        self.assertEqual(rm001_info["raw_material_name"], "Chiton")

    def test_09_frontend_dashboard_sugar_inventory_route(self):
        """9. Verify /api/ml/forecast/Sugar/inventory returns expected shape."""
        res = self.client.get("/api/ml/forecast/Sugar/inventory")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["status"], "success")
        self.assertIn("forecast7Day", data)
        self.assertIn("forecast1Month", data)
        self.assertIn("decision_support", data)
        self.assertGreater(data["forecast7Day"]["quantity"], 0)

    def test_10_missing_material_error_handling(self):
        """10. Verify missing or invalid material returns clear error status."""
        res = self.client.get("/api/ml/forecast/NonExistentMaterial999")
        self.assertEqual(res.status_code, 404)
        data = res.get_json()
        self.assertEqual(data.get("status"), "unavailable")

    def test_11_invalid_horizon_type_error(self):
        """11. Verify invalid horizon type returns 400 error."""
        res = self.client.post("/api/forecast", json={"material_name": "Sugar", "horizon_type": "decade"})
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertIn("Invalid horizon_type", data.get("error", ""))


if __name__ == "__main__":
    unittest.main()
