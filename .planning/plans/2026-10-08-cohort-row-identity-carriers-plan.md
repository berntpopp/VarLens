# Cohort Row Identity and Carrier Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cohort row is identified by `(chr, pos, ref, alt, variant_type, genome_build)` everywhere in the API, so two summary rows at one coordinate no longer share a row key, an expansion state, a carriers cache entry or a carrier list.

**Architecture:** One shared helper, `cohortVariantKey`, builds the opaque `variant_key` at read time from the six fields; both backends project `variant_type` and `genome_build` on every listing row and call the helper. `getCarriers` takes the same six fields as one typed object (`CohortVariantIdentity`) from the renderer down to the SQL, where both backends add `variant_type` and `genome_build` predicates. The stored `variant_key` column, both summary schemas and the renderer components stay as they are: the renderer already treats `variant_key` as opaque.

**Tech Stack:** TypeScript 6 (strict), Zod, better-sqlite3-multiple-ciphers, `pg`, Electron IPC (`wrapHandler` / `unwrapIpcResult`), Fastify web dispatcher, Vue 3.5 + Pinia Colada, Vitest.

**Spec:** `.planning/specs/2026-10-08-cohort-row-identity-carriers.md` (issue #503). Read it before starting; this plan argues from it.

## Global Constraints

- No migration. The stored `variant_key` column and both `cohort_variant_summary` schemas stay unchanged.
- `variant_key` is opaque: "nothing parses it". It is built only by `cohortVariantKey` in `src/shared/utils/cohort-variant-key.ts`. No second place builds a cohort row key.
- A carriers request without `variant_type` or `genome_build` is rejected by the schema; "there is no default".
- Out of scope (spec): structural events that differ only in `END`, the four-coordinate annotation join (`src/shared/sql/cohort-summary-rebuild.ts:75`), VRS / SPDI.
- No new abstraction beyond the one key helper (and the one mock fixture helper that the mock's line budget forces, Task 2).
- `AGENTS.md`: no `console.*`; IPC handlers return through `wrapHandler`, the renderer unwraps with `unwrapIpcResult`; no try/catch for control flow in IPC paths; source files under 600 lines.
- `scripts/agent-health-baseline.json` files must not grow: `src/renderer/src/mocks/mockApi.ts` is at its baseline (1236 lines) and `src/shared/types/api.ts` has a baseline of 929 (currently 912). Tasks 2 and 4 leave both smaller.
- Work on a dedicated branch (for example `fix/cohort-row-identity-carriers`), never on `main`. Conventional Commits.
- Run `make rebuild-node` once before the first `npx vitest` call (native module ABI).
- All line numbers are those of `main` at `bcbc86cf`, before any edit of this plan; an earlier step in the same file shifts them. Match on the quoted code, not on the number.
- Run `npx prettier --write` on the files a task touched before its commit (`make format-check` is part of the gate).
- PostgreSQL-backed tests are gated by `VARLENS_RUN_POSTGRES_E2E=1` and need `make pg-up`. They read `VARLENS_PG_URL` and default to `postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev`; export `VARLENS_PG_URL` if the dev container listens on another port.
- Tasks 3 and 4 must land in the same PR. After Task 3 the main process and the web route accept only the six-field object while the preload still sends four positional arguments, so the desktop carrier list is rejected until Task 4. Every commit keeps `make typecheck` green.

## Review Focus

Inputs the spec implies but its Tests section does not name, most likely first. Each has a test in the task that owns the code.

1. An indel row shown under the `variant_type: 'snv'` filter (that filter lists `snv` and `indel`): its carriers must be looked up with the row's own type, `indel`, and be found. (Task 3, SQLite and PostgreSQL.)
2. A stale client that still sends the old four positional arguments (a cached web bundle, an old preload): the request is rejected, over IPC and with HTTP 400 on the web route, and never reaches storage. (Task 3.)
3. An empty string for `variant_type` or `genome_build`: rejected like a missing field, not treated as "any". (Task 3.)
4. PostgreSQL returns `pos` as a string for bigint columns: the key must be built from the number, so the same row has the same key on every page. (Task 2, mocked PostgreSQL test.)
5. The new key contains `"`, `,` and can contain `#` or `:`: the cohort table's render key (`<generation>#<id>`) must give the same id back, or expanded rows collapse on every click. (Task 2, `useResultSetKeys` test.)

## File Structure

| File | Change |
|---|---|
| `src/shared/types/cohort.ts` | New `CohortVariantIdentity`; `CohortVariant` extends it (Tasks 1, 2) |
| `src/shared/utils/cohort-variant-key.ts` | New: `cohortVariantKey` (Task 1) |
| `src/main/database/cohort.ts` | Listing projects type and build, builds the key (Task 2); `getCarriers(variant)` (Task 3) |
| `src/main/storage/postgres/postgres-cohort-summary-query.ts` | Select list gains `variant_type`, `genome_build` (Task 2) |
| `src/main/storage/postgres/PostgresCohortRepository.ts` | `toCohortVariant` (Task 2); `getCarriers(variant)` (Task 3) |
| `src/renderer/src/mocks/cohortIdentityMock.ts` | New: `mockCohortIdentity` (Task 2) |
| `src/renderer/src/mocks/mockApi.ts` | Listing rows (Task 2); `getCarriers` (Task 4) |
| `src/shared/api/schemas/cohort.ts` | Six-field request schema, OpenAPI body (Task 3) |
| `src/main/storage/read-executor.ts`, `src/main/workers/db-worker-dispatch.ts`, `src/main/ipc/handlers/cohort-logic.ts`, `src/main/ipc/handlers/cohort.ts` | Carry the object (Task 3) |
| `src/web/server/routes/cohort.ts`, `src/web/server/routes/openapi-paths/cohort.ts` | Web route and OpenAPI (Task 3) |
| `src/shared/types/api.ts`, `src/shared/ipc/domains/cohort.ts`, `src/preload/domains/cohort.ts`, `src/preload/window-api/core-api.ts`, `src/renderer/src/queries/carriers.ts` | Renderer-facing contract (Task 4) |

Files the spec lists that need **no** edit (checked against the code, do not touch them):

- `src/shared/types/db-task.ts`: `DbTask.params` is `unknown[]`; only the task name is typed.
- `src/main/storage/sqlite/SqliteReadExecutor.ts:220` and `src/main/storage/postgres/PostgresReadExecutor.ts:179`: both call `getCarriers(...task.params)`, which follows the `StorageReadTask` tuple type changed in Task 3.
- `src/renderer/src/components/cohort/CohortDataTable.vue`, `src/renderer/src/components/CohortTable.vue`, `src/renderer/src/components/cohort/CarrierExpandedRow.vue`: they only read `variant_key` and pass the row to `carriersQuery` (spec, Design 5).
- `src/shared/ipc/parity-manifest/core.ts:130` (`getCarriers: sharedRead()`), `scripts/parity-baseline.json`, `tests/shared/types/preload-contract.test.ts`, `tests/refactor-checkpoint/__snapshots__/pool-vs-main-routing.json`, `tests/utils/mock-api.ts`: the method name, its classification, its return type and its routing do not change.

---

### Task 1: Identity type and key helper

**Files:**
- Modify: `src/shared/types/cohort.ts:9-11` (insert before the `CohortVariant` doc comment)
- Create: `src/shared/utils/cohort-variant-key.ts`
- Test: `tests/shared/utils/cohort-variant-key.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface CohortVariantIdentity { chr: string; pos: number; ref: string; alt: string; variant_type: string; genome_build: string }` in `src/shared/types/cohort.ts`
  - `export function cohortVariantKey(v: CohortVariantIdentity): string` in `src/shared/utils/cohort-variant-key.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/shared/utils/cohort-variant-key.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { CohortVariantIdentity } from '../../../src/shared/types/cohort'
import { cohortVariantKey } from '../../../src/shared/utils/cohort-variant-key'

const base: CohortVariantIdentity = {
  chr: '1',
  pos: 100,
  ref: 'A',
  alt: 'T',
  variant_type: 'snv',
  genome_build: 'GRCh38'
}

describe('cohortVariantKey', () => {
  it('is the same for the same six fields, whatever else the row carries', () => {
    expect(cohortVariantKey({ ...base })).toBe(cohortVariantKey(base))
    expect(cohortVariantKey({ ...base, carrier_count: 3 } as CohortVariantIdentity)).toBe(
      cohortVariantKey(base)
    )
  })

  it.each([
    ['chr', { chr: '2' }],
    ['pos', { pos: 101 }],
    ['ref', { ref: 'C' }],
    ['alt', { alt: 'G' }],
    ['variant_type', { variant_type: 'indel' }],
    ['genome_build', { genome_build: 'GRCh37' }]
  ] as Array<[string, Partial<CohortVariantIdentity>]>)('changes with %s', (_field, change) => {
    expect(cohortVariantKey({ ...base, ...change })).not.toBe(cohortVariantKey(base))
  })

  it('separates one <DEL> stored as sv and as cnv', () => {
    const del = { ...base, chr: '7', pos: 1000, ref: 'N', alt: '<DEL>' }
    expect(cohortVariantKey({ ...del, variant_type: 'sv' })).not.toBe(
      cohortVariantKey({ ...del, variant_type: 'cnv' })
    )
  })

  it('does not let a breakend ALT collide with another row', () => {
    // Joined with ':' both rows read 2:321681:G:]13:123456]T.
    const breakend = { ...base, chr: '2', pos: 321681, ref: 'G', alt: ']13:123456]T' }
    const shifted = { ...breakend, ref: 'G:]13', alt: '123456]T' }
    expect(cohortVariantKey(breakend)).not.toBe(cohortVariantKey(shifted))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/utils/cohort-variant-key.test.ts`
Expected: FAIL, the suite cannot resolve `../../../src/shared/utils/cohort-variant-key`.

- [ ] **Step 3: Write minimal implementation**

In `src/shared/types/cohort.ts`, insert between the file header comment (ends line 7) and the `CohortVariant` doc comment (line 9):

```ts
/**
 * The six fields that identify one cohort row: the primary key of
 * `cohort_variant_summary` on both backends.
 */
export interface CohortVariantIdentity {
  /** Chromosome */
  chr: string
  /** Genomic position */
  pos: number
  /** Reference allele */
  ref: string
  /** Alternate allele */
  alt: string
  /** Stored variant type: snv, indel, sv, cnv or str */
  variant_type: string
  /** Genome build of the carrying cases, e.g. GRCh38 */
  genome_build: string
}
```

Create `src/shared/utils/cohort-variant-key.ts`:

```ts
import type { CohortVariantIdentity } from '../types/cohort'

/**
 * Row key of a cohort variant, built at read time from the six identity
 * fields. Opaque: compare it, never parse it. JSON keeps an ALT that contains
 * the separator (a breakend such as `]13:123456]T`) from colliding with
 * another row.
 */
export function cohortVariantKey(v: CohortVariantIdentity): string {
  return JSON.stringify([v.chr, v.pos, v.ref, v.alt, v.variant_type, v.genome_build])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/utils/cohort-variant-key.test.ts && make typecheck`
