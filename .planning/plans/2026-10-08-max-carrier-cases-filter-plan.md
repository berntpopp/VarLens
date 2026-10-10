# Maximum Carrier Cases Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a filter "seen in at most K cases" on the absolute number of carrier cases, in the case view and the cohort view, on SQLite and PostgreSQL, plus one new built-in preset, in one PR (#455).

**Architecture:** One new scalar filter field, `maxCarriers` in `FilterState` and `carrier_count_max` in the backend filter objects. It mirrors two existing siblings: the cohort-only minimum (`minCarriers` / `carrier_count_min`) and the internal frequency filter (`maxInternalAf` / `max_internal_af`). The case view filters on `vf.case_count` (the `variant_frequency` join that every case query already has); the cohort view filters on `cvs.carrier_count`. No new table, index, IPC channel or join.

**Tech Stack:** TypeScript 6, zod 4, Kysely + better-sqlite3-multiple-ciphers, `pg`, Vue 3.5 + Vuetify 4, Vitest 5 (happy-dom for the renderer).

**Spec:** `.planning/specs/2026-10-08-max-carrier-cases-filter.md` (as of commit `c5bd166e`). Read it with this plan.

**Sequencing (read before starting):**

- This plan lands AFTER the cohort row identity plan (`.planning/plans/2026-10-08-cohort-row-identity-carriers-plan.md`). That plan changes `src/main/database/cohort.ts`, `src/main/storage/postgres/postgres-cohort-summary-query.ts`, `src/shared/types/cohort.ts`, `src/renderer/src/components/CohortTable.vue`, `src/renderer/src/components/cohort/CohortDataTable.vue` and `src/renderer/src/mocks/mockApi.ts`. In those six files, find each edit by the symbol or function named in the step. The line numbers in this plan are from `main` at `bcbc86cf` and are a hint only.
- This plan owns SQLite migration **v45** and PostgreSQL migration **0028**. No other plan in this batch adds a migration. Verified on `main` at `bcbc86cf`: `LATEST_SQLITE_SCHEMA_VERSION = 44` (`src/main/database/migrations.ts:21`), last PostgreSQL migration `0027_summary_conflicting_calls.sql`.
- Work on a dedicated branch from `main` (for example `feat/max-carrier-cases-filter`), never on `main`.
- The new tests never read `variant_key` of a cohort row (its content changes in the row identity plan). They build `chr:pos:ref:alt` from the row fields.

## Global Constraints

- Field names: `maxCarriers` (`FilterState`, camelCase) and `carrier_count_max` (backend filters, snake_case).
- Value: integer, minimum 1. `null` or absent means off. The schemas reject values below 1 and non-integers.
- Predicate: keep the row when the count is `NULL` or `<= K` (same `NULL` rule as `max_internal_af`: a variant without a frequency row is kept).
- K counts all cases including the current one. The case view labels it "including this case". The filter says "cases", never "unrelated carriers".
- Case view reads `vf.case_count`. Cohort view reads `carrier_count`. Both backends, same PR (cohort parity is mandatory).
- The field is NOT added to the association configuration (`VariantFilters` in `src/main/statistics/types.ts`, `AssociationConfigSchema`).
- Existing built-in presets are not changed. One new built-in preset: `Rare, not recurrent` = `{ maxGnomadAf: 0.01, maxCarriers: 3 }`, `sortOrder: 8`, description `gnomAD AF <= 1% + seen in at most 3 cases`. Seeded by SQLite v45 and PostgreSQL 0028, insert if absent. Existing rows and user presets are untouched.
- Known limits are documented, not fixed: the four-coordinate `variant_frequency` key in a mixed-build database, and the two views reading different tables (the cohort summary can be stale). No test asserts case view = cohort view in a stale or mixed-build state.
- Out of scope: zygosity-specific caps, family deduplication, extending the minimum to the case view.
- Code blocks in this plan may not be wrapped exactly as Prettier wants. Before each commit run `npx prettier --write` on the files of the task, then re-check the line count of any file named in the line budgets below.
- Project rules: no `console.*`; never use `surface-variant`; source files under 600 lines and files in `scripts/agent-health-baseline.json` must not grow past their recorded line count; never lower a threshold; Conventional Commits; `make rebuild-node` before any Vitest run.
- Line budgets on `main` (current / allowed): `FilterDrawer.vue` 857/857, `mockApi.ts` 1236/1236, `CohortFilterDrawer.vue` 679/680, `CohortFilterBar.vue` 624/642, `ipc-schemas.ts` 988/1009, `database.ts` 650/656, `useCohortData.ts` 595/600. Tasks 8 and 9 are written to shrink or hold the three files with no headroom. Do not add comment lines or blank lines beyond the code shown in those files.

## Review Focus

Inputs the spec implies but does not list as tests. Each has a test in the task named.

1. The user types `0`, a negative number or `2.7` into the field. Expected: `0` and negatives turn the filter off (no error, no empty table); `2.7` becomes `2`. Tests: Task 7 (`parseMaxCarriers`, serialization), Task 9 (`MaxCarriersField`).
2. A stored preset holds an invalid cap (`0` or `2.5`, written by hand or by another version). Expected: applying it does not produce an IPC validation error; the cap is off. Tests: Task 7 (serialization never sends it), Tasks 2 to 5 (each query builder ignores a value below 1).
3. Minimum and maximum together in the cohort view. Expected: `min 2, max 3` returns the rows with 2 or 3 carriers; `min 3, max 2` returns an empty page with count 0, not an error. Tests: Task 3 (SQLite), Task 5 (PostgreSQL).
4. A case is deleted while the cap is on. Expected: the count drops and a variant hidden before is shown again. Test: Task 2.
5. A user preset is already named `Rare, not recurrent` when the migration runs, or the database has no `filter_presets` table. Expected: the user preset is kept as it is, there is one row of that name, the migration does not fail. Tests: Task 10 (SQLite and PostgreSQL).

## File Structure

New files:

| File | Responsibility |
| --- | --- |
| `src/renderer/src/utils/filters/maxCarriers.ts` | When the cap is on, how typed text becomes a cap, how it reads on a chip |
| `src/renderer/src/components/filters/MaxCarriersField.vue` | The one numeric field, used by both drawers |
| `src/main/storage/postgres/migrations/sql/0028_rare_not_recurrent_preset.sql` | PostgreSQL seed of the new preset |
| `tests/shared/types/max-carriers-schema.test.ts` | Schema rules |
| `tests/main/database/max-carriers-filter.test.ts` | SQLite case view, cohort view, single-build parity, export |
| `tests/main/storage/postgres-max-carriers-parity.test.ts` | PostgreSQL single-build parity (gated) |
| `tests/main/database/migration-v45.test.ts` | SQLite v45 |
| `tests/main/storage/postgres-rare-not-recurrent-preset-migration.test.ts` | PostgreSQL 0028 (gated) |
| `tests/renderer/utils/filters/maxCarriers.test.ts` | Renderer state utilities |
| `tests/renderer/components/filters/MaxCarriersField.test.ts` | The field |
| `tests/renderer/mocks/mockApi-cohort-max-carriers.test.ts` | Mock API |

Every other file is an existing file that gets a few lines next to its `maxInternalAf` / `minCarriers` sibling.

---

### Task 1: Shared contract (types, schemas, defaults)

**Files:**
- Modify: `src/shared/types/filters.ts:64,98`
- Modify: `src/shared/types/database.ts:211`
- Modify: `src/shared/types/cohort.ts` (interface `CohortSearchParams`, after `carrier_count_min`)
- Modify: `src/shared/types/ipc-schemas.ts:125-130,231-236,775`
- Modify: `src/shared/api/schemas/variants.ts:46`
- Modify: `src/shared/filters/filterDefaults.ts:19`
- Modify: `src/renderer/src/utils/filters/filterDefaults.ts:37`
- Modify: `src/renderer/src/utils/filters/filterClearing.ts:118` (function `clearAllFilters`)
- Modify: `src/renderer/src/components/cohort/CohortDataTable.vue` (computed `columnActiveFilters`)
- Test: `tests/shared/types/max-carriers-schema.test.ts` (create)
- Test: `tests/renderer/utils/filters/filterDefaults.test.ts:62`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FilterState.maxCarriers: number | null`
  - `FilterIpcParams.carrier_count_max?: number`
  - `VariantFilter.carrier_count_max?: number`
  - `CohortSearchParams.carrier_count_max?: number`
  - `CohortSearchParamsSchema`, `VariantFilterPartialSchema`: key `carrier_count_max` (integer >= 1, `null` becomes `undefined`)
  - `FilterStateSchema`: key `maxCarriers` (integer >= 1 or `null`)
  - `FILTER_DEFAULTS.maxCarriers === null` (both `FILTER_DEFAULTS` objects)

`FilterState.maxCarriers` is a required key, so every object literal of type `FilterState` in `src/` gets it in this task. That keeps `make typecheck` green after this commit.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/types/max-carriers-schema.test.ts`:

```ts
/**
 * Carrier cap (#455): an integer of at least 1; null or absent means off.
 */
import { describe, expect, it } from 'vitest'

import { VariantInvokeBodySchemas } from '../../../src/shared/api/schemas/variants'
import { FILTER_DEFAULTS } from '../../../src/shared/filters/filterDefaults'
import {
  AssociationConfigSchema,
  CohortSearchParamsSchema,
  FilterStateSchema,
  VariantFilterPartialSchema
} from '../../../src/shared/types/ipc-schemas'

const cap = (value: unknown): Record<string, unknown> => ({ carrier_count_max: value })

describe.each([
  ['CohortSearchParamsSchema', CohortSearchParamsSchema],
  ['VariantFilterPartialSchema', VariantFilterPartialSchema]
] as const)('%s: carrier_count_max', (_name, schema) => {
  it.each([1, 3, 250])('accepts %s', (value) => {
    expect(schema.parse(cap(value))).toMatchObject({ carrier_count_max: value })
  })

  it('treats null and absent as off', () => {
    expect(schema.parse(cap(null)).carrier_count_max).toBeUndefined()
    expect(schema.parse({}).carrier_count_max).toBeUndefined()
  })

  it.each([0, -1, 2.5, '3', Number.NaN])('rejects %s', (value) => {
    expect(schema.safeParse(cap(value)).success).toBe(false)
  })
})

describe('carrier cap in the other schemas', () => {
  it('the web variants:query body rejects a cap below 1 and a fraction', () => {
    const body = (value: unknown): unknown => ({ args: [1, cap(value), 0, 25, [], false, false] })
    expect(VariantInvokeBodySchemas.query.safeParse(body(3)).success).toBe(true)
    expect(VariantInvokeBodySchemas.query.safeParse(body(null)).success).toBe(true)
    expect(VariantInvokeBodySchemas.query.safeParse(body(0)).success).toBe(false)
    expect(VariantInvokeBodySchemas.query.safeParse(body(2.5)).success).toBe(false)
  })

  it('FilterStateSchema: maxCarriers is a whole number of cases, at least 1, or null', () => {
    const partial = FilterStateSchema.partial()
    expect(partial.safeParse({ maxCarriers: 3 }).success).toBe(true)
    expect(partial.safeParse({ maxCarriers: null }).success).toBe(true)
    for (const bad of [0, -1, 2.5]) {
      expect(partial.safeParse({ maxCarriers: bad }).success).toBe(false)
    }
  })

  it('FilterStateSchema and FILTER_DEFAULTS list the same fields', () => {
    expect(FILTER_DEFAULTS.maxCarriers).toBeNull()
    expect(Object.keys(FilterStateSchema.shape).sort()).toEqual(
      [...Object.keys(FILTER_DEFAULTS), 'shortlist'].sort()
    )
  })

  // Pin: the cohort-burden scope drops summary-only filters, so the association
  // configuration must not carry the cap (it would be accepted and ignored).
  it('the association configuration does not carry the cap', () => {
    const parsed = AssociationConfigSchema.parse({
      groupA_ids: [1],
      groupB_ids: [2],
      primary_test: 'fisher',
      weight_scheme: 'uniform',
      covariates: [],
      filters: { gnomad_af_max: 0.01, carrier_count_max: 3 }
    })
    expect(parsed.filters).toEqual({ gnomad_af_max: 0.01 })
  })
})
```

In `tests/renderer/utils/filters/filterDefaults.test.ts`, test `includes all expected keys`, add `'maxCarriers',` on the line after `'maxInternalAf',`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make rebuild-node && npx vitest run tests/shared/types/max-carriers-schema.test.ts tests/renderer/utils/filters/filterDefaults.test.ts`

Expected: FAIL. `accepts 1` fails with a `toMatchObject` mismatch (zod strips the unknown key), `rejects 0` fails with `expected true to be false`, the `FILTER_DEFAULTS` tests fail on the missing `maxCarriers` key. The association test already passes; it is a pin.

- [ ] **Step 3: Write the minimal implementation**

`src/shared/types/filters.ts`, interface `FilterState`, after the `maxInternalAf` line:

```ts
  /** Maximum internal database allele frequency (0-1) */
  maxInternalAf: number | null
  /** Seen in at most this many cases of the database (integer >= 1; null = off) */
  maxCarriers: number | null
```

Same file, interface `FilterIpcParams`, after `max_internal_af?: number`:

```ts
  max_internal_af?: number
  carrier_count_max?: number
```

`src/shared/types/database.ts`, interface `VariantFilter`, after `max_internal_af?: number`:

```ts
  /** Keep variants carried by at most this many cases (integer >= 1; absent = off) */
  carrier_count_max?: number
