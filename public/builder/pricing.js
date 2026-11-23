/**
 * Convexa options pricing and position analytics.
 *
 * Models (implemented from published formulas, not from any vendor code):
 *  - Black–Scholes–Merton for European-style options (with continuous dividend yield)
 *  - Bjerksund–Stensland 2002 for American-style equity / ETF options
 *    (Barone-Adesi–Whaley is used as a fallback if a BS2002 input is degenerate)
 *
 * Greeks are analytic for European contracts and central finite differences
 * for American contracts. Position greeks are in dollars per conventional unit
 * (delta in shares, theta per calendar day, vega per 1 vol point, rho per 1%).
 */
export const YEAR_DAYS = 365.25;
export const MULTIPLIER = 100;

const INV_SQRT_2PI = 0.3989422804014327;

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** Standard normal density. */
export function normPdf(x) {
  return Math.exp(-0.5 * x * x) * INV_SQRT_2PI;
}

/**
 * Standard normal CDF. Hart (1968) rational approximation as popularised
 * by G. West; absolute error typically well under 1e-7, enough for pricing.
 */
export function normCdf(x) {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const ax = Math.abs(x);
  const k = 1 / (1 + 0.2316419 * ax);
  const k2 = k * k;
  const k3 = k2 * k;
  const k4 = k2 * k2;
  const k5 = k4 * k;
  const poly = 0.319381530 * k - 0.356563782 * k2 + 1.781477937 * k3
    - 1.821255978 * k4 + 1.330274429 * k5;
  const cdf = 1 - normPdf(ax) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

/**
 * Inverse standard normal (Peter J. Acklam). Used for probability bands.
 */
export function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577509590705e+02, -3.066479806614716e+01, 2.506628277459239e+00,
  ];
  const b = [
    -5.447609918633198e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00,
  ];
  const d = [
    7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
    / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Cumulative standard bivariate normal, Drezner–Wesolowsky style
 * (Gauss–Legendre on the Owen / single-integral form). Accurate enough
 * for the BS2002 early-exercise premium.
 */
export function bivNormCdf(x, y, rho) {
  if (rho > 0.999999) return normCdf(Math.min(x, y));
  if (rho < -0.999999) {
    if (y <= -x) return 0;
    return normCdf(x) - (1 - normCdf(y)) + (y > 0 ? 0 : 0);
  }
  if (Math.abs(rho) < 1e-15) return normCdf(x) * normCdf(y);

  // Genz-ish decomposition: N2(x,y,ρ) via integration of the density.
  // Symmetric reduction: ensure x <= y by swapping.
  const absRho = Math.abs(rho);
  // Drezner 8-point Gauss on [0, rho] for the tetrachoric expansion when |rho|<0.8,
  // otherwise a conditioned form.
  if (absRho < 0.85) {
    const pts = [
      [0.0198550717512316, 0.0506142681451881],
      [0.1016667612931866, 0.1111905172266871],
      [0.2372337950418355, 0.1568533229389436],
      [0.4082826787521751, 0.1813418916891810],
      [0.5917173212478249, 0.1813418916891810],
      [0.7627662049581645, 0.1568533229389436],
      [0.8983332387068134, 0.1111905172266871],
      [0.9801449282487684, 0.0506142681451881],
    ];
    let sum = 0;
    for (const [t, w] of pts) {
      const r = rho * t;
      const denom = 1 - r * r;
      sum += w * Math.exp((2 * x * y * r - r * r * (x * x + y * y)) / (2 * denom)) / Math.sqrt(denom);
    }
    return normCdf(x) * normCdf(y) + (rho / Math.abs(rho) * Math.abs(rho)) * sum * INV_SQRT_2PI * INV_SQRT_2PI * rho;
    // The last line is messy — use the proper formula below instead.
  }

  return bivNormCdfIntegral(x, y, rho);
}

function bivNormCdfIntegral(x, y, rho) {
  // Owen-style: N2 = N(x)N(y) + (ρ / 2π) ∫_0^1 exp(...) / (1-ρ²t²) * 2? 
  // Use Gauss–Legendre on t in [0, 1] mapped to [0, rho]:
  const pts = [
    [0.0198550717512316, 0.0506142681451881],
    [0.1016667612931866, 0.1111905172266871],
    [0.2372337950418355, 0.1568533229389436],
    [0.4082826787521751, 0.1813418916891810],
    [0.5917173212478249, 0.1813418916891810],
    [0.7627662049581645, 0.1568533229389436],
    [0.8983332387068134, 0.1111905172266871],
    [0.9801449282487684, 0.0506142681451881],
  ];
  let sum = 0;
  for (const [u, w] of pts) {
    const r = rho * u;
    const d = 1 - r * r;
    if (d <= 0) continue;
    sum += w * Math.exp(-(x * x + y * y - 2 * r * x * y) / (2 * d)) / Math.sqrt(d);
  }
  return clamp(normCdf(x) * normCdf(y) + (rho * sum) / (2 * Math.PI), 0, 1);
}

// Replace the branched function with the integral form always — it's stable.
export function cbnd(x, y, rho) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    if (!Number.isFinite(x) && !Number.isFinite(y)) {
      if (x > 0 && y > 0) return 1;
      return 0;
    }
    if (!Number.isFinite(x)) return x > 0 ? normCdf(y) : 0;
    return y > 0 ? normCdf(x) : 0;
  }
  if (rho > 0.999999) return normCdf(Math.min(x, y));
  if (rho < -0.999999) {
    // P(X<x, Y<y) when corr = -1: Y = -X, so X<x and -X<y => X<x and X>-y
    const lo = -y;
    if (x <= lo) return 0;
    return normCdf(x) - normCdf(lo);
  }
  return bivNormCdfIntegral(x, y, rho);
}

