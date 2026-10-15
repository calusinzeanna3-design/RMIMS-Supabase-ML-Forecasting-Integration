# scripts/update_all_real_data.py
import re
import os

# ============================================================================
# 1. UPDATE manager-receive.js
# ============================================================================
receive_js_path = 'RMIMS/js/manager-receive.js'
with open(receive_js_path, 'r', encoding='utf-8') as f:
    rec_code = f.read()

# Replace INITIAL_MGR_RECEIPTS with empty array and cleanse logic
rec_code = re.sub(
    r'const INITIAL_MGR_RECEIPTS = \[[\s\S]*?\];',
    'const INITIAL_MGR_RECEIPTS = [];',
    rec_code
)

# Update generateNextReference
old_gen_ref = '''function generateNextReference() {
  const allRefs = managerReceipts.map(r => r.ref).concat(
    getSystemCustomReceipts().map(r => r.id || '')
  );

  let maxNum = 125;
  allRefs.forEach(ref => {
    const match = String(ref).match(/REC-2026-(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  const nextNum = maxNum + 1;
  return `REC-2026-${String(nextNum).padStart(5, '0')}`;
}'''

new_gen_ref = '''function generateNextReference() {
  const allRefs = managerReceipts.map(r => r.ref).concat(
    getSystemCustomReceipts().map(r => r.id || '')
  );

  let maxNum = 0;
  allRefs.forEach(ref => {
    const match = String(ref).match(/REC-2026-(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  const nextNum = maxNum + 1;
  return `REC-2026-${String(nextNum).padStart(5, '0')}`;
}'''
rec_code = rec_code.replace(old_gen_ref, new_gen_ref)

# Update loadReceipts to cleanse mock items
old_load_rec = '''function loadReceipts() {
  try {
    const raw = localStorage.getItem(MGR_RECEIPTS_KEY);
    if (raw) {
      managerReceipts = JSON.parse(raw);
    } else {
      managerReceipts = [...INITIAL_MGR_RECEIPTS];
      localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(managerReceipts));
    }
  } catch (e) {
    managerReceipts = [...INITIAL_MGR_RECEIPTS];
  }
}'''

new_load_rec = '''function loadReceipts() {
  try {
    const raw = localStorage.getItem(MGR_RECEIPTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Cleanse legacy mock IDs
        managerReceipts = parsed.filter(r => !['REC-2026-00125', 'REC-2026-00124', 'REC-2026-00120', 'REC-2026-00118'].includes(r.ref));
        if (managerReceipts.length !== parsed.length) {
          localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify(managerReceipts));
        }
      } else {
        managerReceipts = [];
      }
    } else {
      managerReceipts = [];
      localStorage.setItem(MGR_RECEIPTS_KEY, JSON.stringify([]));
    }
  } catch (e) {
    managerReceipts = [];
  }
}'''
rec_code = rec_code.replace(old_load_rec, new_load_rec)

# Update renderKpis in manager-receive.js
old_render_rec_kpis = '''function renderKpis() {
  const todayCountEl = document.getElementById('kpiRecToday');
  const monthCountEl = document.getElementById('kpiRecMonth');
  const totalCountEl = document.getElementById('kpiRecTotalCount');
  const topMaterialEl = document.getElementById('kpiRecTopMaterial');

  const totalReceipts = managerReceipts.length;
  if (totalCountEl) totalCountEl.textContent = totalReceipts;

  let todayKg = 0;
  let monthKg = 0;
  const matSums = {};

  const todayStr = new Date().toISOString().slice(0, 10);

  managerReceipts.forEach(r => {
    const q = Number(r.quantity || 0);
    const mName = r.materialName || 'Material';
    matSums[mName] = (matSums[mName] || 0) + q;

    const rDateStr = String(r.date || '');
    if (rDateStr.includes('Today') || rDateStr.includes(todayStr)) {
      todayKg += q;
    }
    monthKg += q;
  });

  if (todayCountEl) todayCountEl.textContent = `${todayKg} kg`;
  if (monthCountEl) monthCountEl.textContent = `${monthKg} kg`;

  let topMat = 'Cooking Oil';
  let maxQty = 0;
  Object.keys(matSums).forEach(m => {
    if (matSums[m] > maxQty) {
      maxQty = matSums[m];
      topMat = m;
    }
  });

  if (topMaterialEl) topMaterialEl.textContent = topMat;
}'''

