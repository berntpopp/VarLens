/** Exported plots carry real colours: an SVG file or PNG canvas has no Vuetify CSS variables. */
import { describe, expect, it } from 'vitest'

import { svgMarkup } from '../../../src/renderer/src/utils/svg-export'

describe('svgMarkup', () => {
  it('replaces every theme variable with its computed colour', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.style.setProperty('--v-theme-on-surface', '33,33,33')
    svg.style.setProperty('--v-theme-primary', '24,103,192')
    svg.innerHTML =
      '<line stroke="rgba(var(--v-theme-on-surface), 0.62)"/>' +
      '<rect fill="rgb(var(--v-theme-primary))"/>' +
      '<text style="fill: rgb(var(--v-theme-on-surface))">x</text>'
    document.body.appendChild(svg)

    const markup = svgMarkup(svg)

    expect(markup).not.toContain('var(')
    expect(markup).toContain('rgba(33,33,33, 0.62)')
    expect(markup).toContain('rgb(24,103,192)')
    expect(markup).toContain('fill: rgb(33,33,33)')
  })

  it('no SVG: nothing to export', () => {
    expect(svgMarkup(null)).toBe('')
  })
})
