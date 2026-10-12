import type { IpcScenario } from './shared'

export const casesScenario: IpcScenario = {
  area: 'cases',
  run: async (ctx) => [
    await ctx.call('cases', 'list'),
    await ctx.call('cases', 'query', [{ limit: 20, offset: 0, search_term: 'ipc-parity' }]),
    await ctx.call('cases', 'availableBuilds'),
    await ctx.call('cases', 'buildReviews')
  ]
}