new_render_rec_kpis = '''function renderKpis() {
  const todayCountEl = document.getElementById('kpiRecToday');
  const todaySubEl = document.getElementById('kpiRecTodaySub');
  const monthCountEl = document.getElementById('kpiRecMonth');
  const monthSubEl = document.getElementById('kpiRecMonthSub');
  const totalCountEl = document.getElementById('kpiRecTotalCount');
  const topMaterialEl = document.getElementById('kpiRecTopMaterial');
  const topMaterialSubEl = document.getElementById('kpiRecTopMaterialSub');

  const totalReceipts = managerReceipts.length;
  if (totalCountEl) totalCountEl.textContent = totalReceipts;

  let todayKg = 0;
  let todayShipments = 0;
  let monthKg = 0;
  let monthDeliveries = 0;
  const matSums = {};

  const todayStr = new Date().toISOString().slice(0, 10);
  const currentMonthStr = todayStr.slice(0, 7);

  managerReceipts.forEach(r => {
    const q = Number(r.quantity || 0);
    const mName = r.materialName || 'Material';
    matSums[mName] = (matSums[mName] || 0) + q;

    const rDateStr = String(r.date || '');
    if (rDateStr.includes('Today') || rDateStr.includes(todayStr)) {
      todayKg += q;
      todayShipments++;
    }
    if (rDateStr.includes(currentMonthStr) || rDateStr.includes('Today') || rDateStr.includes('Yesterday')) {
      monthKg += q;
      monthDeliveries++;
    } else {
      monthKg += q;
      monthDeliveries++;
    }
  });

  if (todayCountEl) todayCountEl.textContent = `${todayKg} kg`;
  if (todaySubEl) todaySubEl.textContent = `Across ${todayShipments} shipment${todayShipments === 1 ? '' : 's'}`;

  if (monthCountEl) monthCountEl.textContent = `${monthKg} kg`;
  if (monthSubEl) monthSubEl.textContent = `${monthDeliveries} verified deliver${monthDeliveries === 1 ? 'y' : 'ies'}`;

  let topMat = '--';
  let maxQty = 0;
  Object.keys(matSums).forEach(m => {
    if (matSums[m] > maxQty) {
      maxQty = matSums[m];
      topMat = m;
    }
  });

  if (topMaterialEl) topMaterialEl.textContent = topMat;
  if (topMaterialSubEl) topMaterialSubEl.textContent = `${maxQty} kg total inward`;
}'''
rec_code = rec_code.replace(old_render_rec_kpis, new_render_rec_kpis)

# History table empty state in manager-receive.js
empty_history_rec = '''  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:36px 16px; color:#5C7A68; font-size:13px;">
          <div style="font-weight:700; color:#0F2A1B; margin-bottom:4px;">No receipts recorded yet</div>
          <div style="font-size:12px; color:#94A3B8;">Incoming raw material deliveries recorded will appear here automatically.</div>
        </td>
      </tr>
    `;
    if (countEl) countEl.textContent = 'Showing 0 receipts';
    if (paginationControls) paginationControls.innerHTML = '';
    return;
  }'''

rec_code = rec_code.replace(
    '  const totalItems = filtered.length;',
    empty_history_rec + '\n\n  const totalItems = filtered.length;'
)

with open(receive_js_path, 'w', encoding='utf-8') as f:
    f.write(rec_code)

print("Updated manager-receive.js successfully.")

# ============================================================================
# 2. UPDATE manager-disburse.js
# ============================================================================
disb_js_path = 'RMIMS/js/manager-disburse.js'
with open(disb_js_path, 'r', encoding='utf-8') as f:
    disb_code = f.read()

