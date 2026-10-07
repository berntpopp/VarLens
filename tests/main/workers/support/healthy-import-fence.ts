/**
 * Mock-connection support for tests of the PostgreSQL import worker.
 */
import { runImport } from '../../../../src/main/workers/postgres-import-worker'

type FenceQuery = (sql: string | { text: string }, values?: unknown[]) => Promise<unknown>

/**
 * PostgreSQL's side of a healthy import fence, in front of each test's mock
 * connection: the shared lock is granted, the import generation is 1, and the
 * flip of an importing case to ready changes one row. These statements are
 * answered here and not recorded by the mocks, so the statement sequences the
 * tests assert stay those of the import itself. The fence has its own tests
 * in tests/main/storage/postgres-import-fence.test.ts.
 */
export function answerHealthyFence<T extends object>(client: T): T {
  const inner = (client as unknown as { query: FenceQuery }).query.bind(client)
  // Recovery takes the exclusive fence in a transaction of its own
  // (BEGIN, lock_timeout, lock, COMMIT). Its BEGIN is held back until the
  // next statement shows which transaction it opens.
  let heldBegin = false
  let takingExclusiveFence = false
  const query: FenceQuery = async (sql, values) => {
    const text = typeof sql === 'string' ? sql : sql.text
    if (takingExclusiveFence) {
      if (text === 'COMMIT' || text === 'ROLLBACK') takingExclusiveFence = false
      return { rows: [] }
    }
    if (text === 'BEGIN') {
      heldBegin = true
      return { rows: [] }
    }
    if (heldBegin) {
      heldBegin = false
      if (text.includes("set_config('lock_timeout'")) {
        takingExclusiveFence = true
        return { rows: [] }
      }
      await inner('BEGIN')
    }
    if (text.includes('pg_try_advisory_xact_lock_shared')) return { rows: [{ locked: true }] }
    if (text.includes('varlens-import-fence') || text.includes('varlens-import:')) {
      return { rows: [] }
    }
    if (text.includes("'import_generation'") && !text.startsWith('UPDATE')) {
      return { rows: [{ generation: '1', isolation: 'read committed' }] }
    }
    const result = (await inner(sql, values)) as { rowCount?: number }
    const flipsToReady =
      text.startsWith('UPDATE') && text.includes("AND import_status = 'importing'")
    return flipsToReady && result.rowCount === undefined ? { ...result, rowCount: 1 } : result
  }
  // A derived object: the test keeps its own mock (and its call records).
  return Object.assign(Object.create(client) as T, { query })
}

/** `runImport` whose connection has a healthy import fence in front of the test's mock. */
export const runImportBehindHealthyFence: typeof runImport = (deps, start, post) =>
  runImport(
    { ...deps, createClient: (config) => answerHealthyFence(deps.createClient(config)) },
    start,
    post
  )
