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
 * Regex pattern for SQLcipher `key`/`rekey` pragma forms.
 *
 * Defense-in-depth only (no known active leak) — the "keys are never
 * logged" invariant otherwise rests entirely on call-site discipline.
 *
 * Deliberately requires a QUOTED value AND the `=` operator (`key='...'`,
 * `key="..."`, `PRAGMA key = "..."`, `rekey='...'`). Unlike
 * `password`/`secret`/`token`, the bare word "key" is extremely common in
 * ordinary log prose, and critically so is "key" followed by a COLON —
 * "sort key: 'chromosome'", "cache key: 'lookup'" are everyday log
 * sentences that happen to use a quoted value after the colon. SQLcipher's
 * own pragma syntax is always the `=` form (`PRAGMA key = "..."`,
 * `key='...'`), never `key: '...'`, so requiring `=` loses nothing for the
 * case this pattern actually needs to catch while eliminating the
 * colon-prose false-positive.
 */
const SQLCIPHER_KEY_PATTERN = /\b((?:re)?key)\b\s*=\s*(?:'[^']*'|"[^"]*")/gi

/**
 * Regex pattern for generic secret key-value pairs: `password`,
 * `passphrase`, `secret`, `token`.
 *
 * Quoted values (`password='...'`, `token="..."`) are always redacted — a
 * quote is a strong, low-false-positive signal of a literal value, so it is
 * accepted with either `=` or `:` as the operator.
 *
 * Unquoted values are redacted ONLY after `=` (`password=hunter2`), never
 * after a bare `:`. A bare `keyword:` is structurally identical to ordinary
 * prose ("token: expired, renewing session", "a secret: nobody knows the
 * recipe") — there is no reliable way to distinguish a leaked secret from a
 * sentence using the same word as a common noun (entropy/length heuristics
 * are unreliable too). This redaction is defense-in-depth, not the primary
 * safeguard (call-site discipline is), so the tradeoff deliberately favors
 * under-redacting a rare unquoted-colon secret over corrupting common log
 * prose. The value is captured up to the closing quote (if quoted) or up to
 * the next whitespace/`;`/`,` delimiter (if unquoted via `=`), so only the
 * secret value is redacted — surrounding text is preserved.
 */
const SECRET_VALUE_PATTERN =
  /\b(passphrase|password|secret|token)\b\s*(?:[=:]\s*(?:'([^']*)'|"([^"]*)")|=\s*(\S+?)(?=[;,\s]|$))/gi

/**
 * Regex pattern for JSON-style quoted-key secrets: `"password":"hunter2"`,
 * `"token":"ghp_x"`, `"secret":"..."`, `"passphrase":"..."`.
 *
 * SerializableErrors and structured log objects are frequently
 * JSON-serialized before being written out, so a JSON-quoted key is a
 * first-class leak surface — not merely the prose-ambiguous case the bare
 * `keyword:`/`keyword=` forms above have to hedge against. Requiring BOTH
 * the key and the value to be quoted is what makes this branch safe to be
 * broad: `"password":"..."` cannot be mistaken for ordinary prose the way
 * a bare `password:` can, so there is no false-positive tradeoff here.
 *
 * Deliberately excludes `key`/`rekey`. Unlike password/passphrase/secret/
 * token, "key" is an extremely common JSON property name for non-secret
 * data (sort key, cache key, map key, primary key), so a bare
 * `"key":"..."` in a structured log is far more likely to be an ordinary
 * field than a SQLCipher key leak. The SQLCipher key pattern above already
 * covers the one construct that actually matters for that keyword
 * (`key='...'`/`PRAGMA key = "..."`), and SQLCipher never emits its key
 * pragma as a bare JSON object, so nothing is lost by leaving JSON
 * `"key"` un-redacted here.
 */
const JSON_SECRET_KEY_PATTERN = /"(passphrase|password|secret|token)"\s*[:=]\s*"[^"]*"/gi

/**
 * Sanitizes log messages by redacting sensitive genetic and medical data
 *
 * @param message - The log message to sanitize
 * @returns The sanitized message with sensitive data replaced by redaction markers
 */
export function sanitizeLogMessage(message: string): string {
  let sanitized = message

  // Quick pre-check for a quoted SQLcipher key='...'/rekey="..." pragma
  // form. Checked first so a secret value never survives to be matched by
  // a downstream pattern. Requires "=" — "key:"/"rekey:" is prose-ambiguous
  // (see SQLCIPHER_KEY_PATTERN doc comment) and is intentionally not matched.
  if (/\b((?:re)?key)\b\s*=\s*['"]/i.test(sanitized) === true) {
    sanitized = sanitized.replace(SQLCIPHER_KEY_PATTERN, '$1=[REDACTED:KEY]')
  }

  // Quick pre-check for generic secret keyword + value (quoted or not).
  if (/\b(passphrase|password|secret|token)\b\s*[=:]/i.test(sanitized) === true) {
    sanitized = sanitized.replace(SECRET_VALUE_PATTERN, '$1=[REDACTED:KEY]')
  }

  // Quick pre-check for JSON-style quoted-key secrets (`"password":"..."`).
  if (/"(?:passphrase|password|secret|token)"\s*[:=]\s*"/i.test(sanitized) === true) {
    sanitized = sanitized.replace(JSON_SECRET_KEY_PATTERN, '"$1":"[REDACTED:KEY]"')
  }

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
