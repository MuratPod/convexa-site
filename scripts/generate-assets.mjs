import sharp from 'sharp';
import { readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const screensDir = '/workspace/screens';
const outDir = '/workspace/public/assets';
const quality = 90;

const map = [
  ['01-home-portfolio.png', '01-home.webp'],
  ['01-home-portfolio-bottom.png', '01-home-bottom.webp'],
  ['02-analysis-smile-now.png', '02-now.webp'],
  ['03-analysis-smile-tomorrow.png', '03-tomorrow.webp'],
  ['04-analysis-virtual-leg.png', '04-virtual-leg.webp'],
  ['04-analysis-virtual-leg-chart.png', '04-virtual-leg-chart.webp'],
  ['05-analysis-legs-stepper.png', '05-legs.webp'],
  ['05-analysis-legs-stepper-jan.png', '05-legs-jan.webp'],
  ['06-vol.png', '06-vol.webp'],
  ['07-settings-live-activity.png', '07-settings.webp'],
  ['08-lock-compact-398.png', '08-lock-compact.webp'],
  ['09-lock-two-lines-398.png', '09-lock-two-lines.webp'],
  ['09-lock-two-lines-card-3x.png', '09-lock-card-3x.webp'],
  ['10-dynamic-island-compact.png', '10-island-compact.webp'],
  ['11-dynamic-island-expanded.png', '11-island-expanded.webp'],
  ['12-widget-small.png', '12-widget-small.webp'],
  ['12-widget-medium.png', '12-widget-medium.webp'],
];

for (const [src, dest] of map) {
  const input = join(screensDir, src);
  const output = join(outDir, dest);
  const meta = await sharp(input).metadata();
  await sharp(input).webp({ quality }).toFile(output);
  console.log(`${dest} ${meta.width}x${meta.height}`);
}

const keep = new Set([...map.map(([, d]) => d), 'og.webp', 'favicon.png', 'favicon-32.png', 'og.png']);
for (const f of readdirSync(outDir)) {
  if (f.endsWith('.webp') && !keep.has(f) && !f.startsWith('.')) {
    unlinkSync(join(outDir, f));
    console.log('removed', f);
  }
}