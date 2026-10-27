/**
 * RMIMS Staff Dashboard Controller
 * Implements Section 3 Requirements:
 * - Summary Cards: Total Raw Materials, Available Stock, Low Stock, Today's Transactions
 * - Inventory Status: Available, Low Stock, Critical, Out of Stock breakdown
 * - Smart Stock Alerts: Simple information (Sugar: 8 kg, 3 days, Watch Stock; Oil: 2 L, 1 day, Critical)
 * - Top 5 Most Used Materials based on approved transaction records
 * - Recent Activity: Staff member's own recent activity
 */

import { getSystemRawMaterials, getSystemCustomDisbursements } from './system-materials.js';
import { getStaffTransactions, getAllCompanyTransactions } from './rmims-transaction-engine.js';
import { fetchUnifiedInventoryFromSupabase, fetchManagerDashboardData } from '../supabase/manager-supabase-service.js';

// Get the current staff name from the live session (no hardcoded fallback)
function getLiveStaffName() {
  const candidates = ['currentUser', 'rmimsCurrentUser', 'userProfile', 'user'];
  for (const key of candidates) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const o = JSON.parse(raw);
      if (o && (o.fullName || o.name)) return o.fullName || o.name;
    } catch (_) {}
  }
  return '';
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let staffChartInstance = null;
let currentStaffDays = 14;

document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  initStaffChart();

  // Cross-tab real-time sync
  const refreshStaffDashboard = () => {
    initDashboard();
    renderStaffChart();
  };

  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.includes('transactions') || e.key.includes('materials') || e.key.includes('receipts') || e.key.includes('activity')) {
      refreshStaffDashboard();
    }
  });
  window.addEventListener('rmims_staff_transactions_updated', refreshStaffDashboard);
  window.addEventListener('rmims_staff_activity_updated', refreshStaffDashboard);
  window.addEventListener('rmims_inventory_updated', refreshStaffDashboard);
  window.addEventListener('rmims_manager_receipts_updated', refreshStaffDashboard);
  window.addEventListener('rmims_manager_disbursements_updated', refreshStaffDashboard);

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('rmims_user_sync');
      channel.onmessage = () => {
        refreshStaffDashboard();
      };
    }
  } catch (_) {}

  // Live Supabase sync on load
  try {
    fetchUnifiedInventoryFromSupabase().then(() => {
      refreshStaffDashboard();
    }).catch(() => {});
  } catch (_) {}
});

async function initDashboard() {
  try {
    const rawLocal = localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser');
    if (rawLocal) {
      const u = JSON.parse(rawLocal);
      const uOp = String(u.operationalRole || u.operational_role || '').toLowerCase();
      const uBase = String(u.role || '').toLowerCase();
      if (uOp === 'manager' || uBase === 'manager') {
        window.location.replace('../manager/dashboard.html');
        return;
      }
    }
  } catch (_) {}

  const materials = (getSystemRawMaterials() || []).filter(m => {
    const n = String(m.name || m.raw_material_name || '').toLowerCase();
    const c = String(m.item_code || m.id || '').toUpperCase();
    return !n.includes('coconut') && c !== 'NB-015' && c !== 'RM-033' && c !== 'RM-034';
  });

  const activeStaffName = getLiveStaffName().trim().toLowerCase();
  let staffUserEmail = '';
  try {
    const raw = localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || localStorage.getItem('userProfile') || localStorage.getItem('staffUser');
    if (raw) staffUserEmail = String(JSON.parse(raw)?.email || '').trim().toLowerCase();
  } catch (_) {}

  const rawStaffTx = (getStaffTransactions() || []).filter(t => !String(t.material || t.rawMaterial || '').toLowerCase().includes('coconut'));

  // Strict user isolation for staff member's personal activity on dashboard:
  // Brand new staff account starts with 0 personal submissions
  const staffTx = (activeStaffName || staffUserEmail)
    ? rawStaffTx.filter(t => {
        const tEmail = String(t.staffEmail || '').trim().toLowerCase();
        const tStaff = String(t.staff || '').trim().toLowerCase();
        if (staffUserEmail && tEmail) return tEmail === staffUserEmail;
        if (activeStaffName && tStaff) return tStaff === activeStaffName;
        return false;
      })
    : rawStaffTx;

  const allCompanyTx = (getAllCompanyTransactions() || []).filter(t => !String(t.material || t.rawMaterial || '').toLowerCase().includes('coconut'));

  renderSummaryCards(materials, staffTx);
  renderInventoryStatus(materials);
  renderSmartAlerts(materials);
  renderTop5Materials(materials, allCompanyTx);
  renderRecentActivity(staffTx);
  renderStaffChart(staffTx);
}

