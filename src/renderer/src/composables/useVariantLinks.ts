/**
 * Composable for variant external link resolution
 *
 * Encapsulates link resolution logic: building URLs from variant data,
 * finding links for columns, and opening external links with feedback.
 */

import { ref } from 'vue'
import { useApiService } from './useApiService'
import { useExternalLinksStore, type ExternalLinkConfig } from '../stores/externalLinksStore'
import { resolveUrlTemplate, buildOmimUrl, type VariantLinkData } from '../utils/externalLinks'
import type { Variant } from '../../../shared/types/api'

interface SnackbarState {
  visible: boolean
  message: string
  color: string
}

export function useVariantLinks() {
  const { api } = useApiService()
  const linksStore = useExternalLinksStore()

  // Snackbar state for error feedback
  const snackbar = ref<SnackbarState>({
    visible: false,
    message: '',
    color: 'error'
  })

  /** Extract link-relevant data from a variant row */
  const getVariantLinkData = (item: Variant): VariantLinkData => ({
    chr: item.chr,
    pos: item.pos,
    ref: item.ref,
    alt: item.alt,
    gene_symbol: item.gene_symbol ?? null,
    mim_number: item.omim_mim_number ?? null
  })

  /** Build OMIM entry URL from a MIM number */
  const buildOmimEntryUrl = (mimNumber: string | null): string | null => {
    return buildOmimUrl(mimNumber)
  }

  /** Resolve a link by ID for a given variant */
  const resolveLink = (linkId: string, item: Variant): string | null => {
    const link = linksStore.enabledLinks.find((l) => l.id === linkId)
    if (link === undefined) return null
    return resolveUrlTemplate(
      link.urlTemplate,
      getVariantLinkData(item),
      linksStore.genomeBuild,
      link.requiredFields
    )
  }

  /** Find the enabled link config for a given column */
  const getLinkForColumn = (column: string): ExternalLinkConfig | null => {
    return linksStore.enabledLinks.find((l) => l.column === column) ?? null
  }

  /** Open external link with visual feedback and error handling */
  const openExternalLink = async (url: string, event?: MouseEvent): Promise<void> => {
    if (!url) return

    // Brief highlight on clicked element
    const target = event?.currentTarget as HTMLElement
    if (target !== null && target !== undefined) {
      target.classList.add('external-link--clicked')

      setTimeout(() => target.classList.remove('external-link--clicked'), 200)
    }

    if (api) {
      try {
        const result = await api.shell.openExternal(url)
        if (!result.success) {
          snackbar.value = { visible: true, message: 'Could not open link', color: 'error' }
        }
      } catch (error) {
        console.error('Failed to open external link:', error)
        snackbar.value = { visible: true, message: 'Could not open link', color: 'error' }
      }
    }
  }

  return {
    linksStore,
    snackbar,
    getVariantLinkData,
    buildOmimEntryUrl,
    resolveLink,
    getLinkForColumn,
    openExternalLink
  }
}
