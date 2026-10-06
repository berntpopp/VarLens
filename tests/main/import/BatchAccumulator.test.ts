import { describe, it, expect, vi } from 'vitest'
import { BatchAccumulator } from '../../../src/main/import/transforms/BatchAccumulator'
import { setRecordBytes } from '../../../src/main/import/bounded-batcher'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

describe('BatchAccumulator', () => {
  it('calls flushFn with caseId and batch when batchSize reached', async () => {
    const flushFn = vi.fn()
    const accumulator = new BatchAccumulator({
      caseId: 1,
      batchSize: 2,
      flushFn,
      onProgress: undefined,
      startTime: Date.now()
    })

    const sink = new Writable({ objectMode: true, write: (_c, _e, cb) => cb() })

    accumulator.write({ chr: '1', pos: 100, ref: 'A', alt: 'T' })
    accumulator.write({ chr: '1', pos: 200, ref: 'G', alt: 'C' })
    accumulator.write({ chr: '1', pos: 300, ref: 'T', alt: 'A' })
    accumulator.end()

    await pipeline(accumulator, sink)

    // 2 flushes: batch of 2 + remainder of 1
    expect(flushFn).toHaveBeenCalledTimes(2)
    expect(flushFn).toHaveBeenCalledWith(
      1,
      expect.arrayContaining([
        expect.objectContaining({ chr: '1', pos: 100 }),
        expect.objectContaining({ chr: '1', pos: 200 })
      ])
    )
    expect(flushFn).toHaveBeenCalledWith(1, [expect.objectContaining({ chr: '1', pos: 300 })])
  })

  it('tracks inserted count correctly', async () => {
    const flushFn = vi.fn()
    const accumulator = new BatchAccumulator({
      caseId: 1,
      batchSize: 10,
      flushFn,
      onProgress: undefined,
      startTime: Date.now()
    })

    const sink = new Writable({ objectMode: true, write: (_c, _e, cb) => cb() })

    accumulator.write({ chr: '1', pos: 100, ref: 'A', alt: 'T' })
    accumulator.write({ chr: '2', pos: 200, ref: 'G', alt: 'C' })
    accumulator.end()

    await pipeline(accumulator, sink)

    expect(accumulator.inserted).toBe(2)
    expect(flushFn).toHaveBeenCalledTimes(1)
    expect(flushFn).toHaveBeenCalledWith(
      1,
      expect.arrayContaining([
        expect.objectContaining({ chr: '1', pos: 100 }),
        expect.objectContaining({ chr: '2', pos: 200 })
      ])
    )
  })

  it('reports progress via onProgress callback', async () => {
    const flushFn = vi.fn()
    const onProgress = vi.fn()
    const accumulator = new BatchAccumulator({
      caseId: 1,
      batchSize: 1,
      flushFn,
      onProgress,
      startTime: Date.now()
    })

    const sink = new Writable({ objectMode: true, write: (_c, _e, cb) => cb() })

    accumulator.write({ chr: '1', pos: 100, ref: 'A', alt: 'T' })
    accumulator.end()

    await pipeline(accumulator, sink)

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'inserting', count: 1 })
    )
  })

  it('flushes remaining variants on stream end', async () => {
    const flushFn = vi.fn()
    const accumulator = new BatchAccumulator({
      caseId: 42,
      batchSize: 100, // larger than input
      flushFn,
      onProgress: undefined,
      startTime: Date.now()
    })

    const sink = new Writable({ objectMode: true, write: (_c, _e, cb) => cb() })

    accumulator.write({ chr: '1', pos: 100, ref: 'A', alt: 'T' })
    accumulator.end()

    await pipeline(accumulator, sink)

    expect(flushFn).toHaveBeenCalledTimes(1)
    expect(flushFn).toHaveBeenCalledWith(42, [expect.objectContaining({ chr: '1', pos: 100 })])
    expect(accumulator.inserted).toBe(1)
  })

  it('flushes on the byte budget before the row limit is reached', async () => {
    const flushed: number[] = []
    const accumulator = new BatchAccumulator({
      caseId: 1,
      batchSize: 100,
      maxBatchBytes: 25,
      flushFn: (_caseId, batch) => flushed.push(batch.length),
      onProgress: undefined,
      startTime: Date.now()
    })
    const sink = new Writable({ objectMode: true, write: (_c, _e, cb) => cb() })

    for (let pos = 1; pos <= 5; pos++) {
      const variant = { chr: '1', pos, ref: 'A', alt: 'T' }
      setRecordBytes(variant, 10)
      accumulator.write(variant)
    }
    accumulator.end()
    await pipeline(accumulator, sink)

    // 10 bytes each against 25: every third record crosses the budget.
    expect(flushed).toEqual([3, 2])
    expect(accumulator.inserted).toBe(5)
  })
})
