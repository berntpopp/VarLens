/** Worker thread: owns a JobRunner, answers one message per job. */
import { parentPort, workerData } from 'node:worker_threads'
import { JobRunner, type Job, type WorkerInit } from './jobs'

// rankCase logs one info line per call; the harness keeps stdout for progress.
console.info = () => {}
console.debug = () => {}

const runner = new JobRunner(workerData as WorkerInit)
parentPort?.on('message', (msg: { id: number; job: Job }) => {
  try {
    parentPort?.postMessage({ id: msg.id, result: runner.run(msg.job) })
  } catch (error) {
    parentPort?.postMessage({
      id: msg.id,
      error: error instanceof Error ? error.stack : String(error)
    })
  }
})
