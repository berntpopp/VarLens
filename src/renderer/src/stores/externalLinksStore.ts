/**
 * Pinia store for external link configurations
 * Manages configurable external database links with localStorage persistence
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { GenomeBuild } from '../utils/externalLinks'
import { logService } from '../services/LogService'

const STORAGE_KEY = 'varlens_external_links'

/** Where a link appears in the variant table */
export type LinkColumn = 'pos' | 'chr' | 'clinvar' | 'gene_symbol' | 'omim_mim_number' | 'virtual'

/** Configuration for a single external link */
export interface ExternalLinkConfig {
  /** Unique identifier */
  id: string
  /** Display name (e.g., "gnomAD", "ClinVar") */
  name: string
  /** URL template with variable placeholders */
  urlTemplate: string
  /** Which column this link attaches to (virtual = own column at end) */
  column: LinkColumn
  /** Which variant fields are required for this link */
  requiredFields: string[]
  /** Whether this link is currently enabled */
  enabled: boolean
  /** Whether this is a built-in default link (cannot be deleted) */
  isBuiltIn: boolean
}

/**
 * Default link configurations matching current hardcoded behavior
 */
function getDefaultLinks(): ExternalLinkConfig[] {
  return [
    {
      id: 'gnomad',
      name: 'gnomAD',
      urlTemplate:
        'https://gnomad.broadinstitute.org/variant/{chr}-{pos}-{ref}-{alt}?dataset={dataset_gnomad}',
      column: 'pos',
      requiredFields: ['chr', 'pos', 'ref', 'alt'],
      enabled: true,
      isBuiltIn: true
    },
    {
      id: 'ucsc',
      name: 'UCSC',
      urlTemplate:
        'https://genome.ucsc.edu/cgi-bin/hgTracks?db={build_ucsc}&position={chr}%3A{pos_start}-{pos_end}',
      column: 'chr',
      requiredFields: ['chr', 'pos'],
      enabled: true,
      isBuiltIn: true
    },
    {
      id: 'clinvar',
      name: 'ClinVar',
      urlTemplate: 'https://www.ncbi.nlm.nih.gov/clinvar/?term={chr}%3A{pos}%3A{ref}%3A{alt}',
      column: 'clinvar',
      requiredFields: ['chr', 'pos', 'ref', 'alt'],
      enabled: true,
      isBuiltIn: true
    },
    {
      id: 'varsome',
      name: 'VarSome',
      urlTemplate: 'https://varsome.com/variant/{build_ucsc}/{chr}-{pos}-{ref}-{alt}',
      column: 'virtual',
      requiredFields: ['chr', 'pos', 'ref', 'alt'],
      enabled: true,
      isBuiltIn: true
    },
    {
      id: 'franklin',
      name: 'Franklin',
      urlTemplate:
        'https://franklin.genoox.com/clinical-db/variant/snp/chr{chr}-{pos}-{ref}-{alt}/{build}',
      column: 'virtual',
      requiredFields: ['chr', 'pos', 'ref', 'alt'],
      enabled: true,
      isBuiltIn: true
    },
    {
      id: 'pubtator',
      name: 'PubTator',
      urlTemplate: 'https://www.ncbi.nlm.nih.gov/research/pubtator3/docsum?text={gene}',
      column: 'virtual',
      requiredFields: ['gene'],
      enabled: true,
      isBuiltIn: true
    },
    {
      id: 'litvar',
      name: 'LitVar',
      urlTemplate:
        'https://www.ncbi.nlm.nih.gov/research/litvar2/docsum?text={chr}:{pos}:{ref}:{alt}',
      column: 'virtual',
      requiredFields: ['chr', 'pos', 'ref', 'alt'],
      enabled: true,
      isBuiltIn: true
    },
    {
      id: 'decipher',
      name: 'DECIPHER',
      urlTemplate: 'https://www.deciphergenomics.org/gene/{gene}/overview/clinical-info',
      column: 'virtual',
      requiredFields: ['gene'],
      enabled: true,
      isBuiltIn: true
    },
    {
      id: 'clingen',
      name: 'ClinGen',
      urlTemplate: 'https://search.clinicalgenome.org/kb/genes/{gene}',
      column: 'virtual',
      requiredFields: ['gene'],
      enabled: true,
      isBuiltIn: true
    },
    {
      id: 'ensembl',
      name: 'Ensembl',
      urlTemplate:
        'https://grch37.ensembl.org/Homo_sapiens/Location/View?r={chr}:{pos_start}-{pos_end}',
      column: 'virtual',
      requiredFields: ['chr', 'pos'],
      enabled: true,
      isBuiltIn: true
    }
  ]
}

