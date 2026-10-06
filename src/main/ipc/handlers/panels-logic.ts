/**
 * Pure business logic for panels IPC handlers.
 *
 * All functions take explicit dependencies (db, geneRef, clients) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import { mainLogger } from '../../services/MainLogger'
import type { DatabaseService } from '../../database/DatabaseService'
import type { CreatePanelInput } from '../../database/PanelRepository'
import type { GeneReferenceDb } from '../../database/GeneReferenceDb'
import type { PanelAppClient } from '../../services/api/PanelAppClient'
import type { StringDbClient } from '../../services/api/StringDbClient'
import type { StorageSession } from '../../storage/session'

// Session-based (backend-neutral) panel creation from external sources and
// BED generation, shared by desktop-on-Postgres and the web server.
export {
  importPanelAppForSession,
  generateStringDbForSession,
  generateBedContentForSession
} from './panels-session'

/** Confidence levels considered "green" (high confidence) */
const GREEN_LEVELS = new Set(['3', '4', 'green'])

/** Confidence levels considered "green + amber" (medium-high confidence) */
const GREEN_AMBER_LEVELS = new Set(['2', '3', '4', 'green', 'amber'])

/** Callback for clearing panel interval cache after mutations. */
export interface PanelCacheCallbacks {
  clearPanelIntervalCache: () => void
}

// ============================================================
// Panel CRUD
// ============================================================

export function listPanels(getDb: () => DatabaseService): unknown {
  const db = getDb()
  return db.panels.listPanels()
}

export function getPanel(id: number, getDb: () => DatabaseService): unknown {
  const db = getDb()
  const panel = db.panels.getPanel(id)
  if (!panel) return null
  const genes = db.panels.getGenes(id)
  return { ...panel, genes }
}

/**
 * Session-based variant of getPanel: fetches panel + genes via the storage
 * executor so it works on both the Postgres and SQLite backends without
 * branching on session.capabilities.backend.
 */
export async function getPanelWithGenes(
  id: number,
  getSession: () => StorageSession
): Promise<unknown> {
  const session = getSession()
  const panel = await session.getReadExecutor().execute({ type: 'panels:get', params: [id] })
  if (panel === null) return null
  const genes = await session.getReadExecutor().execute({ type: 'panels:getGenes', params: [id] })
  return { ...(panel as object), genes }
}

export function createPanel(
  params: CreatePanelInput,
  getDb: () => DatabaseService,
  callbacks: PanelCacheCallbacks
): unknown {
  const db = getDb()
  const result = db.panels.createPanel(params)
  callbacks.clearPanelIntervalCache()
  return result
}

export function updatePanel(
  data: { id: number; [key: string]: unknown },
  getDb: () => DatabaseService,
  callbacks: PanelCacheCallbacks
): unknown {
  const { id, ...updates } = data
  const db = getDb()
  const result = db.panels.updatePanel(id, updates)
  callbacks.clearPanelIntervalCache()
  return result
}

export function deletePanel(
  id: number,
  getDb: () => DatabaseService,
  callbacks: PanelCacheCallbacks
): { success: boolean } {
  const db = getDb()
  db.panels.deletePanel(id)
  callbacks.clearPanelIntervalCache()
  return { success: true }
}

export function duplicatePanel(id: number, newName: string, getDb: () => DatabaseService): unknown {
  const db = getDb()
  return db.panels.duplicatePanel(id, newName)
}

// ============================================================
// Panel Genes
// ============================================================

export function setGenes(
  panelId: number,
  genes: Array<{ hgncId: string; symbol: string }>,
  getDb: () => DatabaseService,
  callbacks: PanelCacheCallbacks
): { success: boolean } {
  const db = getDb()
  db.panels.setGenes(panelId, genes)
  callbacks.clearPanelIntervalCache()
  return { success: true }
}

export function getGenes(panelId: number, getDb: () => DatabaseService): unknown {
  const db = getDb()
  return db.panels.getGenes(panelId)
}

// ============================================================
// Panel Activation (per-case)
// ============================================================

export function activatePanel(
  caseId: number,
  panelId: number,
  paddingBp: number,
  getDb: () => DatabaseService
): { success: boolean } {
  const db = getDb()
  db.panels.activatePanel(caseId, panelId, paddingBp)
  return { success: true }
}

