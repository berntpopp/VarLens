/**
 * Which file names the batch import offers as variant files. One list for the
 * desktop file picker and the folder scan, so the two can never disagree.
 *
 * The list is by final extension only. The import pipeline does not trust the
 * name: gzip is recognised by magic bytes (`isGzipped`) and VCF vs JSON by
 * content (`detectFormat`), so any `.gz` is accepted on purpose and covers
 * `.vcf.gz` and `.json.gz`. Index files (`.tbi`, `.csi`) end in none of these
 * and are therefore never picked up.
 */
export const IMPORTABLE_VARIANT_EXTENSIONS = ['vcf', 'json', 'gz'] as const

/** True when `fileName` (a base name, any letter case) is offered for import. */
export function isImportableVariantFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return IMPORTABLE_VARIANT_EXTENSIONS.some((extension) => {
    const suffix = `.${extension}`
    return lower.length > suffix.length && lower.endsWith(suffix)
  })
}
