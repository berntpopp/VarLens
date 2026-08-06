# Accepted Warnings Ledger

Every warning left in VarLens's build/lint/audit/install output is either fixed or explained here.
The point of this file is that nobody re-investigates a warning from scratch — read the row, check
whether the "what would change the ruling" condition still holds, move on.

**Last verified:** 2026-08-06, against `main` at commit `4f220d8a` (`v0.70.4`) plus the in-flight
`chore/build-warning-ledger` branch. Re-run the inventory below and update this file when
dependencies bump or the flagged source lines move.

## Operational note: one command is not enough

`MODULE_TYPELESS_PACKAGE_JSON` (fixed on this branch by renaming `eslint.config.js` →
`eslint.config.mjs`) and the npm deprecation warnings in Group 4 do **not** appear in `npm run
build`. A warning inventory that only runs the build misses two of the four groups below. Run all
of these to see the full picture:

```bash
npm run build                # electron.vite.config.ts — Groups 1, 3, 5
npm run build:web:renderer   # vite.web-renderer.config.ts — Groups 3, 5 (Group 1 is main-process-only, not built here)
npm run lint:check           # ESLint — currently silent; would show MODULE_TYPELESS_PACKAGE_JSON if it regressed
npm install                  # Group 4 (only prints on a package that is newly fetched/changed, not on a no-op reinstall)
npm audit                    # Group 2
```

---

## Group 1 — Vite "dynamically imported but also statically imported" (2×)

**Surfaces on:** `npm run build`, both occurrences also present in the same log (main-process
build only; `npm run build:web:renderer` does not build these main-process files so it does not
reproduce them).

Full reasoning already lives in AGENTS.md's [Vite "dynamically imported but also statically
imported" warnings](../../AGENTS.md#vite-dynamically-imported-but-also-statically-imported-warnings)
section — read that instead of re-deriving it. Do not restate it here beyond the summary below.

| # | File | Why accepted | What would change the ruling |
|---|------|---------------|-------------------------------|
| 1 | `src/main/storage/postgres/migrations/definitions.ts` (dynamically imported by `src/main/database/startup.ts`, statically imported by `src/main/ipc/handlers/database-logic.ts` and `src/main/storage/postgres/createPostgresStorageSession.ts`) | The dynamic import exists to defer **module evaluation at runtime** (it reads migration SQL off disk at module scope), not to split a chunk — Vite's chunk-splitting advice does not apply. `tests/main/database/database-startup.test.ts` ("does not load postgres migration definitions for the default sqlite database") fails if this import is made static. | If that test is ever removed or the module stops doing disk I/O at import time, re-evaluate. |
| 2 | `src/main/ipc/handlers/import-logic.ts` (dynamically imported by `src/main/storage/sqlite/SqliteImportExecutor.ts`, statically imported by `src/main/ipc/handlers/import.ts`) | Same shape: the dynamic import lets a test-injected delegate avoid dragging in the real import pipeline. | If the test-injection seam is redesigned so `SqliteImportExecutor` no longer needs a lazy import, re-evaluate. |

**Ruling: do not "fix" either by converting to a static import.**

---

## Group 2 — `npm audit` low severity (elliptic, via pdbe-molstar)

**Surfaces on:** `npm audit`.

**Observed count: 5 low severity vulnerabilities** — matches the plan's description. Full chain:

```
elliptic (advisory GHSA-848j-6mx2-7j84, risky crypto primitive)
  <- browserify-sign
    <- crypto-browserify
      <- pdbe-molstar >=3.2.0-beta.1 (we're on 3.12.0)
  <- create-ecdh
```

npm's own suggested fix is `npm audit fix --force`, which it reports would downgrade
`pdbe-molstar` to `3.1.3` — a breaking change to the protein-visualization dependency that predates
the current 3D viewer feature.

**Ruling: out of scope. Never run `npm audit fix --force`** — this is also recorded in memory
(`reference_npm_audit_elliptic_residual`) precisely because it silently breaks pdbe-molstar.

**What would change the ruling:** pdbe-molstar publishing a release that drops the
`crypto-browserify`/`browserify-sign`/`elliptic` chain (or replaces it with a non-vulnerable
version) without downgrading. Check `npm audit` count on every dependency bump touching
`pdbe-molstar` or `molstar`.

