import { createRouter, createMemoryHistory, createWebHistory } from 'vue-router'
import { isWebRuntime } from '../utils/runtime-mode'

/**
 * Vue Router for VarLens.
 *
 * Web mode uses HTML5 history under the app base path, so the URL carries
 * view state (`?case=&tab=&f=&q=&sort=`, see composables/useUrlState.ts):
 * reload restores the view and back/forward works. Electron has no URL bar
 * and loads from file://, so it keeps memory history. Two main routes:
 * - /case — single case analysis (default)
 * - /cohort — multi-case cohort analysis
 *
 * Both routes are lazy-loaded to reduce initial bundle size.
 * The non-default route chunk is prefetched during idle time
 * so the first navigation is instant.
 */

// Keep a reference to the lazy import so we can prefetch it
const loadCohortView = () => import('../views/CohortView.vue')

const router = createRouter({
  history: isWebRuntime() ? createWebHistory(import.meta.env.BASE_URL) : createMemoryHistory(),
  routes: [
    {
      path: '/',
      // Keep the query: a shared `/?case=12&tab=snv` link must survive the redirect
      redirect: (to) => ({ path: '/case', query: to.query })
    },
    {
      path: '/case',
      name: 'case',
      component: () => import('../views/CaseView.vue')
    },
    {
      path: '/cohort',
      name: 'cohort',
      component: loadCohortView
    }
  ]
})

// Prefetch CohortView chunk during idle time after initial load.
// This eliminates the lazy-load delay on first navigation to Cohort.
if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => {
    loadCohortView()
  })
} else {
  setTimeout(() => {
    loadCohortView()
  }, 2000)
}

export default router
