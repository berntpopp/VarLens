# VarLens

[![Build](https://github.com/berntpopp/VarLens/actions/workflows/build.yml/badge.svg)](https://github.com/berntpopp/VarLens/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-40-47848F.svg)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D.svg)](https://vuejs.org/)

VarLens is a cross-platform desktop application for offline genetic variant analysis. It provides a data-dense interface for importing, filtering, annotating, and exporting variant data -- all processed locally, with no data leaving your machine.

**[Documentation](https://berntpopp.github.io/VarLens/)** | **[Download](https://github.com/berntpopp/VarLens/releases/latest)**

![VarLens variant table view](docs/public/screenshots/variant-table.png)

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
| macOS | [DMG / ZIP](https://github.com/berntpopp/VarLens/releases/latest) |
| Linux | [AppImage / DEB](https://github.com/berntpopp/VarLens/releases/latest) |

See the [installation guide](https://berntpopp.github.io/VarLens/guide/installation) for system requirements and first-launch steps.

## Development

Requires [Node.js](https://nodejs.org/) 20+ and npm 9+. On Windows, also install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the C++ workload.

```bash
npm install
make dev
```

| Command | Description |
|---------|-------------|
| `make dev` | Start development server with hot reload |
| `make lint` | Lint and auto-fix |
| `make typecheck` | TypeScript type checking |
| `make test` | Run unit tests |
| `make ci` | Lint + typecheck + test |
| `make dist` | Build and package for current platform |

## Tech Stack

Vue 3 and Vuetify 3 (renderer), Electron 40 with electron-vite (build), SQLite via better-sqlite3-multiple-ciphers (storage), Pinia (state), Vitest and Playwright (testing), GitHub Actions (CI/CD).

## License

[MIT](LICENSE)
