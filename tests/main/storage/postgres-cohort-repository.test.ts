import { describe, expect, it, vi } from 'vitest'

const geneReferenceMocks = vi.hoisted(() => ({
  getCoordinatesForGenes: vi.fn()
}))

vi.mock('../../../src/main/database/geneReferenceLoader', () => ({
  getGeneReferenceDb: () => ({
    getCoordinatesForGenes: geneReferenceMocks.getCoordinatesForGenes
  })
}))

import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

// queryVariants / getColumnMeta route through runNamed / runNamedDynamic, which
// call pool.query with a { name, text, values } spec object rather than
// positional (text, values). These helpers read the SQL/params from either
// shape so the assertions stay shape-agnostic.
function callText(call: unknown[]): string {
  const arg = call[0]
  return typeof arg === 'string' ? arg : ((arg as { text?: string }).text ?? '')
}

function callParams(call: unknown[]): unknown[] {
  const arg = call[0]
  if (typeof arg === 'string') return (call[1] as unknown[]) ?? []
  return ((arg as { values?: unknown[] }).values as unknown[]) ?? []
}

describe('PostgresCohortRepository', () => {
  it('queries total cases, grouped variant count, then rows and maps numeric strings', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '4' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            chr: '1',
            pos: '123',
            ref: 'A',
            alt: 'G',
            gene_symbol: 'BRCA1',
            cdna: 'c.1A>G',
            aa_change: 'p.Lys1Arg',
            carrier_count: '2',
            total_cases: '4',
            cohort_frequency: '0.5',
            het_count: '1',
            hom_count: '1',
            consequence: 'HIGH',
            func: 'stop_gained',
            clinvar: 'Pathogenic',
            gnomad_af: '0.001',
            cadd_phred: '32.5',
            transcript: 'NM_007294',
            omim_id: '113705'
          }
        ]
      })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    const result = await repository.queryVariants({ limit: 25, offset: 50 })

    expect(query).toHaveBeenCalledTimes(3)
    expect(normalizeSql(query.mock.calls[0][0] as string)).toBe(
      'SELECT COUNT(*)::bigint AS total_cases FROM "public"."cases"'
    )
    expect(result).toEqual({
      total_count: 2,
      data: [
        {
          chr: '1',
          pos: 123,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'BRCA1',
          cdna: 'c.1A>G',
          aa_change: 'p.Lys1Arg',
          carrier_count: 2,
          total_cases: 4,
          cohort_frequency: 0.5,
          het_count: 1,
          hom_count: 1,
          variant_key: '1:123:A:G',
          consequence: 'HIGH',
          func: 'stop_gained',
          clinvar: 'Pathogenic',
          gnomad_af: 0.001,
          cadd_phred: 32.5,
          transcript: 'NM_007294',
          omim_id: '113705'
        }
      ]
    })
  })

  it('builds summary-page cohort SQL with parameterized base filters (C4)', async () => {
    // C4: materialisable predicates read from cohort_variant_summary (alias
    // `cvs`) instead of the live variants GROUP BY.
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'tenant"schema')

    await repository.queryVariants({
      gene_symbol: `BRCA1'; DROP TABLE variants; --`,
      consequences: ['HIGH', 'MODERATE'],
      clinvars: ['Pathogenic'],
      gnomad_af_max: 0.01,
      cadd_min: 20,
      carrier_count_min: 2,
      panel_intervals: [{ chr: '1', start: 100, end: 200 }],
      search_term: `TP53%' OR TRUE --`,
      limit: 10,
      offset: 0
    })

    const countSql = normalizeSql(callText(query.mock.calls[1]))
    const countParams = callParams(query.mock.calls[1])
    const dataSql = normalizeSql(callText(query.mock.calls[2]))
    const dataParams = callParams(query.mock.calls[2])

    expect(dataSql).toContain('FROM "tenant""schema"."cohort_variant_summary" cvs')
    // No per-variant grouping: the only GROUP BY is the tiny cases-per-build
    // subquery that supplies the frequency denominator.
    expect(dataSql).not.toMatch(/GROUP BY (?!genome_build)/)
    expect(dataSql).not.toContain('HAVING')
    expect(dataSql).toContain('cvs.carrier_count')
    expect(countSql).toContain('SELECT COUNT(*)::bigint AS total_count')
    expect(countSql).toContain('FROM "tenant""schema"."cohort_variant_summary" cvs')
    expect(dataSql).toContain('(cvs.chr = $')
    expect(dataSql).toContain('cvs.pos <= $')
    expect(dataSql).toContain('COALESCE(cvs.end_pos, cvs.pos) >= $')
    expect(dataSql).toContain('cvs.gene_symbol = $')
    expect(dataSql).toContain('cvs.consequence IN ($')
    expect(dataSql).toContain('cvs.clinvar IN ($')
    expect(dataSql).toContain('(cvs.gnomad_af IS NULL OR cvs.gnomad_af <= $')
    expect(dataSql).toContain('(cvs.cadd IS NULL OR cvs.cadd >= $')
    expect(dataSql).toContain('cvs.carrier_count >= $')
    expect(dataSql).toContain('ILIKE $')
    expect(dataSql).not.toContain('DROP TABLE')
    expect(dataSql).not.toContain('OR TRUE')
    expect(countSql).not.toContain('DROP TABLE')
    expect(countParams).toEqual([
      `%TP53%' OR TRUE --%`,
      `%TP53%' OR TRUE --%`,
      `%TP53%' OR TRUE --%`,
      '1',
      200,
      100,
      `BRCA1'; DROP TABLE variants; --`,
      'HIGH',
      'MODERATE',
      'Pathogenic',
      0.01,
      20,
      2
    ])
    expect(dataParams).toEqual([...countParams, 10, 0])
  })

  it('resolves active panels to padded genomic intervals across the cohort', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ chr: '1' }] })
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const resolveIntervals = vi.fn().mockResolvedValue([{ chr: '1', start: 100, end: 200 }])
    const repository = new PostgresCohortRepository({ query } as never, 'public', resolveIntervals)

    await repository.queryVariants({
      active_panel_ids: [3, 4],
      panel_padding_bp: 7500,
      genome_build: 'GRCh37',
      limit: 10,
      offset: 0
    })

    const dataSql = normalizeSql(callText(query.mock.calls[3]))
    const dataParams = callParams(query.mock.calls[3])

    expect(resolveIntervals).toHaveBeenCalledWith([3, 4], 'GRCh37', 7500, false)
    expect(dataSql).toContain('(cvs.chr = $')
    expect(dataSql).toContain('cvs.pos <= $')
    expect(dataSql).toContain('COALESCE(cvs.end_pos, cvs.pos) >= $')
    expect(dataSql).not.toContain('panel_genes')
    expect(dataSql).not.toContain('case_active_panels')
    expect(dataParams).toEqual(['1', 200, 100, 'GRCh37', 10, 0])
  })

  it('propagates the error instead of silently running unfiltered when panel interval resolution fails', async () => {
    // Clinical-safety guarantee: a panel IS active (active_panel_ids is
    // non-empty) but the interval computation itself throws. The cohort
    // query must reject (surface the failure) rather than silently fall
    // back to an unfiltered result set — see PostgresCohortRepository's
    // resolvePanelParams for the contract this mirrors from panelIntervalHelper.ts.
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ chr: '1' }] })
    const resolveIntervals = vi
      .fn()
      .mockRejectedValue(new Error('Simulated panel interval computation failure'))
    const repository = new PostgresCohortRepository({ query } as never, 'public', resolveIntervals)

    await expect(
      repository.queryVariants({
        active_panel_ids: [3, 4],
        panel_padding_bp: 7500,
        genome_build: 'GRCh37',
        limit: 10,
        offset: 0
      })
    ).rejects.toThrow('Simulated panel interval computation failure')
  })

  it('resolves active panels from PostgreSQL panel genes through gene reference coordinates', async () => {
    geneReferenceMocks.getCoordinatesForGenes.mockReturnValue(
      new Map([
        [
          'HGNC:1100',
          {
            hgncId: 'HGNC:1100',
            assembly: 'GRCh38',
            chromosome: '1',
            start_pos: 1000,
            end_pos: 2000,
            strand: '+'
          }
        ]
      ])
    )
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ chr: 'chr1' }] })
      .mockResolvedValueOnce({ rows: [{ hgnc_id: 'HGNC:1100' }] })
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      active_panel_ids: [3],
      limit: 10,
      offset: 0
    })

    const panelSql = normalizeSql(callText(query.mock.calls[1]))
    const panelParams = callParams(query.mock.calls[1])
    const dataSql = normalizeSql(callText(query.mock.calls[4]))
    const dataParams = callParams(query.mock.calls[4])

    expect(panelSql).toContain('FROM "public"."panel_genes"')
    expect(panelParams).toEqual([[3]])
    expect(geneReferenceMocks.getCoordinatesForGenes).toHaveBeenCalledWith(['HGNC:1100'], 'GRCh38')
    expect(dataSql).toContain('(cvs.chr = $')
    expect(dataSql).not.toContain('panel_genes')
    expect(dataSql).not.toContain('case_active_panels')
    expect(dataParams).toEqual(['chr1', 7000, 1, 10, 0])
  })

  it('uses resolved panel intervals instead of active panel IDs when both are present', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const resolveIntervals = vi.fn()
    const repository = new PostgresCohortRepository({ query } as never, 'public', resolveIntervals)

    await repository.queryVariants({
      active_panel_ids: [3],
      panel_intervals: [{ chr: '1', start: 100, end: 200 }],
      limit: 10,
      offset: 0
    })

    const dataSql = normalizeSql(callText(query.mock.calls[2]))
    const dataParams = callParams(query.mock.calls[2])

    expect(resolveIntervals).not.toHaveBeenCalled()
    expect(dataSql).toContain('(cvs.chr = $')
    expect(dataSql).toContain('cvs.pos <= $')
    expect(dataSql).toContain('COALESCE(cvs.end_pos, cvs.pos) >= $')
    expect(dataSql).not.toContain('panel_genes')
    expect(dataSql).not.toContain('case_active_panels')
    expect(dataParams).toEqual(['1', 200, 100, 10, 0])
  })

  it('supports whitelisted parameterized cohort column filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      column_filters: {
        gene_symbol: { operator: 'like', value: `BRCA%' OR TRUE --` },
        carrier_count: { operator: '>=', value: 2 },
        cohort_frequency: { operator: '<=', value: 0.5 },
        cadd_phred: { operator: '>', value: 20 },
        gnomad_af: { operator: '<=', value: 0.01, includeEmpty: false },
        clinvar: { operator: 'in', value: ['Pathogenic', 'Likely pathogenic'] }
      }
    })

    const dataSql = normalizeSql(callText(query.mock.calls[2]))
    const dataParams = callParams(query.mock.calls[2])

    expect(dataSql).toContain('cvs.gene_symbol ILIKE $')
    // Aggregate columns are stored columns on the summary table — plain
    // comparisons, no COUNT(DISTINCT)/HAVING.
    expect(dataSql).toContain('cvs.carrier_count >= $')
    expect(dataSql).toContain('(cvs.carrier_count::double precision / NULLIF(bt.total, 0)) <= $')
    expect(dataSql).not.toContain('cvs.cohort_frequency')
    expect(dataSql).toContain('cvs.cadd > $')
    expect(dataSql).toContain('cvs.gnomad_af <= $')
    expect(dataSql).toContain('cvs.clinvar IN ($')
    expect(dataSql).not.toContain('COUNT(DISTINCT')
    expect(dataSql).not.toContain('OR TRUE')
    expect(dataParams).toEqual([
      `%BRCA%' OR TRUE --%`,
      2,
      0.5,
      20,
      0.01,
      'Pathogenic',
      'Likely pathogenic',
      50,
      0
    ])
  })

  it('throws for unsupported cohort column filter keys before querying', async () => {
    const query = vi.fn()
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await expect(
      repository.queryVariants({
        column_filters: {
          'sv.support': { operator: '>', value: 5 },
          unknown: { operator: '=', value: 'x' }
        }
      })
    ).rejects.toThrow('Unsupported PostgreSQL cohort column filter(s): unknown')
    expect(query).not.toHaveBeenCalled()
  })

  it('supports dotted extension cohort column filters with extension joins', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      column_filters: {
        'sv.support': { operator: '>', value: 5 },
        'cnv.copy_number': { operator: '>=', value: 3, includeEmpty: false },
        'str.repeat_id': { operator: 'like', value: 'HTT' }
      }
    })

    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    const dataParams = query.mock.calls[2][1] as unknown[]

    expect(dataSql).toContain('JOIN "public"."variant_sv" sv ON sv.variant_id = ext_v.id')
    expect(dataSql).toContain('JOIN "public"."variant_cnv" cnv ON cnv.variant_id = ext_v.id')
    expect(dataSql).toContain(
      'JOIN "public"."variant_str" str_ext ON str_ext.variant_id = ext_v.id'
    )
    expect(dataSql).toContain('ext_v.chr = v.chr')
    expect(dataSql).toContain('sv.support > $')
    expect(dataSql).toContain('cnv.copy_number >= $')
    expect(dataSql).toContain('str_ext.repeat_id ILIKE $')
    expect(dataParams).toEqual([3, '%HTT%', 5, 50, 0])
  })

  it('combines same-extension cohort column filters in one exists predicate', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      column_filters: {
        'cnv.copy_number': { operator: '>=', value: 3 },
        'cnv.copy_number_quality': { operator: '>=', value: 20 }
      }
    })

    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    expect(dataSql.match(/JOIN "public"."variant_cnv" cnv/g)).toHaveLength(1)
    expect(dataSql).toContain('cnv.copy_number >= $')
    expect(dataSql).toContain('cnv.copy_number_quality >= $')
  })

  it('skips blank cohort column like filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      column_filters: {
        gene_symbol: { operator: 'like', value: '   ' },
        'str.repeat_id': { operator: 'like', value: '' }
      }
    })

    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    expect(dataSql).not.toContain('ILIKE')
    expect(dataSql).not.toContain('variant_str')
    expect(query.mock.calls[2][1]).toEqual([50, 0])
  })

  it('uses genome-build scoped total cases for cohort frequency filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '6' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({ genome_build: 'GRCh38', max_internal_af: 0.5 })

    expect(normalizeSql(query.mock.calls[0][0] as string)).toContain('WHERE genome_build = $1')
    expect(query.mock.calls[0][1]).toEqual(['GRCh38'])
    const dataSql = normalizeSql(callText(query.mock.calls[2]))
    // cohort_frequency is carriers over the visible cases of the row's build.
    expect(dataSql).toContain('cvs.genome_build = $')
    expect(dataSql).toContain('(cvs.carrier_count::double precision / NULLIF(bt.total, 0)) <= $')
    expect(dataSql).toContain('FROM "public"."cases" GROUP BY genome_build')
  })

  it('reads C5a-maintained annotation flags from the summary table', async () => {
    // C4: annotation filters read the stored cvs.has_star / has_comment /
    // acmg_best columns (kept current by C5a) — no live annotation joins.
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      starred_only: true,
      has_comment: true,
      acmg_classifications: ['Pathogenic']
    })

    const dataSql = normalizeSql(callText(query.mock.calls[2]))
    expect(dataSql).toContain('cvs.has_star = true')
    expect(dataSql).toContain('cvs.has_comment = true')
    expect(dataSql).toContain('cvs.acmg_best IN ($')
    expect(dataSql).not.toContain('case_variant_annotations')
    expect(dataSql).not.toContain('variant_annotations')
  })

  it("treats variant_type 'snv' as snv plus indel", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({ variant_type: 'snv' })

    const dataSql = normalizeSql(callText(query.mock.calls[2]))
    expect(dataSql).toContain("cvs.variant_type IN ('snv', 'indel')")
    expect(callParams(query.mock.calls[2])).toEqual([50, 0])
  })

  it('maps cohort summary statistics and ACMG counts from numeric strings', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          total_cases: '3',
          total_variants: '9',
          unique_variants: '5',
          avg_variants_per_case: '3',
          genes_with_variants: '4',
          starred_variants: '2',
          pathogenic: '1',
          likely_pathogenic: '2',
          vus: '3',
          likely_benign: '4',
          benign: '5'
        }
      ]
    })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await expect(repository.getSummary()).resolves.toEqual({
      total_cases: 3,
      total_variants: 9,
      unique_variants: 5,
      avg_variants_per_case: 3,
      genes_with_variants: 4,
      starred_variants: 2,
      acmg_counts: {
        pathogenic: 1,
        likely_pathogenic: 2,
        vus: 3,
        likely_benign: 4,
        benign: 5
      }
    })

    // The variant tiles read maintained aggregates (after the freshness
    // probe) and never scan the variants.
    const sql = normalizeSql(query.mock.calls[1][0] as string)
    expect(sql).toContain(
      '(SELECT COALESCE(SUM(variant_count), 0)::bigint FROM "public"."cases") AS total_variants'
    )
    expect(sql).toContain(
      'FROM "public"."cohort_variant_summary" GROUP BY chr, pos, ref, alt ) unique_coordinates) AS unique_variants'
    )
    expect(sql).toContain(
      '(SELECT COUNT(*)::bigint FROM "public"."cohort_gene_summary") AS genes_with_variants'
    )
    expect(sql).not.toContain('"variants"')
  })

  it('maps carriers with numeric case IDs and preserves gq and dp when present', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { case_id: '7', case_name: 'Case B', gt_num: '0/1', gq: '99.5', dp: '42' },
        { case_id: 8, case_name: 'Case C', gt_num: '1/1', gq: null, dp: null }
      ]
    })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    const carriers = await repository.getCarriers('1', 123, 'A', 'G')

    expect(query.mock.calls[0][1]).toEqual(['1', 123, 'A', 'G'])
    expect(carriers).toEqual([
      { case_id: 7, case_name: 'Case B', gt_num: '0/1', gq: 99.5, dp: 42 },
      { case_id: 8, case_name: 'Case C', gt_num: '1/1', gq: null, dp: null }
    ])
  })

  it('maps gene burden rows to shared GeneBurden fields', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          gene_symbol: 'BRCA1',
          variant_count: '4',
          unique_variant_count: '3',
          affected_case_count: '2',
          total_cases: '10'
        }
      ]
    })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await expect(repository.getGeneBurden()).resolves.toEqual([
      {
        gene_symbol: 'BRCA1',
        variant_count: 4,
        unique_variant_count: 3,
        affected_case_count: 2,
        total_cases: 10
      }
    ])
    // Served from the maintained per-gene table (after the freshness probe),
    // never from a scan of the variants; the empty symbol is not a gene.
    const sql = normalizeSql(query.mock.calls[1][0] as string)
    expect(sql).toContain('FROM "public"."cohort_gene_summary" g WHERE g.gene_symbol <> \'\'')
    expect(sql).not.toContain('"variants"')
  })

  it('returns usable cohort column metadata', async () => {
    const keys = [
      'chr',
      'pos',
      'gene_symbol',
      'carrier_count',
      'cohort_frequency',
      'het_count',
      'hom_count',
      'consequence',
      'func',
      'clinvar',
      'gnomad_af',
      'cadd_phred',
      'transcript'
    ]
    // The probe proves `pos` and `transcript` high-cardinality; the rest are
    // counted exactly, where `gene_symbol` turns out to be above the limit too.
    const probeRow = Object.fromEntries(
      keys.map((key) => [`cnt_${key}`, key === 'pos' || key === 'transcript' ? 900 : 2])
    )
    const bounds = Object.fromEntries(
      [
        'pos',
        'carrier_count',
        'cohort_frequency',
        'het_count',
        'hom_count',
        'gnomad_af',
        'cadd_phred'
      ].flatMap((key) => [
        [`min_${key}`, '1'],
        [`max_${key}`, '10']
      ])
    )
    const exactRows = (geneCount: number): { rows: unknown[] } => ({
      rows: [
        { col_key: '', cnt: 0, vals: null, ...bounds },
        ...keys
          .filter((key) => key !== 'pos' && key !== 'transcript')
          .map((key) =>
            key === 'gene_symbol'
              ? { col_key: key, cnt: geneCount, vals: geneCount > 50 ? null : ['TP53', 'BRCA1'] }
              : { col_key: key, cnt: 2, vals: ['b', 'a'] }
          )
      ]
    })
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ version: 'v1' }] })
      .mockResolvedValueOnce({ rows: [probeRow] })
      .mockResolvedValueOnce(exactRows(73))
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    const meta = await repository.getColumnMeta()

    expect(meta.map((entry) => entry.key)).toEqual(keys)
    const byKey = new Map(meta.map((entry) => [entry.key, entry]))
    // Exact while small, with the sorted values for dropdowns.
    expect(byKey.get('chr')).toEqual({
      key: 'chr',
      dataType: 'text',
      distinctCount: 2,
      distinctValues: ['a', 'b']
    })
    expect(byKey.get('consequence')?.distinctValues).toEqual(['a', 'b'])
    // Above the limit: "more than 50", no value list — whether the probe or
    // the exact count found out.
    expect(byKey.get('pos')?.distinctCount).toBe(51)
    expect(byKey.get('transcript')).toEqual({
      key: 'transcript',
      dataType: 'text',
      distinctCount: 51
    })
    expect(byKey.get('gene_symbol')).toEqual({
      key: 'gene_symbol',
      dataType: 'text',
      distinctCount: 51
    })
    // Slider bounds stay exact for every numeric column, probed out or not.
    expect(byKey.get('pos')).toMatchObject({ dataType: 'numeric', min: 1, max: 10 })
    expect(byKey.get('cohort_frequency')).toMatchObject({ dataType: 'numeric', min: 1, max: 10 })

    // One cheap version probe, a bounded prefix probe, one scan of the summary.
    expect(query).toHaveBeenCalledTimes(3)
    expect(normalizeSql(callText(query.mock.calls[0]))).toContain('"cohort_summary_state"')
    const probeSql = normalizeSql(callText(query.mock.calls[1]))
    expect(probeSql).toContain('FROM "public"."cohort_variant_summary"')
    expect(probeSql).toContain('LIMIT 20000')
    const exactSql = normalizeSql(callText(query.mock.calls[2]))
    expect(exactSql).toContain('FROM "public"."cohort_variant_summary"')
    expect(exactSql).toContain('GROUPING SETS ((), (k_chr), (k_gene_symbol)')
    // High-cardinality columns are not grouped, and nothing is sorted per column.
    const groupingSets = /GROUPING SETS \((.*?)\) \)/.exec(exactSql)?.[1] ?? exactSql
    expect(groupingSets).not.toContain('k_pos')
    expect(groupingSets).not.toContain('k_transcript')
    expect(exactSql).not.toContain('COUNT(DISTINCT')
    expect(exactSql).toContain('MIN(k_pos)')

    // Unchanged summary: the cached metadata is served after the probe alone.
    query.mockResolvedValueOnce({ rows: [{ version: 'v1' }] })
    expect(await repository.getColumnMeta()).toBe(meta)
    expect(query).toHaveBeenCalledTimes(4)

    // An import or deletion moved the summary on: the metadata is recomputed.
    query
      .mockResolvedValueOnce({ rows: [{ version: 'v2' }] })
      .mockResolvedValueOnce({ rows: [probeRow] })
      .mockResolvedValueOnce(exactRows(2))
    const refreshed = await repository.getColumnMeta()
    expect(refreshed.find((entry) => entry.key === 'gene_symbol')).toMatchObject({
      distinctCount: 2,
      distinctValues: ['BRCA1', 'TP53']
    })
    expect(query).toHaveBeenCalledTimes(7)
  })

  it('streams cohort rows through pg-query-stream and releases the client', async () => {
    const release = vi.fn()
    const query = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield { chr: '2', pos: '456', ref: 'C', alt: 'T', carrier_count: '1' }
      }
    }))
    const poolQuery = vi.fn().mockResolvedValue({ rows: [{ total_cases: '2' }] })
    const connect = vi.fn(async () => ({ query, release }))
    const repository = new PostgresCohortRepository(
      { query: poolQuery, connect } as never,
      'public'
    )

    const rows = []
    for await (const row of repository.streamCohortRows({ gene_symbol: 'MYH7' })) {
      rows.push(row)
    }

    expect(connect).toHaveBeenCalledTimes(1)
    expect(poolQuery).toHaveBeenCalledWith(
      'SELECT COUNT(*)::bigint AS total_cases FROM "public"."cases"'
    )
    const streamArg = query.mock.calls[0][0] as { cursor?: { text?: string; values?: unknown[] } }
    expect(streamArg.cursor?.text).toContain('FROM "public"."variants" v')
    expect(streamArg.cursor?.text).toContain('GROUP BY v.chr, v.pos, v.ref, v.alt')
    expect(streamArg.cursor?.text).not.toContain('LIMIT')
    expect(streamArg.cursor?.text).not.toContain('OFFSET')
    expect(streamArg.cursor?.values).toEqual(['MYH7'])
    expect(rows).toEqual([{ chr: '2', pos: '456', ref: 'C', alt: 'T', carrier_count: '1' }])
    expect(release).toHaveBeenCalledTimes(1)
  })
})
