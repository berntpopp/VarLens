/** Installed HPO similarity data (`hpo-data:status`, #600). */
export interface HpoDataStatus {
  installed: boolean
  /** Built by an older preprocessing or unreadable: an update rebuilds it. */
  needsUpdate: boolean
  /** HPO release tag, e.g. `v2026-09-01`. */
  version: string | null
  /** Unix seconds. */
  builtAt: number | null
  termCount: number
  geneCount: number
  /** Version per reference source, e.g. `{ hpo, clingen, strchive, mondo }`; absent before builder 6. */
  sources?: Record<string, string>
}

export interface HpoDataUpdateResult {
  success: boolean
  message: string
  status: HpoDataStatus
}
