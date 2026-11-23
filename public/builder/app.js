/**
 * Convexa public QQQ strategy builder.
 * Layout and interactions follow a widely used options-builder pattern;
 * styling, copy, math and data wiring are original. Not investment advice.
 */
import {
  MULTIPLIER,
  yearsUntil,
  expiryCloseUtc,
  optionGreeks,
  impliedVol,
  positionValue,
  positionEntryCost,
  positionPnL,
  netGreeks,
  netPremium,
  summarizePayoff,
  chanceOfProfit,
  formatMoney,
  clamp,
  normPdf,
  normCdf,
} from "./pricing.js";
import {
  CATALOG,
  LEVELS,
  templateBySlug,
  buildTemplate,
  makeLeg,
  midOf,
  nearestStrike,
  pickContract,
  uniqueExpiries,
  expiryNearDays,
  encodePath,
  decodeState,
  parseOcc,
  formatOcc,
} from "./strategies.js";
import { provider, BUILDER_SYMBOL } from "./data.js";

const SYMBOL = BUILDER_SYMBOL;
const DEFAULT_RANGE = 0.12;
const SAVE_KEY = "convexa-builder-saved-v2";
const NOTICE_KEY = "convexa-builder-notice-v2";
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

const state = {
  quote: null,
  chain: { symbol: SYMBOL, expirations: [], options: [] },
  loaded: new Set(),
  legs: [],
  closed: [],
  template: "iron-condor",
  activeExpiry: null,
  month: null,
  range: DEFAULT_RANGE,
  ivMult: 1,
  ivScope: "average",
  dateMs: null,
  view: "graph",
  mode: "usd",
  statsPage: 0,
  pricingMode: "mid",
  commTrade: 0,
  commContract: 0,
  commRt: false,
  posTab: "open",
  hoverPx: null,
  histRange: "5d",
};

const $ = (id) => document.getElementById(id);
const etDate = (ms, opts) => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", ...opts });
const ymdET = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const rate = () => (state.quote && Number(state.quote.rate)) || 0.041;
const yieldQ = () => (state.quote && Number(state.quote.yield)) || 0;
const styleOf = () => (state.quote && state.quote.style) || "american";
const spotNow = () => (state.quote && Number(state.quote.price)) || 0;
const optionLegs = (legs = state.legs) => legs.filter((l) => l && !l.closed && l.kind !== "stock" && l.type !== "S");
const openLegs = () => state.legs.filter((l) => l && !l.closed && !l.excluded);
const chainOf = () => state.chain;

function toast(msg, ms = 4000) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

function isTradingDay(iso) {
  const d = new Date(iso + "T12:00:00-05:00");
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !HOLIDAYS.has(iso);
}

