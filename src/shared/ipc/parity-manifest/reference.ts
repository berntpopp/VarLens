/**
 * Parity manifest slices for reference-data domains: external lookups
 * (VEP, HPO, MyVariant, SpliceAI, protein, gnomAD), gene reference and panels.
 *
 * External lookups are served by the web server's ReferenceServices facade
 * behind the admin egress policy (src/web/server/reference-services/). Each
 * service is an instance feature that is OFF until an administrator enables
 * it, so the capability document (not the manifest) disables the feature and
 * carries the reason. HPO search uses the bundled ontology (no egress).
 * See ../parity-manifest.ts for how to flip an entry.
 */
import {
  adapter,
  desktopOnly,
  sharedExempt,
  sharedRead,
  sharedWrite,
  type DomainManifest
} from '../parity-manifest-types'

/** The web response cache is shared server-wide: per-user clear/stats are no-ops. */
const SHARED_CACHE = {
  tracking: 'P-C (PR-W7c reference services)',
  note: 'shared server-side cache: clearCache/getCacheStats are per-user no-ops'
}

export const vepManifest = {
  fetch: sharedRead({ capability: 'vepEnrichment' }),
  cancel: sharedRead({ capability: 'vepEnrichment' }),
  clearCache: sharedRead({ capability: 'vepEnrichment', degraded: SHARED_CACHE }),
  getCacheStats: sharedRead({ capability: 'vepEnrichment', degraded: SHARED_CACHE })
} satisfies DomainManifest<'vep'>

export const hpoManifest = {
  search: sharedRead({ capability: 'hpoSearch' }),
  clearCache: sharedRead({ capability: 'hpoSearch' })
} satisfies DomainManifest<'hpo'>

export const myvariantManifest = {
  fetch: sharedRead({ capability: 'myvariantEnrichment' }),
  clearCache: sharedRead({ capability: 'myvariantEnrichment', degraded: SHARED_CACHE })
} satisfies DomainManifest<'myvariant'>

export const spliceaiManifest = {
  fetch: sharedRead({ capability: 'spliceaiEnrichment' }),
  clearCache: sharedRead({ capability: 'spliceaiEnrichment', degraded: SHARED_CACHE })
} satisfies DomainManifest<'spliceai'>

export const proteinManifest = {
  getMapping: sharedRead({ capability: 'proteinViewer' }),
  getDomains: sharedRead({ capability: 'proteinViewer' }),
  getStructure: sharedRead({ capability: 'proteinViewer' }),
  getGeneStructure: sharedRead({ capability: 'proteinViewer' })
} satisfies DomainManifest<'protein'>

export const gnomadManifest = {
  getVariants: sharedRead({ capability: 'gnomadVariants' }),
  getClinVarVariants: sharedRead({ capability: 'gnomadVariants' })
} satisfies DomainManifest<'gnomad'>

export const referenceServicesManifest = {
  status: sharedExempt('capability read: which external lookups the server allows'),
  setPolicy: sharedExempt('writes its own api_write audit row carrying the policy change', {
    authz: 'admin'
  })
} satisfies DomainManifest<'referenceServices'>

const GENE_REF_UX = 'Hidden: the gene reference ships with the server image.'

export const geneRefManifest = {
  info: sharedRead(),
  assemblies: sharedRead(),
  checkUpdates: desktopOnly('geneRefUpdate', GENE_REF_UX),
  update: desktopOnly('geneRefUpdate', GENE_REF_UX)
} satisfies DomainManifest<'geneRef'>

export const panelsManifest = {
  list: sharedRead(),
  get: sharedRead(),
  create: sharedWrite(),
  update: sharedWrite(),
  delete: sharedWrite(),
  duplicate: sharedWrite(),
  setGenes: sharedWrite(),
  getGenes: sharedRead(),
  activate: sharedWrite(),
  deactivate: sharedWrite(),
  activeForCase: sharedRead(),
  validateSymbols: sharedRead(),
  autocomplete: sharedRead(),
  searchPanelApp: sharedRead({ capability: 'panelAppImport' }),
  importPanelApp: sharedWrite({ capability: 'panelAppImport' }),
  generateStringDb: sharedWrite({ capability: 'stringDbPanels' }),
  // Browser download from GET /api/panels/export-bed (the RPC returns that URL).
  exportBed: adapter('download', { capability: 'panelBedExport' })
} satisfies DomainManifest<'panels'>
