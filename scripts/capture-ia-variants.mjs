import { chromium } from 'playwright';
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
const paths = ['/', '/a/', '/b/', '/c/'];
const widths = [360, 390, 768, 900, 901, 1024, 1280, 1440];

const browser = await chromium.launch();
const report = {};

for (const path of paths) {
  report[path] = {};
  for (const w of widths) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: w, height: w >= 1024 ? 900 : 844 });
    await page.goto(BASE + path, { waitUntil: 'load' });
    const isVariantC = path === '/c/';
    const issues = await page.evaluate((checkTabs) => {
      const out = [];
      const doc = document.documentElement;
      const body = document.body;
      if (doc.scrollWidth - doc.clientWidth > 1) {
        out.push({ kind: 'doc-scroll', px: doc.scrollWidth - doc.clientWidth });
      }
      if (body.scrollWidth - doc.clientWidth > 1) {
        out.push({ kind: 'body-scroll', px: body.scrollWidth - doc.clientWidth });
      }
      if (checkTabs) {
        const tabs = document.querySelectorAll('[role="tab"].tabs-pill');
        const wrap = document.querySelector('.tablist-wrap');
        if (tabs.length >= 6 && wrap && wrap.scrollWidth > wrap.clientWidth + 1) {
          out.push({ kind: 'tabs-horizontal-clip', sw: wrap.scrollWidth, cw: wrap.clientWidth });
        }
      }
      return out;
    }, isVariantC);
    const lock = page.locator('.device-screen--lock-ios').first();
    if (await lock.count()) {
      await lock.scrollIntoViewIfNeeded();
      await page.waitForTimeout(40);
    }
    await assertLockLiveActivityStrip(page);
    await assertWatchTextFits(page);
    if (path === '/' || path === '/b/') {
      if ([360, 390, 768, 1024, 1440].includes(w)) {
        await page.locator('#lock-screen').scrollIntoViewIfNeeded();
        await page.waitForTimeout(40);
        await assertLockCloseupInTile(page, w);
      }
      await assertGalleryHeader(page, w);
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
      await assertHeroShowcaseAlignment(page, w);
    }

    if (path === '/a/' && w >= 1024) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => window.scrollY < 8);
      await page.waitForTimeout(80);
      let active = await page.evaluate(() => document.querySelector('.story-phone-stack img.is-active')?.dataset.screen);
      if (active !== 'home') throw new Error(`/a/ story not home at top @ ${w} (got ${active})`);
      await page.locator('#ch-settings').scrollIntoViewIfNeeded();
      await page.waitForTimeout(120);
      active = await page.evaluate(() => document.querySelector('.story-phone-stack img.is-active')?.dataset.screen);
      if (active !== 'settings') throw new Error(`/a/ story not settings when scrolled @ ${w} (got ${active})`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => window.scrollY < 8);
      await page.waitForTimeout(150);
      active = await page.evaluate(() => document.querySelector('.story-phone-stack img.is-active')?.dataset.screen);
      if (active !== 'home') throw new Error(`/a/ story not home after scroll back @ ${w} (got ${active})`);
    }

    if (issues.length) throw new Error(`${path}@${w}: ${JSON.stringify(issues)}`);
    report[path][w] = issues;
    await page.close();
  }
}

await browser.close();
console.log(JSON.stringify({ report, verify: 'ok' }, null, 2));