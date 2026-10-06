---
id: "DATA-06"
number: 6
title: "Stale worker encryption keys and broken worker pool queries following database rekey"
priority: "P1 - Critical"
tags: ["security", "encryption", "database", "workers", "bug"]
affected_files:
  - "src/main/database/DatabaseService.ts"
  - "src/main/database/DbPool.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [DATA-06] Stale worker encryption keys and broken worker pool queries following database rekey

| Attribute | Value |
|---|---|
| **Priority** | **P1 - Critical** |
| **Tags** | `security` `encryption` `database` `workers` `bug` |
| **Affected Files** | `src/main/database/DatabaseService.ts`, `src/main/database/DbPool.ts` |
| **Audited Snippet** | `DatabaseService.rekey() runs PRAGMA rekey on the main SQLite connection, but does not update _encryp...` |

---

## Technical Context & Audited Impact
Users who change their database encryption password encounter worker thread crashes.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

# DATA-06: `PRAGMA rekey` leaves the stored key stale in every worker, and fails outright in WAL mode

## 1. Validated technical assessment

**The audit is correct, but it understates the problem.** I checked the code directly. I also tried to run a small script against the native module to test rekey under WAL, but the sandbox didn't allow it, so the WAL behaviour below rests on the code and the repo's own tests, not on a run.

**Confirmed (stale key):**
- `DatabaseService.rekey()` (`src/main/database/DatabaseService.ts:307-319`) runs `PRAGMA rekey` but never updates `this._encryptionKey`. After a rekey, `getEncryptionKey()` (`:300`) still returns the **old** key.
- `DbPool` copies the key into Piscina's `workerData` once, in `init()` (`src/main/database/DbPool.ts:84`). There is no way to rekey or re-initialise it. `SqliteStorageSession.rekey()` (`src/main/storage/sqlite/SqliteStorageSession.ts:158-160`) just forwards the call and leaves `dbPool` alone.
- **The impact is wider than `DbPool`.** Every worker the main process starts after a rekey gets the stale `db.getEncryptionKey()`:
  - import (`SqliteImportExecutor.ts:158`, `batch-import-logic.ts:179`)
  - export (`export-logic.ts:134`)
  - delete (`cases-logic.ts:149,197,242`)
  - rebuild-summary (`cohort-logic.ts:446,469`)
  - append (`import-logic-append.ts:69`)
- With a stale key, SQLite reports "file is not a database" (`SQLITE_NOTADB`) and Piscina rejects the task. Users see failed IPC calls (empty or errored views, failed imports and exports), not a process crash. Piscina workers spawn lazily (`minThreads: 1`, plus an idle timeout), so the failure is intermittent: an idle-reaped worker comes back with the old key.

**What the audit missed (a likely primary defect):**
- Production connections run in WAL mode: `DatabaseService.ts:86` and `db-worker.ts:43`.
- The repo's own tests state that rekey is not supported in WAL. They switch to `journal_mode = DELETE` before every rekey (`tests/main/database/sqlcipher.test.ts:305,445,468`). `DatabaseService.rekey()` makes no such switch.
- So in production, `rekey()` most likely throws `DatabaseError('Failed to change database encryption key')` every time. In that case the stale-key path is never reached, and the feature is simply broken.
- You also can't fix this by just adding a journal-mode switch inside `rekey()`. Leaving WAL needs exclusive access, and the pool keeps at least one open read connection (`minThreads: 1`).

**Scope limits:**
- `rekeyDatabase()` (`database-lifecycle-logic.ts:416-434`) refuses databases managed by the key-store. Only legacy databases with an explicit user password are affected.
- Postgres is not affected.
- Restarting the app recovers, because the user types the new password and every key is rebuilt.

**Data-loss risk.** If the rekey does succeed (for example, the WAL file happens to be checkpointed and empty), a worker that is reading or writing during the rewrite could hit a database that is half old key, half new key. The delete and import workers write. Today nothing coordinates or blocks those workers during a rekey.

## 2. Severity and priority

**P2 (High).**
- **Why not P3:** it makes an advertised security feature (changing the password) unusable. In the success case it silently breaks every background read and write path for the rest of the session, and there is a real risk of corrupting data if a rekey overlaps a write.
- **Why not P1:** the reachable surface is narrow (legacy explicit-password databases only; managed databases are blocked by design), and an app restart recovers.

## 3. Labels

`bug`, `data-integrity`, `security`, `architecture`, `area:sqlite`, `area:workers`

## 4. Issue specification

### Title

`fix(database): rekey fails in WAL mode and leaves stale key in DatabaseService, DbPool, and all spawned workers`

### Description and reproduction

1. Create or open a legacy SQLite database encrypted with an explicit password (not managed by the key-store).
2. Load the case list so the `DbPool` worker starts.
3. Change the database password through the rekey IPC path (`rekeyDatabase`).
4. **Expected to see:** the rekey fails with "Failed to change database encryption key" because the connection is in WAL mode.
5. If the rekey succeeds (for example, a test harness has already switched to DELETE), then:
   - Wait for the worker idle timeout, or trigger an import, export, or delete.
   - **Observed:** `SQLITE_NOTADB` errors from the workers. `getEncryptionKey()` still returns the old key.

### Expected behaviour

- Rekey either completes atomically or fails without changing anything.
- After it succeeds, every connection in the process uses the new key: the main connection, the `DbPool` workers, and any one-shot worker spawned later.
- WAL mode is restored afterwards.
- No other connection is open while the rekey runs.

### Proposed fix and architecture decision

Do this as an orchestrated operation at the session level, `SqliteStorageSession.rekey()` (it becomes async). Don't do it as a single pragma call.

1. **Quiesce.** Refuse to start (typed `DatabaseError`) while an import, export, delete, or rebuild worker is running. The managers that start these workers already track them, so reuse that. Then `await dbPool.destroy()`.
2. **Get exclusive access and rekey:**
   - `wal_checkpoint(TRUNCATE)`
   - `journal_mode = DELETE` (check the returned value really is `delete`; throw if not)
   - `PRAGMA rekey`
   - `journal_mode = WAL`
3. **Commit the key in memory.** Add `DatabaseService.setEncryptionKey()`, or have `rekey()` set `_encryptionKey` itself, **only after** step 2 succeeds.
4. **Rebuild the pool.** `dbPool.init(path, newKey, sameOptions)`. To allow this, keep `geneRefDbPath` and `maxThreads` on the session, and fix `DbPool.init()`, which currently ignores a second call once it has been initialised (it allows re-init only after `destroy()` resets `initOptions`).
5. **On failure, restore** WAL mode and re-init the pool with the **old** key. Never leave the session without a pool.
6. Keep the managed-key guard in `rekeyDatabase()` unchanged.

### Tests (`tests/main/storage/` and `tests/main/database/sqlcipher.test.ts`)

- Rekey on a **WAL** database opened through `createSqliteStorageSession` succeeds, and `getEncryptionKey()` returns the new key afterwards.
- A `dbPool.run({ type: 'cases:list' })` after the rekey succeeds; this covers the case where the pool is torn down and rebuilt.
- Rekey is rejected while a write worker is running.
- When the rekey fails, the original key and pool still work.
- Remove the manual `journal_mode = DELETE` workarounds from the existing tests. They are what hid this bug.

**Verification gate for the fix PR:** `make rebuild-node && make test`, then `make ci-full`. It touches workers and the database lifecycle.
