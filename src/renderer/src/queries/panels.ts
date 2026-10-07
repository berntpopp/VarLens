import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import type { PanelResolutionRequest } from '../../../shared/types/panels'
import { canQuery, queryApi } from './gate'
import { queryKeys } from './keys'

/**
 * Which genes of the active panels have no coordinates for the genome build.
 * `null` (no panel active) reads nothing.
 */
export const panelResolutionQuery = defineQueryOptions(
  (request: PanelResolutionRequest | null) => ({
    key: queryKeys.panelResolution(JSON.stringify(request)),
    query: async () =>
      unwrapIpcResult(await queryApi().panels.resolutionStatus(request ?? { panelIds: [] })),
    enabled: request !== null && canQuery('workflow.panels')
  })
)
