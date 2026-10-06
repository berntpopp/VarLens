import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AuditBuffer,
  type BufferedAuditRow,
  resolveAuditBufferSettings
} from '../../../../src/web/server/audit-buffer'

function row(key: string): BufferedAuditRow {
  return {
    action_type: 'api_read',
    entity_type: 'api_call',
    entity_key: key,
    user_name: 'alice',
    new_value: { success: true, method: key },
    occurred_at: 1
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AuditBuffer', () => {
  it('flushes on the interval with one batched sink call', async () => {
    vi.useFakeTimers()
    const sink = vi.fn(async () => undefined)
    const buffer = new AuditBuffer({ sink, flushIntervalMs: 250, maxBatchSize: 100 })

    await buffer.enqueue(row('a'))
    await buffer.enqueue(row('b'))
    await buffer.enqueue(row('c'))
    expect(sink).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][0].map((r: BufferedAuditRow) => r.entity_key)).toEqual([
      'a',
      'b',
      'c'
    ])
    expect(buffer.pendingCount).toBe(0)
  })

  it('flushes immediately when the batch size is reached', async () => {
    vi.useFakeTimers()
    const sink = vi.fn(async () => undefined)
    const buffer = new AuditBuffer({ sink, flushIntervalMs: 10_000, maxBatchSize: 2 })

    await buffer.enqueue(row('a'))
    await buffer.enqueue(row('b'))
    await vi.advanceTimersByTimeAsync(0)

    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][0]).toHaveLength(2)
  })

  it('keeps rows and retries after a failed flush (no loss, order preserved)', async () => {
    vi.useFakeTimers()
    const written: string[] = []
    const sink = vi
      .fn<(rows: BufferedAuditRow[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockImplementation(async (rows) => {
        written.push(...rows.map((r) => r.entity_key))
      })
    const warn = vi.fn()
    const buffer = new AuditBuffer({
      sink,
      flushIntervalMs: 100,
      maxBatchSize: 50,
      logger: { warn, error: vi.fn() }
    })

    await buffer.enqueue(row('a'))
    await vi.advanceTimersByTimeAsync(100)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(buffer.pendingCount).toBe(1)

    await buffer.enqueue(row('b'))
    await vi.advanceTimersByTimeAsync(100)
    expect(written).toEqual(['a', 'b'])
    expect(buffer.pendingCount).toBe(0)
  })

  it('close() drains every pending row before resolving (SIGTERM path)', async () => {
    const written: string[] = []
    const buffer = new AuditBuffer({
      sink: async (rows) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        written.push(...rows.map((r) => r.entity_key))
      },
      flushIntervalMs: 60_000,
      maxBatchSize: 3
    })

    for (let i = 0; i < 10; i++) await buffer.enqueue(row(`k${i}`))
    await buffer.close()

    expect(written).toHaveLength(10)
    expect(new Set(written).size).toBe(10)
    expect(buffer.pendingCount).toBe(0)
  })

  it('writes rows straight through after close()', async () => {
    const sink = vi.fn(async () => undefined)
    const buffer = new AuditBuffer({ sink, flushIntervalMs: 60_000 })
    await buffer.close()
    await buffer.enqueue(row('late'))
    expect(sink).toHaveBeenCalledWith([expect.objectContaining({ entity_key: 'late' })])
  })

  it('never runs two sink calls concurrently', async () => {
    let active = 0
    let maxActive = 0
    const gate = deferred()
    const buffer = new AuditBuffer({
      sink: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await gate.promise
        active -= 1
      },
      flushIntervalMs: 60_000,
      maxBatchSize: 1
    })

    await buffer.enqueue(row('a'))
    await buffer.enqueue(row('b'))
    const flushes = Promise.all([buffer.flush(), buffer.flush(), buffer.flush()])
    gate.resolve()
    await flushes
    await buffer.close()

    expect(maxActive).toBe(1)
  })

  it('applies backpressure at maxPending instead of growing without bound', async () => {
    const sink = vi
      .fn<(rows: BufferedAuditRow[]) => Promise<void>>()
      .mockRejectedValue(new Error('db down'))
    const buffer = new AuditBuffer({
      sink,
      flushIntervalMs: 60_000,
      maxBatchSize: 2,
      maxPending: 2,
      logger: { warn: vi.fn(), error: vi.fn() }
    })

    await buffer.enqueue(row('a'))
    await buffer.enqueue(row('b'))
    await expect(buffer.enqueue(row('c'))).rejects.toThrow('db down')
    expect(buffer.pendingCount).toBe(2)
  })
})

describe('resolveAuditBufferSettings', () => {
  it('defaults to a 250 ms / 200-row buffer', () => {
    expect(resolveAuditBufferSettings({})).toEqual({ flushIntervalMs: 250, maxBatchSize: 200 })
  })

  it('returns null (synchronous audits) when the interval is 0', () => {
    expect(resolveAuditBufferSettings({ VARLENS_AUDIT_FLUSH_INTERVAL_MS: '0' })).toBeNull()
  })

  it('rejects out-of-range values', () => {
    expect(() => resolveAuditBufferSettings({ VARLENS_AUDIT_FLUSH_INTERVAL_MS: '-5' })).toThrow(
      'VARLENS_AUDIT_FLUSH_INTERVAL_MS'
    )
    expect(() => resolveAuditBufferSettings({ VARLENS_AUDIT_BATCH_SIZE: '0' })).toThrow(
      'VARLENS_AUDIT_BATCH_SIZE'
    )
  })
})
