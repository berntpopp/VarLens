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
        router
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
