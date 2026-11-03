// js/rmims-disburse-lines.js
//
// Analytics: "Disbursed Quantity by Raw Material" line chart.
//   General          -> one line: all raw materials combined (total disbursed per day / week / month)
//   Top Raw Materials-> one line per material, the N with the most disbursed in the range (Lines: N)
//   <a material>     -> that material only
// Data = the recorded disbursements (same shared ledger as Reports / Forecasting / Dashboards).
// Colours: fixed categorical order (validated palette); a material keeps its colour while you filter.
// More than 8 materials fold into "Other materials" so every line stays distinguishable.

import { readRecordedDisbursements } from './rmims-reorder-engine.js';
import { getSystemRawMaterials } from './system-materials.js';
import { attachSearchableCombobox } from './rmims-combobox.js';

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER_COLOR = '#94A3B8';
const GENERAL_COLOR = '#15803D';
const MAX_LINES = 8;

const st = { mode: 'GENERAL', topN: 5, tf: 'days', preset: '30', from: null, to: null };
let chart = null;
const colorOf = new Map();

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function parseDate(v) {
  if (!v) return null;
  const s = String(v).split(' • ')[0];
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
  return isNaN(d.getTime()) ? null : dayStart(d);
}

function materials() {
  const list = getSystemRawMaterials() || [];
  const byKey = new Map();
  list.forEach(m => {
    const name = m.name || m.raw_material_name;
    if (!name) return;
    const rec = { name, unit: m.unit_of_measure || m.unit || '', code: String(m.item_code || m.id || '').toUpperCase() };
    [m.id, m.item_code, m.itemCode, name].filter(Boolean).forEach(k => byKey.set(String(k).toLowerCase().trim(), rec));
  });
  return { list, byKey };
}

/** [{name, unit, date, qty}] from the recorded disbursements */
function records() {
  const { byKey } = materials();
  const out = [];
  readRecordedDisbursements().forEach(d => {
    const id = String(d.materialId ?? d.material_id ?? d.item_code ?? '').toLowerCase().trim();
    const nm = String(d.materialName ?? d.material_name ?? '').toLowerCase().trim();
    const m = byKey.get(id) || byKey.get(nm);
    const name = m ? m.name : (d.materialName || d.material_name);
    const date = parseDate(d.usage_date ?? d.usageDate ?? d.date ?? d.created_at);
    const qty = Number(d.consumed_quantity ?? d.consumedQuantity ?? d.quantity ?? 0);
    if (!name || !date || !(qty > 0)) return;
    out.push({ name, unit: m ? m.unit : (d.unit || ''), date, qty });
  });
  return out;
}

function range(recs) {
  const today = dayStart(new Date());
  if (st.preset === 'custom' && st.from && st.to) return [dayStart(st.from), dayStart(st.to)];
  if (st.preset === 'all') {
    const first = recs.reduce((m, r) => (!m || r.date < m ? r.date : m), null) || today;
    return [first, today];
  }
  const n = Number(st.preset) || 30;
  return [new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1)), today];
}

function buckets(from, to) {
  const out = [];
  if (st.tf === 'days') {
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const s = new Date(d);
      out.push({ key: ymd(s), start: s, end: s, label: s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
    }
  } else if (st.tf === 'weeks') {
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 7)) {
      const s = new Date(d);
      const e = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
      const ee = e > to ? new Date(to) : e;
      out.push({ key: ymd(s), start: s, end: ee, label: `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${ee.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` });
    }
  } else {
    for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d.setMonth(d.getMonth() + 1)) {
      const s = new Date(Math.max(d.getTime(), from.getTime()));
      const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      out.push({ key: ymd(d), start: dayStart(s), end: e > to ? new Date(to) : e, label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) });
    }
  }
  return out;
}

function stableColor(name) {
  if (!colorOf.has(name)) colorOf.set(name, PALETTE[colorOf.size % PALETTE.length]);
  return colorOf.get(name);
}

