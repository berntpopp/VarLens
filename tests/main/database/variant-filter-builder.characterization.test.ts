/**
 * Characterization tests for VariantFilterBuilder (issue #446).
 *
 * Pins the compiled SQL text and bound parameters for a broad matrix of
 * filters so structural refactors of `build()` can prove they are
 * byte-identical. Row-level semantics are covered by
 * `variant-filter-builder.test.ts`, `variants.test.ts`,
 * `inheritance-filters.test.ts` and `trio-inheritance.test.ts`; this file
 * only locks the emitted query.
 *
 * Do NOT update the snapshot to make a refactor pass — a diff here means the
 * generated SQL changed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { Kysely } from 'kysely'
import type { VarlensDatabase } from '../../../src/shared/types/database-schema'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createKysely } from '../../../src/main/database/kysely'
import {
  BASE_SORTABLE_COLUMNS,
  SORTABLE_COLUMNS,
  VariantFilterBuilder,
  resolveSortColumn
} from '../../../src/main/database/VariantFilterBuilder'
import { VariantSearchService } from '../../../src/main/database/VariantSearchService'
import type { SortItem, VariantFilter } from '../../../src/main/database/types'

type BuildOptions = { forceOrChain?: boolean; sortBy?: SortItem[] }
type PartialFilter = Omit<VariantFilter, 'case_id'>

interface Scenario {
  name: string
  filter: PartialFilter
  options?: BuildOptions
  /** When set, `applySort` is applied with these items (undefined = default order). */
  sort?: { sortBy?: SortItem[] }
}

function intervals(count: number): Array<{ chr: string; start: number; end: number }> {
  return Array.from({ length: count }, (_, i) => ({
    chr: String((i % 22) + 1),
    start: 1000 * (i + 1),
    end: 1000 * (i + 1) + 500
  }))
}

const SCOPES = ['case', 'all', undefined] as const

const CORE_SCENARIOS: Scenario[] = [
  { name: 'no filters', filter: {} },
  { name: 'gene_symbol', filter: { gene_symbol: 'BRCA' } },
  { name: 'gene_symbol empty string is ignored', filter: { gene_symbol: '' } },
  { name: 'consequence (legacy single)', filter: { consequence: 'HIGH' } },
  { name: 'consequence empty string is ignored', filter: { consequence: '' } },
  { name: 'consequences array', filter: { consequences: ['HIGH', 'MODERATE'] } },
  {
    name: 'consequences array wins over consequence',
    filter: { consequences: ['HIGH'], consequence: 'LOW' }
  },
  {
    name: 'empty consequences falls back to consequence',
    filter: { consequences: [], consequence: 'LOW' }
  },
  { name: 'funcs', filter: { funcs: ['missense_variant', 'stop_gained'] } },
  { name: 'funcs empty', filter: { funcs: [] } },
  { name: 'clinvars', filter: { clinvars: ['pathogenic'] } },
  { name: 'gnomad_af_max', filter: { gnomad_af_max: 0.01 } },
  { name: 'gnomad_af_max zero', filter: { gnomad_af_max: 0 } },
  { name: 'cadd_min', filter: { cadd_min: 20 } },
  { name: 'max_internal_af', filter: { max_internal_af: 0.05 } },
  { name: 'max_internal_af zero is ignored', filter: { max_internal_af: 0 } },
  { name: 'exact chr/pos/ref/alt', filter: { chr: '1', pos: 100000, ref: 'A', alt: 'T' } },
  { name: 'exact chr only', filter: { chr: 'X' } },
  { name: 'exact empty strings are ignored', filter: { chr: '', ref: '', alt: '', pos: 5 } },
  { name: 'tag_ids', filter: { tag_ids: [1, 2] } },
  { name: 'tag_ids empty', filter: { tag_ids: [] } },
  { name: 'search_query single term', filter: { search_query: 'BRCA1' } },
  { name: 'search_query boolean', filter: { search_query: 'BRCA1 AND NOT TP53' } },
  { name: 'search_query hgvs', filter: { search_query: 'c.123A>G' } },
  { name: 'search_query empty', filter: { search_query: '' } },
  { name: 'ipc-only keys are ignored', filter: { active_panel_ids: [1], panel_padding_bp: 10 } },
  { name: 'consider_phasing is ignored', filter: { consider_phasing: true } }
]

