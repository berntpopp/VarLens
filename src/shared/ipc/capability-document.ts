/**
 * Per-session capability document (spec §4.3, Limin L5).
 *
 * One document answers "may this session use feature X here, and if not,
 * why?". Desktop main and the web server both build it with
 * `computeCapabilityDocument()` from the parity manifest, the storage
 * backend's capabilities, the runtime and the session role, so the two
 * runtimes cannot disagree on the rules. The renderer reads it through one
 * store (`capabilityStore`) that fails closed while it is loading.
 */
import type { StorageBackendKind, StorageCapabilities } from '../types/storage-capabilities'
import {
  CAPABILITY_FEATURES,
  INSTANCE_FEATURES,
  type CapabilityFeature
} from './capability-features'
import type { ChannelAuthz, ChannelPolicy } from './parity-manifest-types'
import { listManifestEntries } from './parity-manifest'

export type CapabilityRuntime = 'desktop' | 'web'

export interface FeatureState {
  readonly enabled: boolean
  /** User-facing reason when disabled. */
  readonly reason?: string
}

export interface CapabilityDocument {
  readonly runtime: CapabilityRuntime
  readonly backend: StorageBackendKind | null
  /** Session role (`admin` on desktop: the local user owns the workspace). */
  readonly role: string
  /** Storage backend capabilities, null when no database is open. */
  readonly storage: StorageCapabilities | null
  readonly features: Readonly<Record<CapabilityFeature, FeatureState>>
  /**
   * `<domain>.<method>` keys this session must not call: web desktop-only and
   * pending methods plus methods whose authz the role does not meet. The web
   * client refuses these before sending them.
   */
  readonly blockedMethods: readonly string[]
}

export interface CapabilityInputs {
  readonly runtime: CapabilityRuntime
  readonly role: string
  readonly storage: StorageCapabilities | null
  /** Instance-configured features (web: environment; desktop: always on). */
  readonly instanceFeatures?: Partial<Record<CapabilityFeature, boolean>>
}

const ROLE_REQUIRED_REASON = 'Requires the administrator role.'

export function roleMeetsAuthz(role: string, authz: ChannelAuthz): boolean {
  if (authz === 'admin') return role === 'admin'
  return true
}

/** Why a method is unusable in this session, or null when it may be called. */
export function methodBlockReason(
  policy: ChannelPolicy,
  runtime: CapabilityRuntime,
  role: string
): 'runtime' | 'role' | null {
  if (runtime === 'web') {
    const web = policy.policy.web
    if (web === 'desktop-only' || web === 'pending') return 'runtime'
  }
  return roleMeetsAuthz(role, policy.authz) ? null : 'role'
}

export function computeCapabilityDocument(inputs: CapabilityInputs): CapabilityDocument {
  const blockedMethods: string[] = []
  const blockedFeatures = new Map<CapabilityFeature, 'runtime' | 'role'>()

  for (const entry of listManifestEntries()) {
    const reason = methodBlockReason(entry.policy, inputs.runtime, inputs.role)
    if (reason === null) continue
    blockedMethods.push(`${entry.domain}.${entry.method}`)
    const feature = entry.policy.capability
    // A runtime block wins over a role block: the copy explains the bigger gap.
    if (feature !== undefined && blockedFeatures.get(feature) !== 'runtime') {
      blockedFeatures.set(feature, reason)
    }
  }

  const features = {} as Record<CapabilityFeature, FeatureState>
  for (const feature of Object.keys(CAPABILITY_FEATURES) as CapabilityFeature[]) {
    features[feature] = featureState(feature, blockedFeatures.get(feature), inputs)
  }

  return {
    runtime: inputs.runtime,
    backend: inputs.storage?.backend ?? null,
    role: inputs.role,
    storage: inputs.storage,
    features,
    blockedMethods
  }
}

function featureState(
  feature: CapabilityFeature,
  blocked: 'runtime' | 'role' | undefined,
  inputs: CapabilityInputs
): FeatureState {
  const copy = CAPABILITY_FEATURES[feature].unavailableInWeb
  if ((INSTANCE_FEATURES as readonly CapabilityFeature[]).includes(feature)) {
    const enabled = inputs.runtime === 'desktop' || inputs.instanceFeatures?.[feature] === true
    return enabled ? { enabled } : { enabled, reason: copy }
  }
  if (blocked === 'runtime') return { enabled: false, reason: copy }
  if (blocked === 'role') return { enabled: false, reason: ROLE_REQUIRED_REASON }
  return { enabled: true }
}
