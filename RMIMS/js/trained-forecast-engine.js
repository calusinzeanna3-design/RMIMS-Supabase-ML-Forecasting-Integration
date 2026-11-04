// js/trained-forecast-engine.js
// Live-adaptive forecaster. The LEVEL comes ONLY from real recorded consumption (user disbursements);
// the trained 12-year model only supplies the SHAPE (day-of-week / month seasonality / trend) and the
// margin of error (its proven MAPE). NO quantities are hardcoded: with no recorded usage there is no forecast.
import { TRAINED_PROFILE, TRAINED_ANCHOR_DATE, TRAINED_OVERALL_DAILY_MAPE } from "./trained-forecast-profile.js";
import { selfLearnProfile, getLearnedProfile, neutralProfile, shareLearnedProfile } from "./self-learning-model.js";

export { TRAINED_OVERALL_DAILY_MAPE };

/**
 * ONE margin of error per company model (no per-material / per-horizon differences):
 *   Scones & Muffins (NB-xxx): the trained 12-year model, all 19 materials combined -> 6.65 %
 *   KXC (RM-xxx):              the trained 5-year model                            -> 7.51 %
 */
export const KXC_MODEL_MAPE = 7.51;
export function modelMapeFor(code) {
  // FIXED margin of error, the same for the 7-day and the monthly forecast and for every material of the company:
  //   Scones & Muffins (NB-xxx, incl. materials added later): the 12-year model's 6.65 %
  //   KXC (RM-xxx): its 5-year model's 7.51 %
  return /^RM-/i.test(String(code || '').trim()) ? KXC_MODEL_MAPE : TRAINED_OVERALL_DAILY_MAPE;
}

/** True for the materials the 12-year model was trained on (their trained pattern is never replaced). */
export function isTrainedMaterial(code) {
  return Boolean(TRAINED_PROFILE[String(code || '').toUpperCase().trim()]);
}
const ANCHOR_MS = new Date(TRAINED_ANCHOR_DATE + "T00:00:00").getTime();

export const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The model profile of a material:
 *   1. the 19 registered materials: the 12-year trained profile CONTINUING its training - live days recorded by users
 *      are appended after the 12-year history, so the pattern moves by liveDays / (12 years + liveDays)
 *   2. any material added later: its SELF-LEARNED profile, learned from its own recorded usage
 *   3. a neutral starting profile: a new material with no recorded usage yet (no quantity is forecast)
 */
