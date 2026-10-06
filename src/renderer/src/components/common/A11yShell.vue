<template>
  <a class="skip-link" href="#main-content" @click.prevent="focusMain">Skip to main content</a>
  <DelegatedTooltip />
</template>

<script setup lang="ts">
/**
 * App-wide accessibility scaffolding, mounted once at the top of <v-app>:
 * skip link (2.4.1) and the single delegated tooltip used by IconButton and
 * dense table cells. The per-view h1 + document.title live in App.vue's
 * <v-main> (rendered there, not teleported, so case switches patch it safely).
 */
import DelegatedTooltip from './DelegatedTooltip.vue'

function focusMain(): void {
  const main = document.getElementById('main-content')
  main?.focus()
}
</script>
