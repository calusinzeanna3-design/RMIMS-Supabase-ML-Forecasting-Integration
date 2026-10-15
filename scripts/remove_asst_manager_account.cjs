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

async function run() {
  console.log("Checking asst.manager account...");
  // Sign in as asst.manager to get token and set status to inactive or check user id
  const res = await request('/auth/v1/token?grant_type=password', {
    method: 'POST'
  }, {
    email: 'asst.manager@rmims.ph',
    password: 'AsstManager2026!'
  });

  if (res.status === 200 && res.data.access_token) {
    const token = res.data.access_token;
    console.log("Logged into asst.manager@rmims.ph. Marking status inactive & operational_role empty...");
    // Update user metadata to inactive
    const upRes = await request('/auth/v1/user', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }, {
      data: {
        status: 'inactive',
        operational_role: 'deprecated',
        role: 'user'
      }
    });
    console.log("Update result:", upRes.status, upRes.data ? "Success" : upRes.raw);
  } else {
    console.log("asst.manager@rmims.ph not active or already disabled:", res.status);
  }
}

run().catch(console.error);
