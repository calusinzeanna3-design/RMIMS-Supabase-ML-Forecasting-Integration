import os
from supabase import create_client

url = "https://hgandqozgcpytxebhvtn.supabase.co"
key = "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-"

sb = create_client(url, key)

# Let's check how many records exist
mats = sb.table("raw_materials").select("id, name, item_code", count="exact").execute()
recs = sb.table("stock_receipts").select("id", count="exact").execute()
disbs = sb.table("material_disbursements").select("id", count="exact").execute()

print(f"Current count: {len(mats.data)} materials, {len(recs.data)} receipts, {len(disbs.data)} disbursements")
