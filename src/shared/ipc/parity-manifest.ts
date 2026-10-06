/**
 * Desktop ↔ web parity manifest: the single declaration of how the web
 * runtime serves every `window.api.<domain>.<method>`.
 *
 *   shared        same handler, served by the web dispatcher
 *   adapter       implemented by the typed web client (upload / download / sse / client)
 *   desktop-only  never reachable over HTTP; the renderer gates the call on `capability`
 *   pending       a web gap with an owner; counted against scripts/parity-baseline.json
 *
 * Gates (all in default `make typecheck` / `make test` / `make agent-check`):
 *   - `satisfies ParityManifestShape`: a preload method without a policy, or a
 *     stale entry, fails the typecheck.
 *   - tests/shared/ipc/parity-manifest.test.ts: desktop preload forwards every
 *     method; every shared method resolves on the web dispatcher and never
 *     answers 404/501; no desktop-only method resolves; the pending count
 *     matches the baseline.
 *   - tests/shared/ipc/web-client-coverage.test.ts: the typed web client
 *     covers every method and refuses desktop-only / pending / disallowed calls
 *     before they reach the network.
 *   - scripts/parity/check-renderer-gates.mjs: every renderer call of a
 *     desktop-only or pending method sits in a file that reads its capability.
 *
 * Flipping an entry (e.g. pending → shared): serve the method in the web
 * dispatcher, change the entry here, lower `pending` in
 * scripts/parity-baseline.json to the new count, and run `make test`.
 * AGENTS.md "Desktop ↔ web parity manifest" has the short version.
 */
import type { WindowAPI } from '../types/api'
import type { ChannelPolicy, ManifestEntry, ParityManifestShape } from './parity-manifest-types'
import {
  annotationsManifest,
  batchImportManifest,
  casesManifest,
  cohortManifest,
  databaseManifest,
  debugManifest,
  exportManifest,
  importManifest,
  jobsManifest,
  logsManifest,
  perfManifest,
  shellManifest,
  systemManifest,
  updaterManifest,
  variantsManifest
} from './parity-manifest/core'
import {
  geneRefManifest,
  gnomadManifest,
  hpoManifest,
  myvariantManifest,
  panelsManifest,
  proteinManifest,
  spliceaiManifest,
  vepManifest
} from './parity-manifest/reference'
import {
  analysisGroupsManifest,
  auditManifest,
  authManifest,
  caseCommentsManifest,
  caseMetadataManifest,
  caseMetricsManifest,
  geneListsManifest,
  presetsManifest,
  regionFilesManifest,
  tagsManifest,
  transcriptsManifest
} from './parity-manifest/workflow'

export const PARITY_MANIFEST = {
  cases: casesManifest,
  variants: variantsManifest,
  import: importManifest,
  system: systemManifest,
  export: exportManifest,
  shell: shellManifest,
  database: databaseManifest,
  batchImport: batchImportManifest,
  cohort: cohortManifest,
  annotations: annotationsManifest,
  vep: vepManifest,
  hpo: hpoManifest,
  myvariant: myvariantManifest,
  spliceai: spliceaiManifest,
  caseMetadata: caseMetadataManifest,
  caseComments: caseCommentsManifest,
  caseMetrics: caseMetricsManifest,
  transcripts: transcriptsManifest,
  tags: tagsManifest,
  logs: logsManifest,
  geneLists: geneListsManifest,
  regionFiles: regionFilesManifest,
  updater: updaterManifest,
  audit: auditManifest,
  auth: authManifest,
  presets: presetsManifest,
  panels: panelsManifest,
  geneRef: geneRefManifest,
  analysisGroups: analysisGroupsManifest,
  protein: proteinManifest,
  gnomad: gnomadManifest,
  perf: perfManifest,
  debug: debugManifest,
  jobs: jobsManifest
} as const satisfies ParityManifestShape

/** Flat list of every manifest entry, in declaration order. */
export function listManifestEntries(): ManifestEntry[] {
  const entries: ManifestEntry[] = []
  for (const [domain, methods] of Object.entries(PARITY_MANIFEST)) {
    for (const [method, policy] of Object.entries(methods as Record<string, ChannelPolicy>)) {
      entries.push({ domain: domain as keyof WindowAPI, method, policy })
    }
  }
  return entries
}

/** Policy for one method, or undefined when the manifest has no such entry. */
export function getChannelPolicy(domain: string, method: string): ChannelPolicy | undefined {
  const slice = (PARITY_MANIFEST as Record<string, Record<string, ChannelPolicy> | undefined>)[
    domain
  ]
  if (slice === undefined || !Object.prototype.hasOwnProperty.call(slice, method)) return undefined
  return slice[method]
}

/** Number of `pending` entries; ratcheted by scripts/parity-baseline.json. */
export function countPendingEntries(): number {
  return listManifestEntries().filter((entry) => entry.policy.policy.web === 'pending').length
}
