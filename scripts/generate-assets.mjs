import sharp from 'sharp';
import { readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const screensDir = '/workspace/screens';
const outDir = '/workspace/public/assets';
const quality = 90;

/** Tight bounds of the black LA card in 09-lock-two-lines-card-3x.png (no baked margin). */
const twoLinesCardCrop = {
  left: 48,
  top: 68,
  width: 1098,
  height: 225,
};

/** Trim near-black / transparent margins; keep 1px pad so anti-aliased UI isn’t clipped. */
async function trimEmptyMargins(inputPath, { bgLum = 18, pad = 1 } = {}) {
  const img = sharp(inputPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      const l = lum(data[i], data[i + 1], data[i + 2]);
      if (a < 8 || l <= bgLum) continue;
      n += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!n) return null;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(w - 1, maxX + pad);
  const bottom = Math.min(h - 1, maxY + pad);
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

const trimDests = new Set([
  '10-island-compact.webp',
  '11-island-expanded.webp',
  '12-widget-small.webp',
  '12-widget-medium.webp',
]);

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
  ['10-dynamic-island-compact.png', '10-island-compact.webp'],
  ['11-dynamic-island-expanded.png', '11-island-expanded.webp'],
  ['12-widget-small.png', '12-widget-small.webp'],
  ['12-widget-medium.png', '12-widget-medium.webp'],
];

for (const [src, dest] of map) {
  const input = join(screensDir, src);
  const output = join(outDir, dest);
  let pipeline = sharp(input);
  if (trimDests.has(dest)) {
    const crop = await trimEmptyMargins(input);
    if (crop) {
      pipeline = sharp(input).extract(crop);
      console.log(`${dest} crop ${crop.width}x${crop.height} @ ${crop.left},${crop.top}`);
    }
  }
  const meta = await pipeline.metadata();
  await pipeline.webp({ quality }).toFile(output);
  console.log(`${dest} ${meta.width}x${meta.height}`);
}

const compactCard = {
  left: 58,
  top: 2587,
  width: 1204,
  height: 192,
};
const compactCardOut = join(outDir, '08-lock-compact-card-3x.webp');
await sharp(join(screensDir, '08-lock-compact-398.png'))
  .extract(compactCard)
  .webp({ quality })
  .toFile(compactCardOut);
console.log(`08-lock-compact-card-3x.webp ${compactCard.width}x${compactCard.height}`);

const twoLinesCardOut = join(outDir, '09-lock-card-3x.webp');
await sharp(join(screensDir, '09-lock-two-lines-card-3x.png'))
  .extract(twoLinesCardCrop)
  .webp({ quality })
  .toFile(twoLinesCardOut);
console.log(`09-lock-card-3x.webp ${twoLinesCardCrop.width}x${twoLinesCardCrop.height}`);

const lockWallH = 2480;
for (const [src, dest] of [
  ['09-lock-two-lines-398.png', 'lock-wallpaper-two-lines.webp'],
  ['08-lock-compact-398.png', 'lock-wallpaper-compact.webp'],
]) {
  await sharp(join(screensDir, src))
    .extract({ left: 0, top: 0, width: 1320, height: lockWallH })
    .webp({ quality })
    .toFile(join(outDir, dest));
  console.log(`${dest} 1320x${lockWallH}`);
}

const keep = new Set([
  ...map.map(([, d]) => d),
  '09-lock-card-3x.webp',
  '08-lock-compact-card-3x.webp',
  'lock-wallpaper-two-lines.webp',
  'lock-wallpaper-compact.webp',
  'og.webp',
  'favicon.png',
  'favicon-32.png',
  'og.png',
]);
for (const f of readdirSync(outDir)) {
  if (f.endsWith('.webp') && !keep.has(f) && !f.startsWith('.')) {
    unlinkSync(join(outDir, f));
    console.log('removed', f);
  }
}