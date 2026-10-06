/**
 * Fast XLSX workbook writer matching the VarLens export structure.
 * Creates 'Variants' and 'Export Info' sheets.
 */
import { writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import type { CanonicalVariant, SampleMetadata } from '../types'

export interface XlsxWriterOptions {
  outputPath: string
}

export const XLSX_HEADERS = [
  'LIMS ID',
  'Chromosome',
  'Position',
  'Reference',
  'Alternate',
  'Genotype',
  'Gene',
  'Function',
  'Impact',
  'Transcript',
  'cDNA Change',
  'AA Change',
  'gnomAD AF',
  'CADD Score',
  'Quality',
  'ClinVar',
  'HPO Score',
  'HPO Match',
  'Mode of Inheritance'
]

export function writeXlsx(
  sample: SampleMetadata,
  variants: readonly CanonicalVariant[],
  options: XlsxWriterOptions
): string {
  const { outputPath } = options

  const rows: (string | number | null)[][] = [XLSX_HEADERS]

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]
    const hpoMatchStr = v.hpo_match.map((h) => h.name).join(', ')
    const moiStr = v.moi
      .map((m) => (m.abbreviation !== null && m.abbreviation !== '' ? m.abbreviation : m.name))
      .join(', ')

    rows.push([
      sample.lims_id,
      v.chr,
      v.pos,
      v.ref,
      v.alt,
      v.gt_num,
      v.gene_symbol,
      v.func,
      v.consequence,
      v.transcript,
      v.cdna,
      v.aa_change,
      v.gnomad_af,
      v.cadd,
      v.qual,
      v.clinvar,
      v.hpo_sim_score,
      hpoMatchStr || null,
      moiStr || null
    ])
  }

  const wb = XLSX.utils.book_new()
  const variantsWs = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, variantsWs, 'Variants')

  const exportInfoRows = [
    ['Export Information'],
    ['Export Date', new Date().toISOString()],
    ['Total Samples', 1],
    ['Total Variants', variants.length],
    ['Samples Included', sample.lims_id]
  ]
  const metaWs = XLSX.utils.aoa_to_sheet(exportInfoRows)
  XLSX.utils.book_append_sheet(wb, metaWs, 'Export Info')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  writeFileSync(outputPath, buf)

  return outputPath
}
