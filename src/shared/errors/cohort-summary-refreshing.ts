/**
 * A cohort export was asked for while the cohort summary is being refreshed
 * (#469). The export reads the summary; a stale summary would put outdated
 * values into a file that carries no "refreshing" hint, so the export waits a
 * bounded time for the refresh and otherwise fails with this error.
 *
 * Carries its own envelope `code` / `userMessage` so the IPC and web error
 * mappers report it to the user verbatim instead of as an unexpected failure.
 */
import { ErrorCode } from '../types/errors'

export const COHORT_SUMMARY_REFRESHING_MESSAGE =
  'The cohort summary is being refreshed, so an export now would contain outdated values. ' +
  'Try the export again when the refresh has finished.'

/** How long a cohort export waits for a pending refresh before giving up. */
export const COHORT_EXPORT_REFRESH_WAIT_MS = 60_000

export class CohortSummaryRefreshingError extends Error {
  readonly code = ErrorCode.CONFLICT
  readonly userMessage = COHORT_SUMMARY_REFRESHING_MESSAGE

  constructor() {
    super('Cohort summary is being refreshed; the export was not written')
    this.name = 'CohortSummaryRefreshingError'
  }
}

/**
 * Wait until `isStale()` is false, polling, for at most `waitMs`; throws
 * {@link CohortSummaryRefreshingError} when it is still stale then.
 */
export async function waitForCurrentCohortSummary(
  isStale: () => boolean | Promise<boolean>,
  waitMs: number = COHORT_EXPORT_REFRESH_WAIT_MS,
  pollMs = 250
): Promise<void> {
  const deadline = Date.now() + waitMs
  while (await isStale()) {
    const left = deadline - Date.now()
    if (left <= 0) throw new CohortSummaryRefreshingError()
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, left)))
  }
}
