/**
 * Strategy templates and strike / expiry snapping against a live chain.
 * Strike choices are conveniences for v1, not an optimizer.
 */

export const TEMPLATES = [
  { id: "long_call", label: "Long call", group: "Basic" },
  { id: "short_call", label: "Short call", group: "Basic" },
  { id: "long_put", label: "Long put", group: "Basic" },
  { id: "short_put", label: "Short put", group: "Basic" },
  { id: "covered_call", label: "Covered call", group: "Stock" },
  { id: "cash_secured_put", label: "Cash-secured put", group: "Stock" },
  { id: "collar", label: "Collar", group: "Stock" },
  { id: "bull_call_spread", label: "Bull call spread", group: "Vertical" },
  { id: "bear_call_spread", label: "Bear call spread", group: "Vertical" },
  { id: "bull_put_spread", label: "Bull put spread", group: "Vertical" },
  { id: "bear_put_spread", label: "Bear put spread", group: "Vertical" },
  { id: "long_straddle", label: "Long straddle", group: "Volatility" },
  { id: "short_straddle", label: "Short straddle", group: "Volatility" },
  { id: "long_strangle", label: "Long strangle", group: "Volatility" },
  { id: "short_strangle", label: "Short strangle", group: "Volatility" },
  { id: "iron_condor", label: "Iron condor", group: "Income" },
  { id: "iron_butterfly", label: "Iron butterfly", group: "Income" },
  { id: "call_butterfly", label: "Call butterfly", group: "Income" },
  { id: "put_butterfly", label: "Put butterfly", group: "Income" },
  { id: "calendar_call", label: "Call calendar", group: "Time" },
  { id: "calendar_put", label: "Put calendar", group: "Time" },
  { id: "diagonal_call", label: "Call diagonal", group: "Time" },
  { id: "custom", label: "Custom", group: "Custom" },
];

