/* eslint-disable vue/one-component-per-file -- test hosts */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import {
  _resetUrlStateForTesting,
  installUrlStateSync,
  queryForRoute,
  useUrlParam
} from '../../../src/renderer/src/composables/useUrlState'

const Empty = defineComponent({ render: () => null })

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/case', name: 'case', component: Empty },
      { path: '/cohort', name: 'cohort', component: Empty }
    ]
  })
}

/** Router navigations resolve across several promise hops; wait a few macrotasks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

/** Mounts a host that installs the sync and registers case/tab/f bindings. */
async function mountHost(initialPath: string) {
  const router = makeRouter()
  await router.push(initialPath)
  const caseId = ref<string | undefined>(undefined)
  const tab = ref<string | undefined>(undefined)
  const filters = ref<string | undefined>(undefined)
  const applied: string[] = []
  const app = createApp({
    setup() {
      installUrlStateSync(router)
      useUrlParam({
        route: 'case',
        key: 'case',
        priority: 0,
        history: 'push',
        read: () => caseId.value,
        apply: (v) => {
          applied.push(`case=${v}`)
          caseId.value = v
          // Simulate the per-case filter reset that follows a case switch
          filters.value = undefined
        }
      })
      useUrlParam({
        route: 'case',
        key: 'tab',
        priority: 1,
        history: 'push',
        read: () => tab.value,
        apply: (v) => {
          applied.push(`tab=${v}`)
          tab.value = v
        }
      })
      useUrlParam({
        route: 'case',
        key: 'f',
        priority: 2,
        history: 'replace',
        read: () => filters.value,
        apply: (v) => {
          applied.push(`f=${v}`)
          filters.value = v
        }
      })
      return () => null
    }
  })
  app.use(router)
  app.mount(document.createElement('div'))
  await settle()
  return { router, caseId, tab, filters, applied, app }
}

describe('useUrlState', () => {
  afterEach(() => _resetUrlStateForTesting())

  it('restores state from a deep link in priority order (reload)', async () => {
    const { caseId, tab, filters, applied } = await mountHost('/case?case=7&tab=snv&f=%7B%7D')
    expect(caseId.value).toBe('7')
    expect(tab.value).toBe('snv')
    // Filters apply after the case, so the case-switch reset cannot wipe them
    expect(filters.value).toBe('{}')
    expect(applied.indexOf('case=7')).toBeLessThan(applied.indexOf('f={}'))
  })

  it('writes state changes to the query: push for case/tab, replace for filters', async () => {
    const { router, caseId, tab, filters } = await mountHost('/case')
    const startLength = window.history.length

    caseId.value = '3'
    await settle()
    expect(router.currentRoute.value.query).toEqual({ case: '3' })

    tab.value = 'shortlist'
    filters.value = '{"starredOnly":true}'
    await settle()
    expect(router.currentRoute.value.query).toEqual({
      case: '3',
      tab: 'shortlist',
      f: '{"starredOnly":true}'
    })
    expect(window.history.length).toBeGreaterThanOrEqual(startLength)
  })

  it('back/forward re-applies the previous state', async () => {
    const { router, caseId, tab } = await mountHost('/case')
    caseId.value = '1'
    await settle()
    tab.value = 'snv'
    await settle()
    caseId.value = '2'
    tab.value = 'sv'
    await settle()
    expect(router.currentRoute.value.query).toMatchObject({ case: '2', tab: 'sv' })

    router.back()
    await settle()
    expect(caseId.value).toBe('1')
    expect(tab.value).toBe('snv')
  })

  it('does not re-apply its own writes (no revert of fast typing)', async () => {
    const { filters, applied } = await mountHost('/case')
    filters.value = 'a'
    filters.value = 'ab'
    await settle()
    filters.value = 'abc'
    await settle()
    expect(filters.value).toBe('abc')
    expect(applied.filter((a) => a.startsWith('f='))).toEqual([])
  })

  it('builds the query for a view switch from registered state', async () => {
    const { caseId, tab } = await mountHost('/case')
    caseId.value = '9'
    tab.value = 'str'
    expect(queryForRoute('case')).toEqual({ case: '9', tab: 'str' })
    expect(queryForRoute('cohort')).toEqual({})
  })

  it('ignores bindings of the inactive route', async () => {
    const { router, caseId } = await mountHost('/cohort?case=5')
    await settle()
    expect(caseId.value).toBeUndefined()
    expect(router.currentRoute.value.query).toEqual({ case: '5' })
  })
})
