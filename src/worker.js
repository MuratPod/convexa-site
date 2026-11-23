/**
 * Convexa site Worker: serves static assets and a small delayed-quotes
 * proxy at /api/*. Quotes are cached at the edge for 60 seconds.
 *
 * Primary source: Cboe delayed options JSON (public delayed-quotes feed).
 * Fallback: Nasdaq.com delayed option-chain JSON used by their public pages.
 * Neither feed is a licensed redistributable market-data product — see README.
 */

const CACHE_TTL = 60;
const SWR_TTL = 300;
const STORE_TTL = 86400;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const EUROPEAN = new Set([
  "SPX", "XSP", "NDX", "RUT", "VIX", "DJX", "OEX", "XEO", "MXEA", "MXEF",
  "SPXW", "RUTW", "VIXW",
]);

const jsonHead = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}, stale-while-revalidate=${SWR_TTL}, stale-if-error=86400`,
  "cdn-cache-control": `public, max-age=${CACHE_TTL}, stale-while-revalidate=${SWR_TTL}, stale-if-error=86400`,
  "cloudflare-cdn-cache-control": `public, max-age=${CACHE_TTL}, stale-while-revalidate=${SWR_TTL}, stale-if-error=86400`,
  "access-control-allow-origin": "https://convexa.today",
};

function ok(data, extra = {}) {
  return new Response(JSON.stringify(data), { status: 200, headers: { ...jsonHead, ...extra } });
}

function fail(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: jsonHead });
}

function cleanSymbol(raw) {
  const s = String(raw || "").trim().toUpperCase().replace(/^\^/, "").replace(/^\$/, "");
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(s)) return null;
  return s;
}

function num(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (t === "" || t === "--" || t === "N/A" || t === "NA" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseYield(v) {
  const n = num(v);
  if (n == null) return 0;
  // Nasdaq prints "0.47%"; if already a fraction < 0.2 leave it, else /100.
  return n > 1 ? n / 100 : n / 100; // both "0.47%" after stripping % is 0.47 → /100
}

function parseYieldPct(v) {
  if (v == null) return 0;
  const t = String(v).trim();
  const n = num(t);
  if (n == null) return 0;
  if (String(v).includes("%") || n > 0.25) return n / 100;
  return n; // already a fraction such as 0.0047
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseLongDate(s) {
  // "November 23, 2026"
  const m = String(s || "").trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}

function occExpiry(url) {
  const m = String(url || "").match(/(\d{6})[cp]/i);
  if (!m) return null;
  const y = m[1].slice(0, 2);
  const mo = m[1].slice(2, 4);
  const d = m[1].slice(4, 6);
  const year = Number(y) >= 70 ? `19${y}` : `20${y}`;
  return `${year}-${mo}-${d}`;
}

async function fetchText(url, init = {}, timeoutMs = 8000) {
  const { noCache, ...rest } = init;
  const signal = rest.signal || (typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(timeoutMs)
    : undefined);
  const res = await fetch(url, {
    ...rest,
    signal,
    headers: {
      "user-agent": UA,
      accept: "application/json,text/plain,*/*",
      ...(rest.headers || {}),
    },
    ...(noCache ? { cf: { cacheTtl: 0, cacheEverything: false } } : {}),
  });
  const text = await res.text();
  return { res, text };
}

function cboeSymbol(sym) {
  if (EUROPEAN.has(sym) || ["SPX", "NDX", "RUT", "VIX", "DJX", "OEX"].includes(sym)) {
    return `_${sym}`;
  }
  return sym;
}

function parseCboe(json, requested) {
  const data = json.data || json;
  if (!data || (!data.options && data.current_price == null && data.last_trade_price == null)) {
    return null;
  }
  const price = num(data.current_price ?? data.last_trade_price ?? data.close ?? data.price);
  const optionsIn = Array.isArray(data.options) ? data.options : [];
  const expirations = [];
  const options = [];
  for (const o of optionsIn) {
    const occ = String(o.option || o.symbol || "");
    const m = occ.match(/^(?:[A-Z]+|_[A-Z]+)(\d{6})([CP])(\d{8})$/i);
    let expiry = null;
    let type = null;
    let strike = null;
    if (m) {
      const yymmdd = m[1];
      const year = Number(yymmdd.slice(0, 2)) >= 70 ? `19${yymmdd.slice(0, 2)}` : `20${yymmdd.slice(0, 2)}`;
      expiry = `${year}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
      type = m[2].toUpperCase() === "P" ? "put" : "call";
      strike = Number(m[3]) / 1000;
    }
    expiry = expiry || o.expiration_date || o.expiry || null;
    type = type || (String(o.option_type || o.type || "").toLowerCase().startsWith("p") ? "put" : "call");
    strike = strike ?? num(o.strike);
    if (!expiry || !strike) continue;
    if (!expirations.includes(expiry)) expirations.push(expiry);
    const bid = num(o.bid);
    const ask = num(o.ask);
    const last = num(o.last_trade_price ?? o.last);
    let mid = null;
    if (bid != null && ask != null && ask > 0) mid = (bid + ask) / 2;
    else if (last != null) mid = last;
    const iv = num(o.iv ?? o.implied_volatility);
    options.push({
      contract: occ || `${requested}${expiry}${type[0].toUpperCase()}${strike}`,
      type,
      expiry,
      strike,
      bid,
      ask,
      last,
      mid,
      iv: iv != null && iv > 0 ? (iv > 2 ? iv / 100 : iv) : null,
      oi: num(o.open_interest ?? o.oi),
      volume: num(o.volume),
    });
  }
  expirations.sort();
  const chg = num(data.price_change ?? data.change ?? data.net_change);
  const chgPct = num(data.price_change_percent ?? data.percent_change ?? data.change_percent);
  return {
    symbol: requested,
    name: data.company_name || data.name || requested,
    price,
    change: chg,
    changePct: chgPct != null && Math.abs(chgPct) > 1 && String(data.price_change_percent || "").includes("%")
      ? chgPct / 100
      : chgPct != null && Math.abs(chgPct) > 50
        ? chgPct / 100
        : chgPct,
    bid: num(data.bid),
    ask: num(data.ask),
    asOf: data.last_trade_time || data.time || data.timestamp || null,
    delayed: true,
    source: "cboe",
    style: EUROPEAN.has(requested) ? "european" : "american",
    yield: num(data.dividend_yield) != null ? parseYieldPct(data.dividend_yield) : 0,
    rate: null,
    ivAtm: num(data.iv30 ?? data.implied_volatility),
    expirations,
    options,
  };
}

