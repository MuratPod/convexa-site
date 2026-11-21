import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  assertLockLiveActivityStrip,
  assertWatchTextFits,
  assertGalleryHeader,
  assertBentoRowHeights,
  assertBentoIslandVisualGaps,
  assertTileAssetCornerBackgrounds,
  assertLockCloseupInTile,
  assertBentoMobileCarousel,
  assertBentoSlideImagesContained,
  assertBentoVisibilityMode,
  assertBentoLastSlideInTrack,
  assertGalleryLastSlideInTrack,
  assertGalleryRapidNextToSettings,
  assertHeroShowcaseAlignment,
} from './capture-assertions.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });
const widths = [1440, 1366, 1280, 1152, 1024, 901, 900, 768, 390, 360];
const MARGIN = 8;

function minWidgetWidthForViewport(w) {
  return w <= 390 ? 120 : 140;
}

async function widgetImgWidths(page) {
  return page.evaluate(() => {
    const imgs = document.querySelectorAll('#island-widgets .tile-row img, .bento-island .tile-row img');
    return [...imgs].map((img) => ({
      cls: img.className.split(/\s+/).find((c) => c.startsWith('tile-widget')) || img.className,
      width: img.getBoundingClientRect().width,
      bento: Boolean(img.closest('.bento-island')),
    }));
  });
}

function minForWidget(w, row) {
  const isMedium = String(row.cls).includes('medium');
  if (row.bento && w >= 1280) {
    return isMedium ? 420 : 200;
  }
  if (row.bento && w >= 1024) {
    return isMedium ? 340 : 160;
  }
  return minWidgetWidthForViewport(w);
}

function assertWidgetWidths(w, rows) {
  const bad = rows.filter((r) => r.width + 0.5 < minForWidget(w, r));
  if (bad.length) {
    throw new Error(`widget width below floor at ${w}: ${JSON.stringify(bad)}`);
  }
}