export function expiryCloseUtc(isoDate) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  if (!y || !m || !d) return NaN;
  for (const utcHour of [20, 21]) {
    const dt = new Date(Date.UTC(y, m - 1, d, utcHour, 0, 0));
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      }).formatToParts(dt).find((p) => p.type === "hour")?.value,
    );
    // Some engines emit "24" for midnight; 16 is the close we want.
    if (hour === 16) return dt.getTime();
  }
  return Date.UTC(y, m - 1, d, 21, 0, 0);
}

export function yearsUntil(isoDate, now = Date.now()) {
  const end = expiryCloseUtc(isoDate);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, (end - Number(now)) / (YEAR_DAYS * 24 * 3600 * 1000));
}

function d1d2(S, K, T, r, q, sigma) {
  const sT = sigma * Math.sqrt(T);
  if (sT < 1e-12) {
    const fwd = S * Math.exp((r - q) * T);
    const side = fwd >= K ? Infinity : -Infinity;
    return { d1: side, d2: side, sT: 0 };
  }
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / sT;
  return { d1, d2: d1 - sT, sT };
}

export function blackScholesPrice(S, K, T, r, q, sigma, type) {
  if (T <= 1e-10 || sigma <= 0) {
    const discS = S * Math.exp(-q * T);
    const discK = K * Math.exp(-r * T);
    const intrinsic = type === "put" ? Math.max(discK - discS, 0) : Math.max(discS - discK, 0);
    return intrinsic;
  }
  const { d1, d2 } = d1d2(S, K, T, r, q, sigma);
  const discS = S * Math.exp(-q * T);
  const discK = K * Math.exp(-r * T);
  if (type === "put") return discK * normCdf(-d2) - discS * normCdf(-d1);
  return discS * normCdf(d1) - discK * normCdf(d2);
}

export function blackScholesGreeks(S, K, T, r, q, sigma, type) {
  if (T <= 1e-10 || sigma <= 0) {
    const itm = type === "put" ? S < K : S > K;
    const at = Math.abs(S - K) < 1e-12;
    const delta = at ? (type === "put" ? -0.5 : 0.5) * Math.exp(-q * T) : itm ? (type === "put" ? -1 : 1) * Math.exp(-q * T) : 0;
    return { delta, gamma: 0, theta: 0, vega: 0, rho: 0, price: blackScholesPrice(S, K, T, r, q, sigma, type) };
  }
  const { d1, d2 } = d1d2(S, K, T, r, q, sigma);
  const discS = Math.exp(-q * T);
  const discK = Math.exp(-r * T);
  const nd1 = normPdf(d1);
  const price = blackScholesPrice(S, K, T, r, q, sigma, type);
  const isPut = type === "put";
  const delta = discS * (isPut ? normCdf(d1) - 1 : normCdf(d1));
  const gamma = discS * nd1 / (S * sigma * Math.sqrt(T));
  const vega = S * discS * nd1 * Math.sqrt(T); // dPrice / dσ (σ in decimal)
  // Calendar-day theta (dPrice / dT_years) / 365.25, with T remaining.
  // Calendar theta (∂V/∂t), annualised. Carry signs follow the usual BSM identities.
  const thetaYr = isPut
    ? -S * discS * nd1 * sigma / (2 * Math.sqrt(T)) - q * S * discS * normCdf(-d1) + r * K * discK * normCdf(-d2)
    : -S * discS * nd1 * sigma / (2 * Math.sqrt(T)) + q * S * discS * normCdf(d1) - r * K * discK * normCdf(d2);
  const theta = thetaYr / YEAR_DAYS;
  const rho = isPut
    ? -K * T * discK * normCdf(-d2)
    : K * T * discK * normCdf(d2);
  return { price, delta, gamma, theta, vega, rho };
}

