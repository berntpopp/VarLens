import {
  AutocompleteSchema,
  PanelAppImportSchema,
  PanelAppSearchSchema,
  PanelCreateSchema,
  PanelIdSchema,
  PanelUpdateSchema,
  StringDbGenerateSchema,
  ValidateSymbolsSchema
} from '../../../shared/types/ipc-schemas'
import {
  autocomplete,
  generateStringDbForSession,
  getPanelWithGenes,
  importPanelAppForSession,
  searchPanelApp,
  validateSymbols
} from '../../../main/ipc/handlers/panels-logic'
import { runReferenceLookup } from '../reference-services/route-helpers'
import { getWebGeneReferenceService } from '../web-gene-reference'
import { badRequest } from './common'
import type { OverrideHandler } from './types'

/** Web has no per-process panel interval cache to invalidate. */
const NO_CACHE = { clearPanelIntervalCache: () => undefined }

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

    // PanelApp / STRING: outbound lookups behind the egress policy
    // (services `panelapp` / `stringdb`, off by default). Panel creation and
    // symbol resolution reuse the desktop session helpers.
    'panels:searchPanelApp': {
      async handle(args, request, reply, deps) {
        const parsed = PanelAppSearchSchema.safeParse({
          keyword: args[0],
          region: args[1] ?? undefined
        })
        if (!parsed.success) {
          return badRequest(reply, 'invalid-panelapp-search', 'keyword must be 1-200 characters')
        }
        const { keyword, region } = parsed.data
        return await runReferenceLookup({
          deps,
          request,
          reply,
          service: 'panelapp',
          method: 'panels:searchPanelApp',
          identifier: `${region}:${keyword}`,
          run: (clients) => searchPanelApp(keyword, region, clients.panelApp())
        })
      }
    },

    'panels:importPanelApp': {
      async handle(args, request, reply, deps) {
        const parsed = PanelAppImportSchema.safeParse(args[0])
        if (!parsed.success) {
          return badRequest(reply, 'invalid-panelapp-import', 'Invalid PanelApp import parameters')
        }
        return await runReferenceLookup({
          deps,
          request,
          reply,
          service: 'panelapp',
          method: 'panels:importPanelApp',
          identifier: `${parsed.data.region}:${parsed.data.panelId}`,
          run: (clients) =>
            importPanelAppForSession(
              deps.session,
              parsed.data,
              getWebGeneReferenceService(),
              clients.panelApp(),
              NO_CACHE
            )
        })
      }
    },

    'panels:generateStringDb': {
      async handle(args, request, reply, deps) {
        const parsed = StringDbGenerateSchema.safeParse(args[0])
        if (!parsed.success) {
          return badRequest(reply, 'invalid-stringdb', 'Invalid STRING generation parameters')
        }
        return await runReferenceLookup({
          deps,
          request,
          reply,
          service: 'stringdb',
          method: 'panels:generateStringDb',
          identifier: parsed.data.seedGenes.join(','),
          run: (clients) =>
            generateStringDbForSession(
              deps.session,
              parsed.data,
              getWebGeneReferenceService(),
              clients.stringDb(),
              NO_CACHE
            )
        })
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
