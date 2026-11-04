// js/rmims-forecast-gauges.js
//
// "Forecast data" card: ONE bar chart.
//   * black bars - recorded usage per day (last 7 days) / week (last 4 weeks) / month (last 3 months)
//   * green bars - forecast need for the next 7 days / 4 weeks / 3 months
// Each bar shows its number on top; the y-axis is the quantity in the selected material's own unit.
// Under the chart: one plain sentence with what to order. Everything comes from recorded disbursements via
// rmims-reorder-engine - nothing built in.

import { buildActualsForMaterial, forecastHorizon, roundQty } from './rmims-reorder-engine.js';

const HORIZON_DAYS = { daily: 1, weekly: 7, monthly: 30 };
const START = 150;   // degrees (SVG, clockwise from +x): bottom-left
const SWEEP = 240;   // through the top to bottom-right
const CX = 120, CY = 118, R = 92;

function injectStyles() {
  if (document.getElementById('rmimsGaugeStyles')) return;
  const st = document.createElement('style');
  st.id = 'rmimsGaugeStyles';
  st.textContent = `
  .rg-wrap{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;width:100%}
  @media (max-width:560px){.rg-wrap{grid-template-columns:1fr}}
  .rg-card{position:relative;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;padding:12px 12px 14px;display:flex;flex-direction:column;align-items:center;min-width:0}
  .rg-title{display:flex;align-items:center;gap:8px;font:700 12.5px/1.2 Inter,system-ui,sans-serif;color:#0F172A;letter-spacing:.01em;align-self:flex-start}
  .rg-swatch{width:10px;height:10px;border-radius:3px;flex:0 0 auto}
  .rg-period{margin-left:auto;font:600 11px/1 Inter,system-ui,sans-serif;color:#64748B;background:#F1F5F9;border-radius:999px;padding:4px 8px;white-space:nowrap}
  .rg-svg{width:100%;max-width:280px;height:auto;display:block;margin-top:4px;overflow:visible}
  .rg-needle{transition:transform .9s cubic-bezier(.22,1.2,.36,1);transform-origin:${CX}px ${CY}px;transform-box:view-box}
  .rg-progress{transition:stroke-dashoffset .9s cubic-bezier(.22,1,.36,1)}
  .rg-value{font:800 26px/1 Inter,system-ui,sans-serif;fill:#0F172A}
  .rg-unit{font:600 12px/1 Inter,system-ui,sans-serif;fill:#64748B}
  .rg-tick{font:600 9.5px/1 Inter,system-ui,sans-serif;fill:#94A3B8}
  .rg-under{margin-top:2px;text-align:center;font:600 12.5px/1.35 Inter,system-ui,sans-serif;color:#334155}
  .rg-under strong{color:#0F172A}
  .rg-moe{display:inline-block;margin-left:4px;font-weight:700;color:#475569;background:#F1F5F9;border-radius:6px;padding:1px 6px}
  .rg-note{margin-top:4px;text-align:center;font:500 11.5px/1.35 Inter,system-ui,sans-serif;color:#64748B}
  .rg-empty .rg-value{fill:#94A3B8}
  .rg-tip{position:absolute;pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .15s,transform .15s;background:#0F2A1B;color:#fff;border-radius:8px;padding:8px 10px;font:500 12px/1.4 Inter,system-ui,sans-serif;z-index:5;max-width:240px;box-shadow:0 8px 20px rgba(15,23,42,.18)}
  .rg-card:hover .rg-tip,.rg-card:focus-within .rg-tip{opacity:1;transform:none}
  .rg-tip b{font-weight:700}
  .rg-foot{grid-column:1/-1;font:500 11.5px/1.4 Inter,system-ui,sans-serif;color:#64748B;text-align:center}
  .rg-chart-card{display:flex;flex-direction:column;gap:8px;width:100%}
  .rg-legend{display:flex;flex-wrap:wrap;gap:14px;font:700 12px/1.2 Inter,system-ui,sans-serif;color:#0F172A}
  .rg-legend span{display:inline-flex;align-items:center;gap:6px}
  .rg-legend i{width:11px;height:11px;border-radius:3px;display:inline-block}
  .rg-chart-box{position:relative;width:100%;height:280px}
  .rg-summary{font:500 12.5px/1.45 Inter,system-ui,sans-serif;color:#334155}
  .rg-summary strong{color:#0F172A}
  .rg-muted{color:#64748B}
  `;
  document.head.appendChild(st);
}