Expected: 9 tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/cohort.ts src/shared/utils/cohort-variant-key.ts tests/shared/utils/cohort-variant-key.test.ts
git commit -m "feat(cohort): six-field row identity type and key helper (#503)"
```

---

### Task 2: Listing rows carry the identity and the six-field key

`CohortVariant` gains two required fields, so the three places that produce one (SQLite, PostgreSQL, the browser-dev mock) change in this one commit; splitting it would leave typecheck red.

**Files:**
- Modify: `src/shared/types/cohort.ts` (`CohortVariant`, currently lines 12-38)
- Modify: `src/main/database/cohort.ts:12-19` (imports), `:272` (select list), `:296` (after the read)
- Modify: `src/main/storage/postgres/postgres-cohort-summary-query.ts:93-114` (`summarySelectList`)
- Modify: `src/main/storage/postgres/PostgresCohortRepository.ts:4-11` (imports), `:428-464` (`toCohortVariant`)
- Create: `src/renderer/src/mocks/cohortIdentityMock.ts`
- Modify: `src/renderer/src/mocks/mockApi.ts:9-16` (imports), `:395-423` and `:458-466` (`cohort.getVariants`)
- Test: `tests/main/database/cohort.test.ts` (new `describe`), `tests/main/storage/postgres-cohort-row-identity.test.ts` (create), `tests/main/storage/postgres-cohort-repository.test.ts:36-101`, `tests/renderer/mocks/mockApi-cohort-zygosity.test.ts`, `tests/renderer/components/table-state/useResultSetKeys.test.ts`
- Test (existing assertions that read a listing `variant_key` as `chr:pos:ref:alt`): `tests/main/database/cohort-summary-representative.test.ts:154,194`, `tests/main/database/variant-filter-parity-guards.test.ts:119,208,221`, `tests/main/handlers/__snapshots__/cohort-handlers.test.ts.snap`, and the PostgreSQL-gated `tests/main/storage/cohort-backend-parity.test.ts:670,808,810`, `tests/main/storage/cohort-summary-drift.test.ts:563,680,726,763`, `tests/main/storage/variant-filter-backend-parity.test.ts:318,322,328`

**Interfaces:**
- Consumes: `CohortVariantIdentity`, `cohortVariantKey(v: CohortVariantIdentity): string` (Task 1).
- Produces:
  - `export interface CohortVariant extends CohortVariantIdentity { … variant_key: string … }`: every listing row on both backends and in the mock has `variant_type`, `genome_build`, and `variant_key === cohortVariantKey(row)`.
  - `export function mockCohortIdentity(v: Pick<Variant, 'chr' | 'pos' | 'ref' | 'alt' | 'case_id' | 'variant_type'>, cases: ReadonlyArray<Pick<Case, 'id' | 'genome_build'>>): CohortVariantIdentity` in `src/renderer/src/mocks/cohortIdentityMock.ts` (used again in Task 4).
  - The test seed in `tests/main/database/cohort.test.ts` (`describe('row identity: genome build and variant type (#503)')`) and the file `tests/main/storage/postgres-cohort-row-identity.test.ts`, both extended in Task 3.

- [ ] **Step 1: Write the failing SQLite test**

In `tests/main/database/cohort.test.ts`, add after the imports (line 14):

```ts
import type { CohortVariant } from '../../../src/shared/types/cohort'
import { cohortVariantKey } from '../../../src/shared/utils/cohort-variant-key'
```

and add this block directly before `describe('getGeneBurden', …)` (line 756):

```ts
  describe('row identity: genome build and variant type (#503)', () => {
    // One case per line: name, build, chr, pos, ref, alt, variant type.
    const SEEDS: Array<[string, string, string, number, string, string, string]> = [
      ['b38-a', 'GRCh38', '1', 100, 'A', 'T', 'snv'],
      ['b38-b', 'GRCh38', '1', 100, 'A', 'T', 'snv'],
      ['b37-a', 'GRCh37', '1', 100, 'A', 'T', 'snv'],
      ['sv-a', 'GRCh38', '7', 1000, 'N', '<DEL>', 'sv'],
      ['cnv-a', 'GRCh38', '7', 1000, 'N', '<DEL>', 'cnv'],
      ['cnv-b', 'GRCh38', '7', 1000, 'N', '<DEL>', 'cnv'],
      ['bnd-a', 'GRCh38', '2', 321681, 'G', ']13:123456]T', 'sv'],
      ['indel-a', 'GRCh38', '3', 500, 'AT', 'A', 'indel']
    ]

    const rows = (params: Record<string, unknown> = {}): CohortVariant[] =>
      cohortService.getCohortVariants({ limit: 100, ...params }).data
    const at = (pos: number): CohortVariant[] => rows().filter((row) => row.pos === pos)

    beforeEach(() => {
      for (const [name, build, chr, pos, ref, alt, type] of SEEDS) {
        const caseId = db
          .prepare(
            'INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build) VALUES (?, ?, 0, 1, ?, ?)'
          )
          .run(name, `/test/${name}.vcf`, Date.now(), build).lastInsertRowid
        db.prepare(
          "INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type, gt_num) VALUES (?, ?, ?, ?, ?, ?, '0/1')"
        ).run(caseId, chr, pos, ref, alt, type)
      }
      rebuildSummary()
    })

    it('gives one coordinate in two builds two rows with their own key', () => {
      const pair = at(100)
      expect(pair.map((row) => row.genome_build).sort()).toEqual(['GRCh37', 'GRCh38'])
      expect(new Set(pair.map((row) => row.variant_key)).size).toBe(2)
    })

    it('gives one coordinate stored as sv and as cnv two rows with their own key', () => {
      const pair = at(1000)
      expect(pair.map((row) => row.variant_type).sort()).toEqual(['cnv', 'sv'])
      expect(new Set(pair.map((row) => row.variant_key)).size).toBe(2)
    })

    it('builds every key from the six fields, so no two rows share one', () => {
      const all = rows()
      expect(all).toHaveLength(6)
      for (const row of all) expect(row.variant_key).toBe(cohortVariantKey(row))
      expect(new Set(all.map((row) => row.variant_key)).size).toBe(all.length)
      expect(at(321681).map((row) => row.alt)).toEqual([']13:123456]T'])
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/cohort.test.ts -t "row identity"`
Expected: 3 FAIL. The first two report `[undefined, undefined]` where the builds / types are expected; the third reports `'2:321681:G:]13:123456]T'`-style stored keys that differ from `cohortVariantKey(row)`.

- [ ] **Step 3: Write the failing PostgreSQL, mock and render-key tests**

Create `tests/main/storage/postgres-cohort-row-identity.test.ts`:

```ts
/**
 * Cohort row identity on PostgreSQL (#503): one coordinate in two genome
 * builds, or stored as two variant types, is two summary rows, each with its
 * own key and its own carriers. SQLite twin: the "row identity" block of
 * tests/main/database/cohort.test.ts (same seed).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1 (requires `make pg-up`), like the other
 * real-Postgres tests.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import type { CohortVariant } from '../../../src/shared/types/cohort'
import { cohortVariantKey } from '../../../src/shared/utils/cohort-variant-key'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

// One case per line: name, build, chr, pos, ref, alt, variant type.
const SEEDS: Array<[string, string, string, number, string, string, string]> = [
  ['b38-a', 'GRCh38', '1', 100, 'A', 'T', 'snv'],
  ['b38-b', 'GRCh38', '1', 100, 'A', 'T', 'snv'],
  ['b37-a', 'GRCh37', '1', 100, 'A', 'T', 'snv'],
  ['sv-a', 'GRCh38', '7', 1000, 'N', '<DEL>', 'sv'],
  ['cnv-a', 'GRCh38', '7', 1000, 'N', '<DEL>', 'cnv'],
  ['cnv-b', 'GRCh38', '7', 1000, 'N', '<DEL>', 'cnv'],
  ['bnd-a', 'GRCh38', '2', 321681, 'G', ']13:123456]T', 'sv'],
  ['indel-a', 'GRCh38', '3', 500, 'AT', 'A', 'indel']
]

describe.skipIf(!RUN)('cohort row identity on PostgreSQL (#503)', () => {
  let schema: string
  let pool: Pool
  let repo: PostgresCohortRepository

  const rows = async (params: Record<string, unknown> = {}): Promise<CohortVariant[]> =>
    (await repo.queryVariants({ limit: 100, offset: 0, ...params })).data
  const at = async (pos: number): Promise<CohortVariant[]> =>
    (await rows()).filter((row) => row.pos === pos)

  beforeAll(async () => {
    schema = `vt_row_identity_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    repo = new PostgresCohortRepository(pool, schema)

    for (const [name, build, chr, pos, ref, alt, type] of SEEDS) {
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
           VALUES ($1, $2, 0, $3, $4) RETURNING id`,
        [name, `/tmp/${name}.vcf`, Date.now(), build]
      )
      const caseId = inserted.rows[0].id
      await pool.query(
        `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gt_num)
           VALUES ($1, $2, $3, $4, $5, $6, '0/1')`,
        [caseId, chr, pos, ref, alt, type]
      )
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await new PostgresCohortSummaryRepository().incrementalAdd({
          schema,
          client: client as never,
          caseId
        })
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
  }, 120_000)

  afterAll(async () => {
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 120_000)

  it('gives one coordinate in two builds two rows with their own key', async () => {
    const pair = await at(100)
    expect(pair.map((row) => row.genome_build).sort()).toEqual(['GRCh37', 'GRCh38'])
    expect(new Set(pair.map((row) => row.variant_key)).size).toBe(2)
  })

  it('gives one coordinate stored as sv and as cnv two rows with their own key', async () => {
    const pair = await at(1000)
    expect(pair.map((row) => row.variant_type).sort()).toEqual(['cnv', 'sv'])
    expect(new Set(pair.map((row) => row.variant_key)).size).toBe(2)
  })

  it('builds every key from the six fields, so no two rows share one', async () => {
    const all = await rows()
    expect(all).toHaveLength(6)
    for (const row of all) expect(row.variant_key).toBe(cohortVariantKey(row))
    expect(new Set(all.map((row) => row.variant_key)).size).toBe(all.length)
    expect((await at(321681)).map((row) => row.alt)).toEqual([']13:123456]T'])
  })
})

describe.skipIf(RUN)('cohort row identity on PostgreSQL (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
```

In `tests/main/storage/postgres-cohort-repository.test.ts`, first test (`'queries total cases, grouped variant count, then rows and maps numeric strings'`): add two fields to the mocked row (after `alt: 'G',` near line 47) and to the expected row (after `alt: 'G',` near line 81), and replace the expected key (line 90). Review Focus 4: `pos` arrives as the string `'123'` and the key holds the number.

```ts
            alt: 'G',
            variant_type: 'snv',
            genome_build: 'GRCh38',
```

```ts
          alt: 'G',
          variant_type: 'snv',
          genome_build: 'GRCh38',
```

```ts
          variant_key: '["1",123,"A","G","snv","GRCh38"]',
```

In `tests/renderer/mocks/mockApi-cohort-zygosity.test.ts`, add after the existing `describe` block (and add `import type { CohortVariant } from '../../../src/shared/types/cohort'` and `import { cohortVariantKey } from '../../../src/shared/utils/cohort-variant-key'` to the imports):

```ts
describe('mock cohort row identity', () => {
  it('keys every row by the six fields and keeps the genome builds apart', async () => {
    const { mockApi } = await import('../../../src/renderer/src/mocks/mockApi')
    const { data } = (await mockApi.cohort.getVariants({ limit: 1000 } as never)) as unknown as {
      data: CohortVariant[]
    }
    expect(new Set(data.map((row) => row.genome_build))).toEqual(new Set(['GRCh37', 'GRCh38']))
    for (const row of data) expect(row.variant_key).toBe(cohortVariantKey(row))
    expect(new Set(data.map((row) => row.variant_key)).size).toBe(data.length)
  })
})
```

In `tests/renderer/components/table-state/useResultSetKeys.test.ts`, add `import { cohortVariantKey } from '../../../../src/shared/utils/cohort-variant-key'` and this test inside the `describe` (Review Focus 5). It is a characterisation test: it passes before and after this task, and pins the behaviour the new key depends on.

```ts
  it('gives an opaque cohort key back unchanged, also as an expanded row', () => {
    const id = cohortVariantKey({
      chr: '2',
      pos: 321681,
      ref: 'G',
      alt: ']13:123456]T#1',
      variant_type: 'sv',
      genome_build: 'GRCh38'
    })
    const { rows, keys, app } = setup([{ key: id }])
    const renderKey = keys.rowKey(rows.value[0])
    expect(keys.idOfKey(renderKey)).toBe(id)
    const expanded = ref<string[]>([])
    keys.keyedModel(expanded).value = [renderKey]
    expect(expanded.value).toEqual([id])
    app.unmount()
  })
```

- [ ] **Step 4: Run the new tests to verify they fail**

Run: `npx vitest run tests/main/storage/postgres-cohort-repository.test.ts tests/renderer/mocks/mockApi-cohort-zygosity.test.ts tests/renderer/components/table-state/useResultSetKeys.test.ts`
Expected: `postgres-cohort-repository` first test FAIL (row has no `variant_type`, key is `'1:123:A:G'`); `mock cohort row identity` FAIL (`genome_build` is `undefined`); `useResultSetKeys` PASS (characterisation).

Run (needs `make pg-up`): `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage/postgres-cohort-row-identity.test.ts`
Expected: 3 FAIL (`genome_build` / `variant_type` undefined, stored four-field keys).

- [ ] **Step 5: Implement the type change**

In `src/shared/types/cohort.ts`, change the `CohortVariant` head and drop its four coordinate fields (they come from `CohortVariantIdentity`), and reword the key comment:

```ts
/**
 * Aggregated variant across all cases in the cohort
 */
export interface CohortVariant extends CohortVariantIdentity {
  /** Gene symbol (nullable) */
  gene_symbol: string | null
```

```ts
  /** Opaque row key, built at read time by `cohortVariantKey`; never parse it */
  variant_key: string
```

(Delete the eight lines `/** Chromosome */ chr: string` … `/** Alternate allele */ alt: string`, and replace the old `/** Composite key for stable v-data-table tracking: "chr:pos:ref:alt" */` comment.)

- [ ] **Step 6: Implement SQLite**

`src/main/database/cohort.ts`, add to the imports (after line 30, the `SUMMARY_CONTENT_STAMP_KEY` import):

```ts
import { cohortVariantKey } from '../../shared/utils/cohort-variant-key'
```

In `getCohortVariants`, replace line 272 `        cvs.variant_key,` with:

```ts
        cvs.variant_type,
        cvs.genome_build,
```

and after line 296 (`const results = stmt.all(...bound) as CohortVariant[]`) add:

```ts
    // Built here, not read: the stored variant_key is the four-field form (#503).
    for (const row of results) row.variant_key = cohortVariantKey(row)
```

Leave `SQLITE_KEYSET_EXTRA_COLUMNS` and the keyset `finalize` alone.

- [ ] **Step 7: Implement PostgreSQL**

`src/main/storage/postgres/postgres-cohort-summary-query.ts`, `summarySelectList`: after `cvs.alt,` (line 97) add two lines. `cvs.variant_key` stays in the list, so the raw export rows keep every column they had.

```ts
      cvs.alt,
      cvs.variant_type,
      cvs.genome_build,
      cvs.gene_symbol,
```

`src/main/storage/postgres/PostgresCohortRepository.ts`, add after the `shared/types/cohort` import (line 11):

```ts
import { cohortVariantKey } from '../../../shared/utils/cohort-variant-key'
```

and replace the head of `toCohortVariant` (lines 428-453, through the `variant_key:` property) with:

```ts
  private toCohortVariant(row: Record<string, unknown>, fallbackTotalCases: number): CohortVariant {
    const identity = {
      chr: String(row.chr ?? ''),
      pos: toNumber(row.pos),
      ref: String(row.ref ?? ''),
      alt: String(row.alt ?? ''),
      variant_type: String(row.variant_type ?? ''),
      genome_build: String(row.genome_build ?? '')
    }
    const totalCases = toNumber(row.total_cases) || fallbackTotalCases

    return {
      ...identity,
      gene_symbol:
        row.gene_symbol === null || row.gene_symbol === undefined ? null : String(row.gene_symbol),
      cdna: row.cdna === null || row.cdna === undefined ? null : String(row.cdna),
      aa_change:
        row.aa_change === null || row.aa_change === undefined ? null : String(row.aa_change),
      carrier_count: toNumber(row.carrier_count),
      total_cases: totalCases,
      cohort_frequency: toNullableNumber(row.cohort_frequency) ?? 0,
      het_count: toNumber(row.het_count),
      hom_count: toNumber(row.hom_count),
      // Built here, not read: the stored variant_key is the four-field form (#503).
      variant_key: cohortVariantKey(identity),
```

The rest of the returned object (`consequence` … `omim_id`) is unchanged.

- [ ] **Step 8: Implement the mock**

Create `src/renderer/src/mocks/cohortIdentityMock.ts`:

```ts
import type { Case, Variant } from '../../../shared/types/api'
import type { CohortVariantIdentity } from '../../../shared/types/cohort'

/**
 * Six-field cohort identity of a browser-dev mock variant. The genome build is
 * the build of the case that carries it, as in the real summary.
 */
export function mockCohortIdentity(
  v: Pick<Variant, 'chr' | 'pos' | 'ref' | 'alt' | 'case_id' | 'variant_type'>,
  cases: ReadonlyArray<Pick<Case, 'id' | 'genome_build'>>
): CohortVariantIdentity {
  return {
    chr: v.chr,
    pos: v.pos,
    ref: v.ref,
    alt: v.alt,
    variant_type: v.variant_type ?? 'snv',
    genome_build: cases.find((c) => c.id === v.case_id)?.genome_build ?? 'GRCh38'
  }
}
```

`src/renderer/src/mocks/mockApi.ts` (must end at or below 1236 lines; this edit nets -2):

Imports, after line 12 (`mockPanelResolutionStatus`) and after line 14 (`genotypeZygosity`):

```ts
import { mockCohortIdentity } from './cohortIdentityMock'
```

```ts
import { cohortVariantKey } from '../../../shared/utils/cohort-variant-key'
```

In `cohort.getVariants`, replace the map value type head and its four coordinate lines (lines 397-401):

```ts
        ReturnType<typeof mockCohortIdentity> & {
          gene_symbol: string | null
```

Replace line 417 (`const key = \`${v.chr}:${v.pos}:${v.ref}:${v.alt}\``) and lines 420-423 (`chr: v.chr,` … `alt: v.alt,`):

```ts
        const identity = mockCohortIdentity(v, cases)
        const key = cohortVariantKey(identity)
        if (!variantMap.has(key)) {
          variantMap.set(key, {
            ...identity,
            gene_symbol: v.gene_symbol ?? null,
```

In the returned row (lines 461-464), add the two fields after `alt: v.alt,`:

```ts
          alt: v.alt,
          variant_type: v.variant_type,
          genome_build: v.genome_build,
```

`variant_key: key` stays as it is. Also change the comment on line 394 to `// Aggregate variants by the six-field cohort identity`.

- [ ] **Step 9: Run the new tests to verify they pass**

Run: `npx vitest run tests/main/database/cohort.test.ts tests/main/storage/postgres-cohort-repository.test.ts tests/renderer/mocks/mockApi-cohort-zygosity.test.ts tests/renderer/components/table-state/useResultSetKeys.test.ts`
Expected: all PASS.

Run (needs `make pg-up`): `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage/postgres-cohort-row-identity.test.ts`
Expected: 3 PASS.

- [ ] **Step 10: Move existing assertions off the key's content**

These tests used a listing row's `variant_key` as a readable `chr:pos:ref:alt` label. The key is opaque now; they keep asserting the same rows through the coordinates.

`tests/main/database/cohort-summary-representative.test.ts`, lines 154 and 194, replace `.map((v) => v.variant_key)` with:

```ts
.map((v) => `${v.chr}:${v.pos}:${v.ref}:${v.alt}`)
```

`tests/main/database/variant-filter-parity-guards.test.ts`, add below the imports:

```ts
/** `chr:pos:ref:alt` of a cohort row; its variant_key is opaque (#503). */
const coord = (row: unknown): string => {
  const { chr, pos, ref, alt } = row as { chr: string; pos: number; ref: string; alt: string }
  return `${chr}:${pos}:${ref}:${alt}`
}
```

and replace `.map((row) => row.variant_key)` with `.map(coord)` at lines 119, 208 and 221.

`tests/main/handlers/__snapshots__/cohort-handlers.test.ts.snap`: run `npx vitest run tests/main/handlers/cohort-handlers.test.ts -u`, then check `git diff` on the snapshot. The only changes allowed are, in the `getCohortVariants` snapshot, per row: a new `"genome_build": "GRCh38",`, a new `"variant_type": "snv",`, and the key lines becoming

```
      "variant_key": "["1",12345,"A","G","snv","GRCh38"]",
```
```
      "variant_key": "["2",54321,"C","T","snv","GRCh38"]",
```

The `getCarriers` and `getCohortSummary` snapshots must be untouched.

PostgreSQL-gated files:

`tests/main/storage/cohort-backend-parity.test.ts`, lines 670, 808 and 810: replace `.map((v) => v.variant_key)` with `.map(variantKey)` (the file's own `chr:pos:ref:alt` helper, line 219). Lines 498 and 503 compare the two backends' keys with each other and stay.

`tests/main/storage/cohort-summary-drift.test.ts`: lines 563 and 726, replace `.map((v) => v.variant_key)` with ``.map((v) => `${v.chr}:${v.pos}:${v.ref}:${v.alt}`)``; line 680, replace `variant_key: '1:100:A:T'` with `chr: '1', pos: 100`; line 763, replace `variant_key: '7:1000:N:<DEL>',` with `chr: '7',` and `alt: '<DEL>',` (that object is matched against page rows and against raw export rows, whose `variant_key` is the stored column).

`tests/main/storage/variant-filter-backend-parity.test.ts`: lines 318 and 322, replace `.map((row) => row.variant_key)` with `.map((row) => keyOf(row as never))`; line 328, replace `keys.push(String(row.variant_key))` with `keys.push(keyOf(row as never))` (`keyOf` is already imported from the fixture file, line 66).

- [ ] **Step 11: Run the touched suites**

Run: `npx vitest run tests/main/database tests/main/handlers tests/main/workers tests/main/storage tests/renderer/mocks tests/renderer/components/table-state && make typecheck`
Expected: all PASS, typecheck exits 0. If another test fails because it reads a listing `variant_key` as `chr:pos:ref:alt`, give it the same coordinate replacement as in Step 10; do not change `cohortVariantKey`.

Run (needs `make pg-up`): `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage/cohort-backend-parity.test.ts tests/main/storage/cohort-summary-drift.test.ts tests/main/storage/variant-filter-backend-parity.test.ts tests/main/storage/postgres-cohort-row-identity.test.ts tests/main/storage/postgres-cohort-keyset.test.ts`
Expected: all PASS.

Run: `make agent-check`
Expected: exits 0; `mockApi.ts` is reported at 1234 lines, below its baseline.

- [ ] **Step 12: Commit**

```bash
git add src/shared/types/cohort.ts src/main/database/cohort.ts \
  src/main/storage/postgres/postgres-cohort-summary-query.ts \
  src/main/storage/postgres/PostgresCohortRepository.ts \
  src/renderer/src/mocks/cohortIdentityMock.ts src/renderer/src/mocks/mockApi.ts tests
git commit -m "fix(cohort): build the row key from genome build and variant type too (#503)"
```

---

### Task 3: Carrier lookup by the six-field identity (storage, IPC handler, web route)

**Files:**
- Modify: `src/main/database/cohort.ts:12-19` (type import), `:411-430` (`getCarriers`)
- Modify: `src/main/storage/postgres/PostgresCohortRepository.ts:4-11` (type import), `:290-318` (`getCarriers`)
- Modify: `src/main/storage/read-executor.ts:3` (type import), `:62` (task type)
- Modify: `src/main/workers/db-worker-dispatch.ts:128-134`
- Modify: `src/main/ipc/handlers/cohort-logic.ts:23` (type import), `:174-186`, `:286-316`
- Modify: `src/shared/api/schemas/cohort.ts:7-12`, `:23-25`
- Modify: `src/main/ipc/handlers/cohort.ts:1` (drop `z`), `:4-7` (import), `:25-31` (drop local schema), `:90-112`
- Modify: `src/web/server/routes/cohort.ts:100-117`
- Modify: `src/web/server/routes/openapi-paths/cohort.ts:50`
- Test: `tests/main/database/cohort.test.ts`, `tests/main/storage/postgres-cohort-row-identity.test.ts`, `tests/main/storage/postgres-cohort-repository.test.ts:613-629`, `tests/main/storage/postgres-read-executor.test.ts:341,354`, `tests/main/workers/db-worker-dispatch.test.ts:186-192`, `tests/main/handlers/cohort-logic.test.ts:105-118` and a new `describe`, `tests/main/handlers/cohort-handlers.test.ts:194`, `tests/main/database/split-genotype-zygosity.test.ts:111-112`, `tests/main/database/conflicting-genotype-calls.test.ts:48`, `tests/main/database/case-import-status-readers.test.ts:97`, `tests/web-gate/dispatcher-adapters-read-seams.test.ts:167-180` and a new test

**Interfaces:**
- Consumes: `CohortVariantIdentity` (Task 1); listing rows with `variant_type` and `genome_build` (Task 2); the `SEEDS` test data and helpers `rows` / `at` of Task 2.
- Produces:
  - `CohortService.getCarriers(variant: CohortVariantIdentity): CohortCarrier[]`
  - `PostgresCohortRepository.getCarriers(variant: CohortVariantIdentity): Promise<CohortCarrierWithDepth[]>`
  - `StorageReadTask`: `{ type: 'cohort:carriers'; params: [variant: CohortVariantIdentity] }`
  - `getCohortCarriersViaSession(variant: CohortVariantIdentity, getSession: () => StorageSession): Promise<unknown>`
  - `getCarriers(variant: CohortVariantIdentity, getDb: () => DatabaseService, getDbPool?: () => DbPool | null, getSession?: GetSession): Promise<unknown>` in `cohort-logic.ts`
  - `CohortCarriersParamsSchema` with six required, non-empty fields; `CohortInvokeBodySchemas.getCarriers` = `z.object({ args: z.tuple([CohortCarriersParamsSchema]) })`
  - IPC channel `cohort:carriers` takes one argument (the object). Web method `cohort:getCarriers` takes `args: [object]`.

- [ ] **Step 1: Write the failing storage tests**

`tests/main/database/cohort.test.ts`, inside `describe('row identity: genome build and variant type (#503)')`, after the three tests of Task 2:

```ts
    const carriersOf = (row: CohortVariant): string[] =>
      cohortService.getCarriers(row).map((carrier) => carrier.case_name)

    it('lists the carriers of each build of one coordinate separately', () => {
      const byBuild = Object.fromEntries(at(100).map((row) => [row.genome_build, carriersOf(row)]))
      expect(byBuild).toEqual({ GRCh38: ['b38-a', 'b38-b'], GRCh37: ['b37-a'] })
    })

    it('lists the carriers of the sv row and of the cnv row separately', () => {
      const byType = Object.fromEntries(at(1000).map((row) => [row.variant_type, carriersOf(row)]))
      expect(byType).toEqual({ sv: ['sv-a'], cnv: ['cnv-a', 'cnv-b'] })
    })

    it('returns as many carriers as the row counts, for every row', () => {
      for (const row of rows()) expect(carriersOf(row)).toHaveLength(row.carrier_count)
    })

    it('finds the carriers of an indel row listed under the snv filter', () => {
      const [indel] = rows({ variant_type: 'snv' }).filter((row) => row.pos === 500)
      expect(indel.variant_type).toBe('indel')
      expect(carriersOf(indel)).toEqual(['indel-a'])
    })
```

In the same file, update the existing `describe('getCarriers')` test (line 742):

```ts
      const carriers = cohortService.getCarriers({
        chr: '1',
        pos: 12345,
        ref: 'A',
        alt: 'G',
        variant_type: 'snv',
        genome_build: 'GRCh38'
      })
```

`tests/main/storage/postgres-cohort-row-identity.test.ts`, inside the gated `describe`, after the three tests of Task 2:

```ts
  const carriersOf = async (row: CohortVariant): Promise<string[]> =>
    (await repo.getCarriers(row)).map((carrier) => carrier.case_name)

  it('lists the carriers of each build of one coordinate separately', async () => {
    const byBuild: Record<string, string[]> = {}
    for (const row of await at(100)) byBuild[row.genome_build] = await carriersOf(row)
    expect(byBuild).toEqual({ GRCh38: ['b38-a', 'b38-b'], GRCh37: ['b37-a'] })
  })

  it('lists the carriers of the sv row and of the cnv row separately', async () => {
    const byType: Record<string, string[]> = {}
    for (const row of await at(1000)) byType[row.variant_type] = await carriersOf(row)
    expect(byType).toEqual({ sv: ['sv-a'], cnv: ['cnv-a', 'cnv-b'] })
  })

  it('returns as many carriers as the row counts, for every row', async () => {
    for (const row of await rows()) expect(await carriersOf(row)).toHaveLength(row.carrier_count)
  })

  it('finds the carriers of an indel row listed under the snv filter', async () => {
    const [indel] = (await rows({ variant_type: 'snv' })).filter((row) => row.pos === 500)
    expect(indel.variant_type).toBe('indel')
    expect(await carriersOf(indel)).toEqual(['indel-a'])
  })
```

`tests/main/storage/postgres-cohort-repository.test.ts`, test `'maps carriers with numeric case IDs and preserves gq and dp when present'` (lines 622-624), replace the call and the parameter assertion:

```ts
    const carriers = await repository.getCarriers({
      chr: '1',
      pos: 123,
      ref: 'A',
      alt: 'G',
      variant_type: 'snv',
      genome_build: 'GRCh38'
    })

    expect(query.mock.calls[0][1]).toEqual(['1', 123, 'A', 'G', 'snv', 'GRCh38'])
    expect(query.mock.calls[0][0]).toContain('v.variant_type = $5 AND c.genome_build = $6')
```

- [ ] **Step 2: Run the storage tests to verify they fail**

Run: `npx vitest run tests/main/database/cohort.test.ts tests/main/storage/postgres-cohort-repository.test.ts`
Expected: the four new SQLite tests and the updated `getCarriers` test FAIL with a better-sqlite3 binding error (the method still takes four positional values); the PostgreSQL mapping test FAILS on the parameter list (`[{…}, undefined, undefined, undefined]`).

Run (needs `make pg-up`): `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage/postgres-cohort-row-identity.test.ts`
Expected: the four new tests FAIL (the query receives an object as `$1`).

- [ ] **Step 3: Implement the two queries**

`src/main/database/cohort.ts`: add `CohortVariantIdentity` to the type import from `'../../shared/types/cohort'` (lines 12-19), and replace `getCarriers` (lines 411-430):

```ts
  /**
   * Get the carriers of one cohort row. The row is one variant type in one
   * genome build, so both are part of the lookup (#503).
   */
  getCarriers(variant: CohortVariantIdentity): CohortCarrier[] {
    const sql = `
      SELECT
        v.case_id,
        c.name as case_name,
        ${resolvedGtSql('v.gt_num', 'sqlite')} as gt_num
      FROM variants v
      JOIN cases c ON v.case_id = c.id
      WHERE c.import_status = 'ready' AND v.chr = ? AND v.pos = ? AND v.ref = ? AND v.alt = ?
        AND v.variant_type = ? AND c.genome_build = ?
      GROUP BY v.case_id, c.name
      ORDER BY c.name
    `

    const stmt = this.getStatement(sql)
    return stmt.all(
      variant.chr,
      variant.pos,
      variant.ref,
      variant.alt,
      variant.variant_type,
      variant.genome_build
    ) as CohortCarrier[]
  }
```

`src/main/storage/postgres/PostgresCohortRepository.ts`: add `CohortVariantIdentity` to the type import from `'../../../shared/types/cohort'` (lines 4-11), and replace the head of `getCarriers` (lines 290-309, through the bound values; the row mapping below it is unchanged):

```ts
  /** Carriers of one cohort row: one variant type in one genome build (#503). */
  async getCarriers(variant: CohortVariantIdentity): Promise<CohortCarrierWithDepth[]> {
    const result = await this.pool.query(
      `SELECT
         v.case_id,
         c.name AS case_name,
         ${resolvedGtSql('v.gt_num', 'postgres')} AS gt_num,
         MAX(v.gq) AS gq,
         MAX(v.dp) AS dp
       FROM ${this.schemaName}."variants" v
       JOIN ${this.schemaName}."cases" c ON c.id = v.case_id
       WHERE v.chr = $1 AND v.pos = $2 AND v.ref = $3 AND v.alt = $4
         AND v.variant_type = $5 AND c.genome_build = $6
       GROUP BY v.case_id, c.name
       ORDER BY c.name`,
      [
        variant.chr,
        variant.pos,
        variant.ref,
        variant.alt,
        variant.variant_type,
        variant.genome_build
      ]
    )
```

- [ ] **Step 4: Carry the object through the executors, the worker and the logic layer**

`src/main/storage/read-executor.ts`, line 3 and line 62:

```ts
import type { CohortSearchParams, CohortVariantIdentity } from '../../shared/types/cohort'
```

```ts
  | { type: 'cohort:carriers'; params: [variant: CohortVariantIdentity] }
```

(`SqliteReadExecutor.ts:220` and `PostgresReadExecutor.ts:179` spread `task.params` and need no edit.)

`src/main/workers/db-worker-dispatch.ts`, replace lines 128-134:

```ts
      case 'cohort:carriers':
        return repos.cohort.getCarriers(params[0] as Parameters<typeof repos.cohort.getCarriers>[0])
```

`src/main/ipc/handlers/cohort-logic.ts`, add after line 23:

```ts
import type { CohortVariantIdentity } from '../../../shared/types/cohort'
```

replace lines 174-186:

```ts
/** Postgres-backed carriers of one cohort row via the storage read executor. */
export async function getCohortCarriersViaSession(
  variant: CohortVariantIdentity,
  getSession: () => StorageSession
): Promise<unknown> {
  const carriers = await getSession()
    .getReadExecutor()
    .execute({ type: 'cohort:carriers', params: [variant] })
  return convertBigInts(carriers)
}
```

and replace lines 286-316:

```ts
/**
 * Get the carriers of one cohort row.
 */
export async function getCarriers(
  variant: CohortVariantIdentity,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null,
  getSession?: GetSession
): Promise<unknown> {
  const postgresSession = getPostgresSession(getSession)
  if (postgresSession !== undefined) {
    return getCohortCarriersViaSession(variant, () => postgresSession)
  }

  const pool = getDbPool?.()
  let carriers: ReturnType<CohortService['getCarriers']>
  if (pool) {
    carriers = await pool.run({
      type: 'cohort:carriers',
      params: [variant]
    })
  } else {
    const db = getDb()
    carriers = db.cohort.getCarriers(variant)
  }
  // Ensure data is serializable (convert any BigInt to Number)
  return convertBigInts(carriers)
}
```

- [ ] **Step 5: Write the failing boundary tests (IPC and web)**

`tests/main/handlers/cohort-logic.test.ts`, replace the body of `'routes getCarriers through the PostgreSQL read executor'` (lines 105-118):

```ts
  it('routes getCarriers through the PostgreSQL read executor', async () => {
    const { execute, session } = makePostgresSession([{ case_id: 7n }])
    const getDb = vi.fn()
    const getDbPool = vi.fn()
    const variant = {
      chr: 'chr1',
      pos: 123,
      ref: 'A',
      alt: 'T',
      variant_type: 'snv',
      genome_build: 'GRCh38'
    }

    const result = await logic.getCarriers(variant, getDb, getDbPool, () => session)

    expect(execute).toHaveBeenCalledWith({ type: 'cohort:carriers', params: [variant] })
    expect(result).toEqual([{ case_id: 7 }])
    expect(getDb).not.toHaveBeenCalled()
    expect(getDbPool).not.toHaveBeenCalled()
  })
```

and append to the file:

```ts
describe('cohort:carriers IPC validation (#503)', () => {
  const VARIANT = {
    chr: 'chr1',
    pos: 100,
    ref: 'A',
    alt: 'T',
    variant_type: 'snv',
    genome_build: 'GRCh38'
  }

  function registerCarriers(): {
    execute: ReturnType<typeof vi.fn<[StorageReadTask], Promise<unknown>>>
    carriers: (...args: unknown[]) => Promise<unknown>
  } {
    const execute = vi.fn<[StorageReadTask], Promise<unknown>>().mockResolvedValue([])
    const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    registerCohortHandlers({
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
          registered.set(channel, handler)
        }
      } as never,
      getDb: (() => {
        throw new Error('getDb should not be called for postgres cohort IPC')
      }) as never,
      getDbPool: (() => {
        throw new Error('getDbPool should not be called for postgres cohort IPC')
      }) as never,
      getDbManager: (() => ({
        getCurrentSession: () =>
          ({
            capabilities: { backend: 'postgres' },
            getReadExecutor: () => ({ execute })
          }) as unknown as StorageSession
      })) as never
    })
    return { execute, carriers: registered.get('cohort:carriers')! }
  }

  it('passes the six identity fields to storage', async () => {
    const { execute, carriers } = registerCarriers()

    await expect(carriers(undefined, { ...VARIANT, carrier_count: 2 })).resolves.toEqual([])

    expect(execute).toHaveBeenCalledWith({ type: 'cohort:carriers', params: [VARIANT] })
  })

  it.each([
    ['no genome build', [{ ...VARIANT, genome_build: undefined }]],
    ['no variant type', [{ ...VARIANT, variant_type: undefined }]],
    ['an empty genome build', [{ ...VARIANT, genome_build: '' }]],
    ['an empty variant type', [{ ...VARIANT, variant_type: '' }]],
    ['the old four positional arguments', ['chr1', 100, 'A', 'T']]
  ])('rejects a request with %s before it reaches storage', async (_label, args) => {
    const { execute, carriers } = registerCarriers()

    await expect(carriers(undefined, ...args)).resolves.toMatchObject({
      message: 'Invalid carrier query parameters'
    })

    expect(execute).not.toHaveBeenCalled()
  })
})
```

`tests/web-gate/dispatcher-adapters-read-seams.test.ts`, in `'cohort read helpers map preload method names to storage task names'` replace the `getCarriers` call (lines 167-172) and its assertion (lines 178-181):

```ts
    const variant = {
      chr: 'chr22',
      pos: 12345,
      ref: 'A',
      alt: 'T',
      variant_type: 'snv',
      genome_build: 'GRCh38'
    }
    await overrides['cohort:getCarriers'].handle([variant], {} as never, reply as never, deps)
```

```ts
    expect(execute).toHaveBeenCalledWith({ type: 'cohort:carriers', params: [variant] })
```

and add after that test:

```ts
  test.each([
    ['no genome build', [{ chr: 'chr22', pos: 12345, ref: 'A', alt: 'T', variant_type: 'snv' }]],
    ['no variant type', [{ chr: 'chr22', pos: 12345, ref: 'A', alt: 'T', genome_build: 'GRCh38' }]],
    [
      'an empty genome build',
      [{ chr: 'chr22', pos: 12345, ref: 'A', alt: 'T', variant_type: 'snv', genome_build: '' }]
    ],
    ['the old four positional arguments', ['chr22', 12345, 'A', 'T']]
  ])('cohort.getCarriers rejects a request with %s before storage execution', async (_l, args) => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['cohort:getCarriers'].handle(
      args,
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({
      error: 'invalid-carrier-params',
      message: 'Invalid carrier query parameters'
    })
    expect(execute).not.toHaveBeenCalled()
  })
```

- [ ] **Step 6: Run the boundary tests to verify they fail**

Run: `npx vitest run tests/main/handlers/cohort-logic.test.ts && npx vitest run --project web-gate tests/web-gate/dispatcher-adapters-read-seams.test.ts`
Expected: `'passes the six identity fields to storage'` FAILS (the handler still validates four positional arguments and returns the validation error); the `'the old four positional arguments'` case FAILS over IPC and on the web route (the old argument list passes validation and then breaks in the call chain Step 4 changed); `'cohort read helpers map…'` FAILS. `'routes getCarriers through the PostgreSQL read executor'` already PASSES (Step 4). The remaining rejection cases pass for the wrong reason (no `chr` string) and stay green. `make typecheck` is red between Step 4 and Step 7; that is expected inside this task.

- [ ] **Step 7: Implement the schema, the IPC handler, the web route and OpenAPI**

`src/shared/api/schemas/cohort.ts`, replace lines 7-12 and lines 23-25:

```ts
/** The six-field identity of one cohort row. Nothing is optional, nothing defaults (#503). */
export const CohortCarriersParamsSchema = z.object({
  chr: z.string().min(1),
  pos: z.number().int().positive(),
  ref: z.string().min(1),
  alt: z.string().min(1),
  variant_type: z.string().min(1),
  genome_build: z.string().min(1)
})
```

```ts
  getCarriers: z.object({
    args: z.tuple([CohortCarriersParamsSchema])
  }),
```

`src/main/ipc/handlers/cohort.ts`: delete line 1 (`import { z } from 'zod'`) and the local schema (lines 25-31, comment included); add after the `ipc-schemas` import (line 7):

```ts
import { CohortCarriersParamsSchema } from '../../../shared/api/schemas/cohort'
```

and replace the `cohort:carriers` registration (lines 90-112):

```ts
  ipcMain.handle('cohort:carriers', async (_event, variant: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CohortCarriersParamsSchema.safeParse(variant)
      if (!validated.success) {
        mainLogger.error(`Invalid cohort:carriers params: ${validated.error.message}`, 'cohort')
        throw new Error('Invalid carrier query parameters')
      }

      return getCarriers(validated.data, getDb, getDbPool, getSession)
    })
  })
```

`src/web/server/routes/cohort.ts`, replace lines 100-117:

```ts
    'cohort:getCarriers': {
      async handle(args, _request, reply, { session }) {
        const validated = CohortCarriersParamsSchema.safeParse(args[0])
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-carrier-params', message: 'Invalid carrier query parameters' }
        }

        return await getCohortCarriersViaSession(validated.data, () => session)
      }
    },
```

`src/web/server/routes/openapi-paths/cohort.ts`, line 50:

```ts
      summary: 'Return carriers for one cohort row (coordinate, variant type, genome build)',
```

- [ ] **Step 8: Update the remaining callers in tests**

Each of these calls the storage method or the task directly; give them the object. All their fixtures are `snv` in `GRCh38` (`createCase` defaults the build, the fixtures are single-base substitutions).

`tests/main/handlers/cohort-handlers.test.ts:194`:

```ts
      const result = cohortService.getCarriers({
        chr: '1',
        pos: 12345,
        ref: 'A',
        alt: 'G',
        variant_type: 'snv',
        genome_build: 'GRCh38'
      })
```

`tests/main/database/split-genotype-zygosity.test.ts:111-112`:

```ts
    const carriers = (alt: string): string[] =>
      service.cohort
        .getCarriers({
          chr: 'chr1',
          pos: 1000,
          ref: 'A',
          alt,
          variant_type: 'snv',
          genome_build: 'GRCh38'
        })
        .map((c) => `${c.case_name} ${c.gt_num}`)
```

`tests/main/database/conflicting-genotype-calls.test.ts:48` and `tests/main/database/case-import-status-readers.test.ts:97`: replace `getCarriers('1', 100, 'A', 'G')` with

```ts
getCarriers({ chr: '1', pos: 100, ref: 'A', alt: 'G', variant_type: 'snv', genome_build: 'GRCh38' })
```

(let Prettier wrap it: `npx prettier --write` on the two files).

`tests/main/workers/db-worker-dispatch.test.ts:189`:

```ts
      params: [
        {
          chr: 'chr1',
          pos: 100000,
          ref: 'A',
          alt: 'T',
          variant_type: 'snv',
          genome_build: 'GRCh38'
        }
      ]
```

`tests/main/storage/postgres-read-executor.test.ts`: add near `cohortParams` (line 327)

```ts
    const carrierVariant = {
      chr: 'chr1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      variant_type: 'snv',
      genome_build: 'GRCh38'
    }
```

and use it at line 341 (`params: [carrierVariant]`) and line 354 (`expect(cohort.getCarriers).toHaveBeenCalledWith(carrierVariant)`).

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/main/database tests/main/handlers tests/main/workers tests/main/storage tests/refactor-checkpoint && npx vitest run --project web-gate tests/web-gate/dispatcher-adapters-read-seams.test.ts && make typecheck`
Expected: all PASS (the `getCarriers` handler snapshot is unchanged), typecheck exits 0.

Run (needs `make pg-up`): `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage/postgres-cohort-row-identity.test.ts tests/main/storage/cohort-backend-parity.test.ts`
Expected: all PASS (7 tests in the row-identity file).

- [ ] **Step 10: Commit**

```bash
git add src/main src/shared/api/schemas/cohort.ts src/web/server/routes tests
git commit -m "fix(cohort): look carriers up by variant type and genome build (#503)"
```

---

### Task 4: Renderer-facing contract (API types, preload, query, mock, parity fixtures)

Lands in the same PR as Task 3: until this task the preload still sends four positional arguments, which Task 3 rejects.

**Files:**
- Modify: `src/shared/types/api.ts:63-69` (type import), `:431-436`
- Modify: `src/shared/ipc/domains/cohort.ts:1-7`, `:25-30`
- Modify: `src/preload/domains/cohort.ts:9`
- Modify: `src/preload/window-api/core-api.ts:159`
- Modify: `src/renderer/src/queries/carriers.ts:3`, `:8-18`
- Modify: `src/renderer/src/mocks/mockApi.ts:650-653` (`cohort.getCarriers`; line numbers before Task 2's edit, which removed two lines above)
- Modify: `tests/web-gate/parity/ipc/cohort.ts:9-14`, `tests/fixtures/ipc-parity/manifest.json:484-493`
- Test: `tests/shared/ipc/domains/cohort.test.ts:49,65,113,131,147`, `tests/renderer/components/cohort/CarrierExpandedRow.test.ts:31-32,69` and a new test, `tests/renderer/mocks/mockApi-cohort-zygosity.test.ts`

**Interfaces:**
- Consumes: `CohortVariantIdentity`, `cohortVariantKey` (Task 1); `mockCohortIdentity(v, cases)` (Task 2); IPC channel `cohort:carriers` taking one object (Task 3).
- Produces:
  - `CohortAPI.getCarriers` and `CohortDomainContract.getCarriers`: `(variant: CohortVariantIdentity) => Promise<IpcResult<CohortCarrier[]>>`
  - `carriersQuery(variant: Pick<CohortVariant, 'variant_key' | keyof CohortVariantIdentity>)`: cache key `queryKeys.carriers(variant.variant_key)` (unchanged), request = a plain six-field object.

- [ ] **Step 1: Write the failing tests**

`tests/shared/ipc/domains/cohort.test.ts`: add at file scope, below the imports,

```ts
const CARRIER_VARIANT = {
  chr: 'chr22',
  pos: 1000,
  ref: 'A',
  alt: 'T',
  variant_type: 'snv',
  genome_build: 'GRCh38'
}
```

and replace
- line 49: `await expect(api.getCarriers(CARRIER_VARIANT)).resolves.toEqual([])`
- line 65: `expect(invoke).toHaveBeenNthCalledWith(4, 'cohort:carriers', CARRIER_VARIANT)`
- line 113: `getCarriers: (variant: typeof CARRIER_VARIANT) => Promise<unknown>`
- line 131: `await expect(api.cohort.getCarriers(CARRIER_VARIANT)).resolves.toEqual([])`
- line 147: `expect(invoke).toHaveBeenCalledWith('cohort:carriers', CARRIER_VARIANT)`

`tests/renderer/components/cohort/CarrierExpandedRow.test.ts`: add the import

```ts
import { cohortVariantKey } from '../../../../src/shared/utils/cohort-variant-key'
```

replace the `variant` factory (lines 31-32):

```ts
const variant = (pos: number, genome_build = 'GRCh38'): CohortVariant => {
  const identity = { chr: 'chr1', pos, ref: 'A', alt: 'T', variant_type: 'snv', genome_build }
  return { ...identity, variant_key: cohortVariantKey(identity) } as CohortVariant
}
```

replace the assertion on line 69:

```ts
    expect(getCarriers).toHaveBeenCalledExactlyOnceWith({
      chr: 'chr1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      variant_type: 'snv',
      genome_build: 'GRCh38'
    })
```

and add after `"does not show another database's carriers for the same variant"`:

```ts
  it("does not reuse another genome build's carriers for the same coordinate", async () => {
    getCarriers.mockImplementation(async (asked: { genome_build: string }) => [
      carrier(`Case ${asked.genome_build}`)
    ])
    const wrapper = mountRow(variant(100, 'GRCh38'))
    await flushPromises()
    expect(wrapper.text()).toContain('Case GRCh38')

    await wrapper.setProps({ variant: variant(100, 'GRCh37') })
    await flushPromises()

    expect(getCarriers).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Case GRCh37')
    expect(wrapper.text()).not.toContain('Case GRCh38')
  })
```

`tests/renderer/mocks/mockApi-cohort-zygosity.test.ts`, inside `describe('mock cohort row identity')`:

```ts
  it('lists as many carriers as each row counts', async () => {
    const { mockApi } = await import('../../../src/renderer/src/mocks/mockApi')
    const { data } = (await mockApi.cohort.getVariants({ limit: 1000 } as never)) as unknown as {
      data: CohortVariant[]
    }
    for (const row of data) {
      const carriers = (await mockApi.cohort.getCarriers(row)) as unknown as Array<{
        case_id: number
      }>
      // The mock counts a case once, also when it holds the variant twice.
      expect(new Set(carriers.map((carrier) => carrier.case_id)).size).toBe(row.carrier_count)
    }
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/ipc/domains/cohort.test.ts tests/renderer/components/cohort/CarrierExpandedRow.test.ts tests/renderer/mocks/mockApi-cohort-zygosity.test.ts`
Expected: the domain tests FAIL (`invoke` was called with `'cohort:carriers', {…}, undefined, undefined, undefined`); `'loads and lists the carriers of its variant'` FAILS (called with four positional values); the genome-build test FAILS (`Case undefined` rendered); the mock test FAILS (no carriers match an object passed as `chr`).

- [ ] **Step 3: Implement the contract**

`src/shared/types/api.ts`: add `CohortVariantIdentity` to the type import from `'./cohort'` (lines 63-69) and replace lines 431-436:

```ts
  getCarriers: (variant: CohortVariantIdentity) => Promise<IpcResult<CohortCarrier[]>>
```

`src/shared/ipc/domains/cohort.ts`: add `CohortVariantIdentity` to the type import (lines 1-7) and replace lines 25-30 with the same line:

```ts
  getCarriers: (variant: CohortVariantIdentity) => Promise<IpcResult<CohortCarrier[]>>
```

`src/preload/domains/cohort.ts`, line 9:

```ts
    getCarriers: (variant) => ipcRenderer.invoke('cohort:carriers', variant),
```

`src/preload/window-api/core-api.ts`, line 159:

```ts
      getCarriers: (variant) => cohortDomain.getCarriers(variant),
```

`src/renderer/src/queries/carriers.ts`, line 3 and lines 8-18:

```ts
import type { CohortVariant, CohortVariantIdentity } from '../../../shared/types/cohort'
```

```ts
/** The cases that carry one cohort row (one variant type in one genome build). */
export const carriersQuery = defineQueryOptions(
  (variant: Pick<CohortVariant, 'variant_key' | keyof CohortVariantIdentity>) => ({
    key: queryKeys.carriers(variant.variant_key),
    query: async () =>
      unwrapIpcResult(
        // A plain object: the row is a reactive proxy, which IPC cannot clone.
        await queryApi().cohort.getCarriers({
          chr: variant.chr,
          pos: variant.pos,
          ref: variant.ref,
          alt: variant.alt,
          variant_type: variant.variant_type,
          genome_build: variant.genome_build
        })
      ),
    enabled: canQuery('cohort.carriers')
  })
)
```

`src/renderer/src/mocks/mockApi.ts`, `cohort.getCarriers`: replace its first four lines (signature, comment, `const carriers = variants`, `.filter(…)`):

```ts
    getCarriers: async (variant) => {
      // Find all cases carrying this cohort row
      const carriers = variants
        .filter((v) => cohortVariantKey(mockCohortIdentity(v, cases)) === cohortVariantKey(variant))
```

(same line count; the `.map(…)` and `return carriers` below are unchanged. The parameter is typed by `mockApi: WindowAPI`.)

- [ ] **Step 4: Update the parity fixtures**

`tests/web-gate/parity/ipc/cohort.ts`, replace lines 9-14. The anchor is COMT `chr22:20000350 G>A`, an SNV imported as `GRCh38` (`tests/fixtures/ipc-parity/manifest.json:117,126`).

```ts
    await ctx.call('cohort', 'getCarriers', [
      {
        chr: ctx.primaryVariant.chr,
        pos: ctx.primaryVariant.pos,
        ref: ctx.primaryVariant.ref,
        alt: ctx.primaryVariant.alt,
        variant_type: 'snv',
        genome_build: 'GRCh38'
      }
    ]),
```

`tests/fixtures/ipc-parity/manifest.json`, the `cohort` / `getCarriers` operation (lines 484-493):

```json
        {
          "domain": "cohort",
          "method": "getCarriers",
          "args": [
            {
              "chr": "$variant.primary.chr",
              "pos": "$variant.primary.pos",
              "ref": "$variant.primary.ref",
              "alt": "$variant.primary.alt",
              "variant_type": "snv",
              "genome_build": "GRCh38"
            }
          ]
        },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/shared/ipc tests/shared/types tests/renderer/components/cohort tests/renderer/components/CohortTable.paging.test.ts tests/renderer/components/CohortTableRow.test.ts tests/renderer/mocks tests/renderer/queries && npm run test:ipc-parity-fixtures && make typecheck`
Expected: all PASS (`tests/shared/ipc` includes the parity-manifest test, `tests/shared/types` the preload contract test); the fixture validator prints `IPC parity fixtures valid: …`; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/api.ts src/shared/ipc/domains/cohort.ts src/preload \
  src/renderer/src/queries/carriers.ts src/renderer/src/mocks/mockApi.ts tests
git commit -m "fix(cohort): send the six-field row identity for the carrier list (#503)"
```

---

### Task 5: Verification

**Files:** none.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: the evidence to report in the PR.

- [ ] **Step 1: Typecheck**

Run: `make typecheck`
Expected: exits 0 (renderer, node, web, contract typecheck).

- [ ] **Step 2: Desktop suite**

Run: `make rebuild-node && make test`
Expected: exits 0. The PostgreSQL-gated suites report as skipped.

- [ ] **Step 3: Web layer**

Run (needs PostgreSQL: `make pg-up`, `VARLENS_PG_URL` exported): `VARLENS_WEB=1 make test`
Expected: exits 0 (desktop suite, `build-web`, `web-gate-static` including the IPC fixture validator, `web-gate-integration`).

- [ ] **Step 4: PostgreSQL-gated storage tests of this change**

Run: `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage/postgres-cohort-row-identity.test.ts tests/main/storage/cohort-backend-parity.test.ts tests/main/storage/cohort-summary-drift.test.ts tests/main/storage/variant-filter-backend-parity.test.ts tests/main/storage/postgres-cohort-keyset.test.ts`
Expected: all PASS, none skipped.

- [ ] **Step 5: IPC contract tests**

Run: `npx vitest run tests/shared/ipc`
Expected: all PASS; `scripts/parity-baseline.json` is unchanged (`git status` shows no change to it).

- [ ] **Step 6: Agent health**

Run: `make agent-check`
Expected: exits 0, no "Baseline oversized files that grew" entry. `src/renderer/src/mocks/mockApi.ts` is at 1234 lines and `src/shared/types/api.ts` at 908, both below their baselines.

- [ ] **Step 7: Scope check**

Run: `git diff --stat main -- src/main/database/migrations.ts src/main/storage/postgres/migrations src/shared/sql`
Expected: empty output (no migration, no change to the summary SQL).

- [ ] **Step 8: Report**

Report each command above with its outcome. Not run here: `make preflight-full`. The orchestrator runs that gate once, after this plan and the two sibling plans (#455, #520) have landed on the integration branch. The desktop ↔ web parity E2E (`make web-parity-e2e`, which executes `tests/web-gate/parity/ipc/cohort.ts`) is opt-in and is also left to that gate; say so in the report.
