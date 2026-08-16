"""
RMIMS batch data seeder.

Run from the RMIMS project root:
    python seed_rmims_data.py

The script reads the Supabase URL/key from ml-api/.env.
It does NOT print the secret key.

It creates thesis-aligned demo/test data:
- 28 raw materials
- 7 finished products
- 45 product/material requirements
- 8,415 deterministic historical usage records

The historical records are synthetic test data, not claims about actual
business records.
"""

from __future__ import annotations

import math
import random
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
import os
from supabase import create_client


ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / "ml-api" / ".env"

load_dotenv(ENV_PATH)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

if not SUPABASE_URL:
    raise RuntimeError(f"SUPABASE_URL was not found in {ENV_PATH}")
if not SUPABASE_KEY:
    raise RuntimeError(
        f"SUPABASE_SERVICE_ROLE_KEY was not found in {ENV_PATH}"
    )

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

BATCH_SIZE = 200

MATERIALS = [
    ("MAT-001","Chiton","Seafood","kg",45,50,"Freezer A","Quezon Seafood Supplier"),
    ("MAT-002","Small Shrimp","Seafood","kg",60,20,"Freezer A","Lucena Seafood Supplier"),
    ("MAT-003","Pork Skin","Meat","kg",40,50,"Freezer B","Local Meat Supplier"),
    ("MAT-004","Chicken","Meat","kg",12,8,"Freezer B","Local Meat Supplier"),
    ("MAT-005","Pork","Meat","kg",10,8,"Freezer B","Local Meat Supplier"),
    ("MAT-006","Loaf Bread","Bakery","loaf",280,180,"Dry Storage A","Local Bakery Supplier"),
    ("MAT-007","Raw Bananas","Fruit","kg",130,100,"Produce Rack A","Tiaong Produce Supplier"),
    ("MAT-008","Peanuts","Nuts","kg",180,120,"Dry Storage B","Quezon Nut Supplier"),
    ("MAT-009","Garlic","Seasoning","kg",10,12,"Dry Storage A","Local Market Supplier"),
    ("MAT-010","Onion","Vegetable","kg",8,6,"Produce Rack B","Local Market Supplier"),
    ("MAT-011","Spring Onion","Vegetable","kg",4,3,"Produce Rack B","Local Market Supplier"),
    ("MAT-012","Cabbage","Vegetable","kg",10,8,"Produce Rack B","Local Market Supplier"),
    ("MAT-013","Carrots","Vegetable","kg",7,5,"Produce Rack B","Local Market Supplier"),
    ("MAT-014","Bell Pepper","Vegetable","kg",4,4,"Produce Rack B","Local Market Supplier"),
    ("MAT-015","Salt","Seasoning","kg",14,8,"Dry Storage A","Grocery Supplier"),
    ("MAT-016","Sea Salt","Seasoning","kg",5,3,"Dry Storage A","Grocery Supplier"),
    ("MAT-017","Ground Pepper","Seasoning","kg",3,2,"Dry Storage A","Grocery Supplier"),
    ("MAT-018","Cooking Oil","Liquid Ingredient","L",180,200,"Oil Storage","Grocery Supplier"),
    ("MAT-019","Butter/Margarine","Dairy/Fat","kg",25,20,"Chiller A","Dairy Supplier"),
    ("MAT-020","Sugar","Sweetener","kg",20,15,"Dry Storage B","Grocery Supplier"),
    ("MAT-021","White Sugar","Sweetener","kg",8,5,"Dry Storage B","Grocery Supplier"),
    ("MAT-022","Turmeric Powder","Seasoning","kg",2,2,"Dry Storage A","Grocery Supplier"),
    ("MAT-023","Water","Liquid Ingredient","L",60,50,"Utility Storage","Water Supplier"),
    ("MAT-024","Honey","Sweetener","kg",18,12,"Dry Storage B","Local Honey Supplier"),
    ("MAT-025","Soy Sauce","Sauce","L",4,4,"Sauce Storage","Grocery Supplier"),
    ("MAT-026","Sesame Oil","Liquid Ingredient","L",2.5,2,"Oil Storage","Grocery Supplier"),
    ("MAT-027","Oyster Sauce","Sauce","L",3,3,"Sauce Storage","Grocery Supplier"),
    ("MAT-028","Optional Spices/Flavorings","Seasoning","kg",2,2,"Dry Storage A","Spice Supplier"),
]

