import type { JobContext } from '../services/jobs/JobRunner'
import type { StorageImportProgress } from './import-executor'

/**
 * Mirror an import's progress onto its `import_single` job so job views
 * (`jobs:changed` → the renderer's background-jobs panel) show it: the
 * variant count as `current`, no known total (indeterminate), the phase as
 * the message. The caller's own `onProgress` still fires unchanged.
 */
export function withImportJobProgress<
  P extends { onProgress?: (data: StorageImportProgress) => void }
>(ctx: Pick<JobContext, 'reportProgress'>, params: P): P {
  const original = params.onProgress
  return {
    ...params,
    onProgress: (data: StorageImportProgress) => {
      ctx.reportProgress(data.count, 0, data.phase)
      original?.(data)
    }
  }
}