async function tryCboe(sym) {
  const hostSym = cboeSymbol(sym);
  // A single host; the cdn.cboe.com URL already 307s to cdn-api when it works.
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(hostSym)}.json`;
  try {
    const { res, text } = await fetchText(url, {}, 4000);
    if (!res.ok || text.trim().startsWith("<")) {
      console.warn("cboe_skip", res.status, text.slice(0, 80));
      return null;
    }
    const json = JSON.parse(text);
    const parsed = parseCboe(json, sym);
    if (parsed && parsed.price && parsed.options.length) return parsed;
  } catch {
    return null;
  }
  return null;
}

const ASSET_CLASSES = ["stocks", "etf", "index"];

async function nasdaqGet(path, timeoutMs = 12000) {
  const url = `https://api.nasdaq.com${path}`;
  const { res, text } = await fetchText(url, {
    headers: {
      origin: "https://www.nasdaq.com",
      referer: "https://www.nasdaq.com/",
      accept: "application/json, text/plain, */*",
    },
  }, timeoutMs);
  if (!res.ok) {
    console.warn("nasdaq_http", res.status, path, text.slice(0, 120));
    throw new Error(`nasdaq ${res.status}`);
  }
  return JSON.parse(text);
}

async function detectAssetClass(sym) {
  // This public builder is QQQ-only; skip the three-way asset-class probe.
  if (sym === "QQQ") {
    try {
      const j = await nasdaqGet(`/api/quote/${encodeURIComponent(sym)}/info?assetclass=etf`);
      const code = j && j.status && j.status.rCode;
      if (j && j.data && j.data.symbol && (code == null || code === 200 || code === 0)) {
        return { ac: "etf", info: j.data };
      }
    } catch (err) {
      console.warn("nasdaq_ac_fail", "etf", String(err && err.message ? err.message : err));
    }
  }
  const tries = await Promise.all(ASSET_CLASSES.map(async (ac) => {
    try {
      const j = await nasdaqGet(`/api/quote/${encodeURIComponent(sym)}/info?assetclass=${ac}`);
      const code = j && j.status && j.status.rCode;
      console.warn("nasdaq_info", ac, "rCode", code, "symbol", j && j.data && j.data.symbol);
      if (j && j.data && j.data.symbol && (code == null || code === 200 || code === 0)) {
        return { ac, info: j.data };
      }
    } catch (err) {
      console.warn("nasdaq_ac_fail", ac, String(err && err.message ? err.message : err));
      return null;
    }
    return null;
  }));
  return tries.find(Boolean) || null;
}

