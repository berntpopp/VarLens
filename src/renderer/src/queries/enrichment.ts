/**
 * On-demand annotation of one variant by external services. Each provider is
 * its own query, so one failing or being switched off does not affect the
 * others. The main process caches these lookups and reports whether an answer
 * came from its cache, so every request is passed on to it.
 */
import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import { ALWAYS_STALE } from './client'
import { canQueryFeature, queryApi } from './gate'
import { queryKeys } from './keys'

export interface EnrichmentTarget {
  chr: string
  pos: number
  ref: string
  alt: string
}

/** `null` while nothing has been requested: the query is then disabled. */
type Requested = EnrichmentTarget | null

const NOTHING: EnrichmentTarget = { chr: '', pos: 0, ref: '', alt: '' }
const id = (t: Requested): string => (t === null ? '' : `${t.chr}:${t.pos}:${t.ref}:${t.alt}`)

export const vepQuery = defineQueryOptions((target: Requested) => {
  const { chr, pos, ref, alt } = target ?? NOTHING
  return {
    key: queryKeys.enrichment('vep', id(target)),
    query: async () => unwrapIpcResult(await queryApi().vep.fetch(chr, pos, ref, alt)),
    enabled: target !== null && canQueryFeature('vepEnrichment'),
    staleTime: ALWAYS_STALE
  }
})

export const myvariantQuery = defineQueryOptions((target: Requested) => {
  const { chr, pos, ref, alt } = target ?? NOTHING
  return {
    key: queryKeys.enrichment('myvariant', id(target)),
    query: async () => unwrapIpcResult(await queryApi().myvariant.fetch(chr, pos, ref, alt)),
    enabled: target !== null && canQueryFeature('myvariantEnrichment'),
    staleTime: ALWAYS_STALE
  }
})

export const spliceaiQuery = defineQueryOptions((target: Requested) => {
  const { chr, pos, ref, alt } = target ?? NOTHING
  return {
    key: queryKeys.enrichment('spliceai', id(target)),
    query: async () => unwrapIpcResult(await queryApi().spliceai.fetch(chr, pos, ref, alt)),
    enabled: target !== null && canQueryFeature('spliceaiEnrichment'),
    staleTime: ALWAYS_STALE
  }
})
