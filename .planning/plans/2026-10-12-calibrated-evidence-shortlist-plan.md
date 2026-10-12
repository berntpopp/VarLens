# Evidence-rule shortlist + simulation harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank a case's SNVs/indels with DSL evidence rules and inheritance-mode profiles whose points are tuned and validated by a ClinVar spike-in simulation on real varvis exomes, and ship the result only if the pre-registered criterion passes.

**Architecture:** The DSL grammar moves to `src/shared/dsl/` and gains a row evaluator. A pure evidence engine (`src/main/services/scoring/evidence/`) scores rows with decision-list groups and mode profiles using a whole-case gene context built in a first pass; both shortlist services call it in a two-pass page stream. A TypeScript harness (`scripts/shortlist-sim/`) builds a patient-independent public ClinVar pool, annotates it (genefoundry + local VEP cross-check), places spikes into in-memory SQLite copies of local backgrounds and ranks them with the production functions, then tunes, evaluates and reports.

**Tech Stack:** TypeScript 6 strict, Vitest, better-sqlite3-multiple-ciphers (Node ABI for tests/harness), Kysely, Vue 3/Vuetify 4, `jiti` for scripts, `bcftools`/`vep` from the `varlens-annotate` mamba env, genefoundry link endpoints (stateless JSON-RPC over HTTPS).

**Spec:** `.planning/specs/2026-10-12-calibrated-evidence-shortlist-design.md` (v2). Read it before any task.

## Global Constraints

- Worktree `/home/bernt-popp/development/VarLens-wt/shortlist-heuristic`, branch `feat/calibrated-shortlist-heuristic`. Never commit to `main`.
- Heavy commands (`npm ci`, `make test`, `make typecheck`, `make ci`, vitest runs over > 1 file, the simulation) run through `~/.cache/varlens-session/heavy.sh <cmd>` (flock + memory cap).
- `make rebuild-node` before Vitest/harness; native ABI errors → use the `varlens-native-rebuild` skill.
- No `console.*` in `src/` (use `mainLogger` / `logService`); scripts under `scripts/` may print.
- Source files ≤ 600 lines (prefer 150–400); functions ≤ ~80 lines; `make agent-check` must pass.
- Evidence presets: `variantTypeScope ⊆ ['snv','indel']`; `baseFilters` must not contain `inheritanceModes` (non-empty) or `analysisGroupId`.
- Rule text: ≤ 500 chars, AST depth ≤ 8, ≤ 64 nodes, no `@preset`, must parse as DSL. Ruleset: ≤ 40 groups, ≤ 200 rules, |points| ≤ 20.
- Evidence gate (pre-registered): `{ maxGnomadAf: 0.01, consequences: ['HIGH','MODERATE','LOW'] }`.
- Patient data: backgrounds are read only from `VARLENS_SIM_BACKGROUND_DIR` (default `/run/media/bernt-popp/1819-E513/immunology_cases`); no background-derived row, coordinate or gene list is written into the repository or sent over the network. Network calls carry only pool variants built without patient input.
- Data outside the repo: `/home/bernt-popp/development/VarLens-wt/_data/shortlist-sim/` (public downloads in `public/`, caches in `cache/`, runs in `runs/`).
- Commits: Conventional Commits, scope e.g. `feat(shortlist):`, `refactor(dsl):`, `test(shortlist-sim):`; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A rule on a field that is missing in the row (null CADD/AF/moi) must not fire — and `is:null` rules must; expect the same in the tooltip (no phantom contributions).
2. Compound-het partners split across Stage-1 pages or across SNV/indel types must still count each other (`gene_het_hits` ≥ 2 on both).
3. Two spellings of the same indel (`chr7:100:CT:C` vs a right-shifted equivalent) must count as one allele, never as a compound-het pair.
4. A stored evidence preset with an invalid rule (bad DSL, unknown column, mixed scope) must fail loudly with the preset name, never silently fall back to legacy scoring.
5. A varvis row with `hpo_sim_score` imported from `[]` (now null) or `func` imported from a list must score without throwing (null-safe evaluator) and land in the fallback mode.

Each line is pinned by a test in the owning task (Tasks 2, 4, 3/12, 5, 4).

## Parallel lanes and file ownership

| Lane | Tasks | Owns (create/modify) |
|---|---|---|
| A — engine | 1, 2, 3, 4 | `src/shared/dsl/**`, `src/renderer/src/dsl/**` (re-exports), `src/shared/filters/info-value.ts`, `src/main/services/scoring/evidence/**`, `src/shared/types/evidence-ruleset*.ts`, `tests/shared/dsl/**`, `tests/main/services/scoring/evidence/**` |
| B — integration | 5, 6 | `src/main/database/ShortlistService.ts`, `src/main/database/createRepositories.ts`, `src/main/storage/postgres/PostgresShortlistService.ts`, `src/shared/types/shortlist.ts`, `src/shared/types/ipc-schemas.ts` (one import line), `src/renderer/src/components/shortlist/**`, related tests |
| C — data | 7, 8, 9, 10 | `scripts/shortlist-sim/pool/**`, `scripts/shortlist-sim/annotate/**`, `scripts/shortlist-sim/concordance/**`, `tests/scripts/shortlist-sim/{pool,annotate,concordance}/**`, `tests/test-data/shortlist-sim/**` |
| D — harness | 11, 12, 13 | `scripts/shortlist-sim/sim/**`, `scripts/shortlist-sim/stats/**`, `scripts/shortlist-sim/report/**`, `scripts/shortlist-sim/run.ts`, `Makefile` (one target), `tests/scripts/shortlist-sim/{sim,stats,report}/**` |
| E — run & ship | 14, 15, 16 | `src/main/database/evidence-rulesets/**`, migrations, `docs/` user page, report artifacts |

A and C start immediately in parallel. B starts after Task 4. D starts after Task 4 (needs engine) and uses Task 7–10 outputs only through files. E is sequential at the end.

---

### Task 1: Move the DSL grammar core to `src/shared/dsl/`

**Files:**
- Create: `src/shared/dsl/types.ts`, `src/shared/dsl/tokenizer.ts`, `src/shared/dsl/parser.ts`, `src/shared/dsl/column-registry.ts`, `src/shared/dsl/index.ts` (moved with `git mv`, content unchanged except import paths)
- Modify: `src/renderer/src/dsl/{types,tokenizer,parser,column-registry}.ts` become one-line re-exports; `src/renderer/src/dsl/index.ts` unchanged
- Move tests: `tests/renderer/dsl/{tokenizer,parser,column-registry,info-fields}.test.ts` → `tests/shared/dsl/` (they must not use DOM)

**Interfaces:**
- Produces: `import { parseDsl, findColumn, FILTER_COLUMNS, isColumnInScope, type DslNode, type DslFilterRule, type FilterScope } from '../shared/dsl'` usable from `src/main`.

- [ ] **Step 1: Move files**

```bash
cd /home/bernt-popp/development/VarLens-wt/shortlist-heuristic
mkdir -p src/shared/dsl tests/shared/dsl
for f in types tokenizer parser column-registry; do git mv src/renderer/src/dsl/$f.ts src/shared/dsl/$f.ts; done
for f in tokenizer parser column-registry info-fields; do git mv tests/renderer/dsl/$f.test.ts tests/shared/dsl/$f.test.ts; done
```

- [ ] **Step 2: Fix imports in the moved files**

In `src/shared/dsl/parser.ts` replace `'../../../shared/filters/column-filter-validation'` → `'../filters/column-filter-validation'`, `'../../../shared/types/variant-extension-registry-data'` → `'../types/variant-extension-registry-data'`, `'../../../shared/filters/info-field-filter'` → `'../filters/info-field-filter'`. Grep each moved file for `../../../shared/` and rewrite to `../`. Then create `src/shared/dsl/index.ts`:

```ts
export * from './types'
export * from './column-registry'
export * from './tokenizer'
export * from './parser'
```

- [ ] **Step 3: Renderer re-exports (keeps every existing import working)**

`src/renderer/src/dsl/types.ts`:
```ts
export * from '../../../shared/dsl/types'
```
Same one-liner for `tokenizer.ts`, `parser.ts`, `column-registry.ts` (pointing at the matching shared file). Fix test imports in `tests/shared/dsl/*.test.ts` to `../../../src/shared/dsl/<file>`.

- [ ] **Step 4: Verify no renderer-only dependency leaked into shared**

Run: `grep -rn "from 'vue'\|vuetify\|window\.\|renderer/src" src/shared/dsl/ ; echo exit=$?`
Expected: no matches (`exit=1`).

- [ ] **Step 5: Run DSL tests + typecheck**

Run: `~/.cache/varlens-session/heavy.sh npx vitest run tests/shared/dsl tests/renderer/dsl` then `~/.cache/varlens-session/heavy.sh make typecheck`
Expected: all pass, same test count as before the move.

- [ ] **Step 6: Commit**

```bash
git add -A src/shared/dsl src/renderer/src/dsl tests/shared/dsl tests/renderer/dsl
git commit -m "refactor(dsl): move the filter grammar core to src/shared/dsl

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rule evaluator with explicit semantics + shortlist scope

**Files:**
- Create: `src/shared/filters/info-value.ts`, `src/shared/dsl/evaluate.ts`
- Modify: `src/shared/filters/info-field-filter.ts` (re-use `isJsonNumberText` from `info-value.ts`; no SQL change), `src/shared/dsl/column-registry.ts` (add `shortlistOnly` columns + scope `'shortlist'`), `src/shared/dsl/parser.ts` (accept scope `'shortlist'`)
- Test: `tests/shared/dsl/evaluate.test.ts`, `tests/shared/filters/info-value.test.ts`, `tests/main/database/dsl-evaluator-sql-parity.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `impactRank` (from `src/shared/config/severity.config.ts`), `clinvarRank`, `NUMERIC_COLUMN_FILTER_KEYS`.
- Produces:
```ts
// src/shared/dsl/evaluate.ts
export type EvaluableRow = Readonly<Record<string, unknown>>
export type RowPredicate = (row: EvaluableRow) => boolean
export const RULE_LIMITS: { maxChars: 500; maxDepth: 8; maxNodes: 64 }
export type CompileResult = { ok: true; predicate: RowPredicate } | { ok: false; errors: string[] }
export function compileRule(text: string): CompileResult
// src/shared/filters/info-value.ts
export interface InfoValue { present: boolean; text: string | null; num: number | null }
export function readInfoValue(infoJson: string | null | undefined, key: string): InfoValue
export function isJsonNumberText(text: string): boolean
// column-registry additions
export type FilterScope = 'case' | 'cohort' | 'shortlist'
export const SHORTLIST_DERIVED_COLUMNS: readonly ['zygosity', 'gene_het_hits', 'gene_hits']
```

- [ ] **Step 1: Write failing tests for `info-value.ts`**

```ts
// tests/shared/filters/info-value.test.ts
import { describe, it, expect } from 'vitest'
import { readInfoValue, isJsonNumberText } from '../../../src/shared/filters/info-value'

describe('readInfoValue', () => {
  const json = JSON.stringify({ DP: '35', Z: '0', E: '1e-5', BIG: '1e1000', L: '1,2', F: '', M: '.', T: 'abc' })
  it('classifies numeric scalars like the SQL emitters', () => {
    expect(readInfoValue(json, 'DP')).toEqual({ present: true, text: '35', num: 35 })
    expect(readInfoValue(json, 'Z').num).toBe(0)
    expect(readInfoValue(json, 'E').num).toBe(1e-5)
    expect(readInfoValue(json, 'BIG').num).toBeNull() // exponent > 3 digits
    expect(readInfoValue(json, 'L').num).toBeNull() // list
    expect(readInfoValue(json, 'T').num).toBeNull()
  })
  it('treats absent and "." as missing, flag "" as present', () => {
    expect(readInfoValue(json, 'NOPE').present).toBe(false)
    expect(readInfoValue(json, 'M').present).toBe(false)
    expect(readInfoValue(json, 'F')).toEqual({ present: true, text: '', num: null })
    expect(readInfoValue(null, 'DP').present).toBe(false)
    expect(readInfoValue('not json', 'DP').present).toBe(false)
  })
  it('isJsonNumberText', () => {
    for (const ok of ['0', '-1.5', '2E3', ' 7 ']) expect(isJsonNumberText(ok)).toBe(true)
    for (const bad of ['01', '1.', '.5', '1e1234', 'NaN', '', '1,2']) expect(isJsonNumberText(bad)).toBe(false)
  })
})
```

- [ ] **Step 2: Implement `info-value.ts`**

