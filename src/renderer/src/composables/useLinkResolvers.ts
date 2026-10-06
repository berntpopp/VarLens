/**
 * One URL resolver per link slot, shared by the case, cohort and shortlist
 * tables so all three resolve the user's external-link configuration the
 * same way (cohort parity).
 *
 * Column-attached links (chr, pos, clinvar, gene_symbol, omim_mim_number)
 * resolve under their column key; links configured as `virtual` resolve
 * under `_link_<id>` and render together in the single Links column.
 */
import { computed, type ComputedRef } from 'vue'
import { useExternalLinksStore, type ExternalLinkConfig } from '../stores/externalLinksStore'
import { resolveUrlTemplate, type GenomeBuild } from '../utils/externalLinks'
import { linkAbbreviation, linkOutKey } from '../utils/link-outs'

/** The row fields link templates may reference. */
export interface LinkSubject {
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol?: string | null
  omim_mim_number?: string | null
}

export type LinkResolver = (item: LinkSubject) => string | null

/** One icon link in the Links column. */
export interface LinkOutDef {
  /** Row-view-model key holding the resolved URL (`_link_<id>`). */
  key: string
  name: string
  abbreviation: string
}

export function buildLinkResolvers(
  links: readonly ExternalLinkConfig[],
  genomeBuild: GenomeBuild
): Record<string, LinkResolver> {
  const resolvers: Record<string, LinkResolver> = {}
  for (const link of links) {
    const key = link.column === 'virtual' ? linkOutKey(link.id) : link.column
    resolvers[key] = (item) =>
      resolveUrlTemplate(
        link.urlTemplate,
        {
          chr: item.chr ?? null,
          pos: item.pos ?? null,
          ref: item.ref ?? null,
          alt: item.alt ?? null,
          gene_symbol: item.gene_symbol ?? null,
          mim_number: item.omim_mim_number ?? null
        },
        genomeBuild,
        link.requiredFields
      )
  }
  return resolvers
}

export function buildLinkOutDefs(links: readonly ExternalLinkConfig[]): LinkOutDef[] {
  return links
    .filter((link) => link.column === 'virtual')
    .map((link) => ({
      key: linkOutKey(link.id),
      name: link.name,
      abbreviation: linkAbbreviation(link.id, link.name)
    }))
}

/** Resolve every enabled link of a row into a `{ slotKey: url }` map. */
export function resolveRowLinks(
  item: LinkSubject,
  resolvers: Readonly<Record<string, LinkResolver>>
): Record<string, string | null> {
  const links: Record<string, string | null> = {}
  for (const [key, resolve] of Object.entries(resolvers)) links[key] = resolve(item)
  return links
}

export function useLinkResolvers(): {
  resolvers: ComputedRef<Record<string, LinkResolver>>
  linkOuts: ComputedRef<LinkOutDef[]>
} {
  const linksStore = useExternalLinksStore()
  const resolvers = computed(() =>
    buildLinkResolvers(linksStore.enabledLinks, linksStore.genomeBuild)
  )
  const linkOuts = computed(() => buildLinkOutDefs(linksStore.enabledLinks))
  return { resolvers, linkOuts }
}
