/**
 * The shortlist rule evaluator (`src/shared/dsl/evaluate.ts`) against the
 * SQLite filter path (spec §3.1): for every translator-accepted expression the
 * matched IDs are equal once the filter bar's `includeEmpty` is switched off;
 * the one documented difference (numeric ranges keep empty values in the
 * filter bar) is asserted explicitly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createRepositories } from '../../../src/main/database/createRepositories'
import { VariantFilterBuilder } from '../../../src/main/database/VariantFilterBuilder'
import { parseDsl } from '../../../src/shared/dsl/parser'
import { compileRule } from '../../../src/shared/dsl/evaluate'
import { translateAst } from '../../../src/renderer/src/dsl/translator'
import { annotationSeverityRanks } from '../../../src/shared/config/severity.config'
import type { ColumnFiltersParam } from '../../../src/shared/types/column-filters'

const CASE_ID = 1
const CADD = [5, 10, 15, 20, 25, 35, null]
const AF = [0, 1e-5, 1e-3, 0.02, null]
const CLINVAR = ['Pathogenic', 'pathogenic', 'Pathogenic|drug_response', 'Benign', null, '']
const IMPACT = ['HIGH', 'MODERATE', 'LOW', 'MODIFIER', null]
const FUNC = ['missense_variant', 'Missense_variant', 'stop_gained', null, '']
const GENES = ['XA_BX', 'XAZBX', 'A%B', 'BTK', null, '']
const MOI = ['AD, AR', 'AR', 'XR', null]
const INFO = [
  JSON.stringify({ REVEL: '0.8', TAG: 'x' }),
  JSON.stringify({ REVEL: '0.5', TAG: 'y' }),
  JSON.stringify({ REVEL: '.', TAG: '' }),
  JSON.stringify({ REVEL: 'abc' }),
  null
]
const ROWS = 36

const EXPRESSIONS = [
  'cadd:>=:20',
  'cadd:<:15',
  'cadd:=:20',
  'cadd:!=:20',
  'gnomad_af:<:0.001',
  'gnomad_af:<=:0',
  'clinvar:=:Pathogenic',
  'clinvar:!=:Benign',
  'clinvar:~:path',
  '(clinvar:=:Pathogenic OR clinvar:=:Benign)',
  'consequence:=:HIGH',
  'consequence:!=:LOW',
  'func:=:missense_variant',
  'func:!=:missense_variant',
  'func:~:MISSENSE',
  '(func:=:stop_gained OR func:=:missense_variant)',
  'gene_symbol:~:a_b',
  'gene_symbol:~:"a%"',
  'gene_symbol:=:BTK',
  'moi:~:ar',
  'info.REVEL:>=:0.7',
  'info.REVEL:~:0.',
  'info.TAG:=:x',
  'info.TAG:!=:x',
  'info.REVEL:is:null',
  'gnomad_af:is:null',
  'gene_symbol:is:notnull',
  'clinvar:is:null',
  'cadd:>=:20 AND gnomad_af:<:0.001'
]

describe('DSL evaluator ↔ SQLite filter parity', () => {
  let db: DatabaseType
  let filterBuilder: VariantFilterBuilder

  beforeAll(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const { kysely } = createRepositories(db)
    filterBuilder = new VariantFilterBuilder(db, kysely)
    db.prepare(
      `INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at)
       VALUES (?, 'parity', '/test/parity.json', 1, 0, ?)`
    ).run(CASE_ID, Date.now())
    const insert = db.prepare(
      `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol,
         consequence, func, cadd, gnomad_af, clinvar, moi, info_json, impact_rank, clinvar_rank)
       VALUES (?, ?, 'snv', '1', ?, 'A', 'G', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const pick = <T>(list: readonly T[], i: number, step: number): T =>
      list[Math.floor(i / step) % list.length]
    for (let i = 0; i < ROWS; i++) {
      const consequence = pick(IMPACT, i, 1)
      const clinvar = pick(CLINVAR, i, 1)
      const ranks = annotationSeverityRanks({ consequence, clinvar })
      insert.run(
        i + 1,
        CASE_ID,
        1000 + i,
        pick(GENES, i, 1),
        consequence,
        pick(FUNC, i, 2),
        pick(CADD, i, 1),
        pick(AF, i, 2),
        clinvar,
        pick(MOI, i, 3),
        pick(INFO, i, 1),
        ranks.impact_rank,
        ranks.clinvar_rank
      )
    }
  })

  afterAll(() => db.close())

  function translate(expr: string, includeEmpty: boolean): ColumnFiltersParam {
    const parsed = parseDsl(expr, 'case')
    expect(parsed.errors).toEqual([])
    const translated = translateAst(parsed.ast!)
    expect(translated.errors).toEqual([])
    const filters: ColumnFiltersParam = {}
    for (const [column, filter] of Object.entries(translated.columnFilters)) {
      filters[column] = filter.includeEmpty === undefined ? filter : { ...filter, includeEmpty }
    }
    return filters
  }

  function sqlIds(columnFilters: ColumnFiltersParam): number[] {
    const compiled = filterBuilder
      .build({ case_id: CASE_ID, column_filters: columnFilters })
      .compile()
    const rows = db.prepare(compiled.sql).all(...compiled.parameters) as Array<{ id: number }>
    return rows.map((r) => r.id).sort((a, b) => a - b)
  }

  function evaluatorIds(expr: string): number[] {
    const compiled = compileRule(expr)
    if (!compiled.ok) throw new Error(compiled.errors.join('; '))
    const rows = db.prepare('SELECT * FROM variants WHERE case_id = ?').all(CASE_ID) as Array<
      Record<string, unknown> & { id: number }
    >
    return rows
      .filter((row) => compiled.predicate(row))
      .map((r) => r.id)
      .sort((a, b) => a - b)
  }

  it.each(EXPRESSIONS)('%s matches the same rows (includeEmpty=false)', (expr) => {
    const expected = sqlIds(translate(expr, false))
    expect(evaluatorIds(expr)).toEqual(expected)
  })

  it('the fixture exercises both outcomes for every expression', () => {
    for (const expr of EXPRESSIONS) {
      const n = evaluatorIds(expr).length
      expect(n, expr).toBeGreaterThan(0)
      expect(n, expr).toBeLessThan(ROWS)
    }
  })

  it('documented difference: the filter bar keeps empty values in numeric ranges', () => {
    const nullCadd = (
      db.prepare('SELECT id FROM variants WHERE cadd IS NULL').all() as Array<{ id: number }>
    ).map((r) => r.id)
    expect(nullCadd.length).toBeGreaterThan(0)
    const bar = sqlIds(translate('cadd:>=:20', true))
    const rule = evaluatorIds('cadd:>=:20')
    for (const id of nullCadd) {
      expect(bar).toContain(id)
      expect(rule).not.toContain(id)
    }
  })
})