```ts
// src/shared/filters/info-value.ts
/**
 * Row-side reading of one `info.<KEY>` value with the same classification the
 * SQL emitters in info-field-filter.ts apply (JSON-number shape, ≤ 64 chars,
 * exponent ≤ 3 digits; absent or "." = missing; "" = present flag).
 */
const JSON_NUMBER_RE = /^[ \t\n\r]*-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]{1,3})?[ \t\n\r]*$/

export interface InfoValue {
  present: boolean
  text: string | null
  num: number | null
}

export function isJsonNumberText(text: string): boolean {
  return text.length <= 64 && JSON_NUMBER_RE.test(text)
}

const MISSING: InfoValue = { present: false, text: null, num: null }

export function readInfoValue(infoJson: string | null | undefined, key: string): InfoValue {
  if (infoJson == null || infoJson === '') return MISSING
  let parsed: unknown
  try {
    parsed = JSON.parse(infoJson)
  } catch {
    return MISSING
  }
  if (parsed === null || typeof parsed !== 'object') return MISSING
  const raw = (parsed as Record<string, unknown>)[key]
  if (raw === undefined || raw === null) return MISSING
  const text = typeof raw === 'string' ? raw : String(raw)
  if (text === '.') return MISSING
  return { present: true, text, num: isJsonNumberText(text) ? Number(text) : null }
}
```
In `info-field-filter.ts` keep the SQL unchanged; add a header comment line pointing to `info-value.ts` as the row-side twin.

- [ ] **Step 3: Write failing evaluator tests (semantics table + Review Focus 1, 5)**

```ts
// tests/shared/dsl/evaluate.test.ts
import { describe, it, expect } from 'vitest'
import { compileRule, RULE_LIMITS } from '../../../src/shared/dsl/evaluate'

function pred(text: string) {
  const r = compileRule(text)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.predicate
}
const row = (o: Record<string, unknown>) => o

describe('compileRule — semantics', () => {
  it('numeric comparisons never fire on missing values', () => {
    const p = pred('cadd:>=:20')
    expect(p(row({ cadd: 25 }))).toBe(true)
    expect(p(row({ cadd: 15 }))).toBe(false)
    expect(p(row({ cadd: null }))).toBe(false)
    expect(p(row({}))).toBe(false)
    expect(pred('cadd:!=:20')(row({ cadd: null }))).toBe(false)
  })
  it('is:null fires on null and blank text', () => {
    expect(pred('gnomad_af:is:null')(row({ gnomad_af: null }))).toBe(true)
    expect(pred('gnomad_af:is:null')(row({ gnomad_af: 0 }))).toBe(false)
    expect(pred('gene_symbol:is:null')(row({ gene_symbol: '' }))).toBe(true)
    expect(pred('gene_symbol:is:notnull')(row({ gene_symbol: 'BTK' }))).toBe(true)
  })
  it('severity columns match by normalised category, like the SQL filter', () => {
    expect(pred('clinvar:=:Pathogenic')(row({ clinvar: 'Pathogenic|drug_response' }))).toBe(true)
    expect(pred('clinvar:=:Pathogenic')(row({ clinvar: 'pathogenic' }))).toBe(true)
    expect(pred('clinvar:!=:Pathogenic')(row({ clinvar: null }))).toBe(false)
    expect(pred('consequence:=:HIGH')(row({ consequence: 'HIGH' }))).toBe(true)
  })
  it('text = is exact, ~ is ASCII case-insensitive substring with literal % and _', () => {
    expect(pred('func:=:missense_variant')(row({ func: 'missense_variant' }))).toBe(true)
    expect(pred('func:=:missense_variant')(row({ func: 'Missense_variant' }))).toBe(false)
    expect(pred('moi:~:ar')(row({ moi: 'AD, AR' }))).toBe(true)
    expect(pred('gene_symbol:~:a_b')(row({ gene_symbol: 'XA_BX' }))).toBe(true)
    expect(pred('gene_symbol:~:a_b')(row({ gene_symbol: 'XAZBX' }))).toBe(false)
    expect(pred('moi:~:AR')(row({ moi: null }))).toBe(false)
  })
  it('AND / OR / groups', () => {
    const p = pred('(func:=:stop_gained OR func:=:frameshift_truncation) AND gnomad_af:<:0.001')
    expect(p(row({ func: 'stop_gained', gnomad_af: 0.0001 }))).toBe(true)
    expect(p(row({ func: 'stop_gained', gnomad_af: null }))).toBe(false)
    expect(p(row({ func: 'missense_variant', gnomad_af: 0 }))).toBe(false)
  })
  it('info.<KEY> follows info-value semantics', () => {
    const info = JSON.stringify({ REVEL: '0.8', TAG: 'x' })
    expect(pred('info.REVEL:>=:0.7')(row({ info_json: info }))).toBe(true)
    expect(pred('info.TAG:>=:0.7')(row({ info_json: info }))).toBe(false)
    expect(pred('info.MISSING:is:null')(row({ info_json: info }))).toBe(true)
  })
  it('derived shortlist columns are accepted', () => {
    expect(pred('zygosity:=:het AND gene_het_hits:>=:2')(row({ zygosity: 'het', gene_het_hits: 2 }))).toBe(true)
  })
  it('never throws on odd imported values (Review Focus 5)', () => {
    const p = pred('hpo_sim_score:>=:0.1 OR func:=:missense_variant')
    expect(() => p(row({ hpo_sim_score: [], func: ['a'] }))).not.toThrow()
    expect(p(row({ hpo_sim_score: [], func: ['a'] }))).toBe(false)
  })
})

describe('compileRule — validation', () => {
  it('rejects plain text, presets, unknown columns and oversized input', () => {
    expect(compileRule('BRCA1').ok).toBe(false)
    expect(compileRule('@my_preset').ok).toBe(false)
    expect(compileRule('nope:=:1').ok).toBe(false)
    expect(compileRule('cadd:>=:1 AND '.repeat(40) + 'cadd:>=:1').ok).toBe(false)
    expect(compileRule('x'.repeat(RULE_LIMITS.maxChars + 1)).ok).toBe(false)
  })
})
```

- [ ] **Step 4: Run to see them fail**

Run: `npx vitest run tests/shared/dsl/evaluate.test.ts tests/shared/filters/info-value.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 5: Registry — shortlist scope and derived columns**

In `src/shared/dsl/column-registry.ts`:
- `export type FilterScope = 'case' | 'cohort' | 'shortlist'`
- add to `FilterColumnDef`: `shortlistOnly?: true`
- append to `FILTER_COLUMNS`:
```ts
  { key: 'zygosity', label: 'Zygosity (derived)', aliases: [], type: 'categorical',
    operators: ['=', '!='], shortlistOnly: true,
    commonValues: [{ value: 'het', label: 'het' }, { value: 'hom', label: 'hom' }, { value: 'hemi', label: 'hemi' }] },
  { key: 'gene_het_hits', label: 'Het candidates in gene (derived)', aliases: [], type: 'numeric',
    operators: NUMERIC_OPERATORS, shortlistOnly: true },
  { key: 'gene_hits', label: 'Candidates in gene (derived)', aliases: [], type: 'numeric',
    operators: NUMERIC_OPERATORS, shortlistOnly: true },
```
- `export const SHORTLIST_DERIVED_COLUMNS = ['zygosity', 'gene_het_hits', 'gene_hits'] as const`
- `isColumnInScope(col, scope)`: `if (col.shortlistOnly === true) return scope === 'shortlist'; return scope !== 'cohort' || col.caseOnly !== true`
- `getColumnSuggestions` already filters through `isColumnInScope` (verify).

In `parser.ts`, wherever the scope is compared to `'case'` for info fields or cohort-only columns, treat `'shortlist'` like `'case'` (grep `scope ===`). Add a parser test: `parseDsl('zygosity:=:het', 'case')` has an error; `parseDsl('zygosity:=:het', 'shortlist')` has none.

- [ ] **Step 6: Implement `evaluate.ts`**

```ts
// src/shared/dsl/evaluate.ts
/**
 * Compile a DSL rule into a row predicate for shortlist scoring.
 * Semantics (spec §3.1): a comparison never fires on a missing value;
 * `consequence`/`clinvar` match by normalised category like the SQL severity
 * filter; text `=` exact; `~` ASCII case-insensitive substring (literal %/_);
 * `is:null` = null or blank text; `info.<KEY>` via readInfoValue.
 */
import { parseDsl } from './parser'
import { findColumn } from './column-registry'
import type { DslNode, DslFilterRule } from './types'
import { impactRank, clinvarRank } from '../config/severity.config'
import { INFO_FIELD_PREFIX } from '../filters/info-field-filter'
import { readInfoValue } from '../filters/info-value'

export type EvaluableRow = Readonly<Record<string, unknown>>
export type RowPredicate = (row: EvaluableRow) => boolean
export const RULE_LIMITS = { maxChars: 500, maxDepth: 8, maxNodes: 64 } as const
export type CompileResult = { ok: true; predicate: RowPredicate } | { ok: false; errors: string[] }

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const blank = (v: unknown): boolean => v == null || (typeof v === 'string' && v === '')

function compareNumbers(op: string, a: number, b: number): boolean {
  switch (op) {
    case '=': return a === b
    case '!=': return a !== b
    case '<': return a < b
    case '<=': return a <= b
    case '>': return a > b
    case '>=': return a >= b
    default: return false
  }
}

function severityRank(column: string, value: string): number {
  return column === 'consequence' ? impactRank(value) : clinvarRank(value)
}

function severityMatch(column: string, stored: string, wanted: string): boolean {
  if (stored === wanted) return true
  const r = severityRank(column, wanted)
  return r > 0 && severityRank(column, stored) === r
}

function infoPredicate(rule: DslFilterRule): RowPredicate {
  const key = rule.column.slice(INFO_FIELD_PREFIX.length)
  return (row) => {
    const v = readInfoValue(text(row.info_json), key)
    switch (rule.operator) {
      case 'is:null': return !v.present
      case 'is:notnull': return v.present
      case '~': return v.text != null && v.text.toLowerCase().includes(String(rule.value).toLowerCase())
      case '=':
      case '!=': {
        if (!v.present) return false
        const want = String(rule.value)
        const wantNum = Number(want)
        const eq = v.text === want || (v.num != null && want.trim() !== '' && Number.isFinite(wantNum) && v.num === wantNum)
        return rule.operator === '=' ? eq : !eq
      }
      default:
        return v.num != null && compareNumbers(rule.operator, v.num, Number(rule.value))
    }
  }
}

function rulePredicate(rule: DslFilterRule): RowPredicate {
  if (rule.column.startsWith(INFO_FIELD_PREFIX)) return infoPredicate(rule)
  const def = findColumn(rule.column)
  const key = def?.key ?? rule.column
  const op = rule.operator
  if (op === 'is:null') return (row) => blank(row[key])
  if (op === 'is:notnull') return (row) => !blank(row[key])
  if (def?.type === 'numeric') {
    const want = Number(rule.value)
    return (row) => {
      const v = finite(row[key])
      return v != null && compareNumbers(op, v, want)
    }
  }
  const want = String(rule.value)
  if (key === 'consequence' || key === 'clinvar') {
    return (row) => {
      const v = text(row[key])
      if (v == null || v === '') return false
      const m = severityMatch(key, v, want)
      return op === '!=' ? !m : op === '=' ? m : v.toLowerCase().includes(want.toLowerCase())
    }
  }
  const lower = want.toLowerCase()
  return (row) => {
    const v = text(row[key])
    if (v == null) return false
    if (op === '=') return v === want
    if (op === '!=') return v !== want
    if (op === '~') return v.toLowerCase().includes(lower)
    return false
  }
}

function measure(node: DslNode, depth: number, acc: { nodes: number; depth: number }): void {
  acc.nodes += 1
  acc.depth = Math.max(acc.depth, depth)
  if (node.type === 'group') for (const c of node.children) measure(c, depth + 1, acc)
}

function build(node: DslNode): RowPredicate {
  if (node.type === 'rule') return rulePredicate(node)
  if (node.type === 'preset') return () => false // rejected before build
  const parts = node.children.map(build)
  return node.combinator === 'AND'
    ? (row) => parts.every((p) => p(row))
    : (row) => parts.some((p) => p(row))
}

function hasPreset(node: DslNode): boolean {
  return node.type === 'preset' || (node.type === 'group' && node.children.some(hasPreset))
}

