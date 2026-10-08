// @vitest-environment node
/**
 * Genotypes of split multi-allelic sites (`1/2` stored as `1/.` and `./1`),
 * half-calls and haploid calls, from VCF import to every SQLite consumer:
 * cohort summary (rebuild and each incremental path), carriers, association
 * dosage and the inheritance filters.
 * Decision record: .planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import { DatabaseService } from '../../../src/main/database'
import { AssociationDataBuilder } from '../../../src/main/database/AssociationDataBuilder'
import { openCaseSummaryRemoval } from '../../../src/main/database/cohort-summary-case-removal'
import { VcfStrategy } from '../../../src/main/import/vcf/VcfStrategy'
import { deleteCasesIncrementally } from '../../../src/main/workers/delete-operations'
import { openSummarySessionHarness, variantAt } from '../workers/support/summary-session-harness'
import { makeVariant } from '../../utils/make-variant'

const VCF = resolve(__dirname, '../../test-data/vcf/synthetic-split-genotypes.vcf')
const SAMPLES = ['S1', 'S2', 'S3', 'S4', 'S5'] as const

type Counts = { carrier_count: number; het_count: number; hom_count: number }

const SUMMARY_SQL = `SELECT chr || ':' || pos || ':' || ref || '>' || alt AS variant,
    carrier_count, het_count, hom_count
  FROM cohort_variant_summary ORDER BY chr, pos, alt`

function summaryOf(db: DatabaseService['database']): Record<string, Counts> {
  const rows = db.prepare(SUMMARY_SQL).all() as Array<Counts & { variant: string }>
  return Object.fromEntries(rows.map(({ variant, ...counts }) => [variant, counts]))
}

/**
 * The fixture, per ALT allele:
 *   chr1:1000 A>G,T  S1 1/2  S2 0/1  S3 1/1  S4 2|1  S5 0/2
 *   chr1:2000 C>T    S1 ./1  S2 1/.                   S5 0/1   (half-calls in the source)
 *   chrX:5000 G>A    S1 1    S2 0/1  S3 1/1                    (S1 haploid)
 */
const EXPECTED_SUMMARY: Record<string, Counts> = {
  'chr1:1000:A>G': { carrier_count: 4, het_count: 3, hom_count: 1 },
  'chr1:1000:A>T': { carrier_count: 3, het_count: 3, hom_count: 0 },
  'chr1:2000:C>T': { carrier_count: 3, het_count: 3, hom_count: 0 },
  // S1 is hemizygous: a carrier that is neither het nor hom.
  'chrX:5000:G>A': { carrier_count: 3, het_count: 1, hom_count: 1 }
}

