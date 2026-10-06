import { computeCapabilityDocument } from '../../../shared/ipc/capability-document'
import { referenceServiceInstanceFeatures } from '../../../shared/ipc/domains/reference-services'
import { isLocalIgvAllowed } from '../instance-settings'
import type { OverrideHandler } from './types'

/**
 * `system:getCapabilities` — the per-session capability document (spec §4.3).
 * Role-aware: built from the parity manifest, the Postgres session's storage
 * capabilities and the signed-in user's role, so a feature the role may not
 * use is reported disabled with a reason before the renderer offers it.
 * External lookups are instance features driven by the admin egress policy
 * (reference-services); without the facade they stay off (fail closed).
 */
export function buildSystemOverrides(): Record<string, OverrideHandler> {
  return {
    'system:getCapabilities': {
      async handle(_args, request, _reply, { session, referenceServices }) {
        const lookups =
          referenceServices === undefined
            ? {}
            : referenceServiceInstanceFeatures(await referenceServices.enabledServices())
        return computeCapabilityDocument({
          runtime: 'web',
          role: request.session?.user?.role ?? 'user',
          storage: session.capabilities,
          instanceFeatures: { ...lookups, igvLocalBroadcast: isLocalIgvAllowed() }
        })
      }
    }
  }
}
