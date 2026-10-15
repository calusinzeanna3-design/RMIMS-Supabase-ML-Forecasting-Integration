/**
 * RMIMS Real-Time Consumption & Inventory Analytics Engine
 * Connected directly to live Supabase / LocalStorage / Authentic System Datasets:
 * - Real Inward Deliveries (Receipts) & Real Outward Usage (Disbursements)
 * - 3 Real-Data Cards matching User's exact layout & interaction requirements:
 *   1. Top Raw Materials Ranking (Grouped bar chart, [✓] Received & [✓] Disburse checkboxes, Top N input, Slanted & ellipsis labels, Maximize modal)
 *   2. Top Finished Products (Bar chart, [✓] Consumed & [✓] Batches checkboxes, Top N input, Maximize modal)
 *   3. Disbursed Raw Materials Trend (Area curve, Material select dropdown, [Days / Weeks / Months] timeframe, Maximize modal)
 * - Responsive Maximize Modal (Matching Reference Image 4) with expanded canvas and complete data table
 * - System Light Theme colors (Emerald #16A34A, Amber #D97706, Blue #2563EB)
 */

import {
  getSystemRawMaterials,
  getSystemCustomReceipts,
  getSystemCustomDisbursements
} from './system-materials.js';

import {
  AUTHENTIC_STOCK_RECEIPTS_6MONTHS,
  AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS,
  AUTHENTIC_FINISHED_PRODUCTS_CATALOG
} from './authentic-59-dataset.js';

// ============================================================================
// GLOBAL STATE
// ============================================================================

const state = {
  rawMaterials: [],
  receipts: [],
  disbursements: [],
  finishedProducts: [],

  // Card 1: Top Raw Materials (Received vs Disburse)
  card1: {
    showReceived: true,
    showDisburse: true,
    topCount: 5,
    chart: null
  },

  // Card Stock: Raw Materials Stock Levels
  cardStock: {
    showCurrent: true,
    showMin: true,
    topCount: 5,
    chart: null
  },

  // Card 2: Top Finished Products
  card2: {
    showConsumed: true,
    showBatches: true,
    topCount: 5,
    chart: null
  },

  // Card 3: Disbursed Trend
  card3: {
    selectedMaterial: 'ALL',
    timeframe: 'days', // 'days' | 'weeks' | 'months'
    chart: null
  },

  // Maximize Modal State
  modal: {
    activeTarget: null, // 'raw_materials' | 'stock_levels' | 'finished_products' | 'disburse_trend'
    chart: null
  }
};

// ============================================================================
// INITIALIZATION & REAL DATA AGGREGATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initAnalytics();
});

export function initAnalytics() {
  loadAuthoritativeData();
  bindChecklistsAndControls();
  populateMaterialDropdown();
  renderAllCharts();
  bindModalEvents();

  // Listen to live inventory updates from Receive and Disburse modules
  window.addEventListener('storage', (e) => {
    if (!e || e.key === 'rmims_inventory_updated' || e.key === 'rmims_manager_receipts' || e.key === 'rmims_manager_disbursements') {
      loadAuthoritativeData();
      populateMaterialDropdown();
      renderAllCharts();
      if (state.modal.activeTarget) {
        renderModalChart(state.modal.activeTarget);
      }
    }
  });
}