PRODUCTS = [
    ("PROD-001","Kibets","Seafood Snack"),
    ("PROD-002","Binayong Hipon","Seafood Snack"),
    ("PROD-003","Biscocho Chips","Snack"),
    ("PROD-004","Crispy Bucheron","Meat Snack"),
    ("PROD-005","Salted Banana Chips","Fruit Snack"),
    ("PROD-006","Creamy Peanut Butter","Spread"),
    ("PROD-007","Crunchy Peanut Butter","Spread"),
]

REQS = {
    "Kibets":{"Chiton":5,"Salt":0.15,"Ground Pepper":0.05,"Garlic":0.10,"Optional Spices/Flavorings":0.10,"Cooking Oil":2.0},
    "Binayong Hipon":{"Small Shrimp":4,"Cooking Oil":1.5,"Garlic":0.15,"Onion":0.30,"Spring Onion":0.15,"Cabbage":0.50,"Carrots":0.30,"Ground Pepper":0.04,"Bell Pepper":0.20,"Soy Sauce":0.20,"Sesame Oil":0.08,"Oyster Sauce":0.15,"Salt":0.08,"Chicken":0.50,"Pork":0.50},
    "Biscocho Chips":{"Loaf Bread":10,"Butter/Margarine":0.80,"Sugar":0.50,"Garlic":0.10,"Cooking Oil":1.0},
    "Crispy Bucheron":{"Pork Skin":5,"Salt":0.15,"Ground Pepper":0.05,"Garlic":0.10,"Cooking Oil":2.0},
    "Salted Banana Chips":{"Raw Bananas":6,"Cooking Oil":2.0,"Turmeric Powder":0.05,"Water":1.0,"Salt":0.10,"White Sugar":0.20},
    "Creamy Peanut Butter":{"Peanuts":5,"Sea Salt":0.08,"Honey":0.50,"Cooking Oil":0.30},
    "Crunchy Peanut Butter":{"Peanuts":5,"Sea Salt":0.08,"Honey":0.40,"Cooking Oil":0.30},
}

UNITS = {m[1]: m[3] for m in MATERIALS}
MATERIAL_IDS = {m[1]: m[0] for m in MATERIALS}

BATCHES = {
    "Kibets": 12,
    "Binayong Hipon": 10,
    "Biscocho Chips": 18,
    "Crispy Bucheron": 10,
    "Salted Banana Chips": 15,
    "Creamy Peanut Butter": 12,
    "Crunchy Peanut Butter": 10,
}


def chunks(items, size=BATCH_SIZE):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def insert_batches(table, rows, label):
    total = 0
    for batch in chunks(rows):
        response = sb.table(table).insert(batch).execute()
        if getattr(response, "data", None) is None:
            raise RuntimeError(f"{label} insert returned no data.")
        total += len(response.data)
        print(f"{label}: {total}/{len(rows)}")
    return total


def upsert_batches(table, rows, label):
    total = 0
    for batch in chunks(rows):
        response = sb.table(table).upsert(batch).execute()
        if getattr(response, "data", None) is None:
            raise RuntimeError(f"{label} upsert returned no data.")
        total += len(response.data)
        print(f"{label}: {total}/{len(rows)}")
    return total


