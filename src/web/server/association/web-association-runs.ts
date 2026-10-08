/**
 * Per-user cohort association runs on the web server.
 *
 * Desktop allows one association analysis at a time (JobRunner single-flight)
 * and cancels "the" running one. A shared server must scope both to the user:
 * each user has at most one run, `cancel` only stops the caller's own run,
 * and a server-wide cap bounds the CPU spent on statistics. Progress is
 * pushed to the caller's SSE stream as `cohort:geneBurdenProgress`, the same
 * event name the desktop renderer subscribes to.
 */
import type { PostgresAssociationDataBuilder } from '../../../main/storage/postgres/PostgresAssociationDataBuilder'
import type { AssociationConfig, AssociationBuildResult } from '../../../main/statistics/types'
import type { WebEventHub } from '../events'
import { WEB_EVENT_ASSOCIATION_PROGRESS } from '../web-event-types'

export const DEFAULT_MAX_CONCURRENT_ASSOCIATION_RUNS = 2

export class AssociationBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssociationBusyError'
  }
}

export interface AssociationRunContext {
  signal: AbortSignal
  onProgress: (progress: { completed: number; total: number }) => void
  buildData: (config: AssociationConfig) => Promise<AssociationBuildResult>
}

export class WebAssociationRuns {
  private readonly active = new Map<number, AbortController>()
  private readonly maxConcurrent: number

  constructor(
    private readonly options: {
      builder: Pick<PostgresAssociationDataBuilder, 'build'>
      events: Pick<WebEventHub, 'publish'>
      maxConcurrent?: number
    }
  ) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_ASSOCIATION_RUNS
  }

  /** Run `execute` as the user's single association run. */
  async run<T>(userId: number, execute: (ctx: AssociationRunContext) => Promise<T>): Promise<T> {
    if (this.active.has(userId)) {
      throw new AssociationBusyError('An association analysis is already running')
    }
    if (this.active.size >= this.maxConcurrent) {
      throw new AssociationBusyError(
        'The server is already running the maximum number of association analyses. Try again shortly.'
      )
    }
    const controller = new AbortController()
    this.active.set(userId, controller)
    try {
      return await execute({
        signal: controller.signal,
        onProgress: (progress) =>
          this.options.events.publish(userId, WEB_EVENT_ASSOCIATION_PROGRESS, progress),
        buildData: (config) =>
          this.options.builder.build(
            config.groupA_ids,
            config.groupB_ids,
            config.filters,
            config.covariates
          )
      })
    } finally {
      if (this.active.get(userId) === controller) this.active.delete(userId)
    }
  }

  /** Cancel the caller's own run. Returns whether one was running. */
  cancel(userId: number): boolean {
    const controller = this.active.get(userId)
    if (controller === undefined) return false
    controller.abort()
    return true
  }

  /** Stop every run (server shutdown). */
  cancelAll(): void {
    for (const controller of this.active.values()) controller.abort()
  }
}
