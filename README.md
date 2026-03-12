# VarLens

[![Build](https://github.com/berntpopp/VarLens/actions/workflows/build.yml/badge.svg)](https://github.com/berntpopp/VarLens/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-40-47848F.svg)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D.svg)](https://vuejs.org/)

Offline desktop application for genetic variant analysis. Built for clinical genomics workflows on Windows, macOS, and Linux.

**[Documentation](https://berntpopp.github.io/VarLens/)** | **[Download](https://github.com/berntpopp/VarLens/releases/latest)**

## Features

- Import annotated variant JSON files (single, batch, or ZIP)
- Filter by gene, consequence, population frequency, pathogenicity scores
- Cohort analysis with carrier aggregation and gene burden testing
- ACMG classification with auto-suggested criteria
- HPO-based phenotype matching and similarity scoring
- Export to Excel and CSV
- Local SQLite storage with optional encryption

See the [full feature documentation](https://berntpopp.github.io/VarLens/features/variant-table) for details.

## Quick Start

```bash
npm install
make dev
```

Requires [Node.js](https://nodejs.org/) 20+ and npm 9+. Windows additionally requires [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the C++ workload.

## Development

```bash
make dev              # Start dev server
make lint             # Lint with auto-fix
make typecheck        # TypeScript type checking
make test             # Run test suite (runs rebuild:node first)
make ci               # Full CI check (lint + typecheck + test)
make dist             # Build and package for current platform
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vue 3, Vuetify 3, TypeScript |
| Desktop | Electron 40, electron-vite |
| Database | SQLite (better-sqlite3-multiple-ciphers) |
| State | Pinia |
| Testing | Vitest, Playwright |
| CI/CD | GitHub Actions |

## Project Structure

```
src/
  main/           Electron main process, SQLite, IPC handlers
  preload/        Context bridge (typed IPC API)
  renderer/       Vue 3 SPA (components, composables, stores)
  shared/types/   Shared TypeScript definitions
tests/            Unit and E2E tests
docs/             VitePress documentation site
```

## Contributing

See the [contributing guide](https://berntpopp.github.io/VarLens/about/contributing) for development setup, architecture details, and contribution guidelines.

## License

[MIT](LICENSE)
