# Review — PR 6 `fix/cohort-import-web-polish` (7 commits, +528/−133)

What this change does: the cohort table hides five SNV-only columns on the SV/CNV/STR tabs and drops the all-type total from its count pill. The gene burden table and plots show only tested genes, and warning codes become sentences from `domain.config.ts`. In the web edition a refused upload file is skipped, a session-loss 401 reloads the page to the login wall, the HTML shell is `no-store`, password hints come from `minPasswordLength()`, and the FAQ copy covers both editions.

Checked and fine: **(3) 401 reload.** It fires only on `401` + `UNAUTHENTICATED`. Every such path in `auth.ts`, `secure.ts` and `upload-staging.ts` either has no `session.user` or deletes the session first, and `page-gate.ts` checks the same `session.user`, so the reload always lands on `/login` and cannot loop. The login page is standalone vanilla JS and does not use `transport.ts`. Wrong-password answers (`{error:'old-password-invalid'}`) do not trigger it. `no-store` reaches only `index.html` (direct and SPA fallback). `assets/*` returns earlier and stays `immutable`. **(4) Passwords.** The server still enforces its own minimum: `PostgresWebAuthService` checks 12 and the desktop `PasswordSchema` checks 8. The client value only sets hints and disables buttons. **(5) Upload skip.** 400s are refused before staging. A per-file 413 runs `rm(uploadDir)` on the server. Quota (413 `upload-quota-exceeded`), network and cancel still abort and discard the refs already staged. **(1)** No new hardcoding beyond the column deny-list. **(2)** Parity holds; the case table's shared prefs key has the same order quirk. The FDR result does not change: untested genes have null p and BH skips nulls. The `isWebRuntime()` calls in UserManagement and AccountPasswordDialog are borderline against AGENTS.md's "never decide features with `isWebRuntime()`". They only pick a hint value, which I accept.

**Should fix**

1. **Hidden genes still show up in warnings and silently drop out of the export** (`GeneBurdenView.vue:163`, `association-results.ts:85`)
   - **What this is:** genes with `n_variants === 0` (that is, `sitesUsed === 0`) are now filtered out of the table, the plots and the TSV export.
   - **Problem:** every such gene still raises `ZERO_BURDEN`, so the warning list names genes the table no longer has. The TSV loses them without any `#` line. The note "without qualifying variants" is also wrong for a gene whose sites were all excluded for missing or conflicting calls. Those `sites_excluded` counts were the only record of why the gene went untested.
   - **Fix:** pass `results.results` to the export, or add a `# N genes not tested (no usable site)` comment line. Word the note "N genes not tested (no usable site)". Skip `ZERO_BURDEN` when `n_variants === 0` in `finalize.ts`.
   - **If we skip it:** a user who checks a gene panel against the export decides the genes were never in the cohort.
2. **A folder pick floods the alert with one message per index file** (`uploads.ts:283`, `ImportWizard.vue:361`)
   - **What this is:** `accept` is ignored when `webkitdirectory` is set, so every file in the folder gets POSTed.
   - **Problem:** a folder with 100 `.vcf.gz` files and 100 `.tbi` files sends all 100 `.tbi` bodies and yields 100 skip messages joined by ` · ` in one alert.
   - **Fix:** in `pickAndUploadFiles`, drop names that do not match the `IMPORT_ACCEPT` suffixes before uploading; the server check stays. Then show the count plus the first 3 names.
   - **If we skip it:** an unreadable wall of text and wasted upload bandwidth on large folders.
3. **The FAQ privacy list leaves out services the app contacts** (`faqConfig.json`, "How is my data stored?" and "Is my data shared")
   - **What this is:** the list of lookups that send identifiers off the machine.
   - **Problem:** it names neither NLM Clinical Tables (HPO term search, `HpoApiClient.ts:18`) nor InterPro and RCSB PDB (protein structure files). "For example" is weak cover on a privacy answer, and the same sentence appears twice.
   - **Fix:** add the three services. Optionally keep a single answer and point the second one to it.
   - **If we skip it:** phenotype search terms go to NLM, and the FAQ never says so.

**Nice to have**

4. **The cohort summary fetch is now dead code** (`useCohortData.ts:98,126,260,505`): nothing renders `summary`, yet `fetchSummary()` still runs after every rebuild, which on PostgreSQL is a full summary query for nothing. Delete `summary`, `fetchSummary` and the `else if (was)` branch, and remove the `totalCountStale` prop from `SlimFilterToolbar`, which no caller passes any more (−30 lines).
5. **(7) Count pill:** removing a wrong denominator is not a regression, and the pill colour still shows when a filter is active. No placeholder is needed until per-type totals land (DO-LATER in item 21).

Scope note: item 16 (genome-build hint) moved to `10-genome-build-detection.md`, and cohort `/`, Ctrl+Shift+F and "View in Case" already shipped in #565. Neither is missing from this PR.

Verdict: fix 1 first; 2 and 3 are cheap and should go in the same PR.
Lean: −30 lines possible.
Not checked: no tests or make targets were run (read-only; vitest would need a native rebuild); this review is by reading only.
