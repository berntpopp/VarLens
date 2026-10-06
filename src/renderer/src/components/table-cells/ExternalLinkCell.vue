<template>
  <!-- Real anchor: focusable, announced as a link, Enter activates. The click
       is intercepted so Electron routes it through the validated
       shell.openExternal; middle-click / copy-link still see the href. -->
  <a
    v-if="url"
    class="external-link"
    :href="url"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="ariaLabel ?? `${label} (opens in a new tab)`"
    @click.prevent="handleClick"
  >
    {{ label }}
    <v-icon size="x-small" class="external-link__icon" :icon="mdiOpenInNew" />
  </a>
  <span v-else class="text-medium-emphasis">--</span>
</template>

<script setup lang="ts">
import { mdiOpenInNew } from '@mdi/js'
interface Props {
  url: string | null
  label?: string
  /** Accessible name; defaults to "<label> (opens in a new tab)". */
  ariaLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  label: 'View',
  ariaLabel: undefined
})

const emit = defineEmits<{ click: [url: string, event: MouseEvent] }>()

const handleClick = (event: MouseEvent): void => {
  if (props.url !== null && props.url !== '') {
    emit('click', props.url, event)
  }
}
</script>
