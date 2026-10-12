import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import type { FilterPreset } from '../../../src/shared/types/filter-presets'
import type { ShortlistConfig } from '../../../src/shared/types/shortlist'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../src/shared/config/evidence-rulesets/varvis-template'

let presets: Ref<FilterPreset[]>
const savePreset = vi.fn()
const updatePreset = vi.fn()
const deletePreset = vi.fn()

vi.mock('../../../src/renderer/src/composables/useFilterPresetStore', async (orig) => ({
  ...(await orig<object>()),
  useFilterPresetStore: () => ({
    presets,
    loadPresets: vi.fn().mockResolvedValue(undefined),
    savePreset,
    updatePreset,
    deletePreset
  })
}))

import { useShortlistRankingEditor } from '../../../src/renderer/src/composables/useShortlistRankingEditor'
import { useSettingsStore } from '../../../src/renderer/src/stores/settingsStore'
import { serializeRanking } from '../../../src/renderer/src/utils/shortlist-ranking-io'

const weights = { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
const evidenceConfig = (): ShortlistConfig => ({
  variantTypeScope: ['snv', 'indel'],
  topN: 100,
  baseFilters: { maxGnomadAf: 0.01, consequences: ['HIGH'] },
  rankConfig: {
    weights,
    ruleset: { ...structuredClone(VARVIS_EVIDENCE_TEMPLATE), sha256: 'a'.repeat(64) }
  }
})
const preset = (
  id: number,
  name: string,
  config: ShortlistConfig,
  isBuiltIn = false
): FilterPreset => ({
  id,
  name,
  description: null,
  filterJson: { shortlist: config },
  kind: 'shortlist',
  isBuiltIn,
  isVisible: true,
  sortOrder: id,
  createdAt: 0,
  updatedAt: 0
})
const legacy = preset(
  1,
  'Tier 1',
  {
    variantTypeScope: ['snv', 'sv'],
    topN: 50,
    baseFilters: { maxGnomadAf: 0.001, consequences: ['HIGH', 'MODERATE'], minCadd: 10 },
    rankConfig: { weights }
  },
  true
)
const builtInEvidence = preset(2, 'Evidence (beta)', evidenceConfig(), true)
const mine = preset(3, 'My lab', evidenceConfig())

async function editor(id: number | null = null) {
  const e = useShortlistRankingEditor()
  await e.open(id)
  return e
}
const at = (e: Awaited<ReturnType<typeof editor>>, key: string): string[] => e.messagesAt(key)

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  presets = ref([legacy, builtInEvidence, mine, preset(9, 'A filter', {} as ShortlistConfig)])
  presets.value[3] = { ...presets.value[3], kind: 'filter', filterJson: {} }
  savePreset
    .mockReset()
    .mockImplementation(async (p) => ({ ...preset(10, p.name, p.filterJson.shortlist) }))
  updatePreset
    .mockReset()
    .mockImplementation(async (id, p) => ({ ...preset(id, p.name, p.filterJson.shortlist) }))
  deletePreset.mockReset().mockImplementation(async (id: number) => {
    presets.value = presets.value.filter((p) => p.id !== id)
  })
})

describe('useShortlistRankingEditor — selection', () => {
  it('lists shortlist presets only and opens the requested one', async () => {
    const e = await editor(3)
    expect(e.rankings.value.map((p) => p.id)).toEqual([1, 2, 3])
    expect(e.draft.value?.name).toBe('My lab')
    expect(e.readOnly.value).toBe(false)
    expect(e.dirty.value).toBe(false)
  })

  it('falls back to the default ranking, then the first', async () => {
    useSettingsStore().defaultShortlistPresetId = 2
    expect((await editor()).selectedId.value).toBe(2)
    useSettingsStore().defaultShortlistPresetId = 99
    expect((await editor()).selectedId.value).toBe(1)
  })

  it('opens built-ins read-only and weighted presets without a draft', async () => {
    const e = await editor(2)
    expect(e.readOnly.value).toBe(true)
    e.draft.value!.config.rankConfig.ruleset.groups[0].rules[0].when = 'nope'
    expect(e.problems.value).toEqual([]) // nothing to validate, nothing to save
    expect(await e.save()).toBeNull()
    e.select(1)
    expect(e.draft.value).toBeNull()
  })
})

