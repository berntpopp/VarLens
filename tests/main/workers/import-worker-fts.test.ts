// @vitest-environment node
/**
 * #559: a small import into a populated database indexes only the rows it
 * added (above the session's watermark) and rebuilds nothing; a bulk session,
 * an overwrite, or one that finds the triggers gone still rebuilds the whole
 * index once at the end. The triggers are back after every session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as fts from '../../../src/main/database/fts-trigger-management'
import {
  openSummarySessionHarness,
  sessionStatuses,
  variantAt,
  type SummarySessionHarness
} from './support/summary-session-harness'

vi.mock('../../../src/main/database/fts-trigger-management', async (importOriginal) => {
  const actual = await importOriginal<typeof fts>()
  return { ...actual, rebuildAllFtsIndexes: vi.fn(actual.rebuildAllFtsIndexes) }
})

describe('import worker: FTS upkeep per session (#559)', () => {
  let h: SummarySessionHarness

  beforeEach(() => {
    h = openSummarySessionHarness()
  })

  afterEach(() => {
    h.close()
  })

  /** Index hits, joined to stored rows: a stale entry would show as a dangling rowid. */
  const hits = (gene: string): { indexed: number; stored: number } =>
    h.db
      .prepare(
        `SELECT COUNT(*) AS indexed, COUNT(v.id) AS stored
           FROM variants_fts f LEFT JOIN variants v ON v.id = f.rowid
          WHERE variants_fts MATCH ?`
      )
      .get(gene) as { indexed: number; stored: number }

  /** Four stored cases make a one-file session "small" (KEEP_INDEXES_MIN_CASES_PER_FILE). */
  async function populate(): Promise<void> {
    await h.run(
      ['OLDA', 'OLDB', 'OLDC', 'OLDD'].map((gene, i) => h.file(`case-${i}`, [variantAt(100, gene)]))
    )
    vi.mocked(fts.rebuildAllFtsIndexes).mockClear()
  }

  /** What a dead import leaves: a provisional case, indexed by the live triggers. */
  function leaveInterruptedCase(gene: string): void {
    const id = Number(
      h.db
        .prepare(
          `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build, import_status)
           VALUES ('dead', '/gone.json', 1, 0, 0, 'GRCh38', 'provisional')`
        )
        .run().lastInsertRowid
    )
    h.db
      .prepare(
        `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol) VALUES (?, 'chr1', 5, 'A', 'G', ?)`
      )
      .run(id, gene)
  }

  it('a small import indexes only its own rows, rebuilds nothing, and search stays exact', async () => {
    await populate()
    leaveInterruptedCase('GONEGENE')
    expect(hits('GONEGENE')).toEqual({ indexed: 1, stored: 1 })

    const messages = await h.run([h.file('new', [variantAt(200, 'NEWGENE')])])

    expect(sessionStatuses(messages)).toEqual(['new:success'])
    expect(fts.rebuildAllFtsIndexes).not.toHaveBeenCalled()
    expect(hits('OLDA')).toEqual({ indexed: 1, stored: 1 })
    expect(hits('NEWGENE')).toEqual({ indexed: 1, stored: 1 })
    expect(hits('GONEGENE')).toEqual({ indexed: 0, stored: 0 })
    expect(fts.ftsTriggersComplete(h.db)).toBe(true)
  })

  it('a bulk session rebuilds the index once and restores the triggers', async () => {
    const messages = await h.run([h.file('a', [variantAt(100, 'BULKGENE')])])

    expect(sessionStatuses(messages)).toEqual(['a:success'])
    expect(fts.rebuildAllFtsIndexes).toHaveBeenCalledTimes(1)
    expect(hits('BULKGENE')).toEqual({ indexed: 1, stored: 1 })
    expect(fts.ftsTriggersComplete(h.db)).toBe(true)
  })

  it('a small session that finds the triggers gone (a session died) rebuilds', async () => {
    await populate()
    h.db.exec('DROP TRIGGER variants_fts_ai')

    await h.run([h.file('new', [variantAt(200, 'NEWGENE')])])

    expect(fts.rebuildAllFtsIndexes).toHaveBeenCalledTimes(1)
    expect(hits('NEWGENE')).toEqual({ indexed: 1, stored: 1 })
    expect(fts.ftsTriggersComplete(h.db)).toBe(true)
  })
})
