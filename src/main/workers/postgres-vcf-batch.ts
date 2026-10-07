import type { VcfMappedVariant } from '../import/vcf/types'

type Row = Record<string, unknown>
type ChildRow = Row & { ordinal: number }

/** The five parallel row sets PostgresVcfImportRepository.writeVcfFile copies. */
export interface VcfBatchRows {
  variants: Row[]
  transcripts: ChildRow[]
  sv: ChildRow[]
  cnv: ChildRow[]
  str: ChildRow[]
}

/**
 * Split one batch of mapped VCF variants into the base rows and their
 * transcript / SV / CNV / STR child rows. `ordinal` is the variant's index
 * within this batch; the repository uses it to attach each child row to the
 * id its variant was given.
 */
export function splitVcfRows(rows: readonly VcfMappedVariant[]): VcfBatchRows {
  const out: VcfBatchRows = { variants: [], transcripts: [], sv: [], cnv: [], str: [] }
  for (let ordinal = 0; ordinal < rows.length; ordinal++) {
    const { _transcripts, _sv, _cnv, _str, ...base } = rows[ordinal]
    out.variants.push(base as unknown as Row)
    if (Array.isArray(_transcripts)) {
      for (const t of _transcripts as unknown as Row[]) {
        out.transcripts.push({ ordinal, ...t })
      }
    }
    if (_sv !== undefined && _sv !== null) out.sv.push({ ordinal, ...(_sv as unknown as Row) })
    if (_cnv !== undefined && _cnv !== null) out.cnv.push({ ordinal, ...(_cnv as unknown as Row) })
    if (_str !== undefined && _str !== null) out.str.push({ ordinal, ...(_str as unknown as Row) })
  }
  return out
}
