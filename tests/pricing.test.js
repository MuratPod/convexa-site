import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normCdf,
  blackScholesPrice,
  blackScholesGreeks,
  optionPrice,
  optionGreeks,
  impliedVol,
  chanceOfProfit,
  summarizePayoff,
  expiryPayoff,
  yearsUntil,
  expiryCloseUtc,
} from "../public/builder/pricing.js";

const almost = (a, b, eps = 1e-4) => {
  assert.ok(Number.isFinite(a), `not finite: ${a} (expected ${b})`);
  assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (eps ${eps}, err ${Math.abs(a - b)})`);
};

describe("normCdf", () => {
  it("matches known values", () => {
    almost(normCdf(0), 0.5, 1e-7);
    almost(normCdf(1.96), 0.9750021, 5e-6);
    almost(normCdf(-1.96), 0.0249979, 5e-6);
    almost(normCdf(Infinity), 1, 1e-12);
  });
});

describe("Black-Scholes textbook values", () => {
  // S=100, K=100, T=1, r=0.05, q=0, σ=0.20
  // Call ≈ 10.450583572, Put ≈ 5.573526022
  const args = [100, 100, 1, 0.05, 0, 0.2];
  it("prices the ATM 1y 20% call and put", () => {
    almost(blackScholesPrice(...args, "call"), 10.450583572, 1e-4);
    almost(blackScholesPrice(...args, "put"), 5.573526022, 1e-4);
  });

  it("obeys put-call parity for a range of spots and yields", () => {
    for (const S of [80, 100, 125]) {
      for (const q of [0, 0.02, 0.05]) {
        for (const T of [0.05, 0.5, 2]) {
          const c = blackScholesPrice(S, 100, T, 0.05, q, 0.25, "call");
          const p = blackScholesPrice(S, 100, T, 0.05, q, 0.25, "put");
          const parity = S * Math.exp(-q * T) - 100 * Math.exp(-0.05 * T);
          almost(c - p, parity, 1e-6);
        }
      }
    }
  });
});

describe("European greeks vs finite differences", () => {
  const S = 100, K = 105, T = 0.4, r = 0.03, q = 0.01, sigma = 0.28;
  it("delta, vega, gamma, rho, theta stay close to FD", () => {
    const g = blackScholesGreeks(S, K, T, r, q, sigma, "call");
    const dS = 0.01;
    const fdDelta = (blackScholesPrice(S + dS, K, T, r, q, sigma, "call")
      - blackScholesPrice(S - dS, K, T, r, q, sigma, "call")) / (2 * dS);
    almost(g.delta, fdDelta, 5e-5);

    const fdGamma = (blackScholesPrice(S + dS, K, T, r, q, sigma, "call")
      - 2 * g.price
      + blackScholesPrice(S - dS, K, T, r, q, sigma, "call")) / (dS * dS);
    almost(g.gamma, fdGamma, 5e-5);

    const dSig = 1e-5;
    const fdVega = (blackScholesPrice(S, K, T, r, q, sigma + dSig, "call")
      - blackScholesPrice(S, K, T, r, q, sigma - dSig, "call")) / (2 * dSig);
    almost(g.vega, fdVega, 5e-4);

    const dR = 1e-5;
    const fdRho = (blackScholesPrice(S, K, T, r + dR, q, sigma, "call")
      - blackScholesPrice(S, K, T, r - dR, q, sigma, "call")) / (2 * dR);
    almost(g.rho, fdRho, 5e-4);

    const dT = 1e-5;
    const fdThetaYr = (blackScholesPrice(S, K, T - dT, r, q, sigma, "call")
      - blackScholesPrice(S, K, T, r, q, sigma, "call")) / dT;
    almost(g.theta * 365.25, fdThetaYr, 5e-3);
  });
});

describe("implied vol solver", () => {
  it("recovers the sigma that generated a European mid", () => {
    for (const sigma of [0.08, 0.2, 0.5, 1.1]) {
      for (const type of ["call", "put"]) {
        const mid = blackScholesPrice(100, 100, 0.6, 0.04, 0.01, sigma, type);
        const iv = impliedVol({ mid, S: 100, K: 100, T: 0.6, r: 0.04, q: 0.01, type, style: "european" });
        almost(iv, sigma, 5e-4);
      }
    }
  });
});

describe("American vs European", () => {
  it("a non-dividend American call matches the European call", () => {
    const euro = blackScholesPrice(100, 100, 0.5, 0.05, 0, 0.2, "call");
    const amer = optionPrice(100, 100, 0.5, 0.05, 0, 0.2, "call", "american");
    almost(amer, euro, 1e-3);
  });

  it("an American put on a non-dividend name is worth at least the European put and at least intrinsic", () => {
    // Deep ITM short-dated put: early exercise premium is material.
    const S = 80, K = 100, T = 0.25, r = 0.08, q = 0, sigma = 0.2;
    const euro = blackScholesPrice(S, K, T, r, q, sigma, "put");
    const amer = optionPrice(S, K, T, r, q, sigma, "put", "american");
    assert.ok(amer >= euro - 1e-6, `american ${amer} < euro ${euro}`);
    assert.ok(amer >= K - S - 1e-6, `american ${amer} < intrinsic ${K - S}`);
    assert.ok(amer - euro > 0.2, `expected a visible early-exercise premium, got ${amer - euro}`);
  });

  it("American greeks are close to finite differences", () => {
    const S = 90, K = 100, T = 0.4, r = 0.05, q = 0, sigma = 0.25;
    const g = optionGreeks(S, K, T, r, q, sigma, "put", "american");
    const dS = 0.05;
    const fdDelta = (optionPrice(S + dS, K, T, r, q, sigma, "put", "american")
      - optionPrice(S - dS, K, T, r, q, sigma, "put", "american")) / (2 * dS);
    almost(g.delta, fdDelta, 2e-3);
  });
});

describe("payoff summary", () => {
  it("a long 100-strike call bought at 10 has max loss of $1,000 and unlimited profit", () => {
    const legs = [{ type: "C", side: "buy", qty: 1, strike: 100, expiry: "2027-12-17", entry: 10, iv: 0.2 }];
    const s = summarizePayoff(legs, { spot: 100, r: 0.05, q: 0, timeMs: Date.now() });
    almost(s.maxLoss, -1000, 1);
    assert.equal(s.maxProfit, Infinity);
    assert.ok(s.breakevens.length >= 1);
    almost(s.breakevens[0], 110, 0.2);
  });

  it("a 95/105 short put vertical (credit 3) has finite max profit and loss", () => {
    const legs = [
      { type: "P", side: "sell", qty: 1, strike: 105, expiry: "2027-12-17", entry: 7, iv: 0.2 },
      { type: "P", side: "buy", qty: 1, strike: 95, expiry: "2027-12-17", entry: 4, iv: 0.2 },
    ];
    const s = summarizePayoff(legs, { spot: 100, r: 0.05, q: 0, timeMs: Date.now() });
    // credit 3 → max profit 300, width 10 → max loss 700
    almost(s.netCredit, 300, 1);
    almost(s.maxProfit, 300, 2);
    almost(s.maxLoss, -700, 2);
  });

  it("expiry payoff of a long call is intrinsic minus debit", () => {
    const legs = [{ type: "C", side: "buy", qty: 1, strike: 100, expiry: "2027-12-17", entry: 5, iv: 0.2 }];
    almost(expiryPayoff(legs, 120), 1500, 1e-6);
    almost(expiryPayoff(legs, 90), -500, 1e-6);
  });
});

describe("chance of profit", () => {
  it("is around half for a zero-premium ATM straddle in a zero-rate world, and higher for a debit-free long call? wait — long ATM call with debit has COP ~ N(d2) < 0.5", () => {
    const mid = blackScholesPrice(100, 100, 0.5, 0, 0, 0.2, "call");
    const legs = [{ type: "C", side: "buy", qty: 1, strike: 100, expiry: "2027-05-21", entry: mid, iv: 0.2, style: "european" }];
    // Force T = 0.5 by using a fixed now relative to expiry 16:00 ET
    const end = expiryCloseUtc("2027-05-21");
    const now = end - 0.5 * 365.25 * 24 * 3600 * 1000;
    const { p, summary } = chanceOfProfit(legs, { spot: 100, r: 0, q: 0, timeMs: now, sigma: 0.2 });
    // P(S_T > 100+mid) = N(-d) with d = [ln(100/(100+mid)) + ( - 0.5 σ²)T] / (σ√T)
    assert.ok(p > 0.3 && p < 0.5, `COP ${p} summary be ${summary.breakevens}`);
  });
});

describe("yearsUntil", () => {
  it("is zero after the listed expiry close", () => {
    const t = expiryCloseUtc("2020-01-17");
    assert.ok(t < Date.now());
    almost(yearsUntil("2020-01-17", Date.now()), 0, 0);
  });
});
