import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });

const widths = [1440, 390, 360];

async function overflowCheck(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const issues = [];
    const vw = doc.clientWidth;
    const docScroll = doc.scrollWidth - vw;
    const bodyScroll = body.scrollWidth - vw;
    if (docScroll > 1) issues.push({ kind: 'doc-h', px: docScroll });
    if (bodyScroll > 1) issues.push({ kind: 'body-h', px: bodyScroll });
    document.querySelectorAll('.device-screen, .watch-ui-canvas, .watch-top-time').forEach((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const parent = el.closest('.device-screen');
      const pr = parent ? parent.getBoundingClientRect() : null;
      if (el.classList.contains('watch-top-time') && pr) {
        const gapRight = pr.right - r.right;
        if (gapRight < 2) issues.push({ kind: 'time-gap', px: gapRight, text: el.textContent });
      }
      if (el.scrollWidth > el.clientWidth + 1) {
        issues.push({ kind: 'overflow-x', cls: el.className, sw: el.scrollWidth, cw: el.clientWidth });
      }
      if (el.scrollHeight > el.clientHeight + 1 && el.classList.contains('watch-ui-canvas')) {
        issues.push({ kind: 'overflow-y', cls: el.className, sh: el.scrollHeight, ch: el.clientHeight });
      }
    });
    const time = document.querySelector('.device--hero-watch .watch-top-time');
    const timeBox = time
      ? {
          text: time.textContent,
          paddingTop: getComputedStyle(time.closest('.watch-top')).paddingTop,
          paddingRight: getComputedStyle(time.closest('.watch-top')).paddingRight,
          fontSize: getComputedStyle(time).fontSize,
          rect: time.getBoundingClientRect(),
          screen: time.closest('.device-screen')?.getBoundingClientRect(),
        }
      : null;
    return { vw, issues, timeBox };
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

const desktop = await context.newPage();
await desktop.setViewportSize({ width: 1440, height: 900 });
await desktop.goto(BASE, { waitUntil: 'networkidle' });
await desktop.locator('.hero').screenshot({ path: join(OUT, 'desktop-hero.png') });

const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await mobile.locator('.hero').screenshot({ path: join(OUT, 'mobile-hero-390.png') });

const section = await context.newPage();
await section.setViewportSize({ width: 1440, height: 900 });
await section.goto(BASE + '/#watch', { waitUntil: 'networkidle' });
await section.locator('#watch').screenshot({ path: join(OUT, 'section-watch.png') });

const watchSection = await context.newPage();
await watchSection.setViewportSize({ width: 1440, height: 900 });
await watchSection.goto(BASE + '/#watch', { waitUntil: 'networkidle' });
const glance = watchSection.locator('#watch .watch-shots .shots-two-item').first().locator('.device-screen');
await glance.screenshot({ path: join(OUT, 'watch-glance.png') });
const smile = watchSection.locator('#watch .watch-shots .shots-two-item').nth(1).locator('.device-screen');
await smile.screenshot({ path: join(OUT, 'watch-smile.png') });

await browser.close();
console.log(JSON.stringify({ overflow, out: OUT }, null, 2));