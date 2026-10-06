import { computeCapabilityDocument } from '../../../shared/ipc/capability-document'
import { isLocalIgvAllowed } from '../instance-settings'
import type { OverrideHandler } from './types'

/**
 * `system:getCapabilities` — the per-session capability document (spec §4.3).
 * Role-aware: built from the parity manifest, the Postgres session's storage
 * capabilities and the signed-in user's role, so a feature the role may not
 * use is reported disabled with a reason before the renderer offers it.
 */
export function buildSystemOverrides(): Record<string, OverrideHandler> {
  return {
    'system:getCapabilities': {
      handle(_args, request, _reply, { session }) {
        return computeCapabilityDocument({
          runtime: 'web',
          role: request.session?.user?.role ?? 'user',
          storage: session.capabilities,
          instanceFeatures: { igvLocalBroadcast: isLocalIgvAllowed() }
        })
      }
    }
  }
}
