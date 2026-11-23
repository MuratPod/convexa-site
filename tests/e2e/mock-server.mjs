/**
 * Local static + fixture API server for builder interaction tests.
 * Does not talk to Nasdaq or any live feed.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = path.join(ROOT, "public");
const FIXTURE = path.join(ROOT, "tests/fixtures/qqq-chain.json");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";

const chain = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const have = new Set((chain.options || []).map((o) => o.expiry));
if (!chain.expirations || !chain.expirations.length) chain.expirations = [...have].sort();

function optionsFor(expiry) {
  const all = chain.options || [];
  if (!expiry) return all;
  const exact = all.filter((o) => o.expiry === expiry);
  if (exact.length) return exact;
  const srcExp = [...have].sort((a, b) => Math.abs(Date.parse(a) - Date.parse(expiry)) - Math.abs(Date.parse(b) - Date.parse(expiry)))[0];
  return all.filter((o) => o.expiry === srcExp).map((o) => ({ ...o, expiry }));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": buf.length,
  });
  res.end(buf);
}

function fail(res, status, error) {
  json(res, status, { error });
}

function handleApi(url, res) {
  const p = url.pathname;
  if (p === "/health") return json(res, 200, { ok: true });
  const sym = String(url.searchParams.get("symbol") || url.searchParams.get("s") || "").trim().toUpperCase();
  if (p === "/api/search") {
    const q = String(url.searchParams.get("q") || url.searchParams.get("query") || "").trim().toUpperCase();
    const hit = { symbol: "QQQ", name: "Invesco QQQ Trust, Series 1" };
    const results = !q || "QQQ".startsWith(q) || "INVESCO QQQ TRUST".includes(q) ? [hit] : [];
    return json(res, 200, { query: q, results, delayed: true, source: "fixture" });
  }
  if (p === "/api/quote" || p === "/api/chain" || p === "/api/expirations") {
    if (!sym) return fail(res, 400, "Pass a ticker in ?symbol=");
    if (sym !== "QQQ") return fail(res, 400, "This public builder is limited to QQQ for now.");
    const expiry = url.searchParams.get("expiry") || url.searchParams.get("expiration") || null;
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return fail(res, 400, "expiry must be YYYY-MM-DD");
    if (p === "/api/quote") {
      const { options, ...quote } = chain;
      return json(res, 200, { ...quote, delayed: true, expirations: chain.expirations });
    }
    if (p === "/api/expirations") {
      return json(res, 200, { symbol: "QQQ", expirations: chain.expirations, source: "fixture" });
    }
    const options = optionsFor(expiry);
    return json(res, 200, { ...chain, delayed: true, options });
  }
  if (p === "/api/history") {
    if (!sym) return fail(res, 400, "Pass a ticker in ?symbol=");
    if (sym !== "QQQ") return fail(res, 400, "This public builder is limited to QQQ for now.");
    const t0 = Date.parse("2026-11-16T14:30:00-05:00");
    const points = [];
    for (let i = 0; i < 20; i++) points.push({ t: t0 + i * 86400000 / 4, c: 608.45 + (i - 10) * 0.8 });
    return json(res, 200, { symbol: "QQQ", range: url.searchParams.get("range") || "5d", points, delayed: true, source: "fixture" });
  }
  return fail(res, 404, "Unknown API route.");
}

function safeJoin(base, rel) {
  const resolved = path.normalize(path.join(base, rel));
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

function handleStatic(url, res) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/builder") rel = "/builder/";
  if (rel.startsWith("/builder/") && !path.extname(rel.split("?")[0])) rel = "/builder/index.html";
  if (rel === "/") rel = "/index.html";
  const file = safeJoin(PUBLIC, rel);
  if (!file) return fail(res, 403, "Forbidden");
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "no-store",
      "content-length": buf.length,
    });
    res.end(buf);
  });
}

export function startMockServer(port = PORT, host = HOST) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (url.pathname === "/health" || url.pathname.startsWith("/api/")) return handleApi(url, res);
    return handleStatic(url, res);
  });
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => resolve(server));
    server.on("error", reject);
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startMockServer().then((s) => {
    const addr = s.address();
    console.log(`mock builder http://${addr.address}:${addr.port}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
