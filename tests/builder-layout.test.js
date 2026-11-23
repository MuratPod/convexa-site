import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultRangeForDte,
  tableRowPrices,
  tableRowStep,
  formatTablePrice,
  sampleTradingDates,
  midTime75,
  shiftDateKeepRemaining,
  rulerWindow,
  signedStep,
  parseSignedQty,
  RANGE_MIN,
  RANGE_MAX,
  QTY_MAX,
  TABLE_ROWS,
} from "../public/builder/layout.js";
import { encodePath, parseBuilderPath } from "../public/builder/strategies.js";

describe("range defaults and bounds", () => {
  it("uses ±12% near 32d and ±14% near 54d", () => {
    assert.equal(defaultRangeForDte(32), 0.12);
    assert.equal(defaultRangeForDte(26), 0.12);
    assert.equal(defaultRangeForDte(54), 0.14);
    assert.equal(defaultRangeForDte(60), 0.14);
  });
  it("exposes the addendum min/max", () => {
    assert.equal(RANGE_MIN, 0.011);
    assert.equal(RANGE_MAX, 0.98);
  });
});

describe("table row formula", () => {
  it("always returns 21 rows from spot(1+r) to spot(1−r)", () => {
    const spot = 608.45;
    const r = 0.12;
    const rows = tableRowPrices(spot, r);
    assert.equal(rows.length, TABLE_ROWS);
    assert.ok(Math.abs(rows[0] - spot * (1 + r)) < 1e-9);
    assert.ok(Math.abs(rows[20] - spot * (1 - r)) < 1e-9);
    assert.ok(Math.abs(rows[10] - spot) < 1e-9);
    assert.ok(Math.abs(tableRowStep(spot, r) - (rows[0] - rows[1])) < 1e-9);
  });
  it("matches the recorded end prices at ±12% and ±98%", () => {
    const spot = 608.45;
    const at12 = tableRowPrices(spot, 0.12);
    // Recorded ends were ~$682 / $535; 608.45×1.12 rounds to 681 with 0 decimals.
    assert.ok(Math.abs(Number(formatTablePrice(at12[0], tableRowStep(spot, 0.12))) - 682) <= 1);
    assert.ok(Math.abs(Number(formatTablePrice(at12[20], tableRowStep(spot, 0.12))) - 535) <= 1);
    const at98 = tableRowPrices(spot, 0.98);
    assert.ok(Math.abs(Number(formatTablePrice(at98[0], tableRowStep(spot, 0.98))) - 1205) <= 1);
    assert.ok(Math.abs(Number(formatTablePrice(at98[20], tableRowStep(spot, 0.98))) - 12) <= 1);
  });
});

describe("table date sampling", () => {
  it("keeps first and last, dedupes, and stays within max", () => {
    const days = [];
    const t0 = Date.parse("2026-11-23T16:00:00-05:00");
    for (let i = 0; i < 40; i++) days.push(t0 + i * 86400000);
    const cols = sampleTradingDates(days, 21);
    assert.ok(cols.length <= 21);
    assert.equal(cols[0], days[0]);
    assert.equal(cols[cols.length - 1], days[days.length - 1]);
    assert.equal(new Set(cols).size, cols.length);
  });
  it("returns the list unchanged when already short", () => {
    const days = [1, 2, 3];
    assert.deepEqual(sampleTradingDates(days, 21), days);
  });
});

describe("date / mid-curve helpers", () => {
  it("places the dashed curve at 75% of time to expiry", () => {
    const now = 0;
    const exp = 32 * 86400000;
    const mid = midTime75(now, exp);
    assert.equal(mid, 0.75 * exp);
    const days = mid / 86400000;
    assert.ok(Math.abs(days - 24) < 1e-9);
  });
  it("keeps days-remaining when the expiry moves", () => {
    const now = Date.parse("2026-11-23T16:00:00-05:00");
    const oldExp = now + 32 * 86400000;
    const date = now + 14 * 86400000; // 18d remaining? 32-14=18
    // 17d remaining as in the addendum: date = Dec 7 ≈ 14d, remaining 17d
    const date2 = oldExp - 17 * 86400000;
    const newExp = now + 26 * 86400000;
    const next = shiftDateKeepRemaining(date2, oldExp, newExp, now);
    const rem = Math.round((newExp - next) / 86400000);
    assert.equal(rem, 17);
    const fromNow = Math.round((next - now) / 86400000);
    assert.equal(fromNow, 9); // 26-17=9; addendum said 8d-of-26 with slightly different clock
  });
  it("clamps to now when remaining would precede now", () => {
    const now = 1000;
    const next = shiftDateKeepRemaining(100, 2000, 1500, now);
    assert.equal(next, now);
  });
});

describe("qty stepper and parse", () => {
  it("skips 0 and flips sign between -1 and +1", () => {
    assert.equal(signedStep(1, -1), -1);
    assert.equal(signedStep(-1, 1), 1);
    assert.equal(signedStep(-1, -1), -2);
    assert.equal(signedStep(1, 1), 2);
  });
  it("clamps at QTY_MAX and rejects invalid typed values", () => {
    assert.equal(QTY_MAX, 4999);
    assert.equal(signedStep(4999, 1), 4999);
    assert.equal(signedStep(-4999, -1), -4999);
    assert.equal(parseSignedQty("2000"), 2000);
    assert.equal(parseSignedQty("-4"), -4);
    assert.equal(parseSignedQty("0"), null);
    assert.equal(parseSignedQty("5000"), null);
    assert.equal(parseSignedQty("nope"), null);
  });
});

describe("ruler window", () => {
  it("is about 520–690 at 32d and 380–840 at 54d for spot 608.45", () => {
    const a = rulerWindow(608.45, 32);
    const b = rulerWindow(608.45, 54);
    assert.ok(Math.abs(a.lo - 520) <= 10, JSON.stringify(a));
    assert.ok(Math.abs(a.hi - 690) <= 20, JSON.stringify(a));
    assert.ok(Math.abs(b.lo - 380) <= 10, JSON.stringify(b));
    assert.ok(Math.abs(b.hi - 840) <= 10, JSON.stringify(b));
  });
});

describe("URL qty suffix xN", () => {
  it("encodes qty as xN, omits x1, and prefixes shorts with -.", () => {
    const path = encodePath({
      template: "custom",
      symbol: "QQQ",
      legs: [
        { side: "buy", qty: 1, type: "P", expiry: "2026-12-24", strike: 560, kind: "option" },
        { side: "sell", qty: 100, type: "P", expiry: "2026-12-24", strike: 585, kind: "option" },
      ],
    });
    assert.equal(path, "/builder/custom/QQQ/.QQQ261224P560,-.QQQ261224P585x100");
  });
  it("parses xN and still accepts the older prefix form", () => {
    const a = parseBuilderPath("/builder/custom/QQQ/.QQQ261224P585x100");
    assert.equal(a.entries[0].qty, 100);
    assert.equal(a.entries[0].side, "buy");
    const b = parseBuilderPath("/builder/custom/QQQ/-.QQQ261224P585x4@10");
    assert.equal(b.entries[0].qty, 4);
    assert.equal(b.entries[0].side, "sell");
    assert.equal(b.entries[0].customPrice, 10);
    const c = parseBuilderPath("/builder/iron-condor/QQQ/-2.QQQ261224P585");
    assert.equal(c.entries[0].qty, 2);
    assert.equal(c.entries[0].side, "sell");
  });
});
