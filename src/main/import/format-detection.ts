import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import type { Readable } from 'node:stream'
import type { FileFormat, FormatInfo } from './strategies/ImportStrategy'
import { createDecompressedStream } from './stream-utils'

/**
 * Detect the file format by examining top-level keys in a gzipped JSON file.
 *
 * Returns format type and the relevant case key:
 * - Columnar: first top-level key is the case ID
 * - Object: has 'metadata' and 'samples' keys, extracts first sample ID
 * - Simple: has 'variants' key at top level
 */
export async function detectFormat(filePath: string): Promise<FormatInfo> {
  return new Promise((resolve, reject) => {
    const stream = createDecompressedStream(filePath).pipe(parser())

    const topLevelKeys: string[] = []
    let depth = 0
    let resolved = false

    const cleanup = (): void => {
      stream.removeAllListeners()
      stream.destroy()
    }

    const resolveFormat = (format: FileFormat, caseKey: string): void => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve({ format, caseKey })
    }

    const rejectFormat = (error: Error): void => {
      if (resolved) return
      resolved = true
      cleanup()
      reject(error)
    }

    stream.on('data', (data: { name?: string; value?: unknown }) => {
      if (resolved) return

      // Track depth
      if (data.name === 'startObject' || data.name === 'startArray') {
        depth++
      } else if (data.name === 'endObject' || data.name === 'endArray') {
        depth--
      }

      // Collect top-level keys
      if (data.name === 'keyValue' && depth === 1) {
        topLevelKeys.push(String(data.value))

        // Check for simple format
        if (topLevelKeys.includes('variants')) {
          resolveFormat('simple', 'variants')
          return
        }

        // Check for object format markers
        if (topLevelKeys.includes('metadata') && topLevelKeys.includes('samples')) {
          resolved = true
          cleanup()
          extractFirstSampleId(filePath)
            .then((sampleId) => {
              resolve({ format: 'object', caseKey: sampleId })
            })
            .catch(reject)
          return
        }

        // Check for unwrapped columnar: data + header at top level
        if (topLevelKeys.includes('data') && topLevelKeys.includes('header')) {
          resolve({ format: 'columnar', caseKey: '', wrapped: false })
          resolved = true
          cleanup()
          return
        }
      }
    })

    stream.on('end', () => {
      if (resolved) return

      if (topLevelKeys.length === 0) {
        rejectFormat(new Error('Could not detect file format: no top-level keys found'))
        return
      }

      if (topLevelKeys.includes('variants')) {
        resolveFormat('simple', 'variants')
      } else if (topLevelKeys.includes('metadata') || topLevelKeys.includes('samples')) {
        resolved = true
        extractFirstSampleId(filePath)
          .then((sampleId) => {
            resolve({ format: 'object', caseKey: sampleId })
          })
          .catch(reject)
      } else if (topLevelKeys.includes('data') && topLevelKeys.includes('header')) {
        resolve({ format: 'columnar', caseKey: '', wrapped: false })
      } else {
        resolveFormat('columnar', topLevelKeys[0])
      }
    })

    stream.on('error', rejectFormat)
  })
}

/**
 * Extract the first sample ID from an object format file.
 */
export async function extractFirstSampleId(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = createDecompressedStream(filePath).pipe(parser())

    let inSamples = false
    let sampleId: string | null = null
    let depth = 0
    let resolved = false

    const cleanup = (): void => {
      stream.removeAllListeners()
      stream.destroy()
    }

    stream.on('data', (data: { name?: string; value?: unknown }) => {
      if (resolved) return

      if (data.name === 'startObject' || data.name === 'startArray') {
        depth++
      } else if (data.name === 'endObject' || data.name === 'endArray') {
        depth--
      }

      if (data.name === 'keyValue' && depth === 1 && data.value === 'samples') {
        inSamples = true
      }

      if (inSamples && data.name === 'keyValue' && depth === 2 && sampleId === null) {
        sampleId = String(data.value)
        resolved = true
        cleanup()
        resolve(sampleId)
      }
    })

    stream.on('end', () => {
      if (resolved) return
      resolved = true
      cleanup()
      if (sampleId !== null) {
        resolve(sampleId)
      } else {
        reject(new Error('Could not extract sample ID from object format JSON'))
      }
    })

    stream.on('error', (err) => {
      if (resolved) return
      resolved = true
      cleanup()
      reject(err)
    })
  })
}

/**
 * Detect file format and create a data stream positioned at the variant/data items.
 *
 * Returns a streamArray() stream emitting { key: number, value: T } objects.
 * The stream does NOT include format mappers — callers pipe through their own
 * ObjectFormatMapper or FieldMapper as needed.
 *
 * Note: This opens two streams (detect + data), not one. The API benefit is
 * consolidation — callers don't need separate detectFormat + pipeline setup.
 * For object format, this saves the third stream that extractFirstSampleId
 * would otherwise open separately.
 */
export async function createDataPipeline(filePath: string): Promise<{
  formatInfo: FormatInfo
  stream: Readable
}> {
  const formatInfo = await detectFormat(filePath)
  const decompressed = createDecompressedStream(filePath)
  const jsonParser = parser()

  let stream: Readable

  switch (formatInfo.format) {
    case 'simple':
      stream = decompressed
        .pipe(jsonParser)
        .pipe(pick({ filter: 'variants' }))
        .pipe(streamArray())
      break

    case 'object': {
      const samplePath = `samples.${formatInfo.caseKey}.variants`
      stream = decompressed
        .pipe(jsonParser)
        .pipe(pick({ filter: samplePath }))
        .pipe(streamArray())
      break
    }

    case 'columnar': {
      const wrapped = formatInfo.wrapped !== false
      const dataPath = wrapped ? `${formatInfo.caseKey}.data` : 'data'
      stream = decompressed
        .pipe(jsonParser)
        .pipe(pick({ filter: dataPath }))
        .pipe(streamArray())
      break
    }
  }

  return { formatInfo, stream }
}
