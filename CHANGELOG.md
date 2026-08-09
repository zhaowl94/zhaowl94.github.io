# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- Nasdaq-100 constituent analytics at `/ndx100-dashboard/`, with a cache-busting refresh button, offline browser cache, daily Actions refresh, and a complete initial snapshot.
- Five standalone browser games at `/doudizhu/`, `/guandan/`, `/tank-battle/`, `/auction-king/`, and `/cultivation/`, each with a direct return path to the home page.
- A dedicated home-page playground section that keeps games visually separate from research tools.
- Information-rich home page with direct navigation to eight public research tools.
- No-LLM Market Pulse at `/market-pulse/`, with delayed index snapshots, a deterministic four-factor Top 10, rolling bulletins, explicit source degradation, and cache-busting refresh.
- Dedicated 15-minute GitHub Actions refresh and last-known-good cache handoff across every Pages deployment workflow.
- Static GitHub Pages versions of the NDX valuation, bubble monitor, trend strategy, backtest lab, and QDII similarity dashboards.
- Unified snapshot refresh workflow for ETF premium, NDX market data, bubble indicators, and weekly QDII similarity data.
- Cache-busting refresh controls, shared tool navigation, compact home-page publication status, and cross-tool browser coverage.
- Static Nasdaq-100 and S&P 500 ETF premium dashboard at `/etf-premium/`, with historical charts, ranking, filters, and CSV export.
- Weekday GitHub Actions refresh and Pages deployment for the generated ETF premium snapshot, with last-known-good fallback behavior.
- Browser coverage for dashboard data loading, interaction, privacy, responsive layout, and WCAG accessibility.

### Changed

- Reframed the former project portfolio as a privacy-aware market research desk and removed the legacy open-source project index from the home page.
- Explicitly excluded local personal asset and investment ledgers from all public routes and deployment artifacts.
- Updated three transitive development dependencies to patched releases required by the repository security audit.
- Added a Tencent daily-price fallback with non-destructive incremental merging when the primary historical-price endpoint is unavailable.

## [1.0.0] - 2026-07-31

### Added

- Bilingual, framework-free open-source engineering portfolio.
- Five evidence-backed public project summaries with explicit maturity labels.
- Direct-file, local HTTP, and GitHub Pages compatibility.
- Privacy-first behavior with no analytics, cookies, forms, or third-party runtime resources.
- Responsive light and dark themes, custom 404 page, SEO metadata, sitemap, and local social-preview artwork.
- Windows and Ubuntu CI, browser and visual tests, accessibility checks, privacy scanning, external-link validation, and Lighthouse budgets.

[Unreleased]: https://github.com/zhaowl94/zhaowl94.github.io/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/zhaowl94/zhaowl94.github.io/releases/tag/v1.0.0
