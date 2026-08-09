# zhaowl94.github.io

A framework-free, tracking-free personal market research desk hosted on GitHub Pages.

Live site: [https://zhaowl94.github.io/](https://zhaowl94.github.io/)

The home page links six public tools: cross-border ETF premiums, Nasdaq-100 valuation, a multi-source bubble monitor, an ETF trend strategy, an interactive allocation backtest, and QDII fund similarity.

GitHub Pages is static, so page-level refresh buttons fetch the newest published snapshot without browser caching. Scheduled GitHub Actions perform the upstream collection and computation, retain last-known-good values when a source fails, validate all outputs, and deploy the complete site.

## Privacy boundary

- No analytics, cookies, ads, remote fonts, or third-party runtime scripts.
- Only public market and fund data is included in deployable snapshots.
- The local asset and investment ledgers are intentionally excluded from this repository's public routes, sitemap, and Pages artifact.

## Local development

```powershell
npm.cmd ci
npm.cmd run serve
npm.cmd run check
npm.cmd run test:unit
```

Then open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). The repository targets Node.js 24 and uses a lockfile.

## License

HTML, CSS, JavaScript, tests, and configuration are available under the [MIT License](LICENSE). Published market data is for research only and is not investment advice.
