// @vitest-environment node
/**
 * Extension-table filters on the cohort view must stay inside the summary
 * row's genome build (#469 review, item 7). A coordinate carried on GRCh37 and
 * on GRCh38 has two summary rows; an SV filter that only the GRCh38 carrier
 * satisfies used to pass the GRCh37 row as well, because the carrier probe
 * matched on the coordinate alone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'

describe('cohort extension filters respect the genome build (SQLite)', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    for (const [name, build, support] of [
      ['on-38', 'GRCh38', 20],
      ['on-37', 'GRCh37', 2]
    ] as const) {
      const caseId = service.cases.createCase(name, `/tmp/${name}.vcf`, 0, build)
      service.variants.insertVariantsBatch(caseId, [
        {
          chr: '7',
          pos: 1000,
          end_pos: 5000,
          ref: 'N',
          alt: '<DEL>',
          gt_num: '0/1',
          variant_type: 'sv',
          gene_symbol: name
        } as never
      ])
      const variant = service.database
        .prepare('SELECT id FROM variants WHERE case_id = ?')
        .get(caseId) as { id: number }
      service.database
        .prepare('INSERT INTO variant_sv (variant_id, support) VALUES (?, ?)')
        .run(variant.id, support)
    }
    service.cohortSummary.rebuild()
  })

  afterEach(() => service.close())

  const builds = (operator: '>' | '<', value: number): string[] =>
    service.cohort
      .getCohortVariants({ column_filters: { 'sv.support': { operator, value } } })
      .data.map((variant) => variant.gene_symbol as string)
      .sort()

  it('has one summary row per build at the shared coordinate', () => {
    expect(service.cohort.getCohortVariants({}).data).toHaveLength(2)
  })

  it('returns only the build whose carrier satisfies the filter', () => {
    expect(builds('>', 10)).toEqual(['on-38'])
    expect(builds('<', 10)).toEqual(['on-37'])
    expect(builds('>', 100)).toEqual([])
  })
})
