/** User-facing copy for case names chosen in the import dialogs. */
export const CASE_NAME_MESSAGES = {
  REQUIRED: 'Case name is required',
  EXISTS: (name: string): string => `A case named '${name}' already exists`,
  REPEATED: 'Each sample needs its own case name'
} as const

/** Variant types a VCF file can be imported as, in menu order. */
export const VARIANT_TYPE_OPTIONS: ReadonlyArray<{ title: string; value: string }> = [
  { title: 'SNV', value: 'snv' },
  { title: 'Indel', value: 'indel' },
  { title: 'SV', value: 'sv' },
  { title: 'CNV', value: 'cnv' },
  { title: 'STR', value: 'str' }
]

/** Estimated variant count above which the VCF review step suggests a BED region filter. */
export const LARGE_VCF_VARIANT_ESTIMATE = 100_000

/** Chip colour of each variant type in the import summary; unknown types are grey. */
export const VARIANT_TYPE_COLORS: Readonly<Record<string, string>> = {
  snv: 'primary',
  indel: 'deep-purple',
  sv: 'orange',
  cnv: 'teal',
  str: 'pink'
}

/** Accessible names of the import controls and progress indicators. */
export const IMPORT_A11Y_COPY = {
  variantType: (fileName: string): string => `Variant type of ${fileName}`,
  overallProgress: 'Import progress',
  fileProgress: (fileName: string): string => `Importing ${fileName}`,
  statusProgress: 'Import status'
} as const
