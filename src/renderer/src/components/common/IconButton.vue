<template>
  <v-btn
    icon
    :variant="variant"
    :color="color"
    :width="dimensions.button"
    :height="dimensions.button"
    :disabled="disabled"
    :loading="loading"
    :active="active"
    :aria-label="label"
    :aria-pressed="pressed"
    :data-tooltip="tooltipText"
    :data-tooltip-location="tooltipText ? tooltipLocation : undefined"
    class="icon-button"
  >
    <v-icon :icon="icon" :color="iconColor" :size="dimensions.icon" />
  </v-btn>
</template>

<script setup lang="ts">
/**
 * Icon-only button with a guaranteed accessible name.
 *
 * - `label` becomes the aria-label and (by default) the tooltip text, so the
 *   visual hint and the announced name never drift apart.
 * - The icon is passed as an SVG path prop and sized inside the button, so it
 *   can't be clipped by a smaller button box.
 * - Targets never drop below 24x24 (WCAG 2.5.8); the default is 32x32.
 * - Tooltips are rendered by the single app-wide DelegatedTooltip via
 *   `data-tooltip`, not by a v-tooltip per button.
 *
 * Extra attributes and listeners (e.g. v-menu activator props, @click) fall
 * through to the underlying v-btn.
 */
import { computed } from 'vue'
import { ICON_BUTTON_SIZES, type IconButtonSize } from './icon-button-sizes'

interface Props {
  /** Accessible name; also the tooltip text unless `tooltip` overrides it. */
  label: string
  /** SVG path from @mdi/js. */
  icon: string
  size?: IconButtonSize
  variant?: 'text' | 'flat' | 'tonal' | 'outlined' | 'plain' | 'elevated'
  color?: string
  iconColor?: string
  /** Tooltip text; `false` disables the tooltip. Defaults to `label`. */
  tooltip?: string | false
  tooltipLocation?: 'top' | 'bottom' | 'start' | 'end'
  disabled?: boolean
  loading?: boolean
  active?: boolean
  /** Toggle buttons: exposes aria-pressed. */
  pressed?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'small',
  variant: 'text',
  color: undefined,
  iconColor: undefined,
  tooltip: undefined,
  tooltipLocation: 'bottom',
  disabled: false,
  loading: false,
  active: undefined,
  pressed: undefined
})

const dimensions = computed(() => ICON_BUTTON_SIZES[props.size])

const tooltipText = computed(() => {
  if (props.tooltip === false) return undefined
  return props.tooltip ?? props.label
})
</script>
