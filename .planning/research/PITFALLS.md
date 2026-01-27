# Domain Pitfalls

**Domain:** Adding SQLCipher encryption, cohort analysis, batch import, and external links to an existing Electron + better-sqlite3 desktop app (Varlens v0.3.0)
**Researched:** 2026-01-27
**Overall confidence:** HIGH (most pitfalls verified with multiple sources and cross-referenced against current codebase)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or security vulnerabilities. These must be addressed before or during the phase they affect.

---

### Pitfall 1: Swapping better-sqlite3 for better-sqlite3-multiple-ciphers Breaks the Entire Build Pipeline

**What goes wrong:** The project currently uses `better-sqlite3` v12.6.2 with a carefully tuned native module rebuild workflow: `postinstall` runs `@electron/rebuild -f -w better-sqlite3`, `npmRebuild: false` in electron-builder config, `asarUnpack` for `.node` files, and a dual rebuild workflow (Node.js for tests, Electron for packaging). Swapping to `better-sqlite3-multiple-ciphers` requires updating **every single reference** across `package.json` (postinstall, rebuild:electron, rebuild:node scripts), `electron.vite.config.ts` (rollupOptions.external), the electron-builder `asarUnpack` and `files` globs, both CI workflows (`build.yml` and `release.yml`), and the Linux CI step that installs `libsqlite3-dev`. Missing any one of these causes silent build failures or runtime crashes.

**Why it happens:** The current codebase has at least 8 places that reference `better-sqlite3` by name:
1. `package.json` dependencies
2. `package.json` postinstall script: `npx @electron/rebuild -f -w better-sqlite3`
3. `package.json` rebuild:electron script
4. `package.json` rebuild:node script: `npm rebuild better-sqlite3`
5. `electron.vite.config.ts` rollupOptions.external: `['better-sqlite3']`
6. `package.json` build.asarUnpack: `node_modules/better-sqlite3/**/*`
7. `package.json` build.files: `node_modules/better-sqlite3/**/*`
8. Source code import: `import Database from 'better-sqlite3'`

Developers often update the dependency and source imports but forget the build configuration, leading to the old module being externalized by Vite or unpacked by electron-builder while the new module is ignored.

**Consequences:**
- Runtime crash: `MODULE_NOT_FOUND` for `better-sqlite3` (Vite externalized it but the package no longer exists)
- Packaging failure: `.node` native binary not extracted from ASAR, causing `ENOENT` at runtime
- CI failure on all 3 platforms
- Dual-rebuild workflow breaks if `rebuild:node` still targets old package name

**Prevention:**
1. Create a migration checklist before starting. Grep for every occurrence of `better-sqlite3` in the entire repository: `grep -r "better-sqlite3" --include="*.ts" --include="*.json" --include="*.yml" --include="*.js"`
2. Update all references atomically in a single commit
3. Verify the CI matrix passes on all 3 platforms before merging
4. Test the dual rebuild workflow: `npm run rebuild:node && npm test && npm run rebuild:electron && npm run dist`

**Detection:** CI build fails on the first PR that swaps the dependency. If CI is not run, the app will crash on startup with a native module error.

**Confidence:** HIGH -- verified against current codebase files and [better-sqlite3-multiple-ciphers troubleshooting docs](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/troubleshooting.md).

---

### Pitfall 2: FTS5 Virtual Tables Fail When PRAGMA key Is Not Called Before Schema Initialization

**What goes wrong:** The current `DatabaseService` constructor initializes the schema immediately after creating the database connection: `new Database(dbPath)` followed by `initializeSchema(this.db)`. The schema includes FTS5 virtual tables (`variants_fts`) and FTS5 triggers. With an encrypted database, `PRAGMA key` must be executed **before** any schema operations, including creating or accessing FTS5 virtual tables. If the key is set after schema init, or if the schema init runs before the key, all operations will fail with "file is encrypted or is not a database."

