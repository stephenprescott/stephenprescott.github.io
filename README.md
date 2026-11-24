# stephenprescott.github.io

Stephen Groff's portfolio site (Eleventy 3 + Nunjucks), with an "Ask Stephen's AI" chat Worker in `chat/`. It has two page shells: the dark shell (`src/_includes/layouts/shell.njk`, `src/assets/css/shell.css`, Space Grotesk) for `/`, `/projects/`, the case studies and the 404 page; and the WARMING STRIPES design-system shell (`src/_includes/layouts/base.njk`, light/dark theme toggle), now used only by `/resume/`.

Toolchain verified: Node v20.20.2, npm 10.8.2, git 2.55.0.

## Adding a project

Add one entry to `src/_data/projects.json`: `slug`, `title`, `eyebrow`, `summary`, `image`, `imageAlt`, `tags`, `href`. It appears on the landing page and `/projects/` with no template edits; if it has a `caseStudy` and no `href`, its card links to the case study page automatically. For a case study page, add a `caseStudy` object (`meta`, `problem`, `approach`, `result`, `figures`, `stats`); the page is generated at `/projects/<slug>/` and prev/next links follow list order. Set `"placeholder": true` on anything unfinished: `npm run build:prod` refuses to build until every placeholder is gone.

Landing-page extras on a project entry: `proves` (a list of expertise ids from `home.json` `expertise.items`; the project then lights up under those areas in the star chart, and an unknown id fails the build) and an optional `shortTitle` (the name shown in the hero constellation and project list; by default it is the title up to the first colon). A project with a slug that has no drawing in `src/_includes/components/project-glyph.njk` gets a generic glyph.

## Adding a figure

Add an object to `home.stats` in `src/_data/home.json`: `id`, `value`, optional `suffix`, `label`, `proves` (expertise ids) and `bodyFrom`, which points at existing text so nothing is retyped: `hero.body#1`, or `expertise:<area id>` (add `#1` to keep only the first sentence). The figure appears in the Results section and in the star chart with no template edits.

## Where the drawings live

- Hero scene (canvas): `src/assets/js/hero-scene.js`; styles in `src/assets/css/landing.css`.
- Star chart, proof panel and work accordion: `src/assets/js/landing-chart.js` (data comes from the `#lp-data` JSON block rendered by `src/_includes/partials/landing.njk`).
- Project glyphs (SVG): `src/_includes/components/project-glyph.njk`.
- Dark shell (nav, footer, tokens): `src/_includes/layouts/shell.njk`, `src/assets/css/shell.css`; chat restyle: `src/assets/css/chat-shell.css`.
- Size limits for these files: `test/budget.test.mjs`.

Commands: `npm run dev` (preview), `npm run build`, `npm run build:prod` (fails on placeholder content or missing launch values), `npm test`.

## Phase 2 / Launch

**What phase 2 adds:** landing page (hero scene, star chart, results, expertise, work, contact), five case studies under `/projects/`, `/resume/` with a PDF download, motion, `/llms.txt`, the chat knowledge pack at `/chat/knowledge.json`, the chat widget, and the contact form (Web3Forms). The site is live: the launch steps below have been done and are kept as the record of how it was set up (and what to repeat for a new Worker or a fresh deploy).

**Production gate.** `npm run build:prod` refuses to build while any data node has `"placeholder": true` (none today), while `chat.json` `endpoint` is empty or not `https://`, or while `contact.json` `web3formsKey` is empty. Setting `"enabled": false` in either file skips its check; for chat that also means no chat UI renders.

**Launch steps (Stephen, in order):**

1. Approve the copy: review every placeholder-flagged item with `npm run dev`; remove each flag only once approved.
2. Cloudflare: create the account, `npx wrangler login`, create the KV namespace (`npx wrangler kv namespace create LIMITS`, put the id in `chat/wrangler.toml`), set the Anthropic key as a Worker secret (`npx wrangler secret put ANTHROPIC_API_KEY`, typed by Stephen), and set an Anthropic monthly spend limit in the Anthropic console.
3. Deploy the Worker: `cd chat && npm install && npx wrangler deploy`. Note the URL.
4. Run the eval locally (about 16 minutes): see `chat/README.md` → Eval. All 25 cases must pass; fix the prompt or the pack, never the eval.
5. Get a Web3Forms access key (public by design).
6. Put the Worker URL in `src/_data/chat.json` `endpoint` and the key in `src/_data/contact.json` `web3formsKey`; remove both placeholder flags. `npm run build:prod` and `npm test` must pass. Commit.
7. `gh auth status` must show `stephenprescott` as the active account.
8. Set the Pages source to GitHub Actions first. Then publish a fresh one-commit history so earlier private drafts never reach GitHub: `git checkout --orphan publish`, `git commit -m "Launch"`, `git push --force origin publish:main`. Keep working on `publish` as the new main afterwards. The deploy workflow tests, builds, generates the resume PDF and publishes.
9. Verify live: `/`, `/chat/knowledge.json`, `/llms.txt` and `/resume/stephen-groff-resume.pdf` return 200; ask the chat three eval questions; send one test contact message.

**Local chat widget.** The widget renders only when an endpoint is set. Run the Worker with `npx wrangler dev` in `chat/` (port 8787), then start the site with the endpoint, e.g. PowerShell `$env:CHAT_ENDPOINT='http://localhost:8787/'; npm run dev` (bash: `CHAT_ENDPOINT=http://localhost:8787/ npm run dev`). `http://localhost:8080` is in the Worker's `ALLOWED_ORIGINS`.

**Resume PDF.** The PDF is generated after a build by `node scripts/build-resume-pdf.mjs _site` (the deploy workflow does this). On a plain local build the Download PDF link 404s until you run it.
