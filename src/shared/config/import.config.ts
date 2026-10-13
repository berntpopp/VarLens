/** Valid range of an allele frequency; imports warn about (but keep) values outside it. */
export const ALLELE_FREQUENCY_RANGE = { min: 0, max: 1 } as const

/** User-facing import messages, shared by the desktop and web import paths. */
export const IMPORT_MESSAGES = {
  /** A columnar row whose width differs from the header would shift every later value. */
  rowWidthMismatch: (row: number, values: number, columns: number): string =>
    `Row ${row} has ${values} values but the header declares ${columns} columns`,
  /** gnomAD AF values outside [0, 1]: likely a percentage or a wrong column. */
  afOutOfRange: (count: number): string =>
    `${count.toLocaleString('en-US')} variant${count === 1 ? ' has' : 's have'} a gnomAD AF ` +
    `outside ${ALLELE_FREQUENCY_RANGE.min}–${ALLELE_FREQUENCY_RANGE.max} (a percentage or the ` +
    `wrong column?), stored as imported: allele-frequency filters may hide ` +
    `${count === 1 ? 'it' : 'them'}.`,
  /** VEP ran with --minimal and without --allele_number: some alleles share a CSQ spelling. */
  csqAmbiguousSites: (count: number): string =>
    `${count.toLocaleString('en-US')} multi-allelic site${count === 1 ? '' : 's'} could not ` +
    `match VEP annotations to an allele (VEP --minimal without ALLELE_NUM): gene, consequence ` +
    `and HGVS were left empty there. Re-run VEP with --allele_number.`
} as const
