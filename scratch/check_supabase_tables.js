const SUPABASE_URL = "https://hgandqozgcpytxebhvtn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-";

async function checkTables() {
    console.log("Checking Supabase tables via REST API...");

    const tables = [
        "raw_materials",
        "stock_receipts",
        "material_disbursements",
        "finished_products",
        "product_material_requirements",
        "materials",
        "usage_records",
        "user_profiles",
        "activity_audit_logs"
    ];

    for (const table of tables) {
        try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=2`, {
                headers: {
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
                }
            });
            if (!res.ok) {
                const text = await res.text();
                console.log(`Table '${table}': HTTP ${res.status} -> ${text}`);
            } else {
                const data = await res.json();
                console.log(`Table '${table}': EXISTS (HTTP 200) -> sample count: ${data.length}`);
                if (data.length > 0) {
                    console.log(`  Columns:`, Object.keys(data[0]));
                }
            }
        } catch (e) {
            console.log(`Table '${table}': EXCEPTION ->`, e.message);
        }
    }
}

checkTables();
