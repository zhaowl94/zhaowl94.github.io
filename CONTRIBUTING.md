# Contributing

Thank you for helping improve this portfolio.

## Scope

Useful contributions fix accessibility, compatibility, documentation, broken links, or verified project facts. New personal claims, private repository references, analytics, contact forms, remote runtime dependencies, and framework migrations are outside the v1 scope.

## Development

Use Node.js 24 LTS and install the locked project dependencies:

```powershell
npm.cmd ci
```

The repository does not require global packages, Windows environment-variable changes, execution-policy changes, or secrets.

Create a focused branch, keep unrelated changes out of the commit, then run:

```powershell
npm.cmd run check
npm.cmd run test:unit
npm.cmd run test:e2e:windows
npm.cmd run check:external-links
npm.cmd run test:lighthouse
```

Linux contributors should also run `npm run test:e2e:linux`. Visual snapshots are maintained only in the pinned Ubuntu Chromium environment.

## Content rules

- Link only to public, verified sources.
- Keep Chinese and English claims equivalent.
- Do not add personal contact details or local filesystem paths.
- Do not weaken the WCAG or Lighthouse thresholds to make a check pass.
- Document any generated visual resource and its license boundary.

Pull requests must pass all GitHub Actions jobs before they can be merged.