---

## Group 3 — Rollup `#__PURE__` annotation from `@vueuse/core` (2×)

**Surfaces on:** `npm run build` and `npm run build:web:renderer` (both configs bundle
`@vueuse/core` for the renderer).

**Observed at:** `node_modules/@vueuse/core/dist/index.js` `(3362:0)` and `(5780:22)` — matches the
plan's line numbers exactly as of `@vueuse/core@14.3.0`.

```
node_modules/@vueuse/core/dist/index.js (3362:0): A comment
"/* #__PURE__ */"
in "node_modules/@vueuse/core/dist/index.js" contains an annotation that Rollup cannot interpret
due to the position of the comment. The comment will be removed to avoid issues.
```

Rollup drops the annotation and moves on; it does not fail the build or change output correctness,
only tree-shaking granularity at that call site. This is an upstream comment-placement issue in
`@vueuse/core`'s published bundle — there is nothing in this repo to change.

**Ruling: accepted, no action.**

**What would change the ruling:** the line numbers are pinned to the exact `@vueuse/core` version.
On every `@vueuse/core` bump, re-run the build and update the line numbers here (or drop the row if
upstream fixes the annotation placement).

---

## Group 4 — npm deprecation warnings (5, at time of writing)

**Surfaces on:** `npm install` (only when npm actually fetches/relinks the package — a no-op
`npm install` against an already-satisfied tree prints nothing). Confirmed via `npm view <pkg>
deprecated` and `npm ls <pkg>` against the current lockfile instead of forcing a reinstall.

| Package | Deprecation reason | Chain | Why an override is unsafe/impossible |
|---|---|---|---|
| `rimraf@2.6.3` | "Rimraf versions prior to v4 are no longer supported" | `electron-builder` → `app-builder-lib` → `electron-builder-squirrel-windows` → `electron-winstaller` → `temp@0.9.4` → `rimraf@2.6.3` | Overriding to v4+ forces a major electron-builder was never tested against. `rimraf` is used by the Squirrel Windows installer generator at `npm run dist` time only — a break here is invisible to unit tests and only surfaces mid-release. |
| `glob@7.2.3` | "Old versions of glob are not supported, and contain widely publicized security vulnerabilities" | `electron-builder` → `app-builder-lib` → `@electron/asar@3.4.1` → `glob@7.2.3` (also pulled in again via the `rimraf@2.6.3` chain above) | Same electron-builder-subtree risk as `rimraf`. `glob` also has two unrelated consumers at different majors already: `@fastify/static` → `glob@13.0.6`, `@vue/test-utils` → `js-beautify` → `glob@10.5.0`. A top-level `overrides` entry would force one version onto all three call sites and could break `@electron/asar`'s packaging behavior or the web-gate's `@fastify/static` at the same time. |
| `inflight@1.0.6` | "This module is not supported, and leaks memory. Do not use it." | `electron-builder` → `app-builder-lib` → `@electron/asar@3.4.1` → `glob@7.2.3` → `inflight@1.0.6` | It is a transitive dependency of the `glob@7.2.3` used only inside `.asar` packaging. Overriding it out from under `glob@7.2.3` risks breaking that specific glob version's internal async coalescing, again only observable at `npm run dist` time. |
| `boolean@3.2.0` | "Package no longer supported." | `electron-builder` → `app-builder-lib` → `@electron/get@3.1.0` → `global-agent@3.0.0` → `boolean@3.2.0` | Same electron-builder-subtree risk: forcing a replacement changes proxy-agent behavior used only during the installer download/build step, untested by the unit suite. |
| `lodash.isequal@4.5.0` | "Use `require('node:util').isDeepStrictEqual` instead." | `electron-updater@6.8.9` → `lodash.isequal@4.5.0` | **`4.5.0` is already the latest published version** (`npm view lodash.isequal version` → `4.5.0`). There is no newer version to override to — the deprecation notice is permanent messaging pointing at a Node built-in, not a fixable-by-bump issue. Silencing it requires an upstream `electron-updater` change to stop depending on the package. |

**Ruling: no overrides added for any of these.** `package.json`'s existing `overrides` block
(`xlsx`, `@xmldom/xmldom`, `lodash`, `@electron/fuses`) deliberately stays out of the
`electron-builder` subtree — this ledger entry is the explicit statement of that precedent, not a
new decision.

