/**
 * The cohort column-meta cache lives per connection. DB worker threads are
 * never told that an import (another connection) changed the summary, so the
 * cache must notice by itself (#505).
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService, type Variant } from '../../../src/main/database'

const variant = (pos: number, gene: string): Omit<Variant, 'id' | 'case_id'> =>
  ({ chr: '1', pos, ref: 'A', alt: 'T', gt_num: '0/1', gene_symbol: gene }) as unknown as Omit<
    Variant,
    'id' | 'case_id'
  >

describe('cohort column meta across connections', () => {
  let dir: string
  let reader: DatabaseService
  let writer: DatabaseService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-cohort-meta-'))
    writer = new DatabaseService(join(dir, 'cohort.db'))
    reader = new DatabaseService(join(dir, 'cohort.db'))
  })

  afterEach(() => {
    reader.close()
    writer.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const genes = (): string[] | undefined =>
    reader.cohort.getColumnMeta().find((m) => m.key === 'gene_symbol')?.distinctValues

  it('offers the values another connection imported', () => {
    const first = writer.cases.createCase('a', '/tmp/a.json', 0, 'GRCh38')
    writer.variants.insertVariantsBatch(first, [variant(100, 'BRCA1')])
    writer.cohortSummary.rebuild()
    expect(genes()).toEqual(['BRCA1'])

    const second = writer.cases.createCase('b', '/tmp/b.json', 0, 'GRCh38')
    writer.variants.insertVariantsBatch(second, [variant(200, 'TP53')])
    writer.cohortSummary.rebuild()

    expect(genes()).toEqual(['BRCA1', 'TP53'])
  })

  it('keeps serving the cached list while nothing was committed', () => {
    const first = writer.cases.createCase('a', '/tmp/a.json', 0, 'GRCh38')
    writer.variants.insertVariantsBatch(first, [variant(100, 'BRCA1')])
    writer.cohortSummary.rebuild()

    expect(reader.cohort.getColumnMeta()).toBe(reader.cohort.getColumnMeta())
  })
})
