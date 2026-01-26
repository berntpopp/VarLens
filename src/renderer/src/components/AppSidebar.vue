<template>
  <v-navigation-drawer permanent :rail="rail" :width="260">
    <template #prepend>
      <v-toolbar density="compact" color="primary" dark>
        <v-icon class="ml-2">mdi-dna</v-icon>
        <span v-show="!rail" class="ml-2 text-subtitle-1 font-weight-medium">Cases</span>
        <v-spacer />
        <v-tooltip v-if="!rail" location="bottom" text="Import variant file">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              icon
              size="small"
              variant="text"
              @click="$emit('import-click')"
            >
              <v-icon>mdi-plus</v-icon>
            </v-btn>
          </template>
        </v-tooltip>
        <v-tooltip :text="rail ? 'Expand sidebar' : 'Collapse sidebar'" location="bottom">
          <template #activator="{ props: tooltipProps }">
            <v-btn v-bind="tooltipProps" icon size="small" variant="text" @click="toggleRail">
              <v-icon>{{ rail ? 'mdi-chevron-right' : 'mdi-chevron-left' }}</v-icon>
            </v-btn>
          </template>
        </v-tooltip>
      </v-toolbar>
    </template>

    <slot />
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineEmits<{
  'import-click': []
}>()

const rail = ref(false)

const toggleRail = (): void => {
  rail.value = !rail.value
}

defineExpose({ rail })
</script>
