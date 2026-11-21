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

function getPx(data, w, ch, x, y) {
  const i = (y * w + x) * ch;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

function isBg(px, bg, tol, transparentBg) {
  if (transparentBg) return px.a < 8;
  return (
    Math.abs(px.r - bg.r) <= tol
    && Math.abs(px.g - bg.g) <= tol
    && Math.abs(px.b - bg.b) <= tol
    && Math.abs(px.a - bg.a) <= tol
  );
}

function rowAllBg(data, w, h, ch, y, x0, x1, bg, tol, transparentBg) {
  for (let x = x0; x <= x1; x += 1) {
    if (!isBg(getPx(data, w, ch, x, y), bg, tol, transparentBg)) return false;
  }
  return true;
}

function colAllBg(data, w, h, ch, x, y0, y1, bg, tol, transparentBg) {
  for (let y = y0; y <= y1; y += 1) {
    if (!isBg(getPx(data, w, ch, x, y), bg, tol, transparentBg)) return false;
  }
  return true;
}

/** Trim only uniform outer margins matching source corner colour (±3) or transparent. */
async function trimOuterMarginByCorners(inputPath, { tol = 3, minPad = 6 } = {}) {
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const cornerPts = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  const corners = cornerPts.map(([x, y]) => getPx(data, w, ch, x, y));
  const bg = {
    r: Math.round(corners.reduce((s, c) => s + c.r, 0) / corners.length),
    g: Math.round(corners.reduce((s, c) => s + c.g, 0) / corners.length),
    b: Math.round(corners.reduce((s, c) => s + c.b, 0) / corners.length),
    a: Math.round(corners.reduce((s, c) => s + c.a, 0) / corners.length),
  };
  const maxDev = Math.max(
    ...corners.map((c) => Math.max(
      Math.abs(c.r - bg.r),
      Math.abs(c.g - bg.g),
      Math.abs(c.b - bg.b),
      Math.abs(c.a - bg.a),
    )),
  );
  if (maxDev > tol) {
    return { skip: true, reason: 'corner-mismatch', maxDev, bg };
  }
  const transparentBg = bg.a < 8 || corners.every((c) => c.a < 8);

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;
  while (top <= bottom && rowAllBg(data, w, h, ch, top, 0, w - 1, bg, tol, transparentBg)) top += 1;
  while (bottom >= top && rowAllBg(data, w, h, ch, bottom, 0, w - 1, bg, tol, transparentBg)) bottom -= 1;
  while (left <= right && colAllBg(data, w, h, ch, left, top, bottom, bg, tol, transparentBg)) left += 1;
  while (right >= left && colAllBg(data, w, h, ch, right, top, bottom, bg, tol, transparentBg)) right -= 1;

  if (left >= right || top >= bottom) {
    return { skip: true, reason: 'no-margin', bg };
  }

  const padL = Math.max(0, left - minPad);
  const padT = Math.max(0, top - minPad);
  const padR = Math.min(w - 1, right + minPad);
  const padB = Math.min(h - 1, bottom + minPad);

  const cropW = padR - padL + 1;
  const cropH = padB - padT + 1;
  if (cropW >= w - 2 && cropH >= h - 2) {
    return { skip: true, reason: 'insufficient-trim', bg };
  }

  return {
    left: padL,
    top: padT,
    width: cropW,
    height: cropH,
    bg,
    transparentBg,
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
    const crop = await trimOuterMarginByCorners(input);
    if (crop && !crop.skip) {
      pipeline = sharp(input).extract(crop);
      console.log(`${dest} crop ${crop.width}x${crop.height} @ ${crop.left},${crop.top}`);
    } else if (crop?.skip) {
      console.log(`${dest} skip trim: ${crop.reason}`);
    }
  }
  await pipeline.webp({ quality }).toFile(output);
  const meta = await sharp(output).metadata();
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