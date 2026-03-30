# CLAUDE.md

Project context for Claude Code and AI assistants.

## Project Overview

Varlens is an Electron desktop app for offline genetic variant analysis. Built with Vue 3 + Vuetify 3 + TypeScript (renderer), Electron 40 (main process), better-sqlite3 (database), and electron-vite (build tooling).

## Architecture

- **Main process**: `src/main/` - Electron main, SQLite database, IPC handlers, import service (JSON + VCF)
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

## Import Formats

VarLens supports two import paths:

- **JSON formats** (`columnar`, `object`, `simple`): Pre-existing VarVis/VarLens JSON exports (`.json`, `.json.gz`)
- **VCF** (`.vcf`, `.vcf.gz`): Standard VCF 4.x files with optional VEP CSQ or SnpEff ANN annotations

VCF import is handled by `src/main/import/vcf/` — a modular parser pipeline:
- `vcf-header-parser.ts` → `vcf-line-parser.ts` → `vcf-allele-splitter.ts` → `vcf-annotation-parser.ts` → `vcf-genotype-parser.ts` → `VcfMapper.ts` → `VcfStrategy.ts`
- `info-field-registry.ts` — configurable mapping from INFO fields to DB columns; unmapped fields go to `info_json` (JSON column)
- Multi-sample VCFs create one case per selected sample
- **Field convention**: `consequence` = IMPACT (HIGH/MODERATE/LOW/MODIFIER), `func` = SO consequence term (missense_variant, etc.) — same as JSON format

Test data: `tests/test-data/vcf/` — GIAB Chinese Trio (chr22:29M-30.5M), annotated with VEP and SnpEff. Regenerate via `scripts/prepare-test-data.sh`.

## CI/CD

- `.github/workflows/build.yml` - PR/push CI (lint, typecheck, test, build) on Windows/Ubuntu/macOS
- `.github/workflows/release.yml` - Release on version tags (v*.*.*)
- Code signing is disabled (`CSC_IDENTITY_AUTO_DISCOVERY=false`)

## Code Style

- ESLint + Prettier, strict TypeScript
- IPC channels use `domain:action` naming (e.g., `cases:list`, `variants:query`)
- Vue components use `<script setup lang="ts">` with Composition API
- **NEVER use `console.log/error/warn`** in application code. Use:
  - Main process: `mainLogger` from `src/main/services/MainLogger` (e.g., `mainLogger.error(msg, 'source')`)
  - Renderer: `logService` from `src/renderer/src/services/LogService` (e.g., `logService.error(msg, 'source')`)
  - Only exceptions: `logStore.ts` (bootstrap), `main.ts` (dev mode), `preload/index.ts` (no IPC), worker threads (no Electron IPC)

## E2E Testing: Playwright + Electron

Playwright has native Electron support via `_electron`. It connects directly to the Electron app via CDP — no Chrome browser needed. This is the modern recommended approach (used by VS Code).

### How it works

- Playwright launches the **compiled** Electron app (`out/main/index.js`), not the dev server
- Returns a standard Playwright `Page` object with full locator API, auto-wait, assertions, screenshots
- Can evaluate code in the main Electron process (access `app`, `BrowserWindow`, etc.)
- Uses its own `@playwright/test` runner — no conflict with existing Vitest unit tests

### Setup

```bash
npm install -D @playwright/test playwright
```

### Minimal example

```typescript
import { _electron as electron } from 'playwright';

const app = await electron.launch({
  args: ['./out/main/index.js'],
});
const window = await app.firstWindow();
await window.waitForSelector('.v-application');
await app.close();
```

### Key considerations

- **Build before test**: must run `electron-vite build` before E2E tests
- **Native modules**: `better-sqlite3` needs Electron rebuild (handled by `postinstall`)
- **CI on Linux**: needs `xvfb-run` for real window rendering
- **File dialogs**: mock at IPC level or use `electron-playwright-helpers` package

## Planning & Documentation

- **All plans, specs, and design docs go in `.planning/`** — never use `docs/` for planning artifacts
- Specs: `.planning/specs/`
- Research/notes: `.planning/docs/`

## UI / Vuetify Theme Notes

See [.planning/docs/UI-PATTERNS.md](.planning/docs/UI-PATTERNS.md) for comprehensive Vuetify component patterns.

**Key rules:**
- **NEVER use `surface-variant` for background colors** — the warm palette theme makes it white-on-white invisible (`surface-variant` #f5f2ef vs `surface` #faf8f6). Use `bg-grey-lighten-3` for subtle contrast (nested tables, expanded rows) or `secondary` (#424242) for strong contrast (tabs, toolbars)
- Vuetify 3 `v-data-table-server` expand API uses `v-model:expanded` which emits an array of item keys (strings), NOT `{ value, item }` objects