function tradingDays(fromMs, toMs) {
  const out = [];
  let ms = Date.parse(ymdET(fromMs) + "T16:00:00-05:00");
  const end = toMs;
  if (!Number.isFinite(ms)) return out;
  for (let i = 0; i < 800 && ms <= end + 36e5; i++) {
    const iso = ymdET(ms);
    if (isTradingDay(iso)) out.push(expiryCloseUtc(iso));
    ms += 86400000;
  }
  if (!out.length || out[out.length - 1] < end - 36e5) {
    const lastIso = ymdET(end);
    if (isTradingDay(lastIso)) {
      const t = expiryCloseUtc(lastIso);
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

function lastExpiryIso(legs = openLegs()) {
  const xs = optionLegs(legs).map((l) => l.expiry).filter(Boolean).sort();
  return xs[xs.length - 1] || null;
}

function uniqueLegExpiries(legs = openLegs()) {
  return [...new Set(optionLegs(legs).map((l) => l.expiry).filter(Boolean))].sort();
}

function entryPx(leg) {
  if (Number.isFinite(leg.customPrice)) return Number(leg.customPrice);
  if (state.pricingMode === "ba") {
    if (leg.side === "buy") return Number.isFinite(leg.ask) ? leg.ask : leg.entry;
    return Number.isFinite(leg.bid) ? leg.bid : leg.entry;
  }
  return leg.entry;
}

function feesFor(legs = openLegs()) {
  const nOpt = optionLegs(legs).reduce((s, l) => s + Math.abs(Number(l.qty) || 0), 0);
  const nTrades = legs.length;
  const one = (Number(state.commTrade) || 0) * nTrades + (Number(state.commContract) || 0) * nOpt;
  return state.commRt ? one * 2 : one;
}

function scaledLegs(legs = openLegs()) {
  return legs.map((l) => {
    const copy = { ...l, entry: entryPx(l) };
    if (copy.kind === "stock" || copy.type === "S") return copy;
    const apply = state.ivScope === "average" || !state.ivScope || state.ivScope === copy.expiry;
    copy.iv = Math.max(0, (Number(l.iv) || 0) * (apply ? state.ivMult : 1));
    return copy;
  });
}

function scenario(spot, timeMs) {
  return { spot, timeMs, r: rate(), q: yieldQ(), ivShift: 0, spot0: spotNow() };
}

function pnlAt(spot, timeMs, legs = scaledLegs()) {
  return positionPnL(legs, scenario(spot, timeMs)) - feesFor(openLegs());
}

function valueAt(spot, timeMs, legs = scaledLegs()) {
  return positionValue(legs, scenario(spot, timeMs));
}

function analytics() {
  const legs = scaledLegs();
  const spot = spotNow();
  const now = Date.now();
  const summary = summarizePayoff(legs, { spot, r: rate(), q: yieldQ(), timeMs: now, ivShift: 0 });
  const { p } = chanceOfProfit(legs, { spot, r: rate(), q: yieldQ(), timeMs: now, ivShift: 0 });
  const greeks = netGreeks(legs, { spot, timeMs: now, r: rate(), q: yieldQ(), ivShift: 0 });
  const fee = feesFor(openLegs());
  if (fee) {
    if (Number.isFinite(summary.maxProfit)) summary.maxProfit -= fee;
    if (Number.isFinite(summary.maxLoss)) summary.maxLoss -= fee;
  }
  return { ...summary, cop: p, greeks, fee, spot, now, legs };
}

function avgIv() {
  const ivs = optionLegs(openLegs()).map((l) => {
    const apply = state.ivScope === "average" || !state.ivScope || state.ivScope === l.expiry;
    return Math.max(0, (Number(l.iv) || 0) * (apply ? state.ivMult : 1));
  }).filter((v) => v > 0);
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : 0;
}

function fillFromContract(leg) {
  if (leg.kind === "stock" || leg.type === "S") {
    if (!Number.isFinite(leg.entry)) leg.entry = spotNow();
    return leg;
  }
  const typ = leg.type === "P" || leg.type === "put" ? "put" : "call";
  const c = pickContract(chainOf(), leg.expiry, typ, leg.strike);
  if (c) {
    leg.bid = c.bid;
    leg.ask = c.ask;
    leg.last = c.last;
    leg.oi = c.oi;
    leg.volume = c.volume;
    if (!Number.isFinite(leg.customPrice)) leg.entry = midOf(c);
    if (c.iv > 0) leg.iv = c.iv;
  }
  if (!(leg.iv > 0) && Number.isFinite(leg.entry) && leg.entry > 0 && spotNow() > 0) {
    const iv = impliedVol({
      mid: leg.entry,
      S: spotNow(),
      K: Number(leg.strike),
      T: yearsUntil(leg.expiry),
      r: rate(),
      q: yieldQ(),
      type: typ,
      style: styleOf(),
    });
    if (iv > 0) leg.iv = iv;
  }
  leg.symbol = SYMBOL;
  return leg;
}

function hydrateEntries(entries) {
  return entries.map((e) => {
    if (e.kind === "stock" || e.type === "S") {
      return fillFromContract(makeLeg({
        kind: "stock", side: e.side, qty: e.qty || 100, chain: chainOf(), style: styleOf(), symbol: SYMBOL,
      }));
    }
    return fillFromContract(makeLeg({
      type: e.type, side: e.side, qty: e.qty || 1, strike: e.strike, expiry: e.expiry,
      chain: chainOf(), style: styleOf(), symbol: SYMBOL,
    }));
  });
}

async function loadBase() {
  const data = await provider.chain(SYMBOL);
  state.quote = data;
  const have = new Set((data.options || []).map((o) => o.expiry));
  state.chain = {
    symbol: SYMBOL,
    price: data.price,
    yield: data.yield,
    rate: data.rate,
    style: data.style,
    expirations: data.expirations || [],
    options: data.options || [],
  };
  state.loaded = have;
  return data;
}

async function ensureExpiries(exps) {
  const want = [...new Set((exps || []).filter(Boolean))];
  const missing = want.filter((e) => !state.loaded.has(e));
  if (!missing.length) return;
  const packs = await Promise.all(missing.map((e) => provider.chain(SYMBOL, e).catch(() => null)));
  for (let i = 0; i < missing.length; i++) {
    const pack = packs[i];
    if (!pack || !pack.options) continue;
    const exp = missing[i];
    state.chain.options = state.chain.options.filter((o) => o.expiry !== exp).concat(pack.options);
    state.loaded.add(exp);
    if (pack.price) {
      state.quote = { ...state.quote, ...pack, options: undefined, expirations: state.chain.expirations };
      state.chain.price = pack.price;
    }
  }
}

function selectedTime() {
  const last = lastExpiryIso();
  if (!last) return Date.now();
  const end = expiryCloseUtc(last);
  if (!state.dateMs) return end;
  return clamp(state.dateMs, Date.now(), end);
}

function isAtExpiry(timeMs) {
  const last = lastExpiryIso();
  if (!last) return true;
  return timeMs >= expiryCloseUtc(last) - 60 * 1000;
}

function displayNumber(v, a, atSpot, atTime) {
  const mode = state.mode;
  if (mode === "value") return formatMoney(valueAt(atSpot, atTime), { signed: true, decimals: 0 });
  if (mode === "pct") {
    const base = Math.abs(a.premium) > 1e-6 ? Math.abs(a.premium) : (Number.isFinite(a.maxLoss) && a.maxLoss !== 0 ? Math.abs(a.maxLoss) : 1);
    return `${((v / base) * 100).toFixed(1)}%`;
  }
  if (mode === "risk") {
    if (!Number.isFinite(a.maxLoss) || a.maxLoss === 0) return "—";
    return `${((v / Math.abs(a.maxLoss)) * 100).toFixed(1)}%`;
  }
  if (["delta", "theta", "gamma", "vega", "rho"].includes(mode)) {
    const g = netGreeks(scaledLegs(), { spot: atSpot, timeMs: atTime, r: rate(), q: yieldQ(), ivShift: 0 });
    const x = g && g[mode];
    if (!Number.isFinite(x)) return "—";
    const d = mode === "gamma" ? 4 : 2;
    return (x >= 0 ? "+" : "") + x.toFixed(d);
  }
  return formatMoney(v, { signed: true, decimals: 0 });
}

function fmtPx(x, d = 2) {
  if (!Number.isFinite(x)) return "—";
  return Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function wideSpread(leg) {
  if (!Number.isFinite(leg.bid) || !Number.isFinite(leg.ask) || !Number.isFinite(leg.entry) || leg.entry <= 0) return true;
  return (leg.ask - leg.bid) / leg.entry > 0.25;
}

function occLabel(leg) {
  if (leg.kind === "stock" || leg.type === "S") return `${leg.side === "sell" ? "−" : "+"}${leg.qty} QQQ`;
  const side = leg.side === "sell" ? "−" : "+";
  return `${side}${leg.qty} ${formatOcc(SYMBOL, leg.expiry, leg.type, leg.strike)}`;
}

function pushUrl(replace = true) {
  const path = encodePath({ template: state.template, symbol: SYMBOL, legs: openLegs() });
  const url = path + (location.search || "");
  if (url === location.pathname + location.search) return;
  const fn = replace ? history.replaceState : history.pushState;
  fn.call(history, { path }, "", url);
}

function setTitle() {
  const tpl = templateBySlug(state.template);
  const name = (tpl && tpl.label) || "Custom";
  $("strategy-title").textContent = name;
  document.title = `QQQ ${name} — Convexa`;
}

/* ---------- render ---------- */

function renderQuote() {
  const q = state.quote;
  $("ticker-input").value = SYMBOL;
  if (!q) return;
  $("last-price").textContent = fmtPx(q.price);
  const ch = $("last-chg");
  const pct = Number(q.changePct);
  const chg = Number(q.change);
  if (Number.isFinite(chg) && Number.isFinite(pct)) {
    const sign = chg > 0 ? "+" : "";
    ch.textContent = `${sign}${fmtPx(chg)} (${sign}${(pct * (Math.abs(pct) < 1 ? 100 : 1)).toFixed(2)}%)`;
    ch.className = "chg " + (chg > 0 ? "up" : chg < 0 ? "dn" : "");
  } else ch.textContent = "";
  $("delayed-tag").textContent = q.delayed === false ? "" : "Delayed";
}

function renderBuildMenu() {
  const cols = $("build-cols");
  cols.innerHTML = "";
  for (const level of LEVELS) {
    const col = document.createElement("div");
    col.className = "build-col";
    col.innerHTML = `<h3>${level}</h3>`;
    for (const t of CATALOG.filter((x) => x.level === level)) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.slug = t.slug;
      b.textContent = t.label;
      if (t.slug === state.template) b.classList.add("is-on");
      b.addEventListener("mouseenter", () => showBuildCard(t));
      b.addEventListener("click", () => applyTemplate(t.slug));
      col.appendChild(b);
    }
    cols.appendChild(col);
  }
  const current = templateBySlug(state.template) || CATALOG.find((t) => t.slug === "iron-condor");
  if (current) showBuildCard(current);
}

function showBuildCard(t) {
  const card = $("build-card");
  card.innerHTML = `<h4>${t.label}</h4><p>${t.blurb}</p><p>${t.legsText || ""}</p><button type="button" class="btn-gold" data-build="${t.slug}">Build this</button>`;
  const btn = card.querySelector("[data-build]");
  if (btn) btn.addEventListener("click", () => applyTemplate(t.slug));
}

function renderExpiryStrip() {
  const expiries = uniqueExpiries(chainOf());
  const byMonth = new Map();
  for (const e of expiries) {
    const key = e.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(e);
  }
  const months = [...byMonth.keys()];
  const legExps = uniqueLegExpiries();
  const primary = state.activeExpiry || legExps[0] || expiryNearDays(expiries, 30);
  if (primary && !state.month) state.month = primary.slice(0, 7);
  if (state.month && !byMonth.has(state.month) && primary) state.month = primary.slice(0, 7);
  const far = legExps.find((e) => e !== primary) || legExps[1];
  const row = document.createElement("div");
  row.className = "month-row";
  for (const m of months) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "month-btn" + (m === state.month ? " is-on" : "");
    const dt = new Date(m + "-01T12:00:00-05:00");
    b.textContent = dt.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "America/New_York" });
    b.addEventListener("click", () => { state.month = m; renderExpiryStrip(); });
    row.appendChild(b);
  }
  const days = document.createElement("div");
  days.className = "day-row";
  for (const e of (byMonth.get(state.month) || [])) {
    const b = document.createElement("button");
    b.type = "button";
    const isPri = e === primary;
    const isFar = far && e === far;
    b.className = "day-chip" + (isPri ? " is-on" : "") + (isFar && !isPri ? " is-alt" : "") + (isFar && isPri ? " is-alt is-on" : "");
    const d = Number(e.slice(8, 10));
    const wd = etDate(Date.parse(e + "T12:00:00-05:00"), { weekday: "short" });
    b.innerHTML = `${d}<small>${wd}</small>`;
    b.addEventListener("click", () => onPickExpiry(e));
    days.appendChild(b);
  }
  const host = $("expiry-strip");
  host.innerHTML = "";
  host.appendChild(row);
  host.appendChild(days);
  const n = lastExpiryIso();
  const dte = n ? Math.max(0, Math.round((expiryCloseUtc(n) - Date.now()) / 86400000)) : 0;
  $("expiry-label").textContent = n
    ? `Expiration  ·  ${etDate(expiryCloseUtc(n), { weekday: "short", month: "short", day: "numeric", year: "numeric" })}  ·  ${dte} day${dte === 1 ? "" : "s"}`
    : "Expiration";
}

