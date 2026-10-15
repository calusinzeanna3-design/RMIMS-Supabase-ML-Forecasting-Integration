// Test RMIMS System Alerts Backend Rules
// Validates:
// 1. 1st incorrect password attempt is logged silently in security telemetry and does NOT alert system diagnostics.
// 2. Multiple failed password attempts (>= 3) alert the system diagnostics module.
// 3. Critical incidents (severity: 'critical') alert immediately on 1st occurrence ("once is enough to alert").
// 4. Non-critical incidents require repeated occurrences (>= 3).

const assert = require('assert');

// Mock browser localStorage and CustomEvent for Node.js
const mockStorage = {};
global.localStorage = {
  getItem: (key) => mockStorage[key] || null,
  setItem: (key, val) => { mockStorage[key] = String(val); },
  removeItem: (key) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
};
global.window = {
  dispatchEvent: () => {}
};

async function runTests() {
  console.log('Testing RMIMS Alert Backend Rules...');

  // Dynamically import ESM module in CommonJS
  const service = await import('../RMIMS/js/system-alerts-service.js');
  const {
    recordLoginFailure,
    clearLoginFailure,
    recordSystemIncident,
    getAlerts,
    resetAlertsToDefault,
    ALERT_THRESHOLDS
  } = service;

  // Initialize clean state
  resetAlertsToDefault();
  const initialAlerts = getAlerts();
  const initialCount = initialAlerts.length;

  console.log(`\n[STEP 1] Testing 1st Incorrect Password attempt...`);
  const testUser = 'operator_sarah@kxc.ph';
  const res1 = recordLoginFailure(testUser, 'KXC Enterprises (Tiaong)');
  
  assert.strictEqual(res1.alerted, false, '1st failed password attempt must NOT alert system diagnostics');
  assert.strictEqual(res1.attempts, 1, 'Attempt counter should be 1');
  
  const alertsAfter1 = getAlerts();
  const userAlerts1 = alertsAfter1.filter(a => a.details && a.details.includes(testUser));
  assert.strictEqual(userAlerts1.length, 0, 'No alert record should be created for 1st failed attempt in system diagnostics');
  console.log('PASS: 1st incorrect password was logged silently in telemetry without alerting diagnostics module.');

  console.log(`\n[STEP 2] Testing 2nd Incorrect Password attempt...`);
  const res2 = recordLoginFailure(testUser, 'KXC Enterprises (Tiaong)');
  assert.strictEqual(res2.alerted, false, '2nd failed password attempt must still NOT alert');
  const alertsAfter2 = getAlerts();
  const userAlerts2 = alertsAfter2.filter(a => a.details && a.details.includes(testUser));
  assert.strictEqual(userAlerts2.length, 0, 'No alert record should be created yet');
  console.log('PASS: 2nd attempt remained below threshold and silent.');

  console.log(`\n[STEP 3] Testing 3rd Incorrect Password attempt (Threshold reached)...`);
  const res3 = recordLoginFailure(testUser, 'KXC Enterprises (Tiaong)');
  assert.strictEqual(res3.alerted, true, '3rd failed password attempt MUST alert system diagnostics module');
  assert.strictEqual(res3.attempts, 3, 'Attempts counter should be 3');
  
  const alertsAfter3 = getAlerts();
  const userAlert3 = alertsAfter3.find(a => a.type === 'Incorrect Password' && a.details && a.details.includes(testUser));
  assert(userAlert3, 'System diagnostics must have an active "Incorrect Password" alert for user');
  assert.strictEqual(userAlert3.status, 'ongoing', 'Alert status must be "ongoing"');
  assert.strictEqual(userAlert3.occurrence, 3, 'Occurrence count must be 3');
  console.log('PASS: 3rd attempt escalated and published alert to system diagnostics module.');

  console.log(`\n[STEP 4] Testing Successful Login clears counter...`);
  clearLoginFailure(testUser);
  const resAfterClear = recordLoginFailure(testUser, 'KXC Enterprises (Tiaong)');
  assert.strictEqual(resAfterClear.attempts, 1, 'After clearance, new attempt count restarts at 1');
  assert.strictEqual(resAfterClear.alerted, false, 'Restarted 1st attempt is silent again');
  console.log('PASS: Successful login successfully cleared failure tracking.');

  console.log(`\n[STEP 5] Testing Critical Incident ("Once is enough to alert")...`);
  const critResult = recordSystemIncident({
    type: 'Database Cluster Disconnected',
    category: 'functional',
    branch: 'Scones & Muffins (Lucena)',
    details: 'Fatal connection failure to master PostgreSQL replica.',
    severity: 'critical',
    actionLabel: 'Reconnect'
  });
  
  assert.strictEqual(critResult.alerted, true, 'Critical incident MUST alert immediately');
  assert.strictEqual(critResult.occurrence, 1, 'Critical incident alerts on 1st occurrence ("once is enough")');
  
  const alertsAfterCrit = getAlerts();
  const critAlert = alertsAfterCrit.find(a => a.type === 'Database Cluster Disconnected');
  assert(critAlert, 'Critical alert must be present in system diagnostics');
  assert.strictEqual(critAlert.severity, 'critical');
  assert.strictEqual(critAlert.occurrence, 1);
  console.log('PASS: Critical incident triggered diagnostic alert on the very 1st occurrence ("once is enough to alert").');

  console.log(`\n[STEP 6] Testing Non-Critical / Minor Warning Incident (Threshold = 3)...`);
  const routine1 = recordSystemIncident({
    type: 'Minor Response Delay',
    category: 'performance',
    branch: 'KXC Enterprises (Tiaong)',
    details: 'Slight delay observed during sync',
    severity: 'warning'
  });
  assert.strictEqual(routine1.alerted, false, '1st non-critical incident must NOT alert');

  const routine2 = recordSystemIncident({
    type: 'Minor Response Delay',
    category: 'performance',
    branch: 'KXC Enterprises (Tiaong)',
    details: 'Slight delay observed during sync',
    severity: 'warning'
  });
  assert.strictEqual(routine2.alerted, false, '2nd non-critical incident must NOT alert');

  const routine3 = recordSystemIncident({
    type: 'Minor Response Delay',
    category: 'performance',
    branch: 'KXC Enterprises (Tiaong)',
    details: 'Slight delay observed during sync',
    severity: 'warning'
  });
  assert.strictEqual(routine3.alerted, true, '3rd non-critical incident reaches threshold and alerts');
  assert.strictEqual(routine3.occurrence, 3);
  console.log('PASS: Non-critical warnings require 3 occurrences before alerting diagnostics.');

  console.log('\n========================================');
  console.log('ALL ALERT BACKEND LOGIC TESTS PASSED!');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
