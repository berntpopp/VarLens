/**
 * Pure view of how the web dispatcher resolves `window.api.<domain>.<method>`,
 * checked against the parity manifest (spec §4.2 / §6). Shared by the startup
 * assertion in server.ts and tests/shared/ipc/parity-manifest.test.ts, so the
 * gate needs no network or Postgres.
 */
import { getChannelPolicy, listManifestEntries } from '../../shared/ipc/parity-manifest'
import {
  DOMAIN_CAMEL_TO_KEBAB,
  READ_TASK_TYPES,
  WRITE_TASK_TYPES,
  toTaskDomain
} from './task-types'
import type { OverrideHandler } from './routes/types'

export type WebMethodResolution = 'override' | 'read-task' | 'write-task'

/**
 * Dispatcher keys served on purpose without a `window.api` method. Every other
 * served key must map to a manifest entry, which is how alias autoroutes
 * (spec P-18) were found.
 */
export const SERVER_ONLY_DISPATCHER_KEYS: Readonly<Record<string, string>> = {
  'database:health': 'operator health probe for the hosted workspace'
}

const KEBAB_TO_CAMEL: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(DOMAIN_CAMEL_TO_KEBAB).map(([camel, kebab]) => [kebab, camel])
)

export function dispatcherKey(windowDomain: string, method: string): string {
  return `${toTaskDomain(windowDomain)}:${method}`
}

export function resolveWebMethod(
  overrides: Readonly<Record<string, OverrideHandler>>,
  windowDomain: string,
  method: string
): WebMethodResolution | null {
  const key = dispatcherKey(windowDomain, method)
  if (Object.prototype.hasOwnProperty.call(overrides, key)) return 'override'
  if ((READ_TASK_TYPES as readonly string[]).includes(key)) return 'read-task'
  if ((WRITE_TASK_TYPES as readonly string[]).includes(key)) return 'write-task'
  return null
}

/** Every key the dispatcher answers, mapped back to `<windowDomain>.<method>`. */
export function listServedMethods(
  overrides: Readonly<Record<string, OverrideHandler>>
): { key: string; windowDomain: string; method: string }[] {
  const keys = new Set<string>([...Object.keys(overrides), ...READ_TASK_TYPES, ...WRITE_TASK_TYPES])
  return [...keys].map((key) => {
    const [kebab, method] = key.split(':') as [string, string]
    return { key, windowDomain: KEBAB_TO_CAMEL[kebab] ?? kebab, method }
  })
}

export interface ParityStartupReport {
  /** shared methods the dispatcher cannot resolve (would 404). */
  readonly unresolvedShared: string[]
  /** desktop-only methods the dispatcher still answers. */
  readonly servedDesktopOnly: string[]
  /** served keys without a manifest entry or SERVER_ONLY_DISPATCHER_KEYS reason. */
  readonly unclassifiedServed: string[]
}

export function checkManifestAgainstDispatcher(
  overrides: Readonly<Record<string, OverrideHandler>>
): ParityStartupReport {
  const unresolvedShared: string[] = []
  const servedDesktopOnly: string[] = []
  for (const { domain, method, policy } of listManifestEntries()) {
    const resolved = resolveWebMethod(overrides, domain, method)
    if (policy.policy.web === 'shared' && resolved === null) {
      unresolvedShared.push(`${domain}.${method}`)
    }
    if (policy.policy.web === 'desktop-only' && resolved !== null) {
      servedDesktopOnly.push(`${domain}.${method}`)
    }
  }

  const unclassifiedServed = listServedMethods(overrides)
    .filter(({ key }) => SERVER_ONLY_DISPATCHER_KEYS[key] === undefined)
    .filter(({ windowDomain, method }) => getChannelPolicy(windowDomain, method) === undefined)
    .map(({ key }) => key)

  return { unresolvedShared, servedDesktopOnly, unclassifiedServed }
}

export function parityReportProblems(report: ParityStartupReport): string[] {
  return [
    ...report.unresolvedShared.map((m) => `shared method not served: ${m}`),
    ...report.servedDesktopOnly.map((m) => `desktop-only method served over HTTP: ${m}`),
    ...report.unclassifiedServed.map((k) => `dispatcher key without a manifest entry: ${k}`)
  ]
}

/**
 * Startup assertion (spec §4.2, Limin L4): production refuses to start when
 * the dispatcher and the parity manifest disagree; development only warns.
 */
export function assertParityAtStartup(
  overrides: Readonly<Record<string, OverrideHandler>>,
  options: { production: boolean; warn: (message: string) => void }
): void {
  const problems = parityReportProblems(checkManifestAgainstDispatcher(overrides))
  if (problems.length === 0) return
  const message = `web parity manifest mismatch:\n  ${problems.join('\n  ')}`
  if (options.production) throw new Error(message)
  options.warn(message)
}