function initStaffChart() {
  const rangeSelect = document.getElementById('chartRangeSelect');
  const rangeSpan = document.getElementById('usageDateRangeSpan');
  if (rangeSelect) {
    rangeSelect.addEventListener('change', () => {
      currentStaffDays = parseInt(rangeSelect.value, 10) || 14;
      if (rangeSpan) rangeSpan.textContent = `Last ${currentStaffDays} Days`;
      renderStaffChart();
    });
  }
  renderStaffChart();
}

function renderStaffChart(providedStaffTx = null) {
  const ctx = document.getElementById('staffActivityChart');
  if (!ctx || typeof Chart === 'undefined') return;

  let txSource = providedStaffTx;
  if (!txSource) {
    const activeStaffName = getLiveStaffName().trim().toLowerCase();
    let staffUserEmail = '';
    try {
      const raw = localStorage.getItem('currentUser') || localStorage.getItem('rmimsCurrentUser') || localStorage.getItem('userProfile') || localStorage.getItem('staffUser');
      if (raw) staffUserEmail = String(JSON.parse(raw)?.email || '').trim().toLowerCase();
    } catch (_) {}

    const rawStaffTx = (getStaffTransactions() || []).filter(t => !String(t.material || t.rawMaterial || '').toLowerCase().includes('coconut'));
    txSource = (activeStaffName || staffUserEmail)
      ? rawStaffTx.filter(t => {
          const tEmail = String(t.staffEmail || '').trim().toLowerCase();
          const tStaff = String(t.staff || '').trim().toLowerCase();
          if (staffUserEmail && tEmail) return tEmail === staffUserEmail;
          if (activeStaffName && tStaff) return tStaff === activeStaffName;
          return false;
        })
      : rawStaffTx;
  }

  const labels = [];
  const recData = [];
  const disbData = [];

  const now = new Date();
  for (let i = currentStaffDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const isoDate = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

    let rSum = 0;
    let dSum = 0;

    txSource.forEach(t => {
      const td = t.date || t.createdAt || '';
      if (td.startsWith(isoDate)) {
        const act = (t.activity || t.type || '').toLowerCase();
        const qty = parseFloat(t.qtyNum || t.quantity || 0) || 0;
        if (act.includes('rec')) rSum += qty;
        else if (act.includes('disb')) dSum += qty;
      }
    });

    recData.push(Math.round(rSum));
    disbData.push(Math.round(dSum));
  }

  if (staffChartInstance) {
    staffChartInstance.data.labels = labels;
    staffChartInstance.data.datasets[0].data = recData;
    staffChartInstance.data.datasets[1].data = disbData;
    staffChartInstance.update();
    return;
  }

  staffChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Inward Receipts',
          data: recData,
          borderColor: '#16A34A',
          backgroundColor: 'rgba(22, 163, 74, 0.08)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.2,
          pointRadius: 3,
          pointBackgroundColor: '#16A34A',
          pointHoverRadius: 5
        },
        {
          label: 'Production Disbursements',
          data: disbData,
          borderColor: '#0284C7',
          backgroundColor: 'rgba(2, 132, 199, 0.08)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.2,
          pointRadius: 3,
          pointBackgroundColor: '#0284C7',
          pointHoverRadius: 5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0F2A1B',
          titleFont: { family: 'Inter', size: 12, weight: '700' },
          bodyFont: { family: 'Inter', size: 12 },
          padding: 10,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#64748B', font: { family: 'Inter', size: 11 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(20, 83, 45, 0.06)' },
          ticks: { color: '#64748B', font: { family: 'Inter', size: 11 } }
        }
      }
    }
  });
}

