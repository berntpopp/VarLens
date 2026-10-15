import type { IpcResult } from '../../types/errors'
import type { HpoDataStatus, HpoDataUpdateResult } from '../../types/hpo-data'
import type { HpoExplanation } from '../../types/hpo-profile'

/** HPO similarity data for the `hpo_resnik` ranking field (#600). */
export interface HpoDataApi {
  /** `hpo-data:status` — installed release, or `installed: false`. */
  status: () => Promise<IpcResult<HpoDataStatus>>
  /** `hpo-data:update` — download + preprocess the latest HPO release (desktop). */
  update: () => Promise<IpcResult<HpoDataUpdateResult>>
  /** `hpo-data:explainGene` — why a gene got its phenotype score for the case's terms. */
  explainGene: (caseId: number, gene: string) => Promise<IpcResult<HpoExplanation | null>>
}

export const HPO_DATA_CHANNELS = {
  status: 'hpo-data:status',
  update: 'hpo-data:update',
  explainGene: 'hpo-data:explainGene'
} as const