export function compileRule(input: string): CompileResult {
  if (input.length > RULE_LIMITS.maxChars) {
    return { ok: false, errors: [`Rule is longer than ${RULE_LIMITS.maxChars} characters`] }
  }
  const parsed = parseDsl(input, 'shortlist')
  if (parsed.errors.length > 0) return { ok: false, errors: parsed.errors.map((e) => e.message) }
  if (!parsed.isDsl || parsed.ast == null) {
    return { ok: false, errors: ['Rule must be a filter expression (column:operator:value)'] }
  }
  if (hasPreset(parsed.ast)) return { ok: false, errors: ['@preset references are not allowed in rules'] }
  const size = { nodes: 0, depth: 0 }
  measure(parsed.ast, 1, size)
  if (size.nodes > RULE_LIMITS.maxNodes || size.depth > RULE_LIMITS.maxDepth) {
    return { ok: false, errors: [`Rule exceeds ${RULE_LIMITS.maxNodes} terms or depth ${RULE_LIMITS.maxDepth}`] }
  }
  return { ok: true, predicate: build(parsed.ast) }
}
```
If the parser stores numeric values for numeric columns as numbers already, `Number(rule.value)` is a no-op. If `impactRank`/`clinvarRank` signatures differ, adapt only the call site.

- [ ] **Step 7: Run unit tests**

Run: `npx vitest run tests/shared/dsl tests/shared/filters/info-value.test.ts`
Expected: PASS.

- [ ] **Step 8: SQL parity test (SQLite)**

`tests/main/database/dsl-evaluator-sql-parity.test.ts`: build an in-memory DB exactly like `tests/main/database/ShortlistService.test.ts` does (`initializeSchema`, `runMigrations`, `insertCase`), insert ~30 SNV rows covering CADD {5,10,15,20,25,35,null}, AF {0, 1e-5, 1e-3, 0.02, null}, clinvar {'Pathogenic','pathogenic','Pathogenic|drug_response','Benign',null,''}, consequence {HIGH,MODERATE,LOW,MODIFIER,null}, func, gene_symbol with `_` and `%`, and `info_json` values like the info-value test. For each expression in a table (`cadd:>=:20`, `gnomad_af:<:0.001`, `clinvar:=:Pathogenic`, `clinvar:!=:Benign`, `consequence:=:HIGH`, `func:=:missense_variant`, `gene_symbol:~:a_b`, `info.REVEL:>=:0.7`, `info.TAG:=:x`, `gnomad_af:is:null`, `gene_symbol:is:notnull`):
1. Get SQL IDs: `translateAst(parseDsl(expr,'case').ast)` → `columnFilters`; set every `includeEmpty: false`; run through `createRepositories(db).shortlistService`-independent path: `new VariantFilterBuilder(...)` the way `shortlist-query.test.ts` constructs it, with `column_filters` and `case_id`; select ids.
2. Get evaluator IDs: `compileRule(expr)` over the same rows selected with `SELECT * FROM variants WHERE case_id=?`.
3. `expect(evaluatorIds).toEqual(sqlIds)` (both sorted ascending).
Add one explicit test asserting the documented difference: with the translator's default `includeEmpty: true`, SQL for `cadd:>=:20` contains the null-CADD row and the evaluator does not.

- [ ] **Step 9: Run parity test**

Run: `make rebuild-node && npx vitest run tests/main/database/dsl-evaluator-sql-parity.test.ts`
Expected: PASS. If a case differs, fix the evaluator (never the SQL) unless the difference is the documented null rule.

- [ ] **Step 10: Commit**

```bash
git add src/shared/dsl src/shared/filters/info-value.ts src/shared/filters/info-field-filter.ts tests/shared tests/main/database/dsl-evaluator-sql-parity.test.ts
git commit -m "feat(dsl): row evaluator for shortlist rules with explicit semantics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Case context and derived fields (zygosity, gene hits, allele identity)

**Files:**
- Create: `src/main/services/scoring/evidence/case-context.ts`
- Test: `tests/main/services/scoring/evidence/case-context.test.ts`

**Interfaces:**
- Consumes: `genotypeZygosity` (`src/shared/utils/genotype.ts`), `isInPAR` (`src/shared/utils/par-regions.ts`).
- Produces:
```ts
export type CaseSex = 'male' | 'female' | null
export interface CaseInfo { build: string; sex: CaseSex }
export interface LightRow { id: number; chr: string; pos: number; ref: string; alt: string; gene_symbol: string | null; gt_num: string | null }
export type Zygosity = 'het' | 'hom' | 'hemi'
export function deriveZygosity(row: Pick<LightRow, 'chr' | 'pos' | 'gt_num'>, info: CaseInfo): Zygosity | null
export function alleleKey(row: Pick<LightRow, 'chr' | 'pos' | 'ref' | 'alt'>): string
export class GeneContextBuilder { constructor(info: CaseInfo); add(rows: readonly LightRow[]): void; build(): GeneContext }
export interface GeneContext { info: CaseInfo; derived(row: LightRow): DerivedFields }
export interface DerivedFields { zygosity: Zygosity | null; gene_het_hits: number; gene_hits: number; partners: number[] }
```

- [ ] **Step 1: Failing tests (incl. Review Focus 2 and 3)**

```ts
// tests/main/services/scoring/evidence/case-context.test.ts
import { describe, it, expect } from 'vitest'
import { GeneContextBuilder, deriveZygosity, alleleKey } from '../../../../../src/main/services/scoring/evidence/case-context'

const r = (id: number, o: Partial<{ chr: string; pos: number; ref: string; alt: string; gene_symbol: string | null; gt_num: string | null }>) =>
  ({ id, chr: '1', pos: 100 + id, ref: 'A', alt: 'G', gene_symbol: 'G1', gt_num: '0/1', ...o })

describe('deriveZygosity', () => {
  const female = { build: 'GRCh38', sex: 'female' as const }
  const male = { build: 'GRCh38', sex: 'male' as const }
  it('maps genotype classes incl. assumed het', () => {
    expect(deriveZygosity(r(1, { gt_num: './1' }), female)).toBe('het')
    expect(deriveZygosity(r(1, { gt_num: '1/1' }), female)).toBe('hom')
    expect(deriveZygosity(r(1, { gt_num: '1' }), female)).toBe('hemi')
    expect(deriveZygosity(r(1, { gt_num: null }), female)).toBeNull()
  })
  it('male chrX non-PAR hom is hemi; PAR and unknown sex stay hom', () => {
    expect(deriveZygosity(r(1, { chr: 'X', pos: 50_000_000, gt_num: '1/1' }), male)).toBe('hemi')
    expect(deriveZygosity(r(1, { chr: 'chrX', pos: 50_000_000, gt_num: '1/1' }), male)).toBe('hemi')
    expect(deriveZygosity(r(1, { chr: 'X', pos: 1_000_000, gt_num: '1/1' }), male)).toBe('hom') // PAR1 GRCh38
    expect(deriveZygosity(r(1, { chr: 'X', pos: 50_000_000, gt_num: '1/1' }), { build: 'GRCh38', sex: null })).toBe('hom')
  })
})

describe('GeneContextBuilder', () => {
  const info = { build: 'GRCh38', sex: 'female' as const }
  it('counts distinct het alleles across pages and types (Review Focus 2)', () => {
    const b = new GeneContextBuilder(info)
    b.add([r(1, {})]) // SNV page 1
    b.add([r(2, { ref: 'CT', alt: 'C' })]) // indel, another page
    const ctx = b.build()
    expect(ctx.derived(r(1, {})).gene_het_hits).toBe(2)
    expect(ctx.derived(r(1, {})).partners).toEqual([2])
    expect(ctx.derived(r(2, { ref: 'CT', alt: 'C' })).partners).toEqual([1])
  })
  it('the same allele twice is one allele (Review Focus 3)', () => {
    const b = new GeneContextBuilder(info)
    b.add([r(1, { pos: 500 }), r(2, { pos: 500 })])
    expect(b.build().derived(r(1, { pos: 500 })).gene_het_hits).toBe(1)
  })
  it('hom rows count for gene_hits, not gene_het_hits; null gene counts itself', () => {
    const b = new GeneContextBuilder(info)
    b.add([r(1, {}), r(2, { gt_num: '1/1' }), r(3, { gene_symbol: null })])
    const ctx = b.build()
    expect(ctx.derived(r(1, {}))).toMatchObject({ gene_het_hits: 1, gene_hits: 2 })
    expect(ctx.derived(r(3, { gene_symbol: null }))).toMatchObject({ gene_het_hits: 1, gene_hits: 1, partners: [] })
  })
  it('alleleKey normalises the chr prefix', () => {
    expect(alleleKey(r(1, { chr: 'chr1', pos: 5 }))).toBe(alleleKey(r(1, { chr: '1', pos: 5 })))
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/main/services/scoring/evidence/case-context.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/main/services/scoring/evidence/case-context.ts
/**
 * Whole-case context for evidence scoring (spec §3.2–3.3): built in pass 1
 * over every eligible row, so a row's gene counts never depend on paging,
 * variant type or mode (no recursion).
 */
import { genotypeZygosity } from '../../../../shared/utils/genotype'
import { isInPAR } from '../../../../shared/utils/par-regions'

export type CaseSex = 'male' | 'female' | null
export interface CaseInfo { build: string; sex: CaseSex }
export interface LightRow {
  id: number; chr: string; pos: number; ref: string; alt: string
  gene_symbol: string | null; gt_num: string | null
}
export type Zygosity = 'het' | 'hom' | 'hemi'
export interface DerivedFields { zygosity: Zygosity | null; gene_het_hits: number; gene_hits: number; partners: number[] }
export interface GeneContext { info: CaseInfo; derived(row: LightRow): DerivedFields }

const bareChr = (chr: string): string => chr.replace(/^chr/i, '').toUpperCase()

export function alleleKey(row: Pick<LightRow, 'chr' | 'pos' | 'ref' | 'alt'>): string {
  return `${bareChr(row.chr)}:${row.pos}:${row.ref.toUpperCase()}:${row.alt.toUpperCase()}`
}

export function deriveZygosity(row: Pick<LightRow, 'chr' | 'pos' | 'gt_num'>, info: CaseInfo): Zygosity | null {
  const z = genotypeZygosity(row.gt_num)
  if (z === 'hom' && info.sex === 'male' && bareChr(row.chr) === 'X' && !isInPAR(row.chr, row.pos, info.build)) {
    return 'hemi'
  }
  return z
}

interface GeneEntry { het: Map<string, number>; all: Set<string> }

export class GeneContextBuilder {
  private readonly genes = new Map<string, GeneEntry>()
  constructor(private readonly info: CaseInfo) {}

  add(rows: readonly LightRow[]): void {
    for (const row of rows) {
      if (row.gene_symbol == null || row.gene_symbol === '') continue
      let entry = this.genes.get(row.gene_symbol)
      if (entry === undefined) {
        entry = { het: new Map(), all: new Set() }
        this.genes.set(row.gene_symbol, entry)
      }
      const key = alleleKey(row)
      entry.all.add(key)
      if (deriveZygosity(row, this.info) === 'het' && !entry.het.has(key)) entry.het.set(key, row.id)
    }
  }

  build(): GeneContext {
    const { genes, info } = this
    return {
      info,
      derived(row: LightRow): DerivedFields {
        const zygosity = deriveZygosity(row, info)
        const entry = row.gene_symbol ? genes.get(row.gene_symbol) : undefined
        if (entry === undefined) return { zygosity, gene_het_hits: 1, gene_hits: 1, partners: [] }
        const own = alleleKey(row)
        const partners = [...entry.het.entries()].filter(([k]) => k !== own).map(([, id]) => id)
        return { zygosity, gene_het_hits: entry.het.size, gene_hits: entry.all.size, partners }
      }
    }
  }
}
```
Check `isInPAR`'s expected `chr` format and build strings (`'GRCh38'` vs `'hg38'`) in `par-regions.ts`; adapt the call if it expects a bare chromosome.

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(shortlist): whole-case gene context for evidence scoring"` (+ trailer).

---

### Task 4: Ruleset schema, compilation and row scoring

**Files:**
- Create: `src/shared/types/evidence-ruleset.ts` (types), `src/shared/types/evidence-ruleset-schemas.ts` (Zod), `src/main/services/scoring/evidence/ruleset.ts` (compile/validate), `src/main/services/scoring/evidence/score.ts` (row scoring), `src/main/services/scoring/evidence/index.ts`
- Test: `tests/main/services/scoring/evidence/ruleset.test.ts`, `tests/main/services/scoring/evidence/score.test.ts`

