# zhaowl94.github.io

A framework-free, tracking-free personal research desk and browser playground hosted on GitHub Pages.

Live site: [https://zhaowl94.github.io/](https://zhaowl94.github.io/)

The home page links eight public research tools, including a daily Nasdaq-100 constituent dashboard, plus five standalone browser games: Dou Dizhu, Guan Dan, Tank Battle, Auction King, and a branching cultivation story.

GitHub Pages is static, so page-level refresh buttons fetch the newest published snapshot without browser caching. Scheduled GitHub Actions perform the upstream collection and computation, retain last-known-good values when a source fails, validate all outputs, and deploy the complete site.

## Privacy boundary

- No analytics, cookies, ads, remote fonts, or third-party runtime scripts.
- Only public market and fund data is included in deployable snapshots.
- The local asset and investment ledgers are intentionally excluded from this repository's public routes, sitemap, and Pages artifact.
- Market Pulse uses no LLM or API key. Its public snapshot contains two index summaries, a deterministic Top 10, rolling bulletins, and source health rather than the full raw quote universe.
- Browser-game saves stay on the visitor's device and are never uploaded.

## Market Pulse refresh

The `Refresh Market Pulse` workflow runs roughly every 15 minutes across the regular US trading window and can also be started manually from GitHub Actions. It restores the latest valid snapshot before collecting new data, so a transient source outage does not publish an empty page.

To rebuild the same no-LLM snapshot locally:

```powershell
python scripts\update-market-pulse-data.py
```

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
