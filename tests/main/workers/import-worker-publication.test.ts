// @vitest-environment node
/**
 * The import worker's side of case publication (`cases.import_status`): a file
 * is reported done only with its case 'ready', a file that failed or was
 * cancelled leaves no case behind, and a case counts in `variant_frequency`
 * from exactly the moment it is published.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { referenceSummary, snapshotSummary, summaryMeta } from './support/summary-reference'
import {
  openSummarySessionHarness,
  sessionStatuses,
  variantAt,
  type SummarySessionHarness
} from './support/summary-session-harness'

const BREAK_MERGE = `
  CREATE TRIGGER break_merge BEFORE INSERT ON gene_burden_summary
  BEGIN SELECT RAISE(ABORT, 'merge broken for this test'); END`

const BREAK_PUBLICATION = `
  CREATE TRIGGER break_publication BEFORE UPDATE OF import_status ON cases
  BEGIN SELECT RAISE(ABORT, 'publication broken for this test'); END`

describe('import worker: case publication', () => {
  let h: SummarySessionHarness

  beforeEach(() => {
    h = openSummarySessionHarness()
  })

  afterEach(() => {
    h.close()
  })

  const statuses = (): unknown[] =>
    h.db.prepare('SELECT name, import_status FROM cases ORDER BY name').all()
  const frequencies = (): unknown[] =>
    h.db.prepare('SELECT * FROM variant_frequency ORDER BY chr, pos, ref, alt').all()

  it('reports a file done with its case ready when the summary merge throws', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA')])])
    h.db.exec(BREAK_MERGE)
    let atFileComplete: { statuses: unknown[]; stale: string | undefined } | undefined

    const messages = await h.run([h.file('B', [variantAt(100, 'AAA'), variantAt(200, 'BBB')])], {
      onMessage: (m) => {
        if (m.type !== 'file-complete') return
        atFileComplete = { statuses: statuses(), stale: summaryMeta(h.db, 'is_stale') }
        h.db.exec('DROP TRIGGER break_merge') // the rebuild at session end can run
      }
    })

    expect(sessionStatuses(messages)).toEqual(['B:success'])
    // Visible the moment the file is reported, and the cohort says it lags.
    expect(atFileComplete).toEqual({
      statuses: [
        { name: 'A', import_status: 'ready' },
        { name: 'B', import_status: 'ready' }
      ],
      stale: '1'
    })
    expect(messages.some((m) => m.type === 'summary-stale')).toBe(true)
    expect(summaryMeta(h.db, 'is_stale')).toBe('0')
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
    expect(h.db.prepare('SELECT case_count FROM variant_frequency WHERE pos = 100').get()).toEqual({
      case_count: 2
    })
  })

  it('fails the file and deletes its case when the case cannot be published', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA'), variantAt(200, 'AAA')])])
    const before = { summary: snapshotSummary(h.db), frequencies: frequencies() }
    h.db.exec(BREAK_PUBLICATION)

    const messages = await h.run([h.file('B', [variantAt(100, 'AAA'), variantAt(300, 'BBB')])])

    // Never "imported" yet invisible: the file failed and nothing of it stays.
    expect(sessionStatuses(messages)).toEqual(['B:failed'])
    expect(messages.some((m) => m.type === 'file-complete')).toBe(false)
    expect(statuses()).toEqual([{ name: 'A', import_status: 'ready' }])
    expect(h.db.prepare('SELECT COUNT(*) AS c FROM variants').get()).toEqual({ c: 2 })
    expect(frequencies()).toEqual(before.frequencies)
    expect(snapshotSummary(h.db)).toEqual(before.summary)
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
  })

  it('deletes a cancelled case instead of leaving it provisional', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA')])])
    const before = frequencies()
    let cancelled = false

    const messages = await h.run(
      [h.file('B', [variantAt(100, 'AAA'), variantAt(200, 'BBB'), variantAt(300, 'BBB')])],
      {
        batchSize: 1,
        isCancelled: () => cancelled,
        onMessage: (m) => {
          if (m.type === 'progress' && m.phase === 'inserting') cancelled = true
        }
      }
    )

    expect(sessionStatuses(messages)).toEqual(['B:skipped'])
    expect(statuses()).toEqual([{ name: 'A', import_status: 'ready' }])
    expect(frequencies()).toEqual(before)
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
  })

  it('does not count a case in variant_frequency before it is published', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA')])])
    const seen: Array<{ status: string; count: number }> = []

    await h.run([h.file('B', [variantAt(100, 'AAA')])], {
      batchSize: 1,
      onMessage: (m) => {
        if (m.type !== 'progress' && m.type !== 'file-complete') return
        const b = h.db.prepare("SELECT import_status FROM cases WHERE name = 'B'").get() as
          { import_status: string } | undefined
        const f = h.db
          .prepare('SELECT case_count FROM variant_frequency WHERE pos = 100')
          .get() as { case_count: number }
        if (b !== undefined) seen.push({ status: b.import_status, count: f.case_count })
      }
    })

    // Internal AF = case_count / ready cases: both move in one commit.
    expect(seen.length).toBeGreaterThan(1)
    for (const s of seen) expect(s.count).toBe(s.status === 'ready' ? 2 : 1)
    expect(seen.at(-1)).toEqual({ status: 'ready', count: 2 })
  })
})
