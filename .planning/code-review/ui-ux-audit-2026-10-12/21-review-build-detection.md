# 21 — Review: feat/genome-build-detection (349d7bcf, vs merge-base 7cb76056; main is 64 commits ahead)

**What this change does:** It swaps the old chr1-only `GenomeBuildDetector` for a detector driven by a config file (`genome-builds.config.ts` + `shared/genome/genome-build.ts`). The detector gives a suggestion, a confidence level and its evidence. Every import path (single, multi-file, batch/folder/ZIP, JSON, web upload, SQLite and PG workers) now resolves the build through `resolveImportGenomeBuild`, which fails the file rather than falling back to GRCh38. The UI asks the user to confirm the build unless the contig lengths decide it.

**Checked, OK:** I diffed all 72 primary lengths (GRCh37, GRCh38 and T2T: 1–22, X, Y) by script against UCSC `hg19/hg38/hs1.chrom.sizes`, and all 72 match. Mito values: rCRS MT 16569, hg19 chrM 16571, hg38/hs1 chrM 16569. All correct. The ranking matches the design: lengths are definitive, tags strong, positions only exclude a build, and `contigKey` strips `chr`. The code never splits GRCh37 from hg19 (one id, `GRCh37 (hg19)`). No `?? 'GRCh38'` is left on an import path (the leftovers are in the schema DEFAULT, `CaseRepository.createCase`'s unused default and the read-side `COALESCE`s). Callers in tests/e2e, ui-gates, bench and docs are updated. The tests are table-driven over the config and include a test that adding a build needs only config. Trust boundaries: IPC uses `GenomeBuildIdSchema`, and the web batch route checks the fallback. The radio group works by keyboard, `validate()` focuses it, and the info button has an aria-label.

## Should fix
1. **Web `import:start`/`startMultiFile` accept any build string** (`src/shared/api/schemas/import.ts:74-87`)
   - **What this is:** `normalizeImportVcfOptions` copies `genomeBuild` without checking it. The test at `dispatcher-adapters-auth-import.test.ts:871` even locks in `'hg38'` passing through.
   - **Problem:** A bad id gets past the HTTP trust boundary. It fails only later, inside the worker, after the upload is held and the job has started ("Unsupported genome build: hg38").
   - **Fix:** In `normalizeImportVcfOptions`, keep `genomeBuild` only if `GenomeBuildIdSchema.safeParse` passes, otherwise return 400 in the route. Update that test to expect the rejection.
   - **If we skip it:** It does not store a wrong build, but web gets a late, confusing error and its checks no longer match the IPC side.
2. **hg19 chrM data is imported as GRCh37 with no warning** (`genome-builds.config.ts` GRCh37 `mito`, `genome-build.ts:91`)
   - **What this is:** A header with `chrM length=16571` counts as definitive GRCh37.
   - **Problem:** hg19's chrM is NC_001807, not rCRS. Its positions after about 310 are shifted, so chrM variants get wrong positions in GRCh37 (rCRS) links and annotations.
   - **Fix:** When a mito length matches only the 16571 entry, add one evidence line and one `BUILD_COPY` string ("mitochondrial positions use hg19 chrM (NC_001807), not rCRS"). Positions do not need rewriting.
   - **If we skip it:** hg19 mito calls are labelled as if they used rCRS coordinates, and the user never learns this.
3. **Dead code and config** (`genome-build.ts:284-311` `redetectStoredCaseBuild`, used only by tests; `primaryPrefix` and `mito.canonical` in the config, read nowhere even though a comment says "used by chromosome normalisation"; the `config/index.ts` re-exports nobody imports)
   - **Fix:** Delete them, and add them back with the follow-up migration that needs them. **If we skip it:** The config claims a normalisation link that does not exist.

## Nice to have
4. **RefSeq contig names give no length evidence.** `NC_000001.10` / `NC_000001.11` contigs (NCBI-style VCFs) are skipped by `contigKey`, so these files land on `none` even though their names and lengths decide the build. Map an `NC_0000xx.<ver>` name to its primary, and add `gcf_000001405.25` / `.26`+ as aliases.
5. **`##GATKCommandLine` / `##DRAGENCommandLine` match aliases anywhere in the whole command line.** A stray `…b37…`/`hg19` resource path in a GRCh38 file turns definitive lengths into `conflict`. In a batch that file is then skipped (`resolve-genome-build.ts:91`). It is safe, but it adds friction. Scan only the reference argument of those lines.

Verdict: fix 1 and 2 first (both small). Lean: about -45 lines possible (3).
Not checked: I ran no tests and no make targets (read-only review, and switching the native ABI would modify the worktree). I did not open the UI in the dev app. NCBI assembly reports were not fetched separately; UCSC chrom.sizes (identical for primaries) served as the source.
