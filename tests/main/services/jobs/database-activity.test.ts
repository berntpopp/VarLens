import { describe, expect, it } from 'vitest'
import { spawnRebuildWorker } from '../../../../src/main/ipc/handlers/cohort-logic'
import {
  listActiveDatabaseWork,
  trackDatabaseWorker
} from '../../../../src/main/services/jobs/database-activity'
import { jobRunner } from '../../../../src/main/services/jobs/runner'

function pending(): { promise: Promise<void>; release: () => void; fail: (e: Error) => void } {
  let release: () => void = () => undefined
  let fail: (e: Error) => void = () => undefined
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { promise, release, fail }
}

describe('database activity', () => {
  it('reports nothing when the database is idle', () => {
    expect(listActiveDatabaseWork()).toEqual([])
  })

  it('reports running JobRunner jobs until they settle', async () => {
    const gate = pending()
    const job = jobRunner.enqueue('import_single', {}, () => gate.promise)

    expect(listActiveDatabaseWork()).toEqual(['import single'])

    gate.release()
    await job.result
    expect(listActiveDatabaseWork()).toEqual([])
  })

  it('keeps a label active until every worker registered under it has settled', async () => {
    const first = pending()
    const second = pending()
    const a = trackDatabaseWorker('rebuild', first.promise)
    const b = trackDatabaseWorker('rebuild', second.promise)

    first.release()
    await a
    expect(listActiveDatabaseWork()).toEqual(['rebuild'])

    second.fail(new Error('worker crashed'))
    await expect(b).rejects.toThrow('worker crashed')
    expect(listActiveDatabaseWork()).toEqual([])
  })

  it('counts the cohort-summary rebuild worker, which runs outside the JobRunner', async () => {
    // No bundled worker exists under Vitest, so the spawn fails — after it was
    // registered, and it must be released again.
    const rebuild = spawnRebuildWorker('/nonexistent/varlens.db')

    expect(listActiveDatabaseWork()).toEqual(['cohort summary rebuild'])

    await expect(rebuild).rejects.toThrow()
    expect(listActiveDatabaseWork()).toEqual([])
  })
})
