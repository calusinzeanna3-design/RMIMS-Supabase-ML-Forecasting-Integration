const SUPABASE_URL = "https://hgandqozgcpytxebhvtn.supabase.co";
const SUPABASE_KEY = "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-";

console.log('====================================================');
console.log('TESTING SUPABASE CLOUD REST & AUTH HTTP ENDPOINTS');
console.log('====================================================\n');

async function testSupabaseHttp() {
  // 1. Test REST endpoint for raw_materials
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/raw_materials?select=*&limit=1`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    console.log(`[REST raw_materials]: HTTP ${resp.status} ${resp.statusText}`);
    const body = await resp.text();
    console.log('Response:', body.substring(0, 300));
  } catch (err) {
    console.error('[REST ERROR]:', err.message);
  }

  // 2. Test Auth endpoint for health/settings
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: {
        'apikey': SUPABASE_KEY
      }
    });
    console.log(`\n[AUTH health]: HTTP ${resp.status} ${resp.statusText}`);
    const body = await resp.text();
    console.log('Response:', body);
  } catch (err) {
    console.error('[AUTH ERROR]:', err.message);
  }
}

testSupabaseHttp();
