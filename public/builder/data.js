/**
 * Delayed market-data provider used by the public builder.
 *
 * The public builder is limited to QQQ for now. Swap this module (or its
 * `provider` export) when a Convexa delayed market-data service is ready
 * and other tickers are approved. Callers must not assume a particular
 * upstream feed.
 */
const PREFIX = "/api";
export const BUILDER_SYMBOL = "QQQ";

async function request(path) {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function onlyQqq(symbol) {
  const s = String(symbol || BUILDER_SYMBOL).trim().toUpperCase();
  if (s && s !== BUILDER_SYMBOL) {
    const err = new Error("This public builder is limited to QQQ for now.");
    err.status = 400;
    throw err;
  }
  return BUILDER_SYMBOL;
}

export const provider = {
  id: "delayed-public",
  delayed: true,
  symbol: BUILDER_SYMBOL,
  delayHint: "Quotes are delayed about 15 minutes.",

  async quote(symbol) {
    return request(`${PREFIX}/quote?symbol=${encodeURIComponent(onlyQqq(symbol))}`);
  },

  async chain(symbol, expiry) {
    const q = new URLSearchParams({ symbol: onlyQqq(symbol) });
    if (expiry) q.set("expiry", expiry);
    return request(`${PREFIX}/chain?${q}`);
  },

  async expirations(symbol) {
    return request(`${PREFIX}/expirations?symbol=${encodeURIComponent(onlyQqq(symbol))}`);
  },

  async search(query) {
    const q = String(query || "").trim();
    if (q && !BUILDER_SYMBOL.startsWith(q.toUpperCase()) && !"INVESCO QQQ TRUST".includes(q.toUpperCase())) {
      return { results: [] };
    }
    return { results: [{ symbol: BUILDER_SYMBOL, name: "Invesco QQQ Trust, Series 1" }] };
  },

  async history(symbol, range = "5d") {
    return request(`${PREFIX}/history?symbol=${encodeURIComponent(onlyQqq(symbol))}&range=${encodeURIComponent(range)}`);
  },
};

export default provider;