async function onPickExpiry(iso) {
  const legExps = uniqueLegExpiries();
  let target = state.activeExpiry || legExps[0];
  if (legExps.length > 1 && target && iso !== target) {
    // If the clicked date is closer to the other slot, move that slot.
    const other = legExps.find((e) => e !== target);
    if (other && Math.abs(Date.parse(iso) - Date.parse(other)) < Math.abs(Date.parse(iso) - Date.parse(target))) {
      target = other;
    }
  }
  if (!target) target = iso;
  await ensureExpiries([iso]);
  for (const l of state.legs) {
    if (l.kind === "stock" || l.type === "S") continue;
    if (l.expiry === target) {
      l.expiry = iso;
      fillFromContract(l);
    }
  }
  state.activeExpiry = iso;
  state.month = iso.slice(0, 7);
  const last = lastExpiryIso();
  if (last) {
    state.dateMs = expiryCloseUtc(last);
    const sl = $("date-slider");
    const days = tradingDays(Date.now(), expiryCloseUtc(last));
    sl.max = String(Math.max(0, days.length - 1));
    sl.value = sl.max;
    sl.disabled = days.length < 2;
  }
  pushUrl();
  renderAll();
}

function renderStrikeStrip() {
  const host = $("strike-strip");
  const spot = spotNow();
  const w = host.clientWidth || 734;
  const h = host.clientHeight || 118;
  const lo = spot * (1 - state.range * 1.15);
  const hi = spot * (1 + state.range * 1.15);
  const padX = 36;
  const xOf = (k) => padX + ((k - lo) / (hi - lo)) * (w - 2 * padX);
  const legs = openLegs().filter((l) => l.kind !== "stock" && l.type !== "S");
  const focusExp = state.activeExpiry || uniqueLegExpiries()[0];
  const far = uniqueLegExpiries().find((e) => e !== focusExp);
  const opts = (chainOf().options || []).filter((o) => o.expiry === focusExp && o.strike >= lo && o.strike <= hi);
  const byK = new Map();
  let maxOi = 1;
  for (const o of opts) {
    const rec = byK.get(o.strike) || { strike: o.strike, call: 0, put: 0 };
    const oi = Number(o.oi) || 0;
    if (o.type === "call" || o.type === "C") rec.call += oi;
    else rec.put += oi;
    byK.set(o.strike, rec);
    maxOi = Math.max(maxOi, rec.call, rec.put);
  }
  const strikes = [...byK.keys()].sort((a, b) => a - b);
  if (!strikes.length) {
    const all = [...new Set((chainOf().options || []).filter((o) => o.expiry === focusExp).map((o) => Number(o.strike)))].sort((a, b) => a - b);
    for (const k of all) if (k >= lo && k <= hi) { byK.set(k, { strike: k, call: 0, put: 0 }); strikes.push(k); }
  }

  host.innerHTML = `<canvas class="strike-canvas" width="${Math.round(w)}" height="${Math.round(h)}"></canvas>`;
  const cv = host.querySelector("canvas");
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const midY = h / 2;
  ctx.strokeStyle = "#243049";
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();
  for (const rec of byK.values()) {
    const x = xOf(rec.strike);
    const up = (rec.call / maxOi) * (h * 0.32);
    const dn = (rec.put / maxOi) * (h * 0.32);
    ctx.fillStyle = "rgba(46,204,113,0.35)";
    ctx.fillRect(x - 2, midY - up, 4, up);
    ctx.fillStyle = "rgba(231,76,60,0.35)";
    ctx.fillRect(x - 2, midY, 4, dn);
  }
  ctx.fillStyle = "#6b7690";
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  const step = Math.max(1, Math.round(strikes.length / 12));
  strikes.forEach((k, i) => {
    if (i % step && k !== nearestStrike(strikes, spot)) return;
    ctx.fillText(String(k), xOf(k), h - 6);
  });
  if (spot) {
    const sx = xOf(spot);
    ctx.strokeStyle = "#d4af37";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
    ctx.setLineDash([]);
    const flag = document.createElement("div");
    flag.className = "spot-flag";
    flag.textContent = fmtPx(spot, 2);
    flag.style.left = sx + "px";
    host.appendChild(flag);
  }

  for (const leg of legs) {
    const x = xOf(Number(leg.strike));
    if (x < -20 || x > w + 20) continue;
    const chip = document.createElement("div");
    const typ = leg.type === "P" || leg.type === "put" ? "put" : "call";
    chip.className = `leg-chip ${leg.side === "sell" ? "short" : "long"} ${typ}`;
    if (wideSpread(leg)) chip.classList.add("warn");
    if (far && leg.expiry === far) chip.classList.add("exp-b");
    const tag = uniqueLegExpiries().length > 1
      ? `<span class="tag">${etDate(Date.parse(leg.expiry + "T12:00:00-05:00"), { month: "short", day: "numeric" })}</span>`
      : "";
    const qtyBit = Number(leg.qty) !== 1 ? `${leg.qty}× ` : "";
    chip.innerHTML = `${qtyBit}${leg.strike} ${typ === "put" ? "P" : "C"}${tag}`;
    chip.style.left = x + "px";
    chip.dataset.id = leg.id;
    bindDrag(chip, leg, xOf, lo, hi, strikes.length ? strikes : [...byK.keys()].sort((a, b) => a - b));
    host.appendChild(chip);
  }
}

function bindDrag(chip, leg, xOf, lo, hi, strikes) {
  const host = $("strike-strip");
  const onMove = (ev) => {
    const rect = host.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const k = lo + (x / rect.width) * (hi - lo);
    const snap = nearestStrike(strikes, k);
    chip.style.left = xOf(snap) + "px";
    chip.dataset.snap = String(snap);
  };
  const onUp = (ev) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    chip.classList.remove("is-drag");
    const snap = Number(chip.dataset.snap);
    if (Number.isFinite(snap) && snap !== Number(leg.strike)) {
      leg.strike = snap;
      fillFromContract(leg);
      pushUrl();
      renderAll();
    }
  };
  chip.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    chip.classList.add("is-drag");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    onMove(ev);
  });
}

