import type { StorageReadExecutor, StorageReadTask } from '../read-executor'
import type { PostgresAvailableBuildsRepository } from './PostgresAvailableBuildsRepository'
import type { PostgresCasesQueryRepository } from './PostgresCasesQueryRepository'

interface PostgresReadExecutorRepositories {
  casesQuery: Pick<PostgresCasesQueryRepository, 'queryCases'>
  availableBuilds: Pick<PostgresAvailableBuildsRepository, 'getAvailableGenomeBuilds'>
}

export class PostgresReadExecutor implements StorageReadExecutor {
  constructor(private readonly repositories: PostgresReadExecutorRepositories) {}

  async execute(task: StorageReadTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:query':
        return await this.repositories.casesQuery.queryCases(task.params)

      case 'cases:availableBuilds':
        return await this.repositories.availableBuilds.getAvailableGenomeBuilds()
    }

    const _exhaustive: never = task
    throw new Error(`Unhandled read task: ${JSON.stringify(_exhaustive)}`)
  }
}
