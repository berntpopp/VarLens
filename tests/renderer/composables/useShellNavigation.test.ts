import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises } from '@vue/test-utils'

import { useShellNavigation } from '../../../src/renderer/src/composables/useShellNavigation'

describe('useShellNavigation sidebar collapse timing', () => {
  it('collapses the sidebar in the same render flush as the cohort route swap', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/case', component: { template: '<div />' } },
        { path: '/cohort', component: { template: '<div />' } }
      ]
    })
    await router.push('/case')

    const activeTab = ref<'case' | 'cohort'>('case')
    const sidebarOpen = ref(true)
    const transitioning = ref(false)
    // Before the route commits, the old (case) view is still on screen: the
    // sidebar must not collapse yet or that view slides sideways.
    let sidebarBeforeCommit: boolean | null = null
    router.beforeResolve((to) => {
      if (to.path === '/cohort') sidebarBeforeCommit = sidebarOpen.value
    })

    const scope = effectScope()
    scope.run(() =>
      useShellNavigation({
        activeTab,
        sidebarOpen,
        panelOpen: ref(false),
        selectedPanelVariant: ref(null),
        transitioning,
        router,
        confirmPanelLeave: () => null,
        closePanelWithoutAsking: vi.fn()
      })
    )

    // What the render flush that mounts the cohort view will see.
    let sidebarAtRender: boolean | null = null
    scope.run(() =>
      watch(
        () => router.currentRoute.value.path,
        (path) => {
          if (path === '/cohort') sidebarAtRender = sidebarOpen.value
        },
        { flush: 'pre' }
      )
    )

    activeTab.value = 'cohort'
    await nextTick()
    await flushPromises()

    expect(sidebarBeforeCommit).toBe(true)
    expect(sidebarAtRender).toBe(false)
    expect(sidebarOpen.value).toBe(false)
    expect(router.currentRoute.value.path).toBe('/cohort')
    // Layout transitions stay disabled until the collapsed layout has been
    // rendered once; re-enabling them in the same frame animated v-main.
    expect(transitioning.value).toBe(true)
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    await vi.waitFor(() => expect(transitioning.value).toBe(false))
    scope.stop()
  })
})

describe('useShellNavigation unsaved-draft route guard', () => {
  async function navigate(answer: Promise<boolean> | null, to: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/case', component: { template: '<div />' } },
        { path: '/cohort', component: { template: '<div />' } }
      ]
    })
    await router.push('/case?case=1')
    const confirmPanelLeave = vi.fn(() => answer)
    const closePanelWithoutAsking = vi.fn()
    const activeTab = ref<'case' | 'cohort'>('case')
    const scope = effectScope()
    scope.run(() =>
      useShellNavigation({
        activeTab,
        sidebarOpen: ref(true),
        panelOpen: ref(true),
        selectedPanelVariant: ref(null),
        transitioning: ref(false),
        router,
        confirmPanelLeave,
        closePanelWithoutAsking
      })
    )
    closePanelWithoutAsking.mockClear() // the immediate route sync
    await router.push(to)
    await nextTick()
    scope.stop()
    return {
      fullPath: router.currentRoute.value.fullPath,
      confirmPanelLeave,
      closePanelWithoutAsking,
      activeTab
    }
  }

  it('back/forward to the other tab closes the panel of the view being left', async () => {
    const moved = await navigate(Promise.resolve(true), '/cohort')
    expect(moved.activeTab.value).toBe('cohort')
    expect(moved.closePanelWithoutAsking).toHaveBeenCalledTimes(1)

    // Same tab (another case, a filter step): the panel is not this watcher's business.
    const stayed = await navigate(null, '/case?case=2')
    expect(stayed.closePanelWithoutAsking).not.toHaveBeenCalled()
  })

  it('Cancel keeps the route on a tab change and on a case change', async () => {
    expect((await navigate(Promise.resolve(false), '/cohort')).fullPath).toBe('/case?case=1')
    expect((await navigate(Promise.resolve(false), '/case?case=2')).fullPath).toBe('/case?case=1')
  })

  it('Apply / Discard and no draft let the route change', async () => {
    expect((await navigate(Promise.resolve(true), '/cohort')).fullPath).toBe('/cohort')
    expect((await navigate(null, '/case?case=2')).fullPath).toBe('/case?case=2')
  })

  it('does not ask for filter, sort or search changes on the same case', async () => {
    const { fullPath, confirmPanelLeave } = await navigate(
      Promise.resolve(false),
      '/case?case=1&sort=pos'
    )
    expect(fullPath).toBe('/case?case=1&sort=pos')
    expect(confirmPanelLeave).not.toHaveBeenCalled()
  })
})