```

`src/shared/types/cohort.ts`, interface `CohortSearchParams`, after `carrier_count_min?: number`:

```ts
  /** Maximum carrier count (integer >= 1; absent = off) */
  carrier_count_max?: number
```

`src/shared/types/ipc-schemas.ts`, `CohortSearchParamsSchema`, after the `carrier_count_min` block:

```ts
  carrier_count_max: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((val) => val ?? undefined),
```

Same file, `VariantFilterPartialSchema`, after the `max_internal_af` block (before the `// Exact match filters` comment): the same six lines.

```ts
  carrier_count_max: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((val) => val ?? undefined),
```

Same file, `FilterStateSchema`, after the `maxInternalAf` line:

```ts
  maxInternalAf: z.number().min(0).max(1).nullable(),
  maxCarriers: z.number().int().positive().nullable(),
```

Do not touch `AssociationConfigSchema`.

`src/shared/api/schemas/variants.ts`, `VariantFilterOpenApiSchema`, after the `max_internal_af` line:

```ts
  carrier_count_max: z.number().int().min(1).nullable().optional(),
```

`src/shared/filters/filterDefaults.ts` and `src/renderer/src/utils/filters/filterDefaults.ts`, in `FILTER_DEFAULTS`, after `maxInternalAf: null,`:

```ts
  maxCarriers: null,
```

`src/renderer/src/utils/filters/filterClearing.ts`, function `clearAllFilters`, after the `maxInternalAf` line:

```ts
    maxCarriers: FILTER_DEFAULTS.maxCarriers,
```

`src/renderer/src/components/cohort/CohortDataTable.vue`, computed `columnActiveFilters`, in the object passed to `buildActiveFiltersList`, after `maxInternalAf: null,`:

```ts
      maxCarriers: null,
```

- [ ] **Step 4: Run the tests and the type check to verify they pass**

Run: `npx vitest run tests/shared/types/max-carriers-schema.test.ts tests/renderer/utils/filters/filterDefaults.test.ts && make typecheck`

Expected: PASS, and `make typecheck` exits 0. If `vue-tsc` reports `Property 'maxCarriers' is missing in type ... FilterState`, add `maxCarriers: null,` to the object it names.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/filters.ts src/shared/types/database.ts src/shared/types/cohort.ts \
  src/shared/types/ipc-schemas.ts src/shared/api/schemas/variants.ts \
  src/shared/filters/filterDefaults.ts src/renderer/src/utils/filters/filterDefaults.ts \
  src/renderer/src/utils/filters/filterClearing.ts \
  src/renderer/src/components/cohort/CohortDataTable.vue \
  tests/shared/types/max-carriers-schema.test.ts tests/renderer/utils/filters/filterDefaults.test.ts
git commit -m "feat(filters): add the carrier cap to the shared filter contract (#455)"
```

---

### Task 2: SQLite case view

**Files:**
- Modify: `src/main/database/variant-filter/core-filters.ts` (after `applyInternalAfFilter`, line 97)
- Modify: `src/main/database/VariantFilterBuilder.ts:20,72`
- Test: `tests/main/database/max-carriers-filter.test.ts` (create)

**Interfaces:**
- Consumes: `VariantFilter.carrier_count_max?: number` (Task 1).
- Produces: `applyMaxCarriersFilter(query: VariantQueryBuilder, filter: VariantFilter): VariantQueryBuilder`, called from `VariantFilterBuilder.build()`. Every SQLite case path uses `build()`: the table, the compiled export SQL and the shortlist.

`createBaseVariantQuery` (`variant-filter/base-query-and-joins.ts:20`) always adds `LEFT JOIN variant_frequency AS vf`. No join work is needed.

- [ ] **Step 1: Write the failing test**

Create `tests/main/database/max-carriers-filter.test.ts`:

```ts
/**
 * "Seen in at most K cases" (#455) on SQLite. The case view reads
 * variant_frequency.case_count, the cohort view cohort_variant_summary.carrier_count.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { makeVariant as _makeVariant } from '../../utils/make-variant'

type Row = Record<string, unknown>

function makeVariant(overrides: Row = {}) {
  return _makeVariant({ gene_symbol: null, consequence: null, ...overrides })
}

/** Carried by every case that imports it. */
const SHARED: Row = { pos: 100 }
/** Carried by the first case only. */
const UNIQUE: Row = { pos: 200, ref: 'C', alt: 'T' }

