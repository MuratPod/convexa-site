/**
 * Headless screenshots of /builder at desktop and mobile widths.
 * Mocks /api/* so a local Wrangler session that cannot reach Nasdaq still renders.
 */
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadPlaywright() {
  const candidates = [
    join("/workspace/pw-tools", "package.json"),
    join(process.cwd(), "package.json"),
    join(root, "package.json"),
  ];
  for (const pkg of candidates) {
    if (existsSync(pkg)) {
      try {
        return createRequire(pkg)("playwright");
      } catch {
        // try next
      }
    }
  }
  throw new Error("playwright is not installed (npm install playwright && npx playwright install chromium)");
}
const { chromium } = loadPlaywright();

const qqq = JSON.parse(readFileSync(join(root, "tests/fixtures/qqq-chain.json"), "utf8"));
const aapl = JSON.parse(readFileSync(join(root, "tests/fixtures/aapl-chain.json"), "utf8"));
const outDir = process.env.SHOT_DIR || "/workspace/convexa-builder-shots";
const base = process.env.BASE_URL || "http://127.0.0.1:8787";
mkdirSync(outDir, { recursive: true });

function quoteFrom(chain) {
  return {
    symbol: chain.symbol,
    name: chain.name,
    price: chain.price,
    change: chain.change,
    changePct: chain.changePct,
    asOf: chain.asOf,
    delayed: true,
    source: chain.source,
    style: chain.style,
    yield: chain.yield,
    rate: chain.rate,
    ivAtm: chain.ivAtm,
    expirations: chain.expirations,
  };
}

async function mockApi(page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/\/+$/, "");
    const symbol = (url.searchParams.get("symbol") || url.searchParams.get("s") || "").toUpperCase();
    const chain = symbol === "AAPL" ? aapl : qqq;
    if (path.endsWith("/health")) {
      return route.fulfill({ json: { ok: true, service: "convexa-builder" } });
    }
    if (path.endsWith("/quote") || path.endsWith("/expirations")) {
      return route.fulfill({ json: quoteFrom(chain) });
    }
    if (path.endsWith("/chain")) {
      const expiry = url.searchParams.get("expiry");
      const data = { ...chain };
      if (expiry) data.options = chain.options.filter((o) => o.expiry === expiry);
      return route.fulfill({ json: data });
    }
    return route.fulfill({ status: 404, json: { error: "unknown" } });
  });
}

async function waitReady(page) {
  await page.waitForSelector("#sum-premium");
  await page.waitForFunction(() => {
    const el = document.getElementById("sum-premium");
    return el && el.textContent && el.textContent.trim() !== "—";
  }, { timeout: 20000 });
  // let IV solver + first paint settle
  await page.waitForTimeout(3500);
}

const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 2200 }],
  ["mobile", { width: 390, height: 2400 }],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await mockApi(page);
  const url = `${base}/builder/?s=QQQ&t=iron_condor&e=2026-12-18`;
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  if (!resp || resp.status() >= 400) throw new Error(`GET ${url} -> ${resp && resp.status()}`);
  await waitReady(page);
  const shot = join(outDir, `builder-qqq-iron-condor-${name}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  console.log("wrote", shot);

  // homepage too, at the same widths, cropped to the nav + hero so the new link is visible
  if (name === "desktop" || name === "mobile") {
    const home = `${base}/`;
    const r2 = await page.goto(home, { waitUntil: "networkidle", timeout: 30000 });
    if (!r2 || r2.status() >= 400) throw new Error(`GET ${home} -> ${r2 && r2.status()}`);
    const homeShot = join(outDir, `homepage-${name}.png`);
    await page.screenshot({ path: homeShot, fullPage: false });
    console.log("wrote", homeShot);
  }
  await page.close();
}

// AAPL custom view, desktop only
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 2 });
  await mockApi(page);
  await page.goto(`${base}/builder/?s=AAPL&t=long_straddle`, { waitUntil: "networkidle" });
  await waitReady(page);
  const shot = join(outDir, "builder-aapl-straddle-desktop.png");
  await page.screenshot({ path: shot, fullPage: true });
  console.log("wrote", shot);
  await page.close();
}

await browser.close();
console.log("done");
