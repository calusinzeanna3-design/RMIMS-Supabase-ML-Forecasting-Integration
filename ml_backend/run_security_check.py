import os
from supabase import create_client

url = os.getenv("SUPABASE_URL", "https://hgandqozgcpytxebhvtn.supabase.co")
key = os.getenv("SUPABASE_KEY", "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-")
sb = create_client(url, key)

print("--- 1. TABLE & COLUMN INTROSPECTION ---")
for t in ["raw_materials", "material_disbursements", "stock_receipts", "user_profiles", "activity_audit_logs"]:
    try:
        res = sb.table(t).select("*").limit(1).execute()
        print(f"[PASS] {t}: ACCESSIBLE")
    except Exception as e:
        print(f"[FAIL] {t}: {e}")

print("\n--- 2. TEST 1: PRIVILEGE ESCALATION ---")
try:
    res = sb.table("user_profiles").insert({"id": "00000000-0000-0000-0000-000000000001", "email": "attacker@test.com", "role": "admin", "status": "active"}).execute()
    print("[FAIL] Unauthorized insert succeeded:", res.data)
except Exception:
    print("[PASS] Unauthorized insert BLOCKED by RLS.")

try:
    res = sb.table("user_profiles").update({"role": "admin"}).eq("id", "00000000-0000-0000-0000-000000000001").execute()
    if not res.data:
        print("[PASS] Unauthorized role elevation BLOCKED by RLS.")
    else:
        print("[FAIL] Role elevation succeeded:", res.data)
except Exception:
    print("[PASS] Unauthorized role elevation BLOCKED.")

print("\n--- 3. TEST 2: INVENTORY TAMPERING ---")
try:
    res = sb.table("raw_materials").insert({"name": "Tampered", "unit_of_measure": "kg", "current_stock": 9999}).execute()
    print("[FAIL] Unauthorized insert on raw_materials succeeded:", res.data)
except Exception:
    print("[PASS] Unauthorized raw_materials insert BLOCKED.")

try:
    res = sb.table("raw_materials").update({"current_stock": 99999}).neq("id", "00000000-0000-0000-0000-000000000000").execute()
    if not res.data:
        print("[PASS] Direct stock modification BLOCKED by RLS.")
    else:
        print("[FAIL] Direct stock update succeeded:", res.data)
except Exception:
    print("[PASS] Direct stock update BLOCKED.")

try:
    res = sb.table("activity_audit_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    if not res.data:
        print("[PASS] Unauthorized audit log deletion BLOCKED.")
    else:
        print("[FAIL] Audit log deletion succeeded:", res.data)
except Exception:
    print("[PASS] Unauthorized audit log deletion BLOCKED.")
