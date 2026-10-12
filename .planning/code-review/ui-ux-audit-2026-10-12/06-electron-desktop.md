# 06 — Electron desktop build: hands-on UI/UX audit

- **Date:** 2026-10-12 · **Build:** v0.83.0 (`bfd3d80e`), Electron 43.7.7 (ABI 148), production renderer (`out/`), SQLite (better-sqlite3-multiple-ciphers).
- **Runtime:** Playwright `_electron` with isolated `userData`/`appData`, run under `xvfb-run` (X11, `--ozone-platform=x11`), 1440×900 window (plus 1280×720, 1024×640, 1920×1080, and `--force-device-scale-factor=2`). Native dialogs were stubbed in the main process (`dialog.showOpenDialog` / `showSaveDialog`, `shell.showItemInFolder`).
- **Data:** `single-sample.vep.vcf.gz` (HG005, 1,585 variants), `trio-region.snpeff.vcf.gz` (HG005/6/7), `synthetic-sv.vcf`, `synthetic-cnv.vcf`, `synthetic-str.vcf`. That gives 6 cases per database, in two databases: one with an OS keyring and one without.
- **Evaluator:** one (this agent). The schema asks for ≥ 2, so treat these scores as a single evaluator's input to the median.
- **Screenshots:** `screenshots/electron/NN-*.png`. **Scripts:** `~/.cache/varlens-session/uiux-1012/electron/` (`daemon.js` is the exploratory driver, `film.js` the start-up filmstrip, `cls.js` / `cr.js` are the schema snippets 7.1 / 7.3).
- **Product-owner rule applied:** small text and controls are intentional. Nothing in this report asks for larger text, chips or controls. Legibility is judged by contrast, weight and font only.
- **Labels:** VERIFIED = reproduced in the running app (screenshot, measurement or file on disk). SUSPECTED = from reading the code only.

---

## 1. Summary

The desktop shell is quick. The app is interactive 343–428 ms after launch (`app-ready` 44 ms → `window-created` 79 ms → `database-ready` 358 ms → `renderer-interactive` 428 ms). The window now opens before the database. Sort, page change and filter on the case table cause **zero** layout shift and finish in 50–80 ms. Import of a 1,585-variant VCF finishes in under 0.5 s. The keyboard triage loop works (click a row, Esc, ↓, `a` opens the ACMG dialog for the selected row; ACMG has Undo). Dark theme is reachable and mostly well tuned (`#12141a` background, 87 % text).

Several desktop-specific paths are broken, though, and most of them are first-run or data-safety paths:

- Gene burden never finishes, and Cancel does not recover it.
- The case list does not refresh after an import, so a first-time user sees "No cases yet" after a successful import.
- An export can overwrite the open database file. This was verified: the database was destroyed.
- "Open…" on a password-protected database does nothing.
- On a machine without an OS keyring, the first run has no database, but the app still invites the user to import, and the import fails with a generic error.

**Overall (desktop views): O_raw = 67.6, O = 67.6 → "needs work".** The binding cap would be 79 (an interaction CLS of 0.31 is over the 0.02 budget), but O_raw is already below it. There is no open P0. The export-over-database finding was rated P1 rather than P0 because the user has to pick the database file in the save dialog, and the OS normally asks for overwrite confirmation.

## 2. Per-view scorecard (desktop)

Bands are 0/25/50/75/100. The caps from schema §1.2 are applied. `—` means not applicable; `n/t` means not tested (left out of the mean). D4 was not tested for this run: no CVD simulation was done in Electron. The case-table and cohort colour work belongs to agents 02 and 03.

