import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import { caseInfoFields } from '../../../shared/utils/case-info-fields'
import { queryApi } from './gate'
import { queryKeys } from './keys'

/** The `info.<KEY>` fields of one case with their sources (its import field dictionary). */
export const caseInfoFieldsQuery = defineQueryOptions((caseId: number) => ({
  key: queryKeys.caseInfoFields(caseId),
  query: async () =>
    caseInfoFields(
      unwrapIpcResult(await queryApi().caseMetadata.getDataInfo(caseId))?.field_dictionary
    ),
  enabled: caseId > 0
}))
