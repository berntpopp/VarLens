import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAnnotationDialogs } from '../../../src/renderer/src/composables/useAnnotationDialogs'

const VARIANT = { id: 11, chr: 'chr1', pos: 100, ref: 'A', alt: 'G' }

function setup(saved: boolean) {
  const annotations = {
    upsertGlobalComment: vi.fn(async () => saved),
    upsertPerCaseComment: vi.fn(async () => saved)
  }
  const dialogs = useAnnotationDialogs(ref(1), annotations as never)
  dialogs.openCommentDialog(VARIANT as never)
  return dialogs
}

const CHANGED = {
  globalComment: 'note',
  perCaseComment: 'note',
  globalChanged: true,
  perCaseChanged: true
}

describe('useAnnotationDialogs comment save', () => {
  it('closes the dialog once the comment is saved', async () => {
    const dialogs = setup(true)
    await dialogs.handleCommentSave(CHANGED)
    expect(dialogs.commentDialogOpen.value).toBe(false)
  })

  // #486: closing would discard the typed comment of a write that never landed.
  it('keeps the dialog open when the save failed', async () => {
    const dialogs = setup(false)
    await dialogs.handleCommentSave(CHANGED)
    expect(dialogs.commentDialogOpen.value).toBe(true)
  })
})