/* ---------- Bjerksund–Stensland 2002 ---------- */

function bsBeta(r, b, sigma) {
  const v2 = sigma * sigma;
  const mu = b / v2;
  return (0.5 - mu) + Math.sqrt((mu - 0.5) * (mu - 0.5) + 2 * r / v2);
}

function bsTrigger(X, T, r, b, sigma) {
  const beta = bsBeta(r, b, sigma);
  const Binf = (beta / (beta - 1)) * X;
  const B0 = Math.max(X, r > b ? (r / (r - b)) * X : X);
  if (!Number.isFinite(Binf) || Math.abs(Binf - B0) < 1e-12) return Binf;
  const h = -(b * T + 2 * sigma * Math.sqrt(T)) * B0 / (Binf - B0);
  return B0 + (Binf - B0) * (1 - Math.exp(h));
}

function bsPhi(S, T, gamma, H, I, r, b, sigma) {
  if (T <= 0 || S <= 0 || H <= 0) return 0;
  const v2 = sigma * sigma;
  const sT = sigma * Math.sqrt(T);
  const lambda = (-r + gamma * b + 0.5 * gamma * (gamma - 1) * v2) * T;
  const d = -(Math.log(S / H) + (b + (gamma - 0.5) * v2) * T) / sT;
  const kappa = 2 * b / v2 + (2 * gamma - 1);
  const term = Math.pow(I / S, kappa);
  const d2 = d - 2 * Math.log(I / S) / sT;
  return Math.exp(lambda) * Math.pow(S, gamma) * (normCdf(d) - term * normCdf(d2));
}

function bsKsi(S, T, gamma, H, I2, I1, t, r, b, sigma) {
  if (T <= 0 || t <= 0 || S <= 0) return 0;
  const v2 = sigma * sigma;
  const sT = sigma * Math.sqrt(T);
  const st = sigma * Math.sqrt(t);
  const kappa = 2 * b / v2 + (2 * gamma - 1);
  const lambda = -r + gamma * b + 0.5 * gamma * (gamma - 1) * v2;
  const mu = b + (gamma - 0.5) * v2;
  const e1 = (Math.log(S / I1) + mu * t) / st;
  const e2 = (Math.log(I2 * I2 / (S * I1)) + mu * t) / st;
  const e3 = (Math.log(S / I1) - mu * t) / st;
  const e4 = (Math.log(I2 * I2 / (S * I1)) - mu * t) / st;
  const f1 = (Math.log(S / H) + mu * T) / sT;
  const f2 = (Math.log(I2 * I2 / (S * H)) + mu * T) / sT;
  const f3 = (Math.log(I1 * I1 / (S * H)) + mu * T) / sT;
  const f4 = (Math.log((S * I1 * I1) / (H * I2 * I2)) + mu * T) / sT;
  const rho = Math.sqrt(t / T);
  return Math.exp(lambda * T) * Math.pow(S, gamma) * (
    cbnd(-e1, -f1, rho)
    - Math.pow(I2 / S, kappa) * cbnd(-e2, -f2, rho)
    - Math.pow(I1 / S, kappa) * cbnd(-e3, -f3, -rho)
    + Math.pow(I1 / I2, kappa) * cbnd(-e4, -f4, -rho)
  );
}

