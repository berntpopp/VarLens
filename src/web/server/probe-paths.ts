/**
 * Authoritative set of health and probe paths for the web server:
 *   - `/livez`: Process liveness (answers as long as the event loop runs; no DB check).
 *   - `/readyz`: Process and database readiness (verifies PostgreSQL connectivity).
 *   - `/healthz`: Backward-compatible alias of `/readyz` for existing probes.
 */
export const PROBE_PATHS = ['/livez', '/readyz', '/healthz'] as const

export type ProbePath = (typeof PROBE_PATHS)[number]

export const PROBE_PATH_SET: ReadonlySet<string> = new Set<string>(PROBE_PATHS)

export function isProbePath(path: string | undefined): boolean {
  if (typeof path !== 'string') return false
  return PROBE_PATH_SET.has(path)
}
