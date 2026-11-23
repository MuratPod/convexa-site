/**
 * Strategy catalog, strike/expiry snapping, and shareable URL encoding.
 * Strike placement is a convenience, not an optimizer.
 * Description text is original Convexa wording, not copied from any third party.
 */

export function midOf(opt) {
  if (opt && Number.isFinite(opt.mid) && opt.mid > 0) return opt.mid;
  if (opt && Number.isFinite(opt.bid) && Number.isFinite(opt.ask) && opt.ask > 0) {
    return (Math.max(opt.bid, 0) + Math.max(opt.ask, opt.bid || 0)) / 2;
  }
  if (opt && Number.isFinite(opt.last) && opt.last > 0) return opt.last;
  return null;
}

export function nearestStrike(strikes, target) {
  if (!strikes.length) return target;
  let best = strikes[0];
  let bestD = Math.abs(best - target);
  for (const s of strikes) {
    const d = Math.abs(s - target);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

function strikeAtOrAbove(strikes, target) {
  for (const s of strikes) if (s >= target) return s;
  return strikes[strikes.length - 1];
}

function strikeAtOrBelow(strikes, target) {
  for (let i = strikes.length - 1; i >= 0; i--) if (strikes[i] <= target) return strikes[i];
  return strikes[0];
}

export function pickContract(chain, expiry, type, strike) {
  const typ = type === "P" || type === "put" ? "put" : "call";
  const list = (chain && chain.options) || [];
  return list.find((o) => o.expiry === expiry && o.type === typ && Number(o.strike) === Number(strike)) || null;
}

export function strikesFor(chain, expiry, type) {
  const typ = type === "P" || type === "put" ? "put" : "call";
  const set = new Set();
  for (const o of (chain && chain.options) || []) {
    if ((!expiry || o.expiry === expiry) && (!type || o.type === typ)) set.add(Number(o.strike));
  }
  return [...set].sort((a, b) => a - b);
}

export function uniqueExpiries(chain) {
  const xs = [];
  for (const e of (chain && chain.expirations) || []) {
    if (e && !xs.includes(e)) xs.push(e);
  }
  if (!xs.length) {
    for (const o of (chain && chain.options) || []) {
      if (o.expiry && !xs.includes(o.expiry)) xs.push(o.expiry);
    }
    xs.sort();
  }
  return xs;
}

export function expiryNearDays(expiries, days = 30, now = Date.now()) {
  if (!expiries.length) return null;
  const target = now + days * 86400000;
  let best = expiries[0];
  let bestD = Infinity;
  for (const e of expiries) {
    const t = Date.parse(e + "T16:00:00-05:00");
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - target);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

function nextExpiryAfter(expiries, current, minDays = 20) {
  const i = expiries.indexOf(current);
  if (i >= 0 && i < expiries.length - 1) {
    const t0 = Date.parse(current + "T00:00:00Z");
    const t1 = Date.parse(expiries[i + 1] + "T00:00:00Z");
    if (t1 - t0 >= minDays * 86400000) return expiries[i + 1];
  }
  const t0 = Date.parse(current + "T00:00:00Z");
  for (const e of expiries) {
    const t = Date.parse(e + "T00:00:00Z");
    if (t - t0 >= minDays * 86400000) return e;
  }
  return expiries[expiries.length - 1] || current;
}

export function makeLeg({ type, side, qty, strike, expiry, chain, style, kind, symbol }) {
  if (kind === "stock") {
    const px = chain && Number(chain.price);
    return {
      id: "s-" + Math.random().toString(36).slice(2, 8),
      kind: "stock",
      type: "S",
      side,
      qty,
      entry: Number.isFinite(px) ? px : null,
      iv: 0,
      style,
      symbol: symbol || chain?.symbol,
    };
  }
  const typ = type === "P" || type === "put" ? "put" : "call";
  const letter = typ === "put" ? "P" : "C";
  const c = pickContract(chain, expiry, typ, strike);
  return {
    id: letter + Math.random().toString(36).slice(2, 8),
    kind: "option",
    type: letter,
    side,
    qty,
    strike: Number(strike),
    expiry,
    entry: midOf(c),
    iv: c && c.iv > 0 ? c.iv : 0,
    bid: c?.bid ?? null,
    ask: c?.ask ?? null,
    last: c?.last ?? null,
    oi: c?.oi ?? null,
    volume: c?.volume ?? null,
    style,
    symbol: symbol || chain?.symbol,
    excluded: false,
    closed: false,
  };
}

const T = (id, label, level, group, bias, traits, blurb, legsText, diagram) => ({
  id, slug: id, label, level, group, bias, traits, blurb, legsText, diagram,
});

/** bias: bull | bear | neutral | vol | income */
export const CATALOG = [
  // Novice
  T("long-call", "Long Call", "Novice", "Basic", "bull",
    ["Bullish", "Unlimited profit", "Limited loss"],
    "Buy a call when you expect the underlying to rise. The most you can lose is the premium paid; upside is theoretically open.",
    "Buy a call at strike A.", "A"),
  T("long-put", "Long Put", "Novice", "Basic", "bear",
    ["Bearish", "Large profit potential", "Limited loss"],
    "Buy a put when you expect the underlying to fall. Loss is capped at the premium; profit grows as the price drops toward zero.",
    "Buy a put at strike A.", "A"),
  T("covered-call", "Covered Call", "Novice", "Income", "income",
    ["Income", "Limited profit", "Stock risk"],
    "Own the shares and sell a call against them. You keep the credit if the shares stay below the strike, and cap upside if they rally.",
    "Buy 100 shares. Sell a call at strike A.", "A"),
  T("cash-secured-put", "Cash-Secured Put", "Novice", "Income", "income",
    ["Income", "Bullish-to-neutral", "Limited profit"],
    "Sell a put and set aside cash to buy the shares if assigned. You keep the credit if the put expires worthless.",
    "Sell a put at strike A, cash reserved for assignment.", "A"),
  T("protective-put", "Protective Put", "Novice", "Other", "bear",
    ["Hedge", "Defined downside", "Stock plus put"],
    "Hold the shares and buy a put as a floor. You keep upside in the stock, less the premium spent on protection.",
    "Buy 100 shares. Buy a put at strike A.", "A"),

  // Intermediate
  T("bull-put-spread", "Bull Put Spread", "Intermediate", "Credit spreads", "bull",
    ["Bullish", "Limited profit", "Limited loss"],
    "Sell a put and buy a cheaper put further out of the money. A credit if the underlying stays above the short strike.",
    "Sell a put at B. Buy a put at A.", "A B"),
  T("bear-call-spread", "Bear Call Spread", "Intermediate", "Credit spreads", "bear",
    ["Bearish", "Limited profit", "Limited loss"],
    "Sell a call and buy a further out-of-the-money call. You keep the credit if the underlying stays below the short strike.",
    "Sell a call at A. Buy a call at B.", "A B"),
  T("iron-butterfly", "Iron Butterfly", "Intermediate", "Neutral", "neutral",
    ["Neutral", "Limited profit", "Limited loss"],
    "Sell an at-the-money straddle and buy wings on both sides. Best if the underlying finishes near the short strike.",
    "Buy a put at A. Sell a put and a call at B. Buy a call at C.", "A B C"),
  T("iron-condor", "Iron Condor", "Intermediate", "Neutral", "neutral",
    ["Neutral", "Limited profit", "Limited loss"],
    "Sell an out-of-the-money put spread and an out-of-the-money call spread. A credit if the underlying stays between the short strikes.",
    "Buy a put at A. Sell a put at B. Sell a call at C. Buy a call at D.", "A B C D"),
  T("long-put-butterfly", "Long Put Butterfly", "Intermediate", "Neutral", "neutral",
    ["Neutral", "Limited profit", "Limited loss"],
    "Buy one lower put, sell two at the body, buy one higher put. Peak payoff if the underlying lands at the middle strike.",
    "Buy a put at A. Sell two puts at B. Buy a put at C.", "A B C"),
  T("long-call-butterfly", "Long Call Butterfly", "Intermediate", "Neutral", "neutral",
    ["Neutral", "Limited profit", "Limited loss"],
    "Buy one lower call, sell two at the body, buy one higher call. Peak payoff if the underlying lands at the middle strike.",
    "Buy a call at A. Sell two calls at B. Buy a call at C.", "A B C"),
  T("calendar-call-spread", "Calendar Call Spread", "Intermediate", "Calendar spreads", "neutral",
    ["Time", "Limited risk", "Two expiries"],
    "Sell a nearer-dated call and buy a later-dated call at the same strike. You are long time, typically at a net debit.",
    "Sell a nearer call at A. Buy a later call at A.", "A"),
  T("calendar-put-spread", "Calendar Put Spread", "Intermediate", "Calendar spreads", "neutral",
    ["Time", "Limited risk", "Two expiries"],
    "Sell a nearer-dated put and buy a later-dated put at the same strike. A debit structure that benefits if the price stays near the strike.",
    "Sell a nearer put at A. Buy a later put at A.", "A"),
  T("diagonal-call-spread", "Diagonal Call Spread", "Intermediate", "Calendar spreads", "bull",
    ["Bullish", "Two expiries", "Limited risk"],
    "Sell a nearer call and buy a later call at a different strike, usually further out of the money.",
    "Sell a nearer call at A. Buy a later call at B.", "A B"),
  T("diagonal-put-spread", "Diagonal Put Spread", "Intermediate", "Calendar spreads", "bear",
    ["Bearish", "Two expiries", "Limited risk"],
    "Sell a nearer put and buy a later put at a different strike, usually further out of the money.",
    "Sell a nearer put at B. Buy a later put at A.", "A B"),
  T("bull-call-spread", "Bull Call Spread", "Intermediate", "Debit spreads", "bull",
    ["Bullish", "Limited profit", "Limited loss"],
    "Buy a call and sell a higher-strike call. A debit that profits if the underlying rises toward the short strike.",
    "Buy a call at A. Sell a call at B.", "A B"),
  T("bear-put-spread", "Bear Put Spread", "Intermediate", "Debit spreads", "bear",
    ["Bearish", "Limited profit", "Limited loss"],
    "Buy a put and sell a lower-strike put. A debit that profits if the underlying falls toward the short strike.",
    "Buy a put at B. Sell a put at A.", "A B"),
  T("inverse-iron-butterfly", "Inverse Iron Butterfly", "Intermediate", "Directional", "vol",
    ["Long volatility", "Limited profit", "Limited loss"],
    "The debit reverse of an iron butterfly: buy the body and sell the wings. Profits if the underlying moves away from the middle strike.",
    "Sell a put at A. Buy a put and a call at B. Sell a call at C.", "A B C"),
  T("inverse-iron-condor", "Inverse Iron Condor", "Intermediate", "Directional", "vol",
    ["Long volatility", "Limited profit", "Limited loss"],
    "Buy the inner put and call, sell the further wings. A debit if you expect a larger move than the short iron condor wants.",
    "Sell a put at A. Buy a put at B. Buy a call at C. Sell a call at D.", "A B C D"),
  T("short-put-butterfly", "Short Put Butterfly", "Intermediate", "Directional", "vol",
    ["Long volatility", "Limited profit", "Limited loss"],
    "The short form of a put butterfly: sell the wings and buy the body. Profits if the underlying moves away from the middle strike.",
    "Sell a put at A. Buy two puts at B. Sell a put at C.", "A B C"),
  T("short-call-butterfly", "Short Call Butterfly", "Intermediate", "Directional", "vol",
    ["Long volatility", "Limited profit", "Limited loss"],
    "The short form of a call butterfly: sell the wings and buy the body.",
    "Sell a call at A. Buy two calls at B. Sell a call at C.", "A B C"),
  T("straddle", "Straddle", "Intermediate", "Directional", "vol",
    ["Long volatility", "Unlimited profit", "Limited loss"],
    "Buy a call and a put at the same strike, usually at the money. Profits if the move is larger than the combined premium.",
    "Buy a call and a put at strike A.", "A"),
  T("strangle", "Strangle", "Intermediate", "Directional", "vol",
    ["Long volatility", "Unlimited profit", "Limited loss"],
    "Buy an out-of-the-money call and put. Cheaper than a straddle; needs a larger move to pay.",
    "Buy a put at A. Buy a call at B.", "A B"),
  T("collar", "Collar", "Intermediate", "Other", "neutral",
    ["Hedge", "Limited profit", "Limited loss"],
    "Own the shares, buy a put for a floor, and sell a call to help pay for it. Upside and downside are both bounded.",
    "Buy 100 shares. Buy a put at A. Sell a call at B.", "A B"),

  // Advanced
  T("short-put", "Short Put", "Advanced", "Naked", "bull",
    ["Bullish", "Limited profit", "Large loss"],
    "Sell a put with no long put underneath. You keep the credit if it expires worthless, and take stock or cash risk if it does not.",
    "Sell a put at strike A.", "A"),
  T("short-call", "Short Call", "Advanced", "Naked", "bear",
    ["Bearish", "Limited profit", "Unlimited loss"],
    "Sell a call with no long call or stock underneath. Loss is theoretically unlimited if the underlying rallies.",
    "Sell a call at strike A.", "A"),
  T("short-straddle", "Short Straddle", "Advanced", "Neutral", "neutral",
    ["Short volatility", "Limited profit", "Unlimited loss"],
    "Sell a call and a put at the same strike. You keep the credit if the underlying stays near that strike.",
    "Sell a call and a put at strike A.", "A"),
  T("short-strangle", "Short Strangle", "Advanced", "Neutral", "neutral",
    ["Short volatility", "Limited profit", "Unlimited loss"],
    "Sell an out-of-the-money call and put. A wider window than a short straddle, at a smaller credit.",
    "Sell a put at A. Sell a call at B.", "A B"),
  T("long-call-condor", "Long Call Condor", "Advanced", "Neutral", "neutral",
    ["Neutral", "Limited profit", "Limited loss"],
    "A four-strike call structure with a flat peak between the two middle strikes.",
    "Buy a call at A. Sell a call at B. Sell a call at C. Buy a call at D.", "A B C D"),
  T("long-put-condor", "Long Put Condor", "Advanced", "Neutral", "neutral",
    ["Neutral", "Limited profit", "Limited loss"],
    "A four-strike put structure with a flat peak between the two middle strikes.",
    "Buy a put at A. Sell a put at B. Sell a put at C. Buy a put at D.", "A B C D"),
  T("call-ratio-backspread", "Call Ratio Backspread", "Advanced", "Ratio spreads", "vol",
    ["Bullish volatility", "Unlimited upside", "Limited risk"],
    "Sell one nearer call and buy more further-out calls. A debit or small credit that profits from a sharp rally.",
    "Sell one call at A. Buy two calls at B.", "A B"),
  T("put-broken-wing", "Put Broken Wing", "Advanced", "Ratio spreads", "bear",
    ["Skewed butterfly", "Limited risk", "Defined payoff"],
    "A put butterfly with uneven wings, so one side has a different width and a residual credit or debit.",
    "Buy a put at A. Sell two puts at B. Buy a put at a closer C.", "A B C"),
  T("inverse-call-broken-wing", "Inverse Call Broken Wing", "Advanced", "Ratio spreads", "vol",
    ["Skewed", "Defined risk"],
    "The short, uneven call butterfly: risk and reward are tilted to one side of the body.",
    "Sell a call at A. Buy two calls at B. Sell a closer call at C.", "A B C"),
  T("put-ratio-backspread", "Put Ratio Backspread", "Advanced", "Ratio spreads", "vol",
    ["Bearish volatility", "Large downside profit", "Limited risk"],
    "Sell one nearer put and buy more further-out puts. Profits from a sharp decline.",
    "Sell one put at B. Buy two puts at A.", "A B"),
  T("call-broken-wing", "Call Broken Wing", "Advanced", "Ratio spreads", "bull",
    ["Skewed butterfly", "Limited risk"],
    "A call butterfly with uneven wings.",
    "Buy a call at A. Sell two calls at B. Buy a closer call at C.", "A B C"),
  T("inverse-put-broken-wing", "Inverse Put Broken Wing", "Advanced", "Ratio spreads", "vol",
    ["Skewed", "Defined risk"],
    "The short, uneven put butterfly.",
    "Sell a put at A. Buy two puts at B. Sell a closer put at C.", "A B C"),
  T("covered-short-straddle", "Covered Short Straddle", "Advanced", "Income", "income",
    ["Income", "Stock plus short straddle"],
    "Own the shares and sell both an at-the-money call and put. Income with equity and short-put risk.",
    "Buy 100 shares. Sell a call and a put at A.", "A"),
  T("covered-short-strangle", "Covered Short Strangle", "Advanced", "Income", "income",
    ["Income", "Stock plus short strangle"],
    "Own the shares and sell an out-of-the-money call and put.",
    "Buy 100 shares. Sell a put at A. Sell a call at B.", "A B"),
  T("short-call-condor", "Short Call Condor", "Advanced", "Directional", "vol",
    ["Long volatility", "Limited profit", "Limited loss"],
    "The short form of a call condor: profits if the underlying moves outside the inner strikes.",
    "Sell a call at A. Buy a call at B. Buy a call at C. Sell a call at D.", "A B C D"),
  T("short-put-condor", "Short Put Condor", "Advanced", "Directional", "vol",
    ["Long volatility", "Limited profit", "Limited loss"],
    "The short form of a put condor.",
    "Sell a put at A. Buy a put at B. Buy a put at C. Sell a put at D.", "A B C D"),
  T("bull-call-ladder", "Bull Call Ladder", "Advanced", "Ladders", "bull",
    ["Bullish", "Three strikes"],
    "Buy a lower call, sell a middle call, and sell a further call. Upside beyond the last strike turns against you.",
    "Buy a call at A. Sell a call at B. Sell a call at C.", "A B C"),
  T("bear-call-ladder", "Bear Call Ladder", "Advanced", "Ladders", "bear",
    ["Bearish", "Three strikes"],
    "Sell a lower call, buy a middle, buy a further call — a ladder tilted for a decline.",
    "Sell a call at A. Buy a call at B. Buy a call at C.", "A B C"),
  T("bull-put-ladder", "Bull Put Ladder", "Advanced", "Ladders", "bull",
    ["Bullish", "Three strikes"],
    "A three-strike put ladder built to benefit if the underlying stays up.",
    "Sell a put at C. Buy a put at B. Buy a put at A.", "A B C"),
  T("bear-put-ladder", "Bear Put Ladder", "Advanced", "Ladders", "bear",
    ["Bearish", "Three strikes"],
    "Buy a higher put, sell a middle put, and sell a further put.",
    "Buy a put at C. Sell a put at B. Sell a put at A.", "A B C"),
  T("jade-lizard", "Jade Lizard", "Advanced", "Other", "bull",
    ["Bullish-to-neutral", "Credit", "No upside call risk if structured so"],
    "A short put plus a short call spread, typically sized so the credit exceeds the call-spread width.",
    "Sell a put at A. Sell a call at B. Buy a call at C.", "A B C"),
  T("reverse-jade-lizard", "Reverse Jade Lizard", "Advanced", "Other", "bear",
    ["Bearish-to-neutral", "Credit"],
    "A short call plus a short put spread — the mirror of a jade lizard.",
    "Buy a put at A. Sell a put at B. Sell a call at C.", "A B C"),

  // Expert
  T("call-ratio-spread", "Call Ratio Spread", "Expert", "Ratio spreads", "bear",
    ["Ratio", "Limited profit", "Upside risk"],
    "Buy one call and sell more higher-strike calls. A credit or small debit; risk is to the upside.",
    "Buy one call at A. Sell two calls at B.", "A B"),
  T("put-ratio-spread", "Put Ratio Spread", "Expert", "Ratio spreads", "bull",
    ["Ratio", "Limited profit", "Downside risk"],
    "Buy one put and sell more lower-strike puts. Risk is to the downside.",
    "Buy one put at B. Sell two puts at A.", "A B"),
  T("long-synthetic-future", "Long Synthetic Future", "Expert", "Synthetic", "bull",
    ["Bullish", "Futures-like"],
    "Buy a call and sell a put at the same strike. The payoff tracks a long share position, financed in the options market.",
    "Buy a call at A. Sell a put at A.", "A"),
  T("short-synthetic-future", "Short Synthetic Future", "Expert", "Synthetic", "bear",
    ["Bearish", "Futures-like"],
    "Sell a call and buy a put at the same strike. The payoff tracks a short share position.",
    "Sell a call at A. Buy a put at A.", "A"),
  T("synthetic-put", "Synthetic Put", "Expert", "Synthetic", "bear",
    ["Bearish", "Stock plus call"],
    "Short the shares and buy a call. The combination behaves like a long put.",
    "Sell 100 shares. Buy a call at A.", "A"),
  T("long-combo", "Long Combo", "Expert", "Arbitrage", "bull",
    ["Bullish", "Synthetic long"],
    "Buy a call and sell a put, often at different strikes, to build a synthetic long at a chosen level.",
    "Buy a call at B. Sell a put at A.", "A B"),
  T("short-combo", "Short Combo", "Expert", "Arbitrage", "bear",
    ["Bearish", "Synthetic short"],
    "Sell a call and buy a put to build a synthetic short.",
    "Sell a call at B. Buy a put at A.", "A B"),
  T("strip", "Strip", "Expert", "Other", "vol",
    ["Bearish volatility", "Two puts, one call"],
    "Buy one at-the-money call and two at-the-money puts. A stronger bet on a decline than a straddle.",
    "Buy one call at A. Buy two puts at A.", "A"),
  T("strap", "Strap", "Expert", "Other", "vol",
    ["Bullish volatility", "Two calls, one put"],
    "Buy two at-the-money calls and one at-the-money put. A stronger bet on a rally than a straddle.",
    "Buy two calls at A. Buy one put at A.", "A"),
  T("guts", "Guts", "Expert", "Other", "vol",
    ["Long volatility", "In-the-money strangle"],
    "Buy an in-the-money call and an in-the-money put. A rich, already-intrinsic long-volatility structure.",
    "Buy a put at B. Buy a call at A.", "A B"),
  T("short-guts", "Short Guts", "Expert", "Other", "neutral",
    ["Short volatility", "In-the-money short strangle"],
    "Sell an in-the-money call and put. A large credit with substantial risk if the underlying trends.",
    "Sell a put at B. Sell a call at A.", "A B"),
  T("double-diagonal", "Double Diagonal", "Expert", "Other", "neutral",
    ["Two expiries", "Time and wings"],
    "Sell a nearer strangle and buy a later, usually wider, strangle. A calendar on both sides of the spot.",
    "Sell a nearer put at B and call at C. Buy a later put at A and call at D.", "A B C D"),
  T("custom", "Custom", "Expert", "Other", "neutral",
    ["Build your own", "Add legs"],
    "Start from an empty book and add calls, puts or shares. Figures still come from the same pricing model as the named templates.",
    "Add the legs you want.", ""),
];

export const CATALOG_BY_SLUG = Object.fromEntries(CATALOG.map((t) => [t.slug, t]));
export const LEVELS = ["Novice", "Intermediate", "Advanced", "Expert"];

export function templateBySlug(slug) {
  if (!slug) return null;
  return CATALOG_BY_SLUG[String(slug).toLowerCase()] || null;
}

/** Older v1 ids → current slugs */
const LEGACY = {
  long_call: "long-call", short_call: "short-call", long_put: "long-put", short_put: "short-put",
  covered_call: "covered-call", cash_secured_put: "cash-secured-put", collar: "collar",
  bull_call_spread: "bull-call-spread", bear_call_spread: "bear-call-spread",
  bull_put_spread: "bull-put-spread", bear_put_spread: "bear-put-spread",
  long_straddle: "straddle", short_straddle: "short-straddle",
  long_strangle: "strangle", short_strangle: "short-strangle",
  iron_condor: "iron-condor", iron_butterfly: "iron-butterfly",
  call_butterfly: "long-call-butterfly", put_butterfly: "long-put-butterfly",
  calendar_call: "calendar-call-spread", calendar_put: "calendar-put-spread",
  diagonal_call: "diagonal-call-spread", custom: "custom",
};

export function normalizeSlug(id) {
  if (!id) return "iron-condor";
  const s = String(id).toLowerCase();
  return LEGACY[s] || s;
}

export const TEMPLATES = CATALOG.map((t) => ({ id: t.slug, label: t.label, group: t.group, level: t.level }));

export function buildTemplate(id, { chain, spot, expiry, style = "american" }) {
  const slug = normalizeSlug(id);
  const expiries = uniqueExpiries(chain);
  const exp = expiry || expiryNearDays(expiries, 30) || expiries[0];
  if (!exp || !spot) return [];
  const calls = strikesFor(chain, exp, "call");
  const puts = strikesFor(chain, exp, "put");
  const strikes = (calls.length ? calls : puts).slice();
  if (!strikes.length) return [];

  const atm = nearestStrike(strikes, spot);
  const k = (pct, dir) => dir < 0
    ? strikeAtOrBelow(strikes, spot * (1 + dir * Math.abs(pct)))
    : strikeAtOrAbove(strikes, spot * (1 + pct));
  // Wings used on the reference iron condor sit near ±4% / ±8%.
  const p4 = k(0.04, -1) || atm;
  const p8 = k(0.08, -1) || p4;
  const c4 = k(0.04, 1) || atm;
  const c8 = k(0.08, 1) || c4;
  const p2 = k(0.02, -1) || atm;
  const c2 = k(0.02, 1) || atm;
  const itmC = strikeAtOrBelow(strikes, spot * 0.97) || atm;
  const itmP = strikeAtOrAbove(strikes, spot * 1.03) || atm;
  const farExp = nextExpiryAfter(expiries, exp, 18);
  const laterCalls = strikesFor(chain, farExp, "call");
  const laterPuts = strikesFor(chain, farExp, "put");
  const laterStrikes = laterCalls.length ? laterCalls : laterPuts;
  const farAtm = laterStrikes.length ? nearestStrike(laterStrikes, atm) : atm;
  const farP8 = laterPuts.length ? nearestStrike(laterPuts, p8) : p8;
  const farC8 = laterCalls.length ? nearestStrike(laterCalls, c8) : c8;

  const L = (args) => makeLeg({ ...args, chain, style, symbol: chain?.symbol });

  const body = {
    "long-call": () => [L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp })],
    "long-put": () => [L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp })],
    "covered-call": () => [
      L({ kind: "stock", side: "buy", qty: 100 }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
    ],
    "cash-secured-put": () => [L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp })],
    "protective-put": () => [
      L({ kind: "stock", side: "buy", qty: 100 }),
      L({ type: "P", side: "buy", qty: 1, strike: p4, expiry: exp }),
    ],
    "bull-put-spread": () => [
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: p8, expiry: exp }),
    ],
    "bear-call-spread": () => [
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c8, expiry: exp }),
    ],
    "iron-butterfly": () => [
      L({ type: "P", side: "buy", qty: 1, strike: p4, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c4, expiry: exp }),
    ],
    "iron-condor": () => [
      L({ type: "P", side: "buy", qty: 1, strike: p8, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c8, expiry: exp }),
    ],
    "long-put-butterfly": () => [
      L({ type: "P", side: "buy", qty: 1, strike: p8, expiry: exp }),
      L({ type: "P", side: "sell", qty: 2, strike: atm, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: c4, expiry: exp }),
    ],
    "long-call-butterfly": () => [
      L({ type: "C", side: "buy", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 2, strike: atm, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c8, expiry: exp }),
    ],
    "calendar-call-spread": () => [
      L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: farAtm, expiry: farExp }),
    ],
    "calendar-put-spread": () => [
      L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: farAtm, expiry: farExp }),
    ],
    "diagonal-call-spread": () => [
      L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: laterCalls.length ? nearestStrike(laterCalls, c4) : c4, expiry: farExp }),
    ],
    "diagonal-put-spread": () => [
      L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: laterPuts.length ? nearestStrike(laterPuts, p4) : p4, expiry: farExp }),
    ],
    "bull-call-spread": () => [
      L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
    ],
    "bear-put-spread": () => [
      L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
    ],
    "inverse-iron-butterfly": () => [
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
    ],
    "inverse-iron-condor": () => [
      L({ type: "P", side: "sell", qty: 1, strike: p8, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c8, expiry: exp }),
    ],
    "short-put-butterfly": () => [
      L({ type: "P", side: "sell", qty: 1, strike: p8, expiry: exp }),
      L({ type: "P", side: "buy", qty: 2, strike: atm, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: c4, expiry: exp }),
    ],
    "short-call-butterfly": () => [
      L({ type: "C", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "buy", qty: 2, strike: atm, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c8, expiry: exp }),
    ],
    "straddle": () => [
      L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp }),
    ],
    "strangle": () => [
      L({ type: "P", side: "buy", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c4, expiry: exp }),
    ],
    "collar": () => [
      L({ kind: "stock", side: "buy", qty: 100 }),
      L({ type: "P", side: "buy", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
    ],
    "short-put": () => [L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp })],
    "short-call": () => [L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp })],
    "short-straddle": () => [
      L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
    ],
    "short-strangle": () => [
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
    ],
    "long-call-condor": () => [
      L({ type: "C", side: "buy", qty: 1, strike: p8, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c8, expiry: exp }),
    ],
    "long-put-condor": () => [
      L({ type: "P", side: "buy", qty: 1, strike: p8, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: c4, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: c8, expiry: exp }),
    ],
    "call-ratio-backspread": () => [
      L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "buy", qty: 2, strike: c4, expiry: exp }),
    ],
    "put-ratio-backspread": () => [
      L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "buy", qty: 2, strike: p4, expiry: exp }),
    ],
    "call-ratio-spread": () => [
      L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "sell", qty: 2, strike: c4, expiry: exp }),
    ],
    "put-ratio-spread": () => [
      L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "sell", qty: 2, strike: p4, expiry: exp }),
    ],
    "put-broken-wing": () => [
      L({ type: "P", side: "buy", qty: 1, strike: p8, expiry: exp }),
      L({ type: "P", side: "sell", qty: 2, strike: atm, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: p2, expiry: exp }),
    ],
    "call-broken-wing": () => [
      L({ type: "C", side: "buy", qty: 1, strike: c2, expiry: exp }),
      L({ type: "C", side: "sell", qty: 2, strike: atm, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c8, expiry: exp }),
    ],
    "inverse-call-broken-wing": () => [
      L({ type: "C", side: "sell", qty: 1, strike: c2, expiry: exp }),
      L({ type: "C", side: "buy", qty: 2, strike: atm, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c8, expiry: exp }),
    ],
    "inverse-put-broken-wing": () => [
      L({ type: "P", side: "sell", qty: 1, strike: p8, expiry: exp }),
      L({ type: "P", side: "buy", qty: 2, strike: atm, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: p2, expiry: exp }),
    ],
    "covered-short-straddle": () => [
      L({ kind: "stock", side: "buy", qty: 100 }),
      L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
    ],
    "covered-short-strangle": () => [
      L({ kind: "stock", side: "buy", qty: 100 }),
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
    ],
    "short-call-condor": () => [
      L({ type: "C", side: "sell", qty: 1, strike: p8, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c8, expiry: exp }),
    ],
    "short-put-condor": () => [
      L({ type: "P", side: "sell", qty: 1, strike: p8, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: p4, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: c4, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: c8, expiry: exp }),
    ],
    "bull-call-ladder": () => [
      L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c8, expiry: exp }),
    ],
    "bear-call-ladder": () => [
      L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c4, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c8, expiry: exp }),
    ],
    "bull-put-ladder": () => [
      L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: p4, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: p8, expiry: exp }),
    ],
    "bear-put-ladder": () => [
      L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: p8, expiry: exp }),
    ],
    "jade-lizard": () => [
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c8, expiry: exp }),
    ],
    "reverse-jade-lizard": () => [
      L({ type: "P", side: "buy", qty: 1, strike: p8, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
    ],
    "long-synthetic-future": () => [
      L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
    ],
    "short-synthetic-future": () => [
      L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp }),
    ],
    "synthetic-put": () => [
      L({ kind: "stock", side: "sell", qty: 100 }),
      L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp }),
    ],
    "long-combo": () => [
      L({ type: "P", side: "sell", qty: 1, strike: p2, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: c2, expiry: exp }),
    ],
    "short-combo": () => [
      L({ type: "P", side: "buy", qty: 1, strike: p2, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c2, expiry: exp }),
    ],
    "strip": () => [
      L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp }),
      L({ type: "P", side: "buy", qty: 2, strike: atm, expiry: exp }),
    ],
    "strap": () => [
      L({ type: "C", side: "buy", qty: 2, strike: atm, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp }),
    ],
    "guts": () => [
      L({ type: "P", side: "buy", qty: 1, strike: itmP, expiry: exp }),
      L({ type: "C", side: "buy", qty: 1, strike: itmC, expiry: exp }),
    ],
    "short-guts": () => [
      L({ type: "P", side: "sell", qty: 1, strike: itmP, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: itmC, expiry: exp }),
    ],
    "custom": () => [],
    "double-diagonal": () => [
      L({ type: "P", side: "sell", qty: 1, strike: p4, expiry: exp }),
      L({ type: "C", side: "sell", qty: 1, strike: c4, expiry: exp }),
      L({ type: "P", side: "buy", qty: 1, strike: farP8, expiry: farExp }),
      L({ type: "C", side: "buy", qty: 1, strike: farC8, expiry: farExp }),
    ],
  };

  const fn = body[slug];
  return fn ? fn() : [];
}

