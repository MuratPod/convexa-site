import { chromium } from 'playwright';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const template = join(root, 'scripts/og-template.html');
const outWebp = join(root, 'public/assets/og.webp');
const outPng = join(root, 'public/assets/og.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`file://${template}`, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  for (const img of document.querySelectorAll('img')) {
    if (!img.complete) await new Promise((r) => { img.onload = img.onerror = r; });
    try { await img.decode(); } catch { /* */ }
  }
});
const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();

await sharp(png).png().toFile(outPng);
await sharp(png).webp({ quality: 90 }).toFile(outWebp);
const meta = await sharp(outWebp).metadata();
console.log(`og.webp ${meta.width}x${meta.height} ${meta.format}`);