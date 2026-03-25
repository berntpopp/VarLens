/**
 * DbTask — message type dispatched to Piscina db-worker threads.
 *
 * Each task maps to a read-only repository method. Writes stay on the main thread.
 */

export interface DbTask {
  /** IPC-style channel name, e.g. 'variants:query' */
  type: string
  /** Arguments forwarded to the repository method (order-dependent) */
  params: unknown[]
}