def build_usage_rows():
    rng = random.Random(20260813)
    rows = []
    current = date(2023, 1, 1)
    end = date(2026, 7, 26)
    week = 0
    uid = 1

    while current <= end:
        for pid, pname, _category in PRODUCTS:
            season = (
                1
                + 0.12 * math.sin(2 * math.pi * (week % 52) / 52)
                + 0.05 * math.sin(2 * math.pi * (week % 13) / 13)
            )
            if current.month in (11, 12):
                season += 0.10
            if current.month in (6, 7):
                season += 0.04

            batches_for_week = max(
                1,
                round(
                    BATCHES[pname]
                    * season
                    * (1 + rng.uniform(-0.12, 0.12))
                ),
            )

            for material_name, per_batch in REQS[pname].items():
                qty = max(
                    0.001,
                    round(
                        per_batch
                        * batches_for_week
                        * (1 + rng.uniform(-0.06, 0.06)),
                        3,
                    ),
                )

                rows.append({
                    "id": f"DEMO-USE-{uid:05d}",
                    "material_id": MATERIAL_IDS[material_name],
                    "material_name": material_name,
                    "used_quantity": qty,
                    "unit": UNITS[material_name],
                    "usage_date": current.isoformat(),
                    "remarks": "RMIMS DEMO HISTORICAL CONSUMPTION",
                    "product_id": pid,
                    "product_name": pname,
                })
                uid += 1

        current += timedelta(days=7)
        week += 1

    return rows


def main():
    print("=" * 65)
    print("RMIMS BATCH DATA SEEDER")
    print("=" * 65)
    print(f"Supabase URL: {SUPABASE_URL}")
    print("Supabase key: loaded (not displayed)")
    print()

    # 1) Materials
    material_rows = []
    for mid, name, category, unit, quantity, minimum, location, supplier in MATERIALS:
        status = (
            "Critical"
            if quantity <= minimum / 2
            else ("Low" if quantity <= minimum else "Available")
        )
        material_rows.append({
            "id": mid,
            "material_name": name,
            "category": category,
            "unit": unit,
            "quantity": quantity,
            "minimum_threshold": minimum,
            "supplier": supplier,
            "storage_location": location,
            "notes": "Demo dataset for RMIMS testing",
            "status": status,
        })

    print("1/4 Materials")
    upsert_batches("materials", material_rows, "Materials")

    # 2) Finished products
    product_rows = [
        {
            "id": pid,
            "product_name": name,
            "category": category,
            "status": "Active",
        }
        for pid, name, category in PRODUCTS
    ]

    print("\n2/4 Finished products")
    upsert_batches("finished_products", product_rows, "Finished products")

    # 3) Product/material requirements
    requirement_rows = []
    rid = 1

    for pid, pname, _category in PRODUCTS:
        for material_name, required_quantity in REQS[pname].items():
            requirement_rows.append({
                "id": f"PMR-{rid:03d}",
                "product_id": pid,
                "material_id": MATERIAL_IDS[material_name],
                "required_quantity": required_quantity,
                "unit": UNITS[material_name],
            })
            rid += 1

    print("\n3/4 Product/material requirements")
    upsert_batches(
        "product_material_requirements",
        requirement_rows,
        "Requirements",
    )

    # 4) Historical consumption
    usage_rows = build_usage_rows()

    print(f"\n4/4 Historical usage: {len(usage_rows)} rows")

    # Delete only records generated by this script, so rerunning is safe.
    print("Removing previous demo historical rows...")
    (
        sb.table("usage_records")
        .delete()
        .eq("remarks", "RMIMS DEMO HISTORICAL CONSUMPTION")
        .execute()
    )

    insert_batches("usage_records", usage_rows, "Usage records")

    # Verification
    print("\nVerifying...")
    usage_check = (
        sb.table("usage_records")
        .select("id", count="exact")
        .eq("remarks", "RMIMS DEMO HISTORICAL CONSUMPTION")
        .execute()
    )

    material_check = (
        sb.table("materials")
        .select("id", count="exact")
        .execute()
    )

    product_check = (
        sb.table("finished_products")
        .select("id", count="exact")
        .execute()
    )

    print()
    print("=" * 65)
    print("SEED COMPLETE")
    print("=" * 65)
    print(f"Materials: {material_check.count}")
    print(f"Finished products: {product_check.count}")
    print(f"Demo usage records: {usage_check.count}")
    print("=" * 65)


if __name__ == "__main__":
    main()
