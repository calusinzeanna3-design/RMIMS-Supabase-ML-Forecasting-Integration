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
    autoreg_models,
    model_registry_list,
    AUTHORITATIVE_MATERIALS,
    EXPECTED_MODELS_COUNT,
    EXPECTED_TRAINING_START,
    EXPECTED_TRAINING_END,
    FINAL_MODELS_DIR,
    get_material_model,
    get_inventory,
    get_historical_usage_records,
    is_unit_compatible,
    generate_autoreg_forecasts,
    build_current_weekly_series,
    normalize_unit,
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

    def test_03_material_disbursements_database_query(self):
        """3. Verify public.material_disbursements query executes gracefully."""
        records = get_historical_usage_records("Chiton", supabase)
        self.assertIsInstance(records, list)

    def test_04_current_stock_dynamic_source(self):
        """4. Verify current stock is retrieved dynamically from DB or marked not recorded (no fake defaults)."""
        res = self.client.get("/api/ml/forecast/RM001/inventory")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("current_inventory", data)
        if not data["current_inventory"]["recorded_in_db"]:
            self.assertIsNone(data["current_inventory"]["current_stock"])
            self.assertEqual(data["decision_support"]["decision_status"], "Inventory data unavailable")

    def test_05_historical_consumption_dynamic_integration(self):
        """5. Verify historical consumption records dynamically update weekly series when provided."""
        chiton_info = autoreg_models["RM001"]
        baseline_series = build_current_weekly_series(chiton_info, usage_records_data=None)

        mock_real_record = [{"usage_date": "2026-08-23", "consumed_quantity": 45.0, "unit": "kg"}]
        updated_series = build_current_weekly_series(chiton_info, usage_records_data=mock_real_record)

        self.assertGreater(len(updated_series), len(baseline_series), "New consumption period must expand weekly series.")
        self.assertEqual(updated_series.loc["2026-08-23"], 45.0)

    def test_06_rm001_resolves_to_chiton(self):
        """6. Verify RM001 maps strictly to Chiton."""
        entry = autoreg_models.get("RM001")
        self.assertIsNotNone(entry)
        self.assertEqual(entry["raw_material_name"], "Chiton")
        self.assertEqual(entry["unit"], "kg")

    def test_07_rm002_resolves_to_salt(self):
        """7. Verify RM002 maps strictly to Salt."""
        entry = autoreg_models.get("RM002")
        self.assertIsNotNone(entry)
        self.assertEqual(entry["raw_material_name"], "Salt")
        self.assertEqual(entry["unit"], "kg")

    def test_08_all_30_authoritative_material_mappings(self):
        """8. Verify all 30 material mappings remain strictly correct per Phase 6 mapping."""
        expected_names = [
            ("RM001", "Chiton"), ("RM002", "Salt"), ("RM003", "Ground Pepper"),
            ("RM004", "Crushed Garlic"), ("RM005", "Optional Spices or Flavorings"),
            ("RM006", "Cooking Oil"), ("RM007", "Small Shrimp"), ("RM008", "Garlic"),
            ("RM009", "Onion"), ("RM010", "Spring Onion"), ("RM011", "Cabbage"),
            ("RM012", "Carrots"), ("RM013", "Bell Pepper"), ("RM014", "Soy Sauce"),
            ("RM015", "Sesame Oil"), ("RM016", "Oyster Sauce"), ("RM017", "Chicken"),
            ("RM018", "Pork"), ("RM019", "Loaf Bread"), ("RM020", "Butter or Margarine"),
            ("RM021", "Sugar"), ("RM022", "Pork Skin"), ("RM023", "Raw Bananas"),
            ("RM024", "Turmeric Powder"), ("RM025", "Water"), ("RM026", "White Sugar"),
            ("RM027", "Peanuts"), ("RM028", "Sea Salt"), ("RM029", "Honey"),
            ("RM030", "Oil")
        ]

        for rm_id, expected_name in expected_names:
            entry = autoreg_models.get(rm_id)
            self.assertIsNotNone(entry, f"Missing model for {rm_id}")
            self.assertEqual(entry["raw_material_name"], expected_name, f"Mismatch on {rm_id}")

    def test_09_no_legacy_models_loaded(self):
        """9. Verify legacy models in models/autoreg/ are quarantined and not loaded."""
        legacy_dir = os.path.join(self.base_dir, "models", "autoreg")
        self.assertNotEqual(FINAL_MODELS_DIR, legacy_dir, "FINAL_MODELS_DIR must point to RMIMS_FINAL_MODELS, not legacy.")

    def test_10_no_hardcoded_forecast_values(self):
        """10. Verify forecast outputs are calculated dynamically from AutoReg rather than static constants."""
        sugar_info = autoreg_models["RM021"]
        fc1 = generate_autoreg_forecasts(sugar_info)
        f7_val1 = fc1["forecast7Day"]["quantity"]

        fc2 = generate_autoreg_forecasts(sugar_info, usage_records_data=[{"usage_date": "2026-08-09", "consumed_quantity": 999.0, "unit": "kg"}])
        f7_val2 = fc2["forecast7Day"]["quantity"]

        self.assertNotEqual(f7_val1, f7_val2, "Forecast values must respond dynamically to consumption data.")

    def test_11_missing_database_data_error_handling(self):
        """11. Verify missing or invalid material returns clear error status (no silent fake data)."""
        res = self.client.get("/api/ml/forecast/NonExistentMaterial123")
        self.assertEqual(res.status_code, 404)
        data = res.get_json()
        self.assertEqual(data.get("status"), "unavailable")
        self.assertIn("no trained AutoReg model found", data.get("message", ""))

    def test_12_weekly_forecast_dynamically_generated(self):
        """12. Verify weekly forecast (7-day horizon) is generated dynamically."""
        res = self.client.get("/api/ml/forecast/RM006")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("forecast7Day", data)
        f7 = data["forecast7Day"]
        self.assertIn("start", f7)
        self.assertIn("end", f7)
        self.assertGreater(f7["quantity"], 0)
        self.assertEqual(f7["unit"], "L")

    def test_13_monthly_forecast_dynamically_generated(self):
        """13. Verify monthly forecast (4-week horizon) is generated dynamically."""
        res = self.client.get("/api/ml/forecast/RM006")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("forecast1Month", data)
        f1m = data["forecast1Month"]
        self.assertIn("start", f1m)
        self.assertIn("end", f1m)
        self.assertGreater(f1m["quantity"], 0)
        self.assertEqual(f1m["unit"], "L")

    def test_14_training_cutoff_20260809_preserved(self):
        """14. Verify all models end strictly at 2026-08-09 (no Aug 10-17 training leakage)."""
        for item in model_registry_list:
            rm_id = item["material_id"]
            entry = autoreg_models[rm_id]
            self.assertEqual(entry["training_end"], EXPECTED_TRAINING_END)
            self.assertEqual(entry["observations"], 586)

    def test_15_authentication_bearer_handling(self):
        """15. Verify Bearer token authorization header is processed properly without leaking secrets."""
        res = self.client.get("/api/ml/forecast/RM001/inventory", headers={"Authorization": "Bearer mock_expired_jwt"})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["status"], "success")
        self.assertNotIn("SUPABASE_KEY", json.dumps(data))
        self.assertNotIn("service_role", json.dumps(data))


if __name__ == "__main__":
    unittest.main()