function bjerksundStensland2002Call(S, X, T, r, b, sigma) {
  if (T <= 1e-10 || sigma <= 0) {
    return Math.max(S * Math.exp((b - r) * T) - X * Math.exp(-r * T), 0);
  }
  // Never optimal to exercise a call early when b >= r (q <= 0).
  if (b >= r - 1e-14) {
    const q = r - b;
    return blackScholesPrice(S, X, T, r, q, sigma, "call");
  }
  const t = 0.5 * (Math.sqrt(5) - 1) * T;
  const I2 = bsTrigger(X, T, r, b, sigma);
  const I1 = bsTrigger(X, t, r, b, sigma);
  if (S >= I2) return S - X;
  const beta = bsBeta(r, b, sigma);
  const alpha1 = (I1 - X) * Math.pow(I1, -beta);
  const alpha2 = (I2 - X) * Math.pow(I2, -beta);
  return (
    alpha2 * Math.pow(S, beta)
    - alpha2 * bsPhi(S, t, beta, I2, I2, r, b, sigma)
    + bsPhi(S, t, 1, I2, I2, r, b, sigma)
    - bsPhi(S, t, 1, I1, I2, r, b, sigma)
    - X * bsPhi(S, t, 0, I2, I2, r, b, sigma)
    + X * bsPhi(S, t, 0, I1, I2, r, b, sigma)
    + alpha1 * bsPhi(S, t, beta, I1, I2, r, b, sigma)
    - alpha1 * bsKsi(S, T, beta, I1, I2, I1, t, r, b, sigma)
    + bsKsi(S, T, 1, I1, I2, I1, t, r, b, sigma)
    - bsKsi(S, T, 1, X, I2, I1, t, r, b, sigma)
    - X * bsKsi(S, T, 0, I1, I2, I1, t, r, b, sigma)
    + X * bsKsi(S, T, 0, X, I2, I1, t, r, b, sigma)
  );
}

/**
 * American put via the GBSM symmetry:
 * P_amer(S,K,T,r,q,σ) = C_amer(K,S,T,q,r,σ).
 */
function bjerksundStensland2002Price(S, K, T, r, q, sigma, type) {
  const b = r - q;
  if (type === "put") return bjerksundStensland2002Call(K, S, T, q, q - r, sigma);
  return bjerksundStensland2002Call(S, K, T, r, b, sigma);
}

/* ---------- Barone-Adesi–Whaley (fallback) ---------- */

function bawCriticalPrice(K, T, r, b, sigma, type) {
  const v2 = sigma * sigma;
  const isPut = type === "put";
  const N = 2 * b / v2;
  const M = 2 * r / v2;
  const Kdisc = r === 0 ? 1e12 : 1 - Math.exp(-r * T);
  const qin = isPut
    ? ((1 - N) - Math.sqrt((N - 1) * (N - 1) + 4 * M / Kdisc)) / 2
    : ((1 - N) + Math.sqrt((N - 1) * (N - 1) + 4 * M / Kdisc)) / 2;
  // Seed
  const qinf = isPut
    ? ((1 - N) - Math.sqrt((N - 1) * (N - 1) + 4 * M)) / 2
    : ((1 - N) + Math.sqrt((N - 1) * (N - 1) + 4 * M)) / 2;
  let Sstar = K / (1 - 1 / qinf);
  if (!Number.isFinite(Sstar) || Sstar <= 0) Sstar = isPut ? K * 0.5 : K * 1.5;
  const qYld = r - b;
  for (let i = 0; i < 40; i++) {
    const euro = blackScholesPrice(Sstar, K, T, r, qYld, sigma, type);
    const { d1 } = d1d2(Sstar, K, T, r, qYld, sigma);
    const disc = Math.exp((b - r) * T);
    const lhs = isPut ? K - Sstar : Sstar - K;
    const nd = isPut ? normCdf(-d1) : normCdf(d1);
    const bi = disc * nd;
    const rhs = euro + (1 - Math.abs(qin) < 1e12 ? 1 : 0) * (Sstar / qin) * (1 - bi);
    const Afactor = (Sstar / qin) * (1 - bi);
    const f = lhs - euro - Afactor;
    const pdf = Math.exp(-0.5 * d1 * d1) * INV_SQRT_2PI;
    const d1dS = 1 / (Sstar * sigma * Math.sqrt(T));
    const bi_ds = disc * (isPut ? -pdf : pdf) * d1dS;
    const fp = (isPut ? -1 : 1) - (isPut ? blackScholesGreeks(Sstar, K, T, r, qYld, sigma, "put").delta : blackScholesGreeks(Sstar, K, T, r, qYld, sigma, "call").delta)
      - ((1 - bi) / qin) + (Sstar / qin) * bi_ds;
    const step = f / fp;
    Sstar -= step;
    if (Sstar <= 0) Sstar = K * (isPut ? 0.1 : 1.1);
    if (Math.abs(step) < 1e-8 * K) break;
  }
  return Sstar;
}