**What would change the ruling:** an `electron-builder` major that drops these transitive
dependencies (check on every `electron-builder` bump), or an `electron-updater` release that
replaces `lodash.isequal` with the Node built-in.

---

## Group 5 — "Module path/fs/crypto has been externalized for browser compatibility" (3×), via h264-mp4-encoder

**Surfaces on:** `npm run build` and `npm run build:web:renderer`.

```
[plugin vite:resolve] Module "path" has been externalized for browser compatibility, imported by
".../node_modules/h264-mp4-encoder/embuild/dist/h264-mp4-encoder.node.js".
[plugin vite:resolve] Module "fs" has been externalized ...
[plugin vite:resolve] Module "crypto" has been externalized ...
```

This was investigated as its own task before writing this ledger row; recording the evidence, not
just the verdict.

**Dependency chain:** `pdbe-molstar@3.12.0` → `molstar@5.8.0` → `h264-mp4-encoder@1.0.12`.
Introduced by commit `987d9b16` ("feat: protein visualization modal with lollipop plots, gene
structure, and 3D viewer (#92)"). VarLens never uses Mol\*'s MP4-export feature; `h264-mp4-encoder`
is dead weight pulled in by Mol\*'s own bundle, not something VarLens code calls directly.

**Reachability trace** (three layers deep, all lazy):

1. `src/renderer/src/App.vue:114-115` — `defineAsyncComponent(() => import('./components/VariantDetailsPanel.vue'))`
2. `src/renderer/src/components/VariantDetailsPanel.vue:230-231` — `defineAsyncComponent({ loader: () => import('./protein/ProteinVisualizationModal.vue'), ... })`, triggered by `openProteinView()` at `:258-259`
3. `src/renderer/src/components/protein/ProteinVisualizationModal.vue:127-128` — `<ProteinStructure3DPanel v-else-if="activeTab === '3d'" .../>`; the default tab is `'lollipop'` (`:174`, `const activeTab = ref('lollipop')`), so the 3D panel is not mounted until the user explicitly switches tabs. The component is statically imported at `:146`.
4. `src/renderer/src/composables/useMolstarViewer.ts:43-59` — `ensureMolstarRuntime()`, the actual `import('pdbe-molstar/lib/viewer')` that pulls in Mol\* (and transitively `h264-mp4-encoder`), runs only when the 3D tab is opened.

**Why it is safe:** every `require("path"|"fs"|"crypto")` call site in
`h264-mp4-encoder.node.js` is gated behind a Node-runtime detection check present in the minified
bundle (`typeof process==='object' && typeof process.versions==='object' && typeof
process.versions.node==='string'`). VarLens's renderer window is created with `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false` at
[`src/main/index.ts:80-82`](../../src/main/index.ts#L80-L82). A sandboxed, non-node-integrated
renderer page context has no `process` global at all, so that check always evaluates false and the
`path`/`fs` branches are dead code at runtime. The `crypto` require site is additionally only a
fallback used when Web Crypto is unavailable, which never happens in Chromium.

> **This ruling is load-bearing on `src/main/index.ts:80-82`.** If `sandbox`, `contextIsolation`,
> or `nodeIntegration` are ever relaxed for the main window, this entire ruling must be
> re-evaluated — the dead-code branches above would become reachable.

**Upstream packaging gap worth noting (not actionable here):** the package ships a working
browser-targeted build on disk (`node_modules/h264-mp4-encoder/embuild/dist/h264-mp4-encoder.web.js`)
but its `package.json` declares only a bare `"main"` field — no `"browser"` or `"exports"` field —
so bundlers have no standard signal to prefer the browser build over the Node one. Fixing this
would require an upstream `h264-mp4-encoder` (or `molstar`) release.

**No GitHub issue currently tracks this.**

**Ruling: accept.**

**What would change the ruling:** relaxing the fuses named above, evidence that the runtime-check
pattern in the bundled JS has changed on an `h264-mp4-encoder`/`molstar`/`pdbe-molstar` bump (diff
the bundle's `typeof process` guard after any bump touching those three packages), or VarLens
starting to use Mol\*'s MP4 export feature.
