/**
 * Presentational table cells as functional components.
 *
 * A variant-table page mounts these once per row and column (hundreds per
 * page, up to 25 columns at 4x CPU on mobile). As `<script setup>` SFCs each
 * one paid for a stateful instance with computed refs plus a nested
 * VIcon/VSvgIcon or VChip; as functional components they are a single render
 * call that emits the same DOM (see cell-vnodes.ts for the icon/chip markup).
 *
 * Props and emitted events are unchanged from the SFC versions; link cells
 * render real anchors (keyboard-reachable, see linkAttrs).
 * Tooltips use the app-wide delegated tooltip (`data-tooltip`).
 */
import { h, type FunctionalComponent, type PropType, type VNode } from 'vue'
import { mdiOpenInNew } from '@mdi/js'
import { EMPTY_VALUE_PLACEHOLDER } from '../../utils/formatters'
import {
  formatCaddScore,
  formatPosition,
  formatScientific
} from '../../composables/useTableFormatters'
import { getCaddColor, getClinVarColor, getImpactColor } from '../../composables/useTableColors'
import { chipVNode, iconVNode } from './cell-vnodes'

type LinkEmits = { click: (url: string, event: MouseEvent) => void }
type LinkEmit = (event: 'click', url: string, mouse: MouseEvent) => void

const TOOLTIP_TOP = 'top'

function hasText(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== ''
}

function placeholder(className = 'text-muted'): VNode {
  return h('span', { class: className }, EMPTY_VALUE_PLACEHOLDER)
}

function linkIcon(): VNode {
  return iconVNode(mdiOpenInNew, { size: 'x-small', class: 'external-link__icon' })
}

/**
 * Real anchor attributes for a link cell: focusable, announced as a link,
 * Enter activates it, and middle-click / copy-link still see the href. The
 * click is intercepted and re-emitted so Electron routes it through the
 * validated shell.openExternal.
 */
function linkAttrs(emit: LinkEmit, url: string, ariaLabel: string): Record<string, unknown> {
  return {
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': ariaLabel,
    onClick: (event: MouseEvent) => {
      event.preventDefault()
      emit('click', url, event)
    }
  }
}

const urlProp = { type: String as PropType<string | null>, default: null }

// ── Placeholder ─────────────────────────────────────────────────────────────

export const EmptyPlaceholder: FunctionalComponent = () => placeholder()
EmptyPlaceholder.displayName = 'EmptyPlaceholder'

// ── Links ───────────────────────────────────────────────────────────────────

export const ExternalLinkCell: FunctionalComponent<
  { url: string | null; label?: string; ariaLabel?: string },
  LinkEmits
> = (props, { emit }) => {
  if (!hasText(props.url)) return placeholder('text-medium-emphasis')
  const label = props.label ?? 'View'
  const ariaLabel = props.ariaLabel ?? `${label} (opens in a new tab)`
  return h('a', { class: 'external-link', ...linkAttrs(emit as LinkEmit, props.url, ariaLabel) }, [
    `${label} `,
    linkIcon()
  ])
}
ExternalLinkCell.displayName = 'ExternalLinkCell'
ExternalLinkCell.props = {
  url: urlProp,
  label: { type: String, default: 'View' },
  /** Accessible name; defaults to "<label> (opens in a new tab)". */
  ariaLabel: { type: String, default: undefined }
}
ExternalLinkCell.emits = ['click']

export const PositionCell: FunctionalComponent<
  { position: number; url?: string | null },
  LinkEmits
> = (props, { emit }) => {
  const text = formatPosition(props.position)
  if (!hasText(props.url)) return h('span', { class: 'genomic-coordinate' }, text)
  const ariaLabel = `Position ${text} in genome browser (opens in a new tab)`
  return h(
    'a',
    {
      class: 'external-link genomic-coordinate',
      ...linkAttrs(emit as LinkEmit, props.url, ariaLabel)
    },
    [`${text} `, linkIcon()]
  )
}
PositionCell.displayName = 'PositionCell'
PositionCell.props = { position: { type: Number, required: true }, url: urlProp }
PositionCell.emits = ['click']

export const GeneSymbolCell: FunctionalComponent<
  { value: string | null; linkUrl?: string | null },
  LinkEmits
