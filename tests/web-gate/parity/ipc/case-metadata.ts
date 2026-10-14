import type { IpcScenario } from './shared'

export const caseMetadataScenario: IpcScenario = {
  area: 'case-metadata',
  run: async (ctx) => [
    await ctx.call('caseMetadata', 'upsert', [
      ctx.primaryCaseId,
      { affected_status: 'affected', sex: 'female', notes: 'IPC parity clinical note', age: 42 }
    ]),
    await ctx.call('caseMetadata', 'assignHpoTerm', [ctx.primaryCaseId, 'HP:0001250', 'Seizure']),
    await ctx.call('caseMetadata', 'assignHpoTerm', [
      ctx.primaryCaseId,
      'HP:0000252',
      'Microcephaly',
      { excluded: true, key: true }
    ]),
    await ctx.call('caseMetadata', 'assignHpoTerm', [
      ctx.primaryCaseId,
      'HP:0001250',
      'Seizure',
      { key: true }
    ]),
    await ctx.call('caseMetadata', 'upsertDataInfo', [
      ctx.primaryCaseId,
      { platform: 'genome', platform_details: 'synthetic IPC parity fixture' }
    ]),
    await ctx.call('caseMetadata', 'upsertExternalId', [
      ctx.primaryCaseId,
      'lab_accession',
      'IPC-PARITY-001'
    ]),
    await ctx.call('caseMetadata', 'createCohort', ['IPC Parity Cohort', 'Cohort fixture']),
    await ctx.call('caseMetadata', 'getFullMetadata', [ctx.primaryCaseId])
  ]
}