# Replace INITIAL_MGR_DISBURSEMENTS
disb_code = re.sub(
    r'const INITIAL_MGR_DISBURSEMENTS = \[[\s\S]*?\];',
    'const INITIAL_MGR_DISBURSEMENTS = [];',
    disb_code
)

# Update generateNextReference
old_disb_gen_ref = '''function generateNextReference() {
  const allRefs = managerDisbursements.map(d => d.ref).concat(
    getSystemCustomDisbursements().map(d => d.id || '')
  );

  let maxNum = 91;
  allRefs.forEach(ref => {
    const match = String(ref).match(/DIS-2026-(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  const nextNum = maxNum + 1;
  return `DIS-2026-${String(nextNum).padStart(5, '0')}`;
}'''

new_disb_gen_ref = '''function generateNextReference() {
  const allRefs = managerDisbursements.map(d => d.ref).concat(
    getSystemCustomDisbursements().map(d => d.id || '')
  );

  let maxNum = 0;
  allRefs.forEach(ref => {
    const match = String(ref).match(/DIS-2026-(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  const nextNum = maxNum + 1;
  return `DIS-2026-${String(nextNum).padStart(5, '0')}`;
}'''
disb_code = disb_code.replace(old_disb_gen_ref, new_disb_gen_ref)

# Update loadDisbursements
old_load_disb = '''function loadDisbursements() {
  try {
    const raw = localStorage.getItem(MGR_DISBURSEMENTS_KEY);
    if (raw) {
      managerDisbursements = JSON.parse(raw);
    } else {
      managerDisbursements = [...INITIAL_MGR_DISBURSEMENTS];
      localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(managerDisbursements));
    }
  } catch (e) {
    managerDisbursements = [...INITIAL_MGR_DISBURSEMENTS];
  }
}'''

new_load_disb = '''function loadDisbursements() {
  try {
    const raw = localStorage.getItem(MGR_DISBURSEMENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Cleanse legacy mock IDs
        managerDisbursements = parsed.filter(d => !['DIS-2026-00091', 'DIS-2026-00090', 'DIS-2026-00088', 'DIS-2026-00084'].includes(d.ref));
        if (managerDisbursements.length !== parsed.length) {
          localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify(managerDisbursements));
        }
      } else {
        managerDisbursements = [];
      }
    } else {
      managerDisbursements = [];
      localStorage.setItem(MGR_DISBURSEMENTS_KEY, JSON.stringify([]));
    }
  } catch (e) {
    managerDisbursements = [];
  }
}'''
disb_code = disb_code.replace(old_load_disb, new_load_disb)

# Update renderKpis in manager-disburse.js
old_render_disb_kpis = '''function renderKpis() {
  const todayCountEl = document.getElementById('kpiDisbToday');
  const monthCountEl = document.getElementById('kpiDisbMonth');
  const totalCountEl = document.getElementById('kpiDisbTotalCount');
  const topTargetEl = document.getElementById('kpiDisbTopTarget');

  const totalDisbursements = managerDisbursements.length;
  if (totalCountEl) totalCountEl.textContent = totalDisbursements;

  let todayKg = 0;
  let monthKg = 0;
  const targetSums = {};

  const todayStr = new Date().toISOString().slice(0, 10);

  managerDisbursements.forEach(d => {
    const q = Number(d.quantity || 0);
    const target = d.usedFor || 'General Production';
    targetSums[target] = (targetSums[target] || 0) + q;

    const dDateStr = String(d.date || '');
    if (dDateStr.includes('Today') || dDateStr.includes(todayStr)) {
      todayKg += q;
    }
    monthKg += q;
  });

  if (todayCountEl) todayCountEl.textContent = `${todayKg} kg`;
  if (monthCountEl) monthCountEl.textContent = `${monthKg} kg`;

  let topTarget = 'Pandesal Batch';
  let maxQty = 0;
  Object.keys(targetSums).forEach(t => {
    if (targetSums[t] > maxQty) {
      maxQty = targetSums[t];
      topTarget = t;
    }
  });

  if (topTargetEl) topTargetEl.textContent = topTarget;
}'''

