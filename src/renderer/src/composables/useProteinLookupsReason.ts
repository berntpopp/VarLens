import { computed, type ComputedRef } from 'vue'
import { useCapabilityStore } from '../stores/capabilityStore'
import { PROTEIN_VIEW_COPY } from '../config/proteinViewConfig'

/**
 * Why the protein lookups are off here (the server's own reason, e.g. "turned
 * off on this server…"), or null when they are on. Config copy is the fallback.
 */
export function useProteinLookupsReason(): ComputedRef<string | null> {
  const capabilities = useCapabilityStore()
  return computed(() =>
    capabilities.canUse('proteinViewer')
      ? null
      : (capabilities.capabilityReason('proteinViewer') ?? PROTEIN_VIEW_COPY.lookupsOff)
  )
}
