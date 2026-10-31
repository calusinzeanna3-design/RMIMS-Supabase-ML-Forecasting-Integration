const https = require('https');

const SUPABASE_URL = "https://hgandqozgcpytxebhvtn.supabase.co";
const ANON_KEY = "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-";

function request(path, options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const req = https.request(url, {
      ...options,
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function verifyAccountStatus(email, pass) {
  const res = await request('/auth/v1/token?grant_type=password', {
    method: 'POST'
  }, { email, password: pass });
  return res.status === 200 ? { exists: true, user: res.data?.user } : { exists: false, status: res.status };
}

async function main() {
  console.log("=================================================================");
  console.log("   RMIMS: PERMANENT ACCOUNT PURGE & STATUS INSPECTOR            ");
  console.log("=================================================================\n");

  const testAccounts = [
    { email: "admin@rmims.ph", pass: "AdminPassword2026!" },
    { email: "manager@rmims.ph", pass: "ManagerPassword2026!" },
    { email: "staff@rmims.ph", pass: "StaffPassword2026!" }
  ];

  console.log("1. Checking Supabase Auth User Credentials:");
  for (const acc of testAccounts) {
    const result = await verifyAccountStatus(acc.email, acc.pass);
    if (result.exists) {
      console.log(`   [FOUND] ${acc.email} (ID: ${result.user?.id})`);
    } else {
      console.log(`   [PURGED/INACTIVE] ${acc.email} (status: ${result.status})`);
    }
  }

  console.log("\n2. Checking public.user_profiles Table:");
  const profilesRes = await request('/rest/v1/user_profiles?select=*', { method: 'GET' });
  console.log(`   Records in user_profiles: ${Array.isArray(profilesRes.data) ? profilesRes.data.length : 'N/A'}`);

  console.log("\n=================================================================");
  console.log("   ACTION REQUIRED IN SUPABASE DASHBOARD SQL EDITOR             ");
  console.log("=================================================================");
  console.log(`
To permanently and completely delete all accounts in Supabase Auth (auth.users),
open the Supabase Dashboard:
  https://supabase.com/dashboard/project/hgandqozgcpytxebhvtn/sql

Paste and run the following SQL command:

  TRUNCATE TABLE auth.users CASCADE;
  TRUNCATE TABLE public.user_profiles CASCADE;

(File: RMIMS/supabase/PERMANENT_PURGE_ALL_ACCOUNTS.sql)
=================================================================
`);
}

main().catch(console.error);
