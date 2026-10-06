import type { ReferenceServicesApi } from '../../../shared/ipc/domains/reference-services'
import {
  buildReferenceServicesStatus,
  uniformReferenceServicePolicy
} from '../../../shared/ipc/domains/reference-services'

/** Mock-mode reference services: desktop semantics, every lookup available. */
export const mockReferenceServicesApi: ReferenceServicesApi = {
  status: async () => buildReferenceServicesStatus('desktop', uniformReferenceServicePolicy(true)),
  setPolicy: async () =>
    buildReferenceServicesStatus('desktop', uniformReferenceServicePolicy(true))
}