function loadAuthoritativeData() {
  // 1. Raw Materials Master Catalog
  state.rawMaterials = getSystemRawMaterials();

  // Create fast map of materials by ID, item_code, and lowercase name
  const matLookup = new Map();
  state.rawMaterials.forEach(m => {
    if (m.id) matLookup.set(String(m.id).toLowerCase().trim(), m);
    if (m.item_code) matLookup.set(String(m.item_code).toLowerCase().trim(), m);
    if (m.name) matLookup.set(m.name.toLowerCase().trim(), m);
  });

  // 2. Real Inward Receipts from System (Live Manager & User Receipts)
  let mgrReceipts = [];
  try {
    const raw = localStorage.getItem('rmims_manager_receipts');
    if (raw) mgrReceipts = JSON.parse(raw);
  } catch (e) {}

  const customReceipts = getSystemCustomReceipts();
  const activeReceiptList = [...mgrReceipts, ...customReceipts];

  // Combine live receipts with authoritative 6-month historical receipts only if baseline is not wiped
  let rawReceiptPool = [...activeReceiptList];
  const isBaselineWiped = localStorage.getItem('rmims_wipe_baseline_materials') !== 'false';
  if (!isBaselineWiped && Array.isArray(AUTHENTIC_STOCK_RECEIPTS_6MONTHS)) {
    AUTHENTIC_STOCK_RECEIPTS_6MONTHS.forEach(r => {
      rawReceiptPool.push({
        id: r.id,
        ref: r.id,
        material_id: r.material_id,
        material_name: r.material_name,
        quantity: r.received_quantity,
        unit: r.unit || '',
        receipt_date: r.receipt_date || '2026-03-01'
      });
    });
  }

  const receiptMap = new Map();
  rawReceiptPool.forEach(item => {
    const rawId = String(item.materialId || item.material_id || item.item_code || '').trim();
    const rawName = String(item.materialName || item.material_name || item.name || '').trim();
    const matched = matLookup.get(rawId.toLowerCase()) || matLookup.get(rawName.toLowerCase());
    const finalName = matched ? matched.name : rawName;
    if (!finalName || finalName.toLowerCase() === 'other material') return;

    const qty = parseFloat(item.quantity) || parseFloat(item.received_quantity) || parseFloat(item.receivedQuantity) || 0;
    if (qty <= 0) return;

    const ref = item.ref || item.id || `rcv-${receiptMap.size + 1}`;
    receiptMap.set(ref, {
      ref: ref,
      date: item.date || item.receipt_date || item.receiptDate || 'Recent',
      materialId: matched ? (matched.id || matched.item_code) : rawId,
      materialName: finalName,
      quantity: qty,
      unit: matched ? (matched.unit_of_measure || matched.unit || '') : (item.unit || '')
    });
  });
  state.receipts = Array.from(receiptMap.values());

  // 3. Real Outward Disbursements from System (Live Manager & User Disbursements)
  let mgrDisb = [];
  try {
    const raw = localStorage.getItem('rmims_manager_disbursements');
    if (raw) mgrDisb = JSON.parse(raw);
  } catch (e) {}

  const customDisb = getSystemCustomDisbursements();
  const activeDisbList = [...mgrDisb, ...customDisb];

  // Combine live disbursements with authoritative 6-month historical disbursements only if baseline is not wiped
  let rawDisbPool = [...activeDisbList];
  if (!isBaselineWiped && Array.isArray(AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS)) {
    AUTHENTIC_DAILY_DISBURSEMENTS_6MONTHS.forEach(d => {
      rawDisbPool.push({
        id: d.id,
        ref: d.id,
        material_id: d.material_id,
        material_name: d.material_name,
        quantity: d.consumed_quantity,
        unit: d.unit || '',
        usage_date: d.usage_date || '2026-03-01',
        finished_product_name: d.finished_product_name || 'Production Batch'
      });
    });
  }

  const disbMap = new Map();
  rawDisbPool.forEach(item => {
    const rawId = String(item.materialId || item.material_id || item.item_code || '').trim();
    const rawName = String(item.materialName || item.material_name || item.name || '').trim();
    const matched = matLookup.get(rawId.toLowerCase()) || matLookup.get(rawName.toLowerCase());
    const finalName = matched ? matched.name : rawName;
    if (!finalName || finalName.toLowerCase() === 'other material') return;

    const qty = parseFloat(item.quantity) || parseFloat(item.consumed_quantity) || parseFloat(item.consumedQuantity) || 0;
    if (qty <= 0) return;

    const ref = item.ref || item.id || `disb-${disbMap.size + 1}`;
    disbMap.set(ref, {
      ref: ref,
      date: item.date || item.usage_date || item.disbursement_date || 'Recent',
      materialId: matched ? (matched.id || matched.item_code) : rawId,
      materialName: finalName,
      quantity: qty,
      unit: matched ? (matched.unit_of_measure || matched.unit || '') : (item.unit || ''),
      usedFor: item.usedFor || item.finished_product_name || item.product || 'Production Batch'
    });
  });
  state.disbursements = Array.from(disbMap.values());

  // 4. Finished Products Catalog
  let customProds = [];
  try {
    const raw = localStorage.getItem('rmims_custom_finished_products');
    if (raw) customProds = JSON.parse(raw);
  } catch (e) {}

  state.finishedProducts = isBaselineWiped ? [...customProds] : [...(AUTHENTIC_FINISHED_PRODUCTS_CATALOG || []), ...customProds];
}

// ============================================================================
// CONTROLS & CHECKLIST BINDINGS
// ============================================================================

