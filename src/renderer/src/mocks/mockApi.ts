/**
 * Mock API for browser development mode
 *
 * This provides a complete mock implementation of window.api
 * allowing the Vue renderer to run standalone in a browser
 * for rapid UI/UX iteration.
 */

import type { WindowAPI, CommentCategory } from '../../../shared/types/api'
import { mockCases } from './fixtures/cases'
import { mockVariants, mockFilterOptions } from './fixtures/variants'

// Mutable state for interactive development
let cases = [...mockCases]
const variants = [...mockVariants]

export const mockApi: WindowAPI = {
  cases: {
    list: async () => cases,
    query: async (params) => {
      let result = [...cases]
      if (params.search_term !== undefined && params.search_term !== '') {
        const q = params.search_term.toLowerCase()
        result = result.filter((c) => c.name.toLowerCase().includes(q))
      }
      const total_count = result.length
      const offset = params.offset ?? 0
      result = result.slice(offset, offset + params.limit)
      return {
        data: result.map((c) => ({
          ...c,
          cohort_names: [] as string[],
          cohort_ids: [] as number[],
          affected_status: null,
          sex: null
        })),
        total_count
      }
    },
    delete: async (id: number) => {
      cases = cases.filter((c) => c.id !== id)
    },
    deleteAll: async () => {
      const count = cases.length
      cases = []
      return count
    },
    deleteBatch: async (ids: number[]) => {
      const before = cases.length
      cases = cases.filter((c) => !ids.includes(c.id))
      return before - cases.length
    },
    availableBuilds: async () => [{ build: 'GRCh38', caseCount: cases.length }]
  },

  variants: {
    query: async (caseId, filters, offset, limit = 50) => {
      let filtered = variants.filter((v) => v.case_id === caseId)

      // Apply filters
      if (filters.gene_symbol !== undefined && filters.gene_symbol !== '') {
        const searchTerm = filters.gene_symbol.toLowerCase()
        filtered = filtered.filter((v) => {
          const gene = v.gene_symbol
          return gene !== undefined && gene !== null && gene.toLowerCase().includes(searchTerm)
        })
      }
      if (filters.consequences !== undefined && filters.consequences.length > 0) {
        filtered = filtered.filter((v) => filters.consequences!.includes(v.consequence ?? ''))
      }
      if (filters.funcs !== undefined && filters.funcs.length > 0) {
        filtered = filtered.filter((v) => filters.funcs!.includes(v.func ?? ''))
      }
      if (filters.clinvars !== undefined && filters.clinvars.length > 0) {
        filtered = filtered.filter((v) =>
          filters.clinvars!.some((clinvar) => (v.clinvar ?? '').includes(clinvar))
        )
      }
      if (filters.gnomad_af_max !== undefined) {
        filtered = filtered.filter(
          (v) =>
            v.gnomad_af === null ||
            v.gnomad_af === undefined ||
            v.gnomad_af <= filters.gnomad_af_max!
        )
      }
      if (filters.cadd_min !== undefined) {
        filtered = filtered.filter(
          (v) => v.cadd === null || v.cadd === undefined || v.cadd >= filters.cadd_min!
        )
      }

      // Pagination
      const startIndex = offset ?? 0
      const data = filtered.slice(startIndex, startIndex + limit)

      return {
        data,
        total_count: filtered.length
      }
    },
    geneSymbols: async (caseId: number, query: string, limit = 50) => {
      const queryLower = query.toLowerCase()
      const symbols = variants
        .filter((v) => v.case_id === caseId)
        .map((v) => v.gene_symbol)
        .filter((g): g is string => g != null && g.toLowerCase().includes(queryLower))
      return [...new Set(symbols)].slice(0, limit)
    },
    getFilterOptions: async () => mockFilterOptions,
    search: async (caseId, query, limit = 20) => {
      const searchLower = query.toLowerCase()
      const filtered = variants
        .filter((v) => v.case_id === caseId)
        .filter((v) => {
          const geneMatch =
            v.gene_symbol !== undefined &&
            v.gene_symbol !== null &&
            v.gene_symbol.toLowerCase().includes(searchLower)
          const chrMatch = v.chr.includes(query)
          const clinvarMatch =
            v.clinvar !== undefined &&
            v.clinvar !== null &&
            v.clinvar.toLowerCase().includes(searchLower)
          return geneMatch || chrMatch || clinvarMatch
        })
      return filtered.slice(0, limit)
    },
    typeCounts: async (caseId: number) => {
      const counts: Record<string, number> = {}
      for (const v of variants) {
        if (v.case_id !== caseId) continue
        const type = v.variant_type ?? 'snv'
        counts[type] = (counts[type] ?? 0) + 1
      }
      return counts
    }
  },

  import: {
    selectFile: async () => '/mock/selected/file.json',
    start: async () => ({
      caseId: cases.length + 1,
      variantCount: 1000,
      skipped: 0,
      errors: [],
      elapsed: 1500
    }),
    vcfPreview: async () => ({
      fileformat: 'VCFv4.2',
      samples: ['SAMPLE1'],
      variantCountEstimate: 100,
      annotationType: 'none',
      detectedGenomeBuild: 'GRCh38',
      infoFields: []
    }),
    onProgress: () => () => {},
    cancel: async () => {}
  },

  system: {
    getVersion: async () => ({ app: '0.6.0-mock', electron: 'browser-mode' }),
    getUserDataPath: async () => '/mock/user/data',
    getCpuCount: async () => 4,
    setWorkerThreads: async () => {},
    getWorkerThreads: async () => 0,
    getLogFilePath: async () => '/mock/logs/main.log'
  },

  export: {
    variants: async () => ({ success: true, filePath: '/mock/export.xlsx' }),
    cohort: async () => ({ success: true, filePath: '/mock/cohort_export.xlsx' })
  },

  shell: {
    openExternal: async (url) => {
      window.open(url, '_blank')
      return { success: true }
    },
    showItemInFolder: async () => {},
    updateDomains: async () => {}
  },

  database: {
    selectFile: async () => '/mock/database.db',
    selectSaveLocation: async () => '/mock/new-database.db',
    open: async () => ({
      success: true,
      info: { path: '/mock/database.db', name: 'Mock Database', encrypted: false }
    }),
    create: async () => ({
      success: true,
      info: { path: '/mock/new-database.db', name: 'New Mock Database', encrypted: false }
    }),
    rekey: async () => ({ success: true }),
    info: async () => ({ path: '/mock/database.db', name: 'Mock Database', encrypted: false }),
    recentList: async () => [
      { path: '/mock/database.db', name: 'Mock Database', lastOpened: Date.now() }
    ],
    getOverview: async () => ({
      summary: {
        total_cases: 0,
        total_variants: 0,
        unique_variants: 0,
        avg_variants_per_case: 0,
        genes_with_variants: 0,
        starred_variants: 0,
        acmg_counts: {
          pathogenic: 0,
          likely_pathogenic: 0,
          vus: 0,
          likely_benign: 0,
          benign: 0
        }
      },
      cases: [],
      cohortGroups: [],
      tags: [],
      topPhenotypes: []
    }),
    removeRecent: async () => ({ success: true }),
    deleteFile: async () => ({ success: true }),
    showInFolder: async () => ({ success: true })
  },

  batchImport: {
    selectFiles: async () => [],
    selectFolder: async () => [],
    checkDuplicates: async () => ({ files: [], duplicateCount: 0 }),
    start: async () => ({ succeeded: 0, failed: 0, skipped: 0, cancelled: false, details: [] }),
    cancel: async () => {},
    onProgress: () => () => {},
    onComplete: () => () => {},
    selectZip: async () => null,
    testZipPassword: async () => ({ success: false }),
    extractZip: async () => ({ files: [], errors: [] }),
    cleanupZipTemp: async () => {}
  },

  cohort: {
    getVariants: async (params?: {
      search_term?: string
      sort_by?: string
      sort_order?: 'asc' | 'desc'
      limit?: number
      offset?: number
      // Extended filter parameters
      gene_symbol?: string
      consequences?: string[]
      funcs?: string[]
      clinvars?: string[]
      gnomad_af_max?: number
      cadd_min?: number
      max_internal_af?: number
      carrier_count_min?: number
    }) => {
      // Aggregate variants by (chr, pos, ref, alt)
      const variantMap = new Map<
        string,
        {
          chr: string
          pos: number
          ref: string
          alt: string
          gene_symbol: string | null
          cdna: string | null
          aa_change: string | null
          consequence: string | null
          func: string | null
          clinvar: string | null
          gnomad_af: number | null
          cadd_phred: number | null
          transcript: string | null
          omim_id: string | null
          carriers: Array<{ case_id: number; gt_num: string }>
        }
      >()

      for (const v of variants) {
        const key = `${v.chr}:${v.pos}:${v.ref}:${v.alt}`
        if (!variantMap.has(key)) {
          variantMap.set(key, {
            chr: v.chr,
            pos: v.pos,
            ref: v.ref,
            alt: v.alt,
            gene_symbol: v.gene_symbol ?? null,
            cdna: v.cdna ?? null,
            aa_change: v.aa_change ?? null,
            consequence: v.consequence ?? null,
            func: v.func ?? null,
            clinvar: v.clinvar ?? null,
            gnomad_af: v.gnomad_af ?? null,
            cadd_phred: v.cadd ?? null,
            transcript: v.transcript ?? null,
            omim_id: v.omim_mim_number ?? null,
            carriers: []
          })
        }
        const entry = variantMap.get(key)!
        // Only add if this case isn't already a carrier (dedupe per case)
        if (!entry.carriers.some((c) => c.case_id === v.case_id)) {
          entry.carriers.push({ case_id: v.case_id, gt_num: v.gt_num ?? '0/1' })
        }
        // Update annotation values if they were null but this variant has them
        if (entry.consequence === null && v.consequence !== undefined) {
          entry.consequence = v.consequence
        }
        if (entry.func === null && v.func !== undefined) entry.func = v.func
        if (entry.clinvar === null && v.clinvar !== undefined) entry.clinvar = v.clinvar
        if (entry.gnomad_af === null && v.gnomad_af !== undefined) entry.gnomad_af = v.gnomad_af
        if (entry.cadd_phred === null && v.cadd !== undefined) entry.cadd_phred = v.cadd
        if (entry.transcript === null && v.transcript !== undefined) entry.transcript = v.transcript
        if (entry.omim_id === null && v.omim_mim_number !== undefined)
          entry.omim_id = v.omim_mim_number
      }

      const totalCases = cases.length

      // Convert to CohortVariant array with annotation columns
      let cohortVariants = Array.from(variantMap.entries()).map(([key, v]) => {
        const hetCount = v.carriers.filter((c) => c.gt_num === '0/1').length
        const homCount = v.carriers.filter((c) => c.gt_num === '1/1').length
        return {
          chr: v.chr,
          pos: v.pos,
          ref: v.ref,
          alt: v.alt,
          gene_symbol: v.gene_symbol,
          cdna: v.cdna,
          aa_change: v.aa_change,
          carrier_count: v.carriers.length,
          total_cases: totalCases,
          cohort_frequency: totalCases > 0 ? v.carriers.length / totalCases : 0,
          het_count: hetCount,
          hom_count: homCount,
          variant_key: key,
          // Annotation columns
          consequence: v.consequence,
          func: v.func,
          clinvar: v.clinvar,
          gnomad_af: v.gnomad_af,
          cadd_phred: v.cadd_phred,
          transcript: v.transcript,
          omim_id: v.omim_id
        }
      })

      // Apply search filter
      if (params?.search_term !== undefined && params.search_term !== '') {
        const term = params.search_term.toLowerCase()
        cohortVariants = cohortVariants.filter((v) => {
          const geneMatch = v.gene_symbol?.toLowerCase().includes(term) ?? false
          const chrPosMatch = `${v.chr}:${v.pos}`.includes(term)
          const cdnaMatch = v.cdna?.toLowerCase().includes(term) ?? false
          const aaMatch = v.aa_change?.toLowerCase().includes(term) ?? false
          return geneMatch || chrPosMatch || cdnaMatch || aaMatch
        })
      }

      // Apply gene symbol filter
      if (params?.gene_symbol !== undefined && params.gene_symbol !== '') {
        cohortVariants = cohortVariants.filter(
          (v) => v.gene_symbol?.toLowerCase() === params.gene_symbol!.toLowerCase()
        )
      }

      // Apply consequence/impact filter
      if (params?.consequences !== undefined && params.consequences.length > 0) {
        cohortVariants = cohortVariants.filter(
          (v) => v.consequence !== null && params.consequences!.includes(v.consequence)
        )
      }

      // Apply func filter
      if (params?.funcs !== undefined && params.funcs.length > 0) {
        cohortVariants = cohortVariants.filter(
          (v) => v.func !== null && params.funcs!.includes(v.func)
        )
      }

      // Apply clinvar filter (partial matching to match production behavior with LIKE %value%)
      if (params?.clinvars !== undefined && params.clinvars.length > 0) {
        cohortVariants = cohortVariants.filter(
          (v) =>
            v.clinvar !== null && params.clinvars!.some((clinvar) => v.clinvar!.includes(clinvar))
        )
      }

      // Apply gnomAD AF max filter (include null as rare)
      if (params?.gnomad_af_max !== undefined && params.gnomad_af_max > 0) {
        cohortVariants = cohortVariants.filter(
          (v) => v.gnomad_af === null || v.gnomad_af <= params.gnomad_af_max!
        )
      }

      // Apply CADD min filter (include null)
      if (params?.cadd_min !== undefined && params.cadd_min >= 0) {
        cohortVariants = cohortVariants.filter(
          (v) => v.cadd_phred === null || v.cadd_phred >= params.cadd_min!
        )
      }

      // Apply max internal AF filter (NULL-inclusive)
      if (params?.max_internal_af !== undefined && params.max_internal_af > 0) {
        cohortVariants = cohortVariants.filter(
          (v) => v.cohort_frequency === null || v.cohort_frequency <= params.max_internal_af!
        )
      }

      // Apply carrier count min filter
      if (params?.carrier_count_min !== undefined && params.carrier_count_min > 0) {
        cohortVariants = cohortVariants.filter((v) => v.carrier_count >= params.carrier_count_min!)
      }

      const totalCount = cohortVariants.length

      // Apply sorting
      const sortBy = params?.sort_by ?? 'carrier_count'
      const sortOrder = params?.sort_order ?? 'desc'
      cohortVariants.sort((a, b) => {
        let aVal: string | number | null
        let bVal: string | number | null

        switch (sortBy) {
          case 'chr':
            aVal = a.chr
            bVal = b.chr
            break
          case 'pos':
            aVal = a.pos
            bVal = b.pos
            break
          case 'gene_symbol':
            aVal = a.gene_symbol ?? ''
            bVal = b.gene_symbol ?? ''
            break
          case 'carrier_count':
            aVal = a.carrier_count
            bVal = b.carrier_count
            break
          case 'cohort_frequency':
            aVal = a.cohort_frequency
            bVal = b.cohort_frequency
            break
          case 'het_count':
            aVal = a.het_count
            bVal = b.het_count
            break
          case 'hom_count':
            aVal = a.hom_count
            bVal = b.hom_count
            break
          case 'consequence':
            aVal = a.consequence ?? ''
            bVal = b.consequence ?? ''
            break
          case 'clinvar':
            aVal = a.clinvar ?? ''
            bVal = b.clinvar ?? ''
            break
          case 'gnomad_af':
            aVal = a.gnomad_af ?? 0
            bVal = b.gnomad_af ?? 0
            break
          case 'cadd_phred':
            aVal = a.cadd_phred ?? 0
            bVal = b.cadd_phred ?? 0
            break
          default:
            aVal = a.carrier_count
            bVal = b.carrier_count
        }

        if (aVal === null) return sortOrder === 'asc' ? -1 : 1
        if (bVal === null) return sortOrder === 'asc' ? 1 : -1
        if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
        if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
        return 0
      })

      // Apply pagination
      const offset = params?.offset ?? 0
      const limit = params?.limit ?? 50
      const paginatedData = cohortVariants.slice(offset, offset + limit)

      return { data: paginatedData, total_count: totalCount }
    },

    getSummary: async () => {
      // Calculate unique variants (distinct chr:pos:ref:alt)
      const uniqueKeys = new Set(variants.map((v) => `${v.chr}:${v.pos}:${v.ref}:${v.alt}`))
      const uniqueGenes = new Set(
        variants.map((v) => v.gene_symbol).filter((g): g is string => g !== undefined && g !== null)
      )

      return {
        total_cases: cases.length,
        total_variants: variants.length,
        unique_variants: uniqueKeys.size,
        avg_variants_per_case: cases.length > 0 ? variants.length / cases.length : 0,
        genes_with_variants: uniqueGenes.size,
        starred_variants: 0,
        acmg_counts: {
          pathogenic: 0,
          likely_pathogenic: 0,
          vus: 0,
          likely_benign: 0,
          benign: 0
        }
      }
    },

    getCarriers: async (chr: string, pos: number, ref: string, alt: string) => {
      // Find all cases carrying this specific variant
      const carriers = variants
        .filter((v) => v.chr === chr && v.pos === pos && v.ref === ref && v.alt === alt)
        .map((v) => {
          const caseInfo = cases.find((c) => c.id === v.case_id)
          return {
            case_id: v.case_id,
            case_name: caseInfo?.name ?? `Case ${v.case_id}`,
            gt_num: v.gt_num ?? '0/1'
          }
        })
      return carriers
    },

    getGeneBurden: async () => {
      // Aggregate per-gene statistics
      const geneMap = new Map<
        string,
        {
          variants: Set<string>
          cases: Set<number>
          totalObservations: number
        }
      >()

      for (const v of variants) {
        const gene = v.gene_symbol
        if (gene === undefined || gene === null) continue

        if (!geneMap.has(gene)) {
          geneMap.set(gene, { variants: new Set(), cases: new Set(), totalObservations: 0 })
        }
        const entry = geneMap.get(gene)!
        entry.variants.add(`${v.chr}:${v.pos}:${v.ref}:${v.alt}`)
        entry.cases.add(v.case_id)
        entry.totalObservations++
      }

      const totalCases = cases.length

      return Array.from(geneMap.entries())
        .map(([gene, data]) => ({
          gene_symbol: gene,
          variant_count: data.totalObservations,
          unique_variant_count: data.variants.size,
          affected_case_count: data.cases.size,
          total_cases: totalCases
        }))
        .sort((a, b) => b.affected_case_count - a.affected_case_count)
    },
    getColumnMeta: async () => [],
    getSummaryStatus: async () => ({
      is_stale: false,
      last_rebuilt_at: Math.floor(Date.now() / 1000)
    }),
    rebuildSummary: async () => {},
    onSummaryRebuilt: () => () => {},
    runAssociation: async () => ({
      results: [],
      warnings: [],
      elapsed_ms: 0,
      primary_test: 'fisher'
    }),
    cancelAssociation: async () => {},
    onAssociationProgress: () => () => {}
  },

  annotations: {
    getGlobal: async () => null,
    upsertGlobal: async (chr, pos, ref, alt, updates) => ({
      id: 1,
      chr,
      pos,
      ref,
      alt,
      global_comment: updates.global_comment ?? null,
      starred: updates.starred === true ? 1 : 0,
      acmg_classification: updates.acmg_classification ?? null,
      acmg_evidence: updates.acmg_evidence ?? null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    deleteGlobal: async () => {},
    getPerCase: async () => null,
    upsertPerCase: async (caseId, variantId, updates) => ({
      id: 1,
      case_id: caseId,
      variant_id: variantId,
      per_case_comment: updates.per_case_comment ?? null,
      starred: updates.starred === true ? 1 : 0,
      acmg_classification: updates.acmg_classification ?? null,
      acmg_evidence: updates.acmg_evidence ?? null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    deletePerCase: async () => {},
    getForVariant: async () => ({ global: null, perCase: null }),
    batchGet: async () => ({})
  },

  vep: {
    fetch: async () => ({
      success: false as const,
      error: 'Mock mode - VEP not available',
      offline: true
    }),
    cancel: async () => {},
    clearCache: async () => ({ success: true }),
    getCacheStats: async () => ({ vepCount: 0, hpoCount: 0, totalBytes: 0 })
  },

  hpo: {
    search: async (query) => ({
      success: true,
      terms: [
        { id: 'HP:0001250', name: 'Seizure', matchType: 'exact' as const },
        { id: 'HP:0001249', name: 'Intellectual disability', matchType: 'partial' as const }
      ].filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
    }),
    clearCache: async () => ({ success: true })
  },

  myvariant: {
    fetch: async () => ({
      success: false as const,
      error: 'Mock mode - MyVariant not available',
      offline: true
    }),
    clearCache: async () => ({ success: true })
  },

  spliceai: {
    fetch: async () => ({
      success: false as const,
      error: 'Mock mode - SpliceAI not available',
      offline: true
    }),
    clearCache: async () => ({ success: true })
  },

  caseMetadata: {
    get: async () => null,
    upsert: async (caseId, updates) => ({
      id: 1,
      case_id: caseId,
      affected_status: updates.affected_status ?? null,
      sex: updates.sex ?? null,
      notes: updates.notes ?? null,
      age: updates.age ?? null,
      date_of_birth: updates.date_of_birth ?? null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    getFullMetadata: async () => ({
      metadata: null,
      cohorts: [],
      hpoTerms: [],
      comments: [],
      metrics: [],
      dataInfo: null,
      externalIds: []
    }),
    listCohorts: async () => [],
    createCohort: async (name, description) => ({
      id: 1,
      name,
      description: description ?? null,
      created_at: Date.now()
    }),
    updateCohort: async (cohortId, updates) => ({
      id: cohortId,
      name: updates.name ?? 'Group',
      description: updates.description ?? null,
      created_at: Date.now()
    }),
    deleteCohort: async () => {},
    getCohortByName: async () => null,
    getCaseCohorts: async () => [],
    assignCohort: async () => {},
    removeCohort: async () => {},
    setCohorts: async () => {},
    getHpoTerms: async () => [],
    assignHpoTerm: async (caseId, hpoId, hpoLabel) => ({
      id: 1,
      case_id: caseId,
      hpo_id: hpoId,
      hpo_label: hpoLabel,
      created_at: Date.now()
    }),
    removeHpoTerm: async () => {},
    getDataInfo: async () => null,
    upsertDataInfo: async (_caseId: number) =>
      ({
        id: 1,
        case_id: _caseId,
        import_file_name: null,
        import_file_type: null,
        platform: null,
        platform_details: null,
        af_filter: null,
        gene_list_filter: null,
        region_filter: null,
        quality_filter: null,
        data_notes: null,
        gene_list_id: null,
        region_file_id: null,
        created_at: Date.now(),
        updated_at: Date.now()
      }) as import('../../../shared/types/api').CaseDataInfo,
    listExternalIds: async () => [],
    upsertExternalId: async (_caseId: number, idType: string, idValue: string) =>
      ({
        id: 1,
        case_id: _caseId,
        id_type: idType,
        id_value: idValue,
        created_at: Date.now()
      }) as import('../../../shared/types/api').CaseExternalId,
    deleteExternalId: async () => {},
    distinctHpoTerms: async () => [],
    distinctPlatforms: async () => [],
    distinctExternalIdTypes: async () => []
  },

  caseComments: {
    list: async () => [],
    create: async (_caseId: number, category: CommentCategory, content: string) => ({
      id: 1,
      case_id: _caseId,
      category,
      content,
      created_at: Date.now(),
      updated_at: null
    }),
    update: async (commentId: number, content: string) => ({
      id: commentId,
      case_id: 1,
      category: 'Clinical Note' as const,
      content,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    delete: async () => {}
  },

  caseMetrics: {
    listDefinitions: async () => [],
    createDefinition: async (
      name: string,
      valueType: 'numeric' | 'text' | 'date',
      unit: string,
      category: string
    ) => ({
      id: 1,
      name,
      value_type: valueType,
      unit,
      category,
      is_predefined: 0,
      created_at: Date.now()
    }),
    listForCase: async () => [],
    upsert: async (_caseId: number, metricId: number) => ({
      id: 1,
      case_id: _caseId,
      metric_id: metricId,
      numeric_value: null,
      text_value: null,
      date_value: null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    delete: async () => {}
  },

  transcripts: {
    list: async () => [],
    switch: async () => ({ success: true }),
    insertAndSwitch: async () => ({ success: true })
  },

  tags: {
    list: async () => [
      { id: 1, name: 'Candidate', color: '#4CAF50', created_at: Date.now() },
      { id: 2, name: 'Review', color: '#FF9800', created_at: Date.now() },
      { id: 3, name: 'Excluded', color: '#F44336', created_at: Date.now() }
    ],
    create: async (name, color) => ({ id: Date.now(), name, color, created_at: Date.now() }),
    update: async (id, updates) => ({
      id,
      name: updates.name ?? 'Tag',
      color: updates.color ?? '#000000',
      created_at: Date.now()
    }),
    delete: async () => {},
    getUsageCount: async () => 0,
    getVariantTags: async () => [],
    assignVariantTag: async () => {},
    removeVariantTag: async () => {},
    setVariantTags: async () => {}
  },

  logs: {
    onMessage: () => () => {}
  },

  updater: {
    checkForUpdate: async () => {},
    downloadUpdate: async () => {},
    installUpdate: async () => {},
    getStatus: async () => ({ state: 'idle' as const }),
    onStatusChange: () => () => {}
  },

  geneLists: {
    list: async () => [],
    create: async (name: string, description?: string | null) => ({
      id: 1,
      name,
      description: description ?? null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    delete: async () => {},
    getGenes: async () => [],
    setGenes: async () => []
  },

  regionFiles: {
    list: async () => [],
    create: async (name: string, description: string | null) => ({
      id: 1,
      name,
      description,
      region_count: 0,
      total_bases: 0,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    delete: async () => {},
    importBed: async (_fileId: number) => ({
      id: 1,
      name: 'Mock',
      description: null,
      region_count: 0,
      total_bases: 0,
      created_at: Date.now(),
      updated_at: Date.now()
    })
  },

  panels: {
    list: async () => [],
    get: async () => null,
    create: async (params: { name: string }) => ({
      id: 1,
      name: params.name,
      description: null,
      version: null,
      source: 'manual',
      source_id: null,
      source_metadata: null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    update: async (params: { id: number; name?: string }) => ({
      id: params.id,
      name: params.name ?? 'Panel',
      description: null,
      version: null,
      source: 'manual',
      source_id: null,
      source_metadata: null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    delete: async () => ({ success: true }),
    duplicate: async () => ({
      id: 2,
      name: 'Copy',
      description: null,
      version: null,
      source: 'manual',
      source_id: null,
      source_metadata: null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    setGenes: async () => ({ success: true }),
    getGenes: async () => [],
    activate: async () => ({ success: true }),
    deactivate: async () => ({ success: true }),
    activeForCase: async () => [],
    validateSymbols: async () => [],
    autocomplete: async () => [],
    searchPanelApp: async () => [],
    importPanelApp: async () => ({
      id: 1,
      name: 'Imported Panel',
      description: null,
      version: null,
      source: 'panelapp_uk',
      source_id: null,
      source_metadata: null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    generateStringDb: async () => ({
      id: 1,
      name: 'Generated Panel',
      description: null,
      version: null,
      source: 'stringdb',
      source_id: null,
      source_metadata: null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    exportBed: async () => ({ success: true, path: '/tmp/mock.bed' })
  },

  geneRef: {
    info: async () => ({
      geneCount: 0,
      aliasCount: 0,
      coordinateCount: 0,
      assemblies: [],
      builtAt: 0
    }),
    assemblies: async () => [],
    checkUpdates: async () => ({
      currentBuiltAt: 0,
      daysSinceBuilt: 0,
      needsUpdate: false
    }),
    update: async () => ({ success: true, message: 'Updated' })
  },

  audit: {
    getByEntity: async () => [],
    query: async () => ({ data: [], total_count: 0 })
  },

  auth: {
    login: async () => ({ success: true, user: { id: 1, username: 'demo', role: 'admin' } }),
    logout: async () => {},
    currentUser: async () => ({ id: 1, username: 'demo', role: 'admin' }),
    isAccountsEnabled: async () => false,
    createUser: async () => {},
    listUsers: async () => [],
    deactivateUser: async () => {},
    resetPassword: async () => {},
    changePassword: async () => {}
  },

  presets: {
    list: async () => [],
    create: async (params) => ({
      id: 1,
      name: params.name,
      description: params.description ?? null,
      filterJson: params.filterJson,
      isBuiltIn: false,
      isVisible: true,
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }),
    update: async (_id, updates) => ({
      id: _id,
      name: updates.name ?? 'Preset',
      description: updates.description ?? null,
      filterJson: updates.filterJson ?? {},
      isBuiltIn: false,
      isVisible: updates.isVisible ?? true,
      sortOrder: updates.sortOrder ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }),
    delete: async () => {},
    reorder: async () => {}
  },

  analysisGroups: {
    list: async () => [],
    get: async (id) => ({
      id,
      name: 'Mock Family',
      group_type: 'family',
      description: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      members: []
    }),
    create: async (params) => ({
      id: 1,
      name: params.name,
      group_type: params.groupType ?? 'family',
      description: params.description ?? null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    update: async (id, params) => ({
      id,
      name: params.name ?? 'Mock Family',
      group_type: 'family',
      description: params.description ?? null,
      created_at: Date.now(),
      updated_at: Date.now()
    }),
    delete: async () => {},
    addMember: async (params) => ({
      id: 1,
      group_id: params.groupId,
      case_id: params.caseId,
      role: params.role,
      affected_status: params.affectedStatus ?? 'unknown',
      individual_id: params.individualId ?? null
    }),
    removeMember: async () => {},
    getForCase: async () => null
  },

  protein: {
    getMapping: async () => ({
      success: false as const,
      error: 'Mock mode - Protein API not available'
    }),
    getDomains: async () => ({
      success: false as const,
      error: 'Mock mode - Protein API not available'
    }),
    getStructure: async () => ({
      success: false as const,
      error: 'Mock mode - Protein API not available'
    }),
    getGeneStructure: async () => ({
      success: false as const,
      error: 'Mock mode - Gene structure API not available'
    })
  },

  gnomad: {
    getVariants: async () => ({
      success: false as const,
      error: 'Mock mode - gnomAD API not available'
    }),
    getClinVarVariants: async () => ({
      success: false as const,
      error: 'Mock mode - ClinVar API not available'
    })
  },

  perf: {
    reportInteractive: () => {}
  }
}
