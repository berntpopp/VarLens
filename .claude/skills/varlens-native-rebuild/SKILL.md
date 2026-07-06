---
name: varlens-native-rebuild
description: Use when a VarLens test or app run fails to load the native SQLite module — errors like NODE_MODULE_VERSION mismatch, "compiled against a different Node.js version", ERR_MODULE_NOT_FOUND on out/main/db-worker.js, or "was compiled against a different Node.js ABI" — or BEFORE running vitest, the Electron app, or packaging, to rebuild the module for the correct ABI first.
metadata:
  version: "1.0.1"
  updated: "2026-07-06"
---

# VarLens Native-Module ABI Rebuild

## Overview

VarLens loads one native addon: `better-sqlite3-multiple-ciphers`. A native addon
must be compiled against the **Node ABI of whoever loads it**, and VarLens has two
different loaders with two different ABIs:

- **Tests** (Vitest) run under **system Node**.
- **The app** (dev server, build, packaging, Playwright E2E) runs under **Electron**, whose Node ABI differs from system Node's.

The binary can only satisfy one ABI at a time. Switching what you run means
rebuilding for the new loader. This is the single most common footgun in the repo.

## The decision (memorize this)

| What you are about to run | Rebuild command first | npm script it wraps |
|---|---|---|
| `make test`, `vitest`, `make ci`, any unit/integration test | `make rebuild-node` | `npm rebuild better-sqlite3-multiple-ciphers` |
| `make dev`, `make build`, `make dist*`, packaging, Playwright `_electron` E2E | `make rebuild` | `npx @electron/rebuild -f -w better-sqlite3-multiple-ciphers` |

`make dev` runs `rebuild` (Electron) for you as a prerequisite. **Packaging does
not** — `make build` and `make dist` are just `electron-vite build` (+ `electron-builder`)
with no rebuild step. They assume the binary is already on the Electron ABI, which is
true right after `npm ci` (whose `postinstall` rebuilds for Electron) but **not** after
you've run tests. So if you last built for Node — i.e. you ran Vitest — run `make rebuild`
yourself before packaging. **Tests never auto-rebuild** either: run `make rebuild-node`
before Vitest whenever the binary was last built for Electron.

After `npm ci`, `postinstall` rebuilds for **Electron**. So a fresh install is
ready to run the app but will ABI-fail on tests until you `make rebuild-node`.

## Symptoms → fix

If you see any of these, the binary is built for the wrong ABI:

- `Error: The module '...better_sqlite3.node' was compiled against a different Node.js version`
- `NODE_MODULE_VERSION <x>. This version of Node.js requires NODE_MODULE_VERSION <y>`
- `ERR_MODULE_NOT_FOUND` on `out/main/db-worker.js`
- Any native-load / `.node` link error at test or app startup

**Fix:** identify what you're running, run the matching rebuild from the table, retry.
It is never a code bug — do not go looking for one.

## The canonical full sequence

```bash
npm ci                    # postinstall rebuilds for Electron
make rebuild-node         # switch to Node ABI before Vitest
make test                 # Vitest against the Node-ABI binary
make rebuild              # switch back to Electron ABI before app/packaging
make dist                 # package
```

## Common mistakes

- **Debugging a "module not found" as if it were a code/import error.** It is an
  ABI mismatch. Check which loader you're targeting first.
- **Running `make test` right after `make dev` (or right after `npm ci`) without
  `make rebuild-node`.** The binary is on the Electron ABI; tests will fail to load it.
- **Using `electron-builder install-app-deps`.** It has been broken for Electron 20+.
  The repo rebuilds via `@electron/rebuild` directly; `npmRebuild: false` is intentional.
- **`npm ci --ignore-scripts`** skips both the rebuild *and* the Electron binary
  download. If Electron itself is missing, run `node node_modules/electron/install.js`,
  then `make rebuild` (app) or `make rebuild-node` (tests).