function parseNasdaqInfo(info, sym) {
  const p = info.primaryData || {};
  const price = num(p.lastSalePrice);
  const change = num(p.netChange);
  let changePct = num(p.percentageChange);
  if (changePct != null && String(p.percentageChange || "").includes("%")) {
    // already stripped by num(), value is 5.67 meaning 5.67%
    changePct = changePct / 100;
  } else if (changePct != null && Math.abs(changePct) > 1) {
    changePct = changePct / 100;
  }
  return {
    symbol: info.symbol || sym,
    name: info.companyName || sym,
    price,
    change,
    changePct,
    bid: num(p.bidPrice),
    ask: num(p.askPrice),
    asOf: p.lastTradeTimestamp || null,
    marketStatus: info.marketStatus || null,
    assetClass: info.assetClass || null,
    delayed: p.isRealTime === false || true,
  };
}

async function nasdaqSummaryYield(sym, ac) {
  try {
    const j = await nasdaqGet(`/api/quote/${encodeURIComponent(sym)}/summary?assetclass=${ac}`);
    const y = j && j.data && j.data.summaryData && j.data.summaryData.Yield;
    return y ? parseYieldPct(y.value) : 0;
  } catch {
    return 0;
  }
}

function parseNasdaqChain(json, requested, fallbackExpiry) {
  const data = json.data || {};
  const rows = (data.table && data.table.rows) || [];
  const expirations = [];
  const options = [];
  let groupExpiry = fallbackExpiry || null;
  const filter = data.filterlist && data.filterlist.fromdate && data.filterlist.fromdate.filter;
  if (Array.isArray(filter)) {
    for (const f of filter) {
      if (!f.value || f.value === "all") continue;
      const [a, b] = String(f.value).split("|");
      if (a && !expirations.includes(a) && /^\d{4}-\d{2}-\d{2}$/.test(a)) expirations.push(a);
      if (b && !expirations.includes(b) && /^\d{4}-\d{2}-\d{2}$/.test(b)) expirations.push(b);
    }
  }
  for (const row of rows) {
    if (row.expirygroup) {
      const d = parseLongDate(row.expirygroup);
      if (d) {
        groupExpiry = d;
        if (!expirations.includes(d)) expirations.push(d);
      }
      continue;
    }
    const expiry = occExpiry(row.drillDownURL) || groupExpiry;
    if (!expiry) continue;
    if (!expirations.includes(expiry)) expirations.push(expiry);
    const strike = num(row.strike);
    if (strike == null) continue;
    const push = (type, prefix) => {
      const bid = num(row[`${prefix}Bid`]);
      const ask = num(row[`${prefix}Ask`]);
      const last = num(row[`${prefix}Last`]);
      let mid = null;
      if (bid != null && ask != null && (bid > 0 || ask > 0)) mid = (Math.max(bid, 0) + Math.max(ask, bid || 0)) / 2;
      else if (last != null) mid = last;
      const occMatch = String(row.drillDownURL || "").match(/([a-z0-9]+)[-]+(\d{6})([cp])(\d{8})$/i);
      const contract = occMatch
        ? `${occMatch[1].toUpperCase()}${occMatch[2]}${occMatch[3].toUpperCase()}${occMatch[4]}`
        : (row.drillDownURL || `${requested}${expiry}${type[0].toUpperCase()}${strike}`);
      options.push({
        contract,
        type,
        expiry,
        strike,
        bid,
        ask,
        last,
        mid,
        iv: null,
        oi: num(row[`${prefix}Openinterest`]),
        volume: num(row[`${prefix}Volume`]),
      });
    };
    push("call", "c_");
    push("put", "p_");
  }
  expirations.sort();
  const lastTrade = data.lastTrade || "";
  const priceMatch = lastTrade.match(/\$([0-9,]+\.\d+)/);
  const asOfMatch = lastTrade.match(/AS OF\s+([A-Z]{3}\s+\d{1,2},\s+\d{4})/i);
  return {
    price: priceMatch ? num(priceMatch[1]) : null,
    asOf: asOfMatch ? asOfMatch[1] : null,
    expirations,
    options,
    source: "nasdaq",
  };
}

