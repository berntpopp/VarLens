import { createAppApi } from './app-api'
import { createCoreApi } from './core-api'
import { createPreloadDomainApis } from './domains'
import type { WindowAPI } from '../../shared/types/api'

export function createWindowApi(): WindowAPI {
  const domains = createPreloadDomainApis()
  const core = createCoreApi(domains)
  const app = createAppApi(domains)

  return {
    cases: core.cases,
    variants: core.variants,
    import: core.import,
    system: core.system,
    export: core.export,
    shell: core.shell,
    database: core.database,
    batchImport: core.batchImport,
    cohort: core.cohort,
    annotations: core.annotations,
    vep: core.vep,
    hpo: core.hpo,
    myvariant: core.myvariant,
    spliceai: core.spliceai,
    caseMetadata: app.caseMetadata,
    caseComments: app.caseComments,
    caseMetrics: app.caseMetrics,
    transcripts: app.transcripts,
    tags: app.tags,
    logs: core.logs,
    audit: app.audit,
    geneLists: app.geneLists,
    regionFiles: app.regionFiles,
    panels: app.panels,
    geneRef: app.geneRef,
    updater: core.updater,
    auth: app.auth,
    analysisGroups: app.analysisGroups,
    protein: app.protein,
    gnomad: app.gnomad,
    perf: core.perf,
    presets: app.presets
  }
}