function renderStats(a) {
  $("btn-positions").textContent = `Positions (${openLegs().length})`;
  const pages = [
    [
      { k: a.premium >= 0 ? "Debit" : "Credit", v: formatMoney(Math.abs(a.premium), { signed: false }), cls: "" },
      { k: "Max profit", v: formatMoney(a.maxProfit, { signed: true }), cls: Number.isFinite(a.maxProfit) && a.maxProfit > 0 ? "up" : "" },
      { k: "Max loss", v: formatMoney(a.maxLoss, { signed: true }), cls: !Number.isFinite(a.maxLoss) || a.maxLoss < 0 ? "dn" : "" },
      { k: "Break evens", v: (a.breakevens || []).length ? a.breakevens.map((x) => fmtPx(x, 2)).join(" · ") : "—", cls: (a.breakevens || []).length > 1 ? "tight" : "" },
      { k: "Chance of profit", v: Number.isFinite(a.cop) ? `${(a.cop * 100).toFixed(1)}%` : "—", cls: "" },
    ],
    [
      { k: "Delta", v: fmtG(a.greeks && a.greeks.delta, 2), cls: clsG(a.greeks && a.greeks.delta) },
      { k: "Theta", v: fmtG(a.greeks && a.greeks.theta, 2), cls: clsG(a.greeks && a.greeks.theta) },
      { k: "Gamma", v: fmtG(a.greeks && a.greeks.gamma, 4), cls: clsG(a.greeks && a.greeks.gamma) },
      { k: "Vega", v: fmtG(a.greeks && a.greeks.vega, 2), cls: clsG(a.greeks && a.greeks.vega) },
      { k: "Rho", v: fmtG(a.greeks && a.greeks.rho, 2), cls: clsG(a.greeks && a.greeks.rho) },
    ],
  ];
  const page = pages[state.statsPage % pages.length];
  const host = $("stats-cols");
  host.innerHTML = page.map((s) => `<div class="stat"><span class="k">${s.k}</span><span class="v ${s.cls}">${s.v}</span></div>`).join("");
}

function fmtG(x, d) {
  if (!Number.isFinite(x)) return "—";
  const n = x.toFixed(d);
  return (x > 0 ? "+" : "") + n;
}
function clsG(x) {
  if (!Number.isFinite(x) || Math.abs(x) < 1e-8) return "";
  return x > 0 ? "up" : "dn";
}

function priceGrid(spot, range, n = 49) {
  const lo = spot * (1 - range);
  const hi = spot * (1 + range);
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(lo + (hi - lo) * (i / (n - 1)));
  if (!xs.some((x) => Math.abs(x - spot) < (hi - lo) / (n * 2))) xs.push(spot);
  xs.sort((a, b) => a - b);
  return xs;
}