**Interfaces:**
- Consumes: `compileRule` (Task 2), `DerivedFields` (Task 3), `mapClinvarBoost` (`src/main/services/scoring/index.ts`).
- Produces:
```ts
// src/shared/types/evidence-ruleset.ts
export type ModeId = 'ad' | 'ar_hom' | 'ar_comphet' | 'xl' | 'fallback'
export interface EvidenceRule { id: string; label: string; when: string; points: number }
export interface EvidenceGroup { id: string; label: string; scope: 'global' | ModeId; rules: EvidenceRule[] }
export interface ModeProfile { id: ModeId; label: string; when: string | null; points: number } // fallback: when null
export interface EvidenceRuleset { version: 1; id: string; sha256?: string; modes: ModeProfile[]; groups: EvidenceGroup[] }
export interface EvidenceContribution { kind: 'mode' | 'rule'; id: string; label: string; group: string | null; points: number }
// src/main/services/scoring/evidence/ruleset.ts
export class EvidenceRulesetError extends Error { constructor(public readonly problems: string[]) }
export interface CompiledRuleset { source: EvidenceRuleset; /* opaque */ }
export function compileRuleset(ruleset: EvidenceRuleset): CompiledRuleset            // throws EvidenceRulesetError
export function validateEvidenceConfig(config: ShortlistConfig): string[]            // [] when fine
// src/main/services/scoring/evidence/score.ts
export interface EvidenceScore { score: number; mode: ModeId; contributions: EvidenceContribution[] }
export function scoreEvidenceRow(row: Record<string, unknown>, derived: DerivedFields, compiled: CompiledRuleset): EvidenceScore
```

- [ ] **Step 1: Failing tests**

```ts
// tests/main/services/scoring/evidence/score.test.ts
import { describe, it, expect } from 'vitest'
import { compileRuleset } from '../../../../../src/main/services/scoring/evidence/ruleset'
import { scoreEvidenceRow } from '../../../../../src/main/services/scoring/evidence/score'
import type { EvidenceRuleset } from '../../../../../src/shared/types/evidence-ruleset'

const RS: EvidenceRuleset = {
  version: 1, id: 'test',
  modes: [
    { id: 'ar_hom', label: 'AR hom', when: 'moi:~:AR AND zygosity:=:hom', points: 3 },
    { id: 'ar_comphet', label: 'AR comphet', when: 'moi:~:AR AND zygosity:=:het AND gene_het_hits:>=:2', points: 2 },
    { id: 'ad', label: 'AD', when: 'moi:~:AD AND zygosity:=:het', points: 1 },
    { id: 'fallback', label: 'No compatible mode', when: null, points: -1 }
  ],
  groups: [
    { id: 'freq', label: 'Frequency', scope: 'global', rules: [
      { id: 'af_missing', label: 'not in gnomAD', when: 'gnomad_af:is:null', points: 3 },
      { id: 'af_1e5', label: 'AF < 1e-5', when: 'gnomad_af:<:0.00001', points: 4 },
      { id: 'af_1e3', label: 'AF < 1e-3', when: 'gnomad_af:<:0.001', points: 2 } ] },
    { id: 'lof', label: 'Effect', scope: 'global', rules: [
      { id: 'lof', label: 'LoF', when: 'func:=:stop_gained OR func:=:frameshift_truncation', points: 5 } ] },
    { id: 'ad_freq', label: 'AD frequency', scope: 'ad', rules: [
      { id: 'ad_common', label: 'too common for AD', when: 'gnomad_af:>:0.0001', points: -3 } ] }
  ]
}
const d = (o: Partial<{ zygosity: 'het' | 'hom' | 'hemi' | null; gene_het_hits: number; gene_hits: number }>) =>
  ({ zygosity: 'het' as const, gene_het_hits: 1, gene_hits: 1, partners: [], ...o })

describe('scoreEvidenceRow', () => {
  const c = compileRuleset(RS)
  it('decision list: first matching rule of a group wins', () => {
    const s = scoreEvidenceRow({ gnomad_af: 0.000001, func: 'stop_gained', moi: 'AR' }, d({ zygosity: 'hom' }), c)
    expect(s.mode).toBe('ar_hom')
    expect(s.score).toBe(3 + 4 + 5)
  })
  it('contributions sum to the score', () => {
    const s = scoreEvidenceRow({ gnomad_af: 0.0005, func: 'stop_gained', moi: 'AD' }, d({}), c)
    expect(s.contributions.reduce((a, x) => a + x.points, 0)).toBe(s.score)
  })
  it('picks the best eligible mode; mode-scoped penalties only apply in that mode', () => {
    // AD eligible: 1 + 2 + 5 - 3 = 5 ; fallback: -1 + 2 + 5 = 6 → fallback wins (no compatible explanation is better)
    const s = scoreEvidenceRow({ gnomad_af: 0.0005, func: 'stop_gained', moi: 'AD' }, d({}), c)
    expect(s.mode).toBe('fallback')
    expect(s.score).toBe(6)
  })
  it('compound het needs two het alleles', () => {
    expect(scoreEvidenceRow({ moi: 'AR', func: 'stop_gained' }, d({ gene_het_hits: 1 }), c).mode).toBe('fallback')
    expect(scoreEvidenceRow({ moi: 'AR', func: 'stop_gained' }, d({ gene_het_hits: 2 }), c).mode).toBe('ar_comphet')
  })
  it('missing fields never contribute (Review Focus 1)', () => {
    const s = scoreEvidenceRow({ gnomad_af: 0, func: null, moi: null }, d({}), c)
    expect(s.contributions.map((x) => x.id)).toEqual(['fallback', 'af_1e5'])
  })
})
```

```ts
// tests/main/services/scoring/evidence/ruleset.test.ts
import { describe, it, expect } from 'vitest'
import { compileRuleset, validateEvidenceConfig, EvidenceRulesetError } from '../../../../../src/main/services/scoring/evidence/ruleset'

const base = { version: 1 as const, id: 'x', modes: [{ id: 'fallback' as const, label: 'f', when: null, points: 0 }], groups: [] }
describe('compileRuleset', () => {
  it('rejects bad DSL with the rule id in the message', () => {
    expect(() => compileRuleset({ ...base, groups: [{ id: 'g', label: 'g', scope: 'global', rules: [{ id: 'bad', label: 'b', when: 'nope:=:1', points: 1 }] }] }))
      .toThrow(/bad/)
  })
  it('rejects duplicate ids, missing fallback, |points| > 20, mixed signs in a group', () => {
    const rule = (id: string, points: number) => ({ id, label: id, when: 'cadd:>=:1', points })
    const bad = [
      { ...base, groups: [{ id: 'g', label: 'g', scope: 'global' as const, rules: [rule('a', 1), rule('a', 2)] }] },
      { ...base, modes: [] },
      { ...base, groups: [{ id: 'g', label: 'g', scope: 'global' as const, rules: [rule('a', 21)] }] },
      { ...base, groups: [{ id: 'g', label: 'g', scope: 'global' as const, rules: [rule('a', 1), rule('b', -1)] }] }
    ]
    for (const rs of bad) expect(() => compileRuleset(rs)).toThrow(EvidenceRulesetError)
  })
})
describe('validateEvidenceConfig', () => {
  const ruleset = base
  const cfg = (o: object) => ({ topN: 50, baseFilters: {}, rankConfig: { weights: { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 }, ruleset }, ...o })
  it('accepts snv/indel scope without inheritance filters', () => {
    expect(validateEvidenceConfig(cfg({ variantTypeScope: ['snv', 'indel'] }) as never)).toEqual([])
  })
  it('rejects sv scope, missing scope, inheritance modes, analysis group', () => {
    expect(validateEvidenceConfig(cfg({ variantTypeScope: ['snv', 'sv'] }) as never)).not.toEqual([])
    expect(validateEvidenceConfig(cfg({}) as never)).not.toEqual([])
    expect(validateEvidenceConfig(cfg({ variantTypeScope: ['snv'], baseFilters: { inheritanceModes: ['homozygous'] } }) as never)).not.toEqual([])
    expect(validateEvidenceConfig(cfg({ variantTypeScope: ['snv'], baseFilters: { analysisGroupId: 3 } }) as never)).not.toEqual([])
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Types + Zod schema**

`src/shared/types/evidence-ruleset.ts` — the interfaces from the Interfaces block. `src/shared/types/evidence-ruleset-schemas.ts`:
```ts
import { z } from 'zod'
const ModeId = z.enum(['ad', 'ar_hom', 'ar_comphet', 'xl', 'fallback'])
const Points = z.number().min(-20).max(20).refine((n) => Number.isInteger(n * 2), 'points must be in 0.5 steps')
const Text = z.string().min(1).max(500)
export const EvidenceRuleSchema = z.object({ id: z.string().regex(/^[a-z0-9_.-]{1,64}$/), label: z.string().min(1).max(120), when: Text, points: Points })
export const EvidenceGroupSchema = z.object({ id: z.string().regex(/^[a-z0-9_.-]{1,64}$/), label: z.string().min(1).max(120), scope: z.union([z.literal('global'), ModeId]), rules: z.array(EvidenceRuleSchema).min(1).max(20) })
export const ModeProfileSchema = z.object({ id: ModeId, label: z.string().min(1).max(120), when: Text.nullable(), points: Points })
export const EvidenceRulesetSchema = z.object({ version: z.literal(1), id: z.string().min(1).max(64), sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(), modes: z.array(ModeProfileSchema).min(1).max(5), groups: z.array(EvidenceGroupSchema).max(40) })
```
In `src/shared/types/ipc-schemas.ts` add `ruleset: EvidenceRulesetSchema.optional()` to `RankConfigSchema` (single import line + field). In `src/shared/types/shortlist.ts` add `ruleset?: EvidenceRuleset` to `RankConfig`.

- [ ] **Step 4: Implement `ruleset.ts`**

```ts
// src/main/services/scoring/evidence/ruleset.ts
import { compileRule, type RowPredicate } from '../../../../shared/dsl/evaluate'
import { EvidenceRulesetSchema } from '../../../../shared/types/evidence-ruleset-schemas'
import type { EvidenceRuleset, ModeId, ModeProfile, EvidenceGroup } from '../../../../shared/types/evidence-ruleset'
import type { ShortlistConfig } from '../../../../shared/types/shortlist'

export class EvidenceRulesetError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid evidence ruleset: ${problems.join('; ')}`)
    this.name = 'EvidenceRulesetError'
  }
}

export interface CompiledRule { id: string; label: string; points: number; test: RowPredicate }
export interface CompiledGroup { id: string; label: string; scope: EvidenceGroup['scope']; rules: CompiledRule[] }
export interface CompiledMode { profile: ModeProfile; test: RowPredicate | null }
export interface CompiledRuleset { source: EvidenceRuleset; modes: CompiledMode[]; groups: CompiledGroup[] }

const MAX_RULES = 200

function compileText(id: string, text: string, problems: string[]): RowPredicate {
  const r = compileRule(text)
  if (r.ok) return r.predicate
  problems.push(`${id}: ${r.errors.join(', ')}`)
  return () => false
}

function structuralProblems(rs: EvidenceRuleset): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const seen = (id: string): void => { if (ids.has(id)) problems.push(`duplicate id ${id}`); ids.add(id) }
  rs.modes.forEach((m) => seen(m.id))
  const fallbacks = rs.modes.filter((m) => m.id === 'fallback')
  if (fallbacks.length !== 1 || fallbacks[0].when !== null) problems.push('exactly one fallback mode with when=null is required')
  rs.modes.filter((m) => m.id !== 'fallback' && m.when === null).forEach((m) => problems.push(`${m.id}: when is required`))
  let count = 0
  for (const g of rs.groups) {
    seen(`group:${g.id}`)
    const signs = new Set(g.rules.map((r) => Math.sign(r.points)).filter((s) => s !== 0))
    if (signs.size > 1) problems.push(`group ${g.id} mixes positive and negative points`)
    if (g.scope !== 'global' && !rs.modes.some((m) => m.id === g.scope)) problems.push(`group ${g.id}: unknown mode ${g.scope}`)
    for (const r of g.rules) { seen(r.id); count += 1 }
  }
  if (count > MAX_RULES) problems.push(`more than ${MAX_RULES} rules`)
  return problems
}

export function compileRuleset(input: EvidenceRuleset): CompiledRuleset {
  const parsed = EvidenceRulesetSchema.safeParse(input)
  if (!parsed.success) {
    throw new EvidenceRulesetError(parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`))
  }
  const rs = parsed.data as EvidenceRuleset
  const problems = structuralProblems(rs)
  const modes = rs.modes.map((profile) => ({ profile, test: profile.when === null ? null : compileText(profile.id, profile.when, problems) }))
  const groups = rs.groups.map((g) => ({
    id: g.id, label: g.label, scope: g.scope,
    rules: g.rules.map((r) => ({ id: r.id, label: r.label, points: r.points, test: compileText(r.id, r.when, problems) }))
  }))
  if (problems.length > 0) throw new EvidenceRulesetError(problems)
  return { source: rs, modes, groups }
}

export function validateEvidenceConfig(config: ShortlistConfig): string[] {
  const problems: string[] = []
  const scope = config.variantTypeScope
  if (scope == null || scope.length === 0 || scope.some((t) => t !== 'snv' && t !== 'indel')) {
    problems.push("evidence presets must set variantTypeScope to ['snv'] and/or ['indel']")
  }
  const f = config.baseFilters as { inheritanceModes?: unknown[]; analysisGroupId?: unknown }
  if ((f.inheritanceModes?.length ?? 0) > 0) problems.push('inheritance modes are scored, not filtered, in evidence presets')
  if (f.analysisGroupId != null) problems.push('evidence presets do not support a family (analysisGroupId)')
  return problems
}

