import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createAppState } from '../../../src/renderer/src/composables/useAppState'
import { useShellLifecycle } from '../../../src/renderer/src/composables/useShellLifecycle'
import { useShellNavigation } from '../../../src/renderer/src/composables/useShellNavigation'

vi.mock('../../../src/renderer/src/queries/invalidation', () => ({
  invalidateServerData: vi.fn().mockResolvedValue(undefined)
}))

const View = { template: '<div />' }

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: (to) => ({ path: '/case', query: to.query }) },
      { path: '/case', name: 'case', component: View },
      { path: '/cohort', name: 'cohort', component: View }
    ]
  })
}

/** The shell as App.vue wires it: app state + route sync + database lifecycle. */
function mountShell(router: Router): {
  state: ReturnType<typeof createAppState>
  databasePath: ReturnType<typeof ref<string | null>>
} {
  const state = createAppState()
  const databasePath = ref<string | null>(null)
  useShellNavigation({
    activeTab: state.activeTab,
    sidebarOpen: state.sidebarOpen,
    panelOpen: state.panelOpen,
    selectedPanelVariant: state.selectedPanelVariant,
    transitioning: ref(false),
    router,
    confirmPanelLeave: state.confirmPanelLeave
  })
  useShellLifecycle({
    api: undefined,
    currentDatabasePath: databasePath,
    currentDatabaseName: ref('VarLens'),
    incrementDataGeneration: state.incrementDataGeneration,
    resetForDatabaseSwitch: state.resetForDatabaseSwitch,
    clearMetadataCache: vi.fn(),
    selectCase: state.selectCase,
    caseListRef: ref(null),
    dialogHostRef: ref(null),
    importStore: { importComplete: vi.fn() } as never
  })
  return { state, databasePath }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('cohort deep link', () => {
  it('stays on /cohort, query included, when the database path first resolves', async () => {
    const router = makeRouter()
    const { state, databasePath } = mountShell(router)

    // Direct load / reload of the cohort URL …
    await router.push('/cohort?f=abc&sort=gene_symbol')
    await settle()
    expect(state.activeTab.value).toBe('cohort')

    // … then the already-open database reports its path (async at startup).
    databasePath.value = 'workspace'
    await settle()

    expect(router.currentRoute.value.path).toBe('/cohort')
    expect(router.currentRoute.value.query).toEqual({ f: 'abc', sort: 'gene_symbol' })
    expect(state.activeTab.value).toBe('cohort')
  })

  it('still resets the case context when the database path first resolves', async () => {
    const router = makeRouter()
    const { state, databasePath } = mountShell(router)
    await router.push('/cohort')
    await settle()
    const generation = state.dataGeneration.value

    databasePath.value = 'workspace'
    await settle()

    expect(state.dataGeneration.value).toBe(generation + 1)
  })

  it('returns to the case view when switching from one database to another', async () => {
    const router = makeRouter()
    const { state, databasePath } = mountShell(router)
    databasePath.value = '/data/a.db'
    await settle()
    await router.push('/cohort')
    await settle()
    expect(state.activeTab.value).toBe('cohort')

    databasePath.value = '/data/b.db'
    await settle()

    expect(state.activeTab.value).toBe('case')
    expect(router.currentRoute.value.path).toBe('/case')
  })

  it('returns to the case view when the database is closed', async () => {
    const router = makeRouter()
    const { state, databasePath } = mountShell(router)
    databasePath.value = '/data/a.db'
    await settle()
    await router.push('/cohort')
    await settle()

    databasePath.value = null
    await settle()

    expect(state.activeTab.value).toBe('case')
    expect(router.currentRoute.value.path).toBe('/case')
  })
})
