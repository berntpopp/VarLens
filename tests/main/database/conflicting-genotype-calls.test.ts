// @vitest-environment node
/**
 * Several rows of one case for one variant with different genotypes resolve
 * to ONE call — the highest dosage — in the cohort summary, the carrier list
 * and the burden test, whatever the row order (#516).
 * Decision record: .planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { AssociationDataBuilder } from '../../../src/main/database/AssociationDataBuilder'
import { gtCallKeySql } from '../../../src/shared/sql/genotype-dosage'
import { genotypeCallKey } from '../../../src/shared/utils/genotype'
import { makeVariant } from '../../utils/make-variant'

const CASES: Array<{ gts: [string, string]; resolved: string; het: number; hom: number }> = [
  { gts: ['./1', '0/.'], resolved: './1', het: 1, hom: 0 },
  { gts: ['0/1', '1/1'], resolved: '1/1', het: 0, hom: 1 },
  { gts: ['1/.', '1/1'], resolved: '1/1', het: 0, hom: 1 }
]

describe('conflicting duplicate genotype calls on SQLite', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => service.close())

  const counts = (): { carrier_count: number; het_count: number; hom_count: number } =>
    service.database
      .prepare('SELECT carrier_count, het_count, hom_count FROM cohort_variant_summary')
      .get() as { carrier_count: number; het_count: number; hom_count: number }

  for (const { gts, resolved, het, hom } of CASES) {
    for (const order of [gts, [...gts].reverse()]) {
      it(`${order.join(' + ')} is ${resolved} everywhere`, () => {
        const caseId = service.cases.createCase('dup', '/d.vcf', 1)
        service.variants.insertVariantsBatch(
          caseId,
          order.map((gt_num, i) => makeVariant({ gt_num, transcript: `NM_${i}` }))
        )
        const expected = { carrier_count: 1, het_count: het, hom_count: hom }

        service.cohortSummary.rebuild()
        expect(counts()).toEqual(expected)
        expect(service.cohort.getCarriers('1', 100, 'A', 'G')[0].gt_num).toBe(resolved)

        const [gene] = new AssociationDataBuilder(service.database).build([caseId], [], {}, [])
        expect(gene.samples[0].dosages).toEqual([het + 2 * hom])

        // The legacy per-case paths subtract and add the same call.
        service.cohortSummary.incrementalRemove(caseId)
        expect(service.database.prepare('SELECT 1 FROM cohort_variant_summary').get()).toBe(
          undefined
        )
        service.cohortSummary.incrementalAdd(caseId)
        expect(counts()).toEqual(expected)
      })
    }
  }

  it('the SQL call key is the TypeScript one', () => {
    const genotypes = ['1/1', '1|1', '0/1', '1/.', './1', '.|1', '1', '0/0', '0', '0/.', './.', '']
    const sql = service.database.prepare(`SELECT ${gtCallKeySql('g')} FROM (SELECT ? AS g)`).pluck()
    for (const gt of [...genotypes, null]) expect(sql.get(gt)).toBe(genotypeCallKey(gt))
  })
})
