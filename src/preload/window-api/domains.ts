import { createAnalysisGroupsApi } from '../domains/analysis-groups'
import { createAnnotationsApi } from '../domains/annotations'
import { createAuditLogApi } from '../domains/audit-log'
import { createAuthApi } from '../domains/auth'
import { createBatchImportApi } from '../domains/batch-import'
import { createCaseCommentsApi } from '../domains/case-comments'
import { createCaseMetadataApi } from '../domains/case-metadata'
import { createCaseMetricsApi } from '../domains/case-metrics'
import { createCasesApi } from '../domains/cases'
import { createCohortApi } from '../domains/cohort'
import { createDatabaseApi } from '../domains/database'
import { createExportApi } from '../domains/export'
import { createFilterPresetsApi } from '../domains/filter-presets'
import { createGeneListsApi } from '../domains/gene-lists'
import { createGeneRefApi } from '../domains/gene-ref'
import { createGnomadApi } from '../domains/gnomad'
import { createHpoApi } from '../domains/hpo'
import { createImportApi } from '../domains/import'
import { createMyvariantApi } from '../domains/myvariant'
import { createPanelsApi } from '../domains/panels'
import { createProteinApi } from '../domains/protein'
import { createRegionFilesApi } from '../domains/region-files'
import { createSpliceaiApi } from '../domains/spliceai'
import { createTagsApi } from '../domains/tags'
import { createTranscriptsApi } from '../domains/transcripts'
import { createVariantsApi } from '../domains/variants'
import { createVepApi } from '../domains/vep'

export function createPreloadDomainApis() {
  return {
    analysisGroupsDomain: createAnalysisGroupsApi(),
    annotationsDomain: createAnnotationsApi(),
    auditLogDomain: createAuditLogApi(),
    authDomain: createAuthApi(),
    batchImportDomain: createBatchImportApi(),
    caseCommentsDomain: createCaseCommentsApi(),
    caseMetadataDomain: createCaseMetadataApi(),
    caseMetricsDomain: createCaseMetricsApi(),
    casesDomain: createCasesApi(),
    cohortDomain: createCohortApi(),
    databaseDomain: createDatabaseApi(),
    exportDomain: createExportApi(),
    filterPresetsDomain: createFilterPresetsApi(),
    geneListsDomain: createGeneListsApi(),
    geneRefDomain: createGeneRefApi(),
    gnomadDomain: createGnomadApi(),
    hpoDomain: createHpoApi(),
    importDomain: createImportApi(),
    myvariantDomain: createMyvariantApi(),
    panelsDomain: createPanelsApi(),
    proteinDomain: createProteinApi(),
    regionFilesDomain: createRegionFilesApi(),
    spliceaiDomain: createSpliceaiApi(),
    tagsDomain: createTagsApi(),
    transcriptsDomain: createTranscriptsApi(),
    variantsDomain: createVariantsApi(),
    vepDomain: createVepApi()
  }
}

export type PreloadDomainApis = ReturnType<typeof createPreloadDomainApis>
