/** @param {import('playwright').Page} page */
export async function assertLockLiveActivityStrip(page) {
  const count = await page.locator('.device-screen--lock-ios').count();
  for (let i = 0; i < count; i += 1) {
    const data = await page.locator('.device-screen--lock-ios').nth(i).evaluate((screen) => {
      const la = screen.querySelector('.lock-ios-la');
      const shortcuts = screen.querySelector('.lock-ios-shortcuts');
      if (!la) return null;
      const sr = screen.getBoundingClientRect();
      const lr = la.getBoundingClientRect();
      const scR = shortcuts?.getBoundingClientRect();
      const heightRatio = lr.height / sr.height;
      const inside =
        lr.left >= sr.left - 2
        && lr.right <= sr.right + 2
        && lr.top >= sr.top - 2
        && lr.bottom <= sr.bottom + 2;
      const overlapShortcuts = Boolean(scR && lr.bottom > scR.top - 6);
      const clockBandClear = lr.top > sr.top + sr.height * 0.3;
      const widthRatio = lr.width / sr.width;
      return { heightRatio, inside, overlapShortcuts, clockBandClear, widthRatio };
    });
    if (!data) continue;
    if (data.heightRatio >= 0.25) {
      throw new Error(`lock LA height ratio ${data.heightRatio.toFixed(3)} >= 0.25 (index ${i})`);
    }
    if (!data.inside) throw new Error(`lock LA not inside screen (index ${i}): ${JSON.stringify(data)}`);
    if (data.overlapShortcuts) throw new Error(`lock LA overlaps shortcut buttons (index ${i})`);
    if (!data.clockBandClear) throw new Error(`lock LA covers clock/date band (index ${i})`);
    if (data.widthRatio > 0.94) {
      throw new Error(`lock LA too wide: ${data.widthRatio.toFixed(3)} of screen (index ${i})`);
    }
  }

  const halo = await page.locator('.device-screen--lock-ios').first().evaluate((screen) => {
    const la = screen.querySelector('.lock-ios-la');
    if (!la) return { skip: true };
    const lr = la.getBoundingClientRect();
    const sr = screen.getBoundingClientRect();
    const wallpaper = screen.querySelector('.lock-ios-wallpaper');
    const sampleAt = (x, y) => {
      const hits = document.elementsFromPoint(x, y);
      if (!hits.length) return 'none';
      if (hits.some((el) => el === la || la.contains(el))) return 'la';
      if (wallpaper && hits.some((el) => el === wallpaper || wallpaper.contains(el))) return 'wallpaper';
      return hits[0].className?.toString().slice(0, 40) || 'unknown';
    };
    const xL = Math.max(sr.left + 6, lr.left - Math.max(10, lr.width * 0.06));
    const xR = Math.min(sr.right - 6, lr.right + Math.max(10, lr.width * 0.06));
    const yMid = lr.top + lr.height * 0.55;
    const yAbove = Math.max(sr.top + 8, lr.top - Math.max(8, lr.height * 0.15));
    const leftMid = sampleAt(xL, yMid);
    const rightMid = sampleAt(xR, yMid);
    const aboveMid = sampleAt(lr.left + lr.width * 0.5, yAbove);
    if ([leftMid, rightMid, aboveMid].every((k) => k === 'none')) {
      return { skip: true, reason: 'no hits' };
    }
    const badLa = [leftMid, rightMid, aboveMid].includes('la');
    const allWall = [leftMid, rightMid, aboveMid].every((k) => k === 'wallpaper');
    return {
      leftMid,
      rightMid,
      aboveMid,
      ok: !badLa && allWall,
    };
  });
  if (!halo?.skip && halo && !halo.ok) {
    throw new Error(`lock LA halo / backdrop outside card: ${JSON.stringify(halo)}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertGalleryHeader(page, vw) {
  if (vw < 768) return;
  const data = await page.evaluate(() => {
    const h2 = document.querySelector('#h-gallery');
    const controls = document.querySelector('.gallery-controls');
    const track = document.querySelector('.gallery-track');
    if (!h2 || !controls) return { skip: true };
    const h2Style = getComputedStyle(h2);
    const lh = Number.parseFloat(h2Style.lineHeight);
    const lineHeight = Number.isFinite(lh) ? lh : Number.parseFloat(h2Style.fontSize) * 1.25;
    const hr = h2.getBoundingClientRect();
    const cr = controls.getBoundingClientRect();
    const tr = track?.getBoundingClientRect();
    const h2Center = hr.top + hr.height / 2;
    const controlCenter = cr.top + cr.height / 2;
    return {
      h2Height: hr.height,
      lineHeight,
      maxH: lineHeight * 2.5,
      vDelta: Math.abs(h2Center - controlCenter),
      trackRight: tr?.right ?? null,
      controlsRight: cr.right,
    };
  });
  if (data.skip) return;
  if (data.h2Height > data.maxH + 0.5) {
    throw new Error(`gallery h2 height ${data.h2Height} > 2.5×line-height (${data.maxH}) @ ${vw}`);
  }
  if (data.vDelta > 8) {
    throw new Error(`gallery arrows not centered with h2: Δ${data.vDelta}px @ ${vw}`);
  }
  if (vw >= 901 && data.trackRight != null && Math.abs(data.controlsRight - data.trackRight) > 6) {
    throw new Error(`gallery controls misaligned with track right @ ${vw}: ${JSON.stringify(data)}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertHeroPhoneCentered(page, vw) {
  if (vw > 900) return;
  const delta = await page.evaluate(() => {
    const device = document.querySelector('.hero--showcase .device--hero-home');
    if (!device) return null;
    const r = device.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    return Math.abs(cx - window.innerWidth / 2);
  });
  if (delta == null) return;
  if (delta > 4) {
    throw new Error(`hero phone not viewport-centered: Δ${delta}px @ ${vw}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertHeroShowcaseAlignment(page, vw) {
  const heroSel = '.hero--showcase';
  if (vw <= 900) {
    await assertHeroPhoneCentered(page, vw);
    return;
  }
  const data = await page.evaluate((sel) => {
    const hero = document.querySelector(sel);
    const logo = document.querySelector('.site-nav .logo');
    const heroCopy = hero?.querySelector('.hero-copy');
    const privacy = document.querySelector('.nav-links a[href="#privacy"]');
    const device = hero?.querySelector('.device--hero-home');
    const wrap = document.querySelector('.site-nav .wrap');
    if (!hero || !logo || !heroCopy || !device) return { skip: true };
    const logoLeft = logo.getBoundingClientRect().left;
    const copyLeft = heroCopy.getBoundingClientRect().left;
    const deviceRight = device.getBoundingClientRect().right;
    const deviceW = device.getBoundingClientRect().width;
    const navRight = privacy?.getBoundingClientRect().right ?? wrap?.getBoundingClientRect().right;
    return {
      textDelta: Math.abs(logoLeft - copyLeft),
      deviceRight,
      deviceW,
      navRight,
    };
  }, heroSel);
  if (data.skip) return;
  if (data.textDelta > 2) {
    throw new Error(`hero copy not aligned with logo: Δ${data.textDelta}px @ ${vw}`);
  }
  if (data.navRight != null && data.deviceRight > data.navRight + 2) {
    throw new Error(`hero phone past nav right @ ${vw}: device ${data.deviceRight} > nav ${data.navRight}`);
  }
  if (vw >= 901 && data.deviceW + 0.5 < 300) {
    throw new Error(`hero phone width ${data.deviceW} < 300px @ ${vw}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertBentoRowHeights(page, vw) {
  if (vw < 1024) return;
  const diff = await page.evaluate(() => {
    const lock = document.querySelector('.bento-lock.bento-tile');
    const watch = document.querySelector('.bento-watch.bento-tile');
    if (!lock || !watch) return null;
    return Math.abs(lock.getBoundingClientRect().height - watch.getBoundingClientRect().height);
  });
  if (diff == null) return;
  if (diff > 2) {
    throw new Error(`bento lock/watch tile height mismatch: ${diff}px @ ${vw}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertWatchTextFits(page) {
  const bad = await page.evaluate(() => {
    const issues = [];
    for (const root of document.querySelectorAll('.watch-ui-canvas')) {
      for (const el of root.querySelectorAll('.watch-nlv, .watch-day, .tick-nums, .watch-smile-title, .watch-top-time, .watch-fresh')) {
        const text = (el.textContent || '').trim();
        if (!text) continue;
        if (el.scrollWidth > el.clientWidth + 1) {
          issues.push({
            cls: el.className,
            sw: el.scrollWidth,
            cw: el.clientWidth,
            text: text.slice(0, 28),
          });
        }
      }
    }
    return issues;
  });
  if (bad.length) {
    throw new Error(`watch text overflow: ${JSON.stringify(bad)}`);
  }
}