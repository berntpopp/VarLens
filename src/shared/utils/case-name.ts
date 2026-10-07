/**
 * How a batch import names the case of a file. One implementation for every
 * runtime (desktop SQLite worker path, session/Postgres path, web) and for the
 * renderer's live preview, so the duplicate rule can never drift between them.
 */

/** Trailing extensions removed from a file name, outermost first. */
const TRAILING_EXTENSIONS = ['.gz', '.json', '.vcf'] as const

function stripTrailingExtension(name: string, extension: string): string {
  return name.toLowerCase().endsWith(extension) ? name.slice(0, -extension.length) : name
}

function removeStripText(name: string, stripText?: string): string {
  if (stripText === undefined || stripText === '') return name
  return name.split(stripText).join('').trim()
}

/**
 * Case name for a file: the name without `.gz`, `.json` and `.vcf`
 * (case-insensitive) and without the optional user-supplied strip text.
 * `X.vcf.gz`, `X.vcf`, `X.json.gz` and `X.json` all give `X`.
 */
export function deriveCaseName(fileName: string, stripText?: string): string {
  let name = fileName
  for (const extension of TRAILING_EXTENSIONS) name = stripTrailingExtension(name, extension)
  return removeStripText(name, stripText)
}

/**
 * The name versions up to 0.76 gave the same file: `.vcf` was not stripped
 * (and matching was case-sensitive), so `X.vcf.gz` became case `X.vcf`. Only
 * used to recognise those existing cases as duplicates.
 */
export function legacyCaseName(fileName: string, stripText?: string): string {
  let name = fileName
  if (name.endsWith('.gz')) name = name.slice(0, -3)
  if (name.endsWith('.json')) name = name.slice(0, -5)
  return removeStripText(name, stripText)
}

export interface ResolvedCaseName {
  /** The existing case's name when the file is a duplicate, else the derived name. */
  caseName: string
  isDuplicate: boolean
}

/**
 * Decide a file's case name against the existing cases. A case stored under
 * the legacy name is the SAME case as the file: it is reported as the
 * duplicate under its existing name, so "skip" skips it and "overwrite"
 * replaces it in place instead of importing a second copy next to it.
 */
export function resolveCaseName(
  fileName: string,
  stripText: string | undefined,
  exists: (caseName: string) => boolean
): ResolvedCaseName {
  const caseName = deriveCaseName(fileName, stripText)
  if (exists(caseName)) return { caseName, isDuplicate: true }
  const legacy = legacyCaseName(fileName, stripText)
  if (legacy !== caseName && exists(legacy)) return { caseName: legacy, isDuplicate: true }
  return { caseName, isDuplicate: false }
}
