import {
  chanceOfProfit,
  expiryCloseUtc,
  formatMoney,
  impliedVol,
  netGreeks,
  positionPnL,
  yearsUntil,
  MULTIPLIER,
} from "./pricing.js";
import {
  TEMPLATES,
  buildTemplate,
  decodeState,
  encodeState,
  uniqueExpiries,
} from "./strategies.js";

const $ = (id) => document.getElementById(id);

const state = {
  symbol: null,
  quote: null,
  chain: null,
  template: "iron_condor",
  expiry: null,
  legs: [],
  ivShift: 0, // decimal, e.g. 0.02 = +2 vol pts
  range: 0.15,
  display: "usd",
  style: "american",
  dateMs: null,
  loading: false,
};

function toast(msg, ms = 2800) {
  const el = $("status");
  el.hidden = false;
  el.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

function fmtPx(n, d = 2) {
  if (!Number.isFinite(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return "—";
  const s = (n * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n > 0 ? "+" : n < 0 ? "" : "") + s + "%";
}

function fmtGk(n, d = 1) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const dd = abs >= 1000 ? 0 : abs >= 100 ? 1 : d;
  return n.toLocaleString("en-US", { minimumFractionDigits: dd, maximumFractionDigits: dd });
}

function displayValue(pnl, { maxRisk, notional }) {
  if (state.display === "pct") {
    if (!notional) return "—";
    return fmtPct(pnl / notional);
  }
  if (state.display === "risk") {
    if (!maxRisk) return "—";
    return fmtPct(pnl / maxRisk);
  }
  if (pnl === Infinity || pnl === -Infinity) return "Unlimited";
  return formatMoney(pnl, { signed: true, decimals: 0 });
}

function notional() {
  const spot = state.quote?.price;
  if (!spot) return 0;
  const optQty = state.legs
    .filter((l) => l.kind !== "stock" && l.type !== "S")
    .reduce((m, l) => Math.max(m, Math.abs(Number(l.qty) || 0)), 0) || 1;
  return spot * MULTIPLIER * optQty;
}

async function api(path) {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function contractsForExpiry(expiry) {
  return (state.chain?.options || []).filter((o) => !expiry || o.expiry === expiry);
}

function midOf(opt) {
  if (!opt) return null;
  if (Number.isFinite(opt.mid) && opt.mid > 0) return opt.mid;
  if (Number.isFinite(opt.bid) && Number.isFinite(opt.ask) && (opt.bid > 0 || opt.ask > 0)) {
    return (Math.max(opt.bid, 0) + Math.max(opt.ask, opt.bid || 0)) / 2;
  }
  if (Number.isFinite(opt.last) && opt.last > 0) return opt.last;
  return null;
}

function findContract(expiry, type, strike) {
  const typ = type === "P" || type === "put" ? "put" : "call";
  return (state.chain?.options || []).find(
    (o) => o.expiry === expiry && o.type === typ && Number(o.strike) === Number(strike),
  );
}

function solveIv(opt, spot, r, q, style) {
  const mid = midOf(opt);
  const T = yearsUntil(opt.expiry, Date.now());
  if (!(mid > 0) || T <= 0 || !(spot > 0)) return opt.iv || 0;
  if (opt.iv > 0) return opt.iv;
  return impliedVol({ mid, S: spot, K: opt.strike, T, r, q, type: opt.type, style });
}

function fillLegIvs() {
  const spot = state.quote?.price;
  const r = state.quote?.rate ?? 0.041;
  const q = state.quote?.yield ?? 0;
  const style = state.quote?.style || state.style;
  if (!(spot > 0)) return;
  for (const leg of state.legs) {
    if (leg.kind === "stock" || leg.type === "S") continue;
    const c = findContract(leg.expiry, leg.type, leg.strike);
    if (c && c.iv > 0) {
      if (!leg.iv) leg.iv = c.iv;
      if (leg.entry == null) leg.entry = midOf(c);
      continue;
    }
    const mid = leg.entry ?? midOf(c);
    if (mid > 0 && !(leg.iv > 0)) {
      const T = yearsUntil(leg.expiry, Date.now());
      leg.iv = impliedVol({
        mid, S: spot, K: Number(leg.strike), T, r, q,
        type: leg.type === "P" ? "put" : "call",
        style,
      });
    }
    if (leg.entry == null && mid > 0) leg.entry = mid;
    if (c) {
      leg.bid = c.bid;
      leg.ask = c.ask;
    }
  }
}

function lastExpiryOfLegs() {
  const xs = state.legs
    .filter((l) => l.kind !== "stock" && l.type !== "S" && l.expiry)
    .map((l) => l.expiry)
    .sort();
  return xs[xs.length - 1] || state.expiry;
}

function analytics() {
  const spot = state.quote?.price;
  if (!spot || !state.legs.length) return null;
  const r = state.quote?.rate ?? 0.041;
  const q = state.quote?.yield ?? 0;
  const now = Date.now();
  const ivShift = state.ivShift;
  const { p, summary } = chanceOfProfit(state.legs, { spot, r, q, timeMs: now, ivShift });
  const greeks = netGreeks(state.legs, { spot, timeMs: now, r, q, ivShift });
  const maxRisk = summary.maxLoss === -Infinity ? 0 : Math.abs(Math.min(0, summary.maxLoss));
  return { p, summary, greeks, r, q, now, spot, maxRisk, notional: notional() };
}

function colorFor(pnl, maxAbs) {
  if (!Number.isFinite(pnl) || !maxAbs) return "transparent";
  const t = Math.max(-1, Math.min(1, pnl / maxAbs));
  if (t >= 0) {
    const a = 0.12 + 0.55 * t;
    return `rgba(62, 224, 160, ${a})`;
  }
  const a = 0.12 + 0.55 * (-t);
  return `rgba(255, 107, 122, ${a})`;
}

function priceRows(spot, range) {
  const lo = spot * (1 - range);
  const hi = spot * (1 + range);
  const marks = [-0.05, -0.03, -0.01, 0, 0.01, 0.03, 0.05];
  const rows = [];
  const steps = 21;
  for (let i = 0; i <= steps; i++) {
    const px = hi - (hi - lo) * (i / steps);
    rows.push({ px, tag: null, special: Math.abs(px - spot) < 1e-6 * spot });
  }
  for (const m of marks) {
    const px = spot * (1 + m);
    if (px < lo - 1e-9 || px > hi + 1e-9) continue;
    const tag = m === 0 ? "spot" : (m > 0 ? `+${m * 100}%` : `${m * 100}%`);
    // Replace nearest generated row or insert
    let best = 0;
    let bestD = Infinity;
    rows.forEach((r, i) => {
      const d = Math.abs(r.px - px);
      if (d < bestD) { best = i; bestD = d; }
    });
    if (bestD < (hi - lo) / steps * 0.55) {
      rows[best] = { px, tag, special: m === 0 };
    } else {
      rows.push({ px, tag, special: m === 0 });
    }
  }
  rows.sort((a, b) => b.px - a.px);
  // de-dupe almost-equal prices
  const out = [];
  for (const r of rows) {
    if (out.length && Math.abs(out[out.length - 1].px - r.px) < spot * 0.0008) {
      if (r.tag && !out[out.length - 1].tag) out[out.length - 1] = r;
      continue;
    }
    out.push(r);
  }
  return out;
}

function dateColumns(now, lastExpiry) {
  const end = lastExpiry ? expiryCloseUtc(lastExpiry) : now;
  const span = Math.max(0, end - now);
  const cols = [{ ms: now, label: "Today", key: "today" }];
  if (span <= 0) {
    cols.push({ ms: end, label: formatDate(end), key: "expiry" });
    return cols;
  }
  const days = span / 86400000;
  const n = days <= 7 ? Math.min(5, Math.max(2, Math.round(days))) : 5;
  for (let i = 1; i < n; i++) {
    const ms = now + (span * i) / n;
    cols.push({ ms, label: formatDate(ms), key: "d" + i });
  }
  cols.push({ ms: end, label: formatDate(end), key: "expiry" });
  return cols;
}

function formatDate(ms) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

function renderQuote() {
  const el = $("quote-line");
  const q = state.quote;
  if (!q) {
    el.innerHTML = "Enter a US-listed ticker to load a delayed option chain.";
    return;
  }
  const dir = q.change > 0 ? "up" : q.change < 0 ? "down" : "";
  const chg = Number.isFinite(q.change) ? `${q.change > 0 ? "+" : ""}${fmtPx(q.change)}` : "";
  const pct = Number.isFinite(q.changePct) ? ` (${fmtPct(q.changePct)})` : "";
  const asOf = q.asOf ? ` · as of ${q.asOf}` : "";
  el.innerHTML = `<strong>${q.symbol}</strong> <strong>$${fmtPx(q.price)}</strong>
    <span class="${dir}">${chg}${pct}</span>
    <span class="badge">Delayed</span>
    <span>${q.name ? " · " + q.name : ""}${asOf} · source ${q.source || "public"}</span>`;
}

function renderTemplates() {
  const root = $("template-pills");
  root.innerHTML = "";
  for (const t of TEMPLATES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pill" + (state.template === t.id ? " is-on" : "");
    b.textContent = t.label;
    b.dataset.id = t.id;
    b.setAttribute("role", "listitem");
    b.addEventListener("click", () => applyTemplate(t.id));
    root.appendChild(b);
  }
}

function renderExpirySelect() {
  const sel = $("expiry-select");
  const list = uniqueExpiries(state.chain);
  sel.disabled = !list.length;
  sel.innerHTML = list.length
    ? list.map((e) => `<option value="${e}"${e === state.expiry ? " selected" : ""}>${e}</option>`).join("")
    : `<option value="">—</option>`;
}

function applyTemplate(id) {
  state.template = id;
  if (id === "custom") {
    renderTemplates();
    renderAll();
    return;
  }
  if (!state.chain || !state.quote) {
    renderTemplates();
    toast("Load a ticker first.");
    return;
  }
  state.legs = buildTemplate(id, {
    chain: state.chain,
    spot: state.quote.price,
    expiry: state.expiry,
    style: state.quote.style || state.style,
  });
  fillLegIvs();
  renderTemplates();
  renderAll();
  pushUrl();
}

function renderSummary(a) {
  if (!a) {
    $("sum-premium").textContent = "—";
    $("sum-premium").className = "sum-value";
    $("sum-premium-sub").textContent = "";
    $("sum-maxp").textContent = "—";
    $("sum-maxl").textContent = "—";
    $("sum-be").textContent = "—";
    $("sum-cop").textContent = "—";
    for (const k of ["delta", "gamma", "theta", "vega", "rho"]) $(`gk-${k}`).textContent = "—";
    return;
  }
  const prem = a.summary.premium;
  const debit = prem > 0;
  $("sum-premium").textContent = formatMoney(Math.abs(prem), { signed: false, decimals: 0 });
  $("sum-premium").className = "sum-value " + (debit ? "down" : prem < 0 ? "up" : "");
  $("sum-premium-sub").textContent = debit ? "Net debit" : prem < 0 ? "Net credit" : "Even";
  $("sum-maxp").textContent = a.summary.maxProfit === Infinity
    ? "Unlimited"
    : formatMoney(a.summary.maxProfit, { signed: true, decimals: 0 });
  $("sum-maxl").textContent = a.summary.maxLoss === -Infinity
    ? "Unlimited"
    : formatMoney(a.summary.maxLoss, { signed: true, decimals: 0 });
  const bes = a.summary.breakevens || [];
  $("sum-be").textContent = bes.length
    ? bes.slice(0, 3).map((x) => fmtPx(x, 2)).join("  ·  ")
    : "None";
  $("sum-cop").textContent = a.p == null ? "—" : (a.p * 100).toFixed(1) + "%";
  $("gk-delta").textContent = fmtGk(a.greeks.delta, 1);
  $("gk-gamma").textContent = fmtGk(a.greeks.gamma, 2);
  $("gk-theta").textContent = formatMoney(a.greeks.theta, { signed: true, decimals: 0 });
  $("gk-vega").textContent = formatMoney(a.greeks.vega, { signed: true, decimals: 0 });
  $("gk-rho").textContent = formatMoney(a.greeks.rho, { signed: true, decimals: 0 });
}

function pnlAt(spotS, timeMs, a) {
  return positionPnL(state.legs, {
    spot: spotS,
    timeMs,
    r: a.r,
    q: a.q,
    ivShift: state.ivShift,
    spot0: a.spot,
  });
}

function renderChart(a) {
  const svg = $("pnl-chart");
  if (!a) {
    svg.innerHTML = "";
    return;
  }
  const W = 800, H = 340;
  const pad = { l: 64, r: 18, t: 18, b: 40 };
  const rows = priceRows(a.spot, state.range);
  const lo = rows[rows.length - 1].px;
  const hi = rows[0].px;
  const last = lastExpiryOfLegs();
  const now = a.now;
  const end = last ? expiryCloseUtc(last) : now;
  const selected = state.dateMs ?? now;
  const xs = [];
  const n = 80;
  for (let i = 0; i <= n; i++) xs.push(lo + (hi - lo) * (i / n));
  const series = [
    { key: "today", color: "#9aa6bd", width: 1.6, pts: xs.map((x) => [x, pnlAt(x, now, a)]) },
    { key: "selected", color: "#f0d78c", width: 2.4, pts: xs.map((x) => [x, pnlAt(x, selected, a)]) },
    { key: "expiry", color: "#3ee0a0", width: 2.2, pts: xs.map((x) => [x, pnlAt(x, end + 1, a)]) },
  ];
  if (Math.abs(selected - now) < 60000) series.splice(1, 1);
  let ymin = 0, ymax = 0;
  for (const s of series) {
    for (const [, y] of s.pts) {
      if (!Number.isFinite(y)) continue;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  }
  const padY = Math.max((ymax - ymin) * 0.12, a.notional * 0.005, 50);
  ymin -= padY;
  ymax += padY;
  const xOf = (px) => pad.l + ((px - lo) / (hi - lo || 1)) * (W - pad.l - pad.r);
  const yOf = (v) => pad.t + ((ymax - v) / (ymax - ymin || 1)) * (H - pad.t - pad.b);
  const pathOf = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${xOf(p[0]).toFixed(2)},${yOf(p[1]).toFixed(2)}`).join(" ");

  // Probability shading of profitable expiry region
  const mu = Math.log(a.spot) + (a.r - a.q - 0.5 * avgIv() * avgIv()) * Math.max(yearsUntil(last, now), 1e-6);
  const sd = avgIv() * Math.sqrt(Math.max(yearsUntil(last, now), 1e-6));
  const dens = xs.map((x) => {
    const z = (Math.log(x) - mu) / (sd || 1);
    return Math.exp(-0.5 * z * z) / (x * sd * Math.sqrt(2 * Math.PI) || 1);
  });
  const dMax = Math.max(...dens, 1e-12);

  let shade = "";
  const expiryPts = series.find((s) => s.key === "expiry")?.pts || [];
  for (let i = 0; i < xs.length - 1; i++) {
    if (expiryPts[i][1] > 0) {
      const x1 = xOf(xs[i]), x2 = xOf(xs[i + 1]);
      const alpha = 0.05 + 0.22 * (dens[i] / dMax);
      shade += `<rect x="${x1}" y="${pad.t}" width="${Math.max(x2 - x1, 0.5)}" height="${H - pad.t - pad.b}" fill="rgba(62,224,160,${alpha.toFixed(3)})"/>`;
    }
  }

  const zero = yOf(0);
  const yTicks = prettyTicks(ymin, ymax, 5);
  const xTicks = prettyTicks(lo, hi, 6);
  const grid = yTicks.map((v) => {
    const y = yOf(v);
    return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="#24324c" stroke-width="1"/>
      <text x="${pad.l - 8}" y="${y + 4}" fill="#6d7a93" font-size="11" text-anchor="end" font-family="Inter,system-ui">${axisMoney(v)}</text>`;
  }).join("");
  const xgrid = xTicks.map((v) => {
    const x = xOf(v);
    return `<text x="${x}" y="${H - 14}" fill="#6d7a93" font-size="11" text-anchor="middle" font-family="Inter,system-ui">${fmtPx(v, 0)}</text>`;
  }).join("");

  const beLines = (a.summary.breakevens || []).filter((b) => b >= lo && b <= hi).map((b) => {
    const x = xOf(b);
    return `<line x1="${x}" x2="${x}" y1="${pad.t}" y2="${H - pad.b}" stroke="#f0d78c" stroke-dasharray="4 4" stroke-width="1" opacity="0.7"/>
      <text x="${x + 4}" y="${pad.t + 12}" fill="#f0d78c" font-size="10" font-family="Inter,system-ui">BE ${fmtPx(b, 1)}</text>`;
  }).join("");

  const spotLine = `<line x1="${xOf(a.spot)}" x2="${xOf(a.spot)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#d4af37" stroke-width="1" opacity="0.5"/>`;

  const curves = series.map((s) => `<path d="${pathOf(s.pts)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linejoin="round" stroke-linecap="round"/>`).join("");

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    ${shade}
    ${grid}
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${zero}" y2="${zero}" stroke="#6d7a93" stroke-width="1.2"/>
    ${spotLine}
    ${beLines}
    ${curves}
    ${xgrid}
  `;
}

function avgIv() {
  const ivs = state.legs
    .filter((l) => l.kind !== "stock" && l.type !== "S")
    .map((l) => Math.max(0, (Number(l.iv) || 0) + state.ivShift))
    .filter((v) => v > 0);
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : 0.2;
}

function prettyTicks(min, max, n) {
  const span = max - min || 1;
  const raw = span / n;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const err = raw / pow;
  const step = (err >= 7.5 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1) * pow;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.01; v += step) ticks.push(v);
  return ticks;
}

function axisMoney(v) {
  const a = Math.abs(v);
  const s = a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k" : a.toFixed(0);
  if (v > 0) return "+" + s;
  if (v < 0) return "−" + s;
  return "0";
}

function renderTable(a) {
  const wrap = $("pnl-table-wrap");
  if (!a) {
    wrap.innerHTML = `<p class="empty-hint">Load a ticker and pick a strategy to fill the table.</p>`;
    return;
  }
  const last = lastExpiryOfLegs();
  const cols = dateColumns(a.now, last);
  const rows = priceRows(a.spot, state.range);
  let maxAbs = 1;
  const data = rows.map((r) => cols.map((c) => {
    const v = pnlAt(r.px, c.key === "expiry" ? c.ms + 1 : c.ms, a);
    if (Number.isFinite(v) && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    return v;
  }));
  const head = `<tr><th>Price</th>${cols.map((c) => `<th>${c.label}</th>`).join("")}</tr>`;
  const body = rows.map((r, i) => {
    const tag = r.tag && r.tag !== "spot" ? `<span class="move-tag">${r.tag}</span>` : (r.tag === "spot" ? `<span class="move-tag">spot</span>` : "");
    const cells = data[i].map((v) => {
      const cls = v > 0 ? "cell-up" : v < 0 ? "cell-down" : "";
      const spotCls = r.special ? " is-spot" : "";
      return `<td class="${cls}${spotCls}" style="background:${colorFor(v, maxAbs)}">${displayValue(v, a)}</td>`;
    }).join("");
    return `<tr><td>$${fmtPx(r.px, 2)}${tag}</td>${cells}</tr>`;
  }).join("");
  wrap.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderLegs() {
  const root = $("legs-list");
  if (!state.legs.length) {
    root.innerHTML = `<p class="empty-hint">No legs yet. Pick a strategy or add a leg.</p>`;
    return;
  }
  const expiries = uniqueExpiries(state.chain);
  root.innerHTML = "";
  state.legs.forEach((leg, idx) => {
    const row = document.createElement("div");
    row.className = "leg-row";
    const isStock = leg.kind === "stock" || leg.type === "S";
    const field = (label, html) => `<label class="leg-field"><span>${label}</span>${html}</label>`;
    const typeSel = isStock
      ? field("Type", `<select data-f="kindstock" disabled><option>Stock</option></select>`)
      : field("Type", `<select data-f="type">${["C", "P"].map((t) => `<option value="${t}"${leg.type === t ? " selected" : ""}>${t === "C" ? "Call" : "Put"}</option>`).join("")}</select>`);
    const sideSel = field("Side", `<select data-f="side"><option value="buy"${leg.side !== "sell" ? " selected" : ""}>Buy</option><option value="sell"${leg.side === "sell" ? " selected" : ""}>Sell</option></select>`);
    const qtyInp = field("Qty", `<input data-f="qty" type="number" min="1" step="1" value="${Math.abs(Number(leg.qty) || 1)}" aria-label="Quantity">`);
    const strikeInp = isStock
      ? field("Strike", `<input value="—" disabled aria-label="Strike">`)
      : field("Strike", `<input data-f="strike" type="number" step="0.5" value="${leg.strike ?? ""}" aria-label="Strike">`);
    const expSel = isStock
      ? field("Expiry", `<input value="—" disabled>`)
      : field("Expiry", `<select data-f="expiry">${(expiries.length ? expiries : [leg.expiry]).map((e) => `<option value="${e}"${e === leg.expiry ? " selected" : ""}>${e}</option>`).join("")}</select>`);
    const entryInp = field("Entry", `<input data-f="entry" type="number" step="0.01" min="0" value="${leg.entry ?? ""}" placeholder="Mid" aria-label="Entry price">`);
    row.innerHTML = `${typeSel}${sideSel}${qtyInp}${strikeInp}${expSel}${entryInp}<button type="button" class="leg-btn leg-remove" data-f="rm" aria-label="Remove leg">×</button>`;
    row.addEventListener("change", (ev) => onLegChange(idx, ev.target));
    row.addEventListener("click", (ev) => {
      if (ev.target.dataset.f === "rm") {
        state.legs.splice(idx, 1);
        state.template = "custom";
        renderTemplates();
        renderAll();
        pushUrl();
      }
    });
    root.appendChild(row);
  });
}

function onLegChange(idx, el) {
  const f = el.dataset.f;
  const leg = state.legs[idx];
  if (!leg || !f) return;
  if (f === "type") leg.type = el.value;
  if (f === "side") leg.side = el.value;
  if (f === "qty") leg.qty = Math.max(1, Number(el.value) || 1);
  if (f === "strike") leg.strike = Number(el.value);
  if (f === "expiry") leg.expiry = el.value;
  if (f === "entry") leg.entry = el.value === "" ? null : Number(el.value);
  if (f !== "entry") {
    const c = findContract(leg.expiry, leg.type, leg.strike);
    if (c) {
      leg.entry = midOf(c);
      leg.iv = c.iv || 0;
      leg.bid = c.bid;
      leg.ask = c.ask;
    } else {
      leg.iv = 0;
    }
    fillLegIvs();
  }
  state.template = "custom";
  renderTemplates();
  renderAll();
  pushUrl();
}

function addLeg() {
  const exp = state.expiry || uniqueExpiries(state.chain)[0];
  const spot = state.quote?.price;
  const c = (state.chain?.options || []).find((o) => o.expiry === exp && o.type === "call" && Math.abs(o.strike - spot) < (spot || 1));
  const strike = c ? c.strike : Math.round(spot || 100);
  state.legs.push({
    id: "n" + Math.random().toString(36).slice(2, 7),
    kind: "option",
    type: "C",
    side: "buy",
    qty: 1,
    strike,
    expiry: exp,
    entry: midOf(c),
    iv: c?.iv || 0,
    style: state.quote?.style || state.style,
  });
  fillLegIvs();
  state.template = "custom";
  renderTemplates();
  renderAll();
  pushUrl();
}

function renderChain() {
  const wrap = $("chain-wrap");
  const expiry = state.expiry;
  if (!state.chain || !expiry) {
    wrap.innerHTML = `<p class="empty-hint">The chain appears after you load a ticker.</p>`;
    return;
  }
  const calls = {};
  const puts = {};
  const strikes = [];
  for (const o of state.chain.options) {
    if (o.expiry !== expiry) continue;
    if (!strikes.includes(o.strike)) strikes.push(o.strike);
    (o.type === "put" ? puts : calls)[o.strike] = o;
  }
  strikes.sort((a, b) => a - b);
  const spot = state.quote?.price;
  // Focus around the money; show a manageable slice, expand via scroll of nearby.
  const windowed = strikes.filter((s) => !spot || Math.abs(s - spot) / spot <= Math.max(state.range, 0.12) * 1.6);
  const show = windowed.length ? windowed : strikes;
  $("chain-note").textContent = `${show.length} of ${strikes.length} strikes near the money for ${expiry}. Tap a call or put mid to add a long leg. Delayed data.`;
  const r = state.quote?.rate ?? 0.041;
  const q = state.quote?.yield ?? 0;
  const style = state.quote?.style || state.style;
  const head = `<tr>
    <th>Call mid</th><th>Bid</th><th>Ask</th><th>IV</th><th>OI</th>
    <th>Strike</th>
    <th>Put mid</th><th>Bid</th><th>Ask</th><th>IV</th><th>OI</th>
  </tr>`;
  const body = show.map((k) => {
    const c = calls[k];
    const p = puts[k];
    const civ = c ? (c.iv > 0 ? c.iv : solveIv(c, spot, r, q, style)) : 0;
    const piv = p ? (p.iv > 0 ? p.iv : solveIv(p, spot, r, q, style)) : 0;
    if (c && !(c.iv > 0) && civ > 0) c.iv = civ;
    if (p && !(p.iv > 0) && piv > 0) p.iv = piv;
    const isAtm = spot && Math.abs(k - spot) === Math.min(...show.map((s) => Math.abs(s - spot)));
    return `<tr data-strike="${k}" class="${isAtm ? "is-atm" : ""}">
      <td data-add="C">${c ? fmtPx(midOf(c)) : "—"}</td>
      <td>${c ? fmtPx(c.bid) : "—"}</td><td>${c ? fmtPx(c.ask) : "—"}</td>
      <td class="iv-cell">${civ ? (civ * 100).toFixed(1) + "%" : "—"}</td>
      <td>${c && c.oi != null ? c.oi.toLocaleString("en-US") : "—"}</td>
      <td><strong>${fmtPx(k, k % 1 ? 2 : 0)}</strong></td>
      <td data-add="P">${p ? fmtPx(midOf(p)) : "—"}</td>
      <td>${p ? fmtPx(p.bid) : "—"}</td><td>${p ? fmtPx(p.ask) : "—"}</td>
      <td class="iv-cell">${piv ? (piv * 100).toFixed(1) + "%" : "—"}</td>
      <td>${p && p.oi != null ? p.oi.toLocaleString("en-US") : "—"}</td>
    </tr>`;
  }).join("");
  wrap.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  wrap.querySelectorAll("[data-add]").forEach((td) => {
    td.style.cursor = "pointer";
    td.title = "Add as a long leg";
    td.addEventListener("click", () => {
      const tr = td.closest("tr");
      const strike = Number(tr.dataset.strike);
      const type = td.dataset.add;
      const opt = type === "P" ? puts[strike] : calls[strike];
      state.legs.push({
        id: type + Math.random().toString(36).slice(2, 7),
        kind: "option",
        type,
        side: "buy",
        qty: 1,
        strike,
        expiry,
        entry: midOf(opt),
        iv: opt?.iv || 0,
        bid: opt?.bid,
        ask: opt?.ask,
        style,
      });
      fillLegIvs();
      state.template = "custom";
      renderTemplates();
      renderAll();
      pushUrl();
      toast(`Added long ${type === "P" ? "put" : "call"} ${fmtPx(strike, 0)}`);
    });
  });
}

function renderSliders(a) {
  const last = lastExpiryOfLegs();
  const now = Date.now();
  const end = last ? expiryCloseUtc(last) : now;
  const days = Math.max(0, Math.round((end - now) / 86400000));
  const sl = $("date-slider");
  sl.min = 0;
  sl.max = String(days);
  sl.disabled = days <= 0;
  const curDays = state.dateMs ? Math.round((state.dateMs - now) / 86400000) : 0;
  sl.value = String(Math.max(0, Math.min(days, curDays)));
  $("date-label").textContent = Number(sl.value) === 0 ? "Today" : (Number(sl.value) >= days ? `${formatDate(end)} (expiry)` : formatDate(state.dateMs || now));
  $("iv-label").textContent = `${state.ivShift >= 0 ? "+" : ""}${(state.ivShift * 100).toFixed(1)} vol pts`;
  $("iv-slider").value = String(state.ivShift * 100);
  $("range-label").textContent = `±${Math.round(state.range * 100)}%`;
  $("range-slider").value = String(Math.round(state.range * 100));
  document.querySelectorAll(".seg-btn").forEach((b) => {
    const on = b.dataset.display === state.display;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function renderAll() {
  const a = analytics();
  renderQuote();
  renderExpirySelect();
  renderSummary(a);
  renderChart(a);
  renderTable(a);
  renderLegs();
  renderChain();
  renderSliders(a);
}

function pushUrl() {
  const qs = encodeState({
    symbol: state.symbol,
    template: state.template,
    expiry: state.expiry,
    legs: state.legs,
    ivShift: state.ivShift,
    range: state.range,
    display: state.display,
    style: state.style,
  });
  const url = qs ? `/builder/?${qs}` : "/builder/";
  history.replaceState(null, "", url);
}

async function loadSymbol(sym, { keepLegs = false } = {}) {
  const ticker = String(sym || "").trim().toUpperCase();
  if (!ticker) return;
  state.loading = true;
  state.symbol = ticker;
  $("ticker-input").value = ticker;
  toast(`Loading ${ticker}…`, 8000);
  try {
    const data = await api(`/api/chain?symbol=${encodeURIComponent(ticker)}`);
    state.chain = data;
    state.quote = {
      symbol: data.symbol,
      name: data.name,
      price: data.price,
      change: data.change,
      changePct: data.changePct,
      asOf: data.asOf,
      source: data.source,
      style: data.style,
      yield: data.yield,
      rate: data.rate,
      ivAtm: data.ivAtm,
    };
    state.style = data.style || "american";
    const exps = uniqueExpiries(data);
    if (!state.expiry || !exps.includes(state.expiry)) {
      state.expiry = exps[0] || null;
    }
    if (!keepLegs) {
      if (state.legs.length && state.template === "custom") {
        fillLegIvs();
      } else {
        applyTemplate(state.template || "iron_condor");
        toast(`${data.symbol} loaded · ${data.source} delayed quotes`);
        return;
      }
    } else {
      fillLegIvs();
    }
    renderAll();
    pushUrl();
    toast(`${data.symbol} loaded · ${data.source} delayed quotes`);
  } catch (err) {
    toast(err.message || "Could not load that ticker.");
  } finally {
    state.loading = false;
  }
}

function bind() {
  $("ticker-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    loadSymbol($("ticker-input").value, { keepLegs: false });
  });
  $("expiry-select").addEventListener("change", (ev) => {
    state.expiry = ev.target.value;
    if (state.template && state.template !== "custom") applyTemplate(state.template);
    else {
      renderAll();
      pushUrl();
    }
  });
  $("add-leg").addEventListener("click", addLeg);
  $("iv-slider").addEventListener("input", (ev) => {
    state.ivShift = Number(ev.target.value) / 100;
    renderAll();
  });
  $("iv-slider").addEventListener("change", pushUrl);
  $("range-slider").addEventListener("input", (ev) => {
    state.range = Number(ev.target.value) / 100;
    renderAll();
  });
  $("range-slider").addEventListener("change", pushUrl);
  $("date-slider").addEventListener("input", (ev) => {
    const days = Number(ev.target.value);
    state.dateMs = Date.now() + days * 86400000;
    renderAll();
  });
  document.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      state.display = b.dataset.display;
      renderAll();
      pushUrl();
    });
  });
}

function boot() {
  renderTemplates();
  bind();
  const initial = decodeState(location.search);
  if (initial.symbol) {
    state.template = initial.template || "custom";
    state.expiry = initial.expiry;
    state.ivShift = initial.ivShift;
    state.range = initial.range;
    state.display = initial.display;
    state.style = initial.style;
    state.legs = initial.legs;
    loadSymbol(initial.symbol, { keepLegs: initial.legs.length > 0 });
  } else {
    renderAll();
    loadSymbol("QQQ");
  }
}

boot();