new_render_disb_kpis = '''function renderKpis() {
  const todayCountEl = document.getElementById('kpiDisbToday');
  const todaySubEl = document.getElementById('kpiDisbTodaySub');
  const monthCountEl = document.getElementById('kpiDisbMonth');
  const monthSubEl = document.getElementById('kpiDisbMonthSub');
  const totalCountEl = document.getElementById('kpiDisbTotalCount');
  const topTargetEl = document.getElementById('kpiDisbTopTarget');
  const topTargetSubEl = document.getElementById('kpiDisbTopTargetSub');

  const totalDisbursements = managerDisbursements.length;
  if (totalCountEl) totalCountEl.textContent = totalDisbursements;

  let todayKg = 0;
  let todayRuns = 0;
  let monthKg = 0;
  let monthBatches = 0;
  const targetSums = {};

  const todayStr = new Date().toISOString().slice(0, 10);
  const currentMonthStr = todayStr.slice(0, 7);

  managerDisbursements.forEach(d => {
    const q = Number(d.quantity || 0);
    const target = d.usedFor || 'General Production';
    targetSums[target] = (targetSums[target] || 0) + q;

    const dDateStr = String(d.date || '');
    if (dDateStr.includes('Today') || dDateStr.includes(todayStr)) {
      todayKg += q;
      todayRuns++;
    }
    if (dDateStr.includes(currentMonthStr) || dDateStr.includes('Today') || dDateStr.includes('Yesterday')) {
      monthKg += q;
      monthBatches++;
    } else {
      monthKg += q;
      monthBatches++;
    }
  });

  if (todayCountEl) todayCountEl.textContent = `${todayKg} kg`;
  if (todaySubEl) todaySubEl.textContent = `Across ${todayRuns} production run${todayRuns === 1 ? '' : 's'}`;

  if (monthCountEl) monthCountEl.textContent = `${monthKg} kg`;
  if (monthSubEl) monthSubEl.textContent = `${monthBatches} production batch${monthBatches === 1 ? '' : 'es'}`;

  let topTarget = '--';
  let maxQty = 0;
  Object.keys(targetSums).forEach(t => {
    if (targetSums[t] > maxQty) {
      maxQty = targetSums[t];
      topTarget = t;
    }
  });

  if (topTargetEl) topTargetEl.textContent = topTarget;
  if (topTargetSubEl) topTargetSubEl.textContent = `${maxQty} kg raw materials`;
}'''
disb_code = disb_code.replace(old_render_disb_kpis, new_render_disb_kpis)

# History table empty state in manager-disburse.js
empty_history_disb = '''  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:36px 16px; color:#5C7A68; font-size:13px;">
          <div style="font-weight:700; color:#0F2A1B; margin-bottom:4px;">No disbursements recorded yet</div>
          <div style="font-size:12px; color:#94A3B8;">Outward raw material usage recorded for production will appear here automatically.</div>
        </td>
      </tr>
    `;
    if (countEl) countEl.textContent = 'Showing 0 disbursements';
    if (paginationControls) paginationControls.innerHTML = '';
    return;
  }'''

disb_code = disb_code.replace(
    '  const totalItems = filtered.length;',
    empty_history_disb + '\n\n  const totalItems = filtered.length;'
)

with open(disb_js_path, 'w', encoding='utf-8') as f:
    f.write(disb_code)

print("Updated manager-disburse.js successfully.")

# ============================================================================
# 3. UPDATE analytics-engine.js (Remove mock seed-rec and seed-disb fallbacks)
# ============================================================================
analytics_js_path = 'RMIMS/js/analytics-engine.js'
with open(analytics_js_path, 'r', encoding='utf-8') as f:
    an_code = f.read()