const rad = (a) => (a * Math.PI) / 180;
const pt = (a, r = R) => [CX + r * Math.cos(rad(a)), CY + r * Math.sin(rad(a))];
function arcPath(a0, a1, r = R) {
  const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function niceMax(v) {
  if (!(v > 0)) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}
const fmt = (v) => {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: a < 10 ? 2 : 1 });
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function gaugeSvg({ value, moe, max, color, empty, unit }) {
  const frac = (v) => Math.max(0, Math.min(1, (v || 0) / max));
  const angle = START + SWEEP * frac(value);
  const lo = START + SWEEP * frac((value || 0) - (moe || 0));
  const hi = START + SWEEP * frac((value || 0) + (moe || 0));
  const fullLen = (Math.PI * R * SWEEP) / 180;
  const ticks = [];
  for (let i = 0; i <= 20; i++) {
    const a = START + (SWEEP * i) / 20;
    const major = i % 5 === 0;
    const [x0, y0] = pt(a, R - 14), [x1, y1] = pt(a, R - (major ? 24 : 19));
    ticks.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${major ? '#94A3B8' : '#CBD5E1'}" stroke-width="${major ? 2 : 1.2}" stroke-linecap="round"/>`);
    if (major) {
      const [tx, ty] = pt(a, R - 36);
      ticks.push(`<text class="rg-tick" x="${tx.toFixed(1)}" y="${(ty + 3).toFixed(1)}" text-anchor="middle">${fmt((max * i) / 20)}</text>`);
    }
  }
  const needleAngle = empty ? START : angle;
  return `
  <svg class="rg-svg" viewBox="0 0 240 200" role="img" aria-hidden="true">
    <path d="${arcPath(START, START + SWEEP)}" fill="none" stroke="#EEF2F6" stroke-width="14" stroke-linecap="round"/>
    ${!empty && moe > 0 ? `<path d="${arcPath(lo, Math.max(hi, lo + 0.5))}" fill="none" stroke="${color}" stroke-opacity=".22" stroke-width="22" stroke-linecap="butt"/>` : ''}
    <path class="rg-progress" d="${arcPath(START, START + SWEEP)}" fill="none" stroke="${empty ? '#E2E8F0' : color}" stroke-width="14" stroke-linecap="round"
          stroke-dasharray="${fullLen.toFixed(2)}" stroke-dashoffset="${(fullLen * (1 - (empty ? 0 : frac(value)))).toFixed(2)}"/>
    ${ticks.join('')}
    <g class="rg-needle" style="transform: rotate(${needleAngle.toFixed(2)}deg)">
      <path d="M ${CX - 6} ${CY} L ${CX + R - 22} ${CY - 1.2} L ${CX + R - 22} ${CY + 1.2} Z" fill="#0F172A"/>
      <path d="M ${CX} ${CY - 4} L ${CX + R - 20} ${CY} L ${CX} ${CY + 4} Z" fill="#0F172A"/>
    </g>
    <circle cx="${CX}" cy="${CY}" r="9" fill="#0F172A"/>
    <circle cx="${CX}" cy="${CY}" r="3.5" fill="${empty ? '#CBD5E1' : color}"/>
    <text class="rg-value" x="${CX}" y="${CY + 44}" text-anchor="middle">${empty ? '—' : esc(fmt(value))}</text>
    <text class="rg-unit" x="${CX}" y="${CY + 62}" text-anchor="middle">${esc(unit || '')}</text>
  </svg>`;
}

