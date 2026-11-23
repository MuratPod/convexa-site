/**
 * Desktop (1280) and mobile (~427) screenshots of the v2 QQQ builder,
 * plus side-by-side composites against the OptionStrat reference captures.
 */
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
      } catch { /* next */ }
    }
  }
  throw new Error("playwright is not installed");
}
const { chromium } = loadPlaywright();

const qqq = JSON.parse(readFileSync(join(root, "tests/fixtures/qqq-chain.json"), "utf8"));
const outDir = process.env.SHOT_DIR || "/workspace/convexa-builder-shots/v2";
const base = process.env.BASE_URL || "http://127.0.0.1:8787";
const refDir = "/workspace/optionstrat/ref";
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

const history = {
  symbol: "QQQ",
  delayed: true,
  source: "fixture",
  range: "5d",
  interval: "15m",
  points: Array.from({ length: 40 }, (_, i) => ({
    t: Date.parse("2026-11-16T09:30:00-05:00") + i * 15 * 60 * 1000,
    c: 608.45 + Math.sin(i / 4) * 4,
  })),
};

async function mockApi(page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/\/+$/, "");
    const symbol = (url.searchParams.get("symbol") || url.searchParams.get("s") || "").toUpperCase();
    if (path.endsWith("/health")) {
      return route.fulfill({ json: { ok: true, service: "convexa-builder" } });
    }
    if (symbol && symbol !== "QQQ") {
      return route.fulfill({ status: 400, json: { error: "This public builder is limited to QQQ for now." } });
    }
    if (path.endsWith("/search")) {
      return route.fulfill({ json: { query: "QQQ", results: [{ symbol: "QQQ", name: "Invesco QQQ Trust, Series 1" }], delayed: true, source: "qqq-only" } });
    }
    if (path.endsWith("/history")) {
      return route.fulfill({ json: history });
    }
    if (path.endsWith("/quote") || path.endsWith("/expirations")) {
      return route.fulfill({ json: quoteFrom(qqq) });
    }
    if (path.endsWith("/chain")) {
      const expiry = url.searchParams.get("expiry");
      const data = { ...qqq };
      if (expiry) data.options = qqq.options.filter((o) => o.expiry === expiry);
      return route.fulfill({ json: data });
    }
    return route.fulfill({ status: 404, json: { error: "unknown" } });
  });
}

async function waitReady(page) {
  await page.waitForSelector("#strategy-title");
  await page.waitForFunction(() => {
    const el = document.getElementById("last-price");
    const stats = document.querySelector("#stats-cols .v");
    return el && el.textContent && el.textContent.trim() !== "—" && stats && stats.textContent.trim() !== "—";
  }, { timeout: 25000 });
  await page.waitForTimeout(1200);
}

async function dismissNotice(page) {
  const btn = page.locator("#notice-close");
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

function sideBySide(left, right, dest, labelL = "Convexa", labelR = "Reference") {
  const r = spawnSync("python3", ["-c", `
from PIL import Image, ImageDraw, ImageFont
import sys
left, right, dest, labl, labr = sys.argv[1:]
a = Image.open(left).convert("RGB")
b = Image.open(right).convert("RGB")
# Crop both to a comparable top slice (header through sliders)
w = 1280
def fit(im):
    im = im.copy()
    if im.width != w:
        h = int(im.height * (w / im.width))
        im = im.resize((w, h), Image.Resampling.LANCZOS)
    return im.crop((0, 0, w, min(im.height, 1600)))
a, b = fit(a), fit(b)
bar = 36
canvas = Image.new("RGB", (w * 2 + 8, max(a.height, b.height) + bar), (12, 16, 28))
canvas.paste(a, (0, bar))
canvas.paste(b, (w + 8, bar))
d = ImageDraw.Draw(canvas)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
except Exception:
    font = ImageFont.load_default()
d.text((16, 10), labl, fill=(212, 175, 55), font=font)
d.text((w + 24, 10), labr, fill=(200, 200, 210), font=font)
canvas.save(dest, "PNG")
print("wrote", dest)
`], [left, right, dest, labelL, labelR], encoding="utf-8")
  if (r.returncode != 0) {
    console.error(r.stdout, r.stderr);
    throw new Error("side-by-side failed");
  }
  if (r.stdout) console.log(r.stdout.trim());
}

const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });

const views = [
  ["desktop", { width: 1280, height: 2200 }],
  ["mobile", { width: 427, height: 2400 }],
];

for (const [name, viewport] of views) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await mockApi(page);
  const url = `${base}/builder/iron-condor/QQQ`;
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  if (!resp || resp.status() >= 400) throw new Error(`GET ${url} -> ${resp && resp.status()}`);
  await waitReady(page);
  const landing = join(outDir, `builder-qqq-iron-condor-graph-${name}.png`);
  await page.screenshot({ path: landing, fullPage: true });
  console.log("wrote", landing);

  await dismissNotice(page);
  const clean = join(outDir, `builder-qqq-iron-condor-graph-clean-${name}.png`);
  await page.screenshot({ path: clean, fullPage: true });
  console.log("wrote", clean);

  await page.locator('[data-view="table"]').click();
  await page.waitForTimeout(400);
  const table = join(outDir, `builder-qqq-iron-condor-table-${name}.png`);
  await page.screenshot({ path: table, fullPage: true });
  console.log("wrote", table);
  await page.locator('[data-view="graph"]').click();

  if (name === "desktop") {
    await page.locator("#build-btn").click();
    await page.waitForTimeout(300);
    const menu = join(outDir, "builder-build-menu-desktop.png");
    await page.screenshot({ path: menu, fullPage: false });
    console.log("wrote", menu);
    await page.locator("#build-btn").click();

    await page.locator("#btn-positions").click();
    await page.waitForTimeout(300);
    const pos = join(outDir, "builder-positions-desktop.png");
    await page.screenshot({ path: pos, fullPage: false });
    console.log("wrote", pos);
    await page.locator("#pos-close").click();

    await page.locator("#btn-history").click();
    await page.waitForTimeout(600);
    const hist = join(outDir, "builder-historical-desktop.png");
    await page.screenshot({ path: hist, fullPage: false });
    console.log("wrote", hist);
    await page.locator("#hist-close").click();
  }

  const home = `${base}/`;
  const r2 = await page.goto(home, { waitUntil: "networkidle", timeout: 30000 });
  if (!r2 || r2.status() >= 400) throw new Error(`GET ${home} -> ${r2 && r2.status()}`);
  const homeShot = join(outDir, `homepage-${name}.png`);
  await page.screenshot({ path: homeShot, fullPage: false });
  console.log("wrote", homeShot);
  await page.close();
}

// Side-by-side vs reference landing (graph) and table if present
const refGraph = join(refDir, "01-iron-condor-graph-landing.png");
const ours = join(outDir, "builder-qqq-iron-condor-graph-clean-desktop.png");
if (existsSync(refGraph) && existsSync(ours)) {
  sideBySide(ours, refGraph, join(outDir, "compare-landing-graph.png"), "Convexa /builder (QQQ)", "Reference (layout only)");
}
const refTable = join(refDir, "14-table-view.png");
const oursTable = join(outDir, "builder-qqq-iron-condor-table-desktop.png");
if (existsSync(refTable) && existsSync(oursTable)) {
  sideBySide(oursTable, refTable, join(outDir, "compare-table.png"), "Convexa table", "Reference table");
}

await browser.close();
console.log("done", outDir);
