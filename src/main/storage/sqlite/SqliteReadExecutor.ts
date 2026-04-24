import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { StorageReadExecutor, StorageReadTask } from '../read-executor'

export class SqliteReadExecutor implements StorageReadExecutor {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly dbPool: DbPool | null
  ) {}

  async execute(task: StorageReadTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:query':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'cases:query',
            params: [task.params]
          })
        }

        return this.databaseService.cases.queryCases(task.params)

      case 'cases:availableBuilds':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'cases:availableBuilds',
            params: []
          })
        }

        return this.databaseService.cases.getAvailableGenomeBuilds()
    }

    const _exhaustive: never = task
    throw new Error(`Unhandled read task: ${JSON.stringify(_exhaustive)}`)
  }
}