function baroneAdesiWhaleyPrice(S, K, T, r, q, sigma, type) {
  const b = r - q;
  if (T <= 1e-10 || sigma <= 0) return blackScholesPrice(S, K, T, r, q, sigma, type);
  if (type === "call" && b >= r - 1e-14) return blackScholesPrice(S, K, T, r, q, sigma, "call");
  if (r <= 0 && type === "put") {
    // BAW blows up when r=0 for puts; fall back to European as a lower bound
    // plus intrinsic blend — but we prefer BS2002 in that case.
    return Math.max(blackScholesPrice(S, K, T, r, q, sigma, type), Math.max(K - S, 0));
  }
  const Sstar = bawCriticalPrice(K, T, r, b, sigma, type);
  if (type === "call" && S >= Sstar) return S - K;
  if (type === "put" && S <= Sstar) return K - S;
  const euro = blackScholesPrice(S, K, T, r, q, sigma, type);
  const v2 = sigma * sigma;
  const N = 2 * b / v2;
  const M = 2 * r / v2;
  const Kdisc = r === 0 ? 1e12 : 1 - Math.exp(-r * T);
  const qq = type === "put"
    ? ((1 - N) - Math.sqrt((N - 1) * (N - 1) + 4 * M / Kdisc)) / 2
    : ((1 - N) + Math.sqrt((N - 1) * (N - 1) + 4 * M / Kdisc)) / 2;
  const { d1 } = d1d2(Sstar, K, T, r, q, sigma);
  const disc = Math.exp((b - r) * T);
  const nd = type === "put" ? normCdf(-d1) : normCdf(d1);
  const A = (Sstar / qq) * (1 - disc * nd);
  const premium = A * Math.pow(S / Sstar, qq);
  return euro + Math.max(premium, 0);
}

export function optionPrice(S, K, T, r, q, sigma, type, style = "american") {
  if (!(S > 0) || !(K > 0)) return 0;
  T = Math.max(T, 0);
  sigma = Math.max(sigma, 0);
  if (style !== "american") return blackScholesPrice(S, K, T, r, q, sigma, type);
  let p = bjerksundStensland2002Price(S, K, T, r, q, sigma, type);
  if (!Number.isFinite(p) || p < 0) {
    p = baroneAdesiWhaleyPrice(S, K, T, r, q, sigma, type);
  }
  const euro = blackScholesPrice(S, K, T, r, q, sigma, type);
  const intrinsic = type === "put" ? Math.max(K - S, 0) : Math.max(S - K, 0);
  return Math.max(p, euro, intrinsic); // American >= European, >= intrinsic
}

export function optionGreeks(S, K, T, r, q, sigma, type, style = "american") {
  if (style !== "american") return blackScholesGreeks(S, K, T, r, q, sigma, type);
  const price = optionPrice(S, K, T, r, q, sigma, type, style);
  const dS = Math.max(S * 0.001, 1e-4);
  const dSig = 0.001;
  const dR = 0.0001;
  const dT = Math.min(1 / YEAR_DAYS, T / 20 || 1 / YEAR_DAYS);
  const up = optionPrice(S + dS, K, T, r, q, sigma, type, style);
  const dn = optionPrice(S - dS, K, T, r, q, sigma, type, style);
  const delta = (up - dn) / (2 * dS);
  const gamma = (up - 2 * price + dn) / (dS * dS);
  const vega = (optionPrice(S, K, T, r, q, sigma + dSig, type, style)
    - optionPrice(S, K, T, r, q, Math.max(sigma - dSig, 1e-6), type, style)) / (2 * dSig);
  let theta = 0;
  if (T > dT) {
    theta = (optionPrice(S, K, T - dT, r, q, sigma, type, style) - price) / (dT * YEAR_DAYS);
  } else {
    const intrinsic = type === "put" ? Math.max(K - S, 0) : Math.max(S - K, 0);
    theta = (intrinsic - price) / Math.max(T * YEAR_DAYS, 1e-6);
  }
  const rho = (optionPrice(S, K, T, r + dR, q, sigma, type, style)
    - optionPrice(S, K, T, Math.max(r - dR, -0.99), q, sigma, type, style)) / (2 * dR);
  return { price, delta, gamma, theta, vega, rho };
}

/**
 * Implied volatility from a mid price. Newton with bisection fallback.
 */
