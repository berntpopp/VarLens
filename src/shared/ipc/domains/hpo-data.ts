import type { IpcResult } from '../../types/errors'
import type { HpoDataStatus, HpoDataUpdateResult } from '../../types/hpo-data'

/** HPO similarity data for the `hpo_resnik` ranking field (#600). */
export interface HpoDataApi {
  /** `hpo-data:status` — installed release, or `installed: false`. */
  status: () => Promise<IpcResult<HpoDataStatus>>
  /** `hpo-data:update` — download + preprocess the latest HPO release (desktop). */
  update: () => Promise<IpcResult<HpoDataUpdateResult>>
}

export const HPO_DATA_CHANNELS = {
  status: 'hpo-data:status',
  update: 'hpo-data:update'
} as const
