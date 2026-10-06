# Dependency and code-scanning alerts — 2026-10-06 sweep

Branch: `chore/deps-security-2026-10` (track 10). Base: `main` @ `8a662b89` (v0.73.0 + #431).

Approach: one consolidated branch off current `main` instead of merging the 18 Dependabot
PRs one by one. Dependabot never rebases, so its green checks only prove the bump against a stale
base (see `feedback_dependabot_stale_base`). One lockfile regeneration, one verification pass.

## npm audit — before / after

| | critical | high | moderate | low | total |
|---|---|---|---|---|---|
| before (`main` 8a662b89) | 2 | 5 | 13 | 5 | 25 |
| after (this branch) | 0 | 0 | 8 | 5 | 13 |

The 13 left are two chains, both triaged below and neither fixable without a breaking downgrade:

- **5 low:** `elliptic` → `create-ecdh` / `browserify-sign` → `crypto-browserify` → `pdbe-molstar`.
  This is the known residual. The only fix npm offers is `npm audit fix --force`, which downgrades
  `pdbe-molstar` to 3.1.3 (a breaking change to the protein viewer). Out of scope, unchanged.
- **8 moderate:** `sprintf-js` (GHSA-hp3w-g68c-fv3c, **no patched release**) plus the 7 packages
  that depend on it: `roarr`, `global-agent`, `@electron/get@3`, `app-builder-lib`, `dmg-builder`,
  `electron-builder-squirrel-windows`, `electron-builder`. npm's suggested "fix" downgrades
  `electron-builder` to 26.5.0, which is not a fix. Deferred; reasoning is below.

No `overrides` were needed. Every patchable alert was cleared with a direct bump (`npm install`)
or a lockfile-only transitive update (`npm update <pkg>`), because each parent's semver range
already admitted the patched version.

## Dependabot alerts → resolution

| Alert | Sev | Package (scope) | Advisory | Resolution |
|---|---|---|---|---|
| #144 | critical | shell-quote (dev) | GHSA-pqg4-j6r4-53mv | **fixed**: 1.10.0 → 1.12.0 (lockfile; via npm-run-all2) |
| #140 | critical | proxy-addr (runtime) | GHSA-jqcg-44mw-7w3h | **fixed**: 2.0.7 → 2.0.8 (lockfile; via molstar → express) |
| #141 | high | source-map-js (runtime) | GHSA-68fv-2mgg-jv7q | **fixed**: 1.2.1 → 1.2.2 (lockfile) |
| #139 | high | compression (runtime) | GHSA-vc2v-76pw-4v95 | **fixed**: 1.8.1 → 1.8.2 (lockfile; via molstar) |
| #137 | high | http-cache-semantics (dev) | GHSA-ch52-4w7c-c8xp | **fixed**: 4.2.0 → 4.3.0. The advisory lists no patched version, but its range is `<= 4.2.0`, so 4.3.0 is outside it. |
| #127, #124 | high | brace-expansion 5.x (eslint) | GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p | **fixed**: 5.0.9 → 5.0.12 |
| #130 | medium | brace-expansion 5.x | GHSA-q2hr-2g5m-vwhr | **fixed**: 5.0.12 |
| #131 | medium | brace-expansion 2.x (electron-builder) | GHSA-q2hr-2g5m-vwhr | **fixed**: 2.1.4 → 2.1.7 |
| #132 | medium | brace-expansion 1.x (electron-builder) | GHSA-q2hr-2g5m-vwhr | **fixed**: 1.1.18 → 1.1.21 |
| #115 | high | undici 7.x (dev) — TLS bypass | GHSA-w293-vg96-wgc3 | **fixed**: 7.29.0 → 7.30.0 (via electron → @electron/get@5) |
| #123, #122, #117, #116, #114 | med/low | undici 7.x (dev) | various | **fixed**: 7.30.0 |
| #121 | low | undici 6.x (dev) | GHSA-r53p-7pc4-xj5r | **fixed**: 6.28.0 → 6.29.0 (via node-gyp) |
| #143 | medium | pbkdf2 (runtime) | GHSA-477h-4r7f-fvrx | **fixed**: 3.1.5 → 3.1.7 (lockfile; via pdbe-molstar → crypto-browserify) |
| #138 | medium | postcss-selector-parser (dev) | GHSA-rj75-hqrm-r3gf | **fixed**: 7.1.4 → 7.1.6 |
| #136 | medium | fastify (runtime, direct) | GHSA-4mh8-r7rc-xpvc | **fixed**: 5.12.3 → 5.12.5 (package.json floor raised) |
| #135 | medium | fast-uri (runtime) | GHSA-hrr3-gc8f-f4qj | **fixed**: 3.1.7 → 3.1.8 |
| #134, #133 | medium | ip-address (runtime) | GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw | **fixed**: 10.7.0 → 10.7.3 (via @fastify/rate-limit) |
| #142 | medium | sprintf-js (dev) | GHSA-hp3w-g68c-fv3c | **deferred: no patched version.** Not reachable at runtime; see below. |

### sprintf-js (#142): reachability

Path: `electron-builder` → `app-builder-lib` → `@electron/get@3.1.0` → `global-agent@3` (an
*optional* dependency) → `roarr@2.15.4` → `sprintf-js@1.1.3`.

- **Development and build time only.** `electron-builder` is a devDependency. `npm ls sprintf-js
  --omit=dev` returns an empty tree.
- **Not in the desktop app.** The packaged file set is `out/**` plus
  `node_modules/better-sqlite3-multiple-ciphers/**` (`package.json` → `build.files`). Nothing
  from the electron-builder tree is in `app.asar`.
- **Not in the web server image.** The `Dockerfile` builder stage runs
  `npm prune --omit=dev` before `node_modules` is copied into the runtime stage.
- **Trigger conditions.** `global-agent` (and roarr's `sprintf` formatting with it) only loads
  when `@electron/get` is asked to use a proxy (`ELECTRON_GET_USE_PROXY`) while electron-builder
  downloads Electron. The advisory needs an attacker-controlled format string with an unbounded
  precision specifier. roarr's format strings are fixed log messages inside `global-agent`.
  Worst case is a CPU DoS of a developer's or CI runner's packaging step.
- **Options rejected.**
  - `npm audit fix --force` would downgrade electron-builder to 26.5.0. That is a regression of
    the packaging toolchain, not a fix.
  - An `overrides` entry forcing `global-agent@^4` (which drops roarr) crosses a major version
    under `@electron/get@3`, which declares `^3.0.0`. It would clear one moderate, build-only,
    non-reachable alert at the cost of an untested proxy-bootstrap path in packaging.
    Not worth the risk.
- **Unblock signal:** a patched `sprintf-js`, or `app-builder-lib` dropping `@electron/get@3`.
  As of this sweep, electron-builder 26.17.0 (the `v26` tag) still pins `@electron/get ^3.0.0`.

### Runtime-scope packages that VarLens never loads

Dependabot labels `proxy-addr`, `compression` and `pbkdf2` as *runtime* because they sit under the
production dependency `pdbe-molstar`, via `molstar`'s optional server and `crypto-browserify`
polyfills. VarLens imports only molstar's browser viewer bundle. The web server is Fastify, which
uses its own fork, `@fastify/proxy-addr`, not `proxy-addr`. All three were patched anyway: the
patches are in-range lockfile updates and cost nothing.

## Code-scanning alerts (CodeQL) → resolution

All 10 were in `src/web/server/dispatcher.ts` and are fixed by commit `fix(web): …` on this branch:

| Alert | Rule | Line | Resolution |
|---|---|---|---|
| #16 | js/xss-through-exception | 369 | Every dispatcher response is now `application/json; charset=utf-8` with `nosniff`. Exception text is rebuilt into a fresh SerializableError. |
| #17, #18 | js/reflected-xss | 389, 409 | Same JSON content type plus `nosniff` on every response. The 404 body only echoes `domain` / `method` when they match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. |
| #19–#25 | js/stack-trace-exposure | 362–409 | `toSerializableWebError` (moved to `src/web/server/dispatcher-errors.ts`) never returns the thrown object. It rebuilds `{code, message, userMessage, details}`: `code` is validated against `ErrorCode`, and `details` is a bounded JSON-safe copy with `stack` keys removed and nested Errors reduced to `{name, message}`. The stack goes to the server log (`reply.log.error({ err })`) instead. |

Root cause: the previous helper returned IpcError-shaped exceptions unchanged and copied any thrown
plain object wholesale into `details`, so a stack or driver internals could reach the client. On top
of that, the route never pinned a content type.

Tests: `tests/web-gate/dispatcher-error-hardening.test.ts` (9 tests) covers these cases:

- a thrown Error becomes a JSON 500 with no stack;
- an IpcError-shaped Error loses its stack and extra fields such as `sql`;
- a thrown plain object is flattened;
- success responses are JSON with `nosniff`;
- the 404 body never reflects a hostile method name;
- the sanitiser's depth and type bounds hold.

The alerts close when CodeQL re-scans the PR. `codeql` is not installed locally, so closure could
not be confirmed before pushing.

## Dependabot PRs → resolution

All of these are superseded by this branch. None were merged, closed or commented on.

| PR | Bump | Resolution |
|---|---|---|
| #430 | shell-quote 1.12.0 | superseded (applied) |
| #429 | proxy-addr 2.0.8 | superseded (applied) |
| #428 | postcss-selector-parser 7.1.6 | superseded (applied) |
| #427 | pbkdf2 3.1.7 | superseded (applied) |
| #426 | source-map-js 1.2.2 | superseded (applied) |
| #425 | compression 1.8.2 | superseded (applied) |
| #424 | fast-uri 3.1.8 | superseded (applied) |
| #423 | ip-address 10.7.3 | superseded (applied) |
| #422 | fastify 5.12.5 | superseded (applied, also in #416) |
| #421 | brace-expansion 1.1.21 | superseded (applied; 2.1.7 and 5.0.12 too) |
| #420 | undici 6.29.0 | superseded (applied; 7.30.0 too) |
| #419 | http-cache-semantics 4.3.0 | superseded (applied) |
| #417 | dev group, 16 updates | superseded. Applied at the PR's versions or newer in-range patches (eslint 10.12.0, typescript-eslint 8.71.1). Electron 43.7.1 → 43.7.7 keeps ABI 148, so the native cache key is unchanged. |
| #416 | prod group, 9 updates | superseded. Applied; vuetify resolved to 4.2.4, a newer patch than the PR's 4.2.3. |
| #415 | codeql-action/upload-sarif 4.38.2 | superseded (applied, SHA `2892aa5e…`, annotated tag dereferenced) |
| #411 | @vueuse/core 15.0.0 (major) | superseded (applied; see below) |
| #408 | docker/build-push-action 7.4.0 | superseded (applied, SHA `c3c9e263…`). Its failing check is unrelated; see below. |
| #407 | docker/setup-buildx-action 4.4.1 | superseded (applied, SHA `f87e5991…`) |

### @vueuse/core 15 (major)

VarLens uses only `onKeyStroke`, `useDebounceFn` and `useStorage`. The v15 breaking changes touch
none of them. Those changes are: `templateRef` removed, Node 20 dropped, deprecated timer options
removed, the `useEventSource` / `useIDBKeyval` behaviour changes, and the `useThrottleFn` trailing
default. The shipped `.d.ts` signatures for the three functions VarLens uses are unchanged between
14.4.0 and 15.0.0. `createKeyPredicate` still accepts a function key filter, which matters for the
`fix/columns-shortcut` branch. `vitepress@2.0.0-alpha.20` keeps its own nested `@vueuse/core@14`
for the docs build.

The `vitepress` note in memory (vitepress 1.x pinning vite 5) is stale. The repo is on vitepress
2.0.0-alpha.x, and no vite or esbuild alert is open.

### #408 "Package (windows-latest)" failure: flake, not related

- The PR only changes `.github/workflows/publish-web.yml`. The failing job is in `build.yml`, which
  that file does not affect.
- In run 35454768763, job 105928452537, step 8 "Install dependencies" (`npm ci`) exited with code 1
  after about 2 s and printed nothing. No build, packaging or Docker step ran.
- #407 was opened 15 s earlier with the identical base and an equivalent `publish-web.yml`-only
  change. Its Windows package job passed (5m34s). So did #415.
- Conclusion: a transient runner or registry failure.
