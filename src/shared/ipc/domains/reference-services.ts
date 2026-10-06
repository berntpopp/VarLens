import type { IpcResult } from '../../types/errors'
import { CAPABILITY_FEATURES, type CapabilityFeature } from '../capability-features'

/**
 * External reference services: every outbound lookup VarLens can make on a
 * user's behalf. Desktop calls them directly (the user's machine, the user's
 * decision). The web server makes them from a shared clinical server, so each
 * one is an instance setting that an administrator must switch on; all are
 * off by default and every outbound call is audited (user, service,
 * identifier). See src/web/server/reference-services/.
 */
export const REFERENCE_SERVICE_IDS = [
  'vep',
  'myvariant',
  'spliceai',
  'gnomad',
  'protein',
  'panelapp',
  'stringdb'
] as const

export type ReferenceServiceId = (typeof REFERENCE_SERVICE_IDS)[number]

export interface ReferenceServiceInfo {
  id: ReferenceServiceId
  /** Short product name shown in the UI. */
  label: string
  /** What leaves the server when the service is used. */
  sends: string
  /** Upstream hosts the server contacts. */
  hosts: string[]
  enabled: boolean
  /** User-facing reason when disabled, otherwise null. */
  reason: string | null
}

export interface ReferenceServicesStatus {
  runtime: 'desktop' | 'web'
  /** True where an administrator can switch services (web). */
  configurable: boolean
  services: ReferenceServiceInfo[]
  updatedAt: number | null
  updatedBy: string | null
}

export type ReferenceServicePolicyUpdate = Partial<Record<ReferenceServiceId, boolean>>

export interface ReferenceServicesApi {
  /** `reference-services:status` — which external lookups this runtime may make. */
  status: () => Promise<IpcResult<ReferenceServicesStatus>>
  /** `reference-services:setPolicy` — admin-only (web). Desktop has no egress policy. */
  setPolicy: (update: ReferenceServicePolicyUpdate) => Promise<IpcResult<ReferenceServicesStatus>>
}

export const REFERENCE_SERVICES_CHANNELS = {
  status: 'reference-services:status',
  setPolicy: 'reference-services:setPolicy'
} as const

interface ReferenceServiceDescriptor {
  label: string
  sends: string
  hosts: string[]
}

export const REFERENCE_SERVICE_CATALOG: Record<ReferenceServiceId, ReferenceServiceDescriptor> = {
  vep: {
    label: 'Ensembl VEP',
    sends: 'Variant coordinates (chromosome, position, ref, alt)',
    hosts: ['rest.ensembl.org']
  },
  myvariant: {
    label: 'MyVariant.info',
    sends: 'Variant coordinates (HGVS genomic notation)',
    hosts: ['myvariant.info']
  },
  spliceai: {
    label: 'SpliceAI Lookup',
    sends: 'Variant coordinates (chromosome, position, ref, alt)',
    hosts: ['spliceai-38-xwkwwwxdwq-uc.a.run.app', 'spliceai-37-xwkwwwxdwq-uc.a.run.app']
  },
  gnomad: {
    label: 'gnomAD (population variants and ClinVar)',
    sends: 'Gene symbol',
    hosts: ['gnomad.broadinstitute.org']
  },
  protein: {
    label: 'Protein view (UniProt, InterPro, AlphaFold, Ensembl)',
    sends: 'Gene symbol and UniProt accession',
    hosts: ['rest.uniprot.org', 'www.ebi.ac.uk', 'alphafold.ebi.ac.uk', 'rest.ensembl.org']
  },
  panelapp: {
    label: 'PanelApp (UK and Australia)',
    sends: 'Panel search keyword and panel ID',
    hosts: ['panelapp.genomicsengland.co.uk', 'panelapp-aus.org']
  },
  stringdb: {
    label: 'STRING',
    sends: 'Seed gene symbols',
    hosts: ['string-db.org']
  }
}

export function isReferenceServiceId(value: unknown): value is ReferenceServiceId {
  return typeof value === 'string' && (REFERENCE_SERVICE_IDS as readonly string[]).includes(value)
}

/** Capability feature each service backs (instance features in the capability document). */
export const REFERENCE_SERVICE_FEATURE: Record<ReferenceServiceId, CapabilityFeature> = {
  vep: 'vepEnrichment',
  myvariant: 'myvariantEnrichment',
  spliceai: 'spliceaiEnrichment',
  gnomad: 'gnomadVariants',
  protein: 'proteinViewer',
  panelapp: 'panelAppImport',
  stringdb: 'stringDbPanels'
}

/** Reason shown when an administrator has not enabled a service (capability copy). */
export function referenceServiceDisabledReason(id: ReferenceServiceId): string {
  return CAPABILITY_FEATURES[REFERENCE_SERVICE_FEATURE[id]].unavailableInWeb
}

/** Capability-document instance features for a per-service on/off map. */
export function referenceServiceInstanceFeatures(
  enabled: Record<ReferenceServiceId, boolean>
): Partial<Record<CapabilityFeature, boolean>> {
  return Object.fromEntries(
    REFERENCE_SERVICE_IDS.map((id) => [REFERENCE_SERVICE_FEATURE[id], enabled[id]])
  )
}

/** Build the status document from a per-service on/off map. */
export function buildReferenceServicesStatus(
  runtime: 'desktop' | 'web',
  enabled: Record<ReferenceServiceId, boolean>,
  meta: { updatedAt: number | null; updatedBy: string | null } = {
    updatedAt: null,
    updatedBy: null
  }
): ReferenceServicesStatus {
  return {
    runtime,
    configurable: runtime === 'web',
    services: REFERENCE_SERVICE_IDS.map((id) => ({
      id,
      ...REFERENCE_SERVICE_CATALOG[id],
      hosts: [...REFERENCE_SERVICE_CATALOG[id].hosts],
      enabled: enabled[id],
      reason: enabled[id] ? null : referenceServiceDisabledReason(id)
    })),
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy
  }
}

/** Every service on (desktop) or off (the web default). */
export function uniformReferenceServicePolicy(on: boolean): Record<ReferenceServiceId, boolean> {
  return Object.fromEntries(REFERENCE_SERVICE_IDS.map((id) => [id, on])) as Record<
    ReferenceServiceId,
    boolean
  >
}