async function tryNasdaq(sym, expiry) {
  const detected = await detectAssetClass(sym);
  if (!detected) return null;
  const { ac, info } = detected;
  const infoPart = parseNasdaqInfo(info, sym);
  // Single-date fromdate works; "YYYY-MM-DD|YYYY-MM-DD" is rejected by Nasdaq.
  // fromdate=all is only used to discover the full expiry list, then we trim
  // the payload to the requested (or nearest) expiry so the client is small.
  const fromdate = expiry || "all";
  const [chainJson, yld] = await Promise.all([
    nasdaqGet(`/api/quote/${encodeURIComponent(sym)}/option-chain?assetclass=${ac}&fromdate=${encodeURIComponent(fromdate)}`),
    nasdaqSummaryYield(sym, ac),
  ]);
  const chain = parseNasdaqChain(chainJson, sym, expiry);
  let options = chain.options;
  if (expiry) {
    options = options.filter((o) => o.expiry === expiry);
  } else {
    options = preferDefaultExpiries({ ...chain, options });
  }
  return {
    symbol: infoPart.symbol,
    name: infoPart.name,
    price: infoPart.price || chain.price,
    change: infoPart.change,
    changePct: infoPart.changePct,
    bid: infoPart.bid,
    ask: infoPart.ask,
    asOf: infoPart.asOf || chain.asOf,
    delayed: true,
    source: "nasdaq",
    style: EUROPEAN.has(sym) ? "european" : "american",
    yield: yld || 0,
    rate: null,
    ivAtm: null,
    assetClass: infoPart.assetClass,
    expirations: chain.expirations,
    options,
  };
}

const DEFAULT_RATE = 0.041;


function unixToIso(ts) {
  const d = new Date(Number(ts) * 1000);
  if (!Number.isFinite(d.getTime())) return null;
  // Listed expirations are calendar dates in America/New_York
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseYahoo(json, requested, filterExpiry) {
  const result = json && json.optionChain && Array.isArray(json.optionChain.result) && json.optionChain.result[0];
  if (!result) return null;
  const q = result.quote || {};
  const price = num(q.regularMarketPrice ?? q.postMarketPrice ?? q.preMarketPrice);
  const expirations = (result.expirationDates || []).map(unixToIso).filter(Boolean);
  const options = [];
  for (const pack of result.options || []) {
    const expiry = unixToIso(pack.expirationDate) || filterExpiry;
    if (expiry && !expirations.includes(expiry)) expirations.push(expiry);
    const ingest = (list, type) => {
      for (const o of list || []) {
        const bid = num(o.bid);
        const ask = num(o.ask);
        const last = num(o.lastPrice);
        let mid = null;
        if (bid != null && ask != null && (bid > 0 || ask > 0)) mid = (Math.max(bid, 0) + Math.max(ask, bid || 0)) / 2;
        else if (last != null) mid = last;
        const iv = num(o.impliedVolatility);
        options.push({
          contract: o.contractSymbol || `${requested}${expiry}${type[0].toUpperCase()}${o.strike}`,
          type,
          expiry,
          strike: num(o.strike),
          bid,
          ask,
          last,
          mid,
          iv: iv != null && iv > 0 ? iv : null,
          oi: num(o.openInterest),
          volume: num(o.volume),
        });
      }
    };
    ingest(pack.calls, "call");
    ingest(pack.puts, "put");
  }
  expirations.sort();
  let yld = num(q.dividendYield ?? q.trailingAnnualDividendYield);
  if (yld != null && yld > 0.25) yld = yld / 100;
  let chgPct = num(q.regularMarketChangePercent);
  if (chgPct != null && Math.abs(chgPct) > 1) chgPct = chgPct / 100;
  return {
    symbol: result.underlyingSymbol || requested,
    name: q.shortName || q.longName || requested,
    price,
    change: num(q.regularMarketChange),
    changePct: chgPct,
    bid: num(q.bid),
    ask: num(q.ask),
    asOf: q.regularMarketTime ? new Date(q.regularMarketTime * 1000).toISOString() : null,
    delayed: true,
    source: "yahoo",
    style: EUROPEAN.has(requested) ? "european" : "american",
    yield: yld || 0,
    rate: null,
    ivAtm: null,
    expirations,
    options,
  };
}


let yahooAuth = { crumb: null, cookie: "", exp: 0 };

function collectCookies(res) {
  if (res.headers && typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie().map((c) => String(c).split(";")[0]).filter(Boolean);
  }
  const raw = res.headers.get("set-cookie");
  return raw ? [String(raw).split(";")[0]] : [];
}

async function followForCookies(startUrl) {
  const cookieParts = [];
  let current = startUrl;
  for (let hop = 0; hop < 6; hop++) {
    const cookie = [...new Set(cookieParts)].join("; ");
    const { res } = await fetchText(current, {
      redirect: "manual",
      noCache: true,
      headers: {
        accept: "text/html,application/xhtml+xml,*/*",
        cookie,
      },
    }, 5000);
    cookieParts.push(...collectCookies(res));
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = new URL(loc, current).toString();
      continue;
    }
    break;
  }
  return cookieParts;
}

