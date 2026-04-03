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
