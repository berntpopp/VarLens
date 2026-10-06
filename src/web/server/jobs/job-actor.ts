/**
 * Request-scoped "who is acting" context for background jobs.
 *
 * Jobs are enqueued deep inside shared logic (`PostgresImportExecutor`,
 * `export-logic`, the case-delete job) that has no notion of a web user.
 * The dispatcher runs every authenticated call inside
 * {@link runAsJobActor}; `JobRunner.enqueue` fires its first lifecycle
 * event synchronously inside that same async context, so
 * {@link WebJobRegistry} can read the owner with {@link currentJobActor}
 * without threading a user id through every logic layer.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface JobActor {
  userId: number
  username: string
  role: string
}

const storage = new AsyncLocalStorage<JobActor>()

export function runAsJobActor<T>(actor: JobActor | undefined, fn: () => T): T {
  return actor === undefined ? fn() : storage.run(actor, fn)
}

export function currentJobActor(): JobActor | undefined {
  return storage.getStore()
}

export function isAdminActor(actor: Pick<JobActor, 'role'> | undefined): boolean {
  return actor?.role === 'admin'
}
