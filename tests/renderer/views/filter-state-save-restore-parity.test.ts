/* eslint-disable vue/one-component-per-file -- test host */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick, ref, watch } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { createFilterState } from '../../../src/shared/filters/filterDefaults'
import type { VariantFilter } from '../../../src/shared/types/api'
import type { ColumnFilter } from '../../../src/shared/types/column-filters'
import type { FilterState } from '../../../src/shared/types/filters'
import { useDslFilterIntegration } from '../../../src/renderer/src/composables/useDslFilterIntegration'
import {
  _resetUrlStateForTesting,
  installUrlStateSync,
  replaceAndRestore
} from '../../../src/renderer/src/composables/useUrlState'
import {
  useFilterUrlParam,
  useSortUrlParam
} from '../../../src/renderer/src/composables/useViewUrlBindings'
import {
  applyPresetStateToFilters,
  isPresetDiverged
} from '../../../src/renderer/src/utils/filters'
import { buildVariantFilterFromState } from '../../../src/renderer/src/utils/filters/filterSerialization'
import {
  decodeFilterSnapshot,
  encodeFilterSnapshot
} from '../../../src/renderer/src/utils/url-state/view-query'
import {
  loadViewState,
  saveViewState,
  VIEW_STATE_KEYS,
  type ViewStateSnapshot
} from '../../../src/renderer/src/utils/url-state/view-state-memory'

vi.mock('@vueuse/core', () => ({ useDebounceFn: (fn: () => void) => fn }))

const Empty = defineComponent({ render: () => null })

const PRESETS = [
  {
    id: 1,
    name: 'Rare Pathogenic',
    filterJson: {
      maxGnomadAf: 0.01,
      minCadd: 15,
      consequences: ['HIGH']
    } satisfies Partial<FilterState>
  }
]

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