function renderGraph(a) {
  const svg = $("pnl-chart");
  const wrap = $("graph-wrap");
  $("graph-wrap").hidden = false;
  $("table-wrap").hidden = true;
  const W = 760, H = 270;
  const pad = { l: 58, r: 16, t: 16, b: 28 };
  const spot = a.spot;
  const now = a.now;
  const last = lastExpiryIso();
  const tExp = last ? expiryCloseUtc(last) : now;
  const tSel = selectedTime();
  const xs = priceGrid(spot, state.range, 81);
  const series = [];
  series.push({ id: "expiry", label: "At expiration", color: "#d4af37", pts: xs.map((x) => [x, pnlAt(x, tExp)]) });
  if (Math.abs(tSel - tExp) > 36e5) {
    series.push({ id: "selected", label: etDate(tSel, { month: "short", day: "numeric" }), color: "#8b7cc8", pts: xs.map((x) => [x, pnlAt(x, tSel)]) });
  }
  if (Math.abs(tSel - now) > 36e5 && Math.abs(tExp - now) > 36e5) {
    series.push({ id: "today", label: "Now", color: "#f4f6fb", pts: xs.map((x) => [x, pnlAt(x, now)]) });
  }
  const focus = series.find((s) => s.id === "selected") || series[0];
  const ys = series.flatMap((s) => s.pts.map((p) => p[1])).filter(Number.isFinite);
  let yMin = Math.min(0, ...ys);
  let yMax = Math.max(0, ...ys);
  if (yMin === yMax) { yMin -= 100; yMax += 100; }
  const padY = (yMax - yMin) * 0.12 || 50;
  yMin -= padY; yMax += padY;
  const xMin = xs[0], xMax = xs[xs.length - 1];
  const X = (x) => pad.l + ((x - xMin) / (xMax - xMin)) * (W - pad.l - pad.r);
  const Y = (y) => pad.t + ((yMax - y) / (yMax - yMin)) * (H - pad.t - pad.b);
  const pathOf = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join(" ");
  const zeroY = Y(0);
  const area = focus.pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join(" ")
    + `L${X(xMax).toFixed(2)},${zeroY}L${X(xMin).toFixed(2)},${zeroY}Z`;

  const iv = avgIv() || 0.2;
  const T = Math.max(1e-8, yearsUntil(last || ymdET(Date.now()), now));
  const mu = Math.log(spot) + (rate() - yieldQ() - 0.5 * iv * iv) * T;
  const sd = iv * Math.sqrt(T);
  const dens = xs.map((x) => {
    const z = (Math.log(x) - mu) / sd;
    return [x, normPdf(z) / (x * sd)];
  });
  const dMax = Math.max(...dens.map((d) => d[1])) || 1;
  const bell = dens.map((d, i) => {
    const y = zeroY - (d[1] / dMax) * (H - pad.t - pad.b) * 0.28;
    return `${i ? "L" : "M"}${X(d[0]).toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  const yTicks = prettyTicks(yMin, yMax, 5);
  const xTicks = prettyTicks(xMin, xMax, 6);
  const beLines = (a.breakevens || []).filter((b) => b >= xMin && b <= xMax);

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2ecc71" stop-opacity="0.35"/>
        <stop offset="50%" stop-color="#2ecc71" stop-opacity="0.08"/>
        <stop offset="50%" stop-color="#e74c3c" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="#e74c3c" stop-opacity="0.35"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0a101c"/>
    ${yTicks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1a2438" /><text x="${pad.l - 6}" y="${Y(v) + 3}" fill="#8b96ad" font-size="10" text-anchor="end">${axisMoney(v)}</text>`).join("")}
    ${xTicks.map((v) => `<text x="${X(v)}" y="${H - 8}" fill="#8b96ad" font-size="10" text-anchor="middle">${fmtPx(v, 0)}</text>`).join("")}
    <path d="${area}" fill="url(#pnlFill)" />
    <path d="${bell}" fill="none" stroke="rgba(212,175,55,0.35)" stroke-width="1.2"/>
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${zeroY}" y2="${zeroY}" stroke="#8b96ad" stroke-width="1"/>
    <line x1="${X(spot)}" x2="${X(spot)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#d4af37" stroke-dasharray="4 3"/>
    ${beLines.map((b) => `<line x1="${X(b)}" x2="${X(b)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#f4f6fb" stroke-dasharray="2 3" opacity="0.6"/><text x="${X(b)}" y="${pad.t + 10}" fill="#f4f6fb" font-size="9" text-anchor="middle">${fmtPx(b, 1)}</text>`).join("")}
    ${series.map((s) => `<path d="${pathOf(s.pts)}" fill="none" stroke="${s.color}" stroke-width="${s.id === "expiry" ? 2.2 : 1.6}"/>`).join("")}
    <g font-size="11" fill="#8b96ad">
      ${series.map((s, i) => `<g transform="translate(${pad.l + i * 130}, 14)"><line x1="0" x2="16" y1="-3" y2="-3" stroke="${s.color}" stroke-width="2"/><text x="20" y="0">${s.label}</text></g>`).join("")}
    </g>
    <line id="hover-x" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="#ffc34a" stroke-dasharray="3 3" visibility="hidden"/>
    <circle id="hover-dot" r="4" fill="#ffc34a" visibility="hidden"/>
  `;
  const tip = $("graph-hover");
  const onMove = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    const py = (ev.clientY - r.top) * (H / r.height);
    const x = xMin + ((px - pad.l) / (W - pad.l - pad.r)) * (xMax - xMin);
    if (x < xMin || x > xMax) return;
    const y = pnlAt(x, tSel);
    const hx = X(x), hy = Y(y);
    const hxline = svg.querySelector("#hover-x");
    const dot = svg.querySelector("#hover-dot");
    hxline.setAttribute("x1", hx); hxline.setAttribute("x2", hx); hxline.setAttribute("visibility", "visible");
    dot.setAttribute("cx", hx); dot.setAttribute("cy", hy); dot.setAttribute("visibility", "visible");
    const pct = ((x - spot) / spot) * 100;
    const z = (Math.log(x) - mu) / sd;
    const below = normCdf(z) * 100;
    tip.hidden = false;
    tip.style.left = Math.min(r.width - 160, Math.max(8, (hx / W) * r.width + 10)) + "px";
    tip.style.top = Math.max(8, (hy / H) * r.height - 48) + "px";
    tip.innerHTML = `<strong>${fmtPx(x, 2)}</strong>  <span style="color:#8b96ad">${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</span><br>${displayNumber(y, a, x, tSel)}`;
    let pill = wrap.querySelector(".prob-pill");
    if (!pill) { pill = document.createElement("div"); pill.className = "prob-pill"; wrap.appendChild(pill); }
    pill.hidden = false;
    pill.style.left = (hx / W) * r.width + "px";
    pill.textContent = `${below.toFixed(0)}% below  ·  ${(100 - below).toFixed(0)}% above`;
    state.hoverPx = x;
  };
  const onLeave = () => {
    tip.hidden = true;
    const pill = wrap.querySelector(".prob-pill");
    if (pill) pill.hidden = true;
    const hxline = svg.querySelector("#hover-x");
    const dot = svg.querySelector("#hover-dot");
    if (hxline) hxline.setAttribute("visibility", "hidden");
    if (dot) dot.setAttribute("visibility", "hidden");
  };
  svg.onmousemove = onMove;
  svg.onmouseleave = onLeave;
}

function prettyTicks(min, max, n) {
  const span = max - min || 1;
  const raw = span / Math.max(1, n - 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const err = raw / pow;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * pow;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.01; v += step) ticks.push(v);
  return ticks;
}
function axisMoney(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  if (abs >= 1000) return sign + "$" + Math.round(abs).toLocaleString("en-US");
  return sign + "$" + abs.toFixed(0);
}

function renderTable(a) {
  $("graph-wrap").hidden = true;
  $("table-wrap").hidden = false;
  const host = $("table-wrap");
  const spot = a.spot;
  const last = lastExpiryIso();
  const end = last ? expiryCloseUtc(last) : Date.now();
  const dates = tradingDays(Date.now(), end);
  // Keep the table readable: at most ~10 date columns, always include now + expiry.
  const cols = thinDates(dates, 10);
  const rows = [];
  const n = 25;
  const lo = spot * (1 - state.range);
  const hi = spot * (1 + state.range);
  for (let i = 0; i < n; i++) {
    const px = hi - (hi - lo) * (i / (n - 1));
    rows.push(px);
  }
  const nearSpot = rows.reduce((b, x) => Math.abs(x - spot) < Math.abs(b - spot) ? x : b, rows[0]);
  const vals = rows.map((px) => cols.map((t) => pnlAt(px, t)));
  const flat = vals.flat().filter(Number.isFinite);
  const maxAbs = Math.max(1, ...flat.map((v) => Math.abs(v)));
  const head = cols.map((t) => `<th data-c="${t}">${etDate(t, { month: "short", day: "numeric" })}</th>`).join("");
  const body = rows.map((px, i) => {
    const pct = ((px - spot) / spot) * 100;
    const spotCls = px === nearSpot ? " spot-row" : "";
    const cells = vals[i].map((v, j) => {
      const bg = heat(v, maxAbs);
      const cls = v > 0 ? "up" : v < 0 ? "dn" : "";
      return `<td class="${cls}" data-r="${i}" data-c="${cols[j]}" style="background:${bg}">${displayNumber(v, a, px, cols[j])}</td>`;
    }).join("");
    return `<tr class="${spotCls}" data-r="${i}"><th class="sticky-col">${fmtPx(px, 2)} <span style="color:#8b96ad">${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</span></th>${cells}</tr>`;
  }).join("");
  host.innerHTML = `<table class="pnl-table"><thead><tr><th class="sticky-col">Price</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
  const table = host.querySelector("table");
  table.addEventListener("mouseover", (ev) => {
    const td = ev.target.closest("td,th");
    if (!td) return;
    table.querySelectorAll(".hi-col,.hi-row").forEach((n) => n.classList.remove("hi-col", "hi-row"));
    const r = td.dataset.r ?? td.parentElement.dataset.r;
    const c = td.dataset.c;
    if (r != null) table.querySelectorAll(`[data-r="${r}"]`).forEach((n) => n.classList.add("hi-row"));
    if (c) table.querySelectorAll(`[data-c="${c}"]`).forEach((n) => n.classList.add("hi-col"));
  });
}

function thinDates(dates, max) {
  if (dates.length <= max) return dates;
  const out = [dates[0]];
  const step = (dates.length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) out.push(dates[Math.round(i * step)]);
  out.push(dates[dates.length - 1]);
  return [...new Set(out)];
}

function heat(v, maxAbs) {
  const t = clamp(v / maxAbs, -1, 1);
  if (t >= 0) return `rgba(46, 204, 113, ${0.08 + 0.45 * t})`;
  return `rgba(231, 76, 60, ${0.08 + 0.45 * -t})`;
}

function renderSliders(a) {
  const last = lastExpiryIso();
  const end = last ? expiryCloseUtc(last) : Date.now();
  const days = tradingDays(Date.now(), end);
  const sl = $("date-slider");
  sl.min = "0";
  sl.max = String(Math.max(0, days.length - 1));
  sl.disabled = days.length < 2;
  let idx = days.findIndex((t) => t >= (state.dateMs || end) - 36e5);
  if (idx < 0) idx = days.length - 1;
  sl.value = String(idx);
  const t = days[idx] || end;
  state.dateMs = t;
  $("date-label").textContent = etDate(t, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const left = Math.max(0, Math.round((end - Date.now()) / 86400000));
  $("date-right").textContent = isAtExpiry(t) ? "At expiration" : `${Math.max(0, Math.round((end - t) / 86400000))} days before expiration`;
  $("range-label").textContent = `±${Math.round(state.range * 100)}%`;
  $("range-slider").value = String(Math.round(state.range * 100));

  const iv = avgIv();
  const base = iv / (state.ivMult || 1);
  $("iv-label").textContent = `${((iv || 0) * 100).toFixed(1)}%   ×${state.ivMult.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}`;
  $("iv-slider").value = String(Math.round(state.ivMult * 100));
  $("iv-reset").hidden = Math.abs(state.ivMult - 1) < 0.005;
  const exps = uniqueLegExpiries();
  $("iv-dd").hidden = exps.length < 2;
  if (exps.length >= 2) {
    $("iv-dd-btn").textContent = state.ivScope === "average" ? "Average" : etDate(Date.parse(state.ivScope + "T12:00:00-05:00"), { month: "short", day: "numeric" });
    $("iv-dd-menu").innerHTML = [`<button type="button" data-scope="average" class="${state.ivScope === "average" ? "is-on" : ""}">Average</button>`]
      .concat(exps.map((e) => `<button type="button" data-scope="${e}" class="${state.ivScope === e ? "is-on" : ""}">${etDate(Date.parse(e + "T12:00:00-05:00"), { month: "short", day: "numeric", year: "numeric" })}</button>`))
      .join("");
  }
}

function renderToggles() {
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("is-on", b.dataset.view === state.view));
  const greek = ["delta", "theta", "gamma", "vega", "rho"].includes(state.mode);
  document.querySelectorAll("[data-mode]").forEach((b) => {
    if (b.id === "more-btn" || b.dataset.mode === "more") {
      b.classList.toggle("is-on", greek);
      if (greek) b.textContent = ({ delta: "Delta Δ", theta: "Theta Θ", gamma: "Gamma Γ", vega: "Vega ν", rho: "Rho ρ" })[state.mode] || "More";
      else b.textContent = "More";
    } else b.classList.toggle("is-on", b.dataset.mode === state.mode);
  });
}

function renderAll() {
  if (!state.quote) return;
  setTitle();
  renderQuote();
  renderBuildMenu();
  renderExpiryStrip();
  renderStrikeStrip();
  const a = analytics();
  renderStats(a);
  renderSliders(a);
  renderToggles();
  if (state.view === "table") renderTable(a);
  else renderGraph(a);
  if ($("positions-modal") && !$("positions-modal").hidden) renderPositions();
}

/* ---------- actions ---------- */

async function applyTemplate(slug, expiry) {
  const id = slug || "iron-condor";
  let exp = expiry || state.activeExpiry || expiryNearDays(uniqueExpiries(chainOf()), 30);
  if (exp) await ensureExpiries([exp]);
  // Calendars need a second expiry — fetch a later one too.
  const later = (uniqueExpiries(chainOf()) || []).find((e) => e > exp) || exp;
  if (later && later !== exp) await ensureExpiries([later]);
  const chain = { ...chainOf(), price: spotNow() };
  let legs = buildTemplate(id, { chain, spot: spotNow(), expiry: exp, style: styleOf() });
  if (!legs.length) {
    const have = [...new Set((chain.options || []).map((o) => o.expiry))].sort();
    const fallback = expiryNearDays(have, 30) || have[0];
    if (fallback) {
      exp = fallback;
      await ensureExpiries([exp]);
      legs = buildTemplate(id, { chain: { ...chainOf(), price: spotNow() }, spot: spotNow(), expiry: exp, style: styleOf() });
    }
  }
  state.template = templateBySlug(id) ? id : (id === "custom" ? "custom" : "iron-condor");
  state.legs = (legs || []).map((l) => fillFromContract(l));
  state.closed = [];
  state.activeExpiry = exp;
  if (exp) state.month = exp.slice(0, 7);
  const last = lastExpiryIso();
  state.dateMs = last ? expiryCloseUtc(last) : Date.now();
  state.ivMult = 1;
  $("build-menu").hidden = true;
  $("build-btn").setAttribute("aria-expanded", "false");
  pushUrl(true);
  renderAll();
}

async function addLeg(kind, side, type) {
  const exp = state.activeExpiry || lastExpiryIso() || expiryNearDays(uniqueExpiries(chainOf()), 30);
  await ensureExpiries([exp]);
  const strike = nearestStrike(
    [...new Set((chainOf().options || []).filter((o) => o.expiry === exp && (type ? (o.type === (type === "P" ? "put" : "call")) : true)).map((o) => Number(o.strike)))],
    spotNow(),
  );
  const leg = fillFromContract(makeLeg({
    kind: kind === "stock" ? "stock" : "option",
    type: kind === "stock" ? "S" : type,
    side,
    qty: kind === "stock" ? 100 : 1,
    strike,
    expiry: exp,
    chain: chainOf(),
    style: styleOf(),
    symbol: SYMBOL,
  }));
  state.legs.push(leg);
  state.template = "custom";
  $("add-menu").hidden = true;
  pushUrl();
  renderAll();
}

function saveTrade() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVE_KEY) || "[]");
    list.unshift({
      at: Date.now(),
      title: (templateBySlug(state.template) || { label: "Custom" }).label,
      path: encodePath({ template: state.template, symbol: SYMBOL, legs: openLegs() }),
      spot: spotNow(),
    });
    localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(0, 40)));
    toast("Trade saved in this browser.");
  } catch {
    toast("Could not save in this browser.");
  }
}

