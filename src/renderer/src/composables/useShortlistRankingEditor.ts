/**
 * Editing model of the "Shortlist ranking" settings dialog (spec §12): the
 * shortlist presets, the draft being edited, structural edit operations,
 * live validation with the shared validators and persistence through the
 * existing filter-preset IPC (`kind: 'shortlist'`).
 *
 * Plain field edits (labels, conditions, points, gate values) write straight
 * into the reactive `draft`; operations that must keep the ruleset well
 * formed (ids, the reference rule pinned last) are functions here. Built-in
 * presets are never written: they open read-only and are duplicated to edit.
 */
import { computed, inject, ref, type InjectionKey } from 'vue'
import { useFilterPresetStore, isShortlistPreset } from './useFilterPresetStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../config/shortlistRankingEditor'
import { parseRankingFile, rankingFileName, serializeRanking } from '../utils/shortlist-ranking-io'
import { SHORTLIST_EVIDENCE_CONFIG } from '../../../shared/config/shortlist-evidence.config'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../shared/config/evidence-rulesets/varvis-template'
import {
  evidenceConfigProblems,
  isReferenceRule,
  problemKey,
  type EvidenceProblem
} from '../../../shared/evidence/ruleset-problems'
import { ShortlistConfigSchema } from '../../../shared/types/ipc-schemas'
import type { EvidenceRule, EvidenceRuleset } from '../../../shared/types/evidence-ruleset'
import type { FilterPreset } from '../../../shared/types/filter-presets'
import type { FilterState } from '../../../shared/types/filters'
import type { RankConfig, ShortlistConfig } from '../../../shared/types/shortlist'

export type EvidenceShortlistConfig = ShortlistConfig & {
  rankConfig: RankConfig & { ruleset: EvidenceRuleset }
}

export interface RankingDraft {
  /** null until the draft is saved for the first time. */
  presetId: number | null
  name: string
  description: string | null
  config: EvidenceShortlistConfig
}

const {
  defaultGate,
  defaultTopN,
  variantTypes,
  limits,
  newGroupReferenceWhen,
  referenceRuleSuffix
} = SHORTLIST_EVIDENCE_CONFIG

/** Paths of the ruleset inside a config, as validation problems report them. */
export const RULESET_PATH = ['rankConfig', 'ruleset'] as const

export function shortlistConfigOf(preset: FilterPreset): ShortlistConfig | null {
  return (preset.filterJson as { shortlist?: ShortlistConfig } | null)?.shortlist ?? null
}

export function isEvidencePreset(preset: FilterPreset): boolean {
  return shortlistConfigOf(preset)?.rankConfig?.ruleset != null
}

/** Deep copy that also strips Vue proxies. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function uniqueId(prefix: string, taken: ReadonlySet<string>): string {
  let n = 1
  while (taken.has(`${prefix}_${n}`)) n += 1
  return `${prefix}_${n}`
}

/** A ruleset id that differs from its source, within the id length limit. */
function derivedRulesetId(id: string): string {
  const suffix = `-u${Date.now().toString(36)}`
  return `${id.replace(/-u[0-9a-z]+$/, '').slice(0, limits.rulesetIdChars - suffix.length)}${suffix}`
}

/** An evidence config around `ruleset`; `weights` is required by the type but unused by evidence scoring. */
function evidenceConfig(
  ruleset: EvidenceRuleset,
  gate: Partial<FilterState>,
  topN: number
): EvidenceShortlistConfig {
  const rs = clone(ruleset)
  delete rs.sha256
  rs.id = derivedRulesetId(rs.id)
  return {
    variantTypeScope: [...variantTypes],
    baseFilters: gate,
    topN,
    rankConfig: {
      weights: { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 },
      ruleset: rs
    }
  }
}

const templateGate = (): Partial<FilterState> => ({
  maxGnomadAf: defaultGate.maxGnomadAf,
  consequences: [...defaultGate.consequences]
})