async function rawYahooFetch(url, headers = {}, timeoutMs = 8000) {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      "accept": "text/html,application/xhtml+xml,text/plain,*/*",
      "accept-language": "en-US,en;q=0.9",
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { res, text };
}

async function getYahooAuth() {
  if (yahooAuth.crumb && yahooAuth.exp > Date.now() + 5000) return yahooAuth;
  const cookieParts = [];
  // Handshake documented to work from Cloudflare Workers:
  // GET fc.yahoo.com (often 404) → A1/A3 cookies, then GET /v1/test/getcrumb.
  try {
    const seed = await rawYahooFetch("https://fc.yahoo.com/");
    cookieParts.push(...collectCookies(seed.res));
  } catch (err) {
    console.warn("yahoo_cookie_fail", "fc", String(err && err.message ? err.message : err));
  }
  if (!cookieParts.length) {
    try {
      cookieParts.push(...await followForCookies("https://fc.yahoo.com/"));
    } catch (err) {
      console.warn("yahoo_cookie_fail", "fc_follow", String(err && err.message ? err.message : err));
    }
  }
  if (!cookieParts.some((c) => /^A[13S]=/.test(c))) {
    try {
      const home = await rawYahooFetch("https://finance.yahoo.com/");
      cookieParts.push(...collectCookies(home.res));
    } catch (err) {
      console.warn("yahoo_cookie_fail", "home", String(err && err.message ? err.message : err));
    }
  }
  const cookie = [...new Set(cookieParts)].join("; ");
  let lastCrumb = { status: 0, body: "", host: "" };
  const crumbHosts = [
    "https://query1.finance.yahoo.com/v1/test/getcrumb",
    "https://query2.finance.yahoo.com/v1/test/getcrumb",
  ];
  for (const url of crumbHosts) {
    try {
      const { res, text } = await rawYahooFetch(url, {
        cookie,
        accept: "text/plain,*/*",
        referer: "https://finance.yahoo.com/",
      }, 5000);
      const crumb = String(text || "").trim();
      lastCrumb = { status: res.status, body: crumb.slice(0, 80), host: url };
      if (res.ok && crumb && crumb.length < 80 && !crumb.includes("{") && !crumb.includes("<") && !/too many/i.test(crumb)) {
        yahooAuth = { crumb, cookie, exp: Date.now() + 15 * 60 * 1000, lastCrumb };
        return yahooAuth;
      }
      console.warn("yahoo_crumb_skip", res.status, crumb.slice(0, 80), "cookies", cookieParts.length);
      if (res.status === 429) {
        yahooAuth = { crumb: null, cookie, exp: Date.now() + 60 * 1000, lastCrumb };
        return yahooAuth;
      }
    } catch (err) {
      lastCrumb = { status: 0, body: String(err && err.message ? err.message : err), host: url };
      console.warn("yahoo_crumb_fail", String(err && err.message ? err.message : err));
    }
  }
  yahooAuth = { crumb: null, cookie, exp: 0, lastCrumb };
  return yahooAuth;
}

async function yahooOptions(sym, expiry, auth) {
  const hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
  const dateParam = expiry
    ? `date=${Math.floor(new Date(`${expiry}T16:00:00-05:00`).getTime() / 1000)}&`
    : "";
  const headers = {
    accept: "application/json",
    referer: "https://finance.yahoo.com/",
    origin: "https://finance.yahoo.com",
    cookie: auth.cookie,
  };
  for (const host of hosts) {
    const url = `${host}/v7/finance/options/${encodeURIComponent(sym)}?${dateParam}crumb=${encodeURIComponent(auth.crumb)}`;
    try {
      const { res, text } = await fetchText(url, { headers }, 8000);
      if (!res.ok || text.trim().startsWith("<") || text.includes("Too Many Requests")) {
        console.warn("yahoo_skip", res.status, host);
        if (res.status === 401) yahooAuth = { crumb: null, cookie: "", exp: 0 };
        continue;
      }
      const parsed = parseYahoo(JSON.parse(text), sym, expiry);
      if (parsed && parsed.price) return parsed;
    } catch (err) {
      console.warn("yahoo_fail", host, String(err && err.message ? err.message : err));
    }
  }
  return null;
}

async function tryYahoo(sym, expiry) {
  const auth = await getYahooAuth();
  if (!auth || !auth.crumb) return null;
  const first = await yahooOptions(sym, expiry, auth);
  if (!first) return null;
  // When no specific expiry is requested, pull a handful of later expiries so
  // calendars / later templates have contracts without a 2MB dump.
  if (!expiry && first.expirations && first.expirations.length > 1) {
    const have = new Set(first.options.map((o) => o.expiry));
    const extra = first.expirations.filter((e) => !have.has(e)).slice(0, 6);
    const packs = await Promise.all(extra.map((e) => yahooOptions(sym, e, auth)));
    for (const pack of packs) {
      if (pack && pack.options) first.options.push(...pack.options);
    }
  }
  return first;
}

