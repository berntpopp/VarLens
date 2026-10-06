/**
 * Behaviour of optimistic annotation writes when the write does not land:
 * a failed write must roll back AND tell watchers, in every operation and
 * both scopes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { watch } from 'vue'
import { createMockApi } from '../../utils/mock-api'
import {
  useAnnotations,
  annotationCache,
  _resetAnnotationsForTesting
} from '@renderer/composables/useAnnotations'
import { logService } from '@renderer/services/LogService'

type Annotations = ReturnType<typeof useAnnotations>

const V = ['chr1', 100, 'A', 'G'] as const
const KEY = 'chr1:100:A:G'
const CASE_ID = 1
const VARIANT_ID = 11

const WRITES: Record<string, (a: Annotations) => Promise<void>> = {
  toggleStar: (a) => a.toggleStar(CASE_ID, VARIANT_ID, ...V),
  toggleGlobalStar: (a) => a.toggleGlobalStar(...V),
  setAcmgClassification: (a) => a.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'Pathogenic'),
  setGlobalAcmgClassification: (a) => a.setGlobalAcmgClassification(...V, 'Pathogenic'),
  upsertPerCaseComment: (a) => a.upsertPerCaseComment(CASE_ID, VARIANT_ID, ...V, 'note'),
  upsertGlobalComment: (a) => a.upsertGlobalComment(...V, 'note'),
  setAcmgClassificationWithEvidence: (a) =>
    a.setAcmgClassificationWithEvidence(CASE_ID, VARIANT_ID, ...V, 'Pathogenic', '{"PVS1":true}'),
  setGlobalAcmgClassificationWithEvidence: (a) =>
    a.setGlobalAcmgClassificationWithEvidence(...V, 'Pathogenic', '{"PVS1":true}')
}

function seedEntry(): void {
  annotationCache.value.set(KEY, {
    global: {
      starred: 0,
      acmg_classification: 'Benign',
      acmg_evidence: '{"BA1":true}',
      global_comment: 'old'
    },
    perCase: {
      case_id: CASE_ID,
      variant_id: VARIANT_ID,
      starred: 0,
      acmg_classification: 'Benign',
      acmg_evidence: '{"BA1":true}',
      per_case_comment: 'old'
    }
  } as never)
}

describe('failed annotation writes roll back and notify watchers', () => {
  let triggers = 0
  let stopWatch: () => void

  beforeEach(() => {
    _resetAnnotationsForTesting()
    window.api = createMockApi()
    vi.spyOn(logService, 'error').mockImplementation(() => {})
    window.api.annotations.upsertPerCase = vi.fn().mockRejectedValue(new Error('boom'))
    window.api.annotations.upsertGlobal = vi.fn().mockRejectedValue(new Error('boom'))
    triggers = 0
    stopWatch = watch(annotationCache, () => triggers++, { flush: 'sync' })
  })

  afterEach(() => {
    stopWatch()
    vi.restoreAllMocks()
  })

  it.each(Object.keys(WRITES))('%s on a cached entry', async (name) => {
    seedEntry()
    const before = structuredClone(annotationCache.value.get(KEY))

    await WRITES[name](useAnnotations())

    // The optimistic value is gone ...
    expect(annotationCache.value.get(KEY)).toEqual(before)
    // ... and watchers were told: once for the optimistic write, once for the rollback.
    expect(triggers).toBe(2)
  })

  it.each(Object.keys(WRITES))('%s on an uncached entry', async (name) => {
    await WRITES[name](useAnnotations())

    expect(annotationCache.value.has(KEY)).toBe(false)
    expect(triggers).toBe(1)
  })
})
