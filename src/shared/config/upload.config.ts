/** Web upload copy and limits (src/web/client/uploads.ts). */
export const UPLOAD_CONFIG = {
  /** Reason for a picked file whose name matches none of the accepted import types. */
  NOT_ACCEPTED_REASON: 'not an importable file type',
  /** How many skipped files the summary names before "and N more". */
  SKIPPED_NAMES_SHOWN: 3
} as const

/** One line for every file left out of a selection: count, the first few reasons, the rest. */
export function skippedUploadsSummary(reasons: readonly string[]): string {
  const shown = reasons.slice(0, UPLOAD_CONFIG.SKIPPED_NAMES_SHOWN)
  const more = reasons.length - shown.length
  const files = reasons.length === 1 ? 'file' : 'files'
  return `${reasons.length} ${files} skipped: ${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}`
}
