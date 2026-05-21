import { mainLogger } from '../../services/MainLogger'
import type { z } from 'zod'
import type { GeneReferenceDb } from '../../database/GeneReferenceDb'
import type { PanelAppClient, PanelAppPanel } from '../../services/api/PanelAppClient'
import type { StringDbClient } from '../../services/api/StringDbClient'
import type { StorageSession } from '../../storage/session'
import type { CreatePanelInput, PanelGeneRow, PanelRow } from '../../../shared/types/panels'
import type { PanelAppImportSchema } from '../../../shared/types/ipc-schemas'
import type { PanelCacheCallbacks } from './panels-logic'

const GREEN_LEVELS = new Set(['3', '4', 'green'])
const GREEN_AMBER_LEVELS = new Set(['2', '3', '4', 'green', 'amber'])

interface ResolvedGene {
  hgncId: string
  symbol: string
}

interface ValidationResult {
  status: string
  hgncId?: string
  symbol?: string
  currentSymbol?: string
}

type PanelAppImportParams = z.infer<typeof PanelAppImportSchema>

function resolveValidatedGenes(validationResults: ValidationResult[]): ResolvedGene[] {
  const resolved: ResolvedGene[] = []
  const seenHgnc = new Set<string>()

  for (const result of validationResults) {
    const hgncId = result.hgncId
    const symbol =
      result.status === 'approved'
        ? result.symbol
        : result.status === 'alias'
          ? result.currentSymbol
          : undefined

    if (hgncId !== undefined && symbol !== undefined && !seenHgnc.has(hgncId)) {
      seenHgnc.add(hgncId)
      resolved.push({ hgncId, symbol })
    }
  }

  return resolved
}

async function createPanelWithGenes(
  session: StorageSession,
  input: CreatePanelInput,
  genes: ResolvedGene[],
  callbacks: PanelCacheCallbacks
): Promise<PanelRow & { genes: PanelGeneRow[] }> {
  const createdPanel = (await session
    .getWriteExecutor()
    .execute({ type: 'panels:create', params: [input] })) as PanelRow

  if (genes.length > 0) {
    await session
      .getWriteExecutor()
      .execute({ type: 'panels:setGenes', params: [createdPanel.id, genes] })
  }

  const panelGenes = (await session
    .getReadExecutor()
    .execute({ type: 'panels:getGenes', params: [createdPanel.id] })) as PanelGeneRow[]

  callbacks.clearPanelIntervalCache()
  return { ...createdPanel, genes: panelGenes }
}

export async function importPanelAppForSession(
  session: StorageSession,
  params: PanelAppImportParams,
  geneRef: GeneReferenceDb,
  client: PanelAppClient,
  callbacks: PanelCacheCallbacks
): Promise<PanelRow & { genes: PanelGeneRow[] }> {
  const panel: PanelAppPanel = await client.getPanel(params.panelId, params.region)
  const confidenceSet =
    params.confidenceThreshold === 'green'
      ? GREEN_LEVELS
      : params.confidenceThreshold === 'green_amber'
        ? GREEN_AMBER_LEVELS
        : null
  const filteredGenes =
    confidenceSet === null
      ? panel.genes
      : panel.genes.filter((gene) => confidenceSet.has(gene.confidence_level))
  const symbols = filteredGenes.map((gene) => gene.gene_data.gene_symbol)
  const resolvedGenes = resolveValidatedGenes(geneRef.validateSymbols(symbols))
  const source = params.region === 'uk' ? 'panelapp_uk' : 'panelapp_aus'

  return createPanelWithGenes(
    session,
    {
      name: params.name ?? `${panel.name} (PanelApp ${params.region.toUpperCase()})`,
      description: `Imported from PanelApp ${params.region.toUpperCase()} v${panel.version}`,
      version: panel.version,
      source,
      sourceId: String(params.panelId),
      sourceMetadata: {
        confidence_threshold: params.confidenceThreshold,
        total_genes: panel.genes.length,
        filtered_genes: filteredGenes.length,
        resolved_genes: resolvedGenes.length,
        panel_version: panel.version
      }
    },
    resolvedGenes,
    callbacks
  )
}

export async function generateStringDbForSession(
  session: StorageSession,
  params: {
    seedGenes: string[]
    requiredScore: number
    networkType: 'physical' | 'functional'
    name?: string
  },
  geneRef: GeneReferenceDb,
  client: StringDbClient,
  callbacks: PanelCacheCallbacks
): Promise<PanelRow & { genes: PanelGeneRow[] }> {
  const partners = await client.getInteractionPartners(params.seedGenes, {
    requiredScore: params.requiredScore,
    networkType: params.networkType
  })
  const allSymbols = [...params.seedGenes, ...partners.map((partner) => partner.symbol)]
  const resolvedGenes = resolveValidatedGenes(geneRef.validateSymbols(allSymbols))

  return createPanelWithGenes(
    session,
    {
      name:
        params.name ??
        `StringDB Network (${params.seedGenes.slice(0, 3).join(', ')}${
          params.seedGenes.length > 3 ? '...' : ''
        })`,
      description: `Generated from StringDB ${params.networkType} network (score >= ${params.requiredScore})`,
      source: 'stringdb',
      sourceMetadata: {
        seed_genes: params.seedGenes,
        score_threshold: params.requiredScore,
        network_type: params.networkType,
        partners_found: partners.length
      }
    },
    resolvedGenes,
    callbacks
  )
}

export async function generateBedContentForSession(
  session: StorageSession,
  panelId: number,
  assembly: string,
  paddingBp: number,
  geneRef: GeneReferenceDb
): Promise<{ lines: string[]; panelName: string; geneCount: number }> {
  const panel = (await session.getReadExecutor().execute({
    type: 'panels:get',
    params: [panelId]
  })) as PanelRow | null
  if (panel === null) throw new Error(`Panel ${panelId} not found`)

  const genes = (await session.getReadExecutor().execute({
    type: 'panels:getGenes',
    params: [panelId]
  })) as PanelGeneRow[]
  if (genes.length === 0) {
    throw new Error('Panel has no genes to export')
  }

  const coordsMap = geneRef.getCoordinatesForGenes(
    genes.map((gene) => gene.hgnc_id),
    assembly
  )
  if (coordsMap.size === 0) {
    throw new Error(`No coordinates found for assembly ${assembly}`)
  }

  const lines = [`track name="${panel.name}" description="Gene panel: ${panel.name}"`]
  for (const gene of genes) {
    const coords = coordsMap.get(gene.hgnc_id)
    if (coords === undefined) continue

    const chr = coords.chromosome.startsWith('chr') ? coords.chromosome : `chr${coords.chromosome}`
    const bedStart = Math.max(0, coords.start_pos - 1 - paddingBp)
    const bedEnd = coords.end_pos + paddingBp
    lines.push(`${chr}\t${bedStart}\t${bedEnd}\t${gene.symbol}`)
  }

  mainLogger.info(
    `Generated BED content for panel "${panel.name}" (${coordsMap.size} genes)`,
    'panels'
  )

  return { lines, panelName: panel.name, geneCount: coordsMap.size }
}
