"""
Supabase Multi-Tenant Seeder for Scones & Muffins (1872cf44-e821-4370-b227-d1b7e4fc6f56)
========================================================================================
Seeds the 19 Nutribun / Scones & Muffins raw materials into Supabase with:
- company_id: '1872cf44-e821-4370-b227-d1b7e4fc6f56'
- Air-gapped isolation from KXC 5-Year Enterprise dataset
- Verified threshold and reorder quantities from the 12-year procurement schedule
"""

import os
import sys
import json
import urllib.request
import urllib.error

# Resolve project paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(BASE_DIR, ".env")

def load_env():
    env_vars = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip()
    return env_vars

ENV = load_env()
SUPABASE_URL = ENV.get("SUPABASE_URL", "https://hgandqozgcpytxebhvtn.supabase.co")
SUPABASE_KEY = ENV.get("SUPABASE_KEY", "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-")

SCONES_MATERIALS = [
    {"item_code": "NB-001", "name": "All-Purpose / Bread Flour", "description": "Primary baking flour for scones, muffins, and nutribun", "unit_of_measure": "kg", "minimum_threshold": 717.65, "reorder_quantity": 1435.0, "current_stock": 2500.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-002", "name": "Refined White Sugar", "description": "Granulated white sweetener", "unit_of_measure": "kg", "minimum_threshold": 181.82, "reorder_quantity": 360.0, "current_stock": 850.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-003", "name": "Fresh Yellow Squash (Kalabasa)", "description": "Fresh organic squash puree base", "unit_of_measure": "kg", "minimum_threshold": 562.45, "reorder_quantity": 1120.0, "current_stock": 1200.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-004", "name": "Skimmed Milk Powder", "description": "Fortified dairy powder", "unit_of_measure": "kg", "minimum_threshold": 194.87, "reorder_quantity": 400.0, "current_stock": 600.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-005", "name": "Condensed Milk", "description": "Sweetened rich dairy binder", "unit_of_measure": "kg", "minimum_threshold": 88.02, "reorder_quantity": 180.0, "current_stock": 300.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-006", "name": "Fresh Whole Eggs", "description": "Grade-A fresh farm eggs", "unit_of_measure": "kg", "minimum_threshold": 67.37, "reorder_quantity": 140.0, "current_stock": 250.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-007", "name": "Baking Shortening", "description": "High-stability vegetable shortening", "unit_of_measure": "kg", "minimum_threshold": 54.33, "reorder_quantity": 110.0, "current_stock": 200.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-008", "name": "Margarine", "description": "Enriched table/baking margarine", "unit_of_measure": "kg", "minimum_threshold": 69.01, "reorder_quantity": 140.0, "current_stock": 250.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-009", "name": "Instant Dry Yeast", "description": "Fast-acting commercial baking yeast", "unit_of_measure": "kg", "minimum_threshold": 7.84, "reorder_quantity": 16.0, "current_stock": 45.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-010", "name": "Baking Soda", "description": "Pure sodium bicarbonate leavener", "unit_of_measure": "kg", "minimum_threshold": 2.51, "reorder_quantity": 6.0, "current_stock": 20.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-011", "name": "Iodized Salt", "description": "Fine culinary table salt", "unit_of_measure": "kg", "minimum_threshold": 9.02, "reorder_quantity": 20.0, "current_stock": 50.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-012", "name": "Calcium Propionate", "description": "Food-grade bread anti-mold preservative", "unit_of_measure": "kg", "minimum_threshold": 4.04, "reorder_quantity": 10.0, "current_stock": 25.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-013", "name": "Potassium Sorbate", "description": "Food-grade antimicrobial preservative", "unit_of_measure": "kg", "minimum_threshold": 0.51, "reorder_quantity": 2.0, "current_stock": 8.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-014", "name": "Crushed Peanuts / Nuts", "description": "Roasted peanut crumbles topping", "unit_of_measure": "kg", "minimum_threshold": 41.21, "reorder_quantity": 90.0, "current_stock": 150.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-015", "name": "Desiccated Coconut", "description": "Unsweetened fine grated coconut", "unit_of_measure": "kg", "minimum_threshold": 8.07, "reorder_quantity": 20.0, "current_stock": 60.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-016", "name": "Black Sesame Seeds", "description": "Toasted aromatic sesame seeds", "unit_of_measure": "kg", "minimum_threshold": 7.97, "reorder_quantity": 18.0, "current_stock": 55.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-017", "name": "Malunggay (Moringa) Flakes", "description": "Dehydrated nutritional moringa leaf flakes", "unit_of_measure": "kg", "minimum_threshold": 5.19, "reorder_quantity": 12.0, "current_stock": 40.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-018", "name": "Vanilla Extract", "description": "Pure concentrated vanilla essence", "unit_of_measure": "L", "minimum_threshold": 0.45, "reorder_quantity": 1.5, "current_stock": 5.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"},
    {"item_code": "NB-019", "name": "Plastic Pillow Packaging", "description": "Individual food-grade film pillow wraps", "unit_of_measure": "pcs", "minimum_threshold": 30520.2, "reorder_quantity": 60000.0, "current_stock": 85000.0, "company_id": "1872cf44-e821-4370-b227-d1b7e4fc6f56"}
]

def seed_scones_materials():
    print("=" * 75)
    print("   [SEEDER] SUPABASE SEEDING FOR SCONES & MUFFINS (1872cf44-e821-4370-b227-d1b7e4fc6f56)   ")
    print("=" * 75)
    print(f"Target Supabase URL: {SUPABASE_URL}")
    print(f"Tenant Partition:   '1872cf44-e821-4370-b227-d1b7e4fc6f56'")
    print(f"Catalog Size:       {len(SCONES_MATERIALS)} Master SKUs (NB-001 to NB-019)")
    print("-" * 75)

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }

    url = f"{SUPABASE_URL}/rest/v1/raw_materials"
    payload = json.dumps(SCONES_MATERIALS).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.getcode()
            print(f"[SUCCESS] Ingested {len(SCONES_MATERIALS)} raw materials to Supabase with status {status}.")
            print("All 19 Scones & Muffins materials are strictly tagged under company '1872cf44-e821-4370-b227-d1b7e4fc6f56'!")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        print(f"[NOTE] PostgREST response ({e.code}): {body}")
        if "column \"company_id\" of relation \"raw_materials\" does not exist" in body:
            print("\n[ACTION REQUIRED] The 'company_id' column has not been added to your Supabase tables yet.")
            print("Please run the SQL migration script in your Supabase SQL Editor:")
            print("  --> File: RMIMS/supabase/MULTI_COMPANY_RBAC_SCONES_MUFFINS_MIGRATION.sql")
            print("After running the migration, this seeder will insert all 19 materials instantly!\n")
    except Exception as e:
        print(f"[ERROR] Connection failed: {e}")

if __name__ == "__main__":
    seed_scones_materials()
