/** SVG path of a ClinVar class marker (#572): the plots and the legends draw the same shape. */
import * as d3 from 'd3'
import type { ClinVarSignificance } from '../../../shared/types/protein'
import { CLINVAR_SHAPES, type ClinVarShape } from '../../../shared/utils/protein-utils'

const SYMBOLS: Record<ClinVarShape, d3.SymbolType> = {
  triangle: d3.symbolTriangle,
  diamond: d3.symbolDiamond,
  circle: d3.symbolCircle,
  square: d3.symbolSquare,
  cross: d3.symbolCross,
  wye: d3.symbolWye
}

/** Centred on 0,0; `size` is the area in px². */
export const clinvarMarkPath = (cls: ClinVarSignificance, size: number): string =>
  d3.symbol(SYMBOLS[CLINVAR_SHAPES[cls]], size)() ?? ''
