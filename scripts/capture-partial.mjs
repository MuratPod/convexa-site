import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });
const widths = [1440, 1280, 1024, 390, 360];

function minWidgetWidthForViewport(w) {
  return w <= 390 ? 120 : 140;
}

async function widgetImgWidths(page) {
  return page.evaluate(() => {
    const imgs = document.querySelectorAll('#island-widgets .tile-row img');
    return [...imgs].map((img) => ({
      cls: img.className.split(/\s+/).find((c) => c.startsWith('tile-widget')) || img.className,
      width: img.getBoundingClientRect().width,
    }));
  });
}

function assertWidgetWidths(w, rows) {
  const minW = minWidgetWidthForViewport(w);
  const bad = rows.filter((r) => r.width + 0.5 < minW);
  if (bad.length) {
    throw new Error(`widget width < ${minW}px at ${w}: ${JSON.stringify(bad)}`);
  }
}

async function tilesChildrenFit(page) {
  return page.evaluate(() => {
    const tiles = document.querySelector('#island-widgets .tiles');
    if (!tiles) return [];
    const tr = tiles.getBoundingClientRect();
    const issues = [];
    for (const child of tiles.children) {
      const r = child.getBoundingClientRect();
      if (r.width < 1) continue;
      if (r.right > tr.right + 0.5) {
        issues.push({ cls: String(child.className).slice(0, 40), side: 'right', px: r.right - tr.right });
      }
      if (r.left < tr.left - 0.5) {
        issues.push({ cls: String(child.className).slice(0, 40), side: 'left', px: tr.left - r.left });
      }
    }
    return issues;
  });
}

async function prepareCapture(page) {
  await page.addStyleTag({
    content: '.site-nav { position: static !important; top: auto !important; }',
  });
}

async function primeImages(page, selector) {
  await page.evaluate(async (sel) => {
    const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    for (let y = 0; y <= h; y += Math.max(600, innerHeight)) {
      scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (sel) document.querySelector(sel)?.scrollIntoView({ block: 'center' });
  }, selector ?? null);
  await page.evaluate(async (sel) => {
    const root = sel ? document.querySelector(sel) : document;
    if (!root) return;
    for (const img of root.querySelectorAll('img')) {
      if (!img.complete) await new Promise((r) => { img.onload = img.onerror = r; });
      try { await img.decode(); } catch { /* */ }
    }
  }, selector ?? null);
}

const browser = await chromium.launch();
const overflow = {};
const tilesFit = {};
const widgetWidths = {};
for (const w of widths) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: w, height: w >= 1024 ? 900 : 844 });
  await page.goto(BASE + '/#island-widgets', { waitUntil: 'networkidle' });
  await prepareCapture(page);
  await primeImages(page, '#island-widgets');
  const pageIssues = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const issues = [];
    if (document.documentElement.scrollWidth - vw > 1) issues.push({ kind: 'doc-h', px: document.documentElement.scrollWidth - vw });
    if (document.body.scrollWidth - vw > 1) issues.push({ kind: 'body-h', px: document.body.scrollWidth - vw });
    return { vw, issues };
  });
  const tileIssues = await tilesChildrenFit(page);
  const widgets = await widgetImgWidths(page);
  assertWidgetWidths(w, widgets);
  overflow[w] = pageIssues;
  tilesFit[w] = tileIssues;
  widgetWidths[w] = widgets;
  await page.close();
}
writeFileSync(join(OUT, 'overflow-check.json'), JSON.stringify({ overflow, tilesFit, widgetWidths }, null, 2));

async function shot(viewport, scale, name, fn) {
  const page = await browser.newPage();
  await page.setViewportSize(viewport);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await prepareCapture(page);
  await fn(page, join(OUT, name));
  await page.close();
}

for (const [suffix, vp] of [
  ['', { width: 1440, height: 900 }],
  ['-390', { width: 390, height: 844 }],
]) {
  await shot(vp, 2, `section-07-island-widgets${suffix}.png`, async (p, path) => {
    await p.goto(BASE + '/#island-widgets', { waitUntil: 'networkidle' });
    await primeImages(p, '#island-widgets');
    const bad = await tilesChildrenFit(p);
    if (bad.length) throw new Error(`tiles overflow at ${suffix || '1440'}: ${JSON.stringify(bad)}`);
    const widgets = await widgetImgWidths(p);
    assertWidgetWidths(vp.width, widgets);
    await p.locator('#island-widgets').screenshot({ path });
  });
}

await browser.close();
const anyTiles = Object.values(tilesFit).some((a) => a.length > 0);
const anyPage = Object.values(overflow).some((o) => o.issues?.length > 0);
if (anyTiles || anyPage) {
  throw new Error(JSON.stringify({ overflow, tilesFit }));
}
console.log(JSON.stringify({ overflow, tilesFit, widgetWidths, verify: 'ok' }, null, 2));