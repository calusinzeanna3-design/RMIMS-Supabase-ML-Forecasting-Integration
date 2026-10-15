const https = require('https');

const SUPABASE_URL = "https://hgandqozgcpytxebhvtn.supabase.co";
const ANON_KEY = "sb_publishable_cJn9GulDOqIYoNTbdDCkOw_2PNzlr5-";

const accounts = [
  { label: "Main Administrator", email: "admin@rmims.ph", pass: "AdminPassword2026!", expectedRole: "admin", expectedDest: "admin/overview.html" },
  { label: "Store Manager", email: "manager@rmims.ph", pass: "ManagerPassword2026!", expectedRole: "manager", expectedDest: "manager/dashboard.html" },
  { label: "Floor Inventory Staff (User / Staff)", email: "staff@rmims.ph", pass: "StaffPassword2026!", expectedRole: "user", expectedDest: "user/dashboard.html" }
];

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

async function verifyAll() {
  console.log("=== Verifying Supabase Credentials for RMIMS (Admin, Manager, User/Staff) ===");
  for (const acc of accounts) {
    const res = await request('/auth/v1/token?grant_type=password', {
      method: 'POST'
    }, {
      email: acc.email,
      password: acc.pass
    });

    if (res.status === 200 && res.data.access_token) {
      const u = res.data.user;
      const meta = u.user_metadata || {};
      console.log(`[PASS] ${acc.label}`);
      console.log(`       Email: ${acc.email} | Pass: ${acc.pass}`);
      console.log(`       Role: ${meta.role || u.role} | OpRole: ${meta.operational_role || 'none'} | Status: ${meta.status || 'unknown'}`);
      console.log(`       Routes to: ${acc.expectedDest}\n`);
    } else {
      console.log(`[FAIL] ${acc.label} (${acc.email}): status ${res.status}`, res.data || res.raw);
    }
  }
}

verifyAll().catch(console.error);
