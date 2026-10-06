import { describe, it, expect, beforeEach } from 'vitest'
import { findTruncatedCellText } from '../../../src/renderer/src/utils/truncated-cell-tooltip'
import { findTooltipTarget } from '../../../src/renderer/src/composables/useDelegatedTooltip'

function setWidths(el: Element, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
}

function buildCell(html: string): HTMLTableCellElement {
  document.body.innerHTML = `
    <div class="v-data-table"><table><tbody><tr>
      <td id="cell">${html}</td>
    </tr></tbody></table></div>`
  return document.getElementById('cell') as HTMLTableCellElement
}

describe('findTruncatedCellText', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns the full text of a cell clipped by its own ellipsis', () => {
    const cell = buildCell('p.(Pro4115_Ala4116delinsArgSer)')
    setWidths(cell, 320, 200)
    expect(findTruncatedCellText(cell)).toBe('p.(Pro4115_Ala4116delinsArgSer)')
  })

  it('detects truncation on a nested element (transcript span)', () => {
    const cell = buildCell('<span class="transcript-truncated">NM_001267550.2</span>')
    const span = cell.querySelector('span') as HTMLElement
    setWidths(cell, 120, 120)
    setWidths(span, 160, 120)
    expect(findTruncatedCellText(span)).toBe('NM_001267550.2')
  })

  it('returns null when nothing is clipped', () => {
    const cell = buildCell('BRCA1')
    setWidths(cell, 60, 120)
    expect(findTruncatedCellText(cell)).toBeNull()
  })

  it('ignores elements outside data-table cells', () => {
    document.body.innerHTML = '<div id="x">long text</div>'
    const el = document.getElementById('x') as HTMLElement
    setWidths(el, 500, 10)
    expect(findTruncatedCellText(el)).toBeNull()
  })
})

describe('findTooltipTarget truncated-cell fallback', () => {
  it('uses the clipped cell as an implicit tooltip target', () => {
    const cell = buildCell('non_coding_transcript_intron_variant')
    setWidths(cell, 300, 200)
    const target = findTooltipTarget(cell)
    expect(target?.element).toBe(cell)
    expect(target?.text).toBe('non_coding_transcript_intron_variant')
    expect(target?.location).toBe('top')
  })

  it('still prefers an explicit data-tooltip element', () => {
    const cell = buildCell('<span data-tooltip="explicit">c.1A&gt;G</span>')
    setWidths(cell, 300, 200)
    const span = cell.querySelector('span') as HTMLElement
    expect(findTooltipTarget(span)?.text).toBe('explicit')
  })
})