function bindChecklistsAndControls() {
  // --- CARD 1: TOP RAW MATERIALS RANKING ---
  const chkRec = document.getElementById('anChkRawReceived');
  const chkDisb = document.getElementById('anChkRawDisburse');
  const topRawInput = document.getElementById('anTopRawCount');
  const btnMaxRaw = document.getElementById('anBtnMaxRawMaterials');

  const updateCard1CheckUI = () => {
    const pillRec = document.getElementById('anPillRawReceived');
    const pillDisb = document.getElementById('anPillRawDisburse');
    if (pillRec) pillRec.classList.toggle('active-received', chkRec.checked);
    if (pillDisb) pillDisb.classList.toggle('active-disburse', chkDisb.checked);
  };

  if (chkRec) {
    chkRec.addEventListener('change', () => {
      state.card1.showReceived = chkRec.checked;
      updateCard1CheckUI();
      renderCard1();
    });
  }

  if (chkDisb) {
    chkDisb.addEventListener('change', () => {
      state.card1.showDisburse = chkDisb.checked;
      updateCard1CheckUI();
      renderCard1();
    });
  }

  if (topRawInput) {
    topRawInput.addEventListener('input', () => {
      const val = parseInt(topRawInput.value.replace(/[^0-9]/g, ''), 10);
      state.card1.topCount = (!isNaN(val) && val > 0) ? Math.min(val, 50) : 5;
      renderCard1();
    });
  }

  if (btnMaxRaw) {
    btnMaxRaw.addEventListener('click', () => openMaximizeModal('raw_materials'));
  }

  // --- CARD STOCK: RAW MATERIALS STOCK LEVELS ---
  const chkStockCur = document.getElementById('anChkStockCurrent');
  const chkStockMin = document.getElementById('anChkStockMin');
  const topStockInput = document.getElementById('anTopStockCount');
  const btnMaxStock = document.getElementById('anBtnMaxStock');

  const updateCardStockCheckUI = () => {
    const pillCur = document.getElementById('anPillStockCurrent');
    const pillMin = document.getElementById('anPillStockMin');
    if (pillCur && chkStockCur) pillCur.classList.toggle('active-stock-cur', chkStockCur.checked);
    if (pillMin && chkStockMin) pillMin.classList.toggle('active-stock-min', chkStockMin.checked);
  };

  if (chkStockCur) {
    chkStockCur.addEventListener('change', () => {
      state.cardStock.showCurrent = chkStockCur.checked;
      updateCardStockCheckUI();
      renderCardStock();
    });
  }

  if (chkStockMin) {
    chkStockMin.addEventListener('change', () => {
      state.cardStock.showMin = chkStockMin.checked;
      updateCardStockCheckUI();
      renderCardStock();
    });
  }

  if (topStockInput) {
    topStockInput.addEventListener('input', () => {
      const val = parseInt(topStockInput.value.replace(/[^0-9]/g, ''), 10);
      state.cardStock.topCount = (!isNaN(val) && val > 0) ? Math.min(val, 50) : 5;
      renderCardStock();
    });
  }

  if (btnMaxStock) {
    btnMaxStock.addEventListener('click', () => openMaximizeModal('stock_levels'));
  }

  // --- CARD 2: TOP FINISHED PRODUCTS ---
  const chkProdConsumed = document.getElementById('anChkProdConsumed');
  const chkProdBatches = document.getElementById('anChkProdBatches');
  const topProdInput = document.getElementById('anTopProdCount');
  const btnMaxProd = document.getElementById('anBtnMaxProducts');

  const updateCard2CheckUI = () => {
    const pillConsumed = document.getElementById('anPillProdConsumed');
    const pillBatches = document.getElementById('anPillProdBatches');
    if (pillConsumed) pillConsumed.classList.toggle('active-received', chkProdConsumed.checked);
    if (pillBatches) pillBatches.classList.toggle('active-disburse', chkProdBatches.checked);
  };

  if (chkProdConsumed) {
    chkProdConsumed.addEventListener('change', () => {
      state.card2.showConsumed = chkProdConsumed.checked;
      updateCard2CheckUI();
      renderCard2();
    });
  }

  if (chkProdBatches) {
    chkProdBatches.addEventListener('change', () => {
      state.card2.showBatches = chkProdBatches.checked;
      updateCard2CheckUI();
      renderCard2();
    });
  }

  if (topProdInput) {
    topProdInput.addEventListener('input', () => {
      const val = parseInt(topProdInput.value.replace(/[^0-9]/g, ''), 10);
      state.card2.topCount = (!isNaN(val) && val > 0) ? Math.min(val, 50) : 5;
      renderCard2();
    });
  }

  if (btnMaxProd) {
    btnMaxProd.addEventListener('click', () => openMaximizeModal('finished_products'));
  }

  // --- CARD 3: DISBURSED RAW MATERIALS TREND ---
  const trendMatSelect = document.getElementById('anTrendMaterialSelect');
  const btnMaxTrend = document.getElementById('anBtnMaxTrend');
  const tfBtns = document.querySelectorAll('.an-timeframe-btn');

  if (trendMatSelect) {
    trendMatSelect.addEventListener('change', () => {
      state.card3.selectedMaterial = trendMatSelect.value || 'ALL';
      renderCard3();
    });
  }

  tfBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tfBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.card3.timeframe = btn.dataset.timeframe || 'days';
      renderCard3();
    });
  });

  if (btnMaxTrend) {
    btnMaxTrend.addEventListener('click', () => openMaximizeModal('disburse_trend'));
  }
}

function populateMaterialDropdown() {
  const select = document.getElementById('anTrendMaterialSelect');
  if (!select) return;

  const current = select.value || 'ALL';
  select.innerHTML = '<option value="ALL">All Disbursed Materials</option>';

  const matNames = new Set();
  state.rawMaterials.forEach(m => {
    if (m.name) matNames.add(m.name);
  });
  state.disbursements.forEach(d => {
    if (d.materialName) matNames.add(d.materialName);
  });

  const sorted = Array.from(matNames).sort((a, b) => a.localeCompare(b));
  if (sorted.length === 0) {
    select.innerHTML = '<option value="" disabled selected>No materials in inventory</option>';
    return;
  }

  sorted.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  if (sorted.includes(current)) {
    select.value = current;
  }
}

// ============================================================================
// CARD 1: TOP RAW MATERIALS RANKING (RECEIVED VS DISBURSE)
// ============================================================================

function getTopRawMaterialsData(limit = 5) {
  const totals = new Map();

  // Initialize with system materials
  state.rawMaterials.forEach(m => {
    if (!m.name || m.name.toLowerCase() === 'other material') return;
    const key = m.name.trim();
    totals.set(key, {
      name: key,
      unit: m.unit_of_measure || m.unit || '',
      received: 0,
      disbursed: 0
    });
  });

  // Sum receipts
  state.receipts.forEach(r => {
    const key = (r.materialName || '').trim();
    if (!key || key.toLowerCase() === 'other material') return;
    if (!totals.has(key)) {
      totals.set(key, { name: key, unit: r.unit || '', received: 0, disbursed: 0 });
    }
    totals.get(key).received += Number(r.quantity || 0);
  });

  // Sum disbursements
  state.disbursements.forEach(d => {
    const key = (d.materialName || '').trim();
    if (!key || key.toLowerCase() === 'other material') return;
    if (!totals.has(key)) {
      totals.set(key, { name: key, unit: d.unit || '', received: 0, disbursed: 0 });
    }
    totals.get(key).disbursed += Number(d.quantity || 0);
  });

  let arr = Array.from(totals.values()).filter(m => (m.received > 0 || m.disbursed > 0));

  // If both checked: rank by total flow (received + disbursed)
  // If only received: rank by received
  // If only disburse: rank by disbursed
  arr.sort((a, b) => {
    if (state.card1.showReceived && state.card1.showDisburse) {
      return (b.received + b.disbursed) - (a.received + a.disbursed);
    } else if (state.card1.showReceived) {
      return b.received - a.received;
    } else if (state.card1.showDisburse) {
      return b.disbursed - a.disbursed;
    }
    return (b.received + b.disbursed) - (a.received + a.disbursed);
  });

  return arr.slice(0, limit);
}

