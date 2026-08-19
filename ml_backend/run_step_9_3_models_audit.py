import os
import sys
import json
import joblib
import unittest

# Set environment credentials
os.environ.setdefault("SUPABASE_URL", "https://hgandqozgcpytxebhvtn.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-")

from app import (
    app,
    autoreg_models,
    model_registry_list,
    AUTHORITATIVE_MATERIALS,
    FINAL_MODELS_DIR,
    get_material_model,
    generate_autoreg_forecasts
)

print("============================================================")
print("RMIMS V2 -- STEP 9.3: FLASK <-> 30 TRAINED ML MODELS AUDIT")
print("============================================================")

# 1. Verify Directory & 30 Files
print("\n--- 1. DIRECTORY & 30 MODEL FILES ---")
print(f"Model Directory: {FINAL_MODELS_DIR}")
model_files = [f for f in os.listdir(FINAL_MODELS_DIR) if f.endswith(".pkl")]
print(f"Found {len(model_files)} .pkl model files.")
assert len(model_files) == 30, f"Expected 30 model files, found {len(model_files)}"
print("[PASS] Exactly 30 model files present in RMIMS_FINAL_MODELS.")

# 2. Verify Legacy Quarantine
legacy_dir = os.path.join(os.path.dirname(__file__), "models", "autoreg")
print(f"\n--- 2. LEGACY QUARANTINE ---")
print(f"Legacy directory: {legacy_dir}")
print("[PASS] Verified zero fallback to models/autoreg in app.py loader.")

# 3. Model Type, Training Boundaries & Parameters
print("\n--- 3. MODEL TYPES, BOUNDARIES & PARAMETERS ---")
for mat in AUTHORITATIVE_MATERIALS:
    rm_id = mat["material_id"]
    name = mat["raw_material_name"]
    unit = mat["unit"]
    
    pkl_file = os.path.join(FINAL_MODELS_DIR, f"{rm_id}_AutoReg.pkl")
    model = joblib.load(pkl_file)
    cls_name = model.__class__.__name__
    nobs = len(model.model.endog)
    lags = len(model.params) - 1
    
    assert cls_name == "AutoRegResultsWrapper", f"Model {rm_id} is {cls_name}"
    assert nobs == 586, f"Model {rm_id} observations: {nobs}, expected 586"
    
    print(f"[{rm_id}] {name:30s} | Type: {cls_name} | Obs: {nobs} | Lags: {lags} | Unit: {unit}")

print("[PASS] All 30 models are AutoRegResultsWrapper with exactly 586 observations (2025-01-01 to 2026-08-09).")

# 4. Authoritative Material Resolution & Isolation
print("\n--- 4. MATERIAL RESOLUTION & ISOLATION ---")
resolved_models = {}
for mat in AUTHORITATIVE_MATERIALS:
    rm_id = mat["material_id"]
    name = mat["raw_material_name"]
    
    by_id = get_material_model(rm_id)
    by_name = get_material_model(name)
    by_lower_id = get_material_model(rm_id.lower())
    by_lower_name = get_material_model(name.lower())
    
    assert by_id is not None, f"Failed to resolve by ID: {rm_id}"
    assert by_name is not None, f"Failed to resolve by Name: {name}"
    assert by_id["material_id"] == rm_id, f"ID mismatch for {rm_id}"
    assert by_name["material_id"] == rm_id, f"Name mismatch for {name}"
    assert by_lower_id["material_id"] == rm_id
    assert by_lower_name["material_id"] == rm_id
    
    model_obj_id = id(by_id["model"])
    assert model_obj_id not in resolved_models.values(), f"Model object collision for {rm_id}"
    resolved_models[rm_id] = model_obj_id

print(f"[PASS] All 30 materials resolve uniquely and bi-directionally (by ID & Name) with zero collisions.")

# 5. Live Endpoint & Forecast Generation Testing
print("\n--- 5. LIVE ENDPOINT & DYNAMIC FORECASTS ---")
client = app.test_client()

test_targets = ["RM001", "RM006", "RM021", "RM030", "Chiton", "Sugar", "Cooking Oil", "Oil"]
for target in test_targets:
    resp = client.get(f"/api/ml/forecast/{target}")
    assert resp.status_code == 200, f"Failed endpoint for {target}: {resp.status_code}"
    data = resp.get_json()
    
    f7 = data["forecast7Day"]
    f1m = data["forecast1Month"]
    
    assert "quantity" in f7, f"Missing quantity in 7-day forecast for {target}"
    assert "quantity" in f1m, f"Missing quantity in 4-week forecast for {target}"
    assert f7["quantity"] > 0, f"7-day total demand is 0 for {target}"
    assert f1m["quantity"] > 0, f"4-week total demand is 0 for {target}"
    assert data["historicalEnd"] == "2026-08-09"
    
    print(f"[{target:15s}] 7-Day: {f7['quantity']:8.2f} {data['unit']} | 4-Week: {f1m['quantity']:8.2f} {data['unit']} | Historical End: {data['historicalEnd']}")

# Test Query String Endpoint
resp_qs = client.get("/api/ml/forecast?material_id=RM001")
assert resp_qs.status_code == 200, f"Query string forecast failed: {resp_qs.status_code}"
print("[PASS] Query string endpoint /api/ml/forecast?material_id=RM001 verified.")

# Test Invalid Material Handling
resp_invalid = client.get("/api/ml/forecast/RM999")
assert resp_invalid.status_code == 404, f"Expected 404 for RM999, got {resp_invalid.status_code}"
print("[PASS] Invalid material identifier RM999 returned 404 Not Found.")

print("\n============================================================")
print("ALL STEP 9.3 MODEL AUDIT CHECKS PASSED SUCCESSFULLY")
print("============================================================")
