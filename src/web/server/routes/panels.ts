import {
  AutocompleteSchema,
  PanelCreateSchema,
  PanelExportBedSchema,
  PanelIdSchema,
  PanelUpdateSchema,
  ValidateSymbolsSchema
} from '../../../shared/types/ipc-schemas'
import {
  autocomplete,
  generateBedContentForSession,
  getPanelWithGenes,
  validateSymbols
} from '../../../main/ipc/handlers/panels-logic'
import { getWebGeneReferenceService } from '../web-gene-reference'
import { PANEL_BED_DOWNLOAD_PATH } from '../panel-bed-download'
import { badRequest } from './common'
import type { OverrideHandler } from './types'

export function buildPanelOverrides(): Record<string, OverrideHandler> {
  return {
    'panels:get': {
      async handle(args, _request, reply, { session }) {
        const [id] = args
        const validated = PanelIdSchema.safeParse(id)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-panel-id' }
        }
        return await getPanelWithGenes(validated.data, () => session)
      }
    },

    // Symbol validation / autocomplete read the bundled gene reference DB
    // (same GeneReferenceDb service as desktop). Args mirror the renderer
    // contract: validateSymbols(symbols[]), autocomplete(query, limit?).
    'panels:validateSymbols': {
      handle(args, _request, reply) {
        const validated = ValidateSymbolsSchema.safeParse({ symbols: args[0] })
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-symbols', message: 'symbols must be an array of strings' }
        }
        return validateSymbols(validated.data.symbols, getWebGeneReferenceService())
      }
    },

    'panels:autocomplete': {
      handle(args, _request, reply) {
        // JSON turns an omitted `limit` into null; treat it as absent so the default applies.
        const validated = AutocompleteSchema.safeParse({
          query: args[0],
          limit: args[1] ?? undefined
        })
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-autocomplete', message: 'query must be 1-100 characters' }
        }
        return autocomplete(
          validated.data.query,
          validated.data.limit,
          getWebGeneReferenceService()
        )
      }
    },

    // A browser has no save-dialog path: the RPC validates the export (panel,
    // genes, coordinates) and returns the download URL as `path`; the web
    // client (src/web/client/panel-bed-download.ts) navigates to it.
    'panels:exportBed': {
      async handle(args, _request, reply, { session }) {
        const parsed = PanelExportBedSchema.safeParse({
          panelId: args[0],
          assembly: args[1],
          paddingBp: args[2] ?? undefined
        })
        if (!parsed.success) {
          return badRequest(reply, 'invalid-panel-bed', 'Invalid BED export parameters')
        }
        const { panelId, assembly, paddingBp } = parsed.data
        await generateBedContentForSession(
          session,
          panelId,
          assembly,
          paddingBp,
          getWebGeneReferenceService()
        )
        const query = new URLSearchParams({
          panelId: String(panelId),
          assembly,
          paddingBp: String(paddingBp)
        })
        return { success: true, path: `${PANEL_BED_DOWNLOAD_PATH}?${query.toString()}` }
      }
    },

    // Validate like desktop so schema defaults apply (source = 'manual'); the
    // raw write autoroute let `source: undefined` hit the NOT NULL column.
    'panels:create': {
      async handle(args, _request, reply, { session }) {
        const validated = PanelCreateSchema.safeParse(args[0])
        if (!validated.success) {
          return badRequest(reply, 'invalid-panel-create', 'Invalid panel parameters')
        }
        return await session
          .getWriteExecutor()
          .execute({ type: 'panels:create', params: [validated.data] })
      }
    },

    'panels:update': {
      async handle(args, _request, reply, { session }) {
        const [params] = args
        const validated = PanelUpdateSchema.safeParse(params)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-panel-update' }
        }
        return await session.getWriteExecutor().execute({
          type: 'panels:update',
          params: [
            validated.data.id,
            {
              name: validated.data.name,
              description: validated.data.description,
              version: validated.data.version
            }
          ]
        })
      }
    }
  }
}
