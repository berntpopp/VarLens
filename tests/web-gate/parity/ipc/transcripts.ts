import type { IpcScenario } from './shared'

export const transcriptsScenario: IpcScenario = {
  area: 'transcripts',
  run: async (ctx) => [
    await ctx.call('transcripts', 'insertAndSwitch', [
      ctx.primaryVariant.id,
      {
        transcript_id: 'ENST_PARITY_000001',
        gene_symbol: 'COMT',
        consequence: 'HIGH',
        func: 'stop_gained',
        cdna: 'c.493G>A',
        aa_change: 'p.Glu165Ter',
        hpo_sim_score: 0.87,
        moi: 'AD',
        is_selected: 1
      }
    ]),
    await ctx.call('transcripts', 'switch', [ctx.primaryVariant.id, 'ENST_PARITY_000001']),
    await ctx.call('transcripts', 'list', [ctx.primaryVariant.id]),
    await ctx.call('variants', 'query', [ctx.primaryCaseId, { consequences: ['HIGH'] }, 0, 25])
  ]
}
