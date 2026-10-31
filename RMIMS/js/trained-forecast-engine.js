// js/trained-forecast-engine.js
// Live-adaptive forecaster. The LEVEL comes ONLY from real recorded consumption (user disbursements);
// the trained 12-year model only supplies the SHAPE (day-of-week / month seasonality / trend) and the
// margin of error (its proven MAPE). NO quantities are hardcoded: with no recorded usage there is no forecast.
import { TRAINED_PROFILE, TRAINED_ANCHOR_DATE, TRAINED_OVERALL_DAILY_MAPE } from "./trained-forecast-profile.js";

export { TRAINED_OVERALL_DAILY_MAPE };
const ANCHOR_MS = new Date(TRAINED_ANCHOR_DATE + "T00:00:00").getTime();

export const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function getTrainedProfile(code) {
  return TRAINED_PROFILE[String(code || "").toUpperCase().trim()] || null;
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
 *  1. LEVEL  : learned only from what users recorded (disbursements), using ONLY days that HAVE a record:
 *                 level = sum(consumed) / sum(shape)      recency-weighted (half-life 7 days)
 *              i.e. "units per average day". A day with no record (e.g. the delivery did not arrive) is
 *              MISSING DATA, not zero consumption: it is left out of both sums, so recording 4, 6 or 7 days
 *              a week gives the same level. Nothing is hardcoded; with no recorded usage there is NO forecast.
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
const HALF_LIFE_DAYS = 7;
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
  const prof = getTrainedProfile(code);
  const mapePct = prof ? Number(prof.mape) || TRAINED_OVERALL_DAILY_MAPE : TRAINED_OVERALL_DAILY_MAPE;
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
  const calEnd = first <= yesterday ? yesterday : asOf;

  const fits = new Map();
  const errsAbs = [];
  let num = 0, den = 0, level = 0, evidenceDays = 0;
  for (let t = first; t <= asOf; t = addDays(t, 1)) {
    const key = dateKey(t);
    const actual = actualsByDate.get(key) || 0;
    const shape = shapeOn(t);
    if (t <= calEnd) {
      // calendar-age decay every day, but only RECORDED days add evidence (gaps are missing data, not zeros)
      num = lambda * num;
      den = lambda * den;
      if (actual > 0) {
        num += actual;
        den += shape;
        evidenceDays++;
      }
      level = den > 0 ? num / den : 0;
    }
    const f = shape * level;
    fits.set(key, f);
    if (actual > 0) errsAbs.push(Math.abs(actual - f));
  }
  const liveExtra = marginMode === 'live' ? errsAbs.slice(-28).reduce((m, e) => Math.max(m, e), 0) : 0;

  const forecastFor = (date) => {
    const d = dayStart(date);
    if (d < first) return noInfo();
    if (d <= asOf) return { ...band(fits.get(dateKey(d)) || 0, liveExtra), basis: 'live' };
    return { ...band(shapeOn(d) * level, liveExtra), basis: 'live' };
  };

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
