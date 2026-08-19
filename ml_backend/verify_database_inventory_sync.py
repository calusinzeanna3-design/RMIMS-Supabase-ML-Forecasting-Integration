import os
import json
import urllib.request

SUPABASE_URL = "https://hgandqozgcpytxebhvtn.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-"

def query_table(table_name):
    url = f"{SUPABASE_URL}/rest/v1/{table_name}?select=*&limit=5"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            print(f"[PASS] {table_name}: accessible, {len(data)} sample rows returned.")
            return True, data
    except Exception as e:
        print(f"[FAIL] {table_name}: {e}")
        return False, None

def verify_all():
    print("=== RMIMS V2 DATABASE INVENTORY SCHEMA VERIFICATION ===")
    ok1, mats = query_table("raw_materials")
    ok2, recs = query_table("stock_receipts")
    ok3, disbs = query_table("material_disbursements")
    ok4, profs = query_table("user_profiles")
    
    if ok1 and ok2 and ok3 and ok4:
        print("\nAll authoritative V2 tables verified accessible via Supabase REST API.")
        return True
    return False

if __name__ == "__main__":
    verify_all()
