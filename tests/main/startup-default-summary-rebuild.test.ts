// @vitest-environment node
/**
 * The automatic start of the desktop app: the default database is opened
 * without a user action (src/main/index.ts → openDefaultDatabaseAfterWindow →
 * openConfiguredDatabase). A migration that flags the cohort summary stale
 * (v42) must lead to a rebuild on that path too — with the real manager, the
 * real migration, the real startup hook and the real rebuild worker.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseService } from '../../src/main/database/DatabaseService'
import { isCohortSummaryStale } from '../../src/main/database/cohort-summary-case-removal'
import { openConfiguredDatabase } from '../../src/main/database/startup'
import { triggerStartupRebuildIfNeeded as triggerFromIndex } from '../../src/main/ipc/handlers/cohort'
import { triggerStartupRebuildIfNeeded } from '../../src/main/ipc/handlers/cohort-logic'
import { exportCohort } from '../../src/main/ipc/handlers/export-logic'
import { DatabaseManager } from '../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../src/main/services/RecentDatabasesService'
import { COHORT_SUMMARY_REFRESHING_MESSAGE } from '../../src/shared/errors/cohort-summary-refreshing'
import {
  openDefaultDatabaseAfterWindow,
  startSqliteHousekeeping
} from '../../src/main/startup-sequence'
import { bundleWorker } from '../utils/bundle-worker'
import { makeVariant } from '../utils/make-variant'

const worker = vi.hoisted(() => ({ path: '' }))

// The rebuild worker is a build artefact; run its bundled source instead.
vi.mock('worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('worker_threads')>()
  class BundledWorker extends actual.Worker {
    constructor(file: string | URL, options?: import('worker_threads').WorkerOptions) {
      super(String(file).endsWith('rebuild-summary-worker.js') ? worker.path : file, options)
    }
  }
  return { ...actual, Worker: BundledWorker }
})

// No window in this test: the handlers' renderer notifications go nowhere.
vi.mock('electron', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  BrowserWindow: { getAllWindows: () => [] }
}))

const KEY = 'managed-dek-for-the-default-database'
const PAINTED = { once: () => undefined, isDestroyed: () => true }

describe('automatic start with a summary flagged stale by migration v42', () => {
  let dir: string
  let manager: DatabaseManager
  let bundled: string

  beforeAll(async () => {
    bundled = await bundleWorker('src/main/workers/rebuild-summary-worker.ts')
  })

  beforeEach(() => {
    worker.path = bundled
    dir = mkdtempSync(join(tmpdir(), 'varlens-default-start-'))
    manager = new DatabaseManager(new RecentDatabasesService(join(dir, 'settings.json')))
  })

  afterEach(async () => {
    await manager.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** A v41 default database: its summary predates the het class of `1/.`. */
  function seedV41Default(key?: string): void {
    const service = new DatabaseService(join(dir, 'varlens.db'), key)
    const caseId = service.cases.createCase('split', '/s.vcf', 1)
    service.variants.insertVariantsBatch(caseId, [makeVariant({ gt_num: '1/.' })])
    service.cohortSummary.rebuild()
    service.database.exec('UPDATE cohort_variant_summary SET het_count = 0')
    service.database.exec('PRAGMA user_version = 41')
    service.close()
  }

  /** What `app.whenReady` does in src/main/index.ts, without Electron. */
  function startApp(
    key: string | undefined,
    trigger: (db: DatabaseService) => void = triggerFromIndex
  ): Promise<void> {
    const keyStore = {
      createManagedKey: () => ({ ok: false as const, reason: 'safe-storage-unavailable' as const }),
      wrapNewDekWithPassphrase: () => ({
        ok: false as const,
        reason: 'path-already-keyed' as const
      }),
      resolveKeyForPath: () =>
        key === undefined
          ? { ok: false as const, reason: 'not-found' as const }
          : { ok: true as const, dek: key },
      resolveKeyWithPassphrase: () => ({ ok: false as const, reason: 'not-found' as const }),
      removeKey: () => undefined
    }
    return openDefaultDatabaseAfterWindow(PAINTED, {
      openDefault: () =>
        openConfiguredDatabase(manager, {
          env: {},
          userDataPath: dir,
          keyStore: keyStore as never
        }),
      onOpenFailed: (error) => {
        throw error
      },
      onSettled: () => undefined,
      onOpened: () => startSqliteHousekeeping(manager, trigger)
    })
  }

  const hetCount = (): number =>
    (
      manager
        .getCurrent()
        .database.prepare('SELECT het_count FROM cohort_variant_summary')
        .get() as {
        het_count: number
      }
    ).het_count

  for (const [label, key] of [
    ['plaintext', undefined],
    ['managed-key encrypted', KEY]
  ] as const) {
    it(`rebuilds the summary of a ${label} default database without a user action`, async () => {
      seedV41Default(key)
      // The hook index.ts passes: the cohort handlers' own startup trigger.
      await startApp(key)

      const db = manager.getCurrent()
      expect(db.database.pragma('user_version', { simple: true })).toBe(45)
      expect(db.isEncrypted()).toBe(key !== undefined)
      await vi.waitFor(() => expect(isCohortSummaryStale(db.database)).toBe(false), {
        timeout: 20_000
      })
      expect(hetCount()).toBe(1)
    }, 30_000)
  }

  it('a failed rebuild is tried once, keeps the flag, and an export says why it does not run', async () => {
    seedV41Default()
    worker.path = join(dir, 'no-such-worker.cjs')
    const onSummaryStale = vi.fn()
    const onSummaryFresh = vi.fn()

    await startApp(undefined, (db) =>
      triggerStartupRebuildIfNeeded(db, { onSummaryStale, onSummaryFresh })
    )
    await vi.waitFor(() => expect(onSummaryStale).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 300))

    const db = manager.getCurrent()
    expect(onSummaryStale).toHaveBeenCalledOnce()
    expect(onSummaryFresh).not.toHaveBeenCalled()
    expect(isCohortSummaryStale(db.database)).toBe(true)
    expect(hetCount()).toBe(0)
    await expect(
      exportCohort(() => db, {}, join(dir, 'cohort.xlsx'), {}, { refreshWaitMs: 50 })
    ).rejects.toMatchObject({ userMessage: COHORT_SUMMARY_REFRESHING_MESSAGE })
  }, 30_000)
})
