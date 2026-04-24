import { describe, expectTypeOf, it } from 'vitest'

import type { AvailableBuild } from '../../../src/shared/types/database'
import type { ValidatedCaseSearchParams } from '../../../src/shared/types/ipc-schemas'
import type { StorageReadExecutor, StorageReadTask } from '../../../src/main/storage/read-executor'

describe('StorageReadExecutor contract', () => {
  it('accepts the narrow Phase 4 cases:query task union', () => {
    const params: ValidatedCaseSearchParams = {
      limit: 25,
      offset: 0,
      sort_by: 'created_at',
      sort_order: 'desc'
    }

    const queryTask = {
      type: 'cases:query',
      params
    } satisfies StorageReadTask

    expectTypeOf(queryTask).toMatchTypeOf<StorageReadTask>()
    expectTypeOf<StorageReadExecutor['execute']>().returns.toEqualTypeOf<Promise<unknown>>()
  })

  it('supports cases:availableBuilds as a typed read task', () => {
    const task = {
      type: 'cases:availableBuilds',
      params: []
    } satisfies StorageReadTask

    expectTypeOf(task.params).toEqualTypeOf<[]>()
    expectTypeOf<AvailableBuild>().toEqualTypeOf<{ build: string; caseCount: number }>()
    expectTypeOf<StorageReadExecutor['execute']>().returns.toEqualTypeOf<Promise<unknown>>()
  })
})
