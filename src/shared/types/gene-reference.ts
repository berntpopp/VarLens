export interface GeneValidationResult {
  input: string
  status: 'approved' | 'alias' | 'ambiguous' | 'unknown'
  symbol?: string
  hgncId?: string
  name?: string
  locusGroup?: string
  currentSymbol?: string
  aliasType?: string
  candidates?: Array<{ symbol: string; hgncId: string }>
}

export interface GeneAutocompleteResult {
  symbol: string
  hgncId: string
  name: string
  locusGroup: string
  matchType: 'symbol' | 'alias'
  matchedAlias?: string
}

export interface GeneCoordinates {
  hgncId: string
  assembly: string
  chromosome: string
  start_pos: number
  end_pos: number
  strand: string
}

export interface AssemblyInfo {
  id: string
  display_name: string
  aliases: string[]
  source_version: string
}

export interface GeneRefInfo {
  geneCount: number
  aliasCount: number
  coordinateCount: number
  assemblies: string[]
  builtAt: number
}
