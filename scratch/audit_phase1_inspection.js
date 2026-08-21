import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

console.log('====================================================');
console.log('PHASE 1: RMIMS COMPLETE SYSTEM & ARCHITECTURE INSPECTION');
console.log('====================================================');

// 1. Check .env
const envPath = path.join(root, '.env');
let supabaseUrl = '';
let supabaseKey = '';
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, 'utf8');
  envText.split('\n').forEach(line => {
    if (line.startsWith('SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_KEY=') || line.startsWith('SUPABASE_ANON_KEY=')) supabaseKey = line.split('=')[1].trim();
  });
}

console.log('SUPABASE URL:', supabaseUrl ? supabaseUrl : 'MISSING');
console.log('SUPABASE KEY:', supabaseKey ? 'PRESENT (' + supabaseKey.substring(0, 15) + '...)' : 'MISSING');

// 2. Check 30 AutoReg Models
const modelsDir = path.join(root, 'ml_backend', 'models', 'RMIMS_FINAL_MODELS');
let modelFiles = [];
if (fs.existsSync(modelsDir)) {
  modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.pkl'));
}
console.log(`TRAINED AUTOREG MODELS IN STORE: ${modelFiles.length} / 30`);

// 3. Inspect HTML pages
const adminPages = ['dashboard.html', 'inventory.html', 'material-activity.html', 'analytics.html', 'forecasting.html', 'reports.html', 'settings.html', 'user-management.html'];
const userPages = ['dashboard.html', 'inventory.html', 'material-activity.html', 'analytics.html', 'reports.html', 'settings.html'];
const rootPages = ['index.html', 'login.html', 'portal.html', 'kiosk-checkin.html', 'user-signin.html'];

console.log('\n--- ADMIN PAGES ---');
adminPages.forEach(p => {
  const fp = path.join(root, 'RMIMS', 'admin', p);
  console.log(`- admin/${p}: ${fs.existsSync(fp) ? 'EXISTS (' + fs.statSync(fp).size + ' bytes)' : 'MISSING'}`);
});

console.log('\n--- USER PAGES ---');
userPages.forEach(p => {
  const fp = path.join(root, 'RMIMS', 'user', p);
  console.log(`- user/${p}: ${fs.existsSync(fp) ? 'EXISTS (' + fs.statSync(fp).size + ' bytes)' : 'MISSING'}`);
});

console.log('\n--- ROOT ENTRY PAGES ---');
rootPages.forEach(p => {
  const fp = path.join(root, 'RMIMS', p);
  console.log(`- ${p}: ${fs.existsSync(fp) ? 'EXISTS (' + fs.statSync(fp).size + ' bytes)' : 'MISSING'}`);
});

// 4. Test Supabase Database REST Connection
async function testSupabase() {
  console.log('\n--- TESTING SUPABASE DATABASE CONNECTIVITY ---');
  if (!supabaseUrl || !supabaseKey) {
    console.error('FAIL: Missing Supabase credentials');
    return;
  }

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`
  };

  try {
    const resMat = await fetch(`${supabaseUrl}/rest/v1/raw_materials?select=id,item_code,name,current_stock&limit=5`, { headers });
    if (resMat.ok) {
      const dataMat = await resMat.json();
      console.log(`[PASS] Supabase public.raw_materials query returned ${dataMat.length} rows.`);
      if (dataMat.length > 0) {
        console.log('       Sample item:', dataMat[0].item_code, '-', dataMat[0].name, '| Stock:', dataMat[0].current_stock);
      }
    } else {
      console.error(`[FAIL] Supabase query status: ${resMat.status} ${resMat.statusText}`);
    }

    const resDisb = await fetch(`${supabaseUrl}/rest/v1/material_disbursements?select=id,usage_date,consumed_quantity&limit=5`, { headers });
    if (resDisb.ok) {
      const dataDisb = await resDisb.json();
      console.log(`[PASS] Supabase public.material_disbursements query returned ${dataDisb.length} rows.`);
    }

    const resRec = await fetch(`${supabaseUrl}/rest/v1/material_receipts?select=id,receipt_date,received_quantity&limit=5`, { headers });
    if (resRec.ok) {
      const dataRec = await resRec.json();
      console.log(`[PASS] Supabase public.material_receipts query returned ${dataRec.length} rows.`);
    }

  } catch (err) {
    console.error('[FAIL] Supabase fetch error:', err.message);
  }
}

// 5. Test Flask ML Service Health
async function testFlaskService() {
  console.log('\n--- TESTING FLASK ML SERVICE HEALTH (http://127.0.0.1:5000) ---');
  try {
    const res = await fetch('http://127.0.0.1:5000/api/ml/status');
    if (res.ok) {
      const data = await res.json();
      console.log('[PASS] ML Service Status:', JSON.stringify(data, null, 2));
    } else {
      console.log(`[NOTICE] ML Service returned status ${res.status}. (Service may need to be started).`);
    }
  } catch (err) {
    console.log('[NOTICE] ML Service on port 5000 not currently running:', err.message);
  }
}

async function runAll() {
  await testSupabase();
  await testFlaskService();
}

runAll();