describe('useShortlistRankingEditor — new drafts', () => {
  it('duplicates an evidence ranking as an unsaved, editable copy', async () => {
    const e = await editor(2)
    e.duplicate()
    const d = e.draft.value!
    expect(d.presetId).toBeNull()
    expect(d.name).toBe('Evidence (beta) (copy)')
    expect(d.config.rankConfig.ruleset.sha256).toBeUndefined()
    expect(d.config.rankConfig.ruleset.id).not.toBe(VARVIS_EVIDENCE_TEMPLATE.id)
    expect(e.readOnly.value).toBe(false)
    expect(e.dirty.value).toBe(true)
    // the built-in's stored config is untouched
    expect(
      (builtInEvidence.filterJson.shortlist as ShortlistConfig).rankConfig.ruleset?.sha256
    ).toBe('a'.repeat(64))
  })

  it('duplicates a weighted preset as the template with its gate', async () => {
    const e = await editor(1)
    e.duplicate()
    const c = e.draft.value!.config
    expect(c.baseFilters).toEqual({ maxGnomadAf: 0.001, consequences: ['HIGH', 'MODERATE'] })
    expect(c.topN).toBe(50)
    expect(c.variantTypeScope).toEqual(['snv', 'indel'])
    expect(e.problems.value).toEqual([])
  })

  it('starts a valid ranking from the template with a free name', async () => {
    const e = await editor()
    e.newFromTemplate()
    e.newFromTemplate()
    expect(e.draft.value!.name).toBe('My evidence ranking')
    expect(e.draft.value!.config.baseFilters.maxGnomadAf).toBe(0.01)
    expect(e.problems.value).toEqual([])
  })

  it('imports a valid file and reports an invalid one', async () => {
    const e = await editor()
    const text = serializeRanking({ name: 'My lab', description: 'x', config: evidenceConfig() })
    expect(e.importText(text)).toBeNull()
    expect(e.draft.value!.name).toBe('My lab 2')
    expect(e.draft.value!.config.rankConfig.ruleset.sha256).toBeUndefined()
    expect(e.importText('{}')).toMatch(/Not a VarLens/)
    expect(
      e.importText(
        serializeRanking({ name: 'x', description: null, config: { ...evidenceConfig(), topN: 0 } })
      )
    ).toMatch(/topN/)
  })

  it('exports the draft as a file that imports back to the same config', async () => {
    const e = await editor(3)
    const file = e.exportFile()!
    expect(file.fileName).toBe('my-lab.ranking.json')
    e.importText(file.text)
    const ruleset = structuredClone(mine.filterJson.shortlist!.rankConfig.ruleset!)
    delete ruleset.sha256
    expect(e.draft.value!.config.rankConfig.ruleset).toEqual(ruleset)
  })
})

describe('useShortlistRankingEditor — edits and validation', () => {
  it('surfaces bad DSL, duplicate ids, off-step points, a misplaced reference and the name', async () => {
    const e = await editor(3)
    const groups = e.ruleset.value!.groups
    groups[1].rules[0].when = 'cadd:>:20 AND'
    groups[2].rules[1].id = groups[2].rules[0].id
    groups[3].rules[0].points = 0.3
    groups[0].rules.unshift(groups[0].rules.pop()!)
    e.draft.value!.name = 'Tier 1'
    expect(at(e, 'rankConfig.ruleset.groups.1.rules.0.when')).toHaveLength(1)
    expect(at(e, 'rankConfig.ruleset.groups.2.rules.1.id')).toHaveLength(1)
    expect(at(e, 'rankConfig.ruleset.groups.3.rules.0.points')).toHaveLength(1)
    expect(at(e, 'rankConfig.ruleset.groups.0.rules.0')).toHaveLength(1)
    expect(at(e, 'name')).toEqual(['Another preset already has this name'])
    expect(e.dirty.value).toBe(true)
    expect(await e.save()).toBeNull()
  })

  it('reports gate problems from the IPC schema', async () => {
    const e = await editor(3)
    e.draft.value!.config.topN = 0
    e.draft.value!.config.variantTypeScope = ['snv', 'sv']
    expect(at(e, 'topN')).toHaveLength(1)
    expect(at(e, 'variantTypeScope')).toHaveLength(1)
  })

  it('adds rules above the reference rule and keeps the reference pinned', async () => {
    const e = await editor(3)
    const rules = e.ruleset.value!.groups[5].rules // gene: omim_gene, gene_ref
    e.addRule(5)
    expect(rules.map((r) => r.id)).toEqual(['omim_gene', 'gene_1', 'gene_ref'])
    expect(e.canMoveRule(5, 1, 1)).toBe(false)
    expect(e.canMoveRule(5, 2, -1)).toBe(false)
    e.moveRule(5, 1, -1)
    expect(rules.map((r) => r.id)).toEqual(['gene_1', 'omim_gene', 'gene_ref'])
    e.moveRule(5, 1, 1) // into the reference: refused
    expect(rules.map((r) => r.id)).toEqual(['gene_1', 'omim_gene', 'gene_ref'])
    e.removeRule(5, 0)
    expect(rules.map((r) => r.id)).toEqual(['omim_gene', 'gene_ref'])
    expect(e.problems.value).toEqual([])
  })

  it('adds a valid group with its own reference rule and removes it', async () => {
    const e = await editor(3)
    const before = e.ruleset.value!.groups.length
    e.addGroup()
    const g = e.ruleset.value!.groups[before]
    expect(g.rules.map((r) => r.id)).toEqual(['group_1_1', 'group_1_ref'])
    expect(e.problems.value).toEqual([])
    g.scope = 'xl'
    expect(e.problems.value).toEqual([])
    e.removeGroup(before)
    expect(e.ruleset.value!.groups).toHaveLength(before)
  })
})

describe('useShortlistRankingEditor — persistence', () => {
  it('creates a new ranking, then updates it', async () => {
    const e = await editor()
    e.newFromTemplate()
    const created = await e.save()
    expect(savePreset).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My evidence ranking', kind: 'shortlist', isVisible: true })
    )
    expect(created?.id).toBe(10)
    expect(e.dirty.value).toBe(false)
    e.draft.value!.config.topN = 20
    await e.save()
    expect(updatePreset).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ name: 'My evidence ranking' })
    )
  })

  it('deletes user rankings only and clears a default that pointed at it', async () => {
    const settings = useSettingsStore()
    settings.defaultShortlistPresetId = 3
    const e = await editor(2)
    await e.remove()
    expect(deletePreset).not.toHaveBeenCalled()
    e.select(3)
    await e.remove()
    expect(deletePreset).toHaveBeenCalledWith(3)
    expect(settings.defaultShortlistPresetId).toBeNull()
    expect(e.selectedId.value).toBe(1)
  })
})
