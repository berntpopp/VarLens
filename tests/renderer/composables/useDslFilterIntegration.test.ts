import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useDslFilterIntegration } from '../../../src/renderer/src/composables/useDslFilterIntegration'
import {
  _resetUrlStateForTesting,
  installUrlStateSync
} from '../../../src/renderer/src/composables/useUrlState'

vi.mock('@vueuse/core', () => ({ useDebounceFn: (fn: () => void) => fn }))

const PRESETS = [{ id: 7, name: 'Rare Pathogenic' }]

function setup(urlRoute?: 'case' | 'cohort') {
  const searchQueryRef = ref('')
  const emitFilters = vi.fn()
  const clearConflictingDrawerFields = vi.fn()
  const activatePreset = vi.fn()
  const dsl = useDslFilterIntegration({
    presets: () => PRESETS,
    searchQueryRef,
    emitFilters,
    clearConflictingDrawerFields,
    activatePreset,
    urlRoute
  })
  return { dsl, searchQueryRef, emitFilters, clearConflictingDrawerFields, activatePreset }
}

async function type(dsl: ReturnType<typeof setup>['dsl'], text: string): Promise<void> {
  dsl.dslInput.value = text
  await nextTick()
}

afterEach(() => _resetUrlStateForTesting())

describe('useDslFilterIntegration', () => {
  it('applies a valid expression and commits it', async () => {
    const { dsl, emitFilters, clearConflictingDrawerFields } = setup()
    await type(dsl, 'gene:=:BRCA1 OR gene:=:TP53')
    expect(dsl.isDraftPending.value).toBe(true)
    dsl.applyDslFilters()
    expect(dsl.dslColumnFilters.value).toEqual({
      gene_symbol: { operator: 'in', value: ['BRCA1', 'TP53'] }
    })
    expect(clearConflictingDrawerFields).toHaveBeenCalledOnce()
    expect(emitFilters).toHaveBeenCalledOnce()
    expect(dsl.isDraftPending.value).toBe(false)
  })

  it.each([
    'cadd:>=:20 AND cadd:<=:30',
    'gene:=:BRCA1 OR cadd:>=:20',
    'gene:=:BRCA1 AND',
    'cadd:<:abc',
    'clinvar:!~:benign',
    'gnomad_af:<:0.01 AND @unknown_preset'
  ])('rejects %s atomically, keeping the applied query', async (input) => {
    const { dsl, searchQueryRef, emitFilters, clearConflictingDrawerFields, activatePreset } =
      setup()
    await type(dsl, 'gnomad_af:<:0.01')
    dsl.applyDslFilters()
    const applied = dsl.dslColumnFilters.value
    emitFilters.mockClear()
    clearConflictingDrawerFields.mockClear()
    searchQueryRef.value = 'kept'

    await type(dsl, input)
    dsl.applyDslFilters()

    expect(dsl.dslErrors.value.length).toBeGreaterThan(0)
    expect(dsl.dslColumnFilters.value).toBe(applied)
    expect(emitFilters).not.toHaveBeenCalled()
    expect(clearConflictingDrawerFields).not.toHaveBeenCalled()
    expect(activatePreset).not.toHaveBeenCalled()
    expect(searchQueryRef.value).toBe('kept')
    expect(dsl.isDraftPending.value).toBe(true)
  })

  it('drops the plain search left over from typing a DSL field name key by key', async () => {
    const { dsl, searchQueryRef } = setup()
    for (const text of ['g', 'ge', 'gene', 'gene:', 'gene:=', 'gene:=:', 'gene:=:B']) {
      await type(dsl, text)
    }
    expect(dsl.isDslMode.value).toBe(true)
    expect(searchQueryRef.value).toBe('')
    expect(dsl.isDraftPending.value).toBe(true)
  })

  it('activates a referenced preset', async () => {
    const { dsl, activatePreset } = setup()
    await type(dsl, '@rare_pathogenic AND cadd:>=:20')
    dsl.applyDslFilters()
    expect(dsl.dslErrors.value).toEqual([])
    expect(activatePreset).toHaveBeenCalledWith(7)
  })

  it('removing one condition rewrites the committed text', async () => {
    const { dsl, emitFilters } = setup()
    await type(dsl, 'gene:=:"BRCA 1" AND cadd:>=:20')
    dsl.applyDslFilters()
    emitFilters.mockClear()

    dsl.removeDslCondition('cadd')

    expect(dsl.dslColumnFilters.value).toEqual({
      gene_symbol: { operator: '=', value: 'BRCA 1' }
    })
    expect(dsl.dslInput.value).toBe('gene_symbol:=:"BRCA 1"')
    expect(dsl.isDraftPending.value).toBe(false)
    expect(emitFilters).toHaveBeenCalledOnce()
  })

  it('shows clearing the text over applied DSL as not applied', async () => {
    const { dsl } = setup()
    await type(dsl, 'cadd:>=:20')
    dsl.applyDslFilters()
    await type(dsl, '')
    expect(dsl.isDraftPending.value).toBe(true)
  })
})

describe('useDslFilterIntegration URL state (?q=)', () => {
  async function mountWithRouter(path: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/case', name: 'case', component: { render: () => null } }]
    })
    await router.push(path)
    let ctx!: ReturnType<typeof setup>
    const app = createApp({
      setup() {
        installUrlStateSync(router)
        ctx = setup('case')
        return () => null
      }
    })
    app.mount(document.createElement('div'))
    await settle()
    return { router, ctx, app }
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
    }
  }

  it('persists only the committed text, never the draft', async () => {
    const { router, ctx, app } = await mountWithRouter('/case')
    await type(ctx.dsl, 'cadd:>=:20')
    ctx.dsl.applyDslFilters()
    await settle()
    expect(router.currentRoute.value.query.q).toBe('cadd:>=:20')

    await type(ctx.dsl, 'cadd:>=:20 AND')
    await settle()
    expect(router.currentRoute.value.query.q).toBe('cadd:>=:20')

    ctx.dsl.removeDslCondition('cadd')
    await settle()
    expect(router.currentRoute.value.query.q).toBeUndefined()
    app.unmount()
  })

  it('restores a link without replaying @preset references', async () => {
    const { ctx, app } = await mountWithRouter(
      `/case?q=${encodeURIComponent('@rare_pathogenic AND cadd:>=:20')}`
    )
    expect(ctx.dsl.dslColumnFilters.value).toEqual({
      cadd: { operator: '>=', value: 20, includeEmpty: true }
    })
    expect(ctx.activatePreset).not.toHaveBeenCalled()
    app.unmount()
  })
})