| View | vw | D1 | D2 | D3 | D5 | D6 | D7 | D8 | D9 | D10 | D11 | D12 | D13 | D14 | **V** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Desktop shell: first run, DB picker, encryption, PG dialog (maps to schema "Login") | 8 | 75 | 75 | 75 | 50 | 75 | 100 | 75 | 50 | 75 | 25 | 75 | — | 50 | **68.5** |
| Import (native dialog → wizard) | 9 | 75 | 75 | 75 | 75 | 75 | 100 | 75 | 75 | 75 | 50 | 50 | 75 | 75 | **73.7** |
| Case variant table (desktop rendering) | 22 | 50 | 75 | 50 | 50 | 50 | 75 | 75 | 75 | 75 | 75 | 50 | 75 | 75 | **66.2** |
| Variant details panel | 16 | 75 | 75 | 50 | 75 | 50 | 75 | 75 | 75 | 75 | 75 | 75 | 50 | 75 | **68.4** |
| Cohort + gene burden | 13 | 75 | 75 | 50 | 75 | 75 | 25 | 75 | 75 | 50 | 25 | 50 | 50 | 75 | **58.5** |
| Export (XLSX via save dialog) | 5 | 75 | 75 | 75 | 75 | 75 | 100 | 75 | 75 | 75 | 25 | 75 | 50 | 75 | **70.7** |
| Settings / preferences / theme | 4 | 75 | 75 | 75 | 75 | 75 | 100 | 75 | 50 | — | 75 | 75 | — | 50 | **74.0** |
| Keyboard shortcuts | 3 | 75 | 75 | 75 | — | — | — | 75 | 75 | 75 | — | 75 | — | 100 | **77.2** |
| About / FAQ / disclaimer | 2 | 75 | 75 | 75 | — | — | — | 75 | 50 | — | — | 75 | — | 75 | **71.8** |
| **Weighted (Σvw = 82)** | | | | | | | | | | | | | | | **67.6** |

Gates: there is no P0. D13 is ≥ 50 on the table and the details panel, and D8 is ≥ 50 on every core view. The CI-threshold cap of 79 applies because panel open/close shift is 0.20 and 0.31 including input-adjacent shifts. It does not bind, so **O = 67.6**.

**Key measurements (VERIFIED):**

| Metric | Value |
|---|---|
| Start-up milestones (3 launches) | interactive at 343 / 428 / 685 ms. The 685 ms launch was the filmstrip run with a dark preference. |
| Case table: sort, page next, page previous (×3) | 51–78 ms, CLS 0 every time |
| Filter chip "Rare (1%)" / Ctrl+Shift+X clear | 305 / 51 ms, CLS 0.001 |
| Case → Cohort switch | CLS 0.0116 (no input) |
| SNV/Indel tab open | CLS 0.0115. The source is the sidebar's `v-infinite-scroll__side` and the toolbar button group. |
| Details panel open / close | **CLS 0.200 / 0.306 (input-adjacent).** The source is `div.table-container` moving 22 px vertically. |
| Rows visible | 15 at 1440×900, 11 at 1280×720, 6 at 1024×640 (minimum window size), 19 at 1920×1080 (all with the sidebar open) |
| Table scroll width vs. viewport | 2032 / 1135 px at 1440. 2712 / 1614 px at 1920: the columns grow with the window. |
| Import time | 1,585-variant VEP VCF < 400 ms; 3-sample trio ≈ 500 ms |
| Export | 1,585 rows to XLSX in 567 ms; file checked with openpyxl |

## 3. Findings

### P1

**E-01 · Gene burden never completes on desktop, and Cancel does not recover it** · Cohort → Gene Burden · D7, D11 · VERIFIED (behaviour), root cause SUSPECTED with high confidence.
Repro: Group A = HG005 + HG006, Group B = HG007 + HG005-VEP, Fisher, then Run. The progress bar reaches "52 / 52 genes" within about 1 s and then stays there for more than 35 s. No results are shown. Cancel changes nothing, and the footer keeps showing "Association analysis" (`46-gene-burden-result.png`, `48-gene-burden-cancel.png`). The main log has no error.
Root cause: `src/main/statistics/WorkerPool.ts:66` resolves a batch only on the worker's `'exit'` event. `src/main/statistics/worker.ts` handles `message` and never exits or closes `parentPort`, so the promise never settles. `abort()` (`WorkerPool.ts:50-53`) only reacts to the *next* message, and after the last result there isn't one.
Fix: post `{type:'done'}` at the end of the loop in `worker.ts`. In the pool, `terminate()` the worker and resolve on `'done'`, and terminate all workers in `abort()`. Add a unit test that `pool.run()` resolves for 1 gene and for 52 genes.

**E-02 · Imports never appear in the case list until the window is reloaded** · Import / sidebar · D11, D9 · VERIFIED (4 of 4 imports, including the very first one).
After "Succeeded: 1 · HG005-VEP (1,585 variants)" → Done, the sidebar still shows "No cases yet" or the old count (`16-import-done.png`, behind the dialog). Only Ctrl+R brings the cases in. A first-time user is likely to import again, and that fails with the generic error in E-08.
Root cause (SUSPECTED): `App.vue` `handleDialogBatchImportComplete` returns early with `if (!isWebRuntime()) return`. On desktop the refresh depends on the `batchImport.onComplete` listener in `useShellLifecycle.ts:99`, but that listener skips the wizard's run because "ImportWizard uses its own run ID" (`isCurrentBatchRun` is false).
Fix: remove the `isWebRuntime()` guard, or let the wizard's completion call `handleBatchImportComplete()` directly. `finishedOwnRuns` already dedupes. Add an E2E test that asserts the sidebar count after Done.