function getMaterialMetrics(m) {
  const stock = Number(m.current_stock ?? m.currentStock ?? m.stock ?? 0);
  const min = Number(m.minimum_threshold ?? m.minimum_stock ?? m.minimumStock ?? m.minStock ?? 10);
  const dailyBurn = Number(m.forecast_daily || m.avg_daily_usage || m.avgDailyConsumption || m.dailyUsage || Math.max(0.5, Number((min / 7).toFixed(1))));
  const daysRemaining = (dailyBurn > 0 && stock > 0) ? Math.max(0, Math.round(stock / dailyBurn)) : 0;

  let statusKey = 'good';
  let statusText = 'Good';
  if (stock <= 0 || stock < min) {
    statusKey = 'out';
    statusText = 'Out of Stock';
  } else if (daysRemaining <= 3) {
    statusKey = 'low';
    statusText = 'Low';
  } else {
    statusKey = 'good';
    statusText = 'Good';
  }
  return { stock, min, dailyBurn, daysRemaining, statusKey, statusText };
}

function renderSummaryCards(materials, staffTx) {
  const totalMaterials = materials.length;
  let availableCount = 0;
  let lowCount = 0;

  materials.forEach(m => {
    const met = getMaterialMetrics(m);
    if (met.statusKey === 'good') {
      availableCount++;
    } else if (met.statusKey === 'low') {
      lowCount++;
    }
  });

  // Calculate today's transactions by this staff member
  const todayStr = new Date().toISOString().split('T')[0];
  const todayFormatted = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const todayCount = staffTx.filter(t => {
    const isToday = (t.date && (t.date.includes(todayStr) || t.date.includes(todayFormatted))) ||
                    (t.createdAt && t.createdAt.startsWith(todayStr));
    return isToday;
  }).length;

  const elTotal = document.getElementById('kpiTotalMaterials');
  const elAvailable = document.getElementById('kpiAvailableStock');
  const elLow = document.getElementById('kpiLowStock');
  const elToday = document.getElementById('kpiTodayTx');
  const elTodaySub = document.getElementById('kpiTodayTxSub');
  const elPending = document.getElementById('kpiPendingTx');

  const pendingCount = staffTx.filter(t => (t.status || '').toLowerCase() === 'pending').length;

  if (elTotal) elTotal.textContent = totalMaterials;
  if (elAvailable) elAvailable.textContent = `${availableCount} items`;
  if (elLow) elLow.textContent = `${lowCount} items`;
  if (elToday) elToday.textContent = todayCount;
  if (elTodaySub) elTodaySub.textContent = `${todayCount} submitted today`;
  if (elPending) elPending.textContent = pendingCount;
}

function renderInventoryStatus(materials) {
  const total = materials.length || 1;
  let available = 0;
  let low = 0;
  let critical = 0;
  let out = 0;

  materials.forEach(m => {
    const met = getMaterialMetrics(m);
    if (met.statusKey === 'out') {
      out++;
      critical++;
    } else if (met.statusKey === 'low') {
      low++;
    } else {
      available++;
    }
  });

  const pct = count => Math.round((count / total) * 100);

  // Update counts
  const cAvail = document.getElementById('statusCountAvailable');
  const cLow = document.getElementById('statusCountLow');
  const cCrit = document.getElementById('statusCountCritical');
  const cOut = document.getElementById('statusCountOut');

  if (cAvail) cAvail.textContent = `${available} items (${pct(available)}%)`;
  if (cLow) cLow.textContent = `${low} items (${pct(low)}%)`;
  if (cCrit) cCrit.textContent = `${critical} items (${pct(critical)}%)`;
  if (cOut) cOut.textContent = `${out} items (${pct(out)}%)`;

  // Update progress bars
  const bAvail = document.getElementById('barFillAvailable');
  const bLow = document.getElementById('barFillLow');
  const bCrit = document.getElementById('barFillCritical');
  const bOut = document.getElementById('barFillOut');

  if (bAvail) bAvail.style.width = `${pct(available)}%`;
  if (bLow) bLow.style.width = `${pct(low)}%`;
  if (bCrit) bCrit.style.width = `${pct(critical)}%`;
  if (bOut) bOut.style.width = `${pct(out)}%`;
}

