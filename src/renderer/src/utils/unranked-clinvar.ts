/**
 * How the renderer reports ClinVar values an import could not rank (#469):
 * one sentence for the import summary and for the in-app log. The values are
 * shown the way table cells show them.
 */
import { clinvarDisplayText } from '../../../shared/config/severity.config'
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
 * Put the unrecognised ClinVar values of finished imports into the in-app
 * log: the server-side log line never reaches the user.
 */
export function logUnrankedClinvar(
  details: ReadonlyArray<{ caseName?: string; unrankedClinvar?: string[] }>
): void {
  for (const detail of details) {
    if (detail.unrankedClinvar === undefined || detail.unrankedClinvar.length === 0) continue
    logService.warn(
      `Import "${detail.caseName ?? 'case'}": ${unrankedClinvarSummary(detail.unrankedClinvar)}`,
      'import'
    )
  }
}
