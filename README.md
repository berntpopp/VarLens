<p align="center">
  <a href="https://berntpopp.github.io/VarLens/">
    <img src="https://berntpopp.github.io/VarLens/logo.svg" alt="VarLens" width="120" />
  </a>
</p>

<h1 align="center">VarLens</h1>

<p align="center">
  <strong>Genetic variant analysis — on your desktop or self-hosted.</strong>
</p>

<p align="center">
  <a href="https://github.com/berntpopp/VarLens/actions/workflows/build.yml"><img src="https://github.com/berntpopp/VarLens/actions/workflows/build.yml/badge.svg" alt="Build" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-40-47848F.svg" alt="Electron" /></a>
  <a href="https://vuejs.org/"><img src="https://img.shields.io/badge/Vue-3-4FC08D.svg" alt="Vue" /></a>
</p>

<p align="center">
  <a href="https://berntpopp.github.io/VarLens/"><strong>Documentation</strong></a> &middot;
  <a href="https://github.com/berntpopp/VarLens/releases/latest"><strong>Download</strong></a>
</p>

<p align="center">
  <img src="https://berntpopp.github.io/VarLens/screenshots/variant-table.png" alt="VarLens variant table view" width="800" />
</p>

## Features

- **Import** annotated variant data from JSON files (single, batch, or ZIP)
- **Filter** by gene, consequence, population frequency, pathogenicity scores, and more
- **Annotate** variants with stars, comments, tags, and ACMG classifications
- **Classify** with ACMG criteria and auto-suggested evidence
- **Analyze cohorts** with carrier aggregation and gene burden testing
- **Match phenotypes** using HPO-based similarity scoring
- **Export** filtered results to Excel or CSV
- **Store** data locally in SQLite with optional encryption

For a complete walkthrough, see the [feature documentation](https://berntpopp.github.io/VarLens/features/variant-table).

## Install

Download the latest release for your platform:

| Platform | Formats |
|----------|---------|
| Windows | [Installer / Portable](https://github.com/berntpopp/VarLens/releases/latest) |
| macOS (Apple Silicon only) | [DMG / ZIP](https://github.com/berntpopp/VarLens/releases/latest) |
| Linux | [AppImage / DEB](https://github.com/berntpopp/VarLens/releases/latest) |

See the [installation guide](https://berntpopp.github.io/VarLens/guide/installation) for system requirements and first-launch steps.

## Development

Requires [Node.js](https://nodejs.org/) (pinned by `.nvmrc` to `24.15.0`) and npm 11 (≥ 11.11, < 12). On Windows, also install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the C++ workload.

```bash
npm ci
make dev
```

| Command | Description |
|---------|-------------|
| `make dev` | Start development server with hot reload |
| `make lint` | Lint and auto-fix |
| `make typecheck` | TypeScript type checking |
| `make test` | Run unit tests |
| `make ci` | Lint + format check + typecheck + rebuild for Node + test |
| `make dist` | Build and package for current platform |

## Tech Stack

Vue 3 and Vuetify 4 (renderer), Electron 43 with electron-vite (build), SQLite via better-sqlite3-multiple-ciphers (storage), Pinia (state), Vitest and Playwright (testing), GitHub Actions (CI/CD).

## License

[MIT](LICENSE)
