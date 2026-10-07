export interface GenomicInterval {
  chr: string // chromosome name matching variant data format
  start: number // 1-based, with padding applied
  end: number // 1-based, with padding applied
}

export interface CreatePanelInput {
  name: string
  description?: string | null
  version?: string | null
  source: string
  sourceId?: string | null
  sourceMetadata?: Record<string, unknown> | null
}

export interface PanelRow {
  id: number
  name: string
  description: string | null
  version: string | null
  source: string
  source_id: string | null
  source_metadata: string | null
  created_at: number
  updated_at: number
}

export interface PanelWithCount extends PanelRow {
  gene_count: number
}

export interface PanelGeneRow {
  id: number
  panel_id: number
  hgnc_id: string
  symbol: string
}

export interface ActivePanelRow {
  case_id: number
  panel_id: number
  padding_bp: number
  activated_at: number
  panel_name: string
  gene_count: number
}

/** A panel gene that has no coordinates in the genome build being queried. */
export interface UnmappedPanelGene {
  hgncId: string
  symbol: string
}

/** Which panels to check, and for which genome build. */
export interface PanelResolutionRequest {
  /** The active panel ids, exactly as sent with the variant / cohort query. */
  panelIds: number[]
  /** Single-case view: the build of this case is used. */
  caseId?: number
  /** Cohort view: the selected build. Wins over `caseId` when both are set. */
  genomeBuild?: string
}

/**
 * How much of the active gene panel(s) could be turned into genomic regions
 * for a genome build. Genes listed in `unmappedGenes` are NOT part of the
 * panel restriction — the variant query runs without them.
 */
export interface PanelResolutionStatus {
  genomeBuild: string
  /** Distinct genes across the requested panels. */
  totalGenes: number
  unmappedCount: number
  /** Sorted by symbol, then HGNC id. */
  unmappedGenes: UnmappedPanelGene[]
}

export interface PanelAppSearchResult {
  id: number
  name: string
  version: string
  disease_group: string
  disease_sub_group: string
  status: string
  relevant_disorders: string[]
  stats: {
    number_of_genes: number
  }
  types: Array<{ name: string; slug: string }>
  region: 'uk' | 'aus'
}
