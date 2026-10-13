// @vitest-environment node
/**
 * #560: the cohort summary's total is SUM(cases.variant_count) of ready
 * cases, not a scan of every variant row, so the count must stay exact
 * through every write path; and the extension filter metadata is driven from
 * the small extension table, never from every variant id of the scope.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CohortService } from '../../../src/main/database/cohort'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { deleteCasesIncrementally } from '../../../src/main/workers/delete-operations'
import {
  openSummarySessionHarness,
  variantAt,
  type SessionFile,
  type SummarySessionHarness
} from '../workers/support/summary-session-harness'

describe('cohort summary total_variants (#560)', () => {
  let h: SummarySessionHarness

  beforeEach(() => {
    h = openSummarySessionHarness()
  })

  afterEach(() => {
    h.close()
  })

  const parity = (): { summary: number; counted: number } => ({
    summary: new CohortService(h.db).getCohortSummary().total_variants,
    counted: (
      h.db
        .prepare(
          "SELECT COUNT(*) AS c FROM variants v JOIN cases c ON c.id = v.case_id WHERE c.import_status = 'ready'"
        )
        .get() as { c: number }
    ).c
  })
  const expectParity = (expected: number): void =>
    expect(parity()).toEqual({ summary: expected, counted: expected })

  it('equals COUNT(*) after import, multi-file append, delete and a cancelled delete-all', async () => {
    await h.run([
      h.file('A', [variantAt(100, 'GA'), variantAt(200, 'GA')]),
      h.file('B', [variantAt(100, 'GB')]),
      h.file('C', [variantAt(300, 'GC'), variantAt(400, 'GC'), variantAt(500, 'GC')])
    ])
    expectParity(6)

    const a = (h.db.prepare("SELECT id FROM cases WHERE name = 'A'").get() as { id: number }).id
    const appended = join(h.dbPath, '..', 'append.json')
    writeFileSync(
      appended,
      JSON.stringify({ variants: [variantAt(600, 'GA'), variantAt(700, 'GA')] })
    )
    await h.run([
      {
        filePath: appended,
        caseName: 'A',
        isDuplicate: false,
        duplicateStrategy: 'skip',
        appendToCaseId: a
      } as SessionFile
    ])
    expectParity(8)

    const b = (h.db.prepare("SELECT id FROM cases WHERE name = 'B'").get() as { id: number }).id
    await deleteCasesIncrementally(h.db, [b], { isCancelled: () => false, onProgress: () => {} })
    expectParity(7)

    let polls = 0
    const all = (h.db.prepare('SELECT id FROM cases ORDER BY id').all() as { id: number }[]).map(
      (r) => r.id
    )
    const result = await deleteCasesIncrementally(h.db, all, {
      isCancelled: () => polls++ >= 1,
      onProgress: () => {}
    })
    expect(result).toEqual({ deleted: 1, cancelled: true })
    expectParity(3)
  })
})

describe('extension column metadata query plan (#560)', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    for (const name of ['one', 'two']) {
      const caseId = service.cases.createCase(name, `/${name}.vcf`, 1)
      for (let i = 0; i < 3; i++) {
        const id = Number(
          service.database
            .prepare(
              `INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type)
               VALUES (?, 'chr1', ?, 'N', '<DEL>', 'sv')`
            )
            .run(caseId, 1000 + i).lastInsertRowid
        )
        service.database
          .prepare('INSERT INTO variant_sv (variant_id, support, event_id) VALUES (?, ?, ?)')
          .run(id, 10 + i, `ev${i}`)
      }
    }
  })

  afterEach(() => service.close())

  it.each(['sv.support', 'sv.event_id'])(
    '%s scans the extension table and looks variants up by primary key',
    (key) => {
      const db = service.database
      const statements: string[] = []
      const realPrepare = db.prepare.bind(db)
      db.prepare = ((sql: string) => {
        statements.push(sql)
        return realPrepare(sql)
      }) as typeof db.prepare
      const meta = service.variants.getColumnMeta({ caseIds: [1, 2] }, key)
      db.prepare = realPrepare

      expect(meta.distinctCount).toBe(3)
      expect(statements.length).toBeGreaterThan(0)
      for (const sql of statements) {
        const plan = (realPrepare(`EXPLAIN QUERY PLAN ${sql}`).all(1, 2) as { detail: string }[])
          .map((r) => r.detail)
          .join(' | ')
        expect(plan).toMatch(/(^| \| )SCAN e\b/)
        expect(plan).toContain('SEARCH v USING INTEGER PRIMARY KEY')
        expect(plan).not.toMatch(/LIST SUBQUERY|SCAN v\b|SEARCH variants/)
      }
    }
  )
})