function renderCard1() {
  const canvas = document.getElementById('anRawMaterialsChartCanvas');
  const emptyBox = document.getElementById('anRawChartEmpty');
  if (!canvas) return;

  // If both unchecked, show clean empty state
  if (!state.card1.showReceived && !state.card1.showDisburse) {
    canvas.style.display = 'none';
    if (emptyBox) emptyBox.style.display = 'flex';
    if (state.card1.chart) {
      state.card1.chart.destroy();
      state.card1.chart = null;
    }
    return;
  }

  canvas.style.display = 'block';
  if (emptyBox) emptyBox.style.display = 'none';

  const dataItems = getTopRawMaterialsData(state.card1.topCount);
  const labels = dataItems.map(d => d.name);

  const datasets = [];

  if (state.card1.showReceived) {
    datasets.push({
      label: 'Received',
      data: dataItems.map(d => Math.round(d.received * 10) / 10),
      backgroundColor: '#16A34A',
      hoverBackgroundColor: '#15803D',
      borderColor: '#16A34A',
      borderWidth: 1,
      borderRadius: 6,
      barPercentage: 0.7,
      categoryPercentage: 0.8
    });
  }

  if (state.card1.showDisburse) {
    datasets.push({
      label: 'Disburse',
      data: dataItems.map(d => Math.round(d.disbursed * 10) / 10),
      backgroundColor: '#F59E0B',
      hoverBackgroundColor: '#D97706',
      borderColor: '#D97706',
      borderWidth: 1,
      borderRadius: 6,
      barPercentage: 0.7,
      categoryPercentage: 0.8
    });
  }

  if (state.card1.chart) {
    state.card1.chart.destroy();
  }

  state.card1.chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            borderRadius: 3,
            font: { family: 'Inter, sans-serif', size: 12, weight: '600' },
            color: '#334155'
          }
        },
        tooltip: {
          backgroundColor: '#0F172A',
          titleFont: { family: 'Inter, sans-serif', size: 13, weight: '700' },
          bodyFont: { family: 'Inter, sans-serif', size: 12 },
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            title: function (context) {
              const idx = context[0].dataIndex;
              return dataItems[idx]?.name || context[0].label;
            },
            label: function (context) {
              const idx = context.dataIndex;
              const unit = dataItems[idx]?.unit || '';
              return ` ${context.dataset.label}: ${context.raw}${unit ? ' ' + unit : ''}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            // Slanted ticks and truncate to ...
            maxRotation: 45,
            minRotation: 30,
            font: { family: 'Inter, sans-serif', size: 11.5, weight: '600' },
            color: '#475569',
            callback: function (val, index) {
              const label = (dataItems && dataItems[index]) ? dataItems[index].name : (this.getLabelForValue(val) || '');
              return label.length > 14 ? label.slice(0, 12) + '...' : label;
            }
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#F1F5F9' },
          ticks: {
            font: { family: 'Inter, sans-serif', size: 11 },
            color: '#64748B',
            callback: function (val) {
              return val + ' kg';
            }
          }
        }
      }
    }
  });
}

// ============================================================================
// CARD STOCK: RAW MATERIALS STOCK LEVELS (ON-HAND VS MIN BUFFER)
// ============================================================================

function getTopStockData(limit = 5) {
  const list = state.rawMaterials.map(m => {
    const cur = parseFloat(m.current_stock ?? m.currentStock ?? 0);
    const min = parseFloat(m.minimum_threshold ?? m.minimum_stock ?? m.minimumStock ?? 10);
    const diff = cur - min;
    let status = 'Healthy';
    if (cur <= 0) {
      status = 'Out of Stock';
    } else if (cur <= min * 0.5) {
      status = 'Critical';
    } else if (cur <= min) {
      status = 'Low Stock';
    }
    return {
      id: m.id || m.item_code,
      itemCode: m.item_code || m.id,
      name: m.name,
      category: m.category || 'General Materials',
      unit: m.unit_of_measure || m.unit || '',
      currentStock: Math.max(0, cur),
      minThreshold: Math.max(0, min),
      diff: diff,
      status: status
    };
  });

  list.sort((a, b) => {
    if (state.cardStock.showCurrent) {
      return b.currentStock - a.currentStock;
    }
    return b.minThreshold - a.minThreshold;
  });

  return list.slice(0, limit);
}

function renderCardStock() {
  const canvas = document.getElementById('anStockChartCanvas');
  const emptyBox = document.getElementById('anStockChartEmpty');
  if (!canvas) return;

  if (!state.cardStock.showCurrent && !state.cardStock.showMin) {
    canvas.style.display = 'none';
    if (emptyBox) emptyBox.style.display = 'flex';
    if (state.cardStock.chart) {
      state.cardStock.chart.destroy();
      state.cardStock.chart = null;
    }
    return;
  }

  canvas.style.display = 'block';
  if (emptyBox) emptyBox.style.display = 'none';

  const dataItems = getTopStockData(state.cardStock.topCount);
  const labels = dataItems.map(d => d.name);

  const datasets = [];

  if (state.cardStock.showCurrent) {
    datasets.push({
      label: 'Current Stock',
      data: dataItems.map(d => Math.round(d.currentStock * 10) / 10),
      backgroundColor: '#16A34A',
      hoverBackgroundColor: '#15803D',
      borderColor: '#16A34A',
      borderWidth: 1,
      borderRadius: 6,
      barPercentage: 0.7,
      categoryPercentage: 0.8
    });
  }

  if (state.cardStock.showMin) {
    datasets.push({
      label: 'Minimum Buffer',
      data: dataItems.map(d => Math.round(d.minThreshold * 10) / 10),
      backgroundColor: '#EA580C',
      hoverBackgroundColor: '#C2410C',
      borderColor: '#EA580C',
      borderWidth: 1,
      borderRadius: 6,
      barPercentage: 0.7,
      categoryPercentage: 0.8
    });
  }

  if (state.cardStock.chart) {
    state.cardStock.chart.destroy();
  }

  state.cardStock.chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            borderRadius: 3,
            font: { family: 'Inter, sans-serif', size: 12, weight: '600' },
            color: '#334155'
          }
        },
        tooltip: {
          backgroundColor: '#0F172A',
          titleFont: { family: 'Inter, sans-serif', size: 13, weight: '700' },
          bodyFont: { family: 'Inter, sans-serif', size: 12 },
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            title: function (context) {
              const idx = context[0].dataIndex;
              return dataItems[idx]?.name || context[0].label;
            },
            label: function (context) {
              const idx = context.dataIndex;
              const unit = dataItems[idx]?.unit || '';
              return ` ${context.dataset.label}: ${context.raw}${unit ? ' ' + unit : ''}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 45,
            minRotation: 30,
            font: { family: 'Inter, sans-serif', size: 11.5, weight: '600' },
            color: '#475569',
            callback: function (val, index) {
              const label = (dataItems && dataItems[index]) ? dataItems[index].name : (this.getLabelForValue(val) || '');
              return label.length > 14 ? label.slice(0, 12) + '...' : label;
            }
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#F1F5F9' },
          ticks: {
            font: { family: 'Inter, sans-serif', size: 11 },
            color: '#64748B',
            callback: function (val) {
              return val + ' kg';
            }
          }
        }
      }
    }
  });
}

