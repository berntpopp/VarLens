/**
 * Template-friendly wrappers around the static icon/chip builders.
 *
 * `<CellIcon>` / `<CellChip>` are drop-in replacements for presentational
 * `<v-icon>` / `<v-chip>` inside per-row table markup: same DOM and classes,
 * but functional components, so a page of rows does not mount hundreds of
 * VIcon + VSvgIcon + VChip instances.
 */
import type { FunctionalComponent, PropType } from 'vue'
import {
  chipVNode,
  iconVNode,
  type CellChipSize,
  type CellChipVariant,
  type CellIconSize
} from './cell-vnodes'

const colorProp = { type: String as PropType<string | null>, default: null }

export const CellIcon: FunctionalComponent<{
  icon: string
  size?: CellIconSize
  color?: string | null
}> = (props) => iconVNode(props.icon, { size: props.size, color: props.color })
CellIcon.displayName = 'CellIcon'
CellIcon.props = {
  icon: { type: String, required: true },
  size: { type: String as PropType<CellIconSize>, default: 'default' },
  color: colorProp
}

export const CellChip: FunctionalComponent<{
  color?: string | null
  size?: CellChipSize
  variant?: CellChipVariant
  label?: boolean
}> = (props, { slots }) =>
  chipVNode(slots.default?.(), {
    color: props.color,
    size: props.size,
    variant: props.variant,
    label: props.label
  })
CellChip.displayName = 'CellChip'
CellChip.props = {
  color: colorProp,
  size: { type: String as PropType<CellChipSize>, default: 'default' },
  variant: { type: String as PropType<CellChipVariant>, default: 'tonal' },
  label: { type: Boolean, default: false }
}
