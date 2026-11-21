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