/** Collect per-material figures for the period. */
function computeFigures({ materials, disbursements, selectedId, horizon, asOf }) {
  const days = HORIZON_DAYS[horizon] || 1;
  const base = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const pastKeys = new Set();
  for (let i = 0; i < days; i++) pastKeys.add(key(new Date(base.getFullYear(), base.getMonth(), base.getDate() - i)));

  const isAll = !selectedId || selectedId === 'ALL';
  const targets = isAll ? materials : materials.filter(m => m.id === selectedId);

  // Aggregate only one unit (the most common one) so grams are never added to pieces.
  const unitCount = new Map();
  targets.forEach(m => unitCount.set(m.unit || '', (unitCount.get(m.unit || '') || 0) + 1));
  const unit = isAll ? [...unitCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '' : (targets[0]?.unit || '');

  let usage = 0, usageMoe = 0, reorder = 0, reorderMoe = 0, need = 0, needMoe = 0, onHand = 0, minStock = 0;
  let withData = 0, skippedUnit = 0;
  targets.forEach(m => {
    if ((m.unit || '') !== unit) { skippedUnit++; return; }
    const actuals = buildActualsForMaterial(m, disbursements);
    let used = 0;
    pastKeys.forEach(k => { used += actuals.get(k) || 0; });
    const fc = forecastHorizon(m, actuals, days, { asOf });
    usage += used;
    usageMoe += used * (fc.mapePct / 100);
    if (!fc.hasData) return;
    withData++;
    const stock = Math.max(0, Number(m.currentStock) || 0);
    const min = Math.max(0, Number(m.minStock ?? m.minThreshold) || 0);
    const r = Math.max(0, fc.requirement + min - stock);
    need += fc.expected; needMoe += fc.half;
    onHand += stock; minStock += min;
    reorder += r;
    if (r > 0) reorderMoe += fc.half;
  });
  return {
    days, unit, isAll, targetCount: targets.length, withData, skippedUnit,
    usage: roundQty(usage, unit) || 0, usageMoe: roundQty(usageMoe, unit) || 0,
    reorder: withData ? roundQty(reorder, unit) : null, reorderMoe: roundQty(reorderMoe, unit) || 0,
    need: roundQty(need, unit) || 0, needMoe: roundQty(needMoe, unit) || 0,
    onHand: roundQty(onHand, unit) || 0, minStock: roundQty(minStock, unit) || 0,
    name: isAll ? 'All raw materials' : (targets[0]?.name || '')
  };
}

/** Periods shown as bars: past (recorded usage) and future (forecast need), per horizon. */
function buildPeriods(horizon, base) {
  const day = (n) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  const md = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const past = [], future = [];
  if (horizon === 'monthly') {
    for (let i = 2; i >= 0; i--) {                       // this month and the 2 before (calendar months)
      const s = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const e = i === 0 ? base : new Date(base.getFullYear(), base.getMonth() - i + 1, 0);
      past.push({ label: s.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), from: s, to: e });
    }
    for (let k = 0; k < 3; k++) {                        // next 3 blocks of 30 days, named by their month
      const s = day(1 + k * 30), e = day((k + 1) * 30);
      future.push({ label: `${md(s)} – ${md(e)}`, startOffset: 1 + k * 30, days: 30 });
    }
  } else if (horizon === 'weekly') {
    for (let i = 3; i >= 0; i--) {                       // the last 4 weeks (7-day blocks ending today)
      const s = day(-i * 7 - 6), e = day(-i * 7);
      past.push({ label: `${md(s)} – ${md(e)}`, from: s, to: e });
    }
    for (let k = 0; k < 4; k++) {                        // the next 4 weeks
      const s = day(1 + k * 7), e = day((k + 1) * 7);
      future.push({ label: `${md(s)} – ${md(e)}`, startOffset: 1 + k * 7, days: 7 });
    }
  } else {
    for (let i = 6; i >= 0; i--) { const d = day(-i); past.push({ label: md(d), from: d, to: d }); }   // last 7 days
    for (let k = 1; k <= 7; k++) { future.push({ label: md(day(k)), startOffset: k, days: 1 }); }      // next 7 days
  }
  return { past, future };
}

let chartInstance = null;

/**
 * Forecast data as ONE bar chart: recorded usage per day / week / month (black bars) and the forecast need for the
 * coming days / weeks / months (green bars), each bar with its number on top, the y-axis in the material's own unit.
 * @param {HTMLElement|string} container
 * @param {{materials:Array, disbursements:Array, selectedId:string, horizon:'daily'|'weekly'|'monthly', asOf?:Date}} opts
 */