export type { ModeId }
```

- [ ] **Step 5: Implement `score.ts`**

```ts
// src/main/services/scoring/evidence/score.ts
import type { DerivedFields } from './case-context'
import type { CompiledRuleset, CompiledGroup } from './ruleset'
import type { EvidenceContribution, ModeId } from '../../../../shared/types/evidence-ruleset'

export interface EvidenceScore { score: number; mode: ModeId; contributions: EvidenceContribution[] }

function groupContribution(g: CompiledGroup, row: Record<string, unknown>): EvidenceContribution | null {
  for (const r of g.rules) {
    if (r.test(row)) return { kind: 'rule', id: r.id, label: r.label, group: g.id, points: r.points }
  }
  return null
}

export function scoreEvidenceRow(
  row: Record<string, unknown>,
  derived: DerivedFields,
  compiled: CompiledRuleset
): EvidenceScore {
  const view = { ...row, zygosity: derived.zygosity, gene_het_hits: derived.gene_het_hits, gene_hits: derived.gene_hits }
  const global: EvidenceContribution[] = []
  const byMode = new Map<string, EvidenceContribution[]>()
  for (const g of compiled.groups) {
    const c = groupContribution(g, view)
    if (c === null) continue
    if (g.scope === 'global') global.push(c)
    else byMode.set(g.scope, [...(byMode.get(g.scope) ?? []), c])
  }
  let best: EvidenceScore | null = null
  for (const m of compiled.modes) {
    if (m.test !== null && !m.test(view)) continue
    const contributions: EvidenceContribution[] = [
      { kind: 'mode', id: m.profile.id, label: m.profile.label, group: null, points: m.profile.points },
      ...global,
      ...(byMode.get(m.profile.id) ?? [])
    ]
    const score = contributions.reduce((sum, c) => sum + c.points, 0)
    if (best === null || score > best.score) best = { score, mode: m.profile.id, contributions }
  }
  // compileRuleset guarantees an always-eligible fallback, so best is set.
  return best as EvidenceScore
}
```
`index.ts` re-exports `compileRuleset`, `validateEvidenceConfig`, `EvidenceRulesetError`, `scoreEvidenceRow`, `GeneContextBuilder`, `deriveZygosity`, `alleleKey`, and the types.

Note the decision-list order in the test RS (`af_missing`, `af_1e5`, `af_1e3`): bins are exclusive by first match; tuned rulesets order bins from most to least specific.

- [ ] **Step 6: Run tests, expect PASS; run `make typecheck`.**

- [ ] **Step 7: Commit** — `feat(shortlist): evidence ruleset compiler and decision-list scoring`.

---

### Task 5: Two-pass evidence ranking in both shortlist services

**Files:**
- Create: `src/main/services/scoring/evidence/rank-page.ts`
- Modify: `src/main/database/ShortlistService.ts`, `src/main/database/createRepositories.ts`, `src/main/storage/postgres/PostgresShortlistService.ts`, `src/shared/types/shortlist.ts`
- Test: `tests/main/database/ShortlistService.evidence.test.ts`, `tests/main/services/scoring/evidence/rank-page.test.ts`, PostgreSQL: extend the existing opt-in PG shortlist test file (find with `grep -rl PostgresShortlistService tests/`)

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
```ts
// shortlist.ts additions
export interface ScoredRow { /* existing */ rank_mode?: ModeId; rank_evidence?: EvidenceContribution[]; rank_partners?: number[] }
// rank-page.ts
export function toLightRow(row: ShortlistCandidate): LightRow
export function scoreEvidencePage(page: ShortlistCandidate[], ctx: GeneContext, compiled: CompiledRuleset, rankConfig: RankConfig): ScoredCandidate[]
export function getCompiledRuleset(ruleset: EvidenceRuleset): CompiledRuleset // memoised by JSON text
// ShortlistService (SQLite) — internal, used by getShortlist and the harness
rankCase(params: GetShortlistParams, getGeneReference: GeneReferenceProvider, limit: number): ShortlistResult
```

- [ ] **Step 1: Failing service test (Review Focus 2, 4)**

`tests/main/database/ShortlistService.evidence.test.ts`, reusing the in-memory setup from `ShortlistService.test.ts` (copy its `insertCase` helper). Seed case 1 (`genome_build` GRCh38) with: an AR gene `GENEA` (`moi` 'AR') with one het SNV (id 1) and one het indel (id 2003, so it lands on a later page when `SHORTLIST_PAGE_SIZE` is temporarily small — use `vi.spyOn` is not possible on a const; instead seed 2,001 filler LOW rows in other genes between them so ids 1 and 2003 are on different pages of 2000), plus an AD gene het LoF and some fillers. Ad-hoc config with a small ruleset (modes as in Task 4 test) and `variantTypeScope: ['snv','indel']`, gate `{ maxGnomadAf: 0.01, consequences: ['HIGH','MODERATE','LOW'] }`.
Assertions:
1. Rows 1 and 2003 both have `rank_mode === 'ar_comphet'` and `rank_partners` containing each other.
2. `rank_score` equals the sum of `rank_evidence[].points` for every row.
3. A preset stored with `filter_json.shortlist.rankConfig.ruleset` containing `when: 'nope:=:1'` makes `getShortlist({caseId, presetId})` throw `DatabaseError` whose message contains the preset name and `nope` (Review Focus 4).
4. `adHocConfig` with `variantTypeScope: ['snv','sv']` and a ruleset throws `DatabaseError` mentioning `variantTypeScope`.
5. `rankCase(params, () => null, Infinity).rows.length === totalCandidates` and its first 50 rows equal `getShortlist` rows (same ids, same order).

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `rank-page.ts`**

```ts
// src/main/services/scoring/evidence/rank-page.ts
import type { ShortlistCandidate, ScoredCandidate, RankConfig } from '../../../../shared/types/shortlist'
import type { EvidenceRuleset } from '../../../../shared/types/evidence-ruleset'
import { compileRuleset, type CompiledRuleset } from './ruleset'
import { scoreEvidenceRow } from './score'
import type { GeneContext, LightRow } from './case-context'
import { mapClinvarBoost, ZERO_COMPONENTS } from '../index'

export function toLightRow(r: ShortlistCandidate): LightRow {
  return { id: r.id, chr: r.chr, pos: r.pos, ref: r.ref, alt: r.alt, gene_symbol: r.gene_symbol, gt_num: r.gt_num }
}

const cache = new Map<string, CompiledRuleset>()
export function getCompiledRuleset(ruleset: EvidenceRuleset): CompiledRuleset {
  const key = JSON.stringify(ruleset)
  let compiled = cache.get(key)
  if (compiled === undefined) {
    compiled = compileRuleset(ruleset)
    if (cache.size > 32) cache.clear()
    cache.set(key, compiled)
  }
  return compiled
}

