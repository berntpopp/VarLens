# CLAUDE.md

Project context for Claude Code and AI assistants.

## Project Overview

Varlens is an Electron desktop app for offline genetic variant analysis. Built with Vue 3 + Vuetify 3 + TypeScript (renderer), Electron 40 (main process), better-sqlite3 (database), and electron-vite (build tooling).

## Architecture

- **Main process**: `src/main/` - Electron main, SQLite database, IPC handlers, import service
- **Preload**: `src/preload/` - Context bridge exposing typed IPC API
- **Renderer**: `src/renderer/` - Vue 3 SPA with Vuetify, Pinia stores, composables
- **Shared types**: `src/shared/types/`
- **Tests**: `tests/` - Vitest with happy-dom

## Native Module: better-sqlite3

This project uses `better-sqlite3`, a native C++ Node.js addon. It requires recompilation for Electron because Electron uses a different Node.js ABI than system Node.js.

### Dual-mode rebuild workflow

Tests run under Node.js, but the Electron app needs the module compiled for Electron. The workflow is:

```
npm ci                    # installs deps, postinstall rebuilds for Electron
npm run rebuild:node      # rebuild for Node.js (before running tests)
npm run test              # tests run with Node.js-compatible binary
npm run rebuild:electron  # rebuild for Electron (before packaging)
npm run dist              # package app (npmRebuild: false skips broken auto-rebuild)
```

### Key config decisions

- `postinstall` uses `npx @electron/rebuild -f -w better-sqlite3` (NOT `electron-builder install-app-deps` which is broken for Electron 20+)
- `npmRebuild: false` in the electron-builder build config prevents electron-builder's broken native rebuild
- `better-sqlite3` is externalized in `electron.vite.config.ts` (not bundled by Vite)
- `.node` files are extracted from ASAR via `asarUnpack: ["**/*.node"]`

### Windows development prerequisites

On Windows, `@electron/rebuild -f` requires **Visual Studio Build Tools** with the "Desktop development with C++" workload. GitHub Actions `windows-latest` runners have this pre-installed. For local Windows development, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload.

## Build Commands

```bash
make dev              # rebuild for Electron + start dev server
make rebuild          # rebuild native modules for Electron
make rebuild-node     # rebuild native modules for Node.js (for tests)
make test             # run tests
make lint             # lint with auto-fix
make typecheck        # TypeScript checking
make ci               # lint + typecheck + test
make ci-full          # full CI pipeline mirroring GitHub Actions
make dist             # build + package for current platform
```

## CI/CD

- `.github/workflows/build.yml` - PR/push CI (lint, typecheck, test, build) on Windows/Ubuntu/macOS
- `.github/workflows/release.yml` - Release on version tags (v*.*.*)
- Code signing is disabled (`CSC_IDENTITY_AUTO_DISCOVERY=false`)

## Code Style

- ESLint + Prettier, strict TypeScript
- IPC channels use `domain:action` naming (e.g., `cases:list`, `variants:query`)
- Vue components use `<script setup lang="ts">` with Composition API
