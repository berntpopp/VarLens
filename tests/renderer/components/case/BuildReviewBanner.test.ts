import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import BuildReviewBanner from '../../../../src/renderer/src/components/case/BuildReviewBanner.vue'
import { useBuildReviews } from '../../../../src/renderer/src/composables/useBuildReviews'
import { AppStateKey, createAppState } from '../../../../src/renderer/src/composables/useAppState'
import { BUILD_COPY } from '../../../../src/shared/config/genome-builds.config'
import { installCapabilities } from '../../helpers/capabilities'
import type { BuildReview } from '../../../../src/shared/types/build-review'

const vuetify = createVuetify({ components, directives })
const REVIEW: BuildReview = {
  caseId: 7,
  caseName: 'P7',
  storedBuild: 'GRCh38',
  suggestedBuild: 'GRCh37',
  reason: 'build_disagrees'
}

let pending: BuildReview[]
const resolveBuildReviews = vi.fn(async (choices: Array<{ caseId: number }>) => {
  pending = pending.filter((r) => !choices.some((c) => c.caseId === r.caseId))
  return choices.length
})
let inProgress = false

beforeEach(() => {
  setActivePinia(createPinia())
  installCapabilities({ runtime: 'desktop', role: 'admin' })
  pending = [REVIEW]
  ;(window as unknown as { api: unknown }).api = {
    cases: {
      buildReviews: vi.fn(async () => ({ reviews: pending, renameInProgress: inProgress })),
      resolveBuildReviews
    }
  }
})
afterEach(() => {
  inProgress = false
  resolveBuildReviews.mockClear()
  document.body.innerHTML = ''
})

describe('BuildReviewBanner', () => {
  it('names how many cases wait for a build check', async () => {
    const wrapper = mount(BuildReviewBanner, {
      global: { plugins: [vuetify], provide: { [AppStateKey as symbol]: createAppState() } }
    })
    await flushPromises()
    expect(wrapper.get('[data-testid="build-review-banner"]').text()).toContain(
      BUILD_COPY.reviewBanner(1)
    )
    wrapper.unmount()
  })

  it('confirm all sends one write with the preselected header build', async () => {
    pending = [
      REVIEW,
      { ...REVIEW, caseId: 8, caseName: 'P8', suggestedBuild: null, reason: 'no_evidence' }
    ]
    const wrapper = mount(BuildReviewBanner, {
      attachTo: document.body,
      global: { plugins: [vuetify], provide: { [AppStateKey as symbol]: createAppState() } }
    })
    await flushPromises()
    await wrapper.get('[data-testid="build-review-banner"] button').trigger('click')
    await flushPromises()
    const all = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(BUILD_COPY.reviewApplyAll(2))
    )!
    all.click()
    await flushPromises()
    expect(resolveBuildReviews).toHaveBeenCalledTimes(1)
    expect(resolveBuildReviews).toHaveBeenCalledWith([
      { caseId: 7, build: 'GRCh37' },
      { caseId: 8, build: 'GRCh38' }
    ])
    wrapper.unmount()
  })

  it('useBuildReviews.apply sends one write and reloads the list', async () => {
    const { reviews, load, apply } = useBuildReviews()
    await load()
    expect(reviews.value).toEqual([REVIEW])
    expect(await apply([{ caseId: 7, build: 'GRCh37' }])).toBe(1)
    expect(resolveBuildReviews).toHaveBeenCalledTimes(1)
    expect(reviews.value).toEqual([])
  })

  it('says when a background rename is still running', async () => {
    pending = []
    inProgress = true
    const wrapper = mount(BuildReviewBanner, {
      global: { plugins: [vuetify], provide: { [AppStateKey as symbol]: createAppState() } }
    })
    await flushPromises()
    expect(wrapper.get('[data-testid="rename-in-progress"]').text()).toContain(
      BUILD_COPY.renameInProgress
    )
    wrapper.unmount()
  })
})