describe('split multi-allelic genotypes on SQLite', () => {
  let service: DatabaseService
  const caseIds: Record<string, number> = {}

  beforeEach(async () => {
    service = new DatabaseService(':memory:')
    const strategy = new VcfStrategy()
    for (const sample of SAMPLES) {
      const caseId = service.cases.createCase(sample, VCF, 1000)
      caseIds[sample] = caseId
      await strategy.import(
        VCF,
        { caseName: sample },
        { db: service, formatInfo: { format: 'vcf', caseKey: '' }, caseId, startTime: Date.now() },
        { selectedSamples: [sample], genomeBuild: 'GRCh38' }
      )
    }
  })

  afterEach(() => service.close())

  const storedGenotypes = (sample: string): string[] =>
    (
      service.database
        .prepare(
          `SELECT chr || ':' || pos || '>' || alt || ' ' || gt_num AS row
             FROM variants WHERE case_id = ? ORDER BY chr, pos, alt`
        )
        .all(caseIds[sample]) as Array<{ row: string }>
    ).map((r) => r.row)

  it('stores one row per carried ALT, the other ALT as a missing allele', () => {
    expect(storedGenotypes('S1')).toEqual([
      'chr1:1000>G 1/.',
      'chr1:1000>T ./1',
      'chr1:2000>T ./1',
      'chrX:5000>A 1'
    ])
    expect(storedGenotypes('S4')).toEqual(['chr1:1000>G .|1', 'chr1:1000>T 1|.'])
    // 0/2: no row for the first ALT, an ordinary het for the second.
    expect(storedGenotypes('S5')).toEqual(['chr1:1000>T 0/1', 'chr1:2000>T 0/1'])
  })

  it('a full rebuild counts every split or half-called carrier as het', () => {
    service.cohortSummary.rebuild()
    expect(summaryOf(service.database)).toEqual(EXPECTED_SUMMARY)
  })

  it('het + hom + hemizygous accounts for every carrier', () => {
    service.cohortSummary.rebuild()
    const rows = service.database
      .prepare(
        `SELECT s.carrier_count - s.het_count - s.hom_count AS other,
           (SELECT COUNT(DISTINCT v.case_id) FROM variants v
             WHERE v.chr = s.chr AND v.pos = s.pos AND v.alt = s.alt AND v.gt_num = '1') AS hemi
         FROM cohort_variant_summary s`
      )
      .all() as Array<{ other: number; hemi: number }>
    expect(rows).toHaveLength(4)
    for (const row of rows) expect(row.other).toBe(row.hemi)
  })

  it('lists each sample as a carrier of each ALT it carries', () => {
    const carriers = (alt: string): string[] =>
      service.cohort
        .getCarriers({
          chr: 'chr1',
          pos: 1000,
          ref: 'A',
          alt,
          variant_type: 'snv',
          genome_build: 'GRCh38'
        })
        .map((c) => `${c.case_name} ${c.gt_num}`)
    expect(carriers('G')).toEqual(['S1 1/.', 'S2 0/1', 'S3 1/1', 'S4 .|1'])
    expect(carriers('T')).toEqual(['S1 ./1', 'S4 1|.', 'S5 0/1'])
  })

  it('the legacy incremental add and remove count like the rebuild', () => {
    for (const sample of SAMPLES) service.cohortSummary.incrementalAdd(caseIds[sample])
    expect(summaryOf(service.database)).toEqual(EXPECTED_SUMMARY)

    service.cohortSummary.incrementalRemove(caseIds.S1)
    service.cohortSummary.incrementalRemove(caseIds.S4)
    expect(summaryOf(service.database)).toEqual({
      'chr1:1000:A>G': { carrier_count: 2, het_count: 1, hom_count: 1 },
      'chr1:1000:A>T': { carrier_count: 1, het_count: 1, hom_count: 0 },
      'chr1:2000:C>T': { carrier_count: 2, het_count: 2, hom_count: 0 },
      'chrX:5000:G>A': { carrier_count: 2, het_count: 1, hom_count: 1 }
    })
  })

  it('removing a case subtracts what the rebuild counted for it', async () => {
    service.cohortSummary.rebuild()
    await deleteCasesIncrementally(service.database, [caseIds.S1, caseIds.S4], {
      deletingAll: false,
      summary: openCaseSummaryRemoval(service.database),
      isCancelled: () => false,
      onProgress: () => undefined
    })
    const maintained = summaryOf(service.database)
    expect(maintained['chr1:1000:A>G']).toEqual({ carrier_count: 2, het_count: 1, hom_count: 1 })
    expect(maintained['chr1:1000:A>T']).toEqual({ carrier_count: 1, het_count: 1, hom_count: 0 })
    service.cohortSummary.rebuild()
    expect(maintained).toEqual(summaryOf(service.database))
  })

  describe('association dosage', () => {
    const dosagesByCase = (gene: string): Record<string, number[]> => {
      const ids = SAMPLES.map((sample) => caseIds[sample])
      const data = new AssociationDataBuilder(service.database)
        .build(ids.slice(0, 2), ids.slice(2), {}, [])
        .find((g) => g.gene_symbol === gene)
      expect(data).toBeDefined()
      return Object.fromEntries(SAMPLES.map((sample, i) => [sample, data!.samples[i].dosages]))
    }

    it('a split 1/2 or half-called sample carries one copy of each of its alleles', () => {
      // Variants in key order: chr1:1000 A>G, chr1:1000 A>T, chr1:2000 C>T.
      expect(dosagesByCase('GENEA')).toEqual({
        S1: [1, 1, 1],
        S2: [1, 0, 1],
        S3: [2, 0, 0],
        S4: [1, 1, 0],
        S5: [0, 1, 1]
      })
    })

    it('counts those samples as carriers of the gene', () => {
      const ids = SAMPLES.map((sample) => caseIds[sample])
      const gene = new AssociationDataBuilder(service.database)
        .build([ids[0], ids[3]], [ids[1], ids[2], ids[4]], {}, [])
        .find((g) => g.gene_symbol === 'GENEA')
      // S1 and S4 have split genotypes only: both are carriers.
      expect(gene).toMatchObject({ groupA_carrier_count: 2, groupA_non_carrier_count: 0 })
    })

    it('a hemizygous call is one copy', () => {
      expect(dosagesByCase('GENEX')).toMatchObject({ S1: [1], S2: [1], S3: [2] })
    })
  })

  describe('inheritance filters', () => {
    const matching = (sample: string, mode: string): string[] =>
      service.variants
        .getVariants({ case_id: caseIds[sample], inheritance_modes: [mode] }, 50, 0)
        .data.map((v) => `${v.chr}:${v.pos}>${v.alt}`)
        .sort()

    it('heterozygous keeps both rows of a split 1/2 site and half-calls', () => {
      expect(matching('S1', 'heterozygous')).toEqual(['chr1:1000>G', 'chr1:1000>T', 'chr1:2000>T'])
      expect(matching('S4', 'heterozygous')).toEqual(['chr1:1000>G', 'chr1:1000>T'])
    })

    it('homozygous never takes a split or half-called genotype', () => {
      expect(matching('S1', 'homozygous')).toEqual([])
      expect(matching('S3', 'homozygous')).toEqual(['chr1:1000>G', 'chrX:5000>A'])
    })

    it('two different ALT alleles at one site are a compound-het candidate', () => {
      expect(matching('S4', 'candidate_compound_het')).toEqual(['chr1:1000>G', 'chr1:1000>T'])
    })

    it('x_hemizygous keeps the haploid call', () => {
      expect(matching('S1', 'x_hemizygous')).toEqual(['chrX:5000>A'])
    })
  })
})

