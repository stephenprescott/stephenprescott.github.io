# Lighthouse gate

Target: 95+ in all four categories on the landing page.

Run (Windows, Chrome installed):

    npm run build
    node scripts/serve-built.mjs 8099
    npx lighthouse@12.6.1 http://127.0.0.1:8099/ --only-categories=performance,accessibility,best-practices,seo --chrome-flags="--headless=new --no-sandbox" --output=json --output-path=home.json

Recorded 2026-11-19 (landing page, development content): performance 100, accessibility 100, best-practices 100, seo 100.
