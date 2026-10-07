import type {
  PanelWithCount,
  PanelRow,
  PanelGeneRow,
  ActivePanelRow,
  PanelAppSearchResult,
  PanelResolutionRequest,
  PanelResolutionStatus
} from '../../types/panels'
import type { GeneValidationResult, GeneAutocompleteResult } from '../../types/gene-reference'
import type { IpcResult } from '../../types/errors'

export interface PanelsDomainContract {
  list: () => Promise<IpcResult<PanelWithCount[]>>
  get: (id: number) => Promise<IpcResult<(PanelRow & { genes: PanelGeneRow[] }) | null>>
  create: (params: {
    name: string
    description?: string | null
    version?: string | null
    source?: string
    sourceId?: string | null
    sourceMetadata?: Record<string, unknown> | null
  }) => Promise<IpcResult<PanelRow>>
  update: (params: {
    id: number
    name?: string
    description?: string | null
    version?: string | null
  }) => Promise<IpcResult<PanelRow>>
  delete: (id: number) => Promise<IpcResult<{ success: boolean }>>
  duplicate: (id: number, newName: string) => Promise<IpcResult<PanelRow>>
  setGenes: (
    panelId: number,
    genes: Array<{ hgncId: string; symbol: string }>
  ) => Promise<IpcResult<{ success: boolean }>>
  getGenes: (panelId: number) => Promise<IpcResult<PanelGeneRow[]>>
  activate: (
    caseId: number,
    panelId: number,
    paddingBp?: number
  ) => Promise<IpcResult<{ success: boolean }>>
  deactivate: (caseId: number, panelId: number) => Promise<IpcResult<{ success: boolean }>>
  activeForCase: (caseId: number) => Promise<IpcResult<ActivePanelRow[]>>
  /**
   * Which genes of the given active panel(s) have no coordinates for the
   * genome build and are therefore NOT applied by the panel filter. Cheap and
   * side-effect free; the answer depends only on the request and the panels'
   * gene lists, so callers may cache it per request.
   */
  resolutionStatus: (request: PanelResolutionRequest) => Promise<IpcResult<PanelResolutionStatus>>
  validateSymbols: (symbols: string[]) => Promise<IpcResult<GeneValidationResult[]>>
  autocomplete: (query: string, limit?: number) => Promise<IpcResult<GeneAutocompleteResult[]>>
  searchPanelApp: (
    keyword: string,
    region: 'uk' | 'aus' | 'both'
  ) => Promise<IpcResult<PanelAppSearchResult[]>>
  importPanelApp: (params: {
    panelId: number
    region: 'uk' | 'aus'
    confidenceThreshold: 'green' | 'green_amber' | 'all'
    name?: string
  }) => Promise<IpcResult<PanelRow>>
  generateStringDb: (params: {
    seedGenes: string[]
    requiredScore: number
    networkType: 'physical' | 'functional'
    name?: string
  }) => Promise<IpcResult<PanelRow>>
  exportBed: (
    panelId: number,
    assembly: string,
    paddingBp: number
  ) => Promise<IpcResult<{ success: boolean; path?: string }>>
}