// ============================================================================
// CARD 2: TOP FINISHED PRODUCTS (BOTTOM LEFT)
// ============================================================================

function getTopFinishedProductsData(limit = 5) {
  const productTotals = new Map();

  // Aggregate disbursements by finished product
  state.disbursements.forEach(d => {
    let name = (d.usedFor || 'General Batch').trim();
    // Normalize trailing batch names
    name = name.replace(/\s+batch\s*(#\d+)?$/i, '').trim();
    if (!name) name = 'Unspecified Product';

    if (!productTotals.has(name)) {
      productTotals.set(name, {
        name: name,
        consumed: 0,
        batches: 0
      });
    }

    const p = productTotals.get(name);
    p.consumed += Number(d.quantity || 0);
    p.batches += 1;
  });

  let arr = Array.from(productTotals.values());

  arr.sort((a, b) => {
    if (state.card2.showConsumed && state.card2.showBatches) {
      return b.consumed - a.consumed;
    } else if (state.card2.showConsumed) {
      return b.consumed - a.consumed;
    } else if (state.card2.showBatches) {
      return b.batches - a.batches;
    }
    return b.consumed - a.consumed;
  });

  return arr.slice(0, limit);
}

function renderCard2() {
  const canvas = document.getElementById('anFinishedProductsChartCanvas');
  const emptyBox = document.getElementById('anProdChartEmpty');
  if (!canvas) return;

  if (!state.card2.showConsumed && !state.card2.showBatches) {
    canvas.style.display = 'none';
    if (emptyBox) emptyBox.style.display = 'flex';
    if (state.card2.chart) {
      state.card2.chart.destroy();
      state.card2.chart = null;
    }
    return;
  }

  canvas.style.display = 'block';
  if (emptyBox) emptyBox.style.display = 'none';

  const dataItems = getTopFinishedProductsData(state.card2.topCount);
  const labels = dataItems.map(d => d.name);

  const datasets = [];

  if (state.card2.showConsumed) {
    datasets.push({
      label: 'Consumed (kg/L)',
      data: dataItems.map(d => Math.round(d.consumed * 10) / 10),
      backgroundColor: '#2563EB',
      hoverBackgroundColor: '#1D4ED8',
      borderColor: '#1D4ED8',
      borderWidth: 1,
      borderRadius: 6,
      barPercentage: 0.7,
      categoryPercentage: 0.8
    });
  }

  if (state.card2.showBatches) {
    datasets.push({
      label: 'Batches Recorded',
      data: dataItems.map(d => d.batches),
      backgroundColor: '#8B5CF6',
      hoverBackgroundColor: '#7C3AED',
      borderColor: '#7C3AED',
      borderWidth: 1,
      borderRadius: 6,
      barPercentage: 0.7,
      categoryPercentage: 0.8
    });
  }

  if (state.card2.chart) {
    state.card2.chart.destroy();
  }

  state.card2.chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            borderRadius: 3,
            font: { family: 'Inter, sans-serif', size: 11.5, weight: '600' },
            color: '#334155'
          }
        },
        tooltip: {
          backgroundColor: '#0F172A',
          titleFont: { family: 'Inter, sans-serif', size: 13, weight: '700' },
          bodyFont: { family: 'Inter, sans-serif', size: 12 },
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            title: function (context) {
              const idx = context[0].dataIndex;
              return dataItems[idx]?.name || context[0].label;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 45,
            minRotation: 30,
            font: { family: 'Inter, sans-serif', size: 11, weight: '600' },
            color: '#475569',
            callback: function (val) {
              const label = this.getLabelForValue(val) || '';
              return label.length > 13 ? label.slice(0, 11) + '...' : label;
            }
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#F1F5F9' },
          ticks: {
            font: { family: 'Inter, sans-serif', size: 11 },
            color: '#64748B'
          }
        }
      }
    }
  });
}