const VARIANT_TYPE_SCENARIOS: Scenario[] = ['', 'snv', 'indel', 'sv', 'cnv', 'str'].map(
  (variant_type) => ({
    name: `variant_type=${JSON.stringify(variant_type)}`,
    filter: { variant_type }
  })
)

const PANEL_SCENARIOS: Scenario[] = [
  { name: 'panel_intervals empty', filter: { panel_intervals: [] } },
  { name: 'panel_intervals 1', filter: { panel_intervals: intervals(1) } },
  { name: 'panel_intervals 49 (OR chain)', filter: { panel_intervals: intervals(49) } },
  { name: 'panel_intervals 50 (temp table)', filter: { panel_intervals: intervals(50) } },
  { name: 'panel_intervals 120 (temp table)', filter: { panel_intervals: intervals(120) } },
  {
    name: 'panel_intervals 50 forceOrChain',
    filter: { panel_intervals: intervals(50) },
    options: { forceOrChain: true }
  },
  {
    name: 'panel_intervals 3 forceOrChain=false',
    filter: { panel_intervals: intervals(3) },
    options: { forceOrChain: false }
  }
]

const ANNOTATION_SCENARIOS: Scenario[] = SCOPES.flatMap((annotation_scope) => {
  const label = `scope=${String(annotation_scope)}`
  return [
    { name: `starred_only ${label}`, filter: { starred_only: true, annotation_scope } },
    { name: `starred_only=false ${label}`, filter: { starred_only: false, annotation_scope } },
    { name: `has_comment ${label}`, filter: { has_comment: true, annotation_scope } },
    {
      name: `acmg_classifications ${label}`,
      filter: { acmg_classifications: ['Pathogenic', 'Likely pathogenic'], annotation_scope }
    },
    {
      name: `acmg_classifications empty ${label}`,
      filter: { acmg_classifications: [], annotation_scope }
    },
    {
      name: `starred + comment + acmg ${label}`,
      filter: {
        starred_only: true,
        has_comment: true,
        acmg_classifications: ['Benign'],
        annotation_scope
      }
    }
  ]
})

const COLUMN_FILTER_SCENARIOS: Scenario[] = [
  { name: 'column_filters empty object', filter: { column_filters: {} } },
  {
    name: 'column_filters in',
    filter: { column_filters: { consequence: { operator: 'in', value: ['HIGH', 'LOW'] } } }
  },
  {
    name: 'column_filters in numeric values are stringified',
    filter: { column_filters: { pos: { operator: 'in', value: [1, 2] } } }
  },
  {
    name: 'column_filters in empty is skipped',
    filter: { column_filters: { consequence: { operator: 'in', value: [] } } }
  },
  {
    name: 'column_filters like',
    filter: { column_filters: { gene_symbol: { operator: 'like', value: 'brc' } } }
  },
  {
    name: 'column_filters like blank is skipped',
    filter: { column_filters: { gene_symbol: { operator: 'like', value: '   ' } } }
  },
  {
    name: 'column_filters = numeric string',
    filter: { column_filters: { pos: { operator: '=', value: '100000' } } }
  },
  {
    name: 'column_filters = text',
    filter: { column_filters: { chr: { operator: '=', value: 'X' } } }
  },
  {
    name: 'column_filters != number',
    filter: { column_filters: { cadd: { operator: '!=', value: 20 } } }
  },
  ...(['<', '>', '<=', '>='] as const).flatMap((operator) => [
    {
      name: `column_filters ${operator} includeEmpty default`,
      filter: { column_filters: { gnomad_af: { operator, value: 0.01 } } }
    },
    {
      name: `column_filters ${operator} includeEmpty=false string value`,
      filter: { column_filters: { cadd: { operator, value: '15', includeEmpty: false } } }
    },
    {
      name: `column_filters ${operator} includeEmpty=true`,
      filter: { column_filters: { qual: { operator, value: 30, includeEmpty: true } } }
    }
  ]),
  {
    name: 'column_filters unknown bare key is ignored',
    filter: { column_filters: { not_a_column: { operator: '=', value: 1 } } }
  },
  {
    name: 'column_filters every base sortable column (=)',
    filter: {
      column_filters: Object.fromEntries(
        Object.keys(BASE_SORTABLE_COLUMNS).map((key) => [
          key,
          { operator: '=' as const, value: 'x' }
        ])
      )
    }
  },
  {
    name: 'column_filters mixed base operators',
    filter: {
      column_filters: {
        gene_symbol: { operator: 'like', value: 'TP' },
        consequence: { operator: 'in', value: ['HIGH'] },
        gnomad_af: { operator: '<=', value: 0.01 },
        cadd: { operator: '>=', value: 20, includeEmpty: false },
        pos: { operator: '!=', value: '5' }
      }
    }
  }
]

