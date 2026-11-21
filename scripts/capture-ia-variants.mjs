import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const paths = ['/a/', '/b/', '/c/'];
const widths = [1440, 390];

const browser = await chromium.launch();
const report = {};

for (const path of paths) {
  report[path] = {};
  for (const w of widths) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: w, height: w >= 1024 ? 900 : 844 });
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const issues = await page.evaluate(() => {
      const out = [];
      const doc = document.documentElement;
      const body = document.body;
      if (doc.scrollWidth - doc.clientWidth > 1) {
        out.push({ kind: 'doc-scroll', px: doc.scrollWidth - doc.clientWidth });
      }
      if (body.scrollWidth - doc.clientWidth > 1) {
        out.push({ kind: 'body-scroll', px: body.scrollWidth - doc.clientWidth });
      }
      return out;
    });
    if (issues.length) throw new Error(`${path}@${w}: ${JSON.stringify(issues)}`);
    report[path][w] = issues;
    await page.close();
  }
}

await browser.close();
console.log(JSON.stringify({ report, verify: 'ok' }, null, 2));