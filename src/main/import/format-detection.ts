import { createInterface } from 'node:readline'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/pick.js'
import { streamArray } from 'stream-json/streamers/stream-array.js'
import { createJsonRecordBudget } from './json-resource-budget'
import { compose, type Readable } from 'node:stream'
import type { FileFormat, FormatInfo } from './strategies/ImportStrategy'
import { createCappedLineStream, createDecompressedStream } from './stream-utils'

const MAX_FORMAT_DETECTION_TOP_LEVEL_KEYS = 4_096
const MAX_FORMAT_DETECTION_TOP_LEVEL_KEY_BYTES = 1024 * 1024
const MAX_FORMAT_DETECTION_KEY_BYTES = 16 * 1024
const MAX_FORMAT_DETECTION_TOKENS = 250_000
const MAX_FORMAT_DETECTION_DEPTH = 64

interface JsonToken {
  name?: string
  value?: unknown
}

export class FormatDetectionLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatDetectionLimitError'
  }
}

/**
 * Check if a file is a VCF file by reading the first line.
 * VCF files start with "##fileformat=VCFv4"
 */
async function isVcfFile(filePath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const { stream } = createCappedLineStream(filePath)
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let settled = false

    const settle = (result: boolean, error?: Error): void => {
      if (settled) return
      settled = true
      rl.close()
      stream.destroy()
      if (error !== undefined) reject(error)
      else resolve(result)
    }

    rl.on('line', (line: string) => {
      settle(line.startsWith('##fileformat=VCFv'))
    })
    rl.on('close', () => settle(false))
    rl.on('error', (error) => settle(false, error))
    stream.on('error', (error) => settle(false, error))
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
    const stream = compose(
      createDecompressedStream(filePath),
      parser.asStream({ packKeys: false, packStrings: false, packNumbers: false })
    )

    let firstTopLevelKey = ''
    let topLevelKeyCount = 0
    let topLevelKeyBytes = 0
    let hasVariants = false
    let hasMetadata = false
    let hasSamples = false
    let hasData = false
    let hasHeader = false
    let depth = 0
    let resolved = false
    let tokenCount = 0
    const keyReader = new BoundedJsonKeyReader()

    const cleanup = (): void => {
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

    const processTopLevelKey = (key: string): void => {
      topLevelKeyCount += 1
      topLevelKeyBytes += Buffer.byteLength(key, 'utf8')
      if (
        topLevelKeyCount > MAX_FORMAT_DETECTION_TOP_LEVEL_KEYS ||
        topLevelKeyBytes > MAX_FORMAT_DETECTION_TOP_LEVEL_KEY_BYTES
      ) {
        throw new FormatDetectionLimitError(
          'JSON format detection exceeded its top-level keys budget'
        )
      }
      if (topLevelKeyCount === 1) firstTopLevelKey = key
      hasVariants ||= key === 'variants'
      hasMetadata ||= key === 'metadata'
      hasSamples ||= key === 'samples'
      hasData ||= key === 'data'
      hasHeader ||= key === 'header'

      if (hasVariants) {
        resolveFormat('simple', 'variants')
        return
      }
      if (hasMetadata && hasSamples) {
        resolved = true
        cleanup()
        extractFirstSampleId(filePath)
          .then((sampleId) => resolve({ format: 'object', caseKey: sampleId }))
          .catch(reject)
        return
      }
      if (hasData && hasHeader) {
        resolved = true
        cleanup()
        resolve({ format: 'columnar', caseKey: '', wrapped: false })
        return
      }
      if (firstTopLevelKey === 'data' && topLevelKeyCount === 1) pendingDataKey = true
    }

    stream.on('data', (data: JsonToken) => {
      if (resolved) return

      tokenCount += 1
      if (tokenCount > MAX_FORMAT_DETECTION_TOKENS) {
        rejectFormat(new FormatDetectionLimitError('JSON format detection token budget exceeded'))
        return
      }

      // Track depth
      if (data.name === 'startObject' || data.name === 'startArray') {
        depth++
        if (depth > MAX_FORMAT_DETECTION_DEPTH) {
          rejectFormat(new FormatDetectionLimitError('JSON format detection depth budget exceeded'))
          return
        }
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

      try {
        const key = keyReader.consume(data, depth)
        if (key !== null && key.depth === 1) processTopLevelKey(key.value)
      } catch (error) {
        rejectFormat(error as Error)
      }
    })

    stream.on('end', () => {
      if (resolved) return

      if (topLevelKeyCount === 0) {
        rejectFormat(new Error('Could not detect file format: no top-level keys found'))
        return
      }

      if (hasVariants) {
        resolveFormat('simple', 'variants')
      } else if (hasMetadata || hasSamples) {
        resolved = true
        extractFirstSampleId(filePath)
          .then((sampleId) => {
            resolve({ format: 'object', caseKey: sampleId })
          })
          .catch(reject)
      } else if (hasData && hasHeader) {
        resolve({ format: 'columnar', caseKey: '', wrapped: false })
      } else {
        resolveFormat('columnar', firstTopLevelKey)
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
    const stream = compose(
      createDecompressedStream(filePath),
      parser.asStream({ packKeys: false, packStrings: false, packNumbers: false })
    )

    let inSamples = false
    let sampleId: string | null = null
    let depth = 0
    let resolved = false
    let tokenCount = 0
    const keyReader = new BoundedJsonKeyReader()

    const cleanup = (): void => {
      stream.destroy()
    }

    stream.on('data', (data: JsonToken) => {
      if (resolved) return

      tokenCount += 1
      if (tokenCount > MAX_FORMAT_DETECTION_TOKENS) {
        resolved = true
        cleanup()
        reject(new FormatDetectionLimitError('JSON sample detection token budget exceeded'))
        return
      }

      if (data.name === 'startObject' || data.name === 'startArray') {
        depth++
        if (depth > MAX_FORMAT_DETECTION_DEPTH) {
          resolved = true
          cleanup()
          reject(new FormatDetectionLimitError('JSON sample detection depth budget exceeded'))
          return
        }
      } else if (data.name === 'endObject' || data.name === 'endArray') {
        depth--
      }

      try {
        const key = keyReader.consume(data, depth)
        if (key?.depth === 1 && key.value === 'samples') inSamples = true
        else if (inSamples && key?.depth === 2 && sampleId === null) {
          sampleId = key.value
          resolved = true
          cleanup()
          resolve(sampleId)
        }
      } catch (error) {
        resolved = true
        cleanup()
        reject(error)
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

class BoundedJsonKeyReader {
  private active = false
  private depth = 0
  private bytes = 0
  private chunks: string[] = []

  consume(token: JsonToken, currentDepth: number): { value: string; depth: number } | null {
    if (token.name === 'startKey') {
      this.active = true
      this.depth = currentDepth
      this.bytes = 0
      this.chunks = []
      return null
    }
    if (this.active && token.name === 'stringChunk') {
      const chunk = String(token.value ?? '')
      this.bytes += Buffer.byteLength(chunk, 'utf8')
      if (this.bytes > MAX_FORMAT_DETECTION_KEY_BYTES) {
        throw new FormatDetectionLimitError(
          `JSON format detection key exceeds ${MAX_FORMAT_DETECTION_KEY_BYTES} bytes`
        )
      }
      this.chunks.push(chunk)
      return null
    }
    if (this.active && token.name === 'endKey') {
      const result = { value: this.chunks.join(''), depth: this.depth }
      this.active = false
      this.chunks = []
      return result
    }
    return null
  }
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
  let stream: Readable

  switch (formatInfo.format) {
    case 'simple':
      stream = compose(
        createDecompressedStream(filePath),
        parser.asStream(),
        pick.asStream({ filter: 'variants' }),
        createJsonRecordBudget(),
        streamArray.asStream()
      )
      break

    case 'object': {
      const samplePath = `samples.${formatInfo.caseKey}.variants`
      stream = compose(
        createDecompressedStream(filePath),
        parser.asStream(),
        pick.asStream({ filter: samplePath }),
        createJsonRecordBudget(),
        streamArray.asStream()
      )
      break
    }

    case 'columnar': {
      const wrapped = formatInfo.wrapped !== false
      const dataPath = wrapped ? `${formatInfo.caseKey}.data` : 'data'
      stream = compose(
        createDecompressedStream(filePath),
        parser.asStream(),
        pick.asStream({ filter: dataPath }),
        createJsonRecordBudget(),
        streamArray.asStream()
      )
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
