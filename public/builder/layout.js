/**
 * Pure layout / mechanics helpers for the public QQQ builder.
 * Numbers follow the recorded OptionStrat control addendum.
 */
export const RANGE_MIN = 0.011;
export const RANGE_MAX = 0.98;
export const QTY_MAX = 4999;
export const TABLE_ROWS = 21;
export const TABLE_COLS_MAX = 21;

/** Default range on a fresh load: ±12% around a 32d expiry, ±14% around a 54d expiry. */
export function defaultRangeForDte(dte) {
  const n = Number(dte);
  if (!Number.isFinite(n)) return 0.12;
  return n >= 45 ? 0.14 : 0.12;
}

/** 21 prices: spot × (1 + r − i·r/10), i = 0..20 (top = spot(1+r), bottom = spot(1−r)). */
export function tableRowPrices(spot, range) {
  const r = Number(range);
  const s = Number(spot);
  if (!(s > 0) || !Number.isFinite(r)) return [];
  const out = [];
  for (let i = 0; i < TABLE_ROWS; i++) out.push(s * (1 + r - (i * r) / 10));
  return out;
}

export function tableRowStep(spot, range) {
  return Number(spot) * Number(range) / 10;
}

/** Display rounding: 0 decimals when the step is large; nearer 0.5 / 2dp when zoomed in. */
export function formatTablePrice(px, step) {
  const x = Number(px);
  const st = Math.abs(Number(step)) || 1;
  if (!Number.isFinite(x)) return "—";
  if (st >= 5) return String(Math.round(x));
  if (st >= 0.5) {
    const half = Math.round(x * 2) / 2;
    return half % 1 === 0 ? String(half) : half.toFixed(1);
  }
  return x.toFixed(2);
}

/**
 * Evenly sample `dates` (already trading-day timestamps, first=today, last=expiry)
 * down to at most `max` unique values, snapped to the incoming list.
 */
export function sampleTradingDates(dates, max = TABLE_COLS_MAX) {
  const src = (dates || []).filter((t) => Number.isFinite(t));
  if (src.length <= max) return src.slice();
  const t0 = src[0];
  const t1 = src[src.length - 1];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < max; i++) {
    const target = t0 + ((t1 - t0) * i) / Math.max(1, max - 1);
    let best = src[0];
    let bd = Infinity;
    for (const d of src) {
      const ad = Math.abs(d - target);
      if (ad < bd) { bd = ad; best = d; }
    }
    if (!seen.has(best)) {
      seen.add(best);
      out.push(best);
    }
  }
  if (out[0] !== src[0]) out.unshift(src[0]);
  if (out[out.length - 1] !== src[src.length - 1]) out.push(src[src.length - 1]);
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Fixed dashed-curve time: ~75% of the way from now to expiry. */
export function midTime75(nowMs, expiryMs) {
  const a = Number(nowMs);
  const b = Number(expiryMs);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a;
  return a + 0.75 * (b - a);
}

/** Keep days-remaining constant when the expiry moves; clamp to [now, newExpiry]. */
export function shiftDateKeepRemaining(dateMs, oldExpiryMs, newExpiryMs, nowMs) {
  const rem = Number(oldExpiryMs) - Number(dateMs);
  let next = Number(newExpiryMs) - rem;
  const now = Number(nowMs);
  const end = Number(newExpiryMs);
  if (!Number.isFinite(next)) return now;
  if (next < now) next = now;
  if (next > end) next = end;
  return next;
}

/**
 * Strike-ruler window. Observed: ~32d → 520–690, ~54d → 380–840 around spot 608.45.
 * Independent of the RANGE slider (RANGE only scales the graph and table).
 */
export function rulerWindow(spot, dte) {
  const s = Number(spot) || 100;
  const d = Number.isFinite(Number(dte)) ? Number(dte) : 32;
  const half = 88 + (d - 32) * (230 - 88) / 22;
  const h = Math.max(50, half);
  const step = h > 150 ? 20 : 10;
  const lo = Math.round((s - h) / step) * step;
  const hi = Math.round((s + h) / step) * step;
  return { lo, hi };
}

/** Signed qty stepper: skip 0 (−1 ⇄ +1). Absolute value is clamped to 1..QTY_MAX. */
export function signedStep(current, dir) {
  const c = Number(current);
  const d = dir < 0 ? -1 : 1;
  if (!Number.isFinite(c)) return d;
  let n = c + d;
  if (n === 0) n = d;
  if (Math.abs(n) > QTY_MAX) return c;
  if (Math.abs(n) < 1) n = d;
  return n;
}

export function parseSignedQty(text) {
  const n = Number(String(text).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  const rounded = Math.round(n);
  if (rounded === 0 || Math.abs(rounded) > QTY_MAX) return null;
  return rounded;
}
