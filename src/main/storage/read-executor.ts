import type { ValidatedCaseSearchParams } from '../../shared/types/ipc-schemas'

export type { AvailableBuild } from '../../shared/types/database'

export type StorageReadTask =
  | {
      type: 'cases:query'
      params: ValidatedCaseSearchParams
    }
  | {
      type: 'cases:availableBuilds'
      params: []
    }

export interface StorageReadExecutor {
  execute(task: StorageReadTask): Promise<unknown>
}
