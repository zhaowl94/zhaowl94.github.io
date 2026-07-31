# Verification guide

The site has one deployed source of truth: the root HTML, CSS, JavaScript, and local assets. Tests validate the same files through direct `file://` access, local HTTP, and GitHub Pages deployment.

## Test layers

| Layer            | Command                        | Coverage                                                                                  |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| Static quality   | `npm run check`                | Formatting, HTML, CSS, JavaScript, local paths, metadata, payload, project order, privacy |
| Unit             | `npm run test:unit`            | Language-query behavior and Lighthouse sampling                                           |
| External links   | `npm run check:external-links` | Public project, Release, Pages, canonical, and social-preview URLs                        |
| Windows browsers | `npm run test:e2e:windows`     | Chrome, Edge, Firefox, mobile Chromium, and direct-file Edge                              |
| Linux browsers   | `npm run test:e2e:linux`       | Chromium, Firefox, WebKit, mobile Chromium, direct files, and visual snapshots            |
| Lighthouse       | `npm run test:lighthouse`      | Chinese and English home-page budgets                                                     |

Browser tests cover:

- Chinese and English content, metadata, shareable query parameters, and browser history;
- five-project order, explicit status labels, repository and Release links;
- keyboard skip navigation, reduced motion, forced colors, 400% zoom, light and dark themes;
- no forms, cookies, storage, forced new tabs, console errors, or third-party runtime requests;
- automated WCAG 2.0/2.1/2.2 A and AA checks with Axe;
- `index.html` and `404.html` through HTTP and direct filesystem URLs.

## Lighthouse policy

The minimum score is `0.95` for performance, accessibility, best practices, and SEO.

Each page normally receives one sample. If the first sample misses any budget, the runner collects two more samples for that page, preserves all raw reports, and evaluates the three-run median. A persistent regression still fails; retries do not lower the threshold.

Reports are written under ignored `test-results/`.

## Visual snapshots

Ubuntu Chromium is the only visual baseline. Functional and accessibility behavior remains cross-platform, but Windows font rasterization is not compared pixel-by-pixel.

Update snapshots only after reviewing an intentional visual change:

```bash
npm run test:visual:update
```

## Manual accessibility

Automated checks cannot confirm the quality of spoken output. Follow [`manual-accessibility.md`](manual-accessibility.md) before the final release.
