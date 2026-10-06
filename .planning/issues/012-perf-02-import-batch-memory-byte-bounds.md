---
id: "PERF-02"
number: 12
title: "Unbounded batch accumulation and synchronous JSON stream parsing during import"
priority: "P3 - Medium"
tags: ["performance", "import", "memory", "hardening"]
affected_files:
  - "src/main/import/transforms/BatchAccumulator.ts"
  - "src/main/workers/import-pipeline.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [PERF-02] Unbounded batch accumulation and synchronous JSON stream parsing during import

| Attribute | Value |
|---|---|
| **Priority** | **P3 - Medium** |
| **Tags** | `performance` `import` `memory` `hardening` |
| **Affected Files** | `src/main/import/transforms/BatchAccumulator.ts`, `src/main/workers/import-pipeline.ts` |
| **Audited Snippet** | `BatchAccumulator holds large variant arrays in memory without backpressure checks against V8 heap li...` |

---

## Technical Context & Audited Impact
App crashes with Out Of Memory during large WGS imports.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

**Verdict: PERF-02 is wrong as written. I recommend reclassifying it as a P3 hardening item.** The claimed memory growth doesn't happen in the code. There are three smaller, real gaps, listed under the assessment.

## 1. Technical assessment

**Claims that don't hold:**

- **The batches don't grow without limit.** `BatchAccumulator._transform` (`src/main/import/transforms/BatchAccumulator.ts:58-64`) pushes a record and, once it reaches `batchSize`, calls `flushFn` synchronously. Only then does it call `callback()`, and it replaces the array with a new one after each flush. Because the callback waits for the flush, Node's object-mode stream backpressure stops upstream reading while the flush runs. At most `batchSize` records are held at once.
- **The worker path is bounded the same way.** `streamInsertJson` and `streamInsertVcf` (`src/main/workers/import-pipeline.ts:294-309, 410-418`) pull records with `for await`. `stmts.insertBatch` is a synchronous `db.transaction` (line 122), so the loop can't read ahead of the write. The Postgres worker awaits each flush (`postgres-import-worker.ts:497, 756`), so it is bounded too.
- **The JSON parsing isn't a whole-file parse.** `stream-json`'s `parser → pick → streamArray` reads the file incrementally, and `JsonRecordBudgetTransform` rejects oversized records before they become objects. The synchronous SQLite write runs on the import worker thread, not the Electron main thread. That is intended.
- **Memory doesn't scale with the number of variants.** A 500k-variant import uses the same peak memory as a 50k one. The code comments say so ("proportional to batchSize, not file size"), and the code matches.

**Real gaps that remain (edge cases):**

1. **The batch limit counts records, not bytes.** The worker's default batch is `BATCH_INSERT_SIZE = 10_000` (`src/shared/config/database.config.ts:20`). The per-record limits allow 1 MiB per JSON record (`MAX_JSON_RECORD_BYTES`) and 64 MiB per VCF line (`MAX_LINE_BYTES`). So the theoretical worst case before a flush is about 10 GB of strings plus JS object overhead. Typical records are 1–5 KB, which gives 10–50 MB per batch. Valid but extreme input could still run out of heap, for example VEP CSQ annotations with hundreds of transcripts per variant.
2. **No `resourceLimits` on the import workers.** `new Worker(this.workerPath)` (`import-worker-client.ts:39`, `PostgresImportWorkerClient.ts:57`) sets no heap limit. A V8 out-of-memory fatal error in a worker can abort the whole Electron process. With `resourceLimits.maxOldGenerationSizeMb` set, only the worker is terminated, with `ERR_WORKER_OUT_OF_MEMORY`, and that can be shown to the user as an import error. This is the only route to the "app crashes" impact in the audit.
3. **No upper limit on the requested batch size.** `import-worker.ts:68` accepts `msg.batchSize ?? ...` with no maximum. The Postgres worker only checks that it is above zero (`postgres-import-worker.ts:230-232`). Only internal code sets it, so the risk is low, but it is unvalidated.