export function deactivatePanel(
  caseId: number,
  panelId: number,
  getDb: () => DatabaseService
): { success: boolean } {
  const db = getDb()
  db.panels.deactivatePanel(caseId, panelId)
  return { success: true }
}

export function getActivePanelsForCase(caseId: number, getDb: () => DatabaseService): unknown {
  const db = getDb()
  return db.panels.getActivePanelsForCase(caseId)
}

// ============================================================
// Gene Reference Queries
// ============================================================

export function validateSymbols(symbols: string[], geneRef: GeneReferenceDb): unknown {
  return geneRef.validateSymbols(symbols)
}

export function autocomplete(query: string, limit: number, geneRef: GeneReferenceDb): unknown {
  return geneRef.autocomplete(query, limit)
}

// ============================================================
// PanelApp / StringDB Integration
// ============================================================

export async function searchPanelApp(
  keyword: string,
  region: 'uk' | 'aus' | 'both',
  client: PanelAppClient
): Promise<unknown> {
  return client.searchPanels(keyword, region)
}

/** Resolved gene with HGNC ID and symbol. */
interface ResolvedGene {
  hgncId: string
  symbol: string
}

/**
 * Resolve validated gene symbols to HGNC IDs and current approved symbols.
 * Skips ambiguous and unknown genes.
 */
function resolveValidatedGenes(
  validationResults: Array<{
    status: string
    hgncId?: string
    symbol?: string
    currentSymbol?: string
  }>
): ResolvedGene[] {
  const resolved: ResolvedGene[] = []
  for (const result of validationResults) {
    if (
      result.status === 'approved' &&
      result.hgncId !== undefined &&
      result.symbol !== undefined
    ) {
      resolved.push({ hgncId: result.hgncId, symbol: result.symbol })
    } else if (
      result.status === 'alias' &&
      result.hgncId !== undefined &&
      result.currentSymbol !== undefined
    ) {
      resolved.push({ hgncId: result.hgncId, symbol: result.currentSymbol })
    }
  }
  return resolved
}

/**
 * Import a panel from PanelApp: fetch, filter by confidence, validate genes, create panel.
 */
export async function importPanelApp(
  params: {
    panelId: number
    region: 'uk' | 'aus'
    confidenceThreshold: string
    name?: string
  },
  getDb: () => DatabaseService,
  geneRef: GeneReferenceDb,
  client: PanelAppClient,
  callbacks: PanelCacheCallbacks
): Promise<unknown> {
  const { panelId, region, confidenceThreshold, name } = params

  // 1. Fetch full panel from PanelApp
  const panel = await client.getPanel(panelId, region)

  // 2. Filter genes by confidence level
  const confidenceSet =
    confidenceThreshold === 'green'
      ? GREEN_LEVELS
      : confidenceThreshold === 'green_amber'
        ? GREEN_AMBER_LEVELS
        : null // 'all' = no filter

  const filteredGenes = confidenceSet
    ? panel.genes.filter((g) => confidenceSet.has(g.confidence_level))
    : panel.genes

  // 3. Validate gene symbols against gene reference DB
  const symbols = filteredGenes.map((g) => g.gene_data.gene_symbol)
  const validationResults = geneRef.validateSymbols(symbols)
  const resolvedGenes = resolveValidatedGenes(validationResults)

  // 4. Create panel in DB
  const db = getDb()
  const source = region === 'uk' ? 'panelapp_uk' : 'panelapp_aus'
  const createdPanel = db.panels.createPanel({
    name: name ?? `${panel.name} (PanelApp ${region.toUpperCase()})`,
    description: `Imported from PanelApp ${region.toUpperCase()} v${panel.version}`,
    version: panel.version,
    source,
    sourceId: String(panelId),
    sourceMetadata: {
      confidence_threshold: confidenceThreshold,
      total_genes: panel.genes.length,
      filtered_genes: filteredGenes.length,
      resolved_genes: resolvedGenes.length,
      panel_version: panel.version
    }
  })

  // 5. Set genes
  if (resolvedGenes.length > 0) {
    db.panels.setGenes(createdPanel.id, resolvedGenes)
  }

  const genes = db.panels.getGenes(createdPanel.id)
  callbacks.clearPanelIntervalCache()
  return { ...createdPanel, genes }
}

/**
 * Generate a panel from StringDB interaction network.
 */
