<template>
  <v-navigation-drawer permanent :rail="rail" :width="240">
    <template #prepend>
      <v-toolbar density="compact" color="primary" dark>
        <v-icon v-show="!rail" class="mr-2">mdi-dna</v-icon>
        <v-toolbar-title v-show="!rail">Cases</v-toolbar-title>
        <v-spacer />
        <v-btn icon @click="toggleRail">
          <v-icon>{{ rail ? 'mdi-chevron-right' : 'mdi-chevron-left' }}</v-icon>
        </v-btn>
      </v-toolbar>
    </template>

    <slot />
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const rail = ref(false)

const toggleRail = (): void => {
  rail.value = !rail.value
}

defineExpose({ rail })
</script>
