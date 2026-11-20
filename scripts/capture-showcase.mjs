import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });

const widths = [1440, 390, 360];

const sections = [
  { file: 'section-01-home', id: '#home' },
  { file: 'section-02-analysis', id: '#analysis' },
  { file: 'section-03-positions', id: '#positions' },
  { file: 'section-04-virtual-leg', id: '#virtual-leg' },
  { file: 'section-05-vol', id: '#vol' },
  { file: 'section-06-lock-screen', id: '#lock-screen' },
  { file: 'section-07-island-widgets', id: '#island-widgets' },
  { file: 'section-08-settings', id: '#settings' },
  { file: 'section-09-watch', id: '#watch' },
  { file: 'section-how', id: '#how' },
  { file: 'section-privacy', id: '#privacy' },
];

async function overflowCheck(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const issues = [];
    const vw = doc.clientWidth;
    if (doc.scrollWidth - vw > 1) issues.push({ kind: 'doc-h', px: doc.scrollWidth - vw });
    if (body.scrollWidth - vw > 1) issues.push({ kind: 'body-h', px: body.scrollWidth - vw });
    return { vw, issues };
  });
}

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2 });

const overflow = {};
for (const w of widths) {
  const page = await context.newPage();
  await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  overflow[w] = await overflowCheck(page);
  await page.close();
}
writeFileSync(join(OUT, 'overflow-check.json'), JSON.stringify(overflow, null, 2));

async function shot(name, viewport, fn) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await fn(page, join(OUT, name));
  await page.close();
}

await shot('desktop-hero.png', { width: 1440, height: 900 }, async (p, path) => {
  await p.locator('.hero').screenshot({ path });
});

await shot('mobile-hero-390.png', { width: 390, height: 844 }, async (p, path) => {
  await p.locator('.hero').screenshot({ path });
});

await shot('page-1440-full.png', { width: 1440, height: 900 }, async (p, path) => {
  await p.screenshot({ path, fullPage: true });
});

await shot('page-390-full.png', { width: 390, height: 844 }, async (p, path) => {
  await p.screenshot({ path, fullPage: true });
});

const sectionVp = { width: 1440, height: 900 };
const mobileVp = { width: 390, height: 844 };

for (const { file, id } of sections) {
  await shot(`${file}.png`, sectionVp, async (p, path) => {
    await p.goto(BASE + id, { waitUntil: 'networkidle' });
    await p.locator(id).screenshot({ path });
  });
  await shot(`${file}-390.png`, mobileVp, async (p, path) => {
    await p.goto(BASE + id, { waitUntil: 'networkidle' });
    await p.locator(id).screenshot({ path });
  });
}

await shot('watch-glance.png', sectionVp, async (p, path) => {
  await p.goto(BASE + '/#watch', { waitUntil: 'networkidle' });
  await p.locator('#watch .watch-shots .shots-two-item').first().locator('.device-screen').screenshot({ path });
});

await shot('watch-smile.png', sectionVp, async (p, path) => {
  await p.goto(BASE + '/#watch', { waitUntil: 'networkidle' });
  await p.locator('#watch .watch-shots .shots-two-item').nth(1).locator('.device-screen').screenshot({ path });
});

await browser.close();

const artifacts = [
  'desktop-hero.png',
  'mobile-hero-390.png',
  'page-1440-full.png',
  'page-390-full.png',
  'overflow-check.json',
  'watch-glance.png',
  'watch-smile.png',
  ...sections.flatMap((s) => [`${s.file}.png`, `${s.file}-390.png`]),
];

console.log(JSON.stringify({ overflow, artifacts, out: OUT }, null, 2));