export function impliedVol({ mid, S, K, T, r, q, type, style = "american" }) {
  if (!(mid > 0) || !(S > 0) || !(K > 0) || T <= 1e-10) return 0;
  const intrinsic = type === "put" ? Math.max(K - S, 0) : Math.max(S - K, 0);
  const price = Math.max(mid, intrinsic * 0.999);
  // Upper bound: price cannot exceed discounted underlying (call) or strike (put)
  let lo = 1e-6;
  let hi = 5;
  const pLo = optionPrice(S, K, T, r, q, lo, type, style);
  const pHi = optionPrice(S, K, T, r, q, hi, type, style);
  if (price <= pLo) return lo;
  if (price >= pHi) {
    // Stretch the upper bound once
    hi = 8;
    if (price >= optionPrice(S, K, T, r, q, hi, type, style)) return hi;
  }
  let sigma = clamp(Math.sqrt(2 * Math.PI / T) * price / S, 0.05, 2);
  for (let i = 0; i < 12; i++) {
    const g = optionGreeks(S, K, T, r, q, sigma, type, "european");
    const diff = g.price - price;
    if (Math.abs(diff) < 1e-6) return sigma;
    if (!(g.vega > 1e-12)) break;
    const next = sigma - diff / g.vega;
    if (next <= lo || next >= hi) break;
    sigma = next;
  }
  for (let i = 0; i < 60; i++) {
    const midSig = 0.5 * (lo + hi);
    const p = optionPrice(S, K, T, r, q, midSig, type, style);
    if (p > price) hi = midSig;
    else lo = midSig;
    if (hi - lo < 1e-6) return 0.5 * (lo + hi);
  }
  return 0.5 * (lo + hi);
}

/* ---------- Position analytics ---------- */

export function signedQty(leg) {
  const q = Number(leg.qty) || 0;
  if (leg.side === "sell" || q < 0) return -Math.abs(q);
  return Math.abs(q);
}

/** Theoretical mark of one leg at a scenario (per share, before multiplier). */
export function legValue(leg, { spot, timeMs, r, q, ivShift = 0 }) {
  const qty = signedQty(leg);
  if (leg.kind === "stock" || leg.type === "S" || leg.type === "stock") {
    return qty * spot; // qty is already in shares
  }
  const T = yearsUntil(leg.expiry, timeMs);
  const sigma = Math.max(0, (Number(leg.iv) || 0) + ivShift);
  const type = (leg.type === "P" || leg.type === "put") ? "put" : "call";
  const style = leg.style || "american";
  const px = optionPrice(spot, Number(leg.strike), T, r, q, sigma, type, style);
  return qty * px * (leg.multiplier || MULTIPLIER);
}

export function legEntryCost(leg, { fallbackSpot } = {}) {
  const qty = signedQty(leg);
  if (leg.kind === "stock" || leg.type === "S" || leg.type === "stock") {
    const px = Number(leg.entry);
    const use = Number.isFinite(px) ? px : (fallbackSpot || 0);
    return qty * use;
  }
  const px = Number(leg.entry);
  return qty * (Number.isFinite(px) ? px : 0) * (leg.multiplier || MULTIPLIER);
}

export function positionValue(legs, scenario) {
  return legs.reduce((s, leg) => s + legValue(leg, scenario), 0);
}

export function positionEntryCost(legs, opts) {
  return legs.reduce((s, leg) => s + legEntryCost(leg, opts), 0);
}

/** P&L of the book at a scenario relative to entry cost. */
export function positionPnL(legs, scenario) {
  return positionValue(legs, scenario) - positionEntryCost(legs, { fallbackSpot: scenario.spot0 ?? scenario.spot });
}

export function netGreeks(legs, { spot, timeMs, r, q, ivShift = 0 }) {
  const acc = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  for (const leg of legs) {
    const qty = signedQty(leg);
    if (leg.kind === "stock" || leg.type === "S" || leg.type === "stock") {
      acc.delta += qty;
      continue;
    }
    const T = yearsUntil(leg.expiry, timeMs);
    const sigma = Math.max(0, (Number(leg.iv) || 0) + ivShift);
    const type = (leg.type === "P" || leg.type === "put") ? "put" : "call";
    const style = leg.style || "american";
    const g = optionGreeks(spot, Number(leg.strike), T, r, q, sigma, type, style);
    const m = (leg.multiplier || MULTIPLIER) * qty;
    acc.delta += g.delta * m;
    acc.gamma += g.gamma * m;
    acc.theta += g.theta * m;
    acc.vega += g.vega * 0.01 * m; // $ per 1 vol point
    acc.rho += g.rho * 0.01 * m;   // $ per 1% rate
  }
  return acc;
}

/** Net premium: positive = debit, negative = credit, in dollars. */
export function netPremium(legs) {
  return positionEntryCost(legs);
}

/**
 * Expiry payoff (dollars) at an underlying price, minus entry.
 * Stock legs mark to the given price vs entry.
 */