describe('filter state save → edit → restore parity (#124 Slice A)', () => {
  let db: DatabaseService
  let caseId: number

  beforeEach(() => {
    localStorage.clear()
    db = new DatabaseService(':memory:')
    caseId = db.cases.createCase('parity-case', '/test/parity.vcf', 1024)
    db.variants.beginBulkInsert()
    db.variants.insertBatch(
      [
        {
          chr: '1',
          pos: 100,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'BRCA1',
          omim_mim_number: null,
          consequence: 'HIGH',
          gnomad_af: 0.001,
          cadd: 28,
          clinvar: 'Pathogenic, low penetrance',
          gt_num: '0/1',
          func: 'exonic',
          qual: 99,
          hpo_sim_score: null,
          transcript: 'NM_007294.4',
          cdna: 'c.100A>G',
          aa_change: 'p.Lys34Glu',
          moi: null,
          info_json: JSON.stringify({ DP: '80' })
        },
        {
          chr: '1',
          pos: 200,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'BRCA1',
          omim_mim_number: '113705',
          consequence: 'HIGH',
          gnomad_af: 0.002,
          cadd: 26,
          clinvar: 'Pathogenic, low penetrance',
          gt_num: '0/1',
          func: 'exonic',
          qual: 90,
          hpo_sim_score: null,
          transcript: 'NM_007294.4',
          cdna: 'c.200C>T',
          aa_change: 'p.Thr67Ile',
          moi: null,
          info_json: JSON.stringify({ DP: '75' })
        },
        {
          chr: '1',
          pos: 300,
          ref: 'G',
          alt: 'A',
          gene_symbol: 'BRCA1',
          omim_mim_number: null,
          consequence: 'MODERATE',
          gnomad_af: 0.008,
          cadd: 24,
          clinvar: 'Pathogenic, low penetrance',
          gt_num: '0/1',
          func: 'exonic',
          qual: 85,
          hpo_sim_score: null,
          transcript: 'NM_007294.4',
          cdna: null,
          aa_change: null,
          moi: null,
          info_json: JSON.stringify({ DP: '60' })
        },
        {
          chr: '17',
          pos: 400,
          ref: 'T',
          alt: 'C',
          gene_symbol: 'TP53',
          omim_mim_number: null,
          consequence: 'HIGH',
          gnomad_af: 0.0005,
          cadd: 32,
          clinvar: 'Pathogenic',
          gt_num: '1/1',
          func: 'exonic',
          qual: 99,
          hpo_sim_score: null,
          transcript: 'NM_000546.6',
          cdna: 'c.400T>C',
          aa_change: 'p.Cys134Arg',
          moi: null,
          info_json: JSON.stringify({ DP: '15' })
        }
      ],
      caseId
    )
    db.variants.finishBulkInsert(caseId, 4)
  })

  afterEach(() => {
    _resetUrlStateForTesting()
    db.close()
    localStorage.clear()
  })

  async function mountFilterHost() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/case', name: 'case', component: Empty }]
    })
    await router.push(`/case?case=${caseId}`)

    const filters = ref<FilterState>(createFilterState())
    const selectedImpactPresets = ref<string[]>([])
    const searchQuery = ref('')
    const sortBy = ref<Array<{ key: string; order: 'asc' | 'desc' }>>([])
    const activePresetIds = ref<Set<number>>(new Set())
    const dslColumnFiltersRef = ref<Record<string, ColumnFilter>>({})
    let applyingPresets = false

    watch(searchQuery, (q) => {
      filters.value.searchQuery = q
    })

    watch(
      () => JSON.stringify([filters.value, selectedImpactPresets.value]),
      () => {
        if (applyingPresets || activePresetIds.value.size === 0) return
        for (const id of [...activePresetIds.value]) {
          const preset = PRESETS.find((p) => p.id === id)
          if (
            preset !== undefined &&
            isPresetDiverged({
              filters: filters.value,
              presetFilterJson: preset.filterJson,
              consequencesValue: selectedImpactPresets.value
            })
          ) {
            activePresetIds.value.delete(id)
          }
        }
      }
    )

    function activatePreset(id: number): void {
      const preset = PRESETS.find((p) => p.id === id)
      if (!preset) return
      activePresetIds.value.add(id)
      applyingPresets = true
      applyPresetStateToFilters({
        filters,
        presetState: preset.filterJson,
        consequencesTarget: selectedImpactPresets
      })
      void nextTick(() => {
        applyingPresets = false
      })
    }

    let dsl!: ReturnType<typeof useDslFilterIntegration>
    const app = createApp({
      setup() {
        installUrlStateSync(router)
        useFilterUrlParam('case', filters, selectedImpactPresets)
        useSortUrlParam('case', sortBy)
        dsl = useDslFilterIntegration({
          presets: () => PRESETS,
          searchQueryRef: searchQuery,
          emitFilters: () => {},
          columnFiltersRef: dslColumnFiltersRef,
          urlRoute: 'case',
          scope: 'case',
          clearConflictingDrawerFields: (colFilters) => {
            if ('gnomad_af' in colFilters) filters.value.maxGnomadAf = null
            if ('cadd' in colFilters) filters.value.minCadd = null
          },
          activatePreset
        })
        return () => null
      }
    })
    app.use(router)
    app.mount(document.createElement('div'))
    await settle()

    const memoryKey = `test-db|case:${caseId}`

    function writeViewSnapshot(): ViewStateSnapshot {
      const snapshot: ViewStateSnapshot = {}
      const query = router.currentRoute.value.query
      for (const k of VIEW_STATE_KEYS) {
        const val = query[k]
        if (typeof val === 'string' && val !== '') snapshot[k] = val
      }
      saveViewState(memoryKey, snapshot)
      return snapshot
    }

    async function readAndRestoreViewSnapshot(): Promise<ViewStateSnapshot | null> {
      const stored = loadViewState(memoryKey)
      if (stored !== null) {
        await replaceAndRestore(router, { case: String(caseId), ...stored })
        await settle()
      }
      return stored
    }

    function getExportPayload(): VariantFilter {
      const base = buildVariantFilterFromState(filters.value, selectedImpactPresets.value)
      const mergedColumns = dsl.mergeDslColumnFilters(
        Object.keys(filters.value.columnFilters).length > 0
          ? filters.value.columnFilters
          : undefined
      )
      return {
        case_id: caseId,
        ...base,
        ...(mergedColumns !== undefined && Object.keys(mergedColumns).length > 0
          ? { column_filters: mergedColumns }
          : {})
      }
    }

    function matchingVariantIds(): number[] {
      return db.variants
        .getVariants(getExportPayload(), 100, 0)
        .data.map((v) => v.id)
        .sort((a, b) => a - b)
    }

    return {
      app,
      router,
      filters,
      selectedImpactPresets,
      activePresetIds,
      dsl,
      writeViewSnapshot,
      readAndRestoreViewSnapshot,
      getExportPayload,
      matchingVariantIds
    }
  }

  it('round-trips committed DSL (quoted values, :is:null, :is:notnull, info.<KEY>) and drawer filters with identical variant IDs and export payload', async () => {
    const host = await mountFilterHost()

    // Apply drawer filters + committed DSL with quoted value, null checks, and info.<KEY>
    host.filters.value.funcs = ['exonic']
    host.selectedImpactPresets.value = ['HIGH', 'MODERATE']
    host.dsl.dslInput.value =
      'clinvar:=:"Pathogenic, low penetrance" AND cdna:is:notnull AND omim_mim_number:is:null AND info.DP:>:50'
    await nextTick()
    host.dsl.applyDslFilters()
    await settle()

    const savedExport = host.getExportPayload()
    const savedIds = host.matchingVariantIds()
    expect(savedIds).toHaveLength(1) // Only pos=100 matches all predicates

    const snapshot = host.writeViewSnapshot()
    expect(snapshot.f).toBe(
      encodeFilterSnapshot(host.filters.value, host.selectedImpactPresets.value)
    )
    expect(decodeFilterSnapshot(snapshot.f).impact).toEqual(['HIGH', 'MODERATE'])

    // Edit filters to a completely different state
    host.dsl.handleDslClear()
    host.filters.value = createFilterState({ geneSymbol: 'TP53' })
    host.selectedImpactPresets.value = []
    await settle()
    expect(host.matchingVariantIds()).not.toEqual(savedIds)

    // Restore from saved snapshot
    const restored = await host.readAndRestoreViewSnapshot()
    expect(restored).toEqual(snapshot)
    expect(host.getExportPayload()).toEqual(savedExport)
    expect(host.matchingVariantIds()).toEqual(savedIds)

    host.app.unmount()
  })

  it('preserves preset activation + manual divergence across save → edit → restore', async () => {
    const host = await mountFilterHost()

    // Activate @rare_pathogenic preset via DSL, then apply a conflicting DSL cadd override
    host.dsl.dslInput.value = '@rare_pathogenic'
    await nextTick()
    host.dsl.applyDslFilters()
    await settle()

    expect(host.activePresetIds.value.has(1)).toBe(true)
    expect(host.filters.value.maxGnomadAf).toBe(0.01)
    expect(host.filters.value.minCadd).toBe(15)

    // Now apply DSL cadd:>=:25 which clears conflicting drawer minCadd and diverges from preset
    host.dsl.dslInput.value = 'cadd:>=:25'
    await nextTick()
    host.dsl.applyDslFilters()
    await settle()
    expect(host.filters.value.minCadd).toBeNull()
    expect(host.activePresetIds.value.has(1)).toBe(false)

    // Also manually tighten maxGnomadAf to 0.0015 -> excludes pos=200 (AF 0.002)
    host.filters.value.maxGnomadAf = 0.0015
    await settle()

    const savedExport = host.getExportPayload()
    const savedIds = host.matchingVariantIds()
    expect(savedIds).toHaveLength(2) // pos=100 (AF 0.001) and pos=400 (AF 0.0005)
    host.writeViewSnapshot()

    // Mutate state
    host.dsl.handleDslClear()
    host.filters.value = createFilterState()
    host.selectedImpactPresets.value = []
    await settle()
    expect(host.matchingVariantIds()).toHaveLength(4)

    // Restore: must keep diverged maxGnomadAf=0.0015 and NOT re-apply @rare_pathogenic's 0.01
    await host.readAndRestoreViewSnapshot()
    expect(host.filters.value.maxGnomadAf).toBe(0.0015)
    expect(host.getExportPayload()).toEqual(savedExport)
    expect(host.matchingVariantIds()).toEqual(savedIds)

    host.app.unmount()
  })

  it('does not resurrect a removed DSL chip (removeDslCondition) after restore and ignores rejected invalid DSL drafts', async () => {
    const host = await mountFilterHost()

    host.dsl.dslInput.value =
      'gene:=:BRCA1 AND clinvar:=:"Pathogenic, low penetrance" AND cdna:is:notnull AND omim_mim_number:is:null'
    await nextTick()
    host.dsl.applyDslFilters()
    await settle()
    expect(host.matchingVariantIds()).toHaveLength(1) // pos=100

    // Remove the omim_mim_number:is:null chip -> now pos=100 and pos=200 both match
    host.dsl.removeDslCondition('omim_mim_number')
    await settle()
    const afterChipRemovalExport = host.getExportPayload()
    const afterChipRemovalIds = host.matchingVariantIds()
    expect(afterChipRemovalIds).toHaveLength(2)

    // Type an invalid DSL draft and attempt to apply it -> must be rejected atomically
    host.dsl.dslInput.value = 'cadd:<:not_a_number'
    await nextTick()
    host.dsl.applyDslFilters()
    await settle()
    expect(host.dsl.dslErrors.value.length).toBeGreaterThan(0)
    expect(host.dsl.isDraftPending.value).toBe(true)

    // Save view snapshot while invalid draft is sitting in the input bar
    host.writeViewSnapshot()

    // Mutate to empty state
    host.dsl.handleDslClear()
    await settle()
    expect(host.matchingVariantIds()).toHaveLength(4)

    // Restore: must match the committed post-chip-removal state, without the removed chip or invalid draft
    await host.readAndRestoreViewSnapshot()
    expect(host.dsl.dslColumnFilters.value).not.toHaveProperty('omim_mim_number')
    expect(host.getExportPayload()).toEqual(afterChipRemovalExport)
    expect(host.matchingVariantIds()).toEqual(afterChipRemovalIds)

    host.app.unmount()
  })
})
