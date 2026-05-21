import type { PreloadDomainApis } from './domains'
import type { WindowAPI } from '../../shared/types/api'

type AppWindowApi = Pick<
  WindowAPI,
  | 'caseMetadata'
  | 'caseComments'
  | 'caseMetrics'
  | 'transcripts'
  | 'tags'
  | 'audit'
  | 'geneLists'
  | 'regionFiles'
  | 'panels'
  | 'geneRef'
  | 'auth'
  | 'analysisGroups'
  | 'protein'
  | 'gnomad'
  | 'presets'
>

export function createAppApi(domains: PreloadDomainApis): AppWindowApi {
  const {
    analysisGroupsDomain,
    auditLogDomain,
    authDomain,
    caseCommentsDomain,
    caseMetadataDomain,
    caseMetricsDomain,
    filterPresetsDomain,
    geneListsDomain,
    geneRefDomain,
    gnomadDomain,
    panelsDomain,
    proteinDomain,
    regionFilesDomain,
    tagsDomain,
    transcriptsDomain
  } = domains

  return {
    caseMetadata: {
      get: (caseId) => caseMetadataDomain.get(caseId),
      upsert: (caseId, updates) => caseMetadataDomain.upsert(caseId, updates),
      getFullMetadata: (caseId) => caseMetadataDomain.getFullMetadata(caseId),
      listCohorts: () => caseMetadataDomain.listCohorts(),
      createCohort: (name, description) => caseMetadataDomain.createCohort(name, description),
      updateCohort: (cohortId, updates) => caseMetadataDomain.updateCohort(cohortId, updates),
      deleteCohort: (cohortId) => caseMetadataDomain.deleteCohort(cohortId),
      getCohortByName: (name) => caseMetadataDomain.getCohortByName(name),
      getCaseCohorts: (caseId) => caseMetadataDomain.getCaseCohorts(caseId),
      assignCohort: (caseId, cohortId) => caseMetadataDomain.assignCohort(caseId, cohortId),
      removeCohort: (caseId, cohortId) => caseMetadataDomain.removeCohort(caseId, cohortId),
      setCohorts: (caseId, cohortIds) => caseMetadataDomain.setCohorts(caseId, cohortIds),
      getHpoTerms: (caseId) => caseMetadataDomain.getHpoTerms(caseId),
      assignHpoTerm: (caseId, hpoId, hpoLabel) =>
        caseMetadataDomain.assignHpoTerm(caseId, hpoId, hpoLabel),
      removeHpoTerm: (caseId, hpoId) => caseMetadataDomain.removeHpoTerm(caseId, hpoId),
      getDataInfo: (caseId) => caseMetadataDomain.getDataInfo(caseId),
      upsertDataInfo: (caseId, updates) => caseMetadataDomain.upsertDataInfo(caseId, updates),
      listExternalIds: (caseId) => caseMetadataDomain.listExternalIds(caseId),
      upsertExternalId: (caseId, idType, idValue) =>
        caseMetadataDomain.upsertExternalId(caseId, idType, idValue),
      deleteExternalId: (caseId, idType) => caseMetadataDomain.deleteExternalId(caseId, idType),
      distinctHpoTerms: () => caseMetadataDomain.distinctHpoTerms(),
      distinctPlatforms: () => caseMetadataDomain.distinctPlatforms(),
      distinctExternalIdTypes: () => caseMetadataDomain.distinctExternalIdTypes()
    } as WindowAPI['caseMetadata'],

    caseComments: {
      list: (caseId) => caseCommentsDomain.list(caseId),
      create: (caseId, category, content) => caseCommentsDomain.create(caseId, category, content),
      update: (commentId, content) => caseCommentsDomain.update(commentId, content),
      delete: (commentId) => caseCommentsDomain.delete(commentId)
    },

    caseMetrics: {
      listDefinitions: () => caseMetricsDomain.listDefinitions(),
      createDefinition: (name, valueType, unit, category) =>
        caseMetricsDomain.createDefinition(name, valueType, unit, category),
      listForCase: (caseId) => caseMetricsDomain.listForCase(caseId),
      upsert: (caseId, metricId, value) => caseMetricsDomain.upsert(caseId, metricId, value),
      delete: (caseId, metricId) => caseMetricsDomain.delete(caseId, metricId)
    },

    transcripts: {
      list: (variantId) => transcriptsDomain.list(variantId),
      switch: (variantId, transcriptId) => transcriptsDomain.switch(variantId, transcriptId),
      insertAndSwitch: (variantId, transcript) =>
        transcriptsDomain.insertAndSwitch(variantId, transcript)
    } as WindowAPI['transcripts'],

    tags: {
      list: () => tagsDomain.list(),
      create: (name, color) => tagsDomain.create(name, color),
      update: (id, updates) => tagsDomain.update(id, updates),
      delete: (id) => tagsDomain.delete(id),
      getUsageCount: (tagId) => tagsDomain.getUsageCount(tagId),
      getVariantTags: (caseId, variantId) => tagsDomain.getVariantTags(caseId, variantId),
      assignVariantTag: (caseId, variantId, tagId) =>
        tagsDomain.assignVariantTag(caseId, variantId, tagId),
      removeVariantTag: (caseId, variantId, tagId) =>
        tagsDomain.removeVariantTag(caseId, variantId, tagId),
      setVariantTags: (caseId, variantId, tagIds) =>
        tagsDomain.setVariantTags(caseId, variantId, tagIds)
    },

    audit: {
      getByEntity: (entityKey) => auditLogDomain.getByEntity(entityKey),
      query: (params: Parameters<typeof auditLogDomain.query>[0]) => auditLogDomain.query(params)
    } as WindowAPI['audit'],

    geneLists: {
      list: () => geneListsDomain.list(),
      create: (name, description) => geneListsDomain.create(name, description),
      delete: (id) => geneListsDomain.delete(id),
      getGenes: (listId) => geneListsDomain.getGenes(listId),
      setGenes: (listId, genes) => geneListsDomain.setGenes(listId, genes)
    },

    regionFiles: {
      list: () => regionFilesDomain.list(),
      create: (name, description) => regionFilesDomain.create(name, description),
      delete: (id) => regionFilesDomain.delete(id),
      importBed: (fileId, filePath) => regionFilesDomain.importBed(fileId, filePath)
    } as WindowAPI['regionFiles'],

    panels: {
      list: () => panelsDomain.list(),
      get: (id) => panelsDomain.get(id),
      create: (params) => panelsDomain.create(params),
      update: (params) => panelsDomain.update(params),
      delete: (id) => panelsDomain.delete(id),
      duplicate: (id, newName) => panelsDomain.duplicate(id, newName),
      setGenes: (panelId, genes) => panelsDomain.setGenes(panelId, genes),
      getGenes: (panelId) => panelsDomain.getGenes(panelId),
      activate: (caseId, panelId, paddingBp) => panelsDomain.activate(caseId, panelId, paddingBp),
      deactivate: (caseId, panelId) => panelsDomain.deactivate(caseId, panelId),
      activeForCase: (caseId) => panelsDomain.activeForCase(caseId),
      validateSymbols: (symbols) => panelsDomain.validateSymbols(symbols),
      autocomplete: (query, limit) => panelsDomain.autocomplete(query, limit),
      searchPanelApp: (keyword, region) => panelsDomain.searchPanelApp(keyword, region),
      importPanelApp: (params) => panelsDomain.importPanelApp(params),
      generateStringDb: (params) => panelsDomain.generateStringDb(params),
      exportBed: (panelId, assembly, paddingBp) =>
        panelsDomain.exportBed(panelId, assembly, paddingBp)
    },

    geneRef: {
      info: () => geneRefDomain.info(),
      assemblies: () => geneRefDomain.assemblies(),
      checkUpdates: () => geneRefDomain.checkUpdates(),
      update: () => geneRefDomain.update()
    },

    auth: {
      login: (username, password) => authDomain.login(username, password),
      logout: () => authDomain.logout(),
      currentUser: () => authDomain.currentUser(),
      isAccountsEnabled: () => authDomain.isAccountsEnabled(),
      createUser: (username, displayName, tempPassword) =>
        authDomain.createUser(username, displayName, tempPassword),
      listUsers: () => authDomain.listUsers(),
      deactivateUser: (username) => authDomain.deactivateUser(username),
      resetPassword: (username, newPassword) => authDomain.resetPassword(username, newPassword),
      changePassword: (oldPassword, newPassword) =>
        authDomain.changePassword(oldPassword, newPassword)
    } as WindowAPI['auth'],

    analysisGroups: {
      list: () => analysisGroupsDomain.list(),
      get: (id) => analysisGroupsDomain.get(id),
      create: (params) => analysisGroupsDomain.create(params),
      update: (id, params) => analysisGroupsDomain.update(id, params),
      delete: (id) => analysisGroupsDomain.delete(id),
      addMember: (params) => analysisGroupsDomain.addMember(params),
      removeMember: (groupId, caseId) => analysisGroupsDomain.removeMember(groupId, caseId),
      getForCase: (caseId) => analysisGroupsDomain.getForCase(caseId)
    } as WindowAPI['analysisGroups'],

    protein: {
      getMapping: (geneSymbol) => proteinDomain.getMapping(geneSymbol),
      getDomains: (uniprotAccession) => proteinDomain.getDomains(uniprotAccession),
      getStructure: (uniprotAccession) => proteinDomain.getStructure(uniprotAccession),
      getGeneStructure: (geneSymbol) => proteinDomain.getGeneStructure(geneSymbol)
    },

    gnomad: {
      getVariants: (geneSymbol, dataset) => gnomadDomain.getVariants(geneSymbol, dataset),
      getClinVarVariants: (geneSymbol, dataset) =>
        gnomadDomain.getClinVarVariants(geneSymbol, dataset)
    },

    presets: {
      list: () => filterPresetsDomain.list(),
      create: (params) => filterPresetsDomain.create(params),
      update: (id, updates) => filterPresetsDomain.update(id, updates),
      delete: (id) => filterPresetsDomain.delete(id),
      reorder: (items) => filterPresetsDomain.reorder(items)
    } as WindowAPI['presets']
  }
}