// ============================================================================
// CARD 3: DISBURSED RAW MATERIALS TREND (BOTTOM RIGHT)
// ============================================================================

function getDisbursedTrendData(timeframe = 'days', selectedMaterial = 'ALL') {
  let records = state.disbursements || [];

  if (selectedMaterial !== 'ALL') {
    records = records.filter(d => (d.materialName || '').toLowerCase() === selectedMaterial.toLowerCase());
  }

  const now = new Date();

  // Generate standardized buckets
  if (timeframe === 'months') {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const months = [];
    const monthKeys = []; // 'YYYY-MM'
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(monthNames[d.getMonth()]);
      const mStr = String(d.getMonth() + 1).padStart(2, '0');
      monthKeys.push(`${d.getFullYear()}-${mStr}`);
    }

    const values = monthKeys.map((mKey, idx) => {
      let sum = 0;
      records.forEach(r => {
        const dStr = String(r.date || r.usage_date || '');
        const qty = Number(r.quantity || r.consumed_quantity || 0);
        if (qty <= 0) return;
        if (dStr.startsWith(mKey)) {
          sum += qty;
        } else if (dStr.toLowerCase().includes(months[idx].toLowerCase())) {
          sum += qty;
        }
      });
      return Math.round(sum * 10) / 10;
    });

    return {
      labels: months,
      values: values
    };
  } else if (timeframe === 'weeks') {
    const weeks = ['4 Weeks Ago', '3 Weeks Ago', '2 Weeks Ago', 'Last Week', 'This Week'];
    const values = [0, 0, 0, 0, 0];
    const nowMs = now.getTime();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    records.forEach(r => {
      const dStr = String(r.date || r.usage_date || '');
      const qty = Number(r.quantity || r.consumed_quantity || 0);
      if (qty <= 0) return;

      if (dStr.includes('Today') || dStr.includes('Yesterday')) {
        values[4] += qty;
        return;
      }

      const parsedDate = new Date(dStr.slice(0, 10));
      if (!isNaN(parsedDate.getTime())) {
        const diffWeeks = Math.floor((nowMs - parsedDate.getTime()) / oneWeekMs);
        if (diffWeeks <= 0) values[4] += qty;
        else if (diffWeeks === 1) values[3] += qty;
        else if (diffWeeks === 2) values[2] += qty;
        else if (diffWeeks === 3) values[1] += qty;
        else if (diffWeeks >= 4 && diffWeeks <= 5) values[0] += qty;
      }
    });

    return { labels: weeks, values: values.map(v => Math.round(v * 10) / 10) };
  } else {
    // Default: 'days' (Past 7 days up to Today)
    const days = [];
    const isoDates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      isoDates.push(d.toISOString().slice(0, 10));
      if (i === 0) {
        days.push('Today');
      } else if (i === 1) {
        days.push('Yesterday');
      } else {
        days.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      }
    }

    const values = isoDates.map((iso, idx) => {
      let sum = 0;
      records.forEach(r => {
        const dStr = String(r.date || r.usage_date || r.disbursement_date || '');
        const qty = Number(r.quantity || r.consumed_quantity || 0);
        if (qty <= 0) return;
        if (dStr.startsWith(iso) || (idx === 6 && dStr.includes('Today')) || (idx === 5 && dStr.includes('Yesterday'))) {
          sum += qty;
        }
      });
      return Math.round(sum * 10) / 10;
    });

    return { labels: days, values: values };
  }
}

function renderCard3() {
  const canvas = document.getElementById('anDisbursedTrendChartCanvas');
  const emptyBox = document.getElementById('anTrendChartEmpty');
  if (!canvas) return;

  const trendData = getDisbursedTrendData(state.card3.timeframe, state.card3.selectedMaterial);

  const matLabel = state.card3.selectedMaterial === 'ALL'
    ? 'All Materials'
    : state.card3.selectedMaterial;

  const hasData = Array.isArray(trendData.values) && trendData.values.some(v => v > 0);

  if (!hasData) {
    canvas.style.display = 'none';
    if (emptyBox) emptyBox.style.display = 'flex';
    if (state.card3.chart) {
      state.card3.chart.destroy();
      state.card3.chart = null;
    }
    return;
  }

  canvas.style.display = 'block';
  if (emptyBox) emptyBox.style.display = 'none';

  if (state.card3.chart) {
    state.card3.chart.destroy();
  }

  // Create subtle green gradient fill
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0, 'rgba(22, 163, 74, 0.22)');
  gradient.addColorStop(1, 'rgba(22, 163, 74, 0.00)');

  state.card3.chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: trendData.labels,
      datasets: [{
        label: `${matLabel} Consumed (kg)`,
        data: trendData.values,
        borderColor: '#16A34A',
        borderWidth: 2.5,
        backgroundColor: gradient,
        fill: true,
        tension: 0.35, // Smooth spline
        pointBackgroundColor: '#FFFFFF',
        pointBorderColor: '#16A34A',
        pointBorderWidth: 2.2,
        pointRadius: 4.5,
        pointHoverRadius: 6.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            borderRadius: 3,
            font: { family: 'Inter, sans-serif', size: 11.5, weight: '600' },
            color: '#334155'
          }
        },
        tooltip: {
          backgroundColor: '#0F172A',
          titleFont: { family: 'Inter, sans-serif', size: 13, weight: '700' },
          bodyFont: { family: 'Inter, sans-serif', size: 12 },
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: function (context) {
              return ` Consumed: ${context.raw} kg`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { family: 'Inter, sans-serif', size: 11.5, weight: '600' },
            color: '#475569'
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#F1F5F9' },
          ticks: {
            font: { family: 'Inter, sans-serif', size: 11 },
            color: '#64748B',
            callback: function (val) {
              return val + ' kg';
            }
          }
        }
      }
    }
  });
}

