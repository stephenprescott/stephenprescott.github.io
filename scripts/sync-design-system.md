# Design system sync

Source: https://claude.ai/artifact/EG9TLR9WtLEVcKrvk3nRTQ (WARMING STRIPES — 1880→2025), version 1795147771-1d9b.

Vendored unedited (never hand-edit; Claude re-reads the artifact with the Artifact tool and overwrites these):

| File here | Artifact path | sha256 |
| --- | --- | --- |
| src/assets/css/tokens.css | project/tokens.css | cc74663a5a7befdfa89618a4b1eba9f0d2814b9040cc761682bc1c9cc7b9cd77 |
| src/assets/css/bundle.css | project/components/bundle.css | 92b8e538a05641817aae4fb054ec0bf7b78c449906ca620216c4c7e1af0ca6ea |
| src/assets/css/fonts/*.woff2, OFL.txt | project/fonts/* | (binary, see git) |
| src/robots.txt.njk, src/site.webmanifest.njk | project/assets/Site/robots.txt, site.webmanifest | converted to templates fed by site.json (Task 9); sitemap is ours |
| src/favicon.svg, icon-*.png, apple-touch-icon.png | asset store, group Site (ids in project/design-system.json) | (binary, see git) |
| scripts/vendor/bundle.js (git-ignored) | project/components/bundle.js | used only for golden capture |

Procedure: read each artifact path above (published files with the Artifact `read` action and `path`; Site assets by blob id), copy over the vendored files, update the version and hashes here, run `npm test` and `npm run golden`.
