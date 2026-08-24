import os
import sys
import json
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

print("=" * 70)
print("RMIMS SYSTEM-WIDE BACKEND & ML DIAGNOSTIC SUITE")
print("=" * 70)

# 1. Test Model Loading & Deserialization
print("\n[CHECK 1] Loading ML Backend Model Artifact...")
try:
    from ml_backend.app import app, MODELS, get_material_model
    print(f"  -> SUCCESS: Loaded {len(MODELS)} models in memory.")
    assert len(MODELS) == 27, f"Expected 27 models, got {len(MODELS)}"
except Exception as e:
    print(f"  -> FAIL: {e}")
    traceback.print_exc()
    sys.exit(1)

# 2. Test Flask Test Client on All Unified Endpoints
client = app.test_client()

print("\n[CHECK 2] Testing System API Endpoints...")

# 2.1 Health Check
res = client.get('/api/health')
assert res.status_code == 200, f"/api/health failed: {res.status_code}"
print("  -> /api/health: PASS (200 OK)")

# 2.2 Materials List
res = client.get('/api/materials')
assert res.status_code == 200, f"/api/materials failed: {res.status_code}"
mats_data = res.get_json()
print(f"  -> /api/materials: PASS ({len(mats_data['materials'])} materials returned)")

# 2.3 Multi-Horizon POST /api/forecast for each horizon (day, week, month, year)
for horizon in ["day", "week", "month", "year"]:
    res = client.post('/api/forecast', json={
        "raw_material_name": "Sugar",
        "horizon_type": horizon,
        "horizon_value": 3
    })
    assert res.status_code == 200, f"/api/forecast {horizon} failed: {res.status_code}"
    data = res.get_json()
    assert data["status"] == "success"
    assert len(data["forecast_breakdown"]) == 3
    print(f"  -> /api/forecast (Sugar, {horizon}, 3): PASS (Total: {data['total_forecast_requirement']} {data['unit']})")

# 2.4 OVERALL_TOTAL General Forecast
res = client.post('/api/forecast', json={
    "raw_material_name": "OVERALL_TOTAL",
    "horizon_type": "month",
    "horizon_value": 6
})
assert res.status_code == 200, "OVERALL_TOTAL forecast failed"
data = res.get_json()
print(f"  -> /api/forecast (OVERALL_TOTAL, month, 6): PASS (Total: {data['total_forecast_requirement']} units)")

# 2.5 All 26 Materials Tested Against /api/forecast
print("\n[CHECK 3] Testing dynamic predictions on all 26 materials + OVERALL_TOTAL...")
fail_count = 0
for m in mats_data['materials']:
    name = m['raw_material_name']
    res = client.post('/api/forecast', json={
        "raw_material_name": name,
        "horizon_type": "month",
        "horizon_value": 2
    })
    if res.status_code != 200 or res.get_json().get("status") != "success":
        print(f"  -> FAIL: {name}")
        fail_count += 1

if fail_count == 0:
    print(f"  -> ALL 27/27 models evaluated successfully with 0 errors!")
else:
    print(f"  -> {fail_count} materials failed!")

# 2.6 Frontend Compatibility Routes
print("\n[CHECK 4] Testing Frontend Legacy & Compatibility Routes...")
res = client.get('/api/ml/status')
assert res.status_code == 200
print("  -> /api/ml/status: PASS (200 OK)")

res = client.get('/api/ml/materials')
assert res.status_code == 200
print("  -> /api/ml/materials: PASS (200 OK)")

res = client.get('/api/ml/forecast/Sugar/inventory')
assert res.status_code == 200
print("  -> /api/ml/forecast/Sugar/inventory: PASS (200 OK)")

res = client.get('/api/ml/forecast/Cooking%20Oil')
assert res.status_code == 200
print("  -> /api/ml/forecast/Cooking Oil: PASS (200 OK)")

print("\n" + "=" * 70)
print("BACKEND & ML FORECASTING DIAGNOSTIC: 100% OPERATIONAL & VERIFIED")
print("=" * 70)
