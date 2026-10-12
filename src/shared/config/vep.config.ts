/**
 * Ensembl VEP VCF output quirks (ensembl-vep OutputFactory.pm and
 * OutputFactory/VCF.pm). HGVSc/HGVSg are otherwise written raw; SnpEff and
 * JSON imports never escape.
 */

/** Percent-escapes VEP writes into CSQ values: '=' in HGVSp (unless --no_escape), ';' in any field */
export const VEP_CSQ_ESCAPES: ReadonlyArray<{ encoded: RegExp; decoded: string }> = [
  { encoded: /%3D/gi, decoded: '=' },
  { encoded: /%3B/gi, decoded: ';' }
]

/** Joins several SO terms of one transcript consequence (`intron_variant&NMD_transcript_variant`) */
export const VEP_CONSEQUENCE_SEPARATOR = '&'
