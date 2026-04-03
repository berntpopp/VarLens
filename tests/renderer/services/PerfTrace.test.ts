import { describe, it, expect, beforeEach } from 'vitest'
import {
  traceStart,
  traceEnd,
  traceAsync,
  getRecentTraces,
  clearTraces
} from '../../../src/renderer/src/services/PerfTrace'

describe('PerfTrace', () => {
  beforeEach(() => {
    clearTraces()
  })

  it('records a trace with start/end', () => {
    const id = traceStart('test-op')
    const entry = traceEnd(id)
    expect(entry).not.toBeNull()
    expect(entry!.name).toBe('test-op')
    expect(entry!.duration).toBeGreaterThanOrEqual(0)
    expect(entry!.overBudget).toBe(false)
  })

  it('checks budget when provided', () => {
    const id = traceStart('fast-op')
    const entry = traceEnd(id, 'ANNOTATION_HYDRATE')
    expect(entry).not.toBeNull()
    expect(entry!.budget).toBe('ANNOTATION_HYDRATE')
    expect(entry!.overBudget).toBe(false)
  })

  it('returns null for unknown trace ID', () => {
    const entry = traceEnd('nonexistent-123-abcd')
    expect(entry).toBeNull()
  })

  it('traceAsync wraps an async function', async () => {
    const result = await traceAsync('async-op', async () => 42)
    expect(result).toBe(42)
    const traces = getRecentTraces()
    expect(traces.length).toBe(1)
    expect(traces[0].name).toBe('async-op')
  })

  it('traceAsync records even if function throws', async () => {
    await expect(
      traceAsync('failing-op', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    const traces = getRecentTraces()
    expect(traces.length).toBe(1)
    expect(traces[0].name).toBe('failing-op')
  })

  it('getRecentTraces returns most recent first', () => {
    const id1 = traceStart('first')
    traceEnd(id1)
    const id2 = traceStart('second')
    traceEnd(id2)
    const traces = getRecentTraces()
    expect(traces[0].name).toBe('second')
    expect(traces[1].name).toBe('first')
  })

  it('clearTraces empties the buffer', () => {
    const id = traceStart('to-clear')
    traceEnd(id)
    expect(getRecentTraces().length).toBe(1)
    clearTraces()
    expect(getRecentTraces().length).toBe(0)
  })

  it('caps entries at MAX_ENTRIES (100)', () => {
    for (let i = 0; i < 120; i++) {
      const id = traceStart(`op-${i}`)
      traceEnd(id)
    }
    expect(getRecentTraces(200).length).toBe(100)
  })
})
