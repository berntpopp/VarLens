import { nextTick, onScopeDispose, watch } from 'vue'
import type { Ref } from 'vue'
import type { Router } from 'vue-router'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import { queryForRoute } from './useUrlState'

interface UseShellNavigationOptions {
  activeTab: Ref<'case' | 'cohort'>
  sidebarOpen: Ref<boolean>
  panelOpen: Ref<boolean>
  selectedPanelVariant: Ref<Variant | CohortVariant | null>
  transitioning: Ref<boolean>
  router: Router
  /** App state's unsaved-draft check: null = nothing to ask, false = stay. */
  confirmPanelLeave: () => Promise<boolean> | null
}

/** Resolves after the next frame has been rendered (two rAF ticks). */
function afterNextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
}

export function useShellNavigation({
  activeTab,
  sidebarOpen,
  panelOpen,
  selectedPanelVariant,
  transitioning,
  router,
  confirmPanelLeave
}: UseShellNavigationOptions): void {
  let syncingFromRoute = false

  // Back/forward and pasted links move the route before any state: ask first,
  // so Cancel leaves the URL where it was. Filter/sort/search steps do not ask.
  onScopeDispose(
    router.beforeEach(
      async (to, from) =>
        (to.path === from.path && to.query.case === from.query.case) ||
        (await confirmPanelLeave()) !== false
    )
  )

  watch(
    () => router.currentRoute.value.path,
    (path) => {
      const routeTab = path.startsWith('/cohort') ? 'cohort' : 'case'
      if (activeTab.value === routeTab) return

      syncingFromRoute = true
      activeTab.value = routeTab
      syncingFromRoute = false
    },
    { immediate: true }
  )

  watch(activeTab, async (newTab) => {
    if (syncingFromRoute) return

    const targetPath = newTab === 'cohort' ? '/cohort' : '/case'
    if (router.currentRoute.value.path === targetPath) return

    panelOpen.value = false
    selectedPanelVariant.value = null
    transitioning.value = true

    try {
      if (newTab === 'cohort') {
        // Collapse the sidebar in the same render flush that swaps the views
        // (App.vue disables layout transitions while `transitioning`): the
        // outgoing case view is gone and the cohort view is new, so nothing
        // already on screen is shifted. Collapsing before the push slid the
        // still-visible case view sideways (CLS ~0.7); collapsing after the
        // awaited push shifted the freshly rendered cohort table (~0.18).
        // afterEach runs synchronously when the route commits, before Vue's
        // render flush.
        const removeCollapseHook = router.afterEach((to) => {
          if (to.path === '/cohort') sidebarOpen.value = false
        })
        try {
          // Carry the view's own URL state (cohort filters/sort) across the switch
          await router.push({ path: '/cohort', query: queryForRoute('cohort') })
        } finally {
          removeCollapseHook()
        }
      } else {
        await router.push({ path: '/case', query: queryForRoute('case') })
      }
    } finally {
      // Allow the activated route view to settle before hiding the overlay,
      // and keep layout transitions off until the collapsed layout has been
      // styled once: re-enabling them in the same frame let the browser
      // animate v-main from the old sidebar width, sliding the (now
      // immediately rendered) cohort table sideways (desktop CLS ~1.4).
      await nextTick()
      await afterNextFrame()
      transitioning.value = false
    }
  })
}