function calculateDaysRemaining(m) {
  const met = getMaterialMetrics(m);
  return met.daysRemaining;
}

function renderSmartAlerts(materials) {
  const container = document.getElementById('smartAlertsContainer');
  if (!container) return;

  // Filter materials that are low, critical, or out
  const alertItems = [];

  materials.forEach(m => {
    const met = getMaterialMetrics(m);
    const unit = m.unit_of_measure || m.unit || '';

    if (met.statusKey === 'out') {
      alertItems.push({
        name: m.name || m.materialName || m.raw_material_name,
        stock: met.stock,
        unit: unit,
        days: 0,
        badge: 'Out of Stock',
        badgeClass: 'badge-critical'
      });
    } else if (met.statusKey === 'low') {
      alertItems.push({
        name: m.name || m.materialName || m.raw_material_name,
        stock: met.stock,
        unit: unit,
        days: met.daysRemaining,
        badge: 'Low Stock',
        badgeClass: 'badge-watch'
      });
    }
  });

  // Sort: Critical first, then lowest days
  alertItems.sort((a, b) => a.days - b.days);

  const badgeEl = document.getElementById('alertCountBadge');
  if (badgeEl) badgeEl.textContent = `${alertItems.length} alerts detected`;

  if (alertItems.length === 0) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #15803D; background: #DCFCE7; border-radius: 10px; font-weight: 600; font-size: 13px;">
        ✓ All materials have healthy stock levels. No immediate stock watch required.
      </div>
    `;
    return;
  }

  // Display top 4 alerts matching format in specification:
  // e.g. Sugar — Current Stock: 8 kg, Estimated Days Remaining: 3 days, Watch Stock
  container.innerHTML = alertItems.slice(0, 4).map(item => `
    <div class="smart-alert-card">
      <div class="smart-alert-left">
        <span class="smart-alert-name">${escapeHtml(item.name)}</span>
        <span class="smart-alert-meta">
          Current Stock: <strong>${item.stock}${item.unit ? ' ' + item.unit : ''}</strong> &bull; Estimated Days Remaining: <strong>${item.days === 0 ? 'Depleted' : `${item.days} ${item.days === 1 ? 'day' : 'days'}`}</strong>
        </span>
      </div>
      <span class="smart-alert-badge ${item.badgeClass}">
        ${escapeHtml(item.badge)}
      </span>
    </div>
  `).join('');
}

function renderTop5Materials(materials, allCompanyTx) {
  const container = document.getElementById('topMaterialsContainer');
  if (!container) return;

  // Aggregate approved disbursements per material
  const usageMap = {};

  // Initialize with catalog materials
  materials.forEach(m => {
    const name = m.name || m.materialName;
    usageMap[name] = {
      name: name,
      qty: 0,
      unit: m.unit_of_measure || m.unit || ''
    };
  });

  // Process approved disbursements
  allCompanyTx.forEach(t => {
    if (t.activity === 'Disburse' && t.status === 'Approved') {
      const mat = t.material;
      if (mat) {
        if (!usageMap[mat]) {
          const mObj = materials.find(m => (m.name || m.materialName) === mat);
          usageMap[mat] = { name: mat, qty: 0, unit: t.unit || (mObj ? (mObj.unit_of_measure || mObj.unit) : '') || '' };
        }
        usageMap[mat].qty += (t.qtyNum || parseFloat(t.quantity || 0) || 0);
      }
    }
  });

  // If no transactions yet, seed with standard baseline usage
  const sorted = Object.values(usageMap).sort((a, b) => b.qty - a.qty);

  // If top items have 0 usage or no records, display clean zero-state message
  if (!sorted.length || !sorted[0] || sorted[0].qty === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 22px 16px; background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 10px; text-align: center; color: #64748B; font-size: 13px;">
        <span style="font-size: 16px; margin-right: 6px;">📊</span>
        <strong>No production disbursements recorded yet.</strong>
        <div style="font-size: 11.5px; color: #94A3B8; margin-top: 4px;">
          Top consumed materials will appear here once production disbursements are approved.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = sorted.slice(0, 5).map((item, idx) => `
    <div class="top-mat-card">
      <span class="top-mat-rank">#${idx + 1} Top Used</span>
      <span class="top-mat-name">${escapeHtml(item.name)}</span>
      <span class="top-mat-usage"><strong>${item.qty.toLocaleString()} ${item.unit}</strong> total consumed</span>
    </div>
  `).join('');
}

function renderRecentActivity(staffTx) {
  const tbody = document.getElementById('staffDashboardActivityTbody');
  if (!tbody) return;

  if (staffTx.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:28px 16px; color:#64748B;">
          <strong>No recent transactions recorded.</strong><br>
          <span style="font-size:12px;">Create your first transaction using "Record Receive" or "Record Disburse".</span>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = staffTx.slice(0, 6).map(t => {
    let statusClass = 'pill-pending';
    let statusLabel = t.status || 'Pending';

    if (t.status === 'Approved') statusClass = 'pill-approved';
    else if (t.status === 'Rejected') statusClass = 'pill-rejected';
    else if (t.status === 'Correction Needed') statusClass = 'pill-correction';

    const isCorrection = t.status === 'Correction Needed';

    return `
      <tr>
        <td><strong>${escapeHtml(t.date || '—')}</strong></td>
        <td><small style="color:#64748B; font-weight:600;">${escapeHtml(t.time || '—')}</small></td>
        <td>
          <span style="font-weight:700; color:${t.activity === 'Receive' ? '#15803D' : '#D97706'};">
            ${t.activity === 'Receive' ? '📥 Receive' : '📤 Disburse'}
          </span>
        </td>
        <td><strong>${escapeHtml(t.material || '--')}</strong> (${escapeHtml(t.qty || '')})</td>
        <td><code style="background:#F1F5F9; padding:2px 6px; border-radius:5px; font-weight:700; color:#334155;">${escapeHtml(t.ref)}</code></td>
        <td>
          <span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span>
        </td>
        <td style="text-align:right; white-space:nowrap;">
          ${t.status === 'Approved'
            ? `<span style="color:#94A3B8; font-size:13px; font-weight:600;">—</span>`
            : (isCorrection
              ? `<a href="my-activity.html?correct=${encodeURIComponent(t.ref)}" class="btn-dash-action btn-dash-correct" style="background:#D97706; color:#FFFFFF; font-weight:700; padding:5px 12px; font-size:11.5px; border-radius:6px; text-decoration:none; display:inline-flex; align-items:center; gap:5px; box-shadow:0 1px 3px rgba(217,119,6,0.25); border:none;" title="Correct this transaction record">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Correct
                  </a>`
              : `<a href="my-activity.html?view=${encodeURIComponent(t.ref)}" class="btn-dash-action btn-dash-view" style="background:#FFFFFF; color:#334155; font-weight:600; padding:4px 10px; font-size:11.5px; border-radius:6px; border:1px solid #CBD5E1; text-decoration:none; display:inline-flex; align-items:center; gap:4px; box-shadow:0 1px 2px rgba(0,0,0,0.05);" title="View record details">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> View
                  </a>`
            )
          }
        </td>
      </tr>
    `;
  }).join('');
}