# Replace seed-rec fallback with authentic stock receipts
old_rec_pool = '''  // If live receipts exist from user actions, prioritize them; otherwise provide authentic operational baseline
  let rawReceiptPool = [];
  if (activeReceiptList.length > 0) {
    rawReceiptPool = activeReceiptList;
  } else {
    rawReceiptPool = [
      { id: 'seed-rec-1', material_name: 'All-Purpose Wheat Flour', quantity: 25, unit: 'kg', receipt_date: '2026-09-28' },
      { id: 'seed-rec-2', material_name: 'Palm Cooking Oil', quantity: 30, unit: 'L', receipt_date: '2026-09-29' },
      { id: 'seed-rec-3', material_name: 'Refined White Sugar', quantity: 35, unit: 'kg', receipt_date: '2026-09-29' },
      { id: 'seed-rec-4', material_name: 'Brown Sugar', quantity: 20, unit: 'kg', receipt_date: '2026-09-29' },
      { id: 'seed-rec-5', material_name: 'Salted Butter', quantity: 15, unit: 'kg', receipt_date: '2026-09-30' }
    ];
  }'''

new_rec_pool = '''  // Combine live receipts with authoritative 6-month historical receipts
  let rawReceiptPool = [...activeReceiptList];
  if (Array.isArray(AUTHENTIC_STOCK_RECEIPTS_6MONTHS)) {
    AUTHENTIC_STOCK_RECEIPTS_6MONTHS.forEach(r => {
      rawReceiptPool.push({
        id: r.id,
        ref: r.id,
        material_id: r.material_id,
        material_name: r.material_name,
        quantity: r.received_quantity,
        unit: r.unit || 'kg',
        receipt_date: r.receipt_date || '2026-03-01'
      });
    });
  }'''
an_code = an_code.replace(old_rec_pool, new_rec_pool)

# Replace seed-disb fallback with authentic daily disbursements
old_disb_pool = '''  let rawDisbPool = [];
  if (activeDisbList.length > 0) {
    rawDisbPool = activeDisbList;
  } else {
    rawDisbPool = [
      { id: 'seed-disb-1', material_name: 'Refined White Sugar', quantity: 25, unit: 'kg', usage_date: '2026-09-30', finished_product_name: 'Coco Jam Batch' },
      { id: 'seed-disb-2', material_name: 'All-Purpose Wheat Flour', quantity: 15, unit: 'kg', usage_date: '2026-09-29', finished_product_name: 'Classic Pandesal Batch' },
      { id: 'seed-disb-3', material_name: 'Brown Sugar', quantity: 8, unit: 'kg', usage_date: '2026-09-29', finished_product_name: 'Banana Bread Afternoon Shift' },
      { id: 'seed-disb-4', material_name: 'Palm Cooking Oil', quantity: 5, unit: 'L', usage_date: '2026-09-30', finished_product_name: 'Deep Frying Shift (Batch #44)' },
      { id: 'seed-disb-5', material_name: 'Salted Butter', quantity: 4, unit: 'kg', usage_date: '2026-09-30', finished_product_name: 'Ensaymada Special Batch' }
    ];
  }'''

new_disb_pool = '''  // Combine live disbursements with authoritative 6-month historical disbursements
  let rawDisbPool = [...activeDisbList];
  if (Array.isArray(AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS)) {
    AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS.forEach(d => {
      rawDisbPool.push({
        id: d.id,
        ref: d.id,
        material_id: d.material_id,
        material_name: d.material_name,
        quantity: d.consumed_quantity,
        unit: d.unit || 'kg',
        usage_date: d.usage_date || '2026-03-01',
        finished_product_name: d.finished_product_name || 'Production Batch'
      });
    });
  }'''
an_code = an_code.replace(old_disb_pool, new_disb_pool)

with open(analytics_js_path, 'w', encoding='utf-8') as f:
    f.write(an_code)

print("Updated analytics-engine.js successfully.")

# ============================================================================
# 4. UPDATE manager-usage.js
# ============================================================================
usage_js_path = 'RMIMS/js/manager-usage.js'
with open(usage_js_path, 'r', encoding='utf-8') as f:
    usage_code = f.read()