export function formatOcc(symbol, expiry, type, strike) {
  const sym = String(symbol || "").toUpperCase();
  const ymd = String(expiry || "").replace(/-/g, "");
  const yyMMdd = ymd.length === 8 ? ymd.slice(2) : ymd;
  const right = type === "P" || type === "put" ? "P" : "C";
  const k = Number(strike);
  const ks = Number.isInteger(k) ? String(k) : String(k);
  return `${sym}${yyMMdd}${right}${ks}`;
}

export function parseOcc(token) {
  const m = String(token || "").toUpperCase().match(/^([A-Z][A-Z0-9.]{0,9}?)(\d{6})([CP])(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const yy = Number(m[2].slice(0, 2));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const mo = m[2].slice(2, 4);
  const dd = m[2].slice(4, 6);
  return { symbol: m[1], expiry: `${year}-${mo}-${dd}`, type: m[3], strike: Number(m[4]) };
}

export function encodePath({ template, symbol, legs }) {
  const slug = normalizeSlug(template || "iron-condor");
  const sym = "QQQ";
  const parts = (legs || []).filter((l) => !l.closed).map((l) => {
    const short = l.side === "sell";
    const qty = Number(l.qty) || 1;
    const qtyBit = qty !== 1 && !(l.kind === "stock" && qty === 100) ? String(qty) : "";
    if (l.kind === "stock" || l.type === "S") {
      return `${short ? "-" : ""}${qtyBit}.${sym}`;
    }
    return `${short ? "-" : ""}${qtyBit}.${formatOcc(l.symbol || sym, l.expiry, l.type, l.strike)}`;
  });
  const tail = parts.join(",");
  return tail ? `/builder/${slug}/${sym}/${tail}` : `/builder/${slug}/${sym}`;
}

export function parseBuilderPath(pathname) {
  const raw = String(pathname || "").replace(/\/+$/, "") || "/";
  if (raw === "/builder" || raw === "/") {
    return { template: "iron-condor", symbol: "QQQ", legs: null, entries: [] };
  }
  if (!raw.startsWith("/builder/") && raw !== "/builder") return null;
  const parts = raw === "/builder" ? [] : raw.slice("/builder/".length).split("/").filter(Boolean);
  let template = "iron-condor";
  let rest = "";
  if (parts.length) {
    const first = normalizeSlug(parts[0]);
    if (templateBySlug(first) || first === "custom") {
      template = first === "custom" || templateBySlug(first) ? first : "iron-condor";
      if (templateBySlug(first) || first === "custom") template = first;
      rest = parts.slice(parts[1] && /^[A-Za-z][A-Za-z0-9.]{0,9}$/.test(parts[1]) ? 2 : 1).join("/");
    } else if (/^[A-Za-z][A-Za-z0-9.]{0,9}$/.test(parts[0]) && (parts.length < 2 || !templateBySlug(normalizeSlug(parts[0])))) {
      // /builder/QQQ or /builder/QQQ/<legs>
      rest = parts.slice(1).join("/");
    } else {
      template = first || "iron-condor";
      rest = parts.slice(parts[1] && /^[A-Za-z][A-Za-z0-9.]{0,9}$/.test(parts[1]) ? 2 : 1).join("/");
    }
  }
  const out = { template: templateBySlug(template) || template === "custom" ? template : "iron-condor", symbol: "QQQ", legs: null, entries: [] };
  if (!rest) return out;
  const entries = [];
  for (const part of rest.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const mm = p.match(/^(-)?(\d+)?\.(.+)$/);
    if (!mm) continue;
    const side = mm[1] ? "sell" : "buy";
    const token = mm[3];
    const occ = parseOcc(token);
    if (occ) {
      entries.push({
        kind: "option",
        type: occ.type,
        side,
        qty: mm[2] ? Number(mm[2]) : 1,
        strike: occ.strike,
        expiry: occ.expiry,
        symbol: occ.symbol,
      });
    } else {
      entries.push({
        kind: "stock",
        type: "S",
        side,
        qty: mm[2] ? Number(mm[2]) : 100,
        symbol: String(token).toUpperCase(),
      });
    }
  }
  if (entries.length) {
    out.legs = entries;
    out.entries = entries;
  }
  out.symbol = "QQQ";
  return out;
}

/** Path used to share the current strategy. Always QQQ on this public builder. */
export function encodeState(state) {
  return encodePath({
    template: state && state.template,
    symbol: "QQQ",
    legs: state && state.legs,
  });
}

export function decodeState(search, pathname) {
  const pathName = pathname || (typeof location !== "undefined" ? location.pathname : "");
  const fromPath = parseBuilderPath(pathName);
  const p = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const bare = /^\/builder\/?$/.test(pathName) || /^\/builder\/QQQ\/?$/.test(pathName);
  const template = (!bare && fromPath && fromPath.template)
    || normalizeSlug(p.get("t") || (fromPath && fromPath.template) || "iron-condor");
  const state = {
    symbol: "QQQ",
    template,
    expiry: p.get("e") || null,
    ivMult: Number(p.get("ivm") || 1) || 1,
    ivShift: Number(p.get("iv") || 0) || 0,
    range: Number(p.get("rng") || 0.12) || 0.12,
    display: p.get("d") || "usd",
    style: p.get("st") || "american",
    legs: fromPath && fromPath.entries && fromPath.entries.length ? fromPath.entries.map((e) => ({
      ...e,
      id: (e.type || "L") + Math.random().toString(36).slice(2, 7),
      entry: null,
      iv: 0,
    })) : [],
  };
  if (state.legs.length) return state;
  const raw = p.get("legs") || "";
  if (!raw) return state;
  for (const part of raw.split(",")) {
    const bits = part.split(":");
    if (bits[0] === "S") {
      state.legs.push({
        id: "s" + Math.random().toString(36).slice(2, 7),
        kind: "stock", type: "S",
        side: bits[1] === "s" ? "sell" : "buy",
        qty: Number(bits[2] || 100) || 100,
        entry: bits[3] === "" ? null : Number(bits[3]),
        iv: 0,
      });
      continue;
    }
    if (bits[0] !== "C" && bits[0] !== "P") continue;
    state.legs.push({
      id: bits[0] + Math.random().toString(36).slice(2, 7),
      kind: "option", type: bits[0],
      side: bits[1] === "s" ? "sell" : "buy",
      qty: Number(bits[2] || 1) || 1,
      strike: Number(bits[3]),
      expiry: bits[4] || state.expiry,
      entry: bits[5] === "" || bits[5] == null ? null : Number(bits[5]),
      iv: bits[6] === "" || bits[6] == null ? 0 : Number(bits[6]),
    });
  }
  return state;
}