function render() {
  const canvas = document.getElementById('anDisburseLinesCanvas');
  if (!canvas || typeof Chart === 'undefined') return;
  const all = records();
  const [from, to] = range(all);
  const inRange = all.filter(r => r.date >= from && r.date <= to);
  const bks = buckets(from, to);
  const sumFor = (rows) => bks.map(b => rows.filter(r => r.date >= b.start && r.date <= b.end).reduce((t, r) => t + r.qty, 0));

  // Fix colours in order of all-time disbursed quantity, so a material keeps its colour across filters
  const allTotals = new Map();
  all.forEach(r => allTotals.set(r.name, (allTotals.get(r.name) || 0) + r.qty));
  [...allTotals.entries()].sort((a, b) => b[1] - a[1]).forEach(([n]) => stableColor(n));

  let series = [];
  if (st.mode === 'GENERAL') {
    const units = new Set(inRange.map(r => r.unit).filter(Boolean));
    series.push({ name: 'All raw materials (combined)', color: GENERAL_COLOR, data: sumFor(inRange), unit: units.size === 1 ? [...units][0] : 'mixed units' });
  } else if (st.mode === 'TOP') {
    const totals = new Map();
    inRange.forEach(r => totals.set(r.name, (totals.get(r.name) || 0) + r.qty));
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const n = Math.max(1, st.topN);
    const shown = ranked.slice(0, Math.min(n, MAX_LINES));
    const unitOf = (name) => (inRange.find(r => r.name === name) || {}).unit || '';
    shown.forEach(name => series.push({ name, color: stableColor(name), data: sumFor(inRange.filter(r => r.name === name)), unit: unitOf(name) }));
    const rest = ranked.slice(shown.length, n);
    if (rest.length) {
      series.push({ name: `Other materials (${rest.length})`, color: OTHER_COLOR, data: sumFor(inRange.filter(r => rest.includes(r.name))), unit: 'mixed units', dashed: true });
    }
  } else {
    const rows = inRange.filter(r => r.name === st.mode);
    series.push({ name: st.mode, color: stableColor(st.mode), data: sumFor(rows), unit: (rows[0] || all.find(r => r.name === st.mode) || {}).unit || '' });
  }

  const empty = inRange.length === 0;
  const emptyEl = document.getElementById('anDisburseLinesEmpty');
  if (emptyEl) emptyEl.style.display = empty ? 'flex' : 'none';

  const datasets = series.map(s => ({
    label: s.name,
    data: s.data,
    borderColor: s.color,
    backgroundColor: s.color,
    borderWidth: 2,
    borderDash: s.dashed ? [5, 4] : undefined,
    pointRadius: bks.length > 45 ? 0 : 3,
    pointHoverRadius: 6,
    pointBackgroundColor: s.color,
    pointBorderColor: '#FFFFFF',
    pointBorderWidth: 2,
    tension: 0.3,
    cubicInterpolationMode: 'monotone',
    fill: false,
    _unit: s.unit
  }));

  if (chart) chart.destroy();
  chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: bks.map(b => b.label), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0F2A1B', padding: 10, cornerRadius: 8,
          titleFont: { family: 'Inter', size: 12, weight: '700' }, bodyFont: { family: 'Inter', size: 12 },
          callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}${c.dataset._unit && c.dataset._unit !== 'mixed units' ? ' ' + c.dataset._unit : ''}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5C7A68', font: { family: 'Inter', size: 11 }, autoSkip: true, maxRotation: 45, minRotation: 0 } },
        y: { beginAtZero: true, grid: { color: 'rgba(20, 83, 45, 0.07)' }, ticks: { color: '#5C7A68', font: { family: 'Inter', size: 11 } },
             title: { display: true, text: 'Quantity disbursed', color: '#5C7A68', font: { family: 'Inter', size: 11, weight: '600' } } }
      }
    }
  });

  // Legend with each line's total in the range (identity is never colour-only)
  const legend = document.getElementById('anDisburseLinesLegend');
  if (legend) {
    legend.innerHTML = empty ? '' : series.map(s => {
      const total = s.data.reduce((a, b) => a + b, 0);
      return `<span style="display:inline-flex; align-items:center; gap:6px;">
        <span style="width:14px; height:3px; border-radius:2px; background:${s.color};${s.dashed ? 'opacity:.7;' : ''}"></span>
        <span>${esc(s.name)}</span>
        <strong style="color:#0F2A1B;">${fmt(total)}${s.unit && s.unit !== 'mixed units' ? ' ' + esc(s.unit) : ''}</strong>
      </span>`;
    }).join('') + (st.mode === 'TOP' && st.topN > MAX_LINES ? `<span style="color:#64748B;">Up to ${MAX_LINES} separate lines; the rest are combined as "Other materials".</span>` : '');
  }
}