function midOf(opt) {
  if (opt && Number.isFinite(opt.mid) && opt.mid > 0) return opt.mid;
  if (opt && Number.isFinite(opt.bid) && Number.isFinite(opt.ask) && opt.ask > 0) {
    return (opt.bid + opt.ask) / 2;
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
    if (d < bestD) {
      best = s;
      bestD = d;
    }
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

function pickContract(chain, expiry, type, strike) {
  const typ = type === "P" || type === "put" ? "put" : "call";
  const list = (chain && chain.options) || [];
  return list.find((o) => o.expiry === expiry && o.type === typ && Number(o.strike) === Number(strike)) || null;
}

function strikesFor(chain, expiry, type) {
  const typ = type === "P" || type === "put" ? "put" : "call";
  const set = new Set();
  for (const o of (chain && chain.options) || []) {
    if (o.expiry === expiry && o.type === typ) set.add(Number(o.strike));
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

function nextExpiryAfter(expiries, current) {
  const i = expiries.indexOf(current);
  if (i >= 0 && i < expiries.length - 1) return expiries[i + 1];
  // Prefer the next monthly-ish expiry (≥ 20 days later) if the next listed is a weekly.
  const t0 = Date.parse(current + "T00:00:00Z");
  for (const e of expiries) {
    const t = Date.parse(e + "T00:00:00Z");
    if (t - t0 >= 20 * 86400000) return e;
  }
  return expiries[expiries.length - 1] || current;
}

function makeLeg({ type, side, qty, strike, expiry, chain, style, kind }) {
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
    };
  }
  const typ = type === "P" || type === "put" ? "put" : "call";
  const c = pickContract(chain, expiry, typ, strike);
  const mid = midOf(c);
  return {
    id: typ[0] + Math.random().toString(36).slice(2, 8),
    kind: "option",
    type: typ === "put" ? "P" : "C",
    side,
    qty,
    strike,
    expiry,
    entry: mid,
    bid: c ? c.bid : null,
    ask: c ? c.ask : null,
    iv: c && c.iv > 0 ? c.iv : 0,
    oi: c ? c.oi : null,
    style,
  };
}

/**
 * Build a list of legs for a template, snapped to the chain.
 * `expiry` is the primary (usually short) expiration the user selected.
 */
export function buildTemplate(id, { chain, spot, expiry, style = "american" }) {
  const expiries = uniqueExpiries(chain);
  const exp = expiry || expiries[0];
  if (!exp || !spot) return [];
  const calls = strikesFor(chain, exp, "call");
  const puts = strikesFor(chain, exp, "put");
  const strikes = calls.length ? calls : puts;
  if (!strikes.length) return [];

  const atm = nearestStrike(strikes, spot);
  const otmCall = strikeAtOrAbove(strikes, spot * 1.03) || atm;
  const otmCall2 = strikeAtOrAbove(strikes, spot * 1.06) || otmCall;
  const otmPut = strikeAtOrBelow(strikes, spot * 0.97) || atm;
  const otmPut2 = strikeAtOrBelow(strikes, spot * 0.94) || otmPut;
  const farExp = nextExpiryAfter(expiries, exp);
  const laterCalls = strikesFor(chain, farExp, "call");
  const laterPuts = strikesFor(chain, farExp, "put");

  const L = (args) => makeLeg({ ...args, chain, style });

  switch (id) {
    case "long_call":
      return [L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp })];
    case "short_call":
      return [L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp })];
    case "long_put":
      return [L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp })];
    case "short_put":
    case "cash_secured_put":
      return [L({ type: "P", side: "sell", qty: 1, strike: otmPut, expiry: exp })];
    case "covered_call":
      return [
        L({ kind: "stock", side: "buy", qty: 100 }),
        L({ type: "C", side: "sell", qty: 1, strike: otmCall, expiry: exp }),
      ];
    case "collar":
      return [
        L({ kind: "stock", side: "buy", qty: 100 }),
        L({ type: "P", side: "buy", qty: 1, strike: otmPut, expiry: exp }),
        L({ type: "C", side: "sell", qty: 1, strike: otmCall, expiry: exp }),
      ];
    case "bull_call_spread":
      return [
        L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp }),
        L({ type: "C", side: "sell", qty: 1, strike: otmCall, expiry: exp }),
      ];
    case "bear_call_spread":
      return [
        L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
        L({ type: "C", side: "buy", qty: 1, strike: otmCall, expiry: exp }),
      ];
    case "bull_put_spread":
      return [
        L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
        L({ type: "P", side: "buy", qty: 1, strike: otmPut, expiry: exp }),
      ];
    case "bear_put_spread":
      return [
        L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp }),
        L({ type: "P", side: "sell", qty: 1, strike: otmPut, expiry: exp }),
      ];
    case "long_straddle":
      return [
        L({ type: "C", side: "buy", qty: 1, strike: atm, expiry: exp }),
        L({ type: "P", side: "buy", qty: 1, strike: atm, expiry: exp }),
      ];
    case "short_straddle":
      return [
        L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
        L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
      ];
    case "long_strangle":
      return [
        L({ type: "C", side: "buy", qty: 1, strike: otmCall, expiry: exp }),
        L({ type: "P", side: "buy", qty: 1, strike: otmPut, expiry: exp }),
      ];
    case "short_strangle":
      return [
        L({ type: "C", side: "sell", qty: 1, strike: otmCall, expiry: exp }),
        L({ type: "P", side: "sell", qty: 1, strike: otmPut, expiry: exp }),
      ];
    case "iron_condor":
      return [
        L({ type: "P", side: "buy", qty: 1, strike: otmPut2, expiry: exp }),
        L({ type: "P", side: "sell", qty: 1, strike: otmPut, expiry: exp }),
        L({ type: "C", side: "sell", qty: 1, strike: otmCall, expiry: exp }),
        L({ type: "C", side: "buy", qty: 1, strike: otmCall2, expiry: exp }),
      ];
    case "iron_butterfly":
      return [
        L({ type: "P", side: "buy", qty: 1, strike: otmPut, expiry: exp }),
        L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
        L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
        L({ type: "C", side: "buy", qty: 1, strike: otmCall, expiry: exp }),
      ];
    case "call_butterfly": {
      const low = otmPut !== atm ? nearestStrike(strikes, atm * 2 - otmCall) : strikeAtOrBelow(strikes, spot * 0.97);
      const high = otmCall;
      const mid = atm;
      return [
        L({ type: "C", side: "buy", qty: 1, strike: low || mid, expiry: exp }),
        L({ type: "C", side: "sell", qty: 2, strike: mid, expiry: exp }),
        L({ type: "C", side: "buy", qty: 1, strike: high, expiry: exp }),
      ];
    }
    case "put_butterfly": {
      const high = otmCall !== atm ? nearestStrike(strikes, atm * 2 - otmPut) : strikeAtOrAbove(strikes, spot * 1.03);
      return [
        L({ type: "P", side: "buy", qty: 1, strike: otmPut, expiry: exp }),
        L({ type: "P", side: "sell", qty: 2, strike: atm, expiry: exp }),
        L({ type: "P", side: "buy", qty: 1, strike: high, expiry: exp }),
      ];
    }
    case "calendar_call": {
      const k = laterCalls.length ? nearestStrike(laterCalls, atm) : atm;
      return [
        L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
        L({ type: "C", side: "buy", qty: 1, strike: k, expiry: farExp }),
      ];
    }
    case "calendar_put": {
      const k = laterPuts.length ? nearestStrike(laterPuts, atm) : atm;
      return [
        L({ type: "P", side: "sell", qty: 1, strike: atm, expiry: exp }),
        L({ type: "P", side: "buy", qty: 1, strike: k, expiry: farExp }),
      ];
    }
    case "diagonal_call": {
      const k = laterCalls.length ? nearestStrike(laterCalls, otmCall) : otmCall;
      return [
        L({ type: "C", side: "sell", qty: 1, strike: atm, expiry: exp }),
        L({ type: "C", side: "buy", qty: 1, strike: k, expiry: farExp }),
      ];
    }
    case "custom":
    default:
      return [];
  }
}

