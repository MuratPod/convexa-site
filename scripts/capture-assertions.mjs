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
export async function assertTileAssetCornerBackgrounds(page) {
  const issues = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#island-widgets .tiles img, .bento-island .tiles img')];
    const out = [];
    const tol = 3;
    for (const img of imgs) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h || !img.complete) continue;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, w, h);
      const px = (x, y) => ({
        r: data[(y * w + x) * 4],
        g: data[(y * w + x) * 4 + 1],
        b: data[(y * w + x) * 4 + 2],
        a: data[(y * w + x) * 4 + 3],
      });
      const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
      const ref = corners[0];
      const transparentBg = ref.a < 8;
      for (let i = 0; i < corners.length; i += 1) {
        const p = corners[i];
        if (transparentBg) {
          if (p.a >= 8) out.push({ src: img.getAttribute('src'), corner: i, kind: 'corner-not-transparent', p });
        } else if (
          Math.abs(p.r - ref.r) > tol
          || Math.abs(p.g - ref.g) > tol
          || Math.abs(p.b - ref.b) > tol
          || Math.abs(p.a - ref.a) > tol
        ) {
          out.push({ src: img.getAttribute('src'), corner: i, kind: 'corner-mismatch', ref, p });
        }
      }
    }
    return out;
  });
  if (issues.length) {
    throw new Error(`tile asset corner background: ${JSON.stringify(issues)}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertBentoIslandVisualGaps(page, vw) {
  if (vw < 1024) return;
  const result = await page.evaluate(async () => {
    const tiles = document.querySelector('#island-widgets .tiles, .bento-island .tiles');
    if (!tiles) return { skip: true };

    function contentBBox(img) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h || !img.complete) return null;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, w, h);
      const px = (x, y) => ({
        r: data[(y * w + x) * 4],
        g: data[(y * w + x) * 4 + 1],
        b: data[(y * w + x) * 4 + 2],
        a: data[(y * w + x) * 4 + 3],
      });
      const tol = 3;
      const ref = px(0, 0);
      const transparentBg = ref.a < 8;
      const isBg = (p) => (
        transparentBg
          ? p.a < 8
          : Math.abs(p.r - ref.r) <= tol
            && Math.abs(p.g - ref.g) <= tol
            && Math.abs(p.b - ref.b) <= tol
            && Math.abs(p.a - ref.a) <= tol
      );
      const rowBg = (y) => {
        for (let x = 0; x < w; x += 1) if (!isBg(px(x, y))) return false;
        return true;
      };
      const colBg = (x, y0, y1) => {
        for (let y = y0; y <= y1; y += 1) if (!isBg(px(x, y))) return false;
        return true;
      };
      let top = 0;
      let bottom = h - 1;
      let left = 0;
      let right = w - 1;
      while (top <= bottom && rowBg(top)) top += 1;
      while (bottom >= top && rowBg(bottom)) bottom -= 1;
      while (left <= right && colBg(left, top, bottom)) left += 1;
      while (right >= left && colBg(right, top, bottom)) right -= 1;
      if (left > right || top > bottom) return null;
      const r = img.getBoundingClientRect();
      const sx = r.width / w;
      const sy = r.height / h;
      return {
        top: r.top + top * sy,
        bottom: r.top + (bottom + 1) * sy,
      };
    }

    const boxes = [];
    for (const child of tiles.children) {
      if (child.classList.contains('tile-row')) {
        let top = Infinity;
        let bottom = -Infinity;
        for (const img of child.querySelectorAll('img')) {
          const b = contentBBox(img);
          if (b) {
            top = Math.min(top, b.top);
            bottom = Math.max(bottom, b.bottom);
          }
        }
        if (top < Infinity) boxes.push({ top, bottom });
      } else if (child.tagName === 'IMG') {
        const b = contentBBox(child);
        if (b) boxes.push(b);
      }
    }

    const gaps = [];
    for (let i = 0; i < boxes.length - 1; i += 1) {
      gaps.push({ i, px: boxes[i + 1].top - boxes[i].bottom });
    }
    return { gaps, count: boxes.length };
  });

  if (result.skip) return;
  for (const g of result.gaps) {
    if (g.px > 60) {
      throw new Error(`bento Island visual gap ${g.px.toFixed(1)}px > 60 between #${g.i} and #${g.i + 1} @ ${vw}`);
    }
    if (g.px < -2) {
      throw new Error(`bento Island overlap ${g.px.toFixed(1)}px @ ${vw}`);
    }
  }
}