export function useShortlistRankingEditor() {
  const store = useFilterPresetStore()
  const settings = useSettingsStore()

  const rankings = computed(() => store.presets.value.filter(isShortlistPreset))
  const selectedId = ref<number | null>(null)
  const draft = ref<RankingDraft | null>(null)
  // JSON of the draft as last loaded or saved; '' marks a never-saved draft.
  const baseline = ref('null')

  const selected = computed(() => rankings.value.find((p) => p.id === selectedId.value) ?? null)
  const readOnly = computed(() => selected.value?.isBuiltIn === true)
  const dirty = computed(() => JSON.stringify(draft.value) !== baseline.value)
  const ruleset = computed(() => draft.value?.config.rankConfig.ruleset ?? null)

  function setDraft(next: RankingDraft | null, saved: boolean): void {
    draft.value = next
    baseline.value = saved ? JSON.stringify(next) : ''
  }

  function uniqueName(base: string): string {
    const taken = new Set(rankings.value.map((p) => p.name))
    let name = base
    for (let n = 2; taken.has(name); n += 1) name = `${base} ${n}`
    return name
  }

  function select(id: number | null): void {
    const preset = rankings.value.find((p) => p.id === id) ?? null
    selectedId.value = preset?.id ?? null
    const config = preset !== null && isEvidencePreset(preset) ? shortlistConfigOf(preset) : null
    setDraft(
      preset !== null && config !== null
        ? {
            presetId: preset.id,
            name: preset.name,
            description: preset.description,
            config: clone(config) as EvidenceShortlistConfig
          }
        : null,
      true
    )
  }

  /** Load the presets and select `presetId`, else the default ranking, else the first. */
  async function open(presetId: number | null = null): Promise<void> {
    await store.loadPresets()
    const ids = rankings.value.map((p) => p.id)
    const wanted = [presetId, settings.defaultShortlistPresetId].find(
      (id) => id !== null && ids.includes(id)
    )
    select(wanted ?? ids[0] ?? null)
  }

  function startDraft(
    name: string,
    description: string | null,
    config: EvidenceShortlistConfig
  ): void {
    selectedId.value = null
    setDraft({ presetId: null, name: uniqueName(name), description, config }, false)
  }

  function newFromTemplate(): void {
    startDraft(
      COPY.newRankingName,
      null,
      evidenceConfig(VARVIS_EVIDENCE_TEMPLATE, templateGate(), defaultTopN)
    )
  }

  /** Copy the selection as a new, editable evidence ranking; a weighted preset contributes its gate. */
  function duplicate(): void {
    const name = `${draft.value?.name ?? selected.value?.name ?? COPY.newRankingName} (${COPY.copySuffix})`
    if (draft.value !== null) {
      const { config, description } = clone(draft.value)
      startDraft(
        name,
        description,
        evidenceConfig(config.rankConfig.ruleset, config.baseFilters, config.topN)
      )
      return
    }
    const legacy = selected.value === null ? null : shortlistConfigOf(selected.value)
    if (legacy === null) return
    const gate = templateGate()
    if (legacy.baseFilters.maxGnomadAf != null) gate.maxGnomadAf = legacy.baseFilters.maxGnomadAf
    if ((legacy.baseFilters.consequences?.length ?? 0) > 0)
      gate.consequences = [...(legacy.baseFilters.consequences ?? [])]
    startDraft(name, null, evidenceConfig(VARVIS_EVIDENCE_TEMPLATE, gate, legacy.topN))
  }

  /** Open an exported ranking as a new draft; returns an error message or null. */
  function importText(text: string): string | null {
    const file = parseRankingFile(text)
    if (!file.ok) return file.error
    startDraft(file.name, file.description, file.config as EvidenceShortlistConfig)
    return null
  }

  function exportFile(): { fileName: string; text: string } | null {
    const d = draft.value
    if (d === null) return null
    const text = serializeRanking({ name: d.name, description: d.description, config: d.config })
    return { fileName: rankingFileName(d.name), text }
  }

  // ─── Structural edits ────────────────────────────────────────────────────
  const ruleIds = (rs: EvidenceRuleset): Set<string> =>
    new Set(rs.groups.flatMap((g) => g.rules.map((r) => r.id)))

  const newRule = (id: string): EvidenceRule => ({
    id,
    label: COPY.newRuleLabel,
    when: COPY.newRuleWhen,
    points: COPY.newRulePoints
  })

  function addGroup(): void {
    const rs = ruleset.value
    if (rs === null) return
    const id = uniqueId('group', new Set(rs.groups.map((g) => g.id)))
    const taken = ruleIds(rs)
    rs.groups.push({
      id,
      label: COPY.newGroupLabel,
      scope: 'global',
      rules: [
        newRule(uniqueId(id, taken)),
        {
          id: `${id}${referenceRuleSuffix}`,
          label: COPY.referenceRuleLabel,
          when: newGroupReferenceWhen,
          points: 0
        }
      ]
    })
  }

  function removeGroup(gi: number): void {
    ruleset.value?.groups.splice(gi, 1)
  }

  /** Add a rule just above the group's reference rule. */
  function addRule(gi: number): void {
    const rs = ruleset.value
    const rules = rs?.groups[gi]?.rules
    if (rs === null || rules === undefined) return
    const at =
      rules.length > 0 && isReferenceRule(rules[rules.length - 1]) ? rules.length - 1 : rules.length
    rules.splice(at, 0, newRule(uniqueId(rs.groups[gi].id, ruleIds(rs))))
  }

  function removeRule(gi: number, ri: number): void {
    ruleset.value?.groups[gi]?.rules.splice(ri, 1)
  }

  /** Whether rule `ri` can move by `delta`; reference rules neither move nor are passed. */
  function canMoveRule(gi: number, ri: number, delta: -1 | 1): boolean {
    const rules = ruleset.value?.groups[gi]?.rules
    const target = rules?.[ri + delta]
    return (
      rules?.[ri] !== undefined &&
      target !== undefined &&
      !isReferenceRule(rules[ri]) &&
      !isReferenceRule(target)
    )
  }

  function moveRule(gi: number, ri: number, delta: -1 | 1): void {
    if (!canMoveRule(gi, ri, delta)) return
    const rules = ruleset.value!.groups[gi].rules
    ;[rules[ri], rules[ri + delta]] = [rules[ri + delta], rules[ri]]
  }

  // ─── Validation ──────────────────────────────────────────────────────────
  const problems = computed<EvidenceProblem[]>(() => {
    const d = draft.value
    if (d === null || readOnly.value) return []
    const list: EvidenceProblem[] = []
    const name = d.name.trim()
    if (name === '') list.push({ path: ['name'], message: COPY.errors.nameRequired })
    else if (rankings.value.some((p) => p.id !== d.presetId && p.name === name)) {
      list.push({ path: ['name'], message: COPY.errors.nameTaken })
    }
    // The IPC schema covers the gate and topN; ruleset issues come from the evidence check below.
    const schema = ShortlistConfigSchema.safeParse(d.config)
    if (!schema.success) {
      for (const issue of schema.error.issues) {
        if (issue.path[0] === RULESET_PATH[0] && issue.path[1] === RULESET_PATH[1]) continue
        list.push({ path: issue.path.map(String), message: issue.message })
      }
    }
    list.push(...evidenceConfigProblems(d.config))
    return list
  })

  const problemsByKey = computed(() => {
    const map = new Map<string, EvidenceProblem[]>()
    for (const p of problems.value) {
      const key = problemKey(p.path)
      map.set(key, [...(map.get(key) ?? []), p])
    }
    return map
  })

  /** Problems at exactly this dotted path. */
  const problemsAt = (key: string): EvidenceProblem[] => problemsByKey.value.get(key) ?? []
  const messagesAt = (key: string): string[] => problemsAt(key).map((p) => p.message)
  /** Number of problems at or below this dotted path. */
  const problemCountUnder = (key: string): number =>
    problems.value.filter((p) => `${problemKey(p.path)}.`.startsWith(`${key}.`)).length

  /** Where a problem is, in the words of the editor ("Variant effect › Missense"). */
  function problemLabel(problem: EvidenceProblem): string {
    const rs = ruleset.value
    const [a, b, kind, index, sub, subIndex] = problem.path
    if (a !== RULESET_PATH[0] || b !== RULESET_PATH[1] || rs === null) {
      return (COPY.fields as Record<string, string>)[String(a)] ?? COPY.sections.candidates
    }
    if (kind === 'modes' && typeof index === 'number') {
      return `${COPY.sections.modes} › ${rs.modes[index]?.label ?? index}`
    }
    if (kind === 'groups' && typeof index === 'number') {
      const group = rs.groups[index]
      const rule =
        sub === 'rules' && typeof subIndex === 'number' ? group?.rules[subIndex] : undefined
      return [group?.label ?? index, rule?.label].filter((x) => x !== undefined).join(' › ')
    }
    return COPY.sections.groups
  }

  // ─── Persistence ─────────────────────────────────────────────────────────
  async function save(): Promise<FilterPreset | null> {
    const d = draft.value
    if (d === null || readOnly.value || problems.value.length > 0) return null
    const name = d.name.trim()
    const description = d.description?.trim() ?? ''
    const fields = {
      name,
      description: description === '' ? null : description,
      filterJson: { shortlist: clone(d.config) }
    }
    const saved =
      d.presetId === null
        ? await store.savePreset({ ...fields, kind: 'shortlist', isVisible: true })
        : await store.updatePreset(d.presetId, fields)
    selectedId.value = saved.id
    setDraft({ ...d, presetId: saved.id, name }, true)
    return saved
  }

  /** Delete the selected user ranking; built-ins cannot be deleted. */
  async function remove(): Promise<void> {
    const preset = selected.value
    if (preset === null || preset.isBuiltIn) return
    await store.deletePreset(preset.id)
    if (settings.defaultShortlistPresetId === preset.id) settings.defaultShortlistPresetId = null
    select(rankings.value[0]?.id ?? null)
  }

  return {
    rankings,
    selectedId,
    selected,
    draft,
    ruleset,
    readOnly,
    dirty,
    problems,
    problemsAt,
    messagesAt,
    problemCountUnder,
    problemLabel,
    open,
    select,
    newFromTemplate,
    duplicate,
    importText,
    exportFile,
    addGroup,
    removeGroup,
    addRule,
    removeRule,
    canMoveRule,
    moveRule,
    save,
    remove
  }
}

export type ShortlistRankingEditor = ReturnType<typeof useShortlistRankingEditor>

/** The dialog provides its editor; the section components inject it. */
export const RankingEditorKey: InjectionKey<ShortlistRankingEditor> = Symbol(
  'shortlist-ranking-editor'
)

export function useRankingEditor(): ShortlistRankingEditor {
  const editor = inject(RankingEditorKey)
  if (editor === undefined)
    throw new Error('useRankingEditor() needs ShortlistRankingDialog as a parent')
  return editor
}
