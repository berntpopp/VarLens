import { DatabaseError } from '../../database/errors'
import { jobRunner } from './runner'

/**
 * What is currently using the database from outside the session's own
 * connections (main connection, read pool, writer thread).
 *
 * Imports, exports, deletes and association runs are `jobRunner` jobs. The
 * cohort-summary rebuild worker is not (it is also spawned at startup and
 * after imports, outside any job), so it registers here instead.
 *
 * Operations that need the database file to themselves (re-key, migration)
 * or that replace the open session (open, create, switch) refuse to start
 * while this list is non-empty -- see `assertNoActiveDatabaseWork`.
 */
const untrackedWorkers = new Map<string, number>()

/** Register a database worker that runs outside the JobRunner until `work` settles. */
export function trackDatabaseWorker<T>(label: string, work: Promise<T>): Promise<T> {
  untrackedWorkers.set(label, (untrackedWorkers.get(label) ?? 0) + 1)
  const release = (): void => {
    const remaining = (untrackedWorkers.get(label) ?? 1) - 1
    if (remaining > 0) untrackedWorkers.set(label, remaining)
    else untrackedWorkers.delete(label)
  }
  work.then(release, release)
  return work
}

/** Human-readable labels of everything currently working against the database. */
export function listActiveDatabaseWork(): string[] {
  const jobs = jobRunner.list({ status: 'running' }).map((job) => job.kind.replace(/_/g, ' '))
  return [...new Set([...jobs, ...untrackedWorkers.keys()])]
}

/** Throws while anything is working against the database. `action` completes "Cannot ...". */
export function assertNoActiveDatabaseWork(action: string): void {
  const active = listActiveDatabaseWork()
  if (active.length > 0) {
    throw new DatabaseError(
      `Cannot ${action} while work is in progress (${active.join(', ')}). ` +
        'Wait for it to finish and try again.'
    )
  }
}
