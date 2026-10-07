import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import { canQuery, queryApi } from './gate'
import { queryKeys } from './keys'

/** Every filter preset of the open database. */
export const filterPresetsQuery = defineQueryOptions(() => ({
  key: queryKeys.filterPresets(),
  query: async () => unwrapIpcResult(await queryApi().presets.list()),
  enabled: canQuery('workflow.filterPresets')
}))
