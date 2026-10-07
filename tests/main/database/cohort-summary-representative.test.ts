// @vitest-environment node
/**
 * Issue #469 on SQLite: what a cohort summary row shows for a variant whose
 * carriers are annotated differently.
 *
 *  - Transcript-level columns (impact, func, gene, cdna, aa_change, transcript,
 *    OMIM) come together from ONE carrier row, the most severe by impact rank
 *    with a bytewise tie-break: never a mix of two transcripts.
 *  - Variant-level facts are aggregated over ALL carriers, each on its own:
 *    ClinVar = the most severe significance, gnomAD = the lowest frequency,
 *    CADD = the highest score. A fact one carrier has is never lost because
 *    another carrier supplies the transcript.
 *
 * The old rule was a bytewise MAX() per column: impact HIGH < LOW < MODERATE <
 * MODIFIER, so one MODIFIER carrier turned a HIGH variant into MODIFIER and
 * the cohort filter impact = HIGH hid it; ClinVar 'Uncertain significance'
 * beat 'Pathogenic'; and a row mixed columns of different transcripts.
 *
 * Every maintenance path must arrive at the same row: full rebuild (main
 * thread and both worker variants), per-file add, removal, transcript switch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { openImportSummarySession } from '../../../src/main/database/cohort-summary-case-add'
import { openCaseSummaryRemoval } from '../../../src/main/database/cohort-summary-case-removal'
import { rebuildCohortSummaryCancellable } from '../../../src/main/workers/cancellable-summary-rebuild'
import { deleteCasesIncrementally } from '../../../src/main/workers/delete-operations'
import { rebuildCohortSummary } from '../../../src/main/workers/worker-db'
import { referenceSummary, snapshotSummary } from '../workers/support/summary-reference'

interface Annotation {
  gene_symbol?: string | null
  consequence?: string | null
  func?: string | null
  clinvar?: string | null
  cdna?: string | null
  transcript?: string | null
  gnomad_af?: number | null
  cadd?: number | null
}

const HIGH: Annotation = {
  gene_symbol: 'BRCA1',
  consequence: 'HIGH',
  func: 'stop_gained',
  clinvar: 'Pathogenic',
  cdna: 'c.68_69del',
  transcript: 'NM_007294.4',
  gnomad_af: 0.0001,
  cadd: 35
}
const MODIFIER: Annotation = {
  gene_symbol: 'BRCA1-AS1',
  consequence: 'MODIFIER',
  func: 'upstream_gene_variant',
  clinvar: null,
  cdna: null,
  transcript: 'NR_999999.1',
  gnomad_af: 0.5,
  cadd: 40
}

/** The transcript-level columns of an annotation. */
const transcriptOf = (annotation: Annotation): Annotation => ({
  gene_symbol: annotation.gene_symbol,
  consequence: annotation.consequence,
  func: annotation.func,
  cdna: annotation.cdna,
  transcript: annotation.transcript
})

