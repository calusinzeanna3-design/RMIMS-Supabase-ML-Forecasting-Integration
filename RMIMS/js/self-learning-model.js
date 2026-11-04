// js/self-learning-model.js
// ============================================================================================================
// RMIMS SELF-LEARNING FORECAST MODEL
// ------------------------------------------------------------------------------------------------------------
// Learns, for EVERY raw material (the 19 registered ones AND every material the Manager adds), how it is really
// used - only from the consumption recorded in the system (Supabase disbursements). Nothing is hardcoded.
//
// What it learns from each material's own usage feed:
//   * LEVEL        units per average day                          (recency weighted, see the forecast engine)
//   * 7-DAY RHYTHM weekday pattern (Mon..Sun), incl. days the store does not use it (e.g. Sundays off)
//   * MONTHS       month-of-year seasonality, once a month has enough recorded days
//   * YEAR TREND   yearly growth / decline fitted on the weekly averages (log-linear regression)
//   * MOMENTUM     last 7 days vs the 7 before, last 30 days vs the 30 before (shown as trends)
//   * ACCURACY     its own MAPE, measured by back-testing: each recorded day is predicted from the days before it
//
// How it learns over time (self-feeding): every new record changes the material's usage feed, the profile is
// re-learned automatically the next time any screen forecasts it, and the result is kept in this browser
// (localStorage) so every screen uses the same learned model.
//   * a NEW material (added after training) starts neutral and its forecast comes from its own learned pattern
//   * the 19 materials of the 12-year model CONTINUE their training: every recorded live day is appended after the
//     12-year history (which ended TRAINED_END), so the trained pattern stays the base and moves only as much as the
//     new data weighs against 12 years of history (liveDays / (12 years + liveDays)). The suggested requirement
//     therefore improves continuously without throwing the 12-year training away.
// Weights: weekday rhythm after ~8 weeks of records, each month after ~60 records in that month, the yearly
// trend after a full year of history, the accuracy after ~30 back-tested days.
// ============================================================================================================

const STORE_KEY = 'rmims_ml_self_learned_profiles_v1';
const HALF_LIFE_DAYS = 7;          // same recency weighting as the live forecaster
const NEW_MATERIAL_MAPE = 15;      // starting margin for a material with no history yet (replaced by its own MAPE)
// The 12-year model was trained on ~12 years of daily history (to TRAINED_END). Each recorded live day is appended
// to that history, so a trained material keeps learning: weight of the live data = liveDays / (trainedDays + liveDays).
export const TRAINED_HISTORY_DAYS = Math.round(12 * 365.25);
export const TRAINED_END = '2025-07-02';
const continued = (liveDays) => liveDays / (TRAINED_HISTORY_DAYS + liveDays);
const DAY_MS = 86400000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const normalise = (arr) => { const m = mean(arr); return m > 0 ? arr.map(v => v / m) : arr.map(() => 1); };

/** Neutral starting point for a material the 12-year model has never seen. */
export function neutralProfile() {
  return { level: 0, growth: 1, dow: [1, 1, 1, 1, 1, 1, 1], month: new Array(12).fill(1), mape: NEW_MATERIAL_MAPE, neutral: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Registry of learned profiles (shared by every screen through localStorage)
// ---------------------------------------------------------------------------------------------------------------
const registry = new Map();
(function loadRegistry() {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    Object.keys(raw).forEach(code => { if (raw[code] && Array.isArray(raw[code].dow)) registry.set(code, raw[code]); });
  } catch (_) {}
})();
let saveTimer = null;
function persistRegistry() {
  if (typeof localStorage === 'undefined') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const obj = {};
      registry.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(STORE_KEY, JSON.stringify(obj));
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('rmims_ml_model_updated', { detail: { materials: registry.size } }));
    } catch (_) {}
  }, 250);
}

