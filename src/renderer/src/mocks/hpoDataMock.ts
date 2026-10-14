import type { HpoDataApi } from '../../../shared/ipc/domains/hpo-data'
import type { HpoDataStatus } from '../../../shared/types/hpo-data'

const NO_HPO_DATA: HpoDataStatus = {
  installed: false,
  version: null,
  builtAt: null,
  termCount: 0,
  geneCount: 0
}

/** Mock-mode HPO data: not installed; updates need the desktop app. */
export const mockHpoDataApi: HpoDataApi = {
  status: async () => NO_HPO_DATA,
  update: async () => ({
    success: false,
    message: 'HPO data updates are not available in mock mode.',
    status: NO_HPO_DATA
  })
}
