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
  // External lookups (web: admin egress policy, see INSTANCE_FEATURES). The
  // copy is the reason shown while an administrator has not enabled them.
  proteinViewer: {
    label: 'protein view',
    unavailableInWeb:
      'Protein view (UniProt, InterPro, AlphaFold, Ensembl) lookups are turned off on this server. An administrator can enable them under External lookups.'
  },
  gnomadVariants: {
    label: 'gnomAD and ClinVar variant tracks',
    unavailableInWeb:
      'gnomAD (population variants and ClinVar) lookups are turned off on this server. An administrator can enable them under External lookups.'
  },
  hpoSearch: {
    label: 'HPO term search',
    unavailableInWeb: 'HPO term search is not available here.'
  },
  vepEnrichment: {
    label: 'Ensembl VEP annotation',
    unavailableInWeb:
      'Ensembl VEP lookups are turned off on this server. An administrator can enable them under External lookups.'
  },
  myvariantEnrichment: {
    label: 'MyVariant.info annotation',
    unavailableInWeb:
      'MyVariant.info lookups are turned off on this server. An administrator can enable them under External lookups.'
  },
  spliceaiEnrichment: {
    label: 'SpliceAI scores',
    unavailableInWeb:
      'SpliceAI Lookup lookups are turned off on this server. An administrator can enable them under External lookups.'
  },
  panelAppImport: {
    label: 'PanelApp import',
    unavailableInWeb:
      'PanelApp (UK and Australia) lookups are turned off on this server. An administrator can enable them under External lookups.'
  },
  stringDbPanels: {
    label: 'StringDB panel generation',
    unavailableInWeb:
      'STRING lookups are turned off on this server. An administrator can enable them under External lookups.'
  },
  panelBedExport: {
    label: 'panel BED export',
    unavailableInWeb: 'BED export is not available here.'
  },
  geneRefUpdate: {
    label: 'gene reference updates',
    unavailableInWeb:
      'The gene reference is part of the server installation and cannot be updated here.'
  },
  cohortAssociation: {
    label: 'cohort association tests',
    unavailableInWeb: 'Association tests are not available here.'
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
  'igvLocalBroadcast',
  // External lookups: on in desktop; in web an administrator enables each one
  // (reference-services egress policy, persisted on the server).
  'vepEnrichment',
  'myvariantEnrichment',
  'spliceaiEnrichment',
  'gnomadVariants',
  'proteinViewer',
  'panelAppImport',
  'stringDbPanels'
] as const satisfies readonly CapabilityFeature[]

export function isCapabilityFeature(value: string): value is CapabilityFeature {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_FEATURES, value)
}
