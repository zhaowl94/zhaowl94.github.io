# zhaowl94.github.io

[中文](README.md)

A framework-free, tracking-free open-source engineering portfolio that works as a direct local file. It presents verified public work by `zhaowl94`, with an emphasis on compatible migrations, data tools, and accessible static front ends.

Live site: [https://zhaowl94.github.io/](https://zhaowl94.github.io/)

Cross-border ETF premium dashboard: [https://zhaowl94.github.io/etf-premium/](https://zhaowl94.github.io/etf-premium/)

## Boundaries

- The site uses only the public handle `zhaowl94`; it does not publish a legal name, email address, phone number, location, or private history.
- It does not read the GitHub API, expose private repositories, or present a third-party historical fork as original work.
- It uses no cookies, analytics, advertising, third-party scripts, remote fonts, or contact forms.
- The pages have no framework or runtime build dependency. The same `index.html` works as a direct file, through local HTTP, and on GitHub Pages.
- Chinese is the default language. `?lang=en` provides the complete English version without storing a cookie or local preference.

## Repository layout

```text
.
├── index.html
├── 404.html
├── assets/
│   ├── images/
│   ├── scripts/
│   └── styles/
├── etf-premium/
│   ├── data/
│   ├── vendor/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── scripts/
│   ├── Lighthouse checks
│   └── ETF premium snapshot generator
├── test/
│   ├── e2e/
│   ├── scripts/
│   ├── snapshots/
│   └── unit/
├── robots.txt
└── sitemap.xml
```

## Local preview

The simplest option is to open `index.html` directly. Local CSS, JavaScript, the favicon, and language switching continue to work in this mode.

For local HTTP:

```powershell
npm.cmd ci
npm.cmd run serve
```

Then visit [http://127.0.0.1:4173/](http://127.0.0.1:4173/).

The ETF dashboard reads its JSON snapshot over HTTP and is available at [http://127.0.0.1:4173/etf-premium/](http://127.0.0.1:4173/etf-premium/). Historical premiums use unadjusted closing price divided by the official unit NAV published for the same valuation date, minus one. GitHub Actions attempts to refresh the static dataset at 18:30 China Standard Time every weekday and keeps the last successful snapshot if upstream data is temporarily unavailable.

The project requires Node.js 24 LTS. Every tool is installed inside the repository. The setup does not require global npm packages or modify Windows environment variables, execution policy, or global Git configuration.

## Verification

```powershell
# Formatting, HTML/CSS/JavaScript, static structure, and privacy boundaries
npm.cmd run check

# Pure functions and Lighthouse sampling behavior
npm.cmd run test:unit

# Windows browser matrix
npm.cmd run test:e2e:windows

# External links and Lighthouse budgets
npm.cmd run check:external-links
npm.cmd run test:lighthouse
```

On Linux or WSL, replace `npm.cmd` with `npm`. See [`test/README.md`](test/README.md) for the complete browser matrix and manual checks.

The performance, accessibility, best-practices, and SEO Lighthouse thresholds are all `0.95`. If the first sample misses any threshold, only that page receives two confirmation samples and the three-run median is evaluated. The threshold is never lowered.

## Deployment

Every pull request must pass Windows, Ubuntu, the browser matrix, and Lighthouse. After a merge to `master`, GitHub Actions repeats the verification and deploys the repository's static source directly to GitHub Pages without generating or committing a second copy of the site. The ETF data refresh workflow can also be dispatched manually from Actions.

## Development note

Codex assisted with scope alignment, implementation, testing, and documentation. Repository maintainers retain the final decisions and release authority. The built-in ImageGen tool created `assets/images/social-preview.png`; see [`assets/images/README.md`](assets/images/README.md) for the prompt and asset terms.

## License

HTML, CSS, JavaScript, tests, and configuration code use the [MIT License](LICENSE). Personal copy, project descriptions, and original visual assets under `assets/images/` are excluded from the MIT grant unless that directory says otherwise.
