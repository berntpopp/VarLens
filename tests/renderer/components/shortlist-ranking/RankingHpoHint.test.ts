import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import RankingHpoHint from '../../../../src/renderer/src/components/shortlist-ranking/RankingHpoHint.vue'
import type { EvidenceRuleset } from '../../../../src/shared/types/evidence-ruleset'
import type { HpoDataStatus } from '../../../../src/shared/types/hpo-data'

const ruleset = (when: string): EvidenceRuleset => ({
  version: 1,
  id: 'r',
  modes: [{ id: 'fallback', label: 'f', when: null, points: 0 }],
  groups: [
    { id: 'g', label: 'g', scope: 'global', rules: [{ id: 'a', label: 'a', when, points: 1 }] }
  ]
})
const status = (installed: boolean, needsUpdate = false): HpoDataStatus => ({
  installed,
  needsUpdate,
  version: installed ? 'v2026-09-01' : null,
  builtAt: null,
  termCount: 0,
  geneCount: 0
})

async function shown(when: string, current: HpoDataStatus): Promise<boolean> {
  ;(window as unknown as { api: unknown }).api = {
    hpoData: { status: vi.fn().mockResolvedValue(current) }
  }
  const wrapper = mount(RankingHpoHint, {
    props: { ruleset: ruleset(when) },
    global: { plugins: [createVuetify({ components })] }
  })
  await flushPromises()
  return wrapper.find('[data-testid="ranking-hpo-missing"]').exists()
}

describe('RankingHpoHint', () => {
  it('warns when a rule reads an HPO-derived column and HPO data is missing or outdated', async () => {
    expect(await shown('hpo_resnik:>=:2', status(false))).toBe(true)
    expect(await shown('cadd:>:1 OR hpo_resnik:>=:2', status(true, true))).toBe(true)
    expect(await shown('hpo_conflicts:>=:1', status(false))).toBe(true)
    expect(await shown('hpo_best_disease:~:OMIM', status(false))).toBe(true)
  })

  it('stays quiet when the data is current or no rule reads hpo_resnik', async () => {
    expect(await shown('hpo_resnik:>=:2', status(true))).toBe(false)
    expect(await shown('cadd:>:20', status(false))).toBe(false)
  })
})