function renderPositions() {
  const open = state.legs.filter((l) => !l.closed);
  const closed = state.closed.concat(state.legs.filter((l) => l.closed));
  $("tab-open").textContent = `Open (${open.length})`;
  $("tab-closed").textContent = `Closed (${closed.length})`;
  $("tab-open").classList.toggle("is-on", state.posTab === "open");
  $("tab-closed").classList.toggle("is-on", state.posTab === "closed");
  const list = state.posTab === "open" ? open : closed;
  const now = Date.now();
  const rows = list.map((l) => {
    const mark = l.kind === "stock" || l.type === "S"
      ? spotNow()
      : valueAt(spotNow(), now, scaledLegs([l])) / (Math.abs(Number(l.qty) || 1) * (l.kind === "stock" ? 1 : MULTIPLIER)) * Math.abs(Number(l.qty) || 1);
    // Simpler P/L: positionPnL of this leg
    const pnl = positionPnL(scaledLegs([l]), scenario(spotNow(), now));
    const cls = pnl > 0 ? "up" : pnl < 0 ? "dn" : "";
    return `<div class="pos-row" data-id="${l.id}">
      <button type="button" class="gear" data-gear="${l.id}" aria-label="Edit leg">⚙</button>
      <div><div class="sym">${occLabel(l)}</div><div class="dir">${l.side === "sell" ? "Short" : "Long"} · ${l.excluded ? "Excluded" : (l.closed ? "Closed" : "Open")}</div></div>
      <div class="px">${fmtPx(entryPx(l), 2)}</div>
      <div class="px ${cls}">${formatMoney(pnl, { signed: true, decimals: 0 })}</div>
    </div>`;
  }).join("") || `<p class="hist-status">No ${state.posTab} positions.</p>`;
  $("pos-list").innerHTML = rows;
  const tot = positionPnL(scaledLegs(open.filter((l) => !l.excluded)), scenario(spotNow(), now)) - feesFor(open.filter((l) => !l.excluded));
  $("pos-gain").textContent = `Open P/L  ${formatMoney(tot, { signed: true })}`;
  $("pos-gain").className = "pos-gain " + (tot > 0 ? "up" : tot < 0 ? "dn" : "");
  $("pos-list").querySelectorAll("[data-gear]").forEach((b) => b.addEventListener("click", (ev) => openLegPop(ev, b.dataset.gear)));
  $("px-mid").classList.toggle("is-on", state.pricingMode === "mid");
  $("px-ba").classList.toggle("is-on", state.pricingMode === "ba");
}

