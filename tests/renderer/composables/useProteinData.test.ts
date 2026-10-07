/**
 * useProteinData: the mapping of a gene, then the lookups that depend on it,
 * read from the query cache.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Pinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useProteinData } from '@renderer/composables/useProteinData'
import { installCapabilities } from '../helpers/capabilities'
import { createQueryPinia, withQueries } from '../helpers/with-queries'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const mappingOf = (gene: string) => ({
  success: true,
  mapping: { uniprotAccession: `P-${gene}`, proteinName: gene, proteinLength: 100 }
})
const notFound = { success: false, error: 'not found' }

describe('useProteinData', () => {
  const getMapping = vi.fn()
  const getDomains = vi.fn()
  const getStructure = vi.fn()
  const getGeneStructure = vi.fn()
  const hosts: Array<{ unmount: () => void }> = []
  let pinia: Pinia

  function mountProtein(gene: Ref<string | null> = ref('BRCA1')) {
    const host = withQueries(() => useProteinData(gene), pinia)
    hosts.push(host)
    return { ...host.result, gene }
  }

  beforeEach(() => {
    getMapping.mockReset().mockImplementation(async (gene: string) => mappingOf(gene))
    getDomains.mockReset().mockImplementation(async (accession: string) => ({
      success: true,
      domains: [{ name: accession }],
      proteinLength: 250
    }))
    getStructure
      .mockReset()
      .mockResolvedValue({ success: true, structure: { source: 'alphafold' } })
    getGeneStructure.mockReset().mockResolvedValue({ success: true, geneStructure: { exons: [] } })
    Object.assign(window, {
      api: { protein: { getMapping, getDomains, getStructure, getGeneStructure } }
    })
    pinia = createQueryPinia()
  })

  afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))

  it('loads the mapping, then what depends on it', async () => {
    const protein = mountProtein()
    expect(protein.loading.value).toBe(true)
    await flushPromises()

    expect(getDomains).toHaveBeenCalledExactlyOnceWith('P-BRCA1')
    expect(getStructure).toHaveBeenCalledExactlyOnceWith('P-BRCA1')
    expect(getGeneStructure).toHaveBeenCalledExactlyOnceWith('BRCA1')
    expect(protein.mapping.value?.uniprotAccession).toBe('P-BRCA1')
    expect(protein.domains.value).toEqual([{ name: 'P-BRCA1' }])
    expect(protein.proteinLength.value).toBe(250)
    expect(protein.structureInfo.value).toEqual({ source: 'alphafold' })
    expect(protein.geneStructure.value).toEqual({ exons: [] })
    expect(protein.loading.value).toBe(false)
    expect(protein.error.value).toBeNull()
  })

  it('reports a gene without a mapping and looks nothing else up', async () => {
    getMapping.mockResolvedValue(notFound)
    const protein = mountProtein()
    await flushPromises()

    expect(protein.error.value).toBe('not found')
    expect(protein.mapping.value).toBeNull()
    expect(protein.loading.value).toBe(false)
    expect(getDomains).not.toHaveBeenCalled()
    expect(getGeneStructure).not.toHaveBeenCalled()
  })

  it('falls back to the mapping length without domains and tolerates a missing structure', async () => {
    getDomains.mockResolvedValue(notFound)
    getStructure.mockRejectedValue(new Error('timeout'))
    getGeneStructure.mockResolvedValue(notFound)
    const protein = mountProtein()
    await flushPromises()

    expect(protein.error.value).toBeNull()
    expect(protein.domains.value).toEqual([])
    expect(protein.proteinLength.value).toBe(100)
    expect(protein.structureInfo.value).toBeNull()
    expect(protein.geneStructureError.value).toBe('not found')
    expect(protein.geneStructureLoading.value).toBe(false)
  })

  it('never shows the previous gene when its mapping arrives last', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    getMapping.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    const protein = mountProtein()
    await flushPromises()

    protein.gene.value = 'TP53'
    await flushPromises()
    resolveFirst(mappingOf('BRCA1'))
    await flushPromises()

    expect(protein.mapping.value?.uniprotAccession).toBe('P-TP53')
    expect(protein.domains.value).toEqual([{ name: 'P-TP53' }])
    expect(getDomains).not.toHaveBeenCalledWith('P-BRCA1')
  })

  it('shows nothing and is not loading without a gene', async () => {
    const protein = mountProtein()
    await flushPromises()

    protein.gene.value = null
    await flushPromises()
    expect(protein.mapping.value).toBeNull()
    expect(protein.domains.value).toEqual([])
    expect(protein.proteinLength.value).toBe(0)
    expect(protein.loading.value).toBe(false)
  })

  it('a gene seen before is shown from the cache without another lookup', async () => {
    const protein = mountProtein()
    await flushPromises()
    protein.gene.value = 'TP53'
    await flushPromises()

    protein.gene.value = 'BRCA1'
    await flushPromises()
    expect(protein.mapping.value?.uniprotAccession).toBe('P-BRCA1')
    expect(getMapping).toHaveBeenCalledTimes(2)
  })

  it('retry looks the failed gene up again, and what depends on it', async () => {
    getMapping.mockResolvedValueOnce(notFound)
    const protein = mountProtein()
    await flushPromises()
    expect(protein.error.value).toBe('not found')

    protein.refetch()
    await flushPromises()
    expect(protein.error.value).toBeNull()
    expect(protein.domains.value).toEqual([{ name: 'P-BRCA1' }])
  })

  it('web with protein lookups off: nothing is called', async () => {
    installCapabilities({ runtime: 'web' })
    const protein = mountProtein()
    await flushPromises()

    expect(getMapping).not.toHaveBeenCalled()
    expect(protein.loading.value).toBe(false)
  })
})
