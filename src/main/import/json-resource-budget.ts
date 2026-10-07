import { Transform, type TransformCallback } from 'node:stream'

export const MAX_JSON_RECORD_BYTES = 1024 * 1024
export const MAX_JSON_RECORD_TOKENS = 50_000
export const MAX_JSON_RECORD_CONTAINER_ENTRIES = 10_000
export const MAX_JSON_RECORD_DEPTH = 64

interface JsonToken {
  name: string
  value?: string
}

export interface JsonRecordBudgetOptions {
  /**
   * Queue each completed record's byte count for {@link
   * JsonRecordBudgetTransform.takeRecordBytes}. Only enable it when a mapper
   * drains the queue, one take per record.
   */
  trackRecordBytes?: boolean
}

export class JsonRecordLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsonRecordLimitError'
  }
}

/**
 * Reject oversized array elements before stream-json's streamArray materializes
 * them into JavaScript objects. The transform is placed after `pick`, where the
 * selected value must be the array consumed by streamArray.
 */
export class JsonRecordBudgetTransform extends Transform {
  private rootStarted = false
  private depth = 0
  private inRecord = false
  private recordBytes = 0
  private recordTokens = 0
  private recordContainerEntries = 0
  private readonly containers: Array<'array' | 'object'> = []
  private readonly completedRecordBytes: number[] | null

  constructor(options: JsonRecordBudgetOptions = {}) {
    super({ objectMode: true })
    this.completedRecordBytes = options.trackRecordBytes === true ? [] : null
  }

  /**
   * Byte count of the oldest record not yet taken. streamArray emits records
   * in the order this transform completes them, so a mapper that takes once
   * per input chunk reads the size of exactly that chunk — no re-measuring.
   */
  readonly takeRecordBytes = (): number => this.completedRecordBytes?.shift() ?? 0

  private endRecord(): void {
    this.inRecord = false
    this.completedRecordBytes?.push(this.recordBytes)
  }

  override _transform(token: JsonToken, _encoding: BufferEncoding, callback: TransformCallback) {
    try {
      this.inspectToken(token)
      callback(null, token)
    } catch (error) {
      callback(error as Error)
    }
  }

  private inspectToken(token: JsonToken): void {
    if (!this.rootStarted) {
      if (token.name !== 'startArray') {
        throw new JsonRecordLimitError('Selected JSON import value must be an array')
      }
      this.rootStarted = true
      this.depth = 1
      this.containers.push('array')
      return
    }

    if (!this.inRecord && this.depth === 1 && token.name !== 'endArray') {
      this.inRecord = true
      this.recordBytes = 0
      this.recordTokens = 0
      this.recordContainerEntries = 0
    }

    if (this.inRecord) {
      this.recordTokens += 1
      if (this.recordTokens > MAX_JSON_RECORD_TOKENS) {
        throw new JsonRecordLimitError(
          `JSON import record exceeds ${MAX_JSON_RECORD_TOKENS} tokens`
        )
      }
      if (token.name === 'stringChunk' || token.name === 'numberChunk') {
        this.recordBytes += Buffer.byteLength(token.value ?? '', 'utf8')
        if (this.recordBytes > MAX_JSON_RECORD_BYTES) {
          throw new JsonRecordLimitError(
            `JSON import record exceeds ${MAX_JSON_RECORD_BYTES} encoded bytes`
          )
        }
      }
      if (
        token.name === 'keyValue' ||
        (this.containers.length > 1 &&
          this.containers[this.containers.length - 1] === 'array' &&
          isJsonValueStart(token.name))
      ) {
        this.recordContainerEntries += 1
        if (this.recordContainerEntries > MAX_JSON_RECORD_CONTAINER_ENTRIES) {
          throw new JsonRecordLimitError(
            `JSON import record exceeds ${MAX_JSON_RECORD_CONTAINER_ENTRIES} container entries`
          )
        }
      }
    }

    if (token.name === 'startObject' || token.name === 'startArray') {
      this.depth += 1
      this.containers.push(token.name === 'startArray' ? 'array' : 'object')
      if (this.inRecord && this.depth - 1 > MAX_JSON_RECORD_DEPTH) {
        throw new JsonRecordLimitError(
          `JSON import record exceeds nesting depth ${MAX_JSON_RECORD_DEPTH}`
        )
      }
      return
    }

    if (token.name === 'endObject' || token.name === 'endArray') {
      this.depth -= 1
      this.containers.pop()
      if (this.depth < 0) throw new JsonRecordLimitError('Malformed JSON token nesting')
      if (this.inRecord && this.depth === 1) this.endRecord()
      return
    }

    if (
      this.inRecord &&
      this.depth === 1 &&
      (token.name === 'stringValue' ||
        token.name === 'numberValue' ||
        token.name === 'nullValue' ||
        token.name === 'trueValue' ||
        token.name === 'falseValue')
    ) {
      this.endRecord()
    }
  }
}

function isJsonValueStart(tokenName: string): boolean {
  return (
    tokenName === 'startObject' ||
    tokenName === 'startArray' ||
    tokenName === 'startString' ||
    tokenName === 'startNumber' ||
    tokenName === 'nullValue' ||
    tokenName === 'trueValue' ||
    tokenName === 'falseValue'
  )
}

export function createJsonRecordBudget(
  options: JsonRecordBudgetOptions = {}
): JsonRecordBudgetTransform {
  return new JsonRecordBudgetTransform(options)
}
