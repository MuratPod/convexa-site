# Convexa site

Public showcase for the Convexa iOS app: a single static page that walks
through every main screen on a **frozen demo book**. Figures such as the
demo net liquidation of $64,624.16 are virtual. This repository must never
hold a live account number, a real net liquidation, or feed credentials.

The production host is intended to be the apex of `convexa.today`. Until
that cutover is approved, the preview is at
[https://convexa-site.convexa.workers.dev/](https://convexa-site.convexa.workers.dev/).
DNS, Cloudflare Access, the existing `convexa-web` worker, and the
`proto.` / `live.` hosts are out of scope here.

## Local preview

```bash
npx wrangler dev
```

The site lives in `public/`: `index.html`, `styles.css`, self-hosted
Inter fonts under `public/assets/fonts/`, optimized WebP screenshots
under `public/assets/`, and official Apple Product Bezel artwork under `public/assets/bezels/`
(see `LICENSE-NOTES.txt` and `MEASUREMENTS.txt` in that folder; screen
insets are percentages on `.device--iphone-16-pro-max` / `.device--watch-s10`).
Source device PNGs are under
`screens/` (swap a PNG, regenerate WebP, commit).

## Deploy

There is no GitHub Actions workflow. From a machine signed in to the
Convexa Cloudflare account:

```bash
npx wrangler deploy
```

`wrangler.jsonc` deploys Worker `convexa-site-ia`, which already serves
the production route `convexa.today/*`. Do not add or change custom domains,
DNS, or routes in that step.

The live preview at https://convexa-site.convexa.workers.dev/ is a new
Worker `convexa-site` that serves the same `public/` files from the R2
bucket `convexa-site` (Wrangler was not logged in on the build machine,
and this Cloudflare session has no Pages API scope). No custom domain
is attached.

Every commit message should include `[skip ci]`.

## Options builder

The public strategy builder lives at [`/builder`](https://convexa.today/builder/).
It is a static page plus a Worker proxy:

- `public/builder/` — UI, Black–Scholes–Merton and Bjerksund–Stensland 2002 pricing
- `src/worker.js` — `/api/quote` and `/api/chain`, 60-second edge cache

Quotes are delayed ~15 minutes. The Worker tries Yahoo Finance’s public
options API, Nasdaq.com’s delayed option-chain JSON, and Cboe’s delayed
options JSON, and uses the first source that responds. From the Cloudflare
edge, Nasdaq is currently the reliable source; Yahoo often requires a
cookie+crumb session and may rate-limit shared Worker IPs; Cboe is usually
blocked by bot protection. None of these is a licensed redistributable
market-data product. Do not treat this proxy as a commercial data feed; it
is for education on this site only. A constant risk-free rate (4.1%) is used
unless a later feed supplies one.

Run the math checks with `npm test` (`node --test tests/pricing.test.js`).

## License

Copyright (c) 2026 Murat Podgoretskiy. See [LICENSE](LICENSE).