**E-03 · Export can overwrite the open database file and destroy it** · Export · D11 · VERIFIED.
The save-dialog stub was still pointing at the database file from database creation. One click on Export then wrote the XLSX over the open, encrypted `audit-db.sqlite`. The snackbar said "Exported to …/audit-db.sqlite", `file` reports "Microsoft Excel 2007+", and the bytes start with `PK`. The next export said "Export failed: file is not a database" (`35-export-done.png`). After a restart, that database asks for a password and then reports "Incorrect password" (E-09). With the real OS dialog, the user would have to pick the database file and accept a generic "Replace?" prompt, but nothing in the app stands in the way.
Fix: in the export save handler, refuse a target equal to the current database path or its `-wal`/`-shm` files, or any recent database path. Pass `filters: [{name:'Excel', extensions:['xlsx']}]` and force the `.xlsx` extension.

**E-04 · "Open…" on a password-protected database does nothing** · DB picker · D11 · VERIFIED.
Open… → pick `audit-db.sqlite` (custom password). No password prompt, no error, no log line appears. The IPC call returns `{success:false, needsPassword:true}` without `info`.
Root cause: `DatabasePicker.vue:355` requires `result.info !== undefined` before it shows the password dialog. Opening the same database from the Recent list works (`09-password-dialog.png`), because `handleOpenRecent` has no such check.
Fix: drop the `info` condition. Have `selectAndOpenFile` return the picked path so `pendingOpenPath` can be set.

**E-05 · First run without an OS keyring: no database, yet the app invites the user to import, and the import fails generically** · First run · D11, D14 · VERIFIED (`DBUS_SESSION_BUS_ADDRESS=disabled:`).
The log says "Default database was NOT created (reason: safe-storage-unavailable)". The UI shows the normal Welcome page with "Get started by importing your first variant file" and an Import Variants button. The only hint is the plain-text "No database" in the app bar (`39-nokeyring-after-disclaimer.png`). The import wizard runs all the way through and then says "Error: A database error occurred. Please try again." (`41-nodb-import-result.png`).
Fix: when no database is open, the empty state should say "No database open" and offer **Create database** / **Open database**, and Import should be disabled. Even better, open the existing "Set a Database Password" flow (`42-passphrase-setup.png`, which is well written) automatically on first run.

**E-06 · Opening or closing the details panel shifts the table by 22 px (CLS 0.20 / 0.31)** · Case table + panel · D6 · VERIFIED at 1440×900 with the sidebar open.
When the panel docks, the table gets narrower, the preset chip row ("Rare Pathogenic … Rare, not recurrent") wraps to a second line, and `div.table-container` moves down 22 px. It moves back on close. This is input-adjacent, so it counts under the project rule (CLS ≤ 0.02 including input-adjacent shifts). The result-count chip also collapses to a bare funnel icon (`30-details-panel.png`).
Fix: keep the preset row on one line (`flex-wrap: nowrap` inside the existing slide-group, with overflow into the ⚙ menu) so the toolbar height does not change. Keep the count chip visible.

### P2

**E-07 · The last-used database is not reopened on restart.** The app always opens `userData/varlens.db` and shows "No cases yet", even after the user worked in another database for the whole session (`63-relaunch-default-db.png`). Verified on 2 restarts. The recent list holds the right entry, but `lastOpened` is not used at start-up. Fix: open the most recent entry at start-up, ask for its password if needed, and fall back to the default with a "Last database could not be opened" banner. D9.

**E-08 · A duplicate case name gives "An unexpected error occurred. Please try again."** (`25-reimport-result.png`). The main log says `Duplicate case name`. The default case name is the VCF sample ID, so importing HG005 twice collides. The worker's plain `Error` is mapped to UNKNOWN by `src/main/ipc/serializable-error.ts:120`. Fix: throw an `InvalidParametersError` ("A case named 'HG005' already exists. Rename it in the preview step."). Better still, flag the conflict in the preview step, where the name field already is. D11.

