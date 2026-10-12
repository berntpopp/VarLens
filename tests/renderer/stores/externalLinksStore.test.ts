import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useExternalLinksStore } from '../../../src/renderer/src/stores/externalLinksStore'

const OLD_UCSC =
  'https://genome.ucsc.edu/cgi-bin/hgTracks?db={build_ucsc}&position={chr}%3A{pos_start}-{pos_end}'

function ucscTemplateAfterLoading(stored: string): string | undefined {
  localStorage.setItem(
    'varlens_external_links',
    JSON.stringify([
      {
        id: 'ucsc',
        name: 'UCSC',
        urlTemplate: stored,
        column: 'chr',
        requiredFields: ['chr', 'pos'],
        enabled: false,
        isBuiltIn: true
      }
    ])
  )
  setActivePinia(createPinia())
  return useExternalLinksStore().links.find((l) => l.id === 'ucsc')?.urlTemplate
}

describe('external links store — stored UCSC template', () => {
  beforeEach(() => localStorage.clear())

  it('a stored retired default moves to {chr_ucsc}', () => {
    expect(ucscTemplateAfterLoading(OLD_UCSC)).toContain('position={chr_ucsc}')
  })

  it("a user's own edit of the template is kept", () => {
    const edited = 'https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position=chr{chr}'
    expect(ucscTemplateAfterLoading(edited)).toBe(edited)
  })
})
