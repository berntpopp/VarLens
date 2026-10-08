// @vitest-environment node
/**
 * What an import session does when the cohort summary it is about to maintain
 * cannot be trusted or cannot be repaired: it must never report the summary
 * current on a base nobody verified, and never lose track of an unfinished
 * session.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { rebuildCohortSummaryCancellable } from '../../../src/main/workers/cancellable-summary-rebuild'
import { rebuildCohortSummary } from '../../../src/main/workers/worker-db'
import { MARK_STALE_SQL } from '../../../src/shared/sql/cohort-summary-rebuild'
import { referenceSummary, snapshotSummary, summaryMeta } from './support/summary-reference'
import {
  openSummarySessionHarness,
  sessionStatuses,
  variantAt,
  type SummarySessionHarness
} from './support/summary-session-harness'

const MARK_SESSION_OPEN =
  "INSERT OR REPLACE INTO cohort_summary_meta (key, value) VALUES ('import_session_open', '1')"

/** Makes every full rebuild fail: its first statement empties the summary. */
const BREAK_REBUILD = `
  CREATE TRIGGER break_rebuild BEFORE DELETE ON cohort_variant_summary
  BEGIN SELECT RAISE(ABORT, 'summary rebuild broken for this test'); END`

describe('import worker: cohort summary recovery', () => {
  let h: SummarySessionHarness

  beforeEach(() => {
    h = openSummarySessionHarness()
  })

  afterEach(() => {
    h.close()
  })

  const needsStartupRebuild = (): boolean => {
    const service = new DatabaseService(h.dbPath)
    try {
      return service.needsStartupRebuild()
    } finally {
      service.close()
    }
  }

  it('does not merge files onto a summary whose session-start rebuild failed', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA'), variantAt(200, 'AAA')])])
    // A worker died mid-session: marker left behind, summary off, not flagged.
    h.db.exec(MARK_SESSION_OPEN)
    h.db.exec('UPDATE cohort_variant_summary SET carrier_count = 99 WHERE pos = 100')
    h.db.exec(BREAK_REBUILD)

    const messages = await h.run([h.file('B', [variantAt(100, 'AAA')])])

    expect(sessionStatuses(messages)).toEqual(['B:success'])
    // The rebuild could not run, so the summary is wrong — and says so.
    expect(
      h.db.prepare('SELECT carrier_count FROM cohort_variant_summary WHERE pos = 100').get()
    ).not.toEqual({ carrier_count: 2 })
    expect(summaryMeta(h.db, 'is_stale')).toBe('1')
    expect(summaryMeta(h.db, 'import_session_open')).toBe('1')
    expect(needsStartupRebuild()).toBe(true)

    // Once a rebuild can run again, the next session repairs it.
    h.db.exec('DROP TRIGGER break_rebuild')
    await h.run([])
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
    expect(summaryMeta(h.db, 'is_stale')).toBe('0')
    expect(summaryMeta(h.db, 'import_session_open')).toBeUndefined()
  })

  describe('a session marker left by a dead worker', () => {
    const rebuilds: Record<string, () => void | Promise<unknown>> = {
      'main-process service': () => {
        const service = new DatabaseService(h.dbPath)
        try {
          service.cohortSummary.rebuild()
        } finally {
          service.close()
        }
      },
      'worker rebuild': () => rebuildCohortSummary(h.db),
      'cancellable worker rebuild': () => rebuildCohortSummaryCancellable(h.db, () => false)
    }

    it.each(Object.keys(rebuilds))('is cleared by a completed full rebuild (%s)', async (name) => {
      await h.run([h.file('A', [variantAt(100, 'AAA')])])
      h.db.exec(MARK_SESSION_OPEN)
      expect(needsStartupRebuild()).toBe(true)

      await rebuilds[name]()

      // Otherwise every app start rebuilds again until the next import.
      expect(summaryMeta(h.db, 'import_session_open')).toBeUndefined()
      expect(needsStartupRebuild()).toBe(false)
    })
  })

  // #493: once published, a case is not taken back — the case it replaced is already gone.
  it('keeps a published case, and the summary exact, when reporting it fails', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA'), variantAt(200, 'AAA')])])
    const failReport = {
      onMessage: (m: { type: string }): void => {
        if (m.type === 'file-complete') throw new Error('port closed')
      }
    }
    const published = (): unknown[] =>
      h.db.prepare('SELECT name, import_status, variant_count FROM cases ORDER BY name').all()
    const expectConsistent = (): void => {
      expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
      expect(summaryMeta(h.db, 'is_stale')).toBe('0')
      const counted = h.db.prepare(
        'SELECT COALESCE(SUM(case_count), 0) AS c FROM variant_frequency'
      )
      const carried = h.db.prepare(
        'SELECT COUNT(*) AS c FROM (SELECT DISTINCT case_id, chr, pos, ref, alt FROM variants)'
      )
      expect(counted.get()).toEqual(carried.get())
    }

    // B is inserted and merged; then telling the main process throws.
    const fresh = await h.run(
      [h.file('B', [variantAt(100, 'AAA'), variantAt(300, 'BBB')])],
      failReport
    )
    expect(sessionStatuses(fresh)).toEqual(['B:failed'])
    expect(published()).toEqual([
      { name: 'A', import_status: 'ready', variant_count: 2 },
      { name: 'B', import_status: 'ready', variant_count: 2 }
    ])
    expectConsistent()

    // The same while replacing A: neither the old A nor nothing, but the new A.
    const replaced = await h.run(
      [h.file('A', [variantAt(400, 'CCC')], { isDuplicate: true, duplicateStrategy: 'overwrite' })],
      failReport
    )
    expect(sessionStatuses(replaced)).toEqual(['A:failed'])
    expect(published()).toEqual([
      { name: 'A', import_status: 'ready', variant_count: 1 },
      { name: 'B', import_status: 'ready', variant_count: 2 }
    ])
    expectConsistent()
  })

  it('tells the main process when it stops keeping the summary current', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA')])])
    let rebuilt = false

    const messages = await h.run(
      [
        h.file('B', [variantAt(100, 'AAA'), variantAt(200, 'BBB')]),
        h.file('C', [variantAt(300, 'CCC')])
      ],
      {
        batchSize: 1,
        onMessage: (m) => {
          if (rebuilt || m.type !== 'progress' || m.phase !== 'inserting') return
          rebuilt = true
          rebuildCohortSummary(h.db) // forces the session off incremental upkeep
        }
      }
    )

    const order = messages
      .filter((m) => m.type === 'summary-stale' || m.type === 'file-complete')
      .map((m) => (m.type === 'file-complete' ? `done:${m.result.caseName}` : m.type))
    // Once, and before the first file whose carriers the summary lacks.
    expect(order).toEqual(['summary-stale', 'done:B', 'done:C'])
    expect(summaryMeta(h.db, 'is_stale')).toBe('0')
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
  })

  it('says nothing about staleness in a session that stays exact', async () => {
    const messages = await h.run([
      h.file('A', [variantAt(100, 'AAA')]),
      h.file('B', [variantAt(100, 'AAA')])
    ])
    expect(messages.filter((m) => m.type === 'summary-stale')).toEqual([])
  })

  it('keeps its marker when a full rebuild runs while a file is being inserted', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA')])])
    const markerAfterBatch: Array<string | undefined> = []
    let batches = 0

    await h.run(
      [h.file('B', [variantAt(100, 'AAA'), variantAt(200, 'BBB'), variantAt(300, 'CCC')])],
      {
        batchSize: 1,
        onMessage: (m) => {
          if (m.type !== 'progress' || m.phase !== 'inserting') return
          markerAfterBatch.push(summaryMeta(h.db, 'import_session_open'))
          // A rebuild from outside the session lands after the first row.
          if (++batches === 1) rebuildCohortSummary(h.db)
        }
      }
    )

    // The rebuild cleared the marker; the session's next write restored it, so
    // a crash from there on is still recognised as an unfinished session.
    expect(markerAfterBatch).toEqual(['1', '1', '1'])
    expect(summaryMeta(h.db, 'import_session_open')).toBeUndefined()
  })

  it('announces a summary flagged stale after the last file, before it rebuilds', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA')])])

    // An edit on the main connection (a transcript switch) could only flag the
    // summary while the session was open; it lands after the last merge.
    const messages = await h.run([h.file('B', [variantAt(200, 'BBB')])], {
      onMessage: (m) => {
        if (m.type === 'file-complete') h.db.exec(MARK_STALE_SQL)
      }
    })

    // The renderer was told "stale" by that edit: only a worker that says so
    // too makes the main process report "current" once the rebuild is done.
    const types = messages.map((m) => m.type)
    expect(types.filter((t) => t === 'summary-stale')).toHaveLength(1)
    expect(types.indexOf('summary-stale')).toBeLessThan(types.indexOf('complete'))
    expect(summaryMeta(h.db, 'is_stale')).toBe('0')
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
  })
})