function findLeg(id) {
  return state.legs.find((l) => l.id === id) || state.closed.find((l) => l.id === id);
}

function openLegPop(ev, id) {
  const leg = findLeg(id);
  if (!leg) return;
  const pop = $("leg-pop");
  const typ = leg.type === "P" || leg.type === "put" ? "put" : (leg.kind === "stock" ? "stock" : "call");
  const g = typ === "stock" ? null : optionGreeks(spotNow(), Number(leg.strike), yearsUntil(leg.expiry), rate(), yieldQ(), Math.max(1e-6, (Number(leg.iv) || 0) * state.ivMult), typ, styleOf());
  pop.hidden = false;
  pop.innerHTML = `
    <div class="pop-head"><strong>${occLabel(leg)}</strong><button type="button" class="icon-x" id="pop-close" aria-label="Close">×</button></div>
    <div class="stepper">
      <button type="button" id="qty-dec">−</button>
      <strong id="qty-val">${leg.qty}</strong>
      <button type="button" id="qty-inc">+</button>
    </div>
    <label>Price <input id="pop-px" type="number" step="0.01" min="0" value="${entryPx(leg) ?? ""}"></label>
    <div class="pop-grid">
      <div>Bid<strong>${fmtPx(leg.bid)}</strong></div>
      <div>Ask<strong>${fmtPx(leg.ask)}</strong></div>
      <div>Volume<strong>${leg.volume ?? "—"}</strong></div>
      <div>Open interest<strong>${leg.oi ?? "—"}</strong></div>
      <div>IV<strong>${Number.isFinite(leg.iv) ? (leg.iv * 100).toFixed(1) + "%" : "—"}</strong></div>
      <div>Delta<strong>${g ? g.delta.toFixed(3) : "—"}</strong></div>
      <div>Theta<strong>${g ? g.theta.toFixed(3) : "—"}</strong></div>
      <div>Gamma<strong>${g ? g.gamma.toFixed(4) : "—"}</strong></div>
      <div>Vega<strong>${g ? g.vega.toFixed(3) : "—"}</strong></div>
      <div>Rho<strong>${g ? g.rho.toFixed(3) : "—"}</strong></div>
    </div>
    ${typ === "stock" ? "" : `<div class="seg"><button type="button" class="seg-btn ${typ === "call" ? "is-on" : ""}" id="pop-call">Call</button><button type="button" class="seg-btn ${typ === "put" ? "is-on" : ""}" id="pop-put">Put</button></div>`}
    <div class="pop-acts">
      <button type="button" class="btn-ghost" id="pop-exclude">${leg.excluded ? "Include" : "Exclude"}</button>
      <button type="button" class="btn-ghost" id="pop-close-leg">Close</button>
      <button type="button" class="btn-ghost" id="pop-remove">Remove</button>
    </div>
  `;
  const r = ev.target.getBoundingClientRect();
  pop.style.left = Math.min(window.innerWidth - 300, Math.max(8, r.left)) + "px";
  pop.style.top = Math.min(window.innerHeight - 40, r.bottom + 6) + "px";
  const done = () => { pop.hidden = true; pushUrl(); renderAll(); };
  $("pop-close").onclick = () => { pop.hidden = true; };
  $("qty-dec").onclick = () => { leg.qty = Math.max(leg.kind === "stock" ? 1 : 1, (Number(leg.qty) || 1) - (leg.kind === "stock" ? 100 : 1)); $("qty-val").textContent = leg.qty; };
  $("qty-inc").onclick = () => { leg.qty = (Number(leg.qty) || 1) + (leg.kind === "stock" ? 100 : 1); $("qty-val").textContent = leg.qty; };
  $("pop-px").onchange = () => {
    const v = Number($("pop-px").value);
    leg.customPrice = Number.isFinite(v) ? v : null;
    if (Number.isFinite(v)) leg.entry = v;
  };
  if ($("pop-call")) $("pop-call").onclick = () => { leg.type = "C"; fillFromContract(leg); openLegPop(ev, id); };
  if ($("pop-put")) $("pop-put").onclick = () => { leg.type = "P"; fillFromContract(leg); openLegPop(ev, id); };
  $("pop-exclude").onclick = () => { leg.excluded = !leg.excluded; done(); };
  $("pop-close-leg").onclick = () => { leg.closed = true; state.closed.push(leg); done(); };
  $("pop-remove").onclick = () => { state.legs = state.legs.filter((x) => x.id !== leg.id); done(); };
}

function flipPositions() {
  for (const l of openLegs()) l.side = l.side === "sell" ? "buy" : "sell";
  renderPositions();
  pushUrl();
  renderAll();
}

function resetCustomPrices() {
  for (const l of state.legs) {
    l.customPrice = null;
    fillFromContract(l);
  }
  renderPositions();
  renderAll();
}

async function openHistory() {
  $("hist-modal").hidden = false;
  $("hist-status").textContent = "Loading delayed history… figures are a model estimate, not a live mark.";
  await drawHistory(state.histRange);
}

async function drawHistory(range) {
  state.histRange = range;
  $("hist-ranges").querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.range === range));
  try {
    const data = await provider.history(SYMBOL, range);
    const pts = (data && data.points) || [];
    if (!pts.length) {
      $("hist-status").textContent = "No delayed history available right now.";
      return;
    }
    const last = lastExpiryIso();
    const strat = pts.map((p) => {
      const t = p.t;
      if (last && t > expiryCloseUtc(last)) return { t, v: null, s: p.c };
      const v = valueAt(p.c, t);
      return { t, v, s: p.c };
    }).filter((p) => p.v != null && Number.isFinite(p.v));
    paintHist($("hist-strat"), strat.map((p) => [p.t, p.v]), "#d4af37");
    paintHist($("hist-under"), pts.map((p) => [p.t, p.c]), "#f4f6fb");
    $("hist-status").textContent = "Model estimate of strategy value using constant implied volatility and historical QQQ prices. Delayed. Not a live mark or advice.";
  } catch (err) {
    $("hist-status").textContent = "Could not load history. " + (err && err.message ? err.message : "");
  }
}

