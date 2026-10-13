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

/**
 * Every escape VEP writes into a CSQ value (`,` `|` `;` `=` space `%`). Import
 * decodes these in one pass so `%253D` stays a literal `%3D`.
 */
export const VEP_CSQ_VALUE_ESCAPES: Readonly<Record<string, string>> = {
  '%3B': ';',
  '%3D': '=',
  '%2C': ',',
  '%7C': '|',
  '%20': ' ',
  '%25': '%'
}

/** Joins several SO terms of one transcript consequence (`intron_variant&NMD_transcript_variant`) */
export const VEP_CONSEQUENCE_SEPARATOR = '&'