const EXTENSION_SCENARIOS: Scenario[] = [
  {
    name: 'ext filter cnv.copy_number (implicit narrowing)',
    filter: { column_filters: { 'cnv.copy_number': { operator: '>=', value: 3 } } }
  },
  {
    name: 'ext filter cnv.copy_number with variant_type=cnv',
    filter: {
      variant_type: 'cnv',
      column_filters: { 'cnv.copy_number': { operator: '>=', value: 3 } }
    }
  },
  {
    name: 'ext filter sv.support with variant_type=sv',
    filter: { variant_type: 'sv', column_filters: { 'sv.support': { operator: '>=', value: 10 } } }
  },
  {
    name: 'ext filter sv.support without variant_type',
    filter: { column_filters: { 'sv.support': { operator: '<', value: 10, includeEmpty: false } } }
  },
  {
    name: 'ext filter sv.support with variant_type=cnv (cross type)',
    filter: { variant_type: 'cnv', column_filters: { 'sv.support': { operator: '>', value: 1 } } }
  },
  {
    name: 'ext filter str.disease like',
    filter: { column_filters: { 'str.disease': { operator: 'like', value: 'hunt' } } }
  },
  {
    name: 'ext filter str.str_status in with variant_type=str (str + str_ext aliases)',
    filter: {
      variant_type: 'str',
      column_filters: {
        'str.str_status': { operator: 'in', value: ['full_mutation', 'premutation'] }
      }
    }
  },
  {
    name: 'ext filter cross-type sv + cnv + str',
    filter: {
      column_filters: {
        'sv.support': { operator: '>=', value: 5 },
        'cnv.copy_number': { operator: '=', value: 1 },
        'str.disease': { operator: 'like', value: 'x' }
      }
    }
  },
  {
    name: 'ext filter mixed with base column filter',
    filter: {
      column_filters: {
        'cnv.copy_number': { operator: '<=', value: 1 },
        gene_symbol: { operator: 'like', value: 'A' }
      }
    }
  },
  {
    name: 'ext filter unknown dotted key is ignored',
    filter: { column_filters: { 'cnv.nope': { operator: '=', value: 1 } } }
  },
  {
    name: 'ext sort cnv.copy_number',
    filter: {},
    options: { sortBy: [{ key: 'cnv.copy_number', order: 'desc' }] },
    sort: { sortBy: [{ key: 'cnv.copy_number', order: 'desc' }] }
  },
  {
    name: 'ext sort sv.support with variant_type=sv (no duplicate join)',
    filter: { variant_type: 'sv' },
    options: { sortBy: [{ key: 'sv.support', order: 'asc' }] },
    sort: { sortBy: [{ key: 'sv.support', order: 'asc' }] }
  },
  {
    name: 'ext sort + ext filter on same table',
    filter: { column_filters: { 'sv.support': { operator: '>=', value: 2 } } },
    options: { sortBy: [{ key: 'sv.vaf', order: 'asc' }] },
    sort: { sortBy: [{ key: 'sv.vaf', order: 'asc' }] }
  },
  {
    name: 'ext sort str key with variant_type=str',
    filter: { variant_type: 'str' },
    options: { sortBy: [{ key: 'str.repeat_unit', order: 'asc' }] },
    sort: { sortBy: [{ key: 'str.repeat_unit', order: 'asc' }] }
  },
  {
    name: 'sortBy with base + unknown keys adds no join',
    filter: {},
    options: {
      sortBy: [
        { key: 'gnomad_af', order: 'asc' },
        { key: 'bogus', order: 'asc' }
      ]
    }
  }
]

const SOLO_MODES = ['homozygous', 'heterozygous', 'x_hemizygous', 'candidate_compound_het']
const TRIO_MODES = ['de_novo', 'autosomal_recessive', 'compound_het']

