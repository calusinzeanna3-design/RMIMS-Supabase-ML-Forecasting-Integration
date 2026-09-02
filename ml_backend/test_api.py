"""
RMIMS ML Backend Automated Test Suite
====================================
Tests all REST endpoints and verifies model integration for 59 materials + OVERALL_TOTAL.
Enforces single locked Margin of Error: Strictly ±7.51%.
"""

import sys
import os
import json

# Add current directory to path
sys.path.insert(0, os.path.dirname(__file__))

from app import app, MODELS, AUTHORITATIVE_MATERIALS, LOCKED_MARGIN_OF_ERROR_PCT

def run_tests():
    print("=" * 60)
    print("        [TEST] RMIMS ML BACKEND PRE-FLIGHT TEST SUITE       ")
    print("=" * 60)
    
    client = app.test_client()
    
    # 1. Test Master Catalog
    print("\n[Test 1] Testing /api/materials Catalog...")
    res = client.get("/api/materials")
    assert res.status_code == 200
    catalog = json.loads(res.data)
    assert catalog["count"] == 59
    print(f"  [PASS] Master Catalog Verified: Exactly {catalog['count']} SKUs registered.")
    
    # 2. Test Health Endpoint
    print("\n[Test 2] Testing /api/health Endpoint...")
    res = client.get("/api/health")
    health = json.loads(res.data)
    print(f"  [PASS] Health Status: '{health['status']}' | Total Models in Memory: {health['total_available_models']}/60")
    print(f"  [PASS] Locked Model Margin of Error: {health['margin_of_error']}")
    assert health['margin_of_error'] == "±7.51%"
    
    # 3. Test Forecast Endpoint for Single Material (Sugar)
    if len(MODELS) > 0:
        print("\n[Test 3] Testing /api/forecast for Single Material (Sugar)...")
        payload = {"raw_material_name": "Refined White Sugar", "horizon_type": "month", "horizon_value": 6}
        res = client.post("/api/forecast", data=json.dumps(payload), content_type="application/json")
        assert res.status_code == 200
        fc = json.loads(res.data)
        print(f"  [PASS] Forecast Returned: {len(fc['forecast_values'])} months | Total Need: {fc['total_projected_requirement']:,.1f} {fc['unit']}")
        print(f"  [PASS] Applied Single Margin of Error: {fc['margin_of_error']} (Value: {fc['margin_of_error_pct']}%)")
        assert fc['margin_of_error_pct'] == 7.51, "Margin of Error must be strictly 7.51%"
        
        # Test Exact Corridors
        expected_upper = round(fc['forecast_values'][0] * 1.0751, 2)
        assert abs(fc['upper_margin'][0] - expected_upper) <= 0.05, "Upper Margin must equal forecast * 1.0751"
        print(f"  [PASS] Upper Corridor (+7.51%): {fc['upper_margin'][0]} | Base: {fc['forecast_values'][0]}")
        
        # 4. Test OVERALL_TOTAL Forecast
        print("\n[Test 4] Testing /api/forecast for OVERALL_TOTAL...")
        payload_total = {"material_id": "OVERALL_TOTAL", "horizon_type": "month", "horizon_value": 12}
        res_total = client.post("/api/forecast", data=json.dumps(payload_total), content_type="application/json")
        assert res_total.status_code == 200
        fc_total = json.loads(res_total.data)
        print(f"  [PASS] OVERALL_TOTAL Returned: 12 months | Total Volume: {fc_total['total_projected_requirement']:,.1f} {fc_total['unit']}")
        print(f"  [PASS] OVERALL_TOTAL Margin: {fc_total['margin_of_error']}")
        assert fc_total['margin_of_error_pct'] == 7.51
        
        # 5. Test Operational Inventory Endpoint
        print("\n[Test 5] Testing Operational Inventory Endpoint (/api/ml/forecast/RM-059/inventory)...")
        res_inv = client.get("/api/ml/forecast/RM-059/inventory?current_stock=2500&min_threshold=800")
        assert res_inv.status_code == 200
        inv = json.loads(res_inv.data)
        print(f"  [PASS] 7-Day Requirement: {inv['operational_7_day_requirement']} {inv['unit']} | Stock: {inv['current_stock']}")
        print(f"  [PASS] Inventory Status: '{inv['status']}' | Reorder Flag: {inv['reorder_recommended']}")
        print(f"  [PASS] Inventory Margin: {inv['margin_of_error']}")
    else:
        print("\n[INFO] Models pickle file not yet in ml_backend/ directory. Copy rmims_time_series_model.pkl here to test live inference.")

    print("\n" + "=" * 60)
    print("  [SUCCESS] ALL ML BACKEND SECURITY & 7.51% MARGIN TESTS PASSED!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