/** The learned (blended) profile of a material, or null when it has no recorded usage yet. */
export function getLearnedProfile(code) {
  return registry.get(String(code || '').toUpperCase().trim()) || null;
}
/** Every learned profile (for a model status / insight panel). */
export function getAllLearnedProfiles() {
  const out = {};
  registry.forEach((v, k) => { out[k] = v; });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------------------------------------------
/**
 * Learns (or re-learns when the feed changed) a material's profile from its recorded usage.
 * @param {string} code             item code (e.g. NB-020)
 * @param {Map<string,number>} actualsByDate  YYYY-MM-DD -> recorded consumption
 * @param {object|null} prior       trained 12-year profile when one exists, else null (new material)
 * @param {Date} [asOf]
 * @returns {object|null}           blended profile, or null when there is no recorded usage
 */
export function selfLearnProfile(code, actualsByDate, prior, asOf = new Date()) {
  const c = String(code || '').toUpperCase().trim();
  if (!c || !actualsByDate || typeof actualsByDate.forEach !== 'function') return getLearnedProfile(c);
  const end = dayStart(asOf);

  const recs = [];
  actualsByDate.forEach((q, k) => {
    const qty = Number(q);
    if (!(qty > 0)) return;
    const d = new Date(String(k) + 'T00:00:00');
    if (isNaN(d.getTime()) || d > end) return;
    recs.push({ d, q: qty });
  });
  if (!recs.length) return getLearnedProfile(c);
  recs.sort((a, b) => a.d - b.d);

  // nothing new in the feed -> keep the profile already learned
  const sum = recs.reduce((s, r) => s + r.q, 0);
  const sig = `v2|${recs.length}|${sum.toFixed(4)}|${keyOf(recs[recs.length - 1].d)}|${prior ? 't' : 'n'}`;
  const known = registry.get(c);
  if (known && known.meta && known.meta.sig === sig) return known;

  const base = prior ? { ...prior } : neutralProfile();
  const priorDow = normalise((base.dow || []).length === 7 ? base.dow.slice() : [1, 1, 1, 1, 1, 1, 1]);
  const priorMonth = normalise((base.month || []).length === 12 ? base.month.slice() : new Array(12).fill(1));
  const priorGrowth = Number(base.growth) > 0 ? Number(base.growth) : 1;
  const priorMape = Number(base.mape) > 0 ? Number(base.mape) : NEW_MATERIAL_MAPE;

  const first = recs[0].d;
  const last = recs[recs.length - 1].d;
  const spanDays = Math.round((last - first) / DAY_MS) + 1;
  const n = recs.length;

  // ---- 1. YEAR TREND: log-linear fit on weekly averages -------------------------------------------------------
  const weeks = new Map();
  recs.forEach(r => {
    const w = Math.floor((r.d - first) / (7 * DAY_MS));
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w).push(r.q);
  });
  const pts = [];
  weeks.forEach((qs, w) => { if (qs.length >= 2) pts.push({ t: (w * 7 + 3.5) / 365.25, y: Math.log(mean(qs)) }); });
  let learnedGrowth = 1, wGrowth = 0;
  if (pts.length >= 6 && spanDays >= 42) {
    const mt = mean(pts.map(p => p.t)), my = mean(pts.map(p => p.y));
    let sxy = 0, sxx = 0;
    pts.forEach(p => { sxy += (p.t - mt) * (p.y - my); sxx += (p.t - mt) * (p.t - mt); });
    if (sxx > 0) {
      learnedGrowth = clamp(Math.exp(sxy / sxx), 0.4, 3);
      wGrowth = prior ? continued(n) : clamp(spanDays / 365, 0, 1);
    }
  }
  const growth = Math.pow(priorGrowth, 1 - wGrowth) * Math.pow(learnedGrowth, wGrowth);
  // usage brought to today's trend level (so older records do not pull the pattern down / up)
  const detr = recs.map(r => ({ d: r.d, q: r.q / Math.pow(learnedGrowth, (r.d - last) / (365.25 * DAY_MS)) }));
  const overall = mean(detr.map(r => r.q)) || 1;

  // ---- 2. 7-DAY RHYTHM ------------------------------------------------------------------------------------------
  const byDow = [[], [], [], [], [], [], []];
  detr.forEach(r => byDow[r.d.getDay()].push(r.q));
  const learnedDow = byDow.map((qs, i) => {
    if (qs.length >= 2) return mean(qs) / overall;
    if (qs.length === 0 && spanDays >= 28) return 0.05;   // never used on this weekday in 4+ weeks: a closed day
    return priorDow[i];
  });
  // batched recording (one record for several days) says nothing about the weekday rhythm: keep the prior rhythm
  const recordedDaily = spanDays > 0 && n / spanDays >= 0.5;
  const wDow = !recordedDaily ? 0 : (prior ? continued(n) : clamp(n / 56, 0, 1));
  const learnedDowN = normalise(learnedDow);
  const dow = priorDow.map((p, i) => p * (1 - wDow) + learnedDowN[i] * wDow);

  // ---- 3. MONTHS (seasonality) -----------------------------------------------------------------------------------
  const byMonth = Array.from({ length: 12 }, () => []);
  detr.forEach(r => byMonth[r.d.getMonth()].push(r.q / (learnedDowN[r.d.getDay()] || 1)));
  const seen = byMonth.map(a => a.length);
  const seenMeans = byMonth.map(a => (a.length >= 7 ? mean(a) : null));
  const seenAvg = mean(seenMeans.filter(v => v != null)) || 1;
  const month = priorMonth.map((p, m) => {
    if (seenMeans[m] == null) return p;
    // a trained month already holds ~12 years of that month (~365 days); live days of the month are added to it
    const w = prior ? seen[m] / (365 + seen[m]) : clamp(seen[m] / 60, 0, 1);
    return p * (1 - w) + (seenMeans[m] / seenAvg) * w;
  });

  // ---- 4. MOMENTUM: 7-day and 30-day trends ------------------------------------------------------------------------
  // measured back from the last recorded day, so both windows are complete
  const sumBetween = (fromDaysAgo, toDaysAgo) => {
    const a = last.getTime() - fromDaysAgo * DAY_MS, b = last.getTime() - toDaysAgo * DAY_MS;
    return recs.reduce((s, r) => (r.d.getTime() > a && r.d.getTime() <= b ? s + r.q : s), 0);
  };
  const ratioPct = (now, before) => (before > 0 ? ((now / before) - 1) * 100 : null);
  const trend7Pct = ratioPct(sumBetween(7, 0), sumBetween(14, 7));
  const trend30Pct = ratioPct(sumBetween(30, 0), sumBetween(60, 30));

  // ---- 5. ACCURACY: back-test (each recorded day predicted only from the days before it) ---------------------------
  const shape = (d) => (month[d.getMonth()] / (mean(month) || 1)) * (dow[d.getDay()] / (mean(dow) || 1));
  const lambda = Math.pow(0.5, 1 / HALF_LIFE_DAYS);
  let num = 0, den = 0, prevDay = null;
  const apes = [];
  recs.forEach((r, i) => {
    if (prevDay) {
      const gap = Math.round((r.d - prevDay) / DAY_MS);
      const decay = Math.pow(lambda, gap);
      num *= decay; den *= decay;
    }
    const sh = shape(r.d) || 1e-6;
    if (i >= 7 && den > 0) {
      const pred = (num / den) * sh;
      apes.push(Math.abs(r.q - pred) / r.q);
    }
    num += r.q; den += sh; prevDay = r.d;
  });
  const recent = apes.slice(-60);
  const learnedMape = recent.length ? clamp(mean(recent) * 100, 2, 45) : priorMape;
  const wMape = prior ? continued(recent.length) : clamp(recent.length / 30, 0, 1);
  const mape = priorMape * (1 - wMape) + learnedMape * wMape;

  const profile = {
    level: overall,
    growth,
    dow,
    month,
    mape: Number(mape.toFixed(2)),
    selfLearned: true,
    trainedPrior: Boolean(prior),
    meta: {
      sig,
      learnedAt: new Date().toISOString(),
      evidenceDays: n,
      spanDays,
      firstDate: keyOf(first),
      lastDate: keyOf(last),
      yearlyTrendPct: Number(((growth - 1) * 100).toFixed(1)),
      learnedYearlyTrendPct: Number(((learnedGrowth - 1) * 100).toFixed(1)),
      trend7Pct: trend7Pct == null ? null : Number(trend7Pct.toFixed(1)),
      trend30Pct: trend30Pct == null ? null : Number(trend30Pct.toFixed(1)),
      backtestDays: recent.length,
      learnedMape: Number(learnedMape.toFixed(2)),
      liveWeightPct: Number(((prior ? continued(n) : 1) * 100).toFixed(2)),
      weights: {
        weekday: Number(wDow.toFixed(2)),
        months: seen.map(s => Number(clamp(s / 60, 0, 1).toFixed(2))),
        yearTrend: Number(wGrowth.toFixed(2)),
        accuracy: Number(wMape.toFixed(2))
      }
    }
  };
  registry.set(c, profile);
  persistRegistry();
  return profile;
}

