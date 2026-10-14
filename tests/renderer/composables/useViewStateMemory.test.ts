/* eslint-disable vue/one-component-per-file -- test hosts */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { useViewStateMemory } from '../../../src/renderer/src/composables/useViewUrlBindings'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import { VIEW_STATE_MEMORY } from '../../../src/renderer/src/config/viewStateMemory'

const Empty = defineComponent({ render: () => null })
const F1 = '{"starredOnly":true}'

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

let app: App | null = null

async function mountHost(dbPath: string | null = '/data/a.db') {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/case', name: 'case', component: Empty },
      { path: '/cohort', name: 'cohort', component: Empty }
    ]
  })
  await router.push('/case')
  const pinia = createPinia()
  setActivePinia(pinia)
  const db = useDatabaseStore()
  db.currentPath = dbPath
  app = createApp({
    setup() {
      useViewStateMemory()
      return () => null
    }
  })
  app.use(router)
  app.use(pinia)
  app.mount(document.createElement('div'))
  await settle()
  const go = async (path: string): Promise<Record<string, unknown>> => {
    await router.push(path)
    await settle()
    return { ...router.currentRoute.value.query }
  }
  return { router, db, go }
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(VIEW_STATE_MEMORY.storageKey) ?? '{}') as Record<
    string,
    unknown
  >
}

describe('useViewStateMemory (#124)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    app?.unmount()
    app = null
  })

  it('restores a case view when reopened without view params', async () => {
    const { go } = await mountHost()
    await go(`/case?case=1&f=${encodeURIComponent(F1)}&q=BRCA1&sort=-pos`)
    expect(await go('/case?case=2')).toEqual({ case: '2' })
    expect(await go('/case?case=1&tab=snv')).toEqual({
      case: '1',
      tab: 'snv',
      f: F1,
      q: 'BRCA1',
      sort: '-pos'
    })
  })

  it('lets a deep link win and remembers it', async () => {
    const { go } = await mountHost()
    await go('/case?case=1&q=BRCA1')
    await go('/case?case=2')
    expect(await go('/case?case=1&sort=gene')).toEqual({ case: '1', sort: 'gene' })
    expect(stored()['/data/a.db|case:1']).toEqual({ sort: 'gene' })
  })

  it('forgets the view when its filters are cleared', async () => {
    const { go } = await mountHost()
    await go('/case?case=1&q=BRCA1')
    await go('/case?case=1')
    expect(stored()['/data/a.db|case:1']).toBeUndefined()
    await go('/case?case=2')
    expect(await go('/case?case=1')).toEqual({ case: '1' })
  })

  it('drops an invalid stored snapshot entirely instead of half-applying it', async () => {
    localStorage.setItem(
      VIEW_STATE_MEMORY.storageKey,
      JSON.stringify({ '/data/a.db|case:1': { f: '{"renamedFilter":1}', sort: 'gene' } })
    )
    const { go } = await mountHost()
    expect(await go('/case?case=1')).toEqual({ case: '1' })
    expect(stored()['/data/a.db|case:1']).toBeUndefined()
  })

  it('keys memory by database identity', async () => {
    const { go, db } = await mountHost()
    await go('/case?case=1&q=BRCA1')
    await go('/case')
    db.currentPath = '/data/b.db'
    await settle()
    expect(await go('/case?case=1')).toEqual({ case: '1' })
  })

  it('does not copy the old database view onto the new one at a switch', async () => {
    const { go, db } = await mountHost()
    await go('/case?case=1&q=BRCA1')
    db.currentPath = '/data/b.db'
    await settle()
    expect(stored()['/data/b.db|case:1']).toBeUndefined()
  })

  it('gives the cohort view the same memory (parity)', async () => {
    const { go } = await mountHost()
    await go('/cohort?q=TTN&sort=gene')
    await go('/case?case=1')
    expect(await go('/cohort')).toEqual({ q: 'TTN', sort: 'gene' })
  })

  it('waits for the database identity before restoring (web reload)', async () => {
    localStorage.setItem(
      VIEW_STATE_MEMORY.storageKey,
      JSON.stringify({ 'web:postgres|case:4': { q: 'BRCA2' } })
    )
    const { router, go, db } = await mountHost(null)
    await go('/case?case=4')
    db.currentPath = 'web:postgres'
    await settle()
    expect(router.currentRoute.value.query).toEqual({ case: '4', q: 'BRCA2' })
  })
})