/**
 * Load link configurations from localStorage
 */
function loadLinks(): ExternalLinkConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      const parsed = JSON.parse(stored) as ExternalLinkConfig[]

      // Ensure all built-in links are present (user may have updated the app)
      const defaults = getDefaultLinks()
      const defaultIds = new Set(defaults.map((l) => l.id))
      const storedIds = new Set(parsed.map((l) => l.id))

      // Start with stored links
      const merged = [...parsed]

      // Add any missing built-in links
      for (const defaultLink of defaults) {
        if (!storedIds.has(defaultLink.id)) {
          merged.push(defaultLink)
        }
      }

      // Remove any built-in links that no longer exist in defaults
      const result = merged.filter((link) => !link.isBuiltIn || defaultIds.has(link.id))

      return result
    }
  } catch (error) {
    logService.warn(
      'Failed to load external links from localStorage: ' +
        (error instanceof Error ? error.message : String(error)),
      'settings'
    )
  }
  return getDefaultLinks()
}

/**
 * Save link configurations to localStorage
 */
function saveLinks(links: ExternalLinkConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links))
  } catch (error) {
    logService.warn(
      'Failed to save external links to localStorage: ' +
        (error instanceof Error ? error.message : String(error)),
      'settings'
    )
  }
}

/**
 * External links store using setup store pattern
 */
export const useExternalLinksStore = defineStore('externalLinks', () => {
  // State
  const links = ref<ExternalLinkConfig[]>(loadLinks())
  const genomeBuild = ref<GenomeBuild>('GRCh37')

  // Computed
  const enabledLinks = computed(() => links.value.filter((link) => link.enabled))

  const linksByColumn = computed(() => {
    return (column: LinkColumn): ExternalLinkConfig[] => {
      return enabledLinks.value.filter((link) => link.column === column)
    }
  })

  const virtualLinks = computed(() => {
    return enabledLinks.value.filter((link) => link.column === 'virtual')
  })

  const configuredDomains = computed(() => {
    const domains = new Set<string>()
    for (const link of enabledLinks.value) {
      try {
        // Extract domain from template by replacing variables with dummy values
        const dummyUrl = link.urlTemplate.replace(/\{[^}]+\}/g, 'x')
        const url = new URL(dummyUrl)
        domains.add(url.hostname)
      } catch {
        // Skip invalid templates
      }
    }
    return Array.from(domains)
  })

  // Persist and sync after any mutation — replaces the expensive deep watcher
  function _persistAndSync(): void {
    saveLinks(links.value)
    syncDomains()
  }

  // Actions
  function updateLink(id: string, updates: Partial<ExternalLinkConfig>): void {
    const index = links.value.findIndex((link) => link.id === id)
    if (index !== -1) {
      links.value[index] = { ...links.value[index], ...updates }
      _persistAndSync()
    }
  }

  function toggleLink(id: string): void {
    const index = links.value.findIndex((l) => l.id === id)
    if (index !== -1) {
      links.value[index] = { ...links.value[index], enabled: !links.value[index].enabled }
      _persistAndSync()
    }
  }

  function addCustomLink(config: Omit<ExternalLinkConfig, 'id' | 'isBuiltIn'>): void {
    const id = crypto.randomUUID()
    links.value = [
      ...links.value,
      {
        ...config,
        id,
        isBuiltIn: false
      }
    ]
    _persistAndSync()
  }

  function removeLink(id: string): void {
    const link = links.value.find((l) => l.id === id)
    if (link !== undefined && !link.isBuiltIn) {
      links.value = links.value.filter((l) => l.id !== id)
      _persistAndSync()
    }
  }

  function resetToDefaults(): void {
    links.value = getDefaultLinks()
    _persistAndSync()
  }

  function setGenomeBuild(build: GenomeBuild): void {
    genomeBuild.value = build
  }

  function syncDomains(): void {
    if (typeof window.api === 'undefined') return
    const domains = configuredDomains.value
    window.api.shell.updateDomains(domains)
  }

  // Initial sync
  syncDomains()

  return {
    links,
    genomeBuild,
    enabledLinks,
    linksByColumn,
    virtualLinks,
    configuredDomains,
    updateLink,
    toggleLink,
    addCustomLink,
    removeLink,
    resetToDefaults,
    setGenomeBuild,
    syncDomains
  }
})