export function scoreEvidencePage(
  page: ShortlistCandidate[], ctx: GeneContext, compiled: CompiledRuleset, rankConfig: RankConfig
): ScoredCandidate[] {
  return page.map((row) => {
    const derived = ctx.derived(toLightRow(row))
    const s = scoreEvidenceRow(row as unknown as Record<string, unknown>, derived, compiled)
    return {
      ...row,
      rank_score: s.score,
      rank_components: ZERO_COMPONENTS,
      rank_clinvar_pinned: rankConfig.clinvarPinTop === true && mapClinvarBoost(row.clinvar) >= 0.9,
      rank_starred_pinned: rankConfig.pinStarredTop === true && row.is_starred === true,
      rank_mode: s.mode,
      rank_evidence: s.contributions,
      rank_partners: s.mode === 'ar_comphet' ? derived.partners : []
    }
  })
}
```
If importing `../index` from `evidence/` creates a cycle (index re-exports evidence), move `mapClinvarBoost` and `ZERO_COMPONENTS` imports to their defining module or re-export evidence from a separate entry; keep `scoring/index.ts` from importing `evidence/`.

- [ ] **Step 4: SQLite service**

In `ShortlistService.ts`:
1. Extend `ShortlistStage1Dependencies` with `metadata: Pick<MetadataRepository, 'getCaseMetadata'>`; wire it in `createRepositories.ts` (pass the existing metadata repository instance).
2. Extract the current body of `getShortlist` into `rankCase(params, getGeneReference, limit)`; `getShortlist` becomes `return this.rankCase(params, getGeneReference, config.topN)` (resolve config once inside `rankCase`; `limit` replaces `config.topN` in `mergeTopScored`).
3. In `rankCase`, after resolving the config: `const ruleset = config.rankConfig.ruleset; if (ruleset != null) return this.rankEvidence(...)`.
4. `rankEvidence`:
```ts
  private rankEvidence(params: GetShortlistParams, config: ShortlistConfig, presetName: string | null,
                       getGeneReference: GeneReferenceProvider, limit: number, started: number): ShortlistResult {
    const problems = validateEvidenceConfig(config)
    let compiled: CompiledRuleset
    try {
      if (problems.length > 0) throw new EvidenceRulesetError(problems)
      compiled = getCompiledRuleset(config.rankConfig.ruleset!)
    } catch (e) {
      const label = presetName ? `Shortlist preset "${presetName}"` : 'Shortlist configuration'
      throw new DatabaseError(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    }
    const caseRow = this.stage1.cases.getCase(params.caseId)
    const sexRaw = this.stage1.metadata.getCaseMetadata(params.caseId)?.sex?.toLowerCase() ?? null
    const info = { build: caseRow?.genome_build ?? DEFAULT_PANEL_GENOME_BUILD,
                   sex: sexRaw === 'male' || sexRaw === 'female' ? sexRaw : null } as const
    const filters = config.variantTypeScope!.map((type) => {
      const f = toShortlistVariantFilter(params.caseId, type, { ...config.baseFilters, ...(config.perTypeOverrides?.[type] ?? {}) })
      this.resolvePanel(f, getGeneReference)
      return { type, filter: f }
    })
    const builder = new GeneContextBuilder(info)
    let total = 0
    const errors: Array<{ type: VariantTypeKey; error: Error }> = []
    for (const { type, filter } of filters) {
      try { forEachCandidatePage(this.stage1Source, filter, SHORTLIST_PAGE_SIZE, (page) => { total += page.length; builder.add(page.map(toLightRow)) }) }
      catch (e) { errors.push({ type, error: toError(e) }) }
    }
    if (errors.length > 0) throwShortlistQueryErrors(errors, 'shortlist')
    const ctx = builder.build()
    let kept: ScoredCandidate[] = []
    for (const { filter } of filters) {
      forEachCandidatePage(this.stage1Source, filter, SHORTLIST_PAGE_SIZE, (page) => {
        kept = mergeTopScored(kept, scoreEvidencePage(page, ctx, compiled, config.rankConfig), limit, config.tieBreakers)
      })
    }
    ...build ShortlistResult as the legacy path does (rank = i+1, log line, elapsedMs)
  }
```
`resolveConfig` must return the preset name (it already returns `presetUsed`). `mergeTopScored` with `limit = Infinity` keeps all rows. Keep the file ≤ 600 lines; if it exceeds, move `rankEvidence` into `src/main/database/shortlist-evidence.ts` as a function taking `(source, stage1, params, config, ...)`.

- [ ] **Step 5: PostgreSQL service**

Mirror Step 4 in `PostgresShortlistService.ts`: extract the per-type streaming loop into `private async streamPages(filter, onPage: (rows: ShortlistCandidate[]) => void)` (uses `streamVariantRows` + `hydrateCandidates` in `SHORTLIST_PAGE_SIZE` chunks); legacy path uses it once, evidence path twice. Case info via `this.options.pool.query(\`SELECT c.genome_build, cm.sex FROM ${schema}."cases" c LEFT JOIN ${schema}."case_metadata" cm ON cm.case_id = c.id WHERE c.id = $1\`, [caseId])`. Same validation and `DatabaseError` wording.

- [ ] **Step 6: Run SQLite tests; run the PG test with a local database**

Run: `make rebuild-node && npx vitest run tests/main/database/ShortlistService.evidence.test.ts tests/main/database/ShortlistService.test.ts tests/main/services/scoring`
Then PG: `make pg-up` (see AGENTS.md; port per `.env.postgres.local`), run the PG shortlist test file with its opt-in env var, assert ordered equality of ids and `rank_score` between SQLite and PostgreSQL for the evidence ad-hoc config on the same seeded case.
Expected: PASS.

- [ ] **Step 7: Commit** — `feat(shortlist): two-pass evidence ranking on both backends`.

---

### Task 6: Renderer — points display and evidence tooltip

**Files:**
- Modify: `src/renderer/src/components/shortlist/ShortlistTable.vue`, `src/renderer/src/components/shortlist/RankScoreTooltip.vue`
- Test: existing renderer tests for these components (`grep -rl RankScoreTooltip tests/renderer`) + new cases

**Interfaces:** consumes `rank_mode`, `rank_evidence`, `rank_partners` from Task 5.

- [ ] **Step 1: Failing renderer tests**
1. Row with `rank_evidence` → score cell text `+12.5` (signed, 1 decimal); legacy row → `0.73` (unchanged `toFixed(2)`).
2. Tooltip with evidence lists mode label first and each contribution `label  +points`; with `rank_partners: [7]` shows "Possible compound heterozygous (with 1 other variant)".
3. Legacy tooltip unchanged (existing snapshot/assertions pass).

- [ ] **Step 2: Implement.** `ShortlistTable.vue` cell: `item.rank_evidence ? formatPoints(item.rank_score) : item.rank_score.toFixed(2)` with `formatPoints = (n) => (n > 0 ? '+' : '') + n.toFixed(1)` placed in `src/renderer/src/utils/` next to similar formatters (grep `toFixed` utils first; reuse if a signed formatter exists). Tooltip: new prop `evidence?: EvidenceContribution[]`, `mode?: string`, `partners?: number[]`; when `evidence` is present render the list (dense list, existing tooltip styles; no `surface-variant`); else the current five components. Load the `varlens-ui-patterns` skill before editing.

- [ ] **Step 3: Run renderer tests; build dev and check the tooltip visually** with a seeded case (use the `run` skill / `make dev`), screenshot both themes.

- [ ] **Step 4: Commit** — `feat(shortlist): show evidence points and contributions`.

---

### Task 7: Public ClinVar pool (patient-independent)

**Files:**
- Create: `scripts/shortlist-sim/pool/clinvar-vcf.ts` (streaming parser), `scripts/shortlist-sim/pool/hpoa.ts` (disease → MOI), `scripts/shortlist-sim/pool/select-pool.ts` (CLI), `scripts/shortlist-sim/common/paths.ts`, `scripts/shortlist-sim/common/rng.ts`
- Test: `tests/scripts/shortlist-sim/pool/select-pool.test.ts`, fixtures `tests/test-data/shortlist-sim/clinvar-mini.vcf`, `tests/test-data/shortlist-sim/hpoa-mini.tsv`

**Interfaces:**
- Produces file `_data/shortlist-sim/pool/pool.json`:
```ts
export interface PoolVariant {
  key: string                       // chr:pos:ref:alt as in ClinVar (pre-normalisation)
  chr: string; pos: number; ref: string; alt: string
  gene: string; clinvarId: string; clnsig: string; revstat: string
  label: 'plp' | 'benign'
  moi: 'AD' | 'AR' | 'XLD' | 'XLR' | null   // null only for benign
  diseaseIds: string[]              // OMIM:/ORPHA: ids from CLNDISDB used for MOI
  newSince2024: boolean             // absent or not P/LP in clinvar_20240107
}
export interface PoolFile { clinvarRelease: string; hpoaRelease: string; seed: number; funnel: Record<string, number>; variants: PoolVariant[] }
export function rng(seed: number): () => number   // mulberry32, common/rng.ts
```

- [ ] **Step 1: Write fixtures + failing test.** `clinvar-mini.vcf`: header with the real `##INFO` lines for CLNSIG, CLNREVSTAT, ORIGIN, CLNDISDB, CLNDN, GENEINFO, CLNVC copied from the local ClinVar header (`zcat …clinvar.vcf.gz | grep '^##INFO'`), and ~14 records covering: P with 2 stars ORIGIN=1 (keep), LP expert panel ORIGIN=16 (keep), P single submitter (drop), P ORIGIN=2 somatic (drop), P ORIGIN=8 unknown-only (drop), P ORIGIN=3 (germline+somatic → drop), `Pathogenic|risk_factor` (drop), `Conflicting…` (drop), two genes in GENEINFO (drop), 60-bp deletion (drop), CLNDN not_provided only (drop), disease with AD+AR in hpoa (drop as ambiguous), benign 2 stars (keep as decoy), XLR disease (keep). `hpoa-mini.tsv`: header lines + rows `OMIM:1	…	HP:0000006` (AD), `HP:0000007` (AR), `HP:0001419` (XLR), `HP:0001423` (XLD), with `aspect` `I` (inheritance rows are aspect I in phenotype.hpoa).
Test asserts the exact kept keys, `moi`, and every funnel counter.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Rules exactly as spec §4.2:
```ts
const PLP = new Set(['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic'])
const BENIGN = new Set(['Benign', 'Likely_benign', 'Benign/Likely_benign'])
const TWO_STAR = new Set(['criteria_provided,_multiple_submitters,_no_conflicts', 'reviewed_by_expert_panel', 'practice_guideline'])
const GERMLINE_BITS = 1 | 4 | 16 | 32 | 64 | 128 | 256 | 512
const SOMATIC_BIT = 2
const SMALL_CLASSES = new Set(['single_nucleotide_variant', 'Deletion', 'Insertion', 'Duplication', 'Indel'])
const MOI_TERMS: Record<string, 'AD' | 'AR' | 'XLD' | 'XLR'> = { 'HP:0000006': 'AD', 'HP:0000007': 'AR', 'HP:0001423': 'XLD', 'HP:0001419': 'XLR' }
```
`origin = Number(info.ORIGIN ?? '1')`; keep when `(origin & GERMLINE_BITS) !== 0 && (origin & SOMATIC_BIT) === 0`. Size: `Math.max(ref.length, alt.length) <= 51` and `alt` not `.`/`N`. Disease ids from `CLNDISDB` (split on `|` and `,`; keep `OMIM:\d+` and `Orphanet:\d+` → `ORPHA:`). MOI = union of hpoa inheritance terms over the disease ids; exactly one value required (P/LP only). `newSince2024`: stream `clinvar_20240107.vcf.gz` once into a `Set` of P/LP keys (same CLNSIG set). Sampling: group P/LP by gene, shuffle with `rng(seed)`, take ≤ 3 per gene, then stratify to targets `{AD: 1300, AR: 1800, XLD: 300, XLR: 300}` (take all if fewer); decoys ≤ 2 per gene up to 2000. CLI: `npx jiti scripts/shortlist-sim/pool/select-pool.ts --seed 20261012` reading paths from `common/paths.ts` (`PUBLIC_DIR = _data/shortlist-sim/public`, local ClinVar path from the annotation workflow). Print the funnel.

- [ ] **Step 4: Tests pass. Run the CLI on the real files; record the funnel in the commit message body.**

- [ ] **Step 5: Commit** — `feat(shortlist-sim): patient-independent ClinVar pool`.

---

### Task 8: Allele normalisation (bcftools)

**Files:**
- Create: `scripts/shortlist-sim/annotate/normalize.ts`
- Test: `tests/scripts/shortlist-sim/annotate/normalize.test.ts` (skips with a clear message when `bcftools` or the FASTA is absent)

**Interfaces:**
```ts
export interface NormalizedAllele { input: string; chr: string; pos: number; ref: string; alt: string; key: string; status: 'ok' | 'ref_mismatch' | 'multiallelic' | 'error' }
export async function normalizeAlleles(alleles: Array<{ key: string; chr: string; pos: number; ref: string; alt: string }>, opts?: { fasta?: string; tmpDir?: string }): Promise<NormalizedAllele[]>
export const GRCH38_FASTA: string // from paths.ts: the annotation workflow's VEP cache FASTA
```

- [ ] **Step 1: Failing test** — input: a right-shifted deletion in a homopolymer of chr1 (pick from the FASTA in the test: read 30 bp with `samtools faidx`, construct `ref=AA alt=A` at the last A), a correct SNV, a REF-mismatch SNV. Expect: deletion left-shifted to the first A of the run, SNV unchanged `ok`, mismatch `ref_mismatch`.
- [ ] **Step 2: Implement:** write a temp VCF (header `##fileformat=VCFv4.2`, contig lines for used chromosomes, `#CHROM…`), `ID` = input key; run `bcftools norm -f <fasta> -c x -m -any --old-rec-tag OLD -Ov` via `mamba run -n varlens-annotate` (or the env's `bin/bcftools` absolute path); records dropped by `-c x` → `ref_mismatch`; map output by ID; multiallelic inputs are not produced by the pool (assert). `key = ${chr}:${pos}:${ref}:${alt}` without `chr` prefix.
- [ ] **Step 3: Tests pass; commit** — `feat(shortlist-sim): bcftools allele normalisation`.

---

### Task 9: Spike annotation — genefoundry fetcher + local VEP cross-check

**Files:**
- Create: `scripts/shortlist-sim/annotate/genefoundry.ts` (JSON-RPC client), `scripts/shortlist-sim/annotate/fetch-annotations.ts` (CLI), `scripts/shortlist-sim/annotate/local-vep.ts` (offline VEP runner shared with Task 10)
- Test: `tests/scripts/shortlist-sim/annotate/genefoundry.test.ts` (mocked `fetch`), `tests/scripts/shortlist-sim/annotate/local-vep.test.ts` (parser on a canned VEP JSON line)

**Interfaces:**
```ts
// genefoundry.ts
export async function callTool<T>(server: 'vep-link' | 'gnomad-link', name: string, args: object, opts?: { retries?: number; timeoutMs?: number }): Promise<T>
// fetch-annotations.ts output: _data/shortlist-sim/cache/genefoundry/<sha1(key)>.json  = SpikeAnnotation
export interface SpikeAnnotation {
  key: string
  vep: { mostSevere: string; consequenceTerms: string[]; transcript: string | null; isMane: boolean; hgvsc: string | null; hgvsp: string | null; gene: string | null; caddPhred: number | null } | null
  gnomad: { exomeAf: number | null; genomeAf: number | null; jointAf: number | null; popmaxAf: number | null; dataset: string } | null
  fetchedAt: string; errors: string[]
}
// local-vep.ts
export interface LocalVepRecord { key: string; mostSevere: string; impact: string; terms: string[]; transcript: string | null; caddPhred: number | null; gnomadJointAf: number | null; gnomadExomeAf: number | null; gnomadGenomeAf: number | null; popmaxAf: number | null }
export async function runLocalVep(alleles: Array<{ key: string; chr: string; pos: number; ref: string; alt: string }>, outDir: string): Promise<LocalVepRecord[]>
```

- [ ] **Step 1: Inspect the endpoints** (cheap, record in `scripts/shortlist-sim/annotate/README.md`): `get_capabilities` of vep-link — find whether `annotate_variants_batch` accepts a transcript-selection argument (prefer MANE Select) and which fields `representative_transcript` uses; `get_server_capabilities` of gnomad-link — dataset ids and the joint/popmax fields in `get_variant_frequencies`.
- [ ] **Step 2: Failing client test:** `fetch` mocked to return a 502 then a valid `{"jsonrpc":"2.0","id":2,"result":{"structuredContent":{…}}}`; expect one retry and the parsed `structuredContent`; a JSON-RPC `error` raises with the server message; `content[0].text` JSON is used when `structuredContent` is absent.
- [ ] **Step 3: Implement `callTool`:** `POST https://${server}.genefoundry.org/mcp`, headers `Content-Type: application/json`, `Accept: application/json, text/event-stream`, body `{ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args } }`; strip a leading `data: ` line prefix if SSE; retries with exponential backoff (1 s, 2 s, 4 s, 8 s; max 5) on network errors, 429 and 5xx; `AbortSignal.timeout(timeoutMs ?? 180_000)`.
- [ ] **Step 4: Implement the fetcher CLI:** read `pool.json` + normalised keys; call `check_upstream_health` first (abort with a message when GRCh38 is down); VEP in batches of 200 (≤ 2 concurrent batches), gnomAD per variant with a concurrency pool of 6; write one cache file per key (skip existing → resumable); summary of errors at the end. Patient data is never read in this script (assert: the script imports nothing from `sim/`).
- [ ] **Step 5: Implement `local-vep.ts`:** write a VCF of the alleles, run (paths from `paths.ts`; copy flags from `../varlens-annotation-workflows/workflow/main.nf`'s VEP process):
```bash
mamba run -n varlens-annotate vep --offline --cache --dir_cache <vep_cache> --cache_version 115 --assembly GRCh38 \
  --fasta <fasta> --input_file in.vcf --output_file out.json --json --force_overwrite --fork 8 \
  --everything --mane --pick_order mane_select,canonical,appris,tsl,biotype,ccds,rank,length --flag_pick \
  --plugin dbNSFP,<dbnsfp_file>,CADD_phred,gnomAD4.1_joint_AF,gnomAD4.1_joint_POPMAX_AF
```
Parse JSON lines: take the `pick`-flagged transcript consequence; `impact`, `consequence_terms`, `most_severe_consequence`; dbNSFP fields (string, `.` = null; multiple values joined by `,` → take max); exome/genome AF from `colocated_variants[].frequencies[alt]` keys `gnomade`/`gnomadg`. Unit-test the parser on one canned JSON line committed as a fixture.
- [ ] **Step 6: Run the fetcher on the real pool; run `runLocalVep` on the pool; write `_data/shortlist-sim/cache/pool-local-vep.json`. Commit code + the frozen genefoundry cache copied to `tests/test-data/shortlist-sim/spikes/` (public data, gzip-compressed JSONL) with `manifest.json` (ClinVar release, hpoa release, endpoints, date).**
- [ ] **Step 7: Commit** — `feat(shortlist-sim): genefoundry spike annotation with local VEP cross-check`.

---

### Task 10: Offline concordance study (varvis ↔ local VEP) and the vocabulary projection

**Files:**
- Create: `scripts/shortlist-sim/concordance/load-backgrounds.ts` (varvis JSON via production `ObjectFormatMapper`), `scripts/shortlist-sim/concordance/concordance.ts` (CLI), `scripts/shortlist-sim/annotate/project-varvis.ts` (VEP → varvis projection)
- Test: `tests/scripts/shortlist-sim/annotate/project-varvis.test.ts`, `tests/scripts/shortlist-sim/concordance/concordance.test.ts` (on a committed **synthetic** background)

**Interfaces:**
```ts
// load-backgrounds.ts
export interface Background { caseLabel: string; rows: MappedVariant[] }   // MappedVariant = ObjectFormatMapper output row type
export function loadBackgrounds(dir?: string): Background[]               // dir default from VARLENS_SIM_BACKGROUND_DIR
// concordance output (aggregate only): _data/shortlist-sim/runs/<run>/concordance.json and a committed copy under .planning/artifacts/shortlist-sim/concordance.json
export interface ConcordanceReport {
  sites: number; matched: number
  funcMapping: Array<{ vepTerm: string; varvisFunc: string; count: number }>     // counts only
  impactByFunc: Array<{ varvisFunc: string; impact: string; count: number }>
  afField: Array<{ field: 'joint' | 'exome' | 'genome' | 'popmax'; medianAbsLog10Err: number; n: number }>
  cadd: { n: number; medianAbsErr: number; pearson: number }
  missingness: Array<{ field: string; varvisMissing: number; localMissing: number }>
}
// project-varvis.ts
export interface VarvisProjection { func: string | null; consequence: string | null; reason: 'empirical' | 'identity' | 'unmapped' }
export function projectToVarvis(vepMostSevere: string, terms: string[], mapping: ConcordanceReport['funcMapping'], impactByFunc: ConcordanceReport['impactByFunc'], allele: { ref: string; alt: string }): VarvisProjection
```

- [ ] **Step 1: Synthetic background fixture** `tests/test-data/shortlist-sim/synthetic-background.json.gz` (varvis JSON shape, 200 fabricated rows on real-looking coordinates of public genes; no patient data) + failing tests: projection uses the most frequent varvis term for a VEP term when its support ≥ 5 and share ≥ 0.6, `identity` when the VEP term occurs verbatim in varvis vocabulary, else `unmapped`; equal-length multi-base substitutions map to `mnv` only if `mnv` is the empirical mapping for VEP `missense_variant`/`synonymous_variant` at such alleles (else unmapped); IMPACT always from `impactByFunc` majority.
- [ ] **Step 2: Implement `loadBackgrounds`** with the production mapper: read `.json.gz`, `ObjectFormatMapper` (find its public entry; it maps the varvis variant list into DB rows), keep only mapped rows; `caseLabel` = `bg1..bg3` (never the LIMS id) — ordering by file name.
- [ ] **Step 3: Implement the CLI:** for each background: normalise alleles (Task 8), `runLocalVep` (Task 9) **locally**, join by normalised key, compute the report. Only the aggregate `ConcordanceReport` is written; temporary VCF/JSON go to `_data/shortlist-sim/cache/private/` (outside the repo) and are deleted at the end unless `--keep-private`. Also assert gene-level constancy of `hpo_sim_score`/`moi`/`omim_mim_number` per gene and record the result.
- [ ] **Step 4: Tests pass; run on the real backgrounds; copy the aggregate report to `.planning/artifacts/shortlist-sim/concordance.json`; inspect: choose the AF field with the smallest median log10 error (document in the report) — this choice is frozen for spikes.**
- [ ] **Step 5: Commit** — `feat(shortlist-sim): offline varvis concordance and vocabulary projection`.

---

### Task 11: Case construction and scenarios

**Files:**
- Create: `scripts/shortlist-sim/sim/background-db.ts`, `scripts/shortlist-sim/sim/spikes.ts`, `scripts/shortlist-sim/sim/cases.ts`, `scripts/shortlist-sim/sim/scenarios.ts`
- Test: `tests/scripts/shortlist-sim/sim/*.test.ts` using the synthetic background

**Interfaces:**
```ts
// background-db.ts
export interface BackgroundDb { db: Database; caseId: number; label: string; repos: Repositories; genes: Set<string>; geneFields: Map<string, { omim_mim_number: string | null; moi: string | null; hpo_sim_score: number | null }>; encodings: EncodingStats }
export function openBackgroundDb(bg: Background, scenario: ScenarioId, seed: number): BackgroundDb   // in-memory, production schema+migrations+insertBatch
// spikes.ts
export interface SpikeRow { poolKey: string; role: 'causal' | 'decoy'; row: VariantInsert }   // VariantInsert = VariantRepository insert shape
export function spikeRow(pv: PoolVariant, ann: SpikeAnnotation, proj: VarvisProjection, bg: BackgroundDb, zyg: 'het' | 'hom', rnd: () => number, afField: AfField): SpikeRow | null
// cases.ts
export type CaseMode = 'AD' | 'AR_HOM' | 'AR_COMPHET' | 'XLD'
export interface SimCase { id: string; bg: string; mode: CaseMode; causal: SpikeRow[]; decoys: SpikeRow[]; gene: string; consequenceClass: 'lof' | 'missense' | 'inframe' | 'other'; newSince2024: boolean }
export function buildCases(pool: PoolFile, anns: Map<string, SpikeAnnotation>, bgs: BackgroundDb[], seed: number): SimCase[]
// scenarios.ts
export type ScenarioId = 'primary' | 'clinvar_visible' | 'pheno_free' | 'pheno_shuffled' | 'missingness' | 'pheno_enriched'
export function applyScenarioToBackground(rows: MappedVariant[], s: ScenarioId, rnd: () => number): MappedVariant[]
export function applyScenarioToSpike(row: VariantInsert, s: ScenarioId, bg: BackgroundDb, rnd: () => number): VariantInsert
```

- [ ] **Step 1: Failing tests:** (a) `openBackgroundDb` row count equals mapped rows; `impact_rank`/`clinvar_rank` set as by production import. (b) `primary` masks `clinvar` on background and spike rows; `pheno_free` nulls `hpo_sim_score` everywhere; `pheno_shuffled` permutes gene-level `hpo_sim_score` across genes (multiset preserved, constant within gene). (c) A spike whose normalised key equals a background allele → `spikeRow` returns null. (d) AR_COMPHET cases use two different keys with the same disease id; both het. (e) Genotype encodings: over 10,000 sampled het SNV spikes the share of `./1`+`1/.` matches the background share within 1 % (seeded). (f) Gene fields copied from the background; AD-mode spike in a gene absent from the background is never built. (g) Decoys: exactly 10 per case, benign, background genes, not colliding. (h) Cases restricted to genes in that background; MOI from `PoolVariant.moi`; XLR excluded and counted.
- [ ] **Step 2: Implement.** Spike row: `chr/pos/ref/alt` normalised; `gene_symbol` = pool gene; `func`/`consequence` = projection (skip if `unmapped`, counted); `cadd` = genefoundry CADD; `gnomad_af` = frozen AF field; `clinvar` = pool `clnsig` (scenario may mask); `gt_num` sampled from `bg.encodings` by class and zygosity; `qual` sampled likewise; gene-level fields from `bg.geneFields`; `transcript/cdna/aa_change` from VEP; `variant_type` `snv` when both alleles length 1, else `indel`. Insert via the production `VariantRepository.insertBatch` inside `db.transaction` with a SAVEPOINT that `run.ts` rolls back. Background-level scenarios applied before insert (one DB per background × scenario).
- [ ] **Step 3: Tests pass; commit** — `feat(shortlist-sim): simulated cases and scenarios`.

---

### Task 12: Runner, metrics, tuning, statistics

**Files:**
- Create: `scripts/shortlist-sim/sim/run-case.ts`, `scripts/shortlist-sim/sim/worker.ts`, `scripts/shortlist-sim/stats/metrics.ts`, `scripts/shortlist-sim/stats/bootstrap.ts`, `scripts/shortlist-sim/stats/tune.ts`, `scripts/shortlist-sim/stats/folds.ts`, `scripts/shortlist-sim/scorers.ts`, `scripts/shortlist-sim/rulesets/hand-v0.ts`, `scripts/shortlist-sim/run.ts`
- Test: `tests/scripts/shortlist-sim/stats/*.test.ts`, `tests/scripts/shortlist-sim/sim/run-case.test.ts`

**Interfaces:**
```ts
// scorers.ts
export interface ScorerDef { id: string; config: (fold: number) => ShortlistConfig }   // ad-hoc configs only
export const BASE_SCORERS: ScorerDef[]  // tier1, all_rare_damaging, cadd_desc, af_asc, evidence_hand, evidence_tuned, ablations…, same-gate pairs
// run-case.ts
export interface CaseResult { caseId: string; scorer: string; scenario: ScenarioId; fold: number; ranks: Array<number | null>; tieAvgHit: Record<number, number>; tieAvgRecip: number; decoysTop10: number; eligible: number; causalEligible: boolean[] }
export function runCase(bgDb: BackgroundDb, c: SimCase, scorers: ScorerDef[], scenario: ScenarioId, fold: number): CaseResult[]
// metrics.ts
export function hitAtK(ranks: Array<number | null>, k: number, mode: CaseMode): 0 | 1   // comphet: all ranks ≤ k
export function tieAveragedHit(higher: number, equal: number, k: number): number          // P(rank ≤ k) under random tie order
export function tieAveragedReciprocal(higher: number, equal: number): number              // E[1/rank]
export function macroAverage(results: CaseResult[], metric: (r: CaseResult) => number, classOf: (r: CaseResult) => string): number
// folds.ts
export function geneFolds(genes: string[], k: number, seed: number): Map<string, number>
// tune.ts
export interface BinCounts { rule: string; a: number; A: number; b: number; B: number }
export function tunePoints(groups: Array<{ id: string; bins: BinCounts[]; residual: { a: number; b: number } }>, A: number, B: number): Map<string, number>
export function tuneRuleset(template: EvidenceRuleset, positives: TuneRow[], background: TuneRow[]): { ruleset: EvidenceRuleset; support: BinCounts[] }
// bootstrap.ts
export function clusterBootstrap<T>(items: T[], clusterOf: (t: T) => string, stat: (sample: T[]) => number, reps: number, seed: number): { estimate: number; lo: number; hi: number }
```

- [ ] **Step 1: Failing metric tests** (exact values):
```ts
expect(tieAveragedHit(0, 20, 10)).toBeCloseTo(0.5)           // 20 tied leaders, k=10
expect(tieAveragedHit(9, 1, 10)).toBe(1)
expect(tieAveragedHit(10, 5, 10)).toBe(0)
expect(tieAveragedReciprocal(0, 2)).toBeCloseTo((1 + 1 / 2) / 2)
expect(hitAtK([3, 40], 10, 'AR_COMPHET')).toBe(0)
expect(hitAtK([3, 9], 10, 'AR_COMPHET')).toBe(1)
expect(hitAtK([null], 10, 'AD')).toBe(0)
```
`tunePoints` test: group with bins {x: a=30,b=10}, {y: a=10,b=40}, residual {a=60,b=950}, A=100, B=1000, K=2 → `points(x) = round2(log2(((31)/(103))/((11)/(1003))) − log2(((61)/(103))/((951)/(1003))))` where `round2(v)=Math.round(v*2)/2` clipped ±8; assert the numeric values. `clusterBootstrap` determinism: same seed → same interval; clusters resampled whole (test with two clusters of very different means).
- [ ] **Step 2: Implement metrics, folds (sort genes, shuffle with `rng(seed)`, round-robin), bootstrap (percentile, 2,000 reps), tune (spec §5.2 formula; residual = rows where no rule in the group fired; bins evaluated with the production compiled predicates in decision-list order; mode points over {ad, ar_hom, ar_comphet, xl, fallback} using the winning-mode eligibility only). `tuneRuleset` excludes test-fold genes from both positives and background (`TuneRow` carries `gene`).**
- [ ] **Step 3: `hand-v0.ts`** — the hand-set ruleset (also the tuning template):
```ts
export const HAND_V0: EvidenceRuleset = {
  version: 1, id: 'varvis-hand-v0',
  modes: [
    { id: 'ar_hom', label: 'Recessive, homozygous', when: 'moi:~:AR AND zygosity:=:hom', points: 3 },
    { id: 'ar_comphet', label: 'Recessive, possible compound het', when: 'moi:~:AR AND zygosity:=:het AND gene_het_hits:>=:2', points: 2 },
    { id: 'xl', label: 'X-linked', when: 'chr:=:X AND (moi:~:XR OR moi:~:XD OR moi:~:X-linked) AND (zygosity:=:hemi OR zygosity:=:hom OR moi:~:XD)', points: 2 },
    { id: 'ad', label: 'Dominant, heterozygous', when: 'moi:~:AD AND zygosity:=:het', points: 1 },
    { id: 'fallback', label: 'No compatible inheritance', when: null, points: -1 }
  ],
  groups: [
    { id: 'freq', label: 'Population frequency', scope: 'global', rules: [
      { id: 'af_missing', label: 'Not in gnomAD', when: 'gnomad_af:is:null', points: 3 },
      { id: 'af_lt_1e5', label: 'AF < 0.001%', when: 'gnomad_af:<:0.00001', points: 4 },
      { id: 'af_lt_1e4', label: 'AF < 0.01%', when: 'gnomad_af:<:0.0001', points: 3 },
      { id: 'af_lt_1e3', label: 'AF < 0.1%', when: 'gnomad_af:<:0.001', points: 2 },
      { id: 'af_lt_1e2', label: 'AF < 1%', when: 'gnomad_af:<:0.01', points: 0 } ] },
    { id: 'effect', label: 'Variant effect', scope: 'global', rules: [
      { id: 'lof', label: 'Loss of function', when: 'func:=:stop_gained OR func:=:frameshift_truncation OR func:=:frameshift_elongation OR func:=:frameshift_variant OR func:=:splice_acceptor_variant OR func:=:splice_donor_variant OR func:=:start_lost OR func:=:stop_lost', points: 5 },
      { id: 'missense', label: 'Missense', when: 'func:=:missense_variant', points: 2 },
      { id: 'inframe', label: 'In-frame indel', when: 'func:=:inframe_indel', points: 2 },
      { id: 'splice_region', label: 'Splice region', when: 'func:=:splice_region_variant', points: 1 },
      { id: 'mnv', label: 'Multi-nucleotide', when: 'func:=:mnv', points: 1 },
      { id: 'other_effect', label: 'Other', when: 'func:is:notnull', points: 0 } ] },
    { id: 'cadd', label: 'CADD', scope: 'global', rules: [
      { id: 'cadd_30', label: 'CADD ≥ 30', when: 'cadd:>=:30', points: 3 },
      { id: 'cadd_25', label: 'CADD ≥ 25', when: 'cadd:>=:25', points: 2 },
      { id: 'cadd_20', label: 'CADD ≥ 20', when: 'cadd:>=:20', points: 1 },
      { id: 'cadd_15', label: 'CADD ≥ 15', when: 'cadd:>=:15', points: 0 } ] },
    { id: 'clinvar_plp', label: 'ClinVar pathogenic', scope: 'global', rules: [
      { id: 'clinvar_plp', label: 'ClinVar P/LP', when: 'clinvar:=:Pathogenic OR clinvar:=:Likely_pathogenic OR clinvar:=:Pathogenic/Likely_pathogenic', points: 6 },
      { id: 'clinvar_vus', label: 'ClinVar VUS', when: 'clinvar:=:Uncertain_significance', points: 1 } ] },
    { id: 'clinvar_benign', label: 'ClinVar benign', scope: 'global', rules: [
      { id: 'clinvar_blb', label: 'ClinVar B/LB', when: 'clinvar:=:Benign OR clinvar:=:Likely_benign OR clinvar:=:Benign/Likely_benign', points: -4 } ] },
    { id: 'phenotype', label: 'Phenotype match', scope: 'global', rules: [
      { id: 'hpo_15', label: 'HPO similarity ≥ 0.15', when: 'hpo_sim_score:>=:0.15', points: 4 },
      { id: 'hpo_10', label: 'HPO similarity ≥ 0.10', when: 'hpo_sim_score:>=:0.1', points: 3 },
      { id: 'hpo_05', label: 'HPO similarity ≥ 0.05', when: 'hpo_sim_score:>=:0.05', points: 2 },
      { id: 'hpo_gt0', label: 'HPO similarity > 0', when: 'hpo_sim_score:>:0', points: 1 } ] },
    { id: 'gene', label: 'Disease gene', scope: 'global', rules: [
      { id: 'omim_gene', label: 'OMIM disease gene', when: 'omim_mim_number:is:notnull', points: 2 } ] },
    { id: 'ad_freq', label: 'Frequency for dominant', scope: 'ad', rules: [
      { id: 'ad_af_gt_1e4', label: 'Too common for dominant', when: 'gnomad_af:>:0.0001', points: -3 } ] }
  ]
}
```
(The `clinvar_plp` group mixes +6 and +1 — same sign, allowed. `ad_freq` is mode-scoped and negative only.) Verify every `when` compiles in a test (`compileRuleset(HAND_V0)` does not throw).
- [ ] **Step 4: `runCase`:** open a SAVEPOINT, insert causal + decoy spike rows, call `bgDb.repos.shortlistService.rankCase({ caseId, adHocConfig: scorer.config(fold) }, () => null, Infinity)` once per distinct gate config is NOT possible (different rankConfig) — call once per scorer (exome sizes make this fast); compute for each causal row: production rank (index+1 in `rows`) or null if absent; tie stats: `higher` = rows in an earlier pin partition or with greater `rank_score`, `equal` = same partition and score minus itself; decoys in top 10; ROLLBACK. Legacy scorers on the same API (`rankConfig.weights`, no ruleset).
- [ ] **Step 5: `run.ts` CLI** (`npx jiti scripts/shortlist-sim/run.ts --run <name> [--quick]`): load pool/annotations/concordance; build backgrounds × scenarios; build cases; assign folds by gene; for each fold: tune `evidence_tuned` on training-fold rows (positives: the causal spike rows of training cases after the gate; background: eligible background rows of training genes) → fold ruleset; distribute (case × scenario) jobs over a `worker_threads` pool of `min(6, os.availableParallelism())` (`--workers` overrides), each worker opening its own background DBs; collect `CaseResult[]` to `runs/<run>/results.jsonl`; `--quick` = 1 background, 50 cases, 200 bootstrap reps. Final step: refit the tuned ruleset on all folds → `runs/<run>/ruleset-tuned.json` with `sha256` of its canonical JSON.
- [ ] **Step 6: run-case test on the synthetic background** (2 causal + decoys, hand ruleset): ranks are integers, rollback leaves the variant count unchanged, and `rankCase` top-50 equals `getShortlist` rows for the same config (production-path equality).
- [ ] **Step 7: Tests pass; `--quick` run on real data completes; commit** — `feat(shortlist-sim): runner, metrics, tuning and cluster bootstrap`.

---

### Task 13: Report

**Files:**
- Create: `scripts/shortlist-sim/report/report.ts`, `scripts/shortlist-sim/report/svg.ts`; Makefile target `shortlist-sim`
- Test: `tests/scripts/shortlist-sim/report/report.test.ts` (renders from a tiny canned results file; asserts sections and that no row-level background data appears: no `chr:pos` patterns from backgrounds — check against the synthetic background keys)

- [ ] **Step 1: Load the `dataviz` skill before writing chart code.**
- [ ] **Step 2: Implement `report.ts`:** reads `results.jsonl`, concordance, pool funnel, support tables → `.planning/artifacts/shortlist-sim/<run>/report.md` + SVGs: (1) rank CDF per scorer (primary scenario), (2) Hit@k bars with 95 % CI per scorer, (3) per-mode and per-class Hit@10 table, (4) per-background table, (5) scenario table, (6) decoy intrusion, (7) filter sensitivity/burden, (8) tuned points with support and intervals, (9) ablations, (10) concordance summary, (11) selection funnel, (12) ship-criterion verdict computed from the pre-registered rule (§5.5) with the exact bounds. Every number with its interval; no row-level background data.
- [ ] **Step 3: Makefile:**
```make
.PHONY: shortlist-sim
shortlist-sim: ## Simulation benchmark for the evidence shortlist (local data; not part of CI)
	npm run rebuild:node
	npx jiti scripts/shortlist-sim/run.ts --run $(or $(RUN),$(shell date +%Y%m%d-%H%M))
	npx jiti scripts/shortlist-sim/report/report.ts --run $(or $(RUN),latest)
```
- [ ] **Step 4: Tests pass; commit** — `feat(shortlist-sim): benchmark report`.

---

### Task 14: Run the experiment

- [ ] **Step 1:** `RUN=2026-10-12-full ~/.cache/varlens-session/heavy.sh make shortlist-sim` (background task; record wall time and peak RSS).
- [ ] **Step 2:** Read the report end to end. Sanity checks: filter sensitivity per class; concordance AF field; tuned points have plausible signs (LoF > missense > other, rarer > commoner); no degenerate bin (support < 5 → reported, points clipped toward 0 by the smoothing).
- [ ] **Step 3:** Codex adversarial review of the report and `results.jsonl` summary (read-only): validity threats, errors in metric computation, overclaiming. Fix real issues, rerun if code changed.
- [ ] **Step 4:** Commit the report directory (`report.md`, SVGs, `metrics.json`, `protocol.lock.json`, tuned ruleset, concordance) — `docs(shortlist-sim): simulation report <run>`.

### Task 15: Ship the tuned preset (only if §5.5 passes)

**Files:** Create `src/main/database/evidence-rulesets/varvis-exome-v1.json` (the tuned ruleset, canonical JSON, `sha256` field), `src/main/database/evidence-rulesets/index.ts` (loads + verifies sha), SQLite migration v46 in `src/main/database/migrations.ts` (insert the preset; `INSERT OR IGNORE`; JSON literal embedded via `import` of the JSON file **and** a test asserting the migration's stored `filter_json` equals the file), PostgreSQL `src/main/storage/postgres/migrations/sql/0029_evidence_ranking_beta_preset.sql` (literal JSON in SQL, `ON CONFLICT (name) DO NOTHING`) + `definitions.ts` entry; extend `tests/main/storage/postgres-migration-definitions.test.ts` (literal equals file); built-in preset config: name `Evidence ranking (beta)`, description `Simulation-validated on 3 immunology exomes; SNV/indel; inheritance-aware.`, `variantTypeScope: ['snv','indel']`, gate per Global Constraints, `topN: 100`, `rankConfig: { weights: all 0, ruleset, clinvarPinTop: false, pinStarredTop: true }`, `tieBreakers: [{ key: 'cadd', order: 'desc' }, { key: 'chr', order: 'asc' }, { key: 'pos', order: 'asc' }]`.
- [ ] Steps: failing migration tests (fresh DB has the preset; replay is a no-op; user preset with same name untouched; sha verified) → implement → tests pass → commit `feat(shortlist): seed the simulation-validated evidence preset (beta)`.
- If §5.5 fails: skip this task; the report's verdict section explains why; open a follow-up issue with the findings.

### Task 16: User docs, follow-up issues, gates, final review

- [ ] `docs/` user page (VitePress): "Evidence ranking (beta)" — what the score means (points, not probability), modes, how to read the tooltip, validation scope and limits; link from the shortlist docs page.
- [ ] Follow-up issues already filed (2026-10-12): #579 compound-het mode counts common hets, #580 varvis `hpo_match` dropped on import, #581 SV/CNV evidence rules, #582 STR evidence rules, #583 male XLR validation, #584 independent validation backgrounds, #585 ruleset editor, #586 phase-aware compound het. Reference them in the PR and report; file a new issue for every further item found but not fixed on this branch.
- [ ] Gates: `~/.cache/varlens-session/heavy.sh make lint-check format-check typecheck agent-check`, `make rebuild-node && make test`, PostgreSQL parity run, renderer visual check (Task 6), then `make preflight-full` from the session shell (memory: preflight cannot run under a detached systemd unit).
- [ ] Codex final adversarial review of the whole branch diff (`git diff origin/main...HEAD`), fix findings, re-run affected gates.
- [ ] Push branch, open a **draft** PR referencing the spec, plan and report; mark ready only after preflight passes.