function paintHist(svg, pts, color) {
  const W = 640, H = 160;
  const pad = { l: 48, r: 10, t: 10, b: 22 };
  if (!pts.length) { svg.innerHTML = ""; return; }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const xMin = xs[0], xMax = xs[xs.length - 1] || xs[0] + 1;
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const X = (x) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * (W - pad.l - pad.r);
  const Y = (y) => pad.t + ((yMax - y) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
  const yTicks = prettyTicks(yMin, yMax, 4);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <rect width="${W}" height="${H}" fill="#0a101c"/>
    ${yTicks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1a2438"/><text x="${pad.l - 4}" y="${Y(v) + 3}" fill="#8b96ad" font-size="9" text-anchor="end">${axisMoney(v)}</text>`).join("")}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"/>
  `;
}

function closeMenus(ev) {
  const t = ev && ev.target;
  if (!t || !t.closest("#build-wrap")) {
    $("build-menu").hidden = true;
    $("build-btn").setAttribute("aria-expanded", "false");
  }
  if (!t || !t.closest("#btn-add") && !t.closest("#add-menu")) $("add-menu").hidden = true;
  if (!t || !t.closest("#more-btn") && !t.closest("#more-menu")) $("more-menu").hidden = true;
  if (!t || !t.closest("#iv-dd")) $("iv-dd-menu").hidden = true;
  if (!t || !t.closest("#leg-pop") && !t.closest("[data-gear]")) $("leg-pop").hidden = true;
}

function bind() {
  $("notice-close").onclick = () => {
    $("notice-bar").hidden = true;
    try { localStorage.setItem(NOTICE_KEY, "1"); } catch { /* ignore */ }
  };
  $("build-btn").onclick = (ev) => {
    ev.stopPropagation();
    const open = $("build-menu").hidden;
    $("build-menu").hidden = !open;
    $("build-btn").setAttribute("aria-expanded", open ? "true" : "false");
  };
  $("btn-add").onclick = (ev) => {
    ev.stopPropagation();
    const menu = $("add-menu");
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      menu.innerHTML = [
        ["Buy call", () => addLeg("option", "buy", "C")],
        ["Sell call", () => addLeg("option", "sell", "C")],
        ["Buy put", () => addLeg("option", "buy", "P")],
        ["Sell put", () => addLeg("option", "sell", "P")],
        ["Buy QQQ shares", () => addLeg("stock", "buy")],
        ["Sell QQQ shares", () => addLeg("stock", "sell")],
      ].map(([label], i) => `<button type="button" data-i="${i}">${label}</button>`).join("");
      const r = ev.currentTarget.getBoundingClientRect();
      menu.style.position = "fixed";
      menu.style.left = r.left + "px";
      menu.style.top = r.bottom + 6 + "px";
      const acts = [
        () => addLeg("option", "buy", "C"),
        () => addLeg("option", "sell", "C"),
        () => addLeg("option", "buy", "P"),
        () => addLeg("option", "sell", "P"),
        () => addLeg("stock", "buy"),
        () => addLeg("stock", "sell"),
      ];
      menu.querySelectorAll("button").forEach((b, i) => b.onclick = acts[i]);
    }
  };
  $("btn-positions").onclick = () => { $("positions-modal").hidden = false; renderPositions(); };
  $("pos-close").onclick = () => { $("positions-modal").hidden = true; };
  $("positions-modal").addEventListener("click", (e) => { if (e.target.id === "positions-modal") $("positions-modal").hidden = true; });
  $("tab-open").onclick = () => { state.posTab = "open"; renderPositions(); };
  $("tab-closed").onclick = () => { state.posTab = "closed"; renderPositions(); };
  $("pos-flip").onclick = flipPositions;
  $("pos-reset-px").onclick = resetCustomPrices;
  $("px-mid").onclick = () => { state.pricingMode = "mid"; renderPositions(); renderAll(); };
  $("px-ba").onclick = () => { state.pricingMode = "ba"; renderPositions(); renderAll(); };
  $("comm-trade").onchange = () => { state.commTrade = Number($("comm-trade").value) || 0; renderAll(); };
  $("comm-contract").onchange = () => { state.commContract = Number($("comm-contract").value) || 0; renderAll(); };
  $("comm-rt").onchange = () => { state.commRt = $("comm-rt").checked; renderAll(); };
  $("btn-save").onclick = saveTrade;
  $("btn-history").onclick = openHistory;
  $("hist-close").onclick = () => { $("hist-modal").hidden = true; };
  $("hist-modal").addEventListener("click", (e) => { if (e.target.id === "hist-modal") $("hist-modal").hidden = true; });
  $("hist-ranges").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-range]");
    if (b) drawHistory(b.dataset.range);
  });
  $("stats-prev").onclick = () => { state.statsPage = (state.statsPage + 1) % 2; renderStats(analytics()); };
  $("stats-next").onclick = () => { state.statsPage = (state.statsPage + 1) % 2; renderStats(analytics()); };
  $("date-slider").oninput = () => {
    const last = lastExpiryIso();
    const days = tradingDays(Date.now(), last ? expiryCloseUtc(last) : Date.now());
    const idx = Number($("date-slider").value);
    state.dateMs = days[idx] || state.dateMs;
    renderAll();
  };
  $("range-slider").oninput = () => {
    state.range = clamp(Number($("range-slider").value) / 100, 0.05, 0.8);
    renderAll();
  };
  $("range-reset").onclick = () => { state.range = DEFAULT_RANGE; renderAll(); };
  $("iv-slider").oninput = () => {
    state.ivMult = clamp(Number($("iv-slider").value) / 100, 1, 3);
    renderAll();
  };
  $("iv-reset").onclick = () => { state.ivMult = 1; renderAll(); };
  $("iv-dd-btn").onclick = (ev) => { ev.stopPropagation(); $("iv-dd-menu").hidden = !$("iv-dd-menu").hidden; };
  $("iv-dd-menu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-scope]");
    if (!b) return;
    state.ivScope = b.dataset.scope;
    $("iv-dd-menu").hidden = true;
    renderAll();
  });
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.onclick = () => { state.view = b.dataset.view; renderAll(); };
  });
  document.querySelectorAll("[data-mode]").forEach((b) => {
    if (b.id === "more-btn" || b.dataset.mode === "more") {
      b.onclick = (ev) => { ev.stopPropagation(); $("more-menu").hidden = !$("more-menu").hidden; };
    } else {
      b.onclick = () => { state.mode = b.dataset.mode; $("more-menu").hidden = true; renderAll(); };
    }
  });
  $("more-menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-greek]");
    if (!b) return;
    state.mode = b.dataset.greek;
    $("more-menu").hidden = true;
    renderAll();
  });
  document.addEventListener("click", closeMenus);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("positions-modal").hidden = true;
      $("hist-modal").hidden = true;
      $("leg-pop").hidden = true;
      closeMenus(null);
    }
  });
  window.addEventListener("popstate", () => bootFromUrl(true));
  window.addEventListener("resize", () => {
    if (state.quote) {
      renderStrikeStrip();
      if (state.view !== "table") renderGraph(analytics());
    }
  });
  $("ticker-input").addEventListener("keydown", (e) => e.preventDefault());
}

async function bootFromUrl(isPop) {
  const decoded = decodeState(location.search, location.pathname);
  state.template = decoded.template || "iron-condor";
  if (decoded.range > 0) state.range = decoded.range;
  if (decoded.ivMult > 0) state.ivMult = decoded.ivMult;
  if (decoded.display) state.mode = decoded.display;
  const need = new Set();
  if (decoded.legs && decoded.legs.length) {
    for (const e of decoded.legs) if (e.expiry) need.add(e.expiry);
  }
  const def = expiryNearDays(uniqueExpiries(chainOf()), 30);
  if (!need.size && def) need.add(def);
  await ensureExpiries([...need]);
  if (decoded.legs && decoded.legs.length) {
    state.legs = hydrateEntries(decoded.legs);
    state.activeExpiry = uniqueLegExpiries()[0] || def;
  } else {
    await applyTemplate(state.template, def);
    return;
  }
  const last = lastExpiryIso();
  state.dateMs = last ? expiryCloseUtc(last) : Date.now();
  if (state.activeExpiry) state.month = state.activeExpiry.slice(0, 7);
  if (!isPop) pushUrl(true);
  renderAll();
}

async function start() {
  bind();
  try {
    if (!localStorage.getItem(NOTICE_KEY)) $("notice-bar").hidden = false;
  } catch { $("notice-bar").hidden = false; }
  try {
    await loadBase();
    renderQuote();
    await bootFromUrl(false);
  } catch (err) {
    toast("Could not load delayed QQQ quotes. " + (err && err.message ? err.message : "Try again shortly."));
  }
}

start();