const fixedMargin = (code) => (/^RM-/i.test(String(code || '')) ? '7.51' : '6.65');
/** Plain-language summary of what the model learned for one material (for tooltips / panels). */
export function describeLearnedProfile(code) {
  const p = getLearnedProfile(code);
  if (!p || !p.meta) return 'Learning starts with this material\'s first recorded usage.';
  const m = p.meta;
  const pct = (v) => (v == null ? 'not enough data' : `${v > 0 ? '+' : ''}${v}%`);
  if (p.trainedPrior) {
    const learnedYear = m.spanDays >= 180 ? pct(m.learnedYearlyTrendPct) : 'needs 6+ months of records';
    return `12-year trained model, continuing its training with ${m.evidenceDays} live day(s) recorded after its history ` +
      `(${m.firstDate} to ${m.lastDate}; live data weight ${m.liveWeightPct}%). Live usage trend: 7-day ${pct(m.trend7Pct)}, ` +
      `30-day ${pct(m.trend30Pct)}, yearly ${learnedYear}. Margin of error ${fixedMargin(code)}% (fixed, 7-day and monthly).`;
  }
  return `Self-learned from ${m.evidenceDays} recorded day(s) (${m.firstDate} to ${m.lastDate}). ` +
    `7-day trend ${pct(m.trend7Pct)}, 30-day trend ${pct(m.trend30Pct)}, yearly trend ${m.spanDays >= 180 ? pct(m.yearlyTrendPct) : 'needs 6+ months of records'}. ` +
    `Margin of error ${fixedMargin(code)}% (fixed, 7-day and monthly).`;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared model in Supabase (SQL file 16_ML_CONTINUOUS_LEARNING.sql): every re-learned profile is saved to
// public.ml_model_profiles, and profiles learned on other devices are loaded, so the whole system uses one model.
// Never blocks a forecast: if the table is not installed or the device is offline, the local model is used.
// ---------------------------------------------------------------------------------------------------------------
const pushedSig = new Map();
let sbPromise = null;
function getSupabase() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (!sbPromise) {
    sbPromise = import('../supabase/supabase-config.js')
      .then(m => (m && m.supabase && !m.supabase.__offline ? m.supabase : null))
      .catch(() => null);
  }
  return sbPromise;
}