**E-09 · A non-database or damaged file is reported as "Incorrect password. Please try again."** VERIFIED with the XLSX left behind by E-03. The user will believe they forgot the password. Fix: before trying the key, check the header. A ZIP `PK` signature or a plaintext `SQLite format 3` header is not a ciphertext file. Say "This file is not a VarLens database or is damaged." D11.

**E-10 · Users with a dark preference see a light full-window flash on every launch.** Filmstrip with the Dark preference saved: the boot splash is `rgb(240,244,248)` at 828 ms, and the app is dark from 1,199 ms (`62-dark-user-boot-frame0.png`). The causes are `src/main/index.ts:84` (`backgroundColor: '#F0F4F8'`) and `src/renderer/index.html:16-27` (`color-scheme: light`, light `#f0f4f8`, and a stale comment, "The app ships a light theme only"). Fix: store the resolved theme where the main process can read it before `createWindow()` and pass the matching `backgroundColor`. Use `color-scheme: light dark` with a `prefers-color-scheme` splash, or set a class on `<html>` from a synchronous preload value. D5.

**E-11 · HGVS with the transcript duplicated in the details header and on the clipboard.** It shows `ENST00000401950:ENST00000401950.7:c.2290G>T`. VEP's `HGVSc` already contains the transcript, and `VariantIdentitySection.vue:22-25` (display) and `:125-130` (copy) prepend it again. "Copy HGVS" therefore yields an invalid HGVS string. Fix: prefix only when `cdna` has no `:`. D13.

**E-12 · The export leaves out the analyst's work and some provenance.** XLSX checked: 17 fixed columns (`src/main/workers/export-pipeline.ts:24-40`). There is no ACMG classification, which was verified with an LP-classified row, no comments and no tags. gnomAD AF is stored as **text** (`'3.63e-5'`), so it cannot be sorted or filtered numerically in Excel. The "Export Info" sheet has the case, count, date and filters, but no genome build, source file, app version or database name. The row count and the filters themselves were correct (3 / 3 filtered, 1,585 / 1,585 unfiltered). D13.

**E-13 · Gene-burden progress label is unreadable.** Dark text "52 / 52 genes" sits on the navy determinate fill, and the Run button shows only a spinner with no label (`46-gene-burden-result.png`). Fix: use an on-primary text colour, or put the label outside the bar. D3.