export function expiryPayoff(legs, spot, { spot0 } = {}) {
  let value = 0;
  let cost = 0;
  for (const leg of legs) {
    const qty = signedQty(leg);
    if (leg.kind === "stock" || leg.type === "S" || leg.type === "stock") {
      value += qty * spot;
      const px = Number(leg.entry);
      cost += qty * (Number.isFinite(px) ? px : (spot0 || 0));
      continue;
    }
    const type = (leg.type === "P" || leg.type === "put") ? "put" : "call";
    const K = Number(leg.strike);
    const intrinsic = type === "put" ? Math.max(K - spot, 0) : Math.max(spot - K, 0);
    const m = leg.multiplier || MULTIPLIER;
    value += qty * intrinsic * m;
    cost += qty * (Number(leg.entry) || 0) * m;
  }
  return value - cost;
}

function uniqueStrikes(legs) {
  const xs = [];
  for (const leg of legs) {
    if (leg.kind === "stock" || leg.type === "S" || leg.type === "stock") continue;
    const k = Number(leg.strike);
    if (Number.isFinite(k) && !xs.includes(k)) xs.push(k);
  }
  xs.sort((a, b) => a - b);
  return xs;
}

function hasUnlimitedUpside(legs) {
  // Net call delta at +inf: long stock + long calls - short calls
  let slope = 0;
  for (const leg of legs) {
    const qty = signedQty(leg);
    if (leg.kind === "stock" || leg.type === "S" || leg.type === "stock") slope += qty;
    else if (!(leg.type === "P" || leg.type === "put")) slope += qty * (leg.multiplier || MULTIPLIER);
  }
  return slope > 1e-8;
}

function hasUnlimitedDownside(legs) {
  // As S->0, puts pay K and short stock goes to -S*qty with qty>0 being long (bounded),
  // short stock is unlimited loss; short puts are bounded; short calls are bounded on the downside.
  let shortStock = 0;
  for (const leg of legs) {
    const qty = signedQty(leg);
    if (leg.kind === "stock" || leg.type === "S" || leg.type === "stock") {
      if (qty < 0) shortStock += qty;
    }
  }
  return shortStock < -1e-8;
}

function payoffSlopeAtHigh(legs) {
  let slope = 0;
  for (const leg of legs) {
    const qty = signedQty(leg);
    if (leg.kind === "stock" || leg.type === "S" || leg.type === "stock") slope += qty;
    else if (!(leg.type === "P" || leg.type === "put")) slope += qty * (leg.multiplier || MULTIPLIER);
  }
  return slope;
}

/**
 * Max profit, max loss (numbers or +Infinity / -Infinity), and breakevens
 * measured at the last common expiry (or each leg's own expiry payoff at T_last
 * is not exact for calendars). For calendars / diagonals, max is estimated
 * numerically on a grid using the earlier expiry as a European/American mark
 * of the long leg, which is the standard practical approach.
 */
export function summarizePayoff(legs, { spot, r, q, timeMs, ivShift = 0 } = {}) {
  const optionLegs = legs.filter((l) => !(l.kind === "stock" || l.type === "S" || l.type === "stock"));
  const expiries = optionLegs.map((l) => l.expiry).filter(Boolean).sort();
  const lastExpiry = expiries[expiries.length - 1];
  const firstExpiry = expiries[0];
  const mixedExpiry = firstExpiry && lastExpiry && firstExpiry !== lastExpiry;
  const strikes = uniqueStrikes(legs);
  const lo = strikes.length ? Math.min(spot || strikes[0], strikes[0]) * 0.2 : (spot || 100) * 0.2;
  const hi = strikes.length ? Math.max(spot || strikes[strikes.length - 1], strikes[strikes.length - 1]) * 1.8 : (spot || 100) * 1.8;

  const points = new Set([0, lo, hi]);
  if (spot) points.add(spot);
  for (const k of strikes) {
    points.add(k);
    points.add(k * 0.999);
    points.add(k * 1.001);
  }
  // Dense grid for mixed-expiry and for finding breakevens
  const steps = 240;
  for (let i = 0; i <= steps; i++) {
    const x = lo + (hi - lo) * (i / steps);
    points.add(x);
  }

  const evalAt = (S, whenMs) => {
    if (!mixedExpiry && whenMs == null) return expiryPayoff(legs, S, { spot0: spot });
    const t = whenMs ?? (lastExpiry ? expiryCloseUtc(lastExpiry) : timeMs);
    return positionPnL(legs, { spot: S, timeMs: t, r: r ?? 0.04, q: q ?? 0, ivShift, spot0: spot });
  };

  // At final expiry of the longest legs; shorter legs already expired — handle
  // by pricing remaining living legs and settling expired ones at intrinsic
  // on that same S (the usual terminal slice).
  const terminalMs = lastExpiry ? expiryCloseUtc(lastExpiry) + 1000 : timeMs;
  let maxP = -Infinity;
  let minP = Infinity;
  const xs = [...points].filter((x) => x >= 0).sort((a, b) => a - b);
  const ys = xs.map((S) => evalAt(S, mixedExpiry ? terminalMs : null));
  for (const y of ys) {
    if (y > maxP) maxP = y;
    if (y < minP) minP = y;
  }
  if (hasUnlimitedUpside(legs)) maxP = Infinity;
  if (hasUnlimitedDownside(legs)) minP = -Infinity;
  // Short naked call: loss unlimited on the upside
  if (payoffSlopeAtHigh(legs) < -1e-8) minP = -Infinity;
  // Long put / short stock already covered; long call unlimited already covered.

  // Tight long debit that can't exceed a known cap: keep finite min/max if slope is 0 at both ends
  const breakevens = [];
  for (let i = 1; i < xs.length; i++) {
    const y0 = ys[i - 1];
    const y1 = ys[i];
    if (y0 === 0) {
      if (!breakevens.length || Math.abs(breakevens[breakevens.length - 1] - xs[i - 1]) > 1e-6) {
        breakevens.push(xs[i - 1]);
      }
    } else if (y0 * y1 < 0) {
      const t = y0 / (y0 - y1);
      breakevens.push(xs[i - 1] + t * (xs[i] - xs[i - 1]));
    }
  }

  const premium = netPremium(legs);
  return {
    netDebit: premium > 0 ? premium : 0,
    netCredit: premium < 0 ? -premium : 0,
    premium,
    maxProfit: maxP,
    maxLoss: minP,
    breakevens,
    mixedExpiry,
    lastExpiry,
  };
}

