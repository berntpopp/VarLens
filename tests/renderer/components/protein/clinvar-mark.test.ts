/** ClinVar classes differ by shape as well as colour, so greyscale tells them apart (#572). */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ClinVarMark from '../../../../src/renderer/src/components/protein/ClinVarMark.vue'
import { clinvarMarkPath } from '../../../../src/renderer/src/utils/clinvar-mark'
import { CLINVAR_COLORS, CLINVAR_SHAPES } from '../../../../src/shared/utils/protein-utils'
import type { ClinVarSignificance } from '../../../../src/shared/types/protein'

const CLASSES = Object.keys(CLINVAR_COLORS) as ClinVarSignificance[]

describe('ClinVar marks', () => {
  it('gives every class its own shape', () => {
    expect(Object.keys(CLINVAR_SHAPES).sort()).toEqual([...CLASSES].sort())
    expect(new Set(Object.values(CLINVAR_SHAPES)).size).toBe(CLASSES.length)
    expect(new Set(CLASSES.map((c) => clinvarMarkPath(c, 64))).size).toBe(CLASSES.length)
  })

  it('draws the legend mark in the class shape and the given colour', () => {
    const path = mount(ClinVarMark, { props: { cls: 'pathogenic', color: '#c00' } }).find('path')
    expect(path.attributes('d')).toBe(clinvarMarkPath('pathogenic', 36))
    expect(path.attributes('fill')).toBe('#c00')
  })
})