export async function generateStringDb(
  params: {
    seedGenes: string[]
    requiredScore: number
    networkType: 'physical' | 'functional'
    name?: string
  },
  getDb: () => DatabaseService,
  geneRef: GeneReferenceDb,
  client: StringDbClient,
  callbacks: PanelCacheCallbacks
): Promise<unknown> {
  const { seedGenes, requiredScore, networkType, name } = params

  // 1. Query StringDB for interaction partners
  const partners = await client.getInteractionPartners(seedGenes, {
    requiredScore,
    networkType
  })

  // 2. Validate all genes (seed + partners) against gene reference DB
  const allSymbols = [...seedGenes, ...partners.map((p) => p.symbol)]
  const validationResults = geneRef.validateSymbols(allSymbols)

  // Build resolved genes (deduplicated by HGNC ID)
  const resolvedGenes: ResolvedGene[] = []
  const seenHgnc = new Set<string>()

  for (const result of validationResults) {
    let hgncId: string | undefined
    let symbol: string | undefined

    if (
      result.status === 'approved' &&
      result.hgncId !== undefined &&
      result.symbol !== undefined
    ) {
      hgncId = result.hgncId
      symbol = result.symbol
    } else if (
      result.status === 'alias' &&
      result.hgncId !== undefined &&
      result.currentSymbol !== undefined
    ) {
      hgncId = result.hgncId
      symbol = result.currentSymbol
    }

    if (hgncId !== undefined && symbol !== undefined && !seenHgnc.has(hgncId)) {
      seenHgnc.add(hgncId)
      resolvedGenes.push({ hgncId, symbol })
    }
  }

  // 3. Create panel
  const db = getDb()
  const createdPanel = db.panels.createPanel({
    name:
      name ??
      `StringDB Network (${seedGenes.slice(0, 3).join(', ')}${seedGenes.length > 3 ? '...' : ''})`,
    description: `Generated from StringDB ${networkType} network (score >= ${requiredScore})`,
    source: 'stringdb',
    sourceMetadata: {
      seed_genes: seedGenes,
      score_threshold: requiredScore,
      network_type: networkType,
      partners_found: partners.length
    }
  })

  // 4. Set genes
  if (resolvedGenes.length > 0) {
    db.panels.setGenes(createdPanel.id, resolvedGenes)
  }

  const genes = db.panels.getGenes(createdPanel.id)
  callbacks.clearPanelIntervalCache()
  return { ...createdPanel, genes }
}

// ============================================================
// BED File Export (logic only — dialog + file write stay in handler)
// ============================================================

/** Result of BED content generation. */
export interface BedContent {
  lines: string[]
  panelName: string
  geneCount: number
}

/**
 * Generate BED file content for a panel's genes.
 * Returns the BED lines; file dialog and write are handled by the caller.
 */
export function generateBedContent(
  panelId: number,
  assembly: string,
  paddingBp: number,
  getDb: () => DatabaseService,
  geneRef: GeneReferenceDb
): BedContent {
  const db = getDb()
  const panel = db.panels.getPanel(panelId)
  if (!panel) throw new Error(`Panel ${panelId} not found`)

  const genes = db.panels.getGenes(panelId)
  if (genes.length === 0) {
    throw new Error('Panel has no genes to export')
  }

  // Get coordinates from gene reference DB
  const hgncIds = genes.map((g) => g.hgnc_id)
  const coordsMap = geneRef.getCoordinatesForGenes(hgncIds, assembly)

  if (coordsMap.size === 0) {
    throw new Error(`No coordinates found for assembly ${assembly}`)
  }

  // Build BED lines (0-based half-open format)
  const bedLines: string[] = []
  bedLines.push(`track name="${panel.name}" description="Gene panel: ${panel.name}"`)

  for (const gene of genes) {
    const coords = coordsMap.get(gene.hgnc_id)
    if (!coords) continue

    const chr = coords.chromosome.startsWith('chr') ? coords.chromosome : `chr${coords.chromosome}`
    const bedStart = Math.max(0, coords.start_pos - 1 - paddingBp)
    const bedEnd = coords.end_pos + paddingBp

    bedLines.push(`${chr}\t${bedStart}\t${bedEnd}\t${gene.symbol}`)
  }

  mainLogger.info(
    `Generated BED content for panel "${panel.name}" (${coordsMap.size} genes)`,
    'panels'
  )

  return { lines: bedLines, panelName: panel.name, geneCount: coordsMap.size }
}
