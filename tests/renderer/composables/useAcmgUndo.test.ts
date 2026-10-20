import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, provide } from 'vue'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'
import {
  beginAnnotationRequest,
  cacheSet,
  ensurePerCaseSlotOwner,
  resetAnnotationState,
  setPerCaseByVariantId
} from '../../../src/renderer/src/composables/annotation-cache'
import type { CaseVariantAnnotation } from '../../../src/shared/types/database-entities'

const annotations = {
  loadAnnotations: vi.fn(async () => {}),
  getAcmgClassification: vi.fn(),
  getGlobalAcmgClassification: vi.fn(),
  getAcmgEvidence: vi.fn(),
  getGlobalAcmgEvidence: vi.fn(),
  setAcmgClassification: vi.fn(async () => true),
  setGlobalAcmgClassification: vi.fn(async () => true),
  setAcmgClassificationWithEvidence: vi.fn(async () => true),
  setGlobalAcmgClassificationWithEvidence: vi.fn(async () => true)
}
vi.mock('../../../src/renderer/src/composables/useAnnotations', () => ({
  useAnnotations: () => annotations
}))

const { useAcmgUndo } = await import('../../../src/renderer/src/composables/useAcmgUndo')

type Snack = [string, string, { action?: { text: string; callback: () => void } }?]

function mockPerCase(
  caseId: number,
  variantId: number,
  extra: Partial<CaseVariantAnnotation> = {}
): CaseVariantAnnotation {
  return {
    id: variantId,
    case_id: caseId,
    variant_id: variantId,
    starred: 0,
    acmg_classification: null,
    acmg_evidence: null,
    per_case_comment: null,
    created_at: 0,
    updated_at: 0,
    ...extra
  }
}

function mountWithSnack(): { acmg: ReturnType<typeof useAcmgUndo>; snacks: Snack[] } {
  const snacks: Snack[] = []
  let acmg!: ReturnType<typeof useAcmgUndo>
  const Child = {
    setup() {
      acmg = useAcmgUndo()
      return () => null
    }
  }
  createApp({
    setup() {
      const state = createAppState()
      state.setSnackbarHandler((m, t, o) => snacks.push([m, t, o as Snack[2]]))
      provide(AppStateKey, state)
      return () => h(Child)
    }
  }).mount(document.createElement('div'))
  return { acmg, snacks }
}

describe('useAcmgUndo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAnnotationState()
    annotations.loadAnnotations.mockImplementation(async () => {})
  })

  it('offers Undo after a per-case class pick and restores the previous value', async () => {
    setPerCaseByVariantId(
      7,
      42,
      mockPerCase(7, 42, { acmg_classification: 'Uncertain significance' }),
      'chr1:100:A:G'
    )
    const { acmg, snacks } = mountWithSnack()

    await acmg.setAcmgClassification(7, 42, 'chr1', 100, 'A', 'G', 'Likely pathogenic')

    expect(annotations.setAcmgClassification).toHaveBeenCalledWith(
      7,
      42,
      'chr1',
      100,
      'A',
      'G',
      'Likely pathogenic'
    )
    const [message, , options] = snacks[0]
    expect(message).toBe('Classified as Likely pathogenic')
    expect(options?.action?.text).toBe('Undo')

    options!.action!.callback()
    await Promise.resolve()
    expect(annotations.setAcmgClassification).toHaveBeenLastCalledWith(
      7,
      42,
      'chr1',
      100,
      'A',
      'G',
      'Uncertain significance'
    )
  })

  it('restores previous evidence when undoing an evidence-backed change', async () => {
    annotations.getGlobalAcmgClassification.mockReturnValue(null)
    annotations.getGlobalAcmgEvidence.mockReturnValue(null)
    const { acmg, snacks } = mountWithSnack()

    await acmg.setGlobalAcmgClassificationWithEvidence(
      'chr2',
      5,
      'C',
      'T',
      'Pathogenic',
      '{"pathogenic":["PVS1","PS1"]}'
    )
    snacks[0][2]!.action!.callback()
    await Promise.resolve()
    expect(annotations.setGlobalAcmgClassificationWithEvidence).toHaveBeenLastCalledWith(
      'chr2',
      5,
      'C',
      'T',
      null,
      ''
    )
  })

  // #486: the write failed and was rolled back; useAnnotations shows the error.
  it('offers no Undo and no success message when the write failed', async () => {
    setPerCaseByVariantId(
      7,
      42,
      mockPerCase(7, 42, { acmg_classification: 'Uncertain significance' }),
      'chr1:100:A:G'
    )
    annotations.setAcmgClassification.mockResolvedValueOnce(false)
    const { acmg, snacks } = mountWithSnack()

    const saved = await acmg.setAcmgClassification(7, 42, 'chr1', 100, 'A', 'G', 'Pathogenic')

    expect(saved).toBe(false)
    expect(snacks).toHaveLength(0)
  })

  it('shows no snackbar when the classification did not change', async () => {
    setPerCaseByVariantId(1, 2, mockPerCase(1, 2, { acmg_classification: 'Benign' }), 'chrX:9:G:A')
    const { acmg, snacks } = mountWithSnack()
    await acmg.setAcmgClassification(1, 2, 'chrX', 9, 'G', 'A', 'Benign')
    expect(snacks).toHaveLength(0)
  })

  it('shows plain success snackbar without Undo when prior per-case state is still unknown (batch load in flight)', async () => {
    const { acmg, snacks } = mountWithSnack()

    await acmg.setAcmgClassification(7, 42, 'chr1', 100, 'A', 'G', 'Benign')

    expect(annotations.loadAnnotations).toHaveBeenCalledWith(7, 'chr1', 100, 'A', 'G', 42)
    expect(snacks).toHaveLength(1)
    expect(snacks[0][0]).toBe('Classified as Benign')
    expect(snacks[0][1]).toBe('success')
    expect(snacks[0][2]?.action).toBeUndefined()
  })

  it('does not leak sibling classification into Undo when classifying an unannotated sibling at the same coordinate', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    const key = 'chr1:100:A:G'
    const sibling11 = mockPerCase(1, 11, {
      id: 1,
      acmg_classification: 'Pathogenic',
      acmg_evidence: '{"pathogenic":["PVS1"]}'
    })
    cacheSet(key, { global: null, perCase: sibling11 })
    ensurePerCaseSlotOwner(key, 1, 11)
    setPerCaseByVariantId(1, 11, sibling11, key)

    annotations.loadAnnotations.mockImplementation(
      async (
        caseId: number,
        _chr: string,
        _pos: number,
        _ref: string,
        _alt: string,
        vid?: number
      ) => {
        if (vid === 12) setPerCaseByVariantId(caseId, 12, null, key)
      }
    )

    const { acmg, snacks } = mountWithSnack()
    await acmg.setAcmgClassification(1, 12, 'chr1', 100, 'A', 'G', 'Benign')

    expect(annotations.loadAnnotations).toHaveBeenCalledWith(1, 'chr1', 100, 'A', 'G', 12)
    expect(snacks).toHaveLength(1)
    snacks[0][2]!.action!.callback()
    await Promise.resolve()

    expect(annotations.setAcmgClassification).toHaveBeenLastCalledWith(
      1,
      12,
      'chr1',
      100,
      'A',
      'G',
      null
    )
  })
})