**Why it happens:** The [SQLite3 Multiple Ciphers FAQ](https://utelle.github.io/SQLite3MultipleCiphers/docs/faq/faq_overview/) explicitly states that FTS5 extensions retrieve the FTS5 API pointer via a SELECT statement, and this will fail if `PRAGMA key` was not executed first. The current constructor does not have any key-setting step because the database is currently unencrypted. Adding encryption requires inserting a key step between connection creation and schema initialization -- a change to the constructor's flow that is easy to overlook.

**Consequences:**
- Encrypted databases cannot be opened at all
- FTS5 table creation fails silently or with cryptic "not a database" errors
- FTS5 triggers that fire on INSERT will cause variant imports to fail on encrypted databases

**Prevention:**
1. Modify `DatabaseService` constructor to accept an optional key parameter
2. Call `this.db.pragma('key = "..."')` immediately after `new Database(dbPath)` and before any other pragma or schema operation
3. Add a test that creates an encrypted in-memory database, sets the key, initializes the schema (including FTS5), inserts data, and verifies FTS5 search works
4. Order of operations must be: `new Database()` -> `PRAGMA key` -> `PRAGMA journal_mode` -> `PRAGMA foreign_keys` -> `initializeSchema()`

**Detection:** Tests that use `:memory:` databases without encryption will pass. Only tests against encrypted file-based databases will catch this. Add specific encrypted database tests early.

**Confidence:** HIGH -- verified via [SQLite3 Multiple Ciphers documentation](https://utelle.github.io/SQLite3MultipleCiphers/) and the current `DatabaseService.ts` constructor logic.

---

### Pitfall 3: Prepared Statement Cache Becomes Invalid When Switching Databases

**What goes wrong:** The current `DatabaseService` uses a `Map<string, Statement>` as a prepared statement cache (the `stmt()` method). When the user switches databases (opening a different `.db` file), all cached `Statement` objects become invalid because they are bound to the old database connection. Using stale statements causes segmentation faults or "database connection is closed" errors -- hard crashes with no graceful recovery.

**Why it happens:** better-sqlite3 prepared statements are native C++ objects tied to a specific `sqlite3*` connection handle. When `db.close()` is called, all statements associated with that connection are finalized. The JavaScript `Statement` objects still exist in the cache `Map`, but their underlying native handles are destroyed. Any call to `.run()`, `.get()`, or `.all()` on these stale statements will crash the process.

The current architecture uses a singleton pattern (`getDatabaseService()` in `database/index.ts`) that creates one `DatabaseService` for the entire app lifetime. Switching databases means closing this singleton and creating a new one -- but any IPC handler or import service that captured a reference to the old service (or its statements) will use the dead connection.

**Consequences:**
- Process crash (SIGSEGV / native crash) when using a stale prepared statement
- Silent data corruption if the old connection is not properly closed
- Race conditions if an import is in progress when the user switches databases

**Prevention:**
1. When closing a `DatabaseService`, clear the statement cache explicitly: `this.statementCache.clear()` in `close()`
2. In `database/index.ts`, when switching databases, set `databaseService = null` FIRST, then close the old service, then create the new one
3. Add a guard: if an import is in progress (tracked via `currentAbortController` in the import handler), reject the database switch request
4. All IPC handlers must call `getDatabaseService()` per-invocation (which they already do), never cache the service reference. Verify this pattern holds for any new handlers
5. Consider adding an `isClosed` flag to `DatabaseService` that causes all methods to throw a clear error instead of segfaulting

**Detection:** This bug only manifests when the user actually switches databases at runtime. Manual testing with database switching while data is loaded is required. Add an integration test that opens DB A, prepares statements, closes DB A, opens DB B, and verifies old statements throw rather than crash.

**Confidence:** HIGH -- verified via [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) which state that after `db.close()` no statements can be created or executed, and via the current codebase showing the statement cache in `DatabaseService.ts`.

---

### Pitfall 4: ZIP Extraction Path Traversal (Zip Slip) Allows File Overwrite Outside Target Directory

**What goes wrong:** When extracting password-protected ZIP files containing case data, a maliciously crafted ZIP archive can contain entries with paths like `../../../etc/important_file` or `..\..\AppData\important_file`. If the extraction code does not validate that resolved paths stay within the target extraction directory, files can be written to arbitrary locations on the filesystem. This is particularly dangerous in an Electron app running with the user's full filesystem permissions.

**Why it happens:** This is the well-documented [Zip Slip vulnerability](https://security.snyk.io/research/zip-slip-vulnerability). Common Node.js ZIP libraries have historically been vulnerable:
- `adm-zip` before v0.4.9 was vulnerable (CVE-2018-1002204)
- `jszip` before v2.7.0/v3.8.0 was vulnerable (CVE-2022-48285)
- Many extraction libraries do not validate paths by default

Developers assume ZIP entry names are safe filenames, but the ZIP format allows any string as an entry name, including directory traversal sequences.

**Consequences:**
- Arbitrary file overwrite on the user's system
- Potential code execution if overwriting executables or configuration files
- On Windows, UNC paths (`\\server\share\...`) in ZIP entries can trigger SMB connections

**Prevention:**
1. After resolving each entry's extraction path, verify it starts with the intended target directory:
   ```typescript
   const resolved = path.resolve(targetDir, entry.fileName);
   if (!resolved.startsWith(path.resolve(targetDir) + path.sep)) {
     throw new Error('Path traversal detected in ZIP entry');
   }
   ```
2. Reject entries containing `..` path segments
3. Reject entries with absolute paths
4. On Windows, also reject UNC paths (entries starting with `\\`)
5. Set a maximum decompressed size limit per file and total to prevent zip bombs
6. Use `unzipper` (streaming, password-protected ZIP support) rather than `adm-zip` (synchronous, blocks event loop)
7. Validate entry count (reject ZIPs with more than a reasonable number of entries)

**Detection:** Static analysis tools like Snyk or npm audit can flag vulnerable ZIP library versions. Add a test with a crafted ZIP containing traversal paths to verify rejection.

**Confidence:** HIGH -- well-documented vulnerability with [multiple CVEs](https://security.snyk.io/research/zip-slip-vulnerability) and [Node.js-specific proof of concepts](https://github.com/GPUkiller/ZipSlipNodeJS).

---

### Pitfall 5: shell.openExternal with Expanded Domain Allowlist Creates RCE Vectors

**What goes wrong:** The current `shell.ts` handler has a restrictive domain allowlist (`github.com`, `opensource.org`) and validates HTTPS-only. V0.3.0 will add external links to genomic databases (ClinVar, gnomAD, OMIM, UniProt, Ensembl, UCSC, etc.), requiring expanding the allowlist significantly. Each new domain is an attack surface. More critically, if the validation logic is relaxed (e.g., switching from allowlist to blocklist, or allowing `http:` for some domains), it opens multiple RCE vectors documented by [Benjamin Altpeter](https://benjamin-altpeter.de/shell-openexternal-dangers/):

- `file://` scheme: executes local files
- `\\server\share\program.exe`: opens remote executables on Windows via SMB
- `ms-msdt:` and other Windows protocol handlers: system command execution
- `.desktop` files on Linux via `xdg-open`: arbitrary command execution

**Why it happens:** Developers see the current secure pattern and think "just add more domains to the list." But the real risk is:
1. Constructing URLs from user-controlled data (e.g., building a ClinVar URL from a variant's clinvar field without sanitizing the value)
2. URL injection through malformed variant data that was imported from an untrusted source
3. Open redirect vulnerabilities on allowlisted domains that could redirect to malicious URIs

**Consequences:**
- Remote code execution on the user's machine
- Data exfiltration via crafted URLs
- Phishing through open redirect chains

**Prevention:**
1. Keep the allowlist approach -- never switch to a blocklist
2. Build external URLs in the main process from validated components, not by passing raw URLs from the renderer:
   ```typescript
   // GOOD: Main process builds URL from validated gene symbol
   const url = `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(validatedTerm)}`

   // BAD: Renderer passes arbitrary URL string
   shell.openExternal(untrustedUrl)
   ```
3. Validate that the final URL after construction still matches the allowlist
4. URL-encode all variable components to prevent injection
5. Normalize URLs before validation (handle punycode, percent-encoding tricks)
6. Test with adversarial inputs: `javascript:`, `data:`, `file:`, `\\`, `%00`, etc.

**Detection:** Security review of every URL template added. Automated test that attempts to open disallowed protocols and domains through the IPC handler.

**Confidence:** HIGH -- verified via [Electron security documentation](https://www.electronjs.org/docs/latest/tutorial/security) and [documented real-world CVEs](https://benjamin-altpeter.de/shell-openexternal-dangers/) in Jitsi Meet Electron, Wire Desktop, and others.

---

### Pitfall 6: Migrating Existing Unencrypted Databases to Encrypted Format Loses Data

**What goes wrong:** When adding SQLCipher support, the app must handle existing users who already have an unencrypted `varlens.db` with imported cases and variants. SQLCipher cannot encrypt a database in-place -- it requires creating a new encrypted database and copying all data. If the migration fails mid-way (disk full, crash, power loss), the user loses both the original and the encrypted copy.

**Why it happens:** The [official SQLCipher migration approach](https://discuss.zetetic.net/t/how-to-encrypt-a-plaintext-sqlite-database-to-use-sqlcipher-and-avoid-file-is-encrypted-or-is-not-a-database-errors/868) uses `ATTACH` and `sqlcipher_export()` to copy data from an unencrypted database to a new encrypted one. This is a multi-step process:
1. Open the unencrypted database
2. Attach a new encrypted database
3. Export all data to the encrypted copy
4. Close both
5. Replace the old file with the new one

Steps 4-5 are the danger zone. If the process crashes after step 3 but before step 5, you have two databases and the app does not know which to use on restart.

**Consequences:**
- Complete data loss for existing users if migration fails without rollback
- Corrupted state where the app tries to open an encrypted database without a key, or an unencrypted database with a key
- User confusion if the app silently switches between encrypted and unencrypted modes

**Prevention:**
1. Use a safe migration pattern with atomic rename:
   - Export to `varlens.db.encrypted` (new file)
   - Verify the new file can be opened with the key and contains the expected data (row count check)
   - Rename `varlens.db` to `varlens.db.backup`
   - Rename `varlens.db.encrypted` to `varlens.db`
   - Only delete `varlens.db.backup` after successful verification
2. Keep the backup for at least one app session
3. Add a migration state flag (in a separate file, not the database) to track progress and resume on crash
4. Consider making encryption opt-in for v0.3.0 and mandatory in a later version, reducing migration pressure
5. Test with large databases (hundreds of thousands of variants) to ensure migration does not timeout or run out of memory

**Detection:** Test the migration path with both success and simulated failure (disk full, permission denied). Test with databases from v0.2.0 to ensure backward compatibility.

**Confidence:** MEDIUM -- the migration approach is well-documented for SQLCipher, but the specific behavior of `better-sqlite3-multiple-ciphers` with `ATTACH` and `sqlcipher_export()` has not been verified against the library's docs. The `key()` and `rekey()` API methods may offer a simpler path that needs investigation.

---

## Moderate Pitfalls

Mistakes that cause delays, rework, or degraded user experience. These should be addressed during the phase but are recoverable.

---

### Pitfall 7: Cohort Aggregation Queries Block the Main Process and Freeze the UI

**What goes wrong:** Cohort analysis requires aggregating data across multiple cases -- for example, counting variant frequency across all cases, computing average allele frequencies per gene, or finding shared variants. These aggregate queries with `GROUP BY` across large datasets (hundreds of thousands of rows across many cases) are computationally expensive. Since `better-sqlite3` is synchronous and runs in Electron's main process, a long-running aggregation query blocks the entire event loop, freezing the UI and making the app unresponsive.

**Why it happens:** The current architecture runs all database operations synchronously in the main process (by design -- `better-sqlite3` is synchronous). For single-case queries with cursor pagination, this works well because each query returns quickly. But cohort aggregation queries that scan across all variants in all cases cannot be paginated in the same way -- they need to process the full dataset to produce aggregate results.

A query like `SELECT gene_symbol, COUNT(*) as case_count, AVG(gnomad_af) FROM variants GROUP BY gene_symbol` across 50 cases with 10K variants each (500K rows total) could take several seconds, during which the UI is completely frozen.

**Consequences:**
- App appears hung during cohort analysis
- Users may force-quit the app, potentially corrupting the database
- Electron may show "page not responsive" dialogs on Windows/Linux

**Prevention:**
1. Pre-compute aggregation results using materialized summary tables (insert-time aggregation):
   - When a case is imported, update summary tables (e.g., `gene_variant_counts`, `variant_frequency`)
   - Cohort queries read from pre-computed tables instead of scanning raw variants
2. If real-time aggregation is needed, break queries into chunks and yield to the event loop between chunks
3. Consider using `worker_threads` for heavy aggregation (note: there is a [known Electron bug](https://github.com/electron/electron/issues/43513) with better-sqlite3 in worker threads -- verify this is resolved for Electron 40)
4. Add appropriate indexes for aggregation queries:
   - `CREATE INDEX idx_variants_gene_case ON variants(gene_symbol, case_id)`
   - Use `EXPLAIN QUERY PLAN` to verify index usage
5. Set `PRAGMA cache_size` and `PRAGMA mmap_size` for better read performance during aggregation
6. Show a progress indicator for cohort operations that may take more than 500ms

**Detection:** Performance test with realistic data volumes (50+ cases, 10K+ variants each). Profile query execution time with `EXPLAIN QUERY PLAN` and wall-clock timing.

**Confidence:** HIGH -- verified against the current synchronous architecture in `DatabaseService.ts` and [SQLite performance documentation](https://sqlite.org/optoverview.html).

---

### Pitfall 8: Cross-Platform Native Module Compilation Fails for better-sqlite3-multiple-ciphers

**What goes wrong:** `better-sqlite3-multiple-ciphers` has a larger native code footprint than `better-sqlite3` because it bundles SQLite3 Multiple Ciphers (which includes OpenSSL crypto). The current CI installs `libsqlite3-dev` on Linux, but the encrypted variant may need additional system dependencies (OpenSSL development headers) or have different compilation requirements. Windows requires Visual Studio Build Tools with C++ workload. macOS may need specific SDK versions.

**Why it happens:** The current `build.yml` Linux step installs:
```yaml
sudo apt-get install -y libsqlite3-dev build-essential
```
This is sufficient for `better-sqlite3` which uses its bundled SQLite. But `better-sqlite3-multiple-ciphers` bundles SQLite3 Multiple Ciphers which may need `libssl-dev` for OpenSSL. The compilation flags and requirements differ per platform. Additionally, the [troubleshooting docs](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/troubleshooting.md) note that spaces in the project path cause compilation failures on Windows (node-gyp issue).

**Consequences:**
- CI builds fail on one or more platforms
- Release pipeline blocked until all 3 platforms compile successfully
- May need to add platform-specific compilation steps

**Prevention:**
1. Test compilation on all 3 platforms FIRST, before writing any feature code
2. Check if `better-sqlite3-multiple-ciphers` provides prebuilt binaries for Electron 40 (check [releases page](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/releases))
3. If prebuilds exist, `@electron/rebuild` may download them instead of compiling from source -- but verify this works with the current `@electron/rebuild` version (v4.0.2)
4. For Linux CI: add `libssl-dev` to the apt-get install list
5. For Windows CI: ensure the GitHub Actions runner has the C++ build tools (it does by default, but verify)
6. For macOS CI: test on both Intel and ARM runners if supporting both architectures
7. Run the full `npm ci && npm run rebuild:node && npm test && npm run rebuild:electron && npm run dist` sequence on all 3 platforms before merging the dependency swap PR

**Detection:** The CI matrix (`build.yml`) will immediately surface platform-specific compilation failures. Run the dependency swap as the first PR in the milestone.

**Confidence:** MEDIUM -- prebuilt binary availability for Electron 40 is not confirmed. The latest [better-sqlite3-multiple-ciphers release](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/releases) (v12.6.2) supports Electron but specific version coverage needs verification.

---

### Pitfall 9: Batch Import of Multiple Files Has No Per-File Error Isolation

**What goes wrong:** The current import system handles one file at a time with an `AbortController` for cancellation and case rollback on failure (deleting the case if import fails). Batch import of multiple files introduces a new failure mode: File 3 of 10 fails, but files 1-2 already imported successfully. Without proper isolation, the error from file 3 could cause:
- All 10 imports to be rolled back (losing files 1-2)
- The batch to abort entirely (files 4-10 never attempted)
- Inconsistent state (some files imported, some not, unclear which)

**Why it happens:** The current `ImportService.importVariants()` method creates a case, imports variants, and on error deletes the case. This per-file rollback is correct for single-file import. But a batch import wrapper that calls this method in a loop needs its own error handling strategy. The natural instinct is to use a single `try/catch` around the loop, which causes the entire batch to abort on the first failure.

**Consequences:**
- Users must manually retry failed files from a batch
- No clear feedback about which files succeeded and which failed
- If a ZIP contains 20 files and file 5 has a parsing error, the user may think nothing imported

**Prevention:**
1. Process each file independently with its own try/catch
2. Return a per-file result array:
   ```typescript
   interface BatchResult {
     results: Array<{
       fileName: string
       status: 'success' | 'error'
       caseId?: number
       variantCount?: number
       error?: string
     }>
     summary: { succeeded: number; failed: number; total: number }
   }
   ```
3. Continue processing remaining files after a failure (do not abort the batch)
4. Allow the user to cancel the entire batch (abort all remaining files)
5. Send progress updates per-file, not just per-variant: "File 3/10: importing variants... (2,450 of 8,000)"
6. Clean up failed files (delete case) but keep successful ones

**Detection:** Test with a batch where one file is intentionally malformed. Verify that other files in the batch are still imported correctly.

**Confidence:** HIGH -- verified against the current `ImportService.ts` error handling pattern and the current `import:start` IPC handler which tracks only a single `AbortController`.

---

### Pitfall 10: Database Singleton Does Not Support Multiple Open Databases for Cohort Comparison

**What goes wrong:** The current architecture uses a singleton `DatabaseService` pointing to a single `varlens.db` file. Cohort analysis across encrypted databases that are provided as separate files (e.g., from a password-protected ZIP) requires either:
- Importing all case data into the single database (current approach, extended)
- Opening multiple databases simultaneously using SQLite's `ATTACH`

If the design assumes `ATTACH`, the singleton pattern breaks. If the design imports into a single DB, the migration/encryption story becomes more complex (all data in one encrypted file vs. separate encrypted files per distribution).

**Why it happens:** The `getDatabaseService()` function in `database/index.ts` creates one `DatabaseService` and returns it for the app's lifetime. There is no mechanism to attach additional databases or manage multiple connections. The `DatabaseService` constructor hardcodes the connection setup with no support for `ATTACH DATABASE`.

**Consequences:**
- Architectural dead-end if cohort analysis requires cross-database queries
- Performance issues if all cases are imported into a single large database file
- Confusion about the data model: "Is each encrypted ZIP a separate database, or does everything go into one?"

**Prevention:**
1. Decide the data model early: single database (import all cases into one `varlens.db`) vs. multi-database (attach external encrypted databases for analysis)
2. Single-database approach (recommended for v0.3.0): import data from encrypted ZIPs into the main `varlens.db`. Encryption is only for transport (ZIP encryption), not for the local database. This avoids the `ATTACH` complexity entirely
3. If local database encryption is needed, it applies to the single `varlens.db` -- not per-case databases
4. Document the architecture decision before implementing

**Detection:** This is a design pitfall, not a code bug. It manifests as a late-stage realization that the architecture does not support the intended workflow. Address during design/planning, not during coding.

**Confidence:** MEDIUM -- depends on product requirements that are not fully specified. The single-database approach is simpler and consistent with the current architecture.

---

### Pitfall 11: Electron IPC Serialization Overhead Degrades Cohort Analysis UX

**What goes wrong:** Cohort analysis results (aggregated variant frequencies, shared variant lists, gene-level statistics across cases) can be large data payloads. Electron IPC uses structured clone to serialize data between main and renderer processes. For large result sets (e.g., 20,000 gene aggregations across 50 cases), the serialization/deserialization overhead can add 100-500ms of latency on top of the query time, making the UI feel sluggish.

**Why it happens:** The current `variants:query` IPC handler returns paginated results (typically 50-100 rows per page), keeping IPC payloads small. Cohort aggregation queries return summary data for the entire dataset, not paginated subsets. If a naive approach returns all aggregation results in a single IPC call, the payload can be megabytes.

**Consequences:**
- Sluggish cohort analysis UI, especially with many cases
- Renderer process may stall during deserialization of large payloads
- Memory spikes in both main and renderer processes

**Prevention:**
1. Paginate cohort results just like variant results -- use cursor-based pagination for aggregation results
2. Return summary statistics separately from detailed data (two IPC calls: one for totals, one for paginated details)
3. Use IPC for metadata, and consider using shared memory (`SharedArrayBuffer`) only if payloads consistently exceed 1MB (unlikely for aggregation summaries)
4. Profile actual payload sizes with realistic data before optimizing

**Detection:** Performance profiling with Chrome DevTools (Electron's built-in) during cohort analysis. Measure IPC roundtrip time separately from query time.

**Confidence:** MEDIUM -- potential issue but depends on actual data volumes. May not be a problem with small cohorts (<10 cases).

---

## Minor Pitfalls

Mistakes that cause annoyance or minor technical debt. Addressable during implementation without major rework.

---

### Pitfall 12: better-sqlite3-multiple-ciphers TypeScript Types Diverge from better-sqlite3

**What goes wrong:** The project uses `@types/better-sqlite3` (v7.6.13) for TypeScript types. `better-sqlite3-multiple-ciphers` adds methods (`key()`, `rekey()`, cipher-related PRAGMAs) that are not in the standard type definitions. Developers must either extend the types, use `@ts-ignore` comments, or find community type definitions. Additionally, the import path changes from `better-sqlite3` to `better-sqlite3-multiple-ciphers`, which the `@types/better-sqlite3` package may not cover.

**Why it happens:** TypeScript type definitions for the encrypted variant are maintained separately (if at all). The `@types/better-sqlite3` package will not include encryption-specific methods.

**Prevention:**
1. Create a local type declaration file (`src/main/database/better-sqlite3-mc.d.ts`) that extends the base types with encryption methods
2. Use `paths` in `tsconfig.json` to alias the import if needed
3. Check if `better-sqlite3-multiple-ciphers` ships its own type definitions (some versions do)

**Detection:** TypeScript compiler errors during `npm run typecheck`. Easy to fix but annoying if not planned for.

**Confidence:** HIGH -- the current `package.json` shows `@types/better-sqlite3` as a devDependency and source code uses typed imports.

---

### Pitfall 13: ZIP Bomb Exhausts Memory or Disk When Extracting Large Archives

**What goes wrong:** A zip bomb is a small compressed file that expands to an enormous size when extracted. For example, a 42KB ZIP file can expand to 4.5 petabytes. Even modest zip bombs (1MB compressed, 10GB expanded) can exhaust disk space or memory. If the batch import feature extracts ZIP files without size limits, a malicious or accidentally oversized archive can crash the app or fill the user's disk.

**Why it happens:** Developers focus on the happy path (reasonable ZIP files with case data) and do not consider adversarial inputs. The decompression ratio of ZIP can be extreme (1000:1 or more).

**Prevention:**
1. Check uncompressed size from ZIP central directory before extracting (if available -- note that this header can be spoofed)
2. Track bytes written during extraction and abort if total exceeds a reasonable limit (e.g., 5GB)
3. Track per-entry decompressed size and abort if any single entry exceeds a limit (e.g., 500MB)
4. Limit total number of entries in the archive (e.g., 1000 files max)
5. Use streaming extraction (`unzipper`) to avoid loading the entire archive into memory
6. Show extraction progress to the user so they can cancel suspicious operations

**Detection:** Test with a small zip bomb (e.g., 1MB -> 1GB expansion). Verify the extraction aborts before disk fills up.

**Confidence:** HIGH -- well-documented attack vector, especially relevant since the feature accepts user-provided ZIP files.

---

### Pitfall 14: External Link URL Templates Are Brittle Across Genomic Databases

**What goes wrong:** Building external links to genomic databases (ClinVar, gnomAD, Ensembl, UCSC Genome Browser, OMIM, UniProt) requires constructing URLs from variant data. Each database has its own URL format, query parameter conventions, and identifier requirements. URL formats change when databases update their web interfaces (e.g., gnomAD v2 vs v3 vs v4 URLs are different). Hardcoded URL templates break silently when databases update.

**Why it happens:** Genomic database URLs are not standardized:
- ClinVar: `https://www.ncbi.nlm.nih.gov/clinvar/?term={gene}` or by accession
- gnomAD: `https://gnomad.broadinstitute.org/variant/{chr}-{pos}-{ref}-{alt}?dataset=gnomad_r4`
- Ensembl: `https://www.ensembl.org/Homo_sapiens/Variation/Explore?v={rsid}` (requires rsID, not chr:pos)
- UCSC: `https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position=chr{chr}:{pos}-{pos}`

Some require data the app may not have (rsID for Ensembl), some require specific genome builds (GRCh38 vs GRCh37).

**Prevention:**
1. Define URL templates as configuration, not hardcoded strings:
   ```typescript
   const LINK_TEMPLATES = {
     clinvar: { template: 'https://...', requires: ['gene_symbol'] },
     gnomad: { template: 'https://...', requires: ['chr', 'pos', 'ref', 'alt'] }
   }
   ```
2. Only show links when the required data fields are present and non-null
3. Validate constructed URLs before allowing them to be opened
4. Consider a "link health check" in development (fetch HEAD to verify URLs resolve)
5. Version the URL templates so they can be updated without code changes

**Detection:** Manual testing of each external link type with real variant data. Broken links return 404 but the app does not know (opens in external browser). Consider showing a "link may not work" tooltip for databases with known instability.

**Confidence:** MEDIUM -- based on domain knowledge of genomic database URL patterns. Specific URLs need verification against current database versions.

---

### Pitfall 15: WAL Mode Journal Files Are Not Cleaned Up When Switching Databases

**What goes wrong:** SQLite WAL (Write-Ahead Logging) mode creates `-wal` and `-shm` companion files alongside the main `.db` file. The current `DatabaseService` enables WAL mode. When switching databases, if the old database is not properly checkpointed before closing, the `-wal` file may contain uncommitted data. If the user copies or moves the `.db` file without the companion files, data is lost.

**Why it happens:** `db.close()` in better-sqlite3 performs a checkpoint automatically, but only if there are no other connections to the database. In the current singleton architecture, this should work correctly. However, if database switching introduces any timing where the old connection is not fully closed before the new one opens (or if the same file is re-opened), WAL files may not be properly cleaned up.

**Prevention:**
1. Call `PRAGMA wal_checkpoint(TRUNCATE)` before closing a database connection to force WAL cleanup
2. After closing, verify that `-wal` and `-shm` files are removed (or at least empty)
3. When switching databases, follow this sequence: checkpoint -> close -> verify cleanup -> open new
4. Document that `.db` files should be copied with their companion files

**Detection:** Check for orphaned `-wal` and `-shm` files after database switch operations. The current test in `DatabaseService.test.ts` already cleans up WAL files in the `afterEach` block, which is good practice.

**Confidence:** MEDIUM -- the current close logic is simple (`this.db.close()`), and better-sqlite3 handles checkpointing on close. This becomes a real issue only with rapid database switching or improper close sequences.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Priority |
|---|---|---|---|
| SQLCipher migration | Build pipeline breakage (Pitfall 1) | Atomic dependency swap with full CI verification | CRITICAL -- do first |
| SQLCipher migration | FTS5 + PRAGMA key ordering (Pitfall 2) | Add encryption key step before schema init | CRITICAL |
| SQLCipher migration | Existing DB migration data loss (Pitfall 6) | Safe migration with backup and atomic rename | CRITICAL |
| SQLCipher migration | Cross-platform compilation (Pitfall 8) | Test all 3 platforms before writing features | HIGH |
| SQLCipher migration | TypeScript types divergence (Pitfall 12) | Create local type declarations | LOW |
| Database switching | Statement cache invalidation (Pitfall 3) | Clear cache on close, guard against stale refs | CRITICAL |
| Database switching | Singleton architecture (Pitfall 10) | Decide data model (single vs multi DB) early | HIGH |
| Database switching | WAL cleanup (Pitfall 15) | Checkpoint before close | MEDIUM |
| Batch import (ZIP) | Path traversal / Zip Slip (Pitfall 4) | Validate all extracted paths | CRITICAL |
| Batch import (ZIP) | ZIP bomb (Pitfall 13) | Size limits on extraction | HIGH |
| Batch import (ZIP) | Per-file error isolation (Pitfall 9) | Independent try/catch per file | HIGH |
| Cohort analysis | Main process blocking (Pitfall 7) | Pre-computed summary tables or chunked queries | HIGH |
| Cohort analysis | IPC payload size (Pitfall 11) | Paginate aggregation results | MEDIUM |
| External links | shell.openExternal RCE (Pitfall 5) | Allowlist + server-side URL construction | CRITICAL |
| External links | Brittle URL templates (Pitfall 14) | Configurable templates with data validation | LOW |

---

## Sources

### SQLCipher / Native Module Migration
- [better-sqlite3-multiple-ciphers GitHub](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) -- PRIMARY
- [better-sqlite3-multiple-ciphers troubleshooting](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/troubleshooting.md) -- PRIMARY
- [SQLite3 Multiple Ciphers documentation](https://utelle.github.io/SQLite3MultipleCiphers/) -- PRIMARY
- [SQLite3 Multiple Ciphers FAQ](https://utelle.github.io/SQLite3MultipleCiphers/docs/faq/faq_overview/) -- PRIMARY
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) -- PRIMARY
- [NODE_MODULE_VERSION mismatch issue](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/issues/55) -- SECONDARY
- [Electron support issue](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/issues/5) -- SECONDARY
- [SQLCipher unencrypted-to-encrypted migration](https://discuss.zetetic.net/t/how-to-encrypt-a-plaintext-sqlite-database-to-use-sqlcipher-and-avoid-file-is-encrypted-or-is-not-a-database-errors/868) -- PRIMARY

### ZIP Security
- [Zip Slip vulnerability research by Snyk](https://security.snyk.io/research/zip-slip-vulnerability) -- PRIMARY
- [Node.js Zip Slip protection guide](https://medium.com/intrinsic-blog/protecting-node-js-applications-from-zip-slip-b24a37811c10) -- SECONDARY
- [jszip CVE-2022-48285](https://security.snyk.io/vuln/SNYK-JS-JSZIP-3188562) -- SECONDARY
- [Node.js CVE-2025-23084 directory traversal](https://security.snyk.io/vuln/SNYK-UPSTREAM-NODE-8651420) -- SECONDARY

### Electron Security
- [Electron security documentation](https://www.electronjs.org/docs/latest/tutorial/security) -- PRIMARY
- [shell.openExternal dangers by Benjamin Altpeter](https://benjamin-altpeter.de/shell-openexternal-dangers/) -- PRIMARY
- [Electron APIs misuse by Doyensec](https://blog.doyensec.com/2021/02/16/electron-apis-misuse.html) -- SECONDARY

### SQLite Performance
- [SQLite query optimizer overview](https://sqlite.org/optoverview.html) -- PRIMARY
- [SQLite performance tuning (phiresky)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/) -- SECONDARY
- [SQLite built-in aggregate functions](https://sqlite.org/lang_aggfunc.html) -- PRIMARY

### Electron Native Modules / CI
- [Electron native module usage](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) -- PRIMARY
- [electron-builder multi-platform build](https://www.electron.build/multi-platform-build.html) -- PRIMARY
- [Electron worker_threads bug with better-sqlite3](https://github.com/electron/electron/issues/43513) -- SECONDARY
