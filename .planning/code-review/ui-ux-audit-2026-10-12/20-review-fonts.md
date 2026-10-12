# 20 — Review: feat/bundled-fonts (3 commits, origin/main...HEAD)

What this change does: Adds Inter and JetBrains Mono (variable, Latin woff2 only) from exact-pinned `@fontsource-variable/*@5.3.0` devDependencies via one `fonts.css`. It sets `--v-font-body`/`--font-mono` tokens with a metric-matched Arial fallback, adds tabular figures on end-aligned table cells, raises menu subheaders 10px to 11px, and widens Position 8 to 8.75rem. Confirmed: only 2 woff2 files in `out/renderer/assets` and `out/web/public/assets`; CSP `font-src 'self'` covers both (Electron `csp-header.ts`, web `static.ts`); Vuetify defines no `--v-font-body` of its own, so the `:root` token wins. The fallback overrides are correct: Inter upm 2048, ascent 1984 / descent 494 / gap 0, divided by size-adjust 1.0488, gives 92.37% / 23.0% / 0%. Tabular scope is fine: every `align: 'end'` column in the app is numeric. Position parity holds: case and cohort share `withFixedWidth` and `PositionCell`. No other font sizes changed.

**Must fix**
1. **OFL licence text is not shipped** (`package.json` build files / `out/`). *What:* OFL 1.1 §2 says every copy of the font must carry the copyright notice and the licence. *Problem:* the woff2 files keep the copyright (nameID 0) but fontsource dropped the licence text (nameID 13 is empty; only a URL in nameID 14). The repo keeps no third-party notices file and has no About/licences screen. *Fix:* copy both packages' `LICENSE` files next to the fonts, e.g. `assets/fonts/OFL-Inter.txt` and `OFL-JetBrainsMono.txt`, through Vite `public/` or electron-builder `extraResources`. No UI is needed. *If skipped:* VarLens ships fonts outside their licence terms, in a signed release.

**Should fix**
2. **`<code>`/`<kbd>` still use the browser's own monospace** (23 `<code>` + 2 `<kbd>` in `src/renderer/src/**/*.vue`, e.g. `ExtensionDetailsSection.vue:343`, `SlimFilterToolbar.vue:145`). *What:* the browser's built-in styles (UA defaults) give these tags `font-family: monospace`, and Vuetify does not override that. *Problem:* STR repeat units and file names render in DejaVu/Courier, not JetBrains Mono. That breaks the "OS-independent" goal. *Fix:* one rule in `custom.css`: `code, kbd, pre, samp { font-family: var(--font-mono); }`. *If skipped:* mono text looks different on each OS.
3. **The token fallback is duplicated** (`data-table-shared.css:71-80`). `var(--font-mono, ui-monospace, …)` repeats the stack, which is already defined at `:root`. Use `var(--font-mono)`. Lean: -8 lines.

**Nice to have**
4. **The mono swap has no metric fallback** (`fonts.css`). On Windows the fallback is Consolas (advance 0.55em vs JetBrains 0.60em), so HGVS/ref/alt text widens ~9% when the font swaps in. Columns have fixed widths, so it truncates rather than shifts. Fix: `font-display: block` on the mono face (it is a local file, so the block lasts only milliseconds), or a size-adjusted `local('Consolas')` fallback.
5. **The comment is wrong** (`column-widths.ts:32`): "11-char mono position", but `PositionCell` renders `.genomic-coordinate` in Inter with tabular figures, not mono. Fix the wording.

Verdict: fix 1 first (2 is a one-liner, do it too).
Lean: -8 lines possible.
Not checked: tests and builds were not run (read-only review); 1440px horizontal scroll and real CLS were not measured (run `make perf-interaction-gates` for the CLS/INP table gates); size-adjust 104.88% (glyph widths) was not re-derived.
