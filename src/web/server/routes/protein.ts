import { z } from 'zod'
import type { FastifyReply, FastifyRequest } from 'fastify'

import {
  buildGeneStructureFixtureResponse,
  buildProteinDomainsFixtureResponse,
  buildProteinMappingFixtureResponse,
  buildProteinStructureFixtureResponse,
  webParityFixturesEnabled
} from '../api-fixture-responses'
import { runReferenceLookup } from '../reference-services/route-helpers'
import type { ReferenceClients } from '../reference-services/reference-services'
import { badRequest } from './common'
import type { DispatcherDeps, OverrideHandler } from './types'

/** Same bounds as the desktop protein handlers (src/main/ipc/handlers/protein.ts). */
const GeneSymbolSchema = z.string().min(1).max(50)
const UniProtAccessionSchema = z.string().regex(/^[A-Z0-9]{6,10}$/i)

type Kind = 'gene' | 'accession'

/**
 * Protein view data (UniProt mapping, InterPro domains, AlphaFold structure,
 * Ensembl gene structure) in web mode, behind the egress policy (service
 * `protein`, off by default). Parity-fixture mode answers from fixtures.
 */
function proteinMethod(
  method: string,
  kind: Kind,
  fixture: (id: string) => unknown,
  run: (clients: ReferenceClients, id: string) => Promise<unknown>
): OverrideHandler {
  return {
    async handle(args, request: FastifyRequest, reply: FastifyReply, deps: DispatcherDeps) {
      const schema = kind === 'gene' ? GeneSymbolSchema : UniProtAccessionSchema
      const parsed = schema.safeParse(args[0])
      if (!parsed.success) {
        return kind === 'gene'
          ? badRequest(reply, 'invalid-protein-gene', 'gene symbol must be a string')
          : badRequest(reply, 'invalid-protein-accession', 'UniProt accession must be a string')
      }
      const id = parsed.data
      if (webParityFixturesEnabled()) return fixture(id)
      return await runReferenceLookup({
        deps,
        request,
        reply,
        service: 'protein',
        method,
        identifier: id,
        run: (clients) => run(clients, id)
      })
    }
  }
}

export function buildProteinOverrides(): Record<string, OverrideHandler> {
  return {
    'protein:getMapping': proteinMethod(
      'protein:getMapping',
      'gene',
      buildProteinMappingFixtureResponse,
      (clients, gene) => clients.uniprot().fetchProteinMapping(gene)
    ),
    'protein:getDomains': proteinMethod(
      'protein:getDomains',
      'accession',
      buildProteinDomainsFixtureResponse,
      (clients, accession) => clients.interpro().fetchDomains(accession)
    ),
    'protein:getStructure': proteinMethod(
      'protein:getStructure',
      'accession',
      buildProteinStructureFixtureResponse,
      (clients, accession) => clients.alphafold().fetchStructure(accession)
    ),
    'protein:getGeneStructure': proteinMethod(
      'protein:getGeneStructure',
      'gene',
      buildGeneStructureFixtureResponse,
      (clients, gene) => clients.ensembl().fetchGeneStructure(gene)
    )
  }
}