/**
 * Risk-neutral chance of profit at the last expiry, assuming the
 * underlying is lognormal with ATM / average position IV.
 * Integrates the sign of terminal P&L against the risk-neutral density.
 */
export function chanceOfProfit(legs, { spot, r, q, timeMs, ivShift = 0, sigma } = {}) {
  const summary = summarizePayoff(legs, { spot, r, q, timeMs, ivShift });
  if (!spot || spot <= 0) return { p: null, summary };
  let sig = sigma;
  if (!(sig > 0)) {
    const ivs = legs
      .filter((l) => !(l.kind === "stock" || l.type === "S" || l.type === "stock"))
      .map((l) => Math.max(0, (Number(l.iv) || 0) + ivShift))
      .filter((v) => v > 0);
    sig = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : 0.2;
  }
  const last = summary.lastExpiry;
  const T = last ? yearsUntil(last, timeMs) : 0;
  if (T <= 1e-8) {
    const now = expiryPayoff(legs, spot, { spot0: spot });
    return { p: now > 0 ? 1 : now < 0 ? 0 : 0.5, summary };
  }
  // Gauss-Hermite-like log-spot grid over ±6σ
  const mu = Math.log(spot) + (r - q - 0.5 * sig * sig) * T;
  const sd = sig * Math.sqrt(T);
  const n = 400;
  let mass = 0;
  let win = 0;
  for (let i = 0; i <= n; i++) {
    const z = -6 + 12 * (i / n);
    const S = Math.exp(mu + sd * z);
    const pdf = normPdf(z);
    // trapezoid weights in z-space (uniform dz)
    const w = (i === 0 || i === n) ? 0.5 : 1;
    const pnl = summary.mixedExpiry
      ? positionPnL(legs, {
        spot: S,
        timeMs: expiryCloseUtc(last) + 1000,
        r: r ?? 0.04,
        q: q ?? 0,
        ivShift,
        spot0: spot,
      })
      : expiryPayoff(legs, S, { spot0: spot });
    mass += w * pdf;
    if (pnl > 0) win += w * pdf;
  }
  return { p: mass > 0 ? win / mass : null, summary };
}

export function formatMoney(x, { signed = true, decimals = 0 } = {}) {
  if (x === Infinity) return "Unlimited";
  if (x === -Infinity) return "Unlimited";
  if (!Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  const d = abs >= 1000 && decimals === 0 ? 0 : abs >= 100 ? decimals : 2;
  const n = abs.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const core = `$${n}`;
  if (!signed) return core;
  if (x > 0.005) return `+${core}`;
  if (x < -0.005) return `−${core}`;
  return `$${Number(0).toFixed(d)}`;
}

export { bjerksundStensland2002Price, baroneAdesiWhaleyPrice, blackScholesPrice as bsmPrice };
