# Track 5a — non-blocking desktop backend (roadmap PR 8, desktop half)

Branch `perf/non-blocking-desktop`. Audit source: `../../05-blocking-analysis.md`
(M-1, M-3, M-4, M-6, W-3).

## What moved off the Electron main thread

| Audit | Before | After |
|---|---|---|
| M-4 single writer | Every SQLite write ran on the main connection; a write during an import/delete write lock blocked the event loop up to `busy_timeout` (5 s) | All `StorageWriteTask`s run FIFO on one writer thread (`workers/write-worker.ts`); handlers for tags, annotation deletes, comments, metrics, presets, gene lists, region files, analysis groups, transcripts, panels route through it. ApiCache writes skip instead of waiting on a lock |
| M-1 frequency upkeep | `updateFrequencies` after every import, `decrementFrequencies` / `recomputeAllFrequencies` around deletes, on main | Import worker updates per case (and decrements a replaced case); delete worker decrements per case inside the delete transaction, clears/recomputes after delete-all |
| Case delete | Worker delete, but frequency work on main; no progress, no cancel, not tracked | `case_delete` job: progress phases via `jobs:changed`, cooperative cancel (`jobs:cancel`) between cases, `cases:startDelete` returns a job id immediately |
| M-3 cohort export | Query (≤100k rows) + `aoa_to_sheet` + `XLSX.write` on main, no progress/cancel | Export worker (`workers/cohort-export.ts`), progress events, `export:cancel` (also variant export and PG CSV streams); variant pre-count in the read pool |
| W-3 ZIP | adm-zip read/inflate on main (desktop) / event loop (web) | Short-lived zip worker for inspect / password test / extract |
| M-6 startup | Window created after `await initDatabaseManager()` | Window created and painted first (boot splash in `src/renderer/index.html`), then the DB opens; IPC invokes wait on a startup gate |

## Measurements

`tests/perf/main-thread-blocking.perf.test.ts` runs each operation once with
the pre-PR code inline (what the main thread used to execute) and once
through the new worker path, recording the calling thread's longest
event-loop stall.

5,000,000-row fixture (20 cases x 250k) — `main-thread-blocking-20x250000.md`:

| Operation | Max main-thread block before | after |
|---|---:|---:|
| Cohort export (100k rows, XLSX) | 2,668 ms | 9.6 ms |
| Tag write while an import holds the write lock (1.5 s) | 1,559 ms | 5.5 ms |
| `recomputeAllFrequencies()` (batch delete) | 641 ms | 0 (runs in worker) |
| `updateFrequencies(case)` (after import) | 117 ms | 0 (runs in worker) |
| Case delete, 1 case (incl. main-thread decrement) | 191 ms | 36 ms |
| ZIP extract (4 x 6 MB JSON) | 24 ms | 5.9 ms |

The 720k-row run (`main-thread-blocking-12x60000.md`) shows the same shape.
Every after-path stays under the 50 ms long-task bar (asserted by the test).

Not changed here (follow-ups): a single-case delete still costs ~35 s wall
at 5M rows because the worker rebuilds the global FTS index and cohort
summary (audit D-1) — now off-main and reported as phases, but not
cancellable inside a rebuild phase; multi-file VCF append (M-2) and
rekey/encryption migration (M-5) still run on main; migrations still run
synchronously after the window is shown (they no longer delay the window).