const INHERITANCE_SCENARIOS: Scenario[] = [
  { name: 'inheritance empty', filter: { inheritance_modes: [] } },
  ...SOLO_MODES.map((mode) => ({
    name: `inheritance solo ${mode}`,
    filter: { inheritance_modes: [mode] }
  })),
  ...TRIO_MODES.map((mode) => ({
    name: `inheritance trio ${mode} with group`,
    filter: { inheritance_modes: [mode], analysis_group_id: 7 }
  })),
  ...TRIO_MODES.map((mode) => ({
    name: `inheritance trio ${mode} without group (no-op)`,
    filter: { inheritance_modes: [mode] }
  })),
  { name: 'inheritance all solo', filter: { inheritance_modes: SOLO_MODES } },
  {
    name: 'inheritance all trio with group',
    filter: { inheritance_modes: TRIO_MODES, analysis_group_id: 7 }
  },
  {
    name: 'inheritance all modes with group (reverse input order)',
    filter: {
      inheritance_modes: [...SOLO_MODES, ...TRIO_MODES].reverse(),
      analysis_group_id: 7,
      consider_phasing: true
    }
  },
  {
    name: 'inheritance solo + trio without group',
    filter: { inheritance_modes: ['heterozygous', 'de_novo'] }
  },
  { name: 'inheritance unknown mode', filter: { inheritance_modes: ['upd'], analysis_group_id: 7 } }
]

const SORT_SCENARIOS: Scenario[] = [
  { name: 'sort default', filter: {}, sort: {} },
  { name: 'sort empty array', filter: {}, sort: { sortBy: [] } },
  ...Object.keys(BASE_SORTABLE_COLUMNS).flatMap((key) =>
    (['asc', 'desc'] as const).map((order) => ({
      name: `sort ${key} ${order}`,
      filter: {},
      sort: { sortBy: [{ key, order }] }
    }))
  ),
  {
    name: 'sort multi-key with invalid key dropped',
    filter: {},
    sort: {
      sortBy: [
        { key: 'gene_symbol', order: 'asc' },
        { key: 'drop table', order: 'desc' },
        { key: 'cadd', order: 'desc' }
      ]
    }
  }
]

const KITCHEN_SINK: Scenario[] = SCOPES.map((annotation_scope) => ({
  name: `kitchen sink scope=${String(annotation_scope)}`,
  filter: {
    variant_type: 'snv',
    gene_symbol: 'BR',
    consequences: ['HIGH'],
    consequence: 'LOW',
    funcs: ['stop_gained'],
    clinvars: ['pathogenic'],
    gnomad_af_max: 0.01,
    cadd_min: 10,
    max_internal_af: 0.2,
    search_query: 'BRCA1 OR TP53',
    chr: '1',
    pos: 100000,
    ref: 'A',
    alt: 'T',
    tag_ids: [3],
    panel_intervals: intervals(2),
    starred_only: true,
    has_comment: true,
    acmg_classifications: ['Pathogenic'],
    annotation_scope,
    column_filters: {
      gnomad_af: { operator: '<=', value: 0.5 },
      'sv.support': { operator: '>=', value: 1 }
    },
    inheritance_modes: ['heterozygous', 'compound_het'],
    analysis_group_id: 4
  },
  options: { sortBy: [{ key: 'cnv.copy_number', order: 'asc' }] },
  sort: {
    sortBy: [
      { key: 'cnv.copy_number', order: 'asc' },
      { key: 'pos', order: 'desc' }
    ]
  }
}))

const GROUPS: Array<[string, Scenario[]]> = [
  ['core filters', CORE_SCENARIOS],
  ['variant type joins', VARIANT_TYPE_SCENARIOS],
  ['panel intervals', PANEL_SCENARIOS],
  ['annotation scope filters', ANNOTATION_SCENARIOS],
  ['column filters', COLUMN_FILTER_SCENARIOS],
  ['extension filters and sorts', EXTENSION_SCENARIOS],
  ['inheritance modes', INHERITANCE_SCENARIOS],
  ['sort', SORT_SCENARIOS],
  ['combined', KITCHEN_SINK]
]

