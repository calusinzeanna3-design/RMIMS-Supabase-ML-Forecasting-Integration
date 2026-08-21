// scratch/test_supabase_queries.js
import { supabase } from '../RMIMS/supabase/supabase-config.js';

async function testQueries() {
  console.log("Testing Supabase queries as used in syncAuthoritativeNotifications...");
  try {
    const [matRes, rcvRes, disbRes, userRes] = await Promise.all([
      supabase.from('raw_materials').select('id, name, item_code, current_stock, minimum_threshold, unit_of_measure, updated_at'),
      supabase.from('stock_receipts').select('id, receipt_date, material_id, received_quantity, unit, supplier_name, received_by, created_at').order('created_at', { ascending: false }).limit(20),
      supabase.from('material_disbursements').select('id, usage_date, material_id, consumed_quantity, unit, finished_product_name, recorded_by, created_at').order('created_at', { ascending: false }).limit(20),
      supabase.from('user_profiles').select('id, full_name, email, role')
    ]);

    console.log("matRes error:", matRes.error, "count:", matRes.data?.length);
    console.log("rcvRes error:", rcvRes.error, "count:", rcvRes.data?.length);
    console.log("disbRes error:", disbRes.error, "count:", disbRes.data?.length);
    console.log("userRes error:", userRes.error, "count:", userRes.data?.length);
    
    if (rcvRes.data?.length > 0) {
      console.log("Sample receipt:", rcvRes.data[0]);
    }
    if (disbRes.data?.length > 0) {
      console.log("Sample disb:", disbRes.data[0]);
    }
  } catch (err) {
    console.error("Query test failed:", err);
  }
}

testQueries();
