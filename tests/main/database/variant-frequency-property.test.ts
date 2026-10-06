/**
 * Property-style check: after any sequence of imports, multi-file appends,
 * replacements and deletes, the incrementally maintained variant_frequency
 * table equals recomputeAllFrequencies() on the same data.
 *
 * Each operation drives the same frequency calls production uses:
 *   - import / replace: import worker (updateFrequencies; decrement+delete)
 *   - multi-file append: startMultiFileImportSqlite (watermark + append upkeep)
 *   - delete / delete-all: delete worker (deleteCasesIncrementally)
 * A small coordinate pool forces heavy overlap between cases and files.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { VariantFrequencyService } from '../../../src/main/database/VariantFrequencyService'
import { deleteCasesIncrementally } from '../../../src/main/workers/delete-operations'
import { makeVariant } from '../../utils/make-variant'

type Coord = [string, number, string, string]

const POOL: Coord[] = Array.from({ length: 10 }, (_, i) => [
  i % 3 === 0 ? 'X' : '1',
  100 + (i % 5) * 10,
  'A',
  i % 2 === 0 ? 'G' : 'T'
])

/** Deterministic PRNG (mulberry32) so a failing seed is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('variant_frequency incremental upkeep equals a full recompute', () => {
  let service: DatabaseService
  let freq: VariantFrequencyService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    freq = new VariantFrequencyService(service.database)
  })

  afterEach(() => {
    service.close()
  })

  const snapshot = (): string[] =>
    (
      service.database
        .prepare(
          'SELECT chr, pos, ref, alt, case_count FROM variant_frequency ORDER BY chr, pos, ref, alt'
        )
        .all() as Array<Record<string, unknown>>
    ).map((r) => `${r.chr}:${r.pos}:${r.ref}>${r.alt}=${r.case_count}`)

  function recomputedSnapshot(): string[] {
    const incremental = snapshot()
    freq.recomputeAllFrequencies()
    const full = snapshot()
    // Restore the incremental state so later steps keep building on it.
    service.database.exec('DELETE FROM variant_frequency')
    const insert = service.database.prepare(
      'INSERT INTO variant_frequency (chr, pos, ref, alt, case_count) VALUES (?, ?, ?, ?, ?)'
    )
    for (const key of incremental) {
      const m = /^(.+):(\d+):(.+)>(.+)=(\d+)$/.exec(key)!
      insert.run(m[1], Number(m[2]), m[3], m[4], Number(m[5]))
    }
    return full
  }

  function insertFile(caseId: number, next: () => number): void {
    const rows = Array.from({ length: Math.floor(next() * 5) }, () => {
      const [chr, pos, ref, alt] = POOL[Math.floor(next() * POOL.length)]
      return makeVariant({ chr, pos, ref, alt, gene_symbol: null, consequence: null })
    })
    service.variants.insertVariantsBatch(caseId, rows)
  }

  function importCase(name: string, next: () => number): number {
    const caseId = service.cases.createCase(name, `/x/${name}.vcf`, 1)
    insertFile(caseId, next)
    freq.updateFrequencies(caseId)
    return caseId
  }

  async function runSequence(seed: number): Promise<void> {
    const next = rng(seed)
    const live = new Map<string, number>()
    let counter = 0

    for (let step = 0; step < 40; step++) {
      const roll = next()
      const names = [...live.keys()]
      const pick = (): string => names[Math.floor(next() * names.length)]
      let op: string

      if (roll < 0.3 || names.length === 0) {
        op = 'import'
        const name = `c${counter++}`
        live.set(name, importCase(name, next))
      } else if (roll < 0.55) {
        op = 'multi-file'
        const name = `c${counter++}`
        const caseId = importCase(name, next)
        const watermark = freq.caseVariantWatermark(caseId)
        const extraFiles = 1 + Math.floor(next() * 3)
        for (let f = 0; f < extraFiles; f++) insertFile(caseId, next)
        freq.updateFrequenciesForAppend(caseId, watermark)
        live.set(name, caseId)
      } else if (roll < 0.7) {
        op = 'replace'
        const name = pick()
        const old = live.get(name)!
        freq.decrementFrequencies(old)
        service.database.prepare('DELETE FROM cases WHERE id = ?').run(old)
        live.set(name, importCase(name, next))
      } else if (roll < 0.95) {
        op = 'delete'
        const name = pick()
        await deleteCasesIncrementally(service.database, [live.get(name)!], {
          deletingAll: false,
          isCancelled: () => false,
          onProgress: () => {}
        })
        live.delete(name)
      } else {
        op = 'delete-all'
        await deleteCasesIncrementally(service.database, [...live.values()], {
          deletingAll: true,
          isCancelled: () => false,
          onProgress: () => {}
        })
        live.clear()
      }

      expect(snapshot(), `seed ${seed}, step ${step} (${op})`).toEqual(recomputedSnapshot())
    }
  }

  it.each(Array.from({ length: 25 }, (_, i) => i + 1))(
    'holds for random operation sequence (seed %i)',
    async (seed) => {
      await runSequence(seed)
    }
  )
})
