/**
 * Parity manifest slices for reference-data domains: external lookups
 * (VEP, HPO, MyVariant, SpliceAI, protein, gnomAD), gene reference and panels.
 * External lookups stay `pending` until the admin-configurable egress policy
 * lands (P-C). See ../parity-manifest.ts for how to flip an entry.
 */
import {
  adapter,
  desktopOnly,
  pending,
  sharedRead,
  sharedWrite,
  type DomainManifest
} from '../parity-manifest-types'

const ENRICHMENT = 'P-C (PR-W7c reference services + egress policy)'
const ENRICHMENT_UX = 'Details panel section shows the capability reason instead of fetching.'
const HPO = 'P-C (PR-W7a bundled-ontology HPO search)'
const PROTEIN = 'P-C (PR-W7d protein and gnomAD viewer)'
const PROTEIN_UX = 'Protein view replaced by the capability reason in the details panel.'
const PANELS_UX = 'Dialog action disabled with the capability reason.'

export const vepManifest = {
  fetch: pending('vepEnrichment', ENRICHMENT, ENRICHMENT_UX),
  cancel: pending('vepEnrichment', ENRICHMENT, ENRICHMENT_UX),
  clearCache: pending('vepEnrichment', ENRICHMENT, 'Admin cache management.'),
  getCacheStats: pending('vepEnrichment', ENRICHMENT, 'Admin cache management.')
} satisfies DomainManifest<'vep'>

export const hpoManifest = {
  search: pending('hpoSearch', HPO, 'Term search field disabled with the capability reason.'),
  clearCache: pending('hpoSearch', HPO, 'No web caller.')
} satisfies DomainManifest<'hpo'>

export const myvariantManifest = {
  fetch: pending('myvariantEnrichment', ENRICHMENT, ENRICHMENT_UX),
  clearCache: pending('myvariantEnrichment', ENRICHMENT, 'Admin cache management.')
} satisfies DomainManifest<'myvariant'>

export const spliceaiManifest = {
  fetch: pending('spliceaiEnrichment', ENRICHMENT, ENRICHMENT_UX),
  clearCache: pending('spliceaiEnrichment', ENRICHMENT, 'Admin cache management.')
} satisfies DomainManifest<'spliceai'>

export const proteinManifest = {
  getMapping: pending('proteinViewer', PROTEIN, PROTEIN_UX),
  getDomains: pending('proteinViewer', PROTEIN, PROTEIN_UX),
  getStructure: pending('proteinViewer', PROTEIN, PROTEIN_UX),
  getGeneStructure: pending('proteinViewer', PROTEIN, PROTEIN_UX)
} satisfies DomainManifest<'protein'>

export const gnomadManifest = {
  getVariants: pending('proteinViewer', PROTEIN, PROTEIN_UX),
  getClinVarVariants: pending('proteinViewer', PROTEIN, PROTEIN_UX)
} satisfies DomainManifest<'gnomad'>

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
  searchPanelApp: pending('panelAppImport', ENRICHMENT, PANELS_UX),
  importPanelApp: pending('panelAppImport', ENRICHMENT, PANELS_UX),
  generateStringDb: pending('stringDbPanels', ENRICHMENT, PANELS_UX),
  exportBed: adapter('download', { authz: 'analyst', capability: 'panelBedExport' })
} satisfies DomainManifest<'panels'>
