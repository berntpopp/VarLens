/**
 * JSON import stream assembly, shared by the SQLite and PostgreSQL import
 * workers: decompress -> parse -> pick -> record budget -> streamArray ->
 * format mapper. No database access.
 */
import { compose, type Readable, type Transform } from 'node:stream'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/pick.js'
import { streamArray } from 'stream-json/streamers/stream-array.js'

import type { DataDictionaries } from '../import/types'
import type { FormatInfo } from '../import/strategies/ImportStrategy'
import { createFieldMapper } from '../import/transforms/FieldMapper'
import { createObjectFormatMapper } from '../import/transforms/ObjectFormatMapper'
import { resolveColumnIndices } from '../import/config/fieldMapping'
import { createDecompressedStream } from '../import/stream-utils'
import { createJsonRecordBudget } from '../import/json-resource-budget'

/**
 * Create a readable stream that outputs mapped variant objects.
 * Pipes: decompress → parse → pick → streamArray → format mapper.
 *
 * Output: plain Record<string, unknown> objects (not { key, value } wrappers),
 * because the mapper transforms consume the streamArray wrapper.
 *
 * @param onSkip told about every record dropped for a missing required field
 */
export async function createMapperPipeline(
  filePath: string,
  formatInfo: FormatInfo,
  onSkip?: (reason: string) => void
): Promise<Readable> {
  // The budget already counts each record's bytes; the mapper tags its output
  // with that count so batches can be bounded by size without re-measuring.
  const budget = createJsonRecordBudget({ trackRecordBytes: true })
  let filter: string
  let mapper: Transform

  switch (formatInfo.format) {
    case 'simple':
      filter = 'variants'
      mapper = createObjectFormatMapper(budget.takeRecordBytes, onSkip)
      break

    case 'object':
      filter = `samples.${formatInfo.caseKey}.variants`
      mapper = createObjectFormatMapper(budget.takeRecordBytes, onSkip)
      break

    case 'columnar': {
      const wrapped = formatInfo.wrapped !== false
      const headerPath = wrapped ? `${formatInfo.caseKey}.header` : 'header'
      filter = wrapped ? `${formatInfo.caseKey}.data` : 'data'

      const { dictionaries, columnIndices } = await parseHeader(filePath, headerPath)
      mapper = createFieldMapper(dictionaries, columnIndices, budget.takeRecordBytes, onSkip)
      break
    }

    default:
      throw new Error(`Unsupported format: ${String((formatInfo as FormatInfo).format)}`)
  }

  return compose(
    createDecompressedStream(filePath),
    parser.asStream(),
    pick.asStream({ filter }),
    budget,
    streamArray.asStream(),
    mapper
  )
}

/**
 * Parse columnar header to extract data dictionaries and column indices.
 */
export async function parseHeader(
  filePath: string,
  headerPath: string
): Promise<{
  dictionaries: DataDictionaries
  columnIndices: ReturnType<typeof resolveColumnIndices>
}> {
  return new Promise((resolve, reject) => {
    const dictionaries: DataDictionaries = {
      gene: {},
      impact: {},
      transcript: {},
      hpoSimScore: {},
      moi: {}
    }

    const headerItems: { id: string }[] = []
    const fieldsToExtract = new Set(['Gene', 'Transcript', 'HpoSimScore', 'MoI'])
    let resolved = false

    const stream = compose(
      createDecompressedStream(filePath),
      parser.asStream(),
      pick.asStream({ filter: headerPath }),
      createJsonRecordBudget(),
      streamArray.asStream()
    )

    const cleanup = (): void => {
      stream.destroy()
    }

    stream.on('data', (data: { key: number; value: Record<string, unknown> }) => {
      if (resolved) return

      const headerItem = data.value
      const fieldId = headerItem.id as string

      headerItems[data.key] = { id: fieldId }

      const hasField: boolean = fieldsToExtract.has(fieldId)
      if (
        hasField &&
        headerItem.dataDictionary !== undefined &&
        headerItem.dataDictionary !== null
      ) {
        const rawDict = headerItem.dataDictionary as Record<string, unknown>

        switch (fieldId) {
          case 'Gene':
            dictionaries.gene = rawDict as Record<string, string>
            break
          case 'Transcript':
            dictionaries.transcript = rawDict as Record<string, string>
            break
          case 'HpoSimScore':
            dictionaries.hpoSimScore = rawDict as Record<string, number>
            break
          case 'MoI':
            for (const [key, value] of Object.entries(rawDict)) {
              const isArray: boolean = Array.isArray(value)
              if (isArray && (value as unknown[]).length > 0) {
                const abbrevs = (value as { abbreviation?: string }[])
                  .map((obj) => obj.abbreviation)
                  .filter(Boolean)
                dictionaries.moi[key] = abbrevs.join(', ')
              } else {
                dictionaries.moi[key] = ''
              }
            }
            break
        }
      }
    })

    stream.on('end', () => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve({ dictionaries, columnIndices: resolveColumnIndices(headerItems) })
    })

    stream.on('error', (err: Error) => {
      if (resolved) return
      resolved = true
      cleanup()
      reject(err)
    })
  })
}