> = (props, { emit }) => {
  if (!hasText(props.value) || !hasText(props.linkUrl)) {
    return h('span', { class: 'gene-symbol' }, props.value ?? EMPTY_VALUE_PLACEHOLDER)
  }
  const ariaLabel = `${props.value} (opens in a new tab)`
  return h(
    'a',
    {
      class: 'external-link gene-symbol',
      ...linkAttrs(emit as LinkEmit, props.linkUrl, ariaLabel)
    },
    [`${props.value} `, linkIcon()]
  )
}
GeneSymbolCell.displayName = 'GeneSymbolCell'
GeneSymbolCell.props = {
  value: { type: String as PropType<string | null>, default: null },
  linkUrl: urlProp
}
GeneSymbolCell.emits = ['click']

export const ClinVarCell: FunctionalComponent<
  { significance: string | null; url?: string | null },
  LinkEmits
> = (props, { emit }) => {
  if (!hasText(props.significance)) return placeholder()
  const tooltip = { 'data-tooltip': props.significance, 'data-tooltip-location': TOOLTIP_TOP }
  const chip = (attrs?: Record<string, unknown>): VNode =>
    chipVNode(props.significance!.replace(/_/g, ' '), {
      color: getClinVarColor(props.significance),
      size: 'small',
      label: true,
      attrs
    })
  if (!hasText(props.url)) return chip(tooltip)
  const ariaLabel = `ClinVar: ${props.significance.replace(/_/g, ' ')} (opens in a new tab)`
  return h(
    'a',
    { class: 'external-link', ...tooltip, ...linkAttrs(emit as LinkEmit, props.url, ariaLabel) },
    [chip(), linkIcon()]
  )
}
ClinVarCell.displayName = 'ClinVarCell'
ClinVarCell.props = {
  significance: { type: String as PropType<string | null>, default: null },
  url: urlProp
}
ClinVarCell.emits = ['click']

// ── Values ──────────────────────────────────────────────────────────────────

export const AlleleCell: FunctionalComponent<{ allele: string; maxLength?: number }> = (props) => {
  const maxLength = props.maxLength ?? 20
  if (props.allele.length <= maxLength) {
    return h('span', { class: 'variant-data-mono' }, props.allele)
  }
  return h(
    'span',
    {
      class: 'text-truncate allele-cell variant-data-mono',
      'data-tooltip': props.allele,
      'data-tooltip-location': TOOLTIP_TOP
    },
    `${props.allele.substring(0, maxLength)}...`
  )
}
AlleleCell.displayName = 'AlleleCell'
AlleleCell.props = {
  allele: { type: String, required: true },
  maxLength: { type: Number, default: 20 }
}

export const FrequencyCell: FunctionalComponent<{ frequency: number | null }> = (props) =>
  h('span', formatScientific(props.frequency))
FrequencyCell.displayName = 'FrequencyCell'
FrequencyCell.props = { frequency: { type: Number as PropType<number | null>, default: null } }

export const CaddScoreCell: FunctionalComponent<{ score: number | null; asChip?: boolean }> = (
  props
) => {
  if (props.score === null || props.score === undefined) return h('span', EMPTY_VALUE_PLACEHOLDER)
  const text = formatCaddScore(props.score)
  if (props.asChip !== true) return h('span', text)
  return chipVNode(text, { color: getCaddColor(props.score), size: 'small', label: true })
}
CaddScoreCell.displayName = 'CaddScoreCell'
CaddScoreCell.props = {
  score: { type: Number as PropType<number | null>, default: null },
  asChip: { type: Boolean, default: false }
}

export const ConsequenceCell: FunctionalComponent<{
  consequence: string | null
  impact?: string | null
  asChip?: boolean
}> = (props) => {
  if (!hasText(props.consequence)) return h('span', EMPTY_VALUE_PLACEHOLDER)
  const text = props.consequence.replace(/_/g, ' ')
  const tooltip = { 'data-tooltip': props.consequence, 'data-tooltip-location': TOOLTIP_TOP }
  if (props.asChip !== true) return h('span', tooltip, text)
  const color = hasText(props.impact) ? getImpactColor(props.impact) : 'grey'
  return chipVNode(text, { color, size: 'small', label: true, attrs: tooltip })
}
ConsequenceCell.displayName = 'ConsequenceCell'
ConsequenceCell.props = {
  consequence: { type: String as PropType<string | null>, default: null },
  impact: { type: String as PropType<string | null>, default: null },
  asChip: { type: Boolean, default: false }
}

export const HgvsCell: FunctionalComponent<{ value: string | null | undefined }> = (props) => {
  if (!hasText(props.value)) return placeholder()
  return h(
    'span',
    { class: 'hgvs-notation', 'data-tooltip': props.value, 'data-tooltip-location': TOOLTIP_TOP },
    props.value
  )
}
HgvsCell.displayName = 'HgvsCell'
HgvsCell.props = { value: { type: String as PropType<string | null>, default: null } }