describe('VariantFilterBuilder characterization (compiled SQL + parameters)', () => {
  let db: DatabaseType
  let kysely: Kysely<VarlensDatabase>
  let builder: VariantFilterBuilder
  let caseId: number

  beforeAll(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    kysely = createKysely(db)
    builder = new VariantFilterBuilder(db, kysely, new VariantSearchService(db, kysely))
    for (const name of ['A', 'B', 'C']) {
      db.prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(name, `/test/${name}.vcf`, 1000, 0, 1)
    }
    caseId = 2
  })

  afterAll(() => {
    kysely.destroy()
    db.close()
  })

  function compileScenario(scenario: Scenario): {
    sql: string
    parameters: readonly unknown[]
    prepareError: string | null
  } {
    const filter: VariantFilter = { case_id: caseId, ...scenario.filter }
    const usesTempTable = builder.preparePanelIntervals(filter)
    try {
      let query = builder.build(filter, scenario.options)
      if (scenario.sort !== undefined) query = builder.applySort(query, scenario.sort.sortBy)
      const compiled = query.compile()
      // Pin whether the emitted SQL is accepted by SQLite against the real
      // schema. A few bare-key column filters (`chr`, `pos`) are currently
      // rejected as ambiguous because of the `vf` join; that pre-existing
      // behaviour is recorded here rather than fixed (see issue #446 report).
      let prepareError: string | null = null
      try {
        db.prepare(compiled.sql)
      } catch (error) {
        prepareError = error instanceof Error ? error.message : String(error)
      }
      return { sql: compiled.sql, parameters: compiled.parameters, prepareError }
    } finally {
      if (usesTempTable) builder.cleanupPanelIntervalsTable()
    }
  }

  for (const [group, scenarios] of GROUPS) {
    describe(group, () => {
      it.each(scenarios.map((s) => [s.name, s] as const))('%s', (_name, scenario) => {
        expect(compileScenario(scenario)).toMatchSnapshot()
      })
    })
  }

  it('build() with options undefined equals build() with empty options', () => {
    const filter: VariantFilter = { case_id: caseId, panel_intervals: intervals(3) }
    expect(builder.build(filter).compile().sql).toBe(builder.build(filter, {}).compile().sql)
  })

  it('skips FTS when no search service is injected', () => {
    const bare = new VariantFilterBuilder(db, kysely)
    const compiled = bare.build({ case_id: caseId, search_query: 'BRCA1' }).compile()
    expect({ sql: compiled.sql, parameters: compiled.parameters }).toMatchSnapshot()
  })

  it('max_internal_af is a no-op when the cases table is empty', () => {
    const emptyDb = new Database(':memory:')
    initializeSchema(emptyDb)
    runMigrations(emptyDb)
    const emptyKysely = createKysely(emptyDb)
    try {
      const compiled = new VariantFilterBuilder(emptyDb, emptyKysely)
        .build({ case_id: 1, max_internal_af: 0.05 })
        .compile()
      expect({ sql: compiled.sql, parameters: compiled.parameters }).toMatchSnapshot()
    } finally {
      emptyKysely.destroy()
      emptyDb.close()
    }
  })

  it('pins the public sort surface', () => {
    expect(SORTABLE_COLUMNS).toBe(BASE_SORTABLE_COLUMNS)
    expect(BASE_SORTABLE_COLUMNS).toMatchSnapshot()
    expect(
      [
        'pos',
        'gnomad_af',
        'sv.support',
        'cnv.copy_number',
        'str.repeat_unit',
        'cnv.nope',
        'bogus'
      ].map((key) => [key, resolveSortColumn(key)])
    ).toMatchSnapshot()
  })

  it('panel temp table lifecycle is unchanged', () => {
    const small: VariantFilter = { case_id: caseId, panel_intervals: intervals(49) }
    const large: VariantFilter = { case_id: caseId, panel_intervals: intervals(50) }
    expect(builder.preparePanelIntervals({ case_id: caseId })).toBe(false)
    expect(builder.preparePanelIntervals(small)).toBe(false)
    expect(builder.preparePanelIntervals(large)).toBe(true)
    expect(
      db.prepare('SELECT chr, start_pos, end_pos FROM _panel_intervals ORDER BY rowid').all()
    ).toMatchSnapshot()
    expect(
      db
        .prepare(
          "SELECT name, sql FROM sqlite_temp_master WHERE tbl_name = '_panel_intervals' ORDER BY name"
        )
        .all()
    ).toMatchSnapshot()
    // Re-preparing replaces rather than appends.
    builder.setupPanelIntervalsTable(intervals(2))
    expect(db.prepare('SELECT COUNT(*) AS n FROM _panel_intervals').get()).toEqual({ n: 2 })
    builder.cleanupPanelIntervalsTable()
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_temp_master WHERE tbl_name = '_panel_intervals'")
        .get()
    ).toEqual({ n: 0 })
  })
})
