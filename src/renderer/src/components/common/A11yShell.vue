<template>
  <a class="skip-link" href="#main-content" @click.prevent="focusMain">Skip to main content</a>
  <!-- Inside <main> so the heading sits in a landmark (axe: region) -->
  <Teleport defer to="#main-content">
    <h1 class="visually-hidden" data-testid="view-heading">{{ title.heading }}</h1>
  </Teleport>
  <DelegatedTooltip />
</template>

<script setup lang="ts">
/**
 * App-wide accessibility scaffolding, mounted once at the top of <v-app>:
 * skip link (2.4.1), per-view h1 + document.title (2.4.2), and the single
 * delegated tooltip used by IconButton and dense table cells.
 */
import DelegatedTooltip from './DelegatedTooltip.vue'
import { useViewTitle } from '../../composables/useViewTitle'

const title = useViewTitle()

function focusMain(): void {
  const main = document.getElementById('main-content')
  main?.focus()
}
</script>
