import { describe, expect, it } from 'vitest'
import {
  WEB_UNAVAILABLE_MESSAGE,
  isRuntimeFeatureAvailable,
  runtimeFeatureUnavailableReason,
  type RuntimeFeature
} from '../../../src/renderer/src/utils/runtime-features'

const ALL: RuntimeFeature[] = Object.keys(WEB_UNAVAILABLE_MESSAGE) as RuntimeFeature[]

describe('runtime feature gating', () => {
  it('enables every gated feature on desktop', () => {
    for (const feature of ALL) {
      expect(isRuntimeFeatureAvailable(feature, false)).toBe(true)
      expect(runtimeFeatureUnavailableReason(feature, false)).toBeNull()
    }
  })

  it('disables web-unsupported features with an explicit user-facing reason', () => {
    for (const feature of ALL) {
      expect(isRuntimeFeatureAvailable(feature, true)).toBe(false)
      expect(runtimeFeatureUnavailableReason(feature, true)).toMatch(/web version|server/i)
    }
  })

  it('keeps only the gene-reference update desktop-only', () => {
    expect(ALL).toEqual(['geneRefUpdate'])
  })
})
