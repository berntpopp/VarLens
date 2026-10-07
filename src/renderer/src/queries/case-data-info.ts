import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import { ALWAYS_STALE } from './client'
import { queryApi } from './gate'
import { queryKeys } from './keys'

/**
 * Everything the data-info tab of one case shows: the case's own record and
 * external ids, and the database-wide lists its inputs offer. Loaded together,
 * all or nothing, so the form is never filled from half a result.
 *
 * The tab fills an edit form from the first result, so an entry is dropped as
 * soon as nothing shows it (`gcTime: 0`): reopening a case always starts from
 * what the database holds, never from a copy older than the user's last save.
 */
export const caseDataInfoQuery = defineQueryOptions((caseId: number) => ({
  key: queryKeys.caseDataInfo(caseId),
  query: async () => {
    const api = queryApi()
    const [dataInfo, externalIds, platforms, idTypes, geneLists, regionFiles] = await Promise.all([
      api.caseMetadata.getDataInfo(caseId),
      api.caseMetadata.listExternalIds(caseId),
      api.caseMetadata.distinctPlatforms(),
      api.caseMetadata.distinctExternalIdTypes(),
      api.geneLists.list(),
      api.regionFiles.list()
    ])
    return {
      dataInfo: unwrapIpcResult(dataInfo),
      externalIds: unwrapIpcResult(externalIds) ?? [],
      platforms: unwrapIpcResult(platforms) ?? [],
      idTypes: unwrapIpcResult(idTypes) ?? [],
      geneLists: unwrapIpcResult(geneLists) ?? [],
      regionFiles: unwrapIpcResult(regionFiles) ?? []
    }
  },
  enabled: caseId > 0,
  staleTime: ALWAYS_STALE,
  gcTime: 0
}))
