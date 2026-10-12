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
const resolveBuildReview = vi.fn(async (caseId: number) => {
  pending = pending.filter((r) => r.caseId !== caseId)
  return undefined
})

beforeEach(() => {
  setActivePinia(createPinia())
  pending = [REVIEW]
  ;(window as unknown as { api: unknown }).api = {
    cases: { buildReviews: vi.fn(async () => pending), resolveBuildReview }
  }
})
afterEach(() => {
  resolveBuildReview.mockClear()
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

  it('applies only the builds the user chose, then reloads', async () => {
    const { reviews, load, apply } = useBuildReviews()
    await load()
    expect(reviews.value).toEqual([REVIEW])
    expect(await apply(new Map([[7, 'GRCh37']]))).toBe(1)
    expect(resolveBuildReview).toHaveBeenCalledWith(7, 'GRCh37')
    expect(reviews.value).toEqual([])
  })
})
