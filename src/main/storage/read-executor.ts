import type { ValidatedCaseSearchParams } from '../../shared/types/ipc-schemas'

export interface AvailableBuild {
  build: string
  caseCount: number
}

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
