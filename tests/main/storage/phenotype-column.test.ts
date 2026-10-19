/**
 * Stored phenotype column (spec .planning/specs/2026-10-15-phenotype-column.md):
 * scores are computed once per HPO profile and HPO data key, never on a read;
 * the case table sorts (nulls last) and filters on them, the cohort table shows
 * the best carrier score. The same scenario runs on SQLite and, gated by
 * VARLENS_RUN_POSTGRES_E2E=1, on PostgreSQL, which must give the same answers.
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import {
  buildHpoSimilarityDb,
  openHpoGeneScorer
} from '../../../src/main/services/phenotype/hpo-similarity-db'
import { withPhenotypeScores } from '../../../src/main/storage/phenotype-score-executor'
import type { StorageReadExecutor } from '../../../src/main/storage/read-executor'
import type { StorageWriteExecutor } from '../../../src/main/storage/write-executor'
import { SqliteReadExecutor } from '../../../src/main/storage/sqlite/SqliteReadExecutor'
import { SqliteWriteExecutor } from '../../../src/main/storage/sqlite/SqliteWriteExecutor'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseMetadataRepository } from '../../../src/main/storage/postgres/PostgresCaseMetadataRepository'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresReadExecutor } from '../../../src/main/storage/postgres/PostgresReadExecutor'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import { PostgresWriteExecutor } from '../../../src/main/storage/postgres/PostgresWriteExecutor'
import { HPO_DATA_CONFIG } from '../../../src/shared/config/hpo-data.config'
import type { CohortVariant } from '../../../src/shared/types/cohort'
import type { SortItem, Variant, VariantFilter } from '../../../src/shared/types/database'
import { GENES_TO_PHENOTYPE, HP_JSON, PHENOTYPE_HPOA, T } from '../../shared/phenotype/hpo-fixture'

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface Row {
  chr: string
  pos: number
  gene: string | null
  gt: string
}
/** Two cases sharing 1:100 (GENE1); OTHER and the gene-less row never score. */
const CASES: Array<{ name: string; rows: Row[] }> = [
  {
    name: 'A',
    rows: [
      { chr: '1', pos: 100, gene: 'GENE1', gt: '0/1' },
      { chr: '2', pos: 200, gene: 'GENE2', gt: '0/1' },
      { chr: '3', pos: 300, gene: 'OTHER', gt: '0/1' },
      { chr: '4', pos: 400, gene: null, gt: '0/1' }
    ]
  },
  {
    name: 'B',
    rows: [
      { chr: '1', pos: 100, gene: 'GENE1', gt: '1/1' },
      { chr: '2', pos: 250, gene: 'GENE2', gt: '0/1' }
    ]
  }
]

interface Backend {
  caseIds: number[]
  read: StorageReadExecutor
  write: StorageWriteExecutor
  storedRows(caseId: number): Promise<number>
  close(): Promise<void>
}

/** Counts scorer runs and lets the test swap the HPO data key. */
function instrument(backend: Backend): {
  read: StorageReadExecutor
  calls: () => number
  setKey: (key: string) => void
} {
  let calls = 0
  let key = 'hpo-1'
  const counting: StorageReadExecutor = {
    execute: (task) => {
      if (task.type === 'hpo:caseScores') calls++
      return backend.read.execute(task)
    }
  }
  return {
    read: withPhenotypeScores(counting, backend.write, () => key),
    calls: () => calls,
    setKey: (k) => (key = k)
  }
}