function firstUseful(promises, useful) {
  return new Promise((resolve) => {
    let pending = promises.length;
    let settled = false;
    if (!pending) return resolve(null);
    for (const p of promises) {
      Promise.resolve(p).then((value) => {
        if (!settled && useful(value)) {
          settled = true;
          resolve(value);
          return;
        }
        pending -= 1;
        if (!settled && pending === 0) resolve(null);
      }).catch((err) => {
        console.warn("source_fail", String(err && err.message ? err.message : err));
        pending -= 1;
        if (!settled && pending === 0) resolve(null);
      });
    }
  });
}

async function loadChain(sym, expiry) {
  // Nasdaq delayed option-chain is the reliable edge source today. Yahoo is
  // preferable when the crumb handshake works (it includes IV) but getcrumb
  // often 429s from shared Worker IPs. Cboe is typically blocked (403).
  const picked = await firstUseful([
    tryYahoo(sym, expiry),
    tryNasdaq(sym, expiry),
    tryCboe(sym),
  ], (data) => data && data.price && (!expiry || (data.options && data.options.length)));
  if (!picked) return null;
  picked.rate = DEFAULT_RATE;
  if (expiry && picked.options && picked.options.length) {
    picked.options = picked.options.filter((o) => o.expiry === expiry);
  }
  // Default (no expiry) payload: keep the near-30-day book so the first
  // page load does not need a second 5–6s chain request.
  if (!expiry) {
    picked.options = preferDefaultExpiries(picked);
    const have = new Set((picked.options || []).map((o) => o.expiry));
    const want = expiryNearDays(picked.expirations || [], 30);
    if (want && !have.has(want)) {
      const extra = await firstUseful([
        tryYahoo(sym, want),
        tryNasdaq(sym, want),
      ], (data) => data && data.options && data.options.length);
      if (extra && extra.options) {
        picked.options = (picked.options || []).concat(extra.options.filter((o) => o.expiry === want));
        if (extra.price) picked.price = extra.price;
      }
    }
  }
  return picked;
}


