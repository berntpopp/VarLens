/**
 * Capability features: the names the renderer gates on.
 *
 * A feature groups the `window.api` methods (parity manifest `capability`
 * field) that one UI affordance needs. The capability document
 * (`capability-document.ts`) marks a feature enabled for a session only when
 * every method behind it is reachable in that runtime and allowed for the
 * session's role. `instance` features are not backed by `window.api` methods;
 * the server derives them from instance configuration.
 *
 * `unavailableInWeb` is the user-facing copy shown when a feature is off in the
 * web version. It started as track 4's `runtime-features.ts` copy.
 */
export const CAPABILITY_FEATURES = {
  proteinViewer: {
    label: 'protein view',
    unavailableInWeb: 'The protein view is not available in the web version yet.'
  },
  hpoSearch: {
    label: 'HPO term search',
    unavailableInWeb:
      'HPO term search is not available in the web version yet. Existing terms are shown; add new ones in the desktop app.'
  },
  vepEnrichment: {
    label: 'Ensembl VEP annotation',
    unavailableInWeb:
      'Fetching annotations from Ensembl VEP is not available in the web version yet.'
  },
  myvariantEnrichment: {
    label: 'MyVariant.info annotation',
    unavailableInWeb: 'MyVariant.info annotations are not available in the web version yet.'
  },
  spliceaiEnrichment: {
    label: 'SpliceAI scores',
    unavailableInWeb: 'SpliceAI scores are not available in the web version yet.'
  },
  panelAppImport: {
    label: 'PanelApp import',
    unavailableInWeb: 'PanelApp import is not available in the web version yet.'
  },
  stringDbPanels: {
    label: 'StringDB panel generation',
    unavailableInWeb: 'StringDB panel generation is not available in the web version yet.'
  },
  panelBedExport: {
    label: 'panel BED export',
    unavailableInWeb: 'BED export is not available in the web version yet.'
  },
  geneRefUpdate: {
    label: 'gene reference updates',
    unavailableInWeb:
      'The gene reference is part of the server installation and cannot be updated here.'
  },
  cohortAssociation: {
    label: 'cohort association tests',
    unavailableInWeb: 'Association tests are not available in the web version yet.'
  },
  cohortSummaryRebuild: {
    label: 'cohort summary rebuild',
    unavailableInWeb: 'The web version computes the cohort summary live; no rebuild is needed.'
  },
  localDatabaseFiles: {
    label: 'local database files',
    unavailableInWeb:
      'The web version uses one server workspace; local database files do not apply.'
  },
  databaseEncryption: {
    label: 'database encryption',
    unavailableInWeb: 'Encryption at rest is configured by the server operator in the web version.'
  },
  postgresProfiles: {
    label: 'PostgreSQL connection profiles',
    unavailableInWeb: 'The server operator configures the database connection in the web version.'
  },
  workerThreads: {
    label: 'worker threads',
    unavailableInWeb: 'Import concurrency is configured by the server operator in the web version.'
  },
  desktopDiagnostics: {
    label: 'desktop diagnostics',
    unavailableInWeb: 'Desktop diagnostics are not available in the web version.'
  },
  mainProcessLogs: {
    label: 'application log stream',
    unavailableInWeb: 'Server logs go to the operator log pipeline in the web version.'
  },
  autoUpdate: {
    label: 'automatic updates',
    unavailableInWeb: 'The server operator updates the web version.'
  },
  revealInFolder: {
    label: 'show in folder',
    unavailableInWeb: 'Exports are browser downloads in the web version.'
  },
  multiFileImport: {
    label: 'multi-file VCF import',
    unavailableInWeb: 'Multi-file VCF import is not available in the web version yet.'
  },
  userAdmin: {
    label: 'user management',
    unavailableInWeb: 'User management requires the administrator role.'
  },
  auditTrail: {
    label: 'audit trail',
    unavailableInWeb: 'The full audit trail requires the administrator role.'
  },
  igvLocalBroadcast: {
    label: 'send to local IGV',
    unavailableInWeb:
      'Sending to a local IGV is disabled on this server. An administrator can enable it (VARLENS_WEB_ALLOW_LOCAL_IGV=1).'
  }
} as const satisfies Record<string, { label: string; unavailableInWeb: string }>

export type CapabilityFeature = keyof typeof CAPABILITY_FEATURES

/** Features computed from instance configuration rather than manifest methods. */
export const INSTANCE_FEATURES = [
  'igvLocalBroadcast'
] as const satisfies readonly CapabilityFeature[]

export function isCapabilityFeature(value: string): value is CapabilityFeature {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_FEATURES, value)
}
