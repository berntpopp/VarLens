import { describe, it, expect, vi } from 'vitest'
import { JobRunner } from '../../../../src/main/services/jobs/JobRunner'

describe('JobRunner — Sprint A D2', () => {
  it('enqueue returns SYNCHRONOUSLY with id + kind + result (Pass-9 #9)', () => {
    const runner = new JobRunner()
    const handle = runner.enqueue('import_single', {}, async () => 42)
    // No `await` — handle is already there.
    expect(typeof handle.id).toBe('string')
    expect(handle.kind).toBe('import_single')
    expect(handle.result).toBeInstanceOf(Promise)
  })

  it('handle.result resolves to the handler return value', async () => {
    const runner = new JobRunner()
    const handle = runner.enqueue('import_single', { x: 1 }, async (_ctx, p: { x: number }) => ({
      doubled: p.x * 2
    }))
    const r = await handle.result
    expect(r).toEqual({ doubled: 2 })
  })

  it('per-kind single-flight gate preserves the three existing error messages (Pass-7 HIGH #2)', () => {
    const runner = new JobRunner()
    // First enqueue ok
    runner.enqueue('import_single', {}, async () => new Promise(() => {})) // pending forever
    // Second enqueue rejects with the preserved message
    expect(() => runner.enqueue('import_single', {}, async () => 0)).toThrow(
      'An import is already in progress'
    )
  })

  it('cancel(jobId) aborts the signal AND invokes registered cancel callbacks (Pass-8 #9)', async () => {
    const runner = new JobRunner()
    const cancelFn = vi.fn()
    const handle = runner.enqueue('import_single', {}, async (ctx) => {
      ctx.registerCancel(cancelFn)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return ctx.signal.aborted ? 'cancelled' : 'completed'
    })
    runner.cancel(handle.id)
    const r = await handle.result
    expect(r).toBe('cancelled')
    expect(cancelFn).toHaveBeenCalled()
  })

  it('a handler that RESOLVES after its signal was aborted ends as cancelled, and still delivers its result', async () => {
    // Batch import and export stop cooperatively and return a partial result
    // instead of throwing; that must not be reported as "completed".
    const runner = new JobRunner()
    const events: string[] = []
    runner.onLifecycle((j) => events.push(j.status))
    let release: () => void = () => {}
    const handle = runner.enqueue('import_batch', {}, async (ctx) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { succeeded: 2, cancelled: ctx.signal.aborted }
    })

    await runner.cancel(handle.id)
    release()

    await expect(handle.result).resolves.toEqual({ succeeded: 2, cancelled: true })
    const job = runner.get(handle.id)
    expect(job?.status).toBe('cancelled')
    expect(job?.error).toBeNull()
    expect(job?.finishedAt).not.toBeNull()
    expect(events).toEqual(['queued', 'running', 'cancelled'])
    // The single-flight slot is released like for any other terminal status.
    expect(() => runner.enqueue('import_batch', {}, async () => 0)).not.toThrow()
  })

  it('a handler that resolves without being cancelled still ends as completed', async () => {
    const runner = new JobRunner()
    const handle = runner.enqueue('import_batch', {}, async () => ({ cancelled: false }))
    await handle.result
    expect(runner.get(handle.id)?.status).toBe('completed')
  })

  it('onLifecycle fires for queued → running → completed', async () => {
    const runner = new JobRunner()
    const events: string[] = []
    runner.onLifecycle((j) => events.push(j.status))
    const handle = runner.enqueue('export', {}, async () => 'ok')
    await handle.result
    expect(events).toEqual(['queued', 'running', 'completed'])
  })

  it('reportProgress publishes a progress snapshot to lifecycle listeners while running', async () => {
    const runner = new JobRunner()
    const seen: Array<{ status: string; progress: unknown }> = []
    runner.onLifecycle((job) => seen.push({ status: job.status, progress: job.progress }))
    let report: ((c: number, t: number, m?: string) => void) | null = null
    let finish: () => void = () => undefined
    const handle = runner.enqueue('case_delete', {}, (ctx) => {
      report = ctx.reportProgress
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })

    report!(1, 4, 'deleting')
    expect(runner.get(handle.id)?.progress).toEqual({ current: 1, total: 4, message: 'deleting' })
    finish()
    await handle.result
    // Late reports after completion are ignored.
    expect(seen.map((s) => s.status)).toEqual(['queued', 'running', 'running', 'completed'])
    expect(runner.get(handle.id)?.progress).toEqual({ current: 1, total: 4, message: 'deleting' })
  })

  it('caps retained terminal jobs and notifies onPrune listeners without evicting active jobs', async () => {
    // Configured with max 2 terminal jobs
    const runner = new JobRunner(2)
    const pruned: string[] = []
    runner.onPrune((id) => pruned.push(id))

    const h1 = runner.enqueue('import_single', { n: 1 }, async () => 'done 1')
    await h1.result
    const h2 = runner.enqueue('import_single', { n: 2 }, async () => 'done 2')
    await h2.result

    expect(runner.list().map((j) => j.id)).toEqual([h1.id, h2.id])
    expect(pruned).toEqual([])

    // Enqueue 3rd job: when it finishes, h1 should be pruned
    const h3 = runner.enqueue('import_single', { n: 3 }, async () => 'done 3')
    await h3.result

    expect(pruned).toEqual([h1.id])
    expect(runner.get(h1.id)).toBeUndefined()
    expect(runner.get(h2.id)).toBeDefined()
    expect(runner.get(h3.id)).toBeDefined()
  })
})