/** @param {import('playwright').Page} page */
export async function assertLockCloseupInTile(page, vw) {
  const widths = [360, 390, 768, 1024, 1440];
  if (!widths.includes(vw)) return;
  const bad = await page.evaluate(() => {
    const tile = document.querySelector('#lock-screen.bento-tile, .bento-lock.bento-tile');
    const closeup = tile?.querySelector('.lock-card-closeup');
    if (!tile || !closeup) return null;
    const padL = Number.parseFloat(getComputedStyle(tile).paddingLeft) || 0;
    const padR = Number.parseFloat(getComputedStyle(tile).paddingRight) || 0;
    const tr = tile.getBoundingClientRect();
    const contentLeft = tr.left + padL;
    const contentRight = tr.right - padR;
    const cr = closeup.getBoundingClientRect();
    const issues = [];
    if (cr.left < contentLeft - 1.5) {
      issues.push({ side: 'left', inset: cr.left - contentLeft });
    }
    if (cr.right > contentRight + 1.5) {
      issues.push({ side: 'right', inset: cr.right - contentRight });
    }
    if (padL < 15.5) issues.push({ side: 'padding', msg: `padL ${padL}` });
    return issues.length
      ? { contentLeft, contentRight, closeup: { l: cr.left, r: cr.right }, padL, padR, issues }
      : null;
  });
  if (bad) {
    throw new Error(`lock closeup outside tile content box @ ${vw}: ${JSON.stringify(bad)}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertBentoVisibilityMode(page, vw) {
  const narrow = [360, 390, 768];
  const wide = [1024, 1440];
  if (!narrow.includes(vw) && !wide.includes(vw)) return;
  const bad = await page.evaluate((isNarrow) => {
    const issues = [];
    if (isNarrow) {
      for (const el of document.querySelectorAll('.bento-desktop-only')) {
        const disp = getComputedStyle(el).display;
        if (disp !== 'none') {
          issues.push({ el: el.id || el.className, display: disp });
        }
      }
    } else {
      for (const el of document.querySelectorAll('.bento-carousel-slide.bento-slide-island, .bento-carousel-slide.bento-slide-widgets')) {
        const disp = getComputedStyle(el).display;
        if (disp !== 'none') {
          issues.push({ el: el.getAttribute('aria-label') || el.className, display: disp });
        }
      }
      const cluster = document.getElementById('island-widgets');
      if (cluster && getComputedStyle(cluster).display === 'none') {
        issues.push({ el: 'island-widgets', display: 'none' });
      }
    }
    return issues;
  }, narrow.includes(vw));
  if (bad.length) {
    throw new Error(`bento visibility @ ${vw}: ${JSON.stringify(bad)}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertBentoLastSlideInTrack(page, vw) {
  if (![360, 390, 768].includes(vw)) return;
  await page.evaluate(() => {
    const track = document.getElementById('bento-track');
    if (track) track.scrollTo({ left: 0, behavior: 'auto' });
  });
  await page.waitForTimeout(120);
  const slideCount = await page.evaluate(() => (
    [...document.querySelectorAll('.bento-carousel-slide')].filter(
      (el) => getComputedStyle(el).display !== 'none',
    ).length
  ));
  const clicks = Math.max(0, slideCount - 1);
  const next = page.locator('#bento-next');
  for (let i = 0; i < clicks; i += 1) {
    await next.click({ noWaitAfter: true });
  }
  await page.waitForTimeout(1000);
  const bad = await page.evaluate(() => {
    const track = document.getElementById('bento-track');
    if (!track) return { err: 'no track' };
    const pad = Number.parseFloat(getComputedStyle(track).scrollPaddingInlineStart) || 0;
    const slides = [...track.querySelectorAll('.bento-carousel-slide')].filter(
      (el) => getComputedStyle(el).display !== 'none',
    );
    const last = slides[slides.length - 1];
    if (!last) return { err: 'no slides' };
    const tr = track.getBoundingClientRect();
    const sr = last.getBoundingClientRect();
    const inView = sr.left >= tr.left - 3 && sr.right <= tr.right + 3;
    const anchor = track.scrollLeft + (Number.parseFloat(getComputedStyle(track).scrollPaddingInlineStart) || 0);
    let idx = 0;
    let best = Infinity;
    slides.forEach((slide, i) => {
      const d = Math.abs(slide.offsetLeft - anchor);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    const trailing = [...track.children].filter((ch) => {
      if (getComputedStyle(ch).display === 'none') return false;
      const r = ch.getBoundingClientRect();
      if (r.width < 2) return false;
      return r.left > sr.right - 2 && ch !== last;
    }).map((ch) => ({
      tag: ch.tagName,
      cls: ch.className?.slice?.(0, 48),
      left: ch.getBoundingClientRect().left,
    }));
    return {
      inView,
      idx,
      lastIdx: slides.length - 1,
      scrollLeft: track.scrollLeft,
      maxScroll: track.scrollWidth - track.clientWidth,
      slide: { l: sr.left, r: sr.right },
      track: { l: tr.left, r: tr.right },
      trailing,
    };
  });
  if (bad.err) throw new Error(`bento last slide @ ${vw}: ${bad.err}`);
  if (bad.idx !== bad.lastIdx) {
    throw new Error(`bento activeIndex ${bad.idx} not last (${bad.lastIdx}) @ ${vw}: ${JSON.stringify(bad)}`);
  }
  if (!bad.inView) {
    throw new Error(`bento last slide not fully in track @ ${vw}: ${JSON.stringify(bad)}`);
  }
  if (bad.trailing.length) {
    throw new Error(`visible elements right of last bento slide @ ${vw}: ${JSON.stringify(bad)}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertGalleryLastSlideInTrack(page, vw) {
  if (![360, 390, 768, 1440].includes(vw)) return;
  await page.evaluate(() => {
    const track = document.getElementById('gallery-track');
    if (track) track.scrollTo({ left: 0, behavior: 'auto' });
  });
  await page.waitForTimeout(120);
  const slideCount = await page.locator('.gallery-slide').count();
  const next = page.locator('#gallery-next');
  for (let i = 0; i < slideCount - 1; i += 1) {
    await next.click({ noWaitAfter: true });
  }
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const track = document.getElementById('gallery-track');
    const slides = [...document.querySelectorAll('.gallery-slide')];
    const last = slides[slides.length - 1];
    if (!track || !last) return;
    const pad = Number.parseFloat(getComputedStyle(track).scrollPaddingInlineStart) || 0;
    track.scrollTo({ left: Math.max(0, track.scrollWidth - track.clientWidth), behavior: 'auto' });
  });
  await page.waitForTimeout(80);
  const bad = await page.evaluate(() => {
    const track = document.getElementById('gallery-track');
    const slides = [...document.querySelectorAll('.gallery-slide')];
    const last = slides[slides.length - 1];
    if (!track || !last) return { err: 'missing track/slide' };
    const tr = track.getBoundingClientRect();
    const sr = last.getBoundingClientRect();
    const inView = sr.left >= tr.left - 4 && sr.right <= tr.right + 4;
    const pad = Number.parseFloat(getComputedStyle(track).scrollPaddingInlineStart) || 0;
    const anchor = track.scrollLeft + pad;
    let idx = 0;
    let best = Infinity;
    slides.forEach((slide, i) => {
      const d = Math.abs(slide.offsetLeft - anchor);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    return {
      inView,
      idx,
      lastIdx: slides.length - 1,
      scrollLeft: track.scrollLeft,
      maxScroll: track.scrollWidth - track.clientWidth,
      slide: { l: sr.left, r: sr.right, w: sr.width },
      track: { l: tr.left, r: tr.right, w: tr.width },
      devW: last.querySelector('.device--section')?.getBoundingClientRect().width,
    };
  });
  if (bad.err) throw new Error(`gallery last slide @ ${vw}: ${bad.err}`);
  if (bad.idx !== bad.lastIdx) {
    throw new Error(`gallery activeIndex ${bad.idx} not last @ ${vw}: ${JSON.stringify(bad)}`);
  }
  if (!bad.inView) {
    throw new Error(`gallery last slide not in track view @ ${vw}: ${JSON.stringify(bad)}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertBentoMobileCarousel(page, vw) {
  const narrow = [360, 390, 768];
  if (!narrow.includes(vw)) return;
  const bad = await page.evaluate(() => {
    const track = document.getElementById('bento-track');
    if (!track) return { err: 'no bento-track' };
    const slides = [...track.querySelectorAll('.bento-carousel-slide')].filter(
      (el) => getComputedStyle(el).display !== 'none',
    );
    if (slides.length < 4) return { err: 'expected 4 carousel slides', n: slides.length };
    const tops = slides.map((s) => s.getBoundingClientRect().top);
    const minT = Math.min(...tops);
    const maxT = Math.max(...tops);
    const doc = document.documentElement;
    const pageOverflow = doc.scrollWidth - doc.clientWidth;
    const trackRect = track.getBoundingClientRect();
    const trackScrollable = track.scrollWidth > track.clientWidth + 4;
    return {
      topSpread: maxT - minT,
      pageOverflow,
      trackScrollable,
      trackClientW: track.clientWidth,
      trackScrollW: track.scrollWidth,
    };
  });
  if (bad.err) throw new Error(`bento carousel @ ${vw}: ${bad.err}`);
  if (bad.topSpread > 2) {
    throw new Error(`bento slide tops misaligned by ${bad.topSpread.toFixed(2)}px @ ${vw}`);
  }
  if (bad.pageOverflow > 2) {
    throw new Error(`page horizontal overflow ${bad.pageOverflow}px @ ${vw}`);
  }
  if (!bad.trackScrollable) {
    throw new Error(`bento track not horizontally scrollable @ ${vw}`);
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
      const screen = root.closest('.device-screen');
      const screenBox = screen?.getBoundingClientRect();
      for (const el of root.querySelectorAll('.watch-nlv, .watch-day, .tick-nums, .watch-smile-title, .watch-fresh')) {
        const text = (el.textContent || '').trim();
        if (!text) continue;
        const er = el.getBoundingClientRect();
        if (screenBox && (er.right > screenBox.right + 1.5 || er.left < screenBox.left - 1.5)) {
          issues.push({
            cls: el.className,
            text: text.slice(0, 28),
            er: { l: er.left, r: er.right },
            screen: { l: screenBox.left, r: screenBox.right },
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

/** @param {import('playwright').Page} page */
export async function assertBentoSlideImagesContained(page, vw) {
  if (![360, 390, 768].includes(vw)) return;
  const bad = await page.evaluate(() => {
    const issues = [];
    const slides = [...document.querySelectorAll('.bento-carousel-slide')].filter(
      (el) => getComputedStyle(el).display !== 'none',
    );
    for (const slide of slides) {
      const st = getComputedStyle(slide);
      const padL = Number.parseFloat(st.paddingLeft) || 0;
      const padR = Number.parseFloat(st.paddingRight) || 0;
      const padT = Number.parseFloat(st.paddingTop) || 0;
      const padB = Number.parseFloat(st.paddingBottom) || 0;
      const sr = slide.getBoundingClientRect();
      const box = {
        left: sr.left + padL,
        right: sr.right - padR,
        top: sr.top + padT,
        bottom: sr.bottom - padB,
      };
      for (const img of slide.querySelectorAll('img')) {
        if (!img.offsetParent && img.getBoundingClientRect().width < 1) continue;
        const ir = img.getBoundingClientRect();
        if (ir.width < 2) continue;
        if (
          ir.left < box.left - 1.5
          || ir.right > box.right + 1.5
          || ir.top < box.top - 1.5
          || ir.bottom > box.bottom + 1.5
        ) {
          issues.push({
            slide: slide.getAttribute('aria-label') || slide.className,
            src: (img.getAttribute('src') || '').split('/').pop(),
            img: { l: ir.left, r: ir.right, t: ir.top, b: ir.bottom },
            box,
          });
        }
      }
    }
    return issues;
  });
  if (bad.length) {
    throw new Error(`bento slide image bleed @ ${vw}: ${JSON.stringify(bad)}`);
  }
}

/** @param {import('playwright').Page} page */
export async function assertGalleryRapidNextToSettings(page, vw) {
  if (vw !== 1440) return;
  await page.evaluate(() => {
    const track = document.getElementById('gallery-track');
    if (track) track.scrollTo({ left: 0, behavior: 'auto' });
  });
  await page.waitForTimeout(120);
  const next = page.locator('#gallery-next');
  for (let i = 0; i < 5; i += 1) {
    await next.click({ noWaitAfter: true });
  }
  await page.waitForTimeout(1000);
  const bad = await page.evaluate(async () => {
    const track = document.getElementById('gallery-track');
    const slides = [...document.querySelectorAll('.gallery-slide')];
    const last = slides[slides.length - 1];
    const img = last?.querySelector('.device-screen img');
    if (!track || !last || !img) return { err: 'missing gallery slide/img' };
    const tr = track.getBoundingClientRect();
    const pad = Number.parseFloat(getComputedStyle(track).scrollPaddingInlineStart) || 0;
    const viewportLeft = tr.left + pad;
    const viewportRight = tr.right;
    const sr = last.getBoundingClientRect();
    const inFrame = sr.left >= viewportLeft - 4 && sr.right <= viewportRight + 4;
    const loaded = img.complete && img.naturalWidth > 0;
    let meanLuma = 0;
    if (loaded) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = Math.min(80, w);
      c.height = Math.min(120, h);
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, w * 0.35, h * 0.2, w * 0.3, h * 0.35, 0, 0, c.width, c.height);
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        let sum = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          n += 1;
        }
        meanLuma = n ? sum / n : 0;
      }
    }
    return {
      inFrame,
      loaded,
      meanLuma,
      scrollLeft: track.scrollLeft,
      maxScroll: track.scrollWidth - track.clientWidth,
      slide: { l: sr.left, r: sr.right },
      view: { l: viewportLeft, r: viewportRight },
    };
  });
  if (bad.err) throw new Error(`gallery rapid next @ ${vw}: ${bad.err}`);
  if (!bad.inFrame) {
    throw new Error(`Settings slide not in frame after 5× next @ ${vw}: ${JSON.stringify(bad)}`);
  }
  if (!bad.loaded || bad.meanLuma < 12) {
    throw new Error(`Settings screen black/unloaded after 5× next @ ${vw}: ${JSON.stringify(bad)}`);
  }
}