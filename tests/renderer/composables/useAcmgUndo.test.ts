import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, provide } from 'vue'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'

const annotations = {
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
  beforeEach(() => vi.clearAllMocks())

  it('offers Undo after a per-case class pick and restores the previous value', async () => {
    annotations.getAcmgClassification.mockReturnValue('Uncertain significance')
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
    annotations.getAcmgClassification.mockReturnValue('Uncertain significance')
    annotations.setAcmgClassification.mockResolvedValueOnce(false)
    const { acmg, snacks } = mountWithSnack()

    const saved = await acmg.setAcmgClassification(7, 42, 'chr1', 100, 'A', 'G', 'Pathogenic')

    expect(saved).toBe(false)
    expect(snacks).toHaveLength(0)
  })

  it('shows no snackbar when the classification did not change', async () => {
    annotations.getAcmgClassification.mockReturnValue('Benign')
    const { acmg, snacks } = mountWithSnack()
    await acmg.setAcmgClassification(1, 2, 'chrX', 9, 'G', 'A', 'Benign')
    expect(snacks).toHaveLength(0)
  })

  it('does not leak sibling classification into Undo when classifying an unannotated sibling at the same coordinate', async () => {
    const {
      resetAnnotationState,
      beginAnnotationRequest,
      cacheSet,
      ensurePerCaseSlotOwner,
      setPerCaseByVariantId
    } = await import('../../../src/renderer/src/composables/annotation-cache')
    resetAnnotationState()
    beginAnnotationRequest(1, 'GRCh38')
    const key = 'chr1:100:A:G'
    const sibling11 = {
      id: 1,
      case_id: 1,
      variant_id: 11,
      starred: 0,
      acmg_classification: 'Pathogenic' as const,
      acmg_evidence: '{"pathogenic":["PVS1"]}',
      per_case_comment: null,
      created_at: 0,
      updated_at: 0
    }
    cacheSet(key, { global: null, perCase: sibling11 })
    ensurePerCaseSlotOwner(key, 1, 11)
    setPerCaseByVariantId(1, 11, sibling11, key)

    // Coordinate getter returns sibling 11's Pathogenic, while loadAnnotations populates null for sibling 12
    annotations.getAcmgClassification.mockReturnValue('Pathogenic')
    annotations.getAcmgEvidence.mockReturnValue('{"pathogenic":["PVS1"]}')
    ;(annotations as Record<string, unknown>).loadAnnotations = vi.fn(
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

    expect((annotations as Record<string, unknown>).loadAnnotations).toHaveBeenCalledWith(
      1,
      'chr1',
      100,
      'A',
      'G',
      12
    )
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
    delete (annotations as Record<string, unknown>).loadAnnotations
    resetAnnotationState()
  })
})