async function scenario(backend: Backend) {
  const [a, b] = backend.caseIds
  const { read, calls, setKey } = instrument(backend)
  const assign = (caseId: number, hpoId: string, flags?: { key?: boolean }): Promise<unknown> =>
    backend.write.execute({
      type: 'case-metadata:assignHpoTerm',
      params: [caseId, hpoId, hpoId, flags]
    })
  const query = async (
    filter: Partial<VariantFilter>,
    sortBy?: SortItem[],
    limit = 50,
    offset = 0
  ): Promise<Array<[string | null, number | null]>> => {
    const result = (await read.execute({
      type: 'variants:query',
      params: [{ case_id: a, ...filter }, limit, offset, sortBy, true, false, {}]
    })) as { data: Variant[] }
    return result.data.map((v) => [v.gene_symbol, v.phenotype_score ?? null])
  }
  const cohort = async (): Promise<Array<[string, number | null, string | null]>> => {
    const result = (await read.execute({
      type: 'cohort:query',
      params: [{ limit: 50, offset: 0, sort_by: 'phenotype_score', sort_order: 'desc' }]
    })) as { data: Array<CohortVariant & { phenotype_disease?: string | null }> }
    return result.data.map((v) => [
      `${v.chr}:${v.pos}`,
      v.phenotype_score ?? null,
      v.phenotype_disease ?? null
    ])
  }
  const desc: SortItem[] = [{ key: 'phenotype_score', order: 'desc' }]

  await assign(a, T.C)
  await assign(a, T.E)
  await assign(b, T.D)
  const sortedDesc = await query({}, desc)
  const sortedAsc = await query({}, [{ key: 'phenotype_score', order: 'asc' }])
  const paged = [...(await query({}, desc, 2, 0)), ...(await query({}, desc, 2, 2))]
  const filtered = await query({
    column_filters: { phenotype_score: { operator: '>=', value: 0.5, includeEmpty: false } }
  })
  // The cohort read does not wait: it starts B's rescore in the background. A case
  // read of B joins that same rescore, so the next cohort read sees B's scores.
  await cohort()
  await read.execute({
    type: 'variants:query',
    params: [{ case_id: b }, 1, 0, undefined, true, false]
  })
  const cohortRows = await cohort()
  const callsAfterReads = calls()

  await assign(a, T.C, { key: true }) // a flag change is a new profile
  await query({})
  const callsAfterTermChange = calls()
  setKey('hpo-2') // an HPO data update
  await query({})
  await query({})
  const callsAfterKeyChange = calls()

  for (const hpoId of [T.C, T.E]) {
    await backend.write.execute({ type: 'case-metadata:removeHpoTerm', params: [a, hpoId] })
  }
  const cleared = await query({})
  return {
    sortedDesc,
    sortedAsc,
    paged,
    filtered,
    cohortRows,
    callsAfterReads,
    callsAfterTermChange,
    callsAfterKeyChange,
    cleared,
    storedAfterClear: await backend.storedRows(a),
    callsAfterClear: calls()
  }
}

let dir: string
const previousEnv = process.env[HPO_DATA_CONFIG.envPath]
let expected: Awaited<ReturnType<typeof scenario>>

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'varlens-phenocol-'))
  const hpoPath = join(dir, 'hpo_similarity.db')
  buildHpoSimilarityDb(
    { ontology: HP_JSON, annotations: PHENOTYPE_HPOA, genes: GENES_TO_PHENOTYPE },
    { release: 'v2026-09-01', sha256: {} },
    hpoPath
  )
  process.env[HPO_DATA_CONFIG.envPath] = hpoPath
  const P = (hpoId: string): { hpoId: string; excluded: boolean; key: boolean } => ({
    hpoId,
    excluded: false,
    key: false
  })
  const scoreA = openHpoGeneScorer([P(T.C), P(T.E)], hpoPath)!
  const scoreB = openHpoGeneScorer([P(T.D)], hpoPath)!
  const g1 = scoreA.score('GENE1')!
  const g2 = scoreA.score('GENE2')!
  const [high, low] =
    g1 >= g2
      ? [
          ['GENE1', g1],
          ['GENE2', g2]
        ]
      : [
          ['GENE2', g2],
          ['GENE1', g1]
        ]
  const ranked = [high, low] as Array<[string, number]>
  expected = {
    sortedDesc: [...ranked, ['OTHER', null], [null, null]],
    sortedAsc: [...[...ranked].reverse(), ['OTHER', null], [null, null]],
    paged: [...ranked, ['OTHER', null], [null, null]],
    filtered: ranked.filter(([, s]) => s >= 0.5),
    // Genomic order first: equal scores keep it (the backends' tiebreaker).
    cohortRows: [
      ['1:100', Math.max(g1, scoreB.score('GENE1')!), '2 carriers scored'],
      ['2:200', g2, '1 carrier scored'],
      ['2:250', scoreB.score('GENE2')!, '1 carrier scored'],
      ['3:300', null, null],
      ['4:400', null, null]
    ].sort((x, y) => Number(y[1] ?? -1) - Number(x[1] ?? -1)) as Array<
      [string, number | null, string | null]
    >,
    callsAfterReads: 2, // one per case: case A for the table, case B for the cohort
    callsAfterTermChange: 3,
    // Both cases are stale now, but only A is read: A is rescored once, B waits for its read.
    callsAfterKeyChange: 4,
    cleared: [
      ['GENE1', null],
      ['GENE2', null],
      ['OTHER', null],
      [null, null]
    ],
    storedAfterClear: 0,
    callsAfterClear: 4 // no terms: the rows are cleared without scoring
  }
})

afterAll(() => {
  if (previousEnv === undefined) delete process.env[HPO_DATA_CONFIG.envPath]
  else process.env[HPO_DATA_CONFIG.envPath] = previousEnv
  rmSync(dir, { recursive: true, force: true })
})

/** Scores compared to 1e-9: float8 on PostgreSQL, REAL on SQLite. */
function rounded<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) =>
      typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e9) / 1e9 : v
    )
  ) as T
}

