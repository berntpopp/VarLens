import { statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createCappedLineStream } from '../import/stream-utils'
import { detectCaller } from '../import/vcf/caller-detector'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../import/vcf/info-field-registry'
import {
  passesPostMappingFilters,
  passesPreMappingFilters,
  type ImportFilters
} from '../import/vcf/import-filters'
import { mapVcfRecord } from '../import/vcf/VcfMapper'
import { VcfHeaderBudget } from '../import/vcf/vcf-header-limits'
import { parseVcfHeaderFromLines } from '../import/vcf/vcf-header-parser'
import {
  parseVcfLine,
  resolveVcfSelectedSampleColumn,
  type VcfSelectedSampleColumn
} from '../import/vcf/vcf-line-parser'
import type { VcfHeader, VcfMappedVariant } from '../import/vcf/types'
import { VcfResourceLimitError } from '../import/vcf/vcf-resource-limits'

/** Stream mapped VCF variants for the PostgreSQL COPY import path. */
export async function* streamMappedVcfRows(
  filePath: string,
  selectedSample: string,
  filters?: ImportFilters,
  onSkip?: (reason: string) => void
): AsyncGenerator<VcfMappedVariant, void, void> {
  // createReadStream reports open failures asynchronously; fail before the
  // worker's per-file error boundary can lose ownership of that event.
  statSync(filePath)

  const { stream } = createCappedLineStream(filePath)
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let streamError: Error | null = null
  const captureStreamError = (error: Error): void => {
    streamError ??= error
    lines.close()
  }
  stream.on('error', captureStreamError)

  const headerLines: string[] = []
  const headerBudget = new VcfHeaderBudget()
  let header: VcfHeader | null = null
  let activeSample = ''
  let activeSampleColumn: VcfSelectedSampleColumn | null = null
  let callerName: string | null = null

  try {
    for await (const line of lines) {
      if (streamError !== null) throw streamError
      if (line.startsWith('#')) {
        headerBudget.add(line)
        headerLines.push(line)
        continue
      }

      if (header === null) {
        header = parseVcfHeaderFromLines(headerLines)
        activeSampleColumn = resolveVcfSelectedSampleColumn(header.samples, selectedSample)
        activeSample = activeSampleColumn?.name ?? ''
        if (activeSample === '') break
        const callerInfo = detectCaller(headerLines)
        callerName = callerInfo.name !== 'unknown' ? callerInfo.name : null
      }

      try {
        const record = parseVcfLine(line, header.samples, onSkip, activeSampleColumn ?? undefined)
        if (record === null || !passesPreMappingFilters(record, filters)) continue
        const mapped = mapVcfRecord(
          record,
          header,
          activeSample,
          DEFAULT_INFO_FIELD_MAPPINGS,
          callerName
        )
        for (const variant of mapped) {
          if (passesPostMappingFilters(variant, filters)) yield variant
        }
      } catch (error) {
        if (error instanceof VcfResourceLimitError) throw error
        console.warn(
          '[postgres-import-worker] Skipping unparseable VCF line:',
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    if (streamError !== null) throw streamError
  } finally {
    lines.close()
    stream.destroy()
  }
}
