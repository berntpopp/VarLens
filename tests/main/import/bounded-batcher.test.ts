// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  createBoundedBatcher,
  getRecordBytes,
  resolveBatchSize,
  setRecordBytes
} from '../../../src/main/import/bounded-batcher'
import { JsonRecordBudgetTransform } from '../../../src/main/import/json-resource-budget'
import { DATABASE_CONFIG } from '../../../src/shared/config'

function collect(maxRows: number, maxBytes: number) {
  const flushed: Array<{ rows: string[]; bytes: number }> = []
  const batcher = createBoundedBatcher<string, void>({
    maxRows,
    maxBytes,
    flush: (rows, bytes) => {
      flushed.push({ rows, bytes })
    }
  })
  return { batcher, flushed }
}

describe('createBoundedBatcher', () => {
  it('reports full at the row limit and hands the batch to flush', () => {
    const { batcher, flushed } = collect(2, 1_000)

    expect(batcher.add('a', 1)).toBe(false)
    expect(batcher.add('b', 1)).toBe(true)
    batcher.flush()

    expect(flushed).toEqual([{ rows: ['a', 'b'], bytes: 2 }])
    expect(batcher.rows).toBe(0)
    expect(batcher.bytes).toBe(0)
  })

  it('reports full at the byte limit before the row limit is reached', () => {
    const { batcher, flushed } = collect(100, 10)

    expect(batcher.add('a', 4)).toBe(false)
    expect(batcher.add('b', 4)).toBe(false)
    expect(batcher.add('c', 4)).toBe(true)
    batcher.flush()

    expect(flushed).toEqual([{ rows: ['a', 'b', 'c'], bytes: 12 }])
  })

  it('flushes a single record that alone exceeds the byte budget as its own batch', () => {
    const { batcher, flushed } = collect(100, 10)

    expect(batcher.add('huge', 500)).toBe(true)
    batcher.flush()
    expect(batcher.add('small', 1)).toBe(false)
    batcher.flush()

    expect(flushed.map((f) => f.rows)).toEqual([['huge'], ['small']])
  })

  it('applies whichever limit is reached first across consecutive batches', () => {
    const { batcher, flushed } = collect(3, 10)
    const input: Array<[string, number]> = [
      ['a', 1],
      ['b', 1],
      ['c', 1], // rows
      ['d', 9],
      ['e', 9], // bytes
      ['f', 1]
    ]
    for (const [row, bytes] of input) {
      if (batcher.add(row, bytes)) batcher.flush()
    }
    batcher.flush()

    expect(flushed.map((f) => f.rows)).toEqual([['a', 'b', 'c'], ['d', 'e'], ['f']])
  })

  it('does not call flush for an empty batch', () => {
    const { batcher, flushed } = collect(2, 10)
    batcher.flush()
    expect(flushed).toEqual([])
  })

  it('drops a batch whose flush threw instead of offering it again', () => {
    let calls = 0
    const batcher = createBoundedBatcher<string, void>({
      maxRows: 1,
      maxBytes: 10,
      flush: () => {
        calls += 1
        throw new Error('insert failed')
      }
    })
    batcher.add('a', 1)
    expect(() => batcher.flush()).toThrow('insert failed')
    batcher.flush()
    expect(calls).toBe(1)
  })

  it('returns the flush promise so async writers can await it', async () => {
    const order: string[] = []
    const batcher = createBoundedBatcher<string, Promise<void>>({
      maxRows: 1,
      maxBytes: 10,
      flush: async (rows) => {
        await Promise.resolve()
        order.push(rows.join(','))
      }
    })
    if (batcher.add('a', 1)) await batcher.flush()
    order.push('after')
    expect(order).toEqual(['a', 'after'])
  })

  it('treats a non-finite or negative size as zero bytes', () => {
    const { batcher } = collect(100, 10)
    expect(batcher.add('a', Number.NaN)).toBe(false)
    expect(batcher.add('b', -5)).toBe(false)
    expect(batcher.bytes).toBe(0)
  })
})

describe('record byte tags', () => {
  it('round-trips a size and reports 0 for an untagged record', () => {
    const tagged = {}
    setRecordBytes(tagged, 42)
    expect(getRecordBytes(tagged)).toBe(42)
    expect(getRecordBytes({})).toBe(0)
  })

  it('leaves the record itself untouched', () => {
    const record = { chr: '1' }
    setRecordBytes(record, 7)
    expect(Reflect.ownKeys(record)).toEqual(['chr'])
  })
})

describe('resolveBatchSize', () => {
  it('uses the fallback when no batch size was requested', () => {
    expect(resolveBatchSize(undefined, 1000)).toBe(1000)
  })

  it('accepts integers inside 1..BATCH_INSERT_MAX_ROWS', () => {
    expect(resolveBatchSize(1, 1000)).toBe(1)
    expect(resolveBatchSize(DATABASE_CONFIG.BATCH_INSERT_MAX_ROWS, 1000)).toBe(50_000)
  })

  it.each([0, -1, 1.5, 50_001, Number.NaN, Number.POSITIVE_INFINITY, '100', null])(
    'rejects %p',
    (value) => {
      expect(() => resolveBatchSize(value, 1000)).toThrow(/batchSize must be an integer/)
    }
  )
})

describe('JsonRecordBudgetTransform record byte queue', () => {
  function feed(budget: JsonRecordBudgetTransform, tokens: Array<[string, string?]>): void {
    for (const [name, value] of tokens) budget.write({ name, value })
  }
  const twoRecords: Array<[string, string?]> = [
    ['startArray'],
    ['startObject'],
    ['startKey'],
    ['stringChunk', 'chr'],
    ['endKey'],
    ['keyValue', 'chr'],
    ['startString'],
    ['stringChunk', '12'],
    ['endString'],
    ['stringValue', '12'],
    ['endObject'],
    ['startNumber'],
    ['numberChunk', '1234567'],
    ['endNumber'],
    ['numberValue', '1234567'],
    ['endArray']
  ]

  it('queues one byte count per completed record, in order', () => {
    const budget = new JsonRecordBudgetTransform({ trackRecordBytes: true })
    budget.resume()
    feed(budget, twoRecords)

    expect(budget.takeRecordBytes()).toBe(5) // "chr" + "12"
    expect(budget.takeRecordBytes()).toBe(7)
    expect(budget.takeRecordBytes()).toBe(0)
  })

  it('keeps no queue unless tracking is requested', () => {
    const budget = new JsonRecordBudgetTransform()
    budget.resume()
    feed(budget, twoRecords)

    expect(budget.takeRecordBytes()).toBe(0)
  })
})
