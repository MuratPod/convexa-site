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
Inter fonts under `public/assets/fonts/`, and optimized WebP screenshots
under `public/assets/`. Source device PNGs used to build those assets
are kept under `screens/` for reference (swap a PNG, regenerate WebP,
commit).

## Deploy

There is no GitHub Actions workflow. From a machine signed in to the
Convexa Cloudflare account:

```bash
npx wrangler deploy
```

`wrangler.jsonc` describes a Workers static-assets publish under the
worker name `convexa-site`. Do not bind a custom domain in that step.

The live preview at https://convexa-site.convexa.workers.dev/ is a new
Worker `convexa-site` that serves the same `public/` files from the R2
bucket `convexa-site` (Wrangler was not logged in on the build machine,
and this Cloudflare session has no Pages API scope). No custom domain
is attached.

Every commit message should include `[skip ci]`.

## License

Copyright (c) 2026 Murat Podgoretskiy. See [LICENSE](LICENSE).