**Not verified:** whether `ImportService` (the in-process path that uses `BatchAccumulator`) ever runs on the main thread in production. If it does, its synchronous flushes would block the UI. That is a responsiveness problem, not memory.

## 2. Severity & priority

**P3 (Medium).** There is no confirmed out-of-memory failure, and memory doesn't scale with file size. Running out of memory requires adversarial or extreme per-record sizes, and the existing per-record limits already reduce that risk. The missing `resourceLimits` is the one item that turns a bad file into a full app crash, which is why this isn't P4.

## 3. Labels

`performance`, `hardening`, `import`, `robustness`, `audit-correction`

## 4. Issue specification

**Title:** `perf(import): bound import batches by bytes and isolate worker OOM with resourceLimits`

**Description & reproduction**

PERF-02 says `BatchAccumulator` and the worker import loops grow without limit. They don't: every path flushes at `batchSize` records, and stream or `for await` backpressure holds memory at one batch. The real gaps:

- Batches are limited by record count only. With the per-record limits (1 MiB JSON, 64 MiB VCF line) and a 10,000-record batch, worst-case memory per batch is in the GB range.
- Import workers have no `resourceLimits`, so a worker out-of-memory error can take down the whole app.
- `batchSize` from worker messages has no upper limit.

To reproduce, generate a simple-format JSON file with 20k variants, each carrying about 900 KB of annotation text (under `MAX_JSON_RECORD_BYTES`). Import it with the default batch size and watch the worker heap (`--trace-gc` or `process.memoryUsage()` in the worker). Heap should climb to several GB before the first flush. The simulator on `feat/variant-simulator` could produce this file.

**Expected behavior**

- Memory per batch stays within a fixed byte budget, whatever the record size.
- If a worker runs out of memory, the import fails with an error the user can act on ("import exceeded memory budget"). The app keeps running, and the partially imported case is rolled back by the existing cleanup in `import-finalization`.
- `batchSize` is clamped to a validated range.

**Proposed fix / architecture decision**

1. **Flush on records or bytes, whichever limit comes first.** Add `BATCH_INSERT_MAX_BYTES` (for example 64 MiB) to `DATABASE_CONFIG`. Track an approximate size per record: for JSON, the byte count the budget transform already computes; for VCF, `line.length`. Use a small shared helper, such as `createBoundedBatcher({ maxRows, maxBytes, flush })`, in `BatchAccumulator`, `streamInsertJson`, `streamInsertVcf`, and the Postgres worker. That replaces four copies of the push-and-flush logic.
2. **Set worker heap limits.** Pass `resourceLimits: { maxOldGenerationSizeMb }` in `ImportWorkerClient` and `PostgresImportWorkerClient`. Pick the value from `os.totalmem()` with a floor and a ceiling. Map `ERR_WORKER_OUT_OF_MEMORY` to a typed `ImportResourceLimitError` in the client.
3. **Validate `batchSize` in both workers.** Require an integer from 1 to 50,000 and reject anything else.
4. **Tests:**
   - Unit-test the batcher's dual-limit flush.
   - Write a worker test that sends oversized records and asserts the number of flushes.
   - Add a test that a worker hitting its heap limit rejects with the typed error rather than crashing the process.
   - Add one gated WGS import perf run (`VARLENS_RUN_WGS_PERF=1`) to show no throughput regression from byte-based flushing.

**Out of scope:** replacing `stream-json` or moving to async SQLite writes. Synchronous `better-sqlite3` writes on a worker thread are the intended design.

I didn't run any code or make targets for this; it comes from reading the source. The figures above are calculated from the configured limits, not measured.

Separately, several MCP connectors (Gmail, Google Calendar, genereviews-link, gtex-link, phentrieve, sysndd) need to be authorized in your claude.ai connector settings. Others (gnomad-link, hgnc-link, mgi-link, mondo-link, uniprot-link, mdr-mcp, pubator-link) failed to connect. None of them were needed for this review.
