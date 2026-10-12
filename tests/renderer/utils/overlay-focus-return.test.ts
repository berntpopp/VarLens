import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installOverlayFocusReturn } from '@renderer/utils/overlay-focus-return'

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

describe('installOverlayFocusReturn', () => {
  let uninstall: () => void
  beforeEach(() => (uninstall = installOverlayFocusReturn()))
  afterEach(() => {
    uninstall()
    document.body.replaceChildren()
  })

  function setup(): {
    trigger: HTMLButtonElement
    overlay: HTMLDivElement
    input: HTMLInputElement
  } {
    const trigger = document.createElement('button')
    const overlay = document.createElement('div')
    overlay.className = 'v-overlay'
    const input = document.createElement('input')
    overlay.appendChild(input)
    document.body.append(trigger, overlay)
    return { trigger, overlay, input }
  }

  it('returns focus to the last element outside an overlay when the overlay closes', async () => {
    const { trigger, overlay, input } = setup()
    trigger.focus()
    input.focus()
    // Chromium fires focusout (relatedTarget null) when a focused element is hidden
    input.blur()
    overlay.remove()
    await frame()
    expect(document.activeElement).toBe(trigger)
  })

  it('leaves focus alone when it moved somewhere else', async () => {
    const { trigger, input } = setup()
    const other = document.createElement('button')
    document.body.appendChild(other)
    trigger.focus()
    input.focus()
    other.focus()
    await frame()
    expect(document.activeElement).toBe(other)
  })
  it('does not pull focus out of an overlay that is still open', async () => {
    const { trigger, overlay, input } = setup()
    overlay.classList.add('v-dialog', 'v-overlay--active')
    trigger.focus()
    input.focus()
    input.blur()
    await frame()
    expect(document.activeElement).toBe(document.body)
  })
  it('returns focus while a snackbar (not a popup) is still showing', async () => {
    const { trigger, overlay, input } = setup()
    const snackbar = document.createElement('div')
    snackbar.className = 'v-snackbar v-overlay v-overlay--active'
    document.body.appendChild(snackbar)
    trigger.focus()
    input.focus()
    input.blur()
    overlay.remove()
    await frame()
    expect(document.activeElement).toBe(trigger)
  })
})
