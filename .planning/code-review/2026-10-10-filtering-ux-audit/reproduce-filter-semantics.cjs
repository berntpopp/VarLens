/* Read-only reproduction: exit 0 means the recorded current defects reproduced.
 * After a fix, the corresponding assertion should fail until this audit probe is retired.
 * Uses installed TypeScript/Vue and Node's in-memory SQLite; no app server or native addon.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const root = path.resolve(__dirname, '../../..')
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
require.extensions['.ts'] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions }).outputText, filename)
}
const load = (relative) => require(path.join(root, relative))
const { parseDsl } = load('src/renderer/src/dsl/parser.ts')
const { translateAst } = load('src/renderer/src/dsl/translator.ts')
const { assertValidColumnFilterValues } = load('src/shared/filters/column-filter-validation.ts')
const { buildBaseWhere } = load('src/main/database/variant-where-builder.ts')
const { buildSummaryQueryParts } = load('src/main/storage/postgres/postgres-cohort-summary-query.ts')
const { addPostgresColumnFilters } = load('src/main/storage/postgres/postgres-variant-column-filters.ts')
const evidence = []

function record(name, actual, observed, expectedBehavior) {
  assert.deepEqual(actual, observed, `${name}: current behavior changed; recheck this audit finding`)
  evidence.push({ name, reproduced: true, actual, expectedBehavior })
}
function translate(input) {
  const parsed = parseDsl(input)
  assert.equal(parsed.errors.length, 0, `Unexpected parser error for ${input}`)
  assert.ok(parsed.ast)
  return translateAst(parsed.ast)
}
function postgresCase(filters) {
  const result = { where: [], values: [] }
  try {
    addPostgresColumnFilters(
      { column_filters: filters },
      (value) => { result.values.push(value); return '$' + result.values.length },
      (sql) => result.where.push(sql),
      { clinvar: 'v.clinvar_rank', impact: 'v.impact_rank' }
    )
  } catch (error) {
    result.error = error.message
  }
  return result
}

record('same-column AND drops first bound', translate('cadd:>=:20 AND cadd:<=:30').columnFilters,
  { cadd: { operator: '<=', value: 30, includeEmpty: true } },
  'Both bounds must apply, or the expression must be rejected before application.')
record('same-column OR discards comparison operators', translate('cadd:<:10 OR cadd:>:20').columnFilters,
  { cadd: { operator: 'in', value: ['10', '20'] } },
  'Keep values below 10 or above 20, or reject the unsupported expression.')
const crossColumn = translate('gene:=:BRCA1 OR cadd:>=:20')
record('cross-column OR becomes flat AND filters',
  { filters: crossColumn.columnFilters, warningCount: crossColumn.warnings.length },
  { filters: { gene_symbol: { operator: '=', value: 'BRCA1' }, cadd: { operator: '>=', value: 20, includeEmpty: true } }, warningCount: 1 },
  'The integration must reject unsupported OR or preserve either-branch semantics; its current warning is not exposed.')

for (const input of ['gene:=:BRCA1 cadd:>=:20', 'gene:=:BRCA1)', 'gene:=:BRCA1 AND', 'gene:=:"BRCA1']) {
  const parsed = parseDsl(input)
  record('malformed expression accepted: ' + input, { errors: parsed.errors, ast: parsed.ast },
    { errors: [], ast: { type: 'rule', column: 'gene_symbol', operator: '=', value: 'BRCA1' } },
    'Reject malformed input instead of applying its valid prefix.')
}
for (const operator of ['!~', '^', '$']) {
  record('unsupported operator becomes contains: ' + operator,
    translate(`gene:${operator}:BRCA`).columnFilters,
    { gene_symbol: { operator: 'like', value: 'BRCA' } },
    'Reject unsupported operators or implement their named matching semantics.')
}

for (const input of ['cadd:>=:20', 'cadd_phred:>=:20', 'qual:>=:100', 'cdna:~:123']) {
  const filters = translate(input).columnFilters
  const query = buildSummaryQueryParts({ column_filters: filters }, 'audit')
  record('cohort DSL condition dropped: ' + input,
    { where: query.parts.whereParts, values: query.parts.values, unavailable: query.unavailable },
    { where: [], values: [], unavailable: false },
    'An advertised field must produce its predicate or an explicit unsupported-field error.')
}

const db = new DatabaseSync(':memory:')
try {
  db.exec('CREATE TABLE variants(id INTEGER, cdna TEXT, cadd REAL)')
  const insert = db.prepare('INSERT INTO variants VALUES(?,?,?)')
  insert.run(1, 'c.1_2del', 0)
  insert.run(2, 'c.112del', null)
  insert.run(3, 'c.1_2delinsA', 20)
  const run = (input) => {
    const filters = translate(input).columnFilters
    assertValidColumnFilterValues(filters)
    const query = buildBaseWhere({ column_filters: filters }, { baseAlias: 'v', scope: 'case' })
    return { filters, sql: query.sql, values: query.params,
      ids: db.prepare('SELECT id FROM variants v' + (query.sql ? ' WHERE ' + query.sql : '')).all(...query.params).map(row => row.id) }
  }
  const blank = run('cadd:=:""')
  record('blank numeric value bypasses validation as zero',
    { filters: blank.filters, ids: blank.ids },
    { filters: { cadd: { operator: '=', value: 0 } }, ids: [1] },
    'Reject blank numeric comparisons; missing CADD is a separate null-check operation.')
  assert.deepEqual(run('cadd:is:null').ids, [2])
  const contains = run('cdna:~:"c.1_2del"')
  record('contains matches wildcard near-match',
    { sql: contains.sql, values: contains.values, ids: contains.ids },
    { sql: 'v.cdna LIKE ? COLLATE NOCASE', values: ['%c.1_2del%'], ids: [1, 2, 3] },
    'Literal contains should return IDs [1,3], excluding c.112del.')
  record('PostgreSQL emits the same wildcard pattern', postgresCase(contains.filters),
    { where: ['v.cdna ILIKE $1'], values: ['%c.1_2del%'] },
    'Escape literal underscore/percent/backslash in the contains pattern.')
  const unknown = run('gnomadd_af:<:0.01')
  record('unknown DSL field ignored by SQLite', { sql: unknown.sql, ids: unknown.ids },
    { sql: '', ids: [1, 2, 3] }, 'Reject the unknown field before querying.')
  record('unknown DSL field rejected only by PostgreSQL', postgresCase(unknown.filters),
    { where: [], values: [], error: 'Unsupported PostgreSQL column filter(s): gnomadd_af' },
    'Both backends should receive only validated supported fields.')
} finally {
  db.close()
}

const vueCompiler = require('@vue/compiler-sfc')
const filename = path.join(root, 'src/renderer/src/components/filters/NumericRangeControl.vue')
const { descriptor } = vueCompiler.parse(fs.readFileSync(filename, 'utf8'), { filename })
const script = vueCompiler.compileScript(descriptor, { id: 'audit-numeric-range' })
const component = new Module(filename, module)
component.filename = filename
component.paths = Module._nodeModulePaths(path.dirname(filename))
component._compile(ts.transpileModule(script.content, { compilerOptions }).outputText, filename)
const emitted = []
const state = component.exports.default.setup({ modelValue: undefined }, {
  expose: () => {}, emit: (...args) => emitted.push(args)
})
state.updateOperator('=')
record('numeric extension control cannot leave empty state',
  { operator: state.operator.value ?? null, inputDisabled: state.operator.value === undefined, emitted },
  { operator: null, inputDisabled: true, emitted: [] },
  'Retain the chosen operator and enable numeric entry without emitting an incomplete filter.')

process.stdout.write(JSON.stringify({ reproductionSucceeded: true, checks: evidence.length, evidence }, null, 2) + '\n')
