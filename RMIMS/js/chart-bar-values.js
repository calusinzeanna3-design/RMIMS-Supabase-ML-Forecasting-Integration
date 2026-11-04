// js/chart-bar-values.js
// Prints each bar's total right above it (or at its end for horizontal bars) in EVERY bar chart of RMIMS,
// so the numbers are readable without hovering. Stacked bars get one total on top of the stack.
// A chart can turn it off with: options.plugins.barValues = false
// Long chart labels are wrapped onto several lines (whole words) instead of being cut with "...".
if (typeof window !== 'undefined' && !window.rmimsWrapLabel) {
  window.rmimsWrapLabel = function (text, maxChars) {
    const max = maxChars || 14;
    const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    words.forEach(w => {
      if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) lines.push(cur);
    return lines.length > 1 ? lines : (lines[0] || '');
  };
}
(function () {
  if (typeof window === 'undefined' || !window.Chart || window.__rmimsBarValuesRegistered) return;
  window.__rmimsBarValuesRegistered = true;

  const fmt = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return '';
    return Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };
  const rawValue = (chart, raw) => {
    if (raw == null) return null;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'object') {
      const horizontal = chart.options.indexAxis === 'y';
      return Number(horizontal ? raw.x : raw.y);
    }
    return Number(raw);
  };
  const isBarChart = (chart) => chart.config.type === 'bar' ||
    (chart.data.datasets || []).some(d => d.type === 'bar');
  const enabled = (chart) => isBarChart(chart) && chart.options.plugins && chart.options.plugins.barValues !== false;

  window.Chart.register({
    id: 'barValues',
    // leave room above the tallest bar for its number
    afterDataLimits(chart, args) {
      if (!enabled(chart)) return;
      const scale = args.scale;
      const valueAxis = chart.options.indexAxis === 'y' ? 'x' : 'y';
      if (!scale || scale.axis !== valueAxis) return;
      const userMax = scale.options && (scale.options.max != null || scale.options.suggestedMax != null);
      if (userMax || !(scale.max > 0)) return;
      scale.max = scale.max * 1.12;
    },
    beforeInit(chart) {
      if (!enabled(chart)) return;
      const pl = chart.options.plugins || (chart.options.plugins = {});
      if (pl.tooltip && pl.tooltip.enabled === false) pl.tooltip.enabled = true;
    },
    afterDatasetsDraw(chart) {
      if (!enabled(chart)) return;
      const { ctx } = chart;
      const horizontal = chart.options.indexAxis === 'y';
      const metas = chart.getSortedVisibleDatasetMetas().filter(m => m.type === 'bar' || chart.config.type === 'bar');
      if (!metas.length) return;
      const stacked = Boolean(chart.options.scales && ((chart.options.scales.x && chart.options.scales.x.stacked) || (chart.options.scales.y && chart.options.scales.y.stacked)));

      ctx.save();
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#0F172A';
      const labels = [];
      const drawLabel = (c, bar, text, hz, ch) => { if (text && !bar.skip) labels.push({ bar, text }); };

      if (stacked) {
        const totals = new Map();
        metas.forEach(meta => meta.data.forEach((bar, i) => {
          const v = rawValue(chart, chart.data.datasets[meta.index].data[i]);
          if (v == null || !isFinite(v)) return;
          const t = totals.get(i) || { sum: 0, bar };
          t.sum += v;
          // the outermost segment holds the label position
          if (horizontal ? bar.x >= t.bar.x : bar.y <= t.bar.y) t.bar = bar;
          totals.set(i, t);
        }));
        totals.forEach(({ sum, bar }) => drawLabel(ctx, bar, fmt(sum), horizontal, chart));
      } else {
        metas.forEach(meta => meta.data.forEach((bar, i) => {
          const v = rawValue(chart, chart.data.datasets[meta.index].data[i]);
          if (v == null || !isFinite(v)) return;
          drawLabel(ctx, bar, fmt(v), horizontal, chart);
        }));
      }
      // Many bars: try a smaller number, then a short number (1.8k); if the numbers would still overlap,
      // none are printed and pointing at a bar shows its number instead.
      const short = (t) => {
        const n = Number(String(t).replace(/,/g, ''));
        if (!isFinite(n) || Math.abs(n) < 1000) return t;
        const k = Math.abs(n) >= 1e6 ? [1e6, 'M'] : [1e3, 'k'];
        return (n / k[0]).toLocaleString(undefined, { maximumFractionDigits: 1 }) + k[1];
      };
      const overlaps = (items) => {
        const boxes = items.map(({ bar, text }) => box(ctx, bar, text, horizontal, chart));
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (a.x1 < b.x2 - 1 && b.x1 < a.x2 - 1 && a.y1 < b.y2 - 1 && b.y1 < a.y2 - 1) return true;
        }
        return false;
      };
      const tries = [
        ['700 11px', labels],
        ['700 10px', labels],
        ['700 9.5px', labels.map(l => ({ bar: l.bar, text: short(l.text) }))],
        ['700 8.5px', labels.map(l => ({ bar: l.bar, text: short(l.text) }))]
      ];
      let chosen = null;
      for (const [font, items] of tries) {
        ctx.font = font + ' Inter, system-ui, sans-serif';
        if (!overlaps(items)) { chosen = items; break; }
      }
      chart.$rmimsValuesHidden = !chosen;
      if (chosen) chosen.forEach(({ bar, text }) => paint(ctx, bar, text, horizontal, chart));
      ctx.restore();
    }
  });

  function box(ctx, bar, text, horizontal, chart) {
    const area = chart.chartArea;
    const w = ctx.measureText(text).width, h = 12;
    if (horizontal) {
      const x = Math.min(bar.x + 5, area.right - w);
      return { x1: x, x2: x + w, y1: bar.y - h / 2, y2: bar.y + h / 2 };
    }
    const y = Math.max(bar.y - 4, area.top + 12);
    return { x1: bar.x - w / 2, x2: bar.x + w / 2, y1: y - h, y2: y };
  }

  function paint(ctx, bar, text, horizontal, chart) {
    if (!text || bar.skip) return;
    const area = chart.chartArea;
    if (horizontal) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const x = Math.min(bar.x + 5, area.right - ctx.measureText(text).width);
      ctx.fillText(text, x, bar.y);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const y = Math.max(bar.y - 4, area.top + 12);
      ctx.fillText(text, bar.x, y);
    }
  }
})();