export function getTrainedProfile(code) {
  const c = String(code || "").toUpperCase().trim();
  if (!c) return null;
  return getLearnedProfile(c) || TRAINED_PROFILE[c] || neutralProfile();
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

/**
 * SHAPE of consumption on `date` relative to the anchor day (= 1.0 on an average day of the anchor month):
 * weekday rhythm (normalised so an average week = 7), month seasonality vs the anchor month, and yearly trend.
 * It carries NO quantity. Multiply by the live level (units per average day) to get a forecast.
 */
export function trainedDailyForecast(code, date, anchor = new Date()) {
  const p = getTrainedProfile(code);
  if (!p) return null;
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const yearsFromAnchor = (d.getTime() - a.getTime()) / (365.25 * 86400000);
  const seasonal = p.month[d.getMonth()] / (p.month[a.getMonth()] || 1);
  const dowShape = p.dow[d.getDay()] / (mean(p.dow) || 1);
  return Math.pow(p.growth, yearsFromAnchor) * seasonal * dowShape;
}

/* ============================================================================
 * LIVE-LEARNED FORECASTER  (user-recorded consumption + trained 12-year shape)
 * ----------------------------------------------------------------------------
 *  1. LEVEL  : learned only from what users recorded (disbursements), over the period of use since the first record:
 *                 level = sum(consumed) / sum(shape)      recency-weighted (half-life 28 days)
 *              i.e. "units per average day". A disbursement usually covers several days (batches), so the days
 *              between records count; only a break of more than 14 days with no record (system not used) is
 *              missing data. Nothing is hardcoded; with no recorded usage there is NO forecast.
 *  2. SHAPE  : the 12-year trained model (weekday rhythm, Fri/Sat peaks, Sunday off-day, seasonality, trend).
 *  3. FORECAST(d) = shape(d) x level                       (future starts tomorrow)
 *  4. MARGIN : +/- the model's own proven MAPE around the forecast. It is the TEST, not a fudge factor.
 *  5. REQUIREMENT = forecast + REQUIREMENT_BAND_FRACTION of the margin -> always INSIDE the margin corridor:
 *              lower <= forecast <= requirement <= upper. Consumption and requirement are judged against the
 *              SAME corridor, so a day or a stock level outside it is a real deviation, not noise.
 *  6. CONFIDENCE: evidenceDays = days with a record. Fewer than MIN_EVIDENCE_DAYS (4) => `lowConfidence`.
 *  7. Today may be partial, so the level is learned from completed days when there are any.
 * ========================================================================== */

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Recency weighting of the live level. 28 days: back-tested on the 12-year dataset (2025, all 19 materials, next-7-day
// totals) it is the most accurate for daily AND batched recording - daily 3.7-4.1 %, every 3 days 4.0-4.4 %,
// weekly batches 7-8 % (the old 7-day half-life counting only recorded days was off by 150 % to 1,600 % with batches).
const HALF_LIFE_DAYS = 28;
// a stretch of more than 14 days with no record at all = the system was not used -> missing data, not zero usage
const USE_GAP_DAYS = 14;
// the shortest stretch of use the level is learned over (a first record is read as at least one week's usage)
const MIN_WINDOW_DAYS = 7;
export const MIN_EVIDENCE_DAYS = 4;

/** Fraction of the MAPE margin the requirement sits above the forecast (0.8 => inside the corridor). */
export const REQUIREMENT_BAND_FRACTION = 0.8;
/** Backwards-compatible name (callers use it as: requirement = forecast x (1 + X x MAPE)). */
export const REQUIREMENT_BUFFER_Z = REQUIREMENT_BAND_FRACTION;

/**
 * @param {string} code
 * @param {Map<string,number>} actualsByDate  YYYY-MM-DD -> consumed qty (live user disbursements)
 * @param {object} [opts] { asOf?: Date, marginMode?: 'trained'|'live' }
 * @returns {{hasEvidence:boolean, evidenceDays:number, lowConfidence:boolean, firstDate:Date|null, level:number, calibration:number, forecastFor:(date:Date)=>object}}
 */
export function buildLiveForecaster(code, actualsByDate, opts = {}) {
  const asOf = dayStart(opts.asOf || new Date());
  // self-feed: re-learn this material's pattern from its usage feed (no-op when nothing new was recorded)
  try {
    const c = String(code || "").toUpperCase().trim();
    // trained materials continue from the 12-year profile and its proven overall margin
    const prior = TRAINED_PROFILE[c] ? { ...TRAINED_PROFILE[c], mape: TRAINED_OVERALL_DAILY_MAPE } : null;
    selfLearnProfile(c, actualsByDate, prior, asOf);
  } catch (_) {}
  const prof = getTrainedProfile(code);
  const mapePct = modelMapeFor(code);
  const mapeFrac = mapePct / 100;
  const marginMode = opts.marginMode || 'trained';
  const lambda = Math.pow(0.5, 1 / HALF_LIFE_DAYS);
  const shapeOn = (d) => trainedDailyForecast(code, d, asOf) || 0;

  const band = (v, extra = 0) => {
    const hw = Math.max(v * mapeFrac, extra);
    return { value: v, lower: Math.max(0, v - hw), upper: v + hw, requirement: v + REQUIREMENT_BAND_FRACTION * hw, mape: mapeFrac };
  };
  const none = { value: 0, lower: 0, upper: 0, requirement: 0, mape: mapeFrac, basis: 'none' };
  const noInfo = () => ({ ...none });

  // First day with real recorded consumption (<= asOf)
  let first = null;
  if (actualsByDate) {
    for (const [k, q] of actualsByDate.entries()) {
      if (!(q > 0)) continue;
      const d = new Date(k + 'T00:00:00');
      if (isNaN(d.getTime()) || d > asOf) continue;
      if (!first || d < first) first = d;
    }
  }
  if (!first || !prof) {
    return { hasEvidence: false, evidenceDays: 0, lowConfidence: true, firstDate: null, level: 0, calibration: 0, forecastFor: noInfo };
  }

  const yesterday = addDays(asOf, -1);
  // today counts once something was recorded today (a disbursement made today is real usage)
  const calEnd = ((actualsByDate.get(dateKey(asOf)) || 0) > 0 || first > yesterday) ? asOf : yesterday;

  const fits = new Map();
  const errsAbs = [];
  let num = 0, den = 0, level = 0, evidenceDays = 0;
  // How this material is recorded: daily (median gap 1 day) -> a day without a record is a missed entry (left out);
  // in batches (median gap 2+ days) -> each record covers the days until the next one (those days count).
  const recDays = [];
  actualsByDate.forEach((q, k) => { if (q > 0) { const d = new Date(k + 'T00:00:00'); if (!isNaN(d.getTime()) && d <= asOf) recDays.push(d.getTime()); } });
  recDays.sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < recDays.length; i++) gaps.push(Math.round((recDays[i] - recDays[i - 1]) / 86400000));
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : 2; // one record so far: it covers the days since
  // with only a few records, consecutive days count as daily recording only when the amounts are alike
  // (135 g then 4,900 g the next day is a batch, not a daily rate)
  // (amounts compared after the weekday rhythm, so a quiet Sunday next to a busy Saturday still counts as alike)
  const recQty = recDays.map(t => { const d = new Date(t); return (actualsByDate.get(dateKey(d)) || 0) / (shapeOn(d) || 1); });
  const qMean = recQty.reduce((a, b) => a + b, 0) / (recQty.length || 1);
  const qCv = qMean > 0 ? Math.sqrt(recQty.reduce((a, q) => a + (q - qMean) * (q - qMean), 0) / (recQty.length || 1)) / qMean : 0;
  const dailyLike = medianGap <= 1 && gaps.length > 0 && (recDays.length >= MIN_EVIDENCE_DAYS || qCv < 0.5);
  const batched = !dailyLike;
  let sinceRecord = 0;
  for (let t = first; t <= asOf; t = addDays(t, 1)) {
    const key = dateKey(t);
    const actual = actualsByDate.get(key) || 0;
    const shape = shapeOn(t);
    if (t <= calEnd) {
      num = lambda * num;
      den = lambda * den;
      if (actual > 0) { sinceRecord = 0; evidenceDays++; } else sinceRecord++;
      // Every day of normal use counts: materials are usually disbursed in batches (one record covers several days),
      // so a day without a record between disbursements is part of the period the batch covered. Only a long
      // break with no records at all (system not used) is left out as missing data.
      if (actual > 0 || (batched && sinceRecord <= USE_GAP_DAYS)) {
        num += actual;
        den += shape;
      }
      level = den > 0 ? num / den : 0;
    }
    const f = shape * level;
    fits.set(key, f);
    if (actual > 0) errsAbs.push(Math.abs(actual - f));
  }
  // Batches with less than a week of use recorded so far: the records are read as the usage of at least one whole
  // week (so a first batch is not taken as one or two days' usage). Days before the first record fill the week.
  // (Daily records keep their own daily rate.)
  if (batched) {
    let spanDays = Math.round((calEnd - first) / 86400000) + 1;
    for (let t = addDays(first, -1); spanDays < MIN_WINDOW_DAYS; t = addDays(t, -1), spanDays++) {
      den += shapeOn(t) * Math.pow(lambda, Math.round((calEnd - t) / 86400000));
    }
    level = den > 0 ? num / den : level;
  }
  // Batched: the latest record also covers the days after it (about one usual gap). If that period is not over yet,
  // its remaining days are counted too, so a fresh batch is not read as one day's usage.
  if (batched && recDays.length && !opts.noForwardCover) {
    const lastRec = new Date(recDays[recDays.length - 1]);
    const coverEnd = addDays(dayStart(lastRec), Math.min(medianGap, USE_GAP_DAYS) - 1);
    for (let t = addDays(calEnd, 1); t <= coverEnd; t = addDays(t, 1)) {
      num = lambda * num;
      den = lambda * den + shapeOn(t);
    }
    level = den > 0 ? num / den : level;
  }
  const liveExtra = marginMode === 'live' ? errsAbs.slice(-28).reduce((m, e) => Math.max(m, e), 0) : 0;

  const forecastFor = (date) => {
    const d = dayStart(date);
    if (d < first) return noInfo();
    if (d <= asOf) return { ...band(fits.get(dateKey(d)) || 0, liveExtra), basis: 'live' };
    return { ...band(shapeOn(d) * level, liveExtra), basis: 'live' };
  };

  // share the re-learned model + its suggested requirement with every device (Supabase, once per change)
  try {
    let next7 = 0, next30 = 0;
    for (let i = 1; i <= 30; i++) {
      const r = forecastFor(addDays(asOf, i)).requirement || 0;
      if (i <= 7) next7 += r;
      next30 += r;
    }
    shareLearnedProfile(String(code || '').toUpperCase().trim(), { next7, next30 });
  } catch (_) {}

  return { hasEvidence: true, evidenceDays, lowConfidence: evidenceDays < MIN_EVIDENCE_DAYS, firstDate: first, level, calibration: level, forecastFor };
}

/**
 * Sum of the forecast over the next `days` days starting TOMORROW.
 * opts.requirement=true sums the requirement (inside-margin reorder figure), else the expected consumption.
 * Returns null for materials the trained profile does not know.
 */
export function forecastNextDays(code, days, actualsByDate, asOf = new Date(), opts = {}) {
  if (!getTrainedProfile(code)) return null;
  const fc = buildLiveForecaster(code, actualsByDate || new Map(), { asOf });
  let sum = 0;
  for (let i = 1; i <= days; i++) {
    const r = fc.forecastFor(addDays(asOf, i));
    sum += opts.requirement ? r.requirement : r.value;
  }
  return sum;
}

/**
 * RESTOCK PLANNER - accurate days of cover.
 * Burns stock day by day with the model's daily requirement (Sundays, Fri/Sat peaks and month seasonality
 * respected, instead of stock / average).
 *   daysOfCover   whole days the stock lasts
 *   stockoutDate  first day stock cannot meet the requirement
 *   orderByDate   stockoutDate - leadTimeDays (clamped to today = overdue)
 *   suggestedQty  requirement over (lead time + cover target) + minimum stock - on-hand, never negative
 *   status        'out' | 'order-now' | 'order-soon' | 'ok'
 */
export function planRestock(code, stock, actualsByDate, opts = {}) {
  const asOf = dayStart(opts.asOf || new Date());
  const lead = Math.max(0, Number(opts.leadTimeDays ?? 3));
  const minStock = Math.max(0, Number(opts.minStock ?? 0));
  const coverTarget = Number(opts.coverTargetDays ?? 7);
  const horizon = 90;
  const fc = buildLiveForecaster(code, actualsByDate || new Map(), { asOf });

  let remaining = Math.max(0, Number(stock) || 0);
  let daysOfCover = horizon, stockoutDate = null, need = 0;
  const startStock = remaining;
  for (let i = 1; i <= horizon; i++) {
    const req = fc.forecastFor(addDays(asOf, i)).requirement || 0;
    if (i <= lead + coverTarget) need += req;
    if (stockoutDate === null) {
      if (remaining >= req) { remaining -= req; }
      else { daysOfCover = i - 1; stockoutDate = addDays(asOf, i); }
    }
  }
  if (startStock <= 0) { daysOfCover = 0; stockoutDate = asOf; }

  let orderByDate = stockoutDate ? addDays(stockoutDate, -lead) : null;
  if (orderByDate && orderByDate < asOf) orderByDate = asOf; // never show a past date: the order is overdue
  const suggestedQty = Math.max(0, need + minStock - startStock);
  let status = 'ok';
  if (startStock <= 0) status = 'out';
  else if (stockoutDate && daysOfCover <= lead) status = 'order-now';
  else if (stockoutDate && daysOfCover <= lead + coverTarget) status = 'order-soon';
  return { daysOfCover, capped: stockoutDate === null, stockoutDate, orderByDate, suggestedQty, requirement7: need, status, hasEvidence: fc.hasEvidence, lowConfidence: fc.lowConfidence, evidenceDays: fc.evidenceDays };
}
