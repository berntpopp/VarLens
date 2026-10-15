import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { CohortService } from '../../../src/main/database/cohort'
import { CohortSummaryService } from '../../../src/main/database/CohortSummaryService'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { buildSummaryQueryParts } from '../../../src/main/storage/postgres/postgres-cohort-summary-query'
import { getAutocompleteSuggestions } from '../../../src/renderer/src/dsl/autocomplete'
import { cohortInfoExistsClauses } from '../../../src/shared/sql/cohort-info-filter-sql'
import { mergeCohortInfoFields } from '../../../src/shared/utils/case-info-fields'

describe('mergeCohortInfoFields (#639)', () => {
  it('unions keys across cases, merges compatible types, and marks conflicting types as String', () => {
    const dict1 = JSON.stringify({
      DP: { source: 'INFO:DP', type: 'Integer', number: '1' },
      REVEL: { source: 'CSQ:REVEL', type: 'Integer', number: '1' },
      CONFLICT: { source: 'INFO:CONFLICT', type: 'Flag', number: '0' }
    })
    const dict2 = JSON.stringify({
      DP: { source: 'INFO:DP', type: 'Integer', number: '1' },
      REVEL: { source: 'CSQ:REVEL', type: 'Float', number: '1' },
      CONFLICT: { source: 'INFO:CONFLICT', type: 'Integer', number: '1' },
      ONLY_CASE_2: { source: 'INFO:ONLY_CASE_2', type: 'String', number: '1' }
    })

    const merged = mergeCohortInfoFields([dict1, dict2])
    expect(merged).toEqual([
      {
        key: 'CONFLICT',
        source: 'INFO:CONFLICT',
        type: 'String'
      },
      {
        key: 'DP',
        source: 'INFO:DP',
        type: 'Integer',
        number: '1'
      },
      {
        key: 'ONLY_CASE_2',
        source: 'INFO:ONLY_CASE_2 · in 1 of 2 cases',
        type: 'String',
        number: '1'
      },
      {
        key: 'REVEL',
        source: 'CSQ:REVEL',
        type: 'Float',
        number: '1'
      }
    ])
  })

  it('appends partial case coverage in autocomplete suggestions for cohort scope', () => {
    const fields = mergeCohortInfoFields([
      JSON.stringify({ REVEL: { source: 'CSQ:REVEL', type: 'Float', number: '1' } }),
      JSON.stringify({ DP: { source: 'INFO:DP', type: 'Integer', number: '1' } }),
      null
    ])
    const suggestions = getAutocompleteSuggestions('info.', [], 'cohort', fields)
    expect(suggestions.map((s) => ({ value: s.value, description: s.description }))).toEqual([
      { value: 'info.DP', description: 'INFO:DP · in 1 of 3 cases' },
      { value: 'info.REVEL', description: 'CSQ:REVEL · in 1 of 3 cases' }
    ])
  })
})

describe('cohortInfoExistsClauses (#639)', () => {
  it('emits correlated carrier EXISTS clauses for sqlite and postgres', () => {
    const sqliteParams: Array<string | number> = []
    const sqliteClauses = cohortInfoExistsClauses(
      {
        'info.DP': { operator: '>', value: 50 },
        'info.TAG': { operator: 'is_null', value: '' }
      },
      'cvs',
      'sqlite',
      (v) => {
        sqliteParams.push(v)
        return '?'
      }
    )
    expect(sqliteClauses).toHaveLength(2)
    expect(sqliteClauses[0]).toContain(
      "JOIN cases vc ON vc.id = v.case_id AND vc.import_status = 'ready'"
    )
    expect(sqliteClauses[0]).toContain('AND v.info_json IS NOT NULL')
    expect(sqliteClauses[1]).not.toContain('AND v.info_json IS NOT NULL')
    expect(sqliteParams).toContain(50)

    const pgParams: Array<string | number> = []
    const pgClauses = cohortInfoExistsClauses(
      {
        'info.DP': { operator: '>', value: 50 }
      },
      'cvs',
      'postgres',
      (v) => {
        pgParams.push(v)
        return `$${pgParams.length}`
      },
      '"tenant_a".'
    )
    expect(pgClauses).toHaveLength(1)
    expect(pgClauses[0]).toContain('FROM "tenant_a".variants v')
    expect(pgClauses[0]).toContain('JOIN "tenant_a".cases vc ON vc.id = v.case_id')
    expect(pgClauses[0]).toContain('AND v.info_json IS NOT NULL')
    expect(pgParams).toEqual(['DP', 50])
  })

  it('wires info.<KEY> into PostgreSQL buildSummaryQueryParts', () => {
    const built = buildSummaryQueryParts(
      {
        column_filters: {
          'info.DP': { operator: '>=', value: 30 }
        }
      },
      2,
      'cohort_schema'
    )
    expect(built.unavailable).toBe(false)
    expect(built.parts.whereParts.some((w) => w.includes('FROM "cohort_schema".variants v'))).toBe(
      true
    )
    expect(built.parts.values).toContain('DP')
    expect(built.parts.values).toContain(30)
  })
})

