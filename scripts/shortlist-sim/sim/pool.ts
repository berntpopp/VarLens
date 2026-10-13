/**
 * Worker pool over simulation jobs: `workers` worker threads (each with its own background
 * DBs), or the in-process runner when `workers` is 1. Results come back in job order.
 */
import { Worker } from 'node:worker_threads'
import { JobRunner, type Job, type JobResult, type WorkerInit } from './jobs'

export async function runJobs(
  jobs: Job[],
  init: WorkerInit,
  workers: number,
  onProgress?: (done: number, total: number) => void
): Promise<JobResult[]> {
  const results = new Array<JobResult>(jobs.length)
  if (workers <= 1) {
    const runner = new JobRunner(init)
    jobs.forEach((job, i) => {
      results[i] = runner.run(job)
      onProgress?.(i + 1, jobs.length)
    })
    return results
  }
  let next = 0
  let done = 0
  const entry = new URL('./worker-entry.mjs', import.meta.url)
  const lane = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const w = new Worker(entry, { workerData: init })
      const send = (): void => {
        if (next >= jobs.length) {
          void w.terminate().then(() => resolve())
          return
        }
        const id = next++
        w.postMessage({ id, job: jobs[id] })
      }
      w.on('message', (msg: { id: number; result?: JobResult; error?: string }) => {
        if (msg.error !== undefined) {
          void w.terminate()
          reject(new Error(`job ${msg.id}: ${msg.error}`))
          return
        }
        results[msg.id] = msg.result as JobResult
        onProgress?.(++done, jobs.length)
        send()
      })
      w.on('error', reject)
      send()
    })
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, lane))
  return results
}
