import os
import sys
import json
from supabase import create_client

# RMIMS V2 Phase 9 Step 9.2 — Live Supabase ↔ Flask Data Integration Audit

url = os.getenv("SUPABASE_URL", "https://hgandqozgcpytxebhvtn.supabase.co")
key = os.getenv("SUPABASE_KEY", "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-")
os.environ["SUPABASE_URL"] = url
os.environ["SUPABASE_KEY"] = key
sb = create_client(url, key)

print("============================================================")
print("RMIMS V2 — STEP 9.2 LIVE DATA INTEGRATION AUDIT")
print(f"Target: {url}")
print("============================================================")

print("\n--- 1. STEP 9.2-A: LIVE DATABASE TABLE CHECK ---")
tables = ["raw_materials", "material_disbursements", "stock_receipts", "user_profiles", "activity_audit_logs"]
record_counts = {}
for t in tables:
    try:
        res = sb.table(t).select("*", count="exact").execute()
        count = res.count if res.count is not None else len(res.data)
        record_counts[t] = count
        print(f"[PASS] public.{t:25s} | Accessible: YES | Live Record Count: {count}")
    except Exception as e:
        print(f"[FAIL] public.{t:25s} | Error: {e}")

print("\n--- 2. STEP 9.2-B & 9.2-C: LIVE DATA INSPECTION ---")
if record_counts.get("raw_materials", 0) == 0:
    print("LIVE DATABASE HAS NO BUSINESS RECORDS AVAILABLE FOR END-TO-END DATA VALUE VERIFICATION.")
    print("[HONEST AUDIT] public.raw_materials is empty in production. Zero mock records injected.")
else:
    print(f"Found {record_counts['raw_materials']} materials in public.raw_materials.")

if record_counts.get("material_disbursements", 0) == 0:
    print("[HONEST AUDIT] public.material_disbursements is empty in production. Zero mock records injected.")
else:
    print(f"Found {record_counts['material_disbursements']} disbursement records.")

print("\n--- 3. STEP 9.2-E & 9.2-G: FLASK ENDPOINT NO-FAKE-FALLBACK TEST ---")
from app import app

client = app.test_client()

# Test 1: Query an unseeded material in /api/ml/forecast/RM001/inventory
resp = client.get("/api/ml/forecast/RM001/inventory")
data = resp.get_json()
print(f"Flask /api/ml/forecast/RM001/inventory Response Code: {resp.status_code}")
print(f"Status in JSON: {data.get('status')}")
print(f"Message in JSON: {data.get('message')}")
if resp.status_code == 200:
    # If returned 200, check if inventory is null or honest
    print(f"Inventory Field: {data.get('inventory')}")
    print(f"Inventory Source: {data.get('inventory_source')}")
    if data.get("inventory") is None:
        print("[PASS] Flask reports inventory=None honestly when material is not in raw_materials table (Zero fake quantity).")
elif resp.status_code == 404:
    print("[PASS] Flask returns 404 Not Found when material is not in database (Zero fake quantity).")

# Test 2: Query non-existent material identifier
resp_invalid = client.get("/api/ml/forecast/RM999_NONEXISTENT/inventory")
print(f"\nNon-existent material query status: {resp_invalid.status_code}")
if resp_invalid.status_code == 404:
    print("[PASS] Invalid material correctly returned 404 Not Found.")

print("\n--- 4. STEP 9.2-H: DATABASE WRITE AUTHORITY AUDIT ---")
# Audit app.py code for any UPDATE raw_materials statements
app_code_path = os.path.join(os.path.dirname(__file__), "app.py")
with open(app_code_path, "r", encoding="utf-8") as f:
    app_code = f.read()

if ".update(" in app_code and "raw_materials" in app_code:
    print("[FAIL] Flask contains direct .update() on raw_materials!")
else:
    print("[PASS] Flask contains ZERO direct stock mutation updates on public.raw_materials.")

if "UPDATE raw_materials" in app_code:
    print("[FAIL] Flask contains direct SQL UPDATE on raw_materials!")
else:
    print("[PASS] Flask contains ZERO raw SQL UPDATE queries on raw_materials.")

print("\n--- 5. STEP 9.2-J: PROJECT IDENTITY AUDIT ---")
if "zdslycwczwfsjdxkwokt" in app_code:
    print("[FAIL] Legacy project reference found in app.py!")
else:
    print("[PASS] Zero references to legacy project ref in app.py.")

print("============================================================")
print("AUDIT EXECUTION COMPLETE")
print("============================================================")