function populateMaterials() {
  const sel = document.getElementById('anLinesMaterialSelect');
  if (!sel) return;
  const names = [...new Set((getSystemRawMaterials() || []).map(m => m.name || m.raw_material_name).filter(Boolean))];
  const cur = sel.value || st.mode;
  sel.innerHTML = `<option value="GENERAL">General (All Raw Materials Combined)</option>
    <option value="TOP">Top Raw Materials (one line each)</option>` +
    names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'GENERAL';
  try {
    attachSearchableCombobox(sel, {
      placeholder: 'Search raw material...',
      minWidth: '220px',
      maxWidth: '300px',
      onChange: (val) => { st.mode = val || 'GENERAL'; render(); }
    });
  } catch (_) {}
}

function init() {
  if (!document.getElementById('anCardDisburseLines')) return;
  populateMaterials();

  const sel = document.getElementById('anLinesMaterialSelect');
  if (sel) sel.addEventListener('change', () => { st.mode = sel.value || 'GENERAL'; render(); });

  const top = document.getElementById('anLinesTopCount');
  if (top) top.addEventListener('input', () => {
    top.value = top.value.replace(/\D+/g, '');
    st.topN = Math.max(1, parseInt(top.value, 10) || 1);
    if (st.mode === 'GENERAL') { st.mode = 'TOP'; if (sel) { sel.value = 'TOP'; sel.dispatchEvent(new Event('rmims:sync')); try { sel._rmimsCombobox && sel._rmimsCombobox.sync(); } catch (_) {} } }
    render();
  });

  document.querySelectorAll('.an-lines-tf').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.an-lines-tf').forEach(b => b.classList.toggle('active', b === btn));
    st.tf = btn.dataset.linesTf;
    render();
  }));

  const preset = document.getElementById('anLinesRangePreset');
  const rangeInput = document.getElementById('anLinesDateRange');
  let fp = null;
  if (rangeInput && typeof flatpickr === 'function') {
    fp = flatpickr(rangeInput, {
      mode: 'range', dateFormat: 'M j, Y', maxDate: 'today',
      onChange: (dates) => { if (dates.length === 2) { st.from = dates[0]; st.to = dates[1]; render(); } }
    });
  }
  if (preset) preset.addEventListener('change', () => {
    st.preset = preset.value;
    if (rangeInput) rangeInput.style.display = st.preset === 'custom' ? 'inline-block' : 'none';
    if (st.preset === 'custom' && fp) fp.open();
    render();
  });

  render();

  // Live: new disbursements (this tab, other tabs, Supabase sync)
  let t = null;
  const refresh = () => { clearTimeout(t); t = setTimeout(() => { populateMaterials(); render(); }, 250); };
  window.addEventListener('storage', (e) => { if (!e.key || /disburse|materials/i.test(e.key)) refresh(); });
  ['rmims_live_data_updated', 'rmims_manager_disbursements_updated', 'rmims_inventory_updated'].forEach(ev => window.addEventListener(ev, refresh));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
