import { createRouter, createMemoryHistory } from 'vue-router'
import CaseView from '../views/CaseView.vue'
import CohortView from '../views/CohortView.vue'

/**
 * Vue Router for VarLens.
 *
 * Uses memory history (no URL bar in Electron) with two main routes:
 * - /case — single case analysis (default)
 * - /cohort — multi-case cohort analysis
 */
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: '/',
      redirect: '/case'
    },
    {
      path: '/case',
      name: 'case',
      component: CaseView
    },
    {
      path: '/cohort',
      name: 'cohort',
      component: CohortView
    }
  ]
})

export default router
