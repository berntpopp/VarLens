import type { HpoDataStatus } from '../../../shared/types/hpo-data'
import { readHpoDataStatus } from '../../services/phenotype/hpo-similarity-db'

/** HPO similarity data status; shared by the desktop IPC domain and the web route. */
export function getHpoDataStatus(): HpoDataStatus {
  return readHpoDataStatus()
}
