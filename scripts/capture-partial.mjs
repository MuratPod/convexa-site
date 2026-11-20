import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });
const widths = [1440, 1366, 1280, 1152, 1024, 900, 768, 390, 360];
const MARGIN = 8;

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

async function layoutChecks(page, vw) {
  return page.evaluate(({ vw, margin }) => {
    const issues = [];
    const doc = document.documentElement;
    const headerTop = document.getElementById('top');
    if (doc.scrollWidth - doc.clientWidth > 1) {
      issues.push({ kind: 'doc-scroll', px: doc.scrollWidth - doc.clientWidth, sw: doc.scrollWidth, cw: doc.clientWidth });
    }
    if (headerTop && headerTop.scrollWidth - headerTop.clientWidth > 1) {
      issues.push({
        kind: 'hero-scroll',
        px: headerTop.scrollWidth - headerTop.clientWidth,
        sw: headerTop.scrollWidth,
        cw: headerTop.clientWidth,
      });
    }
    const heroFrames = document.querySelectorAll('header.hero .device');
    for (const el of heroFrames) {
      const r = el.getBoundingClientRect();
      if (r.width < 1) continue;
      if (r.right > vw - margin + 0.5) {
        issues.push({ kind: 'hero-device-right', cls: el.className.slice(0, 60), px: r.right - (vw - margin) });
      }
      if (r.left < margin - 0.5) {
        issues.push({ kind: 'hero-device-left', cls: el.className.slice(0, 60), px: margin - r.left });
      }
    }
    const tiles = document.querySelector('#island-widgets .tiles');
    if (tiles) {
      if (tiles.scrollWidth - tiles.clientWidth > 1) {
        issues.push({
          kind: 'tiles-scroll',
          px: tiles.scrollWidth - tiles.clientWidth,
          sw: tiles.scrollWidth,
          cw: tiles.clientWidth,
        });
      }
      const tilesRect = tiles.getBoundingClientRect();
      for (const child of tiles.children) {
        const r = child.getBoundingClientRect();
        if (r.width < 1) continue;
        if (r.right > vw - margin + 0.5) {
          issues.push({ kind: 'tiles-child-right', cls: String(child.className).slice(0, 40), px: r.right - (vw - margin) });
        }
        if (r.left < margin - 0.5) {
          issues.push({ kind: 'tiles-child-left', cls: String(child.className).slice(0, 40), px: margin - r.left });
        }
      }
      if (tilesRect.right > vw - margin + 0.5) {
        issues.push({ kind: 'tiles-box-right', px: tilesRect.right - (vw - margin) });
      }
    }
    return issues;
  }, { vw, margin: MARGIN });
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
const layout = {};
const tilesFit = {};
const widgetWidths = {};
for (const w of widths) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: w, height: w >= 1024 ? 900 : 844 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await prepareCapture(page);
  await primeImages(page, 'header.hero');
  await primeImages(page, '#island-widgets');
  const issues = await layoutChecks(page, w);
  const tileIssues = await tilesChildrenFit(page);
  const widgets = await widgetImgWidths(page);
  assertWidgetWidths(w, widgets);
  if (issues.length) {
    throw new Error(`layout @ ${w}: ${JSON.stringify(issues)}`);
  }
  layout[w] = issues;
  tilesFit[w] = tileIssues;
  widgetWidths[w] = widgets;
  await page.close();
}
writeFileSync(join(OUT, 'overflow-check.json'), JSON.stringify({ layout, tilesFit, widgetWidths }, null, 2));

async function shot(viewport, name, fn) {
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
  await shot(vp, `section-07-island-widgets${suffix}.png`, async (p, path) => {
    await p.goto(BASE + '/#island-widgets', { waitUntil: 'networkidle' });
    await primeImages(p, '#island-widgets');
    const bad = await tilesChildrenFit(p);
    if (bad.length) throw new Error(`tiles overflow at ${suffix || '1440'}: ${JSON.stringify(bad)}`);
    const widgets = await widgetImgWidths(p);
    assertWidgetWidths(vp.width, widgets);
    const issues = await layoutChecks(p, vp.width);
    if (issues.length) throw new Error(issues.map((i) => JSON.stringify(i)).join('; '));
    await p.locator('#island-widgets').screenshot({ path });
  });
}

for (const [suffix, vp] of [
  ['-1440', { width: 1440, height: 900 }],
  ['-1366', { width: 1366, height: 900 }],
  ['-1280', { width: 1280, height: 900 }],
  ['-1152', { width: 1152, height: 900 }],
  ['-1024', { width: 1024, height: 900 }],
  ['-768', { width: 768, height: 1024 }],
  ['-390', { width: 390, height: 844 }],
]) {
  await shot(vp, `hero-devices${suffix}.png`, async (p, path) => {
    await p.goto(BASE + '/#top', { waitUntil: 'networkidle' });
    await primeImages(p, 'header.hero');
    const issues = await layoutChecks(p, vp.width);
    if (issues.length) throw new Error(`hero ${suffix}: ${JSON.stringify(issues)}`);
    await p.locator('header.hero').screenshot({ path });
  });
}

for (const [suffix, vp] of [
  ['', { width: 1440, height: 900 }],
  ['-390', { width: 390, height: 844 }],
]) {
  await shot(vp, `section-06-lock-screen${suffix}.png`, async (p, path) => {
    await p.goto(BASE + '/#lock-screen', { waitUntil: 'networkidle' });
    await primeImages(p, '#lock-screen');
    const issues = await layoutChecks(p, vp.width);
    if (issues.length) throw new Error(`§06 ${suffix}: ${JSON.stringify(issues)}`);
    await p.locator('#lock-screen').screenshot({ path });
  });
}

await browser.close();
console.log(JSON.stringify({ layout, tilesFit, widgetWidths, verify: 'ok' }, null, 2));