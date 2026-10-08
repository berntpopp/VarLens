// @vitest-environment node
/**
 * Interrupted imports on SQLite. An import that did not reach publication
 * leaves a 'provisional' case behind (worker or app died, or its own cleanup
 * failed). Like `recoverInterruptedImports` on PostgreSQL, the next import
 * session discards it before doing anything else: case, variants and child
 * rows go; `variant_frequency` and the cohort summary need no repair, because
 * a provisional case never contributed to either.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { replacementCaseName } from '../../../src/shared/utils/case-name'
import { referenceSummary, snapshotSummary, summaryMeta } from './support/summary-reference'
import {
  openSummarySessionHarness,
  sessionStatuses,
  variantAt,
  type SummarySessionHarness
} from './support/summary-session-harness'

describe('import worker: interrupted imports', () => {
  let h: SummarySessionHarness

  beforeEach(() => {
    h = openSummarySessionHarness()
  })

  afterEach(() => {
    h.close()
  })

  const cases = (): unknown[] =>
    h.db.prepare('SELECT name, import_status FROM cases ORDER BY name').all()
  const frequencies = (): unknown[] =>
    h.db.prepare('SELECT * FROM variant_frequency ORDER BY chr, pos, ref, alt').all()
  const countOf = (table: string): number =>
    (h.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c

  /**
   * What a dead import leaves: a committed provisional case whose rows are in
   * no frequency count and no summary row. Coordinates copy an imported case.
   */
  function leaveInterruptedCase(name: string, likeCase: string): number {
    const id = Number(
      h.db
        .prepare(
          `INSERT INTO cases
             (name, file_path, file_size, variant_count, created_at, genome_build, import_status)
           VALUES (?, '/gone.json', 1, 0, 0, 'GRCh38', 'provisional')`
        )
        .run(name).lastInsertRowid
    )
    h.db
      .prepare(
        `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, variant_type)
         SELECT ?, v.chr, v.pos, v.ref, v.alt, v.gene_symbol, v.gt_num, v.variant_type
         FROM variants v JOIN cases c ON c.id = v.case_id WHERE c.name = ?`
      )
      .run(id, likeCase)
    return id
  }

  it('discards a provisional case at the start of the next session', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA'), variantAt(200, 'AAA')])])
    const before = { summary: snapshotSummary(h.db), frequencies: frequencies() }
    leaveInterruptedCase('X', 'A')
    expect(countOf('variants')).toBe(4)

    await h.run([])

    expect(cases()).toEqual([{ name: 'A', import_status: 'ready' }])
    expect(countOf('variants')).toBe(2)
    expect(frequencies()).toEqual(before.frequencies)
    expect(snapshotSummary(h.db)).toEqual(before.summary)
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
    expect(summaryMeta(h.db, 'is_stale')).toBe('0')
  })

  // A replacement takes its case's name in the transaction that publishes it,
  // so on SQLite a temp-named case is always provisional (PostgreSQL publishes
  // first: PostgresCaseLifecycleRepository.hideAbandonedReplacements).
  it('discards the temp-named replacement of an overwrite that died, and keeps the case', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA')])])
    const before = { summary: snapshotSummary(h.db), frequencies: frequencies() }
    const { id } = h.db.prepare("SELECT id FROM cases WHERE name = 'A'").get() as { id: number }
    leaveInterruptedCase(replacementCaseName('A', id), 'A')

    await h.run([])

    expect(cases()).toEqual([{ name: 'A', import_status: 'ready' }])
    expect(frequencies()).toEqual(before.frequencies)
    expect(snapshotSummary(h.db)).toEqual(before.summary)
  })

  it('imports a file under the name an interrupted import left behind', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA')])])
    leaveInterruptedCase('X', 'A')

    // Not "replaced": that would subtract frequencies it never counted.
    const messages = await h.run([h.file('X', [variantAt(100, 'AAA'), variantAt(300, 'XXX')])])

    expect(sessionStatuses(messages)).toEqual(['X:success'])
    expect(cases()).toEqual([
      { name: 'A', import_status: 'ready' },
      { name: 'X', import_status: 'ready' }
    ])
    expect(countOf('variants')).toBe(3)
    expect(h.db.prepare('SELECT case_count FROM variant_frequency WHERE pos = 100').get()).toEqual({
      case_count: 2
    })
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
  })

  it('does not skip a file as a duplicate of an interrupted import', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA')])])
    leaveInterruptedCase('X', 'A')

    const messages = await h.run([
      h.file('X', [variantAt(300, 'XXX')], { duplicateStrategy: 'skip' })
    ])

    expect(sessionStatuses(messages)).toEqual(['X:success'])
    expect(countOf('variants')).toBe(2)
  })

  it('removes the frequencies of a published case the main process never heard of', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA'), variantAt(200, 'AAA')])])
    const before = { summary: snapshotSummary(h.db), frequencies: frequencies() }
    // The worker published B, then died before `file-complete` arrived: the
    // client reports the import failed and hands the case over for discard.
    await h.run([h.file('B', [variantAt(100, 'AAA'), variantAt(300, 'BBB')])])
    const b = h.db.prepare("SELECT id FROM cases WHERE name = 'B'").get() as { id: number }

    await h.run([], { discardCaseIds: [b.id] })

    expect(cases()).toEqual([{ name: 'A', import_status: 'ready' }])
    expect(frequencies()).toEqual(before.frequencies)
    expect(snapshotSummary(h.db)).toEqual(before.summary)
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
  })

  it('keeps the frequencies when the discarded partial case was never published', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA')])])
    const before = frequencies()
    const x = leaveInterruptedCase('X', 'A')

    await h.run([], { discardCaseIds: [x] })

    expect(cases()).toEqual([{ name: 'A', import_status: 'ready' }])
    expect(frequencies()).toEqual(before)
  })
})