/** Compact, shareable encoding of builder state in the query string. */
export function encodeState(state) {
  const legs = (state.legs || []).map((l) => {
    if (l.kind === "stock" || l.type === "S") {
      return ["S", l.side === "sell" ? "s" : "b", String(l.qty), l.entry == null ? "" : String(l.entry)].join(":");
    }
    return [
      l.type === "P" || l.type === "put" ? "P" : "C",
      l.side === "sell" ? "s" : "b",
      String(l.qty),
      String(l.strike),
      l.expiry || "",
      l.entry == null ? "" : String(l.entry),
      l.iv == null ? "" : Number(l.iv).toFixed(4),
    ].join(":");
  });
  const p = new URLSearchParams();
  if (state.symbol) p.set("s", state.symbol);
  if (state.template) p.set("t", state.template);
  if (state.expiry) p.set("e", state.expiry);
  if (legs.length) p.set("legs", legs.join(","));
  if (state.ivShift) p.set("iv", String(state.ivShift));
  if (state.range && state.range !== 0.15) p.set("rng", String(state.range));
  if (state.display && state.display !== "usd") p.set("d", state.display);
  if (state.style && state.style !== "american") p.set("st", state.style);
  return p.toString();
}

export function decodeState(search) {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const state = {
    symbol: (p.get("s") || "").toUpperCase() || null,
    template: p.get("t") || null,
    expiry: p.get("e") || null,
    ivShift: Number(p.get("iv") || 0) || 0,
    range: Number(p.get("rng") || 0.15) || 0.15,
    display: p.get("d") || "usd",
    style: p.get("st") || "american",
    legs: [],
  };
  const raw = p.get("legs") || "";
  if (!raw) return state;
  for (const part of raw.split(",")) {
    const bits = part.split(":");
    if (bits[0] === "S") {
      state.legs.push({
        id: "s" + Math.random().toString(36).slice(2, 7),
        kind: "stock",
        type: "S",
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
      kind: "option",
      type: bits[0],
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