describe('SQLite CohortService info.<KEY> and acmg_best filtering (#639, #149)', () => {
  let db: Database.Database
  let cohortService: CohortService
  let summaryService: CohortSummaryService

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    cohortService = new CohortService(db)
    summaryService = new CohortSummaryService(db)
  })

  afterEach(() => {
    cohortService.close()
    db.close()
  })

  const insertCase = (name: string): number => {
    const result = db
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/${name}.vcf`, 100, 0, Date.now())
    return result.lastInsertRowid as number
  }

  const insertVariant = (
    caseId: number,
    pos: number,
    gene: string,
    infoJson: string | null,
    gtNum = '0/1'
  ): void => {
    db.prepare(
      `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, info_json)
       VALUES (?, '1', ?, 'A', 'G', ?, ?, ?)`
    ).run(caseId, pos, gene, gtNum, infoJson)
    db.prepare('UPDATE cases SET variant_count = variant_count + 1 WHERE id = ?').run(caseId)
  }

  it('filters multi-case cohort variants by carrier info.<KEY> with true numeric ordering', () => {
    const case1 = insertCase('Case1')
    const case2 = insertCase('Case2')

    // Variant at 100: Case 1 has DP="9" (lexicographically > "50", numerically < 50), Case 2 has DP="120"
    insertVariant(case1, 100, 'BRCA1', JSON.stringify({ DP: '9' }))
    insertVariant(case2, 100, 'BRCA1', JSON.stringify({ DP: '120' }))

    // Variant at 200: only DP="9" -> must NOT match info.DP > 50
    insertVariant(case1, 200, 'TP53', JSON.stringify({ DP: '9' }))

    // Variant at 300: non-carrier no-call row (./.) has DP="200", carrier has DP="10" -> must NOT match
    insertVariant(case1, 300, 'EGFR', JSON.stringify({ DP: '200' }), './.')
    insertVariant(case2, 300, 'EGFR', JSON.stringify({ DP: '10' }), '0/1')

    summaryService.rebuild()

    const highDp = cohortService.getCohortVariants({
      column_filters: {
        'info.DP': { operator: '>', value: 50 }
      }
    })
    expect(highDp.data.map((r) => r.pos)).toEqual([100])

    const missingTag = cohortService.getCohortVariants({
      column_filters: {
        'info.MISSING_KEY': { operator: 'is_null', value: '' }
      }
    })
    expect(missingTag.data.map((r) => r.pos).sort((a, b) => a - b)).toEqual([100, 200, 300])
  })

  it('filters cohort variants by acmg_best column filter (#149)', () => {
    const case1 = insertCase('Case1')
    insertVariant(case1, 100, 'BRCA1', null)
    insertVariant(case1, 200, 'TP53', null)

    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, genome_build, acmg_classification, created_at, updated_at)
       VALUES ('1', 100, 'A', 'G', 'GRCh38', 'Pathogenic', 1, 1)`
    ).run()

    summaryService.rebuild()

    const pathOnly = cohortService.getCohortVariants({
      column_filters: {
        acmg_best: { operator: '=', value: 'Pathogenic' }
      }
    })
    expect(pathOnly.data.map((r) => r.pos)).toEqual([100])

    const unclassified = cohortService.getCohortVariants({
      column_filters: {
        acmg_best: { operator: 'is_null', value: '' }
      }
    })
    expect(unclassified.data.map((r) => r.pos)).toEqual([200])
  })
})