async function tilesChildrenFit(page) {
  return page.evaluate(() => {
    const tiles = document.querySelector('#island-widgets .tiles, .bento-island .tiles');
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

async function assertIphoneScreenShapes(page) {
  const issues = await page.evaluate(() => {
    const out = [];
    for (const screen of document.querySelectorAll('.device--iphone-16-pro-max .device-screen')) {
      const s = getComputedStyle(screen);
      const corners = [
        s.borderTopLeftRadius,
        s.borderTopRightRadius,
        s.borderBottomLeftRadius,
        s.borderBottomRightRadius,
      ];
      for (const c of corners) {
        if (String(c).includes('/')) out.push({ kind: 'radius-elliptical', value: c });
      }
      const [tl, tr, bl, br] = corners;
      if (tl !== tr || tl !== bl || tl !== br) {
        out.push({ kind: 'radius-mismatch', corners });
      }
      if (s.clipPath && s.clipPath !== 'none') out.push({ kind: 'clip-path', value: s.clipPath });
      const mask = s.maskImage || s.webkitMaskImage;
      if (mask && mask !== 'none') out.push({ kind: 'mask-image', value: mask });
    }
    return out;
  });
  if (issues.length) {
    throw new Error(`iphone device-screen shape: ${JSON.stringify(issues)}`);
  }
}

async function assertLockCloseupScale(page) {
  const issues = await page.evaluate(() => {
    const out = [];
    for (const img of document.querySelectorAll('#lock-screen .lock-card-closeup img')) {
      const r = img.getBoundingClientRect();
      const { naturalWidth: nw, naturalHeight: nh } = img;
      if (!nw || !nh || r.width < 1 || r.height < 1) continue;
      const natAspect = nw / nh;
      const rendAspect = r.width / r.height;
      const drift = Math.abs(natAspect - rendAspect) / natAspect;
      if (drift > 0.01) {
        out.push({ src: img.getAttribute('src'), nw, nh, w: r.width, h: r.height, natAspect, rendAspect, drift });
      }
    }
    return out;
  });
  if (issues.length) {
    throw new Error(`lock closeup aspect: ${JSON.stringify(issues)}`);
  }
}

async function assertLockCloseups(page, vw) {
  const hasCloseups = await page.evaluate(() => document.querySelectorAll('#lock-screen .lock-card-closeup img').length > 0);
  if (hasCloseups) {
    await assertLockCloseupScale(page);
  }
  if (vw !== 1440 && vw !== 390) return;
  if (!hasCloseups) {
    if (vw === 1440) {
      const phoneW = await page.evaluate(() => document.querySelector('#lock-screen .device--section')?.getBoundingClientRect().width ?? 0);
      if (phoneW > 0 && phoneW + 0.5 < 200) {
        throw new Error(`lock phone width ${phoneW} < 200 at 1440`);
      }
    }
    return;
  }
  const minStripWidth = vw <= 390 ? 280 : 360;
  const rows = await page.evaluate(() => {
    return [...document.querySelectorAll('#lock-screen .lock-card-closeup img')].map((img) => ({
      src: img.getAttribute('src') || '',
      w: img.getBoundingClientRect().width,
      h: img.getBoundingClientRect().height,
      natW: img.naturalWidth,
      natH: img.naturalHeight,
    }));
  });
  for (const row of rows) {
    if (row.w + 0.5 < minStripWidth) {
      throw new Error(`lock closeup narrow @ ${vw}: ${JSON.stringify(row)}`);
    }
    const textPx = (row.w / row.natW) * 44;
    const minText = vw <= 390 ? 13 : 15;
    if (textPx + 0.5 < minText) {
      throw new Error(`lock closeup text scale < ${minText}px @ ${vw}: ${JSON.stringify({ ...row, textPx })}`);
    }
  }
  const phoneW = await page.evaluate(() => document.querySelector('#lock-screen .device--section')?.getBoundingClientRect().width ?? 0);
  if (vw === 1440 && phoneW + 0.5 < 300) {
    throw new Error(`§06 phone width ${phoneW} < 300 at 1440`);
  }
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
    const tiles = document.querySelector('#island-widgets .tiles, .bento-island .tiles');
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
      if (!img.complete) {
        await Promise.race([
          new Promise((r) => {
            img.onload = img.onerror = r;
          }),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
      }
      try {
        await Promise.race([img.decode(), new Promise((r) => setTimeout(r, 2500))]);
      } catch {
        /* */
      }
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
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await prepareCapture(page);
  await primeImages(page, null);
  await assertIphoneScreenShapes(page);
  await assertLockCloseups(page, w);
  if ([360, 390, 768, 1024, 1440].includes(w)) {
    await page.locator('#lock-screen').scrollIntoViewIfNeeded();
    await page.waitForTimeout(40);
    await assertLockCloseupInTile(page, w);
  }
  const lockIos = page.locator('.device-screen--lock-ios').first();
  if (await lockIos.count()) {
    await lockIos.scrollIntoViewIfNeeded();
    await page.waitForTimeout(40);
  }
  await assertLockLiveActivityStrip(page);
  await assertWatchTextFits(page);
  if ([768, 1024, 1280, 1440].includes(w)) {
    await assertGalleryHeader(page, w);
  }
  if ([360, 390, 768].includes(w)) {
    await page.locator('#bento-track').scrollIntoViewIfNeeded();
    await page.waitForTimeout(60);
    await assertBentoVisibilityMode(page, w);
    await assertBentoMobileCarousel(page, w);
    await assertBentoSlideImagesContained(page, w);
    await assertBentoLastSlideInTrack(page, w);
    await page.locator('#gallery-track').scrollIntoViewIfNeeded();
    await assertGalleryLastSlideInTrack(page, w);
  }
  if ([1024, 1440].includes(w)) {
    await assertBentoVisibilityMode(page, w);
  }
  if (w === 1440) {
    await page.locator('#gallery-track').scrollIntoViewIfNeeded();
    await assertGalleryRapidNextToSettings(page, w);
    await assertGalleryLastSlideInTrack(page, w);
  }
  if (w >= 1024) {
    await assertBentoRowHeights(page, w);
    await page.locator('#island-widgets').scrollIntoViewIfNeeded();
    await page.waitForTimeout(40);
    await assertTileAssetCornerBackgrounds(page);
    await assertBentoIslandVisualGaps(page, w);
  }
  if ([360, 390, 768, 900, 901, 1024, 1280, 1366, 1440].includes(w)) {
    await assertHeroShowcaseAlignment(page, w);
  }
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
  await page.goto(BASE, { waitUntil: 'load' });
  await prepareCapture(page);
  await fn(page, join(OUT, name));
  await page.close();
}

for (const [suffix, vp] of [
  ['', { width: 1440, height: 900 }],
  ['-390', { width: 390, height: 844 }],
]) {
  await shot(vp, `section-07-island-widgets${suffix}.png`, async (p, path) => {
    await p.goto(BASE + '/#island-widgets', { waitUntil: 'load' });
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
  ['-1280', { width: 1280, height: 900 }],
  ['-1024', { width: 1024, height: 900 }],
  ['-390', { width: 390, height: 844 }],
]) {
  await shot(vp, `hero-devices${suffix}.png`, async (p, path) => {
    await p.goto(BASE + '/#top', { waitUntil: 'load' });
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
    await p.goto(BASE + '/#lock-screen', { waitUntil: 'load' });
    await primeImages(p, '#lock-screen');
    await assertIphoneScreenShapes(p);
    await assertLockCloseups(p, vp.width);
    const issues = await layoutChecks(p, vp.width);
    if (issues.length) throw new Error(`§06 ${suffix}: ${JSON.stringify(issues)}`);
    await p.locator('#lock-screen').screenshot({ path });
  });
}

for (const [suffix, vp] of [
  ['-360', { width: 360, height: 844 }],
  ['-390', { width: 390, height: 844 }],
  ['-768', { width: 768, height: 1024 }],
]) {
  await shot(vp, `mobile-menu-open${suffix}.png`, async (p, path) => {
    await p.goto(BASE + '/#top', { waitUntil: 'load' });
    await p.locator('#nav-menu-btn').click();
    await p.waitForSelector('#nav-mobile-overlay:not([hidden])');
    const bleed = await p.evaluate(() => {
      const h1 = document.querySelector('.hero h1');
      const overlay = document.querySelector('#nav-mobile-panel');
      if (!h1 || !overlay) return null;
      const hr = h1.getBoundingClientRect();
      const or = overlay.getBoundingClientRect();
      const cs = getComputedStyle(overlay);
      const heroCovered = or.top <= hr.top + 4 && or.bottom >= hr.bottom - 4;
      return {
        opaque: cs.backgroundColor,
        heroCovered,
        overlayCovers: or.height >= innerHeight * 0.5,
      };
    });
    if (!bleed || !bleed.heroCovered || bleed.opaque !== 'rgb(11, 12, 16)') {
      throw new Error(`menu overlay @ ${vp.width}: ${JSON.stringify(bleed)}`);
    }
    await p.screenshot({ path, fullPage: true });
  });
}

{
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/#top', { waitUntil: 'load' });
  await page.locator('#nav-menu-btn').click();
  await page.waitForSelector('#nav-mobile-overlay:not([hidden])');
  await page.locator('#nav-menu-btn').focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('nav-mobile-overlay')?.hidden);
  const esc = await page.evaluate(() => {
    const btn = document.getElementById('nav-menu-btn');
    return {
      expanded: btn?.getAttribute('aria-expanded'),
      overlayHidden: document.getElementById('nav-mobile-overlay')?.hidden,
      focusId: document.activeElement?.id,
    };
  });
  if (esc.expanded !== 'false' || !esc.overlayHidden || esc.focusId !== 'nav-menu-btn') {
    throw new Error(`menu Escape with focus on Close @ 390: ${JSON.stringify(esc)}`);
  }
  await page.close();
}

await browser.close();
console.log(JSON.stringify({ layout, tilesFit, widgetWidths, verify: 'ok' }, null, 2));