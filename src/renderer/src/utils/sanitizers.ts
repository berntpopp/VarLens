/**
 * Sanitizer utilities for redacting sensitive genetic and medical data from logs
 */

/**
 * Regex pattern for HGVS notation
 * Matches: c.123A>G, p.Arg459*, g.12345C>T, n.123+5G>A, m.1555A>G
 */
const HGVS_PATTERN = /\b[cgpmn]\.\d+[+-]?\d*([A-Z][a-z]{2})?\d*[*>_]?\S*/gi

/**
 * Regex pattern for genomic coordinates
 * Matches: chr1:12345, chr1:12345-67890, X:12345, 1:12345-67890
 */
const GENOMIC_COORD_PATTERN = /\b(chr)?([0-9]{1,2}|X|Y|M|MT):(\d+)(-\d+)?\b/gi

/**
 * Regex pattern for patient/sample identifiers
 * Matches: PATIENT-12345, SAMPLE_ABC123, SUBJECT:XYZ789, ID-ABC123
 */
const PATIENT_ID_PATTERN = /\b(PATIENT|SAMPLE|SUBJECT|ID)[_:-]?[A-Z0-9]{3,}\b/gi

/**
 * Sanitizes log messages by redacting sensitive genetic and medical data
 *
 * @param message - The log message to sanitize
 * @returns The sanitized message with sensitive data replaced by redaction markers
 */
export function sanitizeLogMessage(message: string): string {
  let sanitized = message

  // Quick pre-check for HGVS notation (contains '.' followed by digit)
  if (/[cgpmn]\.\d/i.test(sanitized) === true) {
    sanitized = sanitized.replace(HGVS_PATTERN, '[REDACTED:HGVS]')
  }

  // Quick pre-check for genomic coordinates (contains ':' with digits)
  if (/:\d/.test(sanitized) === true) {
    sanitized = sanitized.replace(GENOMIC_COORD_PATTERN, '[REDACTED:COORD]')
  }

  // Quick pre-check for patient IDs (contains known prefixes)
  if (/\b(PATIENT|SAMPLE|SUBJECT|ID)[_:-]/i.test(sanitized) === true) {
    sanitized = sanitized.replace(PATIENT_ID_PATTERN, '[REDACTED:ID]')
  }

  return sanitized
}
