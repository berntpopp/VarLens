/**
 * ShortlistRankingDialog and its sections, mounted against a mocked preset
 * store: list and locked built-ins, editing, field errors, keyboard reorder,
 * group add, save gating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { computed, ref, type Ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import type { FilterPreset } from '../../../../src/shared/types/filter-presets'
import type { ShortlistConfig } from '../../../../src/shared/types/shortlist'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../../src/shared/config/evidence-rulesets/varvis-template'

let presets: Ref<FilterPreset[]>
const updatePreset = vi.fn()
const canWrite = ref(true)
const showSnack = vi.fn()

vi.mock('../../../../src/renderer/src/composables/useFilterPresetStore', async (orig) => ({
  ...(await orig<object>()),
  useFilterPresetStore: () => ({
    presets,
    loadPresets: vi.fn().mockResolvedValue(undefined),
    savePreset: vi.fn(),
    updatePreset,
    deletePreset: vi.fn()
  })
}))
vi.mock('../../../../src/renderer/src/composables/usePermissions', () => ({
  usePermissions: () => ({ canWrite: computed(() => canWrite.value) })
}))
vi.mock('../../../../src/renderer/src/composables/useAppState', () => ({
  useAppState: () => ({ showSnack, selectedCaseId: ref(null) })
}))

import ShortlistRankingDialog from '../../../../src/renderer/src/components/shortlist-ranking/ShortlistRankingDialog.vue'

const weights = { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 }
const config = (): ShortlistConfig => ({
  variantTypeScope: ['snv', 'indel'],
  topN: 100,
  baseFilters: { maxGnomadAf: 0.01, consequences: ['HIGH'] },
  rankConfig: { weights, ruleset: structuredClone(VARVIS_EVIDENCE_TEMPLATE) }
})
const preset = (
  id: number,
  name: string,
  shortlist: ShortlistConfig,
  isBuiltIn: boolean
): FilterPreset => ({
  id,
  name,
  description: null,
  filterJson: { shortlist },
  kind: 'shortlist',
  isBuiltIn,
  isVisible: true,
  sortOrder: id,
  createdAt: 0,
  updatedAt: 0
})

async function mountDialog(presetId: number): Promise<VueWrapper> {
  const wrapper = mount(ShortlistRankingDialog, {
    props: { open: true, presetId },
    global: {
      plugins: [createVuetify({ components, directives })],
      stubs: { VDialog: { template: '<div><slot /></div>' } }
    }
  })
  await flushPromises()
  return wrapper
}
const ruleIds = (w: VueWrapper): string[] =>
  w.findAll('[data-testid="ranking-rule-row"]').map((r) => r.attributes('data-problem-key')!)

beforeEach(() => {
  setActivePinia(createPinia())
  canWrite.value = true
  updatePreset
    .mockReset()
    .mockImplementation(async (id: number, p) => preset(id, p.name, p.filterJson.shortlist, false))
  presets = ref([
    preset(1, 'Tier 1', { ...config(), rankConfig: { weights } }, true),
    preset(2, 'Evidence (beta)', config(), true),
    preset(3, 'My lab', config(), false)
  ])
})

describe('ShortlistRankingDialog', () => {
  it('lists rankings with built-ins locked and opens a built-in read-only', async () => {
    const w = await mountDialog(2)
    expect(w.find('[data-testid="ranking-list"]').text()).toContain('My lab')
    const locked = w.findAll('.visually-hidden').filter((e) => e.text() === 'Built-in, read-only')
    expect(locked.length).toBeGreaterThanOrEqual(2)
    expect(w.find('[data-testid="ranking-duplicate"]').exists()).toBe(true)
    expect(w.find('[data-testid="ranking-save"]').exists()).toBe(false)
    expect(w.find('[data-testid="group-add"]').exists()).toBe(false)
  })

  it('shows weighted presets as a read-only summary', async () => {
    const w = await mountDialog(1)
    expect(w.find('[data-testid="ranking-legacy"]').text()).toContain('HIGH')
  })

  it('edits a user ranking: field error, problem count, Save disabled until fixed', async () => {
    const w = await mountDialog(3)
    const topN = w.find('[data-problem-key="topN"] input')
    await topN.setValue('0')
    expect(w.find('[data-problem-key="topN"]').text()).toMatch(/>=1|1/)
    expect(w.find('[data-testid="ranking-problems"]').text()).toContain('1 problem')
    expect(w.find('[data-testid="ranking-save"]').attributes('disabled')).toBeDefined()
    await topN.setValue('25')
    expect(w.find('[data-testid="ranking-problems"]').exists()).toBe(false)
    await w.find('[data-testid="ranking-save"]').trigger('click')
    await flushPromises()
    expect(updatePreset).toHaveBeenCalledWith(3, expect.objectContaining({ name: 'My lab' }))
    expect(w.find('[data-testid="ranking-saved"]').text()).toContain('My lab')
  })

  it('reorders rules with the keyboard-operable buttons and keeps the reference last', async () => {
    const w = await mountDialog(3)
    await w.findAll('[data-testid="ranking-group"] button')[0].trigger('click') // open "Population frequency"
    await flushPromises()
    const before = ruleIds(w)
    expect(before).toHaveLength(5)
    await w.findAll('[data-testid="rule-move-down"]')[0].trigger('click')
    const labels = w
      .findAll('[data-testid="ranking-rule-row"] input')
      .map((i) => (i.element as HTMLInputElement).value)
    expect(labels[0]).toBe('AF < 0.001 %')
    expect(w.find('[data-testid="ranking-announcement"]').text()).toBe(
      'Not in gnomAD moved to position 2'
    )
    // the reference row has no move buttons
    expect(
      w.findAll('[data-testid="ranking-rule-row"]')[4].find('[data-testid="rule-move-up"]').exists()
    ).toBe(false)
  })

  it('adds a group with an editable rule and a pinned reference', async () => {
    const w = await mountDialog(3)
    const groups = w.findAll('[data-testid="ranking-group"]').length
    await w.find('[data-testid="group-add"]').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-testid="ranking-group"]')).toHaveLength(groups + 1)
    expect(w.find('[data-testid="ranking-problems"]').exists()).toBe(false)
  })

  it('asks for an open case before previewing', async () => {
    const w = await mountDialog(3)
    expect(w.find('[data-testid="ranking-preview"]').exists()).toBe(false)
    await w.find('[data-testid="ranking-preview-toggle"]').trigger('click')
    expect(w.find('[data-testid="ranking-preview"]').text()).toContain('Open a case')
    expect(w.find('[data-testid="ranking-preview-run"]').exists()).toBe(false)
  })

  it('hides editing for read-only accounts', async () => {
    canWrite.value = false
    const w = await mountDialog(3)
    expect(w.find('[data-testid="ranking-save"]').exists()).toBe(false)
    expect(w.find('[data-testid="ranking-new"]').exists()).toBe(false)
  })

  it('toggles considerPhasing in the candidate gate and persists it (#637)', async () => {
    const w = await mountDialog(3)
    const toggle = w.find('[data-testid="ranking-consider-phasing"] input')
    expect((toggle.element as HTMLInputElement).checked).toBe(false)
    await toggle.setValue(true)
    await w.find('[data-testid="ranking-save"]').trigger('click')
    await flushPromises()
    expect(updatePreset).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        filterJson: {
          shortlist: expect.objectContaining({
            baseFilters: expect.objectContaining({ considerPhasing: true })
          })
        }
      })
    )
  })
})
