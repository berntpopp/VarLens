/** Installed HPO similarity data (`hpo-data:status`, #600). */
export interface HpoDataStatus {
  installed: boolean
  /** HPO release tag, e.g. `v2026-09-01`. */
  version: string | null
  /** Unix seconds. */
  builtAt: number | null
  termCount: number
  geneCount: number
}

export interface HpoDataUpdateResult {
  success: boolean
  message: string
  status: HpoDataStatus
}
