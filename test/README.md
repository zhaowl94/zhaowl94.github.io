# Verification guide

Tests exercise the same static files deployed to GitHub Pages. The homepage also supports direct `file://` use; data-driven subpages are tested through the local HTTP server used in CI.

## Test layers

| Layer               | Command                               | Coverage                                                                          |
| ------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| Static quality      | `npm run check`                       | Formatting, HTML/CSS/JS, local paths, seven-route metadata, payload size, privacy |
| Snapshot validation | `node scripts/validate-site-data.mjs` | ETF, NDX, bubble, strategy, backtest, QDII, Market Pulse, and home status         |
| Unit                | `npm run test:unit`                   | Seven-tool status, no-LLM snapshot contract, and Lighthouse sampling logic        |
| External links      | `npm run check:external-links`        | Public project, canonical, source, and social-preview URLs                        |
| Windows browsers    | `npm run test:e2e:windows`            | Chrome, Edge, Firefox, mobile Chromium, direct files, and all tool routes         |
| Linux browsers      | `npm run test:e2e:linux`              | Chromium, Firefox, WebKit, mobile Chromium, accessibility and responsive layout   |
| Lighthouse          | `npm run test:lighthouse`             | Home and Market Pulse performance, accessibility, best practices, and SEO         |

Browser tests cover:

- all seven public tool routes and their return navigation;
- substantive published data and a visible refresh control on every tool;
- cache-busting static snapshot reloads for QDII, bubble, strategy, backtest, ETF, and Market Pulse;
- keyboard skip navigation, reduced motion, forced colors, 400% zoom, and dark mode;
- no tracking storage, forced new tabs, console errors, or third-party runtime resources on the homepage;
- automated WCAG 2.0/2.1/2.2 A and AA checks with Axe;
- `index.html` and `404.html` through HTTP and direct filesystem URLs.

## Lighthouse policy

The minimum score is `0.95` for performance, accessibility, best practices, and SEO on both the home page and Market Pulse. A first-sample miss triggers two confirmation samples; the median must still pass. Reports are written under ignored `test-results/`.

## Layout regression

Responsive regression tests assert grid structure, overflow, dark-theme contrast, and 404 visibility without storing pixel screenshots. Functional and accessibility coverage remains cross-platform.

## Manual accessibility

Automated checks cannot confirm spoken-output quality. Follow [`manual-accessibility.md`](manual-accessibility.md) before a release.
