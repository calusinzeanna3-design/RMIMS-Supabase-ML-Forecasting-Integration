const fs = require('fs');
const path = require('path');
const https = require('https');

const p = process.env.USERPROFILE + '/.config/configstore/firebase-tools.json';
const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
const token = cfg.tokens.access_token;
const PROJECT_ID = 'rmims-ml-model';

function firestorePatch(docPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`);
    const req = https.request(url, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('=================================================================');
  console.log('   RMIMS: SEED FIRESTORE RBAC MULTI-TENANT ML DATASETS           ');
  console.log('   PRIMARY KXC DATASET: a72a7971-6ec7-4edc-ae72-89d702199ed9     ');
  console.log('   PRIMARY SCONES:      1872cf44-e821-4370-b227-d1b7e4fc6f56     ');
  console.log('=================================================================\n');

  const KXC_UUID = 'a72a7971-6ec7-4edc-ae72-89d702199ed9';
  const SCONES_UUID = '1872cf44-e821-4370-b227-d1b7e4fc6f56';

  // 1. Seed Super Admin User (Zeanna)
  console.log('1. Provisioning Super Admin in Firestore /users/...');
  const adminUid = '66041f5a-ce74-4866-bfcc-b0d05014f13b';
  const adminRes = await firestorePatch(`users/${adminUid}`, {
    fields: {
      email: { stringValue: 'calusinzeanna3@gmail.com' },
      full_name: { stringValue: 'Zeanna' },
      role: { stringValue: 'admin' },
      operational_role: { stringValue: 'SUPER_ADMIN' },
      status: { stringValue: 'active' },
      company_access: { arrayValue: { values: [
        { stringValue: KXC_UUID },
        { stringValue: 'KXC_COMPANY' },
        { stringValue: SCONES_UUID }
      ]}},
      created_at: { stringValue: new Date().toISOString() }
    }
  });
  console.log(`   Admin provision status: ${adminRes.status}`);

  // 2. Company 1: KXC 5-Year Enterprise (Both UUID and KXC_COMPANY alias)
  console.log(`\n2. Provisioning Tenant: KXC 5-Year Enterprise (${KXC_UUID})...`);
  const kxcCompanyFields = {
    fields: {
      company_id: { stringValue: KXC_UUID },
      alias_id: { stringValue: 'KXC_COMPANY' },
      company_name: { stringValue: 'KXC 5-Year Enterprise' },
      tenant_type: { stringValue: 'enterprise' },
      dataset_folder: { stringValue: 'a72a7971-6ec7-4edc-ae72-89d702199ed9' },
      dataset_name: { stringValue: 'RMIMS 5-Year Daily Dataset (2020-2025)' },
      dataset_file: { stringValue: 'RMIMS_5_YEAR_DAILY_DATASET_2020_2025.csv' },
      margin_schedule: { stringValue: 'kxc_strict_margin_boundaries_schedule.csv' },
      corridor: { stringValue: '±10.0% Strict Margin Boundaries' },
      margin_of_error_pct: { doubleValue: 7.51 },
      materials_count: { integerValue: '59' },
      status: { stringValue: 'active' },
      updated_at: { stringValue: new Date().toISOString() }
    }
  };

  await firestorePatch(`companies/${KXC_UUID}`, kxcCompanyFields);
  await firestorePatch('companies/KXC_COMPANY', kxcCompanyFields);

  // Model Metadata for KXC (both UUID and alias)
  const kxcModelFields = {
    fields: {
      model_id: { stringValue: 'holt_winters_5year' },
      model_file: { stringValue: 'rmims_time_series_model.pkl' },
      dataset_folder: { stringValue: 'a72a7971-6ec7-4edc-ae72-89d702199ed9' },
      model_type: { stringValue: 'Holt-Winters Exponential Smoothing' },
      algorithm: { stringValue: 'Additive Trend + Multiplicative Seasonality' },
      dataset_years: { integerValue: '5' },
      historical_span: { stringValue: '2020-2025' },
      corridor: { stringValue: '±10.0% Strict Margin Boundaries' },
      locked_mape: { doubleValue: 7.51 },
      materials_covered: { integerValue: '59' },
      primary_sku: { stringValue: 'RM-059 (Refined White Sugar)' },
      status: { stringValue: 'active' }
    }
  };
  await firestorePatch(`companies/${KXC_UUID}/models/holt_winters_5year`, kxcModelFields);
  await firestorePatch('companies/KXC_COMPANY/models/holt_winters_5year', kxcModelFields);
  console.log('   KXC Company & Model specs provisioned for both UUID and alias.');

  // 3. Company 2: Scones & Muffins Bakery
  console.log(`\n3. Provisioning Tenant: Scones & Muffins Bakery (${SCONES_UUID})...`);
  await firestorePatch(`companies/${SCONES_UUID}`, {
    fields: {
      company_id: { stringValue: SCONES_UUID },
      company_name: { stringValue: 'Scones & Muffins Bakery' },
      tenant_type: { stringValue: 'bakery' },
      dataset_folder: { stringValue: '1872cf44-e821-4370-b227-d1b7e4fc6f56' },
      dataset_name: { stringValue: '12-Year Nutribun Time Series Dataset (2014-2025)' },
      mean_weekly_mape_pct: { doubleValue: 2.70 },
      daily_mape_pct: { doubleValue: 7.95 },
      materials_count: { integerValue: '19' },
      status: { stringValue: 'active' },
      updated_at: { stringValue: new Date().toISOString() }
    }
  });

  // Model Metadata for Scones & Muffins
  await firestorePatch(`companies/${SCONES_UUID}/models/bakery_nutribun_12year`, {
    fields: {
      model_id: { stringValue: 'bakery_nutribun_12year' },
      model_type: { stringValue: 'Triple Exponential Smoothing (Holt-Winters)' },
      dataset_folder: { stringValue: '1872cf44-e821-4370-b227-d1b7e4fc6f56' },
      dataset_years: { integerValue: '12' },
      historical_span: { stringValue: '2014-2025' },
      company_mean_weekly_mape: { doubleValue: 2.70 },
      daily_mape: { doubleValue: 7.95 },
      materials_covered: { integerValue: '19' },
      primary_sku: { stringValue: 'NB-001 (Bread Flour) & NB-002 (Refined Sugar)' },
      status: { stringValue: 'active' }
    }
  });
  console.log('   Scones & Muffins Company & Model specs provisioned.');

  // 4. Seed KXC All 59 SKUs from kxc_strict_margin_boundaries_schedule.csv
  console.log('\n4. Seeding All 59 KXC Materials from kxc_strict_margin_boundaries_schedule.csv...');
  const kxcCsvPath = path.resolve(__dirname, `../ml_backend/${KXC_UUID}/kxc_strict_margin_boundaries_schedule.csv`);
  if (fs.existsSync(kxcCsvPath)) {
    const kxcCsv = fs.readFileSync(kxcCsvPath, 'utf8');
    const kxcLines = kxcCsv.trim().split('\n').slice(1); // skip header
    let kxcCount = 0;

    for (const line of kxcLines) {
      const parts = line.split(',');
      if (parts.length >= 10) {
        const sku = parts[0].trim();
        const name = parts[1].trim();
        const unit = parts[2].trim();
        const corridor = parts[3].trim();
        const strictMinFloor90d = parseFloat(parts[4]) || 0;
        const basePredictedNeed90d = parseFloat(parts[5]) || 0;
        const strictMaxCeiling90d = parseFloat(parts[6]) || 0;
        const dailyMin = parseFloat(parts[7]) || 0;
        const dailyBase = parseFloat(parts[8]) || 0;
        const dailyMax = parseFloat(parts[9]) || 0;
        const status = (parts[10] || 'LOCKED_INSIDE_BOUNDARIES').trim();

        const matPayload = {
          fields: {
            material_id: { stringValue: sku },
            sku: { stringValue: sku },
            name: { stringValue: name },
            unit: { stringValue: unit },
            corridor: { stringValue: corridor },
            strict_min_floor_90d: { doubleValue: strictMinFloor90d },
            base_predicted_need_90d: { doubleValue: basePredictedNeed90d },
            strict_max_ceiling_90d: { doubleValue: strictMaxCeiling90d },
            daily_min_allowed: { doubleValue: dailyMin },
            daily_base_forecast: { doubleValue: dailyBase },
            daily_max_allowed: { doubleValue: dailyMax },
            status: { stringValue: status },
            margin_of_error_pct: { doubleValue: 7.51 },
            company_id: { stringValue: KXC_UUID }
          }
        };

        // Seed under UUID
        await firestorePatch(`companies/${KXC_UUID}/materials/${sku}`, matPayload);
        // Seed under alias
        await firestorePatch(`companies/KXC_COMPANY/materials/${sku}`, matPayload);
        kxcCount++;
        if (kxcCount % 10 === 0 || kxcCount === 59) {
          console.log(`   [KXC Seeding] Seeded ${kxcCount}/59 SKUs (latest: ${sku} - ${name})`);
        }
      }
    }
    console.log(`   [KXC Complete] Successfully seeded all ${kxcCount} SKUs into Firestore.`);
  } else {
    console.warn(`   [Warning] File not found: ${kxcCsvPath}`);
  }

  // 5. Seed Scones & Muffins 19 SKUs from nutribun_12_year_exact_margins.csv
  console.log('\n5. Seeding Scones & Muffins 19 SKUs into Firestore...');
  const sconesCsvPath = path.resolve(__dirname, `../ml_backend/${SCONES_UUID}/nutribun_12_year_exact_margins.csv`);
  if (fs.existsSync(sconesCsvPath)) {
    const sconesCsv = fs.readFileSync(sconesCsvPath, 'utf8');
    const sconesLines = sconesCsv.trim().split('\n').slice(1); // skip header
    let sconesCount = 0;

    for (const line of sconesLines) {
      const parts = line.split(',');
      if (parts.length >= 7) {
        const sku = parts[0].trim();
        const name = parts[1].trim();
        const unit = parts[2].trim();
        const dailyMape = parseFloat(parts[3]) || 0;
        const weeklyMape = parseFloat(parts[5]) || 0;
        const p90Margin = (parts[8] || '').trim();
        const p95Margin = (parts[9] || '').trim();

        await firestorePatch(`companies/${SCONES_UUID}/materials/${sku}`, {
          fields: {
            material_id: { stringValue: sku },
            sku: { stringValue: sku },
            name: { stringValue: name },
            unit: { stringValue: unit },
            daily_mape: { doubleValue: dailyMape },
            weekly_mape: { doubleValue: weeklyMape },
            p90_margin: { stringValue: p90Margin },
            p95_margin: { stringValue: p95Margin },
            company_id: { stringValue: SCONES_UUID }
          }
        });
        sconesCount++;
      }
    }
    console.log(`   [Scones Complete] Successfully seeded all ${sconesCount} SKUs into Firestore.`);
  }

  console.log('\n=================================================================');
  console.log('   [SUCCESS] FIRESTORE MULTI-TENANT RBAC SEEDING COMPLETE!       ');
  console.log('=================================================================');
}

run().catch(console.error);