describe('cohort summary representative: the most severe carrier row (#469)', () => {
  let service: DatabaseService
  const db = (): DatabaseService['database'] => service.database

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => service.close())

  /** A case carrying 1:100:A:T with `annotation`, imported through the repository. */
  function addCarrier(name: string, annotation: Annotation, pos = 100): number {
    const caseId = service.cases.createCase(name, `/tmp/${name}.json`, 0, 'GRCh38')
    service.variants.insertVariantsBatch(caseId, [
      {
        chr: '1',
        pos,
        ref: 'A',
        alt: 'T',
        gt_num: '0/1',
        variant_type: 'snv',
        gene_symbol: null,
        consequence: null,
        func: null,
        clinvar: null,
        cdna: null,
        transcript: null,
        gnomad_af: null,
        cadd: null,
        ...annotation
      } as never
    ])
    return caseId
  }

  const row = (pos = 100): Record<string, unknown> =>
    db()
      .prepare(
        `SELECT gene_symbol, consequence, func, clinvar, cdna, transcript, gnomad_af, cadd,
                impact_rank, clinvar_rank, carrier_count
           FROM cohort_variant_summary WHERE pos = ?`
      )
      .get(pos) as Record<string, unknown>

  const expectExact = (): void => expect(snapshotSummary(db())).toEqual(referenceSummary(db()))

  /** Add cases one by one the way the import worker publishes files. */
  function addIncrementally(carriers: Array<[string, Annotation]>): number[] {
    const session = openImportSummarySession(db(), {
      forceRebuild: false,
      rebuild: () => service.cohortSummary.rebuild(),
      onWarning: (warning) => {
        throw new Error(warning)
      }
    })
    const ids = carriers.map(([name, annotation]) => {
      const caseId = addCarrier(name, annotation)
      session.addCase(caseId)
      expectExact()
      return caseId
    })
    session.finish()
    return ids
  }

  it('carriers HIGH, HIGH, MODIFIER give a HIGH row that impact = HIGH finds', () => {
    addCarrier('a', HIGH)
    addCarrier('b', HIGH)
    addCarrier('c', MODIFIER)
    service.cohortSummary.rebuild()

    expect(row()).toEqual({
      ...transcriptOf(HIGH),
      impact_rank: 4,
      clinvar: 'Pathogenic',
      clinvar_rank: 15,
      gnomad_af: 0.0001, // the lowest any carrier has
      cadd: 40, // the highest any carrier has
      carrier_count: 3
    })
    const filtered = service.cohort.getCohortVariants({ consequences: ['HIGH'] })
    expect(filtered.data.map((v) => v.variant_key)).toEqual(['1:100:A:T'])
    expect(service.cohort.getCohortVariants({ consequences: ['MODIFIER'] }).data).toEqual([])
  })

  it('takes the transcript-level columns from one carrier: no chimera', () => {
    addCarrier('a', HIGH)
    addCarrier('c', MODIFIER)
    service.cohortSummary.rebuild()

    // Not MODIFIER's gene or transcript, although each is a bytewise maximum.
    expect(row()).toMatchObject(transcriptOf(HIGH))
  })

  it('a ClinVar value of another carrier is not lost behind the chosen transcript', () => {
    // The review's scenario: A is MODERATE and Pathogenic, B is HIGH on another
    // transcript and has no ClinVar value. B supplies the transcript; the
    // variant is still Pathogenic, and the ClinVar filter must find it.
    addCarrier('a', {
      gene_symbol: 'GENEA',
      consequence: 'MODERATE',
      func: 'missense_variant',
      clinvar: 'Pathogenic'
    })
    addCarrier('b', {
      gene_symbol: 'GENEB',
      consequence: 'HIGH',
      func: 'stop_gained',
      clinvar: null
    })
    service.cohortSummary.rebuild()

    expect(row()).toMatchObject({
      gene_symbol: 'GENEB',
      consequence: 'HIGH',
      func: 'stop_gained',
      impact_rank: 4,
      clinvar: 'Pathogenic',
      clinvar_rank: 15
    })
    for (const filter of [{ clinvars: ['Pathogenic'] }, { consequences: ['HIGH'] }]) {
      expect(service.cohort.getCohortVariants(filter).data.map((v) => v.variant_key)).toEqual([
        '1:100:A:T'
      ])
    }
  })

  it('ranks ClinVar by significance over all carriers, ties by the text', () => {
    const base = { gene_symbol: 'GENE', consequence: 'MODERATE', func: 'missense_variant' }
    addCarrier('a', { ...base, clinvar: 'Uncertain_significance' })
    addCarrier('b', { ...base, clinvar: 'Pathogenic/Likely_pathogenic' })
    addCarrier('c', { ...base, clinvar: 'not_provided' })
    addCarrier('d', { ...base, clinvar: 'pathogenic&likely_pathogenic' })
    service.cohortSummary.rebuild()

    // Bytewise, 'Uncertain…' and 'not_provided' sort above 'Pathogenic/…'. The
    // two spellings of the same category tie on rank: 'p' (0x70) > 'P' (0x50).
    expect(row()).toMatchObject({
      clinvar: 'pathogenic&likely_pathogenic',
      clinvar_rank: 14,
      carrier_count: 4
    })
  })

  it('gnomAD and CADD come from any carrier that has them', () => {
    const transcript = { gene_symbol: 'GENE', func: 'stop_gained' }
    // The carrier that supplies the transcript has neither value.
    addCarrier('a', { ...transcript, consequence: 'HIGH', gnomad_af: null, cadd: null })
    addCarrier('b', { ...transcript, consequence: 'LOW', gnomad_af: 0.5, cadd: 12 })
    service.cohortSummary.rebuild()
    expect(row()).toMatchObject({ consequence: 'HIGH', gnomad_af: 0.5, cadd: 12 })

    // Differing values (another annotation release): the lowest frequency and
    // the highest score, so neither filter hides the variant.
    addCarrier('c', { ...transcript, consequence: 'LOW', gnomad_af: 0.001, cadd: 30 })
    service.cohortSummary.rebuild()
    expect(row()).toMatchObject({ consequence: 'HIGH', gnomad_af: 0.001, cadd: 30 })
    expect(
      service.cohort.getCohortVariants({ gnomad_af_max: 0.01, cadd_min: 20 }).data
    ).toHaveLength(1)
  })

  it('breaks ties bytewise and identically whatever the insertion order', () => {
    const tied = (gene: string, cdna: string | null): Annotation => ({
      ...HIGH,
      gene_symbol: gene,
      cdna
    })
    // Bytewise 'a' (0x61) sorts after 'Z' (0x5A); NULL is last.
    const carriers: Array<[string, Annotation]> = [
      ['a', tied('ZNF1', 'c.9A>T')],
      ['b', tied('aBC1', null)],
      ['c', tied('aBC1', 'c.1A>T')],
      ['d', tied('BRCA1', 'c.5A>T')]
    ]
    const expected = { gene_symbol: 'aBC1', cdna: 'c.1A>T', carrier_count: 4 }

    for (const order of [carriers, [...carriers].reverse()]) {
      service.close()
      service = new DatabaseService(':memory:')
      for (const [name, annotation] of order) addCarrier(name, annotation)
      service.cohortSummary.rebuild()
      expect(row()).toMatchObject(expected)
    }
  })

  it('the per-file add arrives at the rebuilt row in any order', () => {
    for (const order of [
      [HIGH, HIGH, MODIFIER],
      [MODIFIER, HIGH, HIGH],
      [HIGH, MODIFIER, HIGH]
    ]) {
      service.close()
      service = new DatabaseService(':memory:')
      service.cohortSummary.rebuild()
      addIncrementally(order.map((annotation, index) => [`case-${index}`, annotation]))
      expect(row()).toMatchObject({
        ...transcriptOf(HIGH),
        clinvar: 'Pathogenic',
        gnomad_af: 0.0001,
        cadd: 40,
        carrier_count: 3
      })
      expectExact()
    }
  })

  it('removal gives back what the removed case supplied, transcript and facts', async () => {
    service.cohortSummary.rebuild()
    const MID = { ...MODIFIER, consequence: 'MODERATE', gene_symbol: 'MID', cadd: 38 }
    const [high, moderate, modifier] = addIncrementally([
      ['high', HIGH],
      ['moderate', MID],
      ['modifier', MODIFIER]
    ])
    const remove = (caseId: number): Promise<unknown> =>
      deleteCasesIncrementally(db(), [caseId], {
        deletingAll: false,
        isCancelled: () => false,
        onProgress: () => undefined,
        summary: openCaseSummaryRemoval(db())
      })
    expect(row()).toMatchObject({ ...transcriptOf(HIGH), cadd: 40, gnomad_af: 0.0001 })

    // MODIFIER held the CADD maximum; the transcript and ClinVar are HIGH's.
    await remove(modifier)
    expect(row()).toMatchObject({
      ...transcriptOf(HIGH),
      clinvar: 'Pathogenic',
      cadd: 38,
      gnomad_af: 0.0001,
      carrier_count: 2
    })
    expectExact()

    // HIGH supplied the transcript, the ClinVar value and the gnomAD minimum.
    await remove(high)
    expect(row()).toMatchObject({
      ...transcriptOf(MID),
      impact_rank: 3,
      clinvar: null,
      clinvar_rank: 0,
      cadd: 38,
      gnomad_af: 0.5,
      carrier_count: 1
    })
    expectExact()

    await remove(moderate)
    expect(row()).toBeUndefined()
    expectExact()
  })

  it('a transcript switch re-ranks the row and can hand over the representative', () => {
    const high = addCarrier('a', HIGH)
    addCarrier('c', { ...MODIFIER, consequence: 'LOW' })
    service.cohortSummary.rebuild()
    const variantId = (
      db().prepare('SELECT id FROM variants WHERE case_id = ?').get(high) as { id: number }
    ).id

    service.transcripts.insertTranscriptAndSwitch(variantId, {
      transcript_id: 'NR_000001.1',
      gene_symbol: 'OTHER',
      consequence: 'MODIFIER',
      func: 'intron_variant',
      cdna: 'c.1-5A>T',
      aa_change: null,
      hpo_sim_score: null,
      moi: null,
      is_selected: 0
    })

    expect(db().prepare('SELECT impact_rank FROM variants WHERE id = ?').get(variantId)).toEqual({
      impact_rank: 1
    })
    // The LOW carrier is now the most severe one; the facts are unchanged.
    expect(row()).toMatchObject({
      ...transcriptOf(MODIFIER),
      consequence: 'LOW',
      impact_rank: 2,
      clinvar: 'Pathogenic',
      cadd: 40
    })
    expectExact()
  })

  it('both worker rebuilds produce the same rows as the main-thread rebuild', async () => {
    addCarrier('a', HIGH)
    addCarrier('b', HIGH)
    addCarrier('c', MODIFIER)
    addCarrier('d', { ...MODIFIER, consequence: 'MODERATE' }, 200)
    addCarrier('e', { ...HIGH, clinvar: 'Benign' }, 200)
    service.cohortSummary.rebuild()
    const mainThread = snapshotSummary(db())
    expect(row(200)).toMatchObject({ consequence: 'HIGH', clinvar: 'Benign' })

    db().exec('DELETE FROM cohort_variant_summary')
    rebuildCohortSummary(db())
    expect(snapshotSummary(db())).toEqual(mainThread)

    db().exec('DELETE FROM cohort_variant_summary')
    expect(await rebuildCohortSummaryCancellable(db(), () => false)).toBe('rebuilt')
    expect(snapshotSummary(db())).toEqual(mainThread)
  })

  it('both views sort impact and ClinVar by severity, not by text', () => {
    // One case, so the case view and the cohort view list the same variants.
    const levels: Array<[number, string | null, string | null]> = [
      [1, 'MODIFIER', 'Uncertain significance'],
      [2, 'HIGH', 'Benign'],
      [3, null, null],
      [4, 'LOW', 'Pathogenic'],
      [5, 'MODERATE', 'Likely pathogenic'],
      [6, 'custom_level', 'free text']
    ]
    const caseId = service.cases.createCase('sorted', '/tmp/sorted.json', 0, 'GRCh38')
    service.variants.insertVariantsBatch(
      caseId,
      levels.map(
        ([pos, consequence, clinvar]) =>
          ({ chr: '1', pos, ref: 'A', alt: 'T', gt_num: '0/1', consequence, clinvar }) as never
      )
    )
    service.cohortSummary.rebuild()
    const caseView = (key: string, order: 'asc' | 'desc'): number[] =>
      service.variants
        .getVariants({ case_id: caseId }, 50, 0, [{ key, order }])
        .data.map((variant) => variant.pos)
    const cohortView = (key: string, order: 'asc' | 'desc'): number[] =>
      service.cohort
        .getCohortVariants({ sort_by: key, sort_order: order })
        .data.map((variant) => variant.pos)

    // Most severe first; unknown text and NULL last in both directions.
    // As text, descending would start MODIFIER, MODERATE, LOW, HIGH.
    const impactDesc = [2, 5, 4, 1, 6, 3]
    const impactAsc = [1, 4, 5, 2, 6, 3]
    // As text, 'Uncertain significance' would lead and 'Benign' close the list.
    const clinvarDesc = [4, 5, 1, 2, 6, 3]
    const clinvarAsc = [2, 1, 5, 4, 6, 3]
    for (const view of [caseView, cohortView]) {
      expect(view('consequence', 'desc')).toEqual(impactDesc)
      expect(view('consequence', 'asc')).toEqual(impactAsc)
      expect(view('clinvar', 'desc')).toEqual(clinvarDesc)
      expect(view('clinvar', 'asc')).toEqual(clinvarAsc)
    }
  })

  it('both views filter impact and ClinVar by category, whatever the spelling', () => {
    // One case; every variant is its own cohort row.
    const spellings: Array<[number, string | null, string | null]> = [
      [1, 'HIGH', 'Pathogenic'],
      [2, 'high', 'pathogenic'],
      [3, 'MODERATE', 'Pathogenic|drug_response'],
      [4, 'MODERATE', 'Likely_pathogenic'],
      [5, 'LOW', 'Pathogenic/Likely_pathogenic'],
      [6, 'MODIFIER', 'P'],
      [7, 'custom_level', 'reviewed: fine'],
      [8, null, null]
    ]
    const caseId = service.cases.createCase('spelled', '/tmp/spelled.json', 0, 'GRCh38')
    service.variants.insertVariantsBatch(
      caseId,
      spellings.map(
        ([pos, consequence, clinvar]) =>
          ({ chr: '1', pos, ref: 'A', alt: 'T', gt_num: '0/1', consequence, clinvar }) as never
      )
    )
    service.cohortSummary.rebuild()
    const caseView = (filter: Record<string, unknown>): number[] =>
      service.variants
        .getVariants({ case_id: caseId, ...filter }, 50, 0, [{ key: 'pos', order: 'asc' }])
        .data.map((variant) => variant.pos)
    const cohortView = (filter: Record<string, unknown>): number[] =>
      service.cohort
        .getCohortVariants({ ...filter, sort_by: 'pos', sort_order: 'asc' })
        .data.map((variant) => variant.pos)
    const column = (key: string, operator: string, value: unknown): Record<string, unknown> => ({
      column_filters: { [key]: { operator, value } }
    })
    const PRESET = ['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic']

    for (const view of [caseView, cohortView]) {
      // As text, 'Pathogenic' matched position 1 only.
      // ... and the P/LP aggregate at position 5, which contains Pathogenic.
      expect(view({ clinvars: ['Pathogenic'] })).toEqual([1, 2, 3, 5, 6])
      expect(view({ clinvars: ['Likely pathogenic'] })).toEqual([4, 5])
      expect(view({ clinvars: ['Pathogenic/Likely pathogenic'] })).toEqual([5])
      expect(view({ clinvars: PRESET })).toEqual([1, 2, 3, 4, 5, 6])
      expect(view({ clinvars: ['reviewed: fine'] })).toEqual([7])
      expect(view({ consequences: ['HIGH'] })).toEqual([1, 2])
      expect(view({ consequences: ['HIGH', 'custom_level'] })).toEqual([1, 2, 7])
      expect(view(column('clinvar', 'in', ['Pathogenic']))).toEqual([1, 2, 3, 5, 6])
      expect(view(column('clinvar', '=', 'Likely pathogenic'))).toEqual([4, 5])
      expect(view(column('clinvar', '!=', 'Pathogenic'))).toEqual([4, 7])
      expect(view(column('consequence', 'in', ['MODERATE', 'LOW']))).toEqual([3, 4, 5])
    }

    // The values offered are the categories present, not every spelling.
    const offeredClinvar = [
      'Pathogenic',
      'Pathogenic/Likely pathogenic',
      'Likely pathogenic',
      'reviewed: fine'
    ]
    const offeredImpact = ['HIGH', 'MODERATE', 'LOW', 'MODIFIER', 'custom_level']
    const options = service.variants.getFilterOptions(caseId)
    expect(options.clinvars).toEqual(offeredClinvar)
    expect(options.consequences).toEqual(offeredImpact)
    const cohortMeta = new Map(service.cohort.getColumnMeta().map((meta) => [meta.key, meta]))
    expect(cohortMeta.get('clinvar')?.distinctValues).toEqual(offeredClinvar)
    expect(cohortMeta.get('consequence')?.distinctValues).toEqual(offeredImpact)
  })

  it('a case with several rows at one variant counts once and offers its best row', () => {
    const caseId = addCarrier('multi', MODIFIER)
    service.variants.insertVariantsBatch(caseId, [
      {
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'T',
        gt_num: '1/1',
        variant_type: 'snv',
        ...HIGH
      } as never
    ])
    service.cohortSummary.rebuild()
    expect(row()).toMatchObject({ ...transcriptOf(HIGH), cadd: 40, carrier_count: 1 })
  })
})
