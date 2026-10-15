import { z } from 'zod'
import type { HpoDataStatus } from '../../../shared/types/hpo-data'
import { readHpoDataStatus } from '../../services/phenotype/hpo-similarity-db'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'

/** HPO similarity data status; shared by the desktop IPC domain and the web route. */
export function getHpoDataStatus(): HpoDataStatus {
  return readHpoDataStatus()
}

/** Arguments of `hpo-data:explainGene` (case id, gene symbol); validated on both transports. */
export const HpoExplainGeneArgsSchema = z.tuple([CaseIdSchema, z.string().min(1).max(64)])
