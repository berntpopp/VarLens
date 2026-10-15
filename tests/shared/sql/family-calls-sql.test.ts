// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import { buildPostgresVariantQueryParts } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import { attachFamilyCalls, familyCallsPageSql } from '../../../src/shared/sql/family-calls-sql'
import { attachCaseCompHetPhase, type CompHetCandidateRow } from '../../../src/shared/utils/phasing'
import {
  familyMemberColumns,
  roleLabel
} from '../../../src/renderer/src/components/variant-table/columns'

describe('familyCallsPageSql and attachFamilyCalls (#628)', () => {
  it('builds dialect-parameterized SQL for SQLite and PostgreSQL', () => {
    const sqliteSql = familyCallsPageSql('sqlite')
    expect(sqliteSql).toContain('agm.group_id = ?')
    expect(sqliteSql).toContain('WHERE p.case_id = ? AND p.id IN (SELECT value FROM json_each(?))')

    const pgSql = familyCallsPageSql('postgres', (t) => `"public"."${t}"`)
    expect(pgSql).toContain('FROM "public"."variants" p')
    expect(pgSql).toContain('JOIN "public"."analysis_group_members" agm')
    expect(pgSql).toContain('agm.group_id = $1')
    expect(pgSql).toContain('WHERE p.case_id = $2 AND p.id = ANY($3::bigint[])')
    expect(pgSql).toContain('COLLATE "C"')
  })

  it('attaches per-member family_calls onto page rows', () => {
    const rows: Array<{
      id: number
      family_calls?: Record<
        number,
        { role: string; gt_num: string | null; gq: number | null; dp: number | null }
      >
    }> = [{ id: 10 }, { id: 20 }]

    attachFamilyCalls(rows, [
      { variant_id: 10, member_case_id: 2, role: 'father', gt_num: '0/1', gq: '99', dp: '35' },
      { variant_id: 10, member_case_id: 3, role: 'mother', gt_num: null, gq: null, dp: null }
    ])

    expect(rows[0].family_calls).toEqual({
      2: { role: 'father', gt_num: '0/1', gq: 99, dp: 35 },
      3: { role: 'mother', gt_num: null, gq: null, dp: null }
    })
    expect(rows[1].family_calls).toEqual({})
  })

  it('populates family_calls in VariantRepository.getVariants when analysis_group_id is set', () => {
    const service = new DatabaseService(':memory:')
    try {
      const probandId = service.cases.createCase('Proband', '/p.vcf', 100)
      const fatherId = service.cases.createCase('Father', '/f.vcf', 100)
      const motherId = service.cases.createCase('Mother', '/m.vcf', 100)

      const group = service.analysisGroups.createGroup('Family 1', 'family')
      service.analysisGroups.addMember(group.id, probandId, 'proband', 'affected')
      service.analysisGroups.addMember(group.id, fatherId, 'father', 'unaffected')
      service.analysisGroups.addMember(group.id, motherId, 'mother', 'unaffected')

      const baseVariant = {
        chr: 'chr1',
        pos: 1000,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'BRCA1',
        omim_mim_number: null,
        consequence: 'HIGH',
        gnomad_af: 0.0001,
        cadd: 28,
        clinvar: null,
        gt_num: '0/1',
        func: 'missense_variant',
        qual: 99,
        hpo_sim_score: null,
        transcript: 'ENST0001',
        cdna: 'c.1A>G',
        aa_change: 'p.Lys1Glu',
        moi: null,
        gq: 99,
        dp: 40,
        ad_ref: 20,
        ad_alt: 20,
        ab: 0.5,
        filter: 'PASS',
        info_json: null,
        source_format: 'vcf'
      }

      service.variants.insertVariantsBatch(probandId, [baseVariant])
      service.variants.insertVariantsBatch(fatherId, [{ ...baseVariant, gq: 85, dp: 32 }])

      const result = service.variants.getVariants(
        { case_id: probandId, analysis_group_id: group.id },
        25,
        0
      )

      expect(result.data).toHaveLength(1)
      expect(result.data[0].family_calls).toEqual({
        [fatherId]: { role: 'father', gt_num: '0/1', gq: 85, dp: 32 },
        [motherId]: { role: 'mother', gt_num: null, gq: null, dp: null }
      })
    } finally {
      service.close()
    }
  })

  it('builds family member columns and role labels (#628)', () => {
    expect(roleLabel('father')).toBe('Father')
    expect(
      familyMemberColumns([
        { case_id: 2, role: 'father' },
        { case_id: 3, role: 'mother' }
      ])
    ).toEqual([
      { key: '_member_2', title: 'Father', align: 'center', sortable: false },
      { key: '_member_3', title: 'Mother', align: 'center', sortable: false }
    ])
  })

  it('attaches cis/trans/possible comphet_phase and gates phenotype join (#630, Perf 3)', () => {
    const rows: CompHetCandidateRow[] = [
      { chr: 'chr1', pos: 100, ref: 'A', alt: 'G', gene_symbol: 'G1', gt_num: '0|1', ps: 10 },
      { chr: 'chr1', pos: 200, ref: 'C', alt: 'T', gene_symbol: 'G1', gt_num: '0|1', ps: 10 },
      { chr: 'chr1', pos: 300, ref: 'G', alt: 'A', gene_symbol: 'G2', gt_num: '0/1', ps: null }
    ]
    attachCaseCompHetPhase(rows, rows)
    expect(rows[0].comphet_phase).toBe('cis')
    expect(rows[1].comphet_phase).toBe('cis')
    expect(rows[2].comphet_phase).toBeUndefined()

    const withoutPheno = buildPostgresVariantQueryParts({ case_id: 1 }, '"public"')
    expect(withoutPheno.fromAndWhereSql).not.toContain('case_phenotype_scores')

    const withPhenoSort = buildPostgresVariantQueryParts({ case_id: 1 }, '"public"', [
      { key: 'phenotype_score', order: 'desc' }
    ])
    expect(withPhenoSort.fromAndWhereSql).toContain('case_phenotype_scores')
  })
})
