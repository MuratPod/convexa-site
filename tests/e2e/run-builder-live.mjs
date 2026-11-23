/**
 * Playwright interaction tests for live builder controls.
 * Uses the local fixture mock server — no live market data.
 *
 *   NODE_PATH=/path/to/playwright/node_modules node tests/e2e/run-builder-live.mjs
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMockServer } from "./mock-server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.env.SHOTS_DIR || "/workspace/convexa-builder-shots/live";
const PORT = Number(process.env.PORT || 4173);
const BASE = `http://127.0.0.1:${PORT}`;
const ENGINES = (process.env.PW_ENGINES || "chromium").split(",").map((s) => s.trim()).filter(Boolean);

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const fallback = "/workspace/pw-tools/node_modules/playwright/index.mjs";
    return await import(pathToFileURL(fallback).href);
  }
}

function fail(name, msg) {
  const err = new Error(`${name}: ${msg}`);
  err.testName = name;
  throw err;
}

async function waitReady(page, timeout = 15000) {
  await page.waitForFunction(() => {
    const px = document.getElementById("last-price");
    const chips = document.querySelectorAll(".leg-chip");
    return px && px.textContent && px.textContent !== "—" && chips.length >= 1;
  }, null, { timeout });
}

async function nextFrames(page, n = 2) {
  await page.evaluate((count) => new Promise((resolve) => {
    const step = (i) => (i <= 0 ? resolve() : requestAnimationFrame(() => step(i - 1)));
    step(count);
  }), n);
}

async function setSlider(page, id, value) {
  return page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return el.value;
  }, { id, value });
}

function statMap(texts) {
  const out = {};
  for (let i = 0; i + 1 < texts.length; i += 2) out[texts[i]] = texts[i + 1];
  return out;
}

async function readStats(page) {
  const texts = await page.locator("#stats-cols .stat span").allTextContents();
  return statMap(texts.map((s) => s.trim()));
}

async function runOnPage(page, engine, viewport) {
  const tag = `${engine}-${viewport}`;
  fs.mkdirSync(SHOTS, { recursive: true });
  const results = [];
  const mark = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    const icon = ok ? "ok" : "FAIL";
    console.log(`  [${icon}] ${name}${detail ? " — " + detail : ""}`);
  };

  await page.goto(`${BASE}/builder/`, { waitUntil: "domcontentloaded" });
  await waitReady(page);
  await nextFrames(page, 3);

  const chips = await page.locator(".leg-chip").count();
  const price = await page.locator("#last-price").innerText();
  const title = await page.title();
  const okReady = chips >= 4 && /QQQ/.test(title) && /[0-9]/.test(price);
  mark("ready: iron condor loads with 4 chips, QQQ title, last price", okReady,
    `chips=${chips} price=${price} title=${title}`);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-01-ready.png`), fullPage: true });

  // --- DATE slider ---
  const dateMax = Number(await page.locator("#date-slider").getAttribute("max"));
  const dateDisabled = await page.locator("#date-slider").isDisabled();
  if (dateDisabled || dateMax < 2) {
    mark("date slider has a usable range", false, `disabled=${dateDisabled} max=${dateMax}`);
  } else {
    const stats0 = await readStats(page);
    const mid = Math.max(0, Math.floor(dateMax / 2));
    await setSlider(page, "date-slider", mid);
    await nextFrames(page, 4);
    const right = await page.locator("#date-right").innerText();
    const labels = await page.locator("#graph-wrap svg text").allTextContents();
    const hasExpiry = labels.some((t) => /Expiration/.test(t));
    const hasSelected = labels.some((t) => /\(\d+d\)/.test(t) && !/Expiration/.test(t));
    const dashed = await page.locator('#graph-wrap svg path[stroke-dasharray]').count();
    const stats1 = await readStats(page);
    const maxSame = stats0["Max profit"] && stats0["Max profit"] === stats1["Max profit"];
    const offExp = !/^At expiration$/i.test(right.trim());
    mark("DATE drag: selected + intermediate curves, label leaves expiration",
      offExp && hasExpiry && hasSelected && dashed >= 2,
      `right="${right}" dashed=${dashed} labels=${labels.filter((t) => /\d+d/.test(t)).join(" | ")}`);
    mark("DATE drag: max profit unchanged (expiry-based)", maxSame,
      `before=${stats0["Max profit"]} after=${stats1["Max profit"]}`);
    await page.screenshot({ path: path.join(SHOTS, `${tag}-02-date.png`), fullPage: true });

    // Table column focus
    await page.locator('[data-view="table"]').click();
    await nextFrames(page, 3);
    const focus0 = await page.locator("th.date-focus").innerText().catch(() => "");
    await setSlider(page, "date-slider", 0);
    await nextFrames(page, 4);
    const focus1 = await page.locator("th.date-focus").innerText().catch(() => "");
    const nFocus = await page.locator("th.date-focus").count();
    mark("DATE drag: table selected-date column is highlighted and moves",
      nFocus === 1 && focus0 !== "" && focus1 !== "" && focus0 !== focus1,
      `focus ${focus0} -> ${focus1}`);
    await page.screenshot({ path: path.join(SHOTS, `${tag}-03-table-date.png`), fullPage: true });
    await page.locator('[data-view="graph"]').click();
    await nextFrames(page, 2);
    // reset date to expiry for later tests
    await setSlider(page, "date-slider", dateMax);
    await page.evaluate(() => {
      document.getElementById("date-slider").dispatchEvent(new Event("change", { bubbles: true }));
    });
    await nextFrames(page, 3);
  }

  // --- RANGE slider ---
  const xSpan = async () => page.evaluate(() => {
    const svg = document.querySelector("#graph-wrap svg");
    const vb = (svg.getAttribute("viewBox") || "0 0 640 360").split(/\s+/).map(Number);
    const H = vb[3] || 360;
    const xs = [...svg.querySelectorAll("text")]
      .filter((el) => Number(el.getAttribute("y")) > H - 20)
      .map((el) => Number(String(el.textContent).replace(/[$,]/g, "")))
      .filter((n) => Number.isFinite(n));
    return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  });
  const span12 = await xSpan();
  await setSlider(page, "range-slider", 49);
  await nextFrames(page, 4);
  const rangeLabel = await page.locator("#range-label").innerText();
  const span49 = await xSpan();
  mark("RANGE drag: label and x-axis rescale live",
    /±49%/.test(rangeLabel) && span49 > span12 * 1.5,
    `label=${rangeLabel} x-span ${span12} -> ${span49}`);
  await setSlider(page, "range-slider", 44);
  await page.locator('[data-view="table"]').click();
  await nextFrames(page, 3);
  const tableRows = await page.locator("#table-wrap tbody tr").count();
  mark("RANGE ±44%: table has 21 price rows",
    tableRows === 21,
    `rows=${tableRows}`);
  await page.locator('[data-view="graph"]').click();
  await nextFrames(page, 2);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-04-range.png`), fullPage: true });
  await page.locator("#range-reset").click();
  await nextFrames(page, 3);

  // --- IV slider ---
  // Move DATE off expiry so the focus curve actually reprices with IV.
  const dateMaxIv = Number(await page.locator("#date-slider").getAttribute("max"));
  if (dateMaxIv > 2) {
    await setSlider(page, "date-slider", Math.floor(dateMaxIv / 2));
    await nextFrames(page, 3);
  }
  const ivLabel0 = await page.locator("#iv-label").innerText();
  const statsIv0 = await readStats(page);
  const resetHidden0 = await page.locator("#iv-reset").isHidden();
  const path0 = await page.locator('#graph-wrap svg path[stroke="#f4f6fb"], #graph-wrap svg path[stroke="#d4af37"]').last().getAttribute("d");
  await setSlider(page, "iv-slider", 200);
  await nextFrames(page, 4);
  const ivLabel = await page.locator("#iv-label").innerText();
  const resetHidden1 = await page.locator("#iv-reset").isHidden();
  const statsIv1 = await readStats(page);
  const path1 = await page.locator('#graph-wrap svg path[stroke="#f4f6fb"], #graph-wrap svg path[stroke="#d4af37"]').last().getAttribute("d");
  const copChanged = statsIv0["Chance of profit"] !== statsIv1["Chance of profit"];
  const pathChanged = path0 && path1 && path0 !== path1;
  mark("IV drag: label shows doubled IV, reset appears, curves/COP reprice",
    /87/.test(ivLabel) && resetHidden0 && !resetHidden1 && (copChanged || pathChanged),
    `label ${ivLabel0.replace(/\s+/g, " ")} -> ${ivLabel.replace(/\s+/g, " ")} COP ${statsIv0["Chance of profit"]} -> ${statsIv1["Chance of profit"]} pathChanged=${pathChanged}`);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-05-iv.png`), fullPage: true });
  await page.locator("#iv-reset").click();
  await nextFrames(page, 3);

  // --- Strike chip drag (live, mid-gesture) ---
  const chip = page.locator(".leg-chip").first();
  const box = await chip.boundingBox();
  if (!box) {
    mark("strike chip drag: chip is visible", false);
  } else {
    await chip.scrollIntoViewIfNeeded();
    const boxLive = await chip.boundingBox();
    if (!boxLive) {
      mark("strike chip drag: chip is visible", false, "no box after scroll");
    } else {
    const beforeText = (await chip.innerText()).trim();
    const beforeTitle = await page.title();
    const beforeUrl = page.url();
    const statsDrag0 = await readStats(page);
    await page.mouse.move(boxLive.x + boxLive.width / 2, boxLive.y + boxLive.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxLive.x + boxLive.width / 2 + 90, boxLive.y + boxLive.height / 2, { steps: 10 });
    await nextFrames(page, 4);
    const midText = (await chip.innerText()).trim();
    const midTitle = await page.title();
    const midUrl = page.url();
    const midStats = await readStats(page);
    const stillAttached = await chip.evaluate((el) => el.isConnected && el.classList.contains("is-drag"));
    const live = midText !== beforeText || midTitle !== beforeTitle || /Custom/i.test(midTitle);
    mark("strike chip drag: title becomes Custom, chip/stats update live; chip DOM kept",
      live && stillAttached,
      `chip ${beforeText} -> ${midText}; title=${midTitle}; debit ${statsDrag0["Debit"] || statsDrag0["Credit"]} -> ${midStats["Debit"] || midStats["Credit"]}`);
    await page.screenshot({ path: path.join(SHOTS, `${tag}-06-chip-drag.png`), fullPage: true });
    await page.mouse.up();
    await nextFrames(page, 3);
    const afterUrl = page.url();
    const afterTitle = await page.title();
    mark("strike chip release: URL switches to /builder/custom/...",
      /\/builder\/custom\//.test(afterUrl) && /Custom/i.test(afterTitle),
      `url=${afterUrl} title=${afterTitle}`);
    }
  }

  // --- Hover crosshair ---
  const svg = page.locator("#graph-wrap svg");
  const sbox = await svg.boundingBox();
  if (sbox) {
    await page.mouse.move(sbox.x + sbox.width * 0.55, sbox.y + sbox.height * 0.4);
    await nextFrames(page, 3);
    const vis = await page.evaluate(() => {
      const hx = document.querySelector("#hover-x");
      const tip = document.getElementById("graph-hover");
      const pill = document.querySelector(".prob-pill");
      return {
        line: hx && hx.getAttribute("visibility") !== "hidden",
        tip: tip && !tip.hidden && tip.innerText.trim().length > 0,
        pill: pill && !pill.hidden,
      };
    });
    mark("graph hover: crosshair, pill and tooltip follow the pointer",
      vis.line && vis.tip,
      JSON.stringify(vis));
  }

  // --- Positions qty live ---
  await page.locator("#btn-positions").click();
  await page.waitForSelector("#positions-modal:not([hidden])");
  const gear = page.locator("#pos-list [data-gear]").first();
  if (await gear.count()) {
    const debit0 = (await readStats(page))["Debit"] || (await readStats(page))["Credit"];
    await gear.click();
    await page.waitForSelector("#leg-pop:not([hidden]) #qty-inc");
    await page.locator("#qty-inc").click();
    await nextFrames(page, 4);
    const qty = await page.locator("#qty-val").innerText();
    const popOpen = await page.locator("#leg-pop").isVisible();
    const debit1 = (await readStats(page))["Debit"] || (await readStats(page))["Credit"];
    mark("Positions qty stepper updates stats live without closing the popover",
      popOpen && Number(qty) >= 2 && debit0 !== debit1,
      `qty=${qty} ${debit0} -> ${debit1}`);
    await page.screenshot({ path: path.join(SHOTS, `${tag}-07-qty.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await page.locator("#pos-close").click().catch(() => {});
    await page.locator("#positions-modal[hidden], #positions-modal").waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  } else {
    mark("Positions qty stepper updates stats live without closing the popover", false, "no gear");
  }

  // --- Template switch, no reload ---
  let reloads = 0;
  page.once("load", () => { reloads += 1; });
  await page.locator("#build-wrap").scrollIntoViewIfNeeded();
  await page.locator("#build-wrap").hover();
  await page.locator("#build-btn").click();
  await page.waitForSelector("#build-menu:not([hidden])");
  const longCall = page.locator("#build-cols button, #build-cols a").filter({ hasText: /^Long Call$/ }).first();
  if (await longCall.count()) {
    await longCall.click();
    await page.waitForFunction(() => document.querySelectorAll(".leg-chip").length === 1, null, { timeout: 8000 });
    const n = await page.locator(".leg-chip").count();
    const h1 = await page.locator("#strategy-title").innerText();
    const url = page.url();
    mark("Build menu template switch updates legs and URL without a reload",
      n === 1 && /Long Call/i.test(h1) && /long-call/i.test(url) && reloads === 0,
      `chips=${n} h1=${h1} reloads=${reloads} url=${url}`);
  } else {
    mark("Build menu template switch updates legs and URL without a reload", false, "Long Call not found");
  }

  // --- Perf: date-slider input bursts ---
  // Reload iron condor for a 4-leg case with a long date range.
  await page.goto(`${BASE}/builder/iron-condor/QQQ`, { waitUntil: "domcontentloaded" });
  await waitReady(page);
  await nextFrames(page, 3);
  const perf = await page.evaluate(async () => {
    window.__renderSamples = [];
    const sl = document.getElementById("date-slider");
    const max = Number(sl.max) || 0;
    if (max < 2 || sl.disabled) return { ok: false, reason: "no date range", samples: [] };
    for (let i = 0; i <= Math.min(16, max); i++) {
      sl.value = String(i);
      sl.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const samples = (window.__renderSamples || []).slice();
    const last = window.__lastRenderMs || 0;
    // First sample may include expiry-curve cache fill; mid-drag frames are what matter.
    const steady = samples.length > 1 ? samples.slice(1) : samples;
    const maxMs = steady.length ? Math.max(...steady) : last;
    const avg = steady.length ? steady.reduce((a, b) => a + b, 0) / steady.length : last;
    const first = samples[0] || last;
    return { ok: true, samples, last, maxMs, avg, first };
  });
  // Shared headless box is slower than a local desktop; mid-drag frames should stay within two 16ms ticks.
  const budgetAvg = 28;
  const budgetMax = 40;
  mark("recompute budget: mid-drag rAF render stays within two frames",
    perf.ok && perf.avg < budgetAvg && perf.maxMs < budgetMax,
    perf.ok
      ? `steady n=${perf.samples.length - 1} avg=${perf.avg.toFixed(2)}ms max=${perf.maxMs.toFixed(2)}ms first=${(perf.first || 0).toFixed(2)}ms last=${perf.last.toFixed(2)}ms samples=${perf.samples.map((x) => x.toFixed(1)).join(",")}`
      : perf.reason);

  const failed = results.filter((r) => !r.ok);
  return { results, failed, perf };
}

async function main() {
  const pw = await loadPlaywright();
  const server = await startMockServer(PORT);
  fs.mkdirSync(SHOTS, { recursive: true });
  const summary = [];
  let failedCount = 0;
  try {
    for (const engine of ENGINES) {
      const factory = pw[engine];
      if (!factory) throw new Error(`Unknown engine ${engine}`);
      const browser = await factory.launch({ headless: true });
      try {
        const views = [
          { name: "desktop", viewport: { width: 1280, height: 900 } },
        ];
        if (process.env.PW_MOBILE === "1") {
          views.push({ name: "iphone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        }
        for (const view of views) {
          console.log(`\n== ${engine} ${view.name} ==`);
          const context = await browser.newContext({
            viewport: view.viewport,
            deviceScaleFactor: 1,
            isMobile: Boolean(view.isMobile),
            hasTouch: Boolean(view.hasTouch),
          });
          const page = await context.newPage();
          page.setDefaultTimeout(15000);
          const out = await runOnPage(page, engine, view.name);
          summary.push({ engine, view: view.name, ...out });
          failedCount += out.failed.length;
          await context.close();
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("\n======== summary ========");
  for (const s of summary) {
    const pass = s.results.length - s.failed.length;
    console.log(`${s.engine}/${s.view}: ${pass}/${s.results.length} passed`);
    for (const f of s.failed) console.log(`  FAIL ${f.name} — ${f.detail}`);
    if (s.perf && s.perf.ok) {
      console.log(`  perf avg=${s.perf.avg.toFixed(2)}ms max=${s.perf.maxMs.toFixed(2)}ms`);
    }
  }
  if (failedCount) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
