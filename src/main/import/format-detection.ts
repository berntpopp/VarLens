import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/pick.js'
import { streamArray } from 'stream-json/streamers/stream-array.js'
import type { Readable } from 'node:stream'
import type { FileFormat, FormatInfo } from './strategies/ImportStrategy'
import { createDecompressedStream, isGzipped } from './stream-utils'

/**
 * Check if a file is a VCF file by reading the first line.
 * VCF files start with "##fileformat=VCFv4"
 */
async function isVcfFile(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const raw = createReadStream(filePath, { start: 0, end: 1024 })
    const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw

    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let resolved = false

    rl.on('line', (line: string) => {
      if (!resolved) {
        resolved = true
        rl.close()
        resolve(line.startsWith('##fileformat=VCFv'))
      }
    })

    rl.on('close', () => {
      if (!resolved) {
        resolved = true
        resolve(false)
      }
    })

    rl.on('error', () => {
      if (!resolved) {
        resolved = true
        resolve(false)
      }
    })

    stream.on('error', () => {
      if (!resolved) {
        resolved = true
        resolve(false)
      }
    })
  })
}

/**
 * Detect the file format by examining file content.
 *
 * Returns format type and the relevant case key:
 * - VCF: .vcf or .vcf.gz files starting with ##fileformat=VCFv
 * - Columnar: first top-level key is the case ID
 * - Object: has 'metadata' and 'samples' keys, extracts first sample ID
 * - Simple: has 'variants' key at top level
 */
export async function detectFormat(filePath: string): Promise<FormatInfo> {
  // Check for VCF first (before JSON detection)
  const ext = filePath.toLowerCase()
  if (ext.endsWith('.vcf') || ext.endsWith('.vcf.gz')) {
    const isVcf = await isVcfFile(filePath)
    if (isVcf) {
      return { format: 'vcf', caseKey: '' }
    }
  }

  // Also check files without VCF extension but with VCF magic line
  if (!ext.endsWith('.json') && !ext.endsWith('.json.gz')) {
    const isVcf = await isVcfFile(filePath)
    if (isVcf) {
      return { format: 'vcf', caseKey: '' }
    }
  }
  return new Promise((resolve, reject) => {
    const stream = createDecompressedStream(filePath).pipe(parser.asStream())

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

    let pendingDataKey = false

    stream.on('data', (data: { name?: string; value?: unknown }) => {
      if (resolved) return

      // Track depth
      if (data.name === 'startObject' || data.name === 'startArray') {
        depth++
      } else if (data.name === 'endObject' || data.name === 'endArray') {
        depth--
      }

      // Early resolve: if 'data' was the first key, check if its value is an
      // array (unwrapped columnar) vs object (wrapped columnar with case ID "data").
      // This avoids parsing through the entire data array (200MB+) to find 'header'.
      if (pendingDataKey && depth === 2) {
        pendingDataKey = false
        if (data.name === 'startArray') {
          resolved = true
          cleanup()
          resolve({ format: 'columnar', caseKey: '', wrapped: false })
          return
        }
        // startObject means wrapped columnar — fall through to normal detection
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

        // Check for unwrapped columnar: data + header both seen at top level
        if (topLevelKeys.includes('data') && topLevelKeys.includes('header')) {
          resolved = true
          cleanup()
          resolve({ format: 'columnar', caseKey: '', wrapped: false })
          return
        }

        // If 'data' is the first key, defer resolution until we see the value type
        if (topLevelKeys[0] === 'data' && topLevelKeys.length === 1) {
          pendingDataKey = true
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
    const stream = createDecompressedStream(filePath).pipe(parser.asStream())

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

    stream.on('error', (err: Error) => {
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
  const jsonParser = parser.asStream()

  let stream: Readable

  switch (formatInfo.format) {
    case 'simple':
      stream = decompressed
        .pipe(jsonParser)
        .pipe(pick.asStream({ filter: 'variants' }))
        .pipe(streamArray.asStream())
      break

    case 'object': {
      const samplePath = `samples.${formatInfo.caseKey}.variants`
      stream = decompressed
        .pipe(jsonParser)
        .pipe(pick.asStream({ filter: samplePath }))
        .pipe(streamArray.asStream())
      break
    }

    case 'columnar': {
      const wrapped = formatInfo.wrapped !== false
      const dataPath = wrapped ? `${formatInfo.caseKey}.data` : 'data'
      stream = decompressed
        .pipe(jsonParser)
        .pipe(pick.asStream({ filter: dataPath }))
        .pipe(streamArray.asStream())
      break
    }

    case 'vcf':
      // VCF files are not JSON — createDataPipeline is not applicable.
      // Use VcfStrategy.import() directly instead.
      throw new Error(
        'VCF files cannot be processed through the JSON data pipeline. Use VcfStrategy instead.'
      )
  }

  return { formatInfo, stream }
}