describe('carrier cap (#455), SQLite', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => service.close())

  /** Import a case and count it in variant_frequency, as the import does. */
  function importCase(name: string, variants: Row[]): number {
    const id = service.cases.createCase(name, `/${name}.json`, 100)
    service.variants.insertVariantsBatch(
      id,
      variants.map((v) => makeVariant(v))
    )
    service.variants.updateFrequencies(id)
    return id
  }

  /** Three cases: SHARED in all three, UNIQUE in the first. */
  function importThreeCases(): number[] {
    return [
      importCase('c1', [SHARED, UNIQUE]),
      importCase('c2', [SHARED]),
      importCase('c3', [SHARED])
    ]
  }

  function caseView(caseId: number, max?: number): { positions: number[]; total: number } {
    const result = service.variants.getVariants({ case_id: caseId, carrier_count_max: max }, 50, 0)
    return { positions: result.data.map((v) => v.pos).sort((a, b) => a - b), total: result.total_count }
  }

  describe('case view', () => {
    it('K = 1, K = 3 and off; the current case counts exactly once', () => {
      const [c1, c2] = importThreeCases()

      expect(caseView(c1, 1)).toEqual({ positions: [200], total: 1 })
      // SHARED is in exactly 3 cases: 2 drops it, 3 keeps it.
      expect(caseView(c1, 2)).toEqual({ positions: [200], total: 1 })
      expect(caseView(c1, 3)).toEqual({ positions: [100, 200], total: 2 })
      expect(caseView(c1)).toEqual({ positions: [100, 200], total: 2 })
      expect(caseView(c2, 2)).toEqual({ positions: [], total: 0 })
      expect(caseView(c2, 3)).toEqual({ positions: [100], total: 1 })
    })

    it('several transcript rows of one case count once; a second imported case counts', () => {
      const c1 = importCase('c1', [
        { ...SHARED, transcript: 'NM_1' },
        { ...SHARED, transcript: 'NM_2' }
      ])
      expect(caseView(c1, 1)).toEqual({ positions: [100, 100], total: 2 })

      importCase('c2', [SHARED])
      expect(caseView(c1, 1)).toEqual({ positions: [], total: 0 })
      expect(caseView(c1, 2)).toEqual({ positions: [100, 100], total: 2 })
    })

    it('keeps a variant without a frequency row', () => {
      const id = service.cases.createCase('c1', '/c1.json', 100)
      service.variants.insertVariantsBatch(id, [makeVariant(SHARED)])
      // No updateFrequencies: variant_frequency has no row for it.
      expect(caseView(id, 1)).toEqual({ positions: [100], total: 1 })
    })

    // Review Focus 4
    it('a deleted case no longer counts', () => {
      const c1 = importCase('c1', [SHARED])
      const c2 = importCase('c2', [SHARED])
      expect(caseView(c1, 1).positions).toEqual([])

      service.variants.decrementFrequencies(c2)
      expect(caseView(c1, 1).positions).toEqual([100])
    })

    // Review Focus 2: a value below 1 can only come from a stored preset.
    it('a cap below 1 is off', () => {
      const [c1] = importThreeCases()
      expect(caseView(c1, 0)).toEqual({ positions: [100, 200], total: 2 })
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/database/max-carriers-filter.test.ts`

Expected: FAIL in `K = 1, K = 3 and off`, `several transcript rows` and `a deleted case no longer counts`, each with `expected { positions: [ 100, 200 ], ... } to deeply equal { positions: [ 200 ], ... }` or similar (the filter is ignored). `keeps a variant without a frequency row` and `a cap below 1 is off` pass already.

- [ ] **Step 3: Write the minimal implementation**

`src/main/database/variant-filter/core-filters.ts`, directly after the function `applyInternalAfFilter`:

```ts
/** Carrier cap: keep a variant seen in at most K cases (no frequency row: kept). */
export function applyMaxCarriersFilter(
  query: VariantQueryBuilder,
  filter: VariantFilter
): VariantQueryBuilder {
  const max = filter.carrier_count_max
  return query.$if(max !== undefined && max >= 1, (qb) =>
    qb.where(({ or, eb }) =>
      or([eb(sql.ref('vf.case_count'), 'is', null), eb(sql.ref('vf.case_count'), '<=', max!)])
    )
  )
}
```

`src/main/database/VariantFilterBuilder.ts`, import block from `./variant-filter/core-filters`: add `applyMaxCarriersFilter,` after `applyInternalAfFilter,`.

Same file, method `build`, after the `applyInternalAfFilter` line. The position fixes the order of bound parameters; existing snapshots in `variant-filter-builder.characterization.test.ts` do not set the new field and stay unchanged.

```ts
    query = applyInternalAfFilter(query, filter, totalCaseCount)
    query = applyMaxCarriersFilter(query, filter)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/database/max-carriers-filter.test.ts tests/main/database/variant-filter-builder.characterization.test.ts tests/main/database/variant-frequency.test.ts`

Expected: PASS, no snapshot written or changed.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/variant-filter/core-filters.ts src/main/database/VariantFilterBuilder.ts \
  tests/main/database/max-carriers-filter.test.ts
git commit -m "feat(filters): carrier cap in the SQLite case view (#455)"
```

---

### Task 3: SQLite cohort view

**Files:**
- Modify: `src/main/database/variant-where-builder.ts:37,114-121`
- Modify: `src/main/database/cohort.ts` (object `baseInput` in the WHERE builder, after `carrier_count_min`)
- Test: `tests/main/database/max-carriers-filter.test.ts`
- Test: `tests/main/database/variant-where-builder.test.ts`

**Interfaces:**
- Consumes: `CohortSearchParams.carrier_count_max?: number` (Task 1); `importThreeCases`, `caseView` from the test file of Task 2.
- Produces: `BaseFilterInput.carrier_count_max?: number`. `buildBaseWhere` emits `<alias>.carrier_count <= ?` in scope `cohort-listing` only. Scopes `case` and `cohort-burden` drop it, which is why the association path cannot apply it.

`cohort_variant_summary.carrier_count` is `NOT NULL` on both backends, so the cohort predicate needs no `NULL` branch.

- [ ] **Step 1: Write the failing tests**

In `tests/main/database/max-carriers-filter.test.ts`, add this import at the top:

```ts
import type { CohortSearchParams } from '../../../src/shared/types/cohort'
```

Add this block inside `describe('carrier cap (#455), SQLite', ...)`, after the `describe('case view', ...)` block:

```ts
  const coordKey = (v: { chr: string; pos: number; ref: string; alt: string }): string =>
    `${v.chr}:${v.pos}:${v.ref}:${v.alt}`

  /** Cohort page over a FRESH summary. */
  function cohortView(params: CohortSearchParams = {}): { keys: string[]; total: number } {
    service.cohortSummary.rebuild()
    service.cohort.invalidateColumnMetaCache()
    const result = service.cohort.getCohortVariants({ limit: 100, ...params })
    return { keys: result.data.map(coordKey).sort(), total: result.total_count }
  }

  describe('cohort view', () => {
    it('K = 1, K = 3 and off', () => {
      importThreeCases()

      expect(cohortView({ carrier_count_max: 1 })).toEqual({ keys: ['1:200:C:T'], total: 1 })
      expect(cohortView({ carrier_count_max: 2 })).toEqual({ keys: ['1:200:C:T'], total: 1 })
      expect(cohortView({ carrier_count_max: 3 })).toEqual({
        keys: ['1:100:A:G', '1:200:C:T'],
        total: 2
      })
      expect(cohortView()).toEqual({ keys: ['1:100:A:G', '1:200:C:T'], total: 2 })
    })

    // Review Focus 3
    it('combines with the minimum; a contradictory range is an empty page', () => {
      importThreeCases()

      expect(cohortView({ carrier_count_min: 2, carrier_count_max: 3 })).toEqual({
        keys: ['1:100:A:G'],
        total: 1
      })
      expect(cohortView({ carrier_count_min: 3, carrier_count_max: 2 })).toEqual({
        keys: [],
        total: 0
      })
    })

    // Review Focus 2
    it('a cap below 1 is off', () => {
      importThreeCases()
      expect(cohortView({ carrier_count_max: 0 }).total).toBe(2)
    })
  })

  // Spec: single genome build (createCase defaults to GRCh38) and a fresh summary.
  // The two views read different tables; no equality is claimed otherwise.
  describe('case view and cohort view, single build, fresh summary', () => {
    it.each([1, 2, 3, undefined])('return the same variants for K = %s', (max) => {
      const caseIds = importThreeCases()

      const fromCases = new Set<string>()
      for (const caseId of caseIds) {
        const page = service.variants.getVariants({ case_id: caseId, carrier_count_max: max }, 50, 0)
        for (const v of page.data) fromCases.add(coordKey(v))
      }
      const cohort = cohortView({ carrier_count_max: max })

      expect([...fromCases].sort()).toEqual(cohort.keys)
      expect(cohort.total).toBe(fromCases.size)
    })
  })
```

Append to the end of `tests/main/database/variant-where-builder.test.ts`:

```ts
describe('carrier_count_max (#455)', () => {
  it('is dropped for case and cohort-burden scopes', () => {
    for (const scope of ['case', 'cohort-burden'] as const) {
      const result = buildBaseWhere({ carrier_count_max: 3 }, { baseAlias: 'v', scope })
      expect(result.sql).not.toContain('carrier_count')
      expect(result.params).toEqual([])
    }
  })

  it('caps the stored count in cohort-listing scope, after the minimum', () => {
    const result = buildBaseWhere(
      { carrier_count_min: 2, carrier_count_max: 3 },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toContain('cvs.carrier_count >= ?')
    expect(result.sql).toContain('cvs.carrier_count <= ?')
    expect(result.params).toEqual([2, 3])
    expect(result.needsBuildTotals).toBe(false)
  })

  it('ignores a cap below 1', () => {
    const result = buildBaseWhere(
      { carrier_count_max: 0 },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toBe('')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/database/max-carriers-filter.test.ts tests/main/database/variant-where-builder.test.ts`

Expected: FAIL. Cohort `K = 1` returns both keys; `return the same variants for K = 1` and `K = 2` fail because the cohort side is not capped; `caps the stored count in cohort-listing scope` fails with `expected 'cvs.carrier_count >= ?' to contain 'cvs.carrier_count <= ?'`.

- [ ] **Step 3: Write the minimal implementation**

`src/main/database/variant-where-builder.ts`, interface `BaseFilterInput`, after `carrier_count_min?: number`:

```ts
  carrier_count_max?: number
```

Same file, function `buildBaseWhere`, directly after the `carrier_count_min` block:

```ts
  if (
    isCohortSummaryScope &&
    filters.carrier_count_max !== undefined &&
    filters.carrier_count_max >= 1
  ) {
    // carrier_count is NOT NULL on the summary: no NULL branch.
    conditions.push(`${q('carrier_count')} <= ?`)
    params.push(filters.carrier_count_max)
  }
```

`src/main/database/cohort.ts`, the object `baseInput: BaseFilterInput`, after `carrier_count_min: params.carrier_count_min,`:

```ts
      carrier_count_max: params.carrier_count_max,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/database/max-carriers-filter.test.ts tests/main/database/variant-where-builder.test.ts tests/main/database/cohort.test.ts tests/main/database/cohort-keyset.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/variant-where-builder.ts src/main/database/cohort.ts \
  tests/main/database/max-carriers-filter.test.ts tests/main/database/variant-where-builder.test.ts
git commit -m "feat(cohort): carrier cap in the SQLite cohort view (#455)"
```

---

### Task 4: PostgreSQL case view

**Files:**
- Modify: `src/main/storage/postgres/PostgresVariantReadRepository.ts:191-195` (function `buildPostgresVariantQueryParts`)
- Test: `tests/main/database/variant-filter-parity-guards.test.ts`

**Interfaces:**
- Consumes: `VariantFilter.carrier_count_max?: number` (Task 1).
- Produces: `buildPostgresVariantQueryParts` adds `(vf.case_count IS NULL OR vf.case_count <= $n)`. The table query, its count, the export stream and the shortlist all use this function.

`buildPostgresVariantQueryParts` always emits `LEFT JOIN <schema>."variant_frequency" vf ON vf.coord_hash = v.coord_hash` (line 232). No join work is needed.

- [ ] **Step 1: Write the failing test**

Append to the end of `tests/main/database/variant-filter-parity-guards.test.ts` (the file already imports `buildPostgresVariantQueryParts`):

```ts
describe('PostgreSQL case view carrier cap (#455, no PostgreSQL required)', () => {
  it('caps vf.case_count and keeps rows without a frequency row', () => {
    const { fromAndWhereSql, params } = buildPostgresVariantQueryParts(
      { case_id: 1, carrier_count_max: 3 },
      '"public"'
    )
    expect(fromAndWhereSql).toContain('(vf.case_count IS NULL OR vf.case_count <= $2)')
    expect(fromAndWhereSql).toContain('LEFT JOIN "public"."variant_frequency" vf')
    expect(params).toEqual([1, 3])
  })

  it('ignores a cap below 1', () => {
    const { fromAndWhereSql, params } = buildPostgresVariantQueryParts(
      { case_id: 1, carrier_count_max: 0 },
      '"public"'
    )
    expect(fromAndWhereSql).not.toContain('vf.case_count <=')
    expect(params).toEqual([1])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/database/variant-filter-parity-guards.test.ts -t "carrier cap"`

Expected: FAIL in `caps vf.case_count` with `expected '...' to contain '(vf.case_count IS NULL OR vf.case_count <= $2)'`.

- [ ] **Step 3: Write the minimal implementation**

`src/main/storage/postgres/PostgresVariantReadRepository.ts`, function `buildPostgresVariantQueryParts`, directly after the `max_internal_af` block:

```ts
  if (filter.carrier_count_max !== undefined && filter.carrier_count_max >= 1) {
    addWhere(`(vf.case_count IS NULL OR vf.case_count <= ${addParam(filter.carrier_count_max)})`)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/database/variant-filter-parity-guards.test.ts tests/main/storage/postgres-variant-read-repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/postgres/PostgresVariantReadRepository.ts \
  tests/main/database/variant-filter-parity-guards.test.ts
git commit -m "feat(postgres): carrier cap in the case view (#455)"
```

---

### Task 5: PostgreSQL cohort view

**Files:**
- Modify: `src/main/storage/postgres/postgres-cohort-summary-query.ts` (function `buildSummaryQueryParts`, after the `carrier_count_min` block, line 518 on `main`)
- Test: `tests/main/storage/postgres-cohort-summary-query.test.ts`

**Interfaces:**
- Consumes: `CohortSearchParams.carrier_count_max?: number` (Task 1).
- Produces: `buildSummaryQueryParts` adds `cvs.carrier_count <= $n`. The cohort page, its count and the cohort export stream (`PostgresCohortRepository.streamCohortRows`) all use this function.

- [ ] **Step 1: Write the failing test**

Append to the end of `tests/main/storage/postgres-cohort-summary-query.test.ts` (the file already imports `buildSummaryQueryParts` and defines `TOTAL_CASES`):

```ts
describe('carrier_count_max (#455)', () => {
  // Review Focus 3
  it('caps the stored count next to the minimum, without build totals', () => {
    const result = buildSummaryQueryParts(
      { carrier_count_min: 2, carrier_count_max: 3 },
      TOTAL_CASES
    )
    expect(result.parts.whereParts).toEqual([
      'cvs.carrier_count >= $1',
      'cvs.carrier_count <= $2'
    ])
    expect(result.parts.values).toEqual([2, 3])
    expect(result.parts.needsBuildTotals).toBe(false)
  })

  // Review Focus 2
  it('ignores a cap below 1', () => {
    const result = buildSummaryQueryParts({ carrier_count_max: 0 }, TOTAL_CASES)
    expect(result.parts.whereParts).toEqual([])
    expect(result.parts.values).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/storage/postgres-cohort-summary-query.test.ts -t "carrier_count_max"`

Expected: FAIL in `caps the stored count` with `expected [ 'cvs.carrier_count >= $1' ] to deeply equal [ 'cvs.carrier_count >= $1', 'cvs.carrier_count <= $2' ]`.

- [ ] **Step 3: Write the minimal implementation**

`src/main/storage/postgres/postgres-cohort-summary-query.ts`, function `buildSummaryQueryParts`, directly after the `carrier_count_min` block:

```ts
  if (params.carrier_count_max !== undefined && params.carrier_count_max >= 1) {
    whereParts.push(`cvs.carrier_count <= ${addParam(params.carrier_count_max)}`)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/storage/postgres-cohort-summary-query.test.ts tests/main/storage/postgres-cohort-repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/postgres/postgres-cohort-summary-query.ts \
  tests/main/storage/postgres-cohort-summary-query.test.ts
git commit -m "feat(postgres): carrier cap in the cohort view (#455)"
```

---

### Task 6: Cohort export, shortlist and cross-backend parity

**Files:**
- Modify: `src/main/workers/cohort-export.ts:78-80` (function `buildCohortMetadata`)
- Modify: `src/main/database/shortlist-query.ts:67` (function `toShortlistVariantFilter`)
- Test: `tests/main/database/max-carriers-filter.test.ts`
- Test: `tests/main/database/shortlist-query.test.ts`
- Test: `tests/main/storage/postgres-max-carriers-parity.test.ts` (create, gated)
- Test: `tests/main/storage/variant-filter-backend-parity.test.ts` (gated)

**Interfaces:**
- Consumes: the four query builders of Tasks 2 to 5; `FilterState.maxCarriers` (Task 1); `importThreeCases` from the test file of Task 2.
- Produces: `toShortlistVariantFilter(...)` returns `carrier_count_max`; the "Export Info" sheet of the cohort XLSX has a row `['Max Carrier Cases', K]`.

The case-view export has no entry for the internal frequency filter in its "Export Info" sheet (`buildFilterSummary` in `export-logic.ts` lists six fields). The cap follows that sibling: the exported rows are filtered, the summary sheet is not extended.

- [ ] **Step 1: Write the failing tests**

In `tests/main/database/max-carriers-filter.test.ts`, add these imports at the top:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { runCohortExport } from '../../../src/main/workers/cohort-export'
```

Add this block inside `describe('carrier cap (#455), SQLite', ...)`, at its end:

```ts
  describe('cohort export', () => {
    it('holds the rows of the table and names the cap', () => {
      importThreeCases()
      service.cohortSummary.rebuild()
      const dir = mkdtempSync(join(tmpdir(), 'varlens-max-carriers-'))
      try {
        const file = join(dir, 'cohort.xlsx')
        const result = runCohortExport(service.db, { carrier_count_max: 1 }, file, () => {})
        const book = XLSX.read(readFileSync(file))
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          book.Sheets['Cohort Variants']
        )
        expect(rows.map((row) => row['Position'])).toEqual([200])
        expect(result.rowCount).toBe(1)

        const info = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['Export Info'], { header: 1 })
        expect(info).toContainEqual(['Max Carrier Cases', 1])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
```

Append to the end of `tests/main/database/shortlist-query.test.ts` (the file already imports `toShortlistVariantFilter`):

```ts
describe('toShortlistVariantFilter: carrier cap (#455)', () => {
  it('passes the cap of the base filters to the case query', () => {
    expect(toShortlistVariantFilter(1, 'snv', { maxCarriers: 3 }).carrier_count_max).toBe(3)
    expect(toShortlistVariantFilter(1, 'snv', { maxCarriers: null }).carrier_count_max).toBeUndefined()
    expect(toShortlistVariantFilter(1, 'snv', {}).carrier_count_max).toBeUndefined()
  })
})
```

Create `tests/main/storage/postgres-max-carriers-parity.test.ts`:

```ts
/**
 * Carrier cap (#455) against a real PostgreSQL: in a single-build database
 * with a fresh cohort summary, the case view and the cohort view return the
 * same variants for the same K, including page counts and the cohort export.
 *
 * The two views read different tables (variant_frequency / the summary), so
 * this file makes no claim about a stale summary or a mixed-build database.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface Coord {
  chr: string
  pos: number
  ref: string
  alt: string
}
const SHARED: Coord = { chr: '1', pos: 100, ref: 'A', alt: 'G' }
const UNIQUE: Coord = { chr: '1', pos: 200, ref: 'C', alt: 'T' }
/** SHARED is in all three cases, UNIQUE in the first. All cases are GRCh38. */
const CASES: Coord[][] = [[SHARED, UNIQUE], [SHARED], [SHARED]]

const coordKey = (v: { chr: unknown; pos: unknown; ref: unknown; alt: unknown }): string =>
  `${String(v.chr)}:${Number(v.pos)}:${String(v.ref)}:${String(v.alt)}`

describe.skipIf(!RUN)('carrier cap (#455): PostgreSQL case view and cohort view', () => {
  let schema: string
  let pool: Pool
  const caseIds: number[] = []

  beforeAll(async () => {
    schema = `vt_max_carriers_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 3 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const summaryRepo = new PostgresCohortSummaryRepository()
    for (const [index, variants] of CASES.entries()) {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, $3, 'GRCh38') RETURNING id`,
        [`cap-${index}`, `/tmp/cap-${index}.json`, Date.now()]
      )
      const caseId = Number(created.rows[0].id)
      caseIds.push(caseId)
      for (const v of variants) {
        await pool.query(
          `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gt_num)
           VALUES ($1, $2, $3, $4, $5, 'snv', '0/1')`,
          [caseId, v.chr, v.pos, v.ref, v.alt]
        )
      }
      // Fresh summary: every case is added to it in its own transaction.
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await summaryRepo.incrementalAdd({
          schema,
          client: client as never,
          caseId,
          genomeBuild: 'GRCh38'
        })
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
    await pool.query(
      `INSERT INTO "${schema}".variant_frequency (chr, pos, ref, alt, case_count)
       SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id) FROM "${schema}".variants
       GROUP BY chr, pos, ref, alt`
    )
  }, 180_000)

  afterAll(async () => {
    if (pool) await pool.end()
    if (schema !== undefined) {
      const cleaner = new Client({ connectionString: PG_URL })
      await cleaner.connect()
      await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await cleaner.end()
    }
  }, 120_000)

  it.each([
    [1, ['1:200:C:T']],
    [2, ['1:200:C:T']],
    [3, ['1:100:A:G', '1:200:C:T']],
    [undefined, ['1:100:A:G', '1:200:C:T']]
  ] as const)(
    'K = %s: both views, their counts and the export agree',
    async (max, expected) => {
      const variants = new PostgresVariantReadRepository(pool, schema)
      const cohort = new PostgresCohortRepository(pool, schema)

      const fromCases = new Set<string>()
      let caseTotal = 0
      for (const caseId of caseIds) {
        const page = await variants.queryVariants({ case_id: caseId, carrier_count_max: max }, 50, 0)
        expect(page.total_count).toBe(page.data.length)
        caseTotal += page.total_count
        for (const v of page.data) fromCases.add(coordKey(v))
      }
      // SHARED is one row in each of the three cases when it is kept.
      expect(caseTotal).toBe(expected.includes('1:100:A:G') ? 4 : 1)

      const page = await cohort.queryVariants({ genome_build: 'GRCh38', carrier_count_max: max })
      const exported: string[] = []
      for await (const row of cohort.streamCohortRows({
        genome_build: 'GRCh38',
        carrier_count_max: max
      })) {
        exported.push(coordKey(row as never))
      }

      expect([...fromCases].sort()).toEqual([...expected])
      expect(page.data.map(coordKey).sort()).toEqual([...expected])
      expect(page.total_count).toBe(expected.length)
      expect(exported.sort()).toEqual([...expected])
    },
    120_000
  )
})
```

In `tests/main/storage/variant-filter-backend-parity.test.ts`, inside the main `describe`, add this test directly before the comment line `// ── Numeric-looking value on a text column`. This fixture mixes GRCh38 and GRCh37 cases, so the test compares the two backends per view against an explicit expectation. It does not compare the case view with the cohort view.

```ts
  // ── Carrier cap (#455) ────────────────────────────────────────────────────

  it('carrier cap: every read path of a view returns the same rows on both backends', async () => {
    // A.inGene is carried by cases A and B; every other variant by one case.
    // A.padding has no frequency row: the case view keeps it.
    const rareA = A_ALL.filter((v) => v !== A.inGene)
    await expectAll(casePaths(0, { carrier_count_max: 1 }), ok(rareA))
    await expectAll(casePaths(0, { carrier_count_max: 2 }), ok(A_ALL))
    await expectAll(casePaths(1, { carrier_count_max: 1 }), ok([B.padding, B.unrelated]))
    await expectAll(shortlistPaths(0, { maxCarriers: 1 }), ok(rareA))

    const grch38 = [...A_ALL, B.padding, B.unrelated]
    const params = { genome_build: 'GRCh38' }
    await expectAll(
      cohortPaths({ ...params, carrier_count_max: 1 }),
      ok(grch38.filter((v) => v !== A.inGene))
    )
    await expectAll(cohortPaths({ ...params, carrier_count_max: 2 }), ok(grch38))
    await expectAll(
      cohortPaths({ ...params, carrier_count_min: 2, carrier_count_max: 2 }),
      ok([A.inGene])
    )
  }, 120_000)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/database/max-carriers-filter.test.ts tests/main/database/shortlist-query.test.ts`

Expected: FAIL. The export test fails on `expected [ ... ] to deep equally contain [ 'Max Carrier Cases', 1 ]` (the exported rows are already right). The shortlist test fails with `expected undefined to be 3`.

Run the gated tests (needs `make pg-up`; set `VARLENS_PG_URL` if the development container is not on port 55432):

`VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage/postgres-max-carriers-parity.test.ts tests/main/storage/variant-filter-backend-parity.test.ts -t "carrier cap"`

Expected: `postgres-max-carriers-parity` PASSES already (Tasks 4 and 5 are in). In `variant-filter-backend-parity` the test fails on the `shortlistPaths(0, { maxCarriers: 1 })` assertion: both shortlist paths return `A.inGene` too. If PostgreSQL is not available in this environment, say so in the task report and leave both gated files for the final gate.

- [ ] **Step 3: Write the minimal implementation**

`src/main/workers/cohort-export.ts`, function `buildCohortMetadata`, after the `carrier_count_min` entry:

```ts
    ...(params.carrier_count_min !== undefined
      ? [['Min Carrier Count', params.carrier_count_min]]
      : []),
    ...(params.carrier_count_max !== undefined
      ? [['Max Carrier Cases', params.carrier_count_max]]
      : [])
```

`src/main/database/shortlist-query.ts`, function `toShortlistVariantFilter`, after the `max_internal_af` line:

```ts
    max_internal_af: filters.maxInternalAf ?? undefined,
    carrier_count_max: filters.maxCarriers ?? undefined,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/database/max-carriers-filter.test.ts tests/main/database/shortlist-query.test.ts tests/main/workers`

Expected: PASS.

Run (with PostgreSQL): `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage/postgres-max-carriers-parity.test.ts tests/main/storage/variant-filter-backend-parity.test.ts`

Expected: PASS, all tests of both files.

- [ ] **Step 5: Commit**

```bash
git add src/main/workers/cohort-export.ts src/main/database/shortlist-query.ts \
  tests/main/database/max-carriers-filter.test.ts tests/main/database/shortlist-query.test.ts \
  tests/main/storage/postgres-max-carriers-parity.test.ts \
  tests/main/storage/variant-filter-backend-parity.test.ts
git commit -m "feat(filters): carrier cap in the cohort export and the shortlist (#455)"
```

---

### Task 7: Renderer state utilities

**Files:**
- Create: `src/renderer/src/utils/filters/maxCarriers.ts`
- Modify: `src/renderer/src/utils/filters/index.ts:21`
- Modify: `src/renderer/src/utils/filters/filterSerialization.ts:87,145`
- Modify: `src/renderer/src/utils/filters/activeFilters.ts:123`
- Modify: `src/renderer/src/utils/filters/filterClearing.ts:29,77`
- Modify: `src/renderer/src/utils/filters/presetApplication.ts:18,61,82,119,160`
- Modify: `src/renderer/src/composables/useFilterPresetStore.ts:110`
- Modify: `src/renderer/src/composables/useFilterEmitScheduler.ts:23`
- Test: `tests/renderer/utils/filters/maxCarriers.test.ts` (create)
- Test: `tests/renderer/composables/useFilterPresetStore.test.ts`

**Interfaces:**
- Consumes: `FilterState.maxCarriers`, `FilterIpcParams.carrier_count_max`, `VariantFilter.carrier_count_max` (Task 1).
- Produces:
  - `activeMaxCarriers(value: unknown): number | null` (the cap when it is an integer >= 1, else `null`)
  - `parseMaxCarriers(raw: string | number | null | undefined): number | null`
  - `maxCarriersLabel(cap: number): string` (for example `≤ 3 cases`)
  - `summarizeInternalFilters(filters: Pick<FilterState, 'maxInternalAf' | 'maxCarriers'>): string`
  - chip `{ id: 'max-carriers', label: 'Seen in', value: '≤ 3 cases' }` from `buildActiveFiltersList`
  - `FilterId` member `'max-carriers'`; `clearFilter('max-carriers')` returns `{ maxCarriers: null }`
  - `buildFilterIpcParams` and `buildVariantFilterFromState` set `carrier_count_max`
  - presets save, apply, merge and diverge on `maxCarriers` in both views
  - `TYPED_FILTER_FIELDS` contains `'maxCarriers'`

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/utils/filters/maxCarriers.test.ts`:

```ts
/**
 * Carrier cap (#455) in the renderer state utilities. The preset behaviour is
 * asserted for the case view and the cohort view so the two cannot drift.
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'

import { TYPED_FILTER_FIELDS } from '../../../../src/renderer/src/composables/useFilterEmitScheduler'
import {
  buildActiveFiltersList,
  summarizeInternalFilters
} from '../../../../src/renderer/src/utils/filters/activeFilters'
import {
  clearAllFilters,
  clearFilter
} from '../../../../src/renderer/src/utils/filters/filterClearing'
import {
  buildFilterIpcParams,
  buildVariantFilterFromState
} from '../../../../src/renderer/src/utils/filters/filterSerialization'
import {
  activeMaxCarriers,
  maxCarriersLabel,
  parseMaxCarriers
} from '../../../../src/renderer/src/utils/filters/maxCarriers'
import {
  applyPresetStateToFilters,
  buildPresetFilterJson,
  isPresetDiverged
} from '../../../../src/renderer/src/utils/filters/presetApplication'
import { createFilterState } from '../../../../src/shared/filters/filterDefaults'
import type { FilterState } from '../../../../src/shared/types/filters'

const RARE_NOT_RECURRENT: Partial<FilterState> = { maxGnomadAf: 0.01, maxCarriers: 3 }

describe('carrier cap value', () => {
  // Review Focus 1
  it.each([
    ['3', 3],
    [3, 3],
    ['2.7', 2],
    ['1', 1],
    ['0', null],
    ['-4', null],
    ['0.9', null],
    ['', null],
    ['abc', null],
    [null, null],
    [undefined, null]
  ])('parseMaxCarriers(%j) is %j', (raw, expected) => {
    expect(parseMaxCarriers(raw)).toBe(expected)
  })

  // Review Focus 2
  it.each([
    [3, 3],
    [1, 1],
    [0, null],
    [-1, null],
    [2.5, null],
    [Number.NaN, null],
    ['3', null],
    [null, null]
  ])('activeMaxCarriers(%j) is %j', (value, expected) => {
    expect(activeMaxCarriers(value)).toBe(expected)
  })

  it('reads as a number of cases', () => {
    expect(maxCarriersLabel(1)).toBe('≤ 1 case')
    expect(maxCarriersLabel(3)).toBe('≤ 3 cases')
  })
})

describe('carrier cap serialization', () => {
  it('sends an active cap as carrier_count_max on both query shapes', () => {
    const filters = createFilterState({ maxCarriers: 3 })
    expect(buildFilterIpcParams(filters).carrier_count_max).toBe(3)
    expect(buildVariantFilterFromState(filters, []).carrier_count_max).toBe(3)
  })

  // Review Focus 2: the schema rejects these, so they must never be sent.
  it.each([null, 0, -1, 2.5, Number.NaN, ''])('sends nothing for %j', (value) => {
    const filters = createFilterState({ maxCarriers: value as never })
    expect(buildFilterIpcParams(filters)).not.toHaveProperty('carrier_count_max')
    expect(buildVariantFilterFromState(filters, [])).not.toHaveProperty('carrier_count_max')
  })
})

describe('carrier cap chip, summary and clearing', () => {
  it('shows a chip while the cap is on', () => {
    const chip = buildActiveFiltersList(createFilterState({ maxCarriers: 3 })).find(
      (f) => f.id === 'max-carriers'
    )
    expect(chip).toEqual({ id: 'max-carriers', label: 'Seen in', value: '≤ 3 cases' })
    expect(
      buildActiveFiltersList(createFilterState()).find((f) => f.id === 'max-carriers')
    ).toBeUndefined()
    expect(
      buildActiveFiltersList(createFilterState({ maxCarriers: 0 })).find(
        (f) => f.id === 'max-carriers'
      )
    ).toBeUndefined()
  })

  it('summarizes the internal filters of the drawer panel', () => {
    expect(summarizeInternalFilters({ maxInternalAf: null, maxCarriers: null })).toBe('')
    expect(summarizeInternalFilters({ maxInternalAf: 0.05, maxCarriers: null })).toBe('<= 5.00%')
    expect(summarizeInternalFilters({ maxInternalAf: null, maxCarriers: 3 })).toBe(
      '≤ 3 cases'
    )
    expect(summarizeInternalFilters({ maxInternalAf: 0.05, maxCarriers: 1 })).toBe(
      '<= 5.00%, ≤ 1 case'
    )
  })

  it('clears with its chip and with Clear all', () => {
    expect(clearFilter('max-carriers')).toEqual({ maxCarriers: null })
    expect(clearAllFilters().maxCarriers).toBeNull()
  })

  it('a typed cap waits for a typing pause like the other number fields', () => {
    expect(TYPED_FILTER_FIELDS.has('maxCarriers')).toBe(true)
  })
})

interface View {
  filters: Ref<FilterState>
  apply(presetState: Partial<FilterState>): void
  diverged(presetFilterJson: Partial<FilterState>): boolean
}

function caseView(): View {
  const filters = ref<FilterState>(createFilterState())
  return {
    filters,
    apply: (presetState) => applyPresetStateToFilters({ filters, presetState }),
    diverged: (presetFilterJson) => isPresetDiverged({ filters: filters.value, presetFilterJson })
  }
}

function cohortView(): View {
  const filters = ref<FilterState>(createFilterState())
  const impact = ref<string[]>([])
  return {
    filters,
    apply: (presetState) =>
      applyPresetStateToFilters({
        filters,
        presetState,
        consequencesTarget: impact,
        includeCohortFields: true
      }),
    diverged: (presetFilterJson) =>
      isPresetDiverged({
        filters: filters.value,
        presetFilterJson,
        consequencesValue: impact.value
      })
  }
}

describe.each([['case', caseView] as const, ['cohort', cohortView] as const])(
  'preset carrier cap, %s view',
  (_name, makeView) => {
    it('applies the cap and serializes it', () => {
      const view = makeView()
      view.apply(RARE_NOT_RECURRENT)

      expect(view.filters.value).toMatchObject({ maxGnomadAf: 0.01, maxCarriers: 3 })
      expect(buildFilterIpcParams(view.filters.value)).toMatchObject({
        gnomad_af_max: 0.01,
        carrier_count_max: 3
      })
    })

    it('turns the cap off when the preset is toggled off', () => {
      const view = makeView()
      view.apply(RARE_NOT_RECURRENT)
      view.apply({})

      expect(view.filters.value.maxCarriers).toBeNull()
      expect(buildFilterIpcParams(view.filters.value)).not.toHaveProperty('carrier_count_max')
    })

    it('reports divergence once the user changes the cap', () => {
      const view = makeView()
      view.apply(RARE_NOT_RECURRENT)
      expect(view.diverged(RARE_NOT_RECURRENT)).toBe(false)

      view.filters.value.maxCarriers = 5
      expect(view.diverged(RARE_NOT_RECURRENT)).toBe(true)
    })

    it('does not treat the cap as divergence for a preset that never set it', () => {
      const view = makeView()
      view.apply({ maxGnomadAf: 0.01 })

      view.filters.value.maxCarriers = 5
      expect(view.diverged({ maxGnomadAf: 0.01 })).toBe(false)
    })

    it('a saved preset round-trips the cap', () => {
      const saved = buildPresetFilterJson(createFilterState({ maxGnomadAf: 0.01, maxCarriers: 3 }))
      expect(saved).toEqual({ maxGnomadAf: 0.01, maxCarriers: 3 })

      const view = makeView()
      view.apply(saved)
      expect(view.filters.value).toMatchObject({ maxGnomadAf: 0.01, maxCarriers: 3 })
    })
  }
)
```

In `tests/renderer/composables/useFilterPresetStore.test.ts`, add this test directly after the test `getActiveFilterState carries maxInternalAf for the %s view (last preset wins)`:

```ts
  it.each(['case', 'cohort'] as const)(
    'getActiveFilterState carries maxCarriers for the %s view (last preset wins)',
    async (scope) => {
      mockApi.list.mockResolvedValueOnce([
        { ...mockPresets[0], filterJson: { maxGnomadAf: 0.01, maxCarriers: 3 } },
        { ...mockPresets[1], filterJson: { consequences: ['HIGH'], maxCarriers: 1 } }
      ])
      const { togglePreset, getActiveFilterState, loadPresets } = useFilterPresetStore(scope)
      await loadPresets()

      togglePreset(1)
      expect(getActiveFilterState()).toMatchObject({ maxGnomadAf: 0.01, maxCarriers: 3 })

      togglePreset(2)
      expect(getActiveFilterState().maxCarriers).toBe(1)

      togglePreset(1)
      togglePreset(2)
      expect(getActiveFilterState().maxCarriers).toBeUndefined()
    }
  )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/renderer/utils/filters/maxCarriers.test.ts tests/renderer/composables/useFilterPresetStore.test.ts`

Expected: FAIL. `maxCarriers.test.ts` fails to load with `Failed to resolve import ".../utils/filters/maxCarriers"`. The preset store test fails with `expected { maxGnomadAf: 0.01 } to match object { maxGnomadAf: 0.01, maxCarriers: 3 }`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/renderer/src/utils/filters/maxCarriers.ts`:

```ts
/**
 * Carrier cap ("seen in at most N cases", #455): the one place that decides
 * when the cap is on and how it reads. Shared by the case and the cohort view.
 */

/** The cap when it is on: a whole number of cases, at least 1. Anything else is off. */
export function activeMaxCarriers(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null
}

/** Text typed into the field as a cap. Empty, not a number or below 1 turns it off. */
export function parseMaxCarriers(raw: string | number | null | undefined): number | null {
  const typed = typeof raw === 'number' ? raw : Number.parseFloat(raw ?? '')
  return Number.isFinite(typed) && typed >= 1 ? Math.floor(typed) : null
}

/** Chip and summary text, for example "≤ 3 cases". */
export function maxCarriersLabel(cap: number): string {
  return `≤ ${cap} ${cap === 1 ? 'case' : 'cases'}`
}
```

`src/renderer/src/utils/filters/index.ts`, replace the `// Active filters computation` export and add one line:

```ts
// Active filters computation
export { buildActiveFiltersList, formatAfPercent, summarizeInternalFilters } from './activeFilters'
export { activeMaxCarriers, maxCarriersLabel, parseMaxCarriers } from './maxCarriers'
```

`src/renderer/src/utils/filters/activeFilters.ts`: add the import after the existing imports.

```ts
import { activeMaxCarriers, maxCarriersLabel } from './maxCarriers'
```

Same file, add this function directly after `formatAfPercent`:

```ts
/** Collapsed summary of the "Internal Frequency" drawer panel (both drawers). */
export function summarizeInternalFilters(
  filters: Pick<FilterState, 'maxInternalAf' | 'maxCarriers'>
): string {
  const parts: string[] = []
  if (filters.maxInternalAf !== null && filters.maxInternalAf > 0) {
    parts.push(`<= ${formatAfPercent(filters.maxInternalAf)}%`)
  }
  const maxCarriers = activeMaxCarriers(filters.maxCarriers)
  if (maxCarriers !== null) parts.push(maxCarriersLabel(maxCarriers))
  return parts.join(', ')
}
```

Same file, function `buildActiveFiltersList`, directly after the `maxInternalAf` chip block:

```ts
  const maxCarriers = activeMaxCarriers(filters.maxCarriers)
  if (maxCarriers !== null) {
    list.push({ id: 'max-carriers', label: 'Seen in', value: maxCarriersLabel(maxCarriers) })
  }
```

`src/renderer/src/utils/filters/filterSerialization.ts`: add the import.

```ts
import { activeMaxCarriers } from './maxCarriers'
```

Same file, function `buildFilterIpcParams`, directly after the `maxInternalAf` block:

```ts
  const maxCarriers = activeMaxCarriers(plainState.maxCarriers)
  if (maxCarriers !== null) {
    params.carrier_count_max = maxCarriers
  }
```

Same file, function `buildVariantFilterFromState`, directly after the `max_internal_af` block:

```ts
  if (ipcParams.carrier_count_max !== undefined) {
    variantFilter.carrier_count_max = ipcParams.carrier_count_max
  }
```

`src/renderer/src/utils/filters/filterClearing.ts`, type `FilterId`, after `| 'internal-frequency'`:

```ts
  | 'max-carriers'
```

Same file, function `clearFilter`, after the `'internal-frequency'` case:

```ts
    case 'max-carriers':
      return { maxCarriers: FILTER_DEFAULTS.maxCarriers }
```

`src/renderer/src/utils/filters/presetApplication.ts`, interface `FilterFields`, after `maxInternalAf: number | null`:

```ts
  /** Carrier cap, same meaning in case and cohort view. */
  maxCarriers: number | null
```

Same file, function `applyPresetStateToFilters`, Step 1 (reset), after `filters.value.maxInternalAf = null`:

```ts
  filters.value.maxCarriers = null
```

Same function, Step 2 (apply), after the `maxInternalAf` lines:

```ts
  if (presetState.maxCarriers !== undefined) filters.value.maxCarriers = presetState.maxCarriers
```

Same file, function `buildPresetFilterJson`, replace the key list of the first loop:

```ts
  for (const key of [
    'maxGnomadAf',
    'maxInternalAf',
    'maxCarriers',
    'minCadd',
    'minCarriers'
  ] as const) {
```

Same file, function `isPresetDiverged`, after the `maxInternalAf` line:

```ts
  if (fj.maxCarriers !== undefined && filters.maxCarriers !== fj.maxCarriers) return true
```

`src/renderer/src/composables/useFilterPresetStore.ts`, function `getActiveFilterState`, after the `maxInternalAf` line:

```ts
      if (fj.maxCarriers !== undefined) merged.maxCarriers = fj.maxCarriers
```

`src/renderer/src/composables/useFilterEmitScheduler.ts`, set `TYPED_FILTER_FIELDS`, after `'maxInternalAf',`:

```ts
  'maxCarriers',
```

- [ ] **Step 4: Run the tests and the type check to verify they pass**

Run: `npx vitest run tests/renderer/utils/filters tests/renderer/composables/useFilterPresetStore.test.ts && make typecheck`

Expected: PASS, and `make typecheck` exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/filters/maxCarriers.ts src/renderer/src/utils/filters/index.ts \
  src/renderer/src/utils/filters/activeFilters.ts \
  src/renderer/src/utils/filters/filterSerialization.ts \
  src/renderer/src/utils/filters/filterClearing.ts \
  src/renderer/src/utils/filters/presetApplication.ts \
  src/renderer/src/composables/useFilterPresetStore.ts \
  src/renderer/src/composables/useFilterEmitScheduler.ts \
  tests/renderer/utils/filters/maxCarriers.test.ts \
  tests/renderer/composables/useFilterPresetStore.test.ts
git commit -m "feat(renderer): carrier cap in filter state, chips and presets (#455)"
```

---

### Task 8: Renderer composables and cohort query wiring

**Files:**
- Modify: `src/renderer/src/composables/useFilterComputed.ts:12,85-105,129-134,197-198,262-267,315-317`
- Modify: `src/renderer/src/composables/useFilters.ts:21-27,195,261`
- Modify: `src/renderer/src/composables/useCohortData.ts:60,323-325,459`
- Modify: `src/renderer/src/components/CohortTable.vue` (function `buildCohortQueryParams`)
- Modify: `src/renderer/src/components/cohort/CohortFilterBar.vue:150-155,387-392`
- Test: `tests/renderer/composables/useFilterComputed.test.ts`
- Test: `tests/renderer/composables/useFilters.test.ts`
- Test: `tests/renderer/composables/useCohortData.test.ts:330-370`
- Test: `tests/renderer/components/CohortTable.paging.test.ts`

**Interfaces:**
- Consumes: `activeMaxCarriers`, `maxCarriersLabel`, `summarizeInternalFilters` (Task 7); `FilterState.maxCarriers` (Task 1).
- Produces:
  - `CohortQueryParams.carrier_count_max?: number`, passed through `useCohortData` to `window.api.cohort.getVariants`
  - `CohortTable.vue` sends `carrier_count_max` with the table query and the export
  - case view: chip `{ id: 'max-carriers', label: 'Seen in', value }`, `clearFilter('max-carriers')`, `isFilterGroupActive('internal-frequency')` true while the cap is on
  - cohort view: `hasActiveFilters` true while the cap is on; `clearAllFilters` turns it off

`CohortTable.buildCohortQueryParams` lists every filter by hand and does not send `carrier_count_min` today. The cap must be added there explicitly or the cohort drawer field would do nothing.

`useCohortData.ts` is at 595 of 600 lines. This task adds exactly 5 lines to it.

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/renderer/composables/useFilterComputed.test.ts` (the file defines `makeFilters` and `makeOptions` at module scope):

```ts
describe('useFilterComputed: carrier cap (#455)', () => {
  it('counts, lists, groups and clears the cap', () => {
    const [result, app] = withSetup(() => {
      const filters = ref(makeFilters({ maxCarriers: 3 }))
      return { filters, ...useFilterComputed(makeOptions(filters)) }
    })
    try {
      expect(result.hasActiveFilters.value).toBe(true)
      expect(result.activeFilterCount.value).toBe(1)
      expect(result.activeFiltersList.value).toEqual([
        { id: 'max-carriers', label: 'Seen in', value: '≤ 3 cases' }
      ])
      expect(result.isFilterGroupActive('internal-frequency')).toBe(true)

      result.clearFilter('max-carriers')

      expect(result.filters.value.maxCarriers).toBeNull()
      expect(result.hasActiveFilters.value).toBe(false)
      expect(result.isFilterGroupActive('internal-frequency')).toBe(false)
    } finally {
      app.unmount()
    }
  })

  it('treats an invalid stored cap as off', () => {
    const [result, app] = withSetup(() => {
      const filters = ref(makeFilters({ maxCarriers: 0 }))
      return useFilterComputed(makeOptions(filters))
    })
    try {
      expect(result.hasActiveFilters.value).toBe(false)
      expect(result.activeFiltersList.value).toEqual([])
    } finally {
      app.unmount()
    }
  })
})
```

Append to the end of `tests/renderer/composables/useFilters.test.ts`:

```ts
describe('useFilters: carrier cap (#455)', () => {
  it('is an active filter with a chip, and reaches the IPC params', () => {
    const [result, app] = withSetup(() => createFilters())
    try {
      result.filters.value.maxCarriers = 3

      expect(result.hasActiveFilters.value).toBe(true)
      expect(result.activeFiltersList.value).toContainEqual({
        id: 'max-carriers',
        label: 'Seen in',
        value: '≤ 3 cases'
      })
      expect(result.getIpcParams().carrier_count_max).toBe(3)
    } finally {
      app.unmount()
    }
  })

  it('is turned off by its chip and by Clear all', () => {
    const [result, app] = withSetup(() => createFilters())
    try {
      result.filters.value.maxCarriers = 3
      result.clearFilter('max-carriers')
      expect(result.filters.value.maxCarriers).toBeNull()

      result.filters.value.maxCarriers = 3
      result.clearAllFilters()
      expect(result.filters.value.maxCarriers).toBeNull()
      expect(result.hasActiveFilters.value).toBe(false)
    } finally {
      app.unmount()
    }
  })

  it('the internal frequency alone is an active filter too', () => {
    const [result, app] = withSetup(() => createFilters())
    try {
      result.filters.value.maxInternalAf = 0.05
      expect(result.hasActiveFilters.value).toBe(true)
    } finally {
      app.unmount()
    }
  })
})
```

In `tests/renderer/composables/useCohortData.test.ts`, test `passes filter params to IPC call`: add `carrier_count_max: 3` after `carrier_count_min: 2` in the `fetchVariants` argument and in the `expect.objectContaining` object (add a comma after `carrier_count_min: 2` in both).

In `tests/renderer/components/CohortTable.paging.test.ts`, add this test directly after the test `exports with the same filter params as the table query`:

```ts
  // #455: the cap of the cohort drawer reaches the table query and the export.
  it('sends the carrier cap with the table query and the export', async () => {
    const exportCohort = vi.fn(async () => ({ success: true, filePath: '/tmp/cohort.xlsx' }))
    window.api.export.cohort = exportCohort as never

    const bar = wrapper.findComponent({ name: 'CohortFilterBar' })

    filtersCtx.filters.value.maxCarriers = 3
    // What the real filter bar does after a state change.
    await bar.vm.$emit('filter-change')
    await vi.waitFor(() => expect(queries().at(-1)).toMatchObject({ carrier_count_max: 3 }))

    await bar.vm.$emit('export')
    await flushPromises()
    expect(exportCohort.mock.calls[0][0]).toMatchObject({ carrier_count_max: 3 })

    filtersCtx.filters.value.maxCarriers = null
    await bar.vm.$emit('filter-change')
    await vi.waitFor(() => expect(queries().at(-1)).not.toHaveProperty('carrier_count_max'))
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/renderer/composables/useFilterComputed.test.ts tests/renderer/composables/useFilters.test.ts tests/renderer/composables/useCohortData.test.ts tests/renderer/components/CohortTable.paging.test.ts`

Expected: FAIL. `useFilterComputed`: `expected false to be true` for `hasActiveFilters`. `useFilters`: `hasActiveFilters` is false for the cap and for the internal frequency (the chip, `getIpcParams` and `clearFilter` assertions pass since Task 7). `useCohortData`: the IPC call lacks `carrier_count_max`. `CohortTable`: `vi.waitFor` times out on `carrier_count_max: 3`.

- [ ] **Step 3: Write the minimal implementation**

`src/renderer/src/composables/useFilterComputed.ts`, replace the import of `formatAfPercent`:

```ts
import {
  activeMaxCarriers,
  formatAfPercent,
  maxCarriersLabel,
  summarizeInternalFilters
} from '../utils/filters'
```

Same file, computed `hasActiveFilters`: add after the `internalAfActive` constant

```ts
    const maxCarriersActive = activeMaxCarriers(filters.value.maxCarriers) !== null
```

and add after `internalAfActive ||` in the returned expression

```ts
      maxCarriersActive ||
```

Same file, computed `activeFilterCount`, after the `maxInternalAf` block:

```ts
    if (activeMaxCarriers(filters.value.maxCarriers) !== null) count++
```

Same file, computed `activeFiltersList`, after the `internal-frequency` chip block:

```ts
    const maxCarriers = activeMaxCarriers(filters.value.maxCarriers)
    if (maxCarriers !== null) {
      list.push({ id: 'max-carriers', label: 'Seen in', value: maxCarriersLabel(maxCarriers) })
    }
```

Same file, function `isFilterGroupActive`, replace the body of `case 'internal-frequency':`:

```ts
      case 'internal-frequency':
        return summarizeInternalFilters(filters.value) !== ''
```

Same file, function `clearFilter`, after the `'internal-frequency'` case:

```ts
      case 'max-carriers':
        filters.value.maxCarriers = null
        break
```

`src/renderer/src/composables/useFilters.ts`, import block from `'../utils/filters'`: add `summarizeInternalFilters,` after `buildActiveFiltersList,`.

Same file, function `clearAllFilters`, after `filters.value.maxInternalAf = null`:

```ts
    filters.value.maxCarriers = null
```

Same file, computed `hasActiveFilters`, in the returned expression after the `minCarriers` line. This one line also makes the internal frequency count as an active filter in the cohort view, which it did not before:

```ts
      summarizeInternalFilters(filters.value) !== '' ||
```

`src/renderer/src/composables/useCohortData.ts`, interface `CohortQueryParams`, after `carrier_count_min?: number` (no doc comment, see the line budget):

```ts
  carrier_count_max?: number
```

Same file, function `buildIpcParams`, after the `carrier_count_min` block:

```ts
    if (params.carrier_count_max !== undefined) {
      ipcParams.carrier_count_max = params.carrier_count_max
    }
```

Same file, the `filterHash` object in the fetch function, after `carrier_count_min: params.carrier_count_min,`:

```ts
        carrier_count_max: params.carrier_count_max,
```

`src/renderer/src/components/CohortTable.vue`, add the import next to the other `../utils/` imports:

```ts
import { activeMaxCarriers } from '../utils/filters/maxCarriers'
```

Same file, function `buildCohortQueryParams`, after the `max_internal_af` line:

```ts
  carrier_count_max: activeMaxCarriers(filters.value.maxCarriers) ?? undefined,
```

`src/renderer/src/components/cohort/CohortFilterBar.vue`, import block from `'../../utils/filters'`: add `summarizeInternalFilters` as the last name.

```ts
import {
  ACMG_FILTER_OPTIONS,
  applyPresetStateToFilters,
  buildPresetFilterJson,
  isPresetDiverged,
  summarizeInternalFilters
} from '../../utils/filters'
```

Same file, function `isFilterGroupActive`, replace the body of `case 'internal-frequency':` (five lines become one):

```ts
    case 'internal-frequency':
      return summarizeInternalFilters(filters.value) !== ''
```

- [ ] **Step 4: Run the tests, the type check and the size check to verify they pass**

Run: `npx vitest run tests/renderer/composables tests/renderer/components/CohortTable.paging.test.ts tests/renderer/components/CohortFilterBar.test.ts && make typecheck && make agent-check && wc -l src/renderer/src/composables/useCohortData.ts`

Expected: PASS; `make typecheck` and `make agent-check` exit 0; `useCohortData.ts` has 600 lines.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/composables/useFilterComputed.ts src/renderer/src/composables/useFilters.ts \
  src/renderer/src/composables/useCohortData.ts src/renderer/src/components/CohortTable.vue \
  src/renderer/src/components/cohort/CohortFilterBar.vue \
  tests/renderer/composables/useFilterComputed.test.ts tests/renderer/composables/useFilters.test.ts \
  tests/renderer/composables/useCohortData.test.ts tests/renderer/components/CohortTable.paging.test.ts
git commit -m "feat(renderer): send the carrier cap from the case and the cohort view (#455)"
```

---

### Task 9: Drawer field and mock API

**Files:**
- Create: `src/renderer/src/components/filters/MaxCarriersField.vue`
- Modify: `src/renderer/src/components/FilterDrawer.vue:553-554,294-295,753-759`
- Modify: `src/renderer/src/components/cohort/CohortFilterDrawer.vue:418-420,295-296,612-618`
- Modify: `src/renderer/src/components/cohort/cohortFilterDrawerTypes.ts:34`
- Modify: `src/renderer/src/mocks/mockApi.ts` (method `cohort.getVariants`)
- Test: `tests/renderer/components/filters/MaxCarriersField.test.ts` (create)
- Test: `tests/renderer/mocks/mockApi-cohort-max-carriers.test.ts` (create)

**Interfaces:**
- Consumes: `parseMaxCarriers`, `summarizeInternalFilters` (Task 7); `FilterState.maxCarriers`, `CohortSearchParams.carrier_count_max` (Task 1).
- Produces: `MaxCarriersField` with props `modelValue: number | null`, `scope: 'case' | 'cohort'` and emit `update:modelValue: [value: number | null]`. Both drawers show it inside the existing "Internal Frequency" panel, below the internal AF field.

Line budget: `FilterDrawer.vue` has no headroom (857/857) and `mockApi.ts` has none (1236/1236). In each drawer this task adds three lines (two imports, one template line) and replaces the seven-line `internalFrequencySummary` computed with one line: net minus three. In `mockApi.ts` the 16-line inline parameter type of `cohort.getVariants` is replaced by the shared `CohortSearchParams`: net minus ten.

The mock API filters the cohort view only. Its case view has no frequency data and ignores the internal frequency filter already; that stays as it is.

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/components/filters/MaxCarriersField.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import MaxCarriersField from '../../../../src/renderer/src/components/filters/MaxCarriersField.vue'

const vuetify = createVuetify({ components, directives })

function field(props: { modelValue: number | null; scope: 'case' | 'cohort' }): VueWrapper {
  return mount(MaxCarriersField, { global: { plugins: [vuetify] }, props })
}

async function type(wrapper: VueWrapper, text: string): Promise<unknown> {
  await wrapper.find('input').setValue(text)
  return wrapper.emitted('update:modelValue')?.at(-1)?.[0]
}

describe('MaxCarriersField', () => {
  it('is labelled and says in the case view that this case is included', () => {
    const wrapper = field({ modelValue: null, scope: 'case' })
    expect(wrapper.text()).toContain('Seen in at most N cases')
    expect(wrapper.text()).toContain('including this case')
  })

  it('does not mention "this case" in the cohort view', () => {
    const wrapper = field({ modelValue: null, scope: 'cohort' })
    expect(wrapper.text()).toContain('Seen in at most N cases')
    expect(wrapper.text()).not.toContain('this case')
  })

  it('shows the stored cap', () => {
    const wrapper = field({ modelValue: 3, scope: 'case' })
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('3')
  })

  // Review Focus 1
  it('emits a whole number of cases, and null for anything below 1', async () => {
    const wrapper = field({ modelValue: null, scope: 'case' })
    expect(await type(wrapper, '3')).toBe(3)
    expect(await type(wrapper, '2.7')).toBe(2)
    expect(await type(wrapper, '0')).toBeNull()
    expect(await type(wrapper, '-4')).toBeNull()
    expect(await type(wrapper, '')).toBeNull()
  })
})
```

Create `tests/renderer/mocks/mockApi-cohort-max-carriers.test.ts`:

```ts
/**
 * The dev-mode mock aggregates the cohort itself; it honours the carrier cap
 * (#455) like both real backends.
 */
import { describe, expect, it } from 'vitest'
import { mockVariants } from '../../../src/renderer/src/mocks/fixtures/variants'

describe('mock cohort carrier cap', () => {
  it('keeps the variants seen in at most N cases; a cap below 1 is off', async () => {
    const [first, second] = [...new Set(mockVariants.map((v) => v.case_id))]
    const shared = { ...mockVariants[0], chr: 'chr9', pos: 434343 }
    const single = { ...mockVariants[0], chr: 'chr9', pos: 434344 }
    mockVariants.push(
      { ...shared, id: 990011, case_id: first },
      { ...shared, id: 990012, case_id: second },
      { ...single, id: 990013, case_id: first }
    )
    try {
      const { mockApi } = await import('../../../src/renderer/src/mocks/mockApi')
      const positions = async (max?: number): Promise<number[]> => {
        const result = (await mockApi.cohort.getVariants({
          limit: 10000,
          carrier_count_max: max
        } as never)) as unknown as { data: Array<{ pos: number; carrier_count: number }> }
        if (max !== undefined && max >= 1) {
          expect(result.data.every((v) => v.carrier_count <= max)).toBe(true)
        }
        return result.data.map((v) => v.pos)
      }

      const capped = await positions(1)
      expect(capped).toContain(434344)
      expect(capped).not.toContain(434343)
      expect(await positions(2)).toContain(434343)
      expect(await positions(0)).toContain(434343)
      expect(await positions()).toContain(434343)
    } finally {
      mockVariants.splice(-3)
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/renderer/components/filters/MaxCarriersField.test.ts tests/renderer/mocks/mockApi-cohort-max-carriers.test.ts`

Expected: FAIL. The component test fails to load with `Failed to resolve import ".../MaxCarriersField.vue"`. The mock test fails with `expected [ ... ] not to include 434343`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/renderer/src/components/filters/MaxCarriersField.vue`:

```vue
<template>
  <v-text-field
    :model-value="modelValue ?? ''"
    class="mt-3"
    density="compact"
    variant="outlined"
    type="number"
    step="1"
    min="1"
    label="Seen in at most N cases"
    :hint="hint"
    persistent-hint
    clearable
    data-testid="max-carriers-field"
    @update:model-value="emit('update:modelValue', parseMaxCarriers($event))"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { parseMaxCarriers } from '../../utils/filters/maxCarriers'

const props = defineProps<{
  /** The cap, or null when the filter is off */
  modelValue: number | null
  /** The case view says that the open case counts too */
  scope: 'case' | 'cohort'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

const hint = computed(() =>
  props.scope === 'case'
    ? 'Counts all cases in this database, including this case.'
    : 'Counts all cases in this database that carry the variant.'
)
</script>
```

`src/renderer/src/components/FilterDrawer.vue`, script: add after the `FilterPanelTitle` import

```ts
import MaxCarriersField from './filters/MaxCarriersField.vue'
```

and after the `'../utils/filters'` import line

```ts
import { summarizeInternalFilters } from '../utils/filters/activeFilters'
```

Same file, template, panel `<v-expansion-panel value="internal-frequency">`: add one line after the closing `/>` of the `v-text-field` bound to `customInternalAf`, before `</v-expansion-panel-text>`:

```vue
          <MaxCarriersField v-model="filters.maxCarriers" scope="case" />
```

Same file, script: replace the whole `internalFrequencySummary` computed (seven lines) with one line:

```ts
const internalFrequencySummary = computed(() => summarizeInternalFilters(filters.value))
```

`src/renderer/src/components/cohort/CohortFilterDrawer.vue`, script: add after the `FilterPanelTitle` import

```ts
import MaxCarriersField from '../filters/MaxCarriersField.vue'
```

and after the `'../../utils/filters'` import line

```ts
import { summarizeInternalFilters } from '../../utils/filters/activeFilters'
```

Same file, template, panel `<v-expansion-panel value="internal-frequency">`: add one line after the closing `/>` of the `v-text-field` bound to `customInternalAf`:

```vue
          <MaxCarriersField v-model="filters.maxCarriers" scope="cohort" />
```

Same file, script: replace the whole `internalFrequencySummary` computed (seven lines) with one line:

```ts
const internalFrequencySummary = computed(() => summarizeInternalFilters(filters.value))
```

`src/renderer/src/components/cohort/cohortFilterDrawerTypes.ts`, interface `CohortFilterDrawerState`, in the `filters` ref type after `maxInternalAf: number | null`:

```ts
    maxCarriers: number | null
```

`src/renderer/src/mocks/mockApi.ts`: add the import after the `WindowAPI` import.

```ts
import type { CohortSearchParams } from '../../../shared/types/cohort'
```

Same file, method `cohort.getVariants`: replace the inline parameter type. The 16 lines from `getVariants: async (params?: {` to `}) => {` become:

```ts
    getVariants: async (params?: CohortSearchParams) => {
```

Same method, directly after the `carrier_count_min` filter block:

```ts
      // Apply carrier count max filter (a cap below 1 is off)
      if (params?.carrier_count_max !== undefined && params.carrier_count_max >= 1) {
        cohortVariants = cohortVariants.filter((v) => v.carrier_count <= params.carrier_count_max!)
      }
```

- [ ] **Step 4: Run the tests and the gates to verify they pass**

Run: `npx vitest run tests/renderer/components tests/renderer/mocks && make typecheck && make agent-check && wc -l src/renderer/src/components/FilterDrawer.vue src/renderer/src/components/cohort/CohortFilterDrawer.vue src/renderer/src/mocks/mockApi.ts`

Expected: PASS; `make typecheck` and `make agent-check` exit 0. On top of `main` the counts are `FilterDrawer.vue` 854, `CohortFilterDrawer.vue` 676, `mockApi.ts` 1227 or fewer; none may exceed its number in `scripts/agent-health-baseline.json`. If `npm run format:check` reports one of these files, run `npx prettier --write <file>` and count again.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/filters/MaxCarriersField.vue \
  src/renderer/src/components/FilterDrawer.vue \
  src/renderer/src/components/cohort/CohortFilterDrawer.vue \
  src/renderer/src/components/cohort/cohortFilterDrawerTypes.ts \
  src/renderer/src/mocks/mockApi.ts \
  tests/renderer/components/filters/MaxCarriersField.test.ts \
  tests/renderer/mocks/mockApi-cohort-max-carriers.test.ts
git commit -m "feat(ui): 'Seen in at most N cases' field in both filter drawers (#455)"
```

---

### Task 10: Built-in preset and migrations (SQLite v45, PostgreSQL 0028)

**Files:**
- Modify: `src/main/database/built-in-presets.ts`
- Modify: `src/main/database/migrations.ts:11,21,71,1943`
- Create: `src/main/storage/postgres/migrations/sql/0028_rare_not_recurrent_preset.sql`
- Modify: `src/main/storage/postgres/migrations/definitions.ts:138-142`
- Modify: `scripts/postgres/seed-dev-workspace.mjs:89`
- Modify: `docs/features/filter-presets.md:29`
- Test: `tests/main/database/migration-v45.test.ts` (create)
- Test: `tests/main/storage/postgres-rare-not-recurrent-preset-migration.test.ts` (create, gated)
- Test: `tests/main/storage/postgres-migration-definitions.test.ts:7,35,64`
- Test: `tests/main/storage/postgres-migrations-idempotent.test.ts:169`
- Test: `tests/main/database/migrate-off-thread.test.ts:68,72,82,100`
- Test: `tests/main/database/migration-v41.test.ts:96,97,111,177,212,226,254`
- Test: `tests/main/database/migration-v42.test.ts:40,41,50,62`
- Test: `tests/main/startup-default-summary-rebuild.test.ts:136`

**Interfaces:**
- Consumes: `FilterState.maxCarriers` (Task 1).
- Produces:
  - `RARE_NOT_RECURRENT_PRESET_NAME = 'Rare, not recurrent'` and a ninth entry in `BUILT_IN_PRESETS`
  - `LATEST_SQLITE_SCHEMA_VERSION = 45`
  - PostgreSQL migration `0028` / `rare_not_recurrent_preset`

A new database gets the preset from the existing seeds, because SQLite v15/v16 and PostgreSQL 0005 (`seedWorkflowDefaults`) both loop over `BUILT_IN_PRESETS`. The new migrations add it to existing databases. Both use "insert, ignore a name conflict" (the `filter_presets.name` column is unique), so every other row is untouched.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/database/migration-v45.test.ts`:

```ts
/**
 * Migration v45 (#455): the built-in preset "Rare, not recurrent" is added to
 * existing databases. Every other preset row stays as it is.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BUILT_IN_PRESETS,
  RARE_NOT_RECURRENT_PRESET_NAME
} from '../../../src/main/database/built-in-presets'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'

interface PresetRow {
  name: string
  description: string | null
  filter_json: string
  is_built_in: number
  is_visible: number
  sort_order: number
  kind: string
}

describe('migration v45: built-in preset "Rare, not recurrent"', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => db.close())

  const preset = (): PresetRow[] =>
    db
      .prepare(
        `SELECT name, description, filter_json, is_built_in, is_visible, sort_order, kind
           FROM filter_presets WHERE name = ?`
      )
      .all(RARE_NOT_RECURRENT_PRESET_NAME) as PresetRow[]

  const otherRows = (): unknown[] =>
    db
      .prepare('SELECT * FROM filter_presets WHERE name != ? ORDER BY id')
      .all(RARE_NOT_RECURRENT_PRESET_NAME)

  /** Put the database back to v44, before the preset existed. */
  function backToV44(): void {
    db.prepare('DELETE FROM filter_presets WHERE name = ?').run(RARE_NOT_RECURRENT_PRESET_NAME)
    db.exec('PRAGMA user_version = 44')
  }

  it('is the latest schema version', () => {
    expect(LATEST_SQLITE_SCHEMA_VERSION).toBe(45)
    expect(db.pragma('user_version', { simple: true })).toBe(45)
  })

  it('a new database has the preset once, after the eight existing built-ins', () => {
    expect(preset()).toEqual([
      {
        name: 'Rare, not recurrent',
        description: 'gnomAD AF <= 1% + seen in at most 3 cases',
        filter_json: '{"maxGnomadAf":0.01,"maxCarriers":3}',
        is_built_in: 1,
        is_visible: 1,
        sort_order: 8,
        kind: 'filter'
      }
    ])
    const classic = db
      .prepare("SELECT name FROM filter_presets WHERE is_built_in = 1 AND kind = 'filter' ORDER BY sort_order")
      .all() as Array<{ name: string }>
    expect(classic.map((row) => row.name)).toEqual(BUILT_IN_PRESETS.map((p) => p.name))
    expect(classic).toHaveLength(9)
  })

  it('adds the preset to a v44 database and leaves every other row unchanged', () => {
    backToV44()
    const now = Date.now()
    db.prepare(
      `INSERT INTO filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, created_at, updated_at)
       VALUES ('My rare set', 'mine', '{"maxGnomadAf":0.001,"maxCarriers":2}', 0, 1, 20, ?, ?)`
    ).run(now, now)
    db.exec("UPDATE filter_presets SET is_visible = 0 WHERE name = 'Rare (1%)'")
    const before = otherRows()
    expect(preset()).toEqual([])

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(45)
    expect(preset()).toHaveLength(1)
    expect(preset()[0]).toMatchObject({ is_built_in: 1, sort_order: 8, kind: 'filter' })
    expect(otherRows()).toEqual(before)
  })

  // Review Focus 5
  it('keeps a user preset of the same name as it is', () => {
    backToV44()
    const now = Date.now()
    db.prepare(
      `INSERT INTO filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, created_at, updated_at)
       VALUES (?, 'my own', '{"minCadd":5}', 0, 1, 30, ?, ?)`
    ).run(RARE_NOT_RECURRENT_PRESET_NAME, now, now)

    runMigrations(db)

    expect(preset()).toEqual([
      {
        name: 'Rare, not recurrent',
        description: 'my own',
        filter_json: '{"minCadd":5}',
        is_built_in: 0,
        is_visible: 1,
        sort_order: 30,
        kind: 'filter'
      }
    ])
  })

  it('replaying the migration does not add a second row', () => {
    db.exec('PRAGMA user_version = 44')
    runMigrations(db)
    expect(preset()).toHaveLength(1)
  })

  // Review Focus 5
  it('does not fail on a database without a filter_presets table', () => {
    db.exec('DROP TABLE filter_presets')
    db.exec('PRAGMA user_version = 44')
    expect(() => runMigrations(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(45)
  })
})
```

Create `tests/main/storage/postgres-rare-not-recurrent-preset-migration.test.ts`:

```ts
/**
 * Migration 0028 (#455) against a real PostgreSQL: the built-in preset
 * "Rare, not recurrent" is added to an existing schema; every other preset
 * row stays as it is (mirrors SQLite v45).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RARE_NOT_RECURRENT_PRESET_NAME } from '../../../src/main/database/built-in-presets'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const BEFORE_0028 = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0028')

describe.skipIf(!RUN)('migration 0028: built-in preset "Rare, not recurrent" (#455)', () => {
  let schema: string
  let pool: Pool
  let probe: Client

  beforeEach(async () => {
    schema = `varlens_test_preset_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    // An existing schema: migrated before 0028, without the new preset (the
    // 0005 seed of this code version adds it, an older one did not).
    await new PostgresMigrationRunner(pool, schema, BEFORE_0028).migrate()
    await probe.query(`DELETE FROM "${schema}".filter_presets WHERE name = $1`, [
      RARE_NOT_RECURRENT_PRESET_NAME
    ])
  }, 120_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  const preset = async (): Promise<unknown[]> =>
    (
      await probe.query(
        `SELECT name, description, filter_json, is_built_in, is_visible,
                sort_order::int AS sort_order, kind
           FROM "${schema}".filter_presets WHERE name = $1`,
        [RARE_NOT_RECURRENT_PRESET_NAME]
      )
    ).rows

  const otherRows = async (): Promise<unknown[]> =>
    (
      await probe.query(`SELECT * FROM "${schema}".filter_presets WHERE name != $1 ORDER BY id`, [
        RARE_NOT_RECURRENT_PRESET_NAME
      ])
    ).rows

  const migrate = (): Promise<{ applied: string[] }> =>
    new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

  it('adds the preset and leaves every other row unchanged', async () => {
    await probe.query(
      `INSERT INTO "${schema}".filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
       VALUES ('My rare set', 'mine', '{"maxGnomadAf":0.001,"maxCarriers":2}', 0, 1, 20, 'filter', 1, 1)`
    )
    await probe.query(
      `UPDATE "${schema}".filter_presets SET is_visible = 0 WHERE name = 'Rare (1%)'`
    )
    const before = await otherRows()

    const result = await migrate()

    expect(result.applied).toEqual(['0028'])
    expect(await preset()).toEqual([
      {
        name: 'Rare, not recurrent',
        description: 'gnomAD AF <= 1% + seen in at most 3 cases',
        filter_json: '{"maxGnomadAf":0.01,"maxCarriers":3}',
        is_built_in: 1,
        is_visible: 1,
        sort_order: 8,
        kind: 'filter'
      }
    ])
    expect(await otherRows()).toEqual(before)
  }, 120_000)

  // Review Focus 5
  it('keeps a user preset of the same name as it is', async () => {
    await probe.query(
      `INSERT INTO "${schema}".filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
       VALUES ($1, 'my own', '{"minCadd":5}', 0, 1, 30, 'filter', 1, 1)`,
      [RARE_NOT_RECURRENT_PRESET_NAME]
    )

    await migrate()

    expect(await preset()).toEqual([
      {
        name: 'Rare, not recurrent',
        description: 'my own',
        filter_json: '{"minCadd":5}',
        is_built_in: 0,
        is_visible: 1,
        sort_order: 30,
        kind: 'filter'
      }
    ])
  }, 120_000)

  it('running the migrations again keeps one row', async () => {
    await migrate()
    await migrate()
    expect(await preset()).toHaveLength(1)
  }, 120_000)
})
```

In `tests/main/storage/postgres-migration-definitions.test.ts`:
- change `toHaveLength(27)` to `toHaveLength(28)`;
- in the version list add `'0028'` after `'0027'` (add a comma after `'0027'`);
- in the name list add `'rare_not_recurrent_preset'` after `'summary_conflicting_calls'` (add a comma);
- add this import at the top: `import { BUILT_IN_PRESETS } from '../../../src/main/database/built-in-presets'`;
- add this test inside the `describe`, after the existing test:

```ts
  // The SQL seed and the shared preset definition must not drift apart.
  it('0028 seeds the "Rare, not recurrent" preset exactly as BUILT_IN_PRESETS defines it', () => {
    const preset = BUILT_IN_PRESETS.find((p) => p.name === 'Rare, not recurrent')
    const migration = POSTGRES_MIGRATIONS.find((m) => m.version === '0028')

    expect(preset).toEqual({
      name: 'Rare, not recurrent',
      description: 'gnomAD AF <= 1% + seen in at most 3 cases',
      filterJson: { maxGnomadAf: 0.01, maxCarriers: 3 },
      sortOrder: 8
    })
    expect(BUILT_IN_PRESETS).toHaveLength(9)
    expect(migration?.sql).toContain(`'${preset!.name}'`)
    expect(migration?.sql).toContain(`'${preset!.description}'`)
    expect(migration?.sql).toContain(`'${JSON.stringify(preset!.filterJson)}'`)
    expect(migration?.sql).toContain(`1, 1, ${preset!.sortOrder}, 'filter'`)
    expect(migration?.sql).toContain('ON CONFLICT (name) DO NOTHING')
    expect(migration?.afterApply).toBeUndefined()
  })
```

In `tests/main/storage/postgres-migrations-idempotent.test.ts`, in the `expect(result.applied).toEqual([...])` list add `'0028'` after `'0027'` (add a comma after `'0027'`).

In these four files the number 44 is the latest SQLite schema version. Change it to 45 on every listed line and nowhere else:
- `tests/main/database/migrate-off-thread.test.ts` lines 68, 72, 82, 100 (`toVersion: 44` and `.toBe(44)`)
- `tests/main/database/migration-v41.test.ts` lines 96, 97, 111, 177, 212, 226, 254 (`.toBe(44)`)
- `tests/main/database/migration-v42.test.ts` lines 40, 41, 50, 62 (`.toBe(44)`)
- `tests/main/startup-default-summary-rebuild.test.ts` line 136 (`.toBe(44)`)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/database/migration-v45.test.ts tests/main/storage/postgres-migration-definitions.test.ts tests/main/database/migration-v42.test.ts`

Expected: FAIL. In `migration-v45.test.ts`, `is the latest schema version` fails with `expected 44 to be 45` and the preset tests find no row. The definitions test fails with `expected [ ...27 items ] to have a length of 28`. `migration-v42.test.ts` fails with `expected 44 to be 45`.

- [ ] **Step 3: Write the minimal implementation**

`src/main/database/built-in-presets.ts`: add after the `CLINVAR_PATHOGENIC` constant

```ts
/** Added by SQLite v45 / PostgreSQL 0028 (#455). */
export const RARE_NOT_RECURRENT_PRESET_NAME = 'Rare, not recurrent'
```

and add a ninth entry at the end of `BUILT_IN_PRESETS`, after the `CADD >= 20` entry (add a comma after that entry's closing brace):

```ts
  // K counts every case in the database, including the open one (#455).
  {
    name: RARE_NOT_RECURRENT_PRESET_NAME,
    description: 'gnomAD AF <= 1% + seen in at most 3 cases',
    filterJson: { maxGnomadAf: 0.01, maxCarriers: 3 },
    sortOrder: 8
  }
```

Also update the comment at the top of that file: replace `These are seeded into the filter_presets table on migration v15.` with `These are seeded into the filter_presets table on migration v15 (v45 adds "Rare, not recurrent" to existing databases).`

`src/main/database/migrations.ts`:

Replace the import of `BUILT_IN_PRESETS`:

```ts
import { BUILT_IN_PRESETS, RARE_NOT_RECURRENT_PRESET_NAME } from './built-in-presets'
```

Change the constant:

```ts
export const LATEST_SQLITE_SCHEMA_VERSION = 45
```

In the doc comment of `runMigrations`, add after the ` * - 44: ...` line:

```ts
 * - 45: built-in filter preset "Rare, not recurrent" (carrier cap, #455; mirrors PG 0028)
```

In `runMigrations`, directly after the `if (currentVersion < 44) { ... }` block and before the closing brace of the function:

```ts
  // v45: built-in preset "Rare, not recurrent" (#455, mirrors PG 0028). A
  // database created by this version already has it from the v15/v16 seed; an
  // existing one gets it here. INSERT OR IGNORE: every existing row, and a
  // user preset of the same name, stays as it is.
  if (currentVersion < 45) {
    const preset = BUILT_IN_PRESETS.find((p) => p.name === RARE_NOT_RECURRENT_PRESET_NAME)
    const hasPresetTable =
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'filter_presets'")
        .get() !== undefined
    if (preset !== undefined && hasPresetTable) {
      const now = Date.now()
      db.prepare(
        `INSERT OR IGNORE INTO filter_presets
           (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
         VALUES (?, ?, ?, 1, 1, ?, 'filter', ?, ?)`
      ).run(
        preset.name,
        preset.description,
        JSON.stringify(preset.filterJson),
        preset.sortOrder,
        now,
        now
      )
    }
    db.exec('PRAGMA user_version = 45')
  }
```

Create `src/main/storage/postgres/migrations/sql/0028_rare_not_recurrent_preset.sql`:

```sql
-- Built-in filter preset "Rare, not recurrent" (#455): gnomAD AF <= 1% and
-- seen in at most 3 cases of this database, the open case included
-- (mirrors SQLite v45).
--
-- A schema created by this version already has the row from the 0005 seed
-- (seedWorkflowDefaults reads BUILT_IN_PRESETS); an existing schema gets it
-- here. The values repeat that definition on purpose: a migration is a fixed
-- record. tests/main/storage/postgres-migration-definitions.test.ts fails if
-- the two differ.
--
-- ON CONFLICT DO NOTHING: every existing row, and a user preset of the same
-- name, stays as it is. Replaying this statement changes nothing.
INSERT INTO "__schema__"."filter_presets"
  (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
VALUES (
  'Rare, not recurrent',
  'gnomAD AF <= 1% + seen in at most 3 cases',
  '{"maxGnomadAf":0.01,"maxCarriers":3}',
  1, 1, 8, 'filter',
  (extract(epoch from now()) * 1000)::bigint,
  (extract(epoch from now()) * 1000)::bigint
)
ON CONFLICT (name) DO NOTHING;
```

`src/main/storage/postgres/migrations/definitions.ts`, array `MIGRATION_FILES`, after the `0027` entry (add a comma after its closing brace). Do not add an `AFTER_APPLY` entry.

```ts
  {
    version: '0028',
    name: 'rare_not_recurrent_preset',
    fileName: '0028_rare_not_recurrent_preset.sql'
  }
```

`scripts/postgres/seed-dev-workspace.mjs` holds its own copy of the built-in preset list for the development workspace. Add the same entry after its `CADD >= 20` entry (add a comma after that entry's closing brace), so the copy does not fall behind:

```js
  {
    name: 'Rare, not recurrent',
    description: 'gnomAD AF <= 1% + seen in at most 3 cases',
    filterJson: { maxGnomadAf: 0.01, maxCarriers: 3 },
    sortOrder: 8
  }
```

`docs/features/filter-presets.md`, table "Built-in Presets", add a row after the `CADD >= 20` row:

```markdown
| **Rare, not recurrent** | gnomAD AF ≤ 1% + seen in at most 3 cases | Rare variants that do not recur in your own database. The count includes the open case. |
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/database tests/main/startup-default-summary-rebuild.test.ts tests/scripts/postgres-seed-dev-workspace.test.ts tests/main/storage/postgres-migration-definitions.test.ts tests/main/storage/postgres-migrations-registration.test.ts tests/main/storage/postgres-migration-schema-qualification.test.ts`

Expected: PASS.

Run (with PostgreSQL): `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage/postgres-rare-not-recurrent-preset-migration.test.ts tests/main/storage/postgres-migrations-idempotent.test.ts`

Expected: PASS. If PostgreSQL is not available in this environment, say so in the task report and leave both gated files for the final gate.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/built-in-presets.ts src/main/database/migrations.ts \
  src/main/storage/postgres/migrations/sql/0028_rare_not_recurrent_preset.sql \
  src/main/storage/postgres/migrations/definitions.ts docs/features/filter-presets.md \
  scripts/postgres/seed-dev-workspace.mjs \
  tests/main/database/migration-v45.test.ts \
  tests/main/storage/postgres-rare-not-recurrent-preset-migration.test.ts \
  tests/main/storage/postgres-migration-definitions.test.ts \
  tests/main/storage/postgres-migrations-idempotent.test.ts \
  tests/main/database/migrate-off-thread.test.ts tests/main/database/migration-v41.test.ts \
  tests/main/database/migration-v42.test.ts tests/main/startup-default-summary-rebuild.test.ts
git commit -m "feat(presets): built-in preset 'Rare, not recurrent' (SQLite v45, PostgreSQL 0028) (#455)"
```

---

### Task 11: Verification

**Files:** none changed, unless a gate reports a problem.

**Interfaces:**
- Consumes: everything above.
- Produces: the reported outcome of each command below.

On the development host `megalodon`, wrap the heavy commands in `systemd-run --user --scope -p MemoryMax=16G <command>` and run them from a terminal, not from the editor's process tree.

- [ ] **Step 1: Type check**

Run: `make typecheck`

Expected: exit 0 (renderer, node, web and contract type checks).

- [ ] **Step 2: Desktop test suite**

Run: `make rebuild-node && make test`

Expected: all tests pass. If a load error names `better-sqlite3-multiple-ciphers`, run `make rebuild-node` again and retry.

- [ ] **Step 3: Web test layer**

Run: `VARLENS_WEB=1 make test` (needs PostgreSQL: `make pg-up` and `VARLENS_PG_URL`; use a fresh database for this branch and a rebuilt `out/web`)

Expected: desktop suite, `web-gate-static` and `web-gate-integration` pass.

Run: `make web-gate-postgres-tests`

Expected: every gated PostgreSQL test passes, including the three files of this plan (`postgres-max-carriers-parity`, `postgres-rare-not-recurrent-preset-migration`, the `carrier cap` test in `variant-filter-backend-parity`) and `postgres-migrations-idempotent`.

If PostgreSQL cannot be started in this environment, report that these two commands were not run. Do not report them as passed.

- [ ] **Step 4: Size and structure gate**

Run: `make agent-check`

Expected: exit 0. No file in `scripts/agent-health-baseline.json` is above its recorded line count, and no file was added to the baseline. If a file is over only because the row identity plan used its headroom first, do not raise the number silently: report the file and the two line counts to the orchestrator.

- [ ] **Step 5: Lint and format**

Run: `make lint-check && make format-check`

Expected: exit 0 for both.

- [ ] **Step 6: Check both drawers in the running app**

Run: `make dev`, open a database with at least three cases.

Check in the case view (Filters, "Internal Frequency" panel):
- The field "Seen in at most N cases" is below the internal AF field, with the hint "Counts all cases in this database, including this case."
- Typing `1` narrows the table after a short pause; the chip "Seen in ≤ 1 case" appears; the panel title shows "Active" and the summary "≤ 1 case".
- Typing `0` or clearing the field turns the filter off; the chip disappears.
- The chip's close button and "Clear all" both empty the field.
- The preset "Rare, not recurrent" is in the preset bar; toggling it sets the AF field to 0.01 and the new field to 3; toggling it off clears both; changing the field by hand deactivates the preset chip.

Check the same five points in the cohort view (hint: "Counts all cases in this database that carry the variant."). Also export the cohort with the cap on and confirm the row count matches the table and the "Export Info" sheet lists "Max Carrier Cases".

Check both drawers in the light and the dark theme: the field has an outlined border and readable label and hint, and no background colour of its own.

Expected: every point holds. If the app cannot be opened in this environment, say so. Do not claim the UI works.

- [ ] **Step 7: Report**

Report each command with its exact outcome, including the checks that could not be run.

The full gate `make preflight-full` is NOT run here. The orchestrator runs it once after all three plans of this batch (cohort row identity, this plan, burden test eligibility) have landed.

---

## Spec Coverage

| Spec item | Task |
| --- | --- |
| Field `maxCarriers` / `carrier_count_max`, integer >= 1, null or absent = off | 1 |
| Schema rejects K below 1 and non-integers | 1 |
| Predicate keeps `NULL` or `<= K` | 2, 4 (case view); 3, 5 (cohort, column is `NOT NULL`) |
| Case view on `vf.case_count`, both backends | 2, 4 |
| Cohort view on `carrier_count`, both backends | 3, 5 |
| Not added to the association configuration | 1 (schema pin), 3 (`cohort-burden` scope drops it) |
| `shortlist-query.ts`, `cohort-export.ts` | 6 |
| Shared types and zod schemas, `filterDefaults.ts` | 1 |
| Renderer: defaults, clearing, serialization, preset application, merger, emit scheduler | 1, 7 |
| Renderer: filter chip | 7 (cohort), 8 (case) |
| Renderer: field in `FilterDrawer.vue` and `CohortFilterDrawer.vue`, mock API | 9 |
| Preset `Rare, not recurrent`, SQLite v45, PostgreSQL 0028 | 10 |
| Test: K = 1, K = 3, off; current case counts once | 2, 3 |
| Test: transcript rows count once; second case counts | 2 |
| Test: variant without a frequency row is kept | 2, 6 (gated, `A.padding`) |
| Test: single build, fresh summary: case view = cohort view, counts and export, both backends | 3 and 6 (SQLite), 6 (PostgreSQL, gated) |
| Test: saved preset round-trips; user presets and the eight built-ins unchanged | 7, 10 |
| Known limits (mixed build, stale summary) | documented in the spec; no test asserts equality there |