export function renderForecastGauges(container, opts) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return null;
  injectStyles();
  const asOf = opts.asOf || new Date();
  const base = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const horizon = opts.horizon || 'daily';
  const disb = (opts.disbursements || []).map(d => ({
    materialId: d.materialId, item_code: d.itemCode, materialName: d.materialName,
    quantity: d.consumedQuantity ?? d.quantity, usageDate: d.usageDate || d.createdAt
  }));
  const f = computeFigures({ materials: opts.materials || [], disbursements: disb, selectedId: opts.selectedId, horizon, asOf });

  // per-period values, only materials in the shown unit (grams are never added to pieces)
  const isAll = !opts.selectedId || opts.selectedId === 'ALL';
  const targets = (isAll ? (opts.materials || []) : (opts.materials || []).filter(m => m.id === opts.selectedId))
    .filter(m => (m.unit || '') === f.unit);
  const { past, future } = buildPeriods(horizon, base);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const pastVals = past.map(() => 0);
  const futVals = future.map(() => 0);
  let anyForecast = false;
  targets.forEach(m => {
    const actuals = buildActualsForMaterial(m, disb);
    past.forEach((p, i) => {
      for (let d = new Date(p.from); d <= p.to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) pastVals[i] += actuals.get(key(d)) || 0;
    });
    // forecast need of each future period = total(up to its end) - total(up to its start)
    const cum = (n) => (n <= 0 ? 0 : (forecastHorizon(m, actuals, n, { asOf }).expected || 0));
    const fc = forecastHorizon(m, actuals, 1, { asOf });
    if (!fc.hasData) return;
    anyForecast = true;
    future.forEach((p, i) => { futVals[i] += cum(p.startOffset - 1 + p.days) - cum(p.startOffset - 1); });
  });
  const unit = f.unit || '';
  const r = (v) => Number(roundQty(v, unit) || 0);
  const labels = [...past.map(p => p.label), ...future.map(p => p.label)];
  const usageData = [...pastVals.map(r), ...future.map(() => null)];
  const needData = [...past.map(() => null), ...futVals.map(v => (anyForecast ? r(v) : null))];
  const futLbl = { daily: 'next 7 days', weekly: 'next 4 weeks', monthly: 'next 3 months' }[horizon];
  const reorderLbl = { daily: 'tomorrow', weekly: 'the next 7 days', monthly: 'the next 30 days' }[horizon];

  el.innerHTML = `
    <div class="rg-chart-card">
      <div class="rg-legend">
        <span><i style="background:#11161B"></i>Recorded usage</span>
        <span><i style="background:#16A34A"></i>Forecast need (${futLbl})</span>
      </div>
      <div class="rg-chart-box"><canvas aria-label="Recorded usage and forecast need of ${esc(f.name)}"></canvas></div>
      <div class="rg-summary">${!anyForecast
        ? `<strong>${esc(f.name)}</strong>: no recorded usage yet, so there is no forecast. Record disbursements to start it.`
        : (f.reorder > 0
          ? `<strong>${esc(f.name)}</strong>: order <strong>${fmt(f.reorder)} ${esc(unit)}</strong> to cover ${reorderLbl} (on hand ${fmt(f.onHand)} ${esc(unit)}, minimum ${fmt(f.minStock)} ${esc(unit)}).`
          : `<strong>${esc(f.name)}</strong>: stock on hand (${fmt(f.onHand)} ${esc(unit)}) covers ${reorderLbl}. Nothing to order.`)}${f.isAll && f.skippedUnit
        ? ` <span class="rg-muted">${f.skippedUnit} material${f.skippedUnit === 1 ? '' : 's'} in other units are not added to this ${esc(unit)} total.</span>` : ''}</div>
    </div>`;

  const ChartClass = window.Chart;
  const canvas = el.querySelector('canvas');
  if (chartInstance) { try { chartInstance.destroy(); } catch (_) {} chartInstance = null; }
  if (ChartClass && canvas) {
    chartInstance = new ChartClass(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Recorded usage', data: usageData, backgroundColor: '#11161B', borderRadius: 6, maxBarThickness: 46, skipNull: true },
          { label: 'Forecast need', data: needData, backgroundColor: '#16A34A', borderRadius: 6, maxBarThickness: 46, skipNull: true }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)} ${unit}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11, weight: '600' }, color: '#475569', maxRotation: 40, autoSkip: false } },
          y: { beginAtZero: true, grid: { color: '#F1F5F9' }, title: { display: Boolean(unit), text: unit, font: { weight: '700' }, color: '#334155' },
               ticks: { color: '#64748B', callback: (v) => Number(v).toLocaleString() } }
        }
      }
    });
  }
  return f;
}
