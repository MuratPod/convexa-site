import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });
const widths = [1440, 390, 360];

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
for (const w of widths) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await prepareCapture(page);
  await primeImages(page, null);
  overflow[w] = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const issues = [];
    if (document.documentElement.scrollWidth - vw > 1) issues.push({ kind: 'doc-h', px: document.documentElement.scrollWidth - vw });
    if (document.body.scrollWidth - vw > 1) issues.push({ kind: 'body-h', px: document.body.scrollWidth - vw });
    return { vw, issues };
  });
  await page.close();
}
writeFileSync(join(OUT, 'overflow-check.json'), JSON.stringify(overflow, null, 2));

async function shot(viewport, scale, name, fn) {
  const page = await browser.newPage();
  await page.setViewportSize(viewport);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await prepareCapture(page);
  await fn(page, join(OUT, name));
  await page.close();
}

await shot({ width: 1440, height: 900 }, 2, 'desktop-hero.png', async (p, path) => {
  await primeImages(p, '.hero');
  await p.locator('.hero').screenshot({ path });
});

await shot({ width: 390, height: 844 }, 2, 'mobile-hero-390.png', async (p, path) => {
  await primeImages(p, '.hero');
  const ok = await p.evaluate(() => {
    const s = document.querySelector('.device--hero-watch .device-screen');
    const nlv = document.querySelector('.device--hero-watch .watch-nlv');
    return { h: s?.getBoundingClientRect().height, text: nlv?.textContent?.slice(0, 12) };
  });
  if (!ok.h || ok.h < 40) throw new Error('watch hero empty ' + JSON.stringify(ok));
  await p.locator('.hero').screenshot({ path });
});

for (const [suffix, vp] of [
  ['', { width: 1440, height: 900 }],
  ['-390', { width: 390, height: 844 }],
]) {
  await shot(vp, 2, `section-watch${suffix}.png`, async (p, path) => {
    await p.goto(BASE + '/#watch', { waitUntil: 'networkidle' });
    await primeImages(p, '#watch');
    await p.locator('#watch').screenshot({ path });
  });
  await shot(vp, 2, `section-07-island-widgets${suffix}.png`, async (p, path) => {
    await p.goto(BASE + '/#island-widgets', { waitUntil: 'networkidle' });
    await primeImages(p, '#island-widgets');
    await p.locator('#island-widgets').screenshot({ path });
  });
}

for (const [which, idx] of [
  ['watch-glance', 0],
  ['watch-smile', 1],
]) {
  await shot({ width: 1440, height: 900 }, 2, `${which}.png`, async (p, path) => {
    await p.goto(BASE + '/#watch', { waitUntil: 'networkidle' });
    await primeImages(p, '#watch');
    const loc = p.locator('#watch .watch-shots .shots-two-item').nth(idx).locator('.device--watch-s10');
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    if (!box?.height) throw new Error(`no box ${which}`);
    await p.screenshot({ path, clip: box });
  });
}

await browser.close();
console.log(JSON.stringify({ overflow, verify: 'ok' }, null, 2));