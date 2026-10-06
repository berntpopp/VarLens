<template>
  <v-alert
    v-if="failed"
    type="error"
    variant="tonal"
    density="compact"
    role="alert"
    class="ma-2"
    data-testid="chunk-load-error"
  >
    Part of VarLens could not be loaded, so a view or dialog may be missing. Check your connection,
    then reload the application.
    <template #append>
      <v-btn variant="outlined" size="small" @click="reload">Reload</v-btn>
    </template>
  </v-alert>
</template>

<script setup lang="ts">
/**
 * Shell-level notice for a lazy chunk that failed to load. Statically imported
 * by App.vue on purpose: it must not itself depend on a lazy chunk.
 */
import { useChunkLoadFailure } from '../../composables/useChunkLoadFailure'

const { failed, reload } = useChunkLoadFailure()
</script>