/** Saves a material's re-learned model (and its next 7 / 30-day requirement) to Supabase, once per change. */
export function shareLearnedProfile(code, extra = {}) {
  const c = String(code || '').toUpperCase().trim();
  const p = registry.get(c);
  if (!p || !p.meta || pushedSig.get(c) === p.meta.sig) return;
  pushedSig.set(c, p.meta.sig);
  const m = p.meta;
  const payload = {
    level: p.level, growth: p.growth, dow: p.dow, month: p.month, mape: p.mape,
    backtestDays: m.backtestDays, evidenceDays: m.evidenceDays, firstDate: m.firstDate, lastDate: m.lastDate,
    liveWeightPct: m.liveWeightPct, trend7Pct: m.trend7Pct, trend30Pct: m.trend30Pct,
    yearlyTrendPct: m.spanDays >= 180 ? (p.trainedPrior ? m.learnedYearlyTrendPct : m.yearlyTrendPct) : null,
    next7: extra.next7 != null ? Number(Number(extra.next7).toFixed(3)) : null,
    next30: extra.next30 != null ? Number(Number(extra.next30).toFixed(3)) : null
  };
  getSupabase().then(sb => {
    if (!sb) return;
    sb.rpc('save_ml_profile', { p_item_code: c, p_profile: payload }).then(() => {}, () => {});
  });
}

/** Loads the profiles other devices learned (only ones with more live data than this browser has). */
let pulled = false;
export function pullSharedProfiles() {
  if (pulled) return;
  pulled = true;
  getSupabase().then(sb => {
    if (!sb) return;
    sb.from('ml_model_profiles')
      .select('item_code, model_source, learned_level, learned_growth, learned_dow, learned_month, learned_mape, backtest_days, live_days, live_first_date, live_last_date, live_weight_pct, trend_7d_pct, trend_30d_pct, yearly_trend_pct, learned_at')
      .then(({ data, error }) => {
        if (error || !Array.isArray(data)) return;
        let changed = false;
        data.forEach(r => {
          if (!r || !Array.isArray(r.learned_dow) || !Array.isArray(r.learned_month) || !(r.live_days > 0)) return;
          const c = String(r.item_code || '').toUpperCase().trim();
          const local = registry.get(c);
          if (local && local.meta && local.meta.evidenceDays >= r.live_days) return;
          registry.set(c, {
            level: Number(r.learned_level) || 0,
            growth: Number(r.learned_growth) || 1,
            dow: r.learned_dow.map(Number),
            month: r.learned_month.map(Number),
            mape: Number(r.learned_mape) || NEW_MATERIAL_MAPE,
            selfLearned: true,
            trainedPrior: r.model_source === 'trained-12y',
            meta: {
              sig: 'shared|' + r.live_days + '|' + (r.live_last_date || ''),
              learnedAt: r.learned_at, evidenceDays: r.live_days, spanDays: (r.live_first_date && r.live_last_date)
                ? Math.round((new Date(r.live_last_date) - new Date(r.live_first_date)) / DAY_MS) + 1 : 0,
              firstDate: r.live_first_date, lastDate: r.live_last_date, liveWeightPct: Number(r.live_weight_pct) || 0,
              trend7Pct: r.trend_7d_pct == null ? null : Number(r.trend_7d_pct),
              trend30Pct: r.trend_30d_pct == null ? null : Number(r.trend_30d_pct),
              yearlyTrendPct: r.yearly_trend_pct == null ? null : Number(r.yearly_trend_pct),
              learnedYearlyTrendPct: r.yearly_trend_pct == null ? null : Number(r.yearly_trend_pct),
              backtestDays: r.backtest_days || 0, learnedMape: Number(r.learned_mape) || null, weights: {}
            }
          });
          changed = true;
        });
        if (changed) persistRegistry();
      }, () => {});
  });
}
if (typeof window !== 'undefined') setTimeout(pullSharedProfiles, 0);
