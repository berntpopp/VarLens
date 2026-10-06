/**
 * Static VNode builders for table cells.
 *
 * `<v-icon>` and `<v-chip>` are full stateful components (two components per
 * icon: VIcon + VSvgIcon), and a variant-table page renders hundreds of them:
 * every link cell carries an "open in new" icon, every ClinVar value a chip.
 * In cells they are purely presentational, so these helpers emit the same DOM
 * and Vuetify classes as plain elements: no component instance, no reactive
 * setup, identical styling.
 *
 * Only the presentational subset is reproduced (no ripple, links, closable,
 * filter or group behaviour). Use the real Vuetify components for anything
 * interactive.
 */
import { h, type VNode, type VNodeChild } from 'vue'

export type CellIconSize = 'x-small' | 'small' | 'default' | 'large' | 'x-large'
export type CellChipSize = 'x-small' | 'small' | 'default'
export type CellChipVariant = 'tonal' | 'flat' | 'outlined' | 'text'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Same test Vuetify uses: CSS colours become inline styles, names become classes. */
export function isCssColor(color: string | null | undefined): color is string {
  return color !== null && color !== undefined && /^(#|var\(--|(rgb|hsl)a?\()/.test(color)
}

interface ColorBinding {
  class: string | undefined
  style: Record<string, string> | undefined
}

/** Mirror of Vuetify's computeColor for a single text or background colour. */
export function colorBinding(
  kind: 'text' | 'background',
  color: string | null | undefined
): ColorBinding {
  if (color === null || color === undefined || color === '') {
    return { class: undefined, style: undefined }
  }
  if (isCssColor(color)) {
    return {
      class: undefined,
      style:
        kind === 'text'
          ? { color, caretColor: color }
          : { backgroundColor: color, color: '#fff', caretColor: '#fff' }
    }
  }
  return { class: kind === 'text' ? `text-${color}` : `bg-${color}`, style: undefined }
}

export interface IconOptions {
  size?: CellIconSize
  color?: string | null
  class?: string
}

/** `<v-icon :icon="path">` markup (mdi-svg icon set) without the two components. */
export function iconVNode(path: string, options: IconOptions = {}): VNode {
  const { size = 'default', color, class: extraClass } = options
  const tint = colorBinding('text', color)
  return h(
    'i',
    {
      class: ['v-icon notranslate', `v-icon--size-${size}`, tint.class, extraClass],
      style: tint.style,
      'aria-hidden': 'true'
    },
    [
      h(
        'svg',
        {
          class: 'v-icon__svg',
          xmlns: SVG_NS,
          viewBox: '0 0 24 24',
          role: 'img',
          'aria-hidden': 'true'
        },
        [h('path', { d: path })]
      )
    ]
  )
}

export interface ChipOptions {
  color?: string | null
  size?: CellChipSize
  variant?: CellChipVariant
  label?: boolean
  attrs?: Record<string, unknown>
}

/** Static `<v-chip>` markup (compact density, non-interactive). */
export function chipVNode(content: VNodeChild, options: ChipOptions = {}): VNode {
  const { color, size = 'default', variant = 'tonal', label = false, attrs } = options
  const filled = variant === 'flat'
  const tint = colorBinding(filled ? 'background' : 'text', color)
  return h(
    'span',
    {
      ...attrs,
      class: [
        'v-chip',
        label && 'v-chip--label',
        tint.class,
        'v-chip--density-compact',
        `v-chip--size-${size}`,
        `v-chip--variant-${variant}`
      ],
      style: tint.style,
      draggable: 'false'
    },
    [
      h('span', { class: 'v-chip__underlay' }),
      h('div', { class: 'v-chip__content', 'data-no-activator': '' }, [content])
    ]
  )
}