function renderAllCharts() {
  renderCard1();
  renderCardStock();
  renderCard2();
  renderCard3();
}

// ============================================================================
// MAXIMIZE MODAL SCREEN POPUP (REFERENCE IMAGE 4)
// ============================================================================

function bindModalEvents() {
  const modal = document.getElementById('anMaximizeModal');
  const btnClose = document.getElementById('anCloseMaximizeModal');

  if (btnClose) {
    btnClose.addEventListener('click', closeMaximizeModal);
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeMaximizeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMaximizeModal();
  });
}

function openMaximizeModal(targetType) {
  const modal = document.getElementById('anMaximizeModal');
  const titleEl = document.getElementById('anModalTitle');
  const subEl = document.getElementById('anModalSubtitle');
  if (!modal) return;

  state.modal.activeTarget = targetType;
  modal.classList.add('open');

  if (targetType === 'raw_materials') {
    if (titleEl) titleEl.textContent = 'Enlarged View: Top Raw Materials Ranking (Full Catalog Inspection)';
    if (subEl) subEl.textContent = 'Complete un-truncated comparison of inward deliveries vs outward consumption.';
  } else if (targetType === 'stock_levels') {
    if (titleEl) titleEl.textContent = 'Enlarged View: Raw Materials Stock Levels & Inventory Health';
    if (subEl) subEl.textContent = 'Authoritative stock ledger of on-hand physical stock vs minimum replenishment buffer.';
  } else if (targetType === 'finished_products') {
    if (titleEl) titleEl.textContent = 'Enlarged View: Top Finished Products Production Usage';
    if (subEl) subEl.textContent = 'Comprehensive product ranking across all recorded manufacturing batches.';
  } else {
    if (titleEl) titleEl.textContent = 'Enlarged View: Disbursed Raw Materials Trend';
    if (subEl) subEl.textContent = 'High-resolution consumption timeline across days, weeks, and months.';
  }

  renderModalChart(targetType);
}

function closeMaximizeModal() {
  const modal = document.getElementById('anMaximizeModal');
  if (modal) modal.classList.remove('open');
  if (state.modal.chart) {
    state.modal.chart.destroy();
    state.modal.chart = null;
  }
  state.modal.activeTarget = null;
}