# Add import of AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS
if 'AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS' not in usage_code:
    usage_code = usage_code.replace(
        "import {\n  getSystemRawMaterials,\n  getSystemCustomDisbursements\n} from './system-materials.js';",
        "import {\n  getSystemRawMaterials,\n  getSystemCustomDisbursements\n} from './system-materials.js';\nimport { AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS } from './authentic-59-dataset.js';"
    )

# Replace DEFAULT_DISBURSEMENTS with empty array
usage_code = re.sub(
    r'const DEFAULT_DISBURSEMENTS = \[[\s\S]*?\];',
    'const DEFAULT_DISBURSEMENTS = [];',
    usage_code
)

# Update loadAllDisbursements
old_load_usage = '''function loadAllDisbursements() {
  let mgrDisb = [];
  try {
    const raw = localStorage.getItem(MGR_DISBURSEMENTS_KEY);
    if (raw) mgrDisb = JSON.parse(raw);
    else mgrDisb = [...DEFAULT_DISBURSEMENTS];
  } catch (e) {
    mgrDisb = [...DEFAULT_DISBURSEMENTS];
  }

  // Merge with system custom disbursements
  const custom = getSystemCustomDisbursements().map(c => ({
    ref: c.id,
    date: c.usage_date || 'Recent',
    materialId: c.material_id,
    materialName: c.material_name,
    category: 'General',
    quantity: c.consumed_quantity,
    unit: c.unit || 'kg',
    usedFor: c.finished_product_name || 'Production Batch',
    recordedBy: c.recorded_by || 'Maria Santos',
    status: 'Approved'
  }));

  const map = new Map();
  [...mgrDisb, ...custom].forEach(item => {
    if (item.ref && !map.has(item.ref)) {
      map.set(item.ref, item);
    }
  });

  allDisbursements = Array.from(map.values());
}'''

new_load_usage = '''function loadAllDisbursements() {
  let mgrDisb = [];
  try {
    const raw = localStorage.getItem(MGR_DISBURSEMENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        mgrDisb = parsed.filter(d => !['DIS-2026-00091', 'DIS-2026-00090', 'DIS-2026-00089', 'DIS-2026-00088', 'DIS-2026-00087', 'DIS-2026-00086', 'DIS-2026-00085', 'DIS-2026-00084', 'DIS-2026-00083', 'DIS-2026-00082'].includes(d.ref));
      }
    }
  } catch (e) {
    mgrDisb = [];
  }

  // Merge with system custom disbursements
  const custom = getSystemCustomDisbursements().map(c => ({
    ref: c.id,
    date: c.usage_date || 'Recent',
    materialId: c.material_id,
    materialName: c.material_name,
    category: 'General',
    quantity: Number(c.consumed_quantity || c.quantity || 0),
    unit: c.unit || 'kg',
    usedFor: c.finished_product_name || 'Production Batch',
    recordedBy: c.recorded_by || 'Maria Santos',
    status: 'Approved'
  }));

  // Build authentic 6-month historical disbursements
  const historical = (Array.isArray(AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS) ? AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS : []).map(d => ({
    ref: d.id,
    date: d.usage_date || '2026-03-01',
    materialId: d.material_id,
    materialName: d.material_name,
    category: 'General',
    quantity: Number(d.consumed_quantity || 0),
    unit: d.unit || 'kg',
    usedFor: d.finished_product_name || 'Production Batch',
    recordedBy: d.recorded_by || 'Elena Rostova (Production Lead)',
    status: 'Approved'
  }));

  const map = new Map();
  [...mgrDisb, ...custom, ...historical].forEach(item => {
    if (item.ref && !map.has(item.ref)) {
      map.set(item.ref, item);
    }
  });

  allDisbursements = Array.from(map.values());
}'''
usage_code = usage_code.replace(old_load_usage, new_load_usage)

with open(usage_js_path, 'w', encoding='utf-8') as f:
    f.write(usage_code)

print("Updated manager-usage.js successfully.")