describe('split genotypes in the trio filters on SQLite', () => {
  let service: DatabaseService
  let probandId: number
  let fatherId: number
  let motherId: number
  let groupId: number

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    probandId = service.cases.createCase('proband', '/p.json', 100)
    fatherId = service.cases.createCase('father', '/f.json', 100)
    motherId = service.cases.createCase('mother', '/m.json', 100)
    groupId = service.analysisGroups.createGroup('FAM', 'family').id
    service.analysisGroups.addMember(groupId, probandId, 'proband', 'affected')
    service.analysisGroups.addMember(groupId, fatherId, 'father', 'unaffected')
    service.analysisGroups.addMember(groupId, motherId, 'mother', 'unaffected')
  })

  afterEach(() => service.close())

  const matching = (mode: string): string[] =>
    service.variants
      .getVariants(
        { case_id: probandId, inheritance_modes: [mode], analysis_group_id: groupId },
        50,
        0
      )
      .data.map((v) => `${v.pos}>${v.alt}`)
      .sort()

  it('compound_het finds a 1/2 proband whose parents each carry one of the alleles', () => {
    service.variants.insertVariantsBatch(probandId, [
      makeVariant({ pos: 100, alt: 'G', gt_num: '1/.' }),
      makeVariant({ pos: 100, alt: 'T', gt_num: './1' })
    ])
    service.variants.insertVariantsBatch(fatherId, [
      makeVariant({ pos: 100, alt: 'G', gt_num: '0/1' })
    ])
    service.variants.insertVariantsBatch(motherId, [
      makeVariant({ pos: 100, alt: 'T', gt_num: '1/0' })
    ])
    expect(matching('compound_het')).toEqual(['100>G', '100>T'])
  })

  it('de_novo keeps a split het that neither parent carries, and drops an inherited one', () => {
    service.variants.insertVariantsBatch(probandId, [
      makeVariant({ pos: 100, alt: 'G', gt_num: '1|.' }),
      makeVariant({ pos: 100, alt: 'T', gt_num: '.|1' })
    ])
    service.variants.insertVariantsBatch(motherId, [
      makeVariant({ pos: 100, alt: 'T', gt_num: './1' })
    ])
    expect(matching('de_novo')).toEqual(['100>G'])
  })

  const row = (pos: number, alt: string, gt: string | null): ReturnType<typeof makeVariant> =>
    makeVariant({ pos, alt, gt_num: gt })

  it('compound_het returns only the variants of a pair inherited from opposite parents', () => {
    service.variants.insertVariantsBatch(probandId, [
      row(100, 'G', '1/.'),
      row(100, 'T', './1'),
      // In the same gene, but in neither parent: not part of an inherited pair.
      row(200, 'G', '1/.')
    ])
    service.variants.insertVariantsBatch(fatherId, [row(100, 'G', '0/1')])
    service.variants.insertVariantsBatch(motherId, [row(100, 'T', '0/1')])
    expect(matching('compound_het')).toEqual(['100>G', '100>T'])
  })

  it('compound_het needs one variant from each parent, not two that both parents carry', () => {
    service.variants.insertVariantsBatch(probandId, [row(100, 'G', '0/1'), row(200, 'G', '0/1')])
    for (const parent of [fatherId, motherId]) {
      service.variants.insertVariantsBatch(parent, [row(100, 'G', '0/1'), row(200, 'G', '0/1')])
    }
    expect(matching('compound_het')).toEqual([])
  })

  it('compound_het does not pair two variants inherited from the same parent', () => {
    service.variants.insertVariantsBatch(probandId, [row(100, 'G', '0/1'), row(200, 'G', '0/1')])
    service.variants.insertVariantsBatch(fatherId, [row(100, 'G', '0/1'), row(200, 'G', '1/1')])
    expect(matching('compound_het')).toEqual([])
  })

  it('compound_het does not take an uncalled parent for a non-carrier', () => {
    service.variants.insertVariantsBatch(probandId, [row(100, 'G', '0/1'), row(200, 'G', '0/1')])
    service.variants.insertVariantsBatch(fatherId, [row(100, 'G', '0/1'), row(200, 'G', './.')])
    service.variants.insertVariantsBatch(motherId, [row(200, 'G', '0/1')])
    expect(matching('compound_het')).toEqual([])
  })

  it('a variant stored twice is one variant for compound het, with or without parents', () => {
    service.variants.insertVariantsBatch(probandId, [row(100, 'G', '1/.'), row(100, 'G', '1/.')])
    service.variants.insertVariantsBatch(fatherId, [row(100, 'G', '0/1')])
    expect(matching('compound_het')).toEqual([])
    expect(matching('candidate_compound_het')).toEqual([])
  })

  describe('de_novo and the call of a parent at the variant', () => {
    const withFather = (gt: string | null | undefined): string[] => {
      service.variants.insertVariantsBatch(probandId, [row(100, 'G', '1/.')])
      service.variants.insertVariantsBatch(motherId, [row(100, 'G', '0/0')])
      if (gt !== undefined) service.variants.insertVariantsBatch(fatherId, [row(100, 'G', gt)])
      return matching('de_novo')
    }

    it.each([undefined, '0/0', '0|0', '0'])('reference or no row (%s): de novo', (gt) => {
      expect(withFather(gt)).toEqual(['100>G'])
    })

    it.each(['./.', '.|.', '.', '0/.', '', null])('an uncalled father (%s): not shown', (gt) => {
      expect(withFather(gt)).toEqual([])
    })

    it.each(['0/1', '1/.', '1/1', '1'])('a father who carries it (%s): not de novo', (gt) => {
      expect(withFather(gt)).toEqual([])
    })
  })
})

describe('split genotypes merged by an import session', () => {
  it('the incremental case add counts like the rebuild', async () => {
    const harness = openSummarySessionHarness()
    try {
      await harness.run([harness.file('first', [variantAt(100, 'GENEA')])])
      // The summary exists and is current: these cases are merged, not rebuilt.
      await harness.run([
        harness.file('split', [variantAt(100, 'GENEA', { gt_num: '1/.' })]),
        harness.file('phased', [variantAt(100, 'GENEA', { gt_num: '.|1' })]),
        harness.file('hom', [variantAt(100, 'GENEA', { gt_num: '1/1' })]),
        harness.file('hemi', [variantAt(100, 'GENEA', { gt_num: '1' })])
      ])
      expect(harness.db.prepare(SUMMARY_SQL).all()).toEqual([
        { variant: 'chr1:100:A>G', carrier_count: 5, het_count: 3, hom_count: 1 }
      ])
    } finally {
      harness.close()
    }
  })
})