**E-14 · Contrast in the desktop views (CR-scan, schema 7.3).**
- Light theme: the annotation-score chips in the details panel are at **1.81:1** (`gnomAD 0.996`, rgb(189,189,189) on #fafbfd) and 2.59:1 (`CADD --`, `MODIFIER`). These chips carry values, so the faded style must not be used for them.
- Dark theme: "Fetch VEP" is at **2.31:1** (#673ab7 on #1a1d22).
- Dark theme: the app bar and sidebar header are large saturated light-blue fills (`58-details-dark.png`). That causes glare on a dark canvas, contrary to the schema's D5(b). Use the dark surface with a primary accent instead.
- There is a white scrollbar-corner square at the bottom-right of the table in dark mode.
D3, D5.

**E-15 · Cohort counts mix variant types.** The SNV/Indel cohort view shows "2,347 / 2,356" while "No filters applied" is displayed. The difference (9) is exactly the 5 SV + 4 STR variants, so the denominator ignores the Variant Type selector. **SUSPECTED:** the carrier frequency "4 / 66.67 %" uses all 6 cases as the denominator, including the SV-only and STR-only cases that cannot carry an SNV. That deflates cohort frequency (schema D13(g)). Fix: state "n = cases with SNV data" next to Cohort Freq, and scope the total to the selected type. D13.

**E-16 · Two overlapping import entry points; the preview never names the file.** "+" opens a menu with *Import VCF Files (multi-file case)* and *Import Data (one or many files)*, and both accept VCF. The VCF Preview step shows the format, annotator, variant estimate and build, but **not the file name or path** (`14-import-step2.png`), so the user cannot confirm the native-dialog pick. Fix: show the file name in "File Information" and add one line to each menu item saying when to use it. D12, D13.

**E-17 · The custom-password database accepts a 1-character password and gives no warning that it cannot be recovered.** `CreateDatabaseDialog.vue:118` only checks that the password is non-empty and that both fields match. "Set Recovery Passphrase…" lives only in the database menu. Fix: set a minimum length (for example 8), and add one sentence: "If you lose this password the database cannot be opened. Set a recovery passphrase." D11.

### P3

- **E-18 · Misaligned focus rectangle on every text field and on dialog containers.** The global `*:focus-visible { outline … !important }` (`assets/styles/custom.css:104`) draws a second rectangle on the `<input>` inside `v-field`. It cuts through the floating label and leaves out the append icon (`10-password-wrong.png`, `12-postgres-dialog.png`). It also draws one around `.v-overlay__content` on the disclaimer (`01-first-launch.png`). Fix: `.v-field__input:focus-visible, .v-overlay__content:focus-visible { outline: none }`, because `.v-field--focused` already shows focus.
- **E-19 · The password eye toggles are announced as "Password appended action" / "Confirm Password appended action".** Fix: give them `aria-label="Show password"` and swap the name when toggled.
- **E-20 · Database menu details.** The full-path tooltip opens on top of the "Recent Databases" header (`03-database-menu.png`). "Add PostgreSQL…" has a second, unexplained "+" on the right. Paths are truncated in the middle of the folder name.
- **E-21 · PostgreSQL dialog primary actions are icon-only** (Test, Save, Connect). They do have aria-labels and tooltips, but the most important action in the dialog has no visible label.
- **E-22 · Native menu is Electron's default.** It has File(Quit) / Edit / View, including **Toggle Developer Tools** and Force Reload, and Window. There is no Help or About, no "Check for updates", and no "Open database…" with Ctrl+O. `BrowserWindow` `title: 'Varlens'` (`index.ts:86`) uses different casing from the product name, though the renderer title overrides it. Fix: a small `Menu.setApplicationMenu` template (File: New/Open database, Import; Help: Shortcuts, FAQ, About, Check for updates; Toggle DevTools only when `!app.isPackaged`).
- **E-23 · Dialogs re-centre and jump.** It happens when Create Database's password checkbox is toggled (66 px) and between import wizard steps (top edge 215 → 319 px). Fix: anchor dialogs to the top (`location="top"`) or reserve a minimum height.
- **E-24 · Smaller feedback gaps.**
  - A case comment saves on blur without any "Saved" cue. The timestamp of an unrelated event shows under the empty comment field.
  - The "Worker Threads" slider sits at 0 with a greyed "Auto: 31 threads" label, so its auto state looks disabled.
  - The "No variants match your filters" empty state is centred in the 2,032 px scroll width and clipped at the right edge.
- **E-25 · Inconsistent value labels.** Consequence is shown as "intron variant" next to "Downstream" / "Upstream" in the same column, while the XLSX export has `missense_variant`. ClinVar shows the raw "Uncertain_significance" on the Shortlist but "Uncertain significance" on the SNV tab. Ref/Alt use thin `"Courier New"` in the case table but `ui-monospace` in the cohort table, so the same data has a different weight in the two views. This is a parity issue, not a size issue.
- **E-26 · (SUSPECTED, robustness)** The Postgres migration definitions run at module scope of `out/main/index.js`. The stack trace showed `readMigrationSql` called from top-level evaluation when the SQL directory was missing (only possible in this mirror setup), so every SQLite start does Postgres file lookups. In packaged builds the files exist. Worth confirming that the "dynamic import" documented in AGENTS.md still defers evaluation once electron-vite has inlined the module.

## 4. Desktop-only features (parity manifest `desktop-only`)

| Feature | UI | Result |
|---|---|---|
| `localDatabaseFiles` (create, open, recent, remove, delete, show in folder) | DB picker in the app bar | Create works (`04`–`07`). Recent works. **Open… with password is broken (E-04).** Remove/delete icons appear only on non-current entries (good). Show-in-folder not clicked. |
| `databaseEncryption` (managed key, custom password, change password, recovery passphrase, passphrase setup) | Create dialog, menu, password dialog | Managed key: automatic. Custom password: works, but weak (E-17). Wrong password message: clear. The no-keyring passphrase setup copy is good. A corrupted file is misreported (E-09). Change Password / Set Recovery entries present, not exercised. |
| `postgresProfiles` | "Add PostgreSQL…" dialog | Clear field grouping and sane defaults (localhost:5432, public, timeouts with units). Esc closes it. Icon-only actions (E-21). Not connected, per the brief. |
| `revealInFolder` | "Open folder" in the export snackbar | VERIFIED: calls `shell.showItemInFolder` with the exported path. |
| `workerThreads` | Preferences → Performance | Present. The auto state is ambiguous (E-24). |
| `mainProcessLogs` / `desktopDiagnostics` | Log viewer (Alt+Shift+L, footer icon) | Works and shows main-process entries with level filters (`60-log-viewer.png`). It overlays the whole window width, including the sidebar. |
| `autoUpdate` | Footer indicator only | Not testable here: the log says "Auto-updater disabled in dev mode" because the build is unpackaged. SUSPECTED from `AppFooter.vue:40-135`: the updater shows only for checking/available/downloading/downloaded/error. There is no idle "Up to date (v0.83.0)" state and no manual "Check for updates" entry (see E-22). |
| `geneRefUpdate` | Gene Panels dialog | The dialog opens (`61-gene-panels.png`). No gene-reference update control was visible in this state, so it was not exercised. |
| `rebuildSummary` | Cohort | Not surfaced in the UI during the test. |

## 5. Window behaviour, theme, high-DPI

- **Minimum size 1024×640 is enforced** (`getMinimumSize()` = [1024, 640]). At 1024 the header Case/Cohort buttons become icon-only and Columns/Export move into a kebab menu. The 280 px sidebar stays open and leaves room for 6 table rows (`50-min-1024x640.png`). Consider auto-collapsing the sidebar below about 1280 px.
- At 1280×720 there are 11 rows; at 1920×1080 there are 19 (`49`, `51`). There is no page-level horizontal overflow at any size.
- **Maximize** did not take effect under xvfb because there is no window manager (`isMaximized()` false). Not tested.
- **High-DPI (DPR 2):** crisp. SVG icons and text render sharply, and no bitmap assets blur (`59-hidpi-2x-crop.png`).
- **Theme:** System / Light / Dark is in Preferences → Display. It persists and is applied before the first interactive frame. System follows `prefers-color-scheme`: VERIFIED with `emulateMedia`, because Playwright pins the scheme to light and `nativeTheme` could not be checked. The dark palette meets the D5 guidance, apart from E-10 and E-14. The toggle is two levels deep (gear → Application Preferences). It is discoverable, but users have to look for it.
- **Keyboard:** `?` opens a correct shortcut sheet (`52-shortcuts-sheet.png`). `/` focuses search. Ctrl+Shift+X clears filters. Esc closes the panel. Enter opens the panel and moves focus to its `h2`. ↓ moves the row selection and `a` opens ACMG for the *selected* row. Typing `s` inside search does not trigger the star shortcut (2.1.4 OK). The native Alt menu bar could not be triggered through Playwright: not tested.
- **About:** there is no About dialog. The version is in the footer, with license, disclaimer and FAQ icons. The intended use is stated well in the disclaimer ("Research Use Only"), which is shown on first run and can be reopened from the footer (Alt+Shift+D).

## 6. Status of desktop-relevant findings from the 2026-10-06 audit

| Prior finding | Status | Evidence |
|---|---|---|
| Window created only after the database opens (05, M-6) | **FIXED** | `window-created` 79 ms < `database-ready` 358 ms; the boot splash is shown |
| Electron window has no `minWidth`/`minHeight` (06) | **FIXED** | 1024×640 enforced |
| Dark theme defined but unreachable; footer/mode toggle broken when forced | **FIXED** | Preferences toggle; dark footer readable (`57`, `58`). New issues are E-10 and E-14. |
| Dark-OS flash (dark → white → light app) | **STILL OPEN (changed form)** | Users with a dark preference now get light splash → dark app (E-10) |
| ACMG saves in one click with no undo | **FIXED** | "Classified as Likely pathogenic · Undo" snackbar |
| Focus does not move into the details panel | **FIXED** | Focus lands on the panel `h2.panel-heading` |
| Details panel overlays pagination/toolbar | **FIXED** | The panel docks and the table narrows (it now triggers E-06 instead) |
| Sidebar auto-collapses on case open (CLS 0.19) | **FIXED** | The sidebar stays open at 1440; cohort switch CLS 0.0116 |
| Skeleton swap and column jump on sort/page/filter | **FIXED (desktop)** | CLS 0 on 9 sort/page interactions, 50–80 ms |
| Clipped x-small icon buttons / 8 px "Fetch VEP" | **FIXED** | No clipped icons in any screenshot; Fetch VEP readable (dark contrast in E-14) |
| "? ?" unknown-status icons that read as help | **FIXED** | The case list shows names only; status is announced via aria-label |
| Export offered but failing (web/PG) | **N/A on desktop** | Desktop export works and the file is correct (E-03/E-12 are new) |
| Desktop main-thread freezes (cohort export with no cancel, re-encryption, migrations) | **NOT RETESTED** | The fixtures are too small; migration runs off the main thread ("v0 → v45 off the main thread in 60 ms") |
| Settings shows "Worker Threads" (web bug) | **N/A** | Correct on desktop |

Counts: **FIXED 9 · STILL OPEN 1 · REGRESSED 0 · N/A 3 · not retested 1.**

## 7. Nielsen's 10 heuristics (desktop, 0–4, 4 = no problem)

| # | Heuristic | Score | Evidence |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Import progress and the summary are good, and start-up feedback is instant. But the case list goes stale after an import (E-02), gene burden hangs at "52/52" (E-01), and comments save without any cue. |
| 2 | Match with the real world | 3 | Clear clinical vocabulary and a good passphrase-setup message. Remaining issues: raw "Uncertain_significance", duplicated HGVS prefix (E-11), and cohort counts that mix types (E-15). |
| 3 | User control and freedom | 2 | ACMG Undo and Esc work everywhere. But gene-burden Cancel does nothing, the last database is not restored (E-07), and nothing prevents overwriting the database (E-03). |
| 4 | Consistency and standards | 2 | Two import entry points, the default Electron menu with no Help/About, different mono fonts in case vs. cohort, and inconsistent consequence label casing. |
| 5 | Error prevention | 1 | Export can target the open database, a 1-character password is accepted, the import UI is offered with no database open, and duplicate names are only caught after the import runs. |
| 6 | Recognition rather than recall | 3 | Recent databases, the shortcut sheet, visible presets and chips. The import preview leaves out the file name. |
| 7 | Flexibility and efficiency | 3 | Keyboard triage loop, DSL search, Ctrl+Shift+X, preset chips, fast tables. |
| 8 | Aesthetic and minimalist design | 3 | Calm and dense. Minor issues: icon-only primary actions in the PG dialog, a saturated dark-mode app bar, and dialog re-centring. |
| 9 | Help users recognise, diagnose and recover from errors | 1 | "An unexpected error occurred", "A database error occurred" with no database, and "Incorrect password" for a damaged file. |
| 10 | Help and documentation | 3 | FAQ, disclaimer, shortcut sheet, footer docs link. No About dialog or update status. |
| | **Total** | **23 / 40** | Prior web audit: 20 / 40 |

## 8. What works (keep)

- Start-up is fast and non-blocking (window before database, interactive under 0.5 s), and the boot splash is styled.
- The case table is very stable: sort/page/filter cause 0 layout shift and respond in 50–80 ms on desktop.
- The import wizard detects format, annotator, build and samples (trio → 3 named cases) and imports in under 1 s, with a clear per-sample summary and a background-tasks tray.
- The no-keyring "Set a Database Password" dialog explains why it is needed.
- The keyboard triage loop works, the shortcut sheet matches the bindings, and single-key shortcuts do not fire while typing.
- The export is correct in content and row count, includes an "Export Info" sheet with the active filters, and "Open folder" reveals the file.
- Dark theme uses the recommended dark surface and 87 % text, and the theme preference persists.

## 9. Not covered / limits

- axe was not run inside Electron. The renderer is shared with the web build that `make ui-gates` audits.
- D4 (CVD) was not run. Mol* / 3D was not tested because WebGL is disabled in software GPU mode under xvfb (log: `webgl=disabled_off`).
- The following were not testable here: maximize (no window manager), the native Alt menu bar, updater states (unpackaged build), and import cancel (the imports finished in under 0.5 s).
- `make perf-interaction-gates` was skipped because it would need `make rebuild` of the worktree's native module, which the brief forbids.
- Root causes marked SUSPECTED come from reading code. The behaviour behind every P1 is VERIFIED.
- The Electron binary came from the main checkout (`/home/bernt-popp/development/VarLens/node_modules/electron`, same 43.7.7). The worktree had no downloaded binary. `cwd` was set to the worktree because the mirror has no `src/` and the main bundle resolves Postgres migration SQL relative to `cwd` (E-26). The first launch that had the session D-Bus available used the host's GNOME keyring through libsecret; the second launch disabled D-Bus to exercise the no-keyring path.
