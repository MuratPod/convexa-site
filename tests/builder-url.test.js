import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseBuilderPath,
  encodePath,
  encodeState,
  decodeState,
  parseOcc,
  formatOcc,
  normalizeSlug,
  buildTemplate,
  expiryNearDays,
  uniqueExpiries,
} from "../public/builder/strategies.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const qqq = JSON.parse(readFileSync(join(root, "tests/fixtures/qqq-chain.json"), "utf8"));

describe("OCC compact tokens", () => {
  it("round-trips a QQQ put", () => {
    const token = formatOcc("QQQ", "2026-12-24", "P", 560);
    assert.equal(token, "QQQ261224P560");
    assert.deepEqual(parseOcc(token), { symbol: "QQQ", expiry: "2026-12-24", type: "P", strike: 560 });
  });
});

describe("builder paths are locked to QQQ", () => {
  it("defaults /builder to iron condor on QQQ", () => {
    const p = parseBuilderPath("/builder");
    assert.equal(p.template, "iron-condor");
    assert.equal(p.symbol, "QQQ");
  });

  it("parses /builder/iron-condor without a ticker", () => {
    const p = parseBuilderPath("/builder/iron-condor");
    assert.equal(p.template, "iron-condor");
    assert.equal(p.symbol, "QQQ");
    assert.equal(p.legs, null);
  });

  it("parses /builder/iron-condor/QQQ and compact legs", () => {
    const p = parseBuilderPath("/builder/iron-condor/QQQ/.QQQ261224P560,-.QQQ261224C635");
    assert.equal(p.template, "iron-condor");
    assert.equal(p.symbol, "QQQ");
    assert.equal(p.entries.length, 2);
    assert.equal(p.entries[0].side, "buy");
    assert.equal(p.entries[0].type, "P");
    assert.equal(p.entries[0].strike, 560);
    assert.equal(p.entries[1].side, "sell");
    assert.equal(p.entries[1].type, "C");
    assert.equal(p.entries[1].strike, 635);
  });

  it("forces QQQ even if another ticker appears in the path", () => {
    const p = parseBuilderPath("/builder/straddle/AAPL/.AAPL261218C150");
    assert.equal(p.symbol, "QQQ");
    assert.equal(p.template, "straddle");
  });

  it("treats /builder/QQQ as the default template", () => {
    const p = parseBuilderPath("/builder/QQQ");
    assert.equal(p.template, "iron-condor");
    assert.equal(p.symbol, "QQQ");
  });

  it("encodes legs as a compact path and always uses QQQ", () => {
    const path = encodePath({
      template: "iron-condor",
      symbol: "AAPL",
      legs: [
        { side: "buy", qty: 1, type: "P", expiry: "2026-12-24", strike: 560, kind: "option" },
        { side: "sell", qty: 1, type: "P", expiry: "2026-12-24", strike: 585, kind: "option" },
        { side: "sell", qty: 1, type: "C", expiry: "2026-12-24", strike: 635, kind: "option" },
        { side: "buy", qty: 1, type: "C", expiry: "2026-12-24", strike: 660, kind: "option" },
      ],
    });
    assert.equal(path, "/builder/iron-condor/QQQ/.QQQ261224P560,-.QQQ261224P585,-.QQQ261224C635,.QQQ261224C660");
    const again = parseBuilderPath(path);
    assert.equal(again.entries.length, 4);
    assert.equal(encodeState({ template: "iron-condor", legs: again.entries }), path);
  });

  it("keeps a v1 query-string fallback and still locks the symbol", () => {
    const s = decodeState("?s=AAPL&t=long_straddle", "/builder");
    assert.equal(s.symbol, "QQQ");
    assert.equal(s.template, "straddle");
  });
});

describe("templates", () => {
  it("normalizes v1 ids", () => {
    assert.equal(normalizeSlug("iron_condor"), "iron-condor");
    assert.equal(normalizeSlug("long_call"), "long-call");
  });

  it("builds a four-leg iron condor near 30 days on the QQQ fixture", () => {
    const exp = "2026-12-18";
    const legs = buildTemplate("iron-condor", { chain: qqq, spot: qqq.price, expiry: exp, style: "american" });
    assert.equal(legs.length, 4);
    const sides = legs.map((l) => l.side + l.type).sort();
    assert.deepEqual(sides, ["buyC", "buyP", "sellC", "sellP"]);
    for (const l of legs) {
      assert.equal(l.expiry, exp);
      assert.ok(Number(l.strike) > 0);
    }
  });

  it("builds a custom book as no legs", () => {
    const legs = buildTemplate("custom", { chain: qqq, spot: qqq.price, expiry: qqq.expirations[5], style: "american" });
    assert.equal(legs.length, 0);
  });
});

describe("custom prices in the path", () => {
  it("encodes a custom price with @ and the custom slug", () => {
    const path = encodePath({
      template: "custom",
      symbol: "QQQ",
      legs: [
        { side: "buy", qty: 1, type: "C", expiry: "2026-12-24", strike: 610, kind: "option", customPrice: 10 },
      ],
    });
    assert.equal(path, "/builder/custom/QQQ/.QQQ261224C610@10");
  });

  it("parses @price back onto the entry", () => {
    const p = parseBuilderPath("/builder/custom/QQQ/.QQQ261224C610@10");
    assert.equal(p.template, "custom");
    assert.equal(p.entries.length, 1);
    assert.equal(p.entries[0].strike, 610);
    assert.equal(p.entries[0].customPrice, 10);
  });
});
