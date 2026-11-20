# Contributing

This is the canonical repository for the Convexa showcase site
(`convexa.today` after a planned cutover; preview is a `*.workers.dev` or
`*.pages.dev` URL until then).

## How to work

1. Edit the static files in `public/` (`index.html`, `styles.css`, `assets/`).
2. Preview locally with `npx wrangler dev`.
3. Keep screenshots on the frozen demo book only. Never commit a live
   account, a real NLV, or feed credentials.
4. Commit messages should end with `[skip ci]`. This repository has no
   GitHub Actions deploy; a person deploys with Wrangler when a change is
   ready.
5. Do not attach the custom domain, change DNS, or edit the `convexa-web`
   worker, Cloudflare Access, `proto.`, or `live.` unless a separately
   approved cutover says so.

## Pull requests

Use the pull request template. A screenshot of the desktop and mobile
layout helps review. Keep diffs small and visual.