function expiryNearDays(expiries, days = 30, now = Date.now()) {
  if (!expiries || !expiries.length) return null;
  const target = now + days * 86400000;
  let best = expiries[0];
  let bestD = Infinity;
  for (const e of expiries) {
    const ts = Date.parse(e + "T16:00:00-05:00");
    if (!Number.isFinite(ts)) continue;
    const d = Math.abs(ts - target);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

function preferDefaultExpiries(chain) {
  const options = (chain && chain.options) || [];
  const expirations = (chain && chain.expirations) || [];
  const have = [...new Set(options.map((o) => o.expiry).filter(Boolean))].sort();
  const nearest = expirations[0] || have[0];
  const around30 = expiryNearDays(expirations.length ? expirations : have, 30);
  const keep = new Set([nearest, around30].filter(Boolean));
  if (!keep.size) return options;
  const trimmed = options.filter((o) => keep.has(o.expiry));
  return trimmed.length ? trimmed : options;
}

function cacheKeyFor(url) {
  return new Request(url.origin + url.pathname + url.search, { method: "GET" });
}

function cacheAgeSeconds(res) {
  const raw = res.headers.get("x-cached-at") || res.headers.get("date");
  const t = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, (Date.now() - t) / 1000);
}

function stampCached(res, age, kind) {
  const headers = new Headers(res.headers);
  const remain = Math.max(0, Math.round(CACHE_TTL - age));
  const cc = `public, max-age=${remain}, s-maxage=${remain}, stale-while-revalidate=${SWR_TTL}, stale-if-error=86400`;
  headers.set("cache-control", cc);
  headers.set("cdn-cache-control", `public, max-age=${CACHE_TTL}, stale-while-revalidate=${SWR_TTL}, stale-if-error=86400`);
  headers.set("cloudflare-cdn-cache-control", headers.get("cdn-cache-control"));
  headers.set("age", String(Math.max(0, Math.floor(age))));
  headers.set("x-builder-cache", kind);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function toStoredResponse(response) {
  const body = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set("x-cached-at", new Date().toISOString());
  // Keep the entry in caches.default past the public 60s TTL so we can
  // serve stale-while-revalidate instead of making the visitor wait 5–6s.
  headers.set("cache-control", `public, max-age=${STORE_TTL}`);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

async function loadAndStore(url, cache, key) {
  let response;
  try {
    response = await handleApi(url);
  } catch (err) {
    console.error("api_error", String(err && err.message ? err.message : err));
    response = fail(502, "Upstream quotes are unavailable right now.");
  }
  if (response.status === 200) {
    try {
      const stored = await toStoredResponse(response);
      await cache.put(key, stored.clone());
      return stampCached(stored, 0, "miss");
    } catch (err) {
      console.warn("cache_put_fail", String(err && err.message ? err.message : err));
    }
  }
  return response;
}

async function serveCachedApi(url, ctx) {
  const cache = caches.default;
  const key = cacheKeyFor(url);
  let hit = null;
  try { hit = await cache.match(key); } catch (err) {
    console.warn("cache_match_fail", String(err && err.message ? err.message : err));
  }
  const age = hit ? cacheAgeSeconds(hit) : Infinity;
  if (hit && age < CACHE_TTL) {
    return stampCached(hit, age, "hit");
  }
  if (hit && age < CACHE_TTL + SWR_TTL) {
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(loadAndStore(url, cache, key).catch((err) => {
        console.warn("swr_refresh_fail", String(err && err.message ? err.message : err));
      }));
    }
    return stampCached(hit, age, "swr");
  }
  const fresh = await loadAndStore(url, cache, key);
  if ((fresh.status >= 500 || fresh.status === 404) && hit) {
    return stampCached(hit, age, "stale-if-error");
  }
  return fresh;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "https://convexa.today",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
        },
      });
    }

    if (url.pathname.startsWith("/api/")) {
      const isHealth = url.pathname.replace(/\/+$/, "") === "/api/health";
      if (isHealth) {
        try { return await handleApi(url); }
        catch (err) {
          console.error("api_error", String(err && err.message ? err.message : err));
          return fail(502, "Upstream quotes are unavailable right now.");
        }
      }
      return serveCachedApi(url, ctx);
    }

    // Directory URL /builder → /builder/
    if (url.pathname === "/builder") {
      const redir = new URL(request.url);
      redir.pathname = "/builder/";
      if (url.search) redir.search = url.search;
      return Response.redirect(redir.toString(), 301);
    }

    // SPA routes: /builder/<strategy>/<TICKER>/... serve the builder page.
    if (url.pathname.startsWith("/builder/") && env.ASSETS) {
      const file = url.pathname.match(/^\/builder\/[^/]+\.(js|css|map|svg|png|webp|ico)$/);
      if (!file) {
        // Asset binder 307s /builder/index.html → /builder/. Fetch the
        // directory URL so SPA routes do not bounce back into this worker.
        const page = new URL("/builder/", url.origin);
        return env.ASSETS.fetch(new Request(page.toString(), request));
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};

async function handleApi(url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/health") {
    return ok({ ok: true, service: "convexa-builder" });
  }


  if (path === "/api/quote" || path === "/api/chain" || path === "/api/expirations") {
    const sym = cleanSymbol(url.searchParams.get("symbol") || url.searchParams.get("s"));
    if (!sym) return fail(400, "Pass a ticker in ?symbol=");
    if (sym !== "QQQ") return fail(400, "This public builder is limited to QQQ for now.");
    const expiry = url.searchParams.get("expiry") || url.searchParams.get("expiration") || null;
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return fail(400, "expiry must be YYYY-MM-DD");
    const data = await loadChain(sym, path === "/api/quote" || path === "/api/expirations" ? null : expiry);
    if (!data || !data.price) return fail(404, `No delayed chain for ${sym}. This public builder is limited to QQQ for now.`);
    if (path === "/api/quote") {
      return ok({
        symbol: data.symbol,
        name: data.name,
        price: data.price,
        change: data.change,
        changePct: data.changePct,
        bid: data.bid,
        ask: data.ask,
        asOf: data.asOf,
        delayed: true,
        source: data.source,
        style: data.style,
        yield: data.yield,
        rate: data.rate,
        ivAtm: data.ivAtm,
        expirations: data.expirations,
      });
    }
    if (path === "/api/expirations") {
      return ok({ symbol: data.symbol, expirations: data.expirations, source: data.source });
    }
    return ok({
      symbol: data.symbol,
      name: data.name,
      price: data.price,
      change: data.change,
      changePct: data.changePct,
      asOf: data.asOf,
      delayed: true,
      source: data.source,
      style: data.style,
      yield: data.yield,
      rate: data.rate,
      ivAtm: data.ivAtm,
      expirations: data.expirations,
      options: data.options,
    });
  }

  if (path === "/api/search") {
    const q = String(url.searchParams.get("q") || url.searchParams.get("query") || "").trim().toUpperCase();
    const hit = { symbol: "QQQ", name: "Invesco QQQ Trust, Series 1" };
    const results = !q || "QQQ".startsWith(q) || "INVESCO QQQ TRUST".includes(q) ? [hit] : [];
    return ok({ query: q, results, delayed: true, source: "qqq-only" });
  }

  if (path === "/api/history") {
    const sym = cleanSymbol(url.searchParams.get("symbol") || url.searchParams.get("s"));
    if (!sym) return fail(400, "Pass a ticker in ?symbol=");
    if (sym !== "QQQ") return fail(400, "This public builder is limited to QQQ for now.");
    const range = String(url.searchParams.get("range") || "5d");
    const allowed = new Set(["1d", "5d", "10d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"]);
    const r = allowed.has(range) ? range : "5d";
    const interval = r === "1d" ? "5m" : (r === "5d" || r === "10d" ? "15m" : "1d");
    const data = await yahooHistory(sym, r, interval);
    if (!data) return fail(404, `No history for ${sym}.`);
    return ok(data);
  }

  return fail(404, "Unknown API route.");
}

