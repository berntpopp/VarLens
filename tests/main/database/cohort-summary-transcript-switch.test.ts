// @vitest-environment node
/**
 * Issue #461: switching (or adding and switching) a variant's selected
 * transcript rewrites gene_symbol / consequence / func / cdna / aa_change /
 * transcript on the variant row. cohort_variant_summary holds the MAX() of
 * each of those per coordinate and gene_burden_summary counts per gene, so
 * both must follow in the same transaction and equal a fresh rebuild.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { MARK_STALE_SQL } from '../../../src/shared/sql/cohort-summary-rebuild'
import { referenceSummary, snapshotSummary } from '../workers/support/summary-reference'

describe('transcript switch keeps the cohort summary equal to a rebuild (#461)', () => {
  let service: DatabaseService
  const db = (): DatabaseService['database'] => service.database

  const addCase = (name: string, build = 'GRCh38'): number =>
    Number(
      db()
        .prepare(
          `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
           VALUES (?, '/tmp/x.json', 1, 0, 0, ?)`
        )
        .run(name, build).lastInsertRowid
    )

  interface Tx {
    id: string
    gene: string | null
    consequence: string
    func: string
    cdna: string
    aa: string | null
  }
  const TX: Record<string, Tx> = {
    a: {
      id: 'NM_A',
      gene: 'GENEA',
      consequence: 'MODERATE',
      func: 'missense_variant',
      cdna: 'c.1A>G',
      aa: 'p.K1R'
    },
    b: {
      id: 'NM_B',
      gene: 'GENEB',
      consequence: 'HIGH',
      func: 'stop_gained',
      cdna: 'c.9A>G',
      aa: 'p.K3*'
    },
    low: {
      id: 'NM_0',
      gene: 'AAAA',
      consequence: 'LOW',
      func: 'synonymous_variant',
      cdna: 'c.0A>G',
      aa: null
    }
  }

  /** A variant whose selected transcript is `selected`, with `others` stored unselected. */
  function addVariant(
    caseId: number,
    pos: number,
    selected: Tx,
    others: Tx[] = [],
    alt = 'G'
  ): number {
    const id = Number(
      db()
        .prepare(
          `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, func, cdna,
             aa_change, transcript, gt_num, variant_type)
           VALUES (?, 'chr1', ?, 'A', ?, ?, ?, ?, ?, ?, ?, '0/1', 'snv')`
        )
        .run(
          caseId,
          pos,
          alt,
          selected.gene,
          selected.consequence,
          selected.func,
          selected.cdna,
          selected.aa,
          selected.id
        ).lastInsertRowid
    )
    const insert = db().prepare(
      `INSERT INTO variant_transcripts (variant_id, transcript_id, gene_symbol, consequence, func,
         cdna, aa_change, is_selected) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const [t, sel] of [[selected, 1], ...others.map((o) => [o, 0])] as [Tx, number][]) {
      insert.run(id, t.id, t.gene, t.consequence, t.func, t.cdna, t.aa, sel)
    }
    return id
  }

  const summaryRow = (pos: number): Record<string, unknown> =>
    db().prepare('SELECT * FROM cohort_variant_summary WHERE pos = ?').get(pos) as Record<
      string,
      unknown
    >
  const gene = (symbol: string): Record<string, unknown> | undefined =>
    db()
      .prepare(
        `SELECT variant_count, unique_variant_count, affected_case_count
         FROM gene_burden_summary WHERE gene_symbol = ?`
      )
      .get(symbol) as Record<string, unknown> | undefined

  const expectExact = (): void => expect(snapshotSummary(db())).toEqual(referenceSummary(db()))

  let c1: number
  let c2: number
  let v1: number
  let v2: number

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    c1 = addCase('one')
    c2 = addCase('two')
    // pos 100: both cases carry it; pos 200: only case one; pos 300: second GENEA coordinate.
    v1 = addVariant(c1, 100, TX.a, [TX.b, TX.low])
    v2 = addVariant(c2, 100, TX.a, [TX.b, TX.low])
    addVariant(c1, 200, TX.a, [TX.b])
    addVariant(c2, 300, TX.a)
    service.cohortSummary.rebuild()
    expectExact()
  })

  afterEach(() => service.close())

  it('raises the representative annotation and moves the gene burden', () => {
    service.transcripts.switchSelectedTranscript(v1, 'NM_B')

    expect(summaryRow(100)).toMatchObject({
      gene_symbol: 'GENEB',
      consequence: 'MODERATE', // MAX('HIGH', 'MODERATE') as text, like the rebuild
      func: 'stop_gained',
      cdna: 'c.9A>G',
      transcript: 'NM_B',
      carrier_count: 2
    })
    expect(gene('GENEB')).toEqual({
      variant_count: 1,
      unique_variant_count: 1,
      affected_case_count: 1
    })
    expect(gene('GENEA')).toEqual({
      variant_count: 3,
      unique_variant_count: 3,
      affected_case_count: 2
    })
    expectExact()
  })

  it('lowers the representative annotation when the last holder of a maximum switches away', () => {
    service.transcripts.switchSelectedTranscript(v1, 'NM_0')
    expect(summaryRow(100)).toMatchObject({ gene_symbol: 'GENEA', transcript: 'NM_A' })
    expectExact()

    service.transcripts.switchSelectedTranscript(v2, 'NM_0')
    expect(summaryRow(100)).toMatchObject({
      gene_symbol: 'AAAA',
      consequence: 'LOW',
      aa_change: null,
      transcript: 'NM_0'
    })
    expect(gene('AAAA')).toEqual({
      variant_count: 2,
      unique_variant_count: 1,
      affected_case_count: 2
    })
    expect(gene('GENEA')).toEqual({
      variant_count: 2,
      unique_variant_count: 2,
      affected_case_count: 2
    })
    expectExact()
  })

  it('drops a gene that loses its last variant and handles a NULL gene', () => {
    const only = addVariant(c1, 400, { ...TX.b, gene: 'SOLO' }, [{ ...TX.low, gene: null }])
    service.cohortSummary.rebuild()
    service.transcripts.switchSelectedTranscript(only, 'NM_0')
    expect(gene('SOLO')).toBeUndefined()
    expect(summaryRow(400)).toMatchObject({ gene_symbol: null })
    expectExact()
  })

  it('keeps global and per-case annotation flags and sibling rows of the coordinate', () => {
    const c37 = addCase('three', 'GRCh37')
    addVariant(c37, 100, TX.low)
    const now = Date.now()
    db().exec(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred, created_at, updated_at)
       VALUES ('chr1', 100, 'A', 'G', 'note', 0, ${now}, ${now})`
    )
    service.cohortSummary.rebuild()
    service.annotations.upsertPerCaseAnnotation(c2, v2, {
      starred: true,
      acmg_classification: 'Pathogenic'
    })
    expectExact()

    service.transcripts.switchSelectedTranscript(v1, 'NM_B')
    const rows = db()
      .prepare(
        'SELECT genome_build, has_star, has_comment, acmg_best FROM cohort_variant_summary WHERE pos = 100 ORDER BY genome_build'
      )
      .all()
    expect(rows).toEqual([
      { genome_build: 'GRCh37', has_star: 1, has_comment: 1, acmg_best: 'Pathogenic' },
      { genome_build: 'GRCh38', has_star: 1, has_comment: 1, acmg_best: 'Pathogenic' }
    ])
    expectExact()
  })

  it('insertTranscriptAndSwitch follows the same path', () => {
    service.transcripts.insertTranscriptAndSwitch(v1, {
      transcript_id: 'NM_NEW',
      gene_symbol: 'ZZZZ',
      consequence: 'HIGH',
      func: 'frameshift_variant',
      cdna: 'c.99del',
      aa_change: 'p.X9fs',
      hpo_sim_score: null,
      moi: null,
      is_selected: 0
    })
    expect(summaryRow(100)).toMatchObject({ gene_symbol: 'ZZZZ', transcript: 'NM_NEW' })
    expect(gene('ZZZZ')).toEqual({
      variant_count: 1,
      unique_variant_count: 1,
      affected_case_count: 1
    })
    expectExact()
  })

  it('leaves a stale summary alone (the pending rebuild covers it) and rolls back with a failed switch', () => {
    expect(() => service.transcripts.switchSelectedTranscript(v1, 'NM_MISSING')).toThrow()
    expectExact()

    db().exec(MARK_STALE_SQL)
    const before = snapshotSummary(db())
    service.transcripts.switchSelectedTranscript(v1, 'NM_B')
    expect(snapshotSummary(db())).toEqual(before)
  })

  describe('reporting that the summary went stale', () => {
    const SESSION_OPEN =
      "INSERT OR REPLACE INTO cohort_summary_meta (key, value) VALUES ('import_session_open', '1')"

    it('reports nothing when the switch patched the summary', () => {
      expect(service.transcripts.switchSelectedTranscript(v1, 'NM_B')).toEqual({
        cohortSummaryStale: false
      })
      expectExact()
    })

    it('reports the flag it set while an import session is open', () => {
      db().exec(SESSION_OPEN)

      // Nobody else tells the renderer: the caller has to.
      expect(service.transcripts.switchSelectedTranscript(v1, 'NM_B')).toEqual({
        cohortSummaryStale: true
      })
      expect(service.cohortSummary.getStatus().is_stale).toBe(true)
    })

    it('reports it for insertTranscriptAndSwitch too', () => {
      db().exec(SESSION_OPEN)
      const result = service.transcripts.insertTranscriptAndSwitch(v1, {
        transcript_id: 'NM_NEW',
        gene_symbol: 'GENEN',
        consequence: 'HIGH',
        func: 'stop_gained',
        cdna: null,
        aa_change: null,
        hpo_sim_score: null,
        moi: null,
        is_selected: 0
      })
      expect(result).toEqual({ cohortSummaryStale: true })
    })

    it('reports nothing for a summary that was stale already', () => {
      db().exec(MARK_STALE_SQL)
      expect(service.transcripts.switchSelectedTranscript(v1, 'NM_B')).toEqual({
        cohortSummaryStale: false
      })
    })
  })
})
