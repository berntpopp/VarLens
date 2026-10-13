/**
 * How the renderer reports ClinVar values an import could not rank (#469):
 * one sentence for the import summary and for the in-app log. The values are
 * shown the way table cells show them.
 */
import { clinvarDisplayText } from '../../../shared/config/severity.config'
import { IMPORT_MESSAGES } from '../../../shared/config/import.config'
import type { ImportDataReport } from '../../../shared/types/import'
import { logService } from '../services/LogService'

/** Values listed before the rest is summarised as "and n more". */
const LISTED = 8

export function unrankedClinvarSummary(values: readonly string[]): string {
  const noun = values.length === 1 ? 'ClinVar value' : 'ClinVar values'
  const listed = values.slice(0, LISTED).map(clinvarDisplayText).join(', ')
  const more = values.length > LISTED ? ` and ${values.length - LISTED} more` : ''
  return (
    `${values.length} ${noun} not recognised, shown as imported but ranked as unknown ` +
    `for sorting and filtering: ${listed}${more}`
  )
}

/**
 * The data warnings of one import, one sentence each: ClinVar values it could
 * not rank and variants whose gnomAD AF lies outside [0, 1]. Both are imported
 * as they are.
 */
export function importDataNotices(report: ImportDataReport): string[] {
  const notices: string[] = []
  if (report.unrankedClinvar !== undefined && report.unrankedClinvar.length > 0) {
    notices.push(unrankedClinvarSummary(report.unrankedClinvar))
  }
  if (report.afOutOfRange !== undefined && report.afOutOfRange > 0) {
    notices.push(IMPORT_MESSAGES.afOutOfRange(report.afOutOfRange))
  }
  if (report.csqAmbiguousSites !== undefined && report.csqAmbiguousSites > 0) {
    notices.push(IMPORT_MESSAGES.csqAmbiguousSites(report.csqAmbiguousSites))
  }
  return notices
}

/**
 * Put the data warnings of finished imports ({@link importDataNotices}) into
 * the in-app log: the server-side log line never reaches the user.
 */
export function logImportDataWarnings(
  details: ReadonlyArray<ImportDataReport & { caseName?: string }>
): void {
  for (const detail of details) {
    for (const notice of importDataNotices(detail)) {
      logService.warn(`Import "${detail.caseName ?? 'case'}": ${notice}`, 'import')
    }
  }
}