const FALLBACK_TICKERS = [
  ["QQQ", "Invesco QQQ Trust"],
  ["SPY", "SPDR S&P 500 ETF"],
  ["IWM", "iShares Russell 2000 ETF"],
  ["DIA", "SPDR Dow Jones Industrial Average"],
  ["AAPL", "Apple Inc."],
  ["MSFT", "Microsoft Corporation"],
  ["NVDA", "NVIDIA Corporation"],
  ["AMZN", "Amazon.com Inc."],
  ["GOOGL", "Alphabet Inc. Class A"],
  ["META", "Meta Platforms Inc."],
  ["TSLA", "Tesla Inc."],
  ["AMD", "Advanced Micro Devices"],
  ["NFLX", "Netflix Inc."],
  ["AVGO", "Broadcom Inc."],
  ["COST", "Costco Wholesale"],
  ["TQQQ", "ProShares UltraPro QQQ"],
  ["SQQQ", "ProShares UltraPro Short QQQ"],
  ["QLD", "ProShares Ultra QQQ"],
  ["PSQ", "ProShares Short QQQ"],
  ["QID", "ProShares UltraShort QQQ"],
];

async function searchSymbols(query) {
  const needle = query.toUpperCase();
  const local = FALLBACK_TICKERS
    .filter(([sym, name]) => sym.includes(needle) || name.toUpperCase().includes(needle))
    .map(([symbol, name]) => ({ symbol, name }));
  try {
    const { res, text } = await fetchText(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0&listsCount=0`,
      { headers: { referer: "https://finance.yahoo.com/", origin: "https://finance.yahoo.com" } },
      4000,
    );
    if (res.ok && text && !text.trim().startsWith("<")) {
      const json = JSON.parse(text);
      const quotes = (json && json.quotes) || [];
      const seen = new Set();
      const results = [];
      for (const row of quotes) {
        const symbol = String(row.symbol || "").toUpperCase();
        if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) || seen.has(symbol)) continue;
        if (row.quoteType && !/equity|etf|index/i.test(String(row.quoteType))) continue;
        seen.add(symbol);
        results.push({ symbol, name: row.shortname || row.longname || symbol, type: row.quoteType || null });
      }
      for (const row of local) {
        if (!seen.has(row.symbol)) results.push(row);
      }
      return results.slice(0, 12);
    }
  } catch (err) {
    console.warn("search_fail", String(err && err.message ? err.message : err));
  }
  return local.slice(0, 10);
}

async function yahooHistory(sym, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
  try {
    const { res, text } = await fetchText(url, {
      headers: { referer: "https://finance.yahoo.com/", origin: "https://finance.yahoo.com" },
    }, 8000);
    if (!res.ok || !text || text.trim().startsWith("<")) return null;
    const json = JSON.parse(text);
    const result = json && json.chart && Array.isArray(json.chart.result) && json.chart.result[0];
    if (!result) return null;
    const ts = result.timestamp || [];
    const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
    const closes = quote.close || [];
    const points = [];
    for (let i = 0; i < ts.length; i++) {
      const px = Number(closes[i]);
      if (!Number.isFinite(px)) continue;
      points.push({ t: ts[i] * 1000, c: px });
    }
    if (!points.length) return null;
    const meta = result.meta || {};
    return {
      symbol: meta.symbol || sym,
      currency: meta.currency || "USD",
      delayed: true,
      source: "yahoo",
      range,
      interval,
      points,
    };
  } catch (err) {
    console.warn("history_fail", String(err && err.message ? err.message : err));
    return null;
  }
}

