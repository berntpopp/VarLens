import type { WindowAPI } from '../../../shared/types/api'

/**
 * Browser-dev mock of `panels.resolutionStatus`. The mock has no gene
 * reference, so every panel gene counts as mapped and no warning is shown.
 */
export const mockPanelResolutionStatus: WindowAPI['panels']['resolutionStatus'] = async (
  request
) => ({
  genomeBuild: request.genomeBuild ?? 'GRCh38',
  totalGenes: 0,
  unmappedCount: 0,
  unmappedGenes: []
})