describe('phenotype column on SQLite', () => {
  it('scores once per profile and data key; sorts, filters and aggregates stored values', async () => {
    const db = new DatabaseService(':memory:')
    const caseIds = CASES.map((c) => {
      const id = db.cases.createCase(c.name, `/tmp/${c.name}.vcf`, 0, 'GRCh38')
      db.variants.insertVariantsBatch(
        id,
        c.rows.map((r) => ({
          chr: r.chr,
          pos: r.pos,
          ref: 'A',
          alt: 'T',
          gene_symbol: r.gene,
          gt_num: r.gt,
          variant_type: 'snv'
        })) as never
      )
      return id
    })
    db.cohortSummary.rebuild()
    const backend: Backend = {
      caseIds,
      read: new SqliteReadExecutor(db, null),
      write: new SqliteWriteExecutor(db, { workerPath: null }),
      storedRows: async (caseId) =>
        (
          db.database
            .prepare('SELECT COUNT(*) AS n FROM case_phenotype_scores WHERE case_id = ?')
            .get(caseId) as { n: number }
        ).n,
      close: async () => db.close()
    }
    try {
      expect(rounded(await scenario(backend))).toEqual(rounded(expected))
    } finally {
      await backend.close()
    }
  })
})

describe.skipIf(!RUN_PG)('phenotype column on PostgreSQL', () => {
  it('matches SQLite', async () => {
    const schema = `vt_phenocol_${randomBytes(4).toString('hex')}`
    const pool = new Pool({ connectionString: PG_URL, max: 4 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    let read: PostgresReadExecutor | undefined
    try {
      await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
      const summary = new PostgresCohortSummaryRepository()
      const caseIds: number[] = []
      for (const c of CASES) {
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
           VALUES ($1, '/x', 0, 0, 'GRCh38') RETURNING id`,
          [c.name]
        )
        const id = Number(rows[0].id)
        for (const r of c.rows) {
          await pool.query(
            `INSERT INTO "${schema}".variants (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
             VALUES ($1, $2, $3, 'A', 'T', 'snv', $4, $5)`,
            [id, r.chr, r.pos, r.gene, r.gt]
          )
        }
        const client = new Client({ connectionString: PG_URL })
        await client.connect()
        await client.query('BEGIN')
        await summary.incrementalAdd({ schema, client: client as never, caseId: id })
        await client.query('COMMIT')
        await client.end()
        caseIds.push(id)
      }
      const caseMetadata = new PostgresCaseMetadataRepository(pool, schema)
      read = new PostgresReadExecutor({
        variants: new PostgresVariantReadRepository(pool, schema),
        cohort: new PostgresCohortRepository(pool, schema),
        caseMetadata
      } as never)
      const backend: Backend = {
        caseIds,
        read,
        write: new PostgresWriteExecutor(caseMetadata, {} as never, {} as never),
        storedRows: async (caseId) =>
          Number(
            (
              await pool.query(
                `SELECT COUNT(*) AS n FROM "${schema}".case_phenotype_scores WHERE case_id = $1`,
                [caseId]
              )
            ).rows[0].n
          ),
        close: async () => {
          await read?.close()
        }
      }
      expect(rounded(await scenario(backend))).toEqual(rounded(expected))
    } finally {
      await read?.close().catch(() => undefined)
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`)
      await pool.end()
    }
  }, 120_000)
})

describe('phenotype score executor', () => {
  const profile = { caseId: 1, terms: [{ hpoId: 'HP:1', excluded: false, key: false }] }
  /** A read executor whose stale case 1 scores via `score` and whose queries return 'rows'. */
  const fakeRead = (score: () => Promise<unknown>): StorageReadExecutor => ({
    execute: async (task) =>
      task.type === 'phenotype:profiles'
        ? [{ ...profile, profileHash: null, dataKey: null }]
        : task.type === 'hpo:caseScores'
          ? score()
          : 'rows'
  })
  const write: StorageWriteExecutor = { execute: async () => undefined }

  it('a cohort read never waits for rescoring', async () => {
    const read = withPhenotypeScores(
      fakeRead(() => new Promise(() => undefined)),
      write
    )
    const cohortTask = { type: 'cohort:query', params: [{}] } as const
    expect(await read.execute(cohortTask as never)).toBe('rows')
  })

  it('a failed rescore still returns the case rows', async () => {
    const failing: StorageWriteExecutor = {
      execute: async () => {
        throw new Error('disk full')
      }
    }
    const read = withPhenotypeScores(
      fakeRead(async () => []),
      failing
    )
    const task = { type: 'variants:query', params: [{ case_id: 1 }, 50, 0] } as const
    expect(await read.execute(task as never)).toBe('rows')
  })

  it('skips scoring when no HPO database is installed and the case was never scored', async () => {
    let scoreCalls = 0
    let writeCalls = 0
    const read = withPhenotypeScores(
      fakeRead(async () => {
        scoreCalls++
        return []
      }),
      {
        execute: async () => {
          writeCalls++
          return undefined
        }
      },
      () => null
    )
    const task = { type: 'variants:query', params: [{ case_id: 1 }, 50, 0] } as const
    expect(await read.execute(task as never)).toBe('rows')
    expect(scoreCalls).toBe(0)
    expect(writeCalls).toBe(0)
  })
})