function renderModalChart(targetType) {
  const canvas = document.getElementById('anModalChartCanvas');
  const tableContainer = document.getElementById('anModalTableContainer');
  if (!canvas) return;

  if (state.modal.chart) {
    state.modal.chart.destroy();
    state.modal.chart = null;
  }

  if (targetType === 'raw_materials') {
    // Show top 25 without truncation
    const dataItems = getTopRawMaterialsData(25);
    const labels = dataItems.map(d => d.name);

    state.modal.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Received',
            data: dataItems.map(d => Math.round(d.received * 10) / 10),
            backgroundColor: '#16A34A',
            borderRadius: 6
          },
          {
            label: 'Disbursed',
            data: dataItems.map(d => Math.round(d.disbursed * 10) / 10),
            backgroundColor: '#F59E0B',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 30,
              font: { family: 'Inter, sans-serif', size: 12, weight: '600' }
            }
          }
        }
      }
    });

    if (tableContainer) {
      tableContainer.innerHTML = `
        <table class="ca-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:#F8FAFC; text-align:left; border-bottom:1.5px solid #E2E8F0;">
              <th style="padding:10px 14px;">Raw Material</th>
              <th style="padding:10px 14px;">Total Received</th>
              <th style="padding:10px 14px;">Total Disbursed</th>
              <th style="padding:10px 14px;">Unit</th>
              <th style="padding:10px 14px;">Flow Ratio</th>
            </tr>
          </thead>
          <tbody>
            ${dataItems.map(d => {
              const flow = (d.received + d.disbursed);
              const recPct = flow > 0 ? Math.round((d.received / flow) * 100) : 0;
              return `
                <tr style="border-bottom:1px solid #F1F5F9;">
                  <td style="padding:10px 14px; font-weight:700;">${d.name}</td>
                  <td style="padding:10px 14px; color:#15803D; font-weight:700;">+${d.received.toFixed(1)} ${d.unit}</td>
                  <td style="padding:10px 14px; color:#D97706; font-weight:700;">-${d.disbursed.toFixed(1)} ${d.unit}</td>
                  <td style="padding:10px 14px; color:#64748B;">${d.unit}</td>
                  <td style="padding:10px 14px;">
                    <span style="font-size:12px; font-weight:600; color:#334155;">${recPct}% Inward</span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }
  } else if (targetType === 'stock_levels') {
    const dataItems = getTopStockData(30);
    const labels = dataItems.map(d => d.name);

    state.modal.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Current Stock',
            data: dataItems.map(d => Math.round(d.currentStock * 10) / 10),
            backgroundColor: '#16A34A',
            borderRadius: 6
          },
          {
            label: 'Minimum Buffer',
            data: dataItems.map(d => Math.round(d.minThreshold * 10) / 10),
            backgroundColor: '#EA580C',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 30,
              font: { family: 'Inter, sans-serif', size: 12, weight: '600' }
            }
          },
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(val) { return val + ' kg'; }
            }
          }
        }
      }
    });

    if (tableContainer) {
      tableContainer.innerHTML = `
        <table class="ca-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:#F8FAFC; text-align:left; border-bottom:1.5px solid #E2E8F0;">
              <th style="padding:10px 14px;">Raw Material</th>
              <th style="padding:10px 14px;">Category</th>
              <th style="padding:10px 14px;">Current Stock</th>
              <th style="padding:10px 14px;">Minimum Buffer</th>
              <th style="padding:10px 14px;">Buffer Surplus / Deficit</th>
              <th style="padding:10px 14px;">Inventory Status</th>
            </tr>
          </thead>
          <tbody>
            ${dataItems.map(d => {
              const badgeBg = d.status === 'Healthy' ? '#DCFCE7' : (d.status === 'Critical' || d.status === 'Out of Stock' ? '#FEE2E2' : '#FEF3C7');
              const badgeColor = d.status === 'Healthy' ? '#15803D' : (d.status === 'Critical' || d.status === 'Out of Stock' ? '#B91C1C' : '#B45309');
              const diffText = d.diff >= 0 ? `+${d.diff.toFixed(1)} ${d.unit}` : `${d.diff.toFixed(1)} ${d.unit}`;
              return `
                <tr style="border-bottom:1px solid #F1F5F9;">
                  <td style="padding:10px 14px; font-weight:700;">${d.name}</td>
                  <td style="padding:10px 14px; color:#64748B;">${d.category}</td>
                  <td style="padding:10px 14px; color:#15803D; font-weight:700;">${d.currentStock.toFixed(1)} ${d.unit}</td>
                  <td style="padding:10px 14px; color:#EA580C; font-weight:700;">${d.minThreshold.toFixed(1)} ${d.unit}</td>
                  <td style="padding:10px 14px; font-weight:600; color:${d.diff >= 0 ? '#15803D' : '#DC2626'};">${diffText}</td>
                  <td style="padding:10px 14px;">
                    <span style="display:inline-block; padding:3px 9px; border-radius:9999px; font-size:11.5px; font-weight:700; background:${badgeBg}; color:${badgeColor};">
                      ${d.status}
                    </span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }
  } else if (targetType === 'finished_products') {
    const dataItems = getTopFinishedProductsData(20);
    const labels = dataItems.map(d => d.name);

    state.modal.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Consumed (kg/L)',
            data: dataItems.map(d => Math.round(d.consumed * 10) / 10),
            backgroundColor: '#2563EB',
            borderRadius: 6
          },
          {
            label: 'Batches Recorded',
            data: dataItems.map(d => d.batches),
            backgroundColor: '#8B5CF6',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 30,
              font: { family: 'Inter, sans-serif', size: 12, weight: '600' }
            }
          }
        }
      }
    });

    if (tableContainer) {
      tableContainer.innerHTML = `
        <table class="ca-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:#F8FAFC; text-align:left; border-bottom:1.5px solid #E2E8F0;">
              <th style="padding:10px 14px;">Finished Product</th>
              <th style="padding:10px 14px;">Consumed Materials</th>
              <th style="padding:10px 14px;">Batches Recorded</th>
            </tr>
          </thead>
          <tbody>
            ${dataItems.map(p => `
              <tr style="border-bottom:1px solid #F1F5F9;">
                <td style="padding:10px 14px; font-weight:700;">${p.name}</td>
                <td style="padding:10px 14px; color:#2563EB; font-weight:700;">${p.consumed.toFixed(1)} kg/L</td>
                <td style="padding:10px 14px; color:#7C3AED; font-weight:700;">${p.batches} batches</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } else {
    // Disbursed Trend Modal
    const trendData = getDisbursedTrendData(state.card3.timeframe, state.card3.selectedMaterial);
    const matLabel = state.card3.selectedMaterial === 'ALL' ? 'All Materials' : state.card3.selectedMaterial;
    const selMat = state.materials.find(m => m.name === state.card3.selectedMaterial);
    const unitStr = selMat ? (selMat.unit_of_measure || selMat.unit || '') : '';

    state.modal.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: trendData.labels,
        datasets: [{
          label: `${matLabel} Consumed${unitStr ? ' (' + unitStr + ')' : ''}`,
          data: trendData.values,
          borderColor: '#16A34A',
          borderWidth: 3,
          backgroundColor: 'rgba(22, 163, 74, 0.18)',
          fill: true,
          tension: 0.35,
          pointRadius: 5.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });

    if (tableContainer) {
      tableContainer.innerHTML = `
        <table class="ca-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:#F8FAFC; text-align:left; border-bottom:1.5px solid #E2E8F0;">
              <th style="padding:10px 14px;">Period Point</th>
              <th style="padding:10px 14px;">Disbursed Quantity</th>
            </tr>
          </thead>
          <tbody>
            ${trendData.labels.map((lbl, i) => `
              <tr style="border-bottom:1px solid #F1F5F9;">
                <td style="padding:10px 14px; font-weight:600;">${lbl}</td>
                <td style="padding:10px 14px; color:#15803D; font-weight:700;">${trendData.values[i]}${unitStr ? ' ' + unitStr : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  }
